# Timed immutable-application-rollback drill for the Nexus Compose deployment.
#
# This script is the automated rehearsal behind the release gate "immutable
# application rollback is rehearsed". It stands up a disposable Compose project
# (unique project name, generated test-only secrets), builds two genuinely
# different releases of the API image from this checkout, pins the running stack
# to release A through scripts/Deploy-NexusImageTag.ps1 - the same script a real
# rollback uses - adopts release B, then rolls back to A and verifies that the
# running container is executing release A's exact immutable image again, that
# the API is healthy, and that the seeded data survived an application-only
# rollback. Timings, image identities and verification results are written as
# retained JSON evidence.
#
# Scope is deliberate and disclosed: the API/worker tier carries the
# application logic and the migration risk, so it is the tier this drill pins
# twice. The web tier is rolled once with the identical pin mechanism and is not
# version-discriminated, because a second full frontend build would not test the
# rollback semantics any further. The database migration half of the gate is a
# separate procedure (docs/RELEASE_RUNBOOK.md) and is not rehearsed here.
#
# It never reads deployment secrets, never touches a default-project
# deployment, and always cleans up its disposable project. Run it on a Docker
# host with the repository checkout; the first run builds the images and is
# slower.

[CmdletBinding()]
param(
  [string]$ComposeFile = (Join-Path $PSScriptRoot '..\docker-compose.production.yml'),

  # Where the retained drill evidence is written.
  [string]$EvidenceDirectory = (Join-Path $PSScriptRoot '..\artifacts\release-drills')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$mongoService = 'mongo'
$apiService = 'api'

function New-NexusRollbackSecret {
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

function Invoke-NexusRollbackCompose {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & docker compose @script:composeArguments @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed during the rollback drill."
  }
}

function Invoke-NexusRollbackComposeOutput {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $output = @(& docker compose @script:composeArguments @Arguments)
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed during the rollback drill."
  }
  return $output
}

function Invoke-NexusRollbackContainerScript {
  param(
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string]$Service,
    [switch]$UseRun
  )

  if ($UseRun) {
    return @(Invoke-NexusRollbackComposeOutput -Arguments @('run', '-T', '--rm', '--no-deps', '--entrypoint', 'sh', $Service, '-c', $Script))
  }
  return @(Invoke-NexusRollbackComposeOutput -Arguments @('exec', '-T', $Service, 'sh', '-c', $Script))
}

function Get-NexusPinnedImageId {
  param([Parameter(Mandatory = $true)][string]$Reference)

  $id = @(& docker image inspect --format '{{.Id}}' $Reference)
  if ($LASTEXITCODE -ne 0 -or -not $id) {
    throw "The pinned image '$Reference' is not present on this host; the drill cannot verify what is running."
  }
  return $id[0].Trim().ToLowerInvariant()
}

function Get-NexusRunningImageId {
  param([Parameter(Mandatory = $true)][string]$Service)

  $containerId = @(Invoke-NexusRollbackComposeOutput -Arguments @('ps', '-q', $Service))
  if (-not $containerId -or -not $containerId[0]) {
    throw "The '$Service' service has no running container, so the running release cannot be identified."
  }
  $id = @(& docker inspect --format '{{.Image}}' $containerId[0].Trim())
  if ($LASTEXITCODE -ne 0 -or -not $id) {
    throw "The '$Service' container image identity could not be read."
  }
  return $id[0].Trim().ToLowerInvariant()
}

function Wait-NexusRollbackMongoReady {
  param([int]$DeadlineSeconds = 120)

  $deadline = (Get-Date).AddSeconds($DeadlineSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $lines = @(Invoke-NexusRollbackContainerScript -Service $mongoService -Script 'mongosh --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet --eval "print(db.adminCommand(''ping'').ok)"')
      if ($lines -contains '1') { return }
    }
    catch {
      # mongod may still be initialising.
    }
    Start-Sleep -Seconds 2
  }
  throw "MongoDB did not become ready within $DeadlineSeconds seconds during the rollback drill."
}

function Wait-NexusRollbackApiHealthy {
  param([int]$DeadlineSeconds = 120)

  $deadline = (Get-Date).AddSeconds($DeadlineSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $lines = @(Invoke-NexusRollbackContainerScript -Service $apiService -Script 'python -c "import urllib.request;print(urllib.request.urlopen(''http://127.0.0.1:8000/api/health'', timeout=5).status)"')
      if ($lines -contains '200') { return }
    }
    catch {
      # The API can still be starting its safe startup checks after the roll.
    }
    Start-Sleep -Seconds 3
  }
  throw "The API did not report /api/health 200 within $DeadlineSeconds seconds after the roll."
}

