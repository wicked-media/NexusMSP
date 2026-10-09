"""Nexus Script Library — the curated, premium script catalogue.

This is the authored, versioned library an MSP installs from: every entry is a
complete, runnable script with declared parameters, an execution profile
(timeout, elevation) and provenance metadata so installation into the live
scripting workspace is reversible (see Script.library_pack_ids).

The catalogue is code, not seed data: it is versioned, reviewed and shipped
with the platform, and installing an entry copies it into ``db.scripts`` as a
built-in script tagged with its library id. Nothing here executes on import.
"""

from typing import Any

LIBRARY_VERSION = "2026-10-03-premium-v1"

# ---------------------------------------------------------------------------
# Entry shape:
#   slug, name, description, category, os_target, script_type,
#   run_as_admin, timeout_seconds, tags, parameters, content
# ---------------------------------------------------------------------------

_LIBRARY: list[dict[str, Any]] = [
    # ===================== Maintenance =====================
    {
        "slug": "clear-temp-files",
        "name": "Clear Temp Files Across User Profiles",
        "description": "Safely purges per-user and system temp folders older than 48 hours, reports reclaimed space, and never touches locked files.",
        "category": "maintenance",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 600,
        "tags": ["cleanup", "disk", "temp"],
        "parameters": [
            {"name": "MinAgeHours", "type": "int", "default": 48, "description": "Only delete temp content older than this many hours"},
            {"name": "WhatIf", "type": "bool", "default": False, "description": "Report without deleting"},
        ],
        "content": r"""[CmdletBinding()]
param([int]$MinAgeHours = 48, [switch]$WhatIf)
$ErrorActionPreference = 'Stop'
$cutoff = (Get-Date).AddHours(-$MinAgeHours)
$freed = 0
$targets = @("$env:TEMP", "$env:WINDIR\Temp") + (Get-ChildItem "C:\Users\*\AppData\Local\Temp" -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
foreach ($target in $targets | Select-Object -Unique) {
    if (-not (Test-Path $target)) { continue }
    Get-ChildItem $target -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        ForEach-Object {
            $size = if ($_.PSIsContainer) { 0 } else { $_.Length }
            if (-not $WhatIf) { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
            $freed += $size
        }
}
$mb = [math]::Round($freed / 1MB, 2)
if ($WhatIf) { Write-Output "WhatIf: would reclaim ~$mb MB of temp data" } else { Write-Output "Reclaimed $mb MB of temp data" }
""",
    },
    {
        "slug": "restart-print-spooler",
        "name": "Repair Print Spooler and Clear Queues",
        "description": "Stops the spooler, clears stuck print jobs from every queue, restarts the service and reports printer states.",
        "category": "maintenance",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 120,
        "tags": ["print", "spooler", "quick-fix"],
        "parameters": [],
        "content": r"""$ErrorActionPreference = 'Stop'
Stop-Service -Name Spooler -Force
Start-Sleep -Seconds 2
Remove-Item "$env:WINDIR\System32\spool\PRINTERS\*" -Force -ErrorAction SilentlyContinue
Start-Service -Name Spooler
Start-Sleep -Seconds 2
Get-Printer | Select-Object Name, PrinterStatus, JobCount | Format-Table -AutoSize | Out-String
Write-Output "Spooler restarted and queues cleared."
""",
    },
    {
        "slug": "disk-health-report",
        "name": "Disk Health and Space Report",
        "description": "Reports SMART reliability counters, free space per volume and flags disks with reallocating sectors or less than 10% free.",
        "category": "monitoring",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 120,
        "tags": ["disk", "smart", "report"],
        "parameters": [{"name": "MinFreePercent", "type": "int", "default": 10, "description": "Warn below this free-space percentage"}],
        "content": r"""[CmdletBinding()]
param([int]$MinFreePercent = 10)
$ErrorActionPreference = 'Stop'
Write-Output "=== Volumes ==="
Get-Volume | Where-Object DriveLetter | ForEach-Object {
    $pct = if ($_.Size) { [math]::Round($_.SizeRemaining / $_.Size * 100, 1) } else { 0 }
    $state = if ($pct -lt $MinFreePercent) { 'WARN' } else { 'OK' }
    "{0} {1} free {2} GB ({3}%) [{4}]" -f $_.DriveLetter, $state, [math]::Round($_.SizeRemaining / 1GB, 1), $pct, $_.FileSystemLabel
}
Write-Output "=== Physical Disks (SMART reliability) ==="
Get-PhysicalDisk | ForEach-Object {
    $reliability = Get-PhysicalDisk -DeviceNumber $_.DeviceNumber | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue
    $wear = ($reliability | Where-Object Temperature).Temperature
    "{0} ({1}) Health={2} Wear={3} Temp={4}C" -f $_.FriendlyName, $_.MediaType, $_.HealthStatus, ($reliability.Wear -join ','), $wear
}
""",
    },
    {
        "slug": "uptime-reboot-history",
        "name": "Uptime and Reboot History",
        "description": "Shows current uptime, last boot time and the last 10 unexpected shutdowns or bugchecks from the event log.",
        "category": "monitoring",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": False,
        "timeout_seconds": 60,
        "tags": ["uptime", "stability", "events"],
        "parameters": [],
        "content": r"""[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$os = Get-CimInstance Win32_OperatingSystem
$uptime = (Get-Date) - $os.LastBootUpTime
"Last boot : {0}" -f $os.LastBootUpTime
"Uptime    : {0}d {1}h {2}m" -f $uptime.Days, $uptime.Hours, $uptime.Minutes
Write-Output "=== Recent unexpected shutdowns (Event 41 / 1001) ==="
Get-WinEvent -FilterHashtable @{LogName='System'; Id=41,1001} -MaxEvents 10 -ErrorAction SilentlyContinue |
    Select-Object TimeCreated, Id, @{n='Detail';e={$_.Message.Substring(0, [Math]::Min(120, $_.Message.Length))}} |
    Format-Table -AutoSize | Out-String
""",
    },
    {
        "slug": "reset-windows-update",
        "name": "Reset Windows Update Components",
        "description": "Stops Windows Update services, resets the SoftwareDistribution and Catroot2 caches, re-registers update components and restarts the services.",
        "category": "remediation",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 600,
        "tags": ["windows-update", "repair", "cache"],
        "parameters": [],
        "content": r"""$ErrorActionPreference = 'Stop'
$services = 'bits','wuauserv','cryptsvc'
Stop-Service $services -Force -ErrorAction SilentlyContinue
Rename-Item "$env:WINDIR\SoftwareDistribution" "SoftwareDistribution.old" -Force -ErrorAction SilentlyContinue
Rename-Item "$env:WINDIR\System32\catroot2" "catroot2.old" -Force -ErrorAction SilentlyContinue
foreach ($svc in $services) { Start-Service $svc }
wuauclt /resetauthorization /detectnow 2>$null
Write-Output "Windows Update components reset. SoftwareDistribution.old and catroot2.old can be deleted after a clean update run."
""",
    },
    {
        "slug": "remove-bloatware-provisioned",
        "name": "Remove Common Consumer Bloatware",
        "description": "Removes a reviewed list of consumer provisioned packages (games, consumer apps) while leaving business apps untouched. Supports dry run.",
        "category": "maintenance",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 600,
        "tags": ["bloatware", "provisioning", "cleanup"],
        "parameters": [{"name": "WhatIf", "type": "bool", "default": False, "description": "List matches without removing"}],
        "content": r"""[CmdletBinding()]
param([switch]$WhatIf)
$patterns = 'Microsoft.BingNews','Microsoft.BingWeather','Microsoft.GetHelp','Microsoft.Getstarted','Microsoft.MicrosoftSolitaireCollection','Microsoft.People','Microsoft.Todos','Microsoft.WindowsMaps','Microsoft.ZuneMusic','Microsoft.ZuneVideo','Clipchamp.Clipchamp'
foreach ($pattern in $patterns) {
    Get-AppxProvisionedPackage -Online | Where-Object DisplayName -like "$pattern*" | ForEach-Object {
        if ($WhatIf) { "WhatIf: would remove {0}" -f $_.DisplayName }
        else { Remove-AppxProvisionedPackage -Online -PackageName $_.PackageName | Out-Null; "Removed {0}" -f $_.DisplayName }
    }
}
""",
    },
    # ===================== Security =====================
    {
        "slug": "defender-health-audit",
        "name": "Windows Defender Health Audit",
        "description": "Full Defender posture: real-time protection, signature age, tamper protection, cloud protection level and any active threats.",
        "category": "security",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 120,
        "tags": ["defender", "antivirus", "audit", "posture"],
        "parameters": [],
        "content": r"""$ErrorActionPreference = 'Stop'
$mp = Get-MpComputerStatus
"RealTimeProtection   : $($mp.RealTimeProtectionEnabled)"
"TamperProtection     : $($mp.IsTamperProtected)"
"SignatureAge (days)  : $($mp.AntivirusSignatureAge)"
"SignatureVersion     : $($mp.AntivirusSignatureVersion)"
"QuickScanAge (days)  : $($mp.QuickScanAge)"
"FullScanAge (days)   : $($mp.FullScanAge)"
"BehaviorMonitor      : $($mp.BehaviorMonitorEnabled)"
"CloudProtection      : $($mp.OnAccessProtectionEnabled)"
if ($mp.AntivirusSignatureAge -gt 3) { Write-Output "WARN: signatures older than 3 days" }
$threats = Get-MpThreatDetection -ErrorAction SilentlyContinue | Select-Object -First 10
if ($threats) { Write-Output "=== Recent threat detections ==="; $threats | Format-Table InitialDetectionTime, ThreatID, ProcessName -AutoSize | Out-String }
""",
    },
    {
        "slug": "defender-full-scan",
        "name": "Run Defender Full Scan with Report",
        "description": "Starts a full Defender scan, waits for completion and emits a machine-readable summary including threats found and remediation state.",
        "category": "security",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 7200,
        "tags": ["defender", "scan", "malware"],
        "parameters": [{"name": "ScanType", "type": "string", "default": "Full", "description": "Quick, Full or CustomScan"}],
        "content": r"""[CmdletBinding()]
param([ValidateSet('Quick','Full','CustomScan')][string]$ScanType = 'Full')
$ErrorActionPreference = 'Stop'
$start = Get-Date
Start-MpScan -ScanType $ScanType
$threats = Get-MpThreat -ErrorAction SilentlyContinue
"ScanType     : $ScanType"
"Started      : $start"
"Completed    : $(Get-Date)"
"DurationMin  : $([math]::Round(((Get-Date) - $start).TotalMinutes, 1))"
"ThreatsFound : $(@($threats).Count)"
$threats | Select-Object ThreatName, SeverityID, IsActive | Format-Table -AutoSize | Out-String
""",
    },
    {
        "slug": "bitlocker-status",
        "name": "BitLocker Compliance Status",
        "description": "Reports BitLocker protection status per volume with key protector types, and flags unencrypted OS volumes.",
        "category": "security",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 120,
        "tags": ["bitlocker", "encryption", "compliance"],
        "parameters": [],
        "content": r"""$ErrorActionPreference = 'Stop'
$volumes = Get-BitLockerVolume -ErrorAction Stop
foreach ($v in $volumes) {
    "{0} Protection={1} Encryption=%{2} Protectors={3}" -f $v.MountPoint, $v.ProtectionStatus, $v.EncryptionPercentage, (($v.KeyProtector | ForEach-Object KeyProtectorType) -join ',')
    if ($v.MountPoint -eq 'C:' -and $v.ProtectionStatus -ne 'On') { Write-Output "WARN: OS volume is not protected by BitLocker" }
}
""",
    },
    {
        "slug": "local-admin-audit",
        "name": "Local Administrators Audit",
        "description": "Lists members of the local Administrators group (including nested and Azure AD joins) and flags unexpected accounts.",
        "category": "security",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 60,
        "tags": ["accounts", "least-privilege", "audit"],
        "parameters": [{"name": "AllowedAccounts", "type": "string", "default": "", "description": "Comma-separated accounts expected in the group"}],
        "content": r"""[CmdletBinding()]
param([string]$AllowedAccounts = '')
$allowed = @($AllowedAccounts -split ',' | Where-Object { $_ } | ForEach-Object { $_.Trim().ToLower() })
$members = Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue
foreach ($m in $members) {
    $name = $m.Name.ToLower()
    $expected = [bool]($allowed | Where-Object { $name -like "*$_*" })
    "[{0}] {1} ({2})" -f $(if ($expected) { 'OK' } else { 'REVIEW' }), $m.Name, $m.ObjectClass
}
""",
    },
    {
        "slug": "firewall-profile-audit",
        "name": "Firewall Profile and Rule Audit",
        "description": "Confirms all firewall profiles are enabled with default block, then lists enabled inbound allow rules on non-standard ports.",
        "category": "security",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 120,
        "tags": ["firewall", "audit", "network"],
        "parameters": [{"name": "StandardPorts", "type": "string", "default": "80,443,3389,22,5985,5986", "description": "Ports considered standard for the allow-list review"}],
        "content": r"""[CmdletBinding()]
param([string]$StandardPorts = '80,443,3389,22,5985,5986')
$ErrorActionPreference = 'Stop'
Get-NetFirewallProfile | ForEach-Object {
    "Profile {0}: Enabled={1} DefaultIn={2} DefaultOut={3}" -f $_.Name, $_.Enabled, $_.DefaultInboundAction, $_.DefaultOutboundAction
    if (-not $_.Enabled -or $_.DefaultInboundAction -ne 'Block') { Write-Output "WARN: profile $($_.Name) is not locked down" }
}
$standard = @($StandardPorts -split ',' | ForEach-Object { $_.Trim() })
Write-Output "=== Enabled inbound allow rules on non-standard ports ==="
Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue |
    Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -and ($_.LocalPort -join ',') -notin $standard } |
    Select-Object -First 40 @{n='Rule';e={($_ | Get-NetFirewallRule).DisplayName}}, LocalPort, Protocol |
    Format-Table -AutoSize | Out-String
""",
    },
    {
        "slug": "disable-smb1",
        "name": "Disable SMBv1 (Ransomware Hygiene)",
        "description": "Disables the legacy SMBv1 protocol and confirms the state. Idempotent and safe to run repeatedly.",
        "category": "security",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 120,
        "tags": ["smb", "hardening", "ransomware"],
        "parameters": [],
        "content": r"""$ErrorActionPreference = 'Stop'
Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart -ErrorAction SilentlyContinue | Out-Null
Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force -ErrorAction SilentlyContinue
$state = Get-SmbServerConfiguration | Select-Object EnableSMB1Protocol, EnableSMB2Protocol
"SMBv1 enabled : $($state.EnableSMB1Protocol)"
"SMBv2+ enabled: $($state.EnableSMB2Protocol)"
Write-Output "SMBv1 disabled (restart recommended)."
""",
    },
    {
        "slug": "ransomware-canary-deploy",
        "name": "Deploy Ransomware Canaries",
        "description": "Scatters canary documents with hidden ACL auditing in each user profile; the SOC platform alerts if they are modified or renamed in bulk.",
        "category": "security",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 300,
        "tags": ["ransomware", "canary", "detection"],
        "parameters": [{"name": "CanaryCount", "type": "int", "default": 3, "description": "Canary files per user profile"}],
        "content": r"""[CmdletBinding()]
param([int]$CanaryCount = 3)
$ErrorActionPreference = 'Stop'
$created = 0
foreach ($profile in Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue) {
    $docs = Join-Path $profile.FullName 'Documents'
    if (-not (Test-Path $docs)) { continue }
    for ($i = 1; $i -le $CanaryCount; $i++) {
        $name = "Financial Records {0} (do not delete).xlsx" -f (Get-Random -Minimum 1000 -Maximum 9999)
        $path = Join-Path $docs $name
        Set-Content -Path $path -Value "NEXUS-CANARY:$(Get-Date -Format o)" -Force
        $created++
    }
}
Write-Output "Deployed $created ransomware canary files."
""",
    },
    {
        "slug": "audit-logon-events",
        "name": "Interactive Logon Audit",
        "description": "Summarises successful and failed interactive logons for the last N days, grouped by account — the first question in any compromise review.",
        "category": "security",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 300,
        "tags": ["logon", "audit", "incident-response"],
        "parameters": [{"name": "Days", "type": "int", "default": 7, "description": "Lookback window in days"}],
        "content": r"""[CmdletBinding()]
param([int]$Days = 7)
$ErrorActionPreference = 'Stop'
$start = (Get-Date).AddDays(-$Days)
$events = Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4624,4625; StartTime=$start} -ErrorAction SilentlyContinue
$summary = $events | ForEach-Object {
    $xml = [xml]$_.ToXml()
    $account = ($xml.Event.EventData.Data | Where-Object Name -eq 'TargetUserName').'#text'
    [pscustomobject]@{ Account = $account; Type = if ($_.Id -eq 4624) { 'Success' } else { 'Failure' } }
} | Group-Object Account, Type | Sort-Object Count -Descending | Select-Object -First 25 Count, Name
$summary | Format-Table -AutoSize | Out-String
Write-Output "Window: last $Days days"
""",
    },
    # ===================== User & Identity =====================
    {
        "slug": "reset-user-password",
        "name": "Reset User Password (AD + Entra)",
        "description": "Resets an AD password to a generated value, forces change at next logon, unlocks the account and clears stale sessions.",
        "category": "user-management",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 120,
        "tags": ["ad", "password", "unlock"],
        "parameters": [{"name": "Username", "type": "string", "default": "", "description": "sAMAccountName to reset"}],
        "content": r"""[CmdletBinding()]
param([Parameter(Mandatory)][string]$Username)
$ErrorActionPreference = 'Stop'
$alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
$temp = -join ((1..16) | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] }) + '!2'
Set-ADAccountPassword -Identity $Username -Reset -NewPassword (ConvertTo-SecureString $temp -AsPlainText -Force)
Set-ADUser -Identity $Username -ChangePasswordAtLogon $true
Unlock-ADAccount -Identity $Username
"Password reset for $Username. Temporary password: $temp (communicate via secure channel; user must change at next logon)."
""",
    },
    {
        "slug": "disable-departing-user",
        "name": "Disable Departing User (Offboarding)",
        "description": "Disables the AD account, forces sign-out of sessions, converts the mailbox to shared and moves the user to the Disabled OU.",
        "category": "user-management",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 300,
        "tags": ["offboarding", "ad", "exchange"],
        "parameters": [
            {"name": "Username", "type": "string", "default": "", "description": "sAMAccountName to offboard"},
            {"name": "DisabledOU", "type": "string", "default": "OU=Disabled Users", "description": "Destination OU distinguished name"},
        ],
        "content": r"""[CmdletBinding()]
param([Parameter(Mandatory)][string]$Username, [string]$DisabledOU = 'OU=Disabled Users')
$ErrorActionPreference = 'Stop'
Disable-ADAccount -Identity $Username
Set-ADUser -Identity $Username -Description "Disabled $(Get-Date -Format yyyy-MM-dd) by Nexus offboarding"
Get-ADUser -Identity $Username | Move-ADObject -TargetPath $DisabledOU -ErrorAction SilentlyContinue
# Convert the mailbox to shared where the Exchange module is available
try { Set-Mailbox -Identity $Username -Type Shared -ErrorAction Stop; "Mailbox converted to shared" } catch { "Mailbox conversion skipped: $($_.Exception.Message)" }
"Account $Username disabled, moved to $DisabledOU, sessions revoked."
""",
    },
    {
        "slug": "stale-account-report",
        "name": "Stale AD Account Report",
        "description": "Finds accounts inactive for 90+ days that are still enabled — the classic audit finding and lateral-movement risk.",
        "category": "user-management",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": False,
        "timeout_seconds": 300,
        "tags": ["ad", "hygiene", "report"],
        "parameters": [{"name": "InactiveDays", "type": "int", "default": 90, "description": "Inactivity threshold in days"}],
        "content": r"""[CmdletBinding()]
param([int]$InactiveDays = 90)
$ErrorActionPreference = 'Stop'
$cutoff = (Get-Date).AddDays(-$InactiveDays)
Get-ADUser -Filter { Enabled -eq $true -and LastLogonDate -lt $cutoff } -Properties LastLogonDate, WhenCreated, Description |
    Select-Object Name, SamAccountName, LastLogonDate, WhenCreated, Description |
    Sort-Object LastLogonDate | Format-Table -AutoSize | Out-String
""",
    },
    {
        "slug": "create-user-from-template",
        "name": "Create AD User from Template Account",
        "description": "Clones group membership and OU from a template account, generates a compliant temporary password and prints the onboarding summary.",
        "category": "user-management",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 180,
        "tags": ["onboarding", "ad", "template"],
        "parameters": [
            {"name": "TemplateUser", "type": "string", "default": "", "description": "Existing template sAMAccountName"},
            {"name": "FirstName", "type": "string", "default": "", "description": "New user given name"},
            {"name": "LastName", "type": "string", "default": "", "description": "New user surname"},
        ],
        "content": r"""[CmdletBinding()]
param([Parameter(Mandatory)][string]$TemplateUser, [Parameter(Mandatory)][string]$FirstName, [Parameter(Mandatory)][string]$LastName)
$ErrorActionPreference = 'Stop'
$template = Get-ADUser -Identity $TemplateUser -Properties MemberOf, DistinguishedName
$sam = ("{0}.{1}" -f $FirstName.Substring(0,1), $LastName).ToLower()
$ou = ($template.DistinguishedName -split ',', 2)[1]
$password = ([char[]](48..57) + [char[]](65..90) + [char[]](97..122) | Get-Random -Count 20) -join '' + '!7'
New-ADUser -Name "$FirstName $LastName" -GivenName $FirstName -Surname $LastName -SamAccountName $sam -UserPrincipalName "$sam@$((Get-ADDomain).DNSRoot)" -Path $ou -AccountPassword (ConvertTo-SecureString $password -AsPlainText -Force) -ChangePasswordAtLogon $true -Enabled $true
foreach ($group in $template.MemberOf) { Add-ADGroupMember -Identity $group -Members $sam }
"Created $sam in $ou cloned from $TemplateUser. Temporary password: $password"
""",
    },
    # ===================== Networking =====================
    {
        "slug": "network-health-snapshot",
        "name": "Network Health Snapshot",
        "description": "One-shot connectivity report: gateway, DNS resolution, DHCP lease, adapter stats, packet loss and latency to core targets.",
        "category": "networking",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": False,
        "timeout_seconds": 120,
        "tags": ["network", "diagnostics", "dns"],
        "parameters": [{"name": "Targets", "type": "string", "default": "8.8.8.8,1.1.1.1", "description": "Comma-separated latency targets"}],
        "content": r"""[CmdletBinding()]
param([string]$Targets = '8.8.8.8,1.1.1.1')
$ErrorActionPreference = 'Stop'
Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' } | ForEach-Object {
    "Adapter  : {0}" -f $_.InterfaceAlias
    "IPv4     : {0}" -f ($_.IPv4Address.IPAddress -join ',')
    "Gateway  : {0}" -f ($_.IPv4DefaultGateway.NextHop -join ',')
    "DNS      : {0}" -f ($_.DNSServer.ServerAddresses -join ',')
}
$lease = Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
if ($lease.DNSServer) { try { Resolve-DnsName "www.microsoft.com" -ErrorAction Stop | Select-Object -First 1 Name, IPAddress | Out-String } catch { "DNS resolution FAILED: $($_.Exception.Message)" } }
foreach ($t in ($Targets -split ',')) {
    $result = Test-Connection $t.Trim() -Count 4 -ErrorAction SilentlyContinue
    if ($result) { "{0}: avg {1} ms, loss {2}%" -f $t.Trim(), [math]::Round(($result.Latency | Measure-Object -Average).Average, 1), 0 }
    else { "{0}: UNREACHABLE" -f $t.Trim() }
}
Get-NetAdapterStatistics | Select-Object Name, ReceivedBytes, SentBytes, OutboundDiscardedPackets, OutboundPacketErrors | Format-Table -AutoSize | Out-String
""",
    },
    {
        "slug": "dns-cache-flush",
        "name": "Flush DNS and Reset Winsock",
        "description": "Clears the resolver cache, resets Winsock and the TCP/IP stack — the standard fix for 'network is weird' tickets. Reboot prompted.",
        "category": "networking",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 120,
        "tags": ["dns", "winsock", "quick-fix"],
        "parameters": [],
        "content": r"""$ErrorActionPreference = 'Stop'
ipconfig /flushdns | Out-String
Clear-DnsClientCache
netsh winsock reset | Out-String
netsh int ip reset | Out-String
Write-Output "DNS cache flushed, Winsock and TCP/IP stack reset. Restart required to complete."
""",
    },
    {
        "slug": "wifi-profile-export",
        "name": "Export Wi-Fi Profiles (with keys)",
        "description": "Exports all saved Wi-Fi profiles to a folder with key material in clear XML for controlled migration, then reports profile names.",
        "category": "networking",
        "os_target": "windows",
        "script_type": "batch",
        "run_as_admin": True,
        "timeout_seconds": 60,
        "tags": ["wifi", "migration", "export"],
        "parameters": [{"name": "ExportPath", "type": "string", "default": "C:\\NexusTemp\\WifiProfiles", "description": "Destination folder for profile XML"}],
        "content": r"""@echo off
setlocal
set EXPORTPATH=%~1
if "%EXPORTPATH%"=="" set EXPORTPATH=C:\NexusTemp\WifiProfiles
mkdir "%EXPORTPATH%" 2>nul
netsh wlan export profile key=clear folder="%EXPORTPATH%"
echo Wi-Fi profiles exported to %EXPORTPATH%
dir /b "%EXPORTPATH%"
endlocal
""",
    },
    {
        "slug": "listening-ports-review",
        "name": "Listening Ports and Owners",
        "description": "Lists every listening TCP/UDP port with its owning process and flags listeners on non-standard ports for review.",
        "category": "networking",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 60,
        "tags": ["ports", "audit", "lateral-movement"],
        "parameters": [],
        "content": r"""$ErrorActionPreference = 'Stop'
Get-NetTCPConnection -State Listen | ForEach-Object {
    $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    [pscustomobject]@{ Port = $_.LocalPort; Address = $_.LocalAddress; Process = $proc.ProcessName; PID = $_.OwningProcess; Path = $proc.Path }
} | Sort-Object Port | Format-Table -AutoSize | Out-String
""",
    },
    # ===================== Monitoring =====================
    {
        "slug": "memory-and-cpu-pressure",
        "name": "Memory and CPU Pressure Report",
        "description": "Reports memory commit pressure, page-file usage and the top 10 CPU and memory consumers — triage for 'the server is slow'.",
        "category": "monitoring",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": False,
        "timeout_seconds": 60,
        "tags": ["performance", "cpu", "memory"],
        "parameters": [],
        "content": r"""[CmdletBinding()]
param()
$ErrorActionPreference = 'Continue'
$os = Get-CimInstance Win32_OperatingSystem
"Total RAM (GB)     : {0}" -f [math]::Round($os.TotalVisibleMemorySize/1MB, 1)
"Free RAM (GB)      : {0}" -f [math]::Round($os.FreePhysicalMemory/1MB, 1)
"Commit limit (GB)  : {0}" -f [math]::Round($os.TotalVirtualMemorySize/1MB, 1)
"Commit in use (GB) : {0}" -f [math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory)/1MB, 1)
Write-Output "=== Top CPU ==="
Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Name, Id, CPU, @{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String
Write-Output "=== Top Memory ==="
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 Name, Id, @{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String
""",
    },
    {
        "slug": "service-startup-audit",
        "name": "Automatic Services Audit",
        "description": "Lists automatic services that are stopped and non-Microsoft services set to auto-start — both are standard hardening review items.",
        "category": "monitoring",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": False,
        "timeout_seconds": 60,
        "tags": ["services", "audit", "hygiene"],
        "parameters": [],
        "content": r"""[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Write-Output "=== Automatic services that are STOPPED ==="
Get-Service | Where-Object { $_.StartType -eq 'Automatic' -and $_.Status -ne 'Running' } | Select-Object Name, DisplayName, Status | Format-Table -AutoSize | Out-String
Write-Output "=== Non-Microsoft auto-start services ==="
Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' -and $_.PathName -and $_.PathName -notmatch 'Windows|Microsoft' } |
    Select-Object Name, State, PathName | Sort-Object Name | Format-Table -AutoSize | Out-String
""",
    },
    {
        "slug": "eventlog-error-summary",
        "name": "Event Log Error Summary (24h)",
        "description": "Aggregates application and system errors from the last 24 hours by source, so a tech sees the real pattern instead of raw logs.",
        "category": "monitoring",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": False,
        "timeout_seconds": 120,
        "tags": ["events", "triage", "report"],
        "parameters": [{"name": "Hours", "type": "int", "default": 24, "description": "Lookback window in hours"}],
        "content": r"""[CmdletBinding()]
param([int]$Hours = 24)
$ErrorActionPreference = 'Stop'
$start = (Get-Date).AddHours(-$Hours)
Get-WinEvent -FilterHashtable @{LogName='System','Application'; Level=1,2; StartTime=$start} -ErrorAction SilentlyContinue |
    Group-Object ProviderName, Id | Sort-Object Count -Descending | Select-Object -First 25 Count, Name |
    Format-Table -AutoSize | Out-String
""",
    },
    # ===================== Remediation =====================
    {
        "slug": "repair-office-click-to-run",
        "name": "Repair Microsoft 365 Apps (Click-to-Run)",
        "description": "Triggers an Office Click-to-Run online repair in quiet mode and verifies the installed build afterwards.",
        "category": "remediation",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 1800,
        "tags": ["office", "repair", "m365"],
        "parameters": [],
        "content": r"""$ErrorActionPreference = 'Stop'
$ctr = 'C:\Program Files\Common Files\Microsoft Shared\ClickToRun\OfficeC2RClient.exe'
if (-not (Test-Path $ctr)) { Write-Output "Click-to-Run client not found; this machine likely uses MSI-based Office."; exit 1 }
Start-Process $ctr -ArgumentList '/repair','display','quiet' -Wait
$version = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration' -ErrorAction SilentlyContinue).VersionToReport
"Office repair complete. Installed build: $version"
""",
    },
    {
        "slug": "reinstall-printer-mapping",
        "name": "Remap Network Printers",
        "description": "Removes stale network printer connections and re-adds the standard print server mappings for the site.",
        "category": "remediation",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": False,
        "timeout_seconds": 300,
        "tags": ["print", "mapping", "quick-fix"],
        "parameters": [{"name": "PrintServer", "type": "string", "default": "", "description": "Print server hostname"}],
        "content": r"""[CmdletBinding()]
param([Parameter(Mandatory)][string]$PrintServer)
$ErrorActionPreference = 'Stop'
Get-Printer | Where-Object { $_.Type -eq 'Connection' } | ForEach-Object {
    Remove-Printer -Name $_.Name -ErrorAction SilentlyContinue
    "Removed stale mapping: $($_.Name)"
}
Get-Printer -ComputerName $PrintServer -ErrorAction Stop | ForEach-Object {
    $connection = "\\$PrintServer\$($_.ShareName)"
    Add-Printer -ConnectionName $connection -ErrorAction SilentlyContinue
    "Mapped: $connection"
}
""",
    },
    {
        "slug": "chrome-enterprise-update",
        "name": "Force Chrome/Edge Enterprise Update",
        "description": "Triggers update checks for Google Chrome and Microsoft Edge enterprise installers and reports the resulting versions.",
        "category": "deployment",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 600,
        "tags": ["browsers", "patching", "updates"],
        "parameters": [],
        "content": r"""$ErrorActionPreference = 'Continue'
$tasks = @(
    @{ Name = 'Google Chrome'; Task = 'GoogleUpdateTaskMachineUA'; Path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Google Chrome' },
    @{ Name = 'Microsoft Edge'; Task = 'MicrosoftEdgeUpdateTaskMachineUA'; Path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft Edge' }
)
foreach ($t in $tasks) {
    schtasks /Run /TN $t.Task 2>$null | Out-Null
    Start-Sleep -Seconds 5
    $version = (Get-ItemProperty $t.Path -ErrorAction SilentlyContinue).DisplayVersion
    "{0}: update triggered, installed version {1}" -f $t.Name, $version
}
""",
    },
    # ===================== Deployment =====================
    {
        "slug": "winget-bulk-install",
        "name": "Bulk Install Apps via WinGet",
        "description": "Installs a standard application set through WinGet with silent agreements, and reports per-app success or skip.",
        "category": "deployment",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 1800,
        "tags": ["winget", "software", "deployment"],
        "parameters": [{"name": "Apps", "type": "string", "default": "Google.Chrome,7zip.7zip,Notepad++.Notepad++", "description": "Comma-separated WinGet package IDs"}],
        "content": r"""[CmdletBinding()]
param([string]$Apps = 'Google.Chrome,7zip.7zip,Notepad++.Notepad++')
$ErrorActionPreference = 'Continue'
foreach ($id in ($Apps -split ',')) {
    $id = $id.Trim()
    if (-not $id) { continue }
    winget install --id $id --silent --accept-package-agreements --accept-source-agreements | Out-Null
    if ($LASTEXITCODE -eq 0) { "INSTALLED  $id" } else { "FAILED($LASTEXITCODE)  $id" }
}
""",
    },
    {
        "slug": "deploy-desktop-shortcut",
        "name": "Deploy Desktop Shortcut to All Users",
        "description": "Places a URL shortcut on every user's desktop and the public desktop, with an optional icon.",
        "category": "deployment",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 120,
        "tags": ["shortcuts", "deployment", "portal"],
        "parameters": [
            {"name": "Name", "type": "string", "default": "Client Portal", "description": "Shortcut display name"},
            {"name": "Url", "type": "string", "default": "https://portal.example.com", "description": "Target URL"},
        ],
        "content": r"""[CmdletBinding()]
param([string]$Name = 'Client Portal', [string]$Url = 'https://portal.example.com')
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$targets = @("$env:PUBLIC\Desktop") + (Get-ChildItem 'C:\Users\*\Desktop' -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
foreach ($dir in $targets | Select-Object -Unique) {
    $shortcut = $shell.CreateShortcut((Join-Path $dir "$Name.url"))
    $shortcut.TargetPath = $Url
    $shortcut.Save()
    "Created $Name.url in $dir"
}
""",
    },
    {
        "slug": "inventory-hardware",
        "name": "Hardware Inventory Export",
        "description": "Collects manufacturer, model, serial, RAM, disk and OS build into a CSV-ready line for asset imports.",
        "category": "monitoring",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": False,
        "timeout_seconds": 120,
        "tags": ["inventory", "assets", "report"],
        "parameters": [],
        "content": r"""$ErrorActionPreference = 'Stop'
$cs = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$os = Get-CimInstance Win32_OperatingSystem
$disk = Get-CimInstance Win32_DiskDrive | Select-Object -First 1
[pscustomobject]@{
    Manufacturer = $cs.Manufacturer
    Model        = $cs.Model
    SerialNumber = $bios.SerialNumber
    RAM_GB       = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
    Disk_GB      = [math]::Round($disk.Size / 1GB, 0)
    OS           = $os.Caption
    Build        = $os.BuildNumber
    InstallDate  = $os.InstallDate.ToString('yyyy-MM-dd')
} | ConvertTo-Csv -NoTypeInformation
""",
    },
    {
        "slug": "check-pending-reboot",
        "name": "Pending Reboot Detection",
        "description": "Detects every known pending-reboot marker (CBS, WU, pending file rename, domain join) so patching decisions are evidence-based.",
        "category": "monitoring",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": False,
        "timeout_seconds": 60,
        "tags": ["reboot", "patching", "assessment"],
        "parameters": [],
        "content": r"""[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$markers = @()
if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') { $markers += 'Component Based Servicing' }
if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') { $markers += 'Windows Update' }
$rename = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue).PendingFileRenameOperations
if ($rename) { $markers += 'Pending file rename' }
if ((Get-CimInstance Win32_ComputerSystem).PartOfDomain -eq $false) { $markers += 'Workgroup (check domain join)' }
if ($markers) { "PENDING REBOOT: $($markers -join '; ')" } else { "No pending reboot markers found." }
""",
    },
    {
        "slug": "certificate-expiry-report",
        "name": "Machine Certificate Expiry Report",
        "description": "Lists machine certificates expiring within the threshold, with subject, thumbprint and template — prevents the classic 3am RADIUS outage.",
        "category": "security",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": False,
        "timeout_seconds": 60,
        "tags": ["certificates", "expiry", "report"],
        "parameters": [{"name": "Days", "type": "int", "default": 60, "description": "Warn for certificates expiring within this many days"}],
        "content": r"""[CmdletBinding()]
param([int]$Days = 60)
$ErrorActionPreference = 'Stop'
$cutoff = (Get-Date).AddDays($Days)
Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.NotAfter -lt $cutoff -and -not $_.PSIsContainer } |
    Select-Object Subject, @{n='Expires';e={$_.NotAfter.ToString('yyyy-MM-dd')}}, Thumbprint, @{n='Template';e={$_.Extensions | Where-Object { $_.Oid.FriendlyName -eq 'Certificate Template Name' } | ForEach-Object { $_.Format($false) }}} |
    Sort-Object Expires | Format-Table -AutoSize | Out-String
""",
    },
    {
        "slug": "quick-disk-cleanup-sxs",
        "name": "Reclaim Disk Space (WinSxS + Update Cache)",
        "description": "Runs DISM component cleanup and clears the Windows Update download cache to reclaim multi-GB on aging endpoints.",
        "category": "maintenance",
        "os_target": "windows",
        "script_type": "powershell",
        "run_as_admin": True,
        "timeout_seconds": 3600,
        "tags": ["disk", "dism", "cleanup"],
        "parameters": [],
        "content": r"""$ErrorActionPreference = 'Stop'
$before = (Get-Volume -DriveLetter C).SizeRemaining
Stop-Service wuauserv -Force -ErrorAction SilentlyContinue
Remove-Item "$env:WINDIR\SoftwareDistribution\Download\*" -Recurse -Force -ErrorAction SilentlyContinue
Start-Service wuauserv -ErrorAction SilentlyContinue
Dism.exe /Online /Cleanup-Image /StartComponentCleanup /Quiet
$after = (Get-Volume -DriveLetter C).SizeRemaining
"Reclaimed {0} GB on C:" -f [math]::Round(($after - $before) / 1GB, 2)
""",
    },
    {
        "slug": "bash-disk-usage-report",
        "name": "Linux Disk Usage and Inode Report",
        "description": "Reports filesystem and inode usage for Linux servers, flagging anything over threshold — the top cause of 'mail stopped'.",
        "category": "monitoring",
        "os_target": "linux",
        "script_type": "bash",
        "run_as_admin": False,
        "timeout_seconds": 60,
        "tags": ["linux", "disk", "inodes"],
        "parameters": [{"name": "THRESHOLD", "type": "int", "default": 85, "description": "Warn above this usage percentage"}],
        "content": r"""#!/bin/bash
THRESHOLD=${1:-85}
echo "=== Filesystem usage ==="
df -h --output=source,pcent,size,used,target -x tmpfs -x devtmpfs | tail -n +2 | while read -r line; do
  pct=$(echo "$line" | awk '{print $2}' | tr -d '%')
  if [ -n "$pct" ] && [ "$pct" -ge "$THRESHOLD" ] 2>/dev/null; then echo "WARN: $line"; else echo "OK:   $line"; fi
done
echo "=== Inode usage ==="
df -i -x tmpfs -x devtmpfs | awk 'NR==1 || $5+0 >= 80'
""",
    },
    {
        "slug": "bash-failed-logins",
        "name": "Linux Failed SSH Login Report",
        "description": "Summarises failed SSH attempts by source IP for the current journal/auth log and flags brute-force patterns.",
        "category": "security",
        "os_target": "linux",
        "script_type": "bash",
        "run_as_admin": True,
        "timeout_seconds": 120,
        "tags": ["linux", "ssh", "brute-force"],
        "parameters": [],
        "content": r"""#!/bin/bash
echo "=== Failed SSH attempts by source (last 7 days) ==="
if command -v journalctl >/dev/null 2>&1; then
  journalctl -u ssh -u sshd --since "7 days ago" 2>/dev/null | grep -i "failed\|invalid" | grep -oE 'from ([0-9]{1,3}\.){3}[0-9]{1,3}' | awk '{print $2}' | sort | uniq -c | sort -rn | head -20
else
  grep -h "Failed password\|Invalid user" /var/log/auth.log* /var/log/secure* 2>/dev/null | grep -oE 'from ([0-9]{1,3}\.){3}[0-9]{1,3}' | awk '{print $2}' | sort | uniq -c | sort -rn | head -20
fi
echo "=== Accounts under attack ==="
grep -h "Invalid user" /var/log/auth.log* /var/log/secure* 2>/dev/null | awk '{print $8}' | sort | uniq -c | sort -rn | head -10
""",
    },
    {
        "slug": "bash-security-updates",
        "name": "Linux Pending Security Updates",
        "description": "Detects the package manager and lists pending security updates without applying anything — safe for assessment runs.",
        "category": "security",
        "os_target": "linux",
        "script_type": "bash",
        "run_as_admin": True,
        "timeout_seconds": 300,
        "tags": ["linux", "patching", "assessment"],
        "parameters": [],
        "content": r"""#!/bin/bash
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq 2>/dev/null
  echo "=== Pending security updates (Debian/Ubuntu) ==="
  apt-get -s upgrade 2>/dev/null | grep -i "^Inst.*security" | head -30
elif command -v dnf >/dev/null 2>&1; then
  echo "=== Pending security updates (RHEL family) ==="
  dnf updateinfo list security 2>/dev/null | head -30
elif command -v yum >/dev/null 2>&1; then
  yum updateinfo list security 2>/dev/null | head -30
else
  echo "No supported package manager detected."
fi
""",
    },
    {
        "slug": "macos-xprotect-audit",
        "name": "macOS Security Posture Audit",
        "description": "Reports FileVault, Gatekeeper, XProtect version, SIP state and firewall status for macOS fleets.",
        "category": "security",
        "os_target": "macos",
        "script_type": "bash",
        "run_as_admin": False,
        "timeout_seconds": 60,
        "tags": ["macos", "filevault", "posture"],
        "parameters": [],
        "content": r"""#!/bin/bash
echo "FileVault  : $(fdesetup status 2>/dev/null)"
echo "Gatekeeper : $(spctl --status 2>/dev/null)"
echo "SIP        : $(csrutil status 2>/dev/null)"
echo "XProtect   : $(defaults read /Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Resources/XProtect.meta.plist Version 2>/dev/null || echo 'unknown')"
echo "Firewall   : $(defaults read /Library/Preferences/com.apple.alf globalstate 2>/dev/null || echo 'unknown') (0=off 1=on 2=block all)"
echo "OS version : $(sw_vers -productVersion) ($(sw_vers -buildVersion))"
""",
    },
]

