/* ForecastWidget.jsx — weighted pipeline by close-date bucket. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import { TrendingUp, Loader2 } from "lucide-react";
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
    { key: "this_month", label: "This Month" },
    { key: "next_30d", label: "Next 30d" },
    { key: "next_90d", label: "Next 90d" },
    { key: "later", label: "Later" },
  ];
  return (
    <Card className="p-3 bg-gradient-to-br from-violet-500/10 to-emerald-500/5 border-violet-500/30" data-testid="forecast-widget">
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="w-3.5 h-3.5 text-emerald-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-200">Weighted Forecast</p>
        <span className="ml-auto text-[10px] font-mono text-emerald-300">{money(data.total_weighted)}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {buckets.map(b => (
          <div key={b.key} className="text-center bg-zinc-900/40 rounded p-1.5" data-testid={`forecast-bucket-${b.key}`}>
            <p className="text-[9px] text-zinc-500 uppercase tracking-wider">{b.label}</p>
            <p className="text-sm font-mono font-semibold text-zinc-100 mt-0.5">{money(data.weighted[b.key])}</p>
            <p className="text-[9px] text-zinc-500 mt-0.5">raw {money(data.raw[b.key])}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
