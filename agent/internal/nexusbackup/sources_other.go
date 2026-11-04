//go:build !windows

package nexusbackup

func planSources(profile string) SourcePlan {
	return SourcePlan{Profile: profile, State: "blocked", Reason: "platform_not_released"}
}
