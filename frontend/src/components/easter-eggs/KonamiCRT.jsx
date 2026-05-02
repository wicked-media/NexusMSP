import { useEffect, useState, useRef } from "react";

const SEQUENCE = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
  "b", "a",
];
const DURATION_MS = 30000;
const SCANLINE_OPACITY = 0.18;

export default function KonamiCRT() {
  const [active, setActive] = useState(false);
  const buf = useRef([]);
  const timer = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      // Don't interfere when typing in an input/textarea
      const tag = (e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;

      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      buf.current = [...buf.current, k].slice(-SEQUENCE.length);
      if (buf.current.join(",") === SEQUENCE.join(",")) {
        e.preventDefault();
        activate();
      }
      if (e.key === "Escape" && active) deactivate();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line
  }, [active]);

  const activate = () => {
    setActive(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(deactivate, DURATION_MS);
  };
  const deactivate = () => {
    setActive(false);
    if (timer.current) clearTimeout(timer.current);
  };

  if (!active) return null;
  return (
    <>
      <div className="fixed inset-0 pointer-events-none z-[9998] crt-overlay" data-testid="crt-overlay" />
      <div className="fixed bottom-4 left-4 z-[9999] pointer-events-none px-2 py-1 rounded bg-emerald-500/30 text-emerald-200 text-[10px] uppercase tracking-widest font-mono crt-badge">
        ▌RETRO MODE — ESC to exit
      </div>
      <style>{`
        .crt-overlay {
          background:
            repeating-linear-gradient(0deg, rgba(0,0,0,${SCANLINE_OPACITY}) 0, rgba(0,0,0,${SCANLINE_OPACITY}) 1px, transparent 1px, transparent 3px),
            radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.5) 100%);
          mix-blend-mode: multiply;
          animation: crtFlicker 250ms infinite;
        }
        @keyframes crtFlicker {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.96; }
        }
        .crt-badge {
          text-shadow: 0 0 6px rgba(16,185,129,0.6);
          animation: crtBlink 1s step-end infinite;
        }
        @keyframes crtBlink {
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}
