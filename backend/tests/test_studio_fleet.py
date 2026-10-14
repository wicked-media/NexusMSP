"""Studio fleet contract tests.

The fleet is the plan made durable: these tests pin that every studio in the
plan exists, that each one exposes the full shared spine, that statuses and tab
states stay inside the register vocabulary, and that admission-gate evidence
matches the declared status — so a studio can never claim readiness it has not
been admitted for.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

try:
    from fastapi.routing import _IncludedRouter
except ImportError:  # pragma: no cover - depends on the pinned FastAPI version
    # This FastAPI keeps no include wrapper: an included router's operations are
    # appended to ``app.routes`` as plain ``APIRoute`` objects. Nothing can ever
    # be an instance of the placeholder below, so the walks in this module scan
    # that flat list directly instead of failing to import at all — the route
    # collision and ownership guards must be able to run on every supported
    # version, and a private symbol is not a contract they may depend on.
    class _IncludedRouter:  # noqa: N801 - mirrors the name of the FastAPI symbol
        """Stands in for a wrapper this FastAPI version does not create."""

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

import server  # noqa: E402
from app.auth import get_current_user  # noqa: E402
from app.routers import studio_fleet  # noqa: E402
from app.services import studio_proposals  # noqa: E402
from app.services import studio_registry  # noqa: E402
from app.services.platform_foundation import EVENT_SUBJECTS  # noqa: E402

# The plan's studios, pinned so a future edit that quietly drops one fails here.
PLANNED_STUDIO_IDS = {
    "web", "client", "lead", "remote", "proxmox", "m365", "voice", "telecom",
    "devices", "network", "identity", "security", "backup", "cloud",
    "service-desk", "finance", "documentation", "automation", "compliance",
    "agent", "patch", "dns", "monitoring", "communications",
    # The three foundations (docs/NEXUS_FOUNDATIONS_BATCH_4.md).
    "customer-environment", "operations-assurance", "extension",
    # Batch 5 studios admitted once the fleet-baseline gate was cleared.
    "windows", "endpoint-performance",
}

USER = {"id": "admin-1", "name": "Ada Admin", "role": "admin", "is_admin": True}

# Every idea proposed in batches 2-5, pinned so nothing can be dropped from the
# catalogue by the consolidation that is supposed to record it. Each id is either
# a record in studio_proposals.PROPOSALS or a concept absorbed by a record's
# ``covers``, and the two sets are checked to be disjoint: one idea, one record.
BATCH_4_CATALOGUE = {
    # 81-90, specialist administration.
    "firewall", "directory", "file-services", "collaboration", "browser",
    "software-deployment", "remote-workforce", "certificate-trust", "time-sync",
    "licensing-compliance",
    # 91-100, advanced MSP operations.
    "problem-management", "service-catalogue", "customer-environment",
    "service-activation", "service-cancellation", "escalation", "maintenance",
    "capacity-planning", "customer-communication", "operations-assurance",
    # 101-105, platform capabilities.
    "decision", "runbook", "lab", "trust", "extension",
}

BATCH_5_CATALOGUE = {
    "apple", "linux", "windows", "browser-management", "endpoint-performance",
    "peripheral", "update-compatibility", "connectivity-diagnostics",
    "storage-recovery", "authentication", "sla", "dispatch", "observability",
    "quoting", "stockroom", "subscription", "customer-profitability",
    "sales-engineering", "customer-roadmap", "partner", "devops",
    "application-runtime", "data-pipeline", "release", "marketplace-operations",
}

BATCH_3_CATALOGUE = {
    "undo-everything", "preflight", "last-known-human", "technician-radar",
    "safe-experiment", "permission-microscope", "application-black-box",
    "smart-maintenance-window", "technician-sandbox", "error-translator",
    "live-runbook", "handover-simulator", "recovery-confidence-map",
    "mission-mode", "port-historian", "certificate-detective",
    "dns-propagation-lab", "login-journey-recorder", "print-path-visualiser",
    "update-compatibility-gate", "hardware-swap-assistant",
    "temporary-access-expiry", "change-witness", "vendor-escalation-tracker",
    "forge", "tool-evolution", "repair-exchange", "zero-friction-workspace",
    "instant-lab",
}

BATCH_2_CATALOGUE = {
    # The two that shipped and the three strongest candidates.
    "dead-end-detector", "support-debt", "reality-replay", "missing-technician",
    "operational-antibodies",
    # The other inventions, by the row they were recorded in.
    "fix-fallout", "repair-side-effect-map", "ticket-collision-detector",
    "work-collision-forecast",
    "customer-memory-shield", "customer-frustration-prevention",
    "the-customer-who-never-calls", "zero-question-support",
    "technician-second-brain", "the-technician-who-never-has-to-ask-twice",
    "escalation-quality-gate", "support-passport", "escalation-packet",
    "false-fix-detector", "fix-expiry", "diagnostic-replay", "known-good-library",
    "maintenance-debt",
    "reboot-negotiator", "service-dependency-doctor", "invisible-dependency-hunter",
    "network-path-memory", "driver-compatibility-radar",
    "software-conflict-investigator",
    "authentication-journey", "update-autopsy", "vendor-case-companion",
    "customer-promise-guardian",
}

# Batch 6 (156-185): communications and collaboration, data protection and
# governance, physical infrastructure and specialist services. It takes the
# catalogue to 185 and is the batch that turned the catalogue into a product
# portfolio: eight of its ten communications studios are plans, one is a section
# of Voice Studio and one is a named gap on the voice service desk.
BATCH_6_CATALOGUE = {
    # 156-165, communications and collaboration.
    "contact-centre", "business-sms", "cloud-fax", "unified-communications",
    "sip", "video-conferencing", "voice-quality", "number-management",
    "messaging-compliance", "reception",
    # 166-175, data, protection and governance.
    "data-governance", "data-loss-prevention", "ediscovery", "privacy-operations",
    "encryption", "secrets", "threat-exposure", "software-supply-chain",
    "identity-threat", "data-recovery",
    # 176-185, physical infrastructure and specialist services.
    "rack", "cabling", "fibre", "environmental", "ups", "kiosk",
    "laboratory-equipment", "broadcast", "satellite", "edge",
}

# Batch 7 (186-210): provider operations, identity and service assurance.
# These entries extend the portfolio without turning every idea into a sidebar
# workspace or an unsupported implementation claim.
BATCH_7_CATALOGUE = {
    "sd-wan", "bgp", "ip-transit", "ip-address-management", "carrier-interconnect",
    "radius", "network-access-control", "wireless-isp", "gpon", "carrier-billing",
    "privileged-access", "service-accounts", "access-reviews", "zero-trust",
    "identity-lifecycle", "service-gap", "service-acceptance", "environment-comparison",
    "change-risk", "operational-readiness", "msp-acquisition", "multi-msp",
    "procurement-intelligence", "customer-value", "platform-health",
}

CATALOGUE = (
    BATCH_2_CATALOGUE | BATCH_3_CATALOGUE | BATCH_4_CATALOGUE | BATCH_5_CATALOGUE
    | BATCH_6_CATALOGUE | BATCH_7_CATALOGUE
)

# Work items the consolidation created, which are the merge target of concepts
# that arrived under several names and had no single id to keep.
NEW_WORK_ITEMS = {
    "dependency-map", "customer-continuity", "technician-memory",
    "recurring-failure-evidence",
}


# ============== FLEET CONTENT ==============


def test_every_planned_studio_exists():
    assert set(studio_registry.STUDIOS) == PLANNED_STUDIO_IDS
    assert studio_registry.list_studios()["count"] == 29


def test_every_studio_exposes_the_full_shared_spine():
    for studio in studio_registry.STUDIOS.values():
        assert studio["spine"] == list(studio_registry.SPINE_TABS)
        assert set(studio["tabs"]) == set(studio_registry.SPINE_TABS), studio["id"]
        for tab_id, spec in studio["tabs"].items():
            assert spec["state"] in studio_registry.TAB_STATES, f"{studio['id']}.{tab_id}"
            assert spec["summary"], f"{studio['id']}.{tab_id} has no disclosure summary"


def test_statuses_use_the_register_vocabulary_only():
    for studio in studio_registry.STUDIOS.values():
        assert studio["status"] in studio_registry.STUDIO_STATUSES


def test_admission_gate_matches_declared_status():
    """Discovery/Architecture studios have open admission; the rest are complete."""
    for studio in studio_registry.STUDIOS.values():
        unadmitted = studio["status"] in {"Discovery required", "Architecture required"}
        if unadmitted:
            assert studio["admission"] is None, studio["id"]
            # An unadmitted studio may only render its own contract.
            wired = [tab for tab, spec in studio["tabs"].items() if spec["state"] == "wired"]
            assert wired == ["overview"], f"{studio['id']} wires {wired} without admission"
        else:
            assert studio["admission"] is not None, studio["id"]
            admission = studio["admission"]
            assert admission["state"] == "complete"
            for field in (
                "problem", "objects", "provider_contracts", "permissions",
                "scopes_audit_retention", "verification_rollback_failure",
                "commercial", "release_gate", "test_plan", "documentation", "owner",
            ):
                assert admission.get(field) is not None, f"{studio['id']} missing {field}"
            # The gate's first field must pair the problem with a measurable outcome.
            assert "outcome" in admission["problem"].lower(), studio["id"]


def test_admitted_studios_permission_ids_exist_in_the_catalogue():
    from app.services.action_permissions import ACTION_PERMISSION_IDS
    for studio in studio_registry.STUDIOS.values():
        admission = studio["admission"] or {}
        for permission in admission.get("permissions", []):
            assert permission in ACTION_PERMISSION_IDS, (
                f"{studio['id']} cites unknown permission '{permission}'"
            )


def test_wired_tabs_name_the_endpoint_they_read():
    for studio in studio_registry.STUDIOS.values():
        for tab_id, spec in studio["tabs"].items():
            if spec["state"] != "wired":
                assert "endpoint" not in spec, f"{studio['id']}.{tab_id} is not wired"
                continue
            if tab_id == "overview" and "endpoint" not in spec:
                # Overview is wired to the studio's own registry contract.
                assert spec.get("evidence") == "app.services.studio_registry"
                continue
            assert spec.get("endpoint"), f"{studio['id']}.{tab_id} wired without an endpoint"
            if tab_id == "activity":
                assert spec.get("subjects"), f"{studio['id']}.activity wired without subjects"
                assert spec["endpoint"] == studio_registry.ACTIVITY_ENDPOINT


def test_a_wired_endpoint_declares_every_parameter_it_carries():
    """A wired tab must be able to build the request it names.

    An endpoint left as ``/fleet-baseline/cohorts/{platform}/deviations`` with no
    declared value reads nothing: the surface cannot know which cohort to ask
    for, so it either fetches a literal placeholder or guesses. The value is the
    registry's to declare (and ``_tab`` refuses it here), because the cohort a
    studio grades against is a product decision, not a browser one.
    """
    for studio in studio_registry.STUDIOS.values():
        for tab_id, spec in studio["tabs"].items():
            placeholders = re.findall(r"\{([a-z_]+)\}", spec.get("endpoint") or "")
            for parameter in placeholders:
                assert parameter in (spec.get("params") or {}), (
                    f"{studio['id']}.{tab_id} leaves {{{parameter}}} for the surface to guess"
                )


def test_an_unbound_endpoint_parameter_is_refused_at_registration():
    with pytest.raises(ValueError, match="leaves"):
        studio_registry._tab(
            "wired", "summary", endpoint="/x/{platform}/y",
            evidence="app.services.studio_registry",
        )
    # A tab that is not wired declares no endpoint at all, so the guard cannot
    # make an unbuilt capability unregisterable.
    assert studio_registry._tab("planned", "summary")["state"] == "planned"


def test_activity_subject_prefixes_resolve_to_governed_platform_subjects():
    """Every Activity filter must match at least one subject the platform publishes."""
    catalog = [item["subject"] for item in EVENT_SUBJECTS]
    wired = [
        (studio["id"], spec["subjects"])
        for studio in studio_registry.STUDIOS.values()
        for spec in studio["tabs"].values()
        if spec["state"] == "wired" and spec.get("subjects")
    ]
    assert wired, "expected at least one studio with an Activity contract"
    for studio_id, prefixes in wired:
        for prefix in prefixes:
            assert any(subject.startswith(prefix) for subject in catalog), (
                f"{studio_id}: subject prefix '{prefix}' matches no governed platform subject"
            )


def test_home_routes_are_local_and_safe():
    for studio in studio_registry.STUDIOS.values():
        route = studio["home_route"]
        assert route is None or (route.startswith("/") and not route.startswith("//")), studio["id"]


def test_registry_carries_no_secret_material():
    dumped = json.dumps(studio_registry.STUDIOS).lower()
    for needle in ("token_value", "api_token=", "password", "service-role", "private_key"):
        assert needle not in dumped, f"registry leaked '{needle}'"


# ============== PRODUCTS ==============


def test_every_studio_belongs_to_a_declared_product():
    """The navigation boundary is total: no studio exists outside a product."""
    for studio in studio_registry.STUDIOS.values():
        assert studio["product"] in studio_registry.PRODUCTS, studio["id"]
    used = {studio["product"] for studio in studio_registry.STUDIOS.values()}
    assert used == set(studio_registry.PRODUCTS), "a declared product holds no studio"


def test_a_studio_cannot_exist_outside_a_product():
    base = dict(
        studio_id="x", name="X", domain="d", tagline="t", status="Not started",
        priority="P1", release="R1", owner="o", home_route="/x",
        provider=None, admission=None,
    )
    with pytest.raises(ValueError, match="unknown product"):
        studio_registry._studio(**{**base, "product": "nexus-imaginary"})


def test_product_catalogue_is_the_multiplication_the_taxonomy_promises():
    """A hundred-plus operational problems stay a handful of navigation entries."""
    catalogue = studio_registry.product_catalogue()
    assert len(catalogue) == len(studio_registry.PRODUCTS)
    assert len(catalogue) < studio_registry.list_studios()["count"], (
        "products must be fewer than studios or the taxonomy groups nothing"
    )
    for product in catalogue:
        assert product["studios"], f"{product['id']} holds no studio"
        assert product["count"] == len(product["studios"])
        assert product["name"].startswith("Nexus "), product["id"]


def test_products_hold_each_studio_exactly_once():
    held = [
        studio_id
        for product in studio_registry.product_catalogue()
        for studio_id in product["studios"]
    ]
    assert sorted(held) == sorted(studio_registry.STUDIOS), (
        "a studio is missing from the catalogue or listed under two products"
    )


def test_every_catalogue_idea_is_recorded_exactly_once():
    """The consolidation records every proposal through batch 7, and drops none."""
    covered = [
        concept
        for proposal in studio_proposals.PROPOSALS.values()
        for concept in proposal["covers"]
    ]
    assert len(covered) == len(set(covered)), "a concept is covered by two records"
    registered = set(studio_proposals.PROPOSALS)
    assert not registered & set(covered), "a cover shadows a record with the same id"
    assert registered | set(covered) == CATALOGUE | NEW_WORK_ITEMS


def test_planned_studios_hold_only_studio_proposals():
    """A product cannot plan what the consolidation merged, extended or served."""
    for product in studio_registry.product_catalogue():
        expected = [
            proposal_id
            for proposal_id, proposal in studio_proposals.PROPOSALS.items()
            if proposal["disposition"] == "studio"
            and proposal["product"] == product["id"]
        ]
        assert product["planned_studios"] == expected, product["id"]
        assert product["proposal_count"] == len(product["proposals"])
        for proposal_id in product["planned_studios"]:
            assert proposal_id not in studio_registry.STUDIOS, (
                f"{proposal_id}: a proposed studio has no registry entry, so nothing "
                "can render it as shipped"
            )
    planned = [
        proposal_id
        for proposal in studio_registry.product_catalogue()
        for proposal_id in proposal["planned_studios"]
    ]
    assert planned, "the catalogue must still plan something"


def test_merge_targets_resolve_to_a_real_owner():
    """Every section, merge and already-done claim names something that exists."""
    for proposal in studio_proposals.PROPOSALS.values():
        disposition = proposal["disposition"]
        if disposition == "section":
            target = proposal["merges_into"]
            assert target in studio_registry.STUDIOS, proposal["id"]
            # A section lives in the product that owns the studio it extends.
            assert studio_registry.STUDIOS[target]["product"] == proposal["product"]
        elif disposition == "merged":
            target = proposal["merges_into"]
            assert target in studio_proposals.PROPOSALS, proposal["id"]
            assert studio_proposals.PROPOSALS[target]["disposition"] != "merged", (
                f"{proposal['id']}: merges must not chain"
            )
            assert not proposal["gates"], "a merged proposal inherits its gates"
        elif disposition == "served":
            assert not proposal["gates"], proposal["id"]
            assert not proposal["buildable_from"], proposal["id"]


def test_every_unbuilt_proposal_names_its_gate_or_the_records_it_projects_from():
    """'Later' is not a disposition: a plan names what blocks it or feeds it."""
    for proposal in studio_proposals.PROPOSALS.values():
        if proposal["disposition"] != "studio":
            continue
        assert proposal["gates"] or proposal["buildable_from"], proposal["id"]
    referenced = {
        gate_id
        for proposal in studio_proposals.PROPOSALS.values()
        for gate_id in proposal["gates"]
    }
    open_gates = {
        gate_id
        for gate_id, gate in studio_proposals.GATES.items()
        if not gate.get("cleared_by")
    }
    assert open_gates == referenced, (
        "an open gate that blocks nothing is not a plan"
    )
    for gate in studio_proposals.GATES.values():
        assert gate["title"] and gate["blocking_reason"] and gate["recorded_in"]


def test_a_cleared_gate_is_history_rather_than_a_blocker():
    """Opening a gate is a checkable claim: it cites the artifact that closed it."""
    cleared = {
        gate_id: gate
        for gate_id, gate in studio_proposals.GATES.items()
        if gate.get("cleared_by")
    }
    assert cleared, "expected the fleet-baseline gate to be recorded as cleared"
    cited = {
        gate_id
        for proposal in studio_proposals.PROPOSALS.values()
        for gate_id in proposal["gates"]
    }
    for gate_id, gate in cleared.items():
        assert not gate["cleared_by"].startswith("/"), gate_id
        assert (studio_proposals.REPO_ROOT / gate["cleared_by"]).exists(), (
            f"gate '{gate_id}' is cleared by '{gate['cleared_by']}', which is not there"
        )
        assert gate["cleared_note"], f"gate '{gate_id}' does not say what cleared it"
        assert gate_id not in cited, (
            f"gate '{gate_id}' is cleared but a proposal is still blocked by it"
        )
    # And the claim is about the fleet baseline projection specifically: the two
    # studios whose only blocker it was are served rather than planned.
    assert cleared["fleet-baseline"]["cleared_by"] in {
        proposal["already_exists_at"]
        for proposal in studio_proposals.PROPOSALS.values()
        if proposal["disposition"] == "served"
    }
    for studio_id in ("windows", "endpoint-performance"):
        proposal = studio_proposals.PROPOSALS[studio_id]
        assert proposal["disposition"] == "served", studio_id
        assert not proposal["gates"], studio_id
        assert studio_id in studio_registry.STUDIOS, (
            f"{studio_id} left the plan but was never admitted as a studio"
        )


def test_every_cited_file_exists():
    """'Already served' and 'extends' are checkable claims, not recollections."""
    citations = [
        path
        for proposal in studio_proposals.PROPOSALS.values()
        for path in (
            ([proposal["already_exists_at"]] if proposal["already_exists_at"] else [])
            + list(proposal["buildable_from"])
        )
    ]
    assert citations, "expected at least one cited existing surface"
    for path in citations:
        assert (studio_proposals.REPO_ROOT / path).exists(), f"missing citation: {path}"


def test_endpoint_and_commerce_hold_the_specialisations_the_batch_names():
    """Nexus Endpoint and Nexus Commerce are the batch's own worked examples."""
    catalogue = {product["id"]: product for product in studio_registry.product_catalogue()}
    endpoint = catalogue["nexus-endpoint"]
    assert set(endpoint["studios"]) == {
        "devices", "agent", "patch", "remote", "windows", "endpoint-performance"
    }
    # Windows and Endpoint Performance are no longer a plan: their gate was
    # cleared, so they are admitted studios reading the fleet baseline instead.
    assert {"apple", "linux"} <= set(endpoint["planned_studios"])
    assert {"windows", "endpoint-performance"} <= set(endpoint["studios"])
    commerce = catalogue["nexus-commerce"]
    assert commerce["studios"] == ["finance"]
    # Batch 5 proposed four commerce studios. Batch 7 adds carrier settlement and
    # procurement intelligence as gated specialist work, while Quoting,
    # Subscription and Customer Profitability remain work on existing engines.
    assert commerce["planned_studios"] == [
        "service-catalogue", "stockroom", "carrier-billing", "procurement-intelligence",
    ]
    dispositions = {p["id"]: p["disposition"] for p in commerce["proposals"]}
    assert dispositions["quoting"] == "extend"
    assert dispositions["subscription"] == "extend"
    assert dispositions["customer-profitability"] == "section"


