"""Nexus Fleet Shell: ask the fleet a question, get an actionable object set.

Not terminal access. A question such as *"which endpoints have not rebooted in
30 days?"* returns a set of devices, and that set is itself an actionable object
you can refine (*"exclude servers and devices with an active user"*), save, and
plan an action against. The search result becomes the object set instead of a
CSV that somebody has to turn into a group and a script.

The one rule that makes this honest:

    A filter that needs evidence the fleet does **not** have never silently
    includes or excludes a device.

Devices whose record lacks the field a filter needs land in an explicit
``unavailable`` bucket with the reason. They are not quietly matched (which
would overstate reach) and not quietly dropped (which would understate it).
Nexus cannot see whether an endpoint has an active user if nothing recorded a
session, and this module says so rather than guessing.

This module only reads and plans. :func:`plan_set_action` releases nothing: it
builds a blast-radius ladder and consults the platform operational mode, and it
never executes an action.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.services import nexus_operational_mode
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

#: Hard ceiling on devices read for one query, so one question cannot walk an
#: unbounded estate synchronously.
MAX_DEVICES = 5000

#: How many device rows a single response may list.
MAX_LISTED = 200

#: How many members of each ring are shown in a plan.
DISPLAY_MEMBERS = 5

#: The blast-radius ladder. No action touching a fleet reaches every device in
#: one step, and no ring is released before the previous ring was verified.
BLAST_RADIUS_RINGS: tuple[Any, ...] = (1, 5, 25, "remainder")

#: The capabilities a fleet action can be gated by, mirroring the platform
#: operational mode contract.
KNOWN_CAPABILITIES = (
    "patching",
    "software_deployment",
    "ai_remediation",
    "customer_communications",
    "billing_sync",
    "device_remediation",
)

MATCH = "match"
NO_MATCH = "no_match"
UNKNOWN = "unavailable"

#: Recorded markers that mean "this device is server-class". Only the recorded
#: `os`, `device_type` and `role` fields are consulted; a hostname is never
#: treated as proof, because SERVER03 is not evidence of anything.
SERVER_OS_TOKENS = ("server", "hyper-v", "hyperv", "esxi", "vmware", "xenserver", "proxmox")
SERVER_TYPE_TOKENS = ("server", "hypervisor", "virtual_host")
SERVER_ROLE_TOKENS = ("server", "domain_controller", "domain-controller", "hypervisor", "virtual-host")

#: Recorded session states that mean a human is using the device right now.
ACTIVE_SESSION_STATES = ("active", "connected", "logged_in", "loggedin", "interactive", "in_use")

#: Boot-time fields, in the order they are trusted.
BOOT_FIELDS = ("last_boot", "boot_time", "last_reboot", "uptime_since", "booted_at")

#: Free-space fields (a scalar, or a `disks` list that is reduced to its worst).
FREE_SPACE_FIELDS = ("disk_free_percent", "free_disk_percent", "min_free_disk_percent")

FILTERS: tuple[dict[str, Any], ...] = (
    {"filter": "client_id", "label": "Customer", "op": "equals", "needs_value": True,
     "needs": "devices.client_id", "bucket": "filtered_out",
     "meaning": "Only devices belonging to this stable Nexus client ID."},
    {"filter": "status", "label": "Agent status", "op": "equals", "needs_value": True,
     "needs": "devices.status", "bucket": "filtered_out",
     "meaning": "Match the recorded agent status, e.g. online or offline."},
    {"filter": "os", "label": "Operating system", "op": "contains", "needs_value": True,
     "needs": "devices.os", "bucket": "filtered_out",
     "meaning": "Case-insensitive match inside the recorded operating system."},
    {"filter": "hostname_contains", "label": "Hostname contains", "op": "contains", "needs_value": True,
     "needs": "devices.hostname", "bucket": "filtered_out",
     "meaning": "Case-insensitive match inside the recorded hostname."},
    {"filter": "days_since_boot_gte", "label": "Not rebooted for at least", "op": "gte", "needs_value": True,
     "needs": "devices.last_boot", "bucket": "filtered_out",
     "meaning": "Devices whose recorded boot time is at least N whole days ago."},
    {"filter": "exclude_servers", "label": "Exclude servers", "op": "exclude_if", "needs_value": False,
     "needs": "devices.os / device_type / role", "bucket": "servers",
     "meaning": "Drop devices recorded as server-class or hypervisor-class."},
    {"filter": "exclude_active_user", "label": "Exclude devices in use", "op": "exclude_if", "needs_value": False,
     "needs": "devices.active_user / logged_in_user / session_state", "bucket": "active_user",
     "meaning": "Drop devices with a recorded active user session."},
    {"filter": "min_free_disk_percent_below", "label": "Lowest free space below", "op": "below",
     "needs_value": True, "needs": "devices.disk_free_percent / disks[].free_percent",
     "bucket": "filtered_out",
     "meaning": "Devices whose worst recorded free-space percentage is below N."},
    {"filter": "pending_patches_gte", "label": "Pending updates at least", "op": "gte", "needs_value": True,
     "needs": "devices.pending_patches", "bucket": "filtered_out",
     "meaning": "Devices with at least N recorded pending updates."},
)

FILTERS_BY_KEY: dict[str, dict] = {entry["filter"]: entry for entry in FILTERS}

GRAMMAR_NOTE = (
    "Filters read only recorded device evidence. A device whose record lacks the field a filter needs is "
    "reported in the unavailable bucket with the reason, never silently matched or dropped — Nexus will not "
    "guess that an endpoint has no active user just because no session was recorded."
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _parse_dt(value: Any) -> datetime | None:
    """Parse a recorded timestamp defensively. Unparseable evidence is no
    evidence, and is reported as unavailable rather than assumed."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def shell_grammar() -> dict:
    """Publish exactly which filters this shell supports, and what each needs."""
    return {
        "filters": [
            {"filter": entry["filter"], "label": entry["label"], "op": entry["op"],
             "needs": entry["needs"], "meaning": entry["meaning"]}
            for entry in FILTERS
        ],
        "blast_radius_rings": [str(ring) for ring in BLAST_RADIUS_RINGS],
        "capabilities": list(KNOWN_CAPABILITIES),
        "note": GRAMMAR_NOTE,
    }


