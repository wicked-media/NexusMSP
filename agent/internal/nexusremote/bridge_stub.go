//go:build !windows

package nexusremote

import (
	"context"
	"nexusagent/internal/config"
	"nexusagent/internal/transport"
)

func StartCompanionBridge(context.Context, *config.Config, *transport.Client) error { return nil }
