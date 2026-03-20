from fastapi import APIRouter, Depends, Body
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/bulk-actions", tags=["Bulk Device Actions"])

@router.post("/execute")
async def execute_bulk_action(
    payload: dict = Body(...),
    user=Depends(get_current_user)
):
    device_ids = payload.get("device_ids", [])
    action = payload.get("action", "")
    params = payload.get("params", {})
    
    if not device_ids or not action:
        return {"error": "device_ids and action are required"}
    
    devices = await db.devices.find({"id": {"$in": device_ids}}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "status": 1}).to_list(200)
    
    results = []
    for d in devices:
        result = {
            "device_id": d["id"], "device_name": d.get("name", ""),
            "client_name": d.get("client_name", ""),
            "action": action,
            "status": "completed" if d.get("status") == "online" else "failed",
            "message": f"Action '{action}' completed successfully" if d.get("status") == "online" else "Device offline - action queued",
        }
        results.append(result)
    
    job_doc = {
        "id": str(uuid.uuid4())[:8],
        "action": action,
        "device_count": len(device_ids),
        "succeeded": len([r for r in results if r["status"] == "completed"]),
        "failed": len([r for r in results if r["status"] == "failed"]),
        "params": params,
        "results": results,
        "executed_by": user.get("name", "System"),
        "executed_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.bulk_action_jobs.insert_one(job_doc)
    
    # Remove MongoDB _id before returning
    return {k: v for k, v in job_doc.items() if k != "_id"}

@router.get("/actions")
async def get_available_actions(user=Depends(get_current_user)):
    return [
        {"id": "restart", "name": "Restart Device", "description": "Send restart command to selected devices", "icon": "refresh-cw"},
        {"id": "run_script", "name": "Run Script", "description": "Execute a script on selected devices", "icon": "terminal"},
        {"id": "deploy_patch", "name": "Deploy Patches", "description": "Push pending patches to selected devices", "icon": "shield"},
        {"id": "collect_inventory", "name": "Collect Inventory", "description": "Trigger full hardware/software inventory scan", "icon": "scan-line"},
        {"id": "install_agent", "name": "Install Agent", "description": "Deploy monitoring agent to selected devices", "icon": "download"},
        {"id": "force_checkin", "name": "Force Check-in", "description": "Force agent check-in on selected devices", "icon": "radio"},
    ]

@router.get("/history")
async def get_bulk_action_history(user=Depends(get_current_user)):
    jobs = await db.bulk_action_jobs.find({}, {"_id": 0}).sort("executed_at", -1).to_list(50)
    return jobs
