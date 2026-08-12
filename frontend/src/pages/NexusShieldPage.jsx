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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Activity, ArrowRight, BrainCircuit, Building2, Check, CheckCircle2, ClipboardList,
  Cloud, Clock3, Eye, Flame, Gauge, GitBranch, HardDrive, KeyRound, Loader2, Mail,
  Monitor, Network, RefreshCw, RotateCcw, Save, Search, Settings2, Shield,
  ShieldCheck, Siren, SlidersHorizontal, Target, UserRoundCheck, Users,
} from "lucide-react";

const EMPTY = {
  coverage: { managed_assets: 0, agent_enrolled: 0, shield_enrolled: 0, agent_verified: 0, defender_healthy: 0, firewall_enabled: 0, encrypted: 0 },
  canary: { deployed: 0, healthy: 0, pending: 0, triggered: 0, unresolved: 0 },
  policies: [], policy_metadata: { updated_at: null, updated_by: "" }, risk_queue: [], capability_note: "",
  xdr: { confidence: { score: null, label: "Not assessed", evidence_coverage: 0, assessed_domains: 0, total_domains: 7, domains: [] }, incidents: [], timeline: [], missions: [], graph: { paths: 0, subjects: 0, clients: 0 }, filters: { clients: [], selected_client_id: "", selected_client_name: "" } },
};

const SEVERITY_STYLE = {
  critical: "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-100",
  high: "border-orange-500/35 bg-orange-500/10 text-orange-700 dark:text-orange-100",
  medium: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-100",
  low: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-100",
};

const policyFingerprint = (policies = []) => JSON.stringify(
  policies.map(({ id, enabled, severity, scope_mode, client_ids, threshold }) => ({
    id, enabled: Boolean(enabled), severity, scope_mode,
    client_ids: [...(client_ids || [])].sort(),
    ...(id === "patch_exposure" ? { threshold: Number(threshold) } : {}),
  })),
);

const policyTime = (value) => {
  if (!value) return "Not saved";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recorded";
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
};

