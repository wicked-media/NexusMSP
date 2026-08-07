import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertTriangle, BookOpenCheck, CalendarClock, CheckCircle2, CircleAlert, ClipboardCheck, Download, FileCheck2, History, Layers3, Library, ListChecks, Loader2, Paperclip, Pencil, Plus, RefreshCw, ShieldAlert, ShieldCheck, Target, UserCheck, WandSparkles } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const TABS = ["overview", "programs", "issues", "policies", "controls", "evidence", "reports", "insurance"];
const legacyTabs = { dashboard: "overview", clients: "evidence" };
const EMPTY = { frameworks: [], summary: { total_frameworks: 0, evidence_scans: 0, clients_assessed: 0, avg_compliance_pct: null } };
const isScore = (value) => Number.isFinite(value);
const scoreLabel = (value) => isScore(value) ? `${value}%` : "Not assessed";
const scoreText = (value) => !isScore(value) ? "text-muted-foreground" : value >= 85 ? "text-emerald-300" : value >= 60 ? "text-amber-300" : "text-rose-300";
const scoreBadge = (value) => !isScore(value) ? "border-slate-500/30 text-slate-200" : value >= 85 ? "border-emerald-500/30 text-emerald-200" : value >= 60 ? "border-amber-500/30 text-amber-200" : "border-rose-500/30 text-rose-200";
const readableDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toLocaleString() : "Not recorded";
};
const blankProgram = { name: "", client_id: "", framework_ids: [], owner: "", target_date: "", scope: "All managed users, devices and connected services" };
const blankFramework = { name: "", category: "Customer requirement", region: "Australia", authority: "Internal, contractual or regulatory requirement", description: "" };
const blankControl = { reference: "", name: "", description: "", check: "manual", evidence_guidance: "", owner_role: "Compliance owner", frequency: "continuous", mapped_frameworks: [] };
const blankIssue = { title: "", client_id: "", program_id: "", framework_id: "", description: "", severity: "medium", owner: "", due_date: "", treatment: "remediate" };
const blankPolicy = { template_id: "", name: "", client_id: "", category: "Governance", owner: "", approver: "Compliance approver", review_frequency_months: "12", framework_ids: [], purpose: "", content: "" };

