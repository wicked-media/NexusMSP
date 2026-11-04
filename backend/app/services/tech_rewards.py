"""Domain policy for the technician points economy.

Points are earned from accountable work (checklist completion, achievement
awards, admin grants) and are recorded on an append-only ledger.  They can be
spent on cosmetic reward items: pets, profile skins and titles.  Cosmetics
never grant operational authority.

All policy functions are pure so they can be contract-tested without a
database.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

REWARD_KINDS = frozenset({"pet", "skin", "title"})
RARITIES = frozenset({"common", "rare", "epic", "legendary"})
LEDGER_ENTRY_KINDS = frozenset({"earn", "spend", "grant", "refund", "adjustment"})

MAX_GRANT_POINTS = 100_000
MAX_CATALOG_ITEMS = 500


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ------------------------------------------------------------------
# Seed catalog: starter pets, skins and titles.  Item ids are stable
# Nexus ids so inventory rows never key on display names.
# ------------------------------------------------------------------
DEFAULT_CATALOG: list[dict[str, Any]] = [
    # Pets
    {"id": "pet-byte", "kind": "pet", "name": "Byte the Packet Pup", "description": "A loyal cyber-pup who guards the ticket queue.", "rarity": "common", "price_points": 250, "emoji": "🐶", "accent": "#22d3ee"},
    {"id": "pet-owl", "kind": "pet", "name": "Nyx the Night Owl", "description": "Perfect for after-hours maintenance windows.", "rarity": "common", "price_points": 250, "emoji": "🦉", "accent": "#a78bfa"},
    {"id": "pet-fox", "kind": "pet", "name": "Patch the Fox", "description": "Clever, quick, and always carries a spare cable.", "rarity": "rare", "price_points": 600, "emoji": "🦊", "accent": "#fb923c"},
    {"id": "pet-dragon", "kind": "pet", "name": "Firewall the Dragon", "description": "Breathes uptime. Allergic to unplanned outages.", "rarity": "epic", "price_points": 1500, "emoji": "🐉", "accent": "#f43f5e"},
    {"id": "pet-unicorn", "kind": "pet", "name": "Aurora the Unicorn", "description": "The legendary companion of zero-touch deployments.", "rarity": "legendary", "price_points": 4000, "emoji": "🦄", "accent": "#e879f9"},
    # Skins
    {"id": "skin-neon", "kind": "skin", "name": "Neon Uplink", "description": "Electric cyan glow for your profile and ticket cards.", "rarity": "common", "price_points": 300, "accent": "#22d3ee", "tokens": {"primary": "#22d3ee", "surface": "#0e2a33"}},
    {"id": "skin-solar", "kind": "skin", "name": "Solar Flare", "description": "Warm amber energy for a high-velocity week.", "rarity": "rare", "price_points": 700, "accent": "#f59e0b", "tokens": {"primary": "#f59e0b", "surface": "#33240a"}},
    {"id": "skin-void", "kind": "skin", "name": "Void Runner", "description": "Deep violet stealth styling.", "rarity": "rare", "price_points": 700, "accent": "#8b5cf6", "tokens": {"primary": "#8b5cf6", "surface": "#241540"}},
    {"id": "skin-emerald", "kind": "skin", "name": "Emerald Ops", "description": "Mission-control green with a calm finish.", "rarity": "epic", "price_points": 1600, "accent": "#10b981", "tokens": {"primary": "#10b981", "surface": "#0c2b22"}},
    {"id": "skin-prism", "kind": "skin", "name": "Prism Shift", "description": "A legendary animated spectrum skin.", "rarity": "legendary", "price_points": 4200, "accent": "#f472b6", "tokens": {"primary": "#f472b6", "surface": "#2b1420"}},
    # Titles
    {"id": "title-resolver", "kind": "title", "name": "The Resolver", "description": "Shown beside your name in chat and tickets.", "rarity": "common", "price_points": 150, "accent": "#22c55e"},
    {"id": "title-guardian", "kind": "title", "name": "Uptime Guardian", "description": "For those who keep the lights on.", "rarity": "rare", "price_points": 500, "accent": "#3b82f6"},
    {"id": "title-architect", "kind": "title", "name": "Automation Architect", "description": "Builder of pipelines, tamer of toil.", "rarity": "epic", "price_points": 1400, "accent": "#a78bfa"},
    {"id": "title-legend", "kind": "title", "name": "Nexus Legend", "description": "Reserved for the truly exceptional.", "rarity": "legendary", "price_points": 3800, "accent": "#f59e0b"},
    # Pets: second wave
    {"id": "pet-cat", "kind": "pet", "name": "Cache the Cat", "description": "Always lands on its feet — even during a rollback.", "rarity": "common", "price_points": 250, "emoji": "🐱", "accent": "#f472b6"},
    {"id": "pet-penguin", "kind": "pet", "name": "Tux the Pingwin", "description": "Small, sturdy, and completely immune to Windows updates.", "rarity": "common", "price_points": 250, "emoji": "🐧", "accent": "#60a5fa"},
    {"id": "pet-octopus", "kind": "pet", "name": "Inky the Octopus", "description": "Eight arms, eight parallel ticket threads.", "rarity": "rare", "price_points": 650, "emoji": "🐙", "accent": "#a78bfa"},
    {"id": "pet-honeybadger", "kind": "pet", "name": "The Honey Badger", "description": "Does not care about your production outage. Fixes it anyway.", "rarity": "epic", "price_points": 1600, "emoji": "🦡", "accent": "#f59e0b"},
    {"id": "pet-phoenix", "kind": "pet", "name": "Ember the Phoenix", "description": "Rises from every disaster-recovery drill, fully restored.", "rarity": "legendary", "price_points": 4500, "emoji": "🔥", "accent": "#ef4444"},
    # Skins: second wave
    {"id": "skin-frost", "kind": "skin", "name": "Frostbyte", "description": "Cool ice-blue styling for calm incident command.", "rarity": "common", "price_points": 300, "accent": "#38bdf8", "tokens": {"primary": "#38bdf8", "surface": "#0c2733"}},
    {"id": "skin-sakura", "kind": "skin", "name": "Sakura Drift", "description": "Soft pink petals drift across your profile.", "rarity": "rare", "price_points": 750, "accent": "#f472b6", "tokens": {"primary": "#f472b6", "surface": "#2e1420"}},
    {"id": "skin-obsidian", "kind": "skin", "name": "Obsidian Core", "description": "Matte black with a molten red edge.", "rarity": "epic", "price_points": 1700, "accent": "#f87171", "tokens": {"primary": "#f87171", "surface": "#1a1113"}},
    {"id": "skin-aurora", "kind": "skin", "name": "Aurora Wave", "description": "A legendary northern-lights shimmer.", "rarity": "legendary", "price_points": 4300, "accent": "#34d399", "tokens": {"primary": "#34d399", "surface": "#0b2b23"}},
    {"id": "skin-goldrush", "kind": "skin", "name": "Gold Rush", "description": "Because platinum-level support deserves gold.", "rarity": "epic", "price_points": 1800, "accent": "#fbbf24", "tokens": {"primary": "#fbbf24", "surface": "#2c220a"}},
    # Titles: second wave
    {"id": "title-firefighter", "kind": "title", "name": "Chief Firefighter", "description": "For the tech who runs toward the outage.", "rarity": "common", "price_points": 150, "accent": "#ef4444"},
    {"id": "title-whisperer", "kind": "title", "name": "Printer Whisperer", "description": "A rare and ancient power. Respect.", "rarity": "rare", "price_points": 550, "accent": "#14b8a6"},
    {"id": "title-marathon", "kind": "title", "name": "Marathon Closer", "description": "Closed more tickets before lunch than most do all day.", "rarity": "epic", "price_points": 1500, "accent": "#f97316"},
    {"id": "title-immortal", "kind": "title", "name": "The Immortal", "description": "Legendary status across every queue.", "rarity": "legendary", "price_points": 3900, "accent": "#e879f9"},
]

DEFAULT_POINTS_PER_ITEM = 25
CHECKLIST_COMPLETION_BONUS = 100


def catalog_view(item: dict[str, Any]) -> dict[str, Any]:
    """Public projection of a reward catalog item."""
    return {key: value for key, value in item.items() if key != "_id"}


def normalise_catalog_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate a custom reward item definition."""
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="reward name is required")
    kind = str(payload.get("kind") or "").strip().lower()
    if kind not in REWARD_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"reward kind must be one of: {', '.join(sorted(REWARD_KINDS))}",
        )
    rarity = str(payload.get("rarity") or "common").strip().lower() or "common"
    if rarity not in RARITIES:
        raise HTTPException(
            status_code=400,
            detail=f"rarity must be one of: {', '.join(sorted(RARITIES))}",
        )
    try:
        price = int(payload.get("price_points") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="price_points must be an integer")
    if price < 0 or price > MAX_GRANT_POINTS:
        raise HTTPException(status_code=400, detail="price_points out of range")
    return {
        "id": f"reward-{uuid.uuid4().hex[:10]}",
        "kind": kind,
        "name": name[:120],
        "description": str(payload.get("description") or "")[:600],
        "rarity": rarity,
        "price_points": price,
        "emoji": str(payload.get("emoji") or "✨")[:8],
        "accent": str(payload.get("accent") or "#22d3ee")[:20],
        "custom": True,
    }


