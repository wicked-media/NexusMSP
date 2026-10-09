package nexusbackup

// SourcePlan is local-only capture preparation. Roots are never included in a
// heartbeat, preflight result, audit event, or browser response. A future
// signed capture lease must select the profile before this plan can be used.
type SourcePlan struct {
	Profile string
	Roots   []string
	State   string
	Reason  string
}

// PlanSources resolves a narrowly defined local source profile without
// touching the filesystem. It does not expand arbitrary technician paths.
func PlanSources(profile string) SourcePlan {
	return planSources(profile)
}
