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
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronRight, MoreVertical, MessageSquareReply, CheckCircle2, AlertTriangle,
  Building2, UserCircle2, Mail, FileText, Calendar, Loader2, Sparkles, History, Search,
  ArrowLeftRight, X, Send, Volume2, Brain, Receipt, Code2, Zap, RotateCcw,
} from "lucide-react";

const STATUS_FLOW = ["open", "in_progress", "on_hold", "resolved", "closed"];

const PRIORITY_STYLES = {
  critical: "bg-rose-500/25 text-rose-200 border-rose-500/40",
  high: "bg-amber-500/25 text-amber-200 border-amber-500/40",
  medium: "bg-cyan-500/20 text-cyan-200 border-cyan-500/30",
  low: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
};

const STATUS_STYLES = {
  open: "bg-cyan-500/20 text-cyan-200 border-cyan-500/30",
  in_progress: "bg-violet-500/25 text-violet-200 border-violet-500/40",
  on_hold: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  resolved: "bg-emerald-500/25 text-emerald-200 border-emerald-500/40",
  closed: "bg-zinc-600/20 text-zinc-400 border-zinc-600/30",
};

export default function TicketConsoleHeader({
  ticket,
  clients = [],
  onBack,
  onReply,
  onResolve,
  onStatusChange,
  onChangeCustomer,
  onMoreAction,
  onTitleSave,
  onMutate,
}) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [changeOpen, setChangeOpen] = useState(false);
  const [titleEdit, setTitleEdit] = useState(false);
  const [titleDraft, setTitleDraft] = useState(ticket?.title || "");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => { setTitleDraft(ticket?.title || ""); }, [ticket?.title]);

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

  if (!ticket) return null;

  return (
    <>
      <Card className="bg-gradient-to-br from-slate-900/95 via-slate-900/90 to-slate-950/95 border border-emerald-500/15 sticky top-0 z-30" data-testid="ticket-console-header">
        <CardContent className="p-3 space-y-2">
          {/* Row 1 — Back · ID · Priority · Title · Primary actions · More */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onBack} data-testid="ticket-back-btn">
              <ArrowLeft className="w-4 h-4" />
            </Button>

            <Badge className="text-[10px] font-mono bg-zinc-800 text-zinc-300 border-zinc-700">
              {ticket.ticket_number || ticket.id?.slice(0, 8)}
            </Badge>

            <Badge className={`text-[10px] uppercase tracking-wider font-medium ${PRIORITY_STYLES[ticket.priority] || PRIORITY_STYLES.medium}`}>
              {ticket.priority || "medium"}
            </Badge>

            <Badge className={`text-[10px] uppercase tracking-wider ${STATUS_STYLES[ticket.status] || STATUS_STYLES.open}`}>
              {(ticket.status || "open").replace("_", " ")}
            </Badge>

            {overdue && (
              <Badge className="text-[10px] bg-rose-500/20 text-rose-200 border-rose-500/40 animate-pulse">
                <AlertTriangle className="w-3 h-3 mr-1" />SLA Breached
              </Badge>
            )}

            {/* Title (click-to-edit) */}
            <div className="flex-1 min-w-0 mx-2">
              {titleEdit ? (
                <Input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => { onTitleSave?.(titleDraft); setTitleEdit(false); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { onTitleSave?.(titleDraft); setTitleEdit(false); }
                    if (e.key === "Escape") { setTitleDraft(ticket.title || ""); setTitleEdit(false); }
                  }}
                  className="h-8 text-base font-medium bg-zinc-950 border-emerald-500/30"
                  autoFocus
                  data-testid="console-title-input"
                />
              ) : (
                <h2
                  className="text-base md:text-lg font-medium text-zinc-100 truncate cursor-pointer hover:text-emerald-300 transition-colors"
                  onClick={() => setTitleEdit(true)}
                  title="Click to edit"
                  data-testid="console-title"
                >
                  {ticket.title || "Untitled ticket"}
                </h2>
              )}
            </div>

            {/* Primary actions */}
            <Button size="sm" variant="outline" className="text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15" onClick={onReply} data-testid="console-reply-btn">
              <MessageSquareReply className="w-3.5 h-3.5 mr-1" />Reply
            </Button>
            <Button size="sm" variant="outline" className="text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15" onClick={onResolve} data-testid="console-resolve-btn">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />Resolve
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" data-testid="console-more-btn"><MoreVertical className="w-3.5 h-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Quick actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onMoreAction?.("transfer")}><ArrowLeftRight className="w-3.5 h-3.5 mr-2" />Transfer to tech</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChangeOpen(true)} data-testid="more-change-customer"><Building2 className="w-3.5 h-3.5 mr-2" />Change customer…</DropdownMenuItem>
                {hasHistory && <DropdownMenuItem onClick={loadHistory}><History className="w-3.5 h-3.5 mr-2" />Customer history</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">AI & Tools</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onMoreAction?.("craig")}><Brain className="w-3.5 h-3.5 mr-2" />C.R.A.I.G analyse</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMoreAction?.("copilot")}><Sparkles className="w-3.5 h-3.5 mr-2" />AI Co-Pilot</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMoreAction?.("explain")}><Code2 className="w-3.5 h-3.5 mr-2" />Explain error</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMoreAction?.("voice")}><Volume2 className="w-3.5 h-3.5 mr-2" />Voice Journal</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMoreAction?.("why_fire")}><Zap className="w-3.5 h-3.5 mr-2" />Why on fire?</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Output</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onMoreAction?.("email")}><Send className="w-3.5 h-3.5 mr-2" />Email customer</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMoreAction?.("pdf")}><FileText className="w-3.5 h-3.5 mr-2" />Export PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMoreAction?.("billing")}><Receipt className="w-3.5 h-3.5 mr-2" />Billing / Invoice</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Row 2 — Customer · Contact · Status pipeline (slim) */}
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <button
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/15 transition-colors text-emerald-200 font-medium"
              onClick={() => setChangeOpen(true)}
              data-testid="customer-pill"
              title="Click to change customer"
            >
              <Building2 className="w-3 h-3" />
              <span>{ticket.client_name || "No customer"}</span>
              <ArrowLeftRight className="w-3 h-3 opacity-60" />
            </button>

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
                    className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors ${
                      active ? "bg-emerald-500/30 text-emerald-100 ring-1 ring-emerald-500/50" :
                      past ? "text-emerald-400/60" :
                      "text-zinc-500 hover:text-zinc-300"
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
