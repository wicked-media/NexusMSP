import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { MetricStrip, MetricTile } from "@/components/design-system";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  History,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Ticket,
  UserRoundCheck,
} from "lucide-react";

const STEP_META = {
  "workspace-basics": {
    icon: BookOpen,
    tone: "sky",
    guide: [
      "Use the left navigation to enter a workspace; use Nexus Command to find a record, person, ticket or service quickly.",
      "Set the active client context before acting on customer-scoped information.",
      "Treat summary cards as a route to the next action, not as evidence on their own.",
    ],
  },
  "client-context": {
    icon: Building2,
    tone: "violet",
    guide: [
      "Find the client record before creating or changing customer work.",
      "Confirm the correct client, contact and site; names and email addresses are never a substitute for the Nexus record.",
      "Keep communication, devices, services and tickets linked to the client record so the next technician has context.",
    ],
  },
  "ticket-lifecycle": {
    icon: Ticket,
    tone: "cyan",
    guide: [
      "Create or claim one ticket, then record the client, impact, owner and a clear next action.",
      "Write technical work notes as you go; distinguish observed evidence from assumptions.",
      "Before closing, verify the result, add the customer update and confirm the time/billing treatment.",
    ],
  },
  "documentation-and-audit": {
    icon: ClipboardCheck,
    tone: "emerald",
    guide: [
      "Use the linked ticket, device, client or change record as the source of operational truth.",
      "Record what was observed, what was changed, who approved it and how the result was verified.",
      "Never use this training acknowledgement as evidence that a customer action occurred; Nexus records those actions separately.",
    ],
  },
  "billing-basics": {
    icon: FileText,
    tone: "amber",
    guide: [
      "Open the linked client and agreement before raising or adjusting an invoice.",
      "Check quantity, coverage, approval and customer-facing wording before sending a financial document.",
      "A draft is not a final invoice: confirm the status and audit trail before treating it as issued.",
    ],
  },
  "secure-remote-and-verify": {
    icon: ShieldCheck,
    tone: "rose",
    guide: [
      "Verify the requester and ticket context before password, MFA, remote or privileged actions.",
      "Use the Nexus-approved remote workflow so consent, access window and session outcome are retained.",
      "Escalate when the requested action exceeds your authority; never use another technician's access or an unapproved shortcut.",
    ],
  },
  "final-attestation": {
    icon: UserRoundCheck,
    tone: "violet",
    guide: [
      "Confirm you understand that Nexus actions are attributed, policy checked and auditable.",
      "Use the smallest safe action, capture the reason and preserve verification evidence.",
      "Ask a service manager when evidence, scope or approval is unclear.",
    ],
  },
};

const DEFAULT_META = {
  icon: ClipboardCheck,
  tone: "cyan",
  guide: [
    "Review the goal and the evidence expectation for this learning step.",
    "Use the linked Nexus workspace for controlled operational work after training is complete.",
    "Only confirm a training acknowledgement when you understand the required standard.",
  ],
};

const TONE_STYLES = {
  sky: "border-sky-500/25 bg-sky-500/[0.05] text-sky-700 dark:text-sky-200",
  cyan: "border-cyan-500/25 bg-cyan-500/[0.05] text-cyan-700 dark:text-cyan-200",
  violet: "border-violet-500/25 bg-violet-500/[0.05] text-violet-700 dark:text-violet-200",
  emerald: "border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-200",
  amber: "border-amber-500/25 bg-amber-500/[0.05] text-amber-700 dark:text-amber-200",
  rose: "border-rose-500/25 bg-rose-500/[0.05] text-rose-700 dark:text-rose-200",
};

function stepMeta(step) {
  return STEP_META[step?.id] || DEFAULT_META;
}

