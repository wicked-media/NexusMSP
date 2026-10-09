package nexusbackup

import (
	"runtime"
	"testing"
)

func TestPlanSourcesFailsClosedForBroadProfiles(t *testing.T) {
	for _, profile := range []string{"full_device", "application_aware", "unknown"} {
		if plan := PlanSources(profile); plan.State != "blocked" {
			t.Fatalf("%s source plan must fail closed: %#v", profile, plan)
		}
	}
}

func TestPlanSourcesNeverExposesRootsOffWindows(t *testing.T) {
	plan := PlanSources("user_data")
	if runtime.GOOS != "windows" && len(plan.Roots) != 0 {
		t.Fatalf("non-Windows source plan must be blocked: %#v", plan)
	}
}
