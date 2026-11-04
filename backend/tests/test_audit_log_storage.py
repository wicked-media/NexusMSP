import asyncio

from app.services.audit_log_storage import ensure_audit_log_indexes


class _Indexes:
    def __init__(self):
        self.calls = []

    async def create_index(self, fields, **kwargs):
        self.calls.append((fields, kwargs))


def test_audit_log_indexes_cover_observed_timeline_and_investigation_queries():
    collection = _Indexes()

    asyncio.run(ensure_audit_log_indexes(collection))

    assert {kwargs["name"] for _, kwargs in collection.calls} == {
        "audit_entity_timeline",
        "audit_client_timeline",
        "audit_ticket_timeline",
        "audit_action_timeline",
        "audit_actor_timeline",
        "audit_metadata_client_timeline",
    }
    assert ([("ticket_id", 1), ("created_at", -1)], {"name": "audit_ticket_timeline"}) in collection.calls
