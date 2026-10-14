"""Contract tests for the Nexus Synthetic Employee (business-workflow checks)."""

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

from app.services import nexus_synthetic  # noqa: E402


FIXED_NOW = datetime(2026, 10, 4, 8, 0, tzinfo=timezone.utc)


# ============== MINIMAL MONGO FAKES (same contract as test_nexus_decision_family) ==============


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
    for name in ("synthetic_identities", "synthetic_runs"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False, tenant="platform-a"):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": tenant, "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_synthetic, "_utcnow", lambda: FIXED_NOW)


def _register(db, user=None, **overrides):
    payload = {"label": "Payroll access", "client_id": "c1"}
    payload.update(overrides)
    return asyncio.run(nexus_synthetic.register_identity(db, user or _user(), "Terry Tech", payload))


def _run(db, identity_id, results, user=None, **overrides):
    payload = {"identity_id": identity_id, "results": results}
    payload.update(overrides)
    return asyncio.run(nexus_synthetic.record_run(db, user or _user(), "Terry Tech", payload))


def _verdicts(identity, verdict="pass"):
    return [{"check": check, "verdict": verdict} for check in identity["checks"]]


# ============== CHECK CATALOG ==============


def test_catalog_publishes_only_safe_checks():
    catalog = nexus_synthetic.check_catalog()
    keys = [entry["check"] for entry in catalog["checks"]]
    assert len(keys) >= 8
    assert len(set(keys)) == len(keys)
    assert {"authenticate", "resolve_dns", "open_web_app", "api_read",
            "read_authorised_share", "send_test_mail", "receive_test_mail",
            "sharepoint_read"} <= set(keys)
    assert all(entry["access"] in nexus_synthetic.ACCESS_KINDS for entry in catalog["checks"])
    assert all(entry["business_meaning"] for entry in catalog["checks"])
    assert "read-only" in catalog["note"]
    assert "unavailable, never as a pass" in catalog["note"]
    assert catalog["verdicts"] == ["pass", "fail", "unavailable"]


# ============== REGISTRATION ==============


