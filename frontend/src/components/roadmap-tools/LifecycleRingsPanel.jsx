import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Rocket, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";

const RING_ORDER = ["test", "canary", "pilot", "broad"];

const RING_STATUS_TONE = {
  staging: "border-amber-400/30 text-amber-200",
  verified: "border-emerald-400/30 text-emerald-200",
  rolled_back: "border-rose-400/30 text-rose-200",
};

/**
 * Lifecycle rings — staged rollout governance merged into the Nexus
 * Application Manager (roadmap #500). A ring opens only when every earlier
 * ring is verified, and rollback evidence is always retained. Governance
 * records only: no endpoint deployment is dispatched here.
 */
export default function LifecycleRingsPanel() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [plans, setPlans] = useState([]);
  const [boundary, setBoundary] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ application_name: "", version: "", kind: "test", cohort: "", verification: "", rollback_plan: "" });
  const [evidenceFor, setEvidenceFor] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/application-manager/lifecycle-rings`, { headers });
      setPlans(response.data?.plans || []);
      setBoundary(response.data?.execution_boundary || "");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Lifecycle rings could not be loaded");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const nextKindFor = (rings) => {
    const verified = new Set(rings.filter((ring) => ["verified", "completed"].includes(ring.status)).map((ring) => ring.kind));
    return RING_ORDER.find((kind) => !verified.has(kind));
  };

  const createRing = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/application-manager/lifecycle-rings`, form, { headers });
      toast.success("Rollout ring opened with its verification and rollback evidence recorded.");
      setForm({ application_name: "", version: "", kind: "test", cohort: "", verification: "", rollback_plan: "" });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Rollout ring could not be opened");
    } finally {
      setSaving(false);
    }
  };

  const actOnRing = async (ringId, action) => {
    if (!evidenceNote.trim()) return;
    setSaving(true);
    try {
      await axios.post(`${API}/application-manager/lifecycle-rings/${ringId}/${action}`, { evidence_note: evidenceNote.trim() }, { headers });
      toast.success(action === "verify" ? "Verification evidence retained — the next ring can open." : "Rollback evidence retained; this ring's rollout is stopped.");
      setEvidenceFor(""); setEvidenceNote("");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ring evidence could not be recorded");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-violet-400/20 bg-violet-400/[0.03]" data-testid="lifecycle-rings-panel">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200">Lifecycle rings · staged rollout</p>
            <p className="mt-1 text-sm font-semibold">Test → canary → pilot → broad, each ring proven before the next opens.</p>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{boundary}</p>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>
        </div>

        <div className="grid gap-2 lg:grid-cols-6">
          <Input placeholder="Application" value={form.application_name} onChange={(event) => setForm({ ...form, application_name: event.target.value })} data-testid="lifecycle-ring-app" />
          <Input placeholder="Version" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} data-testid="lifecycle-ring-version" />
          <Select value={form.kind} onValueChange={(value) => setForm({ ...form, kind: value })}>
            <SelectTrigger data-testid="lifecycle-ring-kind"><SelectValue /></SelectTrigger>
            <SelectContent>{RING_ORDER.map((kind) => <SelectItem key={kind} value={kind}>{kind}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Cohort" value={form.cohort} onChange={(event) => setForm({ ...form, cohort: event.target.value })} data-testid="lifecycle-ring-cohort" />
          <Input placeholder="How the ring is verified" value={form.verification} onChange={(event) => setForm({ ...form, verification: event.target.value })} data-testid="lifecycle-ring-verification" />
          <Button onClick={createRing} disabled={saving || !form.application_name.trim() || !form.version.trim() || form.verification.trim().length < 1 || form.rollback_plan.trim().length < 1} data-testid="lifecycle-ring-create">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Rocket className="mr-1.5 h-3.5 w-3.5" />Open ring</>}
          </Button>
        </div>
        <Input placeholder="Rollback plan (required before the ring opens)" value={form.rollback_plan} onChange={(event) => setForm({ ...form, rollback_plan: event.target.value })} data-testid="lifecycle-ring-rollback-plan" />

        <div className="space-y-2">
          {loading ? <p className="text-xs text-muted-foreground">Loading rollout rings…</p> : plans.length === 0 ? (
            <p className="text-xs text-muted-foreground">No lifecycle plans yet. Open the test ring for an application version to begin staged rollout.</p>
          ) : plans.map((plan) => (
            <div key={`${plan.application_name}-${plan.version}`} className="rounded-xl border border-border/60 p-3" data-testid={`lifecycle-plan-${plan.application_name}-${plan.version}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{plan.application_name} · {plan.version}</p>
                <Badge variant="outline" className={plan.rollout_complete ? "border-emerald-400/30 text-emerald-200" : "text-muted-foreground"}>{plan.rollout_complete ? "Rollout complete" : "Rollout in progress"}</Badge>
              </div>
              <div className="mt-2 space-y-2">
                {plan.rings.map((ring) => (
                  <div key={ring.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2">
                    <div>
                      <p className="text-xs font-medium">{ring.kind} · {ring.cohort || "cohort not recorded"}</p>
                      <p className="text-[11px] text-muted-foreground">{ring.verification}{ring.rollback_evidence?.length ? ` · rollback: ${ring.rollback_evidence[ring.rollback_evidence.length - 1].note}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={RING_STATUS_TONE[ring.status] || "text-muted-foreground"}>{String(ring.status).replace("_", " ")}</Badge>
                      {evidenceFor === ring.id ? (
                        <div className="flex gap-1.5">
                          <Input className="h-8 w-52 text-xs" placeholder="Evidence note" value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} data-testid="lifecycle-ring-evidence" />
                          {ring.status !== "rolled_back" && <Button size="sm" className="h-8" onClick={() => actOnRing(ring.id, "verify")} disabled={saving || !evidenceNote.trim()}><ShieldCheck className="mr-1 h-3 w-3" />Verify</Button>}
                          <Button size="sm" variant="outline" className="h-8 border-rose-500/30 text-rose-200" onClick={() => actOnRing(ring.id, "rollback")} disabled={saving || !evidenceNote.trim()}><Undo2 className="mr-1 h-3 w-3" />Roll back</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-8" onClick={() => { setEvidenceFor(ring.id); setEvidenceNote(""); }}>Evidence</Button>
                      )}
                    </div>
                  </div>
                ))}
                {nextKindFor(plan.rings) && !plan.rollout_complete && (
                  <p className="text-[11px] text-muted-foreground">Next ring: {nextKindFor(plan.rings)} — opens once every earlier ring records verification evidence.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
