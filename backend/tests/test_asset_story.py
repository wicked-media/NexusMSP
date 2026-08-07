from datetime import datetime, timezone

from app.routers.asset_story import build_asset_story, document_matches_asset
from app.services.action_permissions import ACTION_PERMISSION_IDS, default_permissions_for_role
from app.services.platform_foundation import EVENT_SUBJECTS


NOW = datetime(2026, 7, 29, tzinfo=timezone.utc)


def _device(**overrides):
    return {
        "id": "dev-001",
        "name": "CLIENT-LT-01",
        "client_id": "client-001",
        "client_name": "Example Client",
        "device_type": "laptop",
        "serial_number": "SER-001",
        "manufacturer": "Lenovo",
        "model": "ThinkPad",
        "assigned_user": "Taylor",
        "location": "Sydney",
        "status": "online",
        "created_at": "2023-01-10T00:00:00+00:00",
        **overrides,
    }


def test_commercial_match_requires_attributable_asset_evidence():
    kwargs = {
        "device_id": "dev-001",
        "asset_id": "asset-001",
        "serial_number": "SER-001",
        "ticket_ids": {"ticket-001"},
        "purchase_order_number": "",
    }
    assert document_matches_asset(
        {"line_items": [{"device_id": "dev-001"}]},
        **kwargs,
    )
    assert document_matches_asset(
        {"ticket_id": "ticket-001", "line_items": []},
        **kwargs,
    )
    assert not document_matches_asset(
        {"client_id": "client-001", "line_items": [{"name": "Unrelated service"}]},
        **kwargs,
    )


def test_asset_story_explains_replacement_without_inventing_quote():
    asset = {
        "id": "asset-001",
        "device_id": "dev-001",
        "asset_tag": "AST-001",
        "purchase_date": "2022-07-01",
        "purchase_cost": 2400,
        "vendor": "Distributor",
        "warranty_end": "2025-07-01",
        "expected_lifespan_months": 36,
        "lifecycle_stage": "active",
        "history": [],
    }
    tickets = [
        {"id": f"ticket-{index}", "created_at": f"2026-07-{10 + index:02d}T09:00:00+00:00", "title": "Device issue"}
        for index in range(3)
    ]
    story = build_asset_story(
        _device(disk_usage=95, alerts_count=2),
        asset,
        tickets,
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        matched_by="device_id",
        now=NOW,
    )
    assert story["replacement"]["band"] == "replace"
    assert story["replacement"]["replacement_quote"] is None
    assert "not treated as a current replacement estimate" in story["replacement"]["financial_comparison"]
    assert any("Warranty expired" in reason for reason in story["replacement"]["reasons"])
    assert any("Disk utilisation" in reason for reason in story["replacement"]["reasons"])
    assert story["operations"]["tickets_90d"] == 3


def test_story_labels_missing_evidence_instead_of_guessing():
    story = build_asset_story(
        _device(serial_number="", manufacturer="", model="", assigned_user="", location=""),
        None,
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        now=NOW,
    )
    assert story["connection"]["connected"] is False
    assert story["replacement"]["band"] == "not_assessed"
    assert story["replacement"]["historical_purchase_cost"] is None
    assert story["replacement"]["replacement_quote"] is None
    assert story["commercial_links"] == []
    assert set(story["evidence"]["missing"]) >= {"Identity", "Procurement", "Warranty", "Commercial"}


def test_accepted_quote_is_kept_separate_from_historical_cost():
    story = build_asset_story(
        _device(),
        {
            "id": "asset-001",
            "device_id": "dev-001",
            "purchase_date": "2025-01-01",
            "purchase_cost": 1500,
            "warranty_end": "2028-01-01",
            "expected_lifespan_months": 36,
            "history": [],
        },
        [],
        [],
        [{"id": "quote-001", "status": "accepted", "total": 2100, "created_at": "2026-07-01"}],
        [],
        [],
        [],
        [],
        [],
        matched_by="device_id",
        now=NOW,
    )
    assert story["replacement"]["historical_purchase_cost"] == 1500
    assert story["replacement"]["replacement_quote"] == 2100
    assert "accepted quote" in story["replacement"]["financial_comparison"]


def test_routine_agent_events_are_collapsed_in_connected_history():
    story = build_asset_story(
        _device(),
        None,
        [],
        [],
        [],
        [],
        [],
        [],
        [
            {"id": "event-1", "event_type": "agent_check_in", "timestamp": "2026-07-29T08:00:00+00:00"},
            {"id": "event-2", "event_type": "agent_check_in", "timestamp": "2026-07-29T07:00:00+00:00"},
            {"id": "event-3", "event_type": "patch_applied", "timestamp": "2026-07-29T06:00:00+00:00"},
        ],
        [],
        now=NOW,
    )
    technical = [item for item in story["timeline"] if item["category"] == "technical"]
    assert [item["title"] for item in technical].count("Agent Check In") == 1
    assert any(item["title"] == "Patch Applied" for item in technical)


def test_asset_story_permission_and_event_are_part_of_platform_contract():
    assert "asset.lifecycle.manage" in ACTION_PERMISSION_IDS
    assert "asset.lifecycle.manage" in default_permissions_for_role("technician")
    assert "asset.lifecycle.manage" in default_permissions_for_role("service_desk_manager")
    assert "asset.lifecycle.manage" in default_permissions_for_role("admin")
    subjects = {item["subject"] for item in EVENT_SUBJECTS}
    assert "asset.story.connected" in subjects
