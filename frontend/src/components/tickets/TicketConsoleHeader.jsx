import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { TICKET_PRIORITY_STYLES, TICKET_STATUS_STYLES } from "@/lib/ticketWorkspaceHelpers";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { ServiceTierChip } from "@/components/tickets/TicketServiceTierWidget";
import TicketHeaderAction from "@/components/tickets/TicketHeaderAction";
import {
  ArrowLeft, ChevronRight, MoreVertical, MessageSquareReply, CheckCircle2, AlertTriangle,
  Building2, UserCircle2, Mail, Loader2, History, Search,
  ArrowLeftRight, Bookmark, X, RotateCcw, Wrench, Receipt, Play, Square, PackagePlus, Link2, Shield,
} from "lucide-react";

const STATUS_FLOW = ["open", "in_progress", "on_hold", "resolved", "closed"];

export default function TicketConsoleHeader({
  ticket,
  clients = [],
  onBack,
  onReply,
  onResolve,
  onStatusChange,
  onRequestResolution,
  onChangeCustomer,
  onMoreAction,
  onOpenTools,
  onOpenSiteEvidence,
  onInvoice,
  onAddItems,
  itemCount = 0,
  focusMode = false,
  onToggleFocus,
  onCatchUp,
  onTitleSave,
  onDescriptionSave,
  onMutate,
  isTimerRunning = false,
  timerElapsed = 0,
  onToggleTimer,
  onStartWork,
  onPinObject,
}) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [changeOpen, setChangeOpen] = useState(false);
  const [titleEdit, setTitleEdit] = useState(false);
  const [titleDraft, setTitleDraft] = useState(ticket?.title || "");
  const [descriptionEdit, setDescriptionEdit] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(ticket?.description || "");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [resolutionTarget, setResolutionTarget] = useState(null);

  useEffect(() => { setTitleDraft(ticket?.title || ""); }, [ticket?.title]);
  useEffect(() => { setDescriptionDraft(ticket?.description || ""); }, [ticket?.description]);

  const loadHistory = async () => {
    try {
      const r = await axios.get(`${API}/tickets/${ticket.id}/customer-history`, { headers });
      setHistory(r.data || []);
      setHistoryOpen(true);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const revert = async (confirmed = false) => {
    if (!confirmed) { setConfirmRevert(true); return; }
    try {
      const r = await axios.post(`${API}/tickets/${ticket.id}/revert-customer`, {}, { headers });
      toast.success(`Reverted to ${r.data.ticket?.client_name || "previous customer"}`);
      setConfirmRevert(false);
      onMutate && onMutate();
      setHistoryOpen(false);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const sla = ticket?.sla_status || ticket?.sla;
  const overdue = (ticket?.sla_overdue_hours || 0) > 0 || sla === "breached" || sla === "overdue";
  const hasHistory = (ticket?.customer_history || []).length > 0;
  const isClosed = ticket?.status === "closed";
  const isResolved = ticket?.status === "resolved";
  const isActiveTicket = !isResolved && !isClosed;
  const signal = ["resolved", "closed"].includes(ticket?.status) ? "healthy" : ticket?.status === "on_hold" ? "attention" : ticket?.status === "in_progress" ? "working" : overdue ? "critical" : "recommendation";
  const formatElapsed = (seconds) => {
    const total = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return [hours, minutes, secs].map(value => String(value).padStart(2, "0")).join(":");
  };
  const requestResolution = (target) => {
    if (onRequestResolution) {
      onRequestResolution(ticket, target);
      return;
    }
    setResolutionTarget(target);
  };
  const saveTitle = () => {
    const nextTitle = titleDraft.trim();
    if (nextTitle && nextTitle !== (ticket?.title || "")) onTitleSave?.(nextTitle);
    setTitleEdit(false);
  };
  const saveDescription = () => {
    const nextDescription = descriptionDraft.trim();
    if (nextDescription !== (ticket?.description || "")) onDescriptionSave?.(nextDescription);
    setDescriptionEdit(false);
  };

  const copyTicketLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(`${window.location.origin}/tickets?ticket=${encodeURIComponent(ticket.id)}`);
      toast.success(`${ticket.ticket_number || "Ticket"} link copied`);
    } catch {
      toast.error("This browser blocked clipboard access");
    }
  };

  if (!ticket) return null;

  const ownerName = ticket.assigned_name || "Unassigned";
  const ownerInitials = ownerName.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();
  const lastUpdated = ticket.last_activity_at || ticket.updated_at;

  return (
    <>
      <Card className="nx-ticket-docket relative overflow-hidden rounded-2xl border border-white/[0.09] bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.13),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_30%),linear-gradient(135deg,rgba(17,19,24,0.98),rgba(9,12,17,0.99))] shadow-[0_22px_65px_rgba(0,0,0,0.28)]" data-nx-signal={signal} data-testid="ticket-console-header">
        <span aria-hidden="true" className="pointer-events-none absolute -right-3 -top-4 select-none font-mono text-[68px] font-semibold tracking-[-0.08em] text-white/[0.025] sm:text-[92px]">
          {ticket.ticket_number || ""}
        </span>
        <div className="relative p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <Button variant="ghost" size="sm" className="h-8 w-8 rounded-lg p-0 text-zinc-400 hover:bg-white/[0.06] hover:text-white" onClick={onBack} data-testid="ticket-back-btn" aria-label="Back to ticket queue" title="Back to ticket queue">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <span className="font-mono text-[11px] font-semibold tracking-[0.03em] text-cyan-200">{ticket.ticket_number || ticket.id?.slice(0, 8)}</span>
            <span className="h-3 w-px bg-white/[0.10]" aria-hidden="true" />
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
              <span className={`h-1.5 w-1.5 rounded-full ${isResolved || isClosed ? "bg-zinc-500" : "bg-emerald-400"}`} aria-hidden="true" />
              {isClosed ? "Closed record" : isResolved ? "Resolved record" : `Live ${ticket.ticket_type?.replace("_", " ") || "incident"}`}
            </span>
            <Badge className={`h-5 px-2 text-[9px] uppercase tracking-[0.11em] font-semibold ${TICKET_PRIORITY_STYLES[ticket.priority]?.badge || TICKET_PRIORITY_STYLES.medium.badge}`}>
              {ticket.priority || "medium"}
            </Badge>
            <Badge className={`h-5 px-2 text-[9px] uppercase tracking-[0.11em] ${TICKET_STATUS_STYLES[ticket.status] || TICKET_STATUS_STYLES.open}`}>
              {(ticket.status || "open").replace("_", " ")}
            </Badge>
            {overdue && (
              <Badge className="h-5 border-rose-400/35 bg-rose-500/15 px-2 text-[9px] uppercase tracking-[0.08em] text-rose-200">
                <AlertTriangle className="mr-1 h-3 w-3" />SLA breached
              </Badge>
            )}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="flex min-w-0 items-start gap-3">
              <button
                type="button"
                onClick={() => setChangeOpen(true)}
                className="group/logo mt-0.5 grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/[0.10] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:border-cyan-300/30 hover:bg-cyan-400/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 sm:h-11 sm:w-11"
                title="Change customer"
                aria-label={`Change customer for ${ticket.client_name || "this ticket"}`}
                data-testid="ticket-customer-logo"
              >
                {ticket.client_logo_url ? (
                  <img src={ticket.client_logo_url} alt="" className="h-full w-full bg-white object-contain p-1.5" />
                ) : (
                  <span className="font-mono text-sm font-semibold text-cyan-100">{(ticket.client_name || "?").slice(0, 1).toUpperCase()}</span>
                )}
              </button>

              <div className="min-w-0 flex-1">
                {titleEdit ? (
                  <Input
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                      if (e.key === "Escape") { e.preventDefault(); setTitleDraft(ticket.title || ""); setTitleEdit(false); }
                    }}
                    className="h-11 border-cyan-400/30 bg-zinc-950 text-2xl font-semibold tracking-[-0.03em]"
                    autoFocus
                    data-testid="console-title-input"
                  />
                ) : (
                  <button
                    type="button"
                    className="block max-w-full text-left text-[26px] font-semibold leading-[1.15] tracking-[-0.035em] text-white transition-colors hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 sm:text-[30px]"
                    onClick={() => setTitleEdit(true)}
                    title="Edit ticket title"
                    aria-label="Edit ticket title"
                    data-testid="console-title"
                  >
                    <span className="line-clamp-2">{ticket.title || "Untitled ticket"}</span>
                  </button>
                )}
                {descriptionEdit ? (
                  <Textarea value={descriptionDraft} onChange={(e) => setDescriptionDraft(e.target.value)} onBlur={saveDescription} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setDescriptionDraft(ticket.description || ""); setDescriptionEdit(false); } if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} rows={2} className="mt-2 min-h-16 resize-none border-cyan-500/25 bg-zinc-950 text-sm" autoFocus data-testid="console-description-input" />
                ) : (
                  <button
                    type="button"
                    onClick={() => setDescriptionEdit(true)}
                    className="mt-1.5 block max-w-[76ch] text-left text-[12px] leading-5 text-zinc-400 transition-colors hover:text-cyan-100"
                    title="Click to edit description"
                    data-testid="console-description"
                  >
                    <span className="line-clamp-2">{ticket.description || "Add a ticket description"}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
              <TicketHeaderAction icon={MessageSquareReply} tone="primary" onClick={onReply} data-testid="console-reply-btn">Update client</TicketHeaderAction>
              <TicketHeaderAction
                icon={isTimerRunning ? Square : Play}
                tone={isTimerRunning ? "warning" : "compact"}
                onClick={onToggleTimer}
                aria-label={isTimerRunning ? `Stop timer at ${formatElapsed(timerElapsed)}` : "Start time tracking"}
                title={isTimerRunning ? `Stop timer at ${formatElapsed(timerElapsed)}` : "Start time tracking"}
                data-testid="console-timer-btn"
              >{isTimerRunning ? formatElapsed(timerElapsed) : "Start timer"}</TicketHeaderAction>
              {isActiveTicket && <TicketHeaderAction icon={Wrench} tone="accent" onClick={onStartWork} className="hidden sm:inline-flex" data-testid="console-start-work-btn">Start work</TicketHeaderAction>}
              {isActiveTicket && <TicketHeaderAction icon={CheckCircle2} tone="success" onClick={() => requestResolution("resolved")} data-testid="console-resolve-btn">Resolve</TicketHeaderAction>}
              {isResolved && <TicketHeaderAction icon={CheckCircle2} tone="success" onClick={() => requestResolution("closed")} data-testid="console-resolve-btn">Close ticket</TicketHeaderAction>}
              {isClosed && <TicketHeaderAction icon={RotateCcw} tone="warning" onClick={() => requestResolution("reopen")} data-testid="console-reopen-btn">Reopen</TicketHeaderAction>}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <TicketHeaderAction icon={MoreVertical} tone="compact" aria-label="More ticket actions" title="More ticket actions" data-testid="console-more-btn" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Quick actions</DropdownMenuLabel>
                  {isActiveTicket && <DropdownMenuItem onClick={onStartWork} className="sm:hidden"><Wrench className="w-3.5 h-3.5 mr-2" />Start work</DropdownMenuItem>}
                  {onCatchUp && <DropdownMenuItem onClick={onCatchUp} data-testid="ticket-catch-up"><History className="w-3.5 h-3.5 mr-2" />Catch me up</DropdownMenuItem>}
                  {onAddItems && <DropdownMenuItem onClick={onAddItems} data-testid="console-add-items-btn"><PackagePlus className="w-3.5 h-3.5 mr-2" />Add products{itemCount > 0 ? ` · ${itemCount}` : ""}</DropdownMenuItem>}
                  {onToggleFocus && <DropdownMenuItem onClick={onToggleFocus} data-testid="ticket-focus-toggle">{focusMode ? <Search className="w-3.5 h-3.5 mr-2" /> : <Wrench className="w-3.5 h-3.5 mr-2" />}{focusMode ? "Show full context" : "Focus view"}</DropdownMenuItem>}
                  <DropdownMenuItem onClick={onOpenTools} data-testid="console-tools-btn"><Wrench className="w-3.5 h-3.5 mr-2" />Tools & integrations</DropdownMenuItem>
                  {onOpenSiteEvidence && <DropdownMenuItem onClick={onOpenSiteEvidence} data-testid="console-site-evidence-btn"><Shield className="w-3.5 h-3.5 mr-2" />Site & privilege evidence</DropdownMenuItem>}
                  <DropdownMenuItem onClick={onInvoice} data-testid="console-invoice-btn"><Receipt className="w-3.5 h-3.5 mr-2" />Review billing</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onMoreAction?.("transfer")}><ArrowLeftRight className="w-3.5 h-3.5 mr-2" />Reassign technician</DropdownMenuItem>
                  <DropdownMenuItem onClick={copyTicketLink} data-testid="console-copy-link"><Link2 className="w-3.5 h-3.5 mr-2" />Copy ticket link</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onPinObject?.()} data-testid="pin-ticket-object"><Bookmark className="w-3.5 h-3.5 mr-2" />Pin to Object Dock</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setChangeOpen(true)} data-testid="more-change-customer"><Building2 className="w-3.5 h-3.5 mr-2" />Change customer…</DropdownMenuItem>
                  {hasHistory && <DropdownMenuItem onClick={loadHistory}><History className="w-3.5 h-3.5 mr-2" />Customer history</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/[0.07] pt-3 text-[11px]">
            <button
              className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-white/[0.08] bg-black/15 px-2 text-zinc-200 transition-colors hover:border-cyan-300/25 hover:bg-cyan-400/[0.06]"
              onClick={() => setChangeOpen(true)}
              data-testid="customer-pill"
              title="Click to change customer"
            >
              <Building2 className="h-3 w-3 text-cyan-300/80" />
              <span className="truncate">{ticket.client_name || "No customer"}</span>
              <ArrowLeftRight className="h-3 w-3 opacity-50" />
            </button>

            <ServiceTierChip ticketId={ticket.id} token={token} />

            {(ticket.contact_name || ticket.contact_email) && (
              <span className="flex min-w-0 items-center gap-1.5 text-zinc-400" title={[ticket.contact_name, ticket.contact_email].filter(Boolean).join(" · ")}>
                <UserCircle2 className="h-3 w-3 shrink-0 text-zinc-500" />
                <span className="max-w-[160px] truncate">{ticket.contact_name || ticket.contact_email}</span>
                {ticket.contact_name && ticket.contact_email && <Mail className="h-3 w-3 shrink-0 text-zinc-600" aria-hidden="true" />}
              </span>
            )}

            <span className={`inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2 ${ticket.assigned_name ? "border-white/[0.08] bg-black/15 text-zinc-300" : "border-amber-400/20 bg-amber-400/[0.06] text-amber-200"}`} data-testid="ticket-owner" title={ticket.assigned_name ? `Assigned to ${ticket.assigned_name}` : "No technician assigned"}>
              <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[8px] font-semibold ${ticket.assigned_name ? "bg-cyan-400/15 text-cyan-100" : "bg-amber-400/15 text-amber-100"}`}>{ownerInitials || "?"}</span>
              <span className="max-w-[120px] truncate">{ownerName}</span>
            </span>

            {lastUpdated && (
              <span className="hidden items-center gap-1.5 text-zinc-500 sm:flex" title={new Date(lastUpdated).toLocaleString()}>
                <History className="h-3 w-3" />Updated {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}
              </span>
            )}

            {hasHistory && (
              <button onClick={loadHistory} className="flex items-center gap-1 text-[10px] text-amber-300 hover:underline" data-testid="customer-history-link">
                <History className="h-3 w-3" />Customer changed {ticket.customer_history.length}×
              </button>
            )}

            <div className="nx-ticket-pipeline ml-auto flex max-w-full items-center gap-0.5 overflow-x-auto pb-0.5" aria-label="Status pipeline">
              {STATUS_FLOW.map((s, i) => {
                const active = s === ticket.status;
                const past = STATUS_FLOW.indexOf(ticket.status) > i;
                return (
                  <button
                    key={s}
                    onClick={() => ["resolved", "closed"].includes(s) ? requestResolution(s) : onStatusChange?.(s)}
                    disabled={active}
                    aria-current={active ? "step" : undefined}
                    className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[9px] uppercase tracking-[0.09em] transition-colors ${
                      active ? "cursor-default bg-white/[0.11] text-white ring-1 ring-white/[0.13]" :
                      past ? "text-emerald-300/65 hover:bg-emerald-500/[0.06]" :
                      "text-zinc-600 hover:bg-white/[0.05] hover:text-zinc-300"
                    }`}
                    data-testid={`pipeline-step-${s}`}
                  >
                    {s.replace("_", " ")}
                    {i < STATUS_FLOW.length - 1 && <ChevronRight className="ml-0.5 inline h-2.5 w-2.5 opacity-35" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      <ChangeCustomerDialog
        open={changeOpen}
        onClose={() => setChangeOpen(false)}
        ticket={ticket}
        clients={clients}
        onChanged={(updated) => { onChangeCustomer?.(updated); onMutate?.(); setChangeOpen(false); }}
      />

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <NexusWorkflowDialog
          className="max-w-lg"
          eyebrow="Ticket relationship · audit evidence"
          title="Customer change history"
          description="Every customer reassignment is recorded before the ticket relationship changes."
          icon={History}
          tone="amber"
          data-testid="customer-history-dialog"
          footer={<>{hasHistory && <Button variant="outline" onClick={revert} className="text-amber-300 border-amber-500/30" data-testid="revert-customer-btn"><RotateCcw className="w-3 h-3 mr-1" />Revert last</Button>}<Button onClick={() => setHistoryOpen(false)}>Close</Button></>}
        >
          {history.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No changes yet.</p> :
            <ScrollArea className="max-h-64">
              <div className="space-y-2">
                {history.slice().reverse().map((h) => (
                  <div key={h.id} className="text-xs p-2 rounded bg-muted/30">
                    <div className="flex items-center gap-1 font-medium">
                      <span className="text-zinc-400">{h.from_client_name || "—"}</span>
                      <ChevronRight className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-300">{h.to_client_name}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(h.ts).toLocaleString()} · {h.changed_by}
                      {h.reason && <span className="ml-1">— {h.reason}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          }
        </NexusWorkflowDialog>
      </Dialog>
      <Dialog open={confirmRevert} onOpenChange={setConfirmRevert}>
        <NexusWorkflowDialog
          eyebrow="Ticket relationship"
          title="Revert to the previous customer?"
          description="This changes the ticket's customer relationship back to the previous recorded assignment and adds a durable audit entry."
          icon={RotateCcw}
          tone="amber"
          footer={<><Button variant="outline" onClick={() => setConfirmRevert(false)}>Keep current customer</Button><Button onClick={() => revert(true)}>Revert customer</Button></>}
        >
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4"><p className="font-medium">{ticket.ticket_number || ticket.id?.slice(0, 8)}</p><p className="mt-1 text-sm text-muted-foreground">Current customer: {ticket.client_name || "Unassigned"}. Review the customer history before reversing the assignment.</p></div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={Boolean(resolutionTarget)} onOpenChange={(open) => !open && setResolutionTarget(null)}>
        <NexusWorkflowDialog
          eyebrow="Ticket resolution"
          title={resolutionTarget === "closed" ? "Close this ticket?" : "Resolve this ticket?"}
          description={resolutionTarget === "closed" ? "Closing preserves the complete service record and removes the ticket from active operational queues." : "Confirm the issue is fixed before Nexus records the resolution and moves it out of the active queue."}
          icon={CheckCircle2}
          tone="emerald"
          footer={<><Button variant="outline" onClick={() => setResolutionTarget(null)}>Keep working</Button><Button onClick={() => { if (resolutionTarget === "resolved") onResolve?.(); else onStatusChange?.("closed"); setResolutionTarget(null); }} data-testid="confirm-ticket-resolution">{resolutionTarget === "closed" ? "Close ticket" : "Confirm resolution"}</Button></>}
        >
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
            <p className="font-medium">{ticket.ticket_number || ticket.id?.slice(0, 8)} · {ticket.title || "Untitled ticket"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{resolutionTarget === "closed" ? "The service record, timeline and billing history remain available after close." : "Make sure the customer impact is resolved, the work is recorded and any required customer update has been sent."}</p>
          </div>
        </NexusWorkflowDialog>
      </Dialog>
    </>
  );
}


// ─────────── Change Customer Dialog ───────────
function ChangeCustomerDialog({ open, onClose, ticket, clients, onChanged }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [q, setQ] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [contacts, setContacts] = useState([]);
  const [contactId, setContactId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setQ(""); setSelectedClientId(""); setContactId(""); setReason(""); setContacts([]);
    }
  }, [open]);

  useEffect(() => {
    if (!selectedClientId) { setContacts([]); return; }
    axios.get(`${API}/clients/${selectedClientId}/contacts`, { headers })
      .then(r => setContacts(r.data || []))
      .catch(() => setContacts([]));
  }, [selectedClientId, headers]);

  const filtered = useMemo(() => {
    if (!q.trim()) return clients.slice(0, 50);
    const Q = q.toLowerCase();
    return clients.filter(c => (c.name || "").toLowerCase().includes(Q) || (c.email || "").toLowerCase().includes(Q)).slice(0, 50);
  }, [q, clients]);

  const submit = async () => {
    if (!selectedClientId) { toast.error("Pick a customer"); return; }
    if (selectedClientId === ticket.client_id) { toast.error("Already assigned to this customer"); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/tickets/${ticket.id}/change-customer`, {
        client_id: selectedClientId,
        contact_id: contactId || undefined,
        reason: reason || undefined,
      }, { headers });
      toast.success(`Reassigned to ${r.data.ticket?.client_name}`);
      onChanged && onChanged(r.data.ticket);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  if (!ticket) return null;
  const selectedClient = clients.find(c => c.id === selectedClientId);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <NexusWorkflowDialog
        className="max-w-xl"
        eyebrow="Ticket relationship · audited reassignment"
        title="Change customer"
        description={`Reassign ${ticket.ticket_number || ticket.id?.slice(0, 8)} from ${ticket.client_name || "an unassigned customer"}. Nexus records the history and posts an internal comment.`}
        icon={Building2}
        tone="emerald"
        data-testid="change-customer-dialog"
        footer={<><Button variant="outline" onClick={onClose}><X className="w-3 h-3 mr-1" />Cancel</Button><Button onClick={submit} disabled={busy || !selectedClientId} className="bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/40" data-testid="change-customer-submit">{busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ArrowLeftRight className="w-3 h-3 mr-1" />}Reassign</Button></>}
      >

        <div className="space-y-3">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search customers…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-7"
              data-testid="change-customer-search"
              autoFocus
            />
          </div>

          <ScrollArea className="h-56 border border-zinc-800 rounded">
            {filtered.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No matches</p> :
              <div className="divide-y divide-zinc-900">
                {filtered.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedClientId(c.id)}
                    className={`w-full text-left p-2 hover:bg-emerald-500/5 ${selectedClientId === c.id ? "bg-emerald-500/10 ring-1 ring-emerald-500/30" : ""}`}
                    data-testid={`change-cust-row-${c.id}`}
                  >
                    <div className="font-medium text-sm flex items-center gap-2">
                      <Building2 className="w-3 h-3 text-emerald-400" />{c.name}
                      {ticket.client_id === c.id && <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-300">current</Badge>}
                    </div>
                    {(c.email || c.phone) && <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{c.email || ""} {c.phone ? " · " + c.phone : ""}</div>}
                  </button>
                ))}
              </div>
            }
          </ScrollArea>

          {selectedClient && contacts.length > 0 && (
            <div>
              <Label className="text-xs">Optional: pick a primary contact for {selectedClient.name}</Label>
              <ScrollArea className="max-h-28 border border-zinc-800 rounded mt-1">
                <div className="divide-y divide-zinc-900">
                  {contacts.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setContactId(contactId === c.id ? "" : c.id)}
                      className={`w-full text-left p-1.5 text-xs hover:bg-emerald-500/5 ${contactId === c.id ? "bg-emerald-500/10" : ""}`}
                    >
                      <span className="font-medium">{c.name}</span> <span className="text-muted-foreground text-[10px]">· {c.email || c.phone || ""}</span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <div>
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. ticket was raised against wrong customer; correct customer is …"
              rows={2}
              data-testid="change-customer-reason"
            />
          </div>
        </div>

      </NexusWorkflowDialog>
    </Dialog>
  );
}
