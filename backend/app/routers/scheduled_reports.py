from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone
from io import BytesIO
import uuid
import jwt
from app.database import db
from app.database import JWT_SECRET, JWT_ALGORITHM
from app.auth import get_current_user
from app.routers.financial_reports import build_accounts_receivable_aging
from app.services.nexus_document_pdf import render_nexus_document_pdf
from app.services.supabase_storage import archive_generated_pdf
from app.services.scope_permissions import assert_client_scope, effective_scope, platform_tenant_id, scoped_query, tenant_scoped_query

router = APIRouter()


async def _report_client_ids(raw_client_ids, current_user: dict) -> list[str]:
    """Validate explicit report targets; an empty list means permitted scope."""
    if raw_client_ids is None:
        return []
    if not isinstance(raw_client_ids, list):
        raise HTTPException(status_code=422, detail="client_ids must be a list of stable client IDs")
    client_ids = list(dict.fromkeys(str(value).strip() for value in raw_client_ids if str(value).strip()))
    if len(client_ids) > 100:
        raise HTTPException(status_code=422, detail="A report can target at most 100 clients")
    for client_id in client_ids:
        await assert_client_scope(current_user, client_id, operation="report.generate", mask_not_found=True)
    return client_ids


async def _retained_report_client_ids(raw_client_ids, current_user: dict) -> list[str]:
    """Persist a concrete client boundary for restricted saved reports."""
    selected = await _report_client_ids(raw_client_ids, current_user)
    return selected or effective_scope(current_user)["client_ids"]


def _report_query(current_user: dict, client_ids: list[str], query: dict | None = None) -> dict:
    criteria = dict(query or {})
    if client_ids:
        criteria["client_id"] = {"$in": client_ids}
    return scoped_query(current_user, tenant_scoped_query(current_user, criteria), site_field=None)


async def _assert_report_scope(current_user: dict, record: dict) -> None:
    """Ensure a retained report is still visible to the requesting operator."""
    tenant_id = platform_tenant_id(current_user)
    record_tenant = str(record.get("tenant_id") or "nexus-local")
    if tenant_id != record_tenant:
        raise HTTPException(status_code=404, detail="Generated report not found")
    client_ids = record.get("client_ids") or (record.get("scope") or {}).get("client_ids") or []
    if effective_scope(current_user)["mode"] == "restricted" and not client_ids:
        # A retained record without a client boundary cannot be proven safe for
        # a restricted technician, so it remains visible only to full scope.
        raise HTTPException(status_code=404, detail="Generated report not found")
    for client_id in client_ids:
        await assert_client_scope(current_user, str(client_id), operation="report.read", mask_not_found=True)


async def _visible_report_records(current_user: dict, records: list[dict]) -> list[dict]:
    """Filter list responses without revealing that a hidden record exists."""
    visible = []
    for record in records:
        try:
            await _assert_report_scope(current_user, record)
        except HTTPException as exc:
            if exc.status_code == 404:
                continue
            raise
        visible.append(record)
    return visible


async def _scheduled_report_in_scope(report_id: str, current_user: dict) -> dict:
    report = await db.scheduled_reports.find_one(tenant_scoped_query(current_user, {"id": report_id}), {"_id": 0})
    if not report:
        raise HTTPException(status_code=404, detail="Scheduled report not found")
    await _assert_report_scope(current_user, report)
    return report


