from app.services.m365_access_governance import build_access_governance, build_client_access_governance


def _client():
    return {
        "id": "client-1",
        "name": "Northwind",
        "cipp_tenant_id": "tenant-1",
        "cipp_tenant_display": "Northwind Microsoft 365",
    }


def test_access_governance_does_not_treat_missing_evidence_as_a_pass():
    row = build_client_access_governance(_client())

    assert row["state"] == "evidence_incomplete"
    assert row["access_counts"]["privileged_identities"] == 0
    assert any(item["key"] == "privileged_role_evidence_missing" for item in row["evidence_gaps"])
    assert "No group, role" in row["boundary"]


def test_access_governance_reports_review_signals_without_returning_identity_pii():
    row = build_client_access_governance(
        _client(),
        tenant_connections=[{"tenant_id": "tenant-1", "client_id": "client-1", "graph_verified": True}],
        provider_tenants=[{"tenant_id": "tenant-1", "source": "m365_graph"}],
        provider_users=[
            {
                "tenant_id": "tenant-1", "id": "user-1", "source": "m365_graph",
                "account_enabled": False, "assigned_roles": [{"displayName": "Global Administrator"}],
                "display_name": "Should not be returned", "upn": "secret@example.test",
            },
            {
                "tenant_id": "tenant-1", "id": "user-2", "source": "m365_graph",
                "account_enabled": True, "assigned_roles": [{"displayName": "Exchange Administrator"}],
            },
        ],
        provider_groups=[
            {"tenant_id": "tenant-1", "source": "m365_graph", "isAssignableToRole": True, "memberCount": 2},
        ],
        provider_guests=[
            {"tenant_id": "tenant-1", "source": "m365_graph", "lastSignInDateTime": "2025-01-01T00:00:00+00:00"},
        ],
        provider_gdap=[
            {"tenant_id": "tenant-1", "source": "m365_graph", "expires_in_days": 14},
        ],
    )

    assert row["state"] == "attention_required"
    assert row["access_counts"] == {
        "provider_users": 2,
        "privileged_identities": 2,
        "disabled_privileged_identities": 1,
        "groups": 1,
        "role_assignable_groups": 1,
        "guest_identities": 1,
        "stale_guest_identities": 1,
        "gdap_relationships": 1,
        "gdap_expiring_30d": 1,
    }
    finding_keys = {finding["key"] for finding in row["findings"]}
    assert {"disabled_privileged_identities", "stale_guest_access", "gdap_expiring"} <= finding_keys
    assert all("secret@example.test" not in str(value) for value in row.values())
    assert all("Should not be returned" not in str(value) for value in row.values())


def test_access_governance_portfolio_aggregates_scoped_clients_only():
    response = build_access_governance([_client()])

    assert response["summary"]["clients"] == 1
    assert response["clients"][0]["client_id"] == "client-1"
    assert "governed Control Plane workflow" in response["boundary"]
