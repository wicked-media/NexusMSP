// Durable, endpoint-local memory for the self-heal loop.
//
// The agent keeps learning on the endpoint it runs on: which repair action
// actually restores contact for the failure cause it observed, how long its own
// outages normally last, how much performance noise is normal for this machine,
// and whether the inbuilt Windows repair has been helping. That is what makes the
// ladder adaptive instead of a fixed script.
//
// This state is endpoint-local bookkeeping about the agent itself. It is never a
// system of record: NexusMSP owns the durable audit trail, and everything here is
// reported upward as evidence.
package selfheal

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	stateFileName = "self-heal-state.json"
	stateSchema   = 1

	maxOutageHistory = 32
	maxRecentActions = 12
	// actionPriorWeight is how many pseudo-observations each prior is worth: a
	// single real result moves the ranking, but never flips it wildly.
	actionPriorWeight = 2.0
)

// ActionStat is the learned outcome count for one repair action.
type ActionStat struct {
	Attempts  int `json:"attempts"`
	Successes int `json:"successes"`
}

// persistedState is the on-disk shape. It is deliberately flat and readable so a
// technician can inspect an endpoint's learned behaviour during an incident.
type persistedState struct {
	SchemaVersion     int                   `json:"schema_version"`
	CreatedAt         string                `json:"created_at,omitempty"`
	UpdatedAt         string                `json:"updated_at,omitempty"`
	Actions           map[string]ActionStat `json:"actions,omitempty"`
	OutagesSeconds    []int64               `json:"outages_seconds,omitempty"`
	Perf              *PerfBaseline         `json:"perf_baseline,omitempty"`
	Repairs           map[string]ActionStat `json:"repairs,omitempty"`
	LastWindowsRepair string                `json:"last_windows_repair,omitempty"`
	RepairDay         string                `json:"repair_day,omitempty"`
	RepairsToday      int                   `json:"repairs_today,omitempty"`
	RepairsTotal      int                   `json:"repairs_total,omitempty"`
	ActionDay         string                `json:"action_day,omitempty"`
	ActionCounts      map[string]int        `json:"action_counts,omitempty"`
	Notes             map[string]string     `json:"notes,omitempty"`
}

// Store owns the state file. It is safe for concurrent use by the heartbeat,
// watchdog and self-heal loop.
type Store struct {
	mu   sync.Mutex
	path string
	data persistedState
}

// OpenStore loads the agent's self-heal memory.
//
// A missing, corrupt or unreadable state file is never fatal. Refusing to start
// because the file that records self-repair is damaged would be the one failure
// mode this package exists to prevent, so a damaged file is replaced with a
// fresh profile and the reason is recorded in the notes.
func OpenStore(baseDir string) *Store {
	store := &Store{
		path: filepath.Join(baseDir, stateFileName),
		data: persistedState{
			SchemaVersion: stateSchema,
			CreatedAt:     time.Now().UTC().Format(time.RFC3339),
		},
	}
	raw, err := os.ReadFile(store.path)
	switch {
	case err == nil:
		var loaded persistedState
		if jsonErr := json.Unmarshal(raw, &loaded); jsonErr != nil {
			store.noteLocked("recovered_from", "unreadable state file: "+shorten(jsonErr.Error(), 120))
		} else if loaded.SchemaVersion != 0 && loaded.SchemaVersion != stateSchema {
			store.noteLocked("recovered_from", fmt.Sprintf("unsupported state schema %d", loaded.SchemaVersion))
		} else {
			loaded.SchemaVersion = stateSchema
			if loaded.CreatedAt == "" {
				loaded.CreatedAt = store.data.CreatedAt
			}
			store.data = loaded
		}
	case os.IsNotExist(err):
	default:
		store.noteLocked("recovered_from", "state file not readable: "+shorten(err.Error(), 120))
	}
	return store
}

// Path is where the learned profile lives, for logs and incident notes.
func (s *Store) Path() string { return s.path }

