# Timed database-migration-ledger rehearsal for the Nexus Compose deployment.
#
# This script is the automated rehearsal behind the release gate "database
# migration rollback is rehearsed per migration". It stands up a disposable
# Compose project (unique project name, generated test-only secrets, generated
# database contents) built from this checkout, migrates it through the real
# operator CLI (backend/scripts/nexus_migrate.py) inside the API image, and then
# proves the property the release gate actually depends on: a database that
# records a migration this release does not define cannot be served, is refused
# by readiness, by the API's own startup and by the CLI, and the refusal names
# the documented remedy rather than failing silently. Timings and every
# verification result are written as retained JSON evidence.
#
# Scope is deliberate and disclosed:
#
# * The "newer release" precondition is written, not built. What a newer release
#   leaves behind is a ledger row with a migration id this release does not
#   define, so the drill writes exactly that row (and records it under
#   `newer_release_simulation`). Nothing else about a second code revision
#   affects this release's decision, and building a second patched image would
#   only restate the row. The `--apply` half of the drill is real: it runs the
#   shipped CLI against the disposable database and reads the result back.
# * The ledger holds one reversible migration, and the drill rehearses its
#   rollback for real: it applies the ledger through the shipped CLI, reads that
#   migration's database effect (the retention index on platform_events) back out
#   of MongoDB, rolls the migration back with `--rollback-to`, requires the effect
#   to be gone and the migration reported pending again, and then re-applies it.
#   The reversible migration indexes an existing field, so its down path restores
#   the previous index set and cannot lose a record. A reversible migration that
#   *transforms* customer data does not exist yet, and the drill says so rather
#   than implying one was rehearsed.
# * The registry's first migration is irreversible, so the rehearsed rollback for
#   it is the recovery-capture restore, and the drill verifies that the CLI
#   refuses to roll through it and names that path.
#
# The reversible path is also exercised deterministically by
# backend/tests/test_schema_migrations.py, so a host that cannot run this drill
# still has a check that the down path removes exactly what the up path created.
#
# It never reads deployment secrets, never touches a default-project deployment,
# and always cleans up its disposable project. Run it on a Docker host with the
# repository checkout; the first run builds the API image and is slower.

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
$databaseName = 'nexusmsp'

# The migration this release defines. Pinned by name so a registry edit that
# renames it fails the drill instead of silently rehearsing another migration.
$knownMigrationId = '0001-adopt-prelaunch-event-backfills'

# The reversible migration this release defines, and the exact database effect its
# down path has to undo. Both are pinned by name so a registry edit that renames
# either one fails the drill instead of silently rehearsing something else.
$reversibleMigrationId = '0002-index-platform-event-retention'
$reversibleIndexName = 'event_retention_until'
$platformEventsCollection = 'platform_events'

# A migration id that only a *later* release would define.
$laterMigrationId = '0999-drill-future-release-migration'

function New-NexusMigrationSecret {
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

function Invoke-NexusMigrationCompose {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & docker compose @script:composeArguments @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed during the migration drill."
  }
}

function Invoke-NexusMigrationComposeOutput {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $output = @(& docker compose @script:composeArguments @Arguments)
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed during the migration drill."
  }
  return $output
}

function Invoke-NexusMigrationContainerScript {
  param(
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string]$Service
  )

  return @(Invoke-NexusMigrationComposeOutput -Arguments @('exec', '-T', $Service, 'sh', '-c', $Script))
}

function Invoke-NexusMigrationMongoScript {
  param([Parameter(Mandatory = $true)][string]$File)

  Invoke-NexusMigrationCompose -Arguments @('cp', $File, "${mongoService}:/tmp/nexus-migration-drill.js")
  $mongoScript = 'mongosh --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet /tmp/nexus-migration-drill.js'
  return @(Invoke-NexusMigrationContainerScript -Service $mongoService -Script $mongoScript)
}

