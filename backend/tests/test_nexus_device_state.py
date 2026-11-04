"""Contract tests for the device-level State Engine and Drift Control."""

import asyncio
import copy
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services import nexus_device_state, nexus_operational_mode  # noqa: E402


FIXED_NOW = datetime(2026, 10, 4, 8, 0, tzinfo=timezone.utc)


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
        self._rows = sorted(self._rows, key=lambda row: (row.get(field) is None, row.get(field)),
                            reverse=direction < 0)
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


COLLECTIONS = (
    "device_state_declarations", "drift_findings", "devices", "backup_jobs", "clients",
    "operational_mode_state", "operational_mode_events",
)


def _db(**collections):
    namespace = SimpleNamespace()
    for name in COLLECTIONS:
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False, tenant="platform-a"):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": tenant, "client_scope_mode": "all"}


def _device(device_id="dev-1", tenant="platform-a", **overrides):
    """Real evidence for some checks; deliberately none for edr and backup."""
    row = {
        "id": device_id,
        "tenant_id": tenant,
        "hostname": device_id.upper(),
        "client_id": "CLI-001",
        "bitlocker_enabled": True,
        "firewall_enabled": False,
        "browsers": {"chrome": "138.0.7204.94"},
        "dns_servers": ["10.0.0.5", "10.0.0.6"],
        "local_admins": ["acme\\Administrator", "acme\\Terry"],
        "time_sync_healthy": True,
    }
    row.update(overrides)
    return row


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_device_state, "_utcnow", lambda: FIXED_NOW)


def _mode(monkeypatch, mode, reason="", frozen_clients=(), frozen_capabilities=()):
    """Pin the published operational-mode contract: this service must consult it
    and act on its decision, so the decision is stated here rather than assumed."""
    async def _current(_db, _user):
        return {"mode": mode, "reason": reason, "since": "2026-10-01T00:00:00+00:00",
                "frozen_clients": list(frozen_clients),
                "frozen_capabilities": list(frozen_capabilities),
                "note": f"{mode} operation"}

    def _permits(state, *, client_id="", capability=""):
        if state.get("mode") == "normal":
            return {"allowed": True, "reason": "normal operation"}
        if client_id and client_id in (state.get("frozen_clients") or []):
            return {"allowed": False, "reason": f"client {client_id} is frozen"}
        if capability and capability in (state.get("frozen_capabilities") or []):
            return {"allowed": False, "reason": f"{capability} is frozen"}
        return {"allowed": False,
                "reason": state.get("reason") or f"{state.get('mode')} mode blocks execution"}

    monkeypatch.setattr(nexus_operational_mode, "current_mode", _current)
    monkeypatch.setattr(nexus_operational_mode, "permits", _permits)


def _normal_mode(monkeypatch):
    _mode(monkeypatch, "normal")


def _observe_only(monkeypatch):
    _mode(monkeypatch, "observe_only", reason="suspected compromise")


def _checks_by_key(result):
    return {item["check"]: item for item in result["checks"]}


def _evaluate(db, user=None, device_id="dev-1"):
    return asyncio.run(nexus_device_state.evaluate_device(db, user or _user(), device_id))


# ============== THE PUBLISHED CATALOG ==============


def test_catalog_publishes_the_eight_device_checks_in_order():
    catalog = nexus_device_state.check_catalog()
    assert [entry["check"] for entry in catalog["checks"]] == [
        "bitlocker", "dns_servers", "edr_present", "browser_version",
        "local_admins", "firewall_enabled", "backup_protected", "time_sync",
    ]
    for entry in catalog["checks"]:
        assert entry["label"] and entry["domain"] and entry["comparison"] and entry["question"]
        assert len(entry["evidence"]) > 20
    assert set(catalog["severity_by_domain"]) == {
        "encryption", "security", "backup", "identity", "network", "patching", "configuration"}
    assert "cannot infer protection from a missing field" in catalog["note"]


# ============== EVALUATION HONESTY ==============


