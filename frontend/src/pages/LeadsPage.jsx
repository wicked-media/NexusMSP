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
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { 
  Plus, 
  Search, 
  Users,
  Phone,
  Mail,
  Globe,
  Building2,
  DollarSign,
  MoreVertical,
  RefreshCw,
  Loader2,
  TrendingUp,
  Target,
  UserCheck,
  ArrowRight
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
  const { token } = useAuth();
  const [leads, setLeads] = useState([]);
  const [users, setUsers] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [formData, setFormData] = useState({
    company_name: "",
    contact_name: "",
    email: "",
    phone: "",
    website: "",
    source: "website",
    industry: "",
    employee_count: "",
    estimated_value: 0,
    notes: "",
    assigned_to: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [leadsRes, usersRes, dashboardRes] = await Promise.all([
        axios.get(`${API}/leads`, { headers }),
        axios.get(`${API}/users`, { headers }),
        axios.get(`${API}/crm/dashboard`, { headers })
      ]);
      setLeads(leadsRes.data);
      setUsers(usersRes.data);
      setDashboardStats(dashboardRes.data);
    } catch (error) {
      toast.error("Failed to fetch leads");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        estimated_value: parseFloat(formData.estimated_value) || 0
      };
      
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
    } catch (error) {
      toast.error("Failed to save lead");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this lead?")) return;
    try {
      await axios.delete(`${API}/leads/${id}`, { headers });
      toast.success("Lead deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete lead");
    }
  };

  const handleConvert = async (id) => {
    if (!confirm("Convert this lead to a client?")) return;
    try {
      await axios.post(`${API}/leads/${id}/convert`, {}, { headers });
      toast.success("Lead converted to client");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to convert lead");
    }
  };

  const updateStatus = async (id, newStatus) => {
    try {
      await axios.put(`${API}/leads/${id}`, { status: newStatus }, { headers });
      toast.success("Status updated");
      fetchData();
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  const resetForm = () => {
    setFormData({
      company_name: "",
      contact_name: "",
      email: "",
      phone: "",
      website: "",
      source: "website",
      industry: "",
      employee_count: "",
      estimated_value: 0,
      notes: "",
      assigned_to: ""
    });
    setSelectedLead(null);
  };

  const openEditDialog = (lead) => {
    setSelectedLead(lead);
    setFormData({
      company_name: lead.company_name,
      contact_name: lead.contact_name,
      email: lead.email || "",
      phone: lead.phone || "",
      website: lead.website || "",
      source: lead.source,
      industry: lead.industry || "",
      employee_count: lead.employee_count || "",
      estimated_value: lead.estimated_value || 0,
      notes: lead.notes || "",
      assigned_to: lead.assigned_to || ""
    });
    setIsDialogOpen(true);
  };

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = lead.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          lead.contact_name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6" data-testid="leads-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads & CRM</h1>
          <p className="text-muted-foreground">Manage your sales pipeline</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="add-lead-button">
                <Plus className="w-4 h-4 mr-2" />
                Add Lead
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{selectedLead ? "Edit Lead" : "Add New Lead"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Company Name *</Label>
                    <Input
                      value={formData.company_name}
                      onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                      placeholder="Acme Inc"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Contact Name *</Label>
                    <Input
                      value={formData.contact_name}
                      onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                      placeholder="John Smith"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="john@acme.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+1 555-0100"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Website</Label>
                    <Input
                      value={formData.website}
                      onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                      placeholder="https://acme.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Source</Label>
                    <Select value={formData.source} onValueChange={(v) => setFormData({ ...formData, source: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="website">Website</SelectItem>
                        <SelectItem value="referral">Referral</SelectItem>
                        <SelectItem value="cold_call">Cold Call</SelectItem>
                        <SelectItem value="marketing">Marketing</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Industry</Label>
                    <Input
                      value={formData.industry}
                      onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                      placeholder="Technology"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Employee Count</Label>
                    <Select value={formData.employee_count} onValueChange={(v) => setFormData({ ...formData, employee_count: v })}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1-10">1-10</SelectItem>
                        <SelectItem value="11-50">11-50</SelectItem>
                        <SelectItem value="51-200">51-200</SelectItem>
                        <SelectItem value="201-500">201-500</SelectItem>
                        <SelectItem value="500+">500+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Estimated Value ($)</Label>
                    <Input
                      type="number"
                      value={formData.estimated_value}
                      onChange={(e) => setFormData({ ...formData, estimated_value: e.target.value })}
                      placeholder="5000"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Assigned To</Label>
                  <Select value={formData.assigned_to} onValueChange={(v) => setFormData({ ...formData, assigned_to: v })}>
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      {users.map(user => (
                        <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Additional information..."
                    rows={3}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit">{selectedLead ? "Update" : "Create Lead"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      {dashboardStats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dashboardStats.leads.total}</p>
                <p className="text-xs text-muted-foreground">Total Leads</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <Target className="w-5 h-5 text-cyan-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dashboardStats.leads.qualified}</p>
                <p className="text-xs text-muted-foreground">Qualified</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <UserCheck className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dashboardStats.leads.won}</p>
                <p className="text-xs text-muted-foreground">Won</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">${dashboardStats.leads.pipeline_value.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Pipeline Value</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dashboardStats.conversion_rate}%</p>
                <p className="text-xs text-muted-foreground">Conversion Rate</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(statusConfig).map(([key, config]) => (
              <SelectItem key={key} value={key}>{config.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Leads Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredLeads.length > 0 ? (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLeads.map(lead => (
                    <TableRow key={lead.id} className="table-row-hover">
                      <TableCell>
                        <div>
                          <p className="font-medium">{lead.company_name}</p>
                          <p className="text-xs text-muted-foreground">{lead.industry || 'No industry'}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm">{lead.contact_name}</p>
                          {lead.email && <p className="text-xs text-muted-foreground">{lead.email}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{sourceConfig[lead.source]?.label || lead.source}</Badge>
                      </TableCell>
                      <TableCell className="font-mono">${lead.estimated_value?.toLocaleString() || 0}</TableCell>
                      <TableCell>
                        <Badge className={`${statusConfig[lead.status]?.color} text-white`}>
                          {statusConfig[lead.status]?.label || lead.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{lead.assigned_name || '-'}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(lead)}>Edit</DropdownMenuItem>
                            {lead.status !== 'won' && lead.status !== 'lost' && (
                              <>
                                <DropdownMenuItem onClick={() => updateStatus(lead.id, 'qualified')}>
                                  Mark Qualified
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleConvert(lead.id)}>
                                  <ArrowRight className="w-4 h-4 mr-2" />
                                  Convert to Client
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(lead.id)}>
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <div className="flex flex-col items-center justify-center h-64">
              <Users className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
              <p className="text-muted-foreground">No leads found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
