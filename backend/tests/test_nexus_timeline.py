from app.services.nexus_timeline import filter_timeline_events


EVENTS = [
    {
        "id": "newest",
        "category": "asset",
        "source": "Nexus Agent",
        "title": "CPU spike detected",
        "detail": "RECEPTION-PC",
        "timestamp": "2026-07-28T09:15:00+00:00",
    },
    {
        "id": "middle",
        "category": "remote",
        "source": "Nexus Remote",
        "title": "Remote session started",
        "actor": "Aaron",
        "timestamp": "2026-07-28T09:10:00+00:00",
    },
    {
        "id": "oldest",
        "category": "automation",
        "source": "Script Library",
        "title": "Outlook repair completed",
        "status": "completed",
        "timestamp": "2026-07-28T09:05:00+00:00",
    },
]


def test_timeline_is_reverse_chronological():
    rows = filter_timeline_events(reversed(EVENTS))

    assert [row["id"] for row in rows] == ["newest", "middle", "oldest"]


def test_before_anchor_returns_only_prior_evidence():
    rows = filter_timeline_events(EVENTS, before="2026-07-28T09:10:00+00:00")

    assert [row["id"] for row in rows] == ["oldest"]


def test_category_and_search_filters_are_combined():
    rows = filter_timeline_events(
        EVENTS,
        categories=["automation", "asset"],
        search="outlook",
    )

    assert [row["id"] for row in rows] == ["oldest"]


def test_missing_timestamps_are_not_presented_as_auditable_events():
    rows = filter_timeline_events([
        *EVENTS,
        {
            "id": "undated",
            "category": "platform",
            "source": "Unknown",
            "title": "Undated claim",
            "timestamp": None,
        },
    ])

    assert "undated" not in {row["id"] for row in rows}
