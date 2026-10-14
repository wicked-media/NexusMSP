package nexusbackup

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"nexusagent/internal/config"
)

// CaptureLease is a dedicated signed authorisation for a future capture
// worker. It is intentionally separate from agent commands and contains no
// filesystem path, vault credential, encryption key, or payload.
type CaptureLease struct {
	SchemaVersion    int    `json:"schema_version"`
	LeaseID          string `json:"lease_id"`
	TenantID         string `json:"tenant_id"`
	ClientID         string `json:"client_id"`
	DeviceID         string `json:"device_id"`
	JobID            string `json:"job_id"`
	CaptureID        string `json:"capture_id"`
	SourceProfile    string `json:"source_profile"`
	IssuedAt         string `json:"issued_at"`
	ExpiresAt        string `json:"expires_at"`
	Nonce            string `json:"nonce"`
	SignatureAlg     string `json:"signature_algorithm"`
	Signature        string `json:"signature"`
	SigningPublicKey string `json:"signing_public_key"`
	SigningKeyID     string `json:"signing_key_id"`
	SignedPayload    string `json:"signed_payload"`
}

func (l CaptureLease) canonicalPayload() string {
	return strings.Join([]string{fmt.Sprintf("%d", l.SchemaVersion), l.LeaseID, l.TenantID, l.ClientID, l.DeviceID, l.JobID, l.CaptureID, l.SourceProfile, l.IssuedAt, l.ExpiresAt, l.Nonce}, "|")
}

// VerifyCaptureLease validates scope, expiration and signature. It deliberately
// does not treat a valid lease as permission to execute: the worker remains
// disabled until the explicit capture-release policy exists.
func VerifyCaptureLease(cfg *config.Config, lease CaptureLease, now time.Time) error {
	if cfg == nil || cfg.PlatformPolicy == nil || cfg.PlatformPolicy.NexusBackup == nil {
		return errors.New("backup capture policy is unavailable")
	}
	p := cfg.PlatformPolicy.NexusBackup
	if p.ExecutionAllowed || p.FileAccessAllowed || p.SnapshotAllowed || p.UploadAllowed || p.RestoreAllowed {
		return errors.New("unsafe backup policy rejected")
	}
	if lease.SchemaVersion != 1 || lease.LeaseID == "" || lease.Nonce == "" || lease.JobID == "" || lease.CaptureID == "" {
		return errors.New("backup capture lease is incomplete")
	}
	if lease.ClientID != cfg.ClientID || lease.DeviceID != cfg.DeviceID {
		return errors.New("backup capture lease is not for this endpoint")
	}
	if lease.SignatureAlg != "ed25519" || lease.SignedPayload != lease.canonicalPayload() {
		return errors.New("backup capture lease signature envelope is invalid")
	}
	policyKey, _ := p.CaptureLease["signing_public_key"].(string)
	policyKeyID, _ := p.CaptureLease["signing_key_id"].(string)
	if policyKey == "" || lease.SigningPublicKey != policyKey || (policyKeyID != "" && lease.SigningKeyID != policyKeyID) {
		return errors.New("backup capture lease signer is not pinned by policy")
	}
	issued, err := time.Parse(time.RFC3339, lease.IssuedAt)
	if err != nil {
		return errors.New("backup capture lease issue time is invalid")
	}
	expires, err := time.Parse(time.RFC3339, lease.ExpiresAt)
	if err != nil || !expires.After(now) || !expires.After(issued) || expires.Sub(issued) > 15*time.Minute {
		return errors.New("backup capture lease expiry is invalid")
	}
	publicKey, err := base64.StdEncoding.DecodeString(policyKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return errors.New("backup capture policy key is invalid")
	}
	signature, err := base64.StdEncoding.DecodeString(lease.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(publicKey), []byte(lease.SignedPayload), signature) {
		return errors.New("backup capture lease signature is invalid")
	}
	return nil
}
