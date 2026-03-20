from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter()

@router.get("/password-rotation/policies")
async def get_rotation_policies(current_user: dict = Depends(get_current_user)):
    policies = await db.password_rotation_policies.find({}, {"_id": 0}).to_list(100)
    if not policies:
        policies = await _seed_policies()
    return policies

@router.post("/password-rotation/policies")
async def create_policy(data: dict, current_user: dict = Depends(get_current_user)):
    policy = {**data, "id": f"prp-{uuid.uuid4().hex[:8]}", "created_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat(), "enabled": True, "rotations_completed": 0}
    await db.password_rotation_policies.insert_one(policy)
    policy.pop("_id", None)
    return policy

@router.get("/password-rotation/history")
async def get_rotation_history(current_user: dict = Depends(get_current_user)):
    history = await db.password_rotation_history.find({}, {"_id": 0}).sort("rotated_at", -1).to_list(100)
    if not history:
        now = datetime.now(timezone.utc)
        history = [
            {"id": "prh-001", "credential_name": "Acme Corp - Domain Admin", "client_name": "Acme Corporation", "policy_id": "prp-001", "old_password_hash": "sha256:a1b2...", "rotated_at": (now - timedelta(days=5)).isoformat(), "status": "success", "rotated_by": "System (Auto)"},
            {"id": "prh-002", "credential_name": "GF - Firewall Admin", "client_name": "Global Finance Ltd", "policy_id": "prp-002", "rotated_at": (now - timedelta(days=12)).isoformat(), "status": "success", "rotated_by": "System (Auto)"},
            {"id": "prh-003", "credential_name": "HC Plus - VPN Gateway", "client_name": "HealthCare Plus", "policy_id": "prp-003", "rotated_at": (now - timedelta(days=3)).isoformat(), "status": "failed", "error": "Connection timeout - device unreachable", "rotated_by": "System (Auto)"},
        ]
        for h in history:
            await db.password_rotation_history.insert_one(h)
        history = [dict((k, v) for k, v in h.items() if k != "_id") for h in history]
    return history

async def _seed_policies():
    now = datetime.now(timezone.utc)
    policies = [
        {"id": "prp-001", "name": "Domain Admin Rotation", "description": "Rotate all domain admin passwords every 30 days", "rotation_days": 30, "scope": "domain_admin", "password_length": 24, "include_special": True, "notify_on_rotation": True, "enabled": True, "rotations_completed": 12, "next_rotation": (now + timedelta(days=25)).strftime("%Y-%m-%d"), "last_rotation": (now - timedelta(days=5)).isoformat(), "created_by": "Alex Thompson", "created_at": (now - timedelta(days=360)).isoformat()},
        {"id": "prp-002", "name": "Firewall Admin Rotation", "description": "Rotate firewall admin credentials every 60 days", "rotation_days": 60, "scope": "firewall_admin", "password_length": 20, "include_special": True, "enabled": True, "rotations_completed": 6, "next_rotation": (now + timedelta(days=48)).strftime("%Y-%m-%d"), "created_by": "Sarah Chen", "created_at": (now - timedelta(days=360)).isoformat()},
        {"id": "prp-003", "name": "Service Account Rotation", "description": "Rotate service accounts every 90 days", "rotation_days": 90, "scope": "service_accounts", "password_length": 32, "include_special": True, "enabled": True, "rotations_completed": 4, "next_rotation": (now + timedelta(days=87)).strftime("%Y-%m-%d"), "created_by": "Alex Thompson", "created_at": (now - timedelta(days=360)).isoformat()},
    ]
    for p in policies:
        await db.password_rotation_policies.insert_one(p)
    return [dict((k, v) for k, v in p.items() if k != "_id") for p in policies]
