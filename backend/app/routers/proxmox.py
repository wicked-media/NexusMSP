"""Proxmox VE workspace endpoints — the first executing adapter flow.

Read paths observe the provider with provenance (``observed_at``/``source``)
and never fabricate inventory. The power-action path is the template every
future executing adapter follows:

    permission → tenant/client scope → canonical action descriptor →
    simulate | fail-closed | approval (destructive) → provider task →
    verification → evidence + audit + event

Contract rules enforced here (docs/NEXUS_PRODUCT_CONSTITUTION.md):

- No configured connection, no execution: an unconfigured provider answers
  409 and is recorded as ``not_configured`` — never a success-shaped payload.
- Destructive power actions start in approval-required mode and execute only
  after an independent admin approval, exactly once (conditional claim).
- Nexus claims only what it observed: ``completed`` requires a verified
  outcome; a finished-but-unexpected outcome is ``completed_unverified`` and a
  task Nexus could not watch finish is ``outcome_unknown``.
- Every read and write carries tenant and client scope server-side.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.routers.approval_workflows import create_approval
from app.services import proxmox_adapter, proxmox_inventory
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.nexus_protocol import validate_action_descriptor
from app.services.platform_foundation import emit_platform_event
from app.services.scope_permissions import (
    assert_tenant_record_scope,
    platform_tenant_id,
    scoped_query,
    tenant_scoped_query,
)

router = APIRouter()

ACTION_COLLECTION = "proxmox_vm_actions"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _scoped_servers(user: dict) -> dict:
    """Connections visible to this actor: tenant partition + client scope."""
    return tenant_scoped_query(user, scoped_query(user, {}))


async def _safe_event(*, subject: str, user: dict, payload: dict, client_id: str | None = None) -> None:
    """Persist a platform event; an event failure never hides an outcome."""
    try:
        await emit_platform_event(
            subject=subject,
            source="nexus.proxmox",
            payload=payload,
            actor={"id": user.get("id"), "name": user.get("name"), "role": user.get("role")},
            tenant_id=platform_tenant_id(user),
            client_id=client_id,
        )
    except Exception as exc:  # noqa: BLE001 - the action record remains the durable evidence
        payload["event_persist_error"] = str(exc)[:200]


# ============== CONNECTION (configuration + health) =============


@router.get("/proxmox/connection")
async def get_proxmox_connection(current_user: dict = Depends(get_current_user)):
    """Report whether this actor has a usable Proxmox connection — no secrets."""
    docs = await db.proxmox_servers.find(_scoped_servers(current_user), {"_id": 0}).to_list(50)
    connections = []
    configured = False
    for doc in docs:
        summary = proxmox_adapter.connection_summary(doc)
        summary["recorded_status"] = str(doc.get("status") or "unknown")
        summary["health"] = "unconfigured"
        summary["error"] = None
        if summary.get("configured"):
            configured = True
            connection = proxmox_adapter.load_connection(doc)
            try:
                async with proxmox_adapter.ProxmoxClient(connection) as client:
                    version = await client.version()
                summary["health"] = "ok"
                summary["provider_version"] = str(version.get("version") or "") or None
            except proxmox_adapter.ProxmoxAdapterError as exc:
                summary["health"] = exc.kind
                summary["error"] = exc.detail
        connections.append(summary)
    return {
        "configured": configured,
        "mode": "execute" if configured else "unconfigured",
        "connections": connections,
        # Platform-wide reconciliation state (enabled, cadence, last pass). It
        # carries no per-customer totals, so it is safe on a scoped read.
        "reconciliation": await proxmox_inventory.scheduler_status(),
        "note": (
            "A configured connection executes verified provider actions through the "
            "canonical action descriptor. Without one, Nexus only offers simulations "
            "and never claims a provider result. A configured connection's inventory is "
            "also reconciled from the provider's own report on a schedule, so the "
            "guests below stay current without an operator pressing sync."
        ),
    }


# ============== INVENTORY (observe with provenance) =============


@router.get("/proxmox/nodes")
async def get_proxmox_nodes(current_user: dict = Depends(get_current_user)):
    """Live node status from the provider itself; empty when unconfigured."""
    docs = await db.proxmox_servers.find(_scoped_servers(current_user), {"_id": 0}).to_list(50)
    nodes: list[dict] = []
    for doc in docs:
        connection = proxmox_adapter.load_connection(doc)
        if not connection or not connection.configured:
            continue
        try:
            inventory = await proxmox_adapter.fetch_inventory(connection)
        except proxmox_adapter.ProxmoxAdapterError:
            # Health and the failure reason are reported by /proxmox/connection;
            # an unreachable provider must not fabricate node rows here.
            continue
        host = connection.base_url.split("://", 1)[-1]
        for node in inventory["nodes"]:
            nodes.append(
                {
                    "id": f"{connection.server_id}:{node['node']}",
                    "name": node["node"],
                    "status": "online" if node["status"] == "online" else "offline",
                    "cpu_usage": node["cpu_usage"],
                    "memory_usage": node["memory_usage"],
                    "disk_usage": node["disk_usage"],
                    "uptime_hours": node["uptime_hours"],
                    "vm_count": node["vm_count"],
                    "ip": host,
                    "connection_id": connection.server_id,
                    "client_id": connection.client_id,
                    "source": inventory["source"],
                    "observed_at": inventory["observed_at"],
                }
            )
    return nodes


# ============== INVENTORY SYNC (observe the provider, store the binding) =====
#
# docs/DATA_OWNERSHIP.md keeps Proxmox VE as the authority for real node and
# guest state; ``proxmox_vms`` is only the provider-bound projection Nexus acts
# through. The reconciliation policy itself lives in one place —
# ``app/services/proxmox_inventory.py`` — because the durable
# ``proxmox-inventory`` worker reconciles the same projection on a schedule.
# This route is that policy's operator trigger (and its HTTP translation), so
# the scheduled and manual paths can never drift into two different rules.


@router.post("/proxmox/servers/{server_id}/sync")
async def sync_proxmox_inventory(
    server_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Reconcile one connection's guest inventory from the provider's own report.

    Read-only toward the provider and honest about failure: an unconfigured or
    unreachable cluster answers 409/502 with the reason and leaves the stored
    projection exactly as it was.
    """
    server_doc = await db.proxmox_servers.find_one(
        tenant_scoped_query(current_user, scoped_query(current_user, {"id": server_id})),
        {"_id": 0},
    )
    if not server_doc:
        raise HTTPException(status_code=404, detail="Resource not found")

    try:
        return await proxmox_inventory.sync_connection(
            server_doc=server_doc,
            actor=current_user,
            trigger="operator",
            # An operator observes inside their own tenant partition, which is
            # the partition they can then read the projection back from.
            tenant_id=platform_tenant_id(current_user),
        )
    except proxmox_adapter.ProxmoxAdapterError as exc:
        raise HTTPException(
            status_code=409 if exc.kind in {"not_configured", "binding"} else 502,
            detail=exc.detail,
        ) from None


