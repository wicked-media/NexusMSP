"""Voice service desk: the bridge between the PBX and Nexus ticketing.

Call history, live queue state and the missed-call workflow live here, so the
Yeastar integration exports an operational service desk rather than only a
monitor. Three rules hold across every route:

* a client PBX is always resolved inside the caller's own scope;
* a write names the Nexus action permission it needs and leaves an audit
  record;
* provider artifacts (recordings, voicemail) are relayed server-side, so a
  provider download URL never becomes a capability the browser holds.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.auth import get_current_user
from app.database import db
from app.models import TicketCreate
from app.routers.tickets import create_ticket
from app.services.action_permissions import assert_action_permission
from app.services.activity import log_activity
from app.services.yeastar import client as yeastar_client
from app.services.yeastar import registry as yeastar_registry
from app.services.yeastar import cdr
from app.services.yeastar.cdr import is_abandoned, normalise_cdr_rows
from app.services.yeastar.errors import YeastarError, http_status_for

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_HISTORY_PAGE_SIZE = 200
DEFAULT_HISTORY_PAGE_SIZE = 50
ARTIFACT_ACTIONS = {"recording": "voice.recording.listen", "voicemail": "voice.recording.listen"}
# Keys a P-Series release may use for a download address. Only the first
# present key is followed; none of them is ever returned to a caller.
DOWNLOAD_URL_KEYS = ("url", "download_url", "downloadUrl", "link", "file_url")


def _http_for(error: YeastarError) -> HTTPException:
    return HTTPException(status_code=http_status_for(error), detail=str(error))


async def resolve_client_pbx(current_user: dict, pbx_id: str | None, *, operation: str) -> dict:
    """Resolve a credentialled client PBX inside the caller's scope.

    The legacy single-tenant singleton is deliberately not offered here: the
    service desk is a customer-scoped workflow, and a call history has to belong
    to a client before it can become a ticket.
    """
    try:
        settings = await yeastar_client.resolve_pbx(current_user, pbx_id, operation=operation)
    except YeastarError as exc:
        raise _http_for(exc) from exc
    if not yeastar_client.has_credentials(settings):
        raise HTTPException(
            status_code=400,
            detail="This PBX needs its API URL, Client ID, and Client Secret before live voice data is available",
        )
    return settings


def pbx_identity(settings: dict) -> dict:
    """Safe PBX description for a response: identity only, never a secret."""
    return {
        "id": str(settings.get("id") or "primary"),
        "name": settings.get("name") or "Yeastar PBX",
        "client_id": str(settings.get("client_id") or ""),
        "client_name": settings.get("client_name") or "Client",
    }


async def _read_interface(settings: dict, operation_id: str, params: dict | None = None) -> Any:
    """Run one read interface strictly, mapping provider failure to a status."""
    operation = yeastar_registry.get_operation(operation_id)
    if operation is None:
        raise HTTPException(status_code=500, detail=f"Nexus is missing the {operation_id} interface definition")
    try:
        payload = await yeastar_client.dispatch_operation(settings, operation, params=params or {}, strict=True)
    except YeastarError as exc:
        raise _http_for(exc) from exc
    return payload.get("data") if isinstance(payload, dict) else payload


async def _read_interface_soft(settings: dict, operation_id: str, degraded: list[str], params: dict | None = None) -> Any:
    """Run one optional read, recording it as degraded instead of failing.

    A queue view is still useful when agent state is slow to answer, and a
    technician can see exactly which provider read did not respond.
    """
    try:
        return await _read_interface(settings, operation_id, params)
    except HTTPException as exc:
        reason = str(exc.detail)
    except Exception as exc:  # noqa: BLE001 - an optional read must never break the page
        # Mirrors the bounded-read pattern the PBX monitor already uses: a slow
        # or malformed optional read degrades the view and names itself instead
        # of failing the whole queue page for the technician.
        reason = exc.__class__.__name__
    degraded.append(operation_id)
    logger.info("Voice service desk read %s degraded: %s", operation_id, reason)
    return None


@router.get("/voice/call-history")
async def get_voice_call_history(
    pbx_id: str | None = None,
    direction: str = Query(default="all"),
    status: str = Query(default="all"),
    search: str = Query(default=""),
    abandoned_only: bool = Query(default=False),
    start_time: str | None = None,
    end_time: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_HISTORY_PAGE_SIZE, ge=1, le=MAX_HISTORY_PAGE_SIZE),
    current_user: dict = Depends(get_current_user),
):
    """Call detail records for one client PBX, filtered for a service desk.

    Date bounds are sent to the PBX because only it can page a large history.
    The remaining filters are applied to the normalised rows here, so the result
    is exactly what was asked for even on a release that ignores provider-side
    filtering. An unrecognised disposition never counts as answered.
    """
    settings = await resolve_client_pbx(current_user, pbx_id, operation="voice.call_history.read")
    params: dict[str, Any] = {"page": page, "page_size": page_size}
    if start_time:
        params["start_time"] = start_time
    if end_time:
        params["end_time"] = end_time
    try:
        payload = await yeastar_client.api_call(settings, "cdr/list", params=params, strict=True)
    except YeastarError as exc:
        raise _http_for(exc) from exc
    body = payload if isinstance(payload, dict) else {}
    rows = normalise_cdr_rows(body.get("data"))

    needle = search.strip().lower()
    filtered = []
    for row in rows:
        if direction != "all" and row["direction"] != direction:
            continue
        if status != "all" and row["status"] != status:
            continue
        # "Abandoned" means the caller was not answered. An unrecognised
        # disposition is surfaced rather than hidden, because hiding it would
        # drop potentially abandoned calls from the view entirely.
        if abandoned_only and row["status"] == cdr.ANSWERED:
            continue
        if needle:
            haystack = " ".join(
                str(row.get(field) or "") for field in ("caller", "caller_name", "callee", "callee_name")
            ).lower()
            if needle not in haystack:
                continue
        filtered.append(row)

    answered = [row for row in filtered if row["status"] == "answered"]
    missed = [row for row in filtered if row["status"] == "missed"]
    failed = [row for row in filtered if row["status"] == "failed"]
    total_talk = sum(int(row["talking_time"] or 0) for row in answered)
    waits = [row["wait_time"] for row in filtered if row["wait_time"] is not None]
    return {
        "pbx": pbx_identity(settings),
        "page": page,
        "page_size": page_size,
        "provider_total": body.get("total_number"),
        "counts": {
            "returned": len(filtered),
            "answered": len(answered),
            "missed": len(missed),
            "failed": len(failed),
            "recorded": len([row for row in filtered if row["recording"]]),
        },
        "total_talk_time": total_talk,
        "average_talk_time": (total_talk // len(answered)) if answered else 0,
        # Reported only when the PBX supplied wait times, so the UI can say
        # "not reported" instead of showing a fabricated average of zero.
        "average_wait_time": (sum(waits) // len(waits)) if waits else None,
        "wait_time_reported": bool(waits),
        "data": filtered,
    }


@router.get("/voice/queues")
async def get_voice_queue_state(
    pbx_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Live queue depth, waiting callers and agent state for one client PBX.

    Queue depth and longest wait are the service-desk obligations a wallboard of
    active calls cannot express. Provider payloads are passed through unmodified
    because Yeastar's queue field names vary by release; Nexus adds only the
    read-health detail.
    """
    settings = await resolve_client_pbx(current_user, pbx_id, operation="voice.queue.read")
    degraded: list[str] = []
    queues = await _read_interface(settings, "queue.list")
    call_status = await _read_interface_soft(settings, "queue.call_status", degraded)
    agent_status = await _read_interface_soft(settings, "queue.agent_status", degraded)
    pause_reasons = await _read_interface_soft(settings, "queue.pause_reasons", degraded)
    checked_at = datetime.now(timezone.utc).isoformat()
    await db.yeastar_pbxs.update_one(
        {"id": str(settings.get("id") or "")},
        {"$set": {"last_queue_check_at": checked_at, "last_queue_check_degraded_reads": degraded}},
    )
    return {
        "pbx": pbx_identity(settings),
        "checked_at": checked_at,
        "degraded_reads": degraded,
        "queue_count": len(queues) if isinstance(queues, list) else 0,
        "queues": queues if isinstance(queues, list) else [],
        "call_status": call_status,
        "agent_status": agent_status,
        "pause_reasons": pause_reasons,
    }


