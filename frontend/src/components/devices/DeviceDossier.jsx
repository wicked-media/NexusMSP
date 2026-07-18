/**
 * DeviceDossier — one-line health score + change timeline + lifecycle + failure risk
 * Embeds into DeviceDetailPage.
 */
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles, Heart, TrendingDown, AlertTriangle, RefreshCw, Loader2,
  Clock, Activity, ShieldCheck, Skull,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const BAND_TONE = {
  new: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  healthy: "text-cyan-300 border-cyan-500/40 bg-cyan-500/10",
  aging: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  eol: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  unknown: "text-zinc-300 border-zinc-500/40 bg-zinc-500/10",
};

const RISK_TONE = {
  minimal: "text-emerald-300",
  low: "text-cyan-300",
  moderate: "text-amber-300",
  high: "text-rose-300",
};

function HealthGauge({ score }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const tone = score >= 85 ? "#10b981" : score >= 65 ? "#06b6d4" : score >= 40 ? "#f59e0b" : "#f43f5e";
  return (
    <svg width="96" height="96" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r={r} stroke="rgba(255,255,255,0.06)" strokeWidth="8" fill="none" />
      <circle
        cx="48" cy="48" r={r}
        stroke={tone} strokeWidth="8" fill="none"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 48 48)"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text x="48" y="52" textAnchor="middle" fontSize="22" fontWeight="700" fill="#fff" fontFamily="monospace">{score}</text>
      <text x="48" y="68" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.4)" fontFamily="monospace">HEALTH</text>
    </svg>
  );
}

export default function DeviceDossier({ deviceId, headers, API }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/devices/${deviceId}/dossier`, { headers });
      setData(r.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
    // eslint-disable-next-line
  }, [deviceId, API]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <Card><CardContent className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></CardContent></Card>;
  }
  if (!data) return null;

  const { health_score, commentary, lifecycle, failure_risk, change_timeline = [] } = data;

  return (
    <Card className="border-violet-500/20 bg-gradient-to-br from-card via-card to-violet-500/[0.02]" data-testid="device-dossier">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />Intelligence Dossier
        </CardTitle>
        <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={load}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Health + lifecycle + risk row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-md border border-zinc-800 bg-zinc-900/40">
            <HealthGauge score={health_score} />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-mono text-zinc-500 flex items-center gap-1"><Heart className="w-3 h-3" />Health</div>
              <p className="text-xs text-zinc-200 mt-1 leading-snug">{commentary}</p>
            </div>
          </div>

          <div className="p-3 rounded-md border border-zinc-800 bg-zinc-900/40">
            <div className="text-[10px] uppercase tracking-widest font-mono text-zinc-500 flex items-center gap-1"><Clock className="w-3 h-3" />Lifecycle</div>
            <Badge variant="outline" className={`mt-2 text-[10px] uppercase ${BAND_TONE[lifecycle.band]}`}>{lifecycle.label}</Badge>
            <p className="text-[11px] text-zinc-400 font-mono mt-2">
              age: {lifecycle.age_years != null ? `${lifecycle.age_years}y` : "—"}
              {lifecycle.renewal_due && <span className="ml-2 text-rose-300">· renewal due</span>}
            </p>
          </div>

          <div className="p-3 rounded-md border border-zinc-800 bg-zinc-900/40">
            <div className="text-[10px] uppercase tracking-widest font-mono text-zinc-500 flex items-center gap-1">
              {failure_risk.verdict === "high" ? <Skull className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
              Failure Risk
            </div>
            <p className={`mt-1 text-2xl font-bold font-mono ${RISK_TONE[failure_risk.verdict]}`}>{failure_risk.risk_pct}%</p>
            <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">{failure_risk.verdict}</p>
            {failure_risk.factors.length > 0 && (
              <p className="text-[10px] text-zinc-500 mt-1 truncate" title={failure_risk.factors.join(", ")}>
                {failure_risk.factors.slice(0, 2).join(", ")}
                {failure_risk.factors.length > 2 && "…"}
              </p>
            )}
          </div>
        </div>

        {/* Recent operational evidence */}
        <div>
          <div className="text-[10px] uppercase tracking-widest font-mono text-zinc-500 flex items-center gap-1 mb-2">
            <Activity className="w-3 h-3" />Recent signals & changes (24h)
          </div>
          {change_timeline.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-800 px-4 py-4 text-center">
              <p className="text-xs text-zinc-400">No operational changes recorded in the last 24 hours.</p>
              <p className="mt-1 text-[10px] text-zinc-600">The next agent check-in, command, patch scan, or device change will appear here.</p>
            </div>
          ) : (
            <ScrollArea className="h-[200px] pr-2">
              <div className="relative pl-5">
                <div className="absolute left-1.5 top-0 bottom-0 w-px bg-zinc-800" />
                {change_timeline.map((e, i) => (
                  <div key={i} className="relative mb-2 group">
                    <div className="absolute -left-5 top-1.5 w-2 h-2 rounded-full bg-cyan-400 ring-2 ring-zinc-950" />
                    <div className="px-2 py-1.5 rounded border border-zinc-800 bg-zinc-900/40 group-hover:border-zinc-600 transition-colors">
                      <div className="text-xs">{e.title}</div>
                      <div className="text-[10px] text-zinc-500 font-mono">
                        {e.by ? `${e.by} · ` : ""}
                        {e.ts ? formatDistanceToNow(new Date(e.ts), { addSuffix: true }) : "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
