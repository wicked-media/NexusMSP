"""Regression checks for the privileged Windows Agent endpoint-repair helper."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "Repair-NexusAgentEndpoint.ps1"


def test_agent_recovery_script_keeps_remote_control_planes_on_https():
    source = SCRIPT.read_text(encoding="utf-8")

    assert "function Test-NexusLoopbackHost" in source
    assert '$target.Scheme -eq "http" -and -not (Test-NexusLoopbackHost -HostName $target.Host)' in source
    assert "HTTP is permitted only for an explicit localhost recovery target" in source


def test_agent_recovery_script_restores_secret_acl_for_backup_temp_and_final_config():
    source = SCRIPT.read_text(encoding="utf-8")

    assert "function Protect-NexusAgentConfig" in source
    assert '"*S-1-5-18:(F)"' in source
    assert '"*S-1-5-32-544:(F)"' in source
    assert "Protect-NexusAgentConfig -Path $backupPath" in source
    assert "Protect-NexusAgentConfig -Path $temporaryPath" in source
    assert source.count("Protect-NexusAgentConfig -Path $configPath") >= 2