def test_batch_6_files_communications_under_one_product():
    """The batch's own instruction: these sit inside Nexus Communications."""
    catalogue = {product["id"]: product for product in studio_registry.product_catalogue()}
    communications = catalogue["nexus-communications"]
    assert communications["planned_studios"] == [
        "contact-centre", "business-sms", "cloud-fax", "unified-communications",
        "sip", "video-conferencing", "number-management", "messaging-compliance",
    ]
    dispositions = {p["id"]: p["disposition"] for p in communications["proposals"]}
    # Voice Quality is a view over Voice Studio, which already owns voice, and
    # Reception is a gap on the service desk that already answers calls with a
    # ticket — so neither is a second voice or reception product.
    assert dispositions["voice-quality"] == "section"
    assert dispositions["reception"] == "extend"
    assert studio_registry.STUDIOS["voice"]["product"] == "nexus-communications"
    # Telecom Studio stays the technical administration hub the batch names.
    assert studio_registry.STUDIOS["telecom"]["product"] == "nexus-communications"


def test_batch_6_physical_infrastructure_is_not_filed_as_telemetry():
    """Hardware provider families stay plans rather than sections of Monitoring."""
    catalogue = {product["id"]: product for product in studio_registry.product_catalogue()}
    infrastructure = set(catalogue["nexus-infrastructure"]["planned_studios"])
    assert {"rack", "cabling", "fibre", "ups", "broadcast", "satellite"} <= infrastructure
    observability = set(catalogue["nexus-observability"]["planned_studios"])
    assert {"environmental", "laboratory-equipment"} <= observability
    endpoint = set(catalogue["nexus-endpoint"]["planned_studios"])
    assert "edge" in endpoint
    # Kiosk is a named gap on the kiosk surface that already ships.
    assert studio_proposals.PROPOSALS["kiosk"]["disposition"] == "extend"
    assert "kiosk" not in endpoint