// NewStore returns an ephemeral profile with no file behind it. It is used when
// the agent has no writable directory and by tests.
func NewStore() *Store {
	return &Store{data: persistedState{
		SchemaVersion: stateSchema,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
	}}
}

// Save writes the profile atomically. Callers hold the lock.
func (s *Store) saveLocked() {
	if s.path == "" {
		return
	}
	s.data.SchemaVersion = stateSchema
	s.data.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	payload, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		log.Printf("[self-heal] could not encode learned profile: %v", err)
		return
	}
	if dir := filepath.Dir(s.path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			log.Printf("[self-heal] could not create state directory: %v", err)
			return
		}
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, payload, 0o600); err != nil {
		log.Printf("[self-heal] could not write learned profile: %v", err)
		return
	}
	if err := os.Rename(temporary, s.path); err != nil {
		log.Printf("[self-heal] could not commit learned profile: %v", err)
		_ = os.Remove(temporary)
	}
}

func (s *Store) noteLocked(key, value string) {
	if s.data.Notes == nil {
		s.data.Notes = map[string]string{}
	}
	s.data.Notes[key] = value
}

func actionKey(cause Cause, action string) string {
	return string(cause) + "/" + action
}

// prior returns the cold-start expectation for a repair action. Probing is first
// because it is read-only and tells the agent whether the loops or the link are
// at fault; a service restart is last because it is the most disruptive thing the
// agent can do to a working endpoint.
func prior(action string) float64 {
	switch action {
	case ActionProbe:
		return 0.9
	case ActionRepairLocal:
		return 0.5
	case ActionRenewIdentity:
		return 0.5
	case ActionResetTransport:
		return 0.35
	case ActionReenroll:
		return 0.3
	case ActionRestartService:
		return 0.15
	}
	return 0.2
}

func score(stat ActionStat, action string) float64 {
	return (float64(stat.Successes) + prior(action)*actionPriorWeight) / (float64(stat.Attempts) + actionPriorWeight)
}

// Credit records the outcome of one rung, which is how the ladder learns.
func (s *Store) Credit(cause Cause, action string, success bool) {
	if action == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Actions == nil {
		s.data.Actions = map[string]ActionStat{}
	}
	key := actionKey(cause, action)
	stat := s.data.Actions[key]
	stat.Attempts++
	if success {
		stat.Successes++
	}
	s.data.Actions[key] = stat
	s.saveLocked()
}

// RankedActions orders the given candidates for a cause, best learned action
// first. Ties keep the caller's safety ordering, so behaviour is deterministic on
// a fresh endpoint.
func (s *Store) RankedActions(cause Cause, candidates []string) []string {
	ranked := append([]string(nil), candidates...)
	s.mu.Lock()
	scores := make(map[string]float64, len(ranked))
	for _, action := range ranked {
		scores[action] = score(s.data.Actions[actionKey(cause, action)], action)
	}
	s.mu.Unlock()
	sort.SliceStable(ranked, func(i, j int) bool { return scores[ranked[i]] > scores[ranked[j]] })
	return ranked
}

// ObserveOutage keeps a bounded history of how long contact was actually lost.
func (s *Store) ObserveOutage(seconds int64) {
	if seconds < 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.OutagesSeconds = append(s.data.OutagesSeconds, seconds)
	if len(s.data.OutagesSeconds) > maxOutageHistory {
		s.data.OutagesSeconds = s.data.OutagesSeconds[len(s.data.OutagesSeconds)-maxOutageHistory:]
	}
	s.saveLocked()
}

// medianOutageSecondsLocked reads the median outage length. Callers hold the lock.
func (s *Store) medianOutageSecondsLocked() (float64, bool) {
	if len(s.data.OutagesSeconds) == 0 {
		return 0, false
	}
	values := append([]int64(nil), s.data.OutagesSeconds...)
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	middle := len(values) / 2
	if len(values)%2 == 1 {
		return float64(values[middle]), true
	}
	return float64(values[middle-1]+values[middle]) / 2, true
}

