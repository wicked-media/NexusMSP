// Package appupdate reports and applies pending Windows application updates.
//
// Windows applications are updated through winget, the package manager Windows
// itself ships. The agent uses it for two things the platform could not do
// before: tell an operator which applications on an endpoint actually have an
// update pending, and apply an approved set of them — either because a
// technician asked from the device menu, or because the signed deployment policy
// pre-approved the package for automatic installation.
//
// Three rules shape this package:
//
//  1. Nothing is invented. A package is reported only when winget listed it as
//     upgradable, and an install is reported as done only when winget exited
//     successfully. A failed run reports the failure, never a hopeful result.
//  2. Nothing is built as a shell string. Every run is the winget executable with
//     a fixed argument vector, and a package identifier is refused unless it
//     looks like an identifier, so an id can never become an argument to another
//     program.
//  3. Nothing blocks the control plane. A scan walks the winget sources and can
//     take minutes, so the heartbeat reads the last result and the monitor
//     refreshes it in the background.
package appupdate

import (
	"context"
	"errors"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Statuses an evidence block can report.
const (
	StatusPending     = "pending"
	StatusOK          = "ok"
	StatusUnsupported = "unsupported"
	StatusError       = "error"
)

// Outcomes of an apply attempt.
const (
	OutcomeInstalled   = "installed"
	OutcomePartial     = "partial"
	OutcomeFailed      = "failed"
	OutcomeBlocked     = "blocked"
	OutcomeUnsupported = "unsupported"
)

const (
	// MaxPackages bounds what one endpoint reports, so a machine with hundreds of
	// stale packages cannot flood the control plane or a device record.
	MaxPackages = 200
	// ScanTimeout and UpgradeTimeout are the ceilings on one winget invocation.
	ScanTimeout = 5 * time.Minute
	// UpgradeTimeout is generous because a single package can download hundreds of
	// megabytes on a slow link; the command carries its own timeout too.
	UpgradeTimeout = 60 * time.Minute
	// DefaultInterval is how long a scan stays useful before the monitor refreshes
	// it in the background.
	DefaultInterval = 6 * time.Hour
	outputTailLimit = 6000
)

// packageIDPattern is the shape of a winget package identifier: a dotted or
// dashed vendor identifier such as `Microsoft.Edge` or `7zip.7zip`. Anything else
// — spaces, quotes, separators, a leading dash — is refused rather than escaped.
var packageIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]*$`)

// Package is one application winget reported as upgradable.
type Package struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Current   string `json:"current,omitempty"`
	Available string `json:"available,omitempty"`
}

// Evidence is the bounded block the agent reports with every heartbeat.
type Evidence struct {
	Status       string    `json:"status"`
	ObservedAt   string    `json:"observed_at,omitempty"`
	PackageCount int       `json:"package_count"`
	Truncated    bool      `json:"truncated,omitempty"`
	Error        string    `json:"error,omitempty"`
	Packages     []Package `json:"packages,omitempty"`
}

// UpgradeOutcome is what happened to one requested package.
type UpgradeOutcome struct {
	ID       string `json:"id,omitempty"`
	Status   string `json:"status"`
	ExitCode int    `json:"exit_code"`
	Detail   string `json:"detail,omitempty"`
}

// UpgradeResult is the evidence for one apply run. `Detail` explains a run that
// never reached winget (no valid target, unavailable platform); per-package
// explanations live in `Results`.
type UpgradeResult struct {
	Outcome         string           `json:"outcome"`
	Detail          string           `json:"detail,omitempty"`
	Requested       []string         `json:"requested,omitempty"`
	Results         []UpgradeOutcome `json:"results,omitempty"`
	DurationSeconds int64            `json:"duration_seconds,omitempty"`
}

// AutoPolicy is the part of the signed deployment policy that governs automatic
// application updates.
type AutoPolicy struct {
	Enabled bool
	Allowed []string
	// Allows reports whether this moment is inside the deployment's maintenance
	// window. A nil function means the window is not enforced.
	Allows func(time.Time) bool
}

// Platform hooks, supplied by the operating-system file. They are function values
// rather than an interface so the decision logic in this file stays testable on
// any operating system.
var (
	platformAvailable = func() bool { return false }
	platformScan      = func(context.Context) Evidence {
		return Evidence{Status: StatusUnsupported, Error: "application updates are a Windows capability"}
	}
	platformRunWinget = func(context.Context, time.Duration, ...string) (string, int, error) {
		return "", -1, errors.New("application updates are a Windows capability")
	}
)

// PlatformAvailable reports whether this endpoint can enumerate or install
// application updates at all.
func PlatformAvailable() bool { return platformAvailable() }

func scan(ctx context.Context) Evidence { return platformScan(ctx) }

func runWinget(ctx context.Context, timeout time.Duration, args ...string) (string, int, error) {
	return platformRunWinget(ctx, timeout, args...)
}

// Monitor owns this endpoint's view of pending application updates.
type Monitor struct {
	mu            sync.Mutex
	every         time.Duration
	now           func() time.Time
	evidence      *Evidence
	scannedAt     time.Time
	refreshing    bool
	auto          AutoPolicy
	autoAppliedAt time.Time
}

// NewMonitor builds the monitor with the real winget scan behind it.
func NewMonitor() *Monitor {
	return &Monitor{every: DefaultInterval, now: time.Now}
}

// SetClock overrides the monitor clock. Tests drive it.
func (m *Monitor) SetClock(clock func() time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if clock != nil {
		m.now = clock
	}
}

// SetInterval overrides how long a scan stays useful.
func (m *Monitor) SetInterval(every time.Duration) {
	if every <= 0 {
		return
	}
	m.mu.Lock()
	m.every = every
	m.mu.Unlock()
}

// SetAutoPolicy records what the deployment pre-approved for automatic
// installation. An empty allow-list means nothing is installed automatically,
// never everything.
func (m *Monitor) SetAutoPolicy(policy AutoPolicy) {
	m.mu.Lock()
	m.auto = policy
	m.mu.Unlock()
}

func (m *Monitor) stamp() time.Time {
	if m.now == nil {
		return time.Now()
	}
	return m.now()
}

func (m *Monitor) interval() time.Duration {
	if m.every <= 0 {
		return DefaultInterval
	}
	return m.every
}

// Evidence returns the current view and starts a background refresh when the last
// scan has expired. It never blocks on winget.
func (m *Monitor) Evidence() *Evidence {
	m.mu.Lock()
	current := m.evidence
	stale := current == nil || m.stamp().Sub(m.scannedAt) >= m.interval()
	start := stale && !m.refreshing
	if start {
		m.refreshing = true
	}
	m.mu.Unlock()

	if start {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), ScanTimeout)
			defer cancel()
			m.Refresh(ctx)
		}()
	}
	if current == nil {
		return &Evidence{Status: StatusPending, Error: "the endpoint has not completed its first application scan yet"}
	}
	copied := *current
	return &copied
}

// Refresh runs a scan synchronously and stores it. The heartbeat calls Evidence,
// not this, so a slow winget run can never delay a check-in.
func (m *Monitor) Refresh(ctx context.Context) Evidence {
	evidence := scan(ctx)
	if evidence.ObservedAt == "" {
		evidence.ObservedAt = m.stamp().UTC().Format(time.RFC3339)
	}
	if evidence.Status == "" {
		evidence.Status = StatusError
	}
	if evidence.PackageCount == 0 {
		evidence.PackageCount = len(evidence.Packages)
	}
	m.mu.Lock()
	m.evidence = &evidence
	m.scannedAt = m.stamp()
	m.refreshing = false
	policy := m.auto
	lastApplied := m.autoAppliedAt
	m.mu.Unlock()

	if AutoApplyDue(m.stamp(), lastApplied, policy) {
		targets := AutomaticTargets(evidence.Packages, policy.Allowed, policy.Enabled)
		if len(targets) > 0 {
			m.mu.Lock()
			m.autoAppliedAt = m.stamp()
			m.mu.Unlock()
			log.Printf("[appupdate] installing %d pre-approved application update(s)", len(targets))
			m.Upgrade(ctx, targets, false)
		}
	}
	return evidence
}

// Upgrade applies the requested packages and then re-scans, so the reported list
// describes what is actually left rather than what was attempted. `all` targets
// every pending upgrade the endpoint reported.
func (m *Monitor) Upgrade(ctx context.Context, ids []string, all bool) (UpgradeResult, Evidence) {
	started := m.stamp()
	result := UpgradeResult{Outcome: OutcomeFailed}
	if !PlatformAvailable() {
		result.Outcome = OutcomeUnsupported
		result.Detail = "winget is not available on this endpoint"
		return result, *m.Evidence()
	}

	targets := make([]string, 0, len(ids)+1)
	if all {
		targets = append(targets, "")
	} else {
		seen := map[string]bool{}
		for _, id := range ids {
			cleaned := cleanPackageID(id)
			if cleaned == "" || seen[strings.ToLower(cleaned)] {
				continue
			}
			seen[strings.ToLower(cleaned)] = true
			targets = append(targets, cleaned)
			if len(targets) >= MaxPackages {
				break
			}
		}
	}
	if len(targets) == 0 {
		result.Outcome = OutcomeBlocked
		result.Detail = "no valid package identifier was requested"
		return result, *m.Evidence()
	}

	installed := 0
	for _, id := range targets {
		output, exitCode, err := runWinget(ctx, UpgradeTimeout, UpgradeArgs(id, all)...)
		outcome := UpgradeOutcome{ID: id, Status: OutcomeInstalled, ExitCode: exitCode}
		if id == "" {
			outcome.ID = "(all pending)"
		}
		switch {
		case ctx.Err() == context.DeadlineExceeded:
			// The caller's budget ran out, which is not winget's verdict.
			outcome.Status = OutcomeFailed
			outcome.Detail = "winget did not finish within the upgrade budget"
		case err != nil:
			outcome.Status = OutcomeFailed
			outcome.Detail = tail(cleanConsoleOutput(output), 300)
			if outcome.Detail == "" {
				outcome.Detail = err.Error()
			}
		default:
			installed++
		}
		result.Results = append(result.Results, outcome)
		result.Requested = append(result.Requested, outcome.ID)
	}

	switch {
	case installed == len(result.Results):
		result.Outcome = OutcomeInstalled
	case installed > 0:
		result.Outcome = OutcomePartial
	default:
		result.Outcome = OutcomeFailed
	}
	result.DurationSeconds = int64(m.stamp().Sub(started).Seconds())
	return result, m.Refresh(ctx)
}

// UpgradeArgs builds the fixed argument vector for one winget run. A caller
// never supplies a flag: an identifier is appended as a separate argument after
// --id, `--exact` stops winget matching a package by name or substring, and the
// remaining flags mean the run cannot stop to ask a question on an unattended
// endpoint.
func UpgradeArgs(id string, all bool) []string {
	args := []string{"upgrade"}
	if all {
		args = append(args, "--all")
	} else if cleaned := cleanPackageID(id); cleaned != "" {
		args = append(args, "--id", cleaned, "--exact")
	}
	return append(args,
		"--silent",
		"--accept-package-agreements",
		"--accept-source-agreements",
		"--disable-interactivity",
	)
}

// AutomaticTargets returns the pending packages an operator pre-approved for
// automatic installation, in a stable order. It is deliberately conservative:
// with automatic installation switched off, or with no allow-list, nothing is
// returned — an empty allow-list never means "all".
func AutomaticTargets(pending []Package, allowed []string, enabled bool) []string {
	if !enabled || len(allowed) == 0 {
		return nil
	}
	approved := make(map[string]bool, len(allowed))
	for _, id := range allowed {
		if cleaned := cleanPackageID(id); cleaned != "" {
			approved[strings.ToLower(cleaned)] = true
		}
	}
	targets := make([]string, 0, len(pending))
	for _, pkg := range pending {
		if pkg.ID == "" {
			continue
		}
		if approved[strings.ToLower(pkg.ID)] {
			targets = append(targets, pkg.ID)
		}
	}
	return targets
}

// AutoApplyDue reports whether an automatic application-update pass may run now:
// the deployment must have enabled it with a non-empty allow-list, an enforced
// maintenance window must be open, and one pass must not already have run today.
// It is pure so the rule is provable without a Windows endpoint.
func AutoApplyDue(now time.Time, lastApplied time.Time, policy AutoPolicy) bool {
	if !policy.Enabled || len(policy.Allowed) == 0 {
		return false
	}
	if policy.Allows != nil && !policy.Allows(now) {
		return false
	}
	if lastApplied.IsZero() {
		return true
	}
	return lastApplied.UTC().Format("2006-01-02") != now.UTC().Format("2006-01-02")
}

// cleanPackageID accepts only an identifier shape, so a caller cannot smuggle an
// argument into the winget invocation.
func cleanPackageID(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || len(trimmed) > 200 || !packageIDPattern.MatchString(trimmed) {
		return ""
	}
	return trimmed
}

// cleanConsoleOutput recovers readable text from console output. winget redraws
// progress on one line with carriage returns, so each redraw is split onto its
// own line where it cannot corrupt a table row.
func cleanConsoleOutput(raw string) string {
	cleaned := strings.ReplaceAll(raw, "\x00", "")
	cleaned = strings.ReplaceAll(cleaned, "\r\n", "\n")
	cleaned = strings.ReplaceAll(cleaned, "\r", "\n")
	lines := make([]string, 0, 32)
	for _, line := range strings.Split(cleaned, "\n") {
		if strings.TrimSpace(line) == "" && len(lines) > 0 && lines[len(lines)-1] == "" {
			continue
		}
		lines = append(lines, line)
	}
	text := strings.TrimSpace(strings.Join(lines, "\n"))
	if len(text) > outputTailLimit {
		text = text[len(text)-outputTailLimit:]
	}
	return text
}

// tableColumns is the column geometry of one winget table, read from its own
// header so the parser does not depend on fixed column widths.
type tableColumns struct {
	name      int
	id        int
	version   int
	available int
	source    int
}

func tableColumnsFrom(header string) (tableColumns, bool) {
	columns := tableColumns{
		name:      strings.Index(header, "Name"),
		id:        strings.Index(header, "Id"),
		version:   strings.Index(header, "Version"),
		available: strings.Index(header, "Available"),
		source:    strings.Index(header, "Source"),
	}
	if columns.name < 0 || columns.id < 0 || columns.available < 0 {
		return tableColumns{}, false
	}
	if !(columns.name < columns.id && columns.id < columns.available) {
		return tableColumns{}, false
	}
	if columns.version < 0 {
		columns.version = columns.id
	}
	if columns.source < 0 {
		// No Source column: take everything after Available.
		columns.source = len(header)
	}
	return columns, true
}

func fieldAt(line string, start, end int) string {
	if start < 0 || end <= start || start >= len(line) {
		return ""
	}
	if end > len(line) {
		end = len(line)
	}
	return strings.TrimSpace(line[start:end])
}

func isSeparator(line string) bool {
	if len(line) < 3 {
		return false
	}
	for _, character := range line {
		if character != '-' && character != '=' && character != '_' {
			return false
		}
	}
	return true
}

// isSectionTitle recognises winget's own section headings (for example packages
// that require explicit targeting). A new section brings its own header, so the
// previous geometry is dropped rather than reused.
func isSectionTitle(line string) bool {
	return strings.HasSuffix(line, ":")
}

// parseUpgradeTable turns one winget listing into packages. It is deliberately
// strict: a row is accepted only when its identifier has an identifier's shape
// and its availability column holds something, which is what keeps winget's own
// prose lines out of the result.
func parseUpgradeTable(raw string) ([]Package, bool) {
	text := cleanConsoleOutput(raw)
	if text == "" {
		return nil, false
	}
	packages := make([]Package, 0, 16)
	seen := make(map[string]bool, 16)
	var columns tableColumns
	haveColumns := false
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || isSeparator(line) {
			continue
		}
		if !haveColumns {
			candidate, ok := tableColumnsFrom(line)
			if !ok {
				continue
			}
			columns = candidate
			haveColumns = true
			continue
		}
		if isSectionTitle(line) {
			haveColumns = false
			continue
		}
		name := fieldAt(line, columns.name, columns.id)
		id := fieldAt(line, columns.id, columns.version)
		current := fieldAt(line, columns.version, columns.available)
		available := fieldAt(line, columns.available, columns.source)
		if id == "" || !packageIDPattern.MatchString(id) || available == "" {
			continue
		}
		// A winget version never contains whitespace, so whitespace in a version
		// column means this row does not line up with the header. Reporting a
		// mangled identifier would be worse than reporting nothing, because a wrong
		// identifier is a wrong package.
		if strings.ContainsAny(available, " \t") || strings.ContainsAny(current, " \t") {
			continue
		}
		key := strings.ToLower(id)
		if seen[key] {
			continue
		}
		seen[key] = true
		if name == "" {
			name = id
		}
		packages = append(packages, Package{ID: id, Name: name, Current: current, Available: available})
		if len(packages) >= MaxPackages {
			return packages, true
		}
	}
	if len(packages) == 0 {
		return nil, false
	}
	return packages, true
}

func tail(value string, limit int) string {
	text := strings.TrimSpace(value)
	if len(text) <= limit {
		return text
	}
	return strings.TrimSpace(text[len(text)-limit:])
}
