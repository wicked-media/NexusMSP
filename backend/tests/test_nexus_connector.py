"""Contract tests for the Universal Connector: verbs, adapters, translate, swap."""

import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services import nexus_connector  # noqa: E402


# ============== CAPABILITY VERBS ==============


def test_capabilities_include_stable_workforce_verbs():
    listing = nexus_connector.list_capabilities()
    verbs = {row["verb"] for row in listing["capabilities"]}
    assert {"identity.user.disable", "endpoint.isolate", "backup.restore",
            "network.firewall.block", "license.assign"} <= verbs
    assert listing["count"] == len(nexus_connector.CAPABILITIES)


def test_adapters_report_wired_status_honestly():
    listing = nexus_connector.list_adapters()
    adapters = {row["adapter"]: row for row in listing["adapters"]}
    assert adapters["microsoft365"]["capabilities"]["identity.user.disable"] == "wired"
    assert adapters["unifi"]["capabilities"]["network.firewall.block"] == "planned"
    assert adapters["microsoft365"]["wired"] == 5


def test_coverage_flags_portability_and_single_vendor_risk():
    coverage = nexus_connector.capability_coverage()
    rows = {row["verb"]: row for row in coverage["coverage"]}
    assert rows["license.assign"]["portable"] is True  # microsoft365 + pax8 both wired
    assert rows["identity.user.disable"]["single_vendor_risk"] is True  # microsoft365 only
    assert rows["network.firewall.block"]["wired_providers"] == []  # unifi planned only
    assert coverage["verbs_total"] == len(nexus_connector.CAPABILITIES)


# ============== TRANSLATE (plan, not execution) ==============


def test_translate_resolves_verb_to_vendor_plan():
    result = nexus_connector.translate("identity.user.disable", "microsoft365")
    assert result["found"] is True
    assert result["vendor"] == "Microsoft"
    assert result["status"] == "wired"
    assert result["operation"]["implementation"] == "app.services.microsoft_graph_connection"
    assert any("verify outcome" in step for step in result["plan"])
    assert "not performed by the connector" in result["note"]


def test_translate_rejects_unknown_verb_and_adapter():
    assert nexus_connector.translate("coffee.make", "microsoft365")["found"] is False
    assert nexus_connector.translate("identity.user.disable", "skynet")["found"] is False
    result = nexus_connector.translate("backup.restore", "microsoft365")
    assert result["found"] is False
    assert "does not implement" in result["error"]


# ============== SWAP PLAN (vendor independence) ==============


def test_swap_plan_lists_what_a_vendor_change_touches():
    result = nexus_connector.swap_plan("license.assign", "pax8", "microsoft365")
    assert result["found"] is True
    assert result["from"]["vendor"] == "Pax8"
    assert result["to"]["vendor"] == "Microsoft"
    assert len(result["checklist"]) == 6
    assert "workflows stay unchanged" in result["note"]


def test_swap_plan_rejects_missing_capability():
    result = nexus_connector.swap_plan("backup.restore", "acronis", "microsoft365")
    assert result["found"] is False
    assert "does not implement" in result["error"]
    assert nexus_connector.swap_plan("nope", "a", "b")["found"] is False
