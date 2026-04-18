import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2, LogOut, Ticket, Monitor, FileText, DollarSign, BookOpen, User,
  Plus, Send, ArrowLeft, Wifi, WifiOff, Shield, Clock, Search, CheckCircle,
  AlertTriangle, XCircle, Activity, ChevronRight
} from "lucide-react";

const STATUS_COLORS = {
  open: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  in_progress: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  on_hold: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  resolved: "bg-green-500/15 text-green-400 border-green-500/30",
  closed: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

export default function PortalDashboardPage() {
  const navigate = useNavigate();
  const portalToken = sessionStorage.getItem("portal_token");
  const headers = { Authorization: `Bearer ${portalToken}` };

  const [tab, setTab] = useState("dashboard");
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [devices, setDevices] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [kbArticles, setKbArticles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Ticket detail + messaging
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);

  // New ticket dialog
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [ticketForm, setTicketForm] = useState({ title: "", description: "", priority: "medium", category: "support" });
  const [creatingTicket, setCreatingTicket] = useState(false);

  // KB search
  const [kbSearch, setKbSearch] = useState("");
  const [selectedArticle, setSelectedArticle] = useState(null);

  const logout = () => {
    sessionStorage.removeItem("portal_token");
    sessionStorage.removeItem("portal_user");
    navigate("/portal-login", { replace: true });
  };

  const fetchData = useCallback(async () => {
    if (!portalToken) { navigate("/portal-login", { replace: true }); return; }
    try {
      const [me, dash, tkts, devs, invs, kb] = await Promise.all([
        axios.get(`${API}/portal/v2/me`, { headers }).catch(() => null),
        axios.get(`${API}/portal/v2/dashboard`, { headers }).catch(() => null),
        axios.get(`${API}/portal/v2/tickets`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/portal/v2/devices`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/portal/v2/invoices`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/portal/v2/kb`, { headers }).catch(() => ({ data: [] })),
      ]);
      if (me?.data) setProfile(me.data);
      if (dash?.data?.stats) setStats(dash.data.stats);
      setTickets(tkts?.data || []);
      setDevices(devs?.data || []);
      setInvoices(invs?.data || []);
      setKbArticles(kb?.data || []);
    } catch (err) {
      if (err.response?.status === 401) logout();
    } finally { setLoading(false); }
  }, [portalToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openTicketDetail = async (ticket) => {
    setSelectedTicket(ticket);
    try {
      const res = await axios.get(`${API}/portal/v2/tickets/${ticket.id}`, { headers });
      setTicketMessages(res.data.messages || []);
      setSelectedTicket(res.data.ticket);
    } catch { setTicketMessages([]); }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedTicket) return;
    setSendingMsg(true);
    try {
      const res = await axios.post(`${API}/portal/v2/tickets/${selectedTicket.id}/messages`, { content: newMessage }, { headers });
      setTicketMessages(prev => [...prev, res.data]);
      setNewMessage("");
    } catch { toast.error("Failed to send message"); }
    finally { setSendingMsg(false); }
  };

  const createTicket = async () => {
    if (!ticketForm.title.trim()) { toast.error("Title required"); return; }
    setCreatingTicket(true);
    try {
      await axios.post(`${API}/portal/v2/tickets`, ticketForm, { headers });
      toast.success("Ticket created!");
      setShowNewTicket(false);
      setTicketForm({ title: "", description: "", priority: "medium", category: "support" });
      const tkts = await axios.get(`${API}/portal/v2/tickets`, { headers });
      setTickets(tkts.data || []);
    } catch { toast.error("Failed to create ticket"); }
    finally { setCreatingTicket(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
    </div>
  );

  const userName = profile?.user?.name || "Client";
  const companyName = profile?.client?.name || "";
  const primaryColor = profile?.msp_branding?.primary_color || "#10b981";
  const filteredKb = kbSearch ? kbArticles.filter(a => a.title.toLowerCase().includes(kbSearch.toLowerCase()) || (a.category || "").toLowerCase().includes(kbSearch.toLowerCase())) : kbArticles;

  // Ticket detail view
  if (selectedTicket) {
    return (
      <div className="min-h-screen bg-background" data-testid="portal-ticket-detail">
        <div className="border-b bg-card px-6 py-3 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedTicket(null); setTicketMessages([]); }}><ArrowLeft className="w-4 h-4 mr-1" />Back to Tickets</Button>
          <Badge className={STATUS_COLORS[selectedTicket.status] + " border capitalize"}>{(selectedTicket.status || "").replace("_", " ")}</Badge>
        </div>
        <div className="max-w-4xl mx-auto p-6">
          <h2 className="text-xl font-bold mb-1">{selectedTicket.title}</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {selectedTicket.id} &middot; Priority: <span className="capitalize">{selectedTicket.priority}</span> &middot; Created {selectedTicket.created_at?.slice(0, 10)}
          </p>
          {selectedTicket.description && (
            <Card className="mb-4"><CardContent className="py-3"><p className="text-sm">{selectedTicket.description}</p></CardContent></Card>
          )}
          <Separator className="my-4" />
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Activity className="w-4 h-4" />Conversation</h3>
          <div className="space-y-3 max-h-[50vh] overflow-y-auto mb-4" data-testid="ticket-messages">
            {ticketMessages.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No messages yet. Start the conversation below.</p>}
            {ticketMessages.map(msg => (
              <div key={msg.id} className={`flex ${msg.sender_type === "client" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-lg px-4 py-2 ${msg.sender_type === "client" ? "bg-primary/15 border border-primary/30" : "bg-muted border"}`}>
                  <p className="text-[11px] font-medium mb-1" style={msg.sender_type !== "client" ? { color: primaryColor } : {}}>{msg.sender_name || "Support"}</p>
                  <p className="text-sm">{msg.content}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{msg.created_at?.slice(0, 16).replace("T", " ")}</p>
                </div>
              </div>
            ))}
          </div>
          {selectedTicket.status !== "closed" && selectedTicket.status !== "resolved" && (
            <div className="flex gap-2">
              <Input value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="Type your message..." onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()} data-testid="ticket-message-input" />
              <Button onClick={sendMessage} disabled={sendingMsg || !newMessage.trim()} data-testid="ticket-send-msg">
                {sendingMsg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="portal-dashboard">
      {/* Header */}
      <div className="border-b bg-card px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {profile?.msp_branding?.company_logo_url && <img src={profile.msp_branding.company_logo_url} alt="" className="h-7 object-contain" />}
          <div>
            <p className="font-semibold text-sm">{companyName} Portal</p>
            <p className="text-[11px] text-muted-foreground">Welcome, {userName}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={logout} data-testid="portal-logout"><LogOut className="w-4 h-4 mr-1" />Sign Out</Button>
      </div>

      {/* Tabs */}
      <div className="max-w-6xl mx-auto p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap h-auto gap-1 mb-6">
            <TabsTrigger value="dashboard"><Activity className="w-3 h-3 mr-1" />Dashboard</TabsTrigger>
            <TabsTrigger value="tickets"><Ticket className="w-3 h-3 mr-1" />Tickets ({tickets.length})</TabsTrigger>
            <TabsTrigger value="devices"><Monitor className="w-3 h-3 mr-1" />Devices ({devices.length})</TabsTrigger>
            <TabsTrigger value="invoices"><DollarSign className="w-3 h-3 mr-1" />Invoices ({invoices.length})</TabsTrigger>
            <TabsTrigger value="kb"><BookOpen className="w-3 h-3 mr-1" />Knowledge Base</TabsTrigger>
            <TabsTrigger value="profile"><User className="w-3 h-3 mr-1" />Profile</TabsTrigger>
          </TabsList>

          {/* Dashboard */}
          <TabsContent value="dashboard" className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <Card className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => setTab("tickets")}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div><p className="text-2xl font-bold">{stats?.open_tickets || 0}</p><p className="text-xs text-muted-foreground">Open Tickets</p></div>
                    <Ticket className="w-8 h-8 text-blue-400" />
                  </div>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => setTab("devices")}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div><p className="text-2xl font-bold">{stats?.online_devices || 0}<span className="text-sm text-muted-foreground">/{stats?.total_devices || 0}</span></p><p className="text-xs text-muted-foreground">Devices Online</p></div>
                    <Monitor className="w-8 h-8 text-emerald-400" />
                  </div>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => setTab("invoices")}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div><p className="text-2xl font-bold">${(stats?.outstanding_invoices || 0).toLocaleString()}</p><p className="text-xs text-muted-foreground">Outstanding</p></div>
                    <DollarSign className="w-8 h-8 text-amber-400" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div><p className="text-2xl font-bold">{stats?.resolved_tickets || 0}</p><p className="text-xs text-muted-foreground">Resolved</p></div>
                    <CheckCircle className="w-8 h-8 text-green-400" />
                  </div>
                </CardContent>
              </Card>
            </div>
            {/* Recent tickets */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center justify-between">Recent Tickets <Button size="sm" onClick={() => { setTab("tickets"); setShowNewTicket(true); }}><Plus className="w-3 h-3 mr-1" />New Ticket</Button></CardTitle></CardHeader>
              <CardContent>
                {tickets.slice(0, 5).map(t => (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b last:border-0 cursor-pointer hover:bg-muted/30 px-2 rounded" onClick={() => { setTab("tickets"); openTicketDetail(t); }}>
                    <div>
                      <p className="font-medium text-sm">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground">{t.id} &middot; {t.created_at?.slice(0, 10)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={STATUS_COLORS[t.status] + " border text-[10px] capitalize"}>{(t.status || "").replace("_", " ")}</Badge>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tickets */}
          <TabsContent value="tickets" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">Support Tickets</h2>
              <Button onClick={() => setShowNewTicket(true)} data-testid="portal-new-ticket"><Plus className="w-4 h-4 mr-1" />New Ticket</Button>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>ID</TableHead><TableHead>Title</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {tickets.map(t => (
                  <TableRow key={t.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openTicketDetail(t)}>
                    <TableCell className="text-xs font-mono">{t.id}</TableCell>
                    <TableCell className="font-medium">{t.title}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] capitalize">{t.priority}</Badge></TableCell>
                    <TableCell><Badge className={STATUS_COLORS[t.status] + " border text-[10px] capitalize"}>{(t.status || "").replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.created_at?.slice(0, 10)}</TableCell>
                    <TableCell><ChevronRight className="w-4 h-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          {/* Devices */}
          <TabsContent value="devices" className="space-y-4">
            <h2 className="text-lg font-bold">Your Devices</h2>
            <div className="grid grid-cols-3 gap-3">
              {devices.map(d => (
                <Card key={d.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${d.status === "online" ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                        {d.status === "online" ? <Wifi className="w-5 h-5 text-emerald-400" /> : <WifiOff className="w-5 h-5 text-red-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{d.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{d.os || d.device_type}</p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] capitalize ${d.status === "online" ? "border-emerald-500/30 text-emerald-400" : "border-red-500/30 text-red-400"}`}>{d.status}</Badge>
                    </div>
                    {(d.cpu_usage || d.memory_usage) && (
                      <div className="mt-2 flex gap-4 text-[10px] text-muted-foreground">
                        {d.cpu_usage != null && <span>CPU: {d.cpu_usage}%</span>}
                        {d.memory_usage != null && <span>RAM: {d.memory_usage}%</span>}
                        {d.disk_usage != null && <span>Disk: {d.disk_usage}%</span>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {devices.length === 0 && <p className="text-sm text-muted-foreground col-span-3 text-center py-8">No devices found.</p>}
            </div>
          </TabsContent>

          {/* Invoices */}
          <TabsContent value="invoices" className="space-y-4">
            <h2 className="text-lg font-bold">Invoices</h2>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Invoice #</TableHead><TableHead>Status</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Total</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {invoices.map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.invoice_number}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] capitalize">{inv.status}</Badge></TableCell>
                    <TableCell className="text-sm">{inv.due_date || "N/A"}</TableCell>
                    <TableCell className="text-right font-mono">${(inv.total || 0).toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                  </TableRow>
                ))}
                {invoices.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No invoices found.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TabsContent>

          {/* Knowledge Base */}
          <TabsContent value="kb" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">Knowledge Base</h2>
              <div className="relative w-64">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search articles..." value={kbSearch} onChange={e => setKbSearch(e.target.value)} className="pl-9 h-9" data-testid="kb-search" />
              </div>
            </div>
            {selectedArticle ? (
              <Card>
                <CardHeader className="pb-2">
                  <Button variant="ghost" size="sm" className="w-fit" onClick={() => setSelectedArticle(null)}><ArrowLeft className="w-3 h-3 mr-1" />Back</Button>
                  <CardTitle className="text-base mt-2">{selectedArticle.title}</CardTitle>
                  <Badge variant="outline" className="w-fit text-[10px]">{selectedArticle.category}</Badge>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{selectedArticle.content}</p>
                  {selectedArticle.tags?.length > 0 && (
                    <div className="flex gap-1 mt-4">{selectedArticle.tags.map(t => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredKb.map(article => (
                  <Card key={article.id} className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => setSelectedArticle(article)}>
                    <CardContent className="py-3">
                      <Badge variant="outline" className="text-[10px] mb-2">{article.category}</Badge>
                      <p className="font-medium text-sm">{article.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{article.content}</p>
                    </CardContent>
                  </Card>
                ))}
                {filteredKb.length === 0 && <p className="text-sm text-muted-foreground col-span-2 text-center py-8">No articles found.</p>}
              </div>
            )}
          </TabsContent>

          {/* Profile */}
          <TabsContent value="profile" className="space-y-4">
            <h2 className="text-lg font-bold">Your Profile</h2>
            <Card>
              <CardContent className="py-4 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label className="text-xs text-muted-foreground">Name</Label><p className="font-medium">{profile?.user?.name || "N/A"}</p></div>
                  <div><Label className="text-xs text-muted-foreground">Email</Label><p className="font-medium">{profile?.user?.email || "N/A"}</p></div>
                  <div><Label className="text-xs text-muted-foreground">Company</Label><p className="font-medium">{companyName}</p></div>
                  <div><Label className="text-xs text-muted-foreground">2FA Status</Label>
                    <Badge variant={profile?.totp_enabled ? "default" : "outline"} className="mt-1">
                      <Shield className="w-3 h-3 mr-1" />{profile?.totp_enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* New Ticket Dialog */}
      <Dialog open={showNewTicket} onOpenChange={setShowNewTicket}>
        <DialogContent aria-describedby="new-portal-ticket-desc">
          <DialogHeader>
            <DialogTitle>Submit Support Ticket</DialogTitle>
            <DialogDescription id="new-portal-ticket-desc">Describe your issue and our team will respond promptly.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Subject</Label><Input value={ticketForm.title} onChange={e => setTicketForm(p => ({ ...p, title: e.target.value }))} placeholder="Brief description of your issue" data-testid="portal-ticket-title" /></div>
            <div><Label className="text-xs">Description</Label><Textarea value={ticketForm.description} onChange={e => setTicketForm(p => ({ ...p, description: e.target.value }))} placeholder="Provide details..." rows={4} data-testid="portal-ticket-desc" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Priority</Label>
                <Select value={ticketForm.priority} onValueChange={v => setTicketForm(p => ({ ...p, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Category</Label>
                <Select value={ticketForm.category} onValueChange={v => setTicketForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="support">Support</SelectItem><SelectItem value="hardware">Hardware</SelectItem><SelectItem value="software">Software</SelectItem><SelectItem value="network">Network</SelectItem><SelectItem value="security">Security</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewTicket(false)}>Cancel</Button>
            <Button onClick={createTicket} disabled={creatingTicket} data-testid="portal-ticket-submit">
              {creatingTicket ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
