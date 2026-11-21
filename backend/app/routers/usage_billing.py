"""Derived usage-billing overview.

There is no separate "usage plan" record in Nexus.  Metered billing is a
property of a recurring invoice: its provider usage switches, source-driven
lines, and live client quantities.  This endpoint therefore reports only what
can be evidenced from those records.  It never seeds demo plans and never
invents user counts, storage or overage amounts that the billing system does
not actually hold.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import scoped_query

router = APIRouter()

_FREQUENCY_MONTHS = {
    "weekly": 12 / 52,
    "fortnightly": 12 / 26,
    "monthly": 1,
    "quarterly": 3,
    "annually": 12,
}


def _monthly_value(amount: float, frequency: str) -> float:
    multiplier = _FREQUENCY_MONTHS.get(str(frequency or "monthly").lower(), 1)
    if str(frequency or "").lower() in {"weekly", "fortnightly"}:
        return amount * (52 / 12 if str(frequency).lower() == "weekly" else 26 / 12)
    return amount / multiplier if multiplier else amount


def _finite(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return number


def _plan_type(recurring: dict, usage_lines: list[dict]) -> str:
    streams = [
        bool(recurring.get("include_acronis_usage")),
        bool(recurring.get("include_pax8_usage")),
        bool(recurring.get("include_yeastar_usage")),
    ]
    sources = {str(line.get("billing_source") or "") for line in usage_lines}
    if sum(streams) > 1 or len(sources) > 1:
        return "hybrid"
    if recurring.get("include_pax8_usage"):
        return "per_user"
    if recurring.get("include_acronis_usage") or "asset_count" in sources:
        return "per_device"
    if "inventory" in sources:
        return "per_unit"
    return "metered"


def _usage_line(line: dict) -> bool:
    return bool(
        line.get("acronis_auto")
        or line.get("pax8_auto")
        or line.get("yeastar_auto")
        or line.get("billing_source") in {"asset_count", "inventory"}
    )


@router.get("/usage-billing/overview")
async def billing_overview(current_user: dict = Depends(get_current_user)):
    """Return usage billing evidence visible to the current operator.

    Asset quantities are counted from active client assets.  User and storage
    quantities remain ``None`` unless a future provider-specific aggregate
    supplies them; returning zero would falsely imply that no usage exists.
    """
    recurring = await db.recurring_invoices.find(
        scoped_query(current_user, {"status": {"$in": ["active", "paused"]}}, site_field=None),
        {"_id": 0},
    ).to_list(2000)

    client_ids = sorted({str(row.get("client_id") or "") for row in recurring if row.get("client_id")})
    # A client with no active assets has a known count of zero, not unknown.
    assets_by_client: dict[str, int] = {client_id: 0 for client_id in client_ids}
    if client_ids:
        assets = await db.assets.find(
            scoped_query(
                current_user,
                {"client_id": {"$in": client_ids}, "status": "active"},
                site_field=None,
            ),
            {"_id": 0, "client_id": 1},
        ).to_list(20000)
        for asset in assets:
            client_id = str(asset.get("client_id") or "")
            if client_id:
                assets_by_client[client_id] = assets_by_client.get(client_id, 0) + 1

    plans: list[dict] = []
    for row in recurring:
        line_items = [line for line in (row.get("line_items") or []) if isinstance(line, dict)]
        usage_lines = [line for line in line_items if _usage_line(line)]
        provider_streams = any(
            row.get(flag)
            for flag in ("include_acronis_usage", "include_pax8_usage", "include_yeastar_usage")
        )
        if not usage_lines and not provider_streams:
            continue

        subtotal = _finite(row.get("subtotal"))
        if subtotal is None:
            subtotal = _finite(row.get("amount")) or 0.0
        monthly_mrr = round(_monthly_value(subtotal, row.get("frequency", "monthly")), 2)
        base_fee = round(
            sum(
                _finite(line.get("amount")) or 0.0
                for line in line_items
                if not _usage_line(line)
            ),
            2,
        )
        per_device_lines = [
            line for line in usage_lines
            if str(line.get("billing_source") or "") == "asset_count"
            or line.get("acronis_auto")
        ]
        rates = [
            value
            for value in (_finite(line.get("rate")) for line in per_device_lines)
            if value is not None
        ]
        overage = _finite(row.get("overage_amount"))
        client_id = str(row.get("client_id") or "")

        plans.append({
            "id": row.get("id"),
            "client_id": client_id,
            "client_name": row.get("client_name") or "",
            "description": row.get("description") or "",
            "plan_type": _plan_type(row, usage_lines),
            "device_count": assets_by_client.get(client_id),
            "user_count": None,
            "per_device_rate": round(sum(rates) / len(rates), 4) if rates else None,
            "base_fee": base_fee,
            "current_mrr": monthly_mrr,
            "overage_amount": overage,
            "storage_gb": None,
            "billing_cycle": row.get("frequency") or "monthly",
            "next_invoice": row.get("next_generation"),
            "currency": row.get("currency") or "AUD",
            "status": row.get("status") or "active",
            "usage_streams": [
                label
                for label, enabled in (
                    ("Acronis", bool(row.get("include_acronis_usage"))),
                    ("Pax8", bool(row.get("include_pax8_usage"))),
                    ("Yeastar", bool(row.get("include_yeastar_usage"))),
                )
                if enabled
            ],
            "quantity_source": "live_assets" if client_id in assets_by_client else "unknown",
        })

    total_mrr = round(sum(plan["current_mrr"] for plan in plans if plan["status"] == "active"), 2)
    total_devices = sum(plan["device_count"] or 0 for plan in plans if plan["status"] == "active")
    return {
        "plans": plans,
        "summary": {
            "total_mrr": total_mrr,
            "total_clients": len({plan["client_id"] for plan in plans if plan["client_id"]}),
            "avg_per_device": round(total_mrr / total_devices, 2) if total_devices else None,
            "overages_this_month": round(
                sum((plan["overage_amount"] or 0) for plan in plans if plan["status"] == "active"), 2
            ),
            "metered_plans": len(plans),
            "currency": plans[0]["currency"] if plans else "AUD",
            "source": "recurring_invoices",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "unknown_quantities": [
                field
                for field in ("user_count", "storage_gb")
                if any(plan[field] is None for plan in plans)
            ],
        },
    }
