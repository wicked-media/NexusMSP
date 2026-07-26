import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import SetupGuideCallout from "@/components/SetupGuideCallout";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, Building2, CheckCircle2, Cloud, CreditCard, ExternalLink,
  Loader2, Phone, Plus, RefreshCw, Search, Settings, Users, Wifi, WifiOff,
} from "lucide-react";

const VOICE_TABS = ["dashboard", "pbxs", "extensions", "billing", "sync", "activity", "diagnostics"];
const emptyPbxForm = {
  client_id: "", name: "", pbx_url: "", client_api_id: "", client_secret: "",
  billing_policy: "all_enabled", agreement_mapping: "", product_mapping: "",
  auto_sync_schedule: "daily", automatic_billing: false, approval_threshold: 0,
  tls_validation: true, notifications: true, enabled: true,
};

const compactDate = (value) => value ? new Date(value).toLocaleString() : "Not yet";
const readable = (value) => String(value || "unknown").replaceAll("_", " ");

export default function VoiceWorkspacePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [workspace, setWorkspace] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [query, setQuery] = useState("");
  const [registration, setRegistration] = useState("all");
  const [busy, setBusy] = useState("");
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [showAddPbx, setShowAddPbx] = useState(false);
  const [editingPbx, setEditingPbx] = useState(null);
  const [pbxForm, setPbxForm] = useState(emptyPbxForm);

  const clientScope = searchParams.get("clientId") || "";
  const openAddPbx = () => {
    setPbxForm({ ...emptyPbxForm, client_id: clientScope });
    setShowAddPbx(true);
  };

  useEffect(() => {
    const requested = searchParams.get("tab");
    if (VOICE_TABS.includes(requested)) setTab(requested);
  }, [searchParams]);

  const updateRoute = (nextTab = tab, nextClientId = clientScope) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", nextTab);
    if (nextClientId) params.set("clientId", nextClientId);
    else params.delete("clientId");
    setSearchParams(params, { replace: true });
    setTab(nextTab);
  };

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const [{ data: voice }, { data: clientRows }, { data: productRows }] = await Promise.all([
        axios.get(`${API}/yeastar/voice-workspace`, { headers }),
        axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/products`, { headers }).catch(() => ({ data: [] })),
      ]);
      setWorkspace(voice);
      setClients(clientRows || []);
      setProducts(productRows || []);
    } catch {
      toast.error("Could not load Voice services");
    } finally {
      setBusy("");
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const runSync = async (pbxId = "") => {
    const action = pbxId ? `sync-${pbxId}` : "sync";
    setBusy(action);
    try {
      const { data } = await axios.post(`${API}/yeastar/sync`, pbxId ? { pbx_id: pbxId } : {}, { headers });
      const failures = data.failed_pbxs?.length ? ` ${data.failed_pbxs.length} PBX needs attention.` : "";
      toast.success(`Sync complete: ${data.extensions_processed} extensions processed.${failures}`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Sync failed");
    } finally {
      setBusy("");
    }
  };

  const testConnection = async (pbxId) => {
    if (!pbxId) return;
    setBusy(`test-${pbxId}`);
    try {
      const { data } = await axios.get(`${API}/yeastar/test-connection`, { headers, params: { pbx_id: pbxId } });
      data.success ? toast.success(data.message) : toast.error(data.message);
      await load();
    } catch {
      toast.error("Connection test failed");
    } finally {
      setBusy("");
    }
  };

  const testScopedPbxs = async (pbxs) => {
    const testable = pbxs.filter((pbx) => pbx.has_credentials);
    if (!testable.length) {
      toast.error("Add a PBX URL, Client ID, and Client Secret before testing.");
      return;
    }
    setBusy("test-all");
    try {
      const results = await Promise.all(testable.map((pbx) => axios.get(`${API}/yeastar/test-connection`, { headers, params: { pbx_id: pbx.id } })));
      const passed = results.filter((result) => result.data?.success).length;
      passed === testable.length ? toast.success(`${passed} PBX connection${passed === 1 ? "" : "s"} verified`) : toast.warning(`${passed} of ${testable.length} PBX connections verified`);
      await load();
    } catch {
      toast.error("One or more PBX connection tests failed");
      await load();
    } finally {
      setBusy("");
    }
  };

  const recalculate = async () => {
    setBusy("billing");
    try {
      const { data } = await axios.post(`${API}/yeastar/billing/recalculate`, {}, { headers });
      toast.success(`Billing snapshot captured for ${data.pbx_count} PBX${data.pbx_count === 1 ? "" : "s"}`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Billing recalculation failed");
    } finally {
      setBusy("");
    }
  };

  const enableRecurringBilling = async (row) => {
    if (!row.client_id) return;
    setBusy(`billing-${row.pbx_id}`);
    try {
      const { data } = await axios.post(`${API}/yeastar/billing/client/${row.client_id}/link-to-recurring`, {}, { headers });
      const count = data.recurring_invoice_ids?.length || 0;
      toast.success(count ? `Extension usage linked to ${count} recurring invoice${count === 1 ? "" : "s"}` : "Recurring billing is ready once a recurring invoice is added");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not enable recurring billing");
    } finally {
      setBusy("");
    }
  };

  const updateExtension = async (extension, patch) => {
    const extensionKey = extension.override_key || extension.number;
    try {
      await axios.put(`${API}/yeastar/extensions/${encodeURIComponent(extension.number)}/override`, { ...patch, extension_key: extensionKey }, { headers });
      toast.success(`Extension ${extension.number} updated`);
      await load();
    } catch {
      toast.error("Could not update extension");
    }
  };

  const addPbx = async () => {
    if (!pbxForm.client_id || !pbxForm.name.trim() || !pbxForm.pbx_url.trim() || !pbxForm.client_api_id.trim() || !pbxForm.client_secret) {
      toast.error("Choose a client and enter the PBX name, URL, Client ID, and Client Secret");
      return;
    }
    setBusy("add-pbx");
    try {
      const { data } = await axios.post(`${API}/yeastar/pbxs`, pbxForm, { headers });
      toast.success(`PBX connected and linked: ${data.extension_count || 0} extensions discovered`);
      setShowAddPbx(false);
      setPbxForm({ ...emptyPbxForm });
      updateRoute("pbxs", pbxForm.client_id);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not add PBX");
    } finally {
      setBusy("");
    }
  };

  const openPbxSettings = (pbx) => setEditingPbx({ ...pbx, pbx_url: pbx.pbx_url || pbx.url || "", client_secret: "" });

  const savePbxSettings = async () => {
    if (!editingPbx?.name?.trim() || !editingPbx?.pbx_url?.trim()) {
      toast.error("Enter a PBX name and Cloud URL");
      return;
    }
    setBusy("save-pbx");
    try {
      await axios.put(`${API}/yeastar/pbxs/${editingPbx.id}`, editingPbx, { headers });
      toast.success("PBX settings saved");
      setEditingPbx(null);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not save PBX settings");
    } finally {
      setBusy("");
    }
  };

  if (!workspace) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-sky-300" /></div>;

  const allPbxs = workspace.pbxs || [];
  const pbxs = clientScope ? allPbxs.filter((pbx) => pbx.client_id === clientScope) : allPbxs;
  const allExtensions = workspace.extensions || [];
  const scopedExtensions = clientScope ? allExtensions.filter((extension) => extension.client_id === clientScope) : allExtensions;
  const visibleExtensions = scopedExtensions.filter((extension) => {
    const matchesQuery = `${extension.number} ${extension.name} ${extension.device} ${extension.pbx_name}`.toLowerCase().includes(query.toLowerCase());
    const matchesRegistration = registration === "all" || (registration === "registered" ? extension.registered : !extension.registered);
    return matchesQuery && matchesRegistration;
  });
  const billingRows = (workspace.billing?.by_pbx || []).filter((row) => !clientScope || row.client_id === clientScope);
  const selectedClient = clients.find((client) => client.id === clientScope);
  const onlinePbxs = pbxs.filter((pbx) => pbx.status === "online").length;
  const attentionPbxs = pbxs.filter((pbx) => ["offline", "authentication_failed", "pending_configuration"].includes(pbx.status)).length;
  const failed = (workspace.sync_history || []).filter((entry) => entry.status === "failed" && (!clientScope || entry.client_id === clientScope)).length;
  const billable = scopedExtensions.filter((extension) => extension.included_in_billing).length;

  return <div className="space-y-5" data-testid="voice-workspace-page">
    <OperationalPageHeader
      eyebrow="Voice services"
      title={selectedClient ? `${selectedClient.name} voice` : "Voice"}
      description={selectedClient ? "Client-scoped PBXs, live extensions, and recurring billing controls." : "Client-linked PBX operations, extension governance, and recurring billing control. Yeastar is the first voice provider."}
      icon={Phone}
      tone="sky"
      actions={<>
        <Button variant="outline" size="sm" onClick={() => navigate("/help/voice-yeastar-pbx-onboarding")} disabled={!!busy} data-testid="voice-open-setup-guide"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Setup guide</Button>
        <Button variant="outline" size="sm" onClick={() => testScopedPbxs(pbxs)} disabled={!!busy} data-testid="voice-test-connection"><Wifi className="mr-1.5 h-3.5 w-3.5" />Test PBXs</Button>
        <Button variant="outline" size="sm" onClick={() => runSync()} disabled={!!busy} data-testid="voice-sync"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy === "sync" ? "animate-spin" : ""}`} />Sync now</Button>
        <Button size="sm" onClick={openAddPbx} disabled={!!busy} data-testid="voice-add-pbx"><Plus className="mr-1.5 h-3.5 w-3.5" />Add PBX</Button>
      </>}
    />

    <MetricStrip columns={6}>
      <MetricTile label={selectedClient ? "Client PBXs" : "Total PBXs"} value={pbxs.length} icon={Phone} accent="sky" testid="voice-metric-pbxs" />
      <MetricTile label="Online PBXs" value={onlinePbxs} icon={Cloud} accent="cyan" testid="voice-metric-online-pbxs" />
      <MetricTile label="Extensions" value={scopedExtensions.length} icon={Users} accent="cyan" testid="voice-metric-extensions" />
      <MetricTile label="Billable" value={billable} icon={CreditCard} accent="emerald" testid="voice-metric-billable" />
      <MetricTile label="Needs attention" value={attentionPbxs} icon={AlertTriangle} accent={attentionPbxs ? "amber" : "emerald"} testid="voice-metric-pending" />
      <MetricTile label="Failed syncs" value={failed} icon={WifiOff} accent={failed ? "rose" : "emerald"} testid="voice-metric-failed" />
    </MetricStrip>

    <Card className="overflow-hidden border-cyan-500/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.18),rgba(15,23,42,0.42))]" data-testid="voice-architecture-card">
      <CardContent className="grid gap-4 p-4 lg:grid-cols-[1.2fr_repeat(3,minmax(0,1fr))] lg:items-center">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Client-to-billing workflow</p><p className="mt-1 text-sm text-muted-foreground">Every P-Series PBX connects directly to its client record. Credentials, extension quantities, product mapping, and billing audit stay isolated to that account.</p></div>
        {[['1', 'Enable PBX API', 'Copy the Client ID and Secret from Integrations > API on the PBX.'], ['2', 'Test & link', 'Nexus verifies the live PBX before saving a single client record.'], ['3', 'Approve billing', 'Review discovered extensions, product mapping, and recurring billing.']].map(([number, title, copy]) => <div className="flex gap-3" key={number}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-xs font-semibold text-cyan-200">{number}</span><div><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{copy}</p></div></div>)}
      </CardContent>
    </Card>

    <Tabs value={tab} onValueChange={(next) => updateRoute(next)}>
      <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border/50 bg-card/70 p-1.5 sm:w-fit">
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger><TabsTrigger value="pbxs">PBXs ({pbxs.length})</TabsTrigger><TabsTrigger value="extensions">Extensions ({scopedExtensions.length})</TabsTrigger><TabsTrigger value="billing">Billing</TabsTrigger><TabsTrigger value="sync">Sync history</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger><TabsTrigger value="diagnostics">API diagnostics</TabsTrigger>
      </TabsList>

      <TabsContent value="dashboard" className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="border-sky-500/20 lg:col-span-2"><CardHeader><CardTitle className="text-sm">Direct PBX health</CardTitle><CardDescription>Connection readiness is measured from client-owned P-Series API credentials, never a shared provider credential.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 p-4"><div className="flex items-center gap-3"><div className={`flex h-10 w-10 items-center justify-center rounded-lg ${workspace.provider?.connected ? "bg-emerald-500/10" : "bg-amber-500/10"}`}><Cloud className={`h-5 w-5 ${workspace.provider?.connected ? "text-emerald-300" : "text-amber-300"}`} /></div><div><p className="font-semibold">Yeastar P-Series OpenAPI</p><p className="text-xs text-muted-foreground">{workspace.provider?.connected ? "Client PBX connections are ready for live checks" : "Add a client PBX to begin managed voice operations"}</p></div></div><Badge variant="outline" className={workspace.provider?.connected ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}>{readable(workspace.system_health)}</Badge></div><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-border/60 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last successful sync</p><p className="mt-1 text-sm font-medium">{workspace.last_successful_sync ? compactDate(workspace.last_successful_sync) : "Not yet synchronised"}</p></div><div className="rounded-lg border border-border/60 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Client linkage</p><p className="mt-1 text-sm font-medium">{allPbxs.length} client PBX{allPbxs.length === 1 ? "" : "s"}</p></div><div className="rounded-lg border border-border/60 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Billing review</p><p className="mt-1 text-sm font-medium">{(workspace.billing?.pending_changes || 0)} change{(workspace.billing?.pending_changes || 0) === 1 ? "" : "s"} pending</p></div></div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Recent activity</CardTitle></CardHeader><CardContent className="space-y-3">{(workspace.sync_history || []).slice(0, 4).map((entry) => <div className="flex gap-2 text-xs" key={entry.id}><Activity className={`mt-0.5 h-3.5 w-3.5 ${entry.status === "success" ? "text-emerald-300" : "text-rose-300"}`} /><div><p className="font-medium">{entry.pbx_name || "Yeastar PBX"} · {readable(entry.status)}</p><p className="text-muted-foreground">{entry.completed_at ? compactDate(entry.completed_at) : "In progress"}</p></div></div>)}{!workspace.sync_history?.length && <div className="space-y-3 py-1"><p className="text-sm text-muted-foreground">No PBX activity yet.</p><Button size="sm" className="w-full" onClick={openAddPbx}><Plus className="mr-2 h-3.5 w-3.5" />Add first client PBX</Button></div>}</CardContent></Card>
      </TabsContent>

      <TabsContent value="pbxs" className="mt-4 space-y-3">
        <VoiceScopeBar clients={clients} clientScope={clientScope} onChange={(clientId) => updateRoute("pbxs", clientId)} selectedClient={selectedClient} />
        <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Customer / PBX</TableHead><TableHead>PBX URL</TableHead><TableHead>Status</TableHead><TableHead>Extensions</TableHead><TableHead>Billing</TableHead><TableHead>Last sync</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{pbxs.map((pbx) => <TableRow key={pbx.id}><TableCell><button className="text-left" onClick={() => navigate(`/clients?client=${encodeURIComponent(pbx.client_id)}`)}><p className="font-medium hover:text-cyan-300">{pbx.client_name}</p><p className="text-xs text-muted-foreground">{pbx.name}</p></button></TableCell><TableCell className="max-w-56 truncate font-mono text-xs">{pbx.url || "Not configured"}</TableCell><TableCell><StatusBadge status={pbx.status} /></TableCell><TableCell>{pbx.extension_count || 0}</TableCell><TableCell>{pbx.billable_extension_count || 0} billable</TableCell><TableCell className="text-xs">{compactDate(pbx.last_sync)}</TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => testConnection(pbx.id)} disabled={!!busy || !pbx.has_credentials}><Wifi className="mr-1 h-3.5 w-3.5" />Test</Button><Button variant="outline" size="sm" onClick={() => runSync(pbx.id)} disabled={!!busy || !pbx.has_credentials}><RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy === `sync-${pbx.id}` ? "animate-spin" : ""}`} />Sync</Button><Button variant="ghost" size="sm" onClick={() => openPbxSettings(pbx)} disabled={!!busy}><Settings className="mr-1 h-3.5 w-3.5" />Edit</Button></div></TableCell></TableRow>)}{!pbxs.length && <TableRow><TableCell colSpan={7} className="py-12 text-center"><p className="text-sm text-muted-foreground">No PBXs are linked in this view.</p><Button size="sm" className="mt-3" onClick={openAddPbx}><Plus className="mr-2 h-3.5 w-3.5" />Link a client PBX</Button></TableCell></TableRow>}</TableBody></Table></CardContent></Card>
      </TabsContent>

      <TabsContent value="extensions" className="mt-4 space-y-3"><VoiceScopeBar clients={clients} clientScope={clientScope} onChange={(clientId) => updateRoute("extensions", clientId)} selectedClient={selectedClient} /><div className="flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search extension, person, device, or PBX" data-testid="voice-extension-search" /></div><Select value={registration} onValueChange={setRegistration}><SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All registration</SelectItem><SelectItem value="registered">Registered</SelectItem><SelectItem value="unregistered">Unregistered</SelectItem></SelectContent></Select></div><Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Extension</TableHead><TableHead>PBX</TableHead><TableHead>Type</TableHead><TableHead>Registered</TableHead><TableHead>Billing</TableHead><TableHead>Discovered</TableHead><TableHead className="text-right">Override</TableHead></TableRow></TableHeader><TableBody>{visibleExtensions.map((extension) => <TableRow key={extension.id || extension.override_key || extension.number}><TableCell><p className="font-medium">{extension.number} · {extension.name}</p><p className="text-xs text-muted-foreground">{extension.enabled ? "Enabled" : "Disabled"}{extension.exclusion_reason ? ` · ${extension.exclusion_reason}` : ""}</p></TableCell><TableCell className="max-w-40 truncate text-xs text-muted-foreground">{extension.pbx_name || "Yeastar PBX"}</TableCell><TableCell className="text-xs">{extension.device || "-"}</TableCell><TableCell><Badge variant="outline" className={extension.registered ? "border-emerald-500/30 text-emerald-300" : "border-border/60 text-muted-foreground"}>{extension.registered ? "Registered" : "Offline"}</Badge></TableCell><TableCell><Switch checked={extension.included_in_billing} onCheckedChange={(checked) => updateExtension(extension, { exclude_from_billing: !checked, exclusion_reason: checked ? "" : "Manual billing exclusion" })} /></TableCell><TableCell className="text-xs text-muted-foreground">{extension.first_discovered ? new Date(extension.first_discovered).toLocaleDateString() : "-"}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => updateExtension(extension, { enabled: !extension.enabled })}>{extension.enabled ? "Disable" : "Enable"}</Button></TableCell></TableRow>)}{!visibleExtensions.length && <TableRow><TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">No extensions match this view. Sync after configuring the client PBX.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>

      <TabsContent value="billing" className="mt-4 space-y-4"><VoiceScopeBar clients={clients} clientScope={clientScope} onChange={(clientId) => updateRoute("billing", clientId)} selectedClient={selectedClient} /><div className="grid gap-4 lg:grid-cols-3"><Card className="lg:col-span-2"><CardHeader><CardTitle className="text-sm">Extension billing controls</CardTitle><CardDescription>Each PBX is billed against its own client and product mapping. Live extension quantities are attached only after you enable recurring billing.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3"><BillingMetric label="Current billable" value={billable} /><BillingMetric label="Previous snapshot" value={clientScope ? billingRows.reduce((sum, row) => sum + (row.previous_quantity || 0), 0) : workspace.billing?.previous_quantity || 0} /><BillingMetric label="Pending change" value={billingRows.reduce((sum, row) => sum + (row.pending_changes || 0), 0)} /><div className="sm:col-span-3 flex flex-wrap items-center gap-2"><Button onClick={recalculate} disabled={!!busy}><CreditCard className="mr-2 h-4 w-4" />Capture billing snapshot</Button><p className="text-xs text-muted-foreground">A product mapping must point to an active NexusMSP product with a unit price before automatic attachment is enabled.</p></div></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Snapshot history</CardTitle></CardHeader><CardContent className="space-y-3">{(workspace.billing?.history || []).filter((item) => !clientScope || item.client_id === clientScope).slice(0, 6).map((item) => <div className="flex justify-between text-xs" key={item.id}><span>{new Date(item.created_at).toLocaleDateString()}</span><span className="font-medium">{item.billable_quantity} extensions</span></div>)}{!(workspace.billing?.history || []).length && <p className="text-sm text-muted-foreground">No snapshots yet.</p>}</CardContent></Card></div><Card><CardHeader><CardTitle className="text-sm">Client billing map</CardTitle><CardDescription>Review the client, agreement, product, live count, and recurring-billing state before any invoice is generated.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Client / PBX</TableHead><TableHead>Live billable</TableHead><TableHead>Change</TableHead><TableHead>Agreement</TableHead><TableHead>Product mapping</TableHead><TableHead>Recurring billing</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{billingRows.map((row) => <TableRow key={row.pbx_id}><TableCell><p className="font-medium">{row.client_name}</p><p className="text-xs text-muted-foreground">{row.pbx_name}</p></TableCell><TableCell>{row.current_quantity}</TableCell><TableCell className={row.pending_changes ? "text-amber-300" : "text-muted-foreground"}>{row.pending_changes ? `${row.pending_changes} pending` : "No change"}</TableCell><TableCell className="text-xs">{row.agreement_mapping || "Not mapped"}</TableCell><TableCell className="max-w-48 truncate text-xs">{row.product_mapping || "Product ID required"}</TableCell><TableCell><Badge variant="outline" className={row.automatic_billing ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}>{row.automatic_billing ? "Enabled" : "Review required"}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => navigate(`/recurring-invoices?clientId=${encodeURIComponent(row.client_id)}`)}><ExternalLink className="mr-1 h-3.5 w-3.5" />Recurring</Button><Button size="sm" onClick={() => enableRecurringBilling(row)} disabled={!!busy || !row.product_mapping} title={row.product_mapping ? "Attach live extension usage to this client's active recurring invoice" : "Set a Product ID on the PBX first"}>{busy === `billing-${row.pbx_id}` && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Link billing</Button></div></TableCell></TableRow>)}{!billingRows.length && <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Link a PBX to a client before mapping extension billing.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>

      <TabsContent value="sync" className="mt-4"><Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>PBX</TableHead><TableHead>Started</TableHead><TableHead>Outcome</TableHead><TableHead>Duration</TableHead><TableHead>API latency</TableHead><TableHead>Extensions</TableHead><TableHead>Error detail</TableHead></TableRow></TableHeader><TableBody>{(workspace.sync_history || []).filter((entry) => !clientScope || entry.client_id === clientScope).map((entry) => <TableRow key={entry.id}><TableCell className="max-w-40 truncate text-xs font-medium">{entry.pbx_name || "Yeastar PBX"}</TableCell><TableCell className="text-xs">{compactDate(entry.started_at)}</TableCell><TableCell><StatusBadge status={entry.status} /></TableCell><TableCell>{entry.duration_ms ?? "-"} ms</TableCell><TableCell>{entry.api_latency_ms ?? "-"} ms</TableCell><TableCell>{entry.extensions_processed ?? "-"}</TableCell><TableCell className="max-w-64 truncate text-xs text-muted-foreground">{entry.error || "-"}</TableCell></TableRow>)}{!(workspace.sync_history || []).filter((entry) => !clientScope || entry.client_id === clientScope).length && <TableRow><TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">No sync activity recorded for this view.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>

      <TabsContent value="activity" className="mt-4"><Card><CardHeader><CardTitle className="text-sm">Voice activity audit</CardTitle><CardDescription>Every synchronisation records the PBX, client, outcome, duration, and error detail.</CardDescription></CardHeader><CardContent className="space-y-3">{(workspace.sync_history || []).filter((entry) => !clientScope || entry.client_id === clientScope).slice(0, 10).map((entry) => <div className="flex items-center gap-3 rounded-lg border border-border/60 p-3" key={entry.id}><CheckCircle2 className={`h-4 w-4 ${entry.status === "success" ? "text-emerald-300" : "text-rose-300"}`} /><div><p className="text-sm font-medium">{entry.pbx_name || "Yeastar PBX"} synchronisation {readable(entry.status)}</p><p className="text-xs text-muted-foreground">{entry.completed_at ? compactDate(entry.completed_at) : compactDate(entry.started_at)}</p></div></div>)}{!(workspace.sync_history || []).length && <p className="text-sm text-muted-foreground">Actions and synchronisations will appear here for audit review.</p>}</CardContent></Card></TabsContent>

      <TabsContent value="diagnostics" className="mt-4 grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-sm">Connection diagnostics</CardTitle><CardDescription>Credentials stay hidden; this view shows only operational readiness.</CardDescription></CardHeader><CardContent className="space-y-3">{pbxs.map((pbx) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-3" key={pbx.id}><div><p className="text-sm font-medium">{pbx.client_name} · {pbx.name}</p><p className="mt-0.5 max-w-lg truncate font-mono text-xs text-muted-foreground">{pbx.url || "Cloud URL missing"}</p></div><div className="flex items-center gap-2"><StatusBadge status={pbx.status} /><Button size="sm" variant="outline" onClick={() => testConnection(pbx.id)} disabled={!!busy || !pbx.has_credentials}><Wifi className="mr-1 h-3.5 w-3.5" />Test</Button></div></div>)}{!pbxs.length && <p className="text-sm text-muted-foreground">Add a client PBX to expose connection diagnostics.</p>}</CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Recent API outcomes</CardTitle></CardHeader><CardContent className="space-y-3">{(workspace.sync_history || []).filter((entry) => !clientScope || entry.client_id === clientScope).slice(0, 5).map((entry) => <div className="flex items-center justify-between rounded-lg border border-border/60 p-3" key={entry.id}><div><p className="text-sm font-medium capitalize">{entry.status}</p><p className="text-xs text-muted-foreground">{entry.extensions_processed ?? 0} extensions · {entry.token_refreshes ?? 0} token refreshes</p></div><div className="text-right text-xs text-muted-foreground"><p>{entry.api_latency_ms ?? "-"} ms latency</p><p>{entry.duration_ms ?? "-"} ms total</p></div></div>)}{!(workspace.sync_history || []).length && <p className="text-sm text-muted-foreground">Run a sync to collect API latency and token-refresh diagnostics.</p>}</CardContent></Card></TabsContent>

    </Tabs>

    <Dialog open={!!editingPbx} onOpenChange={(open) => { if (!open) setEditingPbx(null); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>PBX configuration</DialogTitle><DialogDescription>Maintain one customer connection, billing mapping, and safeguards. Leave Client Secret blank to retain the securely stored value.</DialogDescription></DialogHeader>{editingPbx && <PbxForm form={editingPbx} setForm={setEditingPbx} clients={clients} products={products} editing />}<DialogFooter><Button variant="ghost" onClick={() => setEditingPbx(null)}>Cancel</Button><Button onClick={savePbxSettings} disabled={busy === "save-pbx"}>{busy === "save-pbx" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save PBX configuration</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={showAddPbx} onOpenChange={setShowAddPbx}><DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Test and link a Yeastar PBX</DialogTitle><DialogDescription>Choose the client first. NexusMSP will verify the live P-Series API, discover extensions, and save one client-scoped connection only after the test succeeds.</DialogDescription></DialogHeader><SetupGuideCallout title="Where do these credentials come from?" source="In the customer’s Yeastar P-Series PBX portal, enable Integrations → API, then copy the Client ID and Client Secret. Enter the base PBX URL only—NexusMSP adds the OpenAPI path." securityNote="Store the Client Secret only in NexusMSP; never put it in a ticket, client note, or chat." helpSlug="voice-yeastar-pbx-onboarding" /><PbxForm form={pbxForm} setForm={setPbxForm} clients={clients} products={products} /><DialogFooter><Button variant="ghost" onClick={() => setShowAddPbx(false)} disabled={busy === "add-pbx"}>Cancel</Button><Button onClick={addPbx} disabled={busy === "add-pbx"}>{busy === "add-pbx" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{busy === "add-pbx" ? "Testing PBX…" : "Test & link PBX"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function VoiceScopeBar({ clients, clientScope, onChange, selectedClient }) {
  return <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-cyan-300" /><div><p className="text-sm font-medium">{selectedClient ? `${selectedClient.name} scope` : "All client PBXs"}</p><p className="text-xs text-muted-foreground">Filter without leaving the Voice workspace.</p></div></div><Select value={clientScope || "all"} onValueChange={(value) => onChange(value === "all" ? "" : value)}><SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="All clients" /></SelectTrigger><SelectContent><SelectItem value="all">All clients</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div>;
}

function BillingMetric({ label, value }) {
  return <div className="rounded-lg border p-3"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}

function StatusBadge({ status }) {
  const healthy = ["online", "success", "verified"].includes(status);
  const pending = ["pending_configuration", "unknown"].includes(status);
  return <Badge variant="outline" className={healthy ? "border-emerald-500/30 text-emerald-300" : pending ? "border-amber-500/30 text-amber-300" : "border-rose-500/30 text-rose-300"}>{readable(status)}</Badge>;
}

function PbxForm({ form, setForm, clients, products = [], editing = false }) {
  const update = (patch) => setForm({ ...form, ...patch });
  const [productSearch, setProductSearch] = useState("");
  const selectedProduct = products.find((product) => product.id === form.product_mapping);
  const productRate = (product) => Number(product?.retail_price || product?.unit_price || product?.price || product?.selling_price || 0);
  const productLabelSafe = (product) => [product.name || "Unnamed product", product.sku].filter(Boolean).join(" / ");
  const matchingProducts = productSearch.trim() ? products.filter((product) => `${product.name || ""} ${product.sku || ""} ${product.id || ""}`.toLowerCase().includes(productSearch.trim().toLowerCase())).slice(0, 8) : [];

  return <div className="space-y-4 voice-pbx-form">
    <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Client</Label><Select value={form.client_id || ""} onValueChange={(client_id) => update({ client_id })}><SelectTrigger data-testid="voice-pbx-client"><SelectValue placeholder="Choose client" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label>PBX name</Label><Input value={form.name || ""} onChange={(event) => update({ name: event.target.value })} placeholder="Main office PBX" data-testid="voice-pbx-name" /></div></div>
    <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>PBX base URL / FQDN</Label><Input value={form.pbx_url || ""} onChange={(event) => update({ pbx_url: event.target.value })} placeholder="https://pbx.customer.example" data-testid="voice-pbx-url" /><p className="text-[11px] text-muted-foreground">Use the PBX web address only. If you paste an OpenAPI path, NexusMSP safely reduces it to the base URL.</p></div><div className="space-y-1.5"><Label>Sync schedule</Label><Select value={form.auto_sync_schedule || "daily"} onValueChange={(auto_sync_schedule) => update({ auto_sync_schedule })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent></Select></div></div>
    <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>PBX API Client ID</Label><Input value={form.client_api_id || ""} onChange={(event) => update({ client_api_id: event.target.value })} placeholder="From PBX Integrations > API" autoComplete="off" data-testid="voice-pbx-client-id" /></div><div className="space-y-1.5"><Label>PBX API Client Secret</Label><Input type="password" value={form.client_secret || ""} onChange={(event) => update({ client_secret: event.target.value })} placeholder={editing ? "Leave blank to retain" : "From PBX Integrations > API"} autoComplete="new-password" data-testid="voice-pbx-client-secret" /></div></div>
    <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Billing policy</Label><Select value={form.billing_policy || "all_enabled"} onValueChange={(billing_policy) => update({ billing_policy })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all_enabled">All enabled extensions</SelectItem><SelectItem value="registered_only">Registered extensions only</SelectItem></SelectContent></Select></div><div className="space-y-1.5"><Label>Agreement mapping</Label><Input value={form.agreement_mapping || ""} onChange={(event) => update({ agreement_mapping: event.target.value })} placeholder="Contract or agreement reference" /></div></div>
    <div className="space-y-1.5"><Label>Recurring billing product</Label><div className="relative"><Input value={productSearch || (selectedProduct ? productLabelSafe(selectedProduct) : form.product_mapping || "")} onChange={(event) => { setProductSearch(event.target.value); update({ product_mapping: "" }); }} placeholder="Search by product name, SKU, or product ID" data-testid="voice-product-autocomplete" />{productSearch && <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-popover p-1 shadow-xl">{matchingProducts.length ? matchingProducts.map((product) => <button type="button" key={product.id} className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { update({ product_mapping: product.id }); setProductSearch(""); }}><span className="min-w-0 truncate font-medium">{productLabelSafe(product)}</span><span className="shrink-0 text-xs text-muted-foreground">{productRate(product) > 0 ? `$${productRate(product).toFixed(2)}` : "No price"}</span></button>) : <p className="px-3 py-2 text-xs text-muted-foreground">No NexusMSP product matches that search.</p>}</div>}</div>{selectedProduct ? <p className={`text-xs ${productRate(selectedProduct) > 0 ? "text-emerald-300" : "text-amber-300"}`}>Mapped to {productLabelSafe(selectedProduct)}{productRate(selectedProduct) > 0 ? ` at $${productRate(selectedProduct).toFixed(2)} per extension` : " - add a unit price before enabling recurring billing."}</p> : <p className="text-xs text-muted-foreground">Search and choose the billable NexusMSP product. A priced product is required before live extension quantities can attach to recurring billing.</p>}</div>
    <div className="grid gap-3 sm:grid-cols-3"><SwitchSetting label="Enable connection" checked={form.enabled !== false} onCheckedChange={(enabled) => update({ enabled })} /><SwitchSetting label="Validate TLS" checked={form.tls_validation !== false} onCheckedChange={(tls_validation) => update({ tls_validation })} /><SwitchSetting label="Notify on changes" checked={form.notifications !== false} onCheckedChange={(notifications) => update({ notifications })} /></div>
  </div>;
}

function SwitchSetting({ label, checked, onCheckedChange }) {
  return <div className="flex items-center justify-between rounded-lg border p-3"><Label>{label}</Label><Switch checked={checked} onCheckedChange={onCheckedChange} /></div>;
}
