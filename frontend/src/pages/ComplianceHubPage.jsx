import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, FileCheck2, FileText, History, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const TABS = ["overview", "evidence", "reports", "insurance"];
const legacyTabs = { dashboard: "overview", clients: "evidence" };
const EMPTY = { frameworks: [], summary: { total_frameworks: 0, evidence_scans: 0, clients_assessed: 0, avg_compliance_pct: null } };
const isScore = (value) => Number.isFinite(value);
const scoreLabel = (value) => isScore(value) ? `${value}%` : "Not assessed";
const scoreTone = (value) => !isScore(value) ? "zinc" : value >= 85 ? "emerald" : value >= 60 ? "amber" : "rose";
const scoreText = (value) => !isScore(value) ? "text-muted-foreground" : value >= 85 ? "text-emerald-300" : value >= 60 ? "text-amber-300" : "text-rose-300";
const scoreBadge = (value) => !isScore(value) ? "border-slate-500/30 text-slate-200" : value >= 85 ? "border-emerald-500/30 text-emerald-200" : value >= 60 ? "border-amber-500/30 text-amber-200" : "border-rose-500/30 text-rose-200";
const readableDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toLocaleString() : "Not recorded";
};

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

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [overviewResult, clientsResult, frameworksResult, scansResult, reportsResult] = await Promise.all([
        axios.get(`${API}/compliance-frameworks/overview`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/compliance/frameworks`, { headers }),
        axios.get(`${API}/compliance/reports`, { headers }),
        axios.get(`${API}/compliance-generator/reports`, { headers }),
      ]);
      setOverview(overviewResult.data || EMPTY);
      setClients(clientsResult.data || []);
      setFrameworks(frameworksResult.data || []);
      setScans(scansResult.data || []);
      setReports(reportsResult.data || []);
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

  const summary = overview.summary || EMPTY.summary;
  const frameworkCards = overview.frameworks || [];
  const scansById = useMemo(() => new Map(scans.map((scan) => [scan.id, scan])), [scans]);

  return <div className="space-y-5" data-testid="compliance-hub">
    <OperationalPageHeader eyebrow="Security workspace - evidence and assurance" title="Compliance" description="Capture observable evidence, preserve assessment gaps, and build audit-ready client reports from the exact evidence scan behind them." icon={ShieldCheck} tone="emerald" actions={<><Button variant="outline" size="sm" onClick={() => navigate("/audit-trail")}><History className="mr-1 h-4 w-4" />Audit trail</Button><Button variant="outline" size="sm" onClick={() => load()} disabled={loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button><Button size="sm" onClick={openScan}><ClipboardCheck className="mr-1 h-4 w-4" />Run evidence scan</Button></>} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><HeroTile label="Frameworks" value={summary.total_frameworks || 0} icon={ShieldCheck} glow="sky" subtitle="Available evidence checks" onClick={() => selectTab("overview")} active={tab === "overview"} /><HeroTile label="Evidence scans" value={summary.evidence_scans || 0} icon={ClipboardCheck} glow={summary.evidence_scans ? "emerald" : "zinc"} subtitle={`${summary.clients_assessed || 0} customers assessed`} onClick={() => selectTab("evidence")} active={tab === "evidence"} /><HeroTile label="Verified pass rate" value={scoreLabel(summary.avg_compliance_pct)} icon={CheckCircle2} glow={scoreTone(summary.avg_compliance_pct)} subtitle={isScore(summary.avg_compliance_pct) ? "Latest evidence per customer" : "No controls assessed"} onClick={() => selectTab("evidence")} /><HeroTile label="Reports generated" value={reports.length} icon={FileText} glow={reports.length ? "violet" : "zinc"} subtitle="Evidence-backed only" onClick={() => selectTab("reports")} active={tab === "reports"} /></div>
    <Tabs value={tab} onValueChange={selectTab}><TabsList className="grid w-full grid-cols-4 sm:w-[620px]"><TabsTrigger value="overview">Frameworks</TabsTrigger><TabsTrigger value="evidence">Evidence scans</TabsTrigger><TabsTrigger value="reports">Reports</TabsTrigger><TabsTrigger value="insurance">Insurance pack</TabsTrigger></TabsList>
      <TabsContent value="overview" className="mt-5"><div className="grid gap-3 xl:grid-cols-2">{frameworkCards.map((framework) => <Card key={framework.id} className="border-border/80"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{framework.name}</p><p className="mt-1 text-sm text-muted-foreground">{framework.clients_assessed || 0} customer{framework.clients_assessed === 1 ? "" : "s"} with current evidence</p></div><Badge variant="outline" className={framework.evidence_state === "evidence_available" ? "border-emerald-500/30 text-emerald-200" : "border-slate-500/30 text-slate-200"}>{framework.evidence_state === "evidence_available" ? "Evidence available" : "Not assessed"}</Badge></div><div className="mt-4 grid grid-cols-3 gap-2 text-xs"><MetricCard label="Pass rate" value={scoreLabel(framework.compliance_pct)} detail="Observed controls" tone={scoreText(framework.compliance_pct)} /><MetricCard label="Coverage" value={`${framework.evidence_coverage_pct ?? 0}%`} detail="Available evidence" /><MetricCard label="Controls" value={framework.total_controls || 0} detail="Framework controls" /></div>{isScore(framework.compliance_pct) ? <Progress value={framework.compliance_pct} className="mt-3 h-2" /> : <div className="mt-3 h-2 rounded-full bg-muted/40" />}<div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>Last evidence: {readableDate(framework.latest_assessed_at)}</span><Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={openScan}>Run check</Button></div></CardContent></Card>)}</div></TabsContent>
      <TabsContent value="evidence" className="mt-5 space-y-4">{selectedScan && <EvidenceScan scan={selectedScan} onGenerate={generateReport} generating={generatingId === selectedScan.id} />}{scans.length === 0 ? <Card><CardContent className="p-10 text-center"><ClipboardCheck className="mx-auto h-7 w-7 text-sky-300" /><p className="mt-3 font-medium">No evidence scans yet</p><p className="mt-1 text-sm text-muted-foreground">Choose a customer and framework to collect the observable device, backup, and audit evidence available in NexusMSP.</p><Button className="mt-4" size="sm" onClick={openScan}>Run first evidence scan</Button></CardContent></Card> : <Card><CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Evidence scan history</CardTitle><p className="mt-1 text-sm text-muted-foreground">Inspect controls or generate a report from a recorded scan.</p></div><Badge variant="outline">{scans.length} scans</Badge></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Framework</TableHead><TableHead>Evidence</TableHead><TableHead>Pass rate</TableHead><TableHead>Captured</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{scans.map((scan) => <TableRow key={scan.id}><TableCell className="font-medium">{scan.client_name || "Client"}</TableCell><TableCell>{scan.framework_name || scan.framework}</TableCell><TableCell>{scan.evaluated || 0}/{scan.total || 0} controls</TableCell><TableCell><span className={`font-semibold ${scoreText(scan.score)}`}>{scoreLabel(scan.score)}</span></TableCell><TableCell className="text-xs text-muted-foreground">{readableDate(scan.scanned_at)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setSelectedScan(scan)}>Inspect</Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>}</TabsContent>
      <TabsContent value="reports" className="mt-5">{reports.length === 0 ? <Card><CardContent className="p-10 text-center"><FileCheck2 className="mx-auto h-7 w-7 text-violet-300" /><p className="mt-3 font-medium">No evidence reports generated</p><p className="mt-1 text-sm text-muted-foreground">Generate a report from a completed evidence scan. NexusMSP preserves that scan's control snapshot with the report.</p></CardContent></Card> : <Card><CardHeader><CardTitle className="text-base">Generated evidence reports</CardTitle><p className="mt-1 text-sm text-muted-foreground">Every report has a linked evidence scan rather than a calculated placeholder score.</p></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Customer</TableHead><TableHead>Evidence</TableHead><TableHead>Pass rate</TableHead><TableHead>Generated</TableHead><TableHead className="text-right">Source</TableHead></TableRow></TableHeader><TableBody>{reports.map((report) => <TableRow key={report.id}><TableCell><p className="font-medium">{report.title || `${report.framework} evidence report`}</p><p className="mt-1 text-[10px] text-muted-foreground">{report.controls_passed || 0}/{report.controls_evaluated || 0} evaluated controls passed</p></TableCell><TableCell>{report.client_name || "Client"}</TableCell><TableCell>{report.evidence_coverage_pct ?? 0}% coverage</TableCell><TableCell><span className={`font-semibold ${scoreText(report.score)}`}>{scoreLabel(report.score)}</span></TableCell><TableCell className="text-xs text-muted-foreground">{readableDate(report.generated_at)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => { const scan = scansById.get(report.scan_id); if (scan) { setSelectedScan(scan); selectTab("evidence"); } else toast.info("The source scan is outside the loaded history."); }}>Open evidence</Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>}</TabsContent>
      <TabsContent value="insurance" className="mt-5"><InsuranceEvidence clients={clients} clientId={insuranceClientId} onClientChange={setInsuranceClientId} evidence={insuranceEvidence} loading={insuranceLoading} onRefresh={() => loadInsuranceEvidence()} onDownload={downloadInsurancePack} downloading={insuranceDownloading} onStartScan={() => { setScanClientId(insuranceClientId); openScan(); }} /></TabsContent>
    </Tabs>
    <Dialog open={scanOpen} onOpenChange={setScanOpen}><DialogContent className="max-w-xl" data-testid="compliance-evidence-scan-dialog"><DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-sky-300" />Run client evidence scan</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">This evaluates observable NexusMSP evidence only. Missing integrations stay unassessed instead of being treated as a pass.</p><div><label className="text-sm font-medium">Customer</label><Select value={scanClientId} onValueChange={setScanClientId}><SelectTrigger className="mt-1"><SelectValue placeholder="Choose customer" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name || client.id}</SelectItem>)}</SelectContent></Select></div><div><label className="text-sm font-medium">Framework</label><Select value={scanFramework} onValueChange={setScanFramework}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{frameworks.map((framework) => <SelectItem key={framework.id} value={framework.id}>{framework.name} ({framework.controls} controls)</SelectItem>)}</SelectContent></Select></div><div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs text-amber-100"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />This is an evidence check, not a compliance certification. Review the captured control evidence before issuing client commitments.</div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setScanOpen(false)} disabled={scanning}>Cancel</Button><Button onClick={runScan} disabled={scanning || !scanClientId}>{scanning && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Run evidence scan</Button></div></div></DialogContent></Dialog>
  </div>;
}
