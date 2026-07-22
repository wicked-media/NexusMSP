import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Activity, BellRing, CheckCircle2, ChevronRight, ClipboardCheck, HardDrive, Mail, ReceiptText, Ticket, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const TYPE_META = {
  ticket: { label: "Ticket", icon: Ticket, tone: "border-indigo-400/25 bg-indigo-400/10 text-indigo-200" },
  invoice: { label: "Invoice", icon: ReceiptText, tone: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" },
  email: { label: "Correspondence", icon: Mail, tone: "border-sky-400/25 bg-sky-400/10 text-sky-200" },
  change: { label: "Change", icon: ClipboardCheck, tone: "border-amber-400/25 bg-amber-400/10 text-amber-200" },
  audit: { label: "Audit", icon: ClipboardCheck, tone: "border-violet-400/25 bg-violet-400/10 text-violet-200" },
  time_entry: { label: "Time", icon: Timer, tone: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200" },
  device_activity: { label: "Asset", icon: HardDrive, tone: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200" },
  device_event: { label: "Asset signal", icon: Activity, tone: "border-rose-400/25 bg-rose-400/10 text-rose-200" },
  client_activity: { label: "Account", icon: BellRing, tone: "border-zinc-400/25 bg-zinc-400/10 text-zinc-200" },
};

const readable = (value) => String(value || "recorded").replaceAll("_", " ");
const displayText = (value) => String(value || "")
  .replace(/\u00c3\u201a\u00c2\u00b7/g, "·")
  .replace(/\u00c2\u00b7/g, "·")
  .replace(/\u00e2\u20ac\u201d/g, "—")
  .replace(/\u00e2\u20ac\u00a6/g, "…");
const timestamp = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? formatDistanceToNow(date, { addSuffix: true }) : "Time not recorded";
};

function ActivityBody({ event, compact }) {
  const meta = TYPE_META[event.type] || { label: "Activity", icon: Activity, tone: "border-zinc-400/25 bg-zinc-400/10 text-zinc-200" };
  const Icon = meta.icon;
  const content = <div className={`group flex gap-3 rounded-xl border border-border/70 bg-card/45 p-3 transition ${event.route ? "hover:border-primary/35 hover:bg-muted/30" : ""}`}>
    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${meta.tone}`}><Icon className="h-4 w-4" /></span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={`h-5 px-1.5 text-[9px] uppercase tracking-wide ${meta.tone}`}>{meta.label}</Badge>{event.status && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{readable(event.status)}</span>}</div>
      <p className="mt-1.5 text-sm font-medium leading-snug text-foreground">{displayText(event.title) || "Recorded activity"}</p>
      {!compact && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{event.actor && <span>by {displayText(event.actor)}</span>}{event.device_name && <span>Asset: {displayText(event.device_name)}</span>}{event.recipient && <span>To: {displayText(event.recipient)}</span>}{event.amount != null && <span>${Number(event.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}{event.minutes != null && <span>{event.minutes} min logged</span>}</div>}
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1"><span className="whitespace-nowrap text-[10px] text-muted-foreground">{timestamp(event.timestamp)}</span>{event.route && <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" />}</div>
  </div>;
  return event.route ? <Link to={event.route} className="block focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background rounded-xl">{content}</Link> : content;
}

export default function ClientActivityFeed({ activity = [], limit = 50, compact = false, title = "Client activity", description = "Recorded operational activity, correspondence, and governance evidence." }) {
  const rows = activity.slice(0, limit);
  return <section className="overflow-hidden rounded-2xl border border-border bg-card/30" data-testid="client-activity-feed">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3"><div><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/20 bg-primary/10"><Activity className="h-3.5 w-3.5 text-primary" /></span><p className="text-sm font-semibold">{title}</p></div>{!compact && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}</div><Badge variant="outline" className="text-[10px]">{rows.length} recorded</Badge></div>
    <div className={`space-y-2 p-3 ${compact ? "max-h-[420px] overflow-y-auto" : ""}`}>{rows.length ? rows.map((event, index) => <ActivityBody key={`${event.type}-${event.id || index}-${event.timestamp || ""}`} event={event} compact={compact} />) : <div className="py-10 text-center"><CheckCircle2 className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-2 text-sm font-medium">No activity has been recorded</p><p className="mt-1 text-xs text-muted-foreground">Tickets, correspondence, billing, asset evidence, and audited actions will appear here as they are recorded.</p></div>}</div>
  </section>;
}
