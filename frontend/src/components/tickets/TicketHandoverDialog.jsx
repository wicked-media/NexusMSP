import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Dialog } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Button } from "@/components/ui/button";
import { History, Loader2 } from "lucide-react";

export default function TicketHandoverDialog({ open, onOpenChange, ticket, headers, onOpenActivity, onOpenChild }) {
  const [hours, setHours] = useState("24");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || !ticket?.id) return;
    const controller = new AbortController();
    setLoading(true); setData(null); setError("");
    axios.get(`${API}/tickets/${ticket.id}/handover?hours=${hours}`, { headers, signal: controller.signal, timeout: 15000 })
      .then(response => { if (!controller.signal.aborted) setData(response.data); })
      .catch(() => { if (!controller.signal.aborted) setError("Handover could not be loaded. Your ticket is unchanged."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, ticket?.id, hours, headers, retry]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <NexusWorkflowDialog title="Catch me up" eyebrow={`${ticket?.ticket_number || "Ticket"} · Recorded handover`} icon={History}
      description="A factual briefing for picking up the work. Nothing is sent, changed or marked as read."
      className="max-w-3xl" footer={<><Button variant="outline" onClick={() => { onOpenChange(false); onOpenActivity(); }}>Open ticket activity</Button><Button onClick={() => onOpenChange(false)}>Back to work</Button></>}>
      <div className="space-y-5" data-testid="ticket-handover">
        <div className="flex flex-wrap items-center justify-between gap-3"><label className="text-sm font-medium" htmlFor="handover-window">Notes to review</label>
          <select id="handover-window" value={hours} onChange={event => setHours(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="24">Last 24 hours</option><option value="168">Last 7 days</option><option value="0">Recent history (up to 200 notes)</option></select>
        </div>
        {loading && <p role="status" className="flex gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Reading recorded evidence…</p>}
        {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Retry</Button></div>}
        {data && <>
          <section className="rounded-xl border border-border p-4 space-y-2"><h3 className="text-sm font-semibold">The request <span className="ml-2 text-xs font-normal text-muted-foreground">{String(data.status || "not recorded").replace(/_/g, " ")}</span></h3><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{data.request || "No request description recorded."}</p></section>
          <section className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-4" data-testid="handover-subscribers"><h3 className="text-sm font-semibold">Following this work</h3><p className="mt-1 text-xs text-muted-foreground">These technicians receive recorded ticket updates for continuity across handover.</p><div className="mt-3 flex flex-wrap gap-2">{data.subscribers?.length ? data.subscribers.map(subscriber => <span key={subscriber.user_id} className="rounded-full border border-violet-400/25 bg-violet-400/10 px-2.5 py-1 text-xs text-violet-100">{subscriber.user?.name || "Technician"}</span>) : <span className="text-sm text-muted-foreground">No subscribers yet.</span>}</div></section>
          <section className="space-y-2"><h3 className="text-sm font-semibold">What still needs attention</h3>
            {data.blocker && <p className="text-sm text-amber-300">Recorded dependency: {data.blocker}</p>}
            {data.open_children.map(child => <button key={child.id} className="block w-full rounded-lg border border-border p-3 text-left text-sm hover:bg-muted/40" onClick={() => { onOpenChange(false); onOpenChild(child.id); }}>{child.number} · {child.title}<span className="ml-2 text-xs text-muted-foreground">{child.status}</span></button>)}
            {!data.blocker && !data.open_children.length && <p className="text-sm text-muted-foreground">No open child work or numbered blocker found. This does not prove the ticket is ready to close.</p>}
          </section>
          <section className="space-y-3"><h3 className="text-sm font-semibold">Recorded updates <span className="text-muted-foreground">· {data.matching_note_count}</span></h3>
            {!data.evidence.length && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No dated notes in this window. Try Recent history or review the full activity.</p>}
            {data.evidence.map(note => <article key={note.id} className="rounded-xl border border-border p-4 space-y-2"><div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{note.author || "Author not recorded"} · {note.internal ? "Internal" : "Customer-visible"}</span><time>{new Date(note.created_at).toLocaleString()}</time></div><p className="whitespace-pre-wrap text-sm leading-6">{note.text || "No text content."}</p><Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => { onOpenChange(false); onOpenActivity(note.id); }}>View source note</Button></article>)}
          </section>
          {data.resolution && <section className="space-y-2"><h3 className="text-sm font-semibold">Recorded resolution · not independently verified</h3><p className="text-sm whitespace-pre-wrap">{data.resolution}</p></section>}
          <p className="text-xs leading-5 text-muted-foreground">{data.scope}{data.limited ? " Results are capped; review full activity for the complete record." : ""}{data.undated_notes ? ` ${data.undated_notes} undated notes excluded.` : ""}</p>
        </>}
      </div>
    </NexusWorkflowDialog>
  </Dialog>;
}
