import {
  Activity,
  CheckCircle2,
  Cloud,
  Database,
  DollarSign,
  ExternalLink,
  Ghost,
  MoreHorizontal,
  Server,
  Settings,
  ShieldCheck,
  Shield,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PRIMARY = [
  { value: "dashboard", label: "Overview", icon: Database },
  { value: "live", label: "Live", icon: Activity },
  { value: "compliance", label: "Coverage", icon: ShieldCheck },
  { value: "verify", label: "Recovery", icon: CheckCircle2 },
  { value: "status", label: "Agents", icon: Server },
];

const TOOL_TABS = [
  { value: "tenants", label: "Tenant mapping", icon: Users },
  { value: "acronis", label: "Provider health", icon: Cloud },
  { value: "orphans", label: "Protection hygiene", icon: Ghost },
  { value: "billing", label: "Usage billing", icon: DollarSign },
  { value: "native", label: "Nexus Backup", icon: Shield },
];

export default function BackupWorkspaceNav({ activeTab, onSelect, orphanCount = 0, alertCount = 0, onOpenAcronis, onOpenSettings }) {
  const activeTool = TOOL_TABS.find((item) => item.value === activeTab);

  return (
    <nav className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/[0.55] p-1.5 shadow-sm" aria-label="Backup workspace" data-testid="backup-workspace-nav">
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center gap-1">
          {PRIMARY.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => onSelect(value)}
              aria-current={activeTab === value ? "page" : undefined}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${activeTab === value ? "bg-primary/[0.12] text-primary shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
              data-testid={`tab-${value}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={activeTool ? "info" : "outline"} size="sm" className="h-8 shrink-0 px-2.5" data-testid="backup-tools-menu" aria-label={`Open backup tools${activeTool ? `, current workspace ${activeTool.label}` : ""}`}>
            <MoreHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">{activeTool?.label || "Tools"}</span>
            {(orphanCount > 0 || alertCount > 0) && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="Backup tools need attention" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={7} className="w-64 rounded-xl p-1.5">
          <DropdownMenuLabel className="px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Operations & governance</DropdownMenuLabel>
          {TOOL_TABS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuItem key={value} onSelect={() => onSelect(value)} className="rounded-lg px-2.5 py-2" data-testid={`tab-${value}`}>
              <Icon className="text-muted-foreground" />
              {label}
              {value === "orphans" && orphanCount > 0 && <span className="ml-auto rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-rose-200">{orphanCount}</span>}
              {value === "acronis" && alertCount > 0 && <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">{alertCount}</span>}
              {activeTab === value && value !== "orphans" && value !== "acronis" && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-label="Current workspace" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Provider</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onOpenAcronis()} className="rounded-lg px-2.5 py-2" data-testid="open-acronis-console">
            <ExternalLink className="text-muted-foreground" />Open Acronis Cloud
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenSettings()} className="rounded-lg px-2.5 py-2" data-testid="open-acronis-settings">
            <Settings className="text-muted-foreground" />Integration settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
