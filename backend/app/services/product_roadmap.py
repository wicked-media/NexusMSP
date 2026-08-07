"""Versioned NexusMSP product roadmap and release-gate contract.

The roadmap is intentionally part of the existing Nexus Foundation rather
than another workspace. Status describes the product release boundary, while
the evidence block reports live platform facts. A non-zero count is useful
evidence, but never promotes a capability to Released automatically.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any


ROADMAP_VERSION = 1
ROADMAP_STATUSES = ("planned", "in_progress", "testing", "released")

ROADMAP_COLUMNS = (
    {
        "id": "planned",
        "label": "Planned",
        "description": "Approved scope with a defined dependency and release gate.",
    },
    {
        "id": "in_progress",
        "label": "In progress",
        "description": "Foundation or product work is actively being hardened.",
    },
    {
        "id": "testing",
        "label": "Testing",
        "description": "The integrated workflow exists and is collecting release evidence.",
    },
    {
        "id": "released",
        "label": "Released",
        "description": "The baseline workflow is usable; normal hardening still continues.",
    },
)

ROADMAP_ITEMS = (
    {
        "id": "identity",
        "name": "Identity",
        "status": "planned",
        "phase": 1,
        "owner": "Platform Identity",
        "priority": "highest",
        "summary": "One technician identity, role, client/site scope and session-revocation contract.",
        "depends_on": ["core-platform"],
        "release_gate": "Passkeys or Entra SSO, tenant-safe sessions and automated cross-client isolation tests.",
        "route": "/team-hub?view=matrix",
    },
    {
        "id": "compliance",
        "name": "Compliance",
        "status": "planned",
        "phase": 7,
        "owner": "Security Platform",
        "priority": "later",
        "summary": "Framework evidence generated from canonical client, identity, endpoint and change data.",
        "depends_on": ["core-platform", "agent", "documentation"],
        "release_gate": "Evidence provenance, framework mappings, exceptions and signed report verification.",
        "route": "/compliance",
    },
    {
        "id": "maps",
        "name": "Maps",
        "status": "planned",
        "phase": 7,
        "owner": "Nexus Intelligence",
        "priority": "later",
        "summary": "Relationship and topology views built from Nexus Core rather than a second inventory.",
        "depends_on": ["core-platform", "agent"],
        "release_gate": "Stable discovery, client-scoped topology and verified change history.",
        "route": "/networking",
    },
    {
        "id": "core-platform",
        "name": "Nexus Platform",
        "status": "in_progress",
        "phase": 1,
        "owner": "Nexus Core",
        "priority": "highest",
        "summary": "Canonical relationships, permissions, events, audit, metering and integration contracts.",
        "depends_on": [],
        "release_gate": "Every v1 domain uses canonical references and passes tenant-isolation and event-replay tests.",
        "route": "/control-plane?module=foundation",
    },
    {
        "id": "agent",
        "name": "Nexus Agent",
        "status": "in_progress",
        "phase": 2,
        "owner": "Endpoint Platform",
        "priority": "highest",
        "summary": "Trusted endpoint identity, inventory, commands, policy cache, updates and self-repair.",
        "depends_on": ["core-platform", "identity"],
        "release_gate": "mTLS device identity, signed staged updates, rollback, offline policy and recovery tests.",
        "route": "/devices",
    },
    {
        "id": "automation",
        "name": "Automation",
        "status": "in_progress",
        "phase": 3,
        "owner": "Automation Platform",
        "priority": "highest",
        "summary": "Triggers, conditions, approvals, durable waits, actions, compensation and audit.",
        "depends_on": ["core-platform"],
        "release_gate": "Restart-safe workers, idempotent actions, approvals and tested compensation paths.",
        "route": "/automation-hub",
    },
    {
        "id": "microsoft",
        "name": "Microsoft Control",
        "status": "in_progress",
        "phase": 5,
        "owner": "Cloud Operations",
        "priority": "high",
        "summary": "Multi-tenant Microsoft lifecycle, Exchange, Intune, security and licensing operations.",
        "depends_on": ["core-platform", "identity", "automation"],
        "release_gate": "Partner tenant discovery, client mapping, least-privilege actions and rollback evidence.",
        "route": "/control-plane?module=microsoft365&view=connections",
    },
    {
        "id": "billing",
        "name": "Billing",
        "status": "testing",
        "phase": 6,
        "owner": "Commercial Platform",
        "priority": "high",
        "summary": "Source-of-truth quantities reconciled to contracts, invoices and accounting providers.",
        "depends_on": ["core-platform", "automation"],
        "release_gate": "Idempotent reconciliation, approval thresholds, Xero verification and exception recovery.",
        "route": "/billing-recon",
    },
    {
        "id": "remote",
        "name": "Remote",
        "status": "testing",
        "phase": 4,
        "owner": "Nexus Remote",
        "priority": "high",
        "summary": "Native RustDesk sessions with authorization, ticket linkage, time and retained evidence.",
        "depends_on": ["agent", "identity"],
        "release_gate": "Consent, session lifecycle, technician authorization, recording policy and repair tests.",
        "route": "/remote-access",
    },
    {
        "id": "ai",
        "name": "AI",
        "status": "testing",
        "phase": 7,
        "owner": "Nexus Intelligence",
        "priority": "after-v1-core",
        "summary": "Permission-controlled reasoning over canonical Nexus data and governed tools.",
        "depends_on": ["core-platform", "automation", "documentation"],
        "release_gate": "Tenant-safe retrieval, tool permissions, confirmation boundaries and evaluation suite.",
        "route": "/auto-ops",
    },
    {
        "id": "reporting",
        "name": "Reporting",
        "status": "testing",
        "phase": 6,
        "owner": "Data Platform",
        "priority": "high",
        "summary": "Professional, branded operational and compliance reporting from governed evidence.",
        "depends_on": ["core-platform", "billing", "documentation"],
        "release_gate": "Verified report data, consistent PDF rendering, access controls and scheduled-delivery audit.",
        "route": "/reports",
    },
    {
        "id": "ticketing",
        "name": "Ticketing",
        "status": "released",
        "phase": 1,
        "owner": "Service Desk",
        "priority": "released-baseline",
        "summary": "SLA, workshop and cabling service records with communication, assets, billing and audit.",
        "depends_on": ["core-platform"],
        "release_gate": "Released baseline; continue convergence on canonical IDs and shared workflow components.",
        "route": "/tickets",
    },
    {
        "id": "documentation",
        "name": "Documentation",
        "status": "released",
        "phase": 1,
        "owner": "Knowledge Platform",
        "priority": "released-baseline",
        "summary": "Rich knowledge, client documentation, auto-docs and technician help content.",
        "depends_on": ["core-platform"],
        "release_gate": "Released baseline; continue client-link coverage and auto-document provenance.",
        "route": "/documentation-hub",
    },
    {
        "id": "client-portal",
        "name": "Client Portal",
        "status": "released",
        "phase": 1,
        "owner": "Client Experience",
        "priority": "released-baseline",
        "summary": "Customer-facing service, approvals, invoices, devices and knowledge experience.",
        "depends_on": ["core-platform", "ticketing"],
        "release_gate": "Released baseline; continue accessibility, tenant isolation and end-to-end correspondence tests.",
        "route": "/portal-dashboard",
    },
)


def build_product_roadmap(evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return the versioned roadmap enriched with current operational evidence."""

    evidence = evidence or {}
    counts = Counter(item["status"] for item in ROADMAP_ITEMS)
    items = []
    for item in ROADMAP_ITEMS:
        item_evidence = evidence.get(item["id"]) or {}
        items.append({
            **item,
            "evidence": {
                "summary": str(item_evidence.get("summary") or "No live evidence was supplied."),
                "facts": item_evidence.get("facts") or {},
                "verified": bool(item_evidence.get("verified", False)),
            },
        })

    return {
        "name": "NexusMSP v1.0 foundation roadmap",
        "version": ROADMAP_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "columns": list(ROADMAP_COLUMNS),
        "items": items,
        "summary": {
            "total": len(items),
            **{status: counts[status] for status in ROADMAP_STATUSES},
        },
        "policy": [
            "No major standalone module enters active development until its declared foundation dependencies are usable.",
            "Live evidence informs a release decision but never promotes an item automatically.",
            "Released means the baseline workflow is usable; it does not mean hardening and regression testing stop.",
            "Every v1 capability must use Nexus Core identity, events, permissions and audit contracts.",
        ],
    }

