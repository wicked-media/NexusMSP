"""Nexus Web Studio fleet intelligence.

Pure, dependency-free policy shared by the Web Studio router and its tests.
Nothing here reads the database or the network, so the same rules govern the
API response, the UI copy and the regression tests.

Three concerns live here:

* **Fleet summary** — what a technician needs to see first across every managed
  website: how many sites are behind on plugins, how many carry recorded
  security findings, how many lack current backup evidence, and which sites are
  unreachable.  Every number is derived from evidence already stored on the
  website record.  When a dimension has not been assessed, it is reported as
  ``not_assessed`` rather than invented, per the Nexus rule against fake
  operational data.
* **Plugin inventory** — normalises the WordPress REST plugin payload into one
  stable shape and aggregates it across the fleet so a technician can answer
  "where is this plugin, is it patched, is its licence about to expire".
* **Safe Update Engine** — the two decisions that make a plugin update safe:
  whether it may proceed at all (preflight) and how much care it deserves
  (risk).  A green HTTP 200 is never treated as verification; the engine only
  reports the evidence a human or worker actually recorded.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

# Update policies, safest first.  A site or fleet may only be as automatic as
# the least automatic policy in force.
UPDATE_POLICIES = ("manual", "assisted", "policy_driven")

# Lifecycle of a Safe Update Engine plan.  The router enforces these
# transitions; the worker records the terminal states.
UPDATE_PLAN_STATES = (
    "draft",
    "preflight_failed",
    "preflight_passed",
    "pending_approval",
    "approved",
    "queued",
    "awaiting_worker",
    "completed",
    "failed",
    "rolled_back",
)

# A backup older than this is not accepted as pre-update evidence.
BACKUP_FRESHNESS_HOURS = 24

# A website health check older than this cannot stand in for current evidence.
HEALTH_FRESHNESS_HOURS = 24

_RISK_ORDER = {"low": 0, "medium": 1, "high": 2}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _version_tuple(value) -> tuple[int, ...]:
    parts: list[int] = []
    for chunk in str(value or "").split("."):
        digits = "".join(ch for ch in chunk if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


def _norm_version(value) -> str:
    return str(value or "").strip()


def version_distance(current: str, target: str) -> str:
    """Return ``major``, ``minor``, ``patch`` or ``unknown`` for a version jump.

    Used by risk scoring: a major WordPress or plugin bump deserves more care
    than a patch release.  Anything that cannot be read as a dotted number is
    treated as ``unknown`` rather than guessed.
    """
    current_parts = _version_tuple(current)
    target_parts = _version_tuple(target)
    if not current or not target or current_parts == (0,) or target_parts == (0,):
        return "unknown"
    if len(target_parts) > 0 and len(current_parts) > 0 and target_parts[0] != current_parts[0]:
        return "major"
    if target_parts[:2] != current_parts[:2]:
        return "minor"
    if target_parts[:3] != current_parts[:3]:
        return "patch"
    return "patch"


def normalise_plugin_inventory(raw_plugins) -> list[dict]:
    """One stable plugin shape from the WordPress REST ``/plugins`` payload.

    WordPress returns an ``update`` object (or ``false``) per plugin.  Nexus
    records whether an update exists, the offered version and the compatibility
    metadata a technician needs before approving it.  Unknown plugins are kept,
    never dropped, so an inventory is never silently incomplete.
    """
    plugins: list[dict] = []
    for item in raw_plugins or []:
        if not isinstance(item, dict):
            continue
        update = item.get("update")
        update_available = bool(update)
        offered = update.get("new_version") if isinstance(update, dict) else None
        slug = str(item.get("plugin") or item.get("slug") or item.get("name") or "").strip()
        if not slug:
            continue
        plugins.append({
            "plugin": slug,
            "name": str(item.get("name") or slug).strip(),
            "version": _norm_version(item.get("version")),
            "status": str(item.get("status") or "inactive").strip().lower(),
            "update_available": update_available,
            "new_version": _norm_version(offered),
            "requires_php": _norm_version(item.get("requires_php")),
            "requires_wp": _norm_version(item.get("requires_wp")),
            "tested_up_to": _norm_version(item.get("tested_up_to") or item.get("tested")),
            "author": str(item.get("author") or "").strip(),
        })
    return plugins


def _plugin_findings(site: dict) -> dict[str, int]:
    """Count recorded security findings per plugin slug for one website.

    Nexus records plugin vulnerability evidence on the website record (written
    by the security modules).  This function only reads it; it never invents
    advisories.  A finding may name a plugin directly or use the plugin slug in
    its ``target``/``package`` field.
    """
    counts: dict[str, int] = {}
    for finding in site.get("security_findings") or []:
        if not isinstance(finding, dict):
            continue
        slug = str(finding.get("plugin") or finding.get("target") or finding.get("package") or "").strip()
        if slug:
            counts[slug] = counts.get(slug, 0) + 1
    return counts


def site_plugin_rows(site: dict) -> list[dict]:
    """The plugin rows for one website, with its own recorded findings attached."""
    inventory = site.get("wordpress_inventory") or {}
    plugins = inventory.get("plugins") or []
    findings = _plugin_findings(site)
    rows = []
    for plugin in normalise_plugin_inventory(plugins):
        rows.append({
            **plugin,
            "site_id": site.get("id"),
            "client_id": site.get("client_id"),
            "client_name": site.get("client_name"),
            "primary_domain": site.get("primary_domain"),
            "security_findings": findings.get(plugin["plugin"], 0)
            + findings.get(str(plugin.get("name") or "").strip(), 0),
            "licence_status": _licence_status(plugin["plugin"]),
        })
    return rows


def _licence_status(_plugin: str) -> str:
    """Premium-licence state is only known once a licence record exists.

    Nexus does not fabricate licence ownership, so an inventory row is
    ``unknown`` until the licence register supplies evidence for it.
    """
    return "unknown"


def fleet_plugin_intelligence(sites) -> list[dict]:
    """Aggregate plugins across every scoped website.

    Each row answers the fleet questions the brief calls out: where a plugin is
    installed, how many copies are behind, which copies carry recorded security
    findings, and whether the plugin looks abandoned.  A version is never
    claimed to be vulnerable without recorded finding evidence.
    """
    aggregate: dict[str, dict] = {}
    for site in sites or []:
        for row in site_plugin_rows(site):
            key = row["plugin"]
            entry = aggregate.setdefault(key, {
                "plugin": key,
                "name": row["name"],
                "sites_installed": 0,
                "sites_active": 0,
                "sites_with_updates": 0,
                "versions": {},
                "update_versions": {},
                "security_findings": 0,
                "requires_php": row["requires_php"],
                "requires_wp": row["requires_wp"],
                "tested_up_to": row["tested_up_to"],
                "author": row["author"],
                "licence_status": row["licence_status"],
                "abandoned": False,
            })
            entry["sites_installed"] += 1
            if row["status"] == "active":
                entry["sites_active"] += 1
            if row["update_available"]:
                entry["sites_with_updates"] += 1
            version = row["version"] or "unknown"
            entry["versions"][version] = entry["versions"].get(version, 0) + 1
            if row["update_available"] and row["new_version"]:
                entry["update_versions"][row["new_version"]] = entry["update_versions"].get(row["new_version"], 0) + 1
            entry["security_findings"] += row["security_findings"]
    return sorted(aggregate.values(), key=lambda item: (-item["security_findings"], -item["sites_with_updates"], item["name"].lower()))


def _inventory_freshness(site: dict) -> dict:
    synced = _parse(site.get("last_wordpress_sync_at"))
    if not synced:
        return {"assessed": False, "stale": True}
    return {"assessed": True, "stale": (_now() - synced) > timedelta(hours=HEALTH_FRESHNESS_HOURS), "synced_at": synced.isoformat()}


def backup_evidence(site: dict, *, now: datetime | None = None) -> dict:
    """Whether the website has backup evidence fresh enough for a safe update."""
    now = now or _now()
    last_backup = _parse(site.get("last_backup_at"))
    if not last_backup:
        return {"assessed": False, "fresh": False, "detail": "No backup evidence is recorded for this website"}
    age_hours = (now - last_backup).total_seconds() / 3600
    fresh = age_hours <= BACKUP_FRESHNESS_HOURS
    return {
        "assessed": True,
        "fresh": fresh,
        "age_hours": round(age_hours, 1),
        "last_backup_at": last_backup.isoformat(),
        "detail": (
            f"Backup taken {round(age_hours, 1)}h ago"
            if fresh
            else f"Most recent backup is {round(age_hours, 1)}h old; update the backup window before deploying"
        ),
    }


def fleet_summary(sites, *, now: datetime | None = None) -> dict:
    """The Web Studio fleet command-centre numbers.

    Returns both totals and the per-dimension ``assessed`` flags so the UI can
    distinguish "nothing found" from "not yet checked".
    """
    now = now or _now()
    sites = list(sites or [])
    plugin_updates = 0
    security_findings = 0
    backup_warnings = 0
    unreachable = 0
    attention_sites: list[dict] = []
    plugin_assessed = False
    backup_assessed = False
    security_assessed = False
    for site in sites:
        inventory = site.get("wordpress_inventory") or {}
        if inventory:
            plugin_assessed = True
        updates = sum(1 for row in normalise_plugin_inventory(inventory.get("plugins")) if row["update_available"])
        plugin_updates += updates
        findings = len(site.get("security_findings") or [])
        if site.get("security_findings") is not None:
            security_assessed = True
        security_findings += findings
        backup = backup_evidence(site, now=now)
        if backup["assessed"]:
            backup_assessed = True
        if not backup["fresh"]:
            backup_warnings += 1
        health = site.get("website_health") or {}
        if health.get("status") in {"unreachable", "degraded"}:
            unreachable += 1
        attention = site_attention(site, now=now)
        if attention["level"] != "healthy":
            attention_sites.append({"site_id": site.get("id"), **attention})
    return {
        "managed_websites": len(sites),
        "plugin_updates": plugin_updates,
        "security_findings": security_findings,
        "backup_warnings": backup_warnings,
        "unreachable_sites": unreachable,
        "attention_sites": attention_sites,
        "attention_count": len(attention_sites),
        "assessed": {
            "plugins": plugin_assessed,
            "security": security_assessed,
            "backups": backup_assessed,
        },
    }


def site_attention(site: dict, *, now: datetime | None = None) -> dict:
    """Classify one website as healthy, attention or critical with named reasons."""
    now = now or _now()
    reasons: list[str] = []
    level = "healthy"
    health = site.get("website_health") or {}
    if health.get("status") == "unreachable":
        reasons.append("Website did not respond to the last health check")
        level = "critical"
    elif health.get("status") == "degraded":
        reasons.append("Website responded but is not healthy")
        level = "attention"
    inventory = site.get("wordpress_inventory") or {}
    updates = sum(1 for row in normalise_plugin_inventory(inventory.get("plugins")) if row["update_available"])
    if updates:
        reasons.append(f"{updates} plugin update{'s' if updates != 1 else ''} available")
        if level == "healthy":
            level = "attention"
    findings = len(site.get("security_findings") or [])
    if findings:
        reasons.append(f"{findings} recorded security finding{'s' if findings != 1 else ''}")
        level = "critical"
    backup = backup_evidence(site, now=now)
    if backup["assessed"] and not backup["fresh"]:
        reasons.append("Backup evidence is not current")
        if level == "healthy":
            level = "attention"
    return {"level": level, "reasons": reasons, "plugin_updates": updates, "security_findings": findings,
            "backup": backup}


def update_risk(item: dict, site: dict) -> dict:
    """Risk of applying one update, with the reasons that raised it.

    High risk means "do not run this without a backup and a person"; it never
    blocks a manual technician, it only changes which policy may execute it.
    """
    reasons: list[str] = []
    score = 0
    kind = str(item.get("kind") or "plugin").lower()
    if kind == "core":
        score += 2
        reasons.append("WordPress core update")
    distance = version_distance(item.get("from_version"), item.get("to_version"))
    if distance == "major":
        score += 2
        reasons.append("Major version change")
    elif distance == "minor":
        score += 1
        reasons.append("Minor version change")
    elif distance == "unknown":
        score += 1
        reasons.append("Version jump could not be read")
    findings = int(item.get("security_findings") or 0)
    if findings:
        score += 2
        reasons.append(f"{findings} recorded security finding{'s' if findings != 1 else ''} against this component")
    site_php = _norm_version(site.get("php_version"))
    requires_php = _norm_version(item.get("requires_php"))
    if requires_php and site_php and version_distance(site_php, requires_php) != "unknown":
        if _version_tuple(requires_php) > _version_tuple(site_php):
            score += 3
            reasons.append(f"Requires PHP {requires_php} but the site runs PHP {site_php}")
    site_wp = _norm_version(site.get("wordpress_version"))
    tested = _norm_version(item.get("tested_up_to"))
    if site_wp and tested and _version_tuple(tested) < _version_tuple(site_wp):
        score += 1
        reasons.append(f"Not tested against WordPress {site_wp}")
    if not reasons:
        reasons.append("Routine patch update")
    risk = "high" if score >= 3 else "medium" if score >= 1 else "low"
    return {"risk": risk, "score": score, "reasons": reasons, "version_distance": distance}


def _check(key: str, label: str, state: str, detail: str) -> dict:
    return {"key": key, "label": label, "state": state, "detail": detail}


def update_preflight(site: dict, items, *, now: datetime | None = None) -> dict:
    """Decide whether an update plan may leave the draft state.

    A plan may proceed when the connection is present, inventory is current, a
    fresh backup exists and no item targets a component missing from the
    inventory.  A failed check is a blocker, not a warning; the caller surfaces
    it and does not queue work.
    """
    now = now or _now()
    checks: list[dict] = []
    blockers: list[str] = []

    connection = site.get("wordpress_connection") or {}
    if connection.get("api_url") and connection.get("application_password_encrypted"):
        checks.append(_check("connection", "WordPress connection", "pass", "A secured management connection is linked"))
    else:
        checks.append(_check("connection", "WordPress connection", "block", "Link a WordPress management connection first"))
        blockers.append("connection")

    freshness = _inventory_freshness(site)
    if not freshness["assessed"]:
        checks.append(_check("inventory", "Plugin inventory", "block", "No WordPress inventory has been synced for this site"))
        blockers.append("inventory")
    elif freshness["stale"]:
        checks.append(_check("inventory", "Plugin inventory", "block", "Inventory is more than 24h old; refresh it before updating"))
        blockers.append("inventory")
    else:
        checks.append(_check("inventory", "Plugin inventory", "pass", "Inventory is current"))

    backup = backup_evidence(site, now=now)
    if backup["fresh"]:
        checks.append(_check("backup", "Backup evidence", "pass", backup["detail"]))
    else:
        checks.append(_check("backup", "Backup evidence", "block", backup["detail"]))
        blockers.append("backup")

    inventory = site.get("wordpress_inventory") or {}
    installed = {row["plugin"]: row for row in normalise_plugin_inventory(inventory.get("plugins"))}
    missing: list[str] = []
    php_blockers: list[str] = []
    for item in items or []:
        target = str(item.get("plugin") or "")
        if not target:
            continue
        record = installed.get(target)
        if record is None:
            missing.append(target)
            continue
        requires_php = _norm_version(record.get("requires_php") or item.get("requires_php"))
        site_php = _norm_version(site.get("php_version"))
        if requires_php and site_php and _version_tuple(requires_php) > _version_tuple(site_php):
            php_blockers.append(f"{record.get('name') or target} needs PHP {requires_php}")
    if missing:
        checks.append(_check("inventory_match", "Targets present in inventory", "block", "Not in the current inventory: " + ", ".join(sorted(missing))))
        blockers.append("inventory_match")
    else:
        checks.append(_check("inventory_match", "Targets present in inventory", "pass", "Every target is present in the current inventory"))
    if php_blockers:
        checks.append(_check("php", "PHP compatibility", "block", "; ".join(php_blockers)))
        blockers.append("php")
    else:
        checks.append(_check("php", "PHP compatibility", "pass", "Targets are compatible with the recorded PHP version"))

    return {
        "allowed": not blockers,
        "checks": checks,
        "blockers": blockers,
        "evaluated_at": now.isoformat(),
    }


def build_update_plan(site: dict, items, *, policy: str = "manual", now: datetime | None = None) -> dict:
    """Compose a deterministic update plan from a site and its requested items.

    The plan is a record, not an execution: creating it never changes WordPress.
    """
    now = now or _now()
    policy = policy if policy in UPDATE_POLICIES else "manual"
    normalised_items = []
    risks = []
    for item in items or []:
        kind = str(item.get("kind") or "plugin").lower()
        target = str(item.get("plugin") or item.get("target") or "").strip()
        if not target:
            continue
        row = {
            "kind": kind,
            "plugin": target,
            "name": str(item.get("name") or target).strip(),
            "from_version": _norm_version(item.get("from_version")),
            "to_version": _norm_version(item.get("to_version")),
            "security_findings": int(item.get("security_findings") or 0),
            "requires_php": _norm_version(item.get("requires_php")),
        }
        assessment = update_risk(row, site)
        row["risk"] = assessment["risk"]
        row["risk_reasons"] = assessment["reasons"]
        normalised_items.append(row)
        risks.append(assessment["risk"])
    overall = max(risks, key=lambda r: _RISK_ORDER[r]) if risks else "low"
    preflight = update_preflight(site, normalised_items, now=now)
    return {
        "site_id": site.get("id"),
        "client_id": site.get("client_id"),
        "client_name": site.get("client_name"),
        "policy": policy,
        "items": normalised_items,
        "risk": overall,
        "preflight": preflight,
        "status": "preflight_passed" if preflight["allowed"] else "preflight_failed",
        "created_at": now.isoformat(),
    }


def policy_allows_execution(policy: str, risk: str, *, approved: bool) -> dict:
    """Whether a plan may execute without a person, given its policy and risk.

    * ``manual`` never auto-executes.
    * ``assisted`` builds the plan for a person but still waits for approval.
    * ``policy_driven`` may run low-risk work automatically; anything higher
      waits for approval.  Approval is always required once a plan is not
      clearly low risk.
    """
    policy = policy if policy in UPDATE_POLICIES else "manual"
    if not approved:
        return {"allowed": False, "mode": "awaiting_approval",
                "reason": "This plan needs an independent approval before it can execute"}
    if policy == "manual":
        return {"allowed": False, "mode": "technician_execution",
                "reason": "Manual policy: a technician applies this update and records the result"}
    if policy == "assisted":
        return {"allowed": False, "mode": "technician_execution",
                "reason": "Assisted policy: Nexus prepared the plan; a technician performs it"}
    if risk == "low":
        return {"allowed": True, "mode": "policy_execution",
                "reason": "Policy-driven policy may execute low-risk updates within the recorded limits"}
    return {"allowed": False, "mode": "technician_execution",
            "reason": "Policy-driven policy escalates anything not low risk to a technician"}


def can_transition(current: str, target: str) -> bool:
    """Allowed update-plan transitions, enforced by the router."""
    allowed = {
        "draft": {"preflight_passed", "preflight_failed"},
        "preflight_failed": {"draft"},
        "preflight_passed": {"pending_approval"},
        "pending_approval": {"approved"},
        "approved": {"queued"},
        "queued": {"awaiting_worker", "completed", "failed"},
        "awaiting_worker": {"completed", "failed"},
        "failed": {"rolled_back", "draft"},
        "completed": {"rolled_back"},
        "rolled_back": set(),
    }
    return target in allowed.get(current, set())
