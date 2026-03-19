from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/client-compare")
async def compare_clients(current_user: dict = Depends(get_current_user)):
    """Multi-tenant client comparison dashboard."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "tier": 1}).to_list(200)
    results = []

    for c in clients:
        cid = c["id"]
        total_tickets = await db.tickets.count_documents({"client_id": cid})
        open_tickets = await db.tickets.count_documents({"client_id": cid, "status": {"$in": ["open", "in_progress"]}})
        critical = await db.tickets.count_documents({"client_id": cid, "priority": "critical"})
        devices = await db.devices.count_documents({"client_id": cid})
        online = await db.devices.count_documents({"client_id": cid, "status": "online"})
        contracts = await db.contracts.find({"client_id": cid, "status": "active"}, {"_id": 0, "value": 1}).to_list(10)
        revenue = sum(ct.get("value", 0) for ct in contracts)
        invoices_overdue = await db.invoices.count_documents({"client_id": cid, "status": "overdue"})
        sentiment = await db.client_sentiments.find_one({"client_id": cid}, {"_id": 0, "score": 1})

        results.append({
            "client_id": cid, "client_name": c.get("name",""), "tier": c.get("tier","standard"),
            "total_tickets": total_tickets, "open_tickets": open_tickets, "critical_tickets": critical,
            "devices": devices, "online_devices": online,
            "uptime_pct": round((online / max(devices, 1)) * 100, 1) if devices > 0 else 0,
            "monthly_revenue": revenue,
            "rpe": round(revenue / max(devices, 1), 2) if devices > 0 else 0,
            "overdue_invoices": invoices_overdue,
            "sentiment_score": (sentiment or {}).get("score", 0),
        })

    results.sort(key=lambda x: x["monthly_revenue"], reverse=True)
    return {"clients": results, "total": len(results)}
