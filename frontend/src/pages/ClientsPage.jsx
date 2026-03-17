import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Plus, Search, Building2, Loader2, DollarSign, Monitor, Ticket, Mail, Phone,
  ArrowLeft, User, Edit, Trash2, MapPin, Star, FileText, UserPlus, Cloud, Shield, RefreshCw,
  ShieldCheck, ShieldX, AlertCircle, CheckCircle, XCircle, Globe, Lock, MailCheck,
  Wifi, WifiOff, Zap, CreditCard, AlertTriangle, ExternalLink, Trophy, Award, Laptop, Link2
} from "lucide-react";

const roleColors = {
  primary: "bg-blue-500", billing: "bg-green-500", technical: "bg-purple-500", general: "bg-gray-500"
};

export default function ClientsPage() {
  const { token } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  // Detail view
  const [viewingClient, setViewingClient] = useState(null);
  const [clientDetail, setClientDetail] = useState(null);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [contactForm, setContactForm] = useState({ name: "", email: "", phone: "", role: "general", is_primary: false });
  const [m365Users, setM365Users] = useState([]);
  const [m365Config, setM365Config] = useState(null);
  const [m365SyncDialog, setM365SyncDialog] = useState(false);
  const [m365TenantId, setM365TenantId] = useState("");
  const [m365Domain, setM365Domain] = useState("");
  // Suped / Subscriptions
  const [subscriptions, setSubscriptions] = useState(null);
  const [supedServices, setSupedServices] = useState([]);
  const [dmarcRecords, setDmarcRecords] = useState(null);
  const [dmarcLoading, setDmarcLoading] = useState(false);
  const [subsSummary, setSubsSummary] = useState({});
  // Splynx
  const [splynxLink, setSplynxLink] = useState(null);
  const [splynxServices, setSplynxServices] = useState(null);
  const [splynxLoading, setSplynxLoading] = useState(false);
  const [healthScores, setHealthScores] = useState({});
  const [clientTimeline, setClientTimeline] = useState([]);
  const [clientAchievements, setClientAchievements] = useState(null);
  const [clientReadiness, setClientReadiness] = useState(null);
  const [clientLoyalty, setClientLoyalty] = useState(null);
  const [rustdeskDevices, setRustdeskDevices] = useState([]);
  const [isRustdeskOpen, setIsRustdeskOpen] = useState(false);
  const [rustdeskForm, setRustdeskForm] = useState({ device_name: "", rustdesk_id: "", rustdesk_password: "", os: "", notes: "", linked_device_id: "" });
  const [formData, setFormData] = useState({
    name: "", email: "", phone: "", address: "", industry: "", contract_type: "monthly", mrr: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchClients = async () => {
    setLoading(true);
    try {
      const [res, subsRes, servicesRes] = await Promise.all([
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/clients/subscriptions/summary`, { headers }).catch(() => ({ data: {} })),
        axios.get(`${API}/suped/services`, { headers }).catch(() => ({ data: [] })),
      ]);
      setClients(res.data);
      setSubsSummary(subsRes.data);
      setSupedServices(servicesRes.data);
      // Fetch health scores in background
      axios.get(`${API}/clients/health/all`, { headers }).then(hRes => {
        const map = {};
        (hRes.data || []).forEach(h => { map[h.client_id] = h; });
        setHealthScores(map);
      }).catch(() => {});
    } catch { toast.error("Failed to fetch clients"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchClients(); }, []);

  const fetchClientDetail = async (client) => {
    setViewingClient(client);
    setSubscriptions(null);
    setDmarcRecords(null);
    setSplynxLink(null);
    setSplynxServices(null);
    setClientTimeline([]);
    setClientAchievements(null);
    setClientReadiness(null);
    setClientLoyalty(null);
    setRustdeskDevices([]);
    try {
      const [detailRes, m365Res, subsRes, splynxRes, timelineRes, achRes, readRes, loyRes, rdRes] = await Promise.all([
        axios.get(`${API}/clients/${client.id}/detail`, { headers }),
        axios.get(`${API}/clients/${client.id}/m365-users`, { headers }).catch(() => ({ data: { users: [], config: null } })),
        axios.get(`${API}/clients/${client.id}/subscriptions`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/clients/${client.id}/splynx`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/clients/${client.id}/activity-timeline`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/clients/${client.id}/achievements`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/clients/${client.id}/portal-readiness`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/clients/${client.id}/loyalty`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/rustdesk/clients/${client.id}/devices`, { headers }).catch(() => ({ data: [] })),
      ]);
      setClientDetail(detailRes.data);
      setM365Users(m365Res.data.users || []);
      setM365Config(m365Res.data.config || null);
      setSubscriptions(subsRes.data);
      setSplynxLink(splynxRes.data);
      setClientTimeline(timelineRes.data || []);
      setClientAchievements(achRes.data);
      setClientReadiness(readRes.data);
      setClientLoyalty(loyRes.data);
      setRustdeskDevices(rdRes.data || []);
    } catch { toast.error("Failed to load client details"); }
  };

  const syncM365 = async () => {
    if (!viewingClient) return;
    try {
      const res = await axios.post(`${API}/clients/${viewingClient.id}/m365-sync`, {
        tenant_id: m365TenantId, domain: m365Domain, users: []
      }, { headers });
      toast.success(res.data.message);
      setM365SyncDialog(false);
      fetchClientDetail(viewingClient);
    } catch { toast.error("Failed to sync M365"); }
  };

  const handleSaveSubscriptions = async () => {
    if (!viewingClient || !subscriptions) return;
    try {
      await axios.put(`${API}/clients/${viewingClient.id}/subscriptions`, subscriptions, { headers });
      toast.success("Subscriptions updated");
      fetchClients();
    } catch { toast.error("Failed to save subscriptions"); }
  };

  const toggleService = (key) => {
    if (!subscriptions) return;
    setSubscriptions({
      ...subscriptions,
      services: { ...subscriptions.services, [key]: !subscriptions.services[key] }
    });
  };

  const fetchDmarcRecords = async (days = 30) => {
    if (!viewingClient) return;
    setDmarcLoading(true);
    try {
      const res = await axios.get(`${API}/clients/${viewingClient.id}/dmarc-records?days=${days}`, { headers });
      setDmarcRecords(res.data);
    } catch { toast.error("Failed to fetch DMARC records"); }
    finally { setDmarcLoading(false); }
  };

  const handleSaveSplynxLink = async () => {
    if (!viewingClient || !splynxLink) return;
    try {
      await axios.put(`${API}/clients/${viewingClient.id}/splynx`, { splynx_customer_id: splynxLink.splynx_customer_id }, { headers });
      toast.success("Splynx link saved");
      if (splynxLink.splynx_customer_id) fetchSplynxServices();
    } catch { toast.error("Failed to save Splynx link"); }
  };

  const fetchSplynxServices = async () => {
    if (!viewingClient) return;
    setSplynxLoading(true);
    try {
      const [svcRes, invRes, custRes] = await Promise.all([
        axios.get(`${API}/clients/${viewingClient.id}/splynx/services`, { headers }),
        axios.get(`${API}/clients/${viewingClient.id}/splynx/invoices`, { headers }).catch(() => ({ data: { invoices: [] } })),
        axios.get(`${API}/clients/${viewingClient.id}/splynx/customer`, { headers }).catch(() => ({ data: {} })),
      ]);
      setSplynxServices({ services: svcRes.data.services || [], invoices: invRes.data.invoices || [], customer: custRes.data.customer || null, billing: custRes.data.billing || null, error: svcRes.data.error || invRes.data.error || custRes.data.error });
    } catch { toast.error("Failed to fetch Splynx data"); }
    finally { setSplynxLoading(false); }
  };

  const handleCreateClient = async () => {
    try {
      const data = { ...formData, mrr: parseFloat(formData.mrr) || 0 };
      if (editingClient) {
        await axios.put(`${API}/clients/${editingClient.id}`, data, { headers });
        toast.success("Client updated");
      } else {
        await axios.post(`${API}/clients`, data, { headers });
        toast.success("Client created");
      }
      setIsCreateOpen(false);
      setEditingClient(null);
      setFormData({ name: "", email: "", phone: "", address: "", industry: "", contract_type: "monthly", mrr: "" });
      fetchClients();
    } catch { toast.error("Failed to save client"); }
  };

  const handleDeleteClient = async (id) => {
    try {
      await axios.delete(`${API}/clients/${id}`, { headers });
      toast.success("Client deleted");
      fetchClients();
    } catch { toast.error("Failed to delete"); }
  };

  const handleAddContact = async () => {
    try {
      if (editingContact) {
        await axios.put(`${API}/clients/${viewingClient.id}/contacts/${editingContact.id}`, contactForm, { headers });
        toast.success("Contact updated");
      } else {
        await axios.post(`${API}/clients/${viewingClient.id}/contacts`, contactForm, { headers });
        toast.success("Contact added");
      }
      setIsContactOpen(false);
      setEditingContact(null);
      setContactForm({ name: "", email: "", phone: "", role: "general", is_primary: false });
      fetchClientDetail(viewingClient);
      fetchClients();
    } catch { toast.error("Failed to save contact"); }
  };

  const handleDeleteContact = async (contactId) => {
    try {
      await axios.delete(`${API}/clients/${viewingClient.id}/contacts/${contactId}`, { headers });
      toast.success("Contact removed");
      fetchClientDetail(viewingClient);
    } catch { toast.error("Failed to delete contact"); }
  };

  const handleAddRustdeskDevice = async () => {
    try {
      await axios.post(`${API}/rustdesk/clients/${viewingClient.id}/devices`, rustdeskForm, { headers });
      toast.success("RustDesk device added");
      setIsRustdeskOpen(false);
      setRustdeskForm({ device_name: "", rustdesk_id: "", rustdesk_password: "", os: "", notes: "", linked_device_id: "" });
      const res = await axios.get(`${API}/rustdesk/clients/${viewingClient.id}/devices`, { headers });
      setRustdeskDevices(res.data || []);
    } catch { toast.error("Failed to add RustDesk device"); }
  };

  const handleDeleteRustdeskDevice = async (id) => {
    try {
      await axios.delete(`${API}/rustdesk/devices/${id}`, { headers });
      toast.success("RustDesk device removed");
      setRustdeskDevices(prev => prev.filter(d => d.id !== id));
    } catch { toast.error("Failed to delete"); }
  };

  const handleConnectRustdesk = async (id) => {
    try {
      const res = await axios.post(`${API}/rustdesk/devices/${id}/connect`, {}, { headers });
      if (res.data.connection_url) {
        window.open(res.data.connection_url, "_blank");
      }
      toast.success("Connection initiated");
    } catch { toast.error("Failed to connect"); }
  };

  const openEditClient = (client) => {
    setEditingClient(client);
    setFormData({
      name: client.name, email: client.email || "", phone: client.phone || "",
      address: client.address || "", industry: client.industry || "",
      contract_type: client.contract_type || "monthly", mrr: String(client.mrr || "")
    });
    setIsCreateOpen(true);
  };

  const openEditContact = (contact) => {
    setEditingContact(contact);
    setContactForm({ name: contact.name, email: contact.email, phone: contact.phone, role: contact.role, is_primary: contact.is_primary });
    setIsContactOpen(true);
  };

  const filtered = clients.filter(c => !searchQuery || c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || c.email?.toLowerCase().includes(searchQuery.toLowerCase()));

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const clientFormDialog = (
    <Dialog open={isCreateOpen} onOpenChange={v => { setIsCreateOpen(v); if (!v) setEditingClient(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editingClient ? "Edit Client" : "New Client"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Company Name</Label><Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} data-testid="client-name" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Email</Label><Input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} /></div>
          </div>
          <div><Label>Address</Label><Input value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Industry</Label><Input value={formData.industry} onChange={e => setFormData({ ...formData, industry: e.target.value })} /></div>
            <div><Label>Contract</Label>
              <Select value={formData.contract_type} onValueChange={v => setFormData({ ...formData, contract_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="annual">Annual</SelectItem><SelectItem value="per_incident">Per Incident</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>MRR ($)</Label><Input type="number" value={formData.mrr} onChange={e => setFormData({ ...formData, mrr: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={handleCreateClient} data-testid="save-client-btn">{editingClient ? "Update" : "Create"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ========== DETAIL VIEW ==========
  if (viewingClient && clientDetail) {
    const { client, tickets, devices, contracts } = clientDetail;
    const contacts = client.contacts || [];
    const health = healthScores[client.id];
    const healthColor = health ? (health.risk_level === "healthy" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : health.risk_level === "attention" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-red-500/20 text-red-400 border-red-500/30") : "";
    return (
      <div className="space-y-4" data-testid="client-detail-view">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setViewingClient(null); setClientDetail(null); }} data-testid="back-to-clients"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <Building2 className="w-5 h-5" />
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <Badge variant="outline" className="ml-2">{client.contract_type}</Badge>
          {health && <Badge className={healthColor} data-testid="client-health-badge">Health: {health.health_score}/100</Badge>}
          <div className="ml-auto"><Button variant="outline" size="sm" onClick={() => openEditClient(client)}><Edit className="w-4 h-4 mr-1" />Edit</Button></div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {health && (
            <Card className={`border ${health.risk_level === "healthy" ? "border-emerald-500/30" : health.risk_level === "attention" ? "border-amber-500/30" : "border-red-500/30"}`} data-testid="health-score-card">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Health Score</p>
                <p className={`text-xl font-bold ${health.risk_level === "healthy" ? "text-emerald-500" : health.risk_level === "attention" ? "text-amber-500" : "text-red-500"}`}>{health.health_score}/100</p>
                <p className="text-[10px] text-muted-foreground capitalize">{health.risk_level}</p>
              </CardContent>
            </Card>
          )}
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">MRR</p><p className="text-xl font-bold text-green-500">${client.mrr?.toLocaleString()}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Tickets</p><p className="text-xl font-bold">{tickets.length}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Devices</p><p className="text-xl font-bold">{devices.length}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Contacts</p><p className="text-xl font-bold">{contacts.length}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Contracts</p><p className="text-xl font-bold">{contracts.length}</p></CardContent></Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <Tabs defaultValue="contacts">
              <TabsList className="grid grid-cols-11 w-full">
                <TabsTrigger value="contacts"><User className="w-3 h-3 mr-1" />Contacts</TabsTrigger>
                <TabsTrigger value="tickets"><Ticket className="w-3 h-3 mr-1" />Tickets</TabsTrigger>
                <TabsTrigger value="devices"><Monitor className="w-3 h-3 mr-1" />Devices</TabsTrigger>
                <TabsTrigger value="contracts"><FileText className="w-3 h-3 mr-1" />Contracts</TabsTrigger>
                <TabsTrigger value="remote" data-testid="client-remote-tab"><Laptop className="w-3 h-3 mr-1" />Remote</TabsTrigger>
                <TabsTrigger value="achievements" data-testid="client-achievements-tab"><Trophy className="w-3 h-3 mr-1" />Awards</TabsTrigger>
                <TabsTrigger value="readiness" data-testid="client-readiness-tab"><CheckCircle className="w-3 h-3 mr-1" />Ready</TabsTrigger>
                <TabsTrigger value="timeline" data-testid="client-timeline-tab">Timeline</TabsTrigger>
                <TabsTrigger value="subscriptions" data-testid="client-subscriptions-tab"><ShieldCheck className="w-3 h-3 mr-1" />Subs</TabsTrigger>
                <TabsTrigger value="splynx" data-testid="client-splynx-tab"><Wifi className="w-3 h-3 mr-1" />Splynx</TabsTrigger>
                <TabsTrigger value="m365" data-testid="client-m365-tab"><Cloud className="w-3 h-3 mr-1" />M365</TabsTrigger>
              </TabsList>

              {/* CONTACTS TAB */}
              <TabsContent value="contacts" className="space-y-3">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => { setEditingContact(null); setContactForm({ name: "", email: "", phone: "", role: "general", is_primary: false }); setIsContactOpen(true); }} data-testid="add-contact-btn">
                    <UserPlus className="w-4 h-4 mr-1" />Add Contact
                  </Button>
                </div>
                {contacts.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {contacts.map(contact => (
                      <Card key={contact.id} className="relative" data-testid={`contact-${contact.id}`}>
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold ${roleColors[contact.role] || roleColors.general}`}>
                                {contact.name?.charAt(0)?.toUpperCase()}
                              </div>
                              <div>
                                <p className="font-medium flex items-center gap-1">
                                  {contact.name}
                                  {contact.is_primary && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                                </p>
                                <Badge variant="outline" className="text-[10px] capitalize">{contact.role}</Badge>
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditContact(contact)}><Edit className="w-3 h-3" /></Button>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteContact(contact.id)}><Trash2 className="w-3 h-3" /></Button>
                            </div>
                          </div>
                          <div className="mt-3 space-y-1">
                            {contact.email && <div className="flex items-center gap-2 text-sm"><Mail className="w-3 h-3 text-muted-foreground" />{contact.email}</div>}
                            {contact.phone && <div className="flex items-center gap-2 text-sm"><Phone className="w-3 h-3 text-muted-foreground" />{contact.phone}</div>}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-10"><UserPlus className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-50" /><p className="text-muted-foreground">No contacts added yet</p></div>
                )}
              </TabsContent>

              {/* TICKETS TAB */}
              <TabsContent value="tickets">
                {tickets.length > 0 ? (
                  <Table>
                    <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Title</TableHead><TableHead>Status</TableHead><TableHead>Priority</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {tickets.map(t => (
                        <TableRow key={t.id}>
                          <TableCell className="font-mono text-sm">{t.ticket_number}</TableCell>
                          <TableCell>{t.title}</TableCell>
                          <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                          <TableCell><Badge variant="secondary">{t.priority}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <p className="text-center py-8 text-muted-foreground">No tickets</p>}
              </TabsContent>

              {/* DEVICES TAB */}
              <TabsContent value="devices">
                {devices.length > 0 ? (
                  <Table>
                    <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>OS</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {devices.map(d => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.name}</TableCell>
                          <TableCell>{d.device_type}</TableCell>
                          <TableCell>{d.os}</TableCell>
                          <TableCell><Badge variant="outline" className={d.status === "online" ? "text-green-500" : "text-red-500"}>{d.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <p className="text-center py-8 text-muted-foreground">No devices</p>}
              </TabsContent>

              {/* CONTRACTS TAB */}
              <TabsContent value="contracts">
                {contracts.length > 0 ? (
                  <Table>
                    <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {contracts.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell>{c.contract_type}</TableCell>
                          <TableCell className="font-mono">${c.monthly_value?.toLocaleString()}/mo</TableCell>
                          <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <p className="text-center py-8 text-muted-foreground">No contracts</p>}
              </TabsContent>


              {/* REMOTE ACCESS TAB */}
              <TabsContent value="remote" className="space-y-4" data-testid="client-remote-tab-content">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Laptop className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-medium">RustDesk Remote Access</span>
                    <Badge variant="outline" className="text-[10px]">{rustdeskDevices.length} configured</Badge>
                  </div>
                  <Button size="sm" onClick={() => { setRustdeskForm({ device_name: "", rustdesk_id: "", rustdesk_password: "", os: "", notes: "", linked_device_id: "" }); setIsRustdeskOpen(true); }} data-testid="add-rustdesk-btn">
                    <Plus className="w-3 h-3 mr-1" />Add Device
                  </Button>
                </div>

                {rustdeskDevices.length > 0 ? (
                  <div className="space-y-2">
                    {rustdeskDevices.map(rd => (
                      <div key={rd.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors" data-testid={`rustdesk-device-${rd.id}`}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                            <Laptop className="w-5 h-5 text-blue-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{rd.device_name}</p>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="font-mono">ID: {rd.rustdesk_id}</span>
                              {rd.os && <Badge variant="outline" className="text-[9px] h-4">{rd.os}</Badge>}
                              {rd.last_connected && <span>Last: {new Date(rd.last_connected).toLocaleDateString()}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700" onClick={() => handleConnectRustdesk(rd.id)} data-testid={`connect-rustdesk-${rd.id}`}>
                            <ExternalLink className="w-3 h-3 mr-1" />Connect
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteRustdeskDevice(rd.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="py-8 text-center">
                      <Laptop className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-30" />
                      <p className="text-sm text-muted-foreground mb-1">No RustDesk devices configured</p>
                      <p className="text-xs text-muted-foreground">Add a RustDesk device to enable remote access for this client's systems</p>
                    </CardContent>
                  </Card>
                )}

                <Card className="bg-blue-500/[0.02] border-blue-500/20">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start gap-2">
                      <Shield className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-blue-400">How it works</p>
                        <p className="text-[11px] text-muted-foreground">Install the RustDesk client on the remote machine, note the Device ID and password, then add them here. You can then initiate remote sessions directly from NexusOps.</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ACTIVITY TIMELINE TAB */}
              <TabsContent value="timeline" className="space-y-2" data-testid="client-timeline">
                {clientTimeline.length > 0 ? (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {clientTimeline.map((item, i) => {
                        const typeColors = { ticket: "bg-blue-500/10 text-blue-500", invoice: "bg-green-500/10 text-green-500", time_entry: "bg-purple-500/10 text-purple-500" };
                        const typeLabels = { ticket: "Ticket", invoice: "Invoice", time_entry: "Time" };
                        return (
                          <div key={`${item.type}-${item.id || i}`} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50">
                            <Badge className={`text-[9px] ${typeColors[item.type] || "bg-muted"}`}>{typeLabels[item.type] || item.type}</Badge>
                            <div className="flex-1">
                              <p className="text-sm font-medium">{item.title}</p>
                              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                {item.ticket_number && <span>#{item.ticket_number}</span>}
                                {item.status && <Badge variant="outline" className="text-[9px]">{item.status}</Badge>}
                                {item.amount != null && <span className="font-mono">${item.amount.toLocaleString()}</span>}
                                {item.minutes != null && <span>{item.minutes} min {item.billable ? "(billable)" : ""}</span>}
                              </div>
                            </div>
                            {item.timestamp && <span className="text-[10px] text-muted-foreground">{item.timestamp.split("T")[0]}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-12 text-muted-foreground"><p>No activity recorded yet</p></div>
                )}
              </TabsContent>


              {/* SUBSCRIPTIONS TAB */}
              <TabsContent value="subscriptions" className="space-y-4">
                {/* Suped Org ID */}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">Suped Organization ID</Label>
                    <Input
                      value={subscriptions?.suped_org_id || ""}
                      onChange={e => setSubscriptions({ ...subscriptions, suped_org_id: e.target.value })}
                      placeholder="Enter Suped Org ID to enable DMARC reporting"
                      data-testid="suped-org-id-input"
                      className="font-mono text-sm"
                    />
                  </div>
                  <Button size="sm" className="mt-5" onClick={handleSaveSubscriptions} data-testid="save-subscriptions-btn">Save</Button>
                  {subscriptions?.suped_org_id && (
                    <Button size="sm" variant="outline" className="mt-5" onClick={() => fetchDmarcRecords()} data-testid="fetch-dmarc-btn">
                      <MailCheck className="w-3 h-3 mr-1" />Fetch DMARC
                    </Button>
                  )}
                </div>

                {/* Service Subscription Bars */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" />Email Security Subscriptions</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {supedServices.map(svc => {
                      const isActive = subscriptions?.services?.[svc.key] || false;
                      return (
                        <div
                          key={svc.key}
                          className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                            isActive
                              ? "bg-emerald-500/10 border-emerald-500/40 hover:bg-emerald-500/15"
                              : "bg-red-500/8 border-red-500/30 hover:bg-red-500/12"
                          }`}
                          onClick={() => toggleService(svc.key)}
                          data-testid={`subscription-${svc.key}`}
                        >
                          <div className="flex items-center gap-3">
                            {isActive
                              ? <CheckCircle className="w-5 h-5 text-emerald-400" />
                              : <XCircle className="w-5 h-5 text-red-400" />
                            }
                            <div>
                              <p className={`text-sm font-medium ${isActive ? "text-emerald-300" : "text-red-300"}`}>{svc.name}</p>
                              <p className="text-[11px] text-muted-foreground">{svc.description}</p>
                            </div>
                          </div>
                          <Badge className={`text-[10px] ${isActive ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "bg-red-500/20 text-red-400 border-red-500/40"}`}>
                            {isActive ? "ACTIVE" : "NOT ACTIVE"}
                          </Badge>
                        </div>
                      );
                    })}
                    <div className="pt-2 flex justify-end">
                      <Button size="sm" onClick={handleSaveSubscriptions} data-testid="save-subs-bottom-btn">Save Changes</Button>
                    </div>
                  </CardContent>
                </Card>

                {/* DMARC Report Data */}
                {dmarcLoading && <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>}
                {dmarcRecords && !dmarcLoading && (
                  <Card data-testid="dmarc-report-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2"><MailCheck className="w-4 h-4 text-blue-500" />DMARC Report ({dmarcRecords.summary?.period_days || 30} days)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {dmarcRecords.message ? (
                        <div className="flex items-center gap-2 text-sm text-amber-400 py-4">
                          <AlertCircle className="w-4 h-4" />
                          {dmarcRecords.message}
                        </div>
                      ) : dmarcRecords.summary ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="bg-muted/30 rounded-lg p-3"><p className="text-xs text-muted-foreground">Total Emails</p><p className="text-xl font-bold">{dmarcRecords.summary.total_emails?.toLocaleString()}</p></div>
                            <div className="bg-emerald-500/10 rounded-lg p-3"><p className="text-xs text-emerald-400">Authorized</p><p className="text-xl font-bold text-emerald-400">{dmarcRecords.summary.authorized?.toLocaleString()}</p></div>
                            <div className="bg-red-500/10 rounded-lg p-3"><p className="text-xs text-red-400">Rejected</p><p className="text-xl font-bold text-red-400">{dmarcRecords.summary.rejected?.toLocaleString()}</p></div>
                            <div className="bg-amber-500/10 rounded-lg p-3"><p className="text-xs text-amber-400">Compliance</p><p className="text-xl font-bold text-amber-400">{dmarcRecords.summary.compliance_rate}%</p></div>
                          </div>
                          {dmarcRecords.summary.top_sources?.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-2">Top Sending Sources</p>
                              {dmarcRecords.summary.top_sources.map((s, i) => (
                                <div key={i} className="flex items-center justify-between py-1 text-sm">
                                  <span className="text-muted-foreground">{s.source}</span>
                                  <span className="font-mono">{s.count.toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-center py-6 text-sm text-muted-foreground">No DMARC records found for the selected period</p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>


              {/* SPLYNX TAB */}
              <TabsContent value="splynx" className="space-y-4">
                {/* Splynx Customer ID Link */}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">Splynx Customer ID</Label>
                    <Input
                      value={splynxLink?.splynx_customer_id || ""}
                      onChange={e => setSplynxLink({ ...splynxLink, splynx_customer_id: e.target.value })}
                      placeholder="Enter Splynx Customer ID"
                      data-testid="splynx-customer-id-input"
                      className="font-mono text-sm"
                    />
                  </div>
                  <Button size="sm" className="mt-5" onClick={handleSaveSplynxLink} data-testid="save-splynx-link-btn">Link</Button>
                  {splynxLink?.linked && (
                    <Button size="sm" variant="outline" className="mt-5" onClick={fetchSplynxServices} data-testid="fetch-splynx-btn">
                      <RefreshCw className="w-3 h-3 mr-1" />Fetch Services
                    </Button>
                  )}
                </div>

                {splynxLoading && <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>}

                {splynxServices && !splynxLoading && (
                  <>
                    {splynxServices.error && (
                      <div className="flex items-center gap-2 text-sm text-amber-400 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <AlertTriangle className="w-4 h-4" />{splynxServices.error}
                      </div>
                    )}

                    {/* Customer Info */}
                    {splynxServices.customer && (
                      <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><User className="w-4 h-4" />Splynx Customer</CardTitle></CardHeader>
                        <CardContent className="text-sm space-y-1">
                          <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span>{splynxServices.customer.name}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">Login</span><span className="font-mono">{splynxServices.customer.login}</span></div>
                          {splynxServices.customer.email && <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{splynxServices.customer.email}</span></div>}
                          <div className="flex justify-between"><span className="text-muted-foreground">Status</span>
                            <Badge className={splynxServices.customer.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}>
                              {splynxServices.customer.status?.toUpperCase()}
                            </Badge>
                          </div>
                          {splynxServices.billing && (
                            <>
                              <Separator className="my-2" />
                              <div className="flex justify-between"><span className="text-muted-foreground">Billing Type</span><span className="capitalize">{splynxServices.billing.billing_type || "-"}</span></div>
                              <div className="flex justify-between"><span className="text-muted-foreground">Payment Method</span><span className="capitalize">{splynxServices.billing.payment_method || "-"}</span></div>
                              {splynxServices.billing.deposit !== undefined && <div className="flex justify-between"><span className="text-muted-foreground">Deposit</span><span>${splynxServices.billing.deposit}</span></div>}
                            </>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Services with Status Bars */}
                    <Card data-testid="splynx-services-card">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-blue-500" />Services ({splynxServices.services.length})</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {splynxServices.services.length > 0 ? splynxServices.services.map((svc, i) => {
                          const isActive = (svc.status || "active").toLowerCase() === "active";
                          const isSuspended = ["disabled", "blocked", "stopped"].includes((svc.status || "").toLowerCase());
                          return (
                            <div
                              key={svc.id || i}
                              className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                                isActive
                                  ? "bg-emerald-500/8 border-emerald-500/30"
                                  : isSuspended
                                  ? "bg-red-500/8 border-red-500/30"
                                  : "bg-amber-500/8 border-amber-500/30"
                              }`}
                              data-testid={`splynx-service-${svc.id || i}`}
                            >
                              <div className="flex items-center gap-3">
                                {isActive ? <Wifi className="w-5 h-5 text-emerald-400" /> : <WifiOff className="w-5 h-5 text-red-400" />}
                                <div>
                                  <p className={`text-sm font-medium ${isActive ? "text-emerald-300" : isSuspended ? "text-red-300" : "text-amber-300"}`}>
                                    {svc.description || svc.tariff_name || svc.service_name || "Service"}
                                  </p>
                                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                    <Badge variant="outline" className="text-[9px] h-4 capitalize">{svc.service_type}</Badge>
                                    {svc.tariff_name && <span>Plan: {svc.tariff_name}</span>}
                                    {svc.login && <span>Login: {svc.login}</span>}
                                    {svc.router && <span>Router: {svc.router}</span>}
                                    {svc.sector && <span>Sector: {svc.sector}</span>}
                                  </div>
                                  {(svc.taking_ipv4 || svc.ipv4) && (
                                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5">IP: {svc.taking_ipv4 || svc.ipv4}</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                {svc.price && <span className="font-mono text-sm font-bold">${svc.price}</span>}
                                <Badge className={`text-[10px] ${
                                  isActive ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                                  : isSuspended ? "bg-red-500/20 text-red-400 border-red-500/40"
                                  : "bg-amber-500/20 text-amber-400 border-amber-500/40"
                                }`}>
                                  {isActive ? "ACTIVE" : isSuspended ? "SUSPENDED - NON PAYMENT" : (svc.status || "UNKNOWN").toUpperCase()}
                                </Badge>
                              </div>
                            </div>
                          );
                        }) : (
                          <p className="text-center py-6 text-sm text-muted-foreground">No services found in Splynx for this customer</p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Invoices */}
                    {splynxServices.invoices && splynxServices.invoices.length > 0 && (
                      <Card data-testid="splynx-invoices-card">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2"><CreditCard className="w-4 h-4 text-indigo-500" />Recent Invoices ({splynxServices.invoices.length})</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Invoice #</TableHead><TableHead>Date</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Paid</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {splynxServices.invoices.slice(0, 15).map((inv, i) => {
                                const isPaid = inv.status === "paid" || parseFloat(inv.payment_amount || 0) >= parseFloat(inv.total || 0);
                                return (
                                  <TableRow key={inv.id || i}>
                                    <TableCell className="font-mono text-xs">{inv.number || inv.id}</TableCell>
                                    <TableCell className="text-xs">{inv.date_created || inv.date || "-"}</TableCell>
                                    <TableCell className="font-mono">${parseFloat(inv.total || 0).toFixed(2)}</TableCell>
                                    <TableCell>
                                      <Badge className={isPaid ? "bg-emerald-500/20 text-emerald-400 text-[10px]" : "bg-red-500/20 text-red-400 text-[10px]"}>
                                        {isPaid ? "Paid" : inv.status || "Unpaid"}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">${parseFloat(inv.payment_amount || 0).toFixed(2)}</TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}

                {!splynxLink?.linked && !splynxLoading && (
                  <Card className="border-dashed">
                    <CardContent className="py-8 text-center">
                      <Wifi className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-30" />
                      <p className="text-sm text-muted-foreground mb-1">No Splynx customer linked</p>
                      <p className="text-xs text-muted-foreground">Enter the Splynx Customer ID above to link this client and view their services & billing status</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* MICROSOFT 365 TAB */}
              <TabsContent value="m365" className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-medium">Microsoft 365 Integration</span>
                    {m365Config?.sync_status === "synced" && <Badge className="bg-green-600 text-white text-xs">Synced</Badge>}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { setM365TenantId(m365Config?.tenant_id || ""); setM365Domain(m365Config?.domain || ""); setM365SyncDialog(true); }} data-testid="m365-sync-btn">
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />{m365Config ? "Re-sync" : "Connect M365"}
                  </Button>
                </div>

                {m365Config ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <Card><CardContent className="pt-3"><p className="text-xs text-muted-foreground">Tenant ID</p><p className="text-sm font-mono truncate">{m365Config.tenant_id}</p></CardContent></Card>
                      <Card><CardContent className="pt-3"><p className="text-xs text-muted-foreground">Domain</p><p className="text-sm">{m365Config.domain}</p></CardContent></Card>
                      <Card><CardContent className="pt-3"><p className="text-xs text-muted-foreground">Last Synced</p><p className="text-sm">{m365Config.last_synced ? new Date(m365Config.last_synced).toLocaleDateString() : "Never"}</p></CardContent></Card>
                    </div>

                    {m365Users.length > 0 ? (
                      <Table>
                        <TableHeader><TableRow><TableHead>Display Name</TableHead><TableHead>UPN / Email</TableHead><TableHead>License Type</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {m365Users.map((u, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{u.display_name || u.name}</TableCell>
                              <TableCell className="text-sm">{u.upn || u.email}</TableCell>
                              <TableCell><Badge variant="outline" className="text-xs">{u.license_type || "Unknown"}</Badge></TableCell>
                              <TableCell><Badge className={u.status === "active" ? "bg-green-600 text-white text-xs" : "bg-zinc-600 text-white text-xs"}>{u.status || "active"}</Badge></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-center py-6 text-muted-foreground text-sm">No users synced yet. Configure CIPP integration in Settings to sync UPNs and licenses.</p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 space-y-2">
                    <Cloud className="w-12 h-12 mx-auto text-muted-foreground/30" />
                    <p className="text-muted-foreground text-sm">No Microsoft 365 tenancy linked</p>
                    <p className="text-xs text-muted-foreground">Click "Connect M365" to link this client's Microsoft 365 tenant for user & license sync via CIPP.</p>
                  </div>
                )}
              </TabsContent>

              {/* ACHIEVEMENTS TAB */}
              <TabsContent value="achievements" className="space-y-4">
                {clientAchievements ? (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">{clientAchievements.total_earned} of {clientAchievements.total_available} achievements earned</p>
                      {clientLoyalty && (
                        <Badge className={`text-xs ${clientLoyalty.tier === "platinum" ? "bg-slate-300/20 text-slate-300 border-slate-400/30" : clientLoyalty.tier === "gold" ? "bg-yellow-400/20 text-yellow-400 border-yellow-500/30" : clientLoyalty.tier === "silver" ? "bg-slate-400/20 text-slate-400 border-slate-500/30" : "bg-amber-600/20 text-amber-600 border-amber-600/30"}`}>
                          <Trophy className="w-3 h-3 mr-1" />{clientLoyalty.tier?.toUpperCase()} - {clientLoyalty.loyalty_points} pts
                        </Badge>
                      )}
                    </div>
                    {/* SLA Shields */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">SLA Shields</h4>
                      <div className="grid grid-cols-5 gap-2">
                        {clientAchievements.achievements.filter(a => a.type === "sla").map(ach => (
                          <div key={ach.id} className={`rounded-lg p-3 text-center border transition-all ${ach.earned ? "border-current opacity-100" : "opacity-30 border-muted"}`} style={ach.earned ? { borderColor: ach.color + "60" } : {}}>
                            <svg className="w-10 h-10 mx-auto mb-1" viewBox="0 0 24 24" fill="none">
                              <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" fill={ach.color} opacity={ach.earned ? "0.2" : "0.05"} />
                              <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" stroke={ach.color} strokeWidth="1.5" fill="none" />
                              {ach.earned && <path d="M9 12l2 2 4-4" stroke={ach.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
                            </svg>
                            <p className="text-[10px] font-semibold" style={{ color: ach.earned ? ach.color : undefined }}>{ach.label}</p>
                            <p className="text-[8px] text-muted-foreground">{ach.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Tenure */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Tenure Milestones</h4>
                      <div className="grid grid-cols-4 gap-2">
                        {clientAchievements.achievements.filter(a => a.type === "tenure").map(ach => (
                          <div key={ach.id} className={`rounded-lg p-3 text-center border transition-all ${ach.earned ? "border-current" : "opacity-40 border-muted"}`} style={ach.earned ? { borderColor: ach.color + "60" } : {}}>
                            <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-1 ${ach.earned ? "" : "bg-muted/30"}`}
                              style={ach.earned ? { background: ach.color + "20" } : {}}>
                              <Award className="w-6 h-6" style={{ color: ach.earned ? ach.color : undefined }} />
                            </div>
                            <p className="text-[10px] font-semibold" style={{ color: ach.earned ? ach.color : undefined }}>{ach.label}</p>
                            {!ach.earned && ach.progress !== undefined && (
                              <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${ach.progress}%`, background: ach.color }} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Loyalty */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Loyalty Badges</h4>
                      <div className="grid grid-cols-4 gap-2">
                        {clientAchievements.achievements.filter(a => a.type === "loyalty").map(ach => (
                          <div key={ach.id} className={`rounded-lg p-3 text-center border transition-all ${ach.earned ? "border-current" : "opacity-40 border-muted"}`} style={ach.earned ? { borderColor: ach.color + "60" } : {}}>
                            <Star className="w-8 h-8 mx-auto mb-1" style={{ color: ach.earned ? ach.color : undefined }} />
                            <p className="text-[10px] font-semibold" style={{ color: ach.earned ? ach.color : undefined }}>{ach.label}</p>
                            <p className="text-[8px] text-muted-foreground">{ach.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : <div className="text-center py-12 text-muted-foreground"><Trophy className="w-12 h-12 mx-auto opacity-30 mb-2" /><p className="text-sm">Loading achievements...</p></div>}
              </TabsContent>

              {/* READINESS TAB */}
              <TabsContent value="readiness" className="space-y-4">
                {clientReadiness ? (
                  <>
                    <div className="flex items-center gap-4">
                      <div className="relative w-20 h-20">
                        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                          <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted/30" />
                          <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${clientReadiness.readiness_score}, 100`} className={clientReadiness.readiness_score >= 80 ? "text-emerald-400" : clientReadiness.readiness_score >= 50 ? "text-amber-400" : "text-red-400"} />
                        </svg>
                        <span className={`absolute inset-0 flex items-center justify-center text-xl font-black ${clientReadiness.readiness_score >= 80 ? "text-emerald-400" : clientReadiness.readiness_score >= 50 ? "text-amber-400" : "text-red-400"}`}>{clientReadiness.readiness_score}%</span>
                      </div>
                      <div>
                        <p className="font-semibold">Portal Readiness Score</p>
                        <p className="text-sm text-muted-foreground">{clientReadiness.completed} of {clientReadiness.total} checks completed</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {clientReadiness.checks.map((check, i) => (
                        <div key={i} className={`flex items-center gap-3 p-2.5 rounded-lg border ${check.done ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
                          {check.done ? <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
                          <div>
                            <p className="text-sm font-medium">{check.name}</p>
                            <p className="text-[10px] text-muted-foreground">{check.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <div className="text-center py-12 text-muted-foreground"><CheckCircle className="w-12 h-12 mx-auto opacity-30 mb-2" /><p className="text-sm">Loading readiness...</p></div>}
              </TabsContent>

            </Tabs>
          </div>

          {/* Right sidebar - Client info */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <h3 className="font-semibold text-sm">Client Info</h3>
              <Separator />
              {client.email && <div className="flex items-center gap-2 text-sm"><Mail className="w-4 h-4 text-muted-foreground" />{client.email}</div>}
              {client.phone && <div className="flex items-center gap-2 text-sm"><Phone className="w-4 h-4 text-muted-foreground" />{client.phone}</div>}
              {client.address && <div className="flex items-center gap-2 text-sm"><MapPin className="w-4 h-4 text-muted-foreground" />{client.address}</div>}
              {client.industry && <div className="flex items-center gap-2 text-sm"><Building2 className="w-4 h-4 text-muted-foreground" />{client.industry}</div>}
              <Separator />
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Contract</span><span className="capitalize">{client.contract_type}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">MRR</span><span className="font-bold text-green-500">${client.mrr?.toLocaleString()}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Open Tickets</span><span>{tickets.filter(t => t.status === "open").length}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Online Devices</span><span>{devices.filter(d => d.status === "online").length}/{devices.length}</span></div>
              {health && (
                <>
                  <Separator />
                  <h3 className="font-semibold text-sm">Health Breakdown</h3>
                  {Object.entries(health.breakdown || {}).map(([key, val]) => (
                    <div key={key} className="flex justify-between text-xs">
                      <span className="text-muted-foreground capitalize">{key}</span>
                      <span className="font-mono">{val}/{key === "tickets" ? 30 : key === "sla" || key === "devices" || key === "payments" ? 20 : 10}</span>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ADD/EDIT CONTACT DIALOG */}
        <Dialog open={isContactOpen} onOpenChange={setIsContactOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingContact ? "Edit Contact" : "Add Contact"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={contactForm.name} onChange={e => setContactForm({ ...contactForm, name: e.target.value })} data-testid="contact-name" /></div>
              <div><Label>Email</Label><Input value={contactForm.email} onChange={e => setContactForm({ ...contactForm, email: e.target.value })} data-testid="contact-email" /></div>
              <div><Label>Phone</Label><Input value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} data-testid="contact-phone" /></div>
              <div><Label>Role</Label>
                <Select value={contactForm.role} onValueChange={v => setContactForm({ ...contactForm, role: v })}>
                  <SelectTrigger data-testid="contact-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Primary</SelectItem>
                    <SelectItem value="billing">Billing</SelectItem>
                    <SelectItem value="technical">Technical</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button onClick={handleAddContact} data-testid="save-contact-btn">{editingContact ? "Update" : "Add"} Contact</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* M365 SYNC DIALOG */}
        <Dialog open={m365SyncDialog} onOpenChange={setM365SyncDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Connect Microsoft 365 Tenancy</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Link this client's Microsoft 365 tenant to sync user accounts, licenses, and UPNs via CIPP integration.</p>
              <div><Label>Tenant ID</Label><Input value={m365TenantId} onChange={e => setM365TenantId(e.target.value)} placeholder="e.g., 12345678-1234-1234-1234-123456789abc" data-testid="m365-tenant-id" /></div>
              <div><Label>Primary Domain</Label><Input value={m365Domain} onChange={e => setM365Domain(e.target.value)} placeholder="e.g., contoso.onmicrosoft.com" data-testid="m365-domain" /></div>
              <div className="p-3 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Requires CIPP integration to be configured in Settings for full user/license sync.</span>
                </div>
              </div>
            </div>
            <DialogFooter><Button onClick={syncM365} data-testid="confirm-m365-sync"><Cloud className="w-4 h-4 mr-1" />Connect & Sync</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {clientFormDialog}

        {/* RUSTDESK DEVICE DIALOG */}
        <Dialog open={isRustdeskOpen} onOpenChange={setIsRustdeskOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add RustDesk Device</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Device Name</Label><Input value={rustdeskForm.device_name} onChange={e => setRustdeskForm({ ...rustdeskForm, device_name: e.target.value })} placeholder="e.g., Reception PC" data-testid="rustdesk-device-name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>RustDesk ID</Label><Input value={rustdeskForm.rustdesk_id} onChange={e => setRustdeskForm({ ...rustdeskForm, rustdesk_id: e.target.value })} placeholder="e.g., 123456789" data-testid="rustdesk-id" /></div>
                <div><Label>Password</Label><Input value={rustdeskForm.rustdesk_password} onChange={e => setRustdeskForm({ ...rustdeskForm, rustdesk_password: e.target.value })} placeholder="RustDesk password" data-testid="rustdesk-password" /></div>
              </div>
              <div><Label>Operating System</Label><Input value={rustdeskForm.os} onChange={e => setRustdeskForm({ ...rustdeskForm, os: e.target.value })} placeholder="e.g., Windows 11" /></div>
              <div><Label>Link to Existing Device (optional)</Label>
                <Select value={rustdeskForm.linked_device_id || "none"} onValueChange={v => setRustdeskForm({ ...rustdeskForm, linked_device_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select device" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- No linked device --</SelectItem>
                    {clientDetail?.devices?.map(d => <SelectItem key={d.id} value={d.id}>{d.name} ({d.ip_address || d.os})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Notes</Label><Input value={rustdeskForm.notes} onChange={e => setRustdeskForm({ ...rustdeskForm, notes: e.target.value })} placeholder="Additional notes" /></div>
            </div>
            <DialogFooter><Button onClick={handleAddRustdeskDevice} data-testid="save-rustdesk-btn"><Laptop className="w-4 h-4 mr-1" />Add Device</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ========== LIST VIEW ==========
  return (
    <div className="space-y-4" data-testid="clients-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Clients</h1><p className="text-muted-foreground">{clients.length} clients</p></div>
        <Button onClick={() => { setEditingClient(null); setFormData({ name: "", email: "", phone: "", address: "", industry: "", contract_type: "monthly", mrr: "" }); setIsCreateOpen(true); }} data-testid="create-client-btn"><Plus className="w-4 h-4 mr-1" />New Client</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search clients..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} data-testid="client-search" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead><TableHead>Health</TableHead><TableHead>Contacts</TableHead><TableHead>Industry</TableHead>
                <TableHead>Contract</TableHead><TableHead>MRR</TableHead><TableHead>Subscriptions</TableHead>
                <TableHead>Devices</TableHead><TableHead>Tickets</TableHead><TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(client => (
                <TableRow key={client.id} className="cursor-pointer hover:bg-muted/50" onClick={() => fetchClientDetail(client)} data-testid={`client-row-${client.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                        {client.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium">{client.name}</p>
                        <p className="text-xs text-muted-foreground">{client.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const h = healthScores[client.id];
                      if (!h) return <span className="text-xs text-muted-foreground">-</span>;
                      const color = h.risk_level === "healthy" ? "bg-emerald-500/10 text-emerald-500" : h.risk_level === "attention" ? "bg-amber-500/10 text-amber-500" : "bg-red-500/10 text-red-500";
                      return <Badge className={`${color} text-[10px]`} data-testid={`health-${client.id}`}>{h.health_score}</Badge>;
                    })()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{(client.contacts || []).length} contacts</Badge>
                  </TableCell>
                  <TableCell className="text-sm capitalize">{client.industry || '-'}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{client.contract_type}</Badge></TableCell>
                  <TableCell className="font-mono text-green-500">${client.mrr?.toLocaleString()}</TableCell>
                  <TableCell>
                    {(() => {
                      const sub = subsSummary[client.id];
                      if (!sub) return <span className="text-xs text-muted-foreground">-</span>;
                      const active = sub.active_count;
                      const total = sub.total;
                      return (
                        <div className="flex items-center gap-1.5" data-testid={`subs-status-${client.id}`}>
                          {active > 0 ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> : <ShieldX className="w-3.5 h-3.5 text-red-400" />}
                          <span className={`text-xs font-medium ${active > 0 ? "text-emerald-400" : "text-red-400"}`}>{active}/{total}</span>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>{client.device_count || 0}</TableCell>
                  <TableCell>{client.ticket_count || 0}</TableCell>
                  <TableCell>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditClient(client)}><Edit className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteClient(client.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {clientFormDialog}
    </div>
  );
}
