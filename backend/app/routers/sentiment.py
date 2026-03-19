from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
import os
import json
from app.database import db
from app.auth import get_current_user

router = APIRouter()

async def _get_ai_chat(session_id: str, system_msg: str):
    from emergentintegrations.llm.chat import LlmChat
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI key not configured")
    cfg = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    provider = (cfg or {}).get("provider", "anthropic")
    model = (cfg or {}).get("model", "claude-sonnet-4-5-20250929")
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
    chat.with_model(provider, model)
    return chat


# ============ SENTIMENT ANALYSIS ============

@router.get("/sentiment/clients")
async def get_all_client_sentiments(current_user: dict = Depends(get_current_user)):
    """Get sentiment scores for all clients."""
    scores = await db.client_sentiments.find({}, {"_id": 0}).sort("score", 1).to_list(5000)
    return scores


@router.get("/sentiment/clients/{client_id}")
async def get_client_sentiment(client_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed sentiment for a specific client."""
    score = await db.client_sentiments.find_one({"client_id": client_id}, {"_id": 0})
    history = await db.sentiment_history.find({"client_id": client_id}, {"_id": 0}).sort("analyzed_at", -1).to_list(50)
    return {"current": score, "history": history}


@router.get("/sentiment/at-risk")
async def get_at_risk_clients(current_user: dict = Depends(get_current_user)):
    """Get clients with low sentiment scores."""
    at_risk = await db.client_sentiments.find(
        {"score": {"$lt": 50}, "status": {"$in": ["at_risk", "critical"]}},
        {"_id": 0}
    ).sort("score", 1).to_list(100)
    return at_risk


@router.post("/sentiment/analyze/{client_id}")
async def analyze_client_sentiment(client_id: str, current_user: dict = Depends(get_current_user)):
    """AI-analyze sentiment for a client based on ticket history."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    # Get recent tickets for this client
    tickets = await db.tickets.find(
        {"client_id": client_id}, {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1,
         "created_at": 1, "resolved_at": 1, "assigned_to_name": 1}
    ).sort("created_at", -1).to_list(20)

    # Get recent notes/conversations
    ticket_ids = [t["id"] for t in tickets]
    notes = await db.ticket_notes.find(
        {"ticket_id": {"$in": ticket_ids}}, {"_id": 0, "content": 1, "created_at": 1, "is_client_reply": 1}
    ).sort("created_at", -1).to_list(30)

    client_messages = [n["content"][:200] for n in notes if n.get("is_client_reply")]
    ticket_summary = []
    for t in tickets[:10]:
        resolved = "resolved" if t.get("resolved_at") else "open"
        ticket_summary.append(f"- {t['title']} ({t.get('priority','medium')}, {resolved})")

    system = """You are a client sentiment analyzer for an MSP. Analyze the client's ticket history and communications.
Return ONLY valid JSON:
{
  "score": 0-100,
  "status": "thriving|healthy|neutral|at_risk|critical",
  "factors": {
    "response_satisfaction": 0-100,
    "resolution_speed": 0-100,
    "communication_tone": 0-100,
    "recurring_issues": 0-100,
    "overall_experience": 0-100
  },
  "insights": ["insight1", "insight2"],
  "recommendations": ["action1", "action2"],
  "risk_level": "low|medium|high|critical",
  "churn_probability": 0.0-1.0
}"""

    prompt = f"""Client: {client.get('name', 'Unknown')}
Total Tickets: {len(tickets)}
Recent Tickets:
{chr(10).join(ticket_summary) if ticket_summary else 'No recent tickets'}

Client Messages (recent):
{chr(10).join(client_messages[:5]) if client_messages else 'No client messages found'}

Analyze the sentiment and churn risk."""

    try:
        from emergentintegrations.llm.chat import UserMessage
        chat = await _get_ai_chat(f"sentiment-{uuid.uuid4().hex[:8]}", system)
        resp = await chat.send_message(UserMessage(content=prompt))
        text = resp.content.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
    except Exception:
        # Fallback: compute basic score from ticket data
        open_count = sum(1 for t in tickets if not t.get("resolved_at"))
        crit_count = sum(1 for t in tickets if t.get("priority") == "critical")
        base = 70
        base -= open_count * 5
        base -= crit_count * 10
        base = max(10, min(100, base))
        status = "thriving" if base >= 80 else "healthy" if base >= 60 else "neutral" if base >= 40 else "at_risk" if base >= 20 else "critical"
        result = {
            "score": base, "status": status,
            "factors": {"response_satisfaction": base, "resolution_speed": base, "communication_tone": 70, "recurring_issues": base, "overall_experience": base},
            "insights": [f"{len(tickets)} tickets total, {open_count} currently open"],
            "recommendations": ["Review open tickets", "Schedule check-in call"],
            "risk_level": "low" if base >= 60 else "medium" if base >= 40 else "high",
            "churn_probability": round(max(0, (100 - base)) / 100, 2)
        }

    # Store
    sentiment_doc = {
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "score": result.get("score", 50),
        "status": result.get("status", "neutral"),
        "factors": result.get("factors", {}),
        "insights": result.get("insights", []),
        "recommendations": result.get("recommendations", []),
        "risk_level": result.get("risk_level", "medium"),
        "churn_probability": result.get("churn_probability", 0.5),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "analyzed_by": current_user.get("name", ""),
    }
    await db.client_sentiments.update_one(
        {"client_id": client_id}, {"$set": sentiment_doc}, upsert=True
    )
    # History
    await db.sentiment_history.insert_one({
        "_id": None, "id": str(uuid.uuid4())[:8],
        "client_id": client_id,
        "score": result.get("score", 50),
        "status": result.get("status", "neutral"),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.sentiment_history.update_many({"_id": None}, {"$unset": {"_id": ""}})

    return sentiment_doc


@router.post("/sentiment/analyze-all")
async def analyze_all_sentiments(current_user: dict = Depends(get_current_user)):
    """Batch analyze sentiment for all clients."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    results = []
    for c in clients[:20]:  # Limit to 20 to avoid timeout
        try:
            r = await analyze_client_sentiment(c["id"], current_user)
            results.append({"client_id": c["id"], "name": c["name"], "score": r.get("score", 50)})
        except Exception:
            results.append({"client_id": c["id"], "name": c["name"], "score": 50, "error": True})
    return {"analyzed": len(results), "results": results}


@router.get("/sentiment/dashboard")
async def sentiment_dashboard(current_user: dict = Depends(get_current_user)):
    """Get sentiment dashboard summary."""
    all_scores = await db.client_sentiments.find({}, {"_id": 0}).to_list(5000)
    if not all_scores:
        return {"total_clients": 0, "avg_score": 0, "at_risk": 0, "critical": 0, "thriving": 0, "distribution": {}}
    avg = sum(s.get("score", 50) for s in all_scores) / len(all_scores)
    distribution = {}
    for s in all_scores:
        st = s.get("status", "neutral")
        distribution[st] = distribution.get(st, 0) + 1
    return {
        "total_clients": len(all_scores),
        "avg_score": round(avg, 1),
        "at_risk": distribution.get("at_risk", 0),
        "critical": distribution.get("critical", 0),
        "thriving": distribution.get("thriving", 0),
        "healthy": distribution.get("healthy", 0),
        "neutral": distribution.get("neutral", 0),
        "distribution": distribution,
    }
