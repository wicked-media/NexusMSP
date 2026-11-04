import { getAllNavItems } from "@/config/navigation";

// Route labels live in one place (the sidebar navigation config). The global
// header resolves its context from that same source so a hand-written
// route→title map can never drift from the sidebar.

const normalisePath = (value) => {
  const raw = String(value || "").split("?")[0].split("#")[0];
  if (!raw || raw === "/") return "/";
  return raw.replace(/\/+$/, "") || "/";
};

/**
 * Resolve the workspace identity for a pathname.
 *
 * Returns `{ label, group }` for the deepest matching navigation entry, or
 * `null` when the route has no navigation entry (auth pages, kiosk, deep links).
 */
export function resolveTopbarWorkspace(pathname = "/") {
  const target = normalisePath(pathname);
  const items = getAllNavItems() || [];
  let best = null;
  let bestScore = -1;

  for (const item of items) {
    if (!item?.path || !item.label) continue;
    const candidate = normalisePath(item.path);
    const matches = target === candidate || (candidate !== "/" && target.startsWith(`${candidate}/`));
    if (!matches) continue;
    // Deepest match wins; a parent entry outranks a query-variant child.
    const score = candidate.length * 10 + (item.parentLabel ? 0 : 1);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  if (!best) return null;
  return { label: best.label, group: best.group || null };
}
