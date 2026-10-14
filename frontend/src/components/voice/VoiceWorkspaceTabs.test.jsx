/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { signalIndex } from "@/lib/workspaceLearning";
import VoiceWorkspaceTabs, { VOICE_TABS } from "./VoiceWorkspaceTabs";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every aliased
// import the bar makes is registered here. The ranking rules themselves are the
// real module: this test is about how the voice workspace applies them.
jest.mock("@/lib/workspaceLearning", () => jest.requireActual("../../lib/workspaceLearning"), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant: _variant, ...props }) => <span {...props}>{children}</span>,
}), { virtual: true });
jest.mock("@/components/ui/tabs", () => ({
  TabsList: ({ children, ...props }) => <div {...props}>{children}</div>,
  TabsTrigger: ({ children, value, ...props }) => <button data-value={value} {...props}>{children}</button>,
}), { virtual: true });

const COUNTS = { pbxs: 3, extensions: 12 };

const viewEvidence = (target, count) => signalIndex([
  { surface: "view", target, count, last_used_at: "2026-05-01T00:00:00+00:00" },
]);

describe("VoiceWorkspaceTabs", () => {
  let host;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  const render = (props = {}) => act(async () => root.render(
    <VoiceWorkspaceTabs counts={COUNTS} {...props} />,
  ));

  const visibleTabs = () => [...host.querySelectorAll("[data-value]")].map((node) => node.getAttribute("data-value"));

  test("cold start is the declared bar, with the counts the workspace always showed", async () => {
    await render();

    expect(visibleTabs()).toEqual(VOICE_TABS);
    expect(host.textContent).toContain("PBXs (3)");
    expect(host.textContent).toContain("Extensions (12)");
    expect(host.textContent).toContain("PBX operations");
    expect(host.querySelector('[data-testid="voice-tabs-learning"]')).toBeNull();
  });

  test("the view a technician lives in leads the bar, and the bar says why", async () => {
    await render({ personal: viewEvidence("diagnostics", 8), team: viewEvidence("billing", 40) });

    expect(visibleTabs()[0]).toBe("diagnostics");
    expect(visibleTabs()[1]).toBe("billing");
    const chip = host.querySelector('[data-testid="voice-tabs-learning"]');
    expect(chip.textContent).toContain("Adapted to your use");
    expect(chip.getAttribute("data-learning-tone")).toBe("personal");
    expect(chip.getAttribute("title")).toContain("Nothing here changes what you can access");
  });

  test("a view nobody uses stays a tab, just later", async () => {
    await render({ team: viewEvidence("billing", 40) });

    expect(visibleTabs()).toHaveLength(VOICE_TABS.length);
    expect([...visibleTabs()].sort()).toEqual([...VOICE_TABS].sort());
  });

  test("opening a view records it as a view", async () => {
    const onRecordAction = jest.fn();
    await render({ onRecordAction });

    const monitoring = host.querySelector('[data-value="monitoring"]');
    await act(async () => {
      monitoring.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRecordAction).toHaveBeenCalledWith("view", "monitoring");
  });
});
