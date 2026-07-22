"""Products & Invoices PLUS â€” 9 differentiator features.

1. Smart Product Catalog insights          GET  /api/products/margin-insights
                                           GET  /api/products/{id}/price-history
                                           POST /api/products/{id}/price-change
2. Product Kits / Bundles                  GET  /api/product-kits
                                           POST /api/product-kits
                                           PUT  /api/product-kits/{id}
                                           DELETE /api/product-kits/{id}
                                           POST /api/tickets/{tid}/apply-kit/{kit_id}
3. Per-Client Price Book                   GET  /api/clients/{id}/price-book
                                           POST /api/clients/{id}/price-book
                                           DELETE /api/clients/{id}/price-book/{product_id}
                                           GET  /api/clients/{id}/price-for/{product_id}
4. Subscription Drift Detector             GET  /api/subscription-drift
5. Cash Flow Forecast                      GET  /api/finance/cash-flow-forecast
6. Late-payment Predictor                  GET  /api/invoices/late-payment-risk
                                           GET  /api/invoices/{id}/late-risk
7. Margin per Invoice                      GET  /api/invoices/{id}/margin
                                           GET  /api/finance/margin-overview
8. Predictive Auto-Quote trigger           POST /api/tickets/{id}/quote-nudge
9. Pre-Emptive DisputeShield scan          POST /api/invoices/{id}/dispute-scan
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from datetime import datetime, timezone, timedelta
from typing import Optional
import os, uuid

from app.database import db
from app.auth import get_current_user

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s: return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 1) SMART PRODUCT CATALOG â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/finance/product-margin-insights")
async def product_margin_insights(current_user: dict = Depends(get_current_user)):
    """Returns every product with computed margin%, flags low-margin + recent cost changes."""
    rows = await db.products.find({}, {"_id": 0}).limit(1000).to_list(1000)
    out = []
    low_margin = 0
    cost_erosion = 0
    for p in rows:
        cost = float(p.get("cost_price") or 0)
        retail = float(p.get("retail_price") or 0)
        margin_pct = ((retail - cost) / retail * 100) if retail > 0 else 0
        # Recent cost change heuristic: compare to last price_history entry
        history = p.get("price_history") or []
        prev_cost = None
        if history:
            # Find the most recent record with cost_price different from current
            for h in reversed(history):
                if "cost_price" in h and float(h["cost_price"]) != cost:
                    prev_cost = float(h["cost_price"])
                    break
        cost_change_pct = ((cost - prev_cost) / prev_cost * 100) if prev_cost and prev_cost > 0 else None
        status = "ok"
        if margin_pct < 10: status = "low_margin"; low_margin += 1
        elif cost_change_pct and cost_change_pct > 5: status = "cost_up"; cost_erosion += 1
        out.append({
            "id": p["id"],
            "name": p.get("name"),
            "sku": p.get("sku"),
            "vendor": p.get("vendor"),
            "cost_price": cost,
            "retail_price": retail,
            "margin_dollars": round(retail - cost, 2),
            "margin_pct": round(margin_pct, 1),
            "cost_change_pct": round(cost_change_pct, 1) if cost_change_pct is not None else None,
            "status": status,
        })
    out.sort(key=lambda x: x["margin_pct"])
    return {
        "products": out,
        "summary": {
            "count": len(out),
            "low_margin_count": low_margin,
            "cost_erosion_count": cost_erosion,
            "avg_margin_pct": round(sum(p["margin_pct"] for p in out) / len(out), 1) if out else 0,
        },
    }


@router.get("/finance/product/{product_id}/price-history")
async def product_price_history(product_id: str, current_user: dict = Depends(get_current_user)):
    p = await db.products.find_one({"id": product_id}, {"_id": 0, "price_history": 1, "name": 1})
    if not p: raise HTTPException(404, "product not found")
    return {"product_id": product_id, "name": p.get("name"), "history": p.get("price_history") or []}


@router.post("/finance/product/{product_id}/price-change")
async def record_price_change(product_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Record a cost or retail price change with timestamp."""
    p = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not p: raise HTTPException(404, "product not found")
    entry = {
        "ts": _now_iso(),
        "changed_by": current_user.get("email"),
        "cost_price": float(payload.get("cost_price", p.get("cost_price", 0))),
        "retail_price": float(payload.get("retail_price", p.get("retail_price", 0))),
        "reason": (payload.get("reason") or "")[:200],
    }
    await db.products.update_one(
        {"id": product_id},
        {"$push": {"price_history": entry},
         "$set": {"cost_price": entry["cost_price"], "retail_price": entry["retail_price"], "updated_at": _now_iso()}},
    )
    return {"ok": True, "entry": entry}


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 2) PRODUCT KITS / BUNDLES â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/product-kits")
async def list_kits(current_user: dict = Depends(get_current_user)):
    kits = await db.product_kits.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    # Hydrate totals
    for k in kits:
        total_cost = 0.0
        total_retail = 0.0
        for item in k.get("items") or []:
            p = await db.products.find_one({"id": item.get("product_id")}, {"_id": 0, "cost_price": 1, "retail_price": 1})
            if p:
                total_cost += float(p.get("cost_price") or 0) * int(item.get("quantity") or 1)
                total_retail += float(p.get("retail_price") or 0) * int(item.get("quantity") or 1)
        # Labor component
        labor_rate = float(k.get("labor_rate") or 150)
        labor_hrs = float(k.get("labor_hours") or 0)
        total_retail += labor_hrs * labor_rate
        k["total_cost"] = round(total_cost, 2)
        k["total_retail"] = round(total_retail, 2)
        k["margin_pct"] = round((total_retail - total_cost) / total_retail * 100, 1) if total_retail else 0
    return {"kits": kits, "count": len(kits)}


