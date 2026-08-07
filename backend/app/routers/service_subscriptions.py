"""Unified recurring service and subscription register.

This endpoint deliberately keeps operational/provider quantities separate from
commercial billing streams. The UI can therefore show every recurring service
without adding provider cost and customer revenue together or pretending that
an unlinked provider quantity is already being billed.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db
from app.routers.license_management import _is_confirmed, _normalise


router = APIRouter(prefix="/service-subscriptions", tags=["service-subscriptions"])


def _number(value, default=0.0):
    try:
        return float(value if value not in (None, "") else default)
    except (TypeError, ValueError):
        return float(default)


def _integer(value, default=0):
    return max(0, int(_number(value, default)))


def _monthly_amount(amount, frequency="monthly"):
    value = _number(amount)
    cadence = str(frequency or "monthly").strip().lower()
    if cadence in {"annual", "annually", "yearly", "year"}:
        return value / 12
    if cadence in {"quarterly", "quarter"}:
        return value / 3
    if cadence in {"weekly", "week"}:
        return value * 52 / 12
    return value


def _normalise_status(value, *, enabled=True):
    if not enabled:
        return "disabled"
    status = str(value or "active").strip().lower().replace(" ", "_")
    if status in {"online", "connected", "enabled", "current"}:
        return "active"
    return status


def _infer_category(name="", source="", billing_source=""):
    text = f"{name} {source} {billing_source}".lower()
    if any(marker in text for marker in ("microsoft", "licen", "csp", "pax8", "seat")):
        return "licence"
    if any(marker in text for marker in ("backup", "acronis", "storage")):
        return "backup"
    if any(marker in text for marker in ("voice", "yeastar", "pbx", "extension", "phone")):
        return "voice"
    if any(marker in text for marker in ("dns", "shield", "security", "defender")):
        return "security"
    if any(marker in text for marker in ("internet", "mobile", "telecom", "wan", "data service")):
        return "telecom"
    if any(marker in text for marker in ("managed", "support", "agreement", "contract")):
        return "managed_service"
    return "subscription"


def _client_lookup(clients):
    by_id = {str(item.get("id")): item for item in clients if item.get("id")}
    by_name = {str(item.get("name") or "").strip().lower(): item for item in clients if item.get("name")}
    return by_id, by_name


def _client_details(record, by_id, by_name):
    client_id = str(record.get("client_id") or "")
    client = by_id.get(client_id)
    if not client and record.get("client_name"):
        client = by_name.get(str(record["client_name"]).strip().lower())
    return {
        "client_id": client_id or (client or {}).get("id") or "",
        "client_name": record.get("client_name") or (client or {}).get("name") or "Unassigned client",
    }


def _attention(*reasons):
    return [reason for reason in reasons if reason]


@router.get("/overview")
async def service_subscription_overview(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    by_client_id, by_client_name = _client_lookup(clients)

    recurring = await db.recurring_invoices.find({}, {"_id": 0}).to_list(2000)
    recurring_by_client = defaultdict(list)
    for stream in recurring:
        if stream.get("client_id"):
            recurring_by_client[str(stream["client_id"])].append(stream)

    items = []

    # Customer billing commitments. A line is the useful level of granularity:
    # one recurring invoice can contain managed services, licences and telecom.
    for stream in recurring:
        client = _client_details(stream, by_client_id, by_client_name)
        frequency = stream.get("frequency") or stream.get("billing_cycle") or "monthly"
        status = _normalise_status(stream.get("status"))
        lines = stream.get("line_items") or []
        if not lines:
            lines = [{
                "description": stream.get("description") or "Recurring service",
                "quantity": 1,
                "rate": stream.get("amount", 0),
                "amount": stream.get("amount", 0),
                "billing_source": "recurring_invoice",
            }]
        for index, line in enumerate(lines):
            quantity = max(0.0, _number(line.get("quantity"), 1))
            unit_price = _number(line.get("unit_price", line.get("rate", line.get("price", 0))))
            line_amount = _number(line.get("amount"), quantity * unit_price)
            name = line.get("description") or line.get("name") or stream.get("description") or "Recurring service"
            items.append({
                "id": f"billing:{stream.get('id', index)}:{index}",
                **client,
                "name": name,
                "category": _infer_category(name, "recurring billing", line.get("billing_source")),
                "record_kind": "billing_stream",
                "source": "recurring_billing",
                "source_label": "Recurring billing",
                "provider": line.get("provider") or "NexusMSP",
                "quantity": round(quantity, 2),
                "used_quantity": None,
                "unit_cost": None,
                "monthly_cost": None,
                "unit_price": round(unit_price, 2),
                "monthly_revenue": round(_monthly_amount(line_amount, frequency), 2),
                "billing_cycle": frequency,
                # The next invoice date is not a contract/service renewal.
                "renewal_date": stream.get("end_date") or "",
                "status": status,
                "billing_linked": True,
                "billing_state": "billing_stream" if status == "active" else status,
                "contract_id": stream.get("contract_id") or "",
                "recurring_invoice_id": stream.get("id") or "",
                "quantity_source": line.get("billing_source") or "fixed_quantity",
                "evidence_state": "billing_commitment",
                "last_synced": stream.get("updated_at") or stream.get("last_generated") or stream.get("created_at"),
                "source_route": "/recurring-invoices",
                "editable": False,
                "attention_reasons": [],
            })

    # Technician-confirmed or integration-supplied licence evidence.
    raw_licences = await db.licenses.find({}, {"_id": 0}).to_list(5000)
    for raw in raw_licences:
        if not _is_confirmed(raw):
            continue
        licence = _normalise(raw)
        client = _client_details(licence, by_client_id, by_client_name)
        billing_linked = bool(licence.get("recurring_invoice_id") or licence.get("contract_id"))
        reasons = _attention(
            "Client is not linked" if not client["client_id"] else "",
            "Not linked to recurring billing" if not billing_linked and licence.get("status", "active") == "active" else "",
        )
        items.append({
            "id": f"licence:{licence.get('id')}",
            **client,
            "name": licence.get("product_name") or "Licence",
            "category": "licence",
            "record_kind": "manual_evidence" if licence.get("source") == "manual" else "provider_usage",
            "source": licence.get("source") or "manual",
            "source_label": "Confirmed licence register" if licence.get("source") == "manual" else str(licence.get("source")).upper(),
            "provider": licence.get("vendor") or "Unspecified vendor",
            "quantity": licence.get("purchased", 0),
            "used_quantity": licence.get("used", 0),
            "unit_cost": licence.get("unit_cost", 0),
            "monthly_cost": licence.get("monthly_cost", 0),
            "unit_price": None,
            "monthly_revenue": None,
            "billing_cycle": licence.get("billing_cycle") or "monthly",
            "renewal_date": licence.get("renewal_date") or "",
            "status": _normalise_status(licence.get("status")),
            "billing_linked": billing_linked,
            "billing_state": "linked" if billing_linked else "unmapped",
            "contract_id": licence.get("contract_id") or "",
            "recurring_invoice_id": licence.get("recurring_invoice_id") or "",
            "quantity_source": "technician_confirmed" if licence.get("source") == "manual" else "provider_sync",
            "evidence_state": "manual_confirmed" if licence.get("source") == "manual" else "provider_sync",
            "last_synced": licence.get("updated_at") or licence.get("confirmed_at") or licence.get("created_at"),
            "source_route": "/services-subscriptions?view=licences",
            "editable": licence.get("source") == "manual",
            "source_record_id": licence.get("id"),
            "attention_reasons": reasons,
        })

    # Generic Nexus-native subscriptions retained for backwards compatibility.
    generic_subscriptions = await db.subscriptions.find({}, {"_id": 0}).to_list(5000)
    for record in generic_subscriptions:
        client = _client_details(record, by_client_id, by_client_name)
        name = record.get("product_name") or record.get("name") or "Subscription"
        quantity = _number(record.get("quantity", record.get("seats", 1)), 1)
        unit_cost = _number(record.get("unit_cost", record.get("cost", 0)))
        monthly_cost = _monthly_amount(
            record.get("monthly_cost", record.get("amount", quantity * unit_cost)),
            record.get("billing_cycle") or record.get("frequency") or "monthly",
        )
        billing_linked = bool(record.get("recurring_invoice_id") or record.get("contract_id"))
        reasons = _attention(
            "Client is not linked" if not client["client_id"] else "",
            "Not linked to recurring billing" if not billing_linked and _normalise_status(record.get("status")) == "active" else "",
        )
        items.append({
            "id": f"subscription:{record.get('id', len(items))}",
            **client,
            "name": name,
            "category": _infer_category(name, record.get("provider"), record.get("billing_source")),
            "record_kind": "provider_usage",
            "source": record.get("source") or "nexus_subscription",
            "source_label": record.get("source_label") or "Nexus subscription",
            "provider": record.get("provider") or record.get("vendor") or "NexusMSP",
            "quantity": round(quantity, 2),
            "used_quantity": record.get("used_quantity"),
            "unit_cost": round(unit_cost, 2),
            "monthly_cost": round(monthly_cost, 2),
            "unit_price": None,
            "monthly_revenue": None,
            "billing_cycle": record.get("billing_cycle") or record.get("frequency") or "monthly",
            "renewal_date": record.get("renewal_date") or record.get("end_date") or "",
            "status": _normalise_status(record.get("status")),
            "billing_linked": billing_linked,
            "billing_state": "linked" if billing_linked else "unmapped",
            "contract_id": record.get("contract_id") or "",
            "recurring_invoice_id": record.get("recurring_invoice_id") or "",
            "quantity_source": record.get("quantity_source") or "recorded_quantity",
            "evidence_state": record.get("evidence_state") or "recorded_subscription",
            "last_synced": record.get("last_synced") or record.get("updated_at") or record.get("created_at"),
            "source_route": f"/clients?client={client['client_id']}&tab=subscriptions" if client["client_id"] else "/clients",
            "editable": False,
            "attention_reasons": reasons,
        })

    # Pax8 live quantities.
    pax8_links = await db.pax8_customer_links.find({}, {"_id": 0}).to_list(2000)
    pax8_clients = {
        str(link.get("pax8_company_id") or link.get("company_id") or link.get("companyId")): link
        for link in pax8_links
        if link.get("pax8_company_id") or link.get("company_id") or link.get("companyId")
    }
    pax8_records = await db.pax8_subscriptions.find({}, {"_id": 0}).to_list(10000)
    for record in pax8_records:
        company_id = str(record.get("company_id") or record.get("companyId") or "")
        link = pax8_clients.get(company_id, {})
        merged = {**record, "client_id": link.get("client_id") or record.get("client_id")}
        client = _client_details(merged, by_client_id, by_client_name)
        streams = recurring_by_client.get(client["client_id"], [])
        billing_linked = any(stream.get("include_pax8_usage") for stream in streams)
        quantity = _number(record.get("quantity"))
        unit_cost = _number(record.get("unit_cost", record.get("price", record.get("unit_price", 0))))
        name = record.get("product_name") or record.get("productName") or record.get("sku") or "Pax8 subscription"
        reasons = _attention(
            "Client is not linked" if not client["client_id"] else "",
            "Not linked to recurring billing" if not billing_linked else "",
        )
        items.append({
            "id": f"pax8:{record.get('id') or record.get('subscriptionId') or len(items)}",
            **client,
            "name": name,
            "category": "licence",
            "record_kind": "provider_usage",
            "source": "pax8",
            "source_label": "Pax8 CSP",
            "provider": record.get("vendor") or "Pax8",
            "quantity": round(quantity, 2),
            "used_quantity": record.get("used_quantity"),
            "unit_cost": round(unit_cost, 2),
            "monthly_cost": round(quantity * unit_cost, 2),
            "unit_price": None,
            "monthly_revenue": None,
            "billing_cycle": record.get("billingTerm") or record.get("billing_cycle") or "monthly",
            "renewal_date": record.get("renewal_date") or record.get("commitmentEndDate") or "",
            "status": _normalise_status(record.get("status")),
            "billing_linked": billing_linked,
            "billing_state": "linked" if billing_linked else "unmapped",
            "contract_id": "",
            "recurring_invoice_id": next((stream.get("id") for stream in streams if stream.get("include_pax8_usage")), ""),
            "quantity_source": "provider_sync",
            "evidence_state": "provider_sync",
            "last_synced": record.get("updated_at") or record.get("createdDate"),
            "source_route": f"/clients?client={client['client_id']}&tab=subscriptions" if client["client_id"] else "/settings?tab=integrations",
            "editable": False,
            "attention_reasons": reasons,
        })

    # Acronis tenant usage.
    acronis_links = await db.acronis_tenant_links.find({}, {"_id": 0}).to_list(2000)
    for link in acronis_links:
        client = _client_details(link, by_client_id, by_client_name)
        usage = await db.acronis_usage.find_one({"tenant_id": link.get("tenant_id")}, {"_id": 0}) or {}
        streams = recurring_by_client.get(client["client_id"], [])
        billing_linked = any(stream.get("include_acronis_usage") for stream in streams)
        quantity = _number(usage.get("machines", usage.get("protected_workloads", 0)))
        monthly_cost = _number(usage.get("monthly_cost"))
        reasons = _attention(
            "No current provider usage" if not usage else "",
            "Not linked to recurring billing" if usage and not billing_linked else "",
        )
        items.append({
            "id": f"acronis:{link.get('tenant_id') or link.get('id')}",
            **client,
            "name": usage.get("product_name") or "Acronis protected workloads",
            "category": "backup",
            "record_kind": "provider_usage",
            "source": "acronis",
            "source_label": "Acronis Cyber Cloud",
            "provider": "Acronis",
            "quantity": round(quantity, 2),
            "used_quantity": None,
            "unit_cost": round(monthly_cost / quantity, 2) if quantity else 0,
            "monthly_cost": round(monthly_cost, 2),
            "unit_price": None,
            "monthly_revenue": None,
            "billing_cycle": "monthly",
            "renewal_date": "",
            "status": _normalise_status(usage.get("status"), enabled=bool(usage)),
            "billing_linked": billing_linked,
            "billing_state": "linked" if billing_linked else "unmapped",
            "contract_id": "",
            "recurring_invoice_id": next((stream.get("id") for stream in streams if stream.get("include_acronis_usage")), ""),
            "quantity_source": "provider_sync",
            "evidence_state": "provider_sync" if usage else "awaiting_sync",
            "last_synced": usage.get("updated_at") or usage.get("period"),
            "source_route": "/backup-center?tab=billing",
            "editable": False,
            "attention_reasons": reasons,
        })

    # Yeastar PBX extension quantities.
    pbxs = await db.yeastar_pbxs.find({}, {"_id": 0, "client_secret": 0}).to_list(2000)
    for pbx in pbxs:
        client = _client_details(pbx, by_client_id, by_client_name)
        streams = recurring_by_client.get(client["client_id"], [])
        billing_linked = bool(pbx.get("automatic_billing")) or any(stream.get("include_yeastar_usage") for stream in streams)
        quantity = _number(pbx.get("billable_extension_count", pbx.get("extension_count", 0)))
        reasons = _attention(
            "Client is not linked" if not client["client_id"] else "",
            "Not linked to recurring billing" if pbx.get("enabled", True) and not billing_linked else "",
            "Provider connection needs attention" if _normalise_status(pbx.get("status")) not in {"active"} else "",
        )
        items.append({
            "id": f"yeastar:{pbx.get('id')}",
            **client,
            "name": pbx.get("name") or pbx.get("system_name") or "Yeastar PBX",
            "category": "voice",
            "record_kind": "provider_usage",
            "source": "yeastar",
            "source_label": "Yeastar PBX",
            "provider": "Yeastar",
            "quantity": round(quantity, 2),
            "used_quantity": _number(pbx.get("extension_count")),
            "unit_cost": None,
            "monthly_cost": None,
            "unit_price": None,
            "monthly_revenue": None,
            "billing_cycle": "monthly",
            "renewal_date": "",
            "status": _normalise_status(pbx.get("status"), enabled=pbx.get("enabled", True)),
            "billing_linked": billing_linked,
            "billing_state": "linked" if billing_linked else "unmapped",
            "contract_id": pbx.get("agreement_mapping") or "",
            "recurring_invoice_id": next((stream.get("id") for stream in streams if stream.get("include_yeastar_usage")), ""),
            "quantity_source": "provider_sync",
            "evidence_state": "provider_sync" if pbx.get("last_sync") else "configured",
            "last_synced": pbx.get("last_sync") or pbx.get("updated_at"),
            "source_route": "/voice",
            "editable": False,
            "attention_reasons": reasons,
        })

    items.sort(key=lambda item: (
        0 if item.get("attention_reasons") else 1,
        item.get("client_name", ""),
        item.get("name", ""),
    ))
    provider_items = [item for item in items if item["record_kind"] in {"provider_usage", "manual_evidence"}]
    billing_items = [item for item in items if item["record_kind"] == "billing_stream"]
    active_items = [item for item in items if item["status"] == "active"]
    attention_items = [item for item in items if item.get("attention_reasons")]
    active_clients = {item["client_id"] for item in active_items if item.get("client_id")}
    provider_sources = {item["source"] for item in provider_items}
    linked_provider_items = [item for item in provider_items if item.get("billing_linked")]
    renewal_cutoff = (datetime.now(timezone.utc).date() + timedelta(days=45)).isoformat()
    today = datetime.now(timezone.utc).date().isoformat()
    renewals_due = [
        item for item in active_items
        if item.get("renewal_date") and today <= str(item["renewal_date"])[:10] <= renewal_cutoff
    ]

    source_breakdown = defaultdict(lambda: {
        "source": "", "label": "", "records": 0, "quantity": 0.0,
        "monthly_cost": 0.0, "monthly_revenue": 0.0, "attention": 0,
    })
    for item in items:
        bucket = source_breakdown[item["source"]]
        bucket["source"] = item["source"]
        bucket["label"] = item["source_label"]
        bucket["records"] += 1
        bucket["quantity"] += _number(item.get("quantity"))
        bucket["monthly_cost"] += _number(item.get("monthly_cost"))
        bucket["monthly_revenue"] += _number(item.get("monthly_revenue"))
        if item.get("attention_reasons"):
            bucket["attention"] += 1
    for bucket in source_breakdown.values():
        bucket["quantity"] = round(bucket["quantity"], 2)
        bucket["monthly_cost"] = round(bucket["monthly_cost"], 2)
        bucket["monthly_revenue"] = round(bucket["monthly_revenue"], 2)

    return {
        "summary": {
            "active_services": len(active_items),
            "all_records": len(items),
            "clients_covered": len(active_clients),
            "provider_sources": len(provider_sources),
            "managed_quantity": round(sum(_number(item.get("quantity")) for item in provider_items), 2),
            "monthly_provider_cost": round(sum(_number(item.get("monthly_cost")) for item in provider_items), 2),
            "monthly_recurring_revenue": round(sum(_number(item.get("monthly_revenue")) for item in billing_items if item["status"] == "active"), 2),
            "billing_linked": len(linked_provider_items),
            "provider_records": len(provider_items),
            "billing_coverage_pct": round(len(linked_provider_items) / max(len(provider_items), 1) * 100) if provider_items else 100,
            "attention_count": len(attention_items),
            "renewals_due": len(renewals_due),
            "manual_licences": len([item for item in items if item["record_kind"] == "manual_evidence"]),
        },
        "items": items,
        "source_breakdown": sorted(source_breakdown.values(), key=lambda row: (-row["records"], row["label"])),
        "categories": sorted({item["category"] for item in items}),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "architecture": {
            "provider_usage": "Operational quantity and provider cost evidence.",
            "billing_stream": "Customer-facing recurring revenue commitment.",
            "manual_evidence": "Technician-confirmed fallback when no provider connector exists.",
        },
    }
