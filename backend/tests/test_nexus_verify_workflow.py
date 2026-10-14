"""Regression coverage for Nexus Verify factor and challenge boundaries."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import nexus_verify


class _Rows:
    def __init__(self, rows=None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query, _projection=None):
        return next(
            (deepcopy(row) for row in self.rows if all(row.get(key) == value for key, value in query.items())),
            None,
        )

    async def update_one(self, query, update):
        for row in self.rows:
            if not all(row.get(key) == value for key, value in query.items()):
                continue
            row.update(deepcopy(update.get("$set", {})))
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


class _Db:
    def __init__(self, record):
        self.nexus_verify_requests = _Rows([record])
        self.nexus_verify_audit = _Rows()


def _record(**overrides):
    issued = datetime.now(timezone.utc)
    base = {
        "id": "verify-1",
        "client_id": "client-1",
        "action_type": "global_admin_change",
        "required_factors": 2,
        "approval_required": True,
        "status": "challenge_issued",
        "created_by_id": "tech-1",
        "challenge": {
            "id": "challenge-1",
            "method": "nexus_app",
            "method_label": "Registered Nexus app",
            "issued_at": issued.isoformat(),
            "expires_at": (issued + timedelta(minutes=10)).isoformat(),
            "delivery_state": "recorded_not_connector_verified",
        },
        "verification": None,
    }
    base.update(overrides)
    return base


def _user():
    return {"id": "tech-1", "name": "Alex Technician", "email": "alex@example.test", "role": "technician"}


async def _allow_scope(*_args, **_kwargs):
    return None


def test_critical_verify_request_requires_distinct_factors_before_approval(monkeypatch):
    async def scenario():
        fake_db = _Db(_record())
        monkeypatch.setattr(nexus_verify, "db", fake_db)
        monkeypatch.setattr(nexus_verify, "assert_client_scope", _allow_scope)

        first = await nexus_verify.confirm_identity(
            "verify-1",
            {"method": "nexus_app", "evidence_ref": "Nexus app receipt 42"},
            _user(),
        )
        assert first["status"] == "awaiting_verification"
        assert first["verification"]["factor_count"] == 1
        assert first["verification"]["execution_eligible"] is False

        with pytest.raises(HTTPException) as duplicate:
            await nexus_verify.issue_challenge("verify-1", {"method": "nexus_app"}, _user())
        assert duplicate.value.status_code == 409

        issued = await nexus_verify.issue_challenge("verify-1", {"method": "passkey"}, _user())
        assert issued["challenge"]["method"] == "passkey"

        second = await nexus_verify.confirm_identity(
            "verify-1",
            {"method": "passkey", "evidence_ref": "Passkey assertion reference 84"},
            _user(),
        )
        assert second["status"] == "awaiting_approval"
        assert second["verification"]["factor_count"] == 2
        assert second["verification"]["execution_eligible"] is False
        assert len(fake_db.nexus_verify_audit.rows) == 3

    asyncio.run(scenario())


def test_expired_challenge_cannot_be_confirmed_and_returns_to_verification(monkeypatch):
    async def scenario():
        expired = _record(challenge={
            "id": "challenge-1",
            "method": "nexus_app",
            "method_label": "Registered Nexus app",
            "issued_at": (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat(),
            "expires_at": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
        })
        fake_db = _Db(expired)
        monkeypatch.setattr(nexus_verify, "db", fake_db)
        monkeypatch.setattr(nexus_verify, "assert_client_scope", _allow_scope)

        with pytest.raises(HTTPException) as exc:
            await nexus_verify.confirm_identity(
                "verify-1",
                {"method": "nexus_app", "evidence_ref": "A meaningful evidence reference"},
                _user(),
            )

        assert exc.value.status_code == 410
        stored = fake_db.nexus_verify_requests.rows[0]
        assert stored["status"] == "awaiting_verification"
        assert stored["challenge"] is None

    asyncio.run(scenario())


def test_factor_verifier_cannot_self_approve_even_when_authorised():
    record = _record(
        status="awaiting_approval",
        verification={
            "status": "verified",
            "factors": [{"verified_by_id": "tech-verify", "verified_by": "Morgan Verifier"}],
        },
    )

    assert nexus_verify._may_approve_sensitive_request(record, {
        "id": "tech-verify",
        "name": "Morgan Verifier",
        "role": "admin",
    }) is False


def test_verify_request_requires_an_existing_scoped_client(monkeypatch):
    class _NoClientCollection:
        async def find_one(self, *_args, **_kwargs):
            return None

    async def scenario():
        monkeypatch.setattr(nexus_verify, "db", SimpleNamespace(clients=_NoClientCollection()))
        monkeypatch.setattr(nexus_verify, "assert_client_scope", _allow_scope)

        with pytest.raises(HTTPException) as exc:
            await nexus_verify.create_request(
                {"client_id": "client-missing", "subject_name": "Sarah Jones", "action_type": "mfa_reset"},
                _user(),
            )

        assert exc.value.status_code == 404
        assert exc.value.detail == "Client not found"

    asyncio.run(scenario())


def test_microsoft_verify_request_records_a_stable_target_not_a_display_name(monkeypatch):
    async def scenario():
        fake_db = SimpleNamespace(
            clients=_Rows([{"id": "client-1", "name": "Client One"}]),
            nexus_verify_requests=_Rows(),
            nexus_verify_audit=_Rows(),
        )
        monkeypatch.setattr(nexus_verify, "db", fake_db)
        monkeypatch.setattr(nexus_verify, "assert_client_scope", _allow_scope)

        response = await nexus_verify.create_request(
            {
                "client_id": "client-1",
                "subject_name": "Sarah Jones",
                "action_type": "password_reset",
                "provider_target": {
                    "provider": "microsoft_entra",
                    "tenant_id": "ENTRA-TENANT-A",
                    "provider_user_id": "PROVIDER-USER-A",
                    "user_principal_name": "Sarah.Jones@Example.Test",
                },
            },
            _user(),
        )

        assert response["request"]["subject_name"] == "Sarah Jones"
        assert response["request"]["subject_email"] == "sarah.jones@example.test"
        assert response["request"]["provider_target"] == {
            "provider": "microsoft_entra",
            "tenant_id": "entra-tenant-a",
            "provider_user_id": "provider-user-a",
            "user_principal_name": "sarah.jones@example.test",
        }
        assert fake_db.nexus_verify_requests.rows[0]["provider_target"] == response["request"]["provider_target"]

    asyncio.run(scenario())


def test_microsoft_verify_request_rejects_a_subject_email_for_another_user(monkeypatch):
    async def scenario():
        fake_db = SimpleNamespace(
            clients=_Rows([{"id": "client-1", "name": "Client One"}]),
            nexus_verify_requests=_Rows(),
            nexus_verify_audit=_Rows(),
        )
        monkeypatch.setattr(nexus_verify, "db", fake_db)
        monkeypatch.setattr(nexus_verify, "assert_client_scope", _allow_scope)

        with pytest.raises(HTTPException) as exc:
            await nexus_verify.create_request(
                {
                    "client_id": "client-1",
                    "subject_name": "Sarah Jones",
                    "subject_email": "other@example.test",
                    "action_type": "password_reset",
                    "provider_target": {
                        "provider": "microsoft_entra",
                        "tenant_id": "entra-tenant-a",
                        "provider_user_id": "provider-user-a",
                        "user_principal_name": "sarah@example.test",
                    },
                },
                _user(),
            )

        assert exc.value.status_code == 400
        assert "must match" in exc.value.detail

    asyncio.run(scenario())
