/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { signalIndex } from "@/lib/workspaceLearning";
import DeviceWorkspaceTabs from "./DeviceWorkspaceTabs";

jest.mock("@/lib/workspaceLearning", () => jest.requireActual("../../lib/workspaceLearning"), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant: _variant, ...props }) => <span {...props}>{children}</span>,
}), { virtual: true });
jest.mock("@/components/ui/tabs", () => ({
  TabsList: ({ children, ...props }) => <div {...props}>{children}</div>,
  TabsTrigger: ({ children, value, ...props }) => <button data-value={value} {...props}>{children}</button>,
}), { virtual: true });

const DECLARED = ["pulse", "directory", "insights", "map"];

const viewEvidence = (target, count) => signalIndex([
  { surface: "view", target, count, last_used_at: "2026-05-01T00:00:00+00:00" },
]);

describe("DeviceWorkspaceTabs", () => {
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

  const render = (props = {}) => act(async () => root.render(<DeviceWorkspaceTabs {...props} />));

  const visibleTabs = () => [...host.querySelectorAll("[data-value]")].map((node) => node.getAttribute("data-value"));

  test("cold start is the declared bar, labels and test ids intact", async () => {
    await render();

    expect(visibleTabs()).toEqual(DECLARED);
    expect(host.querySelector('[data-testid="devices-tab-map"]').textContent).toContain("Site map");
    expect(host.querySelector('[data-testid="devices-tab-pulse"]').textContent).toContain("Health and attention");
    expect(host.querySelector('[data-testid="devices-tabs-learning"]')).toBeNull();
  });

  test("the view a technician lives in leads, and no view is dropped", async () => {
    await render({ personal: viewEvidence("insights", 7) });

    expect(visibleTabs()).toEqual(["insights", "pulse", "directory", "map"]);
    expect(host.querySelector('[data-testid="devices-tabs-learning"]').getAttribute("data-learning-tone")).toBe("personal");
  });

  test("the team's habit orders the bar for a technician with none of their own", async () => {
    await render({ team: viewEvidence("map", 30) });

    expect(visibleTabs()).toEqual(["map", "pulse", "directory", "insights"]);
    expect(host.querySelector('[data-testid="devices-tabs-learning"]').getAttribute("data-learning-tone")).toBe("team");
  });

  test("opening a view records it as a view", async () => {
    const onRecordAction = jest.fn();
    await render({ onRecordAction });

    const directory = host.querySelector('[data-value="directory"]');
    await act(async () => {
      directory.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRecordAction).toHaveBeenCalledWith("view", "directory");
  });
});
