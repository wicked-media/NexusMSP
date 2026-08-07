from app.services.product_roadmap import (
    ROADMAP_ITEMS,
    ROADMAP_STATUSES,
    build_product_roadmap,
)


def test_roadmap_has_one_valid_stage_and_release_gate_per_item():
    ids = [item["id"] for item in ROADMAP_ITEMS]

    assert len(ids) == len(set(ids))
    assert {"core-platform", "agent", "automation", "microsoft", "billing", "remote"} <= set(ids)
    for item in ROADMAP_ITEMS:
        assert item["status"] in ROADMAP_STATUSES
        assert item["release_gate"]
        assert item["route"].startswith("/")


def test_roadmap_preserves_status_while_enriching_live_evidence():
    roadmap = build_product_roadmap({
        "agent": {
            "verified": True,
            "summary": "3 active agents",
            "facts": {"active_agents": 3},
        },
    })
    agent = next(item for item in roadmap["items"] if item["id"] == "agent")

    assert agent["status"] == "in_progress"
    assert agent["evidence"]["verified"] is True
    assert agent["evidence"]["facts"]["active_agents"] == 3
    assert roadmap["summary"]["total"] == len(ROADMAP_ITEMS)
    assert sum(roadmap["summary"][status] for status in ROADMAP_STATUSES) == len(ROADMAP_ITEMS)


def test_released_is_a_deliberate_baseline_not_inferred_from_evidence():
    roadmap = build_product_roadmap({
        "maps": {"verified": True, "summary": "Topology evidence exists"},
    })
    maps = next(item for item in roadmap["items"] if item["id"] == "maps")

    assert maps["evidence"]["verified"] is True
    assert maps["status"] == "planned"
    assert "never promotes" in roadmap["policy"][1]
