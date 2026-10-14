"""Contract tests for the certainty layer.

Locks the honest-evidence boundaries: unknowns are surfaced not hidden, vendor
status is never proof of recoverability, confidence shows its reasoning, laws
are deterministic and sit above everything, and credentials are never echoed.
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
from app.services import nexus_certainty  # noqa: E402


FIXED_NOW = datetime(2026, 10, 4, 0, 0, tzinfo=timezone.utc)  # a Sunday


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
                 "device_events", "device_patches", "backup_drills", "ticket_audit_log",
                 "time_entries", "client_communication_events", "ssl_certificates",
                 "compliance_reports", "production_readiness_items", "alert_suppression_rules",
                 "nexus_laws", "work_activity_audit", "technical_debt", "activity_logs"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": "platform-a", "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_certainty, "_utcnow", lambda: FIXED_NOW)


def _iso(dt):
    return dt.isoformat()


# ============== KNOWLEDGE COVERAGE ==============


def test_knowledge_coverage_surfaces_unknowns_and_mission(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([
            {"id": "d1", "name": "SRV01", "client_id": "c1", "assigned_user": "Sarah",
             "warranty_expiry": "2027-01-01", "purchase_date": "2024-01-01", "tenant_id": "platform-a"},
            {"id": "d2", "name": "PC02", "client_id": "c1", "tenant_id": "platform-a"},  # knows nothing
        ]),
        device_events=_Collection([
            {"id": "e1", "device_id": "d1", "event_type": "backup_completed",
             "timestamp": "2026-10-03T01:14:00+00:00", "tenant_id": "platform-a"},
        ]),
    )
    result = asyncio.run(nexus_certainty.knowledge_coverage(db, _user()))
    assert result["coverage_pct"] < 100
    kinds = {u["unknown"] for u in result["unknowns"]}
    assert "unknown patch status" in kinds
    assert "unknown device owner" in kinds
    assert any(u["unknown"] == "unverified recoverability" and u["severity"] == "high"
               for u in result["unknowns"])
    assert "Reduce Unknowns" in result["mission"]
    assert "itself a risk" in result["verdict"]


def test_knowledge_coverage_fully_known_customer(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([
            {"id": "d1", "name": "SRV01", "assigned_user": "Sarah", "last_patch_date": "2026-09-20",
             "warranty_expiry": "2027-01-01", "purchase_date": "2024-01-01", "tenant_id": "platform-a"},
        ]),
        device_events=_Collection([
            {"id": "e1", "device_id": "d1", "event_type": "backup_completed",
             "timestamp": "2026-10-03T01:00:00+00:00", "tenant_id": "platform-a"},
            {"id": "e2", "device_id": "d1", "event_type": "restore_verified",
             "timestamp": "2026-10-03T03:00:00+00:00", "tenant_id": "platform-a"},
        ]),
    )
    result = asyncio.run(nexus_certainty.knowledge_coverage(db, _user()))
    assert result["unknowns"] == []
    assert result["coverage_pct"] == 100
    assert "fully known" in result["verdict"]


# ============== PROVE IT ==============


def test_prove_it_rejects_vendor_backup_status_without_restore(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([{"id": "d1", "name": "SRV01", "tenant_id": "platform-a"}]),
        device_events=_Collection([
            {"id": "e1", "device_id": "d1", "event_type": "backup_completed",
             "timestamp": "2026-10-03T01:14:00+00:00", "tenant_id": "platform-a"},
        ]),
    )
    result = asyncio.run(nexus_certainty.prove_it(db, _user(), "backup healthy", "d1"))
    assert result["verdict"] == "unverified"
    assert result["nexus_position"].startswith("Backup says yes, Nexus says no")
    assert any(e["item"] == "Test restore" and e["status"] == "missing" for e in result["evidence"])


def test_prove_it_verifies_backup_with_restore_evidence(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([{"id": "d1", "name": "SRV01", "tenant_id": "platform-a"}]),
        device_events=_Collection([
            {"id": "e1", "device_id": "d1", "event_type": "backup_completed",
             "timestamp": "2026-10-03T01:14:00+00:00", "tenant_id": "platform-a"},
            {"id": "e2", "device_id": "d1", "event_type": "restore_verified",
             "timestamp": "2026-10-03T03:00:00+00:00", "tenant_id": "platform-a"},
        ]),
        backup_drills=_Collection([{"id": "b1", "device_id": "d1", "integrity_ok": True,
                                    "boot_ok": True, "completed_at": "2026-10-03T03:00:00+00:00",
                                    "tenant_id": "platform-a"}]),
    )
    result = asyncio.run(nexus_certainty.prove_it(db, _user(), "backup", "d1"))
    assert result["verdict"] == "verified"
    assert "Recoverability verified" in result["nexus_position"]


def test_prove_it_warranty_and_encryption(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([
        {"id": "d1", "warranty_expiry": "2027-01-01", "purchase_date": "2025-01-01", "tenant_id": "platform-a"},
        {"id": "d2", "warranty_expiry": "2026-01-01", "purchase_date": "2022-01-01", "tenant_id": "platform-a"},
    ]))
    assert asyncio.run(nexus_certainty.prove_it(db, _user(), "warranty", "d1"))["verdict"] == "verified"
    expired = asyncio.run(nexus_certainty.prove_it(db, _user(), "warranty", "d2"))
    assert expired["verdict"] == "contradicted"
    assert "expired" in expired["nexus_position"]

    encrypted = asyncio.run(nexus_certainty.prove_it(db, _user(), "encryption", "d1"))
    assert encrypted["verdict"] == "unverified"
    assert "no evidence" in encrypted["nexus_position"].lower()

    unsupported = asyncio.run(nexus_certainty.prove_it(db, _user(), "telepathy", "d1"))
    assert unsupported["found"] is False
    assert unsupported["unsupported_claim"] == "telepathy"


def test_prove_it_patching_freshness(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([
            {"id": "d1", "last_patch_date": "2026-09-20", "tenant_id": "platform-a"},
            {"id": "d2", "last_patch_date": "2026-01-01", "tenant_id": "platform-a"},
        ]),
        device_patches=_Collection([{"id": "p1", "device_id": "d1", "status": "installed",
                                     "installed_date": "2026-09-20", "tenant_id": "platform-a"}]),
    )
    fresh = asyncio.run(nexus_certainty.prove_it(db, _user(), "patching", "d1"))
    assert fresh["verdict"] == "verified"
    stale = asyncio.run(nexus_certainty.prove_it(db, _user(), "patching", "d2"))
    assert stale["verdict"] == "unverified"


# ============== CONFIDENCE ==============


def test_confidence_shows_reasoning(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([{"id": "d1", "assigned_user": "Sarah", "tenant_id": "platform-a"}]),
        work_activity_audit=_Collection([{"id": "w1", "user_name": "Sarah", "event": "viewed",
                                          "work_item": "ticket:INC-1", "tenant_id": "platform-a"}]),
    )
    result = asyncio.run(nexus_certainty.confidence_report(db, _user(), "device", "d1"))
    assert result["found"] is True
    owner = next(a for a in result["attributes"] if a["attribute"] == "Device owner")
    assert owner["value"] == "Sarah"
    assert owner["confidence"] >= 85  # corroborated by a second record
    assert "Corroborated" in owner["reason"]
    patch = next(a for a in result["attributes"] if a["attribute"] == "Patch state")
    assert patch["confidence"] == 0
    assert "No source records" in patch["reason"]
    assert "click any score" in result["note"]


def test_confidence_ticket_links_and_404(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(tickets=_Collection([{"id": "TKT-1", "category": "network", "assigned_to": "u1",
                                   "assigned_name": "Alex", "device_id": "d1", "tenant_id": "platform-a"}]))
    result = asyncio.run(nexus_certainty.confidence_report(db, _user(), "ticket", "TKT-1"))
    link = next(a for a in result["attributes"] if a["attribute"] == "Device link")
    assert link["confidence"] == 95
    assert asyncio.run(nexus_certainty.confidence_report(db, _user(), "ticket", "ghost")) == {"found": False}


# ============== TICKET INTELLIGENCE ==============


def test_ticket_difficulty_predicts_from_history(monkeypatch):
    _fixed_clock(monkeypatch)
    history = [{"id": f"h{i}", "category": "network", "status": "closed",
                "total_time_minutes": minutes, "tenant_id": "platform-a"}
               for i, minutes in enumerate([30, 45, 60, 90, 120])]
    db = _db(tickets=_Collection(history + [
        {"id": "TKT-9", "ticket_number": "INC-9", "category": "network", "priority": "high",
         "device_id": "d1", "tenant_id": "platform-a"},
    ]))
    result = asyncio.run(nexus_certainty.ticket_difficulty(db, _user(), "TKT-9"))
    assert result["found"] is True
    assert result["similar_incidents"] == 5
    assert result["likely_skill"] == "Networking L3"
    low, high = result["estimated_active_minutes"]
    assert 15 <= low < high
    assert result["predicted_complexity"] in ("Low", "Medium", "High")
    assert "Derived from 5 resolved" in result["basis"]


def test_ticket_gravity_flags_attention_hungry_ticket(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        tickets=_Collection([
            {"id": "TKT-1", "ticket_number": "INC-4482", "created_at": "2026-09-20T09:00:00+00:00",
             "watchers": ["a", "b", "c"], "cc": ["d"], "tenant_id": "platform-a"},
            {"id": "TKT-2", "merged_into": "TKT-1", "tenant_id": "platform-a"},
        ]),
        ticket_audit_log=_Collection([{"id": "a1", "ticket_id": "TKT-1", "tenant_id": "platform-a"},
                                      {"id": "a2", "ticket_id": "TKT-1", "tenant_id": "platform-a"}]),
        time_entries=_Collection([{"id": "t1", "ticket_id": "TKT-1", "minutes": 240, "tenant_id": "platform-a"}]),
        client_communication_events=_Collection([{"id": "c1", "related_id": "TKT-1", "tenant_id": "platform-a"}]),
    )
    result = asyncio.run(nexus_certainty.ticket_gravity(db, _user(), "TKT-1"))
    assert result["gravity_score"] >= 60
    assert "unusually high operational gravity" in result["verdict"]
    assert result["breakdown"]["merged_symptoms"] == 1
    assert result["breakdown"]["logged_minutes"] == 240


def test_escalation_preflight_runs_checks_it_can(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        tickets=_Collection([{"id": "TKT-1", "ticket_number": "INC-1", "client_id": "c1",
                              "device_id": "d1", "created_at": "2026-10-03T09:00:00+00:00",
                              "tenant_id": "platform-a"}]),
        device_events=_Collection([
            {"id": "e1", "device_id": "d1", "event_type": "service_restart",
             "timestamp": "2026-10-03T10:00:00+00:00", "tenant_id": "platform-a"},
            {"id": "e2", "device_id": "d1", "event_type": "script_executed",
             "timestamp": "2026-10-03T11:00:00+00:00", "tenant_id": "platform-a"},
            {"id": "e3", "device_id": "d1", "event_type": "service_restart",
             "timestamp": "2026-10-03T12:00:00+00:00", "tenant_id": "platform-a"},
        ]),
        devices=_Collection([{"id": "d1", "name": "SRV01", "status": "offline", "tenant_id": "platform-a"}]),
    )
    result = asyncio.run(nexus_certainty.escalation_preflight(db, _user(), "TKT-1"))
    assert result["found"] is True
    assert all(c["nexus_ran"] for c in result["checks"])
    repeats = next(c for c in result["checks"] if c["check"] == "Repeated remediation attempts")
    assert repeats["ok"] is False
    assert "insanity threshold" in repeats["detail"]
    assert result["gaps"]
    assert "Not ready to escalate" in result["verdict"]
    assert result["human_checks"]


# ============== NOISE BUDGET & CORRELATION ==============


def test_noise_budget_measures_alert_usefulness(monkeypatch):
    _fixed_clock(monkeypatch)
    alerts = [{"id": f"a{i}", "alert_type": "cpu_high", "client_id": "c1", "device_id": "d{i}",
               "severity": "warning", "status": "active",
               "created_at": "2026-10-03T09:00:00+00:00", "tenant_id": "platform-a"}
              for i in range(4)]
    db = _db(
        alerts=_Collection(alerts),
        alert_suppression_rules=_Collection([{"id": "s1", "suppressed_count": 120, "tenant_id": "platform-a"}]),
    )
    result = asyncio.run(nexus_certainty.noise_budget(db, _user()))
    row = result["by_type"][0]
    assert row["alert_type"] == "cpu_high"
    assert row["noise_rate_pct"] == 100.0  # nobody acted on any of them
    assert "Stop interrupting technicians" in row["recommendation"]
    assert result["already_suppressed"] == 120
    assert "measured from technician action" in result["verdict"]


def test_correlate_tickets_finds_one_problem_many_symptoms(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(tickets=_Collection([
        {"id": "T1", "ticket_number": "INC-1", "client_id": "c1", "client_name": "ACME",
         "title": "Outlook slow", "category": "m365", "status": "open",
         "created_at": "2026-10-03T09:00:00+00:00", "tenant_id": "platform-a"},
        {"id": "T2", "ticket_number": "INC-2", "client_id": "c1", "client_name": "ACME",
         "title": "Teams disconnecting", "category": "m365", "status": "open",
         "created_at": "2026-10-03T10:00:00+00:00", "tenant_id": "platform-a"},
        {"id": "T3", "ticket_number": "INC-3", "client_id": "c1", "client_name": "ACME",
         "title": "Printer offline warehouse", "category": "hardware", "status": "open",
         "created_at": "2026-10-03T11:00:00+00:00", "tenant_id": "platform-a"},
        {"id": "T4", "ticket_number": "INC-4", "client_id": "c1", "client_name": "ACME",
         "title": "Printer offline reception", "category": "hardware", "status": "open",
         "created_at": "2026-10-03T12:00:00+00:00", "tenant_id": "platform-a"},
    ]))
    result = asyncio.run(nexus_certainty.correlate_tickets(db, _user()))
    assert len(result["clusters"]) == 1
    cluster = result["clusters"][0]
    # Both symptoms are M365 apps degrading together — the shared deeper layer is the likely cause.
    assert cluster["probable_common_cause"] == "network / WAN"
    assert cluster["symptom_count"] == 2
    assert "ONE incident" in cluster["recommendation"]
    batch = next(b for b in result["batches"] if b["category"] == "hardware")
    assert batch["ticket_count"] == 2
    assert "canary" in batch["suggested_flow"]


# ============== AUDIT READINESS ==============


def test_audit_readiness_assembles_evidence_and_gaps(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        devices=_Collection([{"id": "d1", "serial_number": "SN-1", "tenant_id": "platform-a"}]),
        device_events=_Collection([{"id": "e1", "device_id": "d1", "event_type": "backup_completed",
                                    "timestamp": "2026-10-03T01:00:00+00:00", "tenant_id": "platform-a"}]),
        compliance_reports=_Collection([{"id": "r1", "framework": "cis", "passed": 15, "total": 18,
                                         "score": 85, "scanned_at": "2026-09-19T00:00:00+00:00",
                                         "tenant_id": "platform-a"}]),
        activity_logs=_Collection([{"id": "l1", "action": "device.updated", "tenant_id": "platform-a"},
                                   {"id": "l2", "action": "ticket.updated", "tenant_id": "platform-a"}]),
    )
    result = asyncio.run(nexus_certainty.audit_readiness(db, _user()))
    names = {c["control"]: c for c in result["controls"]}
    assert names["Backup verification"]["status"] == "partial"
    assert "Recoverability unproven" in names["Backup verification"]["evidence"]
    assert names["MFA enforcement"]["status"] == "unknown"
    assert names["Change logs"]["status"] == "verified"
    assert 0 < result["readiness_pct"] < 100
    assert "Asset inventory export" in result["pack_manifest"]
    assert "evidence package ready" in result["verdict"]


# ============== NEXUS LAWS ==============


def test_laws_block_destructive_and_vendor_status_actions(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    blocked = asyncio.run(nexus_certainty.evaluate_action(db, _user(), {
        "action_type": "format_volume", "target": "srv01", "destructive": True,
        "recoverability_evidence": False,
    }))
    assert blocked["overall"] == "blocked"
    assert any(d["law_id"] == "law-recoverability" for d in blocked["decisions"])
    assert "BLOCKED" in blocked["verdict"]

    vendor = asyncio.run(nexus_certainty.evaluate_action(db, _user(), {
        "action_type": "report_backup_health", "target": "nas03", "vendor_status_only": True,
    }))
    assert vendor["overall"] == "blocked"
    assert any(d["law_id"] == "law-vendor-status" for d in vendor["decisions"])

    clean = asyncio.run(nexus_certainty.evaluate_action(db, _user(), {
        "action_type": "read_telemetry", "target": "srv01",
    }))
    assert clean["overall"] == "allowed"
    assert "Allowed" in clean["verdict"]


def test_custom_laws_forbid_actions_and_protect_friday(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    forbidden = asyncio.run(nexus_certainty.record_law(db, _user(), {
        "kind": "forbidden_action", "pattern": "reboot", "target_pattern": "acme-prod",
        "text": "Never reboot ACME-PROD during payroll.",
    }))
    assert forbidden["tenant_id"] == "platform-a"
    window = asyncio.run(nexus_certainty.record_law(db, _user(), {
        "kind": "time_window", "pattern": "firewall", "target_pattern": "",
        "blocked_weekdays": [4], "blocked_start_hour": 15, "blocked_end_hour": 23,
        "text": "No firewall changes Friday afternoon.",
    }))

    hit = asyncio.run(nexus_certainty.evaluate_action(db, _user(), {
        "action_type": "reboot", "target": "ACME-PROD-SQL", "scheduled_time": "2026-10-02T16:58:00+00:00",
    }))
    assert hit["overall"] == "blocked"
    assert any(d["law_id"] == forbidden["id"] for d in hit["decisions"])

    friday = asyncio.run(nexus_certainty.evaluate_action(db, _user(), {
        "action_type": "firewall_upgrade", "target": "fw01", "scheduled_time": "2026-10-02T16:58:00+00:00",
    }))
    assert friday["overall"] == "blocked"
    assert any("It's Friday at 16:58" in d["reason"] for d in friday["decisions"])

    monday = asyncio.run(nexus_certainty.evaluate_action(db, _user(), {
        "action_type": "firewall_upgrade", "target": "fw01", "scheduled_time": "2026-10-05T10:00:00+00:00",
    }))
    assert monday["overall"] == "allowed"


def test_law_recording_requires_admin_and_valid_kind(monkeypatch):
    _fixed_clock(monkeypatch)
    monkeypatch.setattr(tech_fun_router, "db", _db())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.record_law({"kind": "forbidden_action", "pattern": "x"}, _user()))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.record_law({"kind": "chaos"}, _user(admin=True)))
    assert exc.value.status_code == 400


# ============== CREDENTIAL GUARD & REALITY CHECKS ==============


def test_credential_scan_never_echoes_the_secret(monkeypatch):
    _fixed_clock(monkeypatch)
    draft = "VPN user is bob, password: hunter2-actual-secret, thanks"
    result = asyncio.run(nexus_certainty.credential_scan(_db(), _user(), draft))
    assert result["detected"] is True
    assert "Absolutely not" in result["verdict"]
    assert "hunter2-actual-secret" not in str(result)
    assert "[REDACTED credential]" in result["redacted_text"]
    assert result["findings"][0]["field"] == "password"
    assert "Store securely instead" in result["guidance"]

    clean = asyncio.run(nexus_certainty.credential_scan(_db(), _user(), "Reset the user's password via the portal."))
    assert clean["detected"] is False


def test_ticket_reality_check_lines(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        tickets=_Collection([{"id": "TKT-1", "ticket_number": "INC-1", "title": "URGENT!!! server down!!!",
                              "priority": "low", "device_id": "d1", "tenant_id": "platform-a"}]),
        ticket_audit_log=_Collection([{"id": "a1", "ticket_id": "TKT-1",
                                       "details": "priority: low -> high", "tenant_id": "platform-a"}]),
    )
    result = asyncio.run(nexus_certainty.ticket_reality_check(db, _user(), "TKT-1"))
    kinds = {f["kind"] for f in result["findings"]}
    assert "urgency_punctuation" in kinds
    assert "nobody_changed_anything" in kinds
    urgency = next(f for f in result["findings"] if f["kind"] == "urgency_punctuation")
    assert "Technical severity remains low" in urgency["line"]
    narrator = next(f for f in result["findings"] if f["kind"] == "nobody_changed_anything")
    assert "Narrator: somebody changed something" in narrator["line"]
    assert narrator["changes"]


def test_presence_effect_counts_connection_fixes(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        work_activity_audit=_Collection([{"id": "w1", "user_name": "Aaron", "event": "viewed",
                                          "work_item": "remote", "created_at": "2026-10-03T10:41:00+00:00",
                                          "tenant_id": "platform-a"}]),
        tickets=_Collection([{"id": "T1", "status": "closed", "assigned_name": "Aaron",
                              "resolved_at": "2026-10-03T10:50:00+00:00", "tenant_id": "platform-a"}]),
    )
    result = asyncio.run(nexus_certainty.presence_effect(db, _user()))
    assert result["total"] == 1
    assert result["per_technician"][0] == {"technician": "Aaron", "count": 1}
    assert "Presence Effect confirmed" in result["verdict"]


# ============== ROUTER CONTRACTS ==============


def test_router_404s_for_missing_scope(monkeypatch):
    _fixed_clock(monkeypatch)
    monkeypatch.setattr(tech_fun_router, "db", _db())
    for call in (
        lambda: tech_fun_router.prove_it("backup", "ghost", _user()),
        lambda: tech_fun_router.confidence_report("device", "ghost", _user()),
        lambda: tech_fun_router.ticket_difficulty("ghost", _user()),
        lambda: tech_fun_router.ticket_gravity("ghost", _user()),
        lambda: tech_fun_router.escalation_preflight("ghost", _user()),
        lambda: tech_fun_router.ticket_reality_check("ghost", _user()),
    ):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(call())
        assert exc.value.status_code == 404
