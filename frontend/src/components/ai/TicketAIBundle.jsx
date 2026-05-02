import { useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Copy, Users, Mail, BookPlus, Activity } from "lucide-react";
import { toast } from "sonner";

/** Three buttons + dialogs for ticket detail toolbar:
 *  Doppelgänger · Apology · Promote-to-Runbook. (Timeline is its own tab.) */
export function TicketAIBundle({ ticket }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [view, setView] = useState(null); // null | "doppel" | "apology" | "runbook"
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const open = async (kind) => {
    setView(kind); setData(null); setLoading(true);
    try {
      let r;
      if (kind === "doppel") r = await axios.get(`${API}/tickets/${ticket.id}/doppelganger`, { headers });
      else if (kind === "apology") r = await axios.post(`${API}/tickets/${ticket.id}/apology-draft`, {}, { headers });
      else if (kind === "runbook") r = await axios.post(`${API}/runbooks/from-ticket/${ticket.id}`, { publish: true }, { headers });
      setData(r.data);
      if (kind === "runbook") toast.success(`Runbook published: ${r.data.title}`);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); setView(null); }
    finally { setLoading(false); }
  };

  const copy = (txt) => navigator.clipboard.writeText(txt).then(() => toast.success("Copied"));
  const isResolved = ["resolved", "closed"].includes(ticket?.status);

  return (
    <>
      <Button variant="outline" size="sm" className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
        onClick={() => open("doppel")} data-testid="ai-doppelganger-btn">
        <Users className="w-3.5 h-3.5 mr-1" />Doppelgänger
      </Button>
      <Button variant="outline" size="sm" className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
        onClick={() => open("apology")} data-testid="ai-apology-btn">
        <Mail className="w-3.5 h-3.5 mr-1" />Apology AI
      </Button>
      {isResolved && (
        <Button variant="outline" size="sm" className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
          onClick={() => open("runbook")} data-testid="ai-runbook-btn">
          <BookPlus className="w-3.5 h-3.5 mr-1" />To Runbook
        </Button>
      )}

      <Dialog open={!!view} onOpenChange={(v) => !v && setView(null)}>
        <DialogContent className="max-w-2xl" data-testid="ai-bundle-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              {view === "doppel" && "Similar resolved tickets"}
              {view === "apology" && "AI Apology Draft"}
              {view === "runbook" && "Runbook published"}
            </DialogTitle>
          </DialogHeader>

          {loading && <div className="py-10 flex flex-col items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin text-violet-400" />Working…</div>}

          {!loading && view === "doppel" && data && (
            <div className="space-y-2">
              {data.matches?.length === 0 ? <div className="text-sm text-muted-foreground py-6 text-center">No similar resolved tickets found.</div> :
                data.matches.map((m) => (
                  <Link key={m.ticket_id} to={`/tickets?ticket=${m.ticket_id}`} className="block border rounded-md p-3 hover:bg-muted/40" data-testid={`doppel-${m.ticket_id}`}>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2"><span className="font-mono text-muted-foreground">{m.ticket_number}</span><span className="font-medium">{m.title}</span></div>
                      <Badge variant="outline" className="text-violet-400 border-violet-500/40">{m.similarity}% match</Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">{m.client_name} · {m.category || "—"}</div>
                    {m.resolution_summary && <div className="text-xs mt-2 line-clamp-3 text-muted-foreground italic">"{m.resolution_summary}"</div>}
                  </Link>
                ))
              }
              {data.common_category && <div className="text-[11px] text-muted-foreground">Likely common category: <Badge variant="outline">{data.common_category}</Badge></div>}
            </div>
          )}

          {!loading && view === "apology" && data && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {data.sla_breached && <Badge variant="outline" className="text-rose-400 border-rose-500/40">SLA breached</Badge>}
                {data.tone && <Badge variant="outline" className="text-violet-400 border-violet-500/40">tone: {data.tone}</Badge>}
              </div>
              <div className="border rounded-md p-3 bg-muted/20">
                <div className="text-[10px] uppercase text-muted-foreground">Subject</div>
                <div className="text-sm font-medium" data-testid="apology-subject">{data.subject}</div>
              </div>
              <div className="border rounded-md p-3 bg-muted/20 whitespace-pre-wrap text-sm" data-testid="apology-body">{data.body}</div>
              {data.makegood && <div className="text-xs"><span className="text-rose-400 font-semibold">Make-good offered:</span> {data.makegood}</div>}
            </div>
          )}

          {!loading && view === "runbook" && data && (
            <div className="space-y-2 text-sm" data-testid="runbook-published">
              <div className="font-semibold">{data.title}</div>
              {data.summary && <p className="text-xs text-muted-foreground">{data.summary}</p>}
              <ol className="list-decimal pl-6 space-y-1.5 text-xs">
                {(data.steps || []).map((s, i) => (<li key={`k-${i}`}><span className="font-medium">{s.step}</span> — <span className="text-muted-foreground">{s.detail}</span></li>))}
              </ol>
              <div className="flex flex-wrap gap-1 mt-2">{(data.tags || []).map(t => <Badge key={t} variant="outline" className="text-[10px]">#{t}</Badge>)}</div>
              <Link to="/insights" className="text-xs text-violet-400 hover:underline inline-flex items-center gap-1"><Activity className="w-3 h-3" />View in Runbook Marketplace</Link>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setView(null)}>Close</Button>
            {view === "apology" && data && !loading && (
              <Button variant="outline" className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                onClick={() => copy(`Subject: ${data.subject}\n\n${data.body}`)} data-testid="apology-copy">
                <Copy className="w-3.5 h-3.5 mr-1" />Copy Email
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
