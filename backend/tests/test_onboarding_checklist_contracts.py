"""Contract tests for onboarding checklist template and run policy.

These lock the normalisation, snapshot and completion-state rules that keep
customisable checklists safe: template edits never rewrite historical runs,
required items cannot be silently skipped past, and evidence gates work.
"""

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import os

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services.onboarding_checklists import (  # noqa: E402
    ITEM_TYPES,
    apply_item_update,
    build_run_document,
    build_run_items,
    build_template_document,
    compute_run_progress,
    normalise_items,
    normalise_service_hooks,
    normalise_sections,
    run_status_for_progress,
    template_view,
)

ACTOR = {"id": "user-1", "name": "Ada Lovelace", "email": "ada@example.com"}


def _template_payload(**overrides):
    payload = {
        "name": "New starter: Service Desk",
        "description": "First-week readiness",
        "category": "onboarding",
        "service_ids": ["svc-tier-1"],
        "service_tags": ["m365"],
        "items": [
            {"title": "Sign the handbook", "type": "signoff", "required": True},
            {"title": "Set up MFA", "type": "account", "required": True, "evidence_required": True},
            {"title": "Shadow a shift", "type": "training", "required": False, "points": 50},
        ],
    }
    payload.update(overrides)
    return payload


class TestNormaliseItems:
    def test_items_get_stable_ids_and_positions(self):
        items = normalise_items([{"title": "A"}, {"title": "B"}])
        assert [item["position"] for item in items] == [0, 1]
        assert items[0]["id"] != items[1]["id"]

    def test_rejects_unknown_item_type(self):
        with pytest.raises(HTTPException) as exc:
            normalise_items([{"title": "A", "type": "teleport"}])
        assert exc.value.status_code == 400

    def test_all_documented_types_are_accepted(self):
        items = normalise_items([{"title": t, "type": t} for t in sorted(ITEM_TYPES)])
        assert len(items) == len(ITEM_TYPES)

    def test_rejects_missing_title(self):
        with pytest.raises(HTTPException):
            normalise_items([{"title": "   "}])

    def test_rejects_duplicate_ids(self):
        with pytest.raises(HTTPException):
            normalise_items([{"title": "A", "id": "same"}, {"title": "B", "id": "same"}])

    def test_points_are_clamped(self):
        items = normalise_items([{"title": "A", "points": 999_999}])
        assert items[0]["points"] == 10_000

    def test_rejects_too_many_items(self):
        with pytest.raises(HTTPException):
            normalise_items([{"title": f"item {i}"} for i in range(201)])


class TestSectionsAndHooks:
    def test_sections_get_ordered_ids(self):
        sections = normalise_sections([{"title": "HR"}, {"title": "Tools"}])
        assert [s["position"] for s in sections] == [0, 1]

    def test_section_title_required(self):
        with pytest.raises(HTTPException):
            normalise_sections([{"title": ""}])

    def test_unknown_section_reference_rejected(self):
        payload = _template_payload(items=[{"title": "A", "section_id": "ghost"}])
        with pytest.raises(HTTPException) as exc:
            build_template_document(payload, tenant_id="t1", actor=ACTOR)
        assert exc.value.status_code == 400

    def test_service_hooks_normalised_sorted(self):
        service_ids, tags = normalise_service_hooks({
            "service_ids": ["b", "a", "a", ""],
            "service_tags": ["m365", " m365 "],
        })
        assert service_ids == ["a", "b"]
        assert tags == ["m365"]


class TestTemplateDocument:
    def test_template_is_tenant_bound_with_version(self):
        doc = build_template_document(_template_payload(), tenant_id="tenant-9", actor=ACTOR)
        assert doc["tenant_id"] == "tenant-9"
        assert doc["version"] == 1
        assert doc["status"] == "active"
        assert len(doc["items"]) == 3

    def test_template_view_strips_mongo_id(self):
        doc = build_template_document(_template_payload(), tenant_id="t1", actor=ACTOR)
        doc["_id"] = "leak"
        assert "_id" not in template_view(doc)

    def test_name_required(self):
        with pytest.raises(HTTPException):
            build_template_document({"name": " "}, tenant_id="t1", actor=ACTOR)


