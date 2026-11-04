"""The "holy shit, that's useful" insight layer.

Everything here is derived from authoritative operational records — devices,
alerts, sessions, backups, tickets, invoices, contracts, activity logs — and is
deliberately honest about evidence: where a real metric history does not exist
yet, baselines say what they are based on (peers, event history) instead of
inventing confidence.  One datum keeps one owner; this module only reads.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _slim(row: dict, keys: tuple[str, ...]) -> dict:
    return {key: row.get(key) for key in keys}


# ============== BEHAVIOUR BASELINE ==============

async def behaviour_baseline(db: Any, user: dict, device_id: str) -> dict:
    """What is normal for *this* device? Peer distribution plus own event history."""
    device = await db.devices.find_one(tenant_scoped_query(user, {"id": device_id}), {"_id": 0})
    if not device:
        return {"found": False}

    peers = await db.devices.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(500).to_list(500)

    def _stat(name: str) -> tuple[float | None, float | None, float | None]:
        try:
            current = float(device.get(name) or 0)
        except (TypeError, ValueError):
            return None, None, None
        values = []
        for peer in peers:
            try:
                values.append(float(peer.get(name) or 0))
            except (TypeError, ValueError):
                continue
        if len(values) < 3:
            return current, None, None
        values.sort()
        median = values[len(values) // 2]
        spread = (values[int(len(values) * 0.9)] - values[int(len(values) * 0.1)]) / 2 or 1.0
        return current, median, spread

    bands = {}
    for name in ("cpu_usage", "memory_usage", "disk_usage"):
        current, median, spread = _stat(name)
        if current is None:
            continue
        if median is None:
            bands[name] = {"current": current, "normal": None, "note": "not enough peers yet"}
            continue
        deviation = round((current - median) / spread, 1)
        bands[name] = {
            "current": current,
            "peer_median": median,
            "normal_band": [max(0.0, round(median - spread)), round(median + spread)],
            "deviation": deviation,
            "unusual": abs(deviation) >= 2,
        }

    alert_history = await db.alerts.count_documents(
        tenant_scoped_query(user, {"device_id": device_id})
    )
    unusual = [name for name, band in bands.items() if band.get("unusual")]
    return {
        "found": True,
        "device_id": device_id,
        "hostname": device.get("hostname") or device.get("name") or device_id,
        "bands": bands,
        "alert_history_count": alert_history,
        "baseline_kind": "peer-distribution",
        "baseline_note": "Built from this device's live stats against its peer group and its own alert history. "
                         "Per-device metric history is not stored yet, so long-term behavioural baselines will "
                         "improve as telemetry accumulates.",
        "verdict": (f"Behaving differently from normal on: {', '.join(unusual)}." if unusual
                    else "Within normal range for this device's peer group."),
    }


# ============== ANOMALY EXPLORER ("show me weird shit") ==============

async def anomaly_scan(db: Any, user: dict, name: str, client_id: str | None = None, hours: int = 48) -> dict:
    """Statistically unusual, not necessarily broken. Event-derived, evidence-first."""
    now = _utcnow()
    since = _iso(now - timedelta(hours=max(1, min(hours, 24 * 30))))
    scope = tenant_scoped_query(user, {"client_id": client_id} if client_id else {})
    findings: list[dict] = []

    # Night-owl activity: logins or sessions between 00:00 and 05:00.
    logs = await db.activity_logs.find(
        tenant_scoped_query(user, {"created_at": {"$gte": since}}), {"_id": 0}
    ).to_list(500)
    for row in logs:
        when = _parse_iso(row.get("created_at"))
        action = str(row.get("action") or "")
        if when and when.hour < 5 and ("login" in action or "session" in action):
            findings.append({
                "kind": "odd_hours",
                "title": f"{row.get('entity_id') or row.get('user_name') or 'Someone'} active at {when.strftime('%H:%M')}",
                "detail": f"Unusual hour for '{action}'. Night-time activity is worth a second look.",
                "first_seen": row.get("created_at"),
                "client_id": client_id,
            })

    # Failed-login bursts.
    failed = [row for row in logs if "login_failed" in str(row.get("action") or "")]
    by_target: dict[str, list] = {}
    for row in failed:
        key = str(row.get("entity_id") or row.get("user_name") or "?")
        by_target.setdefault(key, []).append(row)
    for target, rows in by_target.items():
        if len(rows) >= 3:
            findings.append({
                "kind": "auth_burst",
                "title": f"{len(rows)} failed sign-in attempts for {target}",
                "detail": "Repeated authentication failures — credential stuffing or a locked-out human.",
                "first_seen": rows[0].get("created_at"),
                "client_id": client_id,
            })

    # Backup duration drift: latest run vs its own prior median.
    jobs = await db.backup_jobs.find(tenant_scoped_query(user, {}), {"_id": 0}).to_list(500)
    by_job: dict[str, list] = {}
    for job in jobs:
        key = str(job.get("job_name") or job.get("id") or "?")
        by_job.setdefault(key, []).append(job)
    for job_name, runs in by_job.items():
        durations = []
        for run in runs:
            started = _parse_iso(run.get("started_at"))
            finished = _parse_iso(run.get("completed_at") or run.get("finished_at"))
            if started and finished:
                durations.append(((finished - started).total_seconds(), run))
        if len(durations) >= 3:
            durations.sort(key=lambda item: item[0])
            median = durations[len(durations) // 2][0]
            latest_duration, latest_run = max(durations, key=lambda item: item[1].get("started_at") or "")
            if median > 0 and latest_duration > 2 * median:
                findings.append({
                    "kind": "backup_drift",
                    "title": f"Backup '{job_name}' took {int(latest_duration / 60)}m vs a normal {int(median / 60)}m",
                    "detail": "Backup duration doubled — data growth or a storage problem brewing.",
                    "first_seen": latest_run.get("started_at"),
                    "client_id": latest_run.get("client_id"),
                })

    # Freshly discovered devices on the estate.
    new_devices = await db.devices.find(
        {**scope, "created_at": {"$gte": _iso(now - timedelta(days=7))}}, {"_id": 0}
    ).limit(10).to_list(10)
    for device in new_devices:
        findings.append({
            "kind": "new_device",
            "title": f"New device appeared: {device.get('hostname') or device.get('name') or device.get('id')}",
            "detail": "Discovered in the last 7 days. Confirm it was expected.",
            "first_seen": device.get("created_at"),
            "client_id": device.get("client_id"),
        })

    # Peer-relative stat outliers (the behaviour-baseline signal, tenant-wide).
    devices = await db.devices.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(500).to_list(500)
    for stat in ("cpu_usage", "disk_usage"):
        values = []
        for device in devices:
            try:
                values.append(float(device.get(stat) or 0))
            except (TypeError, ValueError):
                continue
        if len(values) < 5:
            continue
        values.sort()
        median = values[len(values) // 2]
        spread = ((values[int(len(values) * 0.9)] - values[int(len(values) * 0.1)]) / 2) or 1.0
        for device in devices:
            try:
                current = float(device.get(stat) or 0)
            except (TypeError, ValueError):
                continue
            if abs(current - median) / spread >= 2.5:
                findings.append({
                    "kind": "stat_outlier",
                    "title": f"{device.get('hostname') or device.get('id')} {stat.replace('_', ' ')} at {current:g}% — peer median {median:g}%",
                    "detail": "Nothing crossed a static threshold necessarily, but this device is behaving "
                              "differently from its peers.",
                    "first_seen": device.get("last_heartbeat") or device.get("created_at"),
                    "client_id": device.get("client_id"),
                })

    # Onset clustering: findings that began within 10 minutes of each other.
    parsed = [(f, _parse_iso(f.get("first_seen"))) for f in findings]
    clusters = []
    used = set()
    for index, (finding, when) in enumerate(parsed):
        if index in used or when is None:
            continue
        cluster = [finding]
        used.add(index)
        for other_index, (other, other_when) in enumerate(parsed):
            if other_index in used or other_when is None:
                continue
            if abs((other_when - when).total_seconds()) <= 600 and other.get("client_id") == finding.get("client_id"):
                cluster.append(other)
                used.add(other_index)
        if len(cluster) >= 2:
            span = "within minutes of each other"
            clusters.append({
                "began": min(item["first_seen"] for item in cluster if item.get("first_seen")),
                "findings": [item["title"] for item in cluster],
                "probable_common_dependency": f"{finding.get('client_id') or 'shared infrastructure'} — "
                                              f"the {len(cluster)} behaviours began {span}.",
            })

    verdict = (f"{len(findings)} unusual behaviour(s) detected." if findings
               else "Nothing unusual. The estate is boring — which is the goal.")
    return {
        "scanned_hours": hours,
        "client_id": client_id,
        "findings": findings,
        "clusters": clusters,
        "verdict": verdict,
    }


# ============== UNIVERSAL TIMELINE ==============

async def universal_timeline(
    db: Any, user: dict, name: str, *, hours: int = 24,
    user_filter: str = "", device_filter: str = "", client_filter: str = "", limit: int = 100,
) -> dict:
    """One timeline: activity, alerts, tickets, sessions, commands and billing."""
    now = _utcnow()
    since = _iso(now - timedelta(hours=max(1, min(hours, 24 * 30))))
    events: list[dict] = []

    def _add(when: Any, kind: str, title: str, row: dict, actor: str = "") -> None:
        if not when or str(when) < since:
            return
        events.append({
            "time": when,
            "kind": kind,
            "title": title,
            "actor": actor or row.get("user_name") or row.get("assigned_name") or "",
            "device_id": row.get("device_id") or "",
            "device_name": row.get("device_name") or row.get("device_hostname") or "",
            "client_id": row.get("client_id") or "",
            "client_name": row.get("client_name") or "",
            "user_name": row.get("user_name") or row.get("assigned_name") or row.get("entity_name") or "",
        })

    for row in await db.activity_logs.find(
        tenant_scoped_query(user, {"created_at": {"$gte": since}}), {"_id": 0}
    ).limit(300).to_list(300):
        _add(row.get("created_at"), "activity", f"{row.get('action')} — {row.get('entity_name') or row.get('entity_id')}", row)
    for row in await db.alerts.find(tenant_scoped_query(user, {"created_at": {"$gte": since}}), {"_id": 0}).limit(300).to_list(300):
        _add(row.get("created_at"), "alert", f"Alert: {row.get('message') or row.get('alert_type')}", row)
    for row in await db.tickets.find(tenant_scoped_query(user, {"created_at": {"$gte": since}}), {"_id": 0}).limit(300).to_list(300):
        _add(row.get("created_at"), "ticket", f"Ticket {row.get('ticket_number') or row.get('id')} opened: {row.get('title')}", row)
    for row in await db.remote_sessions.find(
        tenant_scoped_query(user, {"started_at": {"$gte": since}}), {"_id": 0}
    ).limit(200).to_list(200):
        _add(row.get("started_at"), "session", "Remote session started", row)
    for row in await db.nexus_agent_commands.find(
        tenant_scoped_query(user, {"created_at": {"$gte": since}}), {"_id": 0}
    ).limit(200).to_list(200):
        _add(row.get("created_at"), "automation", f"Agent ran: {row.get('action') or row.get('command')}", row)
    for row in await db.invoices.find(tenant_scoped_query(user, {"created_at": {"$gte": since}}), {"_id": 0}).limit(200).to_list(200):
        _add(row.get("created_at"), "billing", f"Invoice {row.get('invoice_number')} ({row.get('status')})", row)

    def _matches(event: dict) -> bool:
        if user_filter and user_filter.lower() not in f"{event['actor']} {event['user_name']}".lower():
            return False
        if device_filter and device_filter.lower() not in f"{event['device_id']} {event['device_name']}".lower():
            return False
        if client_filter and client_filter.lower() not in f"{event['client_id']} {event['client_name']}".lower():
            return False
        return True

    filtered = [event for event in events if _matches(event)]
    filtered.sort(key=lambda event: str(event["time"]), reverse=True)
    return {
        "scanned_hours": hours,
        "count": len(filtered),
        "events": filtered[: max(10, min(limit, 500))],
    }


# ============== CROSS-OBJECT SEARCH ==============

def _phoneish(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


async def universal_search(db: Any, user: dict, query: str, limit: int = 8) -> dict:
    """One search box for the entire MSP: any identifier finds every object."""
    needle = (query or "").strip().lower()
    digits = _phoneish(query)
    if not needle:
        return {"query": query, "total": 0, "groups": {}}

    def _hit(row: dict, fields: tuple[str, ...]) -> bool:
        for field in fields:
            value = str(row.get(field) or "").lower()
            if needle and needle in value:
                return True
            if len(digits) >= 4 and digits in _phoneish(row.get(field)):
                return True
        return False

    groups: dict[str, list] = {}
    devices = await db.devices.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(500).to_list(500)
    groups["devices"] = [_slim(row, ("id", "hostname", "name", "client_name", "status"))
                         for row in devices if _hit(row, ("hostname", "name", "serial_number", "ip_address", "local_ip", "mac_address"))][:limit]
    clients = await db.clients.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(500).to_list(500)
    groups["clients"] = [_slim(row, ("id", "name", "phone", "email"))
                         for row in clients if _hit(row, ("name", "phone", "email", "domain"))][:limit]
    users = await db.users.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(500).to_list(500)
    groups["users"] = [_slim(row, ("id", "name", "email", "phone", "role"))
                       for row in users if _hit(row, ("name", "email", "phone"))][:limit]
    tickets = await db.tickets.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(500).to_list(500)
    groups["tickets"] = [_slim(row, ("id", "ticket_number", "title", "client_name", "status"))
                         for row in tickets if _hit(row, ("ticket_number", "title", "description"))][:limit]
    invoices = await db.invoices.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(500).to_list(500)
    groups["invoices"] = [_slim(row, ("id", "invoice_number", "invoice_name", "client_name", "status", "total"))
                          for row in invoices if _hit(row, ("invoice_number", "invoice_name"))][:limit]

    groups = {kind: rows for kind, rows in groups.items() if rows}
    return {"query": query, "total": sum(len(rows) for rows in groups.values()), "groups": groups}


# ============== REMOTE SESSION SIDECAR ==============

async def session_sidecar(db: Any, user: dict, device_id: str) -> dict:
    """Everything a technician needs beside the remote session, in one call."""
    device = await db.devices.find_one(tenant_scoped_query(user, {"id": device_id}), {"_id": 0})
    if not device:
        return {"found": False}
    ref_clause = [{"device_id": device_id}]
    hostname = device.get("hostname") or device.get("name")
    if hostname:
        ref_clause += [{"device_hostname": hostname}, {"device_name": hostname}]

    open_tickets = await db.tickets.find(
        tenant_scoped_query(user, {"$or": ref_clause, "status": {"$nin": ["resolved", "closed"]}}),
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1},
    ).limit(3).to_list(3)
    recent_changes = await db.change_management.count_documents(
        tenant_scoped_query(user, {"device_id": device_id})
    )
    warranty = _parse_iso(device.get("warranty_expiry"))
    warranty_days = (warranty - _utcnow()).days if warranty else None

    health = 100.0
    penalties = []
    for stat, weight in (("disk_usage", 25), ("cpu_usage", 15), ("memory_usage", 15)):
        try:
            value = float(device.get(stat) or 0)
        except (TypeError, ValueError):
            continue
        if value >= 90:
            health -= weight
            penalties.append(f"{stat.replace('_', ' ')} at {value:g}%")
    if str(device.get("status") or "").lower() not in {"online", "healthy", "ok"}:
        health -= 30
        penalties.append("device not reporting")
    if warranty_days is not None and warranty_days < 0:
        health -= 10
        penalties.append("out of warranty")

    return {
        "found": True,
        "device": _slim(device, ("id", "hostname", "name", "status", "os", "os_version", "last_reboot", "uptime_display")),
        "device_health": max(0, round(health)),
        "health_penalties": penalties,
        "open_tickets": open_tickets,
        "recent_changes": recent_changes,
        "warranty_days_remaining": warranty_days,
        "actions": ["Diagnose", "Terminal", "Services", "Processes", "Files", "Registry",
                    "Event Logs", "Network", "M365", "Password Reset"],
    }


# ============== "WHILE YOU'RE THERE" / NEXUS NEARBY ==============

async def while_youre_there(db: Any, user: dict, client_id: str) -> dict:
    """Everything worth physically doing at this customer while a tech is on site."""
    client = await db.clients.find_one(tenant_scoped_query(user, {"$or": [{"id": client_id}, {"name": client_id}]}), {"_id": 0})
    if not client:
        return {"found": False}
    cid = client.get("id")
    now = _utcnow()
    tasks = []
    devices = await db.devices.find(tenant_scoped_query(user, {"client_id": cid}), {"_id": 0}).limit(300).to_list(300)
    for device in devices:
        hostname = device.get("hostname") or device.get("name") or device.get("id")
        if str(device.get("status") or "").lower() in {"offline", "down", "disconnected"}:
            tasks.append({"kind": "offline", "task": f"{hostname} is offline — investigate on site", "device_id": device.get("id")})
        warranty = _parse_iso(device.get("warranty_expiry"))
        if warranty and (warranty - now).days < 60:
            tasks.append({"kind": "warranty", "task": f"{hostname} warranty {'expired' if warranty < now else 'expires soon'} — photograph the serial while you're there", "device_id": device.get("id")})
        try:
            if float(device.get("disk_usage") or 0) >= 90:
                tasks.append({"kind": "disk", "task": f"{hostname} disk above 90% — physical inspection/cleanup candidate", "device_id": device.get("id")})
        except (TypeError, ValueError):
            pass
        last_patch = _parse_iso(device.get("last_patch_date"))
        if last_patch and (now - last_patch) > timedelta(days=60):
            tasks.append({"kind": "patching", "task": f"{hostname} unpatched {(now - last_patch).days} days — schedule or patch now", "device_id": device.get("id")})
    open_tickets = await db.tickets.find(
        tenant_scoped_query(user, {"client_id": cid, "status": {"$nin": ["resolved", "closed"]}}),
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1},
    ).limit(10).to_list(10)
    for ticket in open_tickets:
        tasks.append({"kind": "ticket", "task": f"{ticket.get('ticket_number') or ticket.get('id')}: {ticket.get('title')}", "ticket_id": ticket.get("id")})
    return {
        "found": True,
        "client_id": cid,
        "client_name": client.get("name"),
        "tasks": tasks,
        "verdict": (f"Since you're here… {len(tasks)} thing(s) worth physically doing."
                    if tasks else "Since you're here… nothing outstanding. Enjoy the drive."),
    }


# ============== DEPENDENCY CALENDAR (90-DAY HORIZON) ==============

async def dependency_horizon(db: Any, user: dict, days: int = 90) -> dict:
    """What becomes somebody else's emergency in the next N days if we ignore it?"""
    now = _utcnow()
    horizon = now + timedelta(days=max(7, min(days, 365)))
    items = []

    for device in await db.devices.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(500).to_list(500):
        warranty = _parse_iso(device.get("warranty_expiry"))
        if warranty and now <= warranty <= horizon:
            items.append({"date": warranty.date().isoformat(), "kind": "warranty",
                          "title": f"{device.get('hostname') or device.get('id')} warranty expires",
                          "detail": "Renew, replace, or accept the risk deliberately."})
        last_patch = _parse_iso(device.get("last_patch_date"))
        if last_patch and (now - last_patch) > timedelta(days=60):
            items.append({"date": (last_patch + timedelta(days=90)).date().isoformat(), "kind": "patching",
                          "title": f"{device.get('hostname') or device.get('id')} patching overdue",
                          "detail": f"Last patch {last_patch.date().isoformat()}."})

    for contract in await db.contracts.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(200).to_list(200):
        end_date = _parse_iso(contract.get("end_date"))
        if end_date and now <= end_date <= horizon:
            items.append({"date": end_date.date().isoformat(), "kind": "contract",
                          "title": f"{contract.get('client_name')} — {contract.get('name')} ends",
                          "detail": "Renewal conversation before it becomes a retention problem."})
        elif contract.get("auto_renew") and contract.get("billing_frequency") == "monthly":
            review = now + timedelta(days=30)
            items.append({"date": review.date().isoformat(), "kind": "contract_review",
                          "title": f"{contract.get('client_name')} — {contract.get('name')} auto-renews monthly",
                          "detail": f"Value {contract.get('value')} per month — is delivery still profitable?"})

    items.sort(key=lambda item: item["date"])
    return {
        "horizon_days": days,
        "count": len(items),
        "items": items[:50],
        "verdict": (f"{len(items)} thing(s) will become somebody else's emergency within {days} days if ignored."
                    if items else f"Nothing looming in the next {days} days."),
    }


