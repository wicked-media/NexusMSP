"""
Tech Intel â€” Smart Tech Finder, Skills Matrix, Permission Matrix, Permission Diff,
Role Drift Detector, Audit Timeline, and Capacity Cockpit.

Outclasses Syncro/HaloPSA/CW/Ninja by combining live ops data with AI insight.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from typing import Optional
import os
import logging
from app.database import db
from app.auth import get_current_user

router = APIRouter()
logger = logging.getLogger("tech_intel")

# 8 core skill axes used by the radar chart
SKILL_AXES = ["networking", "cloud", "security", "endpoints", "backup", "m365", "voip", "hardware"]

# Mapping of TECH_CATEGORIES â†’ skills (used as fallback when explicit skills not set)
CATEGORY_SKILL_MAP = {
    "network": ["networking"],
    "wisp": ["networking"],
    "cabling": ["networking", "hardware"],
    "security": ["security"],
    "cloud": ["cloud", "m365"],
    "workshop": ["hardware", "endpoints"],
    "field_service": ["endpoints", "hardware"],
    "helpdesk": ["endpoints", "m365"],
    "sla": ["endpoints"],
}


def _skills_for_tech(tech: dict) -> dict:
    """Build a 0-100 skill profile for a tech using explicit skills + category fallback."""
    explicit = tech.get("skills") or {}
    cats = tech.get("categories") or []
    profile = {axis: 0 for axis in SKILL_AXES}
    # 1) explicit ratings (0-100 from tech profile)
    for axis in SKILL_AXES:
        if axis in explicit:
            try:
                profile[axis] = max(0, min(100, int(explicit[axis])))
            except (ValueError, TypeError):
                pass
    # 2) category-derived bumps
    for cat in cats:
        for skill in CATEGORY_SKILL_MAP.get(cat, []):
            if profile[skill] < 60:
                profile[skill] = 60
    # 3) Senior+ baseline lift
    title = tech.get("job_title") or ""
    if "Senior" in title or "Service Manager" in title:
        for axis in SKILL_AXES:
            if profile[axis] < 50:
                profile[axis] = 50
    return profile


async def _live_workload(tech_id: str) -> dict:
    """Return live workload for a single tech."""
    open_count = await db.tickets.count_documents({"assignee_id": tech_id, "status": {"$in": ["open", "in_progress"]}})
    if open_count == 0:
        # try alternate field naming
        open_count = await db.tickets.count_documents({"assigned_to": tech_id, "status": {"$in": ["open", "in_progress"]}})
    overdue = await db.tickets.count_documents({
        "$or": [{"assignee_id": tech_id}, {"assigned_to": tech_id}],
        "status": {"$in": ["open", "in_progress"]},
        "sla_due_at": {"$lt": datetime.now(timezone.utc).isoformat()},
    })
    # Heuristic utilization (out of 8h day, ~2h per open ticket)
    util_pct = min(100, open_count * 25)
    if util_pct >= 90:
        state = "overloaded"
    elif util_pct >= 60:
        state = "busy"
    elif util_pct >= 25:
        state = "active"
    else:
        state = "idle"
    return {"open_tickets": open_count, "overdue": overdue, "utilization_pct": util_pct, "state": state}


@router.get("/tech-intel/capacity")
async def capacity_cockpit(current_user: dict = Depends(get_current_user)):
    """Live capacity dashboard for every active technician."""
    techs = await db.users.find(
        {"$or": [{"role": "technician"}, {"role": "admin"}, {"is_admin": True}]},
        {"_id": 0, "password_hash": 0},
    ).to_list(200)
    # also pull from technicians collection if a separate one exists
    techs_alt = []
    try:
        techs_alt = await db.technicians.find({}, {"_id": 0}).to_list(200)
    except Exception:
        pass
    by_id = {t.get("id"): t for t in techs}
    for t in techs_alt:
        if t.get("id") and t.get("id") not in by_id:
            by_id[t["id"]] = t

    out = []
    summary = {"total": 0, "idle": 0, "active": 0, "busy": 0, "overloaded": 0, "on_call": 0, "avg_util": 0}
    util_total = 0
    for tid, t in by_id.items():
        if not tid:
            continue
        wl = await _live_workload(tid)
        skills = _skills_for_tech(t)
        out.append({
            "id": tid,
            "name": t.get("name") or "Tech",
            "email": t.get("email"),
            "avatar": t.get("avatar_url") or t.get("avatar"),
            "job_title": t.get("job_title", "Technician"),
            "categories": t.get("categories") or [],
            "on_call_status": bool(t.get("on_call_status")),
            "is_admin": bool(t.get("is_admin")),
            "specialties": t.get("specialties") or [],
            "skills": skills,
            "workload": wl,
        })
        summary["total"] += 1
        summary[wl["state"]] = summary.get(wl["state"], 0) + 1
        if t.get("on_call_status"):
            summary["on_call"] += 1
        util_total += wl["utilization_pct"]
    summary["avg_util"] = round(util_total / summary["total"]) if summary["total"] else 0
    out.sort(key=lambda x: -x["workload"]["utilization_pct"])
    return {"summary": summary, "techs": out}


@router.post("/tech-intel/find")
async def smart_tech_finder(data: dict, current_user: dict = Depends(get_current_user)):
    """
    Natural-language tech finder. Parses query intent (skills + role + availability)
    using AI and ranks matching techs.
    Body: { "query": "Find me an L2 with VMware skills available now" }
    """
    query = (data.get("query") or "").strip()
    if not query:
        return {"results": [], "intent": None}

    cap = await capacity_cockpit(current_user)
    techs = cap["techs"]

    # Parse intent â€” use LLM if available, else heuristic
    intent = {"skills": [], "level": None, "needs_available": False, "categories": []}
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        try:
            from app.services.ai_provider import LlmChat, UserMessage
            chat = LlmChat(
                api_key=api_key,
                session_id=f"tech-find-{current_user['id']}",
                system_message=(
                    "You parse MSP technician search queries. Return STRICT JSON only. "
                    f"Skill axes available: {SKILL_AXES}. "
                    "Levels: l1, l2, senior, manager. "
                    "Categories: sla, workshop, cabling, network, wisp, field_service, security, cloud, helpdesk. "
                    'Return JSON shape: {"skills":[],"level":null,"needs_available":bool,"categories":[],"keywords":[]}'
                ),
            )
            chat.with_model("openai", "gpt-5.6-terra")
            resp = await chat.send_message(UserMessage(text=f"Query: {query}"))
            import json as _json
            text = resp if isinstance(resp, str) else str(resp)
            # extract JSON
            start = text.find("{"); end = text.rfind("}")
            if start >= 0 and end > start:
                intent.update(_json.loads(text[start:end + 1]))
        except Exception as e:
            logger.warning(f"AI intent parse failed: {e}")

    # Heuristic fallback / supplement
    q = query.lower()
    if not intent.get("level"):
        if "senior" in q: intent["level"] = "senior"
        elif "l2" in q or "level 2" in q: intent["level"] = "l2"
        elif "l1" in q or "level 1" in q: intent["level"] = "l1"
        elif "manager" in q or "service manager" in q: intent["level"] = "manager"
    if "available" in q or "free" in q or "now" in q:
        intent["needs_available"] = True
    if not intent.get("skills"):
        for axis in SKILL_AXES:
            if axis in q:
                intent["skills"].append(axis)

    # Score and rank
    def score(tech):
        s = 0
        # skill match â€” strongest signal
        for skill in intent.get("skills", []):
            s += tech["skills"].get(skill, 0)
        # level match
        title = tech.get("job_title", "").lower()
        lvl = (intent.get("level") or "").lower()
        if lvl:
            if lvl == "l1" and "l1" in title: s += 60
            elif lvl == "l2" and "l2" in title: s += 60
            elif lvl == "senior" and "senior" in title: s += 60
            elif lvl == "manager" and "manager" in title: s += 60
        # availability bonus
        if intent.get("needs_available") and tech["workload"]["state"] in ("idle", "active"):
            s += 50
        elif intent.get("needs_available") and tech["workload"]["state"] == "overloaded":
            s -= 80
        # category match
        for cat in intent.get("categories", []):
            if cat in tech.get("categories", []):
                s += 30
        # keyword on specialties
        for kw in intent.get("keywords", []) or []:
            if any(kw.lower() in (sp or "").lower() for sp in tech.get("specialties", [])):
                s += 25
        return s

    ranked = sorted(techs, key=score, reverse=True)
    results = [{**t, "match_score": score(t)} for t in ranked if score(t) > 0][:8]
    if not results:
        # if nothing matched but we had techs, return top 5 anyway
        results = ranked[:5]
    return {"results": results, "intent": intent}


@router.get("/tech-intel/permission-matrix")
async def permission_matrix(current_user: dict = Depends(get_current_user)):
    """Heatmap data: techs x modules â†’ permission level (none/read/write/admin)."""
    techs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(200)
    modules = ["tickets", "clients", "invoices", "products", "devices", "networking",
              "assets", "reports", "knowledge_base", "it_docs", "contracts",
              "projects", "time_tracking", "purchase_orders", "scheduling", "settings"]

    def lvl(perms_for_module):
        if not perms_for_module:
            return "none"
        if perms_for_module.get("delete"):
            return "admin"
        if perms_for_module.get("create") or perms_for_module.get("edit"):
            return "write"
        if perms_for_module.get("view"):
            return "read"
        return "none"

    rows = []
    for t in techs:
        perms = t.get("permissions") or {}
        cells = {m: ("admin" if t.get("is_admin") else lvl(perms.get(m))) for m in modules}
        rows.append({
            "tech_id": t.get("id"),
            "name": t.get("name"),
            "job_title": t.get("job_title", "Technician"),
            "role": t.get("role", "technician"),
            "is_admin": bool(t.get("is_admin")),
            "cells": cells,
        })
    return {"modules": modules, "rows": rows}


@router.post("/tech-intel/permission-diff")
async def permission_diff(data: dict, current_user: dict = Depends(get_current_user)):
    """
    Preview the difference between current permissions and a target preset.
    Body: { "tech_id": "...", "target_preset": "Senior Engineer" }
    """
    from app.routers.technicians import PERMISSION_PRESETS
    tech_id = data.get("tech_id")
    target_name = data.get("target_preset")
    if not tech_id or not target_name:
        raise HTTPException(status_code=400, detail="tech_id and target_preset required")
    target = PERMISSION_PRESETS.get(target_name)
    if not target:
        raise HTTPException(status_code=404, detail="Unknown preset")
    tech = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not tech:
        raise HTTPException(status_code=404, detail="Tech not found")
    current = tech.get("permissions") or {}

    grants, revokes = [], []
    for module, target_perms in target.items():
        cur_perms = current.get(module) or {}
        for action in ("view", "create", "edit", "delete"):
            if target_perms.get(action) and not cur_perms.get(action):
                grants.append({"module": module, "action": action})
            elif cur_perms.get(action) and not target_perms.get(action):
                revokes.append({"module": module, "action": action})
    return {
        "tech": {"id": tech_id, "name": tech.get("name"), "current_title": tech.get("job_title")},
        "target_preset": target_name,
        "grants": grants,
        "revokes": revokes,
        "summary": f"{len(grants)} grants Â· {len(revokes)} revokes",
    }


@router.get("/tech-intel/role-drift")
async def role_drift(current_user: dict = Depends(get_current_user)):
    """Detect techs whose actual ticket activity does not match their assigned role."""
    techs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(200)
    drift = []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    for t in techs:
        tid = t.get("id")
        if not tid:
            continue
        title = t.get("job_title", "")
        # critical / advanced ticket count
        crit = await db.tickets.count_documents({
            "$or": [{"assignee_id": tid}, {"assigned_to": tid}],
            "priority": {"$in": ["critical", "urgent", "p1"]},
            "created_at": {"$gte": cutoff},
        })
        total = await db.tickets.count_documents({
            "$or": [{"assignee_id": tid}, {"assigned_to": tid}],
            "created_at": {"$gte": cutoff},
        })
        if total == 0:
            continue

        crit_ratio = crit / total

        flag = None
        rationale = None
        if "L1" in title and crit_ratio > 0.30:
            flag = "upgrade"
            rationale = f"Handling {crit}/{total} critical tickets ({int(crit_ratio*100)}%) â€” operating beyond L1 scope. Consider L2 promotion."
        elif "Senior" in title and total < 5:
            flag = "underutilised"
            rationale = f"Only {total} tickets in 30 days â€” Senior capacity is being wasted."
        elif "L2" in title and crit_ratio > 0.50:
            flag = "upgrade"
            rationale = f"Critical workload at {int(crit_ratio*100)}% â€” Senior-level engagement justified."

        if flag:
            drift.append({
                "tech_id": tid,
                "name": t.get("name"),
                "current_title": title,
                "flag": flag,
                "rationale": rationale,
                "crit_30d": crit,
                "total_30d": total,
            })
    return {"drift": drift, "checked_at": datetime.now(timezone.utc).isoformat()}


@router.get("/tech-intel/audit-timeline")
async def audit_timeline(limit: int = 100, current_user: dict = Depends(get_current_user)):
    """Audit log of permission/role changes â€” newest first."""
    events = await db.permission_audit.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return {"events": events}


async def _log_audit(actor: dict, action: str, target_id: str, target_name: str, detail: dict):
    """Helper used by other routers to append to the audit log."""
    try:
        await db.permission_audit.insert_one({
            "id": f"aud-{datetime.now(timezone.utc).timestamp()}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "actor_id": actor.get("id"),
            "actor_name": actor.get("name"),
            "action": action,
            "target_id": target_id,
            "target_name": target_name,
            "detail": detail,
        })
    except Exception as e:
        logger.warning(f"audit log failed: {e}")
