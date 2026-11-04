"""Evidence-driven achievement awarding (the badge engine).

Given a technician's accountable evidence — closed tickets, invoices, remote
sessions, workshop and field jobs, completed onboarding checklists, lifetime
points, tenure and birthday — this engine awards every milestone badge the
tech has earned but not yet received.

It is the single write path for automatic badge awards, shared by:

* ``POST /technicians/{tech_id}/achievements/check`` — one technician on demand
* ``POST /achievements/recompute`` — team-wide retro-award / scheduler sweep

Awards are idempotent: already-earned badge ids are never re-awarded and the
zero-threshold event badges (birthday, Shop Opener) are deliberately excluded
so re-running the sweep can never be farmed.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.achievement_catalog import ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_POINTS
from app.services.tech_rewards import award_points

FALLBACK_BADGE_POINTS = 75


def badge_points(definition: dict[str, Any]) -> int:
    """Economy value of one badge award (category map, with fallback)."""
    return int(ACHIEVEMENT_POINTS.get(str(definition.get("category") or "custom"), FALLBACK_BADGE_POINTS))


def _award_entry(user: dict[str, Any], definition: dict[str, Any], note: str) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user.get("name"),
        "achievement_id": definition["id"],
        "achievement_name": definition["name"],
        "awarded_by": "System",
        "awarded_at": datetime.now(timezone.utc).isoformat(),
        "note": note,
    }


async def run_achievement_check(
    db: Any,
    user: dict[str, Any],
    *,
    tenant_id: str,
    actor: dict[str, Any],
) -> dict[str, Any]:
    """Award every missing milestone badge for one technician.

    Returns ``{"newly_awarded": [names], "total_earned": int,
    "points_earned": int}``.  Badge points are granted in one ledger entry
    valued by the shared category→points policy.
    """
    tech_id = user["id"]
    earned = await db.user_achievements.find({"user_id": tech_id}, {"_id": 0}).to_list(500)
    earned_ids = {e["achievement_id"] for e in earned}
    newly_awarded: list[str] = []
    newly_ids: list[str] = []

    def _consider(definition: dict[str, Any], metric, label: str) -> None:
        if (
            definition["id"] not in earned_ids
            and definition["threshold"] > 0
            and metric >= definition["threshold"]
        ):
            newly_awarded.append(definition["name"])
            newly_ids.append(definition["id"])
            pending.append((_award_entry(user, definition, f"Auto-awarded: {metric} {label}"), definition))

    pending: list[tuple[dict[str, Any], dict[str, Any]]] = []

    # Accountable evidence streams. Field names mirror the real collections:
    # tickets store assigned_to/assigned_name; remote sessions store user_id.
    closed_tickets = await db.tickets.count_documents(
        {"assigned_to": tech_id, "status": {"$in": ["closed", "resolved"]}}
    )
    invoices_created = await db.activity_logs.count_documents(
        {"user_id": tech_id, "entity_type": "invoice", "action": "created"}
    )
    remote_count = await db.remote_sessions.count_documents(
        {"user_id": tech_id, "status": "ended"}
    )
    workshop_done = await db.workshop_jobs.count_documents(
        {"assigned_to": tech_id, "repair_status": "collected"}
    )
    field_done = await db.field_jobs.count_documents(
        {"assigned_to": tech_id, "field_status": "completed"}
    )
    checklists_done = await db.onboarding_checklist_runs.count_documents(
        {"technician_id": tech_id, "status": "completed"}
    )
    points_ledger = await db.tech_points_ledger.find({"user_id": tech_id}, {"_id": 0}).to_list(5000)
    lifetime_points = sum(int(e.get("delta") or 0) for e in points_ledger if int(e.get("delta") or 0) > 0)

    metrics = [
        ("tickets", closed_tickets, "tickets closed"),
        ("invoices", invoices_created, "invoices created"),
        ("remote", remote_count, "remote sessions"),
        ("workshop", workshop_done, "workshop jobs completed"),
        ("field", field_done, "field jobs completed"),
        ("onboarding", checklists_done, "onboarding checklists completed"),
        ("points", lifetime_points, "lifetime points earned"),
    ]

    # Tenure evidence.
    hire_date = user.get("hire_date")
    days_employed = None
    if hire_date:
        try:
            hd = datetime.fromisoformat(hire_date)
            days_employed = (datetime.now(timezone.utc) - hd).days
        except (TypeError, ValueError):
            days_employed = None
    if days_employed is not None:
        metrics.append(("tenure", days_employed, "days employed"))

    for category, metric, label in metrics:
        for definition in ACHIEVEMENT_DEFINITIONS:
            if definition["category"] == category:
                _consider(definition, metric, label)

    # Birthday is a true event badge: awarded only on the day itself.
    birthday = user.get("birthday")
    if birthday and "birthday" not in earned_ids:
        try:
            today = datetime.now(timezone.utc)
            bd = datetime.fromisoformat(birthday)
            if bd.month == today.month and bd.day == today.day:
                definition = next(d for d in ACHIEVEMENT_DEFINITIONS if d["id"] == "birthday")
                newly_awarded.append(definition["name"])
                newly_ids.append(definition["id"])
                pending.append((_award_entry(user, definition, "Happy Birthday!"), definition))
        except (TypeError, ValueError):
            pass

    for entry, _definition in pending:
        await db.user_achievements.insert_one(dict(entry))

    points_earned = 0
    if newly_awarded:
        delta = sum(badge_points(d) for _, d in pending)
        ledger_entry = await award_points(
            db,
            user_id=tech_id,
            tenant_id=tenant_id,
            delta=delta,
            kind="earn",
            reason=f"Achievements unlocked: {', '.join(newly_awarded[:5])}",
            actor=actor,
            reference_id=f"achievements-check:{tech_id}:{len(earned_ids) + len(newly_awarded)}",
        )
        points_earned = ledger_entry["delta"]

    return {
        "newly_awarded": newly_awarded,
        "newly_awarded_ids": newly_ids,
        "total_earned": len(earned_ids) + len(newly_awarded),
        "points_earned": points_earned,
    }
