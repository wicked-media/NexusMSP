from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import Response
from datetime import datetime, timezone
from typing import Any
import uuid

from app.database import db, ROOT_DIR
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.scope_permissions import assert_client_scope, tenant_scoped_query
from app.services.upload_quarantine import (
    UploadQuarantineFailure,
    discard_upload,
    inspect_upload,
    release_upload,
)
from app.services.upload_security import (
    ATTACHMENT_EXTENSIONS,
    safe_original_filename,
    safe_upload_extension,
    upload_is_releasable,
    validate_upload_signature,
)
from app.services.supabase_storage import archive_record_artifact, delete_artifact, read_artifact


UPLOAD_DIR = ROOT_DIR / "private_uploads" / "invoice_attachments"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


async def _enforce_invoice_scope(request: Request, current_user: dict = Depends(get_current_user)):
    invoice_id = request.path_params.get("invoice_id")
    if not invoice_id:
        return
    invoice = await db.invoices.find_one(
        tenant_scoped_query(current_user, {"id": invoice_id}),
        {"_id": 0, "id": 1, "client_id": 1},
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    await assert_client_scope(
        current_user,
        invoice.get("client_id"),
        request=request,
        operation=f"invoice_attachment:{request.method.lower()}",
        mask_not_found=True,
    )


router = APIRouter(dependencies=[Depends(_enforce_invoice_scope)])


def _attachment_response(attachment: dict) -> dict:
    """Return attachment metadata without private storage implementation details."""
    result = {
        key: value
        for key, value in attachment.items()
        if key not in {"_id", "stored_filename", "artifact_storage"}
    }
    result["download_url"] = (
        f"/api/invoices/{attachment['invoice_id']}/attachments/{attachment['id']}/download"
    )
    return result


async def store_invoice_attachment(
    *,
    invoice: dict,
    content: bytes,
    filename: str | None,
    content_type: str | None,
    uploaded_by: str,
    uploaded_by_name: str,
    source: str = "manual_upload",
    syncro_attachment_id: str | None = None,
    syncro_invoice_id: str | None = None,
    database: Any | None = None,
) -> dict:
    """Store an invoice attachment through the private quarantine/artifact path."""
    store = database or db
    if syncro_attachment_id:
        existing = await store.invoice_attachments.find_one(
            {
                "tenant_id": invoice.get("tenant_id") or "nexus-local",
                "invoice_id": invoice["id"],
                "syncro_attachment_id": str(syncro_attachment_id),
            },
            {"_id": 0},
        )
        if existing:
            return _attachment_response(existing)
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 25MB)")
    ext = safe_upload_extension(filename, allowed=ATTACHMENT_EXTENSIONS, default="bin")
    validate_upload_signature(content, ext)
    attachment_id = str(uuid.uuid4())
    stored_filename = f"{str(invoice['id'])[:8]}_{uuid.uuid4().hex[:8]}.{ext}"
    try:
        clean_upload = await inspect_upload(
            database=store,
            content=content,
            filename=filename,
            content_type=content_type,
            tenant_id=invoice.get("tenant_id"),
            client_id=invoice.get("client_id"),
            target_type="invoice_attachment",
            target_id=str(invoice["id"]),
            actor_id=uploaded_by,
            actor_name=uploaded_by_name,
        )
    except UploadQuarantineFailure as exc:
        if exc.rejected:
            raise HTTPException(status_code=422, detail="Upload rejected by malware scanner") from exc
        raise HTTPException(status_code=503, detail="Upload scanning is temporarily unavailable") from exc

    now = datetime.now(timezone.utc).isoformat()
    attachment = {
        "id": attachment_id,
        "invoice_id": invoice["id"],
        "invoice_number": invoice.get("invoice_number") or None,
        "tenant_id": invoice.get("tenant_id") or "nexus-local",
        "client_id": invoice.get("client_id") or None,
        "filename": safe_original_filename(filename),
        "stored_filename": stored_filename,
        "size": len(content),
        "content_type": content_type or "application/octet-stream",
        "uploaded_by": uploaded_by,
        "uploaded_by_name": uploaded_by_name,
        "source": source,
        "syncro_attachment_id": str(syncro_attachment_id) if syncro_attachment_id else None,
        "syncro_invoice_id": str(syncro_invoice_id) if syncro_invoice_id else None,
        "security_scan": clean_upload.metadata(),
        "created_at": now,
    }
    attachment = {key: value for key, value in attachment.items() if value is not None}
    local_path = UPLOAD_DIR / stored_filename
    artifact_path = None
    inserted = False
    try:
        local_path.write_bytes(content)
        artifact_path = await archive_record_artifact(
            "invoice-attachments",
            attachment_id,
            content,
            ext,
            content_type or "application/octet-stream",
        )
        if artifact_path:
            attachment["artifact_storage"] = {
                "provider": "supabase",
                "object_path": artifact_path,
                "mirrored_at": now,
            }
        await store.invoice_attachments.insert_one(attachment)
        inserted = True
        await store.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": "invoice_attachment_added",
            "entity_type": "invoice_attachment",
            "entity_id": attachment_id,
            "entity_name": attachment["filename"],
            "invoice_id": invoice["id"],
            "invoice_number": invoice.get("invoice_number"),
            "tenant_id": attachment["tenant_id"],
            "client_id": invoice.get("client_id") or None,
            "user_id": uploaded_by,
            "user_name": uploaded_by_name,
            "metadata": {
                "size": attachment["size"],
                "content_type": attachment["content_type"],
                "source": source,
                "private_artifact": bool(artifact_path),
                "scan_status": "clean",
            },
            "created_at": now,
        })
    except Exception:
        local_path.unlink(missing_ok=True)
        if artifact_path:
            await delete_artifact(artifact_path)
        if inserted:
            await store.invoice_attachments.delete_one({"id": attachment_id})
        await discard_upload(store, clean_upload)
        raise
    await release_upload(store, clean_upload)
    return _attachment_response(attachment)


