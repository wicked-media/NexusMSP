"""Technician-governed, evidence-backed ticket routing."""

from datetime import datetime, timezone, timedelta
from typing import Any
from zoneinfo import ZoneInfo
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db


router = APIRouter()
SKILL_CATEGORIES = ["networking", "security", "cloud", "hardware", "software", "email", "backup", "voip", "printing", "database"]
_DAY_NAMES = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _routing_availability(working_hours: dict) -> tuple[bool, bool]:
    working_hours = working_hours or {}
    auto_assign = working_hours.get("auto_assign", True) is not False
    if working_hours.get("on_call"):
        return True, auto_assign
    try:
        now = datetime.now(ZoneInfo(working_hours.get("timezone") or "Australia/Sydney"))
    except Exception:
        now = datetime.now(timezone.utc)
    day = (working_hours.get("schedule") or {}).get(_DAY_NAMES[now.weekday()], {})
    if not day.get("enabled"):
        return False, auto_assign
    start, end = day.get("start") or "", day.get("end") or ""
    if not start or not end:
        return False, auto_assign
    return start <= now.strftime("%H:%M") < end, auto_assign


def _skills(value: Any) -> dict[str, int]:
    source = value if isinstance(value, dict) else {}
    cleaned: dict[str, int] = {}
    for category, level in source.items():
        if str(category).lower() not in SKILL_CATEGORIES or isinstance(level, bool):
            continue
        try:
            numeric = int(level)
        except (TypeError, ValueError):
            continue
        if 1 <= numeric <= 5:
            cleaned[str(category).lower()] = numeric
    return cleaned


def _confirmed_rule(rule: dict) -> bool:
    return str(rule.get("source") or "").lower() == "manual" and bool(rule.get("confirmed_at"))


def _dedupe_technicians(rows: list[dict]) -> list[dict]:
    """Collapse legacy duplicate user documents before calculating capacity.

    Several older seed/import paths could leave repeated documents with the
    same Nexus user ID. Routing must treat one human as one technician or both
    workload totals and assignment candidates become misleading.
    """
    unique = {}
    for row in rows:
        identifier = str(row.get("id") or "").strip()
        email = str(row.get("email") or "").strip().lower()
        key = identifier or email
        if not key:
            continue
        unique.setdefault(key, row)
    return list(unique.values())


def _ticket_category(ticket: dict) -> str:
    return str(ticket.get("category") or ticket.get("issue_category") or ticket.get("service_category") or "").strip().lower()


def _matches(rule: dict, ticket: dict) -> bool:
    if not rule.get("enabled", True):
        return False
    priority = str(rule.get("priority") or "").strip().lower()
    category = str(rule.get("category") or "").strip().lower()
    ticket_priority = str(ticket.get("priority") or "").strip().lower()
    return (not priority or priority == ticket_priority) and (not category or category == _ticket_category(ticket))


def _route_scores(candidates: list[dict], *, category: str, method: str) -> list[dict]:
    scored = []
    for candidate in candidates:
        capacity_score = max(0, 100 - candidate["open_tickets"] * 15)
        skill_level = candidate["skills"].get(category) if category else None
        if method in {"skill_match", "highest_skill"} and category and skill_level is None:
            continue
        skill_score = skill_level * 20 if skill_level is not None else None
        availability_score = 100 if candidate["open_tickets"] < 6 else 50
        if method == "highest_skill" and skill_score is not None:
            total = skill_score * 0.7 + capacity_score * 0.2 + availability_score * 0.1
        elif method == "skill_match" and skill_score is not None:
            total = skill_score * 0.5 + capacity_score * 0.35 + availability_score * 0.15
        else:
            # Least-loaded and round-robin both use a deterministic capacity
            # tie-breaker until a dedicated rotation provider is implemented.
            total = capacity_score * 0.8 + availability_score * 0.2
        scored.append({**candidate, "routing_score": round(total, 1), "capacity_score": capacity_score, "skill_score": skill_score, "availability_score": availability_score})
    return sorted(scored, key=lambda item: (-item["routing_score"], item["open_tickets"], item["id"]))


