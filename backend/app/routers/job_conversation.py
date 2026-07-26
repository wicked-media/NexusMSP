"""Shared client communications for workshop and field service jobs."""
from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.avatar_enrichment import attach_user_avatars

router = APIRouter()


JOB_TYPES = {
    "workshop": {"collection": "workshop_jobs", "notes": "workshop_notes", "audit": "workshop_audit_log", "label": "workshop job"},
    "field": {"collection": "field_jobs", "notes": "field_notes", "audit": "field_audit_log", "label": "field job"},
}


async def _job_or_404(job_type: str, job_id: str):
    config = JOB_TYPES.get(job_type)
    if not config:
        raise HTTPException(status_code=404, detail="Unknown job type")
    job = await db[config["collection"]].find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail=f"{config['label'].title()} not found")
    return config, job


async def _audit(config, job_id: str, user: dict, action: str, details: str):
    await db[config["audit"]].insert_one({
        "id": str(uuid.uuid4()), "job_id": job_id, "action": action, "details": details,
        "user_id": user.get("id", "system"), "user_name": user.get("name", "System"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


@router.get("/{job_type}-jobs/{job_id}/conversation")
async def get_job_conversation(job_type: str, job_id: str, current_user: dict = Depends(get_current_user)):
    config, _ = await _job_or_404(job_type, job_id)
    notes, emails, sms = await __import__("asyncio").gather(
        db[config["notes"]].find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(500),
        db.job_emails.find({"job_type": job_type, "job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(500),
        db.sms_messages.find({"job_type": job_type, "job_id": job_id}, {"_id": 0, "provider_response": 0, "raw_payload": 0}).sort("sent_at", -1).to_list(500),
    )
    await attach_user_avatars(notes)
    await attach_user_avatars(emails, id_fields=("user_id",), output_field="avatar_url")
    return {"notes": notes, "emails": emails, "sms": sms}


@router.post("/{job_type}-jobs/{job_id}/conversation/note")
async def add_job_note(job_type: str, job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    config, job = await _job_or_404(job_type, job_id)
    content = (data.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Note content is required")
    visibility = str(data.get("visibility") or "").strip().lower()
    is_internal = visibility != "public" if visibility else bool(data.get("is_internal", True))
    notify_client = bool(data.get("notify_client", False)) and not is_internal
    recipients = [
        str(address or "").strip()
        for address in (data.get("to_addresses") or [])
        if str(address or "").strip()
    ]
    if notify_client and not recipients and str(job.get("customer_email") or "").strip():
        recipients.append(str(job["customer_email"]).strip())
    if notify_client and not recipients:
        raise HTTPException(
            status_code=400,
            detail="This public update has no recipient. Add an email address or publish without email.",
        )

    subject_label = str(data.get("subject_label") or "Update").strip() or "Update"
    number = job.get("job_number", job_id)
    subject = str(data.get("subject") or "").strip() or f"{subject_label}: [{number}] {job.get('title') or config['label'].title()}"
    delivery = {}
    if notify_client:
        from app.routers.email_signatures import append_default_signature
        from app.routers.email_utils import send_email

        body, body_type, _ = await append_default_signature(
            body=content,
            body_type="html" if "<" in content else "text",
            current_user=current_user,
            subject=subject,
            ticket_id=None,
        )
        delivery = await send_email(
            recipients,
            subject,
            body if body_type == "html" else f"<pre>{body}</pre>",
            category="service_job_comments",
            client_id=job.get("client_id"),
            related_type=f"{job_type}_job",
            related_id=job_id,
            initiated_by=current_user.get("id"),
            initiated_by_name=current_user.get("name"),
        )

    note = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "user_id": current_user["id"],
        "user_name": current_user.get("name", ""),
        "avatar_url": current_user.get("avatar"),
        "content": content,
        "note_type": "conversation",
        "is_internal": is_internal,
        "visibility": "internal" if is_internal else "public",
        "portal_visible": not is_internal,
        "client_notified": notify_client,
        "to_addresses": recipients if notify_client else [],
        "subject": subject if not is_internal else "",
        "subject_label": subject_label if not is_internal else "",
        "delivery_status": delivery.get("status") if notify_client else "portal_only" if not is_internal else "internal",
        "delivery_message": delivery.get("message", "") if notify_client else "",
        "delivery_id": (delivery.get("delivery_id") or delivery.get("email_id")) if notify_client else None,
        "sender_mailbox": delivery.get("sender") if notify_client else None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db[config["notes"]].insert_one(dict(note))
    await _audit(
        config,
        job_id,
        current_user,
        "conversation_public_update_added" if not is_internal else "conversation_note_added",
        f"Published client update to {', '.join(recipients)} ({note['delivery_status']})"
        if notify_client
        else "Published client-visible update"
        if not is_internal
        else "Internal conversation note added",
    )
    return note


@router.post("/{job_type}-jobs/{job_id}/conversation/email")
async def send_job_email(job_type: str, job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    config, job = await _job_or_404(job_type, job_id)
    recipients = [address.strip() for address in (data.get("to_addresses") or []) if address and address.strip()]
    if not recipients:
        raise HTTPException(status_code=400, detail="Add at least one recipient")
    number = job.get("job_number", job_id)
    subject = data.get("subject") or f"Update: {number}"
    body = data.get("body") or ""
    from app.routers.email_signatures import append_default_signature
    from app.routers.email_utils import send_email
    body, body_type, _ = await append_default_signature(
        body=body, body_type=data.get("body_type", "html"), current_user=current_user,
        subject=subject, ticket_id=None,
    )
    delivery = await send_email(recipients, subject, body if body_type == "html" else f"<pre>{body}</pre>", category="service_job_replies", cc_addresses=data.get("cc") or [], bcc_addresses=data.get("bcc") or [], client_id=job.get("client_id"), related_type=f"{job_type}_job", related_id=job_id, initiated_by=current_user.get("id"), initiated_by_name=current_user.get("name"))
    email = {"id": str(uuid.uuid4()), "job_type": job_type, "job_id": job_id, "client_id": job.get("client_id"), "job_number": number, "user_id": current_user.get("id"), "avatar_url": current_user.get("avatar"), "from_address": current_user.get("email", ""), "from_name": current_user.get("name", ""), "to_addresses": recipients, "cc_addresses": data.get("cc") or [], "bcc_addresses": data.get("bcc") or [], "subject": subject, "body": body, "body_type": body_type, "direction": "outbound", "status": delivery.get("status", "failed"), "delivery_message": delivery.get("message", ""), "sender_mailbox": delivery.get("sender"), "created_at": datetime.now(timezone.utc).isoformat()}
    await db.job_emails.insert_one(email)
    await _audit(config, job_id, current_user, "conversation_email_sent", f"Email sent to {', '.join(recipients)}")
    return email


@router.post("/{job_type}-jobs/{job_id}/conversation/sms")
async def send_job_sms(job_type: str, job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    config, job = await _job_or_404(job_type, job_id)
    phone = (data.get("to") or job.get("customer_phone") or "").strip()
    message = (data.get("message") or "").strip()
    if not phone or not message:
        raise HTTPException(status_code=400, detail="Recipient and message are required")
    from app.routers.sms import send_sms
    result = await send_sms({"to": phone, "message": message, "client_id": job.get("client_id"), "client_name": job.get("customer_name"), "job_type": job_type, "job_id": job_id, "custom_ref": f"{job_type}-{job_id}"}, current_user=current_user)
    await _audit(config, job_id, current_user, "conversation_sms_sent", f"SMS sent to {phone}")
    return result
