import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth, useTheme } from "@/App";
import { ChevronLeft, ChevronRight, ChevronDown, Bell, Bot, LogOut, Sun, Moon, Search, X, AlertTriangle, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import axios from "axios";
import { API } from "@/App";
import { navGroups, getAllNavItems, taskShortcuts } from "@/config/navigation";
import { useNavCounts, NavBadge } from "@/hooks/useNavCounts";

// Notification Bell Component
function NotificationBell({ token, collapsed }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [panelView, setPanelView] = useState("attention");
  const ref = useRef(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const getNotificationLink = (n) => {
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
    <div className={`relative px-3 py-1.5 ${collapsed ? 'flex justify-center' : ''}`} ref={ref}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={`relative flex items-center gap-2 rounded-lg transition-all duration-150 hover:bg-muted ${
              collapsed ? 'p-2 justify-center' : 'w-full px-3 py-2'
            }`}
            data-testid="notification-bell"
          >
            <Bell className="w-[18px] h-[18px] text-muted-foreground" />
            {!collapsed && <span className="text-[12px] text-muted-foreground">Notifications</span>}
            {unreadCount > 0 && (
              <span className="absolute top-1 left-5 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white font-bold flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>
        </TooltipTrigger>
        {collapsed && <TooltipContent side="right">Notifications {unreadCount > 0 ? `(${unreadCount})` : ''}</TooltipContent>}
      </Tooltip>
      {isOpen && (
        <div className="absolute left-full top-0 z-50 ml-3 w-[380px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-violet-500/20 bg-card shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)]" data-testid="notification-panel">
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
  );
}

// NavItem with optional collapsible children
const NavItem = ({ item, collapsed, expandedMenus, toggleMenu, counts = {} }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const hasChildren = item.children && item.children.length > 0;
  const isExpanded = expandedMenus.has(item.path);

  // Check if this item or any child is active
  const isActive = location.pathname === item.path;
  const isChildActive = hasChildren && item.children.some(c => location.pathname === c.path);
  const isWorkspaceActive = item.workspacePaths?.some(path => location.pathname === path || location.pathname.startsWith(`${path}/`));
  const isHighlighted = isActive || isChildActive || isWorkspaceActive;

  // Aggregate badge count: own + any child paths
  const ownCount = counts[item.path] || 0;
  const childrenCount = hasChildren ? item.children.reduce((s, c) => s + (counts[c.path] || 0), 0) : 0;
  const badgeCount = ownCount + childrenCount;

  const navigateToItem = () => navigate(item.path);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <div className="flex items-center">
          <button
            onClick={navigateToItem}
            className={`flex items-center ${hasChildren && !collapsed ? "flex-1 rounded-l-lg" : "w-full rounded-lg"} transition-all duration-150 group ${
              collapsed
                ? `p-2.5 justify-center ${isHighlighted ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`
                : `px-3 py-1.5 gap-2.5 ${isHighlighted ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`
            }`}
            aria-label={item.label}
            data-testid={`nav-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}
          >
            {item.icon && (
              <span className={`relative flex-shrink-0 nexus-sidebar-workspace-icon ${isHighlighted ? "is-active" : ""} ${badgeCount > 0 ? "has-attention" : ""}`}>
                <item.icon className={`${collapsed ? 'w-[18px] h-[18px]' : 'w-4 h-4'}`} />
                {collapsed && badgeCount > 0 && (
                  <NavBadge count={badgeCount} className="absolute -top-1.5 -right-1.5" />
                )}
              </span>
            )}
            {!collapsed && (
              <>
                <span className="text-[12px] flex-1 text-left truncate">{item.label}</span>
                {!isExpanded && badgeCount > 0 && <NavBadge count={badgeCount} />}
              </>
            )}
          </button>
          {hasChildren && !collapsed && (
            <button
              onClick={() => toggleMenu(item.path)}
              className={`self-stretch px-2 rounded-r-lg transition-colors ${isHighlighted ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              aria-label={`Toggle ${item.label} submenu`}
              aria-expanded={isExpanded}
              data-testid={`nav-toggle-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          )}
          </div>
          {/* Children */}
          {!collapsed && hasChildren && isExpanded && (
            <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border/40 pl-2">
              {item.children.map(child => {
                const childActive = location.pathname === child.path;
                const childCount = counts[child.path] || 0;
                return (
                  <Link
                    key={child.path}
                    to={child.path}
                    className={`flex items-center gap-2 px-2.5 py-1 rounded text-[11px] transition-all ${
                      childActive ? 'text-primary font-medium bg-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                    data-testid={`nav-child-${child.path.replace(/\//g, '-').replace(/^-/, '')}`}
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
      {collapsed && (
        <TooltipContent side="right" className="font-medium">
          {item.label}
          {hasChildren && (
            <div className="mt-1 pt-1 border-t border-border/50 space-y-0.5">
              {item.children.map(c => (
                <Link key={c.path} to={c.path} className="block text-xs text-muted-foreground hover:text-foreground py-0.5">{c.label}</Link>
              ))}
            </div>
          )}
        </TooltipContent>
      )}
    </Tooltip>
  );
};

// Sidebar Search Component
function SidebarSearch() {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const navigate = useNavigate();

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

  const openEverythingSearch = () => {
    setFocused(false);
    setQuery("");
    window.dispatchEvent(new CustomEvent("nexus:open-command-palette"));
  };

  return (
    <div className="px-3 py-1 relative">
      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all ${focused ? "bg-muted ring-1 ring-primary/30" : "bg-muted/50"}`}>
        <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder="What do you need to do?"
          className="bg-transparent text-[12px] w-full outline-none placeholder:text-muted-foreground/50"
          data-testid="sidebar-search-input"
        />
        {query ? (
          <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
        ) : (
          <button type="button" onMouseDown={openEverythingSearch} className="hidden rounded px-1 text-[9px] uppercase tracking-wider text-muted-foreground/60 transition hover:bg-background hover:text-primary sm:inline" title="Search everything (Ctrl + K)">Ctrl K</button>
        )}
      </div>
      {focused && (
        <div className="absolute left-3 right-3 top-full mt-1 bg-card border rounded-lg shadow-xl z-50 overflow-hidden" data-testid="sidebar-search-results">
          {filtered.length > 0 ? filtered.map((item, i) => (
            <button
              key={`${item.path}-${i}`}
              onMouseDown={() => { navigate(item.path); setQuery(""); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-muted/70 transition-colors border-b border-border/30 last:border-0"
              data-testid={`search-result-${i}`}
            >
              {item.icon && <item.icon className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" />}
              <div className="min-w-0">
                <p className="text-[12px] font-medium truncate">{item.label}</p>
                <p className="text-[10px] text-muted-foreground/60 truncate">{item.isTask ? item.description : `${item.parentLabel ? `${item.parentLabel} > ` : ''}${item.group}`}</p>
              </div>
            </button>
          )) : normalisedQuery ? (
            <div className="p-3">
              <p className="text-[11px] font-medium">No workspace matched that phrase</p>
              <button type="button" onMouseDown={openEverythingSearch} className="mt-2 flex w-full items-center justify-between rounded-md bg-primary/10 px-2.5 py-2 text-left text-[11px] font-medium text-primary hover:bg-primary/15">
                Search records, people and actions <span>Ctrl K</span>
              </button>
            </div>
          ) : (
            <div className="p-3 text-[10px] leading-relaxed text-muted-foreground">Try “remote into a device”, “invoice a client” or “investigate a threat”.</div>
          )}
        </div>
      )}
    </div>
  );
}

export const Sidebar = ({ collapsed, mobileOpen = false, onMobileClose, onToggle, onCopilotToggle }) => {
  const { user, logout, token } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { counts: navCounts } = useNavCounts();
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedMenus, setExpandedMenus] = useState(new Set());
  const [sidebarBrand, setSidebarBrand] = useState(null);

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

  // Get user's enabled modules (default: all enabled)
  const enabledModules = user?.enabled_modules || navGroups.map(g => g.id);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const toggleMenu = (path) => {
    setExpandedMenus(prev => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path); else n.add(path);
      return n;
    });
  };

  // Auto-expand the group containing the current route
  useEffect(() => {
    for (const group of navGroups) {
      for (const item of group.items) {
        if (item.children) {
          const isChildActive = item.children.some(c => location.pathname === c.path);
          if (isChildActive || location.pathname === item.path) {
            setExpandedMenus(prev => {
              const n = new Set(prev);
              n.add(item.path);
              return n;
            });
          }
        }
      }
    }
  }, [location.pathname]);

  // Filter nav groups by enabled modules
  // Help remains available during module migrations so technicians always have
  // access to documentation, even for accounts saved before this group existed.
  const visibleGroups = navGroups.filter(g => enabledModules.includes(g.id) || g.id === "help");

  return (
    <TooltipProvider delayDuration={0}>
      <aside 
        className={`fixed left-0 top-0 z-40 flex h-dvh w-[min(86vw,320px)] flex-col border-r border-border bg-card transition-all duration-300 md:translate-x-0 ${
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        } ${
          collapsed ? 'md:w-[72px]' : 'md:w-[260px]'
        }`}
        style={{ backgroundColor: "var(--theme-sidebar, hsl(var(--card)))" }}
        data-testid="sidebar"
      >
        {/* Logo */}
        <div className={`h-16 flex items-center border-b border-border px-4 ${collapsed ? 'justify-center' : 'justify-between'}`}>
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

        {/* Notification Bell */}
        <NotificationBell token={token} collapsed={collapsed} />

        {/* Global Module Search */}
        {!collapsed ? (
          <SidebarSearch />
        ) : (
          <div className="px-3 py-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={onToggle} className="flex items-center justify-center w-full px-3 py-2 rounded-lg text-muted-foreground hover:bg-muted transition-all" data-testid="sidebar-search-collapsed">
                  <Search className="w-[18px] h-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Find a task or workspace</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <nav className="py-3 px-3">
            {visibleGroups.map((group, groupIndex) => (
              <div key={group.id} className={groupIndex > 0 ? 'mt-4' : ''}>
                {!collapsed && (
                  <div className="px-3 mb-1.5">
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
                    <NavItem key={item.path} item={item} collapsed={collapsed} expandedMenus={expandedMenus} toggleMenu={toggleMenu} counts={navCounts} />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* Expand button when collapsed */}
        {collapsed && (
          <div className="px-3 pb-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              className="w-full h-10"
              data-testid="sidebar-expand"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* User Section */}
        <div className={`border-t border-border p-3 ${collapsed ? 'flex flex-col items-center gap-2' : ''}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/my-settings"
                className={`flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-all duration-150 cursor-pointer ${
                  collapsed ? 'justify-center' : ''
                }`}
                data-testid="user-settings-link"
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage src={user?.avatar} alt={user?.name} />
                  <AvatarFallback className="bg-primary/20 text-primary text-sm font-semibold">
                    {user?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user?.name}</p>
                    <p className="text-xs text-muted-foreground truncate capitalize">{user?.role}</p>
                  </div>
                )}
              </Link>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">
                <p className="font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role} - My Settings</p>
              </TooltipContent>
            )}
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={collapsed ? "icon" : "sm"}
                onClick={toggleTheme}
                className={`text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10 ${
                  collapsed ? 'w-10 h-10' : 'w-full justify-start gap-2'
                }`}
                data-testid="theme-toggle"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {!collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
              </Button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">{theme === "dark" ? "Light Mode" : "Dark Mode"}</TooltipContent>
            )}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={collapsed ? "icon" : "sm"}
                onClick={onCopilotToggle}
                className={`text-muted-foreground hover:text-primary hover:bg-primary/10 ${
                  collapsed ? 'w-10 h-10' : 'w-full justify-start gap-2'
                }`}
                data-testid="copilot-toggle"
              >
                <Bot className="h-4 w-4" />
                {!collapsed && <span>AI Copilot</span>}
              </Button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">AI Copilot</TooltipContent>
            )}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={collapsed ? "icon" : "sm"}
                onClick={handleLogout}
                className={`text-muted-foreground hover:text-destructive hover:bg-destructive/10 ${
                  collapsed ? 'w-10 h-10' : 'w-full justify-start gap-2'
                }`}
                data-testid="logout-button"
              >
                <LogOut className="h-4 w-4" />
                {!collapsed && <span>Logout</span>}
              </Button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">Logout</TooltipContent>
            )}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
};
