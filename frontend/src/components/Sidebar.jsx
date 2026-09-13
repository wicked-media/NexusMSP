import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/App";
import {
  ChevronLeft, ChevronRight, ChevronDown, Bell, Search, X, AlertTriangle,
  CheckCheck, Pin, Clock3, Monitor, Ticket, FileText, UserPlus,
  MessageCircle, ReceiptText, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { API } from "@/App";
import { navGroups, getAllNavItems, taskShortcuts } from "@/config/navigation";
import { useNavCounts, NavBadge } from "@/hooks/useNavCounts";
import NexusGlobalPulse from "@/components/NexusGlobalPulse";
import { coalesceStateNotifications, notificationRecordIds } from "@/lib/notificationPresentation";
import {
  getNavigationItemState,
  getActiveParentNavigationPath,
  getActiveNavigationGroupId,
  readSidebarPreferences,
  togglePinnedWorkspace,
  writeSidebarPreferences,
} from "@/lib/sidebarNavigation";

const notificationTypeVisuals = {
  sla_breach: { icon: ShieldAlert, label: "SLA breach", tone: "critical" },
  sla_warning: { icon: Clock3, label: "SLA warning", tone: "warning" },
  contract_renewal: { icon: FileText, label: "Contract", tone: "warning" },
  device_offline: { icon: Monitor, label: "Device", tone: "warning" },
  ticket_assigned: { icon: Ticket, label: "Ticket", tone: "info" },
  ticket_updated: { icon: Ticket, label: "Ticket", tone: "info" },
  new_lead: { icon: UserPlus, label: "Lead", tone: "success" },
  supplier_invoice_follow_up: { icon: ReceiptText, label: "Invoice", tone: "warning" },
  chat_mention: { icon: MessageCircle, label: "Mention", tone: "info" },
  chat_broadcast: { icon: MessageCircle, label: "Message", tone: "info" },
  thread_reply: { icon: MessageCircle, label: "Reply", tone: "info" },
};

const notificationToneClasses = {
  critical: "border-rose-500/25 bg-rose-500/[0.07] text-rose-400",
  warning: "border-amber-500/25 bg-amber-500/[0.07] text-amber-400",
  success: "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-400",
  info: "border-sky-500/25 bg-sky-500/[0.07] text-sky-400",
};

const notificationTime = (value) => {
  if (!value) return "Just now";
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "Just now";
  return formatDistanceToNow(when, { addSuffix: true });
};

// Compact operational notification centre shared by the global shell.
export function NotificationBell({ token, collapsed = true, placement = "sidebar" }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [panelView, setPanelView] = useState("attention");
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const getNotificationLink = (n) => {
    if (n.action_url && String(n.action_url).startsWith("/")) return n.action_url;
    const refType = n.ref_type;
    const refId = n.ref_id;
    if (!refType || !refId) return null;
    switch (refType) {
      case "ticket": return `/tickets?ticket=${encodeURIComponent(refId)}`;
      case "contract": return `/contracts?contract=${encodeURIComponent(refId)}`;
      case "device": return `/devices/${refId}`;
      case "lead": return `/leads?lead=${encodeURIComponent(refId)}`;
      case "purchase_order": return `/purchase-orders?po=${encodeURIComponent(refId)}`;
      case "chat_channel": return `/team-chat?channel=${encodeURIComponent(refId)}${n.thread_id ? `&thread=${encodeURIComponent(n.thread_id)}` : ''}`;
      default: return null;
    }
  };

  const handleNotificationClick = (n) => {
    const link = getNotificationLink(n);
    if (!n.read) {
      axios.post(`${API}/notifications/mark-read`, { ids: notificationRecordIds(n) }, { headers }).catch(() => {});
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
    if (link) {
      setIsOpen(false);
      navigate(link);
    }
  };

  const fetchNotifications = useCallback(async () => {
    try {
      const nRes = await axios.get(`${API}/notifications`, { headers });
      const current = coalesceStateNotifications(nRes.data);
      setNotifications(current.slice(0, 15));
      setUnreadCount(current.filter(notification => !notification.read).length);
    } catch {}
  }, [headers]);

  useEffect(() => {
    fetchNotifications();
    axios.post(`${API}/notifications/generate`, {}, { headers }).then(() => fetchNotifications()).catch(() => {});
    const iv = setInterval(fetchNotifications, 60000);
    return () => clearInterval(iv);
  }, [fetchNotifications, headers]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setIsOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  const markAllRead = async () => {
    try {
      await axios.post(`${API}/notifications/mark-read`, {}, { headers });
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  };

  const attentionCount = notifications.filter(n => !n.read && ["critical", "warning"].includes(n.severity)).length;
  const visibleNotifications = panelView === "attention"
    ? notifications.filter(n => !n.read && ["critical", "warning"].includes(n.severity))
    : notifications;

  return (
    <TooltipProvider delayDuration={0}>
    <div className={placement === "topbar" ? "relative" : `relative px-3 py-1.5 ${collapsed ? 'flex justify-center' : ''}`} ref={ref}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={triggerRef}
            onClick={() => setIsOpen(!isOpen)}
            className={`relative flex items-center gap-2 rounded-lg border border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 ${
              placement === "topbar"
                ? `h-8 w-8 justify-center ${isOpen ? "border-border/70 bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`
                : collapsed ? 'justify-center p-2 hover:bg-muted' : 'w-full px-3 py-2 hover:bg-muted'
            }`}
            data-testid="notification-bell"
            aria-label={unreadCount > 0 ? `Open notifications, ${unreadCount} unread` : "Open notifications"}
            aria-expanded={isOpen}
            aria-controls="nexus-notification-panel"
            aria-haspopup="dialog"
          >
            <Bell className={`h-[17px] w-[17px] ${isOpen ? "text-foreground" : "text-muted-foreground"}`} />
            {!collapsed && placement !== "topbar" && <span className="text-[12px] text-muted-foreground">Notifications</span>}
            {unreadCount > 0 && (
              <span className={`absolute flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-background bg-rose-500 px-1 text-[9px] font-bold leading-none text-white ${placement === "topbar" ? "-right-1.5 -top-1" : "right-0 top-0"}`} aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>
        </TooltipTrigger>
        {(collapsed || placement === "topbar") && <TooltipContent side={placement === "topbar" ? "bottom" : "right"}>Notifications {unreadCount > 0 ? `(${unreadCount})` : ''}</TooltipContent>}
      </Tooltip>
      {isOpen && (
        <div
          id="nexus-notification-panel"
          role="dialog"
          aria-label="Notifications"
          className={`absolute z-50 w-[360px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-card shadow-[0_24px_64px_-28px_rgba(0,0,0,0.92)] ${placement === "topbar" ? "right-0 top-full mt-2" : "left-full top-0 ml-3"}`}
          data-testid="notification-panel"
        >
          <div className="border-b border-border/70 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="text-sm font-semibold">Notifications</span>{unreadCount > 0 && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{unreadCount} unread</span>}</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{attentionCount > 0 ? `${attentionCount} operational ${attentionCount === 1 ? "item needs" : "items need"} attention` : "No urgent updates"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {unreadCount > 0 && <button onClick={markAllRead} className="rounded-md px-2 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"><CheckCheck className="mr-1 inline h-3 w-3" />Read all</button>}
                <button type="button" onClick={() => setIsOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label="Close notifications"><X className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-lg bg-muted/45 p-1" role="tablist" aria-label="Notification views">
              <button role="tab" aria-selected={panelView === "attention"} onClick={() => setPanelView("attention")} className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${panelView === "attention" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><AlertTriangle className="h-3 w-3" />Attention {attentionCount > 0 && <span className="rounded-full bg-rose-500/15 px-1.5 text-[9px] text-rose-400">{attentionCount}</span>}</button>
              <button role="tab" aria-selected={panelView === "all"} onClick={() => setPanelView("all")} className={`flex items-center justify-center rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${panelView === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>All updates <span className="ml-1 text-[9px] text-muted-foreground">{notifications.length}</span></button>
            </div>
          </div>
          <div className="max-h-[340px] overflow-y-auto p-1.5" role="tabpanel">
            {visibleNotifications.length === 0 ? (
              <div className="px-4 py-9 text-center"><Bell className="mx-auto h-6 w-6 text-muted-foreground/40" /><p className="mt-2 text-sm font-medium">You’re caught up</p><p className="mt-1 text-[11px] text-muted-foreground">No notifications in this view.</p></div>
            ) : visibleNotifications.map(n => {
              const visual = notificationTypeVisuals[n.type] || { icon: Bell, label: "System", tone: "info" };
              const NotificationIcon = visual.icon;
              const tone = n.severity === "critical" ? "critical" : n.severity === "warning" ? "warning" : visual.tone;
              const link = getNotificationLink(n);
              return (
              <button key={n.id} type="button" onClick={() => handleNotificationClick(n)}
                className={`group block w-full rounded-lg border border-transparent px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${!n.read ? 'bg-primary/[0.035]' : ''} ${n.severity === "critical" ? "hover:border-rose-500/25 hover:bg-rose-500/[0.035]" : n.severity === "warning" ? "hover:border-amber-500/25 hover:bg-amber-500/[0.035]" : "hover:border-border hover:bg-muted/45"}`}>
                <div className="flex w-full min-w-0 items-start gap-2.5">
                  <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${notificationToneClasses[tone] || notificationToneClasses.info}`}><NotificationIcon className="h-3.5 w-3.5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      <p className="truncate text-xs font-semibold">{n.title || n.message}</p>
                    </div>
                    {n.title && n.message && <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{n.message}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground"><span>{visual.label}</span>{n.occurrence_count > 1 && <><span aria-hidden="true">·</span><span>{n.occurrence_count} combined</span></>}<span aria-hidden="true">·</span><time dateTime={n.created_at || undefined} title={n.created_at ? new Date(n.created_at).toLocaleString() : undefined}>{notificationTime(n.created_at)}</time>{link && <><span aria-hidden="true">·</span><span className="text-primary/80">Open item</span></>}</p>
                  </div>
                </div>
              </button>
            );})}
          </div>
          <button onClick={() => { setIsOpen(false); navigate('/notifications'); }}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border/70 px-4 py-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50" data-testid="view-all-notifications">
            Open notification centre <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

// Navigation stays URL-driven. This avoids stale highlighting when a workspace
// changes tabs or views without changing its pathname.
const NavItem = ({
  item,
  collapsed,
  expandedMenus,
  toggleMenu,
  counts = {},
  onNavigate,
  isPinned = false,
  onTogglePin,
  showPinControl = false,
}) => {
  const location = useLocation();
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const hasChildren = Boolean(item.children?.length);
  const isExpanded = expandedMenus.has(item.path);
  const navigationState = getNavigationItemState(item, location);
  const { activeChild, isCurrentPage, isHighlighted } = navigationState;
  const submenuId = `submenu-${item.path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  // Aggregate badge count: own + any child paths.
  const ownCount = counts[item.path] || 0;
  const childrenCount = hasChildren ? item.children.reduce((sum, child) => sum + (counts[child.path] || 0), 0) : 0;
  const badgeCount = ownCount + childrenCount;

  const closeAfterNavigate = () => {
    setFlyoutOpen(false);
    onNavigate?.();
  };

  const icon = (
    item.icon && (
      <span className={`relative flex-shrink-0 nexus-sidebar-workspace-icon ${isHighlighted ? "is-active" : ""} ${badgeCount > 0 ? "has-attention" : ""}`}>
        <item.icon className={collapsed ? "h-[18px] w-[18px]" : "h-4 w-4"} />
        {collapsed && badgeCount > 0 && <NavBadge count={badgeCount} className="absolute -right-1.5 -top-1.5" />}
      </span>
    )
  );

  const baseClassName = collapsed
    ? `flex w-full items-center justify-center rounded-lg p-2.5 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isHighlighted ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`
    : `flex min-w-0 flex-1 items-center gap-2.5 px-3 py-1.5 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isHighlighted ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;

  const pinControl = !collapsed && showPinControl && onTogglePin ? (
    <button
      type="button"
      onClick={() => onTogglePin(item.path)}
      className={`self-stretch px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        isPinned ? "opacity-100 text-primary" : "opacity-0 group-hover:opacity-100"
      }`}
      aria-label={`${isPinned ? "Unpin" : "Pin"} ${item.label}`}
      aria-pressed={isPinned}
      data-testid={`nav-pin-${item.path.replace(/\//g, "-").replace(/^-/, "")}`}
    >
      <Pin className="h-3.5 w-3.5" fill={isPinned ? "currentColor" : "none"} />
    </button>
  ) : null;

  // A collapsed parent is a real popover rather than an interactive tooltip.
  // It is available by click, Enter and Space, and retains a direct link to
  // the workspace root alongside its children.
  if (collapsed && hasChildren) {
    return (
      <Popover open={flyoutOpen} onOpenChange={setFlyoutOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={baseClassName}
                aria-label={`${item.label} navigation`}
                aria-controls={submenuId}
                aria-expanded={flyoutOpen}
                data-testid={`nav-${item.path.replace(/\//g, "-").replace(/^-/, "")}`}
              >
                {icon}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
        <PopoverContent id={submenuId} side="right" align="start" className="w-64 p-2" aria-label={`${item.label} navigation`}>
          <div className="border-b border-border/70 px-2.5 pb-2 pt-1">
            <p className="text-xs font-semibold">{item.label}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Choose a workspace view</p>
          </div>
          <div className="mt-1 space-y-0.5">
            <Link
              to={item.path}
              onClick={closeAfterNavigate}
              aria-current={isCurrentPage ? "page" : undefined}
              className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                isCurrentPage ? "bg-primary/10 text-primary" : "hover:bg-muted"
              }`}
            >
              {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
              Open {item.label}
            </Link>
            {item.children.map((child) => {
              const childActive = activeChild?.path === child.path;
              return (
                <Link
                  key={child.path}
                  to={child.path}
                  onClick={closeAfterNavigate}
                  aria-current={childActive ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                    childActive ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span className="flex-1 truncate">{child.label}</span>
                  {(counts[child.path] || 0) > 0 && <NavBadge count={counts[child.path]} />}
                </Link>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  const rootLink = (
    <Link
      to={item.path}
      onClick={onNavigate}
      aria-current={isCurrentPage ? "page" : undefined}
      className={`${baseClassName} ${!collapsed && (hasChildren || pinControl) ? "rounded-l-lg" : "rounded-lg"}`}
      data-testid={`nav-${item.path.replace(/\//g, "-").replace(/^-/, "")}`}
    >
      {icon}
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left text-[12px]">{item.label}</span>
          {!isExpanded && badgeCount > 0 && <NavBadge count={badgeCount} />}
        </>
      )}
    </Link>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <div className="group flex items-center">
            {rootLink}
            {pinControl}
            {hasChildren && !collapsed && (
              <button
                type="button"
                onClick={() => toggleMenu(item.path)}
                className={`self-stretch rounded-r-lg px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  isHighlighted ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                aria-label={`Toggle ${item.label} submenu`}
                aria-controls={submenuId}
                aria-expanded={isExpanded}
                data-testid={`nav-toggle-${item.path.replace(/\//g, "-").replace(/^-/, "")}`}
              >
                <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>
          {!collapsed && hasChildren && isExpanded && (
            <div id={submenuId} className="ml-4 mt-0.5 space-y-0.5 border-l border-border/40 pl-2">
              {item.children.map((child) => {
                const childActive = activeChild?.path === child.path;
                const childCount = counts[child.path] || 0;
                return (
                  <Link
                    key={child.path}
                    to={child.path}
                    onClick={onNavigate}
                    aria-current={childActive ? "page" : undefined}
                    className={`flex items-center gap-2 rounded px-2.5 py-1 text-[11px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                      childActive ? "bg-primary/5 font-medium text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                    data-testid={`nav-child-${child.path.replace(/\//g, "-").replace(/^-/, "")}`}
                  >
                    <span className="flex-1 truncate">{child.label}</span>
                    {childCount > 0 && <NavBadge count={childCount} />}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </TooltipTrigger>
      {collapsed && <TooltipContent side="right">{item.label}</TooltipContent>}
    </Tooltip>
  );
};

// Sidebar Search Component
//
// This is deliberately a lightweight entry point into the same server-side
// operational search that powers Nexus Command.  Workspace filtering remains
// instant and local; record lookup stays behind the API so the browser never
// has to download or correlate unrestricted business data.
function SidebarSearch({ onNavigate, token }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [recordSearch, setRecordSearch] = useState({});
  const [searchingRecords, setSearchingRecords] = useState(false);
  const navigate = useNavigate();
  const searchTimerRef = useRef(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const allItems = getAllNavItems();
  const normalisedQuery = query.trim().toLowerCase();
  const taskMatches = normalisedQuery
    ? taskShortcuts.filter(item => [item.label, item.description, ...item.keywords].join(" ").toLowerCase().includes(normalisedQuery))
    : [];
  const moduleMatches = normalisedQuery
    ? allItems.filter(item =>
        item.label.toLowerCase().includes(normalisedQuery) ||
        item.group.toLowerCase().includes(normalisedQuery) ||
        item.path.toLowerCase().includes(normalisedQuery) ||
        (item.parentLabel || "").toLowerCase().includes(normalisedQuery)
      )
    : [];
  const filtered = [...taskMatches.map(item => ({ ...item, group: "Suggested task", isTask: true })), ...moduleMatches]
    .filter((item, index, items) => items.findIndex(candidate => candidate.path === item.path) === index)
    .slice(0, 8);

  useEffect(() => {
    const value = query.trim();
    clearTimeout(searchTimerRef.current);
    if (!token || value.length < 2) {
      setRecordSearch({});
      setSearchingRecords(false);
      return undefined;
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearchingRecords(true);
      try {
        const response = await axios.get(`${API}/command-palette/search`, { headers, params: { q: value } });
        setRecordSearch(response.data || {});
      } catch {
        setRecordSearch({});
      } finally {
        setSearchingRecords(false);
      }
    }, 180);
    return () => clearTimeout(searchTimerRef.current);
  }, [headers, query, token]);

  const recordSections = useMemo(() => [
    {
      heading: "Tickets",
      items: (recordSearch.tickets || []).slice(0, 2).map(item => ({
        kind: "ticket", id: item.id, label: `${item.ticket_number || "Ticket"} · ${item.title || "Untitled"}`,
        hint: [item.client_name, item.priority].filter(Boolean).join(" · "),
      })),
    },
    {
      heading: "Clients & contacts",
      items: [
        ...(recordSearch.clients || []).slice(0, 2).map(item => ({
          kind: "client", id: item.id, label: item.name || "Client", hint: item.phone || item.email || item.contract_status || "Client",
        })),
        ...(recordSearch.contacts || []).slice(0, 2).map(item => ({
          kind: "contact", id: item.id, clientId: item.client_id, label: item.name || "Client contact",
          hint: [item.client_name, item.phone || item.email || item.role].filter(Boolean).join(" · "),
        })),
      ],
    },
    {
      heading: "Products & assets",
      items: [
        ...(recordSearch.products || []).slice(0, 2).map(item => ({
          kind: "product", id: item.id, label: item.name || "Product", hint: [item.sku || item.barcode, item.vendor || item.category].filter(Boolean).join(" · "),
        })),
        ...(recordSearch.devices || []).slice(0, 2).map(item => ({
          kind: "device", id: item.id, label: item.hostname || item.name || "Managed asset", hint: [item.client_name, item.device_type].filter(Boolean).join(" · "),
        })),
      ],
    },
    {
      heading: "Commercial records",
      items: [
        ...(recordSearch.invoices || []).slice(0, 1).map(item => ({
          kind: "invoice", id: item.id, label: item.invoice_name || item.invoice_number || "Invoice", hint: item.client_name || item.status || "Invoice",
        })),
        ...(recordSearch.purchase_orders || []).slice(0, 1).map(item => ({
          kind: "purchase_order", id: item.id, label: item.po_number || "Purchase order", hint: item.vendor || item.client_name || item.status || "Purchase order",
        })),
        ...(recordSearch.projects || []).slice(0, 1).map(item => ({
          kind: "project", id: item.id, label: item.name || item.project_number || "Project", hint: item.client_name || item.status || "Project",
        })),
        ...(recordSearch.contracts || []).slice(0, 1).map(item => ({
          kind: "contract", id: item.id, label: item.name || item.contract_number || "Contract", hint: item.client_name || item.status || "Contract",
        })),
      ],
    },
    {
      heading: "Service operations",
      items: [
        ...(recordSearch.pbxs || []).slice(0, 1).map(item => ({
          kind: "pbx", id: item.id, label: item.pbx_name || item.name || "PBX", hint: [item.client_name, item.status || "Voice"].filter(Boolean).join(" · "),
        })),
        ...(recordSearch.backups || []).slice(0, 1).map(item => ({
          kind: "backup", id: item.id, label: item.name || "Backup job", hint: [item.client_name, item.provider || item.status || "Backup"].filter(Boolean).join(" · "),
        })),
        ...(recordSearch.csat_surveys || []).slice(0, 1).map(item => ({
          kind: "csat_survey", id: item.id, label: `${item.ticket_number || "Ticket feedback"} · ${item.client_name || "Customer"}`,
          hint: [item.score ? `${item.score}/5` : item.status || "Sent", item.tech_name].filter(Boolean).join(" · "),
        })),
      ],
    },
    {
      heading: "Collaboration & growth",
      items: [
        ...(recordSearch.conversations || []).slice(0, 1).map(item => ({
          kind: "conversation", id: item.id, label: item.display_name || item.name || "Conversation",
          hint: item.description || (item.is_private ? "Private conversation" : "Team channel"),
        })),
        ...(recordSearch.leads || []).slice(0, 1).map(item => ({
          kind: "lead", id: item.id, label: item.company_name || item.contact_name || "Lead",
          hint: [item.contact_name, item.phone || item.email || item.status || "Lead"].filter(Boolean).join(" · "),
        })),
      ],
    },
  ].filter(section => section.items.length), [recordSearch]);

  const firstRecord = recordSections[0]?.items[0];

  const openEverythingSearch = () => {
    setFocused(false);
    setQuery("");
    window.dispatchEvent(new CustomEvent("nexus:open-command-palette"));
  };

  const navigateToResult = (path) => {
    navigate(path);
    setQuery("");
    onNavigate?.();
  };

  const navigateToRecord = (record) => {
    if (!record) return;
    const routes = {
      ticket: `/tickets?ticket=${encodeURIComponent(record.id)}`,
      client: `/clients?client=${encodeURIComponent(record.id)}`,
      contact: `/clients?client=${encodeURIComponent(record.clientId || record.id)}`,
      product: `/products?product=${encodeURIComponent(record.id)}`,
      device: `/devices/${encodeURIComponent(record.id)}`,
      invoice: `/invoices?invoice=${encodeURIComponent(record.id)}`,
      purchase_order: `/purchase-orders?po=${encodeURIComponent(record.id)}`,
      project: `/projects?project=${encodeURIComponent(record.id)}`,
      contract: `/contracts?contract=${encodeURIComponent(record.id)}`,
      lead: `/leads?lead=${encodeURIComponent(record.id)}`,
      conversation: `/team-chat?channel=${encodeURIComponent(record.id)}`,
      pbx: `/voice?tab=pbxs&pbxId=${encodeURIComponent(record.id)}`,
      backup: `/backup-center?job=${encodeURIComponent(record.id)}`,
      csat_survey: `/csat-surveys?survey=${encodeURIComponent(record.id)}`,
    };
    if (routes[record.kind]) navigateToResult(routes[record.kind]);
  };

  return (
    <div className="px-3 py-1 relative">
      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all ${focused ? "bg-muted ring-1 ring-primary/30" : "bg-muted/50"}`}>
        <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
              event.preventDefault();
              openEverythingSearch();
            } else if (event.key === "Enter" && firstRecord) {
              event.preventDefault();
              navigateToRecord(firstRecord);
            }
          }}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder="Search Nexus — records, people, workspaces"
          className="bg-transparent text-[12px] w-full outline-none placeholder:text-muted-foreground/50"
          data-testid="sidebar-search-input"
        />
        {query ? (
          <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
        ) : (
          <button type="button" onMouseDown={openEverythingSearch} className="hidden rounded px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground/70 transition hover:bg-background hover:text-primary sm:inline" title="Search all Nexus (Ctrl + K)" data-testid="sidebar-open-command">
            All <span className="ml-1 text-[8px] uppercase tracking-wider">Ctrl K</span>
          </button>
        )}
      </div>
      {focused && (
        <div className="absolute left-3 right-3 top-full z-50 mt-1 max-h-[min(32rem,calc(100vh-7rem))] overflow-y-auto rounded-lg border bg-card shadow-xl" data-testid="sidebar-search-results">
          {searchingRecords && <p className="px-3 py-2 text-[10px] font-medium text-primary/80">Searching operational records…</p>}
          {recordSections.map((section) => (
            <div key={section.heading} className="border-b border-border/30 last:border-0">
              <p className="px-3 pt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{section.heading}</p>
              {section.items.map((item) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  type="button"
                  onMouseDown={() => navigateToRecord(item)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/70"
                  data-testid={`sidebar-record-${item.kind}-${item.id}`}
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                  <div className="min-w-0"><p className="truncate text-[12px] font-medium">{item.label}</p><p className="truncate text-[10px] text-muted-foreground/60">{item.hint}</p></div>
                </button>
              ))}
            </div>
          ))}
          {filtered.length > 0 && (
            <div className="border-b border-border/30 last:border-0">
              <p className="px-3 pt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workspaces & guided actions</p>
              {filtered.map((item, i) => (
                <button
                  key={`${item.path}-${i}`}
                  onMouseDown={() => navigateToResult(item.path)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/70"
                  data-testid={`search-result-${i}`}
                >
                  {item.icon && <item.icon className="h-3.5 w-3.5 shrink-0 text-primary/70" />}
                  <div className="min-w-0"><p className="truncate text-[12px] font-medium">{item.label}</p><p className="truncate text-[10px] text-muted-foreground/60">{item.isTask ? item.description : `${item.parentLabel ? `${item.parentLabel} > ` : ""}${item.group}`}</p></div>
                </button>
              ))}
            </div>
          )}
          {!recordSections.length && !filtered.length && !searchingRecords ? (
            <div className="p-3"><p className="text-[11px] font-medium">No matching workspace or record yet</p><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Try a ticket reference, client, phone fragment, product SKU, voice service, backup, lead or feedback record.</p></div>
          ) : null}
          <button type="button" onMouseDown={openEverythingSearch} className="flex w-full items-center justify-between bg-primary/5 px-3 py-2.5 text-left text-[11px] font-medium text-primary transition-colors hover:bg-primary/10" data-testid="sidebar-open-command-full">
            Open full Nexus Command <span className="text-[9px] text-primary/70">Ctrl K</span>
          </button>
        </div>
      )}
    </div>
  );
}

export const Sidebar = ({
  collapsed,
  mobileOpen = false,
  onMobileClose,
  onToggle,
  onCollapsedPreferenceRestore,
}) => {
  const { user, token } = useAuth();
  const { counts: navCounts } = useNavCounts();
  const location = useLocation();
  const { pathname, search } = location;
  const [expandedMenus, setExpandedMenus] = useState(new Set());
  const [expandedGroupIds, setExpandedGroupIds] = useState(new Set());
  const [pinnedPaths, setPinnedPaths] = useState([]);
  const [sidebarBrand, setSidebarBrand] = useState(null);
  const skipNextPreferencesPersist = useRef(null);

  // Sidebar preferences contain only presentation choices. They are scoped to
  // the signed-in user and validated against current navigation paths before
  // being restored, so a stale browser value cannot create an invalid route.
  const preferenceUserId = user?.id || user?.email || "anonymous";
  const navigationItems = useMemo(() => navGroups.flatMap((group) => group.items), []);
  const navigationPaths = useMemo(() => navigationItems.map((item) => item.path), [navigationItems]);

  // Get user's enabled modules (default: all enabled)
  const enabledModules = useMemo(
    () => user?.enabled_modules || navGroups.map((group) => group.id),
    [user?.enabled_modules],
  );
  // Help remains available during module migrations so technicians always have
  // access to documentation, even for accounts saved before this group existed.
  const visibleGroups = useMemo(
    () => navGroups.filter((group) => enabledModules.includes(group.id) || group.id === "help"),
    [enabledModules],
  );
  const visibleNavigationItems = useMemo(
    () => visibleGroups.flatMap((group) => group.items),
    [visibleGroups],
  );
  const visibleGroupIds = useMemo(() => visibleGroups.map((group) => group.id), [visibleGroups]);
  const pinnedItems = useMemo(
    () => pinnedPaths.map((path) => visibleNavigationItems.find((item) => item.path === path)).filter(Boolean),
    [pinnedPaths, visibleNavigationItems],
  );

  useEffect(() => {
    const preferences = readSidebarPreferences(preferenceUserId, navigationPaths, visibleGroupIds);
    // Prevent the default render from replacing existing preferences before
    // their state update is applied.
    skipNextPreferencesPersist.current = preferenceUserId;
    setExpandedMenus(new Set(preferences.expandedPaths));
    setExpandedGroupIds(new Set(preferences.expandedGroupIds.length
      ? preferences.expandedGroupIds
      : [getActiveNavigationGroupId(visibleGroups, location) || visibleGroupIds[0]].filter(Boolean)));
    setPinnedPaths(preferences.pinnedPaths);
    onCollapsedPreferenceRestore?.(preferences.collapsed);
  }, [location, navigationPaths, onCollapsedPreferenceRestore, preferenceUserId, visibleGroupIds, visibleGroups]);

  useEffect(() => {
    if (skipNextPreferencesPersist.current === preferenceUserId) {
      skipNextPreferencesPersist.current = null;
      return;
    }
    writeSidebarPreferences(preferenceUserId, {
      collapsed,
      expandedPaths: [...expandedMenus],
      expandedGroupIds: [...expandedGroupIds],
      pinnedPaths,
    }, navigationPaths, visibleGroupIds);
  }, [collapsed, expandedGroupIds, expandedMenus, navigationPaths, pinnedPaths, preferenceUserId, visibleGroupIds]);

  useEffect(() => {
    axios.get(`${API}/settings/branding/public`).then(r => {
      if (r.data?.company_name) setSidebarBrand(r.data);
      document.title = r.data?.company_name || "NexusMSP";
      const iconHref = r.data?.favicon_url || r.data?.company_icon_url || "/brand/nexus-mark.png";
      let favicon = document.querySelector("link[rel='icon']");
      if (!favicon) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        document.head.appendChild(favicon);
      }
      favicon.href = iconHref;
    }).catch(() => {});
  }, []);

  const toggleMenu = (path) => {
    setExpandedMenus(prev => {
      // One open workspace at a time keeps the long Nexus navigation scannable.
      return prev.has(path) ? new Set() : new Set([path]);
    });
  };

  const toggleGroup = (groupId) => {
    setExpandedGroupIds((previous) => previous.has(groupId) ? new Set() : new Set([groupId]));
  };

  const togglePinnedPath = (path) => {
    setPinnedPaths((previous) => togglePinnedWorkspace(previous, path, navigationPaths));
  };

  const handleNavigation = useCallback(() => {
    onMobileClose?.();
  }, [onMobileClose]);

  // Auto-expand the parent that owns the active URL. Query changes are
  // included, so switching a workspace tab does not leave the wrong submenu
  // open or highlighted.
  useEffect(() => {
    const activeGroupId = getActiveNavigationGroupId(visibleGroups, { pathname, search });
    if (!activeGroupId) return;
    setExpandedGroupIds((previous) => previous.has(activeGroupId) ? previous : new Set([activeGroupId]));
  }, [pathname, search, visibleGroups]);

  useEffect(() => {
    // Record workspaces use the full canvas for the object being worked on.
    // Keep the owning submenu collapsed on entry (matching the Device Cockpit
    // layout), while still allowing a technician to expand it manually.
    if (/^\/devices\/[^/]+$/.test(pathname)) {
      setExpandedMenus((previous) => (previous.size === 0 ? previous : new Set()));
      return;
    }
    const activeParentPath = getActiveParentNavigationPath(visibleGroups, { pathname, search });
    if (!activeParentPath) return;
    setExpandedMenus((previous) => (
      previous.size === 1 && previous.has(activeParentPath)
        ? previous
        : new Set([activeParentPath])
    ));
  }, [pathname, search, visibleGroups]);

  return (
    <TooltipProvider delayDuration={0}>
      <aside 
        className={`fixed left-0 top-0 z-40 flex h-dvh w-[min(86vw,320px)] flex-col border-r border-border bg-card transition-all duration-300 md:translate-x-0 ${
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        } ${
          collapsed ? 'md:w-[64px]' : 'md:w-[240px]'
        }`}
        style={{ backgroundColor: "var(--theme-sidebar, hsl(var(--card)))" }}
        data-testid="sidebar"
      >
        {/* Logo */}
        <div className={`h-14 flex items-center border-b border-border px-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background/40 p-0.5 shadow-sm">
                <img src={sidebarBrand?.company_icon_url || "/brand/nexus-mark.png"} alt="" className="h-full w-full object-contain" />
              </span>
              <span className="font-bold text-lg tracking-tight">{sidebarBrand?.company_name || "NexusMSP"}</span>
            </div>
          )}
          {collapsed && (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background/40 p-0.5 shadow-sm">
              <img src={sidebarBrand?.company_icon_url || "/brand/nexus-mark.png"} alt={sidebarBrand?.company_name ? `${sidebarBrand.company_name} icon` : "NexusMSP icon"} className="h-full w-full object-contain" />
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className={`hidden h-8 w-8 md:inline-flex ${collapsed ? 'md:hidden' : ''}`}
            data-testid="sidebar-toggle"
            aria-label="Collapse navigation"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onMobileClose}
            className="h-9 w-9 md:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-3 pb-1">
          <NexusGlobalPulse counts={navCounts} collapsed={collapsed} />
        </div>

        {/* Global Module Search */}
        {!collapsed ? (
          <SidebarSearch token={token} onNavigate={handleNavigation} />
        ) : (
          <div className="px-3 py-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => { window.dispatchEvent(new CustomEvent("nexus:open-command-palette")); handleNavigation(); }} className="flex items-center justify-center w-full px-3 py-2 rounded-lg text-muted-foreground hover:bg-muted transition-all" data-testid="sidebar-search-collapsed" aria-label="Open Nexus Command">
                  <Search className="w-[18px] h-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Nexus Command · Ctrl + K</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <nav className="px-2 py-2">
            {!collapsed && pinnedItems.length > 0 && (
              <section className="mb-4" aria-label="Pinned workspaces">
                <div className="mb-1.5 flex items-center gap-1.5 px-3">
                  <Pin className="h-3 w-3 text-primary/70" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-primary/70">Pinned</span>
                </div>
                <div className="space-y-0.5">
                  {pinnedItems.map((item) => {
                    const itemState = getNavigationItemState(item, location);
                    return (
                      <div key={`pinned-${item.path}`} className="group flex items-center">
                        <Link
                          to={item.path}
                          onClick={handleNavigation}
                          aria-current={itemState.isCurrentPage ? "page" : undefined}
                          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-l-lg px-3 py-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                            itemState.isHighlighted ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
                          <span className="flex-1 truncate">{item.label}</span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => togglePinnedPath(item.path)}
                          className="self-stretch rounded-r-lg px-2 text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                          aria-label={`Unpin ${item.label}`}
                          data-testid={`pinned-remove-${item.path.replace(/\//g, "-").replace(/^-/, "")}`}
                        >
                          <Pin className="h-3.5 w-3.5" fill="currentColor" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            {visibleGroups.map((group, groupIndex) => {
              const groupExpanded = collapsed || expandedGroupIds.has(group.id);
              const groupAttentionCount = group.items.reduce((total, item) => (
                total + Number(navCounts[item.path] || 0) + (item.children || []).reduce((childTotal, child) => childTotal + Number(navCounts[child.path] || 0), 0)
              ), 0);
              const groupRegionId = `sidebar-group-${group.id}`;
              return <div key={group.id} className={groupIndex > 0 || (!collapsed && pinnedItems.length > 0) ? 'mt-1.5' : ''}>
                {!collapsed && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${groupExpanded ? "bg-primary/[0.045] text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
                    aria-expanded={groupExpanded}
                    aria-controls={groupRegionId}
                    data-testid={`sidebar-group-toggle-${group.id}`}
                  >
                    <span className={`h-1 w-1 rounded-full ${groupExpanded ? "bg-primary" : "bg-muted-foreground/40"}`} aria-hidden="true" />
                    <span className="flex-1">{group.title}</span>
                    {groupAttentionCount > 0 && <NavBadge count={groupAttentionCount} />}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${groupExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                )}
                {collapsed && groupIndex > 0 && (
                  <div className="mx-3 mb-2 border-t border-border/50" />
                )}
                <div id={groupRegionId} className={`${groupExpanded ? "space-y-0.5" : "hidden"}`}>
                  {group.items.map((item) => (
                    <NavItem
                      key={item.path}
                      item={item}
                      collapsed={collapsed}
                      expandedMenus={expandedMenus}
                      toggleMenu={toggleMenu}
                      counts={navCounts}
                      onNavigate={handleNavigation}
                      isPinned={pinnedPaths.includes(item.path)}
                      onTogglePin={togglePinnedPath}
                      showPinControl
                    />
                  ))}
                </div>
              </div>;
            })}
          </nav>
        </ScrollArea>

        {/* Expand button when collapsed */}
        {collapsed && (
          <div className="px-2 pb-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              className="h-9 w-full"
              data-testid="sidebar-expand"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

      </aside>
    </TooltipProvider>
  );
};
