from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/approvals")
async def get_approvals(current_user: dict = Depends(get_current_user)):
    """Get all pending approvals."""
    pending = await db.approvals.find({"status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return pending


@router.get("/approvals/all")
async def get_all_approvals(current_user: dict = Depends(get_current_user)):
    return await db.approvals.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.get("/approvals/workflows")
async def get_approval_workflows(current_user: dict = Depends(get_current_user)):
    """Get configured approval workflows."""
    workflows = await db.approval_workflows.find({}, {"_id": 0}).to_list(50)
    if not workflows:
        # Return defaults
        return [
            {"id": "wf-001", "name": "Purchase Over $500", "trigger": "purchase_amount_gt_500", "approver_role": "admin", "enabled": True},
            {"id": "wf-002", "name": "New Device Addition", "trigger": "device_created", "approver_role": "admin", "enabled": True},
            {"id": "wf-003", "name": "Contract Change", "trigger": "contract_modified", "approver_role": "admin", "enabled": True},
            {"id": "wf-004", "name": "Client Discount > 10%", "trigger": "discount_gt_10", "approver_role": "admin", "enabled": False},
        ]
    return workflows


@router.post("/approvals")
async def create_approval(data: dict, current_user: dict = Depends(get_current_user)):
    """Create an approval request."""
    approval_id = str(uuid.uuid4())[:8]
    doc = {
        "id": approval_id,
        "type": data.get("type", "general"),
        "title": data.get("title", ""),
        "description": data.get("description", ""),
        "amount": data.get("amount", 0),
        "requested_by": current_user.get("name", ""),
        "requested_by_id": current_user.get("id", ""),
        "approver_role": data.get("approver_role", "admin"),
        "status": "pending",
        "ref_id": data.get("ref_id", ""),
        "ref_type": data.get("ref_type", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "decided_at": None, "decided_by": None, "decision_note": None,
    }
    await db.approvals.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/approvals/{approval_id}/approve")
async def approve_request(approval_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    data = data or {}
    await db.approvals.update_one({"id": approval_id}, {"$set": {
        "status": "approved", "decided_at": datetime.now(timezone.utc).isoformat(),
        "decided_by": current_user.get("name", ""), "decision_note": data.get("note", ""),
    }})
    return {"message": "Approved"}


@router.post("/approvals/{approval_id}/reject")
async def reject_request(approval_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    data = data or {}
    await db.approvals.update_one({"id": approval_id}, {"$set": {
        "status": "rejected", "decided_at": datetime.now(timezone.utc).isoformat(),
        "decided_by": current_user.get("name", ""), "decision_note": data.get("note", ""),
    }})
    return {"message": "Rejected"}


@router.post("/approvals/workflows")
async def save_workflow(data: dict, current_user: dict = Depends(get_current_user)):
    wf_id = data.get("id", str(uuid.uuid4())[:8])
    doc = {"id": wf_id, "name": data.get("name",""), "trigger": data.get("trigger",""), "approver_role": data.get("approver_role","admin"), "enabled": data.get("enabled", True)}
    await db.approval_workflows.update_one({"id": wf_id}, {"$set": doc}, upsert=True)
    return doc
