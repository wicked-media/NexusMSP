"""Tenant-owned Academy authoring, assignment and assessment APIs."""
from copy import deepcopy
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query
from app.services.academy import (
    SECURITY_AWARENESS_STARTER_TEMPLATE, assessment_result, course_snapshot,
    learner_course, stable_id, utc_now,
)

router = APIRouter(prefix="/academy", tags=["academy"])


class Question(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    prompt: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(min_length=2, max_length=6)
    correct_option: int = Field(ge=0)

    @model_validator(mode="after")
    def valid_options(self):
        if self.correct_option >= len(self.options) or any(not x.strip() or len(x) > 1000 for x in self.options):
            raise ValueError("Each answer needs text and a valid correct option")
        return self


class CourseInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=3000)
    category: Literal["academy", "security_awareness"] = "academy"
    content: str = Field(max_length=60000)
    estimated_minutes: int = Field(default=10, ge=1, le=1440)
    required: bool = False
    published: bool = False
    archived: bool = False
    assessment: list[Question] = Field(default_factory=list, max_length=30)
    passing_score: int = Field(default=100, ge=1, le=100)
    expected_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def valid_course(self):
        if not self.title.strip() or (self.published and not self.content.strip()):
            raise ValueError("Published courses need a title and lesson content")
        if len({q.id for q in self.assessment}) != len(self.assessment):
            raise ValueError("Assessment question identifiers must be unique")
        if self.published and self.category == "security_awareness" and not self.assessment:
            raise ValueError("Security awareness courses need a knowledge check before publication")
        return self


class AssignmentInput(BaseModel):
    learner_ids: list[str] = Field(min_length=1, max_length=200)
    due_at: date | None = None
    required: bool = True


class Answer(BaseModel):
    question_id: str = Field(min_length=1, max_length=100)
    selected_option: int = Field(ge=0, le=5, strict=True)


class CompletionInput(BaseModel):
    acknowledged: bool
    answers: list[Answer] = Field(default_factory=list, max_length=30)


def scope(user, **query):
    return {**query, "tenant_id": platform_tenant_id(user)}


def admin(user):
    if not (user.get("is_admin") in (True, 1) or str(user.get("role", "")).lower() == "admin"):
        raise HTTPException(403, "Academy administrator access required")


def visible_course(row):
    return {k: v for k, v in row.items() if k not in {"_id", "tenant_id", "audit"}}


def learner_row(row):
    snapshot = row["course_snapshot"]
    course = learner_course(snapshot)
    course.update(id=snapshot["course_id"], version=snapshot["course_version"], published=True)
    return {"course": course, "assignment": {k: v for k, v in row.items() if k not in {"_id", "tenant_id", "course_snapshot"}}}


def event(user, action):
    return {"id": stable_id("evidence"), "actor_id": user["id"], "action": action, "at": utc_now()}


async def get_course(course_id, user):
    row = await db.academy_courses.find_one(scope(user, id=course_id), {"_id": 0})
    if not row:
        raise HTTPException(404, "Course not found")
    return row


@router.get("/admin/courses")
async def list_courses(current_user: dict = Depends(get_current_user)):
    admin(current_user)
    rows = await db.academy_courses.find(scope(current_user), {"_id": 0}).sort("updated_at", -1).to_list(1000)
    return {"courses": [visible_course(row) for row in rows], "limit": 1000}


@router.post("/admin/courses")
async def create_course(data: CourseInput, current_user: dict = Depends(get_current_user)):
    admin(current_user)
    row = data.model_dump(exclude={"expected_version"})
    row.update(id=stable_id("course"), tenant_id=platform_tenant_id(current_user), version=1,
               created_at=utc_now(), updated_at=utc_now(), audit=[event(current_user, "course_created")])
    await db.academy_courses.insert_one(deepcopy(row))
    return {"course": visible_course(row)}


@router.put("/admin/courses/{course_id}")
async def edit_course(course_id: str, data: CourseInput, current_user: dict = Depends(get_current_user)):
    admin(current_user)
    await get_course(course_id, current_user)
    if data.expected_version is None:
        raise HTTPException(409, "Refresh the course before editing")
    changes = data.model_dump(exclude={"expected_version"})
    changes.update(version=data.expected_version + 1, updated_at=utc_now())
    result = await db.academy_courses.update_one(
        scope(current_user, id=course_id, version=data.expected_version),
        {"$set": changes, "$push": {"audit": event(current_user, "course_edited")}},
    )
    if not result.matched_count:
        raise HTTPException(409, "This course changed. Refresh before saving again")
    return {"course": visible_course(await get_course(course_id, current_user))}


