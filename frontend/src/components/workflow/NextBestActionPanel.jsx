import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Database, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const priorityStyles = {
  critical: "border-rose-500/30 bg-rose-500/[0.07] text-rose-200",
  high: "border-amber-500/30 bg-amber-500/[0.07] text-amber-200",
  medium: "border-sky-500/30 bg-sky-500/[0.07] text-sky-200",
  low: "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-200",
};

const sourceLabel = (source) => String(source || "evidence").replaceAll("_", " ");

/**
 * Reusable, read-only technician hand-off. It intentionally links into the
 * owning workflow rather than executing actions from an intelligence card.
 */
export default function NextBestActionPanel({ ticketId, compact = false, className = "" }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(Boolean(ticketId));
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ticketId) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${API}/workflow-intelligence/tickets/${ticketId}/next-best-action`, { headers, timeout: 8_000 });
      setResult(response.data || null);
    } catch (requestError) {
      setResult(null);
      setError(requestError.response?.data?.detail || "Nexus could not load the evidence-led hand-off. Your ticket was not changed.");
    } finally {
      setLoading(false);
    }
  }, [headers, ticketId]);

  useEffect(() => { load(); }, [load]);

  if (!ticketId) return null;
  if (loading) {
    return <Card className={`border-violet-500/20 ${className}`} data-testid="next-best-action-loading"><CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-violet-300" />Preparing the evidence-led hand-off…</CardContent></Card>;
  }
  if (error) {
    return <Card className={`border-rose-500/25 ${className}`} data-testid="next-best-action-error"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><p className="text-sm text-rose-100">{error}</p><Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button></CardContent></Card>;
  }
  if (!result?.recommendation) return null;

  const recommendation = result.recommendation;
  const tone = priorityStyles[recommendation.priority] || priorityStyles.medium;
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  const dataGaps = Array.isArray(result.data_gaps) ? result.data_gaps : [];

  return (
    <Card className={`overflow-hidden border-violet-500/25 bg-gradient-to-br from-violet-500/[0.07] via-card to-cyan-500/[0.04] ${className}`} data-testid="next-best-action-panel">
      <CardHeader className="border-b border-violet-500/15 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-violet-300" />Nexus next best action</CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">A reviewable hand-off based only on retained Nexus evidence. It never starts work or changes a customer record.</p>
          </div>
          <div className="flex items-center gap-2"><Badge variant="outline" className={`capitalize ${tone}`}>{recommendation.priority || "medium"}</Badge><Button variant="ghost" size="icon" className="h-8 w-8" onClick={load} aria-label="Refresh recommendation"><RefreshCw className="h-3.5 w-3.5" /></Button></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <div className={`rounded-xl border p-3 ${tone}`}>
          <div className="flex gap-3"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/25 bg-background/35"><AlertTriangle className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground">{recommendation.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{recommendation.detail}</p><p className="mt-2 text-[11px] leading-5 text-muted-foreground"><span className="font-semibold text-foreground">Why Nexus suggested this: </span>{recommendation.why}</p></div></div>
          {recommendation.handoff?.route && <Button asChild size="sm" className="mt-3"><Link to={recommendation.handoff.route}>{recommendation.handoff.label || "Review next step"}<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button>}
        </div>

        {!compact && <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-border/65 bg-muted/[0.08] p-3"><p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Database className="h-3.5 w-3.5" />Evidence Nexus used</p><div className="mt-2 space-y-2">{evidence.length ? evidence.map((item, index) => <Link key={`${item.source}-${item.recorded_at || index}`} to={item.route || "#"} className="block rounded-lg px-2 py-1.5 transition hover:bg-muted/60"><div className="flex items-start justify-between gap-2"><span className="text-xs font-medium">{item.title}</span><Badge variant="secondary" className="shrink-0 text-[9px] capitalize">{sourceLabel(item.source)}</Badge></div><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{item.detail}</p></Link>) : <p className="text-xs text-muted-foreground">No retained supporting records are available yet.</p>}</div></div>
          <div className="rounded-xl border border-border/65 bg-muted/[0.08] p-3"><p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><CircleAlert className="h-3.5 w-3.5" />Evidence gaps</p><div className="mt-2 space-y-2">{dataGaps.length ? dataGaps.map((item) => <Link key={item.key} to={item.route || "#"} className="block rounded-lg px-2 py-1.5 transition hover:bg-muted/60"><p className="text-xs font-medium">{item.title}</p><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{item.detail}</p></Link>) : <div className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs text-emerald-300"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />No material evidence gaps were identified in this limited context.</div>}</div></div>
        </div>}
        <p className="text-[10px] leading-4 text-muted-foreground">{result.boundary}</p>
      </CardContent>
    </Card>
  );
}