def test_batch_6_plans_name_the_decision_that_blocks_them():
    """A batch-6 plan names a real gate instead of restating the capability."""
    for proposal_id in BATCH_6_CATALOGUE:
        proposal = studio_proposals.PROPOSALS[proposal_id]
        assert proposal["sources"], proposal_id
        assert proposal["sources"][0].startswith("batch 6 #"), proposal_id
        assert proposal["note"], proposal_id
        if proposal["disposition"] == "studio":
            assert proposal["gates"], proposal_id
            for gate_id in proposal["gates"]:
                assert "batch 6" in studio_proposals.GATES[gate_id]["recorded_in"], gate_id
    # One missing model decides five of the ten governance studios, so it is
    # declared once and referenced by all five.
    model = {
        proposal_id
        for proposal_id in BATCH_6_CATALOGUE
        if "data-classification-model" in studio_proposals.PROPOSALS[proposal_id]["gates"]
    }
    assert model == {
        "messaging-compliance", "data-governance", "data-loss-prevention",
        "ediscovery", "privacy-operations",
    }


def test_batch_7_consolidates_assurance_and_privileged_operations_into_existing_homes():
    """Batch 7 grows the portfolio without duplicating evidence or access owners."""
    proposals = studio_proposals.PROPOSALS
    assert proposals["service-gap"]["disposition"] == "section"
    assert proposals["service-gap"]["merges_into"] == "operations-assurance"
    assert proposals["operational-readiness"]["disposition"] == "section"
    assert proposals["operational-readiness"]["merges_into"] == "operations-assurance"
    assert proposals["privileged-access"]["disposition"] == "extend"
    assert proposals["privileged-access"]["already_exists_at"] == "backend/app/routers/nexus_access.py"


