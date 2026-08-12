"""Production-readiness register, launch gates and validation helpers."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any


READINESS_SECTIONS = (
    {"id": "security-findings", "label": "Security findings", "description": "Threat modelling, security assurance and material findings."},
    {"id": "tenant-isolation", "label": "Tenant-isolation tests", "description": "Automated proof that tenant, client, site and object boundaries fail closed."},
    {"id": "permissions", "label": "Permissions matrix", "description": "Granular roles, restricted actions, temporary elevation and approvals."},
    {"id": "agent-security", "label": "Agent security", "description": "Endpoint identity, command authenticity, signed updates and rollback."},
    {"id": "automation-safety", "label": "Automation safety", "description": "Preview, rings, limits, maintenance windows, cancellation and compensation."},
    {"id": "backup-restoration", "label": "Backup and restoration", "description": "Encrypted backups and demonstrated isolated restoration."},
    {"id": "disaster-recovery", "label": "Disaster recovery", "description": "Tested RPO/RTO targets and recovery runbooks."},
    {"id": "observability", "label": "Observability", "description": "Actionable telemetry, correlation and on-call delivery."},
    {"id": "performance", "label": "Performance testing", "description": "Load, concurrency, queue and failure-injection evidence."},
    {"id": "billing", "label": "Billing reconciliation", "description": "Repeatable quantities, proration, idempotency and accounting reconciliation."},
    {"id": "integrations", "label": "Integration health", "description": "Provider authentication, retries, reconciliation and partial-failure handling."},
    {"id": "deployment", "label": "Deployment readiness", "description": "Reproducible builds, staged release, health gates and rollback."},
    {"id": "legal", "label": "Legal and compliance", "description": "Australian legal, privacy, licensing and data-handling readiness."},
    {"id": "pilot", "label": "Pilot feedback", "description": "Controlled MSP pilots, feedback and operational acceptance."},
    {"id": "launch-blockers", "label": "Launch blockers", "description": "Explicit unresolved conditions that prevent public production."},
)

SECTION_IDS = frozenset(item["id"] for item in READINESS_SECTIONS)
READINESS_STATUSES = frozenset({"not_started", "in_progress", "blocked", "ready", "passed", "failed", "not_applicable"})
TEST_RESULTS = frozenset({"not_run", "pass", "fail", "partial", "not_applicable"})
SEVERITIES = frozenset({"critical", "high", "medium", "low"})

PRODUCTION_GATES = (
    {"id": "tenant-isolation", "label": "Tenant isolation", "sections": ["security-findings", "tenant-isolation"], "required_evidence": "Automated isolation suite plus independent penetration test."},
    {"id": "backups", "label": "Backups", "sections": ["backup-restoration"], "required_evidence": "Successful complete restoration with validated records, attachments and secrets metadata."},
    {"id": "agent-safety", "label": "Agent and automation safety", "sections": ["agent-security", "automation-safety"], "required_evidence": "Signed commands, signed updates, expiry, replay rejection, blast-radius and rollback tests."},
    {"id": "permissions", "label": "Permissions", "sections": ["permissions"], "required_evidence": "Granular RBAC and privilege tests across technical, billing and security actions."},
    {"id": "billing", "label": "Billing", "sections": ["billing"], "required_evidence": "Repeatable calculation, reconciliation and duplicate-processing tests."},
    {"id": "reliability", "label": "Reliability", "sections": ["performance", "disaster-recovery", "integrations"], "required_evidence": "Load, connector outage and recovery simulations against declared RPO/RTO."},
    {"id": "deployment", "label": "Deployment", "sections": ["deployment"], "required_evidence": "Tested rollback from a production-like environment."},
    {"id": "monitoring", "label": "Monitoring", "sections": ["observability"], "required_evidence": "Critical alerts reach and are acknowledged by the correct on-call person."},
    {"id": "support", "label": "Support", "sections": ["disaster-recovery", "launch-blockers"], "required_evidence": "Incident and recovery runbooks exercised with retained outcomes."},
    {"id": "legal", "label": "Legal", "sections": ["legal"], "required_evidence": "Agreements, privacy documents and data obligations professionally reviewed."},
    {"id": "pilot", "label": "Pilot", "sections": ["pilot"], "required_evidence": "Several controlled MSP pilots complete agreed acceptance criteria."},
)

DEFAULT_READINESS_ITEMS = (
    {
        "id": "readiness-cross-tenant-api",
        "section": "tenant-isolation",
        "title": "Cross-tenant API and object-ownership suite",
        "owner": "Platform Security",
        "severity": "critical",
        "evidence_required": "Automated tests for URL tampering, foreign client IDs, search, exports, agents, websockets and revoked tokens.",
        "status": "in_progress",
        "target_release": "NexusMSP v1.0",
        "test_result": "partial",
        "production_blocker": True,
    },
    {
        "id": "readiness-independent-pentest",
        "section": "security-findings",
        "title": "Independent penetration test and finding closure",
        "owner": "Security Lead",
        "severity": "critical",
        "evidence_required": "Independent report, retest evidence and closure of every material finding.",
        "status": "not_started",
        "target_release": "Public production",
        "test_result": "not_run",
        "production_blocker": True,
    },
    {
        "id": "readiness-permission-matrix",
        "section": "permissions",
        "title": "Granular permission and temporary-elevation matrix",
        "owner": "Platform Identity",
        "severity": "critical",
        "evidence_required": "Role templates, custom roles, client restrictions, approvals, expiry and privilege regression tests.",
        "status": "in_progress",
        "target_release": "NexusMSP v1.0",
        "test_result": "partial",
        "production_blocker": True,
    },
    {
        "id": "readiness-agent-command-envelope",
        "section": "agent-security",
        "title": "Fail-closed signed agent command envelope",
        "owner": "Endpoint Platform",
        "severity": "critical",
        "evidence_required": "Tenant, device, authorization, signature, issue/expiry time, privilege, approval and replay rejection tests.",
        "status": "in_progress",
        "target_release": "NexusMSP v1.0",
        "test_result": "partial",
        "production_blocker": True,
    },
    {
        "id": "readiness-agent-update-rollback",
        "section": "agent-security",
        "title": "Signed agent updates and rollback",
        "owner": "Endpoint Platform",
        "severity": "critical",
        "evidence_required": "Reproducible signed build, staged update, tamper rejection, failed-update rollback and secure uninstall evidence.",
        "status": "in_progress",
        "target_release": "NexusMSP v1.0",
        "test_result": "not_run",
        "production_blocker": True,
    },
    {
        "id": "readiness-automation-blast-radius",
        "section": "automation-safety",
        "title": "Automation blast-radius and staged rollout controls",
        "owner": "Automation Platform",
        "severity": "critical",
        "evidence_required": "Dry run, test tenant, canary ring, maximum scope, approval threshold, timeout, concurrency and cancellation tests.",
        "status": "in_progress",
        "target_release": "NexusMSP v1.0",
        "test_result": "partial",
        "production_blocker": True,
    },
    {
        "id": "readiness-full-restore",
        "section": "backup-restoration",
        "title": "Complete isolated restoration exercise",
        "owner": "Infrastructure Lead",
        "severity": "critical",
        "evidence_required": "Successful restore with RPO/RTO, record counts, attachments, configuration and secrets-metadata validation.",
        "status": "not_started",
        "target_release": "NexusMSP v1.0",
        "test_result": "not_run",
        "production_blocker": True,
    },
    {
        "id": "readiness-dr-runbooks",
        "section": "disaster-recovery",
        "title": "Disaster-recovery targets and exercised runbooks",
        "owner": "Operations Lead",
        "severity": "high",
        "evidence_required": "Approved RPO/RTO plus exercises for database, region, signing key, administrator, queue and agent-update failures.",
        "status": "not_started",
        "target_release": "Controlled pilot",
        "test_result": "not_run",
        "production_blocker": True,
    },
    {
        "id": "readiness-on-call-alerts",
        "section": "observability",
        "title": "Production telemetry and on-call alert delivery",
        "owner": "Platform Operations",
        "severity": "high",
        "evidence_required": "API, login, agent, command, queue, email, billing, remote and integration alerts acknowledged by on-call.",
        "status": "in_progress",
        "target_release": "Controlled pilot",
        "test_result": "partial",
        "production_blocker": True,
    },
    {
        "id": "readiness-load-failure",
        "section": "performance",
        "title": "Load and failure-injection programme",
        "owner": "Quality Engineering",
        "severity": "high",
        "evidence_required": "Documented API, websocket, job, search and agent-command load thresholds plus dependency outage tests.",
        "status": "not_started",
        "target_release": "Controlled pilot",
        "test_result": "not_run",
        "production_blocker": True,
    },
    {
        "id": "readiness-billing-scenarios",
        "section": "billing",
        "title": "Fixed billing scenario and idempotency suite",
        "owner": "Commercial Platform",
        "severity": "critical",
        "evidence_required": "Proration, contract moves, duplicates, replayed files, credits, tax, minimums, late usage and regeneration tests.",
        "status": "in_progress",
        "target_release": "NexusMSP v1.0",
        "test_result": "partial",
        "production_blocker": True,
    },
    {
        "id": "readiness-integration-resilience",
        "section": "integrations",
        "title": "Connector resilience and reconciliation contract",
        "owner": "Integration Platform",
        "severity": "high",
        "evidence_required": "Token expiry, rate limit, duplicate, delay, pagination, retry, outage and partial-failure tests for every production connector.",
        "status": "in_progress",
        "target_release": "Controlled pilot",
        "test_result": "partial",
        "production_blocker": True,
    },
    {
        "id": "readiness-deployment-rollback",
        "section": "deployment",
        "title": "Production-like canary deployment and rollback",
        "owner": "Release Engineering",
        "severity": "critical",
        "evidence_required": "Reproducible build, migration validation, feature flag rollout, health gates and successful rollback.",
        "status": "not_started",
        "target_release": "Controlled pilot",
        "test_result": "not_run",
        "production_blocker": True,
    },
    {
        "id": "readiness-legal-review",
        "section": "legal",
        "title": "Australian legal and commercial review",
        "owner": "Business Owner",
        "severity": "high",
        "evidence_required": "Reviewed terms, privacy, data processing, AUP, SLA, liability, subprocessors, retention and licensing documents.",
        "status": "not_started",
        "target_release": "Public production",
        "test_result": "not_run",
        "production_blocker": True,
    },
    {
        "id": "readiness-pilot-acceptance",
        "section": "pilot",
        "title": "Controlled MSP pilot acceptance",
        "owner": "Product Lead",
        "severity": "high",
        "evidence_required": "Named pilot MSPs, acceptance criteria, observed operations, support outcomes and signed feedback review.",
        "status": "not_started",
        "target_release": "Public production",
        "test_result": "not_run",
        "production_blocker": True,
    },
    {
        "id": "readiness-public-launch",
        "section": "launch-blockers",
        "title": "Public production launch decision",
        "owner": "Product and Security Leads",
        "severity": "critical",
        "evidence_required": "Every production gate passed, blocker register empty and accountable launch approval retained.",
        "status": "blocked",
        "target_release": "Public production",
        "test_result": "not_run",
        "production_blocker": True,
    },
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalise_readiness_payload(payload: dict[str, Any], *, partial: bool = False) -> dict[str, Any]:
    """Validate and normalise one readiness item create/update payload."""

    allowed = {
        "section", "title", "owner", "severity", "evidence_required",
        "status", "target_release", "test_result", "production_blocker",
        "review_note", "evidence_reference",
    }
    data = {key: payload.get(key) for key in allowed if key in payload}

    if not partial or "section" in data:
        section = str(data.get("section") or "").strip()
        if section not in SECTION_IDS:
            raise ValueError("Select a valid production-readiness section")
        data["section"] = section
    if not partial or "title" in data:
        title = str(data.get("title") or "").strip()
        if len(title) < 5:
            raise ValueError("Readiness item title must be at least 5 characters")
        data["title"] = title[:180]
    if not partial or "owner" in data:
        owner = str(data.get("owner") or "").strip()
        if len(owner) < 2:
            raise ValueError("An accountable owner is required")
        data["owner"] = owner[:120]
    if not partial or "severity" in data:
        severity = str(data.get("severity") or "medium").strip().lower()
        if severity not in SEVERITIES:
            raise ValueError("Select a valid severity")
        data["severity"] = severity
    if not partial or "status" in data:
        status = str(data.get("status") or "not_started").strip().lower()
        if status not in READINESS_STATUSES:
            raise ValueError("Select a valid readiness status")
        data["status"] = status
    if not partial or "test_result" in data:
        result = str(data.get("test_result") or "not_run").strip().lower()
        if result not in TEST_RESULTS:
            raise ValueError("Select a valid test result")
        data["test_result"] = result

    # A launch control must never show a green status against failed or missing
    # test evidence.  The UI deliberately shows status and test outcome side by
    # side, so reject contradictory combinations at the service boundary too.
    # Partial updates are validated against the existing record by the router.
    # Validate here only when both sides of the relationship are present.
    if not partial or {"status", "test_result"}.issubset(data):
        effective_status = data.get("status")
        effective_result = data.get("test_result")
        if effective_status == "passed" and effective_result not in {"pass", "not_applicable"}:
            raise ValueError("A passed readiness control requires a passing or not-applicable test result")
        if effective_status == "not_applicable" and effective_result not in {"not_applicable", None}:
            raise ValueError("A not-applicable readiness control requires a not-applicable test result")
    for field in ("evidence_required", "target_release", "review_note", "evidence_reference"):
        if field in data:
            data[field] = str(data.get(field) or "").strip()[:2000]
    if not partial and len(data.get("evidence_required") or "") < 8:
        raise ValueError("Describe the evidence required to close this item")
    if "production_blocker" in data:
        data["production_blocker"] = bool(data["production_blocker"])
    return data


def summarise_readiness(items: list[dict[str, Any]]) -> dict[str, Any]:
    status_counts = Counter(str(item.get("status") or "not_started") for item in items)
    test_counts = Counter(str(item.get("test_result") or "not_run") for item in items)
    open_blockers = [
        item for item in items
        if item.get("production_blocker")
        and item.get("status") not in {"passed", "ready", "not_applicable"}
    ]
    failed_tests = [item for item in items if item.get("test_result") == "fail" or item.get("status") == "failed"]

    gates = []
    for gate in PRODUCTION_GATES:
        related = [item for item in items if item.get("section") in gate["sections"]]
        passed = [
            item for item in related
            if item.get("status") in {"passed", "ready", "not_applicable"}
            and item.get("test_result") in {"pass", "not_applicable"}
        ]
        if related and len(passed) == len(related):
            status = "passed"
        elif any(item.get("status") in {"blocked", "failed"} or item.get("test_result") == "fail" for item in related):
            status = "blocked"
        else:
            status = "open"
        gates.append({
            **gate,
            "status": status,
            "item_count": len(related),
            "passed_items": len(passed),
            "total": len(related),
            "passed": len(passed),
            "open_blockers": sum(
                1 for item in related
                if item.get("production_blocker")
                and item.get("status") not in {"passed", "ready", "not_applicable"}
            ),
        })

    passed_gates = sum(1 for gate in gates if gate["status"] == "passed")
    return {
        "items": len(items),
        "open_blockers": len(open_blockers),
        "failed_tests": len(failed_tests),
        "passed_gates": passed_gates,
        "total_gates": len(gates),
        "launch_decision": "hold" if open_blockers else ("candidate" if passed_gates == len(gates) else "pilot_only"),
        "status_counts": dict(status_counts),
        "test_counts": dict(test_counts),
        "gates": gates,
    }
