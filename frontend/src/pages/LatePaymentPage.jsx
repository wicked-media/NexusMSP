import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { DollarSign, AlertTriangle, Clock, Send, Loader2, Mail, History, TrendingDown } from "lucide-react";
import { buildLatePaymentReminderPayload } from "@/lib/latePaymentPayloads";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import BillingWorkspaceNav from "@/components/billing/BillingWorkspaceNav";

export default function LatePaymentPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("predictions");
  const [predictions, setPredictions] = useState(null);
  const [overdue, setOverdue] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendDialog, setSendDialog] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const requestHeaders = { Authorization: `Bearer ${token}` };
    Promise.all([
      axios.get(`${API}/late-payment/predictions`, { headers: requestHeaders }),
      axios.get(`${API}/late-payment/overdue-invoices`, { headers: requestHeaders }),
      axios.get(`${API}/late-payment/reminder-history`, { headers: requestHeaders }).catch(() => ({ data: [] })),
    ]).then(([pRes, oRes, hRes]) => {
      setPredictions(pRes.data);
      setOverdue(oRes.data);
      setHistory(hRes.data || []);
    }).finally(() => setLoading(false));
  }, [token]);

  const sendReminder = async () => {
    if (!sendDialog) return;
    const inv = sendDialog.invoices?.[0] || {};
    if (!inv.id) {
      toast.error("This invoice needs to be refreshed before Nexus can send a reminder.");
      return;
    }
    setSending(true);
    try {
      const response = await axios.post(
        `${API}/late-payment/send-reminder`,
        buildLatePaymentReminderPayload(inv.id),
        { headers },
      );
      toast.success(response.data?.message || "Payment reminder processed using the verified billing contact.");
      setSendDialog(null);
      // Refresh history
      const hRes = await axios.get(`${API}/late-payment/reminder-history`, { headers }).catch(() => ({ data: [] }));
      setHistory(hRes.data || []);
    } catch { toast.error("Failed to send reminder"); }
    finally { setSending(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const ps = predictions?.summary || {};
  const os = overdue?.summary || {};

  return (
    <div className="space-y-5" data-testid="late-payment-page">
      <OperationalPageHeader eyebrow="Revenue operations · payment follow-up" title="Late Payment Manager" description="Prioritise overdue invoices, explain late-payment risk and send auditable reminders." icon={Clock} tone="amber" signal={(ps.high_risk || os.count) > 0 ? "attention" : "ready"} />

      <BillingWorkspaceNav />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Card className="border-red-500/20"><CardContent className="pt-4 pb-3"><AlertTriangle className="w-5 h-5 text-red-400 mb-1" /><p className="text-2xl font-bold text-red-400">{ps.high_risk || 0}</p><p className="text-[11px] text-muted-foreground">High Risk Clients</p></CardContent></Card>
        <Card className="border-orange-500/20"><CardContent className="pt-4 pb-3"><Clock className="w-5 h-5 text-orange-400 mb-1" /><p className="text-2xl font-bold text-orange-400">{ps.medium_risk || 0}</p><p className="text-[11px] text-muted-foreground">Medium Risk</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><DollarSign className="w-5 h-5 text-amber-400 mb-1" /><p className="text-2xl font-bold">${(ps.total_at_risk || 0).toLocaleString()}</p><p className="text-[11px] text-muted-foreground">At Risk Amount</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><TrendingDown className="w-5 h-5 text-red-400 mb-1" /><p className="text-2xl font-bold">{os.count || 0}</p><p className="text-[11px] text-muted-foreground">Overdue Invoices</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><Mail className="w-5 h-5 text-blue-400 mb-1" /><p className="text-2xl font-bold">{history.length}</p><p className="text-[11px] text-muted-foreground">Reminders Sent</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="predictions"><AlertTriangle className="w-3 h-3 mr-1" />Risk Predictions ({predictions?.predictions?.length || 0})</TabsTrigger>
          <TabsTrigger value="overdue"><Clock className="w-3 h-3 mr-1" />Overdue Invoices ({os.count || 0})</TabsTrigger>
          <TabsTrigger value="history"><History className="w-3 h-3 mr-1" />Reminder History ({history.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="predictions" className="space-y-3">
          {(predictions?.predictions || []).map(p => (
            <Card key={p.id} className={p.risk === "high" ? "border-red-500/30" : p.risk === "medium" ? "border-orange-500/30" : "border-border/40"} data-testid={`prediction-${p.id}`}>
              <CardContent className="py-3">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${p.risk === "high" ? "bg-red-500/15" : p.risk === "medium" ? "bg-orange-500/15" : "bg-green-500/15"}`}>
                    <DollarSign className={`w-5 h-5 ${p.risk === "high" ? "text-red-400" : p.risk === "medium" ? "text-orange-400" : "text-green-400"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{p.client_name}</span>
                      <Badge variant={p.risk === "high" ? "destructive" : "secondary"} className="text-[10px] capitalize">{p.risk} risk</Badge>
                      <span className="text-xs text-muted-foreground">{p.probability_pct}% probability</span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      Outstanding: <span className="font-mono font-medium text-foreground">${p.outstanding_amount.toLocaleString()}</span>
                      {p.max_days_overdue > 0 && <> &middot; Max overdue: <span className="text-red-400">{p.max_days_overdue}d</span></>}
                      {p.overdue_count > 0 && <> &middot; {p.overdue_count} overdue invoices</>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.recommended_action}</p>
                  </div>
                  {p.risk !== "none" && (
                    <Button size="sm" variant={p.risk === "high" ? "default" : "outline"} onClick={() => setSendDialog(p)} data-testid={`send-reminder-${p.id}`}>
                      <Send className="w-3 h-3 mr-1" />Send Reminder
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {(!predictions?.predictions?.length) && <p className="text-center text-muted-foreground py-8">No late payment risks detected. All invoices are on track!</p>}
        </TabsContent>

        <TabsContent value="overdue">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Invoice #</TableHead><TableHead>Client</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Days Overdue</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(overdue?.overdue || []).map(inv => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-sm">{inv.invoice_number}</TableCell>
                  <TableCell className="font-medium">{inv.client_name}</TableCell>
                  <TableCell className="text-sm">{inv.due_date}</TableCell>
                  <TableCell className="text-right font-mono text-amber-400">${inv.balance_due?.toLocaleString()}</TableCell>
                  <TableCell className="text-right"><Badge variant="destructive" className="text-[10px]">{inv.days_overdue}d</Badge></TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => setSendDialog({ client_name: inv.client_name, outstanding_amount: inv.balance_due, max_days_overdue: inv.days_overdue, invoices: [{ id: inv.id, number: inv.invoice_number, due_date: inv.due_date, days_overdue: inv.days_overdue }] })}><Send className="w-3 h-3" /></Button></TableCell>
                </TableRow>
              ))}
              {(!overdue?.overdue?.length) && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No overdue invoices!</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="history">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Client</TableHead><TableHead>Invoice</TableHead><TableHead>Sent To</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Sent By</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {history.map(h => (
                <TableRow key={h.id}>
                  <TableCell className="text-sm">{h.sent_at?.slice(0, 10)}</TableCell>
                  <TableCell className="font-medium">{h.client_name}</TableCell>
                  <TableCell className="font-mono text-sm">{h.invoice_number}</TableCell>
                  <TableCell className="text-sm">{h.to_email}</TableCell>
                  <TableCell className="text-right font-mono">${h.amount?.toLocaleString()}</TableCell>
                  <TableCell><Badge variant={h.email_status === "sent" ? "default" : "secondary"} className="text-[10px]">{h.email_status}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{h.sent_by}</TableCell>
                </TableRow>
              ))}
              {history.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No reminders sent yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>

      {/* Send Reminder Dialog */}
      <Dialog open={!!sendDialog} onOpenChange={v => !v && setSendDialog(null)}>
        <DialogContent className="flex h-[min(620px,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl" aria-describedby="send-reminder-desc" data-testid="late-payment-reminder-dialog">
          <DialogHeader className="shrink-0 border-b border-border/70 bg-muted/20 px-5 py-5 pr-12">
            <DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5" />Send Payment Reminder</DialogTitle>
            <DialogDescription id="send-reminder-desc">Nexus verifies the invoice and uses the customer&apos;s approved billing contact before delivery.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5">
            <div className="p-3 rounded-lg bg-muted/30 border">
              <p className="font-medium">{sendDialog?.client_name}</p>
              <p className="text-sm text-muted-foreground">Outstanding: ${sendDialog?.outstanding_amount?.toLocaleString()} &middot; {sendDialog?.max_days_overdue || 0} days overdue</p>
            </div>
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-3 text-sm text-muted-foreground" data-testid="canonical-recipient-notice">
              The recipient, amount due and payment link are verified from Nexus billing records when you send this reminder.
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t border-border/70 bg-muted/10 px-5 py-4">
            <Button variant="ghost" onClick={() => setSendDialog(null)}>Cancel</Button>
            <Button onClick={sendReminder} disabled={sending} data-testid="confirm-send-reminder">
              {sending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}Send Reminder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
