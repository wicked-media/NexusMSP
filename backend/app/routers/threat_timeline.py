"""Persisted security-event timeline with scope-bound resolution evidence.

Threat Timeline is an observational read model over security records already
stored by Nexus or an approved integration. It must never manufacture threat
history just because a collection is empty.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import assert_client_scope, effective_scope, scoped_query


router = APIRouter()

# These IDs were written by the retired GET-time demo seeder. Preserve the
# records for an operator-led data review, but never present or mutate them as
# security evidence.
_RETIRED_GENERATED_EVENT_IDS = frozenset(
    {"thr-001", "thr-002", "thr-003", "thr-004", "thr-005"}
)
_TIMELINE_EVENT_FIELDS = (
    "id",
    "source",
    "source_event_id",
    "client_id",
    "client_name",
    "site_id",
    "device_id",
    "device_name",
    "hostname",
    "severity",
    "status",
    "title",
    "detected_at",
    "created_at",
    "observed_at",
    "mitre_attack",
    "mitre_tactic",
    "mitre_technique",
    "resolved",
    "resolved_by",
    "resolved_at",
    "auto_isolated",
)
_THREAT_DETAIL_FIELDS = (*_TIMELINE_EVENT_FIELDS, "description", "process_chain", "resolution_notes")


def _combine_and(*queries: dict[str, Any]) -> dict[str, Any]:
    """Combine non-empty Mongo queries without dropping an access boundary."""
    clauses = [query for query in queries if query]
    if not clauses:
        return {}
    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}


def _tenant_visibility_query(current_user: dict[str, Any]) -> dict[str, Any]:
    """Keep explicitly tenant-bound evidence inside the active tenant.

    Historical records may not yet have a tenant binding. They remain available
    only through the separate client/site boundary; records carrying a
    conflicting tenant ID are never eligible for this caller.
    """
    tenant_id = str(current_user.get("tenant_id") or "").strip()
    if not tenant_id:
        return {}
    return {
        "$or": [
            {"tenant_id": tenant_id},
            {"tenant_id": {"$exists": False}},
            {"tenant_id": None},
        ]
    }


async def _timeline_read_query(current_user: dict[str, Any]) -> dict[str, Any]:
    """Return a server-side query that never exposes another client's event.

    New records should carry ``client_id`` directly. For a restricted
    technician, a legacy event without that field can be read only when its
    stable ``device_id`` resolves to a device already inside their allowed
    client/site scope. Records with neither binding remain invisible rather
    than being guessed from mutable display names.
    """
    generated_record_exclusion = {"id": {"$nin": sorted(_RETIRED_GENERATED_EVENT_IDS)}}
    direct_scope = scoped_query(current_user)
    tenant_scope = _tenant_visibility_query(current_user)
    if effective_scope(current_user)["mode"] == "all":
        return _combine_and(direct_scope, tenant_scope, generated_record_exclusion)

    scoped_devices = await db.devices.find(
        scoped_query(current_user), {"_id": 0, "id": 1}
    ).to_list(5_000)
    device_ids = [str(device.get("id")) for device in scoped_devices if device.get("id")]
    legacy_device_scope = {
        "$and": [
            {"$or": [{"client_id": {"$exists": False}}, {"client_id": None}]},
            {"device_id": {"$in": device_ids}},
        ]
    }
    return _combine_and(
        {"$or": [direct_scope, legacy_device_scope]},
        tenant_scope,
        generated_record_exclusion,
    )


async def _load_scoped_event(
    event_id: str,
    current_user: dict[str, Any],
    *,
    operation: str,
) -> tuple[dict[str, Any], str | None, str | None]:
    """Load one event and prove its tenant/client/site boundary.

    Missing and out-of-scope events intentionally share a 404 response so an
    identifier cannot be used to enumerate another customer's investigations.
    """
    event = await db.threat_events.find_one({"id": str(event_id)}, {"_id": 0})
    if not event or str(event.get("id") or "") in _RETIRED_GENERATED_EVENT_IDS:
        raise HTTPException(status_code=404, detail="Threat event not found")

    user_tenant_id = str(current_user.get("tenant_id") or "").strip()
    event_tenant_id = str(event.get("tenant_id") or "").strip()
    if user_tenant_id and event_tenant_id and event_tenant_id != user_tenant_id:
        raise HTTPException(status_code=404, detail="Threat event not found")

    client_id = event.get("client_id")
    site_id = event.get("site_id")
    if not client_id and event.get("device_id"):
        linked_device = await db.devices.find_one(
            scoped_query(current_user, {"id": str(event["device_id"])}),
            {"_id": 0, "client_id": 1, "site_id": 1},
        )
        if linked_device:
            client_id = linked_device.get("client_id")
            site_id = linked_device.get("site_id")

    await assert_client_scope(
        current_user,
        client_id,
        site_id=site_id,
        operation=operation,
        mask_not_found=True,
    )
    return event, client_id, site_id


def _public_event(event: dict[str, Any], *, detail: bool = False) -> dict[str, Any]:
    """Return the narrow timeline read model, never an integration payload."""
    fields = _THREAT_DETAIL_FIELDS if detail else _TIMELINE_EVENT_FIELDS
    return {field: event[field] for field in fields if field in event}


@router.get("/threat-timeline/events")
async def get_threat_events(
    response: Response,
    current_user: dict = Depends(get_current_user),
):
    """Return only persisted, scope-authorised threat evidence.

    An empty ``events`` list means Nexus has no recorded timeline evidence in
    the caller's current scope. It does not assert that no threats exist.
    """
    events = await db.threat_events.find(
        await _timeline_read_query(current_user), {"_id": 0}
    ).sort("detected_at", -1).to_list(200)
    # Preserve the legacy list payload while making the provenance visible to
    # callers that can inspect headers. An empty list is not a health claim.
    response.headers["X-Nexus-Evidence-State"] = "recorded-events-only"
    response.headers["X-Nexus-Evidence-Source"] = "persisted-nexus-threat-events"
    return [
        _public_event(event)
        for event in events
        if str(event.get("id") or "") not in _RETIRED_GENERATED_EVENT_IDS
    ]


@router.get("/threat-timeline/event/{event_id}")
async def get_threat_detail(event_id: str, current_user: dict = Depends(get_current_user)):
    event, _client_id, _site_id = await _load_scoped_event(
        event_id,
        current_user,
        operation="threat_timeline.detail.read",
    )
    return _public_event(event, detail=True)


@router.post("/threat-timeline/events/{event_id}/resolve")
async def resolve_threat(event_id: str, current_user: dict = Depends(get_current_user)):
    """Retire a generic resolve action that cannot prove source remediation."""
    raise HTTPException(
        status_code=410,
        detail=(
            "Threat Timeline is an evidence-only view and cannot resolve a source event. "
            "Use SOC Feed for an internal SOC case or Ransomware Canary for containment evidence."
        ),
    )
