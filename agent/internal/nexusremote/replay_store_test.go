package nexusremote

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFileReplayStoreRejectsCorruption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-replay.jsonl")
	if err := os.WriteFile(path, []byte("{truncated"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewFileReplayStore(path, 10); err == nil {
		t.Fatal("corrupt ledger must fail closed")
	}
}

func TestFileReplayStoreSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-replay.jsonl")
	now := time.Now().UTC()
	first, err := NewFileReplayStore(path, 10)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Use("session-1", now.Add(time.Minute), now); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewFileReplayStore(path, 10)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Use("session-1", now.Add(time.Minute), now); err == nil || err.Error() != "remote grant already used" {
		t.Fatalf("expected durable replay rejection, got %v", err)
	}
}

func TestFileReplayStoreDropsExpiredRecords(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-replay.jsonl")
	now := time.Now().UTC()
	store, err := NewFileReplayStore(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Use("expired-later", now.Add(time.Second), now); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewFileReplayStore(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Use("new-session", now.Add(time.Minute), now.Add(2*time.Second)); err != nil {
		t.Fatalf("expired record should not consume capacity: %v", err)
	}
}
