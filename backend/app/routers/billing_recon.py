from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()


def _number(value, default=0.0):
    try:
        return float(value if value not in (None, "") else default)
    except (TypeError, ValueError):
        return float(default)


def _normalise_time_entry(entry: dict) -> dict:
    """Expose one reliable billing shape across current and legacy time records."""
    minutes = max(0.0, _number(entry.get("minutes", entry.get("duration_minutes", 0))))
    hours = max(0.0, _number(entry.get("hours"), minutes / 60))
    rate = max(0.0, _number(entry.get("hourly_rate", entry.get("rate", 0))))
    amount = max(0.0, _number(entry.get("total_amount"), hours * rate))
    issues = []
    if hours <= 0:
        issues.append("duration")
    if rate <= 0:
        issues.append("billing_rate")
    if not entry.get("client_id") and not entry.get("client_name"):
        issues.append("client")
    if not entry.get("ticket_id"):
        issues.append("ticket")
    return {
        **entry,
        "minutes": round(minutes, 2),
        "hours": round(hours, 2),
        "rate": round(rate, 2),
        "total_amount": round(amount, 2),
        "billing_ready": not issues,
        "readiness_issues": issues,
    }


@router.get("/billing-recon/overview")
async def billing_reconciliation(current_user: dict = Depends(get_current_user)):
    """Automated billing reconciliation - find unbilled work."""
    # Time entries not linked to invoices
    unbilled_time_docs = await db.time_entries.find(
        {"invoiced": {"$ne": True}, "billable": {"$ne": False}},
        {
            "_id": 0, "id": 1, "ticket_id": 1, "ticket_number": 1, "ticket_title": 1,
            "user_name": 1, "client_id": 1, "client_name": 1, "minutes": 1,
            "duration_minutes": 1, "hours": 1, "hourly_rate": 1, "rate": 1,
            "total_amount": 1, "description": 1, "date": 1, "billable": 1,
        },
    ).sort("date", -1).to_list(500)
    unbilled_time = [_normalise_time_entry(entry) for entry in unbilled_time_docs]

    unbilled_amount = sum(_number(e.get("total_amount")) for e in unbilled_time)
    ready_entries = sum(1 for entry in unbilled_time if entry.get("billing_ready"))
    missing_rate_count = sum(1 for entry in unbilled_time if "billing_rate" in entry.get("readiness_issues", []))
    missing_link_count = sum(
        1 for entry in unbilled_time
        if {"client", "ticket"}.intersection(entry.get("readiness_issues", []))
    )

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
            {"client_id": cid, "date": {"$gte": month_start}},
            {"_id": 0, "hours": 1, "minutes": 1, "duration_minutes": 1},
        ).to_list(200)
        hours_used = sum(
            max(
                0.0,
                _number(
                    entry.get("hours"),
                    _number(entry.get("minutes", entry.get("duration_minutes", 0))) / 60,
                ),
            )
            for entry in time_used
        )

        if hours_used > included_hours:
            overage = hours_used - included_hours
            contract_discrepancies.append({
                "contract_id": c.get("id", ""), "client_id": cid, "contract_name": c.get("name", ""),
                "included_hours": included_hours, "hours_used": round(hours_used, 1),
                "overage_hours": round(overage, 1),
                "overage_value": round(overage * c.get("overage_rate", 100), 2),
            })

    # Overdue invoices
    overdue = await db.invoices.find(
        {"status": "overdue"}, {"_id": 0, "id": 1, "invoice_number": 1, "client_name": 1, "total": 1, "due_date": 1}
    ).to_list(100)
    overdue_total = sum(_number(i.get("total")) for i in overdue)

    # Supplier invoice variances recorded against purchase orders. These are cost-control
    # exceptions, not customer revenue, so keep them separate from recoverable revenue.
    supplier_variances = await db.purchase_orders.find(
        {"vendor_invoice_match.status": "variance"},
        {"_id": 0, "id": 1, "po_number": 1, "vendor": 1, "total": 1, "vendor_invoice_match": 1}
    ).to_list(200)
    active_supplier_variances = [
        po for po in supplier_variances
        if (po.get("vendor_invoice_match") or {}).get("review", {}).get("status") != "accepted"
    ]
    supplier_variance_total = round(sum(abs(float((po.get("vendor_invoice_match") or {}).get("variance", 0) or 0)) for po in active_supplier_variances), 2)

    return {
        "unbilled_time": {
            "entries": unbilled_time[:20],
            "total_entries": len(unbilled_time),
            "total_amount": round(unbilled_amount, 2),
            "ready_entries": ready_entries,
            "missing_rate_count": missing_rate_count,
            "missing_link_count": missing_link_count,
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
        "supplier_invoice_variances": {
            "purchase_orders": active_supplier_variances[:20],
            "total_count": len(active_supplier_variances),
            "total_amount": supplier_variance_total,
            "accepted_count": len(supplier_variances) - len(active_supplier_variances),
        },
        "total_recoverable": round(unbilled_amount + uninvoiced_products_total + overdue_total, 2),
        "action_count": (
            len(unbilled_time)
            + len(tickets_with_products)
            + len(contract_discrepancies)
            + len(overdue)
            + len(active_supplier_variances)
        ),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
