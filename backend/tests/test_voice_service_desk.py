"""Voice service-desk behaviour: CDR mapping, filters and artifact safety.

Everything here runs against fabricated PBX payloads, so the provider is never
contacted and the assertions describe exactly what Nexus promises.
"""

import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import voice_service_desk  # noqa: E402
from app.services.yeastar import cdr  # noqa: E402
from app.services.yeastar import client as yeastar_client  # noqa: E402

PBX = {
    "id": "pbx-1",
    "name": "Acme PBX",
    "client_id": "client-a",
    "client_name": "Acme Ltd",
    "pbx_url": "https://acme.example.yeastarcloud.com",
    "client_api_id": "api-user",
    "client_secret": "api-secret",
    "tls_validation": True,
}

PROVIDER_ROWS = [
    {"id": "1", "call_from": "Reception<101>", "call_to": "Dana Vale<202>", "call_type": "inbound", "disposition": "ANSWERED", "duration": "120", "billsec": "110", "recording": "1", "time": "2026-10-07T01:00:00Z"},
    {"id": "2", "call_from": "0412 345 678", "call_to": "Support<300>", "call_type": "inbound", "disposition": "NO ANSWER", "duration": "45", "time": "2026-10-07T02:00:00Z", "wait_time": "38"},
    {"id": "3", "call_from": "Sam Lee<205>", "call_to": "0422 000 111", "call_type": "outbound", "disposition": "FAILED", "duration": "3", "time": "2026-10-07T03:00:00Z"},
    {"id": "4", "call_from": "Client<400>", "call_to": "Queue<500>", "call_type": "inbound", "disposition": "CANCELLED", "duration": "62", "time": "2026-10-07T04:00:00Z", "wait_time": "55"},
]


def run(coro):
    return asyncio.run(coro)


def _patch_provider(monkeypatch, rows=None):
    async def fake_api_call(settings, path, **kwargs):
        return {"errcode": 0, "data": list(rows if rows is not None else PROVIDER_ROWS), "total_number": len(rows or PROVIDER_ROWS)}

    monkeypatch.setattr(yeastar_client, "api_call", fake_api_call)


def _patch_resolve(monkeypatch, settings=None):
    async def fake_resolve(current_user, pbx_id, **kwargs):
        return dict(settings if settings is not None else PBX)

    monkeypatch.setattr(voice_service_desk, "resolve_client_pbx", fake_resolve)


def _history(**overrides):
    kwargs = {
        "pbx_id": None,
        "direction": "all",
        "status": "all",
        "search": "",
        "abandoned_only": False,
        "start_time": None,
        "end_time": None,
        "page": 1,
        "page_size": 50,
        "current_user": {"id": "tech-1", "role": "technician"},
    }
    kwargs.update(overrides)
    return run(voice_service_desk.get_voice_call_history(**kwargs))


# --- CDR normalisation ------------------------------------------------------


def test_party_format_is_split_into_a_name_and_a_number():
    assert cdr.split_party("Reception<101>") == ("Reception", "101")
    assert cdr.split_party("0412 345 678") == ("0412 345 678", "0412 345 678")
    assert cdr.split_party(None) == ("", "")


@pytest.mark.parametrize(
    ("disposition", "expected"),
    [
        ("ANSWERED", "answered"),
        ("NO ANSWER", "missed"),
        ("NOANSWER", "missed"),
        ("FAILED", "failed"),
        ("", ""),
        ("something new", "something new"),
    ],
)
def test_disposition_vocabulary_is_closed_and_does_not_invent_answers(disposition, expected):
    assert cdr.normalise_disposition(disposition) == expected


def test_wait_time_is_absent_when_the_pbx_did_not_report_one():
    unreported = cdr.normalise_cdr({"id": "9", "call_from": "a", "call_to": "b", "disposition": "NO ANSWER"})
    assert unreported["wait_time"] is None
    reported = cdr.normalise_cdr({"id": "9", "call_from": "a", "call_to": "b", "disposition": "NO ANSWER", "wait_time": "12"})
    assert reported["wait_time"] == 12


def test_caller_name_collapses_when_it_matches_the_number():
    # A bare number must not be presented as if it were a resolved contact name.
    row = cdr.normalise_cdr({"id": "1", "call_from": "0412 345 678", "call_to": "300", "disposition": "ANSWERED"})
    assert row["caller_name"] == row["caller"] == "0412 345 678"


def test_malformed_rows_are_ignored_rather_than_guessed_at():
    rows = cdr.normalise_cdr_rows(["not a dict", None, {"id": "1", "call_from": "a", "call_to": "b", "disposition": "ANSWERED"}])
    assert len(rows) == 1
    assert cdr.normalise_cdr_rows("garbage") == []


