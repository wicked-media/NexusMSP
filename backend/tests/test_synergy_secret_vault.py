"""Regression coverage for Synergy's shared Nexus secret-vault boundary."""

import asyncio
import json
from types import SimpleNamespace

from cryptography.fernet import Fernet

from app.routers import web_studio
from app.services import synergy_wholesale
from app.services.secret_store import decrypt_secret, encrypt_secret


def test_synergy_action_parameters_use_the_shared_vault_without_a_legacy_key(
    monkeypatch,
):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("SYNERGY_ACTION_ENCRYPTION_KEY", raising=False)

    parameters = {"domain": "example.com.au", "years": 1}
    encrypted = synergy_wholesale.seal_action_parameters(parameters)

    assert encrypted
    assert "example.com.au" not in encrypted
    assert synergy_wholesale.unseal_action_parameters(encrypted) == parameters


def test_synergy_action_parameters_can_read_a_legacy_envelope(monkeypatch):
    legacy_key = Fernet.generate_key()
    monkeypatch.setenv("SYNERGY_ACTION_ENCRYPTION_KEY", legacy_key.decode())
    encrypted = Fernet(legacy_key).encrypt(
        json.dumps({"domain": "example.com.au"}).encode()
    ).decode()

    assert synergy_wholesale.unseal_action_parameters(encrypted) == {
        "domain": "example.com.au"
    }


def test_legacy_synergy_settings_credential_remains_readable(monkeypatch):
    class Settings:
        async def find_one(self, *_args, **_kwargs):
            return {
                "value": {
                    "reseller_id": "reseller-123",
                    "wsdl": "https://example.com/synergy.wsdl",
                    "api_key_encrypted": encrypted,
                }
            }

    legacy_key = Fernet.generate_key()
    monkeypatch.setenv("SYNERGY_ACTION_ENCRYPTION_KEY", legacy_key.decode())
    encrypted = Fernet(legacy_key).encrypt(
        json.dumps({"api_key": "legacy-synergy-key"}).encode()
    ).decode()
    monkeypatch.setattr(web_studio, "db", SimpleNamespace(settings=Settings()))

    assert asyncio.run(web_studio._synergy_credentials()) == {
        "reseller_id": "reseller-123",
        "wsdl": "https://example.com/synergy.wsdl",
        "api_key": "legacy-synergy-key",
    }


def test_synergy_settings_save_uses_the_shared_vault_without_a_second_key(
    monkeypatch,
):
    class Settings:
        def __init__(self):
            self.update = None

        async def update_one(self, _query, update, upsert=False):
            self.update = {"update": update, "upsert": upsert}

    settings = Settings()
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("SYNERGY_ACTION_ENCRYPTION_KEY", raising=False)
    monkeypatch.setattr(web_studio, "db", SimpleNamespace(settings=settings))

    async def allow_global_scope(*_args, **_kwargs):
        return None

    async def configured_status():
        return {"configured": True, "readiness": "ready"}

    monkeypatch.setattr(web_studio, "assert_global_scope", allow_global_scope)
    monkeypatch.setattr(web_studio, "_integration_status", configured_status)

    api_key = "synergy-test-api-key"
    result = asyncio.run(
        web_studio.save_synergy_settings(
            web_studio.SynergyIntegrationInput(
                reseller_id="reseller-123",
                api_key=api_key,
                wsdl="https://example.com/synergy.wsdl",
            ),
            {"id": "admin-1", "email": "admin@example.com"},
        )
    )

    value = settings.update["update"]["$set"]["value"]
    assert result["saved"] is True
    assert value["api_key_encryption_version"] == "nexus_secret_v1"
    assert value["api_key_encrypted"] != api_key
    assert api_key not in str(value)
    assert decrypt_secret(value["api_key_encrypted"]) == api_key
    assert web_studio._open_synergy_api_key(value["api_key_encrypted"]) == api_key


def test_synergy_settings_save_requires_the_shared_vault_in_production(
    monkeypatch,
):
    class Settings:
        def __init__(self):
            self.updated = False

        async def update_one(self, *_args, **_kwargs):
            self.updated = True

    settings = Settings()
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("NEXUS_SECRET_ENCRYPTION_KEY", raising=False)
    monkeypatch.setattr(web_studio, "db", SimpleNamespace(settings=settings))

    async def allow_global_scope(*_args, **_kwargs):
        return None

    monkeypatch.setattr(web_studio, "assert_global_scope", allow_global_scope)

    try:
        asyncio.run(
            web_studio.save_synergy_settings(
                web_studio.SynergyIntegrationInput(
                    reseller_id="reseller-123",
                    api_key="synergy-test-api-key",
                    wsdl="https://example.com/synergy.wsdl",
                ),
                {"id": "admin-1"},
            )
        )
    except Exception as error:
        assert getattr(error, "status_code", None) == 503
        assert "secret encryption" in str(getattr(error, "detail", "")).lower()
    else:
        raise AssertionError("Production Synergy settings save unexpectedly succeeded")

    assert not settings.updated
