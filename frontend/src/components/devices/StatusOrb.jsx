/* StatusOrb.jsx — animated status orb. Replaces flat pills. */
export default function StatusOrb({ status, size = 10 }) {
  const map = {
    online: { color: "bg-emerald-500 text-emerald-500", glow: "shadow-[0_0_7px_rgba(16,185,129,0.48)]", ambient: true },
    offline: { color: "bg-zinc-500 text-zinc-500", glow: "", ambient: false },
    warning: { color: "bg-amber-400 text-amber-400", glow: "shadow-[0_0_8px_rgba(251,191,36,0.52)]", ambient: true },
    critical: { color: "bg-rose-500 text-rose-500", glow: "shadow-[0_0_8px_rgba(244,63,94,0.6)]", ambient: true },
    error: { color: "bg-rose-500 text-rose-500", glow: "shadow-[0_0_8px_rgba(244,63,94,0.6)]", ambient: true },
    unknown: { color: "bg-zinc-500 text-zinc-500", glow: "", ambient: false },
  };
  const s = map[status] || map.unknown;
  return (
    <span
      className={`nx-status-orb inline-block rounded-full ${s.color} ${s.glow}`}
      style={{ width: size, height: size }}
      data-status={status || "unknown"}
      aria-label={`status-${status}`}
      data-testid={`status-orb-${status}`}
    >
      {s.ambient && (
        <span className="nx-status-orb__wave" aria-hidden="true" />
      )}
    </span>
  );
}
