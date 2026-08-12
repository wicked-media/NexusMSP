[CmdletBinding()]
param(
  [ValidateSet("Start", "Stop", "Restart", "Status")]
  [string]$Action = "Status",
  [int]$FrontendPort = 3000,
  [int]$BackendPort = 8000
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontendPath = Join-Path $root "frontend"
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$backendLog = Join-Path $root "backend_live.stdout.log"
$backendErrorLog = Join-Path $root "backend_live.stderr.log"
$frontendLog = Join-Path $root "frontend_live.stdout.log"
$frontendErrorLog = Join-Path $root "frontend_live.stderr.log"
$bundledNodeBins = @(
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"),
  (Join-Path $env:LOCALAPPDATA "codex-runtimes\codex-primary-runtime\dependencies\node\bin")
)

function Get-ListenerPid([int]$Port) {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($listener) { return [int]$listener.OwningProcess }
  return $null
}

function Stop-NexusPort([int]$Port, [string]$Name) {
  $listenerPid = Get-ListenerPid $Port
  if (-not $listenerPid) {
    Write-Host "[Nexus] $Name is not listening on port $Port."
    return
  }
  $process = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
  $processName = if ($process) { $process.ProcessName } else { "PID $listenerPid" }
  Write-Host "[Nexus] Stopping $Name ($processName, PID $listenerPid) on port $Port..."
  Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
  foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 300
    $remainingPid = Get-ListenerPid $Port
    if (-not $remainingPid) { return }
    if ($remainingPid -ne $listenerPid) { Stop-Process -Id $remainingPid -Force -ErrorAction SilentlyContinue }
  }
  if (Get-ListenerPid $Port) { throw "Nexus could not release port $Port for $Name." }
}

function Wait-NexusUrl([string]$Url, [string]$Name) {
  foreach ($attempt in 1..40) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Host "[Nexus] $Name is ready at $Url"
        return $true
      }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  Write-Warning "[Nexus] $Name did not become ready. Check $root for its live log files."
  return $false
}

function Start-NexusLocal {
  if (Get-ListenerPid $BackendPort) { Write-Host "[Nexus] API is already listening on port $BackendPort." }
  else {
    $python = if (Test-Path $venvPython) { $venvPython } else { (Get-Command python -ErrorAction Stop).Source }
    Write-Host "[Nexus] Starting API..."
    Start-Process -FilePath $python -ArgumentList @("-m", "uvicorn", "server:app", "--app-dir", "backend", "--reload", "--port", "$BackendPort") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $backendLog -RedirectStandardError $backendErrorLog
  }

  if (Get-ListenerPid $FrontendPort) { Write-Host "[Nexus] Frontend is already listening on port $FrontendPort." }
  else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $bundledNode = $bundledNodeBins | ForEach-Object { Join-Path $_ "node.exe" } | Where-Object { Test-Path $_ } | Select-Object -First 1
    $node = if ($nodeCommand) { $nodeCommand.Source } elseif ($bundledNode) { $bundledNode } else { throw "Node.js was not found. Install Node.js or reopen Codex so its bundled runtime is available." }
    $craco = Join-Path $frontendPath "node_modules\@craco\craco\dist\bin\craco.js"
    if (-not (Test-Path $craco)) { throw "Frontend dependencies are missing. Run 'pnpm install --frozen-lockfile' in frontend first." }
    $previousBrowser = $env:BROWSER
    $previousPath = $env:PATH
    $env:BROWSER = "none"
    # CRACO starts npm-style child commands. Keep the selected Node runtime on PATH
    # as well as using it as the process executable so those child commands resolve.
    $env:PATH = "$(Split-Path -Parent $node);$env:PATH"
    try {
      Write-Host "[Nexus] Starting frontend..."
      Start-Process -FilePath $node -ArgumentList @($craco, "start") -WorkingDirectory $frontendPath -WindowStyle Hidden -RedirectStandardOutput $frontendLog -RedirectStandardError $frontendErrorLog
    } finally {
      $env:BROWSER = $previousBrowser
      $env:PATH = $previousPath
    }
  }

  $apiReady = Wait-NexusUrl "http://localhost:$BackendPort/docs" "API"
  $webReady = Wait-NexusUrl "http://localhost:$FrontendPort" "Frontend"
  if ($apiReady -and $webReady) { Start-Process "http://localhost:$FrontendPort" }
}

switch ($Action) {
  "Status" {
    $apiPid = Get-ListenerPid $BackendPort
    $webPid = Get-ListenerPid $FrontendPort
    Write-Host "Nexus local status"
    Write-Host "  API:      $(if ($apiPid) { "online (PID $apiPid) · http://localhost:$BackendPort/docs" } else { "offline" })"
    Write-Host "  Frontend: $(if ($webPid) { "online (PID $webPid) · http://localhost:$FrontendPort" } else { "offline" })"
  }
  "Stop" {
    Stop-NexusPort $FrontendPort "Frontend"
    Stop-NexusPort $BackendPort "API"
  }
  "Restart" {
    Stop-NexusPort $FrontendPort "Frontend"
    Stop-NexusPort $BackendPort "API"
    Start-NexusLocal
  }
  "Start" { Start-NexusLocal }
}
