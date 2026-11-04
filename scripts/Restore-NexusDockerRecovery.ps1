# Restore a Nexus platform recovery package into the Docker Compose stack.
#
# Mirrors the fail-closed contract of Import-NexusPlatformRecovery.ps1 for the
# container deployment, where MongoDB and the artifact named volumes are not
# reachable as host paths. Package validation always delegates to the canonical
# Import script in inspect-only mode first; nothing is written unless -Apply and
# -AllowRestore are both supplied, and existing data is never replaced without
# the documented overwrite exception controls.

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$PackagePath,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$')]
  [string]$DatabaseName,

  [string]$ComposeFile = (Join-Path $PSScriptRoot '..\docker-compose.production.yml'),

  # The default is inspect-only. Both switches are required before any restore.
  [switch]$Apply,
  [switch]$AllowRestore,

  # Existing data is never replaced unless all three controls below are used.
  [switch]$AllowOverwrite,
  [string]$TargetConfirmation,
  [string]$PreRestoreBackupPackagePath,

  # Optional Compose project name so a disposable recovery drill can restore
  # into its own project instead of the default project name.
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$')]
  [string]$ProjectName = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Service names and in-container mount paths must match the Compose file.
$mongoService = 'mongo'
$apiService = 'api'
$blockedServices = @('api', 'worker')
$artifactMounts = @(
  @{ name = 'public_uploads';   mount = '/app/uploads' }
  @{ name = 'private_uploads';  mount = '/app/private_uploads' }
  @{ name = 'agent_installers'; mount = '/app/data/agent-installers' }
)

$script:composeArguments = @('--file', $ComposeFile)
if ($ProjectName) {
  $script:composeArguments += @('--project-name', $ProjectName)
}

function Invoke-NexusComposeRestore {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & docker compose @script:composeArguments @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed. The restore was not continued."
  }
}

function Invoke-NexusComposeRestoreOutput {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $output = @(& docker compose --file $script:ComposeFile @Arguments)
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed. The restore was not continued."
  }
  return $output
}

function Get-NexusStagedCount {
  param(
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string]$Service,
    # Database checks exec into the running service container (mongod listens
    # there). Volume checks must run a short-lived container that mounts the
    # named volumes, because the api service is stopped during a restore.
    [switch]$UseRun
  )

  if ($UseRun) {
    $lines = @(Invoke-NexusComposeRestoreOutput -Arguments @('run', '-T', '--rm', '--no-deps', '--entrypoint', 'sh', $Service, '-c', $Script))
  }
  else {
    $lines = @(Invoke-NexusComposeRestoreOutput -Arguments @('exec', '-T', $Service, 'sh', '-c', $Script))
  }
  $numeric = @($lines | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1)
  if (-not $numeric) { return [int64]0 }
  return [int64]$numeric[0]
}

$package = [System.IO.Path]::GetFullPath($PackagePath)
if (-not (Test-Path -LiteralPath $package -PathType Leaf)) { throw 'The requested recovery package was not found.' }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Required command 'docker' was not found. Install Docker on the restore host."
}
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Compose v2 (docker compose) is required for the container restore path.'
}
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
  throw "The Compose file '$ComposeFile' was not found."
}

# Canonical package validation: archive safety, manifest, every payload
# checksum and the database-name contract. Inspect-only mode never contacts the
# sentinel URI below and never changes data.
$importScript = Join-Path $PSScriptRoot 'Import-NexusPlatformRecovery.ps1'
& $importScript -PackagePath $package -MongoUri 'mongodb://nexus-restore-inspection.invalid:27017' -DatabaseName $DatabaseName

if (-not $Apply) {
  Write-Host ''
  Write-Host 'Docker Compose inspection only: no container volume or database was changed.'
  Write-Host 'To apply to a Compose deployment, rerun with -Apply -AllowRestore after stopping the API and worker.'
  return
}
if (-not $AllowRestore) {
  throw 'Restore execution requires both -Apply and -AllowRestore. No target data was changed.'
}

