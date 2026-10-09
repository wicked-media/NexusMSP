//go:build windows

// Windows performance probe and inbuilt component repair.
//
// This is the half of the self-heal loop that touches the operating system, and
// it is deliberately the dumb half: every decision about *whether* to repair is
// made in platform-neutral code that is unit tested on any OS. Here the agent
// only samples signals and, when told to, runs the repairs Windows already ships:
//
//	DISM.exe /Online /Cleanup-Image /RestoreHealth   (payload from Windows Update)
//	sfc.exe /scannow                                 (protected system files)
//	DISM.exe /Online /Cleanup-Image /CheckHealth     (verify, do not assume)
package selfheal

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	restoreHealthTimeout = 75 * time.Minute
	scannowTimeout       = 75 * time.Minute
	checkHealthTimeout   = 15 * time.Minute
	// Component store health changes slowly (it moves when servicing runs), and
	// DISM /CheckHealth costs minutes, so it is re-read once a day rather than on
	// every sample.
	componentCheckEvery = 24 * time.Hour
	outputTailLimit     = 2000
)

type windowsPlatform struct {
	mu              sync.Mutex
	health          int
	healthDetail    string
	healthKnown     bool
	healthCheckedAt time.Time
	checking        bool
	repairing       bool
}

// DefaultPlatform returns the Windows platform implementation.
func DefaultPlatform() Platform { return &windowsPlatform{} }

// Elevated reports whether the agent process holds an administrator token.
// Without it neither DISM /CheckHealth nor the repair can run at all.
func (p *windowsPlatform) Elevated() bool {
	token := windows.GetCurrentProcessToken()
	return token.IsElevated()
}

// Sample reads the performance signals this endpoint can actually observe.
// Every collector is best-effort: a failed query omits its signal rather than
// interrupting the check-in path.
func (p *windowsPlatform) Sample(ctx context.Context) Sample {
	sample := Sample{
		Supported: true,
		At:        time.Now().UTC(),
		Signals:   map[string]float64{},
		Details:   map[string]string{},
	}
	elevated := p.Elevated()
	if elevated {
		sample.Details["elevated"] = "true"
	} else {
		sample.Details["elevated"] = "false"
	}

	if percents, err := cpu.Percent(0, false); err == nil && len(percents) > 0 {
		sample.Signals[SignalCPUPercent] = round1(percents[0])
	}
	if usage, err := mem.VirtualMemory(); err == nil && usage != nil {
		sample.Signals[SignalMemoryPercent] = round1(usage.UsedPercent)
	}
	if free, mount, ok := minimumFreeSpace(); ok {
		sample.Signals[SignalDiskFreePercent] = free
		sample.Details["tightest_volume"] = mount
	}
	if pending, source := rebootPending(); pending {
		sample.Signals[SignalPendingReboot] = 1
		sample.Details["pending_reboot"] = source
	}
	if health, detail, known := p.componentStoreHealth(); known {
		sample.Signals[SignalComponentStore] = float64(health)
		sample.Details["component_store"] = detail
	}
	return sample
}

// Repair runs the inbuilt Windows component repair and verifies it.
func (p *windowsPlatform) Repair(ctx context.Context, trigger []string) RepairRecord {
	record := RepairRecord{
		Trigger:   strings.Join(trigger, "+"),
		StartedAt: time.Now().UTC().Format(time.RFC3339),
		Status:    RepairFailed,
	}
	started := time.Now()

	p.mu.Lock()
	if p.repairing {
		p.mu.Unlock()
		record.Status = RepairBlocked
		record.Reason = "a component repair is already running"
		return record
	}
	p.repairing = true
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		p.repairing = false
		p.mu.Unlock()
	}()

	if !p.Elevated() {
		record.Status = RepairBlocked
		record.Reason = "the agent is not running elevated, so the inbuilt Windows repair is unavailable"
		return record
	}

	// Order matches what an on-site technician would do, and each step depends on
	// the previous one: repair the servicing image first (DISM takes replacement
	// payload from Windows Update), then let sfc /scannow restore protected
	// system files from that repaired image, then verify instead of assuming.
	restoreHealth := runStep(ctx, restoreHealthTimeout, systemExecutable("Dism.exe"), "/Online", "/Cleanup-Image", "/RestoreHealth")
	systemScan := runStep(ctx, scannowTimeout, systemExecutable("sfc.exe"), "/scannow")
	verification := runStep(ctx, checkHealthTimeout, systemExecutable("Dism.exe"), "/Online", "/Cleanup-Image", "/CheckHealth")
	record.Steps = []RepairStep{restoreHealth, systemScan, verification}

	health, detail, known := classifyCheckHealth(verification.Output)
	switch {
	case known && health == 0:
		record.Verified = true
	case known:
		record.Reason = detail
	default:
		record.Reason = "the post-repair component store check produced no recognised result"
	}
	record.RebootRequired = mentionsReboot(restoreHealth.Output) || mentionsReboot(systemScan.Output)
	if restoreHealth.OK && systemScan.OK && verification.OK && record.Verified {
		record.Status = RepairCompleted
		record.Reason = "component store verified healthy after DISM /RestoreHealth and sfc /scannow"
	} else if record.Reason == "" {
		record.Reason = "one or more repair steps did not complete"
	}
	record.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	record.DurationSeconds = int64(time.Since(started).Seconds())

	// Cache the fresh result so the probe does not immediately re-run DISM.
	p.mu.Lock()
	p.health, p.healthDetail, p.healthKnown, p.healthCheckedAt = health, detail, known, time.Now()
	p.mu.Unlock()
	return record
}

