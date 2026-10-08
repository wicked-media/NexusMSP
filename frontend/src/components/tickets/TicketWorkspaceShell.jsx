import { Link, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import NexusWorkspaceHeader from "@/components/NexusWorkspaceHeader";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuGroup,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Activity, Bot, CheckCircle2, ChevronDown, ClipboardCheck, Clock3, FileText, Gauge,
  LayoutList, MapPinned, MessageSquare, MoreHorizontal, Paperclip, RotateCcw,
  ShieldCheck, ShoppingCart, Sparkles, Wrench,
} from "lucide-react";
import { toast } from "sonner";
import {
  LEARNING_VIEW,
  learningHint,
  promotedItems,
  rankByUse,
} from "@/lib/workspaceLearning";
import { TICKET_MODULES, TICKET_WORKSPACE_TOOLS, ticketModuleForPath, ticketWorkspaceToolForPath } from "@/lib/ticketWorkspaceHelpers";

// No memory yet: every ranking helper treats an empty index as no evidence.
const NO_EVIDENCE = new Map();

const MODULE_ICONS = {
  queue: LayoutList,
  triage: ClipboardCheck,
  sla: Gauge,
  dispatch: MapPinned,
};

// The desk-tools menu is grouped by technician workflow, so learning reorders
// the tools inside each group rather than dissolving the grouping. A hand-
// authored group still says what kind of work the tools belong to.
const TOOL_GROUPS = ["Repeatable work", "Assignment & escalation", "Historical records"];

/**
 * Ticket module header, shared by the queue, triage, SLA and dispatch modules.
 *
 * The desk-tools menu holds the ticket-delivery tools. Nexus remembers which of
 * them a technician actually opens and orders each group around that evidence,
 * so the tool they live in stops being the third thing they scan for. No tool is
 * ever removed, and with no evidence the menu is exactly the order this file
 * declares.
 */
