from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone, timedelta
import random; random = random.SystemRandom()

router = APIRouter(prefix="/revenue-forecast", tags=["Revenue Forecast"])

@router.get("/dashboard")
async def get_revenue_forecast(user=Depends(get_current_user)):
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(200)
    clients = await db.clients.find({}, {"_id": 0}).to_list(200)
    
    total_mrr = sum(c.get("value", 0) for c in contracts)
    total_arr = total_mrr * 12
    
    # Calculate per-client MRR
    client_mrr = {}
    for c in contracts:
        cid = c.get("client_id", "")
        client_mrr[cid] = client_mrr.get(cid, 0) + c.get("value", 0)
    
    # Forecast: project MRR forward 12 months with growth/churn estimates
    monthly_forecast = []
    current_mrr = total_mrr
    for i in range(12):
        month = datetime.now(timezone.utc) + timedelta(days=30 * i)
        growth_rate = random.uniform(0.005, 0.03)  # 0.5-3% monthly growth
        churn_rate = random.uniform(0.005, 0.015)  # 0.5-1.5% churn
        net_growth = growth_rate - churn_rate
        current_mrr = round(current_mrr * (1 + net_growth), 2)
        monthly_forecast.append({
            "month": month.strftime("%b %Y"),
            "mrr": current_mrr,
            "arr": round(current_mrr * 12, 2),
            "growth_pct": round(net_growth * 100, 2),
        })
    
    # Churn risk clients (clients with declining sentiment or many tickets)
    churn_risks = []
    for cl in clients[:15]:
        tickets = await db.tickets.count_documents({"client_id": cl["id"], "status": {"$in": ["open", "in_progress"]}})
        sentiment = await db.sentiment_scores.find_one({"client_id": cl["id"]}, {"_id": 0})
        score = sentiment.get("score", 75) if sentiment else 75
        risk = "low"
        if tickets > 5 or score < 50:
            risk = "high"
        elif tickets > 3 or score < 65:
            risk = "medium"
        if risk != "low":
            churn_risks.append({
                "client_id": cl["id"], "client_name": cl["name"],
                "mrr": client_mrr.get(cl["id"], 0),
                "open_tickets": tickets, "sentiment": score, "risk": risk,
            })
    
    return {
        "summary": {
            "current_mrr": total_mrr,
            "current_arr": total_arr,
            "projected_arr_12m": monthly_forecast[-1]["arr"] if monthly_forecast else total_arr,
            "total_clients": len(clients),
            "churn_risks": len(churn_risks),
        },
        "forecast": monthly_forecast,
        "churn_risks": sorted(churn_risks, key=lambda x: x["mrr"], reverse=True),
    }
