"""Focused tests for the explainable Nexus Remote session risk read.

The risk read is a deterministic function of the governed session record, so it
adds no evidence and no second source of authority. These tests pin the bands,
each factor's raised/satisfied decision, and the session-list merge.
"""

import asyncio
from copy import deepcopy

from app.routers import remote as routes


def _session(**overrides):
    """A clean, attended, ticket-bound, in-hours view-only session."""
    base = {
        "id": "session-1",
        "provider": "nexus",
        "status": "active",
        "access_mode": "view",
        "consent_required": True,
        "consent_confirmed": True,
        "control_consent_confirmed": False,
        "standing_authorisation": False,
        "ticket_id": "ticket-1",
        "ticket_number": "INC-0001",
        "work_session_id": None,
        "purpose": "Diagnose intermittent VPN drops for the sales team",
        "device_type": "workstation",
        "started_at": "2026-10-06T09:00:00+00:00",
        "ended_at": "2026-10-06T09:30:00+00:00",
    }
    base.update(overrides)
    return base


def _risk(session):
    return routes._native_session_risk(session)["native_risk"]


def _factor(risk, key):
    return next(factor for factor in risk["factors"] if factor["key"] == key)


def test_clean_attended_view_session_scores_low_with_no_raised_factors():
    risk = _risk(_session())
    assert risk["score"] == 0
    assert risk["band"] == "low"
    assert risk["raised_count"] == 0
    assert risk["requires_step_up"] is False
    assert all(factor["state"] == "satisfied" for factor in risk["factors"])


def test_interactive_control_and_missing_consent_raise_the_score():
    risk = _risk(_session(access_mode="control", consent_confirmed=False))
    assert risk["score"] == 18 + 20 + 25  # control + consent missing + unconfirmed control consent
    assert risk["band"] == "elevated"
    assert risk["requires_step_up"] is True
    assert _factor(risk, "interactive_control")["state"] == "raised"
    assert _factor(risk, "consent_missing")["state"] == "raised"
    assert _factor(risk, "control_consent_unconfirmed")["state"] == "raised"


def test_confirmed_control_consent_clears_the_unconfirmed_factor():
    risk = _risk(_session(access_mode="control", control_consent_confirmed=True))
    assert _factor(risk, "control_consent_unconfirmed")["state"] == "satisfied"
    assert risk["score"] == 18
    assert risk["requires_step_up"] is False


def test_standing_authorisation_is_flagged_but_does_not_force_step_up_alone():
    risk = _risk(_session(standing_authorisation=True))
    assert _factor(risk, "standing_authorisation")["state"] == "raised"
    assert risk["score"] == 22
    assert risk["band"] == "low"
    assert risk["requires_step_up"] is False


def test_unbound_session_and_generic_purpose_are_flagged():
    risk = _risk(_session(ticket_id=None, ticket_number=None, work_session_id=None, purpose=""))
    assert _factor(risk, "no_ticket_context")["state"] == "raised"
    assert _factor(risk, "generic_purpose")["state"] == "raised"
    assert risk["score"] == 12 + 8


def test_attached_work_session_satisfies_ticket_context():
    risk = _risk(_session(ticket_id=None, ticket_number=None, work_session_id="ws-9"))
    assert _factor(risk, "no_ticket_context")["state"] == "satisfied"
    assert risk["score"] == 0


def test_long_running_active_session_raises_duration_factor():
    risk = _risk(_session(started_at="2026-10-06T09:00:00+00:00", ended_at="2026-10-06T13:05:00+00:00"))
    assert _factor(risk, "long_session")["state"] == "raised"
    assert risk["score"] == 8


def test_short_session_does_not_raise_duration_factor():
    risk = _risk(_session())
    assert _factor(risk, "long_session")["state"] == "satisfied"


def test_business_hours_are_evaluated_in_utc():
    in_hours = _risk(_session(started_at="2026-10-06T09:00:00+00:00"))
    out_of_hours = _risk(_session(started_at="2026-10-06T02:30:00+00:00", ended_at="2026-10-06T03:00:00+00:00"))
    assert _factor(in_hours, "outside_business_hours")["state"] == "satisfied"
    assert _factor(out_of_hours, "outside_business_hours")["state"] == "raised"
    assert out_of_hours["score"] == 6


def test_server_class_endpoint_only_counts_for_control_sessions():
    control_on_server = _risk(_session(access_mode="control", control_consent_confirmed=True, device_type="server"))
    view_on_server = _risk(_session(device_type="server"))
    assert _factor(control_on_server, "server_control")["state"] == "raised"
    assert _factor(view_on_server, "server_control")["state"] == "satisfied"
    assert control_on_server["score"] == 18 + 10


def test_terminal_session_never_requires_step_up():
    risk = _risk(_session(
        status="ended",
        access_mode="control",
        consent_confirmed=False,
        standing_authorisation=True,
        ticket_id=None,
        ticket_number=None,
        purpose="",
    ))
    assert risk["score"] > 50
    assert risk["band"] in {"elevated", "high"}
    assert risk["requires_step_up"] is False


def test_score_is_capped_and_the_read_is_deterministic():
    worst = {
        "access_mode": "control",
        "consent_required": True,
        "consent_confirmed": False,
        "control_consent_confirmed": False,
        "standing_authorisation": True,
        "ticket_id": None,
        "ticket_number": None,
        "work_session_id": None,
        "purpose": "",
        "device_type": "server",
        "started_at": "2026-10-06T02:00:00+00:00",
        "ended_at": "2026-10-06T06:00:00+00:00",
    }
    first = _risk(_session(**worst))
    second = _risk(_session(**worst))
    assert first["score"] == 100
    assert first["band"] == "high"
    assert first == second


def test_non_native_session_reports_not_native():
    risk = _risk(_session(provider="rustdesk"))
    assert risk["band"] == "not_native"
    assert risk["score"] == 0
    assert risk["factors"] == []
    assert risk["requires_step_up"] is False


def test_session_list_exposes_native_risk(monkeypatch):
    rows = [_session(), _session(id="session-2", provider="rustdesk")]

    class _Cursor:
        def sort(self, *_args, **_kwargs):
            return self

        async def to_list(self, _limit):
            return deepcopy(rows)

    class _Collection:
        def find(self, *_args, **_kwargs):
            return _Cursor()

    class _FakeDb:
        remote_sessions = _Collection()

    async def _no_expiry(**_kwargs):
        return 0

    monkeypatch.setattr(routes, "db", _FakeDb())
    monkeypatch.setattr(routes, "expire_overdue_grants", _no_expiry)

    result = asyncio.run(routes.get_remote_sessions(
        current_user={"id": "u1", "tenant_id": "tenant-1", "role": "admin"},
    ))

    assert [row["native_risk"]["band"] for row in result] == ["low", "not_native"]
    assert result[0]["native_risk"]["score"] == 0
