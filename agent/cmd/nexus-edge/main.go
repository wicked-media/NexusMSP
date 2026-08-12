// Nexus Edge is a small customer-side deployment companion.
// It exchanges a one-time Deployment Hub activation code for a non-recoverable
// identity, then maintains an authenticated health heartbeat. It deliberately
// does not accept inbound management connections.
package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

var Version = "0.1.0"

type edgeState struct {
	DeploymentID string `json:"deployment_id"`
	InstanceID   string `json:"instance_id"`
	Token        string `json:"edge_token"`
}

type activationResponse struct {
	DeploymentID             string `json:"deployment_id"`
	EdgeToken                string `json:"edge_token"`
	HeartbeatIntervalSeconds int    `json:"heartbeat_interval_seconds"`
}

type heartbeatResponse struct {
	NextHeartbeatSeconds            int                 `json:"next_heartbeat_seconds"`
	ConnectivityChecks              []connectivityCheck `json:"connectivity_checks"`
	AcknowledgedConnectivityResults []string            `json:"acknowledged_connectivity_results"`
}

type connectivityCheck struct {
	ID         string `json:"id"`
	TargetHost string `json:"target_host"`
	TargetPort int    `json:"target_port"`
	RequireTLS bool   `json:"require_tls"`
}

type connectivityResult struct {
	CheckID    string `json:"check_id"`
	DNS        string `json:"dns"`
	TCP        string `json:"tcp"`
	TLS        string `json:"tls"`
	LatencyMS  int64  `json:"latency_ms,omitempty"`
	ObservedAt string `json:"observed_at"`
}