async def _get_user_from_pdf_token(token: str = Query(None)):
    """Allow a direct authenticated PDF attachment download from the browser."""
    if not token:
        raise HTTPException(status_code=401, detail="Token required")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def _report_snapshot(report: dict, current_user: dict) -> dict:
    """Build a persisted, evidence-backed snapshot for a scheduled report.

    Delivery is deliberately separate from generation: this gives technicians an
    audit record of exactly what was generated, even where an outbound mailbox
    has not yet been configured.
    """
    now = datetime.now(timezone.utc).isoformat()
    report_type = report.get("report_type", "executive_summary")
    selected_client_ids = await _report_client_ids(report.get("client_ids") or [], current_user)
    # Persist the effective restricted scope into every output.  An empty list
    # is meaningful only for a full-scope operator, never an implicit grant.
    client_ids = selected_client_ids or effective_scope(current_user)["client_ids"]
    tickets = await db.tickets.find(_report_query(current_user, client_ids), {"_id": 0}).to_list(5000)
    devices = await db.devices.find(_report_query(current_user, client_ids), {"_id": 0}).to_list(5000)
    invoices = await db.invoices.find(_report_query(current_user, client_ids), {"_id": 0}).to_list(5000)
    alerts = await db.alerts.find(_report_query(current_user, client_ids), {"_id": 0}).to_list(5000)
    backup_jobs = await db.backup_jobs.find(_report_query(current_user, client_ids), {"_id": 0}).to_list(5000)
    assets = await db.assets.find(_report_query(current_user, client_ids), {"_id": 0}).to_list(5000)
    remote_sessions = await db.remote_sessions.find(_report_query(current_user, client_ids), {"_id": 0}).to_list(5000)
    patches = await db.patches.find(_report_query(current_user, client_ids), {"_id": 0}).to_list(5000)

    ticket_status = {}
    ticket_priority = {}
    ticket_category = {}
    for ticket in tickets:
        status = ticket.get("status", "open")
        priority = ticket.get("priority", "medium")
        category = ticket.get("category", "support")
        ticket_status[status] = ticket_status.get(status, 0) + 1
        ticket_priority[priority] = ticket_priority.get(priority, 0) + 1
        ticket_category[category] = ticket_category.get(category, 0) + 1

    device_status = {}
    for device in devices:
        status = device.get("status", "unknown")
        device_status[status] = device_status.get(status, 0) + 1

    backup_status = {}
    for job in backup_jobs:
        status = str(job.get("status") or job.get("backup_health") or "unknown").lower()
        backup_status[status] = backup_status.get(status, 0) + 1
    asset_status = {}
    for asset in assets:
        status = str(asset.get("status") or "active").lower()
        asset_status[status] = asset_status.get(status, 0) + 1
    remote_status = {}
    for session in remote_sessions:
        status = str(session.get("status") or "unknown").lower()
        remote_status[status] = remote_status.get(status, 0) + 1
    patch_status = {}
    for patch in patches:
        status = str(patch.get("status") or "unknown").lower()
        patch_status[status] = patch_status.get(status, 0) + 1

    total_invoiced = round(sum(float(invoice.get("total", 0)) for invoice in invoices), 2)
    total_paid = round(sum(float(invoice.get("amount_paid", 0)) for invoice in invoices), 2)
    outstanding = round(total_invoiced - total_paid, 2)
    compliance = await db.compliance_reports.find(_report_query(current_user, client_ids), {"_id": 0}).sort("scanned_at", -1).to_list(1)
    latest_compliance = compliance[0] if compliance else None

    sections = {
        "summary": {
            "tickets_total": len(tickets),
            "tickets_open": sum(count for status, count in ticket_status.items() if status in {"open", "in_progress", "pending"}),
            "devices_total": len(devices),
            "devices_online": device_status.get("online", 0),
            "active_alerts": sum(1 for alert in alerts if alert.get("status") == "active"),
            "backup_jobs": len(backup_jobs),
            "backup_failures": sum(count for status, count in backup_status.items() if status in {"failed", "error", "unhealthy"}),
            "managed_assets": len(assets),
            "remote_sessions": len(remote_sessions),
            "pending_patches": sum(count for status, count in patch_status.items() if status in {"pending", "missing", "failed"}),
        },
        "tickets": {"by_status": ticket_status, "by_priority": ticket_priority, "by_category": ticket_category},
        "devices": {"by_status": device_status, "total_alerts": len(alerts), "active_alerts": sum(1 for alert in alerts if alert.get("status") == "active")},
        "billing": {"total_invoiced": total_invoiced, "total_paid": total_paid, "outstanding": outstanding, "invoice_count": len(invoices)},
        "security": {"latest_compliance": latest_compliance, "security_assessed_devices": sum(1 for device in devices if device.get("security_assessed_at"))},
        "backup_recovery": {"by_status": backup_status, "jobs_total": len(backup_jobs), "failures": sum(count for status, count in backup_status.items() if status in {"failed", "error", "unhealthy"})},
        "asset_lifecycle": {"by_status": asset_status, "assets_total": len(assets), "warranty_expiring": sum(1 for asset in assets if asset.get("warranty_expiry") or asset.get("warranty_end"))},
        "remote_access": {"by_status": remote_status, "sessions_total": len(remote_sessions), "active_sessions": sum(count for status, count in remote_status.items() if status in {"active", "connected", "in_progress"})},
        "patching": {"by_status": patch_status, "patches_total": len(patches), "remediation_required": sum(count for status, count in patch_status.items() if status in {"pending", "missing", "failed"})},
    }
    if report_type == "accounts_receivable_aging":
        aging = await build_accounts_receivable_aging(_report_query(current_user, client_ids))
        sections["accounts_receivable_aging"] = {
            "as_of": aging["as_of"],
            "grand_total": aging["grand_total"],
            "total_invoices": aging["total_invoices"],
            "buckets": {
                key: {"label": bucket["label"], "balance": bucket["total"], "invoice_count": bucket["count"]}
                for key, bucket in aging["buckets"].items()
            },
        }
        sections["outstanding_invoices"] = [
            {**item, "bucket": key, "bucket_label": bucket["label"]}
            for key, bucket in aging["buckets"].items()
            for item in bucket["items"]
        ]
    included = report.get("include_sections") or ["summary", "tickets", "devices", "billing", "security"]
    if report_type == "ticket_report":
        included = ["summary", "tickets"]
    elif report_type == "device_health":
        included = ["summary", "devices", "security"]
    elif report_type == "billing_summary":
        included = ["summary", "billing"]
    elif report_type == "security_report":
        included = ["summary", "devices", "security"]
    elif report_type == "client_health":
        included = ["summary", "tickets", "devices", "billing", "security"]
    elif report_type in {"ticket_analytics", "technician_utilisation", "sla_reporting", "service_operations"}:
        included = ["summary", "tickets"]
    elif report_type in {"rmm_device_estate", "patch_compliance", "endpoint_security"}:
        included = ["summary", "devices", "security", "patching"]
    elif report_type in {"backup_recovery", "backup_assurance", "disaster_recovery"}:
        included = ["summary", "backup_recovery"]
    elif report_type in {"asset_lifecycle", "asset_inventory", "warranty_refresh"}:
        included = ["summary", "asset_lifecycle"]
    elif report_type in {"remote_access", "remote_session_audit"}:
        included = ["summary", "remote_access"]
    elif report_type in {"framework_assessments", "security_compliance"}:
        included = ["summary", "devices", "security"]
    elif report_type in {"audit_trail", "change_management", "knowledge_runbooks", "audit_governance"}:
        included = ["summary", "tickets", "devices", "security"]
    elif report_type == "accounts_receivable_aging":
        included = ["summary", "accounts_receivable_aging", "outstanding_invoices"]
    elif report_type in {"revenue_summary", "contracts_recurring", "billing_revenue"}:
        included = ["summary", "billing"]

    output = {
        "id": f"sro-{uuid.uuid4().hex[:10]}",
        "schedule_id": report["id"],
        "tenant_id": platform_tenant_id(current_user),
        "client_ids": client_ids,
        "schedule_name": report.get("name", "Scheduled report"),
        "report_type": report_type,
        "format": report.get("format", "json"),
        "generated_at": now,
        "generated_by": current_user.get("name", "System"),
        "scope": {"client_ids": client_ids, "selected_client_ids": selected_client_ids, "period": "Current system snapshot", "scope_mode": effective_scope(current_user)["mode"]},
        "sections": {key: sections[key] for key in included if key in sections},
        "delivery_status": "generated",
    }
    await db.scheduled_report_outputs.insert_one(output)
    output.pop("_id", None)
    return output