@router.post("/admin/security-awareness-starter")
async def create_starter(current_user: dict = Depends(get_current_user)):
    admin(current_user)
    template = SECURITY_AWARENESS_STARTER_TEMPLATE
    row = CourseInput(title=template["title"], description=template["description"],
                      category="security_awareness", required=True, estimated_minutes=20,
                      content="\n\n".join(x["title"] + "\n" + x["body"] for x in template["content"]),
                      assessment=template["assessment"]).model_dump(exclude={"expected_version"})
    # Deterministic per-tenant identity makes retries and concurrent clicks safe.
    from hashlib import sha256
    course_id = "course-starter-" + sha256(platform_tenant_id(current_user).encode()).hexdigest()
    row.update(id=course_id, tenant_id=platform_tenant_id(current_user), version=1,
               created_at=utc_now(), updated_at=utc_now(), audit=[event(current_user, "starter_created")])
    await db.academy_courses.update_one({"_id": course_id}, {"$setOnInsert": row}, upsert=True)
    return {"course": visible_course(await get_course(course_id, current_user))}


@router.get("/admin/courses/{course_id}/assignments")
async def assignments(course_id: str, current_user: dict = Depends(get_current_user)):
    admin(current_user)
    course = await get_course(course_id, current_user)
    rows = await db.academy_assignments.find(scope(current_user, course_id=course_id), {"_id": 0, "course_snapshot": 0}).to_list(2000)
    learners = await db.users.find(tenant_scoped_query(current_user, {"archived": {"$ne": True}, "is_active": {"$ne": False}}), {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    current = [row for row in rows if row.get("course_version") == course["version"]]
    today = utc_now()[:10]
    return {"assignments": rows, "learners": learners, "current_version": course["version"],
            "summary": {"assigned": len(current),
                        "completed": sum(row.get("status") == "completed" for row in current),
                        "overdue": sum(row.get("status") != "completed" and bool(row.get("due_at")) and row["due_at"] < today for row in current),
                        "historical": len(rows) - len(current)},
            "limit": 2000, "possibly_truncated": len(rows) == 2000}


@router.post("/admin/courses/{course_id}/assignments")
async def assign(course_id: str, data: AssignmentInput, current_user: dict = Depends(get_current_user)):
    admin(current_user)
    course = await get_course(course_id, current_user)
    if not course.get("published") or course.get("archived"):
        raise HTTPException(409, "Publish an active course before assigning it")
    ids = list(dict.fromkeys(data.learner_ids))
    users = await db.users.find(tenant_scoped_query(current_user, {"id": {"$in": ids}, "archived": {"$ne": True}, "is_active": {"$ne": False}}), {"_id": 0, "id": 1, "name": 1}).to_list(201)
    if {u["id"] for u in users} != set(ids):
        raise HTTPException(400, "Choose active learners from your organisation")
    from hashlib import sha256
    snapshot_source = {**course, "content": [{"body": course["content"]}]}
    snapshot = course_snapshot(snapshot_source)
    created = 0
    for user in users:
        identity = f"{platform_tenant_id(current_user)}:{course_id}:{course['version']}:{user['id']}"
        assignment_id = "assignment-" + sha256(identity.encode()).hexdigest()
        row = dict(id=assignment_id, tenant_id=platform_tenant_id(current_user), course_id=course_id,
                   course_version=course["version"], learner_id=user["id"], learner_name=user.get("name", "Learner"),
                   course_snapshot=snapshot, status="assigned", required=data.required,
                   due_at=data.due_at.isoformat() if data.due_at else None,
                   assigned_at=utc_now(), assigned_by_id=current_user["id"], audit=[event(current_user, "course_assigned")])
        result = await db.academy_assignments.update_one({"_id": assignment_id}, {"$setOnInsert": row}, upsert=True)
        created += int(result.upserted_id is not None)
    return {"created": created, "existing": len(users) - created}


@router.get("/me")
async def my_courses(current_user: dict = Depends(get_current_user)):
    rows = await db.academy_assignments.find(scope(current_user, learner_id=current_user["id"]), {"_id": 0}).sort("assigned_at", -1).to_list(1000)
    return {"courses": [learner_row(row) for row in rows], "learner_scope": "msp_staff_users"}


@router.post("/assignments/{assignment_id}/complete")
async def complete(assignment_id: str, data: CompletionInput, current_user: dict = Depends(get_current_user)):
    query = scope(current_user, id=assignment_id, learner_id=current_user["id"])
    row = await db.academy_assignments.find_one(query, {"_id": 0})
    if not row:
        raise HTTPException(404, "Assignment not found")
    if row["status"] == "completed":
        return {**learner_row(row), "changed": False}
    if not data.acknowledged:
        raise HTTPException(400, "Confirm you have reviewed the assigned material")
    try:
        result = assessment_result(row["course_snapshot"], [x.model_dump() for x in data.answers])
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not result["passed"]:
        raise HTTPException(400, f"Score: {result['score_percent']}%. Review the material and try again")
    evidence = {**event(current_user, "course_completed"), **result, "course_version": row["course_version"],
                "content_hash": row["course_snapshot"]["content_hash"], "type": "knowledge_check" if result["question_count"] else "attestation"}
    changed = await db.academy_assignments.update_one({**query, "status": "assigned"},
        {"$set": {"status": "completed", "completed_at": evidence["at"], "completion_evidence": evidence}, "$push": {"audit": evidence}})
    refreshed = await db.academy_assignments.find_one(query, {"_id": 0})
    return {**learner_row(refreshed), "changed": bool(changed.matched_count)}
