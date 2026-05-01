import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Sparkles, ChevronRight, Loader2, AlertTriangle, Users } from "lucide-react";

/**
 * Blueprint Insights — shows up to 3 "rising" cross-client patterns
 * (new this week OR surging vs last week). Each tile deep-links into
 * /blueprints?pattern=<key> so the user can generate a blueprint fast.
 */
export function BlueprintInsightsTile() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [rising, setRising] = useState([]);
  const [loading, setLoading] = useState(true);
  const [win, setWin] = useState({ this_total: 0, prev_total: 0 });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await axios.get(`${API}/blueprint-patterns/trends?days=7`, { headers });
        if (!mounted) return;
        setRising(res.data?.rising || []);
        setWin({ this_total: res.data?.this_total || 0, prev_total: res.data?.prev_total || 0 });
      } catch { /* silent */ }
      finally { mounted && setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [headers]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4" data-testid="blueprint-insights-tile">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-violet-400 mb-3">
          <TrendingUp className="w-3 h-3" /> Blueprint Insights
        </div>
        <div className="py-4 text-xs text-muted-foreground text-center">
          <Loader2 className="w-3 h-3 animate-spin inline mr-1" />Analysing this week's tickets…
        </div>
      </div>
    );
  }

  if (rising.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4" data-testid="blueprint-insights-tile">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          <TrendingUp className="w-3 h-3" /> Blueprint Insights
        </div>
        <div className="text-xs text-muted-foreground py-2">
          No rising patterns this week. Scanned <span className="font-mono text-zinc-400">{win.this_total}</span> resolved tickets.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 overflow-hidden" data-testid="blueprint-insights-tile">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-violet-500/20">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-violet-400">
          <TrendingUp className="w-3 h-3" /> Rising patterns this week
          <Badge variant="outline" className="text-[9px] text-violet-300 border-violet-500/30 bg-violet-500/10 ml-1">
            {rising.length}
          </Badge>
        </div>
        <Link to="/blueprints" className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-1">
          All patterns <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="divide-y divide-violet-500/10">
        {rising.map((p) => (
          <div key={p.key} className="px-4 py-2.5 flex items-center gap-3 hover:bg-violet-500/5 transition-colors" data-testid={`insight-${p.key}`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${p.is_new ? "bg-rose-500/10 border border-rose-500/30" : "bg-amber-500/10 border border-amber-500/30"}`}>
              {p.is_new ? <AlertTriangle className="w-3.5 h-3.5 text-rose-400" /> : <TrendingUp className="w-3.5 h-3.5 text-amber-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.name_guess}</span>
                {p.is_new ? (
                  <Badge variant="outline" className="text-[9px] text-rose-400 border-rose-500/30">NEW</Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/30">+{p.delta} vs last wk</Badge>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-3">
                <span>{p.ticket_count_this} tix</span>
                <span className="flex items-center gap-1"><Users className="w-2.5 h-2.5" />{p.client_count_this} client{p.client_count_this === 1 ? "" : "s"}</span>
                {p.sample_titles?.[0] && <span className="truncate italic">· {p.sample_titles[0].slice(0, 50)}</span>}
              </div>
            </div>
            <Link
              to={`/blueprints?pattern=${p.key}&t=${encodeURIComponent(p.tokens.join(","))}`}
              className="flex-shrink-0"
              data-testid={`insight-gen-${p.key}`}
            >
              <Button size="sm" variant="outline" className="h-7 text-[10px] text-violet-400 border-violet-500/30 hover:bg-violet-500/10">
                <Sparkles className="w-3 h-3 mr-1" />Draft
              </Button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
