// Package commands polls the server for pending commands, executes them, and reports results.
package commands

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"nexusagent/internal/canary"
	"nexusagent/internal/config"
	"nexusagent/internal/identity"
	"nexusagent/internal/transport"
)

type Loop struct {
	tr          *transport.Client
	cfg         *config.Config
	every       time.Duration
	seenNonces  map[string]time.Time
	replayPath  string
	replayLimit int
}

func NewLoop(tr *transport.Client, cfg *config.Config, fallback time.Duration) *Loop {
	every := time.Duration(cfg.PollSecs) * time.Second
	if every <= 0 {
		every = fallback
	}
	loop := &Loop{
		tr:          tr,
		cfg:         cfg,
		every:       every,
		seenNonces:  map[string]time.Time{},
		replayPath:  filepath.Join(cfg.BaseDir(), "command-replay.json"),
		replayLimit: commandReplayLimit(cfg),
	}
	loop.loadReplayCache()
	return loop
}

type commandPayload struct {
	Script        string   `json:"script,omitempty"`
	Shell         string   `json:"shell,omitempty"` // powershell | cmd | bash
	Timeout       int      `json:"timeout_sec,omitempty"`
	PID           int      `json:"pid,omitempty"`
	Delay         int      `json:"delay_sec,omitempty"`
	ProgramPath   string   `json:"program_path,omitempty"`
	Arguments     []string `json:"arguments,omitempty"`
	SHA256        string   `json:"sha256,omitempty"`
	TraySHA256    string   `json:"tray_sha256,omitempty"`
	RemoteSHA256  string   `json:"remote_sha256,omitempty"`
	ApprovedUntil string   `json:"approved_until,omitempty"`
	CanaryID      string   `json:"canary_id,omitempty"`
	CanaryPath    string   `json:"canary_path,omitempty"`
	Actions       []string `json:"actions,omitempty"`
	Reason        string   `json:"reason,omitempty"`
	Provider      string   `json:"provider,omitempty"`
	TransferID    string   `json:"transfer_id,omitempty"`
	Destination   string   `json:"destination,omitempty"`
	SourcePath    string   `json:"source_path,omitempty"`
	Directory     string   `json:"directory,omitempty"`
}

type commandAuthorization struct {
	SchemaVersion    int    `json:"schema_version"`
	CommandID        string `json:"command_id"`
	DeviceID         string `json:"device_id"`
	ClientID         string `json:"client_id"`
	Kind             string `json:"kind"`
	PayloadSHA256    string `json:"payload_sha256"`
	IssuedAt         string `json:"issued_at"`
	ExpiresAt        string `json:"expires_at"`
	Nonce            string `json:"nonce"`
	QueuedBy         string `json:"queued_by"`
	ApprovalID       string `json:"approval_id"`
	Privilege        string `json:"privilege"`
	SignatureAlg     string `json:"signature_algorithm"`
	Signature        string `json:"signature"`
	SigningPublicKey string `json:"signing_public_key"`
	SigningKeyID     string `json:"signing_key_id"`
	SignedPayload    string `json:"signed_payload"`
}

type cmdItem struct {
	ID            string               `json:"id"`
	Kind          string               `json:"kind"` // run_script, reboot, shutdown, run_powershell, run_cmd, file_transfer_download and governed maintenance commands
	Payload       commandPayload       `json:"payload"`
	PayloadRaw    json.RawMessage      `json:"-"`
	Authorization commandAuthorization `json:"authorization"`
}

func (c *cmdItem) UnmarshalJSON(data []byte) error {
	var wire struct {
		ID            string               `json:"id"`
		Kind          string               `json:"kind"`
		Payload       json.RawMessage      `json:"payload"`
		Authorization commandAuthorization `json:"authorization"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	c.ID = wire.ID
	c.Kind = wire.Kind
	c.Authorization = wire.Authorization
	c.PayloadRaw = append(c.PayloadRaw[:0], wire.Payload...)
	if len(wire.Payload) == 0 || string(wire.Payload) == "null" {
		c.PayloadRaw = json.RawMessage("{}")
		return nil
	}
	return json.Unmarshal(wire.Payload, &c.Payload)
}

type cmdResult struct {
	ID         string `json:"id"`
	Nonce      string `json:"nonce"`
	Status     string `json:"status"` // ok | error | timeout
	ExitCode   int    `json:"exit_code"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMs int64  `json:"duration_ms"`
}

func (l *Loop) Run(ctx context.Context) {
	t := time.NewTicker(l.every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			l.pollOnce()
		}
	}
}

