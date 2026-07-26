// Package commands polls the server for pending commands, executes them, and reports results.
package commands

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"nexusagent/internal/canary"
	"nexusagent/internal/config"
	"nexusagent/internal/identity"
	"nexusagent/internal/transport"
)

type Loop struct {
	tr    *transport.Client
	cfg   *config.Config
	every time.Duration
}

func NewLoop(tr *transport.Client, cfg *config.Config, fallback time.Duration) *Loop {
	every := time.Duration(cfg.PollSecs) * time.Second
	if every <= 0 {
		every = fallback
	}
	return &Loop{tr: tr, cfg: cfg, every: every}
}

type cmdItem struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"` // run_script, reboot, shutdown, run_powershell, run_cmd, kill_process, elevate_launch, install_companion, canary_deploy, remote_repair
	Payload struct {
		Script        string   `json:"script,omitempty"`
		Shell         string   `json:"shell,omitempty"` // powershell | cmd | bash
		Timeout       int      `json:"timeout_sec,omitempty"`
		PID           int      `json:"pid,omitempty"`
		Delay         int      `json:"delay_sec,omitempty"`
		ProgramPath   string   `json:"program_path,omitempty"`
		Arguments     []string `json:"arguments,omitempty"`
		SHA256        string   `json:"sha256,omitempty"`
		ApprovedUntil string   `json:"approved_until,omitempty"`
		CanaryID      string   `json:"canary_id,omitempty"`
		CanaryPath    string   `json:"canary_path,omitempty"`
		Actions       []string `json:"actions,omitempty"`
		Reason        string   `json:"reason,omitempty"`
		Provider      string   `json:"provider,omitempty"`
	} `json:"payload"`
}

