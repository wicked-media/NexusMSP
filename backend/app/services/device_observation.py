"""Safe, technician-facing projection of an Agent's latest endpoint observation.

The Agent document remains the authoritative operational record. This module
only selects non-sensitive evidence for the scoped device-detail response; it
never returns enrollment credentials, certificates, policy keys, or raw agent
configuration.
"""

from __future__ import annotations

from typing import Any


def _text(value: Any) -> str | None:
    value = str(value or "").strip()
    return value or None


def _boolean(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _whole_number(value: Any) -> int | None:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return None


def build_device_agent_observation(agent: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return bounded, honest device evidence from one already-scoped agent."""
    if not agent:
        return None

    hardware = agent.get("hardware") if isinstance(agent.get("hardware"), dict) else {}
    security = agent.get("security") if isinstance(agent.get("security"), dict) else {}
    dns = agent.get("nexus_dns") if isinstance(agent.get("nexus_dns"), dict) else {}
    remote = agent.get("native_remote_evidence") if isinstance(agent.get("native_remote_evidence"), dict) else {}

    return {
        "agent": {
            "online": bool(agent.get("online")),
            "last_seen": _text(agent.get("last_seen")),
            "version": _text(agent.get("agent_version")),
            "runtime_capabilities": [str(value) for value in agent.get("agent_runtime_capabilities", []) if isinstance(value, str)][:32],
        },
        "hardware": {
            "manufacturer": _text(hardware.get("manufacturer")),
            "model": _text(hardware.get("model")),
            "bios_version": _text(hardware.get("bios_version")),
        },
        "security": {
            "defender_installed": _boolean(security.get("defender_installed")),
            "defender_enabled": _boolean(security.get("defender_enabled")),
            "real_time_enabled": _boolean(security.get("real_time_enabled")),
            "firewall_enabled": _boolean(security.get("firewall_enabled")),
            "encryption_status": _text(security.get("encryption_status")),
            "pending_update_count": _whole_number(security.get("pending_update_count")),
        },
        "dns": {
            "enabled": _boolean(dns.get("enabled")),
            "mode": _text(dns.get("reported_mode") or dns.get("mode")),
            "status": _text(dns.get("status")),
        },
        "remote": {
            "status": _text(remote.get("status")),
            "detail": _text(remote.get("detail")),
            "observed_at": _text(remote.get("observed_at") or remote.get("reported_at")),
        },
    }
