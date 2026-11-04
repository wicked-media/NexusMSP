"""Nexus Guardian adaptive scoring and tenant-scoped feedback boundaries."""

import asyncio
import inspect

import pytest

from app.routers import nexus_guardian
from app.services.nexus_guardian import (
    adaptive_suggestions,
    defender_posture,
    learn_from_feedback,
    rank_queue,
    score_alert,
)


class TestAdaptiveScoring:
    def test_severity_sets_the_floor_and_factors_are_explained(self):
        result = score_alert(
            {
                "id": "a1",
                "severity": "high",
                "factors": ["persistence_mechanism", "scheduled_scanner"],
            }
        )
        assert result["score"] == 70 + 15 - 10
        joined = " ".join(result["reasons"])
        assert "base severity high (70)" in joined
        assert "persistence_mechanism (+15)" in joined
        assert "scheduled_scanner (-10)" in joined

    def test_scores_are_clamped_to_0_100(self):
        huge = score_alert({"id": "a2", "severity": "critical", "factors": [
            "defender_realtime", "multiple_detections", "persistence_mechanism",
            "credential_access", "lateral_movement", "unsigned_binary", "newly_observed_path",
        ], "asset_criticality": "critical"})
        assert 0 <= huge["score"] <= 100

    def test_learned_weights_apply_but_stay_bounded(self):
        profile = {"signal_weights": {"powershell_download": 25}}
        alert = {"id": "a3", "severity": "medium", "signal": "powershell_download"}
        result = score_alert(alert, profile)
        assert result["score"] == 45 + 25
        # Bounded learning: repeated feedback cannot exceed +/-25
        p = {}
        for _ in range(20):
            p = learn_from_feedback(p, "powershell_download", "false_positive")
        assert p["signal_weights"]["powershell_download"] == -25
        assert p["disposition_counts"]["powershell_download"]["false_positive"] == 20

    def test_unknown_disposition_is_rejected(self):
        with pytest.raises(ValueError):
            learn_from_feedback({}, "sig", "banana")

    def test_rank_queue_orders_by_score_and_carries_reasons(self):
        alerts = [
            {"id": "low", "severity": "low", "created_at": "2026-10-01T00:00:00+00:00"},
            {"id": "crit", "severity": "critical", "created_at": "2026-10-02T00:00:00+00:00"},
            {"id": "aged", "severity": "critical", "age_hours": 100, "created_at": "2026-09-01T00:00:00+00:00"},
        ]
        ranked = rank_queue(alerts)
        assert [a["id"] for a in ranked][:2] == ["crit", "aged"]
        assert ranked[0]["triage"]["score"] > ranked[-1]["triage"]["score"]
        assert ranked[0]["triage"]["reasons"]


class TestSuggestions:
    def test_false_positive_heavy_signal_suggests_suppression(self):
        profile = {"disposition_counts": {"noisy_signal": {"true_positive": 1, "false_positive": 7, "accepted_risk": 0}}}
        suggestions = adaptive_suggestions(profile)
        assert len(suggestions) == 1
        assert "suppression" in suggestions[0]["text"]

    def test_actionable_signal_suggests_raising_priority(self):
        profile = {"disposition_counts": {"good_signal": {"true_positive": 6, "false_positive": 1, "accepted_risk": 0}}}
        suggestions = adaptive_suggestions(profile)
        assert "auto-ticketing" in suggestions[0]["text"]

    def test_thin_history_produces_no_suggestion(self):
        profile = {"disposition_counts": {"new_signal": {"true_positive": 1, "false_positive": 0, "accepted_risk": 0}}}
        assert adaptive_suggestions(profile) == []


class TestDefenderPosture:
    def test_unassessed_devices_are_never_counted_healthy(self):
        devices = [
            {"id": "d1", "nexus_agent_id": "ag1", "defender_status": "protected"},
            {"id": "d2", "nexus_agent_id": "ag2", "defender_status": "at_risk", "defender_realtime": False},
            {"id": "d3", "nexus_agent_id": "ag3", "defender_status": None},
            {"id": "d4", "nexus_agent_id": "ag4", "defender_status": "protected", "defender_signature_age_days": 9},
            {"id": "d5"},  # no agent at all
        ]
        posture = defender_posture(devices)
        assert posture["assessed"] == 3
        assert posture["not_assessed"] == 1
        assert posture["protected"] == 2
        assert posture["signature_stale"] == [{"device_id": "d4", "age_days": 9}]
        assert posture["realtime_disabled"] == ["d2"]
        assert posture["coverage_pct"] == 67

    def test_no_evidence_yields_none_not_perfect(self):
        assert defender_posture([])["coverage_pct"] is None


class TestRouterBoundaries:
    def test_feedback_rejects_unknown_disposition(self):
        async def run():
            payload = nexus_guardian.GuardianFeedback(signal="sig", disposition="nope")
            return payload
        payload = asyncio.run(run())
        assert payload.signal == "sig"
        with pytest.raises(Exception):
            nexus_guardian.GuardianFeedback(signal="sig", disposition="x" * 5000)

    def test_feedback_endpoint_enforces_disposition_and_scope(self):
        sig = inspect.signature(nexus_guardian.record_feedback)
        assert "current_user" in sig.parameters
        assert nexus_guardian.DISPOSITIONS == {"true_positive", "false_positive", "accepted_risk"}

    def test_routers_expose_expected_operations(self):
        routes = [r.path for r in nexus_guardian.router.routes]
        assert "/nexus-guardian/triage-queue" in routes
        assert "/nexus-guardian/posture" in routes
        assert "/nexus-guardian/insights" in routes
        assert "/nexus-guardian/feedback" in routes
