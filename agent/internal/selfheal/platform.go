package selfheal

import "context"

// Probe samples this endpoint's performance signals. Only the Windows
// implementation reports anything: the inbuilt repair it feeds is a Windows
// capability, and a Linux or macOS agent pretending to watch for it would be
// noise, not protection.
type Probe interface {
	Sample(ctx context.Context) Sample
}

// Repairer runs the platform's inbuilt component repair.
type Repairer interface {
	Repair(ctx context.Context, trigger []string) RepairRecord
	Elevated() bool
}

// Platform is the OS-specific half of the self-heal loop. Logic that decides
// *when* to act lives in platform-neutral files and is unit tested everywhere;
// only the calls into the operating system live behind these build tags.
type Platform interface {
	Probe
	Repairer
}
