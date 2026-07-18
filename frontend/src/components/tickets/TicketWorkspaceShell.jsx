import { Link, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Activity, Bot, CheckCircle2, ChevronDown, ClipboardCheck, Clock3, FileText, Gauge,
  LayoutList, MapPinned, MessageSquare, MoreHorizontal, Paperclip,
  ShieldCheck, ShoppingCart, Sparkles, Wrench,
} from "lucide-react";
import { TICKET_MODULES, ticketModuleForPath } from "@/lib/ticketWorkspaceHelpers";

const MODULE_ICONS = {
  queue: LayoutList,
  triage: ClipboardCheck,
  sla: Gauge,
  dispatch: MapPinned,
};

export function TicketModuleHeader({ title, subtitle, eyebrow = "Service desk", actions, children }) {
  const location = useLocation();
  const active = ticketModuleForPath(location.pathname);
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111318] shadow-[0_18px_55px_rgba(0,0,0,0.2)]" data-testid="ticket-module-header">
      <div className="flex flex-col gap-4 border-b border-white/[0.06] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-400">{eyebrow}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-zinc-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <nav className="flex items-center gap-1 overflow-x-auto px-3 py-2" aria-label="Ticketing modules">
        {TICKET_MODULES.map(module => {
          const Icon = MODULE_ICONS[module.id];
          const selected = active === module.id;
          return (
            <Link
              key={module.id}
              to={module.path}
              className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium transition ${selected ? "bg-violet-500/15 text-violet-200 ring-1 ring-violet-500/25" : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"}`}
              aria-current={selected ? "page" : undefined}
              data-testid={`ticket-module-${module.id}`}
            >
              <Icon className="h-3.5 w-3.5" />{module.label}
            </Link>
          );
        })}
        {children}
      </nav>
    </section>
  );
}

const PRIMARY_TABS = [
  { value: "conversation", label: "Conversation", icon: MessageSquare, countKey: "conversation" },
  { value: "worksheets", label: "Tasks", icon: ClipboardCheck, countKey: "tasks" },
  { value: "attachments", label: "Files", icon: Paperclip, countKey: "files" },
  { value: "time", label: "Time", icon: Clock3, countKey: "time" },
  { value: "timeline", label: "Activity", icon: Activity },
];

const MORE_TABS = [
  { value: "blueprint", label: "Blueprint / worksheet", icon: FileText },
  { value: "suggestions", label: "Suggested fixes", icon: Sparkles },
  { value: "items", label: "Products & billing", icon: Wrench, countKey: "items" },
  { value: "procurement", label: "Procurement & cost", icon: ShoppingCart, countKey: "procurement" },
  { value: "children", label: "Related tickets", icon: LayoutList, countKey: "children" },
  { value: "audit", label: "Audit log", icon: ShieldCheck },
];

