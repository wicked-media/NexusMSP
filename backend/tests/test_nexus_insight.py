"""Contract tests for the Nexus insight layer.

These lock the honest-evidence boundaries: behaviour baselines must say what
they are built from, anomaly scans must cluster onsets, the timeline must
filter, search must match across object types, margin math must be
reproducible, and technical debt must never invent remediation costs.
"""

import asyncio
import copy
import os
import re
import sys
from datetime import datetime, timedelta, timezone
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
from app.services import nexus_insight  # noqa: E402


FIXED_NOW = datetime(2026, 10, 4, 0, 0, tzinfo=timezone.utc)


def _iso(dt):
    return dt.isoformat()


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
    for name in ("tickets", "users", "tech_points_ledger", "user_achievements", "devices",
                 "onboarding_checklist_runs", "runbooks", "backup_drills", "ticket_comments",
                 "nexus_agent_commands", "alerts", "clients", "remote_sessions",
                 "backup_jobs", "maintenance_windows", "change_management",
                 "nexus_memory", "nexus_feedback", "settings", "work_locks",
                 "invoices", "contracts", "technical_debt", "activity_logs"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech"):
    return {"id": uid, "name": name, "role": "tech", "tenant_id": "platform-a", "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_insight, "_utcnow", lambda: FIXED_NOW)


# ============== BEHAVIOUR BASELINE ==============


def _estate():
    rows = [{"id": f"fill-{i}", "hostname": f"PC-{i:02d}", "cpu_usage": 10, "memory_usage": 50,
             "disk_usage": 50, "tenant_id": "platform-a"} for i in range(19)]
    rows.append({"id": "dev-normal", "hostname": "PC-NORMAL", "cpu_usage": 11, "memory_usage": 50,
                 "disk_usage": 50, "tenant_id": "platform-a"})
    rows.append({"id": "dev-hot", "hostname": "PC-HOT", "cpu_usage": 100, "memory_usage": 50,
                 "disk_usage": 50, "tenant_id": "platform-a"})
    return rows


def test_baseline_is_honest_about_evidence(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection(_estate()), alerts=_Collection(
        [{"id": "a1", "device_id": "dev-normal", "tenant_id": "platform-a"}]
    ))
    result = asyncio.run(nexus_insight.behaviour_baseline(db, _user(), "dev-normal"))
    assert result["found"] is True
    assert result["baseline_kind"] == "peer-distribution"
    # The note must say what the baseline is built from instead of inventing history.
    assert "telemetry" in result["baseline_note"]
    assert "peer" in result["baseline_note"]
    assert result["alert_history_count"] == 1
    assert result["bands"]["cpu_usage"]["unusual"] is False
    assert "Within normal range" in result["verdict"]


def test_baseline_flags_device_behaving_differently(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection(_estate()))
    result = asyncio.run(nexus_insight.behaviour_baseline(db, _user(), "dev-hot"))
    assert result["bands"]["cpu_usage"]["unusual"] is True
    assert "cpu_usage" in result["verdict"]
    assert "Behaving differently from normal" in result["verdict"]


def test_baseline_missing_device(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_insight.behaviour_baseline(_db(), _user(), "nope"))
    assert result == {"found": False}


# ============== ANOMALY EXPLORER ==============


def test_anomaly_scan_finds_odd_hours_and_auth_bursts(monkeypatch):
    _fixed_clock(monkeypatch)
    logs = [
        {"id": "l1", "action": "auth.login", "entity_id": "sarah", "user_name": "Sarah",
         "created_at": "2026-10-03T03:17:00+00:00", "tenant_id": "platform-a"},
        {"id": "l2", "action": "auth.login_failed", "entity_id": "sarah", "user_name": "Sarah",
         "created_at": "2026-10-03T03:18:00+00:00", "tenant_id": "platform-a"},
        {"id": "l3", "action": "auth.login_failed", "entity_id": "sarah", "user_name": "Sarah",
         "created_at": "2026-10-03T03:19:00+00:00", "tenant_id": "platform-a"},
        {"id": "l4", "action": "auth.login_failed", "entity_id": "sarah", "user_name": "Sarah",
         "created_at": "2026-10-03T03:21:00+00:00", "tenant_id": "platform-a"},
    ]
    db = _db(activity_logs=_Collection(logs))
    result = asyncio.run(nexus_insight.anomaly_scan(db, _user(), "Terry Tech", hours=48))
    kinds = {finding["kind"] for finding in result["findings"]}
    assert "odd_hours" in kinds
    assert "auth_burst" in kinds
    assert "unusual behaviour" in result["verdict"]
    # Onset clustering: the 03:17-03:21 behaviours began within minutes of each other.
    assert result["clusters"], "findings beginning within 10 minutes must cluster"
    assert "within minutes of each other" in result["clusters"][0]["probable_common_dependency"]


def test_anomaly_scan_boring_estate(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(activity_logs=_Collection(
        [{"id": "l1", "action": "ticket.created", "created_at": "2026-10-03T10:00:00+00:00",
          "tenant_id": "platform-a"}]
    ))
    result = asyncio.run(nexus_insight.anomaly_scan(db, _user(), "Terry Tech", hours=48))
    assert result["findings"] == []
    assert "boring" in result["verdict"]


def test_anomaly_scan_flags_peer_stat_outlier(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection(_estate()))
    result = asyncio.run(nexus_insight.anomaly_scan(db, _user(), "Terry Tech", hours=48))
    outliers = [f for f in result["findings"] if f["kind"] == "stat_outlier"]
    assert any("PC-HOT" in f["title"] for f in outliers)


# ============== UNIVERSAL TIMELINE ==============


def test_timeline_unifies_events_and_filters_by_person(monkeypatch):
    _fixed_clock(monkeypatch)
    logs = [
        {"id": "l1", "action": "auth.login", "user_name": "Sarah Chen", "entity_name": "Sarah Chen",
         "created_at": "2026-10-03T09:03:00+00:00", "tenant_id": "platform-a"},
        {"id": "l2", "action": "device.reboot", "user_name": "Bob Builder",
         "created_at": "2026-10-03T09:13:00+00:00", "tenant_id": "platform-a"},
        {"id": "l3", "action": "auth.login", "user_name": "Sarah Chen",
         "created_at": "2026-09-01T09:03:00+00:00", "tenant_id": "platform-a"},  # out of window
    ]
    alerts = _Collection([{"id": "a1", "message": "EDR detected suspicious file",
                           "created_at": "2026-10-03T09:18:00+00:00", "tenant_id": "platform-a"}])
    db = _db(activity_logs=_Collection(logs), alerts=alerts)

    everything = asyncio.run(nexus_insight.universal_timeline(db, _user(), "Terry Tech", hours=24))
    assert everything["count"] == 3  # old Sarah event excluded by the time window
    kinds = {event["kind"] for event in everything["events"]}
    assert {"activity", "alert"} <= kinds
    times = [str(event["time"]) for event in everything["events"]]
    assert times == sorted(times, reverse=True)

    only_sarah = asyncio.run(nexus_insight.universal_timeline(
        db, _user(), "Terry Tech", hours=24, user_filter="sarah"))
    assert only_sarah["count"] == 1
    assert "Sarah Chen" in only_sarah["events"][0]["user_name"]


# ============== CROSS-OBJECT SEARCH ==============


def test_universal_search_matches_phone_serial_and_invoice(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([{"id": "dev-1", "hostname": "LAPTOP-018", "serial_number": "SN-4455",
                             "ip_address": "192.168.1.50", "client_name": "ACME",
                             "tenant_id": "platform-a"}]),
        clients=_Collection([{"id": "client-001", "name": "ACME", "phone": "0412 345 678",
                              "email": "help@acme.test", "tenant_id": "platform-a"}]),
        users=_Collection([{"id": "u1", "name": "Sarah Chen", "email": "sarah@acme.test",
                            "phone": "0412345678", "tenant_id": "platform-a"}]),
        tickets=_Collection([{"id": "TKT-001", "ticket_number": "INC-0001", "title": "VPN drops",
                              "tenant_id": "platform-a"}]),
        invoices=_Collection([{"id": "inv-1", "invoice_number": "INV-2024-001",
                               "client_name": "ACME", "tenant_id": "platform-a"}]),
    )

    # A technician typing the phone number with spaces finds customer AND person.
    by_phone = asyncio.run(nexus_insight.universal_search(db, _user(), "0412 345 678"))
    assert {"clients", "users"} <= set(by_phone["groups"])
    assert by_phone["total"] >= 2

    assert "devices" in asyncio.run(nexus_insight.universal_search(db, _user(), "SN-4455"))["groups"]
    assert "tickets" in asyncio.run(nexus_insight.universal_search(db, _user(), "INC-0001"))["groups"]
    assert "invoices" in asyncio.run(nexus_insight.universal_search(db, _user(), "INV-2024-001"))["groups"]
    assert "users" in asyncio.run(nexus_insight.universal_search(db, _user(), "sarah@acme.test"))["groups"]

    empty = asyncio.run(nexus_insight.universal_search(db, _user(), "   "))
    assert empty["total"] == 0


# ============== SESSION SIDECAR ==============


def test_session_sidecar_summarises_the_session(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([{"id": "dev-1", "hostname": "SERVER01", "status": "online",
                             "disk_usage": 96, "warranty_expiry": "2026-12-01",
                             "tenant_id": "platform-a"}]),
        tickets=_Collection([
            {"id": "TKT-1", "ticket_number": "INC-1843", "title": "Outlook crash", "status": "open",
             "device_id": "dev-1", "tenant_id": "platform-a"},
            {"id": "TKT-2", "ticket_number": "INC-1700", "title": "Old noise", "status": "closed",
             "device_id": "dev-1", "tenant_id": "platform-a"},
        ]),
        change_management=_Collection([
            {"id": "c1", "device_id": "dev-1", "tenant_id": "platform-a"},
            {"id": "c2", "device_id": "dev-1", "tenant_id": "platform-a"},
        ]),
    )
    result = asyncio.run(nexus_insight.session_sidecar(db, _user(), "dev-1"))
    assert result["found"] is True
    assert result["device_health"] == 75  # 100 - 25 for disk pressure
    assert "disk usage at 96%" in result["health_penalties"]
    assert [t["id"] for t in result["open_tickets"]] == ["TKT-1"]
    assert result["recent_changes"] == 2
    assert result["warranty_days_remaining"] == 58
    assert "Diagnose" in result["actions"] and "Password Reset" in result["actions"]


def test_session_sidecar_missing_device(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_insight.session_sidecar(_db(), _user(), "ghost"))
    assert result == {"found": False}


# ============== "WHILE YOU'RE THERE" ==============


def test_while_youre_there_lists_physical_work(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        clients=_Collection([{"id": "client-001", "name": "ACME", "tenant_id": "platform-a"}]),
        devices=_Collection([
            {"id": "d1", "hostname": "AP02", "status": "offline", "client_id": "client-001",
             "tenant_id": "platform-a"},
            {"id": "d2", "hostname": "SRV01", "status": "online", "warranty_expiry": "2026-11-01",
             "client_id": "client-001", "tenant_id": "platform-a"},
            {"id": "d3", "hostname": "PC01", "status": "online", "disk_usage": 95,
             "client_id": "client-001", "tenant_id": "platform-a"},
            {"id": "d4", "hostname": "PC02", "status": "online", "last_patch_date": "2026-06-01",
             "client_id": "client-001", "tenant_id": "platform-a"},
        ]),
        tickets=_Collection([{"id": "TKT-9", "ticket_number": "SR-0002", "title": "Replace workstation",
                              "status": "open", "client_id": "client-001", "tenant_id": "platform-a"}]),
    )
    result = asyncio.run(nexus_insight.while_youre_there(db, _user(), "client-001"))
    assert result["found"] is True
    kinds = {task["kind"] for task in result["tasks"]}
    assert {"offline", "warranty", "disk", "patching", "ticket"} <= kinds
    assert "Since you're here" in result["verdict"]
    assert "5 thing(s)" in result["verdict"]


def test_while_youre_there_missing_customer(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_insight.while_youre_there(_db(), _user(), "ghost"))
    assert result == {"found": False}


# ============== DEPENDENCY CALENDAR ==============


def test_dependency_horizon_surfaces_looming_emergencies(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([
            {"id": "d1", "hostname": "SRV01", "warranty_expiry": "2026-11-15",
             "tenant_id": "platform-a"},
            {"id": "d2", "hostname": "PC02", "last_patch_date": "2026-06-01", "tenant_id": "platform-a"},
        ]),
        contracts=_Collection([
            {"id": "c1", "name": "Managed IT", "client_name": "ACME", "end_date": "2026-12-01",
             "tenant_id": "platform-a"},
            {"id": "c2", "name": "Helpdesk", "client_name": "ACME", "auto_renew": True,
             "billing_frequency": "monthly", "value": 2500, "tenant_id": "platform-a"},
        ]),
    )
    result = asyncio.run(nexus_insight.dependency_horizon(db, _user(), days=90))
    kinds = {item["kind"] for item in result["items"]}
    assert {"warranty", "patching", "contract", "contract_review"} <= kinds
    dates = [item["date"] for item in result["items"]]
    assert dates == sorted(dates)
    assert "emergency" in result["verdict"]


# ============== AGREEMENT MARGIN ==============


def _margin_db(value):
    return _db(
        clients=_Collection([{"id": "client-001", "name": "ACME", "tenant_id": "platform-a"}]),
        contracts=_Collection([{"id": "c1", "name": "Managed IT", "client_id": "client-001",
                                "value": value, "billing_frequency": "monthly",
                                "tenant_id": "platform-a"}]),
        users=_Collection([{"id": "tech-1", "hourly_rate": 100, "tenant_id": "platform-a"}]),
        tickets=_Collection([
            {"id": "t1", "client_id": "client-001", "total_time_minutes": 300,
             "created_at": "2026-09-04T09:00:00+00:00", "tenant_id": "platform-a"},
            {"id": "t2", "client_id": "client-001", "total_time_minutes": 300,
             "created_at": "2026-10-04T09:00:00+00:00", "tenant_id": "platform-a"},
        ]),
    )


def test_agreement_margin_alerts_when_giving_customer_away(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_insight.agreement_margin(_margin_db(500), _user(), "client-001"))
    assert result["found"] is True
    # 10 recorded hours at $100/hr normalised over a 30-day span = $1,000/month.
    assert result["estimated_monthly_delivery_cost"] == 1000
    assert result["monthly_value"] == 500
    assert result["verdict"].startswith("⚠ Agreement margin alert")
    assert result["recommended_monthly_range"] == [1300, 1450]
    assert "recorded ticket time" in result["trend_note"]


def test_agreement_margin_profitable_verdict(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_insight.agreement_margin(_margin_db(5000), _user(), "client-001"))
    assert "is profitable" in result["verdict"]


def test_agreement_margin_missing_customer(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_insight.agreement_margin(_db(), _user(), "ghost"))
    assert result == {"found": False}


# ============== TECHNICAL DEBT ==============


def test_technical_debt_records_and_reports_without_inventing_costs(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([
        {"id": "d1", "hostname": "OLD-SRV", "os": "Windows 7", "warranty_expiry": "2025-01-01",
         "tenant_id": "platform-a"},
    ]))
    monkeypatch.setattr(tech_fun_router, "db", db)

    entry = asyncio.run(tech_fun_router.record_technical_debt(
        {"client_id": "client-001", "title": "Temporary firewall rule",
         "why": "DR test needs outbound access", "proper_fix": "Remove rule after the test",
         "review_due": "2026-10-01", "estimated_cost": 400},
        _user(),
    ))
    assert entry["status"] == "open"
    assert entry["review_due"] == "2026-10-01"

    report = asyncio.run(tech_fun_router.technical_debt_report(None, _user()))
    assert report["open_items"] == 1
    assert len(report["overdue_reviews"]) == 1  # review date already passed
    assert report["recorded_estimated_remediation_cost"] == 400
    assert "Only technician-recorded estimates are summed" in report["cost_note"]
    assert report["estate"]["legacy_os"] == 1
    assert report["estate"]["out_of_warranty"] == 1


def test_technical_debt_post_requires_title(monkeypatch):
    _fixed_clock(monkeypatch)
    monkeypatch.setattr(tech_fun_router, "db", _db())
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(tech_fun_router.record_technical_debt({"why": "no title"}, _user()))
    assert excinfo.value.status_code == 400


# ============== ROUTER 404 CONTRACTS ==============


def test_insight_router_404s_for_missing_scope(monkeypatch):
    _fixed_clock(monkeypatch)
    monkeypatch.setattr(tech_fun_router, "db", _db())
    for call in (
        lambda: tech_fun_router.behaviour_baseline("ghost", _user()),
        lambda: tech_fun_router.session_sidecar("ghost", _user()),
        lambda: tech_fun_router.while_youre_there("ghost", _user()),
        lambda: tech_fun_router.agreement_margin("ghost", _user()),
    ):
        with pytest.raises(HTTPException) as excinfo:
            asyncio.run(call())
        assert excinfo.value.status_code == 404
