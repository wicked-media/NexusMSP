import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Shield, ShieldCheck, ShieldX, AlertTriangle, CheckCircle, XCircle,
  Search, Loader2, RefreshCw, ExternalLink, TrendingUp, Users, Eye, ClipboardList
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const scoreColor = (score) => {
  if (score >= 80) return { text: "text-emerald-400", bg: "bg-emerald-500", ring: "ring-emerald-500/30" };
  if (score >= 50) return { text: "text-amber-400", bg: "bg-amber-500", ring: "ring-amber-500/30" };
  return { text: "text-red-400", bg: "bg-red-500", ring: "ring-red-500/30" };
};

const scoreLabel = (score) => {
  if (score >= 90) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  if (score >= 20) return "Poor";
  return "Critical";
};

export default function DmarcCompliancePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [nexusDmarc, setNexusDmarc] = useState(null);
  const [dmarcSettings, setDmarcSettings] = useState({});
  const [receiverReadiness, setReceiverReadiness] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState([]);
  const [domainDialogOpen, setDomainDialogOpen] = useState(false);
  const [domainClientId, setDomainClientId] = useState("");
  const [domainValue, setDomainValue] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);
  const [policyDomain, setPolicyDomain] = useState(null);
  const [policyValue, setPolicyValue] = useState("none");
  const [policyNote, setPolicyNote] = useState("");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [receiverDialogOpen, setReceiverDialogOpen] = useState(false);
  const [receiverDomain, setReceiverDomain] = useState("");
  const [savingReceiver, setSavingReceiver] = useState(false);
  const [spfDomain, setSpfDomain] = useState(null);
  const [spfRecord, setSpfRecord] = useState("");
  const [spfSenders, setSpfSenders] = useState("");
  const [assessingSpf, setAssessingSpf] = useState(false);
  const [flattenPreview, setFlattenPreview] = useState(null);
  const [previewingDomain, setPreviewingDomain] = useState("");

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [res, nexusRes, clientsRes, settingsRes, readinessRes] = await Promise.all([
        axios.get(`${API}/suped/compliance-dashboard`, { headers }),
        axios.get(`${API}/nexus-dmarc/overview`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/nexus-dmarc/settings`, { headers }),
        axios.get(`${API}/nexus-dmarc/receiver/readiness`, { headers }),
      ]);
      setData(res.data);
      setNexusDmarc(nexusRes.data);
      setClients(clientsRes.data?.clients || clientsRes.data || []);
      setDmarcSettings(settingsRes.data || {});
      setReceiverReadiness(readinessRes.data || {});
    } catch { toast.error("Failed to load compliance data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const registerDomain = async () => {
    const client = clients.find((item) => item.id === domainClientId);
    if (!client || !domainValue.trim()) { toast.error("Choose a client and enter a valid domain"); return; }
    setSavingDomain(true);
    try {
      const response = await axios.post(`${API}/nexus-dmarc/domains`, { client_id: client.id, client_name: client.name || client.client_name, domain: domainValue.trim() }, { headers });
      toast.success(response.data?.message || "Nexus DMARC domain registered");
      setDomainDialogOpen(false); setDomainValue(""); setDomainClientId(""); fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Domain could not be registered"); }
    finally { setSavingDomain(false); }
  };
  const openPolicy = async (domain) => {
    setPolicyDomain(domain); setPolicyValue(domain.policy || "none"); setPolicyNote("");
    try { await axios.get(`${API}/nexus-dmarc/domains/${domain.id}/posture-discovery`, { headers }); fetchData(); }
    catch (error) { toast.error(error.response?.data?.detail || "Live DNS posture could not be refreshed"); }
  };
  const openReceiverSetup = () => { setReceiverDomain(dmarcSettings.receiver_domain || ""); setReceiverDialogOpen(true); };
  const saveReceiver = async () => {
    if (!receiverDomain.trim()) { toast.error("Enter the hostname Nexus should receive aggregate reports on"); return; }
    setSavingReceiver(true);
    try { const response = await axios.put(`${API}/nexus-dmarc/settings`, { receiver_domain: receiverDomain.trim() }, { headers }); setDmarcSettings(response.data?.settings || {}); setReceiverDialogOpen(false); toast.success(response.data?.message || "Nexus report receiver configured"); }
    catch (error) { toast.error(error.response?.data?.detail || "Report receiver could not be configured"); }
    finally { setSavingReceiver(false); }
  };
  const openSpfAssessment = async (domain) => {
    setSpfDomain(domain); setSpfRecord(""); setSpfSenders("");
    try {
      const [senderResponse, discoveryResponse] = await Promise.all([
        axios.get(`${API}/nexus-dmarc/domains/${domain.id}/sender-candidates`, { headers }),
        axios.get(`${API}/nexus-dmarc/domains/${domain.id}/spf-discovery`, { headers }),
      ]);
      setSpfRecord(discoveryResponse.data?.spf_record || "");
      const candidates = senderResponse.data?.candidates || [];
      if (candidates.length) setSpfSenders(candidates.map((candidate) => `ip4:${candidate.source_ip} · observed for ${candidate.header_from} (${candidate.message_count} messages)`).join("\n"));
    } catch { /* Public DNS or sender discovery can be unavailable; manual entry remains available. */ }
  };
  const assessSpf = async () => {
    if (!spfDomain || !spfRecord.trim()) { toast.error("Paste the live SPF TXT record before assessing it"); return; }
    setAssessingSpf(true);
    try { const response = await axios.post(`${API}/nexus-dmarc/domains/${spfDomain.id}/spf-assessment`, { spf_record: spfRecord.trim(), sender_candidates: spfSenders.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) }, { headers }); const assessment = response.data?.assessment; const planResponse = await axios.post(`${API}/nexus-dmarc/domains/${spfDomain.id}/spf-change-plan`, {}, { headers }); const plan = planResponse.data?.plan; const changeResponse = plan?.id ? await axios.post(`${API}/nexus-dmarc/spf-change-plans/${plan.id}/change-request`, {}, { headers }) : null; const change = changeResponse?.data?.change_request; toast.success(assessment ? `SPF assessed (${assessment.lookup_budget} lookups) · ${change?.id || "change request"} submitted for review` : "SPF assessment and review request recorded"); setSpfDomain(null); fetchData(); }
    catch (error) { toast.error(error.response?.data?.detail || "SPF record could not be assessed"); }
    finally { setAssessingSpf(false); }
  };
  const createFlattenPreview = async (domain) => {
    setPreviewingDomain(domain.id); setFlattenPreview(null);
    try { const response = await axios.get(`${API}/nexus-dmarc/domains/${domain.id}/spf-flatten-preview`, { headers }); setFlattenPreview(response.data || null); }
    catch (error) { toast.error(error.response?.data?.detail || "Nexus could not create a safe flattening preview"); }
    finally { setPreviewingDomain(""); }
  };
  const savePolicy = async () => {
    if (!policyDomain || !policyNote.trim()) { toast.error("Record the review and approval note before changing policy intent"); return; }
    setSavingPolicy(true);
    try { const response = await axios.patch(`${API}/nexus-dmarc/domains/${policyDomain.id}`, { policy: policyValue, note: policyNote.trim() }, { headers }); toast.success(response.data?.message || "Nexus DMARC policy intent saved"); setPolicyDomain(null); fetchData(); }
    catch (error) { toast.error(error.response?.data?.detail || "Policy intent could not be saved"); }
    finally { setSavingPolicy(false); }
  };

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const filteredClients = (data.client_details || []).filter(c =>
    !search || c.client_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6" data-testid="dmarc-compliance-page">
      <OperationalPageHeader
        eyebrow="Network workspace · email security"
        title="Email security compliance"
        description="DMARC, SPF, MTA-STS and blocklist posture across every client, with direct paths to the affected account."
        icon={Shield}
        tone="sky"
        actions={(
          <>
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/settings?tab=integrations&anchor=suped-settings-card")}><ExternalLink className="w-4 h-4 mr-1" />Suped Settings</Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroTile label="Compliance score" value={data.overall_score ?? 0} suffix="%" icon={Shield} glow={data.overall_score >= 80 ? "emerald" : data.overall_score >= 50 ? "amber" : "rose"} subtitle={`${scoreLabel(data.overall_score)} · ${data.total_clients || 0} clients`} testId="overall-score-card" />
        <HeroTile label="Fully protected" value={data.fully_protected ?? 0} icon={ShieldCheck} glow="emerald" subtitle="All monitored services active" testId="fully-protected-card" />
        <HeroTile label="Partially protected" value={data.partially_protected ?? 0} icon={AlertTriangle} glow="amber" subtitle="One or more controls missing" testId="partial-card" />
        <HeroTile label="Unprotected" value={data.unprotected ?? 0} icon={ShieldX} glow={(data.unprotected ?? 0) > 0 ? "rose" : "zinc"} subtitle="Requires a protection plan" testId="unprotected-card" />
      </div>

      <Card className="border-cyan-400/20 bg-cyan-500/[0.025]" data-testid="nexus-dmarc-control-plane">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm text-cyan-700 dark:text-cyan-100"><ShieldCheck className="h-4 w-4" />Nexus DMARC control plane</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Nexus-owned domain posture and aggregate-report evidence. Suped remains an optional upstream source during migration.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(nexusDmarc?.summary?.unauthorized || 0) > 0 && <Button size="sm" variant="outline" className="border-rose-500/30 text-rose-700 hover:bg-rose-500/[0.08] dark:text-rose-200" onClick={() => navigate("/nexus-shield?tab=xdr")}><ShieldX className="mr-1.5 h-3.5 w-3.5" />Investigate in Shield XDR</Button>}
              <Button size="sm" variant="outline" onClick={openReceiverSetup}>{dmarcSettings.configured ? "Report receiver configured" : "Configure report receiver"}</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-border/70 bg-background/55 p-3"><p className="text-xs text-muted-foreground">Registered domains</p><p className="mt-1 text-2xl font-semibold">{nexusDmarc?.summary?.domains || 0}</p></div>
            <div className="rounded-xl border border-border/70 bg-background/55 p-3"><p className="text-xs text-muted-foreground">Policy enforced</p><p className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-300">{nexusDmarc?.summary?.enforced || 0}</p></div>
            <div className="rounded-xl border border-border/70 bg-background/55 p-3"><p className="text-xs text-muted-foreground">Needs attention</p><p className="mt-1 text-2xl font-semibold text-amber-600 dark:text-amber-300">{nexusDmarc?.summary?.attention || 0}</p></div>
            <div className="rounded-xl border border-border/70 bg-background/55 p-3"><p className="text-xs text-muted-foreground">Unauthorised mail</p><p className="mt-1 text-2xl font-semibold text-rose-600 dark:text-rose-300">{nexusDmarc?.summary?.unauthorized || 0}</p></div>
          </div>
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-cyan-400/15 bg-cyan-500/[0.035] p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>{dmarcSettings.configured ? `Aggregate reports route through ${dmarcSettings.receiver_domain}. ${receiverReadiness.state === "ready_for_edge" ? "Receiver edge identity is ready." : receiverReadiness.next_step || "Receiver identity still needs configuration."}` : "Configure the owned Nexus report-receiver hostname before registering a domain."}</span><Button size="sm" variant="outline" onClick={() => dmarcSettings.configured ? setDomainDialogOpen(true) : openReceiverSetup()}>{dmarcSettings.configured ? "Register client domain" : "Configure receiver"}</Button></div>
        </CardContent>
      </Card>

      <Card className="border-emerald-500/15 bg-emerald-500/[0.02]" data-testid="nexus-dmarc-setup-guide">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />Nexus DMARC deployment guide</CardTitle><p className="mt-1 text-xs text-muted-foreground">A staged, evidence-first route to enforcement. Do not jump to reject before real sender evidence has been reviewed.</p></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{[
          ["1", "Receiver", "Configure an owned Nexus RUA receiver hostname."],
          ["2", "Register", "Register each client sending domain and copy its unique RUA address."],
          ["3", "Observe", "Publish through an approved DNS change; wait for aggregate evidence."],
          ["4", "Inventory", "Review discovered senders and assess SPF lookup pressure."],
          ["5", "Enforce", "Use an approved change plan, validate mail flow, then stage quarantine or reject."],
        ].map(([step, title, detail]) => <div key={step} className="rounded-xl border border-emerald-500/15 bg-background/55 p-3"><div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-700 dark:text-emerald-200">{step}</span><p className="font-medium text-sm">{title}</p></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></div>)}</CardContent>
      </Card>

      <Card className="border-cyan-400/15" data-testid="nexus-dmarc-domain-register">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />Nexus domain operations</CardTitle><p className="mt-1 text-xs text-muted-foreground">Posture is evidence-led. A staged policy here is an auditable deployment intent, not a DNS change.</p></CardHeader>
        <CardContent className="p-0">
          {(nexusDmarc?.domains || []).length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">No Nexus DMARC domains registered yet. Add a client domain above to begin a controlled migration from Suped.</div> : <Table><TableHeader><TableRow><TableHead>Domain</TableHead><TableHead>DMARC</TableHead><TableHead>SPF</TableHead><TableHead>DKIM</TableHead><TableHead>Policy intent</TableHead><TableHead>RUA receiver</TableHead><TableHead>Last evidence</TableHead></TableRow></TableHeader><TableBody>{nexusDmarc.domains.map((domain) => <TableRow key={domain.id} className="cursor-pointer hover:bg-cyan-500/[0.035]" onClick={() => openPolicy(domain)}><TableCell><p className="font-medium">{domain.domain}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{domain.client_name || domain.client_id}</p></TableCell>{[domain.dmarc_status, domain.spf_status, domain.dkim_status].map((value, index) => <TableCell key={`${domain.id}-${index}`}><Badge variant="outline" className={value === "pass" ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-200" : value === "fail" ? "border-rose-500/30 text-rose-700 dark:text-rose-200" : "text-muted-foreground"}>{value || "unknown"}</Badge></TableCell>)}<TableCell><Badge variant="outline" className={domain.policy === "reject" ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-200" : domain.policy === "quarantine" ? "border-amber-500/30 text-amber-700 dark:text-amber-200" : "text-muted-foreground"}>{domain.policy || "none"}</Badge></TableCell><TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground" title={domain.rua_address}>{domain.rua_address}</TableCell><TableCell className="text-xs text-muted-foreground">{domain.last_report_at ? new Date(domain.last_report_at).toLocaleString() : "Awaiting evidence"}</TableCell></TableRow>)}</TableBody></Table>}
        </CardContent>
      </Card>

      <Card className="border-violet-500/15" data-testid="nexus-dmarc-evidence">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><TrendingUp className="h-4 w-4 text-violet-600 dark:text-violet-300" />Aggregate report evidence</CardTitle><p className="mt-1 text-xs text-muted-foreground">Normalised RUA evidence from the Nexus receiver. A report is evidence, not an automatic DNS or mailbox action.</p></CardHeader>
        <CardContent className="p-0">{(nexusDmarc?.reports || []).length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">No aggregate evidence received yet. Register a domain, publish its approved RUA address and allow reporting time.</div> : <Table><TableHeader><TableRow><TableHead>Domain</TableHead><TableHead>Reporter</TableHead><TableHead>Messages</TableHead><TableHead>Aligned</TableHead><TableHead>Unauthorised</TableHead><TableHead>SPF / DKIM / DMARC</TableHead><TableHead>Received</TableHead></TableRow></TableHeader><TableBody>{nexusDmarc.reports.map((report) => <TableRow key={report.id}><TableCell className="font-medium">{report.domain}</TableCell><TableCell className="text-sm text-muted-foreground">{report.reporter || report.source}</TableCell><TableCell>{report.message_count || 0}</TableCell><TableCell className="text-emerald-700 dark:text-emerald-200">{report.aligned_count || 0}</TableCell><TableCell className={report.unauthorized_count ? "font-medium text-rose-700 dark:text-rose-200" : "text-muted-foreground"}>{report.unauthorized_count || 0}</TableCell><TableCell className="text-xs"><span className={report.spf_status === "pass" ? "text-emerald-700 dark:text-emerald-200" : "text-rose-700 dark:text-rose-200"}>SPF {report.spf_status}</span><span className="mx-1 text-muted-foreground">/</span><span className={report.dkim_status === "pass" ? "text-emerald-700 dark:text-emerald-200" : "text-rose-700 dark:text-rose-200"}>DKIM {report.dkim_status}</span><span className="mx-1 text-muted-foreground">/</span><span className={report.dmarc_status === "pass" ? "text-emerald-700 dark:text-emerald-200" : "text-rose-700 dark:text-rose-200"}>DMARC {report.dmarc_status}</span></TableCell><TableCell className="text-xs text-muted-foreground">{report.received_at ? new Date(report.received_at).toLocaleString() : "Unknown"}</TableCell></TableRow>)}</TableBody></Table>}</CardContent>
      </Card>

      <Card className="border-amber-500/15" data-testid="nexus-spf-safety">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />SPF sender inventory and lookup safety</CardTitle><p className="mt-1 text-xs text-muted-foreground">Assess before flattening. Nexus treats a sender inventory and an approved DNS change plan as mandatory safeguards.</p></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(nexusDmarc?.domains || []).length === 0 ? <p className="text-sm text-muted-foreground">Register a Nexus DMARC domain to assess SPF lookup risk.</p> : nexusDmarc.domains.map((domain) => <div key={`spf-${domain.id}`} className="rounded-xl border border-border/70 bg-background/55 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{domain.domain}</p><p className="mt-1 text-xs text-muted-foreground">{domain.spf_lookup_budget == null ? "Not assessed" : `${domain.spf_lookup_budget} DNS lookup mechanisms`}</p></div><Badge variant="outline" className={domain.spf_lookup_budget >= 10 ? "border-rose-500/30 text-rose-700 dark:text-rose-200" : domain.spf_lookup_budget >= 8 ? "border-amber-500/30 text-amber-700 dark:text-amber-200" : "text-muted-foreground"}>{domain.spf_lookup_budget >= 10 ? "Hard limit" : domain.spf_lookup_budget >= 8 ? "At risk" : "Review"}</Badge></div><Button size="sm" variant="outline" className="mt-4" onClick={() => openSpfAssessment(domain)}>Assess SPF record</Button></div>)}</CardContent>
      </Card>

      <Card className="border-sky-500/15" data-testid="nexus-spf-flatten-preview">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Shield className="h-4 w-4 text-sky-600 dark:text-sky-300" />Flattened SPF preview</CardTitle><p className="mt-1 text-xs text-muted-foreground">A point-in-time candidate built from public DNS. It is never published automatically.</p></CardHeader>
        <CardContent className="space-y-3">{(nexusDmarc?.domains || []).length === 0 ? <p className="text-sm text-muted-foreground">Register a domain first.</p> : <div className="flex flex-wrap gap-2">{nexusDmarc.domains.map((domain) => <Button key={`preview-${domain.id}`} size="sm" variant="outline" onClick={() => createFlattenPreview(domain)} disabled={previewingDomain === domain.id}>{previewingDomain === domain.id ? "Resolving…" : `Preview ${domain.domain}`}</Button>)}</div>}{flattenPreview && <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.035] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-sm">{flattenPreview.domain}</p><Badge variant="outline" className="border-sky-500/30 text-sky-700 dark:text-sky-200">{flattenPreview.remaining_lookup_budget} remaining lookups</Badge></div><p className="mt-3 break-all rounded-lg border border-border/70 bg-background/60 p-3 font-mono text-xs text-foreground">{flattenPreview.candidate_record}</p>{flattenPreview.unresolved_mechanisms?.length > 0 && <p className="mt-3 text-xs text-amber-700 dark:text-amber-200">Review before approval: {flattenPreview.unresolved_mechanisms.join(", ")}</p>}<p className="mt-3 text-xs text-muted-foreground">{flattenPreview.warning}</p></div>}</CardContent>
      </Card>

      <Card className="border-sky-500/15" data-testid="nexus-spf-change-plans">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><ClipboardList className="h-4 w-4 text-sky-600 dark:text-sky-300" />SPF change-plan queue</CardTitle><p className="mt-1 text-xs text-muted-foreground">Drafts are evidence-backed and include rollback. They still require a separately approved Nexus DNS change to publish.</p></CardHeader>
        <CardContent className="p-0">{(nexusDmarc?.spf_change_plans || []).length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">No SPF change plans yet. Assess a domain’s live SPF record to create one.</div> : <Table><TableHeader><TableRow><TableHead>Domain</TableHead><TableHead>Lookup budget</TableHead><TableHead>Known senders</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader><TableBody>{nexusDmarc.spf_change_plans.map((plan) => <TableRow key={plan.id}><TableCell className="font-medium">{plan.domain}</TableCell><TableCell className={plan.lookup_budget >= 10 ? "font-medium text-rose-700 dark:text-rose-200" : plan.lookup_budget >= 8 ? "font-medium text-amber-700 dark:text-amber-200" : "text-muted-foreground"}>{plan.lookup_budget}</TableCell><TableCell className="text-sm text-muted-foreground">{plan.sender_candidates?.length || 0} inventoried</TableCell><TableCell><Badge variant="outline" className="border-sky-500/30 text-sky-700 dark:text-sky-200">{plan.status || "draft"}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{plan.created_at ? new Date(plan.created_at).toLocaleString() : "Unknown"}</TableCell></TableRow>)}</TableBody></Table>}</CardContent>
      </Card>

      {/* Service Coverage */}
      <Card data-testid="service-coverage-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-blue-500" />Service Coverage Across Fleet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data.service_coverage || []).map(svc => {
            const pct = svc.total > 0 ? Math.round((svc.active / svc.total) * 100) : 0;
            const c = scoreColor(pct);
            return (
              <div key={svc.name} className="space-y-1" data-testid={`coverage-${svc.name}`}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{svc.name}</span>
                  <span className={`font-mono text-xs ${c.text}`}>{svc.active}/{svc.total} clients ({pct}%)</span>
                </div>
                <Progress value={pct} className="h-2" />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Clients At Risk */}
      {data.at_risk && data.at_risk.length > 0 && (
        <Card className="border-red-500/20" data-testid="at-risk-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" />Clients Needing Attention ({data.at_risk.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.at_risk.slice(0, 8).map(c => {
              const cs = scoreColor(c.score);
              return (
                <div
                  key={c.client_id}
                  className="flex items-center justify-between p-3 rounded-lg border border-red-500/10 bg-red-500/5 hover:bg-red-500/8 cursor-pointer transition-colors"
                  onClick={() => navigate(`/clients?client=${c.client_id}`)}
                  data-testid={`risk-client-${c.client_id}`}
                >
                  <div className="flex items-center gap-3">
                    <ShieldX className="w-5 h-5 text-red-400" />
                    <div>
                      <p className="font-medium text-sm">{c.client_name}</p>
                      <p className="text-[11px] text-muted-foreground">{c.active_services}/{c.total_services} services active {!c.has_suped && "| No Suped Org ID"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`text-xl font-black ${cs.text}`}>{c.score}%</div>
                    <Eye className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Full Client Table */}
      <Card data-testid="client-compliance-table">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" />All Clients ({filteredClients.length})</CardTitle>
          <div className="relative w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9 h-8 text-sm" placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} data-testid="compliance-search" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-center">Score</TableHead>
                <TableHead className="text-center">DMARC</TableHead>
                <TableHead className="text-center">Hosted DMARC</TableHead>
                <TableHead className="text-center">Hosted SPF</TableHead>
                <TableHead className="text-center">MTA-STS</TableHead>
                <TableHead className="text-center">SPF Flatten</TableHead>
                <TableHead className="text-center">Blocklist</TableHead>
                <TableHead className="text-center">Suped</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredClients.map(c => {
                const cs = scoreColor(c.score);
                const svc = c.services || {};
                const ServiceBadge = ({ active }) => (
                  active
                    ? <CheckCircle className="w-4 h-4 text-emerald-400 mx-auto" />
                    : <XCircle className="w-4 h-4 text-red-400 mx-auto" />
                );
                return (
                  <TableRow key={c.client_id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/clients?client=${c.client_id}`)} data-testid={`compliance-row-${c.client_id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {c.score >= 80 ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : c.score >= 50 ? <AlertTriangle className="w-4 h-4 text-amber-400" /> : <ShieldX className="w-4 h-4 text-red-400" />}
                        <span className="font-medium text-sm">{c.client_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={`text-xs ${cs.text} ${cs.bg}/10 border-transparent`}>{c.score}%</Badge>
                    </TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.dmarc_monitoring} /></TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.hosted_dmarc} /></TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.hosted_spf} /></TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.hosted_mta_sts} /></TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.spf_flattening} /></TableCell>
                    <TableCell className="text-center"><ServiceBadge active={svc.blocklist_monitoring} /></TableCell>
                    <TableCell className="text-center">
                      {c.has_suped
                        ? <Badge className="bg-emerald-500/20 text-emerald-400 text-[10px]">Linked</Badge>
                        : <Badge className="bg-muted text-muted-foreground text-[10px]">Not Linked</Badge>
                      }
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredClients.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">No clients found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={Boolean(spfDomain)} onOpenChange={(open) => { if (!open) setSpfDomain(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-amber-500/20 bg-[linear-gradient(160deg,#0a151b,#090b11)] sm:max-w-2xl">
          <DialogHeader><DialogTitle>Assess SPF lookup risk</DialogTitle><p className="text-sm text-muted-foreground">{spfDomain?.domain} · Nexus creates an assessment only. It will not flatten or publish a DNS record from this screen.</p></DialogHeader>
          <div className="space-y-4 py-2"><div className="space-y-2"><Label htmlFor="nexus-spf-record">Live SPF TXT record</Label><Textarea id="nexus-spf-record" value={spfRecord} onChange={(event) => setSpfRecord(event.target.value)} placeholder="v=spf1 include:spf.protection.outlook.com include:mailer.example -all" className="min-h-24 font-mono text-xs" /><p className="text-xs text-muted-foreground">Nexus counts DNS-triggering SPF mechanisms and flags a review from 8, or a hard limit at 10.</p></div><div className="space-y-2"><Label htmlFor="nexus-spf-senders">Known sending services</Label><Textarea id="nexus-spf-senders" value={spfSenders} onChange={(event) => setSpfSenders(event.target.value)} placeholder={"Microsoft 365\nMarketing platform\nPrinter / line-of-business relay"} /><p className="text-xs text-muted-foreground">One per line. This becomes the initial sender inventory for a technician to verify before any flattening change plan.</p></div></div>
          <DialogFooter><Button variant="outline" onClick={() => setSpfDomain(null)}>Cancel</Button><Button className="bg-amber-400 text-amber-950 hover:bg-amber-300" onClick={assessSpf} disabled={assessingSpf || !spfRecord.trim()}>{assessingSpf ? "Assessing…" : "Assess safely"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={receiverDialogOpen} onOpenChange={setReceiverDialogOpen}>
        <DialogContent className="border-cyan-400/20 bg-[linear-gradient(160deg,#0a151b,#090b11)] sm:max-w-lg">
          <DialogHeader><DialogTitle>Configure Nexus report receiver</DialogTitle><p className="text-sm text-muted-foreground">Use an owned hostname that routes to your secured aggregate-report ingestion service.</p></DialogHeader>
          <div className="space-y-2 py-2"><Label htmlFor="nexus-dmarc-receiver">Receiver hostname</Label><Input id="nexus-dmarc-receiver" value={receiverDomain} onChange={(event) => setReceiverDomain(event.target.value)} placeholder="reports.nexusmsp.com" autoComplete="off" /><p className="text-xs text-muted-foreground">Do not use a client sending domain. This is the Nexus-controlled destination for RUA aggregate reports.</p></div>
          <DialogFooter><Button variant="outline" onClick={() => setReceiverDialogOpen(false)}>Cancel</Button><Button className="bg-cyan-400 text-cyan-950 hover:bg-cyan-300" onClick={saveReceiver} disabled={savingReceiver}>{savingReceiver ? "Saving…" : "Save receiver"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={domainDialogOpen} onOpenChange={setDomainDialogOpen}>
        <DialogContent className="border-cyan-400/20 bg-[linear-gradient(160deg,#0a151b,#090b11)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Register a Nexus DMARC domain</DialogTitle>
            <p className="text-sm text-muted-foreground">Nexus creates a unique RUA receiver address. Publishing it remains an approved DNS change, not an automatic action.</p>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label htmlFor="nexus-dmarc-client">Client</Label><select id="nexus-dmarc-client" value={domainClientId} onChange={(event) => setDomainClientId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"><option value="">Select a client…</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name || client.client_name}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="nexus-dmarc-domain">Sending domain</Label><Input id="nexus-dmarc-domain" value={domainValue} onChange={(event) => setDomainValue(event.target.value)} placeholder="example.com" autoComplete="off" /><p className="text-xs text-muted-foreground">Enter the root domain only—no protocol or path.</p></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDomainDialogOpen(false)}>Cancel</Button><Button className="bg-cyan-400 text-cyan-950 hover:bg-cyan-300" onClick={registerDomain} disabled={savingDomain}>{savingDomain ? "Registering…" : "Register domain"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(policyDomain)} onOpenChange={(open) => { if (!open) setPolicyDomain(null); }}>
        <DialogContent className="border-cyan-400/20 bg-[linear-gradient(160deg,#0a151b,#090b11)] sm:max-w-lg">
          <DialogHeader><DialogTitle>Stage DMARC policy intent</DialogTitle><p className="text-sm text-muted-foreground">{policyDomain?.domain} · this records an approved deployment intent only. It does not publish a DNS change.</p></DialogHeader>
          <div className="space-y-4 py-2"><div className="space-y-2"><Label htmlFor="nexus-dmarc-policy">Policy intent</Label><select id="nexus-dmarc-policy" value={policyValue} onChange={(event) => setPolicyValue(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"><option value="none">p=none — observe</option><option value="quarantine">p=quarantine — staged enforcement</option><option value="reject">p=reject — full enforcement</option></select></div><div className="space-y-2"><Label htmlFor="nexus-dmarc-policy-note">Approval and evidence note</Label><Input id="nexus-dmarc-policy-note" value={policyNote} onChange={(event) => setPolicyNote(event.target.value)} placeholder="Evidence reviewed, owner approval and DNS change reference…" /></div></div>
          <DialogFooter><Button variant="outline" onClick={() => setPolicyDomain(null)}>Cancel</Button><Button className="bg-cyan-400 text-cyan-950 hover:bg-cyan-300" onClick={savePolicy} disabled={savingPolicy || !policyNote.trim()}>{savingPolicy ? "Saving…" : "Save policy intent"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
