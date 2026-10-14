package selfheal

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"nexusagent/internal/config"
	"nexusagent/internal/transport"
)

// fakePlatform stands in for the OS. The logic under test is platform-neutral by
// design, so this is the only thing a test needs to replace to exercise a
// Windows-only repair path.
type fakePlatform struct {
	supported bool
	elevated  bool
	sample    Sample
	next      RepairRecord

	mu      sync.Mutex
	repairs []RepairRecord
}

func (p *fakePlatform) Elevated() bool { return p.elevated }

func (p *fakePlatform) Sample(context.Context) Sample {
	if !p.supported {
		return Sample{Supported: false}
	}
	return p.sample
}

func (p *fakePlatform) Repair(_ context.Context, trigger []string) RepairRecord {
	p.mu.Lock()
	defer p.mu.Unlock()
	record := p.next
	if record.Status == "" {
		record.Status = RepairCompleted
	}
	record.Trigger = strings.Join(trigger, "+")
	p.repairs = append(p.repairs, record)
	return record
}

func (p *fakePlatform) repairCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.repairs)
}

func testConfig(selfHeal map[string]any) *config.Config {
	policy := &config.PlatformPolicy{}
	if selfHeal != nil {
		policy.SelfHeal = selfHeal
	}
	return &config.Config{ServerURL: "https://nexus.example", PlatformPolicy: policy}
}

func newTestLoop(t *testing.T, cfg *config.Config, platform Platform, actions Actions) (*Loop, *Watchdog, *Store, *fakeClock) {
	t.Helper()
	clock := newFakeClock()
	store := NewStore()
	watch := NewWatchdog(store)
	loop := NewLoop(cfg, watch, store, platform, actions)
	loop.SetClock(clock.time)
	loop.syncRepair = true
	return loop, watch, store, clock
}

func degradedSample() Sample {
	return Sample{
		Supported: true,
		At:        time.Now().UTC(),
		Signals:   map[string]float64{SignalComponentStore: 1},
	}
}

func TestLoopEscalatesOneRungAtATimeAndCreditsWhatWorked(t *testing.T) {
	probeCalls, repairCalls := 0, 0
	actions := Actions{
		Probe: func() error {
			probeCalls++
			return errors.New("connection refused")
		},
		RepairLocal: func([]string) (map[string]string, error) {
			repairCalls++
			return map[string]string{}, nil
		},
	}
	loop, watch, store, clock := newTestLoop(t, testConfig(nil), &fakePlatform{}, actions)

	watch.Record(refusedConnection())
	watch.Record(refusedConnection())
	loop.tick(context.Background())

	if probeCalls != 1 {
		t.Fatalf("the read-only probe should be the first rung, got %d probe calls", probeCalls)
	}
	if repairCalls != 0 {
		t.Fatalf("one tick must only attempt one rung, got %d repair calls", repairCalls)
	}
	if stat := store.data.Actions[actionKey(CauseNetwork, ActionProbe)]; stat.Attempts != 1 || stat.Successes != 0 {
		t.Errorf("a probe that did not restore contact must be learned as a failure, got %+v", stat)
	}

	// The next rung waits for the learned pace instead of racing down the ladder.
	clock.advance(10 * time.Second)
	loop.tick(context.Background())
	if repairCalls != 0 {
		t.Fatal("the ladder must not attempt another rung before the pace has elapsed")
	}

	clock.advance(rungPaceDefault)
	loop.tick(context.Background())
	if repairCalls != 1 {
		t.Fatalf("the local state repair should run next, got %d calls", repairCalls)
	}
	if stat := store.data.Actions[actionKey(CauseNetwork, ActionRepairLocal)]; stat.Attempts != 0 {
		t.Errorf("a rung is only credited when contact returns, got %+v", stat)
	}

	watch.RecordSuccess()
	if stat := store.data.Actions[actionKey(CauseNetwork, ActionRepairLocal)]; stat.Successes != 1 {
		t.Errorf("the rung that restored contact should be credited, got %+v", stat)
	}

	// A later outage starts the ladder over rather than resuming where it stopped.
	watch.Record(refusedConnection())
	watch.Record(refusedConnection())
	clock.advance(rungPaceDefault)
	loop.tick(context.Background())
	if probeCalls != 2 {
		t.Errorf("a new outage should start from the top of the ladder, got %d probe calls", probeCalls)
	}
}

