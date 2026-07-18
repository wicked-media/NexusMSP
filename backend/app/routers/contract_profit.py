from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/contract-profit/overview")
async def contract_profitability(current_user: dict = Depends(get_current_user)):
    """Analyze profitability of each client contract."""
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(200)
    results = []
    total_profit = 0
    total_loss = 0

    for c in contracts:
        cid = c.get("client_id", "")
        monthly_value = c.get("value", 0)
        included_hours = c.get("included_hours", 0)
        hourly_rate = c.get("overage_rate", 100)

        # Actual hours used this month
        month_start = datetime.now(timezone.utc).replace(day=1).date().isoformat()
        time_entries = await db.time_entries.find({"client_id": cid, "date": {"$gte": month_start}}, {"_id": 0, "hours": 1}).to_list(200)
        hours_used = sum(e.get("hours", 0) for e in time_entries)

        # Ticket count
        tickets_this_month = await db.tickets.count_documents({"client_id": cid, "created_at": {"$gte": month_start}})

        # Cost calculation (estimated at $50/hr internal cost)
        internal_cost_per_hour = 50
        total_cost = hours_used * internal_cost_per_hour
        profit = monthly_value - total_cost
        margin_pct = round((profit / max(monthly_value, 1)) * 100, 1) if monthly_value > 0 else 0

        if profit > 0:
            total_profit += profit
        else:
            total_loss += abs(profit)

        client = await db.clients.find_one({"id": cid}, {"_id": 0, "name": 1})

        results.append({
            "contract_id": c.get("id", ""),
            "client_id": cid, "client_name": (client or {}).get("name", ""),
            "contract_name": c.get("name", ""),
            "monthly_value": monthly_value, "included_hours": included_hours,
            "hours_used": round(hours_used, 1), "tickets_this_month": tickets_this_month,
            "total_cost": round(total_cost, 2), "profit": round(profit, 2),
            "margin_pct": margin_pct,
            "status": "profitable" if margin_pct > 20 else "marginal" if margin_pct >= 0 else "unprofitable",
        })

    results.sort(key=lambda x: x["profit"])
    return {
        "contracts": results,
        "summary": {
            "total_contracts": len(results),
            "profitable": len([r for r in results if r["status"] == "profitable"]),
            "marginal": len([r for r in results if r["status"] == "marginal"]),
            "unprofitable": len([r for r in results if r["status"] == "unprofitable"]),
            "total_profit": round(total_profit, 2),
            "total_loss": round(total_loss, 2),
            "net": round(total_profit - total_loss, 2),
        },
    }
