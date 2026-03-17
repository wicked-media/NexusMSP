import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  Plus, Search, Users, Phone, Mail, Globe, Building2, DollarSign,
  MoreVertical, RefreshCw, Loader2, TrendingUp, Target, UserCheck,
  ArrowRight, Ticket, Link2, Clock, MessageSquare, Calendar
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";

const statusConfig = {
  new: { label: "New", color: "bg-blue-500", textColor: "text-blue-500" },
  contacted: { label: "Contacted", color: "bg-purple-500", textColor: "text-purple-500" },
  qualified: { label: "Qualified", color: "bg-cyan-500", textColor: "text-cyan-500" },
  proposal: { label: "Proposal", color: "bg-yellow-500", textColor: "text-yellow-500" },
  negotiation: { label: "Negotiation", color: "bg-orange-500", textColor: "text-orange-500" },
  won: { label: "Won", color: "bg-green-500", textColor: "text-green-500" },
  lost: { label: "Lost", color: "bg-red-500", textColor: "text-red-500" }
};

const sourceConfig = {
  website: { label: "Website", icon: Globe },
  referral: { label: "Referral", icon: Users },
  cold_call: { label: "Cold Call", icon: Phone },
  marketing: { label: "Marketing", icon: Target },
  other: { label: "Other", icon: Building2 }
};

