"""Nexus Expected State Engine — compares declared scope to observed evidence."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.action_permissions import require_action
from app.services.roadmap_tools import revision_impact
from app.services.scope_permissions import platform_tenant_id, scoped_query, tenant_scoped_query

router = APIRouter(tags=["Nexus Expected State"])


def _evidence_query(current_user: dict, query: dict, *, field: str = "client_id") -> dict:
    """Apply both Nexus platform ownership and technician client scope."""
    return tenant_scoped_query(
        current_user,
        scoped_query(current_user, query, field=field, site_field=None),
    )


@router.get("/assurance/overview")
@router.get("/expected-state/overview")
async def expected_state_overview(current_user: dict = Depends(get_current_user)):
    """Return cautious, evidence-backed controls for each managed customer.

    A missing source is intentionally reported as not assessed. Nexus must not
    infer protection, recoverability, billing, or compliance from absence.
    """
    # `clients.id` is the stable client boundary; do not query a non-existent
    # `clients.client_id` field for restricted technicians.
    clients = await db.clients.find(
        _evidence_query(current_user, {}, field="id"),
        {"_id": 0},
    ).to_list(2000)
    client_ids = [item.get("id") for item in clients if item.get("id")]
    # Retired assets must not inflate an active managed-endpoint commitment.
    # Nexus counts an endpoint as RMM-proven only when the device itself has a
    # stable agent link and that exact active agent has checked in recently.
    # Counting every agent record owned by the client would allow an unrelated
    # or duplicate agent to make another endpoint appear covered.
    devices = await db.devices.find(_evidence_query(current_user, {
        "client_id": {"$in": client_ids},
        "archived": {"$ne": True},
    }), {"_id": 0}).to_list(10000)
    agents = await db.nexus_agents.find(
        _evidence_query(current_user, {"client_id": {"$in": client_ids}, "is_active": True}),
        {"_id": 0, "id": 1, "client_id": 1, "is_active": 1, "last_seen": 1},
    ).to_list(10000)
    subscriptions = await db.subscriptions.find(_evidence_query(current_user, {"client_id": {"$in": client_ids}}), {"_id": 0}).to_list(10000)
    backup_jobs = await db.backup_jobs.find(_evidence_query(current_user, {"client_id": {"$in": client_ids}}), {"_id": 0}).to_list(10000)
    recovery_tests = await db.backup_verifications.find(_evidence_query(current_user, {"client_id": {"$in": client_ids}}), {"_id": 0}).to_list(10000)
    tenant_ids = [str(item.get("cipp_tenant_id") or "").strip() for item in clients if item.get("cipp_tenant_id")]
    # CIPP hygiene records are keyed only by tenant_id. Tenant IDs are derived
    # from the already client-scoped `clients` list above, so applying the
    # generic client_id scope here would hide all legitimate cache records for
    # restricted technicians (the cache has no client_id field).
    hygiene_rows = await db.cipp_hygiene_cache.find(
        tenant_scoped_query(
            current_user,
            {"tenant_id": {"$in": tenant_ids}},
            tenant_field="platform_tenant_id",
        ),
        {"_id": 0, "tenant_id": 1, "hygiene": 1},
    ).to_list(2000) if tenant_ids else []
    hygiene_by_tenant = {str(row.get("tenant_id")): row.get("hygiene") or {} for row in hygiene_rows}

    online_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
    recent_agent_keys = {
        (str(agent.get("id") or ""), str(agent.get("client_id") or ""))
        for agent in agents
        if agent.get("is_active") is not False
        and str(agent.get("last_seen") or "") >= online_cutoff
    }
    findings, coverage, controls = [], [], []

    def add_control(
        client_id,
        client_name,
        control_id,
        label,
        status,
        detail,
        route,
        expected=None,
        observed=None,
        *,
        evidence_sources=None,
        evidence_boundary="",
    ):
        controls.append({
            "id": f"{control_id}:{client_id}", "control_id": control_id,
            "client_id": client_id, "client_name": client_name, "label": label,
            "status": status, "detail": detail, "route": route,
            "expected": expected, "observed": observed,
            "provenance": {
                "sources": list(evidence_sources or []),
                "boundary": evidence_boundary,
                "state": "derived_read_model",
            },
        })

    for client in clients:
        client_id = client.get("id")
        client_name = client.get("name") or client.get("company_name") or client_id
        managed = [device for device in devices if device.get("client_id") == client_id]
        linked_recent_devices = [
            device for device in managed
            if (str(device.get("nexus_agent_id") or ""), str(client_id)) in recent_agent_keys
        ]
        active_services = [service for service in subscriptions if service.get("client_id") == client_id and str(service.get("status") or "active").lower() not in {"cancelled", "disabled"}]
        expected_endpoints, observed_agents = len(managed), len(linked_recent_devices)

        endpoint_status = "not_assessed" if not expected_endpoints else "covered" if observed_agents >= expected_endpoints else "gap"
        add_control(client_id, client_name, "endpoint-agent", "Active Nexus agent", endpoint_status,
                    "No active managed endpoint scope is recorded." if not expected_endpoints else f"{observed_agents} of {expected_endpoints} active managed endpoints have a recent, stable-linked Nexus Agent heartbeat.",
                    "/devices", expected_endpoints or None, observed_agents if expected_endpoints else None,
                    evidence_sources=["devices", "nexus_agents"],
                    evidence_boundary="A client-owned agent is evidence only for the device carrying its same stable nexus_agent_id. Missing, stale, inactive or unlinked agent records are not coverage.")
        if expected_endpoints and observed_agents < expected_endpoints:
            missing = expected_endpoints - observed_agents
            findings.append({"id": f"agent:{client_id}", "client_id": client_id, "client_name": client_name, "domain": "endpoint coverage", "severity": "high" if missing > 1 else "medium", "expected": expected_endpoints, "observed": observed_agents, "title": f"{missing} managed endpoint{'s' if missing != 1 else ''} lack active Nexus agent evidence", "next_step": "Review device enrolment and agent heartbeat before treating endpoint coverage as complete.", "route": "/devices"})

        billing_status = "not_assessed" if not expected_endpoints else "covered" if active_services else "gap"
        add_control(client_id, client_name, "service-billing", "Service billing evidence", billing_status,
                    "No managed endpoint scope is recorded." if not expected_endpoints else (f"{len(active_services)} active subscription record{'s' if len(active_services) != 1 else ''} linked." if active_services else "No active subscription record is linked to the managed endpoint scope."),
                    "/services-subscriptions?view=attention", 1 if expected_endpoints else None, len(active_services) if expected_endpoints else None,
                    evidence_sources=["devices", "subscriptions"],
                    evidence_boundary="A client-scoped active subscription is commercial evidence only. Nexus does not infer per-endpoint billing, contract inclusion or invoice reconciliation from this control.")
        if expected_endpoints and not active_services:
            findings.append({"id": f"billing:{client_id}", "client_id": client_id, "client_name": client_name, "domain": "billing coverage", "severity": "medium", "expected": expected_endpoints, "observed": 0, "title": "Managed endpoints are recorded but no active client subscription evidence is linked", "next_step": "Confirm contract/service mapping; Nexus cannot infer that managed endpoints are being billed.", "route": "/services-subscriptions?view=attention"})

        service_text = " ".join(str(service.get(key) or "") for service in active_services for key in ("name", "product_name", "product", "service_name", "category")).lower()
        backup_declared = any(marker in service_text for marker in ("backup", "acronis", "veeam", "datto", "bdr"))
        client_jobs = [job for job in backup_jobs if job.get("client_id") == client_id]
        failed_jobs = [job for job in client_jobs if str(job.get("status") or "").lower() in {"failed", "error"}]
        backup_status = "not_assessed" if not backup_declared else "covered" if client_jobs and not failed_jobs else "gap"
        add_control(client_id, client_name, "backup-execution", "Backup execution evidence", backup_status,
                    "No backup service declaration was found in linked subscriptions." if not backup_declared else (f"{len(client_jobs)} backup job{'s' if len(client_jobs) != 1 else ''} retained; {len(failed_jobs)} currently failed." if client_jobs else "Backup service is declared but no retained backup-job evidence is linked."),
                    "/backup-center", 1 if backup_declared else None, len(client_jobs) if backup_declared else None,
                    evidence_sources=["subscriptions", "backup_jobs"],
                    evidence_boundary="A declared backup service and retained job records are not a claim that every workload is protected or recoverable. Provider engines remain authoritative for execution.")
        if backup_declared and (not client_jobs or failed_jobs):
            findings.append({"id": f"backup:{client_id}", "client_id": client_id, "client_name": client_name, "domain": "backup assurance", "severity": "high" if failed_jobs else "medium", "expected": 1, "observed": len(client_jobs), "title": "Declared backup service lacks clean execution evidence", "next_step": "Review backup jobs and provider mapping. A service declaration is not proof that recoverable backups exist.", "route": "/backup-center"})

        successful_tests = [
            test for test in recovery_tests
            if test.get("client_id") == client_id
            and (
                str(test.get("result") or test.get("outcome") or "").strip().lower()
                in {"pass", "passed", "success", "successful", "verified"}
                # Older evidence records may only retain a success status. A
                # generic "completed" status alone is not proof of success.
                or (
                    not str(test.get("result") or test.get("outcome") or "").strip()
                    and str(test.get("status") or "").strip().lower()
                    in {"passed", "success", "successful", "verified"}
                )
            )
        ]
        recovery_status = "not_assessed" if not backup_declared else "covered" if successful_tests else "gap"
        add_control(client_id, client_name, "recovery-verification", "Recovery verification", recovery_status,
                    "No backup service declaration was found in linked subscriptions." if not backup_declared else (f"{len(successful_tests)} retained successful recovery verification{'s' if len(successful_tests) != 1 else ''}." if successful_tests else "No successful retained recovery-verification evidence was found."),
                    "/backup-center?tab=verify", 1 if backup_declared else None, len(successful_tests) if backup_declared else None,
                    evidence_sources=["subscriptions", "backup_verifications"],
                    evidence_boundary="A successful recorded verification supports only its retained test scope. It does not prove every system, dependency, RTO or RPO without explicit evidence.")
        if backup_declared and not successful_tests:
            findings.append({"id": f"recovery:{client_id}", "client_id": client_id, "client_name": client_name, "domain": "recovery assurance", "severity": "medium", "expected": 1, "observed": 0, "title": "Declared backup service has no retained successful recovery verification", "next_step": "Schedule a scoped recovery verification. Successful backup execution alone does not prove recoverability.", "route": "/backup-center?tab=verify"})

        tenant_id = str(client.get("cipp_tenant_id") or "").strip()
        evidence_state = str((hygiene_by_tenant.get(tenant_id) or {}).get("evidence_state") or "").lower()
        posture_status = "not_assessed" if not tenant_id else "covered" if evidence_state in {"evidence_available", "assessed", "complete"} else "gap"
        add_control(client_id, client_name, "microsoft-posture", "Microsoft security posture", posture_status,
                    "No Microsoft tenant is linked to this customer." if not tenant_id else (f"Tenant posture evidence is {evidence_state.replace('_', ' ')}." if posture_status == "covered" else "A Microsoft tenant is linked but no current posture evidence is retained."),
                    "/control-plane?module=microsoft365&view=security", 1 if tenant_id else None, 1 if posture_status == "covered" else 0 if tenant_id else None,
                    evidence_sources=["clients", "cipp_hygiene_cache"],
                    evidence_boundary="Microsoft posture is provider-derived cache evidence bound by the stable client tenant mapping. An unmapped, missing or stale source is never a passed control.")
        if tenant_id and posture_status == "gap":
            findings.append({"id": f"m365:{client_id}", "client_id": client_id, "client_name": client_name, "domain": "Microsoft posture", "severity": "medium", "expected": 1, "observed": 0, "title": "Linked Microsoft tenant has no current retained posture evidence", "next_step": "Refresh the tenant connection and security posture before using this customer’s Microsoft controls as evidence.", "route": "/control-plane?module=microsoft365&view=security"})

        coverage.append({"client_id": client_id, "client_name": client_name, "expected_endpoints": expected_endpoints, "active_agents": observed_agents, "active_subscriptions": len(active_services), "status": endpoint_status})

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "read_model": "nexus-assurance-expected-state",
        "contract_version": 1,
        "boundary": "Nexus Assurance compares declared Nexus scope with retained evidence. Missing provider data is never treated as compliant, protected, recovered or billed.",
        "provenance": {
            "state": "derived_read_model",
            "authoritative_sources": {
                "client_scope": "clients",
                "managed_endpoints": "devices",
                "agent_observations": "nexus_agents",
                "commercial_service_evidence": "subscriptions",
                "backup_execution_evidence": "backup_jobs",
                "recovery_test_evidence": "backup_verifications",
                "microsoft_posture_evidence": "cipp_hygiene_cache",
            },
            "no_persistence": True,
            "source_of_truth": "Each control identifies its owning evidence source; this response is never an independent compliance or billing authority.",
        },
        "summary": {"clients": len(clients), "findings": len(findings), "coverage_gaps": sum(1 for item in coverage if item["status"] == "gap"), "not_assessed": sum(1 for item in controls if item["status"] == "not_assessed"), "controls_assessed": sum(1 for item in controls if item["status"] != "not_assessed"), "control_gaps": sum(1 for item in controls if item["status"] == "gap")},
        "findings": findings, "coverage": coverage, "controls": controls,
    }


# ── Standards as code (roadmap #501, Nexus Configuration as Code, merged tool) ──
# Customer standards are versioned as reviewable revisions: every change keeps
# the previous revision immutable, impact is calculated before adoption, and
# remediation is always staged behind an approval. These are governance
# records only; remediation execution stays in its owning workspace.


class StandardControl(BaseModel):
    ref: str = Field(min_length=1, max_length=60)
    requirement: str = Field(min_length=1, max_length=500)


class StandardCreatePayload(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    description: str = Field(default="", max_length=500)
    controls: list[StandardControl] = Field(min_length=1, max_length=100)
    change_note: str = Field(default="Initial revision", max_length=500)


class StandardRevisionPayload(BaseModel):
    standard_id: str = Field(min_length=1, max_length=64)
    controls: list[StandardControl] = Field(min_length=1, max_length=100)
    change_note: str = Field(min_length=1, max_length=500)


class ImpactPayload(BaseModel):
    controls: list[StandardControl] = Field(min_length=1, max_length=100)


class StagedRemediationPayload(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    plan: str = Field(min_length=1, max_length=1000)
    target: Literal["all_clients", "selected_clients"] = "all_clients"


def _standard_public(row: dict) -> dict:
    revisions = row.get("revisions") or []
    current = revisions[-1] if revisions else None
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "description": row.get("description") or "",
        "current_revision": current.get("number") if current else 0,
        "change_note": current.get("change_note") if current else "",
        "controls": current.get("controls") if current else [],
        "revision_count": len(revisions),
        "updated_at": row.get("updated_at"),
    }


@router.get("/expected-state/standards")
async def list_expected_state_standards(current_user: dict = Depends(get_current_user)):
    """List versioned customer standards with their current revision."""
    rows = await db.expected_state_standards.find(
        tenant_scoped_query(current_user, {}), {"_id": 0}
    ).sort([("name", 1)]).to_list(200)
    return {
        "standards": [_standard_public(row) for row in rows],
        "policy": [
            "Every standard change is retained as an immutable numbered revision.",
            "Impact is calculated before a revision is adopted.",
            "Remediation is always staged behind an approval in the owning workspace.",
        ],
    }


@router.post(
    "/expected-state/standards",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def create_or_revise_standard(
    payload: StandardCreatePayload | StandardRevisionPayload,
    current_user: dict = Depends(get_current_user),
):
    """Create a standard or append an immutable revision to an existing one."""
    now = datetime.now(timezone.utc).isoformat()
    actor = str(current_user.get("id") or current_user.get("email") or "Nexus operator")
    standard_id = getattr(payload, "standard_id", None)
    if standard_id:
        row = await db.expected_state_standards.find_one(
            tenant_scoped_query(current_user, {"id": standard_id}), {"_id": 0}
        )
        if not row:
            raise HTTPException(status_code=404, detail="Standard not found")
        revisions = list(row.get("revisions") or [])
        revisions.append({
            "number": len(revisions) + 1,
            "controls": [control.model_dump() for control in payload.controls],
            "change_note": payload.change_note.strip(),
            "created_at": now,
            "created_by": actor,
        })
        await db.expected_state_standards.update_one(
            tenant_scoped_query(current_user, {"id": standard_id}),
            {"$set": {"revisions": revisions, "updated_at": now}},
        )
        await log_activity(
            current_user, "expected_state.standard_revised", "expected_state_standard",
            standard_id, str(row.get("name") or ""), details=payload.change_note.strip(),
            metadata={"revision": len(revisions)},
        )
        return _standard_public({**row, "revisions": revisions, "updated_at": now})
    document = {
        "id": f"std-{uuid.uuid4().hex[:12]}",
        "tenant_id": platform_tenant_id(current_user),
        "name": payload.name.strip(),
        "description": payload.description.strip(),
        "revisions": [{
            "number": 1,
            "controls": [control.model_dump() for control in payload.controls],
            "change_note": payload.change_note.strip(),
            "created_at": now,
            "created_by": actor,
        }],
        "created_at": now,
        "updated_at": now,
        "created_by": actor,
    }
    await db.expected_state_standards.insert_one(dict(document))
    await log_activity(
        current_user, "expected_state.standard_created", "expected_state_standard",
        document["id"], document["name"], details=payload.change_note.strip(),
    )
    return _standard_public(document)


@router.post("/expected-state/standards/{standard_id}/impact")
async def standard_revision_impact(
    standard_id: str,
    payload: ImpactPayload,
    current_user: dict = Depends(get_current_user),
):
    """Calculate what a proposed revision would change before it is adopted."""
    row = await db.expected_state_standards.find_one(
        tenant_scoped_query(current_user, {"id": standard_id}), {"_id": 0}
    )
    if not row:
        raise HTTPException(status_code=404, detail="Standard not found")
    revisions = row.get("revisions") or []
    current_controls = (revisions[-1] if revisions else {}).get("controls") or []
    impact = revision_impact(current_controls, [control.model_dump() for control in payload.controls])
    return {
        "standard_id": standard_id,
        "current_revision": len(revisions),
        "impact": impact,
        "boundary": "Impact compares declared control text only. Live client posture evidence remains owned by the Expected State overview.",
    }


@router.post(
    "/expected-state/standards/{standard_id}/staged-remediations",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def stage_standard_remediation(
    standard_id: str,
    payload: StagedRemediationPayload,
    current_user: dict = Depends(get_current_user),
):
    """Stage remediation behind an approval; nothing executes here."""
    row = await db.expected_state_standards.find_one(
        tenant_scoped_query(current_user, {"id": standard_id}), {"_id": 0}
    )
    if not row:
        raise HTTPException(status_code=404, detail="Standard not found")
    now = datetime.now(timezone.utc).isoformat()
    remediation = {
        "id": f"rem-{uuid.uuid4().hex[:12]}",
        "tenant_id": platform_tenant_id(current_user),
        "standard_id": standard_id,
        "title": payload.title.strip(),
        "plan": payload.plan.strip(),
        "target": payload.target,
        "status": "awaiting_approval",
        "approval": None,
        "created_at": now,
        "created_by": str(current_user.get("id") or current_user.get("email") or "Nexus operator"),
    }
    await db.expected_state_remediations.insert_one(dict(remediation))
    await log_activity(
        current_user, "expected_state.remediation_staged", "expected_state_remediation",
        remediation["id"], remediation["title"],
        details="Remediation staged behind approval. No change was executed.",
    )
    return remediation


@router.post(
    "/expected-state/standards/{standard_id}/staged-remediations/{remediation_id}/approve",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def approve_standard_remediation(
    standard_id: str,
    remediation_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Approve one staged remediation so its owning workspace may execute it."""
    row = await db.expected_state_remediations.find_one(
        tenant_scoped_query(current_user, {"id": remediation_id, "standard_id": standard_id}),
        {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Staged remediation not found")
    if row.get("status") != "awaiting_approval":
        raise HTTPException(status_code=422, detail="Only remediation awaiting approval can be approved")
    now = datetime.now(timezone.utc).isoformat()
    approval = {
        "approved_at": now,
        "approved_by": str(current_user.get("id") or current_user.get("email") or "Nexus operator"),
    }
    await db.expected_state_remediations.update_one(
        tenant_scoped_query(current_user, {"id": remediation_id}),
        {"$set": {"status": "approved", "approval": approval}},
    )
    await log_activity(
        current_user, "expected_state.remediation_approved", "expected_state_remediation",
        remediation_id, str(row.get("title") or ""),
        details="Staged remediation approved. Execution remains in the owning workspace.",
    )
    return {**row, "status": "approved", "approval": approval}