function EvidenceScan({ scan, onGenerate, generating }) {
  if (!scan) return null;
  const total = Number(scan.total || 0);
  const evaluated = Number(scan.evaluated || 0);
  const coverage = Number(scan.coverage_pct || 0);
  return (
    <Card className="border-sky-500/20 bg-sky-500/[0.025]" data-testid="compliance-evidence-result">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4 text-sky-300" />{scan.framework_name || scan.framework} evidence scan</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{scan.client_name || "Client"} - captured {readableDate(scan.scanned_at)}</p>
        </div>
        <Badge variant="outline" className={scoreBadge(scan.score)}>{scoreLabel(scan.score)} verified pass rate</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Evidence coverage" value={`${coverage}%`} detail={`${evaluated}/${total} controls evaluated`} />
          <MetricCard label="Controls passed" value={scan.passed ?? 0} detail="Only observed evidence counts" tone="text-emerald-300" />
          <MetricCard label="Unassessed" value={Math.max(total - evaluated, 0)} detail="Needs an evidence source" tone="text-amber-300" />
        </div>
        {isScore(scan.score) ? <Progress value={scan.score} className="h-2" /> : <p className="rounded-md border border-slate-500/20 bg-slate-500/5 px-3 py-2 text-xs text-muted-foreground">No pass rate is shown until this scan evaluates at least one control.</p>}
        <div className="overflow-x-auto rounded-lg border border-border/70">
          <Table>
            <TableHeader><TableRow><TableHead>Control</TableHead><TableHead>Evidence</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>{(scan.controls || []).map((control) => <TableRow key={control.id}>
              <TableCell><p className="font-mono text-[11px] text-muted-foreground">{control.id}</p><p className="mt-0.5 text-sm font-medium">{control.name}</p></TableCell>
              <TableCell className="max-w-md text-xs text-muted-foreground">{control.evidence || "No evidence captured"}</TableCell>
              <TableCell><Badge variant="outline" className={control.status === "pass" ? "border-emerald-500/30 text-emerald-200" : control.status === "fail" ? "border-rose-500/30 text-rose-200" : "border-amber-500/30 text-amber-200"}>{control.status === "pass" ? "Evidence passed" : control.status === "fail" ? "Evidence gap" : "Not assessed"}</Badge></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
        <div className="flex justify-end"><Button onClick={() => onGenerate(scan)} disabled={generating}><FileCheck2 className="mr-1.5 h-4 w-4" />{generating ? "Generating..." : "Generate evidence report"}</Button></div>
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value, detail, tone = "" }) {
  return <div className="rounded-lg border border-border/80 bg-background/50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className={`mt-1 text-xl font-semibold ${tone}`}>{value}</p><p className="text-xs text-muted-foreground">{detail}</p></div>;
}

function InsuranceEvidence({ clients, clientId, onClientChange, evidence, loading, onRefresh, onDownload, downloading, onStartScan }) {
  const readiness = evidence?.readiness_score;
  const latestScan = evidence?.latest_compliance_scan;
  const readinessState = evidence?.readiness_state === "ready_for_review" ? ["Ready for review", "border-emerald-500/30 text-emerald-200"] : evidence?.readiness_state === "evidence_gaps" ? ["Evidence gaps", "border-amber-500/30 text-amber-200"] : ["Not assessed", "border-slate-500/30 text-slate-200"];
  return <div className="space-y-4">
    <Card className="border-sky-500/20 bg-sky-500/[0.025]"><CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between"><div className="min-w-0 flex-1"><p className="font-semibold">Customer evidence pack</p><p className="mt-1 text-sm text-muted-foreground">Only observed NexusMSP evidence is included. Gaps remain visible before anything is shared.</p></div><div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><Select value={clientId} onValueChange={onClientChange}><SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="Choose customer" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name || client.id}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" onClick={onRefresh} disabled={!clientId || loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button><Button size="sm" onClick={onDownload} disabled={!clientId || loading || downloading}>{downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}Download pack</Button></div></CardContent></Card>
    {!clientId ? <Card><CardContent className="p-10 text-center"><ShieldAlert className="mx-auto h-7 w-7 text-sky-300" /><p className="mt-3 font-medium">Choose a customer to begin</p></CardContent></Card> : loading ? <Card><CardContent className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Collecting observed evidence...</CardContent></Card> : <><div className="grid gap-3 md:grid-cols-3"><MetricCard label="Evidence readiness" value={scoreLabel(readiness)} detail={readinessState[0]} /><MetricCard label="Evidence coverage" value={`${evidence?.evidence_coverage_pct ?? 0}%`} detail={`${evidence?.device_count ?? 0} managed assets observed`} /><MetricCard label="Open security alerts" value={evidence?.controls?.open_security_alerts ?? 0} detail="Reported by connected sources" /></div><Card><CardHeader className="flex-row items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-base">Observed control evidence</CardTitle><p className="mt-1 text-sm text-muted-foreground">Coverage is based on recorded assets, never assumed policy settings.</p></div><Badge variant="outline" className={readinessState[1]}>{readinessState[0]}</Badge></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{(evidence?.metrics || []).map((metric) => <div key={metric.key} className="rounded-lg border border-border/80 bg-muted/10 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{metric.label}</p><p className="mt-1 text-xs text-muted-foreground">{metric.evidence}</p></div><Badge variant="outline" className={metric.state === "observed" ? "border-emerald-500/30 text-emerald-200" : metric.state === "evidence_gap" ? "border-amber-500/30 text-amber-200" : "border-slate-500/30 text-slate-200"}>{scoreLabel(metric.value)}</Badge></div>{isScore(metric.value) && <Progress value={metric.value} className="mt-3 h-1.5" />}</div>)}</CardContent></Card><div className="grid gap-3 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Restore validation</CardTitle></CardHeader><CardContent>{evidence?.last_restore_drill ? <><Badge variant="outline" className="border-emerald-500/30 text-emerald-200">Completed</Badge><p className="mt-2 text-sm font-medium">{evidence.last_restore_drill.scope || "Restore drill"}</p><p className="mt-1 text-xs text-muted-foreground">{readableDate(evidence.last_restore_drill.completed_at)}</p></> : <><Badge variant="outline" className="border-amber-500/30 text-amber-200">Evidence gap</Badge><p className="mt-2 text-sm text-muted-foreground">No completed restore drill is recorded for this customer.</p></>}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Linked compliance scan</CardTitle></CardHeader><CardContent>{latestScan ? <><Badge variant="outline" className="border-sky-500/30 text-sky-200">{latestScan.framework_name || latestScan.framework}</Badge><p className={`mt-2 text-sm font-medium ${scoreText(latestScan.score)}`}>{scoreLabel(latestScan.score)} verified pass rate</p><p className="mt-1 text-xs text-muted-foreground">{latestScan.evaluated || 0}/{latestScan.total || 0} controls evaluated on {readableDate(latestScan.scanned_at)}</p></> : <><Badge variant="outline" className="border-amber-500/30 text-amber-200">Not assessed</Badge><p className="mt-2 text-sm text-muted-foreground">Run a customer evidence scan to add an audit-ready compliance context.</p><Button variant="outline" size="sm" className="mt-3" onClick={onStartScan}>Run evidence scan</Button></>}</CardContent></Card></div></>}</div>;
}

export default function ComplianceHubPage() {
  const { token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState(TABS.includes(requestedTab) ? requestedTab : legacyTabs[requestedTab] || "overview");
  const [overview, setOverview] = useState(EMPTY);
  const [clients, setClients] = useState([]);
  const [frameworks, setFrameworks] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [issues, setIssues] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [policyTemplates, setPolicyTemplates] = useState([]);
  const [customFrameworks, setCustomFrameworks] = useState([]);
  const [evidenceChecks, setEvidenceChecks] = useState([]);
  const [scans, setScans] = useState([]);
  const [reports, setReports] = useState([]);
  const [selectedScan, setSelectedScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanClientId, setScanClientId] = useState("");
  const [scanFramework, setScanFramework] = useState("cis");
  const [scanning, setScanning] = useState(false);
  const [generatingId, setGeneratingId] = useState("");
  const [insuranceClientId, setInsuranceClientId] = useState("");
  const [insuranceEvidence, setInsuranceEvidence] = useState(null);
  const [insuranceLoading, setInsuranceLoading] = useState(false);
  const [insuranceDownloading, setInsuranceDownloading] = useState(false);
  const [programOpen, setProgramOpen] = useState(false);
  const [programForm, setProgramForm] = useState(blankProgram);
  const [savingProgram, setSavingProgram] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [frameworkForm, setFrameworkForm] = useState(blankFramework);
  const [controlForm, setControlForm] = useState(blankControl);
  const [builderFrameworkId, setBuilderFrameworkId] = useState("");
  const [savingFramework, setSavingFramework] = useState(false);
  const [savingControl, setSavingControl] = useState(false);
  const [frameworkSearch, setFrameworkSearch] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueForm, setIssueForm] = useState(blankIssue);
  const [savingIssue, setSavingIssue] = useState(false);
  const [issueFilter, setIssueFilter] = useState("active");
  const [resolutionIssue, setResolutionIssue] = useState(null);
  const [resolutionText, setResolutionText] = useState("");
  const [resolutionStatus, setResolutionStatus] = useState("resolved");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyForm, setPolicyForm] = useState(blankPolicy);
  const [editingPolicyId, setEditingPolicyId] = useState("");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [approvalPolicy, setApprovalPolicy] = useState(null);
  const [approvalNote, setApprovalNote] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [overviewResult, clientsResult, frameworksResult, scansResult, reportsResult, programsResult, customResult, checksResult, issuesResult, policiesResult, policyTemplatesResult] = await Promise.all([
        axios.get(`${API}/compliance-frameworks/overview`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/compliance/frameworks`, { headers }),
        axios.get(`${API}/compliance/reports`, { headers }),
        axios.get(`${API}/compliance-generator/reports`, { headers }),
        axios.get(`${API}/compliance/programs`, { headers }),
        axios.get(`${API}/compliance/custom-frameworks`, { headers }),
        axios.get(`${API}/compliance/evidence-checks`, { headers }),
        axios.get(`${API}/compliance/issues`, { headers }),
        axios.get(`${API}/compliance/policies`, { headers }),
        axios.get(`${API}/compliance/policy-templates`, { headers }),
      ]);
      setOverview(overviewResult.data || EMPTY);
      setClients(clientsResult.data || []);
      setFrameworks(frameworksResult.data || []);
      setScans(scansResult.data || []);
      setReports(reportsResult.data || []);
      setPrograms(programsResult.data || []);
      setCustomFrameworks(customResult.data || []);
      setEvidenceChecks(checksResult.data || []);
      setIssues(issuesResult.data || []);
      setPolicies(policiesResult.data || []);
      setPolicyTemplates(policyTemplatesResult.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Compliance Hub could not be loaded");
    } finally { setLoading(false); }
  }, [headers]);

  const loadInsuranceEvidence = useCallback(async (clientId = insuranceClientId) => {
    if (!clientId) { setInsuranceEvidence(null); return; }
    setInsuranceLoading(true);
    try {
      const response = await axios.get(`${API}/security/insurance-vault?client_id=${encodeURIComponent(clientId)}`, { headers });
      setInsuranceEvidence(response.data || null);
    } catch (error) {
      setInsuranceEvidence(null);
      toast.error(error.response?.data?.detail || "Insurance evidence could not be loaded");
    } finally { setInsuranceLoading(false); }
  }, [headers, insuranceClientId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setTab(TABS.includes(requestedTab) ? requestedTab : legacyTabs[requestedTab] || "overview"); }, [requestedTab]);
  useEffect(() => { if (tab === "insurance" && !insuranceClientId && clients.length) setInsuranceClientId(clients[0].id); }, [tab, insuranceClientId, clients]);
  useEffect(() => { if (tab === "insurance" && insuranceClientId) loadInsuranceEvidence(insuranceClientId); }, [tab, insuranceClientId, loadInsuranceEvidence]);

  const selectTab = (next) => {
    setTab(next);
    navigate(next === "overview" ? "/compliance" : `/compliance?tab=${next}`, { replace: true });
  };
  const openScan = () => {
    setScanClientId((current) => current || clients[0]?.id || "");
    setScanFramework((current) => current || frameworks[0]?.id || "cis");
    setScanOpen(true);
  };
  const runScan = async () => {
    if (!scanClientId) { toast.error("Choose a customer before running an evidence scan"); return; }
    setScanning(true);
    try {
      const response = await axios.get(`${API}/compliance/scan/${encodeURIComponent(scanClientId)}?framework=${encodeURIComponent(scanFramework)}`, { headers });
      const scan = response.data;
      setSelectedScan(scan);
      setScans((current) => [scan, ...current.filter((item) => item.id !== scan.id)]);
      setScanOpen(false);
      selectTab("evidence");
      toast.success(isScore(scan.score) ? `Evidence scan completed: ${scan.score}% verified pass rate` : "Evidence scan completed with no assessed controls");
      await load({ quiet: true });
    } catch (error) { toast.error(error.response?.data?.detail || "Evidence scan could not be completed"); }
    finally { setScanning(false); }
  };
  const generateReport = async (scan) => {
    setGeneratingId(scan.id);
    try {
      const response = await axios.post(`${API}/compliance-generator/generate`, { scan_id: scan.id }, { headers });
      const report = response.data;
      setReports((current) => [report, ...current.filter((item) => item.id !== report.id)]);
      toast.success("Evidence-backed compliance report generated");
      selectTab("reports");
    } catch (error) { toast.error(error.response?.data?.detail || "Compliance report could not be generated"); }
    finally { setGeneratingId(""); }
  };
  const downloadInsurancePack = async () => {
    if (!insuranceClientId) { toast.error("Choose a customer before downloading an evidence pack"); return; }
    setInsuranceDownloading(true);
    try {
      const response = await axios.get(`${API}/security/insurance-vault.pdf?client_id=${encodeURIComponent(insuranceClientId)}`, { headers, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cyber-insurance-evidence-${(insuranceEvidence?.client_name || "customer").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Evidence pack downloaded");
    } catch (error) { toast.error(error.response?.data?.detail || "Evidence pack could not be downloaded"); }
    finally { setInsuranceDownloading(false); }
  };

  const createProgram = async () => {
    if (!programForm.client_id || !programForm.framework_ids.length) { toast.error("Choose a customer and at least one framework"); return; }
    setSavingProgram(true);
    try {
      const response = await axios.post(`${API}/compliance/programs`, programForm, { headers });
      setPrograms((current) => [response.data, ...current]);
      setProgramForm(blankProgram);
      setProgramOpen(false);
      toast.success("Compliance programme created");
      selectTab("programs");
    } catch (error) { toast.error(error.response?.data?.detail || "Compliance programme could not be created"); }
    finally { setSavingProgram(false); }
  };

  const createIssue = async () => {
    if (!issueForm.client_id || issueForm.title.trim().length < 3) { toast.error("Choose a customer and enter an issue title"); return; }
    setSavingIssue(true);
    try {
      const selectedFramework = frameworks.find((item) => item.id === issueForm.framework_id);
      const response = await axios.post(`${API}/compliance/issues`, { ...issueForm, framework_name: selectedFramework?.name || "" }, { headers });
      setIssues((current) => [response.data, ...current]);
      setIssueForm(blankIssue);
      setIssueOpen(false);
      selectTab("issues");
      toast.success("Compliance issue added to the assurance queue");
    } catch (error) { toast.error(error.response?.data?.detail || "Compliance issue could not be created"); }
    finally { setSavingIssue(false); }
  };

  const updateIssue = async (issue, changes) => {
    try {
      const response = await axios.put(`${API}/compliance/issues/${encodeURIComponent(issue.id)}`, changes, { headers });
      setIssues((current) => current.map((item) => item.id === issue.id ? response.data : item));
      toast.success(changes.status === "in_progress" ? "Issue assigned to active remediation" : "Compliance issue updated");
      return response.data;
    } catch (error) { toast.error(error.response?.data?.detail || "Compliance issue could not be updated"); return null; }
  };

  const completeIssue = async () => {
    if (!resolutionIssue || resolutionText.trim().length < 5) { toast.error("Record the resolution or risk-acceptance justification"); return; }
    const updated = await updateIssue(resolutionIssue, { status: resolutionStatus, resolution: resolutionText });
    if (updated) { setResolutionIssue(null); setResolutionText(""); }
  };

  const attachIssueEvidence = async (issue, file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await axios.post(`${API}/compliance/issues/${encodeURIComponent(issue.id)}/attachments`, formData, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
      setIssues((current) => current.map((item) => item.id === issue.id ? { ...item, attachments: [...(item.attachments || []), response.data] } : item));
      toast.success("Evidence attached and added to the audit history");
    } catch (error) { toast.error(error.response?.data?.detail || "Evidence could not be attached"); }
  };

  const choosePolicyTemplate = (templateId) => {
    const template = policyTemplates.find((item) => item.id === templateId);
    setPolicyForm((current) => ({
      ...current, template_id: templateId,
      name: template?.name || current.name,
      category: template?.category || current.category,
      purpose: template?.purpose || current.purpose,
      framework_ids: template?.frameworks || current.framework_ids,
    }));
  };

  const openPolicyEditor = (policy = null) => {
    setEditingPolicyId(policy?.id || "");
    setPolicyForm(policy ? {
      template_id: policy.template_id || "", name: policy.name || "", client_id: policy.client_id || "",
      category: policy.category || "Governance", owner: policy.owner || "", approver: policy.approver || "Compliance approver",
      review_frequency_months: String(policy.review_frequency_months || 12), framework_ids: policy.framework_ids || [],
      purpose: policy.purpose || "", content: policy.content || "",
    } : blankPolicy);
    setPolicyOpen(true);
  };

  const savePolicy = async () => {
    if (policyForm.name.trim().length < 3 && !policyForm.template_id) { toast.error("Choose a template or enter a policy name"); return; }
    setSavingPolicy(true);
    try {
      const response = editingPolicyId
        ? await axios.put(`${API}/compliance/policies/${encodeURIComponent(editingPolicyId)}`, policyForm, { headers })
        : await axios.post(`${API}/compliance/policies`, policyForm, { headers });
      setPolicies((current) => editingPolicyId ? current.map((item) => item.id === editingPolicyId ? response.data : item) : [response.data, ...current]);
      setPolicyOpen(false); setEditingPolicyId(""); setPolicyForm(blankPolicy); selectTab("policies");
      toast.success(editingPolicyId ? "Policy updated and returned to draft review" : "Policy draft created");
    } catch (error) { toast.error(error.response?.data?.detail || "Policy could not be saved"); }
    finally { setSavingPolicy(false); }
  };

  const approvePolicy = async () => {
    if (!approvalPolicy || approvalNote.trim().length < 5) { toast.error("Record the approval rationale"); return; }
    try {
      const response = await axios.post(`${API}/compliance/policies/${encodeURIComponent(approvalPolicy.id)}/approve`, { approval_note: approvalNote }, { headers });
      setPolicies((current) => current.map((item) => item.id === approvalPolicy.id ? response.data : item));
      setApprovalPolicy(null); setApprovalNote(""); toast.success("Policy approved and its next review scheduled");
    } catch (error) { toast.error(error.response?.data?.detail || "Policy could not be approved"); }
  };

  const acknowledgePolicy = async (policy) => {
    try {
      const response = await axios.post(`${API}/compliance/policies/${encodeURIComponent(policy.id)}/acknowledge`, {}, { headers });
      setPolicies((current) => current.map((item) => item.id === policy.id && !(item.acknowledgements || []).some((ack) => ack.user_id === response.data.user_id && ack.version === response.data.version) ? { ...item, acknowledgements: [...(item.acknowledgements || []), response.data], acknowledgement_count: Number(item.acknowledgement_count || 0) + 1 } : item));
      toast.success("Policy acknowledgement recorded");
    } catch (error) { toast.error(error.response?.data?.detail || "Policy could not be acknowledged"); }
  };

  const toggleProgramFramework = (frameworkId) => setProgramForm((current) => ({
    ...current,
    framework_ids: current.framework_ids.includes(frameworkId) ? current.framework_ids.filter((id) => id !== frameworkId) : [...current.framework_ids, frameworkId],
  }));

  const createCustomFramework = async () => {
    if (frameworkForm.name.trim().length < 3) { toast.error("Enter a framework name"); return; }
    setSavingFramework(true);
    try {
      const response = await axios.post(`${API}/compliance/custom-frameworks`, frameworkForm, { headers });
      setCustomFrameworks((current) => [response.data, ...current]);
      setFrameworks((current) => [{ id: response.data.id, name: response.data.name, controls: 0, category: response.data.category, region: response.data.region, template_state: "custom", custom: true, version: 1 }, ...current]);
      setBuilderFrameworkId(response.data.id);
      setFrameworkForm(blankFramework);
      toast.success("Custom framework created — add its first control");
    } catch (error) { toast.error(error.response?.data?.detail || "Custom framework could not be created"); }
    finally { setSavingFramework(false); }
  };

  const addCustomControl = async () => {
    if (!builderFrameworkId || controlForm.name.trim().length < 3) { toast.error("Choose a custom framework and enter a control name"); return; }
    setSavingControl(true);
    try {
      const response = await axios.post(`${API}/compliance/custom-frameworks/${encodeURIComponent(builderFrameworkId)}/controls`, controlForm, { headers });
      setCustomFrameworks((current) => current.map((framework) => framework.id === builderFrameworkId ? { ...framework, controls: [...(framework.controls || []), response.data], version: (framework.version || 1) + 1 } : framework));
      setFrameworks((current) => current.map((framework) => framework.id === builderFrameworkId ? { ...framework, controls: Number(framework.controls || 0) + 1, version: (framework.version || 1) + 1 } : framework));
      setControlForm(blankControl);
      toast.success("Control added to the framework library");
    } catch (error) { toast.error(error.response?.data?.detail || "Control could not be added"); }
    finally { setSavingControl(false); }
  };

  const startProgramScan = (program) => {
    setScanClientId(program.client_id);
    setScanFramework(program.framework_ids?.[0] || "cis");
    setScanOpen(true);
  };

  const summary = overview.summary || EMPTY.summary;
  const frameworkCards = overview.frameworks || [];
  const scansById = useMemo(() => new Map(scans.map((scan) => [scan.id, scan])), [scans]);
  const selectedCustomFramework = useMemo(() => customFrameworks.find((framework) => framework.id === builderFrameworkId) || null, [customFrameworks, builderFrameworkId]);
  const filteredFrameworks = useMemo(() => {
    const query = frameworkSearch.trim().toLowerCase();
    return query ? frameworks.filter((framework) => `${framework.name} ${framework.category} ${framework.region}`.toLowerCase().includes(query)) : frameworks;
  }, [frameworks, frameworkSearch]);
  const activeIssues = useMemo(() => issues.filter((issue) => !["resolved", "accepted_risk"].includes(issue.status)), [issues]);
  const filteredIssues = useMemo(() => issueFilter === "active" ? activeIssues : issueFilter === "all" ? issues : issues.filter((issue) => issue.status === issueFilter), [issues, activeIssues, issueFilter]);

  return <div className="space-y-5" data-testid="compliance-hub">
    <OperationalPageHeader eyebrow="Security workspace - continuous assurance" title="Compliance" description="Build each customer’s compliance path, continuously collect evidence, reuse controls across frameworks, and preserve an audit-ready history without overstating certification." icon={ShieldCheck} tone="emerald" actions={<><Button variant="outline" size="sm" onClick={() => navigate("/audit-trail")}><History className="mr-1 h-4 w-4" />Audit trail</Button><Button variant="outline" size="sm" onClick={() => setBuilderOpen(true)}><WandSparkles className="mr-1 h-4 w-4" />Framework builder</Button><Button variant="outline" size="sm" onClick={() => setIssueOpen(true)}><CircleAlert className="mr-1 h-4 w-4" />New issue</Button><Button variant="outline" size="sm" onClick={() => setProgramOpen(true)}><Target className="mr-1 h-4 w-4" />New programme</Button><Button size="sm" onClick={openScan}><ClipboardCheck className="mr-1 h-4 w-4" />Run evidence scan</Button></>} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><HeroTile label="Frameworks" value={summary.total_frameworks || frameworks.length || 0} icon={ShieldCheck} glow="sky" subtitle={`${customFrameworks.length} custom · reusable controls`} onClick={() => selectTab("controls")} active={tab === "controls"} /><HeroTile label="Client programmes" value={programs.length} icon={Target} glow={programs.length ? "violet" : "zinc"} subtitle="Owned compliance paths" onClick={() => selectTab("programs")} active={tab === "programs"} /><HeroTile label="Open assurance issues" value={activeIssues.length} icon={CircleAlert} glow={activeIssues.length ? "amber" : "emerald"} subtitle={activeIssues.length ? "Remediation required" : "No active gaps"} onClick={() => selectTab("issues")} active={tab === "issues"} /><HeroTile label="Evidence scans" value={summary.evidence_scans || 0} icon={ClipboardCheck} glow={summary.evidence_scans ? "emerald" : "zinc"} subtitle={`${summary.clients_assessed || 0} customers assessed`} onClick={() => selectTab("evidence")} active={tab === "evidence"} /></div>
    <Tabs value={tab} onValueChange={selectTab}><TabsList className="grid h-auto w-full grid-cols-4 gap-1 p-1 lg:grid-cols-8"><TabsTrigger value="overview">Readiness</TabsTrigger><TabsTrigger value="programs">Programmes</TabsTrigger><TabsTrigger value="issues">Issues</TabsTrigger><TabsTrigger value="policies">Policies</TabsTrigger><TabsTrigger value="controls">Control library</TabsTrigger><TabsTrigger value="evidence">Evidence</TabsTrigger><TabsTrigger value="reports">Reports</TabsTrigger><TabsTrigger value="insurance">Insurance</TabsTrigger></TabsList>
      <TabsContent value="overview" className="mt-5"><div className="grid gap-3 xl:grid-cols-2">{frameworkCards.map((framework) => <Card key={framework.id} className="border-border/80"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{framework.name}</p><p className="mt-1 text-sm text-muted-foreground">{framework.clients_assessed || 0} customer{framework.clients_assessed === 1 ? "" : "s"} with current evidence</p></div><Badge variant="outline" className={framework.evidence_state === "evidence_available" ? "border-emerald-500/30 text-emerald-200" : "border-slate-500/30 text-slate-200"}>{framework.evidence_state === "evidence_available" ? "Evidence available" : "Not assessed"}</Badge></div><div className="mt-4 grid grid-cols-3 gap-2 text-xs"><MetricCard label="Pass rate" value={scoreLabel(framework.compliance_pct)} detail="Observed controls" tone={scoreText(framework.compliance_pct)} /><MetricCard label="Coverage" value={`${framework.evidence_coverage_pct ?? 0}%`} detail="Available evidence" /><MetricCard label="Controls" value={framework.total_controls || 0} detail="Framework controls" /></div>{isScore(framework.compliance_pct) ? <Progress value={framework.compliance_pct} className="mt-3 h-2" /> : <div className="mt-3 h-2 rounded-full bg-muted/40" />}<div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>Last evidence: {readableDate(framework.latest_assessed_at)}</span><Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={openScan}>Run check</Button></div></CardContent></Card>)}</div></TabsContent>
      <TabsContent value="programs" className="mt-5 space-y-4">
        <Card className="border-violet-500/20 bg-violet-500/[0.025]"><CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between"><div><p className="flex items-center gap-2 font-semibold"><Target className="h-4 w-4 text-violet-300" />Customer compliance programmes</p><p className="mt-1 text-sm text-muted-foreground">Give every customer a named path with frameworks, scope, owner, target date, evidence and visible gaps.</p></div><Button onClick={() => setProgramOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Create programme</Button></CardContent></Card>
        {programs.length === 0 ? <Card><CardContent className="p-12 text-center"><Target className="mx-auto h-8 w-8 text-violet-300" /><p className="mt-3 font-medium">No customer programmes yet</p><p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">Create a path for Essential Eight, ISO 27001, SOC 2, NIST, privacy, AI governance or any custom customer requirement.</p><Button className="mt-4" variant="outline" onClick={() => setProgramOpen(true)}>Create the first programme</Button></CardContent></Card> : <div className="grid gap-3 xl:grid-cols-2">{programs.map((program) => <Card key={program.id} className="overflow-hidden border-border/80"><CardContent className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="font-semibold">{program.name}</p><p className="mt-1 text-sm text-muted-foreground">{program.client_name}</p></div><Badge variant="outline" className={program.status === "monitoring" ? "border-emerald-500/30 text-emerald-200" : "border-violet-500/30 text-violet-200"}>{program.status === "monitoring" ? "Continuous monitoring" : "Planning"}</Badge></div><div className="mt-4 flex flex-wrap gap-1.5">{(program.framework_names || []).map((name) => <Badge key={name} variant="secondary" className="text-[10px]">{name}</Badge>)}</div><div className="mt-4 grid grid-cols-3 gap-2"><MetricCard label="Readiness" value={`${program.progress_pct || 0}%`} detail={`${program.frameworks_assessed || 0}/${program.framework_ids?.length || 0} assessed`} /><MetricCard label="Open gaps" value={program.open_gaps || 0} detail="Failed or unassessed" tone={program.open_gaps ? "text-amber-300" : "text-emerald-300"} /><MetricCard label="Target" value={program.target_date || "Ongoing"} detail={`Owner: ${program.owner || "Unassigned"}`} /></div><Progress value={program.progress_pct || 0} className="mt-4 h-2" /><div className="mt-4 flex items-center justify-between gap-3"><p className="truncate text-xs text-muted-foreground">{program.scope}</p><Button size="sm" variant="outline" onClick={() => startProgramScan(program)}><ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />Collect evidence</Button></div></CardContent></Card>)}</div>}
      </TabsContent>
      <TabsContent value="issues" className="mt-5 space-y-4">
        <Card className="border-amber-500/20 bg-amber-500/[0.025]"><CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div><p className="flex items-center gap-2 font-semibold"><ListChecks className="h-4 w-4 text-amber-300" />Assurance and remediation queue</p><p className="mt-1 text-sm text-muted-foreground">Evidence failures become owned work automatically. Resolutions, risk acceptance, attachments and re-verification remain auditable.</p></div><div className="flex gap-2"><Select value={issueFilter} onValueChange={setIssueFilter}><SelectTrigger className="w-44" aria-label="Filter assurance issues"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active issues</SelectItem><SelectItem value="open">Open</SelectItem><SelectItem value="in_progress">In progress</SelectItem><SelectItem value="ready_for_review">Ready for review</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="accepted_risk">Accepted risk</SelectItem><SelectItem value="all">All issues</SelectItem></SelectContent></Select><Button onClick={() => setIssueOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Add issue</Button></div></CardContent></Card>
        {filteredIssues.length === 0 ? <Card><CardContent className="p-12 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" /><p className="mt-3 font-medium">No issues in this view</p><p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">Run an evidence scan to automatically create assurance work, or record a manual risk, audit finding or customer commitment.</p></CardContent></Card> : <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Issue</TableHead><TableHead>Customer</TableHead><TableHead>Owner / due</TableHead><TableHead>Status</TableHead><TableHead>Evidence</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filteredIssues.map((issue) => <TableRow key={issue.id}><TableCell className="max-w-md"><div className="flex items-start gap-2"><CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${issue.severity === "critical" ? "text-rose-300" : issue.severity === "high" ? "text-orange-300" : issue.severity === "medium" ? "text-amber-300" : "text-sky-300"}`} /><div><p className="font-medium">{issue.title}</p><p className="mt-1 text-xs text-muted-foreground">{issue.framework_name || "Internal assurance"}{issue.latest_evidence ? ` · ${issue.latest_evidence}` : ""}</p></div></div></TableCell><TableCell>{issue.client_name || "Customer"}</TableCell><TableCell><p className="text-sm">{issue.owner || "Unassigned"}</p><p className={`mt-1 flex items-center gap-1 text-xs ${issue.overdue ? "text-rose-300" : "text-muted-foreground"}`}><CalendarClock className="h-3 w-3" />{issue.due_date || "No deadline"}{issue.overdue ? " · overdue" : ""}</p></TableCell><TableCell><Badge variant="outline" className={issue.status === "resolved" ? "border-emerald-500/30 text-emerald-200" : issue.status === "accepted_risk" ? "border-violet-500/30 text-violet-200" : issue.status === "in_progress" ? "border-sky-500/30 text-sky-200" : "border-amber-500/30 text-amber-200"}>{String(issue.status || "open").replaceAll("_", " ")}</Badge></TableCell><TableCell><label className="inline-flex cursor-pointer items-center gap-1 text-xs text-sky-300 hover:text-sky-200"><Paperclip className="h-3.5 w-3.5" />{issue.attachments?.length || 0} files<input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.csv,.doc,.docx,.xls,.xlsx,.txt,.md" onChange={(event) => { attachIssueEvidence(issue, event.target.files?.[0]); event.target.value = ""; }} /></label></TableCell><TableCell className="text-right"><div className="flex justify-end gap-1">{issue.status === "open" && <Button size="sm" variant="outline" onClick={() => updateIssue(issue, { status: "in_progress" })}>Start work</Button>}{!["resolved", "accepted_risk"].includes(issue.status) && <Button size="sm" onClick={() => { setResolutionIssue(issue); setResolutionStatus("resolved"); setResolutionText(""); }}>Close</Button>}</div></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>}
      </TabsContent>
      <TabsContent value="policies" className="mt-5 space-y-4">
        <Card className="border-violet-500/20 bg-violet-500/[0.025]"><CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div><p className="flex items-center gap-2 font-semibold"><BookOpenCheck className="h-4 w-4 text-violet-300" />Versioned policy governance</p><p className="mt-1 text-sm text-muted-foreground">Turn control requirements into owned policy, approval, review and workforce acknowledgement records.</p></div><Button onClick={() => openPolicyEditor()}><Plus className="mr-1.5 h-4 w-4" />Create policy</Button></CardContent></Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MetricCard label="Policy records" value={policies.length} detail="Global and customer-specific" /><MetricCard label="Approved" value={policies.filter((policy) => policy.status === "approved").length} detail="Current governed versions" tone="text-emerald-300" /><MetricCard label="Draft or review" value={policies.filter((policy) => ["draft", "in_review"].includes(policy.status)).length} detail="Awaiting completion" tone="text-amber-300" /><MetricCard label="Reviews overdue" value={policies.filter((policy) => policy.review_overdue).length} detail="Requires owner action" tone={policies.some((policy) => policy.review_overdue) ? "text-rose-300" : "text-emerald-300"} /></div>
        {policies.length === 0 ? <><Card><CardContent className="p-10 text-center"><BookOpenCheck className="mx-auto h-8 w-8 text-violet-300" /><p className="mt-3 font-medium">Build the policy foundation</p><p className="mx-auto mt-1 max-w-2xl text-sm text-muted-foreground">Start from a governed Nexus template, tailor it to the MSP or customer, then submit it for approval and acknowledgement.</p></CardContent></Card><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{policyTemplates.map((template) => <Card key={template.id} className="border-border/80 transition-colors hover:border-violet-500/30"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10"><BookOpenCheck className="h-4 w-4 text-violet-300" /></div><Badge variant="outline">{template.category}</Badge></div><p className="mt-4 font-semibold">{template.name}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.purpose}</p><Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => { setEditingPolicyId(""); setPolicyForm({ ...blankPolicy, template_id: template.id, name: template.name, category: template.category, purpose: template.purpose, framework_ids: template.frameworks || [] }); setPolicyOpen(true); }}>Use template</Button></CardContent></Card>)}</div></> : <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Policy</TableHead><TableHead>Scope</TableHead><TableHead>Owner</TableHead><TableHead>Version / status</TableHead><TableHead>Review</TableHead><TableHead>Acknowledged</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{policies.map((policy) => <TableRow key={policy.id}><TableCell><p className="font-medium">{policy.name}</p><p className="mt-1 text-xs text-muted-foreground">{policy.category} · {(policy.framework_ids || []).length} mapped frameworks</p></TableCell><TableCell>{policy.client_name || "MSP-wide"}</TableCell><TableCell><p>{policy.owner || "Unassigned"}</p><p className="text-xs text-muted-foreground">Approver: {policy.approver || "Unassigned"}</p></TableCell><TableCell><Badge variant="outline" className={policy.status === "approved" ? "border-emerald-500/30 text-emerald-200" : policy.status === "retired" ? "border-slate-500/30 text-slate-200" : "border-amber-500/30 text-amber-200"}>v{policy.version || 1} · {String(policy.status || "draft").replaceAll("_", " ")}</Badge></TableCell><TableCell><p className={policy.review_overdue ? "text-rose-300" : ""}>{policy.next_review_date || "After approval"}</p>{policy.review_overdue && <p className="text-xs text-rose-300">Overdue</p>}</TableCell><TableCell>{policy.acknowledgement_count || policy.acknowledgements?.length || 0}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${policy.name}`} onClick={() => openPolicyEditor(policy)}><Pencil className="h-4 w-4" /></Button>{policy.status !== "approved" ? <Button size="sm" onClick={() => { setApprovalPolicy(policy); setApprovalNote(""); }}>Approve</Button> : <Button size="sm" variant="outline" onClick={() => acknowledgePolicy(policy)}><UserCheck className="mr-1 h-3.5 w-3.5" />Acknowledge</Button>}</div></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>}
      </TabsContent>
      <TabsContent value="controls" className="mt-5 space-y-4">
        <Card className="border-sky-500/20 bg-sky-500/[0.025]"><CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div><p className="flex items-center gap-2 font-semibold"><Library className="h-4 w-4 text-sky-300" />Reusable control and framework library</p><p className="mt-1 text-sm text-muted-foreground">Start with common readiness templates, build any missing standard, and map controls to Nexus evidence sources.</p></div><div className="flex flex-col gap-2 sm:flex-row"><Input value={frameworkSearch} onChange={(event) => setFrameworkSearch(event.target.value)} placeholder="Search frameworks, region or category" className="sm:w-72" aria-label="Search framework library" /><Button onClick={() => setBuilderOpen(true)}><WandSparkles className="mr-1.5 h-4 w-4" />Build framework</Button></div></CardContent></Card>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredFrameworks.map((framework) => <Card key={framework.id} className="border-border/80 transition-colors hover:border-sky-500/30"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300"><Layers3 className="h-4 w-4" /></div><Badge variant="outline" className={framework.custom ? "border-violet-500/30 text-violet-200" : "border-sky-500/30 text-sky-200"}>{framework.custom ? `Custom v${framework.version || 1}` : "Readiness template"}</Badge></div><p className="mt-4 font-semibold">{framework.name}</p><p className="mt-1 text-xs text-muted-foreground">{framework.region || "Global"} · {framework.category || "Compliance"}</p><div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3"><span className="text-xs text-muted-foreground">{framework.controls || 0} mapped controls</span>{framework.custom && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setBuilderFrameworkId(framework.id); setBuilderOpen(true); }}>Add controls</Button>}</div></CardContent></Card>)}</div>
        {!filteredFrameworks.length && <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">No frameworks match this search.</CardContent></Card>}
      </TabsContent>
      <TabsContent value="evidence" className="mt-5 space-y-4">{selectedScan && <EvidenceScan scan={selectedScan} onGenerate={generateReport} generating={generatingId === selectedScan.id} />}{scans.length === 0 ? <Card><CardContent className="p-10 text-center"><ClipboardCheck className="mx-auto h-7 w-7 text-sky-300" /><p className="mt-3 font-medium">No evidence scans yet</p><p className="mt-1 text-sm text-muted-foreground">Choose a customer and framework to collect the observable device, backup, and audit evidence available in NexusMSP.</p><Button className="mt-4" size="sm" onClick={openScan}>Run first evidence scan</Button></CardContent></Card> : <Card><CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Evidence scan history</CardTitle><p className="mt-1 text-sm text-muted-foreground">Inspect controls or generate a report from a recorded scan.</p></div><Badge variant="outline">{scans.length} scans</Badge></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Framework</TableHead><TableHead>Evidence</TableHead><TableHead>Pass rate</TableHead><TableHead>Captured</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{scans.map((scan) => <TableRow key={scan.id}><TableCell className="font-medium">{scan.client_name || "Client"}</TableCell><TableCell>{scan.framework_name || scan.framework}</TableCell><TableCell>{scan.evaluated || 0}/{scan.total || 0} controls</TableCell><TableCell><span className={`font-semibold ${scoreText(scan.score)}`}>{scoreLabel(scan.score)}</span></TableCell><TableCell className="text-xs text-muted-foreground">{readableDate(scan.scanned_at)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setSelectedScan(scan)}>Inspect</Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>}</TabsContent>
      <TabsContent value="reports" className="mt-5">{reports.length === 0 ? <Card><CardContent className="p-10 text-center"><FileCheck2 className="mx-auto h-7 w-7 text-violet-300" /><p className="mt-3 font-medium">No evidence reports generated</p><p className="mt-1 text-sm text-muted-foreground">Generate a report from a completed evidence scan. NexusMSP preserves that scan's control snapshot with the report.</p></CardContent></Card> : <Card><CardHeader><CardTitle className="text-base">Generated evidence reports</CardTitle><p className="mt-1 text-sm text-muted-foreground">Every report has a linked evidence scan rather than a calculated placeholder score.</p></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Customer</TableHead><TableHead>Evidence</TableHead><TableHead>Pass rate</TableHead><TableHead>Generated</TableHead><TableHead className="text-right">Source</TableHead></TableRow></TableHeader><TableBody>{reports.map((report) => <TableRow key={report.id}><TableCell><p className="font-medium">{report.title || `${report.framework} evidence report`}</p><p className="mt-1 text-[10px] text-muted-foreground">{report.controls_passed || 0}/{report.controls_evaluated || 0} evaluated controls passed</p></TableCell><TableCell>{report.client_name || "Client"}</TableCell><TableCell>{report.evidence_coverage_pct ?? 0}% coverage</TableCell><TableCell><span className={`font-semibold ${scoreText(report.score)}`}>{scoreLabel(report.score)}</span></TableCell><TableCell className="text-xs text-muted-foreground">{readableDate(report.generated_at)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => { const scan = scansById.get(report.scan_id); if (scan) { setSelectedScan(scan); selectTab("evidence"); } else toast.info("The source scan is outside the loaded history."); }}>Open evidence</Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>}</TabsContent>
      <TabsContent value="insurance" className="mt-5"><InsuranceEvidence clients={clients} clientId={insuranceClientId} onClientChange={setInsuranceClientId} evidence={insuranceEvidence} loading={insuranceLoading} onRefresh={() => loadInsuranceEvidence()} onDownload={downloadInsurancePack} downloading={insuranceDownloading} onStartScan={() => { setScanClientId(insuranceClientId); openScan(); }} /></TabsContent>
    </Tabs>
    <Dialog open={policyOpen} onOpenChange={setPolicyOpen}><DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto p-0" data-testid="compliance-policy-dialog"><DialogHeader className="border-b border-violet-500/20 bg-gradient-to-r from-violet-500/10 via-background to-background p-6"><DialogTitle className="flex items-center gap-2 text-xl"><BookOpenCheck className="h-5 w-5 text-violet-300" />{editingPolicyId ? "Edit governed policy" : "Create governed policy"}</DialogTitle><p className="mt-1 text-sm text-muted-foreground">Every material edit creates a new draft version and preserves the previously approved content.</p></DialogHeader><div className="space-y-5 p-6"><div className="grid gap-4 md:grid-cols-2">{!editingPolicyId && <div className="space-y-2 md:col-span-2"><Label htmlFor="policy-template">Nexus policy template</Label><Select value={policyForm.template_id || "none"} onValueChange={(value) => choosePolicyTemplate(value === "none" ? "" : value)}><SelectTrigger id="policy-template"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Blank policy</SelectItem>{policyTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select></div>}<div className="space-y-2"><Label htmlFor="policy-name">Policy name *</Label><Input id="policy-name" value={policyForm.name} onChange={(event) => setPolicyForm((current) => ({ ...current, name: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="policy-client">Scope</Label><Select value={policyForm.client_id || "msp"} onValueChange={(value) => setPolicyForm((current) => ({ ...current, client_id: value === "msp" ? "" : value }))}><SelectTrigger id="policy-client"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="msp">MSP-wide policy</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name || client.id}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="policy-owner">Policy owner</Label><Input id="policy-owner" value={policyForm.owner} onChange={(event) => setPolicyForm((current) => ({ ...current, owner: event.target.value }))} placeholder="Security or compliance owner" /></div><div className="space-y-2"><Label htmlFor="policy-approver">Required approver</Label><Input id="policy-approver" value={policyForm.approver} onChange={(event) => setPolicyForm((current) => ({ ...current, approver: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="policy-category">Category</Label><Input id="policy-category" value={policyForm.category} onChange={(event) => setPolicyForm((current) => ({ ...current, category: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="policy-review">Review cadence</Label><Select value={String(policyForm.review_frequency_months)} onValueChange={(value) => setPolicyForm((current) => ({ ...current, review_frequency_months: value }))}><SelectTrigger id="policy-review"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="3">Quarterly</SelectItem><SelectItem value="6">Every 6 months</SelectItem><SelectItem value="12">Annually</SelectItem><SelectItem value="24">Every 2 years</SelectItem></SelectContent></Select></div><div className="space-y-2 md:col-span-2"><Label htmlFor="policy-purpose">Purpose</Label><Textarea id="policy-purpose" rows={2} value={policyForm.purpose} onChange={(event) => setPolicyForm((current) => ({ ...current, purpose: event.target.value }))} /></div><div className="space-y-2 md:col-span-2"><div className="flex items-center justify-between"><Label htmlFor="policy-content">Policy content</Label><span className="text-xs text-muted-foreground">Markdown headings and lists supported</span></div><Textarea id="policy-content" rows={14} className="font-mono text-xs leading-relaxed" value={policyForm.content} onChange={(event) => setPolicyForm((current) => ({ ...current, content: event.target.value }))} placeholder={policyForm.template_id ? "Leave blank to generate the structured Nexus template, or enter tailored policy content." : "Write the policy purpose, scope, requirements, responsibilities, exceptions, evidence and review process."} /></div></div><div><div className="mb-2 flex items-center justify-between"><Label>Mapped frameworks</Label><span className="text-xs text-muted-foreground">{policyForm.framework_ids.length} selected</span></div><div className="flex flex-wrap gap-2">{frameworks.map((framework) => { const selected = policyForm.framework_ids.includes(framework.id); return <button type="button" key={framework.id} onClick={() => setPolicyForm((current) => ({ ...current, framework_ids: selected ? current.framework_ids.filter((id) => id !== framework.id) : [...current.framework_ids, framework.id] }))} className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${selected ? "border-violet-500/50 bg-violet-500/10 text-violet-100" : "border-border text-muted-foreground hover:border-foreground/30"}`} aria-pressed={selected}>{framework.name}</button>; })}</div></div><div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-muted-foreground"><AlertTriangle className="mr-1.5 inline h-4 w-4 text-amber-300" />A policy template is a starting point, not legal advice or proof of operating effectiveness. Approval and evidence remain separate records.</div></div><div className="flex justify-end gap-2 border-t border-border bg-muted/20 p-4"><Button variant="ghost" onClick={() => setPolicyOpen(false)}>Cancel</Button><Button onClick={savePolicy} disabled={savingPolicy || (!policyForm.template_id && policyForm.name.trim().length < 3)}>{savingPolicy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{editingPolicyId ? "Save new version" : "Create draft"}</Button></div></DialogContent></Dialog>
    <Dialog open={Boolean(approvalPolicy)} onOpenChange={(open) => { if (!open) setApprovalPolicy(null); }}><DialogContent className="max-w-xl p-0" data-testid="compliance-policy-approval-dialog"><DialogHeader className="border-b border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 via-background to-background p-6"><DialogTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-emerald-300" />Approve policy version</DialogTitle><p className="mt-1 text-sm text-muted-foreground">{approvalPolicy?.name} · version {approvalPolicy?.version || 1}</p></DialogHeader><div className="space-y-4 p-6"><div className="rounded-lg border border-border bg-muted/10 p-4 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Owner</span><span>{approvalPolicy?.owner || "Unassigned"}</span></div><div className="mt-2 flex justify-between"><span className="text-muted-foreground">Review cadence</span><span>{approvalPolicy?.review_frequency_months || 12} months</span></div></div><div className="space-y-2"><Label htmlFor="policy-approval-note">Approval rationale *</Label><Textarea id="policy-approval-note" rows={4} value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="Confirm the policy was reviewed, is appropriate for its scope, and record any conditions." /></div><p className="text-xs text-muted-foreground">Approval records the signed-in technician, timestamp, version and next review date in the audit ledger.</p></div><div className="flex justify-end gap-2 border-t border-border bg-muted/20 p-4"><Button variant="ghost" onClick={() => setApprovalPolicy(null)}>Cancel</Button><Button onClick={approvePolicy} disabled={approvalNote.trim().length < 5}>Approve policy</Button></div></DialogContent></Dialog>
    <Dialog open={issueOpen} onOpenChange={setIssueOpen}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto p-0" data-testid="compliance-issue-dialog"><DialogHeader className="border-b border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-background to-background p-6"><DialogTitle className="flex items-center gap-2 text-xl"><CircleAlert className="h-5 w-5 text-amber-300" />Record an assurance issue</DialogTitle><p className="mt-1 text-sm text-muted-foreground">Capture an audit finding, risk, evidence gap or customer commitment with ownership and a deadline.</p></DialogHeader><div className="space-y-5 p-6"><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="issue-customer">Customer *</Label><Select value={issueForm.client_id} onValueChange={(value) => setIssueForm((current) => ({ ...current, client_id: value, program_id: "" }))}><SelectTrigger id="issue-customer"><SelectValue placeholder="Choose customer" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name || client.id}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="issue-programme">Compliance programme</Label><Select value={issueForm.program_id || "none"} onValueChange={(value) => setIssueForm((current) => ({ ...current, program_id: value === "none" ? "" : value }))}><SelectTrigger id="issue-programme"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No specific programme</SelectItem>{programs.filter((program) => !issueForm.client_id || program.client_id === issueForm.client_id).map((program) => <SelectItem key={program.id} value={program.id}>{program.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2 md:col-span-2"><Label htmlFor="issue-title">Issue title *</Label><Input id="issue-title" value={issueForm.title} onChange={(event) => setIssueForm((current) => ({ ...current, title: event.target.value }))} placeholder="Example: Privileged accounts are not reviewed quarterly" /></div><div className="space-y-2"><Label htmlFor="issue-framework">Framework context</Label><Select value={issueForm.framework_id || "none"} onValueChange={(value) => setIssueForm((current) => ({ ...current, framework_id: value === "none" ? "" : value }))}><SelectTrigger id="issue-framework"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Internal assurance</SelectItem>{frameworks.map((framework) => <SelectItem key={framework.id} value={framework.id}>{framework.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="issue-severity">Severity</Label><Select value={issueForm.severity} onValueChange={(value) => setIssueForm((current) => ({ ...current, severity: value }))}><SelectTrigger id="issue-severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="issue-owner">Owner</Label><Input id="issue-owner" value={issueForm.owner} onChange={(event) => setIssueForm((current) => ({ ...current, owner: event.target.value }))} placeholder="Technician, security lead or account manager" /></div><div className="space-y-2"><Label htmlFor="issue-due">Target date</Label><Input id="issue-due" type="date" value={issueForm.due_date} onChange={(event) => setIssueForm((current) => ({ ...current, due_date: event.target.value }))} /></div><div className="space-y-2 md:col-span-2"><Label htmlFor="issue-description">Finding, impact and required outcome</Label><Textarea id="issue-description" rows={4} value={issueForm.description} onChange={(event) => setIssueForm((current) => ({ ...current, description: event.target.value }))} /></div></div><div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-xs text-muted-foreground"><History className="mr-1.5 inline h-4 w-4 text-sky-300" />Creation, assignment, evidence, resolution and risk acceptance are written to the Nexus audit ledger.</div></div><div className="flex justify-end gap-2 border-t border-border bg-muted/20 p-4"><Button variant="ghost" onClick={() => setIssueOpen(false)}>Cancel</Button><Button onClick={createIssue} disabled={savingIssue || !issueForm.client_id || issueForm.title.trim().length < 3}>{savingIssue && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Create issue</Button></div></DialogContent></Dialog>
    <Dialog open={Boolean(resolutionIssue)} onOpenChange={(open) => { if (!open) setResolutionIssue(null); }}><DialogContent className="max-w-xl p-0" data-testid="compliance-resolution-dialog"><DialogHeader className="border-b border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 via-background to-background p-6"><DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-300" />Complete assurance review</DialogTitle><p className="mt-1 text-sm text-muted-foreground">{resolutionIssue?.title}</p></DialogHeader><div className="space-y-4 p-6"><div className="space-y-2"><Label htmlFor="resolution-outcome">Outcome</Label><Select value={resolutionStatus} onValueChange={setResolutionStatus}><SelectTrigger id="resolution-outcome"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="resolved">Resolved and ready for verification</SelectItem><SelectItem value="accepted_risk">Risk accepted</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="resolution-note">Justification and evidence summary *</Label><Textarea id="resolution-note" rows={5} value={resolutionText} onChange={(event) => setResolutionText(event.target.value)} placeholder={resolutionStatus === "accepted_risk" ? "Record approver, business justification, compensating controls and review date." : "Describe the remediation performed and the evidence that confirms it."} /></div>{resolutionStatus === "accepted_risk" && <div className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-3 text-xs text-violet-100"><ShieldAlert className="mr-1 inline h-3.5 w-3.5" />Risk acceptance does not mark the underlying control as compliant. A future scan can reopen the issue.</div>}</div><div className="flex justify-end gap-2 border-t border-border bg-muted/20 p-4"><Button variant="ghost" onClick={() => setResolutionIssue(null)}>Cancel</Button><Button onClick={completeIssue} disabled={resolutionText.trim().length < 5}>Record outcome</Button></div></DialogContent></Dialog>
    <Dialog open={scanOpen} onOpenChange={setScanOpen}><DialogContent className="max-w-xl" data-testid="compliance-evidence-scan-dialog"><DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-sky-300" />Run client evidence scan</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">This evaluates observable NexusMSP evidence only. Missing integrations stay unassessed instead of being treated as a pass.</p><div><label className="text-sm font-medium">Customer</label><Select value={scanClientId} onValueChange={setScanClientId}><SelectTrigger className="mt-1"><SelectValue placeholder="Choose customer" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name || client.id}</SelectItem>)}</SelectContent></Select></div><div><label className="text-sm font-medium">Framework</label><Select value={scanFramework} onValueChange={setScanFramework}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{frameworks.map((framework) => <SelectItem key={framework.id} value={framework.id}>{framework.name} ({framework.controls} controls)</SelectItem>)}</SelectContent></Select></div><div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs text-amber-100"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />This is an evidence check, not a compliance certification. Review the captured control evidence before issuing client commitments.</div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setScanOpen(false)} disabled={scanning}>Cancel</Button><Button onClick={runScan} disabled={scanning || !scanClientId}>{scanning && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Run evidence scan</Button></div></div></DialogContent></Dialog>
    <Dialog open={programOpen} onOpenChange={setProgramOpen}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto p-0" data-testid="compliance-program-dialog"><DialogHeader className="border-b border-violet-500/20 bg-gradient-to-r from-violet-500/10 via-background to-background p-6"><DialogTitle className="flex items-center gap-2 text-xl"><Target className="h-5 w-5 text-violet-300" />Create customer compliance programme</DialogTitle><p className="mt-1 text-sm text-muted-foreground">Define the customer, frameworks, accountable owner, scope and target. Evidence remains separate from certification claims.</p></DialogHeader><div className="space-y-5 p-6"><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="programme-customer">Customer *</Label><Select value={programForm.client_id} onValueChange={(value) => setProgramForm((current) => ({ ...current, client_id: value }))}><SelectTrigger id="programme-customer" aria-label="Programme customer"><SelectValue placeholder="Choose customer" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name || client.id}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="programme-name">Programme name</Label><Input id="programme-name" value={programForm.name} onChange={(event) => setProgramForm((current) => ({ ...current, name: event.target.value }))} placeholder="2026 cyber assurance programme" /></div><div className="space-y-2"><Label htmlFor="programme-owner">Accountable owner</Label><Input id="programme-owner" value={programForm.owner} onChange={(event) => setProgramForm((current) => ({ ...current, owner: event.target.value }))} placeholder="Security lead or account manager" /></div><div className="space-y-2"><Label htmlFor="programme-target">Target date</Label><Input id="programme-target" type="date" value={programForm.target_date} onChange={(event) => setProgramForm((current) => ({ ...current, target_date: event.target.value }))} /></div></div><div className="space-y-2"><Label htmlFor="programme-scope">Scope</Label><Textarea id="programme-scope" rows={3} value={programForm.scope} onChange={(event) => setProgramForm((current) => ({ ...current, scope: event.target.value }))} /></div><div><div className="mb-2 flex items-center justify-between"><Label>Frameworks *</Label><span className="text-xs text-muted-foreground">{programForm.framework_ids.length} selected</span></div><div className="grid max-h-64 gap-2 overflow-y-auto rounded-xl border border-border p-3 md:grid-cols-2">{frameworks.map((framework) => { const selected = programForm.framework_ids.includes(framework.id); return <button type="button" key={framework.id} onClick={() => toggleProgramFramework(framework.id)} className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${selected ? "border-violet-500/50 bg-violet-500/10" : "border-border bg-muted/10 hover:border-foreground/20"}`} aria-pressed={selected}><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${selected ? "border-violet-400 bg-violet-500 text-white" : "border-border"}`}>{selected ? "✓" : ""}</span><span><span className="block text-sm font-medium">{framework.name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{framework.region} · {framework.controls} controls</span></span></button>; })}</div></div><div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs text-muted-foreground"><CheckCircle2 className="mr-1.5 inline h-4 w-4 text-emerald-300" />Controls and evidence may be reused across selected frameworks, reducing duplicated work while keeping each requirement traceable.</div></div><div className="flex justify-end gap-2 border-t border-border bg-muted/20 p-4"><Button variant="ghost" onClick={() => setProgramOpen(false)}>Cancel</Button><Button onClick={createProgram} disabled={savingProgram || !programForm.client_id || !programForm.framework_ids.length}>{savingProgram && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Create programme</Button></div></DialogContent></Dialog>
    <Dialog open={builderOpen} onOpenChange={setBuilderOpen}><DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto p-0" data-testid="compliance-framework-builder"><DialogHeader className="border-b border-sky-500/20 bg-gradient-to-r from-sky-500/10 via-background to-background p-6"><DialogTitle className="flex items-center gap-2 text-xl"><WandSparkles className="h-5 w-5 text-sky-300" />Framework and control builder</DialogTitle><p className="mt-1 text-sm text-muted-foreground">Build any regulatory, contractual, insurer or internal standard and connect its controls to continuous Nexus evidence.</p></DialogHeader><div className="space-y-6 p-6">{!builderFrameworkId ? <><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2 md:col-span-2"><Label htmlFor="framework-name">Framework name *</Label><Input id="framework-name" value={frameworkForm.name} onChange={(event) => setFrameworkForm((current) => ({ ...current, name: event.target.value }))} placeholder="Example: Acme supplier security standard" /></div><div className="space-y-2"><Label htmlFor="framework-category">Category</Label><Input id="framework-category" value={frameworkForm.category} onChange={(event) => setFrameworkForm((current) => ({ ...current, category: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="framework-region">Region or applicability</Label><Input id="framework-region" value={frameworkForm.region} onChange={(event) => setFrameworkForm((current) => ({ ...current, region: event.target.value }))} /></div><div className="space-y-2 md:col-span-2"><Label htmlFor="framework-authority">Authority or source</Label><Input id="framework-authority" value={frameworkForm.authority} onChange={(event) => setFrameworkForm((current) => ({ ...current, authority: event.target.value }))} /></div><div className="space-y-2 md:col-span-2"><Label htmlFor="framework-description">Purpose and applicability</Label><Textarea id="framework-description" rows={4} value={frameworkForm.description} onChange={(event) => setFrameworkForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe who this applies to, what assurance it provides and any exclusions." /></div></div><div className="flex items-center justify-between rounded-xl border border-border bg-muted/10 p-4"><div><p className="text-sm font-medium">Continue an existing custom framework</p><p className="mt-1 text-xs text-muted-foreground">Add controls or expand its evidence mapping.</p></div><Select value={builderFrameworkId} onValueChange={setBuilderFrameworkId}><SelectTrigger className="w-64" aria-label="Existing custom framework"><SelectValue placeholder="Choose framework" /></SelectTrigger><SelectContent>{customFrameworks.map((framework) => <SelectItem key={framework.id} value={framework.id}>{framework.name}</SelectItem>)}</SelectContent></Select></div></> : <><div className="flex items-start justify-between gap-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4"><div><p className="font-semibold">{selectedCustomFramework?.name || "Custom framework"}</p><p className="mt-1 text-xs text-muted-foreground">Version {selectedCustomFramework?.version || 1} · {(selectedCustomFramework?.controls || []).length} controls · every change remains versioned</p></div><Button variant="ghost" size="sm" onClick={() => setBuilderFrameworkId("")}>Create another</Button></div><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="control-reference">Control reference</Label><Input id="control-reference" value={controlForm.reference} onChange={(event) => setControlForm((current) => ({ ...current, reference: event.target.value }))} placeholder="AC-01" /></div><div className="space-y-2"><Label htmlFor="control-name">Control name *</Label><Input id="control-name" value={controlForm.name} onChange={(event) => setControlForm((current) => ({ ...current, name: event.target.value }))} placeholder="Privileged access is reviewed quarterly" /></div><div className="space-y-2 md:col-span-2"><Label htmlFor="control-description">Requirement</Label><Textarea id="control-description" rows={3} value={controlForm.description} onChange={(event) => setControlForm((current) => ({ ...current, description: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="control-evidence">Nexus evidence source</Label><Select value={controlForm.check} onValueChange={(value) => setControlForm((current) => ({ ...current, check: value }))}><SelectTrigger id="control-evidence" aria-label="Nexus evidence source"><SelectValue /></SelectTrigger><SelectContent>{evidenceChecks.map((check) => <SelectItem key={check.id} value={check.id}>{check.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="control-frequency">Review frequency</Label><Select value={controlForm.frequency} onValueChange={(value) => setControlForm((current) => ({ ...current, frequency: value }))}><SelectTrigger id="control-frequency" aria-label="Review frequency"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="continuous">Continuous</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="annually">Annually</SelectItem><SelectItem value="event_driven">Event-driven</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="control-owner">Default owner role</Label><Input id="control-owner" value={controlForm.owner_role} onChange={(event) => setControlForm((current) => ({ ...current, owner_role: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="control-guidance">Evidence guidance</Label><Input id="control-guidance" value={controlForm.evidence_guidance} onChange={(event) => setControlForm((current) => ({ ...current, evidence_guidance: event.target.value }))} placeholder="What an auditor should expect to see" /></div></div>{(selectedCustomFramework?.controls || []).length > 0 && <div className="rounded-xl border border-border"><div className="border-b border-border px-4 py-3 text-sm font-medium">Current controls</div><div className="divide-y divide-border">{selectedCustomFramework.controls.map((control) => <div key={`${control.id}-${control.name}`} className="flex items-start justify-between gap-3 px-4 py-3"><div><p className="text-sm font-medium">{control.id} · {control.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{evidenceChecks.find((item) => item.id === control.check)?.name || control.check}</p></div><Badge variant="outline">{control.frequency}</Badge></div>)}</div></div>}</>}</div><div className="flex justify-end gap-2 border-t border-border bg-muted/20 p-4"><Button variant="ghost" onClick={() => setBuilderOpen(false)}>Close</Button>{!builderFrameworkId ? <Button onClick={createCustomFramework} disabled={savingFramework || frameworkForm.name.trim().length < 3}>{savingFramework && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Create framework</Button> : <Button onClick={addCustomControl} disabled={savingControl || controlForm.name.trim().length < 3}>{savingControl && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Add control</Button>}</div></DialogContent></Dialog>
  </div>;
}
