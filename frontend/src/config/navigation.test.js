import { getAllNavItems } from "./navigation";
import { getWorkspaceTools } from "./workspaceTools";

describe("Nexus navigation registry", () => {
  test("keeps Websites & domains in the client operations workspace", () => {
    const webStudioEntries = getAllNavItems().filter((item) => item.path === "/web-studio");

    expect(webStudioEntries).toHaveLength(1);
    expect(webStudioEntries[0]).toMatchObject({ label: "Websites & domains", group: "Clients & Revenue", parentLabel: "Clients" });
  });

  test("does not present the documentation workspace as two automation destinations", () => {
    expect(getAllNavItems().some((item) => item.path === "/documentation-hub?tab=library")).toBe(false);
    expect(getAllNavItems().some((item) => item.path === "/documentation-hub")).toBe(true);
  });

  test("keeps Nexus Remote as the one discoverable remote-support workspace", () => {
    const remoteEntries = getAllNavItems().filter((item) => item.path === "/nexus-remote");
    expect(remoteEntries).toHaveLength(1);
    expect(remoteEntries[0]).toMatchObject({ label: "Nexus Remote", group: "Managed Operations", parentLabel: "Devices & RMM" });
  });

  test("keeps retained workshop records distinct from the live Service Desk queue", () => {
    const workshopEntries = getAllNavItems().filter((item) => item.path === "/workshop-bench");

    expect(workshopEntries).toHaveLength(1);
    expect(workshopEntries[0]).toMatchObject({
      label: "Historical workshop records",
      group: "Service Desk",
      parentLabel: "Tickets",
    });
  });

  test("supplies each shared header with explicit related tools", () => {
    expect(getWorkspaceTools("changeManagement").map((item) => item.path)).toEqual(["/change-freezes", "/alert-rules"]);
    expect(getWorkspaceTools("clients").map((item) => item.path)).toEqual(["/client-insights", "/nexus-assurance", "/client-compare", "/client-portal"]);
    expect(getWorkspaceTools("unknown-workspace")).toEqual([]);
  });
});