def test_register_identity_requires_a_label(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    assert _register(db, label="   ")["error"] == "label is required"
    assert db.synthetic_identities.inserted == []


def test_register_identity_rejects_unknown_and_empty_checks(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    assert "unknown check" in _register(db, checks=["teleport"])["error"]
    assert _register(db, checks=[])["error"] == "at least one check is required"
    assert _register(db, checks="authenticate")["error"] == "checks must be a list of check names"
    assert db.synthetic_identities.inserted == []


def test_register_identity_defaults_to_the_full_catalog(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    result = _register(db)
    assert result["found"] is True
    identity = result["identity"]
    assert identity["id"].startswith("SYN-")
    assert identity["checks"] == [entry["check"] for entry in nexus_synthetic.CHECKS]
    assert identity["interval_minutes"] == 30
    assert identity["next_run_hint"] == "every 30 minutes"
    assert identity["enabled"] is True
    assert identity["tenant_id"] == "platform-a"
    assert identity["client_id"] == "c1"
    assert identity["created_by_name"] == "Terry Tech"
    assert identity["created_at"] == FIXED_NOW.isoformat()
    assert identity["last_verdict"] == ""
    assert identity["last_run_at"] == ""


def test_register_identity_refuses_credentials_and_persists_nothing(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    expected = ("synthetic identities never store credentials — supply credential_ref "
                "pointing at the secret store instead")
    direct = asyncio.run(nexus_synthetic.register_identity(db, _user(), "Terry Tech", {
        "label": "Payroll access", "credential": {"password": "hunter2"}}))
    assert direct == {"found": False, "error": expected}
    nested = asyncio.run(nexus_synthetic.register_identity(db, _user(), "Terry Tech", {
        "label": "Payroll access", "targets": [{"check": "api_read", "token": "abc123"}]}))
    assert nested == {"found": False, "error": expected}
    assert "hunter2" not in str(direct)
    assert "abc123" not in str(nested)
    assert db.synthetic_identities.inserted == []
    assert db.synthetic_identities.rows == []


def test_register_identity_accepts_a_credential_reference_only(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    result = _register(db, credential_ref="secret-store://syn-payroll", checks=["authenticate"])
    assert result["found"] is True
    identity = result["identity"]
    assert identity["credential_ref"] == "secret-store://syn-payroll"
    assert identity["checks"] == ["authenticate"]


def test_set_identity_state_validates_and_toggles(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    identity = _register(db)["identity"]

    invalid = asyncio.run(nexus_synthetic.set_identity_state(
        db, _user(), identity["id"], {"enabled": "yes"}))
    assert invalid["found"] is False
    assert invalid["error"] == "enabled must be true or false"

    off = asyncio.run(nexus_synthetic.set_identity_state(
        db, _user(), identity["id"], {"enabled": False}))
    assert off["found"] is True
    assert off["identity"]["enabled"] is False
    assert "paused" in off["note"]

    missing = asyncio.run(nexus_synthetic.set_identity_state(
        db, _user(), "SYN-GHOST", {"enabled": True}))
    assert missing == {"found": False}


# ============== RUNS AND HONEST VERDICTS ==============


def test_all_pass_run_is_healthy_and_stamps_the_identity(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    identity = _register(db)["identity"]
    outcome = _run(db, identity["id"], _verdicts(identity))

    assert outcome["found"] is True
    assert outcome["verdict"] == "healthy"
    assert outcome["business_statement"] == "Payroll access: the business workflow works end to end"
    assert outcome["coverage"] == {"declared": 8, "ran": 8, "unavailable": 0}
    assert outcome["run"]["id"].startswith("RUN-")
    assert outcome["run"]["tenant_id"] == "platform-a"
    assert outcome["run"]["started_at"] == FIXED_NOW.isoformat()
    assert db.synthetic_runs.inserted[0]["verdict"] == "healthy"

    stamped = asyncio.run(nexus_synthetic.identity_status(db, _user(), identity["id"]))["identity"]
    assert stamped["last_verdict"] == "healthy"
    assert stamped["last_business_statement"] == outcome["business_statement"]
    assert stamped["last_run_at"] == FIXED_NOW.isoformat()


def test_failed_check_reports_failed_and_names_the_check(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    identity = _register(db)["identity"]
    results = [{"check": check, "verdict": "pass"} for check in identity["checks"]
               if check != "send_test_mail"]
    results.append({"check": "send_test_mail", "verdict": "fail", "detail": "550 relay denied"})

    outcome = _run(db, identity["id"], results)
    assert outcome["verdict"] == "failed"
    assert "send_test_mail" in outcome["business_statement"]
    assert outcome["coverage"] == {"declared": 8, "ran": 8, "unavailable": 0}
    failed = [item for item in outcome["run"]["results"] if item["verdict"] == "fail"]
    assert failed[0]["label"] == "Send test mail"
    assert failed[0]["detail"] == "550 relay denied"


def test_missing_declared_check_degrades_and_never_claims_healthy(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    identity = _register(db, checks=["authenticate", "resolve_dns", "open_web_app"])["identity"]
    outcome = _run(db, identity["id"], [
        {"check": "authenticate", "verdict": "pass"},
        {"check": "resolve_dns", "verdict": "pass"},
    ])

    assert outcome["verdict"] == "degraded"
    assert outcome["coverage"] == {"declared": 3, "ran": 2, "unavailable": 1}
    assert "not proven healthy" in outcome["business_statement"]
    assert "open_web_app" in outcome["business_statement"]
    reported = outcome["run"]["results"][-1]
    assert reported["check"] == "open_web_app"
    assert reported["verdict"] == "unavailable"
    assert reported["detail"] == "declared check reported no result in this run"


def test_explicit_unavailable_verdict_also_degrades(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    identity = _register(db, checks=["authenticate", "sharepoint_read"])["identity"]
    outcome = _run(db, identity["id"], [
        {"check": "authenticate", "verdict": "pass"},
        {"check": "sharepoint_read", "verdict": "unavailable",
         "detail": "test identity is not licensed for SharePoint"},
    ])

    assert outcome["verdict"] == "degraded"
    assert outcome["coverage"] == {"declared": 2, "ran": 2, "unavailable": 1}
    assert "sharepoint_read" in outcome["business_statement"]
    assert "not proven healthy" in outcome["business_statement"]


def test_latency_totals_ignore_unmeasured_checks(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    identity = _register(db, checks=["authenticate", "resolve_dns"])["identity"]
    outcome = _run(db, identity["id"], [
        {"check": "authenticate", "verdict": "pass", "latency_ms": 120},
        {"check": "resolve_dns", "verdict": "pass", "latency_ms": "80"},
    ])
    assert outcome["run"]["latency_ms_total"] == 200
    assert all(item["latency_ms"] is not None for item in outcome["run"]["results"])


def test_record_run_validates_identity_check_and_verdict(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    identity = _register(db, checks=["authenticate"])["identity"]

    assert _run(db, "SYN-GHOST", [{"check": "authenticate", "verdict": "pass"}]) == {"found": False}
    assert "unknown check" in _run(db, identity["id"], [{"check": "teleport", "verdict": "pass"}])["error"]
    assert "declared checks" in _run(db, identity["id"], [{"check": "api_read", "verdict": "pass"}])["error"]
    assert "verdict must be" in _run(db, identity["id"], [{"check": "authenticate", "verdict": "maybe"}])["error"]
    assert _run(db, identity["id"], [])["error"] == "results must be a non-empty list of check outcomes"
    assert _run(db, identity["id"], [{"check": "authenticate", "verdict": "pass"},
                                     {"check": "authenticate", "verdict": "pass"}])["found"] is False
    assert db.synthetic_runs.inserted == []


# ============== STATUS, OVERVIEW AND ISOLATION ==============


def test_identity_status_history_trend_and_missing_identity(monkeypatch):
    # An advancing clock keeps run ordering unambiguous: real runs are seconds apart.
    clock = {"now": FIXED_NOW}
    monkeypatch.setattr(nexus_synthetic, "_utcnow", lambda: clock["now"])
    db = _db()
    identity = _register(db, checks=["authenticate", "resolve_dns"])["identity"]

    assert asyncio.run(nexus_synthetic.identity_status(db, _user(), "SYN-GHOST")) == {"found": False}

    empty = asyncio.run(nexus_synthetic.identity_status(db, _user(), identity["id"]))
    assert empty["found"] is True
    assert empty["latest_run"] is None
    assert empty["history"] == []
    assert "unproven" in empty["trend_note"]

    clock["now"] += timedelta(minutes=5)
    _run(db, identity["id"], _verdicts(identity))
    one = asyncio.run(nexus_synthetic.identity_status(db, _user(), identity["id"]))
    assert len(one["history"]) == 1
    assert one["latest_run"]["verdict"] == "healthy"
    assert "single observation" in one["trend_note"]

    clock["now"] += timedelta(minutes=5)
    _run(db, identity["id"], _verdicts(identity))
    two = asyncio.run(nexus_synthetic.identity_status(db, _user(), identity["id"]))
    assert len(two["history"]) == 2
    assert "consecutive healthy" in two["trend_note"]

    clock["now"] += timedelta(minutes=5)
    _run(db, identity["id"], [{"check": "authenticate", "verdict": "fail"},
                              {"check": "resolve_dns", "verdict": "pass"}])
    three = asyncio.run(nexus_synthetic.identity_status(db, _user(), identity["id"]))
    assert three["latest_run"]["verdict"] == "failed"
    assert [entry["verdict"] for entry in three["history"]] == ["failed", "healthy", "healthy"]
    assert "not currently clean" in three["trend_note"]


def test_paused_identity_stays_readable_and_is_flagged(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    identity = _register(db, checks=["authenticate"])["identity"]
    _run(db, identity["id"], _verdicts(identity))
    asyncio.run(nexus_synthetic.set_identity_state(db, _user(), identity["id"], {"enabled": False}))

    status = asyncio.run(nexus_synthetic.identity_status(db, _user(), identity["id"]))
    assert status["found"] is True
    assert status["identity"]["state"] == "paused"
    assert status["latest_run"]["verdict"] == "healthy"


def test_tenant_isolation(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    identity = _register(db)["identity"]

    other_tenant = _user(uid="tech-9", tenant="platform-b")
    assert asyncio.run(nexus_synthetic.identity_status(db, other_tenant, identity["id"])) == {"found": False}
    assert asyncio.run(nexus_synthetic.list_identities(db, other_tenant))["count"] == 0
    assert asyncio.run(nexus_synthetic.synthetic_overview(db, other_tenant))["count"] == 0
    assert asyncio.run(nexus_synthetic.set_identity_state(
        db, other_tenant, identity["id"], {"enabled": False})) == {"found": False}
    assert db.synthetic_runs.inserted == []


def test_synthetic_overview_counts_and_flags_never_run(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    payroll = _register(db, label="Payroll access", checks=["authenticate"])["identity"]
    files = _register(db, label="Files access", checks=["read_authorised_share"])["identity"]
    crm = _register(db, label="CRM access", client_id="c2", checks=["open_web_app"])["identity"]

    _run(db, payroll["id"], [{"check": "authenticate", "verdict": "pass"}])
    _run(db, files["id"], [{"check": "read_authorised_share", "verdict": "fail"}])
    asyncio.run(nexus_synthetic.set_identity_state(db, _user(), crm["id"], {"enabled": False}))

    overview = asyncio.run(nexus_synthetic.synthetic_overview(db, _user()))
    assert overview["count"] == 3
    assert overview["by_verdict"] == {"healthy": 1, "degraded": 0, "failed": 1, "never_run": 1}
    assert overview["never_run"] == [crm["id"]]
    assert overview["paused"] == [crm["id"]]
    assert "unknown, not a healthy service" in overview["note"]

    scoped = asyncio.run(nexus_synthetic.list_identities(db, _user(), client_id="c2"))
    assert scoped["count"] == 1
    assert scoped["identities"][0]["id"] == crm["id"]

    scoped_overview = asyncio.run(nexus_synthetic.synthetic_overview(db, _user(), client_id="c1"))
    assert scoped_overview["count"] == 2
    assert scoped_overview["by_verdict"]["healthy"] == 1
