// Platform-neutral performance scoring for the self-heal loop.
//
// The point of this file is that "degraded" is measured against a baseline
// learned on the endpoint itself, not against a fixed number that is wrong for
// every machine except the one it was written on. A quiet CAD workstation and a
// busy build server have very different normal CPU and memory curves; both are
// "healthy" until they leave their own envelope and stay there.
package selfheal

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// Signals reported by a platform probe.
const (
	SignalCPUPercent      = "cpu_percent"
	SignalMemoryPercent   = "memory_percent"
	SignalDiskFreePercent = "disk_free_min_percent"
	// 0 = no component store corruption, 1 = repairable, 2 = not repairable.
	SignalComponentStore = "component_store_health"
	SignalPendingReboot  = "pending_reboot"
)

// Bands a probe result can land in.
const (
	BandUnsupported = "unsupported"
	BandLearning    = "learning"
	BandHealthy     = "healthy"
	BandWatch       = "watch"
	BandDegraded    = "degraded"
	BandRepairing   = "repairing"
)

const (
	// MinBaselineSamples is how much quiet history a new endpoint needs before
	// any repair can be justified. Until then the band is "learning".
	MinBaselineSamples = 20
	baselineAlpha      = 0.2
	// degradedScore is the weighted exceedance needed to call an endpoint
	// degraded rather than merely worth watching.
	degradedScore = 1.0
)

// Sample is one observation of an endpoint's performance signals.
type Sample struct {
	Supported bool               `json:"supported"`
	At        time.Time          `json:"at"`
	Signals   map[string]float64 `json:"signals,omitempty"`
	Details   map[string]string  `json:"details,omitempty"`
}

// PerfEvidence is the bounded, reportable summary of the performance guard.
type PerfEvidence struct {
	Supported bool     `json:"supported"`
	Band      string   `json:"band"`
	Score     float64  `json:"score"`
	Samples   int      `json:"samples"`
	Reasons   []string `json:"reasons,omitempty"`
}

// PerfBaseline is the endpoint's learned normal, persisted between runs.
type PerfBaseline struct {
	Samples  int                `json:"samples"`
	Mean     map[string]float64 `json:"mean,omitempty"`
	Variance map[string]float64 `json:"variance,omitempty"`
}

// Observe folds one healthy sample into the baseline. Degraded samples are
// deliberately never observed: letting a sick endpoint redefine "normal" is how
// a performance guard silently stops guarding anything.
func (b *PerfBaseline) Observe(signals map[string]float64) {
	if b.Mean == nil {
		b.Mean = map[string]float64{}
	}
	if b.Variance == nil {
		b.Variance = map[string]float64{}
	}
	for key, value := range signals {
		previous, seen := b.Mean[key]
		if !seen {
			b.Mean[key] = value
			b.Variance[key] = 0
			continue
		}
		delta := value - previous
		b.Mean[key] = previous + baselineAlpha*delta
		// Exponential moving variance: the memory of how much this endpoint
		// normally moves on its own, which is exactly the noise floor.
		b.Variance[key] = (1 - baselineAlpha) * (b.Variance[key] + baselineAlpha*delta*delta)
	}
	b.Samples++
}

// Ready reports whether there is enough history to judge the endpoint.
func (b *PerfBaseline) Ready() bool {
	return b != nil && b.Samples >= MinBaselineSamples
}

// Threshold returns the learned mean and the tolerance band for one signal.
func (b *PerfBaseline) Threshold(key string, sdMultiple, floor float64) (float64, float64, bool) {
	if b == nil || b.Mean == nil {
		return 0, 0, false
	}
	mean, ok := b.Mean[key]
	if !ok {
		return 0, 0, false
	}
	tolerance := math.Sqrt(b.Variance[key]) * sdMultiple
	if tolerance < floor || math.IsNaN(tolerance) {
		tolerance = floor
	}
	return mean, tolerance, true
}

// signalSpec describes how one signal misbehaves.
type signalSpec struct {
	Key          string
	Weight       float64
	SDMultiple   float64
	Floor        float64
	WorseWhenLow bool
}

// performanceSignals are the signals that actually cost an end user time.
// Free space is weighted hardest because a nearly full system volume degrades
// everything else on the machine, including the ability to repair it.
var performanceSignals = []signalSpec{
	{Key: SignalCPUPercent, Weight: 1.0, SDMultiple: 3.0, Floor: 12},
	{Key: SignalMemoryPercent, Weight: 1.0, SDMultiple: 3.0, Floor: 8},
	{Key: SignalDiskFreePercent, Weight: 1.5, SDMultiple: 2.0, Floor: 3, WorseWhenLow: true},
}