def test_evidence_gives_met_absent_evidence_gives_unverified_never_drifted(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    result = _evaluate(db)
    assert result["found"] is True
    checks = _checks_by_key(result)

    assert checks["bitlocker"]["verdict"] == "met"
    assert checks["browser_version"]["verdict"] == "met"
    assert checks["time_sync"]["verdict"] == "met"
    assert checks["firewall_enabled"]["verdict"] == "drifted"
    assert "disabled" in checks["firewall_enabled"]["reason"]

    # No edr field and no backup jobs: unverified, and specifically NOT drifted.
    assert checks["edr_present"]["verdict"] == "unverified"
    assert checks["backup_protected"]["verdict"] == "unverified"
    assert "cannot" in checks["edr_present"]["reason"] or "will not call" in checks["edr_present"]["reason"]
    assert "recoverability is not proven" in checks["backup_protected"]["reason"]

    assert result["counts"] == {"met": 3, "drifted": 1, "unverified": 4}
    assert "cannot infer" in result["note"] or "no recorded evidence" in result["note"]
    for entry in result["checks"]:
        assert entry["route"] == "/devices/dev-1"
        assert entry["severity"] in ("high", "medium", "low")


def test_checks_needing_a_declaration_are_unverified_without_one(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    checks = _checks_by_key(_evaluate(db))
    # The device HAS resolver and administrator evidence, but nothing to compare it to.
    assert checks["dns_servers"]["observed"] == "10.0.0.5, 10.0.0.6"
    assert checks["dns_servers"]["verdict"] == "unverified"
    assert "no expected resolver is declared" in checks["dns_servers"]["reason"]
    assert checks["local_admins"]["verdict"] == "unverified"
    assert "no approved administrator set is declared" in checks["local_admins"]["reason"]


def test_missing_device_is_not_found(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    assert _evaluate(db, device_id="dev-ghost") == {"found": False}


# ============== DECLARATIONS ==============


def test_declaration_overrides_the_default_and_changes_the_verdict(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    before = _checks_by_key(_evaluate(db))["local_admins"]
    assert before["verdict"] == "unverified"

    declared = asyncio.run(nexus_device_state.declare_state(db, _user(), "Terry Tech", {
        "check": "local_admins", "expectation": "acme\\Administrator",
        "client_id": "CLI-001", "owner": "Dana Customer",
    }))
    assert declared["found"] is True
    assert declared["declaration"]["id"].startswith("DSD-")
    assert declared["declaration"]["tenant_id"] == "platform-a"

    after = _checks_by_key(_evaluate(db))["local_admins"]
    assert after["verdict"] == "drifted"
    assert after["declared"] is True
    assert "acme\\Terry" in after["reason"]
    assert "declaration DSD-" in after["reason"]

    asyncio.run(nexus_device_state.declare_state(db, _user(), "Terry Tech", {
        "check": "dns_servers", "expectation": "10.0.0.5", "client_id": "CLI-001"}))
    assert _checks_by_key(_evaluate(db))["dns_servers"]["verdict"] == "met"


def test_a_declaration_can_require_something_to_be_off(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    assert _checks_by_key(_evaluate(db))["bitlocker"]["verdict"] == "met"
    asyncio.run(nexus_device_state.declare_state(db, _user(), "Terry Tech", {
        "check": "bitlocker", "expectation": "disabled", "client_id": "CLI-001"}))
    assert _checks_by_key(_evaluate(db))["bitlocker"]["verdict"] == "drifted"


def test_declare_state_validates_input(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    assert asyncio.run(nexus_device_state.declare_state(
        db, _user(), "Terry Tech", {"check": "vibes", "expectation": "x"}))["error"] == \
        "unknown check 'vibes'"
    assert asyncio.run(nexus_device_state.declare_state(
        db, _user(), "Terry Tech", {"check": "bitlocker", "expectation": "  "}))["error"] == \
        "expectation is required"
    assert db.device_state_declarations.inserted == []


def test_list_declarations_is_tenant_scoped(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(device_state_declarations=_Collection([
        {"id": "DSD-A", "tenant_id": "platform-a", "check": "bitlocker", "expectation": "enabled",
         "client_id": "CLI-001", "device_id": "", "created_at": "2026-10-01T00:00:00+00:00"},
        {"id": "DSD-B", "tenant_id": "platform-b", "check": "bitlocker", "expectation": "enabled",
         "client_id": "CLI-009", "device_id": "", "created_at": "2026-10-02T00:00:00+00:00"},
    ]))
    listed = asyncio.run(nexus_device_state.list_declarations(db, _user()))
    assert listed["count"] == 1
    assert listed["declarations"][0]["id"] == "DSD-A"
    other = asyncio.run(nexus_device_state.list_declarations(db, _user(tenant="platform-b")))
    assert [row["id"] for row in other["declarations"]] == ["DSD-B"]


# ============== DRIFT LIFECYCLE ==============


def test_drift_is_upserted_not_duplicated(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    first = _evaluate(db)
    assert first["counts"]["drifted"] == 1
    assert db.drift_findings.inserted and len(db.drift_findings.rows) == 1
    finding = db.drift_findings.rows[0]
    assert finding["check"] == "firewall_enabled"
    assert finding["status"] == "open"
    assert finding["first_seen"] == FIXED_NOW.isoformat()
    assert finding["occurrences"] == 1
    assert finding["severity"] == "high"
    assert finding["client_id"] == "CLI-001"

    second = _evaluate(db)
    assert len(db.drift_findings.rows) == 1, "a re-evaluation must not invent a second finding"
    updated = db.drift_findings.rows[0]
    assert updated["occurrences"] == 2
    assert updated["first_seen"] == finding["first_seen"]
    assert second["drift"][0]["id"] == finding["id"]


def test_drift_clears_when_the_device_becomes_compliant(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    _evaluate(db)
    assert db.drift_findings.rows[0]["status"] == "open"

    db.devices.rows[0]["firewall_enabled"] = True
    cleared = _evaluate(db)
    assert cleared["counts"]["drifted"] == 0
    assert db.drift_findings.rows[0]["status"] == "resolved"
    assert db.drift_findings.rows[0]["resolved_at"] == FIXED_NOW.isoformat()
    assert cleared["drift"][0]["reason"] == "drift cleared by re-evaluation"


def test_unverified_does_not_silently_clear_an_open_finding(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    _evaluate(db)
    del db.devices.rows[0]["firewall_enabled"]
    _evaluate(db)
    assert db.drift_findings.rows[0]["status"] == "open", \
        "losing the evidence must not be read as compliance"


def test_propose_remediation_is_a_plan_and_respects_the_operational_mode(monkeypatch):
    _fixed_clock(monkeypatch)
    _normal_mode(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    _evaluate(db)
    finding_id = db.drift_findings.rows[0]["id"]

    missing_action = asyncio.run(nexus_device_state.propose_remediation(
        db, _user(), "Terry Tech", finding_id, {}))
    assert missing_action["error"] == "action is required"

    proposed = asyncio.run(nexus_device_state.propose_remediation(
        db, _user(), "Terry Tech", finding_id,
        {"action": "Enable the host firewall via policy"}))
    assert proposed["found"] is True
    assert proposed["permitted"] is True
    assert proposed["remediation"]["executed"] is False
    assert proposed["finding"]["status"] == "remediation_proposed"
    assert "will not execute it" in proposed["note"]

    _observe_only(monkeypatch)
    blocked = asyncio.run(nexus_device_state.propose_remediation(
        db, _user(), "Terry Tech", finding_id, {"action": "Enable the host firewall via policy"}))
    assert blocked["permitted"] is False
    assert blocked["mode"] == "observe_only"
    assert "suspected compromise" in blocked["note"]
    assert "Nothing has been changed" in blocked["note"]


def test_record_verification_resolves_reopens_and_waives(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]),
             drift_findings=_Collection([
                 {"id": "DRF-1", "tenant_id": "platform-a", "device_id": "dev-1", "check": "firewall_enabled",
                  "domain": "security", "severity": "high", "status": "open", "occurrences": 3,
                  "first_seen": "2026-09-01T00:00:00+00:00", "last_seen": "2026-10-04T00:00:00+00:00"},
                 {"id": "DRF-2", "tenant_id": "platform-a", "device_id": "dev-1", "check": "time_sync",
                  "domain": "configuration", "severity": "low", "status": "open", "occurrences": 1,
                  "first_seen": "2026-10-01T00:00:00+00:00", "last_seen": "2026-10-04T00:00:00+00:00"},
                 {"id": "DRF-3", "tenant_id": "platform-a", "device_id": "dev-1", "check": "bitlocker",
                  "domain": "encryption", "severity": "high", "status": "open", "occurrences": 1,
                  "first_seen": "2026-10-01T00:00:00+00:00", "last_seen": "2026-10-04T00:00:00+00:00"},
                 {"id": "DRF-4", "tenant_id": "platform-a", "device_id": "dev-1", "check": "edr_present",
                  "domain": "security", "severity": "high", "status": "resolved", "occurrences": 1,
                  "first_seen": "2026-09-01T00:00:00+00:00", "last_seen": "2026-09-02T00:00:00+00:00"},
             ]))

    assert asyncio.run(nexus_device_state.record_verification(
        db, _user(), "Terry Tech", "DRF-1", {"verdict": "shrug"}))["error"].startswith("verdict must be")

    resolved = asyncio.run(nexus_device_state.record_verification(
        db, _user(), "Terry Tech", "DRF-1", {"verdict": "verified", "evidence": "firewall on"}))
    assert resolved["finding"]["status"] == "resolved"
    assert resolved["finding"]["verification"]["recorded_by"] == "Terry Tech"

    reopened = asyncio.run(nexus_device_state.record_verification(
        db, _user(), "Terry Tech", "DRF-2", {"verdict": "still_drifted"}))
    assert reopened["finding"]["status"] == "open"
    assert reopened["finding"]["occurrences"] == 1

    needs_reason = asyncio.run(nexus_device_state.record_verification(
        db, _user(), "Terry Tech", "DRF-3", {"verdict": "waived"}))
    assert needs_reason["found"] is False
    assert needs_reason["error"] == "reason is required to waive a drift finding"

    waived = asyncio.run(nexus_device_state.record_verification(
        db, _user(), "Terry Tech", "DRF-3", {"verdict": "waived", "reason": "device retires next week"}))
    assert waived["finding"]["status"] == "waived"
    assert "deliberate, not forgotten" in waived["note"]

    already_closed = asyncio.run(nexus_device_state.record_verification(
        db, _user(), "Terry Tech", "DRF-4", {"verdict": "waived", "reason": "still gone"}))
    assert already_closed["found"] is False
    assert "closed once" in already_closed["error"]

    assert asyncio.run(nexus_device_state.record_verification(
        db, _user(), "Terry Tech", "DRF-GHOST", {"verdict": "verified"})) == {"found": False}


def test_proposal_on_a_closed_finding_is_rejected(monkeypatch):
    _fixed_clock(monkeypatch)
    _normal_mode(monkeypatch)
    db = _db(drift_findings=_Collection([
        {"id": "DRF-9", "tenant_id": "platform-a", "device_id": "dev-1", "check": "time_sync",
         "status": "resolved", "occurrences": 1},
    ]))
    refused = asyncio.run(nexus_device_state.propose_remediation(
        db, _user(), "Terry Tech", "DRF-9", {"action": "restart w32time"}))
    assert refused["found"] is False
    assert "already resolved" in refused["error"]


def test_list_drift_validates_status_and_orders_by_severity(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(drift_findings=_Collection([
        {"id": "DRF-L", "tenant_id": "platform-a", "device_id": "dev-1", "check": "time_sync",
         "severity": "low", "status": "open", "first_seen": "2026-10-01T00:00:00+00:00"},
        {"id": "DRF-H", "tenant_id": "platform-a", "device_id": "dev-2", "check": "bitlocker",
         "severity": "high", "status": "open", "first_seen": "2026-10-02T00:00:00+00:00"},
        {"id": "DRF-B", "tenant_id": "platform-b", "device_id": "dev-9", "check": "bitlocker",
         "severity": "high", "status": "open", "first_seen": "2026-10-03T00:00:00+00:00"},
        {"id": "DRF-D", "tenant_id": "platform-a", "device_id": "dev-3", "check": "firewall_enabled",
         "severity": "high", "status": "resolved", "first_seen": "2026-09-01T00:00:00+00:00"},
    ]))
    listed = asyncio.run(nexus_device_state.list_drift(db, _user()))
    assert listed["count"] == 3
    assert listed["open"] == 2
    assert [row["id"] for row in listed["findings"]][:2] == ["DRF-H", "DRF-L"]
    assert "first_seen is the truth" in listed["note"]

    bad = asyncio.run(nexus_device_state.list_drift(db, _user(), status="exploded"))
    assert bad["found"] is False
    assert "status must be one of" in bad["error"]

    resolved = asyncio.run(nexus_device_state.list_drift(db, _user(), status="resolved"))
    assert [row["id"] for row in resolved["findings"]] == ["DRF-D"]

    other = asyncio.run(nexus_device_state.list_drift(db, _user(tenant="platform-b")))
    assert [row["id"] for row in other["findings"]] == ["DRF-B"]


def test_evaluate_estate_is_bounded_and_totals_counts(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([
        _device("dev-1"),
        _device("dev-2", firewall_enabled=True),
        _device("dev-9", tenant="platform-b"),
    ]))
    estate = asyncio.run(nexus_device_state.evaluate_estate(db, _user()))
    assert estate["found"] is True
    assert estate["count"] == 2
    assert estate["counts"]["drifted"] == 1
    assert estate["counts"]["met"] == 7
    assert estate["counts"]["unverified"] == 8
    assert len(db.drift_findings.rows) == 1
    assert "unverified, never as healthy" in estate["note"]


def test_drift_summary_reports_honestly(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(drift_findings=_Collection([
        {"id": "DRF-1", "tenant_id": "platform-a", "client_id": "CLI-001", "device_id": "dev-1",
         "check": "bitlocker", "severity": "high", "status": "open",
         "first_seen": "2026-09-01T00:00:00+00:00", "occurrences": 4},
        {"id": "DRF-2", "tenant_id": "platform-a", "client_id": "CLI-002", "device_id": "dev-2",
         "check": "time_sync", "severity": "low", "status": "remediation_proposed",
         "first_seen": "2026-10-03T00:00:00+00:00", "occurrences": 1},
        {"id": "DRF-3", "tenant_id": "platform-a", "client_id": "CLI-002", "device_id": "dev-3",
         "check": "time_sync", "severity": "low", "status": "resolved",
         "first_seen": "2026-08-01T00:00:00+00:00", "occurrences": 2},
    ]))
    summary = asyncio.run(nexus_device_state.drift_summary(db, _user()))
    assert summary["found"] is True
    assert summary["open"] == 2
    assert summary["by_status"] == {"open": 1, "remediation_proposed": 1, "resolved": 1}
    assert summary["by_check"] == {"bitlocker": 1, "time_sync": 1}
    assert summary["by_client"] == {"CLI-001": 1, "CLI-002": 1}
    assert summary["oldest_open"]["id"] == "DRF-1"
    assert "real first_seen dates only" in summary["trend_note"]

    empty = asyncio.run(nexus_device_state.drift_summary(_db(), _user()))
    assert empty["open"] == 0
    assert empty["oldest_open"] is None
    assert "no trend to report" in empty["trend_note"]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