def test_batch_7_plans_name_the_provider_or_evidence_decision_that_blocks_them():
    """A provider/identity/assurance plan must disclose the gate before it ships."""
    for proposal_id in BATCH_7_CATALOGUE:
        proposal = studio_proposals.PROPOSALS[proposal_id]
        assert proposal["sources"] and proposal["sources"][0].startswith("batch 7 #"), proposal_id
        assert proposal["note"], proposal_id
        if proposal["disposition"] in {"studio", "section", "extend"}:
            assert proposal["gates"], proposal_id
            for gate_id in proposal["gates"]:
                assert "batch 7" in studio_proposals.GATES[gate_id]["recorded_in"], gate_id


# ============== COMMERCIAL TIERS ==============


def test_every_product_declares_one_declared_tier():
    """The portfolio has a packaging, and it is a declaration rather than a guess."""
    assert list(studio_registry.TIERS) == ["core", "specialist", "platform"]
    for tier in studio_registry.TIERS.values():
        assert tier["label"] and tier["blurb"]
    for product in studio_registry.PRODUCTS.values():
        assert product["tier"] in studio_registry.TIERS, product["id"]
    placed = [
        product_id
        for tier in studio_registry.tier_rollup()
        for product_id in tier["products"]
    ]
    assert sorted(placed) == sorted(studio_registry.PRODUCTS), (
        "a product is missing from the tiers or counted under two"
    )


