"""Evidence-backed resilience view for Nexus Shield XDR.

This module correlates records Nexus already owns.  It deliberately keeps
"not assessed" separate from a healthy result: lack of connector evidence is
never converted into a perfect security score.
"""

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable


OPEN_STATES = {"", "active", "alert", "detected", "failed", "investigating", "new", "open", "pending", "unresolved"}
SEVERITY_WEIGHT = {"critical": 30, "high": 18, "medium": 9, "low": 3}


def _normal(value: Any) -> str:
    return str(value or "").strip().lower()


def _open(record: dict[str, Any]) -> bool:
    if record.get("resolved") is True or record.get("acknowledged") is True:
        return False
    return _normal(record.get("status")) in OPEN_STATES


def _severity(record: dict[str, Any]) -> str:
    value = _normal(record.get("severity") or record.get("risk_level") or record.get("priority"))
    return value if value in SEVERITY_WEIGHT else "medium"


def _score_ratio(good: int, checked: int) -> int | None:
    return round(good / checked * 100) if checked else None


def _domain(
    key: str,
    label: str,
    score: int | None,
    evidence: str,
    route: str,
    *,
    observed: int = 0,
    gaps: int = 0,
    coverage: int = 0,
) -> dict[str, Any]:
    normalized_coverage = max(0, min(100, int(coverage or 0)))
    return {
        "key": key,
        "label": label,
        "score": score,
        "status": "assessed" if score is not None else "not_assessed",
        "evidence": evidence,
        "observed": observed,
        "gaps": gaps,
        "coverage": normalized_coverage,
        "assurance_score": round(score * normalized_coverage / 100) if score is not None else None,
        "route": route,
    }


def _signal(record: dict[str, Any], category: str, source: str, route: str) -> dict[str, Any]:
    subject = (
        record.get("user_email") or record.get("upn") or record.get("user")
        or record.get("device_name") or record.get("hostname") or record.get("device_id")
        or record.get("domain") or "environment"
    )
    return {
        "id": str(record.get("id") or record.get("alert_id") or f"{source}:{subject}"),
        "category": category,
        "source": source,
        "title": str(record.get("title") or record.get("name") or record.get("reason") or f"{category.title()} security signal"),
        "detail": str(record.get("description") or record.get("summary") or record.get("reason") or "Persisted Nexus security evidence"),
        "severity": _severity(record),
        "client_id": str(record.get("client_id") or ""),
        "client_name": str(record.get("client_name") or record.get("organization") or "Unassigned client"),
        "subject": str(subject),
        "observed_at": record.get("created_at") or record.get("detected_at") or record.get("triggered_at") or record.get("updated_at"),
        "route": route,
    }


