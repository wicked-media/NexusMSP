"""Evidence-first application inventory and governed action planning.

Nexus Application Manager is deliberately a control plane, not a hidden patch
engine.  It combines endpoint-reported application inventory with separately
reported update evidence, records approval policy, and can retain a scoped
implementation plan.  It never marks software as current, approved, installed
or removed unless an appropriate source has supplied that evidence.

The current application system of record remains the endpoint inventory data:
``device_software`` for Nexus Agent/provider observations and, only as a
clearly-labelled fallback, the historical ``devices.installed_software`` array.
Application Manager policy and action-plan collections contain Nexus planning
metadata only; they are not an execution queue.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from hashlib import sha256
import re
from typing import Any


INVENTORY_FRESH_SECONDS = 24 * 60 * 60
UPDATE_EVIDENCE_FRESH_SECONDS = 48 * 60 * 60
MAX_SOFTWARE_ROWS = 100_000
MAX_ACTION_PLANS = 100
TRUSTED_UPDATE_SOURCES = frozenset({"nexus-agent", "rmm-agent", "provider"})


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_text(value: Any, *, limit: int = 300) -> str:
    if value is None:
        return ""
    return str(value).strip()[:limit]


def application_selector(name: Any, publisher: Any = "") -> str:
    """Normalise an application label for matching, never as a relationship ID."""
    combined = " ".join(part for part in (clean_text(name), clean_text(publisher)) if part)
    return re.sub(r"[^a-z0-9]+", " ", combined.casefold()).strip()


def application_key(name: Any, publisher: Any = "") -> str:
    """Return a deterministic presentation key, not a stored Nexus object ID."""
    selector = application_selector(name, publisher)
    return f"app-{sha256(selector.encode('utf-8')).hexdigest()[:20]}" if selector else "app-unknown"


def parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def evidence_state(value: Any, *, now: datetime, fresh_seconds: int) -> tuple[str, str | None]:
    """Return a bounded evidence state without treating unknown time as current."""
    observed = parse_timestamp(value)
    if observed is None:
        return "unverified", None
    age_seconds = (now - observed).total_seconds()
    if age_seconds < -60:
        return "unverified", None
    if age_seconds <= fresh_seconds:
        return "fresh", observed.isoformat()
    return "stale", observed.isoformat()


def _display_source(value: Any, *, fallback: str) -> str:
    source = clean_text(value, limit=80).lower()
    return source or fallback


def _policy_view(policy: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": clean_text(policy.get("id"), limit=100),
        "application_name": clean_text(policy.get("application_name")) or "Unnamed application",
        "publisher": clean_text(policy.get("publisher")),
        "approval_state": clean_text(policy.get("approval_state"), limit=40) or "review",
        "target_version": clean_text(policy.get("target_version"), limit=120),
        "rollout_ring": clean_text(policy.get("rollout_ring"), limit=120),
        "notes": clean_text(policy.get("notes"), limit=2_000),
        "created_at": policy.get("created_at"),
        "updated_at": policy.get("updated_at") or policy.get("created_at"),
        "enforcement_state": "not_deployed",
        "enforcement_message": (
            "This is an auditable approval and rollout record. Nexus has not dispatched an application change."
        ),
    }


def _policy_match(application: dict[str, Any], policies: list[dict[str, Any]]) -> dict[str, Any]:
    app_name = application_selector(application.get("app_name"))
    app_publisher = application_selector(application.get("publisher"))
    matches = []
    for policy in policies:
        if application_selector(policy.get("application_name")) != app_name:
            continue
        policy_publisher = application_selector(policy.get("publisher"))
        if policy_publisher and policy_publisher != app_publisher:
            continue
        matches.append(policy)

    if not matches:
        return {
            "state": "not_reviewed",
            "record_count": 0,
            "enforcement_state": "not_deployed",
            "message": "No Application Manager approval record matches this application.",
        }

    views = [_policy_view(policy) for policy in matches]
    approval_states = {view["approval_state"] for view in views}
    if len(approval_states) > 1:
        return {
            "state": "conflict",
            "record_count": len(views),
            "enforcement_state": "not_deployed",
            "message": "More than one approval state matches this application. Resolve the policy conflict before staging work.",
            "records": views,
        }

    latest = max(views, key=lambda item: str(item.get("updated_at") or ""))
    return {
        "state": latest["approval_state"],
        "record_count": len(views),
        "enforcement_state": "not_deployed",
        "message": latest["enforcement_message"],
        "record": latest,
    }


def _update_evidence_for_application(
    application: dict[str, Any],
    observations: list[dict[str, Any]],
    *,
    now: datetime,
) -> dict[str, Any]:
    target_selector = application_selector(application.get("app_name"))
    target_devices = set(application.get("device_ids") or [])
    matching: list[dict[str, Any]] = []
    stale_count = 0
    for row in observations:
        if row.get("device_id") not in target_devices:
            continue
        if application_selector(row.get("app_name")) != target_selector:
            continue
        if _display_source(row.get("source"), fallback="unverified") not in TRUSTED_UPDATE_SOURCES:
            continue
        status = clean_text(row.get("status"), limit=40).lower()
        if status not in {"current", "outdated"}:
            continue
        state, observed_at = evidence_state(
            row.get("observed_at") or row.get("last_checked"),
            now=now,
            fresh_seconds=UPDATE_EVIDENCE_FRESH_SECONDS,
        )
        if state == "stale":
            stale_count += 1
            continue
        if state != "fresh":
            continue
        matching.append({
            "device_id": row.get("device_id"),
            "status": status,
            "latest_version": clean_text(row.get("latest_version"), limit=120),
            "installed_version": clean_text(row.get("installed_version"), limit=120),
            "severity": clean_text(row.get("update_severity"), limit=40).lower(),
            "source": _display_source(row.get("source"), fallback="unverified"),
            "observed_at": observed_at,
        })

    observed_devices = {item["device_id"] for item in matching if item.get("device_id")}
    outdated = [item for item in matching if item["status"] == "outdated"]
    highest_severity = next(
        (
            severity
            for severity in ("critical", "high", "medium", "low")
            if any(item["severity"] == severity for item in matching)
        ),
        "",
    )
    if outdated:
        state = "outdated"
        message = "A trusted source reports an available update on one or more observed endpoints."
    elif matching and observed_devices == target_devices:
        state = "current"
        message = "Every installation in this view has fresh trusted update evidence marked current."
    elif matching:
        state = "partially_observed"
        message = "Some installations have fresh trusted update evidence; the rest remain unassessed."
    elif stale_count:
        state = "stale"
        message = "Update evidence exists but is stale, so Nexus will not present this application as current."
    else:
        state = "not_assessed"
        message = "No fresh trusted update evidence is available for this application."

    latest_versions = sorted({item["latest_version"] for item in matching if item["latest_version"]})
    return {
        "state": state,
        "observed_installations": len(observed_devices),
        "total_installations": len(target_devices),
        "outdated_installations": len({item["device_id"] for item in outdated if item.get("device_id")}),
        "stale_observations": stale_count,
        "latest_versions": latest_versions[:20],
        "highest_severity": highest_severity or None,
        "message": message,
    }


def _lifecycle_state(states: list[str]) -> str:
    if not states:
        return "not_collected"
    if all(state == "fresh" for state in states):
        return "fresh"
    if "stale" in states:
        return "stale"
    if "unverified" in states:
        return "unverified"
    return "not_collected"


def _inventory_row(
    *,
    device: dict[str, Any],
    software: dict[str, Any],
    source: str,
    observed_at: Any,
    now: datetime,
) -> dict[str, Any] | None:
    name = clean_text(software.get("name"))
    if not name:
        return None
    lifecycle, timestamp = evidence_state(observed_at, now=now, fresh_seconds=INVENTORY_FRESH_SECONDS)
    return {
        "device_id": clean_text(device.get("id"), limit=120),
        "device_name": clean_text(device.get("name") or device.get("hostname")) or "Managed endpoint",
        "client_id": clean_text(device.get("client_id"), limit=120),
        "client_name": clean_text(device.get("client_name")) or "Scoped client",
        "site_id": clean_text(device.get("site_id"), limit=120),
        "app_name": name,
        "publisher": clean_text(software.get("publisher")),
        "version": clean_text(software.get("version"), limit=120),
        "install_date": clean_text(software.get("install_date"), limit=80),
        "source": source,
        "inventory_state": lifecycle,
        "observed_at": timestamp,
    }


async def build_application_overview(
    database: Any,
    current_user: dict[str, Any],
    *,
    scoped_query: Any,
    tenant_query: Any | None = None,
    client_id: str | None = None,
    device_id: str | None = None,
    include_policies: bool = False,
    tenant_id: str = "nexus-local",
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build one tenant/client-scoped application evidence read model.

    ``scoped_query`` is passed from the router boundary so this service stays
    directly testable while enforcing the existing server-side scope policy.
    """
    now = now or datetime.now(timezone.utc)
    device_query: dict[str, Any] = {"archived": {"$ne": True}}
    if client_id:
        device_query["client_id"] = client_id
    if device_id:
        device_query["id"] = device_id
    devices = await database.devices.find(
        scoped_query(current_user, device_query),
        {"_id": 0},
    ).to_list(5_000)
    device_map = {clean_text(device.get("id"), limit=120): device for device in devices if clean_text(device.get("id"), limit=120)}
    device_ids = list(device_map)

    raw_software = []
    software_truncated = False
    if device_ids:
        software_query: dict[str, Any] = {"device_id": {"$in": device_ids}}
        if tenant_query:
            software_query = tenant_query(current_user, software_query)
        raw_software = await database.device_software.find(
            software_query,
            {"_id": 0},
        ).to_list(MAX_SOFTWARE_ROWS + 1)
        software_truncated = len(raw_software) > MAX_SOFTWARE_ROWS
        raw_software = raw_software[:MAX_SOFTWARE_ROWS]

    software_by_device: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in raw_software:
        device = device_map.get(clean_text(row.get("device_id"), limit=120))
        if not device:
            continue
        inventory = _inventory_row(
            device=device,
            software=row,
            source=_display_source(row.get("source"), fallback="provider"),
            observed_at=row.get("last_inventory_at"),
            now=now,
        )
        if inventory:
            software_by_device[inventory["device_id"]].append(inventory)

    inventory_rows: list[dict[str, Any]] = []
    device_inventory: list[dict[str, Any]] = []
    for current_device_id, device in device_map.items():
        rows = software_by_device.get(current_device_id, [])
        fallback_used = False
        if not rows:
            fallback = device.get("installed_software")
            if isinstance(fallback, list):
                fallback_used = True
                for item in fallback:
                    software = {"name": item} if isinstance(item, str) else item if isinstance(item, dict) else {}
                    inventory = _inventory_row(
                        device=device,
                        software=software,
                        source="legacy-device-record",
                        observed_at=device.get("software_reported_at"),
                        now=now,
                    )
                    if inventory:
                        rows.append(inventory)
        inventory_rows.extend(rows)
        states = [row["inventory_state"] for row in rows]
        device_inventory.append({
            "device_id": current_device_id,
            "device_name": clean_text(device.get("name") or device.get("hostname")) or "Managed endpoint",
            "client_id": clean_text(device.get("client_id"), limit=120),
            "client_name": clean_text(device.get("client_name")) or "Scoped client",
            "site_id": clean_text(device.get("site_id"), limit=120),
            "application_count": len(rows),
            "inventory_state": _lifecycle_state(states),
            "source": "legacy-device-record" if fallback_used else (rows[0]["source"] if rows else "not_collected"),
            "observed_at": max((row["observed_at"] for row in rows if row.get("observed_at")), default=None),
        })

    update_observations: list[dict[str, Any]] = []
    if device_ids:
        provider_query: dict[str, Any] = {"device_id": {"$in": device_ids}}
        if tenant_query:
            provider_query = tenant_query(current_user, provider_query)
        provider_rows = await database.third_party_apps.find(
            provider_query,
            {"_id": 0},
        ).to_list(MAX_SOFTWARE_ROWS + 1)
        for row in provider_rows[:MAX_SOFTWARE_ROWS]:
            observed_device = device_map.get(clean_text(row.get("device_id"), limit=120))
            if not observed_device:
                continue
            # Child telemetry must agree with its authoritative scoped device.
            if clean_text(row.get("client_id"), limit=120) != clean_text(observed_device.get("client_id"), limit=120):
                continue
            update_observations.append(row)

    policies = []
    if include_policies:
        policies = await database.application_manager_policies.find(
            {"tenant_id": tenant_id},
            {"_id": 0},
        ).to_list(1_000)
        policies = [policy for policy in policies if clean_text(policy.get("application_name"))]

    grouped: dict[str, dict[str, Any]] = {}
    for item in inventory_rows:
        key = application_key(item["app_name"], item["publisher"])
        group = grouped.setdefault(key, {
            "id": key,
            "app_name": item["app_name"],
            "publisher": item["publisher"],
            "device_ids": set(),
            "client_ids": set(),
            "clients": {},
            "versions": set(),
            "sources": set(),
            "inventory_states": [],
            "installations": [],
        })
        group["device_ids"].add(item["device_id"])
        group["client_ids"].add(item["client_id"])
        group["clients"][item["client_id"]] = item["client_name"]
        if item["version"]:
            group["versions"].add(item["version"])
        group["sources"].add(item["source"])
        group["inventory_states"].append(item["inventory_state"])
        group["installations"].append(item)

    applications: list[dict[str, Any]] = []
    for group in grouped.values():
        group["device_ids"] = sorted(group["device_ids"])
        lifecycle = _lifecycle_state(group["inventory_states"])
        update = _update_evidence_for_application(group, update_observations, now=now)
        application = {
            "id": group["id"],
            "app_name": group["app_name"],
            "publisher": group["publisher"],
            "device_count": len(group["device_ids"]),
            "client_count": len(group["client_ids"]),
            "clients": [
                {"id": client_key, "name": group["clients"][client_key]}
                for client_key in sorted(group["clients"], key=lambda key: group["clients"][key].casefold())
            ],
            "versions": sorted(group["versions"]),
            "sources": sorted(group["sources"]),
            "inventory": {
                "state": lifecycle,
                "observed_installations": sum(1 for state in group["inventory_states"] if state == "fresh"),
                "total_installations": len(group["installations"]),
                "message": {
                    "fresh": "Every installation in this view has fresh inventory evidence.",
                    "stale": "At least one installation has stale inventory evidence.",
                    "unverified": "Inventory exists without a usable collection timestamp.",
                }.get(lifecycle, "No timestamped application inventory is available."),
            },
            "update": update,
            "policy": _policy_match(group, policies) if include_policies else {
                "state": "not_visible",
                "record_count": 0,
                "enforcement_state": "not_deployed",
                "message": "Application approval records are global configuration and are not visible in this scoped view.",
            },
            "installations": sorted(
                group["installations"],
                key=lambda item: (item["client_name"].casefold(), item["device_name"].casefold()),
            )[:500],
        }
        applications.append(application)

    applications.sort(
        key=lambda item: (
            {"outdated": 0, "stale": 1, "partially_observed": 2, "not_assessed": 3, "current": 4}.get(item["update"]["state"], 5),
            item["app_name"].casefold(),
        )
    )

    fresh_devices = sum(1 for item in device_inventory if item["inventory_state"] == "fresh")
    stale_devices = sum(1 for item in device_inventory if item["inventory_state"] == "stale")
    unverified_devices = sum(1 for item in device_inventory if item["inventory_state"] == "unverified")
    return {
        "summary": {
            "clients": len({item["client_id"] for item in device_inventory if item["client_id"]}),
            "devices": len(device_inventory),
            "fresh_inventory_devices": fresh_devices,
            "stale_inventory_devices": stale_devices,
            "unverified_inventory_devices": unverified_devices,
            "not_collected_devices": sum(1 for item in device_inventory if item["inventory_state"] == "not_collected"),
            "applications": len(applications),
            "installations": len(inventory_rows),
            "outdated_applications": sum(1 for item in applications if item["update"]["state"] == "outdated"),
            "update_evidence_applications": sum(1 for item in applications if item["update"]["state"] in {"current", "outdated", "partially_observed"}),
            "software_rows_truncated": software_truncated,
        },
        "boundary": (
            "Inventory is shown only when it was observed on an authorised endpoint. Update health comes only from a fresh trusted provider or agent observation. "
            "Approval records and action plans do not execute an install, update or uninstall."
        ),
        "capabilities": {
            "inventory": "observed" if inventory_rows else "not_collected",
            "update_health": "observed" if update_observations else "not_configured",
            "approval_policy": "recorded_not_deployed" if include_policies else "restricted",
            "action_planning": "available_not_executing",
            "execution_provider": "not_configured",
        },
        "policy_register_access": include_policies,
        "applications": applications[:2_000],
        "devices": sorted(device_inventory, key=lambda item: (item["client_name"].casefold(), item["device_name"].casefold())),
        "generated_at": now.isoformat(),
    }


def public_action_plan(plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": clean_text(plan.get("id"), limit=120),
        "action_type": clean_text(plan.get("action_type"), limit=40),
        "application_name": clean_text(plan.get("application_name")),
        "publisher": clean_text(plan.get("publisher")),
        "client_id": clean_text(plan.get("client_id"), limit=120),
        "site_id": clean_text(plan.get("site_id"), limit=120),
        "ticket_id": clean_text(plan.get("ticket_id"), limit=120),
        "targets": [
            {"device_id": clean_text(item.get("device_id"), limit=120), "device_name": clean_text(item.get("device_name"))}
            for item in (plan.get("targets") or [])
            if isinstance(item, dict)
        ],
        "reason": clean_text(plan.get("reason"), limit=1_000),
        "approval_state": clean_text(plan.get("approval_state"), limit=40) or "not_requested",
        "approval_required": bool(plan.get("approval_required", True)),
        "execution_state": "not_configured",
        "execution_message": "Nexus retained a governed plan only. No endpoint command or provider deployment was dispatched.",
        "created_at": plan.get("created_at"),
        "created_by": clean_text(plan.get("created_by"), limit=160),
    }
