// Package config handles agent configuration loading and persistence.
package config

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
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
	SelfHeal        *SelfHealConfig    `json:"self_heal,omitempty"`

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
	SchemaVersion  int                `json:"schema_version,omitempty"`
	Version        string             `json:"version,omitempty"`
	ChecksumSHA256 string             `json:"checksum_sha256,omitempty"`
	IssuedAt       string             `json:"issued_at,omitempty"`
	HeartbeatSecs  int                `json:"heartbeat_secs,omitempty"`
	PollSecs       int                `json:"poll_secs,omitempty"`
	Modules        map[string]bool    `json:"modules,omitempty"`
	Updates        map[string]any     `json:"updates,omitempty"`
	Commands       map[string]any     `json:"commands,omitempty"`
	SelfRepair     map[string]any     `json:"self_repair,omitempty"`
	SelfHeal       map[string]any     `json:"self_heal,omitempty"`
	Winget         map[string]any     `json:"winget,omitempty"`
	DNS            map[string]any     `json:"dns,omitempty"`
	NativeRemote   map[string]any     `json:"native_remote,omitempty"`
	NexusBackup    *NexusBackupPolicy `json:"nexus_backup,omitempty"`
}

// NexusBackupPolicy is intentionally capability-inventory only in the first
// native Backup release. It cannot grant endpoint file access, snapshots,
// uploads, or restore work merely because a technician enables a policy.
type NexusBackupPolicy struct {
	SchemaVersion         int            `json:"schema_version,omitempty"`
	Enabled               bool           `json:"enabled"`
	Mode                  string         `json:"mode,omitempty"`
	ReportIntervalSeconds int            `json:"report_interval_seconds,omitempty"`
	PreflightAllowed      bool           `json:"preflight_allowed"`
	CaptureLease          map[string]any `json:"capture_lease,omitempty"`
	EnvelopeKey           map[string]any `json:"envelope_key,omitempty"`
	ExecutionAllowed      bool           `json:"execution_allowed"`
	FileAccessAllowed     bool           `json:"file_access_allowed"`
	SnapshotAllowed       bool           `json:"snapshot_allowed"`
	UploadAllowed         bool           `json:"upload_allowed"`
	RestoreAllowed        bool           `json:"restore_allowed"`
}

type UpdateEvidence struct {
	Version           string `json:"version,omitempty"`
	SHA256            string `json:"sha256,omitempty"`
	SignatureVerified bool   `json:"signature_verified"`
	Status            string `json:"status,omitempty"`
	CheckedAt         string `json:"checked_at,omitempty"`
}

// SelfHealConfig is the installer-side fallback for the self-healing loop. A
// signed platform policy always wins over these values, so an operator can only
// tighten behaviour locally; the control plane decides what the fleet may do.
// Windows repair stays fail-closed: it is off unless a policy or this file says
// otherwise, because it modifies the customer's Windows image.
type SelfHealConfig struct {
	Enabled       *bool                `json:"enabled,omitempty"`
	WindowsRepair *WindowsRepairConfig `json:"windows_repair,omitempty"`
}

type WindowsRepairConfig struct {
	Enabled             *bool              `json:"enabled,omitempty"`
	MaxRunsPerDay       int                `json:"max_runs_per_day,omitempty"`
	MaintenanceWindow   *MaintenanceWindow `json:"maintenance_window,omitempty"`
	AllowServiceRestart *bool              `json:"allow_service_restart,omitempty"`
}

// MaintenanceWindow keeps an hours-long DISM run out of the customer's working
// day. Enforce is explicit: an unenforced window exists only as documentation.
type MaintenanceWindow struct {
	StartHour int  `json:"start_hour"`
	EndHour   int  `json:"end_hour"`
	Enforce   bool `json:"enforce"`
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
	if err := ValidateServerURL(cfg.ServerURL); err != nil {
		return nil, fmt.Errorf("config %s has invalid server_url: %w", path, err)
	}
	return &cfg, nil
}

// ValidateServerURL keeps agent credentials off cleartext networks. HTTPS is
// required for any deployed endpoint; HTTP is accepted only for explicit
// loopback development on the same machine.
func ValidateServerURL(raw string) error {
	value := strings.TrimSpace(raw)
	if value == "" {
		return errors.New("server_url is required")
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("server_url must be an absolute http(s) URL")
	}
	if parsed.User != nil {
		return errors.New("server_url must not contain user credentials")
	}
	if parsed.Fragment != "" {
		return errors.New("server_url must not contain a fragment")
	}
	switch strings.ToLower(parsed.Scheme) {
	case "https":
		return nil
	case "http":
		if isLoopbackHost(parsed.Hostname()) {
			return nil
		}
		return errors.New("server_url must use https outside local loopback development")
	default:
		return errors.New("server_url must use http or https")
	}
}

