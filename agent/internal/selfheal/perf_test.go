package selfheal

import (
	"math"
	"testing"
	"time"
)

func quietSample(cpu, memory, freeDisk float64) Sample {
	return Sample{
		Supported: true,
		At:        time.Now().UTC(),
		Signals: map[string]float64{
			SignalCPUPercent:      cpu,
			SignalMemoryPercent:   memory,
			SignalDiskFreePercent: freeDisk,
		},
	}
}

func learnQuietBaseline(baseline *PerfBaseline, samples int) {
	for i := 0; i < samples; i++ {
		baseline.Observe(map[string]float64{
			SignalCPUPercent:      20,
			SignalMemoryPercent:   45,
			SignalDiskFreePercent: 60,
		})
	}
}

func TestAssessLearnsBeforeItJudges(t *testing.T) {
	baseline := &PerfBaseline{}
	verdict := Assess(baseline, quietSample(95, 98, 2))
	if verdict.Band != BandLearning {
		t.Fatalf("a new endpoint must not be judged before it has a baseline, got %q", verdict.Band)
	}
	if len(verdict.Reasons) != 0 {
		t.Errorf("no signal should be claimed while learning, got %v", verdict.Reasons)
	}
}

func TestAssessCallsSustainedSpikeDegradedAgainstTheLearnedBaseline(t *testing.T) {
	baseline := &PerfBaseline{}
	// A slightly noisy but stable endpoint.
	for i := 0; i < MinBaselineSamples; i++ {
		jitter := float64(i%4) - 1.5
		baseline.Observe(map[string]float64{
			SignalCPUPercent:      20 + jitter,
			SignalMemoryPercent:   45 + jitter,
			SignalDiskFreePercent: 60 + jitter,
		})
	}
	if !baseline.Ready() {
		t.Fatal("the baseline should be ready after the minimum sample count")
	}

	quiet := Assess(baseline, quietSample(22, 46, 59))
	if quiet.Band != BandHealthy {
		t.Fatalf("a normal sample on a learned endpoint should be healthy, got %q (%s)", quiet.Band, formatReasons(quiet.Reasons))
	}
	if quiet.Signature != "" {
		t.Errorf("a healthy sample has no degradation signature, got %q", quiet.Signature)
	}

	degraded := Assess(baseline, quietSample(90, 92, 58))
	if degraded.Band != BandDegraded {
		t.Fatalf("a sustained CPU and memory spike should be degraded, got %q (%s)", degraded.Band, formatReasons(degraded.Reasons))
	}
	if len(degraded.Reasons) < 2 {
		t.Errorf("both exceeded signals should be explained, got %v", degraded.Reasons)
	}
	if degraded.Signature != SignalCPUPercent+"+"+SignalMemoryPercent {
		t.Errorf("signature = %q, want the two trigger keys", degraded.Signature)
	}
	if degraded.Score < degradedScore {
		t.Errorf("score = %.2f, want at least %.2f", degraded.Score, degradedScore)
	}
}

func TestAssessTreatsLowFreeSpaceAsWorseWhenLow(t *testing.T) {
	baseline := &PerfBaseline{}
	learnQuietBaseline(baseline, MinBaselineSamples)

	verdict := Assess(baseline, quietSample(21, 46, 2))
	if verdict.Band != BandDegraded {
		t.Fatalf("a nearly full system volume should be degraded, got %q", verdict.Band)
	}
	if verdict.Signature != SignalDiskFreePercent {
		t.Errorf("signature = %q, want %q", verdict.Signature, SignalDiskFreePercent)
	}
}

func TestAssessTreatsComponentStoreCorruptionAsAHardSignal(t *testing.T) {
	// No baseline at all: corruption is not a statistical judgement.
	sample := Sample{
		Supported: true,
		At:        time.Now().UTC(),
		Signals:   map[string]float64{SignalComponentStore: 1},
	}
	verdict := Assess(&PerfBaseline{}, sample)
	if verdict.Band != BandDegraded {
		t.Fatalf("repairable component store corruption should be degraded immediately, got %q", verdict.Band)
	}
	if verdict.Signature != SignalComponentStore {
		t.Errorf("signature = %q, want %q", verdict.Signature, SignalComponentStore)
	}

	unrepairable := sample
	unrepairable.Signals = map[string]float64{SignalComponentStore: 2}
	if got := Assess(&PerfBaseline{}, unrepairable); got.Score <= verdict.Score {
		t.Errorf("unrepairable corruption should score higher than repairable, got %.2f vs %.2f", got.Score, verdict.Score)
	}
}