def ledger_entry(
    *,
    tenant_id: str,
    user_id: str,
    delta: int,
    kind: str,
    reason: str,
    actor: dict[str, Any],
    balance_after: int,
    reference_id: str | None = None,
) -> dict[str, Any]:
    """Build an append-only points ledger entry."""
    if kind not in LEDGER_ENTRY_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"ledger kind must be one of: {', '.join(sorted(LEDGER_ENTRY_KINDS))}",
        )
    try:
        delta = int(delta)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="points delta must be an integer")
    return {
        "id": f"pts-{uuid.uuid4().hex[:12]}",
        "tenant_id": tenant_id,
        "user_id": user_id,
        "delta": delta,
        "kind": kind,
        "reason": str(reason or "")[:300],
        "reference_id": reference_id,
        "balance_after": balance_after,
        "awarded_by": actor.get("id"),
        "awarded_by_name": actor.get("name") or actor.get("email") or "",
        "created_at": _now(),
    }


def validate_grant(delta: int) -> int:
    """Validate an admin points grant."""
    try:
        delta = int(delta)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="points must be an integer")
    if delta == 0:
        raise HTTPException(status_code=400, detail="points grant cannot be zero")
    if abs(delta) > MAX_GRANT_POINTS:
        raise HTTPException(status_code=400, detail=f"points grant cannot exceed {MAX_GRANT_POINTS}")
    return delta


