from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/automation")
async def get_runbooks(current_user: dict = Depends(get_current_user)):
    """Get all runbooks."""
    runbooks = await db.runbooks.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return runbooks


@router.get("/automation/logs")
async def get_runbook_logs(current_user: dict = Depends(get_current_user)):
    """Get runbook execution logs."""
    logs = await db.runbook_logs.find({}, {"_id": 0}).sort("executed_at", -1).to_list(100)
    return logs


@router.get("/automation/templates")
async def get_runbook_templates(current_user: dict = Depends(get_current_user)):
    """Get pre-built runbook templates."""
    return [
        {
            "name": "Disk Space Alert",
            "description": "Create ticket when disk usage > 90%",
            "trigger": {"type": "device_metric", "metric": "disk_usage", "operator": "gt", "value": 90},
            "conditions": [{"field": "device_type", "operator": "in", "value": ["server", "workstation"]}],
            "actions": [
                {"type": "create_ticket", "target": "auto", "params": {"priority": "high", "category": "hardware", "title_template": "Disk Space Critical: {device_name}"}},
                {"type": "assign_oncall", "target": "auto"},
                {"type": "email_client", "target": "auto", "params": {"template": "disk_alert"}},
            ]
        },
        {
            "name": "SLA Breach Prevention",
            "description": "Escalate ticket 30 min before SLA breach",
            "trigger": {"type": "sla_countdown", "minutes_before": 30},
            "conditions": [{"field": "priority", "operator": "in", "value": ["critical", "high"]}],
            "actions": [
                {"type": "escalate_ticket", "target": "auto"},
                {"type": "ping_technician", "target": "assigned"},
                {"type": "notify_manager", "target": "auto"},
            ]
        },
        {
            "name": "New Device Auto-Setup",
            "description": "Auto-configure monitoring when device is added",
            "trigger": {"type": "device_created"},
            "conditions": [],
            "actions": [
                {"type": "enable_monitoring", "target": "device"},
                {"type": "run_scan", "target": "device"},
                {"type": "create_ticket", "target": "auto", "params": {"title_template": "New Device Setup: {device_name}", "priority": "low"}},
            ]
        },
        {
            "name": "Client Onboarding Follow-Up",
            "description": "Send welcome email 24h after onboarding",
            "trigger": {"type": "onboarding_completed", "delay_hours": 24},
            "conditions": [],
            "actions": [
                {"type": "email_client", "target": "auto", "params": {"template": "welcome"}},
                {"type": "create_ticket", "target": "auto", "params": {"title_template": "30-day check-in: {client_name}", "priority": "low"}},
            ]
        },
        {
            "name": "Device Offline Alert",
            "description": "Alert when device goes offline for > 15 min",
            "trigger": {"type": "device_offline", "duration_minutes": 15},
            "conditions": [{"field": "monitoring_enabled", "operator": "eq", "value": True}],
            "actions": [
                {"type": "create_ticket", "target": "auto", "params": {"priority": "high", "title_template": "Device Offline: {device_name}"}},
                {"type": "ping_technician", "target": "oncall"},
            ]
        },
        {
            "name": "Failed Backup Escalation",
            "description": "Open and escalate a ticket when a protected device misses a backup",
            "trigger": {"type": "backup_failed"},
            "conditions": [{"field": "backup_protected", "operator": "eq", "value": True}],
            "actions": [
                {"type": "create_ticket", "target": "auto", "params": {"priority": "high", "category": "backup", "title_template": "Backup failed: {device_name}"}},
                {"type": "assign_oncall", "target": "auto"},
                {"type": "notify_manager", "target": "auto"},
            ]
        },
        {
            "name": "Defender Health Recovery",
            "description": "Attempt a safe remediation, then create a security ticket for a Defender health alert",
            "trigger": {"type": "security_alert", "provider": "microsoft_defender"},
            "conditions": [{"field": "severity", "operator": "in", "value": ["medium", "high", "critical"]}],
            "actions": [
                {"type": "run_script", "target": "device", "params": {"script_name": "Test-DefenderHealth"}},
                {"type": "create_ticket", "target": "auto", "params": {"priority": "high", "category": "security", "title_template": "Defender health review: {device_name}"}},
                {"type": "notify_manager", "target": "auto"},
            ]
        },
        {
            "name": "Patch Window Follow-Up",
            "description": "Record a maintenance task and review ticket when a device misses its approved patch window",
            "trigger": {"type": "patch_window_missed"},
            "conditions": [{"field": "patching_enabled", "operator": "eq", "value": True}],
            "actions": [
                {"type": "create_ticket", "target": "auto", "params": {"priority": "medium", "category": "maintenance", "title_template": "Patch follow-up: {device_name}"}},
                {"type": "assign_oncall", "target": "auto"},
                {"type": "add_note", "target": "ticket", "params": {"note_template": "Confirm patch status and select the next approved maintenance window."}},
            ]
        },
        {
            "name": "Critical Service Recovery",
            "description": "Restart a monitored service, record the outcome, and escalate if technician review is needed",
            "trigger": {"type": "service_stopped"},
            "conditions": [{"field": "service_critical", "operator": "eq", "value": True}],
            "actions": [
                {"type": "run_script", "target": "device", "params": {"script_name": "Restart-CriticalService"}},
                {"type": "create_ticket", "target": "auto", "params": {"priority": "high", "category": "monitoring", "title_template": "Service recovery review: {device_name}"}},
                {"type": "ping_technician", "target": "oncall"},
            ]
        },
        {
            "name": "VIP Ticket Acknowledgement",
            "description": "Prioritise and acknowledge a new request from a VIP contact",
            "trigger": {"type": "ticket_created"},
            "conditions": [{"field": "contact_vip", "operator": "eq", "value": True}],
            "actions": [
                {"type": "escalate_ticket", "target": "ticket"},
                {"type": "assign_oncall", "target": "auto"},
                {"type": "email_client", "target": "contact", "params": {"template": "vip_acknowledgement"}},
            ]
        },
    ]


