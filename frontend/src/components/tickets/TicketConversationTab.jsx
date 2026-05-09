import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Send, MessageSquare, Mail, PhoneCall, Loader2, User, Zap } from "lucide-react";
import DOMPurify from "dompurify";
import { formatDistanceToNow } from "date-fns";

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
}) {
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
      {/* Message Type Selector */}
      <div className="flex items-center gap-3 pb-2 border-b border-border/50">
        <Select value={conversationType} onValueChange={setConversationType}>
          <SelectTrigger className="w-[200px]" data-testid="conversation-type-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="note"><div className="flex items-center gap-2"><MessageSquare className="w-3 h-3" />Internal Note</div></SelectItem>
            <SelectItem value="email"><div className="flex items-center gap-2"><Mail className="w-3 h-3" />Public Email</div></SelectItem>
            <SelectItem value="sms"><div className="flex items-center gap-2"><PhoneCall className="w-3 h-3" />SMS</div></SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {conversationType === "note" ? "Internal notes are only visible to your team" : conversationType === "email" ? "Emails will be sent to the client" : "SMS will be sent via MobileMessage to the client's mobile"}
        </span>
      </div>

      {/* Internal Note Form */}
      {conversationType === "note" && (
        <div className="space-y-2">
          <RichTextEditor content={newNote} onChange={setNewNote} placeholder="Add an internal note..." minHeight="80px" />
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" onClick={handleAddNote} data-testid="add-note-btn"><Send className="w-3 h-3 mr-1" />Add Note</Button>
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
          {emailSignature && <div className="border rounded p-2 bg-muted/30"><p className="text-xs text-muted-foreground mb-1">Signature:</p><div className="text-sm" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailSignature) }} /></div>}
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSendEmail} data-testid="send-inline-email-btn"><Send className="w-3 h-3 mr-1" />Send Email</Button>
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
            <Textarea value={smsForm.message} onChange={e => setSmsForm({ ...smsForm, message: e.target.value })} placeholder="Hi, update on your ticket..." rows={4} maxLength={1600} data-testid="sms-message-input" />
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
      <div className="border rounded-lg overflow-hidden" style={{ resize: "vertical", overflow: "auto", height: "500px", minHeight: "200px" }}>
        {allItems.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No conversation items yet</p>
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
                      <Badge variant="outline" className="text-[10px] h-4">Note</Badge>
                    )}
                    <User className="w-3 h-3" /><span className="text-sm font-medium">{item.user_name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{item.created_at && formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
                </div>
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