def test_a_tier_is_never_claimed_for_unadmitted_studios():
    """A tier describes a product's packaging, not a capability Nexus shipped."""
    for tier in studio_registry.tier_rollup():
        assert tier["studio_count"] >= 0
        assert tier["planned_count"] > 0, tier["id"]
        for product_id in tier["products"]:
            product = studio_registry.PRODUCTS[product_id]
            assert tier["id"] == product["tier"]
    # Every studio row and detail contract carries the tier of its product, so a
    # consumer never has to re-derive the packaging from the product list.
    payload = studio_registry.list_studios()
    for row in payload["studios"]:
        assert row["tier"] == studio_registry.PRODUCTS[row["product"]]["tier"]
        assert row["tier_label"] == studio_registry.TIERS[row["tier"]]["label"]
    assert studio_registry.get_studio("voice")["tier"] == "specialist"


def test_the_register_refuses_an_undeclared_tier():
    with pytest.raises(ValueError, match="unknown tier"):
        studio_registry._product("nexus-imaginary", "Nexus Imaginary", "t", "platinum")


def test_the_register_refuses_a_broken_consolidation(monkeypatch):
    """The invariants are enforced, not merely documented."""
    studio_products = {s["id"]: s["product"] for s in studio_registry.STUDIOS.values()}
    product_ids = frozenset(studio_registry.PRODUCTS)
    # Read the real gates before the first monkeypatch replaces the module's. The
    # fixture is an OPEN gate; the cleared-gate rules are exercised at the end.
    all_gates = dict(studio_proposals.GATES)
    gate = {"stock-ownership": all_gates["stock-ownership"]}

    def register(*records):
        return {record["id"]: record for record in records}

    def check(*records, gates=gate):
        monkeypatch.setattr(studio_proposals, "PROPOSALS", register(*records))
        monkeypatch.setattr(studio_proposals, "GATES", gates)
        studio_proposals.validate(
            studio_products=studio_products, product_ids=product_ids
        )

    def refuse(match, *records, gates=gate):
        monkeypatch.setattr(studio_proposals, "PROPOSALS", register(*records))
        monkeypatch.setattr(studio_proposals, "GATES", gates)
        with pytest.raises(ValueError, match=match):
            studio_proposals.validate(
                studio_products=studio_products, product_ids=product_ids
            )

    def proposal(proposal_id, disposition, **overrides):
        fields = dict(
            title=proposal_id.title(), product="nexus-endpoint",
            sources=("batch 9",), gates=("stock-ownership",),
        )
        fields.update(overrides)
        return studio_proposals._proposal(proposal_id, disposition=disposition, **fields)

    # A well-formed register passes, so each refusal below is about its own defect.
    check(proposal("x", "studio"))
    refuse("must name its gate", proposal("x", "studio", gates=()))
    refuse("unknown product", proposal("x", "studio", product="nexus-imaginary"))
    refuse(
        "is not a registered studio",
        proposal("x", "section", merges_into="not-a-studio", gates=()),
    )
    refuse(
        "its studio's product",
        proposal("x", "section", merges_into="finance", gates=()),
    )
    refuse("merged target", proposal("x", "merged", merges_into="nobody", gates=()))
    refuse(
        "the same idea twice",
        proposal("x", "merged", merges_into="y", gates=(), covers=("z",)),
        proposal("y", "studio"),
        proposal("w", "merged", merges_into="y", gates=(), covers=("z",)),
    )
    refuse(
        "covers 'y', which is itself a proposal",
        proposal("x", "merged", merges_into="y", gates=(), covers=("y",)),
        proposal("y", "studio"),
    )
    refuse(
        "does not exist",
        proposal("x", "served", gates=(),
                 already_exists_at="backend/app/routers/not_a_real_router.py"),
    )
    refuse("unknown gate", proposal("x", "studio", gates=("no-such-gate",)))
    # And a gate nobody is blocked by is refused as a plan that plans nothing.
    orphan_gates = {
        "stock-ownership": all_gates["stock-ownership"],
        "partner-tenancy": all_gates["partner-tenancy"],
    }
    refuse("blocks nothing", proposal("x", "studio"), gates=orphan_gates)
    # A cleared gate stops blocking: citing it is an error, and so is clearing one
    # without citable evidence.
    cleared = {
        "fleet-baseline": {
            **all_gates["fleet-baseline"],
            "cleared_by": "backend/app/services/fleet_baseline.py",
            "cleared_note": "shipped",
        },
        "stock-ownership": all_gates["stock-ownership"],
    }
    refuse(
        "is still blocked by it",
        proposal("x", "studio", gates=("fleet-baseline",)),
        gates=cleared,
    )
    cleared_without_note = {
        **cleared,
        "fleet-baseline": {**cleared["fleet-baseline"], "cleared_note": None},
        "partner-tenancy": all_gates["partner-tenancy"],
    }
    refuse(
        "without saying what cleared it",
        proposal("x", "studio"),
        gates=cleared_without_note,
    )
    cleared_without_evidence = {
        **cleared,
        "fleet-baseline": {
            **cleared["fleet-baseline"],
            "cleared_by": "backend/app/services/not_a_real_service.py",
        },
        "partner-tenancy": all_gates["partner-tenancy"],
    }
    refuse("cites missing evidence", proposal("x", "studio"), gates=cleared_without_evidence)