type cmdResult struct {
	ID         string `json:"id"`
	Status     string `json:"status"` // ok | error | timeout
	ExitCode   int    `json:"exit_code"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMs int64  `json:"duration_ms"`
}

func (l *Loop) Run(ctx context.Context) {
	t := time.NewTicker(l.every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			l.pollOnce()
		}
	}
}

func (l *Loop) pollOnce() {
	var resp struct {
		Commands []cmdItem `json:"commands"`
	}
	if err := l.tr.Do("GET", "/api/nexus-agent/commands/poll", nil, &resp); err != nil {
		log.Printf("[cmd] poll error: %v", err)
		return
	}
	for _, c := range resp.Commands {
		res := l.execute(c)
		if err := l.tr.Do("POST", "/api/nexus-agent/command-result", res, nil); err != nil {
			log.Printf("[cmd] report error: %v", err)
		}
	}
}

func (l *Loop) execute(c cmdItem) (res cmdResult) {
	start := time.Now()
	res = cmdResult{ID: c.ID, Status: "ok"}
	defer func() { res.DurationMs = time.Since(start).Milliseconds() }()

	timeout := time.Duration(c.Payload.Timeout) * time.Second
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	switch c.Kind {
	case "run_script", "run_powershell", "run_cmd":
		shell := c.Payload.Shell
		if shell == "" {
			if c.Kind == "run_cmd" {
				shell = "cmd"
			}
			if c.Kind == "run_powershell" {
				shell = "powershell"
			}
			if shell == "" {
				shell = defaultShell()
			}
		}
		var cmd *exec.Cmd
		switch shell {
		case "powershell":
			cmd = exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", c.Payload.Script)
		case "cmd":
			cmd = exec.CommandContext(ctx, "cmd", "/C", c.Payload.Script)
		case "bash":
			cmd = exec.CommandContext(ctx, "bash", "-c", c.Payload.Script)
		default:
			res.Status = "error"
			res.Stderr = "unsupported shell: " + shell
			return res
		}
		var so, se bytes.Buffer
		cmd.Stdout = &so
		cmd.Stderr = &se
		err := cmd.Run()
		res.Stdout = truncate(so.String(), 64*1024)
		res.Stderr = truncate(se.String(), 16*1024)
		if cmd.ProcessState != nil {
			res.ExitCode = cmd.ProcessState.ExitCode()
		}
		if ctx.Err() == context.DeadlineExceeded {
			res.Status = "timeout"
		} else if err != nil {
			res.Status = "error"
		}

	case "reboot":
		go func() {
			time.Sleep(time.Duration(maxInt(c.Payload.Delay, 5)) * time.Second)
			_ = rebootCmd().Run()
		}()
		res.Stdout = "reboot scheduled"

	case "shutdown":
		go func() {
			time.Sleep(time.Duration(maxInt(c.Payload.Delay, 5)) * time.Second)
			_ = shutdownCmd().Run()
		}()
		res.Stdout = "shutdown scheduled"

	case "kill_process":
		if c.Payload.PID <= 0 {
			res.Status = "error"
			res.Stderr = "no PID provided"
			return res
		}
		if err := killProcess(c.Payload.PID); err != nil {
			res.Status = "error"
			res.Stderr = err.Error()
		}

	case "elevate_launch":
		res = executeApprovedElevation(ctx, c, res)
		return res

	case "install_companion":
		res = installCompanion(l.tr, c, res)
		return res

	case "canary_deploy":
		res = deployRansomwareCanary(c, res)
		return res

	case "agent_repair":
		evidence, err := identity.Repair(l.cfg, c.Payload.Actions)
		if err != nil {
			res.Status = "error"
			res.Stderr = err.Error()
			return res
		}
		for _, action := range c.Payload.Actions {
			if strings.EqualFold(strings.TrimSpace(action), "companion") && runtime.GOOS == "windows" {
				executable, locateErr := os.Executable()
				if locateErr != nil {
					evidence.Status = "attention"
					evidence.Details["companion"] = locateErr.Error()
					continue
				}
				companion := filepath.Join(filepath.Dir(executable), "nexus-client-chat.exe")
				if _, statErr := os.Stat(companion); statErr != nil {
					evidence.Status = "attention"
					evidence.Details["companion"] = "nexus-client-chat.exe is missing"
					continue
				}
				if _, shortcutErr := installCompanionStartMenuEntry(companion); shortcutErr != nil {
					evidence.Status = "attention"
					evidence.Details["companion"] = shortcutErr.Error()
				} else {
					evidence.Repairs = append(evidence.Repairs, "companion_start_menu_rewritten")
				}
			}
		}
		encoded, err := json.Marshal(evidence)
		if err != nil {
			res.Status = "error"
			res.Stderr = err.Error()
			return res
		}
		res.Stdout = string(encoded)
		return res

	case "remote_repair":
		res = repairRemoteAccess(ctx, c, res)
		return res

	case "ping":
		res.Stdout = "pong"

	default:
		res.Status = "error"
		res.Stderr = fmt.Sprintf("unknown command kind: %s", c.Kind)
	}
	return res
}

// repairRemoteAccess is deliberately bounded. It can check the locally
// installed RustDesk service and start it when stopped, but it never downloads
// software, changes credentials, rewrites relay configuration, or kills an
// active technician session.
func repairRemoteAccess(ctx context.Context, c cmdItem, res cmdResult) cmdResult {
	provider := strings.ToLower(strings.TrimSpace(c.Payload.Provider))
	if provider == "" {
		provider = "rustdesk"
	}
	if provider != "rustdesk" {
		res.Status = "error"
		res.Stderr = "bounded repair is currently available for RustDesk only"
		return res
	}

	type evidence struct {
		Provider string `json:"provider"`
		Status   string `json:"status"`
		Action   string `json:"action"`
		Detail   string `json:"detail"`
	}
	report := evidence{Provider: provider, Status: "attention", Action: "none"}

	switch runtime.GOOS {
	case "windows":
		query := exec.CommandContext(ctx, "sc.exe", "query", "RustDesk")
		output, err := query.CombinedOutput()
		text := strings.TrimSpace(string(output))
		if err != nil {
			report.Detail = "RustDesk Windows service was not found; reinstall through the signed Nexus Agent package"
			break
		}
		if strings.Contains(strings.ToUpper(text), "RUNNING") {
			report.Status = "healthy"
			report.Action = "verified"
			report.Detail = "RustDesk Windows service is running"
			break
		}
		start := exec.CommandContext(ctx, "sc.exe", "start", "RustDesk")
		startOutput, startErr := start.CombinedOutput()
		if startErr != nil {
			report.Detail = "RustDesk service exists but could not be started: " + truncate(string(startOutput), 2048)
			break
		}
		report.Status = "healthy"
		report.Action = "service_started"
		report.Detail = "RustDesk Windows service was started"
	case "linux":
		query := exec.CommandContext(ctx, "systemctl", "is-active", "rustdesk")
		if output, err := query.CombinedOutput(); err == nil && strings.TrimSpace(string(output)) == "active" {
			report.Status = "healthy"
			report.Action = "verified"
			report.Detail = "RustDesk service is active"
			break
		}
		start := exec.CommandContext(ctx, "systemctl", "start", "rustdesk")
		output, err := start.CombinedOutput()
		if err != nil {
			report.Detail = "RustDesk service could not be started: " + truncate(string(output), 2048)
			break
		}
		report.Status = "healthy"
		report.Action = "service_started"
		report.Detail = "RustDesk service was started"
	default:
		report.Detail = "Automatic RustDesk service repair is not yet supported on " + runtime.GOOS
	}

	encoded, err := json.Marshal(report)
	if err != nil {
		res.Status = "error"
		res.Stderr = err.Error()
		return res
	}
	res.Stdout = string(encoded)
	if report.Status != "healthy" {
		res.Status = "error"
		res.Stderr = report.Detail
	}
	return res
}

// executeApprovedElevation is intentionally narrower than the existing
// technician command runner. It never invokes a shell: the API approves one
// absolute .exe path, exact argv values, a SHA-256 fingerprint and an expiry.
// The Windows service performs a final fingerprint check immediately before
// it starts the process, so a swapped executable cannot inherit approval.
func executeApprovedElevation(ctx context.Context, c cmdItem, res cmdResult) cmdResult {
	if runtime.GOOS != "windows" {
		res.Status = "error"
		res.Stderr = "native elevation is currently supported on Windows endpoints only"
		return res
	}
	path := strings.TrimSpace(c.Payload.ProgramPath)
	if path == "" || !filepath.IsAbs(path) || !strings.HasSuffix(strings.ToLower(path), ".exe") {
		res.Status = "error"
		res.Stderr = "approved elevation requires an absolute .exe path"
		return res
	}
	if len(c.Payload.Arguments) > 64 {
		res.Status = "error"
		res.Stderr = "approved elevation contains too many arguments"
		return res
	}
	for _, arg := range c.Payload.Arguments {
		if strings.ContainsAny(arg, "\r\n\x00") {
			res.Status = "error"
			res.Stderr = "approved elevation contains an invalid argument"
			return res
		}
	}
	until, err := time.Parse(time.RFC3339, c.Payload.ApprovedUntil)
	if err != nil || !time.Now().UTC().Before(until.UTC()) {
		res.Status = "error"
		res.Stderr = "elevation approval has expired"
		return res
	}
	actualHash, err := fileSHA256(path)
	if err != nil {
		res.Status = "error"
		res.Stderr = "unable to fingerprint approved executable: " + err.Error()
		return res
	}
	if !strings.EqualFold(actualHash, strings.TrimSpace(c.Payload.SHA256)) {
		res.Status = "error"
		res.Stderr = "executable fingerprint does not match the approved request"
		return res
	}

	cmd := exec.CommandContext(ctx, path, c.Payload.Arguments...)
	var so, se bytes.Buffer
	cmd.Stdout = &so
	cmd.Stderr = &se
	err = cmd.Run()
	res.Stdout = truncate(so.String(), 64*1024)
	res.Stderr = truncate(se.String(), 16*1024)
	if cmd.ProcessState != nil {
		res.ExitCode = cmd.ProcessState.ExitCode()
	}
	if ctx.Err() == context.DeadlineExceeded {
		res.Status = "timeout"
	} else if err != nil {
		res.Status = "error"
	}
	return res
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// installCompanion fetches the signed-in user's local support companion from
// the NexusMSP server. The command is only queued by the dedicated backend
// rollout endpoint and the fingerprint is verified before replacing a binary.
func installCompanion(tr *transport.Client, c cmdItem, res cmdResult) cmdResult {
	if runtime.GOOS != "windows" {
		res.Status = "error"
		res.Stderr = "the Nexus Client Chat companion is currently supported on Windows endpoints only"
		return res
	}
	expectedHash := strings.TrimSpace(c.Payload.SHA256)
	if expectedHash != "" && len(expectedHash) != 64 {
		res.Status = "error"
		res.Stderr = "companion rollout has an invalid expected SHA-256"
		return res
	}
	executable, err := os.Executable()
	if err != nil {
		res.Status = "error"
		res.Stderr = "could not locate agent install directory: " + err.Error()
		return res
	}
	destination := filepath.Join(filepath.Dir(executable), "nexus-client-chat.exe")
	temporary := destination + ".download"
	defer os.Remove(temporary)
	if err := tr.Download("/api/nexus-agent/companion/latest", temporary); err != nil {
		res.Status = "error"
		res.Stderr = "could not download the client companion: " + err.Error()
		return res
	}
	actualHash, err := fileSHA256(temporary)
	if err != nil {
		res.Status = "error"
		res.Stderr = "could not fingerprint downloaded companion: " + err.Error()
		return res
	}
	if expectedHash != "" && !strings.EqualFold(actualHash, expectedHash) {
		res.Status = "error"
		res.Stderr = "downloaded companion fingerprint did not match the rollout command"
		return res
	}
	if err := os.Remove(destination); err != nil && !os.IsNotExist(err) {
		res.Status = "error"
		res.Stderr = "could not replace the client companion; close it and retry: " + err.Error()
		return res
	}
	if err := os.Rename(temporary, destination); err != nil {
		res.Status = "error"
		res.Stderr = "could not install the client companion: " + err.Error()
		return res
	}
	res.Stdout = "Nexus Client Chat companion installed successfully"
	if launcherPath, err := installCompanionStartMenuEntry(destination); err != nil {
		res.Stdout += "; the Start Menu launcher could not be created: " + err.Error()
	} else {
		res.Stdout += "; Start Menu launcher created at " + launcherPath
	}
	return res
}

// installCompanionStartMenuEntry gives the signed-in endpoint user a normal
// Windows entry point for the companion. The agent service never launches a
// GUI into another user's session; the user opens this local companion when
// they want to chat with support or request a controlled elevation.
func installCompanionStartMenuEntry(companionPath string) (string, error) {
	programData := strings.TrimSpace(os.Getenv("ProgramData"))
	if programData == "" {
		return "", fmt.Errorf("ProgramData is unavailable")
	}
	launcherDir := filepath.Join(programData, "Microsoft", "Windows", "Start Menu", "Programs", "NexusMSP")
	if err := os.MkdirAll(launcherDir, 0o755); err != nil {
		return "", err
	}
	launcherPath := filepath.Join(launcherDir, "Nexus Client Chat.cmd")
	contents := "@echo off\r\nstart \"\" \"" + companionPath + "\"\r\n"
	if err := os.WriteFile(launcherPath, []byte(contents), 0o644); err != nil {
		return "", err
	}
	return launcherPath, nil
}

func deployRansomwareCanary(c cmdItem, res cmdResult) cmdResult {
	if runtime.GOOS != "windows" {
		res.Status = "error"
		res.Stderr = "Nexus Shield Canary deployment is currently supported on Windows endpoints only"
		return res
	}
	manifest, err := canary.Deploy(c.Payload.CanaryID, c.Payload.CanaryPath)
	if err != nil {
		res.Status = "error"
		res.Stderr = err.Error()
		return res
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		res.Status = "error"
		res.Stderr = err.Error()
		return res
	}
	res.Stdout = string(encoded)
	return res
}

func defaultShell() string {
	if runtime.GOOS == "windows" {
		return "powershell"
	}
	return "bash"
}

func rebootCmd() *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.Command("shutdown", "/r", "/t", "0", "/f")
	}
	return exec.Command("shutdown", "-r", "now")
}

func shutdownCmd() *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.Command("shutdown", "/s", "/t", "0", "/f")
	}
	return exec.Command("shutdown", "-h", "now")
}

func killProcess(pid int) error {
	if runtime.GOOS == "windows" {
		return exec.Command("taskkill", "/F", "/PID", fmt.Sprintf("%d", pid)).Run()
	}
	return exec.Command("kill", "-9", fmt.Sprintf("%d", pid)).Run()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "\n...[truncated]"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
