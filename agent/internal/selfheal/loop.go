package selfheal

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"nexusagent/internal/config"
)

// DefaultInterval is how often the agent thinks about its own health. It is
// faster than the heartbeat so a lost control plane is noticed promptly, and slow
// enough to cost nothing.
const DefaultInterval = 30 * time.Second

const (
	// rungPaceDefault is the minimum spacing between two escalation attempts. It
	// stops a fast-failing endpoint from racing down the whole ladder in a
	// minute, which would look exactly like the kind of outage it is meant to fix.
	rungPaceDefault   = 2 * time.Minute
	rungPaceImpatient = 60 * time.Second
	maxEvents         = 8
	maxRepairHistory  = 3
	// repairBudget bounds a whole repair: the three steps carry their own
	// timeouts, and this is the ceiling above them.
	repairBudget = 175 * time.Minute
)

// ErrNotApplicable marks a rung that cannot run on this endpoint (for example a
// service restart when the agent is running in the foreground).
var ErrNotApplicable = errors.New("repair action is not applicable on this endpoint")

// Actions are the repair operations the ladder can perform. main wires them to
// the real packages; tests inject fakes, which is why the loop's decisions are
// verifiable without a Windows endpoint.
type Actions struct {
	Probe          func() error
	RepairLocal    func(actions []string) (map[string]string, error)
	RenewIdentity  func() error
	ResetTransport func() error
	Reenroll       func() error
	RestartService func() error
}

// Loop watches the agent's own connectivity and this endpoint's performance.
type Loop struct {
	cfg      *config.Config
	watch    *Watchdog
	store    *Store
	platform Platform
	actions  Actions
	every    time.Duration
	now      func() time.Time
	tracker  *Tracker

	// syncRepair runs the platform repair inline instead of in a goroutine. It
	// exists so tests can verify the gating logic deterministically instead of
	// racing a real 75-minute DISM run.
	syncRepair bool

	mu         sync.Mutex
	streak     int
	attempted  map[string]bool
	lastRungAt time.Time
	lastEvent  string
	repairing  bool
	repairs    []RepairRecord
	perf       *PerfEvidence
	events     []string
}

// NewLoop builds the self-heal loop. platform may be nil, in which case the
// endpoint's real platform implementation is used.
func NewLoop(cfg *config.Config, watch *Watchdog, store *Store, platform Platform, actions Actions) *Loop {
	if store == nil {
		store = NewStore()
	}
	if platform == nil {
		platform = DefaultPlatform()
	}
	return &Loop{
		cfg:       cfg,
		watch:     watch,
		store:     store,
		platform:  platform,
		actions:   actions,
		every:     DefaultInterval,
		now:       time.Now,
		tracker:   &Tracker{},
		attempted: map[string]bool{},
	}
}

// SetInterval overrides the responsiveness tick. Used by tests.
func (l *Loop) SetInterval(every time.Duration) {
	if every > 0 {
		l.every = every
	}
}

// SetClock overrides the loop's clock. Used by tests.
func (l *Loop) SetClock(clock func() time.Time) {
	if clock == nil {
		return
	}
	l.now = clock
	l.watch.SetClock(clock)
}

func (l *Loop) clock() time.Time {
	if l.now == nil {
		return time.Now()
	}
	return l.now()
}

// Run keeps the agent self-aware until the process exits.
func (l *Loop) Run(ctx context.Context) {
	l.tick(ctx)
	ticker := time.NewTicker(l.every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.tick(ctx)
		}
	}
}

func (l *Loop) tick(ctx context.Context) {
	now := l.clock()
	status := l.watch.Status()
	if status.State == StateConnected || status.State == StateUnknown {
		l.resetLadder(0)
	} else {
		l.resetLadder(status.FailureStreak)
		l.escalate(now, status)
	}
	l.assessPerformance(ctx, now)
}

