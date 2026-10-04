"""Technician points economy: earn points, spend them on pets, skins and titles.

Points are earned from accountable work — checklist runs, achievement awards
and admin grants — and tracked on an append-only ledger.  Points buy cosmetic
reward items (pets, profile skins, titles) which never grant operational
authority.

Routes stay thin: validation and transition policy live in
``app.services.tech_rewards``.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query
from app.services.tech_rewards import (
    CHECKLIST_COMPLETION_BONUS,
    DEFAULT_CATALOG,
    apply_equip,
    award_points,
    catalog_view,
    inventory_entry,
    normalise_catalog_payload,
    points_summary,
    validate_grant,
    validate_purchase,
)

router = APIRouter()


def _require_admin(current_user: dict) -> None:
    if not (current_user.get("is_admin") or current_user.get("role") == "admin"):
        raise HTTPException(status_code=403, detail="Admin access required")


async def _balance(user_id: str, tenant_id: str) -> int:
    entry = await db.tech_points_ledger.find(
        {"tenant_id": tenant_id, "user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(1).to_list(1)
    return int(entry[0]["balance_after"]) if entry else 0


async def _ledger(user_id: str, tenant_id: str, limit: int = 200) -> list[dict]:
    return await db.tech_points_ledger.find(
        {"tenant_id": tenant_id, "user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)


async def _ensure_catalog(tenant_id: str) -> None:
    """Seed the tenant's reward catalog once so the shop is never empty."""
    count = await db.reward_catalog.count_documents({"tenant_id": tenant_id})
    if count:
        return
    from pymongo.errors import DuplicateKeyError
    for item in DEFAULT_CATALOG:
        document = {**item, "tenant_id": tenant_id, "custom": False}
        try:
            await db.reward_catalog.insert_one(document)
        except DuplicateKeyError:
            return
        document.pop("_id", None)


async def _award(
    *,
    user_id: str,
    tenant_id: str,
    delta: int,
    kind: str,
    reason: str,
    actor: dict,
    reference_id: str | None = None,
) -> dict:
    """Append one ledger entry with the resulting balance."""
    return await award_points(
        db,
        user_id=user_id,
        tenant_id=tenant_id,
        delta=delta,
        kind=kind,
        reason=reason,
        actor=actor,
        reference_id=reference_id,
    )


# ============== CATALOG / SHOP ==============


@router.get("/tech-rewards/catalog")
async def list_reward_catalog(current_user: dict = Depends(get_current_user)):
    """The reward shop: pets, skins and titles available in this tenant."""
    tenant_id = platform_tenant_id(current_user)
    await _ensure_catalog(tenant_id)
    items = await db.reward_catalog.find(
        tenant_scoped_query(current_user, {}), {"_id": 0}
    ).sort("kind", 1).to_list(200)
    owned = await db.tech_inventory.find(
        tenant_scoped_query(current_user, {"user_id": current_user["id"]}), {"_id": 0}
    ).to_list(200)
    owned_ids = {row["item_id"] for row in owned}
    return [dict(catalog_view(item), owned=item["id"] in owned_ids) for item in items]


@router.post("/tech-rewards/catalog")
async def create_reward_item(data: dict, current_user: dict = Depends(get_current_user)):
    """Admins can add custom pets/skins/titles to the shop."""
    _require_admin(current_user)
    document = normalise_catalog_payload(data)
    document["tenant_id"] = platform_tenant_id(current_user)
    await db.reward_catalog.insert_one(document)
    document.pop("_id", None)
    await log_activity(
        current_user, "created", "tech_reward_item", document["id"],
        document["name"], "Added a reward item to the points shop",
        metadata={"kind": document["kind"], "price_points": document["price_points"]},
    )
    return document


# ============== BALANCE / LEDGER ==============


