// Package selfheal keeps the NexusOps Agent aware of its own availability.
//
// It answers three questions the agent previously could not:
//
//  1. Can this endpoint still reach NexusMSP? Control-plane reachability is
//     tracked as explicit state instead of a log line, so losing contact is a
//     fact the agent acts on rather than an error it forgets.
//  2. What can the agent repair by itself, and did that repair work? Every
//     recovery attempt is recorded with its observed failure cause, and the
//     repair ladder learns which action actually restores contact.
//  3. Is this Windows endpoint degrading? Performance signals are compared with
//     a baseline learned on this endpoint, and sustained degradation triggers
//     the inbuilt Windows component repair: DISM /Online /Cleanup-Image
//     /RestoreHealth, then sfc /scannow, then a DISM health verification.
//
// Nothing in this package builds a shell command string. The Windows repair runs
// fixed system executables with fixed arguments, only when the signed deployment
// policy enables it, only on an elevated Windows endpoint, and every run is
// reported to NexusMSP as evidence.
package selfheal

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"nexusagent/internal/transport"
)

// State is the agent's own view of its control-plane connectivity.
type State string

const (
	StateUnknown      State = "unknown"
	StateConnected    State = "connected"
	StateDegraded     State = "degraded"
	StateDisconnected State = "disconnected"
	// StateRejected means the server answered and refused this endpoint's
	// credentials. Waiting will never fix that, so it is its own state.
	StateRejected State = "rejected"
)

// Cause classifies the last control-plane failure so the repair ladder can pick
// actions that could plausibly help.
type Cause string

const (
	CauseNone    Cause = ""
	CauseAuth    Cause = "auth"
	CauseTLS     Cause = "tls"
	CauseDNS     Cause = "dns"
	CauseTimeout Cause = "timeout"
	CauseServer  Cause = "server"
	CauseNetwork Cause = "network"
	// CauseRequestRejected is a non-auth 4xx: the request reached NexusMSP and
	// was refused, which usually means local state or the signed policy is wrong.
	CauseRequestRejected Cause = "request_rejected"
	CauseUnknown         Cause = "unknown"
)

// Action names are stable: they are the learning keys, the audit vocabulary and
// the values reported in evidence.
const (
	ActionProbe          = "probe_control_plane"
	ActionRepairLocal    = "repair_local_state"
	ActionRenewIdentity  = "renew_identity"
	ActionResetTransport = "reset_transport"
	ActionReenroll       = "reenroll"
	ActionRestartService = "restart_service"
)

// An endpoint with no repair history is patient: two missed heartbeats is
// degraded, four is disconnected. The learned profile tightens these for
// endpoints whose recorded outages have historically lasted for hours.
const (
	defaultDegradedAfter     = 2
	defaultDisconnectedAfter = 4
)

// Classify turns a transport error into the cause the ladder reasons about.
func Classify(err error) Cause {
	if err == nil {
		return CauseNone
	}
	if transport.IsAuth(err) {
		return CauseAuth
	}
	var httpErr *transport.HTTPError
	if errors.As(err, &httpErr) {
		if httpErr.Status >= 500 {
			return CauseServer
		}
		return CauseRequestRejected
	}
	var certificateInvalid x509.CertificateInvalidError
	var unknownAuthority x509.UnknownAuthorityError
	var hostnameError x509.HostnameError
	var verificationError *tls.CertificateVerificationError
	var recordError tls.RecordHeaderError
	if errors.As(err, &certificateInvalid) || errors.As(err, &unknownAuthority) ||
		errors.As(err, &hostnameError) || errors.As(err, &verificationError) ||
		errors.As(err, &recordError) {
		return CauseTLS
	}
	var dnsError *net.DNSError
	if errors.As(err, &dnsError) {
		return CauseDNS
	}
	if errors.Is(err, os.ErrDeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return CauseTimeout
	}
	var netError net.Error
	if errors.As(err, &netError) {
		if netError.Timeout() {
			return CauseTimeout
		}
		return CauseNetwork
	}
	var opError *net.OpError
	if errors.As(err, &opError) {
		return CauseNetwork
	}
	return CauseUnknown
}

