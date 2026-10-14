"""Contract tests for Nexus Rescue — plans, evidence, and honest boundaries."""

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

from app.services import nexus_rescue  # noqa: E402


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


def _db(**collections):
    namespace = SimpleNamespace()
    for name in ("rescue_sessions", "devices", "clients"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", tenant="platform-a"):
    return {"id": uid, "name": name, "role": "tech", "is_admin": False,
            "tenant_id": tenant, "client_scope_mode": "all"}


def _device(device_id="dev-1", tenant="platform-a", last_seen=None, **extra):
    row = {
        "id": device_id,
        "tenant_id": tenant,
        "hostname": "LT-102",
        "client_id": "c1",
        "os": "Windows 11",
        "last_seen": last_seen if last_seen is not None else (FIXED_NOW - timedelta(seconds=60)).isoformat(),
    }
    row.update(extra)
    return row


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_rescue, "_utcnow", lambda: FIXED_NOW)


# ============== THE CAPABILITY LADDER ==============


def test_capability_ladder_publishes_seven_capabilities_in_order():
    ladder = nexus_rescue.capability_ladder()
    assert ladder["order"] == [
        "repair_agent", "inspect_disk", "collect_logs", "repair_boot",
        "remove_problematic_update", "restore_configuration", "initiate_backup_recovery",
    ]
    assert [entry["capability"] for entry in ladder["capabilities"]] == ladder["order"]
    assert ladder["count"] == 7
    assert "plan" in ladder["note"] and "executed" in ladder["note"]
    for entry in ladder["capabilities"]:
        assert entry["boundary"].strip()
        assert entry["requires"]
        assert isinstance(entry["reversible"], bool)
        assert entry["risk"] in ("low", "medium", "high")
        assert entry["rollback"].strip()


# ============== ASSESSMENT AND REACHABILITY ==============


def test_assess_reports_live_agent_from_real_evidence(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))

    result = asyncio.run(nexus_rescue.assess(
        db, _user(), "Terry Tech", {"device_id": "dev-1", "symptom": "agent_dead"}))

    assert result["found"] is True
    assert result["agent_reachable"] is True
    assert result["evidence_used"]["agent_alive_window_seconds"] == nexus_rescue.AGENT_ALIVE_SECONDS
    assert "live agent" in result["reachability_note"].lower()
    reachable = {entry["capability"]: entry["reachable"] for entry in result["capabilities"]}
    assert reachable["repair_agent"] is True
    assert reachable["restore_configuration"] is True
    assert reachable["inspect_disk"] is False
    assert reachable["repair_boot"] is False
    assert result["recommended_path"][0] == "repair_agent"
    assert set(result["out_of_band_required"]) == {"collect_logs", "inspect_disk", "initiate_backup_recovery"}
    for key in result["out_of_band_required"]:
        assert key in result["recommended_path"]
        assert "out_of_band_recovery_path" in nexus_rescue.CAPABILITIES[key]["requires"]


def test_assess_stale_and_unparsable_check_ins_are_not_alive(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([
        _device("dev-stale", last_seen=(FIXED_NOW - timedelta(hours=2)).isoformat()),
        _device("dev-garbage", last_seen="yesterday-ish"),
    ]))

    stale = asyncio.run(nexus_rescue.assess(
        db, _user(), "Terry Tech", {"device_id": "dev-stale", "symptom": "no_boot"}))
    assert stale["agent_reachable"] is False
    assert "out-of-band" in stale["reachability_note"]
    assert "No out-of-band recovery path is registered" in stale["reachability_note"]
    assert {entry["capability"] for entry in stale["capabilities"] if entry["reachable"]} == set()

    garbage = asyncio.run(nexus_rescue.assess(
        db, _user(), "Terry Tech", {"device_id": "dev-garbage", "symptom": "unknown"}))
    assert garbage["agent_reachable"] is False
    assert "not treated as alive" in garbage["reachability_note"]


def test_assess_rejects_unknown_symptom_and_missing_device_id(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))

    bad = asyncio.run(nexus_rescue.assess(
        db, _user(), "Terry Tech", {"device_id": "dev-1", "symptom": "sunspots"}))
    assert bad["found"] is False
    assert "symptom must be one of" in bad["error"]

    missing = asyncio.run(nexus_rescue.assess(db, _user(), "Terry Tech", {}))
    assert missing["error"] == "device_id is required"


