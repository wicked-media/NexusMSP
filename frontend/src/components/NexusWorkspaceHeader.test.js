import { normaliseWorkspaceSignal } from "../lib/nexusWorkspaceHeader";

describe("Nexus workspace header signal presentation", () => {
  test.each([
    ["critical", "critical"],
    ["provider-error", "critical"],
    ["attention", "attention"],
    ["stale-evidence", "attention"],
    ["working", "working"],
    ["active-sync", "working"],
    ["healthy", "healthy"],
    ["live-voice", "healthy"],
    ["unrecognised", "neutral"],
    [null, "neutral"],
  ])("maps %p to %s", (signal, expected) => {
    expect(normaliseWorkspaceSignal(signal)).toBe(expected);
  });
});
