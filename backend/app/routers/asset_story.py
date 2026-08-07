"""Connected asset lifecycle intelligence for managed endpoints.

Asset Story does not create another asset register. It joins the canonical
managed device to the existing inventory, procurement, quote, contract,
invoice, ticket, remote-session and event records. Missing evidence stays
missing, and replacement guidance always explains the records behind it.
"""

from __future__ import annotations

import calendar
from datetime import datetime, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.platform_foundation import emit_platform_event, request_correlation_id
from app.services.scope_permissions import assert_client_scope, assert_record_scope


router = APIRouter(tags=["Asset Story"])

USEFUL_LIFE_MONTHS = {
    "server": 60,
    "workstation": 48,
    "laptop": 36,
    "mobile": 36,
    "network": 84,
    "printer": 60,
    "peripheral": 60,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _number(value: Any) -> float | None:
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_date(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = datetime.strptime(text[:10], "%Y-%m-%d")
            except ValueError:
                return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _line_matches(
    line: dict,
    *,
    device_id: str,
    asset_id: str | None,
    serial_number: str,
    ticket_ids: set[str],
) -> bool:
    if str(line.get("device_id") or "") == device_id:
        return True
    if asset_id and str(line.get("asset_id") or "") == asset_id:
        return True
    serial = str(
        line.get("serial_number")
        or line.get("asset_serial_number")
        or line.get("serial")
        or ""
    ).strip().lower()
    if serial_number and serial == serial_number.lower():
        return True
    destination_ticket = str(line.get("destination_ticket_id") or line.get("ticket_id") or "")
    return bool(destination_ticket and destination_ticket in ticket_ids)


def document_matches_asset(
    record: dict,
    *,
    device_id: str,
    asset_id: str | None,
    serial_number: str,
    ticket_ids: set[str],
    purchase_order_number: str = "",
) -> bool:
    """Return True only when a commercial record has attributable asset evidence."""
    if str(record.get("device_id") or "") == device_id:
        return True
    if asset_id and str(record.get("asset_id") or "") == asset_id:
        return True
    if purchase_order_number and str(record.get("po_number") or "") == purchase_order_number:
        return True
    ticket_id = str(record.get("ticket_id") or "")
    if ticket_id and ticket_id in ticket_ids:
        return True
    return any(
        _line_matches(
            line,
            device_id=device_id,
            asset_id=asset_id,
            serial_number=serial_number,
            ticket_ids=ticket_ids,
        )
        for line in record.get("line_items", []) or []
    )


def _display_money(value: Any) -> float | None:
    number = _number(value)
    return round(number, 2) if number is not None else None


def _timeline_item(
    item_id: str,
    when: Any,
    category: str,
    title: str,
    detail: str,
    *,
    state: str = "recorded",
    path: str | None = None,
) -> dict | None:
    parsed = _parse_date(when)
    if not parsed:
        return None
    return {
        "id": item_id,
        "occurred_at": parsed.isoformat(),
        "category": category,
        "title": title,
        "detail": detail,
        "state": state,
        "path": path,
    }


def _asset_stage(asset: dict | None) -> str:
    if not asset:
        return "unconnected"
    return str(
        asset.get("lifecycle_stage")
        or ("disposed" if asset.get("status") == "retired" else "maintenance" if asset.get("status") == "in_repair" else "active")
    )


def build_asset_story(
    device: dict,
    asset: dict | None,
    tickets: list[dict],
    purchase_orders: list[dict],
    estimates: list[dict],
    invoices: list[dict],
    contract_lines: list[dict],
    contracts: list[dict],
    events: list[dict],
    remote_sessions: list[dict],
    *,
    matched_by: str | None = None,
    now: datetime | None = None,
) -> dict:
    """Build an explainable, read-only lifecycle story from attributable records."""
    now = now or datetime.now(timezone.utc)
    asset = asset or {}
    purchase_date = _parse_date(asset.get("purchase_date") or device.get("purchase_date"))
    warranty_end = _parse_date(
        asset.get("warranty_end")
        or asset.get("warranty_expiry")
        or device.get("warranty_expiry")
    )
    lifespan_months = int(
        asset.get("expected_lifespan_months")
        or USEFUL_LIFE_MONTHS.get(str(device.get("device_type") or asset.get("asset_type") or "").lower(), 48)
    )
    replacement_target = _add_months(purchase_date, lifespan_months) if purchase_date else None
    age_months = round(max(0, (now - purchase_date).days) / 30.4375, 1) if purchase_date else None
    warranty_days = (warranty_end.date() - now.date()).days if warranty_end else None
    replacement_days = (replacement_target.date() - now.date()).days if replacement_target else None

    ticket_count_90d = sum(
        1
        for ticket in tickets
        if (created := _parse_date(ticket.get("created_at"))) and (now - created).days <= 90
    )
    operational_pressure = []
    if str(device.get("status") or "").lower() == "offline":
        operational_pressure.append("The endpoint is currently offline.")
    if (_number(device.get("disk_usage")) or 0) >= 90:
        operational_pressure.append(f"Disk utilisation is {round(_number(device.get('disk_usage')) or 0)}%.")
    if (_number(device.get("memory_usage")) or 0) >= 90:
        operational_pressure.append(f"Memory utilisation is {round(_number(device.get('memory_usage')) or 0)}%.")
    if int(device.get("alerts_count") or 0) > 0:
        operational_pressure.append(f"{int(device.get('alerts_count') or 0)} active alert(s) are recorded.")
    if ticket_count_90d >= 3:
        operational_pressure.append(f"{ticket_count_90d} linked tickets were opened in the last 90 days.")

    replacement_reasons: list[str] = []
    if replacement_days is not None and replacement_days <= 0:
        replacement_reasons.append(
            f"The recorded {lifespan_months}-month useful life ended {abs(replacement_days)} days ago."
        )
    elif replacement_days is not None and replacement_days <= 180:
        replacement_reasons.append(
            f"The recorded useful-life target arrives in {replacement_days} days."
        )
    if warranty_days is not None and warranty_days < 0:
        replacement_reasons.append(f"Warranty expired {abs(warranty_days)} days ago.")
    elif warranty_days is not None and warranty_days <= 90:
        replacement_reasons.append(f"Warranty expires in {warranty_days} days.")
    replacement_reasons.extend(operational_pressure)

    if replacement_days is None and warranty_days is None and not operational_pressure:
        replacement_band = "not_assessed"
        replacement_label = "Not assessed"
        replacement_summary = "Record a purchase date, useful life, or warranty before Nexus recommends a refresh."
    elif (replacement_days is not None and replacement_days <= 0) or (
        warranty_days is not None and warranty_days < 0 and operational_pressure
    ):
        replacement_band = "replace"
        replacement_label = "Plan replacement"
        replacement_summary = "Lifecycle evidence supports a replacement review now."
    elif (replacement_days is not None and replacement_days <= 180) or (
        warranty_days is not None and warranty_days <= 90
    ) or len(operational_pressure) >= 2:
        replacement_band = "plan"
        replacement_label = "Prepare refresh"
        replacement_summary = "Build a replacement option before the recorded risk becomes urgent."
    else:
        replacement_band = "monitor"
        replacement_label = "Monitor"
        replacement_summary = "No current evidence requires an immediate replacement."

    identity_ready = bool(
        (asset.get("serial_number") or device.get("serial_number"))
        and (asset.get("manufacturer") or device.get("manufacturer"))
        and (asset.get("model") or device.get("model"))
    )
    ownership_ready = bool(
        device.get("client_id")
        and (asset.get("assigned_to") or device.get("assigned_user"))
        and (asset.get("location") or device.get("location"))
    )
    procurement_ready = bool(
        purchase_date
        and (
            asset.get("vendor")
            or asset.get("purchase_order_number")
            or purchase_orders
            or estimates
        )
        and _number(asset.get("purchase_cost", asset.get("cost", device.get("purchase_price")))) is not None
    )
    warranty_ready = bool(warranty_end)
    commercial_ready = bool(contract_lines or invoices)
    operations_ready = bool(tickets or events or remote_sessions)
    evidence_checks = [
        ("Identity", identity_ready, "Serial, manufacturer and model"),
        ("Ownership", ownership_ready, "Client, assigned user and location"),
        ("Procurement", procurement_ready, "Purchase date, verified cost and supplier/PO/quote"),
        ("Warranty", warranty_ready, "Recorded warranty expiry"),
        ("Commercial", commercial_ready, "Contract or invoice linkage"),
        ("Operations", operations_ready, "Ticket, event or remote-session history"),
    ]
    evidence_score = round(sum(1 for _, ready, _ in evidence_checks if ready) / len(evidence_checks) * 100)
    evidence = [
        {"label": label, "state": "verified" if ready else "missing", "requirement": requirement}
        for label, ready, requirement in evidence_checks
    ]

    historical_cost = _display_money(
        asset.get("purchase_cost", asset.get("cost", device.get("purchase_price")))
    )
    current_value = _display_money(asset.get("current_value"))
    accepted_estimate = next(
        (
            estimate
            for estimate in estimates
            if str(estimate.get("status") or "").lower() in {"accepted", "approved", "won"}
        ),
        None,
    )
    replacement_quote = _display_money((accepted_estimate or {}).get("total"))

    timeline: list[dict] = []
    for item in [
        _timeline_item(
            f"device-created-{device.get('id')}",
            device.get("created_at"),
            "identity",
            "Managed endpoint created",
            f"{device.get('name') or 'Endpoint'} entered the managed-device register.",
            path=f"/devices/{device.get('id')}",
        ),
        _timeline_item(
            f"purchase-{asset.get('id') or device.get('id')}",
            purchase_date,
            "procurement",
            "Asset purchased",
            f"Historical purchase cost: ${historical_cost:,.2f}." if historical_cost is not None else "Purchase cost was not recorded.",
            path=f"/assets/{asset.get('id')}" if asset.get("id") else None,
        ),
        _timeline_item(
            f"warranty-{asset.get('id') or device.get('id')}",
            warranty_end,
            "warranty",
            "Warranty ends",
            "Recorded warranty boundary.",
            state="upcoming" if warranty_days is not None and warranty_days >= 0 else "expired",
            path=f"/assets/{asset.get('id')}" if asset.get("id") else None,
        ),
        _timeline_item(
            f"replacement-{asset.get('id') or device.get('id')}",
            replacement_target,
            "lifecycle",
            "Recorded useful-life target",
            f"Calculated from the recorded purchase date and {lifespan_months}-month useful life.",
            state="upcoming" if replacement_days is not None and replacement_days >= 0 else "due",
            path="/procurement-planner",
        ),
    ]:
        if item:
            timeline.append(item)

    for history in asset.get("history", []) or []:
        item = _timeline_item(
            f"asset-history-{history.get('id') or len(timeline)}",
            history.get("timestamp") or history.get("created_at"),
            "lifecycle",
            str(history.get("action") or "Lifecycle change").replace("_", " ").title(),
            history.get("notes") or f"Stage: {history.get('stage') or 'not recorded'}",
            path=f"/assets/{asset.get('id')}" if asset.get("id") else None,
        )
        if item:
            timeline.append(item)
    for po in purchase_orders:
        item = _timeline_item(
            f"po-{po.get('id')}",
            po.get("created_at"),
            "procurement",
            f"Purchase order {po.get('po_number') or ''}".strip(),
            f"{po.get('vendor') or 'Supplier not recorded'} · {str(po.get('status') or 'draft').replace('_', ' ')}",
            path=f"/purchase-orders?po={po.get('id')}",
        )
        if item:
            timeline.append(item)
    for estimate in estimates:
        item = _timeline_item(
            f"estimate-{estimate.get('id')}",
            estimate.get("created_at"),
            "quote",
            f"Quote {estimate.get('estimate_number') or estimate.get('quote_number') or ''}".strip(),
            f"{str(estimate.get('status') or 'draft').replace('_', ' ')} · ${_display_money(estimate.get('total')) or 0:,.2f}",
            path=f"/estimates?estimate={estimate.get('id')}",
        )
        if item:
            timeline.append(item)
    for ticket in tickets:
        item = _timeline_item(
            f"ticket-{ticket.get('id')}",
            ticket.get("created_at"),
            "service",
            f"{ticket.get('ticket_number') or 'Ticket'} · {ticket.get('title') or 'Service record'}",
            str(ticket.get("status") or "open").replace("_", " "),
            path=f"/tickets?ticket={ticket.get('id')}",
        )
        if item:
            timeline.append(item)
    for invoice in invoices:
        item = _timeline_item(
            f"invoice-{invoice.get('id')}",
            invoice.get("created_at"),
            "billing",
            f"Invoice {invoice.get('invoice_number') or ''}".strip(),
            f"{str(invoice.get('status') or 'draft').replace('_', ' ')} · ${_display_money(invoice.get('total')) or 0:,.2f}",
            path=f"/invoices?invoice={invoice.get('id')}",
        )
        if item:
            timeline.append(item)
    for session in remote_sessions[:10]:
        item = _timeline_item(
            f"session-{session.get('id')}",
            session.get("started_at"),
            "service",
            "Remote support session",
            f"{session.get('technician_name') or session.get('user_name') or 'Technician'} · {str(session.get('status') or 'completed').replace('_', ' ')}",
            path=f"/devices/{device.get('id')}",
        )
        if item:
            timeline.append(item)
    routine_event_types = {"agent_check_in", "heartbeat", "inventory_checkin", "software_inventory"}
    routine_seen: set[str] = set()
    event_rows_added = 0
    for event in events:
        event_type = str(event.get("event_type") or event.get("type") or "endpoint_event").lower()
        if event_type in routine_event_types:
            if event_type in routine_seen:
                continue
            routine_seen.add(event_type)
        item = _timeline_item(
            f"event-{event.get('id') or len(timeline)}",
            event.get("timestamp") or event.get("created_at"),
            "technical",
            event_type.replace("_", " ").title(),
            event.get("message") or event.get("description") or "Recorded by the managed endpoint.",
            path=f"/devices/{device.get('id')}",
        )
        if item:
            timeline.append(item)
            event_rows_added += 1
        if event_rows_added >= 12:
            break

    timeline.sort(key=lambda row: row["occurred_at"], reverse=True)

    contract_map = {contract.get("id"): contract for contract in contracts}
    commercial_links = []
    for line in contract_lines:
        contract = contract_map.get(line.get("contract_id"), {})
        commercial_links.append({
            "type": "contract",
            "id": line.get("id"),
            "label": contract.get("name") or line.get("description") or "Contract inclusion",
            "reference": contract.get("contract_number") or line.get("contract_id") or "",
            "status": line.get("asset_status") or contract.get("status") or "active",
            "value": _display_money(line.get("unit_price")),
            "path": f"/contracts?contract={line.get('contract_id')}",
        })
    for invoice in invoices:
        commercial_links.append({
            "type": "invoice",
            "id": invoice.get("id"),
            "label": invoice.get("invoice_name") or invoice.get("invoice_number") or "Invoice",
            "reference": invoice.get("invoice_number") or "",
            "status": invoice.get("status") or "draft",
            "value": _display_money(invoice.get("total")),
            "path": f"/invoices?invoice={invoice.get('id')}",
        })

    purchase_reason = str(asset.get("notes") or "").strip()
    if not purchase_reason:
        linked_ticket = next(
            (
                ticket
                for ticket in tickets
                if any(
                    str(line.get("destination_ticket_id") or "") == str(ticket.get("id") or "")
                    for po in purchase_orders
                    for line in po.get("line_items", []) or []
                )
            ),
            None,
        )
        if linked_ticket:
            purchase_reason = f"Purchased for {linked_ticket.get('ticket_number') or 'ticket'}: {linked_ticket.get('title') or 'service requirement'}."

    return {
        "device": {
            "id": device.get("id"),
            "name": device.get("name"),
            "client_id": device.get("client_id"),
            "client_name": device.get("client_name"),
            "assigned_user": device.get("assigned_user"),
            "location": device.get("location"),
            "serial_number": device.get("serial_number"),
            "status": device.get("status"),
        },
        "asset": asset or None,
        "connection": {
            "connected": bool(asset),
            "matched_by": matched_by,
            "canonical_record": "inventory_assets",
        },
        "lifecycle": {
            "stage": _asset_stage(asset or None),
            "age_months": age_months,
            "useful_life_months": lifespan_months,
            "purchase_date": purchase_date.date().isoformat() if purchase_date else None,
            "warranty_end": warranty_end.date().isoformat() if warranty_end else None,
            "warranty_days_remaining": warranty_days,
            "replacement_target": replacement_target.date().isoformat() if replacement_target else None,
            "replacement_days_remaining": replacement_days,
        },
        "replacement": {
            "band": replacement_band,
            "label": replacement_label,
            "summary": replacement_summary,
            "reasons": replacement_reasons,
            "historical_purchase_cost": historical_cost,
            "current_value": current_value,
            "replacement_quote": replacement_quote,
            "financial_comparison": (
                "A linked accepted quote provides a recorded replacement option."
                if replacement_quote is not None
                else "Not assessed until a replacement quote is linked. Historical cost is not treated as a current replacement estimate."
            ),
        },
        "evidence": {
            "score": evidence_score,
            "checks": evidence,
            "missing": [item["label"] for item in evidence if item["state"] == "missing"],
        },
        "procurement": {
            "purchase_reason": purchase_reason or None,
            "vendor": asset.get("vendor") or (purchase_orders[0].get("vendor") if purchase_orders else None),
            "purchase_order_number": asset.get("purchase_order_number") or (purchase_orders[0].get("po_number") if purchase_orders else None),
            "historical_purchase_cost": historical_cost,
            "purchase_orders": purchase_orders,
            "estimates": estimates,
        },
        "ownership": {
            "client_id": device.get("client_id"),
            "client_name": device.get("client_name"),
            "assigned_user": asset.get("assigned_to") or asset.get("assigned_user_name") or device.get("assigned_user"),
            "location": asset.get("location") or device.get("location"),
        },
        "operations": {
            "ticket_count": len(tickets),
            "tickets_90d": ticket_count_90d,
            "remote_session_count": len(remote_sessions),
            "event_count": len(events),
            "tickets": tickets[:20],
        },
        "commercial_links": commercial_links,
        "timeline": timeline[:60],
        "generated_at": now.isoformat(),
        "method": (
            "Asset Story joins only attributable Nexus records. Missing purchase, cost, warranty, contract, "
            "quote or invoice evidence is not inferred from client ownership alone."
        ),
    }


async def _find_asset_for_device(device: dict) -> tuple[dict | None, str | None]:
    asset = await db.assets.find_one({"device_id": device.get("id")}, {"_id": 0})
    if asset:
        return asset, "device_id"
    serial = str(device.get("serial_number") or "").strip()
    if serial:
        candidate = await db.assets.find_one({"serial_number": serial}, {"_id": 0})
        if candidate and (
            not candidate.get("client_id")
            or not device.get("client_id")
            or candidate.get("client_id") == device.get("client_id")
        ):
            return candidate, "serial_number"
    return None, None


async def _load_story(device: dict) -> dict:
    asset, matched_by = await _find_asset_for_device(device)
    tickets = await db.tickets.find(
        {"$or": [{"device_id": device["id"]}, {"device_ids": device["id"]}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    ticket_ids = {str(ticket.get("id")) for ticket in tickets if ticket.get("id")}
    client_query = {"client_id": device.get("client_id")} if device.get("client_id") else {"id": "__none__"}
    purchase_order_candidates = await db.purchase_orders.find(client_query, {"_id": 0}).sort("created_at", -1).to_list(500)
    estimate_candidates = await db.estimates.find(client_query, {"_id": 0}).sort("created_at", -1).to_list(500)
    invoice_candidates = await db.invoices.find(client_query, {"_id": 0}).sort("created_at", -1).to_list(500)
    asset_id = asset.get("id") if asset else None
    serial = str((asset or {}).get("serial_number") or device.get("serial_number") or "").strip()
    po_number = str((asset or {}).get("purchase_order_number") or "").strip()
    match_kwargs = {
        "device_id": device["id"],
        "asset_id": asset_id,
        "serial_number": serial,
        "ticket_ids": ticket_ids,
        "purchase_order_number": po_number,
    }
    purchase_orders = [row for row in purchase_order_candidates if document_matches_asset(row, **match_kwargs)]
    estimates = [row for row in estimate_candidates if document_matches_asset(row, **match_kwargs)]
    invoices = [row for row in invoice_candidates if document_matches_asset(row, **match_kwargs)]

    line_query_parts = [{"device_id": device["id"]}]
    if asset_id:
        line_query_parts.append({"asset_id": asset_id})
    if serial:
        line_query_parts.append({"asset_serial_number": serial})
    contract_lines = await db.line_items.find(
        {"$or": line_query_parts}, {"_id": 0}
    ).to_list(200)
    contract_ids = list({line.get("contract_id") for line in contract_lines if line.get("contract_id")})
    contracts = await db.contracts.find(
        {"id": {"$in": contract_ids}}, {"_id": 0}
    ).to_list(len(contract_ids) or 1)
    events = await db.device_events.find(
        {"device_id": device["id"]}, {"_id": 0}
    ).sort("timestamp", -1).to_list(100)
    sessions = await db.remote_sessions.find(
        {"device_id": device["id"]}, {"_id": 0}
    ).sort("started_at", -1).to_list(100)
    return build_asset_story(
        device,
        asset,
        tickets,
        purchase_orders,
        estimates,
        invoices,
        contract_lines,
        contracts,
        events,
        sessions,
        matched_by=matched_by,
    )


@router.get("/devices/{device_id}/asset-story")
async def get_asset_story(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await assert_record_scope(
        current_user,
        db.devices,
        device_id,
        operation="asset.story.read",
        resource_name="Device",
    )
    return await _load_story(device)


@router.post(
    "/devices/{device_id}/asset-story/connect",
    dependencies=[Depends(require_action("asset.lifecycle.manage"))],
)
async def connect_asset_story(
    device_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Create or explicitly link the canonical inventory record for an endpoint."""
    device = await assert_record_scope(
        current_user,
        db.devices,
        device_id,
        operation="asset.story.connect",
        resource_name="Device",
    )
    await assert_client_scope(
        current_user,
        device.get("client_id"),
        operation="asset.story.connect",
        request=request,
    )
    existing, matched_by = await _find_asset_for_device(device)
    mode = str(data.get("mode") or "create").strip().lower()
    if existing and matched_by == "device_id" and mode == "create":
        raise HTTPException(status_code=409, detail="This endpoint already has a connected inventory record")

    now = _now()
    actor = current_user.get("name") or current_user.get("email") or "Technician"
    if mode == "link":
        asset_id = str(data.get("asset_id") or "").strip()
        if not asset_id:
            raise HTTPException(status_code=422, detail="Select an inventory asset to link")
        asset = await db.assets.find_one({"id": asset_id}, {"_id": 0})
        if not asset:
            raise HTTPException(status_code=404, detail="Inventory asset not found")
        if asset.get("client_id") and device.get("client_id") and asset.get("client_id") != device.get("client_id"):
            raise HTTPException(status_code=409, detail="The inventory asset belongs to a different client")
        linked_elsewhere = await db.assets.find_one(
            {"device_id": {"$nin": [None, "", device_id]}, "id": asset_id},
            {"_id": 0, "device_id": 1},
        )
        if linked_elsewhere:
            raise HTTPException(status_code=409, detail="The inventory asset is already linked to another endpoint")
        history = {
            "id": str(uuid.uuid4()),
            "action": "endpoint_connected",
            "stage": _asset_stage(asset),
            "user_id": current_user.get("id"),
            "user_name": actor,
            "notes": str(data.get("notes") or f"Connected to managed endpoint {device.get('name')}").strip(),
            "timestamp": now,
        }
        await db.assets.update_one(
            {"id": asset_id},
            {"$set": {
                "device_id": device_id,
                "client_id": device.get("client_id"),
                "client_name": device.get("client_name"),
                "updated_at": now,
            }, "$push": {"history": history}},
        )
        asset = await db.assets.find_one({"id": asset_id}, {"_id": 0})
        action = "linked"
    elif mode == "create":
        purchase_cost = _number(data.get("purchase_cost"))
        useful_life = int(data.get("expected_lifespan_months") or USEFUL_LIFE_MONTHS.get(str(device.get("device_type") or "").lower(), 48))
        if useful_life < 1 or useful_life > 240:
            raise HTTPException(status_code=422, detail="Useful life must be between 1 and 240 months")
        asset_id = str(uuid.uuid4())
        asset = {
            "id": asset_id,
            "asset_tag": str(data.get("asset_tag") or f"AST-{asset_id[:6].upper()}"),
            "name": str(data.get("name") or device.get("name") or "Managed asset").strip(),
            "asset_type": device.get("device_type") or "hardware",
            "category": device.get("device_type") or "computer",
            "manufacturer": device.get("manufacturer") or "",
            "model": device.get("model") or "",
            "serial_number": device.get("serial_number") or "",
            "client_id": device.get("client_id"),
            "client_name": device.get("client_name"),
            "device_id": device_id,
            "assigned_to": device.get("assigned_user") or "",
            "assigned_user_name": device.get("assigned_user") or "",
            "location": device.get("location") or "",
            "lifecycle_stage": "active",
            "status": "active",
            "cost": purchase_cost or 0,
            "purchase_cost": purchase_cost or 0,
            "purchase_date": str(data.get("purchase_date") or device.get("purchase_date") or ""),
            "vendor": str(data.get("vendor") or ""),
            "purchase_order_number": str(data.get("purchase_order_number") or ""),
            "warranty_start": str(data.get("warranty_start") or ""),
            "warranty_end": str(data.get("warranty_end") or device.get("warranty_expiry") or ""),
            "warranty_expiry": str(data.get("warranty_end") or device.get("warranty_expiry") or ""),
            "expected_lifespan_months": useful_life,
            "depreciation_method": "straight_line",
            "depreciation_rate": _number(data.get("depreciation_rate")) or 0,
            "current_value": purchase_cost or 0,
            "notes": str(data.get("purchase_reason") or data.get("notes") or ""),
            "history": [{
                "id": str(uuid.uuid4()),
                "action": "created_from_managed_endpoint",
                "stage": "active",
                "user_id": current_user.get("id"),
                "user_name": actor,
                "notes": f"Canonical inventory record created from {device.get('name')}",
                "timestamp": now,
            }],
            "created_at": now,
            "updated_at": now,
        }
        await db.assets.insert_one(asset)
        action = "created"
    else:
        raise HTTPException(status_code=422, detail="Mode must be create or link")

    await db.devices.update_one(
        {"id": device_id},
        {"$set": {"asset_id": asset["id"], "updated_at": now}},
    )
    await log_activity(
        current_user,
        action,
        "asset",
        asset["id"],
        asset.get("name") or device.get("name") or "Asset",
        f"{action.title()} canonical inventory record for managed endpoint {device.get('name')}",
        metadata={"device_id": device_id, "client_id": device.get("client_id")},
    )
    await emit_platform_event(
        db,
        subject="asset.story.connected",
        entity_type="asset",
        entity_id=asset["id"],
        client_id=device.get("client_id"),
        actor=current_user,
        correlation_id=request_correlation_id(request),
        payload={
            "device_id": device_id,
            "mode": action,
            "asset_tag": asset.get("asset_tag"),
        },
    )
    return {
        "message": f"Inventory record {action}",
        "asset": {key: value for key, value in asset.items() if key != "_id"},
        "story": await _load_story({**device, "asset_id": asset["id"]}),
    }
