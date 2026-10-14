import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  CornerDownRight,
  Download,
  Edit3,
  FileText,
  Link as LinkIcon,
  Loader2,
  MoreHorizontal,
  Pin,
  Reply,
  Smile,
  Sparkles,
  Trash2,
  UserRoundCheck,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { repairDisplayText } from "@/lib/teamChatHelpers";
import { renderSafeChatMarkdown } from "@/lib/richChatMessage";
import { canStartWorkSession, workSessionPath } from "@/lib/workSessionNavigation";
import {
  COMMON_EMOJIS,
  formatBytes,
  formatRelative,
  formatTime,
  INVOICE_REGEX,
  OWN_BUBBLE_ACCENT,
  PO_REGEX,
  TICKET_REGEX,
} from "@/lib/teamChatFormat";
import { TechnicianAvatar } from "@/components/teamChat/TeamChatShared";

/**
 * The reactions a technician reaches for most, offered on the message itself.
 *
 * One click instead of open-the-picker-then-choose, which is the difference
 * between acknowledging a message and ignoring it on a busy desk.
 */
const QUICK_REACTIONS = ["👍", "✅", "❤️", "👀"];

export function MessageRow({ message, compact, own, settings, currentUserId, headers, presence, readReceipts, editing, editingText, onEditingText, onStartEdit, onCancelEdit, onSaveEdit, onDelete, onPin, onThread, onCopyMessageLink, onReact, emojiOpen, onEmojiOpen, onEmojiClose, onDownload, highlighted }) {
  const [hovered, setHovered] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  if (message.is_system) {
    const text = repairDisplayText(message.body);
    const isWarning = /unknown command|not found|could not|couldn't|invalid|failed|error/i.test(text);
    return (
      <div className="my-3 flex justify-center">
        <div className={`flex max-w-2xl items-start gap-2 rounded-lg border px-4 py-2 text-left text-xs ${isWarning ? "border-amber-500/25 bg-amber-500/[0.08] text-amber-100" : "border-cyan-500/20 bg-cyan-500/10 text-cyan-100"}`}>
          {isWarning ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" /> : <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />}
          <div><span className="mr-1.5 font-semibold">{isWarning ? "Command notice" : "Nexus Automation"}</span>{" "}{text}</div>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`group relative flex gap-3 rounded-xl px-2 py-2 transition-colors ${own ? `border ${OWN_BUBBLE_ACCENT[settings?.accent] || OWN_BUBBLE_ACCENT.emerald}` : "hover:bg-cyan-500/[0.025]"} ${settings?.density === "compact" ? (compact ? "mt-0" : "mt-1") : (compact ? "mt-0.5" : "mt-2")} ${message.pending ? "opacity-60" : ""} ${highlighted ? "ring-2 ring-cyan-400/45" : ""}`}
      data-message-id={message.id}
    > onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setActionsOpen(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setActionsOpen(false); }}>
      <div className="w-9 shrink-0">{!compact && settings?.showAvatars !== false && <TechnicianAvatar name={message.user_name} avatarUrl={message.avatar_url || message.avatar} className="h-9 w-9" />}</div>
      <div className="min-w-0 flex-1">
        {!compact && <div className="mb-1 flex items-center gap-2"><span className="text-sm font-semibold text-zinc-200">{message.user_name}</span>{settings?.showTimestamps !== false && <span className="text-[10px] text-zinc-500">{formatTime(message.ts)}</span>}{message.edited && <span className="text-[9px] text-zinc-500">Edited</span>}{message.pinned && <Pin className="h-3 w-3 text-amber-400" />}</div>}
        {editing ? (
          <div className="flex gap-2"><Input value={editingText} onChange={event => onEditingText(event.target.value)} onKeyDown={event => event.key === "Enter" && onSaveEdit()} autoFocus className="h-9 border-white/10 bg-black/20" /><Button size="sm" onClick={onSaveEdit}>Save</Button><Button size="sm" variant="ghost" onClick={onCancelEdit}>Cancel</Button></div>
        ) : (
          <div className={`text-sm leading-6 ${message.deleted ? "italic text-zinc-600" : "text-zinc-300"}`}>
            <MessageBody body={message.body} headers={headers} presence={presence} currentUserId={currentUserId} channelId={message.channel_id} />
            {message.attachment && <AttachmentCard attachment={message.attachment} headers={headers} onDownload={() => onDownload(message.attachment)} />}
            {message.action_card?.kind === "ticket_pass" && <TicketPassCard handoffId={message.action_card.id} headers={headers} currentUserId={currentUserId} />}
          </div>
        )}
        {onReact && message.reactions && Object.keys(message.reactions).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">{Object.entries(message.reactions).map(([emoji, voters]) => <button key={emoji} onClick={() => onReact(emoji)} className={`rounded-full border px-2 py-0.5 text-xs ${voters.includes?.(currentUserId) ? "border-emerald-500/50 bg-emerald-500/15" : "border-white/10 bg-white/[0.03]"}`}>{emoji} <span className="text-zinc-500">{voters.length}</span></button>)}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">{message.thread_count > 0 && onThread && <button onClick={onThread} className="flex items-center gap-1 text-xs font-medium text-cyan-300 hover:text-cyan-200"><CornerDownRight className="h-3.5 w-3.5" />{message.thread_count} {message.thread_count === 1 ? "reply" : "replies"}</button>}<MessageReadReceipt message={message} currentUserId={currentUserId} receipts={readReceipts} /></div>
      </div>
      {!editing && !message.pending && !message.deleted && (onReact || onThread || onCopyMessageLink || onPin || onStartEdit || onDelete) && (
        <button type="button" onClick={() => setActionsOpen(current => !current)} aria-expanded={actionsOpen} aria-label="Open message actions" className="absolute right-3 top-2 rounded-md p-1.5 text-zinc-500 opacity-0 transition hover:bg-white/10 hover:text-zinc-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 group-hover:opacity-100"><MoreHorizontal className="h-3.5 w-3.5" /></button>
      )}
      {(hovered || actionsOpen) && !editing && !message.pending && !message.deleted && (onReact || onThread || onCopyMessageLink || onPin || onStartEdit || onDelete) && (
        <div className="absolute right-3 top-0 flex -translate-y-1/2 items-center rounded-lg border border-white/10 bg-[#252832] p-0.5 shadow-xl">
          {onReact && (
            <>
              {QUICK_REACTIONS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact(emoji)}
                  aria-label={`React with ${emoji}`}
                  className="rounded-md px-1 py-0.5 text-sm transition hover:scale-110 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                >
                  {emoji}
                </button>
              ))}
              <span className="mx-0.5 h-4 w-px bg-white/10" aria-hidden="true" />
            </>
          )}
          {onReact && <MessageAction icon={Smile} label="React" onClick={onEmojiOpen} />}
          {onThread && <MessageAction icon={Reply} label="Reply" onClick={onThread} />}
          {onCopyMessageLink && <MessageAction icon={LinkIcon} label="Copy message link" onClick={onCopyMessageLink} />}
          {onPin && <MessageAction icon={Pin} label={message.pinned ? "Unpin" : "Pin"} onClick={onPin} />}
          {own && onStartEdit && <MessageAction icon={Edit3} label="Edit" onClick={onStartEdit} />}
          {own && onDelete && <MessageAction icon={Trash2} label="Unsend" onClick={onDelete} destructive />}
        </div>
      )}
      {emojiOpen && (
        <div className="absolute right-3 top-7 z-30 flex gap-1 rounded-xl border border-white/10 bg-[#252832] p-2 shadow-2xl">
          {COMMON_EMOJIS.map(emoji => <button key={emoji} onClick={() => onReact(emoji)} className="rounded-lg p-1 text-base hover:bg-white/10">{emoji}</button>)}
          <button onClick={onEmojiClose} className="ml-1 rounded-lg p-1 text-zinc-500 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

export function MessageReadReceipt({ message, currentUserId, receipts }) {
  if (!message.ts || message.deleted || message.user_id !== currentUserId) return null;
  if (message.pending) return <span className="flex items-center gap-1 text-[10px] text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" />Sending</span>;
  const readers = (receipts || []).filter(receipt => receipt.user_id !== message.user_id && receipt.user_id !== currentUserId && receipt.last_read_at >= message.ts);
  if (!readers.length) return <span className="flex items-center gap-1 text-[10px] text-zinc-500"><Check className="h-3 w-3" />Sent</span>;
  return <span className="flex items-center gap-1.5 text-[10px] text-zinc-500" title={`Seen by ${readers.map(reader => reader.user_name).join(", ")}`}><span className="flex -space-x-1">{readers.slice(0, 3).map(reader => <TechnicianAvatar key={reader.user_id} name={reader.user_name} avatarUrl={reader.avatar_url || reader.avatar} className="h-4 w-4 border border-[#1d1f26]" fallbackClassName="text-[7px]" />)}</span><Check className="h-3 w-3 text-emerald-400" />Seen{readers.length > 1 ? ` by ${readers.length}` : ""}</span>;
}

export function MessageAction({ icon: Icon, label, onClick, destructive }) {
  return <button onClick={onClick} title={label} aria-label={label} className={`rounded-md p-1.5 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${destructive ? "text-rose-400 focus-visible:ring-rose-400/60" : "text-zinc-400 hover:text-zinc-100"}`}><Icon className="h-3.5 w-3.5" /></button>;
}

export function MessageBody({ body, headers, presence, currentUserId, channelId }) {
  const text = repairDisplayText(body);
  const tickets = [...new Set([...text.matchAll(TICKET_REGEX)].map(match => match[1]))];
  const invoices = [...new Set([...text.matchAll(INVOICE_REGEX)].map(match => match[1]))];
  const purchaseOrders = [...new Set([...text.matchAll(PO_REGEX)].map(match => match[1]))];
  if (!tickets.length && !invoices.length && !purchaseOrders.length) return <RichMessageText text={text} />;
  return (
    <>
      <RichMessageText text={text} />
      {tickets.map(ticketNumber => <TicketCard key={ticketNumber} ticketNumber={ticketNumber} headers={headers} presence={presence} currentUserId={currentUserId} channelId={channelId} />)}
      {invoices.map(invoiceNumber => <InvoiceCard key={invoiceNumber} invoiceNumber={invoiceNumber} headers={headers} presence={presence} />)}
      {purchaseOrders.map(poNumber => <div key={poNumber}><PurchaseOrderCard poNumber={poNumber} headers={headers} /><WorkPresence kind="po" reference={poNumber} presence={presence} headers={headers} /></div>)}
    </>
  );
}

export function RichMessageText({ text }) {
  return <div className="break-words [&_a]:font-medium [&_a]:text-cyan-200 [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-cyan-400/50 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-black/25 [&_code]:px-1.5 [&_code]:py-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_p+p]:mt-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: renderSafeChatMarkdown(text) }} />;
}

export function TicketCard({ ticketNumber, headers, presence, currentUserId, channelId }) {
  const [ticket, setTicket] = useState(null);
  const [passOpen, setPassOpen] = useState(false);
  useEffect(() => {
    let active = true;
    axios.get(`${API}/chat/ticket-card/${ticketNumber}`, { headers }).then(response => active && setTicket(response.data)).catch(() => {});
    return () => { active = false; };
  }, [headers, ticketNumber]);
  if (!ticket) return null;
  return (
    <div className="mt-2 max-w-lg overflow-hidden rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.08] to-black/20 shadow-lg shadow-black/10">
      <Link to={`/tickets?ticket=${encodeURIComponent(ticket.ticket_number)}`} className="block p-3 transition hover:bg-cyan-500/[0.05]">
        <div className="mb-1 flex items-center gap-2"><code className="text-xs text-cyan-200">{ticket.ticket_number}</code><Badge variant="outline" className="text-[9px] capitalize">{ticket.priority}</Badge><Badge variant="outline" className="text-[9px] capitalize">{ticket.status?.replace(/_/g, " ")}</Badge></div>
        <p className="text-sm font-medium text-zinc-100">{ticket.title}</p><p className="mt-1 text-xs text-zinc-500">{ticket.client_name}{ticket.assigned_to_name ? ` · ${ticket.assigned_to_name}` : ""}</p>
      </Link>
      <div className="flex items-center gap-2 border-t border-white/5 px-3 py-2">
        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-cyan-200"><Link to={`/tickets?ticket=${encodeURIComponent(ticket.ticket_number)}`}>Open ticket</Link></Button>
        {canStartWorkSession(ticket) && <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-violet-200 hover:text-violet-100"><Link to={workSessionPath(ticket)}><Wrench className="mr-1.5 h-3.5 w-3.5" />Start work</Link></Button>}
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-emerald-200" onClick={() => setPassOpen(true)}><ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />Pass ticket</Button>
      </div>
      <div className="px-3 pb-2"><WorkPresence kind="ticket" reference={ticket.ticket_number} presence={presence} headers={headers} /></div>
      <TicketPassDialog open={passOpen} onOpenChange={setPassOpen} ticket={ticket} headers={headers} currentUserId={currentUserId} channelId={channelId} />
    </div>
  );
}

export function TicketPassDialog({ open, onOpenChange, ticket, headers, currentUserId, channelId }) {
  const [technicians, setTechnicians] = useState([]);
  const [toUserId, setToUserId] = useState("");
  const [mode, setMode] = useState("take_over");
  const [reason, setReason] = useState("");
  const [workCompleted, setWorkCompleted] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    axios.get(`${API}/users`, { headers })
      .then(response => {
        const rows = Array.isArray(response.data) ? response.data : response.data?.users || [];
        setTechnicians(rows.filter(row => row.id !== currentUserId && row.is_active !== false && row.archived !== true));
      })
      .catch(() => setTechnicians([]));
  }, [currentUserId, headers, open]);

  const submit = async () => {
    if (!toUserId || reason.trim().length < 3 || submitting) return;
    setSubmitting(true);
    try {
      const response = await axios.post(`${API}/nexus-connect/ticket-passes`, {
        ticket_ref: ticket.id || ticket.ticket_number,
        to_user_id: toUserId,
        mode,
        reason: reason.trim(),
        work_completed: workCompleted.split("\n").map(value => value.trim()).filter(Boolean),
        suggested_next_action: nextAction.trim(),
        channel_id: channelId || undefined,
      }, { headers });
      toast.success("Ticket pass sent", { description: `${response.data?.handoff?.to_user_name} must accept before ownership changes.` });
      onOpenChange(false);
      setToUserId("");
      setReason("");
      setWorkCompleted("");
      setNextAction("");
      setMode("take_over");
    } catch (requestError) {
      toast.error("Ticket pass could not be sent", { description: requestError?.response?.data?.detail || "Review the handover and try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Nexus ticket pass"
        title={`Hand over ${ticket.ticket_number}`}
        description="The recipient must explicitly accept. Nexus preserves both technicians, the reason, work completed and the live assignment trail."
        icon={ArrowRightLeft}
        tone="emerald"
        className="max-w-2xl"
        contentClassName="max-h-[65vh] overflow-y-auto"
        data-testid="ticket-pass-workflow"
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={!toUserId || reason.trim().length < 3 || submitting} className="bg-emerald-600 hover:bg-emerald-500">{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}Send ticket pass</Button></>}
      >
        <div className="grid gap-5 md:grid-cols-2">
          <label className="space-y-2 text-xs font-medium text-zinc-300">Receiving technician
            <select value={toUserId} onChange={event => setToUserId(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-500/60">
              <option value="">Choose a technician</option>
              {technicians.map(technician => <option key={technician.id} value={technician.id}>{technician.name || technician.email}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-xs font-medium text-zinc-300">Pass mode
            <select value={mode} onChange={event => setMode(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-500/60">
              <option value="take_over">Take over - transfer ownership</option>
              <option value="assist">Assist - join without transfer</option>
              <option value="escalate">Escalate - higher-level ownership</option>
              <option value="consult">Consult - specialist advice</option>
              <option value="cover">Cover - temporary ownership</option>
              <option value="return">Return - send back with outcome</option>
              <option value="swarm">Swarm - collaborate as a group</option>
            </select>
          </label>
          <label className="space-y-2 text-xs font-medium text-zinc-300 md:col-span-2">Why are you passing this ticket?
            <Textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain why this technician is the right next owner..." className="mt-2 min-h-20 border-white/10 bg-black/25" />
          </label>
          <label className="space-y-2 text-xs font-medium text-zinc-300">Work completed
            <Textarea value={workCompleted} onChange={event => setWorkCompleted(event.target.value)} placeholder={"One completed action per line\nRestarted workstation\nCleared print queue"} className="mt-2 min-h-28 border-white/10 bg-black/25" />
          </label>
          <label className="space-y-2 text-xs font-medium text-zinc-300">Suggested next action
            <Textarea value={nextAction} onChange={event => setNextAction(event.target.value)} placeholder="Check the print server spooler and driver deployment." className="mt-2 min-h-28 border-white/10 bg-black/25" />
          </label>
        </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

export function TicketPassCard({ handoffId, headers, currentUserId }) {
  const [handoff, setHandoff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    axios.get(`${API}/nexus-connect/ticket-passes/${handoffId}`, { headers })
      .then(response => setHandoff(response.data))
      .catch(() => setHandoff(null))
      .finally(() => setLoading(false));
  }, [handoffId, headers]);
  useEffect(load, [load]);

  const decide = async (decision, reason = "") => {
    setProcessing(decision);
    try {
      const response = await axios.post(
        `${API}/nexus-connect/ticket-passes/${handoffId}/${decision}`,
        decision === "decline" ? { reason } : {},
        { headers },
      );
      setHandoff(response.data?.handoff || handoff);
      setDeclineOpen(false);
      setDeclineReason("");
      toast.success(decision === "accept" ? "Ticket pass accepted" : "Ticket pass declined");
    } catch (requestError) {
      toast.error("Ticket pass could not be updated", { description: requestError?.response?.data?.detail || "Refresh the live ticket state and try again." });
      load();
    } finally {
      setProcessing("");
    }
  };

  if (loading) return <div className="mt-3 flex max-w-xl items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-4 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Loading live ticket pass...</div>;
  if (!handoff) return null;
  const pendingForMe = handoff.status === "pending" && handoff.to_user_id === currentUserId;
  const statusTone = handoff.status === "accepted"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
    : handoff.status === "declined" || handoff.status === "stale"
      ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
      : "border-amber-500/25 bg-amber-500/10 text-amber-100";
  return (
    <div className="mt-3 max-w-xl overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-[#12231f] to-[#111923] shadow-xl shadow-black/20">
      <div className="flex items-start justify-between gap-4 border-b border-white/5 px-4 py-3">
        <div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300"><UserRoundCheck className="h-3.5 w-3.5" />Nexus Ticket Pass</div><p className="mt-1 text-sm font-semibold text-white">{handoff.mode_label} to {handoff.to_user_name}</p></div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusTone}`}>{handoff.status}</span>
      </div>
      <div className="space-y-3 px-4 py-4">
        <div><code className="text-xs text-cyan-200">{handoff.ticket?.ticket_number}</code><p className="mt-1 text-sm font-medium text-zinc-100">{handoff.ticket?.title}</p><p className="mt-1 text-xs text-zinc-500">{handoff.ticket?.client_name} · {handoff.ticket?.priority} priority · {handoff.ticket?.status?.replace(/_/g, " ")}</p></div>
        <div className="rounded-lg border border-white/5 bg-black/20 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Reason</p><p className="mt-1 text-sm text-zinc-300">{handoff.reason}</p></div>
        {handoff.work_completed?.length > 0 && <div><p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Work completed</p><ul className="mt-1.5 space-y-1">{handoff.work_completed.map(item => <li key={item} className="flex gap-2 text-xs text-zinc-300"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />{item}</li>)}</ul></div>}
        {handoff.suggested_next_action && <div className="border-l-2 border-cyan-500/50 pl-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-400">Suggested next action</p><p className="mt-1 text-xs text-zinc-300">{handoff.suggested_next_action}</p></div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/5 bg-black/10 px-4 py-3">
        <Button asChild variant="ghost" size="sm" className="h-8 text-xs"><Link to={`/tickets?ticket=${encodeURIComponent(handoff.ticket?.ticket_number || handoff.ticket_id)}`}>View context</Link></Button>
        {handoff.status === "pending" && !pendingForMe && <span className="ml-auto text-[11px] text-amber-200">Awaiting {handoff.to_user_name}</span>}
        {pendingForMe && <><Button size="sm" className="ml-auto h-8 bg-emerald-600 text-xs hover:bg-emerald-500" disabled={Boolean(processing)} onClick={() => decide("accept")}>{processing === "accept" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Accept</Button><Button variant="outline" size="sm" className="h-8 text-xs" disabled={Boolean(processing)} onClick={() => setDeclineOpen(true)}><XCircle className="mr-1.5 h-3.5 w-3.5" />Decline</Button></>}
      </div>
      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <NexusWorkflowDialog eyebrow="Ticket handover" title="Decline ticket pass?" description={`Give ${handoff.from_user_name} enough context to choose the right next step.`} icon={XCircle} tone="amber" className="max-w-lg" data-testid="decline-ticket-pass-workflow" footer={<><Button variant="ghost" onClick={() => setDeclineOpen(false)}>Cancel</Button><Button variant="destructive" disabled={declineReason.trim().length < 3 || Boolean(processing)} onClick={() => decide("decline", declineReason.trim())}>Decline pass</Button></>}><Textarea value={declineReason} onChange={event => setDeclineReason(event.target.value)} placeholder="Why can you not accept this ticket?" className="min-h-24 border-white/10 bg-black/25" /></NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}

export function InvoiceCard({ invoiceNumber, headers, presence }) {
  const [invoice, setInvoice] = useState(null);
  useEffect(() => {
    let active = true;
    axios.get(`${API}/chat/invoice-card/${invoiceNumber}`, { headers }).then(response => active && setInvoice(response.data)).catch(() => {});
    return () => { active = false; };
  }, [headers, invoiceNumber]);
  if (!invoice) return null;
  return (
    <Link to={`/invoices?invoice=${encodeURIComponent(invoice.id)}`} className="mt-2 block max-w-lg rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-3 transition hover:border-emerald-400/50">
      <div className="mb-1 flex items-center gap-2"><code className="text-xs text-emerald-300">{invoice.invoice_number}</code><Badge variant="outline" className="text-[9px] capitalize">{invoice.payment_status}</Badge></div>
      <p className="text-sm font-medium text-zinc-200">{invoice.client_name || "Invoice"}</p><p className="mt-1 text-xs text-zinc-400">Total ${Number(invoice.total || 0).toFixed(2)} · Due ${Number(invoice.amount_due || 0).toFixed(2)}{invoice.due_date ? ` · Due ${invoice.due_date}` : ""}</p>
      <WorkPresence kind="invoice" reference={invoice.invoice_number} presence={presence} headers={headers} />
    </Link>
  );
}

export function PurchaseOrderCard({ poNumber, headers }) {
  const [purchaseOrder, setPurchaseOrder] = useState(null);
  useEffect(() => {
    let active = true;
    axios.get(`${API}/chat/po-card/${poNumber}`, { headers }).then(response => active && setPurchaseOrder(response.data)).catch(() => {});
    return () => { active = false; };
  }, [headers, poNumber]);
  if (!purchaseOrder) return null;
  return <Link to={`/purchase-orders?po=${encodeURIComponent(purchaseOrder.id)}`} className="mt-2 block max-w-lg rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] p-3 transition hover:border-cyan-400/50"><div className="mb-1 flex items-center gap-2"><code className="text-xs text-cyan-300">{purchaseOrder.po_number}</code><Badge variant="outline" className="text-[9px] capitalize">{purchaseOrder.status}</Badge></div><p className="text-sm font-medium text-zinc-200">{purchaseOrder.vendor || "Purchase order"}</p><p className="mt-1 text-xs text-zinc-400">Total ${Number(purchaseOrder.total || 0).toFixed(2)}{purchaseOrder.expected_delivery ? ` · Expected ${purchaseOrder.expected_delivery}` : ""}</p></Link>;
}

export function WorkPresence({ kind, reference, workItemId, presence, headers }) {
  const [events, setEvents] = useState([]);
  const workItem = `${kind}:${workItemId || reference}`;
  useEffect(() => {
    let active = true;
    axios.get(`${API}/presence/work-activity`, { params: { work_item: workItem, limit: 2 }, headers })
      .then(response => active && setEvents(response.data?.events || []))
      .catch(() => active && setEvents([]));
    return () => { active = false; };
  }, [headers, workItem]);
  const people = Object.values(presence || {}).filter(person => person.busy_state === workItem && person.led !== "offline");
  if (!people.length && !events.length) return null;
  const latest = events[0];
  return <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/5 pt-2"><div className="flex -space-x-1.5">{people.slice(0, 4).map(person => <TechnicianAvatar key={person.user_id} name={person.user_name} avatarUrl={person.avatar_url || person.avatar} className="h-5 w-5 border border-[#1d1f26]" fallbackClassName="text-[8px]" />)}</div>{people.length > 0 && <><p className="text-[10px] text-emerald-300">{people.length === 1 ? `${people[0].user_name} is active here` : `${people.length} technicians active here`}</p><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /></>}{latest && <p className="basis-full text-[10px] text-zinc-500">{latest.user_name || "Technician"} {latest.event === "left" ? "last left" : "opened"} {formatRelative(latest.created_at)}</p>}</div>;
}

export function AttachmentCard({ attachment, headers, onDownload }) {
  if (attachment.is_external && attachment.provider === "tenor") {
    return <a href={attachment.url} target="_blank" rel="noreferrer" className="mt-2 block max-w-md overflow-hidden rounded-lg border border-white/10 bg-black/20 hover:border-cyan-400/40"><img src={attachment.preview_url || attachment.url} alt={attachment.filename || "Shared GIF"} className="max-h-80 w-full object-contain" /><span className="block border-t border-white/10 px-3 py-1.5 text-[10px] text-zinc-500">GIF · Powered by Tenor</span></a>;
  }
  return (
    <div className="mt-2 w-full max-w-md overflow-hidden rounded-lg border border-white/10 bg-black/20">
      {attachment.is_image && <ImageAttachmentPreview attachment={attachment} headers={headers} onDownload={onDownload} />}
      <button onClick={onDownload} className="flex w-full items-center gap-3 p-3 text-left hover:bg-white/[0.03] hover:text-cyan-100">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/15"><FileText className="h-4 w-4 text-cyan-200" /></div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-zinc-200">{attachment.filename}</p><p className="text-[10px] text-zinc-600">{formatBytes(attachment.size)} · Download original</p></div><Download className="h-4 w-4 text-zinc-500" />
      </button>
    </div>
  );
}

export function ImageAttachmentPreview({ attachment, headers, onDownload }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    axios.get(`${API}/chat/files/${attachment.file_id}`, { headers, responseType: "blob" })
      .then(response => {
        objectUrl = URL.createObjectURL(response.data);
        if (active) setSource(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.file_id, headers]);
  if (!source) return null;
  return <button type="button" onClick={onDownload} title="Download original image" className="block max-h-80 w-full overflow-hidden border-b border-white/10 bg-black/30 text-left"><img src={source} alt={attachment.filename || "Shared image"} className="max-h-80 w-full object-contain" /></button>;
}
