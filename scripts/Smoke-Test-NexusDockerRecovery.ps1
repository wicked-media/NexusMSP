# Timed capture-and-restore drill for the Nexus Docker Compose recovery path.
#
# This script is the automated smoke test behind the recovery gate: it stands up
# a disposable Compose project (unique project name, generated database name and
# generated test-only secrets), seeds database and volume markers, captures a
# recovery package through Backup-NexusDockerRecovery.ps1, destroys the project
# data, restores through Restore-NexusDockerRecovery.ps1, and verifies the
# markers and a boot on restored data. Timings and verification results are
# written as retained JSON evidence.
#
# It never reads deployment secrets, never touches a default-project deployment,
# and always cleans up its disposable project. Run it on a Docker host with the
# repository checkout; the first run builds the API image and is slower.

[CmdletBinding()]
param(
  [string]$ComposeFile = (Join-Path $PSScriptRoot '..\docker-compose.production.yml'),

  # Where the retained drill evidence (and, with -KeepArtifacts, the recovery
  # package) is written.
  [string]$EvidenceDirectory = (Join-Path $PSScriptRoot '..\artifacts\recovery-drills'),

  # Keep the captured recovery package for manual inspection. The JSON
  # evidence is always retained.
  [switch]$KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$mongoService = 'mongo'
$apiService = 'api'

function New-NexusDrillSecret {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
    # BitConverter works on Windows PowerShell 5.1 and PowerShell 7 alike.
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $rng.Dispose()
  }
}

function Invoke-NexusDrillCompose {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & docker compose @script:composeArguments @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed during the recovery drill."
  }
}

function Invoke-NexusDrillComposeOutput {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $output = @(& docker compose @script:composeArguments @Arguments)
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed during the recovery drill."
  }
  return $output
}

function Invoke-NexusContainerScript {
  param(
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string]$Service,
    [switch]$UseRun
  )

  if ($UseRun) {
    return @(Invoke-NexusDrillComposeOutput -Arguments @('run', '-T', '--rm', '--no-deps', '--entrypoint', 'sh', $Service, '-c', $Script))
  }
  return @(Invoke-NexusDrillComposeOutput -Arguments @('exec', '-T', $Service, 'sh', '-c', $Script))
}

function Wait-NexusMongoReady {
  param([int]$DeadlineSeconds = 120)

  $deadline = (Get-Date).AddSeconds($DeadlineSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $lines = @(Invoke-NexusContainerScript -Service $mongoService -Script 'mongosh --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet --eval "print(db.adminCommand(''ping'').ok)"')
      if ($lines -contains '1') { return }
    }
    catch {
      # mongod may still be initialising.
    }
    Start-Sleep -Seconds 2
  }
  throw "MongoDB did not become ready within $DeadlineSeconds seconds during the recovery drill."
}

function Wait-NexusApiHealthy {
  param([int]$DeadlineSeconds = 120)

  $deadline = (Get-Date).AddSeconds($DeadlineSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $lines = @(Invoke-NexusContainerScript -Service $apiService -Script 'python -c "import urllib.request;print(urllib.request.urlopen(''http://127.0.0.1:8000/api/health'', timeout=5).status)"')
      if ($lines -contains '200') { return }
    }
    catch {
      # The API can still be starting its safe startup checks.
    }
    Start-Sleep -Seconds 3
  }
  throw "The API did not report /api/health 200 within $DeadlineSeconds seconds on restored data."
}

function Write-NexusDrillFailureDiagnostics {
  Write-Warning '[Nexus recovery drill] Compose diagnostics follow before cleanup:'
  & docker compose @script:composeArguments logs --tail=60 $mongoService $apiService 2>&1 | Out-Host
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Required command 'docker' was not found. Install Docker on the drill host."
}
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Compose v2 (docker compose) is required for the recovery drill.'
}
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
  throw "The Compose file '$ComposeFile' was not found."
}

$backupScript = Join-Path $PSScriptRoot 'Backup-NexusDockerRecovery.ps1'
$restoreScript = Join-Path $PSScriptRoot 'Restore-NexusDockerRecovery.ps1'
if (-not (Test-Path -LiteralPath $backupScript -PathType Leaf) -or -not (Test-Path -LiteralPath $restoreScript -PathType Leaf)) {
  throw 'The Docker recovery capture/restore scripts were not found next to this drill script.'
}

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$projectName = "nexus-recovery-smoke-$runId"
$databaseName = "nexus_recovery_smoke_$runId"
$markerToken = "drill-$runId"
$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-recovery-drill-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null

$script:composeArguments = @('--file', $ComposeFile, '--project-name', $projectName)

