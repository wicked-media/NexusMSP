"""Live, evidence-based overview for the Nexus product suite."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db


router = APIRouter()


async def _count(collection, query: dict | None = None) -> int:
    return await collection.count_documents(query or {})


@router.get("/suite/overview")
async def suite_overview(current_user: dict = Depends(get_current_user)):
    (
        clients,
        tickets,
        devices,
        shield_events,
        backup_jobs,
        remote_sessions,
        voice_pbxs,
        usage_plans,
        network_sites,
        dns_domains,
        projects,
        invoices,
        insights,
        ai_actions,
        installed_packs,
    ) = await asyncio.gather(
        _count(db.clients),
        _count(db.tickets),
        _count(db.devices),
        _count(db.shield_events),
        _count(db.backup_jobs),
        _count(db.remote_sessions),
        _count(db.yeastar_pbxs, {"enabled": {"$ne": False}, "status": {"$in": ["online", "connected"]}}),
        _count(db.usage_billing),
        _count(db.network_sites),
        _count(db.dns_domains),
        _count(db.projects),
        _count(db.invoices),
        _count(db.ai_insights),
        _count(db.ai_action_history),
        _count(db.automation_pack_installations),
    )

    evidence = {
        "nexusmsp": {"label": "Clients in scope", "value": clients},
        "control": {"label": "Operational records", "value": clients + devices + tickets},
        "shield": {"label": "Security events", "value": shield_events},
        "backup": {"label": "Backup jobs", "value": backup_jobs},
        "remote": {"label": "Audited sessions", "value": remote_sessions},
        "voice": {"label": "Connected PBXs", "value": voice_pbxs},
        "telecom": {"label": "Usage plans", "value": usage_plans},
        "monitor": {"label": "Managed endpoints", "value": devices},
        "deploy": {"label": "Installed packs", "value": installed_packs},
        "network": {"label": "Network sites", "value": network_sites},
        "dns": {"label": "Monitored domains", "value": dns_domains},
        "projects": {"label": "Project records", "value": projects},
        "finance": {"label": "Invoice records", "value": invoices},
        "insight": {"label": "Insight records", "value": insights},
        "ai": {"label": "Reviewed AI actions", "value": ai_actions},
    }

    return {
        "evidence": evidence,
        "totals": {
            "products": len(evidence),
            "provider_backed_products": 0,
            "native_products": len(evidence),
        },
    }
