import { format } from "date-fns";
import { CheckCircle2, ChevronDown, Clock3, FileText, MonitorCheck, Tag, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildTicketRequestRecord } from "@/lib/ticketRequestRecord";

function RecordFact({ icon: Icon, label, value, title }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-500">
        <Icon className="h-3 w-3 text-cyan-300/80" />
        {label}
      </p>
      <p className="mt-1 truncate text-xs font-medium text-zinc-200" title={title || value}>{value}</p>
    </div>
  );
}

export default function TicketRequestRecord({
  ticket,
  deviceStatus,
  tagInput,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
  ticketCompleted,
  slaHours,
}) {
  const record = buildTicketRequestRecord(ticket, deviceStatus);
  const requesterLabel = record.requester?.name || record.requester?.email || "Not recorded";
  const requesterTitle = record.requester?.name && record.requester?.email
    ? `${record.requester.name} · ${record.requester.email}`
    : requesterLabel;
  const capturedLabel = record.capturedAt ? format(record.capturedAt, "d MMM · h:mm a") : "Not recorded";
  const description = record.description || "No request details have been recorded yet.";
  const hasFullRequest = description.length > 280;
  const isUrgent = !ticketCompleted && slaHours !== null && slaHours < 2;
  const slaTone = ticketCompleted
    ? "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-200"
    : slaHours === null
      ? "border-white/[0.07] bg-black/10 text-zinc-400"
      : slaHours < 2
        ? "border-rose-500/25 bg-rose-500/[0.08] text-rose-200"
        : slaHours < 8
          ? "border-amber-500/25 bg-amber-500/[0.08] text-amber-100"
          : "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-200";
  const slaLabel = ticketCompleted
    ? "Service record completed · SLA timing remains in the audit trail"
    : slaHours === null
      ? "SLA target is not recorded"
      : slaHours > 0
        ? `${slaHours}h remaining to the recorded SLA target`
        : `Overdue by ${Math.abs(slaHours)}h against the recorded SLA target`;
  const progress = slaHours === null ? null : Math.max(5, Math.min(100, (1 - slaHours / 24) * 100));

  return (
    <Card className="relative overflow-hidden rounded-2xl border border-cyan-400/15 bg-[radial-gradient(circle_at_86%_0%,rgba(34,211,238,0.10),transparent_34%),linear-gradient(135deg,rgba(10,20,38,0.97),rgba(7,11,21,0.95))] shadow-[0_18px_45px_rgba(0,0,0,0.16)]" data-testid="ticket-request-record">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
      <CardContent className="relative p-0">
        <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-400/[0.09] shadow-[0_8px_24px_rgba(34,211,238,0.12)]">
              <FileText className="h-4 w-4 text-cyan-200" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Request record</p>
              <h2 className="mt-0.5 text-sm font-semibold text-zinc-50">Original request</h2>
              <p className="mt-0.5 text-xs text-zinc-400">Recorded intake shown separately from technician judgement and work history.</p>
            </div>
          </div>
          <Badge className="w-fit border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.13em] text-emerald-200">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Recorded intake
          </Badge>
        </div>

        <div className="grid gap-2 border-b border-white/[0.07] px-4 py-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Original request facts">
          <RecordFact icon={FileText} label="Received via" value={record.source || "Not recorded"} />
          <RecordFact icon={UserRound} label="Requester" value={requesterLabel} title={requesterTitle} />
          <RecordFact icon={MonitorCheck} label="Affected endpoint" value={record.deviceName || "Not linked"} />
          <RecordFact icon={Clock3} label="Captured" value={capturedLabel} title={record.capturedAt?.toLocaleString()} />
        </div>

        <div className="px-4 py-3.5">
          <div className="rounded-xl border border-white/[0.07] bg-black/15 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Verbatim request</p>
              <span className="text-[10px] text-zinc-500">Source content is not rewritten here</span>
            </div>
            <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200 ${hasFullRequest ? "line-clamp-3" : ""}`}>{description}</p>
            {hasFullRequest && (
              <details className="group mt-2.5">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-cyan-200 outline-none transition-colors hover:text-cyan-100 focus-visible:text-cyan-100">
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                  Read the complete original request
                </summary>
                <p className="mt-2 whitespace-pre-wrap border-l border-cyan-300/25 pl-3 text-sm leading-6 text-zinc-300">{description}</p>
              </details>
            )}
          </div>

          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 flex-1">
              <label htmlFor="ticket-request-tag" className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-500">
                <Tag className="h-3 w-3 text-zinc-500" /> Case labels
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {(ticket.tags || []).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onRemoveTag(tag)}
                    className="group inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.045] px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-rose-400/30 hover:bg-rose-400/[0.08] hover:text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
                    aria-label={`Remove ${tag} label`}
                    title="Remove label"
                  >
                    {tag}
                    <span aria-hidden="true" className="text-zinc-500 transition-colors group-hover:text-rose-200">×</span>
                  </button>
                ))}
                <div className="flex items-center gap-1">
                  <Input
                    id="ticket-request-tag"
                    className="h-7 w-28 border-white/[0.08] bg-black/20 px-2 text-[11px]"
                    placeholder="Add label"
                    value={tagInput}
                    onChange={(event) => onTagInputChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onAddTag();
                      }
                    }}
                    data-testid="tag-input"
                  />
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-cyan-200 hover:bg-cyan-400/[0.08] hover:text-cyan-100" disabled={!tagInput.trim()} onClick={onAddTag}>
                    Add
                  </Button>
                </div>
              </div>
            </div>

            <div className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs ${slaTone}`} data-testid="ticket-request-sla">
              <Clock3 className={`h-3.5 w-3.5 shrink-0 ${isUrgent ? "animate-pulse" : ""}`} />
              <span className="min-w-0 leading-4">{slaLabel}</span>
              {progress !== null && (
                <span className="ml-1 hidden h-1.5 w-20 overflow-hidden rounded-full bg-black/20 sm:block" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="SLA allowance used">
                  <span className={`block h-full rounded-full ${slaHours < 2 ? "bg-rose-400" : slaHours < 8 ? "bg-amber-300" : "bg-emerald-300"}`} style={{ width: `${progress}%` }} />
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
