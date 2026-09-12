package nexusremote

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"time"
)

const grantDomain = "nexus-remote-grant-v1\x00"

// SignedGrant is verified over the exact payload bytes, not reserialized JSON.
type SignedGrant struct {
	Payload   []byte
	Signature []byte
}
type grantPayload struct {
	Version   int       `json:"version"`
	SessionID string    `json:"session_id"`
	TenantID  string    `json:"tenant_id"`
	DeviceID  string    `json:"device_id"`
	ActorID   string    `json:"actor_id"`
	Mode      Mode      `json:"mode"`
	IssuedAt  time.Time `json:"issued_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

// Verifier is scoped to an agent process. Durable replay prevention is still
// required before production deployment; restarting this verifier clears it.
type Verifier struct {
	mu   sync.Mutex
	key  ed25519.PublicKey
	used map[string]time.Time
}

func NewVerifier(key ed25519.PublicKey) (*Verifier, error) {
	if len(key) != ed25519.PublicKeySize {
		return nil, errors.New("invalid remote trust key")
	}
	return &Verifier{key: append(ed25519.PublicKey(nil), key...), used: make(map[string]time.Time)}, nil
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
	if decoder.Decode(new(any)) != io.EOF || payload.Version != 1 {
		return nil, errors.New("unsupported remote payload")
	}
	if payload.IssuedAt.IsZero() || payload.IssuedAt.After(now) || !payload.ExpiresAt.After(payload.IssuedAt) || payload.ExpiresAt.Sub(payload.IssuedAt) > time.Hour {
		return nil, errors.New("invalid remote lifetime")
	}
	session, err := New(Grant{SessionID: payload.SessionID, TenantID: payload.TenantID, DeviceID: payload.DeviceID, ActorID: payload.ActorID, Mode: payload.Mode, ExpiresAt: payload.ExpiresAt}, tenantID, deviceID, now)
	if err != nil {
		return nil, err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	for id, expiry := range v.used {
		if !expiry.After(now) {
			delete(v.used, id)
		}
	}
	if _, exists := v.used[payload.SessionID]; exists {
		return nil, errors.New("remote grant already used")
	}
	if len(v.used) >= 4096 {
		return nil, errors.New("remote grant capacity reached")
	}
	v.used[payload.SessionID] = payload.ExpiresAt
	return session, nil
}
