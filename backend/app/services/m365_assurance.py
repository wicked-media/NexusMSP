"""Evidence-first Microsoft 365 assurance summaries.

This service deliberately distinguishes verified controls from unknowns. It
does not infer that a tenant is protected merely because an integration is
connected or a score exists.
"""

from __future__ import annotations

from typing import Any


def _check(key: str, label: str, state: str, detail: str, *, source: str | None = None) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "state": state,
        "detail": detail,
        "source": source,
    }


def build_tenant_assurance(
    client: dict[str, Any],
    hygiene: dict[str, Any] | None = None,
    *,
    provider_configured: bool = False,
    billing_assurance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a truthful assurance summary for one client-linked M365 tenant.

    ``hygiene`` is a derived provider observation. Authoritative relationship
    data remains on the Nexus client record. Areas without a connected source
    intentionally remain ``not_assessed`` instead of becoming a synthetic pass.
    """
    tenant_id = str(client.get("cipp_tenant_id") or "")
    billing_check = next(
        (check for check in (billing_assurance or {}).get("checks", []) if check.get("key") == "licence_to_service"),
        None,
    )
    checks = [
        _check(
            "tenant_binding",
            "Nexus client binding",
            "verified" if tenant_id else "needs_attention",
            "Tenant is mapped to the Nexus client record." if tenant_id else "Map a Microsoft tenant before technician actions can be safely scoped.",
            source="Nexus client relationship",
        ),
        _check(
            "tenant_provider",
            "Operational Microsoft access",
            "not_assessed",
            "Provider access has not been configured." if not provider_configured else "Provider is configured, but a connection alone is not proof of tenant-specific delegated access.",
            source="Microsoft provider connection",
        ),
        _check(
            "licence_billing",
            "Licence-to-billing reconciliation",
            (billing_check or {}).get("state", "not_assessed"),
            (billing_check or {}).get("detail", "No authoritative licence-to-contract reconciliation source is connected yet."),
            source="Nexus Billing Assurance",
        ),
        _check(
            "recovery_coverage",
            "Microsoft 365 recovery coverage",
            "not_assessed",
            "No connected M365 recovery evidence has been verified for this tenant.",
            source="Nexus Backup Assurance",
        ),
    ]

    findings: list[dict[str, Any]] = []
    if not tenant_id:
        findings.append({"key": "tenant_unmapped", "severity": "high", "title": "Microsoft tenant is not mapped", "detail": "Map the tenant to a Nexus client before governed operations or assurance can be proven.", "action": "map_tenant"})

    for finding in (billing_assurance or {}).get("findings", []):
        findings.append({
            "key": f"billing:{finding.get('key', 'review')}",
            "severity": finding.get("severity") or "info",
            "title": finding.get("title") or "Microsoft 365 commercial evidence requires review",
            "detail": finding.get("detail") or "Review the linked billing and provider evidence.",
            "action": finding.get("action") or "review_billing_assurance",
            "route": finding.get("route") or "/services-subscriptions?view=attention",
        })

    if hygiene:
        coverage = hygiene.get("evidence_coverage_pct", 0)
        evidence_state = hygiene.get("evidence_state", "not_assessed")
        checks.append(_check(
            "identity_hygiene",
            "Identity and access evidence",
            "verified" if evidence_state == "evidence_available" and coverage >= 80 else "needs_attention" if coverage else "not_assessed",
            f"{coverage}% of the configured hygiene evidence is available." if coverage else "No current identity hygiene evidence is available.",
            source="Nexus 365 Hygiene",
        ))
        for risk in hygiene.get("risks") or []:
            findings.append({
                "key": f"hygiene:{risk.get('factor', 'unknown')}",
                "severity": risk.get("severity") or "info",
                "title": risk.get("factor") or "Identity hygiene requires review",
                "detail": "Derived from connected Microsoft tenant evidence; validate scope before remediation.",
                "action": "review_hygiene",
            })
    else:
        checks.append(_check("identity_hygiene", "Identity and access evidence", "not_assessed", "Collect Microsoft tenant hygiene evidence before making an assurance claim.", source="Nexus 365 Hygiene"))

    verified = sum(check["state"] == "verified" for check in checks)
    attention = sum(check["state"] == "needs_attention" for check in checks)
    gaps = sum(check["state"] == "not_assessed" for check in checks)
    return {
        "tenant_id": tenant_id or None,
        "tenant_display": client.get("cipp_tenant_display") or client.get("name") or "Unmapped client",
        "tenant_domain": client.get("cipp_tenant_domain") or None,
        "client_id": client.get("id"),
        "client_name": client.get("name") or "Unnamed client",
        "checks": checks,
        "findings": findings,
        "summary": {"verified_controls": verified, "needs_attention": attention, "evidence_gaps": gaps, "state": "attention_required" if attention else "evidence_incomplete" if gaps else "assured"},
        "hygiene": hygiene,
    }
