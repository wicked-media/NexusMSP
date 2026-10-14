package config

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestValidateServerURL(t *testing.T) {
	tests := []struct {
		name  string
		value string
		valid bool
	}{
		{name: "https production", value: "https://nexus.example.test/api", valid: true},
		{name: "localhost development", value: "http://localhost:8000", valid: true},
		{name: "ipv4 loopback development", value: "http://127.0.0.1:8000", valid: true},
		{name: "ipv6 loopback development", value: "http://[::1]:8000", valid: true},
		{name: "cleartext remote", value: "http://nexus.example.test", valid: false},
		{name: "wrong scheme", value: "ftp://nexus.example.test", valid: false},
		{name: "credentials", value: "https://user:password@nexus.example.test", valid: false},
		{name: "fragment", value: "https://nexus.example.test/#fragment", valid: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateServerURL(test.value)
			if test.valid && err != nil {
				t.Fatalf("expected URL to be valid: %v", err)
			}
			if !test.valid && err == nil {
				t.Fatal("expected URL to be rejected")
			}
		})
	}
}
func TestShieldCapabilitiesDoNotClaimDisabledShield(t *testing.T) {
	cfg := &Config{NexusShield: &NexusShieldConfig{Enabled: false}, NexusDNS: &NexusDNSConfig{Enabled: false}}
	for _, capability := range cfg.ShieldCapabilities() {
		if capability == "nexus_shield" || capability == "endpoint_posture" || capability == "nexus_canary" {
			t.Fatalf("disabled Shield must not advertise %q", capability)
		}
	}
}

func TestApplyPlatformPolicyClampsCadence(t *testing.T) {
	cfg := &Config{HeartbeatSecs: 60, PollSecs: 10}
	cfg.ApplyPlatformPolicy(&PlatformPolicy{HeartbeatSecs: 1, PollSecs: 999})
	if cfg.HeartbeatSecs != 15 || cfg.PollSecs != 300 {
		t.Fatalf("unexpected policy cadence: heartbeat=%d poll=%d", cfg.HeartbeatSecs, cfg.PollSecs)
	}
}

func TestNativeRemoteCompanionReadyRequiresPinnedDigest(t *testing.T) {
	dir := t.TempDir()
	payload := []byte("trusted remote companion")
	if err := os.WriteFile(filepath.Join(dir, "nexus-remote-companion.exe"), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	agentPayload := []byte("trusted nexus agent")
	if err := os.WriteFile(filepath.Join(dir, "nexus-agent.exe"), agentPayload, 0o600); err != nil {
		t.Fatal(err)
	}
	agentDigest := sha256.Sum256(agentPayload)
	cfg := &Config{
		configPath: filepath.Join(dir, "config.json"),
		PlatformPolicy: &PlatformPolicy{NativeRemote: map[string]any{
			"enabled":              true,
			"companion_sha256":     fmt.Sprintf("%x", digest),
			"agent_release_sha256": fmt.Sprintf("%x", agentDigest),
		}},
	}
	if !cfg.NativeRemoteCompanionReady() {
		t.Fatal("matching policy-pinned companion should be eligible")
	}
	cfg.PlatformPolicy.NativeRemote["companion_sha256"] = "0000000000000000000000000000000000000000000000000000000000000000"
	if cfg.NativeRemoteCompanionReady() {
		t.Fatal("mismatched companion digest must fail closed")
	}
	cfg.PlatformPolicy.NativeRemote["companion_sha256"] = fmt.Sprintf("%x", digest)
	cfg.PlatformPolicy.NativeRemote["agent_release_sha256"] = "0000000000000000000000000000000000000000000000000000000000000000"
	if cfg.NativeRemoteCompanionReady() {
		t.Fatal("mismatched agent release digest must fail closed")
	}
}

func TestRuntimeCapabilitiesAdvertiseNativeRemoteOnlyForPinnedCompanion(t *testing.T) {
	dir := t.TempDir()
	cfg := &Config{
		configPath: filepath.Join(dir, "config.json"),
		PlatformPolicy: &PlatformPolicy{NativeRemote: map[string]any{
			"enabled":              true,
			"companion_sha256":     "0000000000000000000000000000000000000000000000000000000000000000",
			"agent_release_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
		}},
	}
	for _, capability := range cfg.RuntimeCapabilities() {
		if capability == "native_remote_v1" || capability == "native_remote_v2" {
			t.Fatalf("missing companion must not advertise %q", capability)
		}
	}
	payload := []byte("pinned remote companion")
	if err := os.WriteFile(filepath.Join(dir, "nexus-remote-companion.exe"), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	agentPayload := []byte("pinned nexus agent")
	if err := os.WriteFile(filepath.Join(dir, "nexus-agent.exe"), agentPayload, 0o600); err != nil {
		t.Fatal(err)
	}
	agentDigest := sha256.Sum256(agentPayload)
	cfg.PlatformPolicy.NativeRemote["companion_sha256"] = fmt.Sprintf("%x", digest)
	cfg.PlatformPolicy.NativeRemote["agent_release_sha256"] = fmt.Sprintf("%x", agentDigest)
	if runtime.GOOS != "windows" {
		// Native remote is a Windows-only capability. The policy gate must
		// recognise the pinned pair on every platform, but only a Windows
		// agent may advertise a capability it can actually deliver.
		if !cfg.NativeRemoteCompanionReady() {
			t.Fatal("pinned companion pair must satisfy the native remote policy gate")
		}
		for _, capability := range cfg.RuntimeCapabilities() {
			if capability == "native_remote_v1" || capability == "native_remote_v2" {
				t.Fatalf("non-windows agent must not advertise %q", capability)
			}
		}
		return
	}
	capabilities := cfg.RuntimeCapabilities()
	foundV1, foundV2 := false, false
	for _, capability := range capabilities {
		foundV1 = foundV1 || capability == "native_remote_v1"
		foundV2 = foundV2 || capability == "native_remote_v2"
	}
	if !foundV1 || !foundV2 {
		t.Fatalf("pinned companion must advertise the native remote capabilities: %v", capabilities)
	}
}

func TestNexusBackupCapabilityInventoryFailsClosed(t *testing.T) {
	cfg := &Config{PlatformPolicy: &PlatformPolicy{NexusBackup: &NexusBackupPolicy{
		SchemaVersion:     1,
		Enabled:           true,
		Mode:              "capability_inventory",
		PreflightAllowed:  true,
		ExecutionAllowed:  false,
		FileAccessAllowed: false,
		SnapshotAllowed:   false,
		UploadAllowed:     false,
		RestoreAllowed:    false,
	}}}
	if runtime.GOOS == "windows" && !cfg.NexusBackupCapabilityInventoryEnabled() {
		t.Fatal("safe Windows capability-inventory policy should be accepted")
	}
	if runtime.GOOS == "windows" && !cfg.NexusBackupPreflightEnabled() {
		t.Fatal("safe Windows capability preflight policy should be accepted")
	}
	cfg.PlatformPolicy.NexusBackup.UploadAllowed = true
	if cfg.NexusBackupCapabilityInventoryEnabled() {
		t.Fatal("backup policy that grants upload must fail closed")
	}
}
