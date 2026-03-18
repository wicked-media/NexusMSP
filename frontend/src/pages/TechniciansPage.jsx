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
  Crown, Star, Lock, Unlock, ChevronRight, Eye, FileText, Monitor, Wifi, WifiOff,
  Upload, Camera, Gift, Cake, Gem, Rocket, Target, Zap, CreditCard, Calendar,
  Layers, MessageSquare, Image, PhoneCall, ArrowRightLeft, RefreshCw, BellRing
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
  const [techAchievements, setTechAchievements] = useState([]);
  const [allAchievements, setAllAchievements] = useState([]);
  const [techStatusCard, setTechStatusCard] = useState(null);
  const [hoveredTech, setHoveredTech] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [profileDialog, setProfileDialog] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null);
  const [profileData, setProfileData] = useState({ about_me: "", hire_date: "", birthday: "" });
  const [awardDialog, setAwardDialog] = useState(false);
  const [awardTarget, setAwardTarget] = useState(null);
  const [teamsStatusDialog, setTeamsStatusDialog] = useState(false);
  const [teamsData, setTeamsData] = useState({ availability: "Available", status_message: "" });
  const [onCallRoster, setOnCallRoster] = useState([]);
  const [activeOnCall, setActiveOnCall] = useState([]);
  const [onCallDialog, setOnCallDialog] = useState(false);
  const [onCallForm, setOnCallForm] = useState({ tech_id: "", tech_name: "", shift_type: "primary", category: "general", start_time: "", end_time: "", notes: "" });
  const [swapDialog, setSwapDialog] = useState(false);
  const [swapShift, setSwapShift] = useState(null);
  const [swapTechId, setSwapTechId] = useState("");
  const [formData, setFormData] = useState({
    name: "", email: "", password: "nexusops123", role: "technician", job_title: "",
    hourly_rate: "75", phone: "", specialties: [], is_admin: false
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchTechs = async () => {
    setLoading(true);
    try {
      const [res, presetsRes, rosterRes, activeRes] = await Promise.all([
        axios.get(`${API}/technicians/overview`, { headers }),
        axios.get(`${API}/technicians/permission-presets`, { headers }),
        axios.get(`${API}/on-call/roster`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/on-call/active`, { headers }).catch(() => ({ data: [] })),
      ]);
      setTechs(res.data);
      setPermPresets(presetsRes.data);
      setOnCallRoster(rosterRes.data || []);
      setActiveOnCall(activeRes.data || []);
    } catch { toast.error("Failed to fetch technicians"); }
    finally { setLoading(false); }
  };

  const fetchLeaderboard = async () => {
    try {
      const res = await axios.get(`${API}/technicians/leaderboard`, { headers });
      setLeaderboard(res.data);
    } catch { toast.error("Failed to load leaderboard"); }
  };

  useEffect(() => { fetchTechs(); fetchLeaderboard(); fetchAllAchievements(); }, []);

  const fetchAllAchievements = async () => {
    try { const r = await axios.get(`${API}/achievements`, { headers }); setAllAchievements(r.data); } catch {}
  };

  const fetchTechDashboard = async (tech) => {
    setViewingTech(tech);
    setDetailTab("tickets");
    try {
      const [dashRes, histRes, actRes, remRes, achRes] = await Promise.all([
        axios.get(`${API}/technicians/${tech.id}/dashboard`, { headers }),
        axios.get(`${API}/technicians/${tech.id}/history`, { headers }),
        axios.get(`${API}/technicians/${tech.id}/activity`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/technicians/${tech.id}/remote-sessions`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/technicians/${tech.id}/achievements`, { headers }).catch(() => ({ data: [] })),
      ]);
      setTechDashboard(dashRes.data);
      setTechHistory(histRes.data);
      setTechActivity(actRes.data);
      setTechRemoteSessions(remRes.data);
      setTechAchievements(achRes.data);
      // Auto-check achievements
      axios.post(`${API}/technicians/${tech.id}/achievements/check`, {}, { headers }).then(r => {
        if (r.data.newly_awarded?.length > 0) {
          r.data.newly_awarded.forEach(n => toast.success(`Badge Unlocked: ${n}`));
          axios.get(`${API}/technicians/${tech.id}/achievements`, { headers }).then(r2 => setTechAchievements(r2.data));
        }
      }).catch(() => {});
    } catch { toast.error("Failed to load dashboard"); }
  };

  const fetchTechStatus = async (techId) => {
    try { const r = await axios.get(`${API}/technicians/${techId}/status`, { headers }); setTechStatusCard(r.data); } catch { setTechStatusCard(null); }
  };

  const uploadAvatar = async (techId) => {
    if (!avatarFile) return;
    const fd = new FormData();
    fd.append("file", avatarFile);
    try {
      await axios.post(`${API}/technicians/${techId}/avatar`, fd, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
      toast.success("Avatar uploaded");
      setAvatarFile(null);
      fetchTechs();
    } catch { toast.error("Failed to upload avatar"); }
  };

  const updateProfile = async () => {
    if (!profileTarget) return;
    try {
      await axios.put(`${API}/technicians/${profileTarget.id}/profile`, profileData, { headers });
      toast.success("Profile updated");
      setProfileDialog(false);
      fetchTechs();
    } catch { toast.error("Failed to update profile"); }
  };

  const awardBadge = async (achievementDef) => {
    if (!awardTarget) return;
    try {
      const r = await axios.post(`${API}/technicians/${awardTarget.id}/achievements/award`, {
        achievement_id: achievementDef.id, achievement_name: achievementDef.name, note: "Awarded by admin"
      }, { headers });
      if (r.data.already_earned) toast.info("Already earned this badge");
      else toast.success(`Awarded ${achievementDef.name}`);
      const achRes = await axios.get(`${API}/technicians/${awardTarget.id}/achievements`, { headers });
      setTechAchievements(achRes.data);
    } catch { toast.error("Failed to award badge"); }
  };

  const updateTeamsStatus = async () => {
    try {
      const r = await axios.post(`${API}/teams/update-status`, teamsData, { headers });
      if (r.data.configured === false) toast.info(r.data.message);
      else toast.success("Teams status updated");
      setTeamsStatusDialog(false);
    } catch { toast.error("Failed to update status"); }
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

  const handleCreateOnCallShift = async () => {
    if (!onCallForm.tech_id || !onCallForm.start_time || !onCallForm.end_time) { toast.error("Tech, start and end required"); return; }
    try {
      await axios.post(`${API}/on-call/roster`, onCallForm, { headers });
      toast.success("On-call shift created & tech notified");
      setOnCallDialog(false);
      setOnCallForm({ tech_id: "", tech_name: "", shift_type: "primary", category: "general", start_time: "", end_time: "", notes: "" });
      fetchTechs();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to create shift"); }
  };

  const handleDeleteShift = async (id) => {
    try { await axios.delete(`${API}/on-call/roster/${id}`, { headers }); toast.success("Shift deleted"); fetchTechs(); } catch { toast.error("Failed to delete"); }
  };

  const handleSwapShift = async () => {
    if (!swapShift || !swapTechId) return;
    const newTech = techs.find(t => t.id === swapTechId);
    try {
      await axios.post(`${API}/on-call/roster/${swapShift.id}/swap`, { new_tech_id: swapTechId, new_tech_name: newTech?.name || "" }, { headers });
      toast.success("Shift swapped & both techs notified");
      setSwapDialog(false); setSwapShift(null); setSwapTechId(""); fetchTechs();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to swap"); }
  };

  const handlePingOnCall = async () => {
    try { const r = await axios.post(`${API}/on-call/ping-active`, {}, { headers }); toast.success(r.data.message); } catch { toast.error("Failed to ping"); }
  };

  const handleCheckReorder = async () => {
    try { const r = await axios.post(`${API}/inventory/check-reorder`, {}, { headers }); toast.success(r.data.message); } catch { toast.error("Reorder check failed"); }
  };

  const isOnCall = (techId) => activeOnCall.some(s => s.tech_id === techId);

  const filtered = techs.filter(t => !searchQuery || t.name?.toLowerCase().includes(searchQuery.toLowerCase()) || t.email?.toLowerCase().includes(searchQuery.toLowerCase()) || (t.job_title || "").toLowerCase().includes(searchQuery.toLowerCase()));

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ========== TECH DETAIL VIEW ==========
  if (viewingTech && techDashboard) {
    const { technician, stats, open_tickets, overdue_tickets, no_notes_tickets } = techDashboard;
    return (
      <div className="space-y-4" data-testid="tech-detail-view">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setViewingTech(null); setTechDashboard(null); setTechHistory(null); setTechActivity(null); setTechRemoteSessions(null); setTechAchievements([]); }} data-testid="back-to-techs"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
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
            <TabsTrigger value="achievements" data-testid="tab-tech-achievements"><Trophy className="w-3 h-3 mr-1" />Achievements ({techAchievements.length})</TabsTrigger>
            <TabsTrigger value="remote-sessions" data-testid="tab-tech-remote"><ExternalLink className="w-3 h-3 mr-1" />Remote Sessions</TabsTrigger>
            <TabsTrigger value="activity" data-testid="tab-tech-activity"><Eye className="w-3 h-3 mr-1" />Activity Log</TabsTrigger>
            <TabsTrigger value="profile" data-testid="tab-tech-profile"><User className="w-3 h-3 mr-1" />Profile</TabsTrigger>
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

          <TabsContent value="achievements">
            <AchievementsTab
              earned={techAchievements}
              allDefs={allAchievements}
              techName={technician.name}
              techId={technician.id}
              onAward={() => { setAwardTarget(viewingTech); setAwardDialog(true); }}
            />
          </TabsContent>

          <TabsContent value="profile">
            <ProfileTab
              technician={technician}
              onEditProfile={() => {
                setProfileTarget(viewingTech);
                setProfileData({ about_me: technician.about_me || "", hire_date: technician.hire_date || "", birthday: technician.birthday || "" });
                setProfileDialog(true);
              }}
              onUploadAvatar={(file) => { setAvatarFile(file); }}
              avatarFile={avatarFile}
              onConfirmUpload={() => uploadAvatar(technician.id)}
              onTeamsStatus={() => setTeamsStatusDialog(true)}
            />
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
          <Button variant="outline" size="sm" onClick={handleCheckReorder} data-testid="check-reorder-btn"><RefreshCw className="w-4 h-4 mr-1" />Check Reorder</Button>
          <Button variant="outline" onClick={() => setShowLeaderboard(true)} data-testid="leaderboard-btn"><Trophy className="w-4 h-4 mr-1 text-yellow-500" />Leaderboard</Button>
          <Button onClick={() => { setEditingTech(null); resetForm(); setIsCreateOpen(true); }} data-testid="add-tech-btn"><Plus className="w-4 h-4 mr-1" />Add Technician</Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by name, email, or title..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} data-testid="tech-search" />
      </div>

      {/* ON-CALL ROSTER */}
      {activeOnCall.length > 0 && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <PhoneCall className="w-5 h-5 text-emerald-400 animate-pulse" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-400">Currently On Call</p>
                  <div className="flex gap-3 mt-1">
                    {activeOnCall.map(s => (
                      <Badge key={s.id} className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse">
                        <PhoneCall className="w-3 h-3 mr-1" />{s.tech_name} ({s.category})
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePingOnCall} data-testid="ping-on-call-btn"><BellRing className="w-3 h-3 mr-1" />Ping</Button>
                <Button size="sm" onClick={() => setOnCallDialog(true)} data-testid="schedule-on-call-btn"><Plus className="w-3 h-3 mr-1" />Schedule</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {activeOnCall.length === 0 && (
        <Card className="border-dashed border-muted-foreground/20">
          <CardContent className="py-3 px-4 flex items-center justify-between">
            <div className="flex items-center gap-3 text-muted-foreground">
              <PhoneCall className="w-5 h-5" />
              <span className="text-sm">No one currently on call</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => setOnCallDialog(true)} data-testid="schedule-on-call-empty-btn"><Plus className="w-3 h-3 mr-1" />Schedule On-Call</Button>
          </CardContent>
        </Card>
      )}

      {/* On-Call Roster List (collapsed) */}
      {onCallRoster.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2">
            <Calendar className="w-4 h-4" />View Full Roster ({onCallRoster.length} shifts)
            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
          </summary>
          <div className="mt-2 space-y-2">
            {onCallRoster.slice(0, 10).map(shift => {
              const isActive = new Date(shift.start_time) <= new Date() && new Date(shift.end_time) >= new Date();
              return (
                <div key={shift.id} className={`flex items-center justify-between p-3 rounded-lg border ${isActive ? "border-emerald-500/30 bg-emerald-500/5" : "bg-muted/20"}`} data-testid={`roster-shift-${shift.id}`}>
                  <div className="flex items-center gap-3">
                    {isActive && <PhoneCall className="w-4 h-4 text-emerald-400 animate-pulse" />}
                    <div>
                      <p className="text-sm font-medium">{shift.tech_name}</p>
                      <p className="text-xs text-muted-foreground">{shift.start_time?.slice(0, 16)} - {shift.end_time?.slice(0, 16)}</p>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize">{shift.category}</Badge>
                    <Badge variant="outline" className="text-xs capitalize">{shift.shift_type}</Badge>
                    {shift.swapped_from && <Badge className="bg-amber-500/20 text-amber-400 text-xs"><ArrowRightLeft className="w-3 h-3 mr-1" />Swapped</Badge>}
                  </div>
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setSwapShift(shift); setSwapTechId(""); setSwapDialog(true); }}><ArrowRightLeft className="w-3 h-3 mr-1" />Swap</Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteShift(shift.id)}><XCircle className="w-3 h-3" /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(tech => (
          <Card key={tech.id} className={`cursor-pointer hover:border-primary/50 transition-colors relative ${tech.no_notes_count > 0 ? 'border-red-500/30' : ''}`} onClick={() => fetchTechDashboard(tech)} data-testid={`tech-card-${tech.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="relative"
                    onMouseEnter={() => { setHoveredTech(tech.id); fetchTechStatus(tech.id); }}
                    onMouseLeave={() => setHoveredTech(null)}
                  >
                    {tech.avatar ? (
                      <img src={tech.avatar} alt={tech.name} className="w-12 h-12 rounded-full object-cover border-2 border-primary/30" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-lg">{tech.name?.charAt(0)?.toUpperCase()}</div>
                    )}
                    {/* Hover Card */}
                    {hoveredTech === tech.id && techStatusCard && (
                      <div className="absolute left-14 top-0 z-50 w-72 rounded-xl border bg-card shadow-xl p-4 space-y-2 animate-in fade-in-0 zoom-in-95" data-testid={`hover-card-${tech.id}`} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${techStatusCard.status_type === "remote" ? "bg-green-500 animate-pulse" : techStatusCard.status_type === "active" ? "bg-blue-500" : "bg-zinc-400"}`} />
                          <span className="text-sm font-medium">{techStatusCard.status_text}</span>
                        </div>
                        {techStatusCard.active_sessions?.length > 0 && (
                          <div className="text-xs space-y-1">
                            {techStatusCard.active_sessions.map(s => (
                              <div key={s.id} className="flex items-center gap-1.5 text-emerald-400">
                                <Monitor className="w-3 h-3" />
                                <span>{s.device_name} ({s.client_name})</span>
                                <span className="text-muted-foreground">{s.live_duration_minutes}m</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {techStatusCard.assigned_tickets?.length > 0 && (
                          <div className="text-xs space-y-1 border-t pt-2">
                            <p className="text-muted-foreground">Assigned Tickets:</p>
                            {techStatusCard.assigned_tickets.slice(0, 3).map(t => (
                              <div key={t.id} className="flex items-center gap-1.5">
                                <Ticket className="w-3 h-3 text-blue-400" />
                                <span className="truncate">{t.ticket_number}: {t.title}</span>
                              </div>
                            ))}
                            {techStatusCard.assigned_tickets.length > 3 && <p className="text-muted-foreground">+{techStatusCard.assigned_tickets.length - 3} more</p>}
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-xs text-muted-foreground pt-1 border-t">
                          <Trophy className="w-3 h-3 text-amber-500" />{techStatusCard.achievement_count} badges
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold">{tech.name}</p>
                    <p className="text-xs text-muted-foreground">{tech.email}</p>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {tech.job_title && <Badge variant="secondary" className="text-[10px]">{tech.job_title}</Badge>}
                      <Badge variant="outline" className="text-[10px] capitalize">{tech.role}</Badge>
                      {tech.is_admin && <Badge className="bg-amber-600 text-[10px]"><Crown className="w-2 h-2 mr-0.5" />Admin</Badge>}
                      {isOnCall(tech.id) && <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-[10px] animate-pulse ring-1 ring-emerald-500/50" data-testid={`on-call-badge-${tech.id}`}><PhoneCall className="w-2.5 h-2.5 mr-0.5" />ON CALL</Badge>}
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

      {/* Profile Edit Dialog */}
      <Dialog open={profileDialog} onOpenChange={setProfileDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Profile - {profileTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>About Me</Label><Textarea value={profileData.about_me} onChange={e => setProfileData({...profileData, about_me: e.target.value})} placeholder="Tell us about yourself..." rows={4} data-testid="profile-about-me" /></div>
            <div><Label>Hire Date</Label><Input type="date" value={profileData.hire_date} onChange={e => setProfileData({...profileData, hire_date: e.target.value})} data-testid="profile-hire-date" /></div>
            <div><Label>Birthday</Label><Input type="date" value={profileData.birthday} onChange={e => setProfileData({...profileData, birthday: e.target.value})} data-testid="profile-birthday" /></div>
          </div>
          <DialogFooter><Button onClick={updateProfile} data-testid="save-profile-btn">Save Profile</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Award Badge Dialog */}
      <Dialog open={awardDialog} onOpenChange={setAwardDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Award Badge - {awardTarget?.name}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {allAchievements.map(a => (
              <Button key={a.id} variant="outline" className="h-auto py-3 flex flex-col items-center gap-1 hover:border-primary" onClick={() => awardBadge(a)} data-testid={`award-${a.id}`}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: a.color + "30", color: a.color }}>
                  <AchievementIcon icon={a.icon} />
                </div>
                <span className="text-xs font-medium">{a.name}</span>
                <span className="text-[10px] text-muted-foreground text-center">{a.description}</span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Teams Status Dialog */}
      <Dialog open={teamsStatusDialog} onOpenChange={setTeamsStatusDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Update Teams Status</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Availability</Label>
              <Select value={teamsData.availability} onValueChange={v => setTeamsData({...teamsData, availability: v})}>
                <SelectTrigger data-testid="teams-availability"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Available">Available</SelectItem>
                  <SelectItem value="Busy">Busy</SelectItem>
                  <SelectItem value="DoNotDisturb">Do Not Disturb</SelectItem>
                  <SelectItem value="Away">Away</SelectItem>
                  <SelectItem value="Offline">Offline</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Status Message</Label><Input value={teamsData.status_message} onChange={e => setTeamsData({...teamsData, status_message: e.target.value})} placeholder="What are you working on?" data-testid="teams-status-msg" /></div>
          </div>
          <DialogFooter><Button onClick={updateTeamsStatus} data-testid="save-teams-status"><MessageSquare className="w-4 h-4 mr-1" />Update Status</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ON-CALL SCHEDULE DIALOG */}
      <Dialog open={onCallDialog} onOpenChange={setOnCallDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><PhoneCall className="w-5 h-5 text-emerald-400" />Schedule On-Call Shift</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Technician</Label>
              <Select value={onCallForm.tech_id || "__none"} onValueChange={v => { const t = techs.find(x => x.id === v); setOnCallForm(f => ({ ...f, tech_id: v === "__none" ? "" : v, tech_name: t?.name || "" })); }}>
                <SelectTrigger data-testid="on-call-tech-select"><SelectValue placeholder="Select technician" /></SelectTrigger>
                <SelectContent>{techs.map(t => <SelectItem key={t.id} value={t.id}>{t.name} - {t.job_title || t.role}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Category</Label>
                <Select value={onCallForm.category} onValueChange={v => setOnCallForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="wisp">WISP/Internet</SelectItem>
                    <SelectItem value="workshop">Workshop/Retail</SelectItem>
                    <SelectItem value="network">Network</SelectItem>
                    <SelectItem value="emergency">Emergency</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Shift Type</Label>
                <Select value={onCallForm.shift_type} onValueChange={v => setOnCallForm(f => ({ ...f, shift_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Primary</SelectItem>
                    <SelectItem value="secondary">Secondary</SelectItem>
                    <SelectItem value="backup">Backup</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start</Label><Input type="datetime-local" value={onCallForm.start_time} onChange={e => setOnCallForm(f => ({ ...f, start_time: e.target.value }))} data-testid="on-call-start" /></div>
              <div><Label>End</Label><Input type="datetime-local" value={onCallForm.end_time} onChange={e => setOnCallForm(f => ({ ...f, end_time: e.target.value }))} data-testid="on-call-end" /></div>
            </div>
            <div><Label>Notes</Label><Input value={onCallForm.notes} onChange={e => setOnCallForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" /></div>
          </div>
          <DialogFooter><Button onClick={handleCreateOnCallShift} data-testid="confirm-on-call-btn"><PhoneCall className="w-4 h-4 mr-1" />Schedule & Notify</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SWAP DIALOG */}
      <Dialog open={swapDialog} onOpenChange={setSwapDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-amber-400" />Swap On-Call Shift</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {swapShift && <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-sm">Current: <span className="font-semibold">{swapShift.tech_name}</span></p><p className="text-xs text-muted-foreground">{swapShift.start_time?.slice(0, 16)} - {swapShift.end_time?.slice(0, 16)} ({swapShift.category})</p></div>}
            <div><Label>Swap To</Label>
              <Select value={swapTechId || "__none"} onValueChange={v => setSwapTechId(v === "__none" ? "" : v)}>
                <SelectTrigger data-testid="swap-tech-select"><SelectValue placeholder="Select new tech" /></SelectTrigger>
                <SelectContent>{techs.filter(t => t.id !== swapShift?.tech_id).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">Both technicians will be notified of the swap.</p>
          </div>
          <DialogFooter><Button onClick={handleSwapShift} disabled={!swapTechId} data-testid="confirm-swap-btn"><ArrowRightLeft className="w-4 h-4 mr-1" />Confirm Swap</Button></DialogFooter>
        </DialogContent>
      </Dialog>
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
// ========== ACHIEVEMENT ICON MAPPER ==========
const ICON_MAP = { trophy: Trophy, target: Target, zap: Zap, award: Award, crown: Crown, gem: Gem, "dollar-sign": DollarSign, "credit-card": CreditCard, banknote: DollarSign, monitor: Monitor, wifi: Wifi, calendar: Calendar, shield: Shield, star: Star, cake: Cake, rocket: Rocket, layers: Layers };
function AchievementIcon({ icon, className = "w-4 h-4" }) {
  const Icon = ICON_MAP[icon] || Trophy;
  return <Icon className={className} />;
}

// ========== ACHIEVEMENTS TAB ==========
function AchievementsTab({ earned = [], allDefs = [], techName, techId, onAward }) {
  const earnedIds = new Set(earned.map(e => e.achievement_id));
  const categories = [...new Set(allDefs.map(d => d.category))];
  return (
    <div className="space-y-6 mt-4" data-testid="achievements-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-500" />
          <span className="text-sm"><strong className="text-foreground">{techName}</strong> has earned <strong className="text-amber-500">{earned.length}</strong> of {allDefs.length} badges</span>
        </div>
        <Button size="sm" variant="outline" onClick={onAward} data-testid="award-badge-btn"><Award className="w-3.5 h-3.5 mr-1" />Award Badge</Button>
      </div>

      {/* Earned Badges - Showcase */}
      {earned.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Earned Badges</h3>
          <div className="flex flex-wrap gap-3">
            {earned.map(e => {
              const def = allDefs.find(d => d.id === e.achievement_id) || {};
              return (
                <div key={e.id} className="group relative flex flex-col items-center gap-1.5 p-3 rounded-xl border bg-card hover:shadow-lg transition-all w-28" data-testid={`earned-badge-${e.achievement_id}`}>
                  <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg" style={{ backgroundColor: (def.color || "#8b5cf6") + "25", color: def.color || "#8b5cf6", boxShadow: `0 0 20px ${(def.color || "#8b5cf6")}30` }}>
                    <AchievementIcon icon={def.icon || "trophy"} className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-medium text-center leading-tight">{e.achievement_name}</span>
                  <span className="text-[9px] text-muted-foreground">{e.awarded_at ? formatDistanceToNow(new Date(e.awarded_at), { addSuffix: true }) : ""}</span>
                  {e.awarded_by !== "System" && <Badge variant="outline" className="text-[8px] h-4">Admin</Badge>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All Badges by Category */}
      {categories.map(cat => (
        <div key={cat}>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 capitalize">{cat}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {allDefs.filter(d => d.category === cat).map(def => {
              const isEarned = earnedIds.has(def.id);
              return (
                <div key={def.id} className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border transition-all ${isEarned ? "border-primary/30 bg-primary/5" : "opacity-40 grayscale"}`} data-testid={`badge-def-${def.id}`}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: isEarned ? def.color + "25" : "#27272a", color: isEarned ? def.color : "#52525b" }}>
                    <AchievementIcon icon={def.icon} className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-medium text-center">{def.name}</span>
                  <span className="text-[9px] text-muted-foreground text-center leading-tight">{def.description}</span>
                  {isEarned && <CheckCircle className="w-3 h-3 text-green-500" />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ========== PROFILE TAB ==========
function ProfileTab({ technician, onEditProfile, onUploadAvatar, avatarFile, onConfirmUpload, onTeamsStatus }) {
  const t = technician;
  return (
    <div className="space-y-4 mt-4" data-testid="profile-tab">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Avatar Upload */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Profile Picture</CardTitle></CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            {t.avatar ? (
              <img src={t.avatar} alt={t.name} className="w-24 h-24 rounded-full object-cover border-4 border-primary/20" />
            ) : (
              <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-3xl">{t.name?.charAt(0)?.toUpperCase()}</div>
            )}
            <label className="cursor-pointer">
              <input type="file" accept="image/*" className="hidden" onChange={e => onUploadAvatar(e.target.files?.[0])} data-testid="avatar-file-input" />
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs hover:bg-muted transition-colors">
                <Camera className="w-3.5 h-3.5" />Change Photo
              </div>
            </label>
            {avatarFile && (
              <div className="text-xs text-center">
                <p className="text-muted-foreground">{avatarFile.name}</p>
                <Button size="sm" className="h-7 mt-1" onClick={onConfirmUpload} data-testid="confirm-avatar-upload"><Upload className="w-3 h-3 mr-1" />Upload</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* About Me */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">About</CardTitle>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7" onClick={onEditProfile} data-testid="edit-profile-btn"><Edit className="w-3 h-3 mr-1" />Edit Profile</Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={onTeamsStatus} data-testid="teams-status-btn"><MessageSquare className="w-3 h-3 mr-1" />Teams Status</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">About Me</Label>
              <p className="text-sm mt-0.5">{t.about_me || <span className="italic text-muted-foreground">No bio added yet</span>}</p>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-muted-foreground">Hire Date</Label><p className="text-sm">{t.hire_date || "Not set"}</p></div>
              <div><Label className="text-xs text-muted-foreground">Birthday</Label><p className="text-sm">{t.birthday || "Not set"}</p></div>
              <div><Label className="text-xs text-muted-foreground">Job Title</Label><p className="text-sm">{t.job_title || "Not set"}</p></div>
              <div><Label className="text-xs text-muted-foreground">Email</Label><p className="text-sm">{t.email}</p></div>
              <div><Label className="text-xs text-muted-foreground">Phone</Label><p className="text-sm">{t.phone || "Not set"}</p></div>
              <div><Label className="text-xs text-muted-foreground">Hourly Rate</Label><p className="text-sm">${t.hourly_rate || "75"}/hr</p></div>
            </div>
            {t.specialties?.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">Specialties</Label>
                <div className="flex gap-1 flex-wrap mt-1">{t.specialties.map(s => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)}</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

