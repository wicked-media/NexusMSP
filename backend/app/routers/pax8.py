"""Pax8 integration — Microsoft / CSP subscription sync and MSP billing.
Mirrors the Acronis pattern: credential storage, OAuth2 client_credentials auth,
company (tenant) sync, subscription usage, per-client billing preview, and
link-to-recurring-invoice workflow.
"""
import uuid
import logging
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Body
from app.database import db
from app.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Pax8"])

PAX8_TOKEN_URL = "https://api.pax8.com/v1/token"
PAX8_BASE = "https://api.pax8.com/v1"
PAX8_AUDIENCE = "https://api.pax8.com"


# ============== TOKEN CACHE (in-memory) ==============
_token_cache = {"token": None, "expires_at": None}


def _mask(s: str) -> str:
    if not s:
        return ""
    if len(s) <= 6:
        return "***"
    return s[:3] + "..." + s[-3:]


async def _get_config() -> dict:
    doc = await db.settings.find_one({"key": "pax8_config"}, {"_id": 0}) or {}
    return doc.get("value", {}) or {}


async def _get_token() -> str:
    """OAuth2 client_credentials — cache until expiry."""
    cfg = await _get_config()
    cid = cfg.get("client_id")
    csec = cfg.get("client_secret")
    if not (cid and csec):
        raise HTTPException(status_code=400, detail="Pax8 not configured. Set client_id/client_secret in Settings → Integrations → Pax8.")

    # Reuse cached token
    if _token_cache["token"] and _token_cache["expires_at"] and datetime.now(timezone.utc) < _token_cache["expires_at"]:
        return _token_cache["token"]

    async with httpx.AsyncClient(timeout=20.0) as c:
        resp = await c.post(
            PAX8_TOKEN_URL,
            headers={"Content-Type": "application/json"},
            json={
                "client_id": cid,
                "client_secret": csec,
                "audience": PAX8_AUDIENCE,
                "grant_type": "client_credentials",
            },
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail=f"Pax8 auth failed: {resp.text[:300]}")
    body = resp.json()
    _token_cache["token"] = body.get("access_token")
    _token_cache["expires_at"] = datetime.now(timezone.utc) + timedelta(seconds=body.get("expires_in", 3600) - 300)
    return _token_cache["token"]


async def _api_get(path: str, params: dict = None):
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30.0) as c:
        resp = await c.get(f"{PAX8_BASE}{path}", headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}, params=params or {})
    if resp.status_code == 401:
        # force refresh and retry
        _token_cache["token"] = None
        token = await _get_token()
        async with httpx.AsyncClient(timeout=30.0) as c:
            resp = await c.get(f"{PAX8_BASE}{path}", headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}, params=params or {})
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=f"Pax8 API {path} failed: {resp.text[:300]}")
    return resp.json()


# ============== SETTINGS ENDPOINTS ==============
@router.get("/settings/pax8")
async def get_pax8_settings(current_user: dict = Depends(get_current_user)):
    cfg = await _get_config()
    doc = await db.settings.find_one({"key": "pax8_config"}, {"_id": 0}) or {}
    return {
        "client_id": cfg.get("client_id", ""),
        "client_secret": _mask(cfg.get("client_secret", "")),
        "client_secret_set": bool(cfg.get("client_secret")),
        "enabled": bool(cfg.get("enabled", bool(cfg.get("client_id") and cfg.get("client_secret")))),
        "last_test_result": cfg.get("last_test_result"),
        "last_test_at": cfg.get("last_test_at"),
        "last_test_message": cfg.get("last_test_message"),
        "last_sync_at": cfg.get("last_sync_at"),
        "last_sync_stats": cfg.get("last_sync_stats"),
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
    }


