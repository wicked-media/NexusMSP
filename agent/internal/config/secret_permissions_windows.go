//go:build windows

package config

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// securePersistedConfig protects enrollment and Agent tokens after the default
// Program Files install. The user-session companions use the local service
// broker and never need to read this file.
func securePersistedConfig(path string) error {
	programFiles := strings.TrimSpace(os.Getenv("ProgramFiles"))
	if programFiles == "" {
		return nil
	}
	relative, err := filepath.Rel(filepath.Clean(programFiles), filepath.Clean(path))
	if err != nil || relative == "." || strings.HasPrefix(relative, "..") {
		return nil
	}
	out, err := exec.Command(
		"icacls", path,
		"/inheritance:r",
		"/grant:r", "*S-1-5-18:(F)", "*S-1-5-32-544:(F)",
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("restrict protected agent config: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