function Get-NexusMigrationLedgerIds {
  # The ledger row ids are the whole cross-release contract, so they are read
  # straight from the database rather than inferred from CLI output.
  $script = "db.getSiblingDB('{0}').schema_migrations.find({{}}, {{ id: 1, _id: 0 }}).sort({{ id: 1 }}).forEach(function (row) {{ print('LEDGER_ID=' + row.id); }});" -f $databaseName
  $file = Join-Path $stagingDirectory 'ledger.js'
  Set-Content -LiteralPath $file -Value $script -Encoding ascii
  $lines = Invoke-NexusMigrationMongoScript -File $file
  return @($lines | Where-Object { $_ -like 'LEDGER_ID=*' } | ForEach-Object { $_.Substring('LEDGER_ID='.Length).Trim() })
}

function Get-NexusPlatformEventIndexNames {
  # The reversible migration's whole effect is an index, so the drill reads the
  # index list from the server itself. A down path verified only against the CLI's
  # own output would prove nothing about the database.
  $script = "db.getSiblingDB('{0}').{1}.getIndexes().forEach(function (index) {{ print('INDEX_NAME=' + index.name); }});" -f $databaseName, $platformEventsCollection
  $file = Join-Path $stagingDirectory 'indexes.js'
  Set-Content -LiteralPath $file -Value $script -Encoding ascii
  $lines = Invoke-NexusMigrationMongoScript -File $file
  return @($lines | Where-Object { $_ -like 'INDEX_NAME=*' } | ForEach-Object { $_.Substring('INDEX_NAME='.Length).Trim() })
}

function Get-NexusRolledBackPendingIds {
  # A rollback is only complete when the migration is unapplied again, not merely
  # absent from `applied`. The CLI writes its pending NOTICE to stderr, which the
  # CLI helper merges into the captured output, so the JSON payload is what remains
  # once those lines are dropped.
  param([Parameter(Mandatory = $true)]$StatusResult)

  $payloadText = (@($StatusResult.output -split "`n") | Where-Object { $_ -notmatch '^\s*NOTICE:' }) -join "`n"
  $payload = ConvertFrom-Json -InputObject $payloadText
  return @($payload.status.pending)
}

function Get-NexusMigrationMarkerCount {
  $script = "print('MARKER_COUNT=' + db.getSiblingDB('{0}').migration_drill.countDocuments({{ marker: '{1}' }}));" -f $databaseName, $markerToken
  $file = Join-Path $stagingDirectory 'marker.js'
  Set-Content -LiteralPath $file -Value $script -Encoding ascii
  $lines = Invoke-NexusMigrationMongoScript -File $file
  $line = @($lines | Where-Object { $_ -like 'MARKER_COUNT=*' })[0]
  if (-not $line) { return -1 }
  return [int]$line.Substring('MARKER_COUNT='.Length).Trim()
}

function Invoke-NexusMigrationCli {
  param([Parameter(Mandatory = $true)][string]$Arguments)

  # The CLI's own exit code is the interface the change window gates on, so it is
  # captured explicitly: `sh` exits 0 and the code is printed for the drill.
  $script = ('cd /app && python scripts/nexus_migrate.py {0} 2>&1; echo "CLI_EXIT=$?"' -f $Arguments)
  $lines = Invoke-NexusMigrationContainerScript -Service $apiService -Script $script
  $exitLine = @($lines | Where-Object { $_ -like 'CLI_EXIT=*' })[-1]
  if (-not $exitLine) {
    throw "The migration CLI did not report its exit code for: $Arguments"
  }
  return [ordered]@{
    exit_code = [int]$exitLine.Substring('CLI_EXIT='.Length).Trim()
    output    = (@($lines | Where-Object { $_ -notlike 'CLI_EXIT=*' }) -join "`n")
  }
}

function Get-NexusMigrationReadinessCode {
  # http.client does not raise on 4xx/5xx, so one line reports 200, 503 or a
  # connection failure without a try/except the shell would have to quote.
  try {
    $readinessScript = 'python -c "import http.client;c=http.client.HTTPConnection(''127.0.0.1'',8000,timeout=5);c.request(''GET'',''/api/ready'');print(''READY='' + str(c.getresponse().status))"'
    $lines = @(Invoke-NexusMigrationContainerScript -Service $apiService -Script $readinessScript)
    $line = @($lines | Where-Object { $_ -like 'READY=*' })[0]
    if ($line) { return [int]$line.Substring('READY='.Length).Trim() }
  }
  catch {
    # The service is not accepting connections, which the callers treat as "not ready".
  }
  return 0
}

