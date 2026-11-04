"""Nexus metering + transaction ledger: the financial plumbing primitive.

Two append-only stores that future marketplace, clearing-house and FinOps
economics all read from:

- **usage meter events** — what was consumed (metres like ``endpoints.managed``,
  ``mailboxes.protected``, ``storage.gb``) with dimensions, ready for rating;
- **ledger entries** — double-entry (every transfer is a debit *and* a credit),
  hash-chained per tenant so tampering is detectable, idempotent on a caller
  supplied key.

Rules that keep this honest:

- amounts and rates are never invented — revenue-share previews require the
  caller to supply the rate (or an agreement record to supply it);
- the ledger is append-only: corrections are new entry pairs (reversals),
  never updates;
- every write is tenant-scoped and carries the stable Nexus IDs it relates to.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

DIRECTIONS = ("debit", "credit")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _amount(value: Any) -> float | None:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    return round(amount, 2) if amount >= 0 else None


def _public(document: dict) -> dict:
    """Strip the Mongo ``_id`` (insert_one mutates documents in place) before any response."""
    return {key: value for key, value in document.items() if key != "_id"}


def _entry_hash(previous_hash: str, entry: dict) -> str:
    material = "|".join([
        previous_hash,
        str(entry.get("entry_id") or ""),
        str(entry.get("account") or ""),
        str(entry.get("direction") or ""),
        f"{entry.get('amount'):.2f}",
        str(entry.get("currency") or "USD"),
        str(entry.get("memo") or ""),
        str(entry.get("recorded_at") or ""),
    ])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


# ============== USAGE METERING ==============


async def record_usage(db: Any, user: dict, actor_name: str, payload: dict) -> dict:
    """Record one usage meter event. Idempotent on (tenant, idempotency_key)."""
    meter = str(payload.get("meter") or "").strip()
    if not meter:
        return {"found": False, "error": "meter is required"}
    quantity = _amount(payload.get("quantity"))
    if quantity is None:
        return {"found": False, "error": "quantity must be a non-negative number"}
    idempotency_key = str(payload.get("idempotency_key") or "").strip()
    tenant_id = platform_tenant_id(user)
    if idempotency_key:
        existing = await db.usage_meter_events.find_one(
            tenant_scoped_query(user, {"idempotency_key": idempotency_key}), {"_id": 0})
        if existing:
            return {"found": True, "usage_event": _public(existing), "idempotent_replay": True}

    document = {
        "id": f"USG-{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant_id,
        "meter": meter,
        "quantity": quantity,
        "unit": str(payload.get("unit") or "").strip()[:40],
        "dimensions": {
            str(key): str(value)[:80]
            for key, value in (payload.get("dimensions") or {}).items()
            if str(key).strip()
        },
        "client_id": str(payload.get("client_id") or "").strip() or None,
        "source": str(payload.get("source") or "nexus")[:40],
        "idempotency_key": idempotency_key or None,
        "recorded_by": str(actor_name or "").strip()[:120] or "unknown",
        "recorded_at": _iso(_utcnow()),
    }
    await db.usage_meter_events.insert_one(document)
    return {"found": True, "usage_event": _public(document)}


async def usage_summary(db: Any, user: dict, meter: str | None = None) -> dict:
    query: dict = {"meter": meter} if meter else {}
    rows = await db.usage_meter_events.find(tenant_scoped_query(user, query), {"_id": 0}).to_list(5000)
    totals: dict[str, dict] = {}
    for row in rows:
        bucket = totals.setdefault(str(row.get("meter")), {"quantity": 0.0, "events": 0, "unit": row.get("unit")})
        bucket["quantity"] = round(bucket["quantity"] + float(row.get("quantity") or 0), 2)
        bucket["events"] += 1
    return {"meters": totals, "events": len(rows), "generated_at": _iso(_utcnow())}


# ============== DOUBLE-ENTRY TRANSACTION LEDGER ==============


async def _last_hash(db: Any, user: dict) -> str:
    rows = await db.ledger_entries.find(
        tenant_scoped_query(user, {}), {"_id": 0}).sort("sequence", -1).limit(1).to_list(1)
    return str(rows[0].get("entry_hash") or "") if rows else ""


async def _next_sequence(db: Any, user: dict) -> int:
    return await db.ledger_entries.count_documents(tenant_scoped_query(user, {})) + 1


async def post_entries(db: Any, user: dict, actor_name: str, payload: dict) -> dict:
    """Post a balanced double-entry transaction. Append-only; corrections are reversals."""
    raw_entries = payload.get("entries") or []
    if not isinstance(raw_entries, list) or not raw_entries:
        return {"found": False, "error": "entries must be a non-empty list"}
    idempotency_key = str(payload.get("idempotency_key") or "").strip()
    if idempotency_key:
        existing = await db.ledger_entries.find_one(
            tenant_scoped_query(user, {"idempotency_key": idempotency_key}), {"_id": 0})
        if existing:
            siblings = await db.ledger_entries.find(
                tenant_scoped_query(user, {"idempotency_key": idempotency_key}), {"_id": 0}).to_list(50)
            return {"found": True, "entries": [_public(row) for row in siblings], "idempotent_replay": True}

    parsed: list[dict] = []
    for item in raw_entries:
        if not isinstance(item, dict):
            return {"found": False, "error": "each entry must be an object"}
        account = str(item.get("account") or "").strip()
        direction = str(item.get("direction") or "").strip().lower()
        amount = _amount(item.get("amount"))
        if not account or direction not in DIRECTIONS or not amount:
            return {"found": False, "error": "each entry needs account, direction (debit|credit) and amount >= 0"}
        parsed.append({
            "account": account,
            "direction": direction,
            "amount": amount,
            "currency": str(item.get("currency") or payload.get("currency") or "USD")[:8],
            "memo": str(item.get("memo") or payload.get("memo") or "").strip()[:200],
        })
    debits = sum(e["amount"] for e in parsed if e["direction"] == "debit")
    credits = sum(e["amount"] for e in parsed if e["direction"] == "credit")
    if round(debits, 2) != round(credits, 2):
        return {"found": False,
                "error": f"transaction not balanced: debits {debits:.2f} != credits {credits:.2f}"}

    now = _iso(_utcnow())
    tenant_id = platform_tenant_id(user)
    previous_hash = await _last_hash(db, user)
    sequence = await _next_sequence(db, user)
    stored: list[dict] = []
    for entry in parsed:
        document = {
            "entry_id": f"LED-{uuid.uuid4().hex[:10]}",
            "tenant_id": tenant_id,
            "sequence": sequence,
            **entry,
            "client_id": str(payload.get("client_id") or "").strip() or None,
            "transaction_ref": str(payload.get("transaction_ref") or "").strip()[:80] or None,
            "idempotency_key": idempotency_key or None,
            "posted_by": str(actor_name or "").strip()[:120] or "unknown",
            "recorded_at": now,
            "previous_hash": previous_hash,
        }
        document["entry_hash"] = _entry_hash(previous_hash, document)
        previous_hash = document["entry_hash"]
        sequence += 1
        await db.ledger_entries.insert_one(document)
        stored.append(_public(document))
    return {"found": True, "entries": stored, "transaction_balanced": True,
            "debits": round(debits, 2), "credits": round(credits, 2)}


async def account_balance(db: Any, user: dict, account: str) -> dict:
    account = str(account or "").strip()
    rows = await db.ledger_entries.find(
        tenant_scoped_query(user, {"account": account}), {"_id": 0}).to_list(5000)
    if not rows:
        return {"found": False, "error": f"no ledger entries for account '{account}'"}
    debits = sum(float(row.get("amount") or 0) for row in rows if row.get("direction") == "debit")
    credits = sum(float(row.get("amount") or 0) for row in rows if row.get("direction") == "credit")
    return {
        "found": True,
        "account": account,
        "entries": len(rows),
        "debits": round(debits, 2),
        "credits": round(credits, 2),
        "net": round(debits - credits, 2),
    }


async def statement(db: Any, user: dict, account: str | None = None) -> dict:
    query: dict = {"account": account} if account else {}
    rows = await db.ledger_entries.find(tenant_scoped_query(user, query), {"_id": 0}).sort("sequence", 1).to_list(5000)
    accounts: dict[str, dict] = {}
    for row in rows:
        bucket = accounts.setdefault(str(row.get("account")), {"debits": 0.0, "credits": 0.0, "entries": 0})
        bucket["entries"] += 1
        bucket[f"{row.get('direction')}s"] = round(
            bucket.get(f"{row.get('direction')}s", 0.0) + float(row.get("amount") or 0), 2)
    for bucket in accounts.values():
        bucket["net"] = round(bucket["debits"] - bucket["credits"], 2)
    return {
        "entries": rows,
        "entry_count": len(rows),
        "accounts": accounts,
        "generated_at": _iso(_utcnow()),
    }


async def revenue_share_preview(db: Any, user: dict, payload: dict) -> dict:
    """Preview a platform/marketplace revenue share — from recorded usage × a supplied rate.

    The rate must come from the caller or an agreement; Nexus never invents pricing.
    """
    meter = str(payload.get("meter") or "").strip()
    rate = _amount(payload.get("rate_per_unit"))
    if not meter or rate is None:
        return {"found": False, "error": "meter and rate_per_unit are required (rates are never invented)"}
    share_pct = payload.get("platform_share_percent")
    try:
        share_pct = round(float(share_pct), 2)
    except (TypeError, ValueError):
        return {"found": False, "error": "platform_share_percent is required"}
    if not 0 <= share_pct <= 100:
        return {"found": False, "error": "platform_share_percent must be between 0 and 100"}

    summary = await usage_summary(db, user, meter)
    bucket = summary["meters"].get(meter)
    if not bucket:
        return {"found": False, "error": f"no recorded usage for meter '{meter}'"}
    gross = round(bucket["quantity"] * rate, 2)
    platform_fee = round(gross * share_pct / 100.0, 2)
    return {
        "found": True,
        "meter": meter,
        "quantity": bucket["quantity"],
        "rate_per_unit": rate,
        "gross": gross,
        "platform_share_percent": share_pct,
        "platform_fee": platform_fee,
        "msp_net": round(gross - platform_fee, 2),
        "note": "preview only — no billing posted; rate and share supplied by the caller/agreement",
    }
