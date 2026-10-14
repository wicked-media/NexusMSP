from fastapi import APIRouter, Depends, HTTPException, Request
from datetime import datetime, timezone, timedelta
from html import escape
import math
from app.database import db
from app.auth import get_current_user
from app.routers.email_utils import send_email
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.public_url import configured_public_base_url
from app.services.scope_permissions import assert_client_scope
import random
import uuid
from urllib.parse import quote, urlparse

_rng = random.SystemRandom()
router = APIRouter()

_TERMINAL_INVOICE_STATUSES = frozenset({"cancelled", "voided"})
_SETTLED_PAYMENT_STATUSES = frozenset({"paid", "settled", "confirmed", "succeeded", "completed", "complete"})


def _text(value: object, *, fallback: str = "") -> str:
    """Return a bounded, header-safe text value from an authoritative record."""
    value = str(value or fallback).replace("\r", " ").replace("\n", " ").strip()
    return value[:500]


def _safe_brand_colour(value: object) -> str:
    """Allow only a simple hexadecimal colour in inline email CSS."""
    colour = _text(value)
    if len(colour) in {4, 7} and colour.startswith("#") and all(
        character in "0123456789abcdefABCDEF" for character in colour[1:]
    ):
        return colour
    return "#10b981"


def _safe_portal_url(value: object) -> str:
    """Keep email links to normal web URLs even if this helper is reused."""
    url = _text(value)
    parsed = urlparse(url)
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if (
        parsed.username
        or parsed.password
        or not parsed.hostname
        or (parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in local_hosts))
    ):
        return ""
    return url


def _money(value: object, *, field_name: str) -> float:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=409, detail=f"Stored {field_name} is invalid") from None
    if not math.isfinite(amount) or amount < 0:
        raise HTTPException(status_code=409, detail=f"Stored {field_name} is invalid")
    return round(amount, 2)


def _invoice_balance(invoice: dict) -> float:
    return round(
        max(
            0.0,
            _money(invoice.get("total"), field_name="invoice total")
            - _money(invoice.get("amount_paid"), field_name="invoice amount paid"),
        ),
        2,
    )


def _due_date_and_days_late(invoice: dict) -> tuple[str, int]:
    due_date = _text(invoice.get("due_date"))
    if not due_date:
        return "Not specified", 0
    try:
        parsed = datetime.fromisoformat(due_date.replace("Z", "+00:00")) if "T" in due_date else datetime.strptime(due_date, "%Y-%m-%d")
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return due_date, max(0, (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).days)
    except (TypeError, ValueError):
        # The stored due date is still safe to display, but a malformed record
        # must not turn a browser supplied overdue value into financial truth.
        return due_date, 0


def _client_billing_email(client: dict) -> str:
    for field in ("billing_email", "email", "contact_email"):
        value = _text(client.get(field))
        if value:
            return value
    return ""


async def _load_scoped_invoice_and_client(
    data: dict,
    current_user: dict,
    request: Request | None,
    *,
    operation: str,
) -> tuple[dict, dict]:
    """Resolve all commercial email facts from one scoped invoice and client."""
    invoice_id = _text(data.get("invoice_id"))
    if not invoice_id:
        raise HTTPException(status_code=422, detail="invoice_id is required")

    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    client_id = _text(invoice.get("client_id"))
    await assert_client_scope(
        current_user,
        client_id,
        operation=operation,
        request=request,
        mask_not_found=True,
    )
    if not client_id:
        raise HTTPException(status_code=409, detail="Invoice is missing client ownership")

    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        # Do not turn a stale or corrupted invoice into an opportunity to use a
        # browser supplied recipient or display name.
        raise HTTPException(status_code=404, detail="Client not found")
    return invoice, client


