"""Evidence-backed operational memory for NexusMSP.

The Second Brain does not invent conclusions or perform operational changes.
It projects existing tickets, documentation, runbooks, audit records and team
outcomes into explainable patterns that a technician can review.
"""

from __future__ import annotations

import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import html
import re
from typing import Iterable

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.platform_foundation import emit_platform_event, request_correlation_id


router = APIRouter()

RESOLVED_STATES = {"resolved", "closed", "completed"}
STOP_WORDS = {
    "about", "after", "again", "been", "being", "client", "computer", "could",
    "device", "from", "have", "into", "issue", "more", "need", "needs", "not",
    "only", "over", "please", "problem", "system", "that", "their", "there",
    "these", "they", "this", "ticket", "unable", "user", "using", "with", "work",
}
TOPICS = {
    "printing": {
        "label": "Printing",
        "terms": ("printer", "printing", "spooler", "print queue"),
        "route": "/tickets?category=hardware",
    },
    "patching": {
        "label": "Patching and updates",
        "terms": ("patch", "patches", "windows update", "pending windows updates", "kb50"),
        "route": "/tickets?category=patching",
    },
    "identity": {
        "label": "Identity and access",
        "terms": ("mfa", "bitlocker", "password", "account locked", "login", "authenticate", "replication"),
        "route": "/control-plane?module=microsoft365",
    },
    "network": {
        "label": "Network connectivity",
        "terms": ("vpn", "dns", "wi-fi", "wifi", "firewall", "latency"),
        "route": "/networking",
    },
    "backup": {
        "label": "Backup and recovery",
        "terms": ("backup", "restore", "vss", "recovery"),
        "route": "/backup-center",
    },
    "performance": {
        "label": "Performance and capacity",
        "terms": ("cpu", "memory", "slow", "freezing", "disk space", "storage", "capacity"),
        "route": "/devices?tab=insights",
    },
    "onboarding": {
        "label": "User onboarding",
        "terms": ("new user", "onboarding", "new employee", "setup workstation"),
        "route": "/onboarding",
    },
    "email": {
        "label": "Email and collaboration",
        "terms": ("outlook", "exchange", "mailbox", "email", "teams"),
        "route": "/email",
    },
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stable_id(prefix: str, *parts: object) -> str:
    material = "|".join(str(part or "").strip().lower() for part in parts)
    return f"{prefix}-{hashlib.sha1(material.encode('utf-8'), usedforsecurity=False).hexdigest()[:12]}"


def _plain(value: object) -> str:
    if isinstance(value, list):
        return " ".join(_plain(item) for item in value)
    if isinstance(value, dict):
        return " ".join(f"{key} {_plain(item)}" for key, item in value.items())
    return str(value or "")


def _excerpt(value: object, limit: int = 240) -> str:
    text = html.unescape(_plain(value))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _ticket_text(ticket: dict) -> str:
    return " ".join(
        (
            _plain(ticket.get("title")),
            _plain(ticket.get("subject")),
            _plain(ticket.get("description")),
            _plain(ticket.get("category")),
            _plain(ticket.get("tags")),
            _plain(ticket.get("resolution_notes")),
        )
    ).lower()


def _knowledge_text(record: dict) -> str:
    return " ".join(
        (
            _plain(record.get("title") or record.get("name")),
            _plain(record.get("summary") or record.get("description")),
            _plain(record.get("content") or record.get("body_md")),
            _plain(record.get("category")),
            _plain(record.get("tags")),
            _plain(record.get("steps")),
        )
    ).lower()


def _confidence(evidence_count: int, *, corroborating_sources: int = 1) -> dict:
    score = min(96, 34 + evidence_count * 8 + max(0, corroborating_sources - 1) * 9)
    if score >= 80:
        label = "High"
    elif score >= 60:
        label = "Moderate"
    else:
        label = "Emerging"
    return {"score": score, "label": label, "evidence_count": evidence_count}


def _build_topic_signals(tickets: list[dict], knowledge: list[dict]) -> list[dict]:
    knowledge_text = "\n".join(_knowledge_text(item) for item in knowledge)
    signals = []
    for topic_id, definition in TOPICS.items():
        matches = [
            ticket for ticket in tickets
            if any(term in _ticket_text(ticket) for term in definition["terms"])
        ]
        if len(matches) < 2:
            continue
        clients = sorted({str(item.get("client_name") or "Unlinked client") for item in matches})
        resolved = [item for item in matches if str(item.get("status") or "").lower() in RESOLVED_STATES]
        open_count = len(matches) - len(resolved)
        documented = any(term in knowledge_text for term in definition["terms"])
        cross_client = len(clients) > 1
        if cross_client:
            finding = f"{definition['label']} demand appears across {len(clients)} clients."
        else:
            finding = f"{definition['label']} demand repeats for {clients[0]}."
        reason = (
            f"{len(matches)} matching tickets were found: {len(resolved)} resolved and "
            f"{open_count} still active. Nexus has not inferred a root cause."
        )
        signals.append({
            "id": _stable_id("pattern", topic_id),
            "topic": topic_id,
            "label": definition["label"],
            "finding": finding,
            "reason": reason,
            "ticket_count": len(matches),
            "resolved_count": len(resolved),
            "open_count": open_count,
            "client_count": len(clients),
            "clients": clients[:8],
            "documented": documented,
            "knowledge_gap": not documented,
            "confidence": _confidence(len(matches), corroborating_sources=2 if resolved else 1),
            "route": definition["route"],
            "evidence": [
                {
                    "ticket_id": item.get("id"),
                    "ticket_number": item.get("ticket_number"),
                    "title": item.get("title") or "Untitled ticket",
                    "client_name": item.get("client_name") or "Unlinked client",
                    "status": item.get("status") or "unknown",
                    "route": f"/tickets?ticket={item.get('id')}",
                }
                for item in matches[:8]
            ],
        })
    return sorted(
        signals,
        key=lambda item: (-item["confidence"]["score"], -item["ticket_count"], item["label"]),
    )


def _build_expertise(tickets: list[dict]) -> list[dict]:
    resolved = [
        ticket for ticket in tickets
        if str(ticket.get("status") or "").lower() in RESOLVED_STATES
        and (ticket.get("assigned_to") or ticket.get("assignee_id"))
    ]
    by_technician: dict[str, list[dict]] = defaultdict(list)
    for ticket in resolved:
        technician_id = str(ticket.get("assigned_to") or ticket.get("assignee_id"))
        by_technician[technician_id].append(ticket)

    profiles = []
    for technician_id, outcomes in by_technician.items():
        categories = Counter(str(item.get("category") or "uncategorised").lower() for item in outcomes)
        top_category, top_count = categories.most_common(1)[0]
        display_name = next(
            (
                item.get("assigned_name")
                or item.get("assigned_to_name")
                or item.get("assignee_name")
                for item in outcomes
                if item.get("assigned_name") or item.get("assigned_to_name") or item.get("assignee_name")
            ),
            "Recorded technician",
        )
        profiles.append({
            "id": technician_id,
            "name": display_name,
            "resolved_count": len(outcomes),
            "top_category": top_category,
            "top_category_count": top_count,
            "categories": [{"name": name, "count": count} for name, count in categories.most_common(4)],
            "confidence": _confidence(len(outcomes)),
            "explanation": (
                f"Based on {len(outcomes)} recorded resolved or closed tickets. "
                "This is outcome evidence, not an employee performance score."
            ),
            "recent_evidence": [
                {
                    "ticket_id": item.get("id"),
                    "ticket_number": item.get("ticket_number"),
                    "title": item.get("title") or "Untitled ticket",
                    "category": item.get("category") or "uncategorised",
                    "route": f"/tickets?ticket={item.get('id')}",
                }
                for item in outcomes[:5]
            ],
        })
    return sorted(profiles, key=lambda item: (-item["resolved_count"], item["name"]))


def _build_recommendations(signals: list[dict], expertise: list[dict]) -> list[dict]:
    recommendations = []
    for signal in signals:
        if signal["knowledge_gap"]:
            recommendations.append({
                "id": _stable_id("recommendation", "document", signal["topic"]),
                "type": "knowledge_gap",
                "priority": "high" if signal["ticket_count"] >= 4 else "medium",
                "title": f"Capture a {signal['label'].lower()} playbook",
                "summary": (
                    f"{signal['ticket_count']} matching tickets were found, but no related "
                    "published knowledge or runbook was detected."
                ),
                "why": signal["reason"],
                "confidence": signal["confidence"],
                "evidence_ids": [item["ticket_id"] for item in signal["evidence"]],
                "action_label": "Review pattern",
                "route": "/blueprints?tab=patterns",
                "changes_state": False,
            })
        elif signal["open_count"] >= 2:
            recommendations.append({
                "id": _stable_id("recommendation", "standardise", signal["topic"]),
                "type": "repeat_demand",
                "priority": "medium",
                "title": f"Standardise the {signal['label'].lower()} response",
                "summary": (
                    f"{signal['open_count']} active matching tickets remain. Compare the documented "
                    "procedure with the resolved evidence before creating automation."
                ),
                "why": signal["reason"],
                "confidence": signal["confidence"],
                "evidence_ids": [item["ticket_id"] for item in signal["evidence"]],
                "action_label": "Open Automation Studio",
                "route": "/workflow-automation",
                "changes_state": False,
            })
    for profile in expertise:
        if profile["top_category_count"] >= 2:
            recommendations.append({
                "id": _stable_id("recommendation", "capture", profile["id"], profile["top_category"]),
                "type": "institutional_memory",
                "priority": "medium",
                "title": f"Capture {profile['name']}'s {profile['top_category']} knowledge",
                "summary": (
                    f"{profile['name']} has {profile['top_category_count']} recorded resolved outcomes "
                    f"in {profile['top_category']}. Review them for a reusable runbook."
                ),
                "why": profile["explanation"],
                "confidence": profile["confidence"],
                "evidence_ids": [item["ticket_id"] for item in profile["recent_evidence"]],
                "action_label": "Open knowledge workspace",
                "route": "/documentation-hub?tab=library",
                "changes_state": False,
            })
    priority_order = {"high": 0, "medium": 1, "low": 2}
    return sorted(
        recommendations,
        key=lambda item: (priority_order.get(item["priority"], 9), -item["confidence"]["score"], item["title"]),
    )


def _coverage(tickets: list[dict], knowledge_count: int, runbook_count: int) -> dict:
    total = len(tickets)
    resolved = [item for item in tickets if str(item.get("status") or "").lower() in RESOLVED_STATES]
    resolved_with_evidence = [
        item for item in resolved
        if item.get("resolution_notes") or item.get("resolution") or item.get("closed_by_name")
    ]
    with_owner = [item for item in tickets if item.get("assigned_to") or item.get("assignee_id")]
    with_context = [
        item for item in tickets
        if item.get("client_id") and (item.get("device_id") or item.get("description"))
    ]

    def pct(count: int, denominator: int = total) -> int:
        return round((count / denominator) * 100) if denominator else 0

    return {
        "ticket_context_pct": pct(len(with_context)),
        "ownership_pct": pct(len(with_owner)),
        "resolution_evidence_pct": pct(len(resolved_with_evidence), len(resolved)),
        "resolved_ticket_count": len(resolved),
        "knowledge_count": knowledge_count,
        "runbook_count": runbook_count,
        "explanation": "Coverage measures recorded Nexus evidence only. Missing evidence is shown as a gap, never filled by AI.",
    }


def _search_tokens(query: str) -> list[str]:
    return [
        token for token in re.findall(r"[a-z0-9][a-z0-9._-]{1,}", query.lower())
        if token not in STOP_WORDS
    ][:12]


def _score_search_record(query: str, record: dict, fields: Iterable[str]) -> tuple[int, list[str]]:
    tokens = _search_tokens(query)
    title = _plain(record.get("title") or record.get("name") or record.get("action")).lower()
    haystack = " ".join(_plain(record.get(field)) for field in fields).lower()
    matched = [token for token in tokens if token in haystack]
    exact_bonus = 12 if query.lower().strip() and query.lower().strip() in haystack else 0
    title_bonus = sum(4 for token in matched if token in title)
    return len(matched) * 5 + title_bonus + exact_bonus, matched


async def _overview_records() -> tuple[list[dict], list[dict], list[dict]]:
    tickets, runbooks, articles = await asyncio.gather(
        db.tickets.find({}, {"_id": 0}).sort("updated_at", -1).to_list(1000),
        db.runbooks.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500),
        db.kb_articles.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500),
    )
    return tickets, runbooks, articles