async def _technician_candidates() -> list[dict]:
    technicians = _dedupe_technicians(
        await db.users.find(
            {"role": {"$in": ["technician", "admin"]}},
            {"_id": 0, "id": 1, "name": 1, "email": 1},
        ).to_list(100)
    )
    candidates = []
    for technician in technicians:
        settings = await db.user_settings.find_one({"user_id": technician["id"]}, {"_id": 0}) or {}
        working_hours = settings.get("working_hours", {})
        available, opted_in = _routing_availability(working_hours)
        open_tickets = await db.tickets.count_documents({"assigned_to": technician["id"], "status": {"$in": ["open", "in_progress"]}})
        skills_profile = await db.tech_skills.find_one({"user_id": technician["id"]}, {"_id": 0}) or {}
        candidates.append({
            "id": technician["id"], "name": technician.get("name") or technician.get("email") or "Unnamed technician",
            "email": technician.get("email"), "skills": _skills(skills_profile.get("skills")),
            "is_available": available, "on_call": bool(working_hours.get("on_call")), "auto_assign": opted_in,
            "open_tickets": open_tickets, "capacity": max(0, 8 - open_tickets), "utilization_pct": min(100, round(open_tickets / 8 * 100)),
        })
    return candidates


async def _confirmed_rules() -> tuple[list[dict], int]:
    rows = await db.routing_rules.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    rules = [row for row in rows if _confirmed_rule(row)]
    for rule in rules:
        rule["matches"] = await db.tickets.count_documents({"routing_rule_id": rule.get("id")})
    return rules, len(rows) - len(rules)


@router.get("/intelligent-routing/dashboard")
async def get_routing_dashboard(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    candidates = await _technician_candidates()
    rules, legacy_unverified = await _confirmed_rules()
    profiles = []
    for candidate in candidates:
        resolved_today = await db.tickets.count_documents({"assigned_to": candidate["id"], "status": "closed", "updated_at": {"$gte": (now - timedelta(hours=24)).isoformat()}})
        profiles.append({
            **candidate, "resolved_today": resolved_today,
            "avg_resolve_minutes": None, "sla_compliance": None, "csat_score": None,
            "evidence_state": "skills_configured" if candidate["skills"] else "skills_not_configured",
        })
    unassigned = await db.tickets.count_documents({"assigned_to": None, "status": {"$in": ["open", "in_progress"]}})
    total_open = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress"]}})
    routed_today = await db.tickets.count_documents({"routing_method": "rule_based", "routed_at": {"$gte": (now - timedelta(hours=24)).isoformat()}})
    return {
        "technicians": sorted(profiles, key=lambda item: (-item["capacity"], item["name"])),
        "routing_rules": rules,
        "stats": {
            "total_open": total_open, "unassigned": unassigned, "auto_routed_today": routed_today,
            "avg_assignment_time_sec": None, "routing_accuracy_pct": None,
            "legacy_unverified_rules": legacy_unverified,
        },
        "message": "Automatic routing uses confirmed rules, technician availability, recorded skills, and current open workload. Missing skills or rules require manual review.",
    }


@router.post("/intelligent-routing/route-ticket/{ticket_id}")
async def route_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    rules, _ = await _confirmed_rules()
    matching_rules = [rule for rule in rules if _matches(rule, ticket)]
    if not matching_rules:
        return {"status": "manual_review_required", "ticket_id": ticket_id, "reason": "No confirmed routing rule matches this ticket."}
    rule = matching_rules[0]
    category = _ticket_category(ticket)
    candidates = [candidate for candidate in await _technician_candidates() if candidate["is_available"] and candidate["auto_assign"]]
    scores = _route_scores(candidates, category=category, method=str(rule.get("route_to") or "least_loaded"))
    if not scores:
        return {"status": "manual_review_required", "ticket_id": ticket_id, "rule_id": rule["id"], "reason": "No available opted-in technician has the recorded skills required by this rule."}
    best = scores[0]
    timestamp = _now()
    await db.tickets.update_one({"id": ticket_id}, {"$set": {
        "assigned_to": best["id"], "assigned_name": best["name"], "routing_method": "rule_based",
        "routing_rule_id": rule["id"], "routed_at": timestamp, "updated_at": timestamp,
    }})
    await db.activity_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "ticket_routed", "entity_type": "ticket", "entity_id": ticket_id,
        "entity_name": ticket.get("title") or ticket_id, "user_name": current_user.get("name") or current_user.get("email") or current_user.get("id", ""),
        "details": f"Assigned to {best['name']} using confirmed routing rule {rule.get('name') or rule['id']}.",
        "metadata": {"routing_rule_id": rule["id"], "routing_score": best["routing_score"], "category": category}, "created_at": timestamp,
    })
    return {
        "status": "routed", "assigned_to": best["name"], "tech_id": best["id"], "routing_score": best["routing_score"],
        "confidence": None, "method": "confirmed_rule", "rule": {"id": rule["id"], "name": rule.get("name", "")},
        "reasoning": [f"Capacity score: {best['capacity_score']} ({best['open_tickets']} open tickets)", f"Recorded skill match: {best['skill_score']}" if best["skill_score"] is not None else "No category skill was required by this rule.", f"Availability score: {best['availability_score']}"],
        "alternatives": [{"name": item["name"], "routing_score": item["routing_score"]} for item in scores[1:3]],
    }


