"""Certificate & Domain Intelligence — scoring and boundary tests."""

import inspect
from datetime import datetime, timedelta, timezone

import pytest

from app.routers import certificate_intel
from app.services.certificate_intelligence import (
    classify_change,
    days_until,
    expiry_risk,
    exposure_score,
    parse_timestamp,
)

NOW = datetime(2026, 10, 3, 12, 0, 0, tzinfo=timezone.utc)


def _iso(days_from_now: float) -> str:
    return (NOW + timedelta(days=days_from_now)).isoformat()


class TestExpiryRisk:
    def test_bands_are_explainable(self):
        assert expiry_risk(_iso(-1), NOW)["level"] == "expired"
        assert expiry_risk(_iso(3), NOW)["level"] == "critical"
        assert expiry_risk(_iso(20), NOW)["level"] == "high"
        assert expiry_risk(_iso(45), NOW)["level"] == "medium"
        assert expiry_risk(_iso(80), NOW)["level"] == "low"
        assert expiry_risk(_iso(200), NOW)["level"] == "ok"

    def test_unknown_expiry_is_never_safe(self):
        risk = expiry_risk(None, NOW)
        assert risk["level"] == "unknown"
        assert risk["days_remaining"] is None
        assert "no expiry evidence" in risk["reasons"][0]

    def test_malformed_timestamp_is_unknown_not_zero(self):
        assert parse_timestamp("not-a-date") is None
        assert days_until("not-a-date", NOW) is None
        assert expiry_risk("not-a-date", NOW)["level"] == "unknown"

    def test_reasons_carry_the_number(self):
        risk = expiry_risk(_iso(5), NOW)
        assert risk["days_remaining"] == 5
        assert "5 day(s) remaining" in risk["reasons"][0]


class TestDangerousChanges:
    def test_known_change_kinds_carry_explanations(self):
        for kind in ("nameserver_change", "registrar_transfer", "mx_change", "caa_change", "dangling_cname"):
            classified = classify_change(kind)
            assert classified["dangerous"] is True
            assert classified["explanation"]

    def test_unknown_change_kind_is_ignored(self):
        assert classify_change("ttl_tweak") is None
        assert classify_change("") is None


class TestPortfolioAggregation:
    def test_counts_bands_and_sorts_soonest(self):
        records = [
            {"id": "d1", "name": "a.example", "client_id": "c1", "expires_at": _iso(5)},
            {"id": "d2", "name": "b.example", "client_id": "c2", "expires_at": _iso(200)},
            {"id": "d3", "name": "c.example", "client_id": "c1", "expires_at": None},
        ]
        portfolio = exposure_score(records, NOW)
        assert portfolio["total"] == 3
        assert portfolio["counts"]["critical"] == 1  # 5 days left falls in the <=7 critical band
        assert portfolio["counts"]["ok"] == 1
        assert portfolio["counts"]["unknown"] == 1
        assert portfolio["soonest_expiries"][0]["id"] == "d1"

    def test_unreviewed_dangerous_changes_are_flagged_with_client(self):
        records = [{
            "id": "d1", "name": "a.example", "client_id": "c1", "expires_at": _iso(300),
            "changes": [
                {"kind": "nameserver_change", "observed_at": _iso(-2), "reviewed": False},
                {"kind": "mx_change", "observed_at": _iso(-1), "reviewed": True},
                {"kind": "ttl_tweak", "observed_at": _iso(-1), "reviewed": False},
            ],
        }]
        portfolio = exposure_score(records, NOW)
        changes = portfolio["unreviewed_dangerous_changes"]
        assert len(changes) == 1
        assert changes[0]["kind"] == "nameserver_change"
        assert changes[0]["client_id"] == "c1"
        assert changes[0]["explanation"]

    def test_empty_portfolio_is_safe_to_render(self):
        portfolio = exposure_score([], NOW)
        assert portfolio["total"] == 0
        assert portfolio["soonest_expiries"] == []
        assert portfolio["unreviewed_dangerous_changes"] == []


class TestRouterBoundaries:
    def test_expected_operations_exist(self):
        paths = [route.path for route in certificate_intel.router.routes]
        assert "/certificate-intel/portfolio" in paths
        assert "/certificate-intel/expiring" in paths
        assert "/certificate-intel/dangerous-changes" in paths
        assert "/certificate-intel/changes/review" in paths

    def test_review_payload_is_closed(self):
        with pytest.raises(Exception):
            certificate_intel.ChangeReview(record_id="x", kind="mx_change", rogue=1)

    def test_endpoints_authenticate_and_scope(self):
        for name in ("get_portfolio", "get_expiring", "get_dangerous_changes", "review_change"):
            sig = inspect.signature(getattr(certificate_intel, name))
            assert "current_user" in sig.parameters

    def test_normalise_maps_canonical_fields(self):
        domain = certificate_intel._normalise_record({"id": "1", "domain": "a.example", "expiry_date": "2027-01-01"}, "domain")
        assert domain["name"] == "a.example"
        assert domain["expires_at"] == "2027-01-01"
        cert = certificate_intel._normalise_record({"id": "2", "common_name": "b.example", "expiry_date": "2027-02-01"}, "certificate")
        assert cert["name"] == "b.example"
        assert cert["record_type"] == "certificate"
