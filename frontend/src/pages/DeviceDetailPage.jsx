import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { format, formatDistanceToNow } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { ArrowLeft, Server, Monitor, Laptop, Wifi, Shield, ShieldCheck, ShieldAlert, ShieldOff, HardDrive, Cpu, MemoryStick, Activity, Clock, RefreshCw, Terminal, Download, AlertTriangle, CheckCircle, XCircle, Info, ChevronRight, Globe, Network, Lock, Eye, EyeOff, Package, Wrench, Zap, Tag, MapPin, User, Calendar, ExternalLink, Ticket, Plus, Copy, Play, Thermometer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Separator } from "../components/ui/separator";
import { Progress } from "../components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { toast } from "sonner";

import { API, useAuth } from "../App";

const DEVICE_ICONS = { server: Server, workstation: Monitor, laptop: Laptop, network: Wifi, mobile: Laptop };
const STATUS_COLORS = { online: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", offline: "bg-red-500/10 text-red-500 border-red-500/20", warning: "bg-amber-500/10 text-amber-500 border-amber-500/20" };
const SEVERITY_COLORS = { critical: "bg-red-500/10 text-red-500", high: "bg-orange-500/10 text-orange-500", important: "bg-amber-500/10 text-amber-500", warning: "bg-amber-500/10 text-amber-500", info: "bg-blue-500/10 text-blue-500", error: "bg-red-500/10 text-red-500" };
const PATCH_STATUS = { installed: "bg-emerald-500/10 text-emerald-500", pending: "bg-amber-500/10 text-amber-500", failed: "bg-red-500/10 text-red-500" };
const EVENT_ICONS = { agent_check_in: Activity, login: User, logout: User, software_installed: Package, patch_applied: Download, alert_triggered: AlertTriangle, reboot: RefreshCw, service_restart: Wrench, backup_completed: HardDrive, script_executed: Terminal };

function UsageGauge({ label, value, icon: Icon, thresholds = [70, 90] }) {
  const color = value >= thresholds[1] ? "text-red-500" : value >= thresholds[0] ? "text-amber-500" : "text-emerald-500";
  const bgColor = value >= thresholds[1] ? "bg-red-500" : value >= thresholds[0] ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="w-3.5 h-3.5" />{label}</div>
        <span className={`text-sm font-mono font-bold ${color}`}>{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full transition-all ${bgColor}`} style={{ width: `${value}%` }} /></div>
    </div>
  );
}

export default function DeviceDetailPage() {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [connectDialog, setConnectDialog] = useState(null);
  const [showPassword, setShowPassword] = useState({});
  const [connectLoading, setConnectLoading] = useState(false);
  const [diskHealth, setDiskHealth] = useState([]);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/devices/${deviceId}/detail`, { headers: { Authorization: `Bearer ${token}` } });
      setData(res.data);
      // Fetch disk health
      try {
        const disksRes = await axios.get(`${API}/devices/${deviceId}/disks`, { headers: { Authorization: `Bearer ${token}` } });
        setDiskHealth(disksRes.data);
      } catch {}
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [deviceId, token]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // Launch RustDesk via hidden anchor (no blank tab)
  const launchRustDesk = (rdId) => {
    const uri = `rustdesk://connection/new/${rdId}`;
    const a = document.createElement("a");
    a.href = uri;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
  };

  const startRemoteAccess = async () => {
    if (!dev.rustdesk_id) {
      setRemoteDialogOpen(true);
      return;
    }
    setConnectLoading(true);
    try {
      const res = await axios.post(`${API}/rustdesk/quick-connect`, { rustdesk_id: dev.rustdesk_id }, { headers: { Authorization: `Bearer ${token}` } });
      setConnectDialog({
        rustdesk_id: dev.rustdesk_id,
        connection_url: res.data.connection_url,
        web_client_url: res.data.web_client_url,
        relay_server: res.data.relay_server,
        rustdesk_password: res.data.rustdesk_password,
        device_name: dev.name,
      });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to initiate connection");
    } finally {
      setConnectLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="w-8 h-8 animate-spin" /></div>;
  if (!data) return <div className="text-center py-20 text-muted-foreground">Device not found</div>;

  const dev = data.device;
  const DevIcon = DEVICE_ICONS[dev.device_type] || Monitor;
  const perfData = (data.performance || []).slice().reverse().filter((_, i) => i % 6 === 0).map(p => ({
    time: p.timestamp ? format(new Date(p.timestamp), "HH:mm") : "",
    cpu: p.cpu, memory: p.memory, disk: p.disk,
    net_in: p.network_in, net_out: p.network_out
  }));

  const complianceColor = (dev.compliance_score || 0) >= 90 ? "text-emerald-500" : (dev.compliance_score || 0) >= 70 ? "text-amber-500" : "text-red-500";
  const SecurityIcon = (dev.compliance_score || 0) >= 90 ? ShieldCheck : (dev.compliance_score || 0) >= 70 ? Shield : ShieldAlert;

  return (
    <div className="space-y-6" data-testid="device-detail-page">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/devices")} data-testid="back-to-devices"><ArrowLeft className="w-5 h-5" /></Button>
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${STATUS_COLORS[dev.status]}`}>
            <DevIcon className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight" data-testid="device-name">{dev.name}</h1>
              <Badge className={STATUS_COLORS[dev.status] + " border capitalize"} data-testid="device-status">{dev.status}</Badge>
              {dev.compliance_score != null && (
                <Badge variant="outline" className={complianceColor + " border-current/20"}>
                  <SecurityIcon className="w-3 h-3 mr-1" />{dev.compliance_score}% Compliant
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{dev.ip_address || "N/A"}</span>
              <span>{dev.os} {dev.os_version || ""}</span>
              <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{dev.location || "Unknown"}</span>
              <span>{dev.client_name}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {dev.status === "online" && (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={startRemoteAccess} disabled={connectLoading} data-testid="remote-access-btn">
              {connectLoading ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}Remote Access
            </Button>
          )}
          {dev.status === "offline" && (
            <Button size="sm" variant="outline" disabled data-testid="remote-access-btn-disabled">
              <XCircle className="w-4 h-4 mr-1" />Offline
            </Button>
          )}
          {dev.status === "warning" && (
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={startRemoteAccess} disabled={connectLoading} data-testid="remote-access-btn">
              {connectLoading ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}Remote Access
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={fetchDetail}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card><CardContent className="pt-4 pb-3">
          <UsageGauge label="CPU" value={Math.round(dev.cpu_usage || 0)} icon={Cpu} />
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <UsageGauge label="Memory" value={Math.round(dev.memory_usage || 0)} icon={MemoryStick} />
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <UsageGauge label="Disk" value={Math.round(dev.disk_usage || 0)} icon={HardDrive} />
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="w-3.5 h-3.5" />Uptime</div>
            <p className="text-lg font-bold font-mono">{dev.uptime_hours != null ? `${Math.round(dev.uptime_hours / 24)}d ${dev.uptime_hours % 24}h` : "N/A"}</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle className="w-3.5 h-3.5" />Alerts</div>
            <p className={`text-lg font-bold ${dev.alerts_count > 0 ? "text-red-500" : "text-emerald-500"}`}>{dev.alerts_count}</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Download className="w-3.5 h-3.5" />Patches</div>
            <p className={`text-lg font-bold ${(dev.pending_patches || 0) > 0 ? "text-amber-500" : "text-emerald-500"}`}>{dev.pending_patches || 0} pending</p>
          </div>
        </CardContent></Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-10 w-full" data-testid="device-tabs">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="tickets">Tickets ({data.tickets?.length || 0})</TabsTrigger>
          <TabsTrigger value="remote-sessions" data-testid="device-remote-tab">Sessions ({data.remote_sessions?.length || 0})</TabsTrigger>
          <TabsTrigger value="software">Software ({data.software?.length || 0})</TabsTrigger>
          <TabsTrigger value="patches">Patches ({data.patches?.length || 0})</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="events">Events ({data.events?.length || 0})</TabsTrigger>
          <TabsTrigger value="audit-log" data-testid="device-audit-tab">Audit Log</TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-8 space-y-4">
              {/* Hardware Info */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Cpu className="w-4 h-4" />Hardware Specifications</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                    <div><span className="text-muted-foreground block text-xs">Manufacturer</span><span className="font-medium">{dev.manufacturer || "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Model</span><span className="font-medium">{dev.model || "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Serial Number</span><span className="font-mono text-xs">{dev.serial_number || "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Processor</span><span className="font-medium">{dev.processor || "N/A"} {dev.processor_cores ? `(${dev.processor_cores} cores)` : ""}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Memory (RAM)</span><span className="font-medium">{dev.ram_gb ? `${dev.ram_gb} GB` : "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Storage</span><span className="font-medium">{dev.storage_total_gb ? `${dev.storage_used_gb || 0} / ${dev.storage_total_gb} GB` : "N/A"}</span></div>
                    {dev.gpu && <div><span className="text-muted-foreground block text-xs">GPU</span><span className="font-medium">{dev.gpu}</span></div>}
                    <div><span className="text-muted-foreground block text-xs">Device Type</span><Badge variant="outline" className="capitalize mt-0.5">{dev.device_type}</Badge></div>
                  </div>
                </CardContent>
              </Card>

              {/* OS Info */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Monitor className="w-4 h-4" />Operating System</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
                    <div><span className="text-muted-foreground block text-xs">OS</span><span className="font-medium">{dev.os}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Version</span><span className="font-medium">{dev.os_version || "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Build</span><span className="font-mono text-xs">{dev.os_build || "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Domain</span><span className="font-medium">{dev.domain || "Workgroup"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Last Reboot</span><span className="font-medium">{dev.last_reboot ? formatDistanceToNow(new Date(dev.last_reboot), { addSuffix: true }) : "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Agent Version</span><Badge variant="outline" className="font-mono mt-0.5">{dev.agent_version || "N/A"}</Badge></div>
                  </div>
                </CardContent>
              </Card>

              {/* Disk Health / Drive Status */}
              {diskHealth.length > 0 && (
                <Card data-testid="disk-health-card">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><HardDrive className="w-4 h-4" />Drive Health ({diskHealth.length} drives)</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {diskHealth.map((disk, i) => {
                        const smartColor = disk.smart_status === "OK" ? "text-emerald-500" : disk.smart_status === "Warning" ? "text-amber-500" : disk.smart_status === "Critical" ? "text-red-500" : "text-muted-foreground";
                        const smartBg = disk.smart_status === "OK" ? "bg-emerald-500/10" : disk.smart_status === "Warning" ? "bg-amber-500/10" : disk.smart_status === "Critical" ? "bg-red-500/10" : "bg-muted/30";
                        const usageColor = disk.usage_percent >= 90 ? "bg-red-500" : disk.usage_percent >= 75 ? "bg-amber-500" : "bg-emerald-500";
                        return (
                          <div key={disk.id || `disk-${i}`} className={`p-3 rounded-lg border ${disk.smart_status === "Warning" ? "border-amber-500/20 bg-amber-500/5" : disk.smart_status === "Critical" ? "border-red-500/20 bg-red-500/5" : "border-border/40"}`} data-testid={`disk-${i}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <HardDrive className={`w-4 h-4 ${smartColor}`} />
                                <span className="font-mono text-sm font-semibold">{disk.drive_letter || disk.mount_point}</span>
                                {disk.label && <span className="text-xs text-muted-foreground">({disk.label})</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge className={`${smartBg} ${smartColor} text-[9px]`}>{disk.smart_status || "Unknown"}</Badge>
                                <Badge variant="outline" className="text-[9px]">{disk.disk_type}</Badge>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 mb-2">
                              <div className="flex-1">
                                <div className="h-2 rounded-full bg-muted overflow-hidden">
                                  <div className={`h-full rounded-full transition-all ${usageColor}`} style={{ width: `${disk.usage_percent}%` }} />
                                </div>
                              </div>
                              <span className="text-xs font-mono font-bold w-12 text-right">{disk.usage_percent}%</span>
                            </div>
                            <div className="grid grid-cols-4 gap-2 text-[10px]">
                              <div><span className="text-muted-foreground block">Total</span><span className="font-mono font-medium">{disk.total_gb} GB</span></div>
                              <div><span className="text-muted-foreground block">Used</span><span className="font-mono font-medium">{disk.used_gb} GB</span></div>
                              <div><span className="text-muted-foreground block">Free</span><span className="font-mono font-medium">{disk.free_gb} GB</span></div>
                              <div><span className="text-muted-foreground block">FS</span><span className="font-mono font-medium">{disk.file_system}</span></div>
                            </div>
                            {(disk.model || disk.smart_temperature || disk.smart_hours) && (
                              <div className="grid grid-cols-4 gap-2 text-[10px] mt-2 pt-2 border-t border-border/20">
                                {disk.model && <div className="col-span-2"><span className="text-muted-foreground block">Model</span><span className="font-medium truncate block">{disk.model}</span></div>}
                                {disk.smart_temperature != null && (
                                  <div><span className="text-muted-foreground block">Temp</span><span className={`font-mono font-medium ${disk.smart_temperature > 50 ? "text-red-400" : disk.smart_temperature > 40 ? "text-amber-400" : "text-emerald-400"}`}>{disk.smart_temperature}°C</span></div>
                                )}
                                {disk.smart_hours != null && (
                                  <div><span className="text-muted-foreground block">Power Hours</span><span className="font-mono font-medium">{disk.smart_hours.toLocaleString()}h</span></div>
                                )}
                              </div>
                            )}
                            {(disk.smart_reallocated_sectors > 0 || disk.smart_pending_sectors > 0) && (
                              <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border/20 text-[10px]">
                                {disk.smart_reallocated_sectors > 0 && <span className="text-amber-400 font-semibold">Reallocated Sectors: {disk.smart_reallocated_sectors}</span>}
                                {disk.smart_pending_sectors > 0 && <span className="text-red-400 font-semibold">Pending Sectors: {disk.smart_pending_sectors}</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Recent Events Preview */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" />Recent Activity</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab("events")} className="text-xs">View All <ChevronRight className="w-3 h-3 ml-1" /></Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(data.events || []).slice(0, 5).map((evt, i) => {
                      const EvtIcon = EVENT_ICONS[evt.event_type] || Info;
                      return (
                        <div key={`k-${i}`} className="flex items-center gap-3 py-1.5 text-sm">
                          <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${SEVERITY_COLORS[evt.severity] || "bg-muted"}`}>
                            <EvtIcon className="w-3.5 h-3.5" />
                          </div>
                          <span className="flex-1 truncate">{evt.message}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{evt.timestamp ? formatDistanceToNow(new Date(evt.timestamp), { addSuffix: true }) : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="col-span-4 space-y-4">
              {/* Assignment & Identity */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Assignment</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div><span className="text-muted-foreground block text-xs">Assigned User</span><span className="font-medium">{dev.assigned_user || "Unassigned"}</span></div>
                  <Separator />
                  <div><span className="text-muted-foreground block text-xs">Last Logged In</span><span className="font-medium">{dev.last_logged_in_user || "N/A"}</span></div>
                  <Separator />
                  <div><span className="text-muted-foreground block text-xs">Location</span><span className="font-medium">{dev.location || "N/A"}</span></div>
                  <Separator />
                  <div><span className="text-muted-foreground block text-xs">Client</span><span className="font-medium">{dev.client_name}</span></div>
                  <Separator />
                  <div><span className="text-muted-foreground block text-xs">Last Seen</span><span className="font-medium">{dev.last_seen ? formatDistanceToNow(new Date(dev.last_seen), { addSuffix: true }) : "N/A"}</span></div>
                </CardContent>
              </Card>

              {/* Tags */}
              {(dev.tags || []).length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Tag className="w-4 h-4" />Tags</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {dev.tags.map((tag, i) => <Badge key={`k-${i}`} variant="secondary" className="text-xs">{tag}</Badge>)}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Security Quick View */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" />Security Status</CardTitle></CardHeader>
                <CardContent className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Antivirus</span>
                    <Badge className={dev.antivirus_status === "active" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}>
                      {dev.antivirus_status === "active" ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                      {dev.antivirus || "None"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">EDR</span>
                    <Badge className={dev.edr_status === "active" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}>
                      {dev.edr_status === "active" ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Firewall</span>
                    <Badge className={dev.firewall_enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}>
                      {dev.firewall_enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Encryption</span>
                    <span className="text-xs font-medium">{dev.encryption_status || "Unknown"}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Alerts */}
              {(data.alerts || []).length > 0 && (
                <Card className="border-red-500/20">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-red-500"><AlertTriangle className="w-4 h-4" />Active Alerts ({data.alerts.length})</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {data.alerts.map((a, i) => (
                      <div key={`k-${i}`} className="p-2 rounded-lg bg-red-500/5 border border-red-500/10 text-sm">
                        <div className="flex items-center gap-2">
                          <Badge className={SEVERITY_COLORS[a.severity] + " text-[10px]"}>{a.severity}</Badge>
                          <span className="text-xs text-muted-foreground">{a.alert_type}</span>
                        </div>
                        <p className="mt-1 text-xs">{a.message}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* TICKETS TAB */}
        <TabsContent value="tickets" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Ticket className="w-4 h-4" />Linked Tickets</CardTitle>
                <Link to={`/tickets?device_id=${deviceId}`}><Button variant="outline" size="sm"><Plus className="w-3 h-3 mr-1" />Create Ticket for Device</Button></Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket #</TableHead><TableHead>Title</TableHead><TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead><TableHead>Assigned</TableHead><TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.tickets || []).length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No tickets linked to this device</TableCell></TableRow>
                  ) : (data.tickets || []).map((t, i) => {
                    const priorityColor = { critical: "bg-red-500/10 text-red-500", high: "bg-orange-500/10 text-orange-500", medium: "bg-amber-500/10 text-amber-500", low: "bg-blue-500/10 text-blue-500" };
                    const statusColor = { open: "border-blue-500/30 text-blue-500", in_progress: "border-amber-500/30 text-amber-500", resolved: "border-emerald-500/30 text-emerald-500", closed: "border-gray-500/30 text-gray-400", on_hold: "border-orange-500/30 text-orange-500" };
                    return (
                      <TableRow key={`k-${i}`} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/tickets`)} data-testid={`device-ticket-${t.id || i}`}>
                        <TableCell className="font-mono text-xs font-medium">{t.ticket_number || `TKT-${String(i+1).padStart(3,"0")}`}</TableCell>
                        <TableCell className="max-w-xs truncate font-medium">{t.title}</TableCell>
                        <TableCell><Badge className={`${priorityColor[t.priority] || ""} text-[10px] capitalize`}>{t.priority}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className={`${statusColor[t.status] || ""} text-[10px] capitalize`}>{(t.status || "").replace("_", " ")}</Badge></TableCell>
                        <TableCell className="text-sm">{t.assigned_name || "Unassigned"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.created_at ? formatDistanceToNow(new Date(t.created_at), { addSuffix: true }) : "-"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {/* Ticket Statistics for this device */}
          {(data.tickets || []).length > 0 && (
            <div className="grid grid-cols-4 gap-3 mt-4">
              <Card><CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold">{data.tickets.length}</p>
                <p className="text-xs text-muted-foreground">Total Tickets</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold text-blue-500">{data.tickets.filter(t => t.status === "open").length}</p>
                <p className="text-xs text-muted-foreground">Open</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold text-amber-500">{data.tickets.filter(t => t.status === "in_progress").length}</p>
                <p className="text-xs text-muted-foreground">In Progress</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold text-emerald-500">{data.tickets.filter(t => ["resolved", "closed"].includes(t.status)).length}</p>
                <p className="text-xs text-muted-foreground">Resolved</p>
              </CardContent></Card>
            </div>
          )}
        </TabsContent>

        {/* PERFORMANCE TAB */}
        <TabsContent value="performance" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">CPU Usage (24h)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={perfData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Memory Usage (24h)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={perfData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="memory" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Disk Usage (24h)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={perfData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="disk" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Network I/O (24h)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={perfData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="net_in" name="In (Mbps)" stroke="#10b981" fill="#10b981" fillOpacity={0.05} strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="net_out" name="Out (Mbps)" stroke="#ef4444" fill="#ef4444" fillOpacity={0.05} strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* SOFTWARE TAB */}
        <TabsContent value="software" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Version</TableHead><TableHead>Publisher</TableHead>
                    <TableHead>Category</TableHead><TableHead>Installed</TableHead><TableHead className="text-right">Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.software || []).length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No software inventory data</TableCell></TableRow>
                  ) : (data.software || []).map((sw, i) => (
                    <TableRow key={`k-${i}`}>
                      <TableCell className="font-medium">{sw.name}</TableCell>
                      <TableCell className="font-mono text-xs">{sw.version}</TableCell>
                      <TableCell className="text-muted-foreground">{sw.publisher}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] capitalize">{(sw.category || "").replace("_", " ")}</Badge></TableCell>
                      <TableCell className="text-sm">{sw.install_date || "N/A"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{sw.size_mb ? `${sw.size_mb} MB` : "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PATCHES TAB */}
        <TabsContent value="patches" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>KB / ID</TableHead><TableHead>Title</TableHead>
                    <TableHead>Severity</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead><TableHead>Installed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.patches || []).length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No patch data</TableCell></TableRow>
                  ) : (data.patches || []).map((p, i) => (
                    <TableRow key={`k-${i}`}>
                      <TableCell className="font-mono text-xs font-medium">{p.kb_id}</TableCell>
                      <TableCell className="max-w-xs truncate">{p.title}</TableCell>
                      <TableCell><Badge className={SEVERITY_COLORS[p.severity] + " text-[10px] capitalize"}>{p.severity}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.category}</TableCell>
                      <TableCell><Badge className={PATCH_STATUS[p.status] + " text-[10px] capitalize"}>{p.status}</Badge></TableCell>
                      <TableCell className="text-sm">{p.installed_date || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SECURITY TAB */}
        <TabsContent value="security" className="space-y-4 mt-4">
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-4">
              <Card className="h-full">
                <CardHeader className="pb-3"><CardTitle className="text-sm">Compliance Score</CardTitle></CardHeader>
                <CardContent className="flex flex-col items-center justify-center">
                  <div className={`text-6xl font-bold font-mono ${complianceColor}`}>{dev.compliance_score || 0}</div>
                  <p className="text-sm text-muted-foreground mt-2">out of 100</p>
                  <Progress value={dev.compliance_score || 0} className="mt-4 h-3" />
                </CardContent>
              </Card>
            </div>
            <div className="col-span-8 space-y-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Endpoint Protection</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: "Antivirus", value: dev.antivirus || "None", status: dev.antivirus_status, icon: Shield },
                      { label: "EDR / XDR", value: dev.edr_status === "active" ? "Active" : "Not Deployed", status: dev.edr_status, icon: ShieldCheck },
                      { label: "Firewall", value: dev.firewall_enabled ? "Enabled" : "Disabled", status: dev.firewall_enabled ? "active" : "inactive", icon: Lock },
                      { label: "Disk Encryption", value: dev.encryption_status || "Unknown", status: (dev.encryption_status || "").includes("Encrypted") ? "active" : "inactive", icon: Lock },
                    ].map((item, i) => (
                      <div key={`k-${i}`} className="flex items-center gap-3 p-3 rounded-lg border">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${item.status === "active" ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                          <item.icon className={`w-5 h-5 ${item.status === "active" ? "text-emerald-500" : "text-red-500"}`} />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{item.label}</p>
                          <p className="font-medium text-sm">{item.value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Patch Compliance</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-emerald-500">{(data.patches || []).filter(p => p.status === "installed").length}</p>
                      <p className="text-xs text-muted-foreground">Installed</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-amber-500">{(data.patches || []).filter(p => p.status === "pending").length}</p>
                      <p className="text-xs text-muted-foreground">Pending</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-red-500">{(data.patches || []).filter(p => p.status === "failed").length}</p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* NETWORK TAB */}
        <TabsContent value="network" className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Internal IP</div>
              <p className="font-mono font-medium mt-1">{dev.ip_address || "N/A"}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Public IP</div>
              <p className="font-mono font-medium mt-1">{dev.public_ip || "N/A"}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">MAC Address</div>
              <p className="font-mono font-medium mt-1">{dev.mac_address || "N/A"}</p>
            </CardContent></Card>
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Network className="w-4 h-4" />Network Adapters</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Adapter</TableHead><TableHead>Type</TableHead><TableHead>IP Address</TableHead>
                    <TableHead>Subnet</TableHead><TableHead>Gateway</TableHead><TableHead>DNS</TableHead><TableHead>Speed</TableHead><TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.network_adapters || []).length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No network adapter data</TableCell></TableRow>
                  ) : (data.network_adapters || []).map((n, i) => (
                    <TableRow key={`k-${i}`}>
                      <TableCell className="font-medium">{n.adapter_name}{n.ssid ? <span className="text-xs text-muted-foreground ml-1">({n.ssid})</span> : ""}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] capitalize">{n.type}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{n.ip_address}</TableCell>
                      <TableCell className="font-mono text-xs">{n.subnet || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{n.gateway || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{(n.dns || []).join(", ") || "-"}</TableCell>
                      <TableCell className="text-sm">{n.speed_mbps ? `${n.speed_mbps >= 1000 ? `${n.speed_mbps/1000} Gbps` : `${n.speed_mbps} Mbps`}` : "-"}</TableCell>
                      <TableCell><Badge className={n.status === "up" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}>{n.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* EVENTS TAB */}
        <TabsContent value="events" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead><TableHead>Event</TableHead><TableHead>Message</TableHead>
                    <TableHead>Severity</TableHead><TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.events || []).length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No events recorded</TableCell></TableRow>
                  ) : (data.events || []).map((evt, i) => {
                    const EvtIcon = EVENT_ICONS[evt.event_type] || Info;
                    return (
                      <TableRow key={`k-${i}`}>
                        <TableCell><div className={`w-7 h-7 rounded-md flex items-center justify-center ${SEVERITY_COLORS[evt.severity] || "bg-muted"}`}><EvtIcon className="w-3.5 h-3.5" /></div></TableCell>
                        <TableCell className="font-medium capitalize text-sm">{(evt.event_type || "").replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-sm">{evt.message}</TableCell>
                        <TableCell><Badge className={SEVERITY_COLORS[evt.severity] + " text-[10px] capitalize"}>{evt.severity}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{evt.timestamp ? format(new Date(evt.timestamp), "MMM d, HH:mm") : "-"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* REMOTE SESSIONS TAB */}
        <TabsContent value="remote-sessions" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><ExternalLink className="w-4 h-4" />Remote Session History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Technician</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead><TableHead>Lock Status</TableHead><TableHead>Started</TableHead><TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.remote_sessions || []).length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No remote sessions recorded</TableCell></TableRow>
                  ) : (data.remote_sessions || []).map((s, i) => (
                    <TableRow key={s.id || i} data-testid={`device-session-${i}`}>
                      <TableCell className="font-medium">{s.user_name || "Unknown"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs capitalize">{(s.session_type || "remote").replace("_", " ")}</Badge></TableCell>
                      <TableCell>
                        {s.status === "active" ? (
                          <Badge className="bg-emerald-600 text-white text-xs">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-zinc-400">Ended</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{s.status === "active" ? <span className="text-emerald-500">Live</span> : `${s.duration_minutes || 0}m`}</TableCell>
                      <TableCell>
                        <div className="text-xs">
                          {s.lock_action_on_disconnect ? (
                            <span className={s.lock_action_on_disconnect === "locked" ? "text-amber-500" : s.lock_action_on_disconnect === "unlocked" ? "text-green-500" : "text-zinc-500"}>
                              {s.lock_action_on_disconnect === "locked" && <Lock className="w-3 h-3 inline mr-1" />}
                              {s.lock_action_on_disconnect === "unlocked" && <Eye className="w-3 h-3 inline mr-1" />}
                              {s.lock_action_on_disconnect}
                            </span>
                          ) : "n/a"}
                          {s.was_locked_before_disconnect != null && (
                            <div className="text-[10px] text-muted-foreground">Before: {s.was_locked_before_disconnect ? "Locked" : "Unlocked"}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.started_at ? formatDistanceToNow(new Date(s.started_at), { addSuffix: true }) : "-"}</TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate">{s.notes || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AUDIT LOG TAB */}
        <TabsContent value="audit-log" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" />Device Activity Log (Admin)</CardTitle>
            </CardHeader>
            <CardContent>
              {(data.activity_logs || []).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No activity logs recorded for this device</div>
              ) : (
                <div className="space-y-2">
                  {(data.activity_logs || []).map((log, i) => (
                    <div key={log.id || i} className="flex items-start gap-3 p-3 rounded-lg border bg-card" data-testid={`device-audit-${i}`}>
                      <div className="mt-0.5">
                        {log.action === "created" && <Plus className="w-4 h-4 text-green-500" />}
                        {log.action === "updated" && <Wrench className="w-4 h-4 text-blue-500" />}
                        {log.action === "deleted" && <XCircle className="w-4 h-4 text-red-500" />}
                        {log.action === "remote_connect" && <ExternalLink className="w-4 h-4 text-emerald-500" />}
                        {log.action === "remote_disconnect" && <Lock className="w-4 h-4 text-zinc-400" />}
                        {!["created","updated","deleted","remote_connect","remote_disconnect"].includes(log.action) && <Info className="w-4 h-4 text-zinc-500" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{log.user_name}</span>
                          <Badge variant="outline" className="text-[10px] capitalize">{(log.action || "").replace("_", " ")}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{log.details}</p>
                        {log.changes && Object.keys(log.changes).length > 0 && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {Object.entries(log.changes).slice(0, 5).map(([k, v]) => (
                              <div key={k}><span className="text-zinc-500">{k}:</span> <span className="text-red-400 line-through">{v.old}</span> <span className="text-green-400">{v.new}</span></div>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{log.created_at ? formatDistanceToNow(new Date(log.created_at), { addSuffix: true }) : "-"}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Remote Access Dialog - No RustDesk ID configured */}
      <Dialog open={remoteDialogOpen} onOpenChange={setRemoteDialogOpen}>
        <DialogContent className="max-w-md" aria-describedby="no-rustdesk-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ExternalLink className="w-5 h-5" />Remote Access - {dev.name}</DialogTitle>
            <DialogDescription id="no-rustdesk-desc">Configure remote access for this device</DialogDescription>
          </DialogHeader>
          <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400 space-y-2">
            <p className="font-semibold">No RustDesk ID Configured</p>
            <p className="text-xs text-muted-foreground">This device does not have a RustDesk ID assigned. To enable remote access:</p>
            <ol className="text-xs text-muted-foreground list-decimal pl-4 space-y-1">
              <li>Install the NexusOps agent or RustDesk client on the device</li>
              <li>Note the RustDesk ID displayed in the client</li>
              <li>Assign the ID to this device in the Remote Access Hub</li>
            </ol>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoteDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remote Connection Dialog - Matching Remote Access Hub style */}
      <Dialog open={!!connectDialog} onOpenChange={v => { if (!v) setConnectDialog(null); }}>
        <DialogContent className="max-w-md" aria-describedby="connect-device-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Play className="w-5 h-5 text-emerald-400" />Connect to {connectDialog?.device_name}</DialogTitle>
            <DialogDescription id="connect-device-desc">Choose how to connect to this device</DialogDescription>
          </DialogHeader>
          {connectDialog && (
            <div className="space-y-4">
              {/* Device Info */}
              <Card className="bg-zinc-800/50 border-border/30">
                <CardContent className="py-3 px-4 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">RustDesk ID</span>
                    <span className="font-mono font-bold text-emerald-400">{connectDialog.rustdesk_id}</span>
                  </div>
                  {connectDialog.rustdesk_password && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Password</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs">{showPassword["connect"] ? connectDialog.rustdesk_password : "********"}</span>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setShowPassword(p => ({ ...p, connect: !p.connect }))}>
                          {showPassword["connect"] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => { navigator.clipboard.writeText(connectDialog.rustdesk_password); toast.success("Password copied"); }}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                  {connectDialog.relay_server && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Relay Server</span>
                      <span className="font-mono text-xs text-muted-foreground">{connectDialog.relay_server}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Connection Methods */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Launch Connection</Label>

                <Button className="w-full justify-start h-12" variant="default" onClick={() => { launchRustDesk(connectDialog.rustdesk_id); toast.success("Launching RustDesk client..."); }} data-testid="launch-native-rustdesk">
                  <Monitor className="w-5 h-5 mr-3" />
                  <div className="text-left">
                    <p className="text-sm font-medium">Open in RustDesk Client</p>
                    <p className="text-[10px] opacity-70">Requires RustDesk installed on this computer</p>
                  </div>
                </Button>

                {connectDialog.web_client_url && (
                  <Button className="w-full justify-start h-12" variant="outline" onClick={() => { window.open(connectDialog.web_client_url, "_blank"); toast.success("Opening web client..."); }} data-testid="launch-web-rustdesk">
                    <Globe className="w-5 h-5 mr-3" />
                    <div className="text-left">
                      <p className="text-sm font-medium">Open Web Client</p>
                      <p className="text-[10px] text-muted-foreground">Connect via browser at {connectDialog.web_client_url}</p>
                    </div>
                  </Button>
                )}

                <Button className="w-full justify-start h-12" variant="outline" onClick={() => { navigator.clipboard.writeText(connectDialog.rustdesk_id); toast.success(`ID ${connectDialog.rustdesk_id} copied — paste into RustDesk`); }} data-testid="copy-rustdesk-id">
                  <Copy className="w-5 h-5 mr-3" />
                  <div className="text-left">
                    <p className="text-sm font-medium">Copy ID to Clipboard</p>
                    <p className="text-[10px] text-muted-foreground">Manually paste into your RustDesk client</p>
                  </div>
                </Button>
              </div>

              <div className="text-xs text-muted-foreground bg-muted/10 p-3 rounded-lg">
                <p className="font-medium mb-1">Troubleshooting</p>
                <ul className="space-y-0.5 list-disc pl-3">
                  <li>Ensure the RustDesk client is installed and running on your machine</li>
                  <li>The target device must be online with RustDesk running</li>
                  <li>If the native launch doesn't work, copy the ID and connect manually</li>
                  {connectDialog.relay_server && <li>Your relay server is: <code className="font-mono text-emerald-400">{connectDialog.relay_server}</code></li>}
                </ul>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