def _validate_rule(data: dict) -> dict:
    name = str(data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Rule name is required")
    method = str(data.get("route_to") or "skill_match").strip()
    if method not in {"highest_skill", "skill_match", "least_loaded", "round_robin"}:
        raise HTTPException(status_code=400, detail="Unknown routing method")
    category = str(data.get("category") or "").strip().lower()
    if category and category not in SKILL_CATEGORIES:
        raise HTTPException(status_code=400, detail="Choose a supported technician skill category")
    return {"name": name, "priority": str(data.get("priority") or "").strip().lower(), "category": category, "route_to": method, "enabled": bool(data.get("enabled", True))}


@router.post("/intelligent-routing/rules")
async def create_routing_rule(data: dict, current_user: dict = Depends(get_current_user)):
    rule = {"id": str(uuid.uuid4()), **_validate_rule(data), "source": "manual", "created_at": _now(), "confirmed_at": _now(), "created_by": current_user.get("name") or current_user.get("email") or current_user.get("id", "")}
    await db.routing_rules.insert_one(rule)
    return {**rule, "matches": 0}


@router.put("/intelligent-routing/rules/{rule_id}")
async def update_routing_rule(rule_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    existing = await db.routing_rules.find_one({"id": rule_id}, {"_id": 0})
    if not existing or not _confirmed_rule(existing):
        raise HTTPException(status_code=404, detail="Confirmed routing rule not found")
    update = {**_validate_rule({**existing, **data}), "confirmed_at": _now(), "updated_at": _now(), "updated_by": current_user.get("name") or current_user.get("email") or current_user.get("id", "")}
    await db.routing_rules.update_one({"id": rule_id}, {"$set": update})
    return {"message": "Rule updated", "id": rule_id}


@router.delete("/intelligent-routing/rules/{rule_id}")
async def delete_routing_rule(rule_id: str, current_user: dict = Depends(get_current_user)):
    existing = await db.routing_rules.find_one({"id": rule_id}, {"_id": 0})
    if not existing or not _confirmed_rule(existing):
        raise HTTPException(status_code=404, detail="Confirmed routing rule not found")
    await db.routing_rules.delete_one({"id": rule_id})
    return {"message": "Rule deleted"}


@router.post("/intelligent-routing/bulk-route")
async def bulk_route_tickets(current_user: dict = Depends(get_current_user)):
    tickets = await db.tickets.find({"assigned_to": None, "status": {"$in": ["open", "in_progress"]}}, {"_id": 0, "id": 1}).to_list(100)
    results = []
    for ticket in tickets:
        try:
            result = await route_ticket(ticket["id"], current_user)
            results.append({"ticket_id": ticket["id"], **result})
        except Exception as error:
            results.append({"ticket_id": ticket["id"], "status": "error", "error": str(error)})
    routed = sum(1 for result in results if result.get("status") == "routed")
    manual_review = sum(1 for result in results if result.get("status") == "manual_review_required")
    return {"routed": routed, "manual_review": manual_review, "failed": len(results) - routed - manual_review, "results": results}
