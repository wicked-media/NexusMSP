//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"

	"nexusagent/internal/config"
)

const svcName = "NexusOpsAgent"

func svcInstall(cfg *config.Config) error {
	exe, err := os.Executable()
	if err != nil { return err }
	// sc create NexusOpsAgent binPath= "<exe> -run foreground" start= auto DisplayName= "NexusOps Agent"
	cmd := exec.Command("sc", "create", svcName,
		"binPath=", fmt.Sprintf("\"%s\" -run foreground", exe),
		"start=", "auto",
		"DisplayName=", "NexusOps Agent",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("sc create failed: %v: %s", err, string(out))
	}
	_ = exec.Command("sc", "description", svcName, "NexusOps Remote Monitoring & Management Agent").Run()
	return svcStart()
}

func svcUninstall() error {
	_ = svcStop()
	out, err := exec.Command("sc", "delete", svcName).CombinedOutput()
	if err != nil { return fmt.Errorf("sc delete: %v: %s", err, string(out)) }
	return nil
}

func svcStart() error {
	out, err := exec.Command("sc", "start", svcName).CombinedOutput()
	if err != nil { return fmt.Errorf("sc start: %v: %s", err, string(out)) }
	return nil
}

func svcStop() error {
	out, err := exec.Command("sc", "stop", svcName).CombinedOutput()
	if err != nil { return fmt.Errorf("sc stop: %v: %s", err, string(out)) }
	return nil
}

func svcStatus() (string, error) {
	out, err := exec.Command("sc", "query", svcName).CombinedOutput()
	if err != nil { return "", fmt.Errorf("sc query: %v: %s", err, string(out)) }
	return string(out), nil
}