@router.post("/product-kits")
async def create_kit(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    if not name: raise HTTPException(400, "name required")
    doc = {
        "id": uuid.uuid4().hex,
        "name": name,
        "description": (payload.get("description") or "")[:500],
        "items": payload.get("items") or [],  # [{product_id, quantity}]
        "labor_hours": float(payload.get("labor_hours") or 0),
        "labor_rate": float(payload.get("labor_rate") or 150),
        "category": payload.get("category") or "general",
        "created_at": _now_iso(),
        "created_by": current_user.get("email"),
    }
    await db.product_kits.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.put("/product-kits/{kit_id}")
async def update_kit(kit_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    allowed = {"name", "description", "items", "labor_hours", "labor_rate", "category"}
    patch = {k: v for k, v in payload.items() if k in allowed}
    if "labor_hours" in patch: patch["labor_hours"] = float(patch["labor_hours"])
    if "labor_rate" in patch: patch["labor_rate"] = float(patch["labor_rate"])
    patch["updated_at"] = _now_iso()
    res = await db.product_kits.update_one({"id": kit_id}, {"$set": patch})
    if res.matched_count == 0: raise HTTPException(404, "kit not found")
    return {"ok": True}


@router.delete("/product-kits/{kit_id}")
async def delete_kit(kit_id: str, current_user: dict = Depends(get_current_user)):
    res = await db.product_kits.delete_one({"id": kit_id})
    if res.deleted_count == 0: raise HTTPException(404, "kit not found")
    return {"deleted": True}


@router.post("/tickets/{ticket_id}/apply-kit/{kit_id}")
async def apply_kit_to_ticket(ticket_id: str, kit_id: str, current_user: dict = Depends(get_current_user)):
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t: raise HTTPException(404, "ticket not found")
    kit = await db.product_kits.find_one({"id": kit_id}, {"_id": 0})
    if not kit: raise HTTPException(404, "kit not found")
    # Attach each product as a ticket product
    attached = []
    for item in kit.get("items") or []:
        pid = item.get("product_id")
        qty = int(item.get("quantity") or 1)
        p = await db.products.find_one({"id": pid}, {"_id": 0, "name": 1, "sku": 1, "retail_price": 1, "cost_price": 1})
        if not p: continue
        doc = {
            "id": uuid.uuid4().hex,
            "ticket_id": ticket_id,
            "product_id": pid,
            "name": p.get("name"),
            "sku": p.get("sku"),
            "quantity": qty,
            "unit_price": p.get("retail_price", 0),
            "cost_price": p.get("cost_price", 0),
            "total": qty * float(p.get("retail_price") or 0),
            "source": f"kit:{kit_id}",
            "added_at": _now_iso(),
        }
        await db.ticket_products.insert_one(dict(doc))
        attached.append({"name": p.get("name"), "quantity": qty, "total": doc["total"]})
    return {"ok": True, "attached_count": len(attached), "attached": attached, "kit_name": kit.get("name")}


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 3) PER-CLIENT PRICE BOOK â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/clients/{client_id}/price-book")
async def get_price_book(client_id: str, current_user: dict = Depends(get_current_user)):
    rows = await db.client_price_overrides.find({"client_id": client_id}, {"_id": 0}).to_list(500)
    # Hydrate product names
    for r in rows:
        p = await db.products.find_one({"id": r.get("product_id")}, {"_id": 0, "name": 1, "sku": 1, "retail_price": 1})
        if p:
            r["product_name"] = p.get("name")
            r["product_sku"] = p.get("sku")
            r["standard_price"] = p.get("retail_price")
            r["delta_pct"] = round((r.get("override_price", 0) - p.get("retail_price", 0)) / max(p.get("retail_price", 1), 1) * 100, 1)
    return {"overrides": rows, "count": len(rows)}


@router.post("/clients/{client_id}/price-book")
async def upsert_price_book(client_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    pid = payload.get("product_id")
    if not pid: raise HTTPException(400, "product_id required")
    override_price = float(payload.get("override_price") or 0)
    reason = (payload.get("reason") or "")[:200]
    doc = {
        "client_id": client_id,
        "product_id": pid,
        "override_price": override_price,
        "reason": reason,
        "updated_at": _now_iso(),
        "updated_by": current_user.get("email"),
    }
    await db.client_price_overrides.update_one(
        {"client_id": client_id, "product_id": pid},
        {"$set": doc},
        upsert=True,
    )
    return {"ok": True}


@router.delete("/clients/{client_id}/price-book/{product_id}")
async def delete_price_override(client_id: str, product_id: str, current_user: dict = Depends(get_current_user)):
    res = await db.client_price_overrides.delete_one({"client_id": client_id, "product_id": product_id})
    if res.deleted_count == 0: raise HTTPException(404, "override not found")
    return {"deleted": True}


@router.get("/clients/{client_id}/price-for/{product_id}")
async def client_price_for_product(client_id: str, product_id: str, current_user: dict = Depends(get_current_user)):
    p = await db.products.find_one({"id": product_id}, {"_id": 0, "retail_price": 1, "name": 1})
    if not p: raise HTTPException(404, "product not found")
    override = await db.client_price_overrides.find_one({"client_id": client_id, "product_id": product_id}, {"_id": 0})
    if override:
        return {"price": override["override_price"], "source": "client_override", "reason": override.get("reason"), "standard": p.get("retail_price")}
    return {"price": p.get("retail_price"), "source": "standard", "standard": p.get("retail_price")}


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 4) SUBSCRIPTION DRIFT DETECTOR â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/subscription-drift")
async def subscription_drift(current_user: dict = Depends(get_current_user)):
    """Find clients paying for more seats than they use (Pax8 / M365)."""
    findings = []
    # Try Pax8 subscriptions vs CIPP users
    subs = await db.pax8_subscriptions.find({}, {"_id": 0}).limit(500).to_list(500)
    for s in subs:
        seats = int(s.get("quantity") or 0)
        if seats <= 0: continue
        pax8_company = s.get("company_id")
        # Look up linked client
        link = await db.pax8_customer_links.find_one({"pax8_company_id": pax8_company}, {"_id": 0, "client_id": 1}) or {}
        client_id = link.get("client_id")
        if not client_id: continue
        # Look up CIPP users for that client
        cipp_link = await db.cipp_tenant_links.find_one({"client_id": client_id}, {"_id": 0, "tenant_id": 1}) or {}
        cached = await db.cipp_users_cache.find_one({"tenant_id": cipp_link.get("tenant_id")}, {"_id": 0}) if cipp_link.get("tenant_id") else None
        active_users = 0
        if cached:
            active_users = sum(1 for u in (cached.get("users") or []) if u.get("account_enabled") is not False)
        if active_users and seats > active_users:
            unused = seats - active_users
            monthly = float(s.get("unit_price", 0)) * unused
            client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1}) or {}
            findings.append({
                "client_id": client_id,
                "client_name": client.get("name"),
                "product_name": s.get("product_name") or s.get("sku"),
                "seats_paid": seats,
                "seats_used": active_users,
                "unused_seats": unused,
                "wasted_monthly_aud": round(monthly, 2),
                "recommendation": "Right-size or upsell" if unused >= 3 else "Monitor",
            })
    findings.sort(key=lambda x: -x["wasted_monthly_aud"])
    total_waste = sum(f["wasted_monthly_aud"] for f in findings)
    return {
        "findings": findings,
        "count": len(findings),
        "total_monthly_waste_aud": round(total_waste, 2),
        "annual_waste_aud": round(total_waste * 12, 2),
    }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 5) CASH FLOW FORECAST â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/finance/cash-flow-forecast")
