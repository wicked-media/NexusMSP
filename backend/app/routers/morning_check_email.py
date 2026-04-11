"""Morning Check Email Report - sends a formatted NOC briefing via email"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
from app.routers.email_utils import send_email, is_resend_configured

router = APIRouter()


def _build_morning_email_html(data: dict) -> str:
    """Build a professional HTML email from morning checks data"""
    ts = data.get("timestamp", "")[:16].replace("T", " ")
    hs = data.get("health_score", 0)
    hs_color = "#10b981" if hs >= 80 else "#f59e0b" if hs >= 60 else "#ef4444"

    devices = data.get("devices", {})
    tickets = data.get("tickets", {})
    backups = data.get("backups", {})
    security = data.get("security", {})
    overdue_inv = data.get("overdue_invoices", {})
    client_health = data.get("client_health", [])

    # Build offline devices rows
    offline_rows = ""
    for d in devices.get("offline_list", [])[:10]:
        offline_rows += f'<tr><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px">{d.get("name","Unknown")}</td><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px">{d.get("client_name","")}</td><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px">{d.get("device_type","")}</td></tr>'

    # Build critical tickets rows
    ticket_rows = ""
    for t in tickets.get("critical_list", [])[:10]:
        ticket_rows += f'<tr><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px">{t.get("id","")}</td><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px">{t.get("title","")[:50]}</td><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px">{t.get("client_name","")}</td><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px;text-transform:uppercase;font-weight:bold;color:{"#ef4444" if t.get("priority")=="critical" else "#f59e0b"}">{t.get("priority","")}</td></tr>'

    # Failed backups rows
    backup_rows = ""
    for b in backups.get("failed_list", [])[:10]:
        backup_rows += f'<tr><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px">{b.get("name","")}</td><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px">{b.get("client_name","")}</td><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px">{b.get("type","")}</td></tr>'

    # Client health rows
    client_rows = ""
    for ch in client_health[:15]:
        st = ch.get("status", "green")
        st_emoji = {"red": "#ef4444", "amber": "#f59e0b", "green": "#10b981"}.get(st, "#6b7280")
        client_rows += f'<tr><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:{st_emoji};margin-right:6px"></span>{ch.get("client_name","")}</td><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px;text-align:center">{ch.get("devices_total",0)}</td><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px;text-align:center;color:#ef4444">{ch.get("devices_offline",0)}</td><td style="padding:6px 10px;border-bottom:1px solid #333;font-size:13px;text-align:center">{ch.get("open_tickets",0)}</td></tr>'

    html = f"""
    <div style="max-width:700px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#0f0f1a;color:#e0e0e0;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1a56db,#06b6d4);padding:28px 32px">
        <h1 style="margin:0;color:#fff;font-size:22px">NOC Morning Check Report</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.7);font-size:13px">{ts} UTC</p>
      </div>

      <div style="padding:24px 32px">
        <!-- Health Score -->
        <div style="background:#1a1a2e;border-radius:10px;padding:20px;margin-bottom:20px;text-align:center;border:1px solid #333">
          <p style="margin:0;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:1px">Overall Health Score</p>
          <p style="margin:8px 0 0;font-size:48px;font-weight:bold;color:{hs_color}">{hs}%</p>
        </div>

        <!-- KPI Grid -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr>
            <td style="width:25%;padding:8px;text-align:center;background:#1a1a2e;border-radius:8px">
              <p style="margin:0;font-size:24px;font-weight:bold;color:#10b981">{devices.get("online",0)}</p>
              <p style="margin:4px 0 0;font-size:11px;color:#888">Devices Online</p>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;padding:8px;text-align:center;background:#1a1a2e;border-radius:8px">
              <p style="margin:0;font-size:24px;font-weight:bold;color:#ef4444">{devices.get("offline",0)}</p>
              <p style="margin:4px 0 0;font-size:11px;color:#888">Devices Offline</p>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;padding:8px;text-align:center;background:#1a1a2e;border-radius:8px">
              <p style="margin:0;font-size:24px;font-weight:bold;color:#3b82f6">{tickets.get("total_open",0)}</p>
              <p style="margin:4px 0 0;font-size:11px;color:#888">Open Tickets</p>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;padding:8px;text-align:center;background:#1a1a2e;border-radius:8px">
              <p style="margin:0;font-size:24px;font-weight:bold;color:#f59e0b">{tickets.get("sla_breaches",0)}</p>
              <p style="margin:4px 0 0;font-size:11px;color:#888">SLA Breaches</p>
            </td>
          </tr>
        </table>

        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr>
            <td style="width:25%;padding:8px;text-align:center;background:#1a1a2e;border-radius:8px">
              <p style="margin:0;font-size:24px;font-weight:bold;color:#ef4444">{tickets.get("critical_high",0)}</p>
              <p style="margin:4px 0 0;font-size:11px;color:#888">Critical/High</p>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;padding:8px;text-align:center;background:#1a1a2e;border-radius:8px">
              <p style="margin:0;font-size:24px;font-weight:bold;color:#8b5cf6">{tickets.get("unassigned",0)}</p>
              <p style="margin:4px 0 0;font-size:11px;color:#888">Unassigned</p>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;padding:8px;text-align:center;background:#1a1a2e;border-radius:8px">
              <p style="margin:0;font-size:24px;font-weight:bold;color:{"#ef4444" if backups.get("failed",0) > 0 else "#10b981"}">{backups.get("failed",0)}</p>
              <p style="margin:4px 0 0;font-size:11px;color:#888">Backup Failures</p>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;padding:8px;text-align:center;background:#1a1a2e;border-radius:8px">
              <p style="margin:0;font-size:24px;font-weight:bold;color:#ef4444">{security.get("critical_alerts",0)}</p>
              <p style="margin:4px 0 0;font-size:11px;color:#888">Security Alerts</p>
            </td>
          </tr>
        </table>

        {"" if not offline_rows else f'''
        <div style="margin-bottom:20px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#ef4444;border-bottom:1px solid #333;padding-bottom:6px">Offline Devices ({devices.get("offline",0)})</h3>
          <table style="width:100%;border-collapse:collapse;background:#1a1a2e;border-radius:8px;overflow:hidden">
            <tr style="background:#252540"><th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Device</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Client</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Type</th></tr>
            {offline_rows}
          </table>
        </div>
        '''}

        {"" if not ticket_rows else f'''
        <div style="margin-bottom:20px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#f59e0b;border-bottom:1px solid #333;padding-bottom:6px">Critical/High Tickets ({tickets.get("critical_high",0)})</h3>
          <table style="width:100%;border-collapse:collapse;background:#1a1a2e;border-radius:8px;overflow:hidden">
            <tr style="background:#252540"><th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">ID</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Title</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Client</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Priority</th></tr>
            {ticket_rows}
          </table>
        </div>
        '''}

        {"" if not backup_rows else f'''
        <div style="margin-bottom:20px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#ef4444;border-bottom:1px solid #333;padding-bottom:6px">Failed Backups ({backups.get("failed",0)})</h3>
          <table style="width:100%;border-collapse:collapse;background:#1a1a2e;border-radius:8px;overflow:hidden">
            <tr style="background:#252540"><th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Job</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Client</th><th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Type</th></tr>
            {backup_rows}
          </table>
        </div>
        '''}

        <!-- Overdue Invoices -->
        {"" if overdue_inv.get("count",0) == 0 else f'''
        <div style="margin-bottom:20px;background:#1a1a2e;border-radius:8px;padding:14px;border-left:4px solid #f59e0b">
          <p style="margin:0;font-size:13px;font-weight:bold;color:#f59e0b">Overdue Invoices: {overdue_inv.get("count",0)} (${overdue_inv.get("total_amount",0):,.0f})</p>
        </div>
        '''}

        <!-- Client Health Summary -->
        {"" if not client_rows else f'''
        <div style="margin-bottom:20px">
          <h3 style="margin:0 0 10px;font-size:14px;color:#06b6d4;border-bottom:1px solid #333;padding-bottom:6px">Client Health Overview</h3>
          <table style="width:100%;border-collapse:collapse;background:#1a1a2e;border-radius:8px;overflow:hidden">
            <tr style="background:#252540"><th style="padding:8px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Client</th><th style="padding:8px 10px;text-align:center;font-size:11px;color:#888;text-transform:uppercase">Devices</th><th style="padding:8px 10px;text-align:center;font-size:11px;color:#888;text-transform:uppercase">Offline</th><th style="padding:8px 10px;text-align:center;font-size:11px;color:#888;text-transform:uppercase">Tickets</th></tr>
            {client_rows}
          </table>
        </div>
        '''}

        <div style="text-align:center;padding:20px 0;border-top:1px solid #333;margin-top:10px">
          <p style="margin:0;font-size:11px;color:#666">Generated by NexusOps NOC Dashboard</p>
        </div>
      </div>
    </div>
    """
    return html


@router.post("/morning-checks/send-email-report")
async def send_morning_check_email(data: dict, current_user: dict = Depends(get_current_user)):
    """Send the morning check report via email"""
    to_email = data.get("to_email", "")
    if not to_email:
        raise HTTPException(status_code=400, detail="Recipient email is required")

    # Fetch morning checks data using the same logic
    from app.routers.morning_checks import get_morning_checks
    checks_data = await get_morning_checks(current_user)

    html = _build_morning_email_html(checks_data)
    now = datetime.now(timezone.utc)
    subject = f"NOC Morning Check Report - {now.strftime('%B %d, %Y')}"

    result = await send_email(to_email, subject, html)

    # Log the send
    await db.email_logs.insert_one({
        "type": "morning_check_report",
        "to_email": to_email,
        "subject": subject,
        "status": result["status"],
        "sent_at": now.isoformat(),
        "sent_by": current_user.get("name", "System"),
        "health_score": checks_data.get("health_score", 0),
    })

    return {
        "status": result["status"],
        "message": result["message"],
        "email_id": result.get("email_id"),
        "resend_configured": is_resend_configured(),
    }