def test_assess_missing_or_foreign_device_is_not_found(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device("dev-1", tenant="platform-b")]))

    foreign = asyncio.run(nexus_rescue.assess(db, _user(), "Terry Tech", {"device_id": "dev-1"}))
    assert foreign == {"found": False}
    assert asyncio.run(nexus_rescue.assess(db, _user(), "Terry Tech", {"device_id": "ghost"})) == {"found": False}


def test_registered_out_of_band_path_marks_offline_capabilities_reachable(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device(
        out_of_band_recovery_path=True,
        last_seen=(FIXED_NOW - timedelta(hours=3)).isoformat(),
    )]))

    result = asyncio.run(nexus_rescue.assess(
        db, _user(), "Terry Tech", {"device_id": "dev-1", "symptom": "no_boot"}))

    reachable = {entry["capability"] for entry in result["capabilities"] if entry["reachable"]}
    assert {"collect_logs", "inspect_disk", "repair_boot"} <= reachable
    assert "restore_configuration" not in reachable  # still needs a live agent
    assert "No out-of-band recovery path is registered" not in result["reachability_note"]


def test_recommended_paths_change_with_the_symptom(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))

    update = asyncio.run(nexus_rescue.assess(
        db, _user(), "Terry Tech", {"device_id": "dev-1", "symptom": "update_broke_startup"}))
    assert update["recommended_path"][0] == "collect_logs"
    assert "remove_problematic_update" in update["recommended_path"]

    network = asyncio.run(nexus_rescue.assess(
        db, _user(), "Terry Tech", {"device_id": "dev-1", "symptom": "network_stack"}))
    assert network["recommended_path"][0] == "repair_agent"

    assert set(nexus_rescue.RECOMMENDED_PATHS["unknown"]) == set(nexus_rescue.CAPABILITY_ORDER)


# ============== RECOVERY SESSIONS ==============


def test_start_recovery_rejects_unknown_capability_and_empty_list(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))

    bad = asyncio.run(nexus_rescue.start_recovery(
        db, _user(), "Terry Tech", {"device_id": "dev-1", "capabilities": ["melt_disk"]}))
    assert bad["found"] is False
    assert bad["error"] == "unknown rescue capability 'melt_disk'"

    empty = asyncio.run(nexus_rescue.start_recovery(
        db, _user(), "Terry Tech", {"device_id": "dev-1", "capabilities": []}))
    assert empty["error"] == "select at least one recovery capability"
    assert db.rescue_sessions.inserted == []


def test_start_recovery_plans_and_never_executes(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))

    result = asyncio.run(nexus_rescue.start_recovery(db, _user(), "Terry Tech", {
        "device_id": "dev-1", "symptom": "no_boot",
        "capabilities": ["collect_logs", "repair_boot"], "ticket_id": "INC-0001",
    }))

    session = result["session"]
    assert session["id"].startswith("RSC-")
    assert session["status"] == "planned"
    assert session["approval_required"] is True
    assert session["status"] in nexus_rescue.SESSION_STATUSES
    assert "executed" not in nexus_rescue.SESSION_STATUSES
    assert session["steps"] == []
    assert [entry["capability"] for entry in session["capabilities"]] == ["collect_logs", "repair_boot"]
    assert all(step["actor"] == "technician" for entry in session["capabilities"] for step in entry["steps"])
    assert session["out_of_band_required"] == ["collect_logs", "repair_boot"]

    stored = db.rescue_sessions.inserted[0]
    assert stored["status"] == "planned"
    assert stored["tenant_id"] == "platform-a"
    assert "planned" in result["note"].lower()
    assert "approval is required" in result["note"]


