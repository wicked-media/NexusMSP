"""Shared, tenant-scoped approval workflows.

This router is the generic approval inbox.  Domain-specific workflows retain
their own permission checks, but every shared record must still have a client
owner before a restricted technician can read or decide it.
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import (
    assert_client_scope,
    assert_global_scope,
    scoped_query,
)


router = APIRouter()


async def _approval_or_404(approval_id: str, current_user: dict) -> dict:
    approval = await db.approvals.find_one({"id": approval_id}, {"_id": 0})
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")
    await assert_client_scope(
        current_user,
        approval.get("client_id"),
        operation="approval.decision",
        mask_not_found=True,
    )
    return approval


def _may_decide(approval: dict, current_user: dict) -> bool:
    """Require the designated approver role, unless the caller is an admin."""
    if approval.get("requested_by_id") and str(approval.get("requested_by_id")) == str(
        current_user.get("id")
    ):
        return False
    if current_user.get("is_admin") or str(current_user.get("role") or "").lower() == "admin":
        return True
    required_role = str(approval.get("approver_role") or "admin").strip().lower()
    return bool(required_role and str(current_user.get("role") or "").lower() == required_role)


async def _record_decision_audit(
    approval: dict, current_user: dict, decision: str, note: str
) -> None:
    await db.approval_audit.insert_one(
        {
            "id": str(uuid.uuid4()),
            "approval_id": approval["id"],
            "client_id": approval.get("client_id"),
            "decision": decision,
            "decided_by_id": current_user.get("id"),
            "decided_by": current_user.get("name") or current_user.get("email"),
            "note": note,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
    )


@router.get("/approvals")
async def get_approvals(current_user: dict = Depends(get_current_user)):
    """Get pending approvals only for the caller's explicit client scope."""
    return await db.approvals.find(
        scoped_query(current_user, {"status": "pending"}, site_field=None),
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)


@router.get("/approvals/all")
async def get_all_approvals(current_user: dict = Depends(get_current_user)):
    return await db.approvals.find(
        scoped_query(current_user, {}, site_field=None), {"_id": 0}
    ).sort("created_at", -1).to_list(200)


@router.get("/approvals/workflows")
async def get_approval_workflows(current_user: dict = Depends(get_current_user)):
    """Get platform-wide approval workflow configuration."""
    await assert_global_scope(current_user, operation="approval.workflow.read")
    workflows = await db.approval_workflows.find({}, {"_id": 0}).to_list(50)
    if not workflows:
        return [
            {"id": "wf-001", "name": "Purchase Over $500", "trigger": "purchase_amount_gt_500", "approver_role": "admin", "enabled": True},
            {"id": "wf-002", "name": "New Device Addition", "trigger": "device_created", "approver_role": "admin", "enabled": True},
            {"id": "wf-003", "name": "Contract Change", "trigger": "contract_modified", "approver_role": "admin", "enabled": True},
            {"id": "wf-004", "name": "Client Discount > 10%", "trigger": "discount_gt_10", "approver_role": "admin", "enabled": False},
        ]
    return workflows


@router.post("/approvals")
async def create_approval(data: dict, current_user: dict = Depends(get_current_user)):
    """Create an approval request with an explicit client owner when scoped."""
    client_id = str(data.get("client_id") or "").strip() or None
    if client_id:
        await assert_client_scope(current_user, client_id, operation="approval.create")
    else:
        await assert_global_scope(current_user, operation="approval.create.global")

    approval_id = str(uuid.uuid4())[:8]
    doc = {
        "id": approval_id,
        "type": data.get("type", "general"),
        "title": data.get("title", ""),
        "description": data.get("description", ""),
        "amount": data.get("amount", 0),
        "client_id": client_id,
        "client_name": data.get("client_name", ""),
        "requested_by": current_user.get("name", ""),
        "requested_by_id": current_user.get("id", ""),
        "approver_role": data.get("approver_role", "admin"),
        "status": "pending",
        "ref_id": data.get("ref_id", ""),
        "ref_type": data.get("ref_type", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "decided_at": None,
        "decided_by": None,
        "decision_note": None,
    }
    await db.approvals.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _decide_request(
    approval_id: str, decision: str, data: dict | None, current_user: dict
) -> dict:
    data = data or {}
    approval = await _approval_or_404(approval_id, current_user)
    if not _may_decide(approval, current_user):
        raise HTTPException(status_code=403, detail="Your role cannot decide this approval request")
    if approval.get("status") != "pending":
        raise HTTPException(status_code=409, detail="This approval request has already been decided")

    now = datetime.now(timezone.utc).isoformat()
    note = str(data.get("note") or "").strip()
    result = await db.approvals.update_one(
        {"id": approval_id, "status": "pending"},
        {
            "$set": {
                "status": decision,
                "decided_at": now,
                "decided_by": current_user.get("name") or current_user.get("email", ""),
                "decision_note": note,
            }
        },
    )
    if not getattr(result, "modified_count", 1):
        raise HTTPException(status_code=409, detail="This approval request was already decided")
    await _record_decision_audit(approval, current_user, decision, note)
    return {"message": "Approved" if decision == "approved" else "Rejected"}


@router.post("/approvals/{approval_id}/approve")
async def approve_request(
    approval_id: str,
    data: dict | None = None,
    current_user: dict = Depends(get_current_user),
):
    return await _decide_request(approval_id, "approved", data, current_user)


@router.post("/approvals/{approval_id}/reject")
async def reject_request(
    approval_id: str,
    data: dict | None = None,
    current_user: dict = Depends(get_current_user),
):
    return await _decide_request(approval_id, "rejected", data, current_user)


@router.post("/approvals/workflows")
async def save_workflow(data: dict, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="approval.workflow.update")
    wf_id = data.get("id", str(uuid.uuid4())[:8])
    doc = {
        "id": wf_id,
        "name": data.get("name", ""),
        "trigger": data.get("trigger", ""),
        "approver_role": data.get("approver_role", "admin"),
        "enabled": data.get("enabled", True),
    }
    await db.approval_workflows.update_one({"id": wf_id}, {"$set": doc}, upsert=True)
    return doc
