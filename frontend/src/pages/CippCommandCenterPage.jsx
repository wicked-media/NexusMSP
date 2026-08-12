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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  CheckCircle2, Cloud, KeyRound, RefreshCw, Loader2, ExternalLink,
  UserPlus, Lock, Unlock, UserX, Link as LinkIcon, Search, Shield,
  Send, TrendingUp, AlertTriangle,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

export default function CippCommandCenterPage({ embedded = false }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

  const [summary, setSummary] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [activeTab, setActiveTab] = useState("tenants");

  const [tenants, setTenants] = useState([]);
  const [linkedClients, setLinkedClients] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [users, setUsers] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [createDialog, setCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({ displayName: "", userPrincipalName: "", password: "", firstName: "", lastName: "", usageLocation: "AU", licenses: [], mustChangePassword: true });
  const [busy, setBusy] = useState(false);

  const [licenseDialog, setLicenseDialog] = useState(null);
  const [licAdd, setLicAdd] = useState([]);
  const [licRemove, setLicRemove] = useState([]);

  const [offboardDialog, setOffboardDialog] = useState(null);
  const [offboardOpts, setOffboardOpts] = useState({ convertToShared: true, removeLicenses: true, resetPassword: true, revokeSessions: true, disableUser: true, removeGroups: true, hideFromGAL: true, outOfOffice: "", forwardTo: "" });

  const [linkDialog, setLinkDialog] = useState(null);
  const [linkClientId, setLinkClientId] = useState("");
  const [allClients, setAllClients] = useState([]);

  // Load summary
  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const [sumRes, onboardingRes, linkedRes, clientsRes] = await Promise.all([
        axios.get(`${API}/cipp/summary`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/m365/onboarding`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/cipp/linked-clients`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
      ]);
      setSummary(sumRes.data);
      setOnboarding(onboardingRes.data);
      setLinkedClients(linkedRes.data || []);
      setAllClients(onboardingRes.data?.clients || clientsRes.data || []);

      const registryByTenant = new Map(
        (onboardingRes.data?.tenants || []).map((tenant) => [String(tenant.tenant_id), tenant]),
      );
      const merged = new Map();
      for (const tenant of (sumRes.data?.tenants || [])) {
        const registry = registryByTenant.get(String(tenant.customerId)) || {};
        merged.set(String(tenant.customerId), {
          ...tenant,
          connectionId: registry.id,
          source: registry.source || "operational_provider",
          clientId: registry.client_id,
          clientName: registry.client_name,
          mapped: Boolean(registry.mapped || registry.client_id),
          accessStatus: "connected",
          graphVerified: true,
          providerOperational: true,
        });
      }
      for (const tenant of (onboardingRes.data?.tenants || [])) {
        const key = String(tenant.tenant_id);
        if (merged.has(key)) continue;
        merged.set(key, {
          customerId: tenant.tenant_id,
          displayName: tenant.tenant_name || tenant.tenant_id,
          defaultDomainName: tenant.default_domain || "",
          connectionId: tenant.id,
          source: tenant.source,
          clientId: tenant.client_id,
          clientName: tenant.client_name,
          mapped: Boolean(tenant.mapped),
          accessStatus: tenant.access_status,
          graphVerified: Boolean(tenant.graph_verified),
          providerOperational: false,
        });
      }
      setTenants(Array.from(merged.values()).sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || ""))));
    } finally { setLoadingSummary(false); }
  }, [token]); // eslint-disable-line

  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Load tenant users + licenses when selected
  useEffect(() => {
    if (!selectedTenant || !selectedTenant.providerOperational) { setUsers([]); setLicenses([]); return; }
    (async () => {
      setLoadingUsers(true);
      try {
        const [u, l] = await Promise.all([
          axios.get(`${API}/cipp/tenants/${selectedTenant.customerId}/users`, { headers }).catch(() => ({ data: [] })),
          axios.get(`${API}/cipp/tenants/${selectedTenant.customerId}/licenses`, { headers }).catch(() => ({ data: [] })),
        ]);
        setUsers(u.data || []);
        setLicenses(l.data || []);
      } finally { setLoadingUsers(false); }
    })();
  }, [selectedTenant, token]); // eslint-disable-line

  const filteredTenants = tenants.filter(t => !query || `${t.displayName} ${t.defaultDomainName}`.toLowerCase().includes(query.toLowerCase()));

  const handleCreateUser = async () => {
    if (!selectedTenant) return;
    if (!createForm.displayName || !createForm.userPrincipalName || !createForm.password) {
      toast.error("Display name, UPN, and password are required"); return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${selectedTenant.customerId}/users`, createForm, { headers });
      toast.success(`User ${createForm.userPrincipalName} created`);
      setCreateDialog(false);
      setCreateForm({ displayName: "", userPrincipalName: "", password: "", firstName: "", lastName: "", usageLocation: "AU", licenses: [], mustChangePassword: true });
      // Reload users
      const u = await axios.get(`${API}/cipp/tenants/${selectedTenant.customerId}/users`, { headers });
      setUsers(u.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Create failed"); }
    finally { setBusy(false); }
  };

  const handleAssignLicense = async () => {
    if (!selectedTenant || !licenseDialog) return;
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${selectedTenant.customerId}/users/${licenseDialog.id}/assign-license`,
        { addLicenses: licAdd, removeLicenses: licRemove }, { headers });
      toast.success("License changes applied");
      setLicenseDialog(null); setLicAdd([]); setLicRemove([]);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const handleResetPassword = async (user) => {
    const newPw = window.prompt(`Reset password for ${user.userPrincipalName}. Leave blank for auto-generated:`, "");
    if (newPw === null) return;
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${selectedTenant.customerId}/users/${user.id}/reset-password`,
        { password: newPw, mustChange: true }, { headers });
      toast.success(`Password reset for ${user.userPrincipalName}`);
    } catch (e) { toast.error(e.response?.data?.detail || "Reset failed"); }
    finally { setBusy(false); }
  };

  const handleToggleSignin = async (user) => {
    const action = user.accountEnabled ? "block" : "unblock";
    if (!window.confirm(`${action === "block" ? "Block" : "Unblock"} sign-in for ${user.userPrincipalName}?`)) return;
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${selectedTenant.customerId}/users/${user.id}/block-signin`,
        { enable: !user.accountEnabled }, { headers });
      toast.success(`Sign-in ${action === "block" ? "blocked" : "unblocked"}`);
      const u = await axios.get(`${API}/cipp/tenants/${selectedTenant.customerId}/users`, { headers });
      setUsers(u.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const handleOffboard = async () => {
    if (!selectedTenant || !offboardDialog) return;
    if (!window.confirm(`Offboard ${offboardDialog.userPrincipalName}? This disables sign-in, removes licenses, and converts mailbox to shared.`)) return;
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${selectedTenant.customerId}/users/${offboardDialog.id}/offboard`,
        offboardOpts, { headers });
      toast.success(`Offboarded ${offboardDialog.userPrincipalName}`);
      setOffboardDialog(null);
      const u = await axios.get(`${API}/cipp/tenants/${selectedTenant.customerId}/users`, { headers });
      setUsers(u.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Offboard failed"); }
    finally { setBusy(false); }
  };

  const handleLinkToClient = async () => {
    if (!linkDialog || !linkClientId) return;
    setBusy(true);
    try {
      if (linkDialog.connectionId) {
        await axios.put(
          `${API}/m365/onboarding/tenants/${linkDialog.connectionId}/mapping`,
          { client_id: linkClientId },
          { headers },
        );
      } else {
        await axios.post(`${API}/clients/${linkClientId}/link-cipp-tenant`, {
          tenant_id: linkDialog.customerId,
          tenant_display: linkDialog.displayName,
          tenant_domain: linkDialog.defaultDomainName,
        }, { headers });
      }
      toast.success("Tenant linked to client");
      setLinkDialog(null);
      setLinkClientId("");
      const linkedClient = allClients.find((client) => client.id === linkClientId);
      setSelectedTenant((current) => current ? { ...current, clientId: linkClientId, clientName: linkedClient?.name, mapped: true } : current);
      await loadSummary();
    } catch (e) { toast.error(e.response?.data?.detail || "Link failed"); }
    finally { setBusy(false); }
  };

  const providerOperational = Boolean(summary?.configured);
  const partnerConnected = onboarding?.connection?.last_test_status === "success";
  const s = summary?.stats || {};
  const tenantCount = Math.max(Number(s.tenants || 0), Number(onboarding?.summary?.discovered || 0));
  const linkedCount = Math.max(Number(s.linked_clients || 0), Number(onboarding?.summary?.mapped || 0));
  const coveragePct = tenantCount ? Math.round((linkedCount / tenantCount) * 100) : 0;

  return (
    <div className={embedded ? "space-y-5" : "p-6 space-y-5"} data-testid="cipp-command-center">
      {!embedded && <OperationalPageHeader
        eyebrow="Nexus 365 · tenant operations"
        title="Nexus Tenant Operations"
        description="One governed workspace for partner tenants, identity lifecycle work, licensing, posture and client context. Provider adapters stay behind the scenes; technicians work in Nexus."
        icon={Cloud}
        tone="cyan"
        actions={<>
          <Badge variant="outline" className={providerOperational ? "border-emerald-500/30 text-emerald-300" : partnerConnected ? "border-cyan-500/30 text-cyan-200" : "border-amber-500/30 text-amber-300"}>
            {providerOperational ? "Live operations" : partnerConnected ? "Discovery connected" : "Connection required"}
          </Badge>
          <Button variant="outline" size="sm" asChild data-testid="cipp-configure-btn">
            <Link to="/control-plane?module=microsoft365&view=connections"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Connections</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={loadSummary} disabled={loadingSummary} data-testid="cipp-refresh-btn">
            {loadingSummary ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Refresh
          </Button>
        </>}
      />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroTile label="Tenants" value={loadingSummary ? "—" : tenantCount} icon={Cloud} glow="cyan" subtitle="Discovered and operational" testId="cipp-metric-tenants" />
        <HeroTile label="Linked clients" value={loadingSummary ? "—" : linkedCount} icon={LinkIcon} glow="emerald" subtitle="Mapped to Nexus clients" testId="cipp-metric-linked" />
        <HeroTile label="Coverage" value={loadingSummary ? "—" : coveragePct} suffix="%" icon={Shield} glow="sky" subtitle="Tenants linked to clients" testId="cipp-metric-coverage" />
        <HeroTile label="Audited actions" value={loadingSummary ? "—" : summary?.recent_actions?.length ?? 0} icon={RefreshCw} glow="violet" subtitle="Last 30 days" testId="cipp-metric-actions" />
      </div>

      <div className="space-y-4">
        <Card className={providerOperational ? "border-emerald-500/25 bg-emerald-500/[0.04]" : partnerConnected ? "border-cyan-500/25 bg-cyan-500/[0.04]" : "border-amber-500/25 bg-amber-500/[0.04]"}>
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${providerOperational ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : partnerConnected ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-200" : "border-amber-500/25 bg-amber-500/10 text-amber-200"}`}>
              {providerOperational ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {providerOperational ? "Nexus 365 operations are ready" : partnerConnected ? "Tenant discovery is ready — operational access pending" : "Connect Microsoft tenant discovery"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {providerOperational
                  ? "Nexus can read tenant users and licences through the connected provider. High-impact actions remain permission-, client-scope- and approval-governed."
                  : partnerConnected
                    ? "Partner Center can discover customers, but users, licences and write actions stay disabled until the tenant has verified GDAP or customer-admin Graph access."
                    : "Configure the MSP partner tenant once, discover customers, then map and verify each tenant before technicians carry out identity work."}
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/control-plane?module=microsoft365&view=connections"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Manage connections</Link>
            </Button>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full md:w-auto" data-testid="cipp-tabs">
            <TabsTrigger value="tenants" data-testid="cipp-tab-tenants"><Cloud className="w-3 h-3 mr-1" />Tenants</TabsTrigger>
            <TabsTrigger value="hygiene" data-testid="cipp-tab-hygiene"><Shield className="w-3 h-3 mr-1" />Security posture</TabsTrigger>
            <TabsTrigger value="linked" data-testid="cipp-tab-linked"><LinkIcon className="w-3 h-3 mr-1" />Linked clients</TabsTrigger>
            <TabsTrigger value="audit" data-testid="cipp-tab-audit"><RefreshCw className="w-3 h-3 mr-1" />Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="tenants" className="space-y-4">
            <Card>
              <CardContent className="p-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input className="pl-8 h-9" placeholder="Search a tenant, primary domain or ID…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="cipp-tenant-search" />
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
              {/* Tenant list */}
              <Card>
                <CardContent className="p-0">
                  {loadingSummary ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />Loading tenant estate…
                    </div>
                  ) : filteredTenants.length === 0 ? (
                    <div className="space-y-3 px-5 py-12 text-center">
                      <Cloud className="mx-auto h-8 w-8 text-muted-foreground/60" />
                      <p className="text-sm font-medium">{query ? "No tenants match this search" : "No Microsoft tenants are in scope yet"}</p>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {query ? "Try a tenant name, primary domain or tenant ID." : "Connect Partner Center to discover CSP customers in bulk, or add an individual tenant."}
                      </p>
                      {!query && <Button variant="outline" size="sm" asChild><Link to="/control-plane?module=microsoft365&view=connections">Open tenant onboarding</Link></Button>}
                    </div>
                  ) : (
                    <div className="divide-y divide-border max-h-[calc(100vh-280px)] overflow-y-auto">
                      {filteredTenants.map((t) => (
                        <button
                          key={t.customerId}
                          onClick={() => setSelectedTenant(t)}
                          className={`w-full text-left p-3 hover:bg-muted/30 ${selectedTenant?.customerId === t.customerId ? "bg-muted/40 border-l-2 border-l-orange-500" : ""}`}
                          data-testid={`cipp-tenant-${t.customerId}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{t.displayName}</div>
                              <div className="truncate font-mono text-[11px] text-muted-foreground">{t.defaultDomainName || t.customerId}</div>
                            </div>
                            <TenantAccessBadge status={t.accessStatus} compact />
                          </div>
                          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span className={`h-1.5 w-1.5 rounded-full ${t.mapped ? "bg-emerald-400" : "bg-amber-400"}`} />
                            {t.clientName || (t.mapped ? "Client mapped" : "Needs client mapping")}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Tenant detail */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  {!selectedTenant ? (
                    <div className="text-center py-12 text-xs text-muted-foreground">Select a tenant to open its identity, licence and client context.</div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="text-lg font-semibold">{selectedTenant.displayName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{selectedTenant.defaultDomainName}</div>
                          <div className="text-[10px] text-muted-foreground font-mono mt-1">tenant: {selectedTenant.customerId}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <TenantAccessBadge status={selectedTenant.accessStatus} />
                            <Badge variant="outline" className={selectedTenant.mapped ? "border-emerald-500/25 text-emerald-200" : "border-amber-500/25 text-amber-200"}>
                              {selectedTenant.clientName || (selectedTenant.mapped ? "Client mapped" : "Client mapping required")}
                            </Badge>
                            <Badge variant="outline" className="capitalize text-muted-foreground">{String(selectedTenant.source || "unknown").replaceAll("_", " ")}</Badge>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setLinkDialog(selectedTenant)} data-testid="cipp-link-client-btn">
                            <LinkIcon className="w-3 h-3 mr-1" />{selectedTenant.mapped ? "Change mapping" : "Map client"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                            onClick={() => setCreateDialog(true)}
                            disabled={!selectedTenant.providerOperational || !selectedTenant.mapped}
                            title={!selectedTenant.providerOperational ? "Verify operational Microsoft access first" : !selectedTenant.mapped ? "Map this tenant to a Nexus client first" : undefined}
                            data-testid="cipp-create-user-btn"
                          >
                            <UserPlus className="w-3 h-3 mr-1" />Create user
                          </Button>
                        </div>
                      </div>

                      {!selectedTenant.providerOperational ? (
                        <TenantReadinessPanel tenant={selectedTenant} />
                      ) : <>
                      <div className="grid grid-cols-3 gap-2 pt-2">
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Users</div>
                          <div className="text-lg font-semibold">{users.length}</div>
                        </div>
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Licensed</div>
                          <div className="text-lg font-semibold">{users.filter(u => u.licenses_count > 0).length}</div>
                        </div>
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Blocked</div>
                          <div className="text-lg font-semibold">{users.filter(u => !u.accountEnabled).length}</div>
                        </div>
                      </div>

                      {/* Licenses */}
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">SKUs available</div>
                        <div className="flex flex-wrap gap-1">
                          {licenses.length === 0 ? (
                            <span className="text-xs text-muted-foreground">No licenses returned.</span>
                          ) : licenses.map(l => (
                            <Badge key={l.skuId} variant="outline" className="text-[10px] font-mono" title={l.skuId}>
                              {l.skuPartNumber || l.skuId} · {l.consumedUnits}/{(l.consumedUnits + (l.available ?? 0))}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* Users table */}
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Users</div>
                        {loadingUsers ? (
                          <div className="flex items-center justify-center py-8 text-muted-foreground">
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading users…
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-[10px] uppercase">Name</TableHead>
                                <TableHead className="text-[10px] uppercase">UPN</TableHead>
                                <TableHead className="text-[10px] uppercase">Status</TableHead>
                                <TableHead className="text-[10px] uppercase">Licenses</TableHead>
                                <TableHead className="text-right text-[10px] uppercase">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {users.map((u) => (
                                <TableRow key={u.id} data-testid={`cipp-user-${u.id}`}>
                                  <TableCell className="font-medium text-sm">{u.displayName || "—"}</TableCell>
                                  <TableCell className="text-xs font-mono">{u.userPrincipalName}</TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className={u.accountEnabled ? "text-emerald-400 border-emerald-500/30" : "text-rose-400 border-rose-500/30"}>
                                      {u.accountEnabled ? "Enabled" : "Blocked"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">{u.licenses_count}</TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex gap-1 justify-end flex-wrap">
                                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => { setLicenseDialog(u); setLicAdd([]); setLicRemove([]); }} data-testid={`cipp-user-license-${u.id}`}>
                                        <KeyRound className="w-3 h-3 mr-1" />Licenses
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => handleResetPassword(u)} disabled={busy} data-testid={`cipp-user-reset-${u.id}`}>
                                        <RefreshCw className="w-3 h-3 mr-1" />Reset pw
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => handleToggleSignin(u)} disabled={busy} data-testid={`cipp-user-block-${u.id}`}>
                                        {u.accountEnabled ? <><Lock className="w-3 h-3 mr-1" />Block</> : <><Unlock className="w-3 h-3 mr-1" />Unblock</>}
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 text-[10px] text-rose-400" onClick={() => { setOffboardDialog(u); }} data-testid={`cipp-user-offboard-${u.id}`}>
                                        <UserX className="w-3 h-3 mr-1" />Offboard
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                      </>}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="hygiene" className="space-y-4">
            <CippHygienePanel />
          </TabsContent>

          <TabsContent value="linked">
            <Card>
              <CardContent className="p-0">
                {linkedClients.length === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">No clients are linked to a Microsoft tenant yet.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] uppercase">Client</TableHead>
                        <TableHead className="text-[10px] uppercase">Tenant</TableHead>
                        <TableHead className="text-[10px] uppercase">Domain</TableHead>
                        <TableHead className="text-[10px] uppercase">Linked</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linkedClients.map((c) => (
                        <TableRow key={c.id} data-testid={`cipp-linked-${c.id}`}>
                          <TableCell className="font-medium text-sm">{c.name}</TableCell>
                          <TableCell className="text-xs">{c.cipp_tenant_display || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{c.cipp_tenant_domain || "—"}</TableCell>
                          <TableCell className="text-[10px] font-mono text-muted-foreground">{c.cipp_linked_at ? new Date(c.cipp_linked_at).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" asChild><Link to={`/clients`}>Open<ExternalLink className="w-3 h-3 ml-1" /></Link></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit">
            <Card>
              <CardContent className="p-0">
                {(summary?.recent_actions || []).length === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">No tenant operations have been recorded yet.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] uppercase">When</TableHead>
                        <TableHead className="text-[10px] uppercase">Action</TableHead>
                        <TableHead className="text-[10px] uppercase">Tenant</TableHead>
                        <TableHead className="text-[10px] uppercase">User</TableHead>
                        <TableHead className="text-[10px] uppercase">By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(summary?.recent_actions || []).map((a, i) => (
                        <TableRow key={i} data-testid={`cipp-audit-${i}`}>
                          <TableCell className="text-[10px] font-mono">{new Date(a.timestamp).toLocaleString()}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className="text-[10px]">{a.action}</Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono truncate max-w-[120px]">{a.tenant_id}</TableCell>
                          <TableCell className="text-xs font-mono truncate max-w-[180px]">{a.user_id || a.upn || "—"}</TableCell>
                          <TableCell className="text-xs">{a.by || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create User Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="max-w-xl" data-testid="cipp-create-user-dialog">
          <DialogHeader>
            <DialogTitle>Create M365 user</DialogTitle>
            <DialogDescription>Tenant: {selectedTenant?.displayName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First name</Label><Input value={createForm.firstName} onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })} data-testid="cipp-user-firstname" /></div>
              <div><Label>Last name</Label><Input value={createForm.lastName} onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })} data-testid="cipp-user-lastname" /></div>
            </div>
            <div><Label>Display name *</Label><Input value={createForm.displayName} onChange={e => setCreateForm({ ...createForm, displayName: e.target.value })} data-testid="cipp-user-displayname" /></div>
            <div><Label>User Principal Name (email) *</Label><Input value={createForm.userPrincipalName} onChange={e => setCreateForm({ ...createForm, userPrincipalName: e.target.value })} placeholder={`user@${selectedTenant?.defaultDomainName || "domain.com"}`} data-testid="cipp-user-upn" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Password *</Label><Input type="password" value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })} data-testid="cipp-user-password" /></div>
              <div><Label>Usage location</Label><Input value={createForm.usageLocation} onChange={e => setCreateForm({ ...createForm, usageLocation: e.target.value.toUpperCase() })} maxLength={2} data-testid="cipp-user-location" /></div>
            </div>
            {licenses.length > 0 && (
              <div>
                <Label>Assign licenses</Label>
                <div className="border border-border rounded p-2 space-y-1 max-h-32 overflow-y-auto">
                  {licenses.map(l => (
                    <label key={l.skuId} className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={createForm.licenses.includes(l.skuId)}
                        onCheckedChange={(checked) => {
                          setCreateForm(f => ({
                            ...f,
                            licenses: checked ? [...f.licenses, l.skuId] : f.licenses.filter(x => x !== l.skuId),
                          }));
                        }}
                      />
                      <span className="font-mono">{l.skuPartNumber || l.skuId}</span>
                      <span className="text-muted-foreground">({l.consumedUnits}/{l.consumedUnits + (l.available ?? 0)})</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={createForm.mustChangePassword} onCheckedChange={(c) => setCreateForm({ ...createForm, mustChangePassword: c })} />
              Force password change at next sign-in
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateUser} disabled={busy} data-testid="cipp-submit-create-user">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* License management Dialog */}
      <Dialog open={!!licenseDialog} onOpenChange={() => setLicenseDialog(null)}>
        <DialogContent data-testid="cipp-license-dialog">
          <DialogHeader>
            <DialogTitle>Manage licenses · {licenseDialog?.userPrincipalName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Assign (add)</Label>
              <div className="border border-border rounded p-2 space-y-1 max-h-40 overflow-y-auto">
                {licenses.map(l => (
                  <label key={`add-${l.skuId}`} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={licAdd.includes(l.skuId)}
                      onCheckedChange={(c) => setLicAdd(a => c ? [...a, l.skuId] : a.filter(x => x !== l.skuId))}
                    />
                    <span className="font-mono">{l.skuPartNumber || l.skuId}</span>
                    <span className="text-muted-foreground ml-auto">available: {l.available ?? 0}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Remove</Label>
              <div className="border border-border rounded p-2 space-y-1 max-h-40 overflow-y-auto">
                {licenses.map(l => (
                  <label key={`rm-${l.skuId}`} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={licRemove.includes(l.skuId)}
                      onCheckedChange={(c) => setLicRemove(a => c ? [...a, l.skuId] : a.filter(x => x !== l.skuId))}
                    />
                    <span className="font-mono">{l.skuPartNumber || l.skuId}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLicenseDialog(null)}>Cancel</Button>
            <Button onClick={handleAssignLicense} disabled={busy || (licAdd.length === 0 && licRemove.length === 0)} data-testid="cipp-submit-license">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1" />}Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Offboard Dialog */}
      <Dialog open={!!offboardDialog} onOpenChange={() => setOffboardDialog(null)}>
        <DialogContent className="max-w-lg" data-testid="cipp-offboard-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserX className="w-4 h-4 text-rose-400" />Offboard {offboardDialog?.userPrincipalName}</DialogTitle>
            <DialogDescription>Choose the Microsoft identity and mailbox actions to run through the configured tenant provider.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-xs">
            {[
              ["disableUser", "Disable sign-in"],
              ["removeLicenses", "Remove all licenses"],
              ["convertToShared", "Convert mailbox to shared"],
              ["resetPassword", "Reset password"],
              ["revokeSessions", "Revoke all sessions"],
              ["removeGroups", "Remove from all groups"],
              ["hideFromGAL", "Hide from Global Address List"],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <Checkbox checked={offboardOpts[k]} onCheckedChange={(c) => setOffboardOpts(o => ({ ...o, [k]: c }))} />
                {label}
              </label>
            ))}
            <div><Label className="text-xs">Out-of-office message (optional)</Label><Input value={offboardOpts.outOfOffice} onChange={e => setOffboardOpts({ ...offboardOpts, outOfOffice: e.target.value })} /></div>
            <div><Label className="text-xs">Forward email to (optional UPN)</Label><Input value={offboardOpts.forwardTo} onChange={e => setOffboardOpts({ ...offboardOpts, forwardTo: e.target.value })} placeholder="manager@company.com" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOffboardDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleOffboard} disabled={busy} data-testid="cipp-submit-offboard">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserX className="w-4 h-4 mr-1" />}Offboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link tenant → client Dialog */}
      <Dialog open={!!linkDialog} onOpenChange={() => setLinkDialog(null)}>
        <DialogContent data-testid="cipp-link-dialog">
          <DialogHeader>
            <DialogTitle>Link tenant to NexusMSP client</DialogTitle>
            <DialogDescription>{linkDialog?.displayName} ({linkDialog?.defaultDomainName})</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Select client</Label>
            <Select value={linkClientId} onValueChange={setLinkClientId}>
              <SelectTrigger data-testid="cipp-link-client-select"><SelectValue placeholder="Pick a client" /></SelectTrigger>
              <SelectContent>
                {allClients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDialog(null)}>Cancel</Button>
            <Button onClick={handleLinkToClient} disabled={busy || !linkClientId} data-testid="cipp-submit-link"><LinkIcon className="w-4 h-4 mr-1" />Link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TenantAccessBadge({ status, compact = false }) {
  const size = compact ? "px-1.5 py-0 text-[9px]" : "text-[10px]";
  if (status === "connected") {
    return <Badge variant="outline" className={`shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-200 ${size}`}>Ready</Badge>;
  }
  if (status === "consent_required") {
    return <Badge variant="outline" className={`shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-200 ${size}`}>Consent</Badge>;
  }
  if (status === "gdap_required") {
    return <Badge variant="outline" className={`shrink-0 border-cyan-500/30 bg-cyan-500/10 text-cyan-200 ${size}`}>GDAP</Badge>;
  }
  return <Badge variant="outline" className={`shrink-0 border-zinc-700 text-muted-foreground ${size}`}>Pending</Badge>;
}

function TenantReadinessPanel({ tenant }) {
  const checks = [
    {
      label: "Tenant discovered",
      complete: true,
      detail: `Source: ${String(tenant.source || "manual").replaceAll("_", " ")}`,
    },
    {
      label: "Nexus client mapped",
      complete: Boolean(tenant.mapped),
      detail: tenant.clientName || (tenant.mapped ? "Client mapping retained" : "Choose Map client above"),
    },
    {
      label: "Microsoft access verified",
      complete: tenant.accessStatus === "connected",
      detail: tenant.accessStatus === "consent_required"
        ? "Customer administrator consent is still required"
        : tenant.accessStatus === "gdap_required"
          ? "A least-privilege GDAP relationship is still required"
          : "Waiting for verified Microsoft Graph evidence",
    },
    {
      label: "Operational provider ready",
      complete: Boolean(tenant.providerOperational),
      detail: "Required before Nexus reads users, licences or submits tenant changes",
    },
  ];
  const next = checks.find((item) => !item.complete);

  return (
    <div className="space-y-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.035] p-4" data-testid="tenant-readiness-panel">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-200" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Tenant operations are safely locked</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Nexus has retained the tenant record, but it will not show fabricated users or enable identity changes until client ownership and Microsoft access are verified.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/control-plane?module=microsoft365&view=connections">Resolve access</Link>
        </Button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {checks.map((item) => (
          <div key={item.label} className="flex gap-2 rounded-lg border border-border/70 bg-black/10 p-3">
            {item.complete
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}
            <div>
              <p className="text-xs font-medium">{item.label}</p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
      {next && <p className="text-xs text-amber-100"><span className="font-semibold">Next action:</span> {next.detail}.</p>}
    </div>
  );
}

function CippHygienePanel() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const [d, h] = await Promise.all([
        axios.get(`${API}/cipp/hygiene-digest`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/cipp/digests`, { headers }).catch(() => ({ data: [] })),
      ]);
      setDigest(d.data);
      setHistory(h.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const sendDigest = async () => {
    setSending(true);
    try {
      const res = await axios.post(`${API}/cipp/hygiene-digest/send`, {}, { headers });
      if (res.data?.sent) toast.success(`Digest sent via ${res.data.sent_via}`);
      else toast.warning(res.data?.reason || res.data?.error || "Digest saved but not emailed (Microsoft 365 is not connected)");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setSending(false); }
  };

  if (loading) return <Card><CardContent className="p-8 text-center text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin inline" />Computing hygiene digest…</CardContent></Card>;
  if (!digest?.configured) {
    return (
      <Card className="border-amber-500/25 bg-amber-500/[0.04]">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10">
            <Shield className="h-4 w-4 text-amber-200" />
          </div>
          <div>
            <p className="text-sm font-semibold">Security posture is waiting for verified Microsoft evidence</p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Connect tenant discovery, map the customer, and verify GDAP or customer-admin access. Nexus will not estimate posture or invent a hygiene score.</p>
          </div>
          <Button variant="outline" size="sm" asChild><Link to="/control-plane?module=microsoft365&view=connections">Review Microsoft connections</Link></Button>
        </CardContent>
      </Card>
    );
  }

  const rows = digest.clients || [];
  const scored = rows.filter(r => typeof r.score === "number");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-muted-foreground">
          Generated {new Date(digest.generated_at).toLocaleString()} · {digest.total_tenants} tenants analysed · avg {digest.avg_score}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} data-testid="cipp-digest-refresh"><RefreshCw className="w-3 h-3 mr-1" />Recompute</Button>
          <Button size="sm" variant="outline" className="text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10" onClick={sendDigest} disabled={sending} data-testid="cipp-digest-send">
            {sending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}Send digest
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Verified avg</div><div className="text-2xl font-semibold" data-testid="cipp-digest-avg">{digest.avg_score ?? "—"}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Tenants</div><div className="text-2xl font-semibold">{digest.total_tenants}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground text-rose-400">Critical (&lt;50)</div><div className="text-2xl font-semibold text-rose-400">{digest.critical_count}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground text-amber-400">Upsell candidates</div><div className="text-2xl font-semibold text-amber-400">{digest.upsell_candidates?.length || 0}</div></CardContent></Card>
      </div>

      {digest.upsell_candidates?.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-amber-400" />
              <span className="font-medium text-sm">Upsell opportunities</span>
              <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">{digest.upsell_candidates.length}</Badge>
            </div>
            <div className="text-[11px] text-muted-foreground mb-3">Clients with license waste, unlicensed users, or weak MFA posture — ideal targets for a Security Posture bundle.</div>
            <div className="space-y-2">
              {digest.upsell_candidates.map((c) => (
                <div key={c.client_id} className="flex items-start gap-3 p-2 rounded border border-amber-500/20 bg-amber-500/5" data-testid={`cipp-upsell-${c.client_id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{c.client_name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{c.tenant_display || c.tenant_domain}</div>
                    <ul className="text-[11px] text-amber-300 mt-1 space-y-0.5">
                      {(c.top_risks || []).map((r, i) => <li key={i}>• {r}</li>)}
                    </ul>
                  </div>
                  <Badge variant="outline" className="text-amber-400 border-amber-500/30">Score {c.score}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-2 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">All tenants ({scored.length})</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase">Client</TableHead>
                <TableHead className="text-[10px] uppercase">Verified score</TableHead>
                <TableHead className="text-[10px] uppercase">Grade</TableHead>
                <TableHead className="text-[10px] uppercase">Active users</TableHead>
                <TableHead className="text-[10px] uppercase">MFA</TableHead>
                <TableHead className="text-[10px] uppercase">Top risks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.client_id} data-testid={`cipp-digest-row-${r.client_id}`}>
                  <TableCell>
                    <div className="text-sm font-medium">{r.client_name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{r.tenant_display}</div>
                  </TableCell>
                  <TableCell>
                    {r.score == null ? <span className="text-xs text-amber-300">{r.evidence_coverage_pct ? `partial (${r.evidence_coverage_pct}% evidence)` : "unassessed"}</span> : (
                      <Badge variant="outline" className={r.score >= 75 ? "text-emerald-400 border-emerald-500/30" : r.score >= 50 ? "text-amber-400 border-amber-500/30" : "text-rose-400 border-rose-500/30"}>
                        {r.score}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{r.grade || "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{r.counts?.enabled_users ?? "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{r.counts?.mfa_coverage_pct != null ? `${r.counts.mfa_coverage_pct}%` : "—"}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground max-w-md">
                    {(r.top_risks || []).slice(0, 2).map((x, i) => <div key={i}>• {x}</div>)}
                    {!r.top_risks?.length && <span className="text-emerald-400">healthy</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-2 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Digest history</div>
            <Table>
              <TableHeader><TableRow><TableHead className="text-[10px] uppercase">When</TableHead><TableHead className="text-[10px] uppercase">Avg</TableHead><TableHead className="text-[10px] uppercase">Critical</TableHead><TableHead className="text-[10px] uppercase">Sent to</TableHead><TableHead className="text-[10px] uppercase">Via</TableHead></TableRow></TableHeader>
              <TableBody>
                {history.map((h, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-[10px] font-mono">{new Date(h.generated_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs font-mono">{h.avg_score}</TableCell>
                    <TableCell className="text-xs font-mono">{h.critical_count}</TableCell>
                    <TableCell className="text-xs font-mono">{(h.to || []).join(", ") || "—"}</TableCell>
                    <TableCell className="text-xs">{h.sent_via || <span className="text-amber-400">not sent</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