// Patience learns how long to wait before escalating. An endpoint whose recorded
// outages run into the hours is not going to fix itself by waiting another
// minute, so it escalates after the first missed heartbeat instead of the second.
func (s *Store) Patience() (int, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.patienceLocked()
}

// patienceLocked is Patience for callers that already hold the lock.
func (s *Store) patienceLocked() (int, int) {
	median, ok := s.medianOutageSecondsLocked()
	if !ok {
		return defaultDegradedAfter, defaultDisconnectedAfter
	}
	switch {
	case median <= 120:
		return defaultDegradedAfter, defaultDisconnectedAfter
	case median <= 900:
		return 2, 3
	default:
		return 1, 2
	}
}

// Baseline returns the live learned performance baseline.
func (s *Store) Baseline() *PerfBaseline {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Perf == nil {
		s.data.Perf = &PerfBaseline{}
	}
	return s.data.Perf
}

// ObserveHealthy folds a healthy sample into the baseline and persists it.
func (s *Store) ObserveHealthy(signals map[string]float64) {
	if len(signals) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Perf == nil {
		s.data.Perf = &PerfBaseline{}
	}
	s.data.Perf.Observe(signals)
	s.saveLocked()
}

// CreditRepair records whether a Windows component repair signature verified.
func (s *Store) CreditRepair(signature string, success bool) {
	if signature == "" {
		signature = "unspecified"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Repairs == nil {
		s.data.Repairs = map[string]ActionStat{}
	}
	stat := s.data.Repairs[signature]
	stat.Attempts++
	if success {
		stat.Successes++
	}
	s.data.Repairs[signature] = stat
	s.saveLocked()
}

// RepairCooldown learns how often a repair is worth attempting: repairs that keep
// failing get a longer cooldown so the agent stops thrashing a healthy-but-busy
// endpoint with a 75-minute DISM run.
func (s *Store) RepairCooldown() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.repairCooldownLocked()
}

// repairCooldownLocked is RepairCooldown for callers that already hold the lock.
func (s *Store) repairCooldownLocked() time.Duration {
	stat := aggregateStatsLocked(s.data.Repairs, "windows_component_repair")
	if stat.Attempts == 0 {
		return repairCooldownDefault
	}
	rate := float64(stat.Successes) / float64(stat.Attempts)
	switch {
	case rate >= 0.6:
		return 12 * time.Hour
	case rate >= 0.3:
		return repairCooldownDefault
	default:
		return 72 * time.Hour
	}
}

// aggregateStatsLocked totals the repair history, preferring the named signature
// and falling back to every recorded one. Callers hold the lock.
func aggregateStatsLocked(stats map[string]ActionStat, preferred string) ActionStat {
	if named, ok := stats[preferred]; ok && named.Attempts > 0 {
		return named
	}
	var total ActionStat
	for _, stat := range stats {
		total.Attempts += stat.Attempts
		total.Successes += stat.Successes
	}
	return total
}

const repairCooldownDefault = 24 * time.Hour

