"""Policy and lifecycle helpers for purchase orders."""

from __future__ import annotations

from fastapi import HTTPException
from pymongo import ReturnDocument


DEFAULT_PO_APPROVAL_SETTINGS = {
    "type": "po_approval",
    "enabled": True,
    "threshold": 1000.0,
    "require_separation": True,
    "require_assigned_approver_above_threshold": True,
    "approver_roles": ["admin", "owner", "finance"],
}


async def get_po_approval_settings(db) -> dict:
    stored = await db.settings.find_one({"type": "po_approval"}, {"_id": 0}) or {}
    return {**DEFAULT_PO_APPROVAL_SETTINGS, **stored}


def is_po_approver(user: dict, settings: dict) -> bool:
    role = str(user.get("role") or "").strip().lower()
    allowed = {str(item).strip().lower() for item in settings.get("approver_roles", [])}
    return bool(user.get("is_admin") or role in allowed)


async def assert_po_decision_allowed(db, po: dict, user: dict, *, action: str) -> dict:
    settings = await get_po_approval_settings(db)
    if not settings.get("enabled", True):
        return settings
    if not is_po_approver(user, settings):
        raise HTTPException(status_code=403, detail="Your role cannot approve or reject purchase orders")

    total = float(po.get("total", 0) or 0)
    threshold = float(settings.get("threshold", 0) or 0)
    high_value = total >= threshold
    if high_value and settings.get("require_separation", True) and po.get("created_by") == user.get("id"):
        raise HTTPException(
            status_code=403,
            detail=f"Purchase orders of ${threshold:,.2f} or more require approval by someone other than the creator",
        )

    assigned_approver = str(po.get("approver_id") or "").strip()
    if high_value and settings.get("require_assigned_approver_above_threshold", True):
        if not assigned_approver:
            raise HTTPException(status_code=409, detail="Assign an approver before this purchase order can be decided")
        if assigned_approver != user.get("id"):
            raise HTTPException(status_code=403, detail=f"This purchase order is assigned to {po.get('approver_name') or 'another approver'}")
    elif assigned_approver and assigned_approver != user.get("id") and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail=f"This purchase order is assigned to {po.get('approver_name') or 'another approver'}")

    if action == "reject" and po.get("status") != "pending_approval":
        raise HTTPException(status_code=409, detail="Only purchase orders awaiting approval can be rejected")
    return settings


def version_filter(document: dict) -> dict:
    version = document.get("version")
    return {"version": version} if version is not None else {"version": {"$exists": False}}


async def next_po_number(db) -> str:
    """Allocate a collision-safe purchase-order number across every creation path."""
    existing_count = await db.purchase_orders.count_documents({})
    await db.settings.update_one(
        {"key": "po_sequence"},
        {"$setOnInsert": {"key": "po_sequence", "value": existing_count}},
        upsert=True,
    )
    sequence = await db.settings.find_one_and_update(
        {"key": "po_sequence"},
        {"$inc": {"value": 1}},
        return_document=ReturnDocument.AFTER,
    )
    return f"PO-{int((sequence or {}).get('value', existing_count + 1)) + 1000:04d}"
