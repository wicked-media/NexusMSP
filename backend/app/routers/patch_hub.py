from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

# ─── Patch Hub: Unified Patch Management Center ───

@router.get("/patch-hub/dashboard")
async def patch_hub_dashboard(current_user: dict = Depends(get_current_user)):
    """Unified patch management dashboard - OS + 3rd party combined"""
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "os": 1, "patch_status": 1, "pending_patches": 1, "type": 1}).to_list(500)
    apps = await db.third_party_apps.find({}, {"_id": 0}).to_list(1000)
    history = await db.patch_history.find({}, {"_id": 0}).sort("timestamp", -1).to_list(100)
    if not history:
        history = await _seed_patch_history(devices)

    total_devices = len(devices)
    os_compliant = sum(1 for d in devices if d.get("patch_status") == "current")
    os_needs = sum(1 for d in devices if d.get("patch_status") == "needs_attention")
    os_critical = sum(1 for d in devices if d.get("patch_status") == "critical")
    total_pending = sum(d.get("pending_patches", 0) for d in devices)

    app_total = len(apps)
    app_current = sum(1 for a in apps if a.get("status") == "current")
    app_outdated = app_total - app_current

    recent_failures = [h for h in history if h.get("status") == "failed"][:10]

    # Ring status
    rings = await _get_rings_with_status()

    # Upcoming patches
    upcoming = await db.patch_queue.find({"status": "pending"}, {"_id": 0}).sort("scheduled_for", 1).to_list(20)
    if not upcoming:
        upcoming = await _seed_patch_queue(devices)

    return {
        "os_summary": {"total_devices": total_devices, "compliant": os_compliant, "needs_attention": os_needs, "critical": os_critical, "compliance_pct": round(os_compliant / total_devices * 100, 1) if total_devices else 0, "total_pending_patches": total_pending},
        "app_summary": {"total_apps": app_total, "current": app_current, "outdated": app_outdated, "compliance_pct": round(app_current / app_total * 100, 1) if app_total else 0},
        "rings": rings,
        "recent_history": history[:20],
        "recent_failures": recent_failures,
        "upcoming_queue": upcoming[:15],
        "stats_7d": await _get_7day_stats(),
    }


@router.get("/patch-hub/intelligence")
async def patch_intelligence(current_user: dict = Depends(get_current_user)):
    """Patch Intelligence - CVSS risk scoring, stability analysis"""
    patches = await db.patch_intelligence.find({}, {"_id": 0}).to_list(200)
    if not patches:
        patches = await _seed_patch_intelligence()
    high_risk = [p for p in patches if p.get("cvss_score", 0) >= 8.0]
    flagged = [p for p in patches if p.get("stability") == "unstable"]
    return {
        "patches": patches,
        "summary": {
            "total_patches": len(patches),
            "critical_cvss": len([p for p in patches if p.get("cvss_score", 0) >= 9.0]),
            "high_cvss": len([p for p in patches if 7.0 <= p.get("cvss_score", 0) < 9.0]),
            "medium_cvss": len([p for p in patches if 4.0 <= p.get("cvss_score", 0) < 7.0]),
            "low_cvss": len([p for p in patches if p.get("cvss_score", 0) < 4.0]),
            "flagged_unstable": len(flagged),
            "auto_paused": len([p for p in patches if p.get("auto_paused")]),
        },
        "high_risk_patches": high_risk,
        "flagged_patches": flagged,
    }


@router.get("/patch-hub/rings")
async def get_deployment_rings(current_user: dict = Depends(get_current_user)):
    """Get deployment rings with device assignments and progress"""
    rings = await db.deployment_rings.find({}, {"_id": 0}).to_list(20)
    if not rings:
        rings = await _seed_deployment_rings()
    return rings


