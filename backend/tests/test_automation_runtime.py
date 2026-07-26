from app.services.automation_runtime import (
    compensation_preview,
    condition_matches,
    event_context,
    make_run_key,
    workflow_matches_event,
)


def test_event_context_flattens_payload_without_losing_envelope():
    context = event_context({
        "id": "evt-1",
        "subject": "backup.job.failed",
        "client_id": "client-1",
        "payload": {"device_id": "device-1", "severity": "critical"},
    })
    assert context["event_id"] == "evt-1"
    assert context["event_subject"] == "backup.job.failed"
    assert context["device_id"] == "device-1"
    assert context["client_id"] == "client-1"


def test_run_key_is_deterministic_for_event_deduplication():
    assert make_run_key("wf-1", "evt-1") == "wf-1:evt-1"
    assert make_run_key("wf-1", "evt-1") == make_run_key("wf-1", "evt-1")


def test_condition_operators_are_explicit_and_safe():
    context = {"severity": "critical", "count": 9, "tags": ["backup", "server"]}
    assert condition_matches({"field": "severity", "operator": "equals", "value": "CRITICAL"}, context)
    assert condition_matches({"field": "count", "operator": "greater_than", "value": "5"}, context)
    assert condition_matches({"field": "tags", "operator": "contains", "value": "server"}, context)
    assert not condition_matches({"field": "count", "operator": "less_than", "value": "5"}, context)


def test_platform_event_trigger_supports_subject_patterns():
    workflow = {
        "trigger": {"type": "platform_event", "event_subject": "backup.*"},
        "conditions": [{"field": "severity", "operator": "equals", "value": "critical"}],
    }
    event = {"subject": "backup.job.failed", "payload": {"severity": "critical"}}
    assert workflow_matches_event(workflow, event)
    assert not workflow_matches_event(workflow, {"subject": "ticket.created", "payload": {"severity": "critical"}})


def test_compensation_preview_reverses_execution_order_and_marks_manual_steps():
    preview = compensation_preview({
        "id": "RUN-1",
        "status": "failed",
        "checkpoints": [
            {"step_index": 0, "type": "change_priority", "entity": "ticket", "entity_id": "t-1", "field": "priority", "before": "low", "after": "high", "reversible": True},
            {"step_index": 1, "type": "add_note", "entity": "ticket_note", "entity_id": "n-1", "before": None, "after": "created", "reversible": False, "reason": "Audit notes are append-only"},
        ],
    })
    assert preview["can_execute"] is True
    assert preview["reversible_steps"] == 1
    assert preview["manual_review_steps"] == 1
    assert [step["step_index"] for step in preview["steps"]] == [1, 0]
