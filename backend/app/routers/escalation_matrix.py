from fastapi import APIRouter, Depends, Body
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone, timedelta
import uuid

router = APIRouter(prefix="/escalation-matrix", tags=["Escalation Matrix"])

@router.get("/rules")
async def get_escalation_rules(user=Depends(get_current_user)):
    rules = await db.escalation_rules.find({}, {"_id": 0}).sort("priority_order", 1).to_list(100)
    if not rules:
        defaults = [
            {"id": "esc-001", "name": "Critical SLA Breach", "trigger": "sla_breach", "priority": "critical", "time_threshold_minutes": 30, "escalate_to": "Service Manager", "notification": "email_sms", "enabled": True, "priority_order": 1},
            {"id": "esc-002", "name": "High Priority Unassigned", "trigger": "unassigned", "priority": "high", "time_threshold_minutes": 60, "escalate_to": "Senior Engineer", "notification": "email", "enabled": True, "priority_order": 2},
            {"id": "esc-003", "name": "Stale Ticket (No Update 4h)", "trigger": "no_update", "priority": "any", "time_threshold_minutes": 240, "escalate_to": "Team Lead", "notification": "email", "enabled": True, "priority_order": 3},
            {"id": "esc-004", "name": "VIP Client Escalation", "trigger": "vip_client", "priority": "any", "time_threshold_minutes": 15, "escalate_to": "Service Manager", "notification": "email_sms", "enabled": True, "priority_order": 4},
            {"id": "esc-005", "name": "Multiple Reopens", "trigger": "reopen_count", "priority": "any", "time_threshold_minutes": 0, "reopen_threshold": 3, "escalate_to": "Senior Engineer", "notification": "email", "enabled": True, "priority_order": 5},
        ]
        for r in defaults:
            r["created_at"] = datetime.now(timezone.utc).isoformat()
            await db.escalation_rules.insert_one(r)
        rules = defaults
    return rules

@router.post("/rules")
async def create_escalation_rule(payload: dict = Body(...), user=Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4())[:8],
        **payload,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user.get("name"),
    }
    await db.escalation_rules.insert_one(doc)
    return doc

@router.put("/rules/{rule_id}")
async def update_rule(rule_id: str, payload: dict = Body(...), user=Depends(get_current_user)):
    await db.escalation_rules.update_one({"id": rule_id}, {"$set": payload})
    return {"message": "Rule updated"}

@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, user=Depends(get_current_user)):
    await db.escalation_rules.delete_one({"id": rule_id})
    return {"message": "Rule deleted"}

@router.get("/log")
async def get_escalation_log(user=Depends(get_current_user)):
    logs = await db.escalation_log.find({}, {"_id": 0}).sort("escalated_at", -1).to_list(100)
    return logs

@router.post("/check")
async def check_escalations(user=Depends(get_current_user)):
    rules = await db.escalation_rules.find({"enabled": True}, {"_id": 0}).to_list(50)
    tickets = await db.tickets.find({"status": {"$in": ["open", "in_progress"]}}, {"_id": 0}).to_list(500)
    now = datetime.now(timezone.utc)
    escalated = 0
    
    for ticket in tickets:
        for rule in rules:
            should_escalate = False
            if rule["trigger"] == "sla_breach" and ticket.get("sla_due"):
                try:
                    sla = datetime.fromisoformat(ticket["sla_due"].replace("Z", "+00:00")) if isinstance(ticket["sla_due"], str) else ticket["sla_due"]
                    if now > sla:
                        should_escalate = True
                except (ValueError, TypeError):
                    pass
            elif rule["trigger"] == "unassigned" and not ticket.get("assigned_to"):
                created = datetime.fromisoformat(ticket.get("created_at", now.isoformat()).replace("Z", "+00:00")) if isinstance(ticket.get("created_at"), str) else ticket.get("created_at", now)
                if (now - created).total_seconds() > rule.get("time_threshold_minutes", 60) * 60:
                    should_escalate = True
            
            if should_escalate:
                log_entry = {
                    "id": str(uuid.uuid4())[:8],
                    "ticket_id": ticket["id"], "ticket_title": ticket.get("title", ""),
                    "client_name": ticket.get("client_name", ""),
                    "rule_name": rule["name"], "escalate_to": rule["escalate_to"],
                    "reason": f"Triggered by: {rule['name']}",
                    "escalated_at": now.isoformat(),
                }
                await db.escalation_log.insert_one(log_entry)
                escalated += 1
    
    return {"escalated": escalated, "checked_tickets": len(tickets)}
