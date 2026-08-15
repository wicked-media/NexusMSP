import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CreditCard, ExternalLink, Globe2, LayoutTemplate, PackageCheck, Plus, RefreshCw, ServerCog, ShieldCheck, TriangleAlert, Wrench } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const emptySite = { client_id: "", name: "", primary_domain: "", site_url: "", platform: "wordpress", stage: "discovery", hosting_provider: "synergy_wholesale", hosting_identifier: "", service_plan: "", agreement_id: "", billing_status: "not_linked", monthly_fee: 0 };
const stageTone = { discovery: "border-slate-500/30 text-slate-300", design: "border-violet-500/30 text-violet-300", build: "border-cyan-500/30 text-cyan-300", review: "border-amber-500/30 text-amber-300", launch: "border-orange-500/30 text-orange-300", live: "border-emerald-500/30 text-emerald-300", maintenance: "border-blue-500/30 text-blue-300" };

export default function WebStudioPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState({ sites: [], summary: {}, synergy: {} });
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptySite);
  const [working, setWorking] = useState(false);
  const [editingSite, setEditingSite] = useState(null);
  const [managedSite, setManagedSite] = useState(null);
  const [management, setManagement] = useState(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connection, setConnection] = useState({ api_url: "", username: "", application_password: "" });

  const load = async () => {
    setLoading(true);
    try {
      const [overview, clientResponse] = await Promise.all([axios.get(`${API}/web-studio/overview`, { headers }), axios.get(`${API}/clients`, { headers })]);
      setData(overview.data || { sites: [], summary: {}, synergy: {} });
      setClients(clientResponse.data?.clients || clientResponse.data || []);
    } catch (error) { toast.error(error.response?.data?.detail || "Unable to load Web Studio"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sites = useMemo(() => [...(data.sites || [])].sort((a, b) => String(a.client_name).localeCompare(String(b.client_name))), [data.sites]);
  const saveSite = async () => {
    if (!form.client_id || !form.name.trim() || !form.primary_domain.trim()) return toast.error("Client, website name and primary domain are required");
    setWorking(true);
    try { if (editingSite) await axios.patch(`${API}/web-studio/sites/${editingSite.id}`, form, { headers }); else await axios.post(`${API}/web-studio/sites`, form, { headers }); toast.success(editingSite ? "Website and billing details updated" : "Client website created"); setDialogOpen(false); setEditingSite(null); setForm(emptySite); load(); }
    catch (error) { toast.error(error.response?.data?.detail || "Unable to save website"); }
    finally { setWorking(false); }
  };
  const providerAction = async (site, action) => {
    try { await axios.post(`${API}/web-studio/sites/${site.id}/provider-actions`, { action, reason: "Requested from Web Studio" }, { headers }); toast.success("Provider workflow created"); }
    catch (error) { toast.error(error.response?.data?.detail || "Unable to create provider workflow"); }
  };
  const openManagement = async (site) => {
    setManagedSite(site); setManagement(null);
    try { const response = await axios.get(`${API}/web-studio/sites/${site.id}/management`, { headers }); setManagement(response.data); }
    catch (error) { toast.error(error.response?.data?.detail || "Unable to load WordPress management"); }
  };
  const wordpressAction = async (action) => {
    if (!managedSite) return;
    try {
      const response = await axios.post(`${API}/web-studio/sites/${managedSite.id}/wordpress/actions`, { action, reason: action === "inventory" ? "Refresh WordPress inventory from Nexus" : `Requested ${action.replaceAll("_", " ")} from Nexus` }, { headers });
      if (action === "inventory") setManagement({ ...management, inventory: response.data });
      else openManagement(managedSite);
      toast.success(action === "inventory" ? "WordPress inventory refreshed" : "Update workflow submitted for approval");
    } catch (error) { toast.error(error.response?.data?.detail || "Unable to submit WordPress action"); }
  };
  const editSite = site => { setEditingSite(site); setForm({ ...emptySite, ...site }); setDialogOpen(true); };
  const connectWordPress = async () => {
    if (!managedSite) return;
    try { await axios.post(`${API}/web-studio/sites/${managedSite.id}/wordpress/connect`, connection, { headers }); toast.success("WordPress connection stored securely"); setConnectionOpen(false); openManagement(managedSite); }
    catch (error) { toast.error(error.response?.data?.detail || "Unable to connect WordPress site"); }
  };
  const synergy = data.synergy || {};
  if (loading) return <div className="flex h-64 items-center justify-center"><RefreshCw className="h-7 w-7 animate-spin text-cyan-400" /></div>;

  return <div className="space-y-6">
    <OperationalPageHeader eyebrow="Nexus web delivery" title="Web Studio" description="Managed websites, WordPress maintenance, hosting, client ownership and billable web services." icon={LayoutTemplate} actions={<Button onClick={() => { setEditingSite(null); setForm(emptySite); setDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />Add website</Button>} />
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <HeroTile label="Websites" value={data.summary?.total || 0} icon={Globe2} glow="sky" subtitle="Client-linked delivery records" />
      <HeroTile label="Live" value={data.summary?.live || 0} icon={ShieldCheck} glow="emerald" subtitle="Published and owned" />
      <HeroTile label="In delivery" value={data.summary?.in_delivery || 0} icon={LayoutTemplate} glow="violet" subtitle="Design through launch" />
      <HeroTile label="Maintenance" value={data.summary?.maintenance || 0} icon={ServerCog} glow="amber" subtitle="Active service work" />
    </div>
    <Card className={synergy.configured ? "border-emerald-500/20" : "border-amber-500/25"}><CardContent className="flex items-center justify-between gap-4 p-5"><div className="flex items-start gap-3">{synergy.configured ? <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-300" /> : <TriangleAlert className="mt-0.5 h-5 w-5 text-amber-300" />}<div><p className="font-semibold">Synergy Wholesale connector</p><p className="mt-1 text-sm text-muted-foreground">Domains, hosting, certificates and renewals use Nexus approval and audit workflows.</p></div></div><Badge variant="outline">{synergy.catalogue_operations || 0} governed operations</Badge></CardContent></Card>
    <Card><CardHeader className="border-b border-border/60"><CardTitle className="text-base">Client web portfolio</CardTitle></CardHeader><CardContent className="p-0">{sites.length ? <div className="divide-y divide-border/60">{sites.map(site => <div key={site.id} className="flex flex-col gap-4 p-5 transition-colors hover:bg-muted/25 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{site.name}</p><Badge variant="outline" className={stageTone[site.stage] || stageTone.discovery}>{site.stage}</Badge><Badge variant="outline">{site.platform}</Badge>{site.billing_status !== "not_linked" && <Badge variant="outline" className="border-emerald-500/30 text-emerald-300"><CreditCard className="mr-1 h-3 w-3" />{site.billing_status}</Badge>}</div><p className="mt-1 font-mono text-sm text-cyan-300">{site.primary_domain}</p><p className="mt-1 text-xs text-muted-foreground">{site.client_name} · {site.hosting_provider || "Hosting not recorded"}{site.service_plan ? ` · ${site.service_plan}` : ""}</p></div><div className="flex flex-wrap gap-2">{site.platform === "wordpress" && <Button size="sm" onClick={() => openManagement(site)}><Wrench className="mr-1.5 h-3.5 w-3.5" />Manage WordPress</Button>}<Button size="sm" variant="outline" onClick={() => editSite(site)}>Edit</Button><Button size="sm" variant="outline" onClick={() => providerAction(site, "sync_inventory")}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Sync plan</Button>{site.site_url && <Button size="sm" variant="outline" asChild><a href={site.site_url.startsWith("http") ? site.site_url : `https://${site.site_url}`} target="_blank" rel="noreferrer">Open site <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></a></Button>}</div></div>)}</div> : <div className="p-12 text-center"><Globe2 className="mx-auto h-9 w-9 text-muted-foreground" /><p className="mt-3 font-medium">No websites recorded yet</p><p className="mt-1 text-sm text-muted-foreground">Add a client site to start a governed delivery, maintenance and billing record.</p></div>}</CardContent></Card>
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{editingSite ? "Edit client website" : "Add client website"}</DialogTitle><DialogDescription>The client link and billing fields travel with the site throughout its lifecycle.</DialogDescription></DialogHeader><div className="grid gap-4 py-2 sm:grid-cols-2"><div className="space-y-2"><Label>Client</Label><Select value={form.client_id} onValueChange={client_id => setForm({ ...form, client_id })}><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger><SelectContent>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div><Field label="Website name" value={form.name} onChange={name => setForm({ ...form, name })} /><Field label="Primary domain" value={form.primary_domain} onChange={primary_domain => setForm({ ...form, primary_domain })} /><div className="space-y-2"><Label>Delivery stage</Label><Select value={form.stage} onValueChange={stage => setForm({ ...form, stage })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.keys(stageTone).map(stage => <SelectItem key={stage} value={stage}>{stage}</SelectItem>)}</SelectContent></Select></div><Field label="Hosting identifier" value={form.hosting_identifier} onChange={hosting_identifier => setForm({ ...form, hosting_identifier })} /><Field label="Service plan / billing item" value={form.service_plan} onChange={service_plan => setForm({ ...form, service_plan })} /><div className="space-y-2"><Label>Monthly fee</Label><Input type="number" min="0" value={form.monthly_fee} onChange={event => setForm({ ...form, monthly_fee: Number(event.target.value || 0) })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={saveSite} disabled={working}>{working ? "Saving…" : editingSite ? "Save website" : "Create website"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(managedSite)} onOpenChange={open => { if (!open) { setManagedSite(null); setManagement(null); } }}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Wrench className="h-5 w-5 text-cyan-300" />WordPress management · {managedSite?.name}</DialogTitle><DialogDescription>Refresh inventory from a secured connection, then use approval-backed update workflows.</DialogDescription></DialogHeader>{management ? <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Mini title="Connection" value={management.connection?.connected ? "Linked" : "Not linked"} /><Mini title="Billing" value={management.billing?.service_plan || "Not linked"} /><Mini title="Plugins" value={management.inventory?.plugins?.length ?? "—"} /></div><div className="flex flex-wrap gap-2">{!management.connection?.connected && <Button onClick={() => setConnectionOpen(true)}>Link WordPress</Button>}<Button variant="outline" onClick={() => wordpressAction("inventory")}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh inventory</Button><Button variant="outline" onClick={() => wordpressAction("backup_and_update")}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Backup & update</Button><Button variant="outline" onClick={() => wordpressAction("core_update")}>Update core</Button><Button variant="outline" onClick={() => wordpressAction("plugin_update")}>Update plugins</Button></div><div className="rounded-xl border border-border/70"><div className="border-b border-border/70 px-4 py-3 text-sm font-medium">Plugin inventory</div>{management.inventory?.plugins?.length ? management.inventory.plugins.map(plugin => <div key={plugin.plugin} className="flex items-center justify-between border-b border-border/50 px-4 py-3 text-sm last:border-0"><span>{plugin.name || plugin.plugin}</span><span className="text-muted-foreground">{plugin.version || "Version unavailable"}</span></div>) : <p className="p-4 text-sm text-muted-foreground">Link a secure WordPress application password through the site connection workflow, then refresh inventory.</p>}</div></div> : <div className="py-10 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto h-5 w-5 animate-spin" />Loading workspace…</div>}<DialogFooter><Button variant="outline" onClick={() => { setManagedSite(null); setManagement(null); }}>Close</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={connectionOpen} onOpenChange={setConnectionOpen}><DialogContent><DialogHeader><DialogTitle>Link WordPress management</DialogTitle><DialogDescription>Use a dedicated WordPress Application Password. Nexus encrypts it server-side and never shows it again.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="WordPress URL" value={connection.api_url} onChange={api_url => setConnection({ ...connection, api_url })} /><Field label="WordPress username" value={connection.username} onChange={username => setConnection({ ...connection, username })} /><div className="space-y-2"><Label>Application password</Label><Input type="password" value={connection.application_password} onChange={event => setConnection({ ...connection, application_password: event.target.value })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setConnectionOpen(false)}>Cancel</Button><Button onClick={connectWordPress}>Link securely</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Field({ label, value, onChange }) { return <div className="space-y-2"><Label>{label}</Label><Input value={value} onChange={event => onChange(event.target.value)} /></div>; }
function Mini({ title, value }) { return <Card><CardContent className="p-3"><PackageCheck className="h-4 w-4 text-cyan-300" /><p className="mt-2 text-xs text-muted-foreground">{title}</p><p className="font-medium">{value}</p></CardContent></Card>; }
