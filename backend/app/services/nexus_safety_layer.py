"""The safety UX layer: Wrong-Customer Protection and four-eyes with real diffs.

Writing Guard reads a draft against the customers you actually have and flags
cross-customer leaks ("this content references Contoso, you are replying to
ACME") before a human sends it. It matches customer names and device hostnames
inside your tenant and is honest that it cannot judge intent — it flags, humans
decide. Four-eyes sign-off stores a real recursive before/after diff and refuses
self-approval; the sign-off record is an ``approval`` object in the shared
human-decision family, so it inherits that lifecycle and audit trail.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from app.services import nexus_decision_family
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


# ============== DRAFT SCANNING: WRITING GUARD & WRONG-CUSTOMER ==============


def _find_mentions(content: str, needles: list[tuple[str, dict]]) -> list[dict]:
    """Case-insensitive whole-token matches of entity labels inside the draft."""
    lowered = content.lower()
    hits: list[dict] = []
    for label, entity in needles:
        if len(label) < 3:
            continue
        pattern = r"(?<![a-z0-9])" + re.escape(label.lower()) + r"(?![a-z0-9])"
        if re.search(pattern, lowered):
            hits.append({"label": label, "entity": entity})
    return hits


async def _tenant_entities(db: Any, user: dict) -> tuple[list[dict], list[dict]]:
    clients = await db.clients.find(tenant_scoped_query(user, {}), {"_id": 0}).to_list(500)
    devices = await db.devices.find(tenant_scoped_query(user, {}), {"_id": 0}).to_list(1000)
    return clients, devices


def _scan(content: str, clients: list[dict], devices: list[dict]) -> tuple[list[dict], list[dict]]:
    client_labels = [(str(c.get("name") or ""), {"kind": "client", "id": c.get("id"),
                                                 "name": c.get("name")}) for c in clients]
    device_labels = [(str(d.get("hostname") or d.get("name") or ""), {"kind": "device", "id": d.get("id"),
                                                                     "hostname": d.get("hostname") or d.get("name"),
                                                                     "client_id": d.get("client_id"),
                                                                     "client_name": d.get("client_name")})
                     for d in devices]
    return _find_mentions(content, client_labels), _find_mentions(content, device_labels)


async def writing_guard(db: Any, user: dict, payload: dict) -> dict:
    """Scan a draft before it is sent. With a target client, flag anything that
    references a different customer; without one, just report references found."""
    content = str(payload.get("content") or "")
    if not content.strip():
        return {"found": False, "error": "content is required"}
    target_client_id = str(payload.get("client_id") or "").strip()
    clients, devices = await _tenant_entities(db, user)
    client_hits, device_hits = _scan(content, clients, devices)

    target = None
    if target_client_id:
        target = next((c for c in clients if str(c.get("id")) == target_client_id), None)
        if not target:
            return {"found": False, "error": "client_id not found in your tenant"}
    target_name = str((target or {}).get("name") or target_client_id or "")

    warnings: list[dict] = []
    references: list[dict] = []
    for hit in client_hits:
        entity = hit["entity"]
        references.append(entity)
        if target and str(entity.get("id")) != target_client_id:
            warnings.append({
                "kind": "cross_customer_name", "client_id": entity.get("id"),
                "message": f"This content references {hit['label']}, you are replying to {target_name}.",
            })
    for hit in device_hits:
        entity = hit["entity"]
        references.append(entity)
        if target and str(entity.get("client_id") or "") not in ("", target_client_id):
            warnings.append({
                "kind": "cross_customer_device", "client_id": entity.get("client_id"),
                "message": (f"This content references device {hit['label']} "
                            f"({entity.get('client_name') or entity.get('client_id')}), "
                            f"you are replying to {target_name}."),
            })

    verdict = "review_required" if warnings else "clean"
    return {
        "found": True,
        "verdict": verdict,
        "warnings": warnings,
        "references": references,
        "checked_against": {"clients": len(clients), "devices": len(devices)},
        "note": ("Customer names and device hostnames in your tenant only. Nexus flags the mismatch; "
                 "humans decide — it cannot judge intent." if target_client_id
                else "Pass a client_id to check for wrong-customer leaks against the intended recipient."),
    }


async def wrong_customer_check(db: Any, user: dict, payload: dict) -> dict:
    """Wrong-Customer Protection: is this content safe to send to this customer?"""
    content = str(payload.get("content") or "")
    client_id = str(payload.get("client_id") or "").strip()
    if not content.strip() or not client_id:
        return {"found": False, "error": "client_id and content are required"}
    guard = await writing_guard(db, user, {"content": content, "client_id": client_id})
    if not guard.get("found"):
        return guard
    client = await db.clients.find_one(tenant_scoped_query(user, {"id": client_id}), {"_id": 0})
    return {
        "found": True,
        "verdict": guard["verdict"],
        "target": {"id": client.get("id"), "name": client.get("name")},
        "warnings": guard["warnings"],
        "references": guard["references"],
        "checked_against": guard["checked_against"],
        "note": ("Hold before sending: this content references a different customer. "
                 if guard["verdict"] == "review_required"
                 else "No cross-customer references detected. ")
               + "Detection covers customer names and device hostnames in your tenant.",
    }


# ============== FOUR-EYES WITH REAL DIFFS ==============


def diff_changes(before: Any, after: Any, path: str = "") -> list[dict]:
    """Recursive structural diff. Real values at real paths — not a summary."""
    changes: list[dict] = []
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(set(before) | set(after)):
            child = f"{path}.{key}" if path else str(key)
            if key not in before:
                changes.append({"path": child, "kind": "added", "before": None, "after": after[key]})
            elif key not in after:
                changes.append({"path": child, "kind": "removed", "before": before[key], "after": None})
            else:
                changes.extend(diff_changes(before[key], after[key], child))
        return changes
    if isinstance(before, list) and isinstance(after, list):
        for index in range(max(len(before), len(after))):
            child = f"{path}[{index}]"
            if index >= len(before):
                changes.append({"path": child, "kind": "added", "before": None, "after": after[index]})
            elif index >= len(after):
                changes.append({"path": child, "kind": "removed", "before": before[index], "after": None})
            else:
                changes.extend(diff_changes(before[index], after[index], child))
        return changes
    if before != after:
        changes.append({"path": path or "$", "kind": "changed", "before": before, "after": after})
    return changes


async def request_four_eyes(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Request independent sign-off on a proposed change, with the real diff."""
    title = str(payload.get("title") or "").strip()
    before = payload.get("before")
    after = payload.get("after")
    if not title:
        return {"found": False, "error": "title is required"}
    if before is None and after is None:
        return {"found": False, "error": "before and/or after state is required"}
    changes = diff_changes(before or {}, after or {})
    if not changes:
        return {"found": False, "error": "before and after are identical — nothing to approve"}
    recorded = await nexus_decision_family.record_object(db, user, name, {
        "kind": "approval",
        "subject": title,
        "detail": str(payload.get("detail") or payload.get("action") or "")[:2000],
        "client_id": str(payload.get("client_id") or ""),
        "device_id": str(payload.get("device_id") or ""),
        "owner": name,
        "evidence": {"diff": {"changes": changes, "before": before, "after": after}},
    })
    if not recorded.get("found"):
        return recorded
    obj = recorded["object"]
    return {
        "found": True,
        "review_id": obj["id"],
        "object": obj,
        "diff": {"changes": changes,
                 "summary": {"added": sum(1 for c in changes if c["kind"] == "added"),
                             "removed": sum(1 for c in changes if c["kind"] == "removed"),
                             "changed": sum(1 for c in changes if c["kind"] == "changed")}},
        "note": "Sign-off required from someone other than the requester. Four-eyes, with the real diff attached.",
    }