@router.post("/automation")
async def create_runbook(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a new automation runbook."""
    runbook_id = str(uuid.uuid4())[:8]
    doc = {
        "id": runbook_id,
        "name": data.get("name", "Untitled Runbook"),
        "description": data.get("description", ""),
        "trigger": data.get("trigger", {}),
        "conditions": data.get("conditions", []),
        "actions": data.get("actions", []),
        "enabled": data.get("enabled", True),
        "run_count": 0,
        "last_run": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
    }
    await db.runbooks.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/automation/{runbook_id}")
async def update_runbook(runbook_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update a runbook."""
    updates = {}
    for key in ["name", "description", "trigger", "conditions", "actions", "enabled"]:
        if key in data:
            updates[key] = data[key]
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.runbooks.update_one({"id": runbook_id}, {"$set": updates})
    return await db.runbooks.find_one({"id": runbook_id}, {"_id": 0})


@router.delete("/automation/{runbook_id}")
async def delete_runbook(runbook_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a runbook."""
    await db.runbooks.delete_one({"id": runbook_id})
    return {"message": "Deleted"}


@router.post("/automation/{runbook_id}/test")
async def test_runbook(runbook_id: str, current_user: dict = Depends(get_current_user)):
    """Test/simulate a runbook execution."""
    rb = await db.runbooks.find_one({"id": runbook_id}, {"_id": 0})
    if not rb:
        return {"error": "Runbook not found"}

    trigger = rb.get("trigger", {})
    actions = rb.get("actions", [])

    # Simulate execution
    results = []
    for action in actions:
        atype = action.get("type", "")
        results.append({
            "action": atype,
            "target": action.get("target", ""),
            "status": "simulated",
            "message": f"Would execute: {atype} on {action.get('target', 'N/A')}",
        })

    # Log execution
    log = {
        "id": str(uuid.uuid4())[:8],
        "runbook_id": runbook_id,
        "runbook_name": rb.get("name", ""),
        "trigger": trigger,
        "results": results,
        "status": "simulated",
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "executed_by": current_user.get("name", ""),
    }
    await db.runbook_logs.insert_one(log)
    log.pop("_id", None)

    await db.runbooks.update_one({"id": runbook_id}, {
        "$set": {"last_run": datetime.now(timezone.utc).isoformat()},
        "$inc": {"run_count": 1}
    })

    return {"execution": log}
