"""Contract tests for the Nexus Fleet Shell (fleet queries as object sets).

The load-bearing test here is
:func:`test_device_without_the_evidence_is_unavailable_not_silently_decided`:
a device whose record lacks the field a filter needs must be reported, never
guessed into or out of the answer.
"""

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

from app.services import nexus_fleet_shell, nexus_operational_mode  # noqa: E402


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
        for row in self.rows:
            if _matches(row, query):
                for field, value in (update.get("$set") or {}).items():
                    row[field] = value
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def count_documents(self, query=None):
        return sum(1 for row in self.rows if _matches(row, query or {}))


COLLECTIONS = ("devices", "clients", "users", "tickets", "fleet_object_sets",
               "operational_mode_state", "operational_mode_events")


def _db(**collections):
    namespace = SimpleNamespace()
    for name in COLLECTIONS:
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False, tenant="platform-a"):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": tenant, "client_scope_mode": "all"}


def _device(device_id="dev-1", tenant="platform-a", **extra):
    row = {
        "id": device_id,
        "tenant_id": tenant,
        "hostname": device_id.upper(),
        "client_id": "CLI-001",
        "client_name": "ACME",
        "os": "Windows 11 Pro",
        "status": "online",
        "last_seen": "2026-10-04T07:55:00+00:00",
        "last_boot": "2026-09-20T00:00:00+00:00",
    }
    row.update(extra)
    return row


def _without(device_id, tenant="platform-a", **extra):
    """A device record with only the fields given — no inferred evidence."""
    row = {"id": device_id, "tenant_id": tenant, "hostname": device_id.upper()}
    row.update(extra)
    return row


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_fleet_shell, "_utcnow", lambda: FIXED_NOW)


def _mode(name="normal", *, clients=(), capabilities=(), reason="a maintenance window is open"):
    """Stand-in for the operational-mode contract the coordinator owns."""
    async def _current_mode(_db, _user):
        return {"mode": name, "reason": reason, "since": "2026-10-04T00:00:00+00:00",
                "frozen_clients": list(clients), "frozen_capabilities": list(capabilities),
                "note": "Operational mode is recorded centrally and consulted before any action."}
    return _current_mode


def _query(db, filters, user=None, **extra):
    payload = {"filters": filters}
    payload.update(extra)
    return asyncio.run(nexus_fleet_shell.query_fleet(db, user or _user(), payload))


def _save(db, label, user=None, **extra):
    payload = {"label": label}
    payload.update(extra)
    return asyncio.run(nexus_fleet_shell.save_object_set(db, user or _user(), "Terry Tech", payload))


OLD_BOOT = "2026-09-01T00:00:00+00:00"  # 33 days before FIXED_NOW


# ============== GRAMMAR ==============


def test_grammar_publishes_every_filter_and_the_evidence_it_needs():
    grammar = nexus_fleet_shell.shell_grammar()
    names = [entry["filter"] for entry in grammar["filters"]]
    assert names == [
        "client_id", "status", "os", "hostname_contains", "days_since_boot_gte",
        "exclude_servers", "exclude_active_user", "min_free_disk_percent_below",
        "pending_patches_gte",
    ]
    for entry in grammar["filters"]:
        assert entry["needs"].startswith("devices.")
        assert entry["label"] and entry["meaning"]
    assert grammar["blast_radius_rings"] == ["1", "5", "25", "remainder"]
    assert "software_deployment" in grammar["capabilities"]
    assert "unavailable bucket" in grammar["note"]


# ============== QUERY ==============