func (l *Loop) pollOnce() {
	var resp struct {
		Commands []cmdItem `json:"commands"`
	}
	if err := l.tr.Do("GET", "/api/nexus-agent/commands/poll", nil, &resp); err != nil {
		log.Printf("[cmd] poll error: %v", err)
		return
	}
	for _, c := range resp.Commands {
		if err := l.authorize(c, time.Now()); err != nil {
			log.Printf("[cmd] rejected command %s: %v", c.ID, err)
			res := cmdResult{
				ID:     c.ID,
				Nonce:  c.Authorization.Nonce,
				Status: "error",
				Stderr: "command authorization rejected: " + err.Error(),
			}
			if reportErr := l.tr.Do("POST", "/api/nexus-agent/command-result", res, nil); reportErr != nil {
				log.Printf("[cmd] rejection report error: %v", reportErr)
			}
			continue
		}
		res := l.execute(c)
		res.Nonce = c.Authorization.Nonce
		if err := l.tr.Do("POST", "/api/nexus-agent/command-result", res, nil); err != nil {
			log.Printf("[cmd] report error: %v", err)
		}
	}
}

func (l *Loop) authorize(c cmdItem, now time.Time) error {
	if err := verifyAuthorization(l.cfg, c, now); err != nil {
		return err
	}
	if l.seenNonces == nil {
		l.seenNonces = map[string]time.Time{}
	}
	if _, exists := l.seenNonces[c.Authorization.Nonce]; exists {
		return fmt.Errorf("authorization nonce has already been used")
	}
	expiresAt, _ := time.Parse(time.RFC3339, c.Authorization.ExpiresAt)
	l.seenNonces[c.Authorization.Nonce] = expiresAt
	l.pruneReplayCache(now)
	l.saveReplayCache()
	return nil
}

func verifyAuthorization(cfg *config.Config, c cmdItem, now time.Time) error {
	if cfg == nil || cfg.PlatformPolicy == nil {
		return fmt.Errorf("signed command policy is unavailable")
	}
	policy := cfg.PlatformPolicy.Commands
	if !mapBool(policy, "signed_envelope_required") {
		return fmt.Errorf("signed command policy is not enabled")
	}
	a := c.Authorization
	if a.SchemaVersion != 1 || a.CommandID == "" || a.Nonce == "" {
		return fmt.Errorf("authorization envelope is incomplete")
	}
	if a.CommandID != c.ID || a.Kind != c.Kind {
		return fmt.Errorf("command identity does not match authorization")
	}
	if a.DeviceID != cfg.DeviceID || a.ClientID != cfg.ClientID {
		return fmt.Errorf("command is not authorized for this endpoint")
	}
	if a.SignatureAlg != "ed25519" {
		return fmt.Errorf("unsupported command signature algorithm")
	}
	pinnedKey := mapString(policy, "signing_public_key")
	if pinnedKey == "" || a.SigningPublicKey != pinnedKey {
		return fmt.Errorf("command signing key does not match pinned policy")
	}
	if expectedKeyID := mapString(policy, "signing_key_id"); expectedKeyID != "" && a.SigningKeyID != expectedKeyID {
		return fmt.Errorf("command signing key identity does not match policy")
	}

	issuedAt, err := time.Parse(time.RFC3339, a.IssuedAt)
	if err != nil {
		return fmt.Errorf("invalid command issue time")
	}
	expiresAt, err := time.Parse(time.RFC3339, a.ExpiresAt)
	if err != nil {
		return fmt.Errorf("invalid command expiry time")
	}
	skew := time.Duration(mapInt(policy, "maximum_clock_skew_seconds", 300)) * time.Second
	if issuedAt.After(now.Add(skew)) {
		return fmt.Errorf("command issue time is in the future")
	}
	if !expiresAt.After(now) {
		return fmt.Errorf("command authorization has expired")
	}
	if !expiresAt.After(issuedAt) || expiresAt.Sub(issuedAt) > 15*time.Minute {
		return fmt.Errorf("command authorization lifetime is invalid")
	}

	payloadHash, err := hashCanonicalJSON(c.PayloadRaw)
	if err != nil {
		return fmt.Errorf("invalid command payload: %w", err)
	}
	if payloadHash != a.PayloadSHA256 {
		return fmt.Errorf("command payload integrity check failed")
	}
	expectedPayload := strings.Join([]string{
		fmt.Sprintf("%d", a.SchemaVersion),
		a.CommandID,
		a.DeviceID,
		a.ClientID,
		a.Kind,
		a.PayloadSHA256,
		a.IssuedAt,
		a.ExpiresAt,
		a.Nonce,
		a.QueuedBy,
		a.ApprovalID,
		a.Privilege,
	}, "|")
	if a.SignedPayload != expectedPayload {
		return fmt.Errorf("signed command fields do not match authorization")
	}
	publicKey, err := base64.StdEncoding.DecodeString(pinnedKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return fmt.Errorf("pinned command signing key is invalid")
	}
	signature, err := base64.StdEncoding.DecodeString(a.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return fmt.Errorf("command signature is invalid")
	}
	if !ed25519.Verify(ed25519.PublicKey(publicKey), []byte(expectedPayload), signature) {
		return fmt.Errorf("command signature verification failed")
	}
	return nil
}

