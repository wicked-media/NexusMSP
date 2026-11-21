"""Webhook Builder - Full CRUD for custom webhook integrations with testing and logging"""
from fastapi import APIRouter, Depends, HTTPException, Request
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.scope_permissions import assert_global_scope
from app.services.webhook_security import (
    assert_outbound_destination,
    redact_webhook_for_response,
)
import time, uuid

import httpx

router = APIRouter(prefix="/webhook-builder", tags=["webhook-builder"])


async def _require_webhook_administration(
    request: Request,
    current_user: dict = Depends(get_current_user),
    _permission: dict = Depends(require_action("platform.webhooks.manage")),
) -> dict:
    await assert_global_scope(current_user, operation="platform.webhooks.manage", request=request)
    return current_user

EVENT_TRIGGERS = [
    {"value": "ticket.created", "label": "Ticket Created", "category": "tickets"},
    {"value": "ticket.updated", "label": "Ticket Updated", "category": "tickets"},
    {"value": "ticket.closed", "label": "Ticket Closed", "category": "tickets"},
    {"value": "ticket.escalated", "label": "Ticket Escalated", "category": "tickets"},
    {"value": "device.offline", "label": "Device Went Offline", "category": "monitoring"},
    {"value": "device.online", "label": "Device Came Online", "category": "monitoring"},
    {"value": "device.alert", "label": "Device Alert Triggered", "category": "monitoring"},
    {"value": "backup.failed", "label": "Backup Failed", "category": "backup"},
    {"value": "backup.completed", "label": "Backup Completed", "category": "backup"},
    {"value": "invoice.created", "label": "Invoice Created", "category": "billing"},
    {"value": "invoice.paid", "label": "Invoice Paid", "category": "billing"},
    {"value": "invoice.overdue", "label": "Invoice Overdue", "category": "billing"},
    {"value": "client.onboarded", "label": "Client Onboarded", "category": "clients"},
    {"value": "security.alert", "label": "Security Alert", "category": "security"},
    {"value": "sla.breach", "label": "SLA Breach", "category": "sla"},
    {"value": "patch.failed", "label": "Patch Failed", "category": "patching"},
    {"value": "user.login", "label": "User Login", "category": "auth"},
]

SAMPLE_PAYLOADS = {
    "ticket.created": '{"event":"ticket.created","ticket_id":"TK-001","title":"Server Down","priority":"critical","client":"Acme Corp","assigned_to":"John Smith","created_at":"{{timestamp}}"}',
    "device.offline": '{"event":"device.offline","device_id":"DEV-001","hostname":"SRV-PROD-01","client":"Acme Corp","last_seen":"{{timestamp}}","alert_level":"critical"}',
    "backup.failed": '{"event":"backup.failed","job_id":"BKP-001","device":"SRV-DC01","client":"Acme Corp","error":"Timeout after 3600s","timestamp":"{{timestamp}}"}',
    "invoice.paid": '{"event":"invoice.paid","invoice_id":"INV-001","client":"Acme Corp","amount":3500.00,"paid_at":"{{timestamp}}"}',
}

@router.get("/list")
async def list_webhooks(current_user: dict = Depends(_require_webhook_administration)):
    hooks = await db.webhooks.find({}, {"_id": 0}).to_list(100)
    return [redact_webhook_for_response(hook) for hook in hooks]


@router.get("/triggers")
async def get_event_triggers(current_user: dict = Depends(_require_webhook_administration)):
    return {"triggers": EVENT_TRIGGERS, "sample_payloads": SAMPLE_PAYLOADS}


