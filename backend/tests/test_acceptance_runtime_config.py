from __future__ import annotations

import pytest

from app.services import runtime_config


def test_acceptance_runtime_rejects_non_disposable_database(monkeypatch):
    monkeypatch.setenv("NEXUS_TEST_ENVIRONMENT", "1")

    with pytest.raises(RuntimeError, match="nexus_acceptance_"):
        runtime_config.validate_runtime_database_name("nexusops")


def test_acceptance_runtime_allows_reserved_database_prefix(monkeypatch):
    monkeypatch.setenv("NEXUS_TEST_ENVIRONMENT", "true")

    assert runtime_config.validate_runtime_database_name("nexus_acceptance_abc123") == "nexus_acceptance_abc123"
    assert runtime_config.dotenv_loading_enabled() is False


def test_normal_runtime_keeps_existing_dotenv_loading_behaviour(monkeypatch):
    monkeypatch.delenv("NEXUS_TEST_ENVIRONMENT", raising=False)

    assert runtime_config.dotenv_loading_enabled() is True


def test_development_preserves_default_demo_seed_behaviour(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("NEXUS_TEST_ENVIRONMENT", raising=False)
    monkeypatch.delenv("NEXUS_SEED_DEMO_DATA", raising=False)

    assert runtime_config.demo_seed_enabled() is True


@pytest.mark.parametrize(
    ("configured_value", "expected"),
    [("true", True), ("false", False)],
)
def test_development_demo_seed_gate_is_explicitly_controllable(monkeypatch, configured_value, expected):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NEXUS_SEED_DEMO_DATA", configured_value)
    monkeypatch.delenv("NEXUS_TEST_ENVIRONMENT", raising=False)

    assert runtime_config.demo_seed_enabled() is expected


@pytest.mark.parametrize("environment", ["test", "testing", "production"])
def test_test_and_production_runtimes_never_seed_demo_data(monkeypatch, environment):
    monkeypatch.setenv("APP_ENV", environment)
    monkeypatch.setenv("NEXUS_SEED_DEMO_DATA", "true")
    monkeypatch.delenv("NEXUS_TEST_ENVIRONMENT", raising=False)

    assert runtime_config.demo_seed_enabled() is False


def test_explicit_acceptance_flag_disables_demo_data(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NEXUS_TEST_ENVIRONMENT", "yes")
    monkeypatch.setenv("NEXUS_SEED_DEMO_DATA", "true")

    assert runtime_config.demo_seed_enabled() is False
