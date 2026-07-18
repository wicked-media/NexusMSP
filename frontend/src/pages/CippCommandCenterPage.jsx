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
  Cloud, Users, KeyRound, RefreshCw, Loader2, ExternalLink,
  UserPlus, Lock, Unlock, UserX, Link as LinkIcon, Search, Shield,
  Send, TrendingUp, AlertTriangle,
} from "lucide-react";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";

export default function CippCommandCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

  const [summary, setSummary] = useState(null);
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
      const [sumRes, linkedRes, clientsRes] = await Promise.all([
        axios.get(`${API}/cipp/summary`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/cipp/linked-clients`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
      ]);
      setSummary(sumRes.data);
      setLinkedClients(linkedRes.data || []);
      setAllClients(clientsRes.data || []);
      if (sumRes.data?.tenants) setTenants(sumRes.data.tenants);
    } finally { setLoadingSummary(false); }
  }, [token]); // eslint-disable-line

  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Load tenant users + licenses when selected
  useEffect(() => {
    if (!selectedTenant) { setUsers([]); setLicenses([]); return; }
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
      const res = await axios.post(`${API}/cipp/tenants/${selectedTenant.customerId}/users/${user.id}/reset-password`,
        { password: newPw, mustChange: true }, { headers });
      toast.success(`Password reset for ${user.userPrincipalName}`);
      console.log("CIPP reset-password result", res.data);
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
      await axios.post(`${API}/clients/${linkClientId}/link-cipp-tenant`, {
        tenant_id: linkDialog.customerId,
        tenant_display: linkDialog.displayName,
        tenant_domain: linkDialog.defaultDomainName,
      }, { headers });
      toast.success("Tenant linked to client");
      setLinkDialog(null); setLinkClientId("");
      loadSummary();
    } catch (e) { toast.error(e.response?.data?.detail || "Link failed"); }
    finally { setBusy(false); }
  };

  const notConfigured = summary && !summary.configured;
  const s = summary?.stats || {};

  return (
    <PageShell data-testid="cipp-command-center">
      <MetricStrip columns={4}>
        <MetricTile label="Tenants" value={s.tenants ?? "—"} accent="orange" icon={<Cloud className="w-2.5 h-2.5 text-orange-400" />} testid="cipp-metric-tenants" />
        <MetricTile label="Linked Clients" value={s.linked_clients ?? "—"} accent="emerald" icon={<LinkIcon className="w-2.5 h-2.5 text-emerald-400" />} testid="cipp-metric-linked" />
        <MetricTile label="Coverage" value={`${s.coverage_pct ?? 0}%`} accent="indigo" icon={<Shield className="w-2.5 h-2.5 text-indigo-400" />} testid="cipp-metric-coverage" />
        <MetricTile label="Actions (30d)" value={summary?.recent_actions?.length ?? "—"} accent="violet" icon={<RefreshCw className="w-2.5 h-2.5 text-violet-400" />} testid="cipp-metric-actions" />
      </MetricStrip>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Cloud className="w-6 h-6 text-orange-400" />CIPP Command Center
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {notConfigured ? (
                <span className="text-orange-400">Not configured — add base URL + API key in Settings</span>
              ) : summary?.last_synced_at ? (
                <span>Last synced {new Date(summary.last_synced_at).toLocaleString()}</span>
              ) : <span>Ready</span>}
            </p>
          </div>
          <div className="flex gap-2">
            {notConfigured && (
              <Button variant="outline" size="sm" asChild data-testid="cipp-configure-btn">
                <Link to="/settings?tab=integrations&anchor=cipp-settings-card"><ExternalLink className="w-3 h-3 mr-1" />Configure CIPP</Link>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={loadSummary} disabled={loadingSummary} data-testid="cipp-refresh-btn">
              {loadingSummary ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full md:w-auto" data-testid="cipp-tabs">
            <TabsTrigger value="tenants" data-testid="cipp-tab-tenants"><Cloud className="w-3 h-3 mr-1" />Tenants</TabsTrigger>
            <TabsTrigger value="hygiene" data-testid="cipp-tab-hygiene"><Shield className="w-3 h-3 mr-1" />Hygiene Digest</TabsTrigger>
            <TabsTrigger value="linked" data-testid="cipp-tab-linked"><LinkIcon className="w-3 h-3 mr-1" />Linked Clients</TabsTrigger>
            <TabsTrigger value="audit" data-testid="cipp-tab-audit"><RefreshCw className="w-3 h-3 mr-1" />Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="tenants" className="space-y-4">
            <Card>
              <CardContent className="p-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input className="pl-8 h-9" placeholder="Search tenants…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="cipp-tenant-search" />
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
              {/* Tenant list */}
              <Card>
                <CardContent className="p-0">
                  {loadingSummary ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />Loading tenants…
                    </div>
                  ) : filteredTenants.length === 0 ? (
                    <div className="text-center py-12 text-xs text-muted-foreground">
                      {notConfigured ? "Add CIPP credentials in Settings → Integrations → CIPP." : "No tenants match."}
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
                          <div className="text-sm font-medium truncate">{t.displayName}</div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">{t.defaultDomainName}</div>
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
                    <div className="text-center py-12 text-xs text-muted-foreground">Select a tenant to view users & licenses.</div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="text-lg font-semibold">{selectedTenant.displayName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{selectedTenant.defaultDomainName}</div>
                          <div className="text-[10px] text-muted-foreground font-mono mt-1">tenant: {selectedTenant.customerId}</div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setLinkDialog(selectedTenant)} data-testid="cipp-link-client-btn">
                            <LinkIcon className="w-3 h-3 mr-1" />Link to client
                          </Button>
                          <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => setCreateDialog(true)} data-testid="cipp-create-user-btn">
                            <UserPlus className="w-3 h-3 mr-1" />Create user
                          </Button>
                        </div>
                      </div>

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
                  <div className="text-center py-12 text-xs text-muted-foreground">No clients linked to a CIPP tenant yet.</div>
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
                  <div className="text-center py-12 text-xs text-muted-foreground">No CIPP actions yet.</div>
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
            <DialogDescription>Choose offboarding actions. This typically runs through CIPP's <code>ExecOffboardUser</code>.</DialogDescription>
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
            <DialogTitle>Link tenant to NexusOps client</DialogTitle>
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
    </PageShell>
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
  if (!digest?.configured) return <Card><CardContent className="p-8 text-center text-xs text-amber-400">CIPP not configured — add credentials in Settings first.</CardContent></Card>;

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
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Avg score</div><div className="text-2xl font-semibold" data-testid="cipp-digest-avg">{digest.avg_score}</div></CardContent></Card>
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
                <TableHead className="text-[10px] uppercase">Score</TableHead>
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
                    {r.score == null ? <span className="text-xs text-rose-400">err</span> : (
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
