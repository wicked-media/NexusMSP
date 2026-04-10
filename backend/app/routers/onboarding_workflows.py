from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/onboarding-workflows/list")
async def list_workflows(current_user: dict = Depends(get_current_user)):
    workflows = await db.onboarding_workflows.find({}, {"_id": 0}).to_list(50)
    if not workflows:
        workflows = await _seed_workflows()
    return {"workflows": workflows, "summary": {"total": len(workflows), "in_progress": len([w for w in workflows if w.get("status") == "in_progress"]), "completed": len([w for w in workflows if w.get("status") == "completed"]), "avg_completion_days": round(sum(w.get("days_elapsed", 0) for w in workflows) / max(len(workflows), 1), 1)}}

@router.post("/onboarding-workflows/{workflow_id}/step/{step_id}/complete")
async def complete_step(workflow_id: str, step_id: str, current_user: dict = Depends(get_current_user)):
    await db.onboarding_workflows.update_one({"id": workflow_id, "steps.id": step_id}, {"$set": {"steps.$.status": "completed", "steps.$.completed_at": datetime.now(timezone.utc).isoformat(), "steps.$.completed_by": current_user.get("name")}})
    return {"status": "step_completed"}

async def _seed_workflows():
    steps_template = [
        {"name": "Network Discovery Scan", "category": "discovery", "est_hours": 2},
        {"name": "Device Import & Enrollment", "category": "devices", "est_hours": 4},
        {"name": "Agent Deployment (RMM)", "category": "devices", "est_hours": 3},
        {"name": "Documentation Audit", "category": "documentation", "est_hours": 6},
        {"name": "Backup Configuration", "category": "backup", "est_hours": 4},
        {"name": "Security Baseline Assessment", "category": "security", "est_hours": 3},
        {"name": "MFA Enrollment", "category": "security", "est_hours": 2},
        {"name": "Patch Policy Setup", "category": "patching", "est_hours": 2},
        {"name": "Monitoring & Alerts Config", "category": "monitoring", "est_hours": 3},
        {"name": "Client Portal Setup", "category": "portal", "est_hours": 1},
        {"name": "Billing Configuration", "category": "billing", "est_hours": 1},
        {"name": "Knowledge Base Population", "category": "documentation", "est_hours": 4},
        {"name": "Staff Training Session", "category": "training", "est_hours": 2},
        {"name": "Go-Live Checklist Review", "category": "review", "est_hours": 1},
    ]
    workflows = []
    clients = [("Meridian Corp", "in_progress", 12, 8), ("Beacon Dynamics", "in_progress", 5, 3), ("Sterling & Co", "completed", 18, 14)]
    for name, status, days, steps_done in clients:
        steps = []
        for i, st in enumerate(steps_template):
            s = {"id": f"os-{uuid.uuid4().hex[:8]}", "name": st["name"], "category": st["category"], "est_hours": st["est_hours"], "order": i + 1, "status": "completed" if i < steps_done else "pending", "completed_at": (datetime.now(timezone.utc) - timedelta(days=days - i)).isoformat() if i < steps_done else None, "completed_by": "Alex Thompson" if i < steps_done else None}
            steps.append(s)
        w = {"id": f"ow-{uuid.uuid4().hex[:8]}", "client_name": name, "status": status, "steps": steps, "total_steps": len(steps), "completed_steps": steps_done, "completion_pct": round(steps_done / len(steps) * 100, 1), "started_at": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(), "days_elapsed": days, "assigned_to": "Alex Thompson"}
        workflows.append(w)
        await db.onboarding_workflows.insert_one(w)
    return [{k: v for k, v in w.items() if k != "_id"} for w in workflows]
