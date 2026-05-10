import { useState, useMemo, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Shield, Wrench, Truck, Eye, MessageSquare, Paperclip, Lock, AlertTriangle,
  MoreHorizontal, ChevronRight, ChevronDown, Layers, Activity, Timer, Bookmark,
} from "lucide-react";
import { differenceInHours, formatDistanceToNow } from "date-fns";

/* ─────────────────────────────────────────────────────────────────
   Density mode tokens — Linear/Plain.com inspired
   ───────────────────────────────────────────────────────────────── */
export const DENSITY = {
  compact:     { row: "py-1.5 px-3 text-[12px]", icon: "w-3.5 h-3.5", avatar: "h-5 w-5 text-[9px]", number: "text-[10px]", title: "text-[12px]" },
  comfortable: { row: "py-2.5 px-3.5 text-[13px]", icon: "w-4 h-4",   avatar: "h-6 w-6 text-[10px]", number: "text-[11px]", title: "text-[13px]" },
  spacious:    { row: "py-4 px-4 text-sm",         icon: "w-4 h-4",   avatar: "h-7 w-7 text-[11px]", number: "text-xs",     title: "text-sm" },
};

/* ─────────────────────────────────────────────────────────────────
   Status pill — Linear-style: tiny uppercase, mono, semantic color
   ───────────────────────────────────────────────────────────────── */
const STATUS_TONE = {
  open:        "text-zinc-300 bg-zinc-900/60 border-zinc-700/50",
  pending:     "text-amber-300 bg-amber-950/60 border-amber-800/50",
  in_progress: "text-cyan-300 bg-cyan-950/60 border-cyan-800/50",
  on_hold:     "text-violet-300 bg-violet-950/60 border-violet-800/50",
  resolved:    "text-emerald-300 bg-emerald-950/60 border-emerald-800/50",
  closed:      "text-zinc-500 bg-zinc-950/60 border-zinc-800/50",
  blocked:     "text-rose-300 bg-rose-950/60 border-rose-800/50",
};

