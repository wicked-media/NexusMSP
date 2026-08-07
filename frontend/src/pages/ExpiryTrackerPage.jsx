import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { AlertTriangle, ExternalLink, Globe, KeyRound, Loader2, LockKeyhole, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

const ENTRY_ENDPOINTS = { licenses: "/licenses", domains: "/domains", ssl: "/ssl-certificates" };
const EMPTY_FORM = { client_id: "", software_name: "", vendor: "", seats: 1, expiry_date: "", domain_name: "", registrar: "", domain: "", issuer: "", certificate_type: "DV", auto_renew: true };

function expiryState(value) {
  if (!value) return "unknown";
  const expiry = new Date(value);
  if (Number.isNaN(expiry.getTime())) return "unknown";
  const days = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring_soon";
  return "active";
}

function ExpiryBadge({ value }) {
  const state = expiryState(value);
  const classes = {
    active: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    expiring_soon: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    expired: "border-rose-500/25 bg-rose-500/10 text-rose-300",
    unknown: "border-border bg-muted/50 text-muted-foreground",
  };
  return <Badge variant="outline" className={`text-[10px] capitalize ${classes[state]}`}>{state.replaceAll("_", " ")}</Badge>;
}

export default function ExpiryTrackerPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [activeTab, setActiveTab] = useState("warranties");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [assets, setAssets] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [domains, setDomains] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [clients, setClients] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async (showToast = false) => {
    setRefreshing(true);
    try {
      const [assetsResponse, licensesResponse, domainsResponse, certificatesResponse, dashboardResponse, clientsResponse] = await Promise.all([
        axios.get(`${API}/assets`, { headers }),
        axios.get(`${API}/licenses`, { headers }),
        axios.get(`${API}/domains`, { headers }),
        axios.get(`${API}/ssl-certificates`, { headers }),
        axios.get(`${API}/expiry-dashboard`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setAssets((assetsResponse.data || []).filter(asset => asset.warranty_expiry || asset.warranty_end));
      setLicenses(licensesResponse.data || []);
      setDomains(domainsResponse.data || []);
      setCertificates(certificatesResponse.data || []);
      setDashboard(dashboardResponse.data || null);
      setClients(clientsResponse.data || []);
      if (showToast) toast.success("Expiry evidence refreshed");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Expiry records could not be loaded");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    if (activeTab === "warranties") return;
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const createEntry = async () => {
    const endpoint = ENTRY_ENDPOINTS[activeTab];
    if (!endpoint) return;
    const required = activeTab === "licenses" ? [form.software_name, form.vendor] : activeTab === "domains" ? [form.domain_name, form.expiry_date] : [form.domain, form.expiry_date];
    if (required.some(value => !String(value || "").trim())) {
      toast.error("Complete the required fields before saving");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}${endpoint}`, { ...form, client_id: form.client_id || null }, { headers });
      toast.success(`${activeTab === "ssl" ? "Certificate" : activeTab.slice(0, -1).replace(/^./, char => char.toUpperCase())} added`);
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Record could not be added");
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (kind, id) => {
    if (!window.confirm("Remove this expiry record? This cannot be undone.")) return;
    try {
      await axios.delete(`${API}${ENTRY_ENDPOINTS[kind]}/${id}`, { headers });
      toast.success("Expiry record removed");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Record could not be removed");
    }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  const stats = dashboard || { warranties: { expiring_soon: 0 }, licenses: { expiring_soon: 0 }, domains: { expiring_soon: 0 }, ssl_certificates: { expiring_soon: 0 }, total_expiring: 0 };
  const tabLabels = { warranties: "Warranties", licenses: "Licences", domains: "Domains", ssl: "SSL certificates" };
  const actionLabel = activeTab === "ssl" ? "Add certificate" : `Add ${activeTab.slice(0, -1)}`;

  return (
    <div className="space-y-5" data-testid="expiry-tracker-page">
      <OperationalPageHeader
        eyebrow="Lifecycle governance"
        title="Expiry Centre"
        description="One accountable view of asset warranties, software renewals, domain renewals, and SSL certificate evidence. Asset warranties are managed on the inventory record itself."
        icon={ShieldCheck}
        tone="amber"
        actions={<><Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh</Button>{activeTab === "warranties" ? <Button size="sm" onClick={() => navigate("/assets")}><ExternalLink className="mr-1 h-4 w-4" />Open inventory</Button> : <Button size="sm" onClick={openCreate}><Plus className="mr-1 h-4 w-4" />{actionLabel}</Button>}</>}
      />

      <MetricStrip columns={5}>
        <MetricTile label="Due within 30 days" value={stats.total_expiring || 0} accent="amber" icon={<AlertTriangle />} testid="expiry-total" />
        <MetricTile label="Tracked warranties" value={assets.length} accent="sky" icon={<ShieldCheck />} testid="expiry-warranties" />
        <MetricTile label="Licence renewals" value={stats.licenses?.expiring_soon || 0} accent="violet" icon={<KeyRound />} testid="expiry-licenses" />
        <MetricTile label="Domain renewals" value={stats.domains?.expiring_soon || 0} accent="emerald" icon={<Globe />} testid="expiry-domains" />
        <MetricTile label="SSL renewals" value={stats.ssl_certificates?.expiring_soon || 0} accent="rose" icon={<LockKeyhole />} testid="expiry-ssl" />
      </MetricStrip>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto flex-wrap justify-start gap-1"><TabsTrigger value="warranties">Asset warranties ({assets.length})</TabsTrigger><TabsTrigger value="licenses">Licences ({licenses.length})</TabsTrigger><TabsTrigger value="domains">Domains ({domains.length})</TabsTrigger><TabsTrigger value="ssl">SSL ({certificates.length})</TabsTrigger></TabsList>

        <TabsContent value="warranties">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 pb-3"><div><CardTitle className="text-base">Asset warranty evidence</CardTitle><p className="mt-1 text-sm text-muted-foreground">Edit warranty details through the corresponding Inventory Asset so serial, ownership, lifecycle, QR labels, and refresh planning remain linked.</p></div><Button variant="outline" size="sm" onClick={() => navigate("/asset-lifecycle")}><ExternalLink className="mr-1 h-4 w-4" />Lifecycle & warranty</Button></CardHeader>
            <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Asset</TableHead><TableHead>Client</TableHead><TableHead>Manufacturer</TableHead><TableHead>Serial</TableHead><TableHead>Warranty end</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{assets.length === 0 ? <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">No inventory assets with a recorded warranty.</TableCell></TableRow> : assets.map(asset => { const expiry = asset.warranty_expiry || asset.warranty_end; return <TableRow key={asset.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/assets/${asset.id}`)}><TableCell><div className="font-medium">{asset.name}</div><div className="font-mono text-[11px] text-muted-foreground">{asset.asset_tag || "No asset tag"}</div></TableCell><TableCell>{asset.client_name || "Unassigned"}</TableCell><TableCell>{asset.manufacturer || "-"}</TableCell><TableCell className="font-mono text-xs">{asset.serial_number || "-"}</TableCell><TableCell>{expiry}</TableCell><TableCell><ExpiryBadge value={expiry} /></TableCell></TableRow>; })}</TableBody></Table></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="licenses"><ExpiryTable rows={licenses} kind="licenses" onDelete={deleteEntry} columns={["Software", "Client", "Vendor", "Seats", "Expiry"]} values={row => [row.software_name, row.client_name, row.vendor, `${row.seats_used || 0}/${row.seats || 0}`, row.expiry_date || "Perpetual"]} /></TabsContent>
        <TabsContent value="domains"><ExpiryTable rows={domains} kind="domains" onDelete={deleteEntry} columns={["Domain", "Client", "Registrar", "Auto renew", "Expiry"]} values={row => [row.domain_name, row.client_name, row.registrar || "-", row.auto_renew ? "Enabled" : "Off", row.expiry_date]} /></TabsContent>
        <TabsContent value="ssl"><ExpiryTable rows={certificates} kind="ssl" onDelete={deleteEntry} columns={["Domain", "Client", "Issuer", "Type", "Expiry"]} values={row => [row.domain, row.client_name, row.issuer || "-", row.certificate_type || "DV", row.expiry_date]} /></TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden border-amber-500/25 bg-[linear-gradient(145deg,rgba(28,20,8,0.98),rgba(13,15,21,0.98))] p-0">
          <DialogHeader className="border-b border-amber-400/15 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_45%),linear-gradient(135deg,rgba(16,185,129,0.07),transparent)] px-6 py-5 pr-14"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Expiry evidence</p><DialogTitle className="mt-1 flex items-center gap-2 text-xl text-zinc-100"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-400/10"><Plus className="h-4 w-4 text-amber-200" /></span>{actionLabel}</DialogTitle><DialogDescription className="mt-2">Record the accountable client, renewal date, and key vendor information. Changes remain in this expiry workspace.</DialogDescription></DialogHeader>
          <div className="space-y-5 px-6 py-5"><div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Client</Label><Select value={form.client_id || "unassigned"} onValueChange={client_id => setForm(current => ({ ...current, client_id: client_id === "unassigned" ? "" : client_id }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned client</SelectItem>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div>
            {activeTab === "licenses" && <div className="grid gap-4 md:grid-cols-2"><Field label="Software name *"><Input value={form.software_name} onChange={event => setForm(current => ({ ...current, software_name: event.target.value }))} placeholder="Microsoft 365 Business Premium" /></Field><Field label="Vendor *"><Input value={form.vendor} onChange={event => setForm(current => ({ ...current, vendor: event.target.value }))} placeholder="Pax8" /></Field><Field label="Seats"><Input type="number" min="1" value={form.seats} onChange={event => setForm(current => ({ ...current, seats: Number(event.target.value) || 1 }))} /></Field><Field label="Renewal date"><Input type="date" value={form.expiry_date} onChange={event => setForm(current => ({ ...current, expiry_date: event.target.value }))} /></Field></div>}
            {activeTab === "domains" && <div className="grid gap-4 md:grid-cols-2"><Field label="Domain name *"><Input value={form.domain_name} onChange={event => setForm(current => ({ ...current, domain_name: event.target.value }))} placeholder="example.com" /></Field><Field label="Registrar"><Input value={form.registrar} onChange={event => setForm(current => ({ ...current, registrar: event.target.value }))} placeholder="Cloudflare" /></Field><Field label="Renewal date *"><Input type="date" value={form.expiry_date} onChange={event => setForm(current => ({ ...current, expiry_date: event.target.value }))} /></Field></div>}
            {activeTab === "ssl" && <div className="grid gap-4 md:grid-cols-2"><Field label="Certificate domain *"><Input value={form.domain} onChange={event => setForm(current => ({ ...current, domain: event.target.value }))} placeholder="*.example.com" /></Field><Field label="Issuer"><Input value={form.issuer} onChange={event => setForm(current => ({ ...current, issuer: event.target.value }))} placeholder="Let's Encrypt" /></Field><Field label="Certificate type"><Select value={form.certificate_type} onValueChange={certificate_type => setForm(current => ({ ...current, certificate_type }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="DV">DV</SelectItem><SelectItem value="OV">OV</SelectItem><SelectItem value="EV">EV</SelectItem><SelectItem value="Wildcard">Wildcard</SelectItem></SelectContent></Select></Field><Field label="Renewal date *"><Input type="date" value={form.expiry_date} onChange={event => setForm(current => ({ ...current, expiry_date: event.target.value }))} /></Field></div>}
          </div>
          <DialogFooter className="border-t border-white/[0.07] bg-black/10 px-6 py-4"><Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button><Button className="bg-amber-400 text-amber-950 hover:bg-amber-300" onClick={createEntry} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save expiry record</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }) { return <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{label}</Label>{children}</div>; }

function ExpiryTable({ rows, kind, columns, values, onDelete }) {
  return <Card><CardContent className="p-0"><Table><TableHeader><TableRow>{columns.map(column => <TableHead key={column}>{column}</TableHead>)}<TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={columns.length + 2} className="py-12 text-center text-muted-foreground">No {kind} records.</TableCell></TableRow> : rows.map(row => { const cells = values(row); const expiry = cells[cells.length - 1]; return <TableRow key={row.id}>{cells.map((cell, index) => <TableCell key={`${row.id}-${columns[index]}`} className={index === 0 ? "font-medium" : "text-sm"}>{cell || "-"}</TableCell>)}<TableCell><ExpiryBadge value={expiry === "Perpetual" ? "" : expiry} /></TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" className="text-rose-300 hover:text-rose-200" onClick={() => onDelete(kind, row.id)}><Trash2 className="h-3.5 w-3.5" /><span className="sr-only">Remove</span></Button></TableCell></TableRow>; })}</TableBody></Table></CardContent></Card>;
}
