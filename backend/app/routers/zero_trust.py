from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random, uuid

router = APIRouter()

@router.get("/zero-trust/overview")
async def zero_trust_overview(current_user: dict = Depends(get_current_user)):
    policies = await db.zero_trust_policies.find({}, {"_id": 0}).to_list(50)
    if not policies:
        policies = await _seed_policies()
    events = await db.zero_trust_events.find({}, {"_id": 0}).sort("timestamp", -1).to_list(50)
    if not events:
        events = await _seed_zt_events()
    return {"policies": policies, "events": events[:20], "summary": {"total_policies": len(policies), "active": len([p for p in policies if p.get("enabled")]), "blocked_today": len([e for e in events if e.get("action") == "blocked"]), "allowed_today": len([e for e in events if e.get("action") == "allowed"]), "trust_score": random.randint(78, 95)}}

async def _seed_policies():
    pols = [
        {"name": "MFA Required for All Admin Access", "type": "authentication", "condition": "user.role == 'admin' AND auth.mfa == false", "action": "block", "enabled": True},
        {"name": "Block Access from Non-Approved Countries", "type": "geo_restriction", "condition": "geo.country NOT IN approved_countries", "action": "block", "enabled": True},
        {"name": "Require Device Compliance for VPN", "type": "device_compliance", "condition": "device.compliant == false AND connection.type == 'vpn'", "action": "block", "enabled": True},
        {"name": "Limit After-Hours Access", "type": "time_restriction", "condition": "time.hour NOT IN 6..20 AND user.exception == false", "action": "mfa_step_up", "enabled": True},
        {"name": "Block Unmanaged Devices from Sensitive Data", "type": "device_management", "condition": "device.managed == false AND resource.sensitivity == 'high'", "action": "block", "enabled": True},
    ]
    policies = []
    for p in pols:
        pol = {"id": f"zt-{uuid.uuid4().hex[:8]}", **p, "created_at": datetime.now(timezone.utc).isoformat(), "triggers_count": random.randint(5, 50)}
        policies.append(pol)
        await db.zero_trust_policies.insert_one(pol)
    return [{k: v for k, v in p.items() if k != "_id"} for p in policies]

async def _seed_zt_events():
    events = []
    for _ in range(20):
        e = {"id": f"zte-{uuid.uuid4().hex[:8]}", "policy_name": random.choice(["MFA Required", "Geo Block", "Device Compliance", "After-Hours", "Unmanaged Block"]), "user": f"{random.choice(['john','sarah','mike','lisa'])}@{random.choice(['techstart','globalfinance','healthcare'])}.com", "action": random.choices(["blocked", "allowed", "mfa_step_up"], weights=[30, 50, 20])[0], "device": f"{random.choice(['LAPTOP','DESKTOP','PHONE'])}-{random.randint(100,999)}", "ip": f"192.168.{random.randint(1,10)}.{random.randint(1,254)}", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=random.randint(0, 48))).isoformat()}
        events.append(e)
        await db.zero_trust_events.insert_one(e)
    return [{k: v for k, v in e.items() if k != "_id"} for e in events]
