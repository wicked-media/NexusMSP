"""Contract tests for the operating layer: consequence models, commander, memory."""

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
from app.services import nexus_ops_layer  # noqa: E402


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
    for name in ("tickets", "users", "devices", "clients", "contracts", "alerts",
                 "device_events", "device_patches", "activity_logs", "ssl_certificates",
                 "work_activity_audit", "ticket_audit_log", "nexus_decisions",
                 "risk_acceptances", "nexus_laws", "technical_debt"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": "platform-a", "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_ops_layer, "_utcnow", lambda: FIXED_NOW)


def _iso(dt):
    return dt.isoformat()


# ============== CONSEQUENCE ENGINE ==============


def test_consequence_model_reports_business_impact(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([{"id": "dev-1", "name": "ACME-DC-01", "client_id": "c1",
                              "client_name": "Acme", "assigned_user": "Sarah",
                              "warranty_expiry": "2027-01-01", "tenant_id": "platform-a"}]),
        tickets=_Collection([
            {"id": "T1", "ticket_number": "INC-1", "client_id": "c1", "device_id": "dev-1",
             "title": "Domain controller replication errors", "priority": "critical",
             "status": "open", "tenant_id": "platform-a"},
            {"id": "T2", "ticket_number": "INC-2", "client_id": "c1", "title": "Printer offline",
             "priority": "low", "status": "open", "tenant_id": "platform-a"},
        ]),
        contracts=_Collection([{"id": "k1", "client_id": "c1", "value": 2500,
                                "billing_frequency": "monthly", "tenant_id": "platform-a"}]),
        device_events=_Collection([{"id": "e1", "device_id": "dev-1", "event_type": "backup_completed",
                                    "timestamp": "2026-10-03T01:00:00+00:00", "tenant_id": "platform-a"}]),
    )
    result = asyncio.run(nexus_ops_layer.consequence_model(db, _user(), {
        "action_type": "reboot", "target_id": "dev-1", "destructive": False,
    }))
    assert result["found"] is True
    assert result["target"] == "ACME-DC-01"
    assert result["technical_dependencies"]["open_incidents_on_target"] == ["INC-1"]
    assert "$2,500/month" in result["billing_implications"]
    assert any("NO restore verification" in r for r in result["recovery_options"])
    assert any("In warranty until" in r for r in result["recovery_options"])
    assert result["severity_band"] in ("moderate", "high", "critical")
    assert "Consequence severity" in result["verdict"]
    # A destructive action without restore evidence hits the recoverability law.
    destructive = asyncio.run(nexus_ops_layer.consequence_model(db, _user(), {
        "action_type": "format_volume", "target_id": "dev-1", "destructive": True,
    }))
    assert destructive["law_gate"]["overall"] == "blocked"
    assert any(d["law_id"] == "law-recoverability" for d in destructive["law_gate"]["decisions"])


