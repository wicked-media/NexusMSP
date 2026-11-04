package selfheal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPatienceStartsPatientAndTightensForSlowOutages(t *testing.T) {
	fresh := NewStore()
	if degraded, disconnected := fresh.Patience(); degraded != defaultDegradedAfter || disconnected != defaultDisconnectedAfter {
		t.Fatalf("a fresh endpoint should be patient, got (%d, %d)", degraded, disconnected)
	}

	quick := NewStore()
	quick.ObserveOutage(45)
	quick.ObserveOutage(60)
	quick.ObserveOutage(90)
	if degraded, disconnected := quick.Patience(); degraded != defaultDegradedAfter || disconnected != defaultDisconnectedAfter {
		t.Errorf("short outages should not make the agent jumpy, got (%d, %d)", degraded, disconnected)
	}

	slow := NewStore()
	slow.ObserveOutage(300)
	slow.ObserveOutage(600)
	slow.ObserveOutage(900)
	if degraded, disconnected := slow.Patience(); degraded != 2 || disconnected != 3 {
		t.Errorf("mid-length outages should tighten escalation, got (%d, %d)", degraded, disconnected)
	}

	stuck := NewStore()
	stuck.ObserveOutage(3600)
	stuck.ObserveOutage(5400)
	if degraded, disconnected := stuck.Patience(); degraded != 1 || disconnected != 2 {
		t.Errorf("an endpoint whose outages last hours should escalate immediately, got (%d, %d)", degraded, disconnected)
	}
}

func TestRankedActionsStartsFromSafetyAndLearnsFromEvidence(t *testing.T) {
	store := NewStore()
	candidates := []string{
		ActionProbe, ActionRepairLocal, ActionResetTransport, ActionReenroll, ActionRestartService,
	}
	cold := store.RankedActions(CauseNetwork, candidates)
	if cold[0] != ActionProbe {
		t.Fatalf("the read-only probe should be tried first on a fresh endpoint, got %q", cold[0])
	}
	if cold[len(cold)-1] != ActionRestartService {
		t.Errorf("the most disruptive action should be last, got %q", cold[len(cold)-1])
	}

	// On this endpoint, renewing the identity has actually worked; rewriting the
	// local state has not. The ladder must prefer what works here.
	for i := 0; i < 3; i++ {
		store.Credit(CauseAuth, ActionRenewIdentity, true)
		store.Credit(CauseAuth, ActionRepairLocal, false)
	}
	ranked := store.RankedActions(CauseAuth, []string{ActionRepairLocal, ActionRenewIdentity, ActionResetTransport})
	if ranked[0] != ActionRenewIdentity {
		t.Fatalf("the ladder should lead with the action that works, got %q", ranked[0])
	}
	if ranked[len(ranked)-1] != ActionRepairLocal {
		t.Errorf("the action that keeps failing should sink, got %q", ranked[len(ranked)-1])
	}
}

func TestDailyCapsBoundDisruptiveRungs(t *testing.T) {
	store := NewStore()
	now := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)

	if allowed, _ := store.AllowAction(ActionProbe, now); !allowed {
		t.Error("a read-only probe needs no daily cap")
	}
	if allowed, _ := store.AllowAction(ActionReenroll, now); !allowed {
		t.Fatal("the first re-enrollment of the day should be allowed")
	}
	store.RecordAction(ActionReenroll, now)
	if allowed, reason := store.AllowAction(ActionReenroll, now); allowed {
		t.Error("re-enrollment consumes an enrollment token and must be capped")
	} else if !strings.Contains(reason, ActionReenroll) {
		t.Errorf("the blocked reason should name the action, got %q", reason)
	}

	for i := 0; i < 3; i++ {
		if allowed, _ := store.AllowAction(ActionRestartService, now); !allowed {
			t.Fatalf("service restart %d of 3 should be allowed", i+1)
		}
		store.RecordAction(ActionRestartService, now)
	}
	if allowed, _ := store.AllowAction(ActionRestartService, now); allowed {
		t.Error("a fourth service restart in one day must be refused")
	}
	// A restart that has never helped this endpoint is not worth repeating.
	for i := 0; i < 2; i++ {
		store.Credit(CauseUnknown, ActionRestartService, false)
	}
	if cap := store.dailyCap(ActionRestartService); cap != 1 {
		t.Errorf("daily cap = %d, want 1 once restarts are known to be useless here", cap)
	}
	if allowed, _ := store.AllowAction(ActionRestartService, now.Add(24*time.Hour)); !allowed {
		t.Error("a new day should reset the cap")
	}
}

