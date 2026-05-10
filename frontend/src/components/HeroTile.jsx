import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

/** Animated counter — eases up to numeric target */
export function AnimatedCounter({ value, suffix = "", duration = 800 }) {
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
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (target - start) * eased));
      if (progress < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{display}{suffix}</>;
}

const GLOW_MAP = {
  cyan:    "from-cyan-500/20 to-blue-600/10 border-cyan-500/30 text-cyan-300 shadow-cyan-500/20",
  emerald: "from-emerald-500/20 to-green-600/10 border-emerald-500/30 text-emerald-300 shadow-emerald-500/20",
  rose:    "from-rose-500/20 to-red-600/10 border-rose-500/30 text-rose-300 shadow-rose-500/20",
  amber:   "from-amber-500/20 to-orange-600/10 border-amber-500/30 text-amber-300 shadow-amber-500/20",
  violet:  "from-violet-500/20 to-fuchsia-600/10 border-violet-500/30 text-violet-300 shadow-violet-500/20",
  zinc:    "from-zinc-500/15 to-zinc-700/5 border-zinc-500/30 text-zinc-300 shadow-zinc-500/10",
};

/**
 * HeroTile — the gradient-glow KPI card used in the Backup Center, now reusable.
 * @param label    short uppercase label
 * @param value    number or string. If number, animates.
 * @param icon     Lucide icon component
 * @param glow     "cyan" | "emerald" | "rose" | "amber" | "violet" | "zinc"
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
  const glowClass = GLOW_MAP[glow] || GLOW_MAP.cyan;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      data-testid={testId}
      className={`block w-full text-left ${onClick ? "cursor-pointer transition-transform hover:scale-[1.01]" : ""}`}
    >
      <Card className={`relative overflow-hidden border bg-gradient-to-br ${glowClass} shadow-lg ${active ? "ring-2 ring-white/30" : ""}`}>
        <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-current opacity-10 blur-2xl" />
        <CardContent className="p-4 relative">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</span>
            {Icon && <Icon className="w-4 h-4 opacity-80" />}
          </div>
          <p className="text-3xl font-bold tracking-tighter font-mono">
            {animated && typeof value === "number" ? <AnimatedCounter value={value} suffix={suffix} /> : <>{value}{suffix}</>}
          </p>
          {subtitle && <p className="text-[10px] opacity-70 mt-0.5">{subtitle}</p>}
        </CardContent>
      </Card>
    </Tag>
  );
}