def test_consequence_model_client_target_and_missing(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(clients=_Collection([{"id": "c1", "name": "Acme", "tenant_id": "platform-a"}]))
    result = asyncio.run(nexus_ops_layer.consequence_model(db, _user(), {
        "action_type": "cancel_vendor", "target_id": "Acme",
    }))
    assert result["found"] is True
    assert result["client_name"] == "Acme"
    assert asyncio.run(nexus_ops_layer.consequence_model(db, _user(), {"action_type": "x", "target_id": "ghost"})) == {"found": False}


# ============== MORNING COMMANDER ==============


def test_morning_commander_decides_what_matters(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([
            {"id": "d1", "name": "SRV01", "client_id": "c1", "client_name": "Acme", "tenant_id": "platform-a"},
            {"id": "d2", "hostname": "DESKTOP-NEW", "client_id": "c1", "client_name": "Acme",
             "purchase_date": "2019-03-01", "tenant_id": "platform-a"},
        ]),
        clients=_Collection([{"id": "c1", "name": "Acme", "tenant_id": "platform-a"}]),
        device_events=_Collection([{"id": "e1", "device_id": "d1", "event_type": "backup_completed",
                                    "timestamp": "2026-10-03T01:00:00+00:00", "tenant_id": "platform-a"}]),
        ssl_certificates=_Collection([{"id": "s1", "domain": "acme.test", "client_id": "c1",
                                       "expiry_date": "2026-10-10", "tenant_id": "platform-a"}]),
        tickets=_Collection([{"id": "T1", "ticket_number": "INC-4918", "client_id": "c1", "priority": "low",
                              "title": "Slow login", "status": "open",
                              "created_at": "2026-10-03T12:00:00+00:00", "tenant_id": "platform-a"}]),
    )
    result = asyncio.run(nexus_ops_layer.morning_commander(db, _user(), "Aaron Rigby"))
    assert result["greeting"] == "Good morning, Aaron."
    assert "2 endpoints" in result["estate"] and "1 customers" in result["estate"]
    lines = " | ".join(a["line"] for a in result["attention"])
    assert "backup recoverability unverified" in lines
    assert "certificate expires in 5 days" in lines
    assert "customer waiting" in lines
    assert len(result["attention"]) <= 5
    assert "Everything else can wait" in result["verdict"]
    assert all("why_safe" in s for s in result["safe_stuff"])
    assert "autonomy boundary" in result["safe_note"]
    assert any("NEW" in q["quip"] for q in result["name_critic"])


# ============== END MY DAY ==============\n


def test_end_my_day_surfaces_promises_and_unattended(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        tickets=_Collection([
            {"id": "T1", "ticket_number": "INC-1", "priority": "critical", "status": "open",
             "assigned_to": None, "created_at": "2026-10-04T06:00:00+00:00", "tenant_id": "platform-a"},
            {"id": "T2", "ticket_number": "SR-2", "priority": "low", "status": "open",
             "assigned_to": "u1", "due_date": "2026-10-05", "created_at": "2026-10-04T06:00:00+00:00",
             "tenant_id": "platform-a"},
        ]),
    )
    result = asyncio.run(nexus_ops_layer.end_my_day(db, _user(), "Aaron Rigby"))
    labels = {c["label"]: c for c in result["checks"]}
    assert labels["No critical incidents unattended"]["ok"] is False
    kinds = {w["kind"] for w in result["warnings"]}
    assert "unattended" in kinds
    assert "promise" in kinds
    unattended = next(w for w in result["warnings"] if w["kind"] == "unattended")
    assert "Deal With It" in unattended["actions"]
    promise = next(w for w in result["warnings"] if w["kind"] == "promise")
    assert promise["promises"][0]["ticket"] == "SR-2"
    assert "need a decision tonight" in result["verdict"]


# ============== COMMERCIAL MEMORY ==============


def test_decision_log_remembers_why(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    entry = asyncio.run(nexus_ops_layer.record_decision(db, _user(), "Aaron Rigby", {
        "client_id": "c1", "device_id": "dev-1",
        "decision": "Do not replace SERVER02 until FY27",
        "reason": "Customer budget", "risks_communicated": True,
        "customer_accepted_risk": True, "review_date": "2027-03-01",
    }))
    assert entry["status"] == "active"
    assert entry["tenant_id"] == "platform-a"

    listing = asyncio.run(nexus_ops_layer.list_decisions(db, _user(), "c1"))
    assert listing["count"] == 1
    assert listing["decisions"][0]["decision"].startswith("Do not replace")
    assert "why the recommendation wasn't followed" in listing["note"]

    # Tenant scoping: another tenant's decision is invisible.
    other = {**_user(uid="other-1"), "tenant_id": "tenant-b"}
    assert asyncio.run(nexus_ops_layer.list_decisions(db, other, "c1"))["count"] == 0


def test_risk_acceptances_flag_reviews(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    asyncio.run(nexus_ops_layer.record_risk_acceptance(db, _user(), "Aaron Rigby", {
        "client_id": "c1", "device_id": "dev-1", "title": "Unsupported Server 2012",
        "risk_owner": "Customer CEO", "accepted_date": "2026-10-12",
        "expires": "2026-10-10", "compensating_controls": "EDR + segmentation + backup",
    }))
    listing = asyncio.run(nexus_ops_layer.list_risk_acceptances(db, _user(), "c1"))
    assert listing["count"] == 1
    row = listing["acceptances"][0]
    assert row["review_due"] is True
    assert row["days_to_expiry"] == 6
    assert listing["reviews_due"] == 1
    assert "need review within 14 days" in listing["verdict"]


def test_we_told_you_assembles_prior_recommendation_evidence(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        risk_acceptances=_Collection([{
            "id": "r1", "tenant_id": "platform-a", "client_id": "c1", "device_id": "dev-1",
            "title": "Replace failing RAID battery", "risk_owner": "Customer CEO",
            "accepted_date": "2026-10-01", "expires": "2027-01-01",
            "compensating_controls": "Backups + monitoring", "status": "accepted",
        }]),
        tickets=_Collection([{
            "id": "T1", "ticket_number": "INC-9", "client_id": "c1", "device_id": "dev-1",
            "title": "RAID degraded", "status": "open", "created_at": "2026-10-03T09:00:00+00:00",
            "tenant_id": "platform-a",
        }]),
    )
    result = asyncio.run(nexus_ops_layer.we_told_you(db, _user(), client_id="c1", device_id="dev-1"))
    assert len(result["chain"]) == 1
    chain = result["chain"][0]
    assert chain["recommendation"] == "Replace failing RAID battery"
    assert chain["subsequent_incidents"][0]["number"] == "INC-9"
    assert result["internal_note"] == "Nexus remembers. 😏"
    assert "Commercial and liability context" in result["verdict"]

    empty = asyncio.run(nexus_ops_layer.we_told_you(db, _user(), client_id="c9"))
    assert empty["chain"] == []
    assert "nothing to remember yet" in empty["verdict"]


# ============== NAME CRITIC & ROUTER CONTRACTS ==============


def test_device_name_critic_quips(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([
            {"id": "d1", "hostname": "SERVER-FINAL", "tenant_id": "platform-a"},
            {"id": "d2", "hostname": "TEST-PC", "tenant_id": "platform-a"},
        ]),
        tickets=_Collection([{"id": "T1", "ticket_number": "INC-1", "device_id": "d2",
                              "priority": "critical", "status": "open", "tenant_id": "platform-a"}]),
    )
    quips = asyncio.run(nexus_ops_layer.device_name_critic(db, _user()))
    text = " | ".join(q["quip"] for q in quips)
    assert "history will prove otherwise" in text
    assert "Nexus has concerns" in text


def test_router_contracts(monkeypatch):
    _fixed_clock(monkeypatch)
    monkeypatch.setattr(tech_fun_router, "db", _db())

    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.consequence_model({"action_type": "reboot"}, _user()))
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.consequence_model({"action_type": "reboot", "target_id": "ghost"}, _user()))
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.record_decision({"reason": "no decision"}, _user()))
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.record_risk_acceptance({"risk_owner": "someone"}, _user()))
    assert exc.value.status_code == 400