export function StatusPill({ status, label }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.open;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.12em] ${tone}`}>
      <span className="w-1 h-1 rounded-full bg-current opacity-70" />
      {label || status}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Priority left-border accent (sticky 2px)
   ───────────────────────────────────────────────────────────────── */
const PRIORITY_BORDER = {
  critical: "border-l-rose-500",
  high:     "border-l-orange-500",
  medium:   "border-l-amber-500",
  low:      "border-l-emerald-500",
};
const PRIORITY_DOT = {
  critical: "bg-rose-500",
  high:     "bg-orange-500",
  medium:   "bg-amber-500",
  low:      "bg-emerald-500",
};

/* ─────────────────────────────────────────────────────────────────
   Active viewers — overlapping cyan-ring avatars
   ───────────────────────────────────────────────────────────────── */
function ActiveViewers({ viewers, density = "comfortable" }) {
  if (!viewers?.length) return null;
  const max = 3;
  const shown = viewers.slice(0, max);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center -space-x-1.5" data-testid="row-viewers">
            {shown.map(v => (
              <Avatar key={v.user_id || v.user_name} className={`${DENSITY[density].avatar} ring-2 ring-cyan-400/70 shadow-[0_0_8px_rgba(34,211,238,0.4)] border-0`}>
                <AvatarImage src={v.avatar_url} />
                <AvatarFallback className="bg-cyan-950 text-cyan-300">{(v.user_name || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
            ))}
            {viewers.length > max && (
              <span className="ml-1 text-[10px] font-mono text-cyan-300/80">+{viewers.length - max}</span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{viewers.map(v => v.user_name).join(", ")} viewing now</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Single dense ticket row — replaces bulky Card layout
   ───────────────────────────────────────────────────────────────── */
export function TicketRow({
  ticket, density = "comfortable", isSelected, onToggleSelect, onOpen, viewers,
  noteCount, attachmentCount, statusConfig, priorityConfig,
}) {
  const d = DENSITY[density];
  const sc = statusConfig[ticket.status] || { label: ticket.status };
  const pc = priorityConfig[ticket.priority] || {};
  const isOverdue = ticket.sla_due && new Date(ticket.sla_due) < new Date() && !["closed", "resolved"].includes(ticket.status);
  const slaHrs = ticket.sla_due ? differenceInHours(new Date(ticket.sla_due), new Date()) : null;
  const isClosed = ["closed", "resolved"].includes(ticket.status);
  const isBlocked = !!ticket.blocked_by_ticket_number;

  // Type icon by category
  const Icon = ticket.category === "workshop" ? Wrench : ticket.category === "field" ? Truck : ticket.category === "change" ? Layers : Shield;
  const iconTint = ticket.category === "workshop" ? "text-amber-400" : ticket.category === "field" ? "text-cyan-400" : ticket.category === "change" ? "text-purple-400" : "text-blue-400";

  const slaLabel = slaHrs == null ? null : (slaHrs < 0 ? `${Math.abs(slaHrs)}h over` : slaHrs < 24 ? `${slaHrs}h left` : `${Math.round(slaHrs / 24)}d`);
  const slaTone = slaHrs == null ? "" : (slaHrs < 0 ? "text-rose-400" : slaHrs < 4 ? "text-amber-400" : "text-zinc-500");

  return (
    <div
      onClick={() => onOpen?.(ticket)}
      className={`group/row relative flex items-center gap-3 ${d.row} border-b border-white/[0.04] border-l-2 cursor-pointer transition-colors
        ${PRIORITY_BORDER[ticket.priority] || "border-l-zinc-700"}
        ${isSelected ? "bg-violet-500/[0.06]" : "hover:bg-white/[0.025]"}
        ${isClosed ? "opacity-55" : ""}`}
      data-testid={`ticket-row-${ticket.id}`}
    >
      {/* Checkbox — fades in on hover or when selected */}
      <div className={`flex-shrink-0 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`} onClick={e => e.stopPropagation()}>
        <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect?.(ticket.id)} data-testid={`ticket-checkbox-${ticket.id}`} className="h-3.5 w-3.5" />
      </div>

      {/* Ticket # — monospace, always-visible */}
      <code className={`${d.number} font-mono text-zinc-500 tabular-nums w-[78px] shrink-0`} data-testid={`ticket-badge-${ticket.id}`}>
        {ticket.ticket_number}
      </code>

      {/* Type icon */}
      <Icon className={`${d.icon} ${iconTint} shrink-0`} />

      {/* Title + tags */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className={`${d.title} truncate ${noteCount === 0 && !isClosed ? "font-medium text-zinc-100" : "text-zinc-200"}`}>
          {ticket.title}
        </span>
        {ticket.escalated && <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" title="Escalated" />}
        {isBlocked && (
          <Badge className="bg-rose-950/60 text-rose-300 border-rose-800/50 px-1 py-0 text-[9px] font-mono uppercase tracking-wider gap-1">
            <Lock className="w-2 h-2" />blocked
          </Badge>
        )}
        {ticket.csat_sent && <Bookmark className="w-3 h-3 text-amber-400/70 shrink-0" title="CSAT sent" />}
      </div>

      {/* Client — muted */}
      <span className="hidden md:inline-block text-zinc-500 truncate w-[160px] shrink-0 text-[11px]">{ticket.client_name || "—"}</span>

      {/* Counts */}
      <div className="hidden lg:flex items-center gap-2.5 text-zinc-500 text-[10px] font-mono shrink-0">
        {noteCount != null && (
          <span className="inline-flex items-center gap-0.5" title={`${noteCount} notes`}>
            <MessageSquare className="w-3 h-3" />{noteCount}
          </span>
        )}
        {attachmentCount > 0 && (
          <span className="inline-flex items-center gap-0.5" title={`${attachmentCount} attachments`}>
            <Paperclip className="w-3 h-3" />{attachmentCount}
          </span>
        )}
      </div>

      {/* Active viewers */}
      <ActiveViewers viewers={viewers} density={density} />

      {/* Status pill */}
      <StatusPill status={ticket.status} label={sc.label} />

      {/* Assignee avatar */}
      <Avatar className={`${d.avatar} shrink-0 ring-1 ring-white/10`}>
        <AvatarImage src={ticket.assignee_avatar} />
        <AvatarFallback className="bg-zinc-900 text-zinc-300">{(ticket.assignee_name || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>

      {/* SLA / age */}
      {slaLabel ? (
        <span className={`hidden sm:inline-block ${slaTone} font-mono text-[10px] tabular-nums w-[60px] text-right shrink-0`} data-testid={`ticket-sla-${ticket.id}`}>
          <Timer className="inline-block w-2.5 h-2.5 mr-0.5 -mt-px" />{slaLabel}
        </span>
      ) : (
        <span className="hidden sm:inline-block text-zinc-600 font-mono text-[10px] tabular-nums w-[60px] text-right shrink-0">
          {ticket.created_at && formatDistanceToNow(new Date(ticket.created_at), { addSuffix: false })}
        </span>
      )}

      {/* Quick action — appears on hover */}
      <div className={`opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0`} onClick={e => e.stopPropagation()}>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-white/5">
          <MoreHorizontal className="w-3.5 h-3.5 text-zinc-500" />
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Group section — collapsible header for grouped lists
   ───────────────────────────────────────────────────────────────── */
export function TicketGroupSection({ title, count, defaultOpen = true, tone = "zinc", children, testId }) {
  const [open, setOpen] = useState(defaultOpen);
  const toneMap = {
    rose:    "text-rose-300",
    amber:   "text-amber-300",
    cyan:    "text-cyan-300",
    emerald: "text-emerald-300",
    violet:  "text-violet-300",
    zinc:    "text-zinc-400",
  };
  return (
    <div data-testid={testId}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.02] transition-colors border-b border-white/[0.04] sticky top-0 bg-[#0a0a0a]/95 backdrop-blur-sm z-10"
      >
        {open ? <ChevronDown className="w-3 h-3 text-zinc-600" /> : <ChevronRight className="w-3 h-3 text-zinc-600" />}
        <span className={`text-[10px] uppercase tracking-[0.2em] font-mono font-semibold ${toneMap[tone]}`}>{title}</span>
        <span className="text-[10px] font-mono text-zinc-600 tabular-nums">{count}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Density toggle (Cmd+Shift+D)
   ───────────────────────────────────────────────────────────────── */
export function useDensityMode() {
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem("nexus.tickets.density") || "comfortable"; } catch { return "comfortable"; }
  });
  useEffect(() => { try { localStorage.setItem("nexus.tickets.density", density); } catch {} }, [density]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        setDensity(d => d === "compact" ? "comfortable" : d === "comfortable" ? "spacious" : "compact");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [density, setDensity];
}

export function DensityToggle({ density, setDensity }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-[10px] font-mono uppercase tracking-wider text-zinc-400 hover:text-zinc-100 hover:bg-white/5" data-testid="density-toggle">
          <Layers className="w-3 h-3 mr-1" />{density.slice(0, 4)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => setDensity("compact")} data-testid="density-compact">
          <span className="text-[11px] font-mono uppercase tracking-wider mr-2">CMP</span>Compact
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDensity("comfortable")} data-testid="density-comfortable">
          <span className="text-[11px] font-mono uppercase tracking-wider mr-2">CMF</span>Comfortable
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDensity("spacious")} data-testid="density-spacious">
          <span className="text-[11px] font-mono uppercase tracking-wider mr-2">SPC</span>Spacious
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="text-[10px] text-zinc-600 mt-1 border-t border-white/5 pt-2">
          ⌘ + Shift + D to cycle
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Group-by selector
   ───────────────────────────────────────────────────────────────── */
export function GroupBySelector({ groupBy, setGroupBy }) {
  const opts = [
    { v: "none",     l: "No grouping" },
    { v: "status",   l: "Status" },
    { v: "priority", l: "Priority" },
    { v: "assignee", l: "Assignee" },
    { v: "client",   l: "Client" },
    { v: "age",      l: "SLA / Age" },
  ];
  const cur = opts.find(o => o.v === groupBy) || opts[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-[10px] font-mono uppercase tracking-wider text-zinc-400 hover:text-zinc-100 hover:bg-white/5" data-testid="groupby-toggle">
          <Activity className="w-3 h-3 mr-1" />Group: {cur.l}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {opts.map(o => (
          <DropdownMenuItem key={o.v} onSelect={() => setGroupBy(o.v)} data-testid={`groupby-${o.v}`}>{o.l}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Group helper — bucket tickets by chosen attribute
   ───────────────────────────────────────────────────────────────── */
export function useGroupedTickets(tickets, groupBy, statusConfig, priorityConfig) {
  return useMemo(() => {
    if (groupBy === "none" || !tickets?.length) return [{ key: "all", title: null, tone: "zinc", items: tickets || [] }];
    if (groupBy === "age") {
      const now = new Date();
      const breached = [], soon = [], today = [], later = [], done = [];
      for (const t of tickets) {
        if (["closed", "resolved"].includes(t.status)) { done.push(t); continue; }
        if (!t.sla_due) { later.push(t); continue; }
        const hrs = differenceInHours(new Date(t.sla_due), now);
        if (hrs < 0) breached.push(t);
        else if (hrs < 4) soon.push(t);
        else if (hrs < 24) today.push(t);
        else later.push(t);
      }
      return [
        { key: "breached", title: "SLA Breached",   tone: "rose",    items: breached, defaultOpen: true },
        { key: "soon",     title: "Due in <4h",      tone: "amber",   items: soon,     defaultOpen: true },
        { key: "today",    title: "Due Today",       tone: "cyan",    items: today,    defaultOpen: true },
        { key: "later",    title: "Later",           tone: "zinc",    items: later,    defaultOpen: true },
        { key: "done",     title: "Resolved/Closed", tone: "emerald", items: done,     defaultOpen: false },
      ].filter(g => g.items.length);
    }
    const buckets = new Map();
    const titleFor = (t) => {
      if (groupBy === "status")   return statusConfig[t.status]?.label || t.status || "Unknown";
      if (groupBy === "priority") return priorityConfig[t.priority]?.label || t.priority || "Unknown";
      if (groupBy === "assignee") return t.assignee_name || "Unassigned";
      if (groupBy === "client")   return t.client_name || "No client";
      return "Other";
    };
    for (const t of tickets) {
      const k = titleFor(t);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(t);
    }
    const toneFor = (label) => {
      const l = (label || "").toLowerCase();
      if (l.includes("critical") || l.includes("breached") || l.includes("blocked")) return "rose";
      if (l.includes("high") || l.includes("urgent")) return "amber";
      if (l.includes("medium") || l.includes("progress")) return "cyan";
      if (l.includes("low") || l.includes("resolved") || l.includes("closed")) return "emerald";
      return "zinc";
    };
    return Array.from(buckets.entries()).map(([k, items]) => ({ key: k, title: k, tone: toneFor(k), items, defaultOpen: items.length <= 30 }));
  }, [tickets, groupBy, statusConfig, priorityConfig]);
}