def test_abandoned_is_a_separate_state_from_missed():
    assert cdr.is_abandoned({"disposition": "CANCELLED"}) is True
    assert cdr.is_abandoned({"disposition": "ABANDONED"}) is True
    assert cdr.is_abandoned({"disposition": "NO ANSWER"}) is False
    # An abandon is deliberately not folded into the missed vocabulary, so the
    # two obligations stay distinguishable in reporting.
    assert cdr.normalise_disposition("CANCELLED") == "cancelled"


# --- Response safety --------------------------------------------------------


def test_pbx_identity_never_carries_a_credential():
    identity = voice_service_desk.pbx_identity({**PBX, "client_secret": "super-secret"})
    assert set(identity) == {"id", "name", "client_id", "client_name"}
    assert "super-secret" not in str(identity)


def test_a_pbx_without_credentials_is_refused(monkeypatch):
    async def resolve_without_secret(*args, **kwargs):
        return {**PBX, "client_secret": ""}

    monkeypatch.setattr(yeastar_client, "resolve_pbx", resolve_without_secret)
    with pytest.raises(HTTPException) as excinfo:
        run(voice_service_desk.resolve_client_pbx({"id": "t"}, "pbx-1", operation="test"))
    assert excinfo.value.status_code == 400


def test_an_unresolvable_pbx_maps_to_a_clear_status(monkeypatch):
    from app.services.yeastar.errors import YeastarError

    async def raise_not_found(*args, **kwargs):
        raise YeastarError("PBX not found", "not_found")

    monkeypatch.setattr(yeastar_client, "resolve_pbx", raise_not_found)
    with pytest.raises(HTTPException) as excinfo:
        run(voice_service_desk.resolve_client_pbx({"id": "t"}, "pbx-9", operation="test"))
    assert excinfo.value.status_code == 404


# --- Call history -----------------------------------------------------------


def test_call_history_summarises_the_filtered_window(monkeypatch):
    _patch_resolve(monkeypatch)
    _patch_provider(monkeypatch)

    result = _history()
    assert result["counts"]["returned"] == 4
    assert result["counts"]["answered"] == 1
    assert result["counts"]["missed"] == 1
    assert result["counts"]["failed"] == 1
    assert result["counts"]["recorded"] == 1
    assert result["total_talk_time"] == 110
    assert result["average_talk_time"] == 110
    # Only two of four rows carried a wait time, so the average is over those.
    assert result["wait_time_reported"] is True
    assert result["average_wait_time"] == (38 + 55) // 2
    assert result["pbx"]["client_id"] == "client-a"


def test_call_history_says_so_when_no_wait_time_was_reported(monkeypatch):
    _patch_resolve(monkeypatch)
    _patch_provider(monkeypatch, rows=[PROVIDER_ROWS[0]])

    result = _history()
    assert result["wait_time_reported"] is False
    assert result["average_wait_time"] is None


@pytest.mark.parametrize(
    ("overrides", "expected_ids"),
    [
        ({"direction": "inbound"}, {"1", "2", "4"}),
        ({"direction": "outbound"}, {"3"}),
        ({"status": "answered"}, {"1"}),
        ({"status": "failed"}, {"3"}),
        ({"abandoned_only": True}, {"2", "3", "4"}),
        ({"search": "dana"}, {"1"}),
        ({"search": "0412"}, {"2"}),
        ({"direction": "inbound", "status": "answered"}, {"1"}),
    ],
)
def test_call_history_filters_apply_to_normalised_rows(monkeypatch, overrides, expected_ids):
    _patch_resolve(monkeypatch)
    _patch_provider(monkeypatch)

    result = _history(**overrides)
    assert {row["id"] for row in result["data"]} == expected_ids


def test_call_history_passes_date_bounds_to_the_pbx(monkeypatch):
    _patch_resolve(monkeypatch)
    captured = {}

    async def fake_api_call(settings, path, params=None, **kwargs):
        captured["params"] = dict(params or {})
        return {"errcode": 0, "data": [], "total_number": 0}

    monkeypatch.setattr(yeastar_client, "api_call", fake_api_call)
    _history(start_time="2026-10-01", end_time="2026-10-07")
    assert captured["params"]["start_time"] == "2026-10-01"
    assert captured["params"]["end_time"] == "2026-10-07"


def test_call_history_provider_failure_is_reported_not_swallowed(monkeypatch):
    from app.services.yeastar.errors import YeastarError

    _patch_resolve(monkeypatch)

    async def boom(settings, path, **kwargs):
        raise YeastarError("The PBX returned HTTP 503 for cdr/list.", "http", status_code=503)

    monkeypatch.setattr(yeastar_client, "api_call", boom)
    with pytest.raises(HTTPException) as excinfo:
        _history()
    assert excinfo.value.status_code == 502


