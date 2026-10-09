import { useState, useMemo, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Shield, Wrench, Truck, MessageSquare, Paperclip, Lock, AlertTriangle,
  ChevronRight, ChevronDown, Layers, Activity, Timer, Bookmark, Play, UserPlus, CheckCircle2, Monitor, Check, Link2,
} from "lucide-react";
import { differenceInHours, formatDistanceToNow } from "date-fns";
import { TICKET_PRIORITY_STYLES, TICKET_STATUS_STYLES } from "@/lib/ticketWorkspaceHelpers";
import { TICKET_QUEUE_STATUSES } from "@/config/ticketConfig";

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
/* When `onSelect` is supplied the pill becomes an inline status control so the
   queue is a work surface, not a read-only list. Reversible states apply
   immediately; terminal closure still routes through the governed resolution
   review because `PUT /tickets/{id}` promotes `resolved` to `closed` and writes
   the closure audit record. */
export function StatusPill({
  status, label, ticketId, disabled = false, statusOptions = [], onSelect, onRequestTerminal, isTerminal = false,
}) {
  const tone = TICKET_STATUS_STYLES[status] || TICKET_STATUS_STYLES.open;
  const text = label || status;
  const pill = (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.12em] ${tone}`} data-testid={ticketId ? `ticket-status-${ticketId}` : undefined}>
      <span className="w-1 h-1 rounded-full bg-current opacity-70" />
      {text}
    </span>
  );
  if (!onSelect || disabled) return pill;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={`Change status for ${ticketId || "ticket"} — currently ${text}`}
          data-testid={`ticket-status-trigger-${ticketId}`}
          className="group/status inline-flex items-center gap-0.5 rounded-md outline-none transition-transform duration-150 hover:scale-[1.04] focus-visible:ring-1 focus-visible:ring-cyan-400/50 active:scale-100"
        >
          {pill}
          <ChevronDown className="h-2.5 w-2.5 text-zinc-600 transition-colors group-hover/status:text-zinc-300" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 nx-queue-status-menu" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuLabel className="text-[9px] uppercase tracking-[0.16em] text-zinc-500">Set status</DropdownMenuLabel>
        {statusOptions.map((option) => {
          const optionTone = TICKET_STATUS_STYLES[option.key] || TICKET_STATUS_STYLES.open;
          const isCurrent = option.key === status;
          return (
            <DropdownMenuItem
              key={option.key}
              disabled={isCurrent}
              onSelect={() => onSelect?.(option.key)}
              data-testid={`ticket-status-set-${option.key}-${ticketId}`}
              className="gap-2"
            >
              <span className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full border ${optionTone}`} aria-hidden="true" />
              <span className="flex-1 text-xs">{option.label}</span>
              {isCurrent ? (
                <Check className="h-3 w-3 opacity-70" />
              ) : option.shortcut ? (
                <kbd className="rounded border border-white/10 bg-black/30 px-1 font-mono text-[9px] text-zinc-500">{option.shortcut}</kbd>
              ) : null}
            </DropdownMenuItem>
          );
        })}
        {onRequestTerminal && (
          <>
            <DropdownMenuSeparator />
            {isTerminal ? (
              <DropdownMenuItem onSelect={() => onRequestTerminal("reopen")} data-testid={`ticket-status-reopen-${ticketId}`}>
                <Activity className="h-3 w-3 text-cyan-400" />
                <span className="flex-1 text-xs">Reopen…</span>
                <span className="text-[9px] text-zinc-600">audited</span>
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onSelect={() => onRequestTerminal("resolved")} data-testid={`ticket-status-resolve-${ticketId}`}>
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  <span className="flex-1 text-xs">Resolve…</span>
                  <span className="text-[9px] text-zinc-600">review</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onRequestTerminal("closed")} data-testid={`ticket-status-close-${ticketId}`}>
                  <Lock className="h-3 w-3 text-zinc-400" />
                  <span className="flex-1 text-xs">Close…</span>
                  <span className="text-[9px] text-zinc-600">review</span>
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* Shortcut map for the inline status control: 1–4 move reversible state. */
const QUEUE_STATUS_SHORTCUTS = TICKET_QUEUE_STATUSES.reduce((acc, key, index) => {
  acc[key] = String(index + 1);
  return acc;
}, {});

/* ─────────────────────────────────────────────────────────────────
   Priority left-border accent (sticky 2px)
   ───────────────────────────────────────────────────────────────── */
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
  noteCount, attachmentCount, statusConfig, onQuickAction,
  onStatusChange, onRequestTerminal, statusPending = false,
  recentlyChanged = false, index = 0,
}) {
  const d = DENSITY[density];
  const sc = statusConfig[ticket.status] || { label: ticket.status };
  const isOverdue = ticket.sla_due && new Date(ticket.sla_due) < new Date() && !["closed", "resolved"].includes(ticket.status);
  const slaHrs = ticket.sla_due ? differenceInHours(new Date(ticket.sla_due), new Date()) : null;
  const isClosed = ["closed", "resolved"].includes(ticket.status);
  const isBlocked = !!ticket.blocked_by_ticket_number;
  const hasLinkedDevice = Boolean(ticket.device_id || ticket.asset_id || ticket.device_ids?.length);
  const serviceKit = ticket.service_kit || (ticket.service_kit_id ? { id: ticket.service_kit_id } : null);
  const serviceKitLabel = serviceKit?.id === "workshop_repair" ? "Workshop kit" : serviceKit?.id === "cabling_field" ? "Field kit" : null;
  const quickActions = [
    !isClosed && !ticket.assigned_to && { id: "claim", label: "Claim", icon: UserPlus, tone: "text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-100" },
    !isClosed && ticket.status !== "in_progress" && { id: "start", label: "Start", icon: Play, tone: "text-amber-300 hover:bg-amber-500/10 hover:text-amber-100" },
    hasLinkedDevice && { id: "remote", label: "Remote", icon: Monitor, tone: "text-violet-300 hover:bg-violet-500/10 hover:text-violet-100" },
    !isClosed && { id: "resolve", label: "Resolve", icon: CheckCircle2, tone: "text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-100" },
    { id: "copy", label: "Copy link", icon: Link2, tone: "text-zinc-300 hover:bg-white/10 hover:text-zinc-100" },
  ].filter(Boolean);

  // Entrance stagger, capped so a long queue never waits on a 40-step timeline.
  const entranceDelay = Math.min(Math.max(index, 0), 11) * 28;

  // Reversible queue states only. Terminal closure keeps its governed review
  // flow, so the pill offers "Resolve…/Close…" instead of a raw status write.
  const statusOptions = TICKET_QUEUE_STATUSES
    .filter((key) => statusConfig?.[key])
    .map((key) => ({ key, label: statusConfig[key].label, shortcut: QUEUE_STATUS_SHORTCUTS[key] }));

  // Type icon by category
  const Icon = ticket.category === "workshop" ? Wrench : ticket.category === "field" ? Truck : ticket.category === "change" ? Layers : Shield;
  const iconTint = ticket.category === "workshop" ? "text-amber-400" : ticket.category === "field" ? "text-cyan-400" : ticket.category === "change" ? "text-purple-400" : "text-blue-400";

  const slaLabel = isClosed
    ? "SLA closed"
    : slaHrs == null
      ? null
      : slaHrs < 0
        ? `${Math.abs(slaHrs)}h over`
        : slaHrs < 24
          ? `${slaHrs}h left`
          : `${Math.round(slaHrs / 24)}d`;
  const slaTone = isClosed
    ? "text-emerald-400"
    : slaHrs == null
      ? ""
      : slaHrs < 0
        ? "text-rose-400"
        : slaHrs < 4
          ? "text-amber-400"
          : "text-zinc-500";

  return (
    <div
      onClick={() => onOpen?.(ticket)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(ticket);
          return;
        }
        // Linear-style queue keyboard: 1–4 move reversible state, C claims.
        const statusOption = statusOptions.find((option) => option.shortcut === event.key);
        if (statusOption && !isClosed && onStatusChange) {
          event.preventDefault();
          onStatusChange(ticket, statusOption.key);
          return;
        }
        if ((event.key === "c" || event.key === "C") && quickActions.some((action) => action.id === "claim")) {
          event.preventDefault();
          onQuickAction?.(ticket, "claim");
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Open ${ticket.ticket_number || "ticket"}: ${ticket.title || "Untitled ticket"}`}
      className={`group/row relative flex items-center gap-3 ${d.row} border-b border-white/[0.04] border-l-2 cursor-pointer outline-none transition-colors focus-visible:bg-cyan-500/[0.06] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cyan-400/40 [&>span:has(+.ticket-client-brand)]:md:hidden
        ${TICKET_PRIORITY_STYLES[ticket.priority]?.border || "border-l-zinc-700"}
        ${isSelected ? "bg-violet-500/[0.08]" : isOverdue ? "bg-rose-500/[0.025] hover:bg-rose-500/[0.055]" : ticket.priority === "critical" ? "bg-amber-500/[0.02] hover:bg-amber-500/[0.05]" : "hover:bg-white/[0.025]"}
        ${isClosed ? "opacity-55" : ""}
        nx-queue-row`}
      style={{ animationDelay: `${entranceDelay}ms` }}
      data-testid={`ticket-row-${ticket.id}`}
    >
      {/* Checkbox — fades in on hover or when selected */}
      <div className={`flex-shrink-0 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`} onClick={e => e.stopPropagation()}>
        <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect?.(ticket.id)} data-testid={`ticket-checkbox-${ticket.id}`} className="h-3.5 w-3.5" />
      </div>

      {/* Ticket # — monospace, always-visible */}
      <code className={`${d.number} font-mono ${isOverdue ? "text-rose-300" : "text-zinc-500"} tabular-nums w-[78px] shrink-0`} data-testid={`ticket-badge-${ticket.id}`}>
        {ticket.ticket_number}
      </code>

      {/* Type icon */}
      <Icon className={`${d.icon} ${iconTint} shrink-0`} />

      {/* Title + tags */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className={`${d.title} truncate ${isOverdue || ticket.priority === "critical" ? "font-semibold text-zinc-100" : noteCount === 0 && !isClosed ? "font-medium text-zinc-100" : "text-zinc-200"}`}>
          {ticket.title}
        </span>
        {ticket.escalated && <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" title="Escalated" />}
        {isBlocked && (
          <Badge className="bg-rose-950/60 text-rose-300 border-rose-800/50 px-1 py-0 text-[9px] font-mono uppercase tracking-wider gap-1">
            <Lock className="w-2 h-2" />blocked
          </Badge>
        )}
        {serviceKitLabel && (
          <Badge className={`${serviceKit?.id === "workshop_repair" ? "border-cyan-400/25 bg-cyan-400/[0.08] text-cyan-200" : "border-violet-400/25 bg-violet-400/[0.08] text-violet-200"} px-1.5 py-0 text-[9px] font-mono uppercase tracking-wider`} title="Specialist delivery workflow linked to this parent ticket">
            {serviceKitLabel}
          </Badge>
        )}
        {ticket.csat_sent && <Bookmark className="w-3 h-3 text-amber-400/70 shrink-0" title="CSAT sent" />}
      </div>

      {/* Client — muted */}
      <span className="hidden md:inline-block text-zinc-500 truncate w-[160px] shrink-0 text-[11px]">{ticket.client_name || "—"}</span>

      <span className="ticket-client-brand hidden md:flex w-[160px] shrink-0 items-center gap-2 truncate text-[11px] text-zinc-500 [&+span]:md:hidden">
        {ticket.client_logo_url ? (
          <img src={ticket.client_logo_url} alt="" className="h-5 w-5 shrink-0 rounded-md border border-white/10 bg-white object-contain p-0.5" />
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-[8px] font-semibold text-zinc-400">{(ticket.client_name || "?").slice(0, 1).toUpperCase()}</span>
        )}
        <span className="truncate">{ticket.client_name || "Client"}</span>
      </span>

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

      {/* Status pill — inline status control for the queue */}
      <StatusPill
        status={ticket.status}
        label={sc.label}
        ticketId={ticket.id}
        disabled={statusPending}
        statusOptions={statusOptions}
        isTerminal={isClosed}
        onSelect={onStatusChange ? (next) => onStatusChange(ticket, next) : undefined}
        onRequestTerminal={onRequestTerminal ? (target) => onRequestTerminal(ticket, target) : undefined}
      />

      {/* Technician cockpit actions appear only once a row is targeted. */}
      {quickActions.length > 0 && (
        <div className="hidden xl:flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-black/20 p-0.5 opacity-0 shadow-sm transition-all group-hover/row:opacity-100 group-focus/row:opacity-100 group-focus-within/row:opacity-100" onClick={event => event.stopPropagation()}>
          {quickActions.map(({ id, label, icon: QuickIcon, tone }) => (
            <TooltipProvider key={id} delayDuration={250}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${tone}`}
                    onClick={() => onQuickAction?.(ticket, id)}
                    aria-label={`${label} ${ticket.ticket_number || "ticket"}`}
                    data-testid={`ticket-quick-${id}-${ticket.id}`}
                  >
                    <QuickIcon className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">{label}</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>
      )}

      {/* Assignee avatar */}
      <Avatar className={`${d.avatar} shrink-0 ring-1 ring-white/10`}>
        <AvatarImage src={ticket.assignee_avatar} />
        <AvatarFallback className="bg-zinc-900 text-zinc-300">{(ticket.assignee_name || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>

      {/* SLA / age */}
      {slaLabel ? (
        <span className={`hidden sm:inline-block ${slaTone} ${isOverdue ? "nx-sla-overdue" : ""} font-mono text-[10px] tabular-nums w-[60px] text-right shrink-0`} data-testid={`ticket-sla-${ticket.id}`}>
          <Timer className="inline-block w-2.5 h-2.5 mr-0.5 -mt-px" />{slaLabel}
        </span>
      ) : (
        <span className="hidden sm:inline-block text-zinc-600 font-mono text-[10px] tabular-nums w-[60px] text-right shrink-0">
          {ticket.created_at && formatDistanceToNow(new Date(ticket.created_at), { addSuffix: false })}
        </span>
      )}

      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-700 opacity-0 transition-opacity group-hover/row:opacity-100" />

      {/* One-shot acknowledgement of a recorded queue change. It is an overlay
          rather than a class on the row so no entrance animation restarts. */}
      {recentlyChanged && <span className="nx-queue-row-flash" aria-hidden="true" data-testid={`ticket-row-changed-${ticket.id}`} />}
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
        className="w-full flex items-center gap-2 border-y border-white/[0.05] bg-white/[0.018] px-3 py-2 hover:bg-white/[0.04] transition-colors sticky top-0 backdrop-blur-sm z-10"
      >
        <span className={`flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.04] ${toneMap[tone]}`}>{open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</span>
        <span className={`text-[10px] uppercase tracking-[0.16em] font-mono font-semibold ${toneMap[tone]}`}>{title}</span>
        <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[9px] font-mono text-zinc-500 tabular-nums">{count}</span>
        <span className="ml-auto text-[9px] uppercase tracking-[0.12em] text-zinc-600">{open ? "Collapse" : "Expand"}</span>
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
  const densityLabel = {
    compact: "Compact",
    comfortable: "Comfortable",
    spacious: "Spacious",
  }[density] || "Comfortable";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-[10px] font-mono uppercase tracking-wider text-zinc-400 hover:text-zinc-100 hover:bg-white/5" data-testid="density-toggle">
          <Layers className="w-3 h-3 mr-1" />Density: {densityLabel}
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
