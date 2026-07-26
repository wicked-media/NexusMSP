from datetime import datetime, timezone

from app.routers.portal_v2 import _latest_timestamp


def test_latest_timestamp_prefers_freshest_device_signal():
    result = _latest_timestamp(
        "2026-07-25T11:00:00Z",
        datetime(2026, 7, 25, 12, 30, tzinfo=timezone.utc),
        "2026-07-25T12:00:00+00:00",
    )

    assert result == "2026-07-25T12:30:00+00:00"


def test_latest_timestamp_ignores_missing_and_invalid_signals():
    assert _latest_timestamp(None, "", "not-a-timestamp") is None
