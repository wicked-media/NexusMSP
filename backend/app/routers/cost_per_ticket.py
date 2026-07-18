from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone

router = APIRouter(prefix="/cost-per-ticket", tags=["Cost Per Ticket"])

@router.get("/dashboard")
async def get_cost_per_ticket(user=Depends(get_current_user)):
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(1000)
    time_entries = await db.time_entries.find({}, {"_id": 0}).to_list(5000)
    linked_purchase_orders = await db.purchase_orders.find(
        {"ticket_id": {"$exists": True, "$ne": ""}, "status": {"$in": ["submitted", "partial", "received"]}},
        {"_id": 0, "ticket_id": 1, "total": 1, "vendor_invoice_match": 1}
    ).to_list(2000)
    
    # Build time entries by ticket
    ticket_time = {}
    for te in time_entries:
        tid = te.get("ticket_id")
        if tid:
            if tid not in ticket_time:
                ticket_time[tid] = {"minutes": 0, "cost": 0, "entries": 0}
            ticket_time[tid]["minutes"] += te.get("minutes", 0)
            ticket_time[tid]["cost"] += te.get("total_amount", 0)
            ticket_time[tid]["entries"] += 1

    # Costs are based on the supplier invoice total where it has been matched;
    # otherwise the PO total is a committed-cost estimate until an invoice arrives.
    ticket_procurement = {}
    for po in linked_purchase_orders:
        tid = po.get("ticket_id")
        match = po.get("vendor_invoice_match") or {}
        try:
            cost = float(match.get("supplier_total") if match.get("supplier_total") is not None else po.get("total", 0))
        except (TypeError, ValueError):
            cost = 0
        bucket = ticket_procurement.setdefault(tid, {"cost": 0, "orders": 0, "matched_orders": 0})
        bucket["cost"] += cost
        bucket["orders"] += 1
        bucket["matched_orders"] += 1 if match else 0
    
    results = []
    by_category = {}
    by_client = {}
    by_priority = {}
    
    for t in tickets:
        tid = t["id"]
        tt = ticket_time.get(tid, {"minutes": 0, "cost": 0, "entries": 0})
        procurement = ticket_procurement.get(tid, {"cost": 0, "orders": 0, "matched_orders": 0})
        labor_cost = tt["cost"]
        supplier_cost = procurement["cost"]
        total_cost = labor_cost + supplier_cost
        hours = round(tt["minutes"] / 60, 2)
        
        entry = {
            "ticket_id": tid, "title": t.get("title", ""),
            "client_name": t.get("client_name", ""), "client_id": t.get("client_id", ""),
            "category": t.get("category", "other"), "priority": t.get("priority", "low"),
            "status": t.get("status", ""),
            "hours_spent": hours, "labor_cost": round(labor_cost, 2),
            "supplier_cost": round(supplier_cost, 2), "total_cost": round(total_cost, 2),
            "purchase_orders": procurement["orders"], "matched_purchase_orders": procurement["matched_orders"],
            "time_entries": tt["entries"],
        }
        results.append(entry)
        
        cat = t.get("category", "other")
        if cat not in by_category:
            by_category[cat] = {"count": 0, "total_cost": 0, "total_hours": 0}
        by_category[cat]["count"] += 1
        by_category[cat]["total_cost"] += total_cost
        by_category[cat]["total_hours"] += hours
        
        cn = t.get("client_name", "Unknown")
        if cn not in by_client:
            by_client[cn] = {"count": 0, "total_cost": 0}
        by_client[cn]["count"] += 1
        by_client[cn]["total_cost"] += total_cost
        
        pri = t.get("priority", "low")
        if pri not in by_priority:
            by_priority[pri] = {"count": 0, "total_cost": 0}
        by_priority[pri]["count"] += 1
        by_priority[pri]["total_cost"] += total_cost
    
    total_labor_cost = sum(r["labor_cost"] for r in results)
    total_supplier_cost = sum(r["supplier_cost"] for r in results)
    total_cost = sum(r["total_cost"] for r in results)
    total_with_time = [r for r in results if r["time_entries"] > 0]
    avg_cost = round(total_cost / max(len(total_with_time), 1), 2)
    
    return {
        "summary": {
            "total_tickets": len(results),
            "tickets_with_time": len(total_with_time),
            "total_labor_cost": round(total_labor_cost, 2),
            "total_supplier_cost": round(total_supplier_cost, 2),
            "total_cost": round(total_cost, 2),
            "avg_cost_per_ticket": avg_cost,
            "avg_hours_per_ticket": round(sum(r["hours_spent"] for r in results) / max(len(total_with_time), 1), 2),
        },
        "tickets": sorted(results, key=lambda x: x["total_cost"], reverse=True)[:50],
        "by_category": [{"category": k, **v, "avg_cost": round(v["total_cost"] / max(v["count"], 1), 2)} for k, v in sorted(by_category.items(), key=lambda x: -x[1]["total_cost"])],
        "by_client": [{"client": k, **v, "avg_cost": round(v["total_cost"] / max(v["count"], 1), 2)} for k, v in sorted(by_client.items(), key=lambda x: -x[1]["total_cost"])],
        "by_priority": [{"priority": k, **v, "avg_cost": round(v["total_cost"] / max(v["count"], 1), 2)} for k, v in by_priority.items()],
    }
