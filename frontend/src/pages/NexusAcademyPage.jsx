import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import AcademyCoursesWorkspace from "@/components/academy/AcademyCoursesWorkspace";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GraduationCap,
  History,
  Landmark,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Ticket,
  UsersRound,
  UserRoundCheck,
} from "lucide-react";

const PATHWAYS = [
  {
    id: "operations",
    label: "Operate with confidence",
    description: "Find the right context, record accountable ticket work, and preserve the handover for the next technician.",
    tone: "sky",
    icon: BriefcaseBusiness,
    steps: ["workspace-basics", "client-context", "ticket-lifecycle"],
  },
  {
    id: "evidence",
    label: "Protect the customer",
    description: "Use documentation, verification and escalation when a request or remote action carries risk.",
    tone: "emerald",
    icon: ShieldCheck,
    steps: ["documentation-and-audit", "secure-remote-and-verify", "final-attestation"],
  },
  {
    id: "commercial",
    label: "Protect the service value",
    description: "Understand the commercial workflow before creating or changing a customer financial record.",
    tone: "amber",
    icon: Landmark,
    steps: ["billing-basics"],
  },
];

const STEP_META = {
  "workspace-basics": { icon: BookOpen, tone: "sky", guide: ["Find the customer, record or workspace first; Nexus navigation and command search help you arrive with context.", "Treat summary tiles as a route to the real record, never as proof on their own.", "Use the shared back action and workspace guide when you need to re-orient yourself."] },
  "client-context": { icon: Building2, tone: "violet", guide: ["Confirm the client, contact and site from the Nexus record before viewing or changing customer work.", "Keep tickets, devices, services and communication connected to the correct client.", "Names, email addresses and hostnames are not replacements for the stable Nexus record."] },
  "ticket-lifecycle": { icon: Ticket, tone: "cyan", guide: ["Create or claim one accountable ticket and record the client, impact, owner and next action.", "Write clear technical notes as work happens and distinguish observed facts from assumptions.", "Before closing, verify the result and record the customer update and time/billing treatment."] },
  "documentation-and-audit": { icon: ClipboardCheck, tone: "emerald", guide: ["Use the linked ticket, device, client or change record as the operational source of truth.", "Record what was observed, changed, approved and verified.", "A learning acknowledgement never substitutes for a real customer, financial or privileged-action audit record."] },
  "billing-basics": { icon: FileText, tone: "amber", guide: ["Open the linked client and agreement before raising or changing an invoice.", "Check coverage, quantity, approval and customer wording before sending a financial document.", "A draft is not an issued invoice: verify status and audit history before treating it as final."] },
  "secure-remote-and-verify": { icon: ShieldCheck, tone: "rose", guide: ["Verify the requester and ticket context before a password, MFA, remote or privileged action.", "Use the approved remote workflow so consent, access window and outcome are retained.", "Escalate a request that exceeds your authority; do not use a shortcut or another technician's access."] },
  "final-attestation": { icon: UserRoundCheck, tone: "violet", guide: ["Nexus actions are attributed, policy-checked and auditable.", "Choose the smallest safe action and preserve the reason and verification result.", "Ask a service manager whenever scope, evidence or approval is unclear."] },
};

const TONE = {
  sky: "border-sky-400/25 bg-sky-400/[0.06] text-sky-200",
  cyan: "border-cyan-400/25 bg-cyan-400/[0.06] text-cyan-200",
  violet: "border-violet-400/25 bg-violet-400/[0.06] text-violet-200",
  emerald: "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-200",
  amber: "border-amber-400/25 bg-amber-400/[0.06] text-amber-200",
  rose: "border-rose-400/25 bg-rose-400/[0.06] text-rose-200",
};

function stepMeta(step) {
  return STEP_META[step?.id] || { icon: ClipboardCheck, tone: "cyan", guide: ["Review the goal and evidence expectation.", "Use the linked Nexus workflow when you are authorised to operate.", "Confirm only when you understand the required operational standard."] };
}