@router.post("/reports/generate")
async def generate_report_from_hub(data: dict, current_user: dict = Depends(get_current_user)):
    """Generate and retain an on-demand report from the Reporting hub.

    This intentionally uses the same snapshot pipeline as scheduled delivery so
    manual and scheduled reports have comparable evidence and audit retention.
    """
    report_type = data.get("report_type", "executive_summary")
    report = {
        "id": f"manual-{uuid.uuid4().hex[:10]}",
        "name": data.get("name") or report_type.replace("_", " ").title(),
        "report_type": report_type,
        "format": data.get("format", "json"),
        "include_sections": data.get("include_sections", []),
        "client_ids": await _report_client_ids(data.get("client_ids") or [], current_user),
    }
    output = await _report_snapshot(report, current_user)
    output["origin"] = "on_demand"
    await db.scheduled_report_outputs.update_one({"id": output["id"]}, {"$set": {"origin": "on_demand"}})
    await db.report_run_history.insert_one({
        "id": f"rrh-{uuid.uuid4().hex[:10]}", "output_id": output["id"],
        "tenant_id": platform_tenant_id(current_user), "client_ids": output.get("client_ids") or [],
        "report_type": report_type, "name": report["name"], "generated_at": output["generated_at"],
        "generated_by": output["generated_by"], "origin": "on_demand",
    })
    return output


