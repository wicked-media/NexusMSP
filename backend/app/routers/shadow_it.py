"""
Shadow IT Detector — rule-based (zero LLM cost).
Compares each client's installed_software against:
  (a) a client-specific approved baseline
  (b) a global curated RISK_DB of known shadow/risky apps
Findings surface per-device, per-client, and aggregated at dashboard level.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional, List
import re
import uuid

from app.database import db
from app.auth import get_current_user

router = APIRouter()


async def _write_audit(current_user: dict, action: str, entity_type: str, entity_id: str, entity_name: str, metadata: dict | None = None):
    """Keep policy decisions and remediation actions visible in the central audit trail."""
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name") or current_user.get("email") or current_user.get("id"),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


# ──────────────────────────────────────────────────────────────────────────────
# CURATED RISK DATABASE
# Categories: file_sharing, remote_access, unapproved_vpn, ai_tool, messaging,
#             personal_cloud, password_manager_personal, crypto_mining,
#             torrent_p2p, unapproved_backup, marketing_tracker, screen_recorder
# Risk levels: low | medium | high | critical
# ──────────────────────────────────────────────────────────────────────────────
RISK_DB = [
    # File sharing / personal cloud  — data-exfil risk
    {"pattern": r"dropbox(?!\s*business)", "name": "Dropbox (personal)",     "category": "file_sharing",    "risk": "high",     "reason": "Personal Dropbox can exfiltrate client data outside approved cloud"},
    {"pattern": r"\bwetransfer\b",         "name": "WeTransfer",              "category": "file_sharing",    "risk": "medium",   "reason": "Uncontrolled file transfers without audit trail"},
    {"pattern": r"mega(?:sync)?\b",        "name": "MEGA",                    "category": "file_sharing",    "risk": "high",     "reason": "Encrypted cloud sync with no enterprise controls"},
    {"pattern": r"google\s*drive(?! for work| for business)", "name": "Google Drive (personal)", "category": "personal_cloud", "risk": "medium", "reason": "Personal Google Drive bypasses data governance"},
    {"pattern": r"icloud\s*drive",         "name": "iCloud Drive (personal)", "category": "personal_cloud",  "risk": "medium",   "reason": "Personal iCloud sync mixes work + personal data"},

    # Remote access — security/compliance risk
    {"pattern": r"\bteamviewer\b(?!\s*corporate)", "name": "TeamViewer (personal)", "category": "remote_access", "risk": "high", "reason": "Unmonitored remote-access tool used for lateral movement"},
    {"pattern": r"\banydesk\b",            "name": "AnyDesk",                 "category": "remote_access",   "risk": "high",     "reason": "Common tool abused in support-scam and RMM compromises"},
    {"pattern": r"\blogmein\b",            "name": "LogMeIn (personal)",      "category": "remote_access",   "risk": "medium",   "reason": "Alternative remote-access not integrated with your RMM"},
    {"pattern": r"\b(chrome|splashtop)\s*remote\s*desktop\b", "name": "Chrome / Splashtop Remote", "category": "remote_access", "risk": "medium", "reason": "Personal remote-desktop app bypassing managed access"},

    # Unapproved VPN / proxy
    {"pattern": r"\bhola\b",               "name": "Hola VPN",                "category": "unapproved_vpn",  "risk": "critical", "reason": "Known data-harvesting P2P VPN"},
    {"pattern": r"\bnordvpn\b",            "name": "NordVPN (personal)",      "category": "unapproved_vpn",  "risk": "medium",   "reason": "Consumer VPN bypasses corporate egress controls"},
    {"pattern": r"\b(expressvpn|surfshark|protonvpn)\b", "name": "Consumer VPN", "category": "unapproved_vpn", "risk": "medium", "reason": "Consumer VPN bypasses corporate egress controls"},
    {"pattern": r"\btor\s*browser\b",      "name": "Tor Browser",             "category": "unapproved_vpn",  "risk": "high",     "reason": "Anonymised traffic — compliance and audit concern"},

    # AI tools (data-leak angle)
    {"pattern": r"\bchatgpt\b(?!\s*enterprise)", "name": "ChatGPT (personal)", "category": "ai_tool",        "risk": "medium",   "reason": "Client data may be pasted into consumer ChatGPT"},
    {"pattern": r"\bclaude\s*desktop\b",   "name": "Claude Desktop (personal)","category": "ai_tool",        "risk": "medium",   "reason": "Consumer AI client without data-processing agreement"},
    {"pattern": r"\bcopilot(?!\s*for)\b",  "name": "Copilot (personal)",      "category": "ai_tool",         "risk": "low",      "reason": "Verify tenant binding vs personal MSA"},

    # Torrent / P2P
    {"pattern": r"\b(utorrent|bittorrent|qbittorrent|transmission)\b", "name": "Torrent client", "category": "torrent_p2p", "risk": "high", "reason": "Legal + malware-vector risk"},

    # Personal password managers
    {"pattern": r"\blastpass\b(?!\s*enterprise| business)", "name": "LastPass (personal)", "category": "password_manager_personal", "risk": "medium", "reason": "Personal vault with client credentials — not auditable"},
    {"pattern": r"\bdashlane\b",           "name": "Dashlane (personal)",     "category": "password_manager_personal", "risk": "medium", "reason": "Personal password vault on corporate endpoint"},

    # Messaging (unapproved)
    {"pattern": r"\b(telegram|signal|whatsapp)\s*(desktop|app)?\b", "name": "Personal messenger", "category": "messaging", "risk": "medium", "reason": "Client communication outside monitored channels"},
    {"pattern": r"\bdiscord\b",            "name": "Discord",                 "category": "messaging",       "risk": "low",      "reason": "Non-business messaging platform; watch for data-sharing"},

    # Crypto mining / wallets
    {"pattern": r"\b(nicehash|xmrig|minergate)\b", "name": "Crypto miner",    "category": "crypto_mining",   "risk": "critical", "reason": "Unauthorised compute use — possible compromise indicator"},
    {"pattern": r"\b(metamask|exodus|electrum)\b", "name": "Crypto wallet",   "category": "crypto_mining",   "risk": "high",     "reason": "Personal crypto wallet on corporate endpoint"},

    # Screen recorders / keyloggers-adjacent
    {"pattern": r"\b(snagit|camtasia|obs\s*studio|loom\b)", "name": "Screen recorder", "category": "screen_recorder", "risk": "low", "reason": "May capture screens showing client data; policy review"},

    # Backup tools outside Acronis
    {"pattern": r"\b(backblaze|carbonite|idrive)\b", "name": "Personal backup", "category": "unapproved_backup", "risk": "medium", "reason": "Alternative backup bypasses managed Acronis policy"},
]


def _classify_app(app_name: str, baseline: set) -> Optional[dict]:
    """Return a finding dict if the app is NOT in baseline and matches risk rules."""
    if not app_name:
        return None
    name = app_name.strip()
    lower = name.lower()
    # Baseline hit → approved, ignore
    for approved in baseline:
        if approved and approved.lower() in lower:
            return None
    # Match against curated DB first (known risky)
    for rule in RISK_DB:
        if re.search(rule["pattern"], lower, flags=re.IGNORECASE):
            return {
                "app": name,
                "match": rule["name"],
                "category": rule["category"],
                "risk": rule["risk"],
                "reason": rule["reason"],
                "classification": "known_risky",
            }
    # Otherwise: unknown app, not in baseline → low-risk "unapproved"
    return {
        "app": name,
        "match": name,
        "category": "unapproved",
        "risk": "low",
        "reason": "Not in approved baseline; review",
        "classification": "unknown",
    }


# ──────────────────────────────────────────────────────────────────────────────
# BASELINE (per-client approved apps)
# ──────────────────────────────────────────────────────────────────────────────

_DEFAULT_BASELINE = [
    "Microsoft Office", "Microsoft 365", "Microsoft Edge", "Microsoft Teams",
    "Google Chrome", "Mozilla Firefox", "Adobe Acrobat", "Adobe Reader",
    "Zoom", "Slack", "1Password", "Bitwarden Business", "Acronis", "Windows Defender",
    "VLC media player", "7-Zip", "Notepad++", "PuTTY",
]


@router.get("/clients/{client_id}/shadow-it/baseline")
async def get_baseline(client_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.shadow_it_baselines.find_one({"client_id": client_id}, {"_id": 0})
    if not doc:
        return {"client_id": client_id, "approved": list(_DEFAULT_BASELINE), "source": "default"}
    return {"client_id": client_id, "approved": doc.get("approved", []), "source": "custom", "updated_at": doc.get("updated_at")}


@router.put("/clients/{client_id}/shadow-it/baseline")
async def update_baseline(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    approved = [a.strip() for a in (data.get("approved") or []) if a and isinstance(a, str)]
    now = datetime.now(timezone.utc).isoformat()
    await db.shadow_it_baselines.update_one(
        {"client_id": client_id},
        {"$set": {"client_id": client_id, "approved": approved, "updated_at": now, "updated_by": current_user.get("name")}},
        upsert=True,
    )
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    await _write_audit(
        current_user,
        "update",
        "shadow_it_baseline",
        client_id,
        (client or {}).get("name") or client_id,
        {"approved_count": len(approved)},
    )
    return {"client_id": client_id, "approved": approved, "updated_at": now}


# ──────────────────────────────────────────────────────────────────────────────
# DEVICE SOFTWARE REPORT  (for the RMM agent to push on the schedule of its choice)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/devices/{device_id}/software-report")
async def push_software_report(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """
    body: { "installed_software": [{"name": "Dropbox", "version": "197.4.5"}, ...] }
    Accepts list of strings or list of objects with name/version/publisher.
    """
    dev = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not dev:
        raise HTTPException(404, "Device not found")

    raw = data.get("installed_software", [])
    normalised: List[dict] = []
    for item in raw:
        if isinstance(item, str):
            normalised.append({"name": item})
        elif isinstance(item, dict) and item.get("name"):
            normalised.append({
                "name": item["name"],
                "version": item.get("version"),
                "publisher": item.get("publisher"),
            })

    now = datetime.now(timezone.utc).isoformat()
    await db.devices.update_one(
        {"id": device_id},
        {"$set": {
            "installed_software": normalised,
            "installed_software_count": len(normalised),
            "software_reported_at": now,
        }},
    )
    return {"device_id": device_id, "count": len(normalised), "reported_at": now}


# ──────────────────────────────────────────────────────────────────────────────
# SCAN — recompute findings across one or all clients
# ──────────────────────────────────────────────────────────────────────────────

async def _scan_client(client_id: str) -> dict:
    client_doc = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client_doc:
        return {"client_id": client_id, "skipped": True, "reason": "client not found"}

    baseline_doc = await db.shadow_it_baselines.find_one({"client_id": client_id}, {"_id": 0})
    baseline = set(baseline_doc.get("approved", [])) if baseline_doc else set(_DEFAULT_BASELINE)

    devices = await db.devices.find(
        {"client_id": client_id},
        {"_id": 0, "id": 1, "name": 1, "installed_software": 1, "os": 1}
    ).to_list(5000)
    device_ids = [device.get("id") for device in devices if device.get("id")]
    agent_rows = await db.device_software.find(
        {"device_id": {"$in": device_ids}, "source": "nexus-agent"},
        {"_id": 0, "device_id": 1, "name": 1, "version": 1, "publisher": 1, "last_inventory_at": 1},
    ).to_list(200000) if device_ids else []
    agent_software: dict[str, list[dict]] = {}
    for row in agent_rows:
        device_id = row.get("device_id")
        if device_id:
            agent_software.setdefault(device_id, []).append(row)

    # Purge old findings for this client first
    await db.shadow_it_findings.delete_many({"client_id": client_id, "status": {"$in": ["open", None]}})

    agg: dict = {}  # key = (app lowercased) → aggregated finding
    devices_with_agent_inventory = 0
    devices_with_legacy_inventory = 0
    for d in devices:
        software = agent_software.get(d.get("id")) or []
        inventory_source = "nexus-agent" if software else "legacy-device-record"
        if software:
            devices_with_agent_inventory += 1
        elif d.get("installed_software"):
            software = d.get("installed_software") or []
            devices_with_legacy_inventory += 1
        else:
            inventory_source = "not-reported"
        for s in software:
            name = s.get("name") if isinstance(s, dict) else (s if isinstance(s, str) else None)
            if not name:
                continue
            finding = _classify_app(name, baseline)
            if not finding:
                continue
            key = finding["app"].lower()
            entry = agg.setdefault(key, {**finding, "devices": [], "device_count": 0, "first_seen_on": d.get("name")})
            entry["devices"].append({"id": d.get("id"), "name": d.get("name"), "os": d.get("os"), "inventory_source": inventory_source})
            entry["device_count"] = len(entry["devices"])

    now = datetime.now(timezone.utc).isoformat()
    findings_docs = []
    for entry in agg.values():
        findings_docs.append({
            "id": f"sif-{uuid.uuid4().hex[:8]}",
            "client_id": client_id,
            "client_name": client_doc.get("name"),
            "app": entry["app"],
            "match_name": entry["match"],
            "category": entry["category"],
            "risk": entry["risk"],
            "reason": entry["reason"],
            "classification": entry["classification"],
            "device_count": entry["device_count"],
            "devices": entry["devices"][:50],
            "inventory_sources": sorted({device.get("inventory_source") for device in entry["devices"] if device.get("inventory_source")}),
            "status": "open",
            "detected_at": now,
        })
    if findings_docs:
        await db.shadow_it_findings.insert_many(findings_docs)

    risk_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in findings_docs:
        risk_counts[f["risk"]] = risk_counts.get(f["risk"], 0) + 1

    return {
        "client_id": client_id,
        "client_name": client_doc.get("name"),
        "devices_scanned": len(devices),
        "devices_with_agent_inventory": devices_with_agent_inventory,
        "devices_with_legacy_inventory": devices_with_legacy_inventory,
        "devices_without_inventory": len(devices) - devices_with_agent_inventory - devices_with_legacy_inventory,
        "findings": len(findings_docs),
        "risk_counts": risk_counts,
        "scanned_at": now,
    }


@router.post("/shadow-it/scan")
async def run_scan(data: dict = None, current_user: dict = Depends(get_current_user)):
    """
    body (optional): { "client_id": "...", "all": true }
    Runs detection on installed_software arrays. Safe to call repeatedly.
    """
    data = data or {}
    if data.get("client_id"):
        result = await _scan_client(data["client_id"])
        await _write_audit(
            current_user,
            "scan",
            "shadow_it_client",
            data["client_id"],
            result.get("client_name") or data["client_id"],
            {"devices_scanned": result.get("devices_scanned", 0), "findings": result.get("findings", 0)},
        )
        return {"results": [result]}

    clients = await db.clients.find({}, {"_id": 0, "id": 1}).to_list(1000)
    results = []
    for c in clients:
        results.append(await _scan_client(c["id"]))

    await db.settings.update_one(
        {"key": "shadow_it_last_scan"},
        {"$set": {"key": "shadow_it_last_scan", "value": {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "client_count": len(clients),
            "by": current_user.get("name"),
            "agent_inventory_devices": sum(result.get("devices_with_agent_inventory", 0) for result in results),
            "legacy_inventory_devices": sum(result.get("devices_with_legacy_inventory", 0) for result in results),
            "devices_without_inventory": sum(result.get("devices_without_inventory", 0) for result in results),
        }}},
        upsert=True,
    )
    await _write_audit(
        current_user,
        "scan",
        "shadow_it_fleet",
        "fleet",
        "Managed endpoint fleet",
        {"clients_scanned": len(clients), "findings": sum(result.get("findings", 0) for result in results)},
    )
    return {
        "results": results,
        "clients_scanned": len(clients),
        "agent_inventory_devices": sum(result.get("devices_with_agent_inventory", 0) for result in results),
        "legacy_inventory_devices": sum(result.get("devices_with_legacy_inventory", 0) for result in results),
        "devices_without_inventory": sum(result.get("devices_without_inventory", 0) for result in results),
    }


# ──────────────────────────────────────────────────────────────────────────────
# FINDINGS / SUMMARY / ACTIONS
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/shadow-it/findings")
async def list_findings(
    client_id: Optional[str] = None,
    risk: Optional[str] = None,
    category: Optional[str] = None,
    status: str = "open",
    limit: int = 500,
    current_user: dict = Depends(get_current_user),
):
    q = {"status": status}
    if client_id:
        q["client_id"] = client_id
    if risk:
        q["risk"] = risk
    if category:
        q["category"] = category
    rows = await db.shadow_it_findings.find(q, {"_id": 0}).sort([("risk", -1), ("device_count", -1)]).to_list(max(1, min(2000, limit)))
    # Sort by custom risk order (critical > high > medium > low)
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    rows.sort(key=lambda f: (order.get(f.get("risk"), 4), -f.get("device_count", 0)))
    return rows


@router.get("/shadow-it/summary")
async def summary(current_user: dict = Depends(get_current_user)):
    """Dashboard roll-up across all clients."""
    pipeline = [
        {"$match": {"status": "open"}},
        {"$group": {"_id": {"client_id": "$client_id", "risk": "$risk"}, "count": {"$sum": 1}, "devices": {"$sum": "$device_count"}, "client_name": {"$first": "$client_name"}}},
    ]
    rows = await db.shadow_it_findings.aggregate(pipeline).to_list(5000)

    per_client: dict = {}
    total_by_risk = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for r in rows:
        cid = r["_id"]["client_id"]
        risk = r["_id"]["risk"]
        c = per_client.setdefault(cid, {"client_id": cid, "client_name": r.get("client_name"), "findings_total": 0, "devices_affected": 0, "by_risk": {"critical": 0, "high": 0, "medium": 0, "low": 0}})
        c["findings_total"] += r["count"]
        c["devices_affected"] += r["devices"]
        c["by_risk"][risk] = r["count"]
        total_by_risk[risk] = total_by_risk.get(risk, 0) + r["count"]

    clients = sorted(per_client.values(), key=lambda x: (-x["by_risk"].get("critical", 0), -x["by_risk"].get("high", 0), -x["findings_total"]))

    # Top apps across fleet
    top_apps_pipe = [
        {"$match": {"status": "open"}},
        {"$group": {"_id": "$match_name", "findings": {"$sum": 1}, "devices": {"$sum": "$device_count"}, "risk": {"$first": "$risk"}, "category": {"$first": "$category"}}},
        {"$sort": {"devices": -1}},
        {"$limit": 10},
    ]
    top_apps_raw = await db.shadow_it_findings.aggregate(top_apps_pipe).to_list(10)
    top_apps = [{"name": r["_id"], "findings": r["findings"], "devices": r["devices"], "risk": r["risk"], "category": r["category"]} for r in top_apps_raw]

    last_scan_doc = await db.settings.find_one({"key": "shadow_it_last_scan"}, {"_id": 0})
    last_scan = (last_scan_doc or {}).get("value") if last_scan_doc else None

    return {
        "total_findings": sum(total_by_risk.values()),
        "by_risk": total_by_risk,
        "clients_with_findings": len(clients),
        "per_client": clients,
        "top_apps": top_apps,
        "last_scan": last_scan,
    }


@router.post("/shadow-it/findings/{finding_id}/{action}")
async def act_on_finding(finding_id: str, action: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """action: approve | ignore | create_ticket"""
    if action not in ("approve", "ignore", "create_ticket"):
        raise HTTPException(400, "action must be approve|ignore|create_ticket")
    doc = await db.shadow_it_findings.find_one({"id": finding_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Finding not found")
    if doc.get("status") not in ("open", None):
        raise HTTPException(409, f"This finding has already been {doc.get('status')}")

    now = datetime.now(timezone.utc).isoformat()

    if action == "approve":
        await db.shadow_it_baselines.update_one(
            {"client_id": doc["client_id"]},
            {"$addToSet": {"approved": doc["app"]}, "$set": {"updated_at": now, "updated_by": current_user.get("name")}},
            upsert=True,
        )
        await db.shadow_it_findings.update_one(
            {"id": finding_id},
            {"$set": {"status": "approved", "actioned_at": now, "actioned_by": current_user.get("name")}},
        )
        await _write_audit(
            current_user,
            "approve",
            "shadow_it_finding",
            finding_id,
            doc.get("app") or finding_id,
            {"client_id": doc.get("client_id"), "client_name": doc.get("client_name"), "risk": doc.get("risk"), "category": doc.get("category")},
        )
        return {"status": "approved", "app_added_to_baseline": doc["app"]}

    if action == "ignore":
        await db.shadow_it_findings.update_one(
            {"id": finding_id},
            {"$set": {"status": "ignored", "actioned_at": now, "actioned_by": current_user.get("name")}},
        )
        await _write_audit(
            current_user,
            "ignore",
            "shadow_it_finding",
            finding_id,
            doc.get("app") or finding_id,
            {"client_id": doc.get("client_id"), "client_name": doc.get("client_name"), "risk": doc.get("risk"), "category": doc.get("category")},
        )
        return {"status": "ignored"}

    # create_ticket
    ticket = {
        "id": f"tik-{uuid.uuid4().hex[:8]}",
        "ticket_number": f"SEC-{datetime.now(timezone.utc).strftime('%y%m%d-%H%M%S')}",
        "title": f"[Shadow IT] Remove {doc['app']} from {doc['client_name']}",
        "description": (
            f"Shadow IT detection:\n"
            f"• App: {doc['app']} (matched rule: {doc['match_name']})\n"
            f"• Risk: {doc['risk'].upper()}  |  Category: {doc['category']}\n"
            f"• Reason: {doc['reason']}\n"
            f"• Devices affected: {doc['device_count']}\n\n"
            f"Recommended action: remove the app, or add it to the client's approved baseline if it's sanctioned."
        ),
        "priority": {"critical": "critical", "high": "high", "medium": "medium", "low": "low"}.get(doc["risk"], "medium"),
        "status": "open",
        "category": "security",
        "source": "shadow_it",
        "client_id": doc["client_id"],
        "client_name": doc["client_name"],
        "assigned_to": None,
        "created_by": current_user.get("id"),
        "created_by_name": current_user.get("name"),
        "created_at": now,
        "updated_at": now,
        "shadow_it_finding_id": finding_id,
    }
    await db.tickets.insert_one(ticket)
    ticket.pop("_id", None)
    await db.shadow_it_findings.update_one(
        {"id": finding_id},
        {"$set": {"status": "ticketed", "ticket_id": ticket["id"], "ticket_number": ticket["ticket_number"], "actioned_at": now, "actioned_by": current_user.get("name")}},
    )
    await _write_audit(
        current_user,
        "create_ticket",
        "shadow_it_finding",
        finding_id,
        doc.get("app") or finding_id,
        {"client_id": doc.get("client_id"), "client_name": doc.get("client_name"), "ticket_id": ticket["id"], "ticket_number": ticket["ticket_number"], "risk": doc.get("risk")},
    )
    return {"status": "ticketed", "ticket": ticket}


# ──────────────────────────────────────────────────────────────────────────────
# DEMO SEED — populates installed_software on existing devices for preview demos.
# Runs only when explicitly invoked; idempotent.
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/shadow-it/seed-demo")
async def seed_demo(current_user: dict = Depends(get_current_user)):
    """Retired compatibility endpoint: never overwrite real agent inventory with samples."""
    raise HTTPException(
        status_code=410,
        detail="Shadow IT demonstration seeding was retired. Run a scan against software inventory reported by the Nexus Agent.",
    )
