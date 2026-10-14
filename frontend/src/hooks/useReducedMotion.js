import { useEffect, useState } from "react";

import { prefersReducedMotion, subscribeToMotionPreference } from "@/lib/motionPreference";

/**
 * Whether the operator has asked for less movement — the in-app Motion control or the
 * operating system, whichever is stricter.
 *
 * A media query cannot reach `requestAnimationFrame`, so any component that animates in
 * JavaScript has to ask this hook instead of assuming. It subscribes to both sources and
 * updates live, so changing the Motion setting takes effect without a reload: the
 * previous state of affairs was that a technician set "None", nothing observable
 * happened, and every KPI tile went on counting up.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());

  useEffect(
    () => subscribeToMotionPreference(() => setReduced(prefersReducedMotion())),
    [],
  );

  return reduced;
}

export default useReducedMotion;
