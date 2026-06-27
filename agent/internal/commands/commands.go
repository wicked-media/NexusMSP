// Package commands polls the server for pending commands, executes them, and reports results.
package commands

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os/exec"
	"runtime"
	"time"

	"nexusagent/internal/config"
	"nexusagent/internal/transport"
)

type Loop struct {
	tr    *transport.Client
	cfg   *config.Config
	every time.Duration
}

func NewLoop(tr *transport.Client, cfg *config.Config, fallback time.Duration) *Loop {
	every := time.Duration(cfg.PollSecs) * time.Second
	if every <= 0 { every = fallback }
	return &Loop{tr: tr, cfg: cfg, every: every}
}

type cmdItem struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`               // run_script, reboot, shutdown, run_powershell, run_cmd, kill_process
	Payload struct {
		Script   string `json:"script,omitempty"`
		Shell    string `json:"shell,omitempty"`   // powershell | cmd | bash
		Timeout  int    `json:"timeout_sec,omitempty"`
		PID      int    `json:"pid,omitempty"`
		Delay    int    `json:"delay_sec,omitempty"`
	} `json:"payload"`
}

type cmdResult struct {
	ID        string `json:"id"`
	Status    string `json:"status"`       // ok | error | timeout
	ExitCode  int    `json:"exit_code"`
	Stdout    string `json:"stdout"`
	Stderr    string `json:"stderr"`
	DurationMs int64 `json:"duration_ms"`
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

func (l *Loop) execute(c cmdItem) cmdResult {
	start := time.Now()
	res := cmdResult{ID: c.ID, Status: "ok"}
	defer func() { res.DurationMs = time.Since(start).Milliseconds() }()

	timeout := time.Duration(c.Payload.Timeout) * time.Second
	if timeout <= 0 { timeout = 120 * time.Second }
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	switch c.Kind {
	case "run_script", "run_powershell", "run_cmd":
		shell := c.Payload.Shell
		if shell == "" {
			if c.Kind == "run_cmd"      { shell = "cmd" }
			if c.Kind == "run_powershell" { shell = "powershell" }
			if shell == ""              { shell = defaultShell() }
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
		if cmd.ProcessState != nil { res.ExitCode = cmd.ProcessState.ExitCode() }
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

	case "ping":
		res.Stdout = "pong"

	default:
		res.Status = "error"
		res.Stderr = fmt.Sprintf("unknown command kind: %s", c.Kind)
	}
	return res
}

func defaultShell() string {
	if runtime.GOOS == "windows" { return "powershell" }
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
	if len(s) <= n { return s }
	return s[:n] + "\n...[truncated]"
}

func maxInt(a, b int) int { if a > b { return a }; return b }