async def review_four_eyes(db: Any, user: dict, name: str, review_id: str, payload: dict) -> dict:
    """Approve or reject a sign-off. The requester can never be the reviewer."""
    row = await db.decision_family.find_one(
        tenant_scoped_query(user, {"id": review_id, "kind": "approval"}), {"_id": 0})
    if not row:
        return {"found": False}
    if str(row.get("created_by")) == str(user.get("id")):
        return {"found": False,
                "error": "four-eyes: the requester cannot sign off their own change"}
    if row.get("state") not in ("proposed", "reviewed"):
        return {"found": False, "error": f"already {row.get('state')} — a sign-off is decided once"}
    decision = str(payload.get("decision") or "").strip().lower()
    if decision not in ("approved", "rejected"):
        return {"found": False, "error": "decision must be approved or rejected"}
    result = await nexus_decision_family.transition(db, user, name, review_id, {
        "to_state": "decided", "decision": decision,
        "note": str(payload.get("note") or "")[:500],
    })
    if not result.get("found"):
        return result
    return {"found": True, "object": result["object"], "decision": decision,
            "diff": (row.get("evidence") or {}).get("diff"),
            "note": f"Signed off as {decision} by {name} — independent of the requester."}


async def list_four_eyes(db: Any, user: dict, client_id: str | None = None) -> dict:
    """Sign-off queue and history in tenant scope, with derived honest states."""
    today = _utcnow()
    scope: dict = {"tenant_id": platform_tenant_id(user), "kind": "approval"}
    if client_id:
        scope["client_id"] = client_id
    rows = await db.decision_family.find(scope, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    items = []
    for row in rows:
        diff = (row.get("evidence") or {}).get("diff") or {}
        items.append({
            "id": row.get("id"),
            "subject": row.get("subject"),
            "client_id": row.get("client_id") or "",
            "state": nexus_decision_family.effective_state(
                row.get("state"), row.get("expires"), row.get("review_date"), today),
            "requester": row.get("created_by_name"),
            "decided_by": row.get("decided_by") or "",
            "decision": row.get("decision") or "",
            "diff_summary": {"added": sum(1 for c in diff.get("changes", []) if c["kind"] == "added"),
                             "removed": sum(1 for c in diff.get("changes", []) if c["kind"] == "removed"),
                             "changed": sum(1 for c in diff.get("changes", []) if c["kind"] == "changed")},
            "created_at": row.get("created_at"),
        })
    pending = [item for item in items if item["state"] in ("proposed", "reviewed")]
    return {"count": len(items), "sign_offs": items[:50], "pending": len(pending),
            "note": ("Four-eyes with real diffs: every sign-off carries exactly what changes, "
                     "and the requester can never approve their own work.")}
