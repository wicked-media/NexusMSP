/* ForecastWidget.jsx — weighted pipeline by close-date bucket. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import { CalendarRange, Loader2, TrendingUp } from "lucide-react";
import { money } from "./leadHelpers";

export default function ForecastWidget() {
  const { token } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    axios.get(`${API}/lead-studio/forecast`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data || null)).catch(() => setData(null));
  }, [token]);

  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Computing forecast…</Card>;

  const buckets = [
    { key: "this_month", label: "This month" },
    { key: "next_30d", label: "Next 30 days" },
    { key: "next_90d", label: "Next 90 days" },
    { key: "later", label: "Later" },
  ];
  const maxWeighted = Math.max(...buckets.map((bucket) => Number(data.weighted[bucket.key]) || 0), 1);
  return (
    <Card className="overflow-hidden border-white/[0.08] bg-zinc-950/45 shadow-[0_16px_40px_rgba(0,0,0,0.16)]" data-testid="forecast-widget">
      <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.07]">
          <TrendingUp className="h-4 w-4 text-violet-300" />
        </span>
        <div>
          <p className="text-sm font-semibold text-zinc-100">Forecast horizon</p>
          <p className="mt-0.5 text-[10px] text-zinc-500">Probability-weighted revenue by expected close window.</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-[9px] uppercase tracking-[0.16em] text-zinc-600">Weighted total</p>
          <p className="mt-0.5 font-mono text-base font-semibold text-emerald-200">{money(data.total_weighted)}</p>
        </div>
      </div>
      <div className="grid gap-px bg-white/[0.06] sm:grid-cols-2 xl:grid-cols-4">
        {buckets.map(b => (
          <div key={b.key} className="bg-zinc-950/90 p-4" data-testid={`forecast-bucket-${b.key}`}>
            <div className="flex items-center gap-1.5 text-zinc-500">
              <CalendarRange className="h-3 w-3" />
              <p className="text-[9px] font-semibold uppercase tracking-[0.15em]">{b.label}</p>
            </div>
            <p className="mt-2 font-mono text-base font-semibold text-zinc-100">{money(data.weighted[b.key])}</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.05]">
              <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-emerald-300" style={{ width: `${((Number(data.weighted[b.key]) || 0) / maxWeighted) * 100}%` }} />
            </div>
            <p className="mt-2 text-[9px] text-zinc-600">{money(data.raw[b.key])} unweighted</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
