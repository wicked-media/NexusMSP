"""Evidence-backed software licence register.

This workspace is deliberately inventory-first.  It accepts technician-confirmed
licences now and can display records supplied by an integration later; it never
inventories vendors, seats, costs, or savings on behalf of a customer.
"""

from datetime import datetime, timedelta, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity


router = APIRouter(prefix="/license-management", tags=["license-management"])

TRUSTED_SOURCES = {"manual", "pax8", "cipp", "m365_graph", "billing_sync"}


def _number(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_int(value, default=0):
    return max(0, int(_number(value, default)))


def _is_confirmed(record: dict) -> bool:
    """Permit source-tagged data plus pre-migration human entries only.

    The former demo generator did not write ``created_at``.  A record with a
    creation timestamp but no source was created through the old manual form,
    so retaining it avoids hiding a real technician-entered register.
    """
    source = str(record.get("source") or "").strip().lower()
    return source in TRUSTED_SOURCES or (not source and bool(record.get("created_at")))


async def _all_records():
    return await db.licenses.find({}, {"_id": 0}).to_list(2000)


def _normalise(record: dict) -> dict:
    purchased = _as_int(record.get("purchased", record.get("seats", 0)))
    used = _as_int(record.get("used", record.get("seats_used", 0)))
    unit_cost = round(_number(record.get("unit_cost")), 2)
    monthly_cost = round(_number(record.get("monthly_cost"), purchased * unit_cost), 2)
    if not monthly_cost and purchased and unit_cost:
        monthly_cost = round(purchased * unit_cost, 2)
    return {
        **record,
        "purchased": purchased,
        "used": used,
        "available": max(0, purchased - used),
        "unit_cost": unit_cost,
        "monthly_cost": monthly_cost,
        "source": record.get("source") or "manual",
    }


def _overview(records: list[dict], legacy_unverified: int) -> dict:
    records = [_normalise(record) for record in records]
    total_purchased = sum(record["purchased"] for record in records)
    total_used = sum(record["used"] for record in records)
    total_cost = sum(record["monthly_cost"] for record in records)
    wasted = sum(record["available"] for record in records)
    wasted_cost = sum(record["available"] * record["unit_cost"] for record in records)
    today = datetime.now(timezone.utc).date()
    renewal_cutoff = (today + timedelta(days=30)).isoformat()
    expiring = [record for record in records if record.get("renewal_date") and record["renewal_date"] <= renewal_cutoff]
    overutilized = [record for record in records if record["used"] >= record["purchased"] and record["purchased"] > 0]

    vendors, clients = {}, {}
    for record in records:
        vendor = record.get("vendor") or "Unspecified vendor"
        vendor_summary = vendors.setdefault(vendor, {"vendor": vendor, "licenses": 0, "total_cost": 0, "total_seats": 0, "used_seats": 0})
        vendor_summary["licenses"] += 1
        vendor_summary["total_cost"] += record["monthly_cost"]
        vendor_summary["total_seats"] += record["purchased"]
        vendor_summary["used_seats"] += record["used"]

        client = record.get("client_name") or "Unassigned client"
        client_summary = clients.setdefault(client, {"client": client, "licenses": 0, "total_cost": 0, "wasted_cost": 0, "utilization": 0, "total_seats": 0, "used_seats": 0})
        client_summary["licenses"] += 1
        client_summary["total_cost"] += record["monthly_cost"]
        client_summary["wasted_cost"] += record["available"] * record["unit_cost"]
        client_summary["total_seats"] += record["purchased"]
        client_summary["used_seats"] += record["used"]

    for summary in clients.values():
        summary["utilization"] = round(summary["used_seats"] / max(summary["total_seats"], 1) * 100)
        summary["total_cost"] = round(summary["total_cost"], 2)
        summary["wasted_cost"] = round(summary["wasted_cost"], 2)
    for summary in vendors.values():
        summary["total_cost"] = round(summary["total_cost"], 2)

    suggestions = []
    if wasted and wasted_cost:
        suggestions.append({
            "type": "review_unused_seats",
            "message": f"Review {wasted} recorded unused seat(s) before changing billing.",
            "savings": round(wasted_cost, 2),
            "priority": "review",
            "evidence": "Calculated from confirmed register quantities and unit costs.",
        })
    if expiring:
        suggestions.append({
            "type": "renewal_review",
            "message": f"Review {len(expiring)} recorded renewal(s) due within 30 days.",
            "savings": None,
            "priority": "review",
            "evidence": "Based on the renewal dates recorded in this register.",
        })

    return {
        "summary": {
            "total_licenses": len(records),
            "total_purchased": total_purchased,
            "total_used": total_used,
            "utilization_pct": round(total_used / max(total_purchased, 1) * 100) if total_purchased else None,
            "total_monthly_cost": round(total_cost, 2),
            "total_annual_cost": round(total_cost * 12, 2),
            "wasted_licenses": wasted,
            "wasted_cost_monthly": round(wasted_cost, 2),
            "expiring_soon": len(expiring),
            "overutilized": len(overutilized),
            "legacy_unverified": legacy_unverified,
        },
        "licenses": sorted(records, key=lambda record: record["monthly_cost"], reverse=True),
        "vendor_breakdown": sorted(vendors.values(), key=lambda record: record["total_cost"], reverse=True),
        "client_breakdown": sorted(clients.values(), key=lambda record: record["total_cost"], reverse=True),
        "expiring_soon": sorted(expiring, key=lambda record: record.get("renewal_date") or "")[:10],
        "optimization_suggestions": suggestions,
        "evidence_state": "evidence_available" if records else "not_configured",
    }


@router.get("/overview")
async def get_overview(current_user: dict = Depends(get_current_user)):
    all_records = await _all_records()
    confirmed = [record for record in all_records if _is_confirmed(record)]
    return _overview(confirmed, len(all_records) - len(confirmed))


@router.put("/licenses/{license_id}")
async def update_license(license_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    existing = await db.licenses.find_one({"id": license_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Licence record not found")
    allowed = {"product_name", "vendor", "client_name", "client_id", "purchased", "used", "auto_renew", "notes", "unit_cost", "billing_cycle", "license_type", "renewal_date", "status", "exclusion_reason"}
    updates = {key: data[key] for key in allowed if key in data}
    purchased = _as_int(updates.get("purchased", existing.get("purchased", 0)))
    used = _as_int(updates.get("used", existing.get("used", 0)))
    unit_cost = round(_number(updates.get("unit_cost", existing.get("unit_cost", 0))), 2)
    updates.update({
        "purchased": purchased,
        "used": used,
        "available": max(0, purchased - used),
        "unit_cost": unit_cost,
        "monthly_cost": round(purchased * unit_cost, 2),
        "source": "manual",
        "confirmed_at": datetime.now(timezone.utc).isoformat(),
        "confirmed_by": current_user.get("name") or current_user.get("email") or "Unknown technician",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.licenses.update_one({"id": license_id}, {"$set": updates})
    await log_activity(current_user, "updated", "licence", license_id, existing.get("product_name", "Licence"), "Confirmed or updated licence register entry", changes=updates)
    return {"message": "Licence record updated", "source": "manual"}


@router.post("/licenses")
async def add_license(data: dict, current_user: dict = Depends(get_current_user)):
    product_name = str(data.get("product_name") or "").strip()
    client_name = str(data.get("client_name") or "").strip()
    if not product_name or not client_name:
        raise HTTPException(status_code=400, detail="Product and client are required for a licence register entry")
    purchased = _as_int(data.get("purchased", 0))
    used = _as_int(data.get("used", 0))
    if used > purchased:
        raise HTTPException(status_code=400, detail="Used seats cannot exceed purchased seats")
    now = datetime.now(timezone.utc).isoformat()
    unit_cost = round(_number(data.get("unit_cost", 0)), 2)
    licence = {
        "id": f"LIC-{uuid.uuid4().hex[:8].upper()}",
        "product_name": product_name,
        "vendor": str(data.get("vendor") or "").strip(),
        "client_name": client_name,
        "client_id": data.get("client_id") or None,
        "purchased": purchased,
        "used": used,
        "available": purchased - used,
        "unit_cost": unit_cost,
        "monthly_cost": round(purchased * unit_cost, 2),
        "renewal_date": str(data.get("renewal_date") or ""),
        "auto_renew": bool(data.get("auto_renew", True)),
        "billing_cycle": data.get("billing_cycle") or "monthly",
        "license_type": data.get("license_type") or "per_user",
        "status": data.get("status") or "active",
        "notes": str(data.get("notes") or "")[:4000],
        "source": "manual",
        "created_at": now,
        "confirmed_at": now,
        "confirmed_by": current_user.get("name") or current_user.get("email") or "Unknown technician",
    }
    await db.licenses.insert_one(licence)
    await log_activity(current_user, "created", "licence", licence["id"], product_name, "Created a confirmed manual licence register entry", metadata={"client_id": licence["client_id"], "source": "manual"})
    return licence


@router.delete("/licenses/{license_id}")
async def delete_license(license_id: str, current_user: dict = Depends(get_current_user)):
    existing = await db.licenses.find_one({"id": license_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Licence record not found")
    await db.licenses.delete_one({"id": license_id})
    await log_activity(current_user, "deleted", "licence", license_id, existing.get("product_name", "Licence"), "Deleted licence register entry")
    return {"message": "Licence record deleted"}
