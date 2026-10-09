import { useEffect, useState } from "react";
import { CheckCircle2, FileText, Receipt, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";

export default function TicketResolutionReviewDialog({ review, onOpenChange, onConfirm, busy = false }) {
  const tickets = review?.tickets || [];
  const isBulk = tickets.length > 1;
  const isClose = review?.target === "closed";
  const isReopen = review?.target === "reopen";
  const shownTickets = tickets.slice(0, 4);
  const remaining = tickets.length - shownTickets.length;
  const activeTicketId = review?.tickets?.[0]?.id;
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [customerOutcome, setCustomerOutcome] = useState("");

  useEffect(() => {
    setSummary(""); setReason(""); setCustomerOutcome("");
  }, [activeTicketId, review?.target]);

  const evidenceReady = isReopen ? Boolean(reason.trim()) : Boolean(summary.trim() && reason.trim());

  return (
    <Dialog open={Boolean(review)} onOpenChange={(open) => !open && onOpenChange(false)}>
      <NexusWorkflowDialog
        className="max-w-xl"
        eyebrow={isBulk ? "Bulk ticket transition" : "Ticket resolution"}
        title={isBulk ? `Close ${tickets.length} selected tickets?` : isReopen ? "Reopen this ticket?" : isClose ? "Close this ticket?" : "Resolve this ticket?"}
        description={isBulk
          ? "Review the affected service records before Nexus removes them from active operational queues."
          : isReopen
            ? "Reopening returns this request to the active queue while keeping the prior resolution evidence visible."
            : isClose
            ? "Closing preserves the service record, timeline and billing history."
            : "Confirm the issue is fixed before Nexus records the resolution and moves it out of active work."}
        icon={CheckCircle2}
        tone="emerald"
        data-testid="ticket-resolution-review"
        footer={<>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Keep working</Button>
          <Button onClick={() => onConfirm({ resolution_summary: summary.trim(), closure_reason: reason.trim(), customer_outcome: customerOutcome.trim() })} disabled={busy || tickets.length === 0 || !evidenceReady} data-testid="confirm-ticket-resolution-review">
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            {busy ? "Recording transition…" : isBulk ? `Close ${tickets.length} tickets` : isReopen ? "Reopen ticket" : isClose ? "Close ticket" : "Confirm resolution"}
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-200">Records in this transition</p>
            <div className="mt-2 space-y-1.5">
              {shownTickets.map((ticket) => (
                <div key={ticket.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-zinc-100">{ticket.ticket_number || ticket.id?.slice(0, 8)} · {ticket.title || "Untitled ticket"}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">{String(ticket.status || "open").replace("_", " ")}</span>
                </div>
              ))}
              {remaining > 0 && <p className="pt-1 text-xs text-zinc-400">+ {remaining} more selected record{remaining === 1 ? "" : "s"}</p>}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <ReviewCheck icon={FileText} title="Customer update" detail="No message is sent automatically." />
            <ReviewCheck icon={Receipt} title="Time & billing" detail="Recorded work remains available for review." />
            <ReviewCheck icon={Users} title="Service history" detail="Ownership and audit evidence are retained." />
          </div>

          <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.035] p-4">
            {isReopen ? <div><Label htmlFor="ticket-closure-reason">Why is this work being reopened?</Label><Textarea id="ticket-closure-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1.5 min-h-24" placeholder="Describe the new impact or unfinished work." /></div> : <><div><Label htmlFor="ticket-resolution-summary">Resolution summary</Label><Textarea id="ticket-resolution-summary" value={summary} onChange={(event) => setSummary(event.target.value)} className="mt-1.5 min-h-24" placeholder="What was fixed, changed, or confirmed?" /></div><div><Label htmlFor="ticket-closure-reason">Closure reason</Label><Input id="ticket-closure-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1.5" placeholder="e.g. Resolved remotely" /></div><div><Label htmlFor="ticket-customer-outcome">Customer outcome <span className="text-muted-foreground">optional</span></Label><Textarea id="ticket-customer-outcome" value={customerOutcome} onChange={(event) => setCustomerOutcome(event.target.value)} className="mt-1.5 min-h-16" placeholder="What the requester was told or confirmed." /></div></>}
          </div>

          <p className="text-xs leading-5 text-muted-foreground">
            This transition is recorded against every affected ticket. Use the ticket workspace when a customer update, resolution note or billing follow-up is still required.
          </p>
        </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

function ReviewCheck({ icon: Icon, title, detail }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/[0.12] p-3">
      <Icon className="h-3.5 w-3.5 text-emerald-300" />
      <p className="mt-2 text-xs font-medium text-zinc-200">{title}</p>
      <p className="mt-0.5 text-[10px] leading-4 text-zinc-500">{detail}</p>
    </div>
  );
}
