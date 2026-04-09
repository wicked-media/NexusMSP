import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Bell, BellOff, CheckCircle, AlertTriangle, Shield, Monitor, Ticket,
  FileText, Mail, Users, Search, Trash2, CheckCheck, Loader2, Filter,
  Clock, RefreshCw, ExternalLink, UserPlus
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const typeConfig = {
  sla_breach: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10", label: "SLA Breach" },
  sla_warning: { icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10", label: "SLA Warning" },
  contract_renewal: { icon: FileText, color: "text-purple-400", bg: "bg-purple-500/10", label: "Contract Renewal" },
  device_offline: { icon: Monitor, color: "text-orange-400", bg: "bg-orange-500/10", label: "Device Offline" },
  ticket_assigned: { icon: Ticket, color: "text-blue-400", bg: "bg-blue-500/10", label: "Ticket Assigned" },
  ticket_updated: { icon: Ticket, color: "text-cyan-400", bg: "bg-cyan-500/10", label: "Ticket Updated" },
  ticket_escalated: { icon: Shield, color: "text-red-400", bg: "bg-red-500/10", label: "Escalation" },
  new_lead: { icon: UserPlus, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "New Lead" },
  email_received: { icon: Mail, color: "text-blue-400", bg: "bg-blue-500/10", label: "Email Received" },
  system: { icon: Bell, color: "text-zinc-400", bg: "bg-zinc-500/10", label: "System" },
};

const severityStyles = {
  critical: "border-l-red-500",
  warning: "border-l-amber-500",
  info: "border-l-blue-500",
};

export default function NotificationsPage() {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [readFilter, setReadFilter] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const headers = { Authorization: `Bearer ${token}` };

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      // Generate fresh notifications then fetch
      await axios.post(`${API}/notifications/generate`, {}, { headers });
      const res = await axios.get(`${API}/notifications`, { headers });
      setNotifications(res.data);
    } catch { toast.error("Failed to fetch notifications"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchNotifications(); }, []);

  const markRead = async (ids) => {
    try {
      await axios.post(`${API}/notifications/mark-read`, { ids }, { headers });
      setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, read: true } : n));
      setSelected(new Set());
      toast.success("Marked as read");
    } catch { toast.error("Failed"); }
  };

  const markAllRead = async () => {
    try {
      await axios.post(`${API}/notifications/mark-read`, {}, { headers });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      toast.success("All notifications marked as read");
    } catch { toast.error("Failed"); }
  };

  const deleteNotifications = async (ids) => {
    try {
      await axios.post(`${API}/notifications/delete`, { ids }, { headers });
      setNotifications(prev => prev.filter(n => !ids.includes(n.id)));
      setSelected(new Set());
      toast.success("Deleted");
    } catch { toast.error("Failed"); }
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Filters
  const filtered = notifications.filter(n => {
    if (typeFilter !== "all" && n.type !== typeFilter) return false;
    if (severityFilter !== "all" && n.severity !== severityFilter) return false;
    if (readFilter === "unread" && n.read) return false;
    if (readFilter === "read" && !n.read) return false;
    if (search && !n.message?.toLowerCase().includes(search.toLowerCase()) && !n.title?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Group by date
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const groups = {};
  filtered.forEach(n => {
    const d = n.created_at ? new Date(n.created_at).toDateString() : "Unknown";
    const label = d === today ? "Today" : d === yesterday ? "Yesterday" : d;
    if (!groups[label]) groups[label] = [];
    groups[label].push(n);
  });

  const unreadCount = notifications.filter(n => !n.read).length;
  const types = [...new Set(notifications.map(n => n.type))];

  return (
    <div className="space-y-6 max-w-5xl" data-testid="notifications-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground text-sm">{unreadCount} unread &middot; {notifications.length} total</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchNotifications} disabled={loading} data-testid="refresh-notifications">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllRead} data-testid="mark-all-read">
              <CheckCheck className="w-4 h-4 mr-1" />Mark All Read
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search notifications..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" data-testid="notification-search" />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px] h-9" data-testid="type-filter"><Filter className="w-3 h-3 mr-1" /><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {types.map(t => <SelectItem key={t} value={t}>{typeConfig[t]?.label || t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severity</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={readFilter} onValueChange={setReadFilter}>
              <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="unread">Unread</SelectItem>
                <SelectItem value="read">Read</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => markRead([...selected])}><CheckCircle className="w-3 h-3 mr-1" />Mark Read</Button>
          <Button size="sm" variant="destructive" onClick={() => deleteNotifications([...selected])}><Trash2 className="w-3 h-3 mr-1" />Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {/* Notification List */}
      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <BellOff className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">No notifications</p>
          <p className="text-xs text-muted-foreground/60 mt-1">You're all caught up</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([dateLabel, items]) => (
            <div key={dateLabel}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">{dateLabel}</h3>
              <div className="space-y-1">
                {items.map(n => {
                  const cfg = typeConfig[n.type] || typeConfig.system;
                  const Icon = cfg.icon;
                  return (
                    <div key={n.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border-l-4 transition-colors cursor-pointer group ${severityStyles[n.severity] || "border-l-transparent"} ${!n.read ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/50"} ${selected.has(n.id) ? "ring-1 ring-primary/40" : ""}`}
                      onClick={() => toggleSelect(n.id)}
                      data-testid={`notification-${n.id}`}
                    >
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                        <Icon className={`w-4 h-4 ${cfg.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{cfg.label}</Badge>
                          {!n.read && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                        </div>
                        <p className={`text-sm mt-0.5 ${!n.read ? "font-medium" : "text-muted-foreground"}`}>{n.message || n.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {n.created_at ? formatDistanceToNow(new Date(n.created_at), { addSuffix: true }) : ""}
                        </p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!n.read && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); markRead([n.id]); }} title="Mark read">
                            <CheckCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={e => { e.stopPropagation(); deleteNotifications([n.id]); }} title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