@router.put("/patch-hub/rings/{ring_id}")
async def update_ring(ring_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await db.deployment_rings.update_one({"id": ring_id}, {"$set": data})
    return {"status": "updated"}


@router.post("/patch-hub/rings/{ring_id}/promote")
async def promote_ring(ring_id: str, current_user: dict = Depends(get_current_user)):
    """Promote patches from this ring to the next"""
    ring = await db.deployment_rings.find_one({"id": ring_id}, {"_id": 0})
    if not ring:
        return {"error": "Ring not found"}
    return {"status": "promoted", "ring": ring.get("name"), "patches_promoted": random.randint(5, 20), "next_ring": f"Ring {ring.get('order', 0) + 1}"}


@router.get("/patch-hub/exclusions")
async def get_exclusions(current_user: dict = Depends(get_current_user)):
    """Get patch exclusion lists"""
    exclusions = await db.patch_exclusions.find({}, {"_id": 0}).to_list(100)
    if not exclusions:
        exclusions = await _seed_exclusions()
    return exclusions


@router.post("/patch-hub/exclusions")
async def add_exclusion(data: dict, current_user: dict = Depends(get_current_user)):
    exc = {
        "id": f"exc-{uuid.uuid4().hex[:8]}",
        "kb_id": data.get("kb_id", ""),
        "app_name": data.get("app_name", ""),
        "reason": data.get("reason", ""),
        "scope": data.get("scope", "global"),
        "client_name": data.get("client_name", ""),
        "created_by": current_user.get("name"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": data.get("expires_at"),
        "active": True,
    }
    await db.patch_exclusions.insert_one(exc)
    exc.pop("_id", None)
    return exc


@router.delete("/patch-hub/exclusions/{exc_id}")
async def remove_exclusion(exc_id: str, current_user: dict = Depends(get_current_user)):
    await db.patch_exclusions.update_one({"id": exc_id}, {"$set": {"active": False}})
    return {"status": "removed"}


@router.get("/patch-hub/reboot-schedule")
async def get_reboot_schedule(current_user: dict = Depends(get_current_user)):
    """Reboot scheduling and deferral management"""
    schedules = await db.reboot_schedules.find({}, {"_id": 0}).to_list(100)
    if not schedules:
        schedules = await _seed_reboot_schedules()
    return schedules


@router.post("/patch-hub/reboot-schedule")
async def create_reboot_schedule(data: dict, current_user: dict = Depends(get_current_user)):
    sched = {
        "id": f"rbs-{uuid.uuid4().hex[:8]}",
        **data,
        "created_by": current_user.get("name"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "scheduled",
    }
    await db.reboot_schedules.insert_one(sched)
    sched.pop("_id", None)
    return sched


@router.get("/patch-hub/rollbacks")
async def get_rollbacks(current_user: dict = Depends(get_current_user)):
    """Patch rollback history and available rollbacks"""
    rollbacks = await db.patch_rollbacks.find({}, {"_id": 0}).sort("timestamp", -1).to_list(50)
    if not rollbacks:
        rollbacks = await _seed_rollbacks()
    available = await db.patch_history.find({"status": "success", "rollback_available": True}, {"_id": 0}).sort("timestamp", -1).to_list(30)
    return {"rollback_history": rollbacks, "available_rollbacks": available}


@router.post("/patch-hub/rollback")
async def initiate_rollback(data: dict, current_user: dict = Depends(get_current_user)):
    rb = {
        "id": f"rb-{uuid.uuid4().hex[:8]}",
        "patch_id": data.get("patch_id"),
        "device_ids": data.get("device_ids", []),
        "reason": data.get("reason", ""),
        "initiated_by": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "status": "in_progress",
    }
    await db.patch_rollbacks.insert_one(rb)
    rb.pop("_id", None)
    return rb


@router.get("/patch-hub/testing")
async def get_test_results(current_user: dict = Depends(get_current_user)):
    """Patch testing lab results"""
    results = await db.patch_test_results.find({}, {"_id": 0}).sort("tested_at", -1).to_list(50)
    if not results:
        results = await _seed_test_results()
    return {"results": results, "summary": {
        "total_tested": len(results),
        "passed": len([r for r in results if r.get("result") == "pass"]),
        "failed": len([r for r in results if r.get("result") == "fail"]),
        "warnings": len([r for r in results if r.get("result") == "warning"]),
    }}


@router.get("/patch-hub/history")
async def get_full_history(client: str = None, device: str = None, status: str = None, current_user: dict = Depends(get_current_user)):
    """Full patch history with filters"""
    query = {}
    if client:
        query["client_name"] = client
    if device:
        query["device_name"] = {"$regex": device, "$options": "i"}
    if status:
        query["status"] = status
    history = await db.patch_history.find(query, {"_id": 0}).sort("timestamp", -1).to_list(200)
    return history


@router.get("/patch-hub/scripts")
async def get_patch_scripts(current_user: dict = Depends(get_current_user)):
    """Pre/post deployment scripts"""
    scripts = await db.patch_scripts.find({}, {"_id": 0}).to_list(50)
    if not scripts:
        scripts = await _seed_patch_scripts()
    return scripts


@router.get("/patch-hub/failed-remediations")
async def get_failed_remediations(current_user: dict = Depends(get_current_user)):
    """Failed patch remediation suggestions"""
    failures = await db.patch_history.find({"status": "failed"}, {"_id": 0}).sort("timestamp", -1).to_list(50)
    remediations = []
    for f in failures[:20]:
        remediations.append({
            **f,
            "remediation": _get_remediation_suggestion(f.get("error_code", ""), f.get("kb_id", "")),
        })
    return remediations


@router.get("/patch-hub/compliance-by-client")
async def compliance_by_client(current_user: dict = Depends(get_current_user)):
    """Patch compliance breakdown per client"""
    devices = await db.devices.find({}, {"_id": 0, "client_name": 1, "patch_status": 1, "pending_patches": 1}).to_list(500)
    clients = {}
    for d in devices:
        cn = d.get("client_name", "Unknown")
        if cn not in clients:
            clients[cn] = {"client_name": cn, "total": 0, "compliant": 0, "needs_attention": 0, "critical": 0, "pending_patches": 0}
        clients[cn]["total"] += 1
        ps = d.get("patch_status", "unknown")
        if ps == "current":
            clients[cn]["compliant"] += 1
        elif ps == "needs_attention":
            clients[cn]["needs_attention"] += 1
        elif ps == "critical":
            clients[cn]["critical"] += 1
        clients[cn]["pending_patches"] += d.get("pending_patches", 0)
    result = []
    for c in clients.values():
        c["compliance_pct"] = round(c["compliant"] / c["total"] * 100, 1) if c["total"] else 0
        result.append(c)
    return sorted(result, key=lambda x: x["compliance_pct"])



# ─── Agent Management: Download & Device Reporting ───

@router.get("/patch-hub/agent/download-script")
async def get_agent_script(current_user: dict = Depends(get_current_user)):
    """Generate the NexusOps Patch Agent PowerShell script for deployment"""
    # Get the base URL from request context - for now use a placeholder the admin sets
    settings = await db.settings.find_one({"type": "patch_agent"}, {"_id": 0})
    api_url = settings.get("api_url", "https://your-nexusops-url.com/api") if settings else "https://your-nexusops-url.com/api"
    api_key = settings.get("agent_api_key", f"nxagent-{uuid.uuid4().hex[:16]}") if settings else f"nxagent-{uuid.uuid4().hex[:16]}"

    script = f'''#Requires -RunAsAdministrator
# ═══════════════════════════════════════════════════════════════
# NexusOps Patch Agent v1.0 - Automated Patch Monitoring
# Deploy alongside RustDesk for unified remote management
# ═══════════════════════════════════════════════════════════════

$NexusOpsAPI = "{api_url}"
$AgentKey = "{api_key}"
$ReportInterval = 3600  # Report every hour (seconds)
$ServiceName = "NexusOpsPatchAgent"
$LogPath = "$env:ProgramData\\NexusOps\\patch-agent.log"

function Write-AgentLog {{
    param([string]$Message, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "[$ts] [$Level] $Message"
    Add-Content -Path $LogPath -Value $entry -ErrorAction SilentlyContinue
    if ($Level -eq "ERROR") {{ Write-Error $Message }} else {{ Write-Host $entry }}
}}

function Get-PendingWindowsUpdates {{
    try {{
        $session = New-Object -ComObject Microsoft.Update.Session
        $searcher = $session.CreateUpdateSearcher()
        $result = $searcher.Search("IsInstalled=0 AND IsHidden=0")
        $updates = @()
        foreach ($update in $result.Updates) {{
            $severity = "optional"
            if ($update.MsrcSeverity) {{ $severity = $update.MsrcSeverity.ToLower() }}
            $kbNumbers = @()
            foreach ($kb in $update.KBArticleIDs) {{ $kbNumbers += "KB$kb" }}
            $updates += @{{
                title = $update.Title
                kb_ids = $kbNumbers
                severity = $severity
                size_mb = [math]::Round($update.MaxDownloadSize / 1MB, 1)
                categories = @($update.Categories | ForEach-Object {{ $_.Name }})
                is_downloaded = $update.IsDownloaded
                reboot_required = $update.RebootRequired
                published = $update.LastDeploymentChangeTime.ToString("yyyy-MM-dd")
                cve_ids = @($update.CveIDs)
            }}
        }}
        return $updates
    }} catch {{
        Write-AgentLog "Failed to query Windows Update: $_" "ERROR"
        return @()
    }}
}}

function Get-InstalledSoftware {{
    try {{
        $apps = @()
        $regPaths = @(
            "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
            "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"
        )
        foreach ($path in $regPaths) {{
            Get-ItemProperty $path -ErrorAction SilentlyContinue | Where-Object {{ $_.DisplayName }} | ForEach-Object {{
                $apps += @{{
                    name = $_.DisplayName
                    version = $_.DisplayVersion
                    publisher = $_.Publisher
                    install_date = $_.InstallDate
                }}
            }}
        }}
        return $apps | Sort-Object {{ $_.name }} -Unique
    }} catch {{
        Write-AgentLog "Failed to enumerate software: $_" "ERROR"
        return @()
    }}
}}

function Get-SystemInfo {{
    try {{
        $os = Get-CimInstance Win32_OperatingSystem
        $cs = Get-CimInstance Win32_ComputerSystem
        $bios = Get-CimInstance Win32_BIOS
        $lastBoot = $os.LastBootUpTime
        $uptime = (Get-Date) - $lastBoot
        $pendingReboot = (Test-Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired") -or
                         (Test-Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending")
        return @{{
            hostname = $env:COMPUTERNAME
            domain = $cs.Domain
            os_name = $os.Caption
            os_version = $os.Version
            os_build = $os.BuildNumber
            architecture = $os.OSArchitecture
            manufacturer = $cs.Manufacturer
            model = $cs.Model
            serial_number = $bios.SerialNumber
            total_ram_gb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
            last_boot = $lastBoot.ToString("yyyy-MM-ddTHH:mm:ss")
            uptime_hours = [math]::Round($uptime.TotalHours, 1)
            pending_reboot = $pendingReboot
            last_patch_scan = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
        }}
    }} catch {{
        Write-AgentLog "Failed to collect system info: $_" "ERROR"
        return @{{ hostname = $env:COMPUTERNAME; error = $_.ToString() }}
    }}
}}

function Get-WindowsDefenderStatus {{
    try {{
        $defender = Get-MpComputerStatus -ErrorAction SilentlyContinue
        if ($defender) {{
            return @{{
                antivirus_enabled = $defender.AntivirusEnabled
                realtime_protection = $defender.RealTimeProtectionEnabled
                definition_age_days = $defender.AntivirusSignatureAge
                last_scan = $defender.LastFullScanEndTime.ToString("yyyy-MM-dd")
                definition_version = $defender.AntivirusSignatureVersion
            }}
        }}
        return @{{ antivirus_enabled = $false; error = "Defender not available" }}
    }} catch {{
        return @{{ antivirus_enabled = $false; error = $_.ToString() }}
    }}
}}

function Send-PatchReport {{
    $report = @{{
        agent_version = "1.0.0"
        reported_at = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
        system_info = Get-SystemInfo
        pending_updates = Get-PendingWindowsUpdates
        installed_software = Get-InstalledSoftware
        defender_status = Get-WindowsDefenderStatus
    }}
    $json = $report | ConvertTo-Json -Depth 5 -Compress
    try {{
        $headers = @{{
            "Content-Type" = "application/json"
            "X-Agent-Key" = $AgentKey
        }}
        $response = Invoke-RestMethod -Uri "$NexusOpsAPI/patch-hub/agent/report" -Method POST -Body $json -Headers $headers -TimeoutSec 30
        Write-AgentLog "Report sent successfully. Server response: $($response.status)"
    }} catch {{
        Write-AgentLog "Failed to send report: $_" "ERROR"
    }}
}}

# ── Main Loop / One-Shot Mode ──
function Start-PatchAgent {{
    New-Item -ItemType Directory -Path (Split-Path $LogPath) -Force -ErrorAction SilentlyContinue | Out-Null
    Write-AgentLog "NexusOps Patch Agent starting..."
    Write-AgentLog "API: $NexusOpsAPI"
    Write-AgentLog "Hostname: $env:COMPUTERNAME"

    if ($args -contains "-once") {{
        Write-AgentLog "Running single report..."
        Send-PatchReport
        return
    }}

    Write-AgentLog "Starting monitoring loop (interval: ${{ReportInterval}}s)"
    while ($true) {{
        Send-PatchReport
        Start-Sleep -Seconds $ReportInterval
    }}
}}

# ── Install as Windows Service (optional) ──
function Install-AsService {{
    $scriptPath = $MyInvocation.ScriptName
    $nssm = "$env:ProgramData\\NexusOps\\nssm.exe"
    if (-not (Test-Path $nssm)) {{
        Write-Host "Download NSSM from https://nssm.cc and place at $nssm to install as service"
        return
    }}
    & $nssm install $ServiceName powershell.exe "-ExecutionPolicy Bypass -File `"$scriptPath`""
    & $nssm set $ServiceName DisplayName "NexusOps Patch Agent"
    & $nssm set $ServiceName Description "Monitors Windows Update status and reports to NexusOps RMM"
    & $nssm set $ServiceName Start SERVICE_AUTO_START
    & $nssm start $ServiceName
    Write-Host "Service installed and started!"
}}

# Run
Start-PatchAgent
'''
    return {
        "script": script,
        "filename": "NexusOps-PatchAgent.ps1",
        "version": "1.0.0",
        "instructions": [
            "1. Download the script to the client machine",
            "2. Open PowerShell as Administrator",
            "3. Run: Set-ExecutionPolicy RemoteSigned -Scope LocalMachine",
            "4. Run: .\\NexusOps-PatchAgent.ps1",
            "5. For one-shot mode: .\\NexusOps-PatchAgent.ps1 -once",
            "6. To install as a Windows service, call Install-AsService from the script"
        ],
        "deploy_command": 'powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri \'YOUR_NEXUSOPS_URL/api/patch-hub/agent/download-script\' -OutFile NexusOps-PatchAgent.ps1; .\\NexusOps-PatchAgent.ps1"'
    }


@router.post("/patch-hub/agent/report")
async def receive_agent_report(data: dict):
    """Receive patch status report from deployed agent"""
    system_info = data.get("system_info", {})
    hostname = system_info.get("hostname", "UNKNOWN")

    report = {
        "id": f"rpt-{uuid.uuid4().hex[:8]}",
        "hostname": hostname,
        "agent_version": data.get("agent_version", "unknown"),
        "reported_at": data.get("reported_at", datetime.now(timezone.utc).isoformat()),
        "system_info": system_info,
        "pending_updates_count": len(data.get("pending_updates", [])),
        "pending_updates": data.get("pending_updates", [])[:50],
        "installed_software_count": len(data.get("installed_software", [])),
        "defender_status": data.get("defender_status", {}),
        "critical_updates": len([u for u in data.get("pending_updates", []) if u.get("severity") in ("critical", "important")]),
    }

    # Upsert - update existing device report or insert new
    await db.agent_reports.update_one(
        {"hostname": hostname},
        {"$set": report, "$setOnInsert": {"first_seen": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )

    # Also update the device in the main devices collection if it exists
    await db.devices.update_one(
        {"name": {"$regex": f"^{hostname}$", "$options": "i"}},
        {"$set": {
            "pending_patches": report["pending_updates_count"],
            "patch_status": "current" if report["pending_updates_count"] == 0 else "critical" if report["critical_updates"] > 0 else "needs_attention",
            "last_patch_scan": report["reported_at"],
            "agent_version": report["agent_version"],
        }},
    )

    return {"status": "received", "hostname": hostname, "pending_count": report["pending_updates_count"]}


@router.get("/patch-hub/agent/reports")
async def get_agent_reports(current_user: dict = Depends(get_current_user)):
    """Get all agent reports from deployed devices"""
    reports = await db.agent_reports.find({}, {"_id": 0}).sort("reported_at", -1).to_list(200)
    return {
        "total_reporting": len(reports),
        "healthy": len([r for r in reports if r.get("pending_updates_count", 0) == 0]),
        "needs_attention": len([r for r in reports if 0 < r.get("pending_updates_count", 0) <= 5]),
        "critical": len([r for r in reports if r.get("pending_updates_count", 0) > 5]),
        "reports": reports,
    }


@router.post("/patch-hub/agent/settings")
async def save_agent_settings(data: dict, current_user: dict = Depends(get_current_user)):
    """Save agent configuration (API URL, key, etc.)"""
    settings = {
        "type": "patch_agent",
        "api_url": data.get("api_url", ""),
        "agent_api_key": data.get("agent_api_key", f"nxagent-{uuid.uuid4().hex[:16]}"),
        "report_interval": data.get("report_interval", 3600),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": current_user.get("name"),
    }
    await db.settings.update_one({"type": "patch_agent"}, {"$set": settings}, upsert=True)
    return {"status": "saved", "settings": settings}



# ─── Seed Helpers ───

def _get_remediation_suggestion(error_code, kb_id):
    suggestions = {
        "0x80070002": "File not found. Run SFC /scannow and DISM /Online /Cleanup-Image /RestoreHealth",
        "0x800f0922": "Insufficient disk space or VPN connected. Free 500MB+ and disconnect VPN",
        "0x80073712": "Component store corruption. Run DISM /Online /Cleanup-Image /RestoreHealth",
        "0x800f081f": "Source files missing. Mount Windows ISO and run DISM with /Source",
        "0x80240034": "Wrong OS edition. Verify KB matches the installed Windows edition",
        "0x8024402c": "WSUS connection failed. Check WSUS URL, proxy, and firewall rules",
    }
    return suggestions.get(error_code, f"Check Windows Update logs at C:\\Windows\\Logs\\CBS\\CBS.log. Reset Windows Update components if needed. KB: {kb_id}")


async def _get_rings_with_status():
    rings = await db.deployment_rings.find({}, {"_id": 0}).to_list(10)
    if not rings:
        rings = await _seed_deployment_rings()
    for r in rings:
        r["pending_patches"] = random.randint(0, 15)
        r["last_deployment"] = (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 72))).isoformat()
    return rings


async def _get_7day_stats():
    now = datetime.now(timezone.utc)
    stats = []
    for i in range(7):
        d = now - timedelta(days=6 - i)
        stats.append({
            "date": d.strftime("%Y-%m-%d"),
            "installed": random.randint(20, 80),
            "failed": random.randint(0, 8),
            "rolled_back": random.randint(0, 3),
            "pending": random.randint(5, 25),
        })
    return stats


async def _seed_patch_history(devices):
    kbs = ["KB5034441", "KB5034467", "KB5035845", "KB5036893", "KB5037765", "KB5038169", "KB5039212", "KB5040427", "KB5041585", "KB5042099",
           "KB5043076", "KB5044284", "KB5044380", "KB5045583", "KB5046617", "KB5047987", "KB5048667", "KB5049981", "KB5050234", "KB5051987"]
    titles = ["Cumulative Update for Windows 11 23H2", "Security Update for Windows Server 2022", ".NET 8.0.11 Security Update",
              "Servicing Stack Update", "Windows Defender Definition Update", "Microsoft Edge Security Update",
              "Exchange Server 2019 CU15", "SQL Server Security Patch", "Office 365 Security Update", "Windows Malicious Software Removal Tool"]
    history = []
    for _ in range(80):
        d = random.choice(devices) if devices else {"name": "UNKNOWN", "client_name": "Unknown", "id": "?"}
        status = random.choices(["success", "failed", "rolled_back", "pending_reboot"], weights=[70, 12, 3, 15])[0]
        ts = datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 720))
        h = {
            "id": f"ph-{uuid.uuid4().hex[:8]}",
            "device_name": d.get("name"),
            "device_id": d.get("id"),
            "client_name": d.get("client_name"),
            "kb_id": random.choice(kbs),
            "title": random.choice(titles),
            "severity": random.choice(["critical", "important", "moderate", "low"]),
            "status": status,
            "error_code": random.choice(["0x80070002", "0x800f0922", "0x80073712", "0x800f081f", "0x80240034", "0x8024402c"]) if status == "failed" else None,
            "timestamp": ts.isoformat(),
            "duration_seconds": random.randint(30, 600),
            "rollback_available": status == "success" and random.random() > 0.3,
            "ring": random.choice(["Test Ring", "Early Adopters", "Broad Deployment", "Critical Systems"]),
            "reboot_required": random.choice([True, False]),
        }
        history.append(h)
        await db.patch_history.insert_one(h)
    return [{k: v for k, v in h.items() if k != "_id"} for h in history]


async def _seed_patch_intelligence():
    patches = []
    intel_data = [
        ("KB5051987", "Cumulative Update Win11 24H2", 9.8, "stable", False, "Remote Code Execution in TCP/IP stack", "CVE-2025-21311"),
        ("KB5050234", "Security Update Win Server 2025", 9.1, "stable", False, "Elevation of Privilege in Active Directory", "CVE-2025-21298"),
        ("KB5049981", ".NET 9.0.2 Security Update", 8.4, "stable", False, "Denial of Service in HTTP/3", "CVE-2025-21176"),
        ("KB5048667", "Exchange Server CU15", 8.8, "unstable", True, "Authentication bypass in OWA - PAUSED by AI", "CVE-2025-21399"),
        ("KB5047987", "SQL Server 2022 CU19", 7.5, "warning", False, "Information disclosure in query optimizer", "CVE-2025-20702"),
        ("KB5046617", "Windows Defender Update", 6.2, "stable", False, "False positive detection rate improvement", "N/A"),
        ("KB5045583", "Office 365 March Update", 7.8, "unstable", True, "Outlook crashes on startup - PAUSED", "CVE-2025-21322"),
        ("KB5044380", "Cumulative Update Win10 22H2", 8.1, "stable", False, "Kernel privilege escalation", "CVE-2025-21287"),
        ("KB5043076", "Servicing Stack Update", 5.3, "stable", False, "Component store maintenance", "N/A"),
        ("KB5042099", "Windows LAPS Update", 7.2, "stable", False, "Password rotation timing fix", "CVE-2025-21155"),
        ("KB5041585", "Edge 131 Security Update", 6.8, "warning", False, "V8 JavaScript engine vulnerability", "CVE-2025-0291"),
        ("KB5040427", "Print Spooler Update", 8.9, "stable", False, "Remote code execution via printer driver", "CVE-2025-21402"),
        ("KB5039212", "Hyper-V Security Update", 9.4, "stable", False, "VM escape vulnerability - CRITICAL", "CVE-2025-21334"),
        ("KB5038169", "BitLocker Recovery Fix", 4.3, "stable", False, "Recovery key prompt after firmware update", "N/A"),
        ("KB5036893", "macOS Ventura 13.7.4", 7.6, "stable", False, "WebKit arbitrary code execution", "CVE-2025-24201"),
    ]
    for kb, title, cvss, stability, paused, desc, cve in intel_data:
        p = {
            "id": f"pi-{uuid.uuid4().hex[:8]}",
            "kb_id": kb, "title": title, "cvss_score": cvss, "stability": stability,
            "auto_paused": paused, "description": desc, "cve": cve,
            "affected_devices": random.randint(5, 90),
            "vendor_severity": "critical" if cvss >= 9 else "important" if cvss >= 7 else "moderate" if cvss >= 4 else "low",
            "release_date": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 60))).strftime("%Y-%m-%d"),
            "community_reports": random.randint(0, 150),
            "known_issues": random.randint(0, 5) if stability != "stable" else 0,
            "recommended_action": "block" if paused else "deploy" if cvss >= 7 else "schedule",
        }
        patches.append(p)
        await db.patch_intelligence.insert_one(p)
    return [{k: v for k, v in p.items() if k != "_id"} for p in patches]


