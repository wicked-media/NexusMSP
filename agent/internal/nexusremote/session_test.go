package nexusremote

import (
	"testing"
	"time"
)

func TestSessionBoundary(t *testing.T) {
	now := time.Now()
	grant := Grant{SessionID: "s", TenantID: "t", DeviceID: "d", ActorID: "a", Mode: View, ExpiresAt: now.Add(time.Minute)}
	if _, err := New(grant, "other", "d", now); err == nil {
		t.Fatal("cross-tenant grant accepted")
	}
	s, err := New(grant, "t", "d", now)
	if err != nil {
		t.Fatal(err)
	}
	if s.Authorize(false, now) == nil {
		t.Fatal("capture before consent")
	}
	if err := s.Consent(now); err != nil {
		t.Fatal(err)
	}
	if err := s.Authorize(false, now); err != nil {
		t.Fatal(err)
	}
	if s.Authorize(true, now) == nil {
		t.Fatal("view grant allowed control")
	}
	if s.Authorize(false, grant.ExpiresAt) == nil {
		t.Fatal("expired session accepted")
	}
	s.Revoke()
	if s.Consent(now) == nil || s.Authorize(false, now) == nil {
		t.Fatal("revoked session revived")
	}
}

func TestControlAndExpiry(t *testing.T) {
	now := time.Now()
	grant := Grant{SessionID: "s", TenantID: "t", DeviceID: "d", ActorID: "a", Mode: Control, ExpiresAt: now.Add(time.Minute)}
	s, err := New(grant, "t", "d", now)
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Consent(now)
	if err := s.Authorize(true, now); err != nil {
		t.Fatal(err)
	}
	grant.ExpiresAt = now.Add(2 * time.Hour)
	if _, err := New(grant, "t", "d", now); err == nil {
		t.Fatal("unbounded grant accepted")
	}
}
