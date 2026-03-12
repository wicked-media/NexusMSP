import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Plus, Search, Loader2, User, ArrowLeft, Ticket, Clock, AlertTriangle,
  CheckCircle, XCircle, Mail, Phone, Edit, Wrench, DollarSign, UserCheck,
  AlertCircle, ExternalLink, Shield, Trophy, History, BarChart3, Award,
  Crown, Star, Lock, Unlock, ChevronRight, Eye, FileText, Monitor, Wifi, WifiOff
} from "lucide-react";

const JOB_TITLES = ["L1 Technician", "L2 Technician", "Senior Engineer", "Service Manager", "Dispatcher"];
const MODULES = [
  { key: "tickets", label: "Tickets", icon: Ticket },
  { key: "clients", label: "Clients", icon: User },
  { key: "invoices", label: "Invoices", icon: DollarSign },
  { key: "products", label: "Products", icon: Wrench },
  { key: "devices", label: "Devices", icon: Wrench },
  { key: "networking", label: "Networking", icon: Wrench },
  { key: "assets", label: "Assets", icon: Wrench },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "knowledge_base", label: "Knowledge Base", icon: FileText },
  { key: "it_docs", label: "IT Docs", icon: Lock },
  { key: "contracts", label: "Contracts", icon: FileText },
  { key: "projects", label: "Projects", icon: Wrench },
  { key: "time_tracking", label: "Time Tracking", icon: Clock },
  { key: "purchase_orders", label: "Purchase Orders", icon: Wrench },
  { key: "scheduling", label: "Scheduling", icon: Clock },
  { key: "settings", label: "Settings", icon: Shield },
];
const ACTIONS = ["view", "create", "edit", "delete"];

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
  const navigate = useNavigate();
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTech, setEditingTech] = useState(null);
  const [viewingTech, setViewingTech] = useState(null);
  const [techDashboard, setTechDashboard] = useState(null);
  const [techHistory, setTechHistory] = useState(null);
  const [techActivity, setTechActivity] = useState(null);
  const [techRemoteSessions, setTechRemoteSessions] = useState(null);
  const [specialtyInput, setSpecialtyInput] = useState("");
  const [mainTab, setMainTab] = useState("overview");
  const [detailTab, setDetailTab] = useState("tickets");
  const [leaderboard, setLeaderboard] = useState(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [permPresets, setPermPresets] = useState({});
  const [permDialog, setPermDialog] = useState(false);
  const [permTarget, setPermTarget] = useState(null);
  const [permData, setPermData] = useState({});
  const [isAdminToggle, setIsAdminToggle] = useState(false);
  const [sigDialog, setSigDialog] = useState(false);
  const [sigTarget, setSigTarget] = useState(null);
  const [sigConfig, setSigConfig] = useState({ full_name: "", job_title: "", email: "", phone: "", company: "Flamingo MSP", website: "https://flamingomsp.com", linkedin: "", certifications: "", template: "professional" });
  const [formData, setFormData] = useState({
    name: "", email: "", password: "nexusops123", role: "technician", job_title: "",
    hourly_rate: "75", phone: "", specialties: [], is_admin: false
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchTechs = async () => {
    setLoading(true);
    try {
      const [res, presetsRes] = await Promise.all([
        axios.get(`${API}/technicians/overview`, { headers }),
        axios.get(`${API}/technicians/permission-presets`, { headers }),
      ]);
      setTechs(res.data);
      setPermPresets(presetsRes.data);
    } catch { toast.error("Failed to fetch technicians"); }
    finally { setLoading(false); }
  };

  const fetchLeaderboard = async () => {
    try {
      const res = await axios.get(`${API}/technicians/leaderboard`, { headers });
      setLeaderboard(res.data);
    } catch { toast.error("Failed to load leaderboard"); }
  };

  useEffect(() => { fetchTechs(); fetchLeaderboard(); }, []);

  const fetchTechDashboard = async (tech) => {
    setViewingTech(tech);
    setDetailTab("tickets");
    try {
      const [dashRes, histRes, actRes, remRes] = await Promise.all([
        axios.get(`${API}/technicians/${tech.id}/dashboard`, { headers }),
        axios.get(`${API}/technicians/${tech.id}/history`, { headers }),
        axios.get(`${API}/technicians/${tech.id}/activity`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/technicians/${tech.id}/remote-sessions`, { headers }).catch(() => ({ data: null })),
      ]);
      setTechDashboard(dashRes.data);
      setTechHistory(histRes.data);
      setTechActivity(actRes.data);
      setTechRemoteSessions(remRes.data);
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
      setIsCreateOpen(false); setEditingTech(null); resetForm(); fetchTechs(); fetchLeaderboard();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
  };

  const handleDeactivate = async (id) => {
    try {
      await axios.delete(`${API}/technicians/${id}`, { headers });
      toast.success("Technician deactivated"); fetchTechs();
    } catch { toast.error("Failed"); }
  };

  const resetForm = () => setFormData({ name: "", email: "", password: "nexusops123", role: "technician", job_title: "", hourly_rate: "75", phone: "", specialties: [], is_admin: false });

  const openEdit = (tech) => {
    setEditingTech(tech);
    setFormData({
      name: tech.name, email: tech.email, password: "", role: tech.role || "technician",
      job_title: tech.job_title || "", hourly_rate: String(tech.hourly_rate || 75),
      phone: tech.phone || "", specialties: tech.specialties || [], is_admin: tech.is_admin || false,
    });
    setIsCreateOpen(true);
  };

  const openPermissions = (tech) => {
    setPermTarget(tech);
    setPermData(tech.permissions || {});
    setIsAdminToggle(tech.is_admin || false);
    setPermDialog(true);
  };

  const applyPreset = (presetName) => {
    if (permPresets[presetName]) {
      setPermData({ ...permPresets[presetName] });
      toast.success(`Applied ${presetName} preset`);
    }
  };

  const handleSavePermissions = async () => {
    try {
      await axios.put(`${API}/technicians/${permTarget.id}/permissions`, {
        permissions: permData, is_admin: isAdminToggle, job_title: permTarget.job_title
      }, { headers });
      toast.success("Permissions updated");
      setPermDialog(false); fetchTechs();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed — only admins can modify permissions"); }
  };

  const togglePerm = (module, action) => {
    setPermData(prev => ({
      ...prev,
      [module]: { ...prev[module], [action]: !prev[module]?.[action] }
    }));
  };

  const openSignature = (tech) => {
    setSigTarget(tech);
    setSigConfig({
      full_name: tech.name || "", job_title: tech.job_title || "",
      email: tech.email || "", phone: tech.phone || "",
      company: "Flamingo MSP", website: "https://flamingomsp.com",
      linkedin: "", certifications: tech.specialties?.join(", ") || "",
      template: "professional",
    });
    setSigDialog(true);
  };

  const handleSaveSignature = async () => {
    const html = generateSignatureHtml(sigConfig);
    try {
      await axios.put(`${API}/technicians/${sigTarget.id}/email-signature`, {
        email_signature: sigConfig.full_name, email_signature_html: html, signature_config: sigConfig,
      }, { headers });
      toast.success("Email signature saved");
      setSigDialog(false);
    } catch { toast.error("Failed to save signature"); }
  };

  const generateSignatureHtml = (c) => {
    if (c.template === "minimal") {
      return `<div style="font-family:Arial,sans-serif;font-size:13px;color:#333"><strong>${c.full_name}</strong>${c.job_title ? ` | ${c.job_title}` : ""}<br>${c.company}${c.phone ? ` | ${c.phone}` : ""}${c.email ? ` | ${c.email}` : ""}${c.website ? `<br><a href="${c.website}" style="color:#0066cc">${c.website}</a>` : ""}</div>`;
    }
    if (c.template === "technical") {
      return `<table cellpadding="0" cellspacing="0" style="font-family:Consolas,monospace;font-size:12px;color:#e0e0e0;background:#1a1a2e;padding:16px;border-radius:8px;border-left:4px solid #00d4aa"><tr><td><div style="color:#00d4aa;font-size:15px;font-weight:bold">${c.full_name}</div><div style="color:#7b8794;margin:4px 0">${c.job_title || "Engineer"} @ ${c.company}</div><div style="margin-top:8px;color:#a0a0a0">${c.email ? `<span>${c.email}</span>` : ""}${c.phone ? ` | ${c.phone}` : ""}</div>${c.certifications ? `<div style="margin-top:6px;color:#00d4aa;font-size:11px">${c.certifications}</div>` : ""}${c.website ? `<div style="margin-top:6px"><a href="${c.website}" style="color:#4da6ff">${c.website}</a></div>` : ""}</td></tr></table>`;
    }
    if (c.template === "modern") {
      return `<table cellpadding="0" cellspacing="0" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;border-collapse:collapse"><tr><td style="padding-right:16px;border-right:3px solid #10b981"><div style="font-size:16px;font-weight:700;color:#111">${c.full_name}</div><div style="color:#10b981;font-size:12px;font-weight:600;margin:2px 0">${c.job_title}</div><div style="color:#666;font-size:12px">${c.company}</div></td><td style="padding-left:16px;font-size:12px;color:#555">${c.email ? `<div>${c.email}</div>` : ""}${c.phone ? `<div>${c.phone}</div>` : ""}${c.website ? `<div><a href="${c.website}" style="color:#10b981;text-decoration:none">${c.website}</a></div>` : ""}${c.linkedin ? `<div><a href="${c.linkedin}" style="color:#0077b5;text-decoration:none">LinkedIn</a></div>` : ""}</td></tr></table>`;
    }
    // Professional (default)
    return `<table cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#333;border-collapse:collapse"><tr><td style="vertical-align:top;padding-right:16px;border-right:2px solid #1a56db"><div style="font-size:15px;font-weight:bold;color:#1a1a2e">${c.full_name}</div><div style="color:#1a56db;font-size:12px;margin:2px 0">${c.job_title}</div><div style="color:#555;font-size:12px;font-weight:600">${c.company}</div></td><td style="vertical-align:top;padding-left:16px;font-size:12px;color:#555;line-height:1.6">${c.phone ? `<div>P: ${c.phone}</div>` : ""}${c.email ? `<div>E: <a href="mailto:${c.email}" style="color:#1a56db;text-decoration:none">${c.email}</a></div>` : ""}${c.website ? `<div>W: <a href="${c.website}" style="color:#1a56db;text-decoration:none">${c.website}</a></div>` : ""}${c.linkedin ? `<div><a href="${c.linkedin}" style="color:#0077b5;text-decoration:none">LinkedIn Profile</a></div>` : ""}</td></tr>${c.certifications ? `<tr><td colspan="2" style="padding-top:8px;border-top:1px solid #e5e7eb;margin-top:8px;font-size:11px;color:#888">${c.certifications}</td></tr>` : ""}</table>`;
  };

  const addSpecialty = () => { if (specialtyInput.trim()) { setFormData(p => ({ ...p, specialties: [...p.specialties, specialtyInput.trim()] })); setSpecialtyInput(""); } };

  const filtered = techs.filter(t => !searchQuery || t.name?.toLowerCase().includes(searchQuery.toLowerCase()) || t.email?.toLowerCase().includes(searchQuery.toLowerCase()) || (t.job_title || "").toLowerCase().includes(searchQuery.toLowerCase()));

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ========== TECH DETAIL VIEW ==========
  if (viewingTech && techDashboard) {
    const { technician, stats, open_tickets, overdue_tickets, no_notes_tickets } = techDashboard;
    return (
      <div className="space-y-4" data-testid="tech-detail-view">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setViewingTech(null); setTechDashboard(null); setTechHistory(null); setTechActivity(null); setTechRemoteSessions(null); }} data-testid="back-to-techs"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">{technician.name?.charAt(0)?.toUpperCase()}</div>
          <div>
            <h1 className="text-2xl font-bold">{technician.name}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {technician.job_title && <Badge variant="secondary" className="text-xs">{technician.job_title}</Badge>}
              <Mail className="w-3 h-3" />{technician.email}
              {technician.phone && <><Phone className="w-3 h-3 ml-2" />{technician.phone}</>}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {technician.is_admin && <Badge className="bg-amber-600"><Crown className="w-3 h-3 mr-1" />Admin</Badge>}
            <Badge variant="outline" className="capitalize">{technician.role}</Badge>
            <Badge className={technician.is_active !== false ? "bg-green-600" : "bg-gray-500"}>{technician.is_active !== false ? "Active" : "Inactive"}</Badge>
            <Button variant="outline" size="sm" onClick={() => openEdit(technician)}><Edit className="w-4 h-4 mr-1" />Edit</Button>
            <Button variant="outline" size="sm" onClick={() => openPermissions(technician)} data-testid="manage-permissions-btn"><Shield className="w-4 h-4 mr-1" />Permissions</Button>
            <Button variant="outline" size="sm" onClick={() => openSignature(technician)} data-testid="email-signature-btn"><Mail className="w-4 h-4 mr-1" />Signature</Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Assigned</p><p className="text-2xl font-bold">{stats.total_assigned}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Open</p><p className="text-2xl font-bold text-blue-500">{stats.open_tickets}</p></CardContent></Card>
          <Card className={stats.no_notes_tickets > 0 ? "border-red-500/50 bg-red-500/5" : ""}><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">No Notes</p><p className={`text-2xl font-bold ${stats.no_notes_tickets > 0 ? 'text-red-500' : 'text-green-500'}`}>{stats.no_notes_tickets}</p></CardContent></Card>
          <Card className={stats.overdue_tickets > 0 ? "border-orange-500/50 bg-orange-500/5" : ""}><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Overdue</p><p className={`text-2xl font-bold ${stats.overdue_tickets > 0 ? 'text-orange-500' : 'text-green-500'}`}>{stats.overdue_tickets}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Resolved</p><p className="text-2xl font-bold text-green-500">{stats.resolved_tickets}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Hours</p><p className="text-2xl font-bold">{stats.total_hours}h</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Billable</p><p className="text-2xl font-bold text-green-500">{stats.billable_hours}h</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">This Week</p><p className="text-2xl font-bold text-cyan-500">{stats.hours_this_week}h</p></CardContent></Card>
        </div>

        {/* Detail Tabs */}
        <Tabs value={detailTab} onValueChange={setDetailTab}>
          <TabsList>
            <TabsTrigger value="tickets"><Ticket className="w-3 h-3 mr-1" />Tickets</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-tech-history"><History className="w-3 h-3 mr-1" />History</TabsTrigger>
            <TabsTrigger value="remote-sessions" data-testid="tab-tech-remote"><ExternalLink className="w-3 h-3 mr-1" />Remote Sessions</TabsTrigger>
            <TabsTrigger value="activity" data-testid="tab-tech-activity"><Eye className="w-3 h-3 mr-1" />Activity Log</TabsTrigger>
            <TabsTrigger value="permissions" data-testid="tab-tech-permissions"><Shield className="w-3 h-3 mr-1" />Permissions</TabsTrigger>
          </TabsList>

          <TabsContent value="tickets">
            <Tabs defaultValue={stats.no_notes_tickets > 0 ? "no-notes" : "open"}>
              <TabsList className="grid grid-cols-3 w-full max-w-lg">
                <TabsTrigger value="open">Open ({stats.open_tickets})</TabsTrigger>
                <TabsTrigger value="no-notes" className={stats.no_notes_tickets > 0 ? "text-red-500" : ""}>No Notes ({stats.no_notes_tickets})</TabsTrigger>
                <TabsTrigger value="overdue">Overdue ({stats.overdue_tickets})</TabsTrigger>
              </TabsList>
              <TabsContent value="open"><TicketTable tickets={open_tickets} noNotesIds={no_notes_tickets.map(t => t.id)} onTicketClick={t => navigate(`/tickets?highlight=${t.id}`)} /></TabsContent>
              <TabsContent value="no-notes">
                {no_notes_tickets.length > 0 ? (
                  <><div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2"><AlertCircle className="w-5 h-5 text-red-500" /><p className="text-sm text-red-400">These tickets have <strong>zero notes</strong>.</p></div><TicketTable tickets={no_notes_tickets} noNotesIds={no_notes_tickets.map(t => t.id)} onTicketClick={t => navigate(`/tickets?highlight=${t.id}`)} /></>
                ) : <div className="text-center py-12"><CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" /><p className="text-green-500 font-medium">All open tickets have notes</p></div>}
              </TabsContent>
              <TabsContent value="overdue">
                {overdue_tickets.length > 0 ? <TicketTable tickets={overdue_tickets} noNotesIds={no_notes_tickets.map(t => t.id)} onTicketClick={t => navigate(`/tickets?highlight=${t.id}`)} /> : <div className="text-center py-12"><CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" /><p className="text-green-500 font-medium">No overdue tickets</p></div>}
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="history">
            {techHistory ? (
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-3 gap-4">
                  <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Tickets</p><p className="text-3xl font-bold">{techHistory.total_tickets}</p></CardContent></Card>
                  <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Resolved</p><p className="text-3xl font-bold text-green-500">{techHistory.total_resolved}</p></CardContent></Card>
                  <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Resolution Rate</p><p className="text-3xl font-bold text-cyan-500">{techHistory.total_tickets ? Math.round(techHistory.total_resolved / techHistory.total_tickets * 100) : 0}%</p></CardContent></Card>
                </div>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Ticket Activity (6 Months)</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-4 h-40">
                      {techHistory.monthly.map((m, i) => {
                        const maxVal = Math.max(...techHistory.monthly.map(x => Math.max(x.opened, x.closed)), 1);
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div className="flex items-end gap-1 h-28 w-full">
                              <div className="flex-1 bg-blue-500/30 rounded-t" style={{ height: `${(m.opened / maxVal) * 100}%`, minHeight: m.opened > 0 ? "4px" : "0" }} title={`Opened: ${m.opened}`} />
                              <div className="flex-1 bg-emerald-500/50 rounded-t" style={{ height: `${(m.closed / maxVal) * 100}%`, minHeight: m.closed > 0 ? "4px" : "0" }} title={`Closed: ${m.closed}`} />
                            </div>
                            <p className="text-[10px] text-muted-foreground">{m.label}</p>
                            <div className="flex gap-2 text-[10px]">
                              <span className="text-blue-400">{m.opened}</span>
                              <span className="text-emerald-400">{m.closed}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-4 mt-3 justify-center text-xs">
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-blue-500/30" />Opened</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-emerald-500/50" />Closed</div>
                    </div>
                  </CardContent>
                </Card>
                {techHistory.recent_resolved.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Recently Resolved ({techHistory.recent_resolved.length})</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Title</TableHead><TableHead>Client</TableHead><TableHead>Priority</TableHead><TableHead>Resolved</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {techHistory.recent_resolved.slice(0, 10).map(t => (
                            <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/tickets?highlight=${t.id}`)}>
                              <TableCell className="font-mono text-xs">{t.ticket_number}</TableCell>
                              <TableCell className="max-w-[200px] truncate">{t.title}</TableCell>
                              <TableCell className="text-sm">{t.client_name}</TableCell>
                              <TableCell><Badge className={priorityConfig[t.priority]?.class + " text-xs"}>{priorityConfig[t.priority]?.label}</Badge></TableCell>
                              <TableCell className="text-xs text-muted-foreground">{t.resolved_at ? formatDistanceToNow(new Date(t.resolved_at), { addSuffix: true }) : "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : <div className="text-center py-12 text-muted-foreground">Loading history...</div>}
          </TabsContent>

          <TabsContent value="permissions">
            <div className="mt-4">
              <PermissionsGrid permissions={technician.permissions || {}} readOnly />
            </div>
          </TabsContent>

          <TabsContent value="remote-sessions">
            <RemoteSessionsTab sessions={techRemoteSessions} techName={technician.name} />
          </TabsContent>

          <TabsContent value="activity">
            <ActivityLogTab activity={techActivity} techName={technician.name} navigate={navigate} />
          </TabsContent>
        </Tabs>

        {(technician.specialties || []).length > 0 && (
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Specialties</CardTitle></CardHeader>
            <CardContent className="flex gap-2 flex-wrap">
              {technician.specialties.map((s, i) => <Badge key={i} variant="secondary"><Wrench className="w-3 h-3 mr-1" />{s}</Badge>)}
            </CardContent>
          </Card>
        )}

        {permDialog && <PermissionsDialog permTarget={permTarget} permData={permData} isAdminToggle={isAdminToggle} setIsAdminToggle={setIsAdminToggle} permPresets={permPresets} applyPreset={applyPreset} togglePerm={togglePerm} handleSavePermissions={handleSavePermissions} setPermDialog={setPermDialog} />}
        {sigDialog && <SignatureDialog sigConfig={sigConfig} setSigConfig={setSigConfig} handleSaveSignature={handleSaveSignature} setSigDialog={setSigDialog} generateSignatureHtml={generateSignatureHtml} />}
      </div>
    );
  }

  // ========== LEADERBOARD VIEW ==========
  if (showLeaderboard && leaderboard) {
    return (
      <div className="space-y-6" data-testid="leaderboard-view">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setShowLeaderboard(false)} data-testid="back-from-leaderboard"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
            <Trophy className="w-6 h-6 text-yellow-500" />
            <div>
              <h1 className="text-2xl font-bold">Leaderboard</h1>
              <p className="text-sm text-muted-foreground">{leaderboard.month}</p>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          {leaderboard.leaderboard.map((entry, i) => (
            <Card key={entry.id} className={`${i === 0 ? "border-yellow-500/40 bg-yellow-500/5" : i === 1 ? "border-zinc-400/30" : i === 2 ? "border-amber-700/30" : ""} cursor-pointer hover:border-primary/50 transition-colors`} onClick={() => { setShowLeaderboard(false); fetchTechDashboard(entry); }} data-testid={`leaderboard-entry-${entry.id}`}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${i === 0 ? "bg-yellow-500/20 text-yellow-500" : i === 1 ? "bg-zinc-400/20 text-zinc-400" : i === 2 ? "bg-amber-700/20 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                      {i === 0 ? <Crown className="w-5 h-5" /> : i === 1 ? <Award className="w-5 h-5" /> : i === 2 ? <Star className="w-5 h-5" /> : `#${entry.rank}`}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{entry.name}</p>
                        {entry.job_title && <Badge variant="secondary" className="text-[10px]">{entry.job_title}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{entry.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-8 text-sm">
                    <div className="text-center"><p className="text-xs text-muted-foreground">Closed (Month)</p><p className="text-2xl font-bold text-green-500">{entry.closed_this_month}</p></div>
                    <div className="text-center"><p className="text-xs text-muted-foreground">Total Closed</p><p className="text-lg font-bold">{entry.closed_total}</p></div>
                    <div className="text-center"><p className="text-xs text-muted-foreground">Avg Resolution</p><p className="text-lg font-bold">{entry.avg_resolution_hours}h</p></div>
                    <div className="text-center"><p className="text-xs text-muted-foreground">Hours (Month)</p><p className="text-lg font-bold text-cyan-500">{entry.month_hours}h</p></div>
                    <div className="text-center"><p className="text-xs text-muted-foreground">CSAT</p><p className="text-lg font-bold text-purple-500">{entry.csat_score}%</p></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ========== LIST VIEW ==========
  return (
    <div className="space-y-4" data-testid="technicians-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Technicians</h1><p className="text-muted-foreground">{techs.length} team members</p></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowLeaderboard(true)} data-testid="leaderboard-btn"><Trophy className="w-4 h-4 mr-1 text-yellow-500" />Leaderboard</Button>
          <Button onClick={() => { setEditingTech(null); resetForm(); setIsCreateOpen(true); }} data-testid="add-tech-btn"><Plus className="w-4 h-4 mr-1" />Add Technician</Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by name, email, or title..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} data-testid="tech-search" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(tech => (
          <Card key={tech.id} className={`cursor-pointer hover:border-primary/50 transition-colors ${tech.no_notes_count > 0 ? 'border-red-500/30' : ''}`} onClick={() => fetchTechDashboard(tech)} data-testid={`tech-card-${tech.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-lg">{tech.name?.charAt(0)?.toUpperCase()}</div>
                  <div>
                    <p className="font-semibold">{tech.name}</p>
                    <p className="text-xs text-muted-foreground">{tech.email}</p>
                    <div className="flex gap-1 mt-1">
                      {tech.job_title && <Badge variant="secondary" className="text-[10px]">{tech.job_title}</Badge>}
                      <Badge variant="outline" className="text-[10px] capitalize">{tech.role}</Badge>
                      {tech.is_admin && <Badge className="bg-amber-600 text-[10px]"><Crown className="w-2 h-2 mr-0.5" />Admin</Badge>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openPermissions(tech)} title="Permissions"><Shield className="w-3 h-3" /></Button>
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
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" /><p className="text-xs text-red-400">{tech.no_notes_count} ticket{tech.no_notes_count > 1 ? 's' : ''} with no notes</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CREATE/EDIT DIALOG */}
      <Dialog open={isCreateOpen} onOpenChange={v => { setIsCreateOpen(v); if (!v) setEditingTech(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingTech ? "Edit Technician" : "Add Technician"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Full Name</Label><Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} data-testid="tech-name" /></div>
              <div><Label>Email</Label><Input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} data-testid="tech-email" /></div>
            </div>
            {!editingTech && <div><Label>Password</Label><Input type="password" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} /></div>}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Job Title</Label>
                <Select value={formData.job_title} onValueChange={v => setFormData({ ...formData, job_title: v })}>
                  <SelectTrigger data-testid="tech-job-title"><SelectValue placeholder="Select title" /></SelectTrigger>
                  <SelectContent>{JOB_TITLES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
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
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Hourly Rate ($)</Label><Input type="number" value={formData.hourly_rate} onChange={e => setFormData({ ...formData, hourly_rate: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} /></div>
            </div>
            <div>
              <Label>Specialties</Label>
              <div className="flex gap-2 flex-wrap mb-2">{formData.specialties.map((s, i) => (<Badge key={i} variant="secondary" className="cursor-pointer" onClick={() => setFormData(p => ({ ...p, specialties: p.specialties.filter((_, j) => j !== i) }))}>{s} <XCircle className="w-3 h-3 ml-1" /></Badge>))}</div>
              <div className="flex gap-2"><Input className="flex-1" placeholder="e.g. Networking, Azure" value={specialtyInput} onChange={e => setSpecialtyInput(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addSpecialty())} /><Button type="button" variant="outline" size="sm" onClick={addSpecialty}>Add</Button></div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreate} data-testid="save-tech-btn">{editingTech ? "Update" : "Add"} Technician</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {permDialog && <PermissionsDialog permTarget={permTarget} permData={permData} isAdminToggle={isAdminToggle} setIsAdminToggle={setIsAdminToggle} permPresets={permPresets} applyPreset={applyPreset} togglePerm={togglePerm} handleSavePermissions={handleSavePermissions} setPermDialog={setPermDialog} />}
      {sigDialog && <SignatureDialog sigConfig={sigConfig} setSigConfig={setSigConfig} handleSaveSignature={handleSaveSignature} setSigDialog={setSigDialog} generateSignatureHtml={generateSignatureHtml} />}
    </div>
  );
}

// ========== PERMISSIONS GRID (read-only in detail) ==========
function PermissionsGrid({ permissions, readOnly = false }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" />Module Permissions</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Module</TableHead>
              {ACTIONS.map(a => <TableHead key={a} className="text-center capitalize text-xs">{a}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {MODULES.map(mod => (
              <TableRow key={mod.key}>
                <TableCell className="font-medium text-sm">{mod.label}</TableCell>
                {ACTIONS.map(action => (
                  <TableCell key={action} className="text-center">
                    {permissions[mod.key]?.[action] ? <CheckCircle className="w-4 h-4 text-green-500 mx-auto" /> : <XCircle className="w-4 h-4 text-zinc-600 mx-auto" />}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ========== PERMISSIONS DIALOG ==========
function PermissionsDialog({ permTarget, permData, isAdminToggle, setIsAdminToggle, permPresets, applyPreset, togglePerm, handleSavePermissions, setPermDialog }) {
  return (
    <Dialog open onOpenChange={v => { if (!v) setPermDialog(false); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Manage Permissions - {permTarget?.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <div className="flex items-center gap-3">
              <Crown className="w-5 h-5 text-amber-500" />
              <div><p className="font-medium text-sm">Admin Rights</p><p className="text-xs text-muted-foreground">Full access to all modules and settings</p></div>
            </div>
            <Switch checked={isAdminToggle} onCheckedChange={setIsAdminToggle} data-testid="admin-toggle" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">Apply preset:</span>
            {Object.keys(permPresets).map(p => (
              <Button key={p} variant="outline" size="sm" className="text-xs h-7" onClick={() => applyPreset(p)} data-testid={`preset-${p.replace(/\s/g, "-").toLowerCase()}`}>{p}</Button>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Module</TableHead>{ACTIONS.map(a => <TableHead key={a} className="text-center capitalize text-xs">{a}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {MODULES.map(mod => (
                <TableRow key={mod.key}>
                  <TableCell className="font-medium text-sm">{mod.label}</TableCell>
                  {ACTIONS.map(action => (
                    <TableCell key={action} className="text-center">
                      <Switch checked={isAdminToggle || permData[mod.key]?.[action] || false} onCheckedChange={() => togglePerm(mod.key, action)} disabled={isAdminToggle} className="mx-auto" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter><Button onClick={handleSavePermissions} data-testid="save-permissions-btn">Save Permissions</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ========== EMAIL SIGNATURE DIALOG ==========
function SignatureDialog({ sigConfig, setSigConfig, handleSaveSignature, setSigDialog, generateSignatureHtml }) {
  const c = sigConfig;
  return (
    <Dialog open onOpenChange={v => { if (!v) setSigDialog(false); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Email Signature Builder</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-3">
            <div><Label>Template Style</Label>
              <Select value={c.template} onValueChange={v => setSigConfig({ ...c, template: v })}>
                <SelectTrigger data-testid="sig-template"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="modern">Modern</SelectItem>
                  <SelectItem value="minimal">Minimal</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Full Name</Label><Input value={c.full_name} onChange={e => setSigConfig({ ...c, full_name: e.target.value })} data-testid="sig-name" /></div>
            <div><Label>Job Title</Label><Input value={c.job_title} onChange={e => setSigConfig({ ...c, job_title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Email</Label><Input value={c.email} onChange={e => setSigConfig({ ...c, email: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={c.phone} onChange={e => setSigConfig({ ...c, phone: e.target.value })} /></div>
            </div>
            <div><Label>Company</Label><Input value={c.company} onChange={e => setSigConfig({ ...c, company: e.target.value })} /></div>
            <div><Label>Website</Label><Input value={c.website} onChange={e => setSigConfig({ ...c, website: e.target.value })} /></div>
            <div><Label>LinkedIn URL</Label><Input value={c.linkedin} onChange={e => setSigConfig({ ...c, linkedin: e.target.value })} placeholder="https://linkedin.com/in/..." /></div>
            <div><Label>Certifications / Skills</Label><Input value={c.certifications} onChange={e => setSigConfig({ ...c, certifications: e.target.value })} placeholder="MCSE, AWS Solutions Architect..." /></div>
          </div>
          <div>
            <Label className="mb-2 block">Preview</Label>
            <div className="p-4 rounded-lg border bg-white min-h-[200px]">
              <div dangerouslySetInnerHTML={{ __html: generateSignatureHtml(c) }} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">This signature will be used in outgoing emails from the ticket system.</p>
          </div>
        </div>
        <DialogFooter><Button onClick={handleSaveSignature} data-testid="save-signature-btn"><Mail className="w-4 h-4 mr-1" />Save Signature</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ========== TICKET TABLE ==========
function TicketTable({ tickets, noNotesIds = [], onTicketClick }) {
  if (!tickets.length) return <p className="text-center py-8 text-muted-foreground">No tickets</p>;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Title</TableHead><TableHead>Client</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Notes</TableHead><TableHead>Created</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {tickets.map(t => (
              <TableRow key={t.id} className={`cursor-pointer hover:bg-muted/70 transition-colors ${noNotesIds.includes(t.id) ? "bg-red-500/5" : ""}`} onClick={() => onTicketClick?.(t)} data-testid={`ticket-row-${t.id}`}>
                <TableCell className="font-mono text-sm">{t.ticket_number}</TableCell>
                <TableCell className="max-w-[200px] truncate">{t.title}</TableCell>
                <TableCell className="text-sm">{t.client_name}</TableCell>
                <TableCell><Badge className={priorityConfig[t.priority]?.class + " text-xs"}>{priorityConfig[t.priority]?.label}</Badge></TableCell>
                <TableCell><Badge variant="outline" className={statusConfig[t.status]?.class}>{statusConfig[t.status]?.label}</Badge></TableCell>
                <TableCell>{noNotesIds.includes(t.id) ? <Badge variant="destructive" className="text-[10px]"><AlertCircle className="w-3 h-3 mr-1" />None</Badge> : <CheckCircle className="w-4 h-4 text-green-500" />}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.created_at && formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</TableCell>
                <TableCell><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><ExternalLink className="w-3.5 h-3.5 text-muted-foreground" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ========== REMOTE SESSIONS TAB ==========
function RemoteSessionsTab({ sessions, techName }) {
  if (!sessions) return <div className="text-center py-12 text-muted-foreground">Loading remote sessions...</div>;
  const { sessions: sessionList = [], active_count = 0, total_sessions = 0, total_minutes = 0, unique_devices = 0 } = sessions;
  const lockIcons = { locked: <Lock className="w-3.5 h-3.5 text-amber-500" />, unlocked: <Unlock className="w-3.5 h-3.5 text-green-500" />, no_change: <Monitor className="w-3.5 h-3.5 text-zinc-500" /> };
  return (
    <div className="space-y-4 mt-4" data-testid="remote-sessions-tab">
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Active Now</p><p className={`text-3xl font-bold ${active_count > 0 ? "text-green-500" : ""}`}>{active_count}</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Sessions</p><p className="text-3xl font-bold">{total_sessions}</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Time</p><p className="text-3xl font-bold text-cyan-500">{Math.round(total_minutes / 60)}h {total_minutes % 60}m</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Unique Devices</p><p className="text-3xl font-bold text-purple-500">{unique_devices}</p></CardContent></Card>
      </div>
      {sessionList.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No remote sessions recorded for {techName}</div>
      ) : (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Session History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead><TableHead>Type</TableHead><TableHead>Device Type</TableHead>
                  <TableHead>Status</TableHead><TableHead>Duration</TableHead>
                  <TableHead>Lock Status</TableHead><TableHead>Started</TableHead><TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionList.map(s => (
                  <TableRow key={s.id} data-testid={`session-row-${s.id}`}>
                    <TableCell className="font-medium">{s.device_name || s.device_id}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs capitalize">{(s.session_type || "remote").replace("_", " ")}</Badge></TableCell>
                    <TableCell><Badge variant="secondary" className="text-xs capitalize">{s.device_type || "unknown"}</Badge></TableCell>
                    <TableCell>
                      {s.status === "active" ? (
                        <Badge className="bg-green-600 text-white text-xs"><Wifi className="w-3 h-3 mr-1" />Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-zinc-400"><WifiOff className="w-3 h-3 mr-1" />Ended</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.status === "active" ? (
                        <span className="text-green-500">{s.live_duration_minutes || "0"}m (live)</span>
                      ) : (
                        `${s.duration_minutes || 0}m`
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {lockIcons[s.lock_action_on_disconnect] || lockIcons.no_change}
                        <span className="text-xs capitalize">{s.lock_action_on_disconnect || "n/a"}</span>
                      </div>
                      {s.was_locked_before_disconnect != null && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">Before: {s.was_locked_before_disconnect ? "Locked" : "Unlocked"}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.started_at ? formatDistanceToNow(new Date(s.started_at), { addSuffix: true }) : "-"}</TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate">{s.notes || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ========== ACTIVITY LOG TAB ==========
function ActivityLogTab({ activity, techName, navigate }) {
  if (!activity) return <div className="text-center py-12 text-muted-foreground">Loading activity...</div>;
  const { activity_logs = [], remote_sessions = [] } = activity;
  const allEvents = [
    ...activity_logs.map(l => ({ ...l, _type: "activity", _time: l.created_at })),
    ...remote_sessions.map(s => ({ ...s, _type: "session", _time: s.started_at, action: s.status === "active" ? "remote_connect" : "remote_disconnect", entity_type: "device", entity_name: s.device_name })),
  ].sort((a, b) => (b._time || "").localeCompare(a._time || "")).slice(0, 200);

  const actionColors = {
    created: "bg-green-500/20 text-green-400 border-green-500/30",
    updated: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    deleted: "bg-red-500/20 text-red-400 border-red-500/30",
    remote_connect: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    remote_disconnect: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    payment_recorded: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    voided: "bg-red-500/20 text-red-400 border-red-500/30",
    moved_client: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  };
  const entityIcons = { ticket: <Ticket className="w-4 h-4" />, invoice: <DollarSign className="w-4 h-4" />, device: <Monitor className="w-4 h-4" />, client: <User className="w-4 h-4" /> };

  return (
    <div className="space-y-4 mt-4" data-testid="activity-log-tab">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Eye className="w-4 h-4" />
        <span>Full activity history for <strong className="text-foreground">{techName}</strong> ({allEvents.length} events)</span>
      </div>
      {allEvents.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No activity recorded</div>
      ) : (
        <div className="space-y-2">
          {allEvents.map((evt, i) => (
            <div key={evt.id || i} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors" data-testid={`activity-entry-${i}`}>
              <div className="mt-0.5">{entityIcons[evt.entity_type] || <FileText className="w-4 h-4" />}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={`text-[10px] ${actionColors[evt.action] || "text-zinc-400"}`}>{(evt.action || "").replace("_", " ")}</Badge>
                  <Badge variant="secondary" className="text-[10px] capitalize">{evt.entity_type}</Badge>
                  {evt.entity_name && <span className="text-sm font-medium truncate max-w-[200px]">{evt.entity_name}</span>}
                </div>
                {evt.details && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{evt.details}</p>}
                {evt._type === "session" && evt.duration_minutes > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">Duration: {evt.duration_minutes}m | Device type: {evt.device_type || "unknown"}{evt.lock_action_on_disconnect && ` | Lock: ${evt.lock_action_on_disconnect}`}</p>
                )}
                {evt.changes && Object.keys(evt.changes).length > 0 && (
                  <div className="mt-1.5 text-[11px] text-muted-foreground space-y-0.5">
                    {Object.entries(evt.changes).slice(0, 5).map(([k, v]) => (
                      <div key={k}><span className="text-zinc-500">{k}:</span> <span className="text-red-400 line-through">{v.old}</span> <span className="text-green-400">{v.new}</span></div>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{evt._time ? formatDistanceToNow(new Date(evt._time), { addSuffix: true }) : "-"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