func hashCanonicalJSON(raw json.RawMessage) (string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		raw = json.RawMessage("{}")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return "", err
	}
	var canonical bytes.Buffer
	encoder := json.NewEncoder(&canonical)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return "", err
	}
	data := bytes.TrimSuffix(canonical.Bytes(), []byte("\n"))
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

func mapString(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return value
}

func mapBool(values map[string]any, key string) bool {
	value, _ := values[key].(bool)
	return value
}

func mapInt(values map[string]any, key string, fallback int) int {
	switch value := values[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	case json.Number:
		parsed, err := value.Int64()
		if err == nil {
			return int(parsed)
		}
	}
	return fallback
}

func commandReplayLimit(cfg *config.Config) int {
	if cfg == nil || cfg.PlatformPolicy == nil {
		return 500
	}
	limit := mapInt(cfg.PlatformPolicy.Commands, "replay_cache_entries", 500)
	if limit < 100 {
		return 100
	}
	if limit > 5000 {
		return 5000
	}
	return limit
}

func (l *Loop) pruneReplayCache(now time.Time) {
	for nonce, expiresAt := range l.seenNonces {
		if !expiresAt.After(now) {
			delete(l.seenNonces, nonce)
		}
	}
	limit := l.replayLimit
	if limit <= 0 {
		limit = 500
	}
	for len(l.seenNonces) > limit {
		var oldestNonce string
		var oldestExpiry time.Time
		for nonce, expiresAt := range l.seenNonces {
			if oldestNonce == "" || expiresAt.Before(oldestExpiry) {
				oldestNonce = nonce
				oldestExpiry = expiresAt
			}
		}
		delete(l.seenNonces, oldestNonce)
	}
}

func (l *Loop) loadReplayCache() {
	if l.replayPath == "" {
		return
	}
	data, err := os.ReadFile(l.replayPath)
	if err != nil {
		return
	}
	var stored map[string]string
	if err := json.Unmarshal(data, &stored); err != nil {
		log.Printf("[cmd] ignored invalid replay cache: %v", err)
		return
	}
	now := time.Now()
	for nonce, rawExpiry := range stored {
		expiresAt, parseErr := time.Parse(time.RFC3339, rawExpiry)
		if parseErr == nil && expiresAt.After(now) {
			l.seenNonces[nonce] = expiresAt
		}
	}
	l.pruneReplayCache(now)
}

func (l *Loop) saveReplayCache() {
	if l.replayPath == "" {
		return
	}
	stored := make(map[string]string, len(l.seenNonces))
	for nonce, expiresAt := range l.seenNonces {
		stored[nonce] = expiresAt.UTC().Format(time.RFC3339Nano)
	}
	data, err := json.Marshal(stored)
	if err != nil {
		log.Printf("[cmd] replay cache encode error: %v", err)
		return
	}
	tmp := l.replayPath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		log.Printf("[cmd] replay cache write error: %v", err)
		return
	}
	if err := os.Rename(tmp, l.replayPath); err != nil {
		log.Printf("[cmd] replay cache commit error: %v", err)
	}
}

