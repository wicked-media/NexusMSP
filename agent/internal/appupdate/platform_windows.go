//go:build windows

// Windows winget integration: find winget, list what it can upgrade, and apply
// what an operator approved.
//
// This is the dumb half of the package on purpose. Every decision about *whether*
// to install anything is made in platform-neutral code that is unit tested on any
// operating system; here the agent only locates the Windows package manager and
// runs it with a fixed argument vector.
package appupdate

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func init() {
	platformAvailable = wingetAvailable
	platformScan = scanWithWinget
	platformRunWinget = runWingetCommand
}

// wingetAvailable reports whether this endpoint has the Windows package manager.
func wingetAvailable() bool {
	_, err := wingetPath()
	return err == nil
}

// wingetPath locates winget without a shell. winget normally ships as an app
// execution alias under the signed-in user's WindowsApps folder, and a
// machine-wide install is also honoured. Nothing is resolved through a
// caller-supplied path, and a planted `winget.exe` earlier on PATH cannot be
// selected ahead of the documented locations.
func wingetPath() (string, error) {
	if local := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); local != "" {
		candidate := filepath.Join(local, "Microsoft", "WindowsApps", "winget.exe")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	if found, err := exec.LookPath("winget.exe"); err == nil {
		return found, nil
	}
	return "", errors.New("winget is not installed on this endpoint")
}

// scanWithWinget lists the packages winget reports as upgradable. The command is
// fixed: only the listing flags an operator would pass by hand, and the output is
// parsed into packages rather than forwarded anywhere.
func scanWithWinget(ctx context.Context) Evidence {
	executable, err := wingetPath()
	if err != nil {
		return Evidence{Status: StatusUnsupported, Error: err.Error()}
	}
	output, exitCode, runErr := runExecutable(ctx, ScanTimeout, executable,
		"upgrade", "--include-unknown", "--accept-source-agreements", "--disable-interactivity")
	packages, tableFound := parseUpgradeTable(output)
	if !tableFound {
		// A fully patched machine prints "No installed package found matching
		// input criteria." That is a real, useful result: report an empty scan
		// rather than a failure an operator would chase.
		if strings.Contains(strings.ToLower(output), "no installed package") {
			return Evidence{Status: StatusOK}
		}
		if runErr != nil && exitCode != 0 {
			return Evidence{Status: StatusError, Error: "winget could not list pending updates"}
		}
		return Evidence{Status: StatusError, Error: "winget produced no readable upgrade table"}
	}
	return Evidence{
		Status:       StatusOK,
		PackageCount: len(packages),
		Packages:     packages,
		Truncated:    len(packages) >= MaxPackages,
	}
}

func runWingetCommand(ctx context.Context, timeout time.Duration, args ...string) (string, int, error) {
	executable, err := wingetPath()
	if err != nil {
		return "", -1, err
	}
	return runExecutable(ctx, timeout, executable, args...)
}

// runExecutable runs one absolute program with a fixed argument vector. There is
// no shell, no interpolation and no caller-provided flag.
func runExecutable(ctx context.Context, timeout time.Duration, executable string, args ...string) (string, int, error) {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(runCtx, executable, args...)
	var buffer bytes.Buffer
	command.Stdout = &buffer
	command.Stderr = &buffer
	runErr := command.Run()
	exitCode := -1
	if command.ProcessState != nil {
		exitCode = command.ProcessState.ExitCode()
	}
	if runCtx.Err() == context.DeadlineExceeded {
		return buffer.String(), exitCode, context.DeadlineExceeded
	}
	return buffer.String(), exitCode, runErr
}
