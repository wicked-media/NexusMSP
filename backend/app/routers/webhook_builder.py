from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random, uuid

router = APIRouter()

@router.get("/webhook-builder/list")
async def list_webhooks(current_user: dict = Depends(get_current_user)):
    hooks = await db.custom_webhooks.find({}, {"_id": 0}).to_list(50)
    if not hooks:
        hooks = await _seed_webhooks()
    return hooks

@router.post("/webhook-builder/create")
async def create_webhook(data: dict, current_user: dict = Depends(get_current_user)):
    hook = {"id": f"wh-{uuid.uuid4().hex[:8]}", **data, "created_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat(), "status": "active", "trigger_count": 0}
    await db.custom_webhooks.insert_one(hook)
    hook.pop("_id", None)
    return hook

async def _seed_webhooks():
    hooks = [
        {"name": "Slack Alert on Critical Ticket", "trigger": "ticket.priority == 'critical'", "url": "https://hooks.slack.com/services/T00/B00/xxx", "method": "POST", "payload_template": '{"text": "Critical ticket: {{ticket.title}} from {{ticket.client}}"}', "status": "active", "trigger_count": 23},
        {"name": "Teams Notification on Device Offline", "trigger": "device.status == 'offline'", "url": "https://outlook.office.com/webhook/xxx", "method": "POST", "payload_template": '{"text": "Device offline: {{device.name}} at {{device.client}}"}', "status": "active", "trigger_count": 45},
        {"name": "PagerDuty Escalation", "trigger": "ticket.sla_breached == true", "url": "https://events.pagerduty.com/v2/enqueue", "method": "POST", "payload_template": '{"routing_key":"xxx","event_action":"trigger"}', "status": "active", "trigger_count": 8},
        {"name": "Custom CRM Sync", "trigger": "client.created OR client.updated", "url": "https://api.crm.example.com/sync", "method": "PUT", "payload_template": '{"client": "{{client.name}}", "devices": {{client.device_count}}}', "status": "paused", "trigger_count": 156},
    ]
    result = []
    for h in hooks:
        wh = {"id": f"wh-{uuid.uuid4().hex[:8]}", **h, "created_by": "Alex Thompson", "created_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(5, 60))).isoformat()}
        result.append(wh)
        await db.custom_webhooks.insert_one(wh)
    return [{k: v for k, v in h.items() if k != "_id"} for h in result]
