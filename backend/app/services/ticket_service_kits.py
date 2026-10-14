"""Service-kit orchestration for the Nexus Service Desk.

Workshop and field-service records pre-date the unified ticket workspace.  They
remain valuable specialised execution records, but they must no longer become
an unrelated second customer request.  This service attaches one of the
curated delivery kits to a canonical ticket and creates a linked work record
for the legacy specialist workflow.

The parent ticket remains authoritative for the customer request, SLA and
service-desk history.  The linked work record owns only specialist delivery
evidence such as workshop intake, bench stages, parts, site readings and
field-service sign-off.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
import uuid

from fastapi import HTTPException

from app.database import db
from app.services.activity import log_activity, ticket_audit
from app.services.scope_permissions import platform_tenant_id


SERVICE_KITS: dict[str, dict[str, Any]] = {
    "workshop_repair": {
        "id": "workshop_repair",
        "name": "Workshop Repair Kit",
        "description": "Device intake, repair bench, parts, quote, verification and customer handover.",
        "workflow": "workshop",
        "record_collection": "workshop_jobs",
        "record_type": "workshop_job",
        "initial_status": "checked_in",
        "context_fields": (
            "device_type",
            "device_brand",
            "device_model",
            "serial_number",
            "condition_on_arrival",
            "accessories_received",
        ),
    },
    "cabling_field": {
        "id": "cabling_field",
        "name": "Cabling & Field Kit",
        "description": "Site brief, dispatch, field evidence, materials, verification and customer sign-off.",
        "workflow": "field",
        "record_collection": "field_jobs",
        "record_type": "field_job",
        "initial_status": "scheduled",
        "context_fields": (
            "service_address",
            "zone",
            "job_category",
            "scheduled_date",
            "scheduled_time",
            "estimated_duration",
        ),
    },
}

_DEFAULT_CONTEXT: dict[str, dict[str, Any]] = {
    "workshop_repair": {
        "device_type": "",
        "device_brand": "",
        "device_model": "",
        "serial_number": "",
        "condition_on_arrival": "",
        "accessories_received": [],
    },
    "cabling_field": {
        "service_address": "",
        "zone": "",
        "job_category": "installation",
        "scheduled_date": "",
        "scheduled_time": "",
        "estimated_duration": 60,
    },
}

_FIELD_JOB_CATEGORIES = frozenset({"installation", "maintenance", "troubleshooting", "decommission", "survey"})
_MAX_CONTEXT_TEXT = 500


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def public_catalog() -> list[dict[str, Any]]:
    """Return the curated, browser-safe delivery-kit catalogue."""
    return [
        {
            "id": kit["id"],
            "name": kit["name"],
            "description": kit["description"],
            "workflow": kit["workflow"],
            "initial_status": kit["initial_status"],
            "context_fields": list(kit["context_fields"]),
        }
        for kit in SERVICE_KITS.values()
    ]


def _normalise_text(value: Any, field: str) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail=f"{field} must be text")
    cleaned = value.strip()
    if len(cleaned) > _MAX_CONTEXT_TEXT:
        raise HTTPException(status_code=422, detail=f"{field} is too long")
    return cleaned


def normalise_service_kit_context(kit_id: str, context: dict[str, Any] | None) -> dict[str, Any]:
    """Validate only the bounded, non-secret specialist context Nexus stores.

    Passwords and other credentials intentionally are not accepted.  A service
    kit should never be a route around the normal secret-management boundary.
    """
    if kit_id not in SERVICE_KITS:
        raise HTTPException(status_code=422, detail="Unknown Nexus delivery kit")
    if context is None:
        context = {}
    if not isinstance(context, dict):
        raise HTTPException(status_code=422, detail="service kit context must be an object")

    allowed = set(SERVICE_KITS[kit_id]["context_fields"])
    unknown = sorted(set(context) - allowed)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unsupported service-kit fields: {', '.join(unknown)}")

    output = deepcopy(_DEFAULT_CONTEXT[kit_id])
    if kit_id == "workshop_repair":
        for field in ("device_type", "device_brand", "device_model", "serial_number", "condition_on_arrival"):
            if field in context:
                output[field] = _normalise_text(context[field], field)
        if "accessories_received" in context:
            accessories = context["accessories_received"]
            if not isinstance(accessories, list) or len(accessories) > 30:
                raise HTTPException(status_code=422, detail="accessories_received must contain up to 30 items")
            output["accessories_received"] = [_normalise_text(item, "accessories_received") for item in accessories if _normalise_text(item, "accessories_received")]
        return output

    for field in ("service_address", "zone", "scheduled_date", "scheduled_time"):
        if field in context:
            output[field] = _normalise_text(context[field], field)
    if "job_category" in context:
        category = _normalise_text(context["job_category"], "job_category").lower() or "installation"
        if category not in _FIELD_JOB_CATEGORIES:
            raise HTTPException(status_code=422, detail="job_category is not supported by the Cabling & Field Kit")
        output["job_category"] = category
    if "estimated_duration" in context:
        try:
            duration = int(context["estimated_duration"])
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="estimated_duration must be a whole number of minutes") from exc
        if duration < 15 or duration > 1_440:
            raise HTTPException(status_code=422, detail="estimated_duration must be between 15 and 1440 minutes")
        output["estimated_duration"] = duration
    return output


def _reference(ticket: dict[str, Any], suffix: str) -> str:
    base = str(ticket.get("ticket_number") or ticket.get("id") or "NEXUS").strip().replace(" ", "-")
    return f"{base}-{suffix}"


async def _device_snapshot(ticket: dict[str, Any]) -> dict[str, Any]:
    device_id = ticket.get("device_id") or next(iter(ticket.get("device_ids") or []), None)
    if not device_id:
        return {}
    device = await db.devices.find_one(
        {"id": device_id, "client_id": ticket.get("client_id")},
        {"_id": 0, "id": 1, "name": 1, "device_type": 1, "manufacturer": 1, "model": 1, "serial_number": 1},
    )
    return device or {}


async def _client_snapshot(ticket: dict[str, Any]) -> dict[str, Any]:
    client_id = ticket.get("client_id")
    if not client_id:
        return {}
    client = await db.clients.find_one(
        {"id": client_id},
        {"_id": 0, "id": 1, "name": 1, "company_name": 1, "email": 1, "contact_email": 1, "phone": 1, "mobile": 1, "address": 1},
    )
    return client or {}


def _service_kit_snapshot(kit: dict[str, Any], work_record: dict[str, Any], current_user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": kit["id"],
        "name": kit["name"],
        "workflow": kit["workflow"],
        "state": "active",
        "version": 1,
        "activated_at": _now(),
        "activated_by": current_user.get("id") or current_user.get("email") or "system",
        "activated_by_name": current_user.get("name") or current_user.get("email") or "Nexus",
        "work_record": {
            "type": kit["record_type"],
            "id": work_record["id"],
            "reference": work_record["job_number"],
            "status": work_record.get("repair_status") or work_record.get("field_status"),
        },
    }


async def _build_workshop_record(ticket: dict[str, Any], context: dict[str, Any], current_user: dict[str, Any]) -> dict[str, Any]:
    device = await _device_snapshot(ticket)
    client = await _client_snapshot(ticket)
    now = _now()
    customer_name = ticket.get("client_name") or client.get("company_name") or client.get("name") or "Client"
    return {
        "id": str(uuid.uuid4()),
        "tenant_id": str(ticket.get("tenant_id") or platform_tenant_id(current_user)),
        "job_number": _reference(ticket, "WS"),
        "job_type": "workshop",
        "service_kit_id": "workshop_repair",
        "ticket_id": ticket["id"],
        "parent_ticket_id": ticket["id"],
        "client_id": ticket.get("client_id"),
        "customer_name": customer_name,
        "customer_phone": client.get("phone") or client.get("mobile") or "",
        "customer_email": ticket.get("contact_email") or client.get("email") or client.get("contact_email") or "",
        "device_id": device.get("id") or ticket.get("device_id") or "",
        "device_type": context["device_type"] or device.get("device_type") or "",
        "device_brand": context["device_brand"] or device.get("manufacturer") or "",
        "device_model": context["device_model"] or device.get("model") or device.get("name") or "",
        "serial_number": context["serial_number"] or device.get("serial_number") or "",
        "fault_description": ticket.get("description") or ticket.get("title") or "",
        "repair_status": "checked_in",
        "diagnosis": "",
        "repair_notes": "",
        "parts_used": [],
        "labour_minutes": 0,
        "labour_rate": 75.0,
        "total_parts_cost": 0,
        "total_labour_cost": 0,
        "total_cost": 0,
        "estimated_cost": 0,
        "priority": ticket.get("priority") or "medium",
        "assigned_to": ticket.get("assigned_to") or "",
        "assigned_to_name": ticket.get("assigned_name") or "",
        "timer_running": False,
        "timer_started_at": None,
        "condition_on_arrival": context["condition_on_arrival"],
        "accessories_received": context["accessories_received"],
        "warranty_status": "unknown",
        "pickup_notified": False,
        "collected": False,
        "collected_at": None,
        "created_by": current_user.get("id") or "system",
        "created_by_name": current_user.get("name") or current_user.get("email") or "Nexus",
        "created_at": now,
        "updated_at": now,
    }


async def _build_field_record(ticket: dict[str, Any], context: dict[str, Any], current_user: dict[str, Any]) -> dict[str, Any]:
    client = await _client_snapshot(ticket)
    now = _now()
    customer_name = ticket.get("client_name") or client.get("company_name") or client.get("name") or "Client"
    category = context["job_category"]
    checklist: list[dict[str, Any]] = []
    if category == "installation":
        checklist = [
            {"item": "Site survey complete", "checked": False},
            {"item": "Cable run / antenna mounted", "checked": False},
            {"item": "Router / CPE configured", "checked": False},
            {"item": "Speed test performed", "checked": False},
            {"item": "Customer walkthrough done", "checked": False},
            {"item": "Documentation photos taken", "checked": False},
        ]
    return {
        "id": str(uuid.uuid4()),
        "tenant_id": str(ticket.get("tenant_id") or platform_tenant_id(current_user)),
        "job_number": _reference(ticket, "FIELD"),
        "job_type": "field",
        "service_kit_id": "cabling_field",
        "ticket_id": ticket["id"],
        "parent_ticket_id": ticket["id"],
        "client_id": ticket.get("client_id"),
        "customer_name": customer_name,
        "customer_phone": client.get("phone") or client.get("mobile") or "",
        "customer_email": ticket.get("contact_email") or client.get("email") or client.get("contact_email") or "",
        "service_address": context["service_address"] or client.get("address") or "",
        "zone": context["zone"],
        "description": ticket.get("description") or ticket.get("title") or "",
        "field_status": "scheduled",
        "priority": ticket.get("priority") or "medium",
        "assigned_to": ticket.get("assigned_to") or "",
        "assigned_to_name": ticket.get("assigned_name") or "",
        "scheduled_date": context["scheduled_date"],
        "scheduled_time": context["scheduled_time"],
        "estimated_duration": context["estimated_duration"],
        "job_category": category,
        "checklist": checklist,
        "signal_strength": None,
        "speed_test_down": None,
        "speed_test_up": None,
        "completion_notes": "",
        "photos": [],
        "created_by": current_user.get("id") or "system",
        "created_by_name": current_user.get("name") or current_user.get("email") or "Nexus",
        "created_at": now,
        "updated_at": now,
    }


async def activate_service_kit(
    ticket: dict[str, Any],
    kit_id: str,
    context: dict[str, Any] | None,
    current_user: dict[str, Any],
) -> dict[str, Any]:
    """Attach a delivery kit and one linked specialist execution record.

    This is deliberately idempotent for the same kit.  A ticket cannot carry
    two specialist kits in this initial release because that would produce two
    competing lifecycle authorities.  Split independent work into child
    tickets first when both workflows are genuinely required.
    """
    kit = SERVICE_KITS.get(kit_id)
    if not kit:
        raise HTTPException(status_code=422, detail="Unknown Nexus delivery kit")
    if not ticket.get("client_id"):
        raise HTTPException(status_code=422, detail="A managed client is required before applying a delivery kit")

    existing = ticket.get("service_kit") or {}
    if existing.get("id"):
        if existing.get("id") == kit_id and existing.get("work_record", {}).get("id"):
            return {"ticket": ticket, "service_kit": existing, "idempotent": True}
        raise HTTPException(status_code=409, detail="This ticket already has a delivery kit. Create a child ticket for independent specialist work.")

    clean_context = normalise_service_kit_context(kit_id, context)
    collection = getattr(db, kit["record_collection"])

    existing_record = await collection.find_one(
        {"ticket_id": ticket["id"], "service_kit_id": kit_id},
        {"_id": 0},
    )
    if existing_record:
        record = existing_record
    elif kit_id == "workshop_repair":
        record = await _build_workshop_record(ticket, clean_context, current_user)
        await collection.insert_one(record)
    else:
        record = await _build_field_record(ticket, clean_context, current_user)
        await collection.insert_one(record)

    kit_snapshot = _service_kit_snapshot(kit, record, current_user)
    now = _now()
    result = await db.tickets.update_one(
        {"id": ticket["id"], "service_kit": {"$exists": False}},
        {
            "$set": {
                "service_kit": kit_snapshot,
                "service_kit_id": kit_id,
                "service_kit_context": clean_context,
                "updated_at": now,
            }
        },
    )
    if not result.modified_count:
        # A competing attachment must never leave an unlinked second record.
        if not existing_record:
            await collection.delete_one({"id": record["id"], "ticket_id": ticket["id"]})
        refreshed = await db.tickets.find_one({"id": ticket["id"]}, {"_id": 0})
        active = (refreshed or {}).get("service_kit") or {}
        if active.get("id") == kit_id and active.get("work_record", {}).get("id"):
            return {"ticket": refreshed, "service_kit": active, "idempotent": True}
        raise HTTPException(status_code=409, detail="This ticket was updated while the delivery kit was being attached. Refresh and try again.")

    specialist_audit = {
        "id": str(uuid.uuid4()),
        "tenant_id": str(ticket.get("tenant_id") or platform_tenant_id(current_user)),
        "job_id": record["id"],
        "action": "created_from_service_kit",
        "details": f"Created from parent ticket {ticket.get('ticket_number') or ticket['id']} using {kit['name']}",
        "user_id": current_user.get("id") or "system",
        "user_name": current_user.get("name") or current_user.get("email") or "Nexus",
        "created_at": now,
    }
    audit_collection = db.workshop_audit_log if kit_id == "workshop_repair" else db.field_audit_log
    await audit_collection.insert_one(specialist_audit)
    await ticket_audit(
        ticket["id"],
        current_user,
        "service_kit_applied",
        f"Applied {kit['name']} and linked specialist work record {record['job_number']}",
    )
    await log_activity(
        current_user,
        "service_kit_applied",
        "ticket",
        ticket["id"],
        ticket.get("title") or ticket.get("ticket_number") or "Ticket",
        f"Applied {kit['name']} ({record['job_number']})",
        metadata={
            "client_id": ticket.get("client_id"),
            "service_kit_id": kit_id,
            "work_record_id": record["id"],
            "work_record_type": kit["record_type"],
        },
    )
    updated_ticket = await db.tickets.find_one({"id": ticket["id"]}, {"_id": 0})
    return {"ticket": updated_ticket or {**ticket, "service_kit": kit_snapshot}, "service_kit": kit_snapshot, "idempotent": False}
