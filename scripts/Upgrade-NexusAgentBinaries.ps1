[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$SourceDirectory,
  [string]$AgentHome = "${env:ProgramFiles}\NexusOps Agent",
  [string]$AgentServiceName = "NexusOpsAgent",
  # Recovery only: restore a stopped service whose protected installation
  # directory was removed, using the identity material beside the release
  # binaries. This is deliberately opt-in so a routine upgrade can never
  # replace a missing endpoint identity with arbitrary source material.
  [switch]$BootstrapMissingInstall
)

$ErrorActionPreference = "Stop"

function Test-NexusAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Protect-NexusAgentIdentityFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  & icacls $Path /inheritance:r /grant:r "*S-1-5-18:(F)" "*S-1-5-32-544:(F)" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not protect Nexus Agent identity material at $Path."
  }
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
$configPath = Join-Path $AgentHome "config.json"
$bootstrapConfig = $null
$bootstrapIdentityFiles = @()
if (-not (Test-Path -LiteralPath $configPath)) {
  if (-not $BootstrapMissingInstall) {
    throw "The existing protected agent configuration was not found. Refusing an upgrade that could change endpoint identity. Supply -BootstrapMissingInstall only with the preserved release directory for this endpoint."
  }
  $sourceConfigPath = Join-Path $source "config.json"
  if (-not (Test-Path -LiteralPath $sourceConfigPath)) {
    throw "Missing protected configuration at $sourceConfigPath; cannot bootstrap endpoint identity."
  }
  try {
    $bootstrapConfig = Get-Content -LiteralPath $sourceConfigPath -Raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "Could not read the preserved Nexus Agent configuration."
  }
  foreach ($field in @("server_url", "device_id", "agent_token")) {
    if ([string]::IsNullOrWhiteSpace([string]$bootstrapConfig.$field)) {
      throw "The preserved Nexus Agent configuration is missing $field; refusing to create a new endpoint identity."
    }
  }
  if (-not $bootstrapConfig.device_identity) {
    throw "The preserved Nexus Agent configuration has no device identity; refusing to bootstrap."
  }
  foreach ($identityFile in @(
    @{ Field = "certificate_path"; Target = "device-cert.pem" },
    @{ Field = "private_key_path"; Target = "device-key.pem" },
    @{ Field = "ca_certificate_path"; Target = "nexus-agent-ca.pem" }
  )) {
    $sourceIdentityPath = [string]$bootstrapConfig.device_identity.($identityFile.Field)
    if ([string]::IsNullOrWhiteSpace($sourceIdentityPath) -or -not (Test-Path -LiteralPath $sourceIdentityPath -PathType Leaf)) {
      throw "The preserved endpoint identity file for $($identityFile.Field) is unavailable; refusing to bootstrap."
    }
    $bootstrapIdentityFiles += @{ Field = $identityFile.Field; Target = $identityFile.Target; Source = $sourceIdentityPath }
  }
}
if (-not (Get-Service -Name $AgentServiceName -ErrorAction SilentlyContinue)) {
  throw "The $AgentServiceName service is not installed. Use the signed installer for first installation."
}

$backup = Join-Path $AgentHome ("backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$service = Get-Service -Name $AgentServiceName
$wasRunning = $service.Status -eq "Running"
$agentProcesses = @(Get-Process -Name "nexus-agent" -ErrorAction SilentlyContinue)
$userSessionProcesses = @(
  Get-Process -Name "nexus-remote-companion", "nexus-client-chat", "nexus-agent-tray" -ErrorAction SilentlyContinue
)

if (-not $PSCmdlet.ShouldProcess($AgentHome, "Replace Nexus Agent release binaries while preserving config.json")) {
  return
}

New-Item -ItemType Directory -Path $AgentHome -Force | Out-Null
New-Item -ItemType Directory -Path $backup -Force | Out-Null
try {
  if (Test-Path -LiteralPath $configPath) {
    Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup "config.json") -Force
  }
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

  # Every user-session companion is an independently running executable. Stop
  # and wait for all of them before any copy so a locked chat or tray binary
  # cannot strand the endpoint in a mixed release.
  foreach ($process in $userSessionProcesses) {
    # The Remote Companion can be waiting on its visible WPF approval child.
    # Stopping only the parent leaves that child attached and can keep the
    # executable handle open.  Terminate the bounded process tree before a
    # paired release swap so an upgrade either completes atomically or aborts.
    & taskkill.exe /PID $process.Id /T /F | Out-Null
  }
  foreach ($process in $userSessionProcesses) {
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        while ((Get-Process -Id $process.Id -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
          Start-Sleep -Milliseconds 200
        }
        if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
          throw "Nexus user-session process $($process.Id) did not exit. Aborting the release upgrade."
        }
    }
  }

  if ($bootstrapConfig) {
    # The source configuration was preserved with this endpoint's release,
    # not generated for this recovery. Rebase certificate paths into the
    # protected install directory so the LocalSystem service never relies on
    # a developer checkout or user profile directory.
    $identity = $bootstrapConfig.device_identity
    foreach ($identityFile in $bootstrapIdentityFiles) {
      $targetIdentityPath = Join-Path $AgentHome $identityFile.Target
      Copy-Item -LiteralPath $identityFile.Source -Destination $targetIdentityPath -Force
      Protect-NexusAgentIdentityFile -Path $targetIdentityPath
      $identity.($identityFile.Field) = $targetIdentityPath
    }
    $bootstrapConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configPath -Encoding UTF8 -NoNewline
    Protect-NexusAgentIdentityFile -Path $configPath
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
  if (Test-Path -LiteralPath (Join-Path $backup "config.json")) {
    Copy-Item -LiteralPath (Join-Path $backup "config.json") -Destination $configPath -Force -ErrorAction SilentlyContinue
  } elseif ($bootstrapConfig) {
    Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
    foreach ($identityFile in $bootstrapIdentityFiles) {
      Remove-Item -LiteralPath (Join-Path $AgentHome $identityFile.Target) -Force -ErrorAction SilentlyContinue
    }
  }
  if ($wasRunning) {
    Start-Service -Name $AgentServiceName -ErrorAction SilentlyContinue
  }
  throw
}