@router.post("/create")
async def create_webhook(data: dict, current_user: dict = Depends(_require_webhook_administration)):
    try:
        endpoint_url = await assert_outbound_destination(data.get("url"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    hook = {
        "id": f"WH-{uuid.uuid4().hex[:6].upper()}",
        "name": data.get("name", "Untitled Webhook"),
        "trigger": data.get("trigger", "ticket.created"),
        "method": data.get("method", "POST"),
        "url": endpoint_url,
        "headers": data.get("headers", {"Content-Type": "application/json"}),
        "payload_template": data.get("payload_template", "{}"),
        "status": "active",
        "trigger_count": 0,
        "last_triggered": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", "Admin"),
        "filters": data.get("filters", {}),
        "retry_count": data.get("retry_count", 3),
        "retry_delay": data.get("retry_delay", 30),
        "log": [],
    }
    await db.webhooks.insert_one(hook)
    hook.pop("_id", None)
    return redact_webhook_for_response(hook)


@router.put("/{hook_id}")
async def update_webhook(hook_id: str, data: dict, current_user: dict = Depends(_require_webhook_administration)):
    updates = {k: v for k, v in data.items() if k in ["name", "trigger", "method", "url", "headers", "payload_template", "status", "filters", "retry_count", "retry_delay"]}
    if "url" in updates:
        try:
            updates["url"] = await assert_outbound_destination(updates["url"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.webhooks.update_one({"id": hook_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"message": "Updated"}


@router.delete("/{hook_id}")
async def delete_webhook(hook_id: str, current_user: dict = Depends(_require_webhook_administration)):
    r = await db.webhooks.delete_one({"id": hook_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}


@router.post("/{hook_id}/toggle")
async def toggle_webhook(hook_id: str, current_user: dict = Depends(_require_webhook_administration)):
    hook = await db.webhooks.find_one({"id": hook_id}, {"_id": 0})
    if not hook:
        raise HTTPException(status_code=404, detail="Not found")
    new_status = "paused" if hook["status"] == "active" else "active"
    await db.webhooks.update_one({"id": hook_id}, {"$set": {"status": new_status}})
    return {"status": new_status}


@router.post("/{hook_id}/test")
async def test_webhook(hook_id: str, current_user: dict = Depends(_require_webhook_administration)):
    hook = await db.webhooks.find_one({"id": hook_id}, {"_id": 0})
    if not hook:
        raise HTTPException(status_code=404, detail="Not found")

    try:
        url = await assert_outbound_destination(hook.get("url"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    configured_headers = hook.get("headers") if isinstance(hook.get("headers"), dict) else {}
    headers = {str(key): str(value) for key, value in configured_headers.items()}
    headers.setdefault("Content-Type", "application/json")
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "event": "test",
        "hook_id": hook.get("id"),
        "hook_name": hook.get("name"),
        "trigger": hook.get("trigger"),
        "message": "NexusMSP webhook test delivery",
        "timestamp": now,
    }

    started = time.perf_counter()
    status_code = None
    transport_error = None
    try:
        timeout = httpx.Timeout(10.0, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as response:
                status_code = response.status_code
    except httpx.HTTPError as exc:
        transport_error = type(exc).__name__
    response_time_ms = int(round((time.perf_counter() - started) * 1000))

    success = status_code is not None and 200 <= status_code < 300
    if success:
        message = f"Destination accepted the delivery ({status_code} in {response_time_ms} ms)"
    elif status_code is None:
        message = f"No response from destination ({transport_error}) after {response_time_ms} ms"
    elif 300 <= status_code < 400:
        message = f"Destination returned a redirect ({status_code}); redirects are not followed"
    else:
        message = f"Destination rejected the delivery ({status_code})"

    test_log = {
        "timestamp": now,
        "type": "test",
        "status_code": status_code,
        "response_time_ms": response_time_ms,
        "success": success,
        "message": message,
    }
    update = {
        "$push": {"log": {"$each": [test_log], "$slice": -50}},
        "$set": {
            "last_triggered": now,
            "last_status": status_code,
            "last_result": "success" if success else "failed",
        },
    }
    update["$set"]["failure_count"] = 0 if success else (int(hook.get("failure_count") or 0) + 1)
    await db.webhooks.update_one({"id": hook_id}, update)
    return test_log


@router.get("/{hook_id}/logs")
async def get_webhook_logs(hook_id: str, current_user: dict = Depends(_require_webhook_administration)):
    hook = await db.webhooks.find_one({"id": hook_id}, {"_id": 0, "log": 1, "name": 1})
    if not hook:
        raise HTTPException(status_code=404, detail="Not found")
    return {"name": hook.get("name"), "logs": hook.get("log", [])}
