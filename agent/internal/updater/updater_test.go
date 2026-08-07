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
	pinnedKey := info.SigningPublicKey
	if err := VerifyManifestWithKey(info, pinnedKey); err != nil {
		t.Fatalf("valid manifest rejected: %v", err)
	}
	info.Size++
	if err := VerifyManifestWithKey(info, pinnedKey); err == nil {
		t.Fatal("tampered manifest was accepted")
	}
}

func TestVerifyManifestRejectsUnpinnedSigningKey(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	otherPublicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	info := Info{
		Version:            "0.1.8-signed-commands",
		SHA256:             "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		Size:               2048,
		SignatureAlgorithm: "ed25519",
		SigningPublicKey:   base64.StdEncoding.EncodeToString(publicKey),
	}
	info.SignedPayload = info.Version + "|" + info.SHA256 + "|2048"
	info.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, []byte(info.SignedPayload)))

	if err := VerifyManifestWithKey(info, base64.StdEncoding.EncodeToString(otherPublicKey)); err == nil {
		t.Fatal("manifest signed by an unpinned key was accepted")
	}
}

func TestShouldApplyVersionRejectsDowngradeAndUnknownVersions(t *testing.T) {
	if apply, _ := ShouldApplyVersion("0.1.9-signed-commands", "0.1.10-signed-commands"); !apply {
		t.Fatal("newer version was rejected")
	}
	if apply, reason := ShouldApplyVersion("0.1.10-signed-commands", "0.1.9-signed-commands"); apply || reason != "downgrade rejected" {
		t.Fatalf("downgrade was not rejected: apply=%t reason=%s", apply, reason)
	}
	if apply, reason := ShouldApplyVersion("development", "0.1.10-signed-commands"); apply || reason != "unparseable version" {
		t.Fatalf("unknown current version should fail closed: apply=%t reason=%s", apply, reason)
	}
}
