from app.services.core_relationships import (
    CORE_ENTITY_ORDER,
    core_ref,
    core_schema,
    relationship_id,
)


def test_core_schema_preserves_the_canonical_operational_path():
    schema = core_schema()

    assert schema["schema_version"] == 1
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
        "invoice",
        "integration",
    ]


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
