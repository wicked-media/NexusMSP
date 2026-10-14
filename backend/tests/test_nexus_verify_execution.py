import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services import nexus_verify_execution
from app.services.nexus_verify_execution import validation_error


def _record(**overrides):
    base = {
        "id": "verify-1", "client_id": "client-1", "action_type": "password_reset", "status": "ready_to_execute",
        "required_factors": 1,
        "verification": {
            "status": "verified",
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
            "factor_count": 1,
            "execution_eligible": True,
        },
    }
    base.update(overrides)
    return base


def test_verified_request_allows_matching_in_scope_action():
    assert validation_error(_record(), client_id="client-1", action_type="password_reset") is None


def test_verify_gate_rejects_cross_client_or_wrong_action():
    assert "required for this customer" in validation_error(_record(), client_id="client-2", action_type="password_reset")
    assert "does not cover" in validation_error(_record(), client_id="client-1", action_type="offboarding")


def test_verify_gate_rejects_expired_or_unready_proof():
    expired = _record(verification={"status": "verified", "execution_eligible": True, "factor_count": 1, "expires_at": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()})
    assert "expired" in validation_error(expired, client_id="client-1", action_type="password_reset")
    assert "current identity proof" in validation_error(_record(status="awaiting_approval"), client_id="client-1", action_type="password_reset")


def test_verify_gate_rejects_attested_or_incomplete_proof_for_provider_execution():
    attested = _record(verification={
        "status": "verified",
        "factor_count": 1,
        "execution_eligible": False,
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
    })
    assert "connector-verified" in validation_error(attested, client_id="client-1", action_type="password_reset")

    incomplete = _record(
        required_factors=2,
        verification={
            "status": "verified",
            "factor_count": 1,
            "execution_eligible": True,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        },
    )
    assert "every required identity factor" in validation_error(incomplete, client_id="client-1", action_type="password_reset")


def test_microsoft_provider_execution_requires_an_exact_server_bound_target():
    record = _record(provider_target={
        "provider": "microsoft_entra",
        "tenant_id": "entra-tenant-a",
        "provider_user_id": "provider-user-a",
        "user_principal_name": "sarah@example.test",
    })
    exact_target = {
        "provider": "microsoft_entra",
        "tenant_id": "ENTRA-TENANT-A",
        "provider_user_id": "PROVIDER-USER-A",
    }

    assert validation_error(
        record,
        client_id="client-1",
        action_type="password_reset",
        provider_target=exact_target,
    ) is None
    assert "Microsoft target" in validation_error(
        record,
        client_id="client-1",
        action_type="password_reset",
        provider_target={**exact_target, "tenant_id": "entra-tenant-b"},
    )
    assert "Microsoft target" in validation_error(
        record,
        client_id="client-1",
        action_type="password_reset",
        provider_target={**exact_target, "provider_user_id": "provider-user-b"},
    )


def test_non_microsoft_verify_workflows_remain_compatible_without_a_provider_target():
    assert validation_error(_record(), client_id="client-1", action_type="password_reset") is None


def test_provider_reservation_rechecks_the_exact_target_in_its_atomic_write(monkeypatch):
    record = _record(provider_target={
        "provider": "microsoft_entra",
        "tenant_id": "entra-tenant-a",
        "provider_user_id": "provider-user-a",
        "user_principal_name": "sarah@example.test",
    })

    class Requests:
        def __init__(self):
            self.query = None
            self.update = None

        async def find_one(self, *_args, **_kwargs):
            return dict(record)

        async def update_one(self, query, update):
            self.query = query
            self.update = update
            return SimpleNamespace(matched_count=1)

    class Audit:
        async def insert_one(self, _document):
            return None

    requests = Requests()
    monkeypatch.setattr(nexus_verify_execution, "db", SimpleNamespace(
        nexus_verify_requests=requests,
        nexus_verify_audit=Audit(),
    ))

    async def scenario():
        return await nexus_verify_execution.begin_verified_execution(
            "verify-1",
            client_id="client-1",
            action_type="password_reset",
            actor={"id": "tech-1", "name": "Alex"},
            target="Microsoft tenant entra-tenant-a user provider-user-a",
            provider_target={
                "provider": "microsoft_entra",
                "tenant_id": "entra-tenant-a",
                "provider_user_id": "provider-user-a",
            },
        )

    completed = asyncio.run(scenario())

    assert completed["id"] == "verify-1"
    assert requests.query == {
        "id": "verify-1",
        "status": "ready_to_execute",
        "provider_target.provider": "microsoft_entra",
        "provider_target.tenant_id": "entra-tenant-a",
        "provider_target.provider_user_id": "provider-user-a",
    }
    assert requests.update["$set"]["execution"]["provider_target"] == {
        "provider": "microsoft_entra",
        "tenant_id": "entra-tenant-a",
        "provider_user_id": "provider-user-a",
    }
