import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, FlaskConical, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

const KINDS = ["script", "package", "policy", "automation", "agent_update", "connector"];

const VERDICT_TONE = {
  pass: "border-emerald-400/30 text-emerald-200",
  needs_review: "border-amber-400/30 text-amber-200",
  fail: "border-rose-400/30 text-rose-200",
};

function parseCandidate(text) {
  const candidate = {};
  text.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const index = line.indexOf("=");
    if (index > 0) candidate[line.slice(0, index).trim().slice(0, 60)] = line.slice(index + 1).trim().slice(0, 500);
  });
  return candidate;
}

/**
 * Pre-rollout bench — the merged home for roadmap #502 (Nexus Test
 * Environment). Representative, non-production simulations of scripts,
 * packages, policies, automations, agent updates and connectors before broad
 * rollout. The bench never executes on endpoints and never accepts credential
 * material.
 */
export default function PreRolloutBenchPanel() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [runs, setRuns] = useState([]);
  const [boundary, setBoundary] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ kind: "package", name: "", representative_scope: "", candidate: "" });
  const [clearing, setClearing] = useState("");
  const [clearNote, setClearNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/nexus-proving-ground/pre-rollout-runs`, { headers });
      setRuns(response.data?.runs || []);
      setBoundary(response.data?.boundary || "");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Pre-rollout runs could not be loaded");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const simulate = async () => {
    setSaving(true);
    try {
      const response = await axios.post(`${API}/nexus-proving-ground/pre-rollout-runs`, {
        kind: form.kind,
        name: form.name.trim(),
        representative_scope: form.representative_scope.trim(),
        candidate: parseCandidate(form.candidate),
      }, { headers });
      toast.success(`Simulation recorded — verdict: ${response.data?.verdict}.`);
      setForm({ kind: "package", name: "", representative_scope: "", candidate: "" });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Simulation could not be recorded");
    } finally {
      setSaving(false);
    }
  };

  const clearRun = async (runId) => {
    if (!clearNote.trim()) return;
    setSaving(true);
    try {
      await axios.post(`${API}/nexus-proving-ground/pre-rollout-runs/${runId}/clear`, { evidence_note: clearNote.trim() }, { headers });
      toast.success("Simulation cleared for rollout with retained approval evidence.");
      setClearing(""); setClearNote("");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Run could not be cleared");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-amber-400/20 bg-amber-400/[0.03]" data-testid="pre-rollout-bench-panel">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200">Pre-rollout bench · test environment</p>
            <p className="mt-1 text-sm font-semibold">Prove a candidate in simulation before it reaches managed endpoints.</p>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{boundary}</p>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>
        </div>

        <div className="grid gap-2 lg:grid-cols-4">
          <Select value={form.kind} onValueChange={(value) => setForm({ ...form, kind: value })}>
            <SelectTrigger data-testid="bench-kind"><SelectValue /></SelectTrigger>
            <SelectContent>{KINDS.map((kind) => <SelectItem key={kind} value={kind}>{kind.replace("_", " ")}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Candidate name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} data-testid="bench-name" />
          <Input placeholder="Representative scope (e.g. lab ring devices)" value={form.representative_scope} onChange={(event) => setForm({ ...form, representative_scope: event.target.value })} data-testid="bench-scope" />
          <Button onClick={simulate} disabled={saving || form.name.trim().length < 3 || form.representative_scope.trim().length < 3} data-testid="bench-simulate">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><FlaskConical className="mr-1.5 h-3.5 w-3.5" />Simulate</>}
          </Button>
        </div>
        <textarea
          className="min-h-16 w-full rounded-md border border-border bg-background/60 px-3 py-2 text-xs"
          placeholder={"Candidate metadata as key=value lines — e.g. publisher=7-Zip, checksum=sha256:… (references only; credential material is refused)"}
          value={form.candidate}
          onChange={(event) => setForm({ ...form, candidate: event.target.value })}
          data-testid="bench-candidate"
        />

        <div className="space-y-2">
          {loading ? <p className="text-xs text-muted-foreground">Loading simulations…</p> : runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No simulations yet. Run a candidate through the bench before any broad rollout.</p>
          ) : runs.map((run) => (
            <div key={run.id} className="rounded-xl border border-border/60 p-3" data-testid={`bench-run-${run.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{run.name} <span className="text-[11px] text-muted-foreground">· {String(run.kind).replace("_", " ")} · {run.representative_scope}</span></p>
                  <p className="text-[11px] text-muted-foreground">{run.checks_passed}/{run.checks_total} checks passed{run.clearance ? ` · cleared by ${run.clearance.cleared_by}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={VERDICT_TONE[run.verdict] || "text-muted-foreground"}>{run.verdict?.replace("_", " ")}</Badge>
                  {run.status === "cleared_for_rollout" ? (
                    <Badge variant="outline" className="border-emerald-400/30 text-emerald-200">Cleared for rollout</Badge>
                  ) : clearing === run.id ? (
                    <div className="flex gap-1.5">
                      <Input className="h-8 w-52 text-xs" placeholder="Clearance evidence note" value={clearNote} onChange={(event) => setClearNote(event.target.value)} data-testid="bench-clear-note" />
                      <Button size="sm" className="h-8" onClick={() => clearRun(run.id)} disabled={saving || !clearNote.trim()}>Clear</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="h-8" disabled={run.verdict !== "pass"} onClick={() => { setClearing(run.id); setClearNote(""); }}>Clear for rollout</Button>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(run.checks || []).map((check) => (
                  <Badge key={check.name} variant="outline" className={`text-[9px] ${check.passed ? "border-emerald-400/25 text-emerald-200" : "border-rose-400/25 text-rose-200"}`} title={check.detail}>
                    {check.passed ? <CheckCircle2 className="mr-1 h-2.5 w-2.5" /> : <XCircle className="mr-1 h-2.5 w-2.5" />}{check.name}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
