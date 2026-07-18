import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Bell, BellOff, CheckCircle2, AlertTriangle, Shield, Monitor, Ticket,
  FileText, Mail, Search, Trash2, CheckCheck, Loader2, Filter,
  Clock, RefreshCw, ExternalLink, UserPlus, ChevronRight, Inbox
} from "lucide-react";
import { formatDistanceToNow, isToday } from "date-fns";

const typeConfig = {
  sla_breach: { icon: AlertTriangle, color: "text-rose-400", bg: "bg-rose-500/10", label: "SLA breach" },
  sla_warning: { icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10", label: "SLA warning" },
  contract_renewal: { icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10", label: "Contract renewal" },
  device_offline: { icon: Monitor, color: "text-orange-400", bg: "bg-orange-500/10", label: "Device offline" },
  ticket_assigned: { icon: Ticket, color: "text-sky-400", bg: "bg-sky-500/10", label: "Ticket assigned" },
  ticket_updated: { icon: Ticket, color: "text-cyan-400", bg: "bg-cyan-500/10", label: "Ticket update" },
  ticket_escalated: { icon: Shield, color: "text-rose-400", bg: "bg-rose-500/10", label: "Escalation" },
  new_lead: { icon: UserPlus, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "New lead" },
  email_received: { icon: Mail, color: "text-blue-400", bg: "bg-blue-500/10", label: "Email received" },
  system: { icon: Bell, color: "text-zinc-400", bg: "bg-zinc-500/10", label: "System" },
};

const severityAccent = { critical: "border-l-rose-500", warning: "border-l-amber-500", info: "border-l-sky-500" };

const notificationLink = (notification) => {
  if (!notification.ref_type || !notification.ref_id) return null;
  if (notification.ref_type === "lead") return `/leads?lead=${encodeURIComponent(notification.ref_id)}`;
  if (notification.ref_type === "device") return `/devices/${notification.ref_id}`;
  if (notification.ref_type === "ticket") return `/tickets?ticket=${encodeURIComponent(notification.ref_id)}`;
  if (notification.ref_type === "contract") return `/contracts?contract=${encodeURIComponent(notification.ref_id)}`;
  return null;
};

const notificationContext = (notification) => notification.ref_type
  ? `${notification.ref_type.charAt(0).toUpperCase()}${notification.ref_type.slice(1)}${notification.source_mailbox ? ` · ${notification.source_mailbox}` : ""}`
  : notification.source_mailbox || "NexusMSP";

export default function NotificationsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(() => searchParams.get("type") || "all");
  const [severityFilter, setSeverityFilter] = useState(() => searchParams.get("severity") || "all");
  const [view, setView] = useState(() => searchParams.get("view") || "attention");
  const [selected, setSelected] = useState(new Set());
  const headers = { Authorization: `Bearer ${token}` };

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/notifications/generate`, {}, { headers });
      const res = await axios.get(`${API}/notifications`, { headers });
      setNotifications(res.data);
    } catch { toast.error("Failed to fetch notifications"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchNotifications(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const requestedSeverity = searchParams.get("severity");
    const requestedType = searchParams.get("type");
    const requestedView = searchParams.get("view");
    setSeverityFilter(["critical", "warning", "info", "all"].includes(requestedSeverity) ? requestedSeverity : "all");
    setTypeFilter(requestedType || "all");
    setView(["attention", "updates", "all"].includes(requestedView) ? requestedView : "attention");
  }, [searchParams]);

  const markRead = async (ids, quiet = false) => {
    try {
      await axios.post(`${API}/notifications/mark-read`, { ids }, { headers });
      setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, read: true } : n));
      setSelected(new Set());
      if (!quiet) toast.success("Marked as read");
    } catch { toast.error("Could not update notification"); }
  };

  const markAllRead = async () => {
    try {
      await axios.post(`${API}/notifications/mark-read`, {}, { headers });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setSelected(new Set());
      toast.success("Inbox marked as read");
    } catch { toast.error("Could not update notifications"); }
  };

  const deleteNotifications = async (ids) => {
    try {
      await axios.post(`${API}/notifications/delete`, { ids }, { headers });
      setNotifications(prev => prev.filter(n => !ids.includes(n.id)));
      setSelected(new Set());
      toast.success(ids.length === 1 ? "Notification dismissed" : "Notifications dismissed");
    } catch { toast.error("Could not dismiss notifications"); }
  };

  const openNotification = async (notification) => {
    if (!notification.read) await markRead([notification.id], true);
    const link = notificationLink(notification);
    if (link) navigate(link);
  };

  const toggleSelected = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const unreadCount = notifications.filter(n => !n.read).length;
  const attentionCount = notifications.filter(n => !n.read && ["critical", "warning"].includes(n.severity)).length;
  const types = [...new Set(notifications.map(n => n.type))];
  const filtered = useMemo(() => notifications.filter(n => {
    const text = `${n.title || ""} ${n.message || ""} ${n.source_mailbox || ""}`.toLowerCase();
    if (view === "attention" && !(!n.read && ["critical", "warning"].includes(n.severity))) return false;
    if (view === "updates" && (!n.read || ["critical", "warning"].includes(n.severity))) return false;
    if (typeFilter !== "all" && n.type !== typeFilter) return false;
    if (severityFilter !== "all" && n.severity !== severityFilter) return false;
    if (search && !text.includes(search.toLowerCase())) return false;
    return true;
  }), [notifications, search, severityFilter, typeFilter, view]);

  const groups = useMemo(() => filtered.reduce((result, n) => {
    const when = n.created_at ? new Date(n.created_at) : null;
    const label = when && isToday(when) ? "Today" : when && Date.now() - when.getTime() < 172800000 ? "Earlier" : "Previous updates";
    (result[label] ||= []).push(n);
    return result;
  }, {}), [filtered]);

  return (
    <div className="mx-auto max-w-6xl space-y-5" data-testid="notifications-page">
      <section className="relative overflow-hidden rounded-2xl border bg-card px-5 py-5 sm:px-6">
        <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Inbox className="h-5 w-5" /></div>
            <div><h1 className="text-2xl font-bold tracking-tight">Notification inbox</h1><p className="mt-1 text-sm text-muted-foreground">Prioritised operational updates, ready to act on.</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{unreadCount} unread</Badge>
            <Button variant="outline" size="sm" onClick={fetchNotifications} disabled={loading} data-testid="refresh-notifications"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
            {unreadCount > 0 && <Button variant="outline" size="sm" onClick={markAllRead} data-testid="mark-all-read"><CheckCheck className="mr-1.5 h-3.5 w-3.5" />Mark all read</Button>}
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
        <Tabs value={view} onValueChange={setView} className="min-w-0">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="attention" className="flex-1 gap-1.5 sm:flex-none">Needs attention {attentionCount > 0 && <Badge className="h-4 min-w-4 rounded-full px-1 text-[9px]">{attentionCount}</Badge>}</TabsTrigger>
            <TabsTrigger value="updates" className="flex-1 sm:flex-none">Updates</TabsTrigger>
            <TabsTrigger value="all" className="flex-1 sm:flex-none">All activity</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:justify-end">
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Search inbox" value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-9" data-testid="notification-search" /></div>
          <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger className="h-9 w-[135px]" data-testid="type-filter"><Filter className="mr-1 h-3 w-3" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{types.map(t => <SelectItem key={t} value={t}>{typeConfig[t]?.label || t}</SelectItem>)}</SelectContent></Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}><SelectTrigger className="h-9 w-[125px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All priority</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="warning">Warning</SelectItem><SelectItem value="info">Info</SelectItem></SelectContent></Select>
        </div>
      </div>

      {selected.size > 0 && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-4 py-2.5"><span className="mr-1 text-sm font-medium">{selected.size} selected</span><Button size="sm" variant="outline" onClick={() => markRead([...selected])}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Mark read</Button><Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => deleteNotifications([...selected])}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Dismiss</Button><Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button></div>}

      {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : filtered.length === 0 ? <div className="rounded-2xl border border-dashed py-20 text-center"><BellOff className="mx-auto mb-3 h-11 w-11 text-muted-foreground/30" /><p className="font-medium">Nothing here right now</p><p className="mt-1 text-sm text-muted-foreground">You’re caught up for this view.</p></div>
        : <div className="space-y-6">{Object.entries(groups).map(([label, items]) => <section key={label}><div className="mb-2 flex items-center gap-2 px-1"><h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</h2><span className="h-px flex-1 bg-border" /></div><div className="overflow-hidden rounded-xl border bg-card">{items.map(n => {
          const cfg = typeConfig[n.type] || typeConfig.system; const Icon = cfg.icon; const link = notificationLink(n);
          return <div key={n.id} className={`group flex items-start gap-3 border-l-4 px-3 py-3 transition-colors last:border-b-0 sm:px-4 ${severityAccent[n.severity] || "border-l-transparent"} ${!n.read ? "bg-primary/[0.035]" : ""} ${selected.has(n.id) ? "bg-primary/10" : "hover:bg-muted/50"}`} data-testid={`notification-${n.id}`}>
            <Checkbox checked={selected.has(n.id)} onCheckedChange={() => toggleSelected(n.id)} onClick={e => e.stopPropagation()} className="mt-2" aria-label={`Select ${n.title || n.message}`} />
            <button onClick={() => openNotification(n)} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-label={link ? `Open ${n.title || n.message}` : `Mark ${n.title || n.message} as read`}>
              <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}><Icon className={`h-4 w-4 ${cfg.color}`} /></div>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{n.title || cfg.label}</span>{!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}<Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">{notificationContext(n)}</Badge></div><p className={`mt-1 text-sm ${n.read ? "text-muted-foreground" : "text-foreground/85"}`}>{n.message || n.title}</p><p className="mt-1.5 text-[11px] text-muted-foreground">{n.created_at ? formatDistanceToNow(new Date(n.created_at), { addSuffix: true }) : "Just now"}</p></div>
              {link && <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
            </button>
            <div className="hidden items-center gap-1 self-center sm:flex">{!n.read && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => markRead([n.id])} title="Mark read"><CheckCircle2 className="h-3.5 w-3.5" /></Button>}{link && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openNotification(n)} title="Open related item" data-testid={`open-notification-${n.id}`}><ExternalLink className="h-3.5 w-3.5" /></Button>}<Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteNotifications([n.id])} title="Dismiss"><Trash2 className="h-3.5 w-3.5" /></Button></div>
          </div>;
        })}</div></section>)}</div>}
    </div>
  );
}
