"""Nexus Academy course and learning-evidence helpers.

Academy is deliberately separate from technician onboarding.  The onboarding
checklist remains the authoritative readiness gate for a Nexus account, while
this module owns authored course revisions and learner-assignment evidence.
Neither record is evidence that customer work, a privileged action, or a
security remediation was performed.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from typing import Any
from uuid import uuid4


COURSE_CATEGORIES = frozenset({"academy", "security_awareness"})
COURSE_STATUSES = frozenset({"draft", "published", "archived"})
LEARNER_SCOPE = "msp_staff_users"
EVIDENCE_BOUNDARY = (
    "Nexus Academy retains learning-assignment and completion evidence only. "
    "It does not prove customer work, a privileged action, a security remediation, "
    "or a professional certification."
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_id(prefix: str) -> str:
    """Return a Nexus-owned opaque identifier, never derived from a name/email."""
    return f"{prefix}-{uuid4().hex}"


def content_fingerprint(snapshot: dict[str, Any]) -> str:
    """Fingerprint the exact assigned material without logging learner answers."""
    canonical = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(canonical.encode("utf-8")).hexdigest()


def course_snapshot(course: dict[str, Any]) -> dict[str, Any]:
    """Copy the exact course revision that an assignment refers to.

    A later edit creates a new course version but must not rewrite a learner's
    assigned material or completed evidence.  The snapshot therefore belongs
    to the assignment, not to a mutable course display record.
    """
    snapshot = {
        "course_id": str(course.get("id") or ""),
        "course_version": int(course.get("version") or 1),
        "title": str(course.get("title") or "Course"),
        "description": str(course.get("description") or ""),
        "category": str(course.get("category") or "academy"),
        "content": deepcopy(course.get("content") if isinstance(course.get("content"), list) else []),
        "assessment": deepcopy(course.get("assessment") if isinstance(course.get("assessment"), list) else []),
        "passing_score": int(course.get("passing_score") or 100),
        "estimated_minutes": int(course.get("estimated_minutes") or 0),
        "completion_statement": str(course.get("completion_statement") or ""),
    }
    snapshot["content_hash"] = content_fingerprint(snapshot)
    return snapshot


def learner_course(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Return learning material without leaking author-only quiz answers."""
    result = {
        key: deepcopy(snapshot.get(key))
        for key in (
            "course_id",
            "course_version",
            "title",
            "description",
            "category",
            "content",
            "passing_score",
            "estimated_minutes",
            "completion_statement",
            "content_hash",
        )
    }
    questions: list[dict[str, Any]] = []
    for question in snapshot.get("assessment") if isinstance(snapshot.get("assessment"), list) else []:
        if not isinstance(question, dict):
            continue
        questions.append({
            "id": str(question.get("id") or ""),
            "prompt": str(question.get("prompt") or ""),
            "options": deepcopy(question.get("options") if isinstance(question.get("options"), list) else []),
        })
    result["assessment"] = questions
    return result


def public_course(course: dict[str, Any], *, include_authoring: bool = False) -> dict[str, Any]:
    """Expose a safe course document for administration or catalogue display."""
    public = {
        key: deepcopy(course.get(key))
        for key in (
            "id",
            "title",
            "description",
            "category",
            "content",
            "assessment",
            "passing_score",
            "estimated_minutes",
            "required_default",
            "status",
            "version",
            "template_key",
            "created_at",
            "updated_at",
            "archived_at",
        )
    }
    if include_authoring:
        public.update({
            key: deepcopy(course.get(key))
            for key in ("created_by_id", "created_by_name", "updated_by_id", "updated_by_name")
        })
    return public


def public_assignment(assignment: dict[str, Any], *, include_snapshot: bool = False) -> dict[str, Any]:
    """Expose no tenant internals or author-only material from an assignment."""
    public = {
        key: deepcopy(assignment.get(key))
        for key in (
            "id",
            "course_id",
            "course_version",
            "learner_id",
            "learner_name",
            "status",
            "required",
            "due_at",
            "assigned_at",
            "assigned_by_id",
            "assigned_by_name",
            "completed_at",
            "completion_evidence",
            "updated_at",
        )
    }
    if include_snapshot:
        snapshot = assignment.get("course_snapshot") if isinstance(assignment.get("course_snapshot"), dict) else {}
        public["course"] = learner_course(snapshot)
    return public


