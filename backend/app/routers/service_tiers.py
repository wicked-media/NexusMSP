"""
Service Tiers — MSP-style tiered service plans (Bronze → Diamond).

Defines per-tier SLA targets, colours, and feature flags so techs instantly
know the level of service a client is on. Tiers are CRUD-managed by admins.
"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

DEFAULT_TIERS = [
    {
        "id": "tier-bronze",
        "name": "SMB Bronze",
        "slug": "bronze",
        "color": "#cd7f32",
        "icon": "shield",
        "sort_order": 1,
        "response_sla_minutes": 60 * 24,        # 24h
        "resolution_sla_minutes": 60 * 24 * 5,  # 5 business days
        "monthly_price": 0,
        "features": ["Business-hours support", "Email & phone ticketing", "Monthly health report"],
        "description": "Reactive support during business hours.",
        "is_active": True,
    },
    {
        "id": "tier-silver",
        "name": "SMB Silver",
        "slug": "silver",
        "color": "#c0c0c0",
        "icon": "shield",
        "sort_order": 2,
        "response_sla_minutes": 60 * 8,         # 8h
        "resolution_sla_minutes": 60 * 24 * 3,  # 3 business days
        "monthly_price": 0,
        "features": ["Priority queueing", "Patch management", "Remote support", "Quarterly business review"],
        "description": "Proactive monitoring with priority support.",
        "is_active": True,
    },
    {
        "id": "tier-gold",
        "name": "SMB Gold",
        "slug": "gold",
        "color": "#facc15",
        "icon": "award",
        "sort_order": 3,
        "response_sla_minutes": 60 * 4,         # 4h
        "resolution_sla_minutes": 60 * 24 * 2,  # 2 business days
        "monthly_price": 0,
        "features": ["4-hour response SLA", "24×7 monitoring", "EDR included", "Backup management", "Monthly vCIO call"],
        "description": "Full-stack managed services with same-day response.",
        "is_active": True,
    },
    {
        "id": "tier-platinum",
        "name": "Platinum",
        "slug": "platinum",
        "color": "#a78bfa",
        "icon": "crown",
        "sort_order": 4,
        "response_sla_minutes": 60,             # 1h
        "resolution_sla_minutes": 60 * 24,      # 1 business day
        "monthly_price": 0,
        "features": ["1-hour critical response", "Dedicated TAM", "Security suite (MFA + DLP)", "Onsite emergency dispatch", "Compliance reporting"],
        "description": "Concierge support with dedicated account technician.",
        "is_active": True,
    },
    {
        "id": "tier-diamond",
        "name": "Diamond",
        "slug": "diamond",
        "color": "#22d3ee",
        "icon": "gem",
        "sort_order": 5,
        "response_sla_minutes": 15,             # 15 min
        "resolution_sla_minutes": 60 * 4,       # 4 hours
        "monthly_price": 0,
        "features": ["15-min response SLA", "24×7 white-glove support", "Full security stack (SOC + SIEM)", "Quarterly pen-test", "Annual DR drill", "Direct line to CTO"],
        "description": "White-glove enterprise tier with guaranteed response.",
        "is_active": True,
    },
]


async def _seed_if_empty():
    count = await db.service_tiers.count_documents({})
    if count == 0:
        now = datetime.now(timezone.utc).isoformat()
        for t in DEFAULT_TIERS:
            await db.service_tiers.insert_one({**t, "created_at": now, "is_default": True})


async def _is_admin(user_id: str) -> bool:
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "role": 1, "is_admin": 1})
    return bool(u and (u.get("role") == "admin" or u.get("is_admin")))


@router.get("/service-tiers")
async def list_service_tiers(current_user: dict = Depends(get_current_user)):
    await _seed_if_empty()
    tiers = await db.service_tiers.find({}, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return tiers


@router.get("/service-tiers/{tier_id}")
async def get_service_tier(tier_id: str, current_user: dict = Depends(get_current_user)):
    await _seed_if_empty()
    tier = await db.service_tiers.find_one({"id": tier_id}, {"_id": 0})
    if not tier:
        raise HTTPException(status_code=404, detail="Service tier not found")
    return tier


@router.post("/service-tiers")
async def create_service_tier(data: dict, current_user: dict = Depends(get_current_user)):
    if not await _is_admin(current_user["id"]):
        raise HTTPException(status_code=403, detail="Admin access required")
    tier = {
        "id": f"tier-{uuid.uuid4().hex[:8]}",
        "name": data.get("name", "New Tier"),
        "slug": data.get("slug", "custom"),
        "color": data.get("color", "#a78bfa"),
        "icon": data.get("icon", "shield"),
        "sort_order": data.get("sort_order", 99),
        "response_sla_minutes": int(data.get("response_sla_minutes", 60 * 8)),
        "resolution_sla_minutes": int(data.get("resolution_sla_minutes", 60 * 24 * 3)),
        "monthly_price": float(data.get("monthly_price", 0)),
        "features": data.get("features", []),
        "description": data.get("description", ""),
        "is_active": True,
        "is_default": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.service_tiers.insert_one({**tier})
    return tier


@router.patch("/service-tiers/{tier_id}")
async def update_service_tier(tier_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    if not await _is_admin(current_user["id"]):
        raise HTTPException(status_code=403, detail="Admin access required")
    # Whitelist editable fields
    allowed = {"name", "slug", "color", "icon", "sort_order", "response_sla_minutes",
               "resolution_sla_minutes", "monthly_price", "features", "description", "is_active"}
    patch = {k: v for k, v in data.items() if k in allowed}
    if not patch:
        raise HTTPException(status_code=400, detail="No editable fields supplied")
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.service_tiers.update_one({"id": tier_id}, {"$set": patch})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Service tier not found")
    return await db.service_tiers.find_one({"id": tier_id}, {"_id": 0})


@router.delete("/service-tiers/{tier_id}")
async def delete_service_tier(tier_id: str, current_user: dict = Depends(get_current_user)):
    if not await _is_admin(current_user["id"]):
        raise HTTPException(status_code=403, detail="Admin access required")
    tier = await db.service_tiers.find_one({"id": tier_id}, {"_id": 0})
    if not tier:
        raise HTTPException(status_code=404, detail="Service tier not found")
    if tier.get("is_default"):
        # Soft-delete defaults so user can re-enable later
        await db.service_tiers.update_one({"id": tier_id}, {"$set": {"is_active": False}})
        return {"message": "Default tier deactivated"}
    # Unassign clients on this tier
    await db.clients.update_many({"service_tier_id": tier_id}, {"$unset": {"service_tier_id": ""}})
    await db.service_tiers.delete_one({"id": tier_id})
    return {"message": "Tier deleted"}


# ── Assign a tier to a client ─────────────────────────────────────────────
@router.patch("/clients/{client_id}/service-tier")
async def assign_client_tier(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    tier_id = data.get("service_tier_id")
    if tier_id is None:
        raise HTTPException(status_code=400, detail="service_tier_id required (or null to clear)")
    if tier_id:
        tier = await db.service_tiers.find_one({"id": tier_id, "is_active": True}, {"_id": 0})
        if not tier:
            raise HTTPException(status_code=404, detail="Service tier not found")
    update = {"service_tier_id": tier_id} if tier_id else {}
    unset = {} if tier_id else {"service_tier_id": ""}
    ops = {}
    if update:
        ops["$set"] = {**update, "updated_at": datetime.now(timezone.utc).isoformat()}
    if unset:
        ops["$unset"] = unset
        ops.setdefault("$set", {})["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.clients.update_one({"id": client_id}, ops)
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"message": "Tier assigned", "service_tier_id": tier_id}


# ── For ticket detail view: get the tier for a ticket's client ────────────
@router.get("/tickets/{ticket_id}/service-tier")
async def get_ticket_service_tier(ticket_id: str, current_user: dict = Depends(get_current_user)):
    await _seed_if_empty()
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "client_id": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    client = await db.clients.find_one({"id": ticket.get("client_id")}, {"_id": 0, "service_tier_id": 1, "name": 1})
    if not client:
        return {"tier": None, "client_id": ticket.get("client_id")}
    tier_id = client.get("service_tier_id")
    if not tier_id:
        return {"tier": None, "client_id": client.get("id"), "client_name": client.get("name")}
    tier = await db.service_tiers.find_one({"id": tier_id}, {"_id": 0})
    return {"tier": tier, "client_id": ticket.get("client_id"), "client_name": client.get("name")}
