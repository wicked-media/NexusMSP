const SIDEBAR_PREFERENCES_VERSION = 1;
const MAX_PINNED_WORKSPACES = 6;

const normalisePathname = (pathname = "/") => {
  const value = String(pathname || "/").trim() || "/";
  if (value === "/") return value;
  return value.replace(/\/+$/, "") || "/";
};

const normaliseSearch = (search = "") => {
  const value = String(search || "").trim();
  return value && !value.startsWith("?") ? `?${value}` : value;
};

const getTargetParts = (target = "/") => {
  const [pathname, ...searchParts] = String(target || "/").split("?");
  return {
    pathname: normalisePathname(pathname),
    params: new URLSearchParams(searchParts.join("?")),
  };
};

const getLocationParts = (location = {}) => ({
  pathname: normalisePathname(location.pathname),
  params: new URLSearchParams(normaliseSearch(location.search)),
});

const querySpecificity = (target) => [...getTargetParts(target).params.keys()].length;

const pathMatchesWorkspace = (pathname, workspacePath) => {
  const path = normalisePathname(pathname);
  const workspace = normalisePathname(workspacePath);
  return path === workspace || path.startsWith(`${workspace}/`);
};

/**
 * A navigation target is active when its pathname and every query parameter
 * it declares are present in the current URL. Extra context (for example a
 * selected record ID) is deliberately allowed so a workspace remains active
 * while a technician drills into it.
 */
export function matchesNavigationTarget(location, target) {
  const current = getLocationParts(location);
  const expected = getTargetParts(target);
  if (current.pathname !== expected.pathname) return false;

  return [...expected.params.entries()].every(([key, value]) => current.params.getAll(key).includes(value));
}

export function getNavigationItemState(item, location) {
  const isItemActive = matchesNavigationTarget(location, item.path);
  const matchingChildren = (item.children || []).filter((child) => matchesNavigationTarget(location, child.path));
  const activeChild = matchingChildren
    .sort((left, right) => querySpecificity(right.path) - querySpecificity(left.path))[0] || null;
  const isWorkspaceActive = (item.workspacePaths || []).some((path) => pathMatchesWorkspace(location.pathname, path));

  return {
    activeChild,
    isChildActive: Boolean(activeChild),
    isItemActive,
    isWorkspaceActive,
    isHighlighted: isItemActive || Boolean(activeChild) || isWorkspaceActive,
    isCurrentPage: isItemActive && !activeChild,
  };
}

export function getActiveParentNavigationPath(groups, location) {
  for (const group of groups) {
    for (const item of group.items || []) {
      if (!item.children?.length) continue;
      if (getNavigationItemState(item, location).isHighlighted) return item.path;
    }
  }
  return null;
}

export function sidebarPreferencesKey(userId) {
  const safeUserId = String(userId || "anonymous").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `nexus.sidebar.navigation.v${SIDEBAR_PREFERENCES_VERSION}:${safeUserId}`;
}

export function normaliseSidebarPreferences(value, validPaths = []) {
  const allowedPaths = new Set(validPaths);
  const uniqueValid = (paths, limit) => [...new Set(Array.isArray(paths) ? paths : [])]
    .filter((path) => typeof path === "string" && allowedPaths.has(path))
    .slice(0, limit);

  return {
    version: SIDEBAR_PREFERENCES_VERSION,
    collapsed: value?.collapsed === true,
    expandedPaths: uniqueValid(value?.expandedPaths, 1),
    pinnedPaths: uniqueValid(value?.pinnedPaths, MAX_PINNED_WORKSPACES),
  };
}

export function readSidebarPreferences(userId, validPaths = []) {
  if (typeof window === "undefined") return normaliseSidebarPreferences({}, validPaths);
  try {
    const stored = window.localStorage.getItem(sidebarPreferencesKey(userId));
    return normaliseSidebarPreferences(stored ? JSON.parse(stored) : {}, validPaths);
  } catch {
    return normaliseSidebarPreferences({}, validPaths);
  }
}

export function writeSidebarPreferences(userId, preferences, validPaths = []) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      sidebarPreferencesKey(userId),
      JSON.stringify(normaliseSidebarPreferences(preferences, validPaths)),
    );
  } catch {
    // Local navigation preferences are optional. Storage restrictions must not
    // prevent a technician using the rest of Nexus.
  }
}

export function togglePinnedWorkspace(pinnedPaths, path, validPaths = []) {
  const current = normaliseSidebarPreferences({ pinnedPaths }, validPaths).pinnedPaths;
  if (!validPaths.includes(path)) return current;
  if (current.includes(path)) return current.filter((value) => value !== path);
  return [...current, path].slice(0, MAX_PINNED_WORKSPACES);
}