export function TicketModuleHeader({
  title,
  subtitle,
  eyebrow = "Service desk",
  actions,
  children,
  signal,
  signalLabel,
  signalDescription,
  personal = NO_EVIDENCE,
  team = NO_EVIDENCE,
  onRecordAction,
  onForgetLearning,
}) {
  const location = useLocation();
  const active = ticketModuleForPath(location.pathname);
  const activeTool = ticketWorkspaceToolForPath(location.pathname);
  const ActiveIcon = MODULE_ICONS[active] || LayoutList;
  const rankOptions = { surface: LEARNING_VIEW, personal, team, idOf: (tool) => tool.id };
  const groups = TOOL_GROUPS.map((group) => ({
    group,
    declared: TICKET_WORKSPACE_TOOLS.filter((tool) => tool.group === group),
  })).map((entry) => ({ ...entry, tools: rankByUse(entry.declared, rankOptions) }));
  // Nexus only claims to have adapted the menu when the ranking really changed
  // it; evidence that leaves every group exactly as declared is not a change.
  const adapted = groups.some((entry) => entry.tools.some((tool, index) => tool !== entry.declared[index]));
  const hint = learningHint({ surface: LEARNING_VIEW, personal, team });

  const forgetLearning = async () => {
    try {
      const removed = await onForgetLearning?.();
      toast.success(`${removed || 0} learned tool signal${removed === 1 ? "" : "s"} forgotten`, {
        description: "The desk-tools menu is back to the Nexus default order and will learn again from your next visit.",
      });
    } catch {
      toast.error("Nexus could not forget the learned ordering. Nothing has been changed.");
    }
  };

  return (
    <section className="nx-ticket-module-shell" data-testid="ticket-module-header">
      <NexusWorkspaceHeader
        eyebrow={eyebrow}
        title={title}
        description={subtitle}
        icon={ActiveIcon}
        tone="violet"
        actions={actions}
        signal={signal}
        signalLabel={signalLabel}
        signalDescription={signalDescription}
        showBack={false}
        variant="module"
        testId="ticket-workspace-header"
      />
      <nav className="nx-ticket-module-nav" aria-label="Ticketing modules">
        {TICKET_MODULES.map(module => {
          const Icon = MODULE_ICONS[module.id];
          const selected = active === module.id;
          return (
            <Link
              key={module.id}
              to={module.path}
              className="nx-ticket-module-nav__item"
              data-active={selected ? "true" : "false"}
              aria-current={selected ? "page" : undefined}
              data-testid={`ticket-module-${module.id}`}
            >
              <Icon />
              <span><strong>{module.label}</strong><small>{module.description}</small></span>
            </Link>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={`nx-ticket-module-nav__tools ${activeTool ? "is-active" : ""}`} data-testid="ticket-module-more">
              <MoreHorizontal className="h-3.5 w-3.5" />{activeTool?.label || "Desk tools"}<ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto p-2">
            {hint && adapted && (
              <DropdownMenuLabel
                className="flex items-center gap-1.5 pb-1 pt-2 text-[10px] font-medium text-violet-300"
                data-testid="ticket-tools-learning"
                data-learning-tone={hint.tone}
                title={hint.detail}
              >
                <Sparkles className="h-3 w-3" />{hint.label}
              </DropdownMenuLabel>
            )}
            {groups.map(entry => (
              <DropdownMenuGroup key={entry.group}>
                <DropdownMenuLabel className="pb-1 pt-3 text-[10px] uppercase tracking-wider text-muted-foreground">{entry.group}</DropdownMenuLabel>
                {entry.tools.map(tool => <DropdownMenuItem key={tool.id} asChild className={`rounded-lg px-3 py-2.5 ${activeTool?.id === tool.id ? "bg-violet-500/10 text-violet-200" : ""}`} data-testid={`ticket-tool-${tool.id}`} onSelect={() => onRecordAction?.(LEARNING_VIEW, tool.id)}>
                  <Link to={tool.path} className="flex flex-col items-start gap-1" aria-current={activeTool?.id === tool.id ? "page" : undefined}>
                    <span className="text-xs font-medium">{tool.label}</span>
                    <span className="text-[11px] leading-4 text-muted-foreground">{tool.description}</span>
                  </Link>
                </DropdownMenuItem>)}
              </DropdownMenuGroup>
            ))}
            {hint && adapted && onForgetLearning && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => forgetLearning()} className="gap-2 text-muted-foreground" data-testid="ticket-tools-forget-learning" title="Return the desk-tools menu to the Nexus default order and clear what Nexus learned about your tools">
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />Forget learned ordering
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
  { value: "suggestions", label: "Historical matches", icon: Sparkles },
  { value: "devices", label: "Endpoint actions", icon: Gauge },
  { value: "items", label: "Products & billing", icon: Wrench, countKey: "items" },
  { value: "procurement", label: "Procurement & cost", icon: ShoppingCart, countKey: "procurement" },
  { value: "children", label: "Related tickets", icon: LayoutList, countKey: "children" },
  { value: "audit", label: "Audit log", icon: ShieldCheck },
];

/**
 * How many tabs may sit in the visible bar. Learning adds slots for the views a
 * technician actually opens (so a tab they live in stops hiding behind More),
 * but the bar is capped: beyond this the tab bar stops being scannable and the
 * rest of the views stay one menu away.
 */
const MAX_VISIBLE_TABS = PRIMARY_TABS.length + 2;

/**
 * Ticket detail tab bar.
 *
 * Nexus remembers which detail view a technician opens and which ones the team
 * opens, and orders the bar around that evidence: a view the technician really
 * uses moves to the front, and one that deserves a place in the bar is promoted
 * out of the More menu. Every view stays reachable from the same menu it was in
 * before, and with no evidence the bar is exactly the order this file declares.
 */
export function TicketWorkspaceTabs({
  activeTab,
  onTabChange,
  counts = {},
  personal = NO_EVIDENCE,
  team = NO_EVIDENCE,
  onRecordAction,
  onForgetLearning,
}) {
  // One catalogue, so a promoted view competes with the views already in the bar
  // instead of merely being appended to them.
  const catalogue = [...PRIMARY_TABS, ...MORE_TABS];
  const rankOptions = { surface: LEARNING_VIEW, personal, team, idOf: (tab) => tab.value };
  const ranked = rankByUse(catalogue, rankOptions);
  const promoted = promotedItems(MORE_TABS, rankOptions).length;
  const visibleCount = Math.min(MAX_VISIBLE_TABS, PRIMARY_TABS.length + promoted);
  const visible = ranked.slice(0, visibleCount);
  const overflow = ranked.slice(visibleCount);
  const hint = learningHint({ surface: LEARNING_VIEW, personal, team });
  // The More trigger reports the overflow view it is holding, not the declared
  // menu, so a promoted tab no longer names the menu it just left.
  const moreActive = overflow.find(tab => tab.value === activeTab);

  const record = (tab) => onRecordAction?.(LEARNING_VIEW, tab.value);

  const forgetLearning = async () => {
    try {
      const removed = await onForgetLearning?.();
      toast.success(`${removed || 0} learned tab signal${removed === 1 ? "" : "s"} forgotten`, {
        description: "The tab bar is back to the Nexus default order and will learn again from your next visit.",
      });
    } catch {
      toast.error("Nexus could not forget the learned ordering. Nothing has been changed.");
    }
  };

  return (
    <div className="flex items-center gap-1 border-b border-white/[0.08]" data-testid="ticket-workspace-tabs">
      <TabsList className="ticket-workspace-scroll h-auto flex-1 justify-start gap-0 overflow-x-auto rounded-none bg-transparent p-0">
        {visible.map(tab => {
          const Icon = tab.icon;
          const count = tab.countKey ? counts[tab.countKey] : null;
          return (
            <TabsTrigger key={tab.value} value={tab.value} onClick={() => record(tab)} className="h-10 shrink-0 rounded-none border-b-2 border-transparent px-3 text-xs font-medium text-zinc-500 shadow-none transition-colors hover:bg-white/[0.035] hover:text-zinc-200 data-[state=active]:border-violet-400 data-[state=active]:bg-transparent data-[state=active]:text-zinc-100 data-[state=active]:shadow-none">
              <Icon className="mr-1.5 h-3.5 w-3.5" />{tab.label}{count != null && <span className="ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-white/[0.05] px-1 text-[9px] text-zinc-500">{count}</span>}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {hint && (
        <Badge
          variant="outline"
          data-testid="ticket-workspace-tabs-learning"
          data-learning-tone={hint.tone}
          title={hint.detail}
          className="h-6 shrink-0 gap-1 border-violet-400/25 bg-violet-500/[0.07] px-2 text-[10px] font-medium text-violet-300"
        >
          <Sparkles className="h-3 w-3" />
          {hint.label}
        </Badge>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className={`h-10 shrink-0 gap-1.5 rounded-none border-b-2 border-transparent px-3 text-xs ${moreActive ? "border-violet-400 bg-transparent text-zinc-100" : "text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-200"}`} data-testid="ticket-more-tabs">
            <MoreHorizontal className="h-3.5 w-3.5" />{moreActive?.label || "More"}<ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {overflow.map(tab => {
            const Icon = tab.icon;
            return <DropdownMenuItem key={tab.value} onSelect={() => { record(tab); onTabChange(tab.value); }} className={activeTab === tab.value ? "bg-violet-500/10 text-violet-200" : ""}><Icon className="mr-2 h-3.5 w-3.5" />{tab.label}{tab.countKey && <Badge variant="outline" className="ml-auto h-4 px-1.5 text-[9px]">{counts[tab.countKey] || 0}</Badge>}</DropdownMenuItem>;
          })}
          {hint && onForgetLearning && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => forgetLearning()} className="gap-2 text-muted-foreground" data-testid="ticket-forget-learning" title="Return the tab bar to the Nexus default order and clear what Nexus learned about your views">
                <RotateCcw className="mr-2 h-3.5 w-3.5" />Forget learned ordering
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function TicketToolsCenter({ open, onOpenChange, ticket, sections = [] }) {
  const hasDevice = Boolean(ticket?.device_id || ticket?.device_ids?.length);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto border-white/[0.08] bg-[#0d1117] p-0 sm:max-w-3xl" data-testid="ticket-tools-center">
        <SheetHeader className="sticky top-0 z-10 border-b border-cyan-400/[0.12] bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.17),transparent_48%),radial-gradient(circle_at_top_left,rgba(16,185,129,0.11),transparent_38%),rgba(13,17,23,0.97)] px-6 py-5 pr-12 backdrop-blur-xl">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Ticket operations</p>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/[0.10]"><Bot className="h-5 w-5 text-cyan-200" /></div>
            <div>
              <SheetTitle className="text-xl text-zinc-100">Tools & integrations</SheetTitle>
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
              <section key={section.id} className="rounded-xl border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012))] p-4 shadow-[0_10px_26px_rgba(0,0,0,0.12)]" data-testid={`ticket-tools-${section.id}`}>
                <div className="mb-3 flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.07] p-2"><Icon className="h-4 w-4 text-cyan-200" /></div>
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
      className="group flex min-h-[76px] min-w-0 items-start gap-3 rounded-lg border border-white/[0.07] bg-black/10 p-3 text-left transition hover:border-cyan-400/30 hover:bg-cyan-400/[0.045] disabled:cursor-not-allowed disabled:opacity-60"
      data-testid={testId}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-400/[0.07] ring-1 ring-cyan-400/[0.12]"><Icon className="h-4 w-4 text-cyan-200" /></span>
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
