import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, CheckCircle, XCircle, RefreshCw, Loader2, Lock, Unlock, MessageSquare, UserPlus } from "lucide-react";

const ACTION_ICON = {
  close: <CheckCircle className="w-3 h-3 text-emerald-400" />,
  resolve: <CheckCircle className="w-3 h-3 text-emerald-400" />,
  acknowledge: <CheckCircle className="w-3 h-3 text-sky-400" />,
  comment: <MessageSquare className="w-3 h-3 text-violet-400" />,
  assign: <UserPlus className="w-3 h-3 text-indigo-400" />,
  isolate: <Lock className="w-3 h-3 text-rose-400" />,
  release: <Unlock className="w-3 h-3 text-emerald-400" />,
};

/**
 * Response Timeline — audit trail of Huntress actions attempted from this platform.
 * Shows who / what / when / success-or-rejection, powered by GET /api/huntress/actions.
 */
export function ResponseTimeline({ limit = 20 }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/huntress/actions?limit=${limit}`, { headers });
      setRows(res.data || []);
    } catch {
      setRows([]);
    } finally { setLoading(false); }
  }, [token, limit]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  return (
    <Card data-testid="response-timeline">
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="w-4 h-4 text-indigo-400" />Response Timeline
            <span className="text-[10px] text-muted-foreground font-mono">last {rows.length} actions</span>
          </div>
          <Button variant="ghost" size="sm" onClick={load} data-testid="response-timeline-refresh">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading timeline…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">
              No response actions yet — incident actions on the dashboard will appear here
            </div>
          ) : rows.map((r, idx) => {
            const ok = r.result?.success;
            const target = r.incident_id ? `incident ${r.incident_id}` : r.agent_id ? `agent ${r.agent_id}` : "—";
            const msg = r.result?.message || "";
            return (
              <div key={`${r.timestamp}-${idx}`} className="px-5 py-2 border-b border-border last:border-0 flex items-start gap-3" data-testid={`response-row-${idx}`}>
                <div className="mt-1">{ACTION_ICON[r.action] || <Activity className="w-3 h-3 text-zinc-400" />}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="capitalize font-medium">{r.action}</span>
                    <span className="text-muted-foreground">on {target}</span>
                    {ok ? (
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">accepted</Badge>
                    ) : (
                      <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-[10px]">rejected</Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {r.by || "—"} · {r.timestamp ? new Date(r.timestamp).toLocaleString() : "—"}
                  </div>
                  {!ok && msg && (
                    <div className="text-[10px] text-rose-400 mt-0.5 truncate" title={msg}>
                      {String(msg).slice(0, 160)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