// ActionRecord is one ladder rung and how it ended.
type ActionRecord struct {
	Action string `json:"action"`
	Cause  string `json:"cause,omitempty"`
	Result string `json:"result"`
	At     string `json:"at"`
}

// Status is the agent's live self-assessment.
type Status struct {
	State               State  `json:"state"`
	Cause               Cause  `json:"cause,omitempty"`
	ConsecutiveFailures int    `json:"consecutive_failures"`
	OutageSeconds       int64  `json:"outage_seconds,omitempty"`
	LastSuccess         string `json:"last_success,omitempty"`
	LastError           string `json:"last_error,omitempty"`
	LastAction          string `json:"last_action,omitempty"`
	DegradedAfter       int    `json:"degraded_after"`
	DisconnectedAfter   int    `json:"disconnected_after"`
	OutagesRecovered    int    `json:"outages_recovered"`
	// FailureStreak identifies the current outage. It changes whenever contact is
	// lost again, which is how the repair ladder knows the previous outage ended
	// even if it never saw a successful heartbeat in between.
	FailureStreak int            `json:"failure_streak"`
	RecentActions []ActionRecord `json:"recent_actions,omitempty"`
}

// RepairStep is one fixed system command and its outcome.
type RepairStep struct {
	Command  string `json:"command"`
	ExitCode int    `json:"exit_code"`
	OK       bool   `json:"ok"`
	Output   string `json:"output,omitempty"`
}

// RepairRecord is the evidence for one inbuilt Windows component repair.
type RepairRecord struct {
	Trigger         string       `json:"trigger,omitempty"`
	StartedAt       string       `json:"started_at,omitempty"`
	FinishedAt      string       `json:"finished_at,omitempty"`
	Status          string       `json:"status"`
	Verified        bool         `json:"verified"`
	RebootRequired  bool         `json:"reboot_required"`
	DurationSeconds int64        `json:"duration_seconds,omitempty"`
	Reason          string       `json:"reason,omitempty"`
	Steps           []RepairStep `json:"steps,omitempty"`
}

// Repair statuses.
const (
	RepairCompleted   = "completed"
	RepairFailed      = "failed"
	RepairBlocked     = "blocked"
	RepairUnsupported = "unsupported"
)

// Evidence is the block the agent sends with every heartbeat.
type Evidence struct {
	State               State             `json:"state"`
	Cause               Cause             `json:"cause,omitempty"`
	ConsecutiveFailures int               `json:"consecutive_failures"`
	OutageSeconds       int64             `json:"outage_seconds,omitempty"`
	LastSuccess         string            `json:"last_success,omitempty"`
	OutagesRecovered    int               `json:"outages_recovered,omitempty"`
	Performance         *PerfEvidence     `json:"performance,omitempty"`
	Repairs             []RepairRecord    `json:"repairs,omitempty"`
	Learned             map[string]string `json:"learned,omitempty"`
	Events              []string          `json:"events,omitempty"`
}

// Watchdog tracks control-plane reachability. Every heartbeat result is fed into
// it, so the agent always knows whether it is currently phoning home.
type Watchdog struct {
	mu           sync.Mutex
	now          func() time.Time
	store        *Store
	state        State
	cause        Cause
	failures     int
	firstFailure time.Time
	lastSuccess  time.Time
	lastError    string
	lastAction   string
	pendingRung  string
	actions      []ActionRecord
	recovered    int
	streak       int
}

func NewWatchdog(store *Store) *Watchdog {
	return &Watchdog{store: store, now: time.Now, state: StateUnknown}
}

// SetClock replaces the clock used for every decision. Tests drive it.
func (w *Watchdog) SetClock(clock func() time.Time) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if clock != nil {
		w.now = clock
	}
}

// stamp reads the clock. Callers hold the lock.
func (w *Watchdog) stamp() time.Time {
	if w.now == nil {
		return time.Now()
	}
	return w.now()
}

func (w *Watchdog) patience() (int, int) {
	if w.store == nil {
		return defaultDegradedAfter, defaultDisconnectedAfter
	}
	return w.store.Patience()
}

