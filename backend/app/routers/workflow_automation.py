from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== WORKFLOW AUTOMATION BUILDER ==============

TRIGGER_TYPES = [
    {"id": "ticket_created", "label": "Ticket Created", "category": "tickets", "fields": ["priority", "category", "client_id", "source"]},
    {"id": "ticket_updated", "label": "Ticket Updated", "category": "tickets", "fields": ["priority", "status", "assigned_to"]},
    {"id": "ticket_sla_breach", "label": "SLA Breach", "category": "tickets", "fields": ["breach_type", "client_id"]},
    {"id": "device_offline", "label": "Device Goes Offline", "category": "devices", "fields": ["client_id", "device_type", "duration_minutes"]},
    {"id": "device_warning", "label": "Device Warning", "category": "devices", "fields": ["metric", "threshold", "client_id"]},
    {"id": "backup_failed", "label": "Backup Failed", "category": "backups", "fields": ["client_id", "backup_type"]},
    {"id": "alert_triggered", "label": "Alert Triggered", "category": "monitoring", "fields": ["severity", "alert_type", "device_id"]},
    {"id": "client_health_change", "label": "Client Health Changed", "category": "clients", "fields": ["health_status", "client_id"]},
    {"id": "invoice_overdue", "label": "Invoice Overdue", "category": "billing", "fields": ["days_overdue", "amount_threshold"]},
    {"id": "schedule", "label": "Scheduled (Cron)", "category": "system", "fields": ["cron_expression", "timezone"]},
    {"id": "patch_available", "label": "Critical Patch Available", "category": "patching", "fields": ["severity", "os_type"]},
    {"id": "new_client", "label": "New Client Added", "category": "clients", "fields": []},
]

ACTION_TYPES = [
    {"id": "assign_ticket", "label": "Assign Ticket", "category": "tickets", "fields": ["assign_to", "assign_method"]},
    {"id": "change_priority", "label": "Change Priority", "category": "tickets", "fields": ["new_priority"]},
    {"id": "add_note", "label": "Add Internal Note", "category": "tickets", "fields": ["note_text"]},
    {"id": "send_email", "label": "Send Email", "category": "communication", "fields": ["to", "subject", "template"]},
    {"id": "send_slack", "label": "Send Slack Message", "category": "communication", "fields": ["channel", "message"]},
    {"id": "send_teams", "label": "Send Teams Message", "category": "communication", "fields": ["channel", "message"]},
    {"id": "create_ticket", "label": "Create Ticket", "category": "tickets", "fields": ["title", "priority", "category", "assign_to"]},
    {"id": "escalate", "label": "Escalate", "category": "tickets", "fields": ["escalation_level", "notify"]},
    {"id": "run_script", "label": "Run Script on Device", "category": "automation", "fields": ["script_id", "target_devices"]},
    {"id": "webhook", "label": "Call Webhook", "category": "automation", "fields": ["url", "method", "payload"]},
    {"id": "tag_device", "label": "Tag Device", "category": "devices", "fields": ["tags"]},
    {"id": "reboot_device", "label": "Reboot Device", "category": "devices", "fields": ["delay_minutes"]},
    {"id": "wait", "label": "Wait / Delay", "category": "flow", "fields": ["duration_minutes"]},
    {"id": "condition", "label": "If / Condition", "category": "flow", "fields": ["field", "operator", "value"]},
]

CONDITION_OPERATORS = ["equals", "not_equals", "contains", "greater_than", "less_than", "is_empty", "is_not_empty"]


@router.get("/workflows")
async def get_workflows(current_user: dict = Depends(get_current_user)):
    workflows = await db.workflows.find({}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    return workflows


@router.get("/workflows/triggers")
async def get_workflow_triggers(current_user: dict = Depends(get_current_user)):
    return TRIGGER_TYPES


@router.get("/workflows/actions")
async def get_workflow_actions(current_user: dict = Depends(get_current_user)):
    return ACTION_TYPES


@router.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: str, current_user: dict = Depends(get_current_user)):
    wf = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return wf


@router.post("/workflows")
async def create_workflow(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    workflow = {
        "id": f"wf-{uuid.uuid4().hex[:8]}",
        "name": data.get("name", "Untitled Workflow"),
        "description": data.get("description", ""),
        "enabled": data.get("enabled", False),
        "trigger": data.get("trigger", {}),
        "conditions": data.get("conditions", []),
        "actions": data.get("actions", []),
        "nodes": data.get("nodes", []),
        "edges": data.get("edges", []),
        "execution_count": 0,
        "last_executed": None,
        "created_by": current_user.get("name", ""),
        "created_at": now,
        "updated_at": now,
    }
    await db.workflows.insert_one(workflow)
    return {k: v for k, v in workflow.items() if k != "_id"}


@router.put("/workflows/{workflow_id}")
async def update_workflow(workflow_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    wf = await db.workflows.find_one({"id": workflow_id})
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    update = {k: v for k, v in data.items() if k not in ("id", "_id", "created_at", "created_by")}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.workflows.update_one({"id": workflow_id}, {"$set": update})
    return {"message": "Workflow updated"}


@router.delete("/workflows/{workflow_id}")
async def delete_workflow(workflow_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.workflows.delete_one({"id": workflow_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"message": "Workflow deleted"}


@router.post("/workflows/{workflow_id}/toggle")
async def toggle_workflow(workflow_id: str, current_user: dict = Depends(get_current_user)):
    wf = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    new_state = not wf.get("enabled", False)
    await db.workflows.update_one({"id": workflow_id}, {"$set": {"enabled": new_state, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"enabled": new_state}


@router.post("/workflows/{workflow_id}/test")
async def test_workflow(workflow_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    wf = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    # Simulate execution
    actions = wf.get("actions", [])
    results = []
    for action in actions:
        results.append({
            "action": action.get("type", "unknown"),
            "status": "simulated",
            "message": f"Would execute: {action.get('type', 'unknown')} with config {action.get('config', {})}",
        })
    log = {
        "id": f"wflog-{uuid.uuid4().hex[:8]}",
        "workflow_id": workflow_id,
        "status": "test_completed",
        "trigger_data": data.get("test_data", {}),
        "results": results,
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "executed_by": current_user.get("name", ""),
        "is_test": True,
    }
    await db.workflow_logs.insert_one(log)
    await db.workflows.update_one({"id": workflow_id}, {"$inc": {"execution_count": 1}, "$set": {"last_executed": log["executed_at"]}})
    return {"status": "test_completed", "results": results, "log_id": log["id"]}


@router.get("/workflows/{workflow_id}/logs")
async def get_workflow_logs(workflow_id: str, current_user: dict = Depends(get_current_user)):
    logs = await db.workflow_logs.find({"workflow_id": workflow_id}, {"_id": 0}).sort("executed_at", -1).to_list(50)
    return logs


@router.get("/workflows/stats/overview")
async def get_workflow_stats(current_user: dict = Depends(get_current_user)):
    all_wf = await db.workflows.find({}, {"_id": 0}).to_list(500)
    total = len(all_wf)
    active = len([w for w in all_wf if w.get("enabled")])
    total_executions = sum(w.get("execution_count", 0) for w in all_wf)
    return {"total": total, "active": active, "inactive": total - active, "total_executions": total_executions}
