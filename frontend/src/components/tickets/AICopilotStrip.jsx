import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Zap, RefreshCw, ArrowRight, Clock3, UserRoundCheck, ShieldAlert } from "lucide-react";
import { differenceInHours, formatDistanceToNowStrict } from "date-fns";
import { API } from "@/App";

/**
 * AI Co-Pilot Strip — Linear/Plain-style banner at the top of a ticket detail.
 *
 * Renders a single line that summarises the situation + suggests the *next*
 * action a tech should take. Pure presentational; opens the detail tabs
 * (or fires actions) via the provided handlers.
 *
 * Heuristics-first (zero-cost): age, SLA, blocker, device telemetry hooks,
 * patches, status. The opt-in briefing is server-built from authorised ticket
 * evidence, including recorded conversation and activity.
 */
export default function AICopilotStrip({ ticket, deviceStatus, headers, onActionClick }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [burndown, setBurndown] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const summaryRequest = useRef(0);
  const sourceVersion = JSON.stringify([ticket.id, ticket.title, ticket.description, ticket.updated_at, ticket.note_count]);
  const summaryStale = summary && summary.sourceVersion !== sourceVersion;
  useEffect(() => {
    summaryRequest.current += 1;
    setSummary(null);
    setSummaryError("");
    setLoading(false);
    setBurndown(null);
    return () => { summaryRequest.current += 1; };
  }, [ticket.id]);
  const deviceState = typeof deviceStatus?.status === "string" ? deviceStatus.status.toLowerCase() : null;

  useEffect(() => {
    if (!ticket?.id) return;
    let alive = true;
    axios.get(`${API}/tickets/${ticket.id}/burndown`, { headers })
      .then(r => alive && setBurndown(r.data))
      .catch(() => {});
    return () => { alive = false; };
  }, [ticket?.id, headers]);

  const generateSummary = async () => {
    const requestId = ++summaryRequest.current;
    setLoading(true);
    setSummaryError("");
    try {
      const r = await axios.post(`${API}/tickets/${ticket.id}/case-briefing`, {}, { headers });
      const d = r.data || {};
      const text = typeof d === "string" ? d : (d.summary || null);
      if (requestId !== summaryRequest.current) return;
      if (typeof text === "string" && text.trim()) setSummary({ text: text.trim(), source: d.source || {}, mode: d.mode || "ai", sourceVersion, generatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
      else setSummaryError("No case brief was returned. The recorded ticket history remains available.");
    } catch (error) { if (requestId === summaryRequest.current) setSummaryError(error?.response?.data?.detail || "Case briefing unavailable. You can continue working from the recorded ticket history."); }
    finally { if (requestId === summaryRequest.current) setLoading(false); }
  };

  // Heuristic next-best-action. This stays deliberately evidence-led: it
  // describes the operational fact that needs attention, not an AI diagnosis.
  const nextAction = (() => {
    const assignedTechnician = ticket.assignee_id || ticket.assigned_to || ticket.assigned_to_id;
    const isCompleted = ["resolved", "closed"].includes(ticket.status);
    if (ticket.blocked_by_ticket_number) return { label: `Resolve ${ticket.blocked_by_ticket_number} first`, detail: "This work is explicitly blocked by a linked service record.", tone: "rose", target: "blocker" };
    if (isCompleted && !ticket.csat_sent) return { label: "Send CSAT survey", detail: "The service work is complete and client feedback has not been requested.", tone: "emerald", target: "csat" };
    if (isCompleted) return { label: "Review the audit record", detail: "This service record is complete and retained for review.", tone: "emerald", target: "none" };
    if (burndown?.breach) return { label: "Escalate the SLA breach", detail: "The recorded SLA due time has passed.", tone: "rose", target: "escalate" };
    if (burndown?.pct >= 75 && !burndown?.is_resolved) return { label: "Pick this up now", detail: `${burndown.pct}% of the recorded SLA allowance has been used.`, tone: "amber", target: "ack" };
    if (deviceState && deviceState !== "online") return { label: "Investigate the offline device", detail: "The linked endpoint is not reporting online.", tone: "amber", target: "wol" };
    if (deviceStatus?.needs_reboot) return { label: "Plan the required reboot", detail: "The linked endpoint reports that a reboot is required.", tone: "cyan", target: "reboot" };
    if (deviceStatus?.checks_failing > 0) return { label: "Investigate failing checks", detail: `${deviceStatus.checks_failing} linked endpoint check${deviceStatus.checks_failing === 1 ? " is" : "s are"} failing.`, tone: "amber", target: "checks" };
    if (deviceStatus?.patches_pending > 0) return { label: "Review pending patches", detail: `${deviceStatus.patches_pending} patch${deviceStatus.patches_pending === 1 ? " is" : "es are"} pending on the linked endpoint.`, tone: "cyan", target: "patches" };
    if (!assignedTechnician) return { label: "Set an accountable technician", detail: "No technician owns the next move on this ticket yet.", tone: "violet", target: "assign" };
    if (ticket.status === "open") return { label: "Send the first client update", detail: "The ticket is open and has an accountable technician.", tone: "violet", target: "reply" };
    if (ticket.status === "in_progress" && ticket.note_count === 0) return { label: "Record the first work update", detail: "Work is in progress, but no technician update is recorded yet.", tone: "violet", target: "note" };
    return { label: "Review the conversation and continue", detail: "The current service record needs the technician’s next documented action.", tone: "cyan", target: "reply" };
  })();

  const toneStyle = {
    rose:    { bar: "from-rose-500/20 to-rose-500/0",       chip: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
    amber:   { bar: "from-amber-500/20 to-amber-500/0",     chip: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    cyan:    { bar: "from-cyan-500/20 to-cyan-500/0",       chip: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
    violet:  { bar: "from-violet-500/20 to-violet-500/0",   chip: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
    emerald: { bar: "from-emerald-500/20 to-emerald-500/0", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  }[nextAction.tone];

  const createdAt = ticket.created_at ? new Date(ticket.created_at) : null;
  const hasCreatedAt = createdAt && Number.isFinite(createdAt.getTime());
  const ageHours = hasCreatedAt ? Math.max(0, differenceInHours(new Date(), createdAt)) : null;
  const ageLabel = ageHours == null ? "" : ageHours < 24 ? `${ageHours}h old` : `${Math.round(ageHours / 24)}d old`;
  const assignedTechnician = ticket.assigned_to_name || ticket.assignee_name || ticket.assigned_name || ticket.assigned_to_display_name || (ticket.assigned_to ? "Assigned" : null);
  const activityAt = ticket.last_activity_at || ticket.updated_at || ticket.created_at;
  const activityDate = activityAt ? new Date(activityAt) : null;
  const hasActivityDate = activityDate && Number.isFinite(activityDate.getTime());
  const activityLabel = hasActivityDate ? formatDistanceToNowStrict(activityDate, { addSuffix: true }) : "No recorded activity";
  const slaLabel = burndown?.available ? `${burndown.pct}% used` : "No SLA target";
  const slaTone = burndown?.breach ? "text-rose-300" : burndown?.pct >= 75 ? "text-amber-300" : "text-zinc-200";

  return (
    <section data-testid="ai-copilot-strip" className={`relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-r ${toneStyle.bar}`} aria-label="Nexus case briefing">
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-violet-300 via-cyan-300 to-transparent opacity-80" />
      <div className="relative grid gap-3 px-4 py-3.5 xl:grid-cols-[minmax(170px,0.72fr)_minmax(260px,1.3fr)_minmax(310px,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-violet-300/20 bg-gradient-to-br from-violet-500/25 to-cyan-500/20 shadow-[0_8px_18px_rgba(139,92,246,0.16)]">
            <Sparkles className="h-3.5 w-3.5 text-violet-200" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200">Nexus case briefing</p>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">{ageLabel ? `${ageLabel} · ` : ""}facts first, judgement stays human</p>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-500"><Zap className="h-3 w-3 text-violet-300" />Recommended next move</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              disabled={nextAction.target === "none"}
              onClick={() => onActionClick?.(nextAction.target)}
              className={`group/cta inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${toneStyle.chip} transition-[transform,background-color] hover:scale-[1.01] disabled:cursor-default disabled:hover:scale-100`}
              data-testid={`copilot-action-${nextAction.target}`}
            >
              <span className="truncate">{nextAction.label}</span>
              {nextAction.target !== "none" && <ArrowRight className="h-3 w-3 shrink-0 opacity-55 transition-transform group-hover/cta:translate-x-0.5" />}
            </button>
            <span className="min-w-0 text-[11px] leading-4 text-zinc-400">{nextAction.detail}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5" data-testid="copilot-operational-signals">
          <div className="min-w-0 rounded-lg border border-white/[0.06] bg-black/10 px-2.5 py-2">
            <p className="flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-zinc-600"><UserRoundCheck className="h-2.5 w-2.5" />Owner</p>
            <p className={`mt-1 truncate text-[10px] font-medium ${assignedTechnician ? "text-zinc-200" : "text-violet-200"}`}>{assignedTechnician || "Unassigned"}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-white/[0.06] bg-black/10 px-2.5 py-2">
            <p className="flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-zinc-600"><ShieldAlert className="h-2.5 w-2.5" />Service level</p>
            <p className={`mt-1 truncate text-[10px] font-medium ${slaTone}`} data-testid="copilot-sla">{slaLabel}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-white/[0.06] bg-black/10 px-2.5 py-2">
            <p className="flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-zinc-600"><Clock3 className="h-2.5 w-2.5" />Latest signal</p>
            <p className="mt-1 truncate text-[10px] font-medium text-zinc-200" title={hasActivityDate ? activityDate.toLocaleString() : undefined}>{activityLabel}</p>
          </div>
        </div>

        <Button
          variant="ghost" size="sm" className="h-8 shrink-0 justify-self-start px-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-400 hover:bg-violet-500/10 hover:text-violet-200 xl:justify-self-end"
          onClick={generateSummary} disabled={loading}
          data-testid="copilot-summarize"
        >
          {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : summary ? <RefreshCw className="mr-1 h-3 w-3" /> : <Sparkles className="mr-1 h-3 w-3" />}
          {summary ? "Refresh brief" : "Summarise"}
        </Button>
      </div>
      {(summary || summaryError || summaryStale) && (
        <div className="relative space-y-2 border-t border-white/[0.06] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{summary ? `${summary.mode === "ai" ? "AI case brief" : "Evidence case brief · AI unavailable"} · generated ${summary.generatedAt}` : "Case briefing unavailable. The recorded ticket history remains the source of truth."}</span>
            {summaryStale && <span role="status" className="text-amber-300">Ticket changed · refresh this brief</span>}
          </div>
          {summary && <><p className="whitespace-pre-wrap text-sm leading-6 text-foreground" data-testid="copilot-summary">{summary.text}</p><p className="text-xs text-muted-foreground">Source: ticket record, {summary.source?.conversation_entries ?? 0} recorded conversation update{summary.source?.conversation_entries === 1 ? "" : "s"}, and {summary.source?.activity_entries ?? 0} activity event{summary.source?.activity_entries === 1 ? "" : "s"}. Review before acting{summary.source?.limited ? "; the evidence window was capped." : "."}</p><details className="text-xs"><summary className="cursor-pointer text-cyan-300">View recorded request</summary><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{ticket.title}{"\n"}{ticket.description || "No request description recorded."}</p></details></>}
          {summaryError && <p role="status" className="text-xs text-amber-300">{summaryError}</p>}
        </div>
      )}
    </section>
  );
}