def test_query_answers_the_question_and_touches_nothing(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([
        _device("dev-1", last_boot=OLD_BOOT),
        _device("dev-2", last_boot="2026-10-03T00:00:00+00:00"),
        _device("dev-3", last_boot="2026-09-02T00:00:00+00:00"),
    ]))
    result = _query(db, [{"filter": "days_since_boot_gte", "value": 30}])
    assert result["found"] is True
    assert result["count"] == 2
    assert [row["id"] for row in result["devices"]] == ["dev-1", "dev-3"]
    assert result["devices"][0]["days_since_boot"] == 33
    assert result["devices"][0]["client_name"] == "ACME"
    assert result["excluded"]["filtered_out"] == 1
    assert result["applied_filters"] == [{"filter": "days_since_boot_gte", "value": 30.0}]
    assert "was not touched" in result["note"]
    assert db.devices.inserted == []


def test_excluding_servers_and_devices_in_use_shrinks_the_set(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([
        _device("dev-1", session_state="idle"),
        _device("srv-1", os="Windows Server 2022", session_state="idle"),
        _device("dev-2", active_user="Sarah Chen"),
        _device("dev-3", session_state="logged_out"),
    ]))
    result = _query(db, [{"filter": "exclude_servers"}, {"filter": "exclude_active_user"}])
    assert result["count"] == 2
    assert [row["id"] for row in result["devices"]] == ["dev-1", "dev-3"]
    assert result["excluded"]["servers"] == 1
    assert result["excluded"]["active_user"] == 1
    assert result["excluded"]["unavailable"] == 0


def test_device_without_the_evidence_is_unavailable_not_silently_decided(monkeypatch):
    """The whole point: no evidence is never treated as either answer."""
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([
        _device("dev-1", last_boot=OLD_BOOT),
        _without("dev-2", os="Windows 11 Pro", status="online"),          # no boot evidence at all
        _without("dev-3", os="Windows 11 Pro", status="offline"),         # excluded on real evidence too
    ]))
    result = _query(db, [{"filter": "status", "value": "online"},
                         {"filter": "days_since_boot_gte", "value": 30}])

    assert result["count"] == 1
    assert [row["id"] for row in result["devices"]] == ["dev-1"]

    # dev-2 could neither be matched nor dropped: it is reported instead.
    assert result["excluded"]["unavailable"] == 1
    assert result["excluded"]["unavailable_devices"] == ["dev-2"]
    assert "no boot time is recorded" in result["excluded"]["unavailable_reasons"][0]["reason"]

    # dev-3 was excluded by evidence Nexus actually has, so it does not inflate
    # the unavailable bucket.
    assert "dev-3" not in result["excluded"]["unavailable_devices"]
    assert result["excluded"]["filtered_out"] == 1
    assert "could not be judged" in result["note"]


def test_filters_that_need_absent_evidence_report_unavailable(monkeypatch):
    _fixed_clock(monkeypatch)
    # A device record carrying nothing but its identity: every filter below
    # needs evidence this record simply does not have.
    db = _db(devices=_Collection([{"id": "dev-1", "tenant_id": "platform-a"}]))
    for filters in (
        [{"filter": "exclude_servers"}],
        [{"filter": "exclude_active_user"}],
        [{"filter": "min_free_disk_percent_below", "value": 10}],
        [{"filter": "pending_patches_gte", "value": 1}],
        [{"filter": "client_id", "value": "CLI-001"}],
        [{"filter": "status", "value": "online"}],
        [{"filter": "os", "value": "Windows"}],
        [{"filter": "hostname_contains", "value": "DEV"}],
    ):
        result = _query(db, filters)
        assert result["count"] == 0, filters
        assert result["excluded"]["unavailable"] == 1, filters


def test_unknown_and_malformed_filters_are_rejected(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    assert "unknown filter" in _query(db, [{"filter": "colour", "value": "blue"}])["error"]
    assert "needs a value" in _query(db, [{"filter": "os"}])["error"]
    assert "needs a number" in _query(db, [{"filter": "days_since_boot_gte", "value": "ages"}])["error"]
    assert "does not support op" in _query(
        db, [{"filter": "os", "value": "Windows", "op": "gte"}])["error"]
    assert _query(db, "everything")["error"] == "filters must be a list or an object"
    assert _query(db, [{"value": 3}])["error"] == "each filter needs a filter name"
    assert db.fleet_object_sets.inserted == []


def test_plain_dict_filters_are_accepted(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device("dev-1", os="Windows 11 Pro"),
                                  _device("dev-2", os="Ubuntu 24.04")]))
    result = _query(db, {"os": "ubuntu"})
    assert result["count"] == 1
    assert result["devices"][0]["id"] == "dev-2"


