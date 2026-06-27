// Package telemetry collects OS / hardware / runtime data for heartbeats.
package telemetry

import (
	"runtime"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
)

// QuickPayload is a minimal info shape used for enrollment.
type QuickPayload struct {
	OSVersion    string
	PrimaryMAC   string
	AgentVersion string
}

// QuickInfo returns lightweight startup info, never errors hard.
func QuickInfo() QuickPayload {
	info, _ := host.Info()
	ver := ""
	if info != nil { ver = info.PlatformVersion }
	mac := ""
	if ifs, err := net.Interfaces(); err == nil {
		for _, n := range ifs {
			if n.HardwareAddr != "" && !contains(n.Flags, "loopback") {
				mac = n.HardwareAddr
				break
			}
		}
	}
	return QuickPayload{OSVersion: ver, PrimaryMAC: mac, AgentVersion: ""}
}

// Snapshot is a full periodic heartbeat payload.
type Snapshot struct {
	Hostname     string         `json:"hostname"`
	OS           string         `json:"os"`
	OSVersion    string         `json:"os_version,omitempty"`
	OSPlatform   string         `json:"os_platform,omitempty"`
	Arch         string         `json:"arch"`
	UptimeSec    uint64         `json:"uptime_sec"`
	BootTime     uint64         `json:"boot_time,omitempty"`
	CPUPercent   float64        `json:"cpu_percent"`
	CPUCount     int            `json:"cpu_count"`
	CPUModel     string         `json:"cpu_model,omitempty"`
	MemTotalMB   uint64         `json:"mem_total_mb"`
	MemUsedMB    uint64         `json:"mem_used_mb"`
	MemPercent   float64        `json:"mem_percent"`
	Disks        []DiskInfo     `json:"disks,omitempty"`
	NICs         []NICInfo      `json:"nics,omitempty"`
}

type DiskInfo struct {
	Device     string  `json:"device"`
	Mount      string  `json:"mount"`
	FSType     string  `json:"fs_type,omitempty"`
	TotalGB    float64 `json:"total_gb"`
	UsedGB     float64 `json:"used_gb"`
	Percent    float64 `json:"percent"`
}

type NICInfo struct {
	Name string   `json:"name"`
	MAC  string   `json:"mac,omitempty"`
	IPv4 []string `json:"ipv4,omitempty"`
}

// Collect returns a full snapshot — best-effort, never panics.
func Collect() Snapshot {
	s := Snapshot{Arch: runtime.GOARCH, OS: runtime.GOOS}

	if h, err := host.Info(); err == nil && h != nil {
		s.Hostname = h.Hostname
		s.UptimeSec = h.Uptime
		s.BootTime = h.BootTime
		s.OSVersion = h.PlatformVersion
		s.OSPlatform = h.Platform
	}

	if pcts, err := cpu.Percent(0, false); err == nil && len(pcts) > 0 {
		s.CPUPercent = round2(pcts[0])
	}
	if infos, err := cpu.Info(); err == nil && len(infos) > 0 {
		s.CPUModel = infos[0].ModelName
		s.CPUCount = int(infos[0].Cores)
	} else {
		s.CPUCount = runtime.NumCPU()
	}

	if v, err := mem.VirtualMemory(); err == nil && v != nil {
		s.MemTotalMB = v.Total / (1024 * 1024)
		s.MemUsedMB = v.Used / (1024 * 1024)
		s.MemPercent = round2(v.UsedPercent)
	}

	if parts, err := disk.Partitions(false); err == nil {
		for _, p := range parts {
			u, err := disk.Usage(p.Mountpoint)
			if err != nil || u == nil { continue }
			s.Disks = append(s.Disks, DiskInfo{
				Device:  p.Device,
				Mount:   p.Mountpoint,
				FSType:  p.Fstype,
				TotalGB: round2(float64(u.Total) / (1024 * 1024 * 1024)),
				UsedGB:  round2(float64(u.Used) / (1024 * 1024 * 1024)),
				Percent: round2(u.UsedPercent),
			})
		}
	}

	if ifs, err := net.Interfaces(); err == nil {
		for _, n := range ifs {
			if contains(n.Flags, "loopback") { continue }
			ips := []string{}
			for _, a := range n.Addrs {
				ips = append(ips, a.Addr)
			}
			s.NICs = append(s.NICs, NICInfo{Name: n.Name, MAC: n.HardwareAddr, IPv4: ips})
		}
	}
	return s
}

func contains(s []string, v string) bool {
	for _, x := range s { if x == v { return true } }
	return false
}

func round2(f float64) float64 {
	return float64(int(f*100+0.5)) / 100
}
