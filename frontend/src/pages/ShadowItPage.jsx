import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertTriangle, Bug, Building2, Check, ClipboardCheck, ExternalLink, Eye,
  Loader2, RefreshCw, ScanSearch, Search, ShieldAlert, Ticket as TicketIcon, X,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const RISK_STYLE = {
  critical: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  low: "border-zinc-700 bg-zinc-800 text-zinc-400",
};

const CATEGORY_LABEL = {
  file_sharing: "File sharing", remote_access: "Remote access", unapproved_vpn: "VPN",
  ai_tool: "AI tool", messaging: "Messaging", personal_cloud: "Personal cloud",
  password_manager_personal: "Password manager", crypto_mining: "Crypto", torrent_p2p: "Torrent",
  unapproved_backup: "Backup", screen_recorder: "Screen recorder", unapproved: "Unapproved",
};

const EMPTY_SUMMARY = {
  total_findings: 0,
  by_risk: { critical: 0, high: 0, medium: 0, low: 0 },
  clients_with_findings: 0,
  per_client: [],
  top_apps: [],
};

export default function ShadowItPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = { Authorization: `Bearer ${token}` };
  const [summary, setSummary] = useState(null);
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [actioningId, setActioningId] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [devicesDialog, setDevicesDialog] = useState(null);
  const [baselineDialog, setBaselineDialog] = useState(null);
  const [baselineDraft, setBaselineDraft] = useState("");
  const [baselineSaving, setBaselineSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [sumRes, findRes] = await Promise.all([
        axios.get(`${API}/shadow-it/summary`, { headers }),
        axios.get(`${API}/shadow-it/findings?limit=1000`, { headers }),
      ]);
      setSummary(sumRes.data);
      setFindings(findRes.data);
    } catch (error) {
      const message = error.response?.data?.detail || "Shadow IT findings could not be loaded. Check the API connection and try again.";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  // The token is the only auth value that changes between sessions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    try {
      await axios.post(`${API}/shadow-it/scan`, selectedClient ? { client_id: selectedClient } : {}, { headers });
      toast.success(selectedClient ? "Client scan complete" : "Fleet scan complete");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Shadow IT scan could not be completed");
    } finally {
      setScanning(false);
    }
  };

  const act = async (id, action) => {
    const finding = findings.find((entry) => entry.id === id);
    const confirmation = {
      approve: `Approve ${finding?.app || "this application"} for this client? It will be added to their software baseline.`,
      ignore: `Ignore ${finding?.app || "this finding"}? It remains in the audit trail but leaves the active review queue.`,
    };
    if (confirmation[action] && !window.confirm(confirmation[action])) return;

    setActioningId(id);
    try {
      const res = await axios.post(`${API}/shadow-it/findings/${id}/${action}`, {}, { headers });
      if (action === "create_ticket" && res.data?.ticket?.id) {
        toast.success("Security ticket created", {
          action: { label: "Open ticket", onClick: () => navigate(`/tickets?ticket=${encodeURIComponent(res.data.ticket.id)}`) },
        });
      } else {
        toast.success(action === "approve" ? "Added to approved baseline" : "Finding ignored");
      }
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "The Shadow IT action could not be completed");
    } finally {
      setActioningId(null);
    }
  };

  const openBaseline = async (client) => {
    if (!client) {
      toast.message("Select a client first", { description: "Choose a client from the policy list to manage its approved software baseline." });
      return;
    }
    try {
      const res = await axios.get(`${API}/clients/${client.client_id}/shadow-it/baseline`, { headers });
      setBaselineDraft((res.data.approved || []).join("\n"));
      setBaselineDialog(client);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not load the approved baseline");
    }
  };

  const saveBaseline = async () => {
    if (!baselineDialog) return;
    const approved = [...new Set(baselineDraft.split("\n").map((app) => app.trim()).filter(Boolean))];
    setBaselineSaving(true);
    try {
      await axios.put(`${API}/clients/${baselineDialog.client_id}/shadow-it/baseline`, { approved }, { headers });
      toast.success(`Approved baseline saved for ${baselineDialog.client_name}`);
      setBaselineDialog(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not save the approved baseline");
    } finally {
      setBaselineSaving(false);
    }
  };

  const s = summary || EMPTY_SUMMARY;
  const activeClient = s.per_client.find((client) => client.client_id === selectedClient);
  const scanCoverage = s.last_scan
    ? `${s.last_scan.agent_inventory_devices || 0} agent inventory endpoints${s.last_scan.legacy_inventory_devices ? `, ${s.last_scan.legacy_inventory_devices} legacy inventory endpoints` : ""}${s.last_scan.devices_without_inventory ? `, ${s.last_scan.devices_without_inventory} without software inventory` : ""}`
    : "Run the first scan to establish a review queue.";
  const visibleFindings = findings.filter((finding) => {
    if (selectedClient && finding.client_id !== selectedClient) return false;
    if (riskFilter !== "all" && finding.risk !== riskFilter) return false;
    const query = search.trim().toLowerCase();
    return !query || [finding.app, finding.client_name, finding.match_name, finding.category].some((value) => value?.toLowerCase().includes(query));
  });

  if (loadError && !loading) {
    return (
      <div className="space-y-6" data-testid="shadow-it-error">
        <OperationalPageHeader eyebrow="Endpoint security - application discovery" title="Shadow IT" description="Review unapproved software reported by the Nexus Agent." icon={ShieldAlert} tone="amber" actions={<Button size="sm" onClick={load}><RefreshCw className="mr-1 h-4 w-4" />Try again</Button>} />
        <Card className="border-rose-500/30 bg-rose-500/5"><CardContent className="flex items-center gap-3 py-5 text-sm text-rose-100"><AlertTriangle className="h-5 w-5 text-rose-400" />{loadError}</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="shadow-it-page">
      <OperationalPageHeader
        eyebrow="Endpoint security - application discovery"
        title="Shadow IT"
        description={`Review unapproved applications from reported software inventory${s.last_scan?.timestamp ? ` - last fleet scan ${new Date(s.last_scan.timestamp).toLocaleString()} (${scanCoverage})` : `. ${scanCoverage}`}`}
        icon={ShieldAlert}
        tone="amber"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => openBaseline(activeClient)} data-testid="sit-manage-baseline-btn"><ClipboardCheck className="mr-1 h-4 w-4" />Manage baseline</Button>
          <Button size="sm" onClick={runScan} disabled={scanning} data-testid="sit-scan-btn">{scanning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-1 h-4 w-4" />}{selectedClient ? "Scan client" : "Scan fleet"}</Button>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <HeroTile label="Open findings" value={s.total_findings} icon={ShieldAlert} glow="indigo" subtitle="Needs review or ticketing" onClick={() => { setRiskFilter("all"); setSelectedClient(null); }} active={riskFilter === "all" && !selectedClient} testId="sit-metric-total" />
        <HeroTile label="Critical" value={s.by_risk.critical || 0} icon={AlertTriangle} glow={s.by_risk.critical ? "rose" : "zinc"} subtitle="Immediate security review" onClick={() => setRiskFilter("critical")} active={riskFilter === "critical"} testId="sit-metric-critical" />
        <HeroTile label="High" value={s.by_risk.high || 0} icon={AlertTriangle} glow={s.by_risk.high ? "amber" : "zinc"} subtitle="Prioritise remediation" onClick={() => setRiskFilter("high")} active={riskFilter === "high"} testId="sit-metric-high" />
        <HeroTile label="Medium" value={s.by_risk.medium || 0} icon={Bug} glow={s.by_risk.medium ? "amber" : "zinc"} subtitle="Policy review required" onClick={() => setRiskFilter("medium")} active={riskFilter === "medium"} testId="sit-metric-medium" />
        <HeroTile label="Low" value={s.by_risk.low || 0} icon={Bug} glow={s.by_risk.low ? "sky" : "zinc"} subtitle="Baseline candidates" onClick={() => setRiskFilter("low")} active={riskFilter === "low"} testId="sit-metric-low" />
        <HeroTile label="Clients affected" value={s.clients_with_findings} icon={Building2} glow="violet" subtitle="With open findings" onClick={() => { setRiskFilter("all"); setSelectedClient(null); }} active={riskFilter === "all" && !selectedClient} testId="sit-metric-clients" />
      </div>

      {loading ? <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-4"><CardContent className="p-0">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div><div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Client policies</div><div className="mt-0.5 text-[11px] text-muted-foreground">Select a client to review or amend its baseline.</div></div>
              <div className="flex items-center gap-1">
                {selectedClient && <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => openBaseline(activeClient)} data-testid="sit-client-baseline"><ClipboardCheck className="mr-1 h-3 w-3" />Baseline</Button>}
                {selectedClient && <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => setSelectedClient(null)} data-testid="sit-clear-client"><X className="mr-1 h-3 w-3" />Clear</Button>}
              </div>
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              {s.per_client.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">No findings - run a scan</div> : s.per_client.map((client) => (
                <button key={client.client_id} type="button" className={`w-full border-b border-border px-4 py-2.5 text-left transition-colors hover:bg-muted/50 ${selectedClient === client.client_id ? "border-l-2 border-l-amber-400 bg-amber-500/[0.06]" : ""}`} onClick={() => setSelectedClient(selectedClient === client.client_id ? null : client.client_id)} data-testid={`sit-client-row-${client.client_id}`}>
                  <div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{client.client_name}</span><span className="font-mono text-xs text-muted-foreground">{client.findings_total}</span></div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {client.by_risk.critical > 0 && <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${RISK_STYLE.critical}`}>{client.by_risk.critical} CRIT</span>}
                    {client.by_risk.high > 0 && <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${RISK_STYLE.high}`}>{client.by_risk.high} HIGH</span>}
                    {client.by_risk.medium > 0 && <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${RISK_STYLE.medium}`}>{client.by_risk.medium} MED</span>}
                    {client.by_risk.low > 0 && <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${RISK_STYLE.low}`}>{client.by_risk.low} LOW</span>}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{client.devices_affected} device{client.devices_affected === 1 ? "" : "s"} affected</div>
                </button>
              ))}
            </div>
          </CardContent></Card>

          <Card className="lg:col-span-8"><CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <div className="relative min-w-[220px] flex-1"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 pl-8 text-xs" placeholder="Filter by application or client..." value={search} onChange={(event) => setSearch(event.target.value)} data-testid="sit-search" /></div>
              <div className="flex flex-wrap gap-1">{["all", "critical", "high", "medium", "low"].map((risk) => <button key={risk} type="button" onClick={() => setRiskFilter(risk)} className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${riskFilter === risk ? "border-amber-500/40 bg-amber-500/15 text-amber-200" : "border-border text-muted-foreground hover:bg-muted"}`} data-testid={`sit-risk-filter-${risk}`}>{risk}</button>)}</div>
              <span className="text-xs text-muted-foreground">{visibleFindings.length} shown</span>
            </div>
            <div className="max-h-[520px] overflow-y-auto"><Table><TableHeader><TableRow><TableHead>Application</TableHead><TableHead>Client</TableHead><TableHead>Risk</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Devices</TableHead><TableHead /></TableRow></TableHeader><TableBody>
              {visibleFindings.length === 0 ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">No findings match the current review filter</TableCell></TableRow> : visibleFindings.map((finding) => (
                <TableRow key={finding.id} data-testid={`sit-finding-row-${finding.id}`}><TableCell><div className="text-sm font-medium">{finding.app}</div><div className="text-[10px] text-muted-foreground">{finding.reason}</div></TableCell><TableCell><Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate(`/clients?client=${encodeURIComponent(finding.client_id)}`)}>{finding.client_name}</Button></TableCell><TableCell><span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${RISK_STYLE[finding.risk] || RISK_STYLE.low}`}>{finding.risk}</span></TableCell><TableCell><Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[finding.category] || finding.category}</Badge></TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" className="h-7 px-2 font-mono text-xs" onClick={() => setDevicesDialog(finding)} data-testid={`sit-devices-btn-${finding.id}`}>{finding.device_count}</Button></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-emerald-400 hover:bg-emerald-500/10" disabled={actioningId === finding.id} onClick={() => act(finding.id, "approve")} data-testid={`sit-approve-${finding.id}`}><Check className="mr-0.5 h-3 w-3" />Approve</Button><Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-sky-300 hover:bg-sky-500/10" disabled={actioningId === finding.id} onClick={() => act(finding.id, "create_ticket")} data-testid={`sit-ticket-${finding.id}`}><TicketIcon className="mr-0.5 h-3 w-3" />Ticket</Button><Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-muted-foreground" disabled={actioningId === finding.id} onClick={() => act(finding.id, "ignore")} data-testid={`sit-ignore-${finding.id}`}><X className="mr-0.5 h-3 w-3" />Ignore</Button></div></TableCell></TableRow>
              ))}
            </TableBody></Table></div>
          </CardContent></Card>

          {s.top_apps.length > 0 && <Card className="lg:col-span-12"><CardContent className="p-0"><div className="border-b border-border px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Fleet patterns</div><div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-5">{s.top_apps.map((app, index) => <div key={`${app.name}-${index}`} className="rounded-lg border border-border bg-muted/20 p-2.5"><div className="flex items-center justify-between gap-2"><div className="truncate text-xs font-medium">{app.name}</div><span className={`rounded border px-1 py-0.5 font-mono text-[9px] uppercase ${RISK_STYLE[app.risk] || RISK_STYLE.low}`}>{app.risk}</span></div><div className="mt-1 text-[10px] text-muted-foreground">{app.devices} devices - {app.findings} client finding{app.findings === 1 ? "" : "s"}</div></div>)}</div></CardContent></Card>}
        </div>
      )}

      <Dialog open={!!devicesDialog} onOpenChange={(open) => !open && setDevicesDialog(null)}><DialogContent className="max-w-lg" data-testid="sit-devices-dialog"><DialogHeader><DialogTitle className="flex items-center gap-2"><Eye className="h-4 w-4 text-sky-300" />{devicesDialog?.app} - {devicesDialog?.device_count} devices</DialogTitle></DialogHeader><div className="max-h-80 overflow-y-auto">{devicesDialog?.devices?.map((device) => <div key={device.id} className="flex items-center justify-between border-b border-border px-2 py-1.5 last:border-0"><div><div className="text-sm">{device.name}</div><div className="text-[10px] text-muted-foreground">{device.os}</div></div><Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-sky-300" onClick={() => navigate(`/devices/${device.id}`)}>Open asset<ExternalLink className="ml-1 h-3 w-3" /></Button></div>)}</div></DialogContent></Dialog>

      <Dialog open={!!baselineDialog} onOpenChange={(open) => !open && setBaselineDialog(null)}><DialogContent className="max-w-xl" data-testid="sit-baseline-dialog"><DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-emerald-300" />Approved software baseline{baselineDialog ? ` - ${baselineDialog.client_name}` : ""}</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-sm text-muted-foreground">Enter one approved application match per line. Matching software is excluded from future Shadow IT review for this client; all baseline edits are recorded in the audit trail.</p><Textarea value={baselineDraft} onChange={(event) => setBaselineDraft(event.target.value)} rows={14} className="font-mono text-xs" placeholder={"Microsoft 365\nNexus Agent\nApproved line-of-business app"} data-testid="sit-baseline-input" /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setBaselineDialog(null)} disabled={baselineSaving}>Cancel</Button><Button onClick={saveBaseline} disabled={baselineSaving}>{baselineSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save baseline</Button></div></div></DialogContent></Dialog>
    </div>
  );
}
