package nexusremote

import (
	"context"
	"testing"
	"time"
)

type testFrameSource struct{ calls int }

func (s *testFrameSource) CaptureJPEG(int) ([]byte, error) { s.calls++; return []byte{1, 2, 3}, nil }

type testFrameSink struct{ calls int }

func (s *testFrameSink) SendFrame(context.Context, string, []byte) error { s.calls++; return nil }

func TestViewStreamStopsOnRevocationAndReportsDisconnect(t *testing.T) {
	now := time.Now().UTC()
	session, err := New(Grant{SessionID: "session", TenantID: "tenant", DeviceID: "device", ActorID: "tech", Mode: View, ExpiresAt: now.Add(time.Minute)}, "tenant", "device", now)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Consent(now); err != nil {
		t.Fatal(err)
	}
	source, sink := &testFrameSource{}, &testFrameSink{}
	var states []string
	err = StreamViewOnly(context.Background(), session, source, sink, func(string) (bool, error) { return false, nil }, func(_ string, state, _ string) error { states = append(states, state); return nil }, StreamOptions{FrameInterval: time.Millisecond, StatusEvery: time.Millisecond})
	if err == nil || len(states) != 0 {
		t.Fatalf("err=%v states=%v", err, states)
	}
	if source.calls != 0 || sink.calls != 0 {
		t.Fatalf("revoked stream sent capture calls=%d frames=%d", source.calls, sink.calls)
	}
}

func TestViewStreamRejectsControllessInvalidSource(t *testing.T) {
	err := StreamViewOnly(context.Background(), nil, nil, nil, nil, nil, StreamOptions{})
	if err == nil {
		t.Fatal("missing dependencies accepted")
	}
}
