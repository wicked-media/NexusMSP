import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import DevicePicker, { ClientPicker } from "@/components/DevicePicker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Stethoscope, Crosshair, Radio, UserCheck, LifeBuoy, Loader2,
} from "lucide-react";
import { Section } from "./toolboxShared";

// ============== TECHNICIAN OS: WORKBENCH · FIND · RECORDER · SYNTHETIC · RESCUE ==============

const RESCUE_SYMPTOMS = ["agent_dead", "no_boot", "network_stack", "update_broke_startup", "unknown"];

function DiagnosticWorkbench() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ symptom: "Sarah cannot access MYOB", subject_type: "device", subject_id: "dev-001" });
  const [investigation, setInvestigation] = useState(null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/diagnostics/investigations`, form, { headers });
      setInvestigation(data.investigation);
      toast.success("Investigation opened — evidence moves these probabilities.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not open the investigation.");
    } finally {
      setBusy(false);
    }
  };

  const recordEvidence = async (result) => {
    const test = investigation?.next_test?.test;
    if (!test) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/diagnostics/investigations/${investigation.id}/evidence`,
        { test, result }, { headers });
      setInvestigation(data.investigation);
      toast.success(result === "inconclusive" ? "Recorded — it changed nothing, honestly." : "Hypotheses updated.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the evidence.");
    } finally {
      setBusy(false);
    }
  };

  const close = async (outcome) => {
    if (!investigation) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/diagnostics/investigations/${investigation.id}/close`,
        { outcome, root_cause: investigation.root_cause?.domain || "" }, { headers });
      setInvestigation(data.investigation);
      toast.success(`Closed as ${data.investigation.closed_outcome}.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not close it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="tool-diagnostic-workbench" icon={Stethoscope} title="Diagnostic Workbench" hint="One investigation instead of eighty tools: the plausible cause domains, the evidence recorded so far, and the single next test that eliminates the most uncertainty. Probabilities are arithmetic on published heuristics — unrecorded tests never count as passed.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-64" value={form.symptom} onChange={(e) => setForm({ ...form, symptom: e.target.value })} placeholder="symptom" data-testid="inv-symptom" />
        <select className="h-8 rounded-md border border-border bg-card px-2 text-xs" value={form.subject_type} onChange={(e) => setForm({ ...form, subject_type: e.target.value })} data-testid="inv-subject-type">
          <option value="device">device</option>
          <option value="user">user</option>
          <option value="client">client</option>
        </select>
        <Input className="h-8 w-32" value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} placeholder="subject ID" data-testid="inv-subject-id" />
        <Button size="sm" onClick={open} disabled={busy || !form.symptom.trim() || !form.subject_id.trim()} data-testid="inv-open">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Stethoscope className="mr-1 h-3 w-3" />}Open investigation
        </Button>
      </div>
      {investigation && (
        <div className="mt-3 space-y-2 text-xs" data-testid="inv-result">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-violet-300">{investigation.id}</Badge>
            <span className="text-muted-foreground">{investigation.status} · {investigation.evidence_count} evidence</span>
            {investigation.isolated && <Badge className="bg-emerald-500/20 text-emerald-300">root cause isolated</Badge>}
          </div>
          {investigation.hypotheses.map((h) => (
            <div key={h.domain}>
              <div className="flex items-center justify-between">
                <span className="text-violet-200">{h.label}</span>
                <span className="text-muted-foreground">{(h.probability * 100).toFixed(1)}%</span>
              </div>
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded bg-violet-500/10">
                <div className="h-full bg-violet-400/70" style={{ width: `${h.probability * 100}%` }} />
              </div>
            </div>
          ))}
          {investigation.next_test ? (
            <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <p className="text-violet-200">Next best test: {investigation.next_test.label} (+{investigation.next_test.expected_information_gain} bits)</p>
              <p className="mt-0.5 text-muted-foreground">Evidence source: {investigation.next_test.source}</p>
              <div className="mt-1.5 flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => recordEvidence("abnormal")} disabled={busy} data-testid="inv-abnormal">Abnormal</Button>
                <Button size="sm" variant="outline" onClick={() => recordEvidence("normal")} disabled={busy} data-testid="inv-normal">Normal</Button>
                <Button size="sm" variant="outline" onClick={() => recordEvidence("inconclusive")} disabled={busy} data-testid="inv-inconclusive">Could not test</Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No remaining test can change the answer — fix it and re-run the discriminating test to verify.</p>
          )}
          {investigation.status === "open" && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={() => close("resolved")} disabled={busy || !investigation.isolated} data-testid="inv-resolve">Resolve</Button>
              <Button size="sm" variant="outline" onClick={() => close("inconclusive")} disabled={busy} data-testid="inv-inconclusive-close">Close unresolved</Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function FindEverywhere() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [query, setQuery] = useState("192.168.1.14");
  const [result, setResult] = useState(null);
  const [literals, setLiterals] = useState(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/find`, { params: { q: query }, headers });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  const hunt = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/find/literals`, { kind: "auto" }, { headers });
      setLiterals(data);
      toast.success(`${data.count} hardcoded literal(s) found in the stores Nexus can see.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Scan failed.");
    } finally {
      setBusy(false);
    }
  };

  const impact = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/find/change-impact`, { value: query }, { headers });
      setResult({ groups: data.groups, total: data.total, empty: data.empty, note: data.note });
      toast(data.risk_band.reason);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not work out the impact.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="tool-find-everywhere" icon={Crosshair} title="Find Everywhere" hint="Where else does this value appear? One IP, hostname or domain across every store Nexus owns — then what breaks if you change it. Nexus cannot see hardcoded values inside applications, appliances or firmware, and says so rather than implying clean.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-56" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="IP, hostname or domain" data-testid="find-query" />
        <Button size="sm" onClick={search} disabled={busy || !query.trim()} data-testid="find-search">Search every store</Button>
        <Button size="sm" variant="outline" onClick={impact} disabled={busy || !query.trim()} data-testid="find-impact">Change impact</Button>
        <Button size="sm" variant="outline" onClick={hunt} disabled={busy} data-testid="find-hunt">Hunt hardcoded literals</Button>
      </div>
      {result && (
        <div className="mt-3 space-y-1.5 text-xs nx-result-reveal" data-testid="find-result">
          <p className="font-semibold text-violet-200">{result.total} reference(s) across {result.groups?.length || 0} store(s)</p>
          {result.groups?.map((group) => (
            <div key={group.source} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className="text-violet-200">{group.label} ({group.count}) · {group.owner}</span>
              {group.hits.slice(0, 3).map((hit) => (
                <p key={hit.id} className="mt-0.5 text-muted-foreground">{hit.label} — {hit.matched_fields.join(", ")}</p>
              ))}
            </div>
          ))}
          <p className="text-muted-foreground">{result.note}</p>
        </div>
      )}
      {literals && (
        <div className="mt-3 space-y-1 text-xs" data-testid="find-literals">
          <p className="font-semibold text-amber-200">{literals.count} literal(s) in {literals.scanned?.documents} document(s)</p>
          {literals.literals?.slice(0, 6).map((item) => (
            <p key={`${item.kind}-${item.value}`} className="text-muted-foreground">
              {item.value} · {item.kind}{item.private ? " · private" : ""} · {item.occurrences}× in {item.sources.join(", ")}
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}

function CommandRecorder() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ label: "Print spooler hangs", device_id: "dev-001" });
  const [session, setSession] = useState(null);
  const [command, setCommand] = useState("Restart-Service Spooler -Force");
  const [runbook, setRunbook] = useState(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/recorder/sessions`, { ...form, kind: "manual_fix" }, { headers });
      setSession(data.session);
      setRunbook(null);
      toast.success("Recording. Secrets are redacted before anything is stored.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not start recording.");
    } finally {
      setBusy(false);
    }
  };

  const step = async (kind) => {
    if (!session) return;
    setBusy(true);
    try {
      const payload = kind === "command" ? { kind, command } : { kind, detail: "test page printed" };
      const { data } = await axios.post(`${API}/tech-fun/recorder/sessions/${session.id}/steps`, payload, { headers });
      setSession(data.session);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the step.");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/recorder/sessions/${session.id}/end`, { outcome: "success" }, { headers });
      setSession(data.session);
      toast.success(data.note);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not close the session.");
    } finally {
      setBusy(false);
    }
  };

  const propose = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/recorder/sessions/${session.id}/runbook`, {}, { headers });
      setRunbook(data.runbook);
      toast.success("Draft runbook proposed — a human must review it.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not draft a runbook.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!runbook) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/recorder/runbooks/${runbook.id}/verify`, { outcome: "success" }, { headers });
      setRunbook(data.runbook);
      toast(data.note);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not verify.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Radio} title="Command Recorder" hint="Fix it by hand, and Nexus asks the useful question: save this as a runbook? Recorded steps become prerequisites, variables, actions, verification and rollback. Three verified successes make it an autonomy candidate — never autonomous without explicit approval.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-52" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="what are you fixing" data-testid="rec-label" />
        <DevicePicker value={form.device_id} onChange={(v) => setForm({ ...form, device_id: v })} testId="rec-device" />
        <Button size="sm" onClick={start} disabled={busy || !form.label.trim()} data-testid="rec-start">Start recording</Button>
      </div>
      {session && (
        <div className="mt-3 space-y-2 text-xs" data-testid="rec-result">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-violet-300">{session.id}</Badge>
            <span className="text-muted-foreground">{session.status} · {session.steps.length} step(s){session.outcome ? ` · ${session.outcome}` : ""}</span>
          </div>
          {session.status === "recording" && (
            <div className="flex flex-wrap gap-2">
              <Input className="h-8 w-64" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="command" data-testid="rec-command" />
              <Button size="sm" variant="outline" onClick={() => step("command")} disabled={busy} data-testid="rec-step">Record command</Button>
              <Button size="sm" variant="outline" onClick={() => step("verification")} disabled={busy} data-testid="rec-verify-step">Record verification</Button>
              <Button size="sm" variant="outline" onClick={finish} disabled={busy} data-testid="rec-end">End — it worked</Button>
            </div>
          )}
          {session.steps.map((s) => (
            <p key={s.index} className="text-muted-foreground">{s.index}. [{s.kind}] {s.command || s.detail}</p>
          ))}
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={propose} disabled={busy} data-testid="rec-propose">Save as runbook</Button>
            <Button size="sm" variant="outline" onClick={verify} disabled={busy || !runbook} data-testid="rec-verify">Verify success</Button>
          </div>
          {runbook && (
            <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5" data-testid="rec-runbook">
              <p className="text-violet-200">{runbook.id} · {runbook.status} · {runbook.verified_successes} verified success(es){runbook.autonomy_candidate ? " · autonomy candidate" : ""}</p>
              <p className="mt-0.5 text-muted-foreground">prerequisites: {runbook.prerequisites?.length || 0} · variables: {(runbook.variables || []).join(", ") || "none"} · actions: {runbook.actions?.length || 0} · verification: {runbook.verification?.length || 0} · rollback: {runbook.rollback?.length || 0}</p>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function SyntheticEmployee() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ label: "Payroll workflow", client_id: "client-001", checks: "authenticate,send_test_mail" });
  const [identity, setIdentity] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const register = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/synthetic/identities`, {
        label: form.label, client_id: form.client_id,
        checks: form.checks.split(",").map((c) => c.trim()).filter(Boolean),
      }, { headers });
      setIdentity(data.identity);
      toast.success("Test identity registered — by vault reference, never a credential.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not register the identity.");
    } finally {
      setBusy(false);
    }
  };

  const run = async (failLast) => {
    if (!identity) return;
    const checks = identity.checks || [];
    setBusy(true);
    try {
      const results = checks.map((check, index) => ({
        check,
        verdict: failLast && index === checks.length - 1 ? "fail" : "pass",
        detail: failLast && index === checks.length - 1 ? "relay refused" : "",
      }));
      const { data } = await axios.post(`${API}/tech-fun/synthetic/runs`, { identity_id: identity.id, results }, { headers });
      toast(data.run.business_statement);
      const { data: fresh } = await axios.get(`${API}/tech-fun/synthetic/identities/${identity.id}`, { headers });
      setStatus(fresh);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={UserCheck} title="Synthetic Employee" hint="Not 'server responds' — 'the payroll application actually works'. A test identity runs safe read-only business checks and reports an honest verdict: partial evidence is never called healthy.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-44" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="business workflow" data-testid="syn-label" />
        <ClientPicker value={form.client_id} onChange={(v) => setForm({ ...form, client_id: v })} testId="syn-client" className="w-44" />
        <Input className="h-8 w-64" value={form.checks} onChange={(e) => setForm({ ...form, checks: e.target.value })} placeholder="checks, comma separated" data-testid="syn-checks" />
        <Button size="sm" onClick={register} disabled={busy || !form.label.trim()} data-testid="syn-register">Register identity</Button>
      </div>
      {identity && (
        <div className="mt-3 space-y-2 text-xs" data-testid="syn-result">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-violet-300">{identity.id}</Badge>
            <span className="text-muted-foreground">{identity.checks.join(", ")} · every {(identity.interval_minutes || 30)} min</span>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => run(false)} disabled={busy} data-testid="syn-pass">Record a healthy run</Button>
            <Button size="sm" variant="outline" onClick={() => run(true)} disabled={busy} data-testid="syn-fail">Record a failing run</Button>
          </div>
          {status?.latest_run && (
            <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <p className="text-violet-200">{status.latest_run.verdict} — {status.latest_run.business_statement}</p>
              <p className="mt-0.5 text-muted-foreground">coverage: {status.latest_run.coverage?.ran}/{status.latest_run.coverage?.declared} ran · {status.latest_run.coverage?.unavailable} unavailable</p>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function NexusRescue() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ device_id: "dev-001", symptom: "no_boot" });
  const [assessment, setAssessment] = useState(null);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);

  const assess = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/rescue/assess`, form, { headers });
      setAssessment(data);
      setSession(null);
      toast(data.reachability_note);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not assess the device.");
    } finally {
      setBusy(false);
    }
  };

  const plan = async () => {
    setBusy(true);
    try {
      const reachable = (assessment?.capabilities || []).filter((c) => c.reachable).map((c) => c.capability);
      const { data } = await axios.post(`${API}/tech-fun/rescue/sessions`, {
        ...form, capabilities: reachable.slice(0, 2).length ? reachable.slice(0, 2) : ["collect_logs"],
      }, { headers });
      setSession(data.session);
      toast.success(data.note || "Recovery planned — Nexus never claims a remote execution.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not plan the recovery.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={LifeBuoy} title="Nexus Rescue" hint="What happens when the machine is broken badly enough that the agent does not work. Nexus reports only what is actually reachable from real evidence and produces a reviewed recovery plan — it never claims a remote execution the agent cannot perform.">
      <div className="flex flex-wrap gap-2">
        <DevicePicker value={form.device_id} onChange={(v) => setForm({ ...form, device_id: v })} testId="rescue-device" />
        <select className="h-8 rounded-md border border-border bg-card px-2 text-xs" value={form.symptom} onChange={(e) => setForm({ ...form, symptom: e.target.value })} data-testid="rescue-symptom">
          {RESCUE_SYMPTOMS.map((symptom) => <option key={symptom} value={symptom}>{symptom}</option>)}
        </select>
        <Button size="sm" onClick={assess} disabled={busy || !form.device_id.trim()} data-testid="rescue-assess">Assess reachability</Button>
        <Button size="sm" variant="outline" onClick={plan} disabled={busy || !assessment} data-testid="rescue-plan">Plan recovery</Button>
      </div>
      {assessment && (
        <div className="mt-3 space-y-2 text-xs" data-testid="rescue-result">
          <div className="flex items-center gap-2">
            <Badge className={assessment.agent_reachable ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"}>
              {assessment.agent_reachable ? "agent reachable" : "agent not reachable"}
            </Badge>
            <span className="text-muted-foreground">{assessment.symptom}</span>
          </div>
          <p className="text-muted-foreground">{assessment.reachability_note}</p>
          <p className="text-muted-foreground">out-of-band required: {assessment.out_of_band_required?.join(", ") || "none"}</p>
          <div className="flex flex-wrap gap-1">
            {(assessment.capabilities || []).map((c) => (
              <span key={c.capability} className={`rounded border px-1.5 py-0.5 ${c.reachable ? "border-emerald-500/30 text-emerald-300" : "border-border text-muted-foreground"}`}>
                {c.capability}
              </span>
            ))}
          </div>
          <p className="text-muted-foreground">recommended path: {(assessment.recommended_path || []).join(" → ")}</p>
        </div>
      )}
      {session && (
        <div className="mt-3 rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs" data-testid="rescue-session">
          <p className="text-violet-200">{session.id} · {session.status} · approval required</p>
          <p className="mt-0.5 text-muted-foreground">{(session.capabilities || []).map((c) => c.capability || c).join(", ")}</p>
        </div>
      )}
    </Section>
  );
}

export {
  RESCUE_SYMPTOMS,
  DiagnosticWorkbench,
  FindEverywhere,
  CommandRecorder,
  SyntheticEmployee,
  NexusRescue,
};
