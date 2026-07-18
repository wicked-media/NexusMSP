"""Client 360° — every single thing about a customer in one call.

Endpoints:
  GET /api/clients/{client_id}/full-profile   — Everything-in-one snapshot
  GET /api/clients/{client_id}/subscriptions  — All SaaS subs (Pax8 + Acronis + others)
  GET /api/clients/{client_id}/security       — CIPP + Huntress + MFA + password hygiene
  GET /api/clients/{client_id}/billing-detail — Inline invoices + payment promises + AR
  GET /api/clients/{client_id}/assets-detail  — Devices + warranty + family tree
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from typing import Optional

from app.database import db
from app.auth import get_current_user

router = APIRouter()


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/clients/{client_id}/full-profile")
async def client_full_profile(client_id: str, current_user: dict = Depends(get_current_user)):
    """Kitchen-sink endpoint — returns everything the detail page needs in one call."""
    c = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not c: raise HTTPException(404, "client not found")

    # Subscriptions (Pax8 + Acronis)
    subs = await _aggregate_subscriptions(client_id)

    # Security (MFA / CIPP hygiene / Huntress agents)
    security = await _aggregate_security(client_id)

    # Billing (AR aging / MRR / recurring)
    billing = await _aggregate_billing(client_id)

    # Assets summary
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0, "id": 1, "name": 1, "status": 1, "device_type": 1, "os": 1}).limit(500).to_list(500)
    assets = {
        "count": len(devices),
        "online": sum(1 for d in devices if d.get("status") == "online"),
        "offline": sum(1 for d in devices if d.get("status") == "offline"),
        "by_type": {},
    }
    for d in devices:
        assets["by_type"].setdefault(d.get("device_type") or "unknown", 0)
        assets["by_type"][d.get("device_type") or "unknown"] += 1

    # Tickets summary (last 30 days + open)
    now = datetime.now(timezone.utc)
    thirty_ago = (now - timedelta(days=30)).isoformat()
    tickets_open = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["open", "in_progress", "on_hold"]}})
    tickets_closed_30d = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["resolved", "closed"]}, "resolved_at": {"$gte": thirty_ago}})

    # Contacts
    contacts = c.get("contacts") or []

    # Integrations map
    integrations = {
        "trmm": bool(await db.devices.find_one({"client_id": client_id, "trmm_agent_id": {"$exists": True, "$ne": ""}}, {"_id": 1})),
        "acronis": bool(await db.acronis_tenant_links.find_one({"client_id": client_id}, {"_id": 1})),
        "pax8": bool(await db.pax8_customer_links.find_one({"client_id": client_id}, {"_id": 1})),
        "cipp": bool(await db.cipp_tenant_links.find_one({"client_id": client_id}, {"_id": 1})),
        "huntress": bool(await db.huntress_client_links.find_one({"client_id": client_id}, {"_id": 1})),
        "unifi": bool(c.get("linked_unifi_site_id")),
        "hudu": bool(c.get("hudu_company_id")),
    }

    # Payment promises + churn risk
    churn = await db.churn_risk.find_one({"client_id": client_id}, {"_id": 0, "score": 1, "factors": 1}) or {}
    dna = await db.client_dna.find_one({"client_id": client_id}, {"_id": 0}) or {}

    # Recent sentiment
    last_sentiment = await db.ticket_sentiment_log.find_one(
        {"client_id": client_id}, {"_id": 0, "sentiment": 1, "score": 1, "ts": 1},
        sort=[("ts", -1)],
    ) or {}

    c.pop("_id", None)
    return {
        "client": c,
        "integrations": integrations,
        "subscriptions": subs,
        "security": security,
        "billing": billing,
        "assets": assets,
        "tickets": {"open": tickets_open, "closed_30d": tickets_closed_30d, "contacts_count": len(contacts)},
        "contacts_preview": contacts[:5],
        "churn": churn,
        "dna": dna,
        "last_sentiment": last_sentiment,
        "generated_at": _iso(),
    }


# ─────────── SUBSCRIPTIONS ───────────

async def _aggregate_subscriptions(client_id: str) -> dict:
    subs = []
    total_monthly = 0.0
    seats_total = 0

    # Pax8
    link = await db.pax8_customer_links.find_one({"client_id": client_id}, {"_id": 0})
    if link:
        pax8_subs = await db.pax8_subscriptions.find(
            {"company_id": link.get("pax8_company_id")},
            {"_id": 0}
        ).limit(100).to_list(100)
        for s in pax8_subs:
            qty = int(s.get("quantity") or 0)
            unit = float(s.get("unit_price") or 0)
            monthly = qty * unit
            total_monthly += monthly
            seats_total += qty
            subs.append({
                "source": "pax8",
                "source_label": "Pax8 CSP",
                "product": s.get("product_name") or s.get("sku"),
                "sku": s.get("sku"),
                "quantity": qty,
                "unit_price": unit,
                "monthly_cost": round(monthly, 2),
                "billing_cycle": s.get("billing_cycle", "monthly"),
                "status": s.get("status", "active"),
            })

    # Acronis — tenant quotas/usage
    acronis = await db.acronis_tenant_links.find_one({"client_id": client_id}, {"_id": 0})
    if acronis:
        usage = await db.acronis_usage.find_one({"tenant_id": acronis.get("tenant_id")}, {"_id": 0}) or {}
        if usage:
            subs.append({
                "source": "acronis",
                "source_label": "Acronis Cyber Cloud",
                "product": "Cloud Backup Storage",
                "quantity": usage.get("machines", 0),
                "unit_price": None,
                "monthly_cost": round(float(usage.get("monthly_cost", 0)), 2),
                "storage_gb": usage.get("used_gb"),
                "status": "active",
            })
            total_monthly += float(usage.get("monthly_cost", 0))

    # Recurring invoices (NexusOps-native contracted services)
    recurring = await db.recurring_invoices.find(
        {"client_id": client_id, "status": "active"},
        {"_id": 0, "description": 1, "amount": 1, "frequency": 1}
    ).to_list(50)
    for ri in recurring:
        freq = ri.get("frequency", "monthly")
        amt = float(ri.get("amount", 0))
        monthly = amt if freq == "monthly" else amt / 3 if freq == "quarterly" else amt / 12 if freq == "yearly" else amt
        total_monthly += monthly
        subs.append({
            "source": "msp_contract",
            "source_label": "MSP Contract",
            "product": ri.get("description") or "Managed Services",
            "quantity": 1,
            "unit_price": amt,
            "monthly_cost": round(monthly, 2),
            "billing_cycle": freq,
            "status": "active",
        })

    return {
        "items": subs,
        "count": len(subs),
        "total_monthly_aud": round(total_monthly, 2),
        "total_seats": seats_total,
    }


@router.get("/clients/{client_id}/subscriptions")
async def client_subscriptions(client_id: str, current_user: dict = Depends(get_current_user)):
    return await _aggregate_subscriptions(client_id)


# ─────────── SECURITY ───────────

async def _aggregate_security(client_id: str) -> dict:
    out = {"mfa_pct": None, "weak_passwords": 0, "breached": 0, "cipp_hygiene": None,
           "huntress_agents": 0, "huntress_critical": 0, "stale_users": 0}

    devices = await db.devices.find({"client_id": client_id}, {"_id": 0}).to_list(500)
    assessed = [device for device in devices if device.get("security_assessed_at")]
    encrypted = lambda device: any(marker in str(device.get("encryption_status") or "").lower() for marker in ("encrypted", "bitlocker on", "protection on"))
    out.update({
        "managed_endpoints": len(devices), "assessed_endpoints": len(assessed),
        "defender_active": sum(1 for device in assessed if device.get("antivirus_status") == "active" and device.get("defender_real_time_enabled")),
        "firewall_enabled": sum(1 for device in assessed if device.get("firewall_enabled")),
        "encrypted_endpoints": sum(1 for device in assessed if encrypted(device)),
        "pending_updates": sum(int(device.get("pending_patches") or 0) for device in assessed),
    })

    # CIPP hygiene
    cipp = await db.cipp_tenant_links.find_one({"client_id": client_id}, {"_id": 0, "tenant_id": 1})
    if cipp:
        users_cache = await db.cipp_users_cache.find_one({"tenant_id": cipp.get("tenant_id")}, {"_id": 0})
        if users_cache:
            users = users_cache.get("users") or []
            enabled = [u for u in users if u.get("account_enabled") is not False]
            if enabled:
                mfa_on = sum(1 for u in enabled if u.get("mfa_enabled"))
                out["mfa_pct"] = round(mfa_on / len(enabled) * 100)
                out["user_count"] = len(enabled)
            out["stale_users"] = sum(1 for u in users if u.get("stale"))

        hygiene = await db.cipp_hygiene_scores.find_one({"tenant_id": cipp.get("tenant_id")}, {"_id": 0, "overall_score": 1, "dimensions": 1}) or {}
        out["cipp_hygiene"] = hygiene.get("overall_score")
        out["cipp_dimensions"] = hygiene.get("dimensions")

    # Huntress
    hlink = await db.huntress_client_links.find_one({"client_id": client_id}, {"_id": 0, "org_id": 1})
    if hlink:
        out["huntress_agents"] = await db.huntress_agents_cache.count_documents({"org_id": hlink.get("org_id")})
        out["huntress_critical"] = await db.huntress_incidents_cache.count_documents({
            "org_id": hlink.get("org_id"),
            "severity": "critical",
            "status": {"$in": ["open", "investigating"]},
        })

    return out


@router.get("/clients/{client_id}/security")
async def client_security(client_id: str, current_user: dict = Depends(get_current_user)):
    return await _aggregate_security(client_id)


# ─────────── BILLING ───────────

async def _aggregate_billing(client_id: str) -> dict:
    invs = await db.invoices.find(
        {"client_id": client_id},
        {"_id": 0, "id": 1, "invoice_number": 1, "total": 1, "amount_paid": 1,
         "due_date": 1, "issue_date": 1, "payment_status": 1, "status": 1}
    ).sort("issue_date", -1).limit(100).to_list(100)

    now = datetime.now(timezone.utc)
    open_balance = 0.0; overdue_balance = 0.0
    aging = {"current": 0, "30": 0, "60": 0, "90+": 0}
    for i in invs:
        if i.get("payment_status") in ("paid", "void"): continue
        bal = float(i.get("total", 0)) - float(i.get("amount_paid", 0))
        if bal <= 0: continue
        open_balance += bal
        try:
            due = datetime.fromisoformat((i.get("due_date") or "").replace("Z", "+00:00"))
            if due.tzinfo is None: due = due.replace(tzinfo=timezone.utc)
            days = (now - due).days
            if days < 0: aging["current"] += bal
            elif days <= 30: aging["30"] += bal
            elif days <= 60: aging["60"] += bal
            else:
                aging["90+"] += bal; overdue_balance += bal
        except Exception:
            aging["current"] += bal

    # MRR projection from recurring
    recurring = await db.recurring_invoices.find({"client_id": client_id, "status": "active"}, {"_id": 0, "amount": 1, "frequency": 1}).to_list(50)
    mrr = 0.0
    for ri in recurring:
        amt = float(ri.get("amount", 0))
        freq = ri.get("frequency", "monthly")
        mrr += amt if freq == "monthly" else amt / 3 if freq == "quarterly" else amt / 12 if freq == "yearly" else amt

    # LTV (sum of all paid invoices)
    ltv = 0.0
    all_paid = await db.invoices.find({"client_id": client_id, "payment_status": "paid"}, {"_id": 0, "total": 1}).limit(1000).to_list(1000)
    ltv = sum(float(i.get("total", 0)) for i in all_paid)

    # Payment promises
    promises_kept = await db.payment_promises.count_documents({"client_id": client_id, "status": "kept"})
    promises_broken = await db.payment_promises.count_documents({"client_id": client_id, "status": "broken"})

    return {
        "open_balance": round(open_balance, 2),
        "overdue_balance": round(overdue_balance, 2),
        "aging": {k: round(v, 2) for k, v in aging.items()},
        "mrr_aud": round(mrr, 2),
        "ltv_aud": round(ltv, 2),
        "recent_invoices": invs[:10],
        "recurring_count": len(recurring),
        "payment_promises": {"kept": promises_kept, "broken": promises_broken},
    }


@router.get("/clients/{client_id}/billing-detail")
async def client_billing_detail(client_id: str, current_user: dict = Depends(get_current_user)):
    return await _aggregate_billing(client_id)


@router.get("/clients/{client_id}/assets-detail")
async def client_assets_detail(client_id: str, current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0}).limit(500).to_list(500)
    # Group by model for family-tree feel
    by_model: dict = {}
    now = datetime.now(timezone.utc)
    for d in devices:
        key = d.get("model") or "Unknown"
        by_model.setdefault(key, []).append(d)
    groups = []
    for k, v in by_model.items():
        ages = []
        for d in v:
            try:
                purchase = datetime.fromisoformat((d.get("purchase_date") or "").replace("Z", "+00:00"))
                if purchase.tzinfo is None: purchase = purchase.replace(tzinfo=timezone.utc)
                ages.append((now - purchase).days / 365.25)
            except Exception: pass
        groups.append({
            "model": k,
            "count": len(v),
            "online": sum(1 for d in v if d.get("status") == "online"),
            "offline": sum(1 for d in v if d.get("status") == "offline"),
            "avg_age_years": round(sum(ages) / len(ages), 1) if ages else None,
            "devices_preview": [{"id": d.get("id"), "name": d.get("name"), "status": d.get("status"), "os": d.get("os"), "ip_address": d.get("ip_address"), "assessed": bool(d.get("security_assessed_at")), "pending_patches": int(d.get("pending_patches") or 0)} for d in v[:10]],
        })
    groups.sort(key=lambda x: -x["count"])
    assessed = [device for device in devices if device.get("security_assessed_at")]
    return {"groups": groups, "total": len(devices), "online": sum(g["online"] for g in groups), "offline": sum(g["offline"] for g in groups), "assessed": len(assessed), "pending_updates": sum(int(device.get("pending_patches") or 0) for device in assessed)}
