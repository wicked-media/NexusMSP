/* ClientPulseWall.jsx — cinematic glowing tiles for every client. */
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import Sparkline from "../devices/Sparkline";
import { Loader2, Crown, Award, Gem, Shield } from "lucide-react";
import { healthColor, moneyShort, tierMeta } from "./clientStudioHelpers";
import { getServiceTierVisual } from "@/lib/serviceTierVisuals";

export default function ClientPulseWall({ search = "", tierFilter = "all" }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    axios.get(`${API}/client-studio/pulse`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setTiles(r.data?.tiles || []); })
      .catch(() => { if (live) setTiles([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return tiles.filter(t => {
      if (tierFilter !== "all" && t.tier !== tierFilter) return false;
      if (s && !(t.name || "").toLowerCase().includes(s) && !(t.industry || "").toLowerCase().includes(s)) return false;
      return true;
    });
  }, [tiles, search, tierFilter]);

  if (loading) return <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Lighting up the client universe…</div>;
  if (filtered.length === 0) return <div className="py-12 text-center text-muted-foreground text-sm">No clients match.</div>;

  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(190px,1fr))]" data-testid="client-pulse-wall">
      {filtered.map(t => {
        const m = tierMeta(t.tier);
        const TierIcon = { award: Award, crown: Crown, gem: Gem, shield: Shield }[m.icon] || Shield;
        const tierVisual = getServiceTierVisual({ slug: t.tier, name: m.label });
        const assessed = Number.isFinite(t.health);
        const isHealthy = assessed && t.health >= 80;
        const bg = t.vip
          ? "from-yellow-500/30 to-amber-700/10 border-yellow-500/50"
          : isHealthy ? "from-emerald-500/30 to-emerald-700/5 border-emerald-500/40"
          : assessed && t.health >= 60 ? "from-amber-400/30 to-amber-700/5 border-amber-500/40"
          : assessed ? "from-red-500/30 to-red-700/10 border-red-500/40"
          : "from-slate-500/20 to-slate-700/5 border-slate-500/40";
        return (
          <button
            key={t.id}
            onClick={() => navigate(`/clients/${t.id}`)}
            data-testid={`client-pulse-tile-${t.id}`}
            className={`group text-left p-3 rounded-xl border bg-gradient-to-br ${bg} transition-all duration-200 hover:scale-[1.025] hover:shadow-[0_0_24px_rgba(167,139,250,0.35)] focus:outline-none focus:ring-2 focus:ring-violet-500/60`}
          >
            <div className="flex items-start justify-between mb-1.5 gap-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border bg-black/10" style={{ color: tierVisual.color, borderColor: `${tierVisual.color}55` }}><TierIcon className="h-3.5 w-3.5" /></span>
                <p className="text-xs font-semibold text-zinc-100 truncate">{t.name}</p>
              </div>
              {t.vip && <Crown className="w-3 h-3 text-yellow-300 flex-shrink-0" />}
            </div>
            <p className="text-[10px] text-zinc-400 truncate mb-2">{t.industry || "—"}</p>
            <div className="flex items-center gap-2 mb-1.5">
              {(t.spark_health || []).length > 1 ? <Sparkline data={t.spark_health} width={70} height={16} color={healthColor(t.health)} /> : <div className="h-4 w-[70px] rounded bg-zinc-800/70" />}
              <span className="text-[10px] font-mono text-zinc-300">{assessed ? t.health : "Not assessed"}</span>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
              <div className="bg-zinc-950/40 rounded py-0.5">
                <p className="font-mono text-zinc-100">{moneyShort(t.mrr)}</p>
                <p className="text-[8px] text-zinc-500 uppercase">mrr</p>
              </div>
              <div className="bg-zinc-950/40 rounded py-0.5">
                <p className="font-mono text-zinc-100">{t.devices}</p>
                <p className="text-[8px] text-zinc-500 uppercase">devices</p>
              </div>
              <div className="bg-zinc-950/40 rounded py-0.5">
                <p className="font-mono text-zinc-100">{t.open_tickets}</p>
                <p className="text-[8px] text-zinc-500 uppercase">open</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
