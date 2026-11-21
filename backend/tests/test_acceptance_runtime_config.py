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


def test_demo_seeding_is_no_longer_a_runtime_capability():
    # Startup sample-data generation was removed entirely; there is no gate to
    # flip and no environment in which NexusMSP manufactures customer records.
    assert not hasattr(runtime_config, "demo_seed_enabled")
