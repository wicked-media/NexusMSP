// Package heartbeat sends periodic telemetry and trust evidence to NexusMSP.
package heartbeat

import (
	"context"
	"log"
	"reflect"
	"time"

	"nexusagent/internal/appupdate"
	"nexusagent/internal/config"
	"nexusagent/internal/enroll"
	"nexusagent/internal/identity"
	"nexusagent/internal/nexusbackup"
	"nexusagent/internal/nexusremote"
	"nexusagent/internal/selfheal"
	"nexusagent/internal/telemetry"
	"nexusagent/internal/transport"
	"nexusagent/internal/updater"
)

type Loop struct {
	tr         *transport.Client
	cfg        *config.Config
	version    string
	every      time.Duration
	selfHeal   *selfheal.Loop
	appUpdates func() *appupdate.Evidence
}

// SetSelfHeal connects the agent's self-awareness loop. Every heartbeat result is
// fed into its watchdog, and its evidence is reported with the next check-in, so
// NexusMSP learns an endpoint was offline from the endpoint itself rather than
// waiting for it to disappear from the fleet view.
func (l *Loop) SetSelfHeal(selfHeal *selfheal.Loop) { l.selfHeal = selfHeal }

// SetAppUpdates connects the application-update monitor. Its evidence rides the
// same heartbeat, so an operator sees which applications an endpoint has waiting
// without a second network path or a poll of every device.
func (l *Loop) SetAppUpdates(provider func() *appupdate.Evidence) { l.appUpdates = provider }

func NewLoop(tr *transport.Client, cfg *config.Config, version string, fallback time.Duration) *Loop {
	every := time.Duration(cfg.HeartbeatSecs) * time.Second
	if every <= 0 {
		every = fallback
	}
	return &Loop{tr: tr, cfg: cfg, version: version, every: every}
}

type payload struct {
	AgentVersion        string                 `json:"agent_version"`
	Snapshot            telemetry.Snapshot     `json:"snapshot"`
	Capabilities        []string               `json:"capabilities,omitempty"`
	RuntimeCapabilities []string               `json:"runtime_capabilities,omitempty"`
	NexusDNS            *config.NexusDNSConfig `json:"nexus_dns,omitempty"`
	Identity            map[string]any         `json:"identity,omitempty"`
	Policy              map[string]any         `json:"policy_evidence,omitempty"`
	SelfRepair          identity.Evidence      `json:"self_repair"`
	SelfHeal            *selfheal.Evidence     `json:"self_heal,omitempty"`
	AppUpdates          *appupdate.Evidence    `json:"app_updates,omitempty"`
	Update              *config.UpdateEvidence `json:"update_evidence,omitempty"`
	NativeRemote        map[string]any         `json:"native_remote_evidence,omitempty"`
	Backup              map[string]any         `json:"backup_evidence,omitempty"`
}

type heartbeatResponse struct {
	OK         bool                   `json:"ok"`
	ServerTime string                 `json:"server_time"`
	Update     *updater.Info          `json:"update,omitempty"`
	NexusDNS   *config.NexusDNSConfig `json:"nexus_dns,omitempty"`
	Policy     *config.PlatformPolicy `json:"policy,omitempty"`
	Identity   struct {
		Status                      string `json:"status"`
		CertificateRotationRequired bool   `json:"certificate_rotation_required"`
		CertificateExpiresAt        string `json:"certificate_expires_at"`
		SPIFFEID                    string `json:"spiffe_id"`
	} `json:"identity"`
}

func (l *Loop) Run(ctx context.Context) {
	l.sendOnce()
	ticker := time.NewTicker(l.every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.sendOnce()
		}
	}
}

