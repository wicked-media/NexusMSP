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
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
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
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Info describes the update advertised by the server.
type Info struct {
	Version            string `json:"version"`
	URL                string `json:"url"`
	SHA256             string `json:"sha256"`
	Size               int64  `json:"size"`
	SignatureAlgorithm string `json:"signature_algorithm"`
	Signature          string `json:"signature"`
	SigningPublicKey   string `json:"signing_public_key"`
	SignedPayload      string `json:"signed_payload"`
}

var inProgress atomic.Bool

// ShouldApplyVersion prevents a stale control-plane process from silently
// downgrading an endpoint. Deliberate rollback needs a separate signed,
// approval-bound protocol rather than reusing the normal update path.
func ShouldApplyVersion(currentVersion, targetVersion string) (bool, string) {
	current, currentOK := versionTriplet(currentVersion)
	target, targetOK := versionTriplet(targetVersion)
	if !currentOK || !targetOK {
		return false, "unparseable version"
	}
	for index := range current {
		if target[index] > current[index] {
			return true, "newer version"
		}
		if target[index] < current[index] {
			return false, "downgrade rejected"
		}
	}
	return false, "same version"
}

func versionTriplet(version string) ([3]int, bool) {
	var parsed [3]int
	core := strings.SplitN(strings.TrimPrefix(strings.TrimSpace(version), "v"), "-", 2)[0]
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return parsed, false
	}
	for index, part := range parts {
		value, err := strconv.Atoi(part)
		if err != nil || value < 0 {
			return parsed, false
		}
		parsed[index] = value
	}
	return parsed, true
}

