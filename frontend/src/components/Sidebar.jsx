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
  CalendarClock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";

// Grouped navigation for better organization
const navGroups = [
  {
    title: "Main",
    items: [
      { path: "/", icon: LayoutDashboard, label: "Dashboard" },
      { path: "/tickets", icon: Ticket, label: "Tickets" },
    ]
  },
  {
    title: "Infrastructure",
    items: [
      { path: "/devices", icon: Monitor, label: "Devices" },
      { path: "/assets", icon: Package, label: "Assets" },
      { path: "/scripting", icon: Terminal, label: "Scripting" },
      { path: "/remote-access", icon: Laptop, label: "Remote Access" },
    ]
  },
  {
    title: "Business",
    items: [
      { path: "/clients", icon: Users, label: "Clients" },
      { path: "/leads", icon: UserPlus, label: "Leads & CRM" },
      { path: "/projects", icon: FolderKanban, label: "Projects" },
      { path: "/contracts", icon: FileText, label: "Contracts" },
      { path: "/invoices", icon: Receipt, label: "Invoices" },
      { path: "/time-tracking", icon: Clock, label: "Time Tracking" },
    ]
  },
  {
    title: "Communication",
    items: [
      { path: "/email", icon: Mail, label: "Email" },
      { path: "/documentation", icon: Key, label: "IT Docs" },
      { path: "/knowledge-base", icon: BookOpen, label: "Knowledge Base" },
    ]
  },
  {
    title: "Integrations",
    items: [
      { path: "/domotz", icon: Network, label: "Domotz" },
      { path: "/acronis", icon: Shield, label: "Acronis" },
      { path: "/pax8", icon: Cloud, label: "Pax8" },
    ]
  },
  {
    title: "System",
    items: [
      { path: "/reports", icon: BarChart3, label: "Reports" },
      { path: "/settings", icon: Settings, label: "Settings" },
    ]
  },
];

export const Sidebar = ({ collapsed, onToggle }) => {
  const { user, logout } = useAuth();
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

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <nav className="py-3 px-3">
            {navGroups.map((group, groupIndex) => (
              <div key={group.title} className={groupIndex > 0 ? 'mt-5' : ''}>
                {/* Group Title */}
                {!collapsed && (
                  <div className="px-3 mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-blue-400/90">
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
                                : 'text-slate-400 hover:bg-slate-700/50 hover:text-white hover:translate-x-1'
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
