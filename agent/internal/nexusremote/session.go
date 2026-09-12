// Package nexusremote implements the local safety boundary for native remote
// sessions. It deliberately has no capture or input side effects.
package nexusremote

import (
	"errors"
	"sync"
	"time"
)

type Mode string

const (
	View    Mode = "view"
	Control Mode = "control"
)

// Grant must be supplied only after server signature and device binding checks.
// This controller is not a substitute for cryptographic grant verification.
type Grant struct {
	SessionID string
	TenantID  string
	DeviceID  string
	ActorID   string
	Mode      Mode
	ExpiresAt time.Time
}

type Session struct {
	mu        sync.Mutex
	grant     Grant
	consented bool
	revoked   bool
}

func New(grant Grant, tenantID, deviceID string, now time.Time) (*Session, error) {
	if tenantID == "" || deviceID == "" || grant.SessionID == "" || grant.ActorID == "" || grant.TenantID != tenantID || grant.DeviceID != deviceID {
		return nil, errors.New("remote grant binding mismatch")
	}
	if grant.Mode != View && grant.Mode != Control {
		return nil, errors.New("unsupported remote mode")
	}
	if !grant.ExpiresAt.After(now) || grant.ExpiresAt.After(now.Add(time.Hour)) {
		return nil, errors.New("invalid remote expiry")
	}
	return &Session{grant: grant}, nil
}

// Consent is called by the local attended-session prompt, never a network message.
func (s *Session) Consent(now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.revoked || !now.Before(s.grant.ExpiresAt) {
		return errors.New("remote session ended")
	}
	s.consented = true
	return nil
}

// Authorize must be checked for every frame and every input event.
func (s *Session) Authorize(input bool, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.revoked || !s.consented || !now.Before(s.grant.ExpiresAt) {
		return errors.New("remote session not authorised")
	}
	if input && s.grant.Mode != Control {
		return errors.New("view-only remote session")
	}
	return nil
}

// Revoke is terminal: reconnects cannot silently restore consent.
func (s *Session) Revoke() { s.mu.Lock(); defer s.mu.Unlock(); s.revoked = true; s.consented = false }