# ============== AGREEMENT MARGIN ALERT ==============

async def agreement_margin(db: Any, user: dict, client_id: str) -> dict:
    """'You're giving this customer away' — contract value versus delivery cost."""
    client = await db.clients.find_one(tenant_scoped_query(user, {"$or": [{"id": client_id}, {"name": client_id}]}), {"_id": 0})
    if not client:
        return {"found": False}
    cid = client.get("id")
    contracts = await db.contracts.find(tenant_scoped_query(user, {"client_id": cid}), {"_id": 0}).to_list(20)
    if not contracts:
        return {"found": True, "client_id": cid, "client_name": client.get("name"),
                "verdict": "No agreement on file — nothing to compare delivery cost against."}
    contract = contracts[0]
    try:
        monthly_value = float(contract.get("value") or 0)
    except (TypeError, ValueError):
        monthly_value = 0.0
    if contract.get("billing_frequency") == "annual":
        monthly_value /= 12.0

    tickets = await db.tickets.find(tenant_scoped_query(user, {"client_id": cid}), {"_id": 0}).to_list(2000)
    rates = [float(r["hourly_rate"]) for r in await db.users.find(
        tenant_scoped_query(user, {}), {"_id": 0, "hourly_rate": 1}
    ).to_list(200) if r.get("hourly_rate")]
    avg_rate = sum(rates) / len(rates) if rates else 0.0
    hours = 0.0
    for row in tickets:
        try:
            hours += float(row.get("total_time_minutes") or 0) / 60.0
        except (TypeError, ValueError):
            pass
    # Ticket history spans the recorded period; normalise to a 30-day month.
    created_dates = sorted(str(row.get("created_at") or "") for row in tickets if row.get("created_at"))
    span_days = 30.0
    if len(created_dates) >= 2:
        first = _parse_iso(created_dates[0])
        last = _parse_iso(created_dates[-1])
        if first and last:
            span_days = max(7.0, (last - first).days or 1.0)
    monthly_cost = round(hours * avg_rate * 30.0 / span_days)

    if not monthly_value:
        verdict = "Agreement value not recorded — record it to enable margin alerts."
    elif monthly_cost > monthly_value:
        verdict = (f"⚠ Agreement margin alert: {client.get('name')} pays ${monthly_value:,.0f}/month, "
                   f"estimated delivery cost ${monthly_cost:,.0f}/month.")
    else:
        verdict = f"{client.get('name')} is profitable: ${monthly_value:,.0f}/month vs ${monthly_cost:,.0f} estimated delivery."
    # Round to the nearest $50 (avoids banker's-rounding surprises like 1450 -> 1400).
    recommended_low = int(round(monthly_cost * 1.3 / 50.0) * 50)
    recommended_high = max(int(round(monthly_cost * 1.45 / 50.0) * 50), recommended_low + 50)
    return {
        "found": True,
        "client_id": cid,
        "client_name": client.get("name"),
        "contract_name": contract.get("name"),
        "monthly_value": round(monthly_value),
        "estimated_monthly_delivery_cost": monthly_cost,
        "trend_note": "Estimates are derived from recorded ticket time and staff hourly rates.",
        "recommended_monthly_range": [recommended_low, recommended_high] if monthly_cost else None,
        "verdict": verdict,
    }


