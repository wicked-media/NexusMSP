from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random

router = APIRouter()

@router.get("/mfa-management/overview")
async def get_mfa_overview(current_user: dict = Depends(get_current_user)):
    data = await db.mfa_status.find({}, {"_id": 0}).to_list(500)
    if not data:
        data = await _seed_mfa_data()
    total = len(data)
    enrolled = sum(1 for d in data if d.get("mfa_enabled"))
    return {"summary": {"total_users": total, "mfa_enrolled": enrolled, "not_enrolled": total - enrolled, "enrollment_pct": round(enrolled / total * 100, 1) if total else 0}, "users": data}

@router.get("/mfa-management/by-client")
async def get_mfa_by_client(current_user: dict = Depends(get_current_user)):
    pipeline = [{"$group": {"_id": {"client_id": "$client_id", "client_name": "$client_name"}, "total": {"$sum": 1}, "enrolled": {"$sum": {"$cond": ["$mfa_enabled", 1, 0]}}}}]
    results = await db.mfa_status.aggregate(pipeline).to_list(50)
    return [{"client_id": r["_id"]["client_id"], "client_name": r["_id"]["client_name"], "total_users": r["total"], "enrolled": r["enrolled"], "not_enrolled": r["total"] - r["enrolled"], "enrollment_pct": round(r["enrolled"] / r["total"] * 100, 1) if r["total"] else 0} for r in results]

@router.post("/mfa-management/enforce/{client_id}")
async def enforce_mfa(client_id: str, current_user: dict = Depends(get_current_user)):
    await db.mfa_status.update_many({"client_id": client_id}, {"$set": {"enforcement_policy": "required", "enforcement_deadline": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()}})
    return {"status": "enforcement_set", "deadline": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()}

async def _seed_mfa_data():
    clients = [("client-001", "Acme Corporation", 45), ("client-002", "TechStart Inc", 28), ("client-003", "Global Finance Ltd", 120), ("client-004", "HealthCare Plus", 67), ("client-005", "RetailMax", 34), ("client-006", "Summit Legal Group", 35), ("client-007", "Pacific Schools District", 85), ("client-009", "Cascade Manufacturing", 92)]
    providers = ["Azure AD", "Google Workspace", "Okta", "Duo"]
    methods = ["authenticator_app", "sms", "hardware_key", "push_notification"]
    users = []
    for cid, cname, count in clients:
        sample = min(count, random.randint(8, 15))
        for j in range(sample):
            enabled = random.random() < 0.72
            provider = random.choice(providers)
            user = {"id": f"mfa-{cid}-{j+1:03d}", "client_id": cid, "client_name": cname, "email": f"user{j+1}@{cname.lower().replace(' ','')}.com", "display_name": f"User {j+1}", "mfa_enabled": enabled, "mfa_method": random.choice(methods) if enabled else None, "provider": provider, "last_login": (datetime.now(timezone.utc) - timedelta(days=random.randint(0, 30))).isoformat(), "enforcement_policy": "recommended"}
            users.append(user)
    for u in users:
        await db.mfa_status.insert_one(u)
    return [dict((k, v) for k, v in u.items() if k != "_id") for u in users]
