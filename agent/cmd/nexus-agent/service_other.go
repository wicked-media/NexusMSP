//go:build !windows

package main

import (
	"fmt"

	"nexusagent/internal/config"
)

func svcRunIfNeeded(_ *config.Config) (bool, error) { return false, nil }

// Service control is implemented by service_windows.go. These explicit
// non-Windows fallbacks keep local tooling and Linux CI honest without
// pretending that a Windows service action succeeded on another platform.
func svcInstall(_ *config.Config) error { return unsupportedServiceAction("install") }
func svcUninstall() error               { return unsupportedServiceAction("uninstall") }
func svcStart() error                   { return unsupportedServiceAction("start") }
func svcStop() error                    { return unsupportedServiceAction("stop") }
func svcStatus() (string, error)        { return "", unsupportedServiceAction("query status") }

func unsupportedServiceAction(action string) error {
	return fmt.Errorf("cannot %s the NexusOps Agent service on this operating system; Windows is required", action)
}