# ============== SAVING OBJECT SETS ==============


def test_save_object_set_records_membership_and_counts(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([
        _device("dev-1", last_boot=OLD_BOOT),
        _device("srv-1", os="Windows Server 2022", last_boot=OLD_BOOT),
        _without("dev-2", os="Windows 11 Pro", status="online"),
    ]))
    result = _save(db, "Not rebooted in 30 days", filters=[{"filter": "days_since_boot_gte", "value": 30}])
    assert result["found"] is True
    obj = result["object_set"]
    assert obj["id"].startswith("FOS-")
    assert obj["label"] == "Not rebooted in 30 days"
    assert obj["member_device_ids"] == ["dev-1", "srv-1"]
    assert obj["member_count"] == 2
    assert obj["unavailable_count"] == 1
    assert obj["status"] == "active"
    assert obj["created_by_name"] == "Terry Tech"
    assert obj["lineage"] is None

    stored = db.fleet_object_sets.inserted[0]
    assert stored["tenant_id"] == "platform-a"
    assert len(stored["member_device_ids"]) == 2
    assert "member IDs and counts" in result["note"]

    assert _save(db, "   ")["error"] == "label is required"
    assert _save(db, "bad filters", filters=[{"filter": "nope"}])["error"].startswith("unknown filter")


def test_save_from_a_missing_source_set_is_not_found(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    assert _save(db, "copy of nothing", source_set_id="FOS-GHOST") == {"found": False}


def test_save_from_a_source_set_copies_membership_and_lineage(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device("dev-1"), _device("dev-2")]))
    parent = _save(db, "All endpoints")["object_set"]
    copy_result = _save(db, "Snapshot for the change window", source_set_id=parent["id"])
    copied = copy_result["object_set"]
    assert copied["member_device_ids"] == parent["member_device_ids"]
    assert copied["member_count"] == 2
    assert copied["lineage"]["parent_set_id"] == parent["id"]


# ============== REFINEMENT: THE CORE FLOW ==============


def test_refine_creates_a_new_set_and_leaves_the_parent_alone(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([
        _device("dev-1", session_state="idle"),
        _device("srv-1", os="Windows Server 2022", session_state="idle"),
        _device("dev-2", active_user="Sarah Chen"),
    ]))
    parent = _save(db, "Every Windows endpoint", filters=[{"filter": "os", "value": "Windows"}])["object_set"]
    assert parent["member_count"] == 3

    refined = asyncio.run(nexus_fleet_shell.refine_object_set(
        db, _user(), "Terry Tech", parent["id"],
        {"filters": [{"filter": "exclude_servers"}, {"filter": "exclude_active_user"}]}))
    child = refined["object_set"]
    assert refined["found"] is True
    assert child["id"] != parent["id"]
    assert child["label"] == "Every Windows endpoint (refined)"
    assert child["member_count"] == 1
    assert child["member_device_ids"] == ["dev-1"]
    assert child["lineage"]["parent_set_id"] == parent["id"]
    assert refined["removed"] == 2
    assert refined["parent"] == {"id": parent["id"], "member_count": 3}
    assert "parent set is unchanged" in refined["note"]

    reloaded = asyncio.run(nexus_fleet_shell.get_object_set(db, _user(), parent["id"]))["object_set"]
    assert reloaded["member_count"] == 3
    assert reloaded["lineage"] is None
    assert [row for row in db.fleet_object_sets.rows if row["id"] == parent["id"]][0][
        "member_device_ids"] == ["dev-1", "srv-1", "dev-2"]


