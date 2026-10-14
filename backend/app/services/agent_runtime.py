"""Agent runtime — the deterministic core of the Nexus Agent control plane.

Stage 2 refactor: these functions were extracted verbatim from
``app/routers/nexus_agent.py`` so the router stays thin and this logic can be
tested and reasoned about on its own. Behaviour is deliberately unchanged:
version comparisons still refuse to treat unparseable builds as stale,
telemetry translation still preserves reported zeros, and installer packaging
remains deterministic.

Everything here is pure or self-contained: no database access, no request
state. The router passes agent-version and profile values in at call time so
its module-level configuration remains the single source of truth.
"""

from __future__ import annotations

import hashlib
import io
import ipaddress
import json
import re
import uuid
import zipfile
from datetime import datetime, timezone, timedelta
from typing import Any
from urllib.parse import urlsplit

from fastapi import HTTPException

from app.services.agent_trust import sign_update_manifest
from app.services.time_utils import now_iso

ONLINE_WINDOW_SECONDS = 180

# Bundled into every newly generated Windows installer. This profile enables
# evidence collection and Canary integrity monitoring only; it does not claim
# to install an AV/EDR or silently change Defender, firewall or user settings.
NEXUS_SHIELD_AGENT_PROFILE = {
    "enabled": True,
    "posture_telemetry": True,
    "canary_enabled": True,
    "canary_check_secs": 30,
    "auto_deploy_canary": True,
}

# Every newly generated installer also carries the Nexus DNS control-plane
# profile. Visibility is the safe default: the installer does not change the
# endpoint resolver until a technician approves a staged deployment and a
# trusted resolver edge has attested healthy.
NEXUS_DNS_AGENT_PROFILE = {
    "enabled": True,
    "mode": "visibility",
    "transport": "doh",
    "resolver_endpoints": [],
    "bypass_detection": True,
    "local_policy_cache": True,
    "restore_previous_dns_on_remove": True,
    "enforcement_ready": False,
}

# Native Backup v1 is a zero-side-effect capability inventory. It cannot grant
# source-file access, VSS snapshots, data transport, or restores.
NEXUS_BACKUP_AGENT_PROFILE = {
    "schema_version": 1,
    "enabled": True,
    "mode": "capability_inventory",
    "report_interval_seconds": 3600,
    "preflight_allowed": True,
    "execution_allowed": False,
    "file_access_allowed": False,
    "snapshot_allowed": False,
    "upload_allowed": False,
    "restore_allowed": False,
}

_AGENT_VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$")


def agent_version_tuple(value: str) -> tuple[int, int, int] | None:
    """Parse the release number without treating an unknown version as stale.

    Agents can carry a development or vendor-suffixed build label.  We only
    advertise an update when both ends have a comparable semantic release
    number, which prevents the control plane from accidentally offering a
    downgrade to a newer or unmanaged build.
    """
    match = _AGENT_VERSION_RE.match(value.strip())
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def agent_release_state(current_version: str, target_version: str) -> str:
    current = agent_version_tuple(current_version)
    target = agent_version_tuple(target_version)
    if not current or not target:
        return "version_unparseable"
    if current < target:
        return "update_available"
    if current == target:
        return "current"
    return "ahead_or_unmanaged"


def agent_supports_remote_companion(agent_version: str, server_version: str) -> bool:
    """Return whether an agent meets the server's minimum companion contract.

    The release label may differ when a compatible agent has been rebuilt with
    a newer vendor suffix.  Treating that as an exact-version mismatch blocks
    the signed companion reconciler indefinitely, even though the endpoint is
    newer than the control-plane minimum.
    """
    return agent_release_state(agent_version, server_version) in {"current", "ahead_or_unmanaged"}


