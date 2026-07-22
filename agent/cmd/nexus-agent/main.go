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

	"nexusagent/internal/canary"
	"nexusagent/internal/commands"
	"nexusagent/internal/config"
	"nexusagent/internal/enroll"
	"nexusagent/internal/heartbeat"
	"nexusagent/internal/transport"
)

// Version is injected at build time via -ldflags.
var Version = "0.1.5-nexus-shield"

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
		token, deviceID, err := enroll.Run(tr, cfg)
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

	// Background loops
	hb := heartbeat.NewLoop(tr, cfg, Version, 60*time.Second)
	cmd := commands.NewLoop(tr, cfg, 10*time.Second)
	canaryWatch := canary.NewLoop(tr, time.Duration(cfg.ShieldCanaryInterval())*time.Second)

	go hb.Run(ctx)
	go cmd.Run(ctx)
	if cfg.ShieldCanaryEnabled() {
		go canaryWatch.Run(ctx)
		log.Printf("[shield] Nexus Canary integrity loop enabled (%ds interval)", cfg.ShieldCanaryInterval())
	} else {
		log.Printf("[shield] Nexus Canary is disabled by this deployment profile")
	}

	<-ctx.Done()
	time.Sleep(500 * time.Millisecond)
}
