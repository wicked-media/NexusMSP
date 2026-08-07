"""Governance guardrails for client-linked Voice extension overrides."""

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import recurring_invoices, yeastar  # noqa: E402


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]
        self.updated = []

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return dict(row)
        return None

    async def update_one(self, query, update, upsert=False):
        changes = dict(update.get("$set") or {})
        self.updated.append((dict(query), changes, upsert))
        existing = next((row for row in self.rows if all(row.get(key) == value for key, value in query.items())), None)
        if existing:
            existing.update(changes)
        elif upsert:
            self.rows.append(changes)
        return SimpleNamespace(modified_count=1)


class FakeDb:
    def __init__(self):
        self.yeastar_extension_overrides = FakeCollection()
        self.yeastar_pbxs = FakeCollection([
            {"id": "pbx-1", "name": "Main PBX", "client_id": "client-1"},
        ])


def test_extension_override_requires_technician_justification(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(yeastar, "db", fake_db)

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(yeastar.update_yeastar_extension_override(
            "100",
            {"extension_key": "pbx-1:100", "exclude_from_billing": True},
            current_user={"id": "tech-1", "name": "Test Technician"},
        ))

    assert rejected.value.status_code == 400
    assert "justification" in rejected.value.detail.lower()
    assert fake_db.yeastar_extension_overrides.updated == []


def test_extension_override_records_reason_state_and_activity(monkeypatch):
    fake_db = FakeDb()
    activity = []

    async def capture_activity(*args, **kwargs):
        activity.append((args, kwargs))

    monkeypatch.setattr(yeastar, "db", fake_db)
    monkeypatch.setattr(yeastar, "log_activity", capture_activity)

    result = asyncio.run(yeastar.update_yeastar_extension_override(
        "100",
        {
            "extension_key": "pbx-1:100",
            "exclude_from_billing": True,
            "exclusion_reason": "Approved test handset",
            "change_reason": "Approved test handset",
        },
        current_user={"id": "tech-1", "name": "Test Technician", "email": "tech@example.test"},
    ))

    assert result["exclude_from_billing"] is True
    assert result["change_reason"] == "Approved test handset"
    assert result["updated_by"] == "tech@example.test"
    assert activity[0][0][1] == "voice_extension_override_updated"
    assert activity[0][1]["changes"]["included_in_billing"] == {"before": True, "after": False}
    assert activity[0][1]["metadata"]["client_id"] == "client-1"


def test_disabling_extension_records_billing_impact(monkeypatch):
    fake_db = FakeDb()
    activity = []

    async def capture_activity(*args, **kwargs):
        activity.append((args, kwargs))

    monkeypatch.setattr(yeastar, "db", fake_db)
    monkeypatch.setattr(yeastar, "log_activity", capture_activity)

    asyncio.run(yeastar.update_yeastar_extension_override(
        "101",
        {
            "extension_key": "pbx-1:101",
            "enabled": False,
            "change_reason": "Extension retired after staff departure",
        },
        current_user={"id": "tech-1", "name": "Test Technician", "email": "tech@example.test"},
    ))

    assert activity[0][1]["changes"]["enabled"] == {"before": True, "after": False}
    assert activity[0][1]["changes"]["included_in_billing"] == {"before": True, "after": False}


def test_recurring_billing_preserves_yeastar_source_provenance(monkeypatch):
    async def billing(_client_id, current_user=None):
        return {
            "linked": True,
            "billing_ready": True,
            "period": "2026-08",
            "currency": "AUD",
            "line_items": [{
                "pbx_id": "pbx-1",
                "pbx_name": "Main PBX",
                "product_id": "product-extension",
                "quantity": 12,
                "unit_price": 18.5,
                "total": 222.0,
            }],
        }

    monkeypatch.setattr(yeastar, "get_client_yeastar_billing", billing)
    lines = asyncio.run(recurring_invoices._resolve_yeastar_usage_lines(
        {"client_id": "client-1", "include_yeastar_usage": True},
        {"id": "admin-1", "is_admin": True},
    ))

    assert lines[0]["quantity"] == 12
    assert lines[0]["amount"] == 222.0
    assert lines[0]["yeastar_pbx_id"] == "pbx-1"
    assert lines[0]["yeastar_product_id"] == "product-extension"
    assert lines[0]["yeastar_period"] == "2026-08"


def test_recurring_billing_fails_closed_when_yeastar_cannot_reconcile(monkeypatch):
    async def billing(_client_id, current_user=None):
        return {
            "linked": True,
            "billing_ready": False,
            "missing_mappings": [{"pbx_name": "Main PBX"}],
        }

    monkeypatch.setattr(yeastar, "get_client_yeastar_billing", billing)
    with pytest.raises(HTTPException) as blocked:
        asyncio.run(recurring_invoices._resolve_yeastar_usage_lines(
            {"client_id": "client-1", "include_yeastar_usage": True},
            {"id": "admin-1", "is_admin": True},
        ))

    assert blocked.value.status_code == 409
    assert "Main PBX" in blocked.value.detail
