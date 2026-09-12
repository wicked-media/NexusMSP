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
from app.services.nexus_verify_execution import normalise_microsoft_target
from app.services.scope_permissions import assert_client_scope, scoped_query

router = APIRouter(tags=["Nexus Verify"])

ACTION_POLICIES = {
    "password_reset": {"label": "Password reset", "risk": "medium", "factors": 1, "approval": False},
    "account_unlock": {"label": "Account unlock", "risk": "medium", "factors": 1, "approval": False},
    "offboarding": {"label": "User offboarding", "risk": "high", "factors": 1, "approval": True},
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


def _parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _verification_factors(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Return durable, distinct factor evidence without trusting browser counts."""
    verification = record.get("verification") or {}
    factors = verification.get("factors")
    if isinstance(factors, list):
        return [factor for factor in factors if isinstance(factor, dict)]
    # Earlier preview records used one flat verification shape.  Preserve that
    # evidence for display, but do not silently treat it as connector-backed
    # execution proof.
    if verification.get("status") in {"verified", "partially_verified"}:
        return [verification]
    return []


def _challenge_expiry_error(challenge: dict[str, Any], *, now: datetime | None = None) -> str | None:
    expires_at = _parse_timestamp(challenge.get("expires_at"))
    if not expires_at:
        return "The verification challenge has no valid expiry and must be issued again"
    if expires_at <= (now or _now()):
        return "The verification challenge has expired; issue a new challenge"
    return None


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
    factors = _verification_factors(record)
    excluded_user_ids = {
        str(record.get("created_by_id") or ""),
        str(verification.get("verified_by_id") or ""),
        *(str(factor.get("verified_by_id") or "") for factor in factors),
    }
    excluded_identities = {
        str(record.get("created_by") or ""),
        str(verification.get("verified_by") or ""),
        *(str(factor.get("verified_by") or "") for factor in factors),
    }
    if user_id and user_id in excluded_user_ids:
        return False
    if user_identity and user_identity in excluded_identities:
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
    # A sensitive request ID is itself operational intelligence.  Keep a
    # foreign request indistinguishable from a missing request so a scoped
    # technician cannot enumerate another customer's recovery activity.
    await assert_client_scope(
        user,
        record.get("client_id"),
        operation="nexus_verify",
        mask_not_found=True,
    )
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
        "summary": {
            "open": len(pending),
            "awaiting_verification": sum(item.get("status") == "awaiting_verification" for item in pending),
            "challenge_issued": sum(item.get("status") == "challenge_issued" for item in pending),
            "awaiting_approval": sum(item.get("status") == "awaiting_approval" for item in pending),
            "ready": sum(item.get("status") == "ready_to_execute" for item in pending),
            "ready_for_handoff": sum(item.get("status") == "ready_for_handoff" for item in pending),
        },
        "execution_boundary": "Nexus Verify records requested factors, independent approvals and durable evidence. An operator-attested record can be handed off for review, but it never unlocks a connected provider action until a supported trusted channel returns connector-verified proof.",
    }


@router.post("/nexus-verify/requests")
async def create_request(data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    action_type = str(data.get("action_type") or "").strip()
    policy = _policy(action_type)
    client_id = str(data.get("client_id") or "").strip()
    subject_name = str(data.get("subject_name") or "").strip()
    if not client_id or not subject_name:
        raise HTTPException(status_code=400, detail="Customer and requester are required")
    provider_target = None
    if data.get("provider_target") is not None:
        provider_target = normalise_microsoft_target(data.get("provider_target"), require_upn=True)
        if not provider_target:
            raise HTTPException(
                status_code=400,
                detail="A Microsoft provider target must include the Entra tenant ID, provider user ID and user principal name",
            )
    subject_email = str(data.get("subject_email") or "").strip()
    if provider_target:
        # A display name must never bind a provider action. When a Microsoft
        # target is supplied, its exact UPN becomes the recorded subject
        # address; reject an inconsistent browser-provided email rather than
        # creating a proof for one person and an action for another.
        if subject_email and subject_email.casefold() != provider_target["user_principal_name"]:
            raise HTTPException(status_code=400, detail="The requester email must match the Microsoft target user principal name")
        subject_email = provider_target["user_principal_name"]
    await assert_client_scope(current_user, client_id, operation="create_nexus_verify_request")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    ticket_id = str(data.get("ticket_id") or "").strip()
    if ticket_id:
        ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "client_id": 1})
        if not ticket or str(ticket.get("client_id") or "") != client_id:
            raise HTTPException(status_code=400, detail="The linked ticket must belong to the selected customer")
    record = {
        "id": str(uuid.uuid4()), "client_id": client_id, "client_name": client.get("name") or "Client",
        "subject_name": subject_name, "subject_email": subject_email,
        "provider_target": provider_target,
        "ticket_id": ticket_id, "action_type": action_type, "action_label": policy["label"],
        "risk": policy["risk"], "required_factors": policy["factors"], "approval_required": policy["approval"],
        "status": "awaiting_verification", "challenge": None, "verification": None, "approval": None,
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
    active_challenge = record.get("challenge") or {}
    if record.get("status") == "challenge_issued" and not _challenge_expiry_error(active_challenge):
        raise HTTPException(status_code=409, detail="A verification challenge is already active; confirm it or wait for it to expire")
    used_methods = {str(factor.get("method") or "") for factor in _verification_factors(record)}
    if method in used_methods:
        raise HTTPException(status_code=409, detail="Each required factor must use a distinct enrolled verification method")
    issued_at = _now()
    challenge = {
        "id": str(uuid.uuid4()),
        "method": method,
        "method_label": METHODS[method],
        "issued_at": issued_at.isoformat(),
        "expires_at": (issued_at + timedelta(minutes=10)).isoformat(),
        # No enrolled Nexus customer channel is wired to this preview yet.
        # This field makes the limitation explicit instead of implying delivery.
        "delivery_state": "recorded_not_connector_verified",
    }
    await db.nexus_verify_requests.update_one({"id": request_id}, {"$set": {"status": "challenge_issued", "challenge": challenge, "updated_at": _now().isoformat()}})
    await _audit(record, "challenge_issued", current_user, f"Challenge requested through {METHODS[method]}; connector delivery is not yet verified.")
    return {"challenge": challenge, "message": "Challenge recorded. Confirm only after you have independently obtained a trusted-channel evidence reference."}


@router.post("/nexus-verify/requests/{request_id}/confirm")
async def confirm_identity(request_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    record = await _request_or_404(request_id, current_user)
    challenge = record.get("challenge") or {}
    method = str(data.get("method") or challenge.get("method") or "")
    evidence_ref = str(data.get("evidence_ref") or "").strip()
    if record.get("status") != "challenge_issued":
        raise HTTPException(status_code=409, detail="Issue a current verification challenge before confirming identity")
    if method not in METHODS or method != challenge.get("method"):
        raise HTTPException(status_code=400, detail="Confirmation must use the method recorded on the active challenge")
    challenge_error = _challenge_expiry_error(challenge)
    if challenge_error:
        await db.nexus_verify_requests.update_one(
            {"id": request_id, "status": "challenge_issued"},
            {"$set": {"status": "awaiting_verification", "challenge": None, "updated_at": _now().isoformat()}},
        )
        await _audit(record, "challenge_expired", current_user, challenge_error)
        raise HTTPException(status_code=410, detail=challenge_error)
    if len(evidence_ref) < 8:
        raise HTTPException(status_code=400, detail="Record a meaningful trusted-channel evidence reference")

    verified_at = _now()
    factor = {
        "id": str(challenge.get("id") or uuid.uuid4()),
        "method": method,
        "method_label": METHODS[method],
        "verified_at": verified_at.isoformat(),
        "expires_at": (verified_at + timedelta(minutes=30)).isoformat(),
        "verified_by": current_user.get("name") or current_user.get("email"),
        "verified_by_id": current_user.get("id"),
        "evidence_ref": evidence_ref,
        "evidence_type": "operator_attestation",
        "connector_verified": False,
    }
    factors = [*_verification_factors(record), factor]
    required_factors = max(1, int(record.get("required_factors") or 1))
    factors_complete = len(factors) >= required_factors
    factor_expiries = [expiry for expiry in (_parse_timestamp(item.get("expires_at")) for item in factors) if expiry]
    verification = {
        "status": "verified" if factors_complete else "partially_verified",
        "factors": factors,
        "factor_count": len(factors),
        "required_factors": required_factors,
        "verified_at": verified_at.isoformat(),
        "expires_at": min(factor_expiries).isoformat() if factor_expiries else None,
        "execution_eligible": bool(factors_complete and all(item.get("connector_verified") is True for item in factors)),
    }
    if not factors_complete:
        next_status = "awaiting_verification"
    elif record.get("approval_required"):
        next_status = "awaiting_approval"
    else:
        next_status = "ready_to_execute" if verification["execution_eligible"] else "ready_for_handoff"
    result = await db.nexus_verify_requests.update_one(
        {"id": request_id, "status": "challenge_issued"},
        {"$set": {"status": next_status, "challenge": None, "verification": verification, "updated_at": _now().isoformat()}},
    )
    if not getattr(result, "matched_count", 1):
        raise HTTPException(status_code=409, detail="This verification challenge was already decided or replaced")
    await _audit(record, "verification_factor_recorded", current_user, f"Recorded factor {len(factors)} of {required_factors} through {METHODS[method]}; connector proof is not available.")
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
    verification = record.get("verification") or {}
    next_status = "ready_to_execute" if verification.get("execution_eligible") is True else "ready_for_handoff"
    result = await db.nexus_verify_requests.update_one(
        {"id": request_id, "status": "awaiting_approval"},
        {"$set": {"status": next_status, "approval": approval, "updated_at": _now().isoformat()}},
    )
    if not getattr(result, "matched_count", 1):
        raise HTTPException(status_code=409, detail="This sensitive request was already decided")
    await _audit(record, "request_approved", current_user, rationale)
    return {"status": next_status, "approval": approval}


@router.post("/nexus-verify/requests/{request_id}/handoff")
async def handoff_execution(request_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    record = await _request_or_404(request_id, current_user)
    if record.get("status") not in {"ready_to_execute", "ready_for_handoff"}:
        raise HTTPException(status_code=409, detail="Verified approval is required before hand-off")
    execution_note = str(data.get("execution_note") or "").strip()
    if len(execution_note) < 8:
        raise HTTPException(status_code=400, detail="Record the provider hand-off or completion note")
    await db.nexus_verify_requests.update_one({"id": request_id}, {"$set": {"status": "completed", "completed_at": _now().isoformat(), "completed_by": current_user.get("name") or current_user.get("email"), "execution_note": execution_note, "updated_at": _now().isoformat()}})
    await _audit(record, "provider_handoff_recorded", current_user, execution_note)
    return {"status": "completed", "message": "Verified hand-off recorded. Nexus did not perform an external identity action."}
