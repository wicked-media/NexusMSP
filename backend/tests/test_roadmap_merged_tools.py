"""Merged roadmap-tool policy and boundary tests.

The four next roadmap features ship as tools inside existing workspaces:
Nexus Access (Nexus Elevate), lifecycle rings (Application Manager), standards
as code (Expected State) and the pre-rollout bench (Proving Ground). These
tests pin the shared policy — credential-material refusal, rotation
scheduling, staged rollout gates, revision impact and bench verdicts — plus
each tool's router boundary.
"""

import asyncio
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.routers import application_manager, expected_state, nexus_access, nexus_proving_ground
from app.routers.expected_state import (
    ImpactPayload,
    StandardControl,
    StandardCreatePayload,
    StandardRevisionPayload,
    StagedRemediationPayload,
)
from app.routers.nexus_access import RotationBoundaryIn, RotationRecordIn
from app.routers.nexus_proving_ground import BenchCandidatePayload, BenchPromotePayload
from app.services.roadmap_tools import (
    bench_verdict,
    find_sensitive_keys,
    promotion_gate,
    revision_impact,
    rotation_schedule,
)


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

    async def count_documents(self, query):
        return sum(1 for row in self.rows if _matches(row, query))


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self._rows)


class _Db:
    """Fake database: any collection attribute resolves to a shared table."""

    def __init__(self):
        self._tables = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._tables.setdefault(name, _Rows())


class _Audit:
    """Records audit calls so tests can assert on audit evidence."""

    def __init__(self):
        self.entries = []

    async def __call__(self, user, action, entity_type, entity_id, entity_name="", details="", **kwargs):
        self.entries.append({"action": action, "entity_type": entity_type, "entity_id": entity_id})


def _user(user_id="tech-1", tenant="tenant-a"):
    return {"id": user_id, "tenant_id": tenant, "name": "Access Tech", "email": f"{user_id}@example.com", "is_admin": True}


def _request():
    return SimpleNamespace(state=SimpleNamespace(correlation_id="test-correlation"))


def _install(monkeypatch, module, db):
    monkeypatch.setattr(module, "db", db)
    audit = _Audit()
    monkeypatch.setattr(module, "log_activity", audit)
    return audit


# ── pure policy ──────────────────────────────────────────────────────────────


def test_find_sensitive_keys_flags_nested_credential_material():
    assert find_sensitive_keys({"label": "ok", "notes": "fine"}) == []
    flagged = find_sensitive_keys({"label": "ok", "API-Key": "x", "details": {"connection-string": "y"}})
    assert flagged == ["API-Key", "connection-string"]


def test_rotation_boundary_refuses_credential_material():
    with pytest.raises(ValidationError) as refused:
        RotationBoundaryIn.model_validate({
            "label": "Local admin password",
            "provider": "windows-laps",
            "interval_days": 30,
            "password": "hunter2",
        })
    assert "credential material is never accepted" in str(refused.value)

    with pytest.raises(ValidationError) as nested:
        RotationBoundaryIn.model_validate({
            "label": "Firewall admin",
            "provider": "local-admin",
            "interval_days": 30,
            "details": {"api_key": "abc"},
        })
    assert "credential material is never accepted" in str(nested.value)


def test_rotation_schedule_computes_due_and_overdue_state():
    from datetime import datetime, timedelta, timezone

    now = datetime(2026, 10, 3, tzinfo=timezone.utc)
    fresh = rotation_schedule((now - timedelta(days=10)).isoformat(), 90, now)
    assert fresh["due"] is False and fresh["days_remaining"] == 80

    due = rotation_schedule((now - timedelta(days=95)).isoformat(), 90, now)
    assert due["due"] is True and due["overdue"] is False

    overdue = rotation_schedule((now - timedelta(days=120)).isoformat(), 90, now)
    assert overdue["overdue"] is True

    never = rotation_schedule(None, 90, now)
    assert never["due"] is True and never["last_rotated_at"] is None

    with pytest.raises(ValueError):
        rotation_schedule(None, 0, now)


def test_promotion_gate_requires_earlier_verified_rings():
    rings = [{"kind": "test", "status": "verified"}, {"kind": "canary", "status": "staging"}]
    blocked = promotion_gate(rings, "pilot")
    assert blocked["allowed"] is False and "canary" in blocked["reason"]

    rings[1]["status"] = "verified"
    allowed = promotion_gate(rings, "pilot")
    assert allowed["allowed"] is True

    assert promotion_gate([], "broad")["allowed"] is False
    assert promotion_gate([], "weekend")["allowed"] is False


