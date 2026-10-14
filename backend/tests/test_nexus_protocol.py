"""Contract tests for the Nexus Protocol: registry, action descriptor, Nexus Native conformance."""

import asyncio
import copy
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import tech_fun as tech_fun_router  # noqa: E402
from app.services import nexus_connector, nexus_protocol  # noqa: E402


FIXED_NOW = datetime(2026, 10, 5, 8, 0, tzinfo=timezone.utc)


# ============== MINIMAL MONGO FAKES (same contract as test_tech_fun) ==============


def _match_value(value, condition):
    if isinstance(condition, dict):
        for op, operand in condition.items():
            if op == "$in" and value not in operand:
                return False
            if op == "$nin" and value in operand:
                return False
            if op == "$exists" and (value is not None) != bool(operand):
                return False
            if op == "$ne" and value == operand:
                return False
            if op == "$gt" and not (value is not None and value > operand):
                return False
            if op == "$gte" and not (value is not None and value >= operand):
                return False
            if op == "$lt" and not (value is not None and value < operand):
                return False
            if op == "$lte" and not (value is not None and value <= operand):
                return False
            if op == "$regex" and not re.search(operand, str(value or "")):
                return False
        return True
    if condition is None:
        return value is None
    return value == condition


def _matches(row, query):
    for key, condition in query.items():
        if key == "$or":
            if not any(_matches(row, sub) for sub in condition):
                return False
        elif key == "$and":
            if not all(_matches(row, sub) for sub in condition):
                return False
        elif not _match_value(row.get(key), condition):
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, field, direction=1):
        self._rows = sorted(self._rows, key=lambda row: (row.get(field) is None, row.get(field)), reverse=direction < 0)
        return self

    def limit(self, count):
        self._rows = self._rows[:count]
        return self

    async def to_list(self, _count=None):
        return [copy.deepcopy(row) for row in self._rows]


class _Collection:
    def __init__(self, rows=None):
        self.rows = [copy.deepcopy(row) for row in (rows or [])]
        self.inserted = []
        self.updates = []

    def find(self, query=None, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query or {})])

    async def find_one(self, query=None, _projection=None):
        for row in self.rows:
            if _matches(row, query or {}):
                return copy.deepcopy(row)
        return None

    async def insert_one(self, row):
        self.rows.append(copy.deepcopy(row))
        self.inserted.append(copy.deepcopy(row))

    async def update_one(self, query, update, upsert=False, **_kwargs):
        self.updates.append((copy.deepcopy(query), copy.deepcopy(update)))
        for row in self.rows:
            if _matches(row, query):
                for field, value in (update.get("$set") or {}).items():
                    row[field] = value
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def count_documents(self, query=None):
        return sum(1 for row in self.rows if _matches(row, query or {}))


def _db(**collections):
    namespace = SimpleNamespace()
    for name in ("nexus_protocol_reviews", "usage_meter_events", "ledger_entries"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": "platform-a", "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_protocol, "_utcnow", lambda: FIXED_NOW)


def _valid_descriptor(**overrides):
    descriptor = {
        "action": "isolate",
        "actor": {"kind": "technician", "id": "tech-1"},
        "target": {"kind": "device", "nexus_id": "dev-001"},
        "scope": {"tenant_id": "platform-a", "client_id": "CLI-001"},
        "destructive": True,
        "reversible": True,
        "autonomy_level": "act_with_verification",
        "verification_plan": "device unreachable from user VLAN within 60s",
        "rollback": {"action": "configure", "plan": "restore prior VLAN membership"},
    }
    descriptor.update(overrides)
    return descriptor


# ============== REGISTRY INTEGRITY ==============


def test_manifest_lists_every_object_and_action():
    manifest = nexus_protocol.protocol_manifest()
    assert len(manifest["objects"]) == 17
    assert len(manifest["actions"]) == 10
    assert manifest["freshness_fields"] == ["observed_at", "source", "confidence"]


def test_every_object_has_stable_id_and_store():
    for kind, spec in nexus_protocol.PROTOCOL_OBJECTS.items():
        assert spec["stable_id"].endswith("_id"), kind
        assert spec["core_fields"], kind
        assert spec["authoritative_store"], kind


