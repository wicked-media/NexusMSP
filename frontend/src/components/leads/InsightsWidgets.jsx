/* VelocityMeter + SourceAttributionPie — Insights tab components. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import { Gauge, PieChart as PieIcon, Loader2 } from "lucide-react";
import { STATUS_CONFIG, money } from "./leadHelpers";

export function VelocityMeter() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    axios.get(`${API}/lead-studio/velocity`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData(null));
  }, [token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Computing velocity…</Card>;
  const max = Math.max(...(data.velocity || []).map(v => v.avg_days), 1);
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="velocity-meter">
      <div className="flex items-center gap-2 mb-2">
        <Gauge className="w-3.5 h-3.5 text-amber-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Stage Velocity (avg days)</p>
      </div>
      <div className="space-y-1.5">
        {(data.velocity || []).map(v => {
          const cfg = STATUS_CONFIG[v.stage] || STATUS_CONFIG.new;
          return (
            <div key={v.stage} data-testid={`velocity-row-${v.stage}`}>
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className={`px-1.5 py-0.5 rounded ${cfg.pill} text-[9px] uppercase tracking-wider`}>{cfg.label}</span>
                <span className="font-mono text-zinc-300">{v.avg_days}d</span>
              </div>
              <div className="h-1 rounded bg-zinc-800 overflow-hidden">
                <div className="h-full transition-all" style={{ width: `${(v.avg_days / max) * 100}%`, background: cfg.hex }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function SourceAttributionPie() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    axios.get(`${API}/lead-studio/source-attribution`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData(null));
  }, [token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Loading sources…</Card>;
  const colors = ["#a78bfa", "#34d399", "#22d3ee", "#fbbf24", "#f472b6", "#60a5fa", "#fb923c"];
  const total = (data.sources || []).reduce((s, x) => s + x.leads, 0) || 1;
  let acc = 0;
  const segments = (data.sources || []).map((s, i) => {
    const start = (acc / total) * 360;
    acc += s.leads;
    const end = (acc / total) * 360;
    return { ...s, start, end, color: colors[i % colors.length] };
  });
  // Build conic-gradient string
  const conic = segments.map(s => `${s.color} ${s.start}deg ${s.end}deg`).join(", ");
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="source-attribution-pie">
      <div className="flex items-center gap-2 mb-3">
        <PieIcon className="w-3.5 h-3.5 text-violet-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Source Attribution</p>
      </div>
      <div className="flex items-center gap-4">
        <div
          className="rounded-full shadow-inner flex-shrink-0"
          style={{ width: 100, height: 100, background: `conic-gradient(${conic})` }}
          data-testid="source-pie-svg"
        />
        <div className="flex-1 space-y-1">
          {segments.map(s => (
            <div key={s.source} className="flex items-center text-[10px] gap-2" data-testid={`source-row-${s.source}`}>
              <span className="w-2.5 h-2.5 rounded" style={{ background: s.color }} />
              <span className="flex-1 capitalize text-zinc-300 truncate">{s.source.replace('_', ' ')}</span>
              <span className="font-mono text-zinc-400">{s.leads}</span>
              <span className="font-mono text-emerald-300 w-14 text-right">{money(s.value_won)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
