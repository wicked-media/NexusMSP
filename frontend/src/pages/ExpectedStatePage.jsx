import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import NexusConfidenceBadge from "@/components/NexusConfidenceBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, ArrowRight, CircleCheck, CircleDashed, Radar, RefreshCw, ShieldCheck } from "lucide-react";

export default function ExpectedStatePage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData((await axios.get(`${API}/expected-state/overview`, { headers })).data); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);
  const summary = data?.summary || {};
  const controls = data?.controls || [];
  const assuranceStage = summary.clients ? (summary.findings ? 3 : 5) : 1;
  const controlTone = (status) => status === "covered" ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200" : status === "gap" ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-200" : "border-border/60 bg-muted/[0.08] text-muted-foreground";

  return <div className="nx-page-stage space-y-5 p-4 md:p-6" data-testid="expected-state-page">
    <OperationalPageHeader eyebrow="Continuous assurance" title="Nexus Expected State" description="Compare declared customer scope with observed evidence—without mistaking a missing source for a healthy result." icon={Radar} tone="sky" signal={summary.control_gaps ? "attention" : "healthy"} actions={<Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh evidence</Button>} />
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-4 py-3 text-sm text-amber-100"><NexusConfidenceBadge state={data ? "observed" : "unknown"} detail={data?.generated_at ? `Evidence evaluated ${new Date(data.generated_at).toLocaleString()}` : "Evidence is loading"} /><span><b>Evidence boundary:</b> {data?.boundary || "Loading retained evidence…"}</span></div>
    <NexusVerifiedSequence stages={["Declare", "Observe", "Compare", "Remediate", "Prove"]} complete={assuranceStage} label="Nexus Assurance" />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <HeroTile label="Clients assessed" value={summary.clients || 0} icon={ShieldCheck} glow="sky" subtitle="Retained Nexus records" animated={false} />
      <HeroTile label="Silent failures" value={summary.findings || 0} icon={AlertTriangle} glow={summary.findings ? "rose" : "emerald"} subtitle="Expected vs observed gaps" animated={false} />
      <HeroTile label="Endpoint gaps" value={summary.coverage_gaps || 0} icon={Activity} glow={summary.coverage_gaps ? "amber" : "emerald"} subtitle="Recent agent heartbeat evidence" animated={false} />
      <HeroTile label="Control gaps" value={summary.control_gaps || 0} icon={Radar} glow={summary.control_gaps ? "amber" : "emerald"} subtitle={`${summary.controls_assessed || 0} controls assessed`} animated={false} />
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
      <Card className="nx-ambient-surface" data-nx-signal={summary.findings ? "attention" : "healthy"}><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-300" />Silent Failure Hunter</CardTitle><p className="text-xs text-muted-foreground">These are retained evidence gaps, not assumptions of failure. Investigate from the originating workspace.</p></CardHeader><CardContent className="space-y-2">{data?.findings?.length ? data.findings.map(item => <article key={item.id} className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/[0.1] p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap gap-2"><Badge variant="outline" className={item.severity === "high" ? "border-rose-500/30 text-rose-200" : "border-amber-500/30 text-amber-200"}>{item.severity}</Badge><Badge variant="outline">{item.domain}</Badge></div><p className="mt-2 font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.client_name} · Expected {item.expected} / observed {item.observed}</p><p className="mt-1 text-xs text-muted-foreground">{item.next_step}</p></div><Button asChild size="sm" variant="outline"><Link to={item.route}>Investigate <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></article>) : <div className="py-16 text-center text-sm text-muted-foreground"><ShieldCheck className="mx-auto mb-3 h-8 w-8 text-emerald-300" /><p>No retained evidence gaps are currently detected.</p></div>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Assurance control matrix</CardTitle><p className="text-xs text-muted-foreground">Agent, billing, backup, recovery and Microsoft posture evidence in one accountable view.</p></CardHeader><CardContent className="max-h-[38rem] space-y-2 overflow-y-auto pr-1">{controls.length ? controls.map(item => <Link key={item.id} to={item.route} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary"><article className="rounded-xl border border-border/60 bg-muted/[0.08] p-3 transition-colors hover:border-primary/30 hover:bg-muted/[0.14]"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.client_name}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.label}</p></div><Badge variant="outline" className={`shrink-0 capitalize ${controlTone(item.status)}`}>{item.status === "covered" ? <CircleCheck className="mr-1 h-3 w-3" /> : <CircleDashed className="mr-1 h-3 w-3" />}{item.status.replaceAll("_", " ")}</Badge></div><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{item.detail}</p></article></Link>) : <p className="py-12 text-center text-sm text-muted-foreground">No retained control evidence is available yet.</p>}</CardContent></Card>
    </div>
  </div>;
}