def test_refine_with_drop_removes_matching_members(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device("dev-1"), _device("dev-2", os="Ubuntu 24.04")]))
    parent = _save(db, "Everything")["object_set"]
    assert parent["member_count"] == 2
    dropped = asyncio.run(nexus_fleet_shell.refine_object_set(
        db, _user(), "Terry Tech", parent["id"],
        {"filters": [{"filter": "os", "value": "Ubuntu"}], "drop": True}))
    assert dropped["object_set"]["member_device_ids"] == ["dev-1"]
    assert dropped["removed"] == 1
    assert dropped["object_set"]["lineage"]["parent_set_id"] == parent["id"]


def test_refine_requires_filters_and_a_real_parent(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device("dev-1")]))
    parent = _save(db, "Everything")["object_set"]
    empty = asyncio.run(nexus_fleet_shell.refine_object_set(
        db, _user(), "Terry Tech", parent["id"], {"filters": []}))
    assert empty["found"] is False
    assert "at least one refining filter" in empty["error"]
    missing = asyncio.run(nexus_fleet_shell.refine_object_set(
        db, _user(), "Terry Tech", "FOS-GHOST", {"filters": [{"filter": "os", "value": "Windows"}]}))
    assert missing == {"found": False}


# ============== ACTION PLANNING ==============


def test_plan_set_action_is_a_plan_and_never_an_execution(monkeypatch):
    _fixed_clock(monkeypatch)
    monkeypatch.setattr(nexus_operational_mode, "current_mode", _mode("normal"))
    db = _db(devices=_Collection([_device(f"dev-{n}") for n in range(1, 9)]))
    obj = _save(db, "Safe reboot ring")["object_set"]

    result = asyncio.run(nexus_fleet_shell.plan_set_action(
        db, _user(), "Terry Tech", obj["id"], {"action": "Schedule a maintenance reboot"}))
    assert result["found"] is True
    assert result["permitted"] is True
    assert result["plan"]["target_count"] == 8
    assert [ring["size"] for ring in result["plan"]["rings"]] == [1, 5, 2, 0]
    assert [ring["ring"] for ring in result["plan"]["rings"]] == [1, 2, 3, 4]
    assert all(ring["verification_gate"] for ring in result["plan"]["rings"])
    assert result["plan"]["rings"][0]["members"] == ["dev-1"]
    assert result["plan"]["rollback"] and result["plan"]["verification"]
    assert result["plan"]["mode"] == "normal"
    assert result["plan"]["capability"] == "software_deployment"
    assert "has not executed anything" in result["note"]
    assert "no ring is released" in result["note"]


def test_plan_is_blocked_when_the_operational_mode_forbids_the_capability(monkeypatch):
    _fixed_clock(monkeypatch)
    monkeypatch.setattr(nexus_operational_mode, "current_mode",
                        _mode("frozen", capabilities=["software_deployment"]))
    db = _db(devices=_Collection([_device("dev-1")]))
    obj = _save(db, "Ring")["object_set"]

    result = asyncio.run(nexus_fleet_shell.plan_set_action(
        db, _user(), "Terry Tech", obj["id"], {"action": "Deploy package"}))
    assert result["found"] is True
    assert result["permitted"] is False
    # The mode reached the plan and blocked it. The exact wording of the reason
    # belongs to the operational-mode module, so only its presence is asserted.
    assert "Execution is blocked right now: " in result["note"]
    assert result["note"].split("Execution is blocked right now: ")[1].strip()
    assert result["plan"]["mode"] == "frozen"
    assert result["plan"]["action"] == "Deploy package"


