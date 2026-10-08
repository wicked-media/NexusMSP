import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Archive, BadgeCheck, CheckCircle2, CreditCard, ExternalLink,
  Globe2, LayoutTemplate, Loader2, PackageCheck, Plus, RefreshCw, ServerCog,
  Settings2, ShieldCheck, TriangleAlert, Wrench, Activity, ShieldAlert,
  ArrowUpCircle, Hammer, ListChecks,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import HeroTile from "@/components/HeroTile";
import {
  attentionQueue, fleetTiles, planStatusLabel, planStatusTone, pluginRows,
  policyLabel, preflightSummary, riskTone, updatePlanItem, vulnerableSiteCount,
} from "@/lib/webStudioFleet";

const emptySite = {
  client_id: "", name: "", primary_domain: "", site_url: "", platform: "wordpress",
  stage: "discovery", hosting_provider: "synergy_wholesale", hosting_identifier: "",
  wordpress_version: "", php_version: "", owner_name: "", renewal_date: "",
  service_plan: "", agreement_id: "", billing_status: "not_linked", monthly_fee: 0,
  last_backup_at: "", backup_status: "unknown", update_policy: "manual", notes: "",
};

const stageTone = {
  discovery: "border-slate-500/30 text-slate-300", design: "border-violet-500/30 text-violet-300",
  build: "border-cyan-500/30 text-cyan-300", review: "border-amber-500/30 text-amber-300",
  launch: "border-orange-500/30 text-orange-300", live: "border-emerald-500/30 text-emerald-300",
  maintenance: "border-blue-500/30 text-blue-300",
};

const billingTone = {
  billable: "border-emerald-500/30 text-emerald-300", included: "border-sky-500/30 text-sky-300",
  suspended: "border-amber-500/30 text-amber-300", not_linked: "border-zinc-500/30 text-muted-foreground",
};

const readable = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value) => value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";