@router.get("/second-brain/overview")
async def second_brain_overview(current_user: dict = Depends(get_current_user)):
    tickets, runbooks, articles = await _overview_records()
    knowledge = [*runbooks, *articles]
    signals = _build_topic_signals(tickets, knowledge)
    expertise = _build_expertise(tickets)
    recommendations = _build_recommendations(signals, expertise)
    decisions = await db.second_brain_decisions.find(
        {"user_id": current_user.get("id")}, {"_id": 0}
    ).to_list(500)
    decision_by_id = {item.get("recommendation_id"): item for item in decisions}
    for recommendation in recommendations:
        recommendation["decision"] = decision_by_id.get(recommendation["id"])

    return {
        "generated_at": _now(),
        "privacy": {
            "scope": "tenant_private",
            "cross_msp_telemetry": False,
            "statement": "Built only from this NexusMSP tenant. No client data is contributed to a shared intelligence network.",
        },
        "metrics": {
            "evidence_records": len(tickets) + len(runbooks) + len(articles),
            "patterns": len(signals),
            "knowledge_gaps": sum(1 for item in signals if item["knowledge_gap"]),
            "expertise_profiles": len(expertise),
            "recommendations": len(recommendations),
        },
        "coverage": _coverage(tickets, len(articles), len(runbooks)),
        "signals": signals,
        "expertise": expertise,
        "recommendations": recommendations,
        "source_counts": {
            "tickets": len(tickets),
            "runbooks": len(runbooks),
            "knowledge_articles": len(articles),
        },
    }


