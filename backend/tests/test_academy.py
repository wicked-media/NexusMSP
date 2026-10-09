"""Academy authoring, tenant isolation and immutable learner evidence."""
import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.routers import academy as api


def matches(row, query):
    for key, value in query.items():
        if key == "$and":
            if not all(matches(row, clause) for clause in value): return False
        elif key == "$or":
            if not any(matches(row, clause) for clause in value): return False
        elif isinstance(value, dict):
            if "$in" in value and row.get(key) not in value["$in"]: return False
            if "$ne" in value and row.get(key) == value["$ne"]: return False
            if "$exists" in value and (key in row) != value["$exists"]: return False
        elif row.get(key) != value: return False
    return True


class Cursor:
    def __init__(self, rows): self.rows = rows
    def sort(self, *_): return self
    async def to_list(self, limit): return deepcopy(self.rows[:limit])


class Collection:
    def __init__(self, rows=None): self.rows = rows or []
    def find(self, query, projection=None): return Cursor([r for r in self.rows if matches(r, query)])
    async def find_one(self, query, projection=None):
        return deepcopy(next((r for r in self.rows if matches(r, query)), None))
    async def insert_one(self, row): self.rows.append(deepcopy(row))
    async def update_one(self, query, update, upsert=False):
        row = next((r for r in self.rows if matches(r, query)), None)
        if row is None and upsert:
            self.rows.append({**deepcopy(query), **deepcopy(update["$setOnInsert"])})
            return SimpleNamespace(matched_count=0, upserted_id=query["_id"])
        if row is None: return SimpleNamespace(matched_count=0, upserted_id=None)
        row.update(deepcopy(update.get("$set", {})))
        for key, item in update.get("$push", {}).items(): row.setdefault(key, []).append(deepcopy(item))
        return SimpleNamespace(matched_count=1, upserted_id=None)


ADMIN = {"id": "admin-a", "tenant_id": "a", "role": "admin"}
LEARNER = {"id": "learner-a", "tenant_id": "a", "role": "technician"}
PEER = {"id": "learner-c", "tenant_id": "a", "role": "technician"}
FOREIGN = {"id": "learner-b", "tenant_id": "b", "role": "admin"}


@pytest.fixture
def database(monkeypatch):
    db = SimpleNamespace(academy_courses=Collection(), academy_assignments=Collection(), academy_certificates=Collection(), users=Collection([ADMIN, LEARNER, PEER, FOREIGN]))
    monkeypatch.setattr(api, "db", db)
    return db


def run(coroutine): return asyncio.run(coroutine)


def course(**overrides):
    return api.CourseInput(**{**dict(title="Safe support", content="Verify through the approved channel.", category="security_awareness", published=True,
        assessment=[dict(id="q1", prompt="Which channel?", options=["Caller supplied", "Trusted"], correct_option=1)]), **overrides})


def test_course_permissions_partition_and_version_conflict(database):
    with pytest.raises(HTTPException) as denied: run(api.create_course(course(), LEARNER))
    assert denied.value.status_code == 403
    created = run(api.create_course(course(), ADMIN))["course"]
    assert run(api.list_courses(FOREIGN))["courses"] == []
    with pytest.raises(HTTPException) as hidden: run(api.edit_course(created["id"], course(expected_version=1), FOREIGN))
    assert hidden.value.status_code == 404
    updated = run(api.edit_course(created["id"], course(expected_version=1, title="Updated"), ADMIN))["course"]
    assert updated["version"] == 2
    with pytest.raises(HTTPException) as stale: run(api.edit_course(created["id"], course(expected_version=1), ADMIN))
    assert stale.value.status_code == 409


def test_assignment_validation_retry_and_snapshot_survives_edit(database):
    created = run(api.create_course(course(), ADMIN))["course"]
    with pytest.raises(HTTPException): run(api.assign(created["id"], api.AssignmentInput(learner_ids=[FOREIGN["id"]]), ADMIN))
    assert not database.academy_assignments.rows
    request = api.AssignmentInput(learner_ids=[LEARNER["id"]])
    assert run(api.assign(created["id"], request, ADMIN))["created"] == 1
    assert run(api.assign(created["id"], request, ADMIN))["existing"] == 1
    run(api.edit_course(created["id"], course(title="New material", expected_version=1), ADMIN))
    assigned = run(api.my_courses(LEARNER))["courses"][0]
    assert assigned["course"]["title"] == "Safe support"
    assert assigned["course"]["version"] == 1
    assert "correct_option" not in assigned["course"]["assessment"][0]
    assert run(api.my_courses(FOREIGN))["courses"] == []


def test_completion_is_self_scoped_graded_and_idempotent(database):
    created = run(api.create_course(course(), ADMIN))["course"]
    run(api.assign(created["id"], api.AssignmentInput(learner_ids=[LEARNER["id"]]), ADMIN))
    assignment_id = database.academy_assignments.rows[0]["id"]
    passed = api.CompletionInput(acknowledged=True, answers=[dict(question_id="q1", selected_option=1)])
    with pytest.raises(HTTPException) as foreign: run(api.complete(assignment_id, passed, FOREIGN))
    assert foreign.value.status_code == 404
    with pytest.raises(HTTPException): run(api.complete(assignment_id, api.CompletionInput(acknowledged=True, answers=[dict(question_id="q1", selected_option=0)]), LEARNER))
    assert database.academy_assignments.rows[0]["status"] == "assigned"
    first = run(api.complete(assignment_id, passed, LEARNER))
    second = run(api.complete(assignment_id, passed, LEARNER))
    assert first["changed"] is True and second["changed"] is False
    assert first["assignment"]["completion_evidence"] == second["assignment"]["completion_evidence"]
    assert first["assignment"]["completion_evidence"]["score_percent"] == 100


