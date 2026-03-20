from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone, timedelta

router = APIRouter(prefix="/client-risk", tags=["Client Risk"])

@router.get("/dashboard")
async def get_client_risk_dashboard(user=Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0}).to_list(200)
    results = []
    
    for cl in clients:
        cid = cl["id"]
        open_tickets = await db.tickets.count_documents({"client_id": cid, "status": {"$in": ["open", "in_progress"]}})
        critical_tickets = await db.tickets.count_documents({"client_id": cid, "priority": "critical", "status": {"$in": ["open", "in_progress"]}})
        total_tickets = await db.tickets.count_documents({"client_id": cid})
        
        sentiment = await db.sentiment_scores.find_one({"client_id": cid}, {"_id": 0})
        sentiment_score = sentiment.get("score", 70) if sentiment else 70
        
        invoices = await db.invoices.find({"client_id": cid, "status": "overdue"}, {"_id": 0}).to_list(50)
        overdue_amount = sum(i.get("total", 0) for i in invoices)
        
        contracts = await db.contracts.find({"client_id": cid, "status": "active"}, {"_id": 0}).to_list(10)
        mrr = sum(c.get("value", 0) for c in contracts)
        
        csat = await db.csat_surveys.find({"client_id": cid}, {"_id": 0, "score": 1}).to_list(50)
        avg_csat = round(sum(c["score"] for c in csat) / len(csat), 1) if csat else 0
        
        # Risk scoring
        risk_score = 0
        risk_factors = []
        if critical_tickets > 0:
            risk_score += 25
            risk_factors.append(f"{critical_tickets} critical tickets open")
        if open_tickets > 5:
            risk_score += 15
            risk_factors.append(f"{open_tickets} tickets open")
        if sentiment_score < 50:
            risk_score += 25
            risk_factors.append(f"Low sentiment ({sentiment_score})")
        elif sentiment_score < 70:
            risk_score += 10
            risk_factors.append(f"Declining sentiment ({sentiment_score})")
        if overdue_amount > 0:
            risk_score += 20
            risk_factors.append(f"${overdue_amount:,.0f} overdue")
        if avg_csat > 0 and avg_csat < 3:
            risk_score += 15
            risk_factors.append(f"Low CSAT ({avg_csat})")
        
        risk_level = "critical" if risk_score >= 50 else "high" if risk_score >= 30 else "medium" if risk_score >= 15 else "low"
        
        results.append({
            "client_id": cid, "client_name": cl["name"], "industry": cl.get("industry", ""),
            "mrr": mrr, "open_tickets": open_tickets, "critical_tickets": critical_tickets,
            "total_tickets": total_tickets, "sentiment_score": sentiment_score,
            "overdue_amount": overdue_amount, "avg_csat": avg_csat,
            "risk_score": min(risk_score, 100), "risk_level": risk_level,
            "risk_factors": risk_factors,
        })
    
    results.sort(key=lambda x: x["risk_score"], reverse=True)
    
    return {
        "stats": {
            "total_clients": len(results),
            "critical": len([r for r in results if r["risk_level"] == "critical"]),
            "high": len([r for r in results if r["risk_level"] == "high"]),
            "medium": len([r for r in results if r["risk_level"] == "medium"]),
            "low": len([r for r in results if r["risk_level"] == "low"]),
            "total_at_risk_mrr": sum(r["mrr"] for r in results if r["risk_level"] in ["critical", "high"]),
        },
        "clients": results,
    }
