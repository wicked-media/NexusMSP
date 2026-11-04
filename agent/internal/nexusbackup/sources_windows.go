//go:build windows

package nexusbackup

import (
	"os"
	"path/filepath"
)

func planSources(profile string) SourcePlan {
	home := os.Getenv("USERPROFILE")
	if home == "" {
		return SourcePlan{Profile: profile, State: "blocked", Reason: "user_profile_unavailable"}
	}
	switch profile {
	case "user_data":
		return SourcePlan{Profile: profile, State: "planned", Roots: []string{
			filepath.Join(home, "Desktop"), filepath.Join(home, "Documents"), filepath.Join(home, "Pictures"),
		}}
	case "business_data":
		return SourcePlan{Profile: profile, State: "planned", Roots: []string{filepath.Join(home, "Documents")}}
	case "full_device", "application_aware":
		return SourcePlan{Profile: profile, State: "blocked", Reason: "profile_requires_separate_capture_engine"}
	default:
		return SourcePlan{Profile: profile, State: "blocked", Reason: "unsupported_source_profile"}
	}
}
