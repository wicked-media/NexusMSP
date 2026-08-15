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
import { Globe2, LayoutTemplate, Plus, RefreshCw, ShieldCheck, TriangleAlert, ExternalLink, ServerCog } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const emptySite = { client_id: "", name: "", primary_domain: "", site_url: "", platform: "wordpress", stage: "discovery", hosting_provider: "synergy_wholesale", hosting_identifier: "", wordpress_version: "", php_version: "", owner_name: "", renewal_date: "", notes: "" };
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

  const load = async () => {
    setLoading(true);
    try {
      const [overview, clientResponse] = await Promise.all([
        axios.get(`${API}/web-studio/overview`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setData(overview.data || { sites: [], summary: {}, synergy: {} });
      setClients(clientResponse.data?.clients || clientResponse.data || []);
    } catch (error) { toast.error(error.response?.data?.detail || "Unable to load Web Studio"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sortedSites = useMemo(() => [...(data.sites || [])].sort((a, b) => String(a.client_name).localeCompare(String(b.client_name))), [data.sites]);
  const createSite = async () => {
    if (!form.client_id || !form.name.trim() || !form.primary_domain.trim()) { toast.error("Client, site name and primary domain are required"); return; }
    setWorking(true);
    try {
      await axios.post(`${API}/web-studio/sites`, form, { headers });
      toast.success("Website delivery record created");
      setDialogOpen(false); setForm(emptySite); load();
    } catch (error) { toast.error(error.response?.data?.detail || "Unable to create website record"); }
    finally { setWorking(false); }
  };
  const requestAction = async (site, action) => {
    try {
      const response = await axios.post(`${API}/web-studio/sites/${site.id}/provider-actions`, { action, reason: "Requested from Web Studio" }, { headers });
      toast.success(response.data?.action?.status === "pending_connector" ? "Request saved - Synergy connector still needs configuration" : "Provider action submitted for approval");
    } catch (error) { toast.error(error.response?.data?.detail || "Unable to request provider action"); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><RefreshCw className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  const synergy = data.synergy || {};
  return <div className="space-y-6">
    <OperationalPageHeader eyebrow="Nexus web delivery" title="Web Studio" description="One governed view of client websites, WordPress delivery, hosting, domains and launch readiness." icon={LayoutTemplate} actions={<Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Add website</Button>} />

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <HeroTile label="Websites" value={data.summary?.total || 0} icon={Globe2} glow="sky" subtitle="Client delivery records" />
      <HeroTile label="Live" value={data.summary?.live || 0} icon={ShieldCheck} glow="emerald" subtitle="Published and owned" />
      <HeroTile label="In delivery" value={data.summary?.in_delivery || 0} icon={LayoutTemplate} glow="violet" subtitle="Design through launch" />
      <HeroTile label="Maintenance" value={data.summary?.maintenance || 0} icon={ServerCog} glow="amber" subtitle="Active service work" />
    </div>

    <Card className={synergy.configured ? "border-emerald-500/20" : "border-amber-500/25"}>
      <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3"><div className={`rounded-xl p-2.5 ${synergy.configured ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>{synergy.configured ? <ShieldCheck className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />}</div><div><p className="font-semibold">Synergy Wholesale connector</p><p className="mt-1 text-sm text-muted-foreground">{synergy.configured ? "Server-side credentials are configured. Live provider actions still require Nexus approval and verification." : "Not connected yet. Records and delivery workflows work now; live provider actions remain safely queued."}</p></div></div>
        <Badge variant="outline" className={synergy.configured ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}>{synergy.readiness?.replaceAll("_", " ") || "not configured"}</Badge>
      </CardContent>
    </Card>

    <Card><CardHeader className="border-b border-border/60"><CardTitle className="text-base">Client web portfolio</CardTitle></CardHeader><CardContent className="p-0">
      {sortedSites.length ? <div className="divide-y divide-border/60">{sortedSites.map(site => <div key={site.id} className="flex flex-col gap-4 p-5 transition-colors hover:bg-muted/25 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{site.name}</p><Badge variant="outline" className={stageTone[site.stage] || stageTone.discovery}>{site.stage}</Badge><Badge variant="outline">{site.platform}</Badge></div><p className="mt-1 font-mono text-sm text-cyan-300">{site.primary_domain}</p><p className="mt-1 text-xs text-muted-foreground">{site.client_name} · {site.hosting_provider || "Hosting not recorded"}{site.wordpress_version ? ` · WordPress ${site.wordpress_version}` : ""}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => requestAction(site, "sync_inventory")}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Sync plan</Button>{site.site_url && <Button size="sm" variant="outline" asChild><a href={site.site_url.startsWith("http") ? site.site_url : `https://${site.site_url}`} target="_blank" rel="noreferrer">Open site <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></a></Button>}<Button size="sm" onClick={() => requestAction(site, "temporary_preview")}>Preview workflow</Button></div></div>)}</div> : <div className="p-12 text-center"><Globe2 className="mx-auto h-9 w-9 text-muted-foreground" /><p className="mt-3 font-medium">No websites recorded yet</p><p className="mt-1 text-sm text-muted-foreground">Add a client website to track its domain, hosting and WordPress delivery from discovery to maintenance.</p></div>}
    </CardContent></Card>

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Add client website</DialogTitle><DialogDescription>Create the governed delivery record first. Credentials and provider changes stay outside the browser.</DialogDescription></DialogHeader><div className="grid gap-4 py-2 sm:grid-cols-2"><div className="space-y-2"><Label>Client</Label><Select value={form.client_id} onValueChange={value => setForm({ ...form, client_id: value })}><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger><SelectContent>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Website name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="ABC Plumbing website" /></div><div className="space-y-2"><Label>Primary domain</Label><Input value={form.primary_domain} onChange={e => setForm({ ...form, primary_domain: e.target.value })} placeholder="example.com.au" /></div><div className="space-y-2"><Label>Delivery stage</Label><Select value={form.stage} onValueChange={value => setForm({ ...form, stage: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["discovery", "design", "build", "review", "launch", "live", "maintenance"].map(stage => <SelectItem key={stage} value={stage}>{stage}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Platform</Label><Select value={form.platform} onValueChange={value => setForm({ ...form, platform: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="wordpress">WordPress</SelectItem><SelectItem value="static">Static</SelectItem><SelectItem value="custom">Custom</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Hosting identifier (optional)</Label><Input value={form.hosting_identifier} onChange={e => setForm({ ...form, hosting_identifier: e.target.value })} placeholder="Synergy hosting ID or email" /></div></div><DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={createSite} disabled={working}>{working ? "Saving…" : "Create website record"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
