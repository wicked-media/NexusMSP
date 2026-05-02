import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Heart, TrendingUp, Cake, Copy, Phone, FileText, ShieldCheck, CalendarRange, Download } from "lucide-react";
import { toast } from "sonner";

/** Client detail: DNA + LTV tiles, plus buttons for Anniversary, Monthly Recap, Pre-call Brief, Insurance Action Plan, Dossier PDF. */
export function ClientAIBundle({ clientId }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [dna, setDna] = useState(null);
  const [ltv, setLtv] = useState(null);
  const [view, setView] = useState(null); // null | "anniv" | "recap" | "precall" | "insurance"
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let m = true;
    Promise.all([
      axios.get(`${API}/clients/${clientId}/dna`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/clients/${clientId}/ltv-forecast`, { headers }).then(r => r.data).catch(() => null),
    ]).then(([d, l]) => { if (m) { setDna(d); setLtv(l); } });
    return () => { m = false; };
    // eslint-disable-next-line
  }, [clientId]);

  const fire = async (kind) => {
    setView(kind); setContent(null); setLoading(true);
    try {
      let r;
      if (kind === "anniv") r = await axios.get(`${API}/clients/${clientId}/anniversary-draft`, { headers });
      else if (kind === "recap") r = await axios.get(`${API}/clients/${clientId}/monthly-recap`, { headers });
      else if (kind === "precall") r = await axios.get(`${API}/clients/${clientId}/pre-call-brief`, { headers });
      else if (kind === "insurance") r = await axios.get(`${API}/clients/${clientId}/insurance-action-plan`, { headers });
      setContent(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };

  const downloadDossier = async () => {
    try {
      const r = await axios.get(`${API}/clients/${clientId}/dossier.pdf`, { headers, responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = `client-dossier-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click(); URL.revokeObjectURL(url);
      toast.success("Dossier downloaded");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  return (
    <div className="space-y-3" data-testid="client-ai-bundle">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={() => fire("anniv")} data-testid="anniversary-btn"><Cake className="w-3.5 h-3.5 mr-1" />Anniversary AI</Button>
        <Button variant="outline" size="sm" className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10" onClick={() => fire("recap")} data-testid="monthly-recap-btn"><CalendarRange className="w-3.5 h-3.5 mr-1" />Monthly Recap</Button>
        <Button variant="outline" size="sm" className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" onClick={() => fire("precall")} data-testid="precall-brief-btn"><Phone className="w-3.5 h-3.5 mr-1" />Pre-call Brief</Button>
        <Button variant="outline" size="sm" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => fire("insurance")} data-testid="insurance-plan-btn"><ShieldCheck className="w-3.5 h-3.5 mr-1" />Insurance Plan</Button>
        <Button variant="outline" size="sm" className="text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10" onClick={downloadDossier} data-testid="dossier-pdf-btn"><Download className="w-3.5 h-3.5 mr-1" />Dossier PDF</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* DNA */}
      <Card className="border-violet-500/20 bg-violet-500/[0.03]">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Heart className="w-4 h-4 text-violet-400" />Client DNA</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          {!dna ? <div className="text-muted-foreground py-2"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Profiling…</div> :
            <>
              <div className="flex flex-wrap gap-1">
                {(dna.personality_tags || []).map((t) => <Badge key={t} variant="outline" className="text-violet-400 border-violet-500/40 text-[10px]">{t}</Badge>)}
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
                <div>Tickets: <span className="text-foreground font-mono">{dna.metrics?.total_tickets}</span></div>
                <div>Critical %: <span className="text-foreground font-mono">{dna.metrics?.critical_pct}%</span></div>
                <div>Avg pay: <span className="text-foreground font-mono">{dna.metrics?.avg_payment_days ?? "—"}d</span></div>
                <div>Peak hour: <span className="text-foreground font-mono">{dna.metrics?.peak_demand_hour ?? "—"}h</span></div>
              </div>
              {(dna.metrics?.top_complaint_categories || []).length > 0 && (
                <div className="pt-1">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-widest">Top complaints</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {dna.metrics.top_complaint_categories.map((c, i) => <Badge key={`k-${i}`} variant="outline" className="text-[10px]">{c.category} · {c.count}</Badge>)}
                  </div>
                </div>
              )}
            </>}
        </CardContent>
      </Card>

      {/* LTV */}
      <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" />LTV Forecast</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          {!ltv ? <div className="text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Forecasting…</div> :
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-emerald-500/5 border border-emerald-500/30 rounded p-2">
                  <div className="text-[10px] uppercase text-emerald-400 tracking-widest">12-month LTV</div>
                  <div className="text-lg font-mono font-bold">${(ltv.forecast_12m_risk_adjusted || 0).toLocaleString()}</div>
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/30 rounded p-2">
                  <div className="text-[10px] uppercase text-emerald-400 tracking-widest">5-year LTV</div>
                  <div className="text-lg font-mono font-bold">${(ltv.forecast_5yr_ltv || 0).toLocaleString()}</div>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">MRR ${ltv.mrr || 0} · trailing 12m ${(ltv.trailing_12m_revenue || 0).toLocaleString()} · churn {ltv.churn_score}/100 · survival {Math.round((ltv.survival_probability || 0) * 100)}%</div>
            </>}
        </CardContent>
      </Card>
      </div>

      <Dialog open={!!view} onOpenChange={(v) => !v && setView(null)}>
        <DialogContent className="max-w-xl" data-testid="client-ai-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2">
            {view === "anniv" && <><Cake className="w-4 h-4 text-amber-400" />Anniversary email</>}
            {view === "recap" && <><CalendarRange className="w-4 h-4 text-violet-400" />Monthly recap email</>}
            {view === "precall" && <><Phone className="w-4 h-4 text-sky-400" />Pre-call brief</>}
            {view === "insurance" && <><ShieldCheck className="w-4 h-4 text-emerald-400" />Insurance action plan</>}
          </DialogTitle></DialogHeader>
          {loading && <div className="py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" />Working…</div>}

          {!loading && content && (view === "anniv" || view === "recap") && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2 text-xs">
                {content.milestone && <Badge variant="outline" className="text-amber-400 border-amber-500/40">{content.milestone}</Badge>}
                {content.highlight && <Badge variant="outline" className="text-violet-400 border-violet-500/40">{content.highlight}</Badge>}
                {content.period && <Badge variant="outline">{content.period}</Badge>}
                {content.stats?.resolved !== undefined && <Badge variant="outline">{content.stats.resolved} resolved</Badge>}
                {content.stats?.devices !== undefined && <Badge variant="outline">{content.stats.devices} devices</Badge>}
              </div>
              <div className="border rounded-md p-3 bg-muted/20"><div className="text-[10px] uppercase text-muted-foreground">Subject</div><div className="font-medium">{content.subject}</div></div>
              <div className="border rounded-md p-3 bg-muted/20 whitespace-pre-wrap" data-testid="client-email-body">{content.body}</div>
            </div>
          )}

          {!loading && content && view === "precall" && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className={content.tone === "apologetic" ? "text-rose-400 border-rose-500/40" : content.tone === "firm" ? "text-amber-400 border-amber-500/40" : "text-sky-400 border-sky-500/40"}>tone: {content.tone}</Badge>
                {content.stats?.open_criticals > 0 && <Badge variant="outline" className="text-rose-400 border-rose-500/40">{content.stats.open_criticals} open critical</Badge>}
                {content.stats?.overdue_invoices > 0 && <Badge variant="outline" className="text-amber-400 border-amber-500/40">{content.stats.overdue_invoices} overdue</Badge>}
              </div>
              {content.one_liner && <div className="italic text-base">"{content.one_liner}"</div>}
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">Topics to raise</div>
                <ul className="list-disc pl-5 space-y-0.5 text-xs">{(content.topics_to_raise || []).map((t, i) => <li key={`k-${i}`}>{t}</li>)}</ul>
              </div>
              {content.topics_to_avoid?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">Topics to avoid</div>
                  <ul className="list-disc pl-5 space-y-0.5 text-xs text-rose-400">{content.topics_to_avoid.map((t, i) => <li key={`k-${i}`}>{t}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          {!loading && content && view === "insurance" && (
            <div className="space-y-3 text-sm" data-testid="insurance-plan-body">
              <div className="flex gap-2">
                <Badge variant="outline" className={content.tier === "insurable" ? "text-emerald-400 border-emerald-500/40" : content.tier === "needs-improvement" ? "text-amber-400 border-amber-500/40" : "text-rose-400 border-rose-500/40"}>
                  Score {content.current_score}/100 · {content.tier}
                </Badge>
              </div>
              <div className="space-y-2">
                {(content.actions || []).length === 0 ? <div className="text-emerald-400 text-center py-4">All controls in place. Ready for insurance.</div> :
                  content.actions.map((a, i) => (
                    <div key={`k-${i}`} className={`border rounded-md p-2 ${a.priority === 1 ? "border-rose-500/40 bg-rose-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-[10px]">P{a.priority}</Badge>
                        <span className="font-medium">{a.title}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">{a.impact}</div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setView(null)}>Close</Button>
            {content && (view === "anniv" || view === "recap") && !loading && (
              <Button variant="outline" onClick={() => navigator.clipboard.writeText(`Subject: ${content.subject}\n\n${content.body}`).then(() => toast.success("Copied"))} data-testid="client-email-copy">
                <Copy className="w-3.5 h-3.5 mr-1" />Copy
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
