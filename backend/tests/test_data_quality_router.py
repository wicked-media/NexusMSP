import asyncio
from types import SimpleNamespace

from app.routers import data_quality


class _Cursor:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]

    async def to_list(self, length):
        return self.rows[:length]


class _Collection:
    def __init__(self, rows=(), *, count=0):
        self.rows = list(rows)
        self.count = count
        self.find_queries = []
        self.count_queries = []

    def find(self, query, projection):
        self.find_queries.append(query)
        return _Cursor(self.rows)

    async def count_documents(self, query):
        self.count_queries.append(query)
        return self.count


def _fake_db(*, clients, devices=(), tickets=(), subscriptions=(), agents=(), orphan_counts=None):
    orphan_counts = orphan_counts or {}
    return SimpleNamespace(
        clients=_Collection(clients),
        devices=_Collection(devices, count=orphan_counts.get("devices", 0)),
        tickets=_Collection(tickets, count=orphan_counts.get("tickets", 0)),
        subscriptions=_Collection(subscriptions, count=orphan_counts.get("subscriptions", 0)),
        nexus_agents=_Collection(agents, count=orphan_counts.get("nexus_agents", 0)),
    )


def test_restricted_overview_uses_client_scoped_source_queries_and_skips_orphans(monkeypatch):
    fake_db = _fake_db(
        clients=[{"id": "client-1", "name": "Acme", "email": "ops@acme.example"}],
        devices=[{"id": "device-1", "client_id": "client-1", "name": "ACME-01", "serial_number": "ABC"}],
        orphan_counts={"devices": 9},
    )
    monkeypatch.setattr(data_quality, "db", fake_db)
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-1"],
    }

    response = asyncio.run(data_quality.data_quality_overview(limit=50, current_user=user))

    assert response["scope"]["mode"] == "restricted_clients"
    assert response["scope"]["unattributed_records_visible"] is False
    assert not fake_db.devices.count_queries
    assert "client-1" in str(fake_db.devices.find_queries[0])
    assert "client-1" in str(fake_db.tickets.find_queries[0])
    assert not [finding for finding in response["findings"] if finding["id"].startswith("unattributed-source:")]


def test_global_overview_exposes_only_aggregate_unattributed_signal(monkeypatch):
    fake_db = _fake_db(
        clients=[{"id": "client-1", "name": "Acme", "email": "ops@acme.example"}],
        orphan_counts={"devices": 2},
    )
    monkeypatch.setattr(data_quality, "db", fake_db)
    user = {"id": "admin-1", "role": "admin", "is_admin": True}

    response = asyncio.run(data_quality.data_quality_overview(limit=50, current_user=user))

    finding = next(item for item in response["findings"] if item["id"] == "unattributed-source:devices")
    assert response["scope"]["mode"] == "all_clients"
    assert finding["observed"] == 2
    assert finding["client_id"] is None
    assert fake_db.devices.count_queries
    assert "client_id" in str(fake_db.devices.count_queries[0])


def test_explicit_tenant_query_excludes_other_tenant_and_unbound_records(monkeypatch):
    fake_db = _fake_db(
        clients=[{"id": "client-1", "name": "Acme", "email": "ops@acme.example", "tenant_id": "tenant-a"}],
        devices=[{"id": "device-1", "client_id": "client-1", "name": "ACME-01", "serial_number": "ABC", "tenant_id": "tenant-a"}],
    )
    monkeypatch.setattr(data_quality, "db", fake_db)
    user = {"id": "admin-a", "role": "admin", "is_admin": True, "tenant_id": "tenant-a"}

    asyncio.run(data_quality.data_quality_overview(limit=50, current_user=user))

    assert "tenant-a" in str(fake_db.clients.find_queries[0])
    assert "tenant-a" in str(fake_db.devices.find_queries[0])
    assert "tenant-a" in str(fake_db.tickets.find_queries[0])


def test_global_review_marks_capture_partial_and_defers_orphan_count_when_clients_exceed_limit(monkeypatch):
    fake_db = _fake_db(
        clients=[
            {"id": "client-1", "name": "Acme", "email": "ops@acme.example"},
            {"id": "client-2", "name": "Bravo", "email": "ops@bravo.example"},
        ],
        devices=[{"id": "device-1", "client_id": "client-1", "name": "ACME-01", "serial_number": "ABC"}],
        orphan_counts={"devices": 9},
    )
    monkeypatch.setattr(data_quality, "db", fake_db)
    user = {"id": "admin-1", "role": "admin", "is_admin": True}

    response = asyncio.run(data_quality.data_quality_overview(limit=1, current_user=user))

    assert response["summary"]["capture_state"] == "partial"
    assert "clients" in response["summary"]["truncated_sources"]
    assert response["scope"]["unattributed_records_review_deferred"] is True
    assert not fake_db.devices.count_queries
