import { Bot, ChevronDown, LogOut, Moon, Settings, ShieldCheck, Sun } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name) {
  return String(name || "User")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function roleLabel(user) {
  if (user?.is_admin || user?.role === "admin") return "Primary administrator";
  return user?.job_title || user?.role || "Technician";
}

export default function TechnicianAccountMenu({
  user,
  theme,
  onSettings,
  onThemeToggle,
  onCopilot,
  onLogout,
}) {
  const displayRole = roleLabel(user);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-10 max-w-[230px] gap-2 rounded-xl border border-transparent px-2 text-left hover:border-border/70 hover:bg-muted/70 data-[state=open]:border-primary/25 data-[state=open]:bg-primary/[0.07]"
          data-testid="technician-account-menu"
          aria-label={`Open account menu for ${user?.name || "technician"}`}
        >
          <Avatar className="h-8 w-8 border border-primary/20 shadow-sm">
            <AvatarImage src={user?.avatar} alt="" className="object-cover" />
            <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
              {initials(user?.name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 flex-1 lg:block">
            <span className="block truncate text-xs font-semibold text-foreground">{user?.name || "Technician"}</span>
            <span className="block truncate text-[10px] capitalize text-muted-foreground">{displayRole}</span>
          </span>
          <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground lg:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64 rounded-xl border-border/80 p-1.5 shadow-2xl" data-testid="technician-account-menu-content">
        <DropdownMenuLabel className="px-2.5 py-2 font-normal">
          <span className="flex items-center gap-2.5">
            <Avatar className="h-9 w-9 border border-primary/20">
              <AvatarImage src={user?.avatar} alt="" className="object-cover" />
              <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">{initials(user?.name)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">{user?.name || "Technician"}</span>
              <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] capitalize text-muted-foreground">
                <ShieldCheck className="h-3 w-3 text-emerald-400" />{displayRole}
              </span>
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSettings} className="rounded-lg px-2.5 py-2" data-testid="user-settings-link">
          <Settings className="text-muted-foreground" />
          My settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopilot} className="rounded-lg px-2.5 py-2" data-testid="copilot-toggle">
          <Bot className="text-primary" />
          AI Copilot
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onThemeToggle} className="rounded-lg px-2.5 py-2" data-testid="theme-toggle">
          {theme === "dark" ? <Sun className="text-amber-400" /> : <Moon className="text-sky-500" />}
          {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout} className="rounded-lg px-2.5 py-2 text-destructive focus:bg-destructive/10 focus:text-destructive" data-testid="logout-button">
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
