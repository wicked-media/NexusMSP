"""The human-decision object family: one lifecycle for every human decision.

Approvals, consent receipts, risk acceptances and the decision log share the
same lifecycle::

    proposed -> reviewed -> decided -> review-due -> expired

``nexus_decisions`` and ``risk_acceptances`` (the commercial memory) remain the
authoritative stores for their kinds; this family indexes them alongside new
``decision_family`` objects so governance can answer one question across all of
them: *who accepted what risk, when does it expire, and what happened next?*
States are honest — ``review-due`` and ``expired`` derive from real dates, and
unrecorded decisions never pretend to be decided.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

KINDS = ("decision_log", "risk_acceptance", "approval", "consent_receipt")

LIFECYCLE: dict[str, list[str]] = {
    "proposed": ["reviewed", "decided"],
    "reviewed": ["decided"],
    "decided": ["review-due", "expired"],
    "review-due": ["decided", "expired"],
    "expired": [],
}

REVIEW_WINDOW_DAYS = 14


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def lifecycle_spec() -> dict:
    """The shared lifecycle, published so the UI and auditors read one truth."""
    return {
        "states": list(LIFECYCLE.keys()),
        "transitions": {state: sorted(next_states) for state, next_states in LIFECYCLE.items()},
        "terminal_states": [state for state, next_states in LIFECYCLE.items() if not next_states],
        "review_window_days": REVIEW_WINDOW_DAYS,
        "kinds": list(KINDS),
        "note": ("review-due and expired also derive from recorded expiry/review dates: "
                 "a decided object whose review window opens is review-due, and one past "
                 "its expiry is expired — whether or not anyone remembered to click."),
    }


def effective_state(stored_state: str, expires: Any, review_date: Any,
                    today: datetime | None = None) -> str:
    """Derive the honest lifecycle state from the stored state plus real dates."""
    today = (today or _utcnow()).date()
    state = str(stored_state or "proposed")
    if state not in LIFECYCLE:
        state = "proposed" if state in ("open", "pending") else ("decided" if state in ("accepted", "active") else "proposed")
    expiry = _parse_iso(expires)
    review = _parse_iso(review_date)
    if state in ("decided", "review-due"):
        if expiry and expiry.date() < today:
            return "expired"
        horizon = today + timedelta(days=REVIEW_WINDOW_DAYS)
        if expiry and expiry.date() <= horizon:
            return "review-due"
        if review and review.date() <= horizon:
            return "review-due"
    return state


def _days_to(expiry: Any, today: datetime) -> int | None:
    parsed = _parse_iso(expiry)
    return (parsed.date() - today.date()).days if parsed else None


async def record_object(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Record one member of the family. Objects recorded after the fact may be
    born ``decided`` (a consent receipt is evidence of a decision already made)."""
    kind = str(payload.get("kind") or "").strip()
    subject = str(payload.get("subject") or payload.get("title") or "").strip()
    if kind not in KINDS:
        return {"found": False, "error": f"kind must be one of {', '.join(KINDS)}"}
    if not subject:
        return {"found": False, "error": "subject is required"}
    state = str(payload.get("state") or "proposed").strip()
    if state not in ("proposed", "decided"):
        return {"found": False, "error": "state must be proposed or decided at recording time"}
    now = _utcnow()
    entry = {
        "id": f"DFM-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "kind": kind,
        "client_id": str(payload.get("client_id") or "")[:64],
        "device_id": str(payload.get("device_id") or "")[:64],
        "subject": subject[:300],
        "detail": str(payload.get("detail") or payload.get("reason") or "")[:2000],
        "owner": str(payload.get("owner") or payload.get("risk_owner") or "")[:120],
        "state": state,
        "decision": str(payload.get("decision") or "")[:200] if state == "decided" else "",
        "decided_by": name if state == "decided" else "",
        "decided_at": _iso(now) if state == "decided" else "",
        "expires": str(payload.get("expires") or "")[:40],
        "review_date": str(payload.get("review_date") or "")[:40],
        "evidence": payload.get("evidence") if isinstance(payload.get("evidence"), dict) else {},
        "transitions": [],
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(now),
    }
    await db.decision_family.insert_one(entry)
    entry.pop("_id", None)
    entry["effective_state"] = effective_state(entry["state"], entry["expires"], entry["review_date"], now)
    return {"found": True, "object": entry,
            "note": "Recorded in the human-decision family. Same lifecycle, same audit trail, whatever the kind."}