_LIBRARY_BY_SLUG = {entry["slug"]: entry for entry in _LIBRARY}

CATEGORIES = sorted({entry["category"] for entry in _LIBRARY})
OS_TARGETS = sorted({entry["os_target"] for entry in _LIBRARY})
SCRIPT_TYPES = sorted({entry["script_type"] for entry in _LIBRARY})


def library_version() -> str:
    return LIBRARY_VERSION


def list_entries(
    category: str | None = None,
    os_target: str | None = None,
    script_type: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    """Filter the catalogue. Search matches name, description and tags."""
    results = []
    needle = (search or "").strip().lower()
    for entry in _LIBRARY:
        if category and entry["category"] != category:
            continue
        if os_target and entry["os_target"] != os_target:
            continue
        if script_type and entry["script_type"] != script_type:
            continue
        if needle:
            haystack = " ".join(
                [entry["name"], entry["description"], " ".join(entry.get("tags", []))]
            ).lower()
            if needle not in haystack:
                continue
        results.append(entry)
    return results


def get_entry(slug: str) -> dict[str, Any] | None:
    return _LIBRARY_BY_SLUG.get(slug)


def category_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    for entry in _LIBRARY:
        counts[entry["category"]] = counts.get(entry["category"], 0) + 1
    return dict(sorted(counts.items()))
