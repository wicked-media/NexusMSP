from fastapi import APIRouter, HTTPException, Depends
from app.database import db
from app.auth import get_current_user
from app.services.scope_permissions import assert_record_scope

router = APIRouter()


# ============== DEVICE DISK HEALTH ==============

@router.get("/devices/{device_id}/disks")
async def get_device_disks(device_id: str, current_user: dict = Depends(get_current_user)):
    """Get disk/drive health information for a device"""
    await assert_record_scope(
        current_user,
        db.devices,
        device_id,
        operation="device.disks.read",
        resource_name="Managed asset",
    )
    disks = await db.device_disks.find({"device_id": device_id}, {"_id": 0}).to_list(50)
    return disks


# ============== AGENT SCRIPT GENERATION ==============

@router.get("/devices/{device_id}/agent-script")
async def generate_agent_script(
    device_id: str,
    os_type: str = "windows",
    current_user: dict = Depends(get_current_user)
):
    """Retired legacy bootstrap endpoint.

    The historical script embedded a shared credential and posted unsigned
    telemetry to a device ID supplied by the caller.  Nexus Agent installers
    now enrol with a device-bound identity and submit authenticated heartbeats.
    """
    raise HTTPException(
        status_code=410,
        detail="Legacy agent scripts are retired. Use the Nexus Agent deployment workspace.",
    )


@router.get("/devices/agent/script-template")
async def get_agent_script_template(
    os_type: str = "windows",
    current_user: dict = Depends(get_current_user)
):
    """Retired legacy bootstrap endpoint; see ``generate_agent_script``."""
    raise HTTPException(
        status_code=410,
        detail="Legacy agent scripts are retired. Use the Nexus Agent deployment workspace.",
    )


@router.post("/devices/agent/report")
async def agent_report(data: dict):
    """Retired unsigned telemetry ingestion endpoint.

    Device telemetry must arrive through the authenticated, device-bound Nexus
    Agent heartbeat route.  This endpoint intentionally performs no parsing or
    database access so legacy payloads cannot alter device evidence.
    """
    raise HTTPException(
        status_code=410,
        detail="Legacy agent reporting is retired. Enrol the Nexus Agent and use its authenticated heartbeat.",
    )


# ============== SCRIPT GENERATORS ==============