func isLoopbackHost(host string) bool {
	clean := strings.Trim(strings.TrimSpace(host), "[]")
	if strings.EqualFold(clean, "localhost") {
		return true
	}
	if address := net.ParseIP(clean); address != nil {
		return address.IsLoopback()
	}
	return false
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
	if err := securePersistedConfig(tmp); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, c.configPath); err != nil {
		return err
	}
	return securePersistedConfig(c.configPath)
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
	} else if c.NexusShield.Enabled {
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

// RuntimeCapabilities describes what the installed binary can actually do,
// independent of whether a customer has enabled or licensed a corresponding
// Nexus module. This deliberately avoids claiming DNS enforcement, remote
// desktop, or any other capability that this agent binary does not implement.
func (c *Config) RuntimeCapabilities() []string {
	capabilities := []string{
		"system_inventory",
		"signed_command_envelopes",
		"command_replay_protection",
		"device_identity",
		"signed_agent_updates",
		"update_health_rollback",
		"policy_cache",
		"self_repair",
	}
	if runtime.GOOS == "windows" {
		capabilities = append(capabilities,
			"windows_service",
			"windows_security_posture",
			"windows_update_inventory",
			"hardware_inventory",
			"software_inventory",
			"network_inventory",
			"nexus_canary",
			"approved_elevation_launch",
			// The binary can watch its own performance and run the inbuilt Windows
			// component repair. Whether it *may* is a signed policy decision, so this
			// describes the capability and not a licence.
			"windows_performance_guard",
			"windows_component_repair",
			// winget enumeration and application updates. Reporting what is pending is
			// always allowed; installing is gated by the signed winget policy.
			"windows_app_updates",
		)
		if c.NativeRemoteCompanionReady() {
			capabilities = append(capabilities, "native_remote_v1", "native_remote_v2")
		}
		if c.NexusBackupCapabilityInventoryEnabled() {
			capabilities = append(capabilities, "nexus_backup_capability_v1")
		}
		if c.NexusBackupPreflightEnabled() {
			capabilities = append(capabilities, "nexus_backup_preflight_v1")
		}
	}
	return capabilities
}

// policySelfHealBool reads one key from the signed self_heal policy block. The
// second return value reports whether the policy actually carried the key, which
// is what lets the signed policy take precedence without a zero value silently
// meaning "disabled".
func (c *Config) policySelfHealBool(key string) (bool, bool) {
	if c == nil || c.PlatformPolicy == nil || c.PlatformPolicy.SelfHeal == nil {
		return false, false
	}
	value, ok := c.PlatformPolicy.SelfHeal[key].(bool)
	return value, ok
}

func (c *Config) policySelfHealInt(key string) (int, bool) {
	if c == nil || c.PlatformPolicy == nil || c.PlatformPolicy.SelfHeal == nil {
		return 0, false
	}
	switch value := c.PlatformPolicy.SelfHeal[key].(type) {
	case float64:
		return int(value), true
	case int:
		return value, true
	case json.Number:
		parsed, err := value.Int64()
		if err == nil {
			return int(parsed), true
		}
	}
	return 0, false
}

func (c *Config) selfHealWindowsRepair() *WindowsRepairConfig {
	if c == nil || c.SelfHeal == nil {
		return nil
	}
	return c.SelfHeal.WindowsRepair
}

// SelfHealActionsEnabled reports whether the agent may act on its own findings.
// Detection and reporting continue either way: an endpoint that has stopped
// phoning home must still say so.
func (c *Config) SelfHealActionsEnabled() bool {
	if value, ok := c.policySelfHealBool("enabled"); ok {
		return value
	}
	if c != nil && c.SelfHeal != nil && c.SelfHeal.Enabled != nil {
		return *c.SelfHeal.Enabled
	}
	return true
}

// SelfHealWindowsRepairEnabled gates the inbuilt DISM and sfc repair. It is
// false unless a signed policy or the installer configuration enables it.
func (c *Config) SelfHealWindowsRepairEnabled() bool {
	if value, ok := c.policySelfHealBool("windows_repair_enabled"); ok {
		return value
	}
	if repair := c.selfHealWindowsRepair(); repair != nil && repair.Enabled != nil {
		return *repair.Enabled
	}
	return false
}

func (c *Config) SelfHealWindowsRepairMaxRunsPerDay() int {
	if value, ok := c.policySelfHealInt("windows_repair_max_runs_per_day"); ok {
		return clamp(value, 1, 7)
	}
	if repair := c.selfHealWindowsRepair(); repair != nil && repair.MaxRunsPerDay > 0 {
		return clamp(repair.MaxRunsPerDay, 1, 7)
	}
	return 1
}

// SelfHealWindowsRepairWindow returns the maintenance window hours and whether
// it is enforced.
func (c *Config) SelfHealWindowsRepairWindow() (int, int, bool) {
	start, hasStart := c.policySelfHealInt("windows_repair_window_start_hour")
	end, hasEnd := c.policySelfHealInt("windows_repair_window_end_hour")
	if hasStart && hasEnd {
		enforce, _ := c.policySelfHealBool("windows_repair_enforce_window")
		return clampHour(start), clampHour(end), enforce
	}
	if repair := c.selfHealWindowsRepair(); repair != nil && repair.MaintenanceWindow != nil {
		window := repair.MaintenanceWindow
		return clampHour(window.StartHour), clampHour(window.EndHour), window.Enforce
	}
	return 0, 0, false
}

// SelfHealWindowAllows reports whether the maintenance window permits a repair
// at this time. Windows that wrap past midnight are supported.
func (c *Config) SelfHealWindowAllows(now time.Time) bool {
	start, end, enforce := c.SelfHealWindowsRepairWindow()
	if !enforce || start == end {
		return true
	}
	hour := now.Hour()
	if start < end {
		return hour >= start && hour < end
	}
	return hour >= start || hour < end
}

// SelfHealAllowServiceRestart gates the most disruptive rung in the ladder.
// Restarting the agent's own service is off unless a deployment asks for it.
func (c *Config) SelfHealAllowServiceRestart() bool {
	if value, ok := c.policySelfHealBool("allow_service_restart"); ok {
		return value
	}
	if repair := c.selfHealWindowsRepair(); repair != nil && repair.AllowServiceRestart != nil {
		return *repair.AllowServiceRestart
	}
	return false
}

func clampHour(value int) int {
	if value < 0 {
		return 0
	}
	if value > 23 {
		return 23
	}
	return value
}

// wingetPolicy reads the signed winget policy block. Like the self-heal block it
// is a nested map, so the keys are read explicitly and an absent key is reported
// as absent rather than as a zero value that silently means "off".
func (c *Config) wingetPolicy() map[string]any {
	if c == nil || c.PlatformPolicy == nil {
		return nil
	}
	return c.PlatformPolicy.Winget
}

func (c *Config) policyWingetBool(key string) (bool, bool) {
	policy := c.wingetPolicy()
	if policy == nil {
		return false, false
	}
	value, ok := policy[key].(bool)
	return value, ok
}

func (c *Config) policyWingetInt(key string) (int, bool) {
	policy := c.wingetPolicy()
	if policy == nil {
		return 0, false
	}
	return policyInt(policy[key])
}

// policyInt accepts every shape a decoded number can arrive in, because the
// policy document is JSON and Go decodes numbers as float64 unless the decoder
// was told otherwise.
func policyInt(raw any) (int, bool) {
	switch value := raw.(type) {
	case float64:
		return int(value), true
	case int:
		return value, true
	case json.Number:
		parsed, err := value.Int64()
		if err == nil {
			return int(parsed), true
		}
	}
	return 0, false
}

// WingetEnabled reports whether this deployment approved application updates at
// all. Reporting what is pending is always allowed; this gates acting on it.
func (c *Config) WingetEnabled() bool {
	if value, ok := c.policyWingetBool("enabled"); ok {
		return value
	}
	return false
}

// WingetAutoUpdateEnabled reports whether an operator pre-approved automatic
// application updates. It is false unless the signed policy says otherwise.
func (c *Config) WingetAutoUpdateEnabled() bool {
	if !c.WingetEnabled() {
		return false
	}
	value, ok := c.policyWingetBool("auto_update_enabled")
	return ok && value
}

// WingetAllowedIDs returns the packages this deployment pre-approved for
// automatic installation. An empty allow-list means none, never all.
func (c *Config) WingetAllowedIDs() []string {
	policy := c.wingetPolicy()
	if policy == nil {
		return nil
	}
	raw, ok := policy["allowed_ids"].([]any)
	if !ok {
		return nil
	}
	allowed := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, isText := item.(string); isText {
			if trimmed := strings.TrimSpace(text); trimmed != "" {
				allowed = append(allowed, trimmed)
			}
		}
		if len(allowed) >= 100 {
			break
		}
	}
	return allowed
}

