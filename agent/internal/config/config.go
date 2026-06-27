// Package config handles agent configuration loading and persistence.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	ServerURL       string `json:"server_url"`
	EnrollmentToken string `json:"enrollment_token,omitempty"`
	ClientID        string `json:"client_id"`
	ClientName      string `json:"client_name"`
	DeviceID        string `json:"device_id,omitempty"`
	AgentToken      string `json:"agent_token,omitempty"`
	HeartbeatSecs   int    `json:"heartbeat_secs,omitempty"`
	PollSecs        int    `json:"poll_secs,omitempty"`

	// Computed
	configPath string `json:"-"`
}

// LoadOrInit reads config.json next to the executable, or returns a sensible default.
// If `explicit` is set, uses that path.
func LoadOrInit(explicit string) (*Config, error) {
	path := explicit
	if path == "" {
		exe, err := os.Executable()
		if err != nil { return nil, fmt.Errorf("locate executable: %w", err) }
		path = filepath.Join(filepath.Dir(exe), "config.json")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("read %s: %w", path, err)
		}
		// Allow first-boot with empty config (user can paste config.json later)
		return &Config{configPath: path, HeartbeatSecs: 60, PollSecs: 10}, nil
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	cfg.configPath = path
	if cfg.HeartbeatSecs == 0 { cfg.HeartbeatSecs = 60 }
	if cfg.PollSecs == 0      { cfg.PollSecs = 10 }
	if cfg.ServerURL == "" {
		return nil, fmt.Errorf("config %s missing server_url", path)
	}
	return &cfg, nil
}

// Save persists the current config back to disk (atomic write).
func Save(c *Config) error {
	if c.configPath == "" {
		return errors.New("config path not set")
	}
	tmp := c.configPath + ".tmp"
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil { return err }
	if err := os.WriteFile(tmp, data, 0o600); err != nil { return err }
	return os.Rename(tmp, c.configPath)
}
