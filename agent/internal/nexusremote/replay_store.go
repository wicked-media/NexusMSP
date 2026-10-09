package nexusremote

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ReplayStore makes accepting a session grant a one-time operation.
type ReplayStore interface {
	Use(sessionID string, expiresAt, now time.Time) error
}

type MemoryReplayStore struct {
	mu       sync.Mutex
	used     map[string]time.Time
	capacity int
}

func NewMemoryReplayStore(capacity int) *MemoryReplayStore {
	if capacity <= 0 {
		capacity = 4096
	}
	return &MemoryReplayStore{used: make(map[string]time.Time), capacity: capacity}
}

func (s *MemoryReplayStore) Use(sessionID string, expiresAt, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return useReplayRecord(s.used, s.capacity, sessionID, expiresAt, now)
}

type replayRecord struct {
	SessionID string    `json:"session_id"`
	ExpiresAt time.Time `json:"expires_at"`
}

// FileReplayStore is an append-and-sync replay ledger intended for the
// singleton Nexus Agent service. A grant is written to disk before it is
// accepted, so a process restart cannot silently make it usable again.
type FileReplayStore struct {
	mu       sync.Mutex
	path     string
	used     map[string]time.Time
	capacity int
}

func NewFileReplayStore(path string, capacity int) (*FileReplayStore, error) {
	if path == "" {
		return nil, errors.New("remote replay path is required")
	}
	if capacity <= 0 {
		capacity = 4096
	}
	store := &FileReplayStore{path: path, used: make(map[string]time.Time), capacity: capacity}
	file, err := os.Open(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		defer file.Close()
		info, statErr := file.Stat()
		if statErr != nil || !info.Mode().IsRegular() || info.Size() > 16*1024*1024 {
			return nil, errors.New("remote replay ledger is invalid or exceeds its size limit")
		}
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			var record replayRecord
			if json.Unmarshal(scanner.Bytes(), &record) != nil || record.SessionID == "" || record.ExpiresAt.IsZero() {
				return nil, errors.New("remote replay ledger is corrupt; refusing grants")
			}
			store.used[record.SessionID] = record.ExpiresAt
		}
		if err := scanner.Err(); err != nil {
			return nil, err
		}
	}
	return store, nil
}

func (s *FileReplayStore) Use(sessionID string, expiresAt, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	pruneReplayRecords(s.used, now)
	if _, exists := s.used[sessionID]; exists {
		return errors.New("remote grant already used")
	}
	if sessionID == "" || !expiresAt.After(now) {
		return errors.New("invalid remote replay record")
	}
	if len(s.used) >= s.capacity {
		return errors.New("remote grant capacity reached")
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	file, err := os.OpenFile(s.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(replayRecord{SessionID: sessionID, ExpiresAt: expiresAt})
	if err == nil {
		_, err = file.Write(append(encoded, '\n'))
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	s.used[sessionID] = expiresAt
	return nil
}

func useReplayRecord(used map[string]time.Time, capacity int, sessionID string, expiresAt, now time.Time) error {
	pruneReplayRecords(used, now)
	if sessionID == "" || !expiresAt.After(now) {
		return errors.New("invalid remote replay record")
	}
	if _, exists := used[sessionID]; exists {
		return errors.New("remote grant already used")
	}
	if len(used) >= capacity {
		return errors.New("remote grant capacity reached")
	}
	used[sessionID] = expiresAt
	return nil
}

func pruneReplayRecords(used map[string]time.Time, now time.Time) {
	for id, expiry := range used {
		if !expiry.After(now) {
			delete(used, id)
		}
	}
}