export default function WebStudioPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState({ sites: [], summary: {}, synergy: {} });
  const [fleet, setFleet] = useState({ summary: {}, sites: [] });
  const [plugins, setPlugins] = useState([]);
  const [plans, setPlans] = useState([]);
  const [planWorking, setPlanWorking] = useState("");
  const [clients, setClients] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptySite);
  const [working, setWorking] = useState(false);
  const [editingSite, setEditingSite] = useState(null);
  const [archivingSite, setArchivingSite] = useState(null);
  const [managedSite, setManagedSite] = useState(null);
  const [management, setManagement] = useState(null);
  const [managementLoading, setManagementLoading] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connection, setConnection] = useState({ api_url: "", username: "", application_password: "" });
  const [wordpressWorking, setWordpressWorking] = useState("");
  const [wordpressTarget, setWordpressTarget] = useState("");
  const [healthChecking, setHealthChecking] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!token) return;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [overview, fleetResponse, pluginResponse, clientResponse, contractsResponse] = await Promise.all([
        axios.get(`${API}/web-studio/overview`, { headers }),
        axios.get(`${API}/web-studio/fleet`, { headers }).catch(() => ({ data: { summary: {}, sites: [] } })),
        axios.get(`${API}/web-studio/plugins`, { headers }).catch(() => ({ data: { plugins: [] } })),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/contracts`, { headers }),
      ]);
      setData(overview.data || { sites: [], summary: {}, synergy: {} });
      setFleet(fleetResponse.data || { summary: {}, sites: [] });
      setPlugins(pluginResponse.data?.plugins || []);
      setClients(clientResponse.data?.clients || clientResponse.data || []);
      setContracts(contractsResponse.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load Web Studio");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers, token]);

  useEffect(() => { load(); }, [load]);

  const sites = useMemo(
    () => [...(data.sites || [])].sort((a, b) => String(a.client_name || "").localeCompare(String(b.client_name || ""))),
    [data.sites],
  );
  const clientContracts = useMemo(
    () => contracts.filter((contract) => contract.client_id === form.client_id && contract.status === "active"),
    [contracts, form.client_id],
  );

  const openCreate = () => {
    setEditingSite(null);
    setForm(emptySite);
    setDialogOpen(true);
  };

  const editSite = (site) => {
    setEditingSite(site);
    setForm({ ...emptySite, ...site, renewal_date: String(site.renewal_date || "").slice(0, 10) });
    setDialogOpen(true);
  };

  const saveSite = async () => {
    if (!form.client_id || !form.name.trim() || !form.primary_domain.trim()) {
      toast.error("Client, website name and primary domain are required");
      return;
    }
    setWorking(true);
    try {
      if (editingSite) await axios.patch(`${API}/web-studio/sites/${editingSite.id}`, form, { headers });
      else await axios.post(`${API}/web-studio/sites`, form, { headers });
      toast.success(editingSite ? "Website record, delivery and billing details updated" : "Client website created");
      setDialogOpen(false);
      setEditingSite(null);
      setForm(emptySite);
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to save website");
    } finally {
      setWorking(false);
    }
  };

  const archiveSite = async () => {
    if (!archivingSite) return;
    setWorking(true);
    try {
      await axios.delete(`${API}/web-studio/sites/${archivingSite.id}`, { headers });
      toast.success("Website record archived. Provider and audit evidence remain retained.");
      setArchivingSite(null);
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to archive website");
    } finally {
      setWorking(false);
    }
  };

  const providerAction = async (site, action) => {
    try {
      const response = await axios.post(`${API}/web-studio/sites/${site.id}/provider-actions`, {
        action,
        reason: "Requested from the governed Web Studio workflow",
      }, { headers });
      const status = response.data?.action?.status;
      toast.success(status === "pending_connector" ? "Sync plan retained until the Synergy connector is configured" : "Provider workflow created for review");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to create provider workflow");
    }
  };

  const openManagement = async (site) => {
    setManagedSite(site);
    setManagement(null);
    setPlans([]);
    setManagementLoading(true);
    try {
      const [response, planResponse] = await Promise.all([
        axios.get(`${API}/web-studio/sites/${site.id}/management`, { headers }),
        axios.get(`${API}/web-studio/sites/${site.id}/update-plans`, { headers }).catch(() => ({ data: { plans: [] } })),
      ]);
      setManagement(response.data);
      setPlans(planResponse.data?.plans || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load WordPress management");
    } finally {
      setManagementLoading(false);
    }
  };

  const refreshManagement = async () => {
    if (managedSite) await openManagement(managedSite);
  };

  const createUpdatePlan = async () => {
    if (!managedSite) return;
    const rows = (management?.inventory?.plugins || []).filter((plugin) => plugin.update_available);
    if (!rows.length) {
      toast.error("No plugin updates are recorded for this site. Refresh inventory first.");
      return;
    }
    setPlanWorking("create");
    try {
      const response = await axios.post(`${API}/web-studio/sites/${managedSite.id}/update-plans`, {
        items: rows.map(updatePlanItem),
        policy: managedSite.update_policy || "manual",
        reason: "Safe Update Engine plan created from the current plugin inventory",
      }, { headers });
      setPlans((current) => [response.data, ...current]);
      const summary = preflightSummary(response.data?.preflight);
      toast[summary.passed ? "success" : "warning"](summary.passed
        ? `Update plan ready for approval (${rows.length} item${rows.length === 1 ? "" : "s"})`
        : `Update plan blocked: ${summary.headline}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to create the update plan");
    } finally {
      setPlanWorking("");
    }
  };

  const approveUpdatePlan = async (plan) => {
    setPlanWorking(plan.id);
    try {
      const response = await axios.post(`${API}/web-studio/update-plans/${plan.id}/approve`, {}, { headers });
      setPlans((current) => current.map((row) => (row.id === plan.id ? { ...row, ...response.data, status: response.data.status } : row)));
      const execution = response.data?.execution || {};
      toast.success(execution.allowed
        ? "Approved. This low-risk plan may run under the policy-driven limits."
        : execution.reason || "Approved. A technician performs this update.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to approve the update plan");
      await refreshManagement();
    } finally {
      setPlanWorking("");
    }
  };

  const queueUpdatePlan = async (plan) => {
    setPlanWorking(`queue-${plan.id}`);
    try {
      const response = await axios.post(`${API}/web-studio/update-plans/${plan.id}/execute`, {}, { headers });
      setPlans((current) => current.map((row) => (row.id === plan.id ? { ...row, status: response.data.status } : row)));
      toast.success(response.data?.message || "Plan queued for the WordPress control worker.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to queue the update plan");
    } finally {
      setPlanWorking("");
    }
  };

  const connectWordPress = async () => {
    if (!managedSite) return;
    if (!connection.api_url.trim() || !connection.username.trim() || !connection.application_password) {
      toast.error("WordPress URL, username and Application Password are required");
      return;
    }
    setWordpressWorking("connect");
    try {
      await axios.post(`${API}/web-studio/sites/${managedSite.id}/wordpress/connect`, connection, { headers });
      toast.success("WordPress connection stored securely");
      setConnectionOpen(false);
      setConnection({ api_url: "", username: "", application_password: "" });
      await refreshManagement();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to connect WordPress site");
    } finally {
      setWordpressWorking("");
    }
  };

  const wordpressAction = async (action) => {
    if (!managedSite) return;
    if (["plugin_update", "theme_update"].includes(action) && !wordpressTarget.trim()) {
      toast.error("Enter the WordPress plugin or theme path before requesting that update");
      return;
    }
    setWordpressWorking(action);
    try {
      const response = await axios.post(`${API}/web-studio/sites/${managedSite.id}/wordpress/actions`, {
        action,
        target: wordpressTarget.trim(),
        reason: action === "inventory"
          ? "Refresh WordPress inventory from Nexus"
          : `Requested ${readable(action)} from the governed Web Studio workflow`,
      }, { headers });
      if (action === "inventory") {
        setManagement((current) => ({ ...current, inventory: response.data }));
        toast.success("WordPress inventory refreshed");
      } else {
        toast.success("WordPress update plan submitted for approval");
        setWordpressTarget("");
        await refreshManagement();
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to submit WordPress action");
    } finally {
      setWordpressWorking("");
    }
  };

  const healthCheck = async (site = managedSite) => {
    if (!site) return;
    setHealthChecking(site.id);
    try {
      const response = await axios.post(`${API}/web-studio/sites/${site.id}/health-check`, {}, { headers });
      if (site.id === managedSite?.id) setManagement((current) => ({ ...current, health: response.data }));
      await load({ quiet: true });
      toast.success(response.data.status === "healthy" ? "Website is responding" : "Website health needs attention");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to run website health check");
    } finally {
      setHealthChecking("");
    }
  };

  const synergy = data.synergy || {};
  const tiles = fleetTiles(fleet.summary);
  const queue = attentionQueue(fleet.summary, fleet.sites);
  const pluginIntel = pluginRows(plugins);
  if (loading) return <div className="flex h-64 items-center justify-center"><RefreshCw className="h-7 w-7 animate-spin text-cyan-400" /></div>;

  return <div className="space-y-6">
    <OperationalPageHeader
      eyebrow="Nexus web delivery"
      title="Web Studio"
      description="Client-owned websites, domains, WordPress maintenance, hosting and billable delivery—kept in one governed record."
      icon={LayoutTemplate}
      actions={<>
        <Button variant="outline" onClick={() => load({ quiet: true })} disabled={refreshing}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh
        </Button>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add website</Button>
      </>}
    />

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="web-studio-fleet-summary">
      {tiles.map((tile) => (
        <HeroTile
          key={tile.key}
          label={tile.label}
          value={tile.unassessed ? "—" : tile.value}
          animated={!tile.unassessed}
          icon={tile.key === "security" ? ShieldAlert : tile.key === "updates" ? ArrowUpCircle : tile.key === "backups" ? ServerCog : Globe2}
          glow={tile.glow}
          subtitle={tile.subtitle}
          testId={`fleet-tile-${tile.key}`}
        />
      ))}
    </div>
    {(!fleet.summary?.assessed?.plugins || !fleet.summary?.assessed?.backups) && (
      <p className="text-xs leading-5 text-muted-foreground" data-testid="web-studio-fleet-unassessed">
        Nexus only counts what it has evidence for. Link a secured WordPress connection and record a backup window to move an unassessed dimension into a verified count.
      </p>
    )}

    <Card className={synergy.configured ? "border-emerald-500/20 bg-emerald-500/[0.025]" : "border-amber-500/25 bg-amber-500/[0.025]"} data-testid="web-studio-synergy-status">
      <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          {synergy.configured ? <BadgeCheck className="mt-0.5 h-5 w-5 text-emerald-300" /> : <TriangleAlert className="mt-0.5 h-5 w-5 text-amber-300" />}
          <div>
            <p className="font-semibold">Synergy Wholesale connector</p>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              {synergy.configured
                ? "Provider credentials are configured. Read work, purchases, renewals, DNS and certificate changes remain governed by Nexus scope, approval and audit controls."
                : "Web records are usable now, but Nexus will not synchronise, purchase, renew or change provider services until Synergy is configured and source-IP allowlisting is complete."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={synergy.configured ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}>{synergy.configured ? "Configured" : "Setup required"}</Badge>
          <Badge variant="outline">{synergy.catalogue_operations || 0} governed operations</Badge>
          <Button size="sm" variant="outline" asChild>
            <Link to="/settings?tab=integrations&anchor=synergy-wholesale-settings-card"><Settings2 className="mr-1.5 h-3.5 w-3.5" />{synergy.configured ? "Review connector" : "Connect Synergy"}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>

    {queue.length > 0 && (
      <Card data-testid="web-studio-attention-queue">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-amber-300" />Attention queue</CardTitle>
          <CardDescription>Sites that need a technician before they need anything else, with the evidence behind each call.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/60">
            {queue.map((entry) => (
              <div key={entry.site_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{entry.site?.name || entry.site_id}</p>
                    <Badge variant="outline" className={entry.tone.className}>{entry.tone.label}</Badge>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {entry.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
                {entry.site?.platform === "wordpress" && (
                  <Button size="sm" variant="outline" onClick={() => openManagement(entry.site)}>
                    <Wrench className="mr-1.5 h-3.5 w-3.5" />Open in Web Studio
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )}

    <Card data-testid="web-studio-plugin-intelligence">
      <CardHeader className="border-b border-border/60">
        <CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="h-4 w-4 text-cyan-300" />Plugin intelligence</CardTitle>
        <CardDescription>Every plugin Nexus has seen across the scoped fleet, worst first. A plugin is only called vulnerable when a finding is recorded against it.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {pluginIntel.length ? (
          <div className="divide-y divide-border/60">
            {pluginIntel.slice(0, 25).map((plugin) => (
              <div key={plugin.plugin} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{plugin.name || plugin.plugin}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{plugin.plugin}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{plugin.sites_installed} site{plugin.sites_installed === 1 ? "" : "s"}</Badge>
                  <Badge variant="outline" className={plugin.sites_with_updates ? "border-amber-500/30 text-amber-300" : "border-emerald-500/30 text-emerald-300"}>
                    {plugin.sites_with_updates} update{plugin.sites_with_updates === 1 ? "" : "s"}
                  </Badge>
                  {plugin.security_findings > 0 && (
                    <Badge variant="outline" className="border-rose-500/30 text-rose-300" data-testid={`plugin-findings-${plugin.plugin}`}>
                      {plugin.security_findings} finding{plugin.security_findings === 1 ? "" : "s"} · {vulnerableSiteCount(plugin)} site{vulnerableSiteCount(plugin) === 1 ? "" : "s"}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-muted-foreground">Licence {plugin.licence_status || "unknown"}</Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-6 text-sm leading-6 text-muted-foreground">No plugin inventory has been synced yet. Link a secured WordPress connection on a site, then refresh its inventory to populate fleet intelligence.</p>
        )}
      </CardContent>
    </Card>

    <Card data-testid="web-studio-portfolio">
      <CardHeader className="border-b border-border/60">
        <CardTitle className="text-base">Client web portfolio</CardTitle>
        <CardDescription>Each record carries the owner, service, delivery stage and evidence needed to support the site safely.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {sites.length ? <div className="divide-y divide-border/60">
          {sites.map((site) => <SiteRow
            key={site.id}
            site={site}
            healthChecking={healthChecking === site.id}
            onEdit={() => editSite(site)}
            onArchive={() => setArchivingSite(site)}
            onHealth={() => healthCheck(site)}
            onManage={() => openManagement(site)}
            onPlanSync={() => providerAction(site, "sync_inventory")}
          />)}
        </div> : <div className="p-12 text-center">
          <Globe2 className="mx-auto h-9 w-9 text-muted-foreground" />
          <p className="mt-3 font-medium">Start with the customer’s website record</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Nexus will carry the client link, delivery state, credentials boundary and billing context from design through ongoing maintenance.</p>
          <Button className="mt-5" onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" />Add first website</Button>
        </div>}
      </CardContent>
    </Card>

    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!working) setDialogOpen(open); }}>
      <NexusWorkflowDialog
        eyebrow="Web delivery workflow"
        title={editingSite ? "Edit client website" : "Create client website"}
        description="Create one canonical record for ownership, launch delivery, WordPress maintenance and billable web services. Client ownership remains stable after creation so historical service and approval evidence keeps its meaning."
        icon={LayoutTemplate}
        tone="violet"
        className="max-w-4xl"
        footer={<><Button variant="outline" onClick={() => setDialogOpen(false)} disabled={working}>Cancel</Button><Button onClick={saveSite} disabled={working}>{working && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{editingSite ? "Save website record" : "Create website record"}</Button></>}
      >
        <div className="space-y-7">
          <WorkflowSection number="01" title="Ownership & public identity" description="Anchor the website to the client before work, credentials or billing are attached.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Client</Label><Select value={form.client_id} disabled={Boolean(editingSite)} onValueChange={(client_id) => setForm((current) => ({ ...current, client_id, agreement_id: "" }))}><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select>{editingSite && <p className="text-xs text-muted-foreground">To move a site between clients, archive this record and create a new owned record. This protects billing and audit history.</p>}</div>
              <TextField label="Website name" value={form.name} onChange={(name) => setForm((current) => ({ ...current, name }))} placeholder="e.g. Northwind customer portal" />
              <TextField label="Primary domain" value={form.primary_domain} onChange={(primary_domain) => setForm((current) => ({ ...current, primary_domain }))} placeholder="example.com.au" />
              <TextField label="Public site URL" value={form.site_url} onChange={(site_url) => setForm((current) => ({ ...current, site_url }))} placeholder="https://www.example.com.au" type="url" />
            </div>
          </WorkflowSection>

          <WorkflowSection number="02" title="Delivery & hosting" description="Record what Nexus needs to guide the technician from discovery through launch and maintenance.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField label="Platform" value={form.platform} onValueChange={(platform) => setForm((current) => ({ ...current, platform }))} options={["wordpress", "static", "custom", "other"]} />
              <SelectField label="Delivery stage" value={form.stage} onValueChange={(stage) => setForm((current) => ({ ...current, stage }))} options={Object.keys(stageTone)} />
              <TextField label="Hosting provider" value={form.hosting_provider} onChange={(hosting_provider) => setForm((current) => ({ ...current, hosting_provider }))} placeholder="synergy_wholesale" />
              <TextField label="Hosting / cPanel identifier" value={form.hosting_identifier} onChange={(hosting_identifier) => setForm((current) => ({ ...current, hosting_identifier }))} placeholder="Hosting service ID" />
              <TextField label="WordPress version" value={form.wordpress_version} onChange={(wordpress_version) => setForm((current) => ({ ...current, wordpress_version }))} placeholder="e.g. 6.8" />
              <TextField label="PHP version" value={form.php_version} onChange={(php_version) => setForm((current) => ({ ...current, php_version }))} placeholder="e.g. 8.3" />
              <TextField label="Service owner" value={form.owner_name} onChange={(owner_name) => setForm((current) => ({ ...current, owner_name }))} placeholder="Responsible contact or team" />
              <TextField label="Renewal date" value={form.renewal_date} onChange={(renewal_date) => setForm((current) => ({ ...current, renewal_date }))} type="date" />
            </div>
          </WorkflowSection>

          <WorkflowSection number="03" title="Maintenance safety" description="Record the update policy and backup evidence the Safe Update Engine needs before it will let a plan leave the draft state.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField label="Update policy" value={form.update_policy} onValueChange={(update_policy) => setForm((current) => ({ ...current, update_policy }))} options={["manual", "assisted", "policy_driven"]} />
              <TextField label="Last verified backup" value={form.last_backup_at} onChange={(last_backup_at) => setForm((current) => ({ ...current, last_backup_at: last_backup_at ? new Date(last_backup_at).toISOString() : "" }))} type="datetime-local" />
              <SelectField label="Backup status" value={form.backup_status} onValueChange={(backup_status) => setForm((current) => ({ ...current, backup_status }))} options={["unknown", "current", "stale", "failed"]} />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">A backup older than 24 hours does not satisfy preflight. Nexus never invents a backup time; record the real evidence, or the Safe Update Engine will block the plan and say why.</p>
          </WorkflowSection>

          <WorkflowSection number="04" title="Commercial connection" description="Make the service status explicit. A billable value is service evidence—not an automatic invoice or contract change.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Linked agreement</Label><Select value={form.agreement_id || "__none"} onValueChange={(agreement_id) => setForm((current) => ({ ...current, agreement_id: agreement_id === "__none" ? "" : agreement_id }))}><SelectTrigger><SelectValue placeholder="No agreement linked" /></SelectTrigger><SelectContent><SelectItem value="__none">No agreement linked</SelectItem>{clientContracts.map((contract) => <SelectItem key={contract.id} value={contract.id}>{contract.name || contract.id}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Only active agreements for the selected client are available.</p></div>
              <SelectField label="Billing status" value={form.billing_status} onValueChange={(billing_status) => setForm((current) => ({ ...current, billing_status }))} options={["not_linked", "included", "billable", "suspended"]} />
              <TextField label="Service plan / billing item" value={form.service_plan} onChange={(service_plan) => setForm((current) => ({ ...current, service_plan }))} placeholder="e.g. Managed WordPress Care" />
              <div className="space-y-2"><Label>Monthly service value</Label><Input type="number" min="0" step="0.01" value={form.monthly_fee} onChange={(event) => setForm((current) => ({ ...current, monthly_fee: Number(event.target.value || 0) }))} /><p className="text-xs text-muted-foreground">Used by Nexus service-assurance and billing review; it does not generate an invoice by itself.</p></div>
            </div>
          </WorkflowSection>

          <WorkflowSection number="05" title="Technician handoff notes" description="Capture only the operational context a future technician needs; credentials stay in approved secure connection workflows.">
            <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={5} placeholder="Launch considerations, maintenance boundaries, customer contacts or next actions…" /></div>
          </WorkflowSection>
        </div>
      </NexusWorkflowDialog>
    </Dialog>

    <Dialog open={Boolean(managedSite)} onOpenChange={(open) => { if (!open) { setManagedSite(null); setManagement(null); setPlans([]); setWordpressTarget(""); } }}>
      <NexusWorkflowDialog
        eyebrow="WordPress operations"
        title={`Manage WordPress · ${managedSite?.name || "Website"}`}
        description="Review secured connection evidence, inventory and planned maintenance. Update requests are approval-backed; Nexus will not imply a WordPress change has happened until its control worker records the result."
        icon={Wrench}
        tone="cyan"
        className="max-w-5xl"
        footer={<><Button variant="outline" onClick={() => { setManagedSite(null); setManagement(null); }}>Close</Button><Button variant="outline" onClick={refreshManagement} disabled={managementLoading}><RefreshCw className={`mr-1.5 h-4 w-4 ${managementLoading ? "animate-spin" : ""}`} />Refresh evidence</Button></>}
      >
        {managementLoading || !management ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading the secured website workspace…</div> : <WordPressManagement
          management={management}
          site={managedSite}
          connectionOpen={() => { setConnection({ api_url: "", username: "", application_password: "" }); setConnectionOpen(true); }}
          healthChecking={healthChecking === managedSite?.id}
          onHealth={() => healthCheck()}
          working={wordpressWorking}
          onAction={wordpressAction}
          target={wordpressTarget}
          setTarget={setWordpressTarget}
        />}
        {management && !managementLoading && (
          <SafeUpdateEngine
            site={managedSite}
            plugins={management.inventory?.plugins || []}
            plans={plans}
            working={planWorking}
            onCreate={createUpdatePlan}
            onApprove={approveUpdatePlan}
            onQueue={queueUpdatePlan}
          />
        )}
      </NexusWorkflowDialog>
    </Dialog>

    <Dialog open={connectionOpen} onOpenChange={(open) => { if (!wordpressWorking) setConnectionOpen(open); }}>
      <NexusWorkflowDialog
        eyebrow="Secure WordPress connection"
        title="Link WordPress management"
        description="Use a dedicated WordPress Application Password. Nexus encrypts it server-side, never displays it again, and only uses it to carry out approved management work."
        icon={ShieldCheck}
        tone="emerald"
        className="max-w-xl"
        footer={<><Button variant="outline" onClick={() => setConnectionOpen(false)} disabled={Boolean(wordpressWorking)}>Cancel</Button><Button onClick={connectWordPress} disabled={Boolean(wordpressWorking)}>{wordpressWorking === "connect" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Link securely</Button></>}
      >
        <div className="space-y-4"><TextField label="WordPress URL" value={connection.api_url} onChange={(api_url) => setConnection((current) => ({ ...current, api_url }))} placeholder="https://www.example.com.au" type="url" /><TextField label="WordPress username" value={connection.username} onChange={(username) => setConnection((current) => ({ ...current, username }))} placeholder="Dedicated Nexus service user" /><TextField label="Application Password" value={connection.application_password} onChange={(application_password) => setConnection((current) => ({ ...current, application_password }))} type="password" placeholder="WordPress Application Password" /></div>
      </NexusWorkflowDialog>
    </Dialog>

    <Dialog open={Boolean(archivingSite)} onOpenChange={(open) => !open && setArchivingSite(null)}>
      <NexusWorkflowDialog
        eyebrow="Web delivery lifecycle"
        title="Archive website record?"
        description={`Archive ${archivingSite?.name || "this website"}? Nexus will retain the provider-action, billing and audit evidence while removing the record from the active portfolio.`}
        icon={Archive}
        tone="amber"
        className="max-w-xl"
        footer={<><Button variant="outline" onClick={() => setArchivingSite(null)} disabled={working}>Keep active</Button><Button variant="destructive" onClick={archiveSite} disabled={working}>{working && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Archive website</Button></>}
      >
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-sm leading-6 text-muted-foreground">This does not cancel a domain, hosting plan, certificate, WordPress connection or recurring invoice. Use the corresponding governed provider or commercial workflow if those services also need to change.</div>
      </NexusWorkflowDialog>
    </Dialog>
  </div>;
}

function SiteRow({ site, healthChecking, onEdit, onArchive, onHealth, onManage, onPlanSync }) {
  const health = site.website_health || {};
  const healthTone = health.status === "healthy" ? "border-emerald-500/30 text-emerald-300" : health.status ? "border-amber-500/30 text-amber-300" : "border-zinc-500/30 text-muted-foreground";
  return <div className="flex flex-col gap-4 p-5 transition-colors hover:bg-muted/25 xl:flex-row xl:items-center">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{site.name}</p><Badge variant="outline" className={stageTone[site.stage] || stageTone.discovery}>{readable(site.stage)}</Badge><Badge variant="outline">{readable(site.platform)}</Badge><Badge variant="outline" className={billingTone[site.billing_status] || billingTone.not_linked}><CreditCard className="mr-1 h-3 w-3" />{readable(site.billing_status || "not_linked")}</Badge>{site.website_health && <Badge variant="outline" className={healthTone}><Globe2 className="mr-1 h-3 w-3" />{readable(health.status)}</Badge>}</div>
      <p className="mt-1 font-mono text-sm text-cyan-300">{site.primary_domain}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{site.client_name} · {site.hosting_provider || "Hosting not recorded"}{site.service_plan ? ` · ${site.service_plan}` : ""}{site.monthly_fee ? ` · $${Number(site.monthly_fee).toFixed(2)}/month` : ""}</p>
      {health.checked_at && <p className="mt-1 text-[11px] text-muted-foreground">Health checked {formatDate(health.checked_at)}{health.http_status ? ` · HTTP ${health.http_status}` : ""}{health.latency_ms ? ` · ${health.latency_ms} ms` : ""}</p>}
    </div>
    <div className="flex flex-wrap gap-2 xl:justify-end">
      {site.platform === "wordpress" && <Button size="sm" onClick={onManage}><Wrench className="mr-1.5 h-3.5 w-3.5" />Manage WordPress</Button>}
      <Button size="sm" variant="outline" onClick={onHealth} disabled={healthChecking}>{healthChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe2 className="mr-1.5 h-3.5 w-3.5" />}<span className={healthChecking ? "sr-only" : ""}>Check health</span></Button>
      <Button size="sm" variant="outline" onClick={onPlanSync}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Sync plan</Button>
      <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>
      <Button size="sm" variant="outline" className="text-muted-foreground hover:text-rose-300" onClick={onArchive}><Archive className="h-3.5 w-3.5" /><span className="sr-only">Archive {site.name}</span></Button>
      {site.site_url && <Button size="sm" variant="outline" asChild><a href={site.site_url.startsWith("http") ? site.site_url : `https://${site.site_url}`} target="_blank" rel="noreferrer">Open site <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></a></Button>}
    </div>
  </div>;
}

function WordPressManagement({ management, connectionOpen, healthChecking, onHealth, working, onAction, target, setTarget }) {
  const plugins = management.inventory?.plugins || [];
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Mini title="Connection" value={management.connection?.connected ? "Linked" : "Not linked"} tone={management.connection?.connected ? "emerald" : "amber"} />
      <Mini title="Billing status" value={readable(management.billing?.billing_status || "not_linked")} />
      <Mini title="Plugin inventory" value={management.inventory?.connected ? `${plugins.length} recorded` : "Not synced"} />
      <Mini title="Website health" value={readable(management.health?.status || "not checked")} tone={management.health?.status === "healthy" ? "emerald" : management.health?.status ? "amber" : "zinc"} />
    </div>
    <div className="flex flex-wrap gap-2">
      {!management.connection?.connected && <Button onClick={connectionOpen}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Link WordPress</Button>}
      <Button variant="outline" onClick={onHealth} disabled={healthChecking}>{healthChecking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Globe2 className="mr-1.5 h-3.5 w-3.5" />}Check website health</Button>
      <Button variant="outline" onClick={() => onAction("inventory")} disabled={!management.connection?.connected || Boolean(working)}>{working === "inventory" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Refresh inventory</Button>
      <Button variant="outline" onClick={() => onAction("backup_and_update")} disabled={!management.connection?.connected || Boolean(working)}>{working === "backup_and_update" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Request backup & update</Button>
      <Button variant="outline" onClick={() => onAction("core_update")} disabled={!management.connection?.connected || Boolean(working)}>{working === "core_update" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Request core update</Button>
    </div>
    <Card className="border-cyan-500/15 bg-cyan-500/[0.025]"><CardHeader className="pb-3"><CardTitle className="text-sm">Component update plan</CardTitle><CardDescription>Select an exact WordPress plugin or theme path before creating an approval-backed maintenance request.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"><Input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={plugins[0]?.plugin || "e.g. akismet/akismet.php"} list="wordpress-component-targets" /><datalist id="wordpress-component-targets">{plugins.map((plugin) => <option key={plugin.plugin} value={plugin.plugin}>{plugin.name || plugin.plugin}</option>)}</datalist><Button variant="outline" onClick={() => onAction("plugin_update")} disabled={!management.connection?.connected || Boolean(working)}>{working === "plugin_update" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Request plugin update</Button><Button variant="outline" onClick={() => onAction("theme_update")} disabled={!management.connection?.connected || Boolean(working)}>{working === "theme_update" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Request theme update</Button></CardContent></Card>
    <div className="rounded-xl border border-border/70"><div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3"><div><p className="text-sm font-medium">Plugin inventory</p><p className="text-xs text-muted-foreground">Provider-recorded from the secured WordPress REST connection.</p></div><Badge variant="outline">{plugins.length} items</Badge></div>{plugins.length ? <div className="divide-y divide-border/50">{plugins.map((plugin) => <div key={plugin.plugin} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"><div><p className="font-medium">{plugin.name || plugin.plugin}</p><p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{plugin.plugin}</p></div><div className="flex items-center gap-2"><Badge variant="outline">{plugin.version || "Version unavailable"}</Badge><Badge variant="outline" className={plugin.update ? "border-amber-500/30 text-amber-300" : "border-emerald-500/30 text-emerald-300"}>{plugin.update ? "Update available" : "Current"}</Badge></div></div>)}</div> : <p className="p-4 text-sm leading-6 text-muted-foreground">{management.connection?.connected ? "No plugin inventory has been returned yet. Refresh inventory after verifying the dedicated WordPress user has the required REST permissions." : "Link a secured WordPress Application Password, then refresh inventory. Credentials are never displayed in Nexus."}</p>}</div>
    <div className="rounded-xl border border-border/70"><div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3"><div><p className="text-sm font-medium">Maintenance request history</p><p className="text-xs text-muted-foreground">Nexus records the requested action and approval state before a control worker touches WordPress.</p></div><Badge variant="outline">{management.actions?.length || 0} records</Badge></div>{management.actions?.length ? <div className="divide-y divide-border/50">{management.actions.map((action) => <div key={action.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"><div><p className="font-medium">{readable(action.action)}</p><p className="mt-0.5 text-xs text-muted-foreground">{action.target || "Whole site"} · {formatDate(action.created_at)}</p></div><Badge variant="outline" className={action.status === "completed" ? "border-emerald-500/30 text-emerald-300" : action.status.includes("failed") ? "border-rose-500/30 text-rose-300" : "border-amber-500/30 text-amber-300"}>{readable(action.status)}</Badge></div>)}</div> : <p className="p-4 text-sm text-muted-foreground">No maintenance requests have been retained for this site.</p>}</div>
    <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.035] p-4 text-sm leading-6 text-muted-foreground"><CheckCircle2 className="mr-2 inline h-4 w-4 text-amber-300" />A requested update is not an executed update. Nexus keeps the request approval-backed and awaits verified completion evidence from the WordPress control worker.</div>
  </div>;
}

function SafeUpdateEngine({ site, plugins, plans, working, onCreate, onApprove, onQueue }) {
  const updatable = plugins.filter((plugin) => plugin.update_available);
  const policy = site?.update_policy || "manual";
  return <Card className="mt-5 border-cyan-500/15 bg-cyan-500/[0.02]" data-testid="safe-update-engine">
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-sm"><Hammer className="h-4 w-4 text-cyan-300" />Safe Update Engine</CardTitle>
      <CardDescription>
        Nexus discovers, checks and stages plugin updates, then waits for approval. It never reports an update as applied until a WordPress control worker records the verified result.
        {" "}Policy in force: <span className="text-foreground">{policyLabel(policy)}</span>.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onCreate} disabled={Boolean(working) || !updatable.length} data-testid="safe-update-create">
          {working === "create" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowUpCircle className="mr-1.5 h-3.5 w-3.5" />}
          Prepare plan for {updatable.length} update{updatable.length === 1 ? "" : "s"}
        </Button>
        {!updatable.length && <span className="text-xs text-muted-foreground">No plugin updates are recorded. Refresh inventory first.</span>}
      </div>
      {plans.length > 0 && (
        <div className="rounded-xl border border-border/70 divide-y divide-border/60">
          {plans.map((plan) => {
            const summary = preflightSummary(plan.preflight);
            const canApprove = ["preflight_passed", "pending_approval"].includes(plan.status);
            const canQueue = plan.status === "approved";
            return <div key={plan.id} className="space-y-2 p-4" data-testid={`update-plan-${plan.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={planStatusTone(plan.status)}>{planStatusLabel(plan.status)}</Badge>
                <Badge variant="outline" className={riskTone(plan.risk)}>{planStatusLabel(plan.risk)} risk</Badge>
                <Badge variant="outline">{plan.items?.length || 0} item{plan.items?.length === 1 ? "" : "s"}</Badge>
                <Badge variant="outline" className="text-muted-foreground">{policyLabel(plan.policy)}</Badge>
                <span className="text-xs text-muted-foreground">{formatDate(plan.created_at)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {canApprove && <Button size="sm" variant="outline" onClick={() => onApprove(plan)} disabled={Boolean(working)} data-testid={`update-plan-approve-${plan.id}`}>{working === plan.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ListChecks className="mr-1.5 h-3.5 w-3.5" />}Approve plan</Button>}
                {canQueue && <Button size="sm" variant="outline" onClick={() => onQueue(plan)} disabled={Boolean(working)} data-testid={`update-plan-queue-${plan.id}`}>{working === `queue-${plan.id}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Hammer className="mr-1.5 h-3.5 w-3.5" />}Queue for control worker</Button>}
              </div>
              <div className={`rounded-lg border p-3 text-xs leading-5 ${summary.passed ? "border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-200" : "border-amber-500/20 bg-amber-500/[0.04] text-amber-200"}`} data-testid={`update-plan-preflight-${plan.id}`}>
                <p className="font-medium">Preflight: {summary.headline}</p>
                {summary.detail && <p className="mt-1 text-muted-foreground">{summary.detail}</p>}
                {(plan.preflight?.checks || []).length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-muted-foreground">
                    {plan.preflight.checks.map((check) => <li key={check.key}>{check.state === "pass" ? "✓" : "✕"} {check.label}: {check.detail}</li>)}
                  </ul>
                )}
              </div>
              {(plan.items || []).length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {plan.items.map((item) => <li key={item.plugin} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{item.name || item.plugin}</span>
                    <Badge variant="outline">{item.from_version || "?"} → {item.to_version || "?"}</Badge>
                    <Badge variant="outline" className={riskTone(item.risk)}>{planStatusLabel(item.risk)}</Badge>
                    {(item.risk_reasons || []).map((reason) => <span key={reason}>{reason}</span>)}
                  </li>)}
                </ul>
              )}
            </div>;
          })}
        </div>
      )}
    </CardContent>
  </Card>;
}

function WorkflowSection({ number, title, description, children }) {
  return <section className="rounded-2xl border border-border/70 bg-muted/[0.1] p-4 md:p-5"><div className="mb-4 flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/[0.08] text-[10px] font-bold tracking-wider text-cyan-300">{number}</span><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div></div>{children}</section>;
}

function TextField({ label, value, onChange, type = "text", placeholder = "" }) {
  return <div className="space-y-2"><Label>{label}</Label><Input type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>;
}

function SelectField({ label, value, onValueChange, options }) {
  return <div className="space-y-2"><Label>{label}</Label><Select value={value} onValueChange={onValueChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{readable(option)}</SelectItem>)}</SelectContent></Select></div>;
}

function Mini({ title, value, tone = "cyan" }) {
  const iconClass = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : tone === "zinc" ? "text-muted-foreground" : "text-cyan-300";
  return <Card><CardContent className="p-3"><PackageCheck className={`h-4 w-4 ${iconClass}`} /><p className="mt-2 text-xs text-muted-foreground">{title}</p><p className="truncate font-medium">{value}</p></CardContent></Card>;
}
