"""Pure contracts for the Nexus Switchboard migration workbench.

The first Switchboard release deliberately models a migration programme and its
evidence.  It does not call a source provider or write canonical Nexus client,
device, ticket or billing records.  That boundary lets an MSP rehearse a move
and resolve data-quality decisions before a separately reviewed provider
adapter is allowed to import anything.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any


SWITCHBOARD_PROVIDERS: tuple[dict[str, str], ...] = (
    {
        "id": "syncro",
        "label": "Syncro",
        "readiness": "Legacy connection settings may exist, but Switchboard does not reuse the direct importer.",
    },
    {
        "id": "halo_psa",
        "label": "HaloPSA",
        "readiness": "Adapter not connected. Begin with a documented export or approved pilot fixture.",
    },
    {
        "id": "ninjaone",
        "label": "NinjaOne",
        "readiness": "Adapter not connected. Begin with a documented export or approved pilot fixture.",
    },
    {
        "id": "connectwise_psa",
        "label": "ConnectWise PSA",
        "readiness": "Adapter not connected. Begin with a documented export or approved pilot fixture.",
    },
    {
        "id": "autotask",
        "label": "Autotask PSA",
        "readiness": "Adapter not connected. Begin with a documented export or approved pilot fixture.",
    },
    {
        "id": "hudu",
        "label": "Hudu",
        "readiness": "Documentation migration is planning-only. Credential values are never copied into Switchboard.",
    },
    {
        "id": "it_glue",
        "label": "IT Glue",
        "readiness": "Documentation migration is planning-only. Credential values are never copied into Switchboard.",
    },
    {
        "id": "csv_export",
        "label": "Verified CSV export",
        "readiness": "Use a signed, source-owned export only; Switchboard never treats a spreadsheet name as an identity.",
    },
)
PROVIDER_IDS = frozenset(item["id"] for item in SWITCHBOARD_PROVIDERS)

OBJECT_SCOPES: tuple[dict[str, str], ...] = (
    {"id": "clients", "label": "Clients and sites"},
    {"id": "contacts", "label": "Contacts"},
    {"id": "devices", "label": "Devices and asset links"},
    {"id": "tickets", "label": "Tickets and service history"},
    {"id": "contracts", "label": "Contracts and services"},
    {"id": "billing", "label": "Billing records and catalogue"},
    {"id": "documentation", "label": "Documentation references"},
)
OBJECT_SCOPE_IDS = frozenset(item["id"] for item in OBJECT_SCOPES)

STAGES = ("source", "inventory", "mapping", "exceptions", "reconciliation", "cutover", "proof")
STAGE_LABELS = {
    "source": "Connect source",
    "inventory": "Inventory",
    "mapping": "Dry-run map",
    "exceptions": "Resolve exceptions",
    "reconciliation": "Reconcile",
    "cutover": "Cutover gate",
    "proof": "Export proof",
}

RECONCILIATION_CHECKS: tuple[dict[str, str], ...] = (
    {"id": "source_count", "label": "Source record counts are retained"},
    {"id": "nexus_count", "label": "Expected Nexus record counts are mapped"},
    {"id": "stable_ids", "label": "Source system + external IDs are declared for every mapping"},
    {"id": "attachments", "label": "Attachment and documentation-reference treatment is decided"},
    {"id": "credential_boundary", "label": "Credentials and secrets remain outside the migration payload"},
    {"id": "retry_compensation", "label": "Retry and compensation owner is recorded"},
)

CUTOVER_GATES: tuple[dict[str, str], ...] = (
    {"id": "pilot_fixture", "label": "A fixture or isolated pilot has passed"},
    {"id": "exceptions_owned", "label": "Every exception has an owner and resolution path"},
    {"id": "rollback", "label": "Rollback or compensating action is documented"},
    {"id": "approval", "label": "Named migration owner has approved the cutover plan"},
    {"id": "communications", "label": "Customer and technician communications are prepared"},
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalise_strings(values: Any, allowed: frozenset[str]) -> list[str]:
    if not isinstance(values, (list, tuple, set, frozenset)):
        return []
    return sorted({str(value).strip().lower() for value in values if str(value).strip().lower() in allowed})


def default_reconciliation() -> list[dict[str, Any]]:
    return [{**item, "complete": False, "evidence": ""} for item in RECONCILIATION_CHECKS]


def default_cutover() -> list[dict[str, Any]]:
    return [{**item, "complete": False, "evidence": ""} for item in CUTOVER_GATES]


def default_mappings(scope: list[str]) -> list[dict[str, Any]]:
    return [
        {
            "id": object_type,
            "object_type": object_type,
            "label": next((item["label"] for item in OBJECT_SCOPES if item["id"] == object_type), object_type.title()),
            "source_identity": "source_system + immutable_external_id",
            "nexus_identity": f"stable Nexus {object_type[:-1] if object_type.endswith('s') else object_type}_id",
            "status": "not_reviewed",
            "field_map_note": "",
            "source_count": None,
            "expected_count": None,
        }
        for object_type in scope
    ]


def build_plan(*, plan_id: str, payload: dict[str, Any], actor: dict[str, Any], now: str | None = None) -> dict[str, Any]:
    now = now or utc_now()
    scope = _normalise_strings(payload.get("scope"), OBJECT_SCOPE_IDS)
    provider = str(payload.get("provider") or "").strip()
    return {
        "id": plan_id,
        "name": str(payload.get("name") or "").strip(),
        "provider": provider,
        "scope": scope,
        "notes": str(payload.get("notes") or "").strip(),
        "idempotency_key": str(payload.get("idempotency_key") or "").strip() or None,
        "status": "planning",
        "stage": "source",
        "source_readiness": {
            "state": "not_connected",
            "evidence_reference": "",
            "note": "No provider connection, discovery, export read or import is run by this Switchboard plan.",
        },
        "mappings": default_mappings(scope),
        "exceptions": [],
        "reconciliation": default_reconciliation(),
        "cutover": default_cutover(),
        "review": {"status": "not_reviewed", "note": "", "reviewed_at": None, "reviewed_by": None},
        "counts": {"scope_objects": len(scope), "mapping_reviewed": 0, "exceptions_open": 0, "reconciliation_complete": 0, "cutover_complete": 0},
        "created_at": now,
        "created_by": actor.get("id") or actor.get("email") or "Nexus administrator",
        "updated_at": now,
        "updated_by": actor.get("id") or actor.get("email") or "Nexus administrator",
        "version": 1,
        "execution_boundary": "planning_only",
    }


def _normalise_checklist(raw: Any, defaults: tuple[dict[str, str], ...]) -> list[dict[str, Any]]:
    by_id = {str(item.get("id")): item for item in raw if isinstance(item, dict)} if isinstance(raw, list) else {}
    result = []
    for item in defaults:
        stored = by_id.get(item["id"], {})
        result.append({
            **item,
            "complete": bool(stored.get("complete")),
            "evidence": str(stored.get("evidence") or "").strip()[:1000],
        })
    return result


def _normalise_mappings(raw: Any, scope: list[str]) -> list[dict[str, Any]]:
    existing = {str(item.get("object_type") or item.get("id")): item for item in raw if isinstance(item, dict)} if isinstance(raw, list) else {}
    clean = []
    for baseline in default_mappings(scope):
        item = existing.get(baseline["object_type"], {})
        status = str(item.get("status") or baseline["status"])
        if status not in {"not_reviewed", "reviewed", "blocked"}:
            status = "not_reviewed"
        source_count = item.get("source_count")
        expected_count = item.get("expected_count")
        clean.append({
            **baseline,
            "status": status,
            "field_map_note": str(item.get("field_map_note") or "").strip()[:2000],
            "source_count": int(source_count) if isinstance(source_count, int) and source_count >= 0 else None,
            "expected_count": int(expected_count) if isinstance(expected_count, int) and expected_count >= 0 else None,
        })
    return clean


def _normalise_exceptions(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    clean = []
    for index, item in enumerate(raw[:100]):
        if not isinstance(item, dict):
            continue
        object_type = str(item.get("object_type") or "").strip()
        if object_type not in OBJECT_SCOPE_IDS:
            continue
        status = str(item.get("status") or "open").strip().lower()
        if status not in {"open", "resolved", "accepted"}:
            status = "open"
        clean.append({
            "id": str(item.get("id") or f"exception-{index + 1}").strip()[:120],
            "object_type": object_type,
            "title": str(item.get("title") or "Migration exception").strip()[:240],
            "detail": str(item.get("detail") or "").strip()[:2000],
            "owner": str(item.get("owner") or "").strip()[:160],
            "resolution": str(item.get("resolution") or "").strip()[:2000],
            "status": status,
        })
    return clean


def recalculate_plan(plan: dict[str, Any], *, actor: dict[str, Any] | None = None, now: str | None = None) -> dict[str, Any]:
    """Normalise persisted planning data and derive, never infer, readiness."""
    record = deepcopy(plan)
    scope = _normalise_strings(record.get("scope"), OBJECT_SCOPE_IDS)
    record["scope"] = scope
    record["mappings"] = _normalise_mappings(record.get("mappings"), scope)
    record["exceptions"] = _normalise_exceptions(record.get("exceptions"))
    record["reconciliation"] = _normalise_checklist(record.get("reconciliation"), RECONCILIATION_CHECKS)
    record["cutover"] = _normalise_checklist(record.get("cutover"), CUTOVER_GATES)
    source = record.get("source_readiness") if isinstance(record.get("source_readiness"), dict) else {}
    source_state = str(source.get("state") or "not_connected")
    if source_state not in {"not_connected", "export_prepared", "fixture_verified"}:
        source_state = "not_connected"
    record["source_readiness"] = {
        "state": source_state,
        "evidence_reference": str(source.get("evidence_reference") or "").strip()[:1000],
        "note": str(source.get("note") or "").strip()[:2000],
    }
    reviewed_mappings = sum(1 for item in record["mappings"] if item["status"] == "reviewed")
    open_exceptions = sum(1 for item in record["exceptions"] if item["status"] == "open")
    reconciliation_complete = sum(1 for item in record["reconciliation"] if item["complete"])
    cutover_complete = sum(1 for item in record["cutover"] if item["complete"])
    if source_state == "not_connected":
        stage = "source"
    elif reviewed_mappings < len(record["mappings"]):
        stage = "mapping"
    elif open_exceptions:
        stage = "exceptions"
    elif reconciliation_complete < len(record["reconciliation"]):
        stage = "reconciliation"
    elif cutover_complete < len(record["cutover"]):
        stage = "cutover"
    else:
        stage = "proof"
    record["stage"] = stage
    record["status"] = "review_ready" if stage == "proof" else "planning"
    record["counts"] = {
        "scope_objects": len(scope),
        "mapping_reviewed": reviewed_mappings,
        "exceptions_open": open_exceptions,
        "reconciliation_complete": reconciliation_complete,
        "cutover_complete": cutover_complete,
    }
    record["execution_boundary"] = "planning_only"
    if actor:
        record["updated_at"] = now or utc_now()
        record["updated_by"] = actor.get("id") or actor.get("email") or "Nexus administrator"
        record["version"] = max(1, int(record.get("version") or 1)) + 1
    return record


def public_plan(plan: dict[str, Any]) -> dict[str, Any]:
    """Return planning evidence without Mongo internals or an idempotency key."""
    result = {key: value for key, value in plan.items() if key not in {"_id", "idempotency_key"}}
    result["stage_label"] = STAGE_LABELS.get(result.get("stage"), "Migration planning")
    result["provider_label"] = next((item["label"] for item in SWITCHBOARD_PROVIDERS if item["id"] == result.get("provider")), result.get("provider"))
    return result


def evidence_for_plan(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Give the UI a truthful export-proof checklist; no import assertion is made."""
    evidence = [
        {"id": "boundary", "label": "Execution boundary", "status": "recorded", "detail": "This plan is dry-run planning only. No external provider call or canonical Nexus write was performed."},
        {"id": "source", "label": "Source readiness", "status": plan.get("source_readiness", {}).get("state", "not_connected"), "detail": plan.get("source_readiness", {}).get("evidence_reference") or "No source export or pilot fixture evidence has been attached."},
        {"id": "mappings", "label": "Stable identity mapping", "status": f"{plan.get('counts', {}).get('mapping_reviewed', 0)}/{len(plan.get('mappings') or [])}", "detail": "Mappings must use the source system and immutable external ID, then resolve to a stable Nexus object ID."},
        {"id": "exceptions", "label": "Exception ownership", "status": "attention" if plan.get("counts", {}).get("exceptions_open") else "clear", "detail": f"{plan.get('counts', {}).get('exceptions_open', 0)} unresolved exception(s)."},
        {"id": "reconciliation", "label": "Reconciliation proof", "status": f"{plan.get('counts', {}).get('reconciliation_complete', 0)}/{len(plan.get('reconciliation') or [])}", "detail": "Source-versus-Nexus counts and data-handling decisions are evidence, not a claim that an import happened."},
        {"id": "cutover", "label": "Cutover gate", "status": f"{plan.get('counts', {}).get('cutover_complete', 0)}/{len(plan.get('cutover') or [])}", "detail": "A real cutover requires a separately reviewed provider adapter, a tested rollback or compensation path and explicit approval."},
    ]
    return evidence