def _correlate(signals: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for signal in signals:
        client = signal.get("client_id") or signal.get("client_name") or "unassigned"
        subject = _normal(signal.get("subject")) or signal.get("id")
        groups[(str(client), subject)].append(signal)

    incidents: list[dict[str, Any]] = []
    for (client_key, subject), evidence in groups.items():
        evidence.sort(key=lambda row: str(row.get("observed_at") or ""), reverse=True)
        categories = sorted({row["category"] for row in evidence})
        highest = min((_severity(row) for row in evidence), key=lambda value: {"critical": 0, "high": 1, "medium": 2, "low": 3}[value])
        correlated = len(evidence) > 1 and len(categories) > 1
        incidents.append({
            "id": f"xdr:{client_key}:{subject}",
            "title": f"{evidence[0]['subject']} · {len(evidence)} observed signal{'s' if len(evidence) != 1 else ''}",
            "client_id": evidence[0].get("client_id"),
            "client_name": evidence[0].get("client_name"),
            "subject": evidence[0].get("subject"),
            "severity": highest,
            "categories": categories,
            "signal_count": len(evidence),
            "correlated": correlated,
            "summary": (
                f"Nexus linked {len(evidence)} persisted signals across {len(categories)} security domains."
                if correlated else "A persisted security signal requires technician validation."
            ),
            "evidence": evidence[:12],
            "suggested_actions": [
                "Validate the identity, endpoint and client relationship",
                "Preserve evidence before containment",
                "Use an approval-gated response playbook",
                "Record the decision and customer communication",
            ],
            "requires_approval": True,
            "latest_observed_at": evidence[0].get("observed_at"),
        })
    incidents.sort(key=lambda row: ({"critical": 0, "high": 1, "medium": 2, "low": 3}[row["severity"]], -row["signal_count"]))
    return incidents


def build_xdr_overview(
    *,
    devices: list[dict[str, Any]],
    m365_users: list[dict[str, Any]],
    m365_tenants: list[dict[str, Any]],
    security_alerts: list[dict[str, Any]],
    identity_threats: list[dict[str, Any]],
    dns_domains: list[dict[str, Any]],
    dns_alerts: list[dict[str, Any]],
    backup_jobs: list[dict[str, Any]],
    vulnerabilities: list[dict[str, Any]],
    canary_triggers: list[dict[str, Any]],
) -> dict[str, Any]:
    assessed = [row for row in devices if row.get("security_assessed_at")]
    endpoint_coverage = round(len(assessed) / len(devices) * 100) if devices else 0
    endpoint_checks = len(assessed) * 4
    endpoint_good = sum(
        int(row.get("antivirus_status") == "active" and bool(row.get("defender_real_time_enabled")))
        + int(bool(row.get("firewall_enabled")))
        + int(any(marker in _normal(row.get("encryption_status")) for marker in ("encrypted", "bitlocker on", "protection on")))
        + int(int(row.get("pending_patches") or 0) <= 10)
        for row in assessed
    )

    enabled_users = [row for row in m365_users if row.get("account_enabled") is not False]
    identity_coverage = 100 if enabled_users else 0
    mfa_users = [row for row in enabled_users if row.get("mfa_enforced") is True or row.get("mfa_enabled") is True]
    risky_users = [row for row in enabled_users if row.get("risky_signin_30d") is True]
    identity_score = _score_ratio(len(mfa_users), len(enabled_users))
    if identity_score is not None:
        identity_score = max(0, identity_score - min(30, len(risky_users) * 5))

    secure_scores = [float(row["secure_score"]) for row in m365_tenants if isinstance(row.get("secure_score"), (int, float))]
    cloud_coverage = round(len(secure_scores) / len(m365_tenants) * 100) if m365_tenants else 0
    cloud_score = round(sum(secure_scores) / len(secure_scores)) if secure_scores else None

    open_dns = [row for row in dns_alerts if _open(row)]
    dns_score = max(0, 100 - sum(SEVERITY_WEIGHT[_severity(row)] for row in open_dns)) if dns_domains else None

    known_backups = [row for row in backup_jobs if _normal(row.get("status"))]
    recovery_coverage = round(len(known_backups) / len(backup_jobs) * 100) if backup_jobs else 0
    healthy_backups = [row for row in known_backups if _normal(row.get("status")) in {"completed", "healthy", "ok", "passed", "success", "successful"}]
    recovery_score = _score_ratio(len(healthy_backups), len(known_backups))

    open_security = [row for row in security_alerts if _open(row)]
    email_alerts = [row for row in open_security if _normal(row.get("category")) in {"email", "exchange", "phishing", "bec"} or any(term in _normal(row.get("title")) for term in ("mail", "phish", "forward", "inbox"))]
    email_score = max(0, 100 - sum(SEVERITY_WEIGHT[_severity(row)] for row in email_alerts)) if email_alerts else None

    open_identity = [row for row in identity_threats if _open(row)]
    human_score = identity_score
    if human_score is not None:
        human_score = max(0, human_score - min(30, sum(SEVERITY_WEIGHT[_severity(row)] for row in open_identity)))

    domains = [
        _domain("endpoint", "Endpoints", _score_ratio(endpoint_good, endpoint_checks), f"{len(assessed)} of {len(devices)} endpoints have agent-verified security posture.", "/nexus-shield?tab=endpoints", observed=len(assessed), gaps=max(0, len(devices) - len(assessed)) + max(0, endpoint_checks - endpoint_good), coverage=endpoint_coverage),
        _domain("identity", "Identity", identity_score, f"{len(mfa_users)} of {len(enabled_users)} verified Microsoft users have MFA evidence; {len(risky_users)} risky sign-ins recorded.", "/control-plane?module=microsoft365", observed=len(enabled_users), gaps=max(0, len(enabled_users) - len(mfa_users)) + len(risky_users), coverage=identity_coverage),
        _domain("email", "Email", email_score, f"{len(email_alerts)} open persisted email-security signals. A protection connector is required before absence of alerts can be scored.", "/email", observed=len(email_alerts), gaps=len(email_alerts)),
        _domain("cloud", "Cloud", cloud_score, f"{len(secure_scores)} verified Microsoft tenant Secure Score values are available.", "/control-plane?module=microsoft365", observed=len(secure_scores), coverage=cloud_coverage),
        _domain("human", "Human risk", human_score, f"MFA and {len(open_identity)} open identity-threat records contribute to this score.", "/identity-threats", observed=len(enabled_users) + len(open_identity), gaps=max(0, len(enabled_users) - len(mfa_users)) + len(open_identity), coverage=identity_coverage),
        _domain("dns", "DNS", dns_score, f"{len(dns_domains)} monitored domains and {len(open_dns)} unacknowledged alerts are recorded.", "/dns-monitor", observed=len(dns_domains), gaps=len(open_dns), coverage=100 if dns_domains else 0),
        _domain("recovery", "Recovery", recovery_score, f"{len(healthy_backups)} of {len(known_backups)} backup jobs report a successful state.", "/backup-center", observed=len(known_backups), gaps=max(0, len(known_backups) - len(healthy_backups)), coverage=recovery_coverage),
    ]
    assessed_domains = [row for row in domains if row["score"] is not None]
    observed_score = round(sum(row["score"] for row in assessed_domains) / len(assessed_domains)) if assessed_domains else None
    evidence_coverage = round(sum(row["coverage"] for row in domains) / len(domains))
    overall = round(sum((row["score"] or 0) * row["coverage"] / 100 for row in domains) / len(domains)) if assessed_domains else None

    signals: list[dict[str, Any]] = []
    signals.extend(_signal(row, "identity", "Identity provider", "/identity-threats") for row in open_identity)
    signals.extend(_signal(row, "email" if row in email_alerts else "security", str(row.get("source") or row.get("provider") or "Security provider"), "/security-dashboard") for row in open_security)
    signals.extend(_signal(row, "dns", "Nexus DNS", "/dns-monitor") for row in open_dns)
    signals.extend(_signal(row, "endpoint", "Nexus Canary", "/nexus-shield?tab=canary") for row in canary_triggers if _open(row))
    signals.extend(_signal(row, "vulnerability", str(row.get("source") or "Vulnerability provider"), "/vulnerability-scanner") for row in vulnerabilities if _open(row))
    incidents = _correlate(signals)
    timeline = sorted(
        signals,
        key=lambda row: str(row.get("observed_at") or ""),
        reverse=True,
    )[:100]

    missions: list[dict[str, Any]] = []
    if len(assessed) < len(devices):
        missions.append({"id": "endpoint-evidence", "title": "Complete endpoint security assessments", "detail": f"{len(devices) - len(assessed)} managed endpoints have no current Shield posture evidence.", "impact": "Increase endpoint confidence", "severity": "high", "route": "/nexus-shield?tab=endpoints", "response_pack": ["Identify unmanaged or stale endpoints", "Request or restore Nexus Agent check-in", "Validate Defender, firewall, encryption and patch evidence", "Record coverage change and customer impact"]})
    if enabled_users and len(mfa_users) < len(enabled_users):
        missions.append({"id": "mfa-coverage", "title": "Raise verified MFA coverage", "detail": f"{len(enabled_users) - len(mfa_users)} enabled Microsoft users lack MFA evidence.", "impact": "Reduce identity takeover exposure", "severity": "critical" if not mfa_users else "high", "route": "/control-plane?module=microsoft365", "response_pack": ["Confirm the client and affected identity scope", "Review Conditional Access and MFA registration evidence", "Plan user-safe enrollment and recovery steps", "Capture approval, completion and residual risk"]})
    if open_dns:
        missions.append({"id": "dns-review", "title": "Resolve DNS security signals", "detail": f"{len(open_dns)} DNS alerts are unacknowledged.", "impact": "Improve DNS confidence", "severity": "high", "route": "/dns-monitor", "response_pack": ["Validate the destination, user and endpoint relationship", "Preserve DNS evidence before changing enforcement", "Apply the approved allow, block or containment action", "Record validation and customer communication"]})
    failed_backups = len(known_backups) - len(healthy_backups)
    if failed_backups:
        missions.append({"id": "recovery-health", "title": "Restore recovery confidence", "detail": f"{failed_backups} backup jobs do not report a successful state.", "impact": "Protect recoverability", "severity": "critical", "route": "/backup-center", "response_pack": ["Validate the failed job and protected workload", "Preserve provider error evidence", "Run the approved recovery playbook", "Schedule or record a restore verification"]})
    if incidents:
        missions.append({"id": "incident-triage", "title": "Triage correlated security cases", "detail": f"{len(incidents)} evidence-backed cases require technician validation.", "impact": "Reduce response uncertainty", "severity": incidents[0]["severity"], "route": "/nexus-shield?tab=xdr", "response_pack": ["Validate the client, subject and evidence correlation", "Open an accountable investigation", "Approve containment only after evidence review", "Record recovery outcome and customer communication"]})

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "confidence": {
            "score": overall,
            "observed_score": observed_score,
            "label": "Not assessed" if overall is None else "Strong" if overall >= 90 else "Good" if overall >= 75 else "Needs attention" if overall >= 50 else "Low",
            "evidence_coverage": evidence_coverage,
            "assessed_domains": len(assessed_domains),
            "total_domains": len(domains),
            "domains": domains,
            "explanation": "Assurance is coverage-adjusted so a strong result from a small evidence sample cannot overstate protection. Observed health remains available for the assessed surface.",
        },
        "incidents": incidents[:50],
        "timeline": timeline,
        "missions": missions[:20],
        "graph": {
            "paths": sum(1 for incident in incidents if incident["correlated"]),
            "subjects": len({incident["subject"] for incident in incidents}),
            "clients": len({incident["client_id"] or incident["client_name"] for incident in incidents}),
            "route": "/security-graph",
            "evidence_note": "Relationships are created only from persisted client, user, endpoint and provider identifiers.",
        },
    }
