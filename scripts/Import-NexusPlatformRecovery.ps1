[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$PackagePath,

  # Supplied only at execution time. It is not written to the plan or output.
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$MongoUri,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$')]
  [string]$DatabaseName,

  [string]$UploadsPath = (Join-Path $PSScriptRoot '..\backend\uploads'),
  [string]$PrivateUploadsPath = (Join-Path $PSScriptRoot '..\backend\private_uploads'),
  [string]$InstallersPath = (Join-Path $PSScriptRoot '..\data\agent-installers'),

  # The default is inspect-only. Both switches are required before any restore.
  [switch]$Apply,
  [switch]$AllowRestore,

  # Existing data is never replaced unless all three controls below are used.
  [switch]$AllowOverwrite,
  [string]$TargetConfirmation,
  [string]$PreRestoreBackupPackagePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NexusCommandPath {
  param([Parameter(Mandatory = $true)][string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command '$Name' was not found. Install MongoDB Database Tools on the restore host."
  }
  return $command.Source
}

function Get-NexusFullPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-NexusArchiveIsSafe {
  param([Parameter(Mandatory = $true)][string]$ArchivePath)

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $manifestCount = 0
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace('\', '/')
      if ($name -eq 'manifest.json') { $manifestCount++ }
      if ([string]::IsNullOrWhiteSpace($name) -or $name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)') {
        throw 'The package contains an unsafe archive path and was rejected.'
      }
    }
    if ($manifestCount -ne 1) {
      throw 'The package must contain exactly one manifest.json at its root.'
    }
  }
  finally {
    $archive.Dispose()
  }
}

function Get-NexusDirectoryFileCount {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return 0 }
  return @((Get-ChildItem -LiteralPath $Path -File -Force -Recurse)).Count
}