@router.get("/reports/generated")
async def get_generated_reports(current_user: dict = Depends(get_current_user)):
    records = await db.report_run_history.find(
        tenant_scoped_query(current_user), {"_id": 0}
    ).sort("generated_at", -1).to_list(100)
    return await _visible_report_records(current_user, records)


@router.get("/reports/generated/{output_id}")
async def get_generated_report(output_id: str, current_user: dict = Depends(get_current_user)):
    """Return a retained report snapshot for the shared report-reader canvas."""
    history = await db.report_run_history.find_one(tenant_scoped_query(current_user, {"output_id": output_id}), {"_id": 0})
    output = await db.scheduled_report_outputs.find_one(tenant_scoped_query(current_user, {"id": output_id}), {"_id": 0})
    if not history or not output:
        raise HTTPException(status_code=404, detail="Generated report not found")
    await _assert_report_scope(current_user, output)
    return {"history": history, "output": output}


def _pdf_value(value):
    if value is None:
        return "Not available"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float, str)):
        return str(value)
    if isinstance(value, list):
        return ", ".join(_pdf_value(item) for item in value) or "None"
    if isinstance(value, dict):
        return "; ".join(f"{str(key).replace('_', ' ').title()}: {_pdf_value(item)}" for key, item in value.items()) or "None"
    return str(value)


def _pdf_timestamp(value):
    """Use a concise, human-readable timestamp in client-facing documents."""
    if not value:
        return "Not recorded"
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.strftime("%d %b %Y at %H:%M UTC")
    except (TypeError, ValueError):
        return str(value)