@router.get(
    "/invoices/{invoice_id}/attachments",
    dependencies=[Depends(require_action("billing.portal.view"))],
)
async def get_invoice_attachments(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """List attachments for one invoice after tenant and client scope checks."""
    attachments = await db.invoice_attachments.find(
        tenant_scoped_query(current_user, {"invoice_id": invoice_id}),
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    return [_attachment_response(attachment) for attachment in attachments]


@router.get(
    "/invoices/{invoice_id}/attachments/{attachment_id}/download",
    dependencies=[Depends(require_action("billing.portal.view"))],
)
async def download_invoice_attachment(
    invoice_id: str,
    attachment_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Serve a retained invoice attachment only through the authorised route."""
    attachment = await db.invoice_attachments.find_one(
        tenant_scoped_query(
            current_user,
            {"id": attachment_id, "invoice_id": invoice_id},
        ),
        {"_id": 0},
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not upload_is_releasable(attachment):
        raise HTTPException(status_code=423, detail="Attachment has not passed security scanning")
    object_path = (attachment.get("artifact_storage") or {}).get("object_path")
    if object_path:
        artifact = await read_artifact(object_path)
        if not artifact:
            raise HTTPException(status_code=404, detail="Retained attachment is unavailable")
        content, content_type = artifact
    else:
        stored_filename = safe_original_filename(attachment.get("stored_filename"), default="missing")
        local_path = UPLOAD_DIR / stored_filename
        if not local_path.is_file():
            raise HTTPException(status_code=404, detail="Retained attachment is unavailable")
        content = local_path.read_bytes()
        content_type = attachment.get("content_type") or "application/octet-stream"
    filename = safe_original_filename(attachment.get("filename"), default="attachment")
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "invoice_attachment_downloaded",
        "entity_type": "invoice_attachment",
        "entity_id": attachment_id,
        "entity_name": filename,
        "invoice_id": invoice_id,
        "invoice_number": attachment.get("invoice_number"),
        "tenant_id": attachment.get("tenant_id") or "nexus-local",
        "client_id": attachment.get("client_id"),
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name") or current_user.get("email") or current_user.get("id"),
        "metadata": {
            "filename": filename,
            "source": attachment.get("source"),
            "private_artifact": bool(object_path),
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return Response(
        content=content,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )
