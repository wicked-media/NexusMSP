from app.routers.nexus_shield import _dmarc_alerts


def test_dmarc_unauthorised_senders_become_actionable_xdr_alerts():
    alerts = _dmarc_alerts([
        {
            "id": "report-001",
            "client_id": "client-001",
            "domain": "example.com",
            "unauthorized_count": 25,
            "received_at": "2026-08-09T08:00:00Z",
        }
    ])

    assert alerts == [{
        "id": "xdr-dmarc-report-001",
        "client_id": "client-001",
        "category": "email",
        "source": "Nexus DMARC",
        "title": "Unauthorised sending observed for example.com",
        "summary": "25 unauthorised message(s) in a DMARC aggregate report.",
        "severity": "high",
        "status": "new",
        "created_at": "2026-08-09T08:00:00Z",
        "evidence_route": "/dmarc-compliance",
    }]


def test_dmarc_reports_without_unauthorised_senders_do_not_create_xdr_noise():
    assert _dmarc_alerts([
        {"id": "report-clean", "unauthorized_count": 0},
        {"id": "report-empty"},
    ]) == []
