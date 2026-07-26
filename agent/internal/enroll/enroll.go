// Package enroll handles first-boot agent enrollment with the NexusOps server.
package enroll

import (
	"errors"
	"os"
	"runtime"

	"nexusagent/internal/config"
	"nexusagent/internal/identity"
	"nexusagent/internal/telemetry"
	"nexusagent/internal/transport"
)

type request struct {
	EnrollmentToken string   `json:"enrollment_token"`
	ClientID        string   `json:"client_id"`
	Hostname        string   `json:"hostname"`
	OS              string   `json:"os"`
	Arch            string   `json:"arch"`
	OSVersion       string   `json:"os_version,omitempty"`
	MAC             string   `json:"mac,omitempty"`
	AgentVersion    string   `json:"agent_version,omitempty"`
	Capabilities    []string `json:"capabilities,omitempty"`
	InstallID       string   `json:"install_id,omitempty"`
	CSR             string   `json:"certificate_signing_request,omitempty"`
	KeyFingerprint  string   `json:"public_key_fingerprint,omitempty"`
}

type response struct {
	AgentToken             string                 `json:"agent_token"`
	DeviceID               string                 `json:"device_id"`
	IdentityStatus         string                 `json:"identity_status"`
	CertificatePEM         string                 `json:"certificate_pem"`
	CACertificatePEM       string                 `json:"ca_certificate_pem"`
	CertificateFingerprint string                 `json:"certificate_fingerprint"`
	CertificateExpiresAt   string                 `json:"certificate_expires_at"`
	SPIFFEID               string                 `json:"spiffe_id"`
	Policy                 *config.PlatformPolicy `json:"policy,omitempty"`
}

type renewRequest struct {
	InstallID      string `json:"install_id"`
	CSR            string `json:"certificate_signing_request"`
	KeyFingerprint string `json:"public_key_fingerprint"`
}

type renewResponse struct {
	IdentityStatus         string `json:"identity_status"`
	CertificatePEM         string `json:"certificate_pem"`
	CACertificatePEM       string `json:"ca_certificate_pem"`
	CertificateFingerprint string `json:"certificate_fingerprint"`
	CertificateExpiresAt   string `json:"certificate_expires_at"`
	SPIFFEID               string `json:"spiffe_id"`
}

// Run posts an enrollment request and returns (agent_token, device_id).
func Run(tr *transport.Client, cfg *config.Config) (string, string, error) {
	if cfg.EnrollmentToken == "" {
		return "", "", errors.New("missing enrollment_token in config (got an empty installer?)")
	}
	host, _ := os.Hostname()
	info := telemetry.QuickInfo()
	csr, keyFingerprint, err := identity.Ensure(cfg)
	if err != nil {
		return "", "", err
	}

	req := request{
		EnrollmentToken: cfg.EnrollmentToken,
		ClientID:        cfg.ClientID,
		Hostname:        host,
		OS:              runtime.GOOS,
		Arch:            runtime.GOARCH,
		OSVersion:       info.OSVersion,
		MAC:             info.PrimaryMAC,
		AgentVersion:    info.AgentVersion,
		Capabilities:    cfg.ShieldCapabilities(),
		InstallID:       cfg.InstallID,
		CSR:             csr,
		KeyFingerprint:  keyFingerprint,
	}
	var resp response
	if err := tr.Do("POST", "/api/nexus-agent/enroll", req, &resp); err != nil {
		return "", "", err
	}
	if resp.AgentToken == "" || resp.DeviceID == "" {
		return "", "", errors.New("server returned empty agent_token or device_id")
	}
	if err := identity.PersistIssued(
		cfg,
		resp.CertificatePEM,
		resp.CACertificatePEM,
		resp.CertificateFingerprint,
		resp.CertificateExpiresAt,
		resp.SPIFFEID,
	); err != nil {
		return "", "", err
	}
	cfg.DeviceIdentity.Status = resp.IdentityStatus
	if resp.Policy != nil {
		cfg.PlatformPolicy = resp.Policy
	}
	if err := config.Save(cfg); err != nil {
		return "", "", err
	}
	return resp.AgentToken, resp.DeviceID, nil
}

func Renew(tr *transport.Client, cfg *config.Config) error {
	csr, keyFingerprint, err := identity.Ensure(cfg)
	if err != nil {
		return err
	}
	var resp renewResponse
	if err := tr.Do("POST", "/api/nexus-agent/identity/renew", renewRequest{
		InstallID:      cfg.InstallID,
		CSR:            csr,
		KeyFingerprint: keyFingerprint,
	}, &resp); err != nil {
		return err
	}
	if err := identity.PersistIssued(
		cfg,
		resp.CertificatePEM,
		resp.CACertificatePEM,
		resp.CertificateFingerprint,
		resp.CertificateExpiresAt,
		resp.SPIFFEID,
	); err != nil {
		return err
	}
	cfg.DeviceIdentity.Status = resp.IdentityStatus
	return config.Save(cfg)
}
