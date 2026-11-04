"""Nexus Dead End Detector tests.

The detector notices when the *investigation* stops reducing uncertainty, using
the breadcrumbs the technician already records. These tests pin the verdict
rules, the suggested next test and the advisory boundary, plus the route's
tenant and client scope.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.routers import nexus_flow
from app.routers.nexus_flow import BreadcrumbPayload
from app.services.nexus_flow import investigation_health

NOW = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)


def _crumb(kind, text, minutes_ago, scope="dev-1"):
    return {"kind": kind, "text": text, "scope_ref": scope, "created_at": (NOW - timedelta(minutes=minutes_ago)).isoformat()}


def test_two_breadcrumbs_are_not_enough_for_a_verdict():
    health = investigation_health([_crumb("tested", "Ping the printer", 20)], now=NOW)
    assert health["verdict"] == "insufficient_evidence"
    assert health["recommended_test"] is None
    assert health["repeated_tests"] == 0


def test_repeated_diagnostics_without_new_evidence_are_reported_as_stalled():
    breadcrumbs = [
        _crumb("hypothesis", "The print spooler is wedged", 35),
        _crumb("tested", "Restart the print spooler", 30),
        _crumb("tested", "Restart the print spooler", 20),
        _crumb("tested", "Restart the print spooler", 10),
    ]
    health = investigation_health(breadcrumbs, now=NOW)
    assert health["verdict"] == "stalled"
    assert health["repeated_tests"] == 2
    assert health["unverified_assumptions"] == ["The print spooler is wedged"]
    # The whole point is to change the input, not repeat the same test again.
    assert "known-good device" in health["recommended_test"]
    assert "does not decide the diagnosis" in health["boundary"]


def test_a_single_repeat_is_at_risk_rather_than_stalled():
    breadcrumbs = [
        _crumb("tested", "Check DNS resolution", 40),
        _crumb("tested", "Check DNS resolution", 35),
        _crumb("tested", "Reinstall the driver", 20),
    ]
    health = investigation_health(breadcrumbs, now=NOW, stall_after_minutes=30)
    assert health["verdict"] == "at_risk"
    assert health["repeated_tests"] == 1


def test_a_short_stall_window_still_reports_progress():
    breadcrumbs = [
        _crumb("tested", "Check DNS resolution", 6),
        _crumb("tested", "Check DNS resolution", 4),
        _crumb("tested", "Check DNS resolution", 2),
    ]
    # Two repeats, but only minutes into the session: Nexus does not call that a
    # dead end yet.
    health = investigation_health(breadcrumbs, now=NOW, stall_after_minutes=30)
    assert health["verdict"] == "at_risk"
    assert health["minutes_investigating"] == 6


def test_conclusions_and_new_tests_read_as_progress():
    breadcrumbs = [
        _crumb("tested", "Check DNS resolution", 50),
        _crumb("ruled_out", "DNS resolution of the print server", 45),
        _crumb("tested", "Check spooler queue depth", 30),
        _crumb("ruled_out", "Spooler queue saturation", 20),
        _crumb("next_step", "Compare driver versions across the fleet", 10),
    ]
    health = investigation_health(breadcrumbs, now=NOW)
    assert health["verdict"] == "progressing"
    assert health["tests_since_conclusion"] == 0
    assert health["repeated_tests"] == 0
    assert health["recommended_test"].startswith("Keep going")


def test_a_test_from_a_second_scope_is_not_treated_as_converged():
    breadcrumbs = [
        _crumb("hypothesis", "SQL connectivity is failing at the app tier", 40),
        _crumb("tested", "Direct TDS connection from the app server", 30, scope="dev-1"),
        _crumb("tested", "Traceroute from a known-good workstation", 20, scope="dev-2"),
    ]
    health = investigation_health(breadcrumbs, now=NOW)
    assert health["evidence_source_converged"] is False
    assert health["scopes_tested"] == ["dev-1", "dev-2"]


# ── route boundary ───────────────────────────────────────────────────────────


class _Result:
    def __init__(self, matched_count=0):
        self.matched_count = matched_count


def _matches(row, query):
    for key, expected in query.items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _Rows:
    def __init__(self):
        self.rows = []

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set") or {})
                return _Result(1)
        return _Result(0)

    async def insert_one(self, document):
        self.rows.append(dict(document))

    def find(self, query, _projection=None):
        return _Cursor([dict(row) for row in self.rows if _matches(row, query)])


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self._rows)


class _Db:
    def __init__(self):
        self._tables = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._tables.setdefault(name, _Rows())


class _Audit:
    def __init__(self):
        self.entries = []

    async def __call__(self, user, action, entity_type, entity_id, entity_name="", details="", **kwargs):
        self.entries.append({"action": action})


def _user(user_id="tech-1", tenant="tenant-a", client_ids=None):
    user = {"id": user_id, "tenant_id": tenant, "name": "Flow Tech", "email": f"{user_id}@example.com", "is_admin": client_ids is None}
    if client_ids is not None:
        user["client_scope_mode"] = "restricted"
        user["client_scope_ids"] = list(client_ids)
    return user


def _install(monkeypatch, db):
    monkeypatch.setattr(nexus_flow, "db", db)
    monkeypatch.setattr(nexus_flow, "log_activity", _Audit())


def test_investigation_health_route_uses_recorded_breadcrumbs_and_scope(monkeypatch):
    db = _Db()
    _install(monkeypatch, db)
    user = _user()
    db.tickets.rows.append({"id": "tkt-1", "tenant_id": "tenant-a", "client_id": "cli-1", "ticket_number": "TKT-001"})

    for text in ("Restart the print spooler", "Restart the print spooler", "Restart the print spooler"):
        asyncio.run(nexus_flow.record_breadcrumb(
            "tkt-1", BreadcrumbPayload(kind="tested", text=text, scope_ref="dev-1"), current_user=user,
        ))
    asyncio.run(nexus_flow.record_breadcrumb(
        "tkt-1", BreadcrumbPayload(kind="hypothesis", text="The print spooler is wedged", scope_ref="dev-1"), current_user=user,
    ))

    # A breadcrumb another tenant recorded against the same ticket ID must never
    # be counted for this tenant.
    db.nexus_breadcrumbs.rows.append({
        "id": "bcr-other",
        "tenant_id": "tenant-b",
        "ticket_id": "tkt-1",
        "kind": "tested",
        "text": "Something another tenant recorded",
        "scope_ref": "dev-9",
        "created_at": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
    })

    health = asyncio.run(nexus_flow.get_investigation_health("tkt-1", current_user=user))
    assert health["breadcrumbs_considered"] == 4
    assert health["verdict"] in {"stalled", "at_risk"}
    assert health["repeated_tests"] >= 1

    # Another tenant cannot see this ticket at all, so the route never confirms
    # that the record exists.
    with pytest.raises(Exception) as other_tenant:
        asyncio.run(nexus_flow.get_investigation_health("tkt-1", current_user=_user(tenant="tenant-b")))
    assert "not found" in str(other_tenant.value).lower()

    restricted = _user(client_ids=["cli-1"])
    assert asyncio.run(nexus_flow.get_investigation_health("tkt-1", current_user=restricted))["breadcrumbs_considered"] == 4

    hidden = _user(client_ids=["cli-9"])
    with pytest.raises(Exception) as missing:
        asyncio.run(nexus_flow.get_investigation_health("tkt-1", current_user=hidden))
    assert "not found" in str(missing.value).lower()
