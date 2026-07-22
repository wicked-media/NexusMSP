// Package canary manages Nexus Shield Canary endpoint decoys. The agent owns
// the expected fingerprint and reports only integrity state to NexusMSP; it
// never sends file contents to the server.
package canary

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"nexusagent/internal/transport"
)

type Manifest struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	SHA256    string `json:"sha256"`
	CreatedAt string `json:"created_at"`
}

type store struct {
	Canaries []Manifest `json:"canaries"`
}

func manifestPath() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(executable), "ransomware-canaries.json"), nil
}

func load() ([]Manifest, error) {
	path, err := manifestPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []Manifest{}, nil
	}
	if err != nil {
		return nil, err
	}
	var persisted store
	if err := json.Unmarshal(data, &persisted); err != nil {
		return nil, err
	}
	return persisted.Canaries, nil
}

func save(canaries []Manifest) error {
	path, err := manifestPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(store{Canaries: canaries}, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

// Deploy creates one small decoy file and pins its expected SHA-256 locally.
// Retrying the same command is idempotent and never adopts a changed file.
func Deploy(id, path string) (Manifest, error) {
	id = strings.TrimSpace(id)
	path = strings.TrimSpace(path)
	if id == "" || len(id) > 120 || strings.ContainsAny(id, "\\/\r\n\x00") {
		return Manifest{}, fmt.Errorf("invalid canary id")
	}
	if !filepath.IsAbs(path) || len(path) > 500 || strings.ContainsAny(path, "\r\n\x00") {
		return Manifest{}, fmt.Errorf("canary path must be an absolute local path")
	}
	canaries, err := load()
	if err != nil {
		return Manifest{}, fmt.Errorf("load canary manifest: %w", err)
	}
	for _, existing := range canaries {
		if existing.ID == id {
			return existing, nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return Manifest{}, fmt.Errorf("create canary folder: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return Manifest{}, fmt.Errorf("create canary file: %w", err)
	}
	content := "Nexus Shield Canary - integrity detection sensor\r\n" + id + "\r\nDo not modify or remove this file.\r\n"
	if _, err := io.WriteString(file, content); err != nil {
		_ = file.Close()
		return Manifest{}, fmt.Errorf("write canary file: %w", err)
	}
	if err := file.Close(); err != nil {
		return Manifest{}, err
	}
	fingerprint, err := fingerprint(path)
	if err != nil {
		return Manifest{}, err
	}
	manifest := Manifest{ID: id, Path: path, SHA256: fingerprint, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	canaries = append(canaries, manifest)
	if err := save(canaries); err != nil {
		return Manifest{}, fmt.Errorf("save canary manifest: %w", err)
	}
	return manifest, nil
}

func fingerprint(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

type Loop struct {
	transport *transport.Client
	every     time.Duration
	mu        sync.Mutex
	last      map[string]string
}

func NewLoop(client *transport.Client, every time.Duration) *Loop {
	if every < 15*time.Second {
		every = 30 * time.Second
	}
	return &Loop{transport: client, every: every, last: map[string]string{}}
}

func (l *Loop) Run(ctx context.Context) {
	l.checkOnce()
	ticker := time.NewTicker(l.every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.checkOnce()
		}
	}
}

func (l *Loop) checkOnce() {
	canaries, err := load()
	if err != nil {
		log.Printf("[canary] unable to load local manifest: %v", err)
		return
	}
	for _, canary := range canaries {
		actual, err := fingerprint(canary.Path)
		state := "healthy"
		reason := ""
		if err != nil {
			state = "triggered"
			reason = "canary file is missing or unreadable"
		} else if !strings.EqualFold(actual, canary.SHA256) {
			state = "triggered"
			reason = "canary file fingerprint changed"
		}
		l.mu.Lock()
		previous := l.last[canary.ID]
		l.mu.Unlock()
		if previous == state && state == "healthy" {
			continue
		}
		payload := map[string]string{
			"canary_id":       canary.ID,
			"status":          state,
			"path":            canary.Path,
			"expected_sha256": canary.SHA256,
			"actual_sha256":   actual,
			"reason":          reason,
		}
		if err := l.transport.Do("POST", "/api/ransomware-canary/agent/events", payload, nil); err != nil {
			log.Printf("[canary] report %s failed: %v", canary.ID, err)
			continue
		}
		// Only suppress a subsequent healthy report once the server has accepted
		// this one. This covers the brief interval between file deployment and
		// command-result reconciliation on the API.
		l.mu.Lock()
		l.last[canary.ID] = state
		l.mu.Unlock()
	}
}
