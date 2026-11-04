import asyncio
from types import SimpleNamespace

from app.routers.service_subscriptions import (
    _infer_category,
    _m365_tenant_bindings,
    _m365_usage_items,
    _monthly_amount,
    _normalise_status,
)
from app.routers import web_studio
from fastapi import HTTPException
import pytest


def test_monthly_amount_normalises_common_billing_cadences():
    assert _monthly_amount(1200, "annual") == 100
    assert _monthly_amount(300, "quarterly") == 100
    assert round(_monthly_amount(120, "weekly"), 2) == 520
    assert _monthly_amount(75, "monthly") == 75


def test_category_inference_covers_connected_service_families():
    assert _infer_category("Microsoft 365 Business Premium") == "licence"
    assert _infer_category("Acronis endpoint protection") == "backup"
    assert _infer_category("Yeastar extension") == "voice"
    assert _infer_category("Managed DNS security") == "security"
    assert _infer_category("Business internet service") == "telecom"
    assert _infer_category("Managed support agreement") == "managed_service"
    assert _infer_category("Unclassified recurring item") == "subscription"


def test_status_normalisation_preserves_disabled_state():
    assert _normalise_status("online") == "active"
    assert _normalise_status("connected") == "active"
    assert _normalise_status("active", enabled=False) == "disabled"


def test_m365_usage_uses_stable_scoped_tenant_mapping_only():
    clients = [
        {"id": "client-a", "name": "Alpha", "cipp_tenant_id": "tenant-a"},
        {"id": "client-b", "name": "Bravo", "cipp_tenant_id": "tenant-b"},
    ]
    mappings, ambiguous = _m365_tenant_bindings(
        clients,
        [{"tenant_id": "tenant-c", "client_id": "client-a"}],
        [
            {"tenant_id": "tenant-d", "client_id": "client-b"},
            {"tenant_id": "tenant-a", "client_id": "client-b"},
        ],
    )

    assert mappings == {"tenant-b": "client-b", "tenant-c": "client-a", "tenant-d": "client-b"}
    assert ambiguous == {"tenant-a"}


def test_m365_usage_is_provider_evidence_not_a_billing_decision():
    items, summary = _m365_usage_items(
        [
            {
                "tenant_id": "tenant-a",
                "source": "m365_graph",
                "sku_id": "sku-business-premium",
                "sku_name": "Microsoft 365 Business Premium",
                "total_units": 25,
                "consumed_units": 23,
            },
            {
                "tenant_id": "tenant-b",
                "source": "manual",
                "total_units": 100,
                "consumed_units": 90,
            },
            {
                "tenant_id": "foreign-tenant",
                "source": "m365_graph",
                "total_units": 5,
                "consumed_units": 4,
            },
        ],
        {"tenant-a": "client-a"},
        {"client-a": {"id": "client-a", "name": "Alpha"}},
    )

    assert len(items) == 1
    item = items[0]
    assert item["client_id"] == "client-a"
    assert item["quantity"] == 25
    assert item["used_quantity"] == 23
    assert item["billing_linked"] is False
    assert item["billing_state"] == "not_assessed"
    assert item["monthly_revenue"] is None
    assert "does not prove a contract" in summary["boundary"]


def test_wordpress_connection_rejects_private_network_targets(monkeypatch):
    monkeypatch.setattr(web_studio.socket, "getaddrinfo", lambda *_args, **_kwargs: [(None, None, None, None, ("127.0.0.1", 443))])
    with pytest.raises(HTTPException) as exc:
        web_studio._wordpress_api_url("https://localhost")
    assert exc.value.status_code == 400


def test_wordpress_connection_allows_public_https_host(monkeypatch):
    monkeypatch.setattr(web_studio.socket, "getaddrinfo", lambda *_args, **_kwargs: [(None, None, None, None, ("93.184.216.34", 443))])
    assert web_studio._wordpress_api_url("https://example.com") == "https://example.com/wp-json"


def test_web_studio_domain_normalisation_rejects_urls_and_preserves_a_stable_hostname():
    assert web_studio._normalise_domain(" Example.COM.AU. ") == "example.com.au"

    with pytest.raises(HTTPException) as exc:
        web_studio._normalise_domain("https://example.com.au/admin")

    assert exc.value.status_code == 400


def test_web_studio_rejects_cross_client_agreement_links(monkeypatch):
    class Contracts:
        async def find_one(self, *_args, **_kwargs):
            return {"id": "contract-other", "client_id": "client-other"}

    monkeypatch.setattr(web_studio, "db", SimpleNamespace(contracts=Contracts()))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(web_studio._assert_agreement_for_client("client-a", "contract-other"))

    assert exc.value.status_code == 409


def test_wordpress_component_update_requires_an_exact_target(monkeypatch):
    async def site_or_404(*_args, **_kwargs):
        return {"id": "site-1", "client_id": "client-a", "platform": "wordpress"}

    monkeypatch.setattr(web_studio, "_site_or_404", site_or_404)
    payload = web_studio.WordPressActionInput(
        action="plugin_update",
        target="",
        reason="Apply the approved WordPress maintenance update",
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(web_studio.request_wordpress_action("site-1", payload, {"id": "admin-1"}))

    assert exc.value.status_code == 400


def test_web_studio_operational_route_contract_remains_available():
    paths = {route.path for route in web_studio.router.routes}

    assert {
        "/web-studio/overview",
        "/web-studio/sites",
        "/web-studio/sites/{site_id}",
        "/web-studio/sites/{site_id}/provider-actions",
        "/web-studio/sites/{site_id}/health-check",
        "/web-studio/sites/{site_id}/wordpress/connect",
        "/web-studio/sites/{site_id}/wordpress/actions",
        "/web-studio/sites/{site_id}/management",
        "/settings/synergy-wholesale",
    }.issubset(paths)


def test_synergy_read_failure_is_retained_as_failed_evidence(monkeypatch):
    class Clients:
        async def find_one(self, *_args, **_kwargs):
            return {"id": "client-a", "name": "Alpha"}

    class Actions:
        def __init__(self):
            self.rows = []

        async def insert_one(self, row):
            self.rows.append(dict(row))

        async def update_one(self, query, update):
            for row in self.rows:
                if row["id"] == query["id"]:
                    row.update(update["$set"])

    actions = Actions()
    monkeypatch.setattr(web_studio, "db", SimpleNamespace(clients=Clients(), web_provider_actions=actions))

    async def allow_scope(*_args, **_kwargs):
        return None

    async def no_log(*_args, **_kwargs):
        return None

    async def no_credentials():
        return {}

    def provider_unavailable(*_args, **_kwargs):
        raise HTTPException(status_code=503, detail="Connector unavailable")

    monkeypatch.setattr(web_studio, "assert_client_scope", allow_scope)
    monkeypatch.setattr(web_studio, "log_activity", no_log)
    monkeypatch.setattr(web_studio, "_synergy_credentials", no_credentials)
    monkeypatch.setattr(web_studio, "execute_synergy", provider_unavailable)

    payload = web_studio.SynergyActionRequest(
        operation_id="domain.info",
        client_id="client-a",
        parameters={"domain": "example.com.au"},
        reason="Check the registered-domain inventory before renewal planning",
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(web_studio.create_synergy_action(payload, {"id": "admin-1"}))

    assert exc.value.status_code == 503
    assert actions.rows[0]["status"] == "execution_failed"
    assert actions.rows[0]["failure_kind"] == "connector_or_provider_error"
