package nexusbackup

import (
	"runtime"
	"testing"

	"nexusagent/internal/config"
)

func TestEvidenceNeverReportsExecution(t *testing.T) {
	evidence := Evidence(&config.Config{PlatformPolicy: &config.PlatformPolicy{NexusBackup: &config.NexusBackupPolicy{
		SchemaVersion:    1,
		Enabled:          true,
		Mode:             "capability_inventory",
		PreflightAllowed: true,
	}}})
	if evidence["execution_enabled"] != false || evidence["files_accessed"] != false || evidence["snapshot_created"] != false || evidence["upload_bytes"] != 0 || evidence["restore_requested"] != false {
		t.Fatalf("backup capability report must not claim side effects: %#v", evidence)
	}
	if runtime.GOOS == "windows" && evidence["state"] != "inventory_only" {
		t.Fatalf("expected Windows inventory-only state, got %#v", evidence)
	}
	if runtime.GOOS == "windows" {
		capabilities, _ := evidence["capabilities"].([]string)
		found := false
		for _, capability := range capabilities {
			found = found || capability == "nexus_backup_preflight_v1"
		}
		if !found {
			t.Fatalf("safe preflight capability missing: %#v", evidence)
		}
	}
}

func TestEvidenceRejectsUnsafePolicy(t *testing.T) {
	evidence := Evidence(&config.Config{PlatformPolicy: &config.PlatformPolicy{NexusBackup: &config.NexusBackupPolicy{
		SchemaVersion: 1,
		Enabled:       true,
		Mode:          "capability_inventory",
		UploadAllowed: true,
	}}})
	if evidence["state"] == "inventory_only" {
		t.Fatalf("unsafe policy must not be inventory-ready: %#v", evidence)
	}
}
