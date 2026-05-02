import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, BellRing, Loader2, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

export function InvoiceAIBundle({ invoiceId }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const open = async (kind) => {
    setView(kind); setData(null); setLoading(true);
    try {
      const r = kind === "audit"
        ? await axios.post(`${API}/invoices/${invoiceId}/audit`, {}, { headers })
        : await axios.get(`${API}/invoices/${invoiceId}/reminder-strategy`, { headers });
      setData(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); setView(null); }
    finally { setLoading(false); }
  };

  return (
    <>
      <Button variant="outline" size="sm" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
        onClick={() => open("audit")} data-testid={`audit-btn-${invoiceId}`}>
        <ClipboardCheck className="w-3.5 h-3.5 mr-1" />Pre-bill Audit
      </Button>
      <Button variant="outline" size="sm" className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
        onClick={() => open("reminder")} data-testid={`reminder-strategy-btn-${invoiceId}`}>
        <BellRing className="w-3.5 h-3.5 mr-1" />Smart Reminder
      </Button>

      <Dialog open={!!view} onOpenChange={(v) => !v && setView(null)}>
        <DialogContent className="max-w-lg" data-testid="invoice-ai-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2">
            {view === "audit" ? <><ClipboardCheck className="w-4 h-4 text-emerald-400" />Pre-bill Audit</> : <><BellRing className="w-4 h-4 text-amber-400" />Smart Reminder Strategy</>}
          </DialogTitle></DialogHeader>

          {loading && <div className="py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" />Working…</div>}

          {!loading && view === "audit" && data && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={data.ready_to_send ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" : "text-rose-400 border-rose-500/40 bg-rose-500/10"}>
                  {data.ready_to_send ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                  {data.ready_to_send ? "Ready to send" : "Issues found"}
                </Badge>
                <Badge variant="outline">Quality score {data.score}/100</Badge>
                <Badge variant="outline" className="text-muted-foreground">scanned {data.scanned_tickets} tickets</Badge>
              </div>
              {data.flags?.length === 0 ? <div className="text-emerald-400 text-xs py-3">All clean — no flags raised.</div> :
                <div className="space-y-2">
                  {data.flags.map((f, i) => (
                    <div key={`k-${i}`} className={`border rounded-md p-2 text-xs ${f.severity === "error" ? "border-rose-500/40 bg-rose-500/5" : "border-amber-500/40 bg-amber-500/5"}`} data-testid={`audit-flag-${f.code}`}>
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className={`w-3 h-3 ${f.severity === "error" ? "text-rose-400" : "text-amber-400"}`} />
                        <span>{f.code}</span>
                      </div>
                      <div className="mt-1">{f.message}</div>
                      {(f.details || []).slice(0, 5).map((d, j) => (
                        <div key={`d-${j}`} className="text-[10px] text-muted-foreground mt-1">· {d.ticket_number} {d.title} ({d.billable_minutes}m)</div>
                      ))}
                    </div>
                  ))}
                </div>
              }
            </div>
          )}

          {!loading && view === "reminder" && data && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-amber-400 border-amber-500/40">{data.pattern}</Badge>
                {data.avg_days_late !== null && <Badge variant="outline">avg {data.avg_days_late}d after due</Badge>}
                <Badge variant="outline" className="text-muted-foreground">history: {data.history_size} invoices</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="border rounded p-3"><div className="text-[10px] uppercase text-muted-foreground">First reminder</div><div className="text-base font-mono">{data.recommended.first_reminder_days_after_due}d after due</div></div>
                <div className="border rounded p-3"><div className="text-[10px] uppercase text-muted-foreground">Tone</div><div className="text-base font-mono capitalize">{data.recommended.tone}</div></div>
                <div className="border rounded p-3"><div className="text-[10px] uppercase text-muted-foreground">Channel</div><div className="text-base font-mono">{data.recommended.channel}</div></div>
                <div className="border rounded p-3"><div className="text-[10px] uppercase text-muted-foreground">Cadence</div><div className="text-base font-mono">{(data.recommended.follow_up_cadence_days || []).join("d → ")}d</div></div>
              </div>
              <div className="text-[11px] text-muted-foreground">Tip: this client {data.pattern.replace("-", " ")} — adjust your dunning workflow accordingly.</div>
            </div>
          )}

          <DialogFooter><Button variant="outline" onClick={() => setView(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
