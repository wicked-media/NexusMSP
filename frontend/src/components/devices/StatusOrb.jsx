/* StatusOrb.jsx — animated status orb. Replaces flat pills. */
export default function StatusOrb({ status, size = 10 }) {
  const map = {
    online: { color: "bg-emerald-500", glow: "shadow-[0_0_8px_rgba(16,185,129,0.7)]", pulse: true },
    offline: { color: "bg-red-500", glow: "shadow-[0_0_6px_rgba(239,68,68,0.55)]", pulse: false },
    warning: { color: "bg-amber-400", glow: "shadow-[0_0_8px_rgba(251,191,36,0.7)]", pulse: true },
    unknown: { color: "bg-zinc-500", glow: "", pulse: false },
  };
  const s = map[status] || map.unknown;
  return (
    <span
      className={`inline-block rounded-full relative ${s.color} ${s.glow}`}
      style={{ width: size, height: size }}
      aria-label={`status-${status}`}
      data-testid={`status-orb-${status}`}
    >
      {s.pulse && (
        <span className={`absolute inset-0 rounded-full ${s.color} opacity-60 animate-ping`} />
      )}
    </span>
  );
}
