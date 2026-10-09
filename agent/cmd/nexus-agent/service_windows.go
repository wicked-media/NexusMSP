//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc"
	"nexusagent/internal/config"
)

const svcName = "NexusOpsAgent"

type agentService struct{ cfg *config.Config }

func (s *agentService) Execute(_ []string, requests <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	changes <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go runAgentContext(ctx, s.cfg)
	changes <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for request := range requests {
		switch request.Cmd {
		case svc.Interrogate:
			changes <- request.CurrentStatus
		case svc.Stop, svc.Shutdown:
			changes <- svc.Status{State: svc.StopPending}
			cancel()
			return false, 0
		}
	}
	return false, 0
}

// svcRunIfNeeded lets the same executable run interactively from a terminal
// and correctly participate in the Windows Service Control Manager when it is
// launched as the NexusOpsAgent service.
func svcRunIfNeeded(cfg *config.Config) (bool, error) {
	isService, err := svc.IsWindowsService()
	if err != nil || !isService {
		return false, err
	}
	return true, svc.Run(svcName, &agentService{cfg: cfg})
}

func svcInstall(cfg *config.Config) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	// No explicit run flag: main detects Service Control Manager execution and
	// starts the Windows service handler; interactive launches remain console-mode.
	if serviceExists() {
		cmd := exec.Command("sc", "config", svcName,
			"binPath=", fmt.Sprintf("\"%s\"", exe),
			"start=", "auto",
			"DisplayName=", "NexusOps Agent",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("sc config failed: %v: %s", err, string(out))
		}
	} else {
		cmd := exec.Command("sc", "create", svcName,
			"binPath=", fmt.Sprintf("\"%s\"", exe),
			"start=", "auto",
			"DisplayName=", "NexusOps Agent",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("sc create failed: %v: %s", err, string(out))
		}
	}
	_ = exec.Command("sc", "description", svcName, "NexusOps Remote Monitoring & Management Agent").Run()
	if err := configureServiceRecovery(); err != nil {
		return err
	}
	// The service runs in Session 0 and cannot own a user-visible tray icon.
	// The adjacent tray companion is registered for each interactive user instead.
	if trayPath := filepath.Join(filepath.Dir(exe), "nexus-agent-tray.exe"); fileExists(trayPath) {
		if err := installTrayLauncher(trayPath); err != nil {
			return fmt.Errorf("register tray companion: %w", err)
		}
	}
	if remotePath := filepath.Join(filepath.Dir(exe), "nexus-remote-companion.exe"); fileExists(remotePath) {
		if err := installRemoteCompanionLauncher(remotePath); err != nil {
			return fmt.Errorf("register remote companion: %w", err)
		}
	}
	return svcStart()
}

func serviceExists() bool {
	return exec.Command("sc", "query", svcName).Run() == nil
}

// configureServiceRecovery makes the installed service resilient to a normal
// process crash. It intentionally does not attempt self-updates or recovery
// from an operator-requested stop; Windows Service Control Manager owns that
// distinction and records it in the host event log.
func configureServiceRecovery() error {
	commands := [][]string{
		{"failure", svcName, "reset=", "86400", "actions=", "restart/5000/restart/15000/restart/60000"},
		{"failureflag", svcName, "1"},
	}
	for _, args := range commands {
		if out, err := exec.Command("sc", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("configure service recovery failed: %v: %s", err, string(out))
		}
	}
	return nil
}

func svcUninstall() error {
	_ = svcStop()
	_ = removeTrayLauncher()
	_ = removeRemoteCompanionLauncher()
	out, err := exec.Command("sc", "delete", svcName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("sc delete: %v: %s", err, string(out))
	}
	return nil
}

func fileExists(path string) bool { _, err := os.Stat(path); return err == nil }

func installTrayLauncher(trayPath string) error {
	return installUserLauncher("NexusOpsAgentTray", trayPath)
}

func installRemoteCompanionLauncher(remotePath string) error {
	return installUserLauncher("NexusRemoteCompanion", remotePath)
}

func installUserLauncher(name, executable string) error {
	key, _, err := registry.CreateKey(registry.LOCAL_MACHINE, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	return key.SetStringValue(name, fmt.Sprintf(`"%s"`, executable))
}

func removeTrayLauncher() error {
	return removeUserLauncher("NexusOpsAgentTray")
}

func removeRemoteCompanionLauncher() error {
	return removeUserLauncher("NexusRemoteCompanion")
}

func removeUserLauncher(name string) error {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	err = key.DeleteValue(name)
	if err == registry.ErrNotExist {
		return nil
	}
	return err
}

func svcStart() error {
	out, err := exec.Command("sc", "start", svcName).CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "1056") {
			return nil
		}
		return fmt.Errorf("sc start: %v: %s", err, string(out))
	}
	return nil
}

func svcStop() error {
	out, err := exec.Command("sc", "stop", svcName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("sc stop: %v: %s", err, string(out))
	}
	return nil
}

// svcRestart restarts the agent's own service after the self-heal ladder has
// exhausted everything else. A process cannot start itself again once it has
// stopped, so a short-lived detached helper asks the Service Control Manager to
// start the service a few seconds later.
//
// The command line is a fixed constant. Only the compiled service name is used,
// no caller-supplied value is ever interpolated into it, and both executables are
// absolute paths under System32 rather than anything resolved through PATH. This
// rung is off unless a signed policy or the installer configuration explicitly
// enables it.
func svcRestart() error {
	root := os.Getenv("SystemRoot")
	if strings.TrimSpace(root) == "" {
		root = `C:\Windows`
	}
	system32 := filepath.Join(root, "System32")
	commandLine := fmt.Sprintf("ping -n 8 127.0.0.1 >nul & \"%s\" start %s", filepath.Join(system32, "sc.exe"), svcName)
	helper := exec.Command(filepath.Join(system32, "cmd.exe"), "/c", commandLine)
	helper.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW | windows.DETACHED_PROCESS,
	}
	if err := helper.Start(); err != nil {
		return fmt.Errorf("schedule agent service restart: %w", err)
	}
	// The helper must outlive this process, so it is released rather than waited on.
	_ = helper.Process.Release()
	if out, err := exec.Command(filepath.Join(system32, "sc.exe"), "stop", svcName).CombinedOutput(); err != nil {
		return fmt.Errorf("sc stop: %v: %s", err, string(out))
	}
	return nil
}

func svcStatus() (string, error) {
	out, err := exec.Command("sc", "query", svcName).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("sc query: %v: %s", err, string(out))
	}
	return string(out), nil
}
