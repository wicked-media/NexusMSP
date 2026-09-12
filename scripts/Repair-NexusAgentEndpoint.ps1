[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ServerUrl,
  [string]$AgentServiceName = "NexusOpsAgent",
  [string]$AgentHome = "${env:ProgramFiles}\NexusOps Agent"
)

$ErrorActionPreference = "Stop"

function Test-NexusAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-NexusLoopbackHost {
  param([Parameter(Mandatory = $true)][string]$HostName)

  if ($HostName -ieq "localhost") {
    return $true
  }
  $address = $null
  return [System.Net.IPAddress]::TryParse($HostName, [ref]$address) -and [System.Net.IPAddress]::IsLoopback($address)
}

function Protect-NexusAgentConfig {
  param([Parameter(Mandatory = $true)][string]$Path)

  # Use SIDs rather than English group names so the recovery path works on
  # localized Windows installations. The service and local Administrators are
  # the only principals that need the long-lived Agent identity material.
  & icacls $Path /inheritance:r /grant:r "*S-1-5-18:(F)" "*S-1-5-32-544:(F)" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not restore the protected ACL on $Path."
  }
}

if (-not (Test-NexusAdministrator)) {
  throw "Run this recovery script from an elevated PowerShell session. It changes the protected Nexus Agent configuration under Program Files."
}

try {
  $target = [Uri]$ServerUrl
} catch {
  throw "ServerUrl must be an absolute HTTP or HTTPS URL."
}
if ($target.Scheme -notin @("http", "https") -or -not $target.Host -or $target.UserInfo -or $target.Query -or $target.Fragment -or $target.AbsolutePath -notin @("", "/")) {
  throw "ServerUrl must be a base HTTPS control-plane URL without credentials, query text, fragments or a path."
}
if ($target.Scheme -eq "http" -and -not (Test-NexusLoopbackHost -HostName $target.Host)) {
  throw "HTTP is permitted only for an explicit localhost recovery target. Use HTTPS for every remote Nexus control plane."
}
$normalisedUrl = $target.GetLeftPart([System.UriPartial]::Authority).TrimEnd("/")
$configPath = Join-Path $AgentHome "config.json"
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Nexus Agent configuration was not found at $configPath."
}
if (-not (Get-Service -Name $AgentServiceName -ErrorAction SilentlyContinue)) {
  throw "The $AgentServiceName service is not installed."
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$currentUrl = [string]$config.server_url
if ($currentUrl -eq $normalisedUrl) {
  Write-Host "Nexus Agent already targets $normalisedUrl. No recovery change was made."
  return
}

$backupPath = "$configPath.recovery-$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
if (-not $PSCmdlet.ShouldProcess($configPath, "Change the Nexus Agent control-plane URL from $currentUrl to $normalisedUrl")) {
  return
}

$serviceWasRunning = (Get-Service -Name $AgentServiceName).Status -eq "Running"
Copy-Item -LiteralPath $configPath -Destination $backupPath -ErrorAction Stop
Protect-NexusAgentConfig -Path $backupPath
try {
  if ($serviceWasRunning) {
    Stop-Service -Name $AgentServiceName -Force -ErrorAction Stop
    (Get-Service -Name $AgentServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
  }

  # Preserve the device ID, client binding, token, certificate paths and every
  # other identity field.  This is an endpoint recovery only, never a re-enrol.
  $config.server_url = $normalisedUrl
  $temporaryPath = "$configPath.$PID.recovery.tmp"
  $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8 -NoNewline
  Protect-NexusAgentConfig -Path $temporaryPath
  Move-Item -LiteralPath $temporaryPath -Destination $configPath -Force
  Protect-NexusAgentConfig -Path $configPath

  Start-Service -Name $AgentServiceName -ErrorAction Stop
  (Get-Service -Name $AgentServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
  Write-Host "Nexus Agent endpoint repaired. The previous protected configuration is backed up at $backupPath."
  Write-Host "Wait for one heartbeat, then confirm this endpoint shows Current in Devices & RMM."
} catch {
  if (Test-Path -LiteralPath $backupPath) {
    Copy-Item -LiteralPath $backupPath -Destination $configPath -Force -ErrorAction SilentlyContinue
    Protect-NexusAgentConfig -Path $configPath
  }
  if ($serviceWasRunning) {
    Start-Service -Name $AgentServiceName -ErrorAction SilentlyContinue
  }
  throw
}
