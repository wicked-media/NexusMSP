import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  BellRing, CalendarClock, History, Loader2, Mail, Play, Plus, Save, Trash2, Wand2, Zap,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import BillingWorkspaceNav from "@/components/billing/BillingWorkspaceNav";

const KIND_OPTIONS = [
  { value: "before_due", label: "Before due date" },
  { value: "due_date", label: "On due date" },
  { value: "after_due", label: "After due date" },
];

const TONE_OPTIONS = [
  { value: "friendly", label: "Friendly" },
  { value: "professional", label: "Professional" },
  { value: "firm", label: "Firm" },
];

const TEMPLATE_VARIABLES = ["client_name", "invoice_number", "amount_due", "due_date", "days_overdue", "msp_name"];

const TONE_BADGE = {
  friendly: "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-200",
  professional: "border-cyan-400/25 bg-cyan-500/[0.08] text-cyan-100",
  firm: "border-amber-400/30 bg-amber-500/[0.08] text-amber-100",
};

const describeStage = (stage) => {
  const days = Number(stage.days) || 0;
  if (stage.kind === "due_date" || days === 0) return "On the due date";
  if (stage.kind === "before_due") return `${days} day${days === 1 ? "" : "s"} before due`;
  return `${days} day${days === 1 ? "" : "s"} overdue`;
};

const emptyStage = () => ({
  id: `stage-${Date.now().toString(36)}`,
  kind: "after_due",
  days: 3,
  enabled: true,
  tone: "professional",
  subject: "Invoice {invoice_number} reminder",
  message: "Hi {client_name},\n\ninvoice {invoice_number} for {amount_due} was due on {due_date}. Please arrange payment at your convenience.",
});