async def cash_flow_forecast(current_user: dict = Depends(get_current_user)):
    """Project 30/60/90-day inflow from open invoices + recurring + promises."""
    now = datetime.now(timezone.utc)
    buckets = {"30": 0.0, "60": 0.0, "90": 0.0}
    risk_buckets = {"30": 0.0, "60": 0.0, "90": 0.0}

    open_inv = await db.invoices.find(
        {"payment_status": {"$nin": ["paid", "void"]}},
        {"_id": 0, "total": 1, "amount_paid": 1, "due_date": 1, "client_id": 1}
    ).to_list(500)

    for inv in open_inv:
        due = _parse_iso(inv.get("due_date"))
        if not due: continue
        # Normalize to timezone-aware
        if due.tzinfo is None: due = due.replace(tzinfo=timezone.utc)
        balance = float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
        if balance <= 0: continue
        days = (due - now).days
        churn = await db.churn_risk.find_one({"client_id": inv.get("client_id")}, {"_id": 0, "score": 1}) or {}
        risk_pct = min(float(churn.get("score", 20)) / 100, 0.7)
        risk_adjusted = balance * (1 - risk_pct)
        if days <= 30:
            buckets["30"] += balance
            risk_buckets["30"] += risk_adjusted
        elif days <= 60:
            buckets["60"] += balance
            risk_buckets["60"] += risk_adjusted
        elif days <= 90:
            buckets["90"] += balance
            risk_buckets["90"] += risk_adjusted

    # Recurring invoices projected
    recurring = await db.recurring_invoices.find({"status": "active"}, {"_id": 0, "amount": 1, "next_generation": 1, "frequency": 1}).to_list(500)
    for ri in recurring:
        amt = float(ri.get("amount", 0))
        try:
            ng = datetime.strptime(ri.get("next_generation", ""), "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            continue
        # count generations per bucket
        freq_days = {"monthly": 30, "quarterly": 90, "yearly": 365, "weekly": 7}.get(ri.get("frequency", "monthly"), 30)
        for bucket_days in [30, 60, 90]:
            # count how many generations fall in window
            gens = 0
            cursor = ng
            while (cursor - now).days <= bucket_days:
                if (cursor - now).days >= 0:
                    gens += 1
                cursor = cursor + timedelta(days=freq_days)
                if gens > 12: break
            buckets[str(bucket_days)] += amt * (1 if gens else 0)
            risk_buckets[str(bucket_days)] += amt * 0.9 * (1 if gens else 0)

    return {
        "projected": {
            "30d": round(buckets["30"], 2),
            "60d": round(buckets["60"], 2),
            "90d": round(buckets["90"], 2),
        },
        "risk_adjusted": {
            "30d": round(risk_buckets["30"], 2),
            "60d": round(risk_buckets["60"], 2),
            "90d": round(risk_buckets["90"], 2),
        },
        "total_open_invoice_balance": round(sum(
            float(i.get("total", 0)) - float(i.get("amount_paid", 0))
            for i in open_inv
            if (float(i.get("total", 0)) - float(i.get("amount_paid", 0))) > 0
        ), 2),
        "generated_at": _now_iso(),
    }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 6) LATE-PAYMENT PREDICTOR â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async def _score_late_risk(invoice: dict) -> dict:
    """Heuristic 0-100 score â€” probability that invoice is paid late."""
    client_id = invoice.get("client_id")
    score = 30  # baseline
    reasons = []

    # Client history: count of past paid-late invoices
    past = await db.invoices.find(
        {"client_id": client_id, "payment_status": "paid"},
        {"_id": 0, "due_date": 1, "paid_date": 1}
    ).limit(50).to_list(50)
    late_count = 0; on_time = 0
    for p in past:
        due = _parse_iso(p.get("due_date")); paid = _parse_iso(p.get("paid_date"))
        if due and paid:
            if paid > due + timedelta(days=3): late_count += 1
            else: on_time += 1
    if past:
        late_pct = late_count / len(past)
        score += int(late_pct * 50)
        if late_count > 0: reasons.append(f"{late_count} of {len(past)} past invoices paid late")

    # Current overdue balance for the client
    overdue = await db.invoices.find(
        {"client_id": client_id, "payment_status": {"$nin": ["paid", "void"]}},
        {"_id": 0, "total": 1, "amount_paid": 1, "due_date": 1}
    ).to_list(50)
    now = datetime.now(timezone.utc)
    past_due_total = 0.0
    for o in overdue:
        due = _parse_iso(o.get("due_date"))
        if due and due < now:
            past_due_total += float(o.get("total", 0)) - float(o.get("amount_paid", 0))
    if past_due_total > 0:
        score += 15
        reasons.append(f"${past_due_total:,.0f} already overdue")

    # Churn risk contribution
    churn = await db.churn_risk.find_one({"client_id": client_id}, {"_id": 0, "score": 1}) or {}
    if churn.get("score", 0) > 60:
        score += 10
        reasons.append(f"Churn risk {churn['score']}/100")

    # Broken payment promises
    broken = await db.payment_promises.count_documents({"invoice_id": invoice.get("id"), "status": "broken"})
    if broken > 0:
        score += 15
        reasons.append(f"{broken} broken payment promise(s)")

    score = max(0, min(100, score))
    band = "low" if score < 40 else "medium" if score < 70 else "high"
    return {"score": score, "band": band, "reasons": reasons, "on_time_history": on_time, "late_history": late_count}


