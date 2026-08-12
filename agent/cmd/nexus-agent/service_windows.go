//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

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
	cmd := exec.Command("sc", "create", svcName,
		"binPath=", fmt.Sprintf("\"%s\"", exe),
		"start=", "auto",
		"DisplayName=", "NexusOps Agent",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("sc create failed: %v: %s", err, string(out))
	}
	_ = exec.Command("sc", "description", svcName, "NexusOps Remote Monitoring & Management Agent").Run()
	// The service runs in Session 0 and cannot own a user-visible tray icon.
	// The adjacent tray companion is registered for each interactive user instead.
	if trayPath := filepath.Join(filepath.Dir(exe), "nexus-agent-tray.exe"); fileExists(trayPath) {
		if err := installTrayLauncher(trayPath); err != nil {
			return fmt.Errorf("register tray companion: %w", err)
		}
	}
	return svcStart()
}

func svcUninstall() error {
	_ = svcStop()
	_ = removeTrayLauncher()
	out, err := exec.Command("sc", "delete", svcName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("sc delete: %v: %s", err, string(out))
	}
	return nil
}

func fileExists(path string) bool { _, err := os.Stat(path); return err == nil }

func installTrayLauncher(trayPath string) error {
	key, _, err := registry.CreateKey(registry.LOCAL_MACHINE, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	return key.SetStringValue("NexusOpsAgentTray", fmt.Sprintf(`"%s"`, trayPath))
}

func removeTrayLauncher() error {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	err = key.DeleteValue("NexusOpsAgentTray")
	if err == registry.ErrNotExist {
		return nil
	}
	return err
}

func svcStart() error {
	out, err := exec.Command("sc", "start", svcName).CombinedOutput()
	if err != nil {
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

func svcStatus() (string, error) {
	out, err := exec.Command("sc", "query", svcName).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("sc query: %v: %s", err, string(out))
	}
	return string(out), nil
}