def test_every_mutating_action_requires_verification():
    for action, spec in nexus_protocol.PROTOCOL_ACTIONS.items():
        assert spec["status"] in ("shipped", "partial"), action
        if spec["mutates"]:
            assert spec["requires_verification"] is True, action


def test_platform_coverage_is_honest_about_partials():
    coverage = nexus_protocol.platform_coverage()
    assert coverage["actions_shipped"] + coverage["actions_partial"] == 10
    partial = [row for row in coverage["coverage"] if row["status"] == "partial"]
    assert partial and all("not yet a full verified execution path" in row["note"] for row in partial)


# ============== CANONICAL ACTION DESCRIPTOR (P0 #1) ==============


def test_valid_descriptor_passes(monkeypatch):
    _fixed_clock(monkeypatch)
    result = nexus_protocol.validate_action_descriptor(_valid_descriptor())
    assert result["valid"] is True
    assert result["problems"] == []


def test_missing_actor_target_scope_are_rejected():
    result = nexus_protocol.validate_action_descriptor({"action": "observe"})
    assert result["valid"] is False
    joined = " ".join(result["problems"])
    assert "actor.id" in joined and "target.nexus_id" in joined and "scope.tenant_id" in joined


def test_destructive_action_requires_rollback():
    result = nexus_protocol.validate_action_descriptor(
        _valid_descriptor(reversible=False, rollback={}))
    assert result["valid"] is False
    assert any("rollback plan" in problem for problem in result["problems"])


def test_autonomy_act_requires_verification_plan():
    result = nexus_protocol.validate_action_descriptor(
        _valid_descriptor(autonomy_level="act", verification_plan=""))
    assert result["valid"] is False
    assert any("verification plan" in problem for problem in result["problems"])


def test_suggest_autonomy_needs_no_verification_plan():
    result = nexus_protocol.validate_action_descriptor(
        _valid_descriptor(autonomy_level="suggest", verification_plan="",
                          destructive=False, reversible=False, rollback={}))
    assert result["valid"] is True


def test_unknown_action_and_non_protocol_target_rejected():
    result = nexus_protocol.validate_action_descriptor(
        _valid_descriptor(action="teleport", target={"kind": "toaster", "nexus_id": "t-1"}))
    assert result["valid"] is False
    joined = " ".join(result["problems"])
    assert "action must be one of" in joined and "target.kind must be a protocol object" in joined


# ============== NEXUS NATIVE CONFORMANCE ==============


def _maximally_wired_adapter():
    verbs = set()
    for probe in nexus_protocol._DIMENSION_PROBES.values():
        verbs |= probe["verified_verbs"]
    return {"adapter": "super-vendor", "vendor": "Super",
            "capabilities": {verb: "wired" for verb in verbs}}


def test_maximally_wired_adapter_is_not_native_without_uninstall_evidence():
    result = nexus_protocol.evaluate_conformance(_maximally_wired_adapter())
    assert result["level"] == "nexus_ready"
    assert result["nexus_native"] is False
    assert result["dimensions"]["uninstall"]["verdict"] == "unverified"


def test_uninstall_evidence_completes_native_certification():
    result = nexus_protocol.evaluate_conformance(
        _maximally_wired_adapter(), evidence_counts={"uninstall": 2})
    assert result["level"] == "nexus_native"
    assert result["counts"]["verified"] == 8


def test_no_bundled_adapter_claims_nexus_native():
    for row in nexus_connector.list_adapters()["adapters"]:
        result = nexus_protocol.evaluate_conformance(row)
        assert result["nexus_native"] is False, row["adapter"]
        assert result["counts"]["verified"] + result["counts"]["partial"] + result["counts"]["unverified"] == 8


def test_planned_capabilities_score_partial_not_verified():
    row = {"adapter": "maybe-vendor", "vendor": "Maybe",
           "capabilities": {"endpoint.audit": "planned"}}
    result = nexus_protocol.evaluate_conformance(row)
    assert result["dimensions"]["telemetry"]["verdict"] == "partial"
    assert result["counts"]["verified"] == 0


