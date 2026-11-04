"""Customer Environment Studio tests.

Two things are pinned here, and both are the reason the studio exists at all:

1. **Disclosure.** A dimension that was not measured returns ``None`` with its
   reason. It never returns ``0``, and the health state is never ``healthy`` when
   nothing was measured.
2. **Correlation is not causation.** A candidate names the change, the ticket and
   the stable identifier that linked them, and the response carries the boundary
   sentence verbatim so a UI cannot invent a stronger claim.
"""

from __future__ import annotations

import asyncio
import os
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.auth import get_current_user  # noqa: E402
from app.routers import customer_environment  # noqa: E402
from app.services import customer_environment as policy  # noqa: E402
from test_studio_fleet import _mounted_operation  # noqa: E402

USER = {"id": "admin-1", "name": "Ada Admin", "role": "admin", "is_admin": True}
NOW = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)


def _recent(**delta) -> str:
    """A timestamp relative to the real clock.

    The route handlers deliberately evaluate evidence against wall-clock time, so
    the HTTP-boundary fixture below must seed records that are fresh *now*; the
    fixed ``NOW`` above only ever anchors the pure-policy tests that pass ``now=``
    explicitly.
    """
    return (datetime.now(timezone.utc) - timedelta(**delta)).isoformat()


# ============== DIMENSION DISCLOSURE ==============


def test_assessed_dimension_requires_a_real_integer_count():
    assert policy.build_dimension(142, source="devices")["value"] == 142
    with pytest.raises(ValueError, match="integer value"):
        policy.build_dimension("142")
    with pytest.raises(ValueError, match="integer value"):
        policy.build_dimension(True)
    with pytest.raises(ValueError, match="negative"):
        policy.build_dimension(-1)


def test_unassessed_dimension_must_disclose_its_reason():
    with pytest.raises(ValueError, match="must disclose the reason"):
        policy.build_dimension(assessed=False)
    disclosed = policy.build_dimension(assessed=False, reason="Not collected for this view.")
    assert disclosed["value"] is None
    assert disclosed["assessed"] is False
    assert disclosed["reason"] == "Not collected for this view."


def test_signal_states_are_governed_and_unmeasured_states_state_why():
    assert policy.build_signal("x", "X", "verified")["state"] == "verified"
    with pytest.raises(ValueError, match="unknown signal state"):
        policy.build_signal("x", "X", "healthy")
    with pytest.raises(ValueError, match="must disclose why"):
        policy.build_signal("x", "X", "not_measured")


def test_health_is_unknown_when_nothing_was_measured():
    assert policy.environment_health([])["state"] == "unknown"
    assert policy.environment_health([
        policy.build_signal("a", "A", "not_measured", "No source."),
    ])["state"] == "unknown"


def test_health_needs_attention_on_a_due_chip_and_is_healthy_only_when_all_positive():
    assert policy.environment_health([
        policy.build_signal("a", "A", "verified"),
        policy.build_signal("b", "B", "due", "Backup recovery test is due."),
    ])["state"] == "attention"
    assert policy.environment_health([
        policy.build_signal("a", "A", "verified"),
        policy.build_signal("b", "B", "connected"),
    ])["state"] == "healthy"


def test_every_dimension_lands_in_exactly_one_group():
    dimensions = {key: policy.build_dimension(0) for key in policy.ENVIRONMENT_DIMENSIONS}
    grouped = policy.group_dimensions(dimensions)
    assert set(grouped) == set(policy.DIMENSION_GROUPS)
    seen = [item["id"] for items in grouped.values() for item in items]
    assert sorted(seen) == sorted(policy.ENVIRONMENT_DIMENSIONS)


def test_overview_discloses_missing_dimensions_instead_of_zeroing_them():
    overview = policy.build_overview(
        client_id="acme", client_name="Acme Manufacturing",
        dimensions={"devices": policy.build_dimension(142, source="devices")},
    )
    assert overview["dimensions"]["devices"]["value"] == 142
    missing = overview["dimensions"]["websites"]
    assert missing["value"] is None and missing["assessed"] is False
    assert missing["reason"]
    assert overview["health"]["state"] == "unknown"


# ============== TIMESTAMPS AND TARGETS ==============


def test_record_timestamp_parses_iso_and_zulu_and_refuses_junk():
    assert policy.record_timestamp({"created_at": "2026-10-11T09:00:00Z"}) == datetime(
        2026, 10, 11, 9, 0, tzinfo=timezone.utc)
    assert policy.record_timestamp({"occurred_at": "not-a-date"}) is None
    assert policy.record_timestamp({}) is None


def test_correlation_targets_use_stable_ids_only():
    targets = policy.correlation_targets({
        "device_id": "dev-1", "name": "SERVER03", "hostname": "server03.acme.local",
        "affected_ids": ["svc-9", "", None],
    })
    assert targets == {"dev-1", "svc-9"}


# ============== CORRELATION ==============