def _boot_timestamp(device: dict) -> datetime | None:
    for field in BOOT_FIELDS:
        parsed = _parse_dt(device.get(field))
        if parsed:
            return parsed
    return None


def _free_disk_percent(device: dict) -> float | None:
    values: list[float] = []
    for field in FREE_SPACE_FIELDS:
        raw = device.get(field)
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            values.append(float(raw))
    disks = device.get("disks")
    if isinstance(disks, (list, tuple)):
        for disk in disks:
            if isinstance(disk, dict):
                raw = disk.get("free_percent", disk.get("free_space_percent"))
                if isinstance(raw, (int, float)) and not isinstance(raw, bool):
                    values.append(float(raw))
    return min(values) if values else None


def _is_server(device: dict) -> bool:
    haystacks = [
        _text(device.get("os")).lower(),
        _text(device.get("device_type")).lower(),
        _text(device.get("role")).lower(),
    ]
    if any(token in haystacks[0] for token in SERVER_OS_TOKENS):
        return True
    if any(token in haystacks[1] for token in SERVER_TYPE_TOKENS):
        return True
    if any(token in haystacks[2] for token in SERVER_ROLE_TOKENS):
        return True
    return False


def _active_user_state(device: dict) -> bool | None:
    """True / False / None, where None means *no evidence either way*."""
    if "session_state" in device:
        state = _text(device.get("session_state")).lower()
        if state:
            return state in ACTIVE_SESSION_STATES
    for field in ("active_user", "logged_in_user", "current_user"):
        if field in device:
            return bool(_text(device.get(field)))
    return None


