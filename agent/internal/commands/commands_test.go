package commands

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nexusagent/internal/config"
)

func TestExecutePing(t *testing.T) {
	loop := &Loop{}
	command := cmdItem{ID: "cmd-1", Kind: "ping"}

	result := loop.execute(command)

	if result.Status != "ok" {
		t.Fatalf("expected ok status, got %q", result.Status)
	}
	if result.Stdout != "pong" {
		t.Fatalf("expected pong output, got %q", result.Stdout)
	}
}

func TestExecuteRejectsUnsupportedShell(t *testing.T) {
	loop := &Loop{}
	command := cmdItem{ID: "cmd-2", Kind: "run_script"}
	command.Payload.Shell = "zsh"
	command.Payload.Script = "echo should-not-run"

	result := loop.execute(command)

	if result.Status != "error" {
		t.Fatalf("expected error status, got %q", result.Status)
	}
	if !strings.Contains(result.Stderr, "unsupported shell") {
		t.Fatalf("expected unsupported-shell error, got %q", result.Stderr)
	}
}

func TestTruncateBoundsCommandOutput(t *testing.T) {
	result := truncate("abcdef", 3)
	if result != "abc\n...[truncated]" {
		t.Fatalf("unexpected truncated output: %q", result)
	}
}

func signedTestCommand(t *testing.T, cfg *config.Config, privateKey ed25519.PrivateKey, now time.Time) cmdItem {
	t.Helper()
	raw := json.RawMessage(`{"script":"Write-Output 'safe'","timeout_sec":30}`)
	payloadHash, err := hashCanonicalJSON(raw)
	if err != nil {
		t.Fatalf("hash payload: %v", err)
	}
	command := cmdItem{
		ID:         "cmd-signed-1",
		Kind:       "run_powershell",
		PayloadRaw: raw,
	}
	if err := json.Unmarshal(raw, &command.Payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	command.Authorization = commandAuthorization{
		SchemaVersion: 1,
		CommandID:     command.ID,
		DeviceID:      cfg.DeviceID,
		ClientID:      cfg.ClientID,
		Kind:          command.Kind,
		PayloadSHA256: payloadHash,
		IssuedAt:      now.Add(-time.Minute).UTC().Format(time.RFC3339Nano),
		ExpiresAt:     now.Add(4 * time.Minute).UTC().Format(time.RFC3339Nano),
		Nonce:         "nonce-unique-1",
		QueuedBy:      "tech@example.com",
		Privilege:     "system",
		SignatureAlg:  "ed25519",
	}
	a := &command.Authorization
	a.SignedPayload = strings.Join([]string{
		"1", a.CommandID, a.DeviceID, a.ClientID, a.Kind, a.PayloadSHA256,
		a.IssuedAt, a.ExpiresAt, a.Nonce, a.QueuedBy, a.ApprovalID, a.Privilege,
	}, "|")
	publicKey := privateKey.Public().(ed25519.PublicKey)
	a.SigningPublicKey = base64.StdEncoding.EncodeToString(publicKey)
	keyHash := sha256.Sum256(publicKey)
	a.SigningKeyID = hex.EncodeToString(keyHash[:])[:24]
	a.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, []byte(a.SignedPayload)))
	return command
}

func signedTestConfig(t *testing.T) (*config.Config, ed25519.PrivateKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	keyHash := sha256.Sum256(publicKey)
	return &config.Config{
		ClientID: "client-001",
		DeviceID: "device-001",
		PlatformPolicy: &config.PlatformPolicy{
			Commands: map[string]any{
				"signed_envelope_required":   true,
				"maximum_clock_skew_seconds": float64(300),
				"replay_cache_entries":       float64(500),
				"signature_algorithm":        "ed25519",
				"signing_public_key":         base64.StdEncoding.EncodeToString(publicKey),
				"signing_key_id":             hex.EncodeToString(keyHash[:])[:24],
			},
		},
	}, privateKey
}

func TestVerifyAuthorizationAcceptsPinnedSignedCommand(t *testing.T) {
	cfg, privateKey := signedTestConfig(t)
	now := time.Now().UTC()
	command := signedTestCommand(t, cfg, privateKey, now)

	if err := verifyAuthorization(cfg, command, now); err != nil {
		t.Fatalf("expected signed command to verify, got %v", err)
	}
}

func TestVerifyAuthorizationRejectsPayloadTampering(t *testing.T) {
	cfg, privateKey := signedTestConfig(t)
	now := time.Now().UTC()
	command := signedTestCommand(t, cfg, privateKey, now)
	command.PayloadRaw = json.RawMessage(`{"script":"Remove-Item C:\\important","timeout_sec":30}`)

	err := verifyAuthorization(cfg, command, now)
	if err == nil || !strings.Contains(err.Error(), "payload integrity") {
		t.Fatalf("expected payload-integrity rejection, got %v", err)
	}
}

func TestVerifyAuthorizationRejectsExpiredEnvelope(t *testing.T) {
	cfg, privateKey := signedTestConfig(t)
	now := time.Now().UTC()
	command := signedTestCommand(t, cfg, privateKey, now)
	command.Authorization.ExpiresAt = now.Add(-time.Second).UTC().Format(time.RFC3339Nano)

	err := verifyAuthorization(cfg, command, now)
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expiry rejection, got %v", err)
	}
}

func TestAuthorizeRejectsReplayAndPersistsNonce(t *testing.T) {
	cfg, privateKey := signedTestConfig(t)
	now := time.Now().UTC()
	command := signedTestCommand(t, cfg, privateKey, now)
	replayPath := filepath.Join(t.TempDir(), "command-replay.json")
	loop := &Loop{
		cfg:         cfg,
		seenNonces:  map[string]time.Time{},
		replayPath:  replayPath,
		replayLimit: 500,
	}

	if err := loop.authorize(command, now); err != nil {
		t.Fatalf("first authorization should pass: %v", err)
	}
	if err := loop.authorize(command, now); err == nil || !strings.Contains(err.Error(), "already been used") {
		t.Fatalf("expected in-memory replay rejection, got %v", err)
	}

	reloaded := &Loop{
		cfg:         cfg,
		seenNonces:  map[string]time.Time{},
		replayPath:  replayPath,
		replayLimit: 500,
	}
	reloaded.loadReplayCache()
	if err := reloaded.authorize(command, now); err == nil || !strings.Contains(err.Error(), "already been used") {
		t.Fatalf("expected persisted replay rejection, got %v", err)
	}
}
