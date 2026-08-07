from app.routers.nexus_shield import _xdr_response_item


def test_xdr_case_becomes_an_approval_gated_response_item():
    item = _xdr_response_item({
        "id": "xdr:client-1:john@example.test",
        "severity": "critical",
        "summary": "Two persisted signals require validation.",
        "client_id": "client-1",
        "client_name": "Acme",
        "subject": "john@example.test",
        "categories": ["identity", "email"],
        "signal_count": 2,
        "evidence": [{"route": "/identity-threats", "source": "Identity provider"}],
    })

    assert item["control"] == "XDR evidence"
    assert item["signal_count"] == 2
    assert item["xdr_case_id"] == "xdr:client-1:john@example.test"
    assert item["evidence_route"] == "/identity-threats"
    assert item["requires_approval"] is True


def test_canary_case_is_grouped_into_one_response_item():
    item = _xdr_response_item({
        "id": "xdr:client-1:pc-01",
        "severity": "medium",
        "client_id": "client-1",
        "client_name": "Acme",
        "subject": "PC-01",
        "categories": ["endpoint"],
        "signal_count": 3,
        "evidence": [{"route": "/nexus-shield?tab=canary", "source": "Nexus Canary"}],
    })

    assert item["control"] == "Nexus Canary"
    assert item["signal_count"] == 3
    assert item["id"] == "xdr-response:xdr:client-1:pc-01"
