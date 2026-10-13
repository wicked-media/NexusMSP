"""Fleet baseline API — the estate's own endpoints as the reference for one device.

The projection is read-only, tenant- and client-scoped, and is pure policy in
``app.services.fleet_baseline``; this router owns the scope boundary, the bounded
read and HTTP, following the same shape as the other scoped evidence routers
(``endpoint_security``, ``customer_environment``).

The reads compare records Nexus already stores — the usage metrics the agent
reports on the device record and the self-heal performance band the agent learned
per endpoint — so they add no collection and no datum to own.

One endpoint here writes, and it is the boundary where an explanation becomes
proposed work: it raises the change request a recurring deviation shape would
justify. It executes nothing on any endpoint, and the change record it creates
belongs to Change Management (``app/routers/change_management.py``), which already
owns the approval, verification and rollback lifecycle — so the proposal is
created by that owner rather than beside it. Reading what a shape would raise
needs no more permission than reading the deviation, but raising it needs
``platform.readiness.manage`` and a global client scope, because a cohort spans
clients.

Why this module exists at all: batch 5 recorded ``fleet-baseline`` as the gate
blocking the Windows and Endpoint Performance studios, because "a baseline exists
per endpoint and nothing compares a device against the fleet"
(``app/services/studio_proposals.py``). These endpoints are that comparison.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.routers.change_management import create_change_request
from app.services import fleet_baseline, fleet_change_proposal
from app.services.action_permissions import require_action
from app.services.platform_foundation import emit_platform_event, request_correlation_id
from app.services.scope_permissions import (
    assert_global_scope,
    platform_tenant_id,
    scoped_query,
    tenant_scoped_query,
)

router = APIRouter(prefix="/fleet-baseline", tags=["Fleet Baseline"])

# Only the fields the projection reads, so a cohort read cannot pull a full
# inventory (installed software, disk and network children) into memory.
_DEVICE_PROJECTION = {
    "_id": 0,
    "id": 1,
    "client_id": 1,
    "name": 1,
    "hostname": 1,
    "os": 1,
    "os_platform": 1,
    "platform": 1,
    "status": 1,
    "last_seen": 1,
    "last_heartbeat": 1,
    "cpu_usage": 1,
    "memory_usage": 1,
    "disk_usage": 1,
    "telemetry": 1,
    "self_heal": 1,
}


async def _scoped_devices(current_user: dict) -> list[dict]:
    """Every endpoint the caller is allowed to see, bounded and projected.

    The scope is applied by the database query, never by the caller, and is the
    same two-boundary combination the rest of the platform uses — the tenant
    partition plus the caller's client/site scope (``customer_environment``,
    ``operations_assurance``) — so a cohort can only ever be built from endpoints
    the caller could already open.
    """
    return await db.devices.find(
        tenant_scoped_query(current_user, scoped_query(current_user)),
        _DEVICE_PROJECTION,
    ).to_list(fleet_baseline.MAX_DEVICES)


@router.get("/contract")
async def get_baseline_contract(current_user: dict = Depends(get_current_user)) -> dict:
    """What a cohort baseline is, and which cohorts this estate can support.

    Discloses the metric list, the minimum cohort size and the deviation
    thresholds, so a verdict the API returns can be reproduced by hand.
    """
    return fleet_baseline.contract(await _scoped_devices(current_user))


@router.get("/cohorts/{platform}/deviations")
async def get_cohort_deviations(
    platform: str, current_user: dict = Depends(get_current_user)
) -> dict:
    """Every device in one cohort against that cohort's measured baseline.

    A cohort with no endpoint in scope is disclosed (``cohort: null`` with the
    reason) rather than returned as an error or as an empty healthy list.
    """
    return fleet_baseline.deviations(await _scoped_devices(current_user), platform)


@router.get("/cohorts/{platform}/recurrence")
async def get_cohort_recurrence(
    platform: str, current_user: dict = Depends(get_current_user)
) -> dict:
    """Deviation shapes more than one endpoint in the cohort shares.

    Counted from the same deviations the per-device view returns, so a recurring
    problem cannot contradict the evidence it was derived from.
    """
    return fleet_baseline.recurrence(await _scoped_devices(current_user), platform)


# ============== A SHAPE AS PROPOSED WORK ==============


# The studios whose deviation evidence this raises work from declare
# ``platform.readiness.view``. Turning an explanation into a request that
# authorises work on endpoints is a readiness *decision*, so it needs the manage
# half of the same pair rather than a permission invented for it here.
PROPOSE_PERMISSION = "platform.readiness.manage"


def _open_change_query() -> dict:
    """The changes that make a second proposal for one shape a duplicate."""
    return {
        "source.kind": fleet_change_proposal.SOURCE_KIND,
        "status": {"$in": list(fleet_change_proposal.OPEN_CHANGE_STATUSES)},
    }


async def _open_proposals(current_user: dict) -> list[dict]:
    """Open derived changes this caller may see, read with the owner's own scope.

    ``change_requests`` is not tenant-partitioned, so this read uses the same
    client/site boundary Change Management itself lists with
    (``scoped_query(user, {}, site_field=None)``) rather than claiming a partition
    the collection does not carry.
    """
    return await db.change_requests.find(
        scoped_query(current_user, _open_change_query(), site_field=None),
        {"_id": 0},
    ).to_list(200)


@router.get("/cohorts/{platform}/proposed-changes")
async def get_shape_proposals(
    platform: str, current_user: dict = Depends(get_current_user)
) -> dict:
    """Every recurring shape in one cohort and the change each would raise.

    Read-only. The same three refusals the POST decides are disclosed here, so a
    surface can show what would happen before anyone asks Nexus to do it.
    """
    report = fleet_baseline.recurrence(await _scoped_devices(current_user), platform)
    return fleet_change_proposal.previews(report, open_changes=await _open_proposals(current_user))


@router.post("/cohorts/{platform}/proposed-changes")
async def propose_change_from_shape(
    request: Request,
    platform: str,
    payload: dict = Body(...),
    current_user: dict = Depends(require_action(PROPOSE_PERMISSION)),
) -> dict:
    """Raise a recurring deviation shape as a change request, or refuse it.

    Nothing is executed on any endpoint. A cohort spans clients, so the caller
    needs an explicitly global client scope as well as the action permission, and
    an existing open change for the same shape is returned rather than duplicated.
    """
    await assert_global_scope(current_user, operation="fleet_baseline.propose_change")
    report = fleet_baseline.recurrence(await _scoped_devices(current_user), platform)
    decision = fleet_change_proposal.proposal(
        report,
        str(payload.get("shape_id") or ""),
        open_changes=await _open_proposals(current_user),
    )
    if not decision["proposed"]:
        reason = decision["reason"]
        if reason == "already_open":
            raise HTTPException(409, decision["detail"])
        raise HTTPException(400, decision["detail"])

    change = await create_change_request(payload=decision["change"], user=current_user)
    event_note = None
    try:
        await emit_platform_event(
            subject="endpoint.deviation.change.proposed",
            source="nexus.fleet-baseline",
            payload={
                "change_id": change.get("id"),
                "platform": report.get("platform"),
                "shape_id": decision["change"]["source"]["shape_id"],
                "metric": decision["change"]["source"]["metric"],
                "direction": decision["change"]["source"]["direction"],
                "device_count": decision["change"]["source"]["device_count"],
            },
            actor={
                "id": current_user.get("id"),
                "name": current_user.get("name"),
                "role": current_user.get("role"),
            },
            tenant_id=platform_tenant_id(current_user),
            correlation_id=request_correlation_id(request),
            idempotency_key=f"fleet-shape-proposal:{change.get('id')}",
        )
    except Exception as exc:  # noqa: BLE001 - the change record is the durable evidence
        event_note = str(exc)[:200]
    return {
        "created": True,
        "change": change,
        "event_persist_error": event_note,
        "boundary": fleet_change_proposal.BOUNDARY,
    }
