package commands

import (
	"strings"
	"testing"
)

func TestExecutePing(t *testing.T) {
	loop := &Loop{}
	command := cmdItem{ID: "cmd-1", Kind: "ping"}

	result := loop.execute(command)

	if result.Status != "ok" {
		t.Fatalf("expected ok status, got %q", result.Status)
	}
	if result.Stdout != "pong" {
		t.Fatalf("expected pong output, got %q", result.Stdout)
	}
}

func TestExecuteRejectsUnsupportedShell(t *testing.T) {
	loop := &Loop{}
	command := cmdItem{ID: "cmd-2", Kind: "run_script"}
	command.Payload.Shell = "zsh"
	command.Payload.Script = "echo should-not-run"

	result := loop.execute(command)

	if result.Status != "error" {
		t.Fatalf("expected error status, got %q", result.Status)
	}
	if !strings.Contains(result.Stderr, "unsupported shell") {
		t.Fatalf("expected unsupported-shell error, got %q", result.Stderr)
	}
}

func TestTruncateBoundsCommandOutput(t *testing.T) {
	result := truncate("abcdef", 3)
	if result != "abc\n...[truncated]" {
		t.Fatalf("unexpected truncated output: %q", result)
	}
}
