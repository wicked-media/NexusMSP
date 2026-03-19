from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/billing-recon/overview")
async def billing_reconciliation(current_user: dict = Depends(get_current_user)):
    """Automated billing reconciliation - find unbilled work."""
    # Time entries not linked to invoices
    unbilled_time = await db.time_entries.find(
        {"invoiced": {"$ne": True}}, {"_id": 0, "id": 1, "user_name": 1, "client_name": 1,
         "hours": 1, "rate": 1, "description": 1, "date": 1}
    ).to_list(500)

    unbilled_amount = sum(e.get("hours", 0) * e.get("rate", 0) for e in unbilled_time)

    # Tickets with products not invoiced
    tickets_with_products = await db.tickets.find(
        {"products": {"$exists": True, "$ne": []}, "products_invoiced": {"$ne": True}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_name": 1, "products": 1}
    ).to_list(200)

    uninvoiced_products_total = 0
    for t in tickets_with_products:
        for p in (t.get("products") or []):
            uninvoiced_products_total += p.get("price", 0) * p.get("quantity", 1)

    # Contract vs actual work comparison
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(100)
    contract_discrepancies = []
    for c in contracts:
        cid = c.get("client_id", "")
        included_hours = c.get("included_hours", 0)
        if included_hours <= 0:
            continue

        # Count hours used this month
        month_start = datetime.now(timezone.utc).replace(day=1).date().isoformat()
        time_used = await db.time_entries.find(
            {"client_id": cid, "date": {"$gte": month_start}}, {"_id": 0, "hours": 1}
        ).to_list(200)
        hours_used = sum(e.get("hours", 0) for e in time_used)

        if hours_used > included_hours:
            overage = hours_used - included_hours
            contract_discrepancies.append({
                "client_id": cid, "contract_name": c.get("name", ""),
                "included_hours": included_hours, "hours_used": round(hours_used, 1),
                "overage_hours": round(overage, 1),
                "overage_value": round(overage * c.get("overage_rate", 100), 2),
            })

    # Overdue invoices
    overdue = await db.invoices.find(
        {"status": "overdue"}, {"_id": 0, "id": 1, "invoice_number": 1, "client_name": 1, "total": 1, "due_date": 1}
    ).to_list(100)
    overdue_total = sum(i.get("total", 0) for i in overdue)

    return {
        "unbilled_time": {
            "entries": unbilled_time[:20],
            "total_entries": len(unbilled_time),
            "total_amount": round(unbilled_amount, 2),
        },
        "uninvoiced_products": {
            "tickets": tickets_with_products[:20],
            "total_tickets": len(tickets_with_products),
            "total_amount": round(uninvoiced_products_total, 2),
        },
        "contract_overages": contract_discrepancies,
        "overdue_invoices": {
            "invoices": overdue[:20],
            "total_count": len(overdue),
            "total_amount": round(overdue_total, 2),
        },
        "total_recoverable": round(unbilled_amount + uninvoiced_products_total + overdue_total, 2),
    }