func TestAssessReportsAPendingRebootWithoutTriggeringRepair(t *testing.T) {
	baseline := &PerfBaseline{}
	learnQuietBaseline(baseline, MinBaselineSamples)
	sample := quietSample(21, 46, 59)
	sample.Signals[SignalPendingReboot] = 1

	verdict := Assess(baseline, sample)
	if verdict.Band != BandWatch {
		t.Fatalf("a pending restart alone should be watch, not a repair trigger, got %q", verdict.Band)
	}
	if verdict.Signature != "" {
		t.Errorf("a pending restart must not become a repair trigger signature, got %q", verdict.Signature)
	}
}

func TestBaselineIgnoresUnsupportedSamples(t *testing.T) {
	baseline := &PerfBaseline{}
	verdict := Assess(baseline, Sample{Supported: false})
	if verdict.Band != BandUnsupported {
		t.Fatalf("band = %q, want %q", verdict.Band, BandUnsupported)
	}
	if baseline.Samples != 0 {
		t.Errorf("an unsupported platform must not accumulate a baseline, got %d", baseline.Samples)
	}
}

func TestBaselineToleranceNeverCollapsesToZero(t *testing.T) {
	baseline := &PerfBaseline{}
	// A perfectly flat signal has zero variance, which would make any movement
	// look infinitely significant if the floor were not applied.
	for i := 0; i < MinBaselineSamples; i++ {
		baseline.Observe(map[string]float64{SignalCPUPercent: 10})
	}
	mean, tolerance, ok := baseline.Threshold(SignalCPUPercent, 3, 12)
	if !ok {
		t.Fatal("threshold should exist for an observed signal")
	}
	if mean != 10 {
		t.Errorf("mean = %.2f, want 10", mean)
	}
	if math.Abs(tolerance-12) > 0.001 {
		t.Errorf("tolerance = %.2f, want the 12 point floor", tolerance)
	}
	if _, _, ok := baseline.Threshold("never_seen", 3, 12); ok {
		t.Error("a signal that was never observed has no threshold")
	}
}

func TestTrackerFiresOnceAndOnlyWhenDegradationIsSustained(t *testing.T) {
	tracker := &Tracker{Sustain: 15 * time.Minute, ClearFor: 10 * time.Minute}
	start := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)

	if tracker.Push(start, false) {
		t.Fatal("a healthy sample must not start a repair")
	}
	if tracker.Push(start, true) {
		t.Fatal("a single degraded sample is not enough to act on")
	}
	if !tracker.Active() {
		t.Error("the tracker should know it is inside a degradation episode")
	}
	if tracker.Push(start.Add(14*time.Minute), true) {
		t.Fatal("degradation must be sustained for the full window")
	}
	if !tracker.Push(start.Add(16*time.Minute), true) {
		t.Fatal("sustained degradation should fire exactly once")
	}
	if tracker.Push(start.Add(17*time.Minute), true) {
		t.Fatal("a repair must not be re-triggered by every later sample")
	}
	if tracker.Push(start.Add(18*time.Minute), false) {
		t.Fatal("recovery never fires a repair")
	}
	// Still inside the clear window, so the episode has not closed yet.
	tracker.Push(start.Add(20*time.Minute), true)
	if tracker.Push(start.Add(21*time.Minute), true) {
		t.Fatal("a brief improvement must not reopen the episode as a new repair")
	}
	// Sustained recovery closes the episode, so a later degradation is new.
	tracker.Push(start.Add(40*time.Minute), false)
	tracker.Push(start.Add(52*time.Minute), false)
	if tracker.Push(start.Add(53*time.Minute), true) {
		t.Fatal("the new episode still needs to be sustained")
	}
	if !tracker.Push(start.Add(70*time.Minute), true) {
		t.Fatal("a genuinely new degradation should be able to trigger again")
	}
}
