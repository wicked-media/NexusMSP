// Package identity owns the endpoint-generated Nexus Agent device identity.
// The private key is generated and retained locally; enrollment sends only a
// CSR so the control plane can issue a short-lived client certificate.
package identity

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"nexusagent/internal/config"
)

type Evidence struct {
	Status  string            `json:"status"`
	Checks  []string          `json:"checks"`
	Repairs []string          `json:"repairs,omitempty"`
	Details map[string]string `json:"details,omitempty"`
}

func Ensure(cfg *config.Config) (string, string, error) {
	if cfg.InstallID == "" {
		random := make([]byte, 16)
		if _, err := rand.Read(random); err != nil {
			return "", "", fmt.Errorf("create install identity: %w", err)
		}
		cfg.InstallID = hex.EncodeToString(random)
	}
	if cfg.DeviceIdentity == nil {
		cfg.DeviceIdentity = &config.DeviceIdentity{}
	}
	if cfg.DeviceIdentity.PrivateKeyPath == "" {
		cfg.DeviceIdentity.PrivateKeyPath = filepath.Join(cfg.BaseDir(), "device-key.pem")
	}
	if cfg.DeviceIdentity.CertificatePath == "" {
		cfg.DeviceIdentity.CertificatePath = filepath.Join(cfg.BaseDir(), "device-cert.pem")
	}
	if cfg.DeviceIdentity.CACertificatePath == "" {
		cfg.DeviceIdentity.CACertificatePath = filepath.Join(cfg.BaseDir(), "nexus-agent-ca.pem")
	}

	key, err := loadOrCreateKey(cfg.DeviceIdentity.PrivateKeyPath)
	if err != nil {
		return "", "", err
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return "", "", fmt.Errorf("marshal public key: %w", err)
	}
	publicDigest := sha256.Sum256(publicDER)
	publicFingerprint := hex.EncodeToString(publicDigest[:])
	cfg.DeviceIdentity.PublicKeyFingerprint = publicFingerprint

	hostname, _ := os.Hostname()
	template := &x509.CertificateRequest{
		Subject: pkix.Name{
			CommonName:   "nexus-agent:" + cfg.InstallID,
			Organization: []string{"NexusMSP managed endpoint"},
		},
	}
	if hostname != "" {
		template.DNSNames = []string{hostname}
	}
	csrDER, err := x509.CreateCertificateRequest(rand.Reader, template, key)
	if err != nil {
		return "", "", fmt.Errorf("create device CSR: %w", err)
	}
	csrPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csrDER})
	if err := config.Save(cfg); err != nil {
		return "", "", fmt.Errorf("persist identity paths: %w", err)
	}
	return string(csrPEM), publicFingerprint, nil
}

func PersistIssued(
	cfg *config.Config,
	certificatePEM, caCertificatePEM, fingerprint, expiresAt, spiffeID string,
) error {
	if cfg.DeviceIdentity == nil {
		return errors.New("device identity has not been initialised")
	}
	if strings.TrimSpace(certificatePEM) == "" || strings.TrimSpace(caCertificatePEM) == "" {
		return errors.New("server returned an incomplete device certificate")
	}
	if err := os.WriteFile(cfg.DeviceIdentity.CertificatePath, []byte(certificatePEM), 0o600); err != nil {
		return fmt.Errorf("write device certificate: %w", err)
	}
	if err := os.WriteFile(cfg.DeviceIdentity.CACertificatePath, []byte(caCertificatePEM), 0o644); err != nil {
		return fmt.Errorf("write agent CA certificate: %w", err)
	}
	cfg.DeviceIdentity.Status = "certificate_issued"
	cfg.DeviceIdentity.CertificateFingerprint = strings.ToLower(strings.ReplaceAll(fingerprint, ":", ""))
	cfg.DeviceIdentity.CertificateExpiresAt = expiresAt
	cfg.DeviceIdentity.SPIFFEID = spiffeID
	return config.Save(cfg)
}

func Report(cfg *config.Config) map[string]any {
	result := map[string]any{
		"install_id": cfg.InstallID,
		"status":     "legacy_token",
	}
	if cfg.DeviceIdentity != nil {
		result["status"] = cfg.DeviceIdentity.Status
		result["certificate_fingerprint"] = cfg.DeviceIdentity.CertificateFingerprint
		result["certificate_expires_at"] = cfg.DeviceIdentity.CertificateExpiresAt
		result["spiffe_id"] = cfg.DeviceIdentity.SPIFFEID
		result["public_key_fingerprint"] = cfg.DeviceIdentity.PublicKeyFingerprint
	}
	return result
}

func PolicyEvidence(cfg *config.Config) map[string]any {
	if cfg.PlatformPolicy == nil {
		return map[string]any{"status": "missing"}
	}
	return map[string]any{
		"status":          "applied",
		"version":         cfg.PlatformPolicy.Version,
		"checksum_sha256": cfg.PlatformPolicy.ChecksumSHA256,
	}
}