def test_a_change_sharing_a_target_before_the_ticket_is_a_strong_candidate():
    result = policy.correlate_changes_with_tickets(
        changes=[{"id": "chg-1", "title": "Reboot SERVER03", "device_id": "dev-1",
                  "client_id": "acme", "status": "applied",
                  "changed_at": (NOW - timedelta(hours=2)).isoformat()}],
        open_tickets=[{"id": "tkt-1", "title": "Outlook disconnects", "device_id": "dev-1",
                       "client_id": "acme", "created_at": NOW.isoformat()}],
        now=NOW,
    )
    assert len(result["candidates"]) == 1
    candidate = result["candidates"][0]
    assert candidate["strength"] == "strong"
    assert candidate["shared_targets"] == ["dev-1"]
    assert candidate["minutes_before_ticket"] == 120
    assert "dev-1" in candidate["basis"]
    assert result["boundary"] == policy.INVESTIGATION_BOUNDARY


def test_same_client_without_a_shared_target_is_only_a_weak_candidate():
    result = policy.correlate_changes_with_tickets(
        changes=[{"id": "chg-2", "title": "Firewall rule change", "client_id": "acme",
                  "changed_at": (NOW - timedelta(hours=1)).isoformat()}],
        open_tickets=[{"id": "tkt-2", "title": "Site unreachable", "client_id": "acme",
                       "created_at": NOW.isoformat()}],
        now=NOW,
    )
    assert [candidate["strength"] for candidate in result["candidates"]] == ["weak"]


def test_a_change_after_the_ticket_or_outside_the_window_is_not_a_candidate():
    after = policy.correlate_changes_with_tickets(
        changes=[{"id": "chg-3", "device_id": "dev-1", "client_id": "acme",
                  "changed_at": (NOW + timedelta(minutes=5)).isoformat()}],
        open_tickets=[{"id": "tkt-3", "device_id": "dev-1", "client_id": "acme",
                       "created_at": NOW.isoformat()}],
        now=NOW,
    )
    assert after["candidates"] == []

    outside = policy.correlate_changes_with_tickets(
        changes=[{"id": "chg-4", "device_id": "dev-1", "client_id": "acme",
                  "changed_at": (NOW - timedelta(hours=50)).isoformat()}],
        open_tickets=[{"id": "tkt-4", "device_id": "dev-1", "client_id": "acme",
                       "created_at": NOW.isoformat()}],
        now=NOW, window_hours=24,
    )
    assert outside["candidates"] == []


def test_unrelated_and_untimed_records_never_produce_a_candidate():
    result = policy.correlate_changes_with_tickets(
        changes=[{"id": "chg-5", "client_id": "other", "device_id": "dev-9",
                  "changed_at": (NOW - timedelta(hours=1)).isoformat()},
                 {"id": "chg-6", "client_id": "acme", "device_id": "dev-1"}],
        open_tickets=[{"id": "tkt-5", "client_id": "acme", "device_id": "dev-1",
                       "created_at": NOW.isoformat()},
                      {"id": "tkt-6", "client_id": "acme", "device_id": "dev-1"}],
        now=NOW,
    )
    assert result["candidates"] == []


def test_candidates_are_ordered_strongest_first():
    result = policy.correlate_changes_with_tickets(
        changes=[{"id": "chg-weak", "client_id": "acme",
                  "changed_at": (NOW - timedelta(minutes=10)).isoformat()},
                 {"id": "chg-strong", "client_id": "acme", "device_id": "dev-1",
                  "changed_at": (NOW - timedelta(minutes=30)).isoformat()}],
        open_tickets=[{"id": "tkt-1", "client_id": "acme", "device_id": "dev-1",
                       "created_at": NOW.isoformat()}],
        now=NOW,
    )
    assert [candidate["change_id"] for candidate in result["candidates"]] == ["chg-strong", "chg-weak"]


def test_investigation_response_states_the_question_and_the_boundary():
    investigation = policy.build_investigation(
        client_id="acme", changes=[], open_tickets=[], now=NOW, window_hours=12,
    )
    assert investigation["client_id"] == "acme"
    assert "what changed" in investigation["question"].lower()
    assert investigation["window_hours"] == 12
    assert investigation["boundary"] == policy.INVESTIGATION_BOUNDARY
    assert "never claims" in investigation["boundary"]


def test_window_must_be_positive():
    with pytest.raises(ValueError, match="window_hours must be positive"):
        policy.correlate_changes_with_tickets(changes=[], open_tickets=[], now=NOW, window_hours=0)


# ============== HTTP BOUNDARY ==============


