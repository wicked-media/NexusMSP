from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

from app.models import LeadCreate
from app.routers import crm, invoices, lead_studio
from app.services import action_permissions


def _route_permissions(router, path: str, method: str) -> set[str]:
    route = next(item for item in router.routes if item.path == path and method in item.methods)
    return {
        cell.cell_contents
        for dependency in route.dependant.dependencies
        for cell in (getattr(dependency.call, "__closure__", None) or ())
        if isinstance(cell.cell_contents, str)
    }


class _Cursor:
    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return []


class _Collection:
    def __init__(self):
        self.find_queries = []
        self.inserted = []

    def find(self, query, _projection=None):
        self.find_queries.append(deepcopy(query))
        return _Cursor()

    async def find_one(self, _query, _projection=None):
        return None

    async def insert_one(self, document):
        self.inserted.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


def test_invoice_reads_and_lead_routes_declare_explicit_actions():
    for path in ("/invoices", "/invoices/stats/summary", "/invoices/{invoice_id}", "/invoices/{invoice_id}/activity-log"):
        assert "billing.portal.view" in _route_permissions(invoices.router, path, "GET")

    assert "crm.lead.view" in _route_permissions(crm.router, "/leads", "GET")
    assert "crm.lead.view" in _route_permissions(crm.router, "/leads/{lead_id}", "GET")
    assert "crm.lead.manage" in _route_permissions(crm.router, "/leads", "POST")
    assert "crm.lead.manage" in _route_permissions(crm.router, "/leads/{lead_id}", "PUT")
    assert "crm.lead.manage" in _route_permissions(crm.router, "/leads/{lead_id}", "DELETE")

    lead_studio_permissions = _route_permissions(lead_studio.router, "/lead-studio/score", "GET")
    assert "crm.lead.view" in lead_studio_permissions
    assert "crm.lead.manage" in _route_permissions(lead_studio.router, "/lead-studio/bulk-action", "POST")


def test_lead_permissions_keep_legacy_roles_compatible():
    by_id = action_permissions.ACTION_PERMISSION_BY_ID
    assert by_id["crm.lead.view"]["legacy"] == ("clients", "view")
    assert by_id["crm.lead.manage"]["legacy"] == ("clients", "edit")


def test_lead_reads_and_creates_use_the_authenticated_tenant(monkeypatch):
    asyncio.run(_test_lead_reads_and_creates_use_the_authenticated_tenant(monkeypatch))


async def _test_lead_reads_and_creates_use_the_authenticated_tenant(monkeypatch):
    leads = _Collection()
    database = SimpleNamespace(leads=leads, users=_Collection())
    monkeypatch.setattr(crm, "db", database)
    user = {"id": "user-a", "name": "User A", "role": "admin", "tenant_id": "tenant-a"}

    assert await crm.get_leads(current_user=user) == []
    assert leads.find_queries[-1] == {"tenant_id": "tenant-a"}

    created = await crm.create_lead(LeadCreate(company_name="Acme", contact_name="A. Contact"), current_user=user)
    assert created.company_name == "Acme"
    assert leads.inserted[-1]["tenant_id"] == "tenant-a"

