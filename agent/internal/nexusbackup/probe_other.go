//go:build !windows

package nexusbackup

import "context"

// Probe intentionally returns unsupported away from Windows. It does not
// attempt a cross-platform capture implementation before that data plane has
// been designed and reviewed.
func Probe(_ context.Context) map[string]any {
	return map[string]any{
		"platform":              "unsupported",
		"vss_state":             "unsupported",
		"volume_capacity_state": "unknown",
	}
}
