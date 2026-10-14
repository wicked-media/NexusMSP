// Package main is the NexusOps Agent entrypoint.
// Runs as a Windows service (or foreground for testing).
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"nexusagent/internal/appupdate"
	"nexusagent/internal/canary"
	"nexusagent/internal/commands"
	"nexusagent/internal/config"
	"nexusagent/internal/enroll"
	"nexusagent/internal/heartbeat"
	"nexusagent/internal/identity"
	"nexusagent/internal/localbroker"
	"nexusagent/internal/nexusbackup"
	"nexusagent/internal/nexusremote"
	"nexusagent/internal/selfheal"
	"nexusagent/internal/transport"
)

// Version is injected at build time via -ldflags.
var Version = "0.1.13-companion-health"

func main() {
	var (
		runFlag = flag.String("run", "", "run mode: foreground | install | uninstall | start | stop | status")
		cfgPath = flag.String("config", "", "path to config.json (default: <exedir>/config.json)")
		showVer = flag.Bool("version", false, "print version and exit")
	)
	flag.Parse()

	if *showVer {
		fmt.Printf("nexus-agent %s\n", Version)
		return
	}

	cfg, err := config.LoadOrInit(*cfgPath)
	if err != nil {
		log.Fatalf("[FATAL] config load: %v", err)
	}

	// install / uninstall / start / stop hooks are filled in by service.go (OS-specific).
	switch *runFlag {
	case "install":
		if err := svcInstall(cfg); err != nil {
			log.Fatalf("install: %v", err)
		}
		fmt.Println("NexusOps Agent installed.")
		return
	case "uninstall":
		if err := svcUninstall(); err != nil {
			log.Fatalf("uninstall: %v", err)
		}
		fmt.Println("NexusOps Agent uninstalled.")
		return
	case "start":
		if err := svcStart(); err != nil {
			log.Fatalf("start: %v", err)
		}
		fmt.Println("Started.")
		return
	case "stop":
		if err := svcStop(); err != nil {
			log.Fatalf("stop: %v", err)
		}
		fmt.Println("Stopped.")
		return
	case "status":
		s, err := svcStatus()
		if err != nil {
			log.Fatalf("status: %v", err)
		}
		fmt.Println(s)
		return
	case "foreground", "":
		if *runFlag == "" {
			handled, err := svcRunIfNeeded(cfg)
			if err != nil {
				log.Fatalf("service: %v", err)
			}
			if handled {
				return
			}
		}
		runAgent(cfg)
	default:
		log.Fatalf("unknown -run mode: %s", *runFlag)
	}
}

func runAgent(cfg *config.Config) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("shutting down...")
		cancel()
	}()
	runAgentContext(ctx, cfg)
}