function Write-NexusRollbackFailureDiagnostics {
  Write-Warning '[Nexus rollback drill] Compose diagnostics follow before cleanup:'
  & docker compose @script:composeArguments logs --tail=60 $mongoService $apiService 2>&1 | Out-Host
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Required command 'docker' was not found. Install Docker on the drill host."
}
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Compose v2 (docker compose) is required for the rollback drill.'
}
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
  throw "The Compose file '$ComposeFile' was not found."
}

$deployScript = Join-Path $PSScriptRoot 'Deploy-NexusImageTag.ps1'
if (-not (Test-Path -LiteralPath $deployScript -PathType Leaf)) {
  throw 'The image-pin roll script (Deploy-NexusImageTag.ps1) was not found next to this drill script. The drill rehearses that script, so it cannot run without it.'
}

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$projectName = "nexus-rollback-drill-$runId"
$databaseName = "nexus_rollback_drill_$runId"
$markerToken = "rollback-$runId"
$previousRelease = "nexus-rollback-drill-$runId-a:1.0.0"
$adoptedRelease = "nexus-rollback-drill-$runId-b:1.1.0"
$webRelease = "nexus-rollback-drill-$runId-web:1.0.0"
$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-rollback-drill-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null

$script:composeArguments = @('--file', $ComposeFile, '--project-name', $projectName)

