// Package heartbeat sends periodic telemetry snapshots to the server.
package heartbeat

import (
	"context"
	"log"
	"time"

	"nexusagent/internal/config"
	"nexusagent/internal/telemetry"
	"nexusagent/internal/transport"
	"nexusagent/internal/updater"
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

type heartbeatResponse struct {
	OK         bool          `json:"ok"`
	ServerTime string        `json:"server_time"`
	Update     *updater.Info `json:"update,omitempty"`
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
	var resp heartbeatResponse
	if err := l.tr.Do("POST", "/api/nexus-agent/heartbeat", p, &resp); err != nil {
		log.Printf("[heartbeat] error: %v", err)
		return
	}
	log.Printf("[heartbeat] sent cpu=%.1f%% mem=%.1f%% disks=%d", snap.CPUPercent, snap.MemPercent, len(snap.Disks))

	// Apply pending update if advertised.
	if resp.Update != nil && resp.Update.Version != "" && resp.Update.Version != l.version {
		log.Printf("[updater] server advertises new version %s (current %s) — applying", resp.Update.Version, l.version)
		if err := updater.Apply(*resp.Update, l.cfg.ServerURL, l.version, l.cfg.AgentToken); err != nil {
			log.Printf("[updater] apply failed: %v", err)
		}
	}
}