function Test-NexusManifest {
  param([Parameter(Mandatory = $true)][string]$ExtractionPath)

  $manifestPath = Join-Path $ExtractionPath 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The recovery package has no manifest.json.'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ([int]$manifest.schema_version -ne 1 -or -not $manifest.package_id -or -not $manifest.database.archive_path) {
    throw 'The recovery package manifest is unsupported or incomplete.'
  }
  $declaredArchivePath = [string]$manifest.database.archive_path
  if ($declaredArchivePath.StartsWith('/') -or $declaredArchivePath.Contains('\') -or $declaredArchivePath -match '(^|/)\.\.(/|$)') {
    throw 'The recovery package manifest declares an unsafe database archive path.'
  }

  $expectedPaths = @{}
  foreach ($file in @($manifest.files)) {
    if (-not $file.path -or -not $file.sha256) { throw 'The recovery package manifest contains an invalid checksum entry.' }
    $relative = [string]$file.path
    if ($relative.StartsWith('/') -or $relative -match '(^|/)\.\.(/|$)') { throw 'The recovery package manifest contains an unsafe file path.' }
    if ($relative.Replace('\', '/') -eq 'manifest.json') { throw 'The manifest must not declare itself as a payload file.' }
    $expectedPaths[$relative.Replace('\', '/')] = $file
  }

  $actualPayloadPaths = @(
    Get-ChildItem -LiteralPath $ExtractionPath -File -Force -Recurse |
      ForEach-Object {
        $baseUri = [Uri]($ExtractionPath.TrimEnd('\') + '\')
        $fileUri = [Uri]$_.FullName
        [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($fileUri).ToString()).Replace('\', '/')
      }
  )
  foreach ($actualPath in $actualPayloadPaths) {
    if ($actualPath -ne 'manifest.json' -and -not $expectedPaths.ContainsKey($actualPath)) {
      throw "The recovery package contains an undeclared payload file: $actualPath."
    }
  }

  foreach ($pair in $expectedPaths.GetEnumerator()) {
    $target = Join-Path $ExtractionPath $pair.Key.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
      throw "The recovery package is missing a manifest-listed payload file: $($pair.Key)."
    }
    $actualHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne ([string]$pair.Value.sha256).ToLowerInvariant()) {
      throw "Checksum validation failed for package payload: $($pair.Key)."
    }
    if ([int64](Get-Item -LiteralPath $target).Length -ne [int64]$pair.Value.bytes) {
      throw "Size validation failed for package payload: $($pair.Key)."
    }
  }

  return $manifest
}

function Get-NexusTargetDocumentCount {
  param(
    [Parameter(Mandatory = $true)][string]$MongoShell,
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$DbName
  )

  # DbName is constrained by the parameter validation before it reaches JS.
  $query = "const d = db.getSiblingDB('$DbName'); let count = 0; for (const collection of d.getCollectionNames()) { count += d.getCollection(collection).countDocuments({}); } print(count);"
  $output = @(& $MongoShell '--quiet' "--uri=$Uri" "--eval=$query" 2>$null)
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not inspect the target database. The restore was not attempted.'
  }
  $countLine = @($output | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1)
  if (-not $countLine) {
    throw 'The target database inspection returned an unexpected result. The restore was not attempted.'
  }
  return [int64]$countLine[0]
}

function Test-NexusArtifactIncluded {
  param(
    [Parameter(Mandatory = $true)][hashtable]$ArtifactMap,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not $ArtifactMap.ContainsKey($Name)) { return $false }
  $artifact = $ArtifactMap[$Name]
  $includedProperty = $artifact.PSObject.Properties['included']
  return ($null -ne $includedProperty -and $includedProperty.Value -eq $true)
}

function Assert-NexusArtifactTarget {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][bool]$WillRestore,
    [Parameter(Mandatory = $true)][bool]$OverwriteAllowed
  )

  if (-not $WillRestore) { return }
  $fileCount = Get-NexusDirectoryFileCount -Path $Destination
  if ($fileCount -gt 0 -and -not $OverwriteAllowed) {
    throw "The $Label destination contains $fileCount file(s). Fresh-target restore refuses to replace it. Use an empty destination or explicitly authorise an overwrite."
  }
}

function Restore-NexusArtifactDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][bool]$OverwriteAllowed
  )

  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return $null }
  $parent = Split-Path -Parent $Destination
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

  $previousPath = $null
  if ((Get-NexusDirectoryFileCount -Path $Destination) -gt 0) {
    if (-not $OverwriteAllowed) { throw "The $Label destination is not empty." }
    $previousPath = "$Destination.nexus-pre-restore-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))"
    Move-Item -LiteralPath $Destination -Destination $previousPath -ErrorAction Stop
  }

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($item in @(Get-ChildItem -LiteralPath $Source -Force)) {
    Copy-Item -LiteralPath $item.FullName -Destination $Destination -Recurse -Force
  }
  return $previousPath
}

$package = Get-NexusFullPath -Path $PackagePath
if (-not (Test-Path -LiteralPath $package -PathType Leaf)) { throw 'The requested recovery package was not found.' }

$extractRoot = Join-Path ([System.IO.Path]::GetTempPath()) "nexus-platform-restore-$([guid]::NewGuid().ToString())"
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