def test_starter_retry_does_not_overwrite_edits(database):
    first = run(api.create_starter(ADMIN))["course"]
    run(api.edit_course(first["id"], course(title="Our policy", expected_version=1), ADMIN))
    assert run(api.create_starter(ADMIN))["course"]["title"] == "Our policy"
    assert len(database.academy_courses.rows) == 1


def test_publication_requires_content_and_security_assessment():
    with pytest.raises(ValidationError): course(assessment=[])
    with pytest.raises(ValidationError): course(content=" ")
    with pytest.raises(ValidationError): api.Answer(question_id="q1", selected_option=True)


def test_archived_course_cannot_receive_new_assignments(database):
    created = run(api.create_course(course(archived=True), ADMIN))["course"]
    with pytest.raises(HTTPException) as archived: run(api.assign(created["id"], api.AssignmentInput(learner_ids=[LEARNER["id"]]), ADMIN))
    assert archived.value.status_code == 409


def test_completion_issues_certificate_and_backfills(database):
    created = run(api.create_course(course(), ADMIN))["course"]
    run(api.assign(created["id"], api.AssignmentInput(learner_ids=[LEARNER["id"]]), ADMIN))
    assignment_id = database.academy_assignments.rows[0]["id"]
    passed = api.CompletionInput(acknowledged=True, answers=[dict(question_id="q1", selected_option=1)])
    cert = run(api.complete(assignment_id, passed, LEARNER))["certificate"]
    assert cert["verification_code"].startswith("NXA-") and len(cert["verification_code"]) == 18
    assert cert["score_percent"] == 100 and cert["question_count"] == 1 and cert["correct_count"] == 1
    assert cert["course_title"] == "Safe support" and cert["content_hash"]
    assert "tenant_id" not in cert and "correct_option" not in str(cert)
    assert cert["evidence_boundary"]
    assert len(database.academy_certificates.rows) == 1
    second = run(api.complete(assignment_id, passed, LEARNER))
    assert second["certificate"]["id"] == cert["id"]
    assert second["certificate"]["verification_hash"] == cert["verification_hash"]
    assert len(database.academy_certificates.rows) == 1
    database.academy_certificates.rows.clear()  # completion predates the certificate store
    backfilled = run(api.complete(assignment_id, passed, LEARNER))
    assert backfilled["changed"] is False
    assert backfilled["certificate"]["id"] == cert["id"]
    assert backfilled["certificate"]["verification_hash"] == cert["verification_hash"]
    assert len(database.academy_certificates.rows) == 1


def test_certificate_reads_are_scope_enforced(database):
    created = run(api.create_course(course(), ADMIN))["course"]
    run(api.assign(created["id"], api.AssignmentInput(learner_ids=[LEARNER["id"]]), ADMIN))
    assignment_id = database.academy_assignments.rows[0]["id"]
    passed = api.CompletionInput(acknowledged=True, answers=[dict(question_id="q1", selected_option=1)])
    cert_id = run(api.complete(assignment_id, passed, LEARNER))["certificate"]["id"]
    assert [row["id"] for row in run(api.my_certificates(LEARNER))["certificates"]] == [cert_id]
    assert run(api.my_certificates(PEER))["certificates"] == []
    assert run(api.my_certificates(FOREIGN))["certificates"] == []
    assert run(api.get_certificate(cert_id, LEARNER))["certificate"]["id"] == cert_id
    assert run(api.get_certificate(cert_id, ADMIN))["certificate"]["id"] == cert_id
    with pytest.raises(HTTPException) as peer: run(api.get_certificate(cert_id, PEER))
    assert peer.value.status_code == 403
    with pytest.raises(HTTPException) as foreign: run(api.get_certificate(cert_id, FOREIGN))
    assert foreign.value.status_code == 404


def test_failed_attempt_retains_no_certificate(database):
    created = run(api.create_course(course(), ADMIN))["course"]
    run(api.assign(created["id"], api.AssignmentInput(learner_ids=[LEARNER["id"]]), ADMIN))
    assignment_id = database.academy_assignments.rows[0]["id"]
    wrong = api.CompletionInput(acknowledged=True, answers=[dict(question_id="q1", selected_option=0)])
    with pytest.raises(HTTPException): run(api.complete(assignment_id, wrong, LEARNER))
    assert database.academy_certificates.rows == []
    assert run(api.my_certificates(LEARNER))["certificates"] == []


def test_assignment_summary_separates_versions_and_completed_due_dates(database):
    created = run(api.create_course(course(), ADMIN))["course"]
    request = api.AssignmentInput(learner_ids=[LEARNER["id"]], due_at="2020-01-01")
    run(api.assign(created["id"], request, ADMIN))
    assignment_id = database.academy_assignments.rows[0]["id"]
    run(api.complete(assignment_id, api.CompletionInput(acknowledged=True, answers=[dict(question_id="q1", selected_option=1)]), LEARNER))
    assert run(api.assignments(created["id"], ADMIN))["summary"]["overdue"] == 0
    run(api.edit_course(created["id"], course(expected_version=1), ADMIN))
    run(api.assign(created["id"], request, ADMIN))
    result = run(api.assignments(created["id"], ADMIN))
    assert result["current_version"] == 2
    assert result["summary"] == {"assigned": 1, "completed": 0, "overdue": 1, "historical": 1}
    assert len(result["assignments"]) == 2