def test_record_step_appends_with_one_based_index_and_human_actor(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    session = asyncio.run(nexus_rescue.start_recovery(db, _user(), "Terry Tech", {
        "device_id": "dev-1", "symptom": "no_boot", "capabilities": ["collect_logs"]}))["session"]

    first = asyncio.run(nexus_rescue.record_step(db, _user(), "Terry Tech", session["id"], {
        "kind": "technician_action", "detail": "booted the machine from the recovery USB"}))
    assert first["step"]["index"] == 1
    assert first["step"]["performed_by"] == "technician"
    assert first["step"]["recorded_by"] == "Terry Tech"
    assert first["session"]["status"] == "in_progress"

    second = asyncio.run(nexus_rescue.record_step(db, _user(), "Terry Tech", session["id"], {
        "kind": "verification", "detail": "volume mounted read-only"}))
    assert second["step"]["index"] == 2
    assert [step["index"] for step in second["session"]["steps"]] == [1, 2]

    bad = asyncio.run(nexus_rescue.record_step(
        db, _user(), "Terry Tech", session["id"], {"kind": "execute"}))
    assert bad["found"] is False
    assert "kind must be one of" in bad["error"]
    assert asyncio.run(nexus_rescue.record_step(
        db, _user(), "Terry Tech", "ghost", {"kind": "note"})) == {"found": False}


def test_closed_sessions_refuse_more_steps(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    session = asyncio.run(nexus_rescue.start_recovery(db, _user(), "Terry Tech", {
        "device_id": "dev-1", "symptom": "no_boot", "capabilities": ["collect_logs"]}))["session"]

    closed = asyncio.run(nexus_rescue.record_step(db, _user(), "Terry Tech", session["id"], {
        "kind": "verification", "detail": "Windows boots normally", "close_as": "resolved"}))
    assert closed["session"]["status"] == "resolved"
    assert closed["session"]["closed_by"] == "Terry Tech"

    blocked = asyncio.run(nexus_rescue.record_step(
        db, _user(), "Terry Tech", session["id"], {"kind": "note"}))
    assert blocked["found"] is False
    assert "append-only" in blocked["error"]

    bad_close = asyncio.run(nexus_rescue.record_step(db, _user(), "Terry Tech", session["id"], {
        "kind": "note", "close_as": "executed"}))
    assert "close_as must be one of" in bad_close["error"]


def test_sessions_are_tenant_scoped(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([_device(), _device("dev-2", tenant="platform-b")]),
        rescue_sessions=_Collection([
            {"id": "RSC-A", "tenant_id": "platform-a", "device_id": "dev-1", "symptom": "no_boot",
             "status": "planned", "capabilities": [{"capability": "collect_logs"}], "steps": [],
             "created_at": "2026-10-03T09:00:00+00:00"},
            {"id": "RSC-B", "tenant_id": "platform-b", "device_id": "dev-2", "symptom": "no_boot",
             "status": "planned", "capabilities": [{"capability": "collect_logs"}], "steps": [],
             "created_at": "2026-10-04T09:00:00+00:00"},
        ]),
    )

    listed = asyncio.run(nexus_rescue.list_sessions(db, _user()))
    assert listed["count"] == 1
    assert [item["id"] for item in listed["sessions"]] == ["RSC-A"]
    assert listed["sessions"][0]["capabilities"] == ["collect_logs"]
    assert asyncio.run(nexus_rescue.get_session(db, _user(), "RSC-B")) == {"found": False}

    other = asyncio.run(nexus_rescue.list_sessions(db, _user("u2", "Other Tech", tenant="platform-b")))
    assert [item["id"] for item in other["sessions"]] == ["RSC-B"]


def test_rescue_console_shows_evidence_and_the_first_step(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([_device()]),
        rescue_sessions=_Collection([
            {"id": "RSC-OPEN", "tenant_id": "platform-a", "device_id": "dev-1", "symptom": "no_boot",
             "status": "in_progress", "capabilities": [{"capability": "collect_logs"}], "steps": [],
             "created_at": "2026-10-04T07:00:00+00:00"},
        ]),
    )

    console = asyncio.run(nexus_rescue.rescue_console(db, _user(), "dev-1"))
    assert console["found"] is True
    assert console["agent"]["reachable"] is True
    assert console["agent"]["evidence"]["agent_alive_window_seconds"] == nexus_rescue.AGENT_ALIVE_SECONDS
    assert "repair_boot" in console["capabilities_unreachable"]
    assert console["recommended_first_step"]["capability"] == "repair_agent"
    assert [item["id"] for item in console["open_sessions"]] == ["RSC-OPEN"]
    assert "not an executed action" in console["note"]

    assert asyncio.run(nexus_rescue.rescue_console(db, _user(), "ghost")) == {"found": False}