export default function InvoiceRemindersPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("programme");
  const [settings, setSettings] = useState(null);
  const [summary, setSummary] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [previewStage, setPreviewStage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  const fetchAll = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [progRes, schedRes, histRes] = await Promise.all([
        axios.get(`${API}/billing/invoice-reminders`, { headers }),
        axios.get(`${API}/billing/invoice-reminders/schedule`, { headers }),
        axios.get(`${API}/billing/invoice-reminders/history`, { headers }),
      ]);
      setSettings(progRes.data.settings);
      setSummary({ ...progRes.data.summary, upcoming_7d: schedRes.data.upcoming_7d, total_planned: schedRes.data.total_planned });
      setSchedule(schedRes.data);
      setHistory(histRes.data.items || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not load the reminder programme");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const updateStage = (stageId, patch) => {
    setSettings((current) => ({
      ...current,
      stages: current.stages.map((stage) => (stage.id === stageId ? { ...stage, ...patch } : stage)),
    }));
  };

  const addStage = () => {
    setSettings((current) => ({ ...current, stages: [...current.stages, emptyStage()] }));
  };

  const removeStage = (stageId) => {
    setSettings((current) => ({ ...current, stages: current.stages.filter((stage) => stage.id !== stageId) }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/billing/invoice-reminders`, settings, { headers });
      toast.success("Reminder programme saved");
      fetchAll(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save the reminder programme");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data } = await axios.post(`${API}/billing/invoice-reminders/run`, {}, { headers });
      toast.success(data.message || "Reminders processed");
      fetchAll(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not run reminders");
    } finally {
      setRunning(false);
    }
  };

  const openPreview = async (stage) => {
    setPreviewStage(stage);
    setPreview(null);
    setPreviewing(true);
    try {
      const { data } = await axios.post(`${API}/billing/invoice-reminders/preview`, { stage }, { headers });
      setPreview(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not render the preview");
    } finally {
      setPreviewing(false);
    }
  };

  if (loading || !settings) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="space-y-5" data-testid="invoice-reminders-page">
      <OperationalPageHeader
        eyebrow="Revenue operations · automated follow-up"
        title="Invoice Reminders"
        description="Set up automatic payment reminders, customise every message, and see exactly what is scheduled — so nobody has to chase invoices by hand."
        icon={BellRing}
        tone="emerald"
        signal={settings.enabled ? "ready" : "attention"}
      />

      <BillingWorkspaceNav />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="border-emerald-400/20 bg-[linear-gradient(145deg,rgba(16,185,129,0.10),transparent_70%)]">
          <CardContent className="pt-4 pb-3">
            <Zap className="w-5 h-5 text-emerald-400 mb-1" />
            <p className="text-sm font-semibold text-emerald-200">{settings.enabled ? "Automation active" : "Automation paused"}</p>
            <p className="text-[11px] text-muted-foreground">Reminders run automatically every hour</p>
          </CardContent>
        </Card>
        <Card><CardContent className="pt-4 pb-3"><BellRing className="w-5 h-5 text-cyan-400 mb-1" /><p className="text-2xl font-bold">{summary?.active_stages ?? 0}</p><p className="text-[11px] text-muted-foreground">Active reminder stages</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><CalendarClock className="w-5 h-5 text-amber-400 mb-1" /><p className="text-2xl font-bold">{summary?.upcoming_7d ?? 0}</p><p className="text-[11px] text-muted-foreground">Reminders due in 7 days</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><Mail className="w-5 h-5 text-violet-400 mb-1" /><p className="text-2xl font-bold">{summary?.sent_last_30d ?? 0}</p><p className="text-[11px] text-muted-foreground">Sent in the last 30 days</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="programme"><Wand2 className="w-3 h-3 mr-1" />Programme</TabsTrigger>
          <TabsTrigger value="schedule"><CalendarClock className="w-3 h-3 mr-1" />Scheduled ({schedule?.items?.length || 0})</TabsTrigger>
          <TabsTrigger value="history"><History className="w-3 h-3 mr-1" />History ({history.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="programme" className="space-y-4">
          <Card className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[linear-gradient(145deg,rgba(24,25,32,0.98),rgba(15,17,23,0.98))]">
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Automated follow-up</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Nexus sends due reminders on its own — including overdue escalation — and records every delivery.</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch checked={settings.enabled} onCheckedChange={(v) => setSettings({ ...settings, enabled: v })} data-testid="reminders-enabled-toggle" />
                    <span className="text-xs font-medium text-slate-200">{settings.enabled ? "Enabled" : "Paused"}</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={runNow} disabled={running} data-testid="run-reminders-btn">
                    {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}Run due reminders now
                  </Button>
                  <Button variant="success" size="sm" onClick={save} disabled={saving} data-testid="save-reminders-btn">
                    {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}Save programme
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 rounded-xl border border-white/[0.07] bg-black/[0.14] p-4 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-slate-400">Minimum balance to remind ($)</Label>
                  <Input type="number" min="0" step="1" className="mt-1 h-9" value={settings.min_balance} onChange={(e) => setSettings({ ...settings, min_balance: e.target.value })} data-testid="reminders-min-balance" />
                  <p className="mt-1 text-[10px] text-slate-600">Skip small balances so customers are not over-contacted.</p>
                </div>
                <label className="flex items-start gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <Switch checked={settings.weekday_only} onCheckedChange={(v) => setSettings({ ...settings, weekday_only: v })} />
                  <span>
                    <span className="block text-xs font-medium text-slate-200">Business days only</span>
                    <span className="text-[10px] text-slate-500">Hold weekend reminders until Monday.</span>
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-cyan-400/15 bg-cyan-500/[0.04] px-3 py-2">
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-200">Template variables</span>
                {TEMPLATE_VARIABLES.map((name) => (
                  <span key={name} className="rounded-md border border-white/[0.08] bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-emerald-200">{`{${name}}`}</span>
                ))}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Reminder stages</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">Each stage fires on its scheduled day with its own subject, message and tone.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={addStage} className="border-white/[0.12] text-slate-200" data-testid="add-reminder-stage">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />Add stage
                  </Button>
                </div>

                {settings.stages.map((stage, index) => (
                  <div key={stage.id} className={`rounded-xl border p-4 transition ${stage.enabled ? "border-white/[0.10] bg-white/[0.025]" : "border-white/[0.05] bg-black/[0.12] opacity-70"}`} data-testid={`reminder-stage-${stage.id}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold ${stage.enabled ? "bg-emerald-500/15 text-emerald-200" : "bg-white/[0.05] text-slate-500"}`}>{index + 1}</span>
                      <div className="w-[150px]">
                        <Select value={stage.kind} onValueChange={(v) => updateStage(stage.id, { kind: v, days: v === "due_date" ? 0 : stage.days || 1 })}>
                          <SelectTrigger className="h-8 text-xs" data-testid={`stage-kind-${stage.id}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {KIND_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      {stage.kind !== "due_date" && (
                        <div className="flex items-center gap-1.5">
                          <Input type="number" min="1" max="365" className="h-8 w-16 text-xs" value={stage.days} onChange={(e) => updateStage(stage.id, { days: e.target.value })} data-testid={`stage-days-${stage.id}`} />
                          <span className="text-[11px] text-slate-500">days</span>
                        </div>
                      )}
                      <Badge variant="outline" className={`text-[10px] ${TONE_BADGE[stage.tone] || TONE_BADGE.professional}`}>{describeStage(stage)}</Badge>
                      <div className="ml-auto flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <Switch checked={stage.enabled} onCheckedChange={(v) => updateStage(stage.id, { enabled: v })} data-testid={`stage-enabled-${stage.id}`} />
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-slate-300" onClick={() => openPreview(stage)} data-testid={`stage-preview-${stage.id}`}>Preview</Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-500 hover:text-rose-300" onClick={() => removeStage(stage.id)} aria-label="Remove stage" title="Remove stage">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
                      <div className="space-y-3">
                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-slate-500">Tone</Label>
                          <Select value={stage.tone} onValueChange={(v) => updateStage(stage.id, { tone: v })}>
                            <SelectTrigger className="mt-1 h-8 text-xs" data-testid={`stage-tone-${stage.id}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {TONE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-slate-500">Subject</Label>
                          <Input className="mt-1 h-8 text-xs" value={stage.subject} onChange={(e) => updateStage(stage.id, { subject: e.target.value })} data-testid={`stage-subject-${stage.id}`} />
                        </div>
                      </div>
                      <div>
                        <Label className="text-[10px] uppercase tracking-wider text-slate-500">Message</Label>
                        <Textarea className="mt-1 min-h-[110px] resize-none text-xs leading-5" value={stage.message} onChange={(e) => updateStage(stage.id, { message: e.target.value })} data-testid={`stage-message-${stage.id}`} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule">
          <Card className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[linear-gradient(145deg,rgba(24,25,32,0.98),rgba(15,17,23,0.98))]">
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-white">Scheduled reminders</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Every upcoming automated reminder across your unpaid invoices.</p>
                </div>
                <Badge variant="outline" className="border-amber-400/25 bg-amber-500/[0.07] text-[10px] text-amber-100">{schedule?.automation === "active" ? "Automation active" : "Automation paused"}</Badge>
              </div>
              {(schedule?.items || []).length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Balance</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Next reminder</TableHead>
                      <TableHead>Plan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(schedule?.items || []).map((row) => (
                      <TableRow key={row.invoice_id} data-testid={`reminder-schedule-${row.invoice_id}`}>
                        <TableCell className="font-mono text-xs">{row.invoice_number}</TableCell>
                        <TableCell className="text-xs">{row.client_name}</TableCell>
                        <TableCell className="font-mono text-xs">{row.balance}</TableCell>
                        <TableCell className="text-xs">{row.due_date}</TableCell>
                        <TableCell>
                          <p className="text-xs font-medium text-emerald-200">{row.next_reminder_date}</p>
                          <p className="text-[10px] text-slate-500">{row.next_reminder_label}</p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(row.plan || []).map((step) => (
                              <span key={`${row.invoice_id}-${step.stage_id}-${step.date}`} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] text-slate-300" title={step.date}>{step.label}</span>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="px-5 py-10 text-center text-sm text-slate-500">No reminders scheduled — enable the programme or check that unpaid invoices have due dates.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[linear-gradient(145deg,rgba(24,25,32,0.98),rgba(15,17,23,0.98))]">
            <CardContent className="p-0">
              <div className="border-b border-white/[0.07] px-5 py-4">
                <p className="text-sm font-semibold text-white">Reminder history</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Every automated and manual reminder, with delivery evidence.</p>
              </div>
              {history.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sent</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Delivery</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((entry) => (
                      <TableRow key={entry.id} data-testid={`reminder-history-${entry.id}`}>
                        <TableCell className="text-xs whitespace-nowrap">{String(entry.sent_at || "").slice(0, 16).replace("T", " ")}</TableCell>
                        <TableCell className="font-mono text-xs">{entry.invoice_number}</TableCell>
                        <TableCell className="text-xs">{entry.client_name}</TableCell>
                        <TableCell className="text-xs">{entry.stage_label}</TableCell>
                        <TableCell className="text-xs">{entry.to_email}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[9px] ${entry.delivery === "failed" ? "border-rose-400/30 bg-rose-500/[0.08] text-rose-200" : "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-200"}`}>{entry.delivery || "sent"}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="px-5 py-10 text-center text-sm text-slate-500">No reminders sent yet. Run the programme or wait for the next automated pass.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!previewStage} onOpenChange={(open) => { if (!open) { setPreviewStage(null); setPreview(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4 text-emerald-300" />Reminder preview — {describeStage(previewStage || {})}</DialogTitle>
            <DialogDescription>Rendered with sample values so you can check tone and wording before enabling the stage.</DialogDescription>
          </DialogHeader>
          {previewing ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : preview ? (
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Subject</p>
                <p className="mt-1 rounded-lg border border-white/[0.08] bg-black/[0.14] px-3 py-2 text-sm text-slate-100">{preview.subject}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Message</p>
                <p className="mt-1 whitespace-pre-wrap rounded-lg border border-white/[0.08] bg-black/[0.14] px-3 py-2 text-sm leading-6 text-slate-200">{preview.message}</p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPreviewStage(null); setPreview(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
