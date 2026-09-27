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

type PendingControlEvent struct {
	Sequence uint64       `json:"sequence"`
	Payload  ControlEvent `json:"payload"`
}

// ControlEvents reads queued envelopes only for the active signed control
// grant bound to this protected Agent. It never exposes an endpoint path or
// credential to the user-session companion.
func (a *AgentAPI) ControlEvents(sessionID string) ([]ControlEvent, error) {
	var response struct {
		Events []PendingControlEvent `json:"events"`
	}
	path := "/api/nexus-agent/native-remote/grants/" + url.PathEscape(sessionID) + "/control-events"
	if err := a.client.Do("GET", path, nil, &response); err != nil {
		return nil, err
	}
	events := make([]ControlEvent, 0, len(response.Events))
	for _, item := range response.Events {
		item.Payload.Sequence = item.Sequence
		valid, err := ValidateControlEvent(item.Payload)
		if err != nil {
			return nil, fmt.Errorf("invalid control event from Nexus: %w", err)
		}
		events = append(events, valid)
	}
	return events, nil
}

// AcknowledgeControl removes a delivery row only after the user-session
// companion has confirmed it. A failed acknowledgement is safe: the server
// retains the event and the companion's sequence guard can acknowledge a
// replay without injecting a duplicate action.
func (a *AgentAPI) AcknowledgeControl(sessionID string, sequence uint64) error {
	if sequence == 0 {
		return fmt.Errorf("remote control sequence is required")
	}
	path := "/api/nexus-agent/native-remote/grants/" + url.PathEscape(sessionID) + "/control-events/" + fmt.Sprintf("%d", sequence) + "/ack"
	return a.client.Do("POST", path, nil, nil)
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
