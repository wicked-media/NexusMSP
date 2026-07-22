//go:build windows

package telemetry

import (
	"encoding/json"
	"os/exec"
)

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