// componentStoreHealth reports the cached component store state, kicking off a
// background DISM /CheckHealth when the cached value has gone stale. DISM takes
// minutes, and the loop that calls this must stay responsive enough to notice
// that it lost the control plane.
func (p *windowsPlatform) componentStoreHealth() (int, string, bool) {
	if !p.Elevated() {
		return 0, "", false
	}
	p.mu.Lock()
	fresh := p.healthKnown && !p.healthCheckedAt.IsZero() && time.Since(p.healthCheckedAt) < componentCheckEvery
	if fresh || p.checking {
		health, detail, known := p.health, p.healthDetail, p.healthKnown
		p.mu.Unlock()
		return health, detail, known
	}
	p.checking = true
	p.mu.Unlock()

	go func() {
		step := runStep(context.Background(), checkHealthTimeout, systemExecutable("Dism.exe"), "/Online", "/Cleanup-Image", "/CheckHealth")
		health, detail, known := classifyCheckHealth(step.Output)
		p.mu.Lock()
		p.checking = false
		if known {
			p.health, p.healthDetail, p.healthKnown = health, detail, true
		}
		p.healthCheckedAt = time.Now()
		p.mu.Unlock()
	}()
	return 0, "", false
}

// runStep executes one fixed system command. The executable is always an absolute
// path inside System32, so a planted binary on PATH can never be what the agent
// runs as its repair.
func runStep(parent context.Context, timeout time.Duration, executable string, args ...string) RepairStep {
	step := RepairStep{Command: filepath.Base(executable) + " " + strings.Join(args, " ")}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	command := exec.CommandContext(ctx, executable, args...)
	var buffer bytes.Buffer
	command.Stdout = &buffer
	command.Stderr = &buffer
	err := command.Run()
	switch {
	case ctx.Err() == context.DeadlineExceeded:
		step.ExitCode = -2
	case command.ProcessState != nil:
		step.ExitCode = command.ProcessState.ExitCode()
	default:
		step.ExitCode = -1
	}
	step.OK = err == nil
	step.Output = cleanOutput(buffer.Bytes())
	return step
}

func systemExecutable(name string) string {
	root := os.Getenv("SystemRoot")
	if strings.TrimSpace(root) == "" {
		root = `C:\Windows`
	}
	return filepath.Join(root, "System32", name)
}

// cleanOutput recovers readable text from console output. sfc.exe writes UTF-16LE
// on its console handle, so its ASCII text arrives with a NUL byte between every
// character; dropping the NULs recovers it without adding a decoding dependency.
func cleanOutput(raw []byte) string {
	cleaned := bytes.ReplaceAll(raw, []byte{0}, nil)
	cleaned = bytes.ReplaceAll(cleaned, []byte("\r"), []byte("\n"))
	text := strings.TrimSpace(string(cleaned))
	for strings.Contains(text, "\n\n") {
		text = strings.ReplaceAll(text, "\n\n", "\n")
	}
	if len(text) > outputTailLimit {
		text = text[len(text)-outputTailLimit:]
	}
	return text
}

// classifyCheckHealth reads DISM /CheckHealth's verdict.
func classifyCheckHealth(output string) (int, string, bool) {
	text := strings.ToLower(output)
	switch {
	case strings.Contains(text, "no component store corruption detected"):
		return 0, "no component store corruption detected", true
	case strings.Contains(text, "not repairable"):
		return 2, "component store corruption is not repairable", true
	case strings.Contains(text, "repairable"):
		return 1, "component store corruption is repairable", true
	case strings.Contains(text, "component store corruption"):
		return 2, "component store corruption reported", true
	}
	return 0, "", false
}

func mentionsReboot(output string) bool {
	text := strings.ToLower(output)
	for _, phrase := range []string{
		"restart windows", "restart the computer", "restart to complete", "reboot", "restart required",
	} {
		if strings.Contains(text, phrase) {
			return true
		}
	}
	return false
}

// rebootPending looks for the two Windows servicing markers that mean a restart
// is outstanding. A pending restart is reported, never acted on: rebooting a
// customer's endpoint is an operator decision.
func rebootPending() (bool, string) {
	markers := []struct {
		path  string
		label string
	}{
		{`SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`, "component based servicing"},
		{`SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`, "windows update"},
	}
	for _, marker := range markers {
		key, err := registry.OpenKey(registry.LOCAL_MACHINE, marker.path, registry.QUERY_VALUE)
		if err == nil {
			key.Close()
			return true, marker.label
		}
	}
	return false, ""
}

// minimumFreeSpace returns the free percentage of the tightest local fixed
// volume. Network and removable volumes are excluded: they are not what makes
// the operating system slow.
func minimumFreeSpace() (float64, string, bool) {
	partitions, err := disk.Partitions(false)
	if err != nil {
		return 0, "", false
	}
	tightest := 101.0
	mount := ""
	for _, partition := range partitions {
		if !isLocalFixedVolume(partition.Mountpoint, partition.Fstype) {
			continue
		}
		usage, err := disk.Usage(partition.Mountpoint)
		if err != nil || usage == nil || usage.Total == 0 {
			continue
		}
		free := 100 - usage.UsedPercent
		if free < tightest {
			tightest = free
			mount = partition.Mountpoint
		}
	}
	if mount == "" {
		return 0, "", false
	}
	return round1(tightest), mount, true
}

func isLocalFixedVolume(mount, fsType string) bool {
	if len(mount) < 3 || mount[1] != ':' || (mount[2] != '\\' && mount[2] != '/') {
		return false
	}
	switch strings.ToUpper(fsType) {
	case "NTFS", "REFS", "EXFAT", "FAT32", "FAT":
		return true
	}
	return false
}

func round1(value float64) float64 {
	return float64(int(value*10+0.5)) / 10
}
