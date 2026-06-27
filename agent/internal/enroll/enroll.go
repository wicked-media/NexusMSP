// Package enroll handles first-boot agent enrollment with the NexusOps server.
package enroll

import (
	"errors"
	"os"
	"runtime"

	"nexusagent/internal/config"
	"nexusagent/internal/telemetry"
	"nexusagent/internal/transport"
)

type request struct {
	EnrollmentToken string `json:"enrollment_token"`
	ClientID        string `json:"client_id"`
	Hostname        string `json:"hostname"`
	OS              string `json:"os"`
	Arch            string `json:"arch"`
	OSVersion       string `json:"os_version,omitempty"`
	MAC             string `json:"mac,omitempty"`
	AgentVersion    string `json:"agent_version,omitempty"`
}

type response struct {
	AgentToken string `json:"agent_token"`
	DeviceID   string `json:"device_id"`
}

// Run posts an enrollment request and returns (agent_token, device_id).
func Run(tr *transport.Client, cfg *config.Config) (string, string, error) {
	if cfg.EnrollmentToken == "" {
		return "", "", errors.New("missing enrollment_token in config (got an empty installer?)")
	}
	host, _ := os.Hostname()
	info := telemetry.QuickInfo()

	req := request{
		EnrollmentToken: cfg.EnrollmentToken,
		ClientID:        cfg.ClientID,
		Hostname:        host,
		OS:              runtime.GOOS,
		Arch:            runtime.GOARCH,
		OSVersion:       info.OSVersion,
		MAC:             info.PrimaryMAC,
		AgentVersion:    info.AgentVersion,
	}
	var resp response
	if err := tr.Do("POST", "/api/nexus-agent/enroll", req, &resp); err != nil {
		return "", "", err
	}
	if resp.AgentToken == "" || resp.DeviceID == "" {
		return "", "", errors.New("server returned empty agent_token or device_id")
	}
	return resp.AgentToken, resp.DeviceID, nil
}
