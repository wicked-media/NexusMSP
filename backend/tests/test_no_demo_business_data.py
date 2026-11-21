"""Empty reads must stay empty: NexusMSP never manufactures business records."""

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import (  # noqa: E402
    ai_resolution,
    alert_suppression,
    dns_monitor,
    mission_control,
    onboarding,
    self_healing,
    vendors,
)


class _EmptyCursor:
    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return []


class _EmptyCollection:
    def __init__(self):
        self.insert_attempts = 0

    def find(self, *_args, **_kwargs):
        return _EmptyCursor()

    async def insert_one(self, _document):
        self.insert_attempts += 1
        raise AssertionError("An empty read must never insert a fabricated record")

    async def insert_many(self, _documents):
        self.insert_attempts += 1
        raise AssertionError("An empty read must never insert fabricated records")

    async def update_one(self, *_args, **_kwargs):
        self.insert_attempts += 1
        raise AssertionError("An empty read must never upsert a fabricated record")


def _install(monkeypatch, module, collection_name):
    collection = _EmptyCollection()
    monkeypatch.setattr(module, "db", SimpleNamespace(**{collection_name: collection}))
    return collection


def test_empty_vendor_directory_stays_empty(monkeypatch):
    collection = _install(monkeypatch, vendors, "vendors")
    assert asyncio.run(vendors.get_vendors(current_user={})) == []
    assert collection.insert_attempts == 0


def test_empty_domain_monitor_stays_empty(monkeypatch):
    collection = _install(monkeypatch, dns_monitor, "dns_domains")
    assert asyncio.run(dns_monitor.get_monitored_domains(current_user={})) == []
    assert collection.insert_attempts == 0


def test_empty_suppression_policy_list_stays_empty(monkeypatch):
    collection = _install(monkeypatch, alert_suppression, "alert_suppression_rules")
    assert asyncio.run(alert_suppression.get_suppression_rules(current_user={})) == []
    assert collection.insert_attempts == 0


def test_empty_runbook_library_stays_empty(monkeypatch):
    collection = _install(monkeypatch, self_healing, "healing_runbooks")
    assert asyncio.run(self_healing.list_runbooks(current_user={})) == []
    assert collection.insert_attempts == 0


def test_empty_ai_resolution_queue_reports_zero_not_sample_issues(monkeypatch):
    collection = _install(monkeypatch, ai_resolution, "ai_resolution_queue")
    result = asyncio.run(ai_resolution.get_ai_suggestions(current_user={}))
    assert result["issues"] == []
    assert result["summary"]["total"] == 0
    assert collection.insert_attempts == 0


def test_empty_onboarding_pipeline_reports_zero(monkeypatch):
    collection = _install(monkeypatch, onboarding, "onboarding_workflows")
    result = asyncio.run(onboarding.list_onboarding_workflows(current_user={}))
    assert result["workflows"] == []
    assert result["summary"]["total"] == 0
    assert collection.insert_attempts == 0


def test_empty_estate_health_is_not_assessed():
    assert mission_control._estate_health(0, 0, 0, 0) == (None, "Not assessed")
    assert mission_control._estate_health(3, 0, 0, 0) == (100, "Healthy")
    assert mission_control._estate_health(3, 0, 2, 0)[0] == 86


@pytest.mark.parametrize(
    "module_name",
    [
        "seed",
        "demo_data",
    ],
)
def test_no_startup_sample_data_module_can_be_imported(module_name):
    import importlib

    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(f"app.services.{module_name}")
