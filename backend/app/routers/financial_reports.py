from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
from typing import Optional
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== COMPREHENSIVE FINANCIAL REPORTING ==============

@router.get("/reports/financial/revenue-summary")
async def revenue_summary(months: int = 12, current_user: dict = Depends(get_current_user)):
    """Monthly revenue summary with MRR, ARR, collections, outstanding"""
    invoices = await db.invoices.find({"is_split_parent": {"$ne": True}}, {"_id": 0}).to_list(5000)
    now = datetime.now(timezone.utc)
    monthly = {}

    for i in range(months):
        dt = now - timedelta(days=30 * i)
        key = dt.strftime("%Y-%m")
        monthly[key] = {"month": key, "revenue": 0, "collected": 0, "outstanding": 0, "invoice_count": 0, "new_clients": 0}

    for inv in invoices:
        created = str(inv.get("created_at", ""))[:7]
        if created in monthly:
            total = float(inv.get("total", 0))
            paid = float(inv.get("amount_paid", 0))
            monthly[created]["revenue"] += total
            monthly[created]["collected"] += paid
            monthly[created]["outstanding"] += (total - paid)
            monthly[created]["invoice_count"] += 1

    # Calculate MRR from active contracts
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(500)
    mrr = sum(float(c.get("value", 0)) for c in contracts)
    arr = mrr * 12

    data = sorted(monthly.values(), key=lambda x: x["month"])
    return {
        "monthly_data": data,
        "current_mrr": round(mrr, 2),
        "current_arr": round(arr, 2),
        "total_revenue": round(sum(d["revenue"] for d in data), 2),
        "total_collected": round(sum(d["collected"] for d in data), 2),
        "total_outstanding": round(sum(d["outstanding"] for d in data), 2),
    }


AGING_BUCKETS = (
    ("current", "Current", 0),
    ("30_days", "1–30 days overdue", 30),
    ("60_days", "31–60 days overdue", 60),
    ("90_days", "61–90 days overdue", 90),
    ("over_90", "Over 90 days overdue", None),
)


async def build_accounts_receivable_aging() -> dict:
    """Build the single, reusable accounts-receivable ageing evidence snapshot."""
    invoices = await db.invoices.find({
        "payment_status": {"$in": ["unpaid", "partial"]},
        "status": {"$ne": "cancelled"},
        "is_split_parent": {"$ne": True},
    }, {"_id": 0}).to_list(5000)
    now = datetime.now(timezone.utc)

    buckets = {key: [] for key, _, _ in AGING_BUCKETS}
    totals = {key: 0.0 for key, _, _ in AGING_BUCKETS}

    for inv in invoices:
        balance = float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
        if balance <= 0:
            continue
        due = str(inv.get("due_date") or "")
        try:
            due_dt = datetime.fromisoformat(due.replace("Z", "+00:00")) if due else now
            if due_dt.tzinfo is None:
                due_dt = due_dt.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            due_dt = now
        days_overdue = (now - due_dt).days

        item = {
            "invoice_id": inv.get("id"),
            "invoice_number": inv.get("invoice_number", ""),
            "client_name": inv.get("client_name", ""),
            "client_id": inv.get("client_id", ""),
            "due_date": due,
            "total": float(inv.get("total", 0)),
            "balance": round(balance, 2),
            "days_overdue": max(0, days_overdue),
        }

        bucket = "current" if days_overdue <= 0 else "30_days" if days_overdue <= 30 else "60_days" if days_overdue <= 60 else "90_days" if days_overdue <= 90 else "over_90"
        buckets[bucket].append(item)
        totals[bucket] += balance

    for items in buckets.values():
        items.sort(key=lambda item: (-item["days_overdue"], -item["balance"], item["invoice_number"]))

    return {
        "as_of": now.date().isoformat(),
        "buckets": {
            key: {"label": label, "items": buckets[key], "total": round(totals[key], 2), "count": len(buckets[key])}
            for key, label, _ in AGING_BUCKETS
        },
        "grand_total": round(sum(totals.values()), 2),
        "total_invoices": sum(len(items) for items in buckets.values()),
    }


@router.get("/reports/financial/aging")
async def accounts_receivable_aging(current_user: dict = Depends(get_current_user)):
    """Accounts receivable ageing report retained in the Reports workspace."""
    return await build_accounts_receivable_aging()


