"""Fleet baseline contract tests.

Batch 5 recorded one gate — ``fleet-baseline`` — as the thing blocking Windows
Studio and Endpoint Performance Studio: a baseline existed per endpoint and
nothing compared a device against the estate. These tests pin the projection
that closes it, and they are written around the three ways a comparison like
this lies:

1. **Inventing a number.** A metric nobody reported must stay ``None`` with its
   reason. Never ``0``, never ``healthy``.
2. **Grading against silence.** A cohort below the minimum measured size has no
   baseline, so a device compared against it is ``cohort_not_established``
   rather than ``within_baseline``.
3. **Telling a different story than the evidence.** Recurrence is counted from
   the same deviations the per-device view returns, so the two cannot disagree.

The scope boundary is pinned at the application level too: these endpoints read
customer device records, so the tenant partition and the client/site scope are
applied by the database query.
"""

from __future__ import annotations

import asyncio
import math
import os
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
TESTS_ROOT = Path(__file__).resolve().parent
if str(TESTS_ROOT) not in sys.path:
    sys.path.insert(0, str(TESTS_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

import server  # noqa: E402
from app.auth import get_current_user  # noqa: E402
from app.routers import fleet_baseline as router_module  # noqa: E402
from app.services import fleet_baseline as policy  # noqa: E402
from test_studio_fleet import _mounted_operation  # noqa: E402

ADMIN = {"id": "admin-1", "name": "Ada Admin", "role": "admin", "is_admin": True}
SCOPED = {
    "id": "tech-1",
    "name": "Tess Tech",
    "role": "technician",
    "is_admin": False,
    "client_scope_mode": "restricted",
    "client_scope_ids": ["client-a"],
}


def device(device_id: str, platform: str = "Windows 11 Pro", **overrides) -> dict:
    row = {
        "id": device_id,
        "client_id": "client-a",
        "name": f"Device {device_id}",
        "hostname": f"{device_id}.example.test",
        "os_platform": platform,
        "status": "online",
        "cpu_usage": 20.0,
        "memory_usage": 40.0,
        "disk_usage": 55.0,
        "self_heal": {"performance": {"band": "healthy", "score": 0.9, "samples": 12}},
    }
    row.update(overrides)
    return row


def cohort_of(size: int, platform: str = "Windows 11 Pro", **overrides) -> list[dict]:
    return [device(f"d{index}", platform, **overrides) for index in range(size)]


# ============== THE PROJECTION READS WHAT WAS OBSERVED ==============


def test_platform_is_read_from_every_field_ingest_writes():
    assert policy.normalise_platform({"os_platform": "Windows Server 2019"}) == "windows"
    assert policy.normalise_platform({"os": "Microsoft Windows 11"}) == "windows"
    assert policy.normalise_platform({"platform": "darwin"}) == "macos"
    assert policy.normalise_platform({"platform": "macOS Sonoma"}) == "macos"
    assert policy.normalise_platform({"os": "Ubuntu 22.04"}) == "linux"


def test_an_unreadable_platform_is_disclosed_rather_than_guessed():
    """A device Nexus cannot classify is grouped as unclassified, not as Windows."""
    assert policy.normalise_platform({}) == "unknown"
    assert policy.normalise_platform({"os_platform": "   "}) == "unknown"
    assert policy.normalise_platform({"platform": "FreeBSD"}) == "unknown"
    contract = policy.contract([device("d1", "FreeBSD")])
    assert [row["platform"] for row in contract["cohorts"]] == ["unknown"]


def test_a_metric_nobody_reported_is_none_with_a_reason_never_zero():
    cohort = policy.cohort_row("windows", cohort_of(6, disk_usage=None))
    disk = cohort["metrics"]["disk_usage"]
    assert disk["median"] is None
    assert disk["measured_count"] == 0
    assert disk["established"] is False
    assert disk["reason"]
    # CPU and memory were reported, so they are the baseline this cohort has.
    assert cohort["metrics"]["cpu_usage"]["median"] == 20.0
    assert cohort["baseline_established"] is True


def test_telemetry_nested_under_the_device_record_is_read():
    """Older records keep the snapshot under ``telemetry``; both shapes count."""
    device_row = device("d1", cpu_usage=None, telemetry={"cpu_usage": 10.0})
    assert policy.device_metric(device_row, "cpu_usage") == 10.0
    assert policy.device_metric(device_row, "memory_usage") == 40.0


def test_non_measurements_are_not_read_as_zero():
    for value in (None, "", "n/a", True, False, float("nan"), float("inf")):
        row = device("d1", cpu_usage=value)
        assert policy.device_metric(row, "cpu_usage") is None, value
    assert not math.isnan(0.0)


def test_the_agent_reported_band_is_read_and_unknown_stays_unknown():
    assert policy.device_band(device("d1")) == "healthy"
    assert policy.device_band(device("d2", self_heal=None)) == "unknown"
    assert policy.device_band(
        device("d3", self_heal={"performance": {"band": "made-up"}})
    ) == "unknown"
    assert policy.device_score(device("d4")) == 0.9
    assert policy.device_samples(device("d5")) == 12


# ============== A COHORT IS ONLY A BASELINE ONCE ENOUGH OF IT WAS MEASURED ====


def test_a_cohort_below_the_minimum_has_no_baseline_and_says_why():
    devices = cohort_of(policy.MINIMUM_COHORT_DEVICES - 1)
    cohort = policy.cohort_row("windows", devices)
    assert cohort["baseline_established"] is False
    assert cohort["minimum_devices"] == policy.MINIMUM_COHORT_DEVICES
    assert cohort["unestablished_reason"]
    assert str(len(devices)) in cohort["unestablished_reason"]
    assert cohort["metrics"]["cpu_usage"]["established"] is False


def test_a_small_cohort_never_grades_a_device():
    """The failure mode a percentage-threshold baseline hides: a real verdict."""
    devices = cohort_of(policy.MINIMUM_COHORT_DEVICES - 1, cpu_usage=90.0)
    devices[0] = device("d0", cpu_usage=10.0)
    cohort = policy.cohort_row("windows", devices)
    row = policy.device_deviation(devices[0], cohort)
    cpu = next(item for item in row["deviations"] if item["metric"] == "cpu_usage")
    assert cpu["verdict"] == "cohort_not_established"
    assert cpu["cohort_median"] is None
    assert cpu["delta"] is None
    assert row["verdict"] == "cohort_not_established"


def test_a_device_that_reported_nothing_is_not_measured_not_healthy():
    devices = cohort_of(6)
    devices.append(device("silent", cpu_usage=None, memory_usage=None, disk_usage=None))
    cohort = policy.cohort_row("windows", devices)
    row = policy.device_deviation(devices[-1], cohort)
    assert row["verdict"] == "not_measured"
    assert {item["metric"] for item in row["unmeasured"]} == {"cpu_usage", "memory_usage", "disk_usage"}
    assert all(item["reason"] for item in row["unmeasured"])
    assert row["deviations"] == []


def test_measured_devices_are_counted_from_what_they_reported():
    devices = cohort_of(3) + [device("silent", cpu_usage=None, memory_usage=None, disk_usage=None)]
    cohort = policy.cohort_row("windows", devices)
    assert cohort["device_count"] == 4
    assert cohort["measured_device_count"] == 3
    assert cohort["baseline_established"] is False


# ============== A DEVIATION IS A DIFFERENCE, AND IT SAYS FROM WHAT ============


def test_an_established_cohort_reports_the_median_and_the_spread_it_measured():
    devices = cohort_of(6) + [device("hot", cpu_usage=95.0), device("cold", cpu_usage=1.0)]
    cohort = policy.cohort_row("windows", devices)
    cpu = cohort["metrics"]["cpu_usage"]
    assert cpu["measured_count"] == len(devices)
    assert cpu["established"] is True
    assert cpu["reason"] is None
    assert cpu["median"] == pytest.approx(20.0, abs=1.0)
    assert cpu["spread"] is not None


def test_deviation_verdicts_follow_the_disclosed_thresholds():
    quiet = cohort_of(6, cpu_usage=20.0)
    hot = device("hot", cpu_usage=20.0 * (1 + policy.NOTABLE_DEVIATION_RATIO))
    hotter = device("hotter", cpu_usage=20.0 * (1 + policy.STRONG_DEVIATION_RATIO))
    cohort = policy.cohort_row("windows", quiet)
    for row, verdict in ((hot, "notable"), (hotter, "strong")):
        deviation = next(
            item for item in policy.device_deviation(row, cohort)["deviations"]
            if item["metric"] == "cpu_usage"
        )
        assert deviation["verdict"] == verdict
        assert deviation["cohort_median"] == 20.0
        assert deviation["delta"] == round(row["cpu_usage"] - 20.0, 2)
        assert str(cohort["metrics"]["cpu_usage"]["measured_count"]) in deviation["basis"]


def test_a_device_inside_the_band_is_within_baseline():
    cohort = policy.cohort_row("windows", cohort_of(6))
    row = policy.device_deviation(device("near", cpu_usage=21.0), cohort)
    deviation = next(item for item in row["deviations"] if item["metric"] == "cpu_usage")
    assert deviation["verdict"] == "within_baseline"


def test_the_worst_verdict_wins_over_a_clean_metric():
    devices = cohort_of(6, memory_usage=40.0)
    devices.append(device("dirty", memory_usage=95.0))
    cohort = policy.cohort_row("windows", devices)
    row = policy.device_deviation(devices[-1], cohort)
    assert row["verdict"] == "strong"
    assert row["cohort_established"] is True


def test_every_response_carries_the_boundary_that_a_deviation_is_not_a_fault():
    devices = cohort_of(6)
    for payload in (
        policy.contract(devices),
        policy.deviations(devices, "windows"),
        policy.recurrence(devices, "windows"),
    ):
        assert payload["boundary"] == policy.BOUNDARY
        assert "not a fault" in policy.BOUNDARY or "never a fault" in policy.BOUNDARY


def test_an_unreadable_metric_is_disclosed_as_unmeasured_in_the_cohort_view():
    devices = cohort_of(6) + [device("blind", disk_usage=None)]
    cohort = policy.cohort_row("windows", devices)
    assert cohort["metrics"]["disk_usage"]["measured_count"] == 6
    assert cohort["metrics"]["disk_usage"]["reason"] is None
    row = policy.device_deviation(devices[-1], cohort)
    assert [item["metric"] for item in row["unmeasured"]] == ["disk_usage"]


# ============== RECURRENCE IS COUNTED FROM THE SAME DEVIATIONS ===============


def test_recurrence_needs_a_second_endpoint_before_it_is_shared():
    """One machine's bad day is not a recurring problem."""
    devices = cohort_of(6)
    devices[0] = device("d0", cpu_usage=95.0)
    shapes = policy.recurrence(devices, "windows")["shapes"]
    assert all(shape["device_count"] >= policy.MINIMUM_RECURRING_DEVICES for shape in shapes)
    assert policy.recurrence(devices, "windows")["minimum_devices"] == policy.MINIMUM_RECURRING_DEVICES


def test_recurrence_counts_exactly_the_devices_the_deviation_view_shows():
    devices = cohort_of(6) + [device("hot1", cpu_usage=95.0), device("hot2", cpu_usage=92.0)]
    reported = policy.deviations(devices, "windows")
    recurrence = policy.recurrence(devices, "windows")
    shape = next(
        item for item in recurrence["shapes"]
        if item["metric"] == "cpu_usage" and item["direction"] == "above"
    )
    from_view = [
        row["device_id"]
        for row in reported["devices"]
        for deviation in row["deviations"]
        if deviation["metric"] == "cpu_usage"
        and deviation["verdict"] == shape["verdict"]
        and (deviation["delta"] or 0) > 0
    ]
    assert sorted(shape["device_ids"]) == sorted(from_view)
    assert shape["device_count"] == len(from_view)
    assert shape["cohort_median"] == reported["cohort"]["metrics"]["cpu_usage"]["median"]
    assert shape["basis"]


def test_a_shape_never_claims_more_endpoints_than_the_metric_measured():
    devices = cohort_of(6) + [device("hot1", cpu_usage=95.0, memory_usage=None), device("hot2", cpu_usage=92.0, memory_usage=None)]
    recurrence = policy.recurrence(devices, "windows")
    measured = recurrence["cohort"]["metrics"]["cpu_usage"]["measured_count"]
    for shape in recurrence["shapes"]:
        assert shape["device_count"] <= measured


def test_no_baseline_means_no_shapes_and_the_reason_is_returned():
    devices = cohort_of(policy.MINIMUM_COHORT_DEVICES - 2)
    recurrence = policy.recurrence(devices, "windows")
    assert recurrence["shapes"] == []
    assert recurrence["cohort"]["baseline_established"] is False


def test_an_unknown_platform_is_disclosed_not_returned_as_healthy():
    payload = policy.deviations(cohort_of(6), "solaris")
    assert payload["cohort"] is None
    assert payload["devices"] == []
    assert payload["note"]
    assert policy.recurrence(cohort_of(6), "solaris")["shapes"] == []


def test_cohorts_are_ordered_with_the_one_that_can_speak_first():
    devices = cohort_of(6) + [device("l1", "Ubuntu 22.04"), device("l2", "Ubuntu 22.04")]
    rows = policy.cohorts(devices)
    assert [row["platform"] for row in rows][0] == "windows"
    assert {row["platform"] for row in rows} == {"windows", "linux"}


def test_the_read_is_bounded():
    contract = policy.contract(cohort_of(policy.MAX_DEVICES + 10))
    assert contract["device_count"] == policy.MAX_DEVICES


# ============== THE CONTRACT DISCLOSES WHAT A VERDICT MEANS ==================


def test_the_contract_discloses_every_number_a_verdict_uses():
    contract = policy.contract(cohort_of(6))
    assert [metric["key"] for metric in contract["metrics"]] == [
        key for key, _label, _unit in policy.METRICS
    ]
    assert contract["minimum_cohort_devices"] == policy.MINIMUM_COHORT_DEVICES
    assert contract["minimum_recurring_devices"] == policy.MINIMUM_RECURRING_DEVICES
    assert contract["strong_deviation_ratio"] == policy.STRONG_DEVIATION_RATIO
    assert contract["notable_deviation_ratio"] == policy.NOTABLE_DEVIATION_RATIO
    assert contract["note"] == policy.COHORT_NOTE
    assert contract["boundary"] == policy.BOUNDARY


def test_the_projection_carries_no_secret_and_no_free_text_credential():
    import json

    dumped = json.dumps(policy.contract(cohort_of(6))).lower()
    for needle in ("password", "token", "api_key", "secret"):
        assert needle not in dumped


# ============== THE SCOPE BOUNDARY IS THE DATABASE QUERY =====================


class _FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, limit):
        return self.rows[:limit]


class _FakeCollection:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.queries = []
        self.projection = None

    def find(self, query, projection):
        self.queries.append(query)
        self.projection = projection
        return _FakeCursor(self.rows)


def _clauses(query: dict) -> list[dict]:
    """The tenant partition and the client scope, however they were combined."""
    return query.get("$and", [query]) if isinstance(query, dict) else []


def _client_clause(query: dict) -> dict | None:
    for clause in _clauses(query):
        if "client_id" in clause:
            return clause
    return None


def test_an_administrator_reads_every_client_and_a_technician_does_not(monkeypatch):
    collection = _FakeCollection(cohort_of(1))
    monkeypatch.setattr(router_module.db, "devices", collection)

    asyncio.run(router_module._scoped_devices(ADMIN))
    assert _client_clause(collection.queries[-1]) is None, collection.queries[-1]

    asyncio.run(router_module._scoped_devices(SCOPED))
    clause = _client_clause(collection.queries[-1])
    assert clause and clause["client_id"]["$in"] == ["client-a"], collection.queries[-1]


def test_an_unassigned_technician_is_scoped_to_nothing(monkeypatch):
    """Fail closed: an unassigned scope reads no client, not every client."""
    collection = _FakeCollection(cohort_of(1))
    monkeypatch.setattr(router_module.db, "devices", collection)
    asyncio.run(router_module._scoped_devices({"id": "t2", "role": "technician"}))
    clause = _client_clause(collection.queries[-1])
    assert clause and clause["client_id"]["$in"] == []


def test_a_tenant_bound_actor_is_partitioned_by_tenant(monkeypatch):
    collection = _FakeCollection(cohort_of(1))
    monkeypatch.setattr(router_module.db, "devices", collection)
    asyncio.run(router_module._scoped_devices({**ADMIN, "tenant_id": "tenant-7"}))
    assert {"tenant_id": "tenant-7"} in _clauses(collection.queries[-1]), (
        collection.queries[-1]
    )


def test_the_local_partition_is_a_boundary_like_any_other(monkeypatch):
    """Legacy unmarked records stay readable, and only in the local partition."""
    collection = _FakeCollection(cohort_of(1))
    monkeypatch.setattr(router_module.db, "devices", collection)
    asyncio.run(router_module._scoped_devices(ADMIN))
    partitions = [clause for clause in _clauses(collection.queries[-1]) if "$or" in clause]
    assert partitions, collection.queries[-1]


def test_the_read_is_projected_so_a_cohort_cannot_pull_a_full_inventory(monkeypatch):
    collection = _FakeCollection(cohort_of(1))
    monkeypatch.setattr(router_module.db, "devices", collection)
    asyncio.run(router_module._scoped_devices(ADMIN))
    fields = set(collection.projection or {})
    assert {"id", "client_id", "os_platform", "cpu_usage", "self_heal"} <= fields
    assert not {"installed_software", "software", "disks", "network"} & fields


def test_the_read_is_bounded_by_the_projection_limit(monkeypatch):
    collection = _FakeCollection(cohort_of(3))
    monkeypatch.setattr(router_module.db, "devices", collection)
    rows = asyncio.run(router_module._scoped_devices(ADMIN))
    assert len(rows) == 3


# ============== THE ROUTER, END TO END ======================================


def test_the_endpoints_serve_the_projection(monkeypatch):
    devices = cohort_of(6) + [device("hot", cpu_usage=95.0)]

    async def fake_devices(current_user):
        return devices

    monkeypatch.setattr(router_module, "_scoped_devices", fake_devices)
    contract = asyncio.run(router_module.get_baseline_contract(current_user=ADMIN))
    assert contract["cohorts"][0]["platform"] == "windows"
    reported = asyncio.run(
        router_module.get_cohort_deviations(platform="windows", current_user=ADMIN)
    )
    assert [row["device_id"] for row in reported["devices"]][0] == "hot"
    recurrence = asyncio.run(
        router_module.get_cohort_recurrence(platform="windows", current_user=ADMIN)
    )
    assert recurrence["cohort"]["platform"] == "windows"
    assert recurrence["shapes"] == []


def test_a_cohort_that_does_not_exist_is_disclosed(monkeypatch):
    async def fake_devices(current_user):
        return cohort_of(6)

    monkeypatch.setattr(router_module, "_scoped_devices", fake_devices)
    payload = asyncio.run(
        router_module.get_cohort_deviations(platform="solaris", current_user=ADMIN)
    )
    assert payload["cohort"] is None
    assert payload["note"]


def test_the_routes_are_mounted_on_the_application_behind_authentication():
    """Handler tests bypass FastAPI; pin the boundary the request actually crosses."""
    for method, path, handler in (
        ("GET", "/api/fleet-baseline/contract", router_module.get_baseline_contract),
        (
            "GET",
            "/api/fleet-baseline/cohorts/windows/deviations",
            router_module.get_cohort_deviations,
        ),
        (
            "GET",
            "/api/fleet-baseline/cohorts/windows/recurrence",
            router_module.get_cohort_recurrence,
        ),
    ):
        route = _mounted_operation(method, path)
        assert route is not None, f"{method} {path} is not mounted"
        assert route.endpoint is handler, f"{method} {path} is served by another handler"
        dependency_calls = [dep.call for dep in route.dependant.dependencies]
        assert get_current_user in dependency_calls, f"{method} {path} is not auth-guarded"


def test_the_studio_tabs_point_at_the_endpoints_this_router_mounts():
    """A wired tab's claimed endpoint must be a route this application answers.

    The path is built from the tab's own registry declaration — endpoint plus the
    ``params`` it bound — so a placeholder the registry never bound fails here
    instead of resolving to a path no route serves, which is what the literal
    ``{platform}`` used to do.
    """
    from app.services import studio_registry

    checked = 0
    for studio_id in ("windows", "endpoint-performance"):
        studio = studio_registry.STUDIOS[studio_id]
        for tab_id, spec in studio["tabs"].items():
            if spec["state"] != "wired" or "endpoint" not in spec:
                continue
            path = spec["endpoint"]
            for key, value in (spec.get("params") or {}).items():
                path = path.replace("{" + key + "}", value)
            assert "{" not in path, f"{studio_id}.{tab_id}: {path} still carries a placeholder"
            path = "/api" + path
            route = _mounted_operation("GET", path)
            assert route is not None, f"{studio_id}.{tab_id}: {path} is not mounted"
            assert route.endpoint.__module__ == router_module.__name__, (
                f"{studio_id}.{tab_id}: {path} is served by another router"
            )
            checked += 1
    assert checked >= 4, "expected both studios to wire their inventory and diagnostics tabs"


def test_each_studio_diagnostics_tab_names_the_cohort_it_grades_against():
    """The cohort is a registry decision, disclosed, never whichever one is largest."""
    from app.services import studio_registry

    for studio_id in ("windows", "endpoint-performance"):
        spec = studio_registry.STUDIOS[studio_id]["tabs"]["diagnostics"]
        assert spec["state"] == "wired"
        assert spec["params"] == {"platform": "windows"}
        assert spec["endpoint"].startswith("/fleet-baseline/cohorts/{platform}/")


def test_the_two_studios_are_admitted_and_out_of_the_plan():
    """The gate is cleared: served in the register, registered as studios."""
    from app.services import studio_proposals, studio_registry

    for studio_id in ("windows", "endpoint-performance"):
        assert studio_id in studio_registry.STUDIOS
        studio = studio_registry.STUDIOS[studio_id]
        assert studio["status"] == "Partially implemented"
        assert studio["product"] == "nexus-endpoint"
        assert studio["admission"]["state"] == "complete"
        proposal = studio_proposals.PROPOSALS[studio_id]
        assert proposal["disposition"] == "served"
        assert not proposal["gates"]
    gate = studio_proposals.GATES["fleet-baseline"]
    assert gate["cleared_by"] == "backend/app/services/fleet_baseline.py"
    assert gate["cleared_note"]
    planned = [
        idea
        for product in studio_registry.product_catalogue()
        for idea in product["planned_studios"]
    ]
    assert "windows" not in planned and "endpoint-performance" not in planned


# ============== A SHAPE AS PROPOSED WORK ===================================
#
# The studios explain the estate. These tests pin the boundary where an
# explanation becomes a change *request*, and the three refusals that keep it
# honest: a shape the recurrence view does not report raises nothing, a cohort
# without a baseline raises nothing, and a shape that already has an open change
# is not raised twice.


class _DenialSink:
    """Stand-in for the scope guard's own collection.

    The guard writes denial evidence through its module-level ``db``, so the
    tests must not touch a real collection.
    """

    def __init__(self):
        self.inserted = []

    async def insert_one(self, document):
        self.inserted.append(document)


class _DenialDb:
    def __init__(self):
        self.scope_denials = _DenialSink()


def deviating_cohort():
    """Eight endpoints, two of which share a strong deviation in CPU."""
    return cohort_of(6) + [device("hot-1", cpu_usage=36.0), device("hot-2", cpu_usage=36.0)]


def only_shape(report):
    assert len(report["shapes"]) == 1, report["shapes"]
    return report["shapes"][0]


def test_the_raised_change_cites_the_shape_it_came_from():
    """Derived, not invented: every claim in the request is the shape's own."""
    from app.services import fleet_change_proposal as proposals

    report = policy.recurrence(deviating_cohort(), "windows")
    shape = only_shape(report)
    decision = proposals.proposal(report, shape["id"])

    assert decision["proposed"] is True
    change = decision["change"]
    assert change["source"]["shape_id"] == shape["id"]
    assert change["source"]["basis"] == shape["basis"]
    assert change["source"]["evidence"] == proposals.EVIDENCE_SOURCE
    assert change["devices_affected"] == shape["device_ids"]
    assert str(shape["device_count"]) in change["title"]
    assert shape["basis"] in change["description"]


def test_the_raised_change_carries_verification_and_rollback():
    """Change Management refuses medium/high risk without a rollback plan, and a
    derived request must say how the repair would be *proved*, not just asked for."""
    from app.services import fleet_change_proposal as proposals

    report = policy.recurrence(deviating_cohort(), "windows")
    change = proposals.proposal(report, only_shape(report)["id"])["change"]

    assert change["category"] == "normal"
    assert change["risk_level"] == "high"
    assert "deviations" in change["verification"]
    assert "executed nothing" in change["rollback_plan"]
    # The thresholds in the request come from the projection, not from a copy.
    assert f"{int(policy.STRONG_DEVIATION_RATIO * 100)}%" in change["impact"]
    assert len(change["impact"]) >= 8 and len(change["description"]) >= 12


def test_a_notable_shape_is_a_lower_risk_request_than_a_strong_one():
    from app.services import fleet_change_proposal as proposals

    report = policy.recurrence(deviating_cohort(), "windows")
    shape = only_shape(report)
    assert proposals.risk_level(shape) == "high"
    assert proposals.risk_level({**shape, "verdict": "notable"}) == "medium"


def test_a_shape_the_recurrence_view_does_not_report_raises_nothing():
    """A proposal may only cite evidence the studio can already show."""
    from app.services import fleet_change_proposal as proposals

    report = policy.recurrence(deviating_cohort(), "windows")
    decision = proposals.proposal(report, "windows|memory_usage|above|strong")
    assert decision["proposed"] is False
    assert decision["reason"] == "shape_not_reported"
    assert "change" not in decision


def test_a_cohort_without_a_baseline_raises_nothing():
    from app.services import fleet_change_proposal as proposals

    report = policy.recurrence(deviating_cohort(), "solaris")
    assert report["cohort"] is None
    decision = proposals.proposal(report, "windows|cpu_usage|above|strong")
    assert decision["proposed"] is False
    assert decision["reason"] == "cohort_not_established"


def test_one_shape_keeps_one_open_piece_of_work():
    from app.services import fleet_change_proposal as proposals

    report = policy.recurrence(deviating_cohort(), "windows")
    shape = only_shape(report)
    existing = {
        "id": "CHG-ABC123",
        "status": "pending_review",
        "source": {"kind": proposals.SOURCE_KIND, "shape_id": shape["id"]},
    }
    decision = proposals.proposal(report, shape["id"], open_changes=[existing])
    assert decision["proposed"] is False
    assert decision["reason"] == "already_open"
    assert decision["existing_change_id"] == "CHG-ABC123"

    # A change that is no longer open does not block the shape for ever, and a
    # change raised from a different shape is not this shape's duplicate.
    for status in ("completed", "rollback", "rejected"):
        closed = {**existing, "status": status}
        assert proposals.proposal(report, shape["id"], open_changes=[closed])["proposed"] is True
    other = {**existing, "source": {"kind": proposals.SOURCE_KIND, "shape_id": "linux|cpu_usage|below|notable"}}
    assert proposals.proposal(report, shape["id"], open_changes=[other])["proposed"] is True


def test_the_preview_discloses_the_same_refusals_as_the_write():
    """A surface can show what would happen before asking Nexus to do it."""
    from app.services import fleet_change_proposal as proposals

    report = policy.recurrence(deviating_cohort(), "windows")
    shape = only_shape(report)
    open_shape = {
        "id": "CHG-OPEN01",
        "status": "approved",
        "source": {"kind": proposals.SOURCE_KIND, "shape_id": shape["id"]},
    }
    preview = proposals.previews(report, open_changes=[open_shape])

    assert preview["cohort"]["platform"] == "windows"
    assert preview["proposable_count"] == 0
    assert preview["open_change_count"] == 1
    assert preview["shapes"][0]["reason"] == "already_open"
    assert preview["shapes"][0]["existing_change_id"] == "CHG-OPEN01"
    assert preview["boundary"]

    fresh = proposals.previews(report)
    assert fresh["proposable_count"] == 1
    assert fresh["shapes"][0]["change"]["source"]["shape_id"] == shape["id"]
    # A cohort with no baseline produces no shape rows at all.
    empty = proposals.previews(policy.recurrence(deviating_cohort(), "solaris"))
    assert empty["shapes"] == [] and empty["cohort"] is None


def test_the_proposal_endpoints_are_mounted_behind_authentication_and_a_permission():
    """One read, one governed write, both pinned at the boundary a request crosses."""
    from app.services.action_permissions import ACTION_PERMISSION_BY_ID

    assert router_module.PROPOSE_PERMISSION in ACTION_PERMISSION_BY_ID

    read_route = _mounted_operation("GET", "/api/fleet-baseline/cohorts/windows/proposed-changes")
    assert read_route is not None
    assert read_route.endpoint is router_module.get_shape_proposals
    assert get_current_user in [dep.call for dep in read_route.dependant.dependencies]

    write_route = _mounted_operation("POST", "/api/fleet-baseline/cohorts/windows/proposed-changes")
    assert write_route is not None
    assert write_route.endpoint is router_module.propose_change_from_shape
    # ``require_action`` wraps ``get_current_user``, so the permission gate shows
    # up as a dependency rather than as ``get_current_user`` itself.
    assert write_route.dependant.dependencies, "raising a change is not permission-gated"


def test_both_studios_wire_the_tab_that_raises_the_change():
    """The tabs the studios disclosed as unbuilt are now wired to this surface."""
    from app.services import studio_registry

    for studio_id, tab_id in (("windows", "automation"), ("endpoint-performance", "changes")):
        spec = studio_registry.STUDIOS[studio_id]["tabs"][tab_id]
        assert spec["state"] == "wired", f"{studio_id}.{tab_id} is not wired"
        assert spec["endpoint"] == "/fleet-baseline/cohorts/{platform}/proposed-changes"
        assert spec["params"] == {"platform": "windows"}
        assert list(spec["subjects"]) == ["endpoint.deviation.change.proposed"]


def test_raising_a_shape_creates_the_change_through_its_owner(monkeypatch):
    """Nexus executes nothing: exactly one change record, created by Change Management."""
    from types import SimpleNamespace

    devices = deviating_cohort()
    captured: dict = {}

    async def fake_devices(current_user):
        return devices

    async def no_open_changes(current_user):
        return []

    async def fake_create_request(*, payload, user):
        captured["payload"] = payload
        captured["user"] = user
        return {"id": "CHG-TEST01", **payload}

    async def fake_event(**kwargs):
        captured["event"] = kwargs
        return {"id": "evt-1"}

    monkeypatch.setattr(router_module, "_scoped_devices", fake_devices)
    monkeypatch.setattr(router_module, "_open_proposals", no_open_changes)
    monkeypatch.setattr(router_module, "create_change_request", fake_create_request)
    monkeypatch.setattr(router_module, "emit_platform_event", fake_event)

    shape = only_shape(policy.recurrence(devices, "windows"))
    request = SimpleNamespace(state=SimpleNamespace(correlation_id="corr-test"), headers={})
    result = asyncio.run(
        router_module.propose_change_from_shape(
            request=request,
            platform="windows",
            payload={"shape_id": shape["id"]},
            current_user=ADMIN,
        )
    )

    assert result["created"] is True
    assert result["change"]["id"] == "CHG-TEST01"
    assert result["event_persist_error"] is None
    assert captured["user"] is ADMIN
    # The request the change owner is asked to persist is the derived one.
    assert captured["payload"]["source"]["shape_id"] == shape["id"]
    assert captured["payload"]["verification"]
    assert captured["payload"]["rollback_plan"]
    assert captured["event"]["subject"] == "endpoint.deviation.change.proposed"
    assert captured["event"]["payload"]["change_id"] == "CHG-TEST01"
    assert captured["event"]["correlation_id"] == "corr-test"


def test_a_failed_event_does_not_hide_the_change_that_was_created(monkeypatch):
    devices = deviating_cohort()

    async def fake_devices(current_user):
        return devices

    async def no_open_changes(current_user):
        return []

    async def fake_create_request(*, payload, user):
        return {"id": "CHG-TEST02", **payload}

    async def exploding_event(**kwargs):
        raise RuntimeError("event backbone unavailable")

    monkeypatch.setattr(router_module, "_scoped_devices", fake_devices)
    monkeypatch.setattr(router_module, "_open_proposals", no_open_changes)
    monkeypatch.setattr(router_module, "create_change_request", fake_create_request)
    monkeypatch.setattr(router_module, "emit_platform_event", exploding_event)

    from types import SimpleNamespace

    shape = only_shape(policy.recurrence(devices, "windows"))
    request = SimpleNamespace(state=SimpleNamespace(correlation_id="corr-test"), headers={})
    result = asyncio.run(
        router_module.propose_change_from_shape(
            request=request,
            platform="windows",
            payload={"shape_id": shape["id"]},
            current_user=ADMIN,
        )
    )
    assert result["created"] is True
    assert "event backbone unavailable" in result["event_persist_error"]


def test_the_write_refuses_what_the_policy_refuses(monkeypatch):
    from types import SimpleNamespace

    from fastapi import HTTPException

    devices = deviating_cohort()

    async def fake_devices(current_user):
        return devices

    open_shape = {
        "id": "CHG-OPEN02",
        "status": "implementing",
        "source": {"kind": "fleet_baseline_shape", "shape_id": ""},
    }

    async def open_changes(current_user):
        return [open_shape]

    monkeypatch.setattr(router_module, "_scoped_devices", fake_devices)
    monkeypatch.setattr(router_module, "_open_proposals", open_changes)

    shape = only_shape(policy.recurrence(devices, "windows"))
    open_shape["source"]["shape_id"] = shape["id"]
    request = SimpleNamespace(state=SimpleNamespace(correlation_id="corr-test"), headers={})

    with pytest.raises(HTTPException) as duplicate:
        asyncio.run(
            router_module.propose_change_from_shape(
                request=request,
                platform="windows",
                payload={"shape_id": shape["id"]},
                current_user=ADMIN,
            )
        )
    assert duplicate.value.status_code == 409
    assert "CHG-OPEN02" in duplicate.value.detail

    with pytest.raises(HTTPException) as unreported:
        asyncio.run(
            router_module.propose_change_from_shape(
                request=request,
                platform="windows",
                payload={"shape_id": "windows|memory_usage|above|strong"},
                current_user=ADMIN,
            )
        )
    assert unreported.value.status_code == 400


@pytest.mark.parametrize("platform", ["solaris"])
def test_a_cohort_with_no_endpoint_in_scope_is_refused_rather_than_swallowed(monkeypatch, platform):
    """The refusal is disclosed with its reason, and nothing is created."""
    from types import SimpleNamespace

    from fastapi import HTTPException

    async def fake_devices(current_user):
        return deviating_cohort()

    async def no_open_changes(current_user):
        return []

    async def must_not_create(*, payload, user):  # pragma: no cover - asserted
        raise AssertionError("no change may be created for a cohort with no baseline")

    monkeypatch.setattr(router_module, "_scoped_devices", fake_devices)
    monkeypatch.setattr(router_module, "_open_proposals", no_open_changes)
    monkeypatch.setattr(router_module, "create_change_request", must_not_create)

    request = SimpleNamespace(state=SimpleNamespace(correlation_id="corr-test"), headers={})
    with pytest.raises(HTTPException) as refused:
        asyncio.run(
            router_module.propose_change_from_shape(
                request=request,
                platform=platform,
                payload={"shape_id": "windows|cpu_usage|above|strong"},
                current_user=ADMIN,
            )
        )
    assert refused.value.status_code == 400
    assert refused.value.detail


class _CapturingCollection:
    def __init__(self):
        self.inserted = []

    async def insert_one(self, document):
        self.inserted.append(document)


class _ChangeDb:
    def __init__(self):
        self.change_requests = _CapturingCollection()
        self.audit_logs = _CapturingCollection()


def test_the_derived_request_is_accepted_by_the_change_management_owner(monkeypatch):
    """The proposal is only real if the owner's own validation accepts it.

    ``create_change_request`` enforces the title, description, impact and rollback
    rules and persists the two fields a derived request adds, so the boundary is
    exercised against that owner rather than against a stub of it — a derived
    payload that failed its rules would 400 on the one request that matters.
    """
    from app.routers import change_management
    from app.services import fleet_change_proposal as proposals

    fake = _ChangeDb()
    monkeypatch.setattr(change_management, "db", fake)

    report = policy.recurrence(deviating_cohort(), "windows")
    shape = only_shape(report)
    payload = proposals.proposal(report, shape["id"])["change"]
    document = asyncio.run(change_management.create_change_request(payload=payload, user=ADMIN))

    assert document["status"] == "pending_review"
    assert document["requested_by_id"] == ADMIN["id"]
    assert document["source"]["shape_id"] == shape["id"]
    assert document["verification"]
    assert document["rollback_plan"]
    # The technician who raised it is recorded as its author, so the owner's own
    # independent-approver rule keeps them from approving their own request.
    stored = fake.change_requests.inserted[0]
    assert stored["source"]["kind"] == "fleet_baseline_shape"
    assert stored["source"]["basis"] == shape["basis"]
    assert stored["risk_level"] == "high"
    assert stored["devices_affected"] == shape["device_ids"]
    assert fake.audit_logs.inserted, "the change owner must write audit evidence"


def test_a_client_scoped_technician_cannot_raise_an_estate_wide_change(monkeypatch):
    """A cohort spans clients, so raising work from one needs a global scope."""
    from types import SimpleNamespace

    from fastapi import HTTPException

    from app.services import scope_permissions

    async def fake_devices(current_user):  # pragma: no cover - the guard runs first
        raise AssertionError("scope must be checked before the estate is read")

    monkeypatch.setattr(router_module, "_scoped_devices", fake_devices)
    monkeypatch.setattr(scope_permissions, "db", _DenialDb())

    request = SimpleNamespace(state=SimpleNamespace(correlation_id="corr-test"), headers={})
    with pytest.raises(HTTPException) as refused:
        asyncio.run(
            router_module.propose_change_from_shape(
                request=request,
                platform="windows",
                payload={"shape_id": "windows|cpu_usage|above|strong"},
                current_user=SCOPED,
            )
        )
    assert refused.value.status_code in {403, 404}
