/* ClientUniverseMap.jsx — D3-free force-ish layout. Polar by industry, radius by MRR rank. */
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Loader2, Crown } from "lucide-react";
import { healthColor, moneyShort, tierMeta } from "./clientStudioHelpers";

export default function ClientUniverseMap() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [nodes, setNodes] = useState([]);
  const [industries, setIndustries] = useState([]);
  const [hovered, setHovered] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    axios.get(`${API}/client-studio/universe`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) { setNodes(r.data?.nodes || []); setIndustries(r.data?.industries || []); } })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);

  const positioned = useMemo(() => {
    if (industries.length === 0) return [];
    const cx = 380, cy = 280, ringR = 220;
    const indCount = industries.length;
    return nodes.map((n, i) => {
      const indIdx = Math.max(0, industries.indexOf(n.industry || "other"));
      const angle = (indIdx / indCount) * Math.PI * 2 + ((i * 53) % 360) * (Math.PI / 180) / 18;
      const r = 80 + ((i % 8) * 16);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r * 0.85;
      const size = Math.max(8, Math.min(28, 8 + Math.sqrt(n.mrr / 200)));
      return { ...n, x, y, size };
    });
  }, [nodes, industries]);

  if (loading) return <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Mapping the universe…</div>;
  if (nodes.length === 0) return <div className="py-12 text-center text-muted-foreground text-sm">No clients to map.</div>;

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-gradient-to-br from-zinc-950 to-zinc-900 border border-zinc-800/60" style={{ height: 560 }} data-testid="client-universe-map">
      <svg viewBox="0 0 760 560" className="w-full h-full">
        <defs>
          <radialGradient id="bg-glow">
            <stop offset="0%" stopColor="rgba(139,92,246,0.18)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        <rect width="760" height="560" fill="url(#bg-glow)" />
        {industries.map((ind, i) => {
          const cx = 380, cy = 280;
          const angle = (i / industries.length) * Math.PI * 2;
          const lx = cx + Math.cos(angle) * 250;
          const ly = cy + Math.sin(angle) * 215;
          return <text key={ind} x={lx} y={ly} fontSize="9" fill="#71717a" textAnchor="middle" className="capitalize">{ind}</text>;
        })}
        {positioned.map(n => {
          const isHover = hovered === n.id;
          return (
            <g key={n.id} onMouseEnter={() => setHovered(n.id)} onMouseLeave={() => setHovered(null)} onClick={() => navigate(`/clients/${n.id}`)} style={{ cursor: "pointer" }} data-testid={`universe-node-${n.id}`}>
              <circle cx={n.x} cy={n.y} r={n.size + 4} fill={healthColor(n.health)} opacity={isHover ? 0.5 : 0.15} className="transition-all" />
              <circle cx={n.x} cy={n.y} r={n.size} fill={healthColor(n.health)} opacity={0.9} stroke={n.vip ? "#fde047" : "#18181b"} strokeWidth={n.vip ? 2 : 1} />
              {isHover && (
                <text x={n.x} y={n.y - n.size - 4} fontSize="10" fill="#e4e4e7" textAnchor="middle" fontWeight="600">{n.name}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (() => {
        const n = positioned.find(p => p.id === hovered);
        if (!n) return null;
        const m = tierMeta(n.tier);
        return (
          <div className="absolute bottom-3 left-3 right-3 bg-zinc-900/95 border border-violet-500/40 rounded-lg p-2.5 flex items-center gap-3 pointer-events-none">
            <span className="text-2xl leading-none">{m.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-100 truncate flex items-center gap-1.5">
                {n.name} {n.vip && <Crown className="w-3 h-3 text-yellow-300" />}
              </p>
              <p className="text-[10px] text-zinc-400">{n.industry} · {m.label}</p>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
              <div><p className="text-zinc-500">MRR</p><p className="text-zinc-100 font-mono">{moneyShort(n.mrr)}</p></div>
              <div><p className="text-zinc-500">Health</p><p className="font-mono" style={{ color: healthColor(n.health) }}>{n.health}</p></div>
              <div><p className="text-zinc-500">Devices</p><p className="text-zinc-100 font-mono">{n.devices}</p></div>
              <div><p className="text-zinc-500">Tickets</p><p className="text-zinc-100 font-mono">{n.open_tickets}</p></div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
