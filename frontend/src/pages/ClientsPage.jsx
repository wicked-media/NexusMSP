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
  ArrowLeft, User, Edit, Trash2, MapPin, Star, FileText, UserPlus
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
  const [formData, setFormData] = useState({
    name: "", email: "", phone: "", address: "", industry: "", contract_type: "monthly", mrr: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchClients = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/clients`, { headers });
      setClients(res.data);
    } catch { toast.error("Failed to fetch clients"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchClients(); }, []);

  const fetchClientDetail = async (client) => {
    setViewingClient(client);
    try {
      const res = await axios.get(`${API}/clients/${client.id}/detail`, { headers });
      setClientDetail(res.data);
    } catch { toast.error("Failed to load client details"); }
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

  // ========== DETAIL VIEW ==========
  if (viewingClient && clientDetail) {
    const { client, tickets, devices, contracts } = clientDetail;
    const contacts = client.contacts || [];
    return (
      <div className="space-y-4" data-testid="client-detail-view">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setViewingClient(null); setClientDetail(null); }} data-testid="back-to-clients"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <Building2 className="w-5 h-5" />
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <Badge variant="outline" className="ml-2">{client.contract_type}</Badge>
          <div className="ml-auto"><Button variant="outline" size="sm" onClick={() => openEditClient(client)}><Edit className="w-4 h-4 mr-1" />Edit</Button></div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">MRR</p><p className="text-xl font-bold text-green-500">${client.mrr?.toLocaleString()}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Tickets</p><p className="text-xl font-bold">{tickets.length}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Devices</p><p className="text-xl font-bold">{devices.length}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Contacts</p><p className="text-xl font-bold">{contacts.length}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Contracts</p><p className="text-xl font-bold">{contracts.length}</p></CardContent></Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <Tabs defaultValue="contacts">
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="contacts"><User className="w-3 h-3 mr-1" />Contacts ({contacts.length})</TabsTrigger>
                <TabsTrigger value="tickets"><Ticket className="w-3 h-3 mr-1" />Tickets ({tickets.length})</TabsTrigger>
                <TabsTrigger value="devices"><Monitor className="w-3 h-3 mr-1" />Devices ({devices.length})</TabsTrigger>
                <TabsTrigger value="contracts"><FileText className="w-3 h-3 mr-1" />Contracts ({contracts.length})</TabsTrigger>
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
                <TableHead>Client</TableHead><TableHead>Contacts</TableHead><TableHead>Industry</TableHead>
                <TableHead>Contract</TableHead><TableHead>MRR</TableHead><TableHead>Devices</TableHead>
                <TableHead>Tickets</TableHead><TableHead>Actions</TableHead>
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
                    <Badge variant="secondary">{(client.contacts || []).length} contacts</Badge>
                  </TableCell>
                  <TableCell className="text-sm capitalize">{client.industry || '-'}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{client.contract_type}</Badge></TableCell>
                  <TableCell className="font-mono text-green-500">${client.mrr?.toLocaleString()}</TableCell>
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

      {/* CREATE/EDIT CLIENT DIALOG */}
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
    </div>
  );
}
