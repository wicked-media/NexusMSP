import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/App";
import { ChevronLeft, ChevronRight, ChevronDown, Bell, Search, X, AlertTriangle, CheckCheck, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import axios from "axios";
import { API } from "@/App";
import { navGroups, getAllNavItems, taskShortcuts } from "@/config/navigation";
import { useNavCounts, NavBadge } from "@/hooks/useNavCounts";
import NexusGlobalPulse from "@/components/NexusGlobalPulse";
import {
  getNavigationItemState,
  getActiveParentNavigationPath,
  readSidebarPreferences,
  togglePinnedWorkspace,
  writeSidebarPreferences,
} from "@/lib/sidebarNavigation";

// Notification Bell Component
export function NotificationBell({ token, collapsed = true, placement = "sidebar" }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [panelView, setPanelView] = useState("attention");
  const ref = useRef(null);
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
      axios.post(`${API}/notifications/mark-read`, { ids: [n.id] }, { headers }).catch(() => {});
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
      const [nRes, cRes] = await Promise.all([
        axios.get(`${API}/notifications`, { headers }),
        axios.get(`${API}/notifications/unread-count`, { headers }),
      ]);
      setNotifications(nRes.data.slice(0, 15));
      setUnreadCount(cRes.data.count);
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

  const markAllRead = async () => {
    try {
      await axios.post(`${API}/notifications/mark-read`, {}, { headers });
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  };

  const typeIcon = { sla_breach: "SLA", sla_warning: "SLA", contract_renewal: "CTR", device_offline: "DEV", ticket_assigned: "TKT", ticket_updated: "TKT", new_lead: "LEAD", supplier_invoice_follow_up: "PO", chat_mention: "CHAT", chat_broadcast: "CHAT", thread_reply: "CHAT" };
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
            onClick={() => setIsOpen(!isOpen)}
            className={`relative flex items-center gap-2 rounded-lg transition-all duration-150 hover:bg-muted ${
              placement === "topbar" ? 'h-9 w-9 justify-center' : collapsed ? 'p-2 justify-center' : 'w-full px-3 py-2'
            }`}
            data-testid="notification-bell"
          >
            <Bell className="w-[18px] h-[18px] text-muted-foreground" />
            {!collapsed && placement !== "topbar" && <span className="text-[12px] text-muted-foreground">Notifications</span>}
            {unreadCount > 0 && (
              <span className="absolute top-1 left-5 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white font-bold flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>
        </TooltipTrigger>
        {(collapsed || placement === "topbar") && <TooltipContent side={placement === "topbar" ? "bottom" : "right"}>Notifications {unreadCount > 0 ? `(${unreadCount})` : ''}</TooltipContent>}
      </Tooltip>
      {isOpen && (
        <div className={`absolute z-50 w-[380px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-violet-500/20 bg-card shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)] ${placement === "topbar" ? "right-0 top-full mt-2" : "left-full top-0 ml-3"}`} data-testid="notification-panel">
          <div className="border-b border-border bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.18),transparent_45%)] px-4 py-3">
            <div className="flex items-center justify-between">
            <div><span className="text-sm font-semibold">Notification inbox</span><p className="mt-0.5 text-[11px] text-muted-foreground">{attentionCount > 0 ? `${attentionCount} needs attention` : unreadCount > 0 ? `${unreadCount} unread updates` : "You’re up to date"}</p></div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && <button onClick={markAllRead} className="rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10"><CheckCheck className="mr-1 inline h-3 w-3" />Read all</button>}
            </div>
            </div>
            <div className="mt-3 flex items-center gap-1 rounded-lg bg-muted/50 p-1"><button onClick={() => setPanelView("attention")} className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${panelView === "attention" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><AlertTriangle className="h-3 w-3" />Attention {attentionCount > 0 && <span className="rounded-full bg-rose-500/15 px-1.5 text-[9px] text-rose-400">{attentionCount}</span>}</button><button onClick={() => setPanelView("all")} className={`flex flex-1 items-center justify-center rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${panelView === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>All updates <span className="ml-1 text-[9px] text-muted-foreground">{notifications.length}</span></button></div>
          </div>
          <div className="max-h-[390px] overflow-y-auto p-1.5">
            {visibleNotifications.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No notifications</p>
            ) : visibleNotifications.map(n => (
              <div key={n.id} onClick={() => handleNotificationClick(n)}
                className={`group rounded-xl border border-transparent px-3 py-3 cursor-pointer transition-colors ${!n.read ? 'bg-primary/[0.045]' : ''} ${n.severity === "critical" ? "hover:border-rose-500/30 hover:bg-rose-500/[0.04]" : n.severity === "warning" ? "hover:border-amber-500/30 hover:bg-amber-500/[0.04]" : "hover:border-border hover:bg-muted/60"}`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${n.severity === "critical" ? "bg-rose-500/10 text-rose-400" : n.severity === "warning" ? "bg-amber-500/10 text-amber-400" : "bg-sky-500/10 text-sky-400"}`}><span className="text-[9px] font-bold">{typeIcon[n.type] || 'SYS'}</span></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      <p className="text-xs font-semibold truncate">{n.title || n.message}</p>
                    </div>
                    {n.title && n.message && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">{n.message}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">{n.created_at ? new Date(n.created_at).toLocaleString() : ''}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => { setIsOpen(false); navigate('/notifications'); }}
            className="w-full px-4 py-3 text-xs text-primary font-medium hover:bg-primary/5 border-t transition-colors" data-testid="view-all-notifications">
            Open notification centre →
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
  const pinnedItems = useMemo(
    () => pinnedPaths.map((path) => visibleNavigationItems.find((item) => item.path === path)).filter(Boolean),
    [pinnedPaths, visibleNavigationItems],
  );

  useEffect(() => {
    const preferences = readSidebarPreferences(preferenceUserId, navigationPaths);
    // Prevent the default render from replacing existing preferences before
    // their state update is applied.
    skipNextPreferencesPersist.current = preferenceUserId;
    setExpandedMenus(new Set(preferences.expandedPaths));
    setPinnedPaths(preferences.pinnedPaths);
    onCollapsedPreferenceRestore?.(preferences.collapsed);
  }, [navigationPaths, onCollapsedPreferenceRestore, preferenceUserId]);

  useEffect(() => {
    if (skipNextPreferencesPersist.current === preferenceUserId) {
      skipNextPreferencesPersist.current = null;
      return;
    }
    writeSidebarPreferences(preferenceUserId, {
      collapsed,
      expandedPaths: [...expandedMenus],
      pinnedPaths,
    }, navigationPaths);
  }, [collapsed, expandedMenus, navigationPaths, pinnedPaths, preferenceUserId]);

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
            {visibleGroups.map((group, groupIndex) => (
              <div key={group.id} className={groupIndex > 0 || (!collapsed && pinnedItems.length > 0) ? 'mt-3' : ''}>
                {!collapsed && (
                  <div className="mb-1 px-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-primary/70">
                      {group.title}
                    </span>
                  </div>
                )}
                {collapsed && groupIndex > 0 && (
                  <div className="mx-3 mb-2 border-t border-border/50" />
                )}
                <div className="space-y-0.5">
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
              </div>
            ))}
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
