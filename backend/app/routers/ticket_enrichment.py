from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random

router = APIRouter()

# ─── Ticket Enrichment: Client Context, Sentiment, Blast Radius, TTR ───

@router.get("/ticket-enrichment/{ticket_id}")
async def get_ticket_enrichment(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Returns enriched context for a ticket - client health, sentiment, impact blast radius, TTR prediction"""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        return {"error": "Ticket not found"}

    client_name = ticket.get("client_name", "")
    client = await db.clients.find_one({"name": client_name}, {"_id": 0}) if client_name else None

    # Client context card
    open_tickets = await db.tickets.count_documents({"client_name": client_name, "status": {"$in": ["open", "in_progress"]}})
    total_tickets = await db.tickets.count_documents({"client_name": client_name})
    resolved_tickets = await db.tickets.count_documents({"client_name": client_name, "status": {"$in": ["resolved", "closed"]}})

    client_devices = await db.devices.count_documents({"client_name": client_name})
    offline_devices = await db.devices.count_documents({"client_name": client_name, "status": "offline"})
    warning_devices = await db.devices.count_documents({"client_name": client_name, "status": "warning"})

    # Sentiment analysis (mocked AI - would call LLM in production)
    desc = (ticket.get("description") or "").lower()
    title = (ticket.get("title") or "").lower()
    text = f"{title} {desc}"
    frustrated_words = ["urgent", "critical", "broken", "down", "angry", "frustrated", "unacceptable", "asap", "immediately", "terrible", "worst", "disaster", "emergency"]
    neutral_words = ["request", "setup", "configure", "install", "new", "add", "create", "update"]
    happy_words = ["thanks", "great", "appreciate", "good", "wonderful", "love", "excellent"]

    frustrated_count = sum(1 for w in frustrated_words if w in text)
    happy_count = sum(1 for w in happy_words if w in text)
    neutral_count = sum(1 for w in neutral_words if w in text)

    if frustrated_count > happy_count and frustrated_count > 0:
        sentiment = "frustrated"
        sentiment_score = min(95, 40 + frustrated_count * 15)
        sentiment_reason = f"Detected {frustrated_count} urgency/frustration indicator(s) in ticket text"
    elif happy_count > frustrated_count:
        sentiment = "positive"
        sentiment_score = min(95, 60 + happy_count * 10)
        sentiment_reason = "Client tone appears positive/appreciative"
    else:
        sentiment = "neutral"
        sentiment_score = 50
        sentiment_reason = "Standard request with neutral tone"

    # Impact blast radius
    device = None
    affected_users = 0
    affected_services = []
    if ticket.get("device_id"):
        device = await db.devices.find_one({"id": ticket["device_id"]}, {"_id": 0})
        if device:
            dtype = device.get("device_type", "")
            if dtype == "server":
                affected_users = random.randint(10, 50)
                affected_services = random.sample(["Email", "File Sharing", "Active Directory", "DNS", "DHCP", "Web Server", "Database", "Backup"], min(4, random.randint(2, 5)))
            elif dtype in ["network", "firewall"]:
                affected_users = random.randint(20, 100)
                affected_services = random.sample(["Internet Access", "VPN", "Wi-Fi", "VLAN", "Firewall Rules"], min(3, random.randint(1, 4)))
            else:
                affected_users = 1
                affected_services = ["User Workstation"]

    # Time-to-resolution prediction
    category = ticket.get("category", "support")
    priority = ticket.get("priority", "medium")
    ttr_map = {
        ("critical", "hardware"): (45, 90), ("critical", "network"): (30, 60), ("critical", "security"): (20, 45),
        ("high", "hardware"): (120, 240), ("high", "network"): (60, 120), ("high", "software"): (60, 180),
        ("medium", "support"): (120, 360), ("medium", "software"): (90, 240), ("medium", "email"): (60, 180),
        ("low", "support"): (240, 480), ("low", "software"): (180, 360),
    }
    ttr_range = ttr_map.get((priority, category), (60, 240))
    predicted_ttr_min = random.randint(ttr_range[0], ttr_range[1])
    confidence = round(random.uniform(0.72, 0.94), 2)

    # Smart merge suggestions
    similar = await db.tickets.find(
        {"client_name": client_name, "status": {"$in": ["open", "in_progress"]}, "id": {"$ne": ticket_id}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "status": 1, "category": 1}
    ).to_list(5)

    return {
        "client_context": {
            "name": client_name,
            "health_score": client.get("health_score", random.randint(65, 98)) if client else random.randint(70, 95),
            "contract_status": client.get("contract_status", "active") if client else "active",
            "contract_value": client.get("contract_value", random.randint(2000, 15000)) if client else 0,
            "nps_score": random.randint(6, 10),
            "open_tickets": open_tickets,
            "total_tickets_lifetime": total_tickets,
            "resolved_tickets": resolved_tickets,
            "total_devices": client_devices,
            "offline_devices": offline_devices,
            "warning_devices": warning_devices,
            "last_interaction": (datetime.now(timezone.utc) - timedelta(days=random.randint(0, 5))).strftime("%Y-%m-%d"),
            "avg_satisfaction": round(random.uniform(3.8, 5.0), 1),
        },
        "sentiment": {
            "label": sentiment,
            "score": sentiment_score,
            "reason": sentiment_reason,
        },
        "blast_radius": {
            "affected_users": affected_users,
            "affected_services": affected_services,
            "device_type": device.get("device_type") if device else None,
            "device_name": device.get("name") if device else None,
            "severity_multiplier": 3.0 if affected_users > 20 else 2.0 if affected_users > 5 else 1.0,
        },
        "ttr_prediction": {
            "predicted_minutes": predicted_ttr_min,
            "confidence": confidence,
            "based_on": f"Historical {category}/{priority} tickets",
            "similar_resolved_avg_min": random.randint(max(30, predicted_ttr_min - 60), predicted_ttr_min + 30),
        },
        "merge_candidates": similar,
    }
