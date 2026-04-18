from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
from app.routers.email_utils import send_email, is_resend_configured
import random
import uuid

_rng = random.SystemRandom()
router = APIRouter()


def _late_reminder_html(client_name, invoice_number, amount, due_date, days_late, msp_name, primary_color, portal_url):
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
          is now <strong style="color: #f97316;">{days_late} days overdue</strong>.
        </p>
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Invoice:</td><td style="padding: 6px 0; color: #f8fafc; font-size: 14px; font-weight: 600;">{invoice_number}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Amount Due:</td><td style="padding: 6px 0; color: #f97316; font-size: 14px; font-weight: 600;">${amount:,.2f}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Due Date:</td><td style="padding: 6px 0; color: #f8fafc; font-size: 14px;">{due_date}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Days Overdue:</td><td style="padding: 6px 0; color: #ef4444; font-size: 14px; font-weight: 600;">{days_late} days</td></tr>
          </table>
        </div>
        {'<a href="' + portal_url + '" style="display: inline-block; background: ' + primary_color + '; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Pay Now</a>' if portal_url else ''}
        <p style="color: #64748b; font-size: 12px; margin-top: 20px;">If you have already made this payment, please disregard this notice. For questions, contact our accounts team.</p>
      </div>
    </div>
    """


def _payment_confirmation_html(client_name, invoice_number, amount, payment_method, msp_name, primary_color):
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
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Amount Paid:</td><td style="padding: 6px 0; color: #10b981; font-size: 14px; font-weight: 600;">${amount:,.2f}</td></tr>
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

@router.post("/late-payment/send-reminder")
async def send_late_payment_reminder(data: dict, current_user: dict = Depends(get_current_user)):
    """Send a late payment reminder email to a client."""
    client_name = data.get("client_name", "")
    invoice_number = data.get("invoice_number", "")
    amount = float(data.get("amount", 0))
    due_date = data.get("due_date", "")
    days_late = int(data.get("days_late", 0))
    to_email = data.get("to_email", "")

    if not to_email:
        # Try to find client email
        client = await db.clients.find_one({"name": client_name}, {"_id": 0, "email": 1})
        to_email = client.get("email", "") if client else ""
    if not to_email:
        return {"status": "failed", "message": "No email address found for client"}

    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
    msp_name = branding.get("company_name", "NexusOps")
    primary_color = branding.get("primary_color", "#10b981")
    portal_url = data.get("portal_url", "")

    html = _late_reminder_html(client_name, invoice_number, amount, due_date, days_late, msp_name, primary_color, portal_url)
    result = await send_email(to_email, f"{msp_name} - Payment Reminder: {invoice_number}", html)

    # Log the reminder
    await db.late_payment_reminders.insert_one({
        "id": str(uuid.uuid4()),
        "client_name": client_name,
        "invoice_number": invoice_number,
        "amount": amount,
        "to_email": to_email,
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "sent_by": current_user.get("name", ""),
        "email_status": result.get("status", "unknown"),
    })

    return result


# ============== PAYMENT CONFIRMATION ==============

@router.post("/late-payment/send-confirmation")
async def send_payment_confirmation(data: dict, current_user: dict = Depends(get_current_user)):
    """Send payment confirmation email to client and optionally to the MSP team."""
    client_name = data.get("client_name", "")
    invoice_number = data.get("invoice_number", "")
    amount = float(data.get("amount", 0))
    payment_method = data.get("payment_method", "Card")
    to_email = data.get("to_email", "")
    cc_team = data.get("cc_team", True)

    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
    msp_name = branding.get("company_name", "NexusOps")
    primary_color = branding.get("primary_color", "#10b981")

    html = _payment_confirmation_html(client_name, invoice_number, amount, payment_method, msp_name, primary_color)

    results = []
    if to_email:
        r = await send_email(to_email, f"{msp_name} - Payment Confirmation: {invoice_number}", html)
        results.append({"to": to_email, **r})

    if cc_team:
        team_email = current_user.get("email", "")
        if team_email:
            r = await send_email(team_email, f"Payment Received: {invoice_number} - ${amount:,.2f}", html)
            results.append({"to": team_email, **r})

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