@router.get("/reports/generated/{output_id}/pdf")
async def download_generated_report_pdf(output_id: str, current_user: dict = Depends(_get_user_from_pdf_token)):
    """Render a retained on-demand report snapshot as a downloadable PDF."""
    history = await db.report_run_history.find_one(tenant_scoped_query(current_user, {"output_id": output_id}), {"_id": 0})
    output = await db.scheduled_report_outputs.find_one(tenant_scoped_query(current_user, {"id": output_id}), {"_id": 0})
    if not history or not output:
        raise HTTPException(status_code=404, detail="Generated report not found")
    await _assert_report_scope(current_user, output)
    branding_record = await db.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
    branding = branding_record.get("value") or branding_record
    summary = output.get("sections", {}).get("summary", {})
    pdf_bytes = render_nexus_document_pdf(
        title=history.get("name") or output.get("schedule_name") or "Generated report",
        document_kind=str(history.get("report_type") or output.get("report_type") or "standard").replace("_", " ").title(),
        subtitle=branding.get("report_header_text") or "Managed service evidence and operational assurance.",
        metadata=[
            ("Generated", _pdf_timestamp(output.get("generated_at"))),
            ("Prepared by", output.get("generated_by", "System")),
            ("Evidence", "Retained snapshot"),
        ],
        metric_cards=[
            ("Managed devices", summary.get("devices_total", 0)),
            ("Devices online", summary.get("devices_online", 0)),
            ("Open tickets", summary.get("tickets_open", 0)),
            ("Active alerts", summary.get("active_alerts", 0)),
        ],
        sections=[(section.replace("_", " ").title(), values) for section, values in (output.get("sections") or {}).items()],
        branding=branding,
    )
    safe_name = "".join(char if char.isalnum() or char in {"-", "_"} else "-" for char in (history.get("name") or "nexusmsp-report")).strip("-")
    artifact_path = await archive_generated_pdf("scheduled-reports", output_id, pdf_bytes)
    if artifact_path:
        await db.scheduled_report_outputs.update_one(
            {"id": output_id},
            {"$set": {
                "artifact_storage.latest_pdf": {
                    "provider": "supabase",
                    "object_path": artifact_path,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }
            }},
        )
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.pdf"',
            "X-Nexus-Artifact-Storage": "archived" if artifact_path else "local-only",
        },
    )

    from reportlab.lib import colors
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    buffer = BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=16 * mm, leftMargin=16 * mm, topMargin=20 * mm, bottomMargin=18 * mm)
    styles = getSampleStyleSheet()
    primary_hex = branding.get("primary_color", "#2563EB")
    try:
        primary_color = colors.HexColor(primary_hex)
    except (TypeError, ValueError):
        primary_color = colors.HexColor("#2563EB")
    company_name = branding.get("company_name") or "NexusMSP"
    document_theme = branding.get("document_theme", "executive")
    report_type_label = str(history.get("report_type") or output.get("report_type") or "standard").replace("_", " ").title()
    ink = colors.HexColor("#102033")
    slate = colors.HexColor("#526276")
    surface = colors.HexColor("#F5F8FC")
    line = colors.HexColor("#DCE5EF")
    title_style = ParagraphStyle("NexusTitle", parent=styles["Title"], textColor=ink, fontSize=23 if document_theme == "executive" else 21, leading=28, spaceAfter=5)
    eyebrow_style = ParagraphStyle("NexusEyebrow", parent=styles["Normal"], textColor=primary_color, fontSize=8, leading=10, spaceAfter=7, uppercase=True, fontName="Helvetica-Bold")
    heading_style = ParagraphStyle("NexusHeading", parent=styles["Heading2"], textColor=ink, fontSize=13, leading=17, spaceBefore=15, spaceAfter=7, fontName="Helvetica-Bold")
    muted_style = ParagraphStyle("NexusMuted", parent=styles["Normal"], textColor=slate, fontSize=9, leading=14)
    value_style = ParagraphStyle("NexusMetricValue", parent=styles["Normal"], textColor=ink, fontSize=16, leading=19, fontName="Helvetica-Bold")
    metric_label_style = ParagraphStyle("NexusMetricLabel", parent=styles["Normal"], textColor=slate, fontSize=7, leading=9, uppercase=True, fontName="Helvetica-Bold")
    footer_style = ParagraphStyle("NexusFooter", parent=styles["Normal"], textColor=colors.HexColor("#64748B"), fontSize=7, alignment=TA_RIGHT)
    summary = output.get("sections", {}).get("summary", {})
    metric_values = [
        ("Managed devices", summary.get("devices_total", 0)),
        ("Devices online", summary.get("devices_online", 0)),
        ("Open tickets", summary.get("tickets_open", 0)),
        ("Active alerts", summary.get("active_alerts", 0)),
    ]
    metric_cells = [[Paragraph(label, metric_label_style), Paragraph(_pdf_value(value), value_style)] for label, value in metric_values]
    metric_table = Table([metric_cells], colWidths=[43 * mm] * 4)
    metric_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), surface), ("BOX", (0, 0), (-1, -1), 0.6, line),
        ("INNERGRID", (0, 0), (-1, -1), 0.6, line), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story = [
        Paragraph(f"{company_name.upper()} - REPORTING & EVIDENCE", eyebrow_style),
        Paragraph(history.get("name") or output.get("schedule_name") or "Generated report", title_style),
        Paragraph(branding.get("report_header_text") or "Managed service evidence and operational assurance", muted_style),
        Spacer(1, 3 * mm),
        Paragraph(f"{report_type_label.upper()}  •  GENERATED {_pdf_timestamp(output.get('generated_at'))}  •  PREPARED BY {output.get('generated_by', 'System')}  •  RETAINED EVIDENCE SNAPSHOT", ParagraphStyle("NexusMeta", parent=muted_style, fontSize=7, leading=10, textColor=slate, fontName="Helvetica-Bold")),
        Spacer(1, 6 * mm), metric_table, Spacer(1, 6 * mm),
    ]
    for section, values in (output.get("sections") or {}).items():
        story.append(Paragraph(section.replace("_", " ").title(), heading_style))
        if section == "accounts_receivable_aging" and isinstance(values, dict):
            rows = [[Paragraph("Age bucket", styles["BodyText"]), Paragraph("Invoices", styles["BodyText"]), Paragraph("Outstanding balance", styles["BodyText"])]]
            for bucket in (values.get("buckets") or {}).values():
                rows.append([
                    Paragraph(escape(str(bucket.get("label") or "Not recorded")), styles["BodyText"]),
                    Paragraph(str(bucket.get("invoice_count") or 0), styles["BodyText"]),
                    Paragraph(f"${float(bucket.get('balance') or 0):,.2f}", styles["BodyText"]),
                ])
            rows.append([
                Paragraph("Total receivables", ParagraphStyle("NexusAgingTotal", parent=styles["BodyText"], fontName="Helvetica-Bold")),
                Paragraph(str(values.get("total_invoices") or 0), ParagraphStyle("NexusAgingTotalCount", parent=styles["BodyText"], fontName="Helvetica-Bold")),
                Paragraph(f"${float(values.get('grand_total') or 0):,.2f}", ParagraphStyle("NexusAgingTotalBalance", parent=styles["BodyText"], fontName="Helvetica-Bold")),
            ])
            table = Table(rows, colWidths=[79 * mm, 35 * mm, 56 * mm], repeatRows=1)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), primary_color), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.35, line),
                ("BACKGROUND", (0, -1), (-1, -1), surface), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, surface]), ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.extend([KeepTogether([table]), Spacer(1, 3 * mm)])
            continue
        if section == "outstanding_invoices" and isinstance(values, list):
            rows = [[Paragraph("Invoice", styles["BodyText"]), Paragraph("Client", styles["BodyText"]), Paragraph("Due", styles["BodyText"]), Paragraph("Age", styles["BodyText"]), Paragraph("Balance", styles["BodyText"])]]
            for invoice in values:
                rows.append([
                    Paragraph(escape(str(invoice.get("invoice_number") or "Invoice")), styles["BodyText"]),
                    Paragraph(escape(str(invoice.get("client_name") or "Unassigned client")), styles["BodyText"]),
                    Paragraph(escape(str(invoice.get("due_date") or "Not recorded")), styles["BodyText"]),
                    Paragraph(f"{int(invoice.get('days_overdue') or 0)} days", styles["BodyText"]),
                    Paragraph(f"${float(invoice.get('balance') or 0):,.2f}", styles["BodyText"]),
                ])
            if len(rows) == 1:
                rows.append([Paragraph("No outstanding invoices", styles["BodyText"]), Paragraph("—", styles["BodyText"]), Paragraph("—", styles["BodyText"]), Paragraph("—", styles["BodyText"]), Paragraph("$0.00", styles["BodyText"])])
            table = Table(rows, colWidths=[30 * mm, 52 * mm, 32 * mm, 25 * mm, 31 * mm], repeatRows=1)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), primary_color), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.35, line),
                ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, surface]),
                ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]))
            story.extend([table, Spacer(1, 3 * mm)])
            continue
        rows = [[Paragraph("Measure", styles["BodyText"]), Paragraph("Value", styles["BodyText"])]]
        if isinstance(values, dict):
            rows.extend([[Paragraph(str(key).replace("_", " ").title(), styles["BodyText"]), Paragraph(_pdf_value(value), styles["BodyText"])] for key, value in values.items()])
        else:
            rows.append([Paragraph("Evidence", styles["BodyText"]), Paragraph(_pdf_value(values), styles["BodyText"])])
        table = Table(rows, colWidths=[58 * mm, 112 * mm], repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), primary_color),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.35, line),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, surface]),
            ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.extend([KeepTogether([table]), Spacer(1, 3 * mm)])
    story.extend([Spacer(1, 6 * mm), Paragraph(branding.get("report_footer_text") or "This document is a retained point-in-time evidence snapshot.", footer_style)])
    def draw_page(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(primary_color)
        canvas.rect(0, A4[1] - 7 * mm, A4[0], 7 * mm, fill=1, stroke=0)
        canvas.setStrokeColor(line)
        canvas.line(16 * mm, 12 * mm, A4[0] - 16 * mm, 12 * mm)
        canvas.setFillColor(slate)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(16 * mm, 7.5 * mm, f"{company_name}  |  Confidential managed service evidence")
        canvas.drawRightString(A4[0] - 16 * mm, 7.5 * mm, f"Page {doc.page}")
        canvas.restoreState()
    document.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    safe_name = "".join(char if char.isalnum() or char in {"-", "_"} else "-" for char in (history.get("name") or "nexusmsp-report")).strip("-")
    return StreamingResponse(BytesIO(buffer.getvalue()), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'})


@router.get("/scheduled-reports")
async def get_scheduled_reports(current_user: dict = Depends(get_current_user)):
    reports = await db.scheduled_reports.find(tenant_scoped_query(current_user), {"_id": 0}).sort("created_at", -1).to_list(100)
    return await _visible_report_records(current_user, reports)


@router.post("/scheduled-reports")
async def create_scheduled_report(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    report = {
        "id": f"sr-{uuid.uuid4().hex[:8]}",
        "tenant_id": platform_tenant_id(current_user),
        "name": data.get("name", "Untitled Report"),
        "report_type": data.get("report_type", "executive_summary"),
        "frequency": data.get("frequency", "weekly"),  # daily, weekly, monthly
        "day_of_week": data.get("day_of_week", "monday"),
        "day_of_month": data.get("day_of_month", 1),
        "time": data.get("time", "08:00"),
        "timezone": data.get("timezone", "Australia/Sydney"),
        "recipients": data.get("recipients", []),
        "client_ids": await _retained_report_client_ids(data.get("client_ids") or [], current_user),
        "include_sections": data.get("include_sections", ["summary", "tickets", "devices", "billing", "security"]),
        "format": data.get("format", "json"),
        "enabled": data.get("enabled", True),
        "last_sent": None,
        "send_count": 0,
        "created_by": current_user.get("name", ""),
        "created_at": now,
        "updated_at": now,
    }
    await db.scheduled_reports.insert_one(report)
    return {k: v for k, v in report.items() if k != "_id"}


@router.put("/scheduled-reports/{report_id}")
async def update_scheduled_report(report_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await _scheduled_report_in_scope(report_id, current_user)
    update = {k: v for k, v in data.items() if k not in ("id", "_id", "created_at", "created_by")}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    if "client_ids" in update:
        update["client_ids"] = await _retained_report_client_ids(update["client_ids"], current_user)
    await db.scheduled_reports.update_one(tenant_scoped_query(current_user, {"id": report_id}), {"$set": update})
    return {"message": "Scheduled report updated"}


@router.delete("/scheduled-reports/{report_id}")
async def delete_scheduled_report(report_id: str, current_user: dict = Depends(get_current_user)):
    await _scheduled_report_in_scope(report_id, current_user)
    result = await db.scheduled_reports.delete_one(tenant_scoped_query(current_user, {"id": report_id}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Scheduled report not found")
    # Generated evidence belongs to the schedule lifecycle; remove the test or
    # retired schedule cleanly so it cannot leave orphaned records behind.
    await db.scheduled_report_logs.delete_many(tenant_scoped_query(current_user, {"report_id": report_id}))
    await db.scheduled_report_outputs.delete_many(tenant_scoped_query(current_user, {"schedule_id": report_id}))
    return {"message": "Scheduled report deleted"}


@router.post("/scheduled-reports/{report_id}/toggle")
async def toggle_scheduled_report(report_id: str, current_user: dict = Depends(get_current_user)):
    sr = await _scheduled_report_in_scope(report_id, current_user)
    new_state = not sr.get("enabled", False)
    await db.scheduled_reports.update_one(tenant_scoped_query(current_user, {"id": report_id}), {"$set": {"enabled": new_state}})
    return {"enabled": new_state}


@router.post("/scheduled-reports/{report_id}/send-now")
async def send_report_now(report_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a report snapshot and record its delivery state.

    Email dispatch is intentionally not claimed until an O365 mailbox route is
    configured. The generated snapshot is always retained for audit.
    """
    sr = await _scheduled_report_in_scope(report_id, current_user)

    output = await _report_snapshot(sr, current_user)
    now = datetime.now(timezone.utc).isoformat()
    log = {
        "id": f"srl-{uuid.uuid4().hex[:8]}",
        "tenant_id": platform_tenant_id(current_user),
        "report_id": report_id,
        "report_name": sr.get("name", ""),
        "recipients": sr.get("recipients", []),
        "status": "generated",
        "sent_at": now,
        "triggered_by": current_user.get("name", ""),
        "output_id": output["id"],
    }
    await db.scheduled_report_logs.insert_one(log)
    await db.report_run_history.insert_one({
        "id": f"rrh-{uuid.uuid4().hex[:10]}", "output_id": output["id"],
        "tenant_id": platform_tenant_id(current_user), "client_ids": output.get("client_ids") or [],
        "report_type": output.get("report_type"), "name": sr.get("name"), "generated_at": output["generated_at"],
        "generated_by": output["generated_by"], "origin": "scheduled",
    })
    await db.scheduled_reports.update_one(tenant_scoped_query(current_user, {"id": report_id}), {"$set": {"last_sent": now}, "$inc": {"send_count": 1}})

    return {
        "message": "Report snapshot generated and retained for audit. Configure an O365 delivery route before sending email.",
        "log_id": log["id"], "output_id": output["id"], "delivery_status": "generated",
    }


@router.get("/scheduled-reports/{report_id}/logs")
async def get_report_logs(report_id: str, current_user: dict = Depends(get_current_user)):
    await _scheduled_report_in_scope(report_id, current_user)
    logs = await db.scheduled_report_logs.find(tenant_scoped_query(current_user, {"report_id": report_id}), {"_id": 0}).sort("sent_at", -1).to_list(50)
    return logs


@router.get("/scheduled-reports/{report_id}/outputs")
async def get_report_outputs(report_id: str, current_user: dict = Depends(get_current_user)):
    """Return generated report snapshots for review, export, and audit."""
    await _scheduled_report_in_scope(report_id, current_user)
    outputs = await db.scheduled_report_outputs.find(tenant_scoped_query(current_user, {"schedule_id": report_id}), {"_id": 0}).sort("generated_at", -1).to_list(50)
    return await _visible_report_records(current_user, outputs)


@router.get("/scheduled-reports/stats/overview")
async def get_scheduled_report_stats(current_user: dict = Depends(get_current_user)):
    all_sr = await db.scheduled_reports.find(tenant_scoped_query(current_user), {"_id": 0}).to_list(200)
    all_sr = await _visible_report_records(current_user, all_sr)
    total = len(all_sr)
    active = len([s for s in all_sr if s.get("enabled")])
    total_sent = sum(s.get("send_count", 0) for s in all_sr)
    return {"total": total, "active": active, "total_sent": total_sent}
