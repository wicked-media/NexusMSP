import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ArrowRight, RefreshCw, Stethoscope } from "lucide-react";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";

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
    <section className="relative overflow-hidden rounded-2xl border border-cyan-300/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_34%),linear-gradient(135deg,rgba(16,18,23,0.98),rgba(10,12,17,0.98))] p-5 shadow-[0_22px_65px_rgba(0,0,0,0.20)] md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 p-2.5"><Stethoscope className="h-6 w-6 text-cyan-200" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Operations workspace</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">Nexus Diagnostic Workspace</h1><p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">Start from retained evidence, validate the relationship, then choose the controlled playbook. Nexus never presents a diagnostic plan as a completed check or a confirmed cause.</p></div></div><Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh evidence</Button></div>
      <div className="mt-4 flex flex-wrap gap-2"><Badge variant="outline" className="border-cyan-300/15 bg-cyan-400/[0.05] text-cyan-200">Read-only planning</Badge><Badge variant="outline" className="border-violet-300/15 bg-violet-400/[0.05] text-violet-200">Technician-controlled checks</Badge><Badge variant="outline" className="border-amber-300/15 bg-amber-400/[0.05] text-amber-200">No guessed causality</Badge></div>
    </section>

    <section className="rounded-2xl border border-border/70 bg-card/70 p-4 md:p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Current diagnostic plans</p><h2 className="mt-1 text-lg font-semibold">{workspace?.headline || "Start with evidence, not a guessed fix"}</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{workspace?.detail || "Nexus needs multiple retained signals before it proposes a coordinated investigation."}</p></div><Badge variant="outline">{plans.length} ready</Badge></div>
      <NexusVerifiedSequence className="mt-4" stages={["Evidence", "Scope", "Compare", "Remediate", "Verify"]} complete={plans.length ? 2 : 1} label="Nexus Diagnose" />
      <div className="mt-4 grid gap-3 lg:grid-cols-3">{plans.map((plan) => <article key={plan.id} className="rounded-xl border border-border/70 bg-background/45 p-4"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold leading-snug">{plan.title}</h3><Badge variant="outline" className="shrink-0 border-cyan-300/15 text-[9px] text-cyan-200">Plan</Badge></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{plan.detail}</p><ol className="mt-4 space-y-2 border-l border-cyan-300/20 pl-3 text-xs leading-relaxed text-zinc-300">{(plan.steps || []).map((step, index) => <li key={step}><span className="mr-1.5 font-mono text-cyan-300">{index + 1}.</span>{step}</li>)}</ol><p className="mt-4 text-[10px] text-muted-foreground">Evidence: {plan.evidence}</p><Button className="mt-4 w-full" variant="outline" size="sm" onClick={() => navigate(plan.route)}>Open source workspace <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button></article>)}{!loading && !plans.length && <div className="lg:col-span-3 rounded-xl border border-dashed border-border/80 p-10 text-center"><Stethoscope className="mx-auto h-6 w-6 text-cyan-300" /><p className="mt-3 text-sm font-medium">No diagnostic plan is ready</p><p className="mt-1 text-xs text-muted-foreground">Nexus will surface one when multiple retained signals support a coordinated review.</p></div>}</div>
    </section>
  </main></PageShell>;
}