async def _seed_deployment_rings():
    rings = [
        {"id": "ring-0", "name": "Test Lab", "order": 0, "description": "Isolated test VMs. Patches deploy immediately for validation.", "delay_hours": 0, "auto_promote": True, "promote_after_hours": 24, "device_count": 4, "devices_assigned": ["LAB-VM-01", "LAB-VM-02", "LAB-VM-03", "LAB-VM-04"], "color": "#3b82f6", "status": "active", "success_threshold_pct": 100, "pre_script": "snapshot_vm.ps1", "post_script": "validate_patch.ps1"},
        {"id": "ring-1", "name": "Early Adopters", "order": 1, "description": "IT staff and volunteer workstations. 24h delay after Ring 0 succeeds.", "delay_hours": 24, "auto_promote": True, "promote_after_hours": 72, "device_count": 15, "devices_assigned": [], "color": "#22c55e", "status": "active", "success_threshold_pct": 95, "pre_script": None, "post_script": "check_apps.ps1"},
        {"id": "ring-2", "name": "Broad Deployment", "order": 2, "description": "All standard workstations and laptops. 72h delay after Ring 1.", "delay_hours": 72, "auto_promote": True, "promote_after_hours": 168, "device_count": 78, "devices_assigned": [], "color": "#eab308", "status": "active", "success_threshold_pct": 98, "pre_script": None, "post_script": None},
        {"id": "ring-3", "name": "Critical Infrastructure", "order": 3, "description": "Servers, DCs, and critical systems. Manual approval required.", "delay_hours": 168, "auto_promote": False, "promote_after_hours": None, "device_count": 22, "devices_assigned": [], "color": "#ef4444", "status": "active", "success_threshold_pct": 100, "pre_script": "pre_server_patch.ps1", "post_script": "post_server_validate.ps1"},
        {"id": "ring-4", "name": "Legacy / Exceptions", "order": 4, "description": "End-of-life systems, line-of-business servers. Patches individually approved.", "delay_hours": 336, "auto_promote": False, "promote_after_hours": None, "device_count": 12, "devices_assigned": [], "color": "#6b7280", "status": "active", "success_threshold_pct": 100, "pre_script": "backup_before_patch.ps1", "post_script": "verify_lob_apps.ps1"},
    ]
    for r in rings:
        await db.deployment_rings.insert_one(r)
    return [{k: v for k, v in r.items() if k != "_id"} for r in rings]