func (l *Loop) execute(c cmdItem) (res cmdResult) {
	start := time.Now()
	res = cmdResult{ID: c.ID, Status: "ok"}
	defer func() { res.DurationMs = time.Since(start).Milliseconds() }()

	timeout := time.Duration(c.Payload.Timeout) * time.Second
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	switch c.Kind {
	case "run_script", "run_powershell", "run_cmd":
		shell := c.Payload.Shell
		if shell == "" {
			if c.Kind == "run_cmd" {
				shell = "cmd"
			}
			if c.Kind == "run_powershell" {
				shell = "powershell"
			}
			if shell == "" {
				shell = defaultShell()
			}
		}
		var cmd *exec.Cmd
		switch shell {
		case "powershell":
			cmd = exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", c.Payload.Script)
		case "cmd":
			cmd = exec.CommandContext(ctx, "cmd", "/C", c.Payload.Script)
		case "bash":
			cmd = exec.CommandContext(ctx, "bash", "-c", c.Payload.Script)
		default:
			res.Status = "error"
			res.Stderr = "unsupported shell: " + shell
			return res
		}
		var so, se bytes.Buffer
		cmd.Stdout = &so
		cmd.Stderr = &se
		err := cmd.Run()
		res.Stdout = truncate(so.String(), 64*1024)
		res.Stderr = truncate(se.String(), 16*1024)
		if cmd.ProcessState != nil {
			res.ExitCode = cmd.ProcessState.ExitCode()
		}
		if ctx.Err() == context.DeadlineExceeded {
			res.Status = "timeout"
		} else if err != nil {
			res.Status = "error"
		}

	case "reboot":
		go func() {
			time.Sleep(time.Duration(maxInt(c.Payload.Delay, 5)) * time.Second)
			_ = rebootCmd().Run()
		}()
		res.Stdout = "reboot scheduled"

	case "shutdown":
		go func() {
			time.Sleep(time.Duration(maxInt(c.Payload.Delay, 5)) * time.Second)
			_ = shutdownCmd().Run()
		}()
		res.Stdout = "shutdown scheduled"

	case "kill_process":
		if c.Payload.PID <= 0 {
			res.Status = "error"
			res.Stderr = "no PID provided"
			return res
		}
		if err := killProcess(c.Payload.PID); err != nil {
			res.Status = "error"
			res.Stderr = err.Error()
		}

	case "elevate_launch":
		res = executeApprovedElevation(ctx, c, res)
		return res

	case "install_companion":
		res = installCompanion(l.tr, c, res)
		return res

	case "install_remote_companion":
		res = installRemoteCompanion(l.tr, c, res)
		return res

	case "canary_deploy":
		res = deployRansomwareCanary(c, res)
		return res

	case "agent_repair":
		evidence, err := identity.Repair(l.cfg, c.Payload.Actions)
		if err != nil {
			res.Status = "error"
			res.Stderr = err.Error()
			return res
		}
		for _, action := range c.Payload.Actions {
			if strings.EqualFold(strings.TrimSpace(action), "companion") && runtime.GOOS == "windows" {
				executable, locateErr := os.Executable()
				if locateErr != nil {
					evidence.Status = "attention"
					evidence.Details["companion"] = locateErr.Error()
					continue
				}
				companion := filepath.Join(filepath.Dir(executable), "nexus-client-chat.exe")
				if _, statErr := os.Stat(companion); statErr != nil {
					evidence.Status = "attention"
					evidence.Details["companion"] = "nexus-client-chat.exe is missing"
					continue
				}
				if _, shortcutErr := installCompanionStartMenuEntry(companion); shortcutErr != nil {
					evidence.Status = "attention"
					evidence.Details["companion"] = shortcutErr.Error()
				} else {
					evidence.Repairs = append(evidence.Repairs, "companion_start_menu_rewritten")
				}
			}
		}
		encoded, err := json.Marshal(evidence)
		if err != nil {
			res.Status = "error"
			res.Stderr = err.Error()
			return res
		}
		res.Stdout = string(encoded)
		return res

	case "remote_repair":
		res = repairRemoteAccess(ctx, c, res)
		return res

	case "file_transfer_download":
		return downloadFileTransfer(l.tr, c, res)

	case "file_transfer_upload":
		return uploadFileTransfer(l.tr, c, res)

	case "file_browser_list":
		return listDirectory(c, res)

	case "ping":
		res.Stdout = "pong"

	default:
		res.Status = "error"
		res.Stderr = fmt.Sprintf("unknown command kind: %s", c.Kind)
	}
	return res
}

