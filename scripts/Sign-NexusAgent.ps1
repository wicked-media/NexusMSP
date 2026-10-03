# Authenticode signing scaffold for the Nexus Windows Agent release components.
#
# Signs nexus-agent.exe, nexus-client-chat.exe and nexus-agent-tray.exe with
# Windows signtool, verifies each signature, and writes a signing evidence JSON
# (signer identity, certificate thumbprint, RFC3161 timestamp and per-file
# SHA-256 before/after) for the release evidence record.
#
# The certificate is supplied by the operator (PFX file or certificate-store
# thumbprint). The password is accepted as a SecureString and is never echoed.
# A release without a trusted Authenticode certificate is not a release
# candidate; see docs/RELEASE_RUNBOOK.md.

[CmdletBinding(DefaultParameterSetName = 'PfxFile')]
param(
  [string]$DistDirectory = (Join-Path $PSScriptRoot '..\agent\dist'),

  [Parameter(Mandatory = $true, ParameterSetName = 'PfxFile')]
  [string]$CertificatePath,

  [Parameter(ParameterSetName = 'PfxFile')]
  [SecureString]$CertificatePassword,

  [Parameter(Mandatory = $true, ParameterSetName = 'CertificateStore')]
  [ValidatePattern('^[A-Fa-f0-9]{40}$')]
  [string]$CertificateThumbprint,

  [ValidatePattern('^https?://')]
  [string]$TimestampUrl = 'http://timestamp.digicert.com',

  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\artifacts\agent-signing'),

  # Signing description embedded in each signature.
  [string]$Description = 'NexusMSP Endpoint Agent'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$releaseComponents = @('nexus-agent.exe', 'nexus-client-chat.exe', 'nexus-agent-tray.exe')

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
  throw 'signtool.exe was not found. Install the Windows SDK (Sign Tool) on the signing host.'
}
if (-not (Test-Path -LiteralPath $DistDirectory -PathType Container)) {
  throw "The agent distribution directory '$DistDirectory' was not found. Build the Windows agent components first."
}

$targets = @()
foreach ($component in $releaseComponents) {
  $path = Join-Path $DistDirectory $component
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Expected release component '$component' was not found in $DistDirectory."
  }
  $targets += (Resolve-Path -LiteralPath $path).Path
}

$certificateThumbprintResolved = $null
if ($PSCmdlet.ParameterSetName -eq 'PfxFile') {
  if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) {
    throw "The signing certificate '$CertificatePath' was not found."
  }
  $certificatePathResolved = (Resolve-Path -LiteralPath $CertificatePath).Path
}
else {
  $certificatePathResolved = $null
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', 'LocalMachine')
  try {
    $store.Open('ReadOnly')
    $match = $store.Certificates | Where-Object { $_.Thumbprint -eq $CertificateThumbprint }
  }
  finally {
    $store.Close()
  }
  if (-not $match) {
    throw "Certificate with thumbprint $CertificateThumbprint was not found in the LocalMachine\\My store."
  }
  $certificateThumbprintResolved = $CertificateThumbprint.ToUpperInvariant()
}

# signtool reads the PFX password only from its command line. Convert the
# SecureString at the last moment and never write it to logs or evidence.
$plainPassword = $null
if ($PSCmdlet.ParameterSetName -eq 'PfxFile' -and $CertificatePassword) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($CertificatePassword)
  try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Get-FileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$evidence = [ordered]@{
  tool              = 'signtool'
  signed_at_utc     = $null
  description       = $Description
  timestamp_url     = $TimestampUrl
  certificate       = [ordered]@{
    source      = $PSCmdlet.ParameterSetName
    thumbprint  = $certificateThumbprintResolved
    subject     = $null
  }
  files             = @()
  verification     = 'signtool verify /pa'
}

$signedAt = [DateTimeOffset]::UtcNow
$evidence.signed_at_utc = $signedAt.ToString('o')

foreach ($target in $targets) {
  $before = Get-FileSha256 -Path $target
  Write-Host "Signing $([System.IO.Path]::GetFileName($target))..."

  $signArguments = @('sign', '/fd', 'SHA256', '/tr', $TimestampUrl, '/td', 'SHA256', '/d', $Description)
  if ($certificatePathResolved) {
    $signArguments += @('/f', $certificatePathResolved)
    if ($plainPassword) { $signArguments += @('/p', $plainPassword) }
  }
  else {
    $signArguments += @('/sha1', $certificateThumbprintResolved)
  }
  $signArguments += $target

  & $signtool.Source @signArguments
  if ($LASTEXITCODE -ne 0) {
    throw "signtool sign failed for $target (exit code $LASTEXITCODE)."
  }

  & $signtool.Source verify /pa $target
  if ($LASTEXITCODE -ne 0) {
    throw "signtool verify failed for $target (exit code $LASTEXITCODE)."
  }

  $after = Get-FileSha256 -Path $target
  $evidence.files += [ordered]@{
    file          = [System.IO.Path]::GetFileName($target)
    sha256_before = $before
    sha256_after  = $after
    signed        = $true
    verified      = $true
  }
}

# Record the signer identity from the first signed file for the evidence log.
try {
  $signature = Get-AuthenticodeSignature -LiteralPath $targets[0]
  if ($signature -and $signature.SignerCertificate) {
    $evidence.certificate.subject = $signature.SignerCertificate.Subject
    $evidence.certificate.thumbprint = $signature.SignerCertificate.Thumbprint.ToUpperInvariant()
  }
}
catch {
  Write-Warning 'The signer identity could not be read back for the evidence record; signtool verification already passed.'
}

$plainPassword = $null

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$evidencePath = Join-Path $OutputDirectory ("agent-signing-evidence-{0}.json" -f $signedAt.ToString('yyyyMMddTHHmmssZ'))
$evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $evidencePath -Encoding utf8

$sumsPath = Join-Path $OutputDirectory 'SHA256SUMS.txt'
$sums = foreach ($entry in $evidence.files) {
  '{0}  {1}' -f $entry.sha256_after, $entry.file
}
Set-Content -LiteralPath $sumsPath -Value $sums -Encoding ascii

Write-Host ''
Write-Host "Signed and verified $($evidence.files.Count) release components."
Write-Host "Signing evidence: $evidencePath"
Write-Host "Checksums: $sumsPath"
