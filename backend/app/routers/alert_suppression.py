from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid

router = APIRouter()

@router.get("/alert-suppression/rules")
async def get_suppression_rules(current_user: dict = Depends(get_current_user)):
    rules = await db.alert_suppression_rules.find({}, {"_id": 0}).to_list(200)
    if not rules:
        rules = await _seed_rules()
    return rules

@router.post("/alert-suppression/rules")
async def create_rule(data: dict, current_user: dict = Depends(get_current_user)):
    rule = {**data, "id": f"asr-{uuid.uuid4().hex[:8]}", "created_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat(), "suppressed_count": 0, "enabled": True}
    await db.alert_suppression_rules.insert_one(rule)
    rule.pop("_id", None)
    return rule

@router.put("/alert-suppression/rules/{rule_id}")
async def update_rule(rule_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.alert_suppression_rules.update_one({"id": rule_id}, {"$set": data})
    return {"status": "updated"}

@router.delete("/alert-suppression/rules/{rule_id}")
async def delete_rule(rule_id: str, current_user: dict = Depends(get_current_user)):
    await db.alert_suppression_rules.delete_one({"id": rule_id})
    return {"status": "deleted"}

@router.get("/alert-suppression/stats")
async def get_suppression_stats(current_user: dict = Depends(get_current_user)):
    rules = await db.alert_suppression_rules.find({}, {"_id": 0}).to_list(200)
    total_suppressed = sum(r.get("suppressed_count", 0) for r in rules)
    active_rules = sum(1 for r in rules if r.get("enabled"))
    return {"total_rules": len(rules), "active_rules": active_rules, "total_suppressed": total_suppressed, "estimated_time_saved_hours": round(total_suppressed * 0.15, 1)}

async def _seed_rules():
    now = datetime.now(timezone.utc)
    rules = [
        {"id": "asr-001", "name": "Suppress Agent Check-in Noise", "description": "Suppress repetitive agent check-in alerts during business hours", "match_type": "alert_type", "match_value": "agent_check_in", "scope": "all", "enabled": True, "suppressed_count": 1847, "created_by": "Alex Thompson", "created_at": (now - timedelta(days=60)).isoformat()},
        {"id": "asr-002", "name": "Ignore Print Spooler Restarts", "description": "Print spooler service restarts are expected on workstations", "match_type": "message_contains", "match_value": "Spooler", "scope": "workstations", "enabled": True, "suppressed_count": 342, "created_by": "Alex Thompson", "created_at": (now - timedelta(days=45)).isoformat()},
        {"id": "asr-003", "name": "Maintenance Window - Servers", "description": "Suppress all alerts during Sunday 2-6AM maintenance window", "match_type": "schedule", "match_value": "Sunday 02:00-06:00", "scope": "servers", "enabled": True, "suppressed_count": 156, "created_by": "Sarah Chen", "created_at": (now - timedelta(days=30)).isoformat()},
        {"id": "asr-004", "name": "Known CrowdStrike False Positive", "description": "CrowdStrike flagging internal monitoring tool as suspicious", "match_type": "message_contains", "match_value": "prometheus_node_exporter", "scope": "client-002", "enabled": True, "suppressed_count": 89, "created_by": "Mike Rodriguez", "created_at": (now - timedelta(days=15)).isoformat()},
        {"id": "asr-005", "name": "Group: Disk Space Warnings < 80%", "description": "Only alert when disk usage exceeds 80%, suppress lower warnings", "match_type": "threshold", "match_value": "disk_usage < 80", "scope": "all", "enabled": True, "suppressed_count": 2341, "created_by": "Alex Thompson", "created_at": (now - timedelta(days=90)).isoformat()},
        {"id": "asr-006", "name": "VPN Reconnect Events", "description": "Suppress VPN disconnect/reconnect within 5 minutes", "match_type": "dedup_window", "match_value": "vpn_disconnect:300s", "scope": "all", "enabled": False, "suppressed_count": 67, "created_by": "Sarah Chen", "created_at": (now - timedelta(days=10)).isoformat()},
    ]
    for r in rules:
        await db.alert_suppression_rules.insert_one(r)
    return [dict((k, v) for k, v in r.items() if k != "_id") for r in rules]