// WingetAutoUpdateWindow returns the maintenance window for automatic
// application updates and whether it is enforced.
func (c *Config) WingetAutoUpdateWindow() (int, int, bool) {
	start, hasStart := c.policyWingetInt("auto_update_window_start_hour")
	end, hasEnd := c.policyWingetInt("auto_update_window_end_hour")
	if !hasStart || !hasEnd {
		return 0, 0, false
	}
	enforce, _ := c.policyWingetBool("auto_update_enforce_window")
	return clampHour(start), clampHour(end), enforce
}

// WingetAutoUpdateWindowAllows reports whether automatic application updates may
// run now. Windows that wrap past midnight are supported, and an unenforced
// window allows any hour.
func (c *Config) WingetAutoUpdateWindowAllows(now time.Time) bool {
	start, end, enforce := c.WingetAutoUpdateWindow()
	if !enforce || start == end {
		return true
	}
	hour := now.Hour()
	if start < end {
		return hour >= start && hour < end
	}
	return hour >= start || hour < end
}

// NexusBackupPreflightEnabled permits only the dedicated, no-file-access
// worker to report a capability preflight. It is not permission to snapshot,
// read customer data, upload data, or perform a restore.
func (c *Config) NexusBackupPreflightEnabled() bool {
	if !c.NexusBackupCapabilityInventoryEnabled() {
		return false
	}
	if c == nil || c.PlatformPolicy == nil || c.PlatformPolicy.NexusBackup == nil {
		return false
	}
	return c.PlatformPolicy.NexusBackup.PreflightAllowed
}

