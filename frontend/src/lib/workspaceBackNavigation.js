const detailQueryKeys = new Set([
  "tab", "view", "module", "ticket", "client", "device", "po", "project", "site",
  "pbxId", "maintenanceWindow", "workSession", "work_session", "ids",
]);

const rootLabels = {
  "/assets": "assets",
  "/clients": "clients",
  "/devices": "devices",
  "/projects": "projects",
  "/purchase-orders": "purchase orders",
  "/tickets": "tickets",
  "/voice": "voice",
};

const clean = (value) => String(value || "").trim();

const queryValue = (params, key) => clean(params.get(key));

function rootNavigation(pathname) {
  const deviceChatMatch = pathname.match(/^\/devices\/([^/]+)\/chat\/?$/);
  if (deviceChatMatch) return { to: `/devices/${deviceChatMatch[1]}`, label: "Back to device" };
  if (pathname.startsWith("/devices/")) return { to: "/devices", label: "Back to devices" };
  if (pathname.startsWith("/assets/")) return { to: "/assets", label: "Back to assets" };
  if (pathname.startsWith("/tickets/")) return { to: "/tickets", label: "Back to tickets" };
  if (pathname.startsWith("/projects/")) return { to: "/projects", label: "Back to projects" };
  if (pathname.startsWith("/purchase-orders/")) return { to: "/purchase-orders", label: "Back to purchase orders" };
  if (pathname === "/voice/wallboard") return { to: "/voice?tab=monitoring", label: "Back to voice" };
  if (pathname.startsWith("/voice/")) return { to: "/voice", label: "Back to voice" };
  if (pathname.startsWith("/team/")) return { to: "/team-hub?view=roster", label: "Back to Team Hub" };
  if (pathname.startsWith("/help/")) return { to: "/documentation-hub?tab=help", label: "Back to Help Centre" };
  return null;
}

/**
 * Resolve a predictable in-Nexus parent rather than blindly using browser
 * history, which can take a technician to an unrelated site or an expired
 * deep link.  Detail routes and workspace subviews receive the same control.
 */
export function getWorkspaceBackNavigation({ pathname = "/", search = "" } = {}) {
  const currentPath = clean(pathname) || "/";
  const params = new URLSearchParams(search);
  if (currentPath === "/" || currentPath === "/login" || currentPath.startsWith("/portal-login")) return null;

  if (currentPath === "/work-session") {
    const ticketId = queryValue(params, "ticket");
    return ticketId ? { to: `/tickets?ticket=${encodeURIComponent(ticketId)}`, label: "Back to ticket" } : null;
  }

  if (currentPath === "/remote-access" || currentPath === "/nexus-remote") {
    const ticketId = queryValue(params, "ticket");
    const workSessionId = queryValue(params, "workSession") || queryValue(params, "work_session");
    const deviceId = queryValue(params, "device");
    if (ticketId && workSessionId) return { to: `/work-session?ticket=${encodeURIComponent(ticketId)}`, label: "Back to Work Session" };
    if (ticketId) return { to: `/tickets?ticket=${encodeURIComponent(ticketId)}`, label: "Back to ticket" };
    if (deviceId) return { to: `/devices/${encodeURIComponent(deviceId)}`, label: "Back to device" };
    return { to: "/devices", label: "Back to devices" };
  }

  const nested = rootNavigation(currentPath);
  if (nested) return nested;

  if ([...params.keys()].some((key) => detailQueryKeys.has(key))) {
    const label = rootLabels[currentPath] ? `Back to ${rootLabels[currentPath]}` : "Back to workspace";
    return { to: currentPath, label };
  }

  return null;
}
