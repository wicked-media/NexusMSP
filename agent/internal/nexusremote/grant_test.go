package nexusremote

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"testing"
	"time"
)

func TestSignedGrant(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now().UTC()
	data, _ := json.Marshal(grantPayload{Version: 1, SessionID: "session", TenantID: "tenant", DeviceID: "device", ActorID: "tech", Mode: View, IssuedAt: now, ExpiresAt: now.Add(time.Minute)})
	envelope := SignedGrant{Payload: data, Signature: ed25519.Sign(priv, append([]byte(grantDomain), data...))}
	verifier, _ := NewVerifier(pub)
	if _, err := verifier.Accept(envelope, "other", "device", now); err == nil {
		t.Fatal("cross tenant accepted")
	}
	session, err := verifier.Accept(envelope, "tenant", "device", now)
	if err != nil {
		t.Fatal(err)
	}
	if session.Authorize(false, now) == nil {
		t.Fatal("signature bypassed local consent")
	}
	if _, err := verifier.Accept(envelope, "tenant", "device", now); err == nil {
		t.Fatal("replay accepted")
	}
	envelope.Payload = append(envelope.Payload, ' ')
	if _, err := verifier.Accept(envelope, "tenant", "device", now); err == nil {
		t.Fatal("tampering accepted")
	}
}

func TestInvalidTrustKey(t *testing.T) {
	if _, err := NewVerifier(nil); err == nil {
		t.Fatal("empty key accepted")
	}
}
