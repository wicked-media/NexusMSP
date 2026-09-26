package nexusremote

import (
	"testing"

	"nexusagent/internal/config"
)

func TestCompanionHealthDoesNotClaimReadinessWithoutPinnedBinary(t *testing.T) {
	reportCompanionHealth("ready", "test")
	evidence := CompanionHealthEvidence(&config.Config{})
	if evidence["status"] != "integrity_unverified" {
		t.Fatalf("status = %v, want integrity_unverified", evidence["status"])
	}
}