def _evaluate_filter(device: dict, name: str, value: Any, today: datetime) -> tuple[str, str, str]:
    """Return (outcome, reason, exclusion bucket) for one device and one filter."""
    if name == "client_id":
        recorded = _text(device.get("client_id"))
        if not recorded:
            return UNKNOWN, "no client_id is recorded for this device", ""
        if recorded == _text(value):
            return MATCH, f"client_id {recorded}", ""
        return NO_MATCH, f"client_id is {recorded}", "filtered_out"

    if name == "status":
        recorded = _text(device.get("status")).lower()
        if not recorded:
            return UNKNOWN, "no agent status is recorded for this device", ""
        if recorded == _text(value).lower():
            return MATCH, f"status {recorded}", ""
        return NO_MATCH, f"status is {recorded}", "filtered_out"

    if name == "os":
        recorded = _text(device.get("os"))
        if not recorded:
            return UNKNOWN, "no operating system is recorded for this device", ""
        if _text(value).lower() in recorded.lower():
            return MATCH, f"os {recorded}", ""
        return NO_MATCH, f"os is {recorded}", "filtered_out"

    if name == "hostname_contains":
        recorded = _text(device.get("hostname")) or _text(device.get("name"))
        if not recorded:
            return UNKNOWN, "no hostname is recorded for this device", ""
        if _text(value).lower() in recorded.lower():
            return MATCH, f"hostname {recorded}", ""
        return NO_MATCH, f"hostname is {recorded}", "filtered_out"

    if name == "days_since_boot_gte":
        booted = _boot_timestamp(device)
        if booted is None:
            return UNKNOWN, "no boot time is recorded for this device", ""
        days = (today - booted).days
        if days >= int(value):
            return MATCH, f"last boot {days} day(s) ago", ""
        return NO_MATCH, f"last boot {days} day(s) ago", "filtered_out"

    if name == "exclude_servers":
        recorded = [_text(device.get(field)) for field in ("os", "device_type", "role")]
        if not any(recorded):
            return UNKNOWN, "no os, device_type or role is recorded, so a server cannot be ruled out", ""
        if _is_server(device):
            return NO_MATCH, "recorded as a server-class device", "servers"
        return MATCH, "not recorded as server-class", ""

    if name == "exclude_active_user":
        state = _active_user_state(device)
        if state is None:
            return UNKNOWN, "no active-user session evidence is recorded for this device", ""
        if state:
            return NO_MATCH, "an active user session is recorded", "active_user"
        return MATCH, "no active user session is recorded", ""

    if name == "min_free_disk_percent_below":
        free = _free_disk_percent(device)
        if free is None:
            return UNKNOWN, "no free disk percentage is recorded for this device", ""
        if free < float(value):
            return MATCH, f"lowest recorded free space {free}%", ""
        return NO_MATCH, f"lowest recorded free space is {free}%", "filtered_out"

    if name == "pending_patches_gte":
        raw = device.get("pending_patches")
        if raw is None:
            return UNKNOWN, "no pending update count is recorded for this device", ""
        try:
            count = int(raw)
        except (TypeError, ValueError):
            return UNKNOWN, "the recorded pending update count is not a number", ""
        if count >= int(value):
            return MATCH, f"{count} pending update(s)", ""
        return NO_MATCH, f"{count} pending update(s)", "filtered_out"

    return UNKNOWN, f"filter '{name}' is not implemented", ""


