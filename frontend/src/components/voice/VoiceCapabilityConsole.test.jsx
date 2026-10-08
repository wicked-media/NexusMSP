/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { signalIndex } from "@/lib/workspaceLearning";
import VoiceCapabilityConsole from "./VoiceCapabilityConsole";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every aliased
// import the console makes is registered here. The ranking rules themselves are
// the real module: this test is about how the console applies them.
jest.mock("@/lib/workspaceLearning", () => jest.requireActual("../../lib/workspaceLearning"), { virtual: true });
jest.mock("@/lib/voiceCapability", () => jest.requireActual("../../lib/voiceCapability"), { virtual: true });
jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// Every ui primitive is a thin element that keeps the props it is handed, so the
// console's own markup and test ids are what the assertions read. `require` runs
// lazily inside the element so the mock factories stay self-contained.
// Radix-owned callbacks are not DOM events, so they are dropped rather than
// forwarded to the element this stub renders.
const MOCK_NON_DOM_PROPS = new Set([
  "onValueChange", "onOpenChange", "onCheckedChange", "onSelect",
  "onOpenAutoFocus", "onCloseAutoFocus",
]);

// Declared as a hoisted function so the mock factories, which jest lifts above
// the imports, can still build their elements.
function mockElement(tag) {
  return ({ children, ...props }) => {
    const domProps = Object.fromEntries(
      Object.entries(props).filter(([key]) => !MOCK_NON_DOM_PROPS.has(key)),
    );
    return require("react").createElement(tag, domProps, children);
  };
}

jest.mock("@/components/ui/card", () => ({
  Card: mockElement("div"),
  CardContent: mockElement("div"),
  CardDescription: mockElement("p"),
  CardHeader: mockElement("div"),
  CardTitle: mockElement("h3"),
}), { virtual: true });
jest.mock("@/components/ui/badge", () => ({ Badge: mockElement("span") }), { virtual: true });
jest.mock("@/components/ui/button", () => ({ Button: mockElement("button") }), { virtual: true });
jest.mock("@/components/ui/input", () => ({ Input: mockElement("input") }), { virtual: true });
jest.mock("@/components/ui/label", () => ({ Label: mockElement("span") }), { virtual: true });
jest.mock("@/components/ui/select", () => ({
  Select: mockElement("div"),
  SelectContent: mockElement("div"),
  SelectItem: mockElement("div"),
  SelectTrigger: mockElement("div"),
  SelectValue: mockElement("div"),
}), { virtual: true });
jest.mock("@/components/ui/table", () => ({
  Table: mockElement("table"),
  TableBody: mockElement("tbody"),
  TableCell: mockElement("td"),
  TableHead: mockElement("th"),
  TableHeader: mockElement("thead"),
  TableRow: mockElement("tr"),
}), { virtual: true });
jest.mock("@/components/ui/dialog", () => ({ Dialog: mockElement("div") }), { virtual: true });
jest.mock("@/components/NexusWorkflowDialog", () => ({ __esModule: true, default: mockElement("div") }), { virtual: true });

const read = (id, summary) => ({
  id, summary, method: "GET", access: "read", destructive: false, proxied: false, params: [],
});
const write = (id, summary, { destructive = false, proxied = false } = {}) => ({
  id, summary, method: "POST", access: "write", destructive, proxied, params: ["id"],
});

// A deliberately small catalogue whose first family alphabetically is not the
// family the console opens on — exactly the case a declared-first rule gets wrong.
const CATALOGUE = {
  operation_count: 4,
  write_count: 1,
  categories: [
    { category: "Call Reports", operations: [read("cdr.list", "Recent calls.")] },
    {
      category: "Extension",
      operations: [
        read("extension.list", "Every extension with presence and registration."),
        read("extension.get", "One extension's full configuration."),
        write("extension.delete", "Delete an extension and its configuration.", { destructive: true }),
        write("extension.welcome_email", "Send a welcome mail.", { proxied: true }),
      ],
    },
  ],
};

const viewEvidence = (target, count) => signalIndex([
  { surface: "view", target, count, last_used_at: "2026-05-01T00:00:00+00:00" },
]);

const flush = async () => {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
};

