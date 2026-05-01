import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { AlertTriangle, Flame, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const BAND_TONE = {
  critical: "border-rose-500/30 bg-rose-500/5 text-rose-400",
  high: "border-amber-500/30 bg-amber-500/5 text-amber-400",
  medium: "border-sky-500/30 bg-sky-500/5 text-sky-400",
  low: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
};

/** Dashboard tile: top at-risk clients with churn score, driver, save-action. */
export function ChurnRiskTile() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [loading, setLoading] = useState(true);
  const [top, setTop] = useState([]);

  useEffect(() => {
    let m = true;
    axios.get(`${API}/churn-risk/overview`, { headers })
      .then((r) => { if (m) setTop((r.data?.top || []).filter((c) => c.score >= 25).slice(0, 5)); })
      .catch(() => {})
      .finally(() => m && setLoading(false));
    return () => { m = false; };
  }, [headers]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4" data-testid="churn-risk-tile">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-rose-400 mb-2">
          <Flame className="w-3 h-3" /> Churn Risk Radar
        </div>
        <div className="py-4 text-xs text-muted-foreground text-center"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Scoring clients…</div>
      </div>
    );
  }

  if (top.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4" data-testid="churn-risk-tile">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-emerald-400 mb-2">
          <Flame className="w-3 h-3" /> Churn Risk Radar
        </div>
        <div className="text-xs text-emerald-300">No clients above medium-risk threshold. Nice work.</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 overflow-hidden" data-testid="churn-risk-tile">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-rose-500/20">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-rose-400">
          <Flame className="w-3 h-3" /> Churn Risk Radar
          <Badge variant="outline" className="text-[9px] text-rose-300 border-rose-500/30 bg-rose-500/10 ml-1">{top.length} at risk</Badge>
        </div>
        <Link to="/clients" className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1">All clients <ChevronRight className="w-3 h-3" /></Link>
      </div>
      <div className="divide-y divide-rose-500/10">
        {top.map((c) => (
          <Link key={c.client_id} to={`/clients?clientId=${c.client_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-rose-500/5 transition-colors" data-testid={`churn-row-${c.client_id}`}>
            <div className={`w-11 rounded-md border ${BAND_TONE[c.band] || BAND_TONE.low} py-1 text-center font-mono font-bold`}>{c.score}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate flex items-center gap-2">
                {c.client_name}
                <Badge variant="outline" className={`text-[9px] ${BAND_TONE[c.band] || ""}`}>{(c.band || "").toUpperCase()}</Badge>
              </div>
              <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" /> {c.top_driver || "—"}
              </div>
            </div>
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