def test_list_endpoint_reports_the_commercial_tiers():
    """The catalogue's packaging reaches the hub, so it can be searched by tier."""
    response = asyncio.run(studio_fleet.list_studios(current_user=USER))
    assert response["tier_note"]
    tiers = {tier["id"]: tier for tier in response["tiers"]}
    assert list(tiers) == ["core", "specialist", "platform"]
    for tier in tiers.values():
        assert tier["label"] and tier["blurb"] and tier["products"]
        assert tier["studio_count"] == sum(
            product["count"]
            for product in response["products"]
            if product["tier"] == tier["id"]
        )
    assert response["summary"]["by_tier"] == {
        tier["id"]: tier["studio_count"] for tier in response["tiers"]
    }
    for product in response["products"]:
        assert product["tier_label"] == tiers[product["tier"]]["label"]


def test_list_endpoint_reports_products_alongside_studios():
    response = asyncio.run(studio_fleet.list_studios(current_user=USER))
    assert response["product_note"]
    assert len(response["products"]) == 14
    assert response["summary"]["by_product"] == {
        product["id"]: product["count"] for product in response["products"]
    }
    for row in response["studios"]:
        assert row["product"]
        assert row["product_name"].startswith("Nexus ")


def test_list_endpoint_reports_the_consolidated_catalogue():
    """The hub reads what a product plans and what was consolidated away."""
    response = asyncio.run(studio_fleet.list_studios(current_user=USER))
    assert response["proposal_note"]
    endpoint = next(
        product for product in response["products"] if product["id"] == "nexus-endpoint"
    )
    dispositions = {
        proposal["id"]: proposal["disposition"] for proposal in endpoint["proposals"]
    }
    assert dispositions["windows"] == "served"
    assert dispositions["endpoint-performance"] == "served"
    assert dispositions["browser-management"] == "studio"
    assert dispositions["remote-workforce"] == "section"
    assert endpoint["proposal_count"] == len(endpoint["proposals"])

    browser = next(
        proposal for proposal in endpoint["proposals"]
        if proposal["id"] == "browser-management"
    )
    assert browser["disposition_label"]
    assert browser["covers"] == ["browser"]
    assert [gate["id"] for gate in browser["gates"]] == ["endpoint-enumeration-consent"]
    assert browser["gates"][0]["title"]

    # A served proposal says where it lives, so the hub can name the surface.
    served = [
        proposal
        for product in response["products"]
        for proposal in product["proposals"]
        if proposal["disposition"] == "served"
    ]
    assert served
    for proposal in served:
        assert proposal["already_exists_at"].startswith("backend/app/")