function EvidenceTimeline({ events = [] }) {
  if (!events.length) {
    return (
      <Card className="border-dashed border-border/70 bg-muted/[0.16]">
        <CardContent className="p-6 text-center">
          <History className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">Your readiness evidence will appear here</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Each completed learning step records the guide version, your identity and the time of acknowledgement.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="border-b border-border/60 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm"><History className="h-4 w-4 text-violet-400" />Readiness evidence</CardTitle>
        <p className="text-xs text-muted-foreground">Training acknowledgements are retained separately from real customer and financial actions.</p>
      </CardHeader>
      <CardContent className="divide-y divide-border/60 p-0">
        {events.slice(0, 8).map((event, index) => (
          <div key={`${event.id || event.at || "event"}-${index}`} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{event.detail || event.action?.replaceAll("_", " ") || "Readiness record updated"}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{event.by || event.actor_name || "Technician"}{event.at ? ` · ${new Date(event.at).toLocaleString()}` : ""}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function TechnicianOnboardingPage() {
  const { token, refreshUser } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const navigate = useNavigate();
  const location = useLocation();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeStep, setActiveStep] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${API}/technician-onboarding/me`, { headers });
      setPayload(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Nexus could not load your required onboarding safely.");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const onboarding = payload?.onboarding;
  const steps = onboarding?.steps || [];
  const completeCount = Number(onboarding?.completed_steps || steps.filter((step) => step.status === "completed").length || 0);
  const totalSteps = Number(onboarding?.total_required_steps || steps.length || 0);
  const completionPercent = Number(onboarding?.completion_percent ?? (totalSteps ? Math.round((completeCount / totalSteps) * 100) : 0));
  const isCompliant = Boolean(onboarding?.is_compliant || onboarding?.status === "completed");
  const destination = location.state?.from?.pathname && location.state.from.pathname !== "/technician-onboarding"
    ? `${location.state.from.pathname}${location.state.from.search || ""}`
    : "/workspace";

  const openStep = (step) => {
    setActiveStep(step);
    setAcknowledged(false);
  };

  const completeStep = async () => {
    if (!activeStep || !acknowledged) return;
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/technician-onboarding/me/steps/${encodeURIComponent(activeStep.id)}/complete`,
        { acknowledged: true },
        { headers },
      );
      setPayload(response.data);
      await refreshUser();
      toast.success(response.data?.changed === false ? "This learning step is already recorded" : "Readiness evidence recorded");
      setActiveStep(null);
    } catch (requestError) {
      toast.error(requestError.response?.data?.detail || "Nexus could not record this acknowledgement");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-[52vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="border-amber-500/25 bg-amber-500/[0.05]">
          <CardContent className="p-7 text-center">
            <LockKeyhole className="mx-auto h-7 w-7 text-amber-400" />
            <h1 className="mt-4 text-xl font-semibold">Technician readiness is unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{error}</p>
            <Button className="mt-5" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Retry safely</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 pb-10" data-testid="technician-onboarding-page">
      <OperationalPageHeader
        eyebrow="Technician readiness"
        title={isCompliant ? "You are ready to operate" : "Start with confidence"}
        description={isCompliant
          ? "Your required Nexus learning acknowledgements are complete. Customer work, approvals and operational actions continue to create their own audit evidence."
          : "Complete the guided essentials before operational work opens. Each acknowledgement is attributable, versioned and retained as training evidence."}
        icon={UserRoundCheck}
        tone="violet"
        actions={isCompliant ? <Button onClick={() => navigate(destination)} data-testid="enter-nexus-workspace"><ArrowRight className="mr-2 h-4 w-4" />Enter Nexus</Button> : <Badge variant="outline" className="border-amber-500/35 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-200"><LockKeyhole className="mr-1.5 h-3.5 w-3.5" />Operational access unlocks at completion</Badge>}
      />

      <MetricStrip columns={4}>
        <MetricTile label="Required steps" value={`${completeCount}/${totalSteps}`} accent="violet" icon={<ClipboardCheck className="h-2.5 w-2.5 text-violet-300" />} />
        <MetricTile label="Readiness" value={`${completionPercent}%`} accent={isCompliant ? "emerald" : "cyan"} icon={<BadgeCheck className={`h-2.5 w-2.5 ${isCompliant ? "text-emerald-300" : "text-cyan-300"}`} />} />
        <MetricTile label="Compliance" value={isCompliant ? "Ready" : "Required"} accent={isCompliant ? "emerald" : "amber"} icon={<ShieldCheck className={`h-2.5 w-2.5 ${isCompliant ? "text-emerald-300" : "text-amber-300"}`} />} />
        <MetricTile label="Evidence" value={onboarding?.audit_log?.length || 0} accent="sky" icon={<History className="h-2.5 w-2.5 text-sky-300" />} />
      </MetricStrip>

      {!isCompliant && onboarding?.next_step && (
        <Card className="overflow-hidden border-violet-500/25 bg-[radial-gradient(circle_at_right_top,rgba(139,92,246,0.16),transparent_42%),linear-gradient(125deg,rgba(10,16,29,0.92),rgba(18,19,34,0.88))]">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Continue learning</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{onboarding.next_step.title}</p>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{onboarding.next_step.description}</p>
            </div>
            <Button onClick={() => openStep(onboarding.next_step)} className="shrink-0" data-testid="open-next-onboarding-step"><ArrowRight className="mr-2 h-4 w-4" />Review step</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-3" aria-label="Technician onboarding steps">
          <div className="flex items-end justify-between gap-3 px-1">
            <div><h2 className="text-base font-semibold">Guided essentials</h2><p className="mt-1 text-xs text-muted-foreground">The acknowledgement records your training understanding; real customer actions retain their own independent audit trail.</p></div>
            <span className="hidden text-xs font-medium text-muted-foreground sm:block">{completionPercent}% complete</span>
          </div>
          <Progress value={completionPercent} className="h-2" aria-label={`${completionPercent}% technician onboarding complete`} />
          <div className="grid gap-3 lg:grid-cols-2">
            {steps.map((step, index) => {
              const meta = stepMeta(step);
              const Icon = meta.icon;
              const completed = step.status === "completed";
              return (
                <Card key={step.id} className={`group overflow-hidden border transition-colors ${completed ? "border-emerald-500/20 bg-emerald-500/[0.035]" : "border-border/70 bg-card/75 hover:border-violet-500/35"}`} data-testid={`technician-onboarding-step-${step.id}`}>
                  <CardContent className="p-4">
                    <div className="flex gap-3">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${completed ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" : TONE_STYLES[meta.tone]}`}>
                        {completed ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-4.5 w-4.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="text-[9px]">{String(index + 1).padStart(2, "0")}</Badge>{completed && <Badge className="border-emerald-500/25 bg-emerald-500/10 text-[9px] text-emerald-700 dark:text-emerald-200">Recorded</Badge>}</div>
                        <h3 className="mt-2 text-sm font-semibold">{step.title}</h3>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                    <Separator className="my-3" />
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate text-[11px] text-muted-foreground">{step.evidence_expectation || "Versioned training acknowledgement"}</p>
                      <Button size="sm" variant={completed ? "outline" : "default"} onClick={() => openStep(step)} data-testid={`review-technician-onboarding-step-${step.id}`}>
                        {completed ? "Review" : "Learn"}<ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <aside className="space-y-4">
          <Card className="border-cyan-500/20 bg-cyan-500/[0.04]">
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-cyan-300" />What Nexus records</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-xs leading-5 text-muted-foreground">
              <p>Guide version, completion time, your identity and the evidence type for each training acknowledgement.</p>
              <p>Customer requests, privileged actions, financial documents and remote sessions create their own operational evidence when they occur.</p>
              <div className="rounded-lg border border-cyan-500/20 bg-background/40 p-3 text-cyan-900 dark:text-cyan-100"><LockKeyhole className="mb-1.5 h-3.5 w-3.5 text-cyan-400" />No training checkbox can replace customer approval, verification or a required audit record.</div>
            </CardContent>
          </Card>
          <EvidenceTimeline events={onboarding?.audit_log || []} />
        </aside>
      </div>

      <Dialog open={Boolean(activeStep)} onOpenChange={(open) => !open && setActiveStep(null)}>
        {activeStep && (() => {
          const meta = stepMeta(activeStep);
          const Icon = meta.icon;
          const alreadyComplete = activeStep.status === "completed";
          return (
            <NexusWorkflowDialog
              eyebrow="Technician onboarding"
              title={activeStep.title}
              description={activeStep.description}
              icon={Icon}
              tone={meta.tone === "rose" ? "amber" : meta.tone}
              className="max-w-2xl"
              contentClassName="space-y-5"
              data-testid="technician-onboarding-workflow"
              footer={<><Button variant="ghost" onClick={() => setActiveStep(null)}>Close</Button>{!alreadyComplete && <Button onClick={completeStep} disabled={!acknowledged || saving} data-testid="complete-technician-onboarding-step">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Record acknowledgement</Button>}</>}
            >
              <div className="grid gap-2 sm:grid-cols-3" aria-label="Guided learning workflow">
                {["1 Learn", "2 Confirm", "3 Evidence"].map((label, index) => <div key={label} className={`rounded-lg border px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider ${index === 0 ? "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-200" : "border-border bg-muted/30 text-muted-foreground"}`}>{label}</div>)}
              </div>
              <section className="rounded-xl border border-border/70 bg-muted/[0.14] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">What good looks like</p>
                <ol className="mt-3 space-y-3">
                  {meta.guide.map((item, index) => <li key={item} className="flex gap-3 text-sm leading-6"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-violet-500/25 bg-violet-500/10 text-[10px] font-semibold text-violet-700 dark:text-violet-200">{index + 1}</span><span>{item}</span></li>)}
                </ol>
              </section>
              <section className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4"><p className="text-xs font-semibold text-foreground">Evidence expectation</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{activeStep.evidence_expectation || "This records a versioned training acknowledgement. It does not fabricate operational evidence."}</p></section>
              {alreadyComplete ? <div className="flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /><div><p className="font-medium">Recorded</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Completed {activeStep.completed_at ? new Date(activeStep.completed_at).toLocaleString() : "previously"}. Review the guidance whenever your role or policy changes.</p></div></div> : <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-violet-500/25 bg-violet-500/[0.045] p-4"><Checkbox checked={acknowledged} onCheckedChange={(value) => setAcknowledged(Boolean(value))} aria-label={`Acknowledge ${activeStep.title}`} /><span className="text-sm leading-6"><span className="font-medium">I understand this standard.</span><span className="mt-1 block text-xs text-muted-foreground">Nexus will record this as a training acknowledgement with my identity, time and guide version. It is not evidence that I completed customer work.</span></span></label>}
            </NexusWorkflowDialog>
          );
        })()}
      </Dialog>
    </div>
  );
}