@router.put("/settings/pax8")
async def update_pax8_settings(data: dict, current_user: dict = Depends(get_current_user)):
    existing = await _get_config()
    new_value = {**existing}

    if "client_id" in data:
        new_value["client_id"] = (data.get("client_id") or "").strip()

    secret = (data.get("client_secret") or "").strip()
    if secret == "clear":
        new_value.pop("client_secret", None)
    elif secret and "..." not in secret[:8]:
        new_value["client_secret"] = secret

    if "enabled" in data:
        new_value["enabled"] = bool(data["enabled"])

    await db.settings.update_one(
        {"key": "pax8_config"},
        {"$set": {
            "key": "pax8_config",
            "value": new_value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": current_user.get("name", ""),
        }},
        upsert=True,
    )
    # Invalidate token cache when creds change
    _token_cache["token"] = None
    return {"message": "Pax8 settings saved"}


@router.post("/pax8/test")
async def test_pax8(current_user: dict = Depends(get_current_user)):
    """Test Pax8 OAuth token + list one company to confirm everything works."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        _token_cache["token"] = None  # force fresh token on test
        await _get_token()
        probe = await _api_get("/companies", {"page": 0, "size": 1})
        total = (probe.get("page") or {}).get("totalElements", 0)
        detail = f"Authenticated successfully. {total} companies accessible."
        status = "success"
    except HTTPException as e:
        status, detail = "failed", str(e.detail)
    except Exception as e:
        status, detail = "failed", str(e)

    await db.settings.update_one(
        {"key": "pax8_config"},
        {"$set": {
            "value.last_test_result": status,
            "value.last_test_at": now,
            "value.last_test_message": detail,
        }},
        upsert=True,
    )
    return {"status": status, "detail": detail}


# ============== COMPANIES (Pax8 "customers") ==============
@router.get("/pax8/companies")
async def list_pax8_companies(refresh: bool = False, current_user: dict = Depends(get_current_user)):
    """Return cached Pax8 companies merged with local link status. Pass refresh=true to re-fetch live."""
    if refresh:
        await _sync_companies()

    companies = await db.pax8_companies.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    if not companies:
        await _sync_companies()
        companies = await db.pax8_companies.find({}, {"_id": 0}).sort("name", 1).to_list(1000)

    # Attach link info
    links = {l["pax8_company_id"]: l async for l in db.pax8_company_links.find({}, {"_id": 0})}
    for c in companies:
        link = links.get(c.get("id") or c.get("pax8_company_id"))
        if link:
            c["linked_client_id"] = link.get("client_id")
            c["linked_client_name"] = link.get("client_name")
            c["auto_bill_recurring"] = bool(link.get("auto_bill_recurring"))
    return companies


async def _sync_companies():
    """Pull all companies from Pax8 into local mirror collection."""
    page = 0
    total_pages = 1
    now = datetime.now(timezone.utc).isoformat()
    count = 0
    while page < total_pages:
        data = await _api_get("/companies", {"page": page, "size": 200})
        for c in (data.get("content") or []):
            await db.pax8_companies.update_one(
                {"id": c["id"]},
                {"$set": {
                    "id": c["id"],
                    "pax8_company_id": c["id"],
                    "name": c.get("name", ""),
                    "website": c.get("website", ""),
                    "phone": c.get("phone", ""),
                    "status": c.get("status", ""),
                    "country": (c.get("address") or {}).get("country", ""),
                    "city": (c.get("address") or {}).get("city", ""),
                    "last_synced": now,
                }},
                upsert=True,
            )
            count += 1
        page_info = data.get("page") or {}
        total_pages = page_info.get("totalPages", 1)
        page += 1
    return count


@router.post("/pax8/sync")
async def sync_pax8(current_user: dict = Depends(get_current_user)):
    """Full sync: companies + subscriptions + cached product catalog."""
    now = datetime.now(timezone.utc).isoformat()
    stats = {"companies": 0, "subscriptions": 0, "products_cached": 0, "errors": []}
    try:
        stats["companies"] = await _sync_companies()
    except Exception as e:
        stats["errors"].append(f"companies: {e}")

    # Sync subscriptions (single call — Pax8 returns all subs for the partner)
    try:
        page = 0
        total_pages = 1
        seen_products = set()
        while page < total_pages:
            data = await _api_get("/subscriptions", {"page": page, "size": 200})
            for s in (data.get("content") or []):
                await db.pax8_subscriptions.update_one(
                    {"id": s["id"]},
                    {"$set": {
                        **s,
                        "last_synced": now,
                    }},
                    upsert=True,
                )
                stats["subscriptions"] += 1
                pid = s.get("productId")
                if pid:
                    seen_products.add(pid)
            page_info = data.get("page") or {}
            total_pages = page_info.get("totalPages", 1)
            page += 1

        # Cache product details for SKU names (only the ones we actually have subs for)
        for pid in list(seen_products):
            existing = await db.pax8_products.find_one({"id": pid}, {"_id": 0})
            if existing:
                continue
            try:
                p = await _api_get(f"/products/{pid}")
                await db.pax8_products.update_one(
                    {"id": p["id"]},
                    {"$set": {
                        "id": p["id"],
                        "name": p.get("name", ""),
                        "vendorName": p.get("vendorName", ""),
                        "shortDescription": p.get("shortDescription", ""),
                        "billingTerm": p.get("billingTerm", ""),
                        "last_synced": now,
                    }},
                    upsert=True,
                )
                stats["products_cached"] += 1
            except Exception as e:
                stats["errors"].append(f"product {pid}: {str(e)[:80]}")
    except Exception as e:
        stats["errors"].append(f"subscriptions: {e}")

    await db.settings.update_one(
        {"key": "pax8_config"},
        {"$set": {
            "value.last_sync_at": now,
            "value.last_sync_stats": stats,
        }},
        upsert=True,
    )
    stats["synced_at"] = now
    return stats


@router.post("/pax8/companies/{pax8_company_id}/link")
async def link_pax8_company(pax8_company_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Link a Pax8 company to a NexusOps client."""
    client_id = data.get("client_id")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    company = await db.pax8_companies.find_one({"id": pax8_company_id}, {"_id": 0, "name": 1})
    if not company:
        raise HTTPException(status_code=404, detail="Pax8 company not found — run Sync first")

    await db.pax8_company_links.update_one(
        {"pax8_company_id": pax8_company_id},
        {"$set": {
            "pax8_company_id": pax8_company_id,
            "pax8_company_name": company.get("name", ""),
            "client_id": client_id,
            "client_name": client.get("name", ""),
            "linked_at": datetime.now(timezone.utc).isoformat(),
            "linked_by": current_user.get("name", ""),
        }},
        upsert=True,
    )
    return {"message": f"Linked {company.get('name','')} → {client.get('name','')}"}


