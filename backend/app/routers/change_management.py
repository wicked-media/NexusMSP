from fastapi import APIRouter, Depends, Body
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/change-management", tags=["Change Management"])

@router.get("")
async def list_changes(user=Depends(get_current_user)):
    changes = await db.change_requests.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return changes

@router.get("/stats")
async def get_change_stats(user=Depends(get_current_user)):
    all_changes = await db.change_requests.find({}, {"_id": 0}).to_list(500)
    return {
        "total": len(all_changes),
        "pending_review": len([c for c in all_changes if c.get("status") == "pending_review"]),
        "approved": len([c for c in all_changes if c.get("status") == "approved"]),
        "implementing": len([c for c in all_changes if c.get("status") == "implementing"]),
        "completed": len([c for c in all_changes if c.get("status") == "completed"]),
        "rejected": len([c for c in all_changes if c.get("status") == "rejected"]),
        "rollback": len([c for c in all_changes if c.get("status") == "rollback"]),
        "by_category": {},
        "by_risk": {
            "high": len([c for c in all_changes if c.get("risk_level") == "high"]),
            "medium": len([c for c in all_changes if c.get("risk_level") == "medium"]),
            "low": len([c for c in all_changes if c.get("risk_level") == "low"]),
        },
    }

@router.post("")
async def create_change_request(payload: dict = Body(...), user=Depends(get_current_user)):
    doc = {
        "id": f"CHG-{str(uuid.uuid4())[:6].upper()}",
        "title": payload.get("title", ""),
        "description": payload.get("description", ""),
        "category": payload.get("category", "standard"),
        "risk_level": payload.get("risk_level", "medium"),
        "impact": payload.get("impact", ""),
        "rollback_plan": payload.get("rollback_plan", ""),
        "client_id": payload.get("client_id", ""),
        "client_name": payload.get("client_name", ""),
        "devices_affected": payload.get("devices_affected", []),
        "scheduled_date": payload.get("scheduled_date", ""),
        "maintenance_window": payload.get("maintenance_window", ""),
        "status": "pending_review",
        "requested_by": user.get("name", ""),
        "requested_by_id": user.get("id", ""),
        "approvals": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.change_requests.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@router.post("/{change_id}/approve")
async def approve_change(change_id: str, user=Depends(get_current_user)):
    await db.change_requests.update_one(
        {"id": change_id},
        {"$set": {"status": "approved", "updated_at": datetime.now(timezone.utc).isoformat()},
         "$push": {"approvals": {"user": user.get("name"), "action": "approved", "at": datetime.now(timezone.utc).isoformat()}}}
    )
    return {"message": "Change approved"}

@router.post("/{change_id}/reject")
async def reject_change(change_id: str, payload: dict = Body(default={}), user=Depends(get_current_user)):
    await db.change_requests.update_one(
        {"id": change_id},
        {"$set": {"status": "rejected", "rejection_reason": payload.get("reason", ""), "updated_at": datetime.now(timezone.utc).isoformat()},
         "$push": {"approvals": {"user": user.get("name"), "action": "rejected", "at": datetime.now(timezone.utc).isoformat()}}}
    )
    return {"message": "Change rejected"}

@router.post("/{change_id}/implement")
async def start_implementation(change_id: str, user=Depends(get_current_user)):
    await db.change_requests.update_one(
        {"id": change_id},
        {"$set": {"status": "implementing", "implementation_started": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Implementation started"}

@router.post("/{change_id}/complete")
async def complete_change(change_id: str, payload: dict = Body(default={}), user=Depends(get_current_user)):
    await db.change_requests.update_one(
        {"id": change_id},
        {"$set": {"status": "completed", "completion_notes": payload.get("notes", ""), "completed_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Change completed"}
