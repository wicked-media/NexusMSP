import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import DevicePicker, { DeviceOrClientPicker } from "@/components/DevicePicker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Radar, Activity, Waypoints, BadgeCheck, Lock, Loader2,
} from "lucide-react";
import { Section } from "./toolboxShared";

// ============== ORCHESTRATION & TRUST: INVESTIGATE · STATE · FLEET · EVIDENCE · MODE ==============

function MissionControlInvestigate() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [problem, setProblem] = useState("Sarah cannot access Finance");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const investigate = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/mission-control/investigate`, { problem }, { headers });
      setResult(data);
      toast(data.resolved ? "Scope assembled from real records." : "Opened as awaiting subject — no device was invented.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not investigate that.");
    } finally {
      setBusy(false);
    }
  };

  const investigation = result?.investigation;
  return (
    <Section id="tool-mission-control" icon={Radar} title="Mission Control · Investigate" hint="Stop deciding which of eighty tools to open. Describe what appears wrong and Nexus assembles the scope, the tools worth opening, the hypotheses and the single next action — and says plainly when a human must decide instead of Nexus.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-72" value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="tell Nexus what appears wrong" data-testid="mci-problem" />
        <Button size="sm" onClick={investigate} disabled={busy || !problem.trim()} data-testid="mci-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Radar className="mr-1 h-3 w-3" />}Investigate
        </Button>
      </div>
      {investigation && (
        <div className="mt-3 space-y-2 text-xs nx-result-reveal" data-testid="mci-result">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-violet-300">{investigation.id}</Badge>
            <span className="text-muted-foreground">{investigation.status}</span>
            {investigation.subject?.label && <Badge className="bg-violet-500/20 text-violet-200">{investigation.subject.type}: {investigation.subject.label}</Badge>}
          </div>
          {investigation.scope?.rows?.map((row) => (
            <div key={row.kind} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className="text-violet-200">{row.kind} · {row.count}</span>
              <p className="mt-0.5 text-muted-foreground">{row.detail} <span className="opacity-60">({row.source})</span></p>
            </div>
          ))}
          <p className="text-muted-foreground">Next: <span className="text-violet-200">{investigation.next_action?.action}</span>
            {investigation.next_action?.execution_permitted === false ? " · execution not permitted right now" : ""}
          </p>
          {investigation.human_decision?.required && (
            <div className="rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">
              <p className="font-semibold">Human decision required</p>
              {investigation.human_decision.reasons?.map((reason, index) => (
                <p key={index} className="mt-0.5">{reason.reason} — {reason.detail}</p>
              ))}
            </div>
          )}
          <p className="text-muted-foreground">{result.note}</p>
        </div>
      )}
    </Section>
  );
}

function StateEngineDrift() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [deviceId, setDeviceId] = useState("dev-001");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const evaluate = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/state-engine/evaluate/${deviceId}`, { headers });
      setResult(data);
      toast(`met ${data.counts.met} · drifted ${data.counts.drifted} · unverified ${data.counts.unverified}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not evaluate that device.");
    } finally {
      setBusy(false);
    }
  };

  const proposes = async (driftId) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/drift/${driftId}/remediation`,
        { action: "Re-apply the declared baseline and restart the affected service", rollback: "Restore the previous configuration" }, { headers });
      toast(data.permitted ? "Plan stored. Nexus executes nothing — a human does." : data.note);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not propose remediation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="tool-state-engine" icon={Activity} title="State Engine · Drift Control" hint="Declare what a device should look like and reconcile it continuously: desired → actual → difference → remediation → verification. A check with no evidence in the record is reported unverified — Nexus never infers protection from a missing field.">
      <div className="flex flex-wrap gap-2">
        <DevicePicker value={deviceId} onChange={setDeviceId} testId="state-device" />
        <Button size="sm" onClick={evaluate} disabled={busy || !deviceId.trim()} data-testid="state-evaluate">Evaluate device</Button>
      </div>
      {result && (
        <div className="mt-3 space-y-1.5 text-xs nx-result-reveal" data-testid="state-result">
          <p className="font-semibold text-violet-200">
            {result.counts.met} met · {result.counts.drifted} drifted · {result.counts.unverified} unverified
          </p>
          {result.checks.map((check) => (
            <div key={check.check} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className={check.verdict === "met" ? "text-emerald-300" : check.verdict === "drifted" ? "text-amber-200" : "text-muted-foreground"}>
                {check.label} — {check.verdict}
              </span>
              <p className="mt-0.5 text-muted-foreground">expected {check.expected || "—"} · observed {check.observed ?? "no evidence"}</p>
            </div>
          ))}
          {result.drift?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {result.drift.map((finding) => (
                <Button key={finding.id} size="sm" variant="outline" onClick={() => proposes(finding.id)} disabled={busy} data-testid={`state-plan-${finding.check}`}>
                  Plan fix: {finding.check}
                </Button>
              ))}
            </div>
          )}
          <p className="text-muted-foreground">{result.note}</p>
        </div>
      )}
    </Section>
  );
}