def _call_summary(row: dict) -> str:
    """One-line call description used as the ticket description header."""
    caller = row.get("caller_name") or row.get("caller") or "Unknown caller"
    callee = row.get("callee_name") or row.get("callee") or "unknown destination"
    return f"{caller} → {callee} ({row.get('direction') or 'internal'}, {row.get('status') or 'unknown'})"


@router.post("/voice/calls/to-ticket")
async def create_ticket_from_call(
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Raise a Nexus ticket from a call record.

    The call's client is taken from the PBX binding, never from the request
    body, so a caller cannot attribute another customer's call to a ticket.
    Ticket creation is delegated to the canonical route so idempotency, client
    scope, service-tier inheritance and audit behave exactly as they do for any
    other ticket.
    """
    call = data.get("call") if isinstance(data.get("call"), dict) else {}
    pbx_id = str(data.get("pbx_id") or "")
    settings = await resolve_client_pbx(current_user, pbx_id, operation="voice.call.to_ticket")
    client_id = str(settings.get("client_id") or "")
    if not client_id:
        raise HTTPException(status_code=400, detail="That PBX is not linked to a client, so a call cannot be attributed")
    await assert_action_permission(current_user, "ticket.conversation.create")

    call_id = str(call.get("id") or "").strip()
    if not call_id:
        raise HTTPException(status_code=400, detail="A call identifier is required so the ticket can reference the call")
    started_at = str(call.get("timestamp") or "").strip()
    abandoned = is_abandoned({"disposition": call.get("raw_disposition")}) or call.get("status") in {"missed", "failed"}
    label = "Abandoned call" if abandoned else "Call"
    title = f"{label} from {call.get('caller_name') or call.get('caller') or 'unknown number'}"
    lines = [
        _call_summary(call),
        f"PBX: {settings.get('name') or 'Yeastar PBX'}",
        f"Call ID: {call_id}",
    ]
    if started_at:
        lines.append(f"Started: {started_at}")
    if call.get("talking_time") not in (None, ""):
        lines.append(f"Talking time: {call.get('talking_time')}s")
    # Wait time is stated only when the PBX reported it. Claiming an SLA-visible
    # number the provider never sent would be worse than saying so.
    if call.get("wait_time") not in (None, ""):
        lines.append(f"Queue wait: {call['wait_time']}s")
    else:
        lines.append("Queue wait: not reported by the PBX")
    if call.get("recording"):
        lines.append("A recording exists on the PBX for this call.")

    ticket = await create_ticket(
        TicketCreate(
            title=title[:200],
            description="\n".join(lines),
            client_id=client_id,
            priority=str(data.get("priority") or ("high" if abandoned else "medium")),
            category=str(data.get("category") or "support"),
            ticket_type=str(data.get("ticket_type") or "incident"),
            source="voice",
            # One ticket per call, even if a technician submits twice.
            idempotency_key=f"voice-call:{settings.get('id') or 'primary'}:{call_id}",
        ),
        current_user,
    )
    ticket_id = getattr(ticket, "id", None) or (ticket.get("id") if isinstance(ticket, dict) else None)
    await log_activity(
        current_user,
        "voice_call_ticket_created",
        "ticket",
        str(ticket_id or ""),
        title,
        "Ticket raised from a PBX call record.",
        metadata={
            "client_id": client_id,
            "pbx_id": str(settings.get("id") or "primary"),
            "call_id": call_id,
            "abandoned": abandoned,
        },
    )
    return {
        "ticket_id": ticket_id,
        "pbx_id": str(settings.get("id") or "primary"),
        "call_id": call_id,
        "abandoned": abandoned,
    }


@router.get("/voice/audio/{artifact_kind}/{artifact_id}")
async def relay_voice_artifact(
    artifact_kind: str,
    artifact_id: str,
    pbx_id: str | None = None,
    ext_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Relay a recording or voicemail message to an authorised technician.

    Yeastar's download interfaces answer with a URL that authorises the fetch.
    That URL is resolved and followed server-side so it never reaches the
    browser, and the caller still has to hold the listening permission and the
    client scope for the PBX that holds the audio.
    """
    kind = str(artifact_kind or "").strip().lower()
    if kind not in ARTIFACT_ACTIONS:
        raise HTTPException(status_code=404, detail="Voice artifacts are recordings or voicemail messages")
    settings = await resolve_client_pbx(current_user, pbx_id, operation=f"voice.{kind}.listen")
    await assert_action_permission(current_user, ARTIFACT_ACTIONS[kind])

    if kind == "recording":
        operation_id = "recording.download"
        params: dict[str, Any] = {"id": artifact_id, "recording_id": artifact_id}
    else:
        operation_id = "voicemail.download"
        params = {"msg_id": artifact_id, "ext_id": ext_id or ""}

    payload = await _read_interface(settings, operation_id, params)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="The PBX did not return a download address for that artifact")
    url = next((payload.get(key) for key in DOWNLOAD_URL_KEYS if payload.get(key)), None)
    if not url:
        raise HTTPException(status_code=502, detail="The PBX returned no usable download address for that artifact")
    try:
        content, content_type = await yeastar_client.fetch_provider_url(str(url))
    except YeastarError as exc:
        raise _http_for(exc) from exc

    await log_activity(
        current_user,
        f"voice_{kind}_listened",
        "voice_pbx",
        str(settings.get("id") or "primary"),
        settings.get("name") or "Yeastar PBX",
        f"Listened to a {kind} from the PBX.",
        metadata={
            "client_id": str(settings.get("client_id") or ""),
            "artifact_id": artifact_id,
            "bytes": len(content),
        },
    )
    filename = f"{kind}-{uuid.uuid4().hex[:8]}"
    return StreamingResponse(
        iter([content]),
        media_type=content_type,
        headers={
            "Content-Length": str(len(content)),
            # The relay is a private customer artifact: never let a shared cache
            # hold it, and never expose the provider address.
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )
