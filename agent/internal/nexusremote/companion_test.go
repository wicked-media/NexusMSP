package nexusremote

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

func TestCoordinatorRequiresLocalConsentBeforeAcknowledging(t *testing.T) {
	pub, private, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now().UTC()
	payload, _ := json.Marshal(grantPayload{Version: 1, SessionID: "session-1", TenantID: "tenant-1", DeviceID: "device-1", ActorID: "tech-1", Mode: View, IssuedAt: now, ExpiresAt: now.Add(time.Minute)})
	delivered := DeliveredGrant{SessionID: "session-1", Mode: View, KeyID: "key-1", PublicKeyB64: base64.StdEncoding.EncodeToString(pub), PayloadB64: base64.StdEncoding.EncodeToString(payload), SignatureB64: base64.StdEncoding.EncodeToString(ed25519.Sign(private, append([]byte(grantDomain), payload...)))}
	var outcome string
	coordinator, err := NewCoordinator(CompanionPolicy{Enabled: true, TenantID: "tenant-1", ManagedDeviceID: "device-1", GrantKeyID: "key-1", GrantPublicKey: delivered.PublicKeyB64}, NewMemoryReplayStore(8), func(string, Mode, time.Time) (bool, string) { return false, "Not now" }, func(_ string, value string, _ string) error { outcome = value; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := coordinator.Process(delivered, now); err == nil {
		t.Fatal("declined consent accepted")
	}
	if outcome != "rejected" {
		t.Fatalf("outcome=%q", outcome)
	}
}

func TestCoordinatorCreatesViewOnlyConsentedSession(t *testing.T) {
	pub, private, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now().UTC()
	payload, _ := json.Marshal(grantPayload{Version: 1, SessionID: "session-2", TenantID: "tenant-1", DeviceID: "device-1", ActorID: "tech-1", Mode: View, IssuedAt: now, ExpiresAt: now.Add(time.Minute)})
	delivered := DeliveredGrant{SessionID: "session-2", Mode: View, KeyID: "key-1", PublicKeyB64: base64.StdEncoding.EncodeToString(pub), PayloadB64: base64.StdEncoding.EncodeToString(payload), SignatureB64: base64.StdEncoding.EncodeToString(ed25519.Sign(private, append([]byte(grantDomain), payload...)))}
	coordinator, _ := NewCoordinator(CompanionPolicy{Enabled: true, TenantID: "tenant-1", ManagedDeviceID: "device-1", GrantKeyID: "key-1", GrantPublicKey: delivered.PublicKeyB64}, NewMemoryReplayStore(8), func(string, Mode, time.Time) (bool, string) { return true, "" }, func(string, string, string) error { return nil })
	session, err := coordinator.Process(delivered, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Authorize(false, now); err != nil {
		t.Fatal(err)
	}
	if err := session.Authorize(true, now); err == nil {
		t.Fatal("view grant permitted input")
	}
}

func TestCoordinatorAcceptsSignedStandingAuthorisationWithoutPrompt(t *testing.T) {
	pub, private, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now().UTC()
	noConsent := false
	payload, _ := json.Marshal(grantPayload{Version: 2, SessionID: "session-3", TenantID: "tenant-1", DeviceID: "device-1", ActorID: "tech-1", Mode: View, IssuedAt: now, ExpiresAt: now.Add(time.Minute), ConsentRequired: &noConsent, TechnicianName: "Nexus Support", Purpose: "Scheduled maintenance"})
	delivered := DeliveredGrant{SessionID: "session-3", Mode: View, KeyID: "key-1", PublicKeyB64: base64.StdEncoding.EncodeToString(pub), PayloadB64: base64.StdEncoding.EncodeToString(payload), SignatureB64: base64.StdEncoding.EncodeToString(ed25519.Sign(private, append([]byte(grantDomain), payload...)))}
	prompted := false
	coordinator, err := NewCoordinator(CompanionPolicy{Enabled: true, TenantID: "tenant-1", ManagedDeviceID: "device-1", GrantKeyID: "key-1", GrantPublicKey: delivered.PublicKeyB64}, NewMemoryReplayStore(8), func(string, Mode, time.Time) (bool, string) { prompted = true; return false, "must not be called" }, func(string, string, string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	session, err := coordinator.Process(delivered, now)
	if err != nil {
		t.Fatal(err)
	}
	if prompted {
		t.Fatal("standing authorisation displayed an attended prompt")
	}
	if err := session.Authorize(false, now); err != nil {
		t.Fatal(err)
	}
}

func TestCoordinatorAcceptsSignedAttendedControlGrant(t *testing.T) {
	pub, private, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now().UTC()
	payload, _ := json.Marshal(grantPayload{Version: 1, SessionID: "session-control", TenantID: "tenant-1", DeviceID: "device-1", ActorID: "tech-1", Mode: Control, IssuedAt: now, ExpiresAt: now.Add(time.Minute)})
	delivered := DeliveredGrant{SessionID: "session-control", Mode: Control, KeyID: "key-1", PublicKeyB64: base64.StdEncoding.EncodeToString(pub), PayloadB64: base64.StdEncoding.EncodeToString(payload), SignatureB64: base64.StdEncoding.EncodeToString(ed25519.Sign(private, append([]byte(grantDomain), payload...)))}
	coordinator, err := NewCoordinator(CompanionPolicy{Enabled: true, TenantID: "tenant-1", ManagedDeviceID: "device-1", GrantKeyID: "key-1", GrantPublicKey: delivered.PublicKeyB64}, NewMemoryReplayStore(8), func(string, Mode, time.Time) (bool, string) { return true, "" }, func(string, string, string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	session, err := coordinator.Process(delivered, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Authorize(true, now); err != nil {
		t.Fatal(err)
	}
}
