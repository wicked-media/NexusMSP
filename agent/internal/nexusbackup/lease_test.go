package nexusbackup

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
	"time"

	"nexusagent/internal/config"
)

func signedLease(t *testing.T) (*config.Config, CaptureLease) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	lease := CaptureLease{SchemaVersion: 1, LeaseID: "lease-1", TenantID: "tenant-1", ClientID: "client-1", DeviceID: "device-1", JobID: "job-1", CaptureID: "capture-1", SourceProfile: "user_data", IssuedAt: now.Add(-time.Minute).Format(time.RFC3339), ExpiresAt: now.Add(5 * time.Minute).Format(time.RFC3339), Nonce: "nonce-1", SignatureAlg: "ed25519", SigningPublicKey: base64.StdEncoding.EncodeToString(publicKey), SigningKeyID: "test-key"}
	lease.SignedPayload = lease.canonicalPayload()
	lease.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, []byte(lease.SignedPayload)))
	cfg := &config.Config{ClientID: "client-1", DeviceID: "device-1", PlatformPolicy: &config.PlatformPolicy{NexusBackup: &config.NexusBackupPolicy{CaptureLease: map[string]any{"signing_public_key": lease.SigningPublicKey, "signing_key_id": "test-key"}}}}
	return cfg, lease
}

func TestVerifyCaptureLeaseAcceptsPinnedScopedLease(t *testing.T) {
	cfg, lease := signedLease(t)
	if err := VerifyCaptureLease(cfg, lease, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyCaptureLeaseRejectsEndpointMismatch(t *testing.T) {
	cfg, lease := signedLease(t)
	lease.DeviceID = "another-device"
	if err := VerifyCaptureLease(cfg, lease, time.Now().UTC()); err == nil {
		t.Fatal("wrong device must be rejected")
	}
}