def validate_agent_server_url(value: str, *, allow_empty: bool = True) -> str:
    """Validate an agent callback origin before it is placed in an installer.

    Agent credentials and device telemetry must not be sent across a cleartext
    network.  HTTP is deliberately limited to loopback development so local
    developers can run the stack without weakening deployed endpoint safety.
    """
    raw = value.strip().rstrip("/")
    if not raw:
        if allow_empty:
            return ""
        raise HTTPException(422, "Nexus Agent callback URL is required")
    parsed = urlsplit(raw)
    if parsed.scheme.lower() not in {"https", "http"} or not parsed.hostname:
        raise HTTPException(422, "Nexus Agent callback URL must be an absolute HTTP(S) URL")
    if parsed.username or parsed.password or parsed.fragment or parsed.query:
        raise HTTPException(422, "Nexus Agent callback URL cannot contain credentials, a query, or a fragment")
    if parsed.scheme.lower() == "http":
        host = parsed.hostname.lower()
        is_loopback = host == "localhost"
        if not is_loopback:
            try:
                is_loopback = ipaddress.ip_address(host).is_loopback
            except ValueError:
                is_loopback = False
        if not is_loopback:
            raise HTTPException(422, "Nexus Agent callback URL must use HTTPS outside local loopback development")
    return raw


def timestamp_has_expired(value: Any) -> bool:
    """Fail closed when a capability timestamp is absent or malformed."""
    if not value:
        return True
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
    except (TypeError, ValueError):
        return True


def online_cutoff(window_seconds: int = ONLINE_WINDOW_SECONDS) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=window_seconds)).isoformat()


def is_online(last_seen: Any, window_seconds: int = ONLINE_WINDOW_SECONDS) -> bool:
    try:
        last = datetime.fromisoformat(str(last_seen or "").replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - last).total_seconds() < window_seconds
    except (TypeError, ValueError):
        return False


def is_agent_admin(user: dict) -> bool:
    role = str(user.get("role") or "").lower()
    return bool(user.get("is_admin") or role in {"admin", "owner"})


def can_execute_agent_commands(user: dict) -> bool:
    if is_agent_admin(user):
        return True
    permissions = user.get("permissions") or {}
    return bool((permissions.get("agent_commands") or {}).get("execute"))


