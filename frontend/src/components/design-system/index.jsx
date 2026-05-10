/**
 * Swiss Tactical Dark design-system primitives.
 * Shared across the MSP cockpit for visual + interaction consistency.
 */
import { ResponsiveContainer, AreaChart, Area } from "recharts";

export function HealthDial({ score, size = 44, showLabel = true }) {
  const s = Math.max(0, Math.min(100, score || 0));
  const color = s >= 85 ? "#34d399" : s >= 70 ? "#fbbf24" : s >= 50 ? "#fb923c" : "#fb7185";
  const stroke = Math.max(3, size / 12);
  const r = (size / 2) - stroke;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - s / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 600ms ease-out" }}
      />
      {showLabel && (
        <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle"
              fontSize={size * 0.32} fontWeight="600" fill={color} fontFamily="ui-monospace,SFMono-Regular,monospace">{s}</text>
      )}
    </svg>
  );
}

export function Sparkline({ data, color = "#818cf8", width = 80, height = 28 }) {
  if (!data || !data.length) return <div className="opacity-30" style={{ width, height }} />;
  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={40} minHeight={16}>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <defs>
            <linearGradient id={`sp-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5}
                fill={`url(#sp-${color.replace("#", "")})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Single metric in the top strip. Accented left border + uppercase micro-label + large numeric value. */
/** Single metric tile — gradient-glow aesthetic shared with the Backup Center hero tiles.
 *  Accent → glow-color mapping for backwards compatibility. */
export function MetricTile({ label, value, trend, trendColor, accent = "indigo", icon, testid }) {
  const glowMap = {
    indigo:  "from-violet-500/20 to-fuchsia-600/10 border-violet-500/30 text-violet-300 shadow-violet-500/20",
    violet:  "from-violet-500/20 to-fuchsia-600/10 border-violet-500/30 text-violet-300 shadow-violet-500/20",
    cyan:    "from-cyan-500/20 to-blue-600/10 border-cyan-500/30 text-cyan-300 shadow-cyan-500/20",
    sky:     "from-cyan-500/20 to-blue-600/10 border-cyan-500/30 text-cyan-300 shadow-cyan-500/20",
    emerald: "from-emerald-500/20 to-green-600/10 border-emerald-500/30 text-emerald-300 shadow-emerald-500/20",
    amber:   "from-amber-500/20 to-orange-600/10 border-amber-500/30 text-amber-300 shadow-amber-500/20",
    rose:    "from-rose-500/20 to-red-600/10 border-rose-500/30 text-rose-300 shadow-rose-500/20",
    zinc:    "from-zinc-500/15 to-zinc-700/5 border-zinc-500/30 text-zinc-300 shadow-zinc-500/10",
  };
  const tone = glowMap[accent] || glowMap.indigo;
  return (
    <div className={`relative overflow-hidden rounded-lg border bg-gradient-to-br ${tone} shadow-lg p-4`} data-testid={testid}>
      <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-current opacity-10 blur-2xl" />
      <div className="relative">
        <div className="text-[10px] font-semibold uppercase tracking-widest opacity-80 flex items-center gap-1">
          {icon}{label}
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <div className="text-3xl font-bold tracking-tighter font-mono">{value}</div>
          {trend && <span className={`text-[10px] font-mono ${trendColor || (trend.startsWith("+") ? "text-emerald-300" : trend.startsWith("-") ? "text-rose-300" : "opacity-70")}`}>{trend}</span>}
        </div>
      </div>
    </div>
  );
}

/** Grid wrapper for a top-of-page metric strip. */
export function MetricStrip({ children, columns = 6 }) {
  const gridClass = columns >= 6 ? "lg:grid-cols-6" : columns === 5 ? "lg:grid-cols-5" : columns === 4 ? "lg:grid-cols-4" : columns === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 ${gridClass} gap-3 px-6 py-4`}>
      {children}
    </div>
  );
}

export function StatusPill({ status, className = "", testid }) {
  // Generic status → color mapping tuned for ticketing / invoicing / lifecycle
  const map = {
    // tickets
    open: "text-sky-500 border-sky-500/30 bg-sky-500/5",
    in_progress: "text-indigo-500 border-indigo-500/30 bg-indigo-500/5",
    pending: "text-amber-500 border-amber-500/30 bg-amber-500/5",
    resolved: "text-emerald-500 border-emerald-500/30 bg-emerald-500/5",
    closed: "text-muted-foreground border-border bg-muted/50",
    // priority
    low: "text-muted-foreground border-border",
    medium: "text-sky-500 border-sky-500/30",
    high: "text-amber-500 border-amber-500/30",
    urgent: "text-rose-500 border-rose-500/30 bg-rose-500/5",
    critical: "text-rose-500 border-rose-500/40 bg-rose-500/10",
    // invoices
    paid: "text-emerald-500 border-emerald-500/30 bg-emerald-500/5",
    unpaid: "text-muted-foreground border-border",
    partial: "text-amber-500 border-amber-500/30",
    overdue: "text-rose-500 border-rose-500/30 bg-rose-500/5",
    void: "text-muted-foreground border-border line-through",
    sent: "text-sky-500 border-sky-500/30",
    draft: "text-muted-foreground border-border",
  };
  const style = map[(status || "").toLowerCase()] || "text-muted-foreground border-border";
  return (
    <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-mono ${style} ${className}`} data-testid={testid}>
      {(status || "—").replace("_", " ")}
    </span>
  );
}

/** Integration chip (ACR / PX8 / 365 / RMM) used on client rows & headers. */
export function IntegrationChip({ type, active, children }) {
  const map = {
    acronis: { label: "ACR", color: "text-sky-500 border-sky-500/40 bg-sky-500/5" },
    pax8: { label: "PX8", color: "text-indigo-500 border-indigo-500/40 bg-indigo-500/5" },
    m365: { label: "365", color: "text-blue-500 border-blue-500/40 bg-blue-500/5" },
    rmm: { label: "RMM", color: "text-emerald-500 border-emerald-500/40 bg-emerald-500/5" },
  };
  const cfg = map[type] || { label: children || "?", color: "text-muted-foreground border-border" };
  return (
    <span className={`font-mono text-[10px] h-5 px-1.5 rounded border flex items-center ${active ? cfg.color : "text-muted-foreground border-border opacity-60"}`}>
      {cfg.label}
    </span>
  );
}

/** Dense 1px-border page shell — intended wrapper around any operational cockpit page. */
export function PageShell({ children, className = "", ...props }) {
  return (
    <div className={`min-h-[calc(100vh-64px)] bg-background text-foreground flex flex-col ${className}`} {...props}>
      {children}
    </div>
  );
}

/** Terminal-aesthetic empty state. */
export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="opacity-40 mb-4">{icon}</div>
      <div className="text-sm text-foreground font-medium">{title}</div>
      {description && <div className="text-xs text-muted-foreground mt-1 max-w-md">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Uppercase section label used repeatedly. */
export function MicroLabel({ children, className = "" }) {
  return <div className={`text-[10px] font-medium uppercase tracking-widest text-muted-foreground ${className}`}>{children}</div>;
}
