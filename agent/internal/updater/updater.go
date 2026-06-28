// Package updater handles atomic in-place upgrades of the agent binary.
//
// Strategy:
//  1. Heartbeat response may include {version, url, sha256, size}.
//  2. If our embedded Version differs, download the URL to <exe>.new.
//  3. Verify SHA256 matches.
//  4. Spawn an OS-specific updater script that waits for the parent to exit,
//     swaps the binary, and restarts the Windows service.
//  5. Exit the agent — service manager (or the spawned script) will relaunch us.
package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"time"
)

// Info describes the update advertised by the server.
type Info struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
}

var inProgress atomic.Bool

// Apply downloads + verifies + swaps the binary, then exits.
// `serverBase` is the base URL of the server (e.g. https://nexusops.example.com).
// `currentVersion` is the running agent's compiled-in Version.
// `token` is the agent's X-Agent-Token (for authenticated download).
func Apply(info Info, serverBase, currentVersion, token string) error {
	if !inProgress.CompareAndSwap(false, true) {
		return errors.New("update already in progress")
	}
	defer inProgress.Store(false)

	if info.Version == "" || info.URL == "" || info.SHA256 == "" {
		return errors.New("update advert missing fields")
	}
	if info.Version == currentVersion {
		return nil // nothing to do
	}

	exe, err := os.Executable()
	if err != nil { return fmt.Errorf("locate exe: %w", err) }
	exeDir := filepath.Dir(exe)
	newPath := exe + ".new"

	// Resolve URL — server may send relative path.
	dlURL := info.URL
	if strings.HasPrefix(dlURL, "/") {
		dlURL = strings.TrimRight(serverBase, "/") + dlURL
	}

	log.Printf("[updater] downloading %s → %s (target version %s)", dlURL, newPath, info.Version)

	if err := download(dlURL, newPath, token); err != nil {
		return fmt.Errorf("download: %w", err)
	}

	got, err := fileSha256(newPath)
	if err != nil {
		_ = os.Remove(newPath)
		return fmt.Errorf("hash: %w", err)
	}
	if !strings.EqualFold(got, info.SHA256) {
		_ = os.Remove(newPath)
		return fmt.Errorf("checksum mismatch: want %s got %s", info.SHA256, got)
	}
	log.Printf("[updater] checksum verified — staging swap")

	if err := os.Chmod(newPath, 0o755); err != nil {
		log.Printf("[updater] chmod warn: %v", err)
	}

	if err := spawnUpdater(exe, newPath, exeDir); err != nil {
		return fmt.Errorf("spawn updater: %w", err)
	}

	// Give the OS a beat, then exit so the swap can happen.
	log.Println("[updater] exiting parent to allow swap")
	go func() {
		time.Sleep(800 * time.Millisecond)
		os.Exit(0)
	}()
	return nil
}

func download(url, dst, token string) error {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil { return err }
	if token != "" {
		req.Header.Set("X-Agent-Token", token)
	}
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil { return err }
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.Create(dst)
	if err != nil { return err }
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}

func fileSha256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil { return "", err }
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil { return "", err }
	return hex.EncodeToString(h.Sum(nil)), nil
}

// spawnUpdater writes an OS-specific script that swaps binaries after the parent exits.
func spawnUpdater(exe, newPath, dir string) error {
	switch runtime.GOOS {
	case "windows":
		return spawnWindows(exe, newPath, dir)
	default:
		return spawnUnix(exe, newPath, dir)
	}
}

// spawnWindows writes a batch script that:
//   - waits 3s for the service to stop
//   - moves the new binary into place
//   - starts the Windows service
func spawnWindows(exe, newPath, dir string) error {
	bat := filepath.Join(dir, "_update.bat")
	content := fmt.Sprintf(
		"@echo off\r\n"+
			"timeout /t 3 /nobreak >nul\r\n"+
			"sc stop NexusOpsAgent >nul 2>&1\r\n"+
			"timeout /t 3 /nobreak >nul\r\n"+
			":loop\r\n"+
			"move /Y \"%s\" \"%s\" >nul 2>&1\r\n"+
			"if errorlevel 1 (\r\n"+
			"  timeout /t 1 /nobreak >nul\r\n"+
			"  goto loop\r\n"+
			")\r\n"+
			"sc start NexusOpsAgent >nul 2>&1\r\n"+
			"del \"%%~f0\" >nul 2>&1\r\n",
		newPath, exe,
	)
	if err := os.WriteFile(bat, []byte(content), 0o755); err != nil { return err }
	cmd := exec.Command("cmd", "/C", "start", "/B", bat)
	return cmd.Start()
}

// spawnUnix swaps in-place + re-execs (useful for dev/test/macos/linux).
func spawnUnix(exe, newPath, dir string) error {
	sh := filepath.Join(dir, "_update.sh")
	content := fmt.Sprintf("#!/bin/sh\nsleep 2\nmv -f '%s' '%s'\nchmod +x '%s'\nnohup '%s' -run foreground > /tmp/nexus-agent.log 2>&1 &\nrm -- \"$0\"\n",
		newPath, exe, exe, exe)
	if err := os.WriteFile(sh, []byte(content), 0o755); err != nil { return err }
	return exec.Command("/bin/sh", sh).Start()
}