@router.get("/finance/invoices/late-payment-risk")
async def invoices_late_risk_overview(current_user: dict = Depends(get_current_user)):
    open_inv = await db.invoices.find(
        {"payment_status": {"$nin": ["paid", "void"]}},
        {"_id": 0, "id": 1, "invoice_number": 1, "client_id": 1, "client_name": 1, "total": 1, "due_date": 1, "amount_paid": 1}
    ).limit(200).to_list(200)
    scored = []
    for i in open_inv:
        r = await _score_late_risk(i)
        scored.append({**i, **r})
    scored.sort(key=lambda x: -x["score"])
    summary = {
        "high_risk": sum(1 for x in scored if x["band"] == "high"),
        "medium_risk": sum(1 for x in scored if x["band"] == "medium"),
        "low_risk": sum(1 for x in scored if x["band"] == "low"),
        "total": len(scored),
    }
    return {"invoices": scored[:50], "summary": summary}


@router.get("/invoices/{invoice_id}/late-risk")
async def single_late_risk(invoice_id: str, current_user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv: raise HTTPException(404, "invoice not found")
    return await _score_late_risk(inv)


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 7) MARGIN PER INVOICE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async def _invoice_margin(inv: dict) -> dict:
    line_items = inv.get("line_items") or []
    # Product costs
    total_cost = 0.0
    cost_breakdown = {"products": 0.0, "labor": 0.0, "other": 0.0}
    for li in line_items:
        qty = float(li.get("quantity") or 1)
        line_cost = float(li.get("cost_price") or 0) * qty
        if line_cost > 0:
            total_cost += line_cost
            cost_breakdown["products"] += line_cost
        elif li.get("type") == "labor" or "hour" in (li.get("description") or "").lower():
            # Labor cost estimate â€” 40% of revenue
            lc = float(li.get("total") or 0) * 0.4
            total_cost += lc
            cost_breakdown["labor"] += lc
        else:
            # Default: 30% assumed cost if not specified
            lc = float(li.get("total") or 0) * 0.3
            total_cost += lc
            cost_breakdown["other"] += lc

    revenue = float(inv.get("total", 0))
    profit = revenue - total_cost
    margin_pct = (profit / revenue * 100) if revenue > 0 else 0
    return {
        "revenue": round(revenue, 2),
        "cost": round(total_cost, 2),
        "cost_breakdown": {k: round(v, 2) for k, v in cost_breakdown.items()},
        "profit": round(profit, 2),
        "margin_pct": round(margin_pct, 1),
    }