def assessment_result(snapshot: dict[str, Any], answers: list[dict[str, Any]]) -> dict[str, int | bool]:
    """Grade a first-party assessment against the assigned immutable revision.

    Correct options never leave the server.  The returned result intentionally
    contains only an aggregate score so a learner cannot use the endpoint as a
    correct-answer oracle.
    """
    questions = snapshot.get("assessment") if isinstance(snapshot.get("assessment"), list) else []
    if not questions:
        return {"question_count": 0, "correct_count": 0, "score_percent": 100, "passed": True}

    supplied: dict[str, int] = {}
    for answer in answers:
        if not isinstance(answer, dict):
            continue
        question_id = str(answer.get("question_id") or "").strip()
        selected = answer.get("selected_option")
        if question_id and isinstance(selected, int) and question_id not in supplied:
            supplied[question_id] = selected

    question_ids = {str(question.get("id") or "") for question in questions if isinstance(question, dict)}
    if not question_ids or set(supplied) != question_ids:
        raise ValueError("Answer every assessment question before completing this course")

    correct = sum(
        1
        for question in questions
        if isinstance(question, dict)
        and supplied.get(str(question.get("id") or "")) == question.get("correct_option")
    )
    total = len(questions)
    score = round((correct / total) * 100) if total else 100
    passing_score = int(snapshot.get("passing_score") or 100)
    return {
        "question_count": total,
        "correct_count": correct,
        "score_percent": score,
        "passed": score >= passing_score,
    }


CERTIFICATE_TYPE = "academy_completion_certificate"


def certificate_id(tenant_id: str, assignment_id: str) -> str:
    """One certificate per assignment, so retries and backfills cannot duplicate."""
    identity = f"{tenant_id}:{assignment_id}"
    return "cert-" + sha256(identity.encode("utf-8")).hexdigest()


def certificate_verification_hash(identity: dict[str, Any]) -> str:
    """Integrity fingerprint over the certificate's public learning evidence.

    This is a tamper-evident fingerprint of the public fields, not a signature
    and not a professional certification credential.
    """
    canonical = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(canonical.encode("utf-8")).hexdigest()


def verification_code(verification_hash: str) -> str:
    """Human-readable short code for phone/email verification of a certificate."""
    raw = verification_hash.upper()[:12]
    return "NXA-" + "-".join(raw[i:i + 4] for i in range(0, 12, 4))


def certificate_record(assignment: dict[str, Any]) -> dict[str, Any]:
    """Build the durable certificate document from a completed assignment.

    Only issued from retained completion evidence: a certificate never exists
    for an uncompleted assignment and never carries assessment answers.
    """
    evidence = assignment.get("completion_evidence") or {}
    snapshot = assignment.get("course_snapshot") or {}
    identity = {
        "assignment_id": str(assignment.get("id") or ""),
        "learner_id": str(assignment.get("learner_id") or ""),
        "course_id": str(assignment.get("course_id") or ""),
        "course_version": int(assignment.get("course_version") or 1),
        "score_percent": int(evidence.get("score_percent") or 0),
        "question_count": int(evidence.get("question_count") or 0),
        "correct_count": int(evidence.get("correct_count") or 0),
        "content_hash": str(evidence.get("content_hash") or snapshot.get("content_hash") or ""),
        "issued_at": str(evidence.get("at") or utc_now()),
    }
    verification = certificate_verification_hash(identity)
    return {
        "id": certificate_id(str(assignment.get("tenant_id") or ""), identity["assignment_id"]),
        "tenant_id": str(assignment.get("tenant_id") or ""),
        "type": CERTIFICATE_TYPE,
        "assignment_id": identity["assignment_id"],
        "course_id": identity["course_id"],
        "course_version": identity["course_version"],
        "course_title": str(snapshot.get("title") or "Course"),
        "category": str(snapshot.get("category") or "academy"),
        "learner_id": identity["learner_id"],
        "learner_name": str(assignment.get("learner_name") or "Learner"),
        "score_percent": identity["score_percent"],
        "question_count": identity["question_count"],
        "correct_count": identity["correct_count"],
        "issued_at": identity["issued_at"],
        "content_hash": identity["content_hash"],
        "verification_hash": verification,
        "verification_code": verification_code(verification),
        "completion_statement": str(snapshot.get("completion_statement") or ""),
        "evidence_boundary": EVIDENCE_BOUNDARY,
    }


def public_certificate(row: dict[str, Any]) -> dict[str, Any]:
    """Expose a certificate without tenant internals or assessment answers."""
    return {key: value for key, value in row.items() if key not in {"_id", "tenant_id", "created_at"}}


