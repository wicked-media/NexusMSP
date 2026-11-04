/**
 * Swiss Tactical Dark design-system primitives.
 * Shared across the MSP cockpit for visual + interaction consistency.
 */
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { RotateCw } from "lucide-react";
import HeroTile from "@/components/HeroTile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

/**
 * Vertical bar comparison for numeric result sets.
 * `data`: [{ label, value, fill? }] — `fill` overrides the series colour per bar.
 */
export function CompareBars({ data, color = "#818cf8", unit = "", format, height = 150, testid }) {
  const rows = (data || [])
    .filter((row) => row && Number.isFinite(Number(row.value)))
    .map((row) => ({ ...row, value: Number(row.value) }));
  if (!rows.length) return null;
  return (
    <div style={{ height, width: "100%" }} data-testid={testid}>
      <ResponsiveContainer width="100%" height="100%" minWidth={80} minHeight={80}>
        <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} interval={0} axisLine={{ stroke: "rgba(148,163,184,0.2)" }} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
          <Tooltip
            cursor={{ fill: "rgba(129,140,248,0.08)" }}
            contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: "#e2e8f0" }}
            formatter={(value) => [format ? format(value) : `${value}${unit}`, ""]}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
            {rows.map((row, index) => <Cell key={`${row.label}-${index}`} fill={row.fill || color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Single metric in the top strip. Accented left border + uppercase micro-label + large numeric value. */
/** Single metric tile — gradient-glow aesthetic shared with the Backup Center hero tiles.
 *  Accent → glow-color mapping for backwards compatibility. */
export function MetricTile({ label, value, trend, accent = "indigo", icon, testid }) {
  const glowMap = { indigo: "indigo", violet: "violet", cyan: "cyan", sky: "sky", emerald: "emerald", amber: "amber", rose: "rose", zinc: "zinc", orange: "amber", fuchsia: "violet" };
  return <HeroTile label={label} value={value} icon={icon?.type} glow={glowMap[accent] || "indigo"} subtitle={trend} animated={typeof value === "number"} testId={testid} />;
}

/** Grid wrapper for a top-of-page metric strip. */
export function MetricStrip({ children, columns = 6 }) {
  const gridClass = columns >= 6 ? "md:grid-cols-3 lg:grid-cols-6" : columns === 5 ? "md:grid-cols-3 lg:grid-cols-5" : columns === 4 ? "md:grid-cols-4" : columns === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return (
    <div className={`grid grid-cols-2 ${gridClass} gap-3`}>
      {children}
    </div>
  );
}

export function StatusPill({ status, className = "", testid }) {
  // Generic status → colour mapping tuned for ticketing / invoicing / lifecycle.
  //
  // The hue comes from the design system's own chip scale (`--nx-chip-*`, exposed as
  // `chip-*`), not from fixed Tailwind `-500` literals. Those literals rendered 2.15:1
  // (amber) to 4.47:1 (indigo) as text on the light theme's white card, so a status
  // chip was unreadable in exactly the theme an operator picks for daylight. The scale
  // keeps the dark-theme hue the chips shipped with and deepens the light restatement;
  // `pnpm audit:accessibility` measures the label against the tint it really sits on.
  const map = {
    // tickets
    open: "text-chip-sky border-chip-sky/30 bg-chip-sky/5",
    in_progress: "text-chip-indigo border-chip-indigo/30 bg-chip-indigo/5",
    pending: "text-chip-amber border-chip-amber/30 bg-chip-amber/5",
    resolved: "text-chip-emerald border-chip-emerald/30 bg-chip-emerald/5",
    closed: "text-muted-foreground border-border bg-muted/50",
    // priority
    low: "text-muted-foreground border-border",
    medium: "text-chip-sky border-chip-sky/30",
    high: "text-chip-amber border-chip-amber/30",
    urgent: "text-chip-rose border-chip-rose/30 bg-chip-rose/5",
    critical: "text-chip-rose border-chip-rose/40 bg-chip-rose/10",
    // invoices
    paid: "text-chip-emerald border-chip-emerald/30 bg-chip-emerald/5",
    unpaid: "text-muted-foreground border-border",
    partial: "text-chip-amber border-chip-amber/30",
    overdue: "text-chip-rose border-chip-rose/30 bg-chip-rose/5",
    void: "text-muted-foreground border-border line-through",
    sent: "text-chip-sky border-chip-sky/30",
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
    acronis: { label: "ACR", color: "text-chip-sky border-chip-sky/40 bg-chip-sky/5" },
    pax8: { label: "PX8", color: "text-chip-indigo border-chip-indigo/40 bg-chip-indigo/5" },
    m365: { label: "365", color: "text-chip-blue border-chip-blue/40 bg-chip-blue/5" },
    rmm: { label: "RMM", color: "text-chip-emerald border-chip-emerald/40 bg-chip-emerald/5" },
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

/**
 * The workspace state contract: empty, loading, error.
 *
 * A workspace that fetches data owes the technician four distinct outcomes —
 * loading, empty (no records, as a *successful* answer), error (with a way out)
 * and data. These three primitives are the only implementations: a local copy in
 * a page is how six different prop contracts grew last time, and
 * `pnpm audit:experience` fails the build for one. See
 * docs/NEXUS_EXPERIENCE_STANDARD.md.
 */
const STATE_PANEL = "flex flex-col items-center justify-center text-center px-6";

/**
 * All three primitives accept `className`, merged onto the panel, so a workspace
 * that needs its own framing (inside a Card, or on a bare background) can supply
 * it without forking the primitive. That is the whole point of the contract:
 * presentation varies, the implementation does not.
 */

/** Terminal-aesthetic empty state — "this list is legitimately empty". */
export function EmptyState({ icon, title, description, action, testid, className }) {
  return (
    <div className={cn(STATE_PANEL, "py-16", className)} data-testid={testid}>
      {/* Decorative: the title carries the meaning, so the glyph is not read out. */}
      <div className="opacity-40 mb-4" aria-hidden="true">{icon}</div>
      <div className="text-sm text-foreground font-medium">{title}</div>
      {description && <div className="text-xs text-muted-foreground mt-1 max-w-md">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Loading state — "we do not know yet".
 *
 * Renders skeleton rows rather than a spinner so the panel keeps its shape and
 * does not jump when records arrive. Announced politely for screen readers.
 */
export function LoadingState({ label = "Loading", rows = 3, testid, className }) {
  return (
    <div
      className={cn(STATE_PANEL, "py-10", className)}
      data-testid={testid}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-md space-y-2.5" aria-hidden="true">
        {Array.from({ length: Math.max(1, Number(rows) || 1) }).map((_, index) => (
          <div key={index} className="h-9 w-full animate-pulse rounded-lg border border-border/60 bg-muted/40" />
        ))}
      </div>
      <div className="mt-4 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * Error state — "it broke, and here is the way out".
 *
 * Never renders an empty panel: a failed read that looks like an empty list is
 * the most expensive bug a service desk can ship, because the technician reads
 * it as "you have no tickets". `onRetry` is optional so a read-only surface can
 * explain the failure without inventing an action.
 */
export function ErrorState({ icon, title = "This view could not be loaded", description, error, onRetry, retryLabel = "Try again", testid, className }) {
  return (
    <div className={cn(STATE_PANEL, "py-16", className)} data-testid={testid} role="alert">
      {/* Decorative: `role="alert"` already announces the failure; a glyph would only
          add noise (or, with an icon-library title, a second copy of it). */}
      <div className="mb-4 opacity-60 text-rose-400" aria-hidden="true">{icon}</div>
      <div className="text-sm text-foreground font-medium">{title}</div>
      {description && <div className="text-xs text-muted-foreground mt-1 max-w-md">{description}</div>}
      {error && (
        <div className="mt-2 max-w-md font-mono text-[10px] text-muted-foreground/80 break-words">{error}</div>
      )}
      {onRetry && (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw className="mr-1.5 h-3.5 w-3.5" />
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Uppercase section label used repeatedly. */
export function MicroLabel({ children, className = "" }) {
  return <div className={`text-[10px] font-medium uppercase tracking-widest text-muted-foreground ${className}`}>{children}</div>;
}
