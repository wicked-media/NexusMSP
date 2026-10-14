import { useEffect, useMemo, useState } from "react";
import { seasonalMode, SEASONAL_COPY } from "@/lib/seasonal";

// Ambient seasonal delight: December snow, spooky-season bats, and the
// April Fools' banner. Purely decorative — it never touches app data.

const FLAKES = Array.from({ length: 26 }, (_, i) => ({
  id: i,
  left: (i * 137) % 100,
  delay: (i % 9) * 1.2,
  duration: 7 + (i % 5) * 2,
  size: 4 + (i % 4) * 2,
}));

const BATS = Array.from({ length: 7 }, (_, i) => ({ id: i, top: 8 + ((i * 29) % 60), delay: i * 1.7 }));

export default function SeasonalEffects() {
  const mode = useMemo(() => seasonalMode(new Date()), []);
  const [aprilDismissed, setAprilDismissed] = useState(() => {
    try {
      return window.localStorage.getItem("nexus.april.dismissed") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (mode === "snow") document.body.classList.add("seasonal-snow");
    return () => document.body.classList.remove("seasonal-snow");
  }, [mode]);

  if (!mode) return null;

  const dismissApril = () => {
    setAprilDismissed(true);
    try {
      window.localStorage.setItem("nexus.april.dismissed", "1");
    } catch {
      /* non-persistent dismissal is fine */
    }
  };

  return (
    <div aria-hidden={mode !== "april"} className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {mode === "snow" && FLAKES.map((flake) => (
        <span
          key={flake.id}
          className="seasonal-flake absolute rounded-full bg-sky-200/70"
          style={{ left: `${flake.left}%`, width: flake.size, height: flake.size, animationDelay: `${flake.delay}s`, animationDuration: `${flake.duration}s` }}
        />
      ))}
      {mode === "bats" && BATS.map((bat) => (
        <span key={bat.id} className="seasonal-bat absolute text-xl" style={{ top: `${bat.top}%`, animationDelay: `${bat.delay}s` }}>🦇</span>
      ))}
      {mode === "april" && !aprilDismissed && (
        <div className="pointer-events-auto absolute top-16 left-1/2 z-[61] w-[min(92vw,460px)] -translate-x-1/2 rounded-xl border border-violet-400/40 bg-slate-900/95 p-4 shadow-2xl">
          <p className="text-sm font-semibold text-violet-200">{SEASONAL_COPY.april.title}</p>
          <p className="mt-1 text-xs text-slate-300">{SEASONAL_COPY.april.message}</p>
          <button
            onClick={dismissApril}
            className="mt-3 rounded-lg border border-violet-400/40 bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-100 transition hover:bg-violet-500/30"
            data-testid="april-dismiss"
          >
            Got me. Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