async def transition(db: Any, user: dict, name: str, object_id: str, payload: dict) -> dict:
    """Move one family object through the shared lifecycle. Every move is an
    append-only transition record: actor, timestamp and note."""
    to_state = str(payload.get("to_state") or "").strip()
    if to_state not in LIFECYCLE:
        return {"found": False, "error": f"to_state must be one of {', '.join(LIFECYCLE.keys())}"}
    row = await db.decision_family.find_one(
        tenant_scoped_query(user, {"id": object_id}), {"_id": 0})
    if not row:
        return {"found": False}
    current = str(row.get("state") or "proposed")
    if to_state not in LIFECYCLE.get(current, []):
        return {"found": False,
                "error": f"illegal transition {current} -> {to_state}; allowed: {', '.join(LIFECYCLE.get(current, [])) or 'none (terminal state)'}"}
    now = _utcnow()
    moves = list(row.get("transitions") or [])
    moves.append({"from": current, "to": to_state, "by": name, "at": _iso(now),
                  "note": str(payload.get("note") or "")[:500]})
    updates: dict = {"state": to_state, "transitions": moves}
    if to_state == "decided":
        updates["decided_by"] = name
        updates["decided_at"] = _iso(now)
        updates["decision"] = str(payload.get("decision") or to_state)[:200]
    await db.decision_family.update_one(
        {"id": object_id, "tenant_id": row.get("tenant_id")}, {"$set": updates})
    row.update(updates)
    row["effective_state"] = effective_state(row.get("state"), row.get("expires"), row.get("review_date"), now)
    return {"found": True, "object": row,
            "note": f"Transitioned {current} -> {to_state} with a full audit trail."}


def _normalise(row: dict, source: str, kind: str, today: datetime) -> dict:
    state = effective_state(row.get("state") or row.get("status"), row.get("expires"),
                            row.get("review_date"), today)
    return {
        "id": row.get("id"),
        "source": source,
        "kind": kind,
        "client_id": row.get("client_id") or "",
        "device_id": row.get("device_id") or "",
        "subject": row.get("subject") or row.get("title") or row.get("decision") or "",
        "detail": row.get("detail") or row.get("reason") or row.get("compensating_controls") or "",
        "owner": row.get("owner") or row.get("risk_owner") or row.get("created_by_name") or "",
        "state": state,
        "stored_state": row.get("state") or row.get("status"),
        "decision": row.get("decision") or row.get("status") or "",
        "decided_by": row.get("decided_by") or row.get("recorded_by") or row.get("created_by_name") or "",
        "expires": row.get("expires") or "",
        "review_date": row.get("review_date") or "",
        "days_to_expiry": _days_to(row.get("expires"), today),
        "created_at": row.get("created_at") or "",
    }


async def family_index(db: Any, user: dict, client_id: str | None = None) -> dict:
    """One read across the whole family: new family objects plus the legacy
    decision log and risk acceptances, with derived honest states."""
    today = _utcnow()
    scope: dict = {"tenant_id": platform_tenant_id(user)}
    if client_id:
        scope["client_id"] = client_id

    family_rows = await db.decision_family.find(scope, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    legacy_decisions = await db.nexus_decisions.find(scope, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    legacy_risks = await db.risk_acceptances.find(scope, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)

    objects = [_normalise(row, "decision_family", row.get("kind") or "decision_log", today)
               for row in family_rows]
    objects += [_normalise(row, "nexus_decisions", "decision_log", today) for row in legacy_decisions]
    objects += [_normalise(row, "risk_acceptances", "risk_acceptance", today) for row in legacy_risks]
    objects.sort(key=lambda item: item.get("created_at") or "", reverse=True)

    by_state: dict = {}
    by_kind: dict = {}
    for item in objects:
        by_state[item["state"]] = by_state.get(item["state"], 0) + 1
        by_kind[item["kind"]] = by_kind.get(item["kind"], 0) + 1
    open_risks = [item for item in objects
                  if item["kind"] == "risk_acceptance" and item["state"] in ("decided", "review-due")]
    return {
        "count": len(objects),
        "objects": objects[:100],
        "by_state": by_state,
        "by_kind": by_kind,
        "open_risk_owners": sorted({item["owner"] for item in open_risks if item["owner"]}),
        "question_answered": ("who accepted what risk, when does it expire, and what happened next "
                              "— across approvals, consent receipts, risk acceptances and the decision log."),
        "note": ("Legacy decision-log and risk-acceptance records are indexed with derived states; "
                 "they remain authoritative in their own stores."),
    }
