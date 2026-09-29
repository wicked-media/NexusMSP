[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$SourceDirectory,
  [string]$AgentHome = "${env:ProgramFiles}\NexusOps Agent",
  [string]$AgentServiceName = "NexusOpsAgent"
)

$ErrorActionPreference = "Stop"

function Test-NexusAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-NexusAdministrator)) {
  throw "Run this upgrade from an elevated PowerShell session. It replaces protected Nexus Agent binaries and restarts the service."
}

$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$required = "nexus-agent.exe", "nexus-agent-tray.exe", "nexus-client-chat.exe", "nexus-remote-companion.exe"
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $source $name))) {
    throw "Required signed release binary is missing: $name"
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $AgentHome "config.json"))) {
  throw "The existing protected agent configuration was not found. Refusing an upgrade that could change endpoint identity."
}
if (-not (Get-Service -Name $AgentServiceName -ErrorAction SilentlyContinue)) {
  throw "The $AgentServiceName service is not installed. Use the signed installer for first installation."
}

$backup = Join-Path $AgentHome ("backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$service = Get-Service -Name $AgentServiceName
$wasRunning = $service.Status -eq "Running"
$agentProcesses = @(Get-Process -Name "nexus-agent" -ErrorAction SilentlyContinue)
$remoteCompanions = @(Get-Process -Name "nexus-remote-companion" -ErrorAction SilentlyContinue)

if (-not $PSCmdlet.ShouldProcess($AgentHome, "Replace Nexus Agent release binaries while preserving config.json")) {
  return
}

New-Item -ItemType Directory -Path $backup -Force | Out-Null
try {
  if ($wasRunning) {
    Stop-Service -Name $AgentServiceName -Force
    (Get-Service -Name $AgentServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
    # Service Control Manager can report Stopped before the Go process has
    # released its executable handle. Do not create a mixed Agent/Companion
    # release by copying while that handle is still open.
    foreach ($agentProcess in $agentProcesses) {
      if (Get-Process -Id $agentProcess.Id -ErrorAction SilentlyContinue) {
        try {
          Wait-Process -Id $agentProcess.Id -Timeout 30 -ErrorAction Stop
        } catch {
          throw "Nexus Agent process $($agentProcess.Id) did not exit after the service stopped. Aborting the release upgrade."
        }
      }
    }
  }

  # The user-session Remote Companion is a separately registered executable.
  # Stop only this verified component before replacement so its open image
  # handle cannot leave the signed release partially upgraded. The caller
  # restarts it in the active user session after the protected service is up.
  foreach ($companion in $remoteCompanions) {
    Stop-Process -Id $companion.Id -Force -ErrorAction Stop
  }

  foreach ($name in $required) {
    $destination = Join-Path $AgentHome $name
    if (Test-Path -LiteralPath $destination) {
      Copy-Item -LiteralPath $destination -Destination (Join-Path $backup $name) -Force
    }
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination $destination -Force
  }

  # The Remote Companion must run in the interactive user's session; the
  # protected service runs in session zero and cannot display attended consent.
  $runKey = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
  New-ItemProperty -Path $runKey -Name "NexusRemoteCompanion" -PropertyType String -Value ('"' + (Join-Path $AgentHome "nexus-remote-companion.exe") + '"') -Force | Out-Null

  Start-Service -Name $AgentServiceName
  (Get-Service -Name $AgentServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
  Write-Host "Nexus Agent binary upgrade succeeded. Existing config.json and endpoint identity were preserved."
} catch {
  foreach ($name in $required) {
    $saved = Join-Path $backup $name
    if (Test-Path -LiteralPath $saved) {
      Copy-Item -LiteralPath $saved -Destination (Join-Path $AgentHome $name) -Force -ErrorAction SilentlyContinue
    }
  }
  if ($wasRunning) {
    Start-Service -Name $AgentServiceName -ErrorAction SilentlyContinue
  }
  throw
}
