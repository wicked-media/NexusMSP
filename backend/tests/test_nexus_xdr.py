from app.services.nexus_xdr import build_xdr_overview


def _build(**overrides):
    inputs = {
        "devices": [],
        "m365_users": [],
        "m365_tenants": [],
        "security_alerts": [],
        "identity_threats": [],
        "dns_domains": [],
        "dns_alerts": [],
        "backup_jobs": [],
        "vulnerabilities": [],
        "canary_triggers": [],
    }
    inputs.update(overrides)
    return build_xdr_overview(**inputs)


def test_missing_connectors_remain_not_assessed():
    overview = _build()

    assert overview["confidence"]["score"] is None
    assert overview["confidence"]["evidence_coverage"] == 0
    assert all(domain["status"] == "not_assessed" for domain in overview["confidence"]["domains"])


def test_verified_endpoint_and_identity_evidence_produce_explainable_scores():
    overview = _build(
        devices=[{
            "id": "dev-1", "security_assessed_at": "2026-08-02T00:00:00Z",
            "antivirus_status": "active", "defender_real_time_enabled": True,
            "firewall_enabled": True, "encryption_status": "BitLocker on", "pending_patches": 0,
        }],
        m365_users=[{
            "id": "user-1", "account_enabled": True, "mfa_enforced": True,
            "risky_signin_30d": False,
        }],
    )

    domains = {row["key"]: row for row in overview["confidence"]["domains"]}
    assert domains["endpoint"]["score"] == 100
    assert domains["endpoint"]["coverage"] == 100
    assert domains["identity"]["score"] == 100
    assert domains["email"]["score"] is None
    assert overview["confidence"]["evidence_coverage"] == 43
    assert overview["confidence"]["score"] == 43
    assert overview["confidence"]["observed_score"] == 100


def test_sparse_endpoint_evidence_cannot_present_as_full_assurance():
    devices = [{"id": f"dev-{index}"} for index in range(16)]
    devices[0].update({
        "security_assessed_at": "2026-08-02T00:00:00Z",
        "antivirus_status": "active",
        "defender_real_time_enabled": True,
        "firewall_enabled": True,
        "encryption_status": "BitLocker on",
        "pending_patches": 0,
    })

    overview = _build(devices=devices)
    endpoint = overview["confidence"]["domains"][0]

    assert endpoint["score"] == 100
    assert endpoint["coverage"] == 6
    assert endpoint["assurance_score"] == 6
    assert overview["confidence"]["observed_score"] == 100
    assert overview["confidence"]["evidence_coverage"] == 1
    assert overview["confidence"]["score"] == 1


def test_cross_domain_signals_are_correlated_only_on_persisted_subject_relationships():
    overview = _build(
        security_alerts=[{
            "id": "mail-1", "status": "open", "category": "email", "severity": "high",
            "title": "Suspicious inbox rule", "client_id": "client-1", "client_name": "Acme",
            "user_email": "john@acme.example",
        }],
        identity_threats=[{
            "id": "identity-1", "status": "active", "severity": "critical",
            "title": "Impossible travel", "client_id": "client-1", "client_name": "Acme",
            "user_email": "john@acme.example",
        }],
    )

    assert len(overview["incidents"]) == 1
    assert overview["incidents"][0]["correlated"] is True
    assert overview["incidents"][0]["categories"] == ["email", "identity"]
    assert overview["incidents"][0]["requires_approval"] is True
    assert [event["id"] for event in overview["timeline"]] == ["identity-1", "mail-1"]


def test_timeline_orders_timestamped_provider_evidence_newest_first():
    overview = _build(
        dns_domains=[{"id": "domain-1", "client_id": "client-1"}],
        dns_alerts=[
            {"id": "older", "status": "open", "severity": "medium", "domain": "one.example", "detected_at": "2026-08-01T08:00:00Z"},
            {"id": "newer", "status": "open", "severity": "high", "domain": "two.example", "detected_at": "2026-08-02T08:00:00Z"},
        ],
    )

    assert [event["id"] for event in overview["timeline"]] == ["newer", "older"]
    assert overview["confidence"]["domains"][5]["score"] == 73
