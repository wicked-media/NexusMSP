from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid

router = APIRouter()

@router.get("/script-ticket/scripts")
async def get_script_integrations(current_user: dict = Depends(get_current_user)):
    scripts = await db.script_ticket_integrations.find({}, {"_id": 0}).to_list(100)
    if not scripts:
        scripts = await _seed_scripts()
    return scripts

@router.post("/script-ticket/scripts")
async def create_script_integration(data: dict, current_user: dict = Depends(get_current_user)):
    script = {**data, "id": f"st-{uuid.uuid4().hex[:8]}", "created_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat(), "executions": 0, "enabled": True}
    await db.script_ticket_integrations.insert_one(script)
    script.pop("_id", None)
    return script

@router.get("/script-ticket/executions")
async def get_script_executions(current_user: dict = Depends(get_current_user)):
    execs = await db.script_ticket_executions.find({}, {"_id": 0}).sort("executed_at", -1).to_list(50)
    return execs

async def _seed_scripts():
    now = datetime.now(timezone.utc)
    scripts = [
        {"id": "st-001", "name": "Disk Space Alert → Ticket", "description": "When disk usage exceeds 90%, auto-create a P2 ticket with device details and disk info", "trigger": "disk_space_alert", "action": "create_ticket", "ticket_priority": "P2", "ticket_type": "incident", "script_content": "if ($diskUsage -gt 90) { New-NexusOpsTicket -Priority P2 -Subject \"Disk Space Critical on $hostname\" }", "enabled": True, "executions": 47, "created_by": "Alex Thompson", "created_at": (now - timedelta(days=60)).isoformat()},
        {"id": "st-002", "name": "Backup Failure → P1 Ticket", "description": "Auto-create P1 ticket when backup job fails for 2+ consecutive runs", "trigger": "backup_failed_consecutive", "action": "create_ticket", "ticket_priority": "P1", "ticket_type": "incident", "script_content": "if ($backupFailCount -ge 2) { New-NexusOpsTicket -Priority P1 -Subject \"Backup Failed x$backupFailCount on $hostname\" }", "enabled": True, "executions": 12, "created_by": "Sarah Chen", "created_at": (now - timedelta(days=45)).isoformat()},
        {"id": "st-003", "name": "Patch Complete → Close Ticket", "description": "Auto-close patch maintenance tickets after successful patching", "trigger": "patch_complete", "action": "close_ticket", "script_content": "Close-NexusOpsTicket -TicketId $ticketId -Resolution \"Patches applied successfully\" -TimeSpent 30", "enabled": True, "executions": 89, "created_by": "Mike Rodriguez", "created_at": (now - timedelta(days=30)).isoformat()},
        {"id": "st-004", "name": "Service Down → Create + Assign", "description": "Create ticket and auto-assign to on-call tech when critical service stops", "trigger": "service_stopped", "action": "create_and_assign_ticket", "ticket_priority": "P1", "ticket_type": "incident", "script_content": "New-NexusOpsTicket -Priority P1 -Subject \"Service $serviceName stopped on $hostname\" -AssignTo $onCallTech", "enabled": True, "executions": 23, "created_by": "Alex Thompson", "created_at": (now - timedelta(days=20)).isoformat()},
    ]
    for s in scripts:
        await db.script_ticket_integrations.insert_one(s)
    return [dict((k, v) for k, v in s.items() if k != "_id") for s in scripts]