func main() {
	controlPlane := strings.TrimRight(strings.TrimSpace(os.Getenv("NEXUS_CONTROL_PLANE_URL")), "/")
	deploymentID := strings.TrimSpace(os.Getenv("NEXUS_DEPLOYMENT_ID"))
	statePath := strings.TrimSpace(os.Getenv("NEXUS_EDGE_STATE_PATH"))
	if statePath == "" {
		statePath = "/var/lib/nexus-edge/state.json"
	}
	if controlPlane == "" || deploymentID == "" {
		log.Fatal("NEXUS_CONTROL_PLANE_URL and NEXUS_DEPLOYMENT_ID are required")
	}

	state, err := loadState(statePath)
	if err != nil {
		log.Fatalf("load edge state: %v", err)
	}
	if state.DeploymentID != "" && state.DeploymentID != deploymentID {
		log.Fatal("persisted Edge identity belongs to a different deployment; use a clean volume for a new deployment")
	}
	if state.InstanceID == "" {
		state.InstanceID = strings.TrimSpace(os.Getenv("NEXUS_EDGE_INSTANCE_ID"))
		if state.InstanceID == "" {
			name, nameErr := os.Hostname()
			if nameErr != nil || strings.TrimSpace(name) == "" {
				log.Fatal("could not determine Edge instance hostname")
			}
			state.InstanceID = name
		}
	}
	state.DeploymentID = deploymentID

	client := &http.Client{Timeout: 20 * time.Second}
	interval := 60 * time.Second
	if state.Token == "" {
		activationCode := strings.TrimSpace(os.Getenv("NEXUS_ACTIVATION_CODE"))
		if activationCode == "" {
			log.Fatal("NEXUS_ACTIVATION_CODE is required until this Edge has activated")
		}
		response := activationResponse{}
		if err := doJSON(client, http.MethodPost, controlPlane+"/api/deployment-hub/activate", "", map[string]string{
			"deployment_id": deploymentID, "activation_code": activationCode,
			"instance_id": state.InstanceID, "hostname": state.InstanceID, "version": Version,
		}, &response); err != nil {
			log.Fatalf("activation failed: %v", err)
		}
		state.Token = response.EdgeToken
		if err := saveState(statePath, state); err != nil {
			log.Fatalf("persist Edge identity: %v", err)
		}
		if response.HeartbeatIntervalSeconds > 0 {
			interval = time.Duration(response.HeartbeatIntervalSeconds) * time.Second
		}
		log.Printf("Edge activated for deployment %s. Remove NEXUS_ACTIVATION_CODE from .env before the next restart.", deploymentID)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	for {
		var response heartbeatResponse
		sitePulse := collectSitePulse(controlPlane)
		jumpTransport := collectJumpTransportEvidence()
		results := takePendingConnectivityResults(statePath)
		services := map[string]string{"nexus_edge": "healthy"}
		for _, role := range strings.Split(os.Getenv("NEXUS_EDGE_ROLES"), ",") {
			if role = strings.TrimSpace(role); role != "" {
				services[role] = roleEvidence(role, sitePulse, jumpTransport)
			}
		}
		err := doJSON(client, http.MethodPost, controlPlane+"/api/deployment-hub/heartbeat", state.Token, map[string]any{
			"deployment_id": deploymentID, "instance_id": state.InstanceID, "version": Version,
			"agent_count": 0, "relay_status": "not_enabled", "services": services,
			"site_pulse": sitePulse, "connectivity_results": results, "jump_transport": jumpTransport,
			"attestation": map[string]string{
				"persistent_identity": "verified",
				"secure_boot":         "not_reported",
				"tpm_identity":        "not_reported",
				"signed_updates":      "not_reported",
				"rollback_health":     "not_reported",
			},
		}, &response)
		if err != nil {
			log.Printf("heartbeat failed: %v", err)
		} else if response.NextHeartbeatSeconds > 0 {
			interval = time.Duration(response.NextHeartbeatSeconds) * time.Second
			log.Printf("authenticated heartbeat accepted; next report in %s", interval)
		}
		if len(response.AcknowledgedConnectivityResults) > 0 {
			if err := acknowledgeConnectivityResults(statePath, response.AcknowledgedConnectivityResults); err != nil {
				log.Printf("could not clear acknowledged connectivity results: %v", err)
			}
		}
		if len(response.ConnectivityChecks) > 0 {
			for _, check := range response.ConnectivityChecks {
				result := runConnectivityCheck(check)
				if err := appendConnectivityResult(statePath, result); err != nil {
					log.Printf("could not retain connectivity result %s: %v", check.ID, err)
				}
			}
		}
		select {
		case <-ctx.Done():
			log.Println("Nexus Edge stopping")
			return
		case <-time.After(interval):
		}
	}
}

// roleEvidence upgrades only the roles for which Edge has narrow, factual
// observations. It intentionally leaves every other role declared until that
// role has its own verified probe and policy contract.
func roleEvidence(role string, sitePulse map[string]any, jumpTransport map[string]string) string {
	switch role {
	case "network_monitor":
		dns, _ := sitePulse["control_plane_dns"].(string)
		transport, _ := sitePulse["control_plane_transport"].(string)
		if dns == "healthy" && transport == "healthy" {
			return "observed_control_plane"
		}
		return "attention_control_plane"
	case "jump_gateway":
		switch jumpTransport["wireguard"] {
		case "ready":
			return "transport_handshake_observed"
		case "configured_no_session":
			return "transport_configured_no_session"
		case "attention":
			return "transport_attention"
		default:
			return "transport_not_configured"
		}
	default:
		return "declared"
	}
}

// collectJumpTransportEvidence checks local WireGuard readiness only. It never
// creates an interface, peer, route or tunnel; those must be delivered by the
// reviewed Nexus Jump transport controller with a time-bound policy.
func collectJumpTransportEvidence() map[string]string {
	transport := strings.ToLower(strings.TrimSpace(os.Getenv("NEXUS_JUMP_TRANSPORT")))
	if transport == "" || transport == "disabled" {
		return map[string]string{"wireguard": "not_configured"}
	}
	if transport != "wireguard" {
		return map[string]string{"wireguard": "not_supported"}
	}
	if _, err := exec.LookPath("wg"); err != nil {
		return map[string]string{"wireguard": "not_supported"}
	}
	iface := strings.TrimSpace(os.Getenv("NEXUS_JUMP_INTERFACE"))
	if iface == "" {
		iface = "nexus-jump0"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "wg", "show", iface, "latest-handshakes").Output()
	if err != nil {
		return map[string]string{"wireguard": "not_configured"}
	}
	if strings.TrimSpace(string(output)) == "" {
		return map[string]string{"wireguard": "configured_no_session"}
	}
	return map[string]string{"wireguard": "ready"}
}

func runConnectivityCheck(check connectivityCheck) connectivityResult {
	result := connectivityResult{CheckID: check.ID, DNS: "attention", TCP: "not_run", TLS: "not_run", ObservedAt: time.Now().UTC().Format(time.RFC3339)}
	if check.ID == "" || check.TargetHost == "" || check.TargetPort < 1 || check.TargetPort > 65535 {
		return result
	}
	if _, err := net.LookupHost(check.TargetHost); err != nil {
		return result
	}
	result.DNS = "healthy"
	address := net.JoinHostPort(check.TargetHost, fmt.Sprintf("%d", check.TargetPort))
	started := time.Now()
	connection, err := (&net.Dialer{Timeout: 8 * time.Second}).Dial("tcp", address)
	result.LatencyMS = time.Since(started).Milliseconds()
	if err != nil {
		if check.RequireTLS {
			result.TLS = "attention"
		}
		return result
	}
	_ = connection.Close()
	result.TCP = "healthy"
	if !check.RequireTLS {
		return result
	}
	tlsConnection, err := tls.DialWithDialer(&net.Dialer{Timeout: 8 * time.Second}, "tcp", address, &tls.Config{ServerName: check.TargetHost, MinVersion: tls.VersionTLS12})
	if err != nil {
		result.TLS = "attention"
		return result
	}
	_ = tlsConnection.Close()
	result.TLS = "healthy"
	return result
}

func connectivityResultPath(statePath string) string {
	return statePath + ".connectivity-results.json"
}

func takePendingConnectivityResults(statePath string) []connectivityResult {
	data, err := os.ReadFile(connectivityResultPath(statePath))
	if err != nil || len(data) == 0 {
		return nil
	}
	var results []connectivityResult
	if err := json.Unmarshal(data, &results); err != nil {
		return nil
	}
	return results
}

func appendConnectivityResult(statePath string, result connectivityResult) error {
	results := takePendingConnectivityResults(statePath)
	for _, current := range results {
		if current.CheckID == result.CheckID {
			return nil
		}
	}
	results = append(results, result)
	if len(results) > 8 {
		results = results[len(results)-8:]
	}
	data, err := json.Marshal(results)
	if err != nil {
		return err
	}
	path := connectivityResultPath(statePath)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func acknowledgeConnectivityResults(statePath string, acknowledged []string) error {
	if len(acknowledged) == 0 {
		return nil
	}
	wanted := make(map[string]struct{}, len(acknowledged))
	for _, id := range acknowledged {
		wanted[id] = struct{}{}
	}
	remaining := make([]connectivityResult, 0)
	for _, result := range takePendingConnectivityResults(statePath) {
		if _, found := wanted[result.CheckID]; !found {
			remaining = append(remaining, result)
		}
	}
	data, err := json.Marshal(remaining)
	if err != nil {
		return err
	}
	return os.WriteFile(connectivityResultPath(statePath), data, 0o600)
}

// collectSitePulse deliberately measures only the Edge's route to its Nexus
// control plane. It is not a claim that internet, DNS generally, or customer
// business services are healthy. Those need separately approved probes.
func collectSitePulse(controlPlane string) map[string]any {
	pulse := map[string]any{
		"scope": "edge_to_control_plane", "control_plane_dns": "attention",
		"control_plane_transport": "attention", "observed_at": time.Now().UTC().Format(time.RFC3339),
	}
	parsed, err := url.Parse(controlPlane)
	if err != nil || parsed.Hostname() == "" {
		return pulse
	}
	if _, err := net.LookupHost(parsed.Hostname()); err != nil {
		return pulse
	}
	pulse["control_plane_dns"] = "healthy"
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "http" {
			port = "80"
		} else {
			port = "443"
		}
	}
	started := time.Now()
	connection, err := (&net.Dialer{Timeout: 8 * time.Second}).Dial("tcp", net.JoinHostPort(parsed.Hostname(), port))
	pulse["latency_ms"] = time.Since(started).Milliseconds()
	if err != nil {
		return pulse
	}
	_ = connection.Close()
	pulse["control_plane_transport"] = "healthy"
	return pulse
}

func loadState(path string) (edgeState, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return edgeState{}, nil
	}
	if err != nil {
		return edgeState{}, err
	}
	var state edgeState
	if err := json.Unmarshal(data, &state); err != nil {
		return edgeState{}, fmt.Errorf("parse state: %w", err)
	}
	return state, nil
}

func saveState(path string, state edgeState) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

func doJSON(client *http.Client, method, url, edgeToken string, payload any, output any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode request: %w", err)
	}
	request, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "nexus-edge/"+Version)
	if edgeToken != "" {
		request.Header.Set("X-Nexus-Edge-Token", edgeToken)
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(response.Body)
	if response.StatusCode >= 400 {
		return fmt.Errorf("control plane returned %s: %s", response.Status, strings.TrimSpace(string(data)))
	}
	if output != nil && len(data) > 0 {
		if err := json.Unmarshal(data, output); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}