function Wait-NexusMigrationMongoReady {
  param([int]$DeadlineSeconds = 120)

  $deadline = (Get-Date).AddSeconds($DeadlineSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $lines = @(Invoke-NexusMigrationContainerScript -Service $mongoService -Script 'mongosh --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet --eval "print(db.adminCommand(''ping'').ok)"')
      if ($lines -contains '1') { return }
    }
    catch {
      # mongod may still be initialising.
    }
    Start-Sleep -Seconds 2
  }
  throw "MongoDB did not become ready within $DeadlineSeconds seconds during the migration drill."
}

function Wait-NexusMigrationReadiness {
  # The first boot of a fresh disposable database also runs the platform's warmup
  # work, so the default deadline is generous on purpose.
  param([int]$ExpectedCode, [int]$DeadlineSeconds = 300)

  $deadline = (Get-Date).AddSeconds($DeadlineSeconds)
  while ((Get-Date) -lt $deadline) {
    if ((Get-NexusMigrationReadinessCode) -eq $ExpectedCode) { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Write-NexusMigrationFailureDiagnostics {
  Write-Warning '[Nexus migration drill] Compose diagnostics follow before cleanup:'
  & docker compose @script:composeArguments logs --tail=60 $mongoService $apiService 2>&1 | Out-Host
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Required command 'docker' was not found. Install Docker on the drill host."
}
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Compose v2 (docker compose) is required for the migration drill.'
}
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
  throw "The Compose file '$ComposeFile' was not found."
}

$cliPath = Join-Path $PSScriptRoot '..\backend\scripts\nexus_migrate.py'
if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
  throw 'The migration ledger CLI (backend/scripts/nexus_migrate.py) was not found. The drill rehearses that CLI, so it cannot run without it.'
}

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$projectName = "nexus-migration-drill-$runId"
$markerToken = "migration-$runId"
$release = "nexus-migration-drill-$runId:1.0.0"
$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-migration-drill-" + [guid]::NewGuid().ToString('N'))
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
  drill                  = 'nexus-database-migration-ledger'
  run_id                 = $runId
  compose_file           = (Resolve-Path -LiteralPath $ComposeFile).Path
  generated_project_name = $projectName
  drill_scope            = 'database-migration-ledger-reversible-rollback-and-startup-gate'
  known_migration_id     = $knownMigrationId
  reversible_migration_id = $reversibleMigrationId
  reversible_index_name  = $reversibleIndexName
  reversible_effect      = "index '$reversibleIndexName' on '$platformEventsCollection'"
  started_at             = [DateTimeOffset]::UtcNow.ToString('o')
  release                = [ordered]@{
    reference = $release
    image_id  = $null
  }
  newer_release_simulation = [ordered]@{
    simulated      = $true
    ledger_row_id  = $laterMigrationId
    why            = 'A newer release leaves a ledger row for a migration id this release does not define; building a second patched image would only restate that row.'
    removed_before_cleanup = $false
  }
  verification           = [ordered]@{
    api_started_and_reported_ledger                    = $false
    cli_status_reports_pending_without_refusing        = $false
    migration_applied_by_cli                           = $false
    readiness_after_apply                              = $false
    seeded_data_survived_the_migration                 = $false
    reversible_migration_effect_observed               = $false
    reversible_migration_rolled_back_by_cli            = $false
    rolled_back_effect_reverted                        = $false
    rolled_back_migration_is_pending_again             = $false
    rolled_back_migration_reapplied_cleanly            = $false
    cli_refused_database_ahead                         = $false
    readiness_refused_database_ahead                   = $false
    startup_refused_database_ahead                     = $false
    refusal_named_the_remedy                           = $false
    irreversible_rollback_refused_and_named_the_path   = $false
    refused_rollback_changed_nothing                   = $false
    service_recovered_after_ledger_restored            = $false
  }
  result                 = 'failed'
  evidence_note          = 'Disposable drill values only; no deployment secrets are recorded.'
}
$drillPassed = $false
$laterRowWritten = $false
$applyStarted = $null
$applyEnded = $null
$reversibleRollbackStarted = $null
$reversibleRollbackEnded = $null