function TeamReadiness({ team }) {
  if (!team) return null;
  const summary = team.summary || {};
  const rows = Array.from(new Map(
    (Array.isArray(team.technicians) ? team.technicians : [])
      .filter((row) => !row.archived && row?.technician_id)
      .map((row) => [String(row.technician_id), row]),
  ).values()).slice(0, 5);
  return <Card className="overflow-hidden border-violet-400/20 bg-violet-400/[0.035]" data-testid="nexus-academy-team-readiness">
    <CardHeader className="border-b border-border/70 pb-3"><CardTitle className="flex items-center gap-2 text-sm"><UsersRound className="h-4 w-4 text-violet-300" />Team readiness</CardTitle><p className="text-xs text-muted-foreground">An administrative overview of the authoritative account-owned learning checklist.</p></CardHeader>
    <CardContent className="space-y-3 p-4"><div className="grid grid-cols-3 gap-2"><div className="rounded-xl border border-border/70 bg-background/30 p-2.5"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Team</p><p className="mt-1 text-lg font-semibold">{summary.total || 0}</p></div><div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-2.5"><p className="text-[10px] uppercase tracking-wide text-emerald-200">Ready</p><p className="mt-1 text-lg font-semibold text-emerald-100">{summary.compliant || 0}</p></div><div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-2.5"><p className="text-[10px] uppercase tracking-wide text-amber-200">Required</p><p className="mt-1 text-lg font-semibold text-amber-100">{summary.required || 0}</p></div></div><div className="divide-y divide-border/60">{rows.map((member) => <div key={member.technician_id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs font-medium">{member.technician_name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{member.completed_steps || 0}/{member.total_required_steps || 0} required steps</p></div><Badge variant="outline" className={member.is_compliant ? "border-emerald-400/30 text-emerald-200" : "border-amber-400/30 text-amber-200"}>{member.is_compliant ? "Ready" : "Required"}</Badge></div>)}</div></CardContent>
  </Card>;
}

export default function NexusAcademyPage() {
  const { token, user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const isAdmin = Boolean(user?.is_admin || String(user?.role || "").toLowerCase() === "admin");
  const [payload, setPayload] = useState(null);
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [activeStep, setActiveStep] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const [onboardingResult, teamResult] = await Promise.allSettled([
        axios.get(`${API}/technician-onboarding/me`, { headers }),
        isAdmin ? axios.get(`${API}/technician-onboarding/technicians`, { headers }) : Promise.resolve(null),
      ]);
      if (onboardingResult.status !== "fulfilled") throw onboardingResult.reason;
      setPayload(onboardingResult.value.data || {});
      setTeam(teamResult.status === "fulfilled" ? teamResult.value?.data || null : null);
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || requestError?.message || "Nexus could not load Academy evidence. No learning state was changed.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const onboarding = payload?.onboarding || {};
  const steps = useMemo(() => Array.isArray(onboarding.steps) ? onboarding.steps : [], [onboarding.steps]);
  const stepById = useMemo(() => new Map(steps.map((step) => [step.id, step])), [steps]);
  const totalSteps = Number(onboarding.total_required_steps || steps.length || 0);
  const completeCount = Number(onboarding.completed_steps || steps.filter((step) => step.status === "completed").length || 0);
  const completionPercent = Number(onboarding.completion_percent ?? (totalSteps ? Math.round((completeCount / totalSteps) * 100) : 0));
  const isCompliant = Boolean(onboarding.is_compliant || onboarding.status === "compliant");
  const attestationEvents = useMemo(() => (Array.isArray(onboarding.audit_log) ? onboarding.audit_log : []).filter((event) => event?.action === "technician_onboarding_step_completed" && event?.evidence_type === "technician_attestation"), [onboarding.audit_log]);
  const academyStage = isCompliant ? 4 : attestationEvents.length ? 2 : 0;

  const openStep = (step) => {
    setActiveStep(step);
    setAcknowledged(false);
  };

  const completeStep = async () => {
    if (!activeStep || !acknowledged) return;
    setSaving(true);
    try {
      const response = await axios.post(`${API}/technician-onboarding/me/steps/${encodeURIComponent(activeStep.id)}/complete`, { acknowledged: true }, { headers });
      setPayload(response.data || {});
      await refreshUser();
      toast.success(response.data?.changed === false ? "This Academy acknowledgement is already retained" : "Academy evidence retained");
      setActiveStep(null);
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "Nexus could not retain this acknowledgement");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !payload) return <WorkspaceLoadingState className="mt-4" label="Preparing your Academy pathway…" />;
  if (!loading && error && !payload) return <WorkspaceErrorState className="mt-4" title="Nexus Academy is unavailable" description={error} onRetry={load} retryLabel="Retry Academy" onSecondaryAction={() => navigate("/workspace")} secondaryLabel="Open My Workspace" />;

  return <div className="space-y-5 pb-10" data-testid="nexus-academy-page">
    <OperationalPageHeader
      eyebrow="Nexus Academy · capability with accountable evidence"
      title={isCompliant ? "Keep your standards sharp" : "Build confidence before live work"}
      description={isCompliant ? "Your required Nexus workflow acknowledgements are current. Academy keeps the standards, guidance and retained evidence in one focused place." : "Learn the operational essentials in a protected, guided space before customer work opens. Each acknowledgement is attributable, versioned and retained."}
      icon={GraduationCap}
      tone="violet"
      signal={isCompliant ? "healthy" : "attention"}
      actions={<><Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate("/documentation-hub?tab=help")}><BookOpen className="mr-1.5 h-3.5 w-3.5" />Open help centre</Button><Button size="sm" className="rounded-xl" onClick={() => load({ background: true })} disabled={refreshing}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh evidence</Button></>}
    />

    <Card className="overflow-hidden border-violet-400/20 bg-[radial-gradient(circle_at_88%_0%,rgba(139,92,246,0.16),transparent_36%),linear-gradient(125deg,rgba(12,17,30,0.94),rgba(15,19,33,0.88))]" data-testid="nexus-academy-boundary"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Evidence boundary</p><p className="mt-1 text-sm font-semibold">Training acknowledgement is not customer-work evidence.</p><p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">Academy records the guide version, your identity and acknowledgement time. Tickets, approvals, remote sessions, changes and billing records remain the only evidence of real operational work.</p></div><Badge variant="outline" className={isCompliant ? "w-fit border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200" : "w-fit border-amber-400/30 bg-amber-400/[0.08] text-amber-200"}>{isCompliant ? <><BadgeCheck className="mr-1.5 h-3.5 w-3.5" />Academy ready</> : <><LockKeyhole className="mr-1.5 h-3.5 w-3.5" />Readiness required</>}</Badge></CardContent></Card>

    {error && <Card className="border-amber-400/25 bg-amber-400/[0.04]"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">{error} Previously retrieved Academy evidence remains visible below.</p><Button size="sm" variant="outline" onClick={() => load({ background: true })}>Retry safely</Button></CardContent></Card>}

    <AcademyCoursesWorkspace token={token} isAdmin={isAdmin} />
    <NexusVerifiedSequence stages={["Review guidance", "Acknowledge", "Complete readiness", "Ready for work"]} complete={academyStage} label="Nexus Academy" />

    <MetricStrip columns={4}>
      <MetricTile label="Required learning" value={`${completeCount}/${totalSteps}`} accent="violet" icon={<GraduationCap className="h-2.5 w-2.5 text-violet-300" />} />
      <MetricTile label="Readiness" value={`${completionPercent}%`} accent={isCompliant ? "emerald" : "cyan"} icon={<BadgeCheck className="h-2.5 w-2.5 text-cyan-300" />} />
      <MetricTile label="Compliance" value={isCompliant ? "Ready" : "Required"} accent={isCompliant ? "emerald" : "amber"} icon={<ShieldCheck className="h-2.5 w-2.5 text-emerald-300" />} />
      <MetricTile label="Acknowledgements" value={attestationEvents.length} accent="sky" icon={<History className="h-2.5 w-2.5 text-sky-300" />} />
    </MetricStrip>

    {!isCompliant && onboarding.next_step && <Card className="overflow-hidden border-cyan-400/25 bg-cyan-400/[0.04]" data-testid="nexus-academy-next-step"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Your next Academy step</p><p className="mt-1 text-lg font-semibold">{onboarding.next_step.title}</p><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{onboarding.next_step.description}</p></div><Button className="shrink-0 rounded-xl" onClick={() => openStep(onboarding.next_step)} data-testid="nexus-academy-open-next"><Sparkles className="mr-2 h-4 w-4" />Start learning</Button></CardContent></Card>}

    <section aria-labelledby="academy-pathways-title"><div className="mb-3 flex flex-col gap-1 px-1 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Role-safe learning paths</p><h2 id="academy-pathways-title" className="mt-1 text-lg font-semibold">Learn the Nexus way of working</h2><p className="mt-1 text-xs text-muted-foreground">These paths reuse your authoritative readiness record. They never fabricate a certification or override policy.</p></div><p className="text-xs text-muted-foreground">{completeCount} of {totalSteps} required acknowledgements retained</p></div><div className="grid gap-4 xl:grid-cols-3">{PATHWAYS.map((pathway) => { const Icon = pathway.icon; const pathwaySteps = pathway.steps.map((id) => stepById.get(id)).filter(Boolean); const completed = pathwaySteps.filter((step) => step.status === "completed").length; return <Card key={pathway.id} className="group overflow-hidden border-border/70 bg-card/85 transition hover:-translate-y-0.5 hover:border-violet-400/35"><CardHeader className="border-b border-border/60 pb-3"><div className="flex items-start justify-between gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${TONE[pathway.tone] || TONE.violet}`}><Icon className="h-4.5 w-4.5" /></span><Badge variant="outline" className="text-[10px]">{completed}/{pathwaySteps.length} retained</Badge></div><CardTitle className="mt-3 text-base">{pathway.label}</CardTitle><p className="text-xs leading-5 text-muted-foreground">{pathway.description}</p></CardHeader><CardContent className="space-y-2 p-4">{pathwaySteps.map((step) => { const meta = stepMeta(step); const StepIcon = meta.icon; return <button key={step.id} type="button" onClick={() => openStep(step)} className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-muted/[0.08] p-3 text-left transition hover:bg-muted/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${step.status === "completed" ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300" : TONE[meta.tone] || TONE.cyan}`}>{step.status === "completed" ? <CheckCircle2 className="h-4 w-4" /> : <StepIcon className="h-3.5 w-3.5" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{step.title}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{step.status === "completed" ? "Evidence retained — review anytime" : "Review the standard"}</span></span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></button>; })}<Progress value={pathwaySteps.length ? Math.round((completed / pathwaySteps.length) * 100) : 0} className="mt-3 h-1.5" /></CardContent></Card>; })}</div></section>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="overflow-hidden border-border/70 bg-card/85" data-testid="nexus-academy-evidence"><CardHeader className="border-b border-border/70 pb-3"><CardTitle className="flex items-center gap-2 text-sm"><History className="h-4 w-4 text-sky-300" />My retained Academy evidence</CardTitle><p className="text-xs text-muted-foreground">Review the record of your deliberate acknowledgements. It supports readiness but does not replace evidence held by customer workflows.</p></CardHeader><CardContent className="divide-y divide-border/60 p-0">{attestationEvents.length ? attestationEvents.slice(0, 8).map((event, index) => <div key={`${event.id || event.action}-${index}`} className="flex items-start gap-3 px-4 py-3"><span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-400/[0.08]"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /></span><div className="min-w-0"><p className="text-sm font-medium">{event.detail || String(event.action || "Academy acknowledgement").replaceAll("_", " ")}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{event.actor_name || "Technician"}{event.occurred_at ? ` · ${new Date(event.occurred_at).toLocaleString()}` : ""}</p></div></div>) : <div className="px-6 py-12 text-center"><History className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Your Academy evidence will appear here</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Each retained acknowledgement records the guide version, actor and time.</p></div>}</CardContent></Card>
      <aside className="space-y-4"><Card className="border-cyan-400/20 bg-cyan-400/[0.04]"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><BookOpen className="h-4 w-4 text-cyan-300" />Keep learning in context</CardTitle></CardHeader><CardContent className="space-y-3 text-xs leading-5 text-muted-foreground"><p>Use the Help Centre for task-first guides, then perform real work from the owning ticket, client, device, billing or security workflow.</p><p>When a guide changes, a future Academy version can request deliberate re-acknowledgement without overwriting prior evidence.</p><Button variant="outline" size="sm" className="w-full" onClick={() => navigate("/documentation-hub?tab=help")}><BookOpen className="mr-1.5 h-3.5 w-3.5" />Browse task guides</Button></CardContent></Card>{isAdmin && <TeamReadiness team={team} />}</aside>
    </div>

    <Dialog open={Boolean(activeStep)} onOpenChange={(open) => !open && setActiveStep(null)}>{activeStep && (() => { const meta = stepMeta(activeStep); const Icon = meta.icon; const alreadyComplete = activeStep.status === "completed"; return <NexusWorkflowDialog eyebrow="Nexus Academy" title={activeStep.title} description={activeStep.description} icon={Icon} tone={meta.tone === "rose" ? "amber" : meta.tone} className="max-w-2xl" contentClassName="space-y-5" data-testid="nexus-academy-workflow" footer={<><Button variant="ghost" onClick={() => setActiveStep(null)}>Close</Button>{alreadyComplete ? <Button variant="outline" onClick={() => navigate("/documentation-hub?tab=help")}>Open a guide<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button> : <Button onClick={completeStep} disabled={!acknowledged || saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Retain acknowledgement</Button>}</>}><div className="grid gap-2 sm:grid-cols-3" aria-label="Academy learning workflow">{["1 Learn", "2 Confirm", "3 Retain"].map((label, index) => <div key={label} className={`rounded-xl border px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider ${index === 0 ? TONE[meta.tone] || TONE.violet : "border-border bg-muted/30 text-muted-foreground"}`}>{label}</div>)}</div><section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">What good looks like</p><ol className="mt-3 space-y-3">{meta.guide.map((item, index) => <li key={item} className="flex gap-3 text-sm leading-6"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-violet-400/25 bg-violet-400/[0.08] text-[10px] font-semibold text-violet-200">{index + 1}</span><span>{item}</span></li>)}</ol></section><section className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4"><p className="text-xs font-semibold">Evidence expectation</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{activeStep.evidence_expectation || "This is a versioned training acknowledgement only. Nexus retains real operational evidence in the governing record."}</p></section>{alreadyComplete ? <div className="flex gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-4"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><div><p className="text-sm font-medium">Evidence already retained</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Completed {activeStep.completed_at ? new Date(activeStep.completed_at).toLocaleString() : "previously"}. Revisit the guidance whenever your role or a policy changes.</p></div></div> : <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-violet-400/25 bg-violet-400/[0.045] p-4"><Checkbox checked={acknowledged} onCheckedChange={(value) => setAcknowledged(Boolean(value))} aria-label={`Acknowledge ${activeStep.title}`} /><span className="text-sm leading-6"><span className="font-medium">I understand this operational standard.</span><span className="mt-1 block text-xs text-muted-foreground">Nexus will retain my identity, time and guide version. This does not claim I completed customer work.</span></span></label>}</NexusWorkflowDialog>; })()}</Dialog>
  </div>;
}
