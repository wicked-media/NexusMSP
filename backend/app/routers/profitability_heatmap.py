from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
from app.services.scope_permissions import scoped_query
from datetime import datetime, timezone

router = APIRouter(prefix="/profitability-heatmap", tags=["Client Profitability Heatmap"])

@router.get("/data")
async def get_profitability_heatmap(user=Depends(get_current_user)):
    clients = await db.clients.find(
        scoped_query(user, field="id", site_field=None), {"_id": 0}
    ).to_list(200)
    contracts = await db.contracts.find(
        scoped_query(user, {"status": "active"}), {"_id": 0}
    ).to_list(500)
    time_entries = await db.time_entries.find(
        scoped_query(user), {"_id": 0}
    ).to_list(5000)
    
    # Build revenue and cost per client
    client_mrr = {}
    for c in contracts:
        cid = c.get("client_id", "")
        client_mrr[cid] = client_mrr.get(cid, 0) + c.get("value", 0)
    
    client_cost = {}
    for te in time_entries:
        cid = te.get("client_id", "")
        client_cost[cid] = client_cost.get(cid, 0) + te.get("total_amount", 0)
    
    results = []
    for cl in clients:
        cid = cl["id"]
        revenue = client_mrr.get(cid, 0)
        cost = round(client_cost.get(cid, 0), 2)
        profit = round(revenue - cost, 2)
        margin = round((profit / revenue) * 100, 1) if revenue > 0 else 0
        
        devices = await db.devices.count_documents({"client_id": cid})
        tickets = await db.tickets.count_documents({"client_id": cid})
        
        status = "highly_profitable" if margin > 50 else "profitable" if margin > 20 else "marginal" if margin > 0 else "unprofitable"
        
        results.append({
            "client_id": cid, "client_name": cl["name"],
            "industry": cl.get("industry", ""),
            "mrr": revenue, "cost": cost, "profit": profit, "margin_pct": margin,
            "devices": devices, "tickets": tickets,
            "status": status,
        })
    
    results.sort(key=lambda x: x["profit"], reverse=True)
    
    total_revenue = sum(r["mrr"] for r in results)
    total_cost = sum(r["cost"] for r in results)
    
    return {
        "summary": {
            "total_clients": len(results),
            "total_mrr": total_revenue,
            "total_cost": round(total_cost, 2),
            "total_profit": round(total_revenue - total_cost, 2),
            "avg_margin": round(sum(r["margin_pct"] for r in results) / max(len(results), 1), 1),
            "profitable": len([r for r in results if r["status"] in ["highly_profitable", "profitable"]]),
            "unprofitable": len([r for r in results if r["status"] == "unprofitable"]),
        },
        "clients": results,
    }