@router.post("/second-brain/search")
async def second_brain_search(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    query = str(payload.get("query") or "").strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail="Enter at least two characters to search operational memory")
    if len(query) > 240:
        raise HTTPException(status_code=400, detail="Keep memory searches under 240 characters")

    tickets, runbooks, articles, clients, audit = await asyncio.gather(
        db.tickets.find({}, {"_id": 0}).sort("updated_at", -1).to_list(600),
        db.runbooks.find({}, {"_id": 0}).sort("updated_at", -1).to_list(300),
        db.kb_articles.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500),
        db.clients.find({}, {"_id": 0}).sort("updated_at", -1).to_list(300),
        db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(500),
    )
    source_records = [
        (
            "ticket",
            tickets,
            ("title", "subject", "description", "category", "client_name", "device_name", "tags", "resolution_notes"),
            lambda item: item.get("title") or item.get("ticket_number") or "Ticket",
            lambda item: f"/tickets?ticket={item.get('id')}",
        ),
        (
            "runbook",
            runbooks,
            ("title", "name", "summary", "description", "category", "tags", "steps"),
            lambda item: item.get("title") or item.get("name") or "Runbook",
            lambda item: "/insights?tab=runbooks",
        ),
        (
            "knowledge",
            articles,
            ("title", "summary", "content", "category", "tags"),
            lambda item: item.get("title") or "Knowledge article",
            lambda item: "/documentation-hub?tab=library",
        ),
        (
            "client",
            clients,
            ("name", "email", "industry", "address", "notes"),
            lambda item: item.get("name") or "Client",
            lambda item: f"/clients?client={item.get('id')}",
        ),
        (
            "audit",
            audit,
            ("action", "target_name", "details", "actor_name", "user_name"),
            lambda item: item.get("action") or "Audit event",
            lambda item: "/audit-trail",
        ),
    ]
    results = []
    for source, records, fields, title_fn, route_fn in source_records:
        for item in records:
            score, matched = _score_search_record(query, item, fields)
            if score <= 0:
                continue
            evidence_text = " ".join(_plain(item.get(field)) for field in fields)
            results.append({
                "id": item.get("id") or item.get("slug") or _stable_id(source, title_fn(item), excerpt[:80]),
                "source": source,
                "title": title_fn(item),
                "subtitle": item.get("client_name") or item.get("category") or item.get("target_name") or "",
                "excerpt": _excerpt(evidence_text),
                "matched_terms": matched,
                "score": score,
                "route": route_fn(item),
                "timestamp": item.get("updated_at") or item.get("created_at") or item.get("timestamp"),
            })
    results.sort(key=lambda item: (-item["score"], str(item.get("timestamp") or ""), item["title"]))
    return {
        "query": query,
        "count": min(len(results), 40),
        "results": results[:40],
        "searched_sources": [item[0] for item in source_records],
        "generated_at": _now(),
        "statement": "Results are direct Nexus records ranked by matching evidence; no result was generated or inferred.",
    }


