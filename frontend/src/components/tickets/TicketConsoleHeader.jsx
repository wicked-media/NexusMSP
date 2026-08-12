import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { TICKET_PRIORITY_STYLES, TICKET_STATUS_STYLES } from "@/lib/ticketWorkspaceHelpers";
import { ServiceTierChip } from "@/components/tickets/TicketServiceTierWidget";
import TicketHeaderAction from "@/components/tickets/TicketHeaderAction";
import {
  ArrowLeft, ChevronRight, MoreVertical, MessageSquareReply, CheckCircle2, AlertTriangle,
  Building2, UserCircle2, Mail, Loader2, History, Search,
  ArrowLeftRight, Bookmark, X, RotateCcw, Wrench, Receipt, Play, Square,
} from "lucide-react";

const STATUS_FLOW = ["open", "in_progress", "on_hold", "resolved", "closed"];

export default function TicketConsoleHeader({
  ticket,
  clients = [],
  onBack,
  onReply,
  onResolve,
  onStatusChange,
  onChangeCustomer,
  onMoreAction,
  onOpenTools,
  onInvoice,
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

  useEffect(() => { setTitleDraft(ticket?.title || ""); }, [ticket?.title]);
  useEffect(() => { setDescriptionDraft(ticket?.description || ""); }, [ticket?.description]);

  const loadHistory = async () => {
    try {
      const r = await axios.get(`${API}/tickets/${ticket.id}/customer-history`, { headers });
      setHistory(r.data || []);
      setHistoryOpen(true);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const revert = async () => {
    if (!window.confirm("Revert to previous customer?")) return;
    try {
      const r = await axios.post(`${API}/tickets/${ticket.id}/revert-customer`, {}, { headers });
      toast.success(`Reverted to ${r.data.ticket?.client_name || "previous customer"}`);
      onMutate && onMutate();
      setHistoryOpen(false);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const sla = ticket?.sla_status || ticket?.sla;
  const overdue = (ticket?.sla_overdue_hours || 0) > 0 || sla === "breached" || sla === "overdue";
  const hasHistory = (ticket?.customer_history || []).length > 0;
  const signal = ["resolved", "closed"].includes(ticket?.status) ? "healthy" : ticket?.status === "on_hold" ? "attention" : ticket?.status === "in_progress" ? "working" : overdue ? "critical" : "recommendation";
  const formatElapsed = (seconds) => {
    const total = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return [hours, minutes, secs].map(value => String(value).padStart(2, "0")).join(":");
  };

  if (!ticket) return null;

  return (
    <>
      <Card className="nx-ambient-surface sticky top-0 z-30 overflow-hidden rounded-2xl border border-white/[0.09] bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_30%),linear-gradient(135deg,rgba(17,19,24,0.98),rgba(10,12,17,0.98))] shadow-[0_22px_65px_rgba(0,0,0,0.34)] backdrop-blur-xl" data-nx-signal={signal} data-testid="ticket-console-header">
        <CardContent className="p-4 space-y-3">
          {/* Row 1 — Back · ID · Priority · Title · Primary actions · More */}
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-cyan-300/85"><span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>Live service record <span className="text-zinc-600">/</span><span className="text-zinc-400">{ticket.ticket_type?.replace("_", " ") || "incident"}</span></div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button variant="ghost" size="sm" className="h-9 w-9 rounded-lg p-0 text-zinc-400 hover:bg-white/[0.06] hover:text-white" onClick={onBack} data-testid="ticket-back-btn" aria-label="Back to ticket queue" title="Back to ticket queue">
              <ArrowLeft className="w-4 h-4" />
            </Button>

            <Badge className="h-6 px-2.5 text-[10px] font-mono tracking-wide bg-black/30 text-zinc-200 border-white/[0.10]">
              {ticket.ticket_number || ticket.id?.slice(0, 8)}
            </Badge>

            <Badge className={`h-6 px-2.5 text-[9px] uppercase tracking-[0.13em] font-semibold ${TICKET_PRIORITY_STYLES[ticket.priority]?.badge || TICKET_PRIORITY_STYLES.medium.badge}`}>
              {ticket.priority || "medium"}
            </Badge>

            <Badge className={`h-6 px-2.5 text-[9px] uppercase tracking-[0.13em] ${TICKET_STATUS_STYLES[ticket.status] || TICKET_STATUS_STYLES.open}`}>
              {(ticket.status || "open").replace("_", " ")}
            </Badge>

            {overdue && (
              <Badge className="h-6 border-rose-400/40 bg-rose-500/20 px-2.5 text-[9px] uppercase tracking-[0.1em] text-rose-100 animate-pulse">
                <AlertTriangle className="w-3 h-3 mr-1" />SLA Breached
              </Badge>
            )}

            {/* Title (click-to-edit) */}
            <div className="order-last basis-full min-w-0 pt-1 lg:order-none lg:basis-auto lg:flex-1 lg:mx-2">
              {titleEdit ? (
                <Input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => { onTitleSave?.(titleDraft); setTitleEdit(false); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { onTitleSave?.(titleDraft); setTitleEdit(false); }
                    if (e.key === "Escape") { setTitleDraft(ticket.title || ""); setTitleEdit(false); }
                  }}
                  className="h-10 text-xl font-semibold bg-zinc-950 border-emerald-500/30"
                  autoFocus
                  data-testid="console-title-input"
                />
              ) : (
                <h2
                  className="text-xl md:text-2xl font-semibold tracking-tight text-white truncate cursor-pointer hover:text-emerald-200 transition-colors"
                  onClick={() => setTitleEdit(true)}
                  title="Click to edit"
                  data-testid="console-title"
                >
                  {ticket.title || "Untitled ticket"}
                </h2>
              )}
              {descriptionEdit ? (
                <Textarea value={descriptionDraft} onChange={(e) => setDescriptionDraft(e.target.value)} onBlur={() => { onDescriptionSave?.(descriptionDraft); setDescriptionEdit(false); }} onKeyDown={(e) => { if (e.key === "Escape") { setDescriptionDraft(ticket.description || ""); setDescriptionEdit(false); } }} rows={2} className="mt-2 min-h-16 resize-none border-cyan-500/25 bg-zinc-950 text-sm" autoFocus data-testid="console-description-input" />
              ) : (
                <button type="button" onClick={() => setDescriptionEdit(true)} className="mt-1.5 block max-w-full truncate text-left text-xs text-zinc-400 transition-colors hover:text-cyan-100" title="Click to edit description" data-testid="console-description">{ticket.description || "Add a ticket description"}</button>
              )}
            </div>

            <TicketHeaderAction icon={MessageSquareReply} onClick={onReply} data-testid="console-reply-btn">Reply</TicketHeaderAction>
            <TicketHeaderAction
              icon={isTimerRunning ? Square : Play}
              tone={isTimerRunning ? "warning" : "compact"}
              onClick={onToggleTimer}
              title={isTimerRunning ? `Stop timer at ${formatElapsed(timerElapsed)}` : "Start time tracking"}
              data-testid="console-timer-btn"
            >{isTimerRunning ? formatElapsed(timerElapsed) : "Start timer"}</TicketHeaderAction>
            <TicketHeaderAction icon={Wrench} tone="accent" onClick={onStartWork} data-testid="console-start-work-btn">Start work</TicketHeaderAction>
            <TicketHeaderAction icon={Receipt} tone="success" onClick={onInvoice} data-testid="console-invoice-btn">Invoice</TicketHeaderAction>
            <TicketHeaderAction icon={CheckCircle2} tone="success" onClick={onResolve} data-testid="console-resolve-btn">Resolve & close</TicketHeaderAction>
            <TicketHeaderAction icon={Wrench} tone="accent" onClick={onOpenTools} data-testid="console-tools-btn">Tools</TicketHeaderAction>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <TicketHeaderAction icon={MoreVertical} tone="compact" aria-label="More ticket actions" title="More ticket actions" data-testid="console-more-btn" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Quick actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onMoreAction?.("transfer")}><ArrowLeftRight className="w-3.5 h-3.5 mr-2" />Reassign technician</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onPinObject?.()} data-testid="pin-ticket-object"><Bookmark className="w-3.5 h-3.5 mr-2" />Pin to Object Dock</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChangeOpen(true)} data-testid="more-change-customer"><Building2 className="w-3.5 h-3.5 mr-2" />Change customer…</DropdownMenuItem>
                {hasHistory && <DropdownMenuItem onClick={loadHistory}><History className="w-3.5 h-3.5 mr-2" />Customer history</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Row 2 — Customer · Contact · Status pipeline (slim) */}
          <div className="flex items-center gap-3 flex-wrap border-t border-white/[0.08] pt-3 text-xs">
            <button
              className="flex h-7 items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.10] px-2.5 hover:bg-emerald-500/[0.16] transition-colors text-emerald-100 font-medium"
              onClick={() => setChangeOpen(true)}
              data-testid="customer-pill"
              title="Click to change customer"
            >
              {ticket.client_logo_url ? (
                <img src={ticket.client_logo_url} alt="" className="h-4 w-4 rounded bg-white object-contain p-0.5" />
              ) : <Building2 className="w-3 h-3" />}
              <span>{ticket.client_name || "No customer"}</span>
              <ArrowLeftRight className="w-3 h-3 opacity-60" />
            </button>

            <ServiceTierChip ticketId={ticket.id} token={token} />

            {ticket.contact_name && (
              <span className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800/60 text-zinc-300">
                <UserCircle2 className="w-3 h-3" />{ticket.contact_name}
              </span>
            )}

            {ticket.contact_email && (
              <span className="flex items-center gap-1 text-zinc-500 font-mono text-[10px]"><Mail className="w-3 h-3" />{ticket.contact_email}</span>
            )}

            {hasHistory && (
              <button onClick={loadHistory} className="flex items-center gap-1 text-[10px] text-amber-400 hover:underline" data-testid="customer-history-link">
                <History className="w-3 h-3" />Customer changed {ticket.customer_history.length}×
              </button>
            )}

            <div className="ml-auto flex items-center gap-1">
              {STATUS_FLOW.map((s, i) => {
                const active = s === ticket.status;
                const past = STATUS_FLOW.indexOf(ticket.status) > i;
                return (
                  <button
                    key={s}
                    onClick={() => onStatusChange?.(s)}
                className={`text-[10px] uppercase tracking-[0.1em] px-2 py-1 rounded-md transition-colors ${
                      active ? "bg-white/[0.12] text-white ring-1 ring-white/[0.14]" :
                      past ? "text-emerald-300/70 hover:bg-emerald-500/[0.06]" :
                      "text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300"
                    }`}
                    data-testid={`pipeline-step-${s}`}
                  >
                    {s.replace("_", " ")}
                    {i < STATUS_FLOW.length - 1 && <ChevronRight className="inline w-2.5 h-2.5 ml-0.5 opacity-40" />}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <ChangeCustomerDialog
        open={changeOpen}
        onClose={() => setChangeOpen(false)}
        ticket={ticket}
        clients={clients}
        onChanged={(updated) => { onChangeCustomer?.(updated); onMutate?.(); setChangeOpen(false); }}
      />

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg" data-testid="customer-history-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="w-4 h-4 text-amber-400" />Customer Change History</DialogTitle>
            <DialogDescription>Every customer reassignment is logged.</DialogDescription>
          </DialogHeader>
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
          <DialogFooter>
            {hasHistory && <Button variant="outline" onClick={revert} className="text-amber-300 border-amber-500/30" data-testid="revert-customer-btn"><RotateCcw className="w-3 h-3 mr-1" />Revert last</Button>}
            <Button onClick={() => setHistoryOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
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
      <DialogContent className="max-w-xl" data-testid="change-customer-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Building2 className="w-5 h-5 text-emerald-400" />Change Customer</DialogTitle>
          <DialogDescription>
            Reassign <b>{ticket.ticket_number || ticket.id?.slice(0, 8)}</b> from <b className="text-zinc-300">{ticket.client_name || "—"}</b> to another customer.
            History is logged and a comment is auto-posted.
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}><X className="w-3 h-3 mr-1" />Cancel</Button>
          <Button onClick={submit} disabled={busy || !selectedClientId} className="bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/40" data-testid="change-customer-submit">
            {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ArrowLeftRight className="w-3 h-3 mr-1" />}Reassign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