const evidenceTime = (value) => {
  if (!value) return "Time not supplied";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time retained in source";
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
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
  const [policyBaseline, setPolicyBaseline] = useState([]);
  const [policyEditor, setPolicyEditor] = useState(null);
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [xdrClientId, setXdrClientId] = useState("");
  const [xdrLoading, setXdrLoading] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [xdrCases, setXdrCases] = useState([]);
  const [activatedMissions, setActivatedMissions] = useState([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);
  const [selectedMission, setSelectedMission] = useState(null);
  const [selectedActivatedMission, setSelectedActivatedMission] = useState(null);
  const [missionReason, setMissionReason] = useState("");
  const [missionStatus, setMissionStatus] = useState("planned");
  const [missionUpdateNote, setMissionUpdateNote] = useState("");
  const [savingMission, setSavingMission] = useState(false);
  const [creatingMissionTicket, setCreatingMissionTicket] = useState(false);
  const [caseStatus, setCaseStatus] = useState("investigating");
  const [caseNote, setCaseNote] = useState("");
  const [savingCase, setSavingCase] = useState(false);
  const [responseSearch, setResponseSearch] = useState("");
  const [responseSeverity, setResponseSeverity] = useState("all");
  const tab = ["overview", "xdr", "endpoints", "canary", "policies", "response"].includes(searchParams.get("tab")) ? searchParams.get("tab") : "overview";

  const setTab = (value) => setSearchParams(value === "overview" ? {} : { tab: value });

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await axios.get(`${API}/nexus-shield/overview`, { headers });
      const next = { ...EMPTY, ...(response.data || {}) };
      setData(current => tab === "xdr" ? { ...next, xdr: current.xdr } : next);
      setPolicyBaseline(next.policies || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Shield could not load its verified endpoint evidence.");
    } finally {
      setLoading(false);
    }
  }, [headers, tab]);

  useEffect(() => { load(); }, [load]);

  const loadXdr = useCallback(async (clientId = "") => {
    setXdrLoading(true);
    try {
      const response = await axios.get(`${API}/nexus-shield/xdr`, { headers, params: clientId ? { client_id: clientId } : {} });
      const nextXdr = { ...EMPTY.xdr, ...(response.data || {}) };
      setData(current => ({ ...current, xdr: nextXdr }));
      setClients(nextXdr.filters?.clients || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "The XDR assessment could not be recalculated");
    } finally {
      setXdrLoading(false);
    }
  }, [headers]);

  const loadCases = useCallback(async (clientId = "") => {
    setCasesLoading(true);
    try {
      const response = await axios.get(`${API}/nexus-shield/xdr/cases`, { headers, params: clientId ? { client_id: clientId } : {} });
      setXdrCases(response.data?.cases || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "XDR investigation records could not be loaded");
    } finally {
      setCasesLoading(false);
    }
  }, [headers]);

  const loadMissions = useCallback(async (clientId = "") => {
    try {
      const response = await axios.get(`${API}/nexus-shield/xdr/missions`, { headers, params: clientId ? { client_id: clientId } : {} });
      setActivatedMissions(response.data?.missions || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Security Mission records could not be loaded");
    }
  }, [headers]);

  useEffect(() => {
    if (tab === "xdr") {
      loadXdr(xdrClientId);
      loadCases(xdrClientId);
      loadMissions(xdrClientId);
    }
  }, [loadCases, loadMissions, loadXdr, tab, xdrClientId]);

  const refreshAll = async () => {
    setRefreshKey(key => key + 1);
    await load({ quiet: true });
    if (tab === "xdr") await Promise.all([loadXdr(xdrClientId), loadCases(xdrClientId), loadMissions(xdrClientId)]);
  };

  const openInvestigation = async (incident) => {
    setSavingCase(true);
    try {
      const response = await axios.post(`${API}/nexus-shield/xdr/cases`, {
        source_case_id: incident.id,
        client_id: incident.client_id || "",
        note: "Opened from the current evidence-backed XDR assessment.",
      }, { headers });
      const investigation = response.data?.case;
      if (investigation) {
        setXdrCases(current => [investigation, ...current.filter(item => item.id !== investigation.id)]);
        setSelectedIncident(null);
        setSelectedCase(investigation);
        setCaseStatus(investigation.status || "investigating");
        setCaseNote("");
      }
      toast.success(response.data?.message || "XDR investigation opened");
    } catch (error) {
      toast.error(error.response?.data?.detail || "The XDR investigation could not be opened");
    } finally {
      setSavingCase(false);
    }
  };

  const openCaseEditor = (item) => {
    setSelectedCase(item);
    setCaseStatus(item.status || "investigating");
    setCaseNote("");
  };

  const activateMission = async () => {
    if (!selectedMission || !missionReason.trim()) {
      toast.error("Record why this outcome is being opened before activating it");
      return;
    }
    setSavingMission(true);
    try {
      const response = await axios.post(`${API}/nexus-shield/xdr/missions`, {
        mission_id: selectedMission.id,
        client_id: xdrClientId,
        reason: missionReason.trim(),
      }, { headers });
      const mission = response.data?.mission;
      if (mission) setActivatedMissions(current => [mission, ...current.filter(item => item.id !== mission.id)]);
      setSelectedMission(null);
      setMissionReason("");
      toast.success(response.data?.message || "Security Mission activated");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Security Mission could not be activated");
    } finally {
      setSavingMission(false);
    }
  };

  const openMissionEditor = (mission) => {
    setSelectedActivatedMission(mission);
    setMissionStatus(mission.status || "planned");
    setMissionUpdateNote("");
  };

  const saveMissionUpdate = async () => {
    if (!selectedActivatedMission || !missionUpdateNote.trim()) {
      toast.error("Record an outcome note before updating the mission");
      return;
    }
    setSavingMission(true);
    try {
      const response = await axios.patch(`${API}/nexus-shield/xdr/missions/${selectedActivatedMission.id}`, { status: missionStatus, note: missionUpdateNote.trim() }, { headers });
      const mission = response.data?.mission;
      if (mission) {
        setActivatedMissions(current => current.map(item => item.id === mission.id ? mission : item));
        setSelectedActivatedMission(mission);
      }
      setMissionUpdateNote("");
      toast.success(response.data?.message || "Security Mission updated");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Security Mission could not be updated");
    } finally {
      setSavingMission(false);
    }
  };

  const createMissionTicket = async () => {
    if (!selectedActivatedMission) return;
    setCreatingMissionTicket(true);
    try {
      const response = await axios.post(`${API}/nexus-shield/xdr/missions/${selectedActivatedMission.id}/ticket`, {
        note: "Created from Nexus Shield Security Mission.",
      }, { headers });
      const ticket = response.data?.ticket;
      if (ticket) {
        const updated = { ...selectedActivatedMission, ticket_id: ticket.id, ticket_number: ticket.ticket_number };
        setSelectedActivatedMission(updated);
        setActivatedMissions(current => current.map(item => item.id === updated.id ? updated : item));
      }
      toast.success(response.data?.message || "Linked remediation ticket created");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Linked remediation ticket could not be created");
    } finally {
      setCreatingMissionTicket(false);
    }
  };

  const saveCaseUpdate = async () => {
    if (!selectedCase || !caseNote.trim()) {
      toast.error("Record a decision note before updating the investigation");
      return;
    }
    setSavingCase(true);
    try {
      const response = await axios.patch(`${API}/nexus-shield/xdr/cases/${selectedCase.id}`, { status: caseStatus, note: caseNote.trim() }, { headers });
      const updated = response.data?.case;
      setXdrCases(current => current.map(item => item.id === updated.id ? updated : item));
      setSelectedCase(updated);
      setCaseNote("");
      toast.success(response.data?.message || "XDR investigation updated");
    } catch (error) {
      toast.error(error.response?.data?.detail || "The investigation update could not be recorded");
    } finally {
      setSavingCase(false);
    }
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
      const savedPolicies = response.data?.policies || data.policies || [];
      setData(current => ({
        ...current,
        policies: savedPolicies,
        policy_metadata: {
          updated_at: response.data?.updated_at || current.policy_metadata?.updated_at,
          updated_by: response.data?.updated_by || current.policy_metadata?.updated_by,
        },
      }));
      setPolicyBaseline(savedPolicies);
      const changedControls = Number(response.data?.changed_controls || 0);
      toast.success(changedControls
        ? `${changedControls} Nexus Shield ${changedControls === 1 ? "control" : "controls"} saved to the audit ledger`
        : "Nexus Shield monitoring policies saved");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Shield policies could not be saved");
    } finally {
      setSavingPolicies(false);
    }
  };

  const openPolicyEditor = async (policy) => {
    setPolicyEditor({ ...policy, client_ids: [...(policy.client_ids || [])] });
    setClientSearch("");
    if (clients.length) return;
    setClientsLoading(true);
    try {
      const response = await axios.get(`${API}/clients`, { headers });
      setClients(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Client records could not be loaded for policy scoping");
    } finally {
      setClientsLoading(false);
    }
  };

  const togglePolicyClient = (clientId) => {
    setPolicyEditor(current => {
      if (!current) return current;
      const selected = new Set(current.client_ids || []);
      if (selected.has(clientId)) selected.delete(clientId);
      else selected.add(clientId);
      return { ...current, client_ids: [...selected] };
    });
  };

  const applyPolicyEditor = () => {
    if (!policyEditor) return;
    if (policyEditor.scope_mode === "selected_clients" && !(policyEditor.client_ids || []).length) {
      toast.error("Choose at least one client for this monitoring policy");
      return;
    }
    if (policyEditor.id === "patch_exposure") {
      const threshold = Number(policyEditor.threshold);
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 500) {
        toast.error("Patch threshold must be a whole number between 1 and 500");
        return;
      }
    }
    setData(current => ({
      ...current,
      policies: (current.policies || []).map(policy => policy.id === policyEditor.id
        ? {
          ...policyEditor,
          client_ids: policyEditor.scope_mode === "selected_clients" ? policyEditor.client_ids : [],
          ...(policyEditor.id === "patch_exposure" ? { threshold: Number(policyEditor.threshold) } : {}),
        }
        : policy),
    }));
    setPolicyEditor(null);
  };

  const resetPolicies = () => {
    setData(current => ({ ...current, policies: policyBaseline.map(policy => ({ ...policy, client_ids: [...(policy.client_ids || [])] })) }));
    toast.success("Unsaved policy changes discarded");
  };

  const coverage = data.coverage || EMPTY.coverage;
  const canary = data.canary || EMPTY.canary;
  const risks = data.risk_queue ?? EMPTY.risk_queue;
  const xdr = data.xdr || EMPTY.xdr;
  const filteredRisks = useMemo(() => {
    const query = responseSearch.trim().toLowerCase();
    return risks.filter(risk => {
      if (responseSeverity !== "all" && risk.severity !== responseSeverity) return false;
      if (!query) return true;
      return `${risk.control || ""} ${risk.device_name || ""} ${risk.client_name || ""} ${risk.reason || ""} ${(risk.categories || []).join(" ")}`.toLowerCase().includes(query);
    });
  }, [responseSearch, responseSeverity, risks]);
  const responseClientCount = new Set(risks.map(risk => risk.client_id || risk.client_name).filter(Boolean)).size;
  const activePolicies = (data.policies || []).filter(policy => policy.enabled).length;
  const activeDetections = (data.policies || []).filter(policy => policy.enabled && policy.mode === "active_detection").length;
  const scopedPolicies = (data.policies || []).filter(policy => policy.scope_mode === "selected_clients").length;
  const policiesDirty = policyFingerprint(data.policies) !== policyFingerprint(policyBaseline);
  const shieldSignal = risks.some(risk => ["critical", "high"].includes(risk.severity)) || canary.unresolved
    ? "critical"
    : risks.length > 0 || (xdr.confidence?.score != null && xdr.confidence.score < 75)
      ? "attention"
      : coverage.defender_healthy > 0
        ? "healthy"
        : "recommendation";
  const filteredPolicyClients = clients.filter(client => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) return true;
    return `${client.name || ""} ${client.email || ""}`.toLowerCase().includes(query);
  });

  return (
    <div className="nx-page-stage space-y-5" data-testid="nexus-shield">
      <OperationalPageHeader
        eyebrow="Endpoint protection & response"
        title="Nexus Shield"
        description="One operational control plane for Nexus Agent endpoint posture, Nexus Canary integrity detection, monitoring policy, and audited response work."
        icon={ShieldCheck}
        tone="emerald"
        signal={shieldSignal}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => setTab("xdr")}><BrainCircuit className="mr-1.5 h-4 w-4" />XDR intelligence</Button>
          <Button variant="outline" size="sm" onClick={() => setTab("response")}><Siren className="mr-1.5 h-4 w-4" />Response queue</Button>
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}><RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh evidence</Button>
        </>}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border/70 bg-muted/45 p-1 dark:border-white/[0.09] dark:bg-black/[0.16]">
          <TabsTrigger value="overview" className="h-9 rounded-lg px-3 text-xs data-[state=active]:bg-emerald-500/[0.16] data-[state=active]:text-emerald-700 dark:data-[state=active]:text-emerald-100"><Shield className="mr-1.5 h-3.5 w-3.5" />Command</TabsTrigger>
          <TabsTrigger value="xdr" className="h-9 rounded-lg px-3 text-xs data-[state=active]:bg-violet-500/[0.14] data-[state=active]:text-violet-700 dark:data-[state=active]:text-violet-100"><BrainCircuit className="mr-1.5 h-3.5 w-3.5" />Shield XDR</TabsTrigger>
          <TabsTrigger value="endpoints" className="h-9 rounded-lg px-3 text-xs data-[state=active]:bg-cyan-500/[0.14] data-[state=active]:text-cyan-700 dark:data-[state=active]:text-cyan-100"><Monitor className="mr-1.5 h-3.5 w-3.5" />Endpoints</TabsTrigger>
          <TabsTrigger value="canary" className="h-9 rounded-lg px-3 text-xs data-[state=active]:bg-rose-500/[0.14] data-[state=active]:text-rose-700 dark:data-[state=active]:text-rose-100"><Flame className="mr-1.5 h-3.5 w-3.5" />Nexus Canary</TabsTrigger>
          <TabsTrigger value="policies" className="h-9 rounded-lg px-3 text-xs data-[state=active]:bg-violet-500/[0.14] data-[state=active]:text-violet-700 dark:data-[state=active]:text-violet-100"><SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />Policies</TabsTrigger>
          <TabsTrigger value="response" className="h-9 rounded-lg px-3 text-xs data-[state=active]:bg-amber-500/[0.14] data-[state=active]:text-amber-700 dark:data-[state=active]:text-amber-100"><Siren className="mr-1.5 h-3.5 w-3.5" />Response ({risks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <HeroTile label="Security confidence" value={xdr.confidence?.score == null ? "—" : `${xdr.confidence.score}%`} icon={ShieldCheck} glow={xdr.confidence?.score >= 75 ? "emerald" : xdr.confidence?.score == null ? "zinc" : "amber"} subtitle={`${xdr.confidence?.evidence_coverage || 0}% evidence coverage · ${xdr.confidence?.label || "Not assessed"}`} onClick={() => setTab("xdr")} animated={false} />
            <HeroTile label="Defender healthy" value={coverage.defender_healthy || 0} icon={CheckCircle2} glow={coverage.defender_healthy ? "emerald" : "zinc"} subtitle="Assessed endpoints reporting active" onClick={() => setTab("endpoints")} animated={false} />
            <HeroTile label={canary.unresolved ? "Canary response" : "Nexus Canary coverage"} value={canary.unresolved ? canary.unresolved : `${canary.healthy || 0}/${canary.deployed || 0}`} icon={Flame} glow={canary.unresolved ? "rose" : canary.healthy ? "amber" : "zinc"} subtitle={canary.unresolved ? `${canary.healthy || 0}/${canary.deployed || 0} canaries currently healthy` : "Healthy / deployed canaries"} onClick={() => setTab("canary")} animated={Boolean(canary.unresolved)} />
            <HeroTile label="Shield response queue" value={risks.length} icon={Siren} glow={risks.length ? "rose" : "emerald"} subtitle={risks.length ? "Verified items need review" : "No open evidence-based risks"} onClick={() => setTab("response")} animated={Boolean(risks.length)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className={`overflow-hidden xl:col-span-2 ${risks.length ? "border-rose-500/20 bg-[linear-gradient(135deg,rgba(244,63,94,0.075),rgba(245,158,11,0.025))]" : "border-emerald-500/20 bg-emerald-500/[0.035]"}`}>
              <CardHeader className={`border-b pb-3 ${risks.length ? "border-rose-500/15" : "border-emerald-500/15"}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><CardTitle className={`flex items-center gap-2 text-sm ${risks.length ? "text-rose-700 dark:text-rose-100" : "text-emerald-700 dark:text-emerald-100"}`}><Siren className="h-4 w-4" />Technician priority</CardTitle><p className="mt-1 text-xs text-muted-foreground">The highest-severity verified evidence currently waiting for technician review.</p></div>
                  <Button size="sm" variant="outline" onClick={() => setTab("response")} disabled={!risks.length}>Review all {risks.length || ""}</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 p-4">
                {risks.length ? risks.slice(0, 3).map(risk => <button type="button" key={risk.id} onClick={() => {
                  if (risk.xdr_case_id) {
                    const incident = (xdr.incidents || []).find(item => item.id === risk.xdr_case_id);
                    setTab("xdr");
                    if (incident) setSelectedIncident(incident);
                  } else if (risk.device_id) navigate(`/devices/${risk.device_id}`);
                  else setTab("response");
                }} className="group flex w-full flex-col gap-3 rounded-xl border border-border/70 bg-background/60 p-3 text-left transition-colors hover:border-rose-400/30 hover:bg-rose-500/[0.035] dark:bg-black/[0.14] sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={SEVERITY_STYLE[risk.severity] || SEVERITY_STYLE.medium}>{risk.severity || "review"}</Badge><span className="text-xs font-semibold text-rose-700 dark:text-rose-200">{risk.control}</span>{risk.requires_approval && <Badge variant="outline" className="border-violet-500/25 text-violet-700 dark:text-violet-200">Approval gated</Badge>}</div><p className="mt-2 truncate text-sm font-semibold text-foreground">{risk.device_name || risk.subject || "Observed security subject"}</p><p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{risk.reason}</p></div>
                  <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-rose-700 dark:text-rose-200"><span className="max-w-40 truncate text-muted-foreground">{risk.client_name || "Unassigned client"}</span><ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></div>
                </button>) : <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" /><div><p className="text-sm font-semibold text-emerald-700 dark:text-emerald-100">No verified evidence is waiting for response</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Unconnected or unassessed security domains remain visible in Shield XDR and are never presented as healthy.</p></div></div>}
              </CardContent>
            </Card>
            <Card className="border-violet-400/20 bg-violet-500/[0.045]"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm text-violet-700 dark:text-violet-100"><SlidersHorizontal className="h-4 w-4" />Shield policy coverage</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex items-end justify-between"><p className="text-3xl font-semibold text-violet-700 dark:text-violet-100">{activePolicies}</p><p className="pb-1 text-xs text-violet-700/75 dark:text-violet-200/75">active controls</p></div><p className="text-xs leading-relaxed text-muted-foreground">Policies control which verified signals enter the response queue. Endpoint enforcement remains separate from monitoring.</p><Button variant="info" className="w-full" onClick={() => setTab("policies")}>Review policies</Button></CardContent></Card>
          </div>

          <Card className="border-sky-500/20 bg-sky-500/[0.045]"><CardContent className="flex gap-3 p-4 text-sm text-sky-800 dark:text-sky-100"><Activity className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-300" /><div><p className="font-medium">Evidence boundary</p><p className="mt-1 leading-relaxed text-sky-700/80 dark:text-sky-100/75">{data.capability_note || "Nexus Shield presents verified endpoint evidence and auditable response workflows."}</p></div></CardContent></Card>
        </TabsContent>

        <TabsContent value="xdr" className="mt-5 space-y-5">
          <Card className="border-cyan-400/20 bg-cyan-500/[0.035]">
            <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div><p className="text-sm font-semibold text-cyan-700 dark:text-cyan-100">Investigation scope</p><p className="mt-1 text-xs text-muted-foreground">Recalculate every confidence domain, case and mission for one customer, or retain the complete MSP view.</p></div>
              <div className="flex w-full items-center gap-2 lg:w-auto">
                <Building2 className="h-4 w-4 shrink-0 text-cyan-200" />
                <select aria-label="XDR client scope" value={xdrClientId} onChange={(event) => setXdrClientId(event.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-cyan-400/20 bg-background px-3 text-sm text-foreground lg:w-72">
                  <option value="">All managed clients</option>
                  {(xdr.filters?.clients || clients).map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
                <Button variant="outline" size="sm" onClick={() => loadXdr(xdrClientId)} disabled={xdrLoading}>{xdrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}<span className="sr-only">Recalculate XDR evidence</span></Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <HeroTile label="Security assurance" value={xdr.confidence?.score == null ? "Not assessed" : `${xdr.confidence.score}%`} icon={ShieldCheck} glow={xdr.confidence?.score >= 75 ? "emerald" : xdr.confidence?.score == null ? "zinc" : "amber"} subtitle={`${xdr.confidence?.observed_score ?? "—"}% observed health · coverage-adjusted`} animated={false} />
            <HeroTile label="Evidence coverage" value={`${xdr.confidence?.evidence_coverage || 0}%`} icon={Activity} glow={xdr.confidence?.evidence_coverage >= 75 ? "cyan" : "amber"} subtitle="Unknown remains visibly unassessed" animated={false} />
            <HeroTile label="Correlated cases" value={xdr.incidents?.length || 0} icon={GitBranch} glow={xdr.incidents?.length ? "rose" : "emerald"} subtitle={`${xdr.graph?.paths || 0} multi-domain attack paths`} animated={Boolean(xdr.incidents?.length)} />
            <HeroTile label="Security missions" value={xdr.missions?.length || 0} icon={Target} glow={xdr.missions?.length ? "violet" : "emerald"} subtitle="Outcome-focused resilience work" animated={false} />
          </div>

          <Card className="overflow-hidden border-emerald-500/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.075),rgba(34,211,238,0.025))]">
            <CardHeader className="border-b border-emerald-500/15">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><CardTitle className="flex items-center gap-2 text-base text-emerald-800 dark:text-emerald-100"><Gauge className="h-4 w-4" />Nexus Security Assurance</CardTitle><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{xdr.confidence?.explanation}</p></div>
                <div className="text-right"><p className="text-4xl font-semibold text-emerald-800 dark:text-emerald-100">{xdr.confidence?.score == null ? "—" : `${xdr.confidence.score}%`}</p><p className="mt-1 text-xs text-emerald-700 dark:text-emerald-200/70">{xdr.confidence?.label || "Not assessed"}</p></div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              {(xdr.confidence?.domains || []).map(domain => {
                const DomainIcon = { endpoint: Monitor, identity: KeyRound, email: Mail, cloud: Cloud, human: UserRoundCheck, dns: Network, recovery: HardDrive }[domain.key] || Shield;
                return <button type="button" key={domain.key} onClick={() => navigate(domain.route)} className="group rounded-xl border border-border/70 bg-background/55 p-3 text-left transition-colors hover:border-emerald-400/30 hover:bg-emerald-500/[0.04] dark:bg-black/[0.14]">
                  <div className="flex items-center justify-between gap-2"><DomainIcon className="h-4 w-4 text-emerald-700 dark:text-emerald-200" /><span className={`text-sm font-semibold ${domain.score == null ? "text-muted-foreground" : domain.score >= 75 ? "text-emerald-700 dark:text-emerald-100" : "text-amber-700 dark:text-amber-100"}`}>{domain.score == null ? "Unknown" : `${domain.score}% health`}</span></div>
                  <p className="mt-3 text-sm font-semibold text-foreground">{domain.label}</p><p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{domain.evidence}</p>
                  <div className="mt-3 flex items-center justify-between gap-2"><span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{domain.coverage || 0}% coverage</span><span className="inline-flex items-center text-[11px] font-medium text-emerald-700 dark:text-emerald-200/80">Inspect evidence<ArrowRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span></div>
                </button>;
              })}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-5">
            <Card className="overflow-hidden border-rose-500/20 bg-rose-500/[0.035] xl:col-span-3">
              <CardHeader className="border-b border-rose-500/15"><CardTitle className="flex items-center gap-2 text-base text-rose-700 dark:text-rose-100"><BrainCircuit className="h-4 w-4" />Correlated security cases</CardTitle><p className="mt-1 text-sm text-muted-foreground">Signals are linked by persisted customer and subject identifiers. Suggested containment always requires technician approval.</p></CardHeader>
              <CardContent className="space-y-3 p-4">
                {xdrLoading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-rose-600 dark:text-rose-200" /></div> : (xdr.incidents || []).length === 0 ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5 text-sm text-emerald-700 dark:text-emerald-100"><CheckCircle2 className="mb-2 h-5 w-5" />No open provider evidence currently forms an XDR case. This is not a claim that unconnected domains are secure.</div> : (xdr.incidents || []).slice(0, 8).map(incident => <div key={incident.id} className="rounded-xl border border-border/70 bg-background/55 p-4 dark:bg-black/[0.14]">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={SEVERITY_STYLE[incident.severity] || SEVERITY_STYLE.medium}>{incident.severity}</Badge>{incident.correlated && <Badge variant="outline" className="border-violet-400/30 text-violet-200">Multi-domain</Badge>}</div><p className="mt-2 font-semibold text-foreground">{incident.title}</p><p className="mt-1 text-sm text-muted-foreground">{incident.summary}</p><p className="mt-1 text-xs text-muted-foreground">{incident.client_name} · {incident.categories?.join(" + ")} · {evidenceTime(incident.latest_observed_at)}</p></div><Button size="sm" variant="outline" onClick={() => setSelectedIncident(incident)}><Eye className="mr-1.5 h-3.5 w-3.5" />Investigate</Button></div>
                </div>)}
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-violet-500/20 bg-violet-500/[0.035] xl:col-span-2">
              <CardHeader className="border-b border-violet-500/15"><CardTitle className="flex items-center gap-2 text-base text-violet-700 dark:text-violet-100"><Target className="h-4 w-4" />Security missions</CardTitle><p className="mt-1 text-sm text-muted-foreground">Move resilience forward with evidence-backed, measurable outcomes.</p></CardHeader>
              <CardContent className="space-y-3 p-4">
                {(xdr.missions || []).length === 0 ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 text-sm text-emerald-700 dark:text-emerald-100">No current evidence-backed missions.</div> : (xdr.missions || []).map(mission => <div key={mission.id} className="rounded-xl border border-border/70 bg-background/55 p-3 dark:bg-black/[0.14]">
                  <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-foreground">{mission.title}</p><Badge variant="outline" className={SEVERITY_STYLE[mission.severity] || SEVERITY_STYLE.medium}>{mission.severity}</Badge></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{mission.detail}</p><p className="mt-2 text-[11px] font-medium text-violet-700 dark:text-violet-200">{mission.impact}</p></div></div>
                  <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => { setSelectedMission(mission); setMissionReason(""); }}><Target className="mr-1.5 h-3.5 w-3.5" />Activate mission</Button><Button size="sm" variant="outline" onClick={() => mission.route?.includes("tab=xdr") ? setTab("xdr") : navigate(mission.route)}>Inspect evidence<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button></div>
                </div>)}
                {activatedMissions.length > 0 && <div className="space-y-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.05] p-3 text-xs text-violet-800 dark:text-violet-100"><div><span className="font-semibold">{activatedMissions.filter(item => !["completed", "cancelled"].includes(item.status)).length} active mission{activatedMissions.filter(item => !["completed", "cancelled"].includes(item.status)).length === 1 ? "" : "s"}</span><span className="text-muted-foreground"> · owned work with an auditable purpose and response pack.</span></div>{activatedMissions.filter(item => !["completed", "cancelled"].includes(item.status)).slice(0, 3).map(mission => <button key={mission.id} type="button" onClick={() => openMissionEditor(mission)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-violet-400/15 bg-background/45 px-2.5 py-2 text-left hover:border-violet-400/35"><span className="truncate font-medium text-foreground">{mission.title}</span><Badge variant="outline" className="shrink-0 border-violet-400/25 text-violet-700 dark:text-violet-100">{String(mission.status).replaceAll("_", " ")}</Badge></button>)}</div>}
                <Button variant="info" className="w-full" onClick={() => navigate(xdr.graph?.route || "/security-graph")}><GitBranch className="mr-1.5 h-4 w-4" />Open evidence graph</Button>
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden border-amber-500/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.055),rgba(239,68,68,0.025))]">
            <CardHeader className="border-b border-amber-500/15"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-100"><ClipboardList className="h-4 w-4" />XDR investigation desk</CardTitle><p className="mt-1 text-sm text-muted-foreground">Durable ownership and decision history remain available even after the originating alert changes.</p></div><Badge variant="outline" className="border-amber-400/25 text-amber-700 dark:text-amber-100">{xdrCases.filter(item => !["resolved", "false_positive"].includes(item.status)).length} active</Badge></div></CardHeader>
            <CardContent className="p-4">
              {casesLoading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-amber-600 dark:text-amber-200" /></div> : xdrCases.length === 0 ? <div className="rounded-xl border border-border/70 bg-background/55 p-5 text-sm text-muted-foreground dark:bg-black/[0.12]">No investigation has been opened in this customer scope. Open a correlated case above when technician ownership is required.</div> : <div className="grid gap-3 lg:grid-cols-2">
                {xdrCases.slice(0, 12).map(item => <button type="button" key={item.id} onClick={() => openCaseEditor(item)} className="group rounded-xl border border-border/70 bg-background/55 p-4 text-left transition-colors hover:border-amber-400/30 hover:bg-amber-500/[0.035] dark:bg-black/[0.14]"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={SEVERITY_STYLE[item.severity] || SEVERITY_STYLE.medium}>{item.severity}</Badge><Badge variant="outline" className="border-border text-muted-foreground">{String(item.status || "investigating").replace("_", " ")}</Badge></div><span className="text-[11px] text-muted-foreground">{evidenceTime(item.updated_at)}</span></div><p className="mt-3 text-sm font-semibold text-foreground">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.client_name} · {item.subject}</p><div className="mt-3 flex items-center justify-between gap-2 text-[11px]"><span className="text-amber-700 dark:text-amber-200/80">Owner: {item.owner_name || "Unassigned"}</span><span className="inline-flex items-center text-amber-700 dark:text-amber-200">Open case<ArrowRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span></div></button>)}
              </div>}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-sky-500/20 bg-sky-500/[0.03]">
            <CardHeader className="border-b border-sky-500/15"><CardTitle className="flex items-center gap-2 text-base text-sky-700 dark:text-sky-100"><Clock3 className="h-4 w-4" />Security timeline</CardTitle><p className="mt-1 text-sm text-muted-foreground">A single chronological stream across the currently selected customer scope. Every entry opens its originating evidence workspace.</p></CardHeader>
            <CardContent className="p-4">
              {(xdr.timeline || []).length === 0 ? <div className="rounded-xl border border-white/[0.08] bg-black/[0.12] p-5 text-sm text-muted-foreground">No timestamped security evidence is available in this scope.</div> : <div className="space-y-0">
                {(xdr.timeline || []).slice(0, 16).map((event, index) => <button type="button" key={`${event.id}:${index}`} onClick={() => navigate(event.route)} className="group relative flex w-full gap-3 pb-5 text-left last:pb-0">
                  <div className="relative flex w-5 shrink-0 justify-center"><span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${event.severity === "critical" ? "bg-rose-400" : event.severity === "high" ? "bg-orange-400" : event.severity === "medium" ? "bg-amber-400" : "bg-sky-400"}`} />{index < Math.min((xdr.timeline || []).length, 16) - 1 && <span className="absolute bottom-0 top-4 w-px bg-white/[0.10]" />}</div>
                  <div className="min-w-0 flex-1 rounded-xl border border-border/70 bg-background/55 p-3 transition-colors group-hover:border-sky-400/25 group-hover:bg-sky-500/[0.035] dark:bg-black/[0.12]"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={SEVERITY_STYLE[event.severity] || SEVERITY_STYLE.medium}>{event.severity}</Badge><span className="text-[11px] font-medium uppercase tracking-[0.12em] text-sky-700 dark:text-sky-200/75">{event.category} · {event.source}</span></div><span className="text-[11px] text-muted-foreground">{evidenceTime(event.observed_at)}</span></div><p className="mt-2 text-sm font-semibold text-foreground">{event.title}</p><p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{event.detail}</p><p className="mt-2 text-[11px] text-sky-700 dark:text-sky-200/75">{event.client_name} · {event.subject}</p></div>
                </button>)}
              </div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="endpoints" className="mt-5"><EndpointSecurityPanel key={`endpoints-${refreshKey}`} embedded /></TabsContent>
        <TabsContent value="canary" className="mt-5"><NexusCanaryPanel key={`canary-${refreshKey}`} embedded /></TabsContent>

        <TabsContent value="policies" className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <HeroTile label="Active controls" value={`${activePolicies}/${data.policies?.length || 0}`} icon={ShieldCheck} glow={activePolicies ? "violet" : "zinc"} subtitle="Signals entering the response queue" animated={false} />
            <HeroTile label="Active detection" value={activeDetections} icon={Flame} glow={activeDetections ? "rose" : "zinc"} subtitle="Agent-backed integrity controls" animated={false} />
            <HeroTile label="Client-scoped" value={scopedPolicies} icon={Building2} glow={scopedPolicies ? "cyan" : "zinc"} subtitle={scopedPolicies ? "Controls limited to selected clients" : "All controls cover every client"} animated={false} />
            <HeroTile label="Policy record" value={policyTime(data.policy_metadata?.updated_at)} icon={ClipboardList} glow="emerald" subtitle={data.policy_metadata?.updated_by ? `Last changed by ${data.policy_metadata.updated_by}` : "No saved policy change recorded"} animated={false} />
          </div>

          <Card className="overflow-hidden border-violet-400/20 bg-[linear-gradient(135deg,rgba(139,92,246,0.08),rgba(34,211,238,0.035))]">
            <CardHeader className="border-b border-violet-400/15">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="flex items-center gap-2 text-base text-violet-700 dark:text-violet-100"><SlidersHorizontal className="h-4 w-4" />Nexus Shield monitoring policies</CardTitle>
                    {policiesDirty && <Badge role="status" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-100">Unsaved changes</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Control which verified signals enter the queue, their technician severity, and the customers they apply to. Nothing here silently modifies an endpoint.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {policiesDirty && <Button variant="outline" onClick={resetPolicies}><RotateCcw className="mr-1.5 h-4 w-4" />Discard</Button>}
                  <Button onClick={savePolicies} disabled={savingPolicies || !policiesDirty}>
                    {savingPolicies ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Save policy settings
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 xl:grid-cols-2">
              {(data.policies || []).map(policy => (
                <div key={policy.id} className={`flex h-full flex-col rounded-xl border p-4 transition-colors ${policy.enabled ? "border-border/80 bg-background/65 dark:border-white/[0.10] dark:bg-black/[0.16]" : "border-border/60 bg-muted/35 opacity-75 dark:border-white/[0.06] dark:bg-black/[0.08]"}`}>
                  <div className="flex items-start gap-3">
                    <Switch checked={Boolean(policy.enabled)} onCheckedChange={(enabled) => updatePolicy(policy.id, enabled)} aria-label={`Toggle ${policy.name}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{policy.name}</p>
                        <Badge variant="outline" className={policy.mode === "active_detection" ? "border-rose-500/30 text-rose-700 dark:text-rose-200" : "border-sky-500/30 text-sky-700 dark:text-sky-200"}>{policy.mode === "active_detection" ? "Active detection" : "Monitoring"}</Badge>
                        <Badge variant="outline" className={SEVERITY_STYLE[policy.severity] || SEVERITY_STYLE.low}>{policy.severity || "review"}</Badge>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{policy.description}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg border border-border/70 bg-muted/25 p-2.5 dark:border-white/[0.07] dark:bg-white/[0.025]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700/75 dark:text-violet-200/65">Customer scope</p>
                      <p className="mt-1 font-medium text-foreground">{policy.scope_mode === "selected_clients" ? `${policy.client_ids?.length || 0} selected client${policy.client_ids?.length === 1 ? "" : "s"}` : "All managed clients"}</p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-muted/25 p-2.5 dark:border-white/[0.07] dark:bg-white/[0.025]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700/75 dark:text-violet-200/65">{policy.id === "patch_exposure" ? "Alert threshold" : "Evidence source"}</p>
                      <p className="mt-1 truncate font-medium text-foreground">{policy.id === "patch_exposure" ? `${policy.threshold} pending updates` : policy.evidence}</p>
                    </div>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                    <p className="text-[11px] text-muted-foreground">{policy.enabled ? "Included in live queue evaluation" : "Excluded from queue evaluation"}</p>
                    <Button size="sm" variant="outline" onClick={() => openPolicyEditor(policy)}><Settings2 className="mr-1.5 h-3.5 w-3.5" />Configure</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-sky-500/20 bg-sky-500/[0.04]">
            <CardContent className="flex gap-3 p-4 text-sm text-sky-800 dark:text-sky-100">
              <Gauge className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
              <div><p className="font-medium">Monitoring boundary</p><p className="mt-1 leading-relaxed text-sky-700/80 dark:text-sky-100/75">Policy severity changes queue priority only. It does not alter Microsoft Defender, Windows Firewall, BitLocker, patching, or Canary configuration on the endpoint.</p></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="response" className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <HeroTile label="Active response" value={risks.length} icon={Siren} glow={risks.length ? "rose" : "emerald"} subtitle="Evidence-backed review items" animated={Boolean(risks.length)} />
            <HeroTile label="Critical" value={risks.filter(risk => risk.severity === "critical").length} icon={Shield} glow={risks.some(risk => risk.severity === "critical") ? "rose" : "emerald"} subtitle="Immediate technician validation" animated={false} />
            <HeroTile label="Clients affected" value={responseClientCount} icon={Users} glow={responseClientCount ? "amber" : "emerald"} subtitle="Persisted customer relationships" animated={false} />
            <HeroTile label="Approval required" value={risks.filter(risk => risk.requires_approval).length} icon={ClipboardList} glow="violet" subtitle="No silent containment actions" animated={false} />
          </div>

          <Card className="overflow-hidden border-amber-500/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.08),rgba(239,68,68,0.035))]">
            <CardHeader className="border-b border-amber-500/15">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div><CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-100"><Siren className="h-4 w-4" />Verified response queue</CardTitle><p className="mt-1 text-sm text-muted-foreground">Agent posture and persisted XDR cases share one review queue. Opening an item records ownership through the linked investigation workflow.</p></div>
                <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
                  <div className="relative min-w-0 sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search response queue" value={responseSearch} onChange={event => setResponseSearch(event.target.value)} placeholder="Search client, subject or control" className="pl-9" /></div>
                  <select aria-label="Filter response severity" value={responseSeverity} onChange={event => setResponseSeverity(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"><option value="all">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {loading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-amber-600 dark:text-amber-300" /></div> : risks.length === 0 ? <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-5 text-sm text-emerald-700 dark:text-emerald-100"><CheckCircle2 className="mb-2 h-5 w-5" />No active response items are supported by the current connected evidence. Unassessed security domains remain visible in Shield XDR.</div> : filteredRisks.length === 0 ? <div className="rounded-xl border border-border/70 bg-background/60 p-5 text-sm text-muted-foreground">No response items match these filters. Clear the search or show all severities.</div> : filteredRisks.map(risk => <div key={risk.id} className="flex flex-col gap-4 rounded-xl border border-border/70 bg-background/60 p-4 dark:bg-black/[0.14] lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={SEVERITY_STYLE[risk.severity] || SEVERITY_STYLE.low}>{risk.severity || "review"}</Badge><span className="text-xs font-medium text-amber-700 dark:text-amber-200">{risk.control}</span>{risk.signal_count > 1 && <Badge variant="outline" className="border-border text-muted-foreground">{risk.signal_count} signals grouped</Badge>}{risk.requires_approval && <Badge variant="outline" className="border-violet-500/25 text-violet-700 dark:text-violet-200">Approval gated</Badge>}</div><p className="mt-2 font-medium text-foreground">{risk.device_name || risk.subject || "Observed security subject"}</p><p className="mt-1 text-sm text-muted-foreground">{risk.reason}</p><p className="mt-2 text-xs text-muted-foreground">{risk.client_name || "Unassigned client"}{risk.categories?.length ? ` · ${risk.categories.join(" + ")}` : ""}{risk.latest_observed_at ? ` · ${evidenceTime(risk.latest_observed_at)}` : ""}</p></div><div className="flex shrink-0 flex-wrap gap-2">{risk.xdr_case_id ? <Button variant="outline" className="border-violet-500/30 text-violet-700 hover:bg-violet-500/10 dark:text-violet-100" onClick={() => { const incident = (xdr.incidents || []).find(item => item.id === risk.xdr_case_id); setTab("xdr"); if (incident) setSelectedIncident(incident); }}><Eye className="mr-1.5 h-4 w-4" />Review case</Button> : <Button variant="outline" className="border-cyan-400/25 text-cyan-700 hover:bg-cyan-400/[0.08] dark:text-cyan-100" onClick={() => risk.device_id && navigate(`/devices/${risk.device_id}`)} disabled={!risk.device_id}><Eye className="mr-1.5 h-4 w-4" />Open asset</Button>}</div></div>)}
            </CardContent>
          </Card>
          <Card className="border-sky-500/15 bg-sky-500/[0.03]"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium text-sky-700 dark:text-sky-100">Need a guided containment process?</p><p className="mt-1 text-sm text-muted-foreground">Use a response playbook to record validation, containment, communications and recovery evidence.</p></div><Button variant="info" onClick={() => navigate("/remediation-playbooks")}><ClipboardList className="mr-1.5 h-4 w-4" />Open playbooks</Button></CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(policyEditor)} onOpenChange={(open) => { if (!open) setPolicyEditor(null); }}>
        <DialogContent className="max-h-[88vh] gap-0 overflow-hidden border-violet-400/20 bg-background p-0 shadow-2xl sm:max-w-2xl dark:bg-[linear-gradient(160deg,#11101c,#090b11)]">
          {policyEditor && <>
            <DialogHeader className="border-b border-border/70 p-6 pb-5 text-left dark:border-white/[0.08]">
              <div className="flex items-start gap-3">
                <div className="rounded-xl border border-violet-400/25 bg-violet-500/10 p-2.5"><SlidersHorizontal className="h-5 w-5 text-violet-700 dark:text-violet-200" /></div>
                <div><DialogTitle>{policyEditor.name}</DialogTitle><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Set queue severity and customer coverage for this evidence-backed control.</p></div>
              </div>
            </DialogHeader>

            <div className="max-h-[calc(88vh-10rem)] space-y-5 overflow-y-auto px-6 py-5">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/25 p-4 dark:border-white/[0.09] dark:bg-black/[0.18]">
                <div><p className="font-medium text-foreground">Include in Shield response queue</p><p className="mt-1 text-xs text-muted-foreground">Disabling this control hides its verified signals until it is enabled again.</p></div>
                <Switch checked={Boolean(policyEditor.enabled)} onCheckedChange={(enabled) => setPolicyEditor(current => ({ ...current, enabled }))} aria-label={`Enable ${policyEditor.name}`} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="shield-policy-severity">Queue severity</Label>
                  <select id="shield-policy-severity" value={policyEditor.severity || "medium"} onChange={(event) => setPolicyEditor(current => ({ ...current, severity: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                    <option value="critical">Critical — immediate response</option>
                    <option value="high">High — urgent review</option>
                    <option value="medium">Medium — scheduled review</option>
                    <option value="low">Low — informational follow-up</option>
                  </select>
                </div>
                {policyEditor.id === "patch_exposure" && <div className="space-y-2">
                  <Label htmlFor="shield-patch-threshold">Pending update threshold</Label>
                  <Input id="shield-patch-threshold" type="number" min="1" max="500" value={policyEditor.threshold ?? 10} onChange={(event) => setPolicyEditor(current => ({ ...current, threshold: event.target.value }))} />
                  <p className="text-xs text-muted-foreground">Alert only when the agent reports more than this quantity.</p>
                </div>}
              </div>

              <div className="space-y-3">
                <div><Label>Customer scope</Label><p className="mt-1 text-xs text-muted-foreground">Apply this control to every managed customer or a reviewed subset.</p></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" aria-pressed={policyEditor.scope_mode !== "selected_clients"} onClick={() => setPolicyEditor(current => ({ ...current, scope_mode: "all_clients", client_ids: [] }))} className={`rounded-xl border p-4 text-left transition-colors ${policyEditor.scope_mode !== "selected_clients" ? "border-violet-400/45 bg-violet-500/10" : "border-border/70 bg-muted/20 hover:border-border dark:border-white/[0.09] dark:bg-black/[0.12] dark:hover:border-white/[0.16]"}`}>
                    <Users className="h-4 w-4 text-violet-700 dark:text-violet-200" /><p className="mt-3 text-sm font-semibold text-foreground">All managed clients</p><p className="mt-1 text-xs text-muted-foreground">Evaluate every client with eligible Nexus Agent evidence.</p>
                  </button>
                  <button type="button" aria-pressed={policyEditor.scope_mode === "selected_clients"} onClick={() => setPolicyEditor(current => ({ ...current, scope_mode: "selected_clients" }))} className={`rounded-xl border p-4 text-left transition-colors ${policyEditor.scope_mode === "selected_clients" ? "border-cyan-400/45 bg-cyan-500/[0.08]" : "border-border/70 bg-muted/20 hover:border-border dark:border-white/[0.09] dark:bg-black/[0.12] dark:hover:border-white/[0.16]"}`}>
                    <Building2 className="h-4 w-4 text-cyan-700 dark:text-cyan-200" /><p className="mt-3 text-sm font-semibold text-foreground">Selected clients</p><p className="mt-1 text-xs text-muted-foreground">Restrict queue evaluation to explicitly chosen customers.</p>
                  </button>
                </div>
              </div>

              {policyEditor.scope_mode === "selected_clients" && <div className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.035] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-cyan-800 dark:text-cyan-100">Protected customer scope</p><p className="mt-1 text-xs text-muted-foreground">{policyEditor.client_ids?.length || 0} client{policyEditor.client_ids?.length === 1 ? "" : "s"} selected</p></div></div>
                <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search policy clients" value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search clients by name or email…" className="pl-9" /></div>
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                  {clientsLoading ? <div className="flex items-center justify-center py-6 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading clients…</div> : filteredPolicyClients.length ? filteredPolicyClients.map(client => {
                    const selected = (policyEditor.client_ids || []).includes(client.id);
                    return <button type="button" key={client.id} aria-pressed={selected} onClick={() => togglePolicyClient(client.id)} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${selected ? "border-cyan-400/35 bg-cyan-500/[0.08]" : "border-border/70 bg-background/60 hover:border-border dark:border-white/[0.07] dark:bg-black/[0.12] dark:hover:border-white/[0.14]"}`}>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-cyan-300 bg-cyan-400 text-cyan-950" : "border-white/20"}`}>{selected && <Check className="h-3.5 w-3.5" />}</span>
                      <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{client.name}</span><span className="block truncate text-xs text-muted-foreground">{client.email || "No primary email recorded"}</span></span>
                    </button>;
                  }) : <p className="py-6 text-center text-sm text-muted-foreground">No clients match that search.</p>}
                </div>
              </div>}

              <div className="rounded-xl border border-sky-400/20 bg-sky-500/[0.05] p-3 text-xs leading-relaxed text-sky-800 dark:text-sky-100/75">
                Evidence source: <span className="font-semibold text-sky-900 dark:text-sky-100">{policyEditor.evidence}</span>. This configuration changes monitoring and queue priority only.
              </div>
            </div>

            <DialogFooter className="border-t border-border/70 bg-muted/25 p-6 pt-4 dark:border-white/[0.08] dark:bg-black/[0.16]">
              <Button variant="outline" onClick={() => setPolicyEditor(null)}>Cancel</Button>
              <Button className="bg-violet-400 text-violet-950 hover:bg-violet-300" onClick={applyPolicyEditor}><CheckCircle2 className="mr-1.5 h-4 w-4" />Stage policy changes</Button>
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedMission)} onOpenChange={(open) => { if (!open) { setSelectedMission(null); setMissionReason(""); } }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto border-violet-400/20 bg-[linear-gradient(160deg,#121020,#090b11)] sm:max-w-2xl">
          {selectedMission && <>
            <DialogHeader><div className="flex items-start gap-3"><div className="rounded-xl border border-violet-400/25 bg-violet-500/10 p-2.5"><Target className="h-5 w-5 text-violet-200" /></div><div><div className="flex flex-wrap items-center gap-2"><DialogTitle>{selectedMission.title}</DialogTitle><Badge variant="outline" className={SEVERITY_STYLE[selectedMission.severity] || SEVERITY_STYLE.medium}>{selectedMission.severity}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Nexus Security Mission · {xdrClientId ? (xdr.filters?.selected_client_name || "selected client") : "all managed clients"}</p></div></div></DialogHeader>
            <div className="space-y-5 py-2">
              <div className="rounded-xl border border-violet-400/20 bg-violet-500/[0.05] p-4"><p className="text-sm font-semibold text-foreground">Outcome</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{selectedMission.detail}</p><p className="mt-3 text-xs font-medium text-violet-700 dark:text-violet-200">Expected impact: {selectedMission.impact}</p></div>
              <div><p className="mb-3 text-sm font-semibold text-foreground">Controlled response pack</p><div className="grid gap-2 sm:grid-cols-2">{(selectedMission.response_pack || []).map(step => <div key={step} className="flex gap-2 rounded-lg border border-white/[0.08] bg-black/[0.13] p-3 text-xs leading-relaxed text-muted-foreground"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />{step}</div>)}</div></div>
              <div className="space-y-2"><Label htmlFor="shield-mission-reason">Operational reason</Label><Textarea id="shield-mission-reason" value={missionReason} onChange={(event) => setMissionReason(event.target.value)} placeholder="Why is this mission being opened now, and what client outcome is expected?" className="min-h-28" /><p className="text-xs text-muted-foreground">Activation creates owned, auditable work only. It does not silently change customer systems.</p></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => { setSelectedMission(null); setMissionReason(""); }}>Cancel</Button><Button className="bg-violet-400 text-violet-950 hover:bg-violet-300" onClick={activateMission} disabled={savingMission || !missionReason.trim()}>{savingMission ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Target className="mr-1.5 h-4 w-4" />}Activate & audit</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedActivatedMission)} onOpenChange={(open) => { if (!open) setSelectedActivatedMission(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-violet-400/20 bg-[linear-gradient(160deg,#121020,#090b11)] sm:max-w-3xl">
          {selectedActivatedMission && <>
            <DialogHeader><div className="flex items-start gap-3"><div className="rounded-xl border border-violet-400/25 bg-violet-500/10 p-2.5"><Target className="h-5 w-5 text-violet-200" /></div><div><div className="flex flex-wrap items-center gap-2"><DialogTitle>{selectedActivatedMission.title}</DialogTitle><Badge variant="outline" className={SEVERITY_STYLE[selectedActivatedMission.severity] || SEVERITY_STYLE.medium}>{selectedActivatedMission.severity}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{selectedActivatedMission.client_name} · owned by {selectedActivatedMission.owner_name}</p></div></div></DialogHeader>
            <div className="space-y-5 py-2">
              <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white/[0.08] bg-black/[0.14] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-violet-200/65">Status</p><p className="mt-2 text-sm font-semibold capitalize text-foreground">{String(selectedActivatedMission.status).replaceAll("_", " ")}</p></div><div className="rounded-xl border border-white/[0.08] bg-black/[0.14] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-violet-200/65">Response pack</p><p className="mt-2 text-sm font-semibold text-foreground">{selectedActivatedMission.response_pack?.length || 0} controlled steps</p></div><div className="rounded-xl border border-white/[0.08] bg-black/[0.14] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-violet-200/65">Opened</p><p className="mt-2 text-sm font-semibold text-foreground">{evidenceTime(selectedActivatedMission.opened_at)}</p></div></div>
              <div><p className="mb-3 text-sm font-semibold text-foreground">Outcome workflow</p><div className="grid gap-2 sm:grid-cols-2">{(selectedActivatedMission.response_pack || []).map(step => <div key={step} className="flex gap-2 rounded-lg border border-white/[0.08] bg-black/[0.13] p-3 text-xs leading-relaxed text-muted-foreground"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />{step}</div>)}</div></div>
              <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="shield-mission-status">Mission status</Label><select id="shield-mission-status" value={missionStatus} onChange={(event) => setMissionStatus(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div><div className="space-y-2"><Label htmlFor="shield-mission-note">Outcome note</Label><Textarea id="shield-mission-note" value={missionUpdateNote} onChange={(event) => setMissionUpdateNote(event.target.value)} placeholder="Record the decision, customer impact and the next accountable step…" className="min-h-24" /></div></div>
              <div><p className="mb-3 text-sm font-semibold text-foreground">Mission history</p><div className="space-y-2">{[...(selectedActivatedMission.events || [])].reverse().map((event, index) => <div key={`${event.at}:${index}`} className="rounded-xl border border-white/[0.08] bg-black/[0.13] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold capitalize text-violet-100">{String(event.type || "mission event").replaceAll("_", " ")}</p><span className="text-[11px] text-muted-foreground">{evidenceTime(event.at)}</span></div><p className="mt-1 text-sm text-muted-foreground">{event.note}</p><p className="mt-2 text-[11px] text-violet-200/70">{event.technician_name} · {String(event.status || "").replaceAll("_", " ")}</p></div>)}</div></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setSelectedActivatedMission(null)}>Close</Button>{selectedActivatedMission.ticket_id ? <Button variant="outline" onClick={() => navigate(`/tickets?ticket=${selectedActivatedMission.ticket_id}`)}><ClipboardList className="mr-1.5 h-4 w-4" />Open {selectedActivatedMission.ticket_number || "ticket"}</Button> : <Button variant="outline" onClick={createMissionTicket} disabled={creatingMissionTicket || !selectedActivatedMission.client_id} title={!selectedActivatedMission.client_id ? "Select one client in Shield XDR before creating remediation work" : undefined}>{creatingMissionTicket ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ClipboardList className="mr-1.5 h-4 w-4" />}Create remediation ticket</Button>}<Button className="bg-violet-400 text-violet-950 hover:bg-violet-300" onClick={saveMissionUpdate} disabled={savingMission || !missionUpdateNote.trim()}>{savingMission ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Record update</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedIncident)} onOpenChange={(open) => { if (!open) setSelectedIncident(null); }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto border-rose-400/20 bg-[linear-gradient(160deg,#15101a,#090b11)] sm:max-w-3xl">
          {selectedIncident && <>
            <DialogHeader><div className="flex items-start gap-3"><div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-2.5"><Siren className="h-5 w-5 text-rose-200" /></div><div><div className="flex flex-wrap items-center gap-2"><DialogTitle>{selectedIncident.title}</DialogTitle><Badge variant="outline" className={SEVERITY_STYLE[selectedIncident.severity] || SEVERITY_STYLE.medium}>{selectedIncident.severity}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{selectedIncident.client_name} · {selectedIncident.categories?.join(" + ")}</p></div></div></DialogHeader>
            <div className="space-y-5 py-2">
              <div className="rounded-xl border border-white/[0.09] bg-black/[0.16] p-4"><p className="text-sm font-semibold text-foreground">Why Nexus grouped this case</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{selectedIncident.summary}</p><p className="mt-2 text-xs text-amber-100/80">Correlation is an investigation aid, not proof of causation. Validate the persisted subject and customer relationship before containment.</p></div>
              <div><p className="mb-3 text-sm font-semibold text-foreground">Retained evidence</p><div className="space-y-2">{(selectedIncident.evidence || []).map((item, index) => <button type="button" key={`${item.id}:${index}`} onClick={() => navigate(item.route)} className="group w-full rounded-xl border border-white/[0.09] bg-black/[0.14] p-3 text-left hover:border-rose-400/25"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Badge variant="outline" className={SEVERITY_STYLE[item.severity] || SEVERITY_STYLE.medium}>{item.severity}</Badge><span className="text-xs font-medium text-rose-100">{item.category} · {item.source}</span></div><span className="text-[11px] text-muted-foreground">{evidenceTime(item.observed_at)}</span></div><p className="mt-2 text-sm font-semibold text-foreground">{item.title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</p><span className="mt-2 inline-flex items-center text-[11px] text-rose-200">Open source evidence<ArrowRight className="ml-1 h-3 w-3" /></span></button>)}</div></div>
              <div><p className="mb-3 text-sm font-semibold text-foreground">Approval-gated response plan</p><div className="grid gap-2 sm:grid-cols-2">{(selectedIncident.suggested_actions || []).map(action => <div key={action} className="flex gap-2 rounded-lg border border-amber-400/15 bg-amber-500/[0.035] p-3 text-xs text-amber-100/85"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />{action}</div>)}</div></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setSelectedIncident(null)}>Close</Button><Button className="bg-rose-400 text-rose-950 hover:bg-rose-300" onClick={() => openInvestigation(selectedIncident)} disabled={savingCase}>{savingCase ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ClipboardList className="mr-1.5 h-4 w-4" />}Open investigation</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedCase)} onOpenChange={(open) => { if (!open) setSelectedCase(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-amber-400/20 bg-[linear-gradient(160deg,#17130d,#090b11)] sm:max-w-3xl">
          {selectedCase && <>
            <DialogHeader><div className="flex items-start gap-3"><div className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-2.5"><ClipboardList className="h-5 w-5 text-amber-200" /></div><div><div className="flex flex-wrap items-center gap-2"><DialogTitle>{selectedCase.title}</DialogTitle><Badge variant="outline" className={SEVERITY_STYLE[selectedCase.severity] || SEVERITY_STYLE.medium}>{selectedCase.severity}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{selectedCase.client_name} · owned by {selectedCase.owner_name}</p></div></div></DialogHeader>
            <div className="space-y-5 py-2">
              <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white/[0.08] bg-black/[0.14] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-amber-200/65">Status</p><p className="mt-2 text-sm font-semibold capitalize text-foreground">{String(selectedCase.status).replace("_", " ")}</p></div><div className="rounded-xl border border-white/[0.08] bg-black/[0.14] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-amber-200/65">Evidence retained</p><p className="mt-2 text-sm font-semibold text-foreground">{selectedCase.evidence_snapshot?.length || 0} signals</p></div><div className="rounded-xl border border-white/[0.08] bg-black/[0.14] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-amber-200/65">Opened</p><p className="mt-2 text-sm font-semibold text-foreground">{evidenceTime(selectedCase.opened_at)}</p></div></div>
              <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="xdr-case-status">Investigation status</Label><select id="xdr-case-status" value={caseStatus} onChange={(event) => setCaseStatus(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"><option value="investigating">Investigating</option><option value="contained">Contained</option><option value="recovering">Recovering</option><option value="resolved">Resolved</option><option value="false_positive">False positive</option></select></div><div className="space-y-2"><Label htmlFor="xdr-case-note">Decision note</Label><Textarea id="xdr-case-note" value={caseNote} onChange={(event) => setCaseNote(event.target.value)} placeholder="Record what was validated, decided, and what should happen next…" className="min-h-24" /></div></div>
              <div><p className="mb-3 text-sm font-semibold text-foreground">Case history</p><div className="space-y-2">{[...(selectedCase.events || [])].reverse().map((event, index) => <div key={`${event.at}:${index}`} className="rounded-xl border border-white/[0.08] bg-black/[0.13] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold capitalize text-amber-100">{String(event.type || "case event").replaceAll("_", " ")}</p><span className="text-[11px] text-muted-foreground">{evidenceTime(event.at)}</span></div><p className="mt-1 text-sm text-muted-foreground">{event.note}</p><p className="mt-2 text-[11px] text-amber-200/70">{event.technician_name} · {String(event.status || "").replace("_", " ")}</p></div>)}</div></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setSelectedCase(null)}>Close</Button><Button variant="outline" onClick={() => { setSelectedCase(null); setTab("response"); }}><Siren className="mr-1.5 h-4 w-4" />Response queue</Button><Button className="bg-amber-400 text-amber-950 hover:bg-amber-300" onClick={saveCaseUpdate} disabled={savingCase || !caseNote.trim()}>{savingCase ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Record update</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
