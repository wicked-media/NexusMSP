[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern("^https?://")]
  [string]$ControlPlaneUrl,

  [Parameter(Mandatory)]
  [string]$DeploymentId,

  [Parameter(Mandatory)]
  [string]$ActivationCode,

  [string[]]$Roles = @("discovery_probe", "network_monitor", "jump_gateway"),

  [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA "NexusMSP\EdgeLab"),

  [string]$InstanceId = $env:COMPUTERNAME
)

<#!
.SYNOPSIS
Starts a native Windows Nexus Edge in foreground lab mode.

.DESCRIPTION
This script is intentionally a lab launcher, not a service installer. It
builds the Edge executable locally, exchanges a one-time activation code for a
persisted identity, and remains in the foreground so its first heartbeat can
be reviewed. It does not open firewall ports or install remote transport.
#>

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$go = Get-Command go -ErrorAction Stop
$binary = Join-Path $root "agent\dist\nexus-edge.exe"
$statePath = Join-Path $StateDirectory "state.json"

if ([string]::IsNullOrWhiteSpace($ActivationCode) -or $ActivationCode.Length -lt 20) {
  throw "A valid one-time Deployment Hub activation code is required."
}
if (-not $Roles -or $Roles.Count -eq 0) {
  throw "Select at least one approved Nexus Edge role."
}

New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
Write-Host "[Nexus Edge] Building native lab companion..."
Push-Location (Join-Path $root "agent")
try {
  & $go.Source build -trimpath -ldflags "-s -w" -o $binary "./cmd/nexus-edge" 2>&1 |
    ForEach-Object { Write-Host $_ }
} finally {
  Pop-Location
}
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $binary)) {
  throw "Nexus Edge build failed."
}

$env:NEXUS_CONTROL_PLANE_URL = $ControlPlaneUrl.TrimEnd("/")
$env:NEXUS_DEPLOYMENT_ID = $DeploymentId
$env:NEXUS_ACTIVATION_CODE = $ActivationCode
$env:NEXUS_EDGE_STATE_PATH = $statePath
$env:NEXUS_EDGE_INSTANCE_ID = $InstanceId
$env:NEXUS_EDGE_ROLES = ($Roles -join ",")
$env:NEXUS_JUMP_TRANSPORT = "disabled"

Write-Host "[Nexus Edge] Starting lab session for $DeploymentId as $InstanceId."
Write-Host "[Nexus Edge] Roles: $($Roles -join ', '). No inbound port or tunnel will be created."
Write-Host "[Nexus Edge] Press Ctrl+C after the authenticated heartbeat is visible in Deployment Hub."
& $binary