# ============== REGISTRY GUARDS ==============


def test_unknown_studio_is_not_in_the_fleet():
    assert studio_registry.get_studio("does-not-exist") is None
    assert studio_registry.get_studio("  PROXMOX ")["id"] == "proxmox"


def test_registry_rejects_bad_statuses_and_tabs():
    base = dict(
        studio_id="x", name="X", domain="d", product="nexus-endpoint", tagline="t",
        status="Not started", priority="P1", release="R1", owner="o", home_route="/x",
        provider=None, admission=None,
    )
    with pytest.raises(ValueError, match="unknown studio status"):
        studio_registry._studio(**{**base, "status": "Totally Ready"})
    with pytest.raises(ValueError, match="unknown tab"):
        studio_registry._studio(**{**base, "tabs": {"hologram": studio_registry._planned()}})
    with pytest.raises(ValueError, match="unknown tab state"):
        studio_registry._tab("half-wired", "nope")
    with pytest.raises(ValueError, match="unadmitted studios cannot declare wired tabs"):
        studio_registry._studio(
            **{**base, "status": "Discovery required",
               "tabs": {"inventory": studio_registry._tab("wired", "x", endpoint="/x")}}
        )


def test_admission_status_mismatch_is_rejected():
    base = dict(
        studio_id="x", name="X", domain="d", product="nexus-endpoint", tagline="t",
        status="Partially implemented", priority="P1", release="R1", owner="o",
        home_route=None, provider=None, admission=None,
    )
    with pytest.raises(ValueError, match="admission state must match"):
        studio_registry._studio(**base)


