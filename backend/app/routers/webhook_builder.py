"""Webhook Builder - Full CRUD for custom webhook integrations with testing and logging"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user
import uuid, json, random

router = APIRouter(prefix="/webhook-builder", tags=["webhook-builder"])

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

def _gen_default_hooks():
    return [
        {"id": f"WH-{uuid.uuid4().hex[:6].upper()}", "name": "Slack - Critical Tickets", "trigger": "ticket.created",
         "method": "POST", "url": "https://hooks.slack.com/services/T00000/B00000/XXXX",
         "headers": {"Content-Type": "application/json"}, "payload_template": '{"text":"New ticket: {{title}} - Priority: {{priority}}"}',
         "status": "active", "trigger_count": random.randint(50, 200), "last_triggered": "2026-02-10T08:30:00Z",
         "created_at": "2026-01-01T00:00:00Z", "created_by": "Admin", "filters": {"priority": ["critical", "high"]},
         "retry_count": 3, "retry_delay": 30, "log": []},
        {"id": f"WH-{uuid.uuid4().hex[:6].upper()}", "name": "Teams - Device Alerts", "trigger": "device.offline",
         "method": "POST", "url": "https://outlook.office.com/webhook/xxxx",
         "headers": {"Content-Type": "application/json"}, "payload_template": '{"text":"Device offline: {{hostname}} ({{client}})"}',
         "status": "active", "trigger_count": random.randint(20, 80), "last_triggered": "2026-02-09T15:20:00Z",
         "created_at": "2026-01-05T00:00:00Z", "created_by": "Admin", "filters": {},
         "retry_count": 3, "retry_delay": 30, "log": []},
        {"id": f"WH-{uuid.uuid4().hex[:6].upper()}", "name": "PagerDuty - SLA Breach", "trigger": "sla.breach",
         "method": "POST", "url": "https://events.pagerduty.com/v2/enqueue",
         "headers": {"Content-Type": "application/json", "Authorization": "Token token=xxxx"},
         "payload_template": '{"routing_key":"xxxx","event_action":"trigger","payload":{"summary":"SLA breach: {{ticket_id}}","severity":"critical"}}',
         "status": "paused", "trigger_count": random.randint(5, 20), "last_triggered": "2026-02-08T12:00:00Z",
         "created_at": "2026-01-10T00:00:00Z", "created_by": "Admin", "filters": {},
         "retry_count": 5, "retry_delay": 60, "log": []},
        {"id": f"WH-{uuid.uuid4().hex[:6].upper()}", "name": "Zapier - Invoice Paid", "trigger": "invoice.paid",
         "method": "POST", "url": "https://hooks.zapier.com/hooks/catch/xxxx/yyyy",
         "headers": {"Content-Type": "application/json"}, "payload_template": '{"invoice_id":"{{invoice_id}}","client":"{{client}}","amount":{{amount}}}',
         "status": "active", "trigger_count": random.randint(30, 100), "last_triggered": "2026-02-10T10:00:00Z",
         "created_at": "2026-01-15T00:00:00Z", "created_by": "Admin", "filters": {},
         "retry_count": 3, "retry_delay": 30, "log": []},
    ]


@router.get("/list")
async def list_webhooks(current_user: dict = Depends(get_current_user)):
    hooks = await db.webhooks.find({}, {"_id": 0}).to_list(100)
    if not hooks:
        hooks = _gen_default_hooks()
        for h in hooks:
            await db.webhooks.insert_one(h)
        hooks = await db.webhooks.find({}, {"_id": 0}).to_list(100)
    return hooks


@router.get("/triggers")
async def get_event_triggers(current_user: dict = Depends(get_current_user)):
    return {"triggers": EVENT_TRIGGERS, "sample_payloads": SAMPLE_PAYLOADS}


@router.post("/create")
async def create_webhook(data: dict, current_user: dict = Depends(get_current_user)):
    hook = {
        "id": f"WH-{uuid.uuid4().hex[:6].upper()}",
        "name": data.get("name", "Untitled Webhook"),
        "trigger": data.get("trigger", "ticket.created"),
        "method": data.get("method", "POST"),
        "url": data.get("url", ""),
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
    return hook


@router.put("/{hook_id}")
async def update_webhook(hook_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in data.items() if k in ["name", "trigger", "method", "url", "headers", "payload_template", "status", "filters", "retry_count", "retry_delay"]}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.webhooks.update_one({"id": hook_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"message": "Updated"}


@router.delete("/{hook_id}")
async def delete_webhook(hook_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.webhooks.delete_one({"id": hook_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}


@router.post("/{hook_id}/toggle")
async def toggle_webhook(hook_id: str, current_user: dict = Depends(get_current_user)):
    hook = await db.webhooks.find_one({"id": hook_id}, {"_id": 0})
    if not hook:
        raise HTTPException(status_code=404, detail="Not found")
    new_status = "paused" if hook["status"] == "active" else "active"
    await db.webhooks.update_one({"id": hook_id}, {"$set": {"status": new_status}})
    return {"status": new_status}


@router.post("/{hook_id}/test")
async def test_webhook(hook_id: str, current_user: dict = Depends(get_current_user)):
    hook = await db.webhooks.find_one({"id": hook_id}, {"_id": 0})
    if not hook:
        raise HTTPException(status_code=404, detail="Not found")
    now = datetime.now(timezone.utc).isoformat()
    test_log = {
        "timestamp": now,
        "type": "test",
        "status_code": 200,
        "response_time_ms": random.randint(50, 300),
        "success": True,
        "message": "Test delivery successful (simulated)",
    }
    await db.webhooks.update_one(
        {"id": hook_id},
        {"$push": {"log": {"$each": [test_log], "$slice": -50}}, "$set": {"last_triggered": now}}
    )
    return test_log


@router.get("/{hook_id}/logs")
async def get_webhook_logs(hook_id: str, current_user: dict = Depends(get_current_user)):
    hook = await db.webhooks.find_one({"id": hook_id}, {"_id": 0, "log": 1, "name": 1})
    if not hook:
        raise HTTPException(status_code=404, detail="Not found")
    return {"name": hook.get("name"), "logs": hook.get("log", [])}
