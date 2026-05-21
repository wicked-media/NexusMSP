import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Sparkles, TrendingUp, AlertTriangle, Layers, Mail, PauseCircle, RefreshCcw,
  Loader2, Activity, Zap, ChevronRight,
} from "lucide-react";

const BAND_STYLES = {
  low: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  medium: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  high: "bg-rose-500/20 text-rose-300 border-rose-500/30",
};

export default function RecurringSmartActions({ ri, onReload }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [showRisk, setShowRisk] = useState(false);
  const [showUplift, setShowUplift] = useState(false);
  const [showPause, setShowPause] = useState(false);
  const [showPrebill, setShowPrebill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [risk, setRisk] = useState(null);

  // Uplift state
  const [upliftPct, setUpliftPct] = useState(ri.uplift_rule?.pct || 5);
  const [upliftFreq, setUpliftFreq] = useState(ri.uplift_rule?.frequency || "annually");
  const [upliftEnabled, setUpliftEnabled] = useState(ri.uplift_rule?.enabled ?? false);

  // Pause-range state
  const [pauseFrom, setPauseFrom] = useState(new Date().toISOString().slice(0, 10));
  const [pauseTo, setPauseTo] = useState("");
  const [pauseReason, setPauseReason] = useState("");

  // Pre-bill state
  const [prebillEmail, setPrebillEmail] = useState("");
  const [prebillHtml, setPrebillHtml] = useState(null);

  const loadRisk = async () => {
    setBusy(true);
    try {
      const r = await axios.get(`${API}/recurring-invoices/${ri.id}/renewal-risk`, { headers });
      setRisk(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const saveUplift = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/recurring-invoices/${ri.id}/uplift-rule`, {
        enabled: upliftEnabled, pct: upliftPct, frequency: upliftFreq,
      }, { headers });
      toast.success("Uplift rule saved");
      onReload && onReload();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const applyUpliftNow = async () => {
    if (!window.confirm(`Apply +${upliftPct}% to all line items right now?`)) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API}/recurring-invoices/${ri.id}/apply-uplift`, {}, { headers });
      toast.success(`+${upliftPct}% applied → $${r.data.new_amount.toFixed(2)}`);
      setShowUplift(false);
      onReload && onReload();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const setPauseRange = async () => {
    if (!pauseTo) { toast.error("Pick an end date"); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/recurring-invoices/${ri.id}/pause-range`, {
        from_date: pauseFrom, to_date: pauseTo, reason: pauseReason,
      }, { headers });
      toast.success("Pause window scheduled");
      setShowPause(false);
      onReload && onReload();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const sendPrebill = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/recurring-invoices/${ri.id}/pre-bill-preview`, prebillEmail ? { email: prebillEmail } : {}, { headers });
      setPrebillHtml(r.data.preview_html);
      toast.success(r.data.sent ? "Preview email sent" : "Preview generated (email skipped)");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const rollupUsage = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/recurring-invoices/${ri.id}/rollup-usage`, {}, { headers });
      toast.success(`Rolled up: Acronis=${r.data.rolled_up.acronis}, Pax8=${r.data.rolled_up.pax8}, M365=${r.data.rolled_up.m365} → $${r.data.new_amount.toFixed(2)}`);
      onReload && onReload();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="recurring-smart-actions">
      <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30" onClick={() => { setShowRisk(true); if (!risk) loadRisk(); }} data-testid="btn-renewal-risk">
        <AlertTriangle className="w-3 h-3 mr-1" /> Renewal Risk
      </Button>
      <Button size="sm" variant="outline" onClick={() => setShowUplift(true)} data-testid="btn-uplift">
        <TrendingUp className="w-3 h-3 mr-1" /> CPI Uplift
        {ri.uplift_rule?.enabled && <Badge className="ml-1 bg-emerald-500/20 text-emerald-300 text-[9px] px-1 py-0">{ri.uplift_rule.pct}%/{ri.uplift_rule.frequency?.[0]?.toUpperCase()}</Badge>}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setShowPause(true)} data-testid="btn-pause-range">
        <PauseCircle className="w-3 h-3 mr-1" /> Pause Window
      </Button>
      <Button size="sm" variant="outline" onClick={() => setShowPrebill(true)} data-testid="btn-prebill-preview">
        <Mail className="w-3 h-3 mr-1" /> Pre-Bill Preview
      </Button>
      <Button size="sm" variant="outline" onClick={rollupUsage} disabled={busy} data-testid="btn-rollup-usage">
        <Layers className="w-3 h-3 mr-1" /> Rollup Usage
      </Button>

      {/* Renewal Risk */}
      <Dialog open={showRisk} onOpenChange={setShowRisk}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-emerald-400" />Renewal Risk — {ri.client_name}</DialogTitle>
            <DialogDescription>AI-driven churn score from payment history, ticket activity & SLA.</DialogDescription>
          </DialogHeader>
          {busy && !risk ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : risk && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded bg-muted/30">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Risk Score</div>
                  <div className="text-5xl font-light mt-1">{risk.risk_score}<span className="text-base text-muted-foreground"> /100</span></div>
                </div>
                <Badge className={`text-base px-3 py-1 ${BAND_STYLES[risk.band]}`}>{risk.band.toUpperCase()}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Card><CardContent className="p-2 text-center"><div className="text-muted-foreground">DSO</div><div className="font-medium">{risk.signals.avg_dso_days}d</div></CardContent></Card>
                <Card><CardContent className="p-2 text-center"><div className="text-muted-foreground">Overdue Inv.</div><div className="font-medium">{risk.signals.overdue_invoices}</div></CardContent></Card>
                <Card><CardContent className="p-2 text-center"><div className="text-muted-foreground">Open Critical</div><div className="font-medium">{risk.signals.open_critical_tickets}</div></CardContent></Card>
              </div>
              <Card className="bg-emerald-500/5 border-emerald-500/30">
                <CardContent className="p-3">
                  <Label className="text-xs uppercase tracking-wider flex items-center gap-1"><Sparkles className="w-3 h-3 text-emerald-400" />AI Analysis</Label>
                  <p className="text-sm mt-2">{risk.ai_analysis}</p>
                </CardContent>
              </Card>
              <div>
                <Label className="text-xs uppercase tracking-wider">Recommended Actions</Label>
                <ul className="mt-2 space-y-1">
                  {(risk.recommended_actions || []).map((a, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <ChevronRight className="w-3 h-3 text-emerald-400" /> {a}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRisk(null); loadRisk(); }}><RefreshCcw className="w-3 h-3 mr-1" />Recompute</Button>
            <Button onClick={() => setShowRisk(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CPI Uplift */}
      <Dialog open={showUplift} onOpenChange={setShowUplift}>
        <DialogContent>
          <DialogHeader><DialogTitle>CPI / YoY Uplift Rule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={upliftEnabled} onChange={(e) => setUpliftEnabled(e.target.checked)} id="uplift-en" />
              <label htmlFor="uplift-en" className="text-sm">Enable auto-uplift</label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Uplift %</Label>
                <Input type="number" step="0.1" value={upliftPct} onChange={(e) => setUpliftPct(parseFloat(e.target.value || "0"))} />
              </div>
              <div>
                <Label className="text-xs">Frequency</Label>
                <Select value={upliftFreq} onValueChange={setUpliftFreq}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annually">Annually</SelectItem>
                    <SelectItem value="biannually">Bi-annually</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {ri.uplift_rule?.applied_count > 0 && (
              <div className="text-xs text-muted-foreground">Last applied: {new Date(ri.uplift_rule.last_applied_at).toLocaleDateString()} ({ri.uplift_rule.applied_count} times)</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={applyUpliftNow} disabled={busy} className="text-amber-400 border-amber-500/30"><Zap className="w-3 h-3 mr-1" />Apply Now</Button>
            <Button onClick={saveUplift} disabled={busy}>Save Rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pause range */}
      <Dialog open={showPause} onOpenChange={setShowPause}>
        <DialogContent>
          <DialogHeader><DialogTitle>Scheduled Pause Window</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">From</Label><Input type="date" value={pauseFrom} onChange={(e) => setPauseFrom(e.target.value)} /></div>
              <div><Label className="text-xs">To</Label><Input type="date" value={pauseTo} onChange={(e) => setPauseTo(e.target.value)} /></div>
            </div>
            <div>
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPause(false)}>Cancel</Button>
            <Button onClick={setPauseRange} disabled={busy}>Schedule Pause</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pre-bill preview */}
      <Dialog open={showPrebill} onOpenChange={setShowPrebill}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Pre-Bill Preview</DialogTitle>
            <DialogDescription>Sends the client a preview of next invoice so they can flag issues before billing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={prebillEmail} onChange={(e) => setPrebillEmail(e.target.value)} placeholder="Override email (optional — uses client default)" />
            <Button onClick={sendPrebill} disabled={busy} data-testid="prebill-send-btn">{busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Mail className="w-3 h-3 mr-1" />}Generate & Send Preview</Button>
            {prebillHtml && (
              <ScrollArea className="max-h-[40vh] border border-zinc-800 rounded">
                <div className="bg-white text-black p-3" dangerouslySetInnerHTML={{ __html: prebillHtml }} />
              </ScrollArea>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ConsolidateButton({ clientId, clientName, onDone }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!window.confirm(`Consolidate ALL active recurring streams for ${clientName} into a single monthly invoice?`)) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API}/recurring-invoices/consolidate/${clientId}`, {}, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`Consolidated ${r.data.consolidates_streams.length} streams → $${r.data.amount.toFixed(2)}/mo`);
      onDone && onDone();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  return (
    <Button size="sm" variant="outline" onClick={run} disabled={busy} className="text-cyan-400 border-cyan-500/30" data-testid="consolidate-btn">
      {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Activity className="w-3 h-3 mr-1" />}Consolidate Streams
    </Button>
  );
}