func downloadFileTransfer(client *transport.Client, c cmdItem, res cmdResult) cmdResult {
	if client == nil || strings.TrimSpace(c.Payload.TransferID) == "" || strings.TrimSpace(c.Payload.Destination) == "" {
		res.Status, res.Stderr = "error", "file transfer command is incomplete"
		return res
	}
	destination := filepath.Clean(c.Payload.Destination)
	if !filepath.IsAbs(destination) || destination == filepath.VolumeName(destination)+string(filepath.Separator) {
		res.Status, res.Stderr = "error", "file transfer destination must be a non-root absolute path"
		return res
	}
	if _, err := os.Stat(destination); err == nil {
		res.Status, res.Stderr = "error", "file transfer will not overwrite an existing destination"
		return res
	}
	if _, err := os.Stat(filepath.Dir(destination)); err != nil {
		res.Status, res.Stderr = "error", "file transfer destination directory does not exist"
		return res
	}
	temporary := destination + ".nexus-transfer-partial"
	defer os.Remove(temporary)
	if err := client.Download("/api/nexus-agent/file-transfers/"+url.PathEscape(c.Payload.TransferID)+"/content", temporary); err != nil {
		res.Status, res.Stderr = "error", err.Error()
		return res
	}
	file, err := os.Open(temporary)
	if err != nil {
		res.Status, res.Stderr = "error", err.Error()
		return res
	}
	digest := sha256.New()
	_, copyErr := io.Copy(digest, file)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || !strings.EqualFold(hex.EncodeToString(digest.Sum(nil)), strings.TrimSpace(c.Payload.SHA256)) {
		res.Status, res.Stderr = "error", "file transfer SHA-256 verification failed"
		return res
	}
	if err := os.Rename(temporary, destination); err != nil {
		res.Status, res.Stderr = "error", err.Error()
		return res
	}
	res.Stdout = "file transfer completed: " + destination
	return res
}

func uploadFileTransfer(client *transport.Client, c cmdItem, res cmdResult) cmdResult {
	if client == nil || strings.TrimSpace(c.Payload.TransferID) == "" || strings.TrimSpace(c.Payload.SourcePath) == "" {
		res.Status, res.Stderr = "error", "file retrieval command is incomplete"
		return res
	}
	source := filepath.Clean(c.Payload.SourcePath)
	info, err := os.Stat(source)
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > 25*1024*1024 {
		res.Status, res.Stderr = "error", "endpoint source must be an existing regular file no larger than 25MB"
		return res
	}
	file, err := os.Open(source)
	if err != nil {
		res.Status, res.Stderr = "error", err.Error()
		return res
	}
	digest := sha256.New()
	_, copyErr := io.Copy(digest, file)
	_ = file.Close()
	if copyErr != nil {
		res.Status, res.Stderr = "error", copyErr.Error()
		return res
	}
	sha := hex.EncodeToString(digest.Sum(nil))
	if err := client.Upload("/api/nexus-agent/file-transfers/"+url.PathEscape(c.Payload.TransferID)+"/content", source, sha); err != nil {
		res.Status, res.Stderr = "error", err.Error()
		return res
	}
	res.Stdout = "file retrieval staged: " + filepath.Base(source)
	return res
}

// listDirectory is deliberately read-only. The Agent returns a bounded direct
// listing only; browsing never grants the browser a filesystem handle.
func listDirectory(c cmdItem, res cmdResult) cmdResult {
	directory := filepath.Clean(strings.TrimSpace(c.Payload.Directory))
	if !filepath.IsAbs(directory) {
		res.Status, res.Stderr = "error", "directory must be an absolute path"
		return res
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		res.Status, res.Stderr = "error", err.Error()
		return res
	}
	type entry struct {
		Name      string `json:"name"`
		Path      string `json:"path"`
		Directory bool   `json:"directory"`
		Size      int64  `json:"size,omitempty"`
		Modified  string `json:"modified,omitempty"`
	}
	capacity := len(entries)
	if capacity > 250 {
		capacity = 250
	}
	result := make([]entry, 0, capacity)
	for _, item := range entries {
		if len(result) == 250 {
			break
		}
		info, infoErr := item.Info()
		if infoErr != nil {
			continue
		}
		result = append(result, entry{Name: item.Name(), Path: filepath.Join(directory, item.Name()), Directory: item.IsDir(), Size: info.Size(), Modified: info.ModTime().UTC().Format(time.RFC3339)})
	}
	encoded, err := json.Marshal(struct {
		Directory string  `json:"directory"`
		Entries   []entry `json:"entries"`
		Truncated bool    `json:"truncated"`
	}{directory, result, len(entries) > len(result)})
	if err != nil {
		res.Status, res.Stderr = "error", err.Error()
		return res
	}
	res.Stdout = truncate(string(encoded), 64*1024)
	return res
}

