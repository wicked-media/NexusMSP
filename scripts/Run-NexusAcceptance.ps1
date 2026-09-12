[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 18000,
    [switch]$KeepEnvironment,
    [switch]$UseLocalMongo,
    [string]$LocalMongoUrl = "mongodb://127.0.0.1:27017",
    [string]$PythonExecutable = ""
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $root "docker-compose.acceptance.yml"
$acceptanceTest = Join-Path $root "backend\tests\test_two_client_api_acceptance.py"
$projectName = "nexus-acceptance-$([guid]::NewGuid().ToString('N'))"
$acceptanceDatabase = "nexus_acceptance_$([guid]::NewGuid().ToString('N'))"
$apiUrl = "http://127.0.0.1:$Port"
$composeProjectArguments = @("-p", $projectName, "-f", $composeFile)
$composeAttempted = $false
$script:composeExecutable = $null
$script:composePrefix = @()
$localMongoValidated = $false
$localApiProcess = $null
$localApiLogDirectory = $null
$localApiUploadDirectory = $null

function Resolve-NexusAcceptancePython {
    if ($PythonExecutable) {
        if (Test-Path -LiteralPath $PythonExecutable) {
            return (Resolve-Path -LiteralPath $PythonExecutable).Path
        }
        $command = Get-Command $PythonExecutable -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Source
        }
        throw "-PythonExecutable could not be resolved: $PythonExecutable"
    }

    $candidates = @(
        (Join-Path $root ".venv\Scripts\python.exe"),
        (Join-Path $root ".venv/bin/python")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $command = Get-Command python -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    throw "Python was not found. Create .venv, add Python to PATH, or pass -PythonExecutable."
}

$venvPython = Resolve-NexusAcceptancePython

function New-NexusAcceptanceSecret {
    $bytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes)
    }
    finally {
        $rng.Dispose()
    }
}

function Wait-NexusAcceptanceApi {
    param(
        [string]$Url,
        [System.Diagnostics.Process]$Process
    )

    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        if ($Process) {
            $Process.Refresh()
            if ($Process.HasExited) {
                throw "The disposable Nexus acceptance API exited before reaching /api/ready (exit code $($Process.ExitCode))."
            }
        }
        try {
            $response = Invoke-WebRequest -Uri "$Url/api/ready" -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
            # The API deliberately returns 503 until its safe startup checks are complete.
        }
        Start-Sleep -Milliseconds 750
    }

    throw "The disposable Nexus acceptance API did not reach /api/ready within 120 seconds."
}

function Test-NexusComposeRuntime {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,
        [string[]]$Prefix = @(),
        [string[]]$ProbeArguments = @("version")
    )

    try {
        & $Executable @Prefix @ProbeArguments *> $null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}

function Invoke-NexusAcceptanceCompose {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$ComposeArguments
    )

    & $script:composeExecutable @script:composePrefix @composeProjectArguments @ComposeArguments | Out-Host
    return $LASTEXITCODE
}

function Assert-NexusLocalMongoUrl {
    param([Parameter(Mandatory = $true)][string]$MongoUrl)

    try {
        $uri = [Uri]$MongoUrl
    }
    catch {
        throw "-LocalMongoUrl must be a valid mongodb:// loopback connection string."
    }
    if ($uri.Scheme -ne "mongodb") {
        throw "-LocalMongoUrl must use mongodb://. mongodb+srv:// and remote MongoDB targets are not permitted by this disposable runner."
    }
    if ($uri.UserInfo) {
        throw "-LocalMongoUrl must not include credentials. Configure a local unauthenticated test MongoDB listener instead."
    }

    $mongoHost = $uri.Host.Trim('[', ']').ToLowerInvariant()
    $parsedAddress = $null
    $isLoopbackAddress = [System.Net.IPAddress]::TryParse($mongoHost, [ref]$parsedAddress) -and [System.Net.IPAddress]::IsLoopback($parsedAddress)
    if ($mongoHost -notin @("localhost", "ip6-localhost") -and -not $isLoopbackAddress) {
        throw "-LocalMongoUrl must point to localhost or a loopback address; refusing a remote MongoDB target."
    }
}