// NexusBackupCapabilityInventoryEnabled advertises only the non-executing
// inventory contract. Future snapshot, incremental-transfer and restore IDs
// must never appear here until their separately reviewed data plane exists.
func (c *Config) NexusBackupCapabilityInventoryEnabled() bool {
	if c == nil || c.PlatformPolicy == nil || c.PlatformPolicy.NexusBackup == nil || runtime.GOOS != "windows" {
		return false
	}
	p := c.PlatformPolicy.NexusBackup
	return p.SchemaVersion == 1 && p.Enabled && p.Mode == "capability_inventory" &&
		!p.ExecutionAllowed && !p.FileAccessAllowed && !p.SnapshotAllowed && !p.UploadAllowed && !p.RestoreAllowed
}

// NativeRemoteCompanionReady fails closed unless the authenticated policy pins
// the exact installed Remote Companion build. Merely placing an executable in
// the agent directory must never make native remote access available.
func (c *Config) NativeRemoteCompanionReady() bool {
	if c == nil || c.PlatformPolicy == nil || c.PlatformPolicy.NativeRemote == nil {
		return false
	}
	enabled, _ := c.PlatformPolicy.NativeRemote["enabled"].(bool)
	expected, _ := c.PlatformPolicy.NativeRemote["companion_sha256"].(string)
	expected = strings.ToLower(strings.TrimSpace(expected))
	expectedAgent, _ := c.PlatformPolicy.NativeRemote["agent_release_sha256"].(string)
	expectedAgent = strings.ToLower(strings.TrimSpace(expectedAgent))
	if !enabled || len(expected) != sha256.Size*2 || len(expectedAgent) != sha256.Size*2 {
		return false
	}
	return fileSHA256(filepath.Join(c.BaseDir(), "nexus-agent.exe")) == expectedAgent &&
		fileSHA256(filepath.Join(c.BaseDir(), "nexus-remote-companion.exe")) == expected
}

func fileSHA256(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return ""
	}
	return fmt.Sprintf("%x", digest.Sum(nil))
}

// ApplyPlatformPolicy persists the service-controlled cadence alongside the
// signed policy cache. The current process keeps its existing timers; a normal
// service restart adopts any changed cadence without needing a new installer.
func (c *Config) ApplyPlatformPolicy(policy *PlatformPolicy) {
	c.PlatformPolicy = policy
	if policy == nil {
		return
	}
	if policy.HeartbeatSecs > 0 {
		c.HeartbeatSecs = clamp(policy.HeartbeatSecs, 15, 3600)
	}
	if policy.PollSecs > 0 {
		c.PollSecs = clamp(policy.PollSecs, 2, 300)
	}
}

func clamp(value, minimum, maximum int) int {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}