// resetLadder clears the attempted rungs whenever the outage being worked on has
// changed. It keys off the watchdog's failure streak rather than "the last tick
// saw us connected", so an outage that ends and a new one that starts between two
// ticks still gets a fresh ladder instead of resuming the middle of the old one.
func (l *Loop) resetLadder(streak int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if streak != 0 && l.streak == streak {
		return
	}
	l.streak = streak
	l.attempted = map[string]bool{}
	l.lastRungAt = time.Time{}
}

// escalate runs the next rung of the repair ladder, if this cause has one left
// and enough time has passed since the last attempt.
func (l *Loop) escalate(now time.Time, status Status) {
	if !l.actionsEnabled() {
		l.recordEvent(now, "self-healing actions are disabled by the signed policy; reporting state only")
		return
	}
	candidates := ladderFor(status.Cause)

	l.mu.Lock()
	if l.attempted == nil {
		l.attempted = map[string]bool{}
	}
	remaining := make([]string, 0, len(candidates))
	for _, action := range candidates {
		if l.attempted[action] {
			continue
		}
		if action == ActionRestartService && !l.cfg.SelfHealAllowServiceRestart() {
			// The rung exists in the code but stays unused unless a deployment
			// explicitly allows the agent to bounce its own service.
			l.attempted[action] = true
			continue
		}
		remaining = append(remaining, action)
	}
	ready := l.lastRungAt.IsZero() || now.Sub(l.lastRungAt) >= l.rungPace()
	l.mu.Unlock()

	if len(remaining) == 0 {
		l.recordEvent(now, fmt.Sprintf("%s for %ds: repair ladder exhausted for cause %s", status.State, status.OutageSeconds, causeLabel(status.Cause)))
		return
	}
	if !ready {
		return
	}
	action := l.chooseRung(status.Cause, remaining)
	if allowed, reason := l.store.AllowAction(action, now); !allowed {
		l.mu.Lock()
		l.attempted[action] = true
		l.mu.Unlock()
		l.recordEvent(now, fmt.Sprintf("%s: %s held back: %s", status.State, action, reason))
		return
	}
	l.mu.Lock()
	l.attempted[action] = true
	l.lastRungAt = now
	l.mu.Unlock()
	l.runRung(now, action)
}

// chooseRung pins the read-only probe ahead of everything else. Learning decides
// the order of the rungs that change the endpoint, but the free diagnostic always
// runs first: it is how the agent tells "my loops are stuck" apart from "the link
// is down", and a probe cannot make anything worse.
func (l *Loop) chooseRung(cause Cause, remaining []string) string {
	for _, action := range remaining {
		if action == ActionProbe {
			return action
		}
	}
	return l.store.RankedActions(cause, remaining)[0]
}

func (l *Loop) rungPace() time.Duration {
	if degradedAfter, _ := l.store.Patience(); degradedAfter <= 1 {
		return rungPaceImpatient
	}
	return rungPaceDefault
}

func (l *Loop) runRung(now time.Time, action string) {
	l.watch.MarkRung(action)
	log.Printf("[self-heal] escalating to %s", action)
	operation := l.operationFor(action)
	if operation == nil {
		l.watch.RungResult("unsupported")
		l.recordEvent(now, action+": no implementation on this endpoint")
		return
	}
	if action == ActionRestartService || action == ActionReenroll || action == ActionResetTransport {
		l.store.RecordAction(action, now)
	}
	if err := operation(); err != nil {
		l.watch.RungResult("failed")
		l.recordEvent(now, fmt.Sprintf("%s failed: %s", action, shorten(err.Error(), 160)))
		return
	}
	if action == ActionProbe {
		// A probe is its own confirmation: the control plane just answered.
		l.watch.RungResult("succeeded")
		l.recordEvent(now, action+": the control plane answered")
		return
	}
	// Every other rung is credited only when contact actually returns. Until then
	// it stays open, and starting the next rung closes it as failed, which is how
	// the ladder learns which action really works on this endpoint.
	l.recordEvent(now, action+": applied, awaiting the next heartbeat")
}