# Every Compose variable is generated in-process for this disposable project.
# No deployment secret, host environment file or existing database is read.
$environmentNames = @(
  'MONGO_USERNAME', 'MONGO_PASSWORD', 'JWT_SECRET', 'NEXUS_SECRET_ENCRYPTION_KEY',
  'NEXUS_DMARC_RECEIVER_TOKEN', 'CORS_ORIGINS', 'NEXUS_ALERT_WEBHOOK_URL',
  'NEXUS_GRAFANA_ADMIN_PASSWORD', 'NEXUS_OBSERVABILITY_INGEST_TOKEN',
  'NEXUS_TLS_DOMAIN', 'NEXUS_TLS_ACME_EMAIL', 'NEXUS_API_IMAGE', 'NEXUS_WEB_IMAGE',
  'NEXUS_AGENT_VERSION'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$evidence = [ordered]@{
  drill                  = 'nexus-immutable-application-rollback'
  run_id                 = $runId
  compose_file           = (Resolve-Path -LiteralPath $ComposeFile).Path
  generated_project_name = $projectName
  generated_database     = $databaseName
  drill_scope            = 'api-worker-tier'
  started_at             = [DateTimeOffset]::UtcNow.ToString('o')
  previous_release       = [ordered]@{
    reference = $previousRelease
    image_id  = $null
  }
  adopted_release        = [ordered]@{
    reference = $adoptedRelease
    image_id  = $null
  }
  build_adopted_release  = $null
  rollback               = $null
  verification           = [ordered]@{
    releases_are_distinct_images        = $false
    adopted_release_was_running         = $false
    rollback_restored_previous_image    = $false
    api_healthy_after_rollback          = $false
    seeded_data_survived_rollback       = $false
    mutable_reference_refused           = $false
    validate_only_did_not_change_state  = $false
  }
  result                 = 'failed'
  evidence_note          = 'Disposable drill values only; no deployment secrets are recorded.'
}
$buildStarted = $null
$buildEnded = $null
$rollbackStarted = $null
$rollbackEnded = $null
$drillPassed = $false

try {
  [Environment]::SetEnvironmentVariable('MONGO_USERNAME', 'nexus_drill_user', 'Process')
  [Environment]::SetEnvironmentVariable('MONGO_PASSWORD', (New-NexusRollbackSecret), 'Process')
  [Environment]::SetEnvironmentVariable('JWT_SECRET', (New-NexusRollbackSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_SECRET_ENCRYPTION_KEY', (New-NexusRollbackSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_DMARC_RECEIVER_TOKEN', (New-NexusRollbackSecret), 'Process')
  [Environment]::SetEnvironmentVariable('CORS_ORIGINS', 'http://127.0.0.1:8080', 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_ALERT_WEBHOOK_URL', 'https://alerts.example.invalid/nexus-drill', 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_GRAFANA_ADMIN_PASSWORD', (New-NexusRollbackSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_OBSERVABILITY_INGEST_TOKEN', (New-NexusRollbackSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_TLS_DOMAIN', 'localhost', 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_TLS_ACME_EMAIL', 'ops@replace.invalid', 'Process')

  Write-Host "[Nexus rollback drill] Disposable project: $projectName (database $databaseName)"

  # Two releases with different content, so a rollback moves the running stack
  # between genuinely different immutable artifacts rather than re-tagging one.
  Write-Host '[Nexus rollback drill] Building the previous release from this checkout...'
  [Environment]::SetEnvironmentVariable('NEXUS_API_IMAGE', $previousRelease, 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_WEB_IMAGE', $webRelease, 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_AGENT_VERSION', '0.0.1-rollback-drill-previous', 'Process')
  Invoke-NexusRollbackCompose -Arguments @('build', 'api', 'web')
  $evidence.previous_release.image_id = Get-NexusPinnedImageId -Reference $previousRelease

  Write-Host '[Nexus rollback drill] Building the adopted release from this checkout...'
  $buildStarted = [DateTimeOffset]::UtcNow
  [Environment]::SetEnvironmentVariable('NEXUS_API_IMAGE', $adoptedRelease, 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_AGENT_VERSION', '0.0.2-rollback-drill-adopted', 'Process')
  Invoke-NexusRollbackCompose -Arguments @('build', 'api')
  $buildEnded = [DateTimeOffset]::UtcNow
  $evidence.adopted_release.image_id = Get-NexusPinnedImageId -Reference $adoptedRelease
  $evidence.verification.releases_are_distinct_images = [bool]($evidence.previous_release.image_id -ne $evidence.adopted_release.image_id)
  if (-not $evidence.verification.releases_are_distinct_images) {
    throw 'The two drilled releases resolved to the same image. A rollback between them would prove nothing.'
  }

  Write-Host '[Nexus rollback drill] Deploying the previous release through the production pin script...'
  [Environment]::SetEnvironmentVariable('NEXUS_API_IMAGE', $previousRelease, 'Process')
  Invoke-NexusRollbackCompose -Arguments @('up', '-d', $mongoService)
  Wait-NexusRollbackMongoReady
  & $deployScript -ApiImage $previousRelease -WebImage $webRelease -ComposeFile $ComposeFile -ProjectName $projectName -SkipPull -Confirm:$false
  Wait-NexusRollbackApiHealthy
  $runningId = Get-NexusRunningImageId -Service $apiService
  if ($runningId -ne $evidence.previous_release.image_id) {
    throw 'The pinned previous release is not what the API container is running; the drill cannot attribute the logged-out state to the pin script.'
  }

  # Seed data after the first release is live. An application rollback must not
  # disturb it, which is the point of rolling images instead of restoring.
  $seedFile = Join-Path $stagingDirectory 'seed.js'
  # ASCII content, ASCII encoding: a UTF-8 BOM from Windows PowerShell 5.1
  # would break the mongosh script parse.
  Set-Content -LiteralPath $seedFile -Value ("db.getSiblingDB('{0}').rollback_drill.insertOne({{ marker: '{1}', created_at: new Date() }}); print('SEEDED');" -f $databaseName, $markerToken) -Encoding ascii
  Invoke-NexusRollbackCompose -Arguments @('cp', $seedFile, "${mongoService}:/tmp/nexus-rollback-seed.js")
  $seedLines = @(Invoke-NexusRollbackContainerScript -Service $mongoService -Script 'mongosh --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet /tmp/nexus-rollback-seed.js')
  if ($seedLines -notcontains 'SEEDED') {
    throw 'The database marker could not be seeded, so data survival across the rollback cannot be proven.'
  }
  Invoke-NexusRollbackContainerScript -Service $apiService -UseRun -Script ("echo {0} > /app/uploads/nexus-rollback-drill-marker.txt" -f $markerToken) | Out-Null

  Write-Host '[Nexus rollback drill] Adopting the newer release...'
  & $deployScript -ApiImage $adoptedRelease -WebImage $webRelease -ComposeFile $ComposeFile -ProjectName $projectName -SkipPull -Confirm:$false
  Wait-NexusRollbackApiHealthy
  $evidence.verification.adopted_release_was_running = [bool]((Get-NexusRunningImageId -Service $apiService) -eq $evidence.adopted_release.image_id)
  if (-not $evidence.verification.adopted_release_was_running) {
    throw 'The adopted release is not what the API container is running, so there is nothing to roll back from.'
  }

  Write-Host '[Nexus rollback drill] Rolling back to the previous release...'
  $rollbackStarted = [DateTimeOffset]::UtcNow
  & $deployScript -ApiImage $previousRelease -WebImage $webRelease -ComposeFile $ComposeFile -ProjectName $projectName -SkipPull -Confirm:$false
  $rollbackEnded = [DateTimeOffset]::UtcNow

  $evidence.verification.rollback_restored_previous_image = [bool]((Get-NexusRunningImageId -Service $apiService) -eq $evidence.previous_release.image_id)
  Wait-NexusRollbackApiHealthy
  $evidence.verification.api_healthy_after_rollback = $true

  $verifyFile = Join-Path $stagingDirectory 'verify.js'
  Set-Content -LiteralPath $verifyFile -Value ("print('MARKER_COUNT=' + db.getSiblingDB('{0}').rollback_drill.countDocuments({{ marker: '{1}' }}));" -f $databaseName, $markerToken) -Encoding ascii
  Invoke-NexusRollbackCompose -Arguments @('cp', $verifyFile, "${mongoService}:/tmp/nexus-rollback-verify.js")
  $verifyLines = @(Invoke-NexusRollbackContainerScript -Service $mongoService -Script 'mongosh --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet /tmp/nexus-rollback-verify.js')
  $fileLines = @(Invoke-NexusRollbackContainerScript -Service $apiService -UseRun -Script 'cat /app/uploads/nexus-rollback-drill-marker.txt 2>/dev/null || true')
  $evidence.verification.seeded_data_survived_rollback = [bool](
    ($verifyLines -contains 'MARKER_COUNT=1') -and ($fileLines -contains $markerToken)
  )

  # The two guards the production path relies on: a mutable reference is
  # refused, and a validation pass changes nothing.
  Write-Host '[Nexus rollback drill] Confirming the pin script still refuses a mutable reference...'
  $refused = $false
  try {
    & $deployScript -ApiImage 'nexusmsp-api:latest' -WebImage $webRelease -ComposeFile $ComposeFile -ProjectName $projectName -SkipPull -Confirm:$false
  }
  catch {
    $refused = $true
  }
  $evidence.verification.mutable_reference_refused = $refused

  & $deployScript -ApiImage $adoptedRelease -WebImage $webRelease -ComposeFile $ComposeFile -ProjectName $projectName -ValidateOnly
  $evidence.verification.validate_only_did_not_change_state = [bool](
    (Get-NexusRunningImageId -Service $apiService) -eq $evidence.previous_release.image_id
  )

  $failedChecks = @($evidence.verification.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key })
  if ($failedChecks.Count -gt 0) {
    throw ("One or more rollback verifications failed: {0}" -f ($failedChecks -join ', '))
  }
  $drillPassed = $true
  Write-Host '[Nexus rollback drill] PASSED: two distinct releases, adopt, roll back to the exact previous image, healthy on seeded data, guards intact.'
}
catch {
  Write-NexusRollbackFailureDiagnostics
  throw
}
finally {
  if ($buildStarted -and $buildEnded) {
    $evidence.build_adopted_release = [ordered]@{
      started_at_utc   = $buildStarted.ToString('o')
      ended_at_utc     = $buildEnded.ToString('o')
      duration_seconds = [math]::Round(($buildEnded - $buildStarted).TotalSeconds, 1)
    }
  }
  if ($rollbackStarted -and $rollbackEnded) {
    $evidence.rollback = [ordered]@{
      started_at_utc   = $rollbackStarted.ToString('o')
      ended_at_utc     = $rollbackEnded.ToString('o')
      duration_seconds = [math]::Round(($rollbackEnded - $rollbackStarted).TotalSeconds, 1)
    }
  }
  $evidence.result = if ($drillPassed) { 'passed' } else { 'failed' }
  $evidence.completed_at = [DateTimeOffset]::UtcNow.ToString('o')

  New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
  $evidencePath = Join-Path $EvidenceDirectory ("release-drill-{0}-{1}.json" -f ([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')), $runId)
  $evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $evidencePath -Encoding utf8
  Write-Host "[Nexus rollback drill] Evidence written: $evidencePath"

  Write-Host "[Nexus rollback drill] Removing disposable project $projectName..."
  & docker compose @script:composeArguments down --volumes --remove-orphans *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "The disposable drill project may need manual cleanup: $projectName"
  }
  Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue

  foreach ($name in $environmentNames) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
  }

  # The drilled release images are local build artifacts of this checkpoint;
  # leaving them behind would let a later drill reuse a stale "release".
  foreach ($reference in @($previousRelease, $adoptedRelease, $webRelease)) {
    & docker image rm --force $reference *> $null
  }
}