// Verdict is the assessment of one sample.
type Verdict struct {
	Band      string
	Score     float64
	Reasons   []string
	Signature string
}

// Assess compares one sample against the learned baseline.
func Assess(baseline *PerfBaseline, sample Sample) Verdict {
	verdict := Verdict{Band: BandHealthy}
	if !sample.Supported {
		verdict.Band = BandUnsupported
		return verdict
	}
	var reasons []string
	var triggered []string

	// Component store corruption is a hard signal, not a statistical one: the
	// servicing stack already told us the image is wrong. It is also the exact
	// condition the inbuilt Windows repair exists to fix.
	hardTrigger := false
	if health, ok := sample.Signals[SignalComponentStore]; ok {
		switch {
		case health >= 2:
			hardTrigger = true
			verdict.Score += 3
			reasons = append(reasons, "component store reports NOT REPAIRABLE corruption")
			triggered = append(triggered, SignalComponentStore)
		case health >= 1:
			hardTrigger = true
			verdict.Score += 2
			reasons = append(reasons, "component store reports repairable corruption")
			triggered = append(triggered, SignalComponentStore)
		}
	}
	if sample.Signals[SignalPendingReboot] > 0 {
		// A pending reboot depresses performance but is normal operation between
		// patch cycles, so it is reported, never a repair trigger.
		reasons = append(reasons, "a restart is pending from earlier servicing")
	}

	ready := baseline.Ready()
	if ready {
		for _, spec := range performanceSignals {
			value, ok := sample.Signals[spec.Key]
			if !ok {
				continue
			}
			mean, tolerance, ok := baseline.Threshold(spec.Key, spec.SDMultiple, spec.Floor)
			if !ok {
				continue
			}
			exceedance := (value - mean) / tolerance
			if spec.WorseWhenLow {
				exceedance = -exceedance
			}
			if exceedance >= 1 {
				verdict.Score += spec.Weight * exceedance
				reasons = append(reasons, fmt.Sprintf("%s at %.1f vs learned %.1f", spec.Key, value, mean))
				triggered = append(triggered, spec.Key)
			}
		}
	}

	sort.Strings(triggered)
	verdict.Signature = strings.Join(triggered, "+")
	verdict.Reasons = reasons

	switch {
	case hardTrigger:
		verdict.Band = BandDegraded
	case !ready:
		verdict.Band = BandLearning
	case verdict.Score >= degradedScore:
		verdict.Band = BandDegraded
	case len(reasons) > 0:
		// Something worth an operator's attention was observed, but not enough of
		// it to justify touching the machine. A pending restart lands here.
		verdict.Band = BandWatch
	default:
		verdict.Band = BandHealthy
	}
	return verdict
}

// Tracker applies hysteresis, so a single bad sample never starts a repair and a
// single good sample never claims the repair worked.
type Tracker struct {
	Sustain  time.Duration
	ClearFor time.Duration

	degradedSince time.Time
	healthySince  time.Time
	fired         bool
}

func (t *Tracker) sustain() time.Duration {
	if t.Sustain <= 0 {
		return 15 * time.Minute
	}
	return t.Sustain
}

func (t *Tracker) clearFor() time.Duration {
	if t.ClearFor <= 0 {
		return 10 * time.Minute
	}
	return t.ClearFor
}

// Push records one observation and reports true exactly once per degradation
// episode, once the degradation has been sustained long enough to act on.
func (t *Tracker) Push(now time.Time, degraded bool) bool {
	if degraded {
		t.healthySince = time.Time{}
		if t.degradedSince.IsZero() {
			t.degradedSince = now
		}
		if !t.fired && now.Sub(t.degradedSince) >= t.sustain() {
			t.fired = true
			return true
		}
		return false
	}
	if t.degradedSince.IsZero() {
		return false
	}
	if t.healthySince.IsZero() {
		t.healthySince = now
	}
	if now.Sub(t.healthySince) >= t.clearFor() {
		// Sustained recovery closes the episode, so a later degradation is a
		// new one and can start a new repair.
		t.degradedSince = time.Time{}
		t.healthySince = time.Time{}
		t.fired = false
	}
	return false
}

// Active reports whether the tracker is inside a degradation episode.
func (t *Tracker) Active() bool {
	return !t.degradedSince.IsZero()
}