def test_absent_capabilities_are_unverified():
    result = nexus_protocol.evaluate_conformance({"adapter": "empty", "capabilities": {}})
    assert result["level"] == "unknown"
    assert result["counts"]["unverified"] == 8


def test_checklist_covers_all_eight_dimensions():
    checklist = nexus_protocol.certification_checklist()
    assert len(checklist["dimensions"]) == 8
    assert all(row["checklist"] for row in checklist["dimensions"])


# ============== CERTIFICATION REVIEWS ==============


def test_record_review_stores_tenant_scoped_review(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    result = asyncio.run(nexus_protocol.record_review(db, _user(admin=True), "Ada Admin", {
        "adapter": "acronis", "decision": "certified", "basis": "evidence",
        "note": "restore verified in lab", "evidence_refs": ["EVD-1"],
    }))
    assert result["found"] is True
    review = result["review"]
    assert review["id"].startswith("NPR-")
    assert review["adapter"] == "acronis"
    assert review["tenant_id"] == "platform-a"
    assert review["reviewed_by"] == "Ada Admin"
    assert review["reviewed_at"] == FIXED_NOW.isoformat()
    assert db.nexus_protocol_reviews.inserted[0]["evidence_refs"] == ["EVD-1"]


def test_unknown_adapter_review_rejected():
    result = asyncio.run(nexus_protocol.record_review(_db(), _user(), "T", {
        "adapter": "toaster-cloud", "decision": "certified", "basis": "evidence"}))
    assert result["found"] is False
    assert "unknown adapter" in result["error"]


def test_declaration_never_certifies():
    result = asyncio.run(nexus_protocol.record_review(_db(), _user(), "T", {
        "adapter": "acronis", "decision": "certified", "basis": "declaration"}))
    assert result["found"] is False
    assert "never certified" in result["error"]


def test_invalid_decision_rejected():
    result = asyncio.run(nexus_protocol.record_review(_db(), _user(), "T", {
        "adapter": "acronis", "decision": "definitely-fine", "basis": "evidence"}))
    assert result["found"] is False
    assert "decision must be" in result["error"]


def test_list_reviews_filters_by_adapter():
    db = _db(nexus_protocol_reviews=_Collection([
        {"id": "NPR-1", "adapter": "acronis", "decision": "certified",
         "reviewed_at": "2026-10-01T00:00:00+00:00", "tenant_id": "platform-a"},
        {"id": "NPR-2", "adapter": "pax8", "decision": "conditional",
         "reviewed_at": "2026-10-02T00:00:00+00:00", "tenant_id": "platform-a"},
    ]))
    result = asyncio.run(nexus_protocol.list_reviews(db, _user(), "acronis"))
    assert result["count"] == 1
    assert result["reviews"][0]["adapter"] == "acronis"


def test_conformance_board_attaches_latest_review():
    db = _db(nexus_protocol_reviews=_Collection([
        {"id": "NPR-9", "adapter": "acronis", "decision": "conditional",
         "reviewed_at": "2026-10-03T00:00:00+00:00", "tenant_id": "platform-a"},
    ]))
    board = asyncio.run(nexus_protocol.conformance_board(db, _user(), "acronis"))
    assert board["found"] is True
    entry = board["adapters"][0]
    assert entry["adapter"] == "acronis"
    assert entry["latest_review"]["decision"] == "conditional"


def test_conformance_board_unknown_adapter():
    board = asyncio.run(nexus_protocol.conformance_board(_db(), _user(), "toaster-cloud"))
    assert board["found"] is False


# ============== ROUTER CONTRACT ==============


def test_router_validate_action_reports_problems():
    result = asyncio.run(tech_fun_router.validate_protocol_action({}, _user()))
    assert result["valid"] is False
    assert result["problems"]


def test_router_certification_review_requires_admin():
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(tech_fun_router.record_certification_review(
            {"adapter": "acronis", "decision": "certified", "basis": "evidence"}, _user(admin=False)))
    assert excinfo.value.status_code == 403
