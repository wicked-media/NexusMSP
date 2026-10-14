/**
 * Health score, lifecycle evidence, and recent device signals.
 */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Activity, Clock, Heart, Loader2, RefreshCw, ShieldCheck, Skull, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

const BAND_TONE = {
  new: "text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  healthy: "text-cyan-700 dark:text-cyan-300 border-cyan-500/40 bg-cyan-500/10",
  aging: "text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10",
  eol: "text-rose-700 dark:text-rose-300 border-rose-500/40 bg-rose-500/10",
  unknown: "text-zinc-700 dark:text-zinc-300 border-zinc-500/40 bg-zinc-500/10",
};

const RISK_TONE = {
  minimal: "text-emerald-700 dark:text-emerald-300",
  low: "text-cyan-700 dark:text-cyan-300",
  moderate: "text-amber-700 dark:text-amber-300",
  high: "text-rose-700 dark:text-rose-300",
};

const cleanSignalText = (value) => String(value || "")
  .replace(/[\u00c3\u201a\u00c2]+\u00b7/g, "\u00b7")
  .replace(/[\u00c3\u201a\u00c2]+\u00b0/g, "\u00b0")
  .replace(/\u00e2\u20ac\u201d/g, "\u2014")
  .replace(/\u00e2\u2020\u2019/g, "\u2192")
  .replace(/\u00c2/g, "");

function HealthGauge({ score }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const hasEvidence = score !== null && score !== undefined && Number.isFinite(Number(score));
  const offset = circumference - ((hasEvidence ? score : 0) / 100) * circumference;
  const tone = score >= 85 ? "#10b981" : score >= 65 ? "#06b6d4" : score >= 40 ? "#f59e0b" : "#f43f5e";
  return <svg width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r={radius} stroke="hsl(var(--border))" strokeWidth="8" fill="none" /><circle cx="48" cy="48" r={radius} stroke={hasEvidence ? tone : "hsl(var(--muted-foreground))"} strokeWidth="8" fill="none" strokeDasharray={hasEvidence ? circumference : "3 6"} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 48 48)" style={{ transition: "stroke-dashoffset 0.6s ease", opacity: hasEvidence ? 1 : 0.55 }} /><text x="48" y="52" textAnchor="middle" fontSize="22" fontWeight="700" fill="hsl(var(--foreground))" fontFamily="monospace">{hasEvidence ? score : "—"}</text><text x="48" y="68" textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="monospace">{hasEvidence ? "HEALTH" : "EVIDENCE"}</text></svg>;
}

export default function DeviceDossier({ deviceId, headers, API }) {
  const authorization = headers?.Authorization;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await axios.get(`${API}/devices/${deviceId}/dossier`, { headers: { Authorization: authorization } }); setData(response.data); }
    catch { setData(null); }
    finally { setLoading(false); }
  }, [API, deviceId, authorization]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Card><CardContent className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;
  if (!data) return <Card><CardContent className="flex items-center justify-between gap-3 py-5"><p className="text-sm text-muted-foreground">Endpoint briefing unavailable. Device details remain accessible below.</p><Button variant="outline" onClick={load}>Retry</Button></CardContent></Card>;

  const { health_score: healthScore, health_evidence: healthEvidence = {}, commentary, lifecycle = {}, failure_risk: failureRisk = {}, change_timeline: changeTimeline = [] } = data;
  const factors = failureRisk.factors || [];
  const riskKnown = failureRisk.risk_pct !== null && failureRisk.risk_pct !== undefined && Number.isFinite(Number(failureRisk.risk_pct));
  return <Card className="nx-endpoint-briefing overflow-hidden rounded-2xl border-cyan-500/20" data-testid="device-dossier">
    <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border/50 bg-muted/15 pb-4"><div className="min-w-0"><CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-300" />Endpoint briefing</CardTitle><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Condition, lifecycle and recent evidence — before you take action.</p></div><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={load} aria-label="Refresh endpoint briefing" title="Refresh endpoint briefing"><RefreshCw className="h-3.5 w-3.5" /></Button></CardHeader>
    <CardContent className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 p-3"><HealthGauge score={healthScore} /><div className="min-w-0"><div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"><Heart className="h-3 w-3" />Health</div><p className="mt-1 text-xs leading-snug text-foreground/85">{commentary || "No current health commentary."}</p></div></div>
        <div className="rounded-md border border-border bg-muted/20 p-3"><div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"><Clock className="h-3 w-3" />Lifecycle</div><Badge variant="outline" className={`mt-2 text-[10px] uppercase ${BAND_TONE[lifecycle.band] || BAND_TONE.unknown}`}>{lifecycle.label || "Unknown"}</Badge><p className="mt-2 font-mono text-[11px] text-muted-foreground">Age: {lifecycle.age_years != null ? `${lifecycle.age_years}y` : "not available"}{lifecycle.renewal_due && <span className="ml-2 text-rose-700 dark:text-rose-300">/ renewal due</span>}</p></div>
        <div className="rounded-md border border-border bg-muted/20 p-3"><div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{failureRisk.verdict === "high" ? <Skull className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}Failure Risk</div><p className={`mt-1 font-mono text-2xl font-bold ${riskKnown ? (RISK_TONE[failureRisk.verdict] || "text-muted-foreground") : "text-muted-foreground"}`}>{riskKnown ? `${failureRisk.risk_pct}%` : "—"}</p><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{riskKnown ? (failureRisk.verdict || "unknown") : "evidence needed"}</p>{factors.length > 0 && <p className="mt-1 truncate text-[10px] text-muted-foreground" title={factors.join(", ")}>{factors.slice(0, 2).join(", ")}{factors.length > 2 && "..."}</p>}</div>
      </div>
      {healthEvidence.state && healthEvidence.state !== "observed" && <div className="rounded-md border border-dashed border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-muted-foreground"><span className="font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300">Evidence needed</span><span className="ml-2">{healthEvidence.message || "Reconnect or refresh the endpoint before acting on health guidance."}</span></div>}
      <div><div className="mb-2 flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"><Activity className="h-3 w-3" />Recent signals and changes (24h)</div>{changeTimeline.length === 0 ? <div className="rounded-md border border-dashed border-border px-4 py-4 text-center"><p className="text-xs text-muted-foreground">No operational changes recorded in the last 24 hours.</p><p className="mt-1 text-[10px] text-muted-foreground">The next agent check-in, command, patch scan, or device change will appear here.</p></div> : <ScrollArea className="h-[200px] pr-2"><div className="relative pl-5"><div className="absolute bottom-0 left-1.5 top-0 w-px bg-border" />{changeTimeline.map((event, index) => <div key={`${event.ts || "signal"}-${index}`} className="group relative mb-2"><div className="absolute -left-5 top-1.5 h-2 w-2 rounded-full bg-cyan-500 ring-2 ring-background" /><div className="rounded border border-border bg-muted/20 px-2 py-1.5 transition-colors group-hover:border-cyan-500/40"><div className="text-xs">{cleanSignalText(event.title)}</div><div className="font-mono text-[10px] text-muted-foreground">{event.by ? `${cleanSignalText(event.by)} / ` : ""}{event.ts ? formatDistanceToNow(new Date(event.ts), { addSuffix: true }) : "not available"}</div></div></div>)}</div></ScrollArea>}</div>
    </CardContent>
  </Card>;
}
