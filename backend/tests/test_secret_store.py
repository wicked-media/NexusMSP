import pytest

from app.services import secret_store
from app.services.secret_store import decrypt_secret, encrypt_secret, mask_secret
from app.routers.ai_service import _connection_from_config


def test_secret_round_trip_is_encrypted_at_rest():
    secret = "sk-proj-example-secret-value-1234"
    encrypted = encrypt_secret(secret)

    assert encrypted
    assert encrypted != secret
    assert secret not in encrypted
    assert decrypt_secret(encrypted) == secret


def test_invalid_ciphertext_never_returns_a_secret():
    assert decrypt_secret("not-a-valid-fernet-token") == ""


def test_secret_mask_only_exposes_a_fingerprint():
    secret = "sk-proj-example-secret-value-1234"
    masked = mask_secret(secret)

    assert masked.startswith("sk-proj")
    assert masked.endswith("1234")
    assert secret not in masked


def test_ai_connection_payload_never_returns_the_stored_key():
    secret = "sk-proj-example-secret-value-5678"
    connection = _connection_from_config({
        "openai_api_key_encrypted": encrypt_secret(secret),
        "openai_key_label": "NexusMSP production",
    })

    assert connection["configured"] is True
    assert connection["method"] == "encrypted_settings"
    assert connection["key_label"] == "NexusMSP production"
    assert connection["key_preview"].endswith("5678")
    assert secret not in str(connection)
    assert "openai_api_key_encrypted" not in connection


def test_production_requires_a_dedicated_encryption_key(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("NEXUS_SECRET_ENCRYPTION_KEY", raising=False)

    with pytest.raises(RuntimeError, match="required in production"):
        secret_store.encrypt_secret("sensitive")
