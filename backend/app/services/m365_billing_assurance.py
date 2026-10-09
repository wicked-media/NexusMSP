"""Evidence-first Microsoft 365 licence-to-service reconciliation.

The provider tells Nexus what Microsoft SKU capacity and consumption it sees.
Nexus contract line items own customer commercial inclusions. A durable mapping
between those two has to use the provider SKU ID captured on the contract line;
display names are never used as a matching key.

This module is deliberately read-only and deterministic. Callers own database
scope enforcement and provider access, while this service builds an auditable
review result from the supplied evidence.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable


def _number(value: Any) -> int:
    try:
        return max(0, int(float(value if value not in (None, "") else 0)))
    except (TypeError, ValueError):
        return 0


def _is_active(record: dict[str, Any]) -> bool:
    return str(record.get("status") or "active").strip().lower() not in {
        "cancelled", "canceled", "disabled", "inactive", "suspended", "expired",
    }


def _provider_sku_id(record: dict[str, Any]) -> str:
    return str(record.get("skuId") or record.get("SkuId") or record.get("sku_id") or record.get("id") or "").strip()


def _provider_sku(record: dict[str, Any]) -> dict[str, Any] | None:
    sku_id = _provider_sku_id(record)
    if not sku_id:
        return None
    prepaid = record.get("prepaidUnits") or record.get("PrepaidUnits") or {}
    purchased = record.get("prepaid_units")
    if purchased is None:
        purchased = record.get("total_units", record.get("enabled_units"))
    if purchased is None and isinstance(prepaid, dict):
        purchased = prepaid.get("enabled")
    consumed = record.get("consumedUnits", record.get("ConsumedUnits", record.get("consumed_units", 0)))
    return {
        "sku_id": sku_id,
        "sku_part_number": str(record.get("skuPartNumber") or record.get("SkuPartNumber") or record.get("sku_name") or record.get("display_name") or sku_id).strip(),
        "purchased": _number(purchased),
        "consumed": _number(consumed),
        "available": max(0, _number(purchased) - _number(consumed)),
        "observed_at": record.get("observed_at") or record.get("updated_at") or record.get("synced_at"),
    }


def _mapped_inclusion(record: dict[str, Any]) -> dict[str, Any] | None:
    sku_id = str(record.get("m365_sku_id") or "").strip()
    if not sku_id or not _is_active(record):
        return None
    return {
        "line_item_id": str(record.get("id") or "").strip(),
        "contract_id": str(record.get("contract_id") or "").strip(),
        "recurring_invoice_id": str(record.get("linked_recurring_invoice_id") or record.get("recurring_invoice_id") or "").strip(),
        "sku_id": sku_id,
        "sku_part_number": str(record.get("m365_sku_part_number") or "").strip(),
        "name": str(record.get("name") or "Microsoft 365 billing inclusion").strip(),
        "quantity": _number(record.get("quantity", 0)),
        "updated_at": record.get("m365_mapping_updated_at") or record.get("updated_at") or record.get("created_at"),
    }


def _recurring_line_ids(recurring_invoices: Iterable[dict[str, Any]]) -> set[str]:
    """Return contract line-item IDs represented by current recurring lines.

    ``source_line_item_id`` is the stable Nexus relationship intentionally
    propagated by contract-to-recurring synchronisation. It proves a billed
    inclusion without relying on the text of a recurring line.
    """
    result: set[str] = set()
    for invoice in recurring_invoices:
        if not _is_active(invoice):
            continue
        for line in invoice.get("line_items") or []:
            line_id = str(line.get("source_line_item_id") or "").strip()
            if line_id:
                result.add(line_id)
    return result


def build_m365_billing_assurance(
    client: dict[str, Any],
    *,
    provider_licenses: Iterable[dict[str, Any]] = (),
    billing_inclusions: Iterable[dict[str, Any]] = (),
    recurring_invoices: Iterable[dict[str, Any]] = (),
    provider_error: str | None = None,
    hygiene: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build one client-safe commercial assurance result.

    Matching provider SKU and Nexus contract line identities are mandatory. A
    recurring invoice line must also retain that contract line ID before Nexus
    calls an inclusion billed. This preserves uncertainty instead of creating a
    fabricated revenue or leakage claim.
    """
    provider_by_sku = {
        item["sku_id"]: item
        for record in provider_licenses
        if (item := _provider_sku(record)) is not None
    }
    inclusions = [
        item
        for record in billing_inclusions
        if (item := _mapped_inclusion(record)) is not None
    ]
    recurring_line_item_ids = _recurring_line_ids(recurring_invoices)
    inclusions_by_sku: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for inclusion in inclusions:
        inclusions_by_sku[inclusion["sku_id"]].append(inclusion)

    findings: list[dict[str, Any]] = []
    comparisons: list[dict[str, Any]] = []
    verified_mappings = 0

    for sku_id, provider in provider_by_sku.items():
        mapped = inclusions_by_sku.get(sku_id, [])
        if not mapped:
            findings.append({
                "key": f"provider_sku_unmapped:{sku_id}",
                "severity": "warning",
                "title": f"{provider['sku_part_number']} has no Nexus billing inclusion mapping",
                "detail": "Provider capacity is visible, but Nexus cannot prove which customer service or recurring charge owns it. This is a review finding, not a billing change instruction.",
                "route": "/contracts",
                "action": "map_billing_inclusion",
                "sku_id": sku_id,
            })
            comparisons.append({
                **provider,
                "billed": None,
                "mapping_state": "unmapped",
                "inclusions": [],
            })
            continue

        synced = [item for item in mapped if item["line_item_id"] in recurring_line_item_ids]
        unsynced = [item for item in mapped if item["line_item_id"] not in recurring_line_item_ids]
        billed = sum(item["quantity"] for item in synced)
        mapped_quantity = sum(item["quantity"] for item in mapped)
        comparison = {
            **provider,
            "billed": billed if synced else None,
            "mapped_quantity": mapped_quantity,
            "mapping_state": "reconciled",
            "inclusions": mapped,
        }
        if unsynced:
            findings.append({
                "key": f"mapping_not_synced:{sku_id}",
                "severity": "warning",
                "title": f"{provider['sku_part_number']} mapping is not present on a current recurring invoice",
                "detail": "The contract inclusion is mapped, but the linked recurring invoice has not been synchronised with that stable line-item mapping.",
                "route": "/contracts",
                "action": "sync_contract_recurring",
                "sku_id": sku_id,
            })
            comparison["mapping_state"] = "mapped_not_billed"
        if synced and billed != provider["purchased"]:
            findings.append({
                "key": f"quantity_mismatch:{sku_id}",
                "severity": "high",
                "title": f"{provider['sku_part_number']} purchased and billed quantities differ",
                "detail": f"Provider evidence shows {provider['purchased']} purchased seat(s); current recurring inclusions total {billed} seat(s). Review the customer agreement before changing either record.",
                "route": "/services-subscriptions?view=attention",
                "action": "review_quantity_mismatch",
                "sku_id": sku_id,
            })
            comparison["mapping_state"] = "quantity_mismatch"
        elif not unsynced:
            verified_mappings += 1
        comparisons.append(comparison)

    for sku_id, mapped in inclusions_by_sku.items():
        if sku_id in provider_by_sku:
            continue
        first = mapped[0]
        findings.append({
            "key": f"mapped_sku_not_observed:{sku_id}",
            "severity": "warning",
            "title": f"{first['sku_part_number'] or first['name']} is mapped but not present in current provider evidence",
            "detail": "Nexus retains the billing mapping but cannot currently verify the SKU in the Microsoft provider response.",
            "route": "/control-plane?module=microsoft365&view=connections",
            "action": "review_provider_evidence",
            "sku_id": sku_id,
        })

    if provider_error:
        findings.append({
            "key": "provider_evidence_unavailable",
            "severity": "info",
            "title": "Microsoft SKU evidence could not be refreshed",
            "detail": provider_error[:180],
            "route": "/control-plane?module=microsoft365&view=connections",
            "action": "review_connection",
        })

    commercial_state = "not_assessed"
    commercial_detail = "No current provider SKU evidence is available for this tenant."
    if provider_by_sku and not inclusions:
        commercial_state = "needs_attention"
        commercial_detail = "Provider SKU evidence exists, but no contract billing inclusion is explicitly mapped to it."
    elif provider_by_sku and findings:
        commercial_state = "needs_attention"
        commercial_detail = f"{len(findings)} commercial evidence finding(s) require review; Nexus has not changed billing or licence capacity."
    elif provider_by_sku:
        commercial_state = "verified"
        commercial_detail = f"{verified_mappings} provider SKU mapping(s) reconcile through stable contract and recurring billing line identities."
    elif inclusions:
        commercial_state = "needs_attention"
        commercial_detail = "Contract billing mappings exist, but current Microsoft provider SKU evidence is unavailable."

    checks = [{
        "key": "licence_to_service",
        "label": "Licence-to-service reconciliation",
        "state": commercial_state,
        "detail": commercial_detail,
        "source": "Microsoft provider SKU evidence, Nexus contract inclusions and recurring billing",
    }]

    identity_check = {
        "key": "identity_licence_coverage",
        "label": "Active-user licence evidence",
        "state": "not_assessed",
        "detail": "No current Microsoft user evidence is available to compare with commercial records.",
        "source": "Nexus 365 Hygiene",
    }
    counts = (hygiene or {}).get("counts") or {}
    breakdown = (hygiene or {}).get("breakdown") or {}
    licence_dimension = breakdown.get("license_efficiency") or {}
    if (hygiene or {}).get("evidence_state") == "evidence_available" and licence_dimension.get("status") == "assessed":
        unlicensed = _number(counts.get("unlicensed_active"))
        if unlicensed:
            identity_check.update({
                "state": "needs_attention",
                "detail": f"Microsoft evidence shows {unlicensed} active user(s) without an assigned licence. This is an identity finding, not a billing change instruction.",
            })
            findings.append({
                "key": "active_users_unlicensed",
                "severity": "high",
                "title": f"{unlicensed} active Microsoft user(s) lack an assigned licence",
                "detail": "Review the user lifecycle and approved customer service before assigning or billing a licence.",
                "route": "/control-plane?module=microsoft365&view=actions",
                "action": "review_identity_coverage",
            })
        else:
            identity_check.update({
                "state": "verified",
                "detail": "Current Microsoft user evidence shows no active user without an assigned licence.",
            })
    checks.append(identity_check)

    verified = sum(check["state"] == "verified" for check in checks)
    attention = sum(check["state"] == "needs_attention" for check in checks)
    gaps = sum(check["state"] == "not_assessed" for check in checks)
    return {
        "client_id": str(client.get("id") or ""),
        "client_name": client.get("name") or "Unnamed client",
        "tenant_id": client.get("cipp_tenant_id") or None,
        "checks": checks,
        "findings": findings,
        "comparisons": comparisons,
        "summary": {
            "state": "needs_attention" if attention else "evidence_incomplete" if gaps else "assured",
            "verified_controls": verified,
            "needs_attention": attention,
            "evidence_gaps": gaps,
            "provider_skus": len(provider_by_sku),
            "mapped_inclusions": len(inclusions),
            "reconciled_skus": verified_mappings,
        },
    }