@router.get("/invoices/{invoice_id}/margin")
async def invoice_margin(invoice_id: str, current_user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv: raise HTTPException(404, "invoice not found")
    return await _invoice_margin(inv)


@router.get("/finance/margin-overview")
async def margin_overview(days: int = 90, current_user: dict = Depends(get_current_user)):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    invs = await db.invoices.find(
        {"issue_date": {"$gte": cutoff}, "status": {"$ne": "void"}},
        {"_id": 0}
    ).limit(1000).to_list(1000)
    total_rev = total_cost = 0.0
    per_client: dict = {}
    for inv in invs:
        m = await _invoice_margin(inv)
        total_rev += m["revenue"]; total_cost += m["cost"]
        cid = inv.get("client_id") or "unknown"
        cb = per_client.setdefault(cid, {"client_id": cid, "client_name": inv.get("client_name"), "revenue": 0, "cost": 0})
        cb["revenue"] += m["revenue"]; cb["cost"] += m["cost"]
    client_list = []
    for cb in per_client.values():
        cb["profit"] = round(cb["revenue"] - cb["cost"], 2)
        cb["margin_pct"] = round(cb["profit"] / cb["revenue"] * 100, 1) if cb["revenue"] > 0 else 0
        cb["revenue"] = round(cb["revenue"], 2); cb["cost"] = round(cb["cost"], 2)
        client_list.append(cb)
    client_list.sort(key=lambda x: -x["revenue"])
    return {
        "window_days": days,
        "total_revenue": round(total_rev, 2),
        "total_cost": round(total_cost, 2),
        "total_profit": round(total_rev - total_cost, 2),
        "margin_pct": round((total_rev - total_cost) / total_rev * 100, 1) if total_rev > 0 else 0,
        "clients": client_list[:50],
    }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 8) PREDICTIVE AUTO-QUOTE TRIGGER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/tickets/{ticket_id}/quote-nudge")