describe("VoiceCapabilityConsole", () => {
  let host;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    axios.get.mockReset();
    axios.post.mockReset();
    // The catalogue is the only GET on mount; other GETs are interface runs.
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/yeastar/catalogue")) return Promise.resolve({ data: CATALOGUE });
      return Promise.resolve({ data: { data: [] } });
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  const render = async (props = {}) => {
    await act(async () => root.render(
      <VoiceCapabilityConsole
        api="/api"
        headers={{}}
        pbxs={[{ id: "pbx_1", name: "HQ", client_name: "Northwind" }]}
        pbxId="pbx_1"
        onPbxChange={jest.fn()}
        {...props}
      />,
    ));
    await flush();
  };

  const activeFamily = () => [...host.querySelectorAll("[data-testid^='voice-capability-family-']")]
    .find((node) => node.className.includes("bg-sky-500/10"));
  const interfaces = () => [...host.querySelectorAll("[data-testid^='voice-capability-operation-']")]
    .map((node) => node.getAttribute("data-testid").replace("voice-capability-operation-", ""));
  // The open interface is the row the console marked selected.
  const openInterface = () => host.querySelector("[class*='border-sky-500/40']")?.getAttribute("data-testid");
  const learningChip = () => host.querySelector('[data-testid="voice-capability-learning"]');

  const click = (testId) => act(async () => {
    host.querySelector(`[data-testid="${testId}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  test("cold start opens on the read-only Extension roster and claims nothing", async () => {
    await render();

    expect(activeFamily().textContent).toContain("Extension");
    expect(interfaces()).toEqual([
      "extension.list", "extension.get", "extension.delete", "extension.welcome_email",
    ]);
    expect(openInterface()).toBe("voice-capability-operation-extension.list");
    expect(learningChip()).toBeNull();
    expect(host.querySelector('[data-testid="voice-capability-family-call-reports"]')).not.toBeNull();
  });

  test("a family the technician really works in is the family the console opens on", async () => {
    await render({ personal: viewEvidence("family_call_reports", 7) });

    expect(activeFamily().textContent).toContain("Call Reports");
    expect(interfaces()).toEqual(["cdr.list"]);

    const chip = learningChip();
    expect(chip.textContent).toContain("Adapted to your use");
    expect(chip.getAttribute("data-learning-tone")).toBe("personal");
    expect(chip.getAttribute("title")).toContain("Nothing here changes what you can access");
  });

  test("the interface a technician runs most is preselected, ahead of the safe default", async () => {
    await render({ personal: viewEvidence("extension_get", 6) });

    expect(activeFamily().textContent).toContain("Extension");
    expect(openInterface()).toBe("voice-capability-operation-extension.get");
    // The rest of the family keeps its declared order behind the used one.
    expect(interfaces()).toEqual([
      "extension.get", "extension.list", "extension.delete", "extension.welcome_email",
    ]);
  });

  test("a destructive interface is never preselected, however often it is used", async () => {
    await render({ personal: viewEvidence("extension_delete", 9) });

    expect(openInterface()).toBe("voice-capability-operation-extension.list");
  });

  test("an artifact-route interface is never preselected either", async () => {
    await render({ personal: viewEvidence("extension_welcome_email", 9) });

    expect(openInterface()).toBe("voice-capability-operation-extension.list");
  });

  test("a stray click or two does not move the console and is not reported as a change", async () => {
    await render({ personal: viewEvidence("extension_get", 2) });

    expect(activeFamily().textContent).toContain("Extension");
    expect(openInterface()).toBe("voice-capability-operation-extension.list");
    expect(learningChip()).toBeNull();
  });

  test("opening a family and an interface records the slug Nexus stores", async () => {
    const onRecordAction = jest.fn();
    await render({ onRecordAction });

    await click("voice-capability-family-call-reports");
    expect(onRecordAction).toHaveBeenCalledWith("view", "family_call_reports");

    await click("voice-capability-operation-cdr.list");
    expect(onRecordAction).toHaveBeenCalledWith("view", "cdr_list");
  });

  test("running an interface records the action, and a failed run records nothing", async () => {
    const onRecordAction = jest.fn();
    await render({ onRecordAction, personal: viewEvidence("extension_get", 6) });

    await click("voice-capability-run");
    expect(onRecordAction).toHaveBeenCalledWith("action", "extension_get");

    onRecordAction.mockClear();
    axios.get.mockRejectedValue({ response: { data: { detail: "PBX unreachable" } } });
    await click("voice-capability-run");
    expect(onRecordAction).not.toHaveBeenCalled();
  });
});
