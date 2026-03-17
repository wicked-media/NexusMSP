from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== CLIENT HEALTH & OPPORTUNITY RADAR ==============

@router.get("/health-radar/dashboard")
async def get_health_radar_dashboard(current_user: dict = Depends(get_current_user)):
    """Comprehensive client health and opportunity analysis"""
    clients = await db.clients.find({}, {"_id": 0}).to_list(500)
    
    at_risk = []
    upsell_opportunities = []
    healthy = []
    
    now = datetime.now(timezone.utc)
    thirty_days_ago = (now - timedelta(days=30)).isoformat()
    
    for client in clients:
        client_id = client["id"]
        
        open_tickets = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["open", "in_progress"]}})
        critical_tickets = await db.tickets.count_documents({"client_id": client_id, "priority": "critical", "status": {"$nin": ["closed", "resolved"]}})
        total_tickets = await db.tickets.count_documents({"client_id": client_id})
        recent_tickets = await db.tickets.count_documents({"client_id": client_id, "created_at": {"$gte": thirty_days_ago}})
        
        devices = await db.devices.count_documents({"client_id": client_id})
        offline_devices = await db.devices.count_documents({"client_id": client_id, "status": "offline"})
        
        contracts = await db.contracts.find({"client_id": client_id}, {"_id": 0}).to_list(10)
        expiring_contracts = [c for c in contracts if c.get("end_date") and c["end_date"] <= (now + timedelta(days=60)).strftime("%Y-%m-%d")]
        active_contracts = len([c for c in contracts if c.get("status") == "active"])
        
        invoices = await db.invoices.find({"client_id": client_id, "status": {"$in": ["sent", "overdue"]}}, {"_id": 0}).to_list(20)
        overdue_invoices = [i for i in invoices if i.get("status") == "overdue"]
        outstanding_amount = sum(float(i.get("total", 0)) - float(i.get("amount_paid", 0)) for i in invoices)
        
        health_score = 100
        risk_factors = []
        opportunities = []
        
        if critical_tickets > 0:
            health_score -= 20 * critical_tickets
            risk_factors.append(f"{critical_tickets} critical open tickets")
        if open_tickets > 5:
            health_score -= 10
            risk_factors.append(f"{open_tickets} open tickets (high volume)")
        if recent_tickets > 10:
            health_score -= 15
            risk_factors.append(f"{recent_tickets} tickets in last 30 days (spike)")
        if offline_devices > 0:
            health_score -= 5 * min(offline_devices, 5)
            risk_factors.append(f"{offline_devices} devices offline")
        if overdue_invoices:
            health_score -= 15
            risk_factors.append(f"{len(overdue_invoices)} overdue invoices (${sum(float(i.get('total', 0)) for i in overdue_invoices):,.0f})")
        if expiring_contracts:
            risk_factors.append(f"{len(expiring_contracts)} contract(s) expiring soon")
        if active_contracts == 0:
            health_score -= 10
            risk_factors.append("No active contracts")
        
        if devices > 0 and devices < 10:
            opportunities.append({"type": "expansion", "description": f"Only {devices} devices managed - potential for fleet expansion", "potential_mrr": devices * 15})
        if active_contracts == 0:
            opportunities.append({"type": "contract", "description": "No active contracts - opportunity for managed services agreement", "potential_mrr": 500})
        if devices > 0 and offline_devices == 0 and open_tickets < 3:
            opportunities.append({"type": "premium", "description": "Stable environment - upsell to premium/proactive support tier", "potential_mrr": 200})
        if expiring_contracts:
            for c in expiring_contracts:
                opportunities.append({"type": "renewal", "description": f"Contract '{c.get('name', '')}' expiring - renewal opportunity", "potential_mrr": float(c.get("monthly_value", 0))})
        
        health_score = max(0, min(100, health_score))
        
        entry = {
            "client_id": client_id,
            "client_name": client.get("name", ""),
            "health_score": health_score,
            "status": "critical" if health_score < 30 else "at_risk" if health_score < 60 else "healthy",
            "mrr": float(client.get("mrr", 0)),
            "risk_factors": risk_factors,
            "opportunities": opportunities,
            "metrics": {
                "open_tickets": open_tickets,
                "critical_tickets": critical_tickets,
                "total_tickets": total_tickets,
                "recent_tickets_30d": recent_tickets,
                "devices": devices,
                "offline_devices": offline_devices,
                "active_contracts": active_contracts,
                "expiring_contracts": len(expiring_contracts),
                "overdue_invoices": len(overdue_invoices),
                "outstanding_amount": outstanding_amount,
            },
        }
        
        if health_score < 60:
            at_risk.append(entry)
        if opportunities:
            upsell_opportunities.append(entry)
        if health_score >= 60:
            healthy.append(entry)
    
    at_risk.sort(key=lambda x: x["health_score"])
    upsell_opportunities.sort(key=lambda x: sum(o.get("potential_mrr", 0) for o in x["opportunities"]), reverse=True)
    
    total_potential_mrr = sum(sum(o.get("potential_mrr", 0) for o in c["opportunities"]) for c in upsell_opportunities)
    
    return {
        "summary": {
            "total_clients": len(clients),
            "at_risk_count": len(at_risk),
            "healthy_count": len(healthy),
            "total_potential_mrr": total_potential_mrr,
            "avg_health_score": round(sum(c.get("health_score", 0) for c in (at_risk + healthy)) / max(1, len(clients)), 1),
        },
        "at_risk_clients": at_risk[:20],
        "upsell_opportunities": upsell_opportunities[:20],
        "healthy_clients": healthy[:20],
    }
