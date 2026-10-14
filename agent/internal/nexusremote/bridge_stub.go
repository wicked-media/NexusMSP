//go:build !windows

package nexusremote

import (
	"context"
	"nexusagent/internal/config"
	"nexusagent/internal/transport"
)

func StartCompanionBridge(context.Context, *config.Config, *transport.Client) error {
	reportCompanionHealth("unsupported_platform", "Nexus Remote Companion is currently supported on Windows endpoints only.")
	return nil
}