# ============== ROUTER ==============


def test_list_endpoint_returns_the_whole_fleet():
    response = asyncio.run(studio_fleet.list_studios(current_user=USER))
    assert response["count"] == 29
    assert len(response["spine"]) == 9
    ids = {row["id"] for row in response["studios"]}
    assert ids == PLANNED_STUDIO_IDS
    cloud = next(row for row in response["studios"] if row["id"] == "cloud")
    assert cloud["status"] == "Discovery required"
    assert cloud["admission_state"] == "open"
    proxmox = next(row for row in response["studios"] if row["id"] == "proxmox")
    assert proxmox["status"] == "Testing"
    assert set(proxmox["wired_tabs"]) >= {"overview", "inventory", "activity"}


def test_detail_endpoint_returns_the_full_contract():
    contract = asyncio.run(studio_fleet.get_studio("proxmox", current_user=USER))
    assert contract["spine"] == list(studio_registry.SPINE_TABS)
    assert contract["admission"]["state"] == "complete"
    assert "virtualization.vm.control" in contract["admission"]["permissions"]
    assert contract["tabs"]["inventory"]["endpoint"] == "/proxmox/nodes"
    # A studio contract never carries live health — tabs read their own endpoint.
    assert "connections" not in json.dumps(contract)


def test_detail_endpoint_404s_for_unknown_studios():
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(studio_fleet.get_studio("not-a-studio", current_user=USER))
    assert excinfo.value.status_code == 404


# ============== HTTP BOUNDARY ==============


def _mounted_operation(method: str, path: str, app=None):
    """The live route a request would hit, resolved through Starlette matching.

    FastAPI registers each included router as a wrapper that matches the paths
    its own subtree owns, so a wrapper is unwrapped to the route underneath it
    before the operation is identified — the assertion is about the APIRoute
    that answers the request, not about the wrapper that carried it in.

    ``app`` defaults to the running application; the other suite modules import
    this helper so one implementation resolves the live route tree.
    """
    from starlette.routing import Match, compile_path

    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "root_path": "",
        "headers": [],
    }

    def is_operation(context) -> bool:
        """Does one include-context answer this exact method and path?"""
        operation = context.original_route
        methods = getattr(operation, "methods", None) or set()
        if method not in methods:
            return False
        pattern = compile_path(context.path)[0]
        return any(pattern.match(candidate) for candidate in (path, path.lstrip("/")))

    def resolve(routes):
        for route in routes:
            if isinstance(route, _IncludedRouter):
                match, _ = route.matches(scope)
                if match != Match.FULL:
                    continue
                for child in route.effective_candidates():
                    if isinstance(child, _IncludedRouter):
                        found = resolve([child])
                    else:
                        found = child.original_route if is_operation(child) else None
                    if found is not None:
                        return found
                continue
            try:
                match, _ = route.matches(scope)
            except Exception:
                continue
            if match == Match.FULL:
                return route
        return None

    return resolve((app if app is not None else server.app).routes)


def effective_operations(app=None):
    """Every HTTP operation the application serves, as ``(path, route)``.

    FastAPI keeps each included router in ``app.routes`` as a wrapper whose
    children carry the include prefix, so a test that reasons about the live
    route tree cannot read ``app.routes`` as a flat list of ``APIRoute``
    objects — an ``isinstance(route, APIRoute)`` filter matches almost nothing
    and quietly asserts over an empty tree. Unwrap the wrappers here so
    collision and ownership checks see what a request can actually reach.
    """
    from fastapi.routing import APIRoute

    def walk(routes):
        for route in routes:
            if isinstance(route, _IncludedRouter):
                for context in route.effective_candidates():
                    original = context.original_route
                    if isinstance(original, _IncludedRouter):
                        yield from walk([original])
                    elif isinstance(original, APIRoute):
                        yield context.path, original
                continue
            if isinstance(route, APIRoute):
                yield route.path_format, route

    return walk((app if app is not None else server.app).routes)


def test_studio_fleet_endpoints_are_mounted_behind_authentication():
    """The handler tests above bypass FastAPI; pin the application boundary.

    Routers are auto-discovered (``server.discover_and_register_routers``), so a
    module rename or a retired-router entry could silently drop both endpoints
    while every direct-handler test kept passing. Require the mounted operations
    to stay owned by ``studio_fleet`` and guarded by ``get_current_user``.
    """
    for method, path, handler in (
        ("GET", "/api/studios", studio_fleet.list_studios),
        ("GET", "/api/studios/proxmox", studio_fleet.get_studio),
    ):
        route = _mounted_operation(method, path)
        assert route is not None, f"{method} {path} is not mounted"
        assert route.endpoint is handler, f"{method} {path} is shadowed by another route"
        dependency_calls = [dep.call for dep in route.dependant.dependencies]
        assert get_current_user in dependency_calls, f"{method} {path} is not auth-guarded"
