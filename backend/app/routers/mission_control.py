"""Evidence-backed Mission Control for the NexusMSP home workspace."""

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from app.database import db
from app.routers.auth import get_current_user
from app.services.nexus_brain import build_nexus_brain
from app.services.scope_permissions import scoped_query


router = APIRouter(tags=["Mission Control"])


@router.get("/mission-control/brain")
async def mission_control_brain(
    window_hours: int = Query(12, ge=1, le=48),
    current_user: dict = Depends(get_current_user),
):
    """Return an evidence-backed daily briefing and correlated client insights."""
    return await build_nexus_brain(current_user, window_hours=window_hours)


def _panel(panel_id, label, count, summary, route, tone, metrics):
    return {
        "id": panel_id,
        "label": label,
        "count": int(count or 0),
        "summary": summary,
        "route": route,
        "tone": tone,
        "metrics": metrics,
    }


def _tone(count, warning_at=1, critical_at=None):
    if critical_at is not None and count >= critical_at:
        return "critical"
    return "warning" if count >= warning_at else "healthy"


def _query(user, query=None, *, field="client_id", site_field="site_id"):
    return scoped_query(user, query or {}, field=field, site_field=site_field)


def _money(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _work_item(
    item_id,
    *,
    severity,
    source,
    title,
    detail,
    route,
    why,
    recommendation,
    estimated_minutes,
    confidence=None,
    client_name=None,
):
    return {
        "id": item_id,
        "severity": severity,
        "source": source,
        "title": title,
        "detail": detail,
        "route": route,
        "why": why,
        "recommendation": recommendation,
        "estimated_minutes": estimated_minutes,
        "confidence": confidence,
        "client_name": client_name,
    }


@router.get("/mission-control/overview")
async def mission_control_overview(current_user: dict = Depends(get_current_user)):
    """Return one scoped operating picture that answers what to do next."""
    now = datetime.now(timezone.utc)
    day_ago = (now - timedelta(hours=24)).isoformat()
    today = now.date().isoformat()
    thirty_days = (now + timedelta(days=30)).date().isoformat()
    unresolved = {"$nin": ["resolved", "closed", "dismissed", "healed"]}
    active_ticket_statuses = ["open", "in_progress", "waiting", "pending"]

    (
        clients,
        open_tickets,
        critical_tickets,
        offline_devices,
        high_cpu_devices,
        failed_backups,
        critical_security,
        open_vulnerabilities,
        overdue_invoices,
        failed_xero_syncs,
        active_predictions,
        active_healings,
        healed_24h,
        scripts_24h,
        failed_automations,
        expiring_domains,
        expiring_certificates,
        expiring_warranties,
        unbilled_time,
        uninvoiced_product_tickets,
    ) = await asyncio.gather(
        db.clients.count_documents(_query(
            current_user,
            {"status": {"$nin": ["archived", "inactive"]}},
            field="id",
            site_field=None,
        )),
        db.tickets.count_documents(_query(current_user, {"status": {"$in": active_ticket_statuses}})),
        db.tickets.count_documents(_query(current_user, {
            "status": {"$in": active_ticket_statuses},
            "priority": "critical",
        })),
        db.devices.count_documents(_query(current_user, {"status": "offline"})),
        db.devices.count_documents(_query(current_user, {
            "$or": [{"cpu_percent": {"$gte": 90}}, {"cpu_usage": {"$gte": 90}}],
        })),
        db.backup_jobs.count_documents(_query(current_user, {"status": {"$in": ["failed", "error"]}})),
        db.security_alerts.count_documents(_query(current_user, {
            "severity": "critical",
            "status": unresolved,
        })),
        db.vulnerabilities.count_documents(_query(current_user, {"status": unresolved})),
        db.invoices.count_documents(_query(current_user, {"status": "overdue"})),
        db.xero_sync_history.count_documents(_query(current_user, {"status": {"$in": ["failed", "error"]}})),
        db.predictive_alerts.count_documents(_query(current_user, {"status": "active"})),
        db.self_healing_events.count_documents(_query(current_user, {
            "status": {"$in": ["detected", "matched", "executing"]},
        })),
        db.self_healing_events.count_documents(_query(current_user, {
            "status": "healed",
            "healed_at": {"$gte": day_ago},
        })),
        db.script_executions.count_documents(_query(current_user, {
            "status": {"$in": ["completed", "success", "succeeded"]},
            "$or": [{"completed_at": {"$gte": day_ago}}, {"created_at": {"$gte": day_ago}}],
        })),
        db.self_healing_events.count_documents(_query(current_user, {
            "status": {"$in": ["failed", "escalated"]},
        })),
        db.domains.count_documents(_query(current_user, {
            "expiry_date": {"$gte": today, "$lte": thirty_days},
        })),
        db.ssl_certificates.count_documents(_query(current_user, {
            "expiry_date": {"$gte": today, "$lte": thirty_days},
        })),
        db.devices.count_documents(_query(current_user, {
            "warranty_expiry": {"$gte": today, "$lte": thirty_days},
        })),
        db.time_entries.count_documents(_query(current_user, {
            "invoiced": {"$ne": True},
            "billable": {"$ne": False},
        })),
        db.tickets.count_documents(_query(current_user, {
            "products": {"$exists": True, "$ne": []},
            "products_invoiced": {"$ne": True},
        })),
    )

    expiring_items = expiring_domains + expiring_certificates + expiring_warranties
    client_risk = critical_tickets + overdue_invoices
    security_risk = critical_security + open_vulnerabilities
    infrastructure_risk = offline_devices + high_cpu_devices + failed_backups + expiring_items
    billing_risk = overdue_invoices + failed_xero_syncs + unbilled_time + uninvoiced_product_tickets
    automation_risk = active_healings + failed_automations
    ai_risk = active_predictions
    automated_actions_24h = healed_24h + scripts_24h

    panels = [
        _panel(
            "client-health", "Client Health", client_risk,
            "Live service and commercial risk across the client portfolio.",
            "/clients", _tone(client_risk, critical_at=5),
            [
                {"label": "Active clients", "value": clients},
                {"label": "Active tickets", "value": open_tickets},
                {"label": "Critical tickets", "value": critical_tickets},
            ],
        ),
        _panel(
            "security", "Security", security_risk,
            "Critical alerts and unresolved vulnerability evidence.",
            "/security-dashboard", _tone(security_risk, critical_at=5),
            [
                {"label": "Critical alerts", "value": critical_security},
                {"label": "Open vulnerabilities", "value": open_vulnerabilities},
            ],
        ),
        _panel(
            "infrastructure", "Infrastructure", infrastructure_risk,
            "Endpoint, backup, domain, certificate and warranty health.",
            "/devices", _tone(infrastructure_risk, critical_at=8),
            [
                {"label": "Offline assets", "value": offline_devices},
                {"label": "Failed backups", "value": failed_backups},
                {"label": "Expiring items", "value": expiring_items},
            ],
        ),
        _panel(
            "billing", "Billing", billing_risk,
            "Unbilled work, invoice exceptions and finance synchronisation failures.",
            "/billing-recon", _tone(billing_risk, critical_at=8),
            [
                {"label": "Unbilled time", "value": unbilled_time},
                {"label": "Uninvoiced products", "value": uninvoiced_product_tickets},
                {"label": "Overdue invoices", "value": overdue_invoices},
            ],
        ),
        _panel(
            "automation", "Automation", automation_risk,
            "Self-healing work in progress and exceptions requiring review.",
            "/automation-hub", _tone(automation_risk, critical_at=5),
            [
                {"label": "Active healing", "value": active_healings},
                {"label": "Exceptions", "value": failed_automations},
                {"label": "Completed 24h", "value": automated_actions_24h},
            ],
        ),
        _panel(
            "ai-insights", "AI Insights", ai_risk,
            "Predictive findings backed by current Nexus telemetry.",
            "/auto-ops?tab=predictive", _tone(ai_risk, critical_at=8),
            [
                {"label": "Active predictions", "value": active_predictions},
                {"label": "Automated actions 24h", "value": automated_actions_24h},
            ],
        ),
    ]

    (
        critical_ticket_rows,
        offline_rows,
        backup_rows,
        security_rows,
        device_attention_rows,
        automation_rows,
        domain_rows,
        certificate_rows,
        warranty_rows,
        prediction_rows,
        time_rows,
        product_ticket_rows,
        overdue_rows,
        xero_rows,
    ) = await asyncio.gather(
        db.tickets.find(
            _query(current_user, {"status": {"$in": active_ticket_statuses}, "priority": "critical"}),
            {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_name": 1, "sla_due_at": 1},
        ).limit(4).to_list(4),
        db.devices.find(
            _query(current_user, {"status": "offline"}),
            {"_id": 0, "id": 1, "name": 1, "hostname": 1, "client_name": 1, "last_seen": 1},
        ).limit(3).to_list(3),
        db.backup_jobs.find(
            _query(current_user, {"status": {"$in": ["failed", "error"]}}),
            {"_id": 0, "id": 1, "name": 1, "client_name": 1, "error": 1, "last_run": 1},
        ).limit(3).to_list(3),
        db.security_alerts.find(
            _query(current_user, {"severity": "critical", "status": unresolved}),
            {"_id": 0, "id": 1, "title": 1, "message": 1, "client_name": 1, "device_name": 1},
        ).limit(3).to_list(3),
        db.devices.find(
            _query(current_user, {
                "status": {"$ne": "offline"},
                "$or": [
                    {"cpu_percent": {"$gte": 90}},
                    {"cpu_usage": {"$gte": 90}},
                    {"pending_patches": {"$gt": 0}},
                ],
            }),
            {
                "_id": 0, "id": 1, "name": 1, "hostname": 1, "client_name": 1,
                "cpu_percent": 1, "cpu_usage": 1, "pending_patches": 1,
            },
        ).limit(4).to_list(4),
        db.self_healing_events.find(
            _query(current_user, {"status": {"$in": ["failed", "escalated"]}}),
            {"_id": 0, "id": 1, "title": 1, "device_name": 1, "client_name": 1, "error": 1},
        ).limit(3).to_list(3),
        db.domains.find(
            _query(current_user, {"expiry_date": {"$gte": today, "$lte": thirty_days}}),
            {"_id": 0, "id": 1, "domain": 1, "name": 1, "client_name": 1, "expiry_date": 1},
        ).limit(2).to_list(2),
        db.ssl_certificates.find(
            _query(current_user, {"expiry_date": {"$gte": today, "$lte": thirty_days}}),
            {"_id": 0, "id": 1, "domain": 1, "name": 1, "client_name": 1, "expiry_date": 1},
        ).limit(2).to_list(2),
        db.devices.find(
            _query(current_user, {"warranty_expiry": {"$gte": today, "$lte": thirty_days}}),
            {"_id": 0, "id": 1, "name": 1, "hostname": 1, "client_name": 1, "warranty_expiry": 1},
        ).limit(2).to_list(2),
        db.predictive_alerts.find(
            _query(current_user, {"status": "active"}),
            {
                "_id": 0, "id": 1, "failure_type": 1, "device_name": 1, "client_name": 1,
                "reason": 1, "recommendation": 1, "confidence": 1, "days_until_failure": 1,
            },
        ).limit(4).to_list(4),
        db.time_entries.find(
            _query(current_user, {"invoiced": {"$ne": True}, "billable": {"$ne": False}}),
            {
                "_id": 0, "id": 1, "ticket_id": 1, "ticket_number": 1, "description": 1,
                "client_name": 1, "total_amount": 1, "hours": 1, "hourly_rate": 1,
            },
        ).sort("date", -1).limit(3).to_list(3),
        db.tickets.find(
            _query(current_user, {
                "products": {"$exists": True, "$ne": []},
                "products_invoiced": {"$ne": True},
            }),
            {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_name": 1, "products": 1},
        ).limit(3).to_list(3),
        db.invoices.find(
            _query(current_user, {"status": "overdue"}),
            {
                "_id": 0, "id": 1, "invoice_number": 1, "invoice_name": 1,
                "client_name": 1, "total": 1, "due_date": 1,
            },
        ).limit(3).to_list(3),
        db.xero_sync_history.find(
            _query(current_user, {"status": {"$in": ["failed", "error"]}}),
            {"_id": 0, "id": 1, "entity": 1, "message": 1, "client_name": 1, "created_at": 1},
        ).limit(3).to_list(3),
    )

    critical_items = []
    for row in critical_ticket_rows:
        ticket_ref = row.get("ticket_number") or row.get("id")
        critical_items.append(_work_item(
            f"critical-ticket-{ticket_ref}",
            severity="critical",
            source="Service desk",
            title=row.get("title") or f"Critical ticket {ticket_ref}",
            detail=f"{ticket_ref} · {row.get('client_name') or 'Unassigned client'}",
            route=f"/tickets?ticket={ticket_ref}",
            why="This ticket is both active and marked critical, so it can affect SLA and client impact.",
            recommendation="Open the case brief, confirm ownership and record the next technician action.",
            estimated_minutes=5,
            confidence="High",
            client_name=row.get("client_name"),
        ))
    for row in offline_rows:
        device_name = row.get("name") or row.get("hostname") or "Managed asset"
        critical_items.append(_work_item(
            f"offline-{row.get('id')}",
            severity="critical",
            source="Managed Assets",
            title=f"{device_name} is offline",
            detail=row.get("client_name") or "Client not linked",
            route=f"/devices/{row.get('id')}",
            why="The Nexus agent is no longer reporting a healthy check-in for this endpoint.",
            recommendation="Review recent signals, verify connectivity and start the approved recovery workflow.",
            estimated_minutes=8,
            confidence="High",
            client_name=row.get("client_name"),
        ))
    for row in backup_rows:
        critical_items.append(_work_item(
            f"backup-{row.get('id')}",
            severity="critical",
            source="Backups",
            title=row.get("name") or "Backup job failed",
            detail=row.get("client_name") or row.get("error") or "Recovery protection",
            route="/backup-center",
            why=row.get("error") or "The latest recorded backup state is failed and recovery coverage may be reduced.",
            recommendation="Verify the failure, confirm the last restorable point and retry through the protected action.",
            estimated_minutes=10,
            confidence="High",
            client_name=row.get("client_name"),
        ))
    for row in security_rows:
        critical_items.append(_work_item(
            f"security-{row.get('id')}",
            severity="critical",
            source="Security",
            title=row.get("title") or row.get("message") or "Critical security alert",
            detail=row.get("client_name") or row.get("device_name") or "Security operations",
            route="/security-dashboard",
            why="This unresolved alert is recorded at critical severity.",
            recommendation="Open the evidence, establish containment scope and assign an incident owner.",
            estimated_minutes=6,
            confidence="High",
            client_name=row.get("client_name"),
        ))

    attention_items = []
    for row in device_attention_rows:
        device_name = row.get("name") or row.get("hostname") or "Managed asset"
        patches = int(row.get("pending_patches") or 0)
        cpu = max(_money(row.get("cpu_percent")), _money(row.get("cpu_usage")))
        if patches:
            reason = f"{patches} approved update{'s are' if patches != 1 else ' is'} still pending."
            action = "Review maintenance timing and deploy the approved patch set."
        else:
            reason = f"CPU utilisation is recorded at {cpu:.0f}%."
            action = "Inspect the active process load and compare recent telemetry before remediation."
        attention_items.append(_work_item(
            f"device-attention-{row.get('id')}",
            severity="warning",
            source="Managed Assets",
            title=f"Review {device_name}",
            detail=row.get("client_name") or "Endpoint health",
            route=f"/devices/{row.get('id')}",
            why=reason,
            recommendation=action,
            estimated_minutes=7,
            confidence="High",
            client_name=row.get("client_name"),
        ))
    for row in automation_rows:
        attention_items.append(_work_item(
            f"automation-{row.get('id')}",
            severity="warning",
            source="Automation",
            title=row.get("title") or f"Self-healing exception on {row.get('device_name') or 'an endpoint'}",
            detail=row.get("client_name") or row.get("error") or "Automation exception",
            route="/automation-hub",
            why=row.get("error") or "A self-healing workflow ended in an exception state.",
            recommendation="Review the execution timeline and approve a retry or escalation.",
            estimated_minutes=6,
            confidence="High",
            client_name=row.get("client_name"),
        ))
    for kind, rows, route in (
        ("Domain", domain_rows, "/expiry-tracker?tab=domains"),
        ("Certificate", certificate_rows, "/expiry-tracker?tab=ssl"),
        ("Warranty", warranty_rows, "/expiry-tracker?tab=warranties"),
    ):
        for row in rows:
            name = row.get("domain") or row.get("name") or row.get("hostname") or kind
            expiry = row.get("expiry_date") or row.get("warranty_expiry")
            attention_items.append(_work_item(
                f"{kind.lower()}-{row.get('id')}",
                severity="warning",
                source="Lifecycle",
                title=f"{name} expires soon",
                detail=f"{row.get('client_name') or 'Client not linked'} · {expiry or 'Within 30 days'}",
                route=route,
                why=f"The recorded {kind.lower()} date falls within the next 30 days.",
                recommendation=f"Confirm ownership and schedule the {kind.lower()} renewal or replacement.",
                estimated_minutes=5,
                confidence="High",
                client_name=row.get("client_name"),
            ))

    suggestion_items = []
    for row in prediction_rows:
        device_name = row.get("device_name") or "Managed asset"
        failure_type = row.get("failure_type") or "Predicted service degradation"
        days = row.get("days_until_failure")
        suggestion_items.append(_work_item(
            f"prediction-{row.get('id')}",
            severity="insight",
            source="Nexus AI",
            title=failure_type,
            detail=f"{device_name} · {row.get('client_name') or 'Client not linked'}",
            route="/auto-ops?tab=predictive",
            why=row.get("reason") or (
                f"Current telemetry indicates this may occur within {days} days."
                if days is not None else
                "Current telemetry has crossed the predictive risk threshold."
            ),
            recommendation=row.get("recommendation") or "Review the evidence and plan a preventative action.",
            estimated_minutes=8,
            confidence=row.get("confidence") or "Evidence-backed",
            client_name=row.get("client_name"),
        ))
    if not suggestion_items and backup_rows:
        row = backup_rows[0]
        suggestion_items.append(_work_item(
            f"suggestion-backup-{row.get('id')}",
            severity="insight",
            source="Nexus AI",
            title="Protect the recovery chain first",
            detail=row.get("client_name") or row.get("name") or "Backup operations",
            route="/backup-center",
            why="A failed backup has the highest immediate impact on recoverability among current signals.",
            recommendation="Verify the last restore point before addressing lower-impact operational work.",
            estimated_minutes=10,
            confidence="High",
            client_name=row.get("client_name"),
        ))

    revenue_items = []
    for row in time_rows:
        amount = _money(row.get("total_amount"))
        if amount <= 0:
            amount = _money(row.get("hours")) * _money(row.get("hourly_rate"))
        ticket_ref = row.get("ticket_number") or row.get("ticket_id") or "Unlinked ticket"
        revenue_items.append(_work_item(
            f"unbilled-time-{row.get('id')}",
            severity="revenue",
            source="Revenue Protection",
            title=f"Unbilled technician time · ${amount:,.2f}",
            detail=f"{ticket_ref} · {row.get('client_name') or 'Client link required'}",
            route="/billing-recon",
            why="This billable time entry is not attached to an invoice.",
            recommendation="Confirm the client, ticket and rate, then add it to the next invoice.",
            estimated_minutes=3,
            confidence="High",
            client_name=row.get("client_name"),
        ))
    for row in product_ticket_rows:
        amount = sum(
            _money(product.get("price")) * max(1, int(product.get("quantity") or 1))
            for product in (row.get("products") or [])
        )
        ticket_ref = row.get("ticket_number") or row.get("id")
        revenue_items.append(_work_item(
            f"uninvoiced-products-{row.get('id')}",
            severity="revenue",
            source="Revenue Protection",
            title=f"Products not invoiced · ${amount:,.2f}",
            detail=f"{ticket_ref} · {row.get('client_name') or 'Client link required'}",
            route="/billing-recon",
            why="Products are recorded on the ticket but have not been marked as invoiced.",
            recommendation="Validate quantities and transfer the linked line items into an invoice.",
            estimated_minutes=4,
            confidence="High",
            client_name=row.get("client_name"),
        ))
    for row in overdue_rows:
        invoice_ref = row.get("invoice_name") or row.get("invoice_number") or "Invoice"
        revenue_items.append(_work_item(
            f"overdue-{row.get('id')}",
            severity="revenue",
            source="Accounts receivable",
            title=f"{invoice_ref} is overdue · ${_money(row.get('total')):,.2f}",
            detail=row.get("client_name") or "Client not linked",
            route=f"/invoices?invoice={row.get('id')}",
            why=f"The recorded due date {row.get('due_date') or 'has passed'} and the invoice remains overdue.",
            recommendation="Review delivery evidence and start the approved payment follow-up.",
            estimated_minutes=4,
            confidence="High",
            client_name=row.get("client_name"),
        ))
    for row in xero_rows:
        revenue_items.append(_work_item(
            f"xero-{row.get('id')}",
            severity="revenue",
            source="Xero reconciliation",
            title=row.get("entity") or "Accounting synchronisation failed",
            detail=row.get("client_name") or row.get("message") or "Finance integration",
            route="/billing-recon",
            why=row.get("message") or "The latest accounting synchronisation did not complete.",
            recommendation="Review the integration evidence and retry the failed reconciliation.",
            estimated_minutes=5,
            confidence="High",
            client_name=row.get("client_name"),
        ))

    critical_pressure = critical_tickets + offline_devices + failed_backups + critical_security
    warning_pressure = (
        high_cpu_devices + open_vulnerabilities + failed_automations
        + expiring_items + active_predictions + overdue_invoices + failed_xero_syncs
    )
    health_score = max(
        0,
        100 - min(55, critical_pressure * 7) - min(30, warning_pressure * 2),
    )
    health_label = "Healthy" if health_score >= 90 else "Stable" if health_score >= 75 else "At risk" if health_score >= 50 else "Critical"
    health_factors = []
    if critical_tickets:
        health_factors.append(f"{critical_tickets} critical ticket{'s' if critical_tickets != 1 else ''}")
    if offline_devices:
        health_factors.append(f"{offline_devices} offline asset{'s' if offline_devices != 1 else ''}")
    if failed_backups:
        health_factors.append(f"{failed_backups} failed backup{'s' if failed_backups != 1 else ''}")
    if billing_risk:
        health_factors.append(f"{billing_risk} billing exception{'s' if billing_risk != 1 else ''}")
    if not health_factors:
        health_factors.append("No material exceptions found in connected Nexus records")

    focus = (
        critical_items[0]
        if critical_items else
        suggestion_items[0]
        if suggestion_items else
        attention_items[0]
        if attention_items else
        revenue_items[0]
        if revenue_items else
        _work_item(
            "focus-clear",
            severity="healthy",
            source="Nexus Mission Control",
            title="No urgent action is required",
            detail="Connected operational records are currently clear.",
            route="/clients",
            why="No critical, warning, predictive or revenue exception was found.",
            recommendation="Review client opportunities and plan the highest-value proactive work.",
            estimated_minutes=5,
            confidence="High",
        )
    )

    workstreams = [
        {
            "id": "critical",
            "label": "Critical",
            "description": "Client-impacting work to own now.",
            "count": critical_pressure,
            "items": critical_items[:4],
        },
        {
            "id": "attention",
            "label": "Needs Attention",
            "description": "Work to schedule before it becomes urgent.",
            "count": high_cpu_devices + failed_automations + expiring_items,
            "items": attention_items[:4],
        },
        {
            "id": "suggestions",
            "label": "AI Suggestions",
            "description": "Evidence-backed preventative recommendations.",
            "count": len(suggestion_items),
            "items": suggestion_items[:4],
        },
        {
            "id": "revenue",
            "label": "Revenue",
            "description": "Billable work and finance exceptions.",
            "count": billing_risk,
            "items": revenue_items[:4],
        },
    ]

    attention_count = critical_pressure + warning_pressure + unbilled_time + uninvoiced_product_tickets
    return {
        "generated_at": now.isoformat(),
        "operator": current_user.get("name") or current_user.get("email") or "Operator",
        "summary": {
            "attention_count": attention_count,
            "automated_actions_24h": automated_actions_24h,
            "health_score": health_score,
            "health_label": health_label,
            "health_factors": health_factors[:4],
            "evidence_note": "Every item is calculated from live, access-scoped NexusMSP records; no demo claims are included.",
        },
        "focus": focus,
        "panels": panels,
        "workstreams": workstreams,
    }
