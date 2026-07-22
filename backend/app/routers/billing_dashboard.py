from fastapi import APIRouter, Depends, HTTPException
from app.database import db
from app.routers.auth import get_current_user
from datetime import datetime, timezone, timedelta

router = APIRouter(tags=["Billing Dashboard"])


@router.get("/billing-dashboard/metrics")
async def get_billing_dashboard_metrics(user=Depends(get_current_user)):
    """Aggregate all billing metrics for the dedicated billing dashboard."""
    now = datetime.now(timezone.utc)

    # --- Fetch all invoices ---
    # Split-billing source records are audit-only; their payer invoices carry
    # the live receivable and must be the sole source of billing metrics.
    all_invoices = await db.invoices.find({"is_split_parent": {"$ne": True}}, {"_id": 0}).to_list(5000)
    all_pos = await db.purchase_orders.find({}, {"_id": 0}).to_list(5000)

    # --- MRR / ARR ---
    total_mrr = 0.0
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(5000)
    for c in contracts:
        total_mrr += float(c.get("mrr", 0) or c.get("monthly_value", 0) or 0)
    recurring_invoices = [i for i in all_invoices if i.get("is_recurring") and i.get("status") != "cancelled"]
    for ri in recurring_invoices:
        interval = ri.get("recurring_interval", "monthly")
        total = float(ri.get("total", 0))
        if interval == "weekly":
            total_mrr += total * 4.33
        elif interval == "biweekly":
            total_mrr += total * 2.17
        elif interval == "monthly":
            total_mrr += total
        elif interval == "quarterly":
            total_mrr += total / 3
        elif interval == "semi-annual":
            total_mrr += total / 6
        elif interval == "annually":
            total_mrr += total / 12
    total_arr = total_mrr * 12

    # --- Revenue stats ---
    total_invoiced = sum(float(i.get("total", 0)) for i in all_invoices if i.get("status") != "cancelled")
    total_collected = sum(float(i.get("amount_paid", 0)) for i in all_invoices)
    total_outstanding = total_invoiced - total_collected
    collection_rate = round((total_collected / total_invoiced * 100), 1) if total_invoiced > 0 else 0

    # --- Payment Health Score (0-100) ---
    # Weighted: on-time=100, <7d late=70, <30d late=40, >30d=10
    paid_invoices = [i for i in all_invoices if i.get("payment_status") == "paid" and i.get("paid_date")]
    health_scores = []
    for inv in paid_invoices:
        try:
            due = datetime.fromisoformat(inv["due_date"]) if inv.get("due_date") else None
            paid = datetime.fromisoformat(inv["paid_date"]) if inv.get("paid_date") else None
            if due and paid:
                days_late = (paid - due).days
                if days_late <= 0:
                    health_scores.append(100)
                elif days_late <= 7:
                    health_scores.append(70)
                elif days_late <= 30:
                    health_scores.append(40)
                else:
                    health_scores.append(10)
        except (ValueError, TypeError):
            pass
    # Also factor in overdue unpaid
    overdue_unpaid = [i for i in all_invoices if i.get("due_date") and i.get("payment_status") != "paid" and i.get("status") != "cancelled"]
    for inv in overdue_unpaid:
        try:
            due = datetime.fromisoformat(inv["due_date"])
            if due.replace(tzinfo=None) < now.replace(tzinfo=None):
                days_late = (now.replace(tzinfo=None) - due.replace(tzinfo=None)).days
                if days_late <= 7:
                    health_scores.append(50)
                elif days_late <= 30:
                    health_scores.append(20)
                else:
                    health_scores.append(0)
        except (ValueError, TypeError):
            pass
    payment_health_score = round(sum(health_scores) / len(health_scores)) if health_scores else 50

    # --- Cash Collection Streak ---
    # Count consecutive days (backwards from today) that had at least one payment
    all_payments = []
    for inv in all_invoices:
        for p in inv.get("payments", []):
            if p.get("date"):
                try:
                    pdate = datetime.fromisoformat(str(p["date"]))
                    all_payments.append(pdate.date() if hasattr(pdate, 'date') else pdate)
                except (ValueError, TypeError):
                    pass
    payment_dates = set()
    for pd_item in all_payments:
        if hasattr(pd_item, 'date'):
            payment_dates.add(pd_item.date() if callable(getattr(pd_item, 'date', None)) else pd_item)
        else:
            payment_dates.add(pd_item)

    streak = 0
    check_date = now.date()
    for _ in range(365):
        if check_date in payment_dates:
            streak += 1
            check_date -= timedelta(days=1)
        else:
            break
    # Streak level
    streak_level = "starter"
    if streak >= 30:
        streak_level = "legendary"
    elif streak >= 14:
        streak_level = "fire"
    elif streak >= 7:
        streak_level = "hot"
    elif streak >= 3:
        streak_level = "warming"

    # Best streak ever
    best_streak = streak
    if all_payments:
        sorted_dates = sorted(set(d if not callable(getattr(d, 'date', None)) else d.date() for d in payment_dates))
        if sorted_dates:
            current_run = 1
            for i in range(1, len(sorted_dates)):
                if (sorted_dates[i] - sorted_dates[i - 1]).days == 1:
                    current_run += 1
                    best_streak = max(best_streak, current_run)
                else:
                    current_run = 1

    # --- Overdue Alerts ---
    overdue_alerts = []
    for inv in all_invoices:
        if inv.get("status") == "cancelled" or inv.get("payment_status") == "paid":
            continue
        due = inv.get("due_date")
        if not due:
            continue
        try:
            due_dt = datetime.fromisoformat(due)
            if due_dt.replace(tzinfo=None) < now.replace(tzinfo=None):
                days_overdue = (now.replace(tzinfo=None) - due_dt.replace(tzinfo=None)).days
                balance = float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
                if balance > 0:
                    overdue_alerts.append({
                        "id": inv.get("id"),
                        "invoice_number": inv.get("invoice_number"),
                        "client_name": inv.get("client_name"),
                        "client_id": inv.get("client_id"),
                        "due_date": due,
                        "days_overdue": days_overdue,
                        "balance": round(balance, 2),
                        "total": round(float(inv.get("total", 0)), 2),
                        "severity": "critical" if days_overdue > 60 else "high" if days_overdue > 30 else "medium" if days_overdue > 14 else "low",
                        "last_emailed": inv.get("last_emailed_at"),
                    })
        except (ValueError, TypeError):
            pass
    overdue_alerts.sort(key=lambda x: x["days_overdue"], reverse=True)

    # --- Recent Payments (last 20) ---
    recent_payments = []
    for inv in all_invoices:
        for p in inv.get("payments", []):
            recent_payments.append({
                "invoice_number": inv.get("invoice_number"),
                "client_name": inv.get("client_name"),
                "amount": round(float(p.get("amount", 0)), 2),
                "method": p.get("method", "unknown"),
                "date": str(p.get("date", "")),
                "reference": p.get("reference", ""),
            })
    recent_payments.sort(key=lambda x: x["date"], reverse=True)
    recent_payments = recent_payments[:20]

    # --- Monthly Revenue Trend (last 6 months) ---
    monthly_trend = []
    for m in range(5, -1, -1):
        month_start = (now.replace(day=1) - timedelta(days=m * 30)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if month_start.month == 12:
            month_end = month_start.replace(year=month_start.year + 1, month=1)
        else:
            month_end = month_start.replace(month=month_start.month + 1)
        invoiced = 0
        collected = 0
        for inv in all_invoices:
            try:
                created = inv.get("created_at")
                if isinstance(created, str):
                    created = datetime.fromisoformat(created)
                elif isinstance(created, datetime):
                    pass
                else:
                    continue
                created_naive = created.replace(tzinfo=None)
                if month_start.replace(tzinfo=None) <= created_naive < month_end.replace(tzinfo=None):
                    invoiced += float(inv.get("total", 0))
                    collected += float(inv.get("amount_paid", 0))
            except (ValueError, TypeError):
                pass
        monthly_trend.append({
            "month": month_start.strftime("%b %Y"),
            "invoiced": round(invoiced, 2),
            "collected": round(collected, 2),
        })

    # --- Top Debtors ---
    debtor_map = {}
    for inv in all_invoices:
        if inv.get("payment_status") == "paid" or inv.get("status") == "cancelled":
            continue
        balance = float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
        if balance > 0:
            client = inv.get("client_name", "Unknown")
            if client not in debtor_map:
                debtor_map[client] = {"client": client, "balance": 0, "invoices": 0}
            debtor_map[client]["balance"] += balance
            debtor_map[client]["invoices"] += 1
    top_debtors = sorted(debtor_map.values(), key=lambda x: x["balance"], reverse=True)[:10]
    for d in top_debtors:
        d["balance"] = round(d["balance"], 2)

    # --- Quick Counts ---
    draft_invoices = len([i for i in all_invoices if i.get("status") == "draft"])
    sent_invoices = len([i for i in all_invoices if i.get("status") == "sent"])
    paid_count = len([i for i in all_invoices if i.get("payment_status") == "paid"])
    overdue_count = len(overdue_alerts)
    total_po_spend = sum(float(p.get("total", 0)) for p in all_pos if p.get("status") not in ["cancelled", "draft"])

    # --- Cash Flow Forecast (next 30 days) ---
    forecast_incoming = 0
    forecast_outgoing = 0
    for inv in all_invoices:
        if inv.get("payment_status") == "paid" or inv.get("status") == "cancelled":
            continue
        due = inv.get("due_date")
        if due:
            try:
                due_dt = datetime.fromisoformat(due)
                if now.replace(tzinfo=None) <= due_dt.replace(tzinfo=None) <= (now + timedelta(days=30)).replace(tzinfo=None):
                    forecast_incoming += float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
            except (ValueError, TypeError):
                pass
    for po in all_pos:
        if po.get("status") in ["submitted", "partial", "approved"]:
            due = po.get("expected_delivery")
            if due:
                try:
                    due_dt = datetime.fromisoformat(due)
                    if now.replace(tzinfo=None) <= due_dt.replace(tzinfo=None) <= (now + timedelta(days=30)).replace(tzinfo=None):
                        forecast_outgoing += float(po.get("total", 0))
                except (ValueError, TypeError):
                    pass

    return {
        "mrr": round(total_mrr, 2),
        "arr": round(total_arr, 2),
        "total_invoiced": round(total_invoiced, 2),
        "total_collected": round(total_collected, 2),
        "total_outstanding": round(total_outstanding, 2),
        "collection_rate": collection_rate,
        "payment_health_score": payment_health_score,
        "streak": {
            "current": streak,
            "best": best_streak,
            "level": streak_level,
        },
        "overdue_alerts": overdue_alerts[:15],
        "overdue_count": overdue_count,
        "recent_payments": recent_payments,
        "monthly_trend": monthly_trend,
        "top_debtors": top_debtors,
        "counts": {
            "total_invoices": len(all_invoices),
            "draft": draft_invoices,
            "sent": sent_invoices,
            "paid": paid_count,
            "overdue": overdue_count,
        },
        "total_po_spend": round(total_po_spend, 2),
        "cash_flow_forecast": {
            "incoming_30d": round(forecast_incoming, 2),
            "outgoing_30d": round(forecast_outgoing, 2),
            "net_30d": round(forecast_incoming - forecast_outgoing, 2),
        },
    }


@router.post("/billing-dashboard/chase/{invoice_id}")
async def chase_overdue_invoice(invoice_id: str, user=Depends(get_current_user)):
    """One-click chase: log a chase event on an overdue invoice."""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    now_str = datetime.now(timezone.utc).isoformat()
    chase_entry = {
        "type": "chase",
        "date": now_str,
        "user_id": user["id"],
        "user_name": user.get("name", "System"),
        "method": "manual",
    }

    await db.invoices.update_one(
        {"id": invoice_id},
        {
            "$push": {"chase_history": chase_entry},
            "$set": {"last_chased_at": now_str, "last_chased_by": user.get("name", "System")},
            "$inc": {"chase_count": 1},
        }
    )

    # Log activity
    await db.invoice_activity_log.insert_one({
        "id": f"act-{invoice_id}-chase-{now_str}",
        "invoice_id": invoice_id,
        "action": "chased",
        "details": f"Payment chase sent by {user.get('name', 'System')}",
        "user_id": user["id"],
        "user_name": user.get("name", "System"),
        "created_at": now_str,
    })
    return {"message": f"Chase logged for {invoice.get('invoice_number', invoice_id)}", "chased_at": now_str}