# ============== TECHNICAL DEBT ("FUTURE ME WILL HATE ME") ==============

async def record_technical_debt(db: Any, user: dict, name: str, payload: dict) -> dict:
    entry = {
        "id": str(uuid.uuid4()),
        "tenant_id": platform_tenant_id(user),
        "client_id": str(payload.get("client_id") or "")[:64],
        "device_id": str(payload.get("device_id") or "")[:64],
        "title": str(payload.get("title") or "").strip()[:200],
        "why": str(payload.get("why") or "").strip()[:1000],
        "proper_fix": str(payload.get("proper_fix") or "").strip()[:1000],
        "review_due": str(payload.get("review_due") or "").strip()[:40],
        "estimated_cost": payload.get("estimated_cost"),
        "status": "open",
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(_utcnow()),
    }
    await db.technical_debt.insert_one(entry)
    entry.pop("_id", None)
    return entry


async def technical_debt_report(db: Any, user: dict, client_id: str | None = None) -> dict:
    """Recorded temporary fixes, due reviews, and estate-level debt indicators."""
    now = _utcnow()
    query: dict = {"tenant_id": platform_tenant_id(user), "status": "open"}
    if client_id:
        query["client_id"] = client_id
    items = await db.technical_debt.find(query, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    overdue = [item for item in items if item.get("review_due") and str(item["review_due"]) <= _iso(now)[:10]]

    estate = await db.devices.find(tenant_scoped_query(user, {"client_id": client_id} if client_id else {}), {"_id": 0}).limit(500).to_list(500)
    legacy_os = 0
    out_of_warranty = 0
    for device in estate:
        os_name = f"{device.get('os') or ''} {device.get('os_version') or ''}".lower()
        if any(vintage in os_name for vintage in ("xp", "vista", "windows 7", "server 2008", "server 2012")):
            legacy_os += 1
        warranty = _parse_iso(device.get("warranty_expiry"))
        if warranty and warranty < now:
            out_of_warranty += 1

    recorded_cost = 0.0
    for item in items:
        try:
            recorded_cost += float(item.get("estimated_cost") or 0)
        except (TypeError, ValueError):
            pass
    return {
        "client_id": client_id,
        "open_items": len(items),
        "overdue_reviews": overdue,
        "estate": {"devices": len(estate), "legacy_os": legacy_os, "out_of_warranty": out_of_warranty},
        "recorded_estimated_remediation_cost": round(recorded_cost),
        "cost_note": "Only technician-recorded estimates are summed — Nexus does not invent remediation costs.",
        "items": items[:20],
    }
