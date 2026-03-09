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
  Plus, Search, Loader2, User, ArrowLeft, Ticket, Clock, AlertTriangle,
  MessageSquare, CheckCircle, XCircle, Mail, Phone, Edit, Wrench, DollarSign,
  UserCheck, AlertCircle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const priorityConfig = {
  critical: { label: "Critical", class: "bg-red-500 text-white" },
  high: { label: "High", class: "bg-orange-500 text-white" },
  medium: { label: "Medium", class: "bg-yellow-500 text-white" },
  low: { label: "Low", class: "bg-green-600 text-white" }
};
const statusConfig = {
  open: { label: "Open", class: "text-blue-500 border-blue-500/30" },
  in_progress: { label: "In Progress", class: "text-yellow-500 border-yellow-500/30" },
  resolved: { label: "Resolved", class: "text-green-500 border-green-500/30" },
  closed: { label: "Closed", class: "text-gray-500 border-gray-500/30" }
};

export default function TechniciansPage() {
  const { token } = useAuth();
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTech, setEditingTech] = useState(null);
  const [viewingTech, setViewingTech] = useState(null);
  const [techDashboard, setTechDashboard] = useState(null);
  const [specialtyInput, setSpecialtyInput] = useState("");
  const [formData, setFormData] = useState({
    name: "", email: "", password: "nexusops123", role: "technician", hourly_rate: "75", phone: "", specialties: []
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchTechs = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/technicians/overview`, { headers });
      setTechs(res.data);
    } catch { toast.error("Failed to fetch technicians"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTechs(); }, []);

  const fetchTechDashboard = async (tech) => {
    setViewingTech(tech);
    try {
      const res = await axios.get(`${API}/technicians/${tech.id}/dashboard`, { headers });
      setTechDashboard(res.data);
    } catch { toast.error("Failed to load dashboard"); }
  };

  const handleCreate = async () => {
    try {
      const data = { ...formData, hourly_rate: parseFloat(formData.hourly_rate) || 75 };
      if (editingTech) {
        await axios.put(`${API}/technicians/${editingTech.id}`, data, { headers });
        toast.success("Technician updated");
      } else {
        await axios.post(`${API}/technicians`, data, { headers });
        toast.success("Technician added");
      }
      setIsCreateOpen(false);
      setEditingTech(null);
      resetForm();
      fetchTechs();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
  };

  const handleDeactivate = async (id) => {
    try {
      await axios.delete(`${API}/technicians/${id}`, { headers });
      toast.success("Technician deactivated");
      fetchTechs();
    } catch { toast.error("Failed"); }
  };

  const resetForm = () => setFormData({ name: "", email: "", password: "nexusops123", role: "technician", hourly_rate: "75", phone: "", specialties: [] });

  const openEdit = (tech) => {
    setEditingTech(tech);
    setFormData({
      name: tech.name, email: tech.email, password: "", role: tech.role || "technician",
      hourly_rate: String(tech.hourly_rate || 75), phone: tech.phone || "", specialties: tech.specialties || []
    });
    setIsCreateOpen(true);
  };

  const addSpecialty = () => {
    if (specialtyInput.trim()) {
      setFormData(p => ({ ...p, specialties: [...p.specialties, specialtyInput.trim()] }));
      setSpecialtyInput("");
    }
  };

  const filtered = techs.filter(t => !searchQuery || t.name?.toLowerCase().includes(searchQuery.toLowerCase()) || t.email?.toLowerCase().includes(searchQuery.toLowerCase()));

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ========== TECH DETAIL VIEW ==========
  if (viewingTech && techDashboard) {
    const { technician, stats, open_tickets, overdue_tickets, no_notes_tickets } = techDashboard;
    return (
      <div className="space-y-4" data-testid="tech-detail-view">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setViewingTech(null); setTechDashboard(null); }} data-testid="back-to-techs"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">{technician.name?.charAt(0)?.toUpperCase()}</div>
          <div>
            <h1 className="text-2xl font-bold">{technician.name}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="w-3 h-3" />{technician.email}
              {technician.phone && <><Phone className="w-3 h-3 ml-2" />{technician.phone}</>}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="capitalize">{technician.role}</Badge>
            <Badge className={technician.is_active !== false ? "bg-green-600" : "bg-gray-500"}>{technician.is_active !== false ? "Active" : "Inactive"}</Badge>
            <Button variant="outline" size="sm" onClick={() => openEdit(technician)}><Edit className="w-4 h-4 mr-1" />Edit</Button>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Assigned</p><p className="text-2xl font-bold">{stats.total_assigned}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Open</p><p className="text-2xl font-bold text-blue-500">{stats.open_tickets}</p></CardContent></Card>
          <Card className={stats.no_notes_tickets > 0 ? "border-red-500/50 bg-red-500/5" : ""}>
            <CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">No Notes</p><p className={`text-2xl font-bold ${stats.no_notes_tickets > 0 ? 'text-red-500' : 'text-green-500'}`}>{stats.no_notes_tickets}</p></CardContent>
          </Card>
          <Card className={stats.overdue_tickets > 0 ? "border-orange-500/50 bg-orange-500/5" : ""}>
            <CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Overdue</p><p className={`text-2xl font-bold ${stats.overdue_tickets > 0 ? 'text-orange-500' : 'text-green-500'}`}>{stats.overdue_tickets}</p></CardContent>
          </Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Resolved</p><p className="text-2xl font-bold text-green-500">{stats.resolved_tickets}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Hours</p><p className="text-2xl font-bold">{stats.total_hours}h</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Billable</p><p className="text-2xl font-bold text-green-500">{stats.billable_hours}h</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">This Week</p><p className="text-2xl font-bold text-cyan-500">{stats.hours_this_week}h</p></CardContent></Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue={stats.no_notes_tickets > 0 ? "no-notes" : "open"}>
          <TabsList className="grid grid-cols-3 w-full max-w-lg">
            <TabsTrigger value="open"><Ticket className="w-3 h-3 mr-1" />Open ({stats.open_tickets})</TabsTrigger>
            <TabsTrigger value="no-notes" className={stats.no_notes_tickets > 0 ? "text-red-500" : ""}>
              <AlertCircle className="w-3 h-3 mr-1" />No Notes ({stats.no_notes_tickets})
            </TabsTrigger>
            <TabsTrigger value="overdue"><AlertTriangle className="w-3 h-3 mr-1" />Overdue ({stats.overdue_tickets})</TabsTrigger>
          </TabsList>

          <TabsContent value="open">
            <TicketTable tickets={open_tickets} noNotesIds={no_notes_tickets.map(t => t.id)} />
          </TabsContent>
          <TabsContent value="no-notes">
            {no_notes_tickets.length > 0 ? (
              <>
                <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  <p className="text-sm text-red-400">These tickets have <strong>zero notes</strong>. Staff should add updates to keep clients informed.</p>
                </div>
                <TicketTable tickets={no_notes_tickets} noNotesIds={no_notes_tickets.map(t => t.id)} />
              </>
            ) : (
              <div className="text-center py-12"><CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" /><p className="text-green-500 font-medium">All open tickets have notes</p></div>
            )}
          </TabsContent>
          <TabsContent value="overdue">
            {overdue_tickets.length > 0 ? <TicketTable tickets={overdue_tickets} noNotesIds={no_notes_tickets.map(t => t.id)} /> :
              <div className="text-center py-12"><CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" /><p className="text-green-500 font-medium">No overdue tickets</p></div>}
          </TabsContent>
        </Tabs>

        {/* Specialties */}
        {(technician.specialties || []).length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Specialties</CardTitle></CardHeader>
            <CardContent className="flex gap-2 flex-wrap">
              {technician.specialties.map((s, i) => <Badge key={i} variant="secondary"><Wrench className="w-3 h-3 mr-1" />{s}</Badge>)}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ========== LIST VIEW ==========
  return (
    <div className="space-y-4" data-testid="technicians-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Technicians</h1><p className="text-muted-foreground">{techs.length} team members</p></div>
        <Button onClick={() => { setEditingTech(null); resetForm(); setIsCreateOpen(true); }} data-testid="add-tech-btn"><Plus className="w-4 h-4 mr-1" />Add Technician</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search technicians..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} data-testid="tech-search" />
      </div>

      {/* Tech Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(tech => (
          <Card key={tech.id} className={`cursor-pointer hover:border-primary/50 transition-colors ${tech.no_notes_count > 0 ? 'border-red-500/30' : ''}`}
            onClick={() => fetchTechDashboard(tech)} data-testid={`tech-card-${tech.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-lg">
                    {tech.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold">{tech.name}</p>
                    <p className="text-xs text-muted-foreground">{tech.email}</p>
                    <Badge variant="outline" className="text-[10px] capitalize mt-1">{tech.role}</Badge>
                  </div>
                </div>
                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(tech)}><Edit className="w-3 h-3" /></Button>
                </div>
              </div>
              <Separator className="my-3" />
              <div className="grid grid-cols-4 gap-2 text-center">
                <div><p className="text-lg font-bold text-blue-500">{tech.open_count}</p><p className="text-[10px] text-muted-foreground">Open</p></div>
                <div><p className={`text-lg font-bold ${tech.no_notes_count > 0 ? 'text-red-500' : 'text-green-500'}`}>{tech.no_notes_count}</p><p className="text-[10px] text-muted-foreground">No Notes</p></div>
                <div><p className={`text-lg font-bold ${tech.overdue_count > 0 ? 'text-orange-500' : 'text-green-500'}`}>{tech.overdue_count}</p><p className="text-[10px] text-muted-foreground">Overdue</p></div>
                <div><p className="text-lg font-bold text-cyan-500">{tech.hours_this_week}h</p><p className="text-[10px] text-muted-foreground">This Week</p></div>
              </div>
              {tech.no_notes_count > 0 && (
                <div className="mt-3 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-400">{tech.no_notes_count} ticket{tech.no_notes_count > 1 ? 's' : ''} with no notes</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CREATE/EDIT DIALOG */}
      <Dialog open={isCreateOpen} onOpenChange={v => { setIsCreateOpen(v); if (!v) setEditingTech(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingTech ? "Edit Technician" : "Add Technician"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Full Name</Label><Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} data-testid="tech-name" /></div>
              <div><Label>Email</Label><Input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} data-testid="tech-email" /></div>
            </div>
            {!editingTech && <div><Label>Password</Label><Input type="password" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} /></div>}
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Role</Label>
                <Select value={formData.role} onValueChange={v => setFormData({ ...formData, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="technician">Technician</SelectItem>
                    <SelectItem value="dispatcher">Dispatcher</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Hourly Rate ($)</Label><Input type="number" value={formData.hourly_rate} onChange={e => setFormData({ ...formData, hourly_rate: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} /></div>
            </div>
            <div>
              <Label>Specialties</Label>
              <div className="flex gap-2 flex-wrap mb-2">
                {formData.specialties.map((s, i) => (
                  <Badge key={i} variant="secondary" className="cursor-pointer" onClick={() => setFormData(p => ({ ...p, specialties: p.specialties.filter((_, j) => j !== i) }))}>
                    {s} <XCircle className="w-3 h-3 ml-1" />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input className="flex-1" placeholder="e.g. Networking, Azure, Security" value={specialtyInput} onChange={e => setSpecialtyInput(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addSpecialty())} />
                <Button type="button" variant="outline" size="sm" onClick={addSpecialty}>Add</Button>
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreate} data-testid="save-tech-btn">{editingTech ? "Update" : "Add"} Technician</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TicketTable({ tickets, noNotesIds = [] }) {
  if (!tickets.length) return <p className="text-center py-8 text-muted-foreground">No tickets</p>;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead><TableHead>Title</TableHead><TableHead>Client</TableHead>
              <TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Notes</TableHead><TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tickets.map(t => (
              <TableRow key={t.id} className={noNotesIds.includes(t.id) ? "bg-red-500/5" : ""}>
                <TableCell className="font-mono text-sm">{t.ticket_number}</TableCell>
                <TableCell className="max-w-[200px] truncate">{t.title}</TableCell>
                <TableCell className="text-sm">{t.client_name}</TableCell>
                <TableCell><Badge className={priorityConfig[t.priority]?.class + " text-xs"}>{priorityConfig[t.priority]?.label}</Badge></TableCell>
                <TableCell><Badge variant="outline" className={statusConfig[t.status]?.class}>{statusConfig[t.status]?.label}</Badge></TableCell>
                <TableCell>
                  {noNotesIds.includes(t.id) ? (
                    <Badge variant="destructive" className="text-[10px]"><AlertCircle className="w-3 h-3 mr-1" />None</Badge>
                  ) : (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.created_at && formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
