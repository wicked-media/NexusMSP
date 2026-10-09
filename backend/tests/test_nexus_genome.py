"""Contract tests for the IT Genome: anonymised patterns, k-anonymised aggregates."""

import asyncio
import copy
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services import nexus_genome  # noqa: E402

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
    for name in ("users", "devices", "genome_patterns",):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": "platform-a", "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_genome, "_utcnow", lambda: FIXED_NOW)


def _run(coro):
    return asyncio.run(coro)


def _pattern(stack_fp, symptom, outcome, recorded_at, remediation="patch"):
    return {
        "id": f"GEN-{stack_fp[-4:]}-{symptom[-3:]}-{outcome}",
        "tenant_id": "platform-a",
        "stack_fingerprint": stack_fp,
        "symptom_fingerprint": nexus_genome.fingerprint(symptom),
        "hardware_class": "dell optiplex",
        "os_family": "windows 11",
        "software_family": "office",
        "symptom": symptom,
        "remediation_kind": remediation,
        "outcome": outcome,
        "recorded_at": recorded_at.isoformat(),
    }


# ============== CONTRIBUTION (privacy is structural) ==============


def test_contribute_pattern_stores_no_identifiers(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    result = _run(nexus_genome.contribute_pattern(db, _user(), "Sam Site", {
        "stack": {"hardware_model": "Dell OptiPlex 7010", "os": "Windows 11", "software": "Office"},
        "symptom": "NIC drops after update",
        "remediation_kind": "rollback", "outcome": "failure",
    }))
    assert result["found"] is True
    stored = db.genome_patterns.inserted[0]
    raw = str(stored)
    assert "Dell OptiPlex" not in raw  # hardware is folded into the one-way fingerprint
    assert "Sam Site" not in raw  # actor identity is hashed
    assert stored["privacy"]["contains_identifiers"] is False
    assert len(stored["stack_fingerprint"]) == 24
    assert stored["symptom"] == "nic drops after update"


def test_contribute_pattern_requires_symptom(monkeypatch):
    _fixed_clock(monkeypatch)
    result = _run(nexus_genome.contribute_pattern(
        db := _db(), _user(), "S", {"stack": {"os": "Windows 11"}, "outcome": "failure"}))
    assert result == {"found": False, "error": "symptom is required"}
    assert db.genome_patterns.inserted == []


def test_contribute_pattern_validates_outcome_and_stack(monkeypatch):
    _fixed_clock(monkeypatch)
    result = _run(nexus_genome.contribute_pattern(
        _db(), _user(), "S", {"symptom": "x", "outcome": "disaster", "stack": {"os": "w"}}))
    assert "outcome must be one of" in result["error"]
    result = _run(nexus_genome.contribute_pattern(
        _db(), _user(), "S", {"symptom": "x", "outcome": "failure"}))
    assert "stack attribute" in result["error"]


def test_contribution_report_counts_and_privacy(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(genome_patterns=_Collection([
        _pattern("aaa", "nic drops", "failure", FIXED_NOW - timedelta(days=1)),
        _pattern("aaa", "nic drops", "success", FIXED_NOW - timedelta(days=1), remediation="rollback"),
    ]))
    report = _run(nexus_genome.contribution_report(db, _user()))
    assert report["patterns_contributed"] == 2
    assert report["outcomes"] == {"failure": 1, "success": 1}
    assert report["distinct_stacks"] == 1
    assert report["privacy"]["k_anonymity_min"] == nexus_genome.MIN_CLUSTER
    assert report["privacy"]["identifying_fields_stored"] == []


def test_fingerprint_is_stable_and_one_way():
    first = nexus_genome.fingerprint("Dell OptiPlex", "Windows 11")
    assert first == nexus_genome.fingerprint("dell optiplex", "  windows   11 ")
    assert "Dell" not in first and "Windows" not in first


# ============== AGGREGATES (k-anonymity floor) ==============


def test_emerging_issues_hides_small_clusters(monkeypatch):
    _fixed_clock(monkeypatch)
    rows = [_pattern("aaa", "nic drops", "failure", FIXED_NOW - timedelta(days=1))
            for _ in range(2)]  # cluster of 2 < MIN_CLUSTER
    report = _run(nexus_genome.emerging_issues(_db(genome_patterns=_Collection(rows)), _user()))
    assert report["count"] == 0
    assert "never reported" in report["note"]


def test_emerging_issues_computes_lift_vs_prior(monkeypatch):
    _fixed_clock(monkeypatch)
    prior = ([_pattern("aaa", "nic drops", "failure", FIXED_NOW - timedelta(days=40))]
             + [_pattern("aaa", "nic drops", "success", FIXED_NOW - timedelta(days=40)) for _ in range(5)])
    recent = [_pattern("aaa", "nic drops", "failure", FIXED_NOW - timedelta(days=2)) for _ in range(6)]
    report = _run(nexus_genome.emerging_issues(
        _db(genome_patterns=_Collection(prior + recent)), _user(), window_days=14))
    assert report["count"] == 1
    issue = report["emerging_issues"][0]
    assert issue["recent_failures"] == 6
    assert issue["lift"] == 6.0  # 1.0 recent rate / (1/6) prior rate
    assert "the prior failure rate" in issue["baseline_note"]


def test_emerging_issues_reports_new_failures_without_baseline(monkeypatch):
    _fixed_clock(monkeypatch)
    rows = [_pattern("bbb", "disk full", "failure", FIXED_NOW - timedelta(days=1)) for _ in range(3)]
    report = _run(nexus_genome.emerging_issues(_db(genome_patterns=_Collection(rows)), _user()))
    issue = report["emerging_issues"][0]
    assert issue["lift"] is None
    assert "no prior baseline" in issue["baseline_note"]


def test_genome_insights_rank_fixes_by_success(monkeypatch):
    _fixed_clock(monkeypatch)
    rows = (
        [_pattern("aaa", "nic drops", "failure", FIXED_NOW, remediation="patch") for _ in range(3)]
        + [_pattern("aaa", "nic drops", "success", FIXED_NOW, remediation="rollback") for _ in range(3)]
    )
    report = _run(nexus_genome.genome_insights(_db(genome_patterns=_Collection(rows)), _user()))
    assert report["count"] == 1
    insight = report["insights"][0]
    assert insight["samples"] == 6
    assert insight["remedies"][0] == {"remediation_kind": "rollback", "attempts": 3,
                                      "successes": 3, "success_rate": 1.0}


def test_genome_insights_filters_by_symptom(monkeypatch):
    _fixed_clock(monkeypatch)
    rows = (
        [_pattern("aaa", "nic drops", "failure", FIXED_NOW) for _ in range(3)]
        + [_pattern("bbb", "printer cursed", "failure", FIXED_NOW) for _ in range(3)]
    )
    report = _run(nexus_genome.genome_insights(
        _db(genome_patterns=_Collection(rows)), _user(), symptom="NIC Drops"))
    assert report["count"] == 1
    assert report["insights"][0]["symptom"] == "nic drops"
