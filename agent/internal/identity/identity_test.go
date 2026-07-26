package identity

import (
	"os"
	"path/filepath"
	"testing"

	"nexusagent/internal/config"
)

func TestEnsureGeneratesStableDeviceIdentity(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(configPath, []byte(`{"server_url":"https://nexus.example","client_id":"client-1"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.LoadOrInit(configPath)
	if err != nil {
		t.Fatal(err)
	}
	firstCSR, firstFingerprint, err := Ensure(cfg)
	if err != nil {
		t.Fatal(err)
	}
	firstInstallID := cfg.InstallID
	secondCSR, secondFingerprint, err := Ensure(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if firstCSR == "" || secondCSR == "" {
		t.Fatal("CSR was empty")
	}
	if firstInstallID == "" || cfg.InstallID != firstInstallID {
		t.Fatal("install identity was not stable")
	}
	if firstFingerprint == "" || secondFingerprint != firstFingerprint {
		t.Fatal("device public key was not stable")
	}
	if _, err := os.Stat(cfg.DeviceIdentity.PrivateKeyPath); err != nil {
		t.Fatalf("device private key was not persisted: %v", err)
	}
}
