package selfheal

import (
	"context"
	"crypto/x509"
	"errors"
	"net"
	"sync"
	"syscall"
	"testing"
	"time"

	"nexusagent/internal/transport"
)

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{now: time.Date(2026, 3, 1, 2, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func (c *fakeClock) time() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func refusedConnection() error {
	return &net.OpError{Op: "dial", Net: "tcp", Err: syscall.ECONNREFUSED}
}

func TestClassifyPicksTheCauseNotJustTheText(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want Cause
	}{
		{"nil error is not a failure", nil, CauseNone},
		{"refused token", &transport.HTTPError{Status: 401, Message: "invalid agent token"}, CauseAuth},
		{"forbidden token", &transport.HTTPError{Status: 403, Message: "forbidden"}, CauseAuth},
		{"server error is the platform's problem", &transport.HTTPError{Status: 503, Message: "unavailable"}, CauseServer},
		{"refused request", &transport.HTTPError{Status: 422, Message: "invalid payload"}, CauseRequestRejected},
		{"unknown ca", x509.UnknownAuthorityError{}, CauseTLS},
		{"dns failure", &net.DNSError{Err: "no such host", Name: "nexus.example"}, CauseDNS},
		{"timeout", context.DeadlineExceeded, CauseTimeout},
		{"refused connection", refusedConnection(), CauseNetwork},
		{"anything else", errors.New("something odd"), CauseUnknown},
	}
	for _, testCase := range cases {
		if got := Classify(testCase.err); got != testCase.want {
			t.Errorf("%s: Classify() = %q, want %q", testCase.name, got, testCase.want)
		}
	}
}

func TestWatchdogEscalatesFromDegradedToDisconnected(t *testing.T) {
	clock := newFakeClock()
	watch := NewWatchdog(NewStore())
	watch.SetClock(clock.time)

	if got := watch.Status().State; got != StateUnknown {
		t.Fatalf("a fresh watchdog should not claim connectivity, got %q", got)
	}
	watch.Record(refusedConnection())
	if got := watch.Status().State; got != StateConnected {
		t.Errorf("a single missed heartbeat is inside tolerance, got %q", got)
	}
	watch.Record(refusedConnection())
	if got := watch.Status().State; got != StateDegraded {
		t.Errorf("two missed heartbeats should be degraded, got %q", got)
	}
	for i := 0; i < 3; i++ {
		watch.Record(refusedConnection())
	}
	status := watch.Status()
	if status.State != StateDisconnected {
		t.Fatalf("four missed heartbeats should be disconnected, got %q", status.State)
	}
	if status.Cause != CauseNetwork {
		t.Errorf("cause = %q, want %q", status.Cause, CauseNetwork)
	}
	if status.ConsecutiveFailures != 5 {
		t.Errorf("consecutive failures = %d, want 5", status.ConsecutiveFailures)
	}
	if status.LastError == "" {
		t.Error("the last failure reason should be reported, not swallowed")
	}
}

func TestWatchdogTreatsRefusedCredentialsAsItsOwnState(t *testing.T) {
	watch := NewWatchdog(NewStore())
	watch.Record(&transport.HTTPError{Status: 401, Message: "invalid agent token"})
	status := watch.Status()
	if status.State != StateRejected {
		t.Fatalf("state = %q, want %q", status.State, StateRejected)
	}
	if status.Cause != CauseAuth {
		t.Errorf("cause = %q, want %q", status.Cause, CauseAuth)
	}
}

func TestWatchdogLearnsWhichRungRestoredContact(t *testing.T) {
	clock := newFakeClock()
	store := NewStore()
	watch := NewWatchdog(store)
	watch.SetClock(clock.time)

	watch.Record(refusedConnection())
	// A second miss takes the endpoint past its tolerance window, so this is now
	// an outage the agent is expected to recover from, not a single hiccup.
	watch.Record(refusedConnection())
	// A rung that is opened and then abandoned by the next rung did not work.
	watch.MarkRung(ActionProbe)
	clock.advance(time.Minute)
	watch.MarkRung(ActionRepairLocal)
	// Contact returns while the second rung is still open, so that one gets credit.
	watch.RecordSuccess()

	probing := store.data.Actions[actionKey(CauseNetwork, ActionProbe)]
	if probing.Attempts != 1 || probing.Successes != 0 {
		t.Errorf("the abandoned rung should be recorded as failed, got %+v", probing)
	}
	repairing := store.data.Actions[actionKey(CauseNetwork, ActionRepairLocal)]
	if repairing.Attempts != 1 || repairing.Successes != 1 {
		t.Errorf("the open rung should be credited on recovery, got %+v", repairing)
	}

	status := watch.Status()
	if status.State != StateConnected {
		t.Fatalf("state = %q, want connected", status.State)
	}
	if status.OutagesRecovered != 1 {
		t.Errorf("outages recovered = %d, want 1", status.OutagesRecovered)
	}
	if len(store.data.OutagesSeconds) != 1 {
		t.Fatalf("the outage duration should be learned, got %v", store.data.OutagesSeconds)
	}
	if store.data.OutagesSeconds[0] != 60 {
		t.Errorf("outage recorded as %ds, want 60", store.data.OutagesSeconds[0])
	}
	results := map[string]string{}
	for _, action := range status.RecentActions {
		results[action.Action] = action.Result
	}
	if results[ActionProbe] != "failed" || results[ActionRepairLocal] != "succeeded" {
		t.Errorf("recent actions = %v, want probe failed and repair succeeded", results)
	}
}

func TestWatchdogReportsTheOutageAsItGrows(t *testing.T) {
	clock := newFakeClock()
	watch := NewWatchdog(NewStore())
	watch.SetClock(clock.time)
	watch.Record(refusedConnection())
	watch.Record(refusedConnection())
	clock.advance(5 * time.Minute)
	status := watch.Status()
	if status.OutageSeconds != 300 {
		t.Errorf("outage seconds = %d, want 300", status.OutageSeconds)
	}
	if status.LastSuccess != "" {
		t.Errorf("an endpoint that never reached the server cannot claim a success, got %q", status.LastSuccess)
	}
}
