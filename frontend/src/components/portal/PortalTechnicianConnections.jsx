import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  Clock3,
  Heart,
  Loader2,
  MessageSquareText,
  Search,
  Send,
  ShieldCheck,
  Star,
  UserRoundCheck,
  UsersRound,
  XCircle,
} from "lucide-react";

const cx = (...classes) => classes.filter(Boolean).join(" ");
const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "NX";
const dateLabel = (value) => {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const availabilityMeta = (value) => {
  const status = String(value || "available").toLowerCase();
  if (["available", "online"].includes(status)) return { label: "Available", className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200", dot: "bg-emerald-300" };
  if (["busy", "on_call", "working"].includes(status)) return { label: "Working", className: "border-amber-400/25 bg-amber-400/10 text-amber-200", dot: "bg-amber-300" };
  if (["away", "offline"].includes(status)) return { label: status === "away" ? "Away" : "Offline", className: "border-slate-400/20 bg-slate-400/[0.08] text-slate-300", dot: "bg-slate-400" };
  return { label: "On service desk", className: "border-sky-400/20 bg-sky-400/[0.08] text-sky-200", dot: "bg-sky-300" };
};

const requestMeta = (status) => {
  const value = String(status || "pending").toLowerCase();
  if (value === "accepted") return { label: "Connected", className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200", icon: CheckCircle2 };
  if (value === "declined") return { label: "Not available", className: "border-rose-400/25 bg-rose-400/10 text-rose-200", icon: XCircle };
  if (value === "closed") return { label: "Closed", className: "border-slate-400/20 bg-slate-400/[0.08] text-slate-300", icon: CheckCircle2 };
  return { label: "Awaiting approval", className: "border-amber-400/25 bg-amber-400/10 text-amber-200", icon: Clock3 };
};

function TechnicianAvatar({ technician, size = "md" }) {
  const classes = size === "lg" ? "h-14 w-14 rounded-2xl" : "h-10 w-10 rounded-xl";
  if (technician?.avatar) {
    return <img src={technician.avatar} alt="" className={cx(classes, "shrink-0 object-cover ring-1 ring-white/10")} />;
  }
  return <span className={cx(classes, "flex shrink-0 items-center justify-center bg-gradient-to-br from-sky-300/20 via-cyan-300/10 to-emerald-300/15 text-xs font-bold text-cyan-100 ring-1 ring-cyan-300/20")}>{initials(technician?.name)}</span>;
}

function StatusBadge({ status }) {
  const meta = requestMeta(status);
  const Icon = meta.icon;
  return <Badge variant="outline" className={cx("h-6 gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold", meta.className)}><Icon className="h-3 w-3" />{meta.label}</Badge>;
}

function ConversationBubble({ message, mine }) {
  return (
    <div className={cx("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cx("max-w-[84%] rounded-2xl border px-3.5 py-3 sm:max-w-[74%]", mine ? "rounded-br-md border-emerald-400/20 bg-emerald-400/[0.09]" : "rounded-bl-md border-white/[0.08] bg-white/[0.035]")}>
        <p className="text-[10px] font-semibold text-slate-400">{message.author_name || message.sender_name || (mine ? "You" : "Technician")}</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">{message.body || message.content || ""}</p>
        <p className="mt-1.5 text-[9px] text-slate-600">{dateLabel(message.created_at || message.ts)}</p>
      </div>
    </div>
  );
}

export default function PortalTechnicianConnections({ api, headers, tickets = [], devices = [], companyName = "your organisation" }) {
  const [technicians, setTechnicians] = useState([]);
  const [requests, setRequests] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyFavourites, setOnlyFavourites] = useState(false);
  const [requestDialog, setRequestDialog] = useState(null);
  const [requestForm, setRequestForm] = useState({ subject: "", message: "", ticket_id: "", device_id: "" });
  const [submitting, setSubmitting] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const loadConnections = useCallback(async ({ quiet = false } = {}) => {
    if (!api || !headers?.Authorization) return;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const [directory, requestResult, conversationResult] = await Promise.all([
        axios.get(`${api}/portal/v2/chat-connections/technicians`, { headers }),
        axios.get(`${api}/portal/v2/chat-connections/requests`, { headers }),
        axios.get(`${api}/portal/v2/chat-connections/conversations`, { headers }),
      ]);
      setTechnicians(directory.data?.technicians || []);
      setRequests(requestResult.data?.requests || []);
      setConversations(conversationResult.data?.conversations || []);
      setError("");
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "We could not load your technician connections. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, headers]);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  const visibleTechnicians = useMemo(() => {
    const term = query.trim().toLowerCase();
    return technicians
      .filter((technician) => !onlyFavourites || technician.is_favourite)
      .filter((technician) => !term || `${technician.name} ${technician.role || ""} ${technician.title || ""} ${(technician.specialties || []).join(" ")}`.toLowerCase().includes(term))
      .sort((left, right) => Number(Boolean(right.is_favourite)) - Number(Boolean(left.is_favourite)) || String(left.name || "").localeCompare(String(right.name || "")));
  }, [onlyFavourites, query, technicians]);

  const favouriteCount = technicians.filter((technician) => technician.is_favourite).length;
  const pendingCount = requests.filter((request) => String(request.status || "pending").toLowerCase() === "pending").length;
  const activeConversations = conversations.filter((conversation) => !["closed", "declined"].includes(String(conversation.status || "accepted").toLowerCase()));

  const setFavourite = async (technician, favourite) => {
    const before = technicians;
    setTechnicians((rows) => rows.map((row) => row.id === technician.id ? { ...row, is_favourite: favourite } : row));
    try {
      await axios.put(`${api}/portal/v2/chat-connections/technicians/${encodeURIComponent(technician.id)}/favourite`, { favourite }, { headers });
      toast.success(favourite ? `${technician.name} is now one of your technicians` : `${technician.name} removed from your technicians`);
    } catch (requestError) {
      setTechnicians(before);
      toast.error(requestError?.response?.data?.detail || "We could not update that preference");
    }
  };

  const openRequest = (technician) => {
    setRequestForm({ subject: "", message: "", ticket_id: "", device_id: "" });
    setRequestDialog(technician);
  };

  const submitRequest = async () => {
    if (!requestDialog || !requestForm.message.trim()) return;
    setSubmitting(true);
    try {
      const response = await axios.post(`${api}/portal/v2/chat-connections/requests`, {
        technician_id: requestDialog.id,
        subject: requestForm.subject.trim() || undefined,
        message: requestForm.message.trim(),
        context: {
          ticket_id: requestForm.ticket_id || undefined,
          device_id: requestForm.device_id || undefined,
        },
      }, { headers });
      const request = response.data?.request;
      setRequests((rows) => request ? [request, ...rows.filter((row) => row.id !== request.id)] : rows);
      setRequestDialog(null);
      toast.success(response.data?.reused ? "Your existing request is still awaiting a response" : "Chat request sent for technician approval");
      await loadConnections({ quiet: true });
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "We could not send your chat request");
    } finally {
      setSubmitting(false);
    }
  };

  const openConversation = async (conversation) => {
    if (!conversation?.channel_id) return;
    setSelectedConversation(conversation);
    setMessagesLoading(true);
    try {
      const response = await axios.get(`${api}/portal/v2/chat-connections/conversations/${encodeURIComponent(conversation.channel_id)}/messages`, { headers });
      setMessages(response.data?.messages || []);
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "We could not load this secure conversation");
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!selectedConversation?.channel_id || !message.trim()) return;
    setSending(true);
    try {
      const response = await axios.post(`${api}/portal/v2/chat-connections/conversations/${encodeURIComponent(selectedConversation.channel_id)}/messages`, { body: message.trim() }, { headers });
      const postedMessage = response.data?.message || response.data;
      if (postedMessage?.body) setMessages((rows) => [...rows, postedMessage]);
      setMessage("");
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "We could not send your message");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-[440px] items-center justify-center"><div className="text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10"><Loader2 className="h-5 w-5 animate-spin text-emerald-300" /></div><p className="mt-3 text-sm font-medium text-slate-300">Preparing your technician connections</p></div></div>;
  }

  return (
    <div className="space-y-6" data-testid="portal-technician-connections">
      <section className="overflow-hidden rounded-3xl border border-emerald-400/[0.14] bg-[radial-gradient(circle_at_80%_0%,rgba(56,189,248,0.12),transparent_34%),linear-gradient(135deg,rgba(16,31,37,0.98),rgba(10,18,25,0.98))] p-5 shadow-[0_28px_80px_-48px_rgba(16,185,129,0.8)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-emerald-300"><UserRoundCheck className="h-4 w-4" /><p className="text-[10px] font-bold uppercase tracking-[0.2em]">Trusted support connection</p></div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Your technicians, one secure conversation away.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">Follow the people who know {companyName}, request a direct chat when it matters, and keep every decision and update in one retained service record.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="h-8 gap-1.5 rounded-full border-emerald-400/20 bg-emerald-400/[0.07] px-3 text-[10px] font-semibold text-emerald-200"><Heart className="h-3.5 w-3.5" />{favouriteCount} following</Badge>
            <Badge variant="outline" className="h-8 gap-1.5 rounded-full border-amber-400/20 bg-amber-400/[0.07] px-3 text-[10px] font-semibold text-amber-100"><Clock3 className="h-3.5 w-3.5" />{pendingCount} awaiting approval</Badge>
          </div>
        </div>
        <div className="mt-6 grid gap-2 rounded-2xl border border-white/[0.07] bg-black/15 p-3 text-xs text-slate-400 sm:grid-cols-3">
          <p className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">1</span>Choose a trusted technician</p>
          <p className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-400/10 text-sky-300">2</span>They approve the direct request</p>
          <p className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300">3</span>Continue in your private thread</p>
        </div>
      </section>

      {error && <div role="status" className="flex items-center justify-between gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100"><span>{error}</span><Button size="sm" variant="outline" onClick={() => loadConnections()} className="border-amber-300/20 bg-transparent text-amber-100">Retry</Button></div>}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [Heart, "Following", favouriteCount, "Technicians you have chosen", "emerald"],
          [Clock3, "Awaiting approval", pendingCount, "Requests still in review", "amber"],
          [MessageSquareText, "Private chats", activeConversations.length, "Approved conversations", "sky"],
        ].map(([Icon, label, value, detail, tone]) => (
          <Card key={label} className="overflow-hidden rounded-2xl border-white/[0.07] bg-[#101820] shadow-none"><CardContent className="flex items-center gap-3 p-4"><span className={cx("flex h-10 w-10 items-center justify-center rounded-xl", tone === "emerald" ? "bg-emerald-400/10 text-emerald-300" : tone === "amber" ? "bg-amber-400/10 text-amber-300" : "bg-sky-400/10 text-sky-300")}><Icon className="h-4 w-4" /></span><div><p className="text-xl font-semibold text-white">{value}</p><p className="text-xs font-semibold text-slate-300">{label}</p><p className="mt-0.5 text-[10px] text-slate-600">{detail}</p></div></CardContent></Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <section className="rounded-2xl border border-white/[0.08] bg-[#101820] shadow-none">
          <div className="flex flex-col gap-3 border-b border-white/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-semibold text-white">Find your technician</p><p className="mt-1 text-[11px] text-slate-500">Follow a technician first; approval keeps every direct connection intentional.</p></div>
            <Button variant="ghost" size="sm" onClick={() => loadConnections({ quiet: true })} disabled={refreshing} className="h-8 text-xs text-slate-400 hover:bg-white/[0.04] hover:text-white">{refreshing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Refresh</Button>
          </div>
          <div className="flex flex-col gap-3 border-b border-white/[0.07] p-4 sm:flex-row">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, role, or specialty…" className="h-10 rounded-xl border-white/[0.08] bg-black/15 pl-10" data-testid="portal-technician-search" /></div>
            <Button type="button" variant={onlyFavourites ? "success" : "outline"} onClick={() => setOnlyFavourites((value) => !value)} className="h-10 rounded-xl border-white/10 bg-white/[0.025] text-xs"><Heart className={cx("mr-1.5 h-3.5 w-3.5", onlyFavourites && "fill-current")} />Following</Button>
          </div>
          <div className="divide-y divide-white/[0.055]">
            {visibleTechnicians.length ? visibleTechnicians.map((technician) => {
              const availability = availabilityMeta(technician.availability);
              const latestRequest = requests.find((request) => request.technician_id === technician.id && !["declined", "closed"].includes(String(request.status || "").toLowerCase()));
              return (
                <div key={technician.id} className="group flex flex-col gap-4 p-4 transition hover:bg-white/[0.018] sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3"><TechnicianAvatar technician={technician} size="lg" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-white">{technician.name}</p>{technician.is_favourite && <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" aria-label="Following" />}<Badge variant="outline" className={cx("h-5 gap-1.5 rounded-full border px-2 text-[9px]", availability.className)}><span className={cx("h-1.5 w-1.5 rounded-full", availability.dot)} />{availability.label}</Badge></div><p className="mt-1 text-xs text-slate-400">{technician.title || technician.role || "Nexus technician"}</p>{technician.specialties?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{technician.specialties.slice(0, 3).map((specialty) => <span key={specialty} className="rounded-full border border-white/[0.07] bg-white/[0.025] px-2 py-0.5 text-[9px] text-slate-500">{specialty}</span>)}</div> : null}</div></div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setFavourite(technician, !technician.is_favourite)} className={cx("h-8 rounded-lg px-2.5 text-xs", technician.is_favourite ? "text-rose-200 hover:bg-rose-400/10 hover:text-rose-100" : "text-slate-400 hover:bg-white/[0.04] hover:text-white")}><Heart className={cx("mr-1.5 h-3.5 w-3.5", technician.is_favourite && "fill-current")} />{technician.is_favourite ? "Following" : "Follow to chat"}</Button>{latestRequest ? <StatusBadge status={latestRequest.status} /> : technician.is_favourite ? <Button size="sm" variant="success" disabled={technician.can_request_chat === false} onClick={() => openRequest(technician)} className="h-8 rounded-lg px-3 text-xs"><MessageSquareText className="mr-1.5 h-3.5 w-3.5" />Request chat</Button> : null}</div>
                </div>
              );
            }) : <div className="p-10 text-center"><UsersRound className="mx-auto h-6 w-6 text-slate-600" /><p className="mt-3 text-sm font-medium text-slate-300">No technicians found</p><p className="mt-1 text-xs text-slate-600">Try a different name or show all technicians.</p></div>}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101820] shadow-none">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4"><div><p className="text-sm font-semibold text-white">Your requests</p><p className="mt-0.5 text-[10px] text-slate-500">Every decision is retained.</p></div><ShieldCheck className="h-4 w-4 text-emerald-300" /></div>
            <div className="divide-y divide-white/[0.055]">{requests.length ? requests.slice(0, 5).map((request) => <div key={request.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-200">{request.technician_name || request.technician?.name || "Technician"}</p><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{request.subject || request.message || "Direct chat request"}</p></div><StatusBadge status={request.status} /></div><p className="mt-2 text-[9px] text-slate-600">{dateLabel(request.created_at)}</p></div>) : <div className="p-7 text-center"><Clock3 className="mx-auto h-5 w-5 text-slate-600" /><p className="mt-2 text-xs text-slate-500">No direct chat requests yet.</p></div>}</div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-sky-400/[0.15] bg-[linear-gradient(145deg,rgba(14,33,43,0.98),rgba(12,22,29,0.98))] shadow-none">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4"><div><p className="text-sm font-semibold text-white">Private conversations</p><p className="mt-0.5 text-[10px] text-slate-500">Only you and the approved technician.</p></div><MessageSquareText className="h-4 w-4 text-sky-300" /></div>
            <div className="divide-y divide-white/[0.055]">{activeConversations.length ? activeConversations.map((conversation) => <button key={conversation.channel_id || conversation.id} type="button" onClick={() => openConversation(conversation)} className="group flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.035]" data-testid={`portal-direct-conversation-${conversation.channel_id || conversation.id}`}><TechnicianAvatar technician={conversation.technician || { name: conversation.technician_name }} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-200">{conversation.technician_name || conversation.technician?.name || "Technician"}</p><p className="mt-1 truncate text-[10px] text-slate-500">{conversation.last_message?.body || conversation.last_message?.content || "Private conversation ready"}</p></div><MessageSquareText className="h-4 w-4 text-slate-600 transition group-hover:text-sky-300" /></button>) : <div className="p-7 text-center"><MessageSquareText className="mx-auto h-5 w-5 text-slate-600" /><p className="mt-2 text-xs text-slate-500">Approved chats will appear here.</p></div>}</div>
          </section>
        </aside>
      </div>

      <Dialog open={!!requestDialog} onOpenChange={(open) => !open && setRequestDialog(null)}>
        <DialogContent className="border-white/10 bg-[#101820] text-slate-100 sm:max-w-[620px]" data-testid="portal-direct-chat-request-dialog">
          <DialogHeader><div className="flex items-center gap-3"><TechnicianAvatar technician={requestDialog} size="lg" /><div><DialogTitle className="text-xl text-white">Request a direct chat</DialogTitle><DialogDescription className="mt-1 text-slate-400">{requestDialog?.name} will review your request before a private conversation opens.</DialogDescription></div></div></DialogHeader>
          <div className="space-y-4 py-2"><div className="rounded-2xl border border-sky-400/15 bg-sky-400/[0.05] p-3 text-xs leading-5 text-slate-400"><ShieldCheck className="mr-2 inline h-3.5 w-3.5 text-sky-300" />This request is retained with its context and decision. It does not bypass your normal service request or security controls.</div><div className="space-y-2"><Label className="text-xs text-slate-400">What do you need help with?</Label><Input value={requestForm.subject} onChange={(event) => setRequestForm((current) => ({ ...current, subject: event.target.value }))} placeholder="Short subject (optional)" className="h-11 rounded-xl border-white/[0.08] bg-black/15" /></div><div className="space-y-2"><Label className="text-xs text-slate-400">Message</Label><Textarea value={requestForm.message} onChange={(event) => setRequestForm((current) => ({ ...current, message: event.target.value }))} placeholder="Give the technician enough context to decide whether to accept…" rows={5} className="resize-none rounded-xl border-white/[0.08] bg-black/15" data-testid="portal-direct-chat-message" /></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label className="text-xs text-slate-400">Related request (optional)</Label><Select value={requestForm.ticket_id} onValueChange={(value) => setRequestForm((current) => ({ ...current, ticket_id: value === "none" ? "" : value }))}><SelectTrigger className="h-11 rounded-xl border-white/[0.08] bg-black/15"><SelectValue placeholder="Choose a request" /></SelectTrigger><SelectContent><SelectItem value="none">No related request</SelectItem>{tickets.slice(0, 100).map((ticket) => <SelectItem key={ticket.id} value={ticket.id}>{ticket.ticket_number || ticket.id} · {ticket.title}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label className="text-xs text-slate-400">Affected asset (optional)</Label><Select value={requestForm.device_id} onValueChange={(value) => setRequestForm((current) => ({ ...current, device_id: value === "none" ? "" : value }))}><SelectTrigger className="h-11 rounded-xl border-white/[0.08] bg-black/15"><SelectValue placeholder="Choose an asset" /></SelectTrigger><SelectContent><SelectItem value="none">No affected asset</SelectItem>{devices.slice(0, 100).map((device) => <SelectItem key={device.id} value={device.id}>{device.name || device.hostname || device.id}</SelectItem>)}</SelectContent></Select></div></div></div>
          <DialogFooter className="gap-2 sm:gap-0"><Button variant="outline" onClick={() => setRequestDialog(null)} className="rounded-xl border-white/10 bg-white/[0.03]">Cancel</Button><Button variant="success" disabled={submitting || !requestForm.message.trim()} onClick={submitRequest} className="rounded-xl">{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Request approval</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedConversation} onOpenChange={(open) => !open && setSelectedConversation(null)}>
        <DialogContent className="flex max-h-[min(760px,calc(100vh-2rem))] flex-col border-white/10 bg-[#101820] p-0 text-slate-100 sm:max-w-[760px]" data-testid="portal-direct-conversation-dialog">
          <DialogHeader className="border-b border-white/[0.07] px-6 py-5"><div className="flex items-center gap-3"><TechnicianAvatar technician={selectedConversation?.technician || { name: selectedConversation?.technician_name }} /><div><DialogTitle className="text-lg text-white">{selectedConversation?.technician_name || selectedConversation?.technician?.name || "Private technician chat"}</DialogTitle><DialogDescription className="mt-1 text-slate-500">Approved direct connection · retained service record</DialogDescription></div></div></DialogHeader>
          <ScrollArea className="min-h-[280px] flex-1 px-6 py-5"><div className="space-y-3">{messagesLoading ? <div className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-emerald-300" /></div> : messages.length ? messages.map((row) => <ConversationBubble key={row.id || `${row.created_at}-${row.body}`} message={row} mine={row.sender_type === "portal" || row.author_type === "portal" || row.actor_type === "portal_user" || String(row.user_id || "").startsWith("portal:")} />) : <div className="py-16 text-center"><MessageSquareText className="mx-auto h-6 w-6 text-slate-600" /><p className="mt-3 text-sm text-slate-500">Your secure conversation is ready. Send the first message when you are ready.</p></div>}</div></ScrollArea>
          <div className="border-t border-white/[0.07] p-4"><Textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="Write a message to your technician…" rows={3} className="resize-none rounded-xl border-white/[0.08] bg-black/15" data-testid="portal-direct-chat-composer" /><div className="mt-2 flex items-center justify-between"><p className="text-[10px] text-slate-600">Enter to send · Shift+Enter for a new line</p><Button variant="success" size="sm" disabled={sending || !message.trim()} onClick={sendMessage} className="rounded-lg">{sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}Send</Button></div></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
