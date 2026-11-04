import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import NextBestActionPanel from "@/components/workflow/NextBestActionPanel";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  History,
  Laptop,
  Loader2,
  MonitorUp,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";

const emptyDraft = {
  minutes: "",
  technical_notes: "",
  customer_summary: "",
  documentation_suggestion: "",
  recurrence_check: "",
  billing_classification: "",
  billable: true,
  verified: false,
  commercial_reviewed: false,
};

const classificationOptions = [
  { value: "included", label: "Included in agreement" },
  { value: "billable", label: "Billable work" },
  { value: "project", label: "Project delivery" },
  { value: "approval_required", label: "Approval required" },
  { value: "review", label: "Needs commercial review" },
];

const cleanText = (value) => String(value || "").trim();

const preventionIdempotencyKey = () => {
  const random = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `work-session-prevention:${random}`;
};

function formatDateTime(value) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Time unavailable" : date.toLocaleString();
}

function ticketLabel(ticket) {
  const reference = ticket?.ticket_number || ticket?.id?.slice(0, 8) || "Ticket";
  return `${reference} · ${ticket?.title || "Untitled ticket"}`;
}

function CompletionItem({ complete, label, detail, optional = false }) {
  return (
    <div
      className={`flex gap-3 rounded-xl border p-3 transition-colors ${complete ? "border-emerald-400/25 bg-emerald-400/[0.06]" : "border-border/70 bg-muted/[0.10]"}`}
      data-state={complete ? "complete" : "pending"}
    >
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${complete ? "border-emerald-300/45 bg-emerald-400/15 text-emerald-200" : "border-muted-foreground/35 text-muted-foreground"}`}>
        {complete ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <span className="text-[10px]" aria-hidden="true">{optional ? "○" : "!"}</span>}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}{optional && <span className="ml-1 text-xs font-normal text-muted-foreground">optional</span>}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{detail}</span>
      </span>
    </div>
  );
}

function ContextSignal({ title, detail, icon: Icon, tone = "cyan" }) {
  const toneClasses = {
    cyan: "border-cyan-400/20 bg-cyan-400/[0.05] text-cyan-200",
    violet: "border-violet-400/20 bg-violet-400/[0.05] text-violet-200",
    amber: "border-amber-400/20 bg-amber-400/[0.05] text-amber-200",
  };
  return (
    <div className={`rounded-xl border p-3 ${toneClasses[tone] || toneClasses.cyan}`}>
      <Icon className="mb-2 h-4 w-4" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function WorkSessionPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [params, setParams] = useSearchParams();
  const [tickets, setTickets] = useState([]);
  const [brief, setBrief] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [completedRecord, setCompletedRecord] = useState(null);
  const [preventionDialogOpen, setPreventionDialogOpen] = useState(false);
  const [preventionBusy, setPreventionBusy] = useState(false);
  const [preventionFollowUp, setPreventionFollowUp] = useState(null);
  const [preventionKey, setPreventionKey] = useState("");
  const [preventionForm, setPreventionForm] = useState({ title: "", summary: "", recurrence_evidence: "", priority: "medium" });
  const [nowTick, setNowTick] = useState(() => Date.now());
  const ticketId = params.get("ticket") || "";

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [ticketResponse, briefResponse] = await Promise.all([
        axios.get(`${API}/tickets`, { headers }),
        ticketId ? axios.get(`${API}/work-sessions/tickets/${ticketId}`, { headers }) : Promise.resolve({ data: null }),
      ]);
      setTickets(Array.isArray(ticketResponse.data) ? ticketResponse.data : []);
      setBrief(briefResponse.data || null);
    } catch (error) {
      setBrief(null);
      setLoadError(error.response?.data?.detail || "Work context could not be loaded. Your ticket and outcome data were not changed.");
    } finally {
      setLoading(false);
    }
  }, [headers, ticketId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setDraft(emptyDraft);
    setCompletedRecord(null);
  }, [ticketId]);

  useEffect(() => {
    if (!brief?.active_session?.started_at) return undefined;
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [brief?.active_session?.started_at]);

  const elapsedMinutes = useMemo(() => {
    const startedAt = Date.parse(brief?.active_session?.started_at || "");
    if (Number.isNaN(startedAt)) return null;
    return Math.max(0, Math.floor((nowTick - startedAt) / 60_000));
  }, [brief?.active_session?.started_at, nowTick]);

  const elapsed = useMemo(() => {
    if (elapsedMinutes == null) return null;
    const hours = Math.floor(elapsedMinutes / 60);
    return hours ? `${hours}h ${elapsedMinutes % 60}m` : `${elapsedMinutes}m`;
  }, [elapsedMinutes]);

  const context = brief?.context || {};
  const diagnosticScope = Array.isArray(context.diagnostic_scope) ? context.diagnostic_scope : [];
  const recentChanges = Array.isArray(context.recent_changes) ? context.recent_changes : [];
  const scopeGuardian = brief?.scope_guardian || {};
  const completionAssist = brief?.completion_assist || {};
  const assistDrafts = completionAssist?.drafts || {};
  const assistEvidence = Array.isArray(completionAssist?.evidence) ? completionAssist.evidence : [];
  const recommendedClassification = draft.billing_classification || scopeGuardian.recommended_classification || "review";
  const activeSession = brief?.active_session;
  const selectedTicket = brief?.ticket;
  const hasTime = Number(draft.minutes) >= 1;
  const hasTechnicalNotes = Boolean(cleanText(draft.technical_notes));
  const hasCustomerSummary = Boolean(cleanText(draft.customer_summary));
  const hasDocumentation = Boolean(cleanText(draft.documentation_suggestion));
  const hasPrevention = Boolean(cleanText(draft.recurrence_check));
  const requiredReviewItems = [hasTime, hasTechnicalNotes, hasCustomerSummary, draft.commercial_reviewed];
  const reviewProgress = requiredReviewItems.filter(Boolean).length;
  const canComplete = Boolean(activeSession) && requiredReviewItems.every(Boolean);

  const updateDraft = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const appendTemplate = (field, template) => {
    setDraft((current) => {
      const currentValue = cleanText(current[field]);
      return { ...current, [field]: currentValue ? `${currentValue}\n\n${template}` : template };
    });
  };

  const applyCompletionAssist = () => {
    const fields = ["technical_notes", "customer_summary", "documentation_suggestion", "recurrence_check"];
    const eligible = fields.filter((field) => !cleanText(draft[field]) && cleanText(assistDrafts[field]));
    if (!eligible.length) {
      toast.message("Your review fields already contain text. Nexus did not overwrite any technician input.");
      return;
    }
    setDraft((current) => {
      const prepared = Object.fromEntries(eligible.map((field) => [field, assistDrafts[field]]));
      return { ...current, ...prepared };
    });
    toast.success(`Prepared ${eligible.length} review field${eligible.length === 1 ? "" : "s"} from retained ticket context.`);
  };

  const completedWorkSessionId = completedRecord?.work_session_id || "";

  const openPreventionReview = () => {
    if (!completedWorkSessionId) {
      toast.error("Complete the Work Session before proposing prevention follow-up.");
      return;
    }
    setPreventionForm({
      title: `Prevent recurrence: ${selectedTicket?.title || "ticket condition"}`.slice(0, 180),
      summary: "Review the recorded condition and decide whether a governed follow-up is justified. No remediation will run from this proposal.",
      recurrence_evidence: completedRecord?.outcome?.recurrence_check || draft.recurrence_check || "",
      priority: "medium",
    });
    setPreventionKey(preventionIdempotencyKey());
    setPreventionDialogOpen(true);
  };

  const submitPreventionReview = async () => {
    if (!completedWorkSessionId) return;
    if (!cleanText(preventionForm.title) || !cleanText(preventionForm.summary)) {
      toast.error("Give the prevention review a clear title and evidence summary.");
      return;
    }
    setPreventionBusy(true);
    try {
      const response = await axios.post(
        `${API}/work-sessions/${completedWorkSessionId}/prevention-follow-ups`,
        { ...preventionForm, idempotency_key: preventionKey || preventionIdempotencyKey() },
        { headers },
      );
      setPreventionFollowUp(response.data?.follow_up || null);
      setPreventionDialogOpen(false);
      toast.success(response.data?.idempotent_replay ? "Existing prevention review reopened." : "Prevention review proposed. No remediation was scheduled.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "The prevention review could not be proposed");
    } finally {
      setPreventionBusy(false);
    }
  };

  const selectTicket = (ticket) => setParams(ticket ? { ticket } : {});

  const start = async () => {
    if (!ticketId) return;
    setBusy(true);
    try {
      await axios.post(`${API}/work-sessions/tickets/${ticketId}/start`, {}, { headers });
      setCompletedRecord(null);
      toast.success("Work session started. Nexus is collecting accountable context.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not start work session");
    } finally {
      setBusy(false);
    }
  };

  const useElapsedTime = () => {
    if (elapsedMinutes == null || elapsedMinutes < 1) {
      toast.message("Nexus will suggest time once at least one minute has elapsed.");
      return;
    }
    updateDraft({ minutes: String(elapsedMinutes) });
  };

  const complete = async () => {
    if (!activeSession || !canComplete) {
      toast.error("Review the time, technical outcome, customer update, and commercial classification before recording this pack.");
      return;
    }
    setBusy(true);
    try {
      const billable = ["billable", "project"].includes(recommendedClassification);
      const response = await axios.post(`${API}/work-sessions/${activeSession.id}/complete`, {
        ...draft,
        billing_classification: recommendedClassification,
        billable,
        minutes: Number(draft.minutes),
      }, { headers });
      setCompletedRecord(response.data || { completed_at: new Date().toISOString() });
      toast.success(draft.verified ? "Ticket-to-Outcome pack completed" : "Review pack recorded; verification remains pending");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "The completion pack could not be recorded");
    } finally {
      setBusy(false);
    }
  };

  const technicianTemplate = "Observed:\nWork performed:\nTechnical outcome:\nVerification evidence:";
  const customerTemplate = `Hello,\n\nWe reviewed ${selectedTicket?.title || "this request"}. The current outcome is: [plain-language result].\n\nNext step: [state any follow-up, or confirm completion].`;
  const documentationTemplate = "Update candidate:\nWhat changed or was learned:\nOwner / review date:";
  const preventionTemplate = "Condition reviewed:\nRelated scope checked:\nFollow-up required:";

  return (
    <div className="nx-page-stage space-y-5 p-4 md:p-6" data-testid="work-session-page">
      <OperationalPageHeader
        eyebrow="Technician flow · ticket to outcome"
        title="Nexus Work Session"
        description="Collect accountable context, review a completion pack, and record one clean outcome without sending customer communication or creating remediation automatically."
        icon={Wrench}
        tone="sky"
        signal={activeSession ? "working" : ticketId ? "recommendation" : undefined}
        actions={
          <>
            {selectedTicket && <Button variant="outline" size="sm" asChild><Link to={`/tickets?ticket=${selectedTicket.id}`}><FileText className="mr-1.5 h-4 w-4" />Open ticket</Link></Button>}
            <Button variant="outline" size="sm" onClick={load} disabled={loading || busy} data-testid="work-session-refresh">
              <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh context
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden" data-testid="work-session-ticket-selector">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor="work-session-ticket">Work against a ticket</Label>
            <Select value={ticketId} onValueChange={selectTicket}>
              <SelectTrigger id="work-session-ticket" className="mt-1" data-testid="work-session-ticket-select"><SelectValue placeholder="Choose an active service ticket" /></SelectTrigger>
              <SelectContent>
                {tickets.filter((ticket) => !["resolved", "closed"].includes(String(ticket.status || "").toLowerCase())).map((ticket) => (
                  <SelectItem key={ticket.id} value={ticket.id}>{ticketLabel(ticket)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="max-w-md text-xs leading-5 text-muted-foreground">A work session records evidence and time against the selected ticket. It does not resolve the ticket, send an update, or change a device on its own.</p>
        </CardContent>
      </Card>

      {!ticketId && !loading && (
        <Card className="border-dashed" data-testid="work-session-empty-state">
          <CardContent className="py-20 text-center">
            <Wrench className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
            <p className="font-medium">Select a ticket to begin accountable work.</p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">Nexus will assemble the work context and a reviewable outcome pack. The technician remains the decision maker at every point.</p>
          </CardContent>
        </Card>
      )}

      {loading && ticketId && (
        <Card data-testid="work-session-loading"><CardContent className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin text-cyan-300" />Preparing accountable ticket context…</CardContent></Card>
      )}

      {loadError && (
        <Card className="border-amber-400/30 bg-amber-400/[0.04]" data-testid="work-session-load-error">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" /><div><p className="font-medium">Work context unavailable</p><p className="mt-1 text-sm text-muted-foreground">{loadError}</p></div></div>
            <Button variant="outline" size="sm" onClick={load} data-testid="work-session-retry"><RefreshCw className="mr-1.5 h-4 w-4" />Try again</Button>
          </CardContent>
        </Card>
      )}

      {ticketId && !loading && !loadError && !brief && (
        <Card className="border-dashed"><CardContent className="py-12 text-center"><CircleAlert className="mx-auto mb-3 h-8 w-8 text-amber-300" aria-hidden="true" /><p className="font-medium">No accountable context was returned for this ticket.</p><p className="mt-1 text-sm text-muted-foreground">Refresh the ticket context or choose another active ticket. No changes have been made.</p></CardContent></Card>
      )}

      {ticketId && brief && !loading && !loadError && (
        <>
          <section className="nx-ambient-surface overflow-hidden rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.14),transparent_44%),linear-gradient(135deg,rgba(12,17,27,0.96),rgba(11,20,34,0.88))] p-5 md:p-6" data-nx-signal={activeSession ? "working" : completedRecord ? "healthy" : "recommendation"} data-testid="work-session-ticket-hero">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{selectedTicket?.ticket_number || "Ticket"}</Badge>
                  <Badge variant="outline" className="capitalize">{String(selectedTicket?.status || "open").replaceAll("_", " ")}</Badge>
                  {scopeGuardian.status && <Badge variant="outline" className="border-amber-300/25 bg-amber-400/[0.07] capitalize text-amber-100">{String(scopeGuardian.status).replaceAll("_", " ")}</Badge>}
                </div>
                <h2 className="mt-3 text-xl font-semibold tracking-tight md:text-2xl">{selectedTicket?.title || "Selected service ticket"}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{selectedTicket?.client_name || "Client not recorded"} · {brief.device?.name || brief.device?.hostname || "No linked endpoint"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeSession ? (
                  <Badge className="border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-emerald-100"><Clock3 className="mr-2 h-4 w-4" />Work active{elapsed ? ` · ${elapsed}` : ""}</Badge>
                ) : completedRecord ? (
                  <Badge className="border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-emerald-100"><CheckCircle2 className="mr-2 h-4 w-4" />Outcome recorded</Badge>
                ) : (
                  <Button onClick={start} disabled={busy} data-testid="work-session-start-button"><Play className="mr-2 h-4 w-4" />Start work</Button>
                )}
                {activeSession && context.remote_available && context.device_id && (
                  <Button variant="outline" asChild data-testid="work-session-open-remote"><Link to={`/remote-access?device=${encodeURIComponent(context.device_id)}&ticket=${encodeURIComponent(ticketId)}&workSession=${encodeURIComponent(activeSession.id)}`}><MonitorUp className="mr-2 h-4 w-4" />Open remote</Link></Button>
                )}
              </div>
            </div>
            <div className="mt-5 grid gap-3 border-t border-white/[0.08] pt-4 sm:grid-cols-3">
              <ContextSignal title="Ticket context" detail={selectedTicket?.description ? "Ticket description and assigned context are available for review." : "Ticket identity and client context are available for review."} icon={FileText} />
              <ContextSignal title={brief.device ? "Linked endpoint" : "Endpoint not linked"} detail={brief.device ? `${brief.device?.name || brief.device?.hostname || "Managed device"} is available in this work session.` : "You can still record accountable work; governed remote access needs a linked managed endpoint."} icon={Laptop} tone="violet" />
              <ContextSignal title={activeSession ? "Evidence collection active" : "No work started yet"} detail={activeSession ? "Timer and accountable context are active. Review the final entry before it is recorded." : "Start work when you are ready to attach evidence and time to this ticket."} icon={ShieldCheck} tone="amber" />
            </div>
          </section>

          <NextBestActionPanel ticketId={ticketId} />

          {completedRecord && !activeSession && (
            <Card className="border-emerald-400/25 bg-emerald-400/[0.04]" signal="healthy" data-testid="work-session-completed-state">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" /><div><p className="font-medium">Completion pack recorded</p><p className="mt-1 text-sm text-muted-foreground">{completedRecord?.message || "Nexus recorded the time entry and ticket evidence."} {completedRecord?.outcome?.verified ? "The technician marked the resolution verified." : "Verification was not marked complete; follow-up remains explicit."}</p>{preventionFollowUp && <p className="mt-2 text-xs text-emerald-100/85">Prevention review proposed: {preventionFollowUp.title}. No remediation has been scheduled.</p>}</div></div>
                <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={openPreventionReview} disabled={busy || preventionBusy} data-testid="work-session-propose-prevention"><ShieldCheck className="mr-1.5 h-4 w-4" />Prevent recurrence</Button><Button variant="outline" size="sm" onClick={start} disabled={busy}><Play className="mr-1.5 h-4 w-4" />Start follow-up work</Button></div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" data-testid="work-session-evidence-context">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-cyan-300" />Evidence Nexus has in context</CardTitle><p className="text-xs text-muted-foreground">This is operational context for review, not a diagnosis and not a record of a change.</p></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {diagnosticScope.length ? diagnosticScope.map((item) => <div key={item} className="rounded-xl border border-border/70 bg-muted/[0.1] p-3 text-sm"><ShieldCheck className="mb-2 h-4 w-4 text-cyan-300" aria-hidden="true" />{item}</div>) : <div className="col-span-full rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">No diagnostic evidence sources are configured for this ticket yet.</div>}
                </div>
                <div className="border-t border-border/65 pt-4"><div className="mb-3 flex items-center gap-2"><History className="h-4 w-4 text-amber-300" aria-hidden="true" /><p className="text-sm font-medium">Recent client activity</p></div>{recentChanges.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{recentChanges.slice(0, 6).map((change, index) => <div key={`${change.at || change.title || "change"}-${index}`} className="rounded-xl border border-border/70 bg-muted/[0.1] p-3"><p className="text-sm font-medium">{change.title || "Recorded activity"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{change.source || "Nexus"} · {formatDateTime(change.at)}</p></div>)}</div> : <p className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">No recent client activity is available. That is an absence of evidence, not proof that nothing changed.</p>}</div>
              </CardContent>
            </Card>

            <Card data-testid="work-session-scope-guardian" className={scopeGuardian.status === "billable" ? "border-emerald-500/25" : scopeGuardian.status === "project" ? "border-violet-500/25" : "border-amber-500/25"}>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-amber-300" />Scope Guardian</CardTitle><p className="text-xs text-muted-foreground">A recommendation from linked agreement evidence. It is never an automatic billing decision.</p></CardHeader>
              <CardContent className="space-y-4"><div className="rounded-xl border border-border/70 bg-muted/[0.1] p-3"><p className="text-sm font-medium">{scopeGuardian.contract?.name || "No linked agreement"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{scopeGuardian.reason || "Nexus could not determine the commercial scope from retained evidence."}</p></div><div><Label>Commercial classification</Label><Select value={recommendedClassification} onValueChange={(value) => updateDraft({ billing_classification: value, billable: ["billable", "project"].includes(value) })} disabled={!activeSession}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{classificationOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select><p className="mt-2 text-xs leading-5 text-amber-100/85">{scopeGuardian.next_step || "Review the linked commercial evidence before recording time."}</p></div><div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/35 p-3"><Checkbox checked={draft.commercial_reviewed} onCheckedChange={(commercial_reviewed) => updateDraft({ commercial_reviewed: Boolean(commercial_reviewed) })} disabled={!activeSession} id="work-session-commercial-reviewed" /><Label htmlFor="work-session-commercial-reviewed" className="cursor-pointer text-xs leading-5">I reviewed this classification and understand that a billable outcome remains subject to normal billing controls.</Label></div></CardContent>
            </Card>
          </div>

          <Card className={!activeSession ? "opacity-70" : ""} data-testid="work-session-completion-pack">
            <CardHeader className="border-b border-border/65 pb-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-emerald-300" />Ready-to-review completion pack</CardTitle><p className="mt-1 text-xs leading-5 text-muted-foreground">Nexus offers structure and context. You review the words, commercial classification, and outcome before anything is recorded. Customer communication remains a separate action.</p></div><Badge variant="outline" className={canComplete ? "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-100" : "border-amber-400/25 bg-amber-400/[0.06] text-amber-100"} data-testid="work-session-review-progress">{reviewProgress}/4 required reviews complete</Badge></div></CardHeader>
            <CardContent className="space-y-5 pt-5">
              <NexusVerifiedSequence stages={["Context", "Work", "Review", "Verify", "Record"]} complete={completedRecord ? 5 : draft.verified ? 4 : activeSession ? Math.max(1, reviewProgress) : 0} label="Ticket-to-Outcome" />

              {completionAssist?.message && (
                <div className="flex flex-col gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="work-session-completion-assist">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4 text-cyan-300" />Prepared review draft</p>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{completionAssist.message}</p>
                    {assistEvidence.length > 0 && <p className="mt-1.5 text-[11px] text-cyan-100/70">Based on {assistEvidence.length} retained ticket, endpoint, activity or remote evidence item{assistEvidence.length === 1 ? "" : "s"}. Inspect the work context before using it.</p>}
                  </div>
                  <Button variant="outline" size="sm" onClick={applyCompletionAssist} disabled={!activeSession || busy} data-testid="work-session-prepare-draft"><Sparkles className="mr-1.5 h-3.5 w-3.5" />Prepare my review</Button>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3" aria-label="Completion pack readiness">
                <CompletionItem complete={hasTime} label="Time entry" detail={hasTime ? `${draft.minutes} minutes ready for review.` : "Enter time manually or use the session timer as a suggestion."} />
                <CompletionItem complete={hasTechnicalNotes} label="Technical evidence" detail={hasTechnicalNotes ? "Technical outcome is ready to be recorded." : "Describe what was observed, changed, and verified."} />
                <CompletionItem complete={hasCustomerSummary} label="Customer update" detail={hasCustomerSummary ? "Plain-language wording is ready for review only." : "Prepare a customer-safe outcome; Nexus will not send it."} />
                <CompletionItem complete={draft.commercial_reviewed} label="Commercial review" detail={draft.commercial_reviewed ? "Classification has been acknowledged by the technician." : "Review Scope Guardian evidence and acknowledge the choice."} />
                <CompletionItem complete={hasDocumentation} optional label="Documentation" detail={hasDocumentation ? "A documentation candidate is captured in this pack." : "Add a runbook or client-record update only if it is useful."} />
                <CompletionItem complete={hasPrevention} optional label="Prevention check" detail={hasPrevention ? "A recurrence or follow-up check is captured." : "Record any related estate check or follow-up; Nexus will not create one automatically."} />
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <section className="space-y-4 rounded-xl border border-border/70 bg-muted/[0.08] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">1. Record the accountable outcome</p><p className="mt-1 text-xs text-muted-foreground">Required to record a work-session outcome.</p></div>{activeSession && elapsedMinutes != null && <Button variant="outline" size="sm" onClick={useElapsedTime} data-testid="work-session-use-elapsed"><Clock3 className="mr-1.5 h-4 w-4" />Use {elapsed || "elapsed"}</Button>}</div>
                  <div><Label htmlFor="work-session-minutes">Time to record (minutes)</Label><Input id="work-session-minutes" className="mt-1" type="number" min="1" value={draft.minutes} onChange={(event) => updateDraft({ minutes: event.target.value })} placeholder="e.g. 37" disabled={!activeSession} /><p className="mt-1.5 text-xs text-muted-foreground">The timer is a suggestion, not an automatic time entry.</p></div>
                  <div><div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor="work-session-technical-notes">Technical resolution notes</Label><Button variant="ghost" size="sm" onClick={() => appendTemplate("technical_notes", technicianTemplate)} disabled={!activeSession}><Sparkles className="mr-1.5 h-3.5 w-3.5" />Add note outline</Button></div><Textarea id="work-session-technical-notes" className="mt-1 min-h-36" value={draft.technical_notes} onChange={(event) => updateDraft({ technical_notes: event.target.value })} placeholder="What was observed, what was changed, and what technical result was verified?" disabled={!activeSession} /></div>
                  <div><div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor="work-session-customer-summary">Customer-friendly update</Label><Button variant="ghost" size="sm" onClick={() => appendTemplate("customer_summary", customerTemplate)} disabled={!activeSession}><Sparkles className="mr-1.5 h-3.5 w-3.5" />Add safe outline</Button></div><Textarea id="work-session-customer-summary" className="mt-1 min-h-28" value={draft.customer_summary} onChange={(event) => updateDraft({ customer_summary: event.target.value })} placeholder="Use plain language. This is not sent automatically." disabled={!activeSession} /><p className="mt-1.5 text-xs text-muted-foreground">Recording this pack does not email or message the customer.</p></div>
                </section>

                <section className="space-y-4 rounded-xl border border-border/70 bg-muted/[0.08] p-4">
                  <div><p className="text-sm font-semibold">2. Preserve what helps next time</p><p className="mt-1 text-xs text-muted-foreground">Optional context for documentation and recurrence—not a claim that Nexus remediated anything.</p></div>
                  <div><div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor="work-session-documentation">Documentation candidate</Label><Button variant="ghost" size="sm" onClick={() => appendTemplate("documentation_suggestion", documentationTemplate)} disabled={!activeSession}><FileText className="mr-1.5 h-3.5 w-3.5" />Add structure</Button></div><Textarea id="work-session-documentation" className="mt-1 min-h-28" value={draft.documentation_suggestion} onChange={(event) => updateDraft({ documentation_suggestion: event.target.value })} placeholder="Record a useful runbook, client-record, or configuration update candidate." disabled={!activeSession} /></div>
                  <div><div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor="work-session-recurrence">Prevention / recurrence check</Label><Button variant="ghost" size="sm" onClick={() => appendTemplate("recurrence_check", preventionTemplate)} disabled={!activeSession}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Add check outline</Button></div><Textarea id="work-session-recurrence" className="mt-1 min-h-28" value={draft.recurrence_check} onChange={(event) => updateDraft({ recurrence_check: event.target.value })} placeholder="If similar endpoints, users, or sites need review, describe the safe follow-up." disabled={!activeSession} /></div>
                  {selectedTicket?.client_id && <Button variant="outline" size="sm" asChild><Link to={`/devices?client=${encodeURIComponent(selectedTicket.client_id)}`}><Laptop className="mr-1.5 h-4 w-4" />Review client devices</Link></Button>}
                  <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/35 p-3"><Checkbox checked={draft.verified} onCheckedChange={(verified) => updateDraft({ verified: Boolean(verified) })} disabled={!activeSession} id="work-session-verified" /><Label htmlFor="work-session-verified" className="cursor-pointer text-xs leading-5">I verified the resolution. Leave this clear if verification is pending; Nexus will retain the truthful status rather than assuming it passed.</Label></div>
                </section>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-t border-border/65 bg-muted/[0.08] p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-2xl text-xs leading-5 text-muted-foreground">{canComplete ? (draft.verified ? "Everything is ready for accountable completion." : "The required review is complete. You can record the pack now, with verification explicitly marked pending.") : "Complete the four required reviews before recording this outcome. Optional documentation and prevention notes remain your choice."}</p>
              <Button onClick={complete} disabled={busy || !canComplete} data-testid="work-session-complete-button">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}{draft.verified ? "Complete everything" : "Record review pack"}<ArrowRight className="ml-1 h-4 w-4" /></Button>
            </CardFooter>
          </Card>
        </>
      )}

      <Dialog open={preventionDialogOpen} onOpenChange={setPreventionDialogOpen}>
        <NexusWorkflowDialog
          eyebrow="Work Session · prevention review"
          title="Propose prevention follow-up"
          description="Capture evidence and a reviewable scope. This does not schedule remediation, queue automation, or change a customer environment."
          icon={ShieldCheck}
          tone="emerald"
          data-testid="work-session-prevention-dialog"
          footer={<><Button variant="outline" onClick={() => setPreventionDialogOpen(false)} disabled={preventionBusy}>Cancel</Button><Button onClick={submitPreventionReview} disabled={preventionBusy} data-testid="work-session-submit-prevention">{preventionBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}Propose for review</Button></>}
        >
          <div className="space-y-5">
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-4 text-sm leading-6 text-amber-100"><span className="font-semibold">Review-only boundary.</span> A proposal retains the condition and evidence; it cannot run scripts, start remote access, schedule a change, or claim remediation occurred.</div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Label htmlFor="prevention-follow-up-title">Condition to prevent</Label><Input id="prevention-follow-up-title" className="mt-1" value={preventionForm.title} onChange={(event) => setPreventionForm((current) => ({ ...current, title: event.target.value }))} maxLength={180} placeholder="e.g. Prevent recurring Outlook profile corruption" /></div><div><Label htmlFor="prevention-follow-up-priority">Review priority</Label><Select value={preventionForm.priority} onValueChange={(priority) => setPreventionForm((current) => ({ ...current, priority }))}><SelectTrigger id="prevention-follow-up-priority" className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent></Select></div><div className="rounded-lg border border-border/65 bg-muted/[0.08] p-3 text-xs leading-5 text-muted-foreground">The source ticket and its linked endpoint remain the initial evidence boundary. Broader endpoint campaigns require a separate governed workflow.</div></div>
            <div><Label htmlFor="prevention-follow-up-summary">Why this merits review</Label><Textarea id="prevention-follow-up-summary" className="mt-1 min-h-28" value={preventionForm.summary} onChange={(event) => setPreventionForm((current) => ({ ...current, summary: event.target.value }))} maxLength={4000} placeholder="Explain the repeated condition, customer impact, and safe review objective." /></div>
            <div><Label htmlFor="prevention-follow-up-evidence">Recurrence evidence</Label><Textarea id="prevention-follow-up-evidence" className="mt-1 min-h-32" value={preventionForm.recurrence_evidence} onChange={(event) => setPreventionForm((current) => ({ ...current, recurrence_evidence: event.target.value }))} maxLength={4000} placeholder="Record the related condition, evidence, and what should be checked before any campaign is considered." /><p className="mt-1.5 text-xs text-muted-foreground">Technician-authored evidence only. Nexus will not turn this into a completed remediation claim.</p></div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
