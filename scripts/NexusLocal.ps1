[CmdletBinding()]
param(
  [ValidateSet("Start", "Stop", "Restart", "Status")]
  [string]$Action = "Status",
  [int]$FrontendPort = 3000,
  [int]$BackendPort = 8000,
  [string]$BackendHost = "127.0.0.1"
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

function Test-NexusMongo {
  # The local launcher deliberately refuses to start a superficially healthy
  # UI/API pair when the required MongoDB service is unavailable.  The API
  # health endpoint does not prove that application data can be read, so a
  # listener check prevents the familiar endless loading screens after reboot.
  return [bool](Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -in @("127.0.0.1", "::1", "0.0.0.0", "::") } |
    Select-Object -First 1)
}

function Get-NexusBackendPids {
  # A server bound to 0.0.0.0 also owns the configured loopback address.
  $listeners = Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -in @($BackendHost, "0.0.0.0") }
  return @($listeners | ForEach-Object { [int]$_.OwningProcess } | Select-Object -Unique)
}

function Get-NexusProcessDescendants([int]$ProcessId) {
  $children = @(
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty ProcessId
  )
  $all = @($children)
  foreach ($childId in $children) {
    $all += Get-NexusProcessDescendants -ProcessId ([int]$childId)
  }
  return @($all | Select-Object -Unique)
}

function Get-NexusUvicornAncestors([int]$ProcessId) {
  $ancestors = @()
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  while ($current -and $current.ParentProcessId -gt 0) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ParentProcessId)" -ErrorAction SilentlyContinue
    if (-not $parent) { break }
    if ($parent.Name -eq "python.exe" -and $parent.CommandLine -match "uvicorn\\s+server:app") {
      $ancestors += [int]$parent.ProcessId
    }
    $current = $parent
  }
  return @($ancestors | Select-Object -Unique)
}

function Stop-NexusBackend {
  $backendPids = @(Get-NexusBackendPids)
  if (-not $backendPids) {
    Write-Host "[Nexus] API is not listening on $BackendHost`:$BackendPort."
    return
  }

  $ancestorPids = @()
  $childPids = @()
  foreach ($backendPid in $backendPids) {
    $ancestorPids += Get-NexusUvicornAncestors -ProcessId $backendPid
    $childPids += Get-NexusProcessDescendants -ProcessId $backendPid
  }
  $stopOrder = @($ancestorPids + $backendPids + $childPids | Select-Object -Unique)

  foreach ($backendPid in $stopOrder) {
    $process = Get-Process -Id $backendPid -ErrorAction SilentlyContinue
    $processName = if ($process) { $process.ProcessName } else { "PID $backendPid" }
    Write-Host "[Nexus] Stopping API process ($processName, PID $backendPid)..."
    Stop-Process -Id $backendPid -Force -ErrorAction SilentlyContinue
  }

  foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 300
    if (-not (Get-NexusBackendPids)) { return }
  }
  throw "Nexus could not release its API listener on $BackendHost`:$BackendPort."
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
  if (-not (Test-NexusMongo)) {
    Write-Warning "[Nexus] MongoDB is not listening on port 27017. Start the MongoDB service, then run Nexus Local again."
    return
  }

  if (Get-NexusBackendPids) { Write-Host "[Nexus] API is already listening at http://$BackendHost`:$BackendPort." }
  else {
    $python = if (Test-Path $venvPython) { $venvPython } else { (Get-Command python -ErrorAction Stop).Source }
    Write-Host "[Nexus] Starting API..."
    Start-Process -FilePath $python -ArgumentList @("-m", "uvicorn", "server:app", "--app-dir", "backend", "--host", $BackendHost, "--reload", "--port", "$BackendPort") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $backendLog -RedirectStandardError $backendErrorLog
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
    $previousBackendUrl = $env:REACT_APP_BACKEND_URL
    $env:BROWSER = "none"
    $env:REACT_APP_BACKEND_URL = "http://$BackendHost`:$BackendPort"
    # CRACO starts npm-style child commands. Keep the selected Node runtime on PATH
    # as well as using it as the process executable so those child commands resolve.
    $env:PATH = "$(Split-Path -Parent $node);$env:PATH"
    try {
      Write-Host "[Nexus] Starting frontend..."
      Start-Process -FilePath $node -ArgumentList @($craco, "start") -WorkingDirectory $frontendPath -WindowStyle Hidden -RedirectStandardOutput $frontendLog -RedirectStandardError $frontendErrorLog
    } finally {
      $env:BROWSER = $previousBrowser
      $env:PATH = $previousPath
      $env:REACT_APP_BACKEND_URL = $previousBackendUrl
    }
  }

  $apiReady = Wait-NexusUrl "http://$BackendHost`:$BackendPort/api/health" "API"
  $webReady = Wait-NexusUrl "http://localhost:$FrontendPort" "Frontend"
  if ($apiReady -and $webReady) { Start-Process "http://localhost:$FrontendPort" }
}

switch ($Action) {
  "Status" {
    $apiPids = @(Get-NexusBackendPids)
    $webPid = Get-ListenerPid $FrontendPort
    $mongoOnline = Test-NexusMongo
    $apiStatus = if ($apiPids) {
      if ($mongoOnline) { "online (PID $($apiPids -join ', ')) - http://$BackendHost`:$BackendPort/docs" }
      else { "degraded (PID $($apiPids -join ', ')) - MongoDB is offline" }
    } else { "offline" }
    Write-Host "Nexus local status"
    Write-Host "  MongoDB:  $(if ($mongoOnline) { "online (port 27017)" } else { "offline - start MongoDB before Nexus" })"
    Write-Host "  API:      $apiStatus"
    Write-Host "  Frontend: $(if ($webPid) { "online (PID $webPid) - http://localhost:$FrontendPort" } else { "offline" })"
  }
  "Stop" {
    Stop-NexusPort $FrontendPort "Frontend"
    Stop-NexusBackend
  }
  "Restart" {
    Stop-NexusPort $FrontendPort "Frontend"
    Stop-NexusBackend
    Start-NexusLocal
  }
  "Start" { Start-NexusLocal }
}
