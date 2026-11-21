from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/ai-resolution/suggestions")
async def get_ai_suggestions(current_user: dict = Depends(get_current_user)):
    """AI auto-resolution: detect issues, match to runbooks, suggest/execute fixes"""
    issues = await db.ai_resolution_queue.find({}, {"_id": 0}).sort("detected_at", -1).to_list(50)
    auto_resolved = len([i for i in issues if i.get("status") == "auto_resolved"])
    pending = len([i for i in issues if i.get("status") == "pending_approval"])
    return {
        "issues": issues,
        "summary": {"total": len(issues), "auto_resolved": auto_resolved, "pending_approval": pending, "manual_required": len(issues) - auto_resolved - pending,
                     "time_saved_hours": round(auto_resolved * 0.35, 1), "resolution_rate_pct": round(auto_resolved / len(issues) * 100, 1) if issues else 0}
    }

@router.post("/ai-resolution/{issue_id}/approve")
async def approve_resolution(issue_id: str, current_user: dict = Depends(get_current_user)):
    await db.ai_resolution_queue.update_one({"id": issue_id}, {"$set": {"status": "auto_resolved", "approved_by": current_user.get("name"), "resolved_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "approved"}

@router.post("/ai-resolution/{issue_id}/reject")
async def reject_resolution(issue_id: str, current_user: dict = Depends(get_current_user)):
    issue = await db.ai_resolution_queue.find_one({"id": issue_id}, {"_id": 0})
    if not issue:
        raise HTTPException(status_code=404, detail="AI resolution item not found")

    ticket_id = issue.get("escalation_ticket_id")
    ticket_number = None
    if ticket_id:
        ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "ticket_number": 1})
        ticket_number = (ticket or {}).get("ticket_number")
    else:
        now = datetime.now(timezone.utc).isoformat()
        ticket_id = f"ai-res-{uuid.uuid4().hex[:10]}"
        ticket_number = f"AI-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
        await db.tickets.insert_one({
            "id": ticket_id,
            "ticket_number": ticket_number,
            "title": f"[AI Review Required] {issue.get('issue', 'Resolution requires review')}",
            "description": f"AI recommendation was rejected and requires technician review. Matched runbook: {issue.get('runbook', 'None')}. Proposed action: {issue.get('action', 'None')}.",
            "status": "open",
            "priority": "high" if issue.get("category") in {"security", "backup", "certificate"} else "medium",
            "source": "ai_resolution",
            "client_name": issue.get("client"),
            "device_name": issue.get("device"),
            "ai_resolution_id": issue_id,
            "created_at": now,
            "updated_at": now,
        })
        await db.ai_resolution_queue.update_one({"id": issue_id}, {"$set": {"escalation_ticket_id": ticket_id}})

    await db.ai_resolution_queue.update_one({"id": issue_id}, {"$set": {"status": "manual_required", "rejected_by": current_user.get("name"), "rejected_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "rejected", "ticket_id": ticket_id, "ticket_number": ticket_number}
