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
  Clock, RefreshCw, UserPlus, ChevronRight, Inbox
} from "lucide-react";
import { formatDistanceToNow, isToday } from "date-fns";
import {
  coalesceStateNotifications,
  notificationRecordIds,
  selectedNotificationRecordIds,
} from "@/lib/notificationPresentation";

const typeConfig = {
  sla_breach: { icon: AlertTriangle, color: "text-rose-400", bg: "bg-rose-500/10", label: "SLA breach" },
  sla_warning: { icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10", label: "SLA warning" },
  contract_renewal: { icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10", label: "Contract renewal" },
  device_offline: { icon: Monitor, color: "text-orange-400", bg: "bg-orange-500/10", label: "Device offline" },
  ticket_assigned: { icon: Ticket, color: "text-sky-400", bg: "bg-sky-500/10", label: "Ticket assigned" },
  ticket_updated: { icon: Ticket, color: "text-cyan-400", bg: "bg-cyan-500/10", label: "Ticket update" },
  ticket_escalated: { icon: Shield, color: "text-rose-400", bg: "bg-rose-500/10", label: "Escalation" },
  ticket_elevation_alert: { icon: Shield, color: "text-amber-400", bg: "bg-amber-500/10", label: "Elevation handover" },
  nexus_elevate_review: { icon: Shield, color: "text-amber-400", bg: "bg-amber-500/10", label: "Elevation review" },
  nexus_elevate_review_escalation: { icon: Shield, color: "text-rose-400", bg: "bg-rose-500/10", label: "Elevation review overdue" },
  new_lead: { icon: UserPlus, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "New lead" },
  email_received: { icon: Mail, color: "text-blue-400", bg: "bg-blue-500/10", label: "Email received" },
  system: { icon: Bell, color: "text-zinc-400", bg: "bg-zinc-500/10", label: "System" },
};

const severityAccent = { critical: "border-l-rose-500", warning: "border-l-amber-500", info: "border-l-sky-500" };

const notificationLink = (notification) => {
  if (notification.action_url && String(notification.action_url).startsWith("/")) return notification.action_url;
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
      setNotifications(coalesceStateNotifications(res.data));
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
    if (!notification.read) await markRead(notificationRecordIds(notification), true);
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
    <div className="mx-auto max-w-6xl space-y-4" data-testid="notifications-page">
      <section className="relative overflow-hidden rounded-xl border bg-card px-4 py-4 sm:px-5">
        <div className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/[0.07] text-primary"><Inbox className="h-4 w-4" /></div>
            <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold tracking-tight">Notification centre</h1>{attentionCount > 0 && <Badge className="h-5 rounded-full bg-rose-500/12 px-2 text-[10px] font-medium text-rose-300 hover:bg-rose-500/12">{attentionCount} need attention</Badge>}</div><p className="mt-0.5 text-sm text-muted-foreground">Operational updates, ordered for quick review.</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-8 gap-1.5 px-2.5 text-xs" aria-live="polite"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{unreadCount} unread</Badge>
            <Button variant="ghost" size="sm" onClick={fetchNotifications} disabled={loading} data-testid="refresh-notifications"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
            {unreadCount > 0 && <Button variant="outline" size="sm" onClick={markAllRead} data-testid="mark-all-read"><CheckCheck className="mr-1.5 h-3.5 w-3.5" />Read all</Button>}
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-2 rounded-xl border bg-card p-2 sm:flex-row sm:items-center">
        <Tabs value={view} onValueChange={setView} className="min-w-0">
          <TabsList className="h-9 w-full sm:w-auto">
            <TabsTrigger value="attention" className="h-7 flex-1 gap-1.5 px-2.5 text-xs sm:flex-none">Attention {attentionCount > 0 && <Badge className="h-4 min-w-4 rounded-full px-1 text-[9px]">{attentionCount}</Badge>}</TabsTrigger>
            <TabsTrigger value="updates" className="h-7 flex-1 px-2.5 text-xs sm:flex-none">Updates</TabsTrigger>
            <TabsTrigger value="all" className="h-7 flex-1 px-2.5 text-xs sm:flex-none">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:justify-end">
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input placeholder="Search notifications" value={search} onChange={e => setSearch(e.target.value)} className="h-8 pl-8 text-xs" data-testid="notification-search" /></div>
          <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger className="h-8 w-[130px] text-xs" data-testid="type-filter"><Filter className="mr-1 h-3 w-3" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{types.map(t => <SelectItem key={t} value={t}>{typeConfig[t]?.label || t}</SelectItem>)}</SelectContent></Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}><SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All priority</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="warning">Warning</SelectItem><SelectItem value="info">Info</SelectItem></SelectContent></Select>
        </div>
      </div>

      {selected.size > 0 && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2"><span className="mr-1 text-xs font-semibold">{selected.size} selected</span><Button size="sm" variant="outline" className="h-8" onClick={() => markRead(selectedNotificationRecordIds(notifications, selected))}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Mark read</Button><Button size="sm" variant="outline" className="h-8 text-destructive hover:text-destructive" onClick={() => deleteNotifications(selectedNotificationRecordIds(notifications, selected))}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Dismiss</Button><Button size="sm" variant="ghost" className="h-8" onClick={() => setSelected(new Set())}>Clear</Button></div>}

      {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : filtered.length === 0 ? <div className="rounded-xl border border-dashed py-16 text-center"><BellOff className="mx-auto mb-3 h-9 w-9 text-muted-foreground/30" /><p className="font-medium">You’re caught up</p><p className="mt-1 text-sm text-muted-foreground">No notifications match this view.</p></div>
        : <div className="space-y-4">{Object.entries(groups).map(([label, items]) => <section key={label}><div className="mb-1.5 flex items-center gap-2 px-1"><h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</h2><span className="h-px flex-1 bg-border" /><span className="text-[10px] text-muted-foreground">{items.length}</span></div><div className="overflow-hidden rounded-xl border bg-card">{items.map(n => {
          const cfg = typeConfig[n.type] || typeConfig.system; const Icon = cfg.icon; const link = notificationLink(n);
          return <div key={n.id} className={`group flex items-start gap-2.5 border-l-2 border-b border-b-border/60 px-3 py-2.5 transition-colors last:border-b-0 sm:px-3.5 ${severityAccent[n.severity] || "border-l-transparent"} ${!n.read ? "bg-primary/[0.025]" : ""} ${selected.has(n.id) ? "bg-primary/[0.08]" : "hover:bg-muted/40"}`} data-testid={`notification-${n.id}`}>
            <Checkbox checked={selected.has(n.id)} onCheckedChange={() => toggleSelected(n.id)} onClick={e => e.stopPropagation()} className="mt-1.5" aria-label={`Select ${n.title || n.message}`} />
            <button onClick={() => openNotification(n)} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label={link ? `Open ${n.title || n.message}` : `Mark ${n.title || n.message} as read`}>
              <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/10 ${cfg.bg}`}><Icon className={`h-3.5 w-3.5 ${cfg.color}`} /></div>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><span className="text-[13px] font-semibold leading-5">{n.title || cfg.label}</span>{!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Unread" />}{n.occurrence_count > 1 && <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal text-muted-foreground">{n.occurrence_count} combined</Badge>}</div><p className={`mt-0.5 line-clamp-2 text-xs leading-5 ${n.read ? "text-muted-foreground" : "text-foreground/80"}`}>{n.message || n.title}</p><p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground"><span>{cfg.label}</span><span aria-hidden="true">·</span><span>{notificationContext(n)}</span><span aria-hidden="true">·</span><time dateTime={n.created_at || undefined} title={n.created_at ? new Date(n.created_at).toLocaleString() : undefined}>{n.created_at ? formatDistanceToNow(new Date(n.created_at), { addSuffix: true }) : "Just now"}</time></p></div>
              {link && <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
            </button>
            <div className="flex items-center gap-0.5 self-center">{!n.read && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => markRead(notificationRecordIds(n))} title="Mark read" aria-label={`Mark ${n.title || n.message} read`}><CheckCircle2 className="h-3.5 w-3.5" /></Button>}<Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteNotifications(notificationRecordIds(n))} title="Dismiss" aria-label={`Dismiss ${n.title || n.message}`}><Trash2 className="h-3.5 w-3.5" /></Button></div>
          </div>;
        })}</div></section>)}</div>}
    </div>
  );
}
