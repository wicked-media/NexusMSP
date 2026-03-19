from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/client-health/scores")
async def get_all_health_scores(current_user: dict = Depends(get_current_user)):
    """Get combined health scores for all clients."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1, "tier": 1}).to_list(500)
    scores = []
    for c in clients:
        cid = c["id"]
        # Ticket metrics
        open_tickets = await db.tickets.count_documents({"client_id": cid, "status": {"$in": ["open", "in_progress"]}})
        total_tickets = await db.tickets.count_documents({"client_id": cid})
        critical_tickets = await db.tickets.count_documents({"client_id": cid, "priority": "critical", "status": {"$in": ["open", "in_progress"]}})

        # Sentiment
        sentiment = await db.client_sentiments.find_one({"client_id": cid}, {"_id": 0, "score": 1, "status": 1})
        sentiment_score = (sentiment or {}).get("score", 60)

        # Revenue (contracts + invoices)
        contracts = await db.contracts.find({"client_id": cid, "status": "active"}, {"_id": 0, "value": 1}).to_list(10)
        monthly_revenue = sum(c.get("value", 0) for c in contracts)
        paid_invoices = await db.invoices.count_documents({"client_id": cid, "status": "paid"})
        overdue_invoices = await db.invoices.count_documents({"client_id": cid, "status": "overdue"})

        # Device health
        devices = await db.devices.count_documents({"client_id": cid})
        online_devices = await db.devices.count_documents({"client_id": cid, "status": "online"})

        # Calculate composite health score (0-100)
        ticket_health = max(0, 100 - (open_tickets * 10) - (critical_tickets * 25))
        payment_health = 100 if overdue_invoices == 0 else max(0, 100 - overdue_invoices * 30)
        device_health = (online_devices / max(devices, 1)) * 100 if devices > 0 else 80
        engagement = min(100, total_tickets * 5 + paid_invoices * 10)

        health = int(
            sentiment_score * 0.3 +
            ticket_health * 0.25 +
            payment_health * 0.2 +
            device_health * 0.15 +
            min(100, engagement) * 0.1
        )
        health = max(0, min(100, health))

        status = "thriving" if health >= 80 else "healthy" if health >= 60 else "needs_attention" if health >= 40 else "at_risk" if health >= 20 else "critical"

        scores.append({
            "client_id": cid, "client_name": c.get("name", ""), "tier": c.get("tier", "standard"),
            "health_score": health, "status": status,
            "metrics": {
                "sentiment": sentiment_score, "ticket_health": ticket_health,
                "payment_health": payment_health, "device_health": round(device_health),
                "engagement": min(100, engagement),
            },
            "details": {
                "open_tickets": open_tickets, "critical_tickets": critical_tickets,
                "total_tickets": total_tickets, "monthly_revenue": monthly_revenue,
                "devices": devices, "online_devices": online_devices,
                "overdue_invoices": overdue_invoices,
            },
        })

    scores.sort(key=lambda x: x["health_score"])
    return scores


@router.get("/client-health/dashboard")
async def health_dashboard(current_user: dict = Depends(get_current_user)):
    """Get health dashboard summary."""
    scores = await get_all_health_scores(current_user)
    if not scores:
        return {"total": 0, "avg_health": 0, "distribution": {}, "at_risk": [], "top_clients": []}

    avg = sum(s["health_score"] for s in scores) / len(scores)
    dist = {}
    for s in scores:
        dist[s["status"]] = dist.get(s["status"], 0) + 1

    at_risk = [s for s in scores if s["health_score"] < 50]
    top = sorted(scores, key=lambda x: x["health_score"], reverse=True)[:5]

    total_revenue = sum(s["details"]["monthly_revenue"] for s in scores)
    at_risk_revenue = sum(s["details"]["monthly_revenue"] for s in at_risk)

    return {
        "total": len(scores), "avg_health": round(avg, 1),
        "distribution": dist,
        "at_risk": at_risk[:10],
        "top_clients": top,
        "total_monthly_revenue": total_revenue,
        "at_risk_revenue": at_risk_revenue,
    }