export function TicketWorkspaceTabs({ activeTab, onTabChange, counts = {} }) {
  const moreActive = MORE_TABS.find(tab => tab.value === activeTab);
  return (
    <div className="flex items-center gap-1 border-b border-white/[0.08]" data-testid="ticket-workspace-tabs">
      <TabsList className="ticket-workspace-scroll h-auto flex-1 justify-start gap-0 overflow-x-auto rounded-none bg-transparent p-0">
        {PRIMARY_TABS.map(tab => {
          const Icon = tab.icon;
          const count = tab.countKey ? counts[tab.countKey] : null;
          return (
            <TabsTrigger key={tab.value} value={tab.value} className="h-10 shrink-0 rounded-none border-b-2 border-transparent px-3 text-xs font-medium text-zinc-500 shadow-none transition-colors hover:bg-white/[0.035] hover:text-zinc-200 data-[state=active]:border-violet-400 data-[state=active]:bg-transparent data-[state=active]:text-zinc-100 data-[state=active]:shadow-none">
              <Icon className="mr-1.5 h-3.5 w-3.5" />{tab.label}{count != null && <span className="ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-white/[0.05] px-1 text-[9px] text-zinc-500">{count}</span>}
            </TabsTrigger>
          );
        })}
      </TabsList>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className={`h-10 shrink-0 gap-1.5 rounded-none border-b-2 border-transparent px-3 text-xs ${moreActive ? "border-violet-400 bg-transparent text-zinc-100" : "text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-200"}`} data-testid="ticket-more-tabs">
            <MoreHorizontal className="h-3.5 w-3.5" />{moreActive?.label || "More"}<ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {MORE_TABS.map(tab => {
            const Icon = tab.icon;
            return <DropdownMenuItem key={tab.value} onSelect={() => onTabChange(tab.value)} className={activeTab === tab.value ? "bg-violet-500/10 text-violet-200" : ""}><Icon className="mr-2 h-3.5 w-3.5" />{tab.label}{tab.countKey && <Badge variant="outline" className="ml-auto h-4 px-1.5 text-[9px]">{counts[tab.countKey] || 0}</Badge>}</DropdownMenuItem>;
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function TicketToolsCenter({ open, onOpenChange, ticket, sections = [] }) {
  const hasDevice = Boolean(ticket?.device_id || ticket?.device_ids?.length);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto border-white/[0.08] bg-[#111318] p-0 sm:max-w-3xl" data-testid="ticket-tools-center">
        <SheetHeader className="sticky top-0 z-10 border-b border-white/[0.07] bg-[#111318]/95 px-6 py-5 pr-12 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 ring-1 ring-violet-500/25"><Bot className="h-5 w-5 text-violet-300" /></div>
            <div>
              <SheetTitle>Tools & integrations</SheetTitle>
              <SheetDescription>{ticket?.ticket_number} · A focused set of safe actions, grouped by technician workflow.</SheetDescription>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/[0.07] text-[10px] text-emerald-300"><CheckCircle2 className="mr-1 h-3 w-3" />{sections.length} action groups</Badge>
            <Badge variant="outline" className={`text-[10px] ${hasDevice ? "border-cyan-500/25 bg-cyan-500/[0.07] text-cyan-300" : "border-zinc-700 text-zinc-500"}`}>{hasDevice ? "Device linked" : "No device linked"}</Badge>
            <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-3 text-[10px] text-zinc-400 hover:text-zinc-100" onClick={() => onOpenChange(false)} data-testid="ticket-tools-done">Done</Button>
          </div>
        </SheetHeader>
        <div className="space-y-4 p-5">
          {sections.map(section => {
            const Icon = section.icon || Wrench;
            return (
              <section key={section.id} className="rounded-xl border border-white/[0.07] bg-white/[0.018] p-4" data-testid={`ticket-tools-${section.id}`}>
                <div className="mb-3 flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-white/[0.04] p-2"><Icon className="h-4 w-4 text-violet-300" /></div>
                  <div><h3 className="text-sm font-semibold text-zinc-200">{section.title}</h3>{section.description && <p className="mt-0.5 text-xs leading-5 text-zinc-400/70">{section.description}</p>}</div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 [&>button]:min-h-[72px] [&>button]:justify-start [&>button]:whitespace-normal [&>button]:rounded-lg">{section.content}</div>
              </section>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const TOOL_STATES = {
  ready: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300",
  connected: "border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-300",
  attention: "border-amber-500/20 bg-amber-500/[0.06] text-amber-300",
  unavailable: "border-zinc-700/60 bg-zinc-900/40 text-zinc-500",
};

export function TicketToolAction({
  icon: Icon = Wrench,
  title,
  description,
  state = "ready",
  stateLabel,
  disabled = false,
  busy = false,
  onClick,
  testId,
}) {
  const resolvedState = disabled ? "unavailable" : state;
  const labels = { ready: "Ready", connected: "Connected", attention: "Review", unavailable: "Unavailable" };
  return (
    <button
      type="button"
      onClick={disabled || busy ? undefined : onClick}
      disabled={disabled || busy}
      className="group flex min-h-[76px] min-w-0 items-start gap-3 rounded-lg border border-white/[0.07] bg-black/10 p-3 text-left transition hover:border-violet-500/25 hover:bg-violet-500/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
      data-testid={testId}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06]"><Icon className="h-4 w-4 text-violet-300" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 break-words text-xs font-semibold leading-4 text-zinc-200">{title}</span>
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${TOOL_STATES[resolvedState]}`}>{stateLabel || labels[resolvedState]}</span>
        </span>
        {description && <span className="mt-1 block text-[10px] leading-4 text-zinc-400/70">{busy ? "Working…" : description}</span>}
      </span>
    </button>
  );
}
