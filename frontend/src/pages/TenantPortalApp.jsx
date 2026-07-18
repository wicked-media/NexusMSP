import { useState, useEffect, useCallback, createContext, useContext } from "react";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast, Toaster } from "sonner";
import {
  Ticket, Monitor, FileText, HardDrive, Shield, BarChart3,
  Home, LogOut, User, Lock, Loader2, Plus, CheckCircle, XCircle,
  Clock, AlertTriangle, Wifi, WifiOff, DollarSign, Eye,
  Settings, Smartphone, ChevronRight, Building2, Cpu, MemoryStick
} from "lucide-react";
import { secureStorage } from "@/lib/secureStorage";

const API = process.env.REACT_APP_BACKEND_URL + "/api/portal/v2";

// --- Portal Auth Context ---
const PortalAuthCtx = createContext(null);
const usePortalAuth = () => useContext(PortalAuthCtx);

function PortalAuthProvider({ children }) {
  const [token, setToken] = useState(() => secureStorage.getItem("portal_token"));
  const [user, setUser] = useState(() => { try { return JSON.parse(secureStorage.getItem("portal_user")); } catch { return null; } });
  const [profile, setProfile] = useState(null);

  const login = (t, u) => { secureStorage.setItem("portal_token", t); secureStorage.setItem("portal_user", JSON.stringify(u)); setToken(t); setUser(u); };
  const logout = () => { secureStorage.removeItem("portal_token"); secureStorage.removeItem("portal_user"); setToken(null); setUser(null); setProfile(null); };

  useEffect(() => {
    if (token) {
      axios.get(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => setProfile(r.data))
        .catch(() => logout());
    }
  }, [token]);

  return <PortalAuthCtx.Provider value={{ token, user, profile, login, logout }}>{children}</PortalAuthCtx.Provider>;
}