// RecordSuccess marks the control plane reachable again and closes the outage.
func (w *Watchdog) RecordSuccess() {
	w.mu.Lock()
	defer w.mu.Unlock()
	now := w.stamp()
	if !w.firstFailure.IsZero() {
		// Any failure streak that ends is an outage worth learning from, including
		// a single missed heartbeat that recovered inside the tolerance window.
		if w.store != nil {
			w.store.ObserveOutage(int64(now.Sub(w.firstFailure).Seconds()))
		}
		if w.state == StateDegraded || w.state == StateDisconnected || w.state == StateRejected {
			// Only a connectivity loss serious enough to act on counts as an outage
			// the agent had to recover from.
			w.recovered++
		}
	}
	if w.pendingRung != "" {
		// A rung is only credited once contact actually returns.
		w.closeRung("succeeded", now)
	}
	w.state = StateConnected
	w.cause = CauseNone
	w.failures = 0
	w.firstFailure = time.Time{}
	w.lastError = ""
	w.lastSuccess = now
}

// Record feeds one failed (or successful) control-plane interaction in.
func (w *Watchdog) Record(err error) {
	if err == nil {
		w.RecordSuccess()
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	now := w.stamp()
	cause := Classify(err)
	if w.failures == 0 {
		w.firstFailure = now
		w.streak++
	}
	w.failures++
	w.cause = cause
	w.lastError = shorten(err.Error(), 200)
	degradedAfter, disconnectedAfter := w.patience()
	switch {
	case cause == CauseAuth || cause == CauseRequestRejected:
		w.state = StateRejected
	case w.failures >= disconnectedAfter:
		w.state = StateDisconnected
	case w.failures >= degradedAfter:
		w.state = StateDegraded
	default:
		// Still inside the tolerated window: behind on heartbeats, not degraded.
		w.state = StateConnected
	}
}

// MarkRung records that the loop is escalating into one repair action. A rung
// that is still open when the next one starts did not restore contact, so it is
// closed as failed first. That is the credit assignment the ladder learns from.
func (w *Watchdog) MarkRung(action string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	now := w.stamp()
	if w.pendingRung != "" {
		w.closeRung("failed", now)
	}
	w.lastAction = action
	w.pendingRung = action
	w.appendAction(ActionRecord{Action: action, Cause: string(w.cause), Result: "attempted", At: now.UTC().Format(time.RFC3339)})
}

// RungResult closes the current rung. "succeeded" and "failed" teach the store.
func (w *Watchdog) RungResult(result string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.closeRung(result, w.stamp())
}

// closeRung credits the open rung. Callers hold the lock.
func (w *Watchdog) closeRung(result string, now time.Time) {
	action := w.pendingRung
	if action == "" {
		return
	}
	w.pendingRung = ""
	if w.store != nil {
		w.store.Credit(w.cause, action, result == "succeeded")
	}
	w.appendAction(ActionRecord{Action: action, Cause: string(w.cause), Result: result, At: now.UTC().Format(time.RFC3339)})
}

func (w *Watchdog) appendAction(record ActionRecord) {
	w.actions = append(w.actions, record)
	if len(w.actions) > maxRecentActions {
		w.actions = w.actions[len(w.actions)-maxRecentActions:]
	}
}

// Status returns the current self-assessment.
func (w *Watchdog) Status() Status {
	w.mu.Lock()
	defer w.mu.Unlock()
	degradedAfter, disconnectedAfter := w.patience()
	status := Status{
		State:               w.state,
		Cause:               w.cause,
		ConsecutiveFailures: w.failures,
		LastError:           w.lastError,
		LastAction:          w.lastAction,
		DegradedAfter:       degradedAfter,
		DisconnectedAfter:   disconnectedAfter,
		OutagesRecovered:    w.recovered,
		FailureStreak:       w.streak,
		RecentActions:       append([]ActionRecord(nil), w.actions...),
	}
	if !w.firstFailure.IsZero() && w.state != StateConnected {
		status.OutageSeconds = int64(w.stamp().Sub(w.firstFailure).Seconds())
	}
	if !w.lastSuccess.IsZero() {
		status.LastSuccess = w.lastSuccess.UTC().Format(time.RFC3339)
	}
	return status
}

func shorten(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

func formatReasons(reasons []string) string {
	if len(reasons) == 0 {
		return "none"
	}
	return strings.Join(reasons, ",")
}
