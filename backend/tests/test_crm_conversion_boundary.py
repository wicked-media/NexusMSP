import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from app.routers import crm


def setup_db(monkeypatch, lead):
    leads = SimpleNamespace(find_one=AsyncMock(return_value=lead), update_one=AsyncMock())
    clients = SimpleNamespace(insert_one=AsyncMock())
    monkeypatch.setattr(crm, 'db', SimpleNamespace(leads=leads, clients=clients))
    monkeypatch.setattr(crm, 'assert_global_scope', AsyncMock())
    monkeypatch.setattr(crm, 'log_activity', AsyncMock())
    return leads, clients


def test_conversion_scopes_reads_writes_and_does_not_invent_revenue(monkeypatch):
    leads, clients = setup_db(monkeypatch, {'id': 'lead', 'company_name': 'Company', 'estimated_value': 95000})
    user = {'id': 'u', 'tenant_id': 'tenant-a'}
    result = asyncio.run(crm.convert_lead_to_client('lead', user))
    query = {'$and': [{'id': 'lead'}, {'tenant_id': 'tenant-a'}]}
    assert leads.find_one.call_args.args[0] == query
    assert leads.update_one.call_args.args[0] == query
    client = clients.insert_one.call_args.args[0]
    assert client['tenant_id'] == 'tenant-a'
    assert client['source_lead_id'] == 'lead'
    assert client['mrr'] == 0
    assert result['client_id'] == client['id']
    crm.log_activity.assert_awaited_once()


def test_restricted_actor_is_denied_before_read(monkeypatch):
    leads, clients = setup_db(monkeypatch, {})
    monkeypatch.setattr(crm, 'assert_global_scope', AsyncMock(side_effect=HTTPException(403, 'Forbidden')))
    with pytest.raises(HTTPException):
        asyncio.run(crm.convert_lead_to_client('lead', {'id': 'u'}))
    leads.find_one.assert_not_awaited()
    clients.insert_one.assert_not_awaited()


@pytest.mark.parametrize('lead,code', [(None, 404), ({'converted_to_client': 'existing'}, 400)])
def test_missing_or_already_converted_never_creates_client(monkeypatch, lead, code):
    _, clients = setup_db(monkeypatch, lead)
    with pytest.raises(HTTPException) as error:
        asyncio.run(crm.convert_lead_to_client('lead', {'id': 'u'}))
    assert error.value.status_code == code
    clients.insert_one.assert_not_awaited()


def test_conversion_has_action_permission_dependency():
    route = next(route for route in crm.router.routes if route.path == '/leads/{lead_id}/convert')
    assert route.dependencies
