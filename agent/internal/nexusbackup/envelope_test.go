package nexusbackup

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"testing"

	"nexusagent/internal/config"
)

func TestWrapDataKeyForServerUsesPinnedPublicKey(t *testing.T) {
	private, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	public, err := x509.MarshalPKIXPublicKey(&private.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{PlatformPolicy: &config.PlatformPolicy{NexusBackup: &config.NexusBackupPolicy{EnvelopeKey: map[string]any{
		"algorithm": "rsa-oaep-sha256", "key_id": "key-1", "public_key_pem": string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: public})),
	}}}}
	dataKey := make([]byte, DataKeyBytes)
	if _, err := rand.Read(dataKey); err != nil {
		t.Fatal(err)
	}
	wrapped, keyID, err := WrapDataKeyForServer(cfg, dataKey)
	if err != nil {
		t.Fatal(err)
	}
	if keyID != "key-1" {
		t.Fatalf("unexpected key id %q", keyID)
	}
	raw, err := base64.StdEncoding.DecodeString(wrapped)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, private, raw, nil)
	if err != nil || string(plain) != string(dataKey) {
		t.Fatalf("wrapped key did not round-trip: %v", err)
	}
}
