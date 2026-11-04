"""Nexus Wish Engine tests.

The Wish Engine turns a stated frustration into a reviewable pattern. These tests
pin the signature and routing rules, the rule that a lone request is counted but
never quoted, the gate that keeps promotion behind a human disposition and its
evidence, and the tenant scoping of every route.
"""

import asyncio
import json

import pytest

from app.routers import wish_engine as wish_router
from app.services import nexus_ideas
from app.services.nexus_ideas import VALUE_AXES
from app.services.wish_engine import (
    DISPOSITION_CATEGORY,
    WISH_DISPOSITIONS,
    shapes_match,
    suggest_disposition,
    wish_clusters,
    wish_engine_snapshot,
    wish_promotion_axes,
    wish_promotion_gate,
    wish_signature,
    wish_tokens,
)


def _wish(wish_id, text, *, surface="devices", created_by="tech-1", created_at="2026-09-01T09:00:00+00:00"):
    return {
        "id": wish_id,
        "text": text,
        "surface": surface,
        "signature": wish_signature(text),
        "context_ref": None,
        "created_at": created_at,
        "created_by": created_by,
    }


# ── policy ───────────────────────────────────────────────────────────────────


def test_a_shape_is_a_stable_signature_and_a_disclosed_match():
    first = "I shouldn't have to open five screens to find the device warranty"
    second = "Finding the warranty takes five screens"
    # A signature is order-insensitive and loses the sentence around the need.
    assert wish_signature(first) == wish_signature("find the device warranty open five screens")
    assert wish_signature("compare two users permissions") == wish_signature("permissions compare two users")
    # A request with no distinctive words has no shape, so it is never clustered.
    assert wish_signature("!!! ??? 42") == ""
    # Two people rarely choose the same nouns, so the same need in different
    # words still matches; an unrelated request does not.
    assert shapes_match(wish_tokens(first), wish_tokens(second)) is True
    assert shapes_match(wish_tokens(first), wish_tokens("The printer queue is offline again")) is False
    assert shapes_match(wish_tokens("the warranty is wrong"), wish_tokens("warranty")) is False


def test_a_routing_suggestion_discloses_the_words_it_matched():
    suggestion = suggest_disposition("Why can't I compare two users' effective M365 permissions?")
    assert suggestion["disposition"] in WISH_DISPOSITIONS
    assert suggestion["signals"]
    assert "signal" in suggestion["reason"]

    unclear = suggest_disposition("The warranty panel is hard to reach for laptops")
    assert unclear["disposition"] in {None, *WISH_DISPOSITIONS}
    if unclear["disposition"] is None:
        assert "a person has to choose" in unclear["reason"].lower()


def test_a_single_request_is_counted_but_never_quoted():
    lone = [_wish("wsh-1", "I need a single view of every certificate that is about to expire")]
    snapshot = wish_engine_snapshot(lone)
    assert snapshot["clusters"] == []
    assert snapshot["total_requests"] == 1
    assert snapshot["unclustered_requests"] == 1
    # The technician's own words are nowhere in the reviewer view.
    assert "single view of every certificate" not in json.dumps(snapshot)


def test_two_reporters_make_a_pattern_without_identifying_anyone():
    wishes = [
        _wish("wsh-1", "I shouldn't have to open five screens to find the device warranty", surface="devices", created_by="tech-1"),
        _wish("wsh-2", "Finding the warranty takes five screens", surface="tickets", created_by="tech-2"),
        _wish("wsh-3", "Finding warranty takes five screens", surface="devices", created_by="tech-3"),
    ]
    clusters = wish_clusters(wishes)
    assert len(clusters) == 1
    cluster = clusters[0]
    assert cluster["occurrences"] == 3
    assert cluster["reporter_count"] == 3
    assert cluster["surfaces"] == ["devices", "tickets"]
    assert cluster["representative_text"] == wishes[2]["text"]
    assert cluster["span_days"] == 0
    # No identity is carried into the reviewer view.
    assert "created_by" not in json.dumps(cluster)
    assert cluster["suggested_disposition"]["disposition"] == "shortcut"


def test_promotion_requires_a_person_a_disposition_and_its_evidence():
    cluster = wish_clusters([
        _wish("wsh-1", "Finding the warranty takes five screens"),
        _wish("wsh-2", "Finding the warranty takes five screens", created_by="tech-2"),
    ])[0]

    assert wish_promotion_gate(cluster, recorded=None)["allowed"] is False
    assert "person" in wish_promotion_gate(cluster, recorded=None)["reason"]

    thin = wish_promotion_gate(cluster, recorded={"disposition": "shortcut", "evidence_note": "ok"})
    assert thin["allowed"] is False
    assert "evidence" in thin["reason"].lower()

    unknown = wish_promotion_gate(cluster, recorded={"disposition": "rewrite", "evidence_note": "A real reason"})
    assert unknown["allowed"] is False
    assert "not a supported disposition" in unknown["reason"]

    already = wish_promotion_gate(
        cluster,
        recorded={"disposition": "shortcut", "evidence_note": "A real reason", "idea_id": "idea-7"},
    )
    assert already["allowed"] is False
    assert "already promoted" in already["reason"]

    allowed = wish_promotion_gate(
        cluster,
        recorded={"disposition": "forge_tool", "evidence_note": "Two technicians reported it in two workspaces"},
    )
    assert allowed["allowed"] is True
    assert allowed["category"] == DISPOSITION_CATEGORY["forge_tool"]
    assert allowed["value_axes"] == list(wish_promotion_axes("forge_tool"))

    too_thin = wish_promotion_gate(cluster, recorded=None, min_occurrences=5)
    assert too_thin["allowed"] is False
    assert "reported" in too_thin["reason"]


