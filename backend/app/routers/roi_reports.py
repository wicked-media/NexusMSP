from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/roi-reports/{client_id}")
async def generate_roi_report(client_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a client ROI report showing value delivered."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1, "email": 1, "tier": 1})
    if not client:
        return {"error": "Client not found"}

    now = datetime.now(timezone.utc)
    month_ago = (now - timedelta(days=30)).isoformat()
    quarter_ago = (now - timedelta(days=90)).isoformat()

    # Ticket metrics (last quarter)
    total_tickets = await db.tickets.count_documents({"client_id": client_id, "created_at": {"$gte": quarter_ago}})
    resolved_tickets = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["resolved", "closed"]}, "created_at": {"$gte": quarter_ago}})
    critical_resolved = await db.tickets.count_documents({"client_id": client_id, "priority": "critical", "status": {"$in": ["resolved", "closed"]}, "created_at": {"$gte": quarter_ago}})

    # Calculate avg resolution time
    tickets = await db.tickets.find(
        {"client_id": client_id, "status": {"$in": ["resolved", "closed"]}, "resolved_at": {"$exists": True}, "created_at": {"$gte": quarter_ago}},
        {"_id": 0, "created_at": 1, "resolved_at": 1}
    ).to_list(500)

    durations = []
    for t in tickets:
        try:
            ct = datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
            rt = datetime.fromisoformat(t["resolved_at"].replace("Z", "+00:00"))
            durations.append((rt - ct).total_seconds() / 3600)
        except Exception:
            pass
    avg_resolution = round(sum(durations) / len(durations), 1) if durations else 0

    # Device metrics
    total_devices = await db.devices.count_documents({"client_id": client_id})
    online_devices = await db.devices.count_documents({"client_id": client_id, "status": "online"})
    uptime_pct = round((online_devices / max(total_devices, 1)) * 100, 1)

    # Estimated downtime prevented (each critical ticket = ~2 hours downtime prevented)
    downtime_prevented_hours = critical_resolved * 2

    # Estimated cost savings
    hourly_downtime_cost = 150  # Average SMB cost per hour of downtime
    cost_savings = downtime_prevented_hours * hourly_downtime_cost

    # Contract value
    contracts = await db.contracts.find({"client_id": client_id, "status": "active"}, {"_id": 0, "value": 1}).to_list(10)
    monthly_investment = sum(c.get("value", 0) for c in contracts)
    quarterly_investment = monthly_investment * 3

    roi_pct = round(((cost_savings - quarterly_investment) / max(quarterly_investment, 1)) * 100, 1) if quarterly_investment > 0 else 0

    # Predictive maintenance savings
    predictions_caught = await db.predictive_alerts.count_documents({"client_name": client.get("name", ""), "status": "resolved"})
    predictive_savings = predictions_caught * 500  # Each caught issue saves ~$500

    return {
        "client": client,
        "period": "Last 90 Days",
        "generated_at": now.isoformat(),
        "ticket_metrics": {
            "total_tickets": total_tickets,
            "resolved": resolved_tickets,
            "critical_resolved": critical_resolved,
            "avg_resolution_hours": avg_resolution,
            "resolution_rate": round((resolved_tickets / max(total_tickets, 1)) * 100, 1),
        },
        "infrastructure": {
            "total_devices": total_devices,
            "online_devices": online_devices,
            "uptime_pct": uptime_pct,
        },
        "value_delivered": {
            "downtime_prevented_hours": downtime_prevented_hours,
            "cost_savings_downtime": cost_savings,
            "predictive_issues_caught": predictions_caught,
            "predictive_savings": predictive_savings,
            "total_value_delivered": cost_savings + predictive_savings,
        },
        "investment": {
            "monthly": monthly_investment,
            "quarterly": quarterly_investment,
        },
        "roi": {
            "roi_pct": roi_pct,
            "value_vs_investment_ratio": round((cost_savings + predictive_savings) / max(quarterly_investment, 1), 1),
        },
        "highlights": [
            f"Resolved {resolved_tickets} issues, including {critical_resolved} critical incidents",
            f"Prevented an estimated {downtime_prevented_hours} hours of downtime",
            f"Maintained {uptime_pct}% device uptime across {total_devices} devices",
            f"Average resolution time: {avg_resolution} hours",
            f"Estimated value delivered: ${(cost_savings + predictive_savings):,.0f}",
        ],
    }


@router.get("/roi-reports")
async def get_all_roi_summaries(current_user: dict = Depends(get_current_user)):
    """Get ROI summary for all clients."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "tier": 1}).to_list(200)
    summaries = []
    for c in clients:
        total = await db.tickets.count_documents({"client_id": c["id"]})
        resolved = await db.tickets.count_documents({"client_id": c["id"], "status": {"$in": ["resolved", "closed"]}})
        critical = await db.tickets.count_documents({"client_id": c["id"], "priority": "critical", "status": {"$in": ["resolved", "closed"]}})
        devices = await db.devices.count_documents({"client_id": c["id"]})
        value = critical * 300 + resolved * 50  # Simplified value calc
        summaries.append({
            "client_id": c["id"], "client_name": c.get("name", ""), "tier": c.get("tier", ""),
            "total_tickets": total, "resolved": resolved, "devices": devices,
            "estimated_value": value,
        })
    summaries.sort(key=lambda x: x["estimated_value"], reverse=True)
    return summaries
