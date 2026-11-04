from app.services.m365_studio import build_overview


def test_microsoft_studio_does_not_turn_missing_evidence_into_zeroes():
    overview = build_overview(
        tenants=[{"id": "tenant-1", "name": "Example", "users_count": 12}],
        stream_evidence={},
        explicit_no_mfa_users=0,
        risky_signins=0,
        gdap_expiring=0,
        generated_at="2026-10-16T00:00:00Z",
    )

    assert overview["summary"]["reported_users"] == 12
    assert overview["summary"]["average_mfa_pct"] is None
    assert overview["summary"]["average_secure_score"] is None
    assert all(stream["evidence_state"] == "not_reported" for stream in overview["streams"])
    assert overview["attention"] == []


def test_microsoft_studio_reports_only_explicit_identity_findings():
    overview = build_overview(
        tenants=[{"id": "tenant-1", "mfa_enrolled_pct": 92, "secure_score": 71}],
        stream_evidence={"identity": {"records": 4, "latest_observed_at": "2026-10-16T01:00:00Z"}},
        explicit_no_mfa_users=3,
        risky_signins=0,
        gdap_expiring=1,
        generated_at="2026-10-16T01:02:00Z",
    )

    assert overview["summary"]["average_mfa_pct"] == 92
    assert overview["streams"][0]["latest_observed_at"] == "2026-10-16T01:00:00Z"
    assert {item["id"] for item in overview["attention"]} == {"identities-without-mfa", "gdap-expiring-30d"}
