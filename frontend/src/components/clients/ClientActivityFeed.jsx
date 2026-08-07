import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, formatDistanceToNow, isSameDay } from "date-fns";
import {
  Activity,
  BellRing,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileText,
  HardDrive,
  LifeBuoy,
  Mail,
  MonitorCog,
  Radio,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TYPE_META = {
  ticket: { label: "Service", icon: LifeBuoy, tone: "border-indigo-400/25 bg-indigo-400/10 text-indigo-200" },
  service: { label: "Service", icon: LifeBuoy, tone: "border-indigo-400/25 bg-indigo-400/10 text-indigo-200" },
  communication: { label: "Communication", icon: Mail, tone: "border-sky-400/25 bg-sky-400/10 text-sky-200" },
  email: { label: "Communication", icon: Mail, tone: "border-sky-400/25 bg-sky-400/10 text-sky-200" },
  finance: { label: "Finance", icon: CircleDollarSign, tone: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" },
  invoice: { label: "Finance", icon: ReceiptText, tone: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" },
  time_entry: { label: "Finance", icon: Timer, tone: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" },
  asset: { label: "Assets", icon: HardDrive, tone: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200" },
  device_activity: { label: "Assets", icon: HardDrive, tone: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200" },
  device_event: { label: "Assets", icon: Activity, tone: "border-rose-400/25 bg-rose-400/10 text-rose-200" },
  remote: { label: "Remote", icon: MonitorCog, tone: "border-violet-400/25 bg-violet-400/10 text-violet-200" },
  automation: { label: "Automation", icon: Bot, tone: "border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-200" },
  backup: { label: "Backups", icon: ShieldCheck, tone: "border-amber-400/25 bg-amber-400/10 text-amber-200" },
  documentation: { label: "Docs", icon: FileText, tone: "border-teal-400/25 bg-teal-400/10 text-teal-200" },
  governance: { label: "Governance", icon: ClipboardCheck, tone: "border-orange-400/25 bg-orange-400/10 text-orange-200" },
  change: { label: "Governance", icon: ClipboardCheck, tone: "border-orange-400/25 bg-orange-400/10 text-orange-200" },
  audit: { label: "Governance", icon: ClipboardCheck, tone: "border-orange-400/25 bg-orange-400/10 text-orange-200" },
  platform: { label: "Platform", icon: Radio, tone: "border-zinc-400/25 bg-zinc-400/10 text-zinc-200" },
  client_activity: { label: "Account", icon: BellRing, tone: "border-zinc-400/25 bg-zinc-400/10 text-zinc-200" },
};

const readable = (value) => String(value || "recorded").replaceAll("_", " ");
const displayText = (value) => String(value || "")
  .replaceAll("Ã‚Â·", "·")
  .replaceAll("Â·", "·")
  .replaceAll("â€”", "—")
  .replaceAll("â€¦", "…")
  .replaceAll("â†’", "→");

const parseDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date : null;
};

const relativeTime = (value) => {
  const date = parseDate(value);
  return date ? formatDistanceToNow(date, { addSuffix: true }) : "Time not recorded";
};

function EventRow({ event, onBefore, allowBefore = true }) {
  const meta = TYPE_META[event.category] || TYPE_META[event.type] || {
    label: "Activity",
    icon: Activity,
    tone: "border-zinc-400/25 bg-zinc-400/10 text-zinc-200",
  };
  const Icon = meta.icon;
  const occurredAt = parseDate(event.timestamp);
  const evidence = event.evidence || {};
  const minutes = evidence.minutes ?? event.minutes;

  return (
    <article className="group relative grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 rounded-xl border border-border/65 bg-background/25 p-3 transition hover:border-primary/25 hover:bg-muted/20" data-testid={`timeline-event-${event.id}`}>
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${meta.tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={`h-5 px-1.5 text-[9px] uppercase tracking-wide ${meta.tone}`}>{meta.label}</Badge>
          <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{displayText(event.source)}</span>
          {event.status && <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">· {readable(event.status)}</span>}
        </div>
        {event.route ? (
          <Link to={event.route} className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium leading-snug text-foreground transition hover:text-primary">
            {displayText(event.title) || "Recorded activity"}
            <ChevronRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
          </Link>
        ) : (
          <p className="mt-1.5 text-sm font-medium leading-snug text-foreground">{displayText(event.title) || "Recorded activity"}</p>
        )}
        {event.detail && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{displayText(event.detail)}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {event.actor && <span>by {displayText(event.actor)}</span>}
          {event.device_name && <span>Asset: {displayText(event.device_name)}</span>}
          {event.recipient && <span>To: {displayText(event.recipient)}</span>}
          {event.amount != null && <span>${Number(event.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}
          {minutes != null && <span>{minutes} min</span>}
          {evidence.correlation_id && <span className="font-mono">Trace {String(evidence.correlation_id).slice(0, 8)}</span>}
        </div>
      </div>
      <div className="flex min-w-[92px] shrink-0 flex-col items-end gap-1.5 text-right">
        <span className="text-[10px] font-medium text-muted-foreground">{relativeTime(event.timestamp)}</span>
        {occurredAt && <span className="text-[9px] text-muted-foreground/70">{format(occurredAt, "h:mm a")}</span>}
        {occurredAt && allowBefore && (
          <button type="button" onClick={() => onBefore(event)} className="mt-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] text-muted-foreground opacity-0 transition hover:bg-primary/10 hover:text-primary focus:opacity-100 group-hover:opacity-100">
            <Clock3 className="h-3 w-3" />Before this
          </button>
        )}
      </div>
    </article>
  );
}

export default function ClientActivityFeed({
  activity = [],
  limit = 200,
  compact = false,
  title = "Nexus Timeline",
  description = "Everything attributable to this client, ordered from persisted source evidence.",
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [beforeEvent, setBeforeEvent] = useState(null);

  const categoryCounts = useMemo(
    () => activity.reduce((counts, event) => {
      const key = event.category || event.type || "platform";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    [activity],
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const beforeDate = parseDate(beforeEvent?.timestamp);
    return activity
      .filter((event) => category === "all" || (event.category || event.type) === category)
      .filter((event) => !beforeDate || (parseDate(event.timestamp)?.valueOf() || 0) < beforeDate.valueOf())
      .filter((event) => {
        if (!needle) return true;
        return [event.title, event.detail, event.source, event.actor, event.status]
          .some((value) => String(value || "").toLowerCase().includes(needle));
      })
      .slice(0, limit);
  }, [activity, beforeEvent, category, limit, search]);

  const grouped = useMemo(() => rows.reduce((groups, event) => {
    const occurredAt = parseDate(event.timestamp);
    const last = groups[groups.length - 1];
    if (!last || !occurredAt || !isSameDay(last.date, occurredAt)) {
      groups.push({ date: occurredAt || new Date(0), events: [event] });
    } else {
      last.events.push(event);
    }
    return groups;
  }, []), [rows]);

  if (compact) {
    return (
      <section className="overflow-hidden rounded-2xl border border-border bg-card/30" data-testid="client-activity-feed">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/20 bg-primary/10"><Activity className="h-3.5 w-3.5 text-primary" /></span>
              <p className="text-sm font-semibold">{title}</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <Badge variant="outline" className="text-[10px]">{rows.length} recorded</Badge>
        </div>
        <div className="max-h-[420px] space-y-2 overflow-y-auto p-3">
          {rows.length ? rows.map((event) => <EventRow key={`${event.id}-${event.timestamp}`} event={event} onBefore={setBeforeEvent} allowBefore={false} />) : (
            <div className="py-10 text-center"><CheckCircle2 className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-2 text-sm font-medium">No activity has been recorded</p></div>
          )}
        </div>
      </section>
    );
  }

  const categories = Object.entries(categoryCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 9);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.06),transparent_30%),rgba(16,18,23,0.72)] shadow-[0_18px_50px_rgba(0,0,0,0.16)]" data-testid="client-activity-feed">
      <header className="border-b border-border/80 px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <Activity className="h-5 w-5 text-primary" />
            </span>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-primary">Universal client evidence</p>
              <h3 className="mt-0.5 text-base font-semibold">{title}</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-primary/20 bg-primary/[0.05] text-[10px]">{rows.length} shown</Badge>
            <Badge variant="outline" className="text-[10px]">{activity.length} evidence records</Badge>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 pl-9 text-xs" placeholder="Search activity, people, assets, invoices, automation…" data-testid="timeline-search" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant={category === "all" ? "default" : "outline"} className="h-8 px-2.5 text-[10px]" onClick={() => setCategory("all")}>All {activity.length}</Button>
            {categories.map(([key, count]) => {
              const meta = TYPE_META[key] || TYPE_META.platform;
              return <Button key={key} type="button" size="sm" variant={category === key ? "default" : "outline"} className="h-8 px-2.5 text-[10px]" onClick={() => setCategory(key)}>{meta.label} {count}</Button>;
            })}
          </div>
        </div>

        {beforeEvent && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/15 bg-amber-400/[0.04] px-3 py-2">
            <span className="flex items-center gap-2 text-[10px] text-amber-100">
              <SlidersHorizontal className="h-3.5 w-3.5 text-amber-300" />
              Showing evidence before “{displayText(beforeEvent.title)}” at {format(parseDate(beforeEvent.timestamp), "PPp")}
            </span>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => setBeforeEvent(null)}>Clear context</Button>
          </div>
        )}
      </header>

      <div className="p-3 md:p-4">
        {grouped.length ? grouped.map((group, index) => (
          <div key={`${group.date.toISOString()}-${index}`} className="relative pb-4 last:pb-0">
            <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 bg-card/90 py-1 backdrop-blur">
              <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {group.date.valueOf() ? format(group.date, "EEEE, d MMMM yyyy") : "Recorded activity"}
              </span>
              <span className="h-px flex-1 bg-border/70" />
              <span className="text-[9px] text-muted-foreground">{group.events.length} event{group.events.length === 1 ? "" : "s"}</span>
            </div>
            <div className="space-y-2">
              {group.events.map((event) => <EventRow key={`${event.id}-${event.timestamp}`} event={event} onBefore={setBeforeEvent} />)}
            </div>
          </div>
        )) : (
          <div className="py-14 text-center">
            <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-300" />
            <p className="mt-2 text-sm font-medium">No matching evidence</p>
            <p className="mt-1 text-xs text-muted-foreground">Clear the current filters or choose another point in the timeline.</p>
          </div>
        )}
        <div className="mt-4 rounded-xl border border-border/60 bg-background/25 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
          Every row comes from a persisted Nexus source record. Events appearing close together are context for investigation, not proof that one caused another.
        </div>
      </div>
    </section>
  );
}
