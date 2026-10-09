"""Nexus Flow Intelligence policy and boundary tests.

Flow Intelligence ships Friction Radar (aggregate friction opportunities from
usage counters the workspaces already hold), the ticket Outcome Contract, and
Breadcrumb Rescue. These tests pin the pure policy — friction estimates that are
never invented, method-vs-outcome enforcement, verification and close-out gates,
and investigation staleness — plus each tool's tenant boundary.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.routers import nexus_flow
from app.routers.nexus_flow import (
    BreadcrumbPayload,
    FrictionProposalPayload,
    FrictionReviewPayload,
    OutcomeContractPayload,
    OutcomeVerificationPayload,
)
from app.services.nexus_flow import (
    MIN_ESTIMATE_WINDOW_DAYS,
    breadcrumb_resume,
    closeout_gate,
    contract_status,
    friction_estimate,
    friction_opportunities,
    friction_window_days,
    outcome_is_method,
    verification_verdict,
)

NOW = datetime(2026, 10, 8, 9, 0, tzinfo=timezone.utc)


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
    def __init__(self):
        self.entries = []

    async def __call__(self, user, action, entity_type, entity_id, entity_name="", details="", **kwargs):
        self.entries.append({"action": action, "entity_type": entity_type, "entity_id": entity_id})


def _user(user_id="tech-1", tenant="tenant-a", client_ids=None):
    user = {
        "id": user_id,
        "tenant_id": tenant,
        "name": "Flow Tech",
        "email": f"{user_id}@example.com",
        "is_admin": client_ids is None,
    }
    if client_ids is not None:
        # A restricted technician has an explicit scope; the server-side check
        # must never fall back to "all" for them.
        user["client_scope_mode"] = "restricted"
        user["client_scope_ids"] = list(client_ids)
    return user


def _install(monkeypatch, db):
    monkeypatch.setattr(nexus_flow, "db", db)
    audit = _Audit()
    monkeypatch.setattr(nexus_flow, "log_activity", audit)
    return audit


def _ticket(db, ticket_id="tkt-1", client_id="cli-1", tenant="tenant-a"):
    db.tickets.rows.append(
        {"id": ticket_id, "tenant_id": tenant, "client_id": client_id, "ticket_number": "TKT-001", "device_id": "dev-1"}
    )
    return ticket_id


# ── pure policy: Friction Radar ──────────────────────────────────────────────


def test_friction_estimate_is_never_invented_without_a_usable_window():
    short = friction_estimate(40, MIN_ESTIMATE_WINDOW_DAYS - 1)
    assert short["estimate_available"] is False
    assert short["estimated_monthly_hours"] is None
    assert "fewer than" in short["estimate_reason"]

    none = friction_estimate(0, 30)
    assert none["estimate_available"] is False

    usable = friction_estimate(90, 30)
    assert usable["estimate_available"] is True
    assert usable["estimated_monthly_repeats"] == 90
    assert usable["estimated_monthly_hours"] == 0.2


def test_friction_window_days_needs_at_least_two_observations():
    assert friction_window_days([]) is None
    assert friction_window_days([{"last_used_at": "2026-10-01T00:00:00+00:00"}]) is None
    rows = [
        {"last_used_at": "2026-09-01T00:00:00+00:00"},
        {"last_used_at": "2026-10-01T00:00:00+00:00"},
    ]
    assert friction_window_days(rows) == 30


def _usage_row(workspace, target, count, last_used_at):
    return {"workspace": workspace, "target": target, "count": count, "last_used_at": last_used_at}


def test_friction_detects_cross_workspace_navigation_and_concentration():
    rows = [
        # Same concept reached from two workspaces with enough repeats.
        _usage_row("client", "billing", 40, "2026-09-01T00:00:00+00:00"),
        _usage_row("invoices", "billing", 35, "2026-10-01T00:00:00+00:00"),
        # One screen carrying most of a workspace's repeats.
        _usage_row("tickets", "remote", 60, "2026-09-15T00:00:00+00:00"),
        _usage_row("tickets", "notes", 10, "2026-10-01T00:00:00+00:00"),
        # Below the evidence floor: a habit, not friction.
        _usage_row("devices", "patches", 4, "2026-10-01T00:00:00+00:00"),
    ]
    opportunities = friction_opportunities(rows, min_repeats=12)
    by_id = {item["id"]: item for item in opportunities}

    navigation = by_id["repeated_navigation:-:billing"]
    assert navigation["workspaces"] == ["client", "invoices"]
    assert navigation["observed_repeats"] == 75
    assert navigation["estimate_available"] is True

    concentrated = by_id["concentrated_usage:tickets:remote"]
    assert concentrated["share_of_workspace"] == 0.857
    assert concentrated["workspace"] == "tickets"

    assert not any(item["target"] == "patches" for item in opportunities)


def test_friction_ranking_presents_the_biggest_estimated_saving_first():
    rows = [
        _usage_row("client", "billing", 40, "2026-09-01T00:00:00+00:00"),
        _usage_row("invoices", "billing", 35, "2026-10-01T00:00:00+00:00"),
        _usage_row("tickets", "remote", 900, "2026-09-01T00:00:00+00:00"),
        _usage_row("tickets", "notes", 5, "2026-10-01T00:00:00+00:00"),
    ]
    opportunities = friction_opportunities(rows, min_repeats=12)
    assert [item["target"] for item in opportunities] == ["remote", "billing"]
    assert opportunities[0]["estimated_monthly_repeats"] > opportunities[1]["estimated_monthly_repeats"]

    # A single day of evidence yields counts but never a claimed monthly rate.
    same_day = [
        _usage_row("tickets", "remote", 900, "2026-10-01T00:00:00+00:00"),
        _usage_row("tickets", "notes", 5, "2026-10-01T00:00:00+00:00"),
    ]
    assert friction_opportunities(same_day, min_repeats=12)[0]["estimate_available"] is False


# ── pure policy: Outcome Contract ────────────────────────────────────────────


def _complete_contract(**overrides):
    contract = {
        "outcome": "Sarah can open MYOB, reach the company database and generate an invoice.",
        "preconditions": "MYOB installed and licensed on the workstation",
        "acceptable_interruption": "Up to 10 minutes outside 9am-12pm",
        "verification_method": "customer_confirmed",
        "rollback": "Restore the previous MYOB configuration snapshot if the invoice run fails",
    }
    contract.update(overrides)
    return contract


def test_outcome_that_is_really_a_command_is_rejected():
    assert outcome_is_method("Restart the MYOB service") is True
    assert outcome_is_method("Re-run gpupdate on the endpoint") is True
    assert outcome_is_method("Sarah can generate an invoice in MYOB") is False

    status = contract_status(_complete_contract(outcome="Restart the MYOB service"), now=NOW)
    assert status["status"] == "insufficient"
    assert any(check["name"] == "outcome is not a method" and not check["passed"] for check in status["checks"])


def test_contract_status_walks_insufficient_unverified_verified_and_expired():
    incomplete = _complete_contract(rollback="")
    assert contract_status(incomplete, now=NOW)["status"] == "insufficient"

    assert contract_status(_complete_contract(), now=NOW)["status"] == "unverified"

    verified = _complete_contract(
        verified_at=(NOW - timedelta(days=1)).isoformat(),
        evidence_expires_at=(NOW + timedelta(days=10)).isoformat(),
    )
    assert contract_status(verified, now=NOW)["status"] == "verified"

    expired = _complete_contract(
        verified_at=(NOW - timedelta(days=40)).isoformat(),
        evidence_expires_at=(NOW - timedelta(days=1)).isoformat(),
    )
    assert contract_status(expired, now=NOW)["status"] == "expired"


def test_verification_verdict_refuses_incomplete_contracts_and_empty_evidence():
    refused = verification_verdict(_complete_contract(rollback=""), kind="customer_confirmed", evidence_note="Sarah generated an invoice", now=NOW)
    assert refused["accepted"] is False

    unknown = verification_verdict(_complete_contract(), kind="vibes", evidence_note="Sarah generated an invoice", now=NOW)
    assert unknown["accepted"] is False and "Verification kind" in unknown["reason"]

    thin = verification_verdict(_complete_contract(), kind="customer_confirmed", evidence_note="done", now=NOW)
    assert thin["accepted"] is False

    accepted = verification_verdict(
        _complete_contract(), kind="customer_confirmed",
        evidence_note="Sarah generated invoice INV-1043 in MYOB on the call", evidence_days=14, now=NOW,
    )
    assert accepted["accepted"] is True
    assert accepted["status"] == "verified"

    applied = _complete_contract(verified_at=accepted["verified_at"], evidence_expires_at=accepted["evidence_expires_at"])
    assert contract_status(applied, now=NOW)["status"] == "verified"


def test_closeout_gate_blocks_an_unproven_or_expired_outcome():
    assert closeout_gate(None, now=NOW)["allowed"] is True

    blocked = closeout_gate(_complete_contract(), now=NOW)
    assert blocked["allowed"] is False and blocked["status"] == "unverified"

    expired = closeout_gate(
        _complete_contract(
            verified_at=(NOW - timedelta(days=40)).isoformat(),
            evidence_expires_at=(NOW - timedelta(days=1)).isoformat(),
        ),
        now=NOW,
    )
    assert expired["allowed"] is False and expired["status"] == "expired"

    proven = closeout_gate(
        _complete_contract(
            verified_at=(NOW - timedelta(days=1)).isoformat(),
            evidence_expires_at=(NOW + timedelta(days=13)).isoformat(),
        ),
        now=NOW,
    )
    assert proven["allowed"] is True


# ── pure policy: Breadcrumb Rescue ───────────────────────────────────────────


def _breadcrumbs():
    return [
        {"kind": "hypothesis", "text": "SQL connectivity is failing at the app tier", "created_at": (NOW - timedelta(hours=6)).isoformat(), "scope_ref": "dev-1"},
        {"kind": "tested", "text": "Direct TDS connection from the app server", "created_at": (NOW - timedelta(hours=5)).isoformat(), "scope_ref": "dev-1"},
        {"kind": "ruled_out", "text": "DNS resolution of the SQL host", "created_at": (NOW - timedelta(hours=4)).isoformat(), "scope_ref": "dev-1"},
        {"kind": "finding", "text": "The application service account password expired", "created_at": (NOW - timedelta(hours=3)).isoformat(), "scope_ref": "dev-1"},
        {"kind": "next_step", "text": "Compare the service account permissions against the payroll group", "created_at": (NOW - timedelta(hours=2)).isoformat(), "scope_ref": "dev-1"},
    ]


def test_breadcrumb_resume_reconstructs_reasoning_state():
    resumed = breadcrumb_resume(_breadcrumbs(), changes=[], now=NOW)
    assert resumed["resume"]["testing"] == "Direct TDS connection from the app server"
    assert resumed["resume"]["ruled_out"] == ["DNS resolution of the SQL host"]
    assert resumed["resume"]["next_step"].startswith("Compare the service account")
    assert "ruled out" in resumed["line"].lower()
    # The hypothesis was resolved by a later finding, so it is not left open.
    assert resumed["resume"]["open_hypotheses"] == []


def test_breadcrumb_staleness_marks_conclusions_the_record_moved_past():
    changes = [{"scope_ref": "dev-1", "at": (NOW - timedelta(hours=1)).isoformat(), "summary": "Network adapter configuration changed"}]
    resumed = breadcrumb_resume(_breadcrumbs(), changes=changes, now=NOW)
    stale = {item["text"]: item for item in resumed["stale"]}
    assert stale["DNS resolution of the SQL host"]["reason"] == "possibly_stale"
    assert "may no longer hold" in stale["DNS resolution of the SQL host"]["detail"]
    # A change on another scope must not invalidate this investigation.
    other_scope = breadcrumb_resume(
        _breadcrumbs(),
        changes=[{"scope_ref": "dev-2", "at": (NOW - timedelta(hours=1)).isoformat(), "summary": "Unrelated device changed"}],
        now=NOW,
    )
    assert other_scope["stale_count"] == 0


def test_breadcrumb_age_staleness_applies_when_no_change_evidence_exists():
    old = [{"kind": "finding", "text": "Spooler stalled on a corrupt driver", "created_at": (NOW - timedelta(days=4)).isoformat(), "scope_ref": "dev-1"}]
    resumed = breadcrumb_resume(old, changes=[], now=NOW, stale_after_hours=24)
    assert resumed["stale"][0]["reason"] == "age_stale"
    assert resumed["stale"][0]["change"] is None

    fresh = [{"kind": "finding", "text": "Spooler stalled on a corrupt driver", "created_at": (NOW - timedelta(hours=2)).isoformat()}]
    assert breadcrumb_resume(fresh, changes=[], now=NOW)["stale_count"] == 0


# ── router boundaries ────────────────────────────────────────────────────────


def test_friction_radar_aggregates_and_never_names_a_technician(monkeypatch):
    db = _Db()
    _install(monkeypatch, db)
    user = _user()
    db.workspace_learning_signals.rows.extend([
        {"tenant_id": "tenant-a", "user_id": "tech-1", "workspace": "client", "surface": "action", "target": "billing", "count": 30, "last_used_at": "2026-09-01T00:00:00+00:00"},
        {"tenant_id": "tenant-a", "user_id": "tech-2", "workspace": "invoices", "surface": "action", "target": "billing", "count": 25, "last_used_at": "2026-10-01T00:00:00+00:00"},
        {"tenant_id": "tenant-a", "user_id": "tech-1", "workspace": "client", "surface": "view", "target": "billing", "count": 900, "last_used_at": "2026-10-01T00:00:00+00:00"},
        {"tenant_id": "tenant-b", "user_id": "tech-9", "workspace": "client", "surface": "action", "target": "billing", "count": 500, "last_used_at": "2026-10-01T00:00:00+00:00"},
    ])

    result = asyncio.run(nexus_flow.friction_radar(current_user=user))
    assert [item["id"] for item in result["opportunities"]] == ["repeated_navigation:-:billing"]
    assert result["evidence_rows"] == 2
    assert "never identifies or ranks a technician" in result["boundary"]

    other_tenant = asyncio.run(nexus_flow.friction_radar(current_user=_user(tenant="tenant-b")))
    assert [item["observed_repeats"] for item in other_tenant["opportunities"]] == [500]


def test_friction_proposal_flow_is_reviewed_with_evidence(monkeypatch):
    db = _Db()
    audit = _install(monkeypatch, db)
    user = _user()

    payload = FrictionProposalPayload(
        opportunity_id="repeated_navigation:-:billing",
        kind="repeated_navigation",
        workspace=None,
        target="billing",
        proposed_solution="Add one contextual entry point for billing.",
        evidence_note="Billing is reached from both the client and invoice workspaces.",
    )
    created = asyncio.run(nexus_flow.propose_friction_fix(payload, current_user=user))
    assert created["status"] == "proposed"

    with pytest.raises(Exception) as duplicate:
        asyncio.run(nexus_flow.propose_friction_fix(payload, current_user=user))
    assert "already awaiting review" in str(duplicate.value)

    with pytest.raises(Exception) as credential:
        asyncio.run(nexus_flow.propose_friction_fix(
            FrictionProposalPayload(
                opportunity_id="concentrated_usage:tickets:remote",
                kind="concentrated_usage",
                target="remote",
                proposed_solution="Promote remote onto the ticket primary surface.",
                evidence_note="api_key=sk-live-1234 should never be stored here",
            ),
            current_user=user,
        ))
    assert "credential material" in str(credential.value)

    reviewed = asyncio.run(nexus_flow.review_friction_proposal(
        created["id"], FrictionReviewPayload(decision="approved", evidence_note="Reviewed with the service desk lead"), current_user=user,
    ))
    assert reviewed["status"] == "approved"
    assert reviewed["review"]["reviewed_by"] == "tech-1"

    with pytest.raises(Exception) as already:
        asyncio.run(nexus_flow.review_friction_proposal(
            created["id"], FrictionReviewPayload(decision="rejected", evidence_note="Changed our mind"), current_user=user,
        ))
    assert "already been reviewed" in str(already.value)

    assert {entry["action"] for entry in audit.entries} >= {
        "nexus_flow.friction_proposed", "nexus_flow.friction_reviewed",
    }


def test_outcome_contract_verify_and_closeout_gate(monkeypatch):
    db = _Db()
    audit = _install(monkeypatch, db)
    user = _user()
    ticket_id = _ticket(db)

    with pytest.raises(Exception) as missing:
        asyncio.run(nexus_flow.get_outcome_contract("tkt-nope", current_user=user))
    assert "not found" in str(missing.value).lower()

    empty = asyncio.run(nexus_flow.get_outcome_contract(ticket_id, current_user=user))
    assert empty["contract"] is None
    assert empty["closeout_gate"]["allowed"] is True

    stored = asyncio.run(nexus_flow.set_outcome_contract(
        ticket_id,
        OutcomeContractPayload(
            outcome="Sarah can open MYOB, reach the company database and generate an invoice.",
            preconditions="MYOB licensed on the workstation",
            dependencies=["MYOB server", "SQL instance"],
            acceptable_interruption="Up to 10 minutes outside 9am-12pm",
            verification_method="customer_confirmed",
            rollback="Restore the previous MYOB configuration snapshot",
        ),
        current_user=user,
    ))
    assert stored["status"]["status"] == "unverified"
    assert stored["closeout_gate"]["allowed"] is False

    with pytest.raises(Exception) as premature:
        asyncio.run(nexus_flow.verify_outcome_contract(
            ticket_id, OutcomeVerificationPayload(kind="customer_confirmed", evidence_note="short"), current_user=user,
        ))
    assert "must describe what was observed" in str(premature.value)

    verified = asyncio.run(nexus_flow.verify_outcome_contract(
        ticket_id,
        OutcomeVerificationPayload(
            kind="customer_confirmed",
            evidence_note="Sarah generated invoice INV-1043 in MYOB while we were on the call",
        ),
        current_user=user,
    ))
    assert verified["status"]["status"] == "verified"
    assert verified["closeout_gate"]["allowed"] is True
    assert len(verified["contract"]["verification_history"]) == 1

    incomplete = asyncio.run(nexus_flow.set_outcome_contract(
        ticket_id,
        OutcomeContractPayload(
            outcome="Restart the MYOB service",
            preconditions="MYOB installed",
            acceptable_interruption="Any",
            verification_method="technician_witnessed",
            rollback="Stop the service again",
        ),
        current_user=user,
    ))
    assert incomplete["status"]["status"] == "insufficient"
    # Replacing the contract invalidates the previous verification evidence.
    assert incomplete["closeout_gate"]["allowed"] is False

    assert {entry["action"] for entry in audit.entries} >= {
        "nexus_flow.outcome_contract_set", "nexus_flow.outcome_verified",
    }


def test_outcome_contract_respects_the_technicians_client_scope(monkeypatch):
    db = _Db()
    _install(monkeypatch, db)
    _ticket(db, ticket_id="tkt-2", client_id="cli-2")
    restricted = _user(client_ids=["cli-1"])

    with pytest.raises(Exception) as hidden:
        asyncio.run(nexus_flow.get_outcome_contract("tkt-2", current_user=restricted))
    assert "not found" in str(hidden.value).lower()

    # A still-unmigrated legacy row on the permissive partition is not visible
    # to a technician restricted to a different client either.
    db2 = _Db()
    _install(monkeypatch, db2)
    db2.tickets.rows.append({"id": "tkt-3", "tenant_id": "tenant-a", "client_id": "cli-3", "ticket_number": "TKT-003"})
    with pytest.raises(Exception):
        asyncio.run(nexus_flow.get_outcome_contract("tkt-3", current_user=_user(client_ids=["cli-1"])))


def test_breadcrumbs_record_resume_and_go_stale(monkeypatch):
    db = _Db()
    audit = _install(monkeypatch, db)
    user = _user()
    ticket_id = _ticket(db)

    first = asyncio.run(nexus_flow.record_breadcrumb(
        ticket_id, BreadcrumbPayload(kind="ruled_out", text="DNS resolution of the SQL host", scope_ref="dev-1"), current_user=user,
    ))
    assert first["kind"] == "ruled_out"

    asyncio.run(nexus_flow.record_breadcrumb(
        ticket_id, BreadcrumbPayload(kind="next_step", text="Compare the service account permissions", scope_ref="dev-1"), current_user=user,
    ))

    listing = asyncio.run(nexus_flow.get_breadcrumbs(ticket_id, current_user=user))
    assert listing["resume"]["ruled_out"] == ["DNS resolution of the SQL host"]
    assert listing["resume"]["next_step"].startswith("Compare the service account")
    assert listing["kinds"] == ["hypothesis", "tested", "ruled_out", "finding", "next_step", "change"]

    # Backdate the conclusion and land a later change on the same device scope:
    # the earlier conclusion must now be flagged, not silently trusted.
    db.nexus_breadcrumbs.rows[0]["created_at"] = (NOW - timedelta(days=2)).isoformat()
    db.activity_logs.rows.append({
        "tenant_id": "tenant-a",
        "entity_id": "dev-1",
        "action": "device.adapter.changed",
        "details": "Network adapter configuration changed",
        "created_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
    })
    resumed = asyncio.run(nexus_flow.get_breadcrumbs(ticket_id, current_user=user))
    # The freshly recorded next-step has no staleness; the backdated conclusion does.
    assert resumed["stale_count"] >= 1
    assert any(item["text"] == "DNS resolution of the SQL host" for item in resumed["stale"])

    assert {entry["action"] for entry in audit.entries} >= {"nexus_flow.breadcrumb_recorded"}
