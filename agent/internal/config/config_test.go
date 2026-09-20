package config

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
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
	cfg := &Config{
		configPath: filepath.Join(dir, "config.json"),
		PlatformPolicy: &PlatformPolicy{NativeRemote: map[string]any{
			"enabled":          true,
			"companion_sha256": fmt.Sprintf("%x", digest),
		}},
	}
	if !cfg.NativeRemoteCompanionReady() {
		t.Fatal("matching policy-pinned companion should be eligible")
	}
	cfg.PlatformPolicy.NativeRemote["companion_sha256"] = "0000000000000000000000000000000000000000000000000000000000000000"
	if cfg.NativeRemoteCompanionReady() {
		t.Fatal("mismatched companion digest must fail closed")
	}
}