// Apply downloads + verifies + swaps the binary, then exits.
// `serverBase` is the base URL of the server (e.g. https://nexusops.example.com).
// `currentVersion` is the running agent's compiled-in Version.
// `token` is the agent's X-Agent-Token (for authenticated download).
func Apply(info Info, serverBase, currentVersion, token, pinnedSigningPublicKey string) error {
	if !inProgress.CompareAndSwap(false, true) {
		return errors.New("update already in progress")
	}
	defer inProgress.Store(false)

	if info.Version == "" || info.URL == "" || info.SHA256 == "" {
		return errors.New("update advert missing fields")
	}
	if shouldApply, reason := ShouldApplyVersion(currentVersion, info.Version); !shouldApply {
		return fmt.Errorf("refusing update from %s to %s: %s", currentVersion, info.Version, reason)
	}
	if err := VerifyManifestWithKey(info, pinnedSigningPublicKey); err != nil {
		return fmt.Errorf("update signature: %w", err)
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate exe: %w", err)
	}
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
	if info.Size > 0 {
		stat, statErr := os.Stat(newPath)
		if statErr != nil {
			_ = os.Remove(newPath)
			return fmt.Errorf("size check: %w", statErr)
		}
		if stat.Size() != info.Size {
			_ = os.Remove(newPath)
			return fmt.Errorf("size mismatch: want %d got %d", info.Size, stat.Size())
		}
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

// VerifyManifestWithKey rejects a correctly signed manifest when its key does
// not match the trust anchor already cached in Nexus platform policy.
func VerifyManifestWithKey(info Info, pinnedSigningPublicKey string) error {
	if !strings.EqualFold(info.SignatureAlgorithm, "ed25519") {
		return errors.New("unsupported or missing signature algorithm")
	}
	if pinnedSigningPublicKey == "" {
		return errors.New("update signing trust anchor is unavailable")
	}
	if info.SigningPublicKey != pinnedSigningPublicKey {
		return errors.New("update signing key does not match pinned policy")
	}
	publicKey, err := base64.StdEncoding.DecodeString(strings.TrimSpace(info.SigningPublicKey))
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return errors.New("invalid update signing public key")
	}
	signature, err := base64.StdEncoding.DecodeString(strings.TrimSpace(info.Signature))
	if err != nil || len(signature) != ed25519.SignatureSize {
		return errors.New("invalid update signature")
	}
	expectedPayload := fmt.Sprintf("%s|%s|%d", info.Version, strings.ToLower(info.SHA256), info.Size)
	if info.SignedPayload != "" && info.SignedPayload != expectedPayload {
		return errors.New("signed payload does not match update manifest")
	}
	if !ed25519.Verify(ed25519.PublicKey(publicKey), []byte(expectedPayload), signature) {
		return errors.New("manifest signature verification failed")
	}
	return nil
}

func download(url, dst, token string) error {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	if token != "" {
		req.Header.Set("X-Agent-Token", token)
	}
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}

func fileSha256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
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
	logPath := filepath.Join(dir, "_update.log")
	backupPath := exe + ".pre-update"
	content := fmt.Sprintf(
		"@echo off\r\n"+
			"setlocal\r\n"+
			"set \"LOG=%s\"\r\n"+
			"echo [%%date%% %%time%%] Nexus Agent update started>\"%%LOG%%\"\r\n"+
			"timeout /t 2 /nobreak >nul\r\n"+
			"sc stop NexusOpsAgent >>\"%%LOG%%\" 2>&1\r\n"+
			"timeout /t 3 /nobreak >nul\r\n"+
			"copy /Y \"%s\" \"%s\" >>\"%%LOG%%\" 2>&1\r\n"+
			"set /a tries=0\r\n"+
			":loop\r\n"+
			"set /a tries+=1\r\n"+
			"move /Y \"%s\" \"%s\" >>\"%%LOG%%\" 2>&1\r\n"+
			"if errorlevel 1 (\r\n"+
			"  if %%tries%% GEQ 30 goto swap_failed\r\n"+
			"  timeout /t 1 /nobreak >nul\r\n"+
			"  goto loop\r\n"+
			")\r\n"+
			"sc start NexusOpsAgent >>\"%%LOG%%\" 2>&1\r\n"+
			"timeout /t 8 /nobreak >nul\r\n"+
			"sc query NexusOpsAgent | find \"RUNNING\" >nul\r\n"+
			"if errorlevel 1 goto health_failed\r\n"+
			"echo [%%date%% %%time%%] Update healthy>>\"%%LOG%%\"\r\n"+
			"del /Q \"%s\" >nul 2>&1\r\n"+
			"goto done\r\n"+
			":health_failed\r\n"+
			"echo [%%date%% %%time%%] New service failed health check; rolling back>>\"%%LOG%%\"\r\n"+
			"sc stop NexusOpsAgent >>\"%%LOG%%\" 2>&1\r\n"+
			"timeout /t 3 /nobreak >nul\r\n"+
			"move /Y \"%s\" \"%s\" >>\"%%LOG%%\" 2>&1\r\n"+
			"sc start NexusOpsAgent >>\"%%LOG%%\" 2>&1\r\n"+
			"goto done\r\n"+
			":swap_failed\r\n"+
			"echo [%%date%% %%time%%] Binary swap failed; restarting existing service>>\"%%LOG%%\"\r\n"+
			"sc start NexusOpsAgent >>\"%%LOG%%\" 2>&1\r\n"+
			":done\r\n"+
			"endlocal\r\n"+
			"del \"%%~f0\" >nul 2>&1\r\n",
		logPath, exe, backupPath, newPath, exe, backupPath, backupPath, exe,
	)
	if err := os.WriteFile(bat, []byte(content), 0o755); err != nil {
		return err
	}
	// `start` treats its first quoted argument as a window title. Supplying the
	// explicit empty title is essential when the batch path contains spaces.
	commandLine := fmt.Sprintf("start \"\" /B cmd /D /C call \"%s\"", bat)
	cmd := exec.Command("cmd", "/D", "/C", commandLine)
	return cmd.Start()
}

// spawnUnix swaps in-place + re-execs (useful for dev/test/macos/linux).
func spawnUnix(exe, newPath, dir string) error {
	sh := filepath.Join(dir, "_update.sh")
	content := fmt.Sprintf("#!/bin/sh\nsleep 2\nmv -f '%s' '%s'\nchmod +x '%s'\nnohup '%s' -run foreground > /tmp/nexus-agent.log 2>&1 &\nrm -- \"$0\"\n",
		newPath, exe, exe, exe)
	if err := os.WriteFile(sh, []byte(content), 0o755); err != nil {
		return err
	}
	return exec.Command("/bin/sh", sh).Start()
}