function Test-NexusLocalMongo {
    param([Parameter(Mandatory = $true)][string]$MongoUrl)

    $probe = @'
import sys
from pymongo import MongoClient

client = MongoClient(sys.argv[1], serverSelectionTimeoutMS=5000)
try:
    client.admin.command("ping")
finally:
    client.close()
'@
    & $venvPython -c $probe $MongoUrl
    if ($LASTEXITCODE -ne 0) {
        throw "The supplied local MongoDB listener did not pass a health check. Start a local loopback MongoDB instance or use the default Compose path."
    }
}

function Remove-NexusAcceptanceDatabase {
    param(
        [Parameter(Mandatory = $true)][string]$MongoUrl,
        [Parameter(Mandatory = $true)][string]$DatabaseName
    )

    $drop = @'
import sys
from pymongo import MongoClient

database_name = sys.argv[2]
if not database_name.startswith("nexus_acceptance_"):
    raise SystemExit("Refusing to drop a non-acceptance database")
client = MongoClient(sys.argv[1], serverSelectionTimeoutMS=5000)
try:
    client.drop_database(database_name)
finally:
    client.close()
'@
    & $venvPython -c $drop $MongoUrl $DatabaseName
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "The generated acceptance database may need manual cleanup: $DatabaseName"
    }
}

function Stop-NexusAcceptanceApi {
    param([System.Diagnostics.Process]$Process)

    if (-not $Process) {
        return
    }
    try {
        $Process.Refresh()
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction Stop
            [void]$Process.WaitForExit(15000)
        }
    }
    catch {
        Write-Warning "The generated local acceptance API process may need manual cleanup: PID $($Process.Id)"
    }
    finally {
        $Process.Dispose()
    }
}

function Write-NexusAcceptanceApiDiagnostics {
    param([string]$LogDirectory)

    if (-not $LogDirectory -or -not (Test-Path -LiteralPath $LogDirectory)) {
        return
    }

    Write-Warning "[Nexus acceptance] Isolated API diagnostics follow before cleanup:"
    foreach ($logName in @("api.stderr.log", "api.stdout.log")) {
        $logPath = Join-Path $LogDirectory $logName
        if (Test-Path -LiteralPath $logPath) {
            Write-Host "--- $logName ---"
            Get-Content -LiteralPath $logPath -Tail 160
        }
    }
}

function Remove-NexusAcceptanceTempDirectory {
    param([string]$Directory)

    if (-not $Directory -or -not (Test-Path -LiteralPath $Directory)) {
        return
    }
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $resolvedDirectory = [System.IO.Path]::GetFullPath($Directory)
    $directoryName = Split-Path -Leaf $resolvedDirectory
    if ($resolvedDirectory.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and $directoryName.StartsWith("nexus-acceptance-")) {
        Remove-Item -LiteralPath $resolvedDirectory -Recurse -Force -ErrorAction SilentlyContinue
        return
    }
    Write-Warning "Refusing to remove an unexpected local acceptance temp path: $resolvedDirectory"
}

