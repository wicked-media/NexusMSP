"""Read-only Service Gap reconciliation over existing authoritative records.

Service Gap is a projection, not a commercial system of record.  Contract line
items remain the agreement, ``core_services`` remain the observed provisioned
service inventory, and recurring-invoice line items remain billing evidence.
The evaluator only joins rows that carry an explicit stable service identifier.
It deliberately never joins by a display name, nor changes any source record.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable, Mapping

GAP_KINDS: tuple[str, ...] = (
    "under_delivery", "under_billing", "over_billing", "unverified_delivery",
)

BOUNDARY = (
    "Read-only reconciliation over contract line items, core service inventory and recurring "
    "invoice lines. Rows join only through an explicit stable service identifier; missing or "
    "unmapped evidence is unverified, never a billing mutation or a confirmed failure."
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _quantity(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _service_key(row: Mapping[str, Any]) -> str:
    """Return an explicit stable service relationship key, never a display name."""
    for field in ("service_id", "service_key", "product_id"):
        value = _text(row.get(field))
        if value:
            return value
    return ""


def _normalise(rows: Iterable[Mapping[str, Any]], source: str) -> tuple[dict[tuple[str, str], float], list[dict[str, str]]]:
    totals: dict[tuple[str, str], float] = defaultdict(float)
    unmapped: list[dict[str, str]] = []
    for row in rows:
        client_id = _text(row.get("client_id"))
        key = _service_key(row)
        quantity = _quantity(row.get("quantity"))
        if not client_id or not key or quantity is None:
            unmapped.append({
                "source": source,
                "record_id": _text(row.get("id")),
                "client_id": client_id,
                "reason": (
                    "Missing client_id, explicit service identifier or non-negative quantity; "
                    "Nexus did not infer a relationship from a display name."
                ),
            })
            continue
        totals[(client_id, key)] += quantity
    return dict(totals), unmapped


def _row(client_id: str, service_key: str, contracted: float | None, provisioned: float | None,
         billed: float | None) -> dict[str, Any]:
    values = {"contracted": contracted, "provisioned": provisioned, "billed": billed}
    missing = [name for name, value in values.items() if value is None]
    if missing:
        return {
            "client_id": client_id,
            "service_key": service_key,
            **values,
            "state": "unverified_delivery",
            "reason": f"Missing {', '.join(missing)} evidence; Nexus cannot classify delivery or billing conclusively.",
        }

    # All three evidence sources are present. A single service can have several
    # mismatches, but the output retains each one so the technician does not lose
    # a commercial discrepancy behind a delivery discrepancy.
    gaps: list[dict[str, str]] = []
    if provisioned < contracted:
        gaps.append({"kind": "under_delivery", "reason": "Provisioned quantity is lower than the contracted quantity."})
    if billed < contracted:
        gaps.append({"kind": "under_billing", "reason": "Billed quantity is lower than the contracted quantity."})
    if billed > provisioned:
        gaps.append({"kind": "over_billing", "reason": "Billed quantity is higher than the observed provisioned quantity."})
    return {
        "client_id": client_id,
        "service_key": service_key,
        **values,
        "state": "matched" if not gaps else gaps[0]["kind"],
        "reason": "Contract, delivery and billing quantities agree." if not gaps else gaps[0]["reason"],
        "gaps": gaps,
    }

def reconcile(
    contracted: Iterable[Mapping[str, Any]],
    provisioned: Iterable[Mapping[str, Any]],
    billed: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Reconcile explicit service identifiers into disclosed service-gap findings."""
    contract_totals, contract_unmapped = _normalise(contracted, "contract")
    provisioned_totals, provisioned_unmapped = _normalise(provisioned, "provisioned")
    billed_totals, billed_unmapped = _normalise(billed, "billing")
    keys = sorted(set(contract_totals) | set(provisioned_totals) | set(billed_totals))
    rows = [
        _row(client_id, key, contract_totals.get((client_id, key)),
             provisioned_totals.get((client_id, key)), billed_totals.get((client_id, key)))
        for client_id, key in keys
    ]
    findings = [row for row in rows if row["state"] != "matched"]
    counts = {kind: 0 for kind in GAP_KINDS}
    for row in findings:
        if row["state"] == "unverified_delivery":
            counts["unverified_delivery"] += 1
        else:
            for gap in row.get("gaps") or []:
                counts[gap["kind"]] += 1
    unmapped = contract_unmapped + provisioned_unmapped + billed_unmapped
    return {
        "rows": rows,
        "findings": findings,
        "summary": {
            "services_evaluated": len(rows),
            "matched": len(rows) - len(findings),
            **counts,
            "unmapped_records": len(unmapped),
        },
        "unmapped": unmapped,
        "boundary": BOUNDARY,
    }