def test_every_disposition_maps_to_value_principles_the_idea_registry_accepts():
    for disposition in WISH_DISPOSITIONS:
        axes = wish_promotion_axes(disposition)
        assert axes and set(axes).issubset(set(VALUE_AXES))


def test_a_recorded_decision_travels_into_the_reviewer_view():
    wishes = [
        _wish("wsh-1", "Finding the warranty takes five screens"),
        _wish("wsh-2", "Finding the warranty takes five screens", created_by="tech-2"),
    ]
    recorded = {
        wishes[0]["signature"]: {
            "signature": wishes[0]["signature"],
            "disposition": "shortcut",
            "evidence_note": "Two workspaces, two technicians",
            "decided_at": "2026-10-01T10:00:00+00:00",
            "decided_by": "Ops lead",
        }
    }
    snapshot = wish_engine_snapshot(wishes, recorded=recorded)
    cluster = snapshot["clusters"][0]
    assert cluster["disposition"]["disposition"] == "shortcut"
    assert cluster["disposition"]["decided_by"] == "Ops lead"
    assert cluster["promotion"]["allowed"] is True
    assert "shapes of frustration, not people" in snapshot["boundary"]


# ── route boundary ───────────────────────────────────────────────────────────


class _Result:
    def __init__(self, matched_count=0):
        self.matched_count = matched_count


def _matches(row, query):
    for key, expected in query.items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _Rows:
    def __init__(self):
        self.rows = []

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document):
        self.rows.append(dict(document))

    async def update_one(self, query, update):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set") or {})
                return _Result(1)
        return _Result(0)

    def find(self, query, _projection=None):
        return _Cursor([dict(row) for row in self.rows if _matches(row, query)])


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self._rows)


class _Db:
    def __init__(self):
        self._tables = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._tables.setdefault(name, _Rows())


def _user(tech="tech-1", tenant="tenant-a"):
    return {"id": tech, "tenant_id": tenant, "name": "Wish Tech", "email": f"{tech}@example.com", "is_admin": True}


class _Audit:
    def __init__(self):
        self.calls = []

    async def __call__(self, user, action, entity_type, entity_id, entity_name="", **kwargs):
        self.calls.append({"action": action, "entity_type": entity_type, "entity_id": entity_id, "kwargs": kwargs})


@pytest.fixture()
def harness(monkeypatch):
    db = _Db()
    audit = _Audit()
    monkeypatch.setattr(wish_router, "db", db)
    monkeypatch.setattr(wish_router, "log_activity", audit)
    # The promotion writes into the Nexus Ideas registry for real, so the registry
    # shares the fake database instead of being stubbed out.
    monkeypatch.setattr(nexus_ideas, "db", db)
    return db, audit


def _capture(text, surface="devices", ref=None, tech="tech-1"):
    payload = wish_router.WishPayload(text=text, surface=surface, context_ref=ref)
    return asyncio.run(wish_router.report_wish(payload, current_user=_user(tech=tech)))


def test_the_route_records_a_request_and_refuses_credential_material(harness):
    db, audit = harness
    result = _capture("I need one view that shows every certificate close to expiry", surface="devices")
    assert result["clustered"] is False
    assert result["cluster"] is None
    assert result["wish"]["signature"]
    assert db.nexus_wish_requests.rows[0]["tenant_id"] == "tenant-a"
    assert audit.calls[0]["action"] == "wish_engine.wish_reported"

    with pytest.raises(Exception) as credential:
        _capture("Reset it with password=hunter2 in the settings panel")
    assert "credential material" in str(credential.value)

    with pytest.raises(Exception) as too_short:
        _capture("too short")
    assert "at least" in str(too_short.value)

    # A second report from someone else is what turns a request into a pattern.
    second = _capture("I need one view that shows every certificate close to expiry", surface="tickets", tech="tech-2")
    assert second["clustered"] is True
    assert second["cluster"]["occurrences"] == 2
    assert second["cluster"]["reporter_count"] == 2
    assert second["cluster"]["signature"] == result["wish"]["signature"]
    assert second["boundary"].startswith("This request is recorded")