@router.delete("/pax8/companies/{pax8_company_id}/link")
async def unlink_pax8_company(pax8_company_id: str, current_user: dict = Depends(get_current_user)):
    res = await db.pax8_company_links.delete_one({"pax8_company_id": pax8_company_id})
    return {"deleted": res.deleted_count}


# ============== SUBSCRIPTIONS / BILLING ==============
async def _build_client_line_items(pax8_company_id: str, target_currency: str = "AUD"):
    """Return (line_items, total) for a Pax8 company based on local subscription cache."""
    subs = await db.pax8_subscriptions.find(
        {"companyId": pax8_company_id, "status": "Active"},
        {"_id": 0}
    ).to_list(500)

    products_map = {}
    for p in await db.pax8_products.find({}, {"_id": 0, "id": 1, "name": 1, "vendorName": 1}).to_list(2000):
        products_map[p["id"]] = p

    # Aggregate by product + billingTerm so Monthly vs Annual don't mix
    agg = {}
    for s in subs:
        pid = s.get("productId")
        key = (pid, s.get("billingTerm", "Monthly"))
        qty = float(s.get("quantity") or 0)
        price = float(s.get("price") or 0)
        if qty <= 0 or price <= 0:
            continue
        entry = agg.setdefault(key, {
            "product_id": pid,
            "label": (products_map.get(pid) or {}).get("name", "Unknown product"),
            "vendor": (products_map.get(pid) or {}).get("vendorName", ""),
            "quantity": 0,
            "unit_price": price,
            "billing_term": s.get("billingTerm", "Monthly"),
            "currency": s.get("currencyCode", target_currency),
        })
        entry["quantity"] += qty

    line_items = []
    total = 0.0
    for (_, _), e in agg.items():
        lt = round(e["quantity"] * e["unit_price"], 2)
        line_items.append({
            "product_id": e["product_id"],
            "label": e["label"],
            "vendor": e["vendor"],
            "quantity": round(e["quantity"], 2),
            "unit": "seat",
            "unit_price": round(e["unit_price"], 4),
            "billing_term": e["billing_term"],
            "currency": e["currency"],
            "total": lt,
        })
        total += lt
    line_items.sort(key=lambda x: -x["total"])
    return line_items, round(total, 2)


