import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { toast } from "sonner";
import HeroTile from "@/components/HeroTile";
import ScheduledReportsPage from "@/pages/ScheduledReportsPage";
import PostmortemPage from "@/pages/PostmortemPage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Activity, BarChart3, BellRing, BookOpenCheck, CalendarClock, CheckCircle2,
  ClipboardCheck, Download, FileBarChart, FileCheck2, Landmark, Loader2,
  MonitorCog, ReceiptText, RefreshCw, Scale, ShieldCheck, TriangleAlert, Users, WalletCards, FileText,
} from "lucide-react";
import { ResponsiveContainer, Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

const TABS = ["overview", "operations", "security", "governance", "commercial", "clients", "postmortems", "delivery"];
const LEGACY_TAB_MAP = { operational: "operations", executive: "overview", client: "clients", financial: "commercial", roi: "clients", postmortem: "postmortems" };
const money = (value) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Number(value || 0));
const date = (value) => value ? new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "Not generated";

function ReportCard({ icon: Icon, title, description, tag, onOpen, tone = "sky" }) {
  const tones = { sky: "text-sky-300 bg-sky-400/10 border-sky-400/20", emerald: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20", amber: "text-amber-300 bg-amber-400/10 border-amber-400/20", violet: "text-violet-300 bg-violet-400/10 border-violet-400/20", rose: "text-rose-300 bg-rose-400/10 border-rose-400/20" };
  const cardId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return <Card className="border-border/70 bg-card/70 transition-colors hover:border-primary/35">
    <CardContent className="p-4">
      <div className="flex gap-3">
        <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${tones[tone]}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{title}</h3>{tag && <Badge variant="outline" className="shrink-0 text-[10px]">{tag}</Badge>}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p><Button variant="ghost" size="sm" className="mt-2 h-7 px-0 text-xs" data-testid={`open-report-${cardId}`} onClick={onOpen}>Generate report <span className="ml-1">→</span></Button></div>
      </div>
    </CardContent>
  </Card>;
}

function EmptyState({ children }) { return <div className="rounded-xl border border-dashed border-border/80 px-5 py-10 text-center text-sm text-muted-foreground">{children}</div>; }

function AgingSnapshot({ aging, onGenerate, generating }) {
  const buckets = Object.entries(aging?.buckets || {});
  const overdue = buckets.flatMap(([bucket, data]) => (data.items || []).filter((item) => item.days_overdue > 0).map((item) => ({ ...item, bucket, bucketLabel: data.label })));
  if (!buckets.length) return <EmptyState>Receivables evidence is not available yet. Refresh the reporting workspace to retry.</EmptyState>;
  return <Card className="overflow-hidden border-rose-500/20">
    <CardHeader className="border-b border-border/60 bg-gradient-to-r from-rose-500/[0.08] via-card to-card pb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-300">Live finance evidence</p><CardTitle className="mt-1 text-base">Accounts receivable ageing</CardTitle><p className="mt-1 text-xs text-muted-foreground">Outstanding invoices as at {aging?.as_of || "the latest refresh"}. Generate a retained, branded evidence snapshot when needed.</p></div><Button size="sm" onClick={onGenerate} disabled={generating} data-testid="generate-ar-aging-report">{generating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileBarChart className="mr-1.5 h-3.5 w-3.5" />}Generate ageing report</Button></div>
    </CardHeader>
    <CardContent className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{buckets.map(([key, bucket]) => <HeroTile key={key} label={bucket.label || key.replace(/_/g, " ")} value={money(bucket.total)} subtitle={`${bucket.count || 0} invoice${bucket.count === 1 ? "" : "s"}`} icon={WalletCards} glow={key === "over_90" ? "rose" : key === "current" ? "emerald" : "amber"} animated={false} />)}</div>
      <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm"><span className="text-muted-foreground">Total receivables</span><span className="font-semibold text-rose-300">{money(aging.grand_total)}</span></div>
      {overdue.length ? <div className="overflow-hidden rounded-xl border border-border/70"><Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Client</TableHead><TableHead>Age</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader><TableBody>{overdue.slice(0, 8).map((invoice) => <TableRow key={invoice.invoice_id}><TableCell className="font-medium">{invoice.invoice_number || "Invoice"}</TableCell><TableCell>{invoice.client_name || "Unassigned client"}</TableCell><TableCell><Badge variant="outline" className={invoice.days_overdue > 90 ? "border-rose-500/30 text-rose-300" : "border-amber-500/30 text-amber-300"}>{invoice.bucketLabel || `${invoice.days_overdue} days overdue`}</Badge></TableCell><TableCell className="text-right font-medium">{money(invoice.balance)}</TableCell></TableRow>)}</TableBody></Table></div> : <div className="rounded-lg border border-dashed border-emerald-500/25 bg-emerald-500/[0.035] px-4 py-5 text-center text-sm text-emerald-200">No overdue invoices are currently recorded.</div>}
    </CardContent>
  </Card>;
}

export default function ReportsHubPage() {
  const { token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const requested = new URLSearchParams(location.search).get("tab");
  const initialTab = TABS.includes(requested) ? requested : (LEGACY_TAB_MAP[requested] || "overview");
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState("");
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [activeReport, setActiveReport] = useState(null);
  const [reportPreviewLoading, setReportPreviewLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const get = (path, fallback) => axios.get(`${API}${path}`, { headers }).then((r) => r.data).catch(() => fallback);
    const [tickets, technicians, devices, compliance, audit, financial, aging, clients, clientReports, schedules, generated] = await Promise.all([
      get("/reports/ticket-analytics", null), get("/reports/technician-utilization", null), get("/reports/device-analytics", null), get("/compliance/reports", []), get("/audit-trail/summary?days=30", null), get("/reports/financial/revenue-summary", null), get("/reports/financial/aging", null), get("/reports/client-analytics", null), get("/client-reports/history", []), get("/scheduled-reports/stats/overview", null), get("/reports/generated", []),
    ]);
    setData({ tickets, technicians, devices, compliance: Array.isArray(compliance) ? compliance : [], audit, financial, aging, clients, clientReports: Array.isArray(clientReports) ? clientReports : clientReports?.history || [], schedules, generated: Array.isArray(generated) ? generated : [] });
    setRefreshedAt(new Date());
    setLoading(false);
  };

  useEffect(() => { load(); }, [headers]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTab(TABS.includes(requested) ? requested : (LEGACY_TAB_MAP[requested] || "overview")); }, [requested]);

  const selectTab = (next) => { setTab(next); navigate(next === "overview" ? "/reports" : `/reports?tab=${next}`, { replace: true }); };
  const exportCurrent = () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), scope: tab, data }, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = href; a.download = `nexusmsp-${tab}-report-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(href);
  };
  const runReport = async (name, reportType) => {
    setGenerating(reportType);
    try {
      await axios.post(`${API}/reports/generate`, { name, report_type: reportType }, { headers });
      toast.success(`${name} generated and retained in Reporting.`);
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || `Could not generate ${name}.`);
    } finally { setGenerating(""); }
  };
  const downloadReportPdf = async (report) => {
    try {
      const anchor = document.createElement("a");
      anchor.href = `${API}/reports/generated/${report.output_id}/pdf?token=${encodeURIComponent(token)}`;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      window.setTimeout(() => anchor.remove(), 1500);
      toast.success("PDF download started.");
    } catch (error) { toast.error(error?.response?.data?.detail || "Could not create the PDF report."); }
  };
  const previewReport = async (report) => {
    setReportPreviewLoading(true);
    try {
      const { data: preview } = await axios.get(`${API}/reports/generated/${report.output_id}`, { headers });
      setActiveReport(preview);
    } catch (error) { toast.error(error?.response?.data?.detail || "Could not open this report."); }
    finally { setReportPreviewLoading(false); }
  };
  const ticket = data.tickets || {};
  const financial = data.financial || {};
  const aging = data.aging || {};
  const audit = data.audit || {};
  const latestCompliance = data.compliance?.[0];
  const categoryData = Array.isArray(ticket.by_category)
    ? ticket.by_category.map((item) => ({ name: item.name, count: item.value }))
    : Object.entries(ticket.by_category || {}).map(([name, count]) => ({ name, count }));
  const statusRows = Array.isArray(ticket.by_status)
    ? ticket.by_status
    : Object.entries(ticket.by_status || {}).map(([name, value]) => ({ name, value }));
  const resolvedTickets = statusRows
    .filter((item) => ["resolved", "closed", "completed"].includes(String(item.name || item.status || "").toLowerCase()))
    .reduce((total, item) => total + Number(item.value ?? item.count ?? 0), 0);
  const reportingSignal = Number(financial.total_outstanding || 0) > 0
    ? "attention"
    : latestCompliance?.score != null || (audit.total_events || 0) > 0
      ? "healthy"
      : "recommendation";

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return <div className="nx-page-stage space-y-5" data-testid="reports-hub">
    <section className="nx-ambient-surface relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950/60 p-5 sm:p-6" data-nx-signal={reportingSignal}>
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-violet-500/15 blur-3xl" />
      <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Assurance intelligence</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Reporting & evidence centre</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">One reporting library for service performance, devices, security posture, audit evidence, finance and client outcomes.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button><Button variant="outline" size="sm" onClick={exportCurrent}><Download className="mr-1.5 h-3.5 w-3.5" />Export view</Button><Button variant="outline" size="sm" onClick={() => navigate("/incident-heatmap")}><TriangleAlert className="mr-1.5 h-3.5 w-3.5" />Incident heatmap</Button><Button size="sm" onClick={() => selectTab("delivery")}><CalendarClock className="mr-1.5 h-3.5 w-3.5" />Schedule delivery</Button></div>
      </div>
      <p className="relative mt-4 text-[11px] text-muted-foreground">Live data refreshed {refreshedAt ? refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now"}. Exports preserve the data currently visible in this workspace.</p>
    </section>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <HeroTile label="Audit events · 30d" value={audit.total_events || 0} icon={ClipboardCheck} glow="violet" subtitle={`${audit.last_24h || 0} in the last 24 hours`} />
      <HeroTile label="SLA compliance" value={ticket.sla_compliance == null ? "—" : Number(ticket.sla_compliance)} suffix={ticket.sla_compliance == null ? "" : "%"} icon={CheckCircle2} glow="emerald" animated={ticket.sla_compliance != null} subtitle={`${resolvedTickets} tickets resolved`} />
      <HeroTile label="Outstanding" value={money(financial.total_outstanding)} icon={WalletCards} glow="amber" animated={false} subtitle="Accounts receivable across invoices" />
      <HeroTile label="Compliance evidence" value={latestCompliance?.score ?? 0} suffix="%" icon={ShieldCheck} glow={latestCompliance?.score >= 80 ? "emerald" : "rose"} subtitle={latestCompliance ? `${latestCompliance.framework_name || latestCompliance.framework} · ${latestCompliance.client_name || "latest scan"}` : "No completed scan yet"} />
    </div>

    <Tabs value={tab} onValueChange={selectTab}>
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl border bg-muted/35 p-1 sm:grid-cols-4 xl:grid-cols-8">
        <TabsTrigger value="overview" className="min-w-0"><FileBarChart className="mr-1.5 h-3.5 w-3.5" />Library</TabsTrigger>
        <TabsTrigger value="operations" className="min-w-0"><Activity className="mr-1.5 h-3.5 w-3.5" />Operations</TabsTrigger>
        <TabsTrigger value="security" className="min-w-0"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Security</TabsTrigger>
        <TabsTrigger value="governance" className="min-w-0"><Scale className="mr-1.5 h-3.5 w-3.5" />Audit</TabsTrigger>
        <TabsTrigger value="commercial" className="min-w-0"><Landmark className="mr-1.5 h-3.5 w-3.5" />Commercial</TabsTrigger>
        <TabsTrigger value="clients" className="min-w-0"><Users className="mr-1.5 h-3.5 w-3.5" />Clients</TabsTrigger>
        <TabsTrigger value="postmortems" className="min-w-0"><TriangleAlert className="mr-1.5 h-3.5 w-3.5" />Post-Mortems</TabsTrigger>
        <TabsTrigger value="delivery" className="min-w-0"><CalendarClock className="mr-1.5 h-3.5 w-3.5" />Delivery</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-5 space-y-5">
        <div className="flex items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Report library</h2><p className="text-sm text-muted-foreground">Authoritative reports are grouped by the operational question they answer.</p></div><Badge variant="outline">{data.schedules?.active || 0} scheduled deliveries active</Badge></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ReportCard icon={Activity} title="Service operations" description="Ticket volume, resolution performance, SLA and technician capacity." tag="Live" onOpen={() => runReport("Service operations", "service_operations")} />
          <ReportCard icon={MonitorCog} title="RMM & device estate" description="Endpoint inventory, health, check-in status, patching and device risk." tag="Live" tone="emerald" onOpen={() => runReport("RMM & device estate", "rmm_device_estate")} />
          <ReportCard icon={ShieldCheck} title="Security & compliance" description="Framework scans, security evidence, patch compliance and endpoint protections." tag="Evidence" tone="rose" onOpen={() => runReport("Security & compliance", "security_compliance")} />
          <ReportCard icon={ClipboardCheck} title="Audit & governance" description="Searchable persisted actions, critical events and compliance-ready audit evidence." tag="30-day live" tone="violet" onOpen={() => runReport("Audit & governance", "audit_governance")} />
          <ReportCard icon={ReceiptText} title="Billing & revenue" description="Revenue, MRR, collections, invoice aging and client profitability." tag="Finance" tone="amber" onOpen={() => runReport("Billing & revenue", "billing_revenue")} />
          <ReportCard icon={Users} title="Client outcomes" description="Executive packs, client history, health insights and QBR-ready reporting." tag="Client-ready" tone="sky" onOpen={() => runReport("Client outcomes", "client_health")} />
          <ReportCard icon={TriangleAlert} title="Incident post-mortems" description="Generate a review from a resolved ticket, retain the incident record, and track prevention actions." tag="Incident review" tone="rose" onOpen={() => selectTab("postmortems")} />
        </div>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Generated reports</CardTitle></CardHeader>
          <CardContent className="p-0">
            {data.generated?.length ? <Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Type</TableHead><TableHead>Generated</TableHead><TableHead>By</TableHead><TableHead className="text-right">Output</TableHead></TableRow></TableHeader><TableBody>{data.generated.slice(0, 8).map((report) => <TableRow key={report.id}><TableCell className="font-medium">{report.name}</TableCell><TableCell className="capitalize">{String(report.report_type || "standard").replace(/_/g, " ")}</TableCell><TableCell>{date(report.generated_at)}</TableCell><TableCell>{report.generated_by || "System"}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2"><Button variant="ghost" size="sm" data-testid={`preview-report-${report.output_id}`} onClick={() => previewReport(report)}><FileText className="mr-1.5 h-3.5 w-3.5" />View</Button><Button variant="outline" size="sm" data-testid={`download-report-${report.output_id}`} onClick={() => downloadReportPdf(report)}><Download className="mr-1.5 h-3.5 w-3.5" />PDF</Button></div></TableCell></TableRow>)}</TableBody></Table> : <div className="px-5 py-8 text-sm text-muted-foreground">Generated reports are retained here for audit and future delivery.</div>}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="operations" className="mt-5 space-y-4">
        <div><h2 className="text-lg font-semibold">Service operations</h2><p className="text-sm text-muted-foreground">Evidence for ticket performance, technician workload and service commitments.</p></div>
        <div className="grid gap-3 md:grid-cols-3"><ReportCard icon={BarChart3} title="Ticket analytics" description="Volume, categories, resolution time and SLA performance." tag="Current" onOpen={() => runReport("Ticket analytics", "ticket_analytics")} /><ReportCard icon={Users} title="Technician utilisation" description="Capacity, workload and service delivery performance by technician." onOpen={() => runReport("Technician utilisation", "technician_utilisation")} tone="violet" /><ReportCard icon={BellRing} title="SLA reporting" description="Response commitments, breached timers and trend analysis." onOpen={() => runReport("SLA reporting", "sla_reporting")} tone="amber" /></div>
        {categoryData.length ? <Card><CardHeader className="pb-2"><CardTitle className="text-base">Ticket categories</CardTitle></CardHeader><CardContent><div className="h-64"><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}><BarChart data={categoryData}><CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} /><XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10 }} /><Bar dataKey="count" fill="#38bdf8" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></CardContent></Card> : <EmptyState>No ticket categories have been collected yet.</EmptyState>}
      </TabsContent>

      <TabsContent value="security" className="mt-5 space-y-4"><div><h2 className="text-lg font-semibold">Security & compliance evidence</h2><p className="text-sm text-muted-foreground">Use framework scans as source evidence; controls without evidence remain explicitly unassessed.</p></div><div className="grid gap-3 md:grid-cols-3"><ReportCard icon={ShieldCheck} title="Framework assessments" description="CIS, HIPAA and other framework scans with control-level evidence." tag={`${data.compliance.length} scans`} tone="rose" onOpen={() => runReport("Framework assessments", "framework_assessments")} /><ReportCard icon={MonitorCog} title="Patch compliance" description="Patch posture, exceptions and remediation evidence across managed devices." tone="amber" onOpen={() => runReport("Patch compliance", "patch_compliance")} /><ReportCard icon={FileCheck2} title="Endpoint security" description="Defender, firewall, encryption and antivirus status from endpoint inventory." tone="emerald" onOpen={() => runReport("Endpoint security", "endpoint_security")} /></div>{data.compliance.length ? <Card><CardHeader><CardTitle className="text-base">Recent framework evidence</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Framework</TableHead><TableHead>Evidence score</TableHead><TableHead>Coverage</TableHead><TableHead>Scanned</TableHead></TableRow></TableHeader><TableBody>{data.compliance.slice(0, 8).map((report) => <TableRow key={report.id}><TableCell className="font-medium">{report.client_name || "Organisation"}</TableCell><TableCell>{report.framework_name || report.framework}</TableCell><TableCell>{report.score ?? 0}%</TableCell><TableCell>{report.coverage_pct ?? "—"}{report.coverage_pct != null ? "%" : ""}</TableCell><TableCell>{date(report.scanned_at || report.generated_at)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card> : <EmptyState>No framework scan has been generated. Run a compliance scan to create an evidence-backed baseline.</EmptyState>}</TabsContent>

      <TabsContent value="governance" className="mt-5 space-y-4"><div><h2 className="text-lg font-semibold">Audit & governance</h2><p className="text-sm text-muted-foreground">Read-only evidence assembled from persisted activity and endpoint events.</p></div><div className="grid gap-3 md:grid-cols-3"><ReportCard icon={ClipboardCheck} title="Audit trail" description="Filter actions by category, severity, technician and evidence window." tag={`${audit.total_events || 0} events`} tone="violet" onOpen={() => runReport("Audit trail", "audit_trail")} /><ReportCard icon={FileCheck2} title="Change management" description="Approved changes, risk records and implementation history." tone="amber" onOpen={() => runReport("Change management", "change_management")} /><ReportCard icon={BookOpenCheck} title="Knowledge & runbooks" description="Operational documentation supporting repeatable and auditable service delivery." tone="sky" onOpen={() => runReport("Knowledge & runbooks", "knowledge_runbooks")} /></div><Card><CardHeader><CardTitle className="text-base">30-day audit evidence</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><div><p className="text-3xl font-bold">{audit.total_events || 0}</p><p className="mt-1 text-xs text-muted-foreground">Persisted events</p></div><div><p className="text-3xl font-bold text-rose-300">{audit.by_severity?.critical || 0}</p><p className="mt-1 text-xs text-muted-foreground">Critical events requiring review</p></div><div><p className="text-3xl font-bold text-amber-300">{audit.by_severity?.warning || 0}</p><p className="mt-1 text-xs text-muted-foreground">Warnings in the evidence window</p></div></CardContent></Card></TabsContent>

      <TabsContent value="commercial" className="mt-5 space-y-4">
        <div><h2 className="text-lg font-semibold">Commercial & billing reports</h2><p className="text-sm text-muted-foreground">Finance-ready revenue, collections, recurring contract and invoice evidence.</p></div>
        <div className="grid gap-3 md:grid-cols-2"><ReportCard icon={Landmark} title="Revenue summary" description="Revenue, MRR, ARR, collections and outstanding balance." tag="Live" tone="amber" onOpen={() => runReport("Revenue summary", "revenue_summary")} /><ReportCard icon={ReceiptText} title="Contracts & recurring" description="Contract-backed recurring services and billing readiness." tone="emerald" onOpen={() => runReport("Contracts & recurring", "contracts_recurring")} /></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><HeroTile label="Revenue · 12m" value={money(financial.total_revenue)} icon={Landmark} glow="sky" animated={false} /><HeroTile label="Collected · 12m" value={money(financial.total_collected)} icon={CheckCircle2} glow="emerald" animated={false} /><HeroTile label="Current MRR" value={money(financial.current_mrr)} icon={WalletCards} glow="violet" animated={false} /><HeroTile label="Receivables" value={money(aging.grand_total || financial.total_outstanding)} icon={ReceiptText} glow="amber" animated={false} /></div>
        <AgingSnapshot aging={aging} generating={generating === "accounts_receivable_aging"} onGenerate={() => runReport("Accounts receivable ageing", "accounts_receivable_aging")} />
      </TabsContent>

      <TabsContent value="clients" className="mt-5 space-y-4"><div><h2 className="text-lg font-semibold">Client & executive reporting</h2><p className="text-sm text-muted-foreground">Turn operational evidence into client-ready outcomes and leadership reporting.</p></div><div className="grid gap-3 md:grid-cols-3"><ReportCard icon={Users} title="Client report history" description="Generated client reports and recurring service outcomes." tag={`${data.clientReports.length} records`} onOpen={() => runReport("Client report history", "client_health")} /><ReportCard icon={FileBarChart} title="Executive packs" description="Leadership packs generated from the same recorded reporting evidence." tag={`${data.generated.length} evidence outputs`} tone="violet" onOpen={() => runReport("Executive packs", "executive_summary")} /><ReportCard icon={BarChart3} title="QBR & client insights" description="Strategic review, health and value reporting for client meetings." tone="emerald" onOpen={() => runReport("QBR & client insights", "client_health")} /></div>{data.clientReports.length ? <Card><CardHeader><CardTitle className="text-base">Recently generated client reports</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Client</TableHead><TableHead>Type</TableHead><TableHead>Generated</TableHead></TableRow></TableHeader><TableBody>{data.clientReports.slice(0, 8).map((report, index) => <TableRow key={report.id || index}><TableCell className="font-medium">{report.name || report.title || "Client report"}</TableCell><TableCell>{report.client_name || "Multiple clients"}</TableCell><TableCell className="capitalize">{(report.report_type || report.type || "standard").replace(/_/g, " ")}</TableCell><TableCell>{date(report.created_at || report.generated_at)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card> : <EmptyState>No client reports have been generated yet. Use the client reporting workspace to create a client-ready report.</EmptyState>}</TabsContent>

      <TabsContent value="postmortems" className="mt-5"><PostmortemPage embedded /></TabsContent>

      <TabsContent value="delivery" className="mt-5"><ScheduledReportsPage embedded /></TabsContent>
    </Tabs>

    <Dialog open={!!activeReport || reportPreviewLoading} onOpenChange={(open) => { if (!open) { setActiveReport(null); setReportPreviewLoading(false); } }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto p-0" aria-describedby="report-preview-description">
        {reportPreviewLoading && !activeReport ? <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : activeReport && <ReportPreview report={activeReport} onDownload={() => downloadReportPdf(activeReport.history)} />}
      </DialogContent>
    </Dialog>
  </div>;
}

function ReportPreview({ report, onDownload }) {
  const output = report.output || {};
  const history = report.history || {};
  const summary = output.sections?.summary || {};
  const isAgingReport = (history.report_type || output.report_type) === "accounts_receivable_aging";
  const agingEvidence = output.sections?.accounts_receivable_aging || {};
  const agingBuckets = Object.entries(agingEvidence.buckets || {});
  const agingInvoices = output.sections?.outstanding_invoices || [];
  const title = history.name || output.schedule_name || "Generated report";
  const metrics = [
    ["Managed devices", summary.devices_total ?? 0], ["Devices online", summary.devices_online ?? 0],
    ["Open tickets", summary.tickets_open ?? 0], ["Active alerts", summary.active_alerts ?? 0],
  ];
  const renderValue = (value) => {
    if (value == null) return "Not available";
    if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${key.replace(/_/g, " ")}: ${typeof item === "object" ? JSON.stringify(item) : item}`).join(" • ") || "No evidence recorded";
    return String(value);
  };
  return <article className="overflow-hidden bg-card"><DialogHeader className="border-b border-border/60 bg-gradient-to-r from-primary/10 via-card to-card px-6 py-5 text-left"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">NexusMSP reporting & evidence</p><DialogTitle className="mt-1 text-2xl tracking-tight">{title}</DialogTitle><DialogDescription id="report-preview-description" className="mt-2 text-sm">Managed service evidence and operational assurance <span className="px-1">•</span> Generated {date(output.generated_at)} by {output.generated_by || "System"}</DialogDescription><div className="mt-4 flex flex-wrap gap-2"><Badge variant="outline" className="capitalize">{String(history.report_type || output.report_type || "standard").replace(/_/g, " ")}</Badge><Badge variant="outline">Retained evidence snapshot</Badge><Button size="sm" className="ml-auto" onClick={onDownload}><Download className="mr-1.5 h-3.5 w-3.5" />Download PDF</Button></div></DialogHeader><div className="space-y-6 p-6"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{metrics.map(([label, value], index) => <HeroTile key={label} label={label} value={value} animated={typeof value === "number"} icon={[MonitorCog, CheckCircle2, Activity, BellRing][index]} glow={["sky", "emerald", "amber", "rose"][index]} />)}</div>{isAgingReport && <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-300">Receivables evidence</p><h3 className="mt-1 text-base font-semibold">Ageing snapshot · {agingEvidence.as_of || "current"}</h3></div><Badge className="bg-rose-500/15 text-rose-200">{money(agingEvidence.grand_total)} outstanding</Badge></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{agingBuckets.map(([key, bucket]) => <HeroTile key={key} label={bucket.label || key.replace(/_/g, " ")} value={money(bucket.balance)} subtitle={`${bucket.invoice_count || 0} invoice${bucket.invoice_count === 1 ? "" : "s"}`} icon={WalletCards} glow={key === "over_90" ? "rose" : key === "current" ? "emerald" : "amber"} animated={false} />)}</div>{agingInvoices.length ? <div className="overflow-hidden rounded-xl border border-border/70"><Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Client</TableHead><TableHead>Due</TableHead><TableHead>Age</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader><TableBody>{agingInvoices.map((invoice) => <TableRow key={`${invoice.invoice_id}-${invoice.bucket}`}><TableCell className="font-medium">{invoice.invoice_number || "Invoice"}</TableCell><TableCell>{invoice.client_name || "Unassigned client"}</TableCell><TableCell>{invoice.due_date || "Not recorded"}</TableCell><TableCell><Badge variant="outline" className={invoice.days_overdue > 90 ? "border-rose-500/30 text-rose-300" : invoice.days_overdue > 0 ? "border-amber-500/30 text-amber-300" : "border-emerald-500/30 text-emerald-300"}>{invoice.days_overdue > 0 ? `${invoice.days_overdue} days overdue` : "Current"}</Badge></TableCell><TableCell className="text-right font-medium">{money(invoice.balance)}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyState>No outstanding invoices were included in this report snapshot.</EmptyState>}</section>}{Object.entries(output.sections || {}).filter(([section]) => section !== "summary" && (!isAgingReport || !["accounts_receivable_aging", "outstanding_invoices"].includes(section))).map(([section, values]) => <section key={section} className="overflow-hidden rounded-xl border border-border/70"><div className="border-b border-border/60 bg-muted/25 px-4 py-3"><h3 className="text-sm font-semibold capitalize">{section.replace(/_/g, " ")}</h3></div><div className="divide-y divide-border/60">{typeof values === "object" && !Array.isArray(values) ? Object.entries(values).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(140px,0.35fr)_1fr] gap-4 px-4 py-3 text-sm"><p className="font-medium capitalize text-foreground/85">{key.replace(/_/g, " ")}</p><p className="leading-6 text-muted-foreground">{renderValue(value)}</p></div>) : <div className="px-4 py-3 text-sm text-muted-foreground">{renderValue(values)}</div>}</div></section>)}</div><footer className="border-t border-border/60 bg-muted/20 px-6 py-3 text-xs text-muted-foreground">This report is a retained point-in-time evidence snapshot. PDF output follows the same branded document format.</footer></article>;
}
