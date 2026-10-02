package nexusbackup

import (
	"context"
	"log"
	"time"

	"nexusagent/internal/config"
	"nexusagent/internal/transport"
)

// PreflightLoop owns the dedicated Backup preflight protocol. It does not use
// the generic command queue and cannot access files, invoke VSS, transfer
// bytes, or request a restore.
type PreflightLoop struct {
	tr    *transport.Client
	cfg   *config.Config
	every time.Duration
}

type preflightJob struct {
	ID      string `json:"id"`
	LeaseID string `json:"lease_id"`
}

func NewPreflightLoop(tr *transport.Client, cfg *config.Config, fallback time.Duration) *PreflightLoop {
	every := time.Duration(cfg.PollSecs) * time.Second
	if every <= 0 {
		every = fallback
	}
	if every < 15*time.Second {
		every = 15 * time.Second
	}
	return &PreflightLoop{tr: tr, cfg: cfg, every: every}
}

func (l *PreflightLoop) Run(ctx context.Context) {
	l.pollOnce()
	ticker := time.NewTicker(l.every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.pollOnce()
		}
	}
}

func (l *PreflightLoop) pollOnce() {
	if l.cfg == nil || !l.cfg.NexusBackupPreflightEnabled() {
		return
	}
	var response struct {
		Jobs []preflightJob `json:"jobs"`
	}
	if err := l.tr.Do("GET", "/api/nexus-agent/backup/preflight/poll", nil, &response); err != nil {
		log.Printf("[nexus-backup] preflight poll error: %v", err)
		return
	}
	for _, job := range response.Jobs {
		if job.ID == "" || job.LeaseID == "" {
			continue
		}
		probe := Probe(context.Background())
		result := map[string]any{
			"lease_id": job.LeaseID,
			"status":   "inventory_only",
			"evidence": map[string]any{
				"schema_version":        1,
				"state":                 "inventory_only",
				"platform":              probe["platform"],
				"vss_state":             probe["vss_state"],
				"volume_capacity_state": probe["volume_capacity_state"],
				"execution_enabled":     false,
				"files_accessed":        false,
				"snapshot_created":      false,
				"upload_bytes":          0,
				"restore_requested":     false,
				"capabilities":          []string{CapabilityInventoryV1, "nexus_backup_preflight_v1"},
				"observed_at":           time.Now().UTC().Format(time.RFC3339),
			},
		}
		if err := l.tr.Do("POST", "/api/nexus-agent/backup/preflight/"+job.ID+"/result", result, nil); err != nil {
			log.Printf("[nexus-backup] preflight result error for %s: %v", job.ID, err)
		}
	}
}
