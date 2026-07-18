//go:build !windows

package main

import "nexusagent/internal/config"

func svcRunIfNeeded(_ *config.Config) (bool, error) { return false, nil }
