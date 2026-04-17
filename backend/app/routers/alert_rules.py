from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

METRIC_OPTIONS = [
    {"id": "cpu_usage", "label": "CPU Usage (%)", "unit": "%"},
    {"id": "memory_usage", "label": "Memory Usage (%)", "unit": "%"},
    {"id": "disk_usage", "label": "Disk Usage (%)", "unit": "%"},
    {"id": "disk_free_gb", "label": "Free Disk Space (GB)", "unit": "GB"},
    {"id": "cpu_temp", "label": "CPU Temperature (°C)", "unit": "°C"},
    {"id": "uptime_hours", "label": "Uptime (hours)", "unit": "h"},
    {"id": "offline_minutes", "label": "Offline Duration (min)", "unit": "min"},
    {"id": "backup_failed", "label": "Backup Failure", "unit": "bool"},
    {"id": "smart_status", "label": "SMART Disk Health", "unit": "status"},
    {"id": "pending_patches", "label": "Pending Patches (count)", "unit": "count"},
    {"id": "antivirus_outdated", "label": "Antivirus Outdated", "unit": "bool"},
]

OPERATORS = ["greater_than", "less_than", "equals", "not_equals", "greater_or_equal", "less_or_equal"]

ACTION_OPTIONS = [
    {"id": "create_ticket", "label": "Create Ticket", "fields": ["priority", "category", "assign_to"]},
    {"id": "send_email", "label": "Send Email Alert", "fields": ["recipients"]},
    {"id": "send_slack", "label": "Send Slack Notification", "fields": ["channel"]},
    {"id": "run_script", "label": "Run Remediation Script", "fields": ["script_id"]},
    {"id": "reboot_device", "label": "Reboot Device", "fields": ["delay_minutes"]},
    {"id": "suppress_30m", "label": "Suppress for 30 min", "fields": []},
]


@router.get("/alert-rules")
async def get_alert_rules(current_user: dict = Depends(get_current_user)):
    rules = await db.alert_rules.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    if not rules:
        rules = await _seed_rules()
    return rules


@router.get("/alert-rules/options")
async def get_alert_rule_options(current_user: dict = Depends(get_current_user)):
    return {"metrics": METRIC_OPTIONS, "operators": OPERATORS, "actions": ACTION_OPTIONS}


@router.get("/alert-rules/stats")
async def get_alert_rules_stats(current_user: dict = Depends(get_current_user)):
    rules = await db.alert_rules.find({}, {"_id": 0}).to_list(200)
    total = len(rules)
    active = len([r for r in rules if r.get("enabled")])
    total_triggered = sum(r.get("trigger_count", 0) for r in rules)
    return {"total": total, "active": active, "total_triggered": total_triggered}


