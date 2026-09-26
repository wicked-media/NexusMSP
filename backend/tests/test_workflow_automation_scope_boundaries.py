"""Two-client security regression tests for the durable automation runtime."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import ticket_meta, tickets, workflow_automation
from app.services import automation_runtime, scope_permissions


CLIENT_A_USER = {
    "id": "tech-a",
    "role": "technician",
    "client_scope_mode": "restricted",
    "client_scope_ids": ["client-a"],
}


class _InsertRows:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(dict(row))


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


class _WorkflowRows:
    def __init__(self, rows):
        self.rows = list(rows)

    def find(self, _query, _projection):
        return _Cursor(self.rows)


class _RunRows:
    def __init__(self):
        self.rows = []

    async def find_one(self, query, _projection):
        return next((dict(row) for row in self.rows if row.get("run_key") == query.get("run_key")), None)

    async def insert_one(self, row):
        self.rows.append(dict(row))


class _TargetRows:
    def __init__(self, record):
        self.record = dict(record) if record else None
        self.find_queries = []
        self.update_queries = []

    async def find_one(self, query, _projection):
        self.find_queries.append(dict(query))
        if self.record and all(self.record.get(key) == value for key, value in query.items()):
            return dict(self.record)
        return None

    async def update_one(self, query, _update, **_kwargs):
        self.update_queries.append(dict(query))
        matched = bool(self.record and all(self.record.get(key) == value for key, value in query.items()))
        return SimpleNamespace(matched_count=int(matched), modified_count=int(matched))


class _RunRecordRows:
    def __init__(self, record):
        self.record = dict(record)
        self.updates = []

    async def find_one(self, _query, _projection):
        return dict(self.record)

    async def update_one(self, query, update, **_kwargs):
        self.updates.append((dict(query), dict(update)))
        return SimpleNamespace(matched_count=1, modified_count=1)


class _WorkflowRecord:
    def __init__(self, record):
        self.record = dict(record)

    async def find_one(self, query, _projection):
        return dict(self.record) if query.get("id") == self.record.get("id") else None


class _LockingTicketRows:
    """Small Mongo-like ticket fixture that understands the note-lock query."""

    def __init__(self, record):
        self.record = dict(record)
        self.update_queries = []

    def _matches(self, query):
        for key, expected in query.items():
            if key == "$or":
                if not any(self._matches(option) for option in expected):
                    return False
                continue
            actual = self.record.get(key)
            if isinstance(expected, dict) and "$exists" in expected:
                if (key in self.record) != bool(expected["$exists"]):
                    return False
            elif actual != expected:
                return False
        return True

    async def find_one(self, query, _projection):
        return dict(self.record) if self._matches(query) else None

    async def update_one(self, query, update, **_kwargs):
        self.update_queries.append((dict(query), dict(update)))
        if not self._matches(query):
            return SimpleNamespace(matched_count=0, modified_count=0)
        for key, value in (update.get("$set") or {}).items():
            self.record[key] = value
        for key in (update.get("$unset") or {}):
            self.record.pop(key, None)
        return SimpleNamespace(matched_count=1, modified_count=1)


class _NoteRows:
    def __init__(self, tickets):
        self.rows = {}
        self.tickets = tickets
        self.move_attempt = None

    async def update_one(self, query, update, **_kwargs):
        # Simulate a simultaneous standard ticket-client move at the only
        # point where the old implementation had a cross-collection race.
        self.move_attempt = await self.tickets.update_one(
            {
                "id": "ticket-a",
                "client_id": "client-a",
                "automation_note_lock": {"$exists": False},
            },
            {"$set": {"client_id": "client-b"}},
        )
        note_id = query["id"]
        self.rows.setdefault(note_id, dict(update["$setOnInsert"]))
        return SimpleNamespace(matched_count=1, modified_count=1)

    async def find_one(self, query, _projection):
        row = self.rows.get(query.get("id"))
        return dict(row) if row else None


class _ClientRows:
    async def find_one(self, query, _projection):
        if query.get("id") == "client-b":
            return {"id": "client-b", "name": "Client B", "logo_url": None}
        return None


def test_client_scoped_workflows_only_match_events_for_their_client():
    workflow = {
        "scope": {"type": "client", "client_id": "client-a"},
        "trigger": {"type": "platform_event", "event_subject": "ticket.*"},
    }
    event_a = {"subject": "ticket.created", "client_id": "client-a", "payload": {"client_id": "client-a"}}
    event_b = {"subject": "ticket.created", "client_id": "client-b", "payload": {"client_id": "client-b"}}

    assert automation_runtime.workflow_matches_event(workflow, event_a)
    assert not automation_runtime.workflow_matches_event(workflow, event_b)
    assert automation_runtime.workflow_matches_event(
        {**workflow, "scope": {"type": "all_clients", "client_id": None}},
        event_b,
    )
    assert not automation_runtime.workflow_matches_event(
        workflow,
        {"subject": "ticket.created", "client_id": "client-a", "payload": {"client_id": "client-b"}},
    )


def test_platform_and_legacy_dispatch_skip_foreign_client_scoped_workflows(monkeypatch):
    platform_workflows = [
        {"id": "client-a", "scope": {"type": "client", "client_id": "client-a"}, "trigger": {"type": "platform_event", "event_subject": "ticket.*"}, "enabled": True, "approval_status": "approved"},
        {"id": "client-b", "scope": {"type": "client", "client_id": "client-b"}, "trigger": {"type": "platform_event", "event_subject": "ticket.*"}, "enabled": True, "approval_status": "approved"},
        {"id": "global", "scope": {"type": "all_clients", "client_id": None}, "trigger": {"type": "platform_event", "event_subject": "ticket.*"}, "enabled": True, "approval_status": "approved"},
    ]
    queued = []

    async def queue(workflow, _event, **_kwargs):
        queued.append(workflow["id"])
        return {"id": workflow["id"]}

    monkeypatch.setattr(automation_runtime, "db", SimpleNamespace(workflows=_WorkflowRows(platform_workflows)))
    monkeypatch.setattr(automation_runtime, "queue_workflow_run", queue)

    asyncio.run(automation_runtime.queue_runs_for_platform_event({"id": "evt-b", "subject": "ticket.created", "client_id": "client-b"}))
    assert queued == ["client-b", "global"]

    legacy_workflows = [
        {"id": "legacy-a", "scope": {"type": "client", "client_id": "client-a"}, "trigger": {"type": "alert_triggered"}, "enabled": True, "approval_status": "approved", "conditions": []},
        {"id": "legacy-b", "scope": {"type": "client", "client_id": "client-b"}, "trigger": {"type": "alert_triggered"}, "enabled": True, "approval_status": "approved", "conditions": []},
    ]
    queued.clear()
    monkeypatch.setattr(automation_runtime, "db", SimpleNamespace(workflows=_WorkflowRows(legacy_workflows)))
    asyncio.run(automation_runtime.queue_runs_for_legacy_event("alert_triggered", {"id": "alert-b", "client_id": "client-b"}))
    assert queued == ["legacy-b"]


def test_run_key_and_persisted_run_keep_client_and_tenant_context(monkeypatch):
    runs = _RunRows()

    async def no_indexes():
        return None

    async def no_emit(*_args, **_kwargs):
        return None

    monkeypatch.setattr(automation_runtime, "db", SimpleNamespace(workflow_runs=runs))
    monkeypatch.setattr(automation_runtime, "ensure_automation_runtime_indexes", no_indexes)
    monkeypatch.setattr(automation_runtime, "_emit", no_emit)
    workflow = {"id": "wf-global", "name": "Global", "scope": {"type": "all_clients", "client_id": None}, "actions": []}

    run_a = asyncio.run(automation_runtime.queue_workflow_run(
        workflow,
        {"id": "shared-event", "subject": "ticket.created", "tenant_id": "tenant-a", "client_id": "client-a"},
    ))
    run_b = asyncio.run(automation_runtime.queue_workflow_run(
        workflow,
        {"id": "shared-event", "subject": "ticket.created", "tenant_id": "tenant-a", "client_id": "client-b"},
    ))

    assert run_a["client_id"] == "client-a"
    assert run_a["tenant_id"] == "tenant-a"
    assert run_a["run_key"] != run_b["run_key"]


def test_runtime_never_mutates_or_notes_a_target_outside_the_run_client(monkeypatch):
    foreign_ticket = _TargetRows({"id": "ticket-b", "client_id": "client-b", "priority": "low"})
    foreign_notes = _TargetRows(None)
    monkeypatch.setattr(
        automation_runtime,
        "db",
        SimpleNamespace(tickets=foreign_ticket, ticket_notes=foreign_notes),
    )
    run = {"id": "RUN-A", "client_id": "client-a", "tenant_id": "tenant-a", "context": {"ticket_id": "ticket-b"}}

    with pytest.raises(RuntimeError, match="client scope"):
        asyncio.run(automation_runtime._prepare_checkpoint(
            run,
            {"id": "step-1", "type": "change_priority", "config": {"new_priority": "high"}},
            0,
        ))
    with pytest.raises(RuntimeError, match="client scope"):
        asyncio.run(automation_runtime._prepare_checkpoint(
            run,
            {"id": "step-2", "type": "add_note", "config": {"note_text": "never write this"}},
            1,
        ))

    assert foreign_ticket.find_queries == [
        {"id": "ticket-b", "client_id": "client-a"},
        {"id": "ticket-b", "client_id": "client-a"},
    ]
    assert foreign_ticket.update_queries == []
    assert foreign_notes.update_queries == []


def test_runtime_rechecks_target_scope_when_ownership_changes_after_checkpoint(monkeypatch):
    moved_ticket = _TargetRows({"id": "ticket-a", "client_id": "client-b", "priority": "low"})
    monkeypatch.setattr(automation_runtime, "db", SimpleNamespace(tickets=moved_ticket))
    run = {"id": "RUN-A", "client_id": "client-a", "context": {"ticket_id": "ticket-a"}}
    checkpoint = {"before": "low", "after": "high"}

    with pytest.raises(RuntimeError, match="ownership"):
        asyncio.run(automation_runtime._execute_mutation(
            run,
            {"id": "step-1", "type": "change_priority", "config": {}},
            checkpoint,
        ))

    assert moved_ticket.update_queries == [{"id": "ticket-a", "client_id": "client-a"}]


def test_automation_note_lock_prevents_a_client_move_between_scope_check_and_child_write(monkeypatch):
    ticket_rows = _LockingTicketRows({"id": "ticket-a", "client_id": "client-a"})
    note_rows = _NoteRows(ticket_rows)
    monkeypatch.setattr(
        automation_runtime,
        "db",
        SimpleNamespace(tickets=ticket_rows, ticket_notes=note_rows),
    )
    run = {
        "id": "RUN-A",
        "client_id": "client-a",
        "tenant_id": "tenant-a",
        "context": {"ticket_id": "ticket-a"},
    }
    checkpoint = {"entity_id": "automation-run-a-step-1"}

    outcome, _ = asyncio.run(automation_runtime._execute_mutation(
        run,
        {"id": "step-1", "type": "add_note", "config": {"note_text": "Client A only"}},
        checkpoint,
    ))

    assert outcome["status"] == "completed"
    assert note_rows.move_attempt.matched_count == 0
    assert ticket_rows.record["client_id"] == "client-a"
    assert "automation_note_lock" not in ticket_rows.record
    assert note_rows.rows["automation-run-a-step-1"]["client_id"] == "client-a"


def test_ticket_client_move_routes_fail_closed_while_an_automation_note_lock_is_held(monkeypatch):
    locked_ticket = _LockingTicketRows({
        "id": "ticket-a",
        "client_id": "client-a",
        "client_name": "Client A",
        "automation_note_lock": "automation:RUN-A:step-1",
    })
    database = SimpleNamespace(tickets=locked_ticket, clients=_ClientRows())

    async def ticket_in_scope(*_args, **_kwargs):
        return dict(locked_ticket.record)

    async def allow_scope(*_args, **_kwargs):
        return None

    monkeypatch.setattr(tickets, "db", database)
    monkeypatch.setattr(tickets, "_ticket_in_scope", ticket_in_scope)
    monkeypatch.setattr(tickets, "assert_client_scope", allow_scope)

    with pytest.raises(HTTPException) as update_exc:
        asyncio.run(tickets.update_ticket("ticket-a", {"client_id": "client-b"}, CLIENT_A_USER))

    assert update_exc.value.status_code == 409
    assert locked_ticket.record["client_id"] == "client-a"
    scoped_filter = locked_ticket.update_queries[0][0]
    assert scoped_filter["$and"][0]["automation_note_lock"] == {"$exists": False}

    monkeypatch.setattr(ticket_meta, "db", database)
    monkeypatch.setattr(ticket_meta, "assert_tenant_record_scope", ticket_in_scope)
    monkeypatch.setattr(ticket_meta, "assert_client_scope", allow_scope)
    monkeypatch.setattr(ticket_meta, "tenant_scoped_query", lambda _user, query=None: query or {})
    with pytest.raises(HTTPException) as meta_exc:
        asyncio.run(ticket_meta.change_customer("ticket-a", {"client_id": "client-b"}, CLIENT_A_USER))

    assert meta_exc.value.status_code == 409
    assert locked_ticket.record["client_id"] == "client-a"
    assert locked_ticket.update_queries[1][0]["automation_note_lock"] == {"$exists": False}


def test_compensation_treats_a_foreign_or_moved_target_as_a_conflict(monkeypatch):
    run = {
        "id": "RUN-A",
        "status": "completed",
        "client_id": "client-a",
        "tenant_id": "tenant-a",
        "correlation_id": "corr-a",
        "checkpoints": [{
            "step_index": 0,
            "type": "change_priority",
            "entity": "ticket",
            "entity_id": "ticket-b",
            "field": "priority",
            "before": "low",
            "after": "high",
            "reversible": True,
        }],
    }
    run_rows = _RunRecordRows(run)
    foreign_ticket = _TargetRows({"id": "ticket-b", "client_id": "client-b", "priority": "high"})

    async def no_emit(*_args, **_kwargs):
        return None

    monkeypatch.setattr(automation_runtime, "db", SimpleNamespace(workflow_runs=run_rows, tickets=foreign_ticket))
    monkeypatch.setattr(automation_runtime, "_emit", no_emit)

    record = asyncio.run(automation_runtime.compensate_run("RUN-A", {"id": "tech-a"}, "Restore only if ownership is still valid"))

    assert record["status"] == "completed_with_conflicts"
    assert foreign_ticket.update_queries == [{"id": "ticket-b", "client_id": "client-a", "priority": "high"}]


@pytest.mark.parametrize(
    ("handler_name", "service_name", "operation"),
    [
        ("reject_automation_run", "decide_run_approval", "automation.run.reject"),
        ("retry_automation_run", "retry_run", "automation.run.retry"),
        ("execute_automation_compensation", "compensate_run", "automation.run.compensate"),
    ],
)
def test_foreign_run_control_is_masked_before_the_runtime_service(monkeypatch, handler_name, service_name, operation):
    called = []

    async def deny(run_id, user, received_operation, request=None):
        assert run_id == "RUN-FOREIGN"
        assert user == CLIENT_A_USER
        assert received_operation == operation
        raise HTTPException(status_code=404, detail="Resource not found")

    async def service(*_args, **_kwargs):
        called.append(True)
        return {"unexpected": True}

    monkeypatch.setattr(workflow_automation, "_run_in_scope", deny)
    monkeypatch.setattr(automation_runtime, service_name, service)
    handler = getattr(workflow_automation, handler_name)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(handler("RUN-FOREIGN", {"reason": "A sufficient recorded reason"}, None, CLIENT_A_USER))

    assert exc.value.status_code == 404
    assert called == []


def test_restricted_technician_cannot_read_a_foreign_client_workflow(monkeypatch):
    denials = _InsertRows()
    monkeypatch.setattr(scope_permissions, "db", SimpleNamespace(scope_denials=denials))
    monkeypatch.setattr(
        workflow_automation,
        "db",
        SimpleNamespace(workflows=_WorkflowRecord({
            "id": "wf-client-b",
            "scope": {"type": "client", "client_id": "client-b"},
        })),
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(workflow_automation._workflow_in_scope("wf-client-b", CLIENT_A_USER, "automation.workflow.read"))

    assert exc.value.status_code == 404
    assert denials.rows[0]["operation"] == "automation.workflow.read"
