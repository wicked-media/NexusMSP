import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  BadgeCheck,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  KeyRound,
  Link2,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";

import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const riskTone = {
  medium: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  high: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  critical: "border-rose-400/30 bg-rose-400/10 text-rose-200",
};

const statusTone = {
  awaiting_verification: "border-sky-400/25 bg-sky-400/[0.08] text-sky-200",
  challenge_issued: "border-amber-400/25 bg-amber-400/[0.08] text-amber-200",
  awaiting_approval: "border-violet-400/25 bg-violet-400/[0.08] text-violet-200",
  ready_for_handoff: "border-cyan-400/25 bg-cyan-400/[0.08] text-cyan-100",
  ready_to_execute: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200",
  completed: "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-300",
};

const title = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function factorCount(request) {
  return Number(request?.verification?.factor_count || request?.verification?.factors?.length || 0);
}

function factorProgress(request) {
  return `${factorCount(request)} / ${Number(request?.required_factors || 1)}`;
}

function formatExpiry(value) {
  if (!value) return "No expiry recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Expiry unavailable" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function NexusVerifyPage() {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const prefillClientId = searchParams.get("client") || "";
  const prefillAction = searchParams.get("action") || "";
  const prefillSubjectName = searchParams.get("subject_name") || "";
  const prefillSubjectEmail = searchParams.get("subject_email") || "";
  const prefillMicrosoftTarget = useMemo(() => {
    const tenantId = searchParams.get("entra_tenant_id") || "";
    const providerUserId = searchParams.get("provider_user_id") || "";
    const userPrincipalName = searchParams.get("user_principal_name") || "";
    if (!tenantId || !providerUserId || !userPrincipalName) return null;
    return {
      provider: "microsoft_entra",
      tenant_id: tenantId,
      provider_user_id: providerUserId,
      user_principal_name: userPrincipalName,
    };
  }, [searchParams]);

  const [data, setData] = useState(null);
  const [clients, setClients] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    client_id: "",
    subject_name: "",
    subject_email: "",
    action_type: "mfa_reset",
    ticket_id: "",
    justification: "",
    provider_target: null,
  });
  const [evidence, setEvidence] = useState("");
  const [method, setMethod] = useState("nexus_app");
  const [note, setNote] = useState("");

  const selectedPolicy = data?.policies?.find((policy) => policy.id === form.action_type);
  const summary = data?.summary || {};
  const verifySignal = summary.awaiting_approval ? "attention" : summary.open ? "working" : "healthy";

  const load = useCallback(async () => {
    try {
      const [overview, clientList] = await Promise.all([
        axios.get(`${API}/nexus-verify/overview`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setData(overview.data);
      setClients(Array.isArray(clientList.data) ? clientList.data : clientList.data?.items || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Verify could not be loaded");
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!prefillClientId && !prefillAction) return;
    setForm((current) => ({
      ...current,
      client_id: prefillClientId || current.client_id,
      action_type: prefillAction || current.action_type,
      subject_name: prefillSubjectName || current.subject_name,
      subject_email: prefillSubjectEmail || current.subject_email,
      provider_target: prefillMicrosoftTarget || current.provider_target,
    }));
    setDialog({ type: "create" });
  }, [prefillAction, prefillClientId, prefillMicrosoftTarget, prefillSubjectEmail, prefillSubjectName]);

  const openWorkflow = (type, request = null) => {
    setEvidence("");
    setNote("");
    setMethod(request?.challenge?.method || "nexus_app");
    setDialog({ type, request });
  };

  const call = async (path, payload, success) => {
    setBusy(true);
    try {
      const response = await axios.post(`${API}${path}`, payload, { headers });
      toast.success(success || response.data?.message || "Nexus Verify was updated");
      setDialog(null);
      setEvidence("");
      setNote("");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "The secure workflow could not be recorded");
    } finally {
      setBusy(false);
    }
  };

  const create = () => call("/nexus-verify/requests", form, "Sensitive request opened. Verify the caller before proceeding.");
  const request = dialog?.request;
  const dialogType = dialog?.type;
  const handoffOnly = request?.status === "ready_for_handoff";

  const dialogMeta = {
    create: {
      eyebrow: "Sensitive request",
      title: "Open a verified operation",
      description: "Nexus will bind the request to one customer, apply its risk policy and retain an accountable record from the first step.",
      icon: ShieldAlert,
      tone: "amber",
    },
    challenge: {
      eyebrow: "Identity factor",
      title: "Issue a verification challenge",
      description: "Use an enrolled, independent channel. Each required factor must use a distinct method and expires after ten minutes.",
      icon: UserRoundCheck,
      tone: "cyan",
    },
    confirm: {
      eyebrow: "Evidence record",
      title: "Record trusted-channel evidence",
      description: "This stores accountable operator evidence. It does not claim a cryptographic proof or unlock an external provider action.",
      icon: BadgeCheck,
      tone: "violet",
    },
    approve: {
      eyebrow: "Independent approval",
      title: "Approve high-risk work",
      description: "The requester and verifier cannot approve their own sensitive action. Record why this hand-off is appropriate.",
      icon: ClipboardCheck,
      tone: "violet",
    },
    handoff: {
      eyebrow: "Provider hand-off",
      title: handoffOnly ? "Record a reviewed hand-off" : "Record the provider outcome",
      description: handoffOnly
        ? "This request has sufficient recorded evidence for review, but no connector-verified proof. Document the accountable next step without pretending Nexus executed a provider action."
        : "Retain the outcome of the approved provider hand-off against the original identity request.",
      icon: Send,
      tone: "emerald",
    },
  }[dialogType] || {};

  const actionForRequest = (item) => {
    if (item.status === "awaiting_verification") {
      return <Button size="sm" variant="outline" onClick={() => openWorkflow("challenge", item)}><UserRoundCheck className="mr-1.5 h-3.5 w-3.5" />Issue factor challenge</Button>;
    }
    if (item.status === "challenge_issued") {
      return <Button size="sm" onClick={() => openWorkflow("confirm", item)}><BadgeCheck className="mr-1.5 h-3.5 w-3.5" />Confirm evidence</Button>;
    }
    if (item.status === "awaiting_approval") {
      return <Button size="sm" onClick={() => openWorkflow("approve", item)}><ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />Review & approve</Button>;
    }
    if (["ready_for_handoff", "ready_to_execute"].includes(item.status)) {
      return <Button size="sm" onClick={() => openWorkflow("handoff", item)}><Send className="mr-1.5 h-3.5 w-3.5" />Record hand-off</Button>;
    }
    return null;
  };

  return (
    <div className="nx-page-stage space-y-5 p-4 md:p-6" data-testid="nexus-verify-page">
      <OperationalPageHeader
        eyebrow="Verified operations"
        title="Nexus Verify"
        description="Identity proof, risk-based approval and durable evidence for sensitive helpdesk requests. Evidence must be strong enough for the action—not just persuasive enough for the caller."
        icon={BadgeCheck}
        tone="sky"
        signal={verifySignal}
        actions={<Button onClick={() => openWorkflow("create")}><ShieldAlert className="mr-2 h-4 w-4" />New sensitive request</Button>}
      />

      <section className="grid gap-3 rounded-2xl border border-amber-400/20 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.14),transparent_42%),hsl(var(--card)/0.66)] p-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-center" aria-label="Nexus Verify execution boundary">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/[0.08] text-amber-200"><CircleAlert className="h-5 w-5" /></span>
        <div>
          <p className="text-sm font-semibold">Evidence is not permission</p>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">{data?.execution_boundary || "Loading execution boundary…"}</p>
        </div>
      </section>

      <NexusVerifiedSequence stages={["Request", "Factors", "Independent approval", "Hand-off"]} complete={0} label="Nexus Verify" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroTile label="Open requests" value={summary.open || 0} icon={ShieldAlert} glow="amber" subtitle="Sensitive work under control" animated={false} />
        <HeroTile label="Factors in progress" value={(summary.awaiting_verification || 0) + (summary.challenge_issued || 0)} icon={UserRoundCheck} glow="sky" subtitle="Proof is still required" animated={false} />
        <HeroTile label="Independent approval" value={summary.awaiting_approval || 0} icon={ClipboardCheck} glow="violet" subtitle="High-risk dual control" animated={false} />
        <HeroTile label="Ready for hand-off" value={(summary.ready_for_handoff || 0) + (summary.ready || 0)} icon={CheckCircle2} glow="emerald" subtitle="Time-bound outcome record" animated={false} />
      </div>

      <Card className="overflow-hidden" data-testid="nexus-verify-queue">
        <CardHeader className="border-b border-border/70 bg-muted/[0.08]">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-cyan-300" />Sensitive-action queue</CardTitle>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Nexus keeps the evidence trail and decision ownership together, so a technician never has to rely on a caller’s assertion alone.</p>
            </div>
            <Badge variant="outline" className="w-fit border-cyan-400/20 bg-cyan-400/[0.05] text-cyan-200">Policy-controlled</Badge>
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-border/70 p-0">
          {data?.requests?.length ? data.requests.map((item) => {
            const factors = factorCount(item);
            const required = Number(item.required_factors || 1);
            const isConnectorReady = item?.verification?.execution_eligible === true;
            return (
              <article key={item.id} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold tracking-tight">{item.subject_name}</p>
                    <Badge variant="outline" className={riskTone[item.risk] || riskTone.medium}>{item.risk} risk</Badge>
                    <Badge variant="outline" className={statusTone[item.status] || "border-border text-muted-foreground"}>{title(item.status)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.action_label} · {item.client_name}{item.ticket_id ? ` · ${item.ticket_id}` : ""}</p>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-lg border border-border/70 bg-muted/[0.12] px-3 py-2"><p className="font-medium text-foreground">{factorProgress(item)} factor{required === 1 ? "" : "s"}</p><p className="mt-0.5 text-muted-foreground">{factors < required ? "Still required" : "Required evidence recorded"}</p></div>
                    <div className="rounded-lg border border-border/70 bg-muted/[0.12] px-3 py-2"><p className="font-medium text-foreground">{item.approval_required ? "Independent approval" : "Single-control request"}</p><p className="mt-0.5 text-muted-foreground">{item.approval_required ? "Separate authorised reviewer" : "No extra approver policy"}</p></div>
                    <div className="rounded-lg border border-border/70 bg-muted/[0.12] px-3 py-2"><p className="font-medium text-foreground">{isConnectorReady ? "Connector proof ready" : "Evidence recorded"}</p><p className="mt-0.5 text-muted-foreground">{isConnectorReady ? `Expires ${formatExpiry(item.verification?.expires_at)}` : "Provider execution remains blocked"}</p></div>
                  </div>
                  {item.status === "challenge_issued" && <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-200"><Clock3 className="h-3.5 w-3.5" />{item.challenge?.method_label || "Verification"} challenge awaiting evidence until {formatExpiry(item.challenge?.expires_at)}.</p>}
                  {item.verification?.factor_count > 0 && <p className="mt-3 text-xs text-muted-foreground">Recorded through {item.verification?.factors?.map((factor) => factor.method_label).filter(Boolean).join(" + ") || "legacy evidence"}. {isConnectorReady ? "Provider execution is eligible while this proof is current." : "This is a reviewed attestation, not connector-verified provider authority."}</p>}
                  {item.status === "ready_to_execute" && <p className="mt-3 select-all font-mono text-[11px] text-cyan-200">Execution request ID · {item.id}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">{actionForRequest(item)}</div>
              </article>
            );
          }) : <div className="px-6 py-16 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-emerald-300" /><p className="mt-3 text-sm font-medium">No sensitive requests are open</p><p className="mt-1 text-xs text-muted-foreground">Open Nexus Verify from a ticket or Control Plane before a caller’s request becomes a high-impact action.</p></div>}
        </CardContent>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
        <NexusWorkflowDialog
          eyebrow={dialogMeta.eyebrow}
          title={dialogMeta.title}
          description={dialogMeta.description}
          icon={dialogMeta.icon}
          tone={dialogMeta.tone}
          className="max-w-2xl"
          footer={<>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
            {dialogType === "create" && <Button onClick={create} disabled={busy || !form.client_id || !form.subject_name}><ShieldAlert className="mr-1.5 h-4 w-4" />Open request</Button>}
            {dialogType === "challenge" && <Button onClick={() => call(`/nexus-verify/requests/${request.id}/challenge`, { method })} disabled={busy}><Send className="mr-1.5 h-4 w-4" />Issue challenge</Button>}
            {dialogType === "confirm" && <Button onClick={() => call(`/nexus-verify/requests/${request.id}/confirm`, { method, evidence_ref: evidence })} disabled={busy || evidence.trim().length < 8}><BadgeCheck className="mr-1.5 h-4 w-4" />Record factor</Button>}
            {dialogType === "approve" && <Button onClick={() => call(`/nexus-verify/requests/${request.id}/approve`, { rationale: note })} disabled={busy || note.trim().length < 8}><ClipboardCheck className="mr-1.5 h-4 w-4" />Approve request</Button>}
            {dialogType === "handoff" && <Button onClick={() => call(`/nexus-verify/requests/${request.id}/handoff`, { execution_note: note })} disabled={busy || note.trim().length < 8}><Link2 className="mr-1.5 h-4 w-4" />Record accountable hand-off</Button>}
          </>}
        >
          {dialogType === "create" && <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Customer</Label><Select value={form.client_id} onValueChange={(client_id) => setForm({ ...form, client_id })}><SelectTrigger><SelectValue placeholder="Select the customer" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Requester</Label><Input value={form.subject_name} onChange={(event) => setForm({ ...form, subject_name: event.target.value })} placeholder="Sarah Jones" autoComplete="name" /></div>
              <div className="space-y-2"><Label>{form.provider_target ? "Requester email (bound Microsoft identity)" : "Requester email (optional)"}</Label><Input type="email" value={form.subject_email} onChange={(event) => setForm({ ...form, subject_email: event.target.value })} placeholder="sarah@customer.example" autoComplete="email" readOnly={Boolean(form.provider_target)} /></div>
              <div className="space-y-2"><Label>Request type</Label><Select value={form.action_type} onValueChange={(action_type) => setForm({ ...form, action_type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{data?.policies?.map((policy) => <SelectItem key={policy.id} value={policy.id}>{policy.label} · {policy.risk}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Ticket reference (optional)</Label><Input value={form.ticket_id} onChange={(event) => setForm({ ...form, ticket_id: event.target.value })} placeholder="Ticket UUID or linked ticket ID" /></div>
            </div>
            {form.provider_target && <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4"><p className="text-sm font-semibold">Exact Microsoft target bound</p><p className="mt-1 text-xs leading-5 text-muted-foreground">This proof can only be used for <span className="font-medium text-foreground">{form.provider_target.user_principal_name}</span> in the selected Entra tenant. Nexus compares stable tenant and provider-user identifiers at execution; display names do not authorise an action.</p></section>}
            {selectedPolicy && <section className="rounded-xl border border-border/70 bg-muted/[0.14] p-4"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">Required controls</p><Badge variant="outline" className={riskTone[selectedPolicy.risk] || riskTone.medium}>{selectedPolicy.risk} risk</Badge></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{selectedPolicy.factors} distinct trusted factor{selectedPolicy.factors === 1 ? "" : "s"}{selectedPolicy.approval ? " and an independent authorised approval" : ""} are required before Nexus can record a provider hand-off.</p></section>}
            <div className="space-y-2"><Label>Technician context</Label><Textarea value={form.justification} onChange={(event) => setForm({ ...form, justification: event.target.value })} placeholder="Why is this sensitive action being requested?" rows={3} /></div>
          </div>}

          {dialogType === "challenge" && <div className="space-y-5">
            <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4"><p className="text-sm font-semibold">{request?.subject_name} · {request?.action_label}</p><p className="mt-1 text-xs text-muted-foreground">Factor {factorCount(request) + 1} of {request?.required_factors || 1}. A prior factor cannot be reused.</p></section>
            <div className="space-y-2"><Label>Enrolled verification method</Label><Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{data?.methods?.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select></div>
            <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-3 text-xs leading-5 text-muted-foreground">This records the challenge window and method. Until the associated Nexus App, passkey or mobile connector produces a server-side receipt, it does not claim that a message was delivered.</p>
          </div>}

          {dialogType === "confirm" && <div className="space-y-5">
            <section className="rounded-xl border border-violet-400/20 bg-violet-400/[0.05] p-4"><p className="text-sm font-semibold">{request?.challenge?.method_label}</p><p className="mt-1 text-xs text-muted-foreground">Challenge expires at {formatExpiry(request?.challenge?.expires_at)}. The method is fixed to the issued challenge.</p></section>
            <div className="space-y-2"><Label>Trusted-channel evidence reference</Label><Input value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Challenge receipt, call reference or approved evidence record" autoFocus /><p className="text-xs text-muted-foreground">Use a meaningful reference that another authorised technician can locate during review. Never enter a password, one-time code, private key or recovery code here.</p></div>
            <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-3 text-xs leading-5 text-muted-foreground">This creates an operator-attested evidence factor. It can satisfy the workflow’s recorded review requirements, but it cannot unlock a connected Microsoft or other provider action until a supported connector verifies the proof server-side.</p>
          </div>}

          {dialogType === "approve" && <div className="space-y-5">
            <section className="rounded-xl border border-violet-400/20 bg-violet-400/[0.05] p-4"><p className="text-sm font-semibold">Independent high-risk approval</p><p className="mt-1 text-xs leading-5 text-muted-foreground">You cannot approve a request you created or verified. Nexus checks that boundary on the server before saving this decision.</p></section>
            <div className="space-y-2"><Label>Approval rationale</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why is this request appropriate, and what policy or authority supports it?" rows={4} /></div>
          </div>}

          {dialogType === "handoff" && <div className="space-y-5">
            <section className={`rounded-xl border p-4 ${handoffOnly ? "border-amber-400/20 bg-amber-400/[0.05]" : "border-emerald-400/20 bg-emerald-400/[0.05]"}`}><p className="text-sm font-semibold">{handoffOnly ? "Review-only hand-off" : "Provider-action outcome"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{handoffOnly ? "The proof is durable audit evidence but not a cryptographically verified connector receipt. Record the accountable next step; do not claim Nexus performed an external reset." : "Record what the approved provider action returned, including any customer-safe follow-up or verification."}</p></section>
            <div className="space-y-2"><Label>Hand-off or completion record</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record what was handed off, who owns the next step and the verified result." rows={4} /></div>
          </div>}
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