func (l *Loop) operationFor(action string) func() error {
	switch action {
	case ActionProbe:
		return l.actions.Probe
	case ActionRepairLocal:
		repair := l.actions.RepairLocal
		if repair == nil {
			return nil
		}
		return func() error {
			_, err := repair([]string{"identity", "policy", "config"})
			return err
		}
	case ActionRenewIdentity:
		return l.actions.RenewIdentity
	case ActionResetTransport:
		return l.actions.ResetTransport
	case ActionReenroll:
		return l.actions.Reenroll
	case ActionRestartService:
		return l.actions.RestartService
	}
	return nil
}

// ladderFor returns the candidate rungs for a failure cause, safest first. The
// store reorders them by what has actually worked here; this is the order a
// deployment with no history starts from.
func ladderFor(cause Cause) []string {
	switch cause {
	case CauseAuth, CauseRequestRejected:
		// Credentials or the signed policy are wrong, so re-establishing identity
		// is the only thing that can fix a refused endpoint.
		return []string{ActionRepairLocal, ActionRenewIdentity, ActionResetTransport, ActionReenroll, ActionRestartService}
	case CauseTLS:
		// A certificate or handshake problem: fall back to token transport, then
		// have the control plane re-issue this endpoint's certificate.
		return []string{ActionResetTransport, ActionRenewIdentity, ActionRepairLocal, ActionRestartService}
	case CauseServer:
		// NexusMSP answered with a server error. That is the platform's problem;
		// repairing a healthy endpoint would make an outage worse.
		return []string{ActionProbe, ActionRepairLocal}
	default:
		return []string{ActionProbe, ActionRepairLocal, ActionResetTransport, ActionRenewIdentity, ActionRestartService}
	}
}

func causeLabel(cause Cause) string {
	if cause == CauseNone {
		return string(CauseUnknown)
	}
	return string(cause)
}

// assessPerformance samples the endpoint, learns from healthy behaviour, and
// starts the inbuilt Windows repair when degradation is sustained.
func (l *Loop) assessPerformance(ctx context.Context, now time.Time) {
	sample := l.platform.Sample(ctx)
	if !sample.Supported {
		l.mu.Lock()
		l.perf = nil
		l.mu.Unlock()
		return
	}
	baseline := l.store.Baseline()
	verdict := Assess(baseline, sample)
	if verdict.Band == BandHealthy || verdict.Band == BandLearning {
		// Only quiet behaviour teaches the baseline. Letting a degraded endpoint
		// redefine "normal" is how a performance guard stops guarding anything.
		l.store.ObserveHealthy(sample.Signals)
	}
	if verdict.Band == BandDegraded || verdict.Band == BandWatch {
		l.recordEvent(now, fmt.Sprintf("performance %s score=%.2f reasons=%s", verdict.Band, verdict.Score, formatReasons(verdict.Reasons)))
	}
	if l.tracker.Push(now, verdict.Band == BandDegraded) {
		l.startWindowsRepair(now, verdict)
	}

	evidence := &PerfEvidence{
		Supported: true,
		Band:      verdict.Band,
		Score:     verdict.Score,
		Samples:   baseline.Samples,
		Reasons:   verdict.Reasons,
	}
	l.mu.Lock()
	if l.repairing {
		evidence.Band = BandRepairing
	}
	l.perf = evidence
	l.mu.Unlock()
}

// startWindowsRepair decides whether the degraded endpoint may be repaired right
// now, and if not, records why. "Nothing happened" must always be explainable.
func (l *Loop) startWindowsRepair(now time.Time, verdict Verdict) {
	if reason, allowed := l.repairBlockers(now); !allowed {
		l.recordEvent(now, "Windows repair held back: "+reason)
		return
	}
	trigger := verdict.Signature
	if trigger == "" {
		trigger = "unspecified"
	}
	l.mu.Lock()
	l.repairing = true
	l.mu.Unlock()
	l.store.RecordWindowsRepairStarted(now)
	l.recordEvent(now, "starting the built-in Windows component repair for "+trigger)
	log.Printf("[self-heal] starting built-in Windows component repair (trigger=%s score=%.2f)", trigger, verdict.Score)

	run := func() {
		ctx, cancel := context.WithTimeout(context.Background(), repairBudget)
		defer cancel()
		record := l.platform.Repair(ctx, []string{trigger})
		record.Trigger = trigger
		l.finishWindowsRepair(record)
	}
	if l.syncRepair {
		run()
		return
	}
	// The repair takes tens of minutes, so it must never block the loop that keeps
	// watching whether the endpoint can still reach NexusMSP.
	go run()
}

