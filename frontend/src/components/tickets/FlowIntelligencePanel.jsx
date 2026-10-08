import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Compass, RotateCcw, ShieldCheck, Target } from "lucide-react";
import {
  BREADCRUMB_KINDS,
  VERIFICATION_KINDS,
  closeoutCopy,
  contractPayload,
  contractFormErrors,
  contractStatus,
  deadEndEvidenceLines,
  deadEndStatus,
  evidenceNoteError,
  resumeLines,
  stalenessLabel,
} from "@/lib/flowIntelligence";

const TONES = {
  emerald: "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-200",
  amber: "border-amber-500/30 bg-amber-500/[0.08] text-amber-200",
  rose: "border-rose-500/30 bg-rose-500/[0.08] text-rose-200",
  zinc: "border-white/10 bg-white/[0.03] text-zinc-400",
};

const emptyContractForm = {
  outcome: "",
  preconditions: "",
  dependencies: "",
  acceptable_interruption: "",
  verification_method: "technician_witnessed",
  rollback: "",
  evidence_days: 14,
};

export default function FlowIntelligencePanel({ ticketId, headers }) {
  const [contract, setContract] = useState(null);
  const [status, setStatus] = useState(null);
  const [gate, setGate] = useState(null);
  const [form, setForm] = useState(emptyContractForm);
  const [formErrors, setFormErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [verifyKind, setVerifyKind] = useState("technician_witnessed");
  const [verifyNote, setVerifyNote] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [resumed, setResumed] = useState(null);
  const [health, setHealth] = useState(null);
  const [crumbKind, setCrumbKind] = useState("tested");
  const [crumbText, setCrumbText] = useState("");
  const [crumbScope, setCrumbScope] = useState("");
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadContract = useCallback(async () => {
    if (!ticketId) return;
    const { data } = await axios.get(`${API}/flow-intelligence/tickets/${ticketId}/outcome-contract`, { headers });
    setContract(data.contract);
    setStatus(data.status);
    setGate(data.closeout_gate);
    if (data.contract) {
      setForm({
        outcome: data.contract.outcome || "",
        preconditions: data.contract.preconditions || "",
        dependencies: (data.contract.dependencies || []).join(", "),
        acceptable_interruption: data.contract.acceptable_interruption || "",
        verification_method: data.contract.verification_method || "technician_witnessed",
        rollback: data.contract.rollback || "",
        evidence_days: data.contract.evidence_days || 14,
      });
      setVerifyKind(data.contract.verification_method || "technician_witnessed");
    }
  }, [ticketId, headers]);

  const loadBreadcrumbs = useCallback(async () => {
    if (!ticketId) return;
    const { data } = await axios.get(`${API}/flow-intelligence/tickets/${ticketId}/breadcrumbs`, { headers });
    setBreadcrumbs(data.breadcrumbs || []);
    setResumed(data);
  }, [ticketId, headers]);

  const loadHealth = useCallback(async () => {
    if (!ticketId) return;
    const { data } = await axios.get(`${API}/flow-intelligence/tickets/${ticketId}/investigation-health`, { headers });
    setHealth(data);
  }, [ticketId, headers]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([loadContract(), loadBreadcrumbs(), loadHealth()])
      .catch(() => {
        if (active) toast.error("Nexus could not load the outcome contract or the investigation breadcrumbs.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadContract, loadBreadcrumbs, loadHealth]);

  const saveContract = async () => {
    const errors = contractFormErrors(form);
    setFormErrors(errors);
    if (errors.length) return;
    const payload = contractPayload(form);
    if (!payload) return;
    setSaving(true);
    try {
      const { data } = await axios.put(`${API}/flow-intelligence/tickets/${ticketId}/outcome-contract`, payload, { headers });
      setContract(data.contract);
      setStatus(data.status);
      setGate(data.closeout_gate);
      toast.success("Outcome contract saved", {
        description: "The requested outcome is now separated from the method you will use to reach it.",
      });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The outcome contract could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const verifyOutcome = async () => {
    const error = evidenceNoteError(verifyNote);
    if (error) {
      toast.error(error);
      return;
    }
    setVerifying(true);
    try {
      const { data } = await axios.post(
        `${API}/flow-intelligence/tickets/${ticketId}/outcome-contract/verify`,
        { kind: verifyKind, evidence_note: verifyNote.trim(), evidence_days: Number(form.evidence_days) || 14 },
        { headers },
      );
      setStatus(data.status);
      setGate(data.closeout_gate);
      setContract(data.contract);
      setVerifyNote("");
      toast.success("Outcome verified", { description: data.status?.reason });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "The verification evidence was refused.");
    } finally {
      setVerifying(false);
    }
  };

  const recordBreadcrumb = async () => {
    const text = crumbText.trim();
    if (text.length < 3) {
      toast.error("Write what you found, tested or ruled out.");
      return;
    }
    setRecording(true);
    try {
      await axios.post(
        `${API}/flow-intelligence/tickets/${ticketId}/breadcrumbs`,
        { kind: crumbKind, text, scope_ref: crumbScope.trim() || null },
        { headers },
      );
      setCrumbText("");
      await Promise.all([loadBreadcrumbs(), loadHealth()]);
      toast.success("Breadcrumb recorded", { description: "Your reasoning is preserved for the next technician." });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "The breadcrumb could not be recorded.");
    } finally {
      setRecording(false);
    }
  };

  const standing = contractStatus(status?.status);
  const closeout = closeoutCopy(gate);
  const failedChecks = (status?.checks || []).filter((check) => !check.passed);
  const lines = resumeLines(resumed?.resume);
  const deadEnd = deadEndStatus(health?.verdict);
  const deadEndLines = deadEndEvidenceLines(health);

  return (
    <div className="space-y-4" data-testid="flow-intelligence-panel">
      <section className={`rounded-xl border p-4 ${TONES[closeout.tone]}`} data-testid="flow-closeout-gate">
        <div className="flex items-start gap-3">
          {gate?.allowed && gate?.status === "verified"
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <div>
            <p className="text-sm font-semibold">{closeout.label}</p>
            {closeout.detail && <p className="mt-1 text-xs leading-5 opacity-90">{closeout.detail}</p>}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012))] p-4">
        <header className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-400/20 bg-violet-500/[0.08]">
              <Target className="h-4 w-4 text-violet-200" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Outcome contract</h3>
              <p className="text-[11px] leading-4 text-zinc-400/70">
                What the customer must be able to do — not the command you chose to get there.
              </p>
            </div>
          </div>
          <Badge variant="outline" className={`ml-auto text-[10px] ${TONES[standing.tone]}`} data-testid="flow-contract-status">
            {standing.label}
          </Badge>
        </header>

        {status?.status === "insufficient" && failedChecks.length > 0 && (
          <ul className="mb-3 space-y-1 rounded-lg border border-rose-500/25 bg-rose-500/[0.05] p-3" data-testid="flow-contract-gaps">
            {failedChecks.map((check) => (
              <li key={check.name} className="text-[11px] leading-4 text-rose-200">
                <strong className="font-semibold">{check.name}:</strong> {check.detail}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <label className="block text-[11px] font-medium text-zinc-400" htmlFor="flow-outcome">Business outcome</label>
          <textarea
            id="flow-outcome"
            className="min-h-[64px] w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40"
            placeholder="Sarah must be able to open MYOB, reach the company database and generate an invoice."
            value={form.outcome}
            onChange={(event) => setForm({ ...form, outcome: event.target.value })}
            data-testid="flow-outcome-input"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-medium text-zinc-400" htmlFor="flow-preconditions">Preconditions</label>
              <input
                id="flow-preconditions"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40"
                value={form.preconditions}
                onChange={(event) => setForm({ ...form, preconditions: event.target.value })}
                data-testid="flow-preconditions-input"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-400" htmlFor="flow-interruption">Acceptable interruption</label>
              <input
                id="flow-interruption"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40"
                value={form.acceptable_interruption}
                onChange={(event) => setForm({ ...form, acceptable_interruption: event.target.value })}
                data-testid="flow-interruption-input"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-400" htmlFor="flow-method">Verification method</label>
              <select
                id="flow-method"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40"
                value={form.verification_method}
                onChange={(event) => setForm({ ...form, verification_method: event.target.value })}
                data-testid="flow-method-select"
              >
                {VERIFICATION_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value} className="bg-[#0d1117]">{kind.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-zinc-400" htmlFor="flow-evidence-days">Evidence valid (days)</label>
                <input
                  id="flow-evidence-days"
                  type="number"
                  min="1"
                  max="365"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40"
                  value={form.evidence_days}
                  onChange={(event) => setForm({ ...form, evidence_days: event.target.value })}
                  data-testid="flow-evidence-days-input"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-zinc-400" htmlFor="flow-dependencies">Dependencies</label>
                <input
                  id="flow-dependencies"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40"
                  placeholder="Comma separated"
                  value={form.dependencies}
                  onChange={(event) => setForm({ ...form, dependencies: event.target.value })}
                  data-testid="flow-dependencies-input"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-zinc-400" htmlFor="flow-rollback">Rollback</label>
            <textarea
              id="flow-rollback"
              className="mt-1 min-h-[52px] w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40"
              value={form.rollback}
              onChange={(event) => setForm({ ...form, rollback: event.target.value })}
              data-testid="flow-rollback-input"
            />
          </div>
        </div>

        {formErrors.length > 0 && (
          <ul className="mt-3 space-y-1 text-[11px] leading-4 text-rose-300" data-testid="flow-form-errors">
            {formErrors.map((error) => <li key={error}>• {error}</li>)}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={saveContract} disabled={saving} data-testid="flow-save-contract">
            {saving ? "Saving…" : contract ? "Update contract" : "Set outcome contract"}
          </Button>
          {contract && (
            <span className="text-[10px] text-zinc-500">
              Verification method: {VERIFICATION_KINDS.find((kind) => kind.value === contract.verification_method)?.label}
              {contract.evidence_expires_at && ` · evidence expires ${String(contract.evidence_expires_at).slice(0, 10)}`}
              {` · ${(contract.verification_history || []).length} recorded verification step(s)`}
            </span>
          )}
        </div>
      </section>

      {contract && (
        <section className="rounded-xl border border-white/[0.08] bg-black/10 p-4" data-testid="flow-verify">
          <header className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-200" />
            <h3 className="text-sm font-semibold text-zinc-100">Record verification evidence</h3>
          </header>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
            <select
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-400/40"
              value={verifyKind}
              onChange={(event) => setVerifyKind(event.target.value)}
              aria-label="Verification kind"
              data-testid="flow-verify-kind"
            >
              {VERIFICATION_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value} className="bg-[#0d1117]">{kind.label}</option>
              ))}
            </select>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-400/40"
              placeholder="What was observed? e.g. Sarah generated invoice INV-1043 in MYOB on the call."
              value={verifyNote}
              onChange={(event) => setVerifyNote(event.target.value)}
              aria-label="Verification evidence"
              data-testid="flow-verify-note"
            />
          </div>
          <Button size="sm" variant="outline" className="mt-2 border-cyan-400/25 text-cyan-100 hover:bg-cyan-400/[0.08]" onClick={verifyOutcome} disabled={verifying} data-testid="flow-verify-submit">
            {verifying ? "Recording…" : "Record verification"}
          </Button>
          <p className="mt-2 text-[10px] leading-4 text-zinc-500">
            A command exiting zero is not evidence. Nexus records what was observed and expires it, so an unproven
            outcome can never be presented as a fix.
          </p>
        </section>
      )}

      {health && health.verdict !== "insufficient_evidence" && (
        <section className={`rounded-xl border p-4 ${TONES[deadEnd.tone]}`} data-testid="flow-dead-end">
          <header className="mb-2 flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold" data-testid="flow-dead-end-verdict">{deadEnd.label}</h3>
              <p className="text-[11px] leading-4 opacity-90">{health.reason}</p>
            </div>
          </header>
          <dl className="grid gap-1 sm:grid-cols-2" data-testid="flow-dead-end-evidence">
            {deadEndLines.map((line) => (
              <div key={line.label} className="flex flex-wrap gap-1.5 text-[11px] leading-4">
                <dt className="font-semibold opacity-90">{line.label}:</dt>
                <dd>{line.text}</dd>
              </div>
            ))}
          </dl>
          {health.recommended_test && (
            <p className="mt-2 rounded-lg border border-white/15 bg-black/20 p-2.5 text-[11px] leading-4 text-zinc-200" data-testid="flow-dead-end-recommendation">
              <strong className="font-semibold">Recommended:</strong> {health.recommended_test}
            </p>
          )}
          {health.boundary && <p className="mt-2 text-[10px] leading-4 opacity-80">{health.boundary}</p>}
        </section>
      )}

      <section className="rounded-xl border border-white/[0.08] bg-[linear-gradient(135deg,rgba(34,211,238,0.045),rgba(255,255,255,0.012))] p-4" data-testid="flow-breadcrumbs">
        <header className="mb-3 flex flex-wrap items-center gap-2">
          <Compass className="h-4 w-4 text-cyan-200" />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Breadcrumb Rescue</h3>
            <p className="text-[11px] leading-4 text-zinc-400/70">
              Your investigation, restored — including which earlier conclusions the record has moved past.
            </p>
          </div>
          {resumed?.stale_count > 0 && (
            <Badge variant="outline" className={`ml-auto text-[10px] ${TONES.rose}`} data-testid="flow-stale-count">
              {resumed.stale_count} to re-check
            </Badge>
          )}
        </header>

        {lines.length > 0 ? (
          <dl className="mb-3 space-y-1.5" data-testid="flow-resume">
            {lines.map((line) => (
              <div key={line.label} className="flex flex-wrap gap-1.5 text-[11px] leading-4">
                <dt className="font-semibold text-cyan-200">{line.label}:</dt>
                <dd className="text-zinc-300">{line.text}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mb-3 text-[11px] text-zinc-500">No breadcrumbs recorded for this ticket yet.</p>
        )}

        {(resumed?.stale || []).length > 0 && (
          <ul className="mb-3 space-y-2" data-testid="flow-stale-list">
            {resumed.stale.map((item) => {
              const label = stalenessLabel(item);
              return (
                <li key={`${item.kind}-${item.formed_at}-${item.text}`} className={`rounded-lg border p-2.5 text-[11px] leading-4 ${TONES[label.tone]}`}>
                  <div className="flex items-center gap-1.5 font-semibold">
                    <RotateCcw className="h-3 w-3" />{label.label} · {item.kind.replace("_", " ")}
                  </div>
                  <p className="mt-1 text-zinc-200">{item.text}</p>
                  <p className="mt-1 opacity-85">{label.detail}</p>
                </li>
              );
            })}
          </ul>
        )}

        <div className="grid gap-2 sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)_minmax(0,130px)]">
          <select
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-400/40"
            value={crumbKind}
            onChange={(event) => setCrumbKind(event.target.value)}
            aria-label="Breadcrumb kind"
            data-testid="flow-crumb-kind"
          >
            {BREADCRUMB_KINDS.map((kind) => (
              <option key={kind.value} value={kind.value} className="bg-[#0d1117]">{kind.label}</option>
            ))}
          </select>
          <input
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-400/40"
            placeholder="e.g. DNS and routing ruled out; SQL connectivity is the remaining suspect"
            value={crumbText}
            onChange={(event) => setCrumbText(event.target.value)}
            aria-label="Breadcrumb"
            data-testid="flow-crumb-text"
          />
          <input
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-400/40"
            placeholder="Device ID"
            value={crumbScope}
            onChange={(event) => setCrumbScope(event.target.value)}
            aria-label="Scope reference"
            data-testid="flow-crumb-scope"
          />
        </div>
        <Button size="sm" variant="outline" className="mt-2 border-cyan-400/25 text-cyan-100 hover:bg-cyan-400/[0.08]" onClick={recordBreadcrumb} disabled={recording} data-testid="flow-record-crumb">
          {recording ? "Recording…" : "Record breadcrumb"}
        </Button>

        {breadcrumbs.length > 0 && (
          <ol className="mt-3 space-y-1 border-t border-white/[0.06] pt-3" data-testid="flow-breadcrumb-list">
            {breadcrumbs.map((crumb) => (
              <li key={crumb.id} className="flex gap-2 text-[11px] leading-5 text-zinc-400">
                <span className="min-w-[86px] shrink-0 font-medium uppercase tracking-wide text-zinc-500">{crumb.kind.replace("_", " ")}</span>
                <span className="text-zinc-300">{crumb.text}</span>
                {crumb.scope_ref && <span className="ml-auto shrink-0 text-zinc-600">{crumb.scope_ref}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {loading && <p className="text-[11px] text-zinc-500">Loading the outcome contract and investigation…</p>}
    </div>
  );
}
