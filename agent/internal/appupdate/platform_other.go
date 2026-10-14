//go:build !windows

package appupdate

import (
	"context"
	"errors"
	"time"
)

// On a non-Windows endpoint the platform hooks report honestly that application
// updates are a Windows capability instead of fabricating a package list. A Linux
// or macOS agent pretending to watch for pending Windows applications would be
// noise, not protection.
func init() {
	platformAvailable = func() bool { return false }
	platformScan = func(context.Context) Evidence {
		return Evidence{Status: StatusUnsupported, Error: "application updates are a Windows capability"}
	}
	platformRunWinget = func(context.Context, time.Duration, ...string) (string, int, error) {
		return "", -1, errors.New("application updates are a Windows capability")
	}
}
