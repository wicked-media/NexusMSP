import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import { EndpointSecurityPanel } from "@/pages/EndpointSecurityPage";
import { NexusCanaryPanel } from "@/pages/RansomwareCanaryPage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Activity, CheckCircle2, ClipboardList, Eye, Flame, Loader2, Monitor,
  RefreshCw, Shield, ShieldCheck, Siren, SlidersHorizontal,
} from "lucide-react";

const EMPTY = {
  coverage: { managed_assets: 0, agent_enrolled: 0, shield_enrolled: 0, agent_verified: 0, defender_healthy: 0, firewall_enabled: 0, encrypted: 0 },
  canary: { deployed: 0, healthy: 0, pending: 0, triggered: 0, unresolved: 0 },
  policies: [], risk_queue: [], capability_note: "",
};

const SEVERITY_STYLE = {
  critical: "border-rose-500/35 bg-rose-500/10 text-rose-100",
  high: "border-orange-500/35 bg-orange-500/10 text-orange-100",
  medium: "border-amber-500/35 bg-amber-500/10 text-amber-100",
  low: "border-sky-500/35 bg-sky-500/10 text-sky-100",
};

export default function NexusShieldPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [savingPolicies, setSavingPolicies] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const tab = ["overview", "endpoints", "canary", "policies", "response"].includes(searchParams.get("tab")) ? searchParams.get("tab") : "overview";

  const setTab = (value) => setSearchParams(value === "overview" ? {} : { tab: value });

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await axios.get(`${API}/nexus-shield/overview`, { headers });
      setData({ ...EMPTY, ...(response.data || {}) });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Shield could not load its verified endpoint evidence.");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const refreshAll = () => {
    setRefreshKey(key => key + 1);
    load({ quiet: true });
  };

  const updatePolicy = (policyId, enabled) => {
    setData(current => ({
      ...current,
      policies: (current.policies || []).map(policy => policy.id === policyId ? { ...policy, enabled } : policy),
    }));
  };

  const savePolicies = async () => {
    setSavingPolicies(true);
    try {
      const response = await axios.put(`${API}/nexus-shield/policies`, { policies: data.policies || [] }, { headers });
      setData(current => ({ ...current, policies: response.data?.policies || current.policies }));
      toast.success("Nexus Shield monitoring policies saved");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Shield policies could not be saved");
    } finally {
      setSavingPolicies(false);
    }
  };

  const coverage = data.coverage || EMPTY.coverage;
  const canary = data.canary || EMPTY.canary;
  const risks = data.risk_queue || [];
  const coverageLabel = coverage.agent_enrolled ? `${coverage.shield_enrolled || 0}/${coverage.agent_enrolled}` : "0";
  const activePolicies = (data.policies || []).filter(policy => policy.enabled).length;

  return (
    <div className="space-y-5" data-testid="nexus-shield">
      <OperationalPageHeader
        eyebrow="Endpoint protection & response"
        title="Nexus Shield"
        description="One operational control plane for Nexus Agent endpoint posture, Nexus Canary integrity detection, monitoring policy, and audited response work."
        icon={ShieldCheck}
        tone="emerald"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => setTab("response")}><Siren className="mr-1.5 h-4 w-4" />Response queue</Button>
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}><RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh evidence</Button>
        </>}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-white/[0.09] bg-black/[0.16] p-1">
          <TabsTrigger value="overview" className="h-9 rounded-lg px-3 text-xs data-[state=active]:bg-emerald-500/[0.16] data-[state=active]:text-emerald-100"><Shield className="mr-1.5 h-3.5 w-3.5" />Command</TabsTrigger>
          <TabsTrigger value="endpoints" className="h-9 rounded-lg px-3 text-xs data-[state=active]:bg-cyan-500/[0.14] data-[state=active]:text-cyan-100"><Monitor className="mr-1.5 h-3.5 w-3.5" />Endpoints</TabsTrigger>
          <TabsTrigger value="canary" className="h-9 rounded-lg px-3 text-xs data-[state=active]:bg-rose-500/[0.14] data-[state=active]:text-rose-100"><Flame className="mr-1.5 h-3.5 w-3.5" />Nexus Canary</TabsTrigger>
          <TabsTrigger value="policies" className="h-9 rounded-lg px-3 text-xs data-[state=active]:bg-violet-500/[0.14] data-[state=active]:text-violet-100"><SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />Policies</TabsTrigger>
          <TabsTrigger value="response" className="h-9 rounded-lg px-3 text-xs data-[state=active]:bg-amber-500/[0.14] data-[state=active]:text-amber-100"><Siren className="mr-1.5 h-3.5 w-3.5" />Response ({risks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <HeroTile label="Nexus Shield enabled" value={coverageLabel} icon={ShieldCheck} glow={coverage.shield_enrolled ? "emerald" : "zinc"} subtitle={`${coverage.agent_verified || 0} endpoints with verified posture`} onClick={() => setTab("endpoints")} animated={false} />
            <HeroTile label="Defender healthy" value={coverage.defender_healthy || 0} icon={CheckCircle2} glow={coverage.defender_healthy ? "emerald" : "zinc"} subtitle="Assessed endpoints reporting active" onClick={() => setTab("endpoints")} animated={false} />
            <HeroTile label="Nexus Canary coverage" value={`${canary.healthy || 0}/${canary.deployed || 0}`} icon={Flame} glow={canary.unresolved ? "rose" : canary.healthy ? "amber" : "zinc"} subtitle={canary.unresolved ? `${canary.unresolved} signal needs response` : "Healthy / deployed canaries"} onClick={() => setTab("canary")} animated={Boolean(canary.unresolved)} />
            <HeroTile label="Shield response queue" value={risks.length} icon={Siren} glow={risks.length ? "rose" : "emerald"} subtitle={risks.length ? "Verified items need review" : "No open evidence-based risks"} onClick={() => setTab("response")} animated={Boolean(risks.length)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="overflow-hidden border-emerald-500/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.08),rgba(34,211,238,0.03))] xl:col-span-2">
              <CardHeader className="border-b border-emerald-500/15 pb-3"><CardTitle className="flex items-center gap-2 text-sm text-emerald-100"><ShieldCheck className="h-4 w-4" />Nexus Shield protection model</CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-4 md:grid-cols-3">
                <div className="rounded-xl border border-white/[0.09] bg-black/[0.15] p-3"><Monitor className="h-4 w-4 text-cyan-300" /><p className="mt-3 text-sm font-semibold text-zinc-100">Endpoint posture</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Nexus Agent verifies Defender, firewall, encryption, pending updates and endpoint state.</p><Button variant="link" className="mt-2 h-auto p-0 text-xs text-cyan-200" onClick={() => setTab("endpoints")}>Review endpoints</Button></div>
                <div className="rounded-xl border border-white/[0.09] bg-black/[0.15] p-3"><Flame className="h-4 w-4 text-rose-300" /><p className="mt-3 text-sm font-semibold text-zinc-100">Nexus Canary</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">An active integrity sentinel: agent-managed decoys create an auditable response signal if altered or removed.</p><Button variant="link" className="mt-2 h-auto p-0 text-xs text-rose-200" onClick={() => setTab("canary")}>Open Nexus Canary</Button></div>
                <div className="rounded-xl border border-white/[0.09] bg-black/[0.15] p-3"><ClipboardList className="h-4 w-4 text-amber-300" /><p className="mt-3 text-sm font-semibold text-zinc-100">Response & audit</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Every detection retains endpoint, customer, technician and resolution evidence for investigation and reporting.</p><Button variant="link" className="mt-2 h-auto p-0 text-xs text-amber-200" onClick={() => setTab("response")}>Open response queue</Button></div>
              </CardContent>
            </Card>
            <Card className="border-violet-400/20 bg-violet-500/[0.045]"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm text-violet-100"><SlidersHorizontal className="h-4 w-4" />Shield policy coverage</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex items-end justify-between"><p className="text-3xl font-semibold text-violet-100">{activePolicies}</p><p className="pb-1 text-xs text-violet-200/75">active controls</p></div><p className="text-xs leading-relaxed text-muted-foreground">Policies control which verified signals enter the response queue. Endpoint enforcement remains separate from monitoring.</p><Button variant="outline" className="w-full border-violet-400/30 text-violet-100 hover:bg-violet-500/10" onClick={() => setTab("policies")}>Review policies</Button></CardContent></Card>
          </div>

          <Card className="border-sky-500/20 bg-sky-500/[0.045]"><CardContent className="flex gap-3 p-4 text-sm text-sky-100"><Activity className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" /><div><p className="font-medium">Evidence boundary</p><p className="mt-1 leading-relaxed text-sky-100/75">{data.capability_note || "Nexus Shield presents verified endpoint evidence and auditable response workflows."}</p></div></CardContent></Card>
        </TabsContent>

        <TabsContent value="endpoints" className="mt-5"><EndpointSecurityPanel key={`endpoints-${refreshKey}`} embedded /></TabsContent>
        <TabsContent value="canary" className="mt-5"><NexusCanaryPanel key={`canary-${refreshKey}`} embedded /></TabsContent>

        <TabsContent value="policies" className="mt-5 space-y-4">
          <Card className="overflow-hidden border-violet-400/20 bg-[linear-gradient(135deg,rgba(139,92,246,0.08),rgba(34,211,238,0.035))]"><CardHeader className="border-b border-violet-400/15"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base text-violet-100"><SlidersHorizontal className="h-4 w-4" />Nexus Shield monitoring policies</CardTitle><p className="mt-1 text-sm text-muted-foreground">Turn response-queue coverage on or off. These switches do not silently modify customer endpoints.</p></div><Button className="bg-violet-400 text-violet-950 hover:bg-violet-300" onClick={savePolicies} disabled={savingPolicies}>{savingPolicies ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Save policy settings</Button></div></CardHeader><CardContent className="space-y-3 p-4">
            {(data.policies || []).map(policy => <div key={policy.id} className="flex items-start gap-4 rounded-xl border border-white/[0.09] bg-black/[0.14] p-4"><Switch checked={Boolean(policy.enabled)} onCheckedChange={(enabled) => updatePolicy(policy.id, enabled)} aria-label={`Toggle ${policy.name}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-zinc-100">{policy.name}</p><Badge variant="outline" className={policy.mode === "active_detection" ? "border-rose-500/30 text-rose-200" : "border-sky-500/30 text-sky-200"}>{policy.mode === "active_detection" ? "Active detection" : "Monitoring"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{policy.description}</p><p className="mt-2 text-[11px] font-medium text-violet-200/80">Evidence: {policy.evidence}</p></div></div>)}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="response" className="mt-5 space-y-4">
          <Card className="overflow-hidden border-amber-500/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.08),rgba(239,68,68,0.035))]"><CardHeader className="border-b border-amber-500/15"><CardTitle className="flex items-center gap-2 text-base text-amber-100"><Siren className="h-4 w-4" />Verified response queue</CardTitle><p className="mt-1 text-sm text-muted-foreground">Items are derived from agent evidence and open Nexus Canary integrity signals. Review and record containment through the linked workflow.</p></CardHeader><CardContent className="space-y-3 p-4">
            {loading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-amber-300" /></div> : risks.length === 0 ? <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-5 text-sm text-emerald-100"><CheckCircle2 className="mb-2 h-5 w-5" />No active Nexus Shield response items are based on the current agent evidence.</div> : risks.map(risk => <div key={risk.id} className="flex flex-col gap-3 rounded-xl border border-white/[0.09] bg-black/[0.14] p-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={SEVERITY_STYLE[risk.severity] || SEVERITY_STYLE.low}>{risk.severity || "review"}</Badge><span className="text-xs font-medium text-amber-200">{risk.control}</span></div><p className="mt-2 font-medium text-zinc-100">{risk.device_name || "Managed endpoint"}</p><p className="mt-1 text-sm text-muted-foreground">{risk.reason}</p><p className="mt-1 text-xs text-muted-foreground">{risk.client_name || "Unassigned client"}</p></div><div className="flex shrink-0 gap-2">{risk.trigger_id ? <Button variant="outline" className="border-rose-500/30 text-rose-100 hover:bg-rose-500/10" onClick={() => setTab("canary")}><Flame className="mr-1.5 h-4 w-4" />Investigate canary</Button> : <Button variant="outline" className="border-cyan-400/25 text-cyan-100 hover:bg-cyan-400/[0.08]" onClick={() => risk.device_id && navigate(`/devices/${risk.device_id}`)}><Eye className="mr-1.5 h-4 w-4" />Open asset</Button>}</div></div>)}
          </CardContent></Card>
          <Card className="border-sky-500/15 bg-sky-500/[0.03]"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium text-sky-100">Need a guided containment process?</p><p className="mt-1 text-sm text-muted-foreground">Use a response playbook to record validation, containment, communications and recovery evidence.</p></div><Button variant="outline" className="border-sky-500/30 text-sky-100 hover:bg-sky-500/10" onClick={() => navigate("/remediation-playbooks")}><ClipboardList className="mr-1.5 h-4 w-4" />Open playbooks</Button></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