@router.get("/reports/financial/profit-loss")
async def profit_loss_report(months: int = 12, current_user: dict = Depends(get_current_user)):
    """Profit & Loss statement"""
    invoices = await db.invoices.find({"is_split_parent": {"$ne": True}}, {"_id": 0}).to_list(5000)
    now = datetime.now(timezone.utc)
    monthly = {}

    for i in range(months):
        dt = now - timedelta(days=30 * i)
        key = dt.strftime("%Y-%m")
        monthly[key] = {"month": key, "revenue": 0, "cogs": 0, "gross_profit": 0, "operating_expenses": 0, "net_profit": 0}

    for inv in invoices:
        created = str(inv.get("created_at", ""))[:7]
        if created in monthly:
            total = float(inv.get("total", 0))
            monthly[created]["revenue"] += total
            monthly[created]["cogs"] += total * 0.35  # Estimated COGS
            monthly[created]["operating_expenses"] += total * 0.25  # Estimated OpEx

    for k, v in monthly.items():
        v["gross_profit"] = round(v["revenue"] - v["cogs"], 2)
        v["net_profit"] = round(v["revenue"] - v["cogs"] - v["operating_expenses"], 2)
        v["revenue"] = round(v["revenue"], 2)
        v["cogs"] = round(v["cogs"], 2)
        v["operating_expenses"] = round(v["operating_expenses"], 2)
        v["margin_percent"] = round((v["net_profit"] / v["revenue"] * 100) if v["revenue"] > 0 else 0, 1)

    data = sorted(monthly.values(), key=lambda x: x["month"])
    return {"monthly_data": data}


@router.get("/reports/financial/client-revenue")
async def client_revenue_report(current_user: dict = Depends(get_current_user)):
    """Revenue breakdown per client"""
    invoices = await db.invoices.find({"is_split_parent": {"$ne": True}}, {"_id": 0}).to_list(5000)
    client_data = {}

    for inv in invoices:
        cid = inv.get("client_id", "unknown")
        if cid not in client_data:
            client_data[cid] = {"client_id": cid, "client_name": inv.get("client_name", "Unknown"), "total_invoiced": 0, "total_paid": 0, "outstanding": 0, "invoice_count": 0}
        client_data[cid]["total_invoiced"] += float(inv.get("total", 0))
        client_data[cid]["total_paid"] += float(inv.get("amount_paid", 0))
        client_data[cid]["outstanding"] += float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
        client_data[cid]["invoice_count"] += 1

    for c in client_data.values():
        c["total_invoiced"] = round(c["total_invoiced"], 2)
        c["total_paid"] = round(c["total_paid"], 2)
        c["outstanding"] = round(c["outstanding"], 2)
        c["collection_rate"] = round((c["total_paid"] / c["total_invoiced"] * 100) if c["total_invoiced"] > 0 else 0, 1)

    clients = sorted(client_data.values(), key=lambda x: x["total_invoiced"], reverse=True)
    return {"clients": clients, "total_invoiced": round(sum(c["total_invoiced"] for c in clients), 2), "total_collected": round(sum(c["total_paid"] for c in clients), 2)}


@router.get("/reports/financial/service-revenue")
async def service_revenue_report(current_user: dict = Depends(get_current_user)):
    """Revenue breakdown by service type / line item"""
    invoices = await db.invoices.find({"is_split_parent": {"$ne": True}}, {"_id": 0}).to_list(5000)
    services = {}

    for inv in invoices:
        for li in (inv.get("line_items") or []):
            name = li.get("name", "Unknown Service")
            if name not in services:
                services[name] = {"service_name": name, "total_revenue": 0, "total_quantity": 0, "invoice_count": 0, "avg_unit_price": 0}
            qty = int(li.get("quantity", 0))
            price = float(li.get("unit_price", 0))
            services[name]["total_revenue"] += qty * price
            services[name]["total_quantity"] += qty
            services[name]["invoice_count"] += 1

    for s in services.values():
        s["total_revenue"] = round(s["total_revenue"], 2)
        s["avg_unit_price"] = round(s["total_revenue"] / s["total_quantity"], 2) if s["total_quantity"] > 0 else 0

    data = sorted(services.values(), key=lambda x: x["total_revenue"], reverse=True)
    return {"services": data, "total_service_revenue": round(sum(s["total_revenue"] for s in data), 2)}


