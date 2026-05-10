import { useEffect, useState } from "react";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Timer, AlertTriangle } from "lucide-react";
import { API } from "@/App";

/** Burn-down bar: elapsed vs SLA target with breach highlight. */
export default function TicketBurndownBar({ ticketId, headers }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!ticketId) return;
    let alive = true;
    const fetch = async () => {
      try {
        const r = await axios.get(`${API}/tickets/${ticketId}/burndown`, { headers });
        if (alive) setData(r.data);
      } catch { /* ignore */ }
    };
    fetch();
    const t = setInterval(fetch, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [ticketId, headers]);

  if (!data || !data.available) return null;

  const fmtMin = (m) => {
    if (m == null) return "—";
    if (m < 60) return `${m}m`;
    if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  };
  const tone = data.breach ? "from-rose-500 to-pink-500" : data.pct > 75 ? "from-amber-500 to-orange-500" : "from-emerald-500 to-teal-500";

  return (
    <Card data-testid="ticket-burndown" className="border-violet-500/15">
      <CardContent className="pt-3 pb-3 space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground flex items-center gap-1"><Timer className="w-3 h-3" />SLA Burn-down</span>
          {data.breach ? (
            <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30 text-[10px]"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />Breached</Badge>
          ) : data.is_resolved ? (
            <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[10px]">Resolved</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">{data.pct}%</Badge>
          )}
        </div>
        <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
          <div className={`h-full rounded-full bg-gradient-to-r ${tone} transition-all`} style={{ width: `${Math.min(100, data.pct)}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Elapsed {fmtMin(data.elapsed_min)}</span>
          {data.target_min ? <span>Target {fmtMin(data.target_min)}</span> : <span className="italic">No SLA target</span>}
        </div>
      </CardContent>
    </Card>
  );
}
