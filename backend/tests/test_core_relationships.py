import asyncio

from app.services import core_relationships
from app.services.core_relationships import (
    CORE_ENTITY_ORDER,
    core_ref,
    core_schema,
    relationship_id,
)


class _Cursor:
    def limit(self, _limit):
        return self

    async def to_list(self, _limit):
        return []


def test_core_schema_preserves_the_canonical_operational_path():
    schema = core_schema()

    assert schema["schema_version"] == 2
    assert schema["canonical_path"] == list(CORE_ENTITY_ORDER)
    assert schema["canonical_path"] == [
        "client",
        "site",
        "contact",
        "user",
        "device",
        "service",
        "contract",
        "ticket",
        "project",
        "invoice",
        "documentation",
        "integration",
    ]
    assert schema["canonical_tree"] == {
        "root": "client",
        "children": [
            "site",
            "contact",
            "user",
            "device",
            "service",
            "contract",
            "ticket",
            "project",
            "invoice",
            "documentation",
            "integration",
        ],
    }


def test_core_references_are_stable_and_readable():
    assert core_ref("device", "device-001") == "nexus:device:device-001"
    assert core_ref("client", "client-001") == "nexus:client:client-001"


def test_relationship_ids_are_deterministic_but_relation_specific():
    source = core_ref("client", "client-001")
    target = core_ref("device", "device-001")

    first = relationship_id("client.owns", source, target)
    second = relationship_id("client.owns", source, target)
    different_relation = relationship_id("ticket.concerns", source, target)

    assert first == second
    assert first.startswith("nexus:relationship:")
    assert different_relation != first


def test_client_graph_queries_only_the_callers_platform_tenant(monkeypatch):
    queries = []

    class Collection:
        def find(self, query, _projection):
            queries.append(query)
            return _Cursor()

    monkeypatch.setattr(
        core_relationships,
        "db",
        type("CoreDB", (), {"core_entities": Collection(), "core_relationships": Collection()})(),
    )

    graph = asyncio.run(core_relationships.client_core_graph(
        "client-a",
        {"id": "admin-a", "role": "admin", "tenant_id": "tenant-a"},
    ))

    assert graph["nodes"] == []
    assert len(queries) == 2
    assert all(query["$and"][1] == {"tenant_id": "tenant-a"} for query in queries)