def test_revision_impact_reports_added_removed_changed():
    current = [{"ref": "AU-1", "requirement": "MFA on all admins"}, {"ref": "AU-2", "requirement": "Daily backups"}]
    proposed = [{"ref": "AU-1", "requirement": "MFA and number matching"}, {"ref": "AU-3", "requirement": "Quarterly restores"}]
    impact = revision_impact(current, proposed)
    assert impact["added"] == ["AU-3"]
    assert impact["removed"] == ["AU-2"]
    assert impact["changed"] == ["AU-1"]
    assert impact["impacted_controls"] == ["AU-1", "AU-2", "AU-3"]


def test_bench_verdict_is_deterministic_per_kind():
    complete = bench_verdict("package", {"name": "7-Zip", "representative_scope": "test ring", "publisher": "7-Zip", "checksum": "abc"})
    assert complete["verdict"] == "pass"

    missing = bench_verdict("script", {"name": "Cleanup", "representative_scope": "lab", "sha256": "bad", "dry_run": True})
    assert missing["verdict"] in {"fail", "needs_review"}
    assert any(check["name"] == "script fingerprint" and not check["passed"] for check in missing["checks"])

    leak = bench_verdict("connector", {"name": "Pax8", "representative_scope": "sandbox", "sandbox_tested": True, "client_secret": "x"})
    assert leak["verdict"] != "pass"
    assert any(check["name"] == "no credential material" and not check["passed"] for check in leak["checks"])

    with pytest.raises(ValueError):
        bench_verdict("malware", {"name": "x"})


# ── Nexus Access (merged into Nexus Elevate) ─────────────────────────────────


def test_rotation_boundary_and_record_flow_is_tenant_scoped(monkeypatch):
    db = _Db()
    audit = _install(monkeypatch, nexus_access, db)
    user = _user()

    created = asyncio.run(nexus_access.create_rotation_boundary(
        RotationBoundaryIn(label="Local admin password", provider="windows-laps", interval_days=90, owner="MSP security"),
        current_user=user,
    ))
    assert created["due"] is True and created["rotation_count"] == 0

    recorded = asyncio.run(nexus_access.record_rotation(
        created["id"],
        RotationRecordIn(evidence_note="Rotated through Microsoft LAPS; evidence in the client change record"),
        current_user=user,
    ))
    assert recorded["rotation_count"] == 1
    assert recorded["due"] is False

    overview = asyncio.run(nexus_access.nexus_access_overview(current_user=user))
    assert overview["boundaries_total"] == 1
    assert overview["rotations_due"] == 0
    assert {entry["action"] for entry in audit.entries} >= {
        "nexus_access.rotation_boundary_created", "nexus_access.rotation_recorded",
    }

    other_tenant = asyncio.run(nexus_access.list_rotation_boundaries(current_user=_user(tenant="tenant-b")))
    assert other_tenant["count"] == 0

    with pytest.raises(Exception) as missing:
        asyncio.run(nexus_access.record_rotation("rotb-missing", RotationRecordIn(evidence_note="x"), current_user=user))
    assert "not found" in str(missing.value).lower()


# ── Lifecycle rings (merged into Application Manager) ────────────────────────


def test_lifecycle_ring_gate_blocks_and_progresses(monkeypatch):
    db = _Db()
    _install(monkeypatch, application_manager, db)
    user = _user()

    payload = application_manager.LifecycleRingPayload(
        application_name="7-Zip", version="24.09", kind="canary", cohort="Two pilot sites",
        verification="Install verified on the ring's first device", rollback_plan="Remove package and restore prior version",
    )
    with pytest.raises(Exception) as blocked:
        asyncio.run(application_manager.create_lifecycle_ring(payload, request=_request(), current_user=user))
    assert "test ring" in str(blocked.value).lower()

    first = asyncio.run(application_manager.create_lifecycle_ring(
        application_manager.LifecycleRingPayload(
            application_name="7-Zip", version="24.09", kind="test", cohort="Lab devices",
            verification="Install verified on the ring's first device", rollback_plan="Remove package and restore prior version",
        ),
        request=_request(), current_user=user,
    ))
    assert first["ring"]["status"] == "staging"

    asyncio.run(application_manager.verify_lifecycle_ring(
        first["ring"]["id"], application_manager.RingEvidencePayload(evidence_note="Verified on lab-01 and lab-02"), request=_request(), current_user=user,
    ))
    second = asyncio.run(application_manager.create_lifecycle_ring(payload, request=_request(), current_user=user))
    assert second["ring"]["kind"] == "canary"

    rolled = asyncio.run(application_manager.rollback_lifecycle_ring(
        second["ring"]["id"], application_manager.RingEvidencePayload(evidence_note="Canary regression detected; removed"), request=_request(), current_user=user,
    ))
    assert rolled["ring"]["status"] == "rolled_back"

    listing = asyncio.run(application_manager.list_lifecycle_rings(current_user=user))
    assert listing["plans"][0]["rings"][1]["rollback_evidence"]


