# Pin the NexusMSP runtime images to released tags or digests and roll the
# Compose deployment to them. This is the deploy and rollback-to-tag path from
# docs/RELEASE_RUNBOOK.md: pass the previous immutable version tag (or digest)
# to return to a known-good release without rebuilding anything.
#
# The script never reads or prints deployment secrets. The other required
# Compose variables must already be present in the operator environment or the
# host's private environment file, exactly as for a normal deployment.

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  # Full image reference, e.g. ghcr.io/owner/nexusmsp-api:1.4.0 or
  # ghcr.io/owner/nexusmsp-api@sha256:<digest>.
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._/@:-]+$')]
  [string]$ApiImage,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._/@:-]+$')]
  [string]$WebImage,

  [string]$ComposeFile = (Join-Path $PSScriptRoot '..\docker-compose.production.yml'),

  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$')]
  [string]$ProjectName = '',

  # Validate the pinned model without pulling or restarting anything.
  [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-NexusImmutableReference {
  param([Parameter(Mandatory = $true)][string]$Reference, [Parameter(Mandatory = $true)][string]$ParameterName)

  if ($Reference -match ':latest$') {
    throw "$ParameterName must not use the mutable 'latest' tag. Pin an immutable release tag or digest."
  }
  if ($Reference -notmatch ':' -and $Reference -notmatch '@sha256:') {
    throw "$ParameterName must carry an explicit tag or digest (for example name:1.4.0 or name@sha256:...)."
  }
}

Assert-NexusImmutableReference -Reference $ApiImage -ParameterName '-ApiImage'
Assert-NexusImmutableReference -Reference $WebImage -ParameterName '-WebImage'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Required command 'docker' was not found. Install Docker on the deployment host."
}
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Compose v2 (docker compose) is required.'
}
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
  throw "The Compose file '$ComposeFile' was not found."
}

$composeArguments = @('--file', $ComposeFile)
if ($ProjectName) {
  $composeArguments += @('--project-name', $ProjectName)
}

function Invoke-NexusDeployCompose {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & docker compose @script:composeArguments @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed. The deployment state is unchanged beyond the services already rolled."
  }
}

# The pinned references take effect through the environment, exactly as a
# deployment host would set them in its private environment file.
[Environment]::SetEnvironmentVariable('NEXUS_API_IMAGE', $ApiImage, 'Process')
[Environment]::SetEnvironmentVariable('NEXUS_WEB_IMAGE', $WebImage, 'Process')

Write-Host "Pinned API image: $ApiImage"
Write-Host "Pinned web image: $WebImage"

Write-Host 'Validating the pinned Compose model...'
Invoke-NexusDeployCompose -Arguments @('config', '--quiet')

if ($ValidateOnly) {
  Write-Host 'Validation succeeded. No image was pulled and no service was restarted.'
  return
}

$action = "Roll the web tier to $WebImage and the API/worker tier to $ApiImage"
if ($PSCmdlet.ShouldProcess($ComposeFile, $action)) {
  Write-Host 'Pulling the pinned images...'
  Invoke-NexusDeployCompose -Arguments @('pull', 'api', 'worker', 'web')

  Write-Host 'Rolling the services to the pinned images (no rebuild)...'
  Invoke-NexusDeployCompose -Arguments @('up', '-d', '--no-build', 'api', 'worker', 'web')

  Write-Host ''
  Write-Host 'Deployment rolled. Verify before closing the change window:'
  Write-Host '  docker compose --file <compose> ps'
  Write-Host '  docker compose --file <compose> exec api python -c "import urllib.request; print(urllib.request.urlopen(''http://127.0.0.1:8000/api/health'').status)"'
  Write-Host '  Check /api/ready through the web tier, then run the golden-workflow smoke checks.'
  Write-Host ''
  Write-Host 'Rollback is the same command with the previous immutable tag or digest for -ApiImage and -WebImage.'
  Write-Host 'If a database migration was applied, follow the migration rollback procedure in docs/RELEASE_RUNBOOK.md before rolling images back.'
}
