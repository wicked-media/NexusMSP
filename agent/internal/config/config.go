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
	InstallID       string             `json:"install_id,omitempty"`
	HeartbeatSecs   int                `json:"heartbeat_secs,omitempty"`
	PollSecs        int                `json:"poll_secs,omitempty"`
	NexusShield     *NexusShieldConfig `json:"nexus_shield,omitempty"`
	NexusDNS        *NexusDNSConfig    `json:"nexus_dns,omitempty"`
	DeviceIdentity  *DeviceIdentity    `json:"device_identity,omitempty"`
	PlatformPolicy  *PlatformPolicy    `json:"platform_policy,omitempty"`
	UpdateEvidence  *UpdateEvidence    `json:"update_evidence,omitempty"`

	// Computed
	configPath string `json:"-"`
}

type DeviceIdentity struct {
	Status                 string `json:"status,omitempty"`
	CertificatePath        string `json:"certificate_path,omitempty"`
	PrivateKeyPath         string `json:"private_key_path,omitempty"`
	CACertificatePath      string `json:"ca_certificate_path,omitempty"`
	CertificateFingerprint string `json:"certificate_fingerprint,omitempty"`
	CertificateExpiresAt   string `json:"certificate_expires_at,omitempty"`
	SPIFFEID               string `json:"spiffe_id,omitempty"`
	PublicKeyFingerprint   string `json:"public_key_fingerprint,omitempty"`
}

type PlatformPolicy struct {
	SchemaVersion  int             `json:"schema_version,omitempty"`
	Version        string          `json:"version,omitempty"`
	ChecksumSHA256 string          `json:"checksum_sha256,omitempty"`
	IssuedAt       string          `json:"issued_at,omitempty"`
	HeartbeatSecs  int             `json:"heartbeat_secs,omitempty"`
	PollSecs       int             `json:"poll_secs,omitempty"`
	Modules        map[string]bool `json:"modules,omitempty"`
	Updates        map[string]any  `json:"updates,omitempty"`
	Commands       map[string]any  `json:"commands,omitempty"`
	SelfRepair     map[string]any  `json:"self_repair,omitempty"`
	DNS            map[string]any  `json:"dns,omitempty"`
}

type UpdateEvidence struct {
	Version           string `json:"version,omitempty"`
	SHA256            string `json:"sha256,omitempty"`
	SignatureVerified bool   `json:"signature_verified"`
	Status            string `json:"status,omitempty"`
	CheckedAt         string `json:"checked_at,omitempty"`
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

// NexusDNSConfig is a control-plane profile, not an enforcement engine.
// Visibility is safe to install everywhere. Resolver changes are made only by
// a separately approved deployment after a trusted edge is attested healthy.
type NexusDNSConfig struct {
	Enabled                    bool     `json:"enabled"`
	Mode                       string   `json:"mode"`
	Transport                  string   `json:"transport"`
	ResolverEndpoints          []string `json:"resolver_endpoints,omitempty"`
	BypassDetection            bool     `json:"bypass_detection"`
	LocalPolicyCache           bool     `json:"local_policy_cache"`
	RestorePreviousDNSOnRemove bool     `json:"restore_previous_dns_on_remove"`
	EnforcementReady           bool     `json:"enforcement_ready"`
	Enrolled                   bool     `json:"enrolled,omitempty"`
	DeploymentID               string   `json:"deployment_id,omitempty"`
	Status                     string   `json:"status,omitempty"`
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

func (c *Config) BaseDir() string {
	if c.configPath != "" {
		return filepath.Dir(c.configPath)
	}
	return "."
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
	var capabilities []string
	if c.NexusShield == nil {
		capabilities = []string{"nexus_shield", "endpoint_posture", "nexus_canary"}
	} else {
		capabilities = []string{"nexus_shield"}
		if c.NexusShield.PostureTelemetry {
			capabilities = append(capabilities, "endpoint_posture")
		}
		if c.ShieldCanaryEnabled() {
			capabilities = append(capabilities, "nexus_canary")
		}
	}
	if c.NexusDNS == nil || c.NexusDNS.Enabled {
		capabilities = append(capabilities, "nexus_dns", "dns_visibility", "dns_policy_cache")
	}
	return capabilities
}
