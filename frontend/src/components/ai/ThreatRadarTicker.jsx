import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { ShieldAlert, AlertTriangle, TrendingUp } from "lucide-react";

const SEV_COLOR = {
  critical: "text-rose-400",
  high: "text-amber-400",
  medium: "text-sky-400",
  low: "text-emerald-400",
};

const KIND_ICON = { huntress: ShieldAlert, alert: AlertTriangle, pattern: TrendingUp, identity: ShieldAlert };

export function ThreatRadarTicker() {
  const { token } = useAuth();
  const [items, setItems] = useState([]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const r = await axios.get(`${API}/threat-radar`, { headers: { Authorization: `Bearer ${token}` } });
        if (mounted) setItems(r.data?.items || []);
      } catch { /* silent */ }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { mounted = false; clearInterval(t); };
  }, [token]);

  if (items.length === 0) return null;

  // duplicate items to enable seamless looping
  const stream = [...items, ...items];

  return (
    <div className="border-y border-rose-500/20 bg-rose-500/5 overflow-hidden" data-testid="threat-radar-ticker">
      <div className="flex items-center">
        <div className="flex-shrink-0 px-3 py-1.5 bg-rose-500/15 border-r border-rose-500/20">
          <div className="text-[9px] uppercase tracking-widest text-rose-400 font-bold flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" /> Threat Radar
          </div>
        </div>
        <div className="flex-1 overflow-hidden relative">
          <div className="flex animate-marquee whitespace-nowrap py-1.5">
            {stream.map((it, i) => {
              const Icon = KIND_ICON[it.kind] || AlertTriangle;
              return (
                <div key={`${i}-${it.title}`} className="flex items-center gap-2 px-4 text-[11px]" data-testid={`radar-item-${i % items.length}`}>
                  <Icon className={`w-3 h-3 ${SEV_COLOR[it.severity] || "text-zinc-400"}`} />
                  <span className={`font-medium ${SEV_COLOR[it.severity] || ""}`}>[{(it.severity || "info").toUpperCase()}]</span>
                  <span>{it.title}</span>
                  {it.client && <span className="text-muted-foreground">· {it.client}</span>}
                  {it.kind === "pattern" && it.tokens && (
                    <Link to={`/blueprints?pattern=${it.tokens.join("_")}&t=${it.tokens.join(",")}`} className="text-violet-400 hover:underline">→ Draft Blueprint</Link>
                  )}
                  <span className="text-muted-foreground">·</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .animate-marquee { animation: marquee 90s linear infinite; }
      `}</style>
    </div>
  );
}