@router.post("/alert-rules")
async def create_alert_rule(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    rule = {
        "id": f"ar-{uuid.uuid4().hex[:8]}",
        "name": data.get("name", ""),
        "description": data.get("description", ""),
        "metric": data.get("metric", "cpu_usage"),
        "operator": data.get("operator", "greater_than"),
        "threshold": data.get("threshold", 90),
        "duration_minutes": data.get("duration_minutes", 5),
        "scope": data.get("scope", "all"),
        "scope_filter": data.get("scope_filter", {}),
        "actions": data.get("actions", []),
        "severity": data.get("severity", "high"),
        "enabled": data.get("enabled", True),
        "cooldown_minutes": data.get("cooldown_minutes", 30),
        "trigger_count": 0,
        "last_triggered": None,
        "created_by": current_user.get("name", ""),
        "created_at": now,
        "updated_at": now,
    }
    await db.alert_rules.insert_one(rule)
    return {k: v for k, v in rule.items() if k != "_id"}


@router.put("/alert-rules/{rule_id}")
async def update_alert_rule(rule_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    r = await db.alert_rules.find_one({"id": rule_id})
    if not r:
        raise HTTPException(status_code=404, detail="Rule not found")
    update = {k: v for k, v in data.items() if k not in ("id", "_id", "created_at")}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.alert_rules.update_one({"id": rule_id}, {"$set": update})
    return {"message": "Rule updated"}


@router.delete("/alert-rules/{rule_id}")
async def delete_alert_rule(rule_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.alert_rules.delete_one({"id": rule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}


@router.post("/alert-rules/{rule_id}/toggle")
async def toggle_alert_rule(rule_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.alert_rules.find_one({"id": rule_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    new_state = not r.get("enabled", False)
    await db.alert_rules.update_one({"id": rule_id}, {"$set": {"enabled": new_state}})
    return {"enabled": new_state}


async def _seed_rules():
    rules = [
        {"id": "ar-001", "name": "CPU Critical - Servers", "description": "Alert when any server CPU exceeds 90% for 5 minutes", "metric": "cpu_usage", "operator": "greater_than", "threshold": 90, "duration_minutes": 5, "scope": "device_type", "scope_filter": {"device_type": "server"}, "actions": [{"type": "create_ticket", "config": {"priority": "critical", "category": "infrastructure"}}, {"type": "send_email", "config": {"recipients": "noc@company.com"}}], "severity": "critical", "enabled": True, "cooldown_minutes": 30, "trigger_count": 12, "last_triggered": "2026-04-15T10:00:00Z", "created_by": "System", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-04-15T10:00:00Z"},
        {"id": "ar-002", "name": "Disk Space Low", "description": "Alert when disk usage exceeds 85%", "metric": "disk_usage", "operator": "greater_than", "threshold": 85, "duration_minutes": 0, "scope": "all", "scope_filter": {}, "actions": [{"type": "create_ticket", "config": {"priority": "high", "category": "infrastructure"}}], "severity": "high", "enabled": True, "cooldown_minutes": 60, "trigger_count": 8, "last_triggered": "2026-04-14T08:00:00Z", "created_by": "System", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-04-14T08:00:00Z"},
        {"id": "ar-003", "name": "Device Offline > 10min", "description": "Create ticket when any device is offline for more than 10 minutes", "metric": "offline_minutes", "operator": "greater_than", "threshold": 10, "duration_minutes": 0, "scope": "all", "scope_filter": {}, "actions": [{"type": "create_ticket", "config": {"priority": "high"}}, {"type": "send_email", "config": {"recipients": "alerts@company.com"}}], "severity": "high", "enabled": True, "cooldown_minutes": 15, "trigger_count": 24, "last_triggered": "2026-04-16T06:00:00Z", "created_by": "System", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-04-16T06:00:00Z"},
        {"id": "ar-004", "name": "Backup Failure Alert", "description": "Immediate alert on any backup failure", "metric": "backup_failed", "operator": "equals", "threshold": 1, "duration_minutes": 0, "scope": "all", "scope_filter": {}, "actions": [{"type": "create_ticket", "config": {"priority": "critical", "category": "backup"}}, {"type": "send_email", "config": {"recipients": "noc@company.com"}}], "severity": "critical", "enabled": True, "cooldown_minutes": 0, "trigger_count": 5, "last_triggered": "2026-04-13T22:00:00Z", "created_by": "System", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-04-13T22:00:00Z"},
        {"id": "ar-005", "name": "Memory Warning", "description": "Alert when RAM usage exceeds 85% for 10 minutes", "metric": "memory_usage", "operator": "greater_than", "threshold": 85, "duration_minutes": 10, "scope": "all", "scope_filter": {}, "actions": [{"type": "create_ticket", "config": {"priority": "medium"}}], "severity": "medium", "enabled": True, "cooldown_minutes": 60, "trigger_count": 3, "last_triggered": "2026-04-12T14:00:00Z", "created_by": "System", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-04-12T14:00:00Z"},
    ]
    await db.alert_rules.delete_many({})
    for r in rules:
        await db.alert_rules.insert_one(r)
    return [{k: v for k, v in r.items() if k != "_id"} for r in rules]