@router.get("/pax8/billing/preview")
async def pax8_billing_preview(current_user: dict = Depends(get_current_user)):
    """Per-NexusOps-client Pax8 MRR preview with recurring-invoice link status."""
    links = await db.pax8_company_links.find({}, {"_id": 0}).to_list(500)
    results = []
    for link in links:
        line_items, total = await _build_client_line_items(link["pax8_company_id"])
        if not line_items and total == 0:
            # Still include so user can see linked-but-no-active-subs
            pass

        # Pull active RIs + auto-bill status
        active_ris = await db.recurring_invoices.find(
            {"client_id": link["client_id"], "status": "active"},
            {"_id": 0, "id": 1, "description": 1, "amount": 1, "frequency": 1, "include_pax8_usage": 1}
        ).to_list(20)
        auto_bill = any(r.get("include_pax8_usage") for r in active_ris)

        results.append({
            "client_id": link["client_id"],
            "client_name": link["client_name"],
            "pax8_company_id": link["pax8_company_id"],
            "pax8_company_name": link["pax8_company_name"],
            "line_items": line_items,
            "total": total,
            "currency": (line_items[0]["currency"] if line_items else "AUD"),
            "active_recurring_invoices": active_ris,
            "auto_bill_recurring": auto_bill,
        })
    results.sort(key=lambda r: -r["total"])
    return {
        "period": datetime.now(timezone.utc).strftime("%Y-%m"),
        "linked_clients": len(results),
        "grand_total": round(sum(r["total"] for r in results), 2),
        "results": results,
    }


@router.get("/pax8/billing/client/{client_id}")
async def pax8_billing_client(client_id: str, current_user: dict = Depends(get_current_user)):
    """Single-client Pax8 billing view (used by generate-now auto-attach)."""
    link = await db.pax8_company_links.find_one({"client_id": client_id}, {"_id": 0})
    if not link:
        return {"linked": False, "message": "No Pax8 company linked to this client"}
    line_items, total = await _build_client_line_items(link["pax8_company_id"])
    return {
        "linked": True,
        "pax8_company_id": link["pax8_company_id"],
        "pax8_company_name": link["pax8_company_name"],
        "period": datetime.now(timezone.utc).strftime("%Y-%m"),
        "currency": (line_items[0]["currency"] if line_items else "AUD"),
        "total": total,
        "line_items": line_items,
    }


