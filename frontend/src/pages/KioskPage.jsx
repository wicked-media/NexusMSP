/** Public Walk-in Kiosk page (zero-auth tablet UI). Route: /kiosk/:kioskToken */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { TabletSmartphone, Loader2, CheckCircle2, MessageSquare, FileText, Receipt } from "lucide-react";

export default function KioskPage() {
  const { kioskToken } = useParams();
  const [stage, setStage] = useState("identify");  // 'identify' | 'dashboard'
  const [email, setEmail] = useState("");
  const [client, setClient] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    if (!email) { toast.error("Please enter your email"); return; }
    setLoading(true);
    try {
      const r = await axios.post(`${API}/kiosk/lookup`, { kiosk_token: kioskToken, email });
      setClient(r.data);
      const dash = await axios.get(`${API}/kiosk/${kioskToken}/dashboard?client_id=${r.data.client_id}`);
      setData(dash.data);
      setStage("dashboard");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };

  const approveEstimate = async (estId) => {
    try {
      await axios.post(`${API}/kiosk/${kioskToken}/estimate/${estId}/approve`, { approver_name: client?.client_name });
      toast.success("Approved");
      const dash = await axios.get(`${API}/kiosk/${kioskToken}/dashboard?client_id=${client.client_id}`);
      setData(dash.data);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const reset = () => { setStage("identify"); setEmail(""); setClient(null); setData(null); };

  if (stage === "identify") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-8" data-testid="kiosk-identify">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto">
            <TabletSmartphone className="w-10 h-10 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-3xl font-light">Welcome</h1>
            <p className="text-sm text-muted-foreground mt-2">Enter your work email to view your tickets, estimates, and invoices.</p>
          </div>
          <div className="space-y-3 text-left">
            <Label className="text-xs">Email</Label>
            <Input
              type="email" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
              placeholder="you@company.com"
              className="h-12 text-base"
              data-testid="kiosk-email-input"
            />
            <Button
              onClick={lookup} disabled={loading || !email}
              className="w-full h-12 text-base bg-emerald-500 hover:bg-emerald-400"
              data-testid="kiosk-lookup-btn"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Continue
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-6" data-testid="kiosk-dashboard">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-emerald-400">Welcome</div>
            <h1 className="text-3xl font-light">{client?.client_name}</h1>
          </div>
          <Button variant="outline" onClick={reset} data-testid="kiosk-reset-btn">Sign out</Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <KioskList icon={<MessageSquare className="w-4 h-4" />} title={`Open tickets (${data?.tickets?.length || 0})`} accent="sky">
            {(data?.tickets || []).map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm py-1">
                <div>
                  <div className="font-medium">#{t.ticket_number} {t.title}</div>
                  <div className="text-[10px] text-muted-foreground">{t.priority} · {t.status} · {t.assignee_name || "unassigned"}</div>
                </div>
              </div>
            ))}
            {(data?.tickets?.length || 0) === 0 && <div className="text-xs text-muted-foreground">No open tickets</div>}
          </KioskList>

          <KioskList icon={<FileText className="w-4 h-4" />} title={`Estimates (${data?.estimates?.length || 0})`} accent="violet">
            {(data?.estimates || []).map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-sm py-1">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{e.estimate_number || e.title}</div>
                  <div className="text-[10px] text-muted-foreground">${e.total} · {e.status}</div>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-[10px] text-emerald-400 border-emerald-500/30" onClick={() => approveEstimate(e.id)} data-testid={`kiosk-approve-${e.id}`}>
                  <CheckCircle2 className="w-3 h-3 mr-1" />Approve
                </Button>
              </div>
            ))}
            {(data?.estimates?.length || 0) === 0 && <div className="text-xs text-muted-foreground">No pending estimates</div>}
          </KioskList>

          <KioskList icon={<Receipt className="w-4 h-4" />} title={`Unpaid invoices (${data?.invoices?.length || 0})`} accent="amber">
            {(data?.invoices || []).map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-2 text-sm py-1">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{inv.invoice_number}</div>
                  <div className="text-[10px] text-muted-foreground">${inv.total} · due {(inv.due_date || "").slice(0, 10)}</div>
                </div>
                {inv.payment_link && (
                  <a href={inv.payment_link} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline" className="h-7 text-[10px] text-emerald-400 border-emerald-500/30">Pay</Button>
                  </a>
                )}
              </div>
            ))}
            {(data?.invoices?.length || 0) === 0 && <div className="text-xs text-muted-foreground">No unpaid invoices</div>}
          </KioskList>
        </div>
      </div>
    </div>
  );
}

function KioskList({ icon, title, accent, children }) {
  const tone = { sky: "border-sky-500/30 text-sky-400", violet: "border-violet-500/30 text-violet-400", amber: "border-amber-500/30 text-amber-400" }[accent];
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className={`text-[10px] uppercase tracking-widest flex items-center gap-2 ${tone}`}>{icon}{title}</div>
        <div className="space-y-1 divide-y divide-zinc-800">{children}</div>
      </CardContent>
    </Card>
  );
}