def _generate_windows_script(device_id: str, api_url: str, agent_key: str) -> str:
    return f'''# NexusOps Agent - Windows PowerShell
# Device ID: {device_id}
# Auto-reports system info, disk health, and performance metrics to NexusOps
# Install: Save this file and run as Administrator
# Schedule: Use Task Scheduler to run every 5 minutes

$NexusOpsAPI = "{api_url}"
$DeviceID = "{device_id}"
$AgentKey = "{agent_key}"
$AgentVersion = "1.0.0"

function Get-SystemInfo {{
    $os = Get-CimInstance Win32_OperatingSystem
    $cs = Get-CimInstance Win32_ComputerSystem
    $bios = Get-CimInstance Win32_BIOS
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $net = Get-NetAdapter | Where-Object Status -eq "Up" | Select-Object -First 1
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {{ $_.InterfaceAlias -notmatch "Loopback" }} | Select-Object -First 1).IPAddress
    $mac = $net.MacAddress
    $user = (Get-CimInstance Win32_ComputerSystem).UserName
    $uptime = (Get-Date) - $os.LastBootUpTime

    # CPU usage (sample over 1 second)
    $cpuLoad = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average

    # Memory
    $totalRAM = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
    $freeRAM = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
    $memUsage = [math]::Round((1 - ($os.FreePhysicalMemory * 1KB / $cs.TotalPhysicalMemory)) * 100, 1)

    # Firewall
    $fw = (Get-NetFirewallProfile | Where-Object Enabled -eq $true).Count -gt 0

    # BitLocker
    $bl = $false
    try {{ $bl = (Get-BitLockerVolume -MountPoint "C:" -ErrorAction SilentlyContinue).ProtectionStatus -eq "On" }} catch {{}}

    # Antivirus
    $av = Get-CimInstance -Namespace "root/SecurityCenter2" -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | Select-Object -First 1
    $avName = if ($av) {{ $av.displayName }} else {{ "Windows Defender" }}
    $avStatus = if ($av) {{ "active" }} else {{ "active" }}

    # Pending updates
    $patches = 0
    try {{
        $session = New-Object -ComObject Microsoft.Update.Session
        $searcher = $session.CreateUpdateSearcher()
        $result = $searcher.Search("IsInstalled=0")
        $patches = $result.Updates.Count
    }} catch {{}}

    # Installed software count
    $swCount = (Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue).Count

    return @{{
        device_id = $DeviceID
        agent_key = $AgentKey
        agent_version = $AgentVersion
        hostname = $env:COMPUTERNAME
        os_name = $os.Caption
        os_version = $os.Version
        os_build = $os.BuildNumber
        architecture = $os.OSArchitecture
        serial_number = $bios.SerialNumber
        manufacturer = $cs.Manufacturer
        model = $cs.Model
        bios_version = $bios.SMBIOSBIOSVersion
        cpu_name = $cpu.Name
        cpu_cores = $cpu.NumberOfCores
        cpu_usage = $cpuLoad
        total_ram_gb = $totalRAM
        memory_usage = $memUsage
        domain = $cs.Domain
        ip_address = $ip
        mac_address = $mac
        logged_in_user = $user
        uptime_seconds = [int]$uptime.TotalSeconds
        firewall_enabled = $fw
        bitlocker_enabled = $bl
        antivirus_name = $avName
        antivirus_status = $avStatus
        pending_patches = $patches
        installed_software_count = $swCount
    }}
}}

function Get-DiskHealth {{
    $disks = @()
    $volumes = Get-Volume | Where-Object {{ $_.DriveLetter -and $_.DriveType -eq "Fixed" }}

    foreach ($vol in $volumes) {{
        $phys = Get-PhysicalDisk -ErrorAction SilentlyContinue | Select-Object -First 1
        $totalGB = [math]::Round($vol.Size / 1GB, 1)
        $freeGB = [math]::Round($vol.SizeRemaining / 1GB, 1)
        $usedGB = [math]::Round($totalGB - $freeGB, 1)
        $usagePct = if ($totalGB -gt 0) {{ [math]::Round(($usedGB / $totalGB) * 100, 1) }} else {{ 0 }}

        $diskType = "Unknown"
        $smartStatus = "Unknown"
        $model = ""
        $serial = ""
        $firmware = ""
        $interface = ""

        if ($phys) {{
            $diskType = $phys.MediaType
            $smartStatus = if ($phys.HealthStatus -eq "Healthy") {{ "OK" }} elseif ($phys.HealthStatus -eq "Warning") {{ "Warning" }} else {{ "Critical" }}
            $model = $phys.FriendlyName
            $serial = $phys.SerialNumber
            $firmware = $phys.FirmwareRevision
            $interface = $phys.BusType
        }}

        $disks += @{{
            drive_letter = "$($vol.DriveLetter):"
            mount_point = "$($vol.DriveLetter):\\"
            label = $vol.FileSystemLabel
            file_system = $vol.FileSystem
            total_gb = $totalGB
            used_gb = $usedGB
            free_gb = $freeGB
            usage_percent = $usagePct
            disk_type = $diskType
            smart_status = $smartStatus
            model = $model
            serial = $serial
            firmware = $firmware
            interface = $interface
        }}
    }}

    # Overall disk usage for device
    $allTotal = ($disks | Measure-Object -Property total_gb -Sum).Sum
    $allUsed = ($disks | Measure-Object -Property used_gb -Sum).Sum
    $overallUsage = if ($allTotal -gt 0) {{ [math]::Round(($allUsed / $allTotal) * 100, 1) }} else {{ 0 }}

    return @{{ disks = $disks; total_disk_gb = $allTotal; free_disk_gb = ($allTotal - $allUsed); disk_usage = $overallUsage }}
}}

function Send-Report {{
    $sysInfo = Get-SystemInfo
    $diskInfo = Get-DiskHealth

    $report = $sysInfo
    $report["disks"] = $diskInfo.disks
    $report["total_disk_gb"] = $diskInfo.total_disk_gb
    $report["free_disk_gb"] = $diskInfo.free_disk_gb
    $report["disk_usage"] = $diskInfo.disk_usage

    $json = $report | ConvertTo-Json -Depth 5

    try {{
        $response = Invoke-RestMethod -Uri "$NexusOpsAPI/devices/agent/report" -Method POST -Body $json -ContentType "application/json"
        Write-Host "[$(Get-Date)] Report sent OK. Status: $($response.device_status). Next in $($response.next_report_seconds)s"
        return $response.next_report_seconds
    }} catch {{
        Write-Host "[$(Get-Date)] ERROR sending report: $_"
        return 300
    }}
}}

# Main loop
Write-Host "NexusOps Agent v$AgentVersion starting for device $DeviceID"
Write-Host "Reporting to: $NexusOpsAPI"
Write-Host "Press Ctrl+C to stop"

while ($true) {{
    $interval = Send-Report
    Start-Sleep -Seconds $interval
}}
'''