// --- Login Page ---
function PortalLogin() {
  const { login } = usePortalAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [tempToken, setTempToken] = useState("");
  const [code, setCode] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await axios.post(`${API}/login`, { email, password });
      if (data.requires_2fa) {
        setTempToken(data.temp_token);
        setShow2FA(true);
      } else {
        login(data.token, data.user);
        toast.success("Welcome back!");
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Login failed");
    } finally { setLoading(false); }
  };

  const handle2FA = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await axios.post(`${API}/verify-2fa`, { temp_token: tempToken, code });
      login(data.token, data.user);
      toast.success("Welcome back!");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Invalid code");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4" data-testid="portal-login-page">
      <Toaster position="top-right" richColors />
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-900/80 backdrop-blur">
        <CardHeader className="text-center space-y-3 pb-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <div>
            <CardTitle className="text-xl text-white">Client Portal</CardTitle>
            <p className="text-sm text-zinc-400 mt-1">{show2FA ? "Enter your 2FA code" : "Sign in to access your IT dashboard"}</p>
          </div>
        </CardHeader>
        <CardContent>
          {!show2FA ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2"><Label className="text-zinc-300">Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required className="bg-zinc-800 border-zinc-700" data-testid="portal-email" /></div>
              <div className="space-y-2"><Label className="text-zinc-300">Password</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" required className="bg-zinc-800 border-zinc-700" data-testid="portal-password" /></div>
              <Button type="submit" className="w-full" disabled={loading} data-testid="portal-login-btn">{loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}{loading ? "Signing in..." : "Sign In"}</Button>
            </form>
          ) : (
            <form onSubmit={handle2FA} className="space-y-4">
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
                <Smartphone className="w-6 h-6 mx-auto text-blue-400 mb-1" />
                <p className="text-xs text-blue-300">Open your authenticator app and enter the 6-digit code</p>
              </div>
              <div className="space-y-2"><Label className="text-zinc-300">Authentication Code</Label><Input value={code} onChange={e => setCode(e.target.value)} placeholder="000000" maxLength={6} className="bg-zinc-800 border-zinc-700 text-center text-2xl tracking-[0.3em] font-mono" required data-testid="portal-2fa-code" /></div>
              <Button type="submit" className="w-full" disabled={loading} data-testid="portal-2fa-btn">{loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}{loading ? "Verifying..." : "Verify"}</Button>
              <Button type="button" variant="ghost" className="w-full text-zinc-400" onClick={() => setShow2FA(false)}>Back to login</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// --- Portal Layout ---
function PortalLayout({ children, activePage, setPage }) {
  const { user, profile, logout } = usePortalAuth();
  const branding = profile?.branding || {};
  const mspBranding = profile?.msp_branding || {};
  const clientName = profile?.client?.name || user?.client_name || "Client";
  const pages = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "tickets", label: "Tickets", icon: Ticket },
    { id: "devices", label: "Devices", icon: Monitor },
    { id: "invoices", label: "Invoices", icon: FileText },
    { id: "backups", label: "Backups", icon: HardDrive },
    { id: "compliance", label: "Compliance", icon: Shield },
    { id: "qbr", label: "QBR Reports", icon: BarChart3 },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 flex" data-testid="portal-layout">
      <Toaster position="top-right" richColors />
      {/* Sidebar */}
      <div className="w-56 bg-zinc-900/80 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt="Logo" className="h-8 object-contain" />
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center"><Building2 className="w-4 h-4 text-white" /></div>
              <span className="text-sm font-bold text-white truncate">{mspBranding.company_name || "NexusOps"}</span>
            </div>
          )}
          <p className="text-[10px] text-zinc-500 mt-1 truncate">{clientName}</p>
        </div>
        <ScrollArea className="flex-1 py-2">
          {pages.map(p => {
            const Icon = p.icon;
            return (
              <button key={p.id} onClick={() => setPage(p.id)} className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${activePage === p.id ? "bg-primary/10 text-primary border-r-2 border-primary" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"}`} data-testid={`portal-nav-${p.id}`}>
                <Icon className="w-4 h-4" />{p.label}
              </button>
            );
          })}
        </ScrollArea>
        <div className="p-3 border-t border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center"><User className="w-3.5 h-3.5 text-primary" /></div>
            <div className="flex-1 min-w-0"><p className="text-xs font-medium text-white truncate">{user?.name}</p><p className="text-[10px] text-zinc-500 truncate">{user?.email}</p></div>
          </div>
          <Button variant="ghost" size="sm" className="w-full text-zinc-400 hover:text-red-400 justify-start" onClick={logout} data-testid="portal-logout"><LogOut className="w-3.5 h-3.5 mr-2" />Sign Out</Button>
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-auto p-6">{children}</div>
    </div>
  );
}

