"""Server-side execution gate for Nexus Verify protected provider actions."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import uuid

from fastapi import HTTPException

from app.database import db


MICROSOFT_ENTRA_PROVIDER = "microsoft_entra"


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


def _identifier(value: Any, *, folded: bool = False) -> str:
    """Return a provider identifier without using display labels."""
    identifier = str(value or "").strip()
    return identifier.casefold() if folded else identifier


def normalise_microsoft_target(value: Any, *, require_upn: bool = True) -> dict[str, str] | None:
    """Validate the durable Entra target for a provider-bound Verify request.

    A display name is useful presentation context, but it must never decide
    whether a completed Verify proof can operate on an Entra identity.
    """
    if not isinstance(value, dict):
        return None
    provider = _identifier(value.get("provider"), folded=True)
    tenant_id = _identifier(value.get("tenant_id"), folded=True)
    provider_user_id = _identifier(value.get("provider_user_id") or value.get("user_id"), folded=True)
    user_principal_name = _identifier(
        value.get("user_principal_name") or value.get("provider_user_principal_name"),
        folded=True,
    )
    if provider != MICROSOFT_ENTRA_PROVIDER or not tenant_id or not provider_user_id:
        return None
    if require_upn and not user_principal_name:
        return None
    target = {
        "provider": MICROSOFT_ENTRA_PROVIDER,
        "tenant_id": tenant_id,
        "provider_user_id": provider_user_id,
    }
    if user_principal_name:
        target["user_principal_name"] = user_principal_name
    return target


def _microsoft_target_error(record: dict[str, Any], provider_target: dict[str, Any] | None) -> str | None:
    """Fail closed when a provider action differs from its completed proof."""
    if provider_target is None:
        return None
    expected = normalise_microsoft_target(record.get("provider_target"), require_upn=True)
    actual = normalise_microsoft_target(provider_target, require_upn=False)
    if not expected:
        return "This Microsoft provider action needs a Nexus Verify request bound to the exact Entra tenant and user"
    if not actual or expected["provider"] != actual["provider"]:
        return "A current Nexus Verify request is required for this Microsoft target"
    if expected["tenant_id"] != actual["tenant_id"] or expected["provider_user_id"] != actual["provider_user_id"]:
        return "A current Nexus Verify request is required for this Microsoft target"
    return None


def validation_error(
    record: dict[str, Any] | None,
    *,
    client_id: str,
    action_type: str,
    provider_target: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> str | None:
    """Return a human-safe gate failure or ``None`` when execution is allowed."""
    now = now or _now()
    if not record:
        return "A Nexus Verify request is required before this sensitive action can run"
    if str(record.get("client_id") or "") != str(client_id):
        # The caller may have supplied an arbitrary request ID. Do not reveal
        # that another customer's recovery workflow exists; use the same
        # customer-bound message an absent or unusable request receives.
        return "A current Nexus Verify request is required for this customer"
    if record.get("action_type") != action_type:
        return "The Nexus Verify request does not cover this sensitive action"
    if record.get("status") != "ready_to_execute":
        return "Nexus Verify must have current identity proof and any required independent approval"
    verification = record.get("verification") or {}
    if verification.get("status") != "verified":
        return "Nexus Verify has no trusted identity proof for this request"
    required_factors = max(1, int(record.get("required_factors") or 1))
    factors = verification.get("factors") if isinstance(verification.get("factors"), list) else []
    if factors and len(factors) < required_factors:
        return "Nexus Verify does not yet contain every required identity factor"
    if verification.get("factor_count") not in (None, ""):
        try:
            if int(verification["factor_count"]) < required_factors:
                return "Nexus Verify does not yet contain every required identity factor"
        except (TypeError, ValueError):
            return "Nexus Verify factor evidence is malformed; verify the requester again"
    expires = _parse_timestamp(verification.get("expires_at"))
    if not expires or expires <= now:
        return "The Nexus Verify proof has expired; verify the requester again"
    # A technician's written attestation is meaningful audit evidence, but it
    # is not an independently verifiable credential assertion.  Provider
    # actions must fail closed until a supported Nexus App/passkey/mobile
    # connector returns a proof receipt and marks this flag server-side.
    if verification.get("execution_eligible") is not True:
        return "Nexus Verify has recorded evidence but no connector-verified proof for this provider action"
    target_error = _microsoft_target_error(record, provider_target)
    if target_error:
        return target_error
    return None


async def _audit(record: dict[str, Any], action: str, actor: dict[str, Any], detail: str) -> None:
    await db.nexus_verify_audit.insert_one({
        "id": str(uuid.uuid4()), "request_id": record["id"], "client_id": record.get("client_id"),
        "action": action, "actor_id": actor.get("id"), "actor_name": actor.get("name") or actor.get("email"),
        "detail": detail, "occurred_at": _now().isoformat(),
    })


async def begin_verified_execution(
    verification_request_id: str | None,
    *,
    client_id: str,
    action_type: str,
    actor: dict[str, Any],
    target: str,
    provider_target: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Atomically reserve a verified request before an external provider call.

    A reservation prevents two technicians from using the same proof to issue
    duplicate sensitive actions. A failed provider call may explicitly release
    the reservation; an interrupted one remains safely held for review.
    """
    request_id = str(verification_request_id or "").strip()
    record = await db.nexus_verify_requests.find_one({"id": request_id}, {"_id": 0}) if request_id else None
    error = validation_error(
        record,
        client_id=client_id,
        action_type=action_type,
        provider_target=provider_target,
    )
    if error:
        raise HTTPException(status_code=428, detail=error)
    execution_binding = normalise_microsoft_target(provider_target, require_upn=False) if provider_target else None
    reservation_query = {"id": request_id, "status": "ready_to_execute"}
    if execution_binding:
        # Re-check the exact proof target in the write predicate so a
        # concurrent update cannot swap it between validation and execution.
        reservation_query.update({
            "provider_target.provider": execution_binding["provider"],
            "provider_target.tenant_id": execution_binding["tenant_id"],
            "provider_target.provider_user_id": execution_binding["provider_user_id"],
        })
    result = await db.nexus_verify_requests.update_one(
        reservation_query,
        {"$set": {"status": "execution_in_progress", "execution": {"target": target, "provider_target": execution_binding, "started_at": _now().isoformat(), "started_by": actor.get("name") or actor.get("email"), "started_by_id": actor.get("id")}, "updated_at": _now().isoformat()}},
    )
    if not getattr(result, "matched_count", 1):
        raise HTTPException(status_code=409, detail="This verification request is already being used or has been completed")
    await _audit(record, "provider_execution_started", actor, f"Verified {action_type} execution reserved for {target}.")
    return record


async def release_verified_execution(record: dict[str, Any], *, actor: dict[str, Any], reason: str) -> None:
    """Return a reservation to ready state after a provider failure."""
    await db.nexus_verify_requests.update_one(
        {"id": record["id"], "status": "execution_in_progress"},
        {"$set": {"status": "ready_to_execute", "execution_failure": reason[:300], "updated_at": _now().isoformat()}},
    )
    await _audit(record, "provider_execution_released", actor, f"Provider execution was not completed: {reason[:240]}")


async def complete_verified_execution(record: dict[str, Any], *, actor: dict[str, Any], outcome: str) -> None:
    """Close the verified request only after the provider action returned."""
    await db.nexus_verify_requests.update_one(
        {"id": record["id"], "status": "execution_in_progress"},
        {"$set": {"status": "completed", "completed_at": _now().isoformat(), "completed_by": actor.get("name") or actor.get("email"), "execution_outcome": outcome[:500], "updated_at": _now().isoformat()}},
    )
    await _audit(record, "provider_execution_completed", actor, outcome[:300])
