/* PipelineFunnelCanvas.jsx — clear, action-oriented stage progression. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { ArrowRight, Loader2, Route, Trophy } from "lucide-react";
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

  const maxCount = Math.max(...data.funnel.map(f => f.in_funnel || 0), 1);
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-950/45 shadow-[0_16px_40px_rgba(0,0,0,0.16)]" data-testid="pipeline-funnel-canvas">
      <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07]">
            <Route className="h-4 w-4 text-emerald-300" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Conversion path</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">Select a stage to review every opportunity currently inside it.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.05] px-2.5 py-1 text-[10px] text-zinc-400">
            Win rate <strong className="ml-1 font-mono text-emerald-200">{data.overall_win_rate}%</strong>
          </span>
          <span className="rounded-lg border border-red-400/15 bg-red-400/[0.04] px-2.5 py-1 text-[10px] text-zinc-400">
            Lost <strong className="ml-1 font-mono text-red-200">{data.lost}</strong>
          </span>
        </div>
      </div>
      <div className="grid gap-px bg-white/[0.06] sm:grid-cols-2 xl:grid-cols-3">
        {data.funnel.map((row, i) => {
          const cfg = STATUS_CONFIG[row.stage] || STATUS_CONFIG.new;
          const widthPct = Math.max(row.in_funnel ? 6 : 0, (row.in_funnel / maxCount) * 100);
          return (
            <button
              key={row.stage}
              onClick={() => onStageClick && onStageClick(row.stage)}
              className="group relative min-w-0 bg-zinc-950/90 p-4 text-left transition-colors hover:bg-white/[0.025] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              data-testid={`funnel-stage-${row.stage}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${cfg.orb}`} />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">{cfg.label}</span>
                </div>
                {i < data.funnel.length - 1 ? <ArrowRight className="h-3.5 w-3.5 text-zinc-700 transition-transform group-hover:translate-x-0.5" /> : <Trophy className="h-3.5 w-3.5 text-emerald-300/70" />}
              </div>
              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <p className="text-2xl font-semibold tracking-tight text-zinc-100">{row.count}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-600">{row.in_funnel} still in path</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-zinc-200">{money(row.value)}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-600">{Math.round(row.probability * 100)}% probability</p>
                </div>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${widthPct}%`, backgroundColor: cfg.hex }} />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
