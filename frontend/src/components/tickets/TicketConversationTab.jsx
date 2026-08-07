import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Send, Mail, PhoneCall, Loader2, Zap, LockKeyhole, Globe2, MailCheck, CircleAlert } from "lucide-react";
import DOMPurify from "dompurify";
import { formatDistanceToNow } from "date-fns";

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

/**
 * Conversation tab for the Ticket Detail view.
 * Pure presentational — all state + handlers come from parent.
 */
export default function TicketConversationTab({
  conversationType, setConversationType,
  newNote, setNewNote, handleAddNote, cannedResponses,
  emailForm, setEmailForm, handleSendEmail, emailSignature, clientContacts,
  smsForm, setSmsForm, handleSendSms, applySmsTemplate, smsTemplates, smsConfig, smsSending,
  ticketNotes, ticketEmails, ticketSms,
  recordLabel = "ticket",
  allowStatusChange = true,
}) {
  const [publicEmailEnabled, setPublicEmailEnabled] = useState(true);
  const [publicSubjectLabel, setPublicSubjectLabel] = useState("Update");
  const [publicStatusAfter, setPublicStatusAfter] = useState("__unchanged");
  const publicRecipient = (emailForm.to || "").split(",").map(value => value.trim()).filter(Boolean)[0] || "";
  const allItems = [
    ...ticketNotes.map(n => ({ ...n, _type: "note", _sort: n.created_at })),
    ...ticketEmails.map(e => ({ ...e, _type: "email", _sort: e.created_at })),
    ...ticketSms.map(s => ({ ...s, _type: "sms", _sort: s.sent_at || s.received_at })),
  ].sort((a, b) => (b._sort || "").localeCompare(a._sort || ""));

  const sigEffLen = (() => {
    const sig = (smsConfig.append_signature && smsConfig.signature) ? smsConfig.signature : "";
    return smsForm.message.length + (sig && !smsForm.message.toLowerCase().includes(sig.toLowerCase()) ? sig.length + 2 : 0);
  })();

  return (
    <>
      {/* Message type / composer context */}
      <div className="rounded-xl border border-white/[0.08] bg-black/[0.14] p-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.12)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] p-1" role="tablist" aria-label="Message type">
            {[
              { value: "public", label: "Public update", icon: Globe2 },
              { value: "note", label: "Internal note", icon: LockKeyhole },
              { value: "email", label: "Email client", icon: Mail },
              { value: "sms", label: "SMS", icon: PhoneCall },
            ].map(({ value, label, icon: Icon }) => (
              <Button key={value} type="button" variant="ghost" size="sm" onClick={() => setConversationType(value)} className={`h-8 gap-1.5 px-2.5 text-xs ${conversationType === value ? "bg-cyan-500/[0.16] text-cyan-100 hover:bg-cyan-500/[0.22]" : "text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200"}`} data-testid={value === "note" ? "conversation-type-select" : undefined}>
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
            <RichTextEditor content={newNote} onChange={setNewNote} placeholder="Write a clear customer update, the next action, and when they should expect to hear from you…" minHeight="150px" />
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
                  disabled={publicEmailEnabled && !publicRecipient}
                  onClick={() => handleAddNote({
                    visibility: "public",
                    notify_client: publicEmailEnabled,
                    to_addresses: publicEmailEnabled ? (emailForm.to || "").split(",").map(value => value.trim()).filter(Boolean) : [],
                    subject_label: publicSubjectLabel,
                    status_after: allowStatusChange && publicStatusAfter !== "__unchanged" ? publicStatusAfter : "",
                  })}
                  data-testid="publish-public-update"
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />{publicEmailEnabled ? "Publish & email" : "Publish update"}
                </Button>
              </div>
            </div>
            {publicEmailEnabled && !publicRecipient && <p className="flex items-center gap-1.5 text-[11px] text-amber-300"><CircleAlert className="h-3.5 w-3.5" />Choose a contact email before sending, or switch to portal-only.</p>}
          </div>
        </div>
      )}

      {/* Internal Note Form */}
      {conversationType === "note" && (
        <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.035] p-3">
          <RichTextEditor content={newNote} onChange={setNewNote} placeholder="Add an internal note..." minHeight="80px" />
          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-amber-500/15 pt-2">
            <span className="text-[10px] text-amber-300/80">Notes stay private to your team.</span>
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
            <Button size="sm" className="bg-amber-400 text-amber-950 hover:bg-amber-300" onClick={() => handleAddNote({ visibility: "internal" })} data-testid="add-note-btn"><Send className="w-3 h-3 mr-1.5" />Add private note</Button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Email Form */}
      {conversationType === "email" && (
        <div className="space-y-3 p-3 rounded-lg border bg-blue-500/[0.02] border-blue-500/20">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">To</Label>
              <div className="relative">
                <Input value={emailForm.to} onChange={e => setEmailForm({ ...emailForm, to: e.target.value })} placeholder="recipient@email.com" data-testid="inline-email-to" list="contact-emails" />
                <datalist id="contact-emails">
                  {clientContacts.map(c => c.email && <option key={c.id} value={c.email}>{c.name} ({c.email})</option>)}
                </datalist>
              </div>
            </div>
            <div><Label className="text-xs">CC</Label><Input value={emailForm.cc} onChange={e => setEmailForm({ ...emailForm, cc: e.target.value })} placeholder="cc@email.com" /></div>
            <div><Label className="text-xs">BCC</Label><Input value={emailForm.bcc} onChange={e => setEmailForm({ ...emailForm, bcc: e.target.value })} placeholder="bcc@email.com" /></div>
          </div>
          <div><Label className="text-xs">Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} data-testid="inline-email-subject" /></div>
          <div>
            <Label className="text-xs">Body</Label>
            <RichTextEditor content={emailForm.body} onChange={body => setEmailForm({ ...emailForm, body })} placeholder="Write your email..." minHeight="320px" />
          </div>
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
            <Button size="sm" onClick={handleSendEmail} disabled={!emailForm.to?.trim()} data-testid="send-inline-email-btn"><Send className="w-3 h-3 mr-1" />Send Email</Button>
          </div>
        </div>
      )}

      {/* Inline SMS Form */}
      {conversationType === "sms" && (
        <div className="space-y-3 p-3 rounded-lg border bg-emerald-500/[0.03] border-emerald-500/20" data-testid="sms-form">
          <div className="grid grid-cols-2 gap-2">
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
            <Button size="sm" onClick={handleSendSms} disabled={smsSending} data-testid="send-sms-btn">
              {smsSending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
              Send SMS
            </Button>
          </div>
        </div>
      )}

      {/* Unified Conversation Timeline */}
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/[0.10]" style={{ resize: "vertical", overflow: "auto", height: "500px", minHeight: "240px" }}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.07] bg-[#111318]/95 px-3 py-2 backdrop-blur"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{recordLabel} activity</span><span className="text-[10px] text-zinc-600">{allItems.length} item{allItems.length === 1 ? "" : "s"}</span></div>
        {allItems.length === 0 ? (
          <p className="text-center py-10 text-sm text-muted-foreground">No activity yet. Add an internal note or send the first update.</p>
        ) : allItems.map(item => {
          if (item._type === "note") {
            const isInternal = item.is_internal;
            return (
              <div key={`note-${item.id}`} className={`p-3 rounded-lg mb-2 ${isInternal ? 'bg-amber-400/10 border-l-4 border-l-amber-400/60 border border-amber-400/20 shadow-sm' : 'bg-muted/30 border border-border rounded-lg'}`} data-testid={`note-${item.id}`}>
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-2">
                    {isInternal ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500/80 bg-amber-400/15 px-1.5 py-0.5 rounded">Internal Note</span>
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
                    <span>{item.client_notified ? `Emailed to ${(item.to_addresses || []).join(", ")}` : "Published to client portal"}</span>
                    {item.delivery_status && <Badge variant="outline" className={`h-4 text-[9px] ${item.delivery_status === "failed" ? "border-red-400/30 text-red-300" : item.delivery_status === "sent" ? "border-emerald-400/30 text-emerald-300" : "border-zinc-600 text-zinc-400"}`}>{item.delivery_status}</Badge>}
                    {item.subject_label && <span>· {item.subject_label}</span>}
                  </div>
                )}
                {item.content && /<[a-z][\s\S]*>/i.test(item.content) ? (
                  <div className="text-sm prose prose-sm prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.content) }} />
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{item.content}</p>
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
                <p className="text-xs text-muted-foreground">To: {item.to_addresses?.join(", ")}</p>
                {item.body && /<[a-z][\s\S]*>/i.test(item.body) ? (
                  <div className="text-sm prose prose-sm prose-invert max-w-none mt-1" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.body) }} />
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