# ── Standards as code (merged into Expected State) ───────────────────────────


def test_standard_revisions_are_immutable_and_impact_is_calculated(monkeypatch):
    db = _Db()
    _install(monkeypatch, expected_state, db)
    user = _user()

    created = asyncio.run(expected_state.create_or_revise_standard(
        StandardCreatePayload(
            name="Baseline identity standard", description="MSP-wide identity baseline",
            controls=[StandardControl(ref="ID-1", requirement="MFA on all admins")],
        ),
        current_user=user,
    ))
    assert created["current_revision"] == 1

    revised = asyncio.run(expected_state.create_or_revise_standard(
        StandardRevisionPayload(
            standard_id=created["id"],
            controls=[StandardControl(ref="ID-1", requirement="MFA with number matching")],
            change_note="Tighten MFA after the Q3 review",
        ),
        current_user=user,
    ))
    assert revised["current_revision"] == 2

    row = db.expected_state_standards.rows[0]
    assert row["revisions"][0]["controls"][0]["requirement"] == "MFA on all admins"

    impact = asyncio.run(expected_state.standard_revision_impact(
        created["id"],
        ImpactPayload(controls=[StandardControl(ref="ID-1", requirement="MFA with number matching"), StandardControl(ref="ID-2", requirement="Entra ID only")]),
        current_user=user,
    ))
    assert impact["impact"]["added"] == ["ID-2"]

    remediation = asyncio.run(expected_state.stage_standard_remediation(
        created["id"],
        StagedRemediationPayload(title="Enable number matching", plan="Flip the tenant-wide CA policy after the change window"),
        current_user=user,
    ))
    assert remediation["status"] == "awaiting_approval"

    approved = asyncio.run(expected_state.approve_standard_remediation(
        created["id"], remediation["id"], current_user=user,
    ))
    assert approved["status"] == "approved"


# ── Pre-rollout bench (merged into Proving Ground) ───────────────────────────


def test_pre_rollout_bench_flow_and_clearance_gate(monkeypatch):
    db = _Db()
    audit = _install(monkeypatch, nexus_proving_ground, db)
    user = _user()

    passing = asyncio.run(nexus_proving_ground.create_pre_rollout_run(
        BenchCandidatePayload(
            kind="package", name="7-Zip 24.09", representative_scope="Lab ring devices",
            candidate={"publisher": "7-Zip", "checksum": "sha256:abc"},
        ),
        current_user=user,
    ))
    assert passing["verdict"] == "pass"

    failing = asyncio.run(nexus_proving_ground.create_pre_rollout_run(
        BenchCandidatePayload(
            kind="script", name="Temp cleanup", representative_scope="Lab ring devices",
            candidate={"sha256": "bad", "dry_run": True},
        ),
        current_user=user,
    ))
    assert failing["verdict"] != "pass"

    with pytest.raises(Exception) as blocked:
        asyncio.run(nexus_proving_ground.clear_pre_rollout_run(
            failing["id"], BenchPromotePayload(evidence_note="x"), current_user=user,
        ))
    assert "passing verdict" in str(blocked.value)

    cleared = asyncio.run(nexus_proving_ground.clear_pre_rollout_run(
        passing["id"], BenchPromotePayload(evidence_note="Approved for the pilot ring"), current_user=user,
    ))
    assert cleared["status"] == "cleared_for_rollout"
    assert {entry["action"] for entry in audit.entries} >= {
        "nexus_bench.pre_rollout_simulated", "nexus_bench.pre_rollout_cleared",
    }

    with pytest.raises(Exception) as refused:
        asyncio.run(nexus_proving_ground.create_pre_rollout_run(
            BenchCandidatePayload(
                kind="connector", name="Pax8 connector", representative_scope="Sandbox tenant",
                candidate={"sandbox_tested": True, "client_secret": "hunter2"},
            ),
            current_user=user,
        ))
    assert "credential material" in str(refused.value)
