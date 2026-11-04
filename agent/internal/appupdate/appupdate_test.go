package appupdate

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

// pad builds a fixed-width column so the test input has the same geometry a real
// winget table has, without depending on hand-aligned spaces in the source. A
// value that fills its column exactly must not push the following columns right,
// because winget truncates to the column width and the parser reads those offsets.
func pad(value string, width int) string {
	if len(value) >= width {
		return value
	}
	return value + strings.Repeat(" ", width-len(value))
}

// Column widths are chosen so every value in the fixtures fits its column, which
// is what winget itself does: the widths are the widest content in the table.
const (
	nameWidth      = 30
	idWidth        = 34
	versionWidth   = 14
	availableWidth = 13
)

func header() string {
	return pad("Name", nameWidth) + pad("Id", idWidth) + pad("Version", versionWidth) + pad("Available", availableWidth) + "Source"
}

func row(name, id, current, available string) string {
	return pad(name, nameWidth) + pad(id, idWidth) + pad(current, versionWidth) + pad(available, availableWidth) + "winget"
}

func separator() string {
	return strings.Repeat("-", 100)
}

func TestParseUpgradeTableReadsRealWingetOutput(t *testing.T) {
	// A carriage-return progress spinner, a real table, its summary line, and a
	// second section with its own header — all of which winget actually prints.
	output := strings.Join([]string{
		"-\\  0%",
		header(),
		separator(),
		row("Microsoft Edge", "Microsoft.Edge", "120.0.2210.91", "121.0.2277.83"),
		row("7-Zip 23.01 (x64)", "7zip.7zip", "23.01", "24.09"),
		"",
		"2 upgrades available.",
		"",
		"The following packages have an upgrade available, but require explicit targeting:",
		header(),
		separator(),
		row("Microsoft Edge WebView2", "Microsoft.EdgeWebView2Runtime", "120.0.2210.91", "121.0.2277.83"),
	}, "\r\n")

	packages, ok := parseUpgradeTable(output)
	if !ok {
		t.Fatalf("expected the table to be readable")
	}
	if len(packages) != 3 {
		t.Fatalf("expected 3 packages, got %d: %+v", len(packages), packages)
	}
	if packages[0].ID != "Microsoft.Edge" || packages[0].Name != "Microsoft Edge" {
		t.Fatalf("unexpected first package: %+v", packages[0])
	}
	if packages[0].Current != "120.0.2210.91" || packages[0].Available != "121.0.2277.83" {
		t.Fatalf("unexpected versions: %+v", packages[0])
	}
	if packages[1].ID != "7zip.7zip" || packages[1].Name != "7-Zip 23.01 (x64)" {
		t.Fatalf("unexpected second package: %+v", packages[1])
	}
	if packages[2].ID != "Microsoft.EdgeWebView2Runtime" {
		t.Fatalf("expected the second section to be read separately, got %+v", packages[2])
	}
}

func TestParseUpgradeTableRejectsProseAndDuplicates(t *testing.T) {
	output := strings.Join([]string{
		header(),
		separator(),
		row("Microsoft Edge", "Microsoft.Edge", "120.0.2210.91", "121.0.2277.83"),
		// A duplicate id must not be reported twice.
		row("Microsoft Edge (duplicate)", "microsoft.edge", "120.0.2210.91", "121.0.2277.83"),
		// A row with no availability is not an upgrade.
		pad("Something", nameWidth) + pad("Vendor.Product", idWidth) + pad("1.0", versionWidth),
		"Some prose that is long enough to reach the identifier column but is not a package at all, honestly",
	}, "\n")

	packages, ok := parseUpgradeTable(output)
	if !ok {
		t.Fatalf("expected the table to be readable")
	}
	if len(packages) != 1 {
		t.Fatalf("expected exactly 1 package, got %d: %+v", len(packages), packages)
	}
	if packages[0].ID != "Microsoft.Edge" {
		t.Fatalf("unexpected package: %+v", packages[0])
	}
}

func TestParseUpgradeTableReportsAnUnreadableResult(t *testing.T) {
	for _, output := range []string{"", "\n\n", "winget: command not found", "No installed package found matching input criteria."} {
		if _, ok := parseUpgradeTable(output); ok {
			t.Fatalf("expected %q to be unreadable", output)
		}
	}
}

