import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Send, Mail, PhoneCall, Loader2, Zap, LockKeyhole, Globe2, MailCheck, CircleAlert, Paperclip, Timer, CircleDollarSign, Bell } from "lucide-react";
import DOMPurify from "dompurify";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { filterTicketActivity, isInternalTicketNote } from "@/lib/ticketActivityView";

function MessageAvatar({ item, name, tone = "amber" }) {
  const avatarUrl = item.avatar_url || item.user_avatar || item.author_avatar || item.avatar;
  const initials = (name || "?").split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();
  const toneClass = tone === "sky"
    ? "border-sky-400/30 bg-sky-500/15 text-sky-200"
    : "border-amber-400/30 bg-amber-400/15 text-amber-100";
  return (
    <Avatar className={`h-6 w-6 shrink-0 border ${toneClass}`}>
      <AvatarImage src={avatarUrl} alt={name || "Technician"} className="object-cover" />
      <AvatarFallback className="bg-transparent text-[9px] font-semibold">{initials}</AvatarFallback>
    </Avatar>
  );
}

function formatMinutes(value) {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ""}` : `${remainder}m`;
}

function TimeCapturePanel({ enabled, onEnabledChange, draft, onDraftChange, labourTypes, testPrefix = "conversation" }) {
  const selectedType = labourTypes.find(type => type.id === draft.labour_type_id);
  const updateLabourType = (value) => {
    const labourTypeId = value === "__default__" ? "" : value;
    const type = labourTypes.find(item => item.id === labourTypeId);
    onDraftChange({
      ...draft,
      labour_type_id: labourTypeId,
      billable: type ? type.billable_default !== false : draft.billable,
    });
  };

  return (
    <div className={`rounded-lg border transition-colors ${enabled ? "border-cyan-400/25 bg-cyan-400/[0.055]" : "border-white/[0.07] bg-black/[0.12]"}`}>
      <button
        type="button"
        aria-pressed={enabled}
        onClick={() => onEnabledChange(!enabled)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
        data-testid={`${testPrefix}-time-toggle`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${enabled ? "border-cyan-300/25 bg-cyan-400/15 text-cyan-200" : "border-white/[0.08] bg-white/[0.03] text-zinc-500"}`}><Timer className="h-3.5 w-3.5" /></span>
          <span><span className="block text-xs font-medium text-zinc-200">Log time with this update</span><span className="block text-[10px] text-zinc-500">The client never sees labour, rate or billing context.</span></span>
        </span>
        <span className={`h-5 w-9 rounded-full p-0.5 transition ${enabled ? "bg-cyan-400" : "bg-zinc-700"}`}><span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0"}`} /></span>
      </button>
      {enabled && (
        <div className="grid gap-2 border-t border-cyan-400/15 px-3 py-3 sm:grid-cols-[104px_minmax(160px,1fr)_auto] sm:items-end">
          <div>
            <Label className="text-[10px] uppercase tracking-[0.1em] text-cyan-100/70">Duration</Label>
            <div className="mt-1 flex items-center gap-1">
              <Input type="number" min="1" max="1440" value={draft.minutes} onChange={event => onDraftChange({ ...draft, minutes: Math.max(1, Math.min(1440, Number(event.target.value) || 0)) })} className="h-8 w-[68px] text-xs" aria-label="Minutes worked" data-testid={`${testPrefix}-time-minutes`} />
              <span className="text-[10px] text-zinc-500">min</span>
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.1em] text-cyan-100/70">Labour type</Label>
            <Select value={draft.labour_type_id || "__default__"} onValueChange={updateLabourType}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid={`${testPrefix}-labour-type`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Technician default</SelectItem>
                {labourTypes.map(type => <SelectItem key={type.id} value={type.id}>{type.name}{type.code ? ` · ${type.code}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <button type="button" aria-pressed={draft.billable} onClick={() => onDraftChange({ ...draft, billable: !draft.billable })} className={`h-8 rounded-md border px-2.5 text-[11px] font-medium transition ${draft.billable ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-zinc-600 bg-white/[0.03] text-zinc-400"}`} data-testid={`${testPrefix}-billable-toggle`}>
            <CircleDollarSign className="mr-1 inline h-3 w-3" />{draft.billable ? "Billable" : "Non-billable"}
          </button>
          <div className="sm:col-span-3 flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {[5, 15, 30, 45, 60].map(minutes => <button key={minutes} type="button" onClick={() => onDraftChange({ ...draft, minutes })} className={`rounded border px-1.5 py-0.5 text-[10px] transition ${Number(draft.minutes) === minutes ? "border-cyan-300/35 bg-cyan-400/15 text-cyan-100" : "border-white/[0.08] text-zinc-500 hover:text-zinc-200"}`}>{minutes}m</button>)}
              {selectedType && <span className="ml-1 text-[10px] text-cyan-100/70">{selectedType.description || `${selectedType.name} selected`}</span>}
            </div>
            <Link to="/tickets/settings?tab=labour" className="text-[10px] text-cyan-300/80 underline-offset-2 hover:text-cyan-100 hover:underline">Manage labour types</Link>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Conversation tab for the Ticket Detail view.
 * Pure presentational — all state + handlers come from parent.
 */
export default function TicketConversationTab({
  conversationType, setConversationType,
  newNote, setNewNote, handleAddNote, cannedResponses,
  emailForm, setEmailForm, handleSendEmail, emailSignature, clientContacts,
  smsForm, setSmsForm, handleSendSms, applySmsTemplate, smsTemplates, smsConfig, smsSending,
  ticketNotes, ticketEmails, ticketSms, ticketParticipants = [], ticketSubscribers = [], ticketAttachments = [], ticketTimeEntries = [], labourTypes = [],
  composerFocusRequest = 0,
  recordLabel = "ticket",
  allowStatusChange = true,
  allowTimeCapture = true,
}) {
  const [publicEmailEnabled, setPublicEmailEnabled] = useState(true);
  const [activityFilter, setActivityFilter] = useState("all");
  const [publicSubjectLabel, setPublicSubjectLabel] = useState("Update");
  const [publicStatusAfter, setPublicStatusAfter] = useState("__unchanged");
  const [recordTime, setRecordTime] = useState(false);
  const [timeDraft, setTimeDraft] = useState({ minutes: 15, labour_type_id: "", billable: true });
  const [postingEntry, setPostingEntry] = useState(false);
  const emailRecipientRef = useRef(null);
  const previousConversationTypeRef = useRef(conversationType);
  useEffect(() => {
    if (!composerFocusRequest) return;
    const frame = window.requestAnimationFrame(() => {
      if (conversationType === "email") {
        emailRecipientRef.current?.focus();
      } else if (conversationType === "public") {
        document.querySelector('[data-testid="public-update-composer"] [contenteditable="true"]')?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composerFocusRequest, conversationType]);
  useEffect(() => {
    const previousType = previousConversationTypeRef.current;
    if (previousType !== conversationType && ["public", "note"].includes(previousType) && ["public", "note"].includes(conversationType)) {
      setRecordTime(false);
      setTimeDraft({ minutes: 15, labour_type_id: "", billable: true });
    }
    previousConversationTypeRef.current = conversationType;
  }, [conversationType]);
  const publicRecipient = (emailForm.to || "").split(",").map(value => value.trim()).filter(Boolean)[0] || "";
  const selectedAttachmentIds = emailForm.attachment_ids || [];
  const sendableAttachments = ticketAttachments.filter(attachment => attachment.email_attachable);
  const allItems = [
    ...ticketNotes.map(n => ({ ...n, _type: "note", _sort: n.created_at })),
    ...ticketEmails.map(e => ({ ...e, _type: "email", _sort: e.created_at })),
    ...ticketSms.map(s => ({ ...s, _type: "sms", _sort: s.sent_at || s.received_at })),
  ].sort((a, b) => (b._sort || "").localeCompare(a._sort || ""));
  const visibleItems = filterTicketActivity(allItems, activityFilter);
  const timeById = useMemo(() => new Map(ticketTimeEntries.map(entry => [entry.id, entry])), [ticketTimeEntries]);
  const hasMeaningfulContent = (value) => String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim().length > 0;
  const hasDraftContent = hasMeaningfulContent(newNote);
  const hasEmailBody = hasMeaningfulContent(emailForm.body);
  const canSendSms = Boolean(String(smsForm.to || "").trim()) && (
    hasMeaningfulContent(smsForm.message) || Boolean(smsForm.template_key)
  );

  const submitConversationEntry = async (options) => {
    if (postingEntry) return;
    setPostingEntry(true);
    try {
      const logged = allowTimeCapture && recordTime
        ? { minutes: Number(timeDraft.minutes), labour_type_id: timeDraft.labour_type_id || null, billable: timeDraft.billable }
        : null;
      const succeeded = await handleAddNote({ ...options, time: logged });
      if (succeeded && logged) {
        setRecordTime(false);
        setTimeDraft({ minutes: 15, labour_type_id: "", billable: true });
      }
    } finally {
      setPostingEntry(false);
    }
  };

  const sigEffLen = (() => {
    const sig = (smsConfig.append_signature && smsConfig.signature) ? smsConfig.signature : "";
    return smsForm.message.length + (sig && !smsForm.message.toLowerCase().includes(sig.toLowerCase()) ? sig.length + 2 : 0);
  })();

  return (
    <>
      {/* Message type / composer context */}
      <div className="rounded-xl border border-white/[0.08] bg-black/[0.14] p-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.12)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-white/[0.04] p-1" role="group" aria-label="Message type">
            {[
              { value: "public", label: "Public update", icon: Globe2 },
              { value: "note", label: "Internal note", icon: LockKeyhole },
              { value: "email", label: "Email client", icon: Mail },
              { value: "sms", label: "SMS", icon: PhoneCall },
            ].map(({ value, label, icon: Icon }) => (
              <Button key={value} type="button" aria-pressed={conversationType === value} variant="ghost" size="sm" onClick={() => setConversationType(value)} className={`h-8 gap-1.5 px-2.5 text-xs ${conversationType === value ? "bg-cyan-500/[0.16] text-cyan-100 hover:bg-cyan-500/[0.22]" : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"}`} data-testid={value === "note" ? "conversation-type-select" : undefined}>
                <Icon className="h-3.5 w-3.5" />{label}
              </Button>
            ))}
          </div>
          <span className={`text-[11px] ${conversationType === "note" ? "text-amber-300" : conversationType === "email" ? "text-sky-300" : "text-emerald-300"}`}>
            {conversationType === "public"
              ? "Customer-visible · portal and optional email"
              : conversationType === "note"
                ? "Visible to your team only"
                : conversationType === "email"
                  ? `Custom email tracked on this ${recordLabel}`
                  : "Sent through MobileMessage"}
          </span>
        </div>
        {ticketParticipants.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2 text-[10px] text-zinc-500">
            <span className="mr-1 uppercase tracking-[0.12em] text-zinc-600">Conversation contacts</span>
            {ticketParticipants.slice(0, 5).map(participant => (
              <span key={participant.id || participant.email} className="inline-flex items-center gap-1 rounded-full border border-sky-400/15 bg-sky-400/[0.045] px-2 py-1 text-sky-100/80" title={participant.email}>
                <Mail className="h-2.5 w-2.5 text-sky-300/70" />{participant.display_name || participant.email}
                {participant.roles?.length > 0 && <span className="text-sky-300/50">· {participant.roles.join("/")}</span>}
              </span>
            ))}
            {ticketParticipants.length > 5 && <span className="rounded-full border border-white/[0.08] px-2 py-1 text-zinc-500">+{ticketParticipants.length - 5}</span>}
          </div>
        )}
        {ticketSubscribers.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2 text-[10px] text-zinc-500" data-testid="conversation-subscribers">
            <span className="mr-1 inline-flex items-center gap-1 uppercase tracking-[0.12em] text-zinc-600"><Bell className="h-2.5 w-2.5" />Following this work</span>
            {ticketSubscribers.slice(0, 4).map(subscriber => (
              <span key={subscriber.user_id} className="inline-flex items-center rounded-full border border-violet-400/15 bg-violet-400/[0.045] px-2 py-1 text-violet-100/80">
                {subscriber.user?.name || "Technician"}
              </span>
            ))}
            {ticketSubscribers.length > 4 && <span className="rounded-full border border-white/[0.08] px-2 py-1 text-zinc-500">+{ticketSubscribers.length - 4}</span>}
          </div>
        )}
      </div>

      {/* Customer-visible update */}
      {conversationType === "public" && (
        <div className="overflow-hidden rounded-xl border border-emerald-400/25 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.11),transparent_45%),rgba(16,185,129,0.035)] shadow-[0_14px_34px_rgba(0,0,0,0.15)]" data-testid="public-update-composer">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-400/15 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-400/10"><Globe2 className="h-4 w-4 text-emerald-300" /></span>
              <div>
                <p className="text-sm font-semibold text-emerald-100">Client update</p>
                <p className="text-[11px] text-zinc-500">Always visible in the client portal. Email delivery is explicit and audited.</p>
              </div>
            </div>
            <Badge variant="outline" className="border-emerald-400/25 bg-emerald-400/[0.07] text-[9px] uppercase tracking-[0.12em] text-emerald-200">Public</Badge>
          </div>
          <div className="space-y-3 p-4">
            <div className={`grid gap-3 ${allowStatusChange ? "md:grid-cols-[1fr_1.35fr_1fr]" : "md:grid-cols-[1fr_1.65fr]"}`}>
              <div>
                <Label className="text-[11px] text-zinc-400">Update type</Label>
                <Select value={publicSubjectLabel} onValueChange={setPublicSubjectLabel}>
                  <SelectTrigger className="mt-1 h-9" data-testid="public-update-subject"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Update", "Diagnosis", "Approval needed", "Parts ordered", "Parts arrived", "Work completed"].map(label => <SelectItem key={label} value={label}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px] text-zinc-400">Customer email</Label>
                <Input className="mt-1 h-9" value={emailForm.to} onChange={event => setEmailForm({ ...emailForm, to: event.target.value })} placeholder="customer@example.com" list="public-contact-emails" data-testid="public-update-recipient" />
                <datalist id="public-contact-emails">
                  {clientContacts.map(contact => contact.email && <option key={contact.id || contact.email} value={contact.email}>{contact.name || contact.email}</option>)}
                </datalist>
              </div>
              {allowStatusChange && (
                <div>
                  <Label className="text-[11px] text-zinc-400">After publishing</Label>
                  <Select value={publicStatusAfter} onValueChange={setPublicStatusAfter}>
                    <SelectTrigger className="mt-1 h-9" data-testid="public-update-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unchanged">Keep current status</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="on_hold">Waiting for client</SelectItem>
                      <SelectItem value="resolved">Resolve and close</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <RichTextEditor content={newNote} onChange={setNewNote} placeholder="Write a clear customer update, the next action, and when they should expect to hear from you…" minHeight="150px" compactToolbar showHtmlToggle={false} allowImages={false} />
            {allowTimeCapture && <TimeCapturePanel enabled={recordTime} onEnabledChange={setRecordTime} draft={timeDraft} onDraftChange={setTimeDraft} labourTypes={labourTypes} testPrefix="public-update" />}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-400/15 pt-3">
              <button type="button" onClick={() => setPublicEmailEnabled(value => !value)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${publicEmailEnabled ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-white/[0.08] bg-white/[0.025] text-zinc-400"}`} data-testid="public-update-email-toggle">
                <span className={`flex h-7 w-7 items-center justify-center rounded-md ${publicEmailEnabled ? "bg-emerald-400/15" : "bg-white/[0.04]"}`}><MailCheck className="h-3.5 w-3.5" /></span>
                <span><span className="block text-xs font-medium">{publicEmailEnabled ? "Email this update" : "Portal only"}</span><span className="block text-[10px] opacity-70">{publicEmailEnabled ? (publicRecipient || "Add a recipient above") : "No customer email will be sent"}</span></span>
              </button>
              <div className="flex items-center gap-2">
                {cannedResponses.length > 0 && (
                  <Select value="" onValueChange={value => { const template = cannedResponses.find(item => item.id === value); if (template) setNewNote(previous => previous ? `${previous}\n${template.content}` : template.content); }}>
                    <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue placeholder="Insert response…" /></SelectTrigger>
                    <SelectContent>{cannedResponses.map(response => <SelectItem key={response.id} value={response.id}>{response.title}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                <Button
                  size="sm"
                  className="h-9 bg-emerald-400 text-emerald-950 hover:bg-emerald-300"
                  disabled={!hasDraftContent || postingEntry || (publicEmailEnabled && !publicRecipient)}
                  onClick={() => submitConversationEntry({
                    visibility: "public",
                    notify_client: publicEmailEnabled,
                    to_addresses: publicEmailEnabled ? (emailForm.to || "").split(",").map(value => value.trim()).filter(Boolean) : [],
                    subject_label: publicSubjectLabel,
                    status_after: allowStatusChange && publicStatusAfter !== "__unchanged" ? publicStatusAfter : "",
                  })}
                  data-testid="publish-public-update"
                >
                  {postingEntry ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}{publicEmailEnabled ? (recordTime ? `Publish, email & log ${formatMinutes(timeDraft.minutes)}` : "Publish & email") : (recordTime ? `Publish & log ${formatMinutes(timeDraft.minutes)}` : "Publish update")}
                </Button>
              </div>
            </div>
            {publicEmailEnabled && !publicRecipient && <p className="flex items-center gap-1.5 text-[11px] text-amber-300"><CircleAlert className="h-3.5 w-3.5" />Choose a contact email before sending, or switch to portal-only.</p>}
          </div>
        </div>
      )}

      {/* Internal Note Form */}
      {conversationType === "note" && (
        <div className="overflow-hidden rounded-xl border border-amber-500/20 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.10),transparent_42%),rgba(245,158,11,0.025)] shadow-[0_14px_34px_rgba(0,0,0,0.14)]" data-testid="internal-note-composer">
          <div className="flex items-start justify-between gap-3 border-b border-amber-400/15 px-4 py-3">
            <div className="flex min-w-0 items-start gap-2.5"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-400/25 bg-amber-400/10"><LockKeyhole className="h-4 w-4 text-amber-200" /></span><div><p className="text-sm font-semibold text-amber-100">Private technician note</p><p className="text-[11px] text-zinc-500">Use structure, evidence and the next action. It stays inside your service team.</p></div></div>
            <Badge variant="outline" className="border-amber-400/25 bg-amber-400/[0.07] text-[9px] uppercase tracking-[0.12em] text-amber-200">Internal</Badge>
          </div>
          <div className="space-y-3 p-4">
          <RichTextEditor content={newNote} onChange={setNewNote} placeholder="Add an internal note..." minHeight="80px" compactToolbar showHtmlToggle={false} allowImages={false} />
          {allowTimeCapture && <TimeCapturePanel enabled={recordTime} onEnabledChange={setRecordTime} draft={timeDraft} onDraftChange={setTimeDraft} labourTypes={labourTypes} testPrefix="internal-note" />}
          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-amber-500/15 pt-2">
            <span className="text-[10px] text-amber-300/80">Formatting, lists and linked work evidence are retained with this ticket.</span>
            <div className="flex items-center gap-2">
            {cannedResponses.length > 0 && (
              <Select value="" onValueChange={v => { const tmpl = cannedResponses.find(c => c.id === v); if (tmpl) setNewNote(prev => prev ? `${prev}\n${tmpl.content}` : tmpl.content); }}>
                <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="quick-template-picker"><SelectValue placeholder="Insert template..." /></SelectTrigger>
                <SelectContent>
                  {cannedResponses.map(cr => (
                    <SelectItem key={cr.id} value={cr.id}>
                      <div className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-amber-400" /><span>{cr.title}</span></div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" disabled={!hasDraftContent || postingEntry} className="bg-amber-400 text-amber-950 hover:bg-amber-300" onClick={() => submitConversationEntry({ visibility: "internal" })} data-testid="add-note-btn">{postingEntry ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Send className="w-3 h-3 mr-1.5" />}{recordTime ? `Add note + ${formatMinutes(timeDraft.minutes)}` : "Add private note"}</Button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Inline Email Form */}
      {conversationType === "email" && (
        <div className="space-y-4 rounded-xl border border-sky-500/20 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.10),transparent_42%),rgba(14,165,233,0.025)] p-4 shadow-[0_14px_34px_rgba(0,0,0,0.15)]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <Label className="text-[11px] text-zinc-400">To</Label>
              <div className="relative">
                <Input ref={emailRecipientRef} className="mt-1 h-9" value={emailForm.to} onChange={e => setEmailForm({ ...emailForm, to: e.target.value })} placeholder="recipient@email.com" data-testid="inline-email-to" list="contact-emails" />
                <datalist id="contact-emails">
                  {clientContacts.map(c => c.email && <option key={c.id} value={c.email}>{c.name} ({c.email})</option>)}
                </datalist>
              </div>
            </div>
            <div><Label className="text-[11px] text-zinc-400">CC</Label><Input className="mt-1 h-9" value={emailForm.cc} onChange={e => setEmailForm({ ...emailForm, cc: e.target.value })} placeholder="cc@email.com" /></div>
            <div><Label className="text-[11px] text-zinc-400">BCC</Label><Input className="mt-1 h-9" value={emailForm.bcc} onChange={e => setEmailForm({ ...emailForm, bcc: e.target.value })} placeholder="bcc@email.com" /></div>
          </div>
          <div><Label className="text-[11px] text-zinc-400">Subject</Label><Input className="mt-1 h-9" value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} data-testid="inline-email-subject" /></div>
          <div>
            <Label className="text-[11px] text-zinc-400">Body</Label>
            <RichTextEditor content={emailForm.body} onChange={body => setEmailForm({ ...emailForm, body })} placeholder="Write your email..." minHeight="320px" />
          </div>
          {ticketAttachments.length > 0 && (
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.035] p-3">
              <div className="flex items-center justify-between gap-2">
                <div><p className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">Include ticket files</p><p className="mt-0.5 text-[10px] text-zinc-500">Only retained private files can be emailed. Max 10 files / 20 MB total.</p></div>
                <span className="text-[10px] text-sky-300/75">{selectedAttachmentIds.length} selected</span>
              </div>
              {sendableAttachments.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sendableAttachments.map(attachment => {
                    const selected = selectedAttachmentIds.includes(attachment.id);
                    const canSelect = selected || selectedAttachmentIds.length < 10;
                    return <button key={attachment.id} type="button" disabled={!canSelect} title={!canSelect ? "A ticket email can include up to 10 files" : undefined} onClick={() => setEmailForm({ ...emailForm, attachment_ids: selected ? selectedAttachmentIds.filter(id => id !== attachment.id) : [...selectedAttachmentIds, attachment.id] })} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${selected ? "border-sky-400/45 bg-sky-400/15 text-sky-100" : "border-white/[0.08] bg-black/10 text-zinc-400 hover:border-sky-400/25 hover:text-zinc-200"}`}>
                      <Paperclip className="h-3 w-3" />{attachment.filename}
                    </button>;
                  })}
                </div>
              ) : <p className="mt-2 text-[11px] text-amber-300/80">Existing files are not yet retained in private storage, so they cannot be attached to email.</p>}
            </div>
          )}
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.035] p-2.5">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">Sender signature</p>
              <span className="text-[10px] text-sky-300/75">Applied securely when sent</span>
            </div>
            {emailSignature ? (
              <div className="text-sm" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailSignature) }} />
            ) : (
              <p className="text-xs text-muted-foreground">No default signature is set. Add one in My Settings to apply it to outgoing email.</p>
            )}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSendEmail} disabled={!emailForm.to?.trim() || !hasEmailBody} data-testid="send-inline-email-btn"><Send className="w-3 h-3 mr-1" />Send Email</Button>
          </div>
        </div>
      )}

      {/* Inline SMS Form */}
      {conversationType === "sms" && (
        <div className="space-y-4 rounded-xl border border-emerald-500/20 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_42%),rgba(16,185,129,0.025)] p-4 shadow-[0_14px_34px_rgba(0,0,0,0.15)]" data-testid="sms-form">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label className="text-xs">Mobile Number</Label>
              <Input value={smsForm.to} onChange={e => setSmsForm({ ...smsForm, to: e.target.value })} placeholder="04xx xxx xxx or +614xx..." data-testid="sms-to-input" />
            </div>
            <div>
              <Label className="text-xs">Template (optional)</Label>
              <Select value={smsForm.template_key || ""} onValueChange={applySmsTemplate}>
                <SelectTrigger data-testid="sms-template-picker"><SelectValue placeholder="Pick template..." /></SelectTrigger>
                <SelectContent>
                  {smsTemplates.map(t => (
                    <SelectItem key={t.id || t.key} value={t.key}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs flex items-center justify-between">
              <span>Message</span>
              <span className={`text-[10px] ${sigEffLen > 160 ? "text-amber-400" : "text-muted-foreground"}`}>
                {sigEffLen} chars · {Math.max(1, Math.ceil(sigEffLen / 160))} segment{sigEffLen > 160 ? "s" : ""}
              </span>
            </Label>
            <Textarea value={smsForm.message} onChange={e => setSmsForm({ ...smsForm, message: e.target.value })} placeholder={`Hi, update on your ${recordLabel}...`} rows={4} maxLength={1600} data-testid="sms-message-input" />
            {smsConfig.append_signature && smsConfig.signature && !smsForm.message.toLowerCase().includes(smsConfig.signature.toLowerCase()) && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Signature auto-appended: <span className="font-mono text-emerald-400">"{smsConfig.signature}"</span>
              </p>
            )}
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-muted-foreground">Replies from this number will appear inline in this conversation.</span>
            <Button size="sm" onClick={handleSendSms} disabled={!canSendSms || smsSending} data-testid="send-sms-btn">
              {smsSending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
              Send SMS
            </Button>
          </div>
        </div>
      )}

      {/* Unified Conversation Timeline */}
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/[0.10]" style={{ resize: "vertical", overflow: "auto", height: visibleItems.length > 2 ? "500px" : "auto", minHeight: "160px", maxHeight: "70vh" }}>
        <div className="sticky top-0 z-10 flex flex-wrap gap-2 items-center justify-between border-b border-white/[0.07] bg-[#111318]/95 px-3 py-2 backdrop-blur"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">{recordLabel} activity · {visibleItems.length} of {allItems.length}</span><select aria-label="Filter ticket activity" value={activityFilter} onChange={event => setActivityFilter(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs"><option value="all">All updates</option><option value="client">Client communication</option><option value="internal">Internal notes</option></select></div>
        {visibleItems.length === 0 ? (
          <p className="text-center py-10 text-sm text-muted-foreground">{allItems.length ? "No updates match this filter. Choose All updates to see the full conversation." : "No activity yet. Add an internal note or send the first update."}</p>
        ) : visibleItems.map(item => {
          if (item._type === "note") {
            const isInternal = isInternalTicketNote(item);
            const isInboundEmail = item.source === "email_reply";
            const linkedTime = item.time_entry_id ? timeById.get(item.time_entry_id) : null;
            return (
              <div key={`note-${item.id}`} className={`p-3 rounded-lg mb-2 ${isInternal ? 'bg-amber-400/10 border-l-4 border-l-amber-400/60 border border-amber-400/20 shadow-sm' : isInboundEmail ? 'border border-sky-400/25 border-l-4 border-l-sky-400/70 bg-sky-500/[0.06] shadow-sm' : 'bg-muted/30 border border-border rounded-lg'}`} data-testid={`note-${item.id}`}>
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-2">
                    {isInternal ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500/80 bg-amber-400/15 px-1.5 py-0.5 rounded">Internal Note</span>
                    ) : isInboundEmail ? (
                      <Badge variant="outline" className="h-4 gap-1 border-sky-400/30 bg-sky-400/[0.08] text-[10px] text-sky-200"><Mail className="h-2.5 w-2.5" />Email reply</Badge>
                    ) : (
                      <Badge variant="outline" className="h-4 border-emerald-400/25 bg-emerald-400/[0.08] text-[10px] text-emerald-300">Public update</Badge>
                    )}
                    <MessageAvatar item={item} name={item.user_name || item.author || "Technician"} />
                    <span className="text-sm font-medium">{item.user_name || item.author || "Technician"}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{item.created_at && formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
                </div>
                {!isInternal && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                    <span>{isInboundEmail ? `Received by email from ${item.sender_email || item.user_name || "customer"}` : item.client_notified ? `Emailed to ${(item.to_addresses || []).join(", ")}` : "Published to client portal"}</span>
                    {isInboundEmail && item.subject && <span>· {item.subject}</span>}
                    {isInboundEmail && item.attachment_count > 0 && <span>· {item.attachment_count} attachment{item.attachment_count === 1 ? "" : "s"} retained</span>}
                    {item.delivery_status && <Badge variant="outline" className={`h-4 text-[9px] ${item.delivery_status === "failed" ? "border-red-400/30 text-red-300" : item.delivery_status === "sent" ? "border-emerald-400/30 text-emerald-300" : "border-zinc-600 text-zinc-400"}`}>{item.delivery_status}</Badge>}
                    {item.subject_label && <span>· {item.subject_label}</span>}
                  </div>
                )}
                {item.content && /<[a-z][\s\S]*>/i.test(item.content) ? (
                  <div className="nx-rich-content text-sm" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.content) }} />
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{item.content}</p>
                )}
                {linkedTime && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.055] px-2.5 py-2" data-testid={`conversation-time-${item.id}`}>
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-100"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-400/15"><Timer className="h-3 w-3" /></span>Work logged</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-cyan-100/75"><strong className="font-semibold text-cyan-100">{formatMinutes(linkedTime.minutes)}</strong><span>{linkedTime.labour_type_name || "Technician default"}</span><span className={`rounded px-1.5 py-0.5 ${linkedTime.billable ? "bg-emerald-400/15 text-emerald-200" : "bg-zinc-500/15 text-zinc-300"}`}>{linkedTime.billable ? "Billable" : "Non-billable"}</span>{linkedTime.invoiced && <span className="rounded bg-violet-400/15 px-1.5 py-0.5 text-violet-200">Invoiced</span>}</span>
                  </div>
                )}
              </div>
            );
          }
          if (item._type === "email") {
            return (
              <div key={`email-${item.id}`} className="p-3 rounded-lg mb-2 border bg-blue-500/[0.03] border-blue-500/20" data-testid={`email-${item.id}`}>
                <div className="flex justify-between mb-1">
                  <div className="flex items-center gap-2">
                  <Mail className="w-3 h-3 text-blue-400" />
                  {item.direction !== "inbound" && <MessageAvatar item={item} name={item.from_name || item.user_name || "Technician"} tone="sky" />}
                    <span className="text-sm font-medium">{item.subject}</span>
                    <Badge variant="outline" className="text-blue-400 text-[10px] h-4">Email</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{item.created_at && formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>To: {item.to_addresses?.join(", ")}</span>
                  {item.attachment_count > 0 && <span>· {item.attachment_count} attachment{item.attachment_count === 1 ? "" : "s"} included</span>}
                  {(item.delivery_status || item.status) && <Badge variant="outline" className={`h-4 text-[9px] ${(item.delivery_status || item.status) === "failed" ? "border-red-400/30 text-red-300" : (item.delivery_status || item.status) === "sent" ? "border-emerald-400/30 text-emerald-300" : "border-zinc-600 text-zinc-400"}`}>{item.delivery_status || item.status}</Badge>}
                </div>
                {item.body && /<[a-z][\s\S]*>/i.test(item.body) ? (
                  <div className="nx-rich-content mt-1 text-sm" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.body) }} />
                ) : (
                  <p className="text-sm mt-1 whitespace-pre-wrap">{item.body?.substring(0, 200)}</p>
                )}
              </div>
            );
          }
          // SMS item — inbound or outbound
          const inbound = item.direction === "inbound";
          const ts = item.sent_at || item.received_at;
          const statusColor = item.status === "delivered" ? "text-emerald-400" : item.status === "failed" ? "text-red-400" : "text-muted-foreground";
          return (
            <div key={`sms-${item.id}`} className={`p-3 rounded-lg mb-2 border ${inbound ? "bg-emerald-500/[0.06] border-emerald-500/30 border-l-4 border-l-emerald-500/70" : "bg-emerald-500/[0.02] border-emerald-500/20"}`} data-testid={`sms-${item.id}`}>
              <div className="flex justify-between mb-1">
                <div className="flex items-center gap-2">
                  <PhoneCall className={`w-3 h-3 ${inbound ? "text-emerald-400" : "text-emerald-500/80"}`} />
                  <Badge variant="outline" className="text-emerald-400 text-[10px] h-4">{inbound ? "SMS Reply" : "SMS"}</Badge>
                  <span className="text-xs text-muted-foreground">{inbound ? `from ${item.sender || item.from}` : `to ${item.to}`}</span>
                  {!inbound && item.user_name && <span className="text-[10px] text-muted-foreground">by {item.user_name}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {!inbound && <span className={`text-[10px] uppercase ${statusColor}`}>{item.status || "sent"}</span>}
                  <span className="text-xs text-muted-foreground">{ts && formatDistanceToNow(new Date(ts), { addSuffix: true })}</span>
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap">{item.message}</p>
              {item.failed_reason && (
                <p className="text-[11px] text-red-400 mt-1">Failed: {item.failed_reason}</p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
