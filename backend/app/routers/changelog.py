"""Changelog feed — single source of truth for 'What's New' tile + Help Center.

Keep this file tidy: newest entries first, drop entries older than ~120 days unless
they're foundational. Each entry must include id, date (YYYY-MM-DD), title, summary,
category (feature|merge|fix|polish), and optional links.
"""
from fastapi import APIRouter, Depends
from app.auth import get_current_user
from datetime import datetime
from typing import Optional

router = APIRouter()

CHANGELOG = [
    {
        "id": "dedup-audit-feb26",
        "date": "2026-06-25",
        "title": "Big Cleanup — modules merged & dedup'd",
        "summary": "Auditioned every backend router and frontend page. Deleted 27 orphan files, merged 12 backend routers into 6 canonical ones, added a tabbed Settings hub (16 tabs) and four new conceptual hubs.",
        "category": "merge",
        "highlights": [
            "Backup Center, Compliance, Revenue, Predictive, Onboarding, Workshop and SOC routers consolidated",
            "New hubs: Client Insights (/client-insights), Auto-Ops (/auto-ops), Credentials (/credentials), Team Hub (/team-hub)",
            "Settings page now exposes 16 tabs (Ticket Defaults, Ping, White Label, Channel Mode, API Tokens, 2FA, Notify Channels, My Workspace + the original 8)",
            "All deep-links preserved via ?tab=<id>",
        ],
        "links": [
            {"label": "Client Insights Hub", "to": "/client-insights"},
            {"label": "Auto-Ops Hub", "to": "/auto-ops"},
            {"label": "Credentials Hub", "to": "/credentials"},
            {"label": "Team Hub", "to": "/team-hub"},
        ],
    },
    {
        "id": "tactical-ticket-console-v2",
        "date": "2026-06-24",
        "title": "Tactical Ticket Console v2",
        "summary": "Cleaner ticket detail header with a single-row Console Header. Change Customer flow lets you reassign a ticket to a different client in 2 clicks. Old duplicate panels tucked behind a 'legacyHeader' layout toggle for power users.",
        "category": "feature",
        "highlights": [
            "TicketConsoleHeader.jsx — one-row hero with status, SLA pill, owner, priority and quick actions",
            "ChangeCustomerDialog — reassign tickets without losing thread history",
            "Legacy header still available behind the widget toggle if you miss it",
        ],
        "links": [{"label": "Open Tickets", "to": "/tickets"}],
    },
    {
        "id": "m365-command-center",
        "date": "2026-06-23",
        "title": "M365 Command Center (CIPP-killer)",
        "summary": "Multi-tenant M365 lens: tenants, users, standards engine, GDAP, security and alerts. Currently runs on mock data — add Microsoft Partner Center credentials in Settings → Integrations to switch to live Graph API.",
        "category": "feature",
        "highlights": [
            "15 seeded standards (identity, exchange, defender, intune, sharepoint, teams)",
            "7-step offboarding wizard",
            "GDAP relationships with +1y extend",
            "8 Conditional Access templates",
            "5 scripted alerts (impossible travel, new admin, mass delete, inbox forward external, guest admin)",
        ],
        "links": [{"label": "Open M365", "to": "/m365"}],
    },
    {
        "id": "maintenance-windows",
        "date": "2026-06-22",
        "title": "Autonomous Maintenance Windows",
        "summary": "Schedule cron-style maintenance windows that fan-out actions (reboot, run script, install patch) across target devices. Backend scheduler runs continuously and writes a full audit trail.",
        "category": "feature",
        "highlights": [
            "Schedule from the Devices page",
            "Run history view with success/failure per device",
            "AI-generated summaries via Claude for every run",
        ],
        "links": [{"label": "Devices", "to": "/devices"}, {"label": "Maintenance Scheduler", "to": "/maintenance-scheduler"}],
    },
    {
        "id": "device-smart-features",
        "date": "2026-06-21",
        "title": "Syncro-killer Device Smart Bar",
        "summary": "Inline action strip on device rows — diagnose, restart agent, push script, view live metrics — all without leaving the list. AI-powered diagnostics provide a one-click summary of why a device is sad.",
        "category": "feature",
        "highlights": [
            "DevicesSmartBar above the table",
            "DeviceCommandStrip on every row",
            "Live Metrics drawer (CPU/RAM/Disk live)",
            "AI Diagnose using Claude",
        ],
        "links": [{"label": "Devices", "to": "/devices"}],
    },
    {
        "id": "invoice-studio",
        "date": "2026-06-20",
        "title": "Invoice Studio + Smart Billing Engine",
        "summary": "Drag-and-drop invoice template builder with gallery presets. AI drafts invoices from ticket time + parts, summarises aged AR, predicts renewal risk and runs smart recurring billing.",
        "category": "feature",
        "highlights": [
            "Block-based PDF templates",
            "AI invoice draft from ticket activity",
            "Aged AR insights",
            "Renewal risk + smart recurring scheduling",
        ],
        "links": [{"label": "Invoice Templates", "to": "/invoice-templates"}, {"label": "Invoices", "to": "/invoices"}],
    },
]


@router.get("/changelog/entries")
async def get_changelog(limit: int = 20, current_user: dict = Depends(get_current_user)):
    """Return the most recent changelog entries (newest first)."""
    return {
        "entries": CHANGELOG[:max(1, min(limit, 100))],
        "total": len(CHANGELOG),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


@router.get("/changelog/since")
async def changelog_since(date: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Return entries published on or after a given ISO date (YYYY-MM-DD).
    Used by the dashboard tile to compute the 'new since you last visited' count.
    """
    if not date:
        return {"entries": CHANGELOG, "count": len(CHANGELOG)}
    rows = [c for c in CHANGELOG if c.get("date", "") >= date]
    return {"entries": rows, "count": len(rows)}
