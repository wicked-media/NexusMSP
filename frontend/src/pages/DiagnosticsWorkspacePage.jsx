import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ArrowRight, RefreshCw, Stethoscope } from "lucide-react";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import OperationalPageHeader from "@/components/OperationalPageHeader";

export default function DiagnosticsWorkspacePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/mission-control/brain`, { headers: { Authorization: `Bearer ${token}` } });
      setWorkspace(response.data?.diagnostic_workspace || {});
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  const plans = workspace?.items || [];

  return <PageShell><main className="mx-auto w-full max-w-7xl space-y-5 p-5 md:p-6" data-testid="diagnostics-workspace-page">
    <OperationalPageHeader eyebrow="Operations workspace · evidence-first diagnosis" title="Nexus Diagnostic Workspace" description="Validate retained evidence and relationships before choosing a controlled playbook. Plans are never presented as completed checks or confirmed causes." icon={Stethoscope} tone="cyan" signal={plans.length ? "ready" : undefined} meta={["Read-only planning", "Technician-controlled checks", "No guessed causality"]} actions={<Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh evidence</Button>} />

    <section className="rounded-2xl border border-border/70 bg-card/70 p-4 md:p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Current diagnostic plans</p><h2 className="mt-1 text-lg font-semibold">{workspace?.headline || "Start with evidence, not a guessed fix"}</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{workspace?.detail || "Nexus needs multiple retained signals before it proposes a coordinated investigation."}</p></div><Badge variant="outline">{plans.length} ready</Badge></div>
      <NexusVerifiedSequence className="mt-4" stages={["Evidence", "Scope", "Compare", "Remediate", "Verify"]} complete={plans.length ? 2 : 1} label="Nexus Diagnose" />
      <div className="mt-4 grid gap-3 lg:grid-cols-3">{plans.map((plan) => <article key={plan.id} className="rounded-xl border border-border/70 bg-background/45 p-4"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold leading-snug">{plan.title}</h3><Badge variant="outline" className="shrink-0 border-cyan-300/15 text-[9px] text-cyan-200">Plan</Badge></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{plan.detail}</p><ol className="mt-4 space-y-2 border-l border-cyan-300/20 pl-3 text-xs leading-relaxed text-zinc-300">{(plan.steps || []).map((step, index) => <li key={step}><span className="mr-1.5 font-mono text-cyan-300">{index + 1}.</span>{step}</li>)}</ol><p className="mt-4 text-[10px] text-muted-foreground">Evidence: {plan.evidence}</p><Button className="mt-4 w-full" variant="outline" size="sm" onClick={() => navigate(plan.route)}>Open source workspace <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button></article>)}{!loading && !plans.length && <div className="lg:col-span-3 rounded-xl border border-dashed border-border/80 p-10 text-center"><Stethoscope className="mx-auto h-6 w-6 text-cyan-300" /><p className="mt-3 text-sm font-medium">No diagnostic plan is ready</p><p className="mt-1 text-xs text-muted-foreground">Nexus will surface one when multiple retained signals support a coordinated review.</p></div>}</div>
    </section>
  </main></PageShell>;
}