def _normalise_filters(raw: Any) -> tuple[list[dict] | None, str | None]:
    """Accept the list form or a plain ``{filter: value}`` object."""
    if raw in (None, "", []):
        return [], None
    items: list[dict] = []
    if isinstance(raw, dict):
        items = [{"filter": key, "value": value} for key, value in raw.items()]
    elif isinstance(raw, (list, tuple)):
        for entry in raw:
            if isinstance(entry, str):
                items.append({"filter": entry, "value": None})
            elif isinstance(entry, dict):
                name = entry.get("filter") or entry.get("name")
                if not name:
                    return None, "each filter needs a filter name"
                items.append({"filter": name, "value": entry.get("value"), "op": entry.get("op")})
            else:
                return None, "each filter must be an object with a filter name"
    else:
        return None, "filters must be a list or an object"

    resolved: list[dict] = []
    for item in items:
        name = str(item.get("filter") or "").strip()
        spec = FILTERS_BY_KEY.get(name)
        if not spec:
            return None, f"unknown filter '{name}'"
        provided_op = item.get("op")
        if provided_op and str(provided_op) != spec["op"]:
            return None, f"filter '{name}' does not support op '{provided_op}'"
        value = item.get("value")
        if spec["needs_value"]:
            if value is None or (isinstance(value, str) and not value.strip()):
                return None, f"filter '{name}' needs a value"
            if spec["op"] in ("gte", "below"):
                try:
                    value = float(value)
                except (TypeError, ValueError):
                    return None, f"filter '{name}' needs a number"
        else:
            value = None
        resolved.append({"filter": name, "value": value, "spec": spec})
    return resolved, None


def _apply_filters(devices: list[dict], filters: list[dict],
                   today: datetime) -> tuple[list[dict], dict]:
    members: list[dict] = []
    servers = 0
    active_user = 0
    filtered_out = 0
    unavailable_ids: list[str] = []
    unavailable_reasons: list[dict] = []

    for device in devices:
        outcome = MATCH
        bucket = ""
        unknown_reason = ""
        for applied in filters:
            result, detail, candidate = _evaluate_filter(
                device, applied["filter"], applied.get("value"), today)
            if result == NO_MATCH:
                outcome = NO_MATCH
                bucket = candidate or "filtered_out"
                break
            if result == UNKNOWN and not unknown_reason:
                unknown_reason = detail

        if outcome == NO_MATCH:
            # A definite recorded exclusion is real evidence, so it wins: this
            # device is out because Nexus can prove it is out.
            if bucket == "servers":
                servers += 1
            elif bucket == "active_user":
                active_user += 1
            else:
                filtered_out += 1
            continue

        if unknown_reason:
            device_id = _text(device.get("id"))
            unavailable_ids.append(device_id)
            unavailable_reasons.append({"id": device_id, "reason": unknown_reason})
            continue

        members.append(device)

    excluded = {
        "servers": servers,
        "active_user": active_user,
        "filtered_out": filtered_out,
        "unavailable": len(unavailable_ids),
        "unavailable_devices": unavailable_ids[:50],
        "unavailable_reasons": unavailable_reasons[:25],
    }
    return members, excluded


def _device_view(device: dict, today: datetime) -> dict:
    booted = _boot_timestamp(device)
    return {
        "id": _text(device.get("id")),
        "hostname": _text(device.get("hostname")) or _text(device.get("name")),
        "client_id": _text(device.get("client_id")),
        "client_name": _text(device.get("client_name")),
        "os": _text(device.get("os")),
        "status": _text(device.get("status")),
        "last_seen": _text(device.get("last_seen")),
        "days_since_boot": (today - booted).days if booted else None,
    }


def _scope_client(filters: list[dict]) -> str:
    for applied in filters:
        if applied["filter"] == "client_id":
            return _text(applied.get("value"))
    return ""


async def _load_devices(db: Any, user: dict, query: dict) -> list[dict]:
    return await db.devices.find(
        tenant_scoped_query(user, query), {"_id": 0}).limit(MAX_DEVICES).to_list(MAX_DEVICES)


# ============== QUERY ==============


