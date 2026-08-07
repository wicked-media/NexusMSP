import asyncio
from datetime import datetime, timezone

from app.routers.self_healing import _get_24h_timeline


def test_timeline_contains_only_recorded_events():
    now = datetime.now(timezone.utc).replace(microsecond=0)
    events = [
        {
            "detected_at": now.isoformat(),
            "healed_at": now.isoformat(),
        }
    ]

    timeline = asyncio.run(_get_24h_timeline(events))

    assert len(timeline) == 24
    assert sum(bucket["detected"] for bucket in timeline) == 1
    assert sum(bucket["healed"] for bucket in timeline) == 1
    assert all(bucket["detected"] >= 0 for bucket in timeline)
    assert all(bucket["healed"] >= 0 for bucket in timeline)


def test_empty_timeline_does_not_invent_activity():
    timeline = asyncio.run(_get_24h_timeline([]))

    assert all(bucket["detected"] == 0 for bucket in timeline)
    assert all(bucket["healed"] == 0 for bucket in timeline)
