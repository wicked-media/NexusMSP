// Package heartbeat sends periodic telemetry snapshots to the server.
package heartbeat

import (
	"context"
	"log"
	"time"

	"nexusagent/internal/config"
	"nexusagent/internal/telemetry"
	"nexusagent/internal/transport"
)

type Loop struct {
	tr      *transport.Client
	cfg     *config.Config
	version string
	every   time.Duration
}

func NewLoop(tr *transport.Client, cfg *config.Config, version string, fallback time.Duration) *Loop {
	every := time.Duration(cfg.HeartbeatSecs) * time.Second
	if every <= 0 { every = fallback }
	return &Loop{tr: tr, cfg: cfg, version: version, every: every}
}

type payload struct {
	AgentVersion string             `json:"agent_version"`
	Snapshot     telemetry.Snapshot `json:"snapshot"`
}

func (l *Loop) Run(ctx context.Context) {
	// Send one immediately on startup so the server knows the agent is alive.
	l.sendOnce()
	t := time.NewTicker(l.every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			l.sendOnce()
		}
	}
}

func (l *Loop) sendOnce() {
	snap := telemetry.Collect()
	p := payload{AgentVersion: l.version, Snapshot: snap}
	if err := l.tr.Do("POST", "/api/nexus-agent/heartbeat", p, nil); err != nil {
		log.Printf("[heartbeat] error: %v", err)
		return
	}
	log.Printf("[heartbeat] sent cpu=%.1f%% mem=%.1f%% disks=%d", snap.CPUPercent, snap.MemPercent, len(snap.Disks))
}
