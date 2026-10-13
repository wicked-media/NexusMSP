import { getAllNavItems, navGroups } from "./navigation";
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

describe("MSP Studios section", () => {
  const group = navGroups.find((candidate) => candidate.id === "msp_studios");

  test("is its own titled section rather than a Platform entry", () => {
    expect(group).toBeTruthy();
    expect(group.title).toBe("MSP Studios");
    expect(navGroups.find((candidate) => candidate.id === "platform").items.some((item) => item.path === "/studios")).toBe(false);
  });

  test("lists each admitted studio at its own operating surface", () => {
    const labels = group.items.map((item) => item.label);
    expect(labels).toEqual([
      "Studio fleet",
      "Proxmox Studio",
      "Windows Studio",
      "Endpoint Performance Studio",
      "Customer Environment Studio",
      "Operations Assurance Studio",
      "Extension Studio",
      "Web Studio",
      "M365 Studio",
    ]);
  });

  test("keeps the studio operating surfaces distinct from the fleet hub", () => {
    const paths = group.items.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((path) => path.startsWith("/studios"))).toEqual(["/studios", "/studios/web", "/studios/m365"]);
  });
});