def _generate_linux_script(device_id: str, api_url: str, agent_key: str) -> str:
    return f'''#!/bin/bash
# NexusOps Agent - Linux/macOS
# Device ID: {device_id}
# Auto-reports system info, disk health, and performance metrics to NexusOps
# Install: chmod +x nexusops-agent.sh && sudo ./nexusops-agent.sh
# Schedule: Add to crontab: */5 * * * * /opt/nexusops/nexusops-agent.sh --once

NEXUSOPS_API="{api_url}"
DEVICE_ID="{device_id}"
AGENT_KEY="{agent_key}"
AGENT_VERSION="1.0.0"

send_report() {{
    HOSTNAME=$(hostname)
    OS_NAME=$(uname -s)
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_NAME="$NAME"
        OS_VERSION="$VERSION_ID"
    elif [ "$OS_NAME" = "Darwin" ]; then
        OS_NAME="macOS $(sw_vers -productName 2>/dev/null || echo '')"
        OS_VERSION="$(sw_vers -productVersion 2>/dev/null || echo '')"
    fi
    OS_BUILD=$(uname -r)
    ARCH=$(uname -m)
    SERIAL=$(sudo dmidecode -s system-serial-number 2>/dev/null || echo "N/A")
    MANUFACTURER=$(sudo dmidecode -s system-manufacturer 2>/dev/null || echo "N/A")
    MODEL=$(sudo dmidecode -s system-product-name 2>/dev/null || echo "N/A")
    BIOS_VER=$(sudo dmidecode -s bios-version 2>/dev/null || echo "N/A")
    CPU_NAME=$(grep "model name" /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs || sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "N/A")
    CPU_CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)
    CPU_USAGE=$(top -bn1 2>/dev/null | grep "Cpu(s)" | awk '{{print $2}}' || echo 0)
    TOTAL_RAM_GB=$(free -g 2>/dev/null | awk '/Mem/{{print $2}}' || echo 0)
    MEM_USAGE=$(free 2>/dev/null | awk '/Mem/{{printf "%.1f", $3/$2*100}}' || echo 0)
    IP_ADDR=$(hostname -I 2>/dev/null | awk '{{print $1}}' || ipconfig getifaddr en0 2>/dev/null || echo "N/A")
    MAC_ADDR=$(ip link show 2>/dev/null | grep "link/ether" | head -1 | awk '{{print $2}}' || echo "N/A")
    USER=$(whoami)
    UPTIME_SEC=$(awk '{{print int($1)}}' /proc/uptime 2>/dev/null || echo 0)
    FW_ENABLED=$(sudo ufw status 2>/dev/null | grep -c "active" || echo 0)
    DOMAIN=$(hostname -d 2>/dev/null || echo "")
    PATCHES=$(apt list --upgradable 2>/dev/null | grep -c "upgradable" || echo 0)

    # Disk info as JSON array
    DISKS="["
    FIRST=true
    TOTAL_DISK=0
    FREE_DISK=0
    df -BG --output=target,fstype,size,used,avail,pcent -x tmpfs -x devtmpfs 2>/dev/null | tail -n +2 | while read MOUNT FS SIZE USED AVAIL PCT; do
        SIZE_GB=${{SIZE%G}}
        USED_GB=${{USED%G}}
        FREE_GB=${{AVAIL%G}}
        PCT_NUM=${{PCT%\\%}}
        SMART="Unknown"
        # Try smartctl if available
        DEV=$(df "$MOUNT" 2>/dev/null | tail -1 | awk '{{print $1}}')
        if command -v smartctl &>/dev/null && [ -b "$DEV" ]; then
            SMART_OUT=$(sudo smartctl -H "$DEV" 2>/dev/null)
            if echo "$SMART_OUT" | grep -q "PASSED"; then SMART="OK"
            elif echo "$SMART_OUT" | grep -q "FAILED"; then SMART="Critical"
            fi
        fi
        if [ "$FIRST" = true ]; then FIRST=false; else DISKS="$DISKS,"; fi
        DISKS="$DISKS{{\\\"mount_point\\\":\\\"$MOUNT\\\",\\\"file_system\\\":\\\"$FS\\\",\\\"total_gb\\\":$SIZE_GB,\\\"used_gb\\\":$USED_GB,\\\"free_gb\\\":$FREE_GB,\\\"usage_percent\\\":$PCT_NUM,\\\"smart_status\\\":\\\"$SMART\\\"}}"
    done
    DISKS="$DISKS]"

    TOTAL_DISK_GB=$(df -BG --total -x tmpfs -x devtmpfs 2>/dev/null | tail -1 | awk '{{print int($2)}}')
    FREE_DISK_GB=$(df -BG --total -x tmpfs -x devtmpfs 2>/dev/null | tail -1 | awk '{{print int($4)}}')
    DISK_USAGE=$(df --total -x tmpfs -x devtmpfs 2>/dev/null | tail -1 | awk '{{print int($5)}}')

    JSON=$(cat <<EOF
{{
  "device_id": "$DEVICE_ID",
  "agent_key": "$AGENT_KEY",
  "agent_version": "$AGENT_VERSION",
  "hostname": "$HOSTNAME",
  "os_name": "$OS_NAME",
  "os_version": "$OS_VERSION",
  "os_build": "$OS_BUILD",
  "architecture": "$ARCH",
  "serial_number": "$SERIAL",
  "manufacturer": "$MANUFACTURER",
  "model": "$MODEL",
  "bios_version": "$BIOS_VER",
  "cpu_name": "$CPU_NAME",
  "cpu_cores": $CPU_CORES,
  "cpu_usage": $CPU_USAGE,
  "total_ram_gb": $TOTAL_RAM_GB,
  "memory_usage": $MEM_USAGE,
  "domain": "$DOMAIN",
  "ip_address": "$IP_ADDR",
  "mac_address": "$MAC_ADDR",
  "logged_in_user": "$USER",
  "uptime_seconds": $UPTIME_SEC,
  "firewall_enabled": $([ "$FW_ENABLED" -gt 0 ] && echo "true" || echo "false"),
  "pending_patches": $PATCHES,
  "total_disk_gb": $TOTAL_DISK_GB,
  "free_disk_gb": $FREE_DISK_GB,
  "disk_usage": $DISK_USAGE,
  "disks": $DISKS
}}
EOF
)

    RESPONSE=$(curl -s -X POST "$NEXUSOPS_API/devices/agent/report" \\
        -H "Content-Type: application/json" \\
        -d "$JSON" 2>&1)

    echo "[$(date)] Report sent. Response: $RESPONSE"
}}

echo "NexusOps Agent v$AGENT_VERSION starting for device $DEVICE_ID"
echo "Reporting to: $NEXUSOPS_API"

if [ "$1" = "--once" ]; then
    send_report
    exit 0
fi

echo "Running in continuous mode. Press Ctrl+C to stop."
while true; do
    send_report
    sleep 300
done
'''
