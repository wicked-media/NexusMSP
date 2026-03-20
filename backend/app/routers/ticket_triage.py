from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user
import random

router = APIRouter()

# ─── AI Ticket Triage ───

@router.post("/ticket-triage/analyze")
async def triage_ticket(body: dict, current_user: dict = Depends(get_current_user)):
    """Auto-categorize, prioritize, and route a ticket based on content analysis"""
    title = (body.get("title") or "").lower()
    description = (body.get("description") or "").lower()
    text = f"{title} {description}"
    client_name = body.get("client_name", "")

    # 1. Auto-categorize
    category_rules = {
        "security": ["virus", "malware", "ransomware", "phishing", "breach", "hack", "unauthorized", "suspicious", "firewall", "vpn"],
        "network": ["network", "wifi", "internet", "switch", "router", "dns", "dhcp", "vlan", "bandwidth", "connectivity"],
        "hardware": ["server", "disk", "memory", "ram", "cpu", "hardware", "printer", "monitor", "ups", "battery"],
        "email": ["email", "outlook", "exchange", "mailbox", "spam", "calendar", "teams", "microsoft 365"],
        "software": ["install", "update", "crash", "error", "license", "application", "software", "driver"],
        "backup": ["backup", "restore", "recovery", "disaster", "replication", "snapshot"],
    }
    category = "support"
    max_matches = 0
    for cat, keywords in category_rules.items():
        matches = sum(1 for kw in keywords if kw in text)
        if matches > max_matches:
            max_matches = matches
            category = cat

    # 2. Auto-priority from sentiment + urgency keywords
    critical_kws = ["down", "outage", "emergency", "critical", "all users", "server down", "ransomware", "breach", "production"]
    high_kws = ["urgent", "asap", "broken", "not working", "multiple users", "important", "deadline"]
    low_kws = ["request", "new user", "install", "setup", "question", "when you get a chance", "low priority"]

    critical_score = sum(2 for kw in critical_kws if kw in text)
    high_score = sum(1 for kw in high_kws if kw in text)
    low_score = sum(1 for kw in low_kws if kw in text)

    if critical_score >= 2:
        priority = "critical"
        priority_reason = f"Detected {critical_score // 2} critical urgency indicator(s)"
    elif high_score >= 2 or critical_score >= 1:
        priority = "high"
        priority_reason = f"Detected urgency indicators in ticket text"
    elif low_score >= 2:
        priority = "low"
        priority_reason = "Routine request with no urgency signals"
    else:
        priority = "medium"
        priority_reason = "Standard priority based on content analysis"

    # 3. Blast radius check (amplify priority if server/network affected)
    if any(w in text for w in ["server", "switch", "firewall", "all users", "entire office"]):
        if priority == "medium":
            priority = "high"
            priority_reason += " (amplified: infrastructure impact detected)"

    # 4. Auto-route to best tech based on skills
    techs = await db.users.find({"role": {"$in": ["admin", "tech"]}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(20)
    if not techs:
        techs = [
            {"id": "usr-001", "name": "Alex Thompson", "email": "alex@nexusops.io"},
            {"id": "usr-002", "name": "Sarah Chen", "email": "sarah@nexusops.io"},
            {"id": "usr-003", "name": "Mike Rodriguez", "email": "mike@nexusops.io"},
        ]

    # Skills matrix (mocked)
    skills_matrix = {
        "Alex Thompson": {"network": 9, "security": 7, "hardware": 8, "email": 6, "software": 7, "backup": 6, "support": 7},
        "Sarah Chen": {"network": 7, "security": 9, "hardware": 6, "email": 8, "software": 9, "backup": 7, "support": 8},
        "Mike Rodriguez": {"network": 8, "security": 6, "hardware": 9, "email": 5, "software": 6, "backup": 9, "support": 6},
    }

    # Calculate workload
    tech_workloads = {}
    for tech in techs:
        open_count = await db.tickets.count_documents({
            "assigned_to": tech["id"],
            "status": {"$in": ["open", "in_progress"]}
        })
        tech_workloads[tech["name"]] = open_count

    # Score each tech: skill match - workload penalty
    scored_techs = []
    for tech in techs:
        name = tech["name"]
        skill = skills_matrix.get(name, {}).get(category, 5)
        workload = tech_workloads.get(name, 0)
        score = skill * 10 - workload * 3
        scored_techs.append({
            "tech_id": tech["id"],
            "tech_name": name,
            "skill_score": skill,
            "current_workload": workload,
            "triage_score": max(0, score),
            "match_reason": f"Skill in {category}: {skill}/10, Workload: {workload} open tickets",
        })

    scored_techs.sort(key=lambda x: x["triage_score"], reverse=True)
    recommended = scored_techs[0] if scored_techs else None

    return {
        "triage": {
            "category": category,
            "category_confidence": min(95, 50 + max_matches * 15),
            "priority": priority,
            "priority_reason": priority_reason,
            "recommended_assignee": recommended,
            "all_candidates": scored_techs[:3],
            "tags": _suggest_tags(text),
        },
        "analysis": {
            "keywords_detected": max_matches,
            "urgency_score": critical_score + high_score,
            "infrastructure_impact": any(w in text for w in ["server", "switch", "firewall"]),
        },
    }


@router.get("/ticket-triage/skills-matrix")
async def get_skills_matrix(current_user: dict = Depends(get_current_user)):
    """Returns the tech skills matrix for display/editing"""
    return {
        "skills": {
            "Alex Thompson": {"network": 9, "security": 7, "hardware": 8, "email": 6, "software": 7, "backup": 6, "support": 7},
            "Sarah Chen": {"network": 7, "security": 9, "hardware": 6, "email": 8, "software": 9, "backup": 7, "support": 8},
            "Mike Rodriguez": {"network": 8, "security": 6, "hardware": 9, "email": 5, "software": 6, "backup": 9, "support": 6},
        },
        "categories": ["network", "security", "hardware", "email", "software", "backup", "support"],
    }


def _suggest_tags(text):
    tag_rules = {
        "server": ["server"], "network": ["network", "wifi", "switch"], "security": ["security", "virus", "malware"],
        "email": ["email", "outlook", "exchange"], "printer": ["printer", "print"], "backup": ["backup", "restore"],
        "onboarding": ["new user", "onboard"], "hardware": ["hardware", "replace", "upgrade"],
        "cloud": ["azure", "aws", "cloud", "365"], "vpn": ["vpn", "remote access"],
    }
    tags = []
    for tag, keywords in tag_rules.items():
        if any(kw in text for kw in keywords):
            tags.append(tag)
    return tags[:5]
