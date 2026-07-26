package updater

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
)

func TestVerifyManifest(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	info := Info{
		Version:            "0.1.7-nexus-identity",
		SHA256:             "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		Size:               1024,
		SignatureAlgorithm: "ed25519",
		SigningPublicKey:   base64.StdEncoding.EncodeToString(publicKey),
	}
	info.SignedPayload = info.Version + "|" + info.SHA256 + "|1024"
	info.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, []byte(info.SignedPayload)))
	if err := VerifyManifest(info); err != nil {
		t.Fatalf("valid manifest rejected: %v", err)
	}
	info.Size++
	if err := VerifyManifest(info); err == nil {
		t.Fatal("tampered manifest was accepted")
	}
}
