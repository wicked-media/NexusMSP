"""Evidence-backed overview for the NexusMSP Mission Control home workspace."""

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from app.database import db
from app.routers.auth import get_current_user


router = APIRouter(tags=["Mission Control"])


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


@router.get("/mission-control/overview")
async def mission_control_overview(current_user: dict = Depends(get_current_user)):
    """Return one live cross-module operating picture without seeded claims."""
    now = datetime.now(timezone.utc)
    day_ago = (now - timedelta(hours=24)).isoformat()
    today = now.date().isoformat()
    thirty_days = (now + timedelta(days=30)).date().isoformat()
    unresolved = {"$nin": ["resolved", "closed", "dismissed", "healed"]}

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
    ) = await asyncio.gather(
        db.clients.count_documents({"status": {"$nin": ["archived", "inactive"]}}),
        db.tickets.count_documents({"status": {"$in": ["open", "in_progress", "waiting", "pending"]}}),
        db.tickets.count_documents({
            "status": {"$in": ["open", "in_progress", "waiting", "pending"]},
            "priority": "critical",
        }),
        db.devices.count_documents({"status": "offline"}),
        db.devices.count_documents({"$or": [{"cpu_percent": {"$gte": 90}}, {"cpu_usage": {"$gte": 90}}]}),
        db.backup_jobs.count_documents({"status": {"$in": ["failed", "error"]}}),
        db.security_alerts.count_documents({"severity": "critical", "status": unresolved}),
        db.vulnerabilities.count_documents({"status": unresolved}),
        db.invoices.count_documents({"status": "overdue"}),
        db.xero_sync_history.count_documents({"status": {"$in": ["failed", "error"]}}),
        db.predictive_alerts.count_documents({"status": "active"}),
        db.self_healing_events.count_documents({"status": {"$in": ["detected", "matched", "executing"]}}),
        db.self_healing_events.count_documents({"status": "healed", "healed_at": {"$gte": day_ago}}),
        db.script_executions.count_documents({
            "status": {"$in": ["completed", "success", "succeeded"]},
            "$or": [{"completed_at": {"$gte": day_ago}}, {"created_at": {"$gte": day_ago}}],
        }),
        db.self_healing_events.count_documents({"status": {"$in": ["failed", "escalated"]}}),
        db.domains.count_documents({"expiry_date": {"$gte": today, "$lte": thirty_days}}),
        db.ssl_certificates.count_documents({"expiry_date": {"$gte": today, "$lte": thirty_days}}),
        db.devices.count_documents({"warranty_expiry": {"$gte": today, "$lte": thirty_days}}),
    )

    client_risk = critical_tickets + overdue_invoices
    security_risk = critical_security + open_vulnerabilities
    expiring_items = expiring_domains + expiring_certificates + expiring_warranties
    infrastructure_risk = offline_devices + high_cpu_devices + failed_backups + expiring_items
    billing_risk = overdue_invoices + failed_xero_syncs
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
            "Invoice exceptions and finance synchronisation failures.",
            "/invoices", _tone(billing_risk, critical_at=5),
            [
                {"label": "Overdue invoices", "value": overdue_invoices},
                {"label": "Failed Xero syncs", "value": failed_xero_syncs},
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

    attention = []
    queries = [
        (
            db.tickets,
            {"status": {"$in": ["open", "in_progress", "waiting", "pending"]}, "priority": "critical"},
            {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_name": 1},
            "critical", "Critical ticket",
            lambda row: f"/tickets?ticket={row.get('ticket_number') or row.get('id')}",
            lambda row: row.get("title") or row.get("ticket_number") or "Critical ticket",
            lambda row: row.get("client_name") or "Service desk",
        ),
        (
            db.devices,
            {"status": "offline"},
            {"_id": 0, "id": 1, "name": 1, "hostname": 1, "client_name": 1},
            "critical", "Offline asset",
            lambda row: f"/devices/{row.get('id')}",
            lambda row: f"{row.get('name') or row.get('hostname') or 'Asset'} is offline",
            lambda row: row.get("client_name") or "Managed Assets",
        ),
        (
            db.backup_jobs,
            {"status": {"$in": ["failed", "error"]}},
            {"_id": 0, "id": 1, "name": 1, "client_name": 1, "error": 1},
            "critical", "Backup failure",
            lambda row: "/backup-center",
            lambda row: row.get("name") or "Backup job failed",
            lambda row: row.get("client_name") or row.get("error") or "Backups",
        ),
        (
            db.invoices,
            {"status": "overdue"},
            {"_id": 0, "id": 1, "invoice_number": 1, "client_name": 1},
            "warning", "Billing exception",
            lambda row: "/invoices",
            lambda row: f"{row.get('invoice_number') or 'Invoice'} is overdue",
            lambda row: row.get("client_name") or "Billing",
        ),
        (
            db.predictive_alerts,
            {"status": "active"},
            {"_id": 0, "id": 1, "device_name": 1, "failure_type": 1, "client_name": 1},
            "warning", "Predictive finding",
            lambda row: "/auto-ops?tab=predictive",
            lambda row: row.get("failure_type") or f"Risk detected for {row.get('device_name') or 'an asset'}",
            lambda row: row.get("client_name") or row.get("device_name") or "AI Operations",
        ),
    ]
    samples = await asyncio.gather(*[
        collection.find(query, projection).limit(3).to_list(3)
        for collection, query, projection, *_ in queries
    ])
    for definition, rows in zip(queries, samples):
        _, _, _, severity, source, route_for, title_for, detail_for = definition
        for row in rows:
            attention.append({
                "id": f"{source.lower().replace(' ', '-')}-{row.get('id') or row.get('ticket_number') or len(attention)}",
                "severity": severity,
                "source": source,
                "title": title_for(row),
                "detail": detail_for(row),
                "route": route_for(row),
            })

    attention.sort(key=lambda item: 0 if item["severity"] == "critical" else 1)
    capabilities = [
        {"id": "digital-twin", "label": "Client Digital Twin", "description": "Live client profile, health and connected services.", "route": "/clients"},
        {"id": "relationship-map", "label": "Relationship Map", "description": "Understand client, user, asset and service dependencies.", "route": "/clients"},
        {"id": "automation-studio", "label": "Automation Studio", "description": "No-code and JSON workflows with approval-aware orchestration.", "route": "/workflow-automation"},
        {"id": "automation-marketplace", "label": "Automation Marketplace", "description": "Install verified lifecycle, security and compliance packs.", "route": "/workflow-automation?tab=marketplace"},
        {"id": "simulation-mode", "label": "Simulation Mode", "description": "Preview before/after, risk and rollback without executing.", "route": "/workflow-automation?tab=simulations"},
        {"id": "change-management", "label": "Change Management", "description": "Independent approval and retained implementation evidence.", "route": "/change-management"},
        {"id": "security-graph", "label": "Security Graph", "description": "Trace evidence-backed identity, endpoint, control and client exposure.", "route": "/security-graph"},
        {"id": "predictive-ai", "label": "Predictive AI", "description": "Forecast endpoint and service risk.", "route": "/auto-ops?tab=predictive"},
        {"id": "ai-documentation", "label": "AI Documentation", "description": "Generate and review living operational documents.", "route": "/documentation-hub?tab=automation"},
        {"id": "operational-timeline", "label": "Operational Timeline", "description": "One audited history across client operations.", "route": "/client-insights?tab=client-timeline"},
        {"id": "network-map", "label": "Live Network Map", "description": "Open discovered client topology and current node health.", "route": "/topology"},
        {"id": "client-portal", "label": "Client Portal 2.0", "description": "Client-facing service, approvals, projects and billing.", "route": "/client-portal-admin"},
        {"id": "benchmarking", "label": "MSP Benchmarking", "description": "Compare attributable operational measures and evidence coverage.", "route": "/benchmarking"},
        {"id": "client-lifecycle", "label": "Customer Lifecycle", "description": "Move prospects through onboarding, active service and renewal.", "route": "/onboarding"},
        {"id": "compliance-centre", "label": "Compliance Centre", "description": "Assess observable controls and generate evidence-backed reports.", "route": "/compliance"},
        {"id": "integration-framework", "label": "Integration Framework", "description": "Manage connectors, webhooks, API tokens and provider health.", "route": "/integrations"},
        {"id": "cost-optimizer", "label": "Cost Optimizer", "description": "Find billing, licence and service-cost exceptions.", "route": "/financial-analytics"},
        {"id": "business-advisor", "label": "AI Business Advisor", "description": "Turn growth, risk and cost signals into client recommendations.", "route": "/growth"},
        {"id": "ai-technician", "label": "AI Technician", "description": "Triage, route, resolve and self-heal with approval.", "route": "/auto-ops"},
        {"id": "control-plane", "label": "Nexus Control Plane", "description": "Search and operate connected client services.", "route": "/control-plane"},
    ]

    return {
        "generated_at": now.isoformat(),
        "operator": current_user.get("name") or current_user.get("email") or "Operator",
        "summary": {
            "attention_count": (
                client_risk + security_risk + infrastructure_risk
                + failed_xero_syncs + automation_risk + ai_risk
            ),
            "automated_actions_24h": automated_actions_24h,
            "evidence_note": "Counts are calculated from live NexusMSP records; no demo values are included.",
        },
        "panels": panels,
        "attention": attention[:12],
        "capabilities": capabilities,
    }
