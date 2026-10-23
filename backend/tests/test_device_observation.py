from app.services.device_observation import build_device_agent_observation


def test_device_observation_only_exposes_bounded_technician_evidence():
    result = build_device_agent_observation({
        "online": True,
        "last_seen": "2026-10-16T04:30:00Z",
        "agent_version": "0.1.20",
        "agent_runtime_capabilities": ["native_remote_v1", 5],
        "agent_token": "must-never-leak",
        "hardware": {"manufacturer": "Nexus", "model": "Endpoint", "bios_version": "F1", "serial_number": "private"},
        "security": {"defender_enabled": True, "real_time_enabled": True, "firewall_enabled": False, "pending_update_count": "2"},
        "nexus_dns": {"enabled": True, "mode": "visibility", "status": "profile_reported", "api_key": "private"},
        "native_remote_evidence": {"status": "ready", "detail": "Verified", "observed_at": "2026-10-16T04:30:00Z"},
    })

    assert result["agent"]["online"] is True
    assert result["agent"]["runtime_capabilities"] == ["native_remote_v1"]
    assert result["hardware"] == {"manufacturer": "Nexus", "model": "Endpoint", "bios_version": "F1"}
    assert result["security"]["pending_update_count"] == 2
    assert result["dns"] == {"enabled": True, "mode": "visibility", "status": "profile_reported"}
    assert "agent_token" not in str(result)
    assert "api_key" not in str(result)
    assert "serial_number" not in str(result)


def test_device_observation_distinguishes_missing_evidence():
    result = build_device_agent_observation({"online": False, "security": {"pending_update_count": "bad"}})

    assert result["security"]["defender_enabled"] is None
    assert result["security"]["pending_update_count"] is None
    assert result["remote"]["status"] is None
    assert build_device_agent_observation(None) is None