// --- Dashboard View ---
function PortalDashboard({ goTo }) {
  const { token, user, profile } = usePortalAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    axios.get(`${API}/dashboard`, { headers: { Authorization: `Bearer ${token}` } }).then(r => setStats(r.data.stats)).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  if (loading || !stats) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="portal-dashboard">
      <div><h1 className="text-2xl font-bold text-white">Welcome, {user?.name}</h1><p className="text-sm text-zinc-400">{profile?.client?.name} — IT Service Dashboard</p></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Open Tickets", value: stats.open_tickets, icon: Ticket, color: "text-blue-400", bg: "bg-blue-500/10", click: () => goTo("tickets") },
          { label: "Devices Online", value: `${stats.online_devices}/${stats.total_devices}`, icon: Monitor, color: "text-emerald-400", bg: "bg-emerald-500/10", click: () => goTo("devices") },
          { label: "Outstanding", value: `$${stats.outstanding_invoices.toLocaleString()}`, icon: DollarSign, color: stats.outstanding_invoices > 0 ? "text-red-400" : "text-emerald-400", bg: stats.outstanding_invoices > 0 ? "bg-red-500/10" : "bg-emerald-500/10", click: () => goTo("invoices") },
          { label: "Resolved", value: stats.resolved_tickets, icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10", click: () => goTo("tickets") },
        ].map(s => (
          <Card key={s.label} className="bg-zinc-900/50 border-zinc-800 cursor-pointer hover:border-zinc-600 transition-colors" onClick={s.click}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><s.icon className={`w-5 h-5 ${s.color}`} /><ChevronRight className="w-4 h-4 text-zinc-600" /></div>
              <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { id: "backups", label: "Backup Status", icon: HardDrive, desc: "View backup health", color: "text-cyan-400" },
          { id: "compliance", label: "Compliance", icon: Shield, desc: "Security posture", color: "text-emerald-400" },
          { id: "qbr", label: "QBR Reports", icon: BarChart3, desc: "Quarterly reviews", color: "text-purple-400" },
        ].map(c => (
          <Card key={c.id} className="bg-zinc-900/50 border-zinc-800 cursor-pointer hover:border-zinc-600 transition-colors" onClick={() => goTo(c.id)}>
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center"><c.icon className={`w-5 h-5 ${c.color}`} /></div>
              <div><p className="text-sm font-semibold text-white">{c.label}</p><p className="text-[10px] text-zinc-500">{c.desc}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// --- Tickets View ---
function PortalTickets() {
  const { token } = usePortalAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "support", priority: "medium" });
  const [submitting, setSubmitting] = useState(false);
  const fetch = useCallback(() => { setLoading(true); axios.get(`${API}/tickets`, { headers: { Authorization: `Bearer ${token}` } }).then(r => setTickets(r.data)).catch(() => {}).finally(() => setLoading(false)); }, [token]);
  useEffect(() => { fetch(); }, [fetch]);

  const createTicket = async (e) => {
    e.preventDefault(); setSubmitting(true);
    try { await axios.post(`${API}/tickets`, form, { headers: { Authorization: `Bearer ${token}` } }); toast.success("Ticket submitted!"); setShowCreate(false); setForm({ title: "", description: "", category: "support", priority: "medium" }); fetch(); }
    catch { toast.error("Failed to create ticket"); } finally { setSubmitting(false); }
  };

  const statusColor = (s) => s === "open" ? "bg-blue-500/20 text-blue-400" : s === "in_progress" ? "bg-amber-500/20 text-amber-400" : s === "resolved" || s === "closed" ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-500/20 text-zinc-400";
  const prioColor = (p) => p === "critical" ? "text-red-400" : p === "high" ? "text-orange-400" : p === "medium" ? "text-amber-400" : "text-blue-400";

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  return (
    <div className="space-y-4" data-testid="portal-tickets">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold text-white">Support Tickets</h1><Button onClick={() => setShowCreate(true)} data-testid="portal-create-ticket"><Plus className="w-4 h-4 mr-2" />New Ticket</Button></div>
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="border-zinc-800"><TableHead className="text-zinc-400">#</TableHead><TableHead className="text-zinc-400">Title</TableHead><TableHead className="text-zinc-400">Priority</TableHead><TableHead className="text-zinc-400">Status</TableHead><TableHead className="text-zinc-400">Created</TableHead></TableRow></TableHeader>
            <TableBody>
              {tickets.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-zinc-500">No tickets found</TableCell></TableRow> :
                tickets.map(t => (
                  <TableRow key={t.id} className="border-zinc-800" data-testid={`portal-ticket-${t.id}`}>
                    <TableCell className="font-mono text-xs text-zinc-400">{t.ticket_number}</TableCell>
                    <TableCell className="text-sm text-white font-medium">{t.title || t.subject}</TableCell>
                    <TableCell><span className={`text-xs font-semibold capitalize ${prioColor(t.priority)}`}>{t.priority}</span></TableCell>
                    <TableCell><Badge className={`${statusColor(t.status)} text-[10px] capitalize`}>{t.status?.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-xs text-zinc-500">{t.created_at ? new Date(t.created_at).toLocaleDateString() : ""}</TableCell>
                  </TableRow>
                ))
              }
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-zinc-900 border-zinc-800" aria-describedby="create-ticket-desc">
          <DialogHeader><DialogTitle className="text-white">Submit a Support Ticket</DialogTitle><DialogDescription id="create-ticket-desc">Describe your issue and we'll get back to you</DialogDescription></DialogHeader>
          <form onSubmit={createTicket} className="space-y-4">
            <div className="space-y-2"><Label className="text-zinc-300">Subject *</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Brief description of the issue" required className="bg-zinc-800 border-zinc-700" data-testid="ticket-title" /></div>
            <div className="space-y-2"><Label className="text-zinc-300">Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Provide details..." rows={4} className="bg-zinc-800 border-zinc-700" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label className="text-zinc-300">Category</Label><Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}><SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="support">Support</SelectItem><SelectItem value="hardware">Hardware</SelectItem><SelectItem value="software">Software</SelectItem><SelectItem value="network">Network</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label className="text-zinc-300">Priority</Label><Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}><SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select></div>
            </div>
            <DialogFooter><Button type="submit" disabled={submitting} data-testid="submit-ticket-btn">{submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}Submit Ticket</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Devices View ---
function PortalDevices() {
  const { token } = usePortalAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/devices`, { headers }).then(r => setDevices(r.data)).catch(() => {}).finally(() => setLoading(false)); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  const usageColor = v => !v ? "text-zinc-500" : v >= 90 ? "text-red-400 font-bold" : v >= 70 ? "text-amber-400" : "text-emerald-400";
  return (
    <div className="space-y-4" data-testid="portal-devices">
      <h1 className="text-2xl font-bold text-white">Your Devices</h1>
      <div className="grid grid-cols-3 gap-3 mb-2">
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center"><p className="text-xl font-black text-emerald-400">{devices.filter(d => d.status === "online").length}</p><p className="text-[10px] text-zinc-400">Online</p></div>
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-center"><p className="text-xl font-black text-amber-400">{devices.filter(d => d.status === "warning").length}</p><p className="text-[10px] text-zinc-400">Warning</p></div>
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center"><p className="text-xl font-black text-red-400">{devices.filter(d => d.status === "offline").length}</p><p className="text-[10px] text-zinc-400">Offline</p></div>
      </div>
      <Card className="bg-zinc-900/50 border-zinc-800"><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow className="border-zinc-800"><TableHead className="text-zinc-400">Device</TableHead><TableHead className="text-zinc-400">Type</TableHead><TableHead className="text-zinc-400">OS</TableHead><TableHead className="text-zinc-400 text-center">CPU</TableHead><TableHead className="text-zinc-400 text-center">RAM</TableHead><TableHead className="text-zinc-400 text-center">Disk</TableHead><TableHead className="text-zinc-400">Status</TableHead></TableRow></TableHeader>
          <TableBody>{devices.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-zinc-500">No devices</TableCell></TableRow> : devices.map(d => (
            <TableRow key={d.id} className="border-zinc-800" data-testid={`portal-device-${d.id}`}>
              <TableCell className="text-sm text-white font-medium">{d.name || d.hostname}</TableCell>
              <TableCell className="text-xs text-zinc-400 capitalize">{d.device_type}</TableCell>
              <TableCell className="text-xs text-zinc-400">{d.os}</TableCell>
              <TableCell className={`text-center text-xs font-mono ${usageColor(d.cpu_usage)}`}>{d.cpu_usage ? `${Math.round(d.cpu_usage)}%` : "-"}</TableCell>
              <TableCell className={`text-center text-xs font-mono ${usageColor(d.memory_usage)}`}>{d.memory_usage ? `${Math.round(d.memory_usage)}%` : "-"}</TableCell>
              <TableCell className={`text-center text-xs font-mono ${usageColor(d.disk_usage)}`}>{d.disk_usage ? `${Math.round(d.disk_usage)}%` : "-"}</TableCell>
              <TableCell><div className="flex items-center gap-1">{d.status === "online" ? <Wifi className="w-3 h-3 text-emerald-400" /> : <WifiOff className="w-3 h-3 text-red-400" />}<span className={`text-xs capitalize ${d.status === "online" ? "text-emerald-400" : d.status === "warning" ? "text-amber-400" : "text-red-400"}`}>{d.status}</span></div></TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// --- Invoices View ---
function PortalInvoices() {
  const { token } = usePortalAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { axios.get(`${API}/invoices`, { headers: { Authorization: `Bearer ${token}` } }).then(r => setInvoices(r.data)).catch(() => {}).finally(() => setLoading(false)); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  const statusColor = (s) => s === "paid" ? "bg-emerald-500/20 text-emerald-400" : s === "overdue" ? "bg-red-500/20 text-red-400" : s === "sent" ? "bg-blue-500/20 text-blue-400" : "bg-zinc-500/20 text-zinc-400";
  return (
    <div className="space-y-4" data-testid="portal-invoices">
      <h1 className="text-2xl font-bold text-white">Invoices</h1>
      <Card className="bg-zinc-900/50 border-zinc-800"><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow className="border-zinc-800"><TableHead className="text-zinc-400">#</TableHead><TableHead className="text-zinc-400">Status</TableHead><TableHead className="text-zinc-400 text-right">Amount</TableHead><TableHead className="text-zinc-400">Due Date</TableHead><TableHead className="text-zinc-400">Paid</TableHead></TableRow></TableHeader>
          <TableBody>{invoices.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-zinc-500">No invoices</TableCell></TableRow> : invoices.map(i => (
            <TableRow key={i.id} className="border-zinc-800"><TableCell className="font-mono text-xs text-zinc-400">{i.invoice_number}</TableCell><TableCell><Badge className={`${statusColor(i.status)} text-[10px] capitalize`}>{i.status}</Badge></TableCell><TableCell className="text-right font-mono text-sm text-white">${i.total?.toLocaleString()}</TableCell><TableCell className="text-xs text-zinc-400">{i.due_date || "-"}</TableCell><TableCell className="text-xs text-zinc-400">{i.paid_date || "-"}</TableCell></TableRow>
          ))}</TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// --- Backups View ---
function PortalBackups() {
  const { token } = usePortalAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { axios.get(`${API}/backups`, { headers: { Authorization: `Bearer ${token}` } }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false)); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!data) return <div className="text-center py-12 text-zinc-500">No backup data available</div>;
  const s = data.summary;
  return (
    <div className="space-y-4" data-testid="portal-backups">
      <h1 className="text-2xl font-bold text-white">Backup Status</h1>
      <div className="grid grid-cols-4 gap-3">
        <Card className="bg-zinc-900/50 border-zinc-800"><CardContent className="pt-4 pb-3 text-center"><p className={`text-2xl font-black ${s.success_rate >= 90 ? "text-emerald-400" : s.success_rate >= 70 ? "text-amber-400" : "text-red-400"}`}>{s.success_rate}%</p><p className="text-[10px] text-zinc-500">Success Rate</p></CardContent></Card>
        <Card className="bg-zinc-900/50 border-zinc-800"><CardContent className="pt-4 pb-3 text-center"><p className="text-2xl font-black text-emerald-400">{s.successful}</p><p className="text-[10px] text-zinc-500">Successful</p></CardContent></Card>
        <Card className="bg-zinc-900/50 border-zinc-800"><CardContent className="pt-4 pb-3 text-center"><p className="text-2xl font-black text-red-400">{s.failed}</p><p className="text-[10px] text-zinc-500">Failed</p></CardContent></Card>
        <Card className="bg-zinc-900/50 border-zinc-800"><CardContent className="pt-4 pb-3 text-center"><p className="text-2xl font-black text-blue-400">{s.total}</p><p className="text-[10px] text-zinc-500">Total Jobs</p></CardContent></Card>
      </div>
      <Card className="bg-zinc-900/50 border-zinc-800"><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow className="border-zinc-800"><TableHead className="text-zinc-400">Job</TableHead><TableHead className="text-zinc-400">Type</TableHead><TableHead className="text-zinc-400">Status</TableHead><TableHead className="text-zinc-400">Last Run</TableHead></TableRow></TableHeader>
          <TableBody>{data.jobs.map((j, i) => (
            <TableRow key={j.id || i} className="border-zinc-800"><TableCell className="text-sm text-white">{j.job_name || j.device_name || `Job ${i + 1}`}</TableCell><TableCell className="text-xs text-zinc-400 capitalize">{j.backup_type || j.vendor || "-"}</TableCell><TableCell><Badge className={`text-[10px] ${j.status === "success" ? "bg-emerald-500/20 text-emerald-400" : j.status === "failed" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"}`}>{j.status}</Badge></TableCell><TableCell className="text-xs text-zinc-400">{j.last_run ? new Date(j.last_run).toLocaleString() : "-"}</TableCell></TableRow>
          ))}</TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// --- Compliance View ---
function PortalCompliance() {
  const { token } = usePortalAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { axios.get(`${API}/compliance`, { headers: { Authorization: `Bearer ${token}` } }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false)); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  return (
    <div className="space-y-4" data-testid="portal-compliance">
      <h1 className="text-2xl font-bold text-white">Compliance Posture</h1>
      <div className="space-y-3">
        {(data?.frameworks || []).map(fw => (
          <Card key={fw.id || fw.name} className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><Shield className={`w-4 h-4 ${fw.compliance_pct >= 80 ? "text-emerald-400" : fw.compliance_pct >= 60 ? "text-amber-400" : "text-red-400"}`} /><span className="text-sm font-semibold text-white">{fw.name}</span></div>
                <span className={`text-lg font-black ${fw.compliance_pct >= 80 ? "text-emerald-400" : fw.compliance_pct >= 60 ? "text-amber-400" : "text-red-400"}`}>{Math.round(fw.compliance_pct)}%</span>
              </div>
              <Progress value={fw.compliance_pct} className="h-2" />
              <div className="flex items-center justify-between mt-1.5 text-[10px] text-zinc-500">
                <span>{fw.controls_met || 0} / {fw.controls_total || 0} controls met</span>
                <span>{(fw.controls_total || 0) - (fw.controls_met || 0)} gaps</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {(!data?.frameworks || data.frameworks.length === 0) && <p className="text-center py-8 text-zinc-500">No compliance data available</p>}
      </div>
    </div>
  );
}

// --- QBR View ---
function PortalQBR() {
  const { token } = usePortalAuth();
  const [qbrs, setQbrs] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { axios.get(`${API}/qbr`, { headers: { Authorization: `Bearer ${token}` } }).then(r => setQbrs(r.data)).catch(() => {}).finally(() => setLoading(false)); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  return (
    <div className="space-y-4" data-testid="portal-qbr">
      <h1 className="text-2xl font-bold text-white">Quarterly Business Reviews</h1>
      {qbrs.length === 0 ? <Card className="bg-zinc-900/50 border-zinc-800"><CardContent className="py-12 text-center text-zinc-500"><BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No QBR reports available yet</p></CardContent></Card> :
        qbrs.map(q => (
          <Card key={q.id} className="bg-zinc-900/50 border-zinc-800"><CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-white">{q.title || `QBR - ${q.period || "Q?"}`}</h3><span className="text-xs text-zinc-500">{q.generated_at ? new Date(q.generated_at).toLocaleDateString() : ""}</span></div>
            <div className="grid grid-cols-4 gap-2">{[
              { label: "Security", value: q.security_score, color: "text-emerald-400" },
              { label: "Uptime", value: q.uptime_pct ? `${q.uptime_pct}%` : "-", color: "text-blue-400" },
              { label: "SLA", value: q.sla_met_pct ? `${q.sla_met_pct}%` : "-", color: "text-amber-400" },
              { label: "Tickets", value: q.total_tickets || 0, color: "text-purple-400" },
            ].map(m => <div key={m.label} className="p-2 rounded bg-zinc-800 text-center"><p className={`text-lg font-black ${m.color}`}>{m.value}</p><p className="text-[9px] text-zinc-500">{m.label}</p></div>)}</div>
          </CardContent></Card>
        ))
      }
    </div>
  );
}

// --- Settings View (2FA + Profile) ---
function PortalSettings() {
  const { token, user, profile } = usePortalAuth();
  const [loading2FA, setLoading2FA] = useState(false);
  const [qrUri, setQrUri] = useState(null);
  const [secret, setSecret] = useState(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const headers = { Authorization: `Bearer ${token}` };
  const is2FA = profile?.totp_enabled;

  const setup2FA = async () => {
    setLoading2FA(true);
    try {
      const { data } = await axios.get(`${API}/setup-2fa`, { headers });
      setQrUri(data.uri); setSecret(data.secret);
    } catch { toast.error("Failed"); } finally { setLoading2FA(false); }
  };

  const enable2FA = async () => {
    try {
      await axios.post(`${API}/enable-2fa`, { code }, { headers });
      toast.success("2FA enabled!"); setQrUri(null); setCode(""); window.location.reload();
    } catch (err) { toast.error(err.response?.data?.detail || "Invalid code"); }
  };

  const disable2FA = async () => {
    try {
      await axios.post(`${API}/disable-2fa`, { code: disableCode }, { headers });
      toast.success("2FA disabled"); setDisableCode(""); window.location.reload();
    } catch (err) { toast.error(err.response?.data?.detail || "Invalid code"); }
  };

  return (
    <div className="space-y-5 max-w-lg" data-testid="portal-settings">
      <h1 className="text-2xl font-bold text-white">Account Settings</h1>
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader><CardTitle className="text-sm text-white flex items-center gap-2"><User className="w-4 h-4" />Profile</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-3 text-sm"><div><span className="text-zinc-500 text-xs">Name</span><p className="text-white">{user?.name}</p></div><div><span className="text-zinc-500 text-xs">Email</span><p className="text-white">{user?.email}</p></div><div><span className="text-zinc-500 text-xs">Client</span><p className="text-white">{user?.client_name}</p></div><div><span className="text-zinc-500 text-xs">Role</span><Badge variant="outline" className="capitalize">{user?.role}</Badge></div></div>
        </CardContent>
      </Card>
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader><CardTitle className="text-sm text-white flex items-center gap-2"><Shield className="w-4 h-4" />Two-Factor Authentication</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {is2FA ? (
            <div>
              <div className="flex items-center gap-2 mb-3"><CheckCircle className="w-5 h-5 text-emerald-400" /><span className="text-sm text-emerald-400 font-semibold">2FA is enabled</span></div>
              <div className="space-y-2"><Label className="text-zinc-300">Enter code to disable</Label><div className="flex gap-2"><Input value={disableCode} onChange={e => setDisableCode(e.target.value)} placeholder="000000" maxLength={6} className="bg-zinc-800 border-zinc-700 font-mono w-32" /><Button variant="destructive" size="sm" onClick={disable2FA} disabled={disableCode.length !== 6} data-testid="disable-2fa-btn">Disable 2FA</Button></div></div>
            </div>
          ) : qrUri ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-300">Scan this with your authenticator app (Google Authenticator, Authy, etc.):</p>
              <div className="p-4 bg-white rounded-lg w-fit mx-auto"><img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUri)}`} alt="QR Code" className="w-48 h-48" /></div>
              <div className="p-2 rounded bg-zinc-800"><p className="text-[10px] text-zinc-400 mb-1">Manual entry key:</p><code className="text-xs text-white font-mono break-all">{secret}</code></div>
              <div className="space-y-2"><Label className="text-zinc-300">Enter the 6-digit code from your app</Label><div className="flex gap-2"><Input value={code} onChange={e => setCode(e.target.value)} placeholder="000000" maxLength={6} className="bg-zinc-800 border-zinc-700 font-mono w-32 text-center" data-testid="setup-2fa-code" /><Button onClick={enable2FA} disabled={code.length !== 6} data-testid="enable-2fa-btn">Enable 2FA</Button></div></div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-zinc-400 mb-3">Add an extra layer of security to your account with TOTP-based two-factor authentication.</p>
              <Button onClick={setup2FA} disabled={loading2FA} data-testid="setup-2fa-btn">{loading2FA ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Smartphone className="w-4 h-4 mr-2" />}Set Up 2FA</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// --- Main Portal App ---
export default function TenantPortalApp() {
  const [page, setPage] = useState("dashboard");
  return (
    <PortalAuthProvider>
      <PortalAppInner page={page} setPage={setPage} />
    </PortalAuthProvider>
  );
}

function PortalAppInner({ page, setPage }) {
  const { token } = usePortalAuth();
  if (!token) return <PortalLogin />;
  const views = { dashboard: <PortalDashboard goTo={setPage} />, tickets: <PortalTickets />, devices: <PortalDevices />, invoices: <PortalInvoices />, backups: <PortalBackups />, compliance: <PortalCompliance />, qbr: <PortalQBR />, settings: <PortalSettings /> };
  return <PortalLayout activePage={page} setPage={setPage}>{views[page] || views.dashboard}</PortalLayout>;
}
