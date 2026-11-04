//go:build windows

package telemetry

import (
	"encoding/json"
	"os/exec"
	"sync"
	"time"
)

var windowsOperationsCache struct {
	sync.Mutex
	value *WindowsOperations
	at    time.Time
}

// collectWindowsOperations runs at most once every fifteen minutes. Event logs
// and service state are operational evidence, not live counters, so collecting
// them on every heartbeat would add endpoint cost without adding fidelity.
func collectWindowsOperations() *WindowsOperations {
	windowsOperationsCache.Lock()
	defer windowsOperationsCache.Unlock()
	if windowsOperationsCache.value != nil && time.Since(windowsOperationsCache.at) < 15*time.Minute {
		copy := *windowsOperationsCache.value
		copy.FailedAutomaticServices = append([]string(nil), copy.FailedAutomaticServices...)
		return &copy
	}
	const script = `$ErrorActionPreference='SilentlyContinue'; $since=(Get-Date).AddHours(-24); $week=(Get-Date).AddDays(-7); function CountLog($log,$filter){ @(Get-WinEvent -FilterHashtable $filter -ErrorAction SilentlyContinue | Select-Object -First 5000).Count }; $system=CountLog 'System' @{LogName='System';StartTime=$since;Level=2}; $app=CountLog 'Application' @{LogName='Application';StartTime=$since;Level=2}; $critical=CountLog 'System' @{LogName='System';StartTime=$since;Level=1}; $shutdown=@(Get-WinEvent -FilterHashtable @{LogName='System';StartTime=$week;Id=41,6008,1001} -ErrorAction SilentlyContinue | Select-Object -First 5000).Count; $update=@(Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-WindowsUpdateClient/Operational';StartTime=$week;Level=2} -ErrorAction SilentlyContinue | Select-Object -First 5000).Count; $failed=@(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object {$_.StartMode -eq 'Auto' -and $_.State -ne 'Running'} | Select-Object -First 40 -ExpandProperty Name); $wu=(Get-Service -Name wuauserv -ErrorAction SilentlyContinue).Status; [pscustomobject]@{observed_at=(Get-Date).ToUniversalTime().ToString('o');system_error_count_24h=$system;application_error_count_24h=$app;critical_event_count_24h=$critical;unexpected_shutdown_count_7d=$shutdown;windows_update_failure_count_7d=$update;failed_automatic_services=$failed;windows_update_service_state=[string]$wu} | ConvertTo-Json -Compress -Depth 3`
	output, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil || len(output) == 0 {
		return nil
	}
	var result WindowsOperations
	if json.Unmarshal(output, &result) != nil {
		return nil
	}
	if len(result.FailedAutomaticServices) > 40 {
		result.FailedAutomaticServices = result.FailedAutomaticServices[:40]
	}
	windowsOperationsCache.value, windowsOperationsCache.at = &result, time.Now()
	return &result
}

// collectSecurity uses built-in Windows APIs via PowerShell. It is intentionally
// read-only: installing updates is a separate, approved maintenance action.
func collectSecurity() *SecurityInfo {
	const script = `$ErrorActionPreference='Stop'
$d=Get-MpComputerStatus
$f=(Get-NetFirewallProfile | Where-Object Enabled -eq $true).Count -gt 0
$enc='Unknown'; try { $v=Get-BitLockerVolume -MountPoint 'C:' -ErrorAction Stop; if($v.ProtectionStatus -eq 'On'){$enc='BitLocker - Encrypted'}else{$enc='Not Encrypted'} } catch {}
$updates=@(); $count=0; try { $s=New-Object -ComObject Microsoft.Update.Session; $r=$s.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Software' and IsHidden=0"); $count=$r.Updates.Count; foreach($u in @($r.Updates | Select-Object -First 50)){ $updates += [pscustomobject]@{title=$u.Title;kb=($u.KBArticleIDs -join ', ');reboot_required=[bool]$u.RebootRequired} } } catch {}
[pscustomobject]@{defender_installed=$true;defender_enabled=[bool]$d.AntivirusEnabled;real_time_enabled=[bool]$d.RealTimeProtectionEnabled;signature_age_days=[int]$d.AntivirusSignatureAge;firewall_enabled=$f;encryption_status=$enc;pending_update_count=$count;pending_updates=$updates} | ConvertTo-Json -Compress -Depth 4`
	output, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil || len(output) == 0 {
		return nil
	}
	var info SecurityInfo
	if json.Unmarshal(output, &info) != nil {
		return nil
	}
	return &info
}

func collectSoftware() []SoftwareInfo {
	const script = `$paths=@('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
$apps=foreach($path in $paths){Get-ItemProperty $path -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -and -not $_.SystemComponent} | ForEach-Object {[pscustomobject]@{name=$_.DisplayName;version=$_.DisplayVersion;publisher=$_.Publisher;install_date=$_.InstallDate;size_mb=if($_.EstimatedSize){[math]::Round($_.EstimatedSize/1024,1)}else{0}}}}
$apps | Sort-Object name,version -Unique | Select-Object -First 750 | ConvertTo-Json -Compress`
	output, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil || len(output) == 0 {
		return nil
	}
	var apps []SoftwareInfo
	if json.Unmarshal(output, &apps) != nil {
		return nil
	}
	return apps
}

func enrichNICs(existing []NICInfo) []NICInfo {
	const script = `$out=Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue | ForEach-Object { $c=Get-NetIPConfiguration -InterfaceIndex $_.ifIndex -ErrorAction SilentlyContinue; [pscustomobject]@{name=$_.Name;mac=($_.MacAddress -replace '-',':').ToLower();type=if($_.Name -match 'Wi-Fi|Wireless'){'wifi'}elseif($_.Name -match 'Bluetooth'){'bluetooth'}else{'ethernet'};status=if($_.Status -eq 'Up'){'up'}else{'down'};gateway=[string]($c.IPv4DefaultGateway.NextHop | Select-Object -First 1);dns=@($c.DNSServer.ServerAddresses | Where-Object {$_});speed_mbps=if($_.LinkSpeed -match '([0-9.]+)\s*(Gbps|Mbps)'){if($matches[2] -eq 'Gbps'){[double]$matches[1]*1000}else{[double]$matches[1]}}else{0}} }; $out | ConvertTo-Json -Compress -Depth 4`
	output, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil || len(output) == 0 {
		return existing
	}
	var details []NICInfo
	if json.Unmarshal(output, &details) != nil {
		return existing
	}
	byName := map[string]NICInfo{}
	for _, item := range details {
		byName[item.Name] = item
	}
	for i := range existing {
		if detail, ok := byName[existing[i].Name]; ok {
			existing[i].Type, existing[i].Status = detail.Type, detail.Status
			existing[i].Gateway, existing[i].DNS, existing[i].SpeedMbps = detail.Gateway, detail.DNS, detail.SpeedMbps
		}
	}
	return existing
}

func collectHardware() *HardwareInfo {
	const script = `$cs=Get-CimInstance Win32_ComputerSystem; $bios=Get-CimInstance Win32_BIOS; [pscustomobject]@{manufacturer=$cs.Manufacturer;model=$cs.Model;serial_number=$bios.SerialNumber;bios_version=($bios.SMBIOSBIOSVersion);domain=$cs.Domain} | ConvertTo-Json -Compress`
	output, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil || len(output) == 0 {
		return nil
	}
	var info HardwareInfo
	if json.Unmarshal(output, &info) != nil {
		return nil
	}
	return &info
}