@router.get("/reports/financial/payment-collection")
async def payment_collection_report(months: int = 12, current_user: dict = Depends(get_current_user)):
    """Payment collection trends and methods"""
    invoices = await db.invoices.find({"is_split_parent": {"$ne": True}}, {"_id": 0}).to_list(5000)
    now = datetime.now(timezone.utc)

    methods = {}
    monthly_collections = {}

    for inv in invoices:
        for p in (inv.get("payments") or []):
            method = p.get("method", "other")
            amt = float(p.get("amount", 0))
            if method not in methods:
                methods[method] = {"method": method, "total": 0, "count": 0}
            methods[method]["total"] += amt
            methods[method]["count"] += 1

            date_str = str(p.get("date", ""))[:7]
            if date_str:
                if date_str not in monthly_collections:
                    monthly_collections[date_str] = {"month": date_str, "collected": 0, "transaction_count": 0}
                monthly_collections[date_str]["collected"] += amt
                monthly_collections[date_str]["transaction_count"] += 1

    for m in methods.values():
        m["total"] = round(m["total"], 2)

    return {
        "by_method": sorted(methods.values(), key=lambda x: x["total"], reverse=True),
        "monthly": sorted(monthly_collections.values(), key=lambda x: x["month"]),
    }


@router.get("/reports/financial/tax-summary")
async def tax_summary_report(current_user: dict = Depends(get_current_user)):
    """Tax summary for accounting"""
    invoices = await db.invoices.find({"is_split_parent": {"$ne": True}}, {"_id": 0}).to_list(5000)
    now = datetime.now(timezone.utc)
    quarterly = {}

    for inv in invoices:
        created = str(inv.get("created_at", ""))[:10]
        try:
            dt = datetime.fromisoformat(created)
            q = f"{dt.year}-Q{(dt.month - 1) // 3 + 1}"
        except:
            q = f"{now.year}-Q{(now.month - 1) // 3 + 1}"

        if q not in quarterly:
            quarterly[q] = {"quarter": q, "subtotal": 0, "tax_collected": 0, "total": 0, "invoice_count": 0}
        quarterly[q]["subtotal"] += float(inv.get("subtotal", 0))
        quarterly[q]["tax_collected"] += float(inv.get("tax", 0))
        quarterly[q]["total"] += float(inv.get("total", 0))
        quarterly[q]["invoice_count"] += 1

    for v in quarterly.values():
        v["subtotal"] = round(v["subtotal"], 2)
        v["tax_collected"] = round(v["tax_collected"], 2)
        v["total"] = round(v["total"], 2)
        v["effective_tax_rate"] = round((v["tax_collected"] / v["subtotal"] * 100) if v["subtotal"] > 0 else 0, 1)

    data = sorted(quarterly.values(), key=lambda x: x["quarter"])
    return {"quarters": data, "total_tax_collected": round(sum(d["tax_collected"] for d in data), 2)}


@router.get("/reports/financial/monthly-allocations")
async def monthly_allocations_report(current_user: dict = Depends(get_current_user)):
    """Monthly cost/revenue allocations for accounts team"""
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(500)
    invoices = await db.invoices.find({"is_split_parent": {"$ne": True}}, {"_id": 0}).to_list(5000)
    now = datetime.now(timezone.utc)
    current_month = now.strftime("%Y-%m")

    # Revenue allocations
    allocations = []
    for c in contracts:
        value = float(c.get("value", 0))
        allocations.append({
            "type": "recurring",
            "source": "contract",
            "source_id": c.get("id"),
            "client_name": c.get("client_name", ""),
            "client_id": c.get("client_id", ""),
            "description": c.get("name", "Contract"),
            "amount": round(value, 2),
            "category": "MRR",
        })

    # One-time revenue from invoices this month
    for inv in invoices:
        if str(inv.get("created_at", ""))[:7] == current_month:
            for li in (inv.get("line_items") or []):
                allocations.append({
                    "type": "one_time",
                    "source": "invoice",
                    "source_id": inv.get("id"),
                    "client_name": inv.get("client_name", ""),
                    "client_id": inv.get("client_id", ""),
                    "description": li.get("name", "Line Item"),
                    "amount": round(float(li.get("quantity", 0)) * float(li.get("unit_price", 0)), 2),
                    "category": "Project/Ad-hoc",
                })

    total_mrr = round(sum(a["amount"] for a in allocations if a["category"] == "MRR"), 2)
    total_adhoc = round(sum(a["amount"] for a in allocations if a["category"] != "MRR"), 2)

    return {
        "month": current_month,
        "allocations": allocations,
        "summary": {
            "total_mrr": total_mrr,
            "total_adhoc": total_adhoc,
            "total_revenue": round(total_mrr + total_adhoc, 2),
            "contract_count": len(contracts),
        }
    }