func TestCleanPackageIDRefusesAnythingButAnIdentifier(t *testing.T) {
	for _, valid := range []string{"Microsoft.Edge", "7zip.7zip", "Vendor-Product_1", "  Microsoft.Edge  "} {
		if cleanPackageID(valid) == "" {
			t.Fatalf("expected %q to be accepted", valid)
		}
	}
	for _, invalid := range []string{"", "   ", "Microsoft Edge", "--id", "Microsoft.Edge --force", "a;b", "$(whoami)", "a|b", "-leading", strings.Repeat("a", 201)} {
		if cleaned := cleanPackageID(invalid); cleaned != "" {
			t.Fatalf("expected %q to be refused, got %q", invalid, cleaned)
		}
	}
}

func TestUpgradeArgsIsAFixedNonInteractiveVector(t *testing.T) {
	all := UpgradeArgs("", true)
	joined := strings.Join(all, " ")
	if !strings.Contains(joined, "upgrade --all") {
		t.Fatalf("expected an --all upgrade, got %q", joined)
	}
	for _, required := range []string{"--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("expected %q in %q", required, joined)
		}
	}

	one := UpgradeArgs("Microsoft.Edge", false)
	if got := strings.Join(one, " "); !strings.Contains(got, "--id Microsoft.Edge --exact") {
		t.Fatalf("expected an exact package upgrade, got %q", got)
	}

	// A hostile identifier never reaches the argument vector, and the run still
	// carries the non-interactive flags so it cannot stop to ask a question.
	hostile := strings.Join(UpgradeArgs("Microsoft.Edge --force; shutdown /r", false), " ")
	if strings.Contains(hostile, "shutdown") || strings.Contains(hostile, "--force") {
		t.Fatalf("hostile identifier reached the argument vector: %q", hostile)
	}
	if !strings.Contains(hostile, "--disable-interactivity") {
		t.Fatalf("expected non-interactive flags, got %q", hostile)
	}
}

func TestAutomaticTargetsNeedsAnExplicitAllowList(t *testing.T) {
	pending := []Package{{ID: "Microsoft.Edge"}, {ID: "7zip.7zip"}, {ID: ""}}

	if got := AutomaticTargets(pending, nil, true); len(got) != 0 {
		t.Fatalf("an empty allow-list must never mean all, got %v", got)
	}
	if got := AutomaticTargets(pending, []string{"Microsoft.Edge"}, false); len(got) != 0 {
		t.Fatalf("auto update is off, so nothing may be targeted, got %v", got)
	}
	// The allow-list is matched case-insensitively, and a pending package the
	// deployment never approved stays untouched.
	got := AutomaticTargets(pending, []string{"microsoft.edge"}, true)
	if len(got) != 1 || got[0] != "Microsoft.Edge" {
		t.Fatalf("unexpected targets: %v", got)
	}
	if got := AutomaticTargets(pending, []string{"Microsoft.Edge --force"}, true); len(got) != 0 {
		t.Fatalf("an invalid allow-list entry must not match, got %v", got)
	}
}

func TestAutoApplyDueRespectsDayAndWindow(t *testing.T) {
	now := time.Date(2026, 5, 1, 23, 30, 0, 0, time.UTC)
	open := AutoPolicy{Enabled: true, Allowed: []string{"Microsoft.Edge"}}

	if !AutoApplyDue(now, time.Time{}, open) {
		t.Fatalf("an enabled policy with an allow-list and no history is due")
	}
	if AutoApplyDue(now, now.Add(-time.Hour), open) {
		t.Fatalf("one pass per day: a run earlier today is not due again")
	}
	if !AutoApplyDue(now.Add(2*time.Hour), now, open) {
		t.Fatalf("a new day is due again")
	}
	closed := AutoPolicy{Enabled: true, Allowed: []string{"Microsoft.Edge"}, Allows: func(time.Time) bool { return false }}
	if AutoApplyDue(now, time.Time{}, closed) {
		t.Fatalf("an enforced window that is closed must hold the pass back")
	}
	if AutoApplyDue(now, time.Time{}, AutoPolicy{Enabled: false, Allowed: []string{"Microsoft.Edge"}}) {
		t.Fatalf("a disabled policy is never due")
	}
	if AutoApplyDue(now, time.Time{}, AutoPolicy{Enabled: true}) {
		t.Fatalf("an empty allow-list is never due")
	}
}

