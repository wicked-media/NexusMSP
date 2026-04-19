import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Eye, RefreshCw, ShieldAlert, ShieldCheck, AlertTriangle, Bug,
  Ticket as TicketIcon, Check, X, Loader2, Search, Package2
} from "lucide-react";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";

const RISK_STYLE = {
  critical: "text-rose-300 bg-rose-500/15 border-rose-500/40",
  high: "text-orange-300 bg-orange-500/10 border-orange-500/30",
  medium: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  low: "text-zinc-400 bg-zinc-800 border-zinc-700",
};

const CATEGORY_LABEL = {
  file_sharing: "File Sharing", remote_access: "Remote Access", unapproved_vpn: "VPN",
  ai_tool: "AI Tool", messaging: "Messaging", personal_cloud: "Personal Cloud",
  password_manager_personal: "Password Mgr", crypto_mining: "Crypto", torrent_p2p: "Torrent",
  unapproved_backup: "Backup", screen_recorder: "Screen Rec", unapproved: "Unapproved",
};

export default function ShadowItPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [summary, setSummary] = useState(null);
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [devicesDialog, setDevicesDialog] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [sumRes, findRes] = await Promise.all([
        axios.get(`${API}/shadow-it/summary`, { headers }),
        axios.get(`${API}/shadow-it/findings?limit=1000`, { headers }),
      ]);
      setSummary(sumRes.data);
      setFindings(findRes.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const runScan = async () => {
    setScanning(true);
    try {
      const body = selectedClient ? { client_id: selectedClient } : {};
      await axios.post(`${API}/shadow-it/scan`, body, { headers });
      toast.success(`Scan complete${selectedClient ? "" : " across all clients"}`);
      await load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setScanning(false); }
  };

  const seedDemo = async () => {
    if (!window.confirm("Populate demo installed-software on all devices? Safe to re-run.")) return;
    setScanning(true);
    try {
      const res = await axios.post(`${API}/shadow-it/seed-demo`, {}, { headers });
      toast.success(`Seeded ${res.data.devices_seeded} devices — now run a scan`);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setScanning(false); }
  };

  const act = async (id, action) => {
    try {
      await axios.post(`${API}/shadow-it/findings/${id}/${action}`, {}, { headers });
      toast.success({ approve: "Added to baseline", ignore: "Finding ignored", create_ticket: "Security ticket created" }[action]);
      await load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const visibleFindings = findings.filter((f) => {
    if (selectedClient && f.client_id !== selectedClient) return false;
    if (riskFilter !== "all" && f.risk !== riskFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (f.app || "").toLowerCase().includes(s) || (f.client_name || "").toLowerCase().includes(s) || (f.match_name || "").toLowerCase().includes(s);
    }
    return true;
  });

  const s = summary || { total_findings: 0, by_risk: { critical: 0, high: 0, medium: 0, low: 0 }, clients_with_findings: 0, per_client: [], top_apps: [] };

  return (
    <PageShell data-testid="shadow-it-page">
      <MetricStrip columns={6}>
        <MetricTile label="Total Findings" value={s.total_findings} accent="indigo" icon={<ShieldAlert className="w-2.5 h-2.5 text-indigo-400" />} testid="sit-metric-total" />
        <MetricTile label="Critical" value={s.by_risk.critical || 0} accent="rose" icon={<AlertTriangle className="w-2.5 h-2.5 text-rose-400" />} testid="sit-metric-critical" />
        <MetricTile label="High" value={s.by_risk.high || 0} accent="amber" icon={<AlertTriangle className="w-2.5 h-2.5 text-orange-400" />} testid="sit-metric-high" />
        <MetricTile label="Medium" value={s.by_risk.medium || 0} accent="amber" icon={<Bug className="w-2.5 h-2.5 text-amber-400" />} testid="sit-metric-medium" />
        <MetricTile label="Low" value={s.by_risk.low || 0} accent="sky" icon={<Bug className="w-2.5 h-2.5 text-zinc-400" />} testid="sit-metric-low" />
        <MetricTile label="Clients Affected" value={s.clients_with_findings} accent="violet" icon={<ShieldCheck className="w-2.5 h-2.5 text-violet-400" />} testid="sit-metric-clients" />
      </MetricStrip>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Shadow IT Detector</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Unapproved apps across managed endpoints · last scan {s.last_scan?.timestamp ? new Date(s.last_scan.timestamp).toLocaleString() : "never"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={seedDemo} disabled={scanning} data-testid="sit-seed-demo-btn">
              <Package2 className="w-3 h-3 mr-1" />Seed Demo
            </Button>
            <Button size="sm" onClick={runScan} disabled={scanning} data-testid="sit-scan-btn">
              {scanning ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              {selectedClient ? "Scan this client" : "Scan all clients"}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40 text-zinc-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Per-client breakdown */}
            <Card className="lg:col-span-4">
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Clients</div>
                  {selectedClient && (
                    <button className="text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1" onClick={() => setSelectedClient(null)} data-testid="sit-clear-client">
                      <X className="w-3 h-3" />Clear
                    </button>
                  )}
                </div>
                <div className="max-h-[520px] overflow-y-auto">
                  {s.per_client.length === 0 ? (
                    <div className="text-center py-8 text-zinc-500 text-xs">No findings — run a scan</div>
                  ) : s.per_client.map((c) => (
                    <button
                      key={c.client_id}
                      className={`w-full text-left px-4 py-2.5 border-b border-zinc-800 hover:bg-zinc-900/50 transition-colors ${selectedClient === c.client_id ? "bg-indigo-500/10 border-l-2 border-l-indigo-500" : ""}`}
                      onClick={() => setSelectedClient(selectedClient === c.client_id ? null : c.client_id)}
                      data-testid={`sit-client-row-${c.client_id}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">{c.client_name}</span>
                        <span className="font-mono text-xs text-zinc-400">{c.findings_total}</span>
                      </div>
                      <div className="flex gap-1 mt-1">
                        {c.by_risk.critical > 0 && <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${RISK_STYLE.critical}`}>{c.by_risk.critical} CRIT</span>}
                        {c.by_risk.high > 0 && <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${RISK_STYLE.high}`}>{c.by_risk.high} HIGH</span>}
                        {c.by_risk.medium > 0 && <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${RISK_STYLE.medium}`}>{c.by_risk.medium} MED</span>}
                        {c.by_risk.low > 0 && <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${RISK_STYLE.low}`}>{c.by_risk.low} LOW</span>}
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{c.devices_affected} device{c.devices_affected === 1 ? "" : "s"} affected</div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Findings table */}
            <Card className="lg:col-span-8">
              <CardContent className="p-0">
                {/* Filter bar */}
                <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3 flex-wrap">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                    <Input className="pl-8 h-8 text-xs" placeholder="Filter by app or client…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="sit-search" />
                  </div>
                  <div className="flex gap-1">
                    {["all", "critical", "high", "medium", "low"].map((r) => (
                      <button
                        key={r}
                        onClick={() => setRiskFilter(r)}
                        className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded border font-mono ${riskFilter === r ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300" : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"}`}
                        data-testid={`sit-risk-filter-${r}`}
                      >{r}</button>
                    ))}
                  </div>
                </div>

                <div className="max-h-[520px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] uppercase tracking-widest">App</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-widest">Client</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-widest">Risk</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-widest">Category</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-widest text-right">Devices</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleFindings.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-10 text-zinc-500 text-xs">No findings match the filter</TableCell></TableRow>
                      ) : visibleFindings.map((f) => (
                        <TableRow key={f.id} data-testid={`sit-finding-row-${f.id}`}>
                          <TableCell>
                            <div className="font-medium text-sm">{f.app}</div>
                            <div className="text-[10px] text-zinc-500">{f.reason}</div>
                          </TableCell>
                          <TableCell className="text-xs">{f.client_name}</TableCell>
                          <TableCell>
                            <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${RISK_STYLE[f.risk] || RISK_STYLE.low}`}>{f.risk}</span>
                          </TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px] capitalize">{CATEGORY_LABEL[f.category] || f.category}</Badge></TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            <button className="hover:underline" onClick={() => setDevicesDialog(f)} data-testid={`sit-devices-btn-${f.id}`}>{f.device_count}</button>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-emerald-400 hover:bg-emerald-500/10" onClick={() => act(f.id, "approve")} data-testid={`sit-approve-${f.id}`} title="Add to approved baseline">
                                <Check className="w-3 h-3 mr-0.5" />Approve
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-indigo-400 hover:bg-indigo-500/10" onClick={() => act(f.id, "create_ticket")} data-testid={`sit-ticket-${f.id}`} title="Open a security ticket">
                                <TicketIcon className="w-3 h-3 mr-0.5" />Ticket
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-zinc-400 hover:bg-zinc-800" onClick={() => act(f.id, "ignore")} data-testid={`sit-ignore-${f.id}`}>
                                <X className="w-3 h-3 mr-0.5" />Ignore
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Top apps across fleet */}
            {s.top_apps.length > 0 && (
              <Card className="lg:col-span-12">
                <CardContent className="p-0">
                  <div className="px-4 py-3 border-b border-zinc-800 text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
                    Top 10 shadow apps across your fleet
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-3">
                    {s.top_apps.map((a, i) => (
                      <div key={`a-${i}`} className="rounded-lg border border-zinc-800 p-2.5 bg-zinc-950/50">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-medium truncate">{a.name}</div>
                          <span className={`text-[9px] uppercase font-mono px-1 py-0.5 rounded border ${RISK_STYLE[a.risk] || RISK_STYLE.low}`}>{a.risk}</span>
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-1">{a.devices} devices · {a.findings} clients</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Devices dialog */}
      <Dialog open={!!devicesDialog} onOpenChange={() => setDevicesDialog(null)}>
        <DialogContent className="max-w-lg" data-testid="sit-devices-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-indigo-400" />
              {devicesDialog?.app} — {devicesDialog?.device_count} devices
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto">
            {devicesDialog?.devices?.map((d) => (
              <div key={d.id} className="flex items-center justify-between py-1.5 px-2 border-b border-zinc-800 last:border-0">
                <div>
                  <div className="text-sm">{d.name}</div>
                  <div className="text-[10px] text-zinc-500">{d.os}</div>
                </div>
                <a href={`/devices/${d.id}`} className="text-[10px] text-sky-400 hover:underline font-mono">open →</a>
              </div>
            )) || null}
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
