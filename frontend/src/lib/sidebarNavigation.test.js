import {
  getActiveParentNavigationPath,
  getNavigationItemState,
  matchesNavigationTarget,
  normaliseSidebarPreferences,
  togglePinnedWorkspace,
} from "./sidebarNavigation";

const groups = [{
  id: "platform",
  items: [{
    path: "/control-plane",
    workspacePaths: ["/cipp"],
    children: [
      { path: "/control-plane?module=microsoft365", label: "Tenant operations" },
      { path: "/control-plane?module=microsoft365&view=connections", label: "Connections" },
    ],
  }],
}];

describe("sidebar navigation URL matching", () => {
  test("matches declared query parameters regardless of order and keeps extra context", () => {
    expect(matchesNavigationTarget(
      { pathname: "/control-plane", search: "?view=connections&ticket=t-101&module=microsoft365" },
      "/control-plane?module=microsoft365&view=connections",
    )).toBe(true);
  });

  test("selects the most specific matching child", () => {
    const state = getNavigationItemState(groups[0].items[0], {
      pathname: "/control-plane",
      search: "?module=microsoft365&view=connections",
    });

    expect(state.activeChild?.label).toBe("Connections");
    expect(state.isCurrentPage).toBe(false);
  });

  test("uses safe workspace path boundaries for nested workspace routes", () => {
    const item = { path: "/security-dashboard", workspacePaths: ["/soc-feed"] };
    expect(getNavigationItemState(item, { pathname: "/soc-feed/live" }).isWorkspaceActive).toBe(true);
    expect(getNavigationItemState(item, { pathname: "/soc-feedback" }).isWorkspaceActive).toBe(false);
  });

  test("finds the parent menu that should be auto-expanded for a query view", () => {
    expect(getActiveParentNavigationPath(groups, {
      pathname: "/control-plane",
      search: "?module=microsoft365&view=connections",
    })).toBe("/control-plane");
  });
});

describe("sidebar navigation preferences", () => {
  const validPaths = ["/tickets", "/devices", "/voice"];

  test("retains only known, bounded local preference values", () => {
    expect(normaliseSidebarPreferences({
      collapsed: true,
      expandedPaths: ["/tickets", "/devices", "/unknown"],
      pinnedPaths: ["/tickets", "/tickets", "/unknown", "/devices"],
    }, validPaths)).toEqual({
      version: 1,
      collapsed: true,
      expandedPaths: ["/tickets"],
      pinnedPaths: ["/tickets", "/devices"],
    });
  });

  test("adds and removes a pinned workspace without persisting invalid paths", () => {
    expect(togglePinnedWorkspace(["/tickets"], "/devices", validPaths)).toEqual(["/tickets", "/devices"]);
    expect(togglePinnedWorkspace(["/tickets", "/devices"], "/tickets", validPaths)).toEqual(["/devices"]);
    expect(togglePinnedWorkspace(["/tickets"], "/unknown", validPaths)).toEqual(["/tickets"]);
  });
});
