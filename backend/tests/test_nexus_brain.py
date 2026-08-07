from app.services.nexus_brain import build_value_proof, correlate_client_signals


CLIENTS = [
    {"id": "client-001", "name": "Acme Plumbing"},
    {"id": "client-002", "name": "Northwind Legal"},
]


def test_correlates_storage_pressure_with_backup_failures():
    insights = correlate_client_signals(
        clients=CLIENTS,
        devices=[
            {
                "id": "device-001",
                "client_id": "client-001",
                "name": "FILESERVER",
                "disk_percent": 96,
                "status": "online",
            }
        ],
        failed_backups=[
            {
                "id": "backup-001",
                "client_id": "client-001",
                "name": "Nightly image",
                "status": "failed",
            }
        ],
        critical_tickets=[],
        unbilled_time=[],
    )

    assert len(insights) == 1
    insight = insights[0]
    assert insight["client_id"] == "client-001"
    assert insight["route"] == "/backup-center"
    assert insight["confidence"] >= 80
    assert insight["outcomes"] == ["reduce_risk", "reduce_effort"]
    assert {item["label"] for item in insight["evidence"]} == {
        "Storage pressure",
        "Failed backups",
    }
    assert "2 signal types" in insight["confidence_basis"]


def test_does_not_turn_a_single_signal_into_a_correlation():
    insights = correlate_client_signals(
        clients=CLIENTS,
        devices=[
            {
                "id": "device-002",
                "client_id": "client-002",
                "name": "RECEPTION-PC",
                "status": "offline",
            }
        ],
        failed_backups=[],
        critical_tickets=[],
        unbilled_time=[],
    )

    assert insights == []


def test_surfaces_critical_work_with_unbilled_effort():
    insights = correlate_client_signals(
        clients=CLIENTS,
        devices=[],
        failed_backups=[],
        critical_tickets=[
            {
                "id": "ticket-001",
                "client_id": "client-002",
                "priority": "critical",
                "status": "open",
            }
        ],
        unbilled_time=[
            {
                "id": "time-001",
                "client_id": "client-002",
                "hours": 2,
                "hourly_rate": 175,
            }
        ],
    )

    assert len(insights) == 1
    insight = insights[0]
    assert insight["route"] == "/billing-recon"
    assert "increase_revenue" in insight["outcomes"]
    assert {"label": "Unbilled work", "value": "$350.00"} in insight["evidence"]


def test_value_proof_separates_observed_value_from_finance_opportunity():
    proof = build_value_proof(
        automated_actions=9,
        documented_minutes_saved=47.5,
        revenue_identified=320.25,
        healed_actions=3,
        script_actions=2,
        workflow_actions=4,
    )

    metrics = {metric["id"]: metric for metric in proof["metrics"]}
    assert metrics["actions_completed"]["value"] == 9
    assert metrics["actions_completed"]["sources"] == {
        "self_healing_events": 3,
        "script_executions": 2,
        "workflow_runs": 4,
    }
    assert metrics["time_returned"]["value"] == 47.5
    assert metrics["revenue_identified"]["state"] == "review_required"
    assert "not claimed as recovered" in metrics["revenue_identified"]["detail"]


def test_value_proof_does_not_invent_prevented_tickets():
    proof = build_value_proof(
        automated_actions=0,
        documented_minutes_saved=0,
        revenue_identified=0,
        healed_actions=0,
        script_actions=0,
        workflow_actions=0,
    )

    prevented = next(metric for metric in proof["metrics"] if metric["id"] == "tickets_prevented")
    assert prevented["value"] is None
    assert prevented["state"] == "not_measured"
