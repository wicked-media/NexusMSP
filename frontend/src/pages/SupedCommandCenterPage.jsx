import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Mail, Shield, RefreshCw, Loader2, ExternalLink, Settings as SettingsIcon,
  CheckCircle2, AlertTriangle, XCircle, TrendingUp,
} from "lucide-react";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";

const SERVICE_ICONS = {
  dmarc_monitoring: "📊",
  hosted_dmarc: "🧭",
  hosted_spf: "📡",
  hosted_mta_sts: "🔒",
  spf_flattening: "🌱",
  blocklist_monitoring: "🚨",
};

export default function SupedCommandCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

  const [dashboard, setDashboard] = useState(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  const [editDialog, setEditDialog] = useState(null);
  const [editSubs, setEditSubs] = useState({ suped_org_id: "", services: {} });
  const [busy, setBusy] = useState(false);

  const [selectedClient, setSelectedClient] = useState(null);
  const [dmarcData, setDmarcData] = useState(null);
  const [loadingDmarc, setLoadingDmarc] = useState(false);
  const [dmarcDays, setDmarcDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, svc] = await Promise.all([
        axios.get(`${API}/suped/compliance-dashboard`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/suped/services`, { headers }).catch(() => ({ data: [] })),
      ]);
      setDashboard(dash.data);
      setServices(svc.data || []);
    } finally { setLoading(false); }
  }, [token]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const openEdit = async (client) => {
    try {
      const r = await axios.get(`${API}/clients/${client.client_id}/subscriptions`, { headers });
      setEditSubs({
        suped_org_id: r.data?.suped_org_id || "",
        services: r.data?.services || {},
      });
      setEditDialog(client);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to load"); }
  };

  const saveEdit = async () => {
    if (!editDialog) return;
    setBusy(true);
    try {
      await axios.put(`${API}/clients/${editDialog.client_id}/subscriptions`, editSubs, { headers });
      toast.success("Subscriptions updated");
      setEditDialog(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const loadDmarc = async (client) => {
    setSelectedClient(client);
    setLoadingDmarc(true);
    try {
      const r = await axios.get(`${API}/clients/${client.client_id}/dmarc-records?days=${dmarcDays}`, { headers });
      setDmarcData(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); setDmarcData({ message: "Failed", records: [] }); }
    finally { setLoadingDmarc(false); }
  };

  const atRisk = dashboard?.at_risk || [];
  const coverage = dashboard?.service_coverage || [];

  return (
    <PageShell data-testid="suped-command-center">
      <MetricStrip columns={5}>
        <MetricTile label="Overall Score" value={`${dashboard?.overall_score ?? 0}%`} accent="fuchsia" icon={<Shield className="w-2.5 h-2.5 text-fuchsia-400" />} testid="suped-metric-score" />
        <MetricTile label="Fully Protected" value={dashboard?.fully_protected ?? 0} accent="emerald" icon={<CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />} testid="suped-metric-fully" />
        <MetricTile label="Partial" value={dashboard?.partially_protected ?? 0} accent="amber" icon={<AlertTriangle className="w-2.5 h-2.5 text-amber-400" />} testid="suped-metric-partial" />
        <MetricTile label="Unprotected" value={dashboard?.unprotected ?? 0} accent="rose" icon={<XCircle className="w-2.5 h-2.5 text-rose-400" />} testid="suped-metric-unprotected" />
        <MetricTile label="Clients" value={dashboard?.total_clients ?? 0} accent="indigo" icon={<Mail className="w-2.5 h-2.5 text-indigo-400" />} testid="suped-metric-clients" />
      </MetricStrip>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Mail className="w-6 h-6 text-fuchsia-400" />Suped Command Center
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              DMARC, SPF, and email authentication coverage across your MSP book.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild data-testid="suped-configure-btn">
              <Link to="/settings?tab=integrations&anchor=suped-settings-card"><SettingsIcon className="w-3 h-3 mr-1" />Settings</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={load} disabled={loading} data-testid="suped-refresh-btn">
              {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="suped-tabs">
            <TabsTrigger value="overview" data-testid="suped-tab-overview"><TrendingUp className="w-3 h-3 mr-1" />Overview</TabsTrigger>
            <TabsTrigger value="clients" data-testid="suped-tab-clients"><Shield className="w-3 h-3 mr-1" />All clients</TabsTrigger>
            <TabsTrigger value="dmarc" data-testid="suped-tab-dmarc"><Mail className="w-3 h-3 mr-1" />DMARC records</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {/* Coverage by service */}
            <Card>
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Service coverage</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {coverage.map((s, i) => {
                    const pct = s.total ? Math.round((s.active / s.total) * 100) : 0;
                    const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
                    return (
                      <div key={i} className="border border-border rounded p-3 bg-muted/10" data-testid={`suped-coverage-${i}`}>
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-medium">{s.name}</div>
                          <span className="text-[10px] font-mono">{s.active}/{s.total}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded overflow-hidden mt-2">
                          <div className={`h-full ${color}`} style={{ width: `${pct}%`, transition: "width 400ms" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* At Risk */}
            <Card>
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  Clients needing attention ({atRisk.length})
                </div>
                {atRisk.length === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">Everyone is fully protected. 🎉</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] uppercase">Client</TableHead>
                        <TableHead className="text-[10px] uppercase">Score</TableHead>
                        <TableHead className="text-[10px] uppercase">Services</TableHead>
                        <TableHead className="text-[10px] uppercase">Suped Org</TableHead>
                        <TableHead className="text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {atRisk.slice(0, 30).map((c) => (
                        <TableRow key={c.client_id} data-testid={`suped-atrisk-${c.client_id}`}>
                          <TableCell className="font-medium text-sm">{c.client_name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={c.score >= 80 ? "text-emerald-400 border-emerald-500/30" : c.score >= 50 ? "text-amber-400 border-amber-500/30" : "text-rose-400 border-rose-500/30"}>
                              {c.score}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{c.active_services}/{c.total_services}</TableCell>
                          <TableCell className="text-[10px] font-mono text-muted-foreground">{c.has_suped ? "linked" : "none"}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => openEdit(c)} data-testid={`suped-edit-${c.client_id}`}>
                              Manage
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="clients">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] uppercase">Client</TableHead>
                      <TableHead className="text-[10px] uppercase">Score</TableHead>
                      <TableHead className="text-[10px] uppercase">Services</TableHead>
                      {services.map(s => <TableHead key={s.key} className="text-[10px] uppercase text-center" title={s.description}>{SERVICE_ICONS[s.key] || "•"}</TableHead>)}
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(dashboard?.client_details || []).map((c) => (
                      <TableRow key={c.client_id} data-testid={`suped-client-${c.client_id}`}>
                        <TableCell className="font-medium text-sm">{c.client_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={c.score === 100 ? "text-emerald-400 border-emerald-500/30" : c.score >= 50 ? "text-amber-400 border-amber-500/30" : "text-rose-400 border-rose-500/30"}>
                            {c.score}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono">{c.active_services}/{c.total_services}</TableCell>
                        {services.map(s => (
                          <TableCell key={s.key} className="text-center">
                            {c.services?.[s.key] ? <CheckCircle2 className="w-3 h-3 text-emerald-400 mx-auto" /> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        ))}
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => openEdit(c)} data-testid={`suped-client-edit-${c.client_id}`}>Manage</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dmarc" className="space-y-4">
            <Card>
              <CardContent className="p-3 flex items-center gap-2 flex-wrap">
                <select
                  value={selectedClient?.client_id || ""}
                  onChange={(e) => {
                    const c = (dashboard?.client_details || []).find(x => x.client_id === e.target.value);
                    if (c) loadDmarc(c);
                  }}
                  className="bg-background border border-border rounded px-2 py-2 text-xs h-9 min-w-[260px]"
                  data-testid="suped-dmarc-client-select"
                >
                  <option value="">Select a client with Suped Org ID…</option>
                  {(dashboard?.client_details || []).filter(c => c.has_suped).map(c => (
                    <option key={c.client_id} value={c.client_id}>{c.client_name}</option>
                  ))}
                </select>
                <select value={dmarcDays} onChange={(e) => setDmarcDays(+e.target.value)} className="bg-background border border-border rounded px-2 py-2 text-xs h-9">
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                </select>
                <Button size="sm" variant="outline" onClick={() => selectedClient && loadDmarc(selectedClient)} disabled={!selectedClient || loadingDmarc} data-testid="suped-dmarc-refresh">
                  {loadingDmarc ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh
                </Button>
              </CardContent>
            </Card>

            {!selectedClient ? (
              <Card><CardContent className="p-12 text-center text-xs text-muted-foreground">Pick a client with a Suped Organization ID to view DMARC records.</CardContent></Card>
            ) : loadingDmarc ? (
              <Card><CardContent className="p-12 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Fetching DMARC records…</CardContent></Card>
            ) : dmarcData?.message && !dmarcData?.records?.length ? (
              <Card><CardContent className="p-6 text-center text-xs text-amber-400">{dmarcData.message}</CardContent></Card>
            ) : (
              <>
                {dmarcData?.summary && (
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">{selectedClient.client_name} — last {dmarcData.summary.period_days} days</div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase text-muted-foreground">Total emails</div>
                          <div className="text-lg font-semibold">{dmarcData.summary.total_emails.toLocaleString()}</div>
                        </div>
                        <div className="rounded border border-emerald-500/30 p-2 bg-emerald-500/5">
                          <div className="text-[10px] uppercase text-emerald-400">Authorized</div>
                          <div className="text-lg font-semibold">{dmarcData.summary.authorized.toLocaleString()}</div>
                        </div>
                        <div className="rounded border border-amber-500/30 p-2 bg-amber-500/5">
                          <div className="text-[10px] uppercase text-amber-400">Quarantined</div>
                          <div className="text-lg font-semibold">{dmarcData.summary.quarantined.toLocaleString()}</div>
                        </div>
                        <div className="rounded border border-rose-500/30 p-2 bg-rose-500/5">
                          <div className="text-[10px] uppercase text-rose-400">Rejected</div>
                          <div className="text-lg font-semibold">{dmarcData.summary.rejected.toLocaleString()}</div>
                        </div>
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase text-muted-foreground">Compliance</div>
                          <div className={`text-lg font-semibold ${dmarcData.summary.compliance_rate >= 95 ? "text-emerald-400" : dmarcData.summary.compliance_rate >= 80 ? "text-amber-400" : "text-rose-400"}`}>
                            {dmarcData.summary.compliance_rate}%
                          </div>
                        </div>
                      </div>
                      {dmarcData.summary.top_sources?.length > 0 && (
                        <div className="mt-4">
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Top sources</div>
                          <div className="flex flex-wrap gap-1">
                            {dmarcData.summary.top_sources.map((s, i) => (
                              <Badge key={i} variant="outline" className="text-[10px]">{s.source}: {s.count.toLocaleString()}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
                {dmarcData?.records?.length > 0 && (
                  <Card>
                    <CardContent className="p-0">
                      <div className="max-h-[50vh] overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[10px] uppercase">Date</TableHead>
                              <TableHead className="text-[10px] uppercase">Source</TableHead>
                              <TableHead className="text-[10px] uppercase">Reporter</TableHead>
                              <TableHead className="text-[10px] uppercase">Domain</TableHead>
                              <TableHead className="text-[10px] uppercase">IP</TableHead>
                              <TableHead className="text-[10px] uppercase">Emails</TableHead>
                              <TableHead className="text-[10px] uppercase">Category</TableHead>
                              <TableHead className="text-[10px] uppercase">SPF</TableHead>
                              <TableHead className="text-[10px] uppercase">DKIM</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {dmarcData.records.slice(0, 100).map((r, i) => (
                              <TableRow key={i} data-testid={`suped-dmarc-row-${i}`}>
                                <TableCell className="text-[10px] font-mono">{r.date ? new Date(r.date).toLocaleDateString() : "—"}</TableCell>
                                <TableCell className="text-xs">{r.source}</TableCell>
                                <TableCell className="text-xs">{r.reporter}</TableCell>
                                <TableCell className="text-xs font-mono">{r.visibleFrom}</TableCell>
                                <TableCell className="text-[10px] font-mono">{r.ipAddress}</TableCell>
                                <TableCell className="text-xs font-mono">{r.emails}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={r.category === "authorized" ? "text-emerald-400 border-emerald-500/30" : r.category === "rejected" ? "text-rose-400 border-rose-500/30" : "text-amber-400 border-amber-500/30"}>
                                    {r.category}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-[10px] font-mono">{r.alignedSpf}</TableCell>
                                <TableCell className="text-[10px] font-mono">{r.alignedDkim}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Subscription Dialog */}
      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent data-testid="suped-edit-dialog">
          <DialogHeader>
            <DialogTitle>Manage Suped services — {editDialog?.client_name}</DialogTitle>
            <DialogDescription>Track which Suped services this client is subscribed to.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Suped Organization ID</Label>
              <Input value={editSubs.suped_org_id} onChange={(e) => setEditSubs({ ...editSubs, suped_org_id: e.target.value })} placeholder="org_xxxxxxxx" data-testid="suped-edit-orgid" />
              <p className="text-[11px] text-muted-foreground mt-1">Found on the Suped dashboard under Organization Settings. Required for DMARC record pulls.</p>
            </div>
            <div>
              <Label>Services</Label>
              <div className="border border-border rounded p-2 space-y-1">
                {services.map(s => (
                  <label key={s.key} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={editSubs.services[s.key] || false}
                      onCheckedChange={(c) => setEditSubs(x => ({ ...x, services: { ...x.services, [s.key]: !!c } }))}
                    />
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground ml-auto">{s.description}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditDialog(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={busy} data-testid="suped-edit-save">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
