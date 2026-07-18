import {
  batchIsComplete,
  canExecuteAgentCommands,
  updateFilteredSelection,
} from "../lib/nexusAgentHelpers";

describe("Nexus Agent safety helpers", () => {
  test("requires admin or explicit agent-command permission", () => {
    expect(canExecuteAgentCommands({ role: "admin" })).toBe(true);
    expect(canExecuteAgentCommands({ permissions: { agent_commands: { execute: true } } })).toBe(true);
    expect(canExecuteAgentCommands({ role: "dispatcher", permissions: { devices: { edit: true } } })).toBe(false);
  });

  test("select-all only changes the currently filtered devices", () => {
    const selected = new Set(["hidden-device"]);
    const withVisible = updateFilteredSelection(selected, ["visible-a", "visible-b"]);
    expect([...withVisible].sort()).toEqual(["hidden-device", "visible-a", "visible-b"]);

    const withoutVisible = updateFilteredSelection(withVisible, ["visible-a", "visible-b"]);
    expect([...withoutVisible]).toEqual(["hidden-device"]);
  });

  test("batch completion requires at least one fully terminal command", () => {
    expect(batchIsComplete([])).toBe(false);
    expect(batchIsComplete([{ status: "ok" }, { status: "cancelled" }])).toBe(true);
    expect(batchIsComplete([{ status: "ok" }, { status: "pending" }])).toBe(false);
  });
});
