"""Nexus Technician Wish Engine — the unmet need, stated by the person doing the work.

Every MSP platform is built from what its vendor *assumed* technicians would
need. The Wish Engine inverts that: a technician states the frustration in one
line ("I shouldn't have to open five screens to find the device's warranty"),
Nexus keeps the product context it was clicked from, and then groups identical
shapes of frustration into a pattern that can be scored and routed.

Three rules keep it honest:

* **A request is a claim, not a measurement.** Nexus reports how often the same
  shape was reported, by how many different people, over what span, and from
  which surfaces. It never converts that into a saving figure.
* **A single request is not a pattern.** Text is only ever surfaced to reviewers
  once at least two people reported the same shape, so the queue is a shared-need
  list rather than a window onto an individual's opinions. An author always sees
  their own text.
* **Nexus suggests, a human decides.** The routing rule proposes a disposition
  and discloses exactly which words matched; nothing is promoted into the Nexus
  Ideas registry until a person records a disposition and the reasoning behind it.

Everything here is pure and deterministic so the rules are directly testable;
database access lives in `app/routers/wish_engine.py`.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Iterable

# ── Vocabulary ───────────────────────────────────────────────────────────────

# What an unmet need can actually turn into. The last one is the honest answer
# for most good requests: nothing Nexus serves covers this yet.
WISH_DISPOSITIONS: tuple[str, ...] = (
    "shortcut",
    "product_change",
    "automation",
    "forge_tool",
    "documentation",
)

DISPOSITION_MEANING: dict[str, str] = {
    "shortcut": "The capability exists but takes too many steps or lives in the wrong place.",
    "product_change": "The capability does not exist, or does not match how the work is actually done.",
    "automation": "The work should not need a person to repeat it at all.",
    "forge_tool": "No Nexus capability covers this yet; it needs a Forge design request.",
    "documentation": "The answer exists but is not discoverable where the technician needs it.",
}

# The Nexus Ideas registry groups product work by category, so the disposition is
# translated rather than passed through verbatim.
DISPOSITION_CATEGORY: dict[str, str] = {
    "shortcut": "experience",
    "product_change": "product",
    "automation": "automation",
    "forge_tool": "forge",
    "documentation": "documentation",
}

# The Nexus Ideas registry requires at least one value principle per idea, so the
# disposition decides which principles the promotion can defend.
DISPOSITION_VALUE_AXES: dict[str, tuple[str, ...]] = {
    "shortcut": ("saves_time", "reduces_stress"),
    "product_change": ("saves_time", "increases_confidence"),
    "automation": ("saves_time", "creates_opportunity"),
    "forge_tool": ("creates_opportunity", "increases_confidence"),
    "documentation": ("reduces_stress", "increases_confidence"),
}

# Text limits. A wish is one sentence of frustration, not a specification.
WISH_MIN_TEXT = 12
WISH_MAX_TEXT = 400
WISH_MAX_SURFACE = 48
WISH_MAX_CONTEXT_REF = 120

# ── Clustering ───────────────────────────────────────────────────────────────

# Two people asking for the same thing is a pattern; one person asking is an
# opinion. This threshold is what keeps the review queue a shared-need list.
WISH_CLUSTER_MIN_OCCURRENCES = 2
MAX_CLUSTERS = 40

# Free-text matching: a request joins a pattern when it shares at least this many
# distinctive words and covers this much of the shorter request's vocabulary.
MIN_SHARED_TOKENS = 2
MIN_SIMILARITY = 0.6

_TOKEN_LIMIT = 10
_TOKEN_PATTERN = re.compile(r"[a-z]+")

# Words that describe the *sentence*, not the need. Dropping them lets "I
# shouldn't have to open five screens to find warranty" and "finding warranty
# takes too many screens" collapse into one shape.
WISH_NOISE_TOKENS = frozenset({
    "a", "about", "after", "again", "all", "also", "am", "an", "and", "any",
    "are", "as", "at", "be", "because", "been", "before", "being", "but", "by",
    "can", "cant", "could", "did", "do", "does", "doing", "dont", "each",
    "every", "for", "from", "get", "getting", "had", "has", "have", "having",
    "how", "i", "if", "in", "into", "is", "it", "its", "just", "keeps", "like",
    "me", "more", "most", "much", "must", "my", "need", "needs", "no", "not",
    "now", "of", "on", "only", "or", "other", "our", "out", "over", "please",
    "really", "should", "shouldn", "shouldnt", "so", "some", "still", "such",
    "take", "takes", "than", "that", "the", "their", "them", "then", "there",
    "these", "they", "thing", "this", "those", "through", "to", "too", "tried",
    "up", "us", "using", "very", "want", "was", "way", "we", "were", "what",
    "when", "where", "which", "while", "why", "will", "with", "without",
    "would", "you", "your",
})

# ── Routing ──────────────────────────────────────────────────────────────────

# Ordered suggestions. The first rule with the most matching signals wins, and
# every match is disclosed so a reviewer can disagree with the reasoning rather
# than with an opaque score.
ROUTING_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "shortcut",
        (
            "click", "clicks", "hop", "hops", "menu", "navigate", "navigation",
            "open", "opens", "opening", "screen", "screens", "tab", "tabs",
            "buried", "scattered", "five screens", "six screens",
        ),
    ),
    (
        "automation",
        (
            "automate", "automated", "automatically", "batch", "each time",
            "every time", "manually", "repeatedly", "scheduled", "ticket after ticket",
        ),
    ),
    (
        "forge_tool",
        (
            "across every", "across all", "audit", "build a tool", "compare",
            "detect", "generate", "list every", "report", "single view", "tool",
            "view that shows",
        ),
    ),
    (
        "documentation",
        (
            "document", "documentation", "docs", "explain", "training",
            "runbook", "where do i find",
        ),
    ),
    (
        "product_change",
        (
            "broken", "cannot", "doesn", "doesnt", "missing", "should not",
            "shouldn", "shouldnt", "wrong", "add a", "needs to know",
        ),
    ),
)


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def wish_tokens(text: str) -> frozenset[str]:
    """The distinctive words in a stated frustration, with the sentence removed."""
    return frozenset(
        token
        for token in _TOKEN_PATTERN.findall(str(text or "").lower())
        if token not in WISH_NOISE_TOKENS and len(token) > 2
    )


def wish_signature(text: str) -> str:
    """Reduce a stated frustration to a stable shape.

    Letters only, noise removed, longest-ten distinctive tokens, sorted so the
    order of a sentence cannot change its signature. An empty signature means the
    request carried no distinctive words, and it is never clustered.
    """
    tokens = wish_tokens(text)
    if not tokens:
        return ""
    ordered = sorted(tokens, key=lambda token: (-len(token), token))[:_TOKEN_LIMIT]
    return " ".join(sorted(ordered))


def shapes_match(left: frozenset[str], right: frozenset[str]) -> bool:
    """Whether two requests describe the same need in different words.

    Free text is not a title, so exact-token equality is too brittle: two people
    describing one need rarely choose the same nouns. These two rules are the
    whole similarity model, so they are deliberately narrow and disclosed.
    """
    if not left or not right:
        return False
    shared = left & right
    if len(shared) < MIN_SHARED_TOKENS:
        return False
    return len(shared) / min(len(left), len(right)) >= MIN_SIMILARITY


def _rule_matches(text: str, needles: tuple[str, ...]) -> list[str]:
    haystack = f" {str(text or '').lower()} "
    return [needle for needle in needles if needle in haystack]


def suggest_disposition(text: str) -> dict[str, Any]:
    """Propose what one request should become, disclosing the matched words.

    Returns ``disposition=None`` when no rule matched, because inventing a
    category is worse than asking a person to choose one.
    """
    scored: list[tuple[int, int, str, list[str]]] = []
    for index, (disposition, needles) in enumerate(ROUTING_RULES):
        matches = _rule_matches(text, needles)
        if matches:
            scored.append((len(matches), -index, disposition, matches))
    if not scored:
        return {
            "disposition": None,
            "signals": [],
            "reason": "No routing signal matched this request; a person has to choose what it becomes.",
        }
    scored.sort(reverse=True)
    count, _, disposition, signals = scored[0]
    return {
        "disposition": disposition,
        "signals": signals[:6],
        "reason": f"{count} signal(s) in the request text point at {disposition.replace('_', ' ')}.",
    }


def _aggregate_suggestion(texts: Iterable[str]) -> dict[str, Any]:
    """Suggest a disposition for a whole cluster, not one sentence of it."""
    totals: dict[str, int] = {}
    signals: dict[str, list[str]] = {}
    for text in texts:
        suggestion = suggest_disposition(text)
        disposition = suggestion["disposition"]
        if not disposition:
            continue
        totals[disposition] = totals.get(disposition, 0) + max(len(suggestion["signals"]), 1)
        bucket = signals.setdefault(disposition, [])
        for signal in suggestion["signals"]:
            if signal not in bucket:
                bucket.append(signal)
    if not totals:
        return {
            "disposition": None,
            "signals": [],
            "reason": "No request in this cluster matched a routing rule; a person has to choose what it becomes.",
        }
    order = {disposition: index for index, (disposition, _) in enumerate(ROUTING_RULES)}
    best = sorted(totals.items(), key=lambda item: (-item[1], order.get(item[0], 99)))[0][0]
    return {
        "disposition": best,
        "signals": signals.get(best, [])[:8],
        "reason": f"Routing signals from {totals[best]} request(s) in this cluster point at {best.replace('_', ' ')}.",
    }


def wish_clusters(
    wishes: Iterable[dict[str, Any]],
    *,
    min_occurrences: int = WISH_CLUSTER_MIN_OCCURRENCES,
    max_clusters: int = MAX_CLUSTERS,
) -> list[dict[str, Any]]:
    """Group identical shapes of frustration into reviewable patterns.

    Only shapes reported at least ``min_occurrences`` times are returned, so the
    queue never exposes a single person's text. Each cluster reports counts,
    surfaces, span and reporter count — never an identity.

    A cluster is named by the shape of the request that **first reported it**, so
    the identity of a pattern never shifts as more people report it. Requests are
    read earliest-first, and a request joins an existing pattern when it describes
    the same need in different words.
    """
    ordered = sorted(
        (row for row in wishes if isinstance(row, dict)),
        key=lambda row: str(row.get("created_at") or ""),
    )
    buckets: list[dict[str, Any]] = []
    for wish in ordered:
        text = str(wish.get("text") or "").strip()
        signature = str(wish.get("signature") or "").strip() or wish_signature(text)
        tokens = wish_tokens(text)
        if not signature or not tokens:
            continue
        bucket = next(
            (item for item in buckets if any(shapes_match(tokens, member) for member in item["member_tokens"])),
            None,
        )
        if bucket is None:
            bucket = {
                "signature": signature,
                "member_tokens": [],
                "member_signatures": set(),
                "texts": [],
                "reporter_ids": set(),
                "surfaces": set(),
                "created": [],
                "latest": "",
                "latest_at": None,
            }
            buckets.append(bucket)
        bucket["member_tokens"].append(tokens)
        bucket["member_signatures"].add(signature)
        bucket["texts"].append(text)
        surface = str(wish.get("surface") or "").strip().lower()
        if surface:
            bucket["surfaces"].add(surface)
        reporter = str(wish.get("created_by") or "").strip()
        if reporter:
            bucket["reporter_ids"].add(reporter)
        created_at = str(wish.get("created_at") or "")
        if created_at:
            bucket["created"].append(created_at)
            if bucket["latest_at"] is None or created_at >= str(bucket["latest_at"]):
                bucket["latest_at"] = created_at
                bucket["latest"] = text
        elif not bucket["latest"]:
            bucket["latest"] = text

    clusters: list[dict[str, Any]] = []
    for bucket in buckets:
        occurrences = len(bucket["texts"])
        if occurrences < min_occurrences:
            continue
        spans = [parsed for parsed in (_parse_ts(value) for value in bucket["created"]) if parsed]
        first_seen = min(spans).isoformat() if spans else None
        last_seen = max(spans).isoformat() if spans else bucket["latest_at"]
        span_days = (max(spans) - min(spans)).days if len(spans) > 1 else 0
        clusters.append(
            {
                "signature": bucket["signature"],
                "occurrences": occurrences,
                "reporter_count": len(bucket["reporter_ids"]) or occurrences,
                "surfaces": sorted(bucket["surfaces"])[:8],
                "member_signatures": sorted(bucket["member_signatures"])[:6],
                "representative_text": bucket["latest"],
                "first_seen_at": first_seen,
                "last_seen_at": last_seen,
                "span_days": span_days,
                "suggested_disposition": _aggregate_suggestion(bucket["texts"]),
            }
        )
    clusters.sort(key=lambda item: (-item["occurrences"], -(item["span_days"] or 0), item["signature"]))
    return clusters[:max_clusters]


# ── Promotion into the Nexus Ideas registry ──────────────────────────────────


def wish_promotion_axes(disposition: str) -> tuple[str, ...]:
    """Value principles a promotion can defend, derived from the disposition."""
    return DISPOSITION_VALUE_AXES.get(str(disposition or "").strip().lower(), ("saves_time",))


def wish_promotion_gate(
    cluster: dict[str, Any],
    *,
    recorded: dict[str, Any] | None,
    min_occurrences: int = WISH_CLUSTER_MIN_OCCURRENCES,
) -> dict[str, Any]:
    """Whether one reviewed cluster may be written into the Nexus Ideas registry.

    Three things are required and none of them can be produced by Nexus alone: a
    person's disposition, the reasoning behind it, and enough shared evidence that
    the request is a pattern rather than one technician's preference.
    """
    if int(cluster.get("occurrences") or 0) < int(min_occurrences):
        return {
            "allowed": False,
            "reason": (
                f"This shape has been reported {int(cluster.get('occurrences') or 0)} time(s); "
                f"promotion needs at least {int(min_occurrences)}."
            ),
        }
    if not recorded or not str(recorded.get("disposition") or "").strip():
        return {
            "allowed": False,
            "reason": "A person has to record what this request should become before it can be promoted.",
        }
    disposition = str(recorded["disposition"]).strip().lower()
    if disposition not in WISH_DISPOSITIONS:
        return {"allowed": False, "reason": f"{disposition!r} is not a supported disposition."}
    note = str(recorded.get("evidence_note") or "").strip()
    if len(note) < 5:
        return {"allowed": False, "reason": "Record the evidence behind the disposition before promoting it."}
    if recorded.get("idea_id"):
        return {
            "allowed": False,
            "reason": f"This request was already promoted to the idea registry as {recorded.get('idea_id')}.",
        }
    return {
        "allowed": True,
        "reason": "A reviewed disposition with recorded evidence covers a shared pattern.",
        "disposition": disposition,
        "category": DISPOSITION_CATEGORY.get(disposition, "general"),
        "value_axes": list(wish_promotion_axes(disposition)),
    }


def wish_engine_snapshot(
    wishes: Iterable[dict[str, Any]],
    *,
    recorded: dict[str, dict[str, Any]] | None = None,
    min_occurrences: int = WISH_CLUSTER_MIN_OCCURRENCES,
) -> dict[str, Any]:
    """Build the reviewer view: shared patterns, plus a count of lone requests.

    Lone requests are counted, never quoted — their text stays with the person who
    wrote it until someone else reports the same shape.
    """
    rows = [row for row in wishes if isinstance(row, dict)]
    clusters = wish_clusters(rows, min_occurrences=min_occurrences)
    decisions = recorded or {}
    clustered_requests = 0
    for cluster in clusters:
        decision = decisions.get(cluster["signature"])
        cluster["disposition"] = (
            {
                "disposition": decision.get("disposition"),
                "evidence_note": decision.get("evidence_note"),
                "decided_at": decision.get("decided_at"),
                "decided_by": decision.get("decided_by"),
                "occurrences_at_decision": decision.get("occurrences_at_decision"),
                "reporter_count_at_decision": decision.get("reporter_count_at_decision"),
                "idea_id": decision.get("idea_id"),
                "idea_title": decision.get("idea_title"),
                "promoted_at": decision.get("promoted_at"),
            }
            if decision
            else None
        )
        cluster["promotion"] = wish_promotion_gate(
            cluster, recorded=decision, min_occurrences=min_occurrences
        )
        clustered_requests += cluster["occurrences"]
    return {
        "clusters": clusters,
        "total_requests": len(rows),
        "clustered_requests": clustered_requests,
        "unclustered_requests": max(len(rows) - clustered_requests, 0),
        "cluster_min_occurrences": int(min_occurrences),
        "dispositions": [
            {"id": item, "meaning": DISPOSITION_MEANING[item]} for item in WISH_DISPOSITIONS
        ],
        "boundary": (
            "The Wish Engine reports shapes of frustration, not people. Text is shown to reviewers only once at "
            "least two technicians reported the same shape; lone requests are counted and stay with their author. "
            "Nexus suggests a routing and a person decides, and nothing reaches the idea registry without a "
            "recorded disposition, its evidence, and a release gate."
        ),
    }
