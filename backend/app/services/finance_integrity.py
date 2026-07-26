"""Shared financial-integrity helpers for invoices and procurement.

These helpers deliberately live below the routers so every delivery surface
(workspace, portal, PDF and email) sees the same canonical invoice values and
write actions can share one idempotency contract.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from typing import Any

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value if value not in (None, "") else default)
    except (TypeError, ValueError):
        return default


def normalise_invoice_line_item(item: dict[str, Any]) -> dict[str, Any]:
    """Return one canonical invoice line while retaining source metadata.

    Older NexusMSP records used ``rate``/``amount`` whereas the current
    workspaces and PDF renderer use ``unit_price``/``total``. Reading either
    shape through this boundary prevents a valid historical invoice from being
    presented as a zero-dollar document.
    """

    source = dict(item or {})
    quantity = _number(source.get("quantity"), 1.0)
    unit_price = _number(source.get("unit_price", source.get("rate", 0)))
    discount_pct = _number(source.get("discount_pct"), 0.0)
    calculated_total = round(quantity * unit_price * (1 - discount_pct / 100), 2)
    raw_total = source.get("total")
    if raw_total in (None, ""):
        raw_total = source.get("amount")
    total = round(_number(raw_total, calculated_total), 2)
    name = str(source.get("name") or source.get("description") or "Invoice item").strip()
    description = str(source.get("description") or source.get("name") or "").strip()
    return {
        **source,
        "name": name,
        "description": description,
        "quantity": quantity,
        "unit_price": unit_price,
        "discount_pct": discount_pct,
        "total": total,
    }


def normalise_invoice_document(invoice: dict[str, Any] | None) -> dict[str, Any] | None:
    if not invoice:
        return invoice
    normalised = dict(invoice)
    normalised["line_items"] = [
        normalise_invoice_line_item(item)
        for item in (normalised.get("line_items") or [])
    ]
    return normalised


def _payload_hash(payload: Any) -> str:
    serialised = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(serialised.encode("utf-8")).hexdigest()


async def begin_idempotent_operation(
    db,
    *,
    scope: str,
    key: str | None,
    payload: Any,
    user_id: str,
) -> dict[str, Any] | None:
    """Claim an operation, or return its previously completed response.

    The caller may omit a key for backwards compatibility. Updated NexusMSP
    clients always send one. MongoDB's ``_id`` uniqueness makes the claim
    atomic without requiring a separate migration or index.
    """

    clean_key = str(key or "").strip()
    if not clean_key:
        return None
    if len(clean_key) > 160:
        raise HTTPException(status_code=422, detail="Idempotency key is too long")

    operation_id = f"{scope}:{clean_key}"
    payload_hash = _payload_hash(payload)
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "_id": operation_id,
        "scope": scope,
        "key": clean_key,
        "payload_hash": payload_hash,
        "user_id": user_id,
        "status": "processing",
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db.finance_idempotency.insert_one(record)
        return None
    except DuplicateKeyError:
        existing = await db.finance_idempotency.find_one({"_id": operation_id})
        if not existing:
            raise HTTPException(status_code=409, detail="The operation is already being processed")
        if existing.get("payload_hash") != payload_hash:
            raise HTTPException(status_code=409, detail="This idempotency key was already used for different data")
        if existing.get("status") == "completed":
            return existing.get("response") or {"message": "Operation already completed", "replayed": True}
        if existing.get("status") == "failed":
            claimed = await db.finance_idempotency.update_one(
                {"_id": operation_id, "status": "failed"},
                {"$set": {"status": "processing", "updated_at": now}, "$unset": {"error": ""}},
            )
            if claimed.modified_count:
                return None
        raise HTTPException(status_code=409, detail="The operation is already being processed")


async def complete_idempotent_operation(db, *, scope: str, key: str | None, response: dict[str, Any]) -> None:
    clean_key = str(key or "").strip()
    if not clean_key:
        return
    await db.finance_idempotency.update_one(
        {"_id": f"{scope}:{clean_key}"},
        {"$set": {
            "status": "completed",
            "response": response,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )


async def fail_idempotent_operation(db, *, scope: str, key: str | None, error: str) -> None:
    clean_key = str(key or "").strip()
    if not clean_key:
        return
    await db.finance_idempotency.update_one(
        {"_id": f"{scope}:{clean_key}"},
        {"$set": {
            "status": "failed",
            "error": str(error)[:500],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
