package nexusremote

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/url"
	"sync/atomic"

	"nexusagent/internal/transport"
)

// AgentAPI is owned by the protected service, never by a browser or a
// user-session executable. It is intentionally tiny: it exchanges signed
// envelopes and records bounded lifecycle evidence only.
type AgentAPI struct {
	client   *transport.Client
	sequence atomic.Uint64
}

func NewAgentAPI(client *transport.Client) (*AgentAPI, error) {
	if client == nil {
		return nil, fmt.Errorf("native remote agent transport is required")
	}
	return &AgentAPI{client: client}, nil
}

func (a *AgentAPI) Pending() (*DeliveredGrant, error) {
	var response struct {
		Grant *DeliveredGrant `json:"grant"`
	}
	if err := a.client.Do("GET", "/api/nexus-agent/native-remote/grants/pending", nil, &response); err != nil {
		return nil, err
	}
	return response.Grant, nil
}

func (a *AgentAPI) Acknowledge(sessionID, outcome, reason string) error {
	return a.client.Do("POST", "/api/nexus-agent/native-remote/grants/"+url.PathEscape(sessionID)+"/ack", map[string]string{
		"outcome": outcome, "reason": boundedReason(reason, ""),
	}, nil)
}

func (a *AgentAPI) Status(sessionID string) (bool, error) {
	var response struct {
		Active bool `json:"active"`
	}
	if err := a.client.Do("GET", "/api/nexus-agent/native-remote/grants/"+url.PathEscape(sessionID)+"/status", nil, &response); err != nil {
		return false, err
	}
	return response.Active, nil
}

// LocalStop records an attended endpoint user's terminal revocation. It is
// exposed only through the agent-owned transport, never the browser viewer.
func (a *AgentAPI) LocalStop(sessionID, reason string) error {
	return a.client.Do("POST", "/api/nexus-agent/native-remote/grants/"+url.PathEscape(sessionID)+"/stop", map[string]string{
		"reason": boundedReason(reason, "Endpoint user stopped view-only access"),
	}, nil)
}

func (a *AgentAPI) Transport(sessionID, state, detail string) error {
	if state != "connected" && state != "disconnected" {
		return fmt.Errorf("invalid native remote transport state")
	}
	return a.client.Do("POST", "/api/nexus-agent/native-remote/grants/"+url.PathEscape(sessionID)+"/transport", map[string]string{
		"state": state, "detail": boundedReason(detail, ""),
	}, nil)
}

// CompanionHealth lets the protected service publish non-session readiness
// immediately. It is deliberately separate from the full heartbeat so a
// signed-in companion can become selectable without waiting for its next
// telemetry cycle, and it never carries a grant, desktop frame or user data.
func (a *AgentAPI) CompanionHealth(status, detail string) error {
	allowed := map[string]bool{
		"ready": true, "waiting_for_policy": true, "waiting_for_user_session": true,
		"integrity_unverified": true, "unsupported_platform": true,
		"configuration_unavailable": true, "api_unavailable": true,
	}
	if !allowed[status] {
		return fmt.Errorf("invalid native remote companion health state")
	}
	return a.client.Do("POST", "/api/nexus-agent/native-remote/health", map[string]string{
		"status": status, "detail": boundedReason(detail, ""),
	}, nil)
}

// SendFrame provides the initial bounded HTTPS relay. The server retains only
// the latest JPEG for an active session with a two-minute TTL; it is not a
// recording or file-transfer channel.
func (a *AgentAPI) SendFrame(_ context.Context, sessionID string, jpeg []byte) error {
	if len(jpeg) == 0 || len(jpeg) > 4*1024*1024 {
		return fmt.Errorf("native remote frame size is invalid")
	}
	return a.client.Do("POST", "/api/nexus-agent/native-remote/grants/"+url.PathEscape(sessionID)+"/frame", map[string]any{
		"sequence": a.sequence.Add(1),
		"jpeg_b64": base64.StdEncoding.EncodeToString(jpeg),
	}, nil)
}