async def _seed_exclusions():
    exclusions = [
        {"id": "exc-001", "kb_id": "KB5048667", "app_name": "", "reason": "Exchange CU15 causes OWA authentication loop - vendor investigating", "scope": "global", "client_name": "", "created_by": "Alex Thompson", "created_at": (datetime.now(timezone.utc) - timedelta(days=5)).isoformat(), "expires_at": (datetime.now(timezone.utc) + timedelta(days=25)).isoformat(), "active": True},
        {"id": "exc-002", "kb_id": "KB5045583", "app_name": "", "reason": "Office update crashes Outlook with custom add-ins", "scope": "client", "client_name": "Global Finance Ltd", "created_by": "Alex Thompson", "created_at": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(), "expires_at": None, "active": True},
        {"id": "exc-003", "kb_id": "", "app_name": "Java Runtime (JRE)", "reason": "LOB app requires JRE 8u421 specifically - do not update", "scope": "client", "client_name": "Pacific Schools District", "created_by": "Sarah Chen", "created_at": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat(), "expires_at": None, "active": True},
        {"id": "exc-004", "kb_id": "KB5040427", "app_name": "", "reason": "Print spooler update breaks Lexmark drivers - waiting for driver update", "scope": "global", "client_name": "", "created_by": "Mike Rodriguez", "created_at": (datetime.now(timezone.utc) - timedelta(days=12)).isoformat(), "expires_at": (datetime.now(timezone.utc) + timedelta(days=18)).isoformat(), "active": True},
    ]
    for e in exclusions:
        await db.patch_exclusions.insert_one(e)
    return [{k: v for k, v in e.items() if k != "_id"} for e in exclusions]