func TestLoopStartsWithLocalRepairWhenCredentialsAreRefused(t *testing.T) {
	probeCalls, repairCalls := 0, 0
	actions := Actions{
		Probe: func() error { probeCalls++; return nil },
		RepairLocal: func([]string) (map[string]string, error) {
			repairCalls++
			return map[string]string{}, nil
		},
	}
	loop, watch, _, _ := newTestLoop(t, testConfig(nil), &fakePlatform{}, actions)

	watch.Record(&transport.HTTPError{Status: 401, Message: "invalid agent token"})
	loop.tick(context.Background())

	if repairCalls != 1 {
		t.Fatalf("a refused endpoint should repair itself first, got %d repair calls", repairCalls)
	}
	if probeCalls != 0 {
		t.Errorf("probing an endpoint whose credentials are refused proves nothing, got %d probe calls", probeCalls)
	}
}

func TestLoopNeverRestartsTheServiceUnlessADeploymentAllowsIt(t *testing.T) {
	restartCalls := 0
	actions := Actions{
		Probe:          func() error { return errors.New("offline") },
		RepairLocal:    func([]string) (map[string]string, error) { return nil, errors.New("still offline") },
		ResetTransport: func() error { return nil },
		RenewIdentity:  func() error { return errors.New("cannot renew") },
		RestartService: func() error { restartCalls++; return nil },
	}
	loop, watch, _, clock := newTestLoop(t, testConfig(map[string]any{"enabled": true}), &fakePlatform{}, actions)

	watch.Record(refusedConnection())
	watch.Record(refusedConnection())
	for i := 0; i < 6; i++ {
		loop.tick(context.Background())
		clock.advance(rungPaceDefault)
	}

	if restartCalls != 0 {
		t.Fatalf("restarting the agent service is off by default, got %d calls", restartCalls)
	}
	if !strings.Contains(strings.Join(loop.events, "\n"), "exhausted") {
		t.Errorf("running out of rungs must be visible in the evidence, got %v", loop.events)
	}

	// With an explicit deployment opt-in the rung becomes eligible again.
	allowed := testConfig(map[string]any{"enabled": true, "allow_service_restart": true})
	loop2, watch2, _, clock2 := newTestLoop(t, allowed, &fakePlatform{}, actions)
	watch2.Record(refusedConnection())
	watch2.Record(refusedConnection())
	for i := 0; i < 6; i++ {
		loop2.tick(context.Background())
		clock2.advance(rungPaceDefault)
	}
	if restartCalls != 1 {
		t.Errorf("an opted-in deployment should be able to restart the service, got %d calls", restartCalls)
	}
}

func TestLoopReportsStateWithoutActingWhenPolicyDisablesSelfHealing(t *testing.T) {
	probeCalls := 0
	actions := Actions{Probe: func() error { probeCalls++; return nil }}
	loop, watch, _, _ := newTestLoop(t, testConfig(map[string]any{"enabled": false}), &fakePlatform{}, actions)

	watch.Record(refusedConnection())
	watch.Record(refusedConnection())
	loop.tick(context.Background())

	if probeCalls != 0 {
		t.Fatalf("a policy that disables self-healing must be obeyed, got %d probe calls", probeCalls)
	}
	evidence := loop.Evidence()
	if evidence.State != StateDegraded {
		t.Errorf("state = %q, want the outage still reported", evidence.State)
	}
	if !strings.Contains(strings.Join(evidence.Events, "\n"), "disabled") {
		t.Errorf("the evidence should explain why nothing was attempted, got %v", evidence.Events)
	}
}

