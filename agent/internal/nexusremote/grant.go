package nexusremote

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"io"
	"time"
)

const grantDomain = "nexus-remote-grant-v1\x00"

// maxAttendedGrantLifetime matches the server-issued attended lease. It is
// deliberately bounded: a session can run for a working day without a forced
// mid-repair interruption, while explicit end, local stop, revocation and
// stale transport still terminate access immediately.
const maxAttendedGrantLifetime = 24 * time.Hour

// SignedGrant is verified over the exact payload bytes, not reserialized JSON.
type SignedGrant struct {
	Payload   []byte
	Signature []byte
}
type grantPayload struct {
	Version         int       `json:"version"`
	SessionID       string    `json:"session_id"`
	TenantID        string    `json:"tenant_id"`
	DeviceID        string    `json:"device_id"`
	ActorID         string    `json:"actor_id"`
	Mode            Mode      `json:"mode"`
	IssuedAt        time.Time `json:"issued_at"`
	ExpiresAt       time.Time `json:"expires_at"`
	ConsentRequired *bool     `json:"consent_required,omitempty"`
	TechnicianName  string    `json:"technician_name,omitempty"`
	Purpose         string    `json:"purpose,omitempty"`
}

type Verifier struct {
	key    ed25519.PublicKey
	replay ReplayStore
}

func NewVerifier(key ed25519.PublicKey) (*Verifier, error) {
	return NewVerifierWithReplayStore(key, NewMemoryReplayStore(4096))
}

func NewVerifierWithReplayStore(key ed25519.PublicKey, replay ReplayStore) (*Verifier, error) {
	if len(key) != ed25519.PublicKeySize {
		return nil, errors.New("invalid remote trust key")
	}
	if replay == nil {
		return nil, errors.New("remote replay store is required")
	}
	return &Verifier{key: append(ed25519.PublicKey(nil), key...), replay: replay}, nil
}

func (v *Verifier) Accept(envelope SignedGrant, tenantID, deviceID string, now time.Time) (*Session, error) {
	if len(envelope.Payload) == 0 || len(envelope.Payload) > 4096 || len(envelope.Signature) != ed25519.SignatureSize {
		return nil, errors.New("invalid remote envelope")
	}
	message := append([]byte(grantDomain), envelope.Payload...)
	if !ed25519.Verify(v.key, message, envelope.Signature) {
		return nil, errors.New("invalid remote signature")
	}
	var payload grantPayload
	decoder := json.NewDecoder(bytes.NewReader(envelope.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return nil, errors.New("invalid remote payload")
	}
	if decoder.Decode(new(any)) != io.EOF || (payload.Version != 1 && payload.Version != 2) {
		return nil, errors.New("unsupported remote payload")
	}
	consentRequired := true // V1 is permanently attended-only.
	if payload.Version == 2 {
		if payload.ConsentRequired == nil || *payload.ConsentRequired {
			return nil, errors.New("invalid standing-authorisation payload")
		}
		consentRequired = false
		if len(payload.TechnicianName) > 160 || len(payload.Purpose) > 500 {
			return nil, errors.New("invalid remote display metadata")
		}
	}
	if payload.IssuedAt.IsZero() || payload.IssuedAt.After(now) || !payload.ExpiresAt.After(payload.IssuedAt) || payload.ExpiresAt.Sub(payload.IssuedAt) > maxAttendedGrantLifetime {
		return nil, errors.New("invalid remote lifetime")
	}
	session, err := New(Grant{SessionID: payload.SessionID, TenantID: payload.TenantID, DeviceID: payload.DeviceID, ActorID: payload.ActorID, Mode: payload.Mode, ExpiresAt: payload.ExpiresAt, ConsentRequired: consentRequired, TechnicianName: payload.TechnicianName, Purpose: payload.Purpose}, tenantID, deviceID, now)
	if err != nil {
		return nil, err
	}
	if err := v.replay.Use(payload.SessionID, payload.ExpiresAt, now); err != nil {
		return nil, err
	}
	return session, nil
}