class TestRunLifecycle:
    def test_run_snapshots_template_items(self):
        template = build_template_document(_template_payload(), tenant_id="t1", actor=ACTOR)
        run = build_run_document(template, tenant_id="t1", actor=ACTOR, payload={"technician_id": "tech-1"})
        assert run["template_id"] == template["id"]
        assert run["template_version"] == 1
        assert len(run["items"]) == 3
        assert run["status"] == "not_started"
        # Snapshot independence: renaming the template item must not change the run.
        template["items"][0]["title"] = "Renamed"
        assert run["items"][0]["title"] == "Sign the handbook"

    def test_progress_math(self):
        items = build_run_items([
            {"id": "a", "title": "A", "required": True},
            {"id": "b", "title": "B", "required": False},
        ])
        progress = compute_run_progress(items)
        assert progress == {
            "total": 2, "required": 1, "completed": 0,
            "completed_required": 0, "skipped_required": 0, "percent": 0.0,
        }

    def test_status_transitions(self):
        items = build_run_items([
            {"id": "a", "title": "A", "required": True},
            {"id": "b", "title": "B", "required": False},
        ])
        assert run_status_for_progress(compute_run_progress(items)) == "not_started"
        items[1]["status"] = "completed"
        assert run_status_for_progress(compute_run_progress(items)) == "in_progress"
        items[0]["status"] = "completed"
        assert run_status_for_progress(compute_run_progress(items)) == "completed"

    def test_skipped_required_keeps_run_blocked(self):
        items = build_run_items([
            {"id": "a", "title": "A", "required": True},
            {"id": "b", "title": "B", "required": False},
        ])
        items[0]["status"] = "skipped"
        items[1]["status"] = "completed"
        assert run_status_for_progress(compute_run_progress(items)) == "blocked"


class TestItemUpdates:
    def _run(self):
        template = build_template_document(_template_payload(), tenant_id="t1", actor=ACTOR)
        return build_run_document(template, tenant_id="t1", actor=ACTOR, payload={})

    def test_complete_simple_item(self):
        run = self._run()
        updated = apply_item_update(run, run["items"][0]["item_id"], {"status": "completed"}, actor=ACTOR)
        assert updated["items"][0]["completed_by"] == "user-1"
        assert updated["progress"]["completed"] == 1

    def test_evidence_required_item_blocks_bare_completion(self):
        run = self._run()
        evidence_item = run["items"][1]
        with pytest.raises(HTTPException) as exc:
            apply_item_update(run, evidence_item["item_id"], {"status": "completed"}, actor=ACTOR)
        assert exc.value.status_code == 400
        updated = apply_item_update(
            run, evidence_item["item_id"],
            {"status": "completed", "evidence": {"value": "screenshot.png"}},
            actor=ACTOR,
        )
        assert updated["items"][1]["status"] == "completed"

    def test_unknown_item_rejected(self):
        run = self._run()
        with pytest.raises(HTTPException) as exc:
            apply_item_update(run, "ghost", {"status": "completed"}, actor=ACTOR)
        assert exc.value.status_code == 404

    def test_invalid_status_rejected(self):
        run = self._run()
        with pytest.raises(HTTPException):
            apply_item_update(run, run["items"][0]["item_id"], {"status": "exploded"}, actor=ACTOR)

    def test_uncomplete_clears_completion_evidence(self):
        run = self._run()
        item_id = run["items"][0]["item_id"]
        apply_item_update(run, item_id, {"status": "completed"}, actor=ACTOR)
        updated = apply_item_update(run, item_id, {"status": "pending"}, actor=ACTOR)
        assert updated["items"][0]["completed_at"] is None
        assert updated["progress"]["completed"] == 0

    def test_audit_trail_grows(self):
        run = self._run()
        item_id = run["items"][0]["item_id"]
        apply_item_update(run, item_id, {"status": "completed"}, actor=ACTOR)
        assert any(entry["action"] == "item_completed" for entry in run["audit"])

    def test_full_completion_sets_status_and_timestamp(self):
        run = self._run()
        for item in run["items"]:
            payload = {"status": "completed"}
            if item["evidence_required"]:
                payload["evidence"] = {"value": "proof"}
            apply_item_update(run, item["item_id"], payload, actor=ACTOR)
        assert run["status"] == "completed"
        assert run["completed_at"] is not None