async def _payment_url_for_invoice(invoice: dict) -> tuple[str, str | None]:
    """Return only a valid active, server-owned payment capability URL."""
    link = await db.payment_links.find_one(
        {
            "invoice_id": invoice.get("id"),
            "client_id": invoice.get("client_id"),
            "status": "active",
        },
        {"_id": 0, "id": 1, "token": 1, "expires_at": 1},
    )
    if not link:
        return "", None
    expires_at = _text(link.get("expires_at"))
    if expires_at:
        try:
            expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            if expiry <= datetime.now(timezone.utc):
                return "", None
        except ValueError:
            # Invalid or legacy capability metadata is not safe to issue.
            return "", None
    token = _text(link.get("token"))
    if not token:
        return "", None
    try:
        public_base = configured_public_base_url()
    except RuntimeError:
        # Payment is optional in a reminder.  Omit it rather than trusting a
        # caller-controlled origin or exposing deployment configuration.
        return "", None
    return f"{public_base}/pay/{quote(token, safe='-_')}", _text(link.get("id")) or None


async def _load_settled_payment(invoice: dict, data: dict) -> tuple[dict, dict | None]:
    """Resolve one settled payment record bound to the scoped invoice."""
    payment_id = _text(data.get("payment_id") or data.get("payment_transaction_id"))
    if not payment_id:
        raise HTTPException(status_code=422, detail="payment_id is required")

    payment = await db.payment_transactions.find_one(
        {
            "id": payment_id,
            "invoice_id": invoice.get("id"),
            "client_id": invoice.get("client_id"),
        },
        {"_id": 0},
    )
    if not payment:
        # Payment-link records expose a stable payment ID, while the internal
        # transaction has its own stable Nexus ID.  Resolve both server-side.
        payment = await db.payment_transactions.find_one(
            {
                "payment_link_payment_id": payment_id,
                "invoice_id": invoice.get("id"),
                "client_id": invoice.get("client_id"),
            },
            {"_id": 0},
        )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment record not found")

    status = _text(payment.get("payment_status") or payment.get("status")).lower()
    payment_link: dict | None = None
    if status not in _SETTLED_PAYMENT_STATUSES and payment.get("payment_link_id"):
        payment_link = await db.payment_links.find_one(
            {
                "id": payment.get("payment_link_id"),
                "invoice_id": invoice.get("id"),
                "client_id": invoice.get("client_id"),
            },
            {"_id": 0, "id": 1, "payments": 1},
        )
        linked_payment_id = _text(payment.get("payment_link_payment_id"))
        linked_payment = next(
            (
                item
                for item in (payment_link or {}).get("payments", [])
                if isinstance(item, dict) and _text(item.get("id")) == linked_payment_id
            ),
            None,
        )
        if linked_payment and _text(linked_payment.get("status")).lower() in _SETTLED_PAYMENT_STATUSES:
            payment = {**payment, **{key: value for key, value in linked_payment.items() if key in {"amount", "method", "payment_method", "date"}}}
            status = _text(linked_payment.get("status")).lower()

    if status not in _SETTLED_PAYMENT_STATUSES:
        raise HTTPException(status_code=409, detail="Payment has not been settled")
    return payment, payment_link


