package main

import "testing"

func TestRoleEvidenceIsNarrowAndDoesNotOverstateHealth(t *testing.T) {
	pulse := map[string]any{"control_plane_dns": "healthy", "control_plane_transport": "healthy"}
	if got := roleEvidence("network_monitor", pulse, nil); got != "observed_control_plane" {
		t.Fatalf("network monitor evidence = %q", got)
	}
	if got := roleEvidence("discovery_probe", pulse, nil); got != "declared" {
		t.Fatalf("unprobed role evidence = %q", got)
	}
}

func TestJumpRoleEvidenceRequiresTransportObservation(t *testing.T) {
	if got := roleEvidence("jump_gateway", nil, map[string]string{"wireguard": "configured_no_session"}); got != "transport_configured_no_session" {
		t.Fatalf("configured transport evidence = %q", got)
	}
	if got := roleEvidence("jump_gateway", nil, map[string]string{"wireguard": "ready"}); got != "transport_handshake_observed" {
		t.Fatalf("ready transport evidence = %q", got)
	}
}
