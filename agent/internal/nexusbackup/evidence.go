// Package nexusbackup provides the safe, zero-side-effect capability report
// used by the first Nexus Backup agent release. It never opens a customer file,
// enumerates source paths, creates a snapshot, or sends backup bytes.
package nexusbackup

import (
	"time"

	"nexusagent/internal/config"
)

const CapabilityInventoryV1 = "nexus_backup_capability_v1"

// Evidence returns only the agent's control-plane posture. The server must not
// infer backup success, protected data, or recovery readiness from this record.
func Evidence(cfg *config.Config) map[string]any {
	policy := (*config.NexusBackupPolicy)(nil)
	if cfg != nil && cfg.PlatformPolicy != nil {
		policy = cfg.PlatformPolicy.NexusBackup
	}
	evidence := map[string]any{
		"schema_version":    1,
		"state":             "not_configured",
		"execution_enabled": false,
		"files_accessed":    false,
		"snapshot_created":  false,
		"upload_bytes":      0,
		"restore_requested": false,
		"capabilities":      []string{},
		"reason_codes":      []string{"native_backup_policy_not_available"},
		"observed_at":       time.Now().UTC().Format(time.RFC3339),
	}
	if cfg == nil || !cfg.NexusBackupCapabilityInventoryEnabled() {
		return evidence
	}
	evidence["state"] = "inventory_only"
	evidence["capabilities"] = []string{CapabilityInventoryV1}
	if cfg.NexusBackupPreflightEnabled() {
		evidence["capabilities"] = []string{CapabilityInventoryV1, "nexus_backup_preflight_v1"}
	}
	evidence["reason_codes"] = []string{}
	// The policy is deliberately checked again so a malformed or future policy
	// can never make this package report an execution-capable state.
	if policy == nil || policy.ExecutionAllowed || policy.FileAccessAllowed || policy.SnapshotAllowed || policy.UploadAllowed || policy.RestoreAllowed {
		evidence["state"] = "blocked"
		evidence["capabilities"] = []string{}
		evidence["reason_codes"] = []string{"unsafe_backup_policy_rejected"}
	}
	return evidence
}
