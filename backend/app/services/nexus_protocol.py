"""Nexus Protocol: the standard objects, standard actions and certification layer.

This module is the executable half of ``docs/NEXUS_PROTOCOL.md``. Third-party
technology that speaks the protocol becomes compatible with Nexus automation,
billing, Guardian, Proof, Graph and AI — because those systems all consume the
same canonical objects, the same ten actions and the same action descriptor.

Honesty rules enforced here:

- conformance verdicts are ``verified`` / ``partial`` / ``unverified`` — a
  capability is ``verified`` only when live adapter wiring (or recorded
  evidence) proves it; planned capabilities score ``partial`` at best;
- no bundled adapter claims ``nexus_native`` unless all eight certification
  dimensions are proven — the checklist is published, the gaps are published;
- ``validate_action_descriptor`` is the P0 #1 canonical action contract:
  destructive actions require rollback, autonomy ``act`` requires a
  verification plan (P0 #6), and every action carries actor, target and scope.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.services import nexus_connector
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

PROTOCOL_VERSION = "0.1-draft"

FRESHNESS_FIELDS = ("observed_at", "source", "confidence")

ACTOR_KINDS = ("technician", "automation", "agent", "system")
AUTONOMY_LEVELS = ("observe", "suggest", "act_with_verification", "act")

# ============== STANDARD OBJECTS ==============

PROTOCOL_OBJECTS: dict[str, dict] = {
    "device": {"stable_id": "device_id", "core_fields": ["hostname", "client_id", "site_id", "os", "state"], "authoritative_store": "devices"},
    "user": {"stable_id": "user_id", "core_fields": ["name", "email", "client_id", "roles", "status"], "authoritative_store": "users"},
    "identity": {"stable_id": "identity_id", "core_fields": ["principal", "provider", "subject_ref", "mfa_state"], "authoritative_store": "users / M365 records"},
    "service": {"stable_id": "service_id", "core_fields": ["name", "client_id", "sla", "state"], "authoritative_store": "contracts / services"},
    "application": {"stable_id": "application_id", "core_fields": ["name", "version", "device_id", "state"], "authoritative_store": "applications"},
    "incident": {"stable_id": "ticket_id", "core_fields": ["title", "severity", "state", "client_id"], "authoritative_store": "tickets"},
    "risk": {"stable_id": "risk_id", "core_fields": ["statement", "severity", "owner", "review_due"], "authoritative_store": "risk_acceptances"},
    "control": {"stable_id": "control_id", "core_fields": ["kind", "scope", "intent_id", "verdict"], "authoritative_store": "nexus_intents / laws"},
    "licence": {"stable_id": "licence_id", "core_fields": ["product", "seats", "assigned", "renewal"], "authoritative_store": "licence records"},
    "subscription": {"stable_id": "subscription_id", "core_fields": ["product", "quantity", "term", "meter"], "authoritative_store": "agreements / usage_meter_events"},
    "contract": {"stable_id": "contract_id", "core_fields": ["client_id", "terms", "promises", "renewal"], "authoritative_store": "contracts"},
    "invoice": {"stable_id": "invoice_id", "core_fields": ["client_id", "amount", "state", "period"], "authoritative_store": "invoices"},
    "evidence": {"stable_id": "evidence_id", "core_fields": ["claim", "verdict", "freshness", "responsible"], "authoritative_store": "evidence / verify records"},
    "change": {"stable_id": "change_id", "core_fields": ["target", "plan", "state", "approval"], "authoritative_store": "change_management"},
    "backup": {"stable_id": "backup_id", "core_fields": ["source", "job", "restore_verified_at"], "authoritative_store": "backup_jobs / device_events"},
    "network": {"stable_id": "network_id", "core_fields": ["site_id", "segment", "dependencies"], "authoritative_store": "core_relationships edges"},
    "vendor": {"stable_id": "vendor_id", "core_fields": ["name", "adapters", "agreements"], "authoritative_store": "integrations / procurement"},
}

# ============== STANDARD ACTIONS ==============

PROTOCOL_ACTIONS: dict[str, dict] = {
    "observe": {"meaning": "read state into Nexus with provenance", "mutates": False, "requires_verification": False, "platform_home": "insight layer, telemetry", "status": "shipped"},
    "diagnose": {"meaning": "explain state and probable cause", "mutates": False, "requires_verification": False, "platform_home": "certainty layer", "status": "shipped"},
    "deploy": {"meaning": "provision new capability", "mutates": True, "requires_verification": True, "platform_home": "connector plans (plan, not execution)", "status": "partial"},
    "configure": {"meaning": "change settings toward intent", "mutates": True, "requires_verification": True, "platform_home": "Intent OS", "status": "partial"},
    "isolate": {"meaning": "restrict blast radius", "mutates": True, "requires_verification": True, "platform_home": "Guardian, connector verbs", "status": "partial"},
    "restore": {"meaning": "recover to a known state", "mutates": True, "requires_verification": True, "platform_home": "backup, Prove It", "status": "partial"},
    "verify": {"meaning": "gather evidence of a claim", "mutates": False, "requires_verification": False, "platform_home": "nexus_verify_execution, Prove It", "status": "shipped"},
    "bill": {"meaning": "record commercial consequence", "mutates": True, "requires_verification": True, "platform_home": "nexus_ledger", "status": "shipped"},
    "approve": {"meaning": "record human authority", "mutates": True, "requires_verification": True, "platform_home": "decision objects (P0 #7)", "status": "partial"},
    "rollback": {"meaning": "reverse a prior action", "mutates": True, "requires_verification": True, "platform_home": "autonomy contract (P0 #6)", "status": "partial"},
}

# ============== NEXUS NATIVE CERTIFICATION ==============

CERTIFICATION_DIMENSIONS: dict[str, dict] = {
    "provisioning": {"proven_by": "wired deploy capability + verified provisioning evidence", "checklist": ["provisioning API wired", "post-provision verification", "failure surfaces honestly"]},
    "telemetry": {"proven_by": "wired observe capability with freshness metadata", "checklist": ["state observation wired", "observed_at/source/confidence present"]},
    "billing": {"proven_by": "meter events or ledger entries attributable to the vendor", "checklist": ["entitlement movement or usage metering", "attributable to adapter"]},
    "health": {"proven_by": "honest health signals, never fabricated status", "checklist": ["health/recoverability verification wired", "no fabricated green"]},
    "remediation": {"proven_by": "wired configure/restore capability with verification", "checklist": ["remediation verb wired", "post-action verification", "rollback documented"]},
    "uninstall": {"proven_by": "documented, reversible removal path", "checklist": ["removal capability declared", "data/teardown consequences documented"]},
    "audit": {"proven_by": "attributable action records (actor, target, outcome)", "checklist": ["actions recorded with actor", "target identified by Nexus ID"]},
    "evidence": {"proven_by": "claims renderable from the evidence store", "checklist": ["verification verb wired", "claims carry freshness triple"]},
}

_DIMENSION_PROBES: dict[str, dict] = {
    "provisioning": {"verified_verbs": {"identity.user.provision", "license.assign", "email.security.enable"}, "partial_verbs": set()},
    "telemetry": {"verified_verbs": {"endpoint.audit"}, "partial_verbs": set()},
    "billing": {"verified_verbs": {"license.assign", "license.reclaim"}, "partial_verbs": {"ticket.create"}},
    "health": {"verified_verbs": {"backup.verify", "endpoint.audit"}, "partial_verbs": set()},
    "remediation": {"verified_verbs": {"endpoint.patch", "backup.restore", "network.dns.record_set", "network.firewall.block", "email.security.enable"}, "partial_verbs": set()},
    "uninstall": {"verified_verbs": set(), "partial_verbs": set()},  # no bundled verb proves uninstall yet — always honest
    "audit": {"verified_verbs": {"endpoint.audit", "ticket.create"}, "partial_verbs": set()},
    "evidence": {"verified_verbs": {"backup.verify"}, "partial_verbs": {"endpoint.audit"}},
}

_VERDICT_RANK = {"verified": 2, "partial": 1, "unverified": 0}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def protocol_manifest() -> dict:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "objects": sorted(PROTOCOL_OBJECTS),
        "actions": sorted(PROTOCOL_ACTIONS),
        "certification_dimensions": sorted(CERTIFICATION_DIMENSIONS),
        "freshness_fields": list(FRESHNESS_FIELDS),
        "spec": "docs/NEXUS_PROTOCOL.md",
    }


def list_objects() -> dict:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "objects": [
            {"kind": kind, "stable_id": spec["stable_id"], "core_fields": spec["core_fields"],
             "authoritative_store": spec["authoritative_store"]}
            for kind, spec in sorted(PROTOCOL_OBJECTS.items())
        ],
    }


def list_actions() -> dict:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "actions": [
            {"action": action, "meaning": spec["meaning"], "mutates": spec["mutates"],
             "requires_verification": spec["requires_verification"],
             "platform_home": spec["platform_home"], "status": spec["status"]}
            for action, spec in sorted(PROTOCOL_ACTIONS.items())
        ],
    }


def platform_coverage() -> dict:
    """Honest per-action coverage of the protocol by the platform itself."""
    rows = [
        {"action": action, "status": spec["status"], "platform_home": spec["platform_home"],
         "note": "shipped" if spec["status"] == "shipped" else "partial — wired but not yet a full verified execution path"}
        for action, spec in sorted(PROTOCOL_ACTIONS.items())
    ]
    return {
        "protocol_version": PROTOCOL_VERSION,
        "coverage": rows,
        "actions_shipped": sum(1 for row in rows if row["status"] == "shipped"),
        "actions_partial": sum(1 for row in rows if row["status"] == "partial"),
        "generated_at": _iso(_utcnow()),
    }


# ============== CANONICAL ACTION DESCRIPTOR (P0 #1) ==============


def validate_action_descriptor(descriptor: Any) -> dict:
    """Validate one proposed action against the canonical action contract."""
    problems: list[str] = []
    if not isinstance(descriptor, dict):
        return {"valid": False, "problems": ["descriptor must be an object"], "descriptor": None}

    action = str(descriptor.get("action") or "").strip()
    if action not in PROTOCOL_ACTIONS:
        problems.append(f"action must be one of: {', '.join(sorted(PROTOCOL_ACTIONS))}")

    actor = descriptor.get("actor") if isinstance(descriptor.get("actor"), dict) else {}
    if not str(actor.get("id") or "").strip():
        problems.append("actor.id is required (every action is attributable)")
    if str(actor.get("kind") or "") not in ACTOR_KINDS:
        problems.append(f"actor.kind must be one of: {', '.join(ACTOR_KINDS)}")

    target = descriptor.get("target") if isinstance(descriptor.get("target"), dict) else {}
    if str(target.get("kind") or "") not in PROTOCOL_OBJECTS:
        problems.append(f"target.kind must be a protocol object: {', '.join(sorted(PROTOCOL_OBJECTS))}")
    if not str(target.get("nexus_id") or "").strip():
        problems.append("target.nexus_id is required (stable Nexus ID, never a name)")

    scope = descriptor.get("scope") if isinstance(descriptor.get("scope"), dict) else {}
    if not str(scope.get("tenant_id") or "").strip():
        problems.append("scope.tenant_id is required (every action is tenant-scoped)")

    destructive = descriptor.get("destructive")
    if not isinstance(destructive, bool):
        problems.append("destructive must be an explicit boolean")
        destructive = False
    reversible = bool(descriptor.get("reversible"))
    rollback = descriptor.get("rollback") if isinstance(descriptor.get("rollback"), dict) else {}
    if destructive and not reversible:
        problems.append("destructive actions must declare themselves reversible or be rejected")
    if destructive and not str(rollback.get("plan") or "").strip():
        problems.append("destructive actions require a rollback plan")

    autonomy = str(descriptor.get("autonomy_level") or "").strip()
    if autonomy not in AUTONOMY_LEVELS:
        problems.append(f"autonomy_level must be one of: {', '.join(AUTONOMY_LEVELS)}")
    verification_plan = str(descriptor.get("verification_plan") or "").strip()
    if autonomy in ("act", "act_with_verification") and not verification_plan:
        problems.append("autonomy above suggest requires a verification plan (unverified outcomes are never claimed)")

    return {
        "valid": not problems,
        "problems": problems,
        "protocol_version": PROTOCOL_VERSION,
        "descriptor": {**descriptor, "action": action} if action else None,
        "checked_at": _iso(_utcnow()),
    }


# ============== NEXUS NATIVE CONFORMANCE ==============


def _dimension_verdict(caps: dict, dimension: str, evidence_counts: dict | None) -> tuple[str, list[str]]:
    probe = _DIMENSION_PROBES[dimension]
    proof: list[str] = []
    verified_hits = [verb for verb in sorted(probe["verified_verbs"]) if caps.get(verb) == "wired"]
    if verified_hits:
        proof = [f"{verb}:wired" for verb in verified_hits]
        return "verified", proof
    if evidence_counts:
        if dimension in ("billing", "evidence", "uninstall") and int(evidence_counts.get(dimension, 0) or 0) > 0:
            return "verified", [f"recorded {dimension} evidence: {int(evidence_counts[dimension])}"]
    planned_hits = [verb for verb in sorted(probe["verified_verbs"]) if caps.get(verb) == "planned"]
    partial_hits = [verb for verb in sorted(probe["partial_verbs"]) if caps.get(verb) == "wired"]
    if planned_hits:
        return "partial", [f"{verb}:planned" for verb in planned_hits]
    if partial_hits:
        return "partial", [f"{verb}:wired (indirect)" for verb in partial_hits]
    return "unverified", ["no capability or evidence proves this dimension"]


def _level_for(verdicts: dict[str, str]) -> str:
    counts = {name: sum(1 for verdict in verdicts.values() if verdict == name) for name in _VERDICT_RANK}
    if counts["verified"] == len(CERTIFICATION_DIMENSIONS):
        return "nexus_native"
    if counts["verified"] >= 4:
        return "nexus_ready"
    if counts["verified"] + counts["partial"] >= 1:
        return "partial"
    return "unknown"


def evaluate_conformance(adapter_row: dict, evidence_counts: dict | None = None) -> dict:
    """Conformance of one adapter, proven from its capability wiring and evidence.

    Never upgrades a verdict beyond what the evidence shows.
    """
    caps = adapter_row.get("capabilities") or {}
    dimensions: dict[str, dict] = {}
    verdicts: dict[str, str] = {}
    for dimension in sorted(CERTIFICATION_DIMENSIONS):
        verdict, proof = _dimension_verdict(caps, dimension, evidence_counts)
        verdicts[dimension] = verdict
        dimensions[dimension] = {"verdict": verdict, "proof": proof}
    level = _level_for(verdicts)
    return {
        "adapter": adapter_row.get("adapter"),
        "vendor": adapter_row.get("vendor"),
        "level": level,
        "nexus_native": level == "nexus_native",
        "dimensions": dimensions,
        "counts": {
            "verified": sum(1 for verdict in verdicts.values() if verdict == "verified"),
            "partial": sum(1 for verdict in verdicts.values() if verdict == "partial"),
            "unverified": sum(1 for verdict in verdicts.values() if verdict == "unverified"),
        },
        "honesty_note": (
            "no adapter is Nexus Native until all eight dimensions are proven; "
            "gaps are published, never hidden"
        ),
        "checked_at": _iso(_utcnow()),
    }


def certification_checklist() -> dict:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "levels": ["nexus_native", "nexus_ready", "partial", "unknown"],
        "dimensions": [
            {"dimension": dimension, "proven_by": spec["proven_by"], "checklist": spec["checklist"]}
            for dimension, spec in sorted(CERTIFICATION_DIMENSIONS.items())
        ],
    }


async def conformance_board(db: Any, user: dict, adapter: str | None = None, evidence_counts: dict | None = None) -> dict:
    """Conformance matrix over the adapter registry, plus recorded reviews."""
    rows = nexus_connector.list_adapters().get("adapters") or []
    wanted = (adapter or "").strip()
    if wanted:
        rows = [row for row in rows if str(row.get("adapter")) == wanted]
        if not rows:
            return {"found": False, "error": f"unknown adapter '{wanted}'"}
    board = []
    for row in rows:
        entry = evaluate_conformance(row, evidence_counts)
        reviews = await list_reviews(db, user, str(row.get("adapter")))
        entry["latest_review"] = (reviews.get("reviews") or [None])[0]
        board.append(entry)
    return {
        "found": True,
        "protocol_version": PROTOCOL_VERSION,
        "adapters": board,
        "count": len(board),
        "generated_at": _iso(_utcnow()),
    }


# ============== CERTIFICATION REVIEWS (evidence-backed records) ==============


async def record_review(db: Any, user: dict, actor_name: str, payload: dict) -> dict:
    """Record one certification review — a human decision with evidence references."""
    adapter = str(payload.get("adapter") or "").strip()
    known = {str(row.get("adapter")) for row in nexus_connector.list_adapters().get("adapters") or []}
    if not adapter:
        return {"found": False, "error": "adapter is required"}
    if adapter not in known:
        return {"found": False, "error": f"unknown adapter '{adapter}'"}
    decision = str(payload.get("decision") or "").strip()
    if decision not in ("certified", "conditional", "declared", "rejected"):
        return {"found": False, "error": "decision must be certified, conditional, declared or rejected"}
    basis = str(payload.get("basis") or "review").strip()
    if basis not in ("evidence", "declaration", "review"):
        return {"found": False, "error": "basis must be evidence, declaration or review"}
    if decision == "certified" and basis == "declaration":
        return {"found": False, "error": "certification requires evidence or review — declarations are never certified"}

    document = {
        "id": f"NPR-{uuid.uuid4().hex[:10]}",
        "tenant_id": platform_tenant_id(user),
        "adapter": adapter,
        "decision": decision,
        "basis": basis,
        "note": str(payload.get("note") or "").strip()[:2000],
        "evidence_refs": [str(ref)[:120] for ref in (payload.get("evidence_refs") or [])[:20]],
        "reviewed_by": str(actor_name or "").strip()[:120] or "unknown",
        "reviewed_at": _iso(_utcnow()),
    }
    await db.nexus_protocol_reviews.insert_one(document)
    return {"found": True, "review": {key: value for key, value in document.items() if key != "_id"}}


async def list_reviews(db: Any, user: dict, adapter: str | None = None) -> dict:
    query: dict = {"adapter": adapter} if adapter else {}
    rows = await db.nexus_protocol_reviews.find(tenant_scoped_query(user, query), {"_id": 0}).to_list(200)
    rows.sort(key=lambda row: str(row.get("reviewed_at") or ""), reverse=True)
    return {"reviews": rows, "count": len(rows)}