# Every Compose variable is generated in-process for this disposable project.
# No deployment secret, host environment file or existing database is read.
$environmentNames = @(
  'MONGO_USERNAME', 'MONGO_PASSWORD', 'JWT_SECRET', 'NEXUS_SECRET_ENCRYPTION_KEY',
  'NEXUS_DMARC_RECEIVER_TOKEN', 'CORS_ORIGINS', 'NEXUS_ALERT_WEBHOOK_URL',
  'NEXUS_GRAFANA_ADMIN_PASSWORD', 'NEXUS_OBSERVABILITY_INGEST_TOKEN',
  'NEXUS_TLS_DOMAIN', 'NEXUS_TLS_ACME_EMAIL', 'NEXUS_API_IMAGE', 'NEXUS_WEB_IMAGE'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$evidence = [ordered]@{
  drill                  = 'nexus-docker-capture-restore'
  run_id                 = $runId
  compose_file           = (Resolve-Path -LiteralPath $ComposeFile).Path
  generated_project_name = $projectName
  generated_database     = $databaseName
  started_at             = [DateTimeOffset]::UtcNow.ToString('o')
  capture                = $null
  restore                = $null
  verification           = [ordered]@{
    database_marker_restored = $false
    volume_marker_restored   = $false
    api_healthy_on_restore   = $false
  }
  result                 = 'failed'
  evidence_note          = 'Disposable drill values only; no deployment secrets are recorded.'
}
$captureStarted = $null
$captureEnded = $null
$restoreStarted = $null
$restoreEnded = $null
$packagePath = $null
$drillPassed = $false

try {
  [Environment]::SetEnvironmentVariable('MONGO_USERNAME', 'nexus_drill_user', 'Process')
  [Environment]::SetEnvironmentVariable('MONGO_PASSWORD', (New-NexusDrillSecret), 'Process')
  [Environment]::SetEnvironmentVariable('JWT_SECRET', (New-NexusDrillSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_SECRET_ENCRYPTION_KEY', (New-NexusDrillSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_DMARC_RECEIVER_TOKEN', (New-NexusDrillSecret), 'Process')
  [Environment]::SetEnvironmentVariable('CORS_ORIGINS', 'http://127.0.0.1:8080', 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_ALERT_WEBHOOK_URL', 'https://alerts.example.invalid/nexus-drill', 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_GRAFANA_ADMIN_PASSWORD', (New-NexusDrillSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_OBSERVABILITY_INGEST_TOKEN', (New-NexusDrillSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_TLS_DOMAIN', 'localhost', 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_TLS_ACME_EMAIL', 'ops@replace.invalid', 'Process')

  Write-Host "[Nexus recovery drill] Disposable project: $projectName (database $databaseName)"
  Write-Host '[Nexus recovery drill] Starting mongo and api for the seed phase...'
  $stackStarted = Get-Date
  Invoke-NexusDrillCompose -Arguments @('up', '-d', '--build', $mongoService, $apiService)
  Wait-NexusMongoReady
  Write-Host ("[Nexus recovery drill] Stack ready in {0:n1}s." -f ((Get-Date) - $stackStarted).TotalSeconds)

  $seedFile = Join-Path $stagingDirectory 'seed.js'
  # ASCII content, ASCII encoding: a UTF-8 BOM from Windows PowerShell 5.1
  # would break the mongosh script parse.
  Set-Content -LiteralPath $seedFile -Value ("db.getSiblingDB('{0}').recovery_drill.insertOne({{ marker: '{1}', created_at: new Date() }}); print('SEEDED');" -f $databaseName, $markerToken) -Encoding ascii
  Invoke-NexusDrillCompose -Arguments @('cp', $seedFile, "${mongoService}:/tmp/nexus-drill-seed.js")
  $seedLines = @(Invoke-NexusContainerScript -Service $mongoService -Script 'mongosh --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet /tmp/nexus-drill-seed.js')
  if ($seedLines -notcontains 'SEEDED') {
    throw 'The database marker could not be seeded; the drill cannot prove a restore.'
  }
  Invoke-NexusContainerScript -Service $apiService -UseRun -Script ("echo {0} > /app/uploads/nexus-recovery-drill-marker.txt" -f $markerToken) | Out-Null
  Write-Host '[Nexus recovery drill] Database and volume markers seeded.'

  Write-Host '[Nexus recovery drill] Capturing a recovery package...'
  $captureStarted = [DateTimeOffset]::UtcNow
  & $backupScript -DatabaseName $databaseName -ComposeFile $ComposeFile -OutputDirectory $stagingDirectory -Label 'smoke' -ProjectName $projectName
  $captureEnded = [DateTimeOffset]::UtcNow
  $packagePath = Get-ChildItem -LiteralPath $stagingDirectory -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $packagePath) {
    throw 'The capture completed without producing a recovery package.'
  }
  $packagePath = $packagePath.FullName

  Write-Host '[Nexus recovery drill] Destroying all project data (volumes included)...'
  Invoke-NexusDrillCompose -Arguments @('down', '--volumes', '--remove-orphans')

  Write-Host '[Nexus recovery drill] Recreating an empty stack for the restore...'
  Invoke-NexusDrillCompose -Arguments @('up', '-d', '--build', $mongoService, $apiService)
  Wait-NexusMongoReady
  # The restore contract requires the api container to exist but be stopped so
  # no writes can race the restored data.
  Invoke-NexusDrillCompose -Arguments @('stop', $apiService)

  Write-Host '[Nexus recovery drill] Restoring the captured package...'
  $restoreStarted = [DateTimeOffset]::UtcNow
  & $restoreScript -PackagePath $packagePath -DatabaseName $databaseName -ComposeFile $ComposeFile -ProjectName $projectName -Apply -AllowRestore -Confirm:$false
  $restoreEnded = [DateTimeOffset]::UtcNow

  Write-Host '[Nexus recovery drill] Verifying restored markers and a boot on restored data...'
  $verifyFile = Join-Path $stagingDirectory 'verify.js'
  Set-Content -LiteralPath $verifyFile -Value ("print('MARKER_COUNT=' + db.getSiblingDB('{0}').recovery_drill.countDocuments({{ marker: '{1}' }}));" -f $databaseName, $markerToken) -Encoding ascii
  Invoke-NexusDrillCompose -Arguments @('cp', $verifyFile, "${mongoService}:/tmp/nexus-drill-verify.js")
  $verifyLines = @(Invoke-NexusContainerScript -Service $mongoService -Script 'mongosh --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet /tmp/nexus-drill-verify.js')
  $evidence.verification.database_marker_restored = [bool]($verifyLines -contains ('MARKER_COUNT=1'))

  $fileLines = @(Invoke-NexusContainerScript -Service $apiService -UseRun -Script 'cat /app/uploads/nexus-recovery-drill-marker.txt 2>/dev/null || true')
  $evidence.verification.volume_marker_restored = [bool]($fileLines -contains $markerToken)

  Invoke-NexusDrillCompose -Arguments @('start', $apiService)
  try {
    Wait-NexusApiHealthy
    $evidence.verification.api_healthy_on_restore = $true
  }
  catch {
    Write-Warning '[Nexus recovery drill] The API did not become healthy on restored data.'
    throw
  }

  if ($evidence.verification.database_marker_restored -and $evidence.verification.volume_marker_restored -and $evidence.verification.api_healthy_on_restore) {
    $drillPassed = $true
    Write-Host '[Nexus recovery drill] PASSED: capture, destroy, restore and boot-on-restored-data all verified.'
  }
  else {
    throw 'One or more restore verifications failed; see the drill evidence for which marker did not survive.'
  }
}
catch {
  Write-NexusDrillFailureDiagnostics
  throw
}
finally {
  if ($captureStarted -and $captureEnded) {
    $evidence.capture = [ordered]@{
      started_at_utc     = $captureStarted.ToString('o')
      ended_at_utc       = $captureEnded.ToString('o')
      duration_seconds   = [math]::Round(($captureEnded - $captureStarted).TotalSeconds, 1)
      package_file       = if ($packagePath) { Split-Path -Leaf $packagePath } else { $null }
      package_sha256     = if ($packagePath) { (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
    }
  }
  if ($restoreStarted -and $restoreEnded) {
    $evidence.restore = [ordered]@{
      started_at_utc   = $restoreStarted.ToString('o')
      ended_at_utc     = $restoreEnded.ToString('o')
      duration_seconds = [math]::Round(($restoreEnded - $restoreStarted).TotalSeconds, 1)
    }
  }
  $evidence.result = if ($drillPassed) { 'passed' } else { 'failed' }
  $evidence.completed_at = [DateTimeOffset]::UtcNow.ToString('o')

  New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
  $evidencePath = Join-Path $EvidenceDirectory ("recovery-drill-{0}-{1}.json" -f ([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')), $runId)
  $evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $evidencePath -Encoding utf8
  Write-Host "[Nexus recovery drill] Evidence written: $evidencePath"

  Write-Host "[Nexus recovery drill] Removing disposable project $projectName..."
  & docker compose @script:composeArguments down --volumes --remove-orphans *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "The disposable drill project may need manual cleanup: $projectName"
  }

  if ($packagePath -and -not $KeepArtifacts) {
    Remove-Item -LiteralPath $packagePath -Force -ErrorAction SilentlyContinue
    $packagePath = $null
  }
  elseif ($packagePath) {
    Write-Host "[Nexus recovery drill] Recovery package retained: $packagePath"
  }
  Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue

  foreach ($name in $environmentNames) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
  }
}
