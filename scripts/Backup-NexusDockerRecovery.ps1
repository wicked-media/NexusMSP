# Capture a Nexus platform recovery package from the Docker Compose stack.
#
# The production deployment keeps MongoDB and the uploads/private-uploads/
# installers named volumes inside Docker and publishes no database port, so the
# host-tool path in Export-NexusPlatformRecovery.ps1 cannot reach it. This
# wrapper captures the database archive and the three named volumes from inside
# the Compose network, then delegates manifest, checksums, packaging and the
# restore contract to Export-NexusPlatformRecovery.ps1 unchanged. Database
# credentials stay inside container environment expansion and are never printed.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$')]
  [string]$DatabaseName,

  [string]$ComposeFile = (Join-Path $PSScriptRoot '..\docker-compose.production.yml'),

  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\artifacts\platform-recovery'),

  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$')]
  [string]$Label = 'docker',

  # Optional Compose project name so a disposable recovery drill can capture
  # its own project instead of the default project name.
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$')]
  [string]$ProjectName = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Service names and in-container mount paths must match the Compose file.
# The artifact names and Export parameter/skip switches map to the canonical
# package layout and are constants, not operator input.
$mongoService = 'mongo'
$apiService = 'api'
$artifactMounts = @(
  @{ name = 'public_uploads';   mount = '/app/uploads';               exportParameter = 'UploadsPath';       skipParameter = 'SkipUploads' }
  @{ name = 'private_uploads';  mount = '/app/private_uploads';       exportParameter = 'PrivateUploadsPath'; skipParameter = 'SkipPrivateUploads' }
  @{ name = 'agent_installers'; mount = '/app/data/agent-installers'; exportParameter = 'InstallersPath';    skipParameter = 'SkipInstallers' }
)

$script:composeArguments = @('--file', $ComposeFile)
if ($ProjectName) {
  $script:composeArguments += @('--project-name', $ProjectName)
}

function Invoke-NexusComposeCapture {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & docker compose @script:composeArguments @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed. No recovery package was produced."
  }
}

function Invoke-NexusComposeCaptureOutput {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $output = @(& docker compose --file $script:ComposeFile @Arguments)
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed. No recovery package was produced."
  }
  return $output
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Required command 'docker' was not found. Install Docker on the backup host."
}
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Compose v2 (docker compose) is required for the container capture path.'
}
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
  throw "The Compose file '$ComposeFile' was not found."
}

$runningServices = @(Invoke-NexusComposeCaptureOutput -Arguments @('ps', '--status', 'running', '--services'))
if ($runningServices -notcontains $mongoService) {
  throw "The '$mongoService' service must be running in $ComposeFile before a capture can be taken."
}
& docker compose @script:composeArguments exec -T $mongoService sh -c 'command -v mongodump >/dev/null 2>&1' *> $null
if ($LASTEXITCODE -ne 0) {
  throw "mongodump is not available inside the '$mongoService' container. No recovery package was produced."
}

$stagingPath = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-docker-capture-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null

try {
  # The dump runs inside the mongo container. Credential names are expanded by
  # the container shell, so no secret reaches this host command line or output.
  $dumpScript = 'set -e; mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db ' + $DatabaseName + ' --archive=/tmp/nexus-data.archive.gz --gzip --quiet'
  Write-Host 'Exporting the Nexus application database from the Compose network. Credentials are not printed.'
  Invoke-NexusComposeCapture -Arguments @('exec', '-T', $mongoService, 'sh', '-c', $dumpScript)

  $stagedArchive = Join-Path $stagingPath 'nexus-data.archive.gz'
  Invoke-NexusComposeCapture -Arguments @('cp', "${mongoService}:/tmp/nexus-data.archive.gz", $stagedArchive)
  if (-not (Test-Path -LiteralPath $stagedArchive -PathType Leaf) -or (Get-Item -LiteralPath $stagedArchive).Length -le 0) {
    throw 'The container-side database archive could not be staged. No recovery package was produced.'
  }
  # Best-effort removal of the temporary archive inside the container.
  & docker compose @script:composeArguments exec -T $mongoService sh -c 'rm -f /tmp/nexus-data.archive.gz' *> $null

  $artifactRoot = Join-Path $stagingPath 'artifacts'
  New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
  $mountSpec = 'type=bind,src=' + $artifactRoot + ',dst=/staging'
  $copyLines = @('set -e')
  foreach ($artifact in $artifactMounts) {
    $copyLines += 'if [ -d "' + $artifact.mount + '" ]; then cp -a "' + $artifact.mount + '" "/staging/' + $artifact.name + '"; fi'
  }
  Write-Host 'Staging the uploads, private uploads and installer volumes from the api service.'
  Invoke-NexusComposeCapture -Arguments @('run', '-T', '--rm', '--no-deps', '--mount', $mountSpec, '--entrypoint', 'sh', $apiService, '-c', ($copyLines -join ' '))

  $exportArguments = @{
    MongoArchivePath = $stagedArchive
    DatabaseName     = $DatabaseName
    OutputDirectory  = $OutputDirectory
    Label            = $Label
  }
  foreach ($artifact in $artifactMounts) {
    $stagedDirectory = Join-Path $artifactRoot $artifact.name
    if (Test-Path -LiteralPath $stagedDirectory -PathType Container) {
      $exportArguments[$artifact.exportParameter] = $stagedDirectory
    }
    else {
      Write-Host "Volume content for $($artifact.name) is absent from this deployment; the package will record it as skipped."
      $exportArguments[$artifact.skipParameter] = $true
    }
  }

  & (Join-Path $PSScriptRoot 'Export-NexusPlatformRecovery.ps1') @exportArguments

  Write-Host ''
  Write-Host 'Docker Compose capture notes:'
  Write-Host '  The capture is not a point-in-time snapshot. Take it during a low-change window or stop the worker first, and record which choice was made.'
  Write-Host '  Keep the package in an approved encrypted off-host backup location and run the isolated restore drill in docs/PLATFORM_RECOVERY_RUNBOOK.md.'
}
finally {
  if (Test-Path -LiteralPath $stagingPath) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force -ErrorAction SilentlyContinue
  }
}