func (l *Loop) repairBlockers(now time.Time) (string, bool) {
	if !l.cfg.SelfHealWindowsRepairEnabled() {
		return "the signed policy does not enable Windows component repair", false
	}
	if !l.platform.Elevated() {
		return "the agent is not running with administrator rights", false
	}
	if !l.cfg.SelfHealWindowAllows(now) {
		return "outside the configured maintenance window", false
	}
	if allowed, reason := l.store.AllowWindowsRepair(l.cfg.SelfHealWindowsRepairMaxRunsPerDay(), now); !allowed {
		return reason, false
	}
	l.mu.Lock()
	repairing := l.repairing
	l.mu.Unlock()
	if repairing {
		return "a component repair is already running", false
	}
	return "", true
}

func (l *Loop) finishWindowsRepair(record RepairRecord) {
	l.store.CreditRepair(record.Trigger, record.Verified)

	l.mu.Lock()
	l.repairing = false
	l.repairs = append([]RepairRecord{record}, l.repairs...)
	if len(l.repairs) > maxRepairHistory {
		l.repairs = l.repairs[:maxRepairHistory]
	}
	l.mu.Unlock()

	log.Printf("[self-heal] Windows component repair %s verified=%t reboot_required=%t reason=%s",
		record.Status, record.Verified, record.RebootRequired, record.Reason)
	l.recordEvent(l.clock(), fmt.Sprintf("Windows repair %s verified=%t reboot_required=%t", record.Status, record.Verified, record.RebootRequired))
}

func (l *Loop) actionsEnabled() bool {
	return l.cfg.SelfHealActionsEnabled()
}

func (l *Loop) recordEvent(now time.Time, message string) {
	entry := now.UTC().Format(time.RFC3339) + " " + message
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.lastEvent == message {
		// The ladder can be blocked for hours; repeating the same line every tick
		// would drown the evidence it is supposed to explain.
		return
	}
	l.lastEvent = message
	l.events = append(l.events, entry)
	if len(l.events) > maxEvents {
		l.events = l.events[len(l.events)-maxEvents:]
	}
}

// Evidence returns the block the agent reports with every heartbeat.
func (l *Loop) Evidence() *Evidence {
	status := l.watch.Status()
	l.mu.Lock()
	perf := l.perf
	repairing := l.repairing
	repairs := append([]RepairRecord(nil), l.repairs...)
	events := append([]string(nil), l.events...)
	l.mu.Unlock()

	if perf != nil && repairing {
		adjusted := *perf
		adjusted.Band = BandRepairing
		perf = &adjusted
	}
	return &Evidence{
		State:               status.State,
		Cause:               status.Cause,
		ConsecutiveFailures: status.ConsecutiveFailures,
		OutageSeconds:       status.OutageSeconds,
		LastSuccess:         status.LastSuccess,
		OutagesRecovered:    status.OutagesRecovered,
		Performance:         perf,
		Repairs:             repairs,
		Learned:             l.store.Learned(l.clock()),
		Events:              events,
	}
}

// Status exposes the connectivity self-assessment for logging.
func (l *Loop) Status() Status { return l.watch.Status() }

// ObserveControlPlane feeds one control-plane interaction into the watchdog.
// The heartbeat calls it, which is what turns "we are not phoning home" from a
// log line into a state the agent acts on.
func (l *Loop) ObserveControlPlane(err error) { l.watch.Record(err) }