# --- Queue state ------------------------------------------------------------


def test_queue_state_degrades_instead_of_failing_the_page(monkeypatch):
    _patch_resolve(monkeypatch)

    async def fake_dispatch(settings, operation, params=None, body=None, strict=True):
        if operation.id == "queue.list":
            return {"errcode": 0, "data": [{"id": "q1", "name": "Support"}]}
        raise Exception("provider stalled")

    monkeypatch.setattr(yeastar_client, "dispatch_operation", fake_dispatch)
    monkeypatch.setattr(voice_service_desk.db, "yeastar_pbxs", _RecordingCollection())

    result = run(voice_service_desk.get_voice_queue_state(pbx_id=None, current_user={"id": "t"}))
    assert result["queue_count"] == 1
    assert result["queues"] == [{"id": "q1", "name": "Support"}]
    # The queue list arrived; the optional reads are named so a technician can
    # see exactly which provider call did not respond.
    assert set(result["degraded_reads"]) == {"queue.call_status", "queue.agent_status", "queue.pause_reasons"}


class _RecordingCollection:
    def __init__(self):
        self.updated = []

    async def update_one(self, query, update):
        self.updated.append((query, update))


# --- Voice artifacts --------------------------------------------------------


def test_unknown_artifact_kind_is_rejected_before_any_provider_call(monkeypatch):
    async def explode(*args, **kwargs):
        raise AssertionError("no provider call should happen for an unknown artifact kind")

    monkeypatch.setattr(voice_service_desk, "resolve_client_pbx", explode)
    with pytest.raises(HTTPException) as excinfo:
        run(voice_service_desk.relay_voice_artifact("handset", "1", pbx_id=None, ext_id=None, current_user={"id": "t"}))
    assert excinfo.value.status_code == 404


def test_listening_requires_the_recording_permission(monkeypatch):
    _patch_resolve(monkeypatch)

    async def deny(user, permission_id, **kwargs):
        assert permission_id == "voice.recording.listen"
        raise HTTPException(status_code=403, detail=f"Action permission required: {permission_id}")

    monkeypatch.setattr(voice_service_desk, "assert_action_permission", deny)
    with pytest.raises(HTTPException) as excinfo:
        run(voice_service_desk.relay_voice_artifact("recording", "7", pbx_id=None, ext_id=None, current_user={"id": "t"}))
    assert excinfo.value.status_code == 403


def test_artifact_without_a_download_address_is_reported(monkeypatch):
    _patch_resolve(monkeypatch)

    async def no_url(settings, operation_id, params=None):
        return {"errcode": 0, "data": {"id": "7"}}

    monkeypatch.setattr(voice_service_desk, "_read_interface", no_url)

    async def allow(user, permission_id, **kwargs):
        return user

    monkeypatch.setattr(voice_service_desk, "assert_action_permission", allow)
    with pytest.raises(HTTPException) as excinfo:
        run(voice_service_desk.relay_voice_artifact("recording", "7", pbx_id=None, ext_id=None, current_user={"id": "t"}))
    assert excinfo.value.status_code == 502


def test_relay_streams_the_artifact_without_exposing_the_provider_url(monkeypatch):
    _patch_resolve(monkeypatch)

    async def with_url(settings, operation_id, params=None):
        return {"url": "https://pbx.internal/private/rec-7.wav?token=secret"}

    fetched = {}

    async def fake_fetch(url, **kwargs):
        fetched["url"] = url
        return b"RIFF....", "audio/wav"

    monkeypatch.setattr(voice_service_desk, "_read_interface", with_url)
    monkeypatch.setattr(yeastar_client, "fetch_provider_url", fake_fetch)

    async def allow(user, permission_id, **kwargs):
        return user

    monkeypatch.setattr(voice_service_desk, "assert_action_permission", allow)
    monkeypatch.setattr(voice_service_desk, "log_activity", _noop_activity)

    response = run(voice_service_desk.relay_voice_artifact("recording", "7", pbx_id=None, ext_id=None, current_user={"id": "t"}))
    # The provider URL is followed server-side and never becomes part of the
    # response the browser receives.
    assert fetched["url"] == "https://pbx.internal/private/rec-7.wav?token=secret"
    headers = {key.lower(): value for key, value in response.headers.items()}
    assert headers["cache-control"] == "private, no-store"
    assert "pbx.internal" not in str(headers)
    assert "secret" not in str(headers)


async def _noop_activity(*args, **kwargs):
    return None
