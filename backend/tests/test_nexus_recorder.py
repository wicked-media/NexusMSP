"""Contract tests for the Nexus Command Recorder."""

import asyncio
import copy
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services import nexus_recorder  # noqa: E402


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
    for name in ("recorded_sessions", "recorded_runbooks"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", tenant="platform-a"):
    return {"id": uid, "name": name, "role": "tech", "is_admin": False,
            "tenant_id": tenant, "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_recorder, "_utcnow", lambda: FIXED_NOW)


def _open_session(db, **overrides):
    payload = {"label": "Fix print spooler", "device_id": "dev-001", "client_id": "c1"}
    payload.update(overrides)
    result = asyncio.run(nexus_recorder.start_session(db, _user(), "Terry Tech", payload))
    return result["session"]


def _record(db, session_id, kind, command="", detail=""):
    return asyncio.run(nexus_recorder.record_step(
        db, _user(), session_id, {"kind": kind, "command": command, "detail": detail}))


def _draft(db, session_id, **payload):
    return asyncio.run(nexus_recorder.propose_runbook(
        db, _user(), "Terry Tech", session_id, payload))


# ============== RECORDING ==============


def test_start_session_requires_label_and_valid_kind(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    assert asyncio.run(nexus_recorder.start_session(
        db, _user(), "Terry Tech", {"label": "   "}))["error"] == "label is required"
    bad_kind = asyncio.run(nexus_recorder.start_session(
        db, _user(), "Terry Tech", {"label": "x", "kind": "sorcery"}))
    assert "kind must be one of" in bad_kind["error"]
    assert db.recorded_sessions.inserted == []


def test_start_session_defaults_to_manual_fix_and_stamps_tenant(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    session = _open_session(db)
    assert session["id"].startswith("REC-")
    assert session["kind"] == "manual_fix"
    assert session["status"] == "recording"
    assert session["outcome"] == ""
    assert session["steps"] == []
    assert session["tenant_id"] == "platform-a"
    assert session["created_at"] == FIXED_NOW.isoformat()
    assert session["ended_at"] == ""


def test_record_step_redacts_secrets_before_storage(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    session = _open_session(db)
    stored = _record(db, session["id"], "command",
                     "mysql -u root --password=hunter2 -e 'select 1'")["step"]
    assert "hunter2" not in stored["command"]
    assert "[redacted]" in stored["command"]
    also = _record(db, session["id"], "command", "set-api token=abc123def456")["step"]
    assert "abc123def456" not in also["command"]
    bearer = nexus_recorder.redact_text("curl -H 'Authorization: Bearer abcdef1234567890'")
    assert "abcdef1234567890" not in bearer
    # The redaction is applied to the persisted row too, not just the response.
    assert "hunter2" not in str(db.recorded_sessions.rows[0])


def test_redaction_covers_the_windows_shapes_technicians_actually_type():
    """Space-separated and slash-flag secrets are how Windows techs write them."""
    for shape in (
        "Restart-Service Spooler -Password hunter3 -Force",
        "net use /user:acme /p hunter4",
        "connect --token hunter5",
        "setup /password hunter6",
        "runas /password:hunter7 cmd",
        "mysql --password hunter8 -e 'select 1'",
        "connect /api-key hunter9",
    ):
        cleaned = nexus_recorder.redact_text(shape)
        assert "hunter" not in cleaned, shape
        assert "[redacted]" in cleaned, shape


def test_record_step_rejects_bad_kind_and_empty_command(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    session = _open_session(db)
    bad = _record(db, session["id"], "telepathy", "echo hi")
    assert "kind must be one of" in bad["error"]
    empty = _record(db, session["id"], "command", "   ")
    assert empty["error"] == "a command step needs a command"
    assert db.recorded_sessions.rows[0]["steps"] == []


def test_record_step_indexes_append_only_and_closed_sessions_are_immutable(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    session = _open_session(db)
    first = _record(db, session["id"], "command", "Restart-Service Spooler")["step"]
    second = _record(db, session["id"], "verification", detail="Print test page succeeded")["step"]
    assert (first["index"], second["index"]) == (1, 2)

    ended = asyncio.run(nexus_recorder.end_session(db, _user(), session["id"], {"outcome": "success"}))
    assert ended["found"] is True
    assert ended["session"]["status"] == "completed"
    assert ended["session"]["ended_at"] == FIXED_NOW.isoformat()

    blocked = _record(db, session["id"], "command", "echo late")
    assert blocked["found"] is False
    assert "append-only" in blocked["error"]
    assert blocked["error"] == (
        "session is completed — steps are append-only and closed sessions are immutable")
    assert len(db.recorded_sessions.rows[0]["steps"]) == 2


def test_end_session_validates_outcome_and_cannot_end_twice(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    session = _open_session(db)
    bad = asyncio.run(nexus_recorder.end_session(db, _user(), session["id"], {"outcome": "maybe"}))
    assert "outcome must be one of" in bad["error"]
    assert asyncio.run(nexus_recorder.end_session(
        db, _user(), session["id"], {"outcome": "success"}))["found"] is True
    again = asyncio.run(nexus_recorder.end_session(db, _user(), session["id"], {"outcome": "failure"}))
    assert again["found"] is False
    assert "cannot be ended again" in again["error"]
    assert asyncio.run(nexus_recorder.end_session(
        db, _user(), "ghost", {"outcome": "success"})) == {"found": False}


# ============== DRAFTING ==============


def test_propose_runbook_refuses_when_nothing_was_recorded(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    session = _open_session(db)
    _record(db, session["id"], "note", detail="customer was grumpy")
    refused = _draft(db, session["id"])
    assert refused["found"] is False
    assert refused["error"] == "no recorded commands to turn into a runbook"
    assert db.recorded_runbooks.inserted == []
    assert _draft(db, "ghost") == {"found": False}


def test_propose_runbook_derives_real_structure_from_the_recording(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    session = _open_session(db)
    _record(db, session["id"], "command", "sudo systemctl restart <ServiceName>")
    _record(db, session["id"], "output", "restart ok")
    _record(db, session["id"], "command", "copy {BackupPath}\\config.xml C:\\ProgramData\\App")
    _record(db, session["id"], "note", detail="spooler had a stuck job")
    _record(db, session["id"], "verification", detail="printed a test page")
    _record(db, session["id"], "rollback", detail="stop the service and restore the old config")
    asyncio.run(nexus_recorder.end_session(db, _user(), session["id"], {"outcome": "success"}))

    result = _draft(db, session["id"], title="Restart the spooler safely")
    assert result["found"] is True
    runbook = result["runbook"]
    assert runbook["id"].startswith("RBK-")
    assert runbook["title"] == "Restart the spooler safely"
    assert runbook["source_session_id"] == session["id"]
    assert runbook["status"] == "draft"
    assert runbook["verified_successes"] == 0
    assert runbook["uses"] == 0
    assert runbook["autonomy_candidate"] is False

    # Only real command/action steps become actions, in recorded order.
    assert [step["command"] for step in runbook["actions"]] == [
        "sudo systemctl restart <ServiceName>",
        "copy {BackupPath}\\config.xml C:\\ProgramData\\App",
    ]
    assert runbook["variables"] == ["ServiceName", "BackupPath"]
    assert "Elevated rights on the target" in runbook["prerequisites"]
    assert any("dev-001" in item for item in runbook["prerequisites"])
    assert len(runbook["verification"]) == 1
    assert len(runbook["rollback"]) == 1

    confidence = result["confidence"]
    assert confidence["level"] == "reviewed-draft"
    assert confidence["recorded_actions"] == 2
    assert confidence["has_verification"] is True
    assert confidence["has_rollback"] is True
    assert "zero verified successes" in confidence["basis"]
    assert "human must review" in result["note"]


def test_propose_runbook_flags_missing_verification_and_rollback(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    session = _open_session(db)
    _record(db, session["id"], "command", "Restart-Service Spooler")
    result = _draft(db, session["id"])
    assert result["runbook"]["verification"] == []
    assert result["confidence"]["level"] == "unverified-draft"
    assert "No verification step was recorded" in result["note"]
    assert "No rollback step was recorded" in result["note"]
    assert "No variable placeholders" in result["note"]


# ============== VERIFICATION AND AUTONOMY ==============


def _verified_runbook(db):
    session = _open_session(db)
    _record(db, session["id"], "command", "Restart-Service Spooler")
    return _draft(db, session["id"])["runbook"]


def test_three_verified_successes_make_a_candidate_but_never_grant_autonomy(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    runbook = _verified_runbook(db)

    first = asyncio.run(nexus_recorder.verify_runbook(
        db, _user(), "Terry Tech", runbook["id"], {"outcome": "success"}))
    assert first["verified_successes"] == 1
    assert first["autonomy_candidate"] is False
    assert "1 of 3" in first["note"]

    asyncio.run(nexus_recorder.verify_runbook(db, _user(), "Terry Tech", runbook["id"], {"outcome": "success"}))
    third = asyncio.run(nexus_recorder.verify_runbook(
        db, _user(), "Terry Tech", runbook["id"], {"outcome": "success"}))
    assert third["verified_successes"] == 3
    assert third["autonomy_candidate"] is True
    assert third["runbook"]["status"] == "verified"
    assert third["runbook"]["uses"] == 3
    assert "explicit human approval" in third["note"]
    assert "never enables it by itself" in third["note"]


def test_verification_validates_outcome_and_unknown_runbook(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    runbook = _verified_runbook(db)
    bad = asyncio.run(nexus_recorder.verify_runbook(
        db, _user(), "Terry Tech", runbook["id"], {"outcome": "probably"}))
    assert "outcome must be one of" in bad["error"]
    assert asyncio.run(nexus_recorder.verify_runbook(
        db, _user(), "Terry Tech", "ghost", {"outcome": "success"})) == {"found": False}
    assert db.recorded_runbooks.rows[0]["uses"] == 0


def test_failed_verification_demotes_a_verified_runbook(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    runbook = _verified_runbook(db)
    for _ in range(nexus_recorder.MIN_VERIFIED_SUCCESSES):
        asyncio.run(nexus_recorder.verify_runbook(
            db, _user(), "Terry Tech", runbook["id"], {"outcome": "success"}))
    assert db.recorded_runbooks.rows[0]["autonomy_candidate"] is True

    failed = asyncio.run(nexus_recorder.verify_runbook(
        db, _user(), "Terry Tech", runbook["id"], {"outcome": "failure"}))
    assert failed["runbook"]["status"] == "needs_review"
    assert failed["autonomy_candidate"] is False
    assert "no longer an autonomy candidate" in failed["note"]
    assert db.recorded_runbooks.rows[0]["uses"] == nexus_recorder.MIN_VERIFIED_SUCCESSES + 1


def test_partial_outcome_counts_as_a_use_but_not_a_success(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    runbook = _verified_runbook(db)
    partial = asyncio.run(nexus_recorder.verify_runbook(
        db, _user(), "Terry Tech", runbook["id"], {"outcome": "partial", "note": "half worked"}))
    assert partial["runbook"]["uses"] == 1
    assert partial["verified_successes"] == 0
    assert partial["autonomy_candidate"] is False
    assert partial["runbook"]["last_note"] == "half worked"
    assert "gains no verified success" in partial["note"]


# ============== SCOPE AND LISTING ==============


def test_sessions_and_runbooks_are_tenant_scoped(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    session = _open_session(db)
    _record(db, session["id"], "command", "Restart-Service Spooler")
    _draft(db, session["id"])

    outsider = _user(uid="tech-9", name="Olive Other", tenant="platform-b")
    assert asyncio.run(nexus_recorder.get_session(db, outsider, session["id"])) == {"found": False}
    assert asyncio.run(nexus_recorder.list_sessions(db, outsider))["count"] == 0
    assert asyncio.run(nexus_recorder.list_runbooks(db, outsider))["count"] == 0
    assert asyncio.run(nexus_recorder.record_step(
        db, outsider, session["id"], {"kind": "note", "detail": "trespass"})) == {"found": False}
    assert asyncio.run(nexus_recorder.verify_runbook(
        db, outsider, "Olive Other", db.recorded_runbooks.rows[0]["id"],
        {"outcome": "success"})) == {"found": False}

    own = asyncio.run(nexus_recorder.list_sessions(db, _user()))
    assert own["count"] == 1
    assert "append-only" in own["note"]
    listing = asyncio.run(nexus_recorder.list_runbooks(db, _user()))
    assert listing["count"] == 1
    assert listing["autonomy_candidates"] == 0
    assert asyncio.run(nexus_recorder.list_sessions(db, _user(), status="completed"))["count"] == 0


def test_list_functions_label_candidates_without_implying_execution(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    runbook = _verified_runbook(db)
    for _ in range(nexus_recorder.MIN_VERIFIED_SUCCESSES):
        asyncio.run(nexus_recorder.verify_runbook(
            db, _user(), "Terry Tech", runbook["id"], {"outcome": "success"}))
    listing = asyncio.run(nexus_recorder.list_runbooks(db, _user()))
    assert listing["autonomy_candidates"] == 1
    assert "never means Nexus will act on its own" in listing["note"]
