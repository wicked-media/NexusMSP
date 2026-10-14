import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity,
  AlertCircle,
  Bell,
  Bookmark,
  Building2,
  CheckCircle2,
  FileText,
  Hash,
  Lock,
  MessageCircle,
  MessageSquarePlus,
  UserRoundCheck,
  VolumeX,
} from "lucide-react";
import { channelDisplayName, conversationPreview, PRESENCE_META } from "@/lib/teamChatHelpers";
import { directChatRequestContext } from "@/lib/chatConnections";
import { avatarStyle, formatRelative, initials, notificationSummary } from "@/lib/teamChatFormat";

export function NexusOperationsPulse({ context, pinnedCount }) {
  const contextMetrics = [
    ["Tickets", context.tickets],
    ["Invoices", context.invoices],
    ["Purchase orders", context.purchaseOrders],
    ["Pinned", pinnedCount],
  ].filter(([, value]) => value > 0);

  if (contextMetrics.length === 0) return null;

  return (
    <section className="border-b border-white/[0.07] bg-white/[0.015] px-3 py-2 md:px-5" aria-label="Linked work in this channel">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"><Activity className="h-3.5 w-3.5 text-emerald-300" />Linked work</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Linked work items">
          {contextMetrics.map(([label, value]) => (
            <span key={label} className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
              <strong className="font-medium text-zinc-100">{value}</strong>{label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function DirectRequestInbox({ requests, state, error, subscriberCount, onRetry, onReview }) {
  if (state === "loading") {
    return (
      <section className="mb-2 overflow-hidden rounded-xl border border-cyan-500/15 bg-cyan-500/[0.035] p-3" aria-label="Loading direct requests" data-testid="direct-request-loading">
        <div className="flex items-center gap-2"><span className="h-7 w-7 animate-pulse rounded-lg bg-cyan-400/15" /><div className="space-y-1"><div className="h-2.5 w-24 animate-pulse rounded bg-cyan-100/10" /><div className="h-2 w-40 animate-pulse rounded bg-white/5" /></div></div>
      </section>
    );
  }

  if (state === "unavailable") {
    return (
      <section className="mb-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3" data-testid="direct-request-unavailable">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-amber-100">Direct request inbox is not ready</p><p className="mt-1 text-[11px] leading-4 text-amber-100/70">Customer Connections needs to be available before technicians can approve private conversations.</p></div>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-amber-100" onClick={onRetry}>Retry</Button>
        </div>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className="mb-2 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-3" data-testid="direct-request-error">
        <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-rose-100">Direct requests could not refresh</p><p className="mt-1 text-[11px] leading-4 text-rose-100/70">{error || "Keep your current chats open and try again."}</p></div><Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-rose-100" onClick={onRetry}>Retry</Button></div>
      </section>
    );
  }

  return (
    <section className="mb-2 overflow-hidden rounded-xl border border-cyan-500/20 bg-[linear-gradient(135deg,rgba(6,182,212,0.10),rgba(16,185,129,0.045))] shadow-sm shadow-cyan-950/20" aria-label="Direct customer requests" data-testid="direct-request-inbox">
      <div className="flex items-start justify-between gap-3 border-b border-cyan-500/15 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-md border border-cyan-400/25 bg-cyan-400/[0.10] text-cyan-200"><MessageSquarePlus className="h-3.5 w-3.5" /></span><p className="text-xs font-semibold text-cyan-50">Direct requests</p>{requests.length > 0 && <Badge className="h-5 bg-cyan-400/15 px-1.5 text-[9px] text-cyan-100 hover:bg-cyan-400/15">{requests.length} waiting</Badge>}</div>
          <p className="mt-1 text-[10px] leading-4 text-cyan-100/60">Favourite technician requests stay private until you approve them.</p>
        </div>
        {subscriberCount > 0 && <span className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-1 text-[9px] font-medium text-emerald-100">Preferred by {subscriberCount}</span>}
      </div>
      {requests.length === 0 ? (
        <div className="px-3 py-4 text-center" data-testid="direct-request-empty"><CheckCircle2 className="mx-auto h-5 w-5 text-emerald-300/70" /><p className="mt-1.5 text-xs font-medium text-zinc-200">No direct requests waiting</p><p className="mt-1 text-[10px] leading-4 text-zinc-500">When a customer chooses you as a preferred technician, their request appears here with the work context attached.</p></div>
      ) : (
        <div className="divide-y divide-cyan-500/10">
          {requests.map(request => <DirectRequestRow key={request.id} request={request} onReview={() => onReview(request)} />)}
        </div>
      )}
    </section>
  );
}

export function DirectRequestRow({ request, onReview }) {
  const context = directChatRequestContext(request);
  return (
    <article className="group px-3 py-3 transition hover:bg-white/[0.025]" data-testid={`direct-request-${request.id}`}>
      <div className="flex gap-2.5">
        <TechnicianAvatar name={request.customerName} className="h-8 w-8" fallbackClassName="text-[10px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-zinc-100">{request.customerName}</p><p className="truncate text-[10px] text-zinc-500">{request.clientName || request.customerEmail || "Customer connection"}</p></div><span className="shrink-0 text-[10px] text-zinc-600">{formatRelative(request.createdAt)}</span></div>
          <p className="mt-2 truncate text-xs font-medium text-cyan-100">{request.subject}</p>
          {request.message && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-400">{request.message}</p>}
          {context.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{context.map(item => <span key={`${item.label}-${item.value}`} className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] ${item.tone === "violet" ? "border-violet-400/20 bg-violet-400/[0.08] text-violet-100" : item.tone === "emerald" ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-100" : "border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-100"}`}><span className="font-semibold opacity-70">{item.label}</span><span className="max-w-[108px] truncate">{item.value}</span></span>)}</div>}
          <div className="mt-2.5 flex justify-end"><Button size="sm" variant="outline" className="h-7 border-cyan-400/25 bg-cyan-400/[0.07] px-2.5 text-[10px] text-cyan-100 hover:bg-cyan-400/[0.14]" onClick={onReview} data-testid={`review-direct-request-${request.id}`}><UserRoundCheck className="mr-1 h-3 w-3" />Review request</Button></div>
        </div>
      </div>
    </article>
  );
}

export function DirectRequestDecisionForm({ request, response, onResponse }) {
  const context = directChatRequestContext(request);
  return (
    <div className="space-y-5" data-testid="direct-request-decision-form">
      <section className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.055] p-4">
        <div className="flex items-start gap-3"><TechnicianAvatar name={request.customerName} className="h-10 w-10" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground">{request.customerName}</p><p className="mt-0.5 text-xs text-muted-foreground">{request.customerEmail || "Customer contact"}{request.clientName ? ` · ${request.clientName}` : ""}</p><p className="mt-3 text-sm font-medium text-cyan-100">{request.subject}</p>{request.message && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{request.message}</p>}</div></div>
        {context.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{context.map(item => <span key={`${item.label}-${item.value}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/35 px-2.5 py-1.5 text-xs"><span className="font-medium text-muted-foreground">{item.label}</span><span className="font-mono text-foreground">{item.value}</span></span>)}</div>}
      </section>
      <section className="rounded-xl border border-border/70 bg-muted/[0.10] p-4">
        <div className="flex items-start gap-2"><Building2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /><div><p className="text-sm font-medium">Connection boundary</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Approving opens one private conversation. It does not grant customer access to device controls, billing, records, or other technicians.</p></div></div>
      </section>
      <div className="space-y-2"><Label htmlFor="direct-request-response">Response to customer <span className="text-muted-foreground">(optional to approve, required to decline)</span></Label><Textarea id="direct-request-response" value={response} onChange={event => onResponse(event.target.value.slice(0, 1200))} placeholder="For example: I can help with this. I will review the linked ticket and reply here." className="min-h-28" data-testid="direct-request-response" /><p className="text-[11px] text-muted-foreground">Nexus records your decision and this response with the request context for audit.</p></div>
    </div>
  );
}

export function CustomerConnectionPulse({ channel }) {
  const requestContext = channel.request_context || channel.context || {};
  const context = [
    requestContext.ticket_reference || channel.ticket_reference || requestContext.ticket_id || channel.ticket_id,
    requestContext.device_name || channel.device_name || requestContext.device_id || channel.device_id,
  ].filter(Boolean);
  return (
    <section className="border-b border-cyan-500/10 bg-gradient-to-r from-cyan-500/[0.08] via-violet-500/[0.035] to-transparent px-3 py-2 md:px-5" aria-label="Customer connection context" data-testid="customer-connection-pulse">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/25 bg-cyan-400/[0.08] px-2 py-1 text-[10px] font-semibold text-cyan-100"><Lock className="h-3 w-3" />Approved customer connection</span>
        <span className="text-[10px] text-zinc-500">Private by default · decision and context retained for audit</span>
        {context.map((item, index) => <span key={`${item}-${index}`} className="rounded-md border border-white/10 bg-white/[0.035] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">{item}</span>)}
      </div>
    </section>
  );
}

export function ConversationRow({ channel, active, presence, onClick }) {
  const name = channelDisplayName(channel);
  return (
    <button onClick={onClick} aria-current={active ? "page" : undefined} className={`mb-0.5 flex w-full gap-3 rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${active ? "border-cyan-500/20 bg-cyan-500/10 shadow-sm shadow-cyan-950/20" : "border-transparent hover:bg-white/[0.04]"}`} data-testid={`channel-${channel.id}`}>
      <ChannelAvatar channel={channel} presence={presence} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`truncate text-sm ${channel.unread_count ? "font-semibold text-white" : "font-medium text-zinc-300"}`}>{name}</p>
          {channel.is_saved && <Bookmark className="h-3 w-3 shrink-0 text-amber-300" aria-label="Saved conversation" />}
          {channel.is_muted && <VolumeX className="h-3 w-3 shrink-0 text-zinc-600" aria-label="Muted conversation" />}
          {(channel.notify_level === "all" || channel.notify_level === "mentions") && <Bell className="h-3 w-3 shrink-0 text-zinc-600" aria-label={`Notifications: ${notificationSummary(channel)}`} />}
          <span className="ml-auto shrink-0 text-[10px] text-zinc-500">{formatRelative(channel.last_message?.ts || channel.updated_at || channel.created_at)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className={`truncate text-xs ${channel.unread_count ? "text-zinc-300" : "text-zinc-600"}`}>
            {conversationPreview(channel)}
          </p>
          {channel.unread_count > 0 && <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-cyan-500 px-1.5 text-[10px] font-semibold text-white">{channel.unread_count > 99 ? "99+" : channel.unread_count}</span>}
        </div>
      </div>
    </button>
  );
}

export function ChannelAvatar({ channel, presence, size = "sm" }) {
  const dimension = size === "md" ? "h-10 w-10" : "h-10 w-10";
  const name = channelDisplayName(channel);
  const statusMeta = presence ? PRESENCE_META[presence] || PRESENCE_META.offline : null;
  return (
    <div className="relative shrink-0">
      {channel.kind === "team" ? (
        <Avatar className={dimension}>
          <AvatarFallback style={avatarStyle(name)}><Hash className="h-4 w-4" /></AvatarFallback>
        </Avatar>
      ) : channel.kind === "object" ? (
        <Avatar className={dimension}>
          <AvatarFallback className="border border-emerald-500/25 bg-emerald-500/10 text-emerald-200"><FileText className="h-4 w-4" /></AvatarFallback>
        </Avatar>
      ) : channel.kind === "client_direct" ? (
        <Avatar className={dimension}>
          {channel.avatar && <AvatarImage src={channel.avatar} alt={`${name} profile`} className="object-cover" />}
          <AvatarFallback className="border border-cyan-500/25 bg-cyan-500/[0.10] text-cyan-100"><MessageCircle className="h-4 w-4" /></AvatarFallback>
        </Avatar>
      ) : <TechnicianAvatar name={name} avatarUrl={channel.avatar} className={dimension} />}
      {statusMeta && <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-[#1d1f26] ${statusMeta.dot}`} />}
    </div>
  );
}

export function TechnicianAvatar({ name, avatarUrl, className = "h-9 w-9", fallbackClassName = "" }) {
  return (
    <Avatar className={className}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={`${name || "Technician"} profile`} className="object-cover" />}
      <AvatarFallback className={fallbackClassName} style={avatarStyle(name)}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

export function PresenceLabel({ status, detail }) {
  const meta = PRESENCE_META[status] || PRESENCE_META.offline;
  return <div><p className={`flex items-center gap-1.5 text-[11px] ${meta.text}`}><span className={`h-2 w-2 rounded-full ${meta.dot}`} />{meta.label}</p>{detail && detail !== "Available" && <p className="mt-0.5 truncate text-[10px] text-zinc-500">{detail}</p>}</div>;
}
