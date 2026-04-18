import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Globe, Plus, Loader2, Shield, Settings, Users, Copy, Trash2, ExternalLink,
  Eye, Key, Link2, Ticket, Monitor, FileText, CheckCircle, XCircle, Mail,
  UserPlus, Lock, RotateCw
} from "lucide-react";

export default function ClientPortalPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [clients, setClients] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [config, setConfig] = useState(null);
  const [showGenToken, setShowGenToken] = useState(false);
  const [tokenForm, setTokenForm] = useState({ contact_name: "", contact_email: "", expiry_days: 90 });
  const [newTokenUrl, setNewTokenUrl] = useState(null);

  // Portal Users
  const [portalUsers, setPortalUsers] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [userForm, setUserForm] = useState({ name: "", email: "", role: "user", password: "", can_view_all_tickets: true, can_create_tickets: true, can_view_assets: true, can_view_invoices: false, send_welcome_email: true });
  const [addingUser, setAddingUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(null);
  const [editUserForm, setEditUserForm] = useState({});
  const [showTempPassword, setShowTempPassword] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [cRes, pRes] = await Promise.all([
          axios.get(`${API}/clients`, { headers }),
          axios.get(`${API}/client-portal/all`, { headers }),
        ]);
        setClients(cRes.data);
        setConfigs(pRes.data);
      } catch { toast.error("Failed to load"); }
      finally { setLoading(false); }
    })();
  }, []);

  const selectClient = async (clientId) => {
    setSelectedClient(clientId);
    try {
      const [configRes, usersRes] = await Promise.all([
        axios.get(`${API}/client-portal/config/${clientId}`, { headers }),
        axios.get(`${API}/client-portal/users/${clientId}`, { headers }).catch(() => ({ data: [] })),
      ]);
      setConfig(configRes.data);
      setPortalUsers(usersRes.data || []);
    } catch { toast.error("Failed to load config"); }
  };

  const saveConfig = async () => {
    try {
      await axios.put(`${API}/client-portal/config/${selectedClient}`, config, { headers });
      toast.success("Portal config saved");
    } catch { toast.error("Failed"); }
  };

  const generateToken = async () => {
    try {
      const res = await axios.post(`${API}/client-portal/generate-token/${selectedClient}`, tokenForm, { headers });
      setNewTokenUrl(res.data.portal_url);
      toast.success("Portal token generated");
      setShowGenToken(false);
      selectClient(selectedClient);
    } catch { toast.error("Failed"); }
  };

  const revokeToken = async (tokenId) => {
    try {
      await axios.delete(`${API}/client-portal/tokens/${selectedClient}/${tokenId}`, { headers });
      toast.success("Token revoked");
      selectClient(selectedClient);
    } catch { toast.error("Failed"); }
  };

  const addPortalUser = async () => {
    if (!userForm.email.trim()) { toast.error("Email required"); return; }
    setAddingUser(true);
    try {
      const res = await axios.post(`${API}/client-portal/users/${selectedClient}`, { ...userForm, portal_url: `${window.location.origin}/portal-login` }, { headers });
      const emailStatus = res.data.email_status;
      if (emailStatus === "sent") toast.success(`Portal user created and welcome email sent to ${res.data.email}`);
      else toast.success(`Portal user created: ${res.data.email}` + (emailStatus === "skipped" ? "" : " (email failed)"));
      setShowTempPassword({ email: res.data.email, password: res.data.temp_password });
      setShowAddUser(false);
      setUserForm({ name: "", email: "", role: "user", password: "", can_view_all_tickets: true, can_create_tickets: true, can_view_assets: true, can_view_invoices: false, send_welcome_email: true });
      const usersRes = await axios.get(`${API}/client-portal/users/${selectedClient}`, { headers });
      setPortalUsers(usersRes.data || []);
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to create user"); }
    finally { setAddingUser(false); }
  };

  const updatePortalUser = async () => {
    if (!showEditUser) return;
    try {
      await axios.put(`${API}/client-portal/users/${selectedClient}/${showEditUser.id}`, editUserForm, { headers });
      toast.success("User updated");
      setShowEditUser(null);
      const usersRes = await axios.get(`${API}/client-portal/users/${selectedClient}`, { headers });
      setPortalUsers(usersRes.data || []);
    } catch { toast.error("Failed"); }
  };

  const deletePortalUser = async (userId) => {
    try {
      await axios.delete(`${API}/client-portal/users/${selectedClient}/${userId}`, { headers });
      toast.success("User deleted");
      setPortalUsers(prev => prev.filter(u => u.id !== userId));
    } catch { toast.error("Failed"); }
  };

  const resetPassword = async (userId) => {
    try {
      const res = await axios.post(`${API}/client-portal/users/${selectedClient}/${userId}/reset-password`, { portal_url: `${window.location.origin}/portal-login` }, { headers });
      setShowTempPassword({ email: res.data.email, password: res.data.temp_password });
      if (res.data.email_status === "sent") toast.success("Password reset and email sent");
      else toast.success("Password reset");
    } catch { toast.error("Failed"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="client-portal-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Client Self-Service Portal</h1>
        <p className="text-sm text-muted-foreground">Configure branded portals for clients to log tickets, view devices, and check status</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Client List */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Select Client</h2>
          <div className="space-y-1">
            {clients.map(c => {
              const hasPortal = configs.some(p => p.client_id === c.id && p.enabled);
              return (
                <div
                  key={c.id}
                  onClick={() => selectClient(c.id)}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${selectedClient === c.id ? "bg-primary/10 border-primary/30" : "hover:bg-muted/30"}`}
                  data-testid={`portal-client-${c.id}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{c.name?.charAt(0)}</div>
                    <span className="text-sm font-medium">{c.name}</span>
                  </div>
                  {hasPortal && <Badge className="bg-emerald-500/10 text-emerald-500 text-[9px]">ACTIVE</Badge>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Config Panel */}
        <div className="lg:col-span-2 space-y-4">
          {config ? (
            <>
              <Card data-testid="portal-config-panel">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><Settings className="w-5 h-5" />Portal Settings - {config.client_name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Label className="text-sm">Enabled</Label>
                      <Switch checked={config.enabled} onCheckedChange={v => setConfig({ ...config, enabled: v })} data-testid="portal-enabled-toggle" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Globe className="w-4 h-4" />Branding</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Company Name</Label><Input value={config.branding?.company_name || ""} onChange={e => setConfig({ ...config, branding: { ...config.branding, company_name: e.target.value } })} /></div>
                      <div><Label>Primary Color</Label><Input type="color" value={config.branding?.primary_color || "#3b82f6"} onChange={e => setConfig({ ...config, branding: { ...config.branding, primary_color: e.target.value } })} className="h-10" /></div>
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Shield className="w-4 h-4" />Portal Features</h4>
                    <div className="space-y-2">
                      {[
                        { key: "can_create_tickets", label: "Create Tickets", desc: "Clients can submit new support tickets", icon: Ticket },
                        { key: "can_view_devices", label: "View Devices", desc: "Clients can see their device status", icon: Monitor },
                        { key: "can_view_invoices", label: "View Invoices", desc: "Clients can view billing invoices", icon: FileText },
                        { key: "can_view_contracts", label: "View Contracts", desc: "Clients can see active contracts", icon: FileText },
                        { key: "can_view_kb", label: "Knowledge Base", desc: "Access to self-help articles", icon: Globe },
                      ].map(f => (
                        <div key={f.key} className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/30" data-testid={`feature-${f.key}`}>
                          <div className="flex items-center gap-2">
                            <f.icon className="w-4 h-4 text-muted-foreground" />
                            <div><p className="text-sm">{f.label}</p><p className="text-[10px] text-muted-foreground">{f.desc}</p></div>
                          </div>
                          <Switch checked={!!config.features?.[f.key]} onCheckedChange={v => setConfig({ ...config, features: { ...config.features, [f.key]: v } })} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button onClick={saveConfig} data-testid="save-portal-config-btn">Save Configuration</Button>
                </CardContent>
              </Card>

              {/* Access Tokens */}
              <Card data-testid="portal-tokens-panel">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><Key className="w-5 h-5" />Access Tokens</CardTitle>
                    <Button size="sm" onClick={() => { setTokenForm({ contact_name: "", contact_email: "", expiry_days: 90 }); setShowGenToken(true); }} data-testid="generate-token-btn"><Plus className="w-3 h-3 mr-1" />Generate Token</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {newTokenUrl && (
                    <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 mb-4" data-testid="new-portal-url">
                      <p className="text-sm font-medium text-emerald-400 mb-1">New Portal Link (share with client):</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-muted px-3 py-2 rounded font-mono text-sm">{window.location.origin}{newTokenUrl}</code>
                        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${newTokenUrl}`); toast.success("Copied"); }}><Copy className="w-3 h-3" /></Button>
                      </div>
                      <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setNewTokenUrl(null)}>Dismiss</Button>
                    </div>
                  )}
                  {(config.access_tokens || []).length > 0 ? (
                    <div className="space-y-2">
                      {config.access_tokens.map(t => (
                        <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30" data-testid={`token-${t.id}`}>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Key className="w-5 h-5 text-blue-500" /></div>
                            <div>
                              <p className="text-sm font-medium">{t.contact_name || "Anonymous"}</p>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                {t.contact_email && <span>{t.contact_email}</span>}
                                <span>Created: {t.created_at?.split("T")[0]}</span>
                                <span>Expires: {t.expires_at?.split("T")[0]}</span>
                                {t.last_used && <span>Last used: {t.last_used.split("T")[0]}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => window.open(`/portal/${t.token}`, "_blank")}><ExternalLink className="w-3 h-3 mr-1" />Open</Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => revokeToken(t.id)}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Key className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" />
                      <p className="text-sm text-muted-foreground">No access tokens generated</p>
                      <p className="text-xs text-muted-foreground mt-1">Generate a token to create a shareable portal link for this client</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Portal Users */}
              <Card data-testid="portal-users-panel">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" />Portal Users ({portalUsers.length})</CardTitle>
                    <Button size="sm" onClick={() => setShowAddUser(true)} data-testid="add-portal-user-btn"><UserPlus className="w-3 h-3 mr-1" />Add User</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Temp password notification */}
                  {showTempPassword && (
                    <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 mb-4" data-testid="temp-password-box">
                      <p className="text-sm font-medium text-amber-400 mb-1">Temporary Password for {showTempPassword.email}:</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-muted px-3 py-2 rounded font-mono text-sm">{showTempPassword.password}</code>
                        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(showTempPassword.password); toast.success("Password copied"); }}><Copy className="w-3 h-3" /></Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">Share this password with the user. They can change it after logging in. Portal login: <code className="text-xs">{window.location.origin}/portal-login</code></p>
                      <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setShowTempPassword(null)}>Dismiss</Button>
                    </div>
                  )}

                  {portalUsers.length > 0 ? (
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Permissions</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {portalUsers.map(u => (
                          <TableRow key={u.id} data-testid={`portal-user-${u.id}`}>
                            <TableCell className="font-medium text-sm">{u.name || "—"}</TableCell>
                            <TableCell className="text-sm">{u.email}</TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px] capitalize">{u.role}</Badge></TableCell>
                            <TableCell>
                              <div className="flex gap-1 flex-wrap">
                                {u.can_create_tickets && <Badge variant="secondary" className="text-[9px]">Tickets</Badge>}
                                {u.can_view_assets && <Badge variant="secondary" className="text-[9px]">Devices</Badge>}
                                {u.can_view_invoices && <Badge variant="secondary" className="text-[9px]">Invoices</Badge>}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge className={u.is_active !== false ? "bg-emerald-500/10 text-emerald-500 text-[9px]" : "bg-red-500/10 text-red-500 text-[9px]"}>
                                {u.is_active !== false ? "Active" : "Disabled"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Edit" onClick={() => { setShowEditUser(u); setEditUserForm({ name: u.name, role: u.role, can_view_all_tickets: u.can_view_all_tickets, can_create_tickets: u.can_create_tickets, can_view_assets: u.can_view_assets, can_view_invoices: u.can_view_invoices, is_active: u.is_active !== false }); }}><Settings className="w-3 h-3" /></Button>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Reset Password" onClick={() => resetPassword(u.id)}><RotateCw className="w-3 h-3 text-amber-400" /></Button>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="Delete" onClick={() => deletePortalUser(u.id)}><Trash2 className="w-3 h-3" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8">
                      <Users className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" />
                      <p className="text-sm text-muted-foreground">No portal users for this client</p>
                      <p className="text-xs text-muted-foreground mt-1">Add users to give them login-based access to the V2 portal</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <Globe className="w-16 h-16 mx-auto text-muted-foreground mb-4 opacity-30" />
                <p className="text-lg font-medium text-muted-foreground">Select a client to configure their portal</p>
                <p className="text-sm text-muted-foreground mt-1">Each client can have a branded self-service portal with customizable features</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Generate Token Dialog */}
      <Dialog open={showGenToken} onOpenChange={setShowGenToken}>
        <DialogContent aria-describedby="gen-token-desc">
          <DialogHeader><DialogTitle>Generate Portal Access Token</DialogTitle><DialogDescription id="gen-token-desc">Create a unique access link for a client contact.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Create a unique access link for a client contact. They'll use this to access the self-service portal.</p>
            <div><Label>Contact Name</Label><Input value={tokenForm.contact_name} onChange={e => setTokenForm({ ...tokenForm, contact_name: e.target.value })} placeholder="e.g., John Smith" data-testid="token-contact-name" /></div>
            <div><Label>Contact Email</Label><Input value={tokenForm.contact_email} onChange={e => setTokenForm({ ...tokenForm, contact_email: e.target.value })} placeholder="e.g., john@acme.com" data-testid="token-contact-email" /></div>
            <div><Label>Expires In (days)</Label>
              <Select value={String(tokenForm.expiry_days)} onValueChange={v => setTokenForm({ ...tokenForm, expiry_days: parseInt(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="30">30 days</SelectItem><SelectItem value="90">90 days</SelectItem><SelectItem value="180">180 days</SelectItem><SelectItem value="365">1 year</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={generateToken} data-testid="confirm-generate-token"><Key className="w-4 h-4 mr-1" />Generate</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Portal User Dialog */}
      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent className="max-w-lg" aria-describedby="add-user-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5" />Add Portal User</DialogTitle>
            <DialogDescription id="add-user-desc">Create a login account for a client contact to access the V2 portal.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Full Name</Label><Input value={userForm.name} onChange={e => setUserForm({ ...userForm, name: e.target.value })} placeholder="John Smith" data-testid="new-user-name" /></div>
              <div><Label className="text-xs">Email</Label><Input type="email" value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })} placeholder="john@company.com" data-testid="new-user-email" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Password (leave blank for auto-generated)</Label><Input type="text" value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} placeholder="Auto-generated if empty" data-testid="new-user-password" /></div>
              <div><Label className="text-xs">Role</Label>
                <Select value={userForm.role} onValueChange={v => setUserForm({ ...userForm, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="admin">Admin (Full Access)</SelectItem><SelectItem value="user">User</SelectItem><SelectItem value="viewer">Viewer (Read Only)</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            <p className="text-xs font-semibold text-muted-foreground uppercase">Permissions</p>
            <div className="space-y-2">
              {[
                { key: "can_view_all_tickets", label: "View All Tickets", desc: "See all client tickets (not just their own)" },
                { key: "can_create_tickets", label: "Create Tickets", desc: "Submit new support tickets" },
                { key: "can_view_assets", label: "View Devices", desc: "See device status and health" },
                { key: "can_view_invoices", label: "View Invoices", desc: "Access billing information" },
              ].map(p => (
                <div key={p.key} className="flex items-center justify-between p-2 rounded border">
                  <div><p className="text-sm">{p.label}</p><p className="text-[10px] text-muted-foreground">{p.desc}</p></div>
                  <Switch checked={!!userForm[p.key]} onCheckedChange={v => setUserForm({ ...userForm, [p.key]: v })} />
                </div>
              ))}
            </div>
            <Separator />
            <div className="flex items-center justify-between p-2 rounded border border-emerald-500/20 bg-emerald-500/5">
              <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-emerald-400" /><div><p className="text-sm">Send Welcome Email</p><p className="text-[10px] text-muted-foreground">Email login credentials to the user automatically</p></div></div>
              <Switch checked={userForm.send_welcome_email} onCheckedChange={v => setUserForm({ ...userForm, send_welcome_email: v })} data-testid="send-welcome-email-toggle" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAddUser(false)}>Cancel</Button>
            <Button onClick={addPortalUser} disabled={addingUser} data-testid="confirm-add-user">
              {addingUser ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Portal User Dialog */}
      <Dialog open={!!showEditUser} onOpenChange={v => !v && setShowEditUser(null)}>
        <DialogContent className="max-w-lg" aria-describedby="edit-user-desc">
          <DialogHeader>
            <DialogTitle>Edit Portal User — {showEditUser?.name || showEditUser?.email}</DialogTitle>
            <DialogDescription id="edit-user-desc">Update permissions and settings for this portal user.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Name</Label><Input value={editUserForm.name || ""} onChange={e => setEditUserForm({ ...editUserForm, name: e.target.value })} /></div>
              <div><Label className="text-xs">Role</Label>
                <Select value={editUserForm.role || "user"} onValueChange={v => setEditUserForm({ ...editUserForm, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="user">User</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">New Password (leave blank to keep current)</Label><Input type="text" value={editUserForm.password || ""} onChange={e => setEditUserForm({ ...editUserForm, password: e.target.value })} placeholder="Leave blank to keep current" /></div>
            <div className="flex items-center justify-between p-2 rounded border">
              <div><p className="text-sm">Account Active</p><p className="text-[10px] text-muted-foreground">Disable to block login without deleting</p></div>
              <Switch checked={editUserForm.is_active !== false} onCheckedChange={v => setEditUserForm({ ...editUserForm, is_active: v })} />
            </div>
            <Separator />
            <p className="text-xs font-semibold text-muted-foreground uppercase">Permissions</p>
            {[
              { key: "can_view_all_tickets", label: "View All Tickets" },
              { key: "can_create_tickets", label: "Create Tickets" },
              { key: "can_view_assets", label: "View Devices" },
              { key: "can_view_invoices", label: "View Invoices" },
            ].map(p => (
              <div key={p.key} className="flex items-center justify-between p-2 rounded border">
                <p className="text-sm">{p.label}</p>
                <Switch checked={!!editUserForm[p.key]} onCheckedChange={v => setEditUserForm({ ...editUserForm, [p.key]: v })} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowEditUser(null)}>Cancel</Button>
            <Button onClick={updatePortalUser} data-testid="confirm-edit-user"><CheckCircle className="w-4 h-4 mr-1" />Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
