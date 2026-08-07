"""Durable endpoint state history for Nexus Time Machine.

The agent heartbeat remains the source of truth.  This service turns its
inventory into stable, deduplicated snapshots and produces category-aware
comparisons without presenting data the agent did not collect.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any


SNAPSHOT_SCHEMA_VERSION = 1
MAX_SOFTWARE_ITEMS = 5_000
MAX_CATEGORY_ITEMS = 2_000


def _text(value: Any, limit: int = 2_000) -> str:
    return str(value or "")[:limit]


def _number(value: Any) -> int | float:
    try:
        parsed = float(value or 0)
        return int(parsed) if parsed.is_integer() else round(parsed, 3)
    except (TypeError, ValueError):
        return 0


def _simple(value: Any, depth: int = 0) -> Any:
    """Return a bounded JSON-safe representation of optional agent evidence."""
    if depth > 5:
        return _text(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:2_000]
    if isinstance(value, dict):
        return {
            _text(key, 160): _simple(item, depth + 1)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (list, tuple, set)):
        return [_simple(item, depth + 1) for item in list(value)[:MAX_CATEGORY_ITEMS]]
    return _text(value)


def _normalise_named_items(items: Any, fields: tuple[str, ...], limit: int) -> list[dict]:
    records = []
    for item in list(items or [])[:limit]:
        if isinstance(item, dict):
            record = {field: _simple(item.get(field)) for field in fields if field in item}
            # Keep forward-compatible evidence from the agent, while still
            # bounding values and sorting keys for stable hashes.
            for key, value in item.items():
                if key not in record and len(record) < 40:
                    record[_text(key, 160)] = _simple(value)
            records.append(record)
        else:
            records.append({"value": _simple(item)})
    return sorted(records, key=lambda row: json.dumps(row, sort_keys=True, default=str))


def normalise_endpoint_state(
    snapshot: dict | None,
    *,
    capabilities: list[str] | None = None,
    agent_version: str = "",
) -> dict:
    """Build the canonical state captured by a Nexus Agent heartbeat."""
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    security = snapshot.get("security") if isinstance(snapshot.get("security"), dict) else {}
    hardware = snapshot.get("hardware") if isinstance(snapshot.get("hardware"), dict) else {}

    state: dict[str, Any] = {
        "agent": {
            "version": _text(agent_version),
            "capabilities": sorted({
                _text(item, 120) for item in (capabilities or []) if isinstance(item, str)
            }),
        },
    }
    coverage = {"agent"}
    system_keys = {
        "hostname", "os", "os_platform", "os_version", "os_build", "arch",
        "cpu_model", "cpu_count", "mem_total_mb",
    }
    if any(key in snapshot for key in system_keys):
        state["system"] = {
            "hostname": _text(snapshot.get("hostname")),
            "os": _text(snapshot.get("os")),
            "os_platform": _text(snapshot.get("os_platform")),
            "os_version": _text(snapshot.get("os_version")),
            "os_build": _text(snapshot.get("os_build")),
            "architecture": _text(snapshot.get("arch")),
            "cpu_model": _text(snapshot.get("cpu_model")),
            "cpu_count": _number(snapshot.get("cpu_count")),
            "memory_total_mb": _number(snapshot.get("mem_total_mb")),
        }
        coverage.add("system")

    if "hardware" in snapshot:
        state["hardware"] = {
            key: _simple(hardware.get(key))
            for key in (
                "manufacturer", "model", "serial_number", "bios_version",
                "domain", "chassis_type", "tpm_version",
            )
            if key in hardware
        }
        coverage.add("hardware")

    if "security" in snapshot:
        state["security"] = {
            key: _simple(security.get(key))
            for key in (
                "defender_installed", "defender_enabled",
                "defender_realtime_enabled", "defender_signature_age_days",
                "firewall_enabled", "encryption_status", "bitlocker_status",
                "secure_boot_enabled", "tpm_ready",
            )
            if key in security
        }
        coverage.add("security")

    if "nics" in snapshot:
        state["network"] = _normalise_named_items(
            snapshot.get("nics"),
            ("name", "mac", "type", "status", "ipv4", "ipv6", "gateway", "dns", "speed_mbps"),
            128,
        )
        coverage.add("network")

    if "disks" in snapshot:
        state["storage"] = _normalise_named_items(
            snapshot.get("disks"),
            ("device", "mount", "fs_type", "total_gb", "used_gb", "percent", "model", "serial", "smart_status"),
            128,
        )
        coverage.add("storage")

    if "software" in snapshot:
        state["software"] = _normalise_named_items(
            snapshot.get("software"),
            ("name", "version", "publisher", "install_date", "size_mb"),
            MAX_SOFTWARE_ITEMS,
        )
        coverage.add("software")

    if "pending_updates" in security or "pending_update_count" in security:
        state["updates"] = {
            "pending_count": _number(security.get("pending_update_count")),
            "items": _normalise_named_items(
                security.get("pending_updates"),
                ("title", "kb", "reboot_required", "severity"),
                MAX_CATEGORY_ITEMS,
            ),
        }
        coverage.add("updates")

    optional_categories = {
        "registry": ("registry", "registry_evidence"),
        "drivers": ("drivers",),
        "services": ("services",),
        "scheduled_tasks": ("scheduled_tasks", "tasks"),
        "users": ("users", "local_users"),
        "group_policy": ("group_policy", "gpo"),
        "certificates": ("certificates",),
        "firewall_rules": ("firewall_rules",),
        "shares": ("shares", "network_shares"),
    }
    for category, aliases in optional_categories.items():
        source_key = next((key for key in aliases if key in snapshot), None)
        if source_key:
            state[category] = _simple(snapshot.get(source_key))
            coverage.add(category)

    return {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "coverage": sorted(coverage),
        "categories": state,
    }


def state_hash(state: dict) -> str:
    payload = json.dumps(state, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _flatten(value: Any, prefix: str = "") -> dict[str, Any]:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            result.update(_flatten(item, path))
        return result
    return {prefix or "value": value}


def _item_key(item: Any) -> str:
    if not isinstance(item, dict):
        return json.dumps(item, sort_keys=True, default=str)
    for fields in (
        ("name", "publisher"),
        ("mac",),
        ("device", "mount"),
        ("title", "kb"),
        ("path", "name"),
        ("id",),
    ):
        values = [_text(item.get(field), 300).strip().lower() for field in fields]
        if any(values):
            return "|".join(values)
    return hashlib.sha256(
        json.dumps(item, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def _label(item: Any, fallback: str) -> str:
    if isinstance(item, dict):
        for key in ("name", "title", "device", "mount", "path", "id", "value"):
            if item.get(key):
                return _text(item[key], 300)
    return fallback


def _compare_category(before: Any, after: Any) -> dict:
    if isinstance(before, list) or isinstance(after, list):
        before_map = {_item_key(item): item for item in (before if isinstance(before, list) else [])}
        after_map = {_item_key(item): item for item in (after if isinstance(after, list) else [])}
        added = [
            {"key": key, "label": _label(after_map[key], key), "after": after_map[key]}
            for key in sorted(after_map.keys() - before_map.keys())
        ]
        removed = [
            {"key": key, "label": _label(before_map[key], key), "before": before_map[key]}
            for key in sorted(before_map.keys() - after_map.keys())
        ]
        changed = [
            {
                "key": key,
                "label": _label(after_map[key], key),
                "before": before_map[key],
                "after": after_map[key],
            }
            for key in sorted(before_map.keys() & after_map.keys())
            if before_map[key] != after_map[key]
        ]
        return {"added": added, "removed": removed, "changed": changed}

    before_flat = _flatten(before if isinstance(before, dict) else {"value": before})
    after_flat = _flatten(after if isinstance(after, dict) else {"value": after})
    added = [
        {"key": key, "label": key, "after": after_flat[key]}
        for key in sorted(after_flat.keys() - before_flat.keys())
    ]
    removed = [
        {"key": key, "label": key, "before": before_flat[key]}
        for key in sorted(before_flat.keys() - after_flat.keys())
    ]
    changed = [
        {
            "key": key,
            "label": key,
            "before": before_flat[key],
            "after": after_flat[key],
        }
        for key in sorted(before_flat.keys() & after_flat.keys())
        if before_flat[key] != after_flat[key]
    ]
    return {"added": added, "removed": removed, "changed": changed}


def compare_endpoint_states(before: dict | None, after: dict | None) -> dict:
    before_categories = (before or {}).get("categories") or {}
    after_categories = (after or {}).get("categories") or {}
    categories = {}
    total = 0
    for category in sorted(set(before_categories) | set(after_categories)):
        detail = _compare_category(before_categories.get(category), after_categories.get(category))
        count = sum(len(detail[key]) for key in ("added", "removed", "changed"))
        if count:
            categories[category] = {**detail, "count": count}
            total += count
    return {
        "total_changes": total,
        "changed_categories": list(categories),
        "categories": categories,
        "coverage_before": list((before or {}).get("coverage") or []),
        "coverage_after": list((after or {}).get("coverage") or []),
    }


async def record_endpoint_state_snapshot(
    database,
    *,
    device_id: str,
    client_id: str | None,
    agent_id: str,
    snapshot: dict,
    capabilities: list[str] | None,
    agent_version: str,
    captured_at: str,
) -> dict:
    state = normalise_endpoint_state(
        snapshot,
        capabilities=capabilities,
        agent_version=agent_version,
    )
    digest = state_hash(state)
    previous_rows = await database.device_state_snapshots.find(
        {"device_id": device_id},
        {"_id": 0},
    ).sort("captured_at", -1).to_list(1)
    previous = previous_rows[0] if previous_rows else None

    if previous and previous.get("state_hash") == digest:
        await database.device_state_snapshots.update_one(
            {"id": previous["id"]},
            {
                "$set": {"last_observed_at": captured_at},
                "$inc": {"observation_count": 1},
            },
        )
        return {"id": previous["id"], "created": False, "state_hash": digest}

    comparison = (
        compare_endpoint_states(previous.get("state"), state)
        if previous
        else {
            "total_changes": 0,
            "changed_categories": [],
            "categories": {},
        }
    )
    record = {
        "id": str(uuid.uuid4()),
        "device_id": device_id,
        "client_id": client_id or None,
        "agent_id": agent_id,
        "captured_at": captured_at,
        "last_observed_at": captured_at,
        "observation_count": 1,
        "source": "nexus-agent",
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "state_hash": digest,
        "coverage": state["coverage"],
        "change_count": comparison["total_changes"],
        "changed_categories": comparison["changed_categories"],
        "previous_snapshot_id": previous.get("id") if previous else None,
        "state": state,
    }
    await database.device_state_snapshots.insert_one(record)
    return {"id": record["id"], "created": True, "state_hash": digest}


async def ensure_time_machine_indexes(database) -> None:
    await database.device_state_snapshots.create_index(
        [("device_id", 1), ("captured_at", -1)],
        name="device_time_machine_history",
    )
    await database.device_state_snapshots.create_index(
        [("device_id", 1), ("state_hash", 1)],
        name="device_time_machine_dedup",
    )