func SelfRepairEvidence(cfg *config.Config) Evidence {
	evidence := Evidence{
		Status:  "healthy",
		Checks:  []string{},
		Details: map[string]string{},
	}
	if _, err := os.Stat(filepath.Join(cfg.BaseDir(), "config.json")); err == nil {
		evidence.Checks = append(evidence.Checks, "config_present")
	} else if cfg.BaseDir() != "." {
		evidence.Status = "attention"
		evidence.Details["config"] = err.Error()
	}
	if cfg.DeviceIdentity == nil {
		evidence.Status = "attention"
		evidence.Details["identity"] = "not_initialised"
		return evidence
	}
	for name, path := range map[string]string{
		"private_key_present": cfg.DeviceIdentity.PrivateKeyPath,
		"certificate_present": cfg.DeviceIdentity.CertificatePath,
		"ca_present":          cfg.DeviceIdentity.CACertificatePath,
	} {
		if path == "" {
			evidence.Status = "attention"
			evidence.Details[name] = "path_missing"
			continue
		}
		if _, err := os.Stat(path); err != nil {
			evidence.Status = "attention"
			evidence.Details[name] = err.Error()
		} else {
			evidence.Checks = append(evidence.Checks, name)
		}
	}
	if cfg.PlatformPolicy == nil || cfg.PlatformPolicy.ChecksumSHA256 == "" {
		evidence.Status = "attention"
		evidence.Details["policy"] = "cache_missing"
	} else {
		evidence.Checks = append(evidence.Checks, "policy_cache_present")
	}
	if cfg.DeviceIdentity.CertificateExpiresAt != "" {
		if expiry, err := time.Parse(time.RFC3339, cfg.DeviceIdentity.CertificateExpiresAt); err != nil {
			evidence.Status = "attention"
			evidence.Details["certificate_expiry"] = "invalid"
		} else if !time.Now().UTC().Before(expiry.UTC()) {
			evidence.Status = "attention"
			evidence.Details["certificate_expiry"] = "expired"
		} else {
			evidence.Checks = append(evidence.Checks, "certificate_current")
		}
	}
	return evidence
}

func NeedsRotation(cfg *config.Config, within time.Duration) bool {
	if cfg.DeviceIdentity == nil || cfg.DeviceIdentity.CertificateExpiresAt == "" {
		return true
	}
	expiry, err := time.Parse(time.RFC3339, cfg.DeviceIdentity.CertificateExpiresAt)
	return err != nil || expiry.Before(time.Now().UTC().Add(within))
}

func Repair(cfg *config.Config, actions []string) (Evidence, error) {
	requested := map[string]bool{}
	for _, action := range actions {
		requested[strings.ToLower(strings.TrimSpace(action))] = true
	}
	if len(requested) == 0 {
		requested = map[string]bool{"identity": true, "policy": true, "config": true}
	}
	evidence := SelfRepairEvidence(cfg)
	if requested["identity"] {
		if _, _, err := Ensure(cfg); err != nil {
			return evidence, err
		}
		if cfg.DeviceIdentity != nil {
			if err := os.Chmod(cfg.DeviceIdentity.PrivateKeyPath, 0o600); err == nil {
				evidence.Repairs = append(evidence.Repairs, "private_key_permissions")
			}
		}
	}
	if requested["config"] {
		if err := config.Save(cfg); err != nil {
			return evidence, err
		}
		evidence.Repairs = append(evidence.Repairs, "configuration_rewritten")
	}
	if requested["policy"] && cfg.PlatformPolicy != nil {
		policyPath := filepath.Join(cfg.BaseDir(), "platform-policy.json")
		payload, err := json.MarshalIndent(cfg.PlatformPolicy, "", "  ")
		if err != nil {
			return evidence, err
		}
		if err := os.WriteFile(policyPath, payload, 0o600); err != nil {
			return evidence, err
		}
		evidence.Repairs = append(evidence.Repairs, "policy_cache_rewritten")
	}
	refreshed := SelfRepairEvidence(cfg)
	refreshed.Repairs = evidence.Repairs
	return refreshed, nil
}

func loadOrCreateKey(path string) (*ecdsa.PrivateKey, error) {
	if data, err := os.ReadFile(path); err == nil {
		block, _ := pem.Decode(data)
		if block == nil {
			return nil, errors.New("device private key is not valid PEM")
		}
		key, err := x509.ParseECPrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse device private key: %w", err)
		}
		return key, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read device private key: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create identity directory: %w", err)
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate device private key: %w", err)
	}
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("marshal device private key: %w", err)
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der}), 0o600); err != nil {
		return nil, fmt.Errorf("write device private key: %w", err)
	}
	return key, nil
}
