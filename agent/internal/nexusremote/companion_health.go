package nexusremote

import (
	"sync"
	"time"

	"nexusagent/internal/config"
)

// Companion health is process-local evidence produced by the protected Agent
// bridge. It deliberately contains no session, user, grant, or desktop data.
// The heartbeat publishes this compact state so the control plane can tell an
// installed binary from a verified user-session companion that is available to
// present attended consent.
var companionHealth = struct {
	sync.RWMutex
	status     string
	detail     string
	observedAt time.Time
}{status: "starting"}

func reportCompanionHealth(status, detail string) {
	companionHealth.Lock()
	defer companionHealth.Unlock()
	companionHealth.status = status
	companionHealth.detail = detail
	companionHealth.observedAt = time.Now().UTC()
}

// CompanionHealthEvidence is safe to include in the authenticated agent
// heartbeat. A pinned binary is not considered operationally ready until its
// user-session process has passed the protected named-pipe image validation.
func CompanionHealthEvidence(cfg *config.Config) map[string]any {
	if cfg == nil || !cfg.NativeRemoteCompanionReady() {
		return map[string]any{"status": "integrity_unverified", "detail": "The policy-pinned Remote Companion is unavailable or does not match its expected digest."}
	}
	companionHealth.RLock()
	defer companionHealth.RUnlock()
	status := companionHealth.status
	if status == "" {
		status = "waiting_for_user_session"
	}
	evidence := map[string]any{"status": status}
	if companionHealth.detail != "" {
		evidence["detail"] = companionHealth.detail
	}
	if !companionHealth.observedAt.IsZero() {
		evidence["observed_at"] = companionHealth.observedAt.Format(time.RFC3339)
	}
	return evidence
}
