//go:build !windows

package config

// Non-Windows builds use their platform deployment permissions. The Windows
// installer is the only current user-session companion deployment path.
func securePersistedConfig(string) error { return nil }