if (-not $UseLocalMongo -and -not (Test-Path -LiteralPath $composeFile)) {
    throw "Acceptance compose file was not found: $composeFile"
}
if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Nexus virtual environment was not found: $venvPython"
}
if (-not (Test-Path -LiteralPath $acceptanceTest)) {
    throw "Nexus acceptance test was not found: $acceptanceTest"
}
if ($UseLocalMongo) {
    if ($KeepEnvironment) {
        throw "-KeepEnvironment is only supported for the disposable Compose path; local MongoDB runs always clean up their generated API process and database."
    }
    Assert-NexusLocalMongoUrl -MongoUrl $LocalMongoUrl
}
else {
    if ((Get-Command docker -ErrorAction SilentlyContinue) -and (Test-NexusComposeRuntime -Executable "docker" -Prefix @("compose"))) {
        $script:composeExecutable = "docker"
        $script:composePrefix = @("compose")
    }
    elseif ((Get-Command podman -ErrorAction SilentlyContinue) -and (Test-NexusComposeRuntime -Executable "podman" -Prefix @("compose"))) {
        $script:composeExecutable = "podman"
        $script:composePrefix = @("compose")
    }
    elseif ((Get-Command podman-compose -ErrorAction SilentlyContinue) -and (Test-NexusComposeRuntime -Executable "podman-compose" -ProbeArguments @("--version"))) {
        $script:composeExecutable = "podman-compose"
    }
    else {
        throw "A usable Compose runtime is required. Install Docker Compose v2, Podman Compose, or podman-compose; alternatively use -UseLocalMongo with a loopback MongoDB listener."
    }
    Write-Host "[Nexus acceptance] Using compose runtime: $($script:composeExecutable) $($script:composePrefix -join ' ')"
}

$listener = $null
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}
else {
    $listener = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -eq $Port } |
        Select-Object -First 1
}
if ($listener) {
    $owner = if ($listener.PSObject.Properties.Name -contains "OwningProcess") { " by PID $($listener.OwningProcess)" } else { "" }
    throw "Acceptance port $Port is already in use$owner. Choose a different -Port; this runner will not stop another process."
}