def validate_purchase(
    item: dict[str, Any],
    *,
    balance: int,
    owned_item_ids: set[str],
) -> int:
    """Validate a reward purchase and return the points cost.

    Purchases are rejected for unaffordable or already-owned items so a
    technician can never lose points twice for the same cosmetic.
    """
    if item["id"] in owned_item_ids:
        raise HTTPException(status_code=409, detail="You already own this reward")
    cost = int(item.get("price_points") or 0)
    if cost <= 0:
        raise HTTPException(status_code=400, detail="This reward is not for sale")
    if balance < cost:
        raise HTTPException(
            status_code=402,
            detail=f"Not enough points: this reward costs {cost}, you have {balance}",
        )
    return cost


def inventory_entry(
    *,
    tenant_id: str,
    user_id: str,
    item: dict[str, Any],
) -> dict[str, Any]:
    """Build an inventory row for an owned reward item."""
    now = _now()
    return {
        "id": f"inv-{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant_id,
        "user_id": user_id,
        "item_id": item["id"],
        "kind": item["kind"],
        "name": item["name"],
        "emoji": item.get("emoji", "✨"),
        "accent": item.get("accent", "#22d3ee"),
        "equipped": False,
        "acquired_at": now,
    }


def apply_equip(inventory: list[dict[str, Any]], item_id: str, *, equip: bool) -> list[dict[str, Any]]:
    """Equip or unequip an owned item.

    Only one pet and one skin may be equipped at a time; titles are mutually
    exclusive as well, so equipping clears any sibling in the same kind.
    """
    target = next((row for row in inventory if row["item_id"] == item_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="You do not own this reward")
    if equip:
        for row in inventory:
            if row["kind"] == target["kind"]:
                row["equipped"] = row["item_id"] == item_id
    else:
        target["equipped"] = False
    return inventory


async def award_points(
    db: Any,
    *,
    user_id: str,
    tenant_id: str,
    delta: int,
    kind: str,
    reason: str,
    actor: dict[str, Any],
    reference_id: str | None = None,
) -> dict[str, Any]:
    """Append one ledger entry with the resulting balance.

    This is the single write path for the points economy: every earn, spend,
    grant and adjustment goes through the append-only ledger so balances stay
    auditable and reconstructable.
    """
    delta = int(delta)
    if delta == 0:
        raise HTTPException(status_code=400, detail="points delta cannot be zero")
    previous = await db.tech_points_ledger.find(
        {"tenant_id": tenant_id, "user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(1).to_list(1)
    balance_after = (int(previous[0]["balance_after"]) if previous else 0) + delta
    entry = ledger_entry(
        tenant_id=tenant_id,
        user_id=user_id,
        delta=delta,
        kind=kind,
        reason=reason,
        actor=actor,
        balance_after=balance_after,
        reference_id=reference_id,
    )
    await db.tech_points_ledger.insert_one(entry)
    entry.pop("_id", None)
    return entry


def points_summary(ledger: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarise a user's ledger into balance and lifetime figures."""
    earned = sum(entry["delta"] for entry in ledger if entry["delta"] > 0)
    spent = sum(entry["delta"] for entry in ledger if entry["delta"] < 0)
    return {
        "balance": earned + spent,
        "lifetime_earned": earned,
        "lifetime_spent": abs(spent),
        "entries": len(ledger),
    }
