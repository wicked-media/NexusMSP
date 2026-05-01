import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle, ChevronRight, Loader2 } from "lucide-react";

/** Dashboard tile — predictive SLA breach radar. */
export function SLARadarTile() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [items, setItems] = useState([]);
  const [danger, setDanger] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let m = true;
    axios.get(`${API}/sla-radar`, { headers })
      .then((r) => { if (m) { setItems(r.data?.at_risk || []); setDanger(r.data?.danger_zone_count || 0); } })
      .catch(() => {})
      .finally(() => m && setLoading(false));
    return () => { m = false; };
  }, [headers]);

  if (loading) {
    return <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4" data-testid="sla-radar-tile">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-amber-400"><Clock className="w-3 h-3" />SLA Breach Radar</div>
      <div className="text-xs text-muted-foreground py-3 text-center"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Scoring open tickets…</div>
    </div>;
  }

  if (items.length === 0) {
    return <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4" data-testid="sla-radar-tile">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-emerald-400"><Clock className="w-3 h-3" />SLA Breach Radar</div>
      <div className="text-xs text-emerald-300 mt-1">Nothing at risk of breaching. All clear.</div>
    </div>;
  }

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 overflow-hidden" data-testid="sla-radar-tile">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-amber-500/20">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-amber-400">
          <Clock className="w-3 h-3" /> SLA Breach Radar
          <Badge variant="outline" className="text-[9px] text-amber-300 border-amber-500/30 bg-amber-500/10 ml-1">{items.length} at risk</Badge>
          {danger > 0 && <Badge variant="outline" className="text-[9px] text-rose-400 border-rose-500/30 ml-1"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />{danger} danger zone</Badge>}
        </div>
        <Link to="/tickets" className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1">All tickets <ChevronRight className="w-3 h-3" /></Link>
      </div>
      <div className="divide-y divide-amber-500/10 max-h-72 overflow-y-auto">
        {items.slice(0, 6).map((t) => (
          <div key={t.ticket_id} className="flex items-center gap-3 px-4 py-2 hover:bg-amber-500/5 text-xs" data-testid={`sla-row-${t.ticket_id}`}>
            <div className={`w-11 py-1 rounded text-center font-mono font-bold ${t.score >= 80 ? "bg-rose-500/10 border border-rose-500/30 text-rose-400" : "bg-amber-500/10 border border-amber-500/30 text-amber-400"}`}>{t.score}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-muted-foreground">#{t.ticket_number}</span>
                <span className="font-medium truncate">{t.title}</span>
              </div>
              <div className="text-[10px] text-muted-foreground truncate">{t.client_name} · {t.assignee_name || "unassigned"} · {t.reasons.filter(Boolean).join(" · ")}</div>
            </div>
            <div className="text-right text-[10px]">
              <div className={t.minutes_to_breach < 120 ? "text-rose-400 font-bold" : "text-amber-400"}>{t.minutes_to_breach}m</div>
              <div className="text-muted-foreground">to breach</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
