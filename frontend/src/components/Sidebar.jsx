import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { 
  LayoutDashboard, 
  Ticket, 
  Monitor, 
  Package, 
  Users, 
  FileText,
  Receipt,
  Clock,
  BookOpen,
  Cloud,
  Network,
  Laptop,
  BarChart3, 
  Settings, 
  LogOut,
  ChevronLeft,
  ChevronRight,
  Zap,
  UserPlus,
  Shield,
  Mail,
  Terminal,
  Key,
  FolderKanban,
  Server,
  CalendarClock,
  UserCog,
  CalendarDays,
  ShoppingCart,
  Wifi,
  Trophy,
  Phone,
  Building2,
  Tags,
  ShieldCheck,
  Activity,
  CreditCard,
  Bell,
  Cpu,
  Heart,
  Wrench,
  Radar,
  Paintbrush,
  Gift,
  Volume2,
  DollarSign,
  Wallet
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API } from "@/App";

// Notification Bell Component
function NotificationBell({ token, collapsed }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);
  const headers = { Authorization: `Bearer ${token}` };

  const getNotificationLink = (n) => {
    const refType = n.ref_type;
    const refId = n.ref_id;
    if (!refType || !refId) return null;
    switch (refType) {
      case "ticket": return "/tickets";
      case "contract": return "/contracts";
      case "device": return `/devices/${refId}`;
      default: return null;
    }
  };

  const handleNotificationClick = (n) => {
    const link = getNotificationLink(n);
    if (link) {
      // Mark this notification as read
      axios.post(`${API}/notifications/mark-read`, { ids: [n.id] }, { headers }).catch(() => {});
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      setUnreadCount(prev => Math.max(0, prev - (n.read ? 0 : 1)));
      setIsOpen(false);
      navigate(link);
    }
  };

  const fetchNotifications = async () => {
    try {
      const [nRes, cRes] = await Promise.all([
        axios.get(`${API}/notifications`, { headers }),
        axios.get(`${API}/notifications/unread-count`, { headers }),
      ]);
      setNotifications(nRes.data.slice(0, 15));
      setUnreadCount(cRes.data.count);
    } catch {}
  };

  useEffect(() => {
    fetchNotifications();
    // Also generate new ones
    axios.post(`${API}/notifications/generate`, {}, { headers }).then(() => fetchNotifications()).catch(() => {});
    const iv = setInterval(fetchNotifications, 60000);
    return () => clearInterval(iv);
  }, []);

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

  const severityColor = { critical: "bg-red-500", warning: "bg-amber-500", info: "bg-blue-500" };
  const typeIcon = { sla_breach: "SLA", contract_renewal: "CTR", device_offline: "DEV", ticket_assigned: "TKT" };

  return (
    <div className="relative px-3 py-2" ref={ref}>
      <button onClick={() => setIsOpen(!isOpen)} className={`relative flex items-center gap-2 w-full px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-700/60 transition-all ${collapsed ? "justify-center" : ""}`} data-testid="notification-bell">
        <Bell className="w-[18px] h-[18px]" />
        {!collapsed && <span className="text-[13px] font-medium">Notifications</span>}
        {unreadCount > 0 && (
          <span className="absolute top-1 right-2 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">{unreadCount > 9 ? "9+" : unreadCount}</span>
        )}
      </button>
      {isOpen && (
        <div className="absolute left-full top-0 ml-2 w-80 bg-card border rounded-xl shadow-2xl z-50 overflow-hidden" data-testid="notification-dropdown">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="font-semibold text-sm">Notifications</span>
            {unreadCount > 0 && <button onClick={markAllRead} className="text-xs text-primary hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length > 0 ? notifications.map(n => (
              <div key={n.id} className={`flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer ${!n.read ? "bg-primary/5" : ""}`}
                onClick={() => handleNotificationClick(n)} data-testid={`notification-item-${n.id}`}>
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${severityColor[n.severity] || "bg-blue-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-muted-foreground bg-muted px-1 rounded">{typeIcon[n.type] || "SYS"}</span>
                    <p className="text-xs font-medium truncate">{n.title}</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{n.message}</p>
                </div>
              </div>
            )) : (
              <div className="text-center py-8 text-muted-foreground text-sm">No notifications</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Grouped navigation for better organization
const navGroups = [
  {
    title: "Main",
    items: [
      { path: "/", icon: LayoutDashboard, label: "Dashboard" },
      { path: "/tickets", icon: Ticket, label: "Tickets" },
      { path: "/technicians", icon: UserCog, label: "Technicians" },
      { path: "/leaderboard", icon: Trophy, label: "Leaderboard" },
      { path: "/scheduling", icon: CalendarDays, label: "Scheduling" },
    ]
  },
  {
    title: "Infrastructure",
    items: [
      { path: "/devices", icon: Monitor, label: "Devices" },
      { path: "/networking", icon: Wifi, label: "Networking" },
      { path: "/dmarc-compliance", icon: ShieldCheck, label: "Email Security" },
      { path: "/splynx-dashboard", icon: Activity, label: "ISP Health" },
      { path: "/assets", icon: Package, label: "Assets" },
      { path: "/asset-lifecycle", icon: Wrench, label: "Asset Lifecycle" },
      { path: "/predictive-maintenance", icon: Cpu, label: "Predictive AI" },
      { path: "/scripting", icon: Terminal, label: "Scripting" },
      { path: "/remote-access", icon: Laptop, label: "Remote Access" },
    ]
  },
  {
    title: "Business",
    items: [
      { path: "/clients", icon: Users, label: "Clients" },
      { path: "/leads", icon: UserPlus, label: "Leads & CRM" },
      { path: "/loyalty", icon: Gift, label: "Loyalty & Renewals" },
      { path: "/products", icon: Package, label: "Products" },
      { path: "/purchase-orders", icon: ShoppingCart, label: "Purchase Orders" },
      { path: "/vendors", icon: Building2, label: "Vendors" },
      { path: "/rentals", icon: Phone, label: "Phone Rentals" },
      { path: "/projects", icon: FolderKanban, label: "Projects" },
      { path: "/contracts", icon: FileText, label: "Contracts" },
      { path: "/invoices", icon: Receipt, label: "Invoices" },
      { path: "/xero", icon: CreditCard, label: "Xero Accounting" },
      { path: "/time-tracking", icon: Clock, label: "Time Tracking" },
    ]
  },
  {
    title: "Communication",
    items: [
      { path: "/email", icon: Mail, label: "Email" },
      { path: "/o365-setup", icon: Mail, label: "O365 Mailbox" },
      { path: "/documentation", icon: Key, label: "IT Docs" },
      { path: "/knowledge-base", icon: BookOpen, label: "Knowledge Base" },
    ]
  },
  {
    title: "Integrations",
    items: [
      { path: "/proxmox", icon: Server, label: "Proxmox" },
      { path: "/domotz", icon: Network, label: "Domotz" },
      { path: "/acronis", icon: Shield, label: "Acronis" },
      { path: "/pax8", icon: Cloud, label: "Pax8" },
      { path: "/gradient", icon: DollarSign, label: "Gradient MSP" },
    ]
  },
  {
    title: "System",
    items: [
      { path: "/health-radar", icon: Radar, label: "Health Radar" },
      { path: "/white-label", icon: Paintbrush, label: "White Label" },
      { path: "/expiry-tracker", icon: CalendarClock, label: "Expiry Tracker" },
      { path: "/reports", icon: BarChart3, label: "Reports" },
      { path: "/financial-reports", icon: Wallet, label: "Financial Reports" },
      { path: "/ticket-settings", icon: Tags, label: "Ticket Settings" },
      { path: "/ticket-ping-settings", icon: Volume2, label: "Ping & Escalation" },
      { path: "/settings", icon: Settings, label: "Settings" },
    ]
  },
];

export const Sidebar = ({ collapsed, onToggle }) => {
  const { user, logout, token } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside 
        className={`fixed left-0 top-0 h-screen bg-card border-r border-border flex flex-col z-40 transition-all duration-300 ${
          collapsed ? 'w-[72px]' : 'w-[260px]'
        }`}
        data-testid="sidebar"
      >
        {/* Logo */}
        <div className={`h-16 flex items-center border-b border-border px-4 ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-bold text-lg tracking-tight">NexusOps</span>
            </div>
          )}
          {collapsed && (
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground" />
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className={`h-8 w-8 ${collapsed ? 'hidden' : ''}`}
            data-testid="sidebar-toggle"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        {/* Notification Bell */}
        <NotificationBell token={token} collapsed={collapsed} />

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <nav className="py-3 px-3">
            {navGroups.map((group, groupIndex) => (
              <div key={group.title} className={groupIndex > 0 ? 'mt-5' : ''}>
                {/* Group Title */}
                {!collapsed && (
                  <div className="px-3 mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-cyan-400">
                      {group.title}
                    </span>
                  </div>
                )}
                {collapsed && groupIndex > 0 && (
                  <div className="mx-3 mb-2 border-t border-border/50" />
                )}
                
                {/* Group Items */}
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <Tooltip key={item.path}>
                      <TooltipTrigger asChild>
                        <NavLink
                          to={item.path}
                          end={item.path === "/"}
                          className={({ isActive }) =>
                            `group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                              isActive
                                ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25'
                                : 'text-slate-200 hover:bg-slate-700/60 hover:text-white hover:translate-x-1'
                            } ${collapsed ? 'justify-center' : ''}`
                          }
                          data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                          <item.icon className={`h-[18px] w-[18px] flex-shrink-0 transition-transform duration-200 group-hover:scale-110`} strokeWidth={1.75} />
                          {!collapsed && (
                            <span className="text-[13px] font-medium">{item.label}</span>
                          )}
                        </NavLink>
                      </TooltipTrigger>
                      {collapsed && (
                        <TooltipContent side="right" className="font-medium">
                          {item.label}
                        </TooltipContent>
                      )}
                    </Tooltip>
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
              <div 
                className={`flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-all duration-150 cursor-pointer ${
                  collapsed ? 'justify-center' : ''
                }`}
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
              </div>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">
                <p className="font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
              </TooltipContent>
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