func runAgentContext(ctx context.Context, cfg *config.Config) {
	log.Printf("NexusOps Agent %s starting...", Version)
	log.Printf("Server: %s | Client: %s", cfg.ServerURL, cfg.ClientName)

	tr := transport.New(cfg.ServerURL, Version)

	// Ensure enrollment — first boot only.
	if cfg.AgentToken == "" {
		log.Println("[enroll] no agent token; enrolling with server...")
		token, deviceID, err := enroll.Run(tr, cfg, Version)
		if err != nil {
			log.Fatalf("[enroll] failed: %v — agent will retry on next start", err)
		}
		cfg.AgentToken = token
		cfg.DeviceID = deviceID
		if err := config.Save(cfg); err != nil {
			log.Printf("[enroll] WARN: failed to persist config: %v", err)
		}
		log.Printf("[enroll] success — device_id=%s", deviceID)
	}

	tr.SetToken(cfg.AgentToken)
	if err := nexusremote.StartCompanionBridge(ctx, cfg, tr); err != nil {
		log.Printf("[native-remote] companion bridge unavailable: %v", err)
	}
	localBroker, err := localbroker.Start(cfg)
	if err != nil {
		log.Printf("[local-broker] WARN: user-session companion bridge is unavailable: %v", err)
	} else {
		defer func() { _ = localBroker.Shutdown(context.Background()) }()
		log.Printf("[local-broker] protected companion bridge listening at %s", localbroker.Address)
	}
	if _, _, err := identity.Ensure(cfg); err != nil {
		log.Printf("[identity] WARN: device identity initialisation failed: %v", err)
	} else if identity.NeedsRotation(cfg, 30*24*time.Hour) {
		if err := enroll.Renew(tr, cfg); err != nil {
			log.Printf("[identity] WARN: certificate renewal failed; token-compatible transport remains active: %v", err)
		}
	}
	if cfg.DeviceIdentity != nil && cfg.DeviceIdentity.CertificatePath != "" {
		if err := tr.SetClientIdentity(cfg.DeviceIdentity.CertificatePath, cfg.DeviceIdentity.PrivateKeyPath); err != nil {
			log.Printf("[identity] WARN: mTLS identity unavailable; token-compatible transport remains active: %v", err)
		} else {
			log.Printf("[identity] client certificate active for %s", cfg.DeviceIdentity.SPIFFEID)
		}
	}

	// Self-healing is wired before the loops start: the heartbeat feeds it every
	// control-plane result, and it reports its own evidence back through the same
	// heartbeat instead of opening a second network path.
	selfHeal := startSelfHeal(ctx, tr, cfg)

	// Application updates are observed by one monitor shared by the heartbeat, which
	// reports what is pending, and the command loop, which applies what an operator
	// asked for. A scan walks the winget sources, so the monitor answers the
	// heartbeat with its last result instead of making a check-in wait for winget.
	appUpdates := appupdate.NewMonitor()
	appUpdates.SetAutoPolicy(appupdate.AutoPolicy{
		Enabled: cfg.WingetAutoUpdateEnabled(),
		Allowed: cfg.WingetAllowedIDs(),
		Allows:  cfg.WingetAutoUpdateWindowAllows,
	})
	log.Printf("[appupdate] reporting pending application updates (auto_update=%t approved_packages=%d)",
		cfg.WingetAutoUpdateEnabled(), len(cfg.WingetAllowedIDs()))

	// Background loops
	hb := heartbeat.NewLoop(tr, cfg, Version, 60*time.Second)
	hb.SetSelfHeal(selfHeal)
	hb.SetAppUpdates(appUpdates.Evidence)
	cmd := commands.NewLoop(tr, cfg, 10*time.Second)
	cmd.SetAppUpdates(appUpdates)
	backupPreflight := nexusbackup.NewPreflightLoop(tr, cfg, 30*time.Second)
	canaryWatch := canary.NewLoop(tr, time.Duration(cfg.ShieldCanaryInterval())*time.Second)

	go hb.Run(ctx)
	go cmd.Run(ctx)
	go backupPreflight.Run(ctx)
	if cfg.ShieldCanaryEnabled() {
		go canaryWatch.Run(ctx)
		log.Printf("[shield] Nexus Canary integrity loop enabled (%ds interval)", cfg.ShieldCanaryInterval())
	} else {
		log.Printf("[shield] Nexus Canary is disabled by this deployment profile")
	}

	<-ctx.Done()
	time.Sleep(500 * time.Millisecond)
}

// startSelfHeal builds the agent's self-awareness loop. Every recovery action it
// can perform is a real, existing agent capability: a reachability probe, the
// local identity/config/policy repair the agent_repair command already performs,
// certificate renewal, transport fallback, re-enrollment, and an optional service
// restart. Nothing here can do anything an operator could not already ask for.
func startSelfHeal(ctx context.Context, tr *transport.Client, cfg *config.Config) *selfheal.Loop {
	store := selfheal.OpenStore(cfg.BaseDir())
	actions := selfheal.Actions{
		Probe: func() error {
			// Read-only and authenticated: it proves NexusMSP is reachable *and*
			// still accepts this endpoint, without consuming queued work.
			var response struct {
				OK bool `json:"ok"`
			}
			return tr.Do("GET", "/api/nexus-agent/ping", nil, &response)
		},
		RepairLocal: func(actions []string) (map[string]string, error) {
			evidence, err := identity.Repair(cfg, actions)
			return evidence.Details, err
		},
		RenewIdentity: func() error { return enroll.Renew(tr, cfg) },
		ResetTransport: func() error {
			// Falls back to token transport, which the server still authorises.
			tr.ResetClientIdentity()
			return nil
		},
		Reenroll: func() error {
			token, deviceID, err := enroll.Run(tr, cfg, Version)
			if err != nil {
				return err
			}
			cfg.AgentToken, cfg.DeviceID = token, deviceID
			tr.SetToken(token)
			return config.Save(cfg)
		},
		RestartService: svcRestart,
	}
	loop := selfheal.NewLoop(cfg, selfheal.NewWatchdog(store), store, nil, actions)
	extra := ""
	if cfg.SelfHealWindowsRepairEnabled() {
		extra = ", built-in Windows component repair enabled by policy"
	}
	log.Printf("[self-heal] enabled (state=%s%s)", store.Path(), extra)
	go loop.Run(ctx)
	return loop
}