// repairRemoteAccess remains a safe compatibility response for already queued
// commands. Native Remote has no provider-service repair path: its signed
// companion is verified by the agent policy and attended access is granted per
// session. In particular, this must never start a retired RustDesk service.
func repairRemoteAccess(ctx context.Context, c cmdItem, res cmdResult) cmdResult {
	_ = ctx
	_ = c
	res.Status = "error"
	res.Stderr = "remote provider repair is retired; Native Remote requires a policy-verified companion and a new attended session"
	return res
}

// executeApprovedElevation is intentionally narrower than the existing
// technician command runner. It never invokes a shell: the API approves one
// absolute .exe path, exact argv values, a SHA-256 fingerprint and an expiry.
// The Windows service performs a final fingerprint check immediately before
// it starts the process, so a swapped executable cannot inherit approval.
func executeApprovedElevation(ctx context.Context, c cmdItem, res cmdResult) cmdResult {
	if runtime.GOOS != "windows" {
		res.Status = "error"
		res.Stderr = "native elevation is currently supported on Windows endpoints only"
		return res
	}
	path := strings.TrimSpace(c.Payload.ProgramPath)
	if path == "" || !filepath.IsAbs(path) || !strings.HasSuffix(strings.ToLower(path), ".exe") {
		res.Status = "error"
		res.Stderr = "approved elevation requires an absolute .exe path"
		return res
	}
	if len(c.Payload.Arguments) > 64 {
		res.Status = "error"
		res.Stderr = "approved elevation contains too many arguments"
		return res
	}
	for _, arg := range c.Payload.Arguments {
		if strings.ContainsAny(arg, "\r\n\x00") {
			res.Status = "error"
			res.Stderr = "approved elevation contains an invalid argument"
			return res
		}
	}
	until, err := time.Parse(time.RFC3339, c.Payload.ApprovedUntil)
	if err != nil || !time.Now().UTC().Before(until.UTC()) {
		res.Status = "error"
		res.Stderr = "elevation approval has expired"
		return res
	}
	actualHash, err := fileSHA256(path)
	if err != nil {
		res.Status = "error"
		res.Stderr = "unable to fingerprint approved executable: " + err.Error()
		return res
	}
	if !strings.EqualFold(actualHash, strings.TrimSpace(c.Payload.SHA256)) {
		res.Status = "error"
		res.Stderr = "executable fingerprint does not match the approved request"
		return res
	}

	cmd := exec.CommandContext(ctx, path, c.Payload.Arguments...)
	var so, se bytes.Buffer
	cmd.Stdout = &so
	cmd.Stderr = &se
	err = cmd.Run()
	res.Stdout = truncate(so.String(), 64*1024)
	res.Stderr = truncate(se.String(), 16*1024)
	if cmd.ProcessState != nil {
		res.ExitCode = cmd.ProcessState.ExitCode()
	}
	if ctx.Err() == context.DeadlineExceeded {
		res.Status = "timeout"
	} else if err != nil {
		res.Status = "error"
	}
	return res
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// installCompanion fetches the signed-in user's local support companion from
// the NexusMSP server. The command is only queued by the dedicated backend
// rollout endpoint and the fingerprint is verified before replacing a binary.
func installCompanion(tr *transport.Client, c cmdItem, res cmdResult) cmdResult {
	if runtime.GOOS != "windows" {
		res.Status = "error"
		res.Stderr = "the Nexus Client Chat and Tray companions are currently supported on Windows endpoints only"
		return res
	}
	chatHash := strings.TrimSpace(c.Payload.SHA256)
	trayHash := strings.TrimSpace(c.Payload.TraySHA256)
	if chatHash != "" && len(chatHash) != 64 {
		res.Status = "error"
		res.Stderr = "client chat rollout has an invalid expected SHA-256"
		return res
	}
	if trayHash != "" && len(trayHash) != 64 {
		res.Status = "error"
		res.Stderr = "tray rollout has an invalid expected SHA-256"
		return res
	}
	executable, err := os.Executable()
	if err != nil {
		res.Status = "error"
		res.Stderr = "could not locate agent install directory: " + err.Error()
		return res
	}
	installDir := filepath.Dir(executable)
	chatPath := filepath.Join(installDir, "nexus-client-chat.exe")
	if err := installVerifiedCompanion(tr, "/api/nexus-agent/companion/latest", chatPath, chatHash, "Nexus Client Chat"); err != nil {
		res.Status = "error"
		res.Stderr = err.Error()
		return res
	}
	res.Stdout = "Nexus Client Chat companion installed successfully"
	if launcherPath, err := installCompanionStartMenuEntry(chatPath); err != nil {
		res.Stdout += "; the Start Menu launcher could not be created: " + err.Error()
	} else {
		res.Stdout += "; Start Menu launcher created at " + launcherPath
	}
	if trayHash != "" {
		trayPath := filepath.Join(installDir, "nexus-agent-tray.exe")
		if err := installVerifiedCompanion(tr, "/api/nexus-agent/tray/latest", trayPath, trayHash, "Nexus Agent Tray"); err != nil {
			res.Status = "error"
			res.Stderr = err.Error()
			return res
		}
		if err := installTrayLauncher(trayPath); err != nil {
			res.Status = "error"
			res.Stderr = "Nexus Agent Tray was installed but could not be registered for user sign-in: " + err.Error()
			return res
		}
		res.Stdout += "; Nexus Agent Tray installed and registered for sign-in"
	}
	return res
}

// installRemoteCompanion updates only the protected service's Native Remote
// companion. The command is server-signed, the agent verifies the exact
// artifact hash, and the service deliberately never launches a GUI into a
// user session; the normal user-session Run registration starts it at sign-in.
func installRemoteCompanion(tr *transport.Client, c cmdItem, res cmdResult) cmdResult {
	if runtime.GOOS != "windows" {
		res.Status = "error"
		res.Stderr = "Nexus Remote Companion is currently supported on Windows endpoints only"
		return res
	}
	expectedHash := strings.TrimSpace(c.Payload.RemoteSHA256)
	if len(expectedHash) != 64 {
		res.Status = "error"
		res.Stderr = "remote companion rollout has an invalid expected SHA-256"
		return res
	}
	executable, err := os.Executable()
	if err != nil {
		res.Status = "error"
		res.Stderr = "could not locate agent install directory: " + err.Error()
		return res
	}
	installDir := filepath.Dir(executable)
	// A running user-session companion holds the executable image open. Stop
	// only this named component before its hash-checked replacement; it starts
	// again at the next sign-in and never inherits the service's Session 0.
	_ = exec.Command("taskkill", "/F", "/IM", "nexus-remote-companion.exe").Run()
	remotePath := filepath.Join(installDir, "nexus-remote-companion.exe")
	backupPath, hadBackup, err := backupCompanionForRollback(remotePath)
	if err != nil {
		res.Status = "error"
		res.Stderr = "could not create a verified Remote Companion rollback copy: " + err.Error()
		return res
	}
	if err := installVerifiedCompanion(tr, "/api/nexus-agent/remote-companion/latest", remotePath, expectedHash, "Nexus Remote Companion"); err != nil {
		res.Status = "error"
		res.Stderr = err.Error()
		return res
	}
	if err := installRemoteCompanionLauncher(remotePath); err != nil {
		if hadBackup {
			if rollbackErr := restoreCompanionFromRollback(remotePath, backupPath); rollbackErr != nil {
				res.Status = "error"
				res.Stderr = "Nexus Remote Companion registration failed and rollback also failed: " + rollbackErr.Error()
				return res
			}
			_ = installRemoteCompanionLauncher(remotePath)
			res.Status = "error"
			res.Stderr = "Nexus Remote Companion registration failed; the prior verified companion was restored: " + err.Error()
			return res
		}
		res.Status = "error"
		res.Stderr = "Nexus Remote Companion was installed but could not be registered for user sign-in: " + err.Error()
		return res
	}
	res.Stdout = "Nexus Remote Companion installed, hash-verified and registered for user sign-in"
	if hadBackup {
		res.Stdout += "; a prior verified build is retained for recovery"
	}
	return res
}

// backupCompanionForRollback retains one known-good binary before a signed
// update replaces it. The copied bytes are fingerprinted before use so a
// damaged local executable can never become a recovery artifact.
func backupCompanionForRollback(destination string) (string, bool, error) {
	if _, err := os.Stat(destination); err != nil {
		if os.IsNotExist(err) {
			return destination + ".previous", false, nil
		}
		return "", false, err
	}
	backup := destination + ".previous"
	temporary := backup + ".download"
	defer os.Remove(temporary)
	if err := copyFile(destination, temporary); err != nil {
		return "", false, err
	}
	sourceHash, err := fileSHA256(destination)
	if err != nil {
		return "", false, err
	}
	backupHash, err := fileSHA256(temporary)
	if err != nil {
		return "", false, err
	}
	if !strings.EqualFold(sourceHash, backupHash) {
		return "", false, errors.New("rollback copy fingerprint mismatch")
	}
	if err := os.Remove(backup); err != nil && !os.IsNotExist(err) {
		return "", false, err
	}
	if err := os.Rename(temporary, backup); err != nil {
		return "", false, err
	}
	return backup, true, nil
}

func restoreCompanionFromRollback(destination, backup string) error {
	if err := os.Remove(destination); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(backup, destination)
}

func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func installVerifiedCompanion(tr *transport.Client, route, destination, expectedHash, name string) error {
	temporary := destination + ".download"
	defer os.Remove(temporary)
	if err := tr.Download(route, temporary); err != nil {
		return fmt.Errorf("could not download %s: %w", name, err)
	}
	actualHash, err := fileSHA256(temporary)
	if err != nil {
		return fmt.Errorf("could not fingerprint %s: %w", name, err)
	}
	if expectedHash != "" && !strings.EqualFold(actualHash, expectedHash) {
		return fmt.Errorf("%s fingerprint did not match the rollout command", name)
	}
	if err := os.Remove(destination); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("could not replace %s; close it and retry: %w", name, err)
	}
	if err := os.Rename(temporary, destination); err != nil {
		return fmt.Errorf("could not install %s: %w", name, err)
	}
	return nil
}

