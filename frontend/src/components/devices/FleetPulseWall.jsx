/* FleetPulseWall.jsx — glowing tile grid of every device. Cinematic.
   Drives off /api/devices/pulse. Hover = mini-card with sparklines. Click → device detail.
*/
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import Sparkline from "./Sparkline";
import StatusOrb from "./StatusOrb";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

function healthBg(h, status) {
  if (status === "offline") return "from-red-500/40 to-red-700/10 border-red-500/40";
  if (h >= 85) return "from-emerald-500/40 to-emerald-700/5 border-emerald-500/40";
  if (h >= 65) return "from-amber-400/40 to-amber-700/5 border-amber-500/40";
  return "from-red-500/40 to-red-700/10 border-red-500/40";
}

export default function FleetPulseWall({ filterStatus = "all", search = "", onCount }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    axios.get(`${API}/devices/pulse`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setTiles(r.data?.tiles || []); })
      .catch(() => { if (live) setTiles([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return tiles.filter(t => {
      if (filterStatus !== "all" && t.status !== filterStatus) return false;
      if (s && !(t.name || "").toLowerCase().includes(s) && !(t.client_name || "").toLowerCase().includes(s)) return false;
      return true;
    });
  }, [tiles, search, filterStatus]);

  useEffect(() => { if (onCount) onCount(filtered.length); }, [filtered.length, onCount]);

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Lighting up the fleet…</div>;
  if (filtered.length === 0) return <div className="py-12 text-center text-muted-foreground text-sm">No devices match your filters.</div>;

  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]" data-testid="fleet-pulse-wall">
      {filtered.map(t => {
        const bg = healthBg(t.health, t.status);
        const sizeScale = t.criticality === 3 ? "row-span-2" : "";
        return (
          <button
            key={t.id}
            onClick={() => navigate(`/devices/${t.id}`)}
            onMouseEnter={() => setHovered(t.id)}
            onMouseLeave={() => setHovered(null)}
            data-testid={`pulse-tile-${t.id}`}
            className={`relative group text-left p-3 rounded-xl border bg-gradient-to-br ${bg} ${sizeScale} transition-all duration-200 hover:scale-[1.03] hover:shadow-[0_0_20px_rgba(167,139,250,0.35)] focus:outline-none focus:ring-2 focus:ring-violet-500/60`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <StatusOrb status={t.status} size={8} />
                <p className="text-xs font-semibold truncate text-zinc-100">{t.name}</p>
              </div>
              <span className="text-[10px] font-mono text-zinc-400 flex-shrink-0">{t.health}</span>
            </div>
            <p className="text-[10px] text-zinc-400 truncate mb-2">{t.client_name || "—"}</p>
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkline data={t.cpu_spark || []} width={40} height={14} color={t.cpu > 80 ? "#ef4444" : t.cpu > 60 ? "#fbbf24" : "#a78bfa"} />
              <span className="text-[9px] font-mono text-zinc-500">CPU {Math.round(t.cpu)}%</span>
            </div>
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkline data={t.ram_spark || []} width={40} height={14} color={t.ram > 80 ? "#ef4444" : t.ram > 60 ? "#fbbf24" : "#34d399"} />
              <span className="text-[9px] font-mono text-zinc-500">RAM {Math.round(t.ram)}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Sparkline data={t.disk_spark || []} width={40} height={14} color={t.disk > 85 ? "#ef4444" : t.disk > 70 ? "#fbbf24" : "#22d3ee"} />
              <span className="text-[9px] font-mono text-zinc-500">DSK {Math.round(t.disk)}%</span>
            </div>
            {hovered === t.id && (
              <Card className="absolute z-30 left-full top-0 ml-2 w-56 p-2 bg-zinc-900/95 border-violet-500/40 shadow-xl text-xs pointer-events-none">
                <p className="font-semibold text-zinc-100">{t.name}</p>
                <p className="text-zinc-400 text-[10px] mt-0.5">{t.client_name} · {t.os}</p>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px]">
                  <div><p className="text-zinc-500">Health</p><p className="font-mono text-zinc-100">{t.health}</p></div>
                  <div><p className="text-zinc-500">Type</p><p className="text-zinc-100 capitalize">{t.type}</p></div>
                  <div><p className="text-zinc-500">Status</p><p className="text-zinc-100 capitalize">{t.status}</p></div>
                </div>
                {t.tags?.length > 0 && (
                  <p className="text-[10px] text-zinc-400 mt-1 truncate">tags: {t.tags.join(", ")}</p>
                )}
              </Card>
            )}
          </button>
        );
      })}
    </div>
  );
}