async def _seed_reboot_schedules():
    clients = ["TechStart Inc", "Global Finance Ltd", "HealthCare Plus", "NovaTech Research", "Pacific Schools District"]
    schedules = []
    for c in clients:
        schedules.append({
            "id": f"rbs-{uuid.uuid4().hex[:8]}",
            "client_name": c,
            "schedule_type": random.choice(["maintenance_window", "after_patch", "forced"]),
            "day_of_week": random.choice(["Sunday", "Saturday", "Wednesday"]),
            "time_utc": f"{random.choice(['02', '03', '04'])}:00",
            "timezone": random.choice(["America/New_York", "America/Chicago", "America/Los_Angeles", "America/Denver"]),
            "max_deferral_hours": random.choice([2, 4, 8, 24]),
            "deferral_count_max": random.choice([3, 5, 10]),
            "force_reboot_after_hours": random.choice([24, 48, 72]),
            "exclude_servers": random.choice([True, False]),
            "notify_user_minutes_before": random.choice([15, 30, 60]),
            "status": "active",
            "created_by": "Alex Thompson",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "devices_pending_reboot": random.randint(0, 12),
        })
    for s in schedules:
        await db.reboot_schedules.insert_one(s)
    return [{k: v for k, v in s.items() if k != "_id"} for s in schedules]


