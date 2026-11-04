"""Evidence-safe projections for the Microsoft Studio command centre.

This module intentionally contains no Microsoft Graph calls, credentials or
write operations.  The router supplies already scoped, provider-recorded
documents and this module makes the distinction between an observed zero and
an unreported dimension explicit for the UI.
"""

from __future__ import annotations

from typing import Any


def _number(value: Any) -> float | int | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def build_overview(
    *,
    tenants: list[dict],
    stream_evidence: dict[str, dict],
    explicit_no_mfa_users: int,
    risky_signins: int,
    gdap_expiring: int,
    generated_at: str,
) -> dict:
    """Build a transparent Microsoft Studio overview from verified evidence.

    ``stream_evidence`` deliberately contains source counts and the latest
    source timestamp rather than invented boolean health values. A stream with
    no records is shown as unavailable;
    it is never rendered as a zero-risk conclusion.
    """
    numeric_users = [_number(row.get("users_count")) for row in tenants]
    numeric_users = [value for value in numeric_users if value is not None]
    numeric_mfa = [_number(row.get("mfa_enrolled_pct")) for row in tenants]
    numeric_mfa = [value for value in numeric_mfa if value is not None]
    numeric_score = [_number(row.get("secure_score")) for row in tenants]
    numeric_score = [value for value in numeric_score if value is not None]

    streams = []
    for stream_id, label in (
        ("identity", "Identity"),
        ("exchange", "Exchange"),
        ("intune", "Intune"),
        ("collaboration", "Collaboration"),
        ("security", "Security"),
    ):
        evidence = stream_evidence.get(stream_id, {})
        records = int(evidence.get("records") or 0)
        streams.append({
            "id": stream_id,
            "label": label,
            "evidence_state": "observed" if records else "not_reported",
            "records": records,
            "latest_observed_at": evidence.get("latest_observed_at"),
        })

    attention = []
    if int((stream_evidence.get("identity") or {}).get("records") or 0):
        attention.append({
            "id": "identities-without-mfa",
            "kind": "identity",
            "severity": "high" if explicit_no_mfa_users else "info",
            "subject": "Users explicitly recorded without MFA",
            "detail": f"{explicit_no_mfa_users} active user(s) have provider-recorded MFA disabled.",
            "count": explicit_no_mfa_users,
        })
    if int((stream_evidence.get("security") or {}).get("records") or 0):
        attention.append({
            "id": "risky-signins-30d",
            "kind": "security",
            "severity": "high" if risky_signins else "info",
            "subject": "Risky sign-ins recorded in the last 30 days",
            "detail": f"{risky_signins} provider-recorded risky sign-in indicator(s).",
            "count": risky_signins,
        })
    if gdap_expiring or int((stream_evidence.get("identity") or {}).get("records") or 0):
        attention.append({
            "id": "gdap-expiring-30d",
            "kind": "access",
            "severity": "medium" if gdap_expiring else "info",
            "subject": "GDAP relationships expiring within 30 days",
            "detail": f"{gdap_expiring} provider-recorded relationship(s) require review.",
            "count": gdap_expiring,
        })

    return {
        "generated_at": generated_at,
        "telemetry_available": bool(tenants),
        "summary": {
            "tenants": len(tenants),
            "reported_users": int(sum(numeric_users)) if numeric_users else None,
            "tenants_reporting_users": len(numeric_users),
            "average_mfa_pct": round(sum(numeric_mfa) / len(numeric_mfa), 1) if numeric_mfa else None,
            "tenants_reporting_mfa": len(numeric_mfa),
            "average_secure_score": round(sum(numeric_score) / len(numeric_score), 1) if numeric_score else None,
            "tenants_reporting_secure_score": len(numeric_score),
        },
        "streams": streams,
        "attention": attention,
        "tenants": [
            {
                "id": row.get("id") or row.get("tenant_id"),
                "tenant_id": row.get("tenant_id") or row.get("id"),
                "name": row.get("name") or row.get("tenant_name"),
                "default_domain": row.get("default_domain") or row.get("domain"),
                "users_count": row.get("users_count"),
                "mfa_enrolled_pct": row.get("mfa_enrolled_pct"),
                "secure_score": row.get("secure_score"),
                "observed_at": row.get("observed_at") or row.get("updated_at") or row.get("synced_at"),
            }
            for row in tenants
        ],
        "boundary": (
            "Read-only projection of provider-recorded Microsoft evidence. Missing values mean not "
            "reported; tenant changes, remediation and credential operations stay in separately "
            "governed, approval-aware workflows."
        ),
    }