async def query_fleet(db: Any, user: dict, payload: dict) -> dict:
    """Answer one fleet question. A read: it changes nothing."""
    payload = payload or {}
    filters, problem = _normalise_filters(payload.get("filters"))
    if problem:
        return {"found": False, "error": problem}
    filters = filters or []
    try:
        limit = max(1, min(int(payload.get("limit") or MAX_LISTED), MAX_LISTED))
    except (TypeError, ValueError):
        limit = MAX_LISTED

    client_id = _text(payload.get("client_id"))
    query = {"client_id": client_id} if client_id else {}
    rows = await _load_devices(db, user, query)
    today = _utcnow()
    members, excluded = _apply_filters(rows, filters, today)
    listed = sorted(members, key=lambda row: _text(row.get("hostname")) or _text(row.get("id")))

    note = "This is a read; the fleet was not touched."
    if excluded["unavailable"]:
        note += (f" {excluded['unavailable']} device(s) could not be judged because the evidence a filter "
                 f"needs is not recorded — they are reported as unavailable rather than assumed either way.")
    return {
        "found": True,
        "count": len(members),
        "devices": [_device_view(row, today) for row in listed[:limit]],
        "listed": min(len(listed), limit),
        "applied_filters": [{"filter": applied["filter"], "value": applied.get("value")}
                            for applied in filters],
        "excluded": excluded,
        "note": note,
    }


# ============== OBJECT SETS ==============


