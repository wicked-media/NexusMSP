import { resolveStudioWorkspaceContext, STUDIO_WORKSPACES } from "./studioWorkspaceContext";

describe("Studio workspace context", () => {
  test("identifies an admitted Studio at its operational workspace", () => {
    expect(resolveStudioWorkspaceContext("/nexus-remote")).toEqual({ studio: "Remote Studio" });
    expect(resolveStudioWorkspaceContext("/tickets", "?view=queue")).toEqual({ studio: "Service Desk Studio" });
  });

  test("keeps query-specific Studio ownership precise", () => {
    expect(resolveStudioWorkspaceContext("/control-plane", "?module=microsoft365")).toEqual({ studio: "Microsoft Studio" });
    expect(resolveStudioWorkspaceContext("/control-plane", "?module=foundation")).toBeNull();
    expect(resolveStudioWorkspaceContext("/fleet-baseline", "?platform=windows")).toEqual({ studio: "Windows Studio" });
    expect(resolveStudioWorkspaceContext("/fleet-baseline", "?view=recurrence")).toEqual({ studio: "Endpoint Performance Studio" });
  });

  test("names Studio detail pages instead of repeating the catalogue label", () => {
    expect(resolveStudioWorkspaceContext("/studios/remote"))
      .toEqual({ studio: "Remote Studio", label: "Studio overview" });
    expect(resolveStudioWorkspaceContext("/studios/endpoint-performance"))
      .toEqual({ studio: "Endpoint Performance Studio", label: "Studio overview" });
  });

  test("never invents a Studio for an unrelated route", () => {
    expect(resolveStudioWorkspaceContext("/settings")).toBeNull();
    expect(new Set(STUDIO_WORKSPACES.map((entry) => `${entry.pathname}:${JSON.stringify(entry.search || {})}`)).size)
      .toBe(STUDIO_WORKSPACES.length);
  });
});
