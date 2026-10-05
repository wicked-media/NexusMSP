"""Focused tests for the Academy training-template library.

Templates are modelled on MSP training programs and instantiate into ordinary
draft courses.  These tests pin template integrity and the instantiation
mapping so a broken template can never reach the Course Studio.
"""

from __future__ import annotations

import pytest

from app.routers.academy import CourseInput
from app.services.academy_templates import (
    COURSE_TEMPLATES,
    TRACK_CAPABILITY,
    TRACK_CUSTOMER,
    TRACK_OPERATIONS,
    TRACK_SECURITY,
    get_template,
    template_as_course,
    template_catalogue,
    template_preview,
)


class TestTemplateIntegrity:
    def test_every_template_passes_course_validation(self):
        for template in COURSE_TEMPLATES:
            course = template_as_course(template["id"])
            assert course is not None, template["id"]
            validated = CourseInput(**course)  # raises if a template is malformed
            assert validated.title.strip()
            assert validated.content.strip()
            assert validated.published is False, "templates must instantiate as drafts"

    def test_every_template_has_rich_content(self):
        for template in COURSE_TEMPLATES:
            assert len(template["modules"]) >= 3, f"{template['id']} needs at least 3 modules"
            assert len(template["assessment"]) >= 2, f"{template['id']} needs a knowledge check"
            for module in template["modules"]:
                assert module["title"].strip()
                assert len(module["body"]) >= 200, f"{template['id']} module bodies must be substantial"
            assert template["tagline"].strip()
            assert template["inspired_by"].strip()
            assert template["difficulty"] in {"Foundation", "Intermediate", "Advanced"}
            assert template["roles"], f"{template['id']} must name target roles"

    def test_assessment_questions_are_well_formed(self):
        for template in COURSE_TEMPLATES:
            ids = set()
            for question in template["assessment"]:
                assert question["id"] not in ids
                ids.add(question["id"])
                assert 2 <= len(question["options"]) <= 6
                assert 0 <= question["correct_option"] < len(question["options"])

    def test_ids_are_unique(self):
        ids = [template["id"] for template in COURSE_TEMPLATES]
        assert len(ids) == len(set(ids))

    def test_covers_the_core_training_tracks(self):
        """The library spans the full training model, not a single slice."""
        tracks = {template["track"] for template in COURSE_TEMPLATES}
        assert {
            TRACK_SECURITY,
            TRACK_CAPABILITY,
            TRACK_OPERATIONS,
            TRACK_CUSTOMER,
        } <= tracks

    def test_library_is_substantial(self):
        """The Academy ships a real training library, not a handful of stubs."""
        assert len(COURSE_TEMPLATES) >= 12
        # Every core track carries more than a single course.
        from collections import Counter

        per_track = Counter(template["track"] for template in COURSE_TEMPLATES)
        for track in (TRACK_SECURITY, TRACK_CAPABILITY, TRACK_OPERATIONS, TRACK_CUSTOMER):
            assert per_track[track] >= 2, f"{track} needs at least two courses"


class TestTemplateViews:
    def test_catalogue_hides_lesson_content(self):
        catalogue = template_catalogue()
        assert catalogue
        for entry in catalogue:
            assert "modules" not in entry
            assert "assessment" not in entry
            assert entry["module_count"] >= 3
            assert entry["assessment_count"] >= 2

    def test_preview_includes_outlines_and_prompts(self):
        preview = template_preview(COURSE_TEMPLATES[0]["id"])
        assert preview["modules"] and all(m["body"] for m in preview["modules"])
        assert preview["assessment_prompts"]

    def test_unknown_template_returns_none(self):
        assert get_template("missing") is None
        assert template_preview("missing") is None
        assert template_as_course("missing") is None


class TestInstantiation:
    def test_overrides_are_applied(self):
        course = template_as_course(
            COURSE_TEMPLATES[0]["id"],
            {"title": "Custom title", "estimated_minutes": 55, "required": True, "passing_score": 90},
        )
        assert course["title"] == "Custom title"
        assert course["estimated_minutes"] == 55
        assert course["required"] is True
        assert course["passing_score"] == 90

    def test_default_title_uses_template_name(self):
        template = COURSE_TEMPLATES[0]
        assert template_as_course(template["id"])["title"] == template["name"]

    def test_security_awareness_templates_keep_required_assessment(self):
        for template in COURSE_TEMPLATES:
            if template["category"] != "security_awareness":
                continue
            course = template_as_course(template["id"])
            assert course["assessment"], f"{template['id']} must keep its knowledge check"
            CourseInput(**course)  # publishability rules must accept the mapping

    def test_instantiation_result_validates_with_title_override(self):
        with pytest.raises(ValueError):
            CourseInput(**template_as_course(COURSE_TEMPLATES[0]["id"], {"title": "   "}))