try {
  [Environment]::SetEnvironmentVariable('MONGO_USERNAME', 'nexus_drill_user', 'Process')
  [Environment]::SetEnvironmentVariable('MONGO_PASSWORD', (New-NexusMigrationSecret), 'Process')
  [Environment]::SetEnvironmentVariable('JWT_SECRET', (New-NexusMigrationSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_SECRET_ENCRYPTION_KEY', (New-NexusMigrationSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_DMARC_RECEIVER_TOKEN', (New-NexusMigrationSecret), 'Process')
  [Environment]::SetEnvironmentVariable('CORS_ORIGINS', 'http://127.0.0.1:8080', 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_ALERT_WEBHOOK_URL', 'https://alerts.example.invalid/nexus-drill', 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_GRAFANA_ADMIN_PASSWORD', (New-NexusMigrationSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_OBSERVABILITY_INGEST_TOKEN', (New-NexusMigrationSecret), 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_TLS_DOMAIN', 'localhost', 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_TLS_ACME_EMAIL', 'ops@replace.invalid', 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_API_IMAGE', $release, 'Process')
  [Environment]::SetEnvironmentVariable('NEXUS_AGENT_VERSION', '0.0.3-migration-drill', 'Process')

  Write-Host "[Nexus migration drill] Disposable project: $projectName"
  Write-Host '[Nexus migration drill] Building the release from this checkout...'
  Invoke-NexusMigrationCompose -Arguments @('build', 'api')
  $imageId = @(& docker image inspect --format '{{.Id}}' $release)
  if ($LASTEXITCODE -ne 0 -or -not $imageId) {
    throw "The built release '$release' is not present on this host; the drill cannot verify what is running."
  }
  $evidence.release.image_id = $imageId[0].Trim().ToLowerInvariant()

  Write-Host '[Nexus migration drill] Starting the disposable stack (APP_ENV=production)...'
  Invoke-NexusMigrationCompose -Arguments @('up', '-d', $mongoService, $apiService)
  Wait-NexusMigrationMongoReady
  if (-not (Wait-NexusMigrationReadiness -ExpectedCode 200)) {
    throw 'The API did not become ready, so the ledger checks cannot start from a known-good release.'
  }
  $evidence.verification.api_started_and_reported_ledger = $true

  # Seed data before migrating: a migration that changed stored shape must not be
  # allowed to disturb unrelated records, and the drill proves the record is
  # still there afterwards.
  $seedFile = Join-Path $stagingDirectory 'seed.js'
  # ASCII content, ASCII encoding: a UTF-8 BOM from Windows PowerShell 5.1
  # would break the mongosh script parse.
  Set-Content -LiteralPath $seedFile -Value ("db.getSiblingDB('{0}').migration_drill.insertOne({{ marker: '{1}', created_at: new Date() }}); print('SEEDED');" -f $databaseName, $markerToken) -Encoding ascii
  $seedLines = Invoke-NexusMigrationMongoScript -File $seedFile
  if ($seedLines -notcontains 'SEEDED') {
    throw 'The database marker could not be seeded, so data survival across the migration cannot be proven.'
  }

  # An unapplied migration is reported, not fatal: the previous release is still
  # serving while the change window applies it.
  Write-Host '[Nexus migration drill] Reading the ledger before applying...'
  $beforeApply = Invoke-NexusMigrationCli -Arguments '--status --json'
  $evidence.verification.cli_status_reports_pending_without_refusing = [bool](
    ($beforeApply.exit_code -eq 0) -and ($beforeApply.output -match [regex]::Escape($knownMigrationId))
  )
  if (-not $evidence.verification.cli_status_reports_pending_without_refusing) {
    throw 'The migration CLI did not report the unapplied registry migration as a non-fatal notice.'
  }

  Write-Host '[Nexus migration drill] Applying the ledger through the shipped CLI...'
  $applyStarted = [DateTimeOffset]::UtcNow
  $apply = Invoke-NexusMigrationCli -Arguments '--apply --actor migration-drill'
  $applyEnded = [DateTimeOffset]::UtcNow
  $ledgerAfterApply = @(Get-NexusMigrationLedgerIds)
  $evidence.verification.migration_applied_by_cli = [bool](
    ($apply.exit_code -eq 0) -and ($ledgerAfterApply -contains $knownMigrationId)
  )
  if (-not $evidence.verification.migration_applied_by_cli) {
    throw "The CLI did not record $knownMigrationId in the ledger; the drill cannot rehearse a rollback of an unrecorded migration."
  }
  $evidence.verification.readiness_after_apply = [bool]((Get-NexusMigrationReadinessCode) -eq 200)
  if (-not $evidence.verification.readiness_after_apply) {
    throw 'The API stopped being ready after the migration was applied.'
  }
  $evidence.verification.seeded_data_survived_the_migration = [bool]((Get-NexusMigrationMarkerCount) -eq 1)

  # A reversible migration is the only kind whose rollback is a command rather
  # than a restore decision, so this is the part of the release gate no other
  # drill covers. Every step is read back from the database or from the shipped
  # CLI's own status payload, never from the rollback's own report of itself.
  Write-Host '[Nexus migration drill] Verifying the reversible migration''s database effect...'
  $evidence.verification.reversible_migration_effect_observed = [bool](
    ($ledgerAfterApply -contains $reversibleMigrationId) -and
    ((Get-NexusPlatformEventIndexNames) -contains $reversibleIndexName)
  )
  if (-not $evidence.verification.reversible_migration_effect_observed) {
    throw "The reversible migration $reversibleMigrationId did not produce the index '$reversibleIndexName' it exists to create, so its rollback cannot be rehearsed."
  }

  Write-Host '[Nexus migration drill] Rolling the reversible migration back through the shipped CLI...'
  $reversibleRollbackStarted = [DateTimeOffset]::UtcNow
  $reversibleRollback = Invoke-NexusMigrationCli -Arguments ("--rollback-to {0}" -f $knownMigrationId)
  $reversibleRollbackEnded = [DateTimeOffset]::UtcNow
  $ledgerAfterReversibleRollback = @(Get-NexusMigrationLedgerIds)
  $evidence.verification.reversible_migration_rolled_back_by_cli = [bool](
    ($reversibleRollback.exit_code -eq 0) -and
    ($ledgerAfterReversibleRollback -contains $reversibleMigrationId) -eq $false -and
    ($ledgerAfterReversibleRollback -contains $knownMigrationId)
  )
  if (-not $evidence.verification.reversible_migration_rolled_back_by_cli) {
    throw 'The CLI did not roll the reversible migration back and leave the irreversible one recorded.'
  }
  $evidence.verification.rolled_back_effect_reverted = [bool](
    -not ((Get-NexusPlatformEventIndexNames) -contains $reversibleIndexName)
  )

  $revertedStatus = Invoke-NexusMigrationCli -Arguments '--status --json'
  $rolledBackIsPending = $false
  try {
    $rolledBackIsPending = @(Get-NexusRolledBackPendingIds -StatusResult $revertedStatus) -contains $reversibleMigrationId
  }
  catch {
    throw "The CLI's --status --json payload could not be read after the reversible rollback: $($_.Exception.Message)"
  }
  $evidence.verification.rolled_back_migration_is_pending_again = [bool](
    ($revertedStatus.exit_code -eq 0) -and $rolledBackIsPending
  )

  # A change window that rolls back and then rolls forward again must not be left
  # half-applied, so re-applying is part of the rehearsal.
  Write-Host '[Nexus migration drill] Re-applying the rolled-back migration...'
  $reapply = Invoke-NexusMigrationCli -Arguments '--apply --actor migration-drill'
  $ledgerAfterReapply = @(Get-NexusMigrationLedgerIds)
  $evidence.verification.rolled_back_migration_reapplied_cleanly = [bool](
    ($reapply.exit_code -eq 0) -and
    ($ledgerAfterReapply -contains $reversibleMigrationId) -and
    ((Get-NexusPlatformEventIndexNames) -contains $reversibleIndexName)
  )
  if (-not $evidence.verification.rolled_back_migration_reapplied_cleanly) {
    throw 'Re-applying the rolled-back migration did not restore both its ledger row and its index.'
  }

  Write-Host '[Nexus migration drill] Writing the ledger row a newer release would leave behind...'
  $laterFile = Join-Path $stagingDirectory 'later.js'
  Set-Content -LiteralPath $laterFile -Value ("db.getSiblingDB('{0}').schema_migrations.insertOne({{ id: '{1}', description: 'A migration only a later Nexus release defines.', mode: 'executed', applied_by: 'nexus-migration-drill', applied_at: new Date().toISOString() }}); print('LATER_WRITTEN');" -f $databaseName, $laterMigrationId) -Encoding ascii
  $laterLines = Invoke-NexusMigrationMongoScript -File $laterFile
  if ($laterLines -notcontains 'LATER_WRITTEN') {
    throw 'The drill could not write the newer release ledger row, so the refusal cannot be rehearsed.'
  }
  $laterRowWritten = $true

  # The ledger the CLI reads now contains a migration this release does not
  # define: exactly the state a rollback to older images produces.
  $ledgerBeforeRefusal = @(Get-NexusMigrationLedgerIds)
  $status = Invoke-NexusMigrationCli -Arguments '--status'
  $evidence.verification.cli_refused_database_ahead = [bool](
    ($status.exit_code -eq 1) -and ($status.output -match 'older than the data')
  )
  $evidence.verification.readiness_refused_database_ahead = [bool]((Get-NexusMigrationReadinessCode) -eq 503)

  Write-Host '[Nexus migration drill] Restarting the API against the ahead database...'
  Invoke-NexusMigrationCompose -Arguments @('up', '-d', '--force-recreate', $apiService)
  Start-Sleep -Seconds 10
  $states = @(Invoke-NexusMigrationComposeOutput -Arguments @('ps', '--all', '--format', '{{.State}}', $apiService))
  $state = if ($states) { $states[0].Trim().ToLowerInvariant() } else { '' }
  $logLines = @(Invoke-NexusMigrationComposeOutput -Arguments @('logs', '--tail=80', $apiService))
  $refusalLogged = [bool](@($logLines | Where-Object { $_ -match 'refused to run against an incompatible database' }).Count -gt 0)
  $evidence.verification.startup_refused_database_ahead = [bool](
    (($state -eq 'exited') -or ($state -eq 'restarting')) -and (-not (Wait-NexusMigrationReadiness -ExpectedCode 200 -DeadlineSeconds 15))
  )
  $evidence.verification.refusal_named_the_remedy = [bool](
    $refusalLogged -and (@($logLines | Where-Object { $_ -match 'nexus_migrate\.py --status' }).Count -gt 0)
  )

  Write-Host '[Nexus migration drill] Rehearsing the documented rollback path...'
  $rollback = Invoke-NexusMigrationCli -Arguments '--rollback-all'
  $evidence.verification.irreversible_rollback_refused_and_named_the_path = [bool](
    ($rollback.exit_code -eq 1) -and ($rollback.output -match 'PLATFORM_RECOVERY_RUNBOOK')
  )
  $dryRun = Invoke-NexusMigrationCli -Arguments '--rollback-all --dry-run'
  $evidence.verification.refused_rollback_changed_nothing = [bool](
    ((Get-NexusMigrationLedgerIds) -join ',') -eq ($ledgerBeforeRefusal -join ',') -and
    ((Get-NexusMigrationMarkerCount) -eq 1) -and
    ($dryRun.exit_code -eq 1)
  )

  # Restoring the ledger the drill itself wrote is the documented remedy for a
  # database whose newer-release row was never applied; the release's own
  # migration stays recorded, because nothing here rolls a real migration back.
  Write-Host '[Nexus migration drill] Restoring the ledger and confirming the service recovers...'
  $restoreFile = Join-Path $stagingDirectory 'restore.js'
  Set-Content -LiteralPath $restoreFile -Value ("print('REMOVED=' + db.getSiblingDB('{0}').schema_migrations.deleteOne({{ id: '{1}' }}).deletedCount);" -f $databaseName, $laterMigrationId) -Encoding ascii
  $restoreLines = Invoke-NexusMigrationMongoScript -File $restoreFile
  if ($restoreLines -notcontains 'REMOVED=1') {
    throw 'The drill could not remove its simulated newer-release ledger row.'
  }
  $laterRowWritten = $false
  $evidence.newer_release_simulation.removed_before_cleanup = $true
  Invoke-NexusMigrationCompose -Arguments @('up', '-d', '--force-recreate', $apiService)
  $evidence.verification.service_recovered_after_ledger_restored = [bool](
    (Wait-NexusMigrationReadiness -ExpectedCode 200) -and
    ((Get-NexusMigrationLedgerIds) -contains $knownMigrationId)
  )

  $failedChecks = @($evidence.verification.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key })
  if ($failedChecks.Count -gt 0) {
    throw ("One or more migration verifications failed: {0}" -f ($failedChecks -join ', '))
  }
  $drillPassed = $true
  Write-Host '[Nexus migration drill] PASSED: the ledger was applied by the shipped CLI, the reversible migration''s rollback removed its index and left it pending again before re-applying cleanly, an ahead database was refused by the CLI, by readiness and by startup, the refusal named the documented remedy, and the service recovered once the ledger matched the release.'
}
catch {
  Write-NexusMigrationFailureDiagnostics
  throw
}
finally {
  if ($applyStarted -and $applyEnded) {
    $evidence.migration_apply = [ordered]@{
      started_at_utc   = $applyStarted.ToString('o')
      ended_at_utc     = $applyEnded.ToString('o')
      duration_seconds = [math]::Round(($applyEnded - $applyStarted).TotalSeconds, 1)
    }
  }
  if ($reversibleRollbackStarted -and $reversibleRollbackEnded) {
    $evidence.reversible_migration_rollback = [ordered]@{
      migration_id     = $reversibleMigrationId
      started_at_utc   = $reversibleRollbackStarted.ToString('o')
      ended_at_utc     = $reversibleRollbackEnded.ToString('o')
      duration_seconds = [math]::Round(($reversibleRollbackEnded - $reversibleRollbackStarted).TotalSeconds, 1)
    }
  }
  if ($laterRowWritten) {
    # Never leave the disposable database in the state the drill created.
    try {
      $cleanupFile = Join-Path $stagingDirectory 'cleanup.js'
      Set-Content -LiteralPath $cleanupFile -Value ("db.getSiblingDB('{0}').schema_migrations.deleteOne({{ id: '{1}' }});" -f $databaseName, $laterMigrationId) -Encoding ascii
      Invoke-NexusMigrationMongoScript -File $cleanupFile | Out-Null
    }
    catch {
      Write-Warning 'The disposable drill database still holds the simulated ledger row; the project is removed below.'
    }
  }
  $evidence.result = if ($drillPassed) { 'passed' } else { 'failed' }
  $evidence.completed_at = [DateTimeOffset]::UtcNow.ToString('o')

  New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
  $evidencePath = Join-Path $EvidenceDirectory ("migration-drill-{0}-{1}.json" -f ([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')), $runId)
  $evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $evidencePath -Encoding utf8
  Write-Host "[Nexus migration drill] Evidence written: $evidencePath"

  Write-Host "[Nexus migration drill] Removing disposable project $projectName..."
  & docker compose @script:composeArguments down --volumes --remove-orphans *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "The disposable drill project may need manual cleanup: $projectName"
  }
  Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue

  foreach ($name in $environmentNames) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
  }

  # The drilled release image is a local build artifact of this checkpoint;
  # leaving it behind would let a later drill reuse a stale "release".
  & docker image rm --force $release *> $null
}