// AllowWindowsRepair applies the learned cooldown and the operator's daily cap.
func (s *Store) AllowWindowsRepair(maxPerDay int, now time.Time) (bool, string) {
	if maxPerDay <= 0 {
		maxPerDay = 1
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.LastWindowsRepair != "" {
		if last, err := time.Parse(time.RFC3339, s.data.LastWindowsRepair); err == nil {
			if remaining := s.repairCooldownLocked() - now.Sub(last); remaining > 0 {
				return false, fmt.Sprintf("repair cooldown active for another %d minutes", int(remaining.Minutes())+1)
			}
		}
	}
	if s.data.RepairDay != now.UTC().Format("2006-01-02") {
		return true, ""
	}
	if s.data.RepairsToday >= maxPerDay {
		return false, "daily Windows repair budget is spent"
	}
	return true, ""
}

// RecordWindowsRepairStarted counts a started repair, not a successful one: a
// repair that fails must still consume the daily budget.
func (s *Store) RecordWindowsRepairStarted(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	day := now.UTC().Format("2006-01-02")
	if s.data.RepairDay != day {
		s.data.RepairDay = day
		s.data.RepairsToday = 0
	}
	s.data.RepairsToday++
	s.data.RepairsTotal++
	s.data.LastWindowsRepair = now.UTC().Format(time.RFC3339)
	s.saveLocked()
}

// dailyCap limits how often a disruptive rung may run in one day. Unlimited
// actions return zero.
func (s *Store) dailyCap(action string) int {
	switch action {
	case ActionRestartService:
		s.mu.Lock()
		var attempts, successes int
		for key, stat := range s.data.Actions {
			if strings.HasSuffix(key, "/"+ActionRestartService) {
				attempts += stat.Attempts
				successes += stat.Successes
			}
		}
		s.mu.Unlock()
		// A service restart that has never helped this endpoint is not worth
		// repeating three times a day.
		if attempts > 0 && float64(successes)/float64(attempts) < 0.2 {
			return 1
		}
		return 3
	case ActionReenroll:
		// Re-enrollment consumes an enrollment token, so it is once a day at most.
		return 1
	}
	return 0
}

// AllowAction applies the daily cap for a disruptive rung.
func (s *Store) AllowAction(action string, now time.Time) (bool, string) {
	cap := s.dailyCap(action)
	if cap <= 0 {
		return true, ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	day := now.UTC().Format("2006-01-02")
	if s.data.ActionDay != day {
		return true, ""
	}
	if s.data.ActionCounts[action] >= cap {
		return false, fmt.Sprintf("%s has already run %d time(s) today", action, cap)
	}
	return true, ""
}

// RecordAction counts one disruptive rung run.
func (s *Store) RecordAction(action string, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	day := now.UTC().Format("2006-01-02")
	if s.data.ActionDay != day {
		s.data.ActionDay = day
		s.data.ActionCounts = map[string]int{}
	}
	if s.data.ActionCounts == nil {
		s.data.ActionCounts = map[string]int{}
	}
	s.data.ActionCounts[action]++
	s.saveLocked()
}

// Learned is the human-readable summary of everything the agent has learned, and
// it is reported with every heartbeat so an operator can see why the endpoint
// behaves the way it does.
func (s *Store) Learned(now time.Time) map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	degradedAfter, disconnectedAfter := s.patienceLocked()
	learned := map[string]string{
		"escalation.degraded_after":     fmt.Sprintf("%d missed heartbeat(s)", degradedAfter),
		"escalation.disconnected_after": fmt.Sprintf("%d missed heartbeat(s)", disconnectedAfter),
		"performance.baseline_samples":  fmt.Sprintf("%d", s.baselineSamplesLocked()),
		"windows_repair.cooldown_hours": fmt.Sprintf("%d", int(s.repairCooldownLocked().Hours())),
		"windows_repair.runs_total":     fmt.Sprintf("%d", s.data.RepairsTotal),
	}
	if median, ok := s.medianOutageSecondsLocked(); ok {
		learned["outage.median_seconds"] = fmt.Sprintf("%d", int(median))
	}
	if attempts := len(s.data.OutagesSeconds); attempts > 0 {
		learned["outage.samples"] = fmt.Sprintf("%d", attempts)
	}
	for key, stat := range s.data.Actions {
		if stat.Attempts == 0 {
			continue
		}
		learned["action."+key] = fmt.Sprintf("%d/%d succeeded", stat.Successes, stat.Attempts)
	}
	for signature, stat := range s.data.Repairs {
		if stat.Attempts == 0 {
			continue
		}
		learned["repair."+signature] = fmt.Sprintf("%d/%d verified", stat.Successes, stat.Attempts)
	}
	return learned
}

func (s *Store) baselineSamplesLocked() int {
	if s.data.Perf == nil {
		return 0
	}
	return s.data.Perf.Samples
}

// RecentWindowsRepairs reports how many repairs ran in the last day, for the
// budget explanation an operator sees.
func (s *Store) RecentWindowsRepairs(now time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.RepairDay != now.UTC().Format("2006-01-02") {
		return 0
	}
	return s.data.RepairsToday
}