def _matches(row: dict, query: dict) -> bool:
    for key, value in query.items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in value):
                return False
        elif key == "$or":
            if not any(_matches(row, clause) for clause in value):
                return False
        elif isinstance(value, dict):
            if "$in" in value and row.get(key) not in value["$in"]:
                return False
            if "$nin" in value and row.get(key) in value["$nin"]:
                return False
            if "$ne" in value and row.get(key) == value["$ne"]:
                return False
            if "$exists" in value and (key in row) != value["$exists"]:
                return False
        elif row.get(key) != value:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args):
        return self

    async def to_list(self, limit):
        return [dict(row) for row in self.rows[:limit]]


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def _matched(self, query):
        return [row for row in self.rows if _matches(row, query or {})]

    def find(self, query=None, projection=None):
        return _Cursor(self._matched(query))

    async def find_one(self, query=None, projection=None):
        found = self._matched(query)
        return dict(found[0]) if found else None

    async def count_documents(self, query=None):
        return len(self._matched(query))

    async def insert_one(self, row):
        self.rows.append(dict(row))


@pytest.fixture
def database(monkeypatch):
    fake = types.SimpleNamespace(
        clients=_Collection([{"id": "acme", "name": "Acme Manufacturing"}]),
        devices=_Collection([{"id": "dev-1", "client_id": "acme"}]),
        web_sites=_Collection([{"id": "site-1", "client_id": "acme", "priority": "critical",
                                "enquiry_form_state": "verified"}]),
        contracts=_Collection([{"id": "con-1", "client_id": "acme", "status": "active"}]),
        tickets=_Collection([{"id": "tkt-1", "client_id": "acme", "status": "open",
                              "device_id": "dev-1", "created_at": _recent()}]),
        change_management=_Collection([{"id": "chg-1", "client_id": "acme", "device_id": "dev-1",
                                        "changed_at": _recent(hours=2)}]),
        alerts=_Collection([{"id": "alert-1", "client_id": "acme", "status": "open"}]),
        backup_jobs=_Collection([{"id": "wl-1", "client_id": "acme", "rpo_hours": 24,
                                  "last_verified_recovery_at": _recent(hours=2)}]),
        settings=_Collection([{"type": "microsoft_graph_connection", "status": "connected"}]),
        scope_denials=_Collection(),
    )
    monkeypatch.setattr(customer_environment, "db", fake)
    return fake


def test_environment_endpoints_are_mounted_behind_authentication():
    for method, path, handler in (
        ("GET", "/api/customer-environment/summary", customer_environment.environment_summary),
        ("GET", "/api/customer-environment/acme", customer_environment.environment_overview),
        ("GET", "/api/customer-environment/acme/investigation", customer_environment.environment_investigation),
    ):
        route = _mounted_operation(method, path)
        assert route is not None, f"{method} {path} is not mounted"
        assert route.endpoint is handler, f"{method} {path} is shadowed by another route"
        dependency_calls = [dep.call for dep in route.dependant.dependencies]
        assert get_current_user in dependency_calls, f"{method} {path} is not auth-guarded"


def test_unknown_customer_is_a_404_not_an_empty_environment(database):
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(customer_environment.environment_overview(
            "definitely-not-a-client", user=USER))
    assert excinfo.value.status_code == 404


def test_summary_returns_the_disclosed_counts_for_every_scoped_customer(database):
    response = asyncio.run(customer_environment.environment_summary(user=USER))
    assert set(response) == {"clients", "count", "boundary"}
    assert response["count"] == 1
    row = response["clients"][0]
    assert row["client_id"] == "acme"
    assert row["dimensions"]["devices"]["value"] == 1
    assert row["dimensions"]["services"]["value"] == 1
    assert row["dimensions"]["open_tickets"]["value"] == 1
    assert row["dimensions"]["alerts"]["value"] == 1


def test_overview_derives_signals_from_records_and_never_invents_a_state(database):
    overview = asyncio.run(customer_environment.environment_overview("acme", user=USER))
    signals = {signal["id"]: signal for signal in overview["signals"]}
    assert signals["website_enquiry_workflow"]["state"] == "verified"
    assert signals["backup_recovery_test"]["state"] == "verified"
    assert signals["microsoft_365_integration"]["state"] == "connected"
    assert overview["health"]["state"] == "healthy"


def test_investigation_correlates_a_change_with_an_open_ticket(database):
    response = asyncio.run(customer_environment.environment_investigation(
        "acme", window_hours=24, user=USER))
    assert response["client_id"] == "acme"
    assert [candidate["change_id"] for candidate in response["candidates"]] == ["chg-1"]
    assert response["candidates"][0]["strength"] == "strong"
    assert response["boundary"] == policy.INVESTIGATION_BOUNDARY


def test_every_declared_dimension_has_metadata():
    # A structural guard: forgetting to add metadata for a new dimension would
    # otherwise silently drop it from the overview and every group tab.
    assert set(policy.DIMENSION_META) == set(policy.ENVIRONMENT_DIMENSIONS)
    for dimension_id, meta in policy.DIMENSION_META.items():
        assert meta["group"] in policy.DIMENSION_GROUPS, dimension_id
        assert meta["label"] and meta["question"], dimension_id
