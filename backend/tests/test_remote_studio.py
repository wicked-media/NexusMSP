"""Session Studio policy and boundary tests.

The Session Studio makes Nexus Remote customisable per technician and adaptive
to real usage. These tests pin the pure adaptation policy (preset whitelisting,
adaptive ordering, bounded evidence-based suggestions) and the router boundary
(tenant- and user-scoped preferences, per-tool counters, explainable insights).
"""

import asyncio

import pytest
from pydantic import ValidationError

from app.routers import remote_studio as studio
from app.services.remote_studio import (
    DEFAULT_PREFERENCES,
    REMOTE_TOOLS,
    derive_suggestions,
    maturity_label,
    normalise_preferences,
    order_quick_actions,
)
from app.routers.remote_studio import RemoteStudioPreferences, RemoteStudioUsageEvent


class _Result:
    def __init__(self, matched_count=0):
        self.matched_count = matched_count


def _matches(row, query):
    for key, expected in query.items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _Rows:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set") or {})
                for field, amount in (update.get("$inc") or {}).items():
                    row[field] = int(row.get(field) or 0) + int(amount)
                return _Result(1)
        if upsert:
            new_row = dict(update.get("$set") or {})
            for field, amount in (update.get("$inc") or {}).items():
                new_row[field] = int(amount)
            self.rows.append(new_row)
            return _Result(1)
        return _Result(0)

    async def insert_one(self, document):
        self.rows.append(dict(document))

    def find(self, query, _projection=None):
        matched = [dict(row) for row in self.rows if _matches(row, query)]
        return _Cursor(matched)

    async def count_documents(self, query):
        return sum(1 for row in self.rows if _matches(row, query))


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self._rows)


def _user(user_id="tech-1", tenant="tenant-a"):
    return {"id": user_id, "tenant_id": tenant, "name": "Studio Tech", "email": f"{user_id}@example.com", "is_admin": True}


class _Db:
    def __init__(self):
        self.remote_studio_preferences = _Rows()
        self.remote_studio_usage = _Rows()


def _install_db(monkeypatch, db):
    monkeypatch.setattr(studio, "db", db)


# ── pure policy ──────────────────────────────────────────────────────────────


def test_normalise_preferences_whitelists_and_clamps():
    cleaned = normalise_preferences({
        "preset": "pro",
        "panels": {"evidence": False, "files": True, "timeline": True, "injected": True},
        "density": "compact",
        "default_mode": "control",
        "default_display": "primary",
        "quick_actions": ["full_screen", "full_screen", "nonsense", "fit"],
        "unexpected": "dropped",
    })
    assert cleaned["preset"] == "pro"
    assert cleaned["panels"] == {"evidence": False, "files": True, "timeline": True}
    assert cleaned["default_mode"] == "control"
    assert cleaned["quick_actions"] == ["full_screen", "fit"]
    assert "unexpected" not in cleaned

    fallback = normalise_preferences({"preset": "nope", "density": "nope"})
    assert fallback == DEFAULT_PREFERENCES


def test_order_quick_actions_adapts_by_usage_then_catalogue_order():
    usage = {"fit": 3, "file_send": 9}
    ordered = order_quick_actions(["fit", "file_send", "zoom_in", "fit", "unknown"], usage)
    assert ordered == ["file_send", "fit", "zoom_in"]


def test_maturity_and_suggestions_are_bounded_and_evidence_based():
    assert maturity_label(0)["level"] == "learning"
    assert maturity_label(12)["level"] == "adapting"
    assert maturity_label(60)["level"] == "tuned"

    counts = {"file_browse": 3, "file_send": 3, "display_focus": 4, "start_control": 3, "start_view": 1}
    suggestions = derive_suggestions(counts, {"events": 14})
    assert 1 <= len(suggestions) <= 4
    assert {item["action"] for item in suggestions} & {"pin_files", "default_primary", "default_control"}
    assert all(item["text"] for item in suggestions)


# ── router boundary ──────────────────────────────────────────────────────────


def test_usage_payload_rejects_unknown_tools():
    with pytest.raises(ValidationError):
        RemoteStudioUsageEvent(tool="run_arbitrary_code")


def test_preferences_round_trip_is_tenant_and_user_scoped(monkeypatch):
    db = _Db()
    _install_db(monkeypatch, db)
    payload = RemoteStudioPreferences(preset="pro", panels={"evidence": False, "files": True, "timeline": True})

    saved = asyncio.run(studio.put_remote_studio_preferences(payload, current_user=_user()))
    assert saved["preset"] == "pro"

    mine = asyncio.run(studio.get_remote_studio_preferences(current_user=_user()))
    assert mine["preset"] == "pro" and mine["panels"]["evidence"] is False

    other_user = asyncio.run(studio.get_remote_studio_preferences(current_user=_user(user_id="tech-2")))
    assert other_user == DEFAULT_PREFERENCES

    other_tenant = asyncio.run(studio.get_remote_studio_preferences(current_user=_user(tenant="tenant-b")))
    assert other_tenant == DEFAULT_PREFERENCES


def test_usage_counters_drive_adaptive_insights(monkeypatch):
    db = _Db()
    _install_db(monkeypatch, db)
    user = _user()

    for tool in ["file_send", "file_send", "file_browse", "file_browse", "file_retrieve", "fit"]:
        asyncio.run(studio.record_remote_studio_usage(
            RemoteStudioUsageEvent(tool=tool, session_id="sess-1", mode="control"),
            current_user=user,
        ))

    insights = asyncio.run(studio.get_remote_studio_insights(current_user=user))
    assert insights["usage_counts"]["file_send"] == 2
    assert insights["usage_counts"]["file_browse"] == 2
    assert insights["event_total"] == 6
    assert insights["maturity"]["level"] == "learning"
    assert insights["quick_action_order"][0] in {"file_send", "file_browse"}
    assert any(item["action"] == "pin_files" for item in insights["suggestions"])

    isolated = asyncio.run(studio.get_remote_studio_insights(current_user=_user(user_id="tech-2")))
    assert isolated["event_total"] == 0
    assert isolated["quick_action_order"] == list(REMOTE_TOOLS)