@router.post("/pax8/billing/client/{client_id}/link-to-recurring")
async def link_client_pax8_to_recurring(client_id: str, data: dict = Body(default=None), current_user: dict = Depends(get_current_user)):
    """Mirror of the Acronis link-to-recurring endpoint — enables `include_pax8_usage=True`."""
    data = data or {}
    link = await db.pax8_company_links.find_one({"client_id": client_id}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=400, detail="Client is not linked to a Pax8 company. Link first on Pax8 Command Center → Companies tab.")

    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    now = datetime.now(timezone.utc).isoformat()
    target_id = data.get("recurring_invoice_id")
    modified, created_id = [], None

    if target_id:
        ri = await db.recurring_invoices.find_one({"id": target_id, "client_id": client_id}, {"_id": 0, "id": 1})
        if not ri:
            raise HTTPException(status_code=404, detail="Recurring invoice not found for this client")
        await db.recurring_invoices.update_one(
            {"id": target_id},
            {"$set": {"include_pax8_usage": True, "updated_at": now}}
        )
        modified.append(target_id)
    else:
        active = await db.recurring_invoices.find(
            {"client_id": client_id, "status": "active"}, {"_id": 0, "id": 1}
        ).to_list(50)
        for r in active:
            await db.recurring_invoices.update_one(
                {"id": r["id"]},
                {"$set": {"include_pax8_usage": True, "updated_at": now}}
            )
            modified.append(r["id"])

        if not modified and data.get("create_if_missing"):
            new_id = f"ri-{uuid.uuid4().hex[:8]}"
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            scaffold = {
                "id": new_id,
                "client_id": client_id,
                "client_name": client.get("name", ""),
                "description": data.get("description", f"Microsoft / Pax8 Subscriptions — {client.get('name','')}"),
                "line_items": [],
                "subtotal": 0.0,
                "tax_rate": float(data.get("tax_rate", 10)),
                "tax_amount": 0.0,
                "amount": 0.0,
                "currency": data.get("currency", "AUD"),
                "frequency": data.get("frequency", "monthly"),
                "start_date": today,
                "next_generation": today,
                "end_date": None,
                "contract_id": None,
                "payment_terms": data.get("payment_terms", "net_30"),
                "notes": "Auto-created to attach monthly Pax8 subscription usage.",
                "auto_send": False,
                "auto_send_email": "",
                "include_pdf": True,
                "include_acronis_usage": False,
                "include_pax8_usage": True,
                "status": "active",
                "invoices_generated": 0,
                "total_billed": 0,
                "last_generated": None,
                "generation_history": [],
                "created_by": current_user.get("name", ""),
                "created_at": now,
                "updated_at": now,
            }
            await db.recurring_invoices.insert_one(scaffold)
            created_id = new_id
            modified.append(new_id)

    await db.pax8_company_links.update_one(
        {"client_id": client_id},
        {"$set": {
            "auto_bill_recurring": True,
            "auto_bill_ri_ids": modified,
            "auto_bill_linked_at": now,
            "auto_bill_linked_by": current_user.get("name", ""),
        }},
    )

    return {
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "updated_recurring_invoices": modified,
        "created_recurring_invoice_id": created_id,
        "count": len(modified),
        "message": (
            f"Created new recurring invoice {created_id} with Pax8 auto-billing" if created_id
            else f"Enabled Pax8 auto-billing on {len(modified)} recurring invoice(s)" if modified
            else "No active recurring invoices — pass create_if_missing=true to scaffold one"
        ),
    }


@router.post("/pax8/billing/client/{client_id}/unlink-recurring")
async def unlink_client_pax8_recurring(client_id: str, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    res = await db.recurring_invoices.update_many(
        {"client_id": client_id, "include_pax8_usage": True},
        {"$set": {"include_pax8_usage": False, "updated_at": now}},
    )
    await db.pax8_company_links.update_one(
        {"client_id": client_id},
        {"$set": {"auto_bill_recurring": False, "auto_bill_unlinked_at": now}},
    )
    return {"client_id": client_id, "disabled_on": res.modified_count}


@router.get("/pax8/subscriptions")
async def list_pax8_subscriptions(company_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    q = {"companyId": company_id} if company_id else {}
    subs = await db.pax8_subscriptions.find(q, {"_id": 0}).sort("createdDate", -1).to_list(2000)
    # Enrich with product names
    if subs:
        pids = list({s.get("productId") for s in subs if s.get("productId")})
        products = {p["id"]: p async for p in db.pax8_products.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "name": 1, "vendorName": 1})}
        for s in subs:
            p = products.get(s.get("productId"))
            if p:
                s["product_name"] = p.get("name", "")
                s["vendor_name"] = p.get("vendorName", "")
    return subs