async def _seed_rollbacks():
    rollbacks = [
        {"id": "rb-001", "kb_id": "KB5045583", "title": "Office 365 March Update", "device_count": 23, "reason": "Outlook crashes on startup with custom add-ins", "initiated_by": "Alex Thompson", "timestamp": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(), "status": "completed", "success_count": 22, "failed_count": 1},
        {"id": "rb-002", "kb_id": "KB5048667", "title": "Exchange Server CU15", "device_count": 3, "reason": "OWA authentication bypass vulnerability introduced", "initiated_by": "Sarah Chen", "timestamp": (datetime.now(timezone.utc) - timedelta(days=5)).isoformat(), "status": "completed", "success_count": 3, "failed_count": 0},
    ]
    for r in rollbacks:
        await db.patch_rollbacks.insert_one(r)
    return [{k: v for k, v in r.items() if k != "_id"} for r in rollbacks]


async def _seed_test_results():
    results = []
    kbs = ["KB5051987", "KB5050234", "KB5049981", "KB5048667", "KB5047987", "KB5046617", "KB5045583"]
    for kb in kbs:
        r = {
            "id": f"pt-{uuid.uuid4().hex[:8]}",
            "kb_id": kb,
            "tested_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(2, 168))).isoformat(),
            "test_vm": random.choice(["LAB-VM-01", "LAB-VM-02", "LAB-VM-03"]),
            "os_version": random.choice(["Windows 11 23H2", "Windows Server 2022", "Windows 10 22H2"]),
            "result": random.choices(["pass", "fail", "warning"], weights=[70, 15, 15])[0],
            "install_time_seconds": random.randint(60, 900),
            "reboot_required": random.choice([True, False]),
            "post_install_check": random.choice(["all_services_running", "minor_warnings", "app_crash_detected"]),
            "notes": "",
            "tested_by": "Automated",
        }
        if r["result"] == "fail":
            r["notes"] = random.choice(["BSOD during install", "Application compatibility issue detected", "Install rolled back automatically", "Insufficient disk space on test VM"])
        elif r["result"] == "warning":
            r["notes"] = random.choice(["Slight performance degradation observed", "One non-critical service failed to restart", "Print spooler needed manual restart"])
        results.append(r)
        await db.patch_test_results.insert_one(r)
    return [{k: v for k, v in r.items() if k != "_id"} for r in results]


