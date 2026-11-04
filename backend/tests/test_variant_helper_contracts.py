"""Contract tests for the consolidated variant helpers.

Each variant kept its own name because its edge-case behaviour is load-bearing
for the routers that use it. These tests lock those contracts so future
consolidation attempts must consciously change them.
"""

from datetime import datetime, timezone

from app.services.identity_utils import actor_label, tenant_id_or_none
from app.services.number_utils import (
    bounded_number,
    float_or_blank_default,
    float_or_default,
    float_or_default_no_bool,
    float_or_none,
    float_or_zero,
)
from app.services.time_utils import (
    parse_date_compact,
    parse_datetime_tolerant,
    parse_iso_datetime,
)


class TestFloatOrZero:
    def test_falsy_input_is_zero(self):
        assert float_or_zero(None) == 0.0
        assert float_or_zero("") == 0.0
        assert float_or_zero(0) == 0.0

    def test_parses_numbers(self):
        assert float_or_zero("1.5") == 1.5
        assert float_or_zero(3) == 3.0

    def test_unparseable_is_zero(self):
        assert float_or_zero("abc") == 0.0
        assert float_or_zero([1]) == 0.0


class TestFloatOrNone:
    def test_none_blank_and_bool_are_none(self):
        assert float_or_none(None) is None
        assert float_or_none("") is None
        assert float_or_none(True) is None
        assert float_or_none(False) is None

    def test_parses_numbers(self):
        assert float_or_none("2.5") == 2.5
        assert float_or_none(0) == 0.0

    def test_unparseable_is_none(self):
        assert float_or_none("abc") is None


class TestFloatOrDefaultNoBool:
    def test_bool_returns_default(self):
        assert float_or_default_no_bool(True) == 0.0
        assert float_or_default_no_bool(False, default=7.0) == 7.0

    def test_unparseable_returns_default(self):
        assert float_or_default_no_bool("abc", default=1.0) == 1.0

    def test_parses_numbers(self):
        assert float_or_default_no_bool("4") == 4.0


class TestFloatOrDefaultVsBlankDefault:
    def test_blank_uses_default(self):
        assert float_or_blank_default("") == 0.0
        assert float_or_default("") == 0.0

    def test_exception_paths_differ_on_default_coercion(self):
        # float_or_blank_default coerces the default; float_or_default does not.
        assert float_or_blank_default("abc", default=2) == 2.0
        assert float_or_default("abc", default=2) == 2

    def test_none_paths(self):
        assert float_or_blank_default(None, default=1.5) == 1.5
        assert float_or_default(None, default=1.5) == 1.5


class TestBoundedNumber:
    def test_in_range_rounds_to_two_places(self):
        assert bounded_number(42.126) == 42.13

    def test_out_of_range_is_none(self):
        assert bounded_number(-1) is None
        assert bounded_number(101) is None

    def test_bool_and_none_are_none(self):
        assert bounded_number(True) is None
        assert bounded_number(None) is None

    def test_custom_bounds(self):
        assert bounded_number(5, minimum=1, maximum=10) == 5.0
        assert bounded_number(50, minimum=1, maximum=10) is None


class TestTenantIdOrNone:
    def test_strips_and_normalises(self):
        assert tenant_id_or_none("  abc  ") == "abc"

    def test_blank_is_none(self):
        assert tenant_id_or_none(None) is None
        assert tenant_id_or_none("   ") is None
        assert tenant_id_or_none("") is None


class TestActorLabel:
    def test_prefers_name_then_email_then_id(self):
        assert actor_label({"name": "A", "email": "b", "id": "c"}, "X") == "A"
        assert actor_label({"email": "b", "id": "c"}, "X") == "b"
        assert actor_label({"id": "c"}, "X") == "c"

    def test_fallback_when_empty(self):
        assert actor_label({}, "X") == "X"
        assert actor_label({"name": ""}, "X") == "X"


class TestParseDateVariants:
    def test_parse_datetime_tolerant_accepts_datetimes(self):
        naive = datetime(2024, 1, 2, 3, 4, 5)
        assert parse_datetime_tolerant(naive) == naive.replace(tzinfo=timezone.utc)

    def test_parse_datetime_tolerant_dates_and_timestamps(self):
        parsed = parse_datetime_tolerant("2024-01-02")
        assert parsed == datetime(2024, 1, 2, tzinfo=timezone.utc)
        parsed = parse_datetime_tolerant("2024-01-02T03:04:05Z")
        assert parsed == datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc)

    def test_parse_datetime_tolerant_invalid(self):
        assert parse_datetime_tolerant(None) is None
        assert parse_datetime_tolerant("not-a-date") is None

    def test_parse_date_compact_truncates_bare_dates(self):
        assert parse_date_compact("2024-01-02junk") == datetime(
            2024, 1, 2, tzinfo=timezone.utc
        )
        assert parse_date_compact("") is None

    def test_parse_iso_datetime_keeps_naive_and_rejects_junk(self):
        parsed = parse_iso_datetime("2024-01-02T03:04:05")
        assert parsed == datetime(2024, 1, 2, 3, 4, 5)
        assert parsed.tzinfo is None
        # Legacy contract: fromisoformat semantics, no UTC coercion, junk is None.
        assert parse_iso_datetime("2024-01-02") == datetime(2024, 1, 2)
        assert parse_iso_datetime("junk") is None
        assert parse_iso_datetime(None) is None
