"""Reconciliation of the Proxmox guest projection — one writer, two triggers.

``docs/DATA_OWNERSHIP.md`` keeps Proxmox VE as the authority for real node and
guest state; ``proxmox_vms`` is only the provider-bound projection Nexus acts
through. Both callers go through this module — the operator-triggered
``POST /api/proxmox/servers/{server_id}/sync`` route and the durable
``proxmox-inventory`` worker loop — so the projection has exactly one
reconciliation policy:

    observe the provider → store what it reported → drop what it stopped
    reporting → write nothing at all when the provider could not be observed

A scheduled pass runs without an authenticated user, so:

- every observation is attributed to the named system actor below;
- each connection is reconciled inside the tenant partition that owns it
  (:func:`connection_tenant_id`), never a browsing identity's partition;
- one customer's unreachable cluster is counted and disclosed inside the pass,
  and can never stop another tenant's reconciliation.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.database import db
from app.services import proxmox_adapter
from app.services.activity import log_activity
from app.services.platform_foundation import emit_platform_event
from app.services.scope_permissions import platform_tenant_id

logger = logging.getLogger("nexus.proxmox")


# The platform settings document that owns the reconciliation schedule. It is
# read leniently: an absent document means the documented defaults, so a fresh
# installation reconciles without an operator having to create anything.
SCHEDULER_SETTINGS_TYPE = "proxmox_inventory_sync"
DEFAULT_INTERVAL_MINUTES = 30
# A pass calls a customer's cluster once per configured connection, so the
# floor keeps a mistyped setting from hammering a provider and the ceiling
# keeps the inventory from going stale for more than a day.
MIN_INTERVAL_MINUTES = 5
MAX_INTERVAL_MINUTES = 1440
CONNECTION_SCAN_LIMIT = 500

# A scheduled pass has no authenticated user. It is attributed to this actor so
# audit entries and platform events never read as if a technician did the work.
SCHEDULED_ACTOR: dict[str, Any] = {
    "id": "system-proxmox-inventory",
    "name": "Proxmox inventory reconciliation",
    "role": "system",
    "system_actor": True,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _safe_event(
    *,
    subject: str,
    actor: dict,
    payload: dict,
    tenant_id: str,
    client_id: str | None = None,
) -> None:
    """Persist a platform event; an event failure never hides an outcome."""
    try:
        await emit_platform_event(
            subject=subject,
            source="nexus.proxmox",
            payload=payload,
            actor={"id": actor.get("id"), "name": actor.get("name"), "role": actor.get("role")},
            tenant_id=tenant_id,
            client_id=client_id,
        )
    except Exception as exc:  # noqa: BLE001 - the stored projection remains the durable evidence
        payload["event_persist_error"] = str(exc)[:200]


def connection_tenant_id(server_doc: dict[str, Any] | None) -> str:
    """The tenant partition that owns a connection and its projection rows.

    A connection is created inside an authenticated tenant, so its projection
    inherits that tenant. Deriving the partition from the connection instead of
    the acting identity is what lets a scheduled pass — which has no
    authenticated user — write rows the owning tenant can actually read. A
    legacy connection without a tenant marker belongs to the documented
    ``nexus-local`` partition, exactly as :func:`platform_tenant_id` decides.
    """
    return platform_tenant_id(dict(server_doc or {}))


def normalise_interval_minutes(value: Any) -> int:
    """Clamp a stored interval into the supported window; never trust it raw."""
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        minutes = DEFAULT_INTERVAL_MINUTES
    return max(MIN_INTERVAL_MINUTES, min(MAX_INTERVAL_MINUTES, minutes))


def scheduler_config(settings_doc: dict[str, Any] | None) -> dict[str, Any]:
    """The effective schedule: absent settings mean the documented defaults."""
    doc = dict(settings_doc or {})
    return {
        "enabled": bool(doc.get("enabled", True)),
        "interval_minutes": normalise_interval_minutes(
            doc.get("interval_minutes", DEFAULT_INTERVAL_MINUTES)
        ),
    }


async def _settings_document() -> dict[str, Any]:
    return await db.settings.find_one({"type": SCHEDULER_SETTINGS_TYPE}, {"_id": 0}) or {}


async def load_scheduler_config() -> dict[str, Any]:
    """The cadence the durable worker loop should follow."""
    return scheduler_config(await _settings_document())


async def scheduler_status() -> dict[str, Any]:
    """The schedule an operator may see, and nothing else.

    Deliberately carries only platform-wide facts — whether reconciliation runs,
    how often, and when the last pass finished. Per-tenant observation totals
    stay in the settings document: they are an aggregate across customers and
    must never be returned to a single tenant's session.
    """
    doc = await _settings_document()
    return {**scheduler_config(doc), "last_run_at": doc.get("last_run_at")}


# ============== THE PROJECTION ==============


def projection_row(
    *,
    guest: dict,
    connection: proxmox_adapter.ProxmoxConnection,
    server_doc: dict,
    tenant_id: str,
    observed_at: str,
) -> dict | None:
    """One provider guest as a stored row, or None when it cannot be bound.

    A guest the provider did not describe well enough to bind is refused rather
    than guessed at: an unbound row could be offered for a power action against
    coordinates Nexus never observed.
    """
    vmid = guest.get("vmid")
    node = str(guest.get("node") or "").strip()
    kind = str(guest.get("type") or "").strip().lower()
    if vmid in (None, "") or not node or kind not in proxmox_adapter.GUEST_KINDS:
        return None
    return {
        "id": f"{connection.server_id}:{kind}:{vmid}",
        "tenant_id": tenant_id,
        "client_id": connection.client_id,
        "client_name": server_doc.get("client_name") or None,
        "server_id": connection.server_id,
        "vmid": vmid,
        "name": str(guest.get("name") or f"{kind}-{vmid}"),
        "type": kind,
        "vm_type": kind,
        "node": node,
        "node_name": node,
        "status": str(guest.get("status") or "unknown"),
        "source": f"proxmox:{connection.server_id}",
        "observed_at": observed_at,
    }


async def _record_unobserved_connection(
    *,
    server_doc: dict,
    connection: proxmox_adapter.ProxmoxConnection | None,
    actor: dict,
    trigger: str,
    error: proxmox_adapter.ProxmoxAdapterError,
) -> None:
    """Record that a connection was not observed, then let the caller fail.

    The stored inventory is deliberately left untouched: Nexus states no guest
    it was not told about, and it does not delete guests because a cluster was
    briefly unreachable.
    """
    server_id = str(server_doc.get("id") or "") or (connection.server_id if connection else "")
    try:
        await db.proxmox_servers.update_one(
            {"id": server_id},
            {
                "$set": {
                    "last_sync_at": _now(),
                    "last_sync_status": error.kind,
                    "last_sync_error": str(error.detail or "")[:300],
                    "last_sync_trigger": trigger,
                }
            },
        )
    except Exception:  # noqa: BLE001 - stale bookkeeping must not mask the provider failure
        logger.warning("proxmox_sync_state_not_recorded server_id=%s", server_id)
    await log_activity(
        actor, "proxmox_inventory_sync_failed", "proxmox_server", server_id,
        f"Inventory sync failed for {(connection.name if connection else None) or server_id}",
        f"The Proxmox inventory was not observed: {error.detail}",
        metadata={
            "client_id": connection.client_id if connection else server_doc.get("client_id"),
            "failure_kind": error.kind,
            "trigger": trigger,
        },
    )


async def sync_connection(
    *,
    server_doc: dict,
    actor: dict,
    trigger: str,
    tenant_id: str | None = None,
) -> dict:
    """Observe one connection and reconcile its stored guest projection.

    Read-only toward the provider. Raises
    :class:`proxmox_adapter.ProxmoxAdapterError` — after recording the failure
    on the connection — when nothing could be observed; the stored projection is
    left exactly as it was. Callers translate ``exc.kind`` for their own
    surface (HTTP status here, a pass summary there).
    """
    tenant = tenant_id or connection_tenant_id(server_doc)
    connection = proxmox_adapter.load_connection(server_doc)
    if not connection or not connection.configured:
        error = proxmox_adapter.ProxmoxNotConfigured(
            "No Proxmox API token is configured for this connection, so no inventory "
            "was observed and nothing was stored. Store a token in Infrastructure, "
            "then sync again.",
            kind="not_configured",
        )
        await _record_unobserved_connection(
            server_doc=server_doc, connection=connection, actor=actor, trigger=trigger, error=error,
        )
        raise error

    try:
        inventory = await proxmox_adapter.fetch_inventory(connection)
    except proxmox_adapter.ProxmoxAdapterError as exc:
        await _record_unobserved_connection(
            server_doc=server_doc, connection=connection, actor=actor, trigger=trigger, error=exc,
        )
        raise

    observed_at = inventory["observed_at"]
    stored_ids = {
        str(row.get("id"))
        for row in await db.proxmox_vms.find(
            {"server_id": connection.server_id, "tenant_id": tenant},
            {"_id": 0, "id": 1},
        ).to_list(2000)
    }

    created = 0
    updated = 0
    unbindable = 0
    seen: set[str] = set()
    for guest in inventory.get("guests") or []:
        row = projection_row(
            guest=guest, connection=connection, server_doc=server_doc,
            tenant_id=tenant, observed_at=observed_at,
        )
        if row is None:
            # A guest the provider did not describe well enough to bind is
            # counted and disclosed, never invented.
            unbindable += 1
            continue
        seen.add(row["id"])
        if row["id"] in stored_ids:
            updated += 1
        else:
            created += 1
        await db.proxmox_vms.update_one(
            {"id": row["id"], "tenant_id": tenant}, {"$set": row}, upsert=True,
        )

    # The provider is the authority for what exists: a guest it no longer
    # reports for this connection leaves the projection, so the studio can never
    # offer a power action against a guest that is not there any more.
    removed_ids = sorted(stored_ids - seen)
    for vm_id in removed_ids:
        await db.proxmox_vms.delete_one({"id": vm_id, "tenant_id": tenant})

    result = {
        "server_id": connection.server_id,
        "tenant_id": tenant,
        "trigger": trigger,
        "source": inventory["source"],
        "observed_at": observed_at,
        "provider_version": inventory.get("version"),
        "nodes": len(inventory.get("nodes") or []),
        "observed": len(seen),
        "created": created,
        "updated": updated,
        "removed": len(removed_ids),
        "unbindable": unbindable,
    }
    await log_activity(
        actor, "proxmox_inventory_synced", "proxmox_server", connection.server_id,
        f"Observed {result['observed']} guests on {connection.name}",
        "Reconciled the Proxmox guest inventory from the provider's own report",
        metadata={
            "client_id": connection.client_id, "created": created,
            "updated": updated, "removed": len(removed_ids),
            "unbindable": unbindable, "trigger": trigger,
        },
    )
    await _safe_event(
        subject="virtualization.inventory.observed",
        actor=actor,
        payload=dict(result),
        tenant_id=tenant,
        client_id=connection.client_id,
    )
    try:
        await db.proxmox_servers.update_one(
            {"id": connection.server_id},
            {
                "$set": {
                    "last_sync_at": result["observed_at"],
                    "last_sync_status": "ok",
                    "last_sync_error": None,
                    "last_sync_trigger": trigger,
                    "last_sync_counts": {
                        "observed": result["observed"], "created": created,
                        "updated": updated, "removed": len(removed_ids),
                        "unbindable": unbindable,
                    },
                }
            },
        )
    except Exception:  # noqa: BLE001 - the stored rows are the evidence, not this stamp
        logger.warning("proxmox_sync_state_not_recorded server_id=%s", connection.server_id)
    return result


# ============== THE SCHEDULED PASS ==============


async def reconcile_configured_connections(*, actor: dict | None = None) -> dict:
    """One reconciliation pass over every configured connection, every tenant.

    The durable worker's entry point. It returns a summary instead of raising:
    a provider that could not be observed is counted, disclosed and recorded on
    its own connection, and the pass continues with the rest. Nothing is written
    for a connection with no stored token — there is nothing to observe, and the
    health surface already reports that state.
    """
    config = await load_scheduler_config()
    if not config["enabled"]:
        return {
            "trigger": "scheduled",
            "enabled": False,
            "interval_minutes": config["interval_minutes"],
            "connections": 0, "configured": 0, "observed": 0, "failed": 0,
            "unconfigured": 0, "guests": 0, "created": 0, "updated": 0,
            "removed": 0, "unbindable": 0, "results": [],
        }

    acting = actor or SCHEDULED_ACTOR
    server_docs = await db.proxmox_servers.find({}, {"_id": 0}).to_list(CONNECTION_SCAN_LIMIT)
    summary: dict[str, Any] = {
        "trigger": "scheduled",
        "enabled": True,
        "interval_minutes": config["interval_minutes"],
        "connections": len(server_docs),
        "configured": 0, "observed": 0, "failed": 0, "unconfigured": 0,
        "guests": 0, "created": 0, "updated": 0, "removed": 0, "unbindable": 0,
        "results": [],
    }

    for server_doc in server_docs:
        connection = proxmox_adapter.load_connection(server_doc)
        server_id = connection.server_id if connection else str(server_doc.get("id") or "")
        if not connection or not connection.configured:
            summary["unconfigured"] += 1
            summary["results"].append({
                "server_id": server_id, "status": "not_configured",
                "observed": 0, "note": "No stored API token, so there was nothing to observe.",
            })
            continue
        summary["configured"] += 1
        try:
            result = await sync_connection(
                server_doc=server_doc, actor=acting, trigger="scheduled",
            )
        except proxmox_adapter.ProxmoxAdapterError as exc:
            summary["failed"] += 1
            summary["results"].append({
                "server_id": server_id, "status": exc.kind,
                "observed": 0, "error": exc.detail,
            })
            continue
        summary["observed"] += 1
        summary["guests"] += result["observed"]
        summary["created"] += result["created"]
        summary["updated"] += result["updated"]
        summary["removed"] += result["removed"]
        summary["unbindable"] += result["unbindable"]
        summary["results"].append({
            "server_id": server_id, "status": "ok",
            "observed": result["observed"], "created": result["created"],
            "updated": result["updated"], "removed": result["removed"],
            "unbindable": result["unbindable"],
        })

    await _record_pass_state(summary)
    return summary


async def _record_pass_state(summary: dict) -> None:
    """Persist when a pass last ran and what it did.

    Observability only, and deliberately platform-scoped: it is never returned
    to a tenant-scoped caller (see :func:`scheduler_status`). A failure to write
    it never changes the reconciliation outcome.
    """
    try:
        await db.settings.update_one(
            {"type": SCHEDULER_SETTINGS_TYPE},
            {
                "$set": {
                    "last_run_at": _now(),
                    "last_result": {
                        key: summary.get(key)
                        for key in (
                            "connections", "configured", "observed", "failed",
                            "unconfigured", "guests", "created", "updated",
                            "removed", "unbindable",
                        )
                    },
                }
            },
            upsert=True,
        )
    except Exception:  # noqa: BLE001 - state is observability, never the outcome
        logger.warning("proxmox_inventory_pass_state_not_recorded")