$environmentNames = @(
    "APP_ENV",
    "NEXUS_TEST_ENVIRONMENT",
    "NEXUS_SEED_DEMO_DATA",
    "NEXUS_RUN_BACKGROUND_WORKERS",
    "NEXUS_ACCEPTANCE_PORT",
    "NEXUS_ACCEPTANCE_DB_NAME",
    "NEXUS_ACCEPTANCE_JWT_SECRET",
    "NEXUS_ACCEPTANCE_ENCRYPTION_KEY",
    "NEXUS_ACCEPTANCE_BASE_URL",
    "NEXUS_UPLOADS_DIR",
    "MONGO_URL",
    "DB_NAME",
    "JWT_SECRET",
    "NEXUS_SECRET_ENCRYPTION_KEY",
    "CORS_ORIGINS"
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
    # All runtime inputs are generated in memory. Nothing in this runner reads
    # a local .env, integration credential, or existing Nexus database.
    [Environment]::SetEnvironmentVariable("APP_ENV", "test", "Process")
    [Environment]::SetEnvironmentVariable("NEXUS_TEST_ENVIRONMENT", "1", "Process")
    [Environment]::SetEnvironmentVariable("NEXUS_SEED_DEMO_DATA", "false", "Process")
    [Environment]::SetEnvironmentVariable("NEXUS_RUN_BACKGROUND_WORKERS", "false", "Process")
    [Environment]::SetEnvironmentVariable("NEXUS_ACCEPTANCE_PORT", "$Port", "Process")
    [Environment]::SetEnvironmentVariable("NEXUS_ACCEPTANCE_DB_NAME", $acceptanceDatabase, "Process")
    [Environment]::SetEnvironmentVariable("NEXUS_ACCEPTANCE_JWT_SECRET", (New-NexusAcceptanceSecret), "Process")
    [Environment]::SetEnvironmentVariable("NEXUS_ACCEPTANCE_ENCRYPTION_KEY", (New-NexusAcceptanceSecret), "Process")
    [Environment]::SetEnvironmentVariable("NEXUS_ACCEPTANCE_BASE_URL", $apiUrl, "Process")

    if ($UseLocalMongo) {
        Write-Host "[Nexus acceptance] Checking explicit loopback MongoDB listener..."
        Test-NexusLocalMongo -MongoUrl $LocalMongoUrl
        $localMongoValidated = $true
        [Environment]::SetEnvironmentVariable("MONGO_URL", $LocalMongoUrl, "Process")
        [Environment]::SetEnvironmentVariable("DB_NAME", $acceptanceDatabase, "Process")
        [Environment]::SetEnvironmentVariable("JWT_SECRET", [Environment]::GetEnvironmentVariable("NEXUS_ACCEPTANCE_JWT_SECRET", "Process"), "Process")
        [Environment]::SetEnvironmentVariable("NEXUS_SECRET_ENCRYPTION_KEY", [Environment]::GetEnvironmentVariable("NEXUS_ACCEPTANCE_ENCRYPTION_KEY", "Process"), "Process")
        [Environment]::SetEnvironmentVariable("CORS_ORIGINS", $apiUrl, "Process")

        $localApiLogDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "nexus-acceptance-$([guid]::NewGuid().ToString('N'))"
        New-Item -ItemType Directory -Path $localApiLogDirectory -Force | Out-Null
        $localApiUploadDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "nexus-acceptance-uploads-$([guid]::NewGuid().ToString('N'))"
        New-Item -ItemType Directory -Path $localApiUploadDirectory -Force | Out-Null
        [Environment]::SetEnvironmentVariable("NEXUS_UPLOADS_DIR", $localApiUploadDirectory, "Process")
        $stdoutLog = Join-Path $localApiLogDirectory "api.stdout.log"
        $stderrLog = Join-Path $localApiLogDirectory "api.stderr.log"
        Write-Host "[Nexus acceptance] Starting isolated local API process..."
        $processArguments = @{
            FilePath = $venvPython
            WorkingDirectory = (Join-Path $root "backend")
            ArgumentList = @("-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "$Port")
            RedirectStandardOutput = $stdoutLog
            RedirectStandardError = $stderrLog
            PassThru = $true
        }
        if ($IsWindows) {
            $processArguments.WindowStyle = "Hidden"
        }
        $localApiProcess = Start-Process @processArguments
    }
    else {
        Write-Host "[Nexus acceptance] Building isolated API and MongoDB environment..."
        $composeAttempted = $true
        $composeExitCode = Invoke-NexusAcceptanceCompose up --build --detach
        if ($composeExitCode -ne 0) {
            throw "The selected Compose runtime could not start the disposable acceptance environment."
        }
    }

    try {
        Wait-NexusAcceptanceApi -Url $apiUrl -Process $localApiProcess
    }
    catch {
        if ($UseLocalMongo) {
            Write-NexusAcceptanceApiDiagnostics -LogDirectory $localApiLogDirectory
        }
        throw
    }
    Write-Host "[Nexus acceptance] Running authenticated two-client API acceptance tests..."
    & $venvPython -m pytest $acceptanceTest -q -p no:cacheprovider
    if ($LASTEXITCODE -ne 0) {
        # The database and process are still disposable, but surface the local
        # API trace before cleanup.  Without this, a real acceptance failure is
        # reduced to an opaque client-side HTTP status after its only evidence
        # has been deleted.
        if ($UseLocalMongo) {
            Write-NexusAcceptanceApiDiagnostics -LogDirectory $localApiLogDirectory
        }
        throw "Nexus two-client API acceptance tests failed."
    }

    Write-Host "[Nexus acceptance] Passed."
}
finally {
    if ($UseLocalMongo) {
        Stop-NexusAcceptanceApi -Process $localApiProcess
        if ($localMongoValidated) {
            Write-Host "[Nexus acceptance] Dropping only generated acceptance database $acceptanceDatabase..."
            Remove-NexusAcceptanceDatabase -MongoUrl $LocalMongoUrl -DatabaseName $acceptanceDatabase
        }
        Remove-NexusAcceptanceTempDirectory -Directory $localApiLogDirectory
        Remove-NexusAcceptanceTempDirectory -Directory $localApiUploadDirectory
    }
    elseif ($composeAttempted -and -not $KeepEnvironment) {
        Write-Host "[Nexus acceptance] Removing only disposable project $projectName..."
        $composeExitCode = Invoke-NexusAcceptanceCompose down --volumes --remove-orphans
        if ($composeExitCode -ne 0) {
            Write-Warning "The acceptance Compose project may need manual cleanup: $projectName"
        }
    }
    elseif ($composeAttempted) {
        Write-Warning "Disposable acceptance environment retained as requested: $projectName"
    }

    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
}