@router.get("/tech-rewards/me")
async def my_rewards(user_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Points balance, owned inventory and currently equipped cosmetics."""
    target_id = user_id or current_user["id"]
    tenant_id = platform_tenant_id(current_user)
    inventory = await db.tech_inventory.find(
        tenant_scoped_query(current_user, {"user_id": target_id}), {"_id": 0}
    ).sort("acquired_at", -1).to_list(200)
    ledger = await _ledger(target_id, tenant_id)
    summary = points_summary(ledger)
    return {
        "user_id": target_id,
        "points": summary,
        "inventory": inventory,
        "equipped_pet": next((r for r in inventory if r["kind"] == "pet" and r.get("equipped")), None),
        "equipped_skin": next((r for r in inventory if r["kind"] == "skin" and r.get("equipped")), None),
        "equipped_title": next((r for r in inventory if r["kind"] == "title" and r.get("equipped")), None),
        "recent_ledger": ledger[:25],
    }


@router.get("/tech-rewards/leaderboard")
async def points_leaderboard(current_user: dict = Depends(get_current_user)):
    """Lifetime points-earned leaderboard across the team."""
    tenant_id = platform_tenant_id(current_user)
    ledger = await db.tech_points_ledger.find(
        tenant_scoped_query(current_user, {}), {"_id": 0}
    ).to_list(5000)
    totals: dict[str, dict] = {}
    for entry in ledger:
        row = totals.setdefault(entry["user_id"], {"user_id": entry["user_id"], "earned": 0, "spent": 0})
        if entry["delta"] > 0:
            row["earned"] += entry["delta"]
        else:
            row["spent"] += abs(entry["delta"])
    for row in totals.values():
        row["balance"] = row["earned"] - row["spent"]
        owned = await db.tech_inventory.find(
            tenant_scoped_query(current_user, {"user_id": row["user_id"]}),
            {"_id": 0, "item_id": 1, "kind": 1, "equipped": 1, "name": 1, "emoji": 1, "accent": 1},
        ).to_list(50)
        row["pets_owned"] = sum(1 for o in owned if o["kind"] == "pet")
        row["equipped_pet"] = next((o for o in owned if o["kind"] == "pet" and o.get("equipped")), None)
    return sorted(totals.values(), key=lambda row: row["earned"], reverse=True)


# ============== GRANT / SPEND ==============


@router.post("/tech-rewards/award")
async def grant_points(data: dict, current_user: dict = Depends(get_current_user)):
    """Admin grant (or deduct) points for accountable work."""
    _require_admin(current_user)
    user_id = str(data.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Technician not found")
    delta = validate_grant(int(data.get("points") or 0))
    entry = await _award(
        user_id=user_id,
        tenant_id=platform_tenant_id(current_user),
        delta=delta,
        kind="grant" if delta > 0 else "adjustment",
        reason=str(data.get("reason") or "Admin award"),
        actor=current_user,
    )
    await log_activity(
        current_user, "created", "tech_points_grant", entry["id"],
        f"{delta:+d} points", "Granted technician reward points",
        metadata={"user_id": user_id, "delta": delta},
    )
    return entry


@router.post("/tech-rewards/checklists/{run_id}/award")
async def award_checklist_points(run_id: str, current_user: dict = Depends(get_current_user)):
    """Award points for a completed checklist run (idempotent per run)."""
    run = await db.onboarding_checklist_runs.find_one(
        tenant_scoped_query(current_user, {"id": run_id}), {"_id": 0}
    )
    if not run:
        raise HTTPException(status_code=404, detail="Checklist run not found")
    if run.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Points are awarded when the run is completed")
    existing = await db.tech_points_ledger.find_one(
        {"tenant_id": platform_tenant_id(current_user), "reference_id": run_id}
    )
    if existing:
        return {"message": "Points already awarded for this run", "already_awarded": True}
    user_id = run.get("technician_id") or current_user["id"]
    item_points = sum(int(item.get("points") or 0) for item in run.get("items", []))
    delta = item_points + CHECKLIST_COMPLETION_BONUS
    entry = await _award(
        user_id=user_id,
        tenant_id=platform_tenant_id(current_user),
        delta=delta,
        kind="earn",
        reason=f"Completed onboarding checklist: {run.get('template_name', 'checklist')}",
        actor=current_user,
        reference_id=run_id,
    )
    return {"message": "Checklist points awarded", "points": delta, "ledger_entry": entry}


@router.post("/tech-rewards/purchase")
async def purchase_reward(data: dict, current_user: dict = Depends(get_current_user)):
    """Spend points on a pet, skin or title."""
    item_id = str(data.get("item_id") or "").strip()
    if not item_id:
        raise HTTPException(status_code=400, detail="item_id is required")
    tenant_id = platform_tenant_id(current_user)
    item = await db.reward_catalog.find_one(
        tenant_scoped_query(current_user, {"id": item_id}), {"_id": 0}
    )
    if not item:
        raise HTTPException(status_code=404, detail="Reward item not found")
    inventory = await db.tech_inventory.find(
        tenant_scoped_query(current_user, {"user_id": current_user["id"]}), {"_id": 0}
    ).to_list(200)
    owned_ids = {row["item_id"] for row in inventory}
    balance = await _balance(current_user["id"], tenant_id)
    cost = validate_purchase(item, balance=balance, owned_item_ids=owned_ids)
    await _award(
        user_id=current_user["id"],
        tenant_id=tenant_id,
        delta=-cost,
        kind="spend",
        reason=f"Purchased {item['name']}",
        actor=current_user,
        reference_id=item_id,
    )
    entry = inventory_entry(tenant_id=tenant_id, user_id=current_user["id"], item=item)
    await db.tech_inventory.insert_one(entry)
    entry.pop("_id", None)
    await log_activity(
        current_user, "created", "tech_reward_purchase", entry["id"],
        item["name"], "Purchased a reward item with points",
        metadata={"item_id": item_id, "cost": cost, "kind": item["kind"]},
    )
    return {"message": f"{item['name']} is yours!", "inventory": entry, "points_spent": cost}


@router.post("/tech-rewards/equip")
async def equip_reward(data: dict, current_user: dict = Depends(get_current_user)):
    """Equip or unequip an owned pet, skin or title."""
    item_id = str(data.get("item_id") or "").strip()
    equip = bool(data.get("equip", True))
    if not item_id:
        raise HTTPException(status_code=400, detail="item_id is required")
    inventory = await db.tech_inventory.find(
        tenant_scoped_query(current_user, {"user_id": current_user["id"]}), {"_id": 0}
    ).to_list(200)
    updated = apply_equip(inventory, item_id, equip=equip)
    for row in updated:
        await db.tech_inventory.update_one(
            tenant_scoped_query(current_user, {"id": row["id"]}),
            {"$set": {"equipped": row["equipped"]}},
        )
    return {"message": "Loadout updated", "inventory": updated}
