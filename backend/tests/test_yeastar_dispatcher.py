"""The gated Yeastar dispatcher: reachability, verbs and write audit.

Yeastar deletes its objects with a GET, so the provider's own verb cannot be
what decides how a Nexus caller reaches an operation. These tests pin the rule
Nexus actually promises: reads are GET, every state change is a POST command,
proxied downloads never reach the dispatcher, and a state change is audited.

Everything runs against fabricated payloads, so no appliance is contacted.
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

from app.routers import yeastar  # noqa: E402
from app.services.yeastar import client as yeastar_client  # noqa: E402
from app.services.yeastar import registry  # noqa: E402

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

# An administrator short-circuits the action-permission lookup, so these tests
# stay about dispatch and never reach Mongo.
ADMIN = {"id": "admin-1", "email": "admin@nexusops.io", "role": "admin", "name": "Ada Admin"}


class FakeRequest:
    """Minimal stand-in for the FastAPI request the routes read query params from."""

    def __init__(self, params=None):
        self.query_params = dict(params or {})


def run(coro):
    return asyncio.run(coro)


def _patch(monkeypatch, *, payload=None, pbx=None):
    calls: dict = {}
    audits: list = []

    async def fake_resolve(current_user, pbx_id, **kwargs):
        calls["resolved_for"] = pbx_id
        return dict(pbx if pbx is not None else PBX)

    async def fake_dispatch(settings, operation, *, params=None, body=None, strict=True):
        calls["operation"] = operation.id
        calls["provider_method"] = operation.method
        calls["params"] = dict(params or {})
        calls["body"] = dict(body or {})
        calls["strict"] = strict
        return {"errcode": 0, "data": payload if payload is not None else []}

    async def fake_log(*args, **kwargs):
        audits.append((args, kwargs))

    monkeypatch.setattr(yeastar, "resolve_pbx", fake_resolve)
    monkeypatch.setattr(yeastar_client, "dispatch_operation", fake_dispatch)
    monkeypatch.setattr(yeastar, "log_activity", fake_log)
    return calls, audits


# --- the verb rule ----------------------------------------------------------


def test_a_read_is_dispatched_over_get_and_is_not_audited(monkeypatch):
    calls, audits = _patch(monkeypatch, payload=[{"number": "101"}])

    result = run(yeastar.run_yeastar_read_operation("extension.list", FakeRequest(), pbx_id="pbx-1", current_user=ADMIN))

    assert calls["operation"] == "extension.list"
    assert calls["strict"] is True
    assert result == {
        "operation": "extension.list",
        "category": "Extension",
        "pbx_id": "pbx-1",
        "client_id": "client-a",
        "destructive": False,
        "data": [{"number": "101"}],
    }
    # Read traffic must not fill the audit ledger.
    assert audits == []


def test_a_provider_get_delete_is_reachable_as_a_nexus_post_command(monkeypatch):
    calls, audits = _patch(monkeypatch)

    run(
        yeastar.run_yeastar_write_operation(
            "extension.delete",
            FakeRequest({"id": "12"}),
            data={},
            pbx_id="pbx-1",
            current_user=ADMIN,
        )
    )

    assert calls["operation"] == "extension.delete"
    # The appliance verb stays a GET; only the Nexus-facing verb is POST.
    assert calls["provider_method"] == "GET"
    assert calls["params"] == {"id": "12"}
    assert calls["body"] == {}
    assert [args[1] for args, _ in audits] == ["voice_operation_executed"]
    metadata = audits[0][1]["metadata"]
    assert metadata["operation"] == "extension.delete"
    assert metadata["destructive"] is True
    assert metadata["client_id"] == "client-a"


def test_every_non_proxied_operation_has_exactly_one_nexus_verb():
    for operation in registry.OPERATIONS:
        if operation.proxied:
            continue
        assert yeastar._operation_for_dispatch(operation.id, expect_write=operation.is_write) is operation
        with pytest.raises(HTTPException) as refusal:
            yeastar._operation_for_dispatch(operation.id, expect_write=not operation.is_write)
        assert refusal.value.status_code == 405


def test_every_destructive_operation_is_reachable_as_a_command():
    destructive = [operation for operation in registry.OPERATIONS if operation.destructive]

    assert destructive, "the catalogue is expected to describe destructive interfaces"
    for operation in destructive:
        assert yeastar._operation_for_dispatch(operation.id, expect_write=True) is operation


def test_a_write_cannot_be_run_through_the_read_route():
    with pytest.raises(HTTPException) as refusal:
        yeastar._operation_for_dispatch("extension.create", expect_write=False)

    assert refusal.value.status_code == 405
    assert "POST" in refusal.value.detail


def test_a_read_cannot_be_run_through_the_command_route():
    with pytest.raises(HTTPException) as refusal:
        yeastar._operation_for_dispatch("extension.list", expect_write=True)

    assert refusal.value.status_code == 405
    assert "GET" in refusal.value.detail


def test_an_unknown_operation_is_not_found():
    with pytest.raises(HTTPException) as refusal:
        yeastar._operation_for_dispatch("not.a.real.operation", expect_write=False)

    assert refusal.value.status_code == 404


@pytest.mark.parametrize("operation_id", ["recording.download", "voicemail.download", "backup.download", "system_log.download"])
def test_a_proxied_download_is_never_dispatched(operation_id):
    for expect_write in (False, True):
        with pytest.raises(HTTPException) as refusal:
            yeastar._operation_for_dispatch(operation_id, expect_write=expect_write)
        assert refusal.value.status_code == 400
        assert "artifact routes" in refusal.value.detail


# --- scope, credentials and provider failures -------------------------------


def test_a_pbx_without_credentials_is_refused_before_any_provider_call(monkeypatch):
    calls, _ = _patch(monkeypatch, pbx={**PBX, "client_secret": ""})

    with pytest.raises(HTTPException) as refusal:
        run(yeastar.run_yeastar_read_operation("extension.list", FakeRequest(), pbx_id="pbx-1", current_user=ADMIN))

    assert refusal.value.status_code == 400
    assert "operation" not in calls


def test_the_command_route_resolves_the_pbx_from_the_query_string(monkeypatch):
    calls, _ = _patch(monkeypatch)

    run(
        yeastar.run_yeastar_write_operation(
            "phone.batch_reboot",
            FakeRequest({"pbx_id": "pbx-9"}),
            data={"ids": ["1"]},
            current_user=ADMIN,
        )
    )

    assert calls["resolved_for"] == "pbx-9"
    assert calls["body"] == {"ids": ["1"]}


def test_a_pbx_id_in_the_write_body_cannot_override_the_resolved_scope(monkeypatch):
    calls, _ = _patch(monkeypatch)

    run(
        yeastar.run_yeastar_write_operation(
            "phone.batch_delete",
            FakeRequest(),
            data={"pbx_id": "another-tenant-pbx", "ids": ["1"]},
            pbx_id="pbx-1",
            current_user=ADMIN,
        )
    )

    assert calls["resolved_for"] == "pbx-1"
    assert calls["body"] == {"ids": ["1"]}


def test_a_provider_rejection_becomes_a_bad_gateway(monkeypatch):
    _patch(monkeypatch)

    async def rejected(settings, operation, *, params=None, body=None, strict=True):
        return {"errcode": 60002, "errmsg": "the number of tokens exceeds the limit"}

    monkeypatch.setattr(yeastar_client, "dispatch_operation", rejected)

    with pytest.raises(HTTPException) as refusal:
        run(yeastar.run_yeastar_read_operation("extension.list", FakeRequest(), pbx_id="pbx-1", current_user=ADMIN))

    assert refusal.value.status_code == 502
    assert "extension.list" in refusal.value.detail
    assert "60002" in refusal.value.detail