try {
  Assert-NexusArchiveIsSafe -ArchivePath $package
  Expand-Archive -LiteralPath $package -DestinationPath $extractRoot -Force
  $manifest = Test-NexusManifest -ExtractionPath $extractRoot

  if ([string]$manifest.database.name -ne $DatabaseName) {
    throw "The package was created for database '$($manifest.database.name)'. Restoring it into '$DatabaseName' is refused to prevent namespace drift."
  }
  $dumpPath = Join-Path $extractRoot ([string]$manifest.database.archive_path).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf)) { throw 'The package database archive is unavailable after validation.' }

  $artifactMap = @{}
  foreach ($artifact in @($manifest.artifacts)) { $artifactMap[[string]$artifact.name] = $artifact }
  $artifactPlans = @(
    [ordered]@{ name = 'public_uploads'; destination = (Get-NexusFullPath $UploadsPath); source = (Join-Path $extractRoot 'artifacts\public_uploads'); included = (Test-NexusArtifactIncluded -ArtifactMap $artifactMap -Name 'public_uploads') }
    [ordered]@{ name = 'private_uploads'; destination = (Get-NexusFullPath $PrivateUploadsPath); source = (Join-Path $extractRoot 'artifacts\private_uploads'); included = (Test-NexusArtifactIncluded -ArtifactMap $artifactMap -Name 'private_uploads') }
    [ordered]@{ name = 'agent_installers'; destination = (Get-NexusFullPath $InstallersPath); source = (Join-Path $extractRoot 'artifacts\agent_installers'); included = (Test-NexusArtifactIncluded -ArtifactMap $artifactMap -Name 'agent_installers') }
  )

  Write-Host 'Nexus platform recovery package validated.'
  Write-Host "  Package ID: $($manifest.package_id)"
  Write-Host "  Created:    $($manifest.generated_at_utc)"
  Write-Host "  Database:   $DatabaseName"
  foreach ($artifact in $artifactPlans) {
    $state = if ($artifact.included) { 'will restore when applied' } else { 'not included in package' }
    Write-Host "  Artifact $($artifact.name): $state"
  }

  if (-not $Apply) {
    Write-Host ''
    Write-Host 'Inspection only: no database or file data was changed.'
    Write-Host 'To apply to a fresh target, rerun with -Apply -AllowRestore after stopping the target API and worker.'
    return
  }
  if (-not $AllowRestore) {
    throw 'Restore execution requires both -Apply and -AllowRestore. No target data was changed.'
  }

  $mongorestore = Get-NexusCommandPath -Name 'mongorestore'
  $mongosh = Get-NexusCommandPath -Name 'mongosh'
  $targetDocuments = Get-NexusTargetDocumentCount -MongoShell $mongosh -Uri $MongoUri -DbName $DatabaseName
  $overwrite = $targetDocuments -gt 0
  if ($overwrite) {
    if (-not $AllowOverwrite) {
      throw "The target database contains $targetDocuments document(s). Restore is refused by default. Create a fresh target, or follow the overwrite procedure in docs/PLATFORM_RECOVERY_RUNBOOK.md."
    }
    if ($TargetConfirmation -cne "RESTORE $DatabaseName") {
      throw "Live overwrite needs -TargetConfirmation 'RESTORE $DatabaseName'."
    }
    if (-not $PreRestoreBackupPackagePath -or -not (Test-Path -LiteralPath $PreRestoreBackupPackagePath -PathType Leaf)) {
      throw 'Live overwrite needs -PreRestoreBackupPackagePath pointing to a verified, pre-restore recovery package.'
    }
  }

  foreach ($artifact in $artifactPlans) {
    Assert-NexusArtifactTarget -Label $artifact.name -Destination $artifact.destination -WillRestore ([bool]$artifact.included) -OverwriteAllowed $overwrite
  }

  if (-not $PSCmdlet.ShouldProcess("database '$DatabaseName' and included artifact directories", 'Apply verified Nexus platform recovery package')) {
    return
  }

  $restoreArguments = @("--uri=$MongoUri", "--archive=$dumpPath", '--gzip', "--nsInclude=$DatabaseName.*", '--quiet')
  if ($overwrite) { $restoreArguments += '--drop' }
  Write-Host 'Restoring the validated MongoDB archive. Credentials are not printed.'
  & $mongorestore @restoreArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'mongorestore failed. Review MongoDB tooling logs securely; artifact directories were not changed by this script.'
  }

  $artifactRollbackPaths = @()
  foreach ($artifact in $artifactPlans) {
    if ($artifact.included) {
      $previous = Restore-NexusArtifactDirectory -Source $artifact.source -Destination $artifact.destination -Label $artifact.name -OverwriteAllowed $overwrite
      if ($previous) { $artifactRollbackPaths += $previous }
    }
  }

  Write-Host ''
  Write-Host 'Nexus platform recovery data has been applied.'
  Write-Host 'Do not start production traffic until the post-restore checks in docs/PLATFORM_RECOVERY_RUNBOOK.md pass.'
  if ($artifactRollbackPaths.Count -gt 0) {
    Write-Host 'Previous artifact directories were retained beside their destinations for manual verification and rollback.'
  }
}
finally {
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
