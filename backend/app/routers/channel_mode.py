from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random, uuid

router = APIRouter()

# ─── MSP-of-MSPs / Channel Mode ───

@router.get("/channel-mode/tenants")
async def list_tenants(current_user: dict = Depends(get_current_user)):
    tenants = await db.channel_tenants.find({}, {"_id": 0}).to_list(50)
    if not tenants:
        tenants = await _seed_tenants()
    return {"tenants": tenants, "summary": {
        "total_tenants": len(tenants),
        "active": len([t for t in tenants if t.get("status") == "active"]),
        "total_endpoints": sum(t.get("endpoint_count", 0) for t in tenants),
        "total_mrr": sum(t.get("mrr", 0) for t in tenants),
        "avg_margin": round(sum(t.get("margin_pct", 0) for t in tenants) / max(len(tenants), 1), 1),
    }}


@router.get("/channel-mode/tenant/{tenant_id}")
async def get_tenant(tenant_id: str, current_user: dict = Depends(get_current_user)):
    tenant = await db.channel_tenants.find_one({"tenant_id": tenant_id}, {"_id": 0})
    if not tenant:
        tenants = await _seed_tenants()
        tenant = tenants[0]
    return tenant


@router.post("/channel-mode/tenant")
async def create_tenant(body: dict, current_user: dict = Depends(get_current_user)):
    tenant_id = str(uuid.uuid4())[:8]
    tenant = {
        "tenant_id": tenant_id,
        "name": body.get("name", "New MSP"),
        "domain": body.get("domain", f"{tenant_id}.nexusops.io"),
        "status": "provisioning",
        "tier": body.get("tier", "standard"),
        "endpoint_count": 0,
        "mrr": 0,
        "margin_pct": 35,
        "branding": {"logo": None, "primary_color": "#3b82f6", "company_name": body.get("name", "New MSP")},
        "features_enabled": ["tickets", "devices", "clients", "reports"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "admin_email": body.get("admin_email", ""),
    }
    await db.channel_tenants.insert_one({**tenant})
    return {"status": "created", "tenant": tenant}


@router.put("/channel-mode/tenant/{tenant_id}/features")
async def update_features(tenant_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    await db.channel_tenants.update_one(
        {"tenant_id": tenant_id},
        {"$set": {"features_enabled": body.get("features", [])}}
    )
    return {"status": "updated"}


@router.get("/channel-mode/revenue")
async def channel_revenue(current_user: dict = Depends(get_current_user)):
    tenants = await db.channel_tenants.find({}, {"_id": 0}).to_list(50)
    if not tenants:
        tenants = await _seed_tenants()
    months = ["Sep 2025", "Oct 2025", "Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026"]
    return {
        "monthly_trend": [{"month": m, "revenue": random.randint(45000, 75000), "cost": random.randint(25000, 40000)} for m in months],
        "by_tier": {"enterprise": sum(t.get("mrr", 0) for t in tenants if t.get("tier") == "enterprise"),
                    "professional": sum(t.get("mrr", 0) for t in tenants if t.get("tier") == "professional"),
                    "standard": sum(t.get("mrr", 0) for t in tenants if t.get("tier") == "standard")},
        "top_tenants": sorted(tenants, key=lambda x: x.get("mrr", 0), reverse=True)[:5],
    }


async def _seed_tenants():
    names = [
        ("Velocity IT Solutions", "enterprise", 450, 12500, 42),
        ("Cascade Networks", "professional", 280, 8400, 38),
        ("Summit Tech Partners", "enterprise", 620, 18600, 45),
        ("Harbor MSP Group", "standard", 95, 2850, 32),
        ("Pinnacle Systems", "professional", 180, 5400, 36),
        ("Apex Cloud Services", "enterprise", 380, 11400, 41),
        ("Ridge IT Consulting", "standard", 65, 1950, 30),
        ("Frontier Managed", "professional", 210, 6300, 37),
    ]
    tenants = []
    for name, tier, endpoints, mrr, margin in names:
        tid = str(uuid.uuid4())[:8]
        tenants.append({
            "tenant_id": tid,
            "name": name,
            "domain": f"{name.lower().replace(' ', '-')}.nexusops.io",
            "status": "active",
            "tier": tier,
            "endpoint_count": endpoints,
            "mrr": mrr,
            "margin_pct": margin,
            "branding": {"logo": None, "primary_color": random.choice(["#3b82f6", "#8b5cf6", "#10b981", "#f97316"]), "company_name": name},
            "features_enabled": ["tickets", "devices", "clients", "reports", "security"] if tier != "standard" else ["tickets", "devices", "clients"],
            "created_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(30, 365))).isoformat(),
            "admin_email": f"admin@{name.lower().replace(' ', '')}.com",
            "technicians": random.randint(3, 15),
            "clients_count": random.randint(5, 40),
        })
    await db.channel_tenants.insert_many(tenants)
    for t in tenants:
        t.pop("_id", None)
    return tenants
