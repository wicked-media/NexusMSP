import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Loader2, Cloud, XCircle, RefreshCw, Users, Link2, Play,
  DollarSign, Plus, Search, Package, Building2, Save
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

export default function Pax8CommandCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("companies");

  const [companies, setCompanies] = useState([]);
  const [subs, setSubs] = useState([]);
  const [billing, setBilling] = useState(null);
  const [clients, setClients] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [search, setSearch] = useState("");
  const [linkDialog, setLinkDialog] = useState(null);   // Pax8 company being linked
  const [linkClientId, setLinkClientId] = useState("");
  const [subsCompanyId, setSubsCompanyId] = useState("");

  // Auto-bill dialog state
  const [autoBillBusy, setAutoBillBusy] = useState(null);
  const [autoBillDialog, setAutoBillDialog] = useState(null);
  const [autoBillFrequency, setAutoBillFrequency] = useState("monthly");

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [cRes, clRes, bRes, sRes] = await Promise.all([
        axios.get(`${API}/pax8/companies`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/pax8/billing/preview`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/settings/pax8`, { headers }).catch(() => ({ data: null })),
      ]);
      setCompanies(cRes.data || []);
      setClients(clRes.data || []);
      setBilling(bRes.data);
      setSettings(sRes.data);
    } catch (e) {
      toast.error("Failed to load Pax8 data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-line */ }, []);

  const fetchSubs = async (companyId = "") => {
    try {
      const res = await axios.get(`${API}/pax8/subscriptions${companyId ? `?company_id=${companyId}` : ""}`, { headers });
      setSubs(res.data || []);
    } catch { setSubs([]); }
  };

  useEffect(() => { if (tab === "subscriptions") fetchSubs(subsCompanyId); /* eslint-disable-line */ }, [tab, subsCompanyId]);

  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await axios.post(`${API}/pax8/sync`, {}, { headers });
      toast.success(`Synced ${res.data.companies} companies · ${res.data.subscriptions} subs · ${res.data.products_cached} new products`);
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const openLinkDialog = (company) => {
    setLinkDialog(company);
    setLinkClientId(company.linked_client_id || "");
  };

  const saveLink = async () => {
    if (!linkDialog || !linkClientId) { toast.error("Pick a client"); return; }
    try {
      await axios.post(`${API}/pax8/companies/${linkDialog.id}/link`, { client_id: linkClientId }, { headers });
      toast.success(`Linked ${linkDialog.name}`);
      setLinkDialog(null);
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Link failed");
    }
  };

  const removeLink = async (company) => {
    if (!window.confirm(`Unlink ${company.name} from ${company.linked_client_name}?`)) return;
    try {
      await axios.delete(`${API}/pax8/companies/${company.id}/link`, { headers });
      toast.success("Unlinked");
      fetchAll();
    } catch { toast.error("Failed"); }
  };

  const handleToggleAutoBill = (clientRow) => {
    if (clientRow.auto_bill_recurring) {
      disableAutoBill(clientRow.client_id);
    } else if ((clientRow.active_recurring_invoices || []).length > 0) {
      enableAutoBill(clientRow.client_id, false);
    } else {
      setAutoBillDialog(clientRow);
      setAutoBillFrequency("monthly");
    }
  };

  const enableAutoBill = async (clientId, createIfMissing) => {
    setAutoBillBusy(clientId);
    try {
      const res = await axios.post(
        `${API}/pax8/billing/client/${clientId}/link-to-recurring`,
        { create_if_missing: createIfMissing, frequency: autoBillFrequency, currency: "AUD" },
        { headers }
      );
      toast.success(res.data.message || "Linked");
      setAutoBillDialog(null);
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link");
    } finally {
      setAutoBillBusy(null);
    }
  };

  const disableAutoBill = async (clientId) => {
    setAutoBillBusy(clientId);
    try {
      const res = await axios.post(`${API}/pax8/billing/client/${clientId}/unlink-recurring`, {}, { headers });
      toast.success(`Auto-bill disabled on ${res.data.disabled_on} recurring invoice(s)`);
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to unlink");
    } finally {
      setAutoBillBusy(null);
    }
  };

  const filteredCompanies = (companies || []).filter(c =>
    !search || (c.name || "").toLowerCase().includes(search.toLowerCase())
  );

  const linkedCount = companies.filter(c => c.linked_client_id).length;
  const unlinkedCount = companies.length - linkedCount;

  if (loading) return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading Pax8...</div>;

  // Not configured state
  if (!settings?.enabled) {
    return (
      <div className="p-6 space-y-5" data-testid="pax8-command-center">
        <OperationalPageHeader
          eyebrow="Cloud distribution"
          title="Pax8"
          description="Connect the Pax8 partner account to synchronise CSP subscriptions, map customers, and keep recurring billing accurate."
          icon={Cloud}
          tone="sky"
          actions={<Badge variant="outline" className="border-amber-500/30 text-amber-300">Configuration required</Badge>}
        />
        <Card className="max-w-2xl border-amber-500/25 bg-amber-500/[0.035]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Cloud className="w-5 h-5 text-indigo-400" />Pax8 Not Configured</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">Connect your Pax8 partner account to sync Microsoft / CSP subscriptions and enable auto-billing on recurring invoices.</p>
            <p className="text-muted-foreground">Go to <strong>Settings → Integrations → Pax8</strong> and enter your Client ID + Client Secret from the Pax8 Partner Portal.</p>
            <Button variant="outline" asChild data-testid="go-to-settings-btn"><Link to="/settings?tab=integrations&anchor=pax8-settings-card"><Save className="mr-1.5 h-3.5 w-3.5" />Open Pax8 settings</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5" data-testid="pax8-command-center">
      <OperationalPageHeader
        eyebrow="Cloud distribution"
        title="Pax8"
        description="Synchronise CSP subscriptions, map Pax8 companies to clients, and keep recurring invoice quantities aligned with real customer usage."
        icon={Cloud}
        tone="sky"
        actions={<>
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-300">{settings?.last_sync_at ? `Synced ${new Date(settings.last_sync_at).toLocaleString()}` : "Ready to sync"}</Badge>
          <Button variant="outline" size="sm" asChild><Link to="/settings?tab=integrations&anchor=pax8-settings-card"><Save className="mr-1.5 h-3.5 w-3.5" />Connection</Link></Button>
          <Button size="sm" onClick={runSync} disabled={syncing} data-testid="pax8-sync-btn">
            {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Sync now
          </Button>
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroTile label="Companies" value={companies.length} icon={Building2} glow="cyan" subtitle="Discovered in Pax8" testId="pax8-metric-companies" />
        <HeroTile label="Linked clients" value={linkedCount} icon={Link2} glow="emerald" subtitle={`${unlinkedCount} awaiting client mapping`} testId="pax8-metric-linked" />
        <HeroTile label="Billable MRR" value={`AUD ${(billing?.grand_total || 0).toFixed(2)}`} icon={DollarSign} glow="sky" subtitle="Subscription billing preview" testId="pax8-metric-mrr" />
        <HeroTile label="Auto-billed" value={(billing?.results || []).filter(r => r.auto_bill_recurring).length} icon={RefreshCw} glow="violet" subtitle="Linked to recurring invoices" testId="pax8-metric-autobilled" />
      </div>

      <div className="space-y-4">

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList data-testid="pax8-tabs">
          <TabsTrigger value="companies"><Users className="w-3 h-3 mr-1" />Companies ({companies.length})</TabsTrigger>
          <TabsTrigger value="subscriptions"><Package className="w-3 h-3 mr-1" />Subscriptions</TabsTrigger>
          <TabsTrigger value="billing"><DollarSign className="w-3 h-3 mr-1" />Billing ({billing?.linked_clients || 0})</TabsTrigger>
        </TabsList>

        {/* === COMPANIES === */}
        <TabsContent value="companies" className="mt-3">
          <Card><CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} data-testid="pax8-company-search" />
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Pax8 Company</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Linked Client</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredCompanies.map(c => (
                  <TableRow key={c.id} data-testid={`pax8-company-${c.id}`}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.city}{c.city && c.country && ", "}{c.country}</TableCell>
                    <TableCell><Badge variant="outline" className={c.status === "Active" ? "text-emerald-400 border-emerald-500/30" : ""}>{c.status || "—"}</Badge></TableCell>
                    <TableCell>
                      {c.linked_client_id ? (
                        <div className="flex items-center gap-2">
                          <Link2 className="w-3 h-3 text-emerald-400" />
                          <span>{c.linked_client_name}</span>
                          {c.auto_bill_recurring && <Badge variant="outline" className="text-[9px] border-sky-500/40 text-sky-400"><RefreshCw className="w-2.5 h-2.5 mr-0.5" />Auto-Bill</Badge>}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not linked</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.linked_client_id ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => openLinkDialog(c)} data-testid={`pax8-change-link-${c.id}`}>Change</Button>
                          <Button size="sm" variant="ghost" className="text-red-400" onClick={() => removeLink(c)}>Unlink</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => openLinkDialog(c)} data-testid={`pax8-link-btn-${c.id}`}>
                          <Link2 className="w-3 h-3 mr-1" />Link
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => { setSubsCompanyId(c.id); setTab("subscriptions"); }} data-testid={`pax8-view-subs-${c.id}`}>
                        <Play className="w-3 h-3 mr-1" />Subs
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredCompanies.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No companies. Click Sync Now.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* === SUBSCRIPTIONS === */}
        <TabsContent value="subscriptions" className="mt-3">
          <Card><CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Select value={subsCompanyId || "all"} onValueChange={v => setSubsCompanyId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-96" data-testid="pax8-subs-company-filter"><SelectValue placeholder="All companies" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All companies</SelectItem>
                  {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">{subs.length} active subscriptions</span>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead>Term</TableHead>
                <TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {subs.filter(s => s.status === "Active").map(s => (
                  <TableRow key={s.id} data-testid={`pax8-sub-${s.id}`}>
                    <TableCell>{s.product_name || s.productId}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.vendor_name || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{s.quantity}</TableCell>
                    <TableCell className="text-right font-mono">{s.currencyCode || "AUD"} {(s.price || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-xs">{s.billingTerm || "Monthly"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-emerald-400 border-emerald-500/30">{s.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {subs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No subscriptions.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* === BILLING === */}
        <TabsContent value="billing" className="mt-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Pax8 Billing Preview — {billing?.period}</span>
                <span className="text-emerald-400">AUD {(billing?.grand_total || 0).toFixed(2)}/mo</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(billing?.results || []).length === 0 && (
                <p className="text-center py-8 text-sm text-muted-foreground">No linked clients with active subscriptions yet. Link some on the Companies tab.</p>
              )}
              {(billing?.results || []).map(r => (
                <div key={r.client_id} className="border rounded-md p-3 space-y-2" data-testid={`pax8-billing-client-${r.client_id}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold flex items-center gap-2">
                        {r.client_name}
                        <Badge variant="outline" className="text-[10px] border-indigo-500/30 text-indigo-400">
                          <Cloud className="w-2.5 h-2.5 mr-0.5" />{r.pax8_company_name}
                        </Badge>
                        {r.auto_bill_recurring && (
                          <Badge variant="outline" className="text-[9px] border-sky-500/40 text-sky-400" data-testid={`pax8-auto-bill-badge-${r.client_id}`}>
                            <RefreshCw className="w-2.5 h-2.5 mr-0.5" />Auto-Billed via Recurring
                          </Badge>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {(r.active_recurring_invoices || []).length > 0
                          ? <>{r.active_recurring_invoices.length} active recurring invoice{r.active_recurring_invoices.length !== 1 ? "s" : ""}</>
                          : <span className="text-amber-400">No active recurring invoice</span>}
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Button
                        size="sm"
                        variant={r.auto_bill_recurring ? "outline" : "default"}
                        className={r.auto_bill_recurring ? "text-sky-400 border-sky-500/40 hover:bg-sky-500/10" : ""}
                        onClick={() => handleToggleAutoBill(r)}
                        disabled={autoBillBusy === r.client_id}
                        data-testid={`pax8-auto-bill-toggle-${r.client_id}`}
                      >
                        {autoBillBusy === r.client_id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : r.auto_bill_recurring ? <XCircle className="w-3 h-3 mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                        {r.auto_bill_recurring ? "Disable Auto-Bill" : "Link to Recurring Invoice"}
                      </Button>
                      <div className="text-right">
                        <p className="text-xl font-bold text-emerald-400">{r.currency} {(r.total || 0).toFixed(2)}</p>
                        <p className="text-[10px] text-muted-foreground">{r.line_items.length} products</p>
                      </div>
                    </div>
                  </div>
                  {r.line_items.length > 0 && (
                    <div className="border-t pt-2 space-y-1">
                      {r.line_items.map((li, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="truncate flex-1">{li.label} <span className="text-muted-foreground">· {li.vendor} · {li.billing_term}</span></span>
                          <span className="font-mono text-muted-foreground mx-2">{li.quantity} × {li.currency} {li.unit_price.toFixed(2)}</span>
                          <span className="font-mono font-semibold w-20 text-right">{li.currency} {li.total.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* LINK CLIENT DIALOG */}
      <Dialog open={!!linkDialog} onOpenChange={v => !v && setLinkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Pax8 Company</DialogTitle>
            <DialogDescription>Map <strong>{linkDialog?.name}</strong> to an internal NexusOps client so subscriptions can flow into recurring invoices.</DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-xs font-medium">NexusOps Client</label>
            <Select value={linkClientId} onValueChange={setLinkClientId}>
              <SelectTrigger data-testid="pax8-link-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDialog(null)}>Cancel</Button>
            <Button onClick={saveLink} data-testid="pax8-save-link-btn"><Link2 className="w-3 h-3 mr-1" />Link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AUTO-BILL CREATE DIALOG */}
      <Dialog open={!!autoBillDialog} onOpenChange={v => !v && setAutoBillDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><RefreshCw className="w-5 h-5 text-sky-400" />Link Pax8 Billing to Recurring Invoice</DialogTitle>
            <DialogDescription>
              {autoBillDialog?.client_name} has no active recurring invoices yet. Create one now so Pax8 subscription usage auto-attaches every period?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="border rounded-md p-3 bg-sky-500/[0.04] border-sky-500/20 text-xs space-y-1">
              <p className="font-semibold">Scaffold summary</p>
              <p className="text-muted-foreground">Client: <span className="text-foreground">{autoBillDialog?.client_name}</span></p>
              <p className="text-muted-foreground">Current Pax8 usage: <span className="text-emerald-400 font-semibold">AUD {(autoBillDialog?.total || 0).toFixed(2)}</span> across {(autoBillDialog?.line_items || []).length} products</p>
            </div>
            <div>
              <label className="text-xs font-medium">Billing Frequency</label>
              <Select value={autoBillFrequency} onValueChange={setAutoBillFrequency}>
                <SelectTrigger data-testid="pax8-auto-bill-frequency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annually">Annually</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAutoBillDialog(null)}>Cancel</Button>
            <Button
              onClick={() => enableAutoBill(autoBillDialog.client_id, true)}
              disabled={autoBillBusy === autoBillDialog?.client_id}
              data-testid="pax8-confirm-auto-bill-create-btn"
            >
              {autoBillBusy === autoBillDialog?.client_id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
              Create & Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
