[CmdletBinding()]
param(
  # This is intentionally supplied at runtime. The script never writes the URI
  # (and therefore any credentials it contains) to output or to the manifest.
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$MongoUri,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$')]
  [string]$DatabaseName,

  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\artifacts\platform-recovery'),

  # Defaults are useful for a local checkout. Production Docker hosts should
  # pass paths that expose the named volumes or a verified staging copy.
  [string]$UploadsPath = (Join-Path $PSScriptRoot '..\backend\uploads'),
  [string]$PrivateUploadsPath = (Join-Path $PSScriptRoot '..\backend\private_uploads'),
  [string]$InstallersPath = (Join-Path $PSScriptRoot '..\data\agent-installers'),

  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$')]
  [string]$Label = 'manual',

  [switch]$SkipUploads,
  [switch]$SkipPrivateUploads,
  [switch]$SkipInstallers
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NexusCommandPath {
  param([Parameter(Mandatory = $true)][string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command '$Name' was not found. Install MongoDB Database Tools on the backup host."
  }
  return $command.Source
}

function Get-NexusFullPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [System.IO.Path]::GetFullPath($Path)
}

function Get-NexusRelativePath {
  param(
    [Parameter(Mandatory = $true)][string]$BasePath,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $baseUri = [Uri]((Get-NexusFullPath $BasePath).TrimEnd('\') + '\')
  $pathUri = [Uri](Get-NexusFullPath $Path)
  return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace('\', '/')
}

function Copy-NexusArtifactDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationRoot,
    [Parameter(Mandatory = $true)][bool]$Skip
  )

  if ($Skip) {
    return [ordered]@{ name = $Name; included = $false; state = 'skipped_by_operator' }
  }

  if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {
    return [ordered]@{ name = $Name; included = $false; state = 'source_not_found' }
  }

  $destination = Join-Path $DestinationRoot $Name
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  foreach ($item in @(Get-ChildItem -LiteralPath $SourcePath -Force)) {
    Copy-Item -LiteralPath $item.FullName -Destination $destination -Recurse -Force
  }

  return [ordered]@{ name = $Name; included = $true; state = 'included'; package_path = "artifacts/$Name" }
}

function Get-NexusFileManifest {
  param([Parameter(Mandatory = $true)][string]$RootPath)

  $files = @(
    Get-ChildItem -LiteralPath $RootPath -File -Recurse -Force |
      Sort-Object FullName |
      ForEach-Object {
        [ordered]@{
          path = (Get-NexusRelativePath -BasePath $RootPath -Path $_.FullName)
          bytes = [int64]$_.Length
          sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
      }
  )
  return $files
}

function Get-NexusGitRevision {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) { return $null }
  try {
    $revision = (& $git.Source -C (Join-Path $PSScriptRoot '..') rev-parse --short HEAD 2>$null).Trim()
    if ($LASTEXITCODE -eq 0 -and $revision) { return $revision }
  } catch { }
  return $null
}

$mongodump = Get-NexusCommandPath -Name 'mongodump'
$outputRoot = Get-NexusFullPath -Path $OutputDirectory
$packageId = [guid]::NewGuid().ToString()
$timestamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$safeLabel = $Label.ToLowerInvariant()
$packageBaseName = "nexus-platform-$safeLabel-$timestamp"
$stagingPath = Join-Path $outputRoot ".${packageBaseName}-$packageId.staging"
$packagePath = Join-Path $outputRoot "$packageBaseName.nexus-recovery.zip"

if (Test-Path -LiteralPath $packagePath) {
  throw 'A recovery package with the generated name already exists. Try again rather than overwriting an existing backup.'
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null

try {
  $mongoDirectory = Join-Path $stagingPath 'mongo'
  New-Item -ItemType Directory -Path $mongoDirectory -Force | Out-Null
  $mongoArchive = Join-Path $mongoDirectory 'nexus-data.archive.gz'

  Write-Host 'Exporting the Nexus application database. Credentials are not printed.'
  & $mongodump "--uri=$MongoUri" "--db=$DatabaseName" "--archive=$mongoArchive" '--gzip' '--quiet'
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $mongoArchive -PathType Leaf)) {
    throw 'mongodump did not create a valid database archive. No recovery package was produced.'
  }

  $artifactsRoot = Join-Path $stagingPath 'artifacts'
  New-Item -ItemType Directory -Path $artifactsRoot -Force | Out-Null
  $artifacts = @(
    Copy-NexusArtifactDirectory -Name 'public_uploads' -SourcePath $UploadsPath -DestinationRoot $artifactsRoot -Skip ([bool]$SkipUploads)
    Copy-NexusArtifactDirectory -Name 'private_uploads' -SourcePath $PrivateUploadsPath -DestinationRoot $artifactsRoot -Skip ([bool]$SkipPrivateUploads)
    Copy-NexusArtifactDirectory -Name 'agent_installers' -SourcePath $InstallersPath -DestinationRoot $artifactsRoot -Skip ([bool]$SkipInstallers)
  )

  $files = Get-NexusFileManifest -RootPath $stagingPath
  $manifest = [ordered]@{
    schema_version = 1
    package_id = $packageId
    generated_at_utc = [DateTime]::UtcNow.ToString('o')
    producer = [ordered]@{
      tool = 'Export-NexusPlatformRecovery.ps1'
      host = $env:COMPUTERNAME
      git_revision = Get-NexusGitRevision
    }
    database = [ordered]@{
      name = $DatabaseName
      archive_path = 'mongo/nexus-data.archive.gz'
      format = 'mongodump archive with gzip compression'
    }
    artifacts = $artifacts
    files = $files
    security = [ordered]@{
      mongo_uri_included = $false
      environment_files_included = $false
      agent_pki_included = $false
      note = 'The database archive can contain confidential and encrypted application records. Store the package only in an approved encrypted backup location.'
    }
    restore_contract = [ordered]@{
      target_must_be_fresh_by_default = $true
      database_name_must_match = $true
      application_configuration_must_be_recreated = @('database URI', 'JWT secret', 'secret-encryption key', 'provider credentials', 'TLS and ingress configuration')
      required_operator_steps = @('Validate checksums', 'Stop target API and worker before cutover', 'Restore into an empty target by default', 'Run a documented post-restore smoke test')
    }
  }
  $manifestPath = Join-Path $stagingPath 'manifest.json'
  $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

  Write-Host 'Compressing the recovery package...'
  Compress-Archive -Path (Join-Path $stagingPath '*') -DestinationPath $packagePath -CompressionLevel Optimal -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw 'The recovery package archive was not created.'
  }

  $packageHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $packageSize = (Get-Item -LiteralPath $packagePath).Length
  Write-Host ''
  Write-Host 'Nexus platform recovery package created.'
  Write-Host "  Package:  $packagePath"
  Write-Host "  SHA-256:  $packageHash"
  Write-Host "  Bytes:    $packageSize"
  Write-Host 'Keep the package in an approved encrypted off-host backup location and retain this checksum separately.'
  Write-Host 'No URI, environment file, or Agent PKI material was printed or packaged outside the confidential database archive.'
}
finally {
  if (Test-Path -LiteralPath $stagingPath) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force -ErrorAction SilentlyContinue
  }
}
