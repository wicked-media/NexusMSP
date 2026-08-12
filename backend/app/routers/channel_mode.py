from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user
import uuid

router = APIRouter()


def _is_channel_admin(user: dict) -> bool:
    return bool(
        user.get("is_admin")
        or str(user.get("role") or "").lower() in {"admin", "owner"}
    )


async def _require_channel_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if not _is_channel_admin(current_user):
        raise HTTPException(status_code=403, detail="Channel Mode requires an administrator account")
    return current_user

# ─── MSP-of-MSPs / Channel Mode ───

@router.get("/channel-mode/tenants")
async def list_tenants(current_user: dict = Depends(_require_channel_admin)):
    tenants = await db.channel_tenants.find({}, {"_id": 0}).to_list(50)
    return {"tenants": tenants, "summary": {
        "total_tenants": len(tenants),
        "active": len([t for t in tenants if t.get("status") == "active"]),
        "total_endpoints": sum(t.get("endpoint_count", 0) for t in tenants),
        "total_mrr": sum(t.get("mrr", 0) for t in tenants),
        "avg_margin": round(sum(t.get("margin_pct", 0) for t in tenants) / max(len(tenants), 1), 1),
    }}


@router.get("/channel-mode/tenant/{tenant_id}")
async def get_tenant(tenant_id: str, current_user: dict = Depends(_require_channel_admin)):
    tenant = await db.channel_tenants.find_one({"tenant_id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Channel tenant not found")
    return tenant


@router.post("/channel-mode/tenant")
async def create_tenant(body: dict, current_user: dict = Depends(_require_channel_admin)):
    tenant_id = str(uuid.uuid4())[:8]
    name = str(body.get("name") or "").strip()
    admin_email = str(body.get("admin_email") or "").strip().lower()
    if not name:
        raise HTTPException(status_code=422, detail="MSP name is required")
    if not admin_email or "@" not in admin_email:
        raise HTTPException(status_code=422, detail="A valid MSP administrator email is required")
    tenant = {
        "tenant_id": tenant_id,
        "name": name,
        "domain": body.get("domain", f"{tenant_id}.nexusops.io"),
        "status": "provisioning",
        "tier": body.get("tier", "standard"),
        "endpoint_count": 0,
        "mrr": 0,
        "margin_pct": 35,
        "branding": {"logo": None, "primary_color": "#3b82f6", "company_name": name},
        "features_enabled": ["tickets", "devices", "clients", "reports"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "admin_email": admin_email,
    }
    await db.channel_tenants.insert_one({**tenant})
    return {"status": "created", "tenant": tenant}


@router.put("/channel-mode/tenant/{tenant_id}/features")
async def update_features(tenant_id: str, body: dict, current_user: dict = Depends(_require_channel_admin)):
    result = await db.channel_tenants.update_one(
        {"tenant_id": tenant_id},
        {"$set": {"features_enabled": body.get("features", [])}}
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Channel tenant not found")
    return {"status": "updated"}


@router.get("/channel-mode/revenue")
async def channel_revenue(current_user: dict = Depends(_require_channel_admin)):
    tenants = await db.channel_tenants.find({}, {"_id": 0}).to_list(50)
    return {
        "monthly_trend": [],
        "by_tier": {"enterprise": sum(t.get("mrr", 0) for t in tenants if t.get("tier") == "enterprise"),
                    "professional": sum(t.get("mrr", 0) for t in tenants if t.get("tier") == "professional"),
                    "standard": sum(t.get("mrr", 0) for t in tenants if t.get("tier") == "standard")},
        "top_tenants": sorted(tenants, key=lambda x: x.get("mrr", 0), reverse=True)[:5],
    }
