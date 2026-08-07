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
	"fmt"
	"io"
	"log"
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
	ApprovedUntil string   `json:"approved_until,omitempty"`
	CanaryID      string   `json:"canary_id,omitempty"`
	CanaryPath    string   `json:"canary_path,omitempty"`
	Actions       []string `json:"actions,omitempty"`
	Reason        string   `json:"reason,omitempty"`
	Provider      string   `json:"provider,omitempty"`
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
	Kind          string               `json:"kind"` // run_script, reboot, shutdown, run_powershell, run_cmd, kill_process, elevate_launch, install_companion, canary_deploy, remote_repair
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

	case "ping":
		res.Stdout = "pong"

	default:
		res.Status = "error"
		res.Stderr = fmt.Sprintf("unknown command kind: %s", c.Kind)
	}
	return res
}

// repairRemoteAccess is deliberately bounded. It can check the locally
// installed RustDesk service and start it when stopped, but it never downloads
// software, changes credentials, rewrites relay configuration, or kills an
// active technician session.
func repairRemoteAccess(ctx context.Context, c cmdItem, res cmdResult) cmdResult {
	provider := strings.ToLower(strings.TrimSpace(c.Payload.Provider))
	if provider == "" {
		provider = "rustdesk"
	}
	if provider != "rustdesk" {
		res.Status = "error"
		res.Stderr = "bounded repair is currently available for RustDesk only"
		return res
	}

	type evidence struct {
		Provider string `json:"provider"`
		Status   string `json:"status"`
		Action   string `json:"action"`
		Detail   string `json:"detail"`
	}
	report := evidence{Provider: provider, Status: "attention", Action: "none"}

	switch runtime.GOOS {
	case "windows":
		query := exec.CommandContext(ctx, "sc.exe", "query", "RustDesk")
		output, err := query.CombinedOutput()
		text := strings.TrimSpace(string(output))
		if err != nil {
			report.Detail = "RustDesk Windows service was not found; reinstall through the signed Nexus Agent package"
			break
		}
		if strings.Contains(strings.ToUpper(text), "RUNNING") {
			report.Status = "healthy"
			report.Action = "verified"
			report.Detail = "RustDesk Windows service is running"
			break
		}
		start := exec.CommandContext(ctx, "sc.exe", "start", "RustDesk")
		startOutput, startErr := start.CombinedOutput()
		if startErr != nil {
			report.Detail = "RustDesk service exists but could not be started: " + truncate(string(startOutput), 2048)
			break
		}
		report.Status = "healthy"
		report.Action = "service_started"
		report.Detail = "RustDesk Windows service was started"
	case "linux":
		query := exec.CommandContext(ctx, "systemctl", "is-active", "rustdesk")
		if output, err := query.CombinedOutput(); err == nil && strings.TrimSpace(string(output)) == "active" {
			report.Status = "healthy"
			report.Action = "verified"
			report.Detail = "RustDesk service is active"
			break
		}
		start := exec.CommandContext(ctx, "systemctl", "start", "rustdesk")
		output, err := start.CombinedOutput()
		if err != nil {
			report.Detail = "RustDesk service could not be started: " + truncate(string(output), 2048)
			break
		}
		report.Status = "healthy"
		report.Action = "service_started"
		report.Detail = "RustDesk service was started"
	default:
		report.Detail = "Automatic RustDesk service repair is not yet supported on " + runtime.GOOS
	}

	encoded, err := json.Marshal(report)
	if err != nil {
		res.Status = "error"
		res.Stderr = err.Error()
		return res
	}
	res.Stdout = string(encoded)
	if report.Status != "healthy" {
		res.Status = "error"
		res.Stderr = report.Detail
	}
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
		res.Stderr = "the Nexus Client Chat companion is currently supported on Windows endpoints only"
		return res
	}
	expectedHash := strings.TrimSpace(c.Payload.SHA256)
	if expectedHash != "" && len(expectedHash) != 64 {
		res.Status = "error"
		res.Stderr = "companion rollout has an invalid expected SHA-256"
		return res
	}
	executable, err := os.Executable()
	if err != nil {
		res.Status = "error"
		res.Stderr = "could not locate agent install directory: " + err.Error()
		return res
	}
	destination := filepath.Join(filepath.Dir(executable), "nexus-client-chat.exe")
	temporary := destination + ".download"
	defer os.Remove(temporary)
	if err := tr.Download("/api/nexus-agent/companion/latest", temporary); err != nil {
		res.Status = "error"
		res.Stderr = "could not download the client companion: " + err.Error()
		return res
	}
	actualHash, err := fileSHA256(temporary)
	if err != nil {
		res.Status = "error"
		res.Stderr = "could not fingerprint downloaded companion: " + err.Error()
		return res
	}
	if expectedHash != "" && !strings.EqualFold(actualHash, expectedHash) {
		res.Status = "error"
		res.Stderr = "downloaded companion fingerprint did not match the rollout command"
		return res
	}
	if err := os.Remove(destination); err != nil && !os.IsNotExist(err) {
		res.Status = "error"
		res.Stderr = "could not replace the client companion; close it and retry: " + err.Error()
		return res
	}
	if err := os.Rename(temporary, destination); err != nil {
		res.Status = "error"
		res.Stderr = "could not install the client companion: " + err.Error()
		return res
	}
	res.Stdout = "Nexus Client Chat companion installed successfully"
	if launcherPath, err := installCompanionStartMenuEntry(destination); err != nil {
		res.Stdout += "; the Start Menu launcher could not be created: " + err.Error()
	} else {
		res.Stdout += "; Start Menu launcher created at " + launcherPath
	}
	return res
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
