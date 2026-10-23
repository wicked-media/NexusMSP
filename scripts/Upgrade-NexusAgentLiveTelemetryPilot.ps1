[CmdletBinding()]
param()

# Local-development pilot: preserve the enrolled endpoint identity while
# replacing only the paired release binaries built from this checkout. Output
# is persisted so an elevation prompt cannot hide a failed upgrade reason.
$ErrorActionPreference = 'Stop'
$ConfirmPreference = 'None'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $repositoryRoot 'artifacts'
$logPath = Join-Path $logDirectory 'agent-live-telemetry-upgrade.log'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

try {
  & (Join-Path $PSScriptRoot 'Upgrade-NexusAgentBinaries.ps1') `
    -SourceDirectory (Join-Path $repositoryRoot 'agent\dist') `
    -Confirm:$false *>&1 | Tee-Object -FilePath $logPath
  exit 0
}
catch {
  $_ | Out-String | Tee-Object -FilePath $logPath -Append | Out-Host
  exit 1
}
