"""Audited technician-to-endpoint transfer staging for the Nexus Agent."""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import Response

from app.database import ROOT_DIR, db
from app.routers.nexus_agent import _verify_agent_token, queue_command_for_device, require_agent_operator
from app.services.action_permissions import require_action
from app.services.scope_permissions import assert_tenant_record_scope, platform_tenant_id
from app.services.upload_quarantine import UploadQuarantineFailure, discard_upload, inspect_upload, release_upload
from app.services.upload_security import ATTACHMENT_EXTENSIONS, safe_original_filename, safe_upload_extension, validate_upload_signature


router = APIRouter(tags=["Nexus Agent File Transfer"])
TRANSFER_DIR = ROOT_DIR / "private_uploads" / "agent_file_transfers"
TRANSFER_DIR.mkdir(parents=True, exist_ok=True)
MAX_TRANSFER_BYTES = 25 * 1024 * 1024


from app.services.time_utils import now_iso as _now


def _safe_transfer(transfer: dict) -> dict:
    return {key: value for key, value in transfer.items() if key not in {"_id", "stored_name", "security_scan"}}


def _bound_retrieval_update_query(transfer_id: str, agent: dict) -> dict:
    """Keep the retrieval state transition bound to the authenticated Agent."""
    return {
        "id": transfer_id,
        "tenant_id": platform_tenant_id(agent),
        "agent_id": agent["id"],
        "client_id": agent.get("client_id"),
        "direction": "endpoint_to_technician",
        "status": {"$in": ["queued", "dispatched"]},
    }