def _late_reminder_html(client_name, invoice_number, amount, due_date, days_late, msp_name, primary_color, portal_url):
    client_name = escape(_text(client_name), quote=True)
    invoice_number = escape(_text(invoice_number), quote=True)
    due_date = escape(_text(due_date, fallback="Not specified"), quote=True)
    msp_name = escape(_text(msp_name, fallback="NexusMSP"), quote=True)
    primary_color = _safe_brand_colour(primary_color)
    safe_amount = _money(amount, field_name="reminder amount")
    try:
        safe_days_late = max(0, int(days_late or 0))
    except (TypeError, ValueError):
        safe_days_late = 0
    payment_button = ""
    if safe_portal_url := _safe_portal_url(portal_url):
        payment_button = (
            f'<a href="{escape(safe_portal_url, quote=True)}" '
            f'style="display: inline-block; background: {primary_color}; color: #fff; padding: 12px 28px; '
            'border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Pay Now</a>'
        )
    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: {primary_color}; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 20px; color: #fff;">{msp_name}</h1>
        <p style="margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.8);">Payment Reminder</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="margin: 0 0 8px; font-size: 18px; color: #f8fafc;">Payment Overdue</h2>
        <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
           Hi {client_name}, this is a friendly reminder that invoice <strong style="color: #f8fafc;">{invoice_number}</strong>
           is now <strong style="color: #f97316;">{safe_days_late} days overdue</strong>.
        </p>
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Invoice:</td><td style="padding: 6px 0; color: #f8fafc; font-size: 14px; font-weight: 600;">{invoice_number}</td></tr>
             <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Amount Due:</td><td style="padding: 6px 0; color: #f97316; font-size: 14px; font-weight: 600;">${safe_amount:,.2f}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Due Date:</td><td style="padding: 6px 0; color: #f8fafc; font-size: 14px;">{due_date}</td></tr>
             <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Days Overdue:</td><td style="padding: 6px 0; color: #ef4444; font-size: 14px; font-weight: 600;">{safe_days_late} days</td></tr>
          </table>
        </div>
         {payment_button}
        <p style="color: #64748b; font-size: 12px; margin-top: 20px;">If you have already made this payment, please disregard this notice. For questions, contact our accounts team.</p>
      </div>
    </div>
    """


def _payment_confirmation_html(client_name, invoice_number, amount, payment_method, msp_name, primary_color):
    client_name = escape(_text(client_name), quote=True)
    invoice_number = escape(_text(invoice_number), quote=True)
    payment_method = escape(_text(payment_method, fallback="Payment"), quote=True)
    msp_name = escape(_text(msp_name, fallback="NexusMSP"), quote=True)
    safe_amount = _money(amount, field_name="payment amount")
    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: #059669; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 20px; color: #fff;">{msp_name}</h1>
        <p style="margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.8);">Payment Confirmation</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="margin: 0 0 8px; font-size: 18px; color: #f8fafc;">Payment Received!</h2>
        <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
          Thank you, {client_name}. We've received your payment for invoice <strong style="color: #f8fafc;">{invoice_number}</strong>.
        </p>
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Invoice:</td><td style="padding: 6px 0; color: #f8fafc; font-size: 14px; font-weight: 600;">{invoice_number}</td></tr>
             <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Amount Paid:</td><td style="padding: 6px 0; color: #10b981; font-size: 14px; font-weight: 600;">${safe_amount:,.2f}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Method:</td><td style="padding: 6px 0; color: #f8fafc; font-size: 14px;">{payment_method}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Date:</td><td style="padding: 6px 0; color: #f8fafc; font-size: 14px;">{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}</td></tr>
          </table>
        </div>
        <p style="color: #64748b; font-size: 12px;">This is an automated confirmation. No action is required.</p>
      </div>
    </div>
    """


# ============== PREDICTIONS ==============