$existingServices = @(Invoke-NexusComposeRestoreOutput -Arguments @('ps', '-a', '--services'))
if ($existingServices -notcontains $mongoService -or $existingServices -notcontains $apiService) {
  throw "The '$mongoService' and '$apiService' service containers must exist before a restore. Create the stack first (docker compose --file $ComposeFile up -d), then stop the API and worker."
}
$runningServices = @(Invoke-NexusComposeRestoreOutput -Arguments @('ps', '--status', 'running', '--services'))
if ($runningServices -notcontains $mongoService) {
  throw "The '$mongoService' service must be running during a restore."
}
foreach ($blocked in $blockedServices) {
  if ($runningServices -contains $blocked) {
    throw "The '$blocked' service must be stopped before a restore so no writes can race the restored data (docker compose --file $ComposeFile stop api worker)."
  }
}
& docker compose @script:composeArguments exec -T $mongoService sh -c 'command -v mongorestore >/dev/null 2>&1' *> $null
if ($LASTEXITCODE -ne 0) {
  throw "mongorestore is not available inside the '$mongoService' container. The restore was not attempted."
}

$extractRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-docker-restore-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($package)
  try {
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace('\', '/')
      if ([string]::IsNullOrWhiteSpace($name) -or $name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)') {
        throw 'The package contains an unsafe archive path and was rejected.'
      }
    }
  }
  finally {
    $archive.Dispose()
  }
  Expand-Archive -LiteralPath $package -DestinationPath $extractRoot -Force

  $manifestPath = Join-Path $extractRoot 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The recovery package has no manifest.json.'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ([string]$manifest.database.name -ne $DatabaseName) {
    throw "The package was created for database '$($manifest.database.name)'. Restoring it into '$DatabaseName' is refused to prevent namespace drift."
  }
  $archiveRelPath = [string]$manifest.database.archive_path
  if ($archiveRelPath.StartsWith('/') -or $archiveRelPath.Contains('\') -or $archiveRelPath -match '(^|/)\.\.(/|$)') {
    throw 'The recovery package manifest declares an unsafe database archive path.'
  }
  $dumpPath = Join-Path $extractRoot ($archiveRelPath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
  if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf)) {
    throw 'The package database archive is unavailable after validation.'
  }

  $artifactMap = @{}
  foreach ($artifact in @($manifest.artifacts)) { $artifactMap[[string]$artifact.name] = $artifact }
  $artifactPlan = @()
  foreach ($artifact in $artifactMounts) {
    $included = $false
    if ($artifactMap.ContainsKey($artifact.name)) {
      $entry = $artifactMap[$artifact.name]
      $includedProperty = $entry.PSObject.Properties['included']
      $included = ($null -ne $includedProperty -and $includedProperty.Value -eq $true)
    }
    $stagedSource = Join-Path $extractRoot (Join-Path 'artifacts' $artifact.name)
    if ($included -and -not (Test-Path -LiteralPath $stagedSource -PathType Container)) {
      throw "The package declares $($artifact.name) as included but the staged content is missing."
    }
    $artifactPlan += @{
      name     = $artifact.name
      mount    = $artifact.mount
      source   = $stagedSource
      included = $included
    }
  }

  # Inspect target state before any write. The same gates as the host-tool
  # import apply: a non-empty target needs the documented overwrite exception.
  $countScript = 'mongosh --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval ' + "'" + 'const d = db.getSiblingDB("' + $DatabaseName + '"); let count = 0; for (const collection of d.getCollectionNames()) { count += d.getCollection(collection).countDocuments({}); } print(count);' + "'"
  $targetDocuments = Get-NexusStagedCount -Script $countScript -Service $mongoService

  $artifactFiles = [int64]0
  foreach ($artifact in $artifactPlan) {
    $fileCountScript = 'if [ -d "' + $artifact.mount + '" ]; then find "' + $artifact.mount + '" -type f | wc -l; else echo 0; fi'
    $artifactFiles += Get-NexusStagedCount -Script $fileCountScript -Service $apiService -UseRun
  }

  $overwrite = ($targetDocuments -gt 0) -or ($artifactFiles -gt 0)
  if ($overwrite) {
    if (-not $AllowOverwrite) {
      throw "The target contains $targetDocuments database document(s) and $artifactFiles artifact file(s). Restore is refused by default. Use a fresh target, or follow the overwrite procedure in docs/PLATFORM_RECOVERY_RUNBOOK.md."
    }
    if ($TargetConfirmation -cne "RESTORE $DatabaseName") {
      throw "Live overwrite needs -TargetConfirmation 'RESTORE $DatabaseName'."
    }
    if (-not $PreRestoreBackupPackagePath -or -not (Test-Path -LiteralPath $PreRestoreBackupPackagePath -PathType Leaf)) {
      throw 'Live overwrite needs -PreRestoreBackupPackagePath pointing to a verified, pre-restore recovery package.'
    }
  }

  Write-Host 'Nexus platform recovery package validated for the Compose deployment.'
  Write-Host "  Database:   $DatabaseName ($targetDocuments document(s) currently present)"
  foreach ($artifact in $artifactPlan) {
    $state = if ($artifact.included) { 'will restore when applied' } else { 'not included in package' }
    Write-Host "  Artifact $($artifact.name): $state"
  }

  if (-not $PSCmdlet.ShouldProcess("database '$DatabaseName' and included named volumes in $ComposeFile", 'Apply verified Nexus platform recovery package')) {
    return
  }

  $restoreScript = 'set -e; mongorestore --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive=/tmp/nexus-restore.archive.gz --gzip --nsInclude="' + $DatabaseName + '.*" --quiet'
  if ($overwrite) { $restoreScript += ' --drop' }
  Write-Host 'Restoring the validated MongoDB archive through the Compose network. Credentials are not printed.'
  Invoke-NexusComposeRestore -Arguments @('cp', $dumpPath, "${mongoService}:/tmp/nexus-restore.archive.gz")
  Invoke-NexusComposeRestore -Arguments @('exec', '-T', $mongoService, 'sh', '-c', $restoreScript)
  & docker compose @script:composeArguments exec -T $mongoService sh -c 'rm -f /tmp/nexus-restore.archive.gz' *> $null

  $mountSpec = 'type=bind,src=' + $extractRoot + ',dst=/restore,readonly'

  $artifactLines = @('set -e')
  foreach ($artifact in $artifactPlan) {
    if (-not $artifact.included) { continue }
    if ($overwrite) {
      $artifactLines += 'if [ -d "' + $artifact.mount + '" ]; then find "' + $artifact.mount + '" -mindepth 1 -delete; fi'
    }
    $artifactLines += 'mkdir -p "' + $artifact.mount + '"'
    $artifactLines += 'cp -a "/restore/artifacts/' + $artifact.name + '/." "' + $artifact.mount + '/"'
  }
  if ($artifactLines.Count -gt 1) {
    Write-Host 'Restoring the included artifact volumes through the api service mounts.'
    Invoke-NexusComposeRestore -Arguments @('run', '-T', '--rm', '--no-deps', '--mount', $mountSpec, '--entrypoint', 'sh', $apiService, '-c', ($artifactLines -join ' '))
  }

  Write-Host ''
  Write-Host 'Nexus platform recovery data has been applied to the Compose deployment.'
  if ($overwrite) {
    Write-Host 'This was a live overwrite: roll back only from the pre-restore recovery package. Named-volume contents are replaced in place.'
  }
  Write-Host 'Do not start the API or worker until the post-restore checks in docs/PLATFORM_RECOVERY_RUNBOOK.md pass.'
}
finally {
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
