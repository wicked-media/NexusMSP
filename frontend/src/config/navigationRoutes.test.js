import { MODULE_GROUPS, getAllNavItems, navGroups } from "./navigation";
import { routeConfig } from "./routes";

/** A route pattern like "/studios/:studioId" matches one real path segment. */
const routeMatcher = (path) => new RegExp(`^${String(path).split("/").map((segment) => (
  segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
)).join("/")}$`);

const registeredRoutes = routeConfig.map((route) => ({ path: route.path, match: routeMatcher(route.path) }));

describe("navigation destinations", () => {
  test("every menu entry opens a registered route", () => {
    const missing = getAllNavItems()
      .map((item) => ({ label: item.label, path: String(item.path).split("?")[0] }))
      .filter(({ path }) => !registeredRoutes.some((route) => route.match.test(path)))
      .map(({ label, path }) => `${label} -> ${path}`);

    expect(missing).toEqual([]);
  });
});

describe("Market Place section", () => {
  // The id is deliberately unchanged: visibility preferences and enabled modules
  // are stored against it, so the rename to Market Place must not orphan them.
  const group = navGroups.find((candidate) => candidate.id === "msp_studios");

  test("is its own titled section rather than a Platform entry", () => {
    expect(group).toBeTruthy();
    expect(group.title).toBe("Market Place");
    expect(navGroups.find((candidate) => candidate.id === "platform").items.some((item) => item.path === "/studios")).toBe(false);
    expect(MODULE_GROUPS.find((candidate) => candidate.id === "msp_studios").label).toBe("Market Place");
  });

  test("leads with the searchable catalogue instead of one link per studio", () => {
    expect(group.items.map((item) => item.path)).toEqual(["/studios"]);
    expect(group.items[0].label).toBe("Studio catalogue");
  });

  test("keeps every admitted studio resolvable under the catalogue", () => {
    const children = group.items[0].children.map((item) => item.path);
    expect(children).toEqual([
      "/proxmox",
      "/fleet-baseline?platform=windows",
      "/fleet-baseline?view=recurrence",
      "/customer-environment",
      "/operations-assurance",
      "/extension-studio",
      "/studios/web",
      "/studios/m365",
    ]);
    // The catalogue is the one sidebar row and every admitted surface hangs off
    // it, so no path is claimed twice.
    const declared = [group.items[0].path, ...children];
    expect(new Set(declared).size).toBe(declared.length);

    // Sidebar search and the command palette read this list, so a studio that is
    // no longer a top-level row is still resolvable by name.
    const resolvable = getAllNavItems().map((item) => item.path);
    expect(resolvable.filter((path) => path === "/proxmox")).toHaveLength(1);
    expect(resolvable.filter((path) => path.startsWith("/studios"))).toEqual([
      "/studios", "/studios/web", "/studios/m365",
    ]);
    // The label's alias route exists, but the catalogue stays the canonical path.
    expect(resolvable).not.toContain("/marketplace");
  });
});
