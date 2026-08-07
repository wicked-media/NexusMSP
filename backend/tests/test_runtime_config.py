import pytest

from app.services import runtime_config


def test_development_cors_defaults_to_local_origins(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.setenv("APP_ENV", "development")

    origins = runtime_config.cors_origins()

    assert "*" not in origins
    assert "http://localhost:3000" in origins


def test_production_requires_explicit_non_wildcard_cors(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    with pytest.raises(RuntimeError, match="required"):
        runtime_config.cors_origins()

    monkeypatch.setenv("CORS_ORIGINS", "*")
    with pytest.raises(RuntimeError, match="Wildcard"):
        runtime_config.cors_origins()


def test_background_workers_default_off_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("NEXUS_RUN_BACKGROUND_WORKERS", raising=False)
    assert runtime_config.background_workers_enabled() is False

    monkeypatch.setenv("NEXUS_RUN_BACKGROUND_WORKERS", "true")
    assert runtime_config.background_workers_enabled() is True