def agent_device_telemetry(snapshot: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    """Translate the lightweight agent heartbeat into the schema used by Devices.

    The agent deliberately reports a compact cross-platform snapshot.  Keeping
    the translation here makes agent-enrolled endpoints look identical to
    devices reported by the legacy full inventory agent.
    """
    disks = snapshot.get("disks") or []
    nics = snapshot.get("nics") or []

    def _number(value: Any) -> float | None:
        """Preserve a reported zero, but never turn an absent value into zero."""
        if value is None or value == "":
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    disk_percentages = [value for value in (_number(disk.get("percent")) for disk in disks) if value is not None]
    disk_totals = [value for value in (_number(disk.get("total_gb")) for disk in disks) if value is not None]
    disk_used = [value for value in (_number(disk.get("used_gb")) for disk in disks) if value is not None]
    disk_percent = max(disk_percentages) if disk_percentages else None
    total_gb = round(sum(disk_totals), 2) if disk_totals else None
    used_gb = round(sum(disk_used), 2) if disk_used else None
    uptime_raw = _number(snapshot.get("uptime_sec"))
    uptime_seconds = int(uptime_raw) if uptime_raw is not None else None
    cpu_percent = _number(snapshot.get("cpu_percent"))
    memory_percent = _number(snapshot.get("mem_percent"))
    cpu_count = _number(snapshot.get("cpu_count"))
    memory_total_mb = _number(snapshot.get("mem_total_mb"))

    # Prefer a routable IPv4 address. Link-local addresses are not useful for
    # a technician trying to identify or reach the endpoint.
    ip_address = ""
    for nic in nics:
        for address in nic.get("ipv4") or []:
            value = str(address).split("/")[0]
            if value and not value.startswith(("127.", "169.254.")) and ":" not in value:
                ip_address = value
                break
        if ip_address:
            break

    device_update = {
        # DeviceDetailPage gauges use these canonical names.
        "cpu_usage": cpu_percent,
        "memory_usage": memory_percent,
        "disk_usage": disk_percent,
        # Keep the compact list-view fields in sync as well.
        "cpu_load": cpu_percent,
        "memory_pct": memory_percent,
        "disk_pct": disk_percent,
        "processor": str(snapshot.get("cpu_model") or "").strip(),
        "processor_cores": int(cpu_count) if cpu_count is not None else None,
        "ram_gb": round(memory_total_mb / 1024, 1) if memory_total_mb is not None else None,
        "storage_total_gb": total_gb,
        "storage_used_gb": used_gb,
        "storage_free_gb": round(total_gb - used_gb, 2) if total_gb is not None and used_gb is not None else None,
        "uptime_sec": uptime_seconds,
        "uptime_hours": round(uptime_seconds / 3600, 1) if uptime_seconds is not None else None,
        "uptime_display": f"{uptime_seconds // 86400}d {(uptime_seconds % 86400) // 3600}h" if uptime_seconds is not None else None,
    }
    if snapshot.get("boot_time"):
        device_update["last_reboot"] = datetime.fromtimestamp(int(snapshot["boot_time"]), tz=timezone.utc).isoformat()
    if snapshot.get("os_version"):
        device_update["os_build"] = str(snapshot["os_version"]).split("Build ")[-1]
    if ip_address:
        device_update["ip_address"] = ip_address

    security = snapshot.get("security") or {}
    if security:
        defender_enabled = bool(security.get("defender_enabled"))
        realtime_enabled = bool(security.get("real_time_enabled"))
        firewall_enabled = bool(security.get("firewall_enabled"))
        signature_age_raw = _number(security.get("signature_age_days"))
        signature_age = int(signature_age_raw) if signature_age_raw is not None else None
        pending_updates_raw = _number(security.get("pending_update_count"))
        pending_updates = int(pending_updates_raw) if pending_updates_raw is not None else None
        encryption = str(security.get("encryption_status") or "Unknown")
        # Transparent scoring: 40 Defender + 20 signatures + 20 firewall +
        # 10 patch status + 10 encryption. Each input remains visible in UI.
        score = 0
        score += 40 if defender_enabled and realtime_enabled else 0
        score += 20 if signature_age is not None and signature_age <= 3 else (10 if signature_age is not None and signature_age <= 7 else 0)
        score += 20 if firewall_enabled else 0
        score += 10 if pending_updates == 0 else 0
        score += 10 if any(marker in encryption.lower() for marker in ("encrypted", "bitlocker on", "protection on")) else 0
        device_update.update({
            "security_assessed_at": now_iso(),
            "compliance_score": score,
            "antivirus": "Microsoft Defender" if security.get("defender_installed") else "Not detected",
            "antivirus_status": "active" if defender_enabled and realtime_enabled else "inactive",
            "edr_status": "active" if defender_enabled and realtime_enabled else "inactive",
            "defender_real_time_enabled": realtime_enabled,
            "defender_signature_age_days": signature_age,
            "firewall_enabled": firewall_enabled,
            "encryption_status": encryption,
            "pending_patches": pending_updates,
        })
    hardware = snapshot.get("hardware") or {}
    if hardware:
        device_update.update({key: str(hardware.get(key) or "") for key in ("manufacturer", "model", "serial_number", "bios_version", "domain")})

    disk_records = [
        {
            "id": str(uuid.uuid4()),
            "drive_letter": disk.get("device") or disk.get("mount") or "",
            "mount_point": disk.get("mount") or disk.get("device") or "",
            "file_system": disk.get("fs_type") or "",
            "total_gb": round(float(disk.get("total_gb") or 0), 2),
            "used_gb": round(float(disk.get("used_gb") or 0), 2),
            "free_gb": round(float(disk.get("total_gb") or 0) - float(disk.get("used_gb") or 0), 2),
            "usage_percent": round(float(disk.get("percent") or 0), 2),
            "disk_type": "Unknown",
            "smart_status": "Unknown",
        }
        for disk in disks
    ]
    network_records = [
        {
            "id": str(uuid.uuid4()),
            "adapter_name": nic.get("name") or "Unknown adapter",
            "mac_address": nic.get("mac") or "",
            "ip_address": next((str(v).split("/")[0] for v in (nic.get("ipv4") or []) if ":" not in str(v) and not str(v).startswith("169.254.")), ""),
            "subnet": next((str(v).split("/")[1] for v in (nic.get("ipv4") or []) if ":" not in str(v) and "/" in str(v)), ""),
            "ip_addresses": nic.get("ipv4") or [], "type": nic.get("type") or "ethernet",
            "status": nic.get("status") or "down", "gateway": nic.get("gateway") or "",
            "dns": nic.get("dns") or [], "speed_mbps": nic.get("speed_mbps") or 0,
        }
        for nic in nics
    ]
    return device_update, disk_records, network_records


def patch_evidence_update(snapshot: dict[str, Any], observed_at: str) -> dict[str, Any]:
    """Return only the patch fields supported by this exact agent payload.

    Heartbeat liveness and patch-collector liveness are deliberately separate:
    no count is better than a stale zero when a technician is deciding whether
    an endpoint is actually current.
    """
    security_snapshot = snapshot.get("security") if isinstance(snapshot.get("security"), dict) else {}
    raw_pending_count = security_snapshot.get("pending_update_count")
    try:
        parsed_pending_count = float(raw_pending_count)
        pending_count = int(parsed_pending_count) if parsed_pending_count >= 0 and parsed_pending_count.is_integer() else None
    except (TypeError, ValueError):
        pending_count = None
    return {
        "patch_evidence_state": "reported" if pending_count is not None else "not_reported",
        "patch_evidence_source": "nexus-agent" if pending_count is not None else None,
        "patch_evidence_observed_at": observed_at if pending_count is not None else None,
        "patch_evidence_not_reported_at": None if pending_count is not None else observed_at,
        "pending_patches": pending_count,
    }


def build_installer_zip(
    client_id: str,
    client_name: str,
    enrollment_token: str,
    server_url: str,
    binary_bytes: bytes,
    chat_companion_bytes: bytes | None = None,
    tray_companion_bytes: bytes | None = None,
    remote_companion_bytes: bytes | None = None,
    heartbeat_secs: int = 60,
    poll_secs: int = 10,
    *,
    agent_version: str,
) -> bytes:
    """Build a deterministic ZIP containing the service agent and companions.

    The package carries a signed release manifest so a technician can inspect
    the exact binary supplied at installation time.  The running agent still
    independently verifies signed update manifests before auto-updating.
    """
    config = {
        "server_url": server_url,
        "enrollment_token": enrollment_token,
        "client_id": client_id,
        "client_name": client_name,
        "heartbeat_secs": heartbeat_secs,
        "poll_secs": poll_secs,
        "nexus_shield": NEXUS_SHIELD_AGENT_PROFILE,
        "nexus_dns": NEXUS_DNS_AGENT_PROFILE,
    }
    companion_copy_line = (
        'copy /Y "%~dp0nexus-client-chat.exe" "%INSTDIR%\\nexus-client-chat.exe" >nul\r\n'
        'if errorlevel 1 ( echo Could not copy nexus-client-chat.exe & exit /b 1 )\r\n'
        if chat_companion_bytes else ""
    )
    tray_copy_line = (
        'copy /Y "%~dp0nexus-agent-tray.exe" "%INSTDIR%\\nexus-agent-tray.exe" >nul\r\n'
        'if errorlevel 1 ( echo Could not copy nexus-agent-tray.exe & exit /b 1 )\r\n'
        if tray_companion_bytes else ""
    )
    remote_copy_line = (
        'copy /Y "%~dp0nexus-remote-companion.exe" "%INSTDIR%\\nexus-remote-companion.exe" >nul\r\n'
        'if errorlevel 1 ( echo Could not copy nexus-remote-companion.exe & exit /b 1 )\r\n'
        if remote_companion_bytes else ""
    )
    companion_start_menu_lines = (
        'if not exist "%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs\\NexusMSP" mkdir "%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs\\NexusMSP"\r\n'
        'copy /Y "%~dp0Open Nexus Client Chat.bat" "%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs\\NexusMSP\\Nexus Client Chat.bat" >nul\r\n'
        if chat_companion_bytes else ""
    )
    agent_sha256 = hashlib.sha256(binary_bytes).hexdigest()
    release_manifest = {
        "schema_version": 1,
        "agent_version": agent_version,
        "sha256": agent_sha256,
        "size": len(binary_bytes),
        "bundled_components": {
            "client_chat": bool(chat_companion_bytes),
            "agent_tray": bool(tray_companion_bytes),
            "native_remote": bool(remote_companion_bytes),
        },
        **sign_update_manifest(version=agent_version, sha256=agent_sha256, size=len(binary_bytes)),
    }
    install_bat = (
        "@echo off\r\n"
        "REM NexusOps Agent installer\r\n"
        "setlocal\r\n"
        "set INSTDIR=%ProgramFiles%\\NexusOps Agent\r\n"
        "echo Installing NexusOps Agent to %INSTDIR%\r\n"
        "if not exist \"%INSTDIR%\" mkdir \"%INSTDIR%\"\r\n"
        "sc query NexusOpsAgent >nul 2>&1\r\n"
        "if not errorlevel 1 (\r\n"
        "  echo Stopping existing NexusOps Agent service...\r\n"
        "  sc stop NexusOpsAgent >nul 2>&1\r\n"
        "  timeout /t 3 /nobreak >nul\r\n"
        ")\r\n"
        "REM A previous interrupted install can leave a stopped service process holding the binary.\r\n"
        "REM This image name is reserved for NexusOps Agent and is stopped before replacing its files.\r\n"
        "taskkill /F /IM nexus-agent.exe >nul 2>&1\r\n"
        "timeout /t 2 /nobreak >nul\r\n"
        "copy /Y \"%~dp0nexus-agent.exe\" \"%INSTDIR%\\nexus-agent.exe\" >nul\r\n"
        "if errorlevel 1 ( echo Could not copy nexus-agent.exe & exit /b 1 )\r\n"
        "copy /Y \"%~dp0config.json\"     \"%INSTDIR%\\config.json\"     >nul\r\n"
        "if errorlevel 1 ( echo Could not copy config.json & exit /b 1 )\r\n"
        "icacls \"%INSTDIR%\\config.json\" /inheritance:r /grant:r \"*S-1-5-18:(F)\" \"*S-1-5-32-544:(F)\" >nul\r\n"
        "if errorlevel 1 ( echo Could not protect config.json & exit /b 1 )\r\n"
        + companion_copy_line
        + tray_copy_line
        + remote_copy_line
        + companion_start_menu_lines
        + "cd /d \"%INSTDIR%\"\r\n"
        "\"%INSTDIR%\\nexus-agent.exe\" -run install\r\n"
        "if errorlevel 1 (\r\n"
        "  echo Install failed. Run this script as Administrator.\r\n"
        "  exit /b 1\r\n"
        ")\r\n"
        "echo NexusOps Agent installed and started.\r\n"
        "endlocal\r\n"
    )
    uninstall_bat = (
        "@echo off\r\n"
        "set INSTDIR=%ProgramFiles%\\NexusOps Agent\r\n"
        "\"%INSTDIR%\\nexus-agent.exe\" -run uninstall\r\n"
        "rd /S /Q \"%INSTDIR%\" 2>nul\r\n"
        "echo NexusOps Agent uninstalled.\r\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("nexus-agent.exe", binary_bytes)
        z.writestr("release-manifest.json", json.dumps(release_manifest, indent=2, sort_keys=True))
        if chat_companion_bytes:
            z.writestr("nexus-client-chat.exe", chat_companion_bytes)
            z.writestr("Open Nexus Client Chat.bat", "@echo off\r\n\"%ProgramFiles%\\NexusOps Agent\\nexus-client-chat.exe\"\r\n")
        if tray_companion_bytes:
            z.writestr("nexus-agent-tray.exe", tray_companion_bytes)
        if remote_companion_bytes:
            z.writestr("nexus-remote-companion.exe", remote_companion_bytes)
        z.writestr("config.json", json.dumps(config, indent=2))
        z.writestr("install.bat", install_bat)
        z.writestr("uninstall.bat", uninstall_bat)
        z.writestr("README.txt",
                   "NexusOps Agent\n\n"
                   "1) Review release-manifest.json, then right-click install.bat -> Run as Administrator\n"
                   "2) Agent will register itself as the 'NexusOpsAgent' Windows service\n"
                   "3) Existing NexusOps Agent services are stopped, reconfigured and restarted safely\n"
                   "4) Within 60 seconds the device will appear in NexusOps -> Devices\n\n"
                   "The callback URL uses HTTPS except for explicit local loopback development.\n"
                   "To remove: run uninstall.bat as Administrator.\n")
    return buf.getvalue()