func TestAllowWindowsRepairRespectsCooldownAndDailyBudget(t *testing.T) {
	store := NewStore()
	now := time.Date(2026, 3, 1, 3, 0, 0, 0, time.UTC)

	if allowed, reason := store.AllowWindowsRepair(1, now); !allowed {
		t.Fatalf("a first repair should be allowed, got %q", reason)
	}
	store.RecordWindowsRepairStarted(now)
	allowed, reason := store.AllowWindowsRepair(1, now.Add(2*time.Hour))
	if allowed {
		t.Error("a second repair inside the learned cooldown must be refused")
	}
	if !strings.Contains(reason, "cooldown") {
		t.Errorf("reason = %q, want the cooldown explained", reason)
	}
	if allowed, _ := store.AllowWindowsRepair(1, now.Add(25*time.Hour)); !allowed {
		t.Error("the next day, past the cooldown, should be allowed again")
	}

	// A repair history that never verifies is learned as "stop trying this".
	store2 := NewStore()
	for i := 0; i < 3; i++ {
		store2.CreditRepair("windows_component_repair", false)
	}
	if cooldown := store2.RepairCooldown(); cooldown != 72*time.Hour {
		t.Errorf("cooldown = %v, want 72h after three unverified repairs", cooldown)
	}
	store2.RecordWindowsRepairStarted(now)
	if allowed, _ := store2.AllowWindowsRepair(1, now.Add(25*time.Hour)); allowed {
		t.Error("a repair that keeps failing must not run again the next day")
	}
}

func TestStoreSurvivesRestartAndRepairsADamagedFile(t *testing.T) {
	directory := t.TempDir()
	store := OpenStore(directory)
	store.Credit(CauseNetwork, ActionRepairLocal, true)
	store.ObserveOutage(120)
	store.ObserveHealthy(map[string]float64{SignalCPUPercent: 12})

	reloaded := OpenStore(directory)
	if stat := reloaded.data.Actions[actionKey(CauseNetwork, ActionRepairLocal)]; stat.Successes != 1 {
		t.Errorf("learned outcomes should survive a restart, got %+v", stat)
	}
	if len(reloaded.data.OutagesSeconds) != 1 {
		t.Errorf("outage history should survive a restart, got %v", reloaded.data.OutagesSeconds)
	}
	if reloaded.data.Perf == nil || reloaded.data.Perf.Samples != 1 {
		t.Errorf("the performance baseline should survive a restart, got %+v", reloaded.data.Perf)
	}

	// A damaged state file must never stop the agent: it is the file that records
	// self-repair, so refusing to start would be the worst possible failure.
	path := filepath.Join(directory, stateFileName)
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatalf("prepare damaged state: %v", err)
	}
	recovered := OpenStore(directory)
	if recovered.data.Notes["recovered_from"] == "" {
		t.Error("a damaged state file should be recorded, not silently ignored")
	}
	if len(recovered.data.Actions) != 0 {
		t.Errorf("a damaged profile should start empty, got %v", recovered.data.Actions)
	}
}

func TestLearnedSummaryExplainsTheAgentsBehaviour(t *testing.T) {
	store := NewStore()
	store.Credit(CauseAuth, ActionRenewIdentity, true)
	store.Credit(CauseAuth, ActionRenewIdentity, true)
	store.Credit(CauseAuth, ActionRepairLocal, false)
	store.ObserveOutage(3600)
	store.CreditRepair("windows_component_repair", true)
	store.RecordWindowsRepairStarted(time.Date(2026, 3, 1, 3, 0, 0, 0, time.UTC))

	learned := store.Learned(time.Date(2026, 3, 1, 4, 0, 0, 0, time.UTC))
	for _, key := range []string{
		"escalation.degraded_after",
		"escalation.disconnected_after",
		"performance.baseline_samples",
		"windows_repair.cooldown_hours",
		"windows_repair.runs_total",
		"outage.median_seconds",
		"action.auth/" + ActionRenewIdentity,
		"repair.windows_component_repair",
	} {
		if learned[key] == "" {
			t.Errorf("learned summary is missing %q (%v)", key, learned)
		}
	}
	if learned["action.auth/"+ActionRenewIdentity] != "2/2 succeeded" {
		t.Errorf("action summary = %q, want 2/2 succeeded", learned["action.auth/"+ActionRenewIdentity])
	}
	if learned["escalation.degraded_after"] != "1 missed heartbeat(s)" {
		t.Errorf("escalation summary = %q, want the learned patience", learned["escalation.degraded_after"])
	}
}