func TestLoopRepairsWindowsOnlyWhenSustainedAndAllowed(t *testing.T) {
	platform := &fakePlatform{
		supported: true,
		elevated:  true,
		sample:    degradedSample(),
		next:      RepairRecord{Status: RepairCompleted, Verified: true, RebootRequired: true},
	}
	cfg := testConfig(map[string]any{"windows_repair_enabled": true})
	loop, _, _, clock := newTestLoop(t, cfg, platform, Actions{})

	loop.tick(context.Background())
	if platform.repairCount() != 0 {
		t.Fatal("a single degraded sample must not start a repair")
	}
	if band := loop.Evidence().Performance.Band; band != BandDegraded {
		t.Errorf("band = %q, want the degradation reported", band)
	}

	clock.advance(16 * time.Minute)
	loop.tick(context.Background())
	if platform.repairCount() != 1 {
		t.Fatalf("sustained degradation should start exactly one repair, got %d", platform.repairCount())
	}
	evidence := loop.Evidence()
	if len(evidence.Repairs) != 1 {
		t.Fatalf("the repair should be reported as evidence, got %+v", evidence.Repairs)
	}
	if !evidence.Repairs[0].Verified || !evidence.Repairs[0].RebootRequired {
		t.Errorf("repair evidence = %+v, want verified and reboot required", evidence.Repairs[0])
	}
	if evidence.Learned["repair."+evidence.Repairs[0].Trigger] == "" {
		t.Errorf("the repair outcome should be learned, got %v", evidence.Learned)
	}

	// The same day may not run a second repair, and the loop must say why.
	if reason, allowed := loop.repairBlockers(clock.time()); allowed {
		t.Error("a second repair in the same day must be refused")
	} else if !strings.Contains(reason, "cooldown") && !strings.Contains(reason, "budget") {
		t.Errorf("blocked reason = %q, want the cooldown or the budget named", reason)
	}
}

func TestLoopHoldsBackWindowsRepairWhenThePolicyOrRightsAreMissing(t *testing.T) {
	t.Run("policy does not enable it", func(t *testing.T) {
		platform := &fakePlatform{supported: true, elevated: true, sample: degradedSample()}
		loop, _, _, clock := newTestLoop(t, testConfig(nil), platform, Actions{})
		loop.tick(context.Background())
		clock.advance(16 * time.Minute)
		loop.tick(context.Background())

		if platform.repairCount() != 0 {
			t.Fatal("Windows component repair must be off unless a policy enables it")
		}
		if !strings.Contains(strings.Join(loop.events, "\n"), "held back") {
			t.Errorf("the refusal should be explainable, got %v", loop.events)
		}
	})

	t.Run("agent is not elevated", func(t *testing.T) {
		platform := &fakePlatform{supported: true, elevated: false, sample: degradedSample()}
		cfg := testConfig(map[string]any{"windows_repair_enabled": true})
		loop, _, _, clock := newTestLoop(t, cfg, platform, Actions{})
		loop.tick(context.Background())
		clock.advance(16 * time.Minute)
		loop.tick(context.Background())

		if platform.repairCount() != 0 {
			t.Fatal("an unelevated agent cannot repair the component store and must not try")
		}
		if reason, allowed := loop.repairBlockers(clock.time()); allowed || !strings.Contains(reason, "administrator") {
			t.Errorf("reason = %q, want the missing rights named", reason)
		}
	})

	t.Run("outside the maintenance window", func(t *testing.T) {
		platform := &fakePlatform{supported: true, elevated: true, sample: degradedSample()}
		cfg := testConfig(map[string]any{
			"windows_repair_enabled":           true,
			"windows_repair_window_start_hour": 2,
			"windows_repair_window_end_hour":   4,
			"windows_repair_enforce_window":    true,
		})
		loop, _, _, clock := newTestLoop(t, cfg, platform, Actions{})
		// The fake clock starts at 02:00, inside the window.
		if reason, allowed := loop.repairBlockers(clock.time()); !allowed {
			t.Fatalf("a repair inside the window should be allowed, got %q", reason)
		}
		outside := time.Date(2026, 3, 1, 9, 30, 0, 0, time.UTC)
		if reason, allowed := loop.repairBlockers(outside); allowed || !strings.Contains(reason, "maintenance window") {
			t.Errorf("reason = %q, want the maintenance window named", reason)
		}
	})
}

func TestLoopIsSilentAboutPerformanceOnPlatformsWithoutTheCapability(t *testing.T) {
	platform := &fakePlatform{supported: false}
	loop, watch, _, clock := newTestLoop(t, testConfig(map[string]any{"windows_repair_enabled": true}), platform, Actions{})

	watch.Record(refusedConnection())
	watch.Record(refusedConnection())
	loop.tick(context.Background())
	clock.advance(30 * time.Minute)
	loop.tick(context.Background())

	if loop.Evidence().Performance != nil {
		t.Errorf("a platform without the capability must not report a performance guard, got %+v", loop.Evidence().Performance)
	}
	if platform.repairCount() != 0 {
		t.Error("no repair may be attempted where the capability does not exist")
	}
}
