import { useEffect, useRef, useState, useCallback, useId } from "react";
import "@/styles/hero-tile.css";

/** Animated counter — eases up to numeric target. Also accepts string-with-prefix like "$1,234". */
export function AnimatedCounter({ value, suffix = "", duration = 900 }) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef(null);
  useEffect(() => {
    startRef.current = null;
    const start = display;
    const target = Number(value) || 0;
    const raf = (ts) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(1, elapsed / duration);
      // easeOutExpo for a punchy land
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplay(Math.round(start + (target - start) * eased));
      if (progress < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{display}{suffix}</>;
}

/**
 * Glow palette → CSS custom properties.
 * --hue-from / --hue-to : aurora gradient endpoints
 * --hue-glow            : outer halo + spotlight
 * --hue-text            : value + label hue
 * --hue-shadow          : box-shadow tint
 * --hue-ring            : active ring
 */
const GLOW_VARS = {
  cyan:    { from: "#22d3ee", to: "#3b82f6",  glow: "#22d3eeb3", text: "#67e8f9", shadow: "#06b6d44d", ring: "#22d3ee" },
  emerald: { from: "#34d399", to: "#10b981",  glow: "#34d399b3", text: "#6ee7b7", shadow: "#10b9814d", ring: "#34d399" },
  rose:    { from: "#fb7185", to: "#ef4444",  glow: "#fb7185b3", text: "#fda4af", shadow: "#ef44444d", ring: "#fb7185" },
  amber:   { from: "#fbbf24", to: "#f97316",  glow: "#fbbf24b3", text: "#fcd34d", shadow: "#f970164d", ring: "#fbbf24" },
  violet:  { from: "#a78bfa", to: "#d946ef",  glow: "#a78bfab3", text: "#c4b5fd", shadow: "#7c3aed4d", ring: "#a78bfa" },
  zinc:    { from: "#71717a", to: "#52525b",  glow: "#a1a1aa80", text: "#d4d4d8", shadow: "#3f3f463d", ring: "#a1a1aa" },
  indigo:  { from: "#818cf8", to: "#6366f1",  glow: "#818cf8b3", text: "#a5b4fc", shadow: "#4f46e54d", ring: "#818cf8" },
  sky:     { from: "#38bdf8", to: "#0ea5e9",  glow: "#38bdf8b3", text: "#7dd3fc", shadow: "#0284c74d", ring: "#38bdf8" },
};

/**
 * HeroTile — gradient-glow KPI card.
 * BACKWARDS-COMPATIBLE PROPS — no breaking changes to call sites.
 * @param label    short uppercase label
 * @param value    number or string. If number, animates.
 * @param icon     Lucide icon component
 * @param glow     "cyan" | "emerald" | "rose" | "amber" | "violet" | "zinc" | "indigo" | "sky"
 * @param suffix   appended to value (e.g. "%", "h")
 * @param subtitle small line below
 * @param animated default true; set false for string values
 * @param onClick  if provided, the tile becomes a clickable filter
 * @param active   draws a brighter ring when this tile is the active filter
 * @param testId   sets data-testid
 */
export default function HeroTile({
  label, value, icon: Icon, glow = "cyan", suffix = "", subtitle,
  animated = true, onClick, active = false, testId,
}) {
  const palette = GLOW_VARS[glow] || GLOW_VARS.cyan;
  const tileRef = useRef(null);
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const Tag = onClick ? "button" : "div";

  // Cursor-tracking spotlight (via CSS custom props)
  const onPointerMove = useCallback((e) => {
    const el = tileRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty("--mx", `${x}%`);
    el.style.setProperty("--my", `${y}%`);
    el.style.setProperty("--mouse-active", "1");
  }, []);
  const onPointerLeave = useCallback(() => {
    const el = tileRef.current;
    if (!el) return;
    el.style.setProperty("--mouse-active", "0");
  }, []);

  // Value-change pulse — fires a brief shockwave when value changes
  const [pulseKey, setPulseKey] = useState(0);
  const prevValRef = useRef(value);
  useEffect(() => {
    if (prevValRef.current !== value) {
      setPulseKey((k) => k + 1);
      prevValRef.current = value;
    }
  }, [value]);

  // Trend history (auto-tracked from value prop) for ghosted sparkline backdrop
  const [history, setHistory] = useState([]);
  useEffect(() => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    setHistory((h) => {
      const next = [...h, n].slice(-24);
      return next;
    });
  }, [value]);
  const sparkPath = (() => {
    if (history.length < 2) return null;
    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = Math.max(1, max - min);
    const W = 200, H = 60;
    const step = W / (history.length - 1);
    return history.map((v, i) => {
      const x = i * step;
      const y = H - ((v - min) / range) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  })();

  // Stagger entrance — index inferred by querySelectorAll order at runtime
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 30 + Math.random() * 120);
    return () => clearTimeout(t);
  }, []);

  return (
    <Tag
      ref={tileRef}
      onClick={onClick}
      onMouseMove={onPointerMove}
      onMouseLeave={onPointerLeave}
      data-testid={testId}
      data-glow={glow}
      style={{
        "--hue-from": palette.from,
        "--hue-to": palette.to,
        "--hue-glow": palette.glow,
        "--hue-text": palette.text,
        "--hue-shadow": palette.shadow,
        "--hue-ring": palette.ring,
        "--mx": "50%",
        "--my": "50%",
        "--mouse-active": "0",
      }}
      className={[
        "nx-hero",
        onClick ? "nx-hero--clickable" : "",
        active ? "nx-hero--active" : "",
        entered ? "nx-hero--entered" : "",
      ].filter(Boolean).join(" ")}
    >
      {/* Glass base + noise */}
      <div className="nx-hero__base" />
      {/* Aurora animated border (conic gradient) */}
      <div className="nx-hero__aurora" aria-hidden />
      {/* Inner gradient wash */}
      <div className="nx-hero__wash" aria-hidden />
      {/* Cursor-tracking spotlight */}
      <div className="nx-hero__spotlight" aria-hidden />
      {/* Scan lines */}
      <div className="nx-hero__scan" aria-hidden />
      {/* Corner glow blob */}
      <div className="nx-hero__blob" aria-hidden />
      {/* Sparkline ghost behind value */}
      {sparkPath && (
        <svg className="nx-hero__spark" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id={`spark-${safeId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--hue-from)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--hue-to)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${sparkPath} L 200,60 L 0,60 Z`} fill={`url(#spark-${safeId})`} opacity="0.35" />
          <path d={sparkPath} fill="none" stroke="var(--hue-from)" strokeOpacity="0.45" strokeWidth="1.2" />
        </svg>
      )}
      {/* Value-change shockwave (re-mounts on change) */}
      <span key={pulseKey} className="nx-hero__shockwave" aria-hidden />

      {/* Content */}
      <div className="nx-hero__content">
        <div className="nx-hero__head">
          <span className="nx-hero__label">{label}</span>
          {Icon && (
            <span className="nx-hero__icon">
              <Icon className="w-4 h-4" />
            </span>
          )}
        </div>
        <p className="nx-hero__value">
          {animated && typeof value === "number"
            ? <AnimatedCounter value={value} suffix={suffix} />
            : <>{value}{suffix}</>}
        </p>
        {subtitle && <p className="nx-hero__sub">{subtitle}</p>}
      </div>

      {/* Active ring */}
      {active && <span className="nx-hero__ring" aria-hidden />}
    </Tag>
  );
}
