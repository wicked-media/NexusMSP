/**
 * The operator's motion preference, in one place.
 *
 * Nexus has two independent ways of asking for less movement, and JavaScript obeyed
 * neither of them:
 *
 *   * the operating system, through `(prefers-reduced-motion: reduce)`, and
 *   * the in-app Motion control, which `App.js` writes to `<html data-motion>` and
 *     announces with a `nexus-motion-change` event.
 *
 * The stylesheet handles both for CSS animation. Nothing reached JavaScript, so the
 * shared `MetricTile` — whose numbers are driven by `requestAnimationFrame` inside
 * `HeroTile` — kept counting up for an operator who had explicitly chosen "None".
 *
 * This module is the runtime half of that contract, and it is dependency-free so the
 * audit can reason about it: `src/lib/accessibilityCoverage.js` fails the build for a
 * shared primitive that starts a frame loop without consulting it.
 */

/** The OS-level query. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The event `App.js` dispatches when the in-app Motion control changes. */
export const MOTION_CHANGE_EVENT = "nexus-motion-change";

/** The attribute `App.js` writes the setting to, on `<html>`. */
export const MOTION_ATTRIBUTE = "data-motion";

/**
 * The four settings `App.js` accepts (`TechSettingsPage` labels them "Follow system",
 * "Professional", "Minimal motion" and "Static"). Two reduce motion, one is an explicit
 * choice of full motion, and the default defers to the operating system.
 */
export const MOTION_SETTINGS = ["system", "full", "minimal", "none"];
export const REDUCED_MOTION_SETTINGS = ["minimal", "none"];
export const EXPLICIT_FULL_MOTION_SETTINGS = ["full"];

const defaultRoot = () => (typeof document === "undefined" ? null : document.documentElement);
const defaultView = () => (typeof window === "undefined" ? null : window);

/** The raw setting: `system` means "whatever the operating system says". */
export function motionSetting(root = defaultRoot()) {
  const value = root?.dataset?.["motion"] || (root?.getAttribute?.(MOTION_ATTRIBUTE) ?? "");
  return MOTION_SETTINGS.includes(value) ? value : "system";
}

/** True only when the operating system is asking for less motion. */
export function systemPrefersReducedMotion(view = defaultView()) {
  if (!view || typeof view.matchMedia !== "function") return false;
  try {
    return Boolean(view.matchMedia(REDUCED_MOTION_QUERY)?.matches);
  } catch {
    return false;
  }
}

/**
 * The single answer both halves of the app must agree on: an explicit in-app choice wins,
 * otherwise the operating system is asked.
 *
 * "Follow system" is the default, so it defers. "Static" and "Minimal motion" reduce.
 * "Professional" is an explicit choice for full motion — the operator picked it, and it
 * overrides an OS preference in the other direction, exactly as a deliberate "reduce"
 * overrides an OS that has no preference.
 */
export function prefersReducedMotion(root = defaultRoot(), view = defaultView()) {
  const setting = motionSetting(root);
  if (REDUCED_MOTION_SETTINGS.includes(setting)) return true;
  if (EXPLICIT_FULL_MOTION_SETTINGS.includes(setting)) return false;
  return systemPrefersReducedMotion(view);
}

/**
 * Follow both sources. Returns an unsubscribe function, so it is usable directly as a
 * `useEffect` cleanup. `addListener` is the pre-14 Safari spelling and is kept because
 * the fallback is one line and a missing listener would mean the preference stops being
 * observed for those operators.
 */
export function subscribeToMotionPreference(listener, root = defaultRoot(), view = defaultView()) {
  if (typeof listener !== "function") return () => {};
  const notify = () => listener(prefersReducedMotion(root, view));
  const media = typeof view?.matchMedia === "function" ? view.matchMedia(REDUCED_MOTION_QUERY) : null;

  if (media && typeof media.addEventListener === "function") media.addEventListener("change", notify);
  else if (media && typeof media.addListener === "function") media.addListener(notify);
  view?.addEventListener?.(MOTION_CHANGE_EVENT, notify);

  return () => {
    if (media && typeof media.removeEventListener === "function") media.removeEventListener("change", notify);
    else if (media && typeof media.removeListener === "function") media.removeListener(notify);
    view?.removeEventListener?.(MOTION_CHANGE_EVENT, notify);
  };
}
