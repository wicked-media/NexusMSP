import { routeConfig } from "./routes";

describe("route configuration", () => {
  it("registers the Nexus Guardian and Script Library workspaces behind auth", () => {
    const guardian = routeConfig.find((r) => r.path === "/nexus-guardian");
    const library = routeConfig.find((r) => r.path === "/script-library");
    expect(guardian).toBeTruthy();
    expect(guardian.auth).toBe(true);
    expect(guardian.layout).toBe(true);
    expect(library).toBeTruthy();
    expect(library.auth).toBe(true);
  });

  it("never leaves a route with an undefined component", () => {
    for (const route of routeConfig) {
      expect(route.component).toBeDefined();
    }
  });
});
