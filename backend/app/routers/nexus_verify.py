"""Nexus Verify: evidence-led verification for sensitive helpdesk actions.

This router intentionally records verification, approvals and hand-off state.
It does *not* impersonate a provider or silently perform password/MFA actions.
Provider execution is only safe once an approved connector is available.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import assert_client_scope, scoped_query

router = APIRouter(tags=["Nexus Verify"])

ACTION_POLICIES = {
    "password_reset": {"label": "Password reset", "risk": "medium", "factors": 1, "approval": False},
    "account_unlock": {"label": "Account unlock", "risk": "medium", "factors": 1, "approval": False},
    "mfa_reset": {"label": "MFA reset", "risk": "high", "factors": 1, "approval": True},
    "privileged_access": {"label": "Privileged-access request", "risk": "high", "factors": 1, "approval": True},
    "mailbox_forwarding": {"label": "Mailbox forwarding", "risk": "high", "factors": 1, "approval": True},
    "global_admin_change": {"label": "Global Admin change", "risk": "critical", "factors": 2, "approval": True},
    "dns_change": {"label": "DNS or domain change", "risk": "critical", "factors": 2, "approval": True},
    "payment_change": {"label": "Payment-detail change", "risk": "critical", "factors": 2, "approval": True},
}

METHODS = {
    "nexus_app": "Registered Nexus app",
    "passkey": "Registered passkey",
    "approved_mobile": "Approved mobile channel",
    "authorised_contact": "Authorised contact",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _public(record: dict[str, Any]) -> dict[str, Any]:
    record.pop("_id", None)
    return record


def _policy(action_type: str) -> dict[str, Any]:
    policy = ACTION_POLICIES.get(action_type)
    if not policy:
        raise HTTPException(status_code=400, detail="Choose a supported sensitive action")
    return policy


def _may_approve_sensitive_request(record: dict[str, Any], user: dict[str, Any]) -> bool:
    """Require an independent, explicitly authorised high-risk approver."""
    user_id = str(user.get("id") or "")
    user_identity = str(user.get("name") or user.get("email") or "")
    verification = record.get("verification") or {}
    if user_id and user_id in {
        str(record.get("created_by_id") or ""),
        str(verification.get("verified_by_id") or ""),
    }:
        return False
    if user_identity and user_identity in {
        str(record.get("created_by") or ""),
        str(verification.get("verified_by") or ""),
    }:
        return False

    if user.get("is_admin") or str(user.get("role") or "").lower() in {
        "admin",
        "service_desk_manager",
    }:
        return True
    permissions = user.get("permissions") if isinstance(user.get("permissions"), dict) else {}
    return bool((permissions.get("nexus_verify") or {}).get("approve"))


async def _request_or_404(request_id: str, user: dict[str, Any]) -> dict[str, Any]:
    record = await db.nexus_verify_requests.find_one({"id": request_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Verification request not found")
    await assert_client_scope(user, record.get("client_id"), operation="nexus_verify")
    return record


async def _audit(record: dict[str, Any], action: str, actor: dict[str, Any], detail: str) -> None:
    await db.nexus_verify_audit.insert_one({
        "id": str(uuid.uuid4()), "request_id": record["id"], "client_id": record.get("client_id"),
        "action": action, "actor_id": actor.get("id"), "actor_name": actor.get("name") or actor.get("email"),
        "detail": detail, "occurred_at": _now().isoformat(),
    })


@router.get("/nexus-verify/overview")
async def overview(current_user: dict = Depends(get_current_user)):
    records = await db.nexus_verify_requests.find(scoped_query(current_user, {}, site_field=None), {"_id": 0}).sort("created_at", -1).to_list(100)
    audits = await db.nexus_verify_audit.find(scoped_query(current_user, {}, site_field=None), {"_id": 0}).sort("occurred_at", -1).to_list(100)
    pending = [item for item in records if item.get("status") not in {"completed", "cancelled", "expired"}]
    return {
        "policies": [{"id": key, **value} for key, value in ACTION_POLICIES.items()],
        "methods": [{"id": key, "label": value} for key, value in METHODS.items()],
        "requests": records,
        "audit": audits,
        "summary": {"open": len(pending), "awaiting_verification": sum(item.get("status") == "awaiting_verification" for item in pending), "awaiting_approval": sum(item.get("status") == "awaiting_approval" for item in pending), "ready": sum(item.get("status") == "ready_to_execute" for item in pending)},
        "execution_boundary": "Nexus Verify records proof and approval. Connected provider actions remain disabled until an approved integration executes them.",
    }


@router.post("/nexus-verify/requests")
async def create_request(data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    action_type = str(data.get("action_type") or "").strip()
    policy = _policy(action_type)
    client_id = str(data.get("client_id") or "").strip()
    subject_name = str(data.get("subject_name") or "").strip()
    if not client_id or not subject_name:
        raise HTTPException(status_code=400, detail="Customer and requester are required")
    await assert_client_scope(current_user, client_id, operation="create_nexus_verify_request")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    record = {
        "id": str(uuid.uuid4()), "client_id": client_id, "client_name": (client or {}).get("name") or "Client",
        "subject_name": subject_name, "subject_email": str(data.get("subject_email") or "").strip(),
        "ticket_id": str(data.get("ticket_id") or "").strip(), "action_type": action_type, "action_label": policy["label"],
        "risk": policy["risk"], "required_factors": policy["factors"], "approval_required": policy["approval"],
        "status": "awaiting_verification", "verification": None, "approval": None,
        "justification": str(data.get("justification") or "").strip(),
        "created_by": current_user.get("name") or current_user.get("email"), "created_by_id": current_user.get("id"), "created_at": _now().isoformat(), "updated_at": _now().isoformat(),
    }
    await db.nexus_verify_requests.insert_one(record.copy())
    await _audit(record, "request_created", current_user, f"{policy['label']} requires {policy['factors']} verified factor(s).")
    return {"request": record, "message": "Sensitive request created. Verify the requester before continuing."}


@router.post("/nexus-verify/requests/{request_id}/challenge")
async def issue_challenge(request_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    record = await _request_or_404(request_id, current_user)
    method = str(data.get("method") or "").strip()
    if method not in METHODS:
        raise HTTPException(status_code=400, detail="Choose an enrolled verification method")
    if record.get("status") not in {"awaiting_verification", "challenge_issued"}:
        raise HTTPException(status_code=409, detail="This request can no longer be challenged")
    challenge = {"method": method, "method_label": METHODS[method], "issued_at": _now().isoformat(), "expires_at": (_now() + timedelta(minutes=10)).isoformat()}
    await db.nexus_verify_requests.update_one({"id": request_id}, {"$set": {"status": "challenge_issued", "challenge": challenge, "updated_at": _now().isoformat()}})
    await _audit(record, "challenge_issued", current_user, f"Challenge issued through {METHODS[method]}. Delivery is connector-gated.")
    return {"challenge": challenge, "message": "Challenge recorded. Complete confirmation only after a trusted-channel response."}


@router.post("/nexus-verify/requests/{request_id}/confirm")
async def confirm_identity(request_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    record = await _request_or_404(request_id, current_user)
    challenge = record.get("challenge") or {}
    method = str(data.get("method") or challenge.get("method") or "")
    evidence_ref = str(data.get("evidence_ref") or "").strip()
    if method not in METHODS or not evidence_ref:
        raise HTTPException(status_code=400, detail="Trusted method and verification evidence reference are required")
    expires = (_now() + timedelta(minutes=30)).isoformat()
    verification = {"status": "verified", "method": method, "method_label": METHODS[method], "verified_at": _now().isoformat(), "expires_at": expires, "verified_by": current_user.get("name") or current_user.get("email"), "verified_by_id": current_user.get("id"), "evidence_ref": evidence_ref}
    next_status = "awaiting_approval" if record.get("approval_required") else "ready_to_execute"
    await db.nexus_verify_requests.update_one({"id": request_id}, {"$set": {"status": next_status, "verification": verification, "updated_at": _now().isoformat()}})
    await _audit(record, "identity_verified", current_user, f"Verified through {METHODS[method]}; evidence {evidence_ref}.")
    return {"status": next_status, "verification": verification}


@router.post("/nexus-verify/requests/{request_id}/approve")
async def approve_request(request_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    record = await _request_or_404(request_id, current_user)
    if record.get("status") != "awaiting_approval":
        raise HTTPException(status_code=409, detail="Identity verification must complete before approval")
    if not _may_approve_sensitive_request(record, current_user):
        raise HTTPException(
            status_code=403,
            detail="An independent Nexus Verify approver is required for this sensitive action",
        )
    rationale = str(data.get("rationale") or "").strip()
    if len(rationale) < 8:
        raise HTTPException(status_code=400, detail="Record an approval rationale")
    approval = {"status": "approved", "approved_at": _now().isoformat(), "approved_by": current_user.get("name") or current_user.get("email"), "approved_by_id": current_user.get("id"), "rationale": rationale}
    result = await db.nexus_verify_requests.update_one(
        {"id": request_id, "status": "awaiting_approval"},
        {"$set": {"status": "ready_to_execute", "approval": approval, "updated_at": _now().isoformat()}},
    )
    if not getattr(result, "matched_count", 1):
        raise HTTPException(status_code=409, detail="This sensitive request was already decided")
    await _audit(record, "request_approved", current_user, rationale)
    return {"status": "ready_to_execute", "approval": approval}


@router.post("/nexus-verify/requests/{request_id}/handoff")
async def handoff_execution(request_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    record = await _request_or_404(request_id, current_user)
    if record.get("status") != "ready_to_execute":
        raise HTTPException(status_code=409, detail="Verified approval is required before hand-off")
    execution_note = str(data.get("execution_note") or "").strip()
    if len(execution_note) < 8:
        raise HTTPException(status_code=400, detail="Record the provider hand-off or completion note")
    await db.nexus_verify_requests.update_one({"id": request_id}, {"$set": {"status": "completed", "completed_at": _now().isoformat(), "completed_by": current_user.get("name") or current_user.get("email"), "execution_note": execution_note, "updated_at": _now().isoformat()}})
    await _audit(record, "provider_handoff_recorded", current_user, execution_note)
    return {"status": "completed", "message": "Verified hand-off recorded. Nexus did not perform an external identity action."}