SECURITY_AWARENESS_STARTER_TEMPLATE: dict[str, Any] = {
    "template_key": "nexus-security-awareness-starter-v1",
    "title": "Nexus Security Awareness: Protect the Workday",
    "description": (
        "Nexus-authored starter material for recognising suspicious requests, "
        "protecting credentials, and escalating safely. It is editable by an "
        "authorised Academy administrator before publication or assignment."
    ),
    "category": "security_awareness",
    "estimated_minutes": 20,
    "required_default": True,
    "completion_statement": (
        "I completed this assigned Nexus security-awareness course and understand "
        "that suspicious requests, credentials, MFA prompts and customer-impacting "
        "actions must be verified and escalated through the approved Nexus workflow."
    ),
    "content": [
        {
            "id": "recognise-suspicious-requests",
            "title": "Recognise suspicious requests",
            "body": (
                "Urgency, secrecy, unusual payment changes, unexpected MFA prompts and "
                "requests to bypass a normal approval path are warning signs. Pause and "
                "verify through a trusted, independently obtained contact method."
            ),
            "key_takeaways": [
                "Urgency is not proof of authority.",
                "Use a trusted contact channel, not the one supplied by a suspicious message.",
                "Escalate uncertainty instead of guessing.",
            ],
        },
        {
            "id": "protect-credentials-and-mfa",
            "title": "Protect credentials and MFA",
            "body": (
                "Passwords, MFA codes, recovery codes and approval prompts are personal "
                "security controls. Never share, approve or relay them because someone "
                "claims to be support. Use Nexus Verify and the governed access workflow."
            ),
            "key_takeaways": [
                "A legitimate support request does not require your password or MFA code.",
                "Unexpected MFA prompts can be a sign of an attempted account takeover.",
                "Use the approved workflow for privileged or remote actions.",
            ],
        },
        {
            "id": "report-and-preserve-evidence",
            "title": "Report and preserve evidence",
            "body": (
                "Create or update the accountable Nexus ticket, preserve the relevant "
                "message or event reference, and record observed facts. Do not delete, "
                "forward externally or investigate beyond your authority."
            ),
            "key_takeaways": [
                "The ticket is the operational source of truth for the investigation.",
                "Record observations separately from assumptions.",
                "Containment and customer communication require the appropriate authority.",
            ],
        },
    ],
    "assessment": [
        {
            "id": "verify-urgent-request",
            "prompt": "An urgent message asks you to approve an MFA prompt for an executive. What is the safest next step?",
            "options": [
                "Approve it because the sender sounds urgent",
                "Verify the request through an independently trusted contact path and escalate if unsure",
                "Forward the MFA code to the sender",
            ],
            "correct_option": 1,
        },
        {
            "id": "credential-sharing",
            "prompt": "Which information must never be shared with a caller or in chat?",
            "options": [
                "A ticket reference", "An MFA code or password", "A public help-centre link"
            ],
            "correct_option": 1,
        },
        {
            "id": "evidence-location",
            "prompt": "Where should observed facts and the escalation trail be recorded?",
            "options": [
                "In the accountable Nexus ticket", "Only in a private notebook", "Nowhere if the issue looks harmless"
            ],
            "correct_option": 0,
        },
    ],
    "passing_score": 100,
}


async def ensure_academy_indexes(*, database: Any) -> None:
    """Create durable uniqueness/query indexes when backed by Motor.

    Unit-test stores intentionally expose only the collection methods they
    exercise, so treat missing ``create_index`` as a no-op rather than coupling
    pure route contracts to Motor implementation details.
    """
    collections = (
        (
            getattr(database, "academy_courses", None),
            (
                ([("id", 1)], {"unique": True, "name": "academy_course_id_unique"}),
                ([("tenant_id", 1), ("published", 1), ("updated_at", -1)], {}),
            ),
        ),
        (
            getattr(database, "academy_assignments", None),
            (
                ([("id", 1)], {"unique": True, "name": "academy_assignment_id_unique"}),
                (
                    [("tenant_id", 1), ("course_id", 1), ("course_version", 1), ("learner_id", 1)],
                    {"unique": True, "name": "academy_assignment_revision_unique"},
                ),
                ([("tenant_id", 1), ("learner_id", 1), ("status", 1), ("assigned_at", -1)], {}),
            ),
        ),
        (
            getattr(database, "academy_certificates", None),
            (
                ([("id", 1)], {"unique": True, "name": "academy_certificate_id_unique"}),
                (
                    [("tenant_id", 1), ("assignment_id", 1)],
                    {"unique": True, "name": "academy_certificate_assignment_unique"},
                ),
                ([("tenant_id", 1), ("learner_id", 1), ("issued_at", -1)], {}),
            ),
        ),
    )
    for collection, index_specs in collections:
        create_index = getattr(collection, "create_index", None)
        if not callable(create_index):
            continue
        for fields, kwargs in index_specs:
            await create_index(fields, **kwargs)