def _set_public(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "label": row.get("label"),
        "description": row.get("description") or "",
        "filters": row.get("filters") or [],
        "member_device_ids": list(row.get("member_device_ids") or []),
        "member_count": int(row.get("member_count") or 0),
        "unavailable_count": int(row.get("unavailable_count") or 0),
        "client_id": row.get("client_id") or "",
        "lineage": row.get("lineage"),
        "status": row.get("status") or "active",
        "created_by_name": row.get("created_by_name") or "",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


async def save_object_set(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Freeze a fleet answer into a named object set.

    Both the member IDs and the counts are recorded, so a later refinement
    cannot silently change what a saved set meant when it was saved.
    """
    payload = payload or {}
    label = _text(payload.get("label"))
    if not label:
        return {"found": False, "error": "label is required"}

    now = _utcnow()
    source_set_id = _text(payload.get("source_set_id"))
    lineage: dict | None = None
    if source_set_id:
        parent = await db.fleet_object_sets.find_one(
            tenant_scoped_query(user, {"id": source_set_id}), {"_id": 0})
        if not parent:
            return {"found": False}
        member_ids = list(parent.get("member_device_ids") or [])
        filters = list(parent.get("filters") or [])
        unavailable = int(parent.get("unavailable_count") or 0)
        client_id = _text(parent.get("client_id"))
        lineage = {"parent_set_id": source_set_id, "derived_at": _iso(now)}
    else:
        filters, problem = _normalise_filters(payload.get("filters"))
        if problem:
            return {"found": False, "error": problem}
        filters = filters or []
        rows = await _load_devices(db, user, {})
        members, excluded = _apply_filters(rows, filters, now)
        member_ids = [_text(row.get("id")) for row in members]
        unavailable = excluded["unavailable"]
        client_id = _scope_client(filters)

    row = {
        "id": f"FOS-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "label": label[:160],
        "description": _text(payload.get("description"))[:500],
        "filters": [{"filter": item.get("filter"), "value": item.get("value")} for item in filters],
        "member_device_ids": member_ids,
        "member_count": len(member_ids),
        "unavailable_count": unavailable,
        "client_id": client_id,
        "lineage": lineage,
        "status": "active",
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(now),
        "updated_at": _iso(now),
    }
    await db.fleet_object_sets.insert_one(row)
    row.pop("_id", None)
    return {
        "found": True,
        "object_set": _set_public(row),
        "note": ("Saved with its member IDs and counts, so refining it later cannot change what this set "
                 "meant when it was saved."),
    }


async def list_object_sets(db: Any, user: dict) -> dict:
    """Saved object sets in tenant scope, newest first."""
    rows = await db.fleet_object_sets.find(
        tenant_scoped_query(user, {}), {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {
        "count": len(rows),
        "object_sets": [_set_public(row) for row in rows],
        "note": "Object sets are saved fleet answers, not scheduled work.",
    }


async def get_object_set(db: Any, user: dict, set_id: str) -> dict:
    """One saved object set."""
    row = await db.fleet_object_sets.find_one(
        tenant_scoped_query(user, {"id": set_id}), {"_id": 0})
    if not row:
        return {"found": False}
    return {"found": True, "object_set": _set_public(row)}


async def refine_object_set(db: Any, user: dict, name: str, set_id: str, payload: dict) -> dict:
    """Narrow (or drop from) a saved set. The parent set is never mutated."""
    payload = payload or {}
    extra, problem = _normalise_filters(payload.get("filters"))
    if problem:
        return {"found": False, "error": problem}
    extra = extra or []
    if not extra:
        return {"found": False, "error": "at least one refining filter is required"}

    parent = await db.fleet_object_sets.find_one(
        tenant_scoped_query(user, {"id": set_id}), {"_id": 0})
    if not parent:
        return {"found": False}

    member_ids = list(parent.get("member_device_ids") or [])
    rows = await db.devices.find(
        tenant_scoped_query(user, {"id": {"$in": member_ids}}), {"_id": 0}
    ).limit(MAX_DEVICES).to_list(MAX_DEVICES)
    today = _utcnow()
    drop = bool(payload.get("drop"))

    now = _utcnow()
    if drop:
        # Removing members needs evidence too: a device the filters cannot judge
        # stays in the set and is reported as unavailable.
        matches, excluded = _apply_filters(rows, extra, today)
        removed = {_text(row.get("id")) for row in matches}
        kept = [device_id for device_id in member_ids if device_id not in removed]
        unavailable = int(parent.get("unavailable_count") or 0) + excluded["unavailable"]
        removed_count = len(removed)
    else:
        matches, excluded = _apply_filters(rows, extra, today)
        kept = [_text(row.get("id")) for row in matches]
        unavailable = int(parent.get("unavailable_count") or 0) + excluded["unavailable"]
        removed_count = len(member_ids) - len(kept)

    filters = list(parent.get("filters") or []) + [
        {"filter": item["filter"], "value": item.get("value")} for item in extra]
    label = _text(payload.get("label")) or f"{_text(parent.get('label'))} (refined)"

    row = {
        "id": f"FOS-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "label": label[:160],
        "description": _text(payload.get("description")) or _text(parent.get("description"))[:500],
        "filters": filters,
        "member_device_ids": kept,
        "member_count": len(kept),
        "unavailable_count": unavailable,
        "client_id": _text(parent.get("client_id")),
        "lineage": {"parent_set_id": set_id, "derived_at": _iso(now)},
        "status": "active",
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(now),
        "updated_at": _iso(now),
    }
    await db.fleet_object_sets.insert_one(row)
    row.pop("_id", None)
    return {
        "found": True,
        "object_set": _set_public(row),
        "parent": {"id": parent.get("id"), "member_count": int(parent.get("member_count") or 0)},
        "removed": removed_count,
        "note": (f"{len(kept)} of {int(parent.get('member_count') or 0)} member(s) remain. The parent set is "
                 f"unchanged — this is a new set derived from it."),
    }


# ============== ACTION PLANNING (PLAN ONLY) ==============


async def plan_set_action(db: Any, user: dict, name: str, set_id: str, payload: dict) -> dict:
    """Plan a staged action over a saved set. Nexus executes nothing here."""
    payload = payload or {}
    action = _text(payload.get("action"))
    if not action:
        return {"found": False, "error": "action is required"}
    capability = _text(payload.get("capability")) or "software_deployment"
    if capability not in KNOWN_CAPABILITIES:
        return {"found": False,
                "error": f"capability must be one of {', '.join(KNOWN_CAPABILITIES)}"}

    parent = await db.fleet_object_sets.find_one(
        tenant_scoped_query(user, {"id": set_id}), {"_id": 0})
    if not parent:
        return {"found": False}

    member_ids = [_text(device_id) for device_id in (parent.get("member_device_ids") or [])]
    total = len(member_ids)
    scope_client = _text(payload.get("client_id")) or _text(parent.get("client_id"))

    mode = await nexus_operational_mode.current_mode(db, user)
    decision = nexus_operational_mode.permits(
        mode, client_id=scope_client, capability=capability)

    rings: list[dict] = []
    cursor = 0
    for position, size in enumerate(BLAST_RADIUS_RINGS, start=1):
        if size == "remainder":
            actual = total - cursor
        else:
            actual = min(int(size), total - cursor)
        actual = max(actual, 0)
        ring_members = member_ids[cursor:cursor + actual]
        cursor += actual
        is_last = position == len(BLAST_RADIUS_RINGS) or cursor >= total
        rings.append({
            "ring": position,
            "size": actual,
            "kind": "remainder" if size == "remainder" else "fixed",
            "members": ring_members[:DISPLAY_MEMBERS],
            "verification_gate": (
                f"Verify ring {position} ({actual} device(s)) with recorded operation evidence before "
                + ("the action is called complete." if is_last else f"ring {position + 1} is released.")
            ),
        })

    unavailable = int(parent.get("unavailable_count") or 0)
    plan = {
        "action": action[:200],
        "detail": _text(payload.get("detail"))[:1000],
        "capability": capability,
        "object_set_id": parent.get("id"),
        "object_set_label": parent.get("label"),
        "target_count": total,
        "client_id": scope_client,
        "rings": rings if total else [],
        "rollback": _text(payload.get("rollback")) or (
            "Capture the previous configuration of every device in the ring before it runs, so a failed ring "
            "can be rolled back before the next ring is released."),
        "verification": _text(payload.get("verification")) or (
            "Record operation evidence for each ring; a ring may not be called complete on a check-in alone."),
        "unavailable_count": unavailable,
        "unexplained": (
            f"{unavailable} device(s) in this set could not be judged and are not action targets."
            if unavailable else "Every member of this set was judged from recorded evidence."),
        "mode": mode.get("mode"),
    }

    note = ("This is a plan. Nexus has not executed anything, and no ring is released before the previous "
            "ring is verified.")
    if not decision.get("allowed"):
        # The mode's own reason already opens with the block marker, so append it
        # whole rather than repeating the marker.
        note += f" {decision.get('reason')}"
    if not total:
        note += " This object set has no members, so there is nothing to action."

    return {"found": True, "plan": plan, "permitted": bool(decision.get("allowed")), "note": note}


# ============== SUMMARY ==============


async def fleet_summary(db: Any, user: dict, client_id: str | None = None) -> dict:
    """Fleet counts in scope, derived from recorded fields only."""
    query = {"client_id": _text(client_id)} if _text(client_id) else {}
    rows = await _load_devices(db, user, query)
    online = 0
    offline = 0
    by_os: dict[str, int] = {}
    by_client: dict[str, dict] = {}
    no_checkin = 0
    never_booted = 0

    for device in rows:
        status = _text(device.get("status")).lower()
        if status == "online":
            online += 1
        elif status == "offline":
            offline += 1
        os_name = _text(device.get("os")) or "not recorded"
        by_os[os_name] = by_os.get(os_name, 0) + 1
        key = _text(device.get("client_id")) or "unlinked"
        entry = by_client.setdefault(
            key, {"client_id": key, "client_name": _text(device.get("client_name")), "devices": 0})
        entry["devices"] += 1
        if not _text(device.get("last_seen")):
            no_checkin += 1
        if _boot_timestamp(device) is None:
            never_booted += 1

    return {
        "found": True,
        "total": len(rows),
        "online": online,
        "offline": offline,
        "status_not_recorded": len(rows) - online - offline,
        "by_os": dict(sorted(by_os.items(), key=lambda item: (-item[1], item[0]))),
        "by_client": sorted(by_client.values(), key=lambda item: (-item["devices"], item["client_id"])),
        "no_checkin_evidence": no_checkin,
        "never_booted_evidence": never_booted,
        "note": ("Counts are derived from recorded device fields only. A device with no check-in or boot "
                 "evidence is counted as lacking evidence, never as offline or as recently booted."),
    }
