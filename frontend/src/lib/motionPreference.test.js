/* The operator's motion preference.

   The gap this closes: Nexus had a Motion control that wrote `<html data-motion>` and
   `App.js` also honoured the OS setting for CSS, but JavaScript never asked. These tests
   pin both sources, the precedence between them, and that a change is observed live. */
import {
  MOTION_CHANGE_EVENT,
  MOTION_SETTINGS,
  motionSetting,
  prefersReducedMotion,
  REDUCED_MOTION_SETTINGS,
  subscribeToMotionPreference,
  systemPrefersReducedMotion,
} from "./motionPreference";

const fakeRoot = (motion) => ({ dataset: motion === undefined ? {} : { motion } });

const fakeView = (matches) => {
  const listeners = { media: [], window: [] };
  return {
    listeners,
    matchMedia: jest.fn(() => ({
      matches,
      addEventListener: (name, listener) => listeners.media.push([name, listener]),
      removeEventListener: jest.fn(),
    })),
    addEventListener: (name, listener) => listeners.window.push([name, listener]),
    removeEventListener: jest.fn(),
  };
};

test("the setting defaults to `system`, so an unset attribute never means \"no motion\"", () => {
  expect(motionSetting(fakeRoot())).toBe("system");
  expect(motionSetting(fakeRoot("nonsense"))).toBe("system");
  expect(MOTION_SETTINGS).toEqual(["system", "full", "minimal", "none"]);
  expect(REDUCED_MOTION_SETTINGS).toEqual(["minimal", "none"]);
});

test("an explicit in-app choice wins over the operating system, in both directions", () => {
  expect(prefersReducedMotion(fakeRoot("none"), fakeView(false))).toBe(true);
  expect(prefersReducedMotion(fakeRoot("minimal"), fakeView(false))).toBe(true);
  expect(prefersReducedMotion(fakeRoot("full"), fakeView(true))).toBe(false);
  expect(prefersReducedMotion(fakeRoot("system"), fakeView(true))).toBe(true);
  expect(prefersReducedMotion(fakeRoot("system"), fakeView(false))).toBe(false);
});

test("reading the OS preference never throws, whatever the environment provides", () => {
  expect(systemPrefersReducedMotion(undefined)).toBe(false);
  expect(systemPrefersReducedMotion({})).toBe(false);
  expect(systemPrefersReducedMotion({ matchMedia: () => { throw new Error("unsupported query"); } })).toBe(false);
});

test("a change is observed from either source, and the subscription is removable", () => {
  const view = fakeView(false);
  const root = fakeRoot("system");
  const listener = jest.fn();
  const unsubscribe = subscribeToMotionPreference(listener, root, view);

  // The in-app Motion control changing setting.
  root.dataset.motion = "none";
  const changeEvent = view.listeners.window.find(([name]) => name === MOTION_CHANGE_EVENT);
  expect(changeEvent).toBeDefined();
  changeEvent[1]();
  expect(listener).toHaveBeenLastCalledWith(true);

  // The operating system changing underneath a `system` setting.
  root.dataset.motion = "system";
  const mediaEvent = view.listeners.media.find(([name]) => name === "change");
  expect(mediaEvent).toBeDefined();
  mediaEvent[1]();
  expect(listener).toHaveBeenLastCalledWith(false);

  unsubscribe();
  expect(view.removeEventListener).toHaveBeenCalledWith(MOTION_CHANGE_EVENT, expect.any(Function));
  // A caller that passes no listener gets a harmless no-op rather than a crash.
  expect(() => subscribeToMotionPreference(undefined, root, view)()).not.toThrow();
});
