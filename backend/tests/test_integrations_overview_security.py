"""Regression coverage for tenant-owned integration status tiles."""

from __future__ import annotations

import os
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import integrations_overview  # noqa: E402


def test_site_manager_status_is_hidden_from_non_owner_tenants():
    settings = {
        "site_manager_tenant_id": "tenant-a",
        "site_manager_api_key_encrypted": "ciphertext",
        "site_manager_last_synced_at": "2026-08-26T00:00:00+00:00",
    }

    assert integrations_overview._visible_site_manager_settings(settings, {"tenant_id": "tenant-b"}) == {}
    assert integrations_overview._visible_site_manager_settings(settings, {"tenant_id": "tenant-a"}) == settings
    assert integrations_overview._visible_site_manager_settings(settings, {}) == settings