async def quote_nudge(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Assess if this ticket is quote-worthy. Based on conversation length + keyword matches + work already logged."""
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t: raise HTTPException(404, "ticket not found")
    # Signals
    comments = await db.ticket_comments.count_documents({"ticket_id": ticket_id})
    timelog = await db.time_entries.find({"ticket_id": ticket_id}, {"_id": 0, "duration_minutes": 1}).to_list(100)
    mins = sum(int(e.get("duration_minutes") or 0) for e in timelog)
    text = f"{t.get('title','')} {t.get('description','')}"
    keyword_hits = sum(1 for kw in ["install", "migrate", "deploy", "setup", "onboard", "upgrade", "refresh", "replace", "procure", "license", "project"] if kw in text.lower())

    # Score
    score = 0
    signals = []
    if comments >= 6: score += 30; signals.append(f"{comments} comments â€” scope expanding")
    elif comments >= 3: score += 15
    if mins >= 120: score += 30; signals.append(f"{mins}min logged already")
    elif mins >= 60: score += 15
    if keyword_hits >= 3: score += 30; signals.append(f"Keywords: project/deploy/migrate")
    elif keyword_hits >= 1: score += 10

    # Existing quote/estimate?
    existing = await db.estimates.find_one({"ticket_id": ticket_id}, {"_id": 0, "id": 1})
    if existing:
        signals.append("Estimate already exists")
        return {"should_quote": False, "score": score, "existing_estimate_id": existing["id"], "signals": signals}

    should_quote = score >= 50
    return {
        "should_quote": should_quote,
        "score": score,
        "signals": signals,
        "suggestion": (
            f"This ticket has {comments} comments, {mins}min logged and looks project-scoped. "
            f"Consider sending a quote before more time accrues."
        ) if should_quote else None,
    }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 9) PRE-EMPTIVE DISPUTESHIELD SCAN â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/invoices/{invoice_id}/dispute-scan")
async def dispute_scan(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Nexus AI scans invoice line items and client history for dispute risks and drafts justifications."""
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv: raise HTTPException(404, "invoice not found")

    api_key = os.environ.get("OPENAI_API_KEY")
    client_tickets = await db.tickets.find(
        {"client_id": inv.get("client_id"), "status": {"$in": ["resolved", "closed"]}},
        {"_id": 0, "title": 1, "ticket_number": 1, "resolved_at": 1}
    ).sort("resolved_at", -1).limit(10).to_list(10)

    # Heuristic pre-scan
    flags = []
    for li in inv.get("line_items") or []:
        unit = float(li.get("unit_price") or 0)
        qty = float(li.get("quantity") or 1)
        total = float(li.get("total") or (unit * qty))
        desc = (li.get("description") or "").lower()
        if total >= 1500 and len(desc) < 30:
            flags.append({"line": li.get("description"), "risk": "Vague high-value line â€” add detail", "severity": "high"})
        if "emergency" in desc and "after hours" not in desc:
            flags.append({"line": li.get("description"), "risk": "Emergency rate without explicit after-hours note", "severity": "medium"})
        if qty > 5 and unit > 100:
            flags.append({"line": li.get("description"), "risk": f"{qty} Ã— ${unit} â€” ensure quantity is explained", "severity": "low"})

    if not api_key:
        return {"flags": flags, "justification": None, "model": "heuristic-only"}

    try:
        from app.services.ai_provider import LlmChat, UserMessage
        corpus = (
            f"Invoice total: ${inv.get('total',0):,.2f}\n"
            f"Line items:\n" +
            "\n".join([f"- {li.get('description','')} Ã— {li.get('quantity',1)} = ${li.get('total',0):.2f}" for li in inv.get('line_items') or []]) +
            f"\n\nRecent resolved tickets for this client:\n" +
            "\n".join([f"- {t.get('ticket_number')}: {t.get('title','')[:100]}" for t in client_tickets])
        )
        chat = LlmChat(
            api_key=api_key,
            session_id=f"dispute-{uuid.uuid4().hex[:8]}",
            system_message=(
                "You are an MSP invoice-defense assistant. Scan the invoice for lines a client could dispute and draft "
                "a short, professional justification referencing the actual resolved tickets. "
                "Output JSON ONLY: {risks:[{line,reason,severity,justification}], summary:'...'}. "
                "Severity: high|medium|low. Keep justifications under 50 words each."
            ),
        ).with_model("openai", "gpt-5.6-terra")
        resp = await chat.send_message(UserMessage(text=corpus))
        import json as _json, re as _re
        m = _re.search(r"\{[\s\S]*\}", resp or "")
        parsed = _json.loads(m.group(0)) if m else None
        return {
            "flags": flags,
            "ai_risks": (parsed or {}).get("risks", []),
            "ai_summary": (parsed or {}).get("summary"),
            "model": "gpt-5.6-terra",
        }
    except Exception as e:
        return {"flags": flags, "justification": None, "error": str(e)[:200]}
