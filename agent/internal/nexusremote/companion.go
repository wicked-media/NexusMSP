package nexusremote

// The coordinator is the boundary used by a future user-session companion.
// It accepts only an agent-delivered, signed envelope; neither a browser nor a
// local HTTP request can create a Session. Capture and input adapters must
// call Session.Authorize for every operation.

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
)

type DeliveredGrant struct {
	SessionID      string `json:"session_id"`
	Mode           Mode   `json:"mode"`
	TechnicianName string `json:"technician_name"`
	Purpose        string `json:"purpose"`
	KeyID          string `json:"key_id"`
	PublicKeyB64   string `json:"public_key_b64"`
	PayloadB64     string `json:"payload_b64"`
	SignatureB64   string `json:"signature_b64"`
	ExpiresAt      string `json:"expires_at"`
}

// CompanionPolicy comes only from the authenticated agent policy cache.
// ManagedDeviceID is deliberately not trusted from a delivered envelope.
type CompanionPolicy struct {
	Enabled         bool
	TenantID        string
	ManagedDeviceID string
	GrantKeyID      string
	GrantPublicKey  string
	CompanionSHA256 string
}

type ConsentPrompt func(sessionID string, mode Mode, expiresAt time.Time) (bool, string)
type Acknowledge func(sessionID, outcome, reason string) error

type Coordinator struct {
	policy CompanionPolicy
	replay ReplayStore
	prompt ConsentPrompt
	ack    Acknowledge
}

func NewCoordinator(policy CompanionPolicy, replay ReplayStore, prompt ConsentPrompt, ack Acknowledge) (*Coordinator, error) {
	if !policy.Enabled || strings.TrimSpace(policy.TenantID) == "" || strings.TrimSpace(policy.ManagedDeviceID) == "" {
		return nil, errors.New("native remote companion policy is not eligible")
	}
	if replay == nil || prompt == nil || ack == nil {
		return nil, errors.New("native remote companion dependencies are required")
	}
	if _, err := decodePublicKey(policy.GrantPublicKey); err != nil {
		return nil, err
	}
	return &Coordinator{policy: policy, replay: replay, prompt: prompt, ack: ack}, nil
}

// Process verifies the exact signed grant and records replay use durably. V1
// grants always prompt locally; only a signed V2 grant can bypass that prompt,
// after the server has checked the endpoint's standing authorisation setting.
func (c *Coordinator) Process(delivered DeliveredGrant, now time.Time) (*Session, error) {
	if strings.TrimSpace(delivered.SessionID) == "" || delivered.KeyID != c.policy.GrantKeyID {
		return nil, errors.New("remote grant identity mismatch")
	}
	if delivered.PublicKeyB64 != c.policy.GrantPublicKey {
		return nil, errors.New("remote grant trust key mismatch")
	}
	publicKey, err := decodePublicKey(c.policy.GrantPublicKey)
	if err != nil {
		return nil, err
	}
	payload, err := base64.StdEncoding.Strict().DecodeString(delivered.PayloadB64)
	if err != nil {
		return nil, errors.New("invalid remote grant payload encoding")
	}
	signature, err := base64.StdEncoding.Strict().DecodeString(delivered.SignatureB64)
	if err != nil {
		return nil, errors.New("invalid remote grant signature encoding")
	}
	verifier, err := NewVerifierWithReplayStore(publicKey, c.replay)
	if err != nil {
		return nil, err
	}
	session, err := verifier.Accept(SignedGrant{Payload: payload, Signature: signature}, c.policy.TenantID, c.policy.ManagedDeviceID, now)
	if err != nil {
		return nil, err
	}
	if (delivered.Mode != View && delivered.Mode != Control) || delivered.Mode != session.grant.Mode {
		session.Revoke()
		return nil, errors.New("native remote companion received an invalid access mode")
	}
	if session.grant.Mode == Control && !session.grant.ConsentRequired {
		session.Revoke()
		return nil, errors.New("interactive control requires fresh endpoint consent")
	}
	if session.grant.ConsentRequired {
		approved, reason := c.prompt(delivered.SessionID, delivered.Mode, session.grant.ExpiresAt)
		if !approved {
			session.Revoke()
			if err := c.ack(delivered.SessionID, "rejected", boundedReason(reason, "The endpoint user declined remote access")); err != nil {
				return nil, fmt.Errorf("record local rejection: %w", err)
			}
			return nil, errors.New("endpoint user declined remote access")
		}
	}
	if err := session.Consent(now); err != nil {
		return nil, err
	}
	if err := c.ack(delivered.SessionID, "accepted", ""); err != nil {
		session.Revoke()
		return nil, fmt.Errorf("record local consent: %w", err)
	}
	return session, nil
}

func decodePublicKey(encoded string) (ed25519.PublicKey, error) {
	decoded, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(decoded) != ed25519.PublicKeySize {
		return nil, errors.New("invalid native remote trust key")
	}
	return ed25519.PublicKey(decoded), nil
}

func boundedReason(reason, fallback string) string {
	clean := strings.TrimSpace(reason)
	if clean == "" {
		clean = fallback
	}
	if len(clean) > 500 {
		return clean[:500]
	}
	return clean
}
