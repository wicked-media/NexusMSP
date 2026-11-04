"""Technician Web Studio and workspace preference tests.

These pin the canonical settings API: defaults are returned for an untouched
technician, unknown keys are dropped, a stale ``expected_version`` is refused so
one browser tab cannot overwrite another, and — most importantly — profile
preferences can never be used to grant the technician a permission.
"""

import asyncio

import pytest

from app.routers import user_settings


def _matches(row, query):
    for key, expected in query.items():
        if row.get(key) != expected:
            return False
    return True


class _Result:
    def __init__(self, matched_count=0):
        self.matched_count = matched_count


class _Rows:
    def __init__(self):
        self.rows = []

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set") or {})
                return _Result(1)
        if upsert:
            created = {k: v for k, v in query.items() if not isinstance(v, dict)}
            created.update(update.get("$set") or {})
            self.rows.append(created)
            return _Result(1)
        return _Result(0)


class _Db:
    def __init__(self):
        self._tables = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._tables.setdefault(name, _Rows())


def _install(monkeypatch, db):
    monkeypatch.setattr(user_settings, "db", db)
    return db


def _user(user_id="tech-1"):
    return {"id": user_id, "tenant_id": "tenant-a", "name": "Web Tech", "email": f"{user_id}@example.com"}


def test_web_studio_prefs_return_defaults_for_a_new_technician(monkeypatch):
    db = _install(monkeypatch, _Db())
    prefs = asyncio.run(user_settings.get_web_studio_prefs(current_user=_user()))
    assert prefs["default_view"] == "fleet"
    assert prefs["default_update_policy"] == "manual"
    assert prefs["confirm_destructive"] is True
    assert prefs["prefs_version"] == 0


def test_web_studio_prefs_validate_and_persist_with_a_version_bump(monkeypatch):
    db = _install(monkeypatch, _Db())
    saved = asyncio.run(user_settings.update_web_studio_prefs(
        {"default_view": "plugins", "default_update_policy": "assisted", "show_only_attention": True},
        current_user=_user(),
    ))
    assert saved["web_studio_prefs"]["default_view"] == "plugins"
    assert saved["prefs_version"] == 1
    assert db.user_settings.rows[0]["web_studio_prefs"]["default_update_policy"] == "assisted"


def test_web_studio_prefs_reject_unknown_values_and_stale_versions(monkeypatch):
    _install(monkeypatch, _Db())
    with pytest.raises(Exception) as bad_view:
        asyncio.run(user_settings.update_web_studio_prefs({"default_view": "everything"}, current_user=_user()))
    assert "valid Web Studio view" in str(bad_view.value)

    with pytest.raises(Exception) as bad_hours:
        asyncio.run(user_settings.update_web_studio_prefs({"inventory_refresh_hours": 7}, current_user=_user()))
    assert "inventory refresh" in str(bad_hours.value)

    asyncio.run(user_settings.update_web_studio_prefs({"default_view": "fleet"}, current_user=_user()))
    with pytest.raises(Exception) as stale:
        asyncio.run(user_settings.update_web_studio_prefs({"default_view": "plugins", "expected_version": 0}, current_user=_user()))
    assert "changed in another session" in str(stale.value)


def test_workspace_prefs_validate_routes_sizes_and_shortcut_conflicts(monkeypatch):
    _install(monkeypatch, _Db())
    saved = asyncio.run(user_settings.update_workspace_prefs(
        {"landing_route": "/web-studio", "default_page_size": 50, "table_density": "compact",
         "shortcuts": {"command_palette": "Ctrl+K", "new_ticket": "N"}},
        current_user=_user(),
    ))
    assert saved["workspace_prefs"]["landing_route"] == "/web-studio"
    assert saved["workspace_prefs"]["shortcuts"]["new_ticket"] == "N"

    with pytest.raises(Exception) as bad_route:
        asyncio.run(user_settings.update_workspace_prefs({"landing_route": "https://evil.example"}, current_user=_user()))
    assert "landing route" in str(bad_route.value)

    with pytest.raises(Exception) as bad_size:
        asyncio.run(user_settings.update_workspace_prefs({"default_page_size": 7}, current_user=_user()))
    assert "page size" in str(bad_size.value)

    with pytest.raises(Exception) as conflict:
        asyncio.run(user_settings.update_workspace_prefs(
            {"shortcuts": {"command_palette": "Ctrl+K", "search": "ctrl+k"}}, current_user=_user(),
        ))
    assert "already assigned" in str(conflict.value)


def test_preferences_cannot_escalate_privileges_or_store_unknown_keys(monkeypatch):
    db = _install(monkeypatch, _Db())
    # A crafted payload that tries to grant a role is dropped, leaving no known
    # keys, so nothing is written to the user's settings.
    with pytest.raises(Exception) as refused:
        asyncio.run(user_settings.update_web_studio_prefs(
            {"role": "admin", "permissions": {"web_studio": {"approve": True}}}, current_user=_user(),
        ))
    assert "No Web Studio preference values" in str(refused.value)
    assert db.user_settings.rows == []

    with pytest.raises(Exception) as refused_workspace:
        asyncio.run(user_settings.update_workspace_prefs(
            {"is_admin": True}, current_user=_user(),
        ))
    assert "No workspace preference values" in str(refused_workspace.value)
