from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid, os
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.post("/tickets/{ticket_id}/ai-triage")
async def ai_triage_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Use GPT to analyze a ticket and suggest category, priority, assignment, and resolution."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="LLM API key not configured")

    from emergentintegrations.llm.chat import LlmChat, UserMessage

    # Get technicians for assignment suggestion
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1, "specialties": 1}).to_list(50)
    tech_list = ", ".join([f"{t['name']} (specialties: {', '.join(t.get('specialties', []))})" for t in techs[:10]])

    prompt = f"""Analyze this IT support ticket and provide triage recommendations.

Ticket Title: {ticket.get('title', '')}
Description: {ticket.get('description', '')}
Client: {ticket.get('client_name', 'Unknown')}
Current Priority: {ticket.get('priority', 'unknown')}
Current Category: {ticket.get('category', 'unknown')}
Device: {ticket.get('device_name', 'N/A')}

Available Technicians: {tech_list}

Respond in this exact JSON format only, no other text:
{{
  "suggested_priority": "critical|high|medium|low",
  "suggested_category": "infrastructure|network|security|hardware|software|support|patching|onboarding|other",
  "suggested_assignee": "technician name or 'unassigned'",
  "assignment_reason": "brief reason for assignment",
  "root_cause_guess": "likely root cause in 1-2 sentences",
  "resolution_steps": ["step 1", "step 2", "step 3"],
  "estimated_time_minutes": 30,
  "tags": ["tag1", "tag2"],
  "urgency_score": 7,
  "summary": "brief 1-sentence summary of the issue"
}}"""

    chat = LlmChat(api_key=api_key, session_id=f"triage-{ticket_id}-{uuid.uuid4().hex[:6]}", system_message="You are an expert IT support triage analyst for an MSP. Always respond with valid JSON only.")
    chat.with_model("openai", "gpt-4.1-mini")

    try:
        response = await chat.send_message(UserMessage(text=prompt))
        # Parse JSON from response
        import json
        # Try to extract JSON from response
        resp_text = response.strip()
        if resp_text.startswith("```"):
            resp_text = resp_text.split("```")[1]
            if resp_text.startswith("json"):
                resp_text = resp_text[4:]
        triage = json.loads(resp_text)
    except Exception as e:
        # Fallback to basic triage
        triage = {
            "suggested_priority": ticket.get("priority", "medium"),
            "suggested_category": ticket.get("category", "support"),
            "suggested_assignee": "unassigned",
            "assignment_reason": "AI triage unavailable - please review manually",
            "root_cause_guess": "Unable to determine - manual review needed",
            "resolution_steps": ["Review ticket details", "Investigate the issue", "Apply resolution"],
            "estimated_time_minutes": 60,
            "tags": [],
            "urgency_score": 5,
            "summary": ticket.get("title", ""),
            "ai_error": str(e),
        }

    # Save triage result
    triage_record = {
        "id": f"triage-{uuid.uuid4().hex[:8]}",
        "ticket_id": ticket_id,
        "triage_data": triage,
        "triaged_by": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ai_triage_logs.insert_one(triage_record)

    return triage


@router.post("/tickets/{ticket_id}/ai-triage/apply")
async def apply_ai_triage(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Apply AI triage suggestions to a ticket."""
    ticket = await db.tickets.find_one({"id": ticket_id})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    update = {}
    if data.get("priority"):
        update["priority"] = data["priority"]
    if data.get("category"):
        update["category"] = data["category"]
    if data.get("assigned_to"):
        tech = await db.users.find_one({"name": data["assigned_to"]}, {"_id": 0})
        if tech:
            update["assigned_to"] = tech["id"]
            update["assigned_name"] = tech["name"]
    if data.get("tags"):
        update["tags"] = list(set((ticket.get("tags") or []) + data["tags"]))

    if update:
        update["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.tickets.update_one({"id": ticket_id}, {"$set": update})

    return {"message": "AI triage applied", "updates": update}


@router.get("/ai-triage/stats")
async def get_triage_stats(current_user: dict = Depends(get_current_user)):
    total = await db.ai_triage_logs.count_documents({})
    return {"total_triages": total}


# ── Keyword-based triage (fast, no AI needed) ──

def _keyword_triage(title, description):
    """Rule-based triage fallback when AI is not needed or unavailable."""
    text = f"{title} {description}".lower()
    category_rules = {
        "security": ["virus", "malware", "ransomware", "phishing", "breach", "hack", "unauthorized", "suspicious", "firewall", "vpn"],
        "network": ["network", "wifi", "internet", "switch", "router", "dns", "dhcp", "vlan", "bandwidth", "connectivity"],
        "hardware": ["server", "disk", "memory", "ram", "cpu", "hardware", "printer", "monitor", "ups", "battery"],
        "email": ["email", "outlook", "exchange", "mailbox", "spam", "calendar", "teams", "microsoft 365"],
        "software": ["install", "update", "crash", "error", "license", "application", "software", "driver"],
        "backup": ["backup", "restore", "recovery", "disaster", "replication", "snapshot"],
    }
    category, max_m = "support", 0
    for cat, kws in category_rules.items():
        m = sum(1 for kw in kws if kw in text)
        if m > max_m:
            max_m, category = m, cat

    critical_kws = ["down", "outage", "emergency", "critical", "all users", "server down", "ransomware", "breach", "production"]
    high_kws = ["urgent", "asap", "broken", "not working", "multiple users", "important"]
    low_kws = ["request", "new user", "install", "setup", "question", "when you get a chance"]
    cs = sum(2 for kw in critical_kws if kw in text)
    hs = sum(1 for kw in high_kws if kw in text)
    ls = sum(1 for kw in low_kws if kw in text)
    priority = "critical" if cs >= 2 else "high" if hs >= 2 or cs >= 1 else "low" if ls >= 2 else "medium"
    if priority == "medium" and any(w in text for w in ["server", "switch", "firewall", "all users"]):
        priority = "high"

    tags = []
    tag_rules = {"server": ["server"], "network": ["network", "wifi"], "security": ["security", "virus"], "email": ["email", "outlook"], "printer": ["printer"], "backup": ["backup"], "cloud": ["azure", "aws", "365"], "vpn": ["vpn"]}
    for tag, kws in tag_rules.items():
        if any(kw in text for kw in kws):
            tags.append(tag)

    return {"category": category, "priority": priority, "tags": tags[:5], "confidence": min(95, 50 + max_m * 15)}


@router.post("/ticket-triage/analyze")
async def keyword_triage_ticket(body: dict, current_user: dict = Depends(get_current_user)):
    """Fast keyword-based triage (no AI). Use /tickets/{id}/ai-triage for GPT-powered analysis."""
    title = body.get("title", "")
    description = body.get("description", "")
    triage = _keyword_triage(title, description)

    # Auto-route to best tech based on workload
    techs = await db.users.find({"role": {"$in": ["admin", "technician"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
    scored = []
    for t in techs:
        load = await db.tickets.count_documents({"assigned_to": t["id"], "status": {"$in": ["open", "in_progress"]}})
        scored.append({"tech_id": t["id"], "tech_name": t["name"], "workload": load, "score": max(0, 100 - load * 10)})
    scored.sort(key=lambda x: x["score"], reverse=True)

    triage["recommended_assignee"] = scored[0] if scored else None
    triage["all_candidates"] = scored[:3]
    return {"triage": triage}


@router.post("/ai/triage")
async def ai_triage_standalone(data: dict, current_user: dict = Depends(get_current_user)):
    """AI triage for new tickets (before creation). Redirects to keyword triage as fallback."""
    return await keyword_triage_ticket(data, current_user)


@router.post("/ai/auto-route")
async def auto_route_ticket(data: dict, current_user: dict = Depends(get_current_user)):
    """Apply triage suggestions to a ticket."""
    ticket_id = data.get("ticket_id")
    triage = data.get("triage", {})
    if not ticket_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="ticket_id required")
    update = {}
    if triage.get("suggested_priority"): update["priority"] = triage["suggested_priority"]
    if triage.get("suggested_technician_id"): update["assigned_to"] = triage["suggested_technician_id"]
    if triage.get("suggested_category"): update["category"] = triage["suggested_category"]
    if triage.get("tags"): update["tags"] = triage["tags"]
    update["ai_triaged"] = True
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.tickets.update_one({"id": ticket_id}, {"$set": update})
    return {"message": "Ticket auto-routed", "updates": update}
