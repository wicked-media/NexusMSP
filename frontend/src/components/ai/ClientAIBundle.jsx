import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Heart, TrendingUp, Cake, Copy } from "lucide-react";
import { toast } from "sonner";

/** Three insights for client detail page: DNA tile, LTV tile, Anniversary email button. */
export function ClientAIBundle({ clientId }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [dna, setDna] = useState(null);
  const [ltv, setLtv] = useState(null);
  const [annivOpen, setAnnivOpen] = useState(false);
  const [anniv, setAnniv] = useState(null);
  const [annivLoading, setAnnivLoading] = useState(false);

  useEffect(() => {
    let m = true;
    Promise.all([
      axios.get(`${API}/clients/${clientId}/dna`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/clients/${clientId}/ltv-forecast`, { headers }).then(r => r.data).catch(() => null),
    ]).then(([d, l]) => { if (m) { setDna(d); setLtv(l); } });
    return () => { m = false; };
    // eslint-disable-next-line
  }, [clientId]);

  const generateAnniv = async () => {
    setAnnivOpen(true); setAnniv(null); setAnnivLoading(true);
    try {
      const r = await axios.get(`${API}/clients/${clientId}/anniversary-draft`, { headers });
      setAnniv(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setAnnivLoading(false); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="client-ai-bundle">
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
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" />LTV Forecast</CardTitle>
          <Button variant="outline" size="sm" className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={generateAnniv} data-testid="anniversary-btn">
            <Cake className="w-3.5 h-3.5 mr-1" />Anniversary AI
          </Button>
        </CardHeader>
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

      {/* Anniversary Dialog */}
      <Dialog open={annivOpen} onOpenChange={setAnnivOpen}>
        <DialogContent className="max-w-xl" data-testid="anniversary-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Cake className="w-4 h-4 text-amber-400" />Anniversary email</DialogTitle></DialogHeader>
          {annivLoading && <div className="py-10 flex flex-col items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin text-amber-400" />Drafting…</div>}
          {!annivLoading && anniv && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2 text-xs">
                {anniv.milestone && <Badge variant="outline" className="text-amber-400 border-amber-500/40">{anniv.milestone}</Badge>}
                <Badge variant="outline">{anniv.years} years partnered</Badge>
                <Badge variant="outline">{anniv.stats?.tickets_resolved} tickets resolved</Badge>
                <Badge variant="outline">{anniv.stats?.devices} devices</Badge>
              </div>
              <div className="border rounded-md p-3 bg-muted/20">
                <div className="text-[10px] uppercase text-muted-foreground">Subject</div>
                <div className="font-medium">{anniv.subject}</div>
              </div>
              <div className="border rounded-md p-3 bg-muted/20 whitespace-pre-wrap" data-testid="anniversary-body">{anniv.body}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnivOpen(false)}>Close</Button>
            {anniv && !annivLoading && (
              <Button variant="outline" className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                onClick={() => navigator.clipboard.writeText(`Subject: ${anniv.subject}\n\n${anniv.body}`).then(() => toast.success("Copied"))} data-testid="anniv-copy">
                <Copy className="w-3.5 h-3.5 mr-1" />Copy
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
