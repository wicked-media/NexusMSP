import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Users, Plus, Search, RefreshCw, Loader2, Shield, ShieldCheck,
  Trash2, Pencil, Eye, Lock, Ticket, Monitor, FileText, Copy,
  UserPlus, UserX, Mail, Clock, Building2, Settings, ExternalLink,
  CheckCircle, XCircle, Smartphone, AlertTriangle, ChevronRight
} from "lucide-react";

const PERM_DEFS = [
  { key: "can_view_all_tickets", label: "View All Tickets", desc: "See every ticket for their company", icon: Ticket },
  { key: "can_create_tickets", label: "Create Tickets", desc: "Submit new support requests", icon: Plus },
  { key: "can_view_assets", label: "View Devices", desc: "See managed devices and health", icon: Monitor },
  { key: "can_view_invoices", label: "View Invoices", desc: "Access billing and invoices", icon: FileText },
];

export default function ClientPortalAdminPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [tab, setTab] = useState("users");
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(null);
  const [showResetPw, setShowResetPw] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", client_id: "", role: "user", phone: "", is_primary_contact: false, can_view_all_tickets: false, can_create_tickets: true, can_view_assets: true, can_view_invoices: false });
  const [newPassword, setNewPassword] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, cRes, lRes] = await Promise.all([
        axios.get(`${API}/portal/users`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/client-portal/access-logs`, { headers }).catch(() => ({ data: [] })),
      ]);
      setUsers(uRes.data);
      setClients(cRes.data);
      setLogs(lRes.data);
    } catch { toast.error("Failed to load data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createUser = async (e) => {
    e.preventDefault();
    if (!form.client_id || !form.email || !form.password) { toast.error("Client, email, and password are required"); return; }
    setSubmitting(true);
    try {
      const client = clients.find(c => c.id === form.client_id);
      await axios.post(`${API}/portal/users`, { ...form, client_name: client?.name || "" }, { headers });
      toast.success(`Portal user created: ${form.email}`);
      setShowCreate(false);
      resetForm();
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to create user"); }
    finally { setSubmitting(false); }
  };

  const updateUser = async () => {
    if (!showEdit) return;
    setSubmitting(true);
    try {
      const updates = {};
      PERM_DEFS.forEach(p => { updates[p.key] = showEdit[p.key]; });
      updates.role = showEdit.role;
      updates.is_active = showEdit.is_active;
      updates.is_primary_contact = showEdit.is_primary_contact;
      updates.name = showEdit.name;
      updates.phone = showEdit.phone || "";
      await axios.put(`${API}/portal/users/${showEdit.id}`, updates, { headers });
      toast.success("User updated");
      setShowEdit(null);
      fetchData();
    } catch { toast.error("Failed to update"); }
    finally { setSubmitting(false); }
  };

  const deleteUser = async (userId, email) => {
    if (!confirm(`Permanently delete portal access for ${email}?`)) return;
    try {
      await axios.delete(`${API}/portal/users/${userId}`, { headers });
      toast.success("User deleted");
      fetchData();
    } catch { toast.error("Failed to delete"); }
  };

  const resetPassword = async () => {
    if (!showResetPw || !newPassword || newPassword.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    setSubmitting(true);
    try {
      await axios.put(`${API}/portal/users/${showResetPw.id}`, { password: newPassword }, { headers });
      toast.success("Password reset successfully");
      setShowResetPw(null);
      setNewPassword("");
    } catch { toast.error("Failed to reset password"); }
    finally { setSubmitting(false); }
  };

  const toggleActive = async (user) => {
    try {
      await axios.put(`${API}/portal/users/${user.id}`, { is_active: !user.is_active }, { headers });
      toast.success(user.is_active ? "User deactivated" : "User activated");
      fetchData();
    } catch { toast.error("Failed to update"); }
  };

  const resetForm = () => setForm({ email: "", name: "", password: "", client_id: "", role: "user", phone: "", is_primary_contact: false, can_view_all_tickets: false, can_create_tickets: true, can_view_assets: true, can_view_invoices: false });

  const copyPortalLink = () => {
    const url = `${window.location.origin}/portal-app`;
    navigator.clipboard.writeText(url);
    toast.success("Portal link copied to clipboard");
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const filtered = users.filter(u => {
    if (search && !u.name?.toLowerCase().includes(search.toLowerCase()) && !u.email?.toLowerCase().includes(search.toLowerCase())) return false;
    if (clientFilter !== "all" && u.client_id !== clientFilter) return false;
    return true;
  });

  const activeUsers = users.filter(u => u.is_active !== false);
  const with2FA = users.filter(u => u.totp_enabled);
  const clientsWithUsers = [...new Set(users.map(u => u.client_id))].length;

  return (
    <div className="space-y-5" data-testid="client-portal-admin-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center"><Users className="w-5 h-5 text-white" /></div>
            Portal User Management
          </h1>
          <p className="text-muted-foreground mt-1">Invite, manage, and control client portal access</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyPortalLink} data-testid="copy-portal-link"><Copy className="w-4 h-4 mr-2" />Copy Portal Link</Button>
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Button onClick={() => setShowCreate(true)} data-testid="invite-user-btn"><UserPlus className="w-4 h-4 mr-2" />Invite User</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Users", value: users.length, icon: Users, color: "text-blue-400" },
          { label: "Active", value: activeUsers.length, icon: CheckCircle, color: "text-emerald-400" },
          { label: "With 2FA", value: with2FA.length, icon: ShieldCheck, color: "text-purple-400" },
          { label: "Clients", value: clientsWithUsers, icon: Building2, color: "text-cyan-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="users">Users ({users.length})</TabsTrigger>
          <TabsTrigger value="byClient">By Client</TabsTrigger>
          <TabsTrigger value="activity">Activity Log ({logs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="user-search" />
            </div>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="All Clients" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Card className="border-border/40">
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>User</TableHead><TableHead>Client</TableHead><TableHead>Role</TableHead>
                  <TableHead className="text-center">Permissions</TableHead><TableHead className="text-center">2FA</TableHead>
                  <TableHead>Last Login</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No portal users found</TableCell></TableRow>
                  ) : filtered.map(u => (
                    <TableRow key={u.id} data-testid={`portal-user-${u.id}`}>
                      <TableCell>
                        <div>
                          <p className="font-semibold text-sm">{u.name}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{u.client_name || "—"}</Badge></TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] capitalize ${u.role === "admin" ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400"}`}>
                          {u.role}
                        </Badge>
                        {u.is_primary_contact && <Badge variant="outline" className="text-[10px] ml-1">Primary</Badge>}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {u.can_view_all_tickets && <Ticket className="w-3 h-3 text-muted-foreground" title="View Tickets" />}
                          {u.can_create_tickets && <Plus className="w-3 h-3 text-muted-foreground" title="Create Tickets" />}
                          {u.can_view_assets && <Monitor className="w-3 h-3 text-muted-foreground" title="View Devices" />}
                          {u.can_view_invoices && <FileText className="w-3 h-3 text-muted-foreground" title="View Invoices" />}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {u.totp_enabled ? <ShieldCheck className="w-4 h-4 text-emerald-400 mx-auto" /> : <Shield className="w-4 h-4 text-muted-foreground/30 mx-auto" />}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{u.last_login ? new Date(u.last_login).toLocaleDateString() : "Never"}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] cursor-pointer ${u.is_active !== false ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`} onClick={() => toggleActive(u)} data-testid={`toggle-active-${u.id}`}>
                          {u.is_active !== false ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowEdit({ ...u })} data-testid={`edit-${u.id}`}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowResetPw(u)} data-testid={`reset-pw-${u.id}`}><Lock className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={() => deleteUser(u.id, u.email)} data-testid={`delete-${u.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="byClient" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            {clients.filter(c => users.some(u => u.client_id === c.id)).map(c => {
              const clientUsers = users.filter(u => u.client_id === c.id);
              return (
                <Card key={c.id} className="border-border/40">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-400" />{c.name}</CardTitle>
                      <Badge variant="outline">{clientUsers.length} user{clientUsers.length !== 1 ? "s" : ""}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {clientUsers.map(u => (
                      <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className={`w-2 h-2 rounded-full ${u.is_active !== false ? "bg-emerald-400" : "bg-red-400"}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{u.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] capitalize">{u.role}</Badge>
                        {u.totp_enabled && <ShieldCheck className="w-3 h-3 text-emerald-400" />}
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowEdit({ ...u })}><Pencil className="w-3 h-3" /></Button>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => { setForm({ ...form, client_id: c.id }); setShowCreate(true); }}>
                      <Plus className="w-3 h-3 mr-1" />Add User to {c.name}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
            {clients.filter(c => !users.some(u => u.client_id === c.id)).length > 0 && (
              <Card className="border-dashed border-border/30">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Clients Without Portal Access</CardTitle></CardHeader>
                <CardContent className="space-y-1">
                  {clients.filter(c => !users.some(u => u.client_id === c.id)).map(c => (
                    <div key={c.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/20 transition-colors">
                      <span className="text-sm text-muted-foreground">{c.name}</span>
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setForm({ ...form, client_id: c.id }); setShowCreate(true); }}>
                        <Plus className="w-3 h-3 mr-1" />Invite
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" />Recent Portal Activity</CardTitle></CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No portal activity recorded yet</p>
              ) : (
                <ScrollArea className="h-80">
                  <div className="space-y-2">
                    {logs.map((l, i) => (
                      <div key={l.id || i} className="flex items-center gap-3 p-2 rounded-lg border border-border/20" data-testid={`log-${l.id || i}`}>
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"><Eye className="w-4 h-4 text-muted-foreground" /></div>
                        <div className="flex-1">
                          <p className="text-sm"><strong>{l.user_email}</strong> <span className="text-muted-foreground">{l.action?.replace(/_/g, " ")}</span></p>
                          <p className="text-[10px] text-muted-foreground">{l.client_name}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{l.timestamp ? new Date(l.timestamp).toLocaleString() : ""}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create User Dialog */}
      <Dialog open={showCreate} onOpenChange={v => { if (!v) { setShowCreate(false); resetForm(); } else setShowCreate(true); }}>
        <DialogContent className="max-w-md" aria-describedby="create-user-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5 text-blue-400" />Invite Portal User</DialogTitle>
            <DialogDescription id="create-user-desc">Create a new client portal login</DialogDescription>
          </DialogHeader>
          <form onSubmit={createUser} className="space-y-4">
            <div className="space-y-2">
              <Label>Client *</Label>
              <Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                <SelectTrigger data-testid="select-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Full Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="John Smith" required data-testid="user-name-input" /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+1..." /></div>
            </div>
            <div className="space-y-2"><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="user@client.com" required data-testid="user-email-input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Password *</Label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Min 6 chars" required minLength={6} data-testid="user-password-input" /></div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="user">User</SelectItem><SelectItem value="admin">Client Admin</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Permissions</p>
              {PERM_DEFS.map(p => {
                const Icon = p.icon;
                return (
                  <div key={p.key} className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Icon className="w-4 h-4 text-muted-foreground" /><div><p className="text-sm">{p.label}</p><p className="text-[10px] text-muted-foreground">{p.desc}</p></div></div>
                    <Switch checked={form[p.key]} onCheckedChange={v => setForm({ ...form, [p.key]: v })} />
                  </div>
                );
              })}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Shield className="w-4 h-4 text-muted-foreground" /><div><p className="text-sm">Primary Contact</p><p className="text-[10px] text-muted-foreground">Main point of contact for this client</p></div></div>
                <Switch checked={form.is_primary_contact} onCheckedChange={v => setForm({ ...form, is_primary_contact: v })} />
              </div>
            </div>
            <DialogFooter><Button type="submit" disabled={submitting} data-testid="submit-create-user">{submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}Create User</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!showEdit} onOpenChange={() => setShowEdit(null)}>
        <DialogContent className="max-w-md" aria-describedby="edit-user-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="w-5 h-5 text-amber-400" />Edit Portal User</DialogTitle>
            <DialogDescription id="edit-user-desc">{showEdit?.email}</DialogDescription>
          </DialogHeader>
          {showEdit && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Name</Label><Input value={showEdit.name} onChange={e => setShowEdit({ ...showEdit, name: e.target.value })} data-testid="edit-name" /></div>
                <div className="space-y-2"><Label>Phone</Label><Input value={showEdit.phone || ""} onChange={e => setShowEdit({ ...showEdit, phone: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={showEdit.role} onValueChange={v => setShowEdit({ ...showEdit, role: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="user">User</SelectItem><SelectItem value="admin">Client Admin</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={showEdit.is_active !== false ? "active" : "inactive"} onValueChange={v => setShowEdit({ ...showEdit, is_active: v === "active" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Permissions</p>
                {PERM_DEFS.map(p => {
                  const Icon = p.icon;
                  return (
                    <div key={p.key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><Icon className="w-4 h-4 text-muted-foreground" /><p className="text-sm">{p.label}</p></div>
                      <Switch checked={showEdit[p.key]} onCheckedChange={v => setShowEdit({ ...showEdit, [p.key]: v })} />
                    </div>
                  );
                })}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Shield className="w-4 h-4 text-muted-foreground" /><p className="text-sm">Primary Contact</p></div>
                  <Switch checked={showEdit.is_primary_contact} onCheckedChange={v => setShowEdit({ ...showEdit, is_primary_contact: v })} />
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Smartphone className="w-3 h-3" />2FA: {showEdit.totp_enabled ? <span className="text-emerald-400 font-semibold">Enabled</span> : <span>Not set up</span>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowEdit(null)}>Cancel</Button>
                <Button onClick={updateUser} disabled={submitting} data-testid="save-edit-user">{submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save Changes</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!showResetPw} onOpenChange={() => { setShowResetPw(null); setNewPassword(""); }}>
        <DialogContent className="max-w-sm" aria-describedby="reset-pw-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="w-5 h-5 text-red-400" />Reset Password</DialogTitle>
            <DialogDescription id="reset-pw-desc">Set a new password for {showResetPw?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>New Password</Label><Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 6 characters" minLength={6} data-testid="new-password-input" /></div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowResetPw(null); setNewPassword(""); }}>Cancel</Button>
              <Button onClick={resetPassword} disabled={submitting || newPassword.length < 6} data-testid="confirm-reset-pw">{submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}Reset Password</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
