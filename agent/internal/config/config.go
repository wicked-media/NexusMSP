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
	ServerURL       string             `json:"server_url"`
	EnrollmentToken string             `json:"enrollment_token,omitempty"`
	ClientID        string             `json:"client_id"`
	ClientName      string             `json:"client_name"`
	DeviceID        string             `json:"device_id,omitempty"`
	AgentToken      string             `json:"agent_token,omitempty"`
	HeartbeatSecs   int                `json:"heartbeat_secs,omitempty"`
	PollSecs        int                `json:"poll_secs,omitempty"`
	NexusShield     *NexusShieldConfig `json:"nexus_shield,omitempty"`

	// Computed
	configPath string `json:"-"`
}

// NexusShieldConfig is intentionally small and declarative. The service only
// performs collection and Canary integrity monitoring; it does not turn on
// destructive endpoint enforcement simply because the feature is installed.
type NexusShieldConfig struct {
	Enabled          bool `json:"enabled"`
	PostureTelemetry bool `json:"posture_telemetry"`
	CanaryEnabled    bool `json:"canary_enabled"`
	CanaryCheckSecs  int  `json:"canary_check_secs"`
	AutoDeployCanary bool `json:"auto_deploy_canary"`
}

// LoadOrInit reads config.json next to the executable, or returns a sensible default.
// If `explicit` is set, uses that path.
func LoadOrInit(explicit string) (*Config, error) {
	path := explicit
	if path == "" {
		exe, err := os.Executable()
		if err != nil {
			return nil, fmt.Errorf("locate executable: %w", err)
		}
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
	if cfg.HeartbeatSecs == 0 {
		cfg.HeartbeatSecs = 60
	}
	if cfg.PollSecs == 0 {
		cfg.PollSecs = 10
	}
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
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, c.configPath)
}

// ShieldCanaryEnabled remains true for older agent configurations so an
// existing Canary deployment is never silently disabled during an upgrade.
func (c *Config) ShieldCanaryEnabled() bool {
	return c.NexusShield == nil || (c.NexusShield.Enabled && c.NexusShield.CanaryEnabled)
}

func (c *Config) ShieldCanaryInterval() int {
	if c.NexusShield == nil || c.NexusShield.CanaryCheckSecs <= 0 {
		return 30
	}
	if c.NexusShield.CanaryCheckSecs < 15 {
		return 15
	}
	return c.NexusShield.CanaryCheckSecs
}

func (c *Config) ShieldCapabilities() []string {
	if c.NexusShield == nil {
		return []string{"nexus_shield", "endpoint_posture", "nexus_canary"}
	}
	capabilities := []string{"nexus_shield"}
	if c.NexusShield.PostureTelemetry {
		capabilities = append(capabilities, "endpoint_posture")
	}
	if c.ShieldCanaryEnabled() {
		capabilities = append(capabilities, "nexus_canary")
	}
	return capabilities
}