@router.get("/devices/{device_id}/file-transfers")
async def list_file_transfers(device_id: str, current_user: dict = Depends(require_agent_operator)):
    """List bounded, scoped transfer evidence without exposing storage paths."""
    await assert_tenant_record_scope(current_user, db.devices, device_id, operation="device.file_transfer.list", resource_name="Managed asset")
    rows = await db.agent_file_transfers.find({"tenant_id": platform_tenant_id(current_user), "device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return [_safe_transfer(row) for row in rows]


@router.post("/devices/{device_id}/file-browser/list", dependencies=[Depends(require_action("device.command.execute"))])
async def request_directory_listing(
    device_id: str,
    data: dict = Body(...),
    current_user: dict = Depends(require_agent_operator),
):
    """Queue one read-only endpoint directory listing through the signed Agent."""
    device = await assert_tenant_record_scope(current_user, db.devices, device_id, operation="device.file_browser.list", resource_name="Managed asset")
    directory = str(data.get("directory") or "").strip()
    if not directory:
        raise HTTPException(400, "An absolute endpoint directory is required")
    command_id = await queue_command_for_device(device, "file_browser_list", {"directory": directory, "timeout_sec": 120}, current_user.get("email") or current_user.get("id") or "file-browser")
    if not command_id:
        raise HTTPException(409, "Nexus Agent is unavailable")
    return {"command_id": command_id, "agent_id": device.get("nexus_agent_id"), "directory": directory, "status": "queued"}


@router.post("/devices/{device_id}/file-transfers", dependencies=[Depends(require_action("device.command.execute"))])
async def stage_file_transfer(
    device_id: str,
    destination: str = Form(..., max_length=500),
    file: UploadFile = File(...),
    current_user: dict = Depends(require_agent_operator),
):
    """Stage a scanned file for one enrolled Agent to pull to an explicit path."""
    device = await assert_tenant_record_scope(current_user, db.devices, device_id, operation="device.file_transfer.stage", resource_name="Managed asset")
    if not device.get("nexus_agent_id"):
        raise HTTPException(409, "Nexus Agent is not enrolled on this asset")
    target = str(destination or "").strip()
    if not target:
        raise HTTPException(400, "An explicit endpoint destination is required")
    content = await file.read(MAX_TRANSFER_BYTES + 1)
    if len(content) > MAX_TRANSFER_BYTES:
        raise HTTPException(413, "File transfer is limited to 25MB")
    extension = safe_upload_extension(file.filename, allowed=ATTACHMENT_EXTENSIONS, default="bin")
    validate_upload_signature(content, extension)
    tenant_id = platform_tenant_id(current_user)
    transfer_id = f"xfer-{uuid.uuid4().hex}"
    try:
        clean_upload = await inspect_upload(
            database=db, content=content, filename=file.filename, content_type=file.content_type,
            tenant_id=tenant_id, client_id=device.get("client_id"), target_type="agent_file_transfer",
            target_id=transfer_id, actor_id=current_user.get("id"), actor_name=current_user.get("name") or current_user.get("email") or "Technician",
        )
    except UploadQuarantineFailure as exc:
        if exc.rejected:
            raise HTTPException(422, "File transfer was rejected by malware scanning") from exc
        raise HTTPException(503, "File scanning is temporarily unavailable") from exc
    filename = safe_original_filename(file.filename, default="transfer")
    stored_name = f"{transfer_id}.{extension}"
    path = TRANSFER_DIR / stored_name
    record = {
        "id": transfer_id, "tenant_id": tenant_id, "client_id": device.get("client_id"), "device_id": device_id,
        "agent_id": device["nexus_agent_id"], "direction": "technician_to_endpoint", "status": "staged",
        "filename": filename, "stored_name": stored_name, "destination": target, "size": len(content),
        "sha256": hashlib.sha256(content).hexdigest(), "content_type": file.content_type or "application/octet-stream",
        "security_scan": clean_upload.metadata(), "created_by": current_user.get("id"), "created_at": _now(),
    }
    try:
        path.write_bytes(content)
        command_id = await queue_command_for_device(device, "file_transfer_download", {
            "transfer_id": transfer_id, "destination": target, "sha256": record["sha256"], "timeout_sec": 900,
        }, current_user.get("email") or current_user.get("id") or "file-transfer")
        if not command_id:
            raise HTTPException(409, "Nexus Agent is unavailable")
        record.update({"status": "queued", "command_id": command_id, "queued_at": _now()})
        await db.agent_file_transfers.insert_one(record)
    except Exception:
        path.unlink(missing_ok=True)
        await discard_upload(db, clean_upload)
        raise
    await release_upload(db, clean_upload)
    return {key: record[key] for key in ("id", "status", "filename", "destination", "size", "sha256", "command_id", "created_at")}


@router.get("/nexus-agent/file-transfers/{transfer_id}/content")
async def get_staged_transfer_content(
    transfer_id: str,
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None),
):
    """Only the bound enrolled Agent may pull a still-queued transfer artifact."""
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    transfer = await db.agent_file_transfers.find_one({
        "id": transfer_id, "tenant_id": platform_tenant_id(agent), "agent_id": agent["id"],
        "client_id": agent.get("client_id"), "direction": "technician_to_endpoint", "status": {"$in": ["queued", "dispatched"]},
    }, {"_id": 0})
    if not transfer:
        raise HTTPException(404, "Staged file transfer is unavailable")
    path = TRANSFER_DIR / str(transfer.get("stored_name") or "")
    if not path.is_file():
        raise HTTPException(410, "Staged file transfer artifact is unavailable")
    return Response(content=path.read_bytes(), media_type=transfer.get("content_type") or "application/octet-stream", headers={
        "Cache-Control": "no-store", "Content-Disposition": f'attachment; filename="{safe_original_filename(transfer.get("filename"), default="transfer")}"',
    })


@router.post("/devices/{device_id}/file-retrievals", dependencies=[Depends(require_action("device.command.execute"))])
async def request_file_retrieval(
    device_id: str,
    source_path: str = Form(..., max_length=500),
    current_user: dict = Depends(require_agent_operator),
):
    """Ask one bound Agent to stage one explicit endpoint file for retrieval."""
    device = await assert_tenant_record_scope(current_user, db.devices, device_id, operation="device.file_transfer.retrieve", resource_name="Managed asset")
    source = str(source_path or "").strip()
    if not source or Path(source).name in {"", ".", ".."}:
        raise HTTPException(400, "An explicit endpoint source file is required")
    if not device.get("nexus_agent_id"):
        raise HTTPException(409, "Nexus Agent is not enrolled on this asset")
    transfer_id = f"xfer-{uuid.uuid4().hex}"
    record = {
        "id": transfer_id, "tenant_id": platform_tenant_id(current_user), "client_id": device.get("client_id"),
        "device_id": device_id, "agent_id": device["nexus_agent_id"], "direction": "endpoint_to_technician",
        "status": "queued", "source_path": source, "filename": Path(source).name, "created_by": current_user.get("id"), "created_at": _now(),
    }
    command_id = await queue_command_for_device(device, "file_transfer_upload", {"transfer_id": transfer_id, "source_path": source, "timeout_sec": 900}, current_user.get("email") or current_user.get("id") or "file-transfer")
    if not command_id:
        raise HTTPException(409, "Nexus Agent is unavailable")
    record["command_id"] = command_id
    await db.agent_file_transfers.insert_one(record)
    return {key: record[key] for key in ("id", "status", "filename", "source_path", "command_id", "created_at")}


@router.put("/nexus-agent/file-transfers/{transfer_id}/content")
async def stage_retrieved_transfer_content(
    transfer_id: str,
    request: Request,
    x_nexus_transfer_sha256: str | None = Header(None),
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None),
):
    """Accept a bounded Agent-upload only for its own queued retrieval request."""
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    transfer = await db.agent_file_transfers.find_one({"id": transfer_id, "tenant_id": platform_tenant_id(agent), "agent_id": agent["id"], "client_id": agent.get("client_id"), "direction": "endpoint_to_technician", "status": {"$in": ["queued", "dispatched"]}}, {"_id": 0})
    if not transfer:
        raise HTTPException(404, "File retrieval is unavailable")
    content = await request.body()
    if not content or len(content) > MAX_TRANSFER_BYTES:
        raise HTTPException(413, "Retrieved file must be between 1 byte and 25MB")
    digest = hashlib.sha256(content).hexdigest()
    if digest != str(x_nexus_transfer_sha256 or "").lower():
        raise HTTPException(422, "Retrieved file checksum did not match Agent evidence")
    extension = safe_upload_extension(transfer.get("filename"), allowed=ATTACHMENT_EXTENSIONS, default="bin")
    validate_upload_signature(content, extension)
    try:
        clean_upload = await inspect_upload(database=db, content=content, filename=transfer.get("filename"), content_type="application/octet-stream", tenant_id=transfer["tenant_id"], client_id=transfer.get("client_id"), target_type="agent_file_retrieval", target_id=transfer_id, actor_id=agent["id"], actor_name=agent.get("hostname") or "Nexus Agent")
    except UploadQuarantineFailure as exc:
        raise HTTPException(422 if exc.rejected else 503, "Retrieved file was rejected or scanning is unavailable") from exc
    stored_name = f"{transfer_id}.{extension}"
    path = TRANSFER_DIR / stored_name
    try:
        path.write_bytes(content)
        await db.agent_file_transfers.update_one(
            _bound_retrieval_update_query(transfer_id, agent),
            {"$set": {"status": "staged", "stored_name": stored_name, "size": len(content), "sha256": digest, "security_scan": clean_upload.metadata(), "staged_at": _now()}},
        )
    except Exception:
        path.unlink(missing_ok=True)
        await discard_upload(db, clean_upload)
        raise
    await release_upload(db, clean_upload)
    return {"id": transfer_id, "status": "staged", "sha256": digest}


@router.get("/devices/{device_id}/file-transfers/{transfer_id}/download")
async def download_retrieved_transfer(device_id: str, transfer_id: str, current_user: dict = Depends(require_agent_operator)):
    """Serve a scanned endpoint retrieval only after technician device scope checks."""
    await assert_tenant_record_scope(current_user, db.devices, device_id, operation="device.file_transfer.download", resource_name="Managed asset")
    transfer = await db.agent_file_transfers.find_one({"id": transfer_id, "tenant_id": platform_tenant_id(current_user), "device_id": device_id, "direction": "endpoint_to_technician", "status": "staged"}, {"_id": 0})
    if not transfer:
        raise HTTPException(404, "Retrieved file is unavailable")
    path = TRANSFER_DIR / str(transfer.get("stored_name") or "")
    if not path.is_file():
        raise HTTPException(410, "Retrieved file artifact is unavailable")
    return Response(content=path.read_bytes(), media_type="application/octet-stream", headers={"Cache-Control": "private, no-store", "Content-Disposition": f'attachment; filename="{safe_original_filename(transfer.get("filename"), default="retrieved-file")}"'})
