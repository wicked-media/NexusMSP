//go:build !windows

package main

import (
	"errors"

	"nexusagent/internal/config"
)

// On non-Windows, service install is a no-op stub so foreground mode still works.
func svcInstall(_ *config.Config) error { return errors.New("service install is Windows-only in this build") }
func svcUninstall() error                { return errors.New("service uninstall is Windows-only in this build") }
func svcStart() error                    { return errors.New("service start is Windows-only in this build") }
func svcStop() error                     { return errors.New("service stop is Windows-only in this build") }
func svcStatus() (string, error)         { return "not a Windows service", nil }