func TestMonitorReportsPendingBeforeItsFirstScan(t *testing.T) {
	original := platformScan
	t.Cleanup(func() { platformScan = original })

	m := NewMonitor()
	if evidence := m.Evidence(); evidence.Status != StatusPending {
		t.Fatalf("expected pending before the first scan, got %q", evidence.Status)
	}
}

func TestMonitorAutoAppliesOncePerDay(t *testing.T) {
	originalScan, originalRun, originalAvailable := platformScan, platformRunWinget, platformAvailable
	t.Cleanup(func() {
		platformScan, platformRunWinget, platformAvailable = originalScan, originalRun, originalAvailable
	})

	platformAvailable = func() bool { return true }
	platformScan = func(context.Context) Evidence {
		return Evidence{Status: StatusOK, Packages: []Package{{ID: "Microsoft.Edge", Name: "Microsoft Edge"}}}
	}
	var runs []string
	platformRunWinget = func(_ context.Context, _ time.Duration, args ...string) (string, int, error) {
		runs = append(runs, strings.Join(args, " "))
		return "", 0, nil
	}

	clock := time.Date(2026, 5, 1, 3, 0, 0, 0, time.UTC)
	m := NewMonitor()
	m.SetClock(func() time.Time { return clock })
	m.SetAutoPolicy(AutoPolicy{Enabled: true, Allowed: []string{"microsoft.edge"}})

	m.Refresh(context.Background())
	if len(runs) != 1 {
		t.Fatalf("expected one automatic upgrade, got %d (%v)", len(runs), runs)
	}
	if !strings.Contains(runs[0], "--id Microsoft.Edge --exact") {
		t.Fatalf("unexpected automatic upgrade: %q", runs[0])
	}

	m.Refresh(context.Background())
	if len(runs) != 1 {
		t.Fatalf("expected no second automatic upgrade today, got %d", len(runs))
	}

	clock = clock.Add(24 * time.Hour)
	m.Refresh(context.Background())
	if len(runs) != 2 {
		t.Fatalf("expected a new pass the next day, got %d", len(runs))
	}
}

func TestMonitorReportsWhatAnApplyAttemptActuallyDid(t *testing.T) {
	originalScan, originalRun, originalAvailable := platformScan, platformRunWinget, platformAvailable
	t.Cleanup(func() {
		platformScan, platformRunWinget, platformAvailable = originalScan, originalRun, originalAvailable
	})

	scans := 0
	platformAvailable = func() bool { return true }
	platformScan = func(context.Context) Evidence {
		scans++
		return Evidence{Status: StatusOK, Packages: []Package{{ID: "Microsoft.Edge"}}}
	}
	platformRunWinget = func(_ context.Context, _ time.Duration, _ ...string) (string, int, error) {
		return "the package failed to install\r\n", 1, fmt.Errorf("exit status 1")
	}

	m := NewMonitor()
	result, evidence := m.Upgrade(context.Background(), []string{"Microsoft.Edge"}, false)
	if result.Outcome != OutcomeFailed {
		t.Fatalf("a failed winget run must not be reported as installed, got %q", result.Outcome)
	}
	if len(result.Results) != 1 || result.Results[0].Status != OutcomeFailed || result.Results[0].ExitCode != 1 {
		t.Fatalf("unexpected per-package result: %+v", result.Results)
	}
	if !strings.Contains(result.Results[0].Detail, "failed to install") {
		t.Fatalf("expected the winget output as evidence, got %q", result.Results[0].Detail)
	}
	// The reported evidence is re-scanned after an attempt, so it describes what
	// is left rather than what was attempted.
	if evidence.Status != StatusOK || scans < 1 {
		t.Fatalf("expected a re-scan after the attempt, got %q after %d scan(s)", evidence.Status, scans)
	}

	blocked, _ := m.Upgrade(context.Background(), []string{"Microsoft.Edge --force"}, false)
	if blocked.Outcome != OutcomeBlocked {
		t.Fatalf("an invalid identifier must be refused, got %q", blocked.Outcome)
	}
}