@router.get("/late-payment/predictions")
async def late_payment_predictions(current_user: dict = Depends(get_current_user)):
    """Get late payment predictions based on actual invoice data + AI risk scoring."""
    # Build predictions from real overdue invoices
    now = datetime.now(timezone.utc)
    all_invoices = await db.invoices.find(
        {"payment_status": {"$nin": ["paid"]}, "due_date": {"$exists": True}},
        {"_id": 0, "id": 1, "invoice_number": 1, "client_id": 1, "client_name": 1,
         "total": 1, "amount_paid": 1, "amount_due": 1, "due_date": 1, "payment_status": 1}
    ).to_list(500)

    predictions = []
    client_stats = {}

    for inv in all_invoices:
        cid = inv.get("client_id", "")
        cname = inv.get("client_name", "Unknown")
        balance = float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
        if balance <= 0:
            continue

        due = inv.get("due_date", "")
        try:
            due_dt = datetime.fromisoformat(due.replace("Z", "+00:00")) if "T" in due else datetime.strptime(due, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            days_overdue = (now - due_dt).days
        except Exception:
            days_overdue = 0

        if cid not in client_stats:
            client_stats[cid] = {"name": cname, "total_outstanding": 0, "invoices": [], "overdue_count": 0}
        client_stats[cid]["total_outstanding"] += balance
        client_stats[cid]["invoices"].append({"id": inv["id"], "number": inv.get("invoice_number", ""), "balance": balance, "days_overdue": days_overdue, "due_date": due})
        if days_overdue > 0:
            client_stats[cid]["overdue_count"] += 1

    for cid, stats in client_stats.items():
        max_overdue = max((i["days_overdue"] for i in stats["invoices"]), default=0)
        overdue_count = stats["overdue_count"]
        # Risk scoring
        if max_overdue > 30 or overdue_count >= 3:
            risk = "high"
            probability = min(95, 60 + max_overdue)
        elif max_overdue > 14 or overdue_count >= 2:
            risk = "medium"
            probability = min(80, 40 + max_overdue)
        elif max_overdue > 0:
            risk = "low"
            probability = min(50, 10 + max_overdue * 2)
        else:
            risk = "none"
            probability = 5

        if risk == "none":
            continue

        predictions.append({
            "id": f"lp-{cid}",
            "client_id": cid,
            "client_name": stats["name"],
            "risk": risk,
            "outstanding_amount": round(stats["total_outstanding"], 2),
            "overdue_count": overdue_count,
            "max_days_overdue": max_overdue,
            "probability_pct": probability,
            "invoices": stats["invoices"][:5],
            "recommended_action": "Send immediate reminder" if risk == "high" else "Schedule follow-up" if risk == "medium" else "Monitor",
        })

    # If no real data, fall back to seed
    if not predictions:
        preds = await db.late_payment_predictions.find({}, {"_id": 0}).to_list(50)
        if not preds:
            preds = await _seed_preds()
        return {"predictions": preds, "summary": {"total_clients": len(preds), "high_risk": len([p for p in preds if p.get("risk") == "high"]), "total_at_risk": round(sum(p.get("outstanding_amount", 0) for p in preds if p.get("risk") in ["high", "medium"]), 2)}}

    predictions.sort(key=lambda x: x["outstanding_amount"], reverse=True)

    return {
        "predictions": predictions,
        "summary": {
            "total_clients": len(predictions),
            "high_risk": len([p for p in predictions if p["risk"] == "high"]),
            "medium_risk": len([p for p in predictions if p["risk"] == "medium"]),
            "total_at_risk": round(sum(p["outstanding_amount"] for p in predictions if p["risk"] in ["high", "medium"]), 2),
            "total_overdue": round(sum(p["outstanding_amount"] for p in predictions if p["max_days_overdue"] > 0), 2),
        }
    }


# ============== SEND REMINDER ==============

@router.post(
    "/late-payment/send-reminder",
    dependencies=[Depends(require_action("billing.portal.reminder.send"))],
)
async def send_late_payment_reminder(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Send a reminder using only the canonical scoped invoice and client data."""
    invoice, client = await _load_scoped_invoice_and_client(
        data,
        current_user,
        request,
        operation="billing.late_payment.reminder.send",
    )
    invoice_status = _text(invoice.get("status")).lower()
    payment_status = _text(invoice.get("payment_status")).lower()
    if invoice_status in _TERMINAL_INVOICE_STATUSES or payment_status == "paid":
        raise HTTPException(status_code=409, detail="Cannot remind on a terminal invoice")

    amount = _invoice_balance(invoice)
    if amount <= 0:
        raise HTTPException(status_code=409, detail="Invoice has no outstanding balance")
    recipient = _client_billing_email(client)
    if not recipient:
        raise HTTPException(status_code=400, detail="This client has no billing email address")

    due_date, days_late = _due_date_and_days_late(invoice)
    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
    msp_name = _text(branding.get("company_name"), fallback="NexusMSP")
    primary_color = _safe_brand_colour(branding.get("primary_color"))
    portal_url, payment_link_id = await _payment_url_for_invoice(invoice)
    invoice_number = _text(invoice.get("invoice_number"), fallback=_text(invoice.get("id")))
    client_name = _text(client.get("name"), fallback="there")
    html = _late_reminder_html(
        client_name,
        invoice_number,
        amount,
        due_date,
        days_late,
        msp_name,
        primary_color,
        portal_url,
    )
    result = await send_email(
        recipient,
        f"{msp_name} - Payment Reminder: {invoice_number}",
        html,
        category="billing",
    )

    reminder = {
        "id": str(uuid.uuid4()),
        "client_id": invoice.get("client_id"),
        "invoice_id": invoice.get("id"),
        "client_name": client_name,
        "invoice_number": invoice_number,
        "amount": amount,
        "currency": _text(invoice.get("currency"), fallback="AUD").upper(),
        "to_email": recipient,
        "payment_link_id": payment_link_id,
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "sent_by": current_user.get("name", ""),
        "sent_by_id": current_user.get("id"),
        "email_status": result.get("status", "unknown"),
    }
    await db.late_payment_reminders.insert_one(reminder)
    await log_activity(
        current_user,
        "late_payment_reminder_sent",
        "invoice",
        str(invoice.get("id") or ""),
        invoice_number,
        "Sent a payment reminder using canonical client billing details",
        metadata={
            "client_id": invoice.get("client_id"),
            "reminder_id": reminder["id"],
            "amount": amount,
            "currency": reminder["currency"],
            "days_late": days_late,
            "payment_link_id": payment_link_id,
            "delivery_status": reminder["email_status"],
        },
    )
    return {
        "status": result.get("status", "unknown"),
        "message": result.get("message", "Payment reminder processed"),
        "reminder_id": reminder["id"],
    }


# ============== PAYMENT CONFIRMATION ==============

@router.post(
    "/late-payment/send-confirmation",
    dependencies=[Depends(require_action("billing.payment.record"))],
)
async def send_payment_confirmation(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Confirm only a settled canonical payment record within the actor's scope."""
    invoice, client = await _load_scoped_invoice_and_client(
        data,
        current_user,
        request,
        operation="billing.late_payment.confirmation.send",
    )
    payment, payment_link = await _load_settled_payment(invoice, data)
    amount = _money(payment.get("amount"), field_name="payment amount")
    if amount <= 0:
        raise HTTPException(status_code=409, detail="Payment amount must be greater than zero")
    recipient = _client_billing_email(client)
    if not recipient:
        raise HTTPException(status_code=400, detail="This client has no billing email address")

    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
    msp_name = _text(branding.get("company_name"), fallback="NexusMSP")
    primary_color = _safe_brand_colour(branding.get("primary_color"))
    invoice_number = _text(invoice.get("invoice_number"), fallback=_text(invoice.get("id")))
    client_name = _text(client.get("name"), fallback="there")
    payment_method = _text(
        payment.get("method") or payment.get("payment_method") or payment.get("source"),
        fallback="Payment",
    ).replace("_", " ").title()
    html = _payment_confirmation_html(
        client_name,
        invoice_number,
        amount,
        payment_method,
        msp_name,
        primary_color,
    )

    results = []
    customer_result = await send_email(
        recipient,
        f"{msp_name} - Payment Confirmation: {invoice_number}",
        html,
        category="billing",
    )
    results.append({"delivery_status": customer_result.get("status", "unknown"), "recipient_type": "client"})

    # The browser may request a team copy, but cannot select a recipient.  The
    # only optional internal recipient is the authenticated finance operator.
    if bool(data.get("cc_team", True)):
        team_email = _text(current_user.get("email"))
        if team_email:
            team_result = await send_email(
                team_email,
                f"Payment Received: {invoice_number} - ${amount:,.2f}",
                html,
                category="notifications",
            )
            results.append({"delivery_status": team_result.get("status", "unknown"), "recipient_type": "actor"})

    await log_activity(
        current_user,
        "late_payment_confirmation_sent",
        "invoice",
        str(invoice.get("id") or ""),
        invoice_number,
        "Sent a payment confirmation from a settled canonical payment record",
        metadata={
            "client_id": invoice.get("client_id"),
            "payment_id": payment.get("id") or payment.get("payment_link_payment_id"),
            "payment_link_id": payment.get("payment_link_id") or (payment_link or {}).get("id"),
            "amount": amount,
            "currency": _text(payment.get("currency") or invoice.get("currency"), fallback="AUD").upper(),
            "payment_method": payment_method,
            "delivery_statuses": [item["delivery_status"] for item in results],
        },
    )
    return {"results": results, "message": f"Confirmation sent for {invoice_number}"}


# ============== OVERDUE SCAN ==============

@router.get("/late-payment/overdue-invoices")
async def get_overdue_invoices(current_user: dict = Depends(get_current_user)):
    """Get all overdue invoices with days overdue and client details."""
    now = datetime.now(timezone.utc)
    invoices = await db.invoices.find(
        {"payment_status": {"$nin": ["paid"]}},
        {"_id": 0}
    ).to_list(500)

    overdue = []
    for inv in invoices:
        due = inv.get("due_date", "")
        if not due:
            continue
        try:
            due_dt = datetime.fromisoformat(due.replace("Z", "+00:00")) if "T" in due else datetime.strptime(due, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            days = (now - due_dt).days
        except Exception:
            continue
        if days > 0:
            balance = float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
            if balance > 0:
                inv["days_overdue"] = days
                inv["balance_due"] = round(balance, 2)
                overdue.append(inv)

    overdue.sort(key=lambda x: x["days_overdue"], reverse=True)
    return {
        "overdue": overdue,
        "summary": {
            "count": len(overdue),
            "total_overdue": round(sum(i["balance_due"] for i in overdue), 2),
            "avg_days_overdue": round(sum(i["days_overdue"] for i in overdue) / max(len(overdue), 1), 1),
        }
    }


# ============== REMINDER HISTORY ==============

@router.get("/late-payment/reminder-history")
async def get_reminder_history(current_user: dict = Depends(get_current_user)):
    """Get history of sent payment reminders."""
    history = await db.late_payment_reminders.find({}, {"_id": 0}).sort("sent_at", -1).to_list(100)
    return history


async def _seed_preds():
    clients = [("Apex Hospitality", "high", 4500, 3, 89), ("Atlas Logistics", "medium", 2800, 2, 65), ("TechStart Inc", "low", 1200, 0, 12), ("Global Finance Ltd", "low", 3500, 0, 8), ("HealthCare Plus", "medium", 2100, 1, 55), ("Summit Legal", "high", 3800, 4, 92)]
    preds = []
    for name, risk, amount, late_count, prob in clients:
        p = {"id": f"lp-{uuid.uuid4().hex[:8]}", "client_name": name, "risk": risk, "outstanding_amount": amount, "late_history_count": late_count, "probability_pct": prob, "avg_days_late": _rng.randint(5, 30) if risk != "low" else 0, "recommended_action": "Send proactive reminder" if risk == "high" else "Monitor" if risk == "medium" else "No action needed", "next_invoice_date": (datetime.now(timezone.utc) + timedelta(days=_rng.randint(5, 30))).strftime("%Y-%m-%d")}
        preds.append(p)
        await db.late_payment_predictions.insert_one(p)
    return [{k: v for k, v in p.items() if k != "_id"} for p in preds]