def test_plan_action_validates_its_input(monkeypatch):
    _fixed_clock(monkeypatch)
    monkeypatch.setattr(nexus_operational_mode, "current_mode", _mode("normal"))
    db = _db(devices=_Collection([_device("dev-1")]))
    obj = _save(db, "Ring")["object_set"]

    assert asyncio.run(nexus_fleet_shell.plan_set_action(
        db, _user(), "Terry Tech", obj["id"], {}))["error"] == "action is required"
    bad_capability = asyncio.run(nexus_fleet_shell.plan_set_action(
        db, _user(), "Terry Tech", obj["id"], {"action": "x", "capability": "teleport"}))
    assert bad_capability["found"] is False
    assert "capability must be one of" in bad_capability["error"]
    assert asyncio.run(nexus_fleet_shell.plan_set_action(
        db, _user(), "Terry Tech", "FOS-GHOST", {"action": "x"})) == {"found": False}


def test_plan_reports_an_empty_set_rather_than_inventing_rings(monkeypatch):
    _fixed_clock(monkeypatch)
    monkeypatch.setattr(nexus_operational_mode, "current_mode", _mode("normal"))
    db = _db(devices=_Collection([_device("dev-1")]))
    obj = _save(db, "Nothing matches", filters=[{"filter": "os", "value": "Haiku OS"}])["object_set"]
    assert obj["member_count"] == 0
    result = asyncio.run(nexus_fleet_shell.plan_set_action(
        db, _user(), "Terry Tech", obj["id"], {"action": "Reboot"}))
    assert result["plan"]["rings"] == []
    assert result["plan"]["target_count"] == 0
    assert "nothing to action" in result["note"]


# ============== SUMMARY AND TENANCY ==============


def test_fleet_summary_counts_only_recorded_evidence(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([
        _device("dev-1"),
        _device("dev-2", status="offline"),
        _without("dev-3", client_id="CLI-001"),
        _device("dev-9", tenant="platform-b"),
    ]))
    summary = asyncio.run(nexus_fleet_shell.fleet_summary(db, _user()))
    assert summary["found"] is True
    assert summary["total"] == 3
    assert summary["online"] == 1
    assert summary["offline"] == 1
    assert summary["status_not_recorded"] == 1
    assert summary["no_checkin_evidence"] == 1
    assert summary["never_booted_evidence"] == 1
    assert summary["by_os"]["not recorded"] == 1
    assert summary["by_client"][0]["client_name"] == "ACME"
    assert "never as offline" in summary["note"]


def test_queries_sets_and_refinement_are_tenant_scoped(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([_device("dev-1"), _device("dev-9", tenant="platform-b")]),
        fleet_object_sets=_Collection([
            {"id": "FOS-A", "tenant_id": "platform-a", "label": "mine",
             "member_device_ids": ["dev-1"], "member_count": 1, "unavailable_count": 0,
             "filters": [], "status": "active", "created_at": "2026-10-01T00:00:00+00:00"},
            {"id": "FOS-B", "tenant_id": "platform-b", "label": "theirs",
             "member_device_ids": ["dev-9"], "member_count": 1, "unavailable_count": 0,
             "filters": [], "status": "active", "created_at": "2026-10-02T00:00:00+00:00"},
        ]),
    )
    queried = _query(db, [])
    assert [row["id"] for row in queried["devices"]] == ["dev-1"]

    listed = asyncio.run(nexus_fleet_shell.list_object_sets(db, _user()))
    assert [obj["id"] for obj in listed["object_sets"]] == ["FOS-A"]

    assert asyncio.run(nexus_fleet_shell.get_object_set(db, _user(), "FOS-B")) == {"found": False}
    assert asyncio.run(nexus_fleet_shell.refine_object_set(
        db, _user(), "Terry Tech", "FOS-B",
        {"filters": [{"filter": "os", "value": "Windows"}]})) == {"found": False}

    other = asyncio.run(nexus_fleet_shell.list_object_sets(
        db, _user("u2", "Other Tech", tenant="platform-b")))
    assert [obj["id"] for obj in other["object_sets"]] == ["FOS-B"]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
