import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Sparkles, Wand2, Mail, AlertCircle, TrendingDown, Calendar, DollarSign,
  Receipt, Loader2, Zap, ChevronRight, FileText, Percent, Ban, Send, RefreshCw,
} from "lucide-react";

const STAGE_LABELS = { first: "Friendly Nudge", second: "Polite Reminder", third: "Firm Notice", final: "Final Notice" };

export default function InvoicesSmartBar({ invoices = [], selectedIds = new Set(), onReload }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [showAiDraft, setShowAiDraft] = useState(false);
  const [showAged, setShowAged] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showPlan, setShowPlan] = useState(null); // invoice
  const [showReminder, setShowReminder] = useState(null);
  const [aged, setAged] = useState(null);
  const [agedLoading, setAgedLoading] = useState(false);
  const [clients, setClients] = useState([]);

  useEffect(() => {
    axios.get(`${API}/clients`, { headers }).then(r => setClients(r.data || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAged = useCallback(async () => {
    setAgedLoading(true);
    try {
      const r = await axios.get(`${API}/invoices/aged-ar-insights`, { headers });
      setAged(r.data);
    } catch (e) { toast.error("Failed to load aged AR"); }
    finally { setAgedLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (showAged && !aged) loadAged(); }, [showAged, aged, loadAged]);

  const ids = Array.from(selectedIds);
  const selCount = ids.length;

  return (
    <>
      <Card className="bg-gradient-to-r from-emerald-500/5 to-cyan-500/5 border-emerald-500/20" data-testid="invoices-smart-bar">
        <CardContent className="p-3 flex items-center flex-wrap gap-2">
          <div className="flex items-center gap-2 mr-3">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium">Smart Actions</span>
            <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">AI-powered</Badge>
          </div>

          <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30" onClick={() => setShowAiDraft(true)} data-testid="smart-ai-draft-btn">
            <Wand2 className="w-3.5 h-3.5 mr-1" /> AI Draft Invoice
          </Button>

          <Button size="sm" variant="outline" onClick={() => setShowAged(true)} data-testid="smart-aged-ar-btn">
            <TrendingDown className="w-3.5 h-3.5 mr-1" /> Aged AR Insights
          </Button>

          <Button size="sm" variant="outline" onClick={() => setShowBulk(true)} disabled={selCount === 0} data-testid="smart-bulk-btn">
            <Zap className="w-3.5 h-3.5 mr-1" /> Bulk ({selCount})
          </Button>

          <div className="text-[10px] text-muted-foreground ml-2">
            Tip: tick rows in the table to enable bulk ops.
          </div>
        </CardContent>
      </Card>

      {/* AI Draft Dialog */}
      <AiDraftDialog open={showAiDraft} onClose={() => setShowAiDraft(false)} clients={clients} headers={headers} onCreated={onReload} />

      {/* Aged AR Dialog */}
      <Dialog open={showAged} onOpenChange={setShowAged}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><TrendingDown className="w-5 h-5 text-rose-400" />Aged AR — AI Insights</DialogTitle>
            <DialogDescription>Live outstanding balance rollup with AI commentary.</DialogDescription>
          </DialogHeader>
          {agedLoading ? <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin" /></div> :
            aged && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <Card><CardContent className="p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Overdue</div>
                    <div className="text-2xl font-light text-rose-400 mt-1">${aged.total_overdue.toLocaleString()}</div>
                  </CardContent></Card>
                  <Card><CardContent className="p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Affected Clients</div>
                    <div className="text-2xl font-light text-amber-400 mt-1">{aged.client_count}</div>
                  </CardContent></Card>
                  <Card><CardContent className="p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Top Offender</div>
                    <div className="text-sm font-medium mt-1 truncate">{aged.top_offenders?.[0]?.client_name || "—"}</div>
                    <div className="text-[10px] text-muted-foreground">${(aged.top_offenders?.[0]?.balance || 0).toLocaleString()}</div>
                  </CardContent></Card>
                </div>

                <div>
                  <Label className="text-xs uppercase tracking-wider">Top 5 Offenders</Label>
                  <div className="space-y-1 mt-2">
                    {(aged.top_offenders || []).map((o) => (
                      <div key={o.client_id} className="flex items-center justify-between p-2 rounded bg-muted/30">
                        <div className="text-sm font-medium">{o.client_name}</div>
                        <div className="text-xs flex items-center gap-3">
                          <span className="text-amber-400">{o.max_overdue}d overdue</span>
                          <span className="text-rose-400 font-medium">${o.balance.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Card className="bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/30">
                  <CardContent className="p-3">
                    <Label className="text-xs uppercase tracking-wider flex items-center gap-1"><Sparkles className="w-3 h-3 text-emerald-400" />AI Summary</Label>
                    <pre className="text-xs mt-2 whitespace-pre-wrap text-zinc-200">{aged.ai_summary}</pre>
                  </CardContent>
                </Card>
              </div>
            )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAged(null); loadAged(); }}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
            <Button onClick={() => setShowAged(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Dialog */}
      <BulkDialog open={showBulk} onClose={() => setShowBulk(false)} ids={ids} headers={headers} onDone={() => { setShowBulk(false); onReload && onReload(); }} />
    </>
  );
}

// ─────────── AI Draft ───────────
function AiDraftDialog({ open, onClose, clients, headers, onCreated }) {
  const [clientId, setClientId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [includeRecurring, setIncludeRecurring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);

  const run = async () => {
    if (!clientId) { toast.error("Pick a client"); return; }
    setBusy(true);
    setDraft(null);
    try {
      const r = await axios.post(`${API}/invoices/ai-draft`, {
        client_id: clientId,
        period_start: periodStart,
        period_end: periodEnd,
        include_recurring: includeRecurring,
      }, { headers });
      setDraft(r.data);
      toast.success("AI draft generated");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const createInvoice = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API}/invoices`, {
        client_id: draft.client_id,
        line_items: draft.line_items.map((li) => ({ description: li.description, quantity: li.quantity, unit_price: li.unit_price, total: li.total })),
        tax_rate: String(draft.tax_rate || 10),
        notes: draft.ai_notes || "",
        due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      }, { headers });
      toast.success(`Invoice ${r.data.invoice_number || ""} created`);
      onCreated && onCreated();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 className="w-5 h-5 text-emerald-400" />AI Draft Invoice</DialogTitle>
          <DialogDescription>Pull billable time entries, tickets, and active recurring streams into a draft invoice. Reviewed by AI for tone.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger data-testid="ai-draft-client"><SelectValue placeholder="Pick a client" /></SelectTrigger>
              <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Period start</Label>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Period end</Label>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
          <div className="col-span-2 flex items-center gap-2 text-xs">
            <input type="checkbox" id="inc-rec" checked={includeRecurring} onChange={(e) => setIncludeRecurring(e.target.checked)} />
            <label htmlFor="inc-rec">Include active recurring streams as lines</label>
          </div>
        </div>
        <Button onClick={run} disabled={busy || !clientId} className="mt-2" data-testid="ai-draft-run-btn">
          {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}Generate Draft
        </Button>

        {draft && (
          <ScrollArea className="max-h-[40vh] mt-3">
            <Card className="bg-emerald-500/5 border-emerald-500/30">
              <CardContent className="p-3 space-y-2">
                <div className="text-sm font-medium">Draft for {draft.client_name}</div>
                <div className="space-y-1">
                  {(draft.line_items || []).map((li, i) => (
                    <div key={i} className="flex items-center justify-between text-xs border-b border-zinc-800 pb-1">
                      <span className="truncate flex-1">{li.description}</span>
                      <span className="text-muted-foreground mx-2">{li.quantity} × ${li.unit_price}</span>
                      <span className="font-medium">${li.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-zinc-700 pt-2">
                  <span className="text-xs">Subtotal / Tax / Total</span>
                  <span className="text-sm">${draft.subtotal} / ${draft.tax} / <b className="text-emerald-400">${draft.total}</b></span>
                </div>
                {draft.ai_notes && (
                  <div className="bg-background/60 rounded p-2 text-xs">
                    <span className="text-[10px] uppercase tracking-wider text-emerald-400">AI Notes</span>
                    <p className="mt-1 text-zinc-300">{draft.ai_notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {draft && <Button onClick={createInvoice} disabled={busy} data-testid="ai-draft-create-btn">{busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Receipt className="w-3 h-3 mr-1" />}Create Invoice</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────── Bulk Operations ───────────
function BulkDialog({ open, onClose, ids, headers, onDone }) {
  const [action, setAction] = useState("send");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(5);

  const run = async () => {
    setBusy(true);
    try {
      const data = { invoice_ids: ids };
      if (action === "discount") data.discount_pct = pct;
      if (action === "apply-late-fee") data.fee_pct = pct;
      const r = await axios.post(`${API}/invoices/bulk/${action}`, data, { headers });
      toast.success(`Processed ${r.data.processed}/${ids.length}`);
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Bulk Action — {ids.length} invoices</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="send">Mark Sent</SelectItem>
                <SelectItem value="void">Void</SelectItem>
                <SelectItem value="discount">Apply Discount (%)</SelectItem>
                <SelectItem value="apply-late-fee">Apply Late Fee (%)</SelectItem>
                <SelectItem value="reissue">Reissue (clone as new draft)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(action === "discount" || action === "apply-late-fee") && (
            <div>
              <Label className="text-xs">Percent</Label>
              <Input type="number" value={pct} onChange={(e) => setPct(parseFloat(e.target.value || "0"))} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={busy || ids.length === 0} data-testid="bulk-run-btn">{busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}Run</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Detail-level actions (Payment Plan + Smart Reminder) — exported separately for invoice detail view
export function InvoiceDetailSmartActions({ invoice, onReload }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [showPlan, setShowPlan] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [showLateFee, setShowLateFee] = useState(false);
  const [installments, setInstallments] = useState(3);
  const [interval, setInterval] = useState(30);
  const [busy, setBusy] = useState(false);
  const [reminderData, setReminderData] = useState(null);
  const [feeType, setFeeType] = useState("percent");
  const [feeValue, setFeeValue] = useState(5);

  const createPlan = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/invoices/${invoice.id}/payment-plan`, { installments, interval_days: interval }, { headers });
      toast.success(`${r.data.installments} installment plan created`);
      setShowPlan(false);
      onReload && onReload();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const draftReminder = async (stage) => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/invoices/${invoice.id}/smart-reminder`, { stage }, { headers });
      setReminderData(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const sendReminderEmail = async () => {
    if (!reminderData) return;
    setBusy(true);
    try {
      await axios.post(`${API}/invoices/${invoice.id}/email`, {
        subject: reminderData.subject,
        message: reminderData.body.replace(/\n/g, "<br/>"),
      }, { headers });
      toast.success("Reminder sent");
      setShowReminder(false);
      setReminderData(null);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const applyLateFee = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/invoices/${invoice.id}/apply-late-fee`, { type: feeType, value: feeValue }, { headers });
      toast.success(`+$${r.data.fee} late fee applied`);
      setShowLateFee(false);
      onReload && onReload();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const generatePayLink = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/invoices/${invoice.id}/pay-now-link`, {}, { headers });
      navigator.clipboard.writeText(r.data.url).then(() => toast.success("Pay-now link copied to clipboard"));
      onReload && onReload();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const reissue = async () => {
    if (!window.confirm("Clone this invoice as a new draft with a new invoice number?")) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API}/invoices/${invoice.id}/reissue`, {}, { headers });
      toast.success(`Reissued as ${r.data.invoice_number}`);
      onReload && onReload();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="invoice-detail-smart-actions">
      <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30" onClick={() => setShowReminder(true)} data-testid="btn-smart-reminder">
        <Mail className="w-3 h-3 mr-1" /> Smart Reminder
      </Button>
      <Button size="sm" variant="outline" onClick={() => setShowPlan(true)} data-testid="btn-payment-plan">
        <Calendar className="w-3 h-3 mr-1" /> Payment Plan
      </Button>
      <Button size="sm" variant="outline" className="text-amber-400 border-amber-500/30" onClick={() => setShowLateFee(true)} data-testid="btn-late-fee">
        <Percent className="w-3 h-3 mr-1" /> Late Fee
      </Button>
      <Button size="sm" variant="outline" onClick={generatePayLink} disabled={busy} data-testid="btn-pay-now-link">
        <DollarSign className="w-3 h-3 mr-1" /> Pay-Now Link
      </Button>
      <Button size="sm" variant="outline" onClick={reissue} disabled={busy} data-testid="btn-reissue">
        <RefreshCw className="w-3 h-3 mr-1" /> Reissue
      </Button>

      <Dialog open={showPlan} onOpenChange={setShowPlan}>
        <DialogContent>
          <DialogHeader><DialogTitle>Payment Plan</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Installments</Label>
              <Input type="number" min={2} max={12} value={installments} onChange={(e) => setInstallments(parseInt(e.target.value || "3"))} />
            </div>
            <div>
              <Label className="text-xs">Interval (days)</Label>
              <Input type="number" value={interval} onChange={(e) => setInterval(parseInt(e.target.value || "30"))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPlan(false)}>Cancel</Button>
            <Button onClick={createPlan} disabled={busy}>{busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReminder} onOpenChange={(o) => { setShowReminder(o); if (!o) setReminderData(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-emerald-400" />Smart Reminder</DialogTitle>
            <DialogDescription>AI drafts the message with tone matched to how overdue the invoice is.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(STAGE_LABELS).map(([stage, label]) => (
                <Button key={stage} size="sm" variant="outline" onClick={() => draftReminder(stage)} disabled={busy} data-testid={`reminder-${stage}`}>
                  {label}
                </Button>
              ))}
            </div>
            {busy && <Loader2 className="w-4 h-4 animate-spin mx-auto" />}
            {reminderData && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Subject</Label>
                  <Input value={reminderData.subject} onChange={(e) => setReminderData({ ...reminderData, subject: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Body</Label>
                  <Textarea value={reminderData.body} onChange={(e) => setReminderData({ ...reminderData, body: e.target.value })} rows={10} />
                </div>
                <Badge variant="outline" className="text-[10px]">Stage: {reminderData.stage} · {reminderData.days_overdue} days overdue</Badge>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReminder(false)}>Cancel</Button>
            {reminderData && <Button onClick={sendReminderEmail} disabled={busy} data-testid="send-reminder-btn"><Send className="w-3 h-3 mr-1" />Send Now</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLateFee} onOpenChange={setShowLateFee}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply Late Fee</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={feeType} onValueChange={setFeeType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent (%)</SelectItem>
                  <SelectItem value="flat">Flat amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Value</Label>
              <Input type="number" value={feeValue} onChange={(e) => setFeeValue(parseFloat(e.target.value || "0"))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLateFee(false)}>Cancel</Button>
            <Button onClick={applyLateFee} disabled={busy}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
