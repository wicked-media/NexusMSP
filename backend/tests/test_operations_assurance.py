"""Operations Assurance Studio tests.

The claim this studio makes is narrow and must stay narrow: **"was the promised
outcome achieved?"**, answered only from recorded evidence. A commitment with no
recorded evidence is ``not_measured`` with its reason — never ``met``, and never
quietly dropped from the report.
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
from app.routers import operations_assurance as routes  # noqa: E402
from app.services import operations_assurance as policy  # noqa: E402
from app.services import service_gap  # noqa: E402
from app.services import scope_permissions  # noqa: E402
from test_studio_fleet import _mounted_operation  # noqa: E402

USER = {"id": "admin-1", "name": "Ada Admin", "role": "admin", "is_admin": True}
RESTRICTED = {
    "id": "tech-1", "name": "Tina Tech", "role": "technician", "is_admin": False,
    "client_scope_mode": "restricted", "client_scope_ids": ["acme"],
}
NOW = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)


def _iso(**delta) -> str:
    return (NOW - timedelta(**delta)).isoformat()


def _recent(**delta) -> str:
    """A timestamp relative to the real clock.

    The route handlers deliberately evaluate against wall-clock time, so the
    HTTP-boundary fixture below has to seed evidence that is fresh *now*. Seeding
    it against the fixed ``NOW`` above would pass until that date aged out of the
    commitment window and then fail as a time bomb.
    """
    return (datetime.now(timezone.utc) - timedelta(**delta)).isoformat()


def _by_id(report: dict) -> dict:
    return {row["id"]: row for row in report["commitments"]}


# ============== THE CATALOGUE ==============


def test_every_commitment_names_a_promise_and_an_evidence_source():
    assert policy.COMMITMENTS
    for commitment in policy.COMMITMENTS:
        assert commitment["promise"].strip()
        assert commitment["evidence_source"].strip()
        assert commitment["owner"].strip()
        assert callable(commitment["evaluate"])


def test_an_unknown_commitment_id_is_a_key_error():
    with pytest.raises(KeyError):
        policy.evaluate_commitment("not-a-commitment", [], now=NOW)


def test_a_commitment_with_no_evidence_entry_is_not_measured_not_met():
    report = policy.evaluate_all({}, now=NOW)
    for row in report["commitments"]:
        assert row["state"] == "not_measured"
        assert row["reason"]
    assert report["summary"]["not_measured"] == len(policy.COMMITMENTS)
    assert report["summary"]["met"] == 0
    assert report["boundary"] == policy.ASSURANCE_BOUNDARY


# ============== RECOVERY POINT ==============


def test_recovery_point_is_met_only_when_every_verified_point_is_inside_its_rpo():
    report = policy.evaluate_all({"verified_recovery_point": [
        {"id": "wl-1", "name": "SQL", "rpo_hours": 24, "last_verified_recovery_at": _iso(hours=3)},
        {"id": "wl-2", "name": "File", "rpo_hours": 24, "last_verified_recovery_at": _iso(hours=20)},
    ]}, now=NOW)
    row = _by_id(report)["verified_recovery_point"]
    assert row["state"] == "met"
    assert row["counts"]["breached"] == 0


def test_recovery_point_breaches_when_a_verified_point_is_older_than_the_rpo():
    report = policy.evaluate_all({"verified_recovery_point": [
        {"id": "wl-1", "name": "SQL", "rpo_hours": 24, "last_verified_recovery_at": _iso(hours=30)},
    ]}, now=NOW)
    row = _by_id(report)["verified_recovery_point"]
    assert row["state"] == "breached"
    assert row["gaps"][0]["workload_id"] == "wl-1"
    assert row["gaps"][0]["age_hours"] == 30.0


def test_recovery_point_is_at_risk_when_a_workload_was_never_verified():
    report = policy.evaluate_all({"verified_recovery_point": [
        {"id": "wl-1", "name": "SQL", "rpo_hours": 24},
    ]}, now=NOW)
    row = _by_id(report)["verified_recovery_point"]
    assert row["state"] == "at_risk"
    assert row["gaps"][0]["age_hours"] is None


def test_recovery_point_is_not_measured_without_an_agreed_objective():
    report = policy.evaluate_all({"verified_recovery_point": [{"id": "wl-1", "name": "SQL"}]}, now=NOW)
    assert _by_id(report)["verified_recovery_point"]["state"] == "not_measured"
    assert _by_id(report)["verified_recovery_point"]["gaps"] == []


# ============== ENQUIRY FORM ==============


def test_enquiry_form_is_met_when_every_critical_site_is_verified():
    report = policy.evaluate_all({"website_enquiry_form": [
        {"id": "site-1", "name": "Acme", "enquiry_form_state": "verified"},
    ]}, now=NOW)
    assert _by_id(report)["website_enquiry_form"]["state"] == "met"


def test_enquiry_form_breaches_when_a_critical_site_is_missing_one():
    report = policy.evaluate_all({"website_enquiry_form": [
        {"id": "site-1", "name": "Acme", "enquiry_form_state": "missing"},
    ]}, now=NOW)
    row = _by_id(report)["website_enquiry_form"]
    assert row["state"] == "breached"
    assert row["gaps"][0]["website_id"] == "site-1"


def test_an_unassessed_enquiry_form_is_at_risk_not_a_silent_pass():
    report = policy.evaluate_all({"website_enquiry_form": [
        {"id": "site-1", "name": "Acme", "enquiry_form_state": ""},
    ]}, now=NOW)
    assert _by_id(report)["website_enquiry_form"]["state"] == "at_risk"


# ============== DEPARTED ACCESS ==============


def test_departed_access_is_not_measured_with_no_departures_recorded():
    report = policy.evaluate_all({"departed_user_access_revoked": []}, now=NOW)
    assert _by_id(report)["departed_user_access_revoked"]["state"] == "not_measured"


def test_departed_access_breaches_when_revocation_was_late():
    report = policy.evaluate_all({"departed_user_access_revoked": [
        {"user_id": "u-1", "name": "Ex Employee", "left_at": _iso(hours=10),
         "revoked_at": _iso(hours=2), "timeframe_hours": 4},
    ]}, now=NOW)
    row = _by_id(report)["departed_user_access_revoked"]
    assert row["state"] == "breached"
    assert row["gaps"][0]["elapsed_hours"] == 8.0


def test_departed_access_is_at_risk_while_access_is_still_live():
    report = policy.evaluate_all({"departed_user_access_revoked": [
        {"user_id": "u-2", "name": "Ex Employee", "left_at": _iso(hours=1), "timeframe_hours": 4},
    ]}, now=NOW)
    assert _by_id(report)["departed_user_access_revoked"]["state"] == "at_risk"


def test_departed_access_is_met_when_revocation_was_inside_the_timeframe():
    report = policy.evaluate_all({"departed_user_access_revoked": [
        {"user_id": "u-3", "name": "Ex Employee", "left_at": _iso(hours=10),
         "revoked_at": _iso(hours=8), "timeframe_hours": 4},
    ]}, now=NOW)
    assert _by_id(report)["departed_user_access_revoked"]["state"] == "met"


# ============== MONITORING WINDOW ==============


def test_monitoring_breaches_when_an_endpoint_never_reported():
    report = policy.evaluate_all({"monitoring_reporting_window": [
        {"device_id": "dev-1", "name": "PC-1", "window_hours": 24},
    ]}, now=NOW)
    row = _by_id(report)["monitoring_reporting_window"]
    assert row["state"] == "breached"
    assert row["gaps"][0]["silent_hours"] is None


def test_monitoring_is_met_inside_the_window_and_not_measured_without_endpoints():
    met = policy.evaluate_all({"monitoring_reporting_window": [
        {"device_id": "dev-1", "name": "PC-1", "last_seen": _iso(hours=2), "window_hours": 24},
    ]}, now=NOW)
    assert _by_id(met)["monitoring_reporting_window"]["state"] == "met"

    empty = policy.evaluate_all({"monitoring_reporting_window": []}, now=NOW)
    assert _by_id(empty)["monitoring_reporting_window"]["state"] == "not_measured"


# ============== SERVICE GAP ==============


def test_service_gap_matches_only_explicit_stable_service_keys():
    report = service_gap.reconcile(
        contracted=[{"client_id": "acme", "service_id": "backup", "quantity": 15}],
        provisioned=[{"client_id": "acme", "service_id": "backup", "quantity": 14}],
        billed=[{"client_id": "acme", "service_id": "backup", "quantity": 15}],
    )
    assert report["findings"][0]["state"] == "under_delivery"
    assert report["summary"]["under_delivery"] == 1
    assert "billing mutation" in report["boundary"]


def test_service_gap_discloses_missing_evidence_and_never_matches_names():
    report = service_gap.reconcile(
        contracted=[{"client_id": "acme", "name": "Managed Backup", "quantity": 15}],
        provisioned=[{"client_id": "acme", "service_key": "backup", "quantity": 15}],
        billed=[],
    )
    assert report["summary"]["services_evaluated"] == 1
    assert report["findings"][0]["state"] == "unverified_delivery"
    assert report["summary"]["unmapped_records"] == 1


def test_service_gap_can_report_more_than_one_discrepancy_for_a_service():
    report = service_gap.reconcile(
        contracted=[{"client_id": "acme", "product_id": "m365", "quantity": 48}],
        provisioned=[{"client_id": "acme", "product_id": "m365", "quantity": 46}],
        billed=[{"client_id": "acme", "product_id": "m365", "quantity": 45}],
    )
    kinds = {gap["kind"] for gap in report["findings"][0]["gaps"]}
    assert kinds == {"under_delivery", "under_billing"}


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
        backup_jobs=_Collection([
            {"id": "wl-1", "client_id": "acme", "rpo_hours": 24,
             "last_verified_recovery_at": _recent(hours=3)},
        ]),
        web_sites=_Collection([
            {"id": "site-1", "client_id": "acme", "priority": "critical",
             "enquiry_form_state": "verified"},
        ]),
        nexus_agents=_Collection([
            {"device_id": "dev-1", "client_id": "acme", "name": "PC-1", "last_seen": _recent(hours=2)},
        ]),
        contracts=_Collection([{"id": "contract-1", "client_id": "acme", "status": "active"}]),
        line_items=_Collection([{"id": "line-1", "contract_id": "contract-1", "client_id": "acme", "service_id": "backup", "quantity": 15}]),
        core_services=_Collection([{"id": "service-1", "client_id": "acme", "service_id": "backup", "quantity": 14}]),
        recurring_invoices=_Collection([{"id": "ri-1", "client_id": "acme", "status": "active", "line_items": [{"service_id": "backup", "quantity": 15}]}]),
        scope_denials=_Collection(),
    )
    monkeypatch.setattr(routes, "db", fake)
    # The scope guard writes its denial evidence through its own module-level db,
    # so patch that too — the tests must not touch a real collection.
    monkeypatch.setattr(scope_permissions, "db", fake)
    return fake


def test_assurance_endpoints_are_mounted_behind_authentication():
    for method, path, handler in (
        ("GET", "/api/operations-assurance/contract", routes.assurance_contract),
        ("GET", "/api/operations-assurance/commitments", routes.assurance_commitments),
        ("GET", "/api/operations-assurance/service-gap", routes.assurance_service_gap),
    ):
        route = _mounted_operation(method, path)
        assert route is not None, f"{method} {path} is not mounted"
        assert route.endpoint is handler, f"{method} {path} is shadowed by another route"
        dependency_calls = [dep.call for dep in route.dependant.dependencies]
        assert get_current_user in dependency_calls, f"{method} {path} is not auth-guarded"


def test_contract_lists_every_promise_and_the_governed_states():
    contract = asyncio.run(routes.assurance_contract(user=USER))
    assert {row["id"] for row in contract["commitments"]} == set(policy.COMMITMENT_BY_ID)
    assert set(contract["states"]) == set(policy.COMMITMENT_STATES)
    assert contract["boundary"] == policy.ASSURANCE_BOUNDARY


def test_commitments_report_evaluates_the_scoped_evidence(database):
    report = asyncio.run(routes.assurance_commitments(client_id=None, user=USER))
    assert report["client_id"] is None
    assert report["summary"]["total"] == len(policy.COMMITMENTS)
    assert report["boundary"] == policy.ASSURANCE_BOUNDARY
    rows = _by_id(report)
    assert rows["verified_recovery_point"]["state"] == "met"
    assert rows["website_enquiry_form"]["state"] == "met"
    assert rows["monitoring_reporting_window"]["state"] == "met"
    # The offboarding source does not exist yet, so the promise is disclosed as
    # unmeasured rather than evaluated against a guess.
    assert rows["departed_user_access_revoked"]["state"] == "not_measured"


def test_a_restricted_technician_cannot_evaluate_another_customers_assurance(database):
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(routes.assurance_commitments(client_id="other-client", user=RESTRICTED))
    assert excinfo.value.status_code == 403
    assert database.scope_denials.rows, "a refused scope check must leave a denial record"


def test_service_gap_is_scoped_and_read_only(database):
    report = asyncio.run(routes.assurance_service_gap(client_id="acme", user=RESTRICTED))
    assert report["client_id"] == "acme"
    assert report["summary"]["under_delivery"] == 1
    assert database.line_items.rows[0]["quantity"] == 15
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(routes.assurance_service_gap(client_id="other-client", user=RESTRICTED))
    assert excinfo.value.status_code == 403
