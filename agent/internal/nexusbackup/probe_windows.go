//go:build windows

package nexusbackup

import (
	"context"
	"encoding/json"
	"os/exec"
	"time"
)

// Probe returns only bounded Windows Backup-readiness posture. It does not
// create a VSS snapshot, enumerate source paths, read a customer file, or
// report disk names or capacity values.
func Probe(ctx context.Context) map[string]any {
	result := map[string]any{
		"platform":              "windows",
		"vss_state":             "unknown",
		"volume_capacity_state": "unknown",
	}
	probeCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	command := "$v=Get-Service -Name VSS -ErrorAction SilentlyContinue; $w=& vssadmin list writers 2>$null; $vol=Get-Volume -ErrorAction SilentlyContinue | Where-Object { $_.DriveType -eq 'Fixed' }; [pscustomobject]@{vss=if($v -and $v.Status -eq 'Running'){'ready'}elseif($v){'not_running'}else{'unavailable'};writers=if($w -match 'Stable'){'stable'}elseif($w){'attention'}else{'unavailable'};volumes=if($vol){'observed'}else{'unknown'}} | ConvertTo-Json -Compress"
	out, err := exec.CommandContext(probeCtx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command).Output()
	if err != nil {
		return result
	}
	var observed struct {
		VSS     string `json:"vss"`
		Writers string `json:"writers"`
		Volumes string `json:"volumes"`
	}
	if json.Unmarshal(out, &observed) != nil {
		return result
	}
	if observed.VSS == "ready" && observed.Writers == "stable" {
		result["vss_state"] = "ready"
	} else if observed.VSS != "" || observed.Writers != "" {
		result["vss_state"] = "attention"
	}
	if observed.Volumes == "observed" {
		result["volume_capacity_state"] = "observed"
	}
	return result
}
