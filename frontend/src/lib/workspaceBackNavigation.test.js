import { getWorkspaceBackNavigation } from "./workspaceBackNavigation";

describe("workspace back navigation", () => {
  test("returns to the originating ticket from a scoped Work Session", () => {
    expect(getWorkspaceBackNavigation({ pathname: "/work-session", search: "?ticket=ticket-123" })).toEqual({
      to: "/tickets?ticket=ticket-123",
      label: "Back to ticket",
    });
  });

  test("preserves the safe Work Session hand-off when backing out of remote access", () => {
    expect(getWorkspaceBackNavigation({ pathname: "/remote-access", search: "?ticket=ticket-123&workSession=work-456" })).toEqual({
      to: "/work-session?ticket=ticket-123",
      label: "Back to Work Session",
    });
  });

  test("preserves the same safe hand-off from the Nexus Remote product route", () => {
    expect(getWorkspaceBackNavigation({ pathname: "/nexus-remote", search: "?ticket=ticket-123&workSession=work-456" })).toEqual({
      to: "/work-session?ticket=ticket-123",
      label: "Back to Work Session",
    });
  });

  test("returns nested endpoint views to the endpoint workspace", () => {
    expect(getWorkspaceBackNavigation({ pathname: "/devices/device-123" })).toEqual({
      to: "/devices",
      label: "Back to devices",
    });
  });

  test("keeps a device chat deep link within that device record", () => {
    expect(getWorkspaceBackNavigation({ pathname: "/devices/device-123/chat" })).toEqual({
      to: "/devices/device-123",
      label: "Back to device",
    });
  });

  test("returns nested profiles and help articles to their Nexus workspace", () => {
    expect(getWorkspaceBackNavigation({ pathname: "/team/tech-123" })).toEqual({
      to: "/team-hub?view=roster",
      label: "Back to Team Hub",
    });
    expect(getWorkspaceBackNavigation({ pathname: "/help/work-ticket" })).toEqual({
      to: "/documentation-hub?tab=help",
      label: "Back to Help Centre",
    });
  });

  test("returns a selected workspace view to its workspace root", () => {
    expect(getWorkspaceBackNavigation({ pathname: "/voice", search: "?tab=monitoring" })).toEqual({
      to: "/voice",
      label: "Back to voice",
    });
  });

  test("does not show a back control at the Nexus or login roots", () => {
    expect(getWorkspaceBackNavigation({ pathname: "/" })).toBeNull();
    expect(getWorkspaceBackNavigation({ pathname: "/login", search: "?preview=1" })).toBeNull();
  });
});