export default function LeadsPage() {
  const { token, user } = useAuth();
  const [leads, setLeads] = useState([]);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [detailLead, setDetailLead] = useState(null);
  const [leadActivities, setLeadActivities] = useState([]);
  const [isTicketDialogOpen, setIsTicketDialogOpen] = useState(false);
  const [isAssignClientDialogOpen, setIsAssignClientDialogOpen] = useState(false);
  const [ticketForm, setTicketForm] = useState({ title: "", description: "", priority: "medium", category: "support" });
  const [selectedClientId, setSelectedClientId] = useState("");
  const [formData, setFormData] = useState({
    company_name: "", contact_name: "", email: "", phone: "", website: "",
    source: "website", industry: "", employee_count: "", estimated_value: 0, notes: "", assigned_to: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [leadsRes, usersRes, dashboardRes, clientsRes] = await Promise.all([
        axios.get(`${API}/leads`, { headers }),
        axios.get(`${API}/users`, { headers }),
        axios.get(`${API}/crm/dashboard`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setLeads(leadsRes.data);
      setUsers(usersRes.data);
      setDashboardStats(dashboardRes.data);
      setClients(clientsRes.data);
    } catch { toast.error("Failed to fetch leads"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const fetchLeadDetail = async (lead) => {
    setDetailLead(lead);
    try {
      const res = await axios.get(`${API}/leads/${lead.id}/activities`, { headers });
      setLeadActivities(res.data);
    } catch { setLeadActivities([]); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...formData, estimated_value: parseFloat(formData.estimated_value) || 0 };
      if (selectedLead) {
        await axios.put(`${API}/leads/${selectedLead.id}`, payload, { headers });
        toast.success("Lead updated");
      } else {
        await axios.post(`${API}/leads`, payload, { headers });
        toast.success("Lead created");
      }
      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch { toast.error("Failed to save lead"); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this lead?")) return;
    try {
      await axios.delete(`${API}/leads/${id}`, { headers });
      toast.success("Lead deleted");
      if (detailLead?.id === id) setDetailLead(null);
      fetchData();
    } catch { toast.error("Failed to delete lead"); }
  };

  const handleConvert = async (id) => {
    if (!confirm("Convert this lead to a client?")) return;
    try {
      await axios.post(`${API}/leads/${id}/convert`, {}, { headers });
      toast.success("Lead converted to client");
      fetchData();
      if (detailLead?.id === id) setDetailLead(null);
    } catch (error) { toast.error(error.response?.data?.detail || "Failed to convert lead"); }
  };

  const handleCreateTicket = async () => {
    if (!detailLead) return;
    try {
      const res = await axios.post(`${API}/leads/${detailLead.id}/create-ticket`, ticketForm, { headers });
      toast.success(`Ticket ${res.data.ticket_number} created from lead`);
      setIsTicketDialogOpen(false);
      setTicketForm({ title: "", description: "", priority: "medium", category: "support" });
      fetchLeadDetail(detailLead);
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Failed to create ticket"); }
  };

  const handleAssignClient = async () => {
    if (!detailLead || !selectedClientId) return;
    try {
      await axios.post(`${API}/leads/${detailLead.id}/assign-client`, { client_id: selectedClientId }, { headers });
      toast.success("Client assigned to lead");
      setIsAssignClientDialogOpen(false);
      setSelectedClientId("");
      fetchData();
      setDetailLead(null);
    } catch (error) { toast.error(error.response?.data?.detail || "Failed to assign client"); }
  };

  const updateStatus = async (id, newStatus) => {
    try {
      await axios.put(`${API}/leads/${id}`, { status: newStatus }, { headers });
      toast.success("Status updated");
      fetchData();
    } catch { toast.error("Failed to update status"); }
  };

  const addActivity = async (type, subject) => {
    if (!detailLead) return;
    try {
      await axios.post(`${API}/leads/${detailLead.id}/activities`, { activity_type: type, subject }, { headers });
      toast.success("Activity logged");
      fetchLeadDetail(detailLead);
    } catch { toast.error("Failed to log activity"); }
  };

  const resetForm = () => {
    setFormData({ company_name: "", contact_name: "", email: "", phone: "", website: "",
      source: "website", industry: "", employee_count: "", estimated_value: 0, notes: "", assigned_to: "" });
    setSelectedLead(null);
  };

  const openEditDialog = (lead) => {
    setSelectedLead(lead);
    setFormData({
      company_name: lead.company_name, contact_name: lead.contact_name,
      email: lead.email || "", phone: lead.phone || "", website: lead.website || "",
      source: lead.source, industry: lead.industry || "", employee_count: lead.employee_count || "",
      estimated_value: lead.estimated_value || 0, notes: lead.notes || "", assigned_to: lead.assigned_to || ""
    });
    setIsDialogOpen(true);
  };

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = lead.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          lead.contact_name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Detail view for a selected lead
  if (detailLead) {
    return (
      <div className="space-y-6" data-testid="lead-detail-view">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => setDetailLead(null)} data-testid="back-to-leads-btn">Back to Leads</Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{detailLead.company_name}</h1>
            <p className="text-muted-foreground">{detailLead.contact_name} - {detailLead.email || "No email"}</p>
          </div>
          <Badge className={`${statusConfig[detailLead.status]?.color} text-white`}>{statusConfig[detailLead.status]?.label}</Badge>
        </div>

        {/* Action Buttons - Syncro Style */}
        <div className="flex flex-wrap gap-2">
          {!detailLead.converted_to_client && (
            <>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={async () => {
                if (!confirm("This will convert the lead to a client AND open a ticket creation form. Continue?")) return;
                try {
                  await axios.post(`${API}/leads/${detailLead.id}/convert`, {}, { headers });
                  toast.success("Lead converted to client");
                  setTicketForm({ title: `Inquiry from ${detailLead.company_name}`, description: `Lead inquiry from ${detailLead.contact_name}.\n\n${detailLead.notes || ""}`, priority: "medium", category: "support" });
                  setIsTicketDialogOpen(true);
                  fetchData();
                } catch (error) { toast.error(error.response?.data?.detail || "Failed to convert lead"); }
              }} data-testid="convert-and-create-ticket-btn">
                <UserCheck className="w-4 h-4 mr-1" />Convert to Client & Create Ticket
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleConvert(detailLead.id)} data-testid="convert-lead-btn">
                <UserCheck className="w-4 h-4 mr-1" />Convert to Client Only
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIsAssignClientDialogOpen(true)} data-testid="assign-client-btn">
                <Link2 className="w-4 h-4 mr-1" />Assign Existing Client
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => { setTicketForm({ title: `Inquiry from ${detailLead.company_name}`, description: `Lead inquiry from ${detailLead.contact_name}.\n\n${detailLead.notes || ""}`, priority: "medium", category: "support" }); setIsTicketDialogOpen(true); }}
            data-testid="create-ticket-from-lead-btn">
            <Ticket className="w-4 h-4 mr-1" />Create Ticket
          </Button>
          {detailLead.converted_to_client && (
            <Badge variant="outline" className="text-green-400 border-green-500/30">Linked to Client</Badge>
          )}
          <Button size="sm" variant="outline" onClick={() => openEditDialog(detailLead)}>Edit Lead</Button>
          <Select onValueChange={(v) => updateStatus(detailLead.id, v)} value={detailLead.status}>
            <SelectTrigger className="w-[150px] h-8"><SelectValue placeholder="Change Status" /></SelectTrigger>
            <SelectContent>
              {Object.entries(statusConfig).map(([k, v]) => (<SelectItem key={k} value={k}>{v.label}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>

        {/* Lead Info Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Lead Details</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground" /><span>{detailLead.email || "-"}</span></div>
              <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" /><span>{detailLead.phone || "-"}</span></div>
              <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-muted-foreground" /><span>{detailLead.website || "-"}</span></div>
              <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-muted-foreground" /><span>{detailLead.industry || "-"}</span></div>
              <div className="flex items-center gap-2"><DollarSign className="w-4 h-4 text-muted-foreground" /><span className="font-mono">${(detailLead.estimated_value || 0).toLocaleString()}</span></div>
              <div className="flex items-center gap-2"><Users className="w-4 h-4 text-muted-foreground" /><span>{detailLead.employee_count || "-"} employees</span></div>
              <div className="flex items-center gap-2"><Target className="w-4 h-4 text-muted-foreground" /><span>Source: {sourceConfig[detailLead.source]?.label || detailLead.source}</span></div>
              {detailLead.assigned_name && <div className="flex items-center gap-2"><UserCheck className="w-4 h-4 text-muted-foreground" /><span>Assigned: {detailLead.assigned_name}</span></div>}
              {detailLead.notes && <div className="pt-2 border-t"><p className="text-xs text-muted-foreground mb-1">Notes</p><p className="text-sm whitespace-pre-wrap">{detailLead.notes}</p></div>}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Activity Timeline</CardTitle>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addActivity("call", "Phone call")} data-testid="log-call-btn"><Phone className="w-3 h-3 mr-1" />Log Call</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addActivity("email", "Email sent")} data-testid="log-email-btn"><Mail className="w-3 h-3 mr-1" />Log Email</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addActivity("meeting", "Meeting held")} data-testid="log-meeting-btn"><Calendar className="w-3 h-3 mr-1" />Log Meeting</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addActivity("note", "Note added")} data-testid="log-note-btn"><MessageSquare className="w-3 h-3 mr-1" />Note</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[350px]">
                {leadActivities.length > 0 ? (
                  <div className="space-y-3">
                    {leadActivities.map(act => (
                      <div key={act.id} className="flex gap-3 items-start border-l-2 border-muted pl-3 pb-3" data-testid={`activity-${act.id}`}>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] h-5">{act.activity_type}</Badge>
                            <span className="text-sm font-medium">{act.subject}</span>
                          </div>
                          {act.description && <p className="text-xs text-muted-foreground mt-1">{act.description}</p>}
                          <p className="text-[10px] text-muted-foreground mt-1">{act.user_name} - {formatDistanceToNow(new Date(act.created_at), { addSuffix: true })}</p>
                        </div>
                        {act.outcome && <Badge variant={act.outcome === "positive" ? "default" : act.outcome === "negative" ? "destructive" : "secondary"} className="text-[9px]">{act.outcome}</Badge>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                    <Clock className="w-8 h-8 opacity-50 mb-2" />
                    <p className="text-sm">No activity yet</p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Create Ticket Dialog */}
        <Dialog open={isTicketDialogOpen} onOpenChange={setIsTicketDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Ticket from Lead</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Title *</Label>
                <Input value={ticketForm.title} onChange={e => setTicketForm({ ...ticketForm, title: e.target.value })} data-testid="ticket-title-input" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={ticketForm.description} onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })} rows={4} data-testid="ticket-desc-input" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={ticketForm.priority} onValueChange={v => setTicketForm({ ...ticketForm, priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={ticketForm.category} onValueChange={v => setTicketForm({ ...ticketForm, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="support">Support</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="onboarding">Onboarding</SelectItem>
                      <SelectItem value="billing">Billing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsTicketDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateTicket} disabled={!ticketForm.title} data-testid="submit-ticket-btn">Create Ticket</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* Assign Client Dialog */}
        <Dialog open={isAssignClientDialogOpen} onOpenChange={setIsAssignClientDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Assign Existing Client</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Select Client</Label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger data-testid="assign-client-select"><SelectValue placeholder="Choose a client..." /></SelectTrigger>
                  <SelectContent>
                    {clients.map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAssignClientDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleAssignClient} disabled={!selectedClientId} data-testid="confirm-assign-client-btn">Assign Client</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="leads-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads & CRM</h1>
          <p className="text-muted-foreground">Manage your sales pipeline</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="add-lead-button"><Plus className="w-4 h-4 mr-2" />Add Lead</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>{selectedLead ? "Edit Lead" : "Add New Lead"}</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Company Name *</Label><Input value={formData.company_name} onChange={(e) => setFormData({ ...formData, company_name: e.target.value })} placeholder="Acme Inc" required /></div>
                  <div className="space-y-2"><Label>Contact Name *</Label><Input value={formData.contact_name} onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })} placeholder="John Smith" required /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Email</Label><Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="john@acme.com" /></div>
                  <div className="space-y-2"><Label>Phone</Label><Input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="+1 555-0100" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Website</Label><Input value={formData.website} onChange={(e) => setFormData({ ...formData, website: e.target.value })} placeholder="https://acme.com" /></div>
                  <div className="space-y-2"><Label>Source</Label>
                    <Select value={formData.source} onValueChange={(v) => setFormData({ ...formData, source: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="website">Website</SelectItem><SelectItem value="referral">Referral</SelectItem>
                        <SelectItem value="cold_call">Cold Call</SelectItem><SelectItem value="marketing">Marketing</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2"><Label>Industry</Label><Input value={formData.industry} onChange={(e) => setFormData({ ...formData, industry: e.target.value })} placeholder="Technology" /></div>
                  <div className="space-y-2"><Label>Employee Count</Label>
                    <Select value={formData.employee_count} onValueChange={(v) => setFormData({ ...formData, employee_count: v })}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1-10">1-10</SelectItem><SelectItem value="11-50">11-50</SelectItem>
                        <SelectItem value="51-200">51-200</SelectItem><SelectItem value="201-500">201-500</SelectItem>
                        <SelectItem value="500+">500+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Estimated Value ($)</Label><Input type="number" value={formData.estimated_value} onChange={(e) => setFormData({ ...formData, estimated_value: e.target.value })} /></div>
                </div>
                <div className="space-y-2"><Label>Assigned To</Label>
                  <Select value={formData.assigned_to} onValueChange={(v) => setFormData({ ...formData, assigned_to: v })}>
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>{users.map(u => (<SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>))}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Notes</Label><Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Additional information..." rows={3} /></div>
                <DialogFooter><Button type="submit">{selectedLead ? "Update" : "Create Lead"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      {dashboardStats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Users className="w-5 h-5 text-blue-500" /></div><div><p className="text-2xl font-bold">{dashboardStats.leads.total}</p><p className="text-xs text-muted-foreground">Total Leads</p></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center"><Target className="w-5 h-5 text-cyan-500" /></div><div><p className="text-2xl font-bold">{dashboardStats.leads.qualified}</p><p className="text-xs text-muted-foreground">Qualified</p></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><UserCheck className="w-5 h-5 text-green-500" /></div><div><p className="text-2xl font-bold">{dashboardStats.leads.won}</p><p className="text-xs text-muted-foreground">Won</p></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-primary" /></div><div><p className="text-2xl font-bold">${dashboardStats.leads.pipeline_value.toLocaleString()}</p><p className="text-xs text-muted-foreground">Pipeline Value</p></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-yellow-500" /></div><div><p className="text-2xl font-bold">{dashboardStats.conversion_rate}%</p><p className="text-xs text-muted-foreground">Conversion Rate</p></div></CardContent></Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search leads..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(statusConfig).map(([key, config]) => (<SelectItem key={key} value={key}>{config.label}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      {/* Pipeline + Table Views */}
      <Tabs defaultValue="pipeline">
        <TabsList><TabsTrigger value="pipeline">Pipeline</TabsTrigger><TabsTrigger value="table">Table</TabsTrigger></TabsList>
        <TabsContent value="pipeline">
          <div className="grid grid-cols-5 gap-3 overflow-x-auto" data-testid="leads-pipeline">
            {["new", "contacted", "qualified", "proposal", "negotiation"].map(stage => {
              const stageLeads = leads.filter(l => l.status === stage);
              const stageValue = stageLeads.reduce((s, l) => s + (l.estimated_value || 0), 0);
              return (
                <div key={stage} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${statusConfig[stage]?.color}`} />
                      <span className="text-sm font-medium">{statusConfig[stage]?.label}</span>
                      <Badge variant="secondary" className="text-[10px] h-5">{stageLeads.length}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">${stageValue.toLocaleString()}</span>
                  </div>
                  <div className="space-y-2 min-h-[200px]">
                    {stageLeads.map(lead => (
                      <Card key={lead.id} className="cursor-pointer hover:border-primary/50 transition-all hover:shadow-md" onClick={() => fetchLeadDetail(lead)} data-testid={`pipeline-card-${lead.id}`}>
                        <CardContent className="p-3">
                          <p className="font-medium text-sm mb-1 truncate">{lead.company_name}</p>
                          <p className="text-xs text-muted-foreground mb-2">{lead.contact_name}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-medium">${(lead.estimated_value || 0).toLocaleString()}</span>
                            <Badge variant="outline" className="text-[9px] h-4">{sourceConfig[lead.source]?.label || lead.source}</Badge>
                          </div>
                          {lead.assigned_name && <p className="text-[10px] text-muted-foreground mt-1">{lead.assigned_name}</p>}
                        </CardContent>
                      </Card>
                    ))}
                    {stageLeads.length === 0 && (<div className="border border-dashed rounded-lg p-4 text-center text-xs text-muted-foreground">No leads</div>)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <Card className="border-green-500/20"><CardContent className="py-3 flex items-center justify-between"><div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-green-500" /><span className="text-sm font-medium">Won</span><Badge variant="secondary" className="text-[10px] h-5">{leads.filter(l => l.status === "won").length}</Badge></div><span className="font-mono text-sm text-green-500">${leads.filter(l => l.status === "won").reduce((s, l) => s + (l.estimated_value || 0), 0).toLocaleString()}</span></CardContent></Card>
            <Card className="border-red-500/20"><CardContent className="py-3 flex items-center justify-between"><div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-red-500" /><span className="text-sm font-medium">Lost</span><Badge variant="secondary" className="text-[10px] h-5">{leads.filter(l => l.status === "lost").length}</Badge></div><span className="font-mono text-sm text-red-500">${leads.filter(l => l.status === "lost").reduce((s, l) => s + (l.estimated_value || 0), 0).toLocaleString()}</span></CardContent></Card>
          </div>
        </TabsContent>
        <TabsContent value="table">
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
              ) : filteredLeads.length > 0 ? (
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company</TableHead><TableHead>Contact</TableHead><TableHead>Source</TableHead>
                        <TableHead>Value</TableHead><TableHead>Status</TableHead><TableHead>Assigned To</TableHead><TableHead className="w-[60px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLeads.map(lead => (
                        <TableRow key={lead.id} className="cursor-pointer hover:bg-muted/50" onClick={() => fetchLeadDetail(lead)}>
                          <TableCell><div><p className="font-medium">{lead.company_name}</p><p className="text-xs text-muted-foreground">{lead.industry || 'No industry'}</p></div></TableCell>
                          <TableCell><div><p className="text-sm">{lead.contact_name}</p>{lead.email && <p className="text-xs text-muted-foreground">{lead.email}</p>}</div></TableCell>
                          <TableCell><Badge variant="outline">{sourceConfig[lead.source]?.label || lead.source}</Badge></TableCell>
                          <TableCell className="font-mono">${lead.estimated_value?.toLocaleString() || 0}</TableCell>
                          <TableCell><Badge className={`${statusConfig[lead.status]?.color} text-white`}>{statusConfig[lead.status]?.label || lead.status}</Badge></TableCell>
                          <TableCell>{lead.assigned_name || '-'}</TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => e.stopPropagation()}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditDialog(lead); }}>Edit</DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); fetchLeadDetail(lead); }}><ArrowRight className="w-4 h-4 mr-2" />View Details</DropdownMenuItem>
                                {lead.status !== 'won' && lead.status !== 'lost' && (
                                  <>
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateStatus(lead.id, 'qualified'); }}>Mark Qualified</DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleConvert(lead.id); }}><UserCheck className="w-4 h-4 mr-2" />Convert to Client</DropdownMenuItem>
                                  </>
                                )}
                                <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(lead.id); }}>Delete</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                <div className="flex flex-col items-center justify-center h-64"><Users className="w-12 h-12 text-muted-foreground opacity-50 mb-4" /><p className="text-muted-foreground">No leads found</p></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