# NOTE: GET /proxmox/vms is a documented legacy shadow owned by the
# ``infrastructure`` router (server.py `_LEGACY_HTTP_OPERATION_OWNERS`); the
# definition below stays for programmatic/test use and is skipped at startup.
@router.get("/proxmox/vms")
async def get_proxmox_vms(
    node_id: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Stored Proxmox guest inventory — scoped, and empty rather than invented."""
    query: dict = {}
    if node_id:
        query["node"] = node_id
    if client_id:
        query["client_id"] = client_id
    scoped = tenant_scoped_query(current_user, scoped_query(current_user, query))
    return await db.proxmox_vms.find(scoped, {"_id": 0}).sort("name", 1).to_list(500)


# ============== POWER ACTIONS (execute + verify) =============


def _build_descriptor(
    *,
    vm: dict,
    action: str,
    spec: dict,
    user: dict,
    mode: str,
    reason: str,
) -> dict:
    """One canonical action descriptor (P0 #1) for this proposed action."""
    rollback_action = str(spec.get("rollback") or "start")
    expected = spec.get("expected_status")
    return {
        "action": "configure",
        "actor": {
            "kind": "technician",
            "id": str(user.get("id") or ""),
            "on_behalf_of": str(user.get("name") or ""),
        },
        "target": {"kind": "device", "nexus_id": str(vm.get("id") or "")},
        "scope": {
            "tenant_id": platform_tenant_id(user),
            "client_id": str(vm.get("client_id") or ""),
        },
        "destructive": bool(spec.get("destructive")),
        "reversible": True,
        "autonomy_level": "act_with_verification" if mode == "execute" else "suggest",
        "verification_plan": (
            f"Proxmox task exitstatus OK and guest status '{expected}'"
            if expected
            else "Proxmox task exitstatus OK (end state recorded, not asserted)"
        ),
        "rollback": {
            "action": "configure",
            "plan": f"perform '{rollback_action}' on the same guest to reverse this action",
        },
        "reason": reason,
    }


def _new_action_record(*, vm: dict, action: str, spec: dict, user: dict, mode: str,
                       descriptor: dict, reason: str, idempotency_key: str) -> dict:
    return {
        "id": f"PXA-{uuid.uuid4().hex[:12]}",
        "tenant_id": platform_tenant_id(user),
        "client_id": vm.get("client_id"),
        "client_name": vm.get("client_name"),
        "vm_id": vm.get("id"),
        "vm_name": vm.get("name"),
        "vmid": vm.get("vmid"),
        "node": vm.get("node") or vm.get("node_name"),
        "server_id": vm.get("server_id"),
        "action": action,
        "mode": mode,
        "status": "executing",
        "destructive": bool(spec.get("destructive")),
        "descriptor": descriptor,
        "reason": reason,
        "idempotency_key": idempotency_key or None,
        "requested_by": user.get("id"),
        "requested_by_name": user.get("name"),
        "requested_by_role": user.get("role"),
        "created_at": _now(),
        "updated_at": _now(),
    }


async def _record_event(
    *, user: dict, record: dict, subject: str, payload: dict,
) -> None:
    await _safe_event(
        subject=subject,
        user=user,
        payload={"action_id": record.get("id"), "vm_id": record.get("vm_id"),
                 "provider_action": record.get("action"), "status": record.get("status"), **payload},
        client_id=record.get("client_id"),
    )


async def _execute_and_respond(
    *,
    user: dict,
    vm: dict,
    record: dict,
) -> dict:
    """Run the provider call and record exactly what was observed.

    Raises HTTPException on every unverified path *after* the evidence is
    written, so a failure is always recorded and never reported as success.
    """
    action = record["action"]
    server_doc = await db.proxmox_servers.find_one(
        tenant_scoped_query(user, {"id": vm.get("server_id")}), {"_id": 0}
    )
    connection = proxmox_adapter.load_connection(server_doc) if server_doc else None

    if not connection or not connection.configured:
        await db[ACTION_COLLECTION].update_one(
            {"id": record["id"]},
            {"$set": {"status": "not_configured", "failure_kind": "not_configured",
                      "updated_at": _now(),
                      "error": "No Proxmox connection is configured for this virtual machine."}},
        )
        await log_activity(
            user, "proxmox_vm_action_blocked", "proxmox_vm_action", record["id"],
            f"{action} {record.get('vm_name') or record.get('vm_id')}",
            "Blocked a Proxmox action because no connection is configured; nothing was executed",
            metadata={"client_id": record.get("client_id"), "failure_kind": "not_configured"},
        )
        await _record_event(user=user, record=record, subject="virtualization.vm.action.blocked",
                            payload={"failure_kind": "not_configured"})
        raise HTTPException(
            status_code=409,
            detail=(
                "No Proxmox connection is configured for this virtual machine, so nothing "
                "was executed. Configure the connection in Infrastructure, or request a "
                "simulation instead."
            ),
        )

    try:
        result = await proxmox_adapter.execute_power_action(connection, vm, action)
    except proxmox_adapter.ProxmoxAdapterError as exc:
        await db[ACTION_COLLECTION].update_one(
            {"id": record["id"]},
            {"$set": {"status": "execution_failed", "failure_kind": exc.kind,
                      "updated_at": _now(), "error": exc.detail,
                      "evidence": exc.evidence or None}},
        )
        await log_activity(
            user, "proxmox_vm_action_failed", "proxmox_vm_action", record["id"],
            f"{action} {record.get('vm_name') or record.get('vm_id')}",
            f"Proxmox action failed before a verified outcome: {exc.detail}",
            metadata={"client_id": record.get("client_id"), "failure_kind": exc.kind},
        )
        await _record_event(user=user, record=record, subject="virtualization.vm.action.failed",
                            payload={"failure_kind": exc.kind})
        status_code = 409 if exc.kind in {"not_configured", "binding"} else 502
        raise HTTPException(status_code=status_code, detail=exc.detail)

    verification = result["verification"]
    verdict = verification.get("verdict")
    if verdict == "verified":
        new_status = "completed"
        message = f"Proxmox confirmed '{action}'; outcome verified."
    elif verdict == "inconclusive":
        new_status = "completed_unverified"
        message = (
            f"Proxmox completed '{action}' but the observed guest state did not match the "
            "expectation. Review the verification evidence before relying on this outcome."
        )
    elif verdict == "failed":
        await db[ACTION_COLLECTION].update_one(
            {"id": record["id"]},
            {"$set": {"status": "execution_failed", "failure_kind": "task_failed",
                      "updated_at": _now(), "task": result.get("task"),
                      "observed": result.get("observed"), "verification": verification,
                      "error": f"Proxmox task exitstatus: {result.get('task', {}).get('exitstatus')}"}},
        )
        await log_activity(
            user, "proxmox_vm_action_failed", "proxmox_vm_action", record["id"],
            f"{action} {record.get('vm_name') or record.get('vm_id')}",
            "Proxmox task finished with a failure exitstatus; no success is claimed",
            metadata={"client_id": record.get("client_id"), "failure_kind": "task_failed"},
        )
        await _record_event(user=user, record=record, subject="virtualization.vm.action.failed",
                            payload={"failure_kind": "task_failed"})
        raise HTTPException(
            status_code=502,
            detail=(f"Proxmox did not complete '{action}' "
                    f"(task exitstatus: {result.get('task', {}).get('exitstatus')}); "
                    f"nothing is being claimed as successful. Action {record['id']}."),
        )
    else:  # unknown: the task did not finish inside the verification window
        new_status = "outcome_unknown"
        message = (
            f"Nexus submitted '{action}' but could not confirm the outcome within the "
            "verification window. The recorded task ID is the evidence; check the guest "
            "before relying on this action."
        )

    await db[ACTION_COLLECTION].update_one(
        {"id": record["id"]},
        {"$set": {"status": new_status, "updated_at": _now(),
                  "task": result.get("task"), "observed": result.get("observed"),
                  "verification": verification, "completed_at": _now()}},
    )
    await log_activity(
        user,
        "proxmox_vm_action_completed" if new_status == "completed" else "proxmox_vm_action_observed",
        "proxmox_vm_action", record["id"],
        f"{action} {record.get('vm_name') or record.get('vm_id')}",
        message,
        metadata={"client_id": record.get("client_id"), "status": new_status,
                  "verdict": verdict, "upid": result.get("submitted", {}).get("upid")},
    )
    await _record_event(
        user=user, record=record,
        subject=("virtualization.vm.action.completed" if new_status == "completed"
                 else "virtualization.vm.action.outcome.unknown"),
        payload={"status": new_status, "verdict": verdict,
                 "upid": result.get("submitted", {}).get("upid")},
    )

    record.update({"status": new_status, "task": result.get("task"),
                   "observed": result.get("observed"), "verification": verification})
    response = {
        "id": record["id"],
        "status": new_status,
        "executed": True,
        "verified": verdict == "verified",
        "action": action,
        "vm_id": record.get("vm_id"),
        "task": result.get("task"),
        "observed": result.get("observed"),
        "verification": verification,
        "message": message,
    }
    if new_status == "outcome_unknown":
        # Recorded first, then reported honestly as an unconfirmed outcome.
        raise HTTPException(status_code=504, detail=f"{message} Action {record['id']}.")
    return response


@router.post("/proxmox/vms/{vm_id}/action")
async def vm_action(
    vm_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(require_action("virtualization.vm.control")),
):
    """Propose (simulate) or execute one Proxmox guest power action."""
    action = str(data.get("action") or "").strip().lower()
    spec = proxmox_adapter.action_spec(action)
    if spec is None:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid action. Valid: {sorted(proxmox_adapter.VM_ACTIONS)}",
        )
    mode = str(data.get("mode") or "execute").strip().lower()
    if mode not in {"execute", "simulate"}:
        raise HTTPException(status_code=400, detail="mode must be 'execute' or 'simulate'")
    reason = str(data.get("reason") or "").strip()[:500]
    idempotency_key = str(data.get("idempotency_key") or "").strip()[:120]

    vm = await assert_tenant_record_scope(
        current_user, db.proxmox_vms, vm_id,
        operation="proxmox.vm.action", request=request, resource_name="Virtual machine",
    )

    if idempotency_key:
        existing = await db[ACTION_COLLECTION].find_one(
            tenant_scoped_query(current_user, {"idempotency_key": idempotency_key}),
            {"_id": 0},
        )
        if existing:
            return {**existing, "idempotent_replay": True,
                    "message": "This action was already requested; returning the recorded outcome."}

    descriptor = _build_descriptor(vm=vm, action=action, spec=spec, user=current_user,
                                   mode=mode, reason=reason)
    validation = validate_action_descriptor(descriptor)
    if not validation["valid"]:
        raise HTTPException(status_code=422, detail=validation["problems"])

    record = _new_action_record(vm=vm, action=action, spec=spec, user=current_user,
                                mode=mode, descriptor=descriptor, reason=reason,
                                idempotency_key=idempotency_key)

    # --- Simulation: a plan, never an execution -----------------------------
    if mode == "simulate":
        simulation = proxmox_adapter.simulate_power_action(
            vm, action, actor_id=str(current_user.get("id") or "")
        )
        record["status"] = "simulated"
        record["simulation"] = simulation
        record["updated_at"] = _now()
        await db[ACTION_COLLECTION].insert_one(record)
        record.pop("_id", None)
        await log_activity(
            current_user, "proxmox_vm_action_simulated", "proxmox_vm_action", record["id"],
            f"{action} {vm.get('name') or vm_id}",
            "Simulated a Proxmox action; no provider call was made",
            metadata={"client_id": vm.get("client_id"), "status": "simulated"},
        )
        await _record_event(user=current_user, record=record,
                            subject="virtualization.vm.action.simulated",
                            payload={"status": "simulated"})
        return {
            "id": record["id"], "status": "simulated", "executed": False, "verified": False,
            "action": action, "vm_id": vm_id, "simulation": simulation,
            "descriptor": descriptor,
            "message": "Simulation only — Nexus did not call Proxmox and nothing was changed.",
        }

    # --- Execution requires a real connection (fail closed) -----------------
    server_doc = await db.proxmox_servers.find_one(
        tenant_scoped_query(current_user, {"id": vm.get("server_id")}), {"_id": 0}
    )
    connection = proxmox_adapter.load_connection(server_doc) if server_doc else None
    if not connection or not connection.configured:
        record["status"] = "not_configured"
        record["failure_kind"] = "not_configured"
        record["error"] = "No Proxmox connection is configured for this virtual machine."
        await db[ACTION_COLLECTION].insert_one(record)
        record.pop("_id", None)
        await log_activity(
            current_user, "proxmox_vm_action_blocked", "proxmox_vm_action", record["id"],
            f"{action} {vm.get('name') or vm_id}",
            "Blocked a Proxmox action because no connection is configured; nothing was executed",
            metadata={"client_id": vm.get("client_id"), "failure_kind": "not_configured"},
        )
        await _record_event(user=current_user, record=record,
                            subject="virtualization.vm.action.blocked",
                            payload={"failure_kind": "not_configured"})
        raise HTTPException(
            status_code=409,
            detail=(
                "No Proxmox connection is configured for this virtual machine, so nothing "
                "was executed. Configure the connection in Infrastructure, or request a "
                "simulation instead."
            ),
        )

    # --- Destructive actions wait for independent approval -----------------
    if spec["destructive"]:
        record["status"] = "pending_approval"
        await db[ACTION_COLLECTION].insert_one(record)
        record.pop("_id", None)
        approval = await create_approval(
            {
                "type": "proxmox",
                "title": f"Proxmox: {action} {vm.get('name') or vm_id}",
                "description": reason or spec.get("description") or f"Proxmox {action}",
                "client_id": vm.get("client_id"),
                "client_name": vm.get("client_name") or "",
                "ref_id": record["id"],
                "ref_type": "proxmox_vm_action",
                "approver_role": "admin",
            },
            current_user,
        )
        await db[ACTION_COLLECTION].update_one(
            {"id": record["id"]}, {"$set": {"approval_id": approval.get("id")}}
        )
        record["approval_id"] = approval.get("id")
        await log_activity(
            current_user, "proxmox_vm_action_approval_requested", "proxmox_vm_action",
            record["id"], f"{action} {vm.get('name') or vm_id}",
            "Requested independent approval for a destructive Proxmox action; nothing was executed",
            metadata={"client_id": vm.get("client_id"), "approval_id": approval.get("id")},
        )
        await _record_event(user=current_user, record=record,
                            subject="virtualization.vm.action.approval.requested",
                            payload={"status": "pending_approval",
                                     "approval_id": approval.get("id")})
        return {
            "id": record["id"], "status": "pending_approval", "executed": False,
            "verified": False, "action": action, "vm_id": vm_id,
            "approval": approval, "descriptor": descriptor,
            "message": (
                f"'{action}' is destructive, so it is awaiting independent admin approval. "
                "Nothing has been executed."
            ),
        }

    # --- Non-destructive execution -----------------------------------------
    record["status"] = "executing"
    await db[ACTION_COLLECTION].insert_one(record)
    record.pop("_id", None)
    return await _execute_and_respond(user=current_user, vm=vm, record=record)


@router.post("/proxmox/vms/{vm_id}/action/{action_id}/execute")
async def execute_approved_vm_action(
    vm_id: str,
    action_id: str,
    request: Request,
    current_user: dict = Depends(require_action("virtualization.vm.control")),
):
    """Execute a previously approved destructive action exactly once."""
    vm = await assert_tenant_record_scope(
        current_user, db.proxmox_vms, vm_id,
        operation="proxmox.vm.action.execute", request=request, resource_name="Virtual machine",
    )
    record = await assert_tenant_record_scope(
        current_user, db[ACTION_COLLECTION], action_id,
        operation="proxmox.vm.action.execute", request=request,
        resource_name="Virtual machine action",
    )
    if record.get("vm_id") != vm_id:
        raise HTTPException(status_code=404, detail="Resource not found")
    if record.get("status") != "pending_approval":
        raise HTTPException(status_code=409, detail="This action is not awaiting approved execution")

    approval = await db.approvals.find_one(
        tenant_scoped_query(current_user, {
            "id": record.get("approval_id"), "ref_id": action_id, "status": "approved",
        }),
        {"_id": 0},
    )
    if not approval:
        raise HTTPException(
            status_code=409,
            detail="An independent approval is required before Proxmox executes this action",
        )

    claim = await db[ACTION_COLLECTION].update_one(
        {"id": action_id, "status": "pending_approval"},
        {"$set": {"status": "executing", "updated_at": _now(),
                  "executed_by": current_user.get("id"),
                  "approval_decided_by": approval.get("decided_by")}},
    )
    if getattr(claim, "matched_count", 1) != 1:
        raise HTTPException(status_code=409, detail="This action is already being executed or has changed state")

    record["status"] = "executing"
    return await _execute_and_respond(user=current_user, vm=vm, record=record)


@router.get("/proxmox/vms/{vm_id}/action-log")
async def get_vm_action_log(vm_id: str, current_user: dict = Depends(get_current_user)):
    """Attributable action history for one guest, scope-enforced."""
    await assert_tenant_record_scope(
        current_user, db.proxmox_vms, vm_id,
        operation="proxmox.vm.action.log", resource_name="Virtual machine",
    )
    rows = await db[ACTION_COLLECTION].find(
        tenant_scoped_query(current_user, scoped_query(current_user, {"vm_id": vm_id})),
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    return rows


# ============== BACKUP RECORDS ==============
#
# These endpoints maintain Nexus-side backup job records. They do not drive the
# Proxmox backup API yet, so the statuses they write say "requested" rather
# than implying a provider job is running.


@router.get("/proxmox/backups")
async def get_proxmox_backups(vm_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query: dict = {}
    if vm_id:
        query["vm_id"] = vm_id
    scoped = tenant_scoped_query(current_user, scoped_query(current_user, query))
    return await db.proxmox_backups.find(scoped, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/proxmox/backups")
async def create_backup(data: dict, current_user: dict = Depends(get_current_user)):
    """Record a requested backup job — a request, not a running provider job."""
    client_id = str(data.get("client_id") or "").strip() or None
    backup = {
        "id": str(uuid.uuid4()),
        "tenant_id": platform_tenant_id(current_user),
        "client_id": client_id,
        "vm_id": data.get("vm_id"),
        "vm_name": data.get("vm_name", ""),
        "type": data.get("type", "full"),
        "storage": data.get("storage", "local-zfs"),
        "retention_days": data.get("retention_days", 30),
        "compressed": data.get("compressed", True),
        "status": "requested",
        "execution": "not_connected",
        "size_gb": 0,
        "duration_minutes": 0,
        "created_by": current_user["id"],
        "created_at": _now(),
        "verified": False,
    }
    await db.proxmox_backups.insert_one(backup)
    backup.pop("_id", None)
    return backup


@router.post("/proxmox/backups/{backup_id}/restore")
async def restore_backup(backup_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Record a requested restore — Nexus has not executed it on the provider."""
    backup = await db.proxmox_backups.find_one(
        tenant_scoped_query(current_user, {"id": backup_id}), {"_id": 0}
    )
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")

    restore_log = {
        "id": str(uuid.uuid4()),
        "tenant_id": platform_tenant_id(current_user),
        "client_id": backup.get("client_id"),
        "backup_id": backup_id,
        "vm_id": backup.get("vm_id"),
        "target_vm": data.get("target_vm", backup.get("vm_id")),
        "status": "requested",
        "execution": "not_connected",
        "initiated_by": current_user["id"],
        "initiated_by_name": current_user["name"],
        "created_at": _now(),
    }
    await db.proxmox_restore_logs.insert_one(restore_log)
    restore_log.pop("_id", None)
    return restore_log


@router.get("/proxmox/backup-schedules")
async def get_backup_schedules(current_user: dict = Depends(get_current_user)):
    scoped = tenant_scoped_query(current_user, scoped_query(current_user, {}))
    return await db.proxmox_backup_schedules.find(scoped, {"_id": 0}).to_list(50)


@router.post("/proxmox/backup-schedules")
async def create_backup_schedule(data: dict, current_user: dict = Depends(get_current_user)):
    client_id = str(data.get("client_id") or "").strip() or None
    schedule = {
        "id": str(uuid.uuid4()),
        "tenant_id": platform_tenant_id(current_user),
        "client_id": client_id,
        "name": data.get("name", "New Schedule"),
        "schedule": data.get("schedule", "0 2 * * *"),
        "type": data.get("type", "full"),
        "storage": data.get("storage", "local-zfs"),
        "retention_days": data.get("retention_days", 30),
        "enabled": data.get("enabled", True),
        "vms": data.get("vms", []),
        "last_run": None,
        "created_by": current_user["id"],
        "created_at": _now(),
    }
    await db.proxmox_backup_schedules.insert_one(schedule)
    schedule.pop("_id", None)
    return schedule
