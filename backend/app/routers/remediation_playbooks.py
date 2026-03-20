from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid

router = APIRouter()

@router.get("/remediation-playbooks/list")
async def get_playbooks(current_user: dict = Depends(get_current_user)):
    playbooks = await db.remediation_playbooks.find({}, {"_id": 0}).to_list(100)
    if not playbooks:
        playbooks = await _seed_playbooks()
    return playbooks

@router.post("/remediation-playbooks/create")
async def create_playbook(data: dict, current_user: dict = Depends(get_current_user)):
    pb = {**data, "id": f"pb-{uuid.uuid4().hex[:8]}", "created_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat(), "executions": 0, "enabled": True}
    await db.remediation_playbooks.insert_one(pb)
    pb.pop("_id", None)
    return pb

@router.post("/remediation-playbooks/{playbook_id}/execute")
async def execute_playbook(playbook_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    await db.remediation_playbooks.update_one({"id": playbook_id}, {"$inc": {"executions": 1}, "$set": {"last_executed": datetime.now(timezone.utc).isoformat()}})
    execution = {"id": f"exec-{uuid.uuid4().hex[:8]}", "playbook_id": playbook_id, "triggered_by": current_user.get("name"), "device_id": data.get("device_id"), "status": "running", "started_at": datetime.now(timezone.utc).isoformat(), "steps_completed": []}
    await db.playbook_executions.insert_one(execution)
    execution.pop("_id", None)
    return execution

@router.get("/remediation-playbooks/executions")
async def get_executions(current_user: dict = Depends(get_current_user)):
    return await db.playbook_executions.find({}, {"_id": 0}).sort("started_at", -1).to_list(50)

async def _seed_playbooks():
    now = datetime.now(timezone.utc)
    playbooks = [
        {"id": "pb-001", "name": "Ransomware Response", "description": "Auto-isolate endpoint, create P1 ticket, notify SOC, collect forensic data", "trigger": "canary_file_triggered", "severity": "critical", "enabled": True, "steps": [{"order": 1, "action": "isolate_endpoint", "description": "Network isolate the affected device"}, {"order": 2, "action": "create_ticket", "description": "Create P1 critical ticket"}, {"order": 3, "action": "notify_soc", "description": "Send alert to SOC team via Slack/Teams"}, {"order": 4, "action": "collect_forensics", "description": "Capture memory dump and event logs"}, {"order": 5, "action": "disable_user", "description": "Disable compromised user account"}], "executions": 3, "last_executed": (now - timedelta(hours=1)).isoformat(), "created_by": "Alex Thompson", "created_at": (now - timedelta(days=60)).isoformat()},
        {"id": "pb-002", "name": "Compromised Account Response", "description": "Reset password, revoke sessions, enable MFA, create ticket", "trigger": "identity_threat_bec", "severity": "high", "enabled": True, "steps": [{"order": 1, "action": "reset_password", "description": "Force password reset"}, {"order": 2, "action": "revoke_sessions", "description": "Revoke all active sessions"}, {"order": 3, "action": "enforce_mfa", "description": "Require MFA re-enrollment"}, {"order": 4, "action": "create_ticket", "description": "Create incident ticket"}, {"order": 5, "action": "audit_mailbox", "description": "Check for unauthorized inbox rules"}], "executions": 7, "last_executed": (now - timedelta(hours=5)).isoformat(), "created_by": "Sarah Chen", "created_at": (now - timedelta(days=45)).isoformat()},
        {"id": "pb-003", "name": "Malware Cleanup", "description": "Quarantine threat, run full scan, verify clean, update ticket", "trigger": "malware_detected", "severity": "high", "enabled": True, "steps": [{"order": 1, "action": "quarantine", "description": "Quarantine detected malware"}, {"order": 2, "action": "full_scan", "description": "Run full AV scan"}, {"order": 3, "action": "verify_clean", "description": "Verify no persistence mechanisms remain"}, {"order": 4, "action": "update_ticket", "description": "Update incident ticket with results"}], "executions": 12, "created_by": "Mike Rodriguez", "created_at": (now - timedelta(days=90)).isoformat()},
        {"id": "pb-004", "name": "Critical Patch Failure", "description": "Alert tech, rollback patch, schedule manual intervention", "trigger": "patch_failed_critical", "severity": "medium", "enabled": True, "steps": [{"order": 1, "action": "alert_tech", "description": "Notify assigned technician"}, {"order": 2, "action": "rollback_patch", "description": "Rollback failed patch"}, {"order": 3, "action": "create_ticket", "description": "Create maintenance ticket"}], "executions": 5, "created_by": "Alex Thompson", "created_at": (now - timedelta(days=30)).isoformat()},
    ]
    for p in playbooks:
        await db.remediation_playbooks.insert_one(p)
    return [dict((k, v) for k, v in p.items() if k != "_id") for p in playbooks]