func installTrayLauncher(trayPath string) error {
	value := `"` + trayPath + `"`
	out, err := exec.Command(
		"reg", "add", `HKLM\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v", "NexusAgentTray", "/t", "REG_SZ", "/d", value, "/f",
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("register tray launcher: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func installRemoteCompanionLauncher(remotePath string) error {
	value := `"` + remotePath + `"`
	out, err := exec.Command(
		"reg", "add", `HKLM\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v", "NexusRemoteCompanion", "/t", "REG_SZ", "/d", value, "/f",
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("register remote companion launcher: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// installCompanionStartMenuEntry gives the signed-in endpoint user a normal
// Windows entry point for the companion. The agent service never launches a
// GUI into another user's session; the user opens this local companion when
// they want to chat with support or request a controlled elevation.
func installCompanionStartMenuEntry(companionPath string) (string, error) {
	programData := strings.TrimSpace(os.Getenv("ProgramData"))
	if programData == "" {
		return "", fmt.Errorf("ProgramData is unavailable")
	}
	launcherDir := filepath.Join(programData, "Microsoft", "Windows", "Start Menu", "Programs", "NexusMSP")
	if err := os.MkdirAll(launcherDir, 0o755); err != nil {
		return "", err
	}
	launcherPath := filepath.Join(launcherDir, "Nexus Client Chat.cmd")
	contents := "@echo off\r\nstart \"\" \"" + companionPath + "\"\r\n"
	if err := os.WriteFile(launcherPath, []byte(contents), 0o644); err != nil {
		return "", err
	}
	return launcherPath, nil
}

func deployRansomwareCanary(c cmdItem, res cmdResult) cmdResult {
	if runtime.GOOS != "windows" {
		res.Status = "error"
		res.Stderr = "Nexus Shield Canary deployment is currently supported on Windows endpoints only"
		return res
	}
	manifest, err := canary.Deploy(c.Payload.CanaryID, c.Payload.CanaryPath)
	if err != nil {
		res.Status = "error"
		res.Stderr = err.Error()
		return res
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		res.Status = "error"
		res.Stderr = err.Error()
		return res
	}
	res.Stdout = string(encoded)
	return res
}

func defaultShell() string {
	if runtime.GOOS == "windows" {
		return "powershell"
	}
	return "bash"
}

func rebootCmd() *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.Command("shutdown", "/r", "/t", "0", "/f")
	}
	return exec.Command("shutdown", "-r", "now")
}

func shutdownCmd() *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.Command("shutdown", "/s", "/t", "0", "/f")
	}
	return exec.Command("shutdown", "-h", "now")
}

func killProcess(pid int) error {
	if runtime.GOOS == "windows" {
		return exec.Command("taskkill", "/F", "/PID", fmt.Sprintf("%d", pid)).Run()
	}
	return exec.Command("kill", "-9", fmt.Sprintf("%d", pid)).Run()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "\n...[truncated]"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