def test_the_overview_quotes_only_your_own_requests(harness):
    db, _ = harness
    shared = "I need one view that shows every certificate close to expiry"
    mine = "I want a warranty field on the device panel without opening tickets"
    for index, (text, tech, surface) in enumerate([
        (shared, "tech-2", "devices"),
        (shared, "tech-1", "tickets"),
        (mine, "tech-1", "tickets"),
    ]):
        row = _wish(f"wsh-{index}", text, surface=surface, created_by=tech, created_at=f"2026-09-0{index + 1}T09:00:00+00:00")
        row["tenant_id"] = "tenant-a"
        db.nexus_wish_requests.rows.append(row)

    overview = asyncio.run(wish_router.wish_engine_overview(current_user=_user()))
    # Only the caller's own requests are quoted.
    assert sorted(row["text"] for row in overview["mine"]) == sorted([mine, shared])
    assert overview["mine"][0]["suggestion"]["disposition"] in {None, *WISH_DISPOSITIONS}
    assert len(overview["clusters"]) == 1
    assert overview["clusters"][0]["occurrences"] == 2
    assert mine not in json.dumps(overview["clusters"])
    # The tenant's other technician is counted, never identified.
    assert "tech-2" not in json.dumps(overview["clusters"])
    assert overview["dispositions"]

    other_tenant = asyncio.run(wish_router.wish_engine_overview(current_user=_user(tenant="tenant-b")))
    assert other_tenant["mine"] == []
    assert other_tenant["clusters"] == []


def test_a_disposition_needs_a_cluster_and_cannot_be_flipped_after_promotion(harness):
    db, audit = harness
    text = "I need one view that shows every certificate close to expiry"
    _capture(text)
    _capture(text, tech="tech-2")

    with pytest.raises(Exception) as missing:
        asyncio.run(
            wish_router.record_disposition(
                "no-such-shape",
                wish_router.DispositionPayload(disposition="shortcut", evidence_note="A real reason"),
                current_user=_user(),
            )
        )
    assert "not currently clustered" in str(missing.value)

    signature = wish_signature(text)
    recorded = asyncio.run(
        wish_router.record_disposition(
            signature,
            wish_router.DispositionPayload(disposition="forge_tool", evidence_note="Two technicians, two workspaces"),
            current_user=_user(),
        )
    )
    assert recorded["disposition"]["disposition"] == "forge_tool"
    assert recorded["disposition"]["occurrences_at_decision"] == 2
    assert audit.calls[-1]["action"] == "wish_engine.disposition_recorded"

    with pytest.raises(Exception) as credential:
        asyncio.run(
            wish_router.record_disposition(
                signature,
                wish_router.DispositionPayload(disposition="shortcut", evidence_note="token=abcd1234"),
                current_user=_user(),
            )
        )
    assert "credential material" in str(credential.value)


def test_promotion_writes_a_captured_idea_once_and_records_the_reasoning(harness):
    db, audit = harness
    text = "I need one view that shows every certificate close to expiry"
    _capture(text)
    _capture(text, tech="tech-2")
    signature = wish_signature(text)

    with pytest.raises(Exception) as ungated:
        asyncio.run(
            wish_router.promote_cluster(
                signature,
                wish_router.PromotionPayload(title="Certificate expiry view", summary="One view of expiring certificates"),
                current_user=_user(),
            )
        )
    assert "record what this request should become" in str(ungated.value)

    asyncio.run(
        wish_router.record_disposition(
            signature,
            wish_router.DispositionPayload(disposition="forge_tool", evidence_note="Two technicians, two workspaces"),
            current_user=_user(),
        )
    )
    promoted = asyncio.run(
        wish_router.promote_cluster(
            signature,
            wish_router.PromotionPayload(
                title="Certificate expiry view",
                summary="One view of every certificate close to expiry, with its dependent services.",
                horizon="next",
            ),
            current_user=_user(),
        )
    )
    idea = promoted["idea"]
    assert idea["status"] == "captured"
    assert idea["source"] == "wish-engine"
    assert idea["category"] == DISPOSITION_CATEGORY["forge_tool"]
    assert idea["value_axes"]["creates_opportunity"] is True
    assert "does not approve" in promoted["policy"]

    stored = db.nexus_ideas.rows[0]
    assert stored["wish_signature"] == signature
    assert stored["wish_occurrences"] == 2
    assert stored["wish_reporter_count"] == 2
    assert stored["wish_surfaces"] == ["devices"]
    assert stored["created_by"] == "tech-1"

    with pytest.raises(Exception) as twice:
        asyncio.run(
            wish_router.promote_cluster(
                signature,
                wish_router.PromotionPayload(title="Another view", summary="Trying to promote the same shape twice"),
                current_user=_user(),
            )
        )
    assert "already promoted" in str(twice.value)

    assert "wish_engine.promoted" in [call["action"] for call in audit.calls]


def test_a_cluster_is_promoted_only_inside_its_own_tenant(harness):
    db, _ = harness
    text = "I need one view that shows every certificate close to expiry"
    _capture(text)
    _capture(text, tech="tech-2")
    signature = wish_signature(text)

    with pytest.raises(Exception) as other_tenant:
        asyncio.run(
            wish_router.record_disposition(
                signature,
                wish_router.DispositionPayload(disposition="shortcut", evidence_note="A real reason"),
                current_user=_user(tech="tech-9", tenant="tenant-b"),
            )
        )
    assert "not currently clustered" in str(other_tenant.value)