async def _seed_patch_scripts():
    scripts = [
        {"id": "ps-001", "name": "Pre-Patch VM Snapshot", "type": "pre", "language": "powershell", "content": "# Create checkpoint before patching\nCheckpoint-VM -Name $env:VM_NAME -SnapshotName \"Pre-Patch-$(Get-Date -Format 'yyyyMMdd')\"", "enabled": True, "scope": "ring-0"},
        {"id": "ps-002", "name": "Post-Patch Service Validation", "type": "post", "language": "powershell", "content": "# Verify critical services after patching\n$services = @('W32Time','Spooler','MSSQLSERVER','W3SVC')\nforeach($svc in $services){\n  $s = Get-Service $svc -EA SilentlyContinue\n  if($s -and $s.Status -ne 'Running'){\n    Write-Warning \"$svc is $($s.Status)\"\n    Start-Service $svc\n  }\n}", "enabled": True, "scope": "all"},
        {"id": "ps-003", "name": "Pre-Patch Backup Check", "type": "pre", "language": "powershell", "content": "# Ensure recent backup exists before server patching\n$lastBackup = Get-WBSummary | Select -Expand LastSuccessfulBackupTime\nif((Get-Date) - $lastBackup -gt [TimeSpan]::FromHours(24)){\n  throw 'No backup in last 24h - aborting patch'\n}", "enabled": True, "scope": "ring-3"},
        {"id": "ps-004", "name": "Post-Patch LOB App Test", "type": "post", "language": "powershell", "content": "# Test line-of-business application connectivity\nTest-NetConnection -ComputerName 'lob-server' -Port 443 -InformationLevel Quiet\nInvoke-WebRequest -Uri 'https://lob-app.internal/health' -UseBasicParsing | Select StatusCode", "enabled": True, "scope": "ring-4"},
    ]
    for s in scripts:
        await db.patch_scripts.insert_one(s)
    return [{k: v for k, v in s.items() if k != "_id"} for s in scripts]


async def _seed_patch_queue(devices):
    queue = []
    kbs = ["KB5051987", "KB5050234", "KB5049981", "KB5047987", "KB5046617"]
    for kb in kbs:
        for ring in ["Test Lab", "Early Adopters", "Broad Deployment"]:
            q = {
                "id": f"pq-{uuid.uuid4().hex[:8]}",
                "kb_id": kb,
                "ring": ring,
                "scheduled_for": (datetime.now(timezone.utc) + timedelta(hours=random.randint(1, 168))).isoformat(),
                "device_count": random.randint(2, 30),
                "status": "pending",
                "severity": random.choice(["critical", "important", "moderate"]),
            }
            queue.append(q)
            await db.patch_queue.insert_one(q)
    return [{k: v for k, v in q.items() if k != "_id"} for q in queue]