function FleetShell() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [days, setDays] = useState(30);
  const [result, setResult] = useState(null);
  const [refined, setRefined] = useState(null);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/fleet/query`,
        { filters: [{ filter: "days_since_boot_gte", value: Number(days) }] }, { headers });
      setResult(data);
      setRefined(null);
      toast(`${data.count} device(s) — the answer is an object set, not a CSV.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not query the fleet.");
    } finally {
      setBusy(false);
    }
  };

  const refine = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const saved = await axios.post(`${API}/tech-fun/fleet/sets`,
        { label: `Not rebooted in ${days} days`, filters: [{ filter: "days_since_boot_gte", value: Number(days) }] }, { headers });
      const { data } = await axios.post(`${API}/tech-fun/fleet/sets/${saved.data.object_set.id}/refine`,
        { filters: [{ filter: "exclude_servers" }, { filter: "exclude_active_user" }] }, { headers });
      setRefined(data.object_set);
      toast(`${data.object_set.member_count} remain after excluding servers and active users.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not refine the set.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="tool-fleet-shell" icon={Waypoints} title="Fleet Shell" hint="Not terminal access — a question across the fleet whose answer is an actionable object set. Refine it, and a device the fleet has no evidence about is reported as unavailable rather than quietly counted or dropped.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-32" type="number" value={days} onChange={(e) => setDays(e.target.value)} title="days since boot" data-testid="fleet-days" />
        <Button size="sm" onClick={ask} disabled={busy} data-testid="fleet-ask">Which endpoints haven&apos;t rebooted?</Button>
        <Button size="sm" variant="outline" onClick={refine} disabled={busy || !result} data-testid="fleet-refine">Exclude servers &amp; active users</Button>
      </div>
      {result && (
        <div className="mt-3 space-y-1.5 text-xs nx-result-reveal" data-testid="fleet-result">
          <p className="font-semibold text-violet-200">{result.count} device(s) in the answer</p>
          <p className="text-muted-foreground">
            excluded — servers {result.excluded?.servers || 0}, active user {result.excluded?.active_user || 0},
            no evidence {result.excluded?.unavailable || 0}
          </p>
          {result.devices?.slice(0, 5).map((device) => (
            <p key={device.id} className="text-muted-foreground">{device.hostname} · {device.client_name || device.client_id}</p>
          ))}
          <p className="text-muted-foreground">{result.note}</p>
        </div>
      )}
      {refined && (
        <div className="mt-2 rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs" data-testid="fleet-refined">
          <p className="text-violet-200">{refined.id} · {refined.member_count} of {refined.lineage ? "the original set" : "—"}</p>
          <p className="mt-0.5 text-muted-foreground">A new set was created; the original was not modified.</p>
        </div>
      )}
    </Section>
  );
}

function EvidenceEngine() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ operation: "restart_spooler", target_type: "device", target_id: "dev-001" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const record = async (observeSecond) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/evidence`, {
        operation: form.operation, target_type: form.target_type || "device", target_id: form.target_id,
        method: "agent command", actor_kind: "technician", outcome: "success",
        required_checks: ["service_running", "service_autostart"],
        checks: observeSecond
          ? [{ check: "service_running", observed: true }, { check: "service_autostart", observed: true }]
          : [{ check: "service_running", observed: true }],
      }, { headers });
      const verified = await axios.post(`${API}/tech-fun/evidence/${data.evidence.id}/verify`, {}, { headers });
      setResult({ evidence: data.evidence, verdict: verified.data.verdict });
      toast(`${verified.data.verdict.verdict}: ${verified.data.verdict.reason}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the evidence.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="tool-evidence-engine" icon={BadgeCheck} title="Evidence Engine" hint='Proof that an operation actually succeeded, instead of “the script exited zero”. A verdict is verified only when every required check carries a real observation — a success with an unobserved check is partial, not proven.'>
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-44" value={form.operation} onChange={(e) => setForm({ ...form, operation: e.target.value })} placeholder="operation" data-testid="evidence-operation" />
        <DeviceOrClientPicker value={form.target_id} targetType={form.target_type || "device"} onChange={(id, kind) => setForm({ ...form, target_id: id, target_type: kind })} testId="evidence-target" />
        <Button size="sm" onClick={() => record(false)} disabled={busy} data-testid="evidence-partial">Prove it — one check observed</Button>
        <Button size="sm" variant="outline" onClick={() => record(true)} disabled={busy} data-testid="evidence-proven">Prove it — all checks observed</Button>
      </div>
      {result && (
        <div className="mt-3 space-y-1.5 text-xs nx-result-reveal" data-testid="evidence-result">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-violet-300">{result.evidence.id}</Badge>
            <Badge className={result.verdict.verdict === "verified" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"}>
              {result.verdict.verdict}
            </Badge>
          </div>
          <p className="text-muted-foreground">{result.verdict.reason}</p>
          <p className="text-muted-foreground">observed: {result.verdict.observed_checks?.join(", ") || "none"} · required: {result.verdict.required_checks?.join(", ")}</p>
          <p className="text-muted-foreground">entry hash {String(result.evidence.chain?.entry_hash || "").slice(0, 16)}… (hash-chained per tenant)</p>
        </div>
      )}
    </Section>
  );
}

function OperationalMode() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [reason, setReason] = useState("suspected compromise under investigation");
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/operational-mode`, { headers });
      setMode(data.mode);
    } catch {
      toast.error("Could not read the operational mode.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (next) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/operational-mode`,
        { mode: next, reason, capabilities: next === "frozen" ? ["software_deployment"] : [] }, { headers });
      setMode(data.mode);
      toast(data.note);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Mode change refused.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="tool-operational-mode" icon={Lock} title="Operational Mode · Safe Mode" hint="Deterministic control during an incident: normal, observe-only (Nexus detects and recommends but executes nothing), or a scoped freeze. A written reason is mandatory, and the response states honestly which layers consult it and which still do not.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-72" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why are you stopping things" data-testid="ops-reason" />
        <Button size="sm" onClick={() => apply("observe_only")} disabled={busy || !reason.trim()} data-testid="ops-observe">Observe only</Button>
        <Button size="sm" variant="outline" onClick={() => apply("frozen")} disabled={busy || !reason.trim()} data-testid="ops-freeze">Freeze software deployment</Button>
        <Button size="sm" variant="outline" onClick={() => apply("normal")} disabled={busy || !reason.trim()} data-testid="ops-normal">Resume normal</Button>
        <Button size="sm" variant="outline" onClick={load} disabled={busy} data-testid="ops-load">Show mode</Button>
      </div>
      {mode && (
        <div className="mt-3 text-xs" data-testid="ops-result">
          <p className="font-semibold text-violet-200">
            {mode.mode}{mode.frozen_capabilities?.length ? ` · ${mode.frozen_capabilities.join(", ")}` : ""}
            {mode.frozen_clients?.length ? ` · ${mode.frozen_clients.join(", ")}` : ""}
          </p>
          {mode.reason && <p className="mt-0.5 text-muted-foreground">reason: {mode.reason}</p>}
          <p className="mt-1 text-muted-foreground">{mode.note}</p>
        </div>
      )}
    </Section>
  );
}

export {
  MissionControlInvestigate,
  StateEngineDrift,
  FleetShell,
  EvidenceEngine,
  OperationalMode,
};