func (l *Loop) sendOnce() {
	snapshot := telemetry.Collect()
	repairEvidence := identity.SelfRepairEvidence(l.cfg)
	if repairEvidence.Status != "healthy" && selfRepairEnabled(l.cfg) {
		if repaired, err := identity.Repair(l.cfg, []string{"identity", "policy", "config"}); err != nil {
			log.Printf("[self-repair] local repair failed: %v", err)
		} else {
			repairEvidence = repaired
			log.Printf("[self-repair] completed actions=%v status=%s", repaired.Repairs, repaired.Status)
		}
	}
	request := payload{
		AgentVersion:        l.version,
		Snapshot:            snapshot,
		Capabilities:        l.cfg.ShieldCapabilities(),
		RuntimeCapabilities: l.cfg.RuntimeCapabilities(),
		NexusDNS:            l.cfg.NexusDNS,
		Identity:            identity.Report(l.cfg),
		Policy:              identity.PolicyEvidence(l.cfg),
		SelfRepair:          repairEvidence,
		SelfHeal:            l.selfHealEvidence(),
		AppUpdates:          l.appUpdatesEvidence(),
		Update:              l.cfg.UpdateEvidence,
		NativeRemote:        nexusremote.CompanionHealthEvidence(l.cfg),
		Backup:              nexusbackup.Evidence(l.cfg),
	}
	var response heartbeatResponse
	if err := l.tr.Do("POST", "/api/nexus-agent/heartbeat", request, &response); err != nil {
		log.Printf("[heartbeat] error: %v", err)
		if l.selfHeal != nil {
			l.selfHeal.ObserveControlPlane(err)
			status := l.selfHeal.Status()
			log.Printf("[self-heal] control plane %s (%d consecutive failures)", status.State, status.ConsecutiveFailures)
		}
		return
	}
	if l.selfHeal != nil {
		l.selfHeal.ObserveControlPlane(nil)
	}
	log.Printf("[heartbeat] sent cpu=%.1f%% mem=%.1f%% disks=%d", snapshot.CPUPercent, snapshot.MemPercent, len(snapshot.Disks))

	if response.NexusDNS != nil && !reflect.DeepEqual(l.cfg.NexusDNS, response.NexusDNS) {
		l.cfg.NexusDNS = response.NexusDNS
		if err := config.Save(l.cfg); err != nil {
			log.Printf("[nexus-dns] persist profile failed: %v", err)
		} else {
			log.Printf("[nexus-dns] profile saved mode=%s enrolled=%t enforcement_ready=%t", response.NexusDNS.Mode, response.NexusDNS.Enrolled, response.NexusDNS.EnforcementReady)
		}
	}

	if response.Policy != nil && !reflect.DeepEqual(l.cfg.PlatformPolicy, response.Policy) {
		l.cfg.ApplyPlatformPolicy(response.Policy)
		if err := config.Save(l.cfg); err != nil {
			log.Printf("[policy] persist cache failed: %v", err)
		} else {
			log.Printf("[policy] applied version=%s checksum=%s", response.Policy.Version, response.Policy.ChecksumSHA256)
		}
	}

	if response.Identity.CertificateRotationRequired {
		log.Printf("[identity] certificate renewal requested; current expiry=%s", response.Identity.CertificateExpiresAt)
		if err := enroll.Renew(l.tr, l.cfg); err != nil {
			log.Printf("[identity] renewal failed: %v", err)
		} else if l.cfg.DeviceIdentity != nil {
			if err := l.tr.SetClientIdentity(l.cfg.DeviceIdentity.CertificatePath, l.cfg.DeviceIdentity.PrivateKeyPath); err != nil {
				log.Printf("[identity] renewed certificate could not be activated: %v", err)
			} else {
				log.Printf("[identity] certificate renewed for %s", l.cfg.DeviceIdentity.SPIFFEID)
			}
		}
	}

	if response.Update != nil && response.Update.Version != "" && response.Update.Version != l.version {
		if shouldApply, reason := updater.ShouldApplyVersion(l.version, response.Update.Version); !shouldApply {
			log.Printf("[updater] ignored target %s from current %s: %s", response.Update.Version, l.version, reason)
			return
		}
		log.Printf("[updater] server advertises new version %s (current %s) - applying", response.Update.Version, l.version)
		l.cfg.UpdateEvidence = &config.UpdateEvidence{
			Version:   response.Update.Version,
			SHA256:    response.Update.SHA256,
			Status:    "verification_failed",
			CheckedAt: time.Now().UTC().Format(time.RFC3339),
		}
		pinnedUpdateKey := policyString(l.cfg, "signing_public_key")
		if err := updater.VerifyManifestWithKey(*response.Update, pinnedUpdateKey); err != nil {
			log.Printf("[updater] signed manifest rejected: %v", err)
			_ = config.Save(l.cfg)
			return
		}
		l.cfg.UpdateEvidence.SignatureVerified = true
		l.cfg.UpdateEvidence.Status = "verified"
		_ = config.Save(l.cfg)
		if err := updater.Apply(*response.Update, l.cfg.ServerURL, l.version, l.cfg.AgentToken, pinnedUpdateKey); err != nil {
			log.Printf("[updater] apply failed: %v", err)
		}
	}
}

// selfHealEvidence is nil until main connects the loop, which keeps the heartbeat
// usable in isolation (tests, one-shot tooling) without a self-heal loop running.
func (l *Loop) selfHealEvidence() *selfheal.Evidence {
	if l.selfHeal == nil {
		return nil
	}
	return l.selfHeal.Evidence()
}

// appUpdatesEvidence is nil until main connects the monitor, which keeps the
// heartbeat usable in isolation without an application scan running behind it.
func (l *Loop) appUpdatesEvidence() *appupdate.Evidence {
	if l.appUpdates == nil {
		return nil
	}
	return l.appUpdates()
}

func policyString(cfg *config.Config, key string) string {
	if cfg == nil || cfg.PlatformPolicy == nil || cfg.PlatformPolicy.Updates == nil {
		return ""
	}
	value, _ := cfg.PlatformPolicy.Updates[key].(string)
	return value
}

func selfRepairEnabled(cfg *config.Config) bool {
	if cfg.PlatformPolicy == nil || cfg.PlatformPolicy.SelfRepair == nil {
		return true
	}
	value, ok := cfg.PlatformPolicy.SelfRepair["enabled"].(bool)
	return !ok || value
}
