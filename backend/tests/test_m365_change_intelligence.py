from app.services.m365_change_intelligence import (
    build_change_intelligence,
    build_client_change_intelligence,
)


def _client():
    return {
        "id": "client-1",
        "name": "Northwind",
        "cipp_tenant_id": "tenant-1",
        "cipp_tenant_display": "Northwind Microsoft 365",
    }


def test_change_intelligence_refuses_to_infer_history_from_a_current_snapshot():
    row = build_client_change_intelligence(_client())

    assert row["state"] == "attention_required"
    assert row["change_evidence"]["state"] == "not_observed"
    assert row["events"] == []
    assert any(item["key"] == "tenant_connection_unverified" for item in row["evidence_gaps"])
    assert "fabricated historical diff" in row["boundary"]


def test_change_intelligence_only_returns_client_bound_safe_action_metadata():
    row = build_client_change_intelligence(
        _client(),
        tenant_connections=[{"tenant_id": "tenant-1", "client_id": "client-1", "graph_verified": True, "updated_at": "2026-08-20T10:00:00+00:00"}],
        provider_users=[{"tenant_id": "tenant-1", "source": "m365_graph", "display_name": "Sarah Jones", "upn": "sarah@example.test", "updated_at": "2026-08-20T10:01:00+00:00"}],
        provider_licenses=[{"tenant_id": "tenant-1", "source": "m365_graph", "sku_part_number": "BUSINESS_PREMIUM", "updated_at": "2026-08-20T10:02:00+00:00"}],
        cipp_actions=[
            {
                "tenant_id": "tenant-1", "client_id": "client-1", "action": "reset_password",
                "timestamp": "2026-08-20T10:03:00+00:00", "actor_id": "tech-1", "correlation_id": "corr-1",
                "user_id": "user-secret", "result_preview": "temporary password is secret",
            },
            {"tenant_id": "tenant-1", "action": "offboard_user", "timestamp": "2026-08-20T10:04:00+00:00"},
            {"tenant_id": "tenant-1", "client_id": "other-client", "action": "block_signin", "timestamp": "2026-08-20T10:05:00+00:00"},
            {"tenant_id": "other-tenant", "client_id": "client-1", "action": "block_signin", "timestamp": "2026-08-20T10:06:00+00:00"},
        ],
    )

    assert row["state"] == "ready_for_review"
    assert row["change_evidence"]["recorded_actions"] == 1
    assert row["events"][0]["action"] == "reset_password"
    assert row["events"][0]["actor_recorded"] is True
    assert row["events"][0]["correlation_recorded"] is True
    assert row["observation_freshness"][1]["records"] == 1
    serialised = str(row)
    assert "Sarah Jones" not in serialised
    assert "sarah@example.test" not in serialised
    assert "user-secret" not in serialised
    assert "temporary password" not in serialised


def test_change_intelligence_portfolio_keeps_client_ownership_and_counts_explicit():
    unmapped = {"id": "client-2", "name": "Tailspin"}
    response = build_change_intelligence([unmapped, _client()], generated_at="2026-08-20T12:00:00+00:00")

    assert response["generated_at"] == "2026-08-20T12:00:00+00:00"
    assert response["summary"]["clients"] == 2
    assert response["summary"]["mapped_clients"] == 1
    assert response["clients"][0]["client_id"] == "client-1"
    assert response["clients"][1]["client_id"] == "client-2"
    assert "retained actions and evidence freshness" in response["boundary"]
