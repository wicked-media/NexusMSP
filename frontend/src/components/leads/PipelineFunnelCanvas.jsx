/* PipelineFunnelCanvas.jsx — animated SVG funnel of pipeline stages. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Loader2 } from "lucide-react";
import { STATUS_CONFIG, money } from "./leadHelpers";

export default function PipelineFunnelCanvas({ onStageClick }) {
  const { token } = useAuth();
  const [data, setData] = useState({ funnel: [], lost: 0, overall_win_rate: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    axios.get(`${API}/lead-studio/conversion-funnel`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setData(r.data || { funnel: [] }); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);

  if (loading) return <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Building pipeline funnel…</div>;
  if (data.funnel.length === 0) return <div className="py-12 text-center text-muted-foreground text-sm">No leads in pipeline yet.</div>;

  const maxCount = Math.max(...data.funnel.map(f => f.in_funnel || 1), 1);
  return (
    <div className="space-y-4" data-testid="pipeline-funnel-canvas">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="In Pipeline" value={data.funnel[0]?.in_funnel || 0} hue="violet" />
        <Stat label="Pipeline $" value={money(data.funnel.reduce((s, f) => s + (f.stage !== "won" && f.stage !== "lost" ? f.value : 0), 0))} hue="emerald" />
        <Stat label="Win Rate" value={`${data.overall_win_rate}%`} hue="orange" />
        <Stat label="Lost" value={data.lost} hue="red" />
      </div>
      <div className="space-y-1.5">
        {data.funnel.map((row, i) => {
          const cfg = STATUS_CONFIG[row.stage] || STATUS_CONFIG.new;
          const widthPct = Math.max(8, (row.in_funnel / maxCount) * 100);
          const trapezoidId = `funnel-${row.stage}`;
          return (
            <button
              key={row.stage}
              onClick={() => onStageClick && onStageClick(row.stage)}
              className="block w-full group focus:outline-none"
              data-testid={`funnel-stage-${row.stage}`}
            >
              <div className="flex items-center gap-3 mb-0.5">
                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${cfg.pill}`}>{cfg.label}</span>
                <span className="text-[11px] text-zinc-400">{row.in_funnel} leads · {money(row.value)} · prob {Math.round(row.probability * 100)}%</span>
              </div>
              <div className="relative h-10 bg-zinc-900/40 border border-zinc-800/40 rounded overflow-hidden">
                <div
                  id={trapezoidId}
                  className="absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all duration-700 ease-out group-hover:brightness-125"
                  style={{
                    width: `${widthPct}%`,
                    background: `linear-gradient(90deg, transparent 0%, ${cfg.hex}aa 20%, ${cfg.hex} 50%, ${cfg.hex}aa 80%, transparent 100%)`,
                    clipPath: i < data.funnel.length - 1 ? `polygon(2% 0, 98% 0, 92% 100%, 8% 100%)` : `polygon(8% 0, 92% 0, 92% 100%, 8% 100%)`,
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="font-mono font-semibold text-zinc-100 text-lg drop-shadow">{row.count}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, hue }) {
  const cmap = {
    violet: "bg-violet-500/10 border-violet-500/30 text-violet-300",
    emerald: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    orange: "bg-orange-500/10 border-orange-500/30 text-orange-300",
    red: "bg-red-500/10 border-red-500/30 text-red-300",
  };
  return (
    <div className={`p-2.5 rounded border ${cmap[hue]}`} data-testid={`funnel-stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-lg font-mono font-semibold mt-0.5">{value}</p>
    </div>
  );
}
