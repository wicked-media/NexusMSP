"""Evidence-first Microsoft 365 standards and drift evaluation.

The baseline in this module is deliberately small and explicit. It is not a
claim that a tenant is certified or comprehensively protected. A control is
only conforming when the required evidence is present and meets the declared
threshold; otherwise it is drift or not assessed.
"""

from __future__ import annotations

from typing import Any


STANDARD_PROFILE = {
    "id": "nexus-m365-core-v1",
    "name": "Nexus Microsoft 365 Core",
    "version": 1,
    "boundary": "A practical identity baseline. It is not a compliance certification and does not replace tenant-specific policy approval.",
}


def _control(
    key: str,
    label: str,
    status: str,
    expected: str,
    observed: str,
    detail: str,
    severity: str | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "status": status,
        "expected": expected,
        "observed": observed,
        "detail": detail,
        "severity": severity,
    }


def _assessed(hygiene: dict[str, Any], key: str) -> bool:
    return (hygiene.get("breakdown") or {}).get(key, {}).get("status") == "assessed"


def build_tenant_standards(client: dict[str, Any], hygiene: dict[str, Any] | None = None) -> dict[str, Any]:
    """Evaluate a tenant against the Nexus M365 core standard.

    Client-to-tenant relationships remain authoritative on ``clients`` and the
    hygiene record is provider-derived evidence. This function does not persist
    a second standard state or trigger remediation.
    """
    tenant_id = str(client.get("cipp_tenant_id") or "")
    if not hygiene:
        controls = [
            _control(
                "evidence",
                "Microsoft identity evidence",
                "not_assessed",
                "Current tenant hygiene evidence",
                "No retained evidence",
                "Refresh a mapped tenant's Microsoft evidence before evaluating the standard.",
            )
        ]
    else:
        counts = hygiene.get("counts") or {}
        mfa_pct = counts.get("mfa_coverage_pct")
        global_admins = counts.get("global_admins")
        unlicensed = counts.get("unlicensed_active")
        stale_users = counts.get("stale_users")
        has_mfa_policy = counts.get("has_mfa_policy")

        controls = [
            _control(
                "mfa_coverage", "MFA coverage", "not_assessed" if not _assessed(hygiene, "mfa_coverage") else "conforming" if (mfa_pct or 0) >= 95 else "drift",
                "At least 95% of observed active users registered", "Not available" if mfa_pct is None else f"{mfa_pct}% observed coverage",
                "MFA evidence is unavailable." if not _assessed(hygiene, "mfa_coverage") else "Observed MFA coverage meets the declared baseline." if (mfa_pct or 0) >= 95 else "Review unenrolled users before making a tenant-wide claim.",
                "high",
            ),
            _control(
                "mfa_conditional_access", "MFA Conditional Access", "not_assessed" if not _assessed(hygiene, "modern_auth") else "conforming" if has_mfa_policy else "drift",
                "At least one observed MFA Conditional Access policy", "Not available" if not _assessed(hygiene, "modern_auth") else "Observed MFA policy" if has_mfa_policy else "No observed MFA policy",
                "Conditional Access evidence is unavailable." if not _assessed(hygiene, "modern_auth") else "An MFA policy is visible in provider evidence." if has_mfa_policy else "Validate policy scope and create an approved change plan; Nexus will not enable a policy automatically.",
                "critical",
            ),
            _control(
                "privileged_roles", "Privileged account count", "not_assessed" if not _assessed(hygiene, "admin_sprawl") else "conforming" if global_admins is not None and 1 <= global_admins <= 4 else "drift",
                "One to four observed Global Administrators", "Not available" if global_admins is None else f"{global_admins} observed Global Administrator(s)",
                "Privileged-role evidence is unavailable." if not _assessed(hygiene, "admin_sprawl") else "Observed privileged account count is within the baseline." if global_admins is not None and 1 <= global_admins <= 4 else "Review privileged access and recovery ownership before changing role assignments.",
                "high",
            ),
            _control(
                "licence_assignment", "Active-user licence assignment", "not_assessed" if not _assessed(hygiene, "license_efficiency") else "conforming" if (unlicensed or 0) == 0 else "drift",
                "No observed active users without a licence", "Not available" if unlicensed is None else f"{unlicensed} observed active user(s) without a licence",
                "Licence assignment evidence is unavailable." if not _assessed(hygiene, "license_efficiency") else "Observed active users have a licence." if (unlicensed or 0) == 0 else "Review identity, service entitlement and billing before assigning licences.",
                "medium",
            ),
            _control(
                "inactive_accounts", "Inactive-account review", "not_assessed" if not _assessed(hygiene, "stale_users") else "conforming" if (stale_users or 0) == 0 else "drift",
                "No observed inactive user older than 90 days", "Not available" if stale_users is None else f"{stale_users} observed stale user(s)",
                "Sign-in evidence is unavailable." if not _assessed(hygiene, "stale_users") else "No stale observed accounts require review." if (stale_users or 0) == 0 else "Review ownership and business need before disabling or removing an account.",
                "medium",
            ),
        ]

    findings = [
        {
            "key": f"{control['key']}:drift",
            "title": f"{control['label']} differs from the declared baseline",
            "detail": control["detail"],
            "severity": control.get("severity") or "medium",
            "route": "/control-plane?module=microsoft365&view=security",
        }
        for control in controls if control["status"] == "drift"
    ]
    conforming = sum(control["status"] == "conforming" for control in controls)
    drift = sum(control["status"] == "drift" for control in controls)
    unknown = sum(control["status"] == "not_assessed" for control in controls)
    return {
        "profile": STANDARD_PROFILE,
        "client_id": client.get("id"),
        "client_name": client.get("name") or "Unnamed client",
        "tenant_id": tenant_id or None,
        "tenant_display": client.get("cipp_tenant_display") or client.get("name") or "Unmapped client",
        "controls": controls,
        "findings": findings,
        "summary": {
            "conforming": conforming,
            "drift": drift,
            "evidence_gaps": unknown,
            "state": "drift_detected" if drift else "evidence_incomplete" if unknown else "conforming",
        },
        "hygiene_evidence_state": (hygiene or {}).get("evidence_state", "not_assessed"),
    }
