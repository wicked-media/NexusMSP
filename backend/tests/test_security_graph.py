from app.routers.security_graph import _group_canary_triggers


def test_group_canary_triggers_collapses_repeated_endpoint_signals():
    triggers = [
        {
            "id": "event-1",
            "client_id": "client-1",
            "device_id": "device-1",
            "device_name": "RECEPTION-PC",
            "trigger_type": "file_modified",
            "file_path": "C:/Nexus/Finance.xlsx",
            "triggered_at": "2026-08-03T08:00:00+00:00",
        },
        {
            "id": "event-2",
            "client_id": "client-1",
            "device_id": "device-1",
            "device_name": "RECEPTION-PC",
            "trigger_type": "file_modified",
            "file_path": "C:/Nexus/Finance.xlsx",
            "triggered_at": "2026-08-03T08:03:00+00:00",
        },
        {
            "id": "event-3",
            "client_id": "client-1",
            "device_id": "device-1",
            "device_name": "RECEPTION-PC",
            "trigger_type": "file_deleted",
            "file_path": "C:/Nexus/HR.docx",
            "triggered_at": "2026-08-03T08:05:00+00:00",
        },
    ]

    grouped = _group_canary_triggers(triggers)

    assert len(grouped) == 1
    assert grouped[0]["id"] == "event-3"
    assert grouped[0]["_event_count"] == 3
    assert grouped[0]["_first_triggered_at"] == "2026-08-03T08:00:00+00:00"
    assert grouped[0]["_last_triggered_at"] == "2026-08-03T08:05:00+00:00"
    assert grouped[0]["_file_paths"] == [
        "C:/Nexus/Finance.xlsx",
        "C:/Nexus/HR.docx",
    ]
    assert grouped[0]["_trigger_types"] == ["file_modified", "file_deleted"]


def test_group_canary_triggers_keeps_clients_and_endpoints_separate():
    triggers = [
        {"client_id": "client-1", "device_id": "device-1"},
        {"client_id": "client-1", "device_id": "device-2"},
        {"client_id": "client-2", "device_id": "device-1"},
    ]

    grouped = _group_canary_triggers(triggers)

    assert len(grouped) == 3
    assert all(item["_event_count"] == 1 for item in grouped)