@router.post("/second-brain/recommendations/{recommendation_id}/decision")
async def decide_recommendation(
    recommendation_id: str,
    request: Request,
    payload: dict = Body(...),
    current_user: dict = Depends(get_current_user),
):
    status = str(payload.get("status") or "").strip().lower()
    if status not in {"accepted", "snoozed", "dismissed", "reset"}:
        raise HTTPException(status_code=400, detail="Decision must be accepted, snoozed, dismissed or reset")
    reason = str(payload.get("reason") or "").strip()
    if status in {"snoozed", "dismissed"} and len(reason) < 5:
        raise HTTPException(status_code=400, detail="Record a short reason so the decision remains auditable")

    if status == "reset":
        await db.second_brain_decisions.delete_one({
            "recommendation_id": recommendation_id,
            "user_id": current_user.get("id"),
        })
    else:
        record = {
            "recommendation_id": recommendation_id,
            "user_id": current_user.get("id"),
            "user_name": current_user.get("name") or current_user.get("email"),
            "status": status,
            "reason": reason,
            "updated_at": _now(),
        }
        await db.second_brain_decisions.update_one(
            {"recommendation_id": recommendation_id, "user_id": current_user.get("id")},
            {"$set": record, "$setOnInsert": {"created_at": record["updated_at"]}},
            upsert=True,
        )

    correlation_id = request_correlation_id(request)
    await db.audit_logs.insert_one({
        "id": _stable_id("audit", recommendation_id, current_user.get("id"), _now()),
        "action": "second_brain_recommendation_reviewed",
        "actor_id": current_user.get("id"),
        "actor_name": current_user.get("name") or current_user.get("email"),
        "target_id": recommendation_id,
        "details": {"status": status, "reason": reason, "external_changes": False},
        "correlation_id": correlation_id,
        "created_at": _now(),
    })
    await emit_platform_event(
        subject="intelligence.memory.reviewed",
        source="nexus.second-brain",
        payload={
            "recommendation_id": recommendation_id,
            "status": status,
            "reason": reason,
            "external_changes": False,
        },
        actor=current_user,
        correlation_id=correlation_id,
        idempotency_key=f"second-brain:{recommendation_id}:{current_user.get('id')}:{status}:{reason}",
        partition_key=str(current_user.get("tenant_id") or "nexus-local"),
    )
    return {
        "recommendation_id": recommendation_id,
        "status": status,
        "reason": reason,
        "external_changes": False,
        "correlation_id": correlation_id,
    }
