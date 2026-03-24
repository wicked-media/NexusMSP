import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Laptop, Monitor, Server, Wifi, WifiOff, Settings, Plus, RefreshCw, Loader2,
  ExternalLink, Copy, Search, Play, Clock, Shield, Download, ChevronRight,
  Link2, Unlink, Eye, EyeOff, Pencil, Check, X, History, Zap, Globe
} from "lucide-react";

const TYPE_ICONS = { server: Server, workstation: Monitor, laptop: Laptop, network: Wifi };

export default function RemoteAccessPage() {
  const { token } = useAuth();
  const [devices, setDevices] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterRegistered, setFilterRegistered] = useState("all");
  const [tab, setTab] = useState("devices");
  const [quickId, setQuickId] = useState("");
  const [showAssign, setShowAssign] = useState(null);
  const [assignForm, setAssignForm] = useState({ rustdesk_id: "", rustdesk_password: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ server_url: "", api_key: "", relay_server: "", enabled: true });
  const [showPassword, setShowPassword] = useState({});
  const [connecting, setConnecting] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, sRes, cRes] = await Promise.all([
        axios.get(`${API}/rustdesk/all-devices`, { headers }),
        axios.get(`${API}/rustdesk/sessions`, { headers }),
        axios.get(`${API}/rustdesk/config`, { headers }),
      ]);
      setDevices(dRes.data);
      setSessions(sRes.data);
      setConfig(cRes.data?.value || cRes.data);
    } catch { toast.error("Failed to load remote access data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Quick connect
  const quickConnect = async () => {
    if (!quickId.trim()) return;
    setConnecting("quick");
    try {
      await axios.post(`${API}/rustdesk/quick-connect`, { rustdesk_id: quickId }, { headers });
      window.open(`rustdesk://${quickId}`, "_blank");
      toast.success(`Connecting to ${quickId}...`);
      setQuickId("");
      fetchData();
    } catch { toast.error("Connection failed"); }
    finally { setConnecting(null); }
  };

  // Connect to registered device
  const connectDevice = async (device) => {
    const rdId = device.rd_id;
    if (!rdId) { toast.error("No RustDesk ID assigned to this device"); return; }
    setConnecting(device.id);
    try {
      if (device.rd_entry_id) {
        await axios.post(`${API}/rustdesk/devices/${device.rd_entry_id}/connect`, {}, { headers });
      } else {
        await axios.post(`${API}/rustdesk/quick-connect`, { rustdesk_id: rdId }, { headers });
      }
      window.open(`rustdesk://${rdId}`, "_blank");
      toast.success(`Connecting to ${device.name || device.hostname}...`);
      fetchData();
    } catch { toast.error("Connection failed"); }
    finally { setConnecting(null); }
  };

  // Assign RustDesk ID
  const assignRustdeskId = async (e) => {
    e.preventDefault();
    if (!assignForm.rustdesk_id.trim()) { toast.error("RustDesk ID is required"); return; }
    setSubmitting(true);
    try {
      await axios.put(`${API}/rustdesk/assign/${showAssign.id}`, assignForm, { headers });
      toast.success(`RustDesk ID assigned to ${showAssign.name || showAssign.hostname}`);
      setShowAssign(null);
      setAssignForm({ rustdesk_id: "", rustdesk_password: "" });
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to assign"); }
    finally { setSubmitting(false); }
  };

  // Save settings
  const saveSettings = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await axios.post(`${API}/rustdesk/config`, settingsForm, { headers });
      toast.success("Settings saved");
      setShowSettings(false);
      fetchData();
    } catch { toast.error("Failed to save settings"); }
    finally { setSubmitting(false); }
  };

  const copyToClipboard = (text) => { navigator.clipboard.writeText(text); toast.success("Copied to clipboard"); };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const registered = devices.filter(d => d.rd_registered);
  const unregistered = devices.filter(d => !d.rd_registered);
  const online = devices.filter(d => d.status === "online");
  const serverConfigured = config?.enabled && config?.server_url;

  const filtered = devices.filter(d => {
    if (search) {
      const q = search.toLowerCase();
      if (!(d.name || "").toLowerCase().includes(q) && !(d.hostname || "").toLowerCase().includes(q) &&
          !(d.rd_id || "").toLowerCase().includes(q) && !(d.client_name || "").toLowerCase().includes(q)) return false;
    }
    if (filterType !== "all" && d.device_type !== filterType) return false;
    if (filterRegistered === "registered" && !d.rd_registered) return false;
    if (filterRegistered === "unregistered" && d.rd_registered) return false;
    return true;
  });

  return (
    <div className="space-y-5" data-testid="remote-access-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center"><Laptop className="w-5 h-5 text-white" /></div>
            Remote Devices
          </h1>
          <p className="text-muted-foreground mt-1">Manage RustDesk remote access for all client devices</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setSettingsForm(config || { server_url: "", api_key: "", relay_server: "", enabled: true }); setShowSettings(true); }} data-testid="settings-btn"><Settings className="w-4 h-4 mr-2" />Server Settings</Button>
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
        </div>
      </div>

      {/* Connection Status Bar */}
      <Card className={`border ${serverConfigured ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${serverConfigured ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
              <div>
                <span className={`text-sm font-semibold ${serverConfigured ? "text-emerald-400" : "text-amber-400"}`}>
                  {serverConfigured ? "RustDesk Server Connected" : "Server Not Configured"}
                </span>
                {config?.server_url && <span className="text-xs text-muted-foreground ml-2">{config.server_url}</span>}
              </div>
            </div>
            {!serverConfigured && <Button size="sm" variant="outline" onClick={() => { setSettingsForm(config || {}); setShowSettings(true); }}>Configure Now</Button>}
          </div>
        </CardContent>
      </Card>

      {/* Quick Connect Bar */}
      <Card className="border-border/40">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <span className="text-sm font-semibold whitespace-nowrap">Quick Connect</span>
            <Input placeholder="Enter RustDesk ID (e.g., 842931675)" value={quickId} onChange={e => setQuickId(e.target.value)} onKeyDown={e => e.key === "Enter" && quickConnect()} className="flex-1 max-w-xs font-mono" data-testid="quick-connect-input" />
            <Button onClick={quickConnect} disabled={!quickId.trim() || connecting === "quick"} data-testid="quick-connect-btn">
              {connecting === "quick" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}Connect
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Devices", value: devices.length, icon: Monitor, color: "text-blue-400" },
          { label: "RustDesk Registered", value: registered.length, icon: Link2, color: "text-emerald-400" },
          { label: "Unregistered", value: unregistered.length, icon: Unlink, color: "text-amber-400" },
          { label: "Sessions Today", value: sessions.filter(s => { const d = new Date(s.started_at); const t = new Date(); return d.toDateString() === t.toDateString(); }).length, icon: History, color: "text-purple-400" },
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
          <TabsTrigger value="devices">All Devices ({devices.length})</TabsTrigger>
          <TabsTrigger value="registered">Registered ({registered.length})</TabsTrigger>
          <TabsTrigger value="sessions">Session History ({sessions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search by name, hostname, ID, or client..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="device-search" />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="server">Servers</SelectItem>
                <SelectItem value="workstation">Workstations</SelectItem>
                <SelectItem value="laptop">Laptops</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRegistered} onValueChange={setFilterRegistered}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="registered">Registered</SelectItem>
                <SelectItem value="unregistered">Unregistered</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="border-border/40">
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>Type / OS</TableHead>
                  <TableHead>Status</TableHead><TableHead>RustDesk ID</TableHead><TableHead>Last Connected</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No devices match your filters</TableCell></TableRow>
                  ) : filtered.map(d => {
                    const Icon = TYPE_ICONS[d.device_type] || Monitor;
                    return (
                      <TableRow key={d.id} data-testid={`device-row-${d.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="font-semibold text-sm">{d.name || d.hostname || "Unnamed"}</p>
                              {d.ip_address && <p className="text-[10px] text-muted-foreground font-mono">{d.ip_address}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{d.client_name || "—"}</Badge></TableCell>
                        <TableCell>
                          <div><span className="text-xs capitalize">{d.device_type}</span>{d.os && <p className="text-[10px] text-muted-foreground">{d.os}</p>}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {d.status === "online" ? <Wifi className="w-3 h-3 text-emerald-400" /> : <WifiOff className="w-3 h-3 text-red-400" />}
                            <span className={`text-xs capitalize ${d.status === "online" ? "text-emerald-400" : "text-muted-foreground"}`}>{d.status}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {d.rd_id ? (
                            <div className="flex items-center gap-1.5">
                              <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{d.rd_id}</code>
                              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyToClipboard(d.rd_id)}><Copy className="w-3 h-3" /></Button>
                              {d.rd_password && (
                                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowPassword(p => ({ ...p, [d.id]: !p[d.id] }))}>
                                  {showPassword[d.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                </Button>
                              )}
                              {showPassword[d.id] && d.rd_password && (
                                <code className="text-[10px] font-mono text-amber-400">{d.rd_password}</code>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">Not assigned</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{d.rd_last_connected ? new Date(d.rd_last_connected).toLocaleString() : "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {d.rd_id ? (
                              <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => connectDevice(d)} disabled={connecting === d.id} data-testid={`connect-${d.id}`}>
                                {connecting === d.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}Connect
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowAssign(d); setAssignForm({ rustdesk_id: d.rustdesk_id || "", rustdesk_password: "" }); }} data-testid={`assign-${d.id}`}>
                                <Link2 className="w-3 h-3 mr-1" />Assign ID
                              </Button>
                            )}
                            {d.rd_id && (
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowAssign(d); setAssignForm({ rustdesk_id: d.rd_id || "", rustdesk_password: d.rd_password || "" }); }} data-testid={`edit-rd-${d.id}`}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="registered" className="mt-4 space-y-3">
          {registered.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><Unlink className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" /><p className="text-muted-foreground">No devices registered with RustDesk IDs yet</p><p className="text-xs text-muted-foreground mt-1">Go to All Devices and click "Assign ID" to register</p></CardContent></Card>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {registered.map(d => {
                const Icon = TYPE_ICONS[d.device_type] || Monitor;
                return (
                  <Card key={d.id} className="border-border/40 hover:border-primary/30 transition-colors" data-testid={`rd-card-${d.id}`}>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${d.status === "online" ? "bg-emerald-500/10" : "bg-muted/50"}`}>
                          <Icon className={`w-5 h-5 ${d.status === "online" ? "text-emerald-400" : "text-muted-foreground"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm truncate">{d.name || d.hostname}</span>
                            <Badge variant={d.status === "online" ? "default" : "secondary"} className="text-[10px] capitalize">{d.status}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{d.client_name}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{d.rd_id}</code>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyToClipboard(d.rd_id)}><Copy className="w-3 h-3" /></Button>
                          </div>
                          {d.rd_last_connected && <p className="text-[10px] text-muted-foreground mt-1">Last: {new Date(d.rd_last_connected).toLocaleString()}</p>}
                        </div>
                        <Button size="sm" onClick={() => connectDevice(d)} disabled={connecting === d.id} data-testid={`connect-card-${d.id}`}>
                          {connecting === d.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}Connect
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4 text-purple-400" />Remote Sessions</CardTitle></CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No remote sessions recorded</p>
              ) : (
                <ScrollArea className="h-80">
                  <div className="space-y-2">
                    {sessions.map(s => (
                      <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg border border-border/20 hover:bg-muted/20" data-testid={`session-${s.id}`}>
                        <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center"><Play className="w-4 h-4 text-purple-400" /></div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            <span className="text-muted-foreground">{s.user_name}</span> connected to <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{s.rustdesk_id}</code>
                          </p>
                          <p className="text-[10px] text-muted-foreground">{s.client_id ? `Client: ${s.client_id}` : "Quick connect"}</p>
                        </div>
                        <Badge variant={s.status === "initiated" ? "default" : "secondary"} className="text-[10px] capitalize">{s.status}</Badge>
                        <span className="text-[10px] text-muted-foreground">{s.started_at ? new Date(s.started_at).toLocaleString() : ""}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Assign RustDesk ID Dialog */}
      <Dialog open={!!showAssign} onOpenChange={() => setShowAssign(null)}>
        <DialogContent className="max-w-sm" aria-describedby="assign-rd-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="w-5 h-5 text-blue-400" />{showAssign?.rd_id ? "Edit" : "Assign"} RustDesk ID</DialogTitle>
            <DialogDescription id="assign-rd-desc">{showAssign?.name || showAssign?.hostname} — {showAssign?.client_name}</DialogDescription>
          </DialogHeader>
          <form onSubmit={assignRustdeskId} className="space-y-4">
            <div className="space-y-2">
              <Label>RustDesk ID *</Label>
              <Input value={assignForm.rustdesk_id} onChange={e => setAssignForm({ ...assignForm, rustdesk_id: e.target.value })} placeholder="e.g., 842931675" className="font-mono" required data-testid="assign-rd-id" />
              <p className="text-[10px] text-muted-foreground">The 9-digit ID shown in the RustDesk client on this device</p>
            </div>
            <div className="space-y-2">
              <Label>Password (optional)</Label>
              <Input value={assignForm.rustdesk_password} onChange={e => setAssignForm({ ...assignForm, rustdesk_password: e.target.value })} placeholder="Device password for unattended access" data-testid="assign-rd-pw" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={submitting} data-testid="save-assign-btn">
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                {showAssign?.rd_id ? "Update" : "Assign"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Server Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-md" aria-describedby="settings-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings className="w-5 h-5 text-muted-foreground" />RustDesk Server Settings</DialogTitle>
            <DialogDescription id="settings-desc">Configure your RustDesk server connection</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveSettings} className="space-y-4">
            <div className="space-y-2"><Label>Server URL *</Label><Input value={settingsForm.server_url} onChange={e => setSettingsForm({ ...settingsForm, server_url: e.target.value })} placeholder="rustdesk.yourdomain.com" required data-testid="settings-server" /></div>
            <div className="space-y-2"><Label>API Key</Label><Input value={settingsForm.api_key} onChange={e => setSettingsForm({ ...settingsForm, api_key: e.target.value })} placeholder="Your RustDesk API key" type="password" data-testid="settings-key" /></div>
            <div className="space-y-2"><Label>Relay Server</Label><Input value={settingsForm.relay_server} onChange={e => setSettingsForm({ ...settingsForm, relay_server: e.target.value })} placeholder="relay.yourdomain.com" data-testid="settings-relay" /></div>
            <DialogFooter><Button type="submit" disabled={submitting} data-testid="save-settings-btn">{submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save Settings</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
