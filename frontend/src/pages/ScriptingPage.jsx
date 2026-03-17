import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Terminal, Plus, Search, Play, Clock, RefreshCw, Loader2, Code, Cpu,
  CheckCircle, XCircle, MoreVertical, Copy, Trash2, BookOpen, Calendar,
  Shield, Download, Zap, Settings, AlertTriangle, Server, Check, Clipboard
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";

function CodeBlock({ content, language }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group rounded-lg overflow-hidden border bg-[#1a1b26]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#24283b] border-b border-[#2f3348]">
        <span className="text-[10px] text-[#565f89] uppercase tracking-wider font-mono">{language || "script"}</span>
        <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-[#565f89] hover:text-[#a9b1d6] transition-colors" data-testid="copy-code-btn">
          {copied ? <><Check className="w-3 h-3 text-green-400" /><span className="text-green-400">Copied!</span></> : <><Clipboard className="w-3 h-3" /><span>Copy</span></>}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono leading-relaxed text-[#a9b1d6] max-h-[300px] overflow-y-auto"><code>{content}</code></pre>
    </div>
  );
}

const scriptTypes = {
  powershell: { label: "PowerShell", color: "bg-blue-500" },
  bash: { label: "Bash", color: "bg-green-500" },
  python: { label: "Python", color: "bg-yellow-500" },
  batch: { label: "Batch", color: "bg-gray-500" }
};

const categories = {
  general: "General", maintenance: "Maintenance", security: "Security",
  monitoring: "Monitoring", remediation: "Remediation"
};

// Built-in script library templates
const scriptLibrary = [
  { name: "Clear Temp Files", description: "Removes temporary files to free disk space", script_type: "powershell", category: "maintenance", os_target: "windows",
    content: "# Clear Windows Temp Files\n$paths = @(\"$env:TEMP\\*\", \"$env:WINDIR\\Temp\\*\", \"$env:WINDIR\\Prefetch\\*\")\nforeach ($path in $paths) {\n    try { Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue }\n    catch { Write-Warning \"Could not clean: $path\" }\n}\nWrite-Output \"Temp files cleaned successfully\"" },
  { name: "Check Disk Space", description: "Reports disk usage for all drives", script_type: "powershell", category: "monitoring", os_target: "windows",
    content: "Get-WmiObject Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID, @{N='Size(GB)';E={[math]::Round($_.Size/1GB,2)}}, @{N='Free(GB)';E={[math]::Round($_.FreeSpace/1GB,2)}}, @{N='%Free';E={[math]::Round(($_.FreeSpace/$_.Size)*100,1)}} | Format-Table -AutoSize" },
  { name: "Windows Update Check", description: "Checks for pending Windows updates", script_type: "powershell", category: "maintenance", os_target: "windows",
    content: "$Session = New-Object -ComObject Microsoft.Update.Session\n$Searcher = $Session.CreateUpdateSearcher()\n$Results = $Searcher.Search(\"IsInstalled=0\")\nWrite-Output \"Pending updates: $($Results.Updates.Count)\"\nforeach ($Update in $Results.Updates) {\n    Write-Output \"  - $($Update.Title) [$($Update.MsrcSeverity)]\"\n}" },
  { name: "Service Health Check", description: "Checks status of critical Windows services", script_type: "powershell", category: "monitoring", os_target: "windows",
    content: "$services = @(\"Spooler\",\"BITS\",\"wuauserv\",\"EventLog\",\"Dhcp\",\"Dnscache\",\"LanmanServer\",\"LanmanWorkstation\")\nforeach ($svc in $services) {\n    $s = Get-Service -Name $svc -ErrorAction SilentlyContinue\n    if ($s) { Write-Output \"$($s.DisplayName): $($s.Status)\" }\n    else { Write-Warning \"Service $svc not found\" }\n}" },
  { name: "System Info Report", description: "Generates comprehensive system information", script_type: "powershell", category: "general", os_target: "windows",
    content: "$os = Get-WmiObject Win32_OperatingSystem\n$cpu = Get-WmiObject Win32_Processor\n$ram = [math]::Round($os.TotalVisibleMemorySize/1MB, 2)\nWrite-Output \"=== System Report ===\"\nWrite-Output \"Computer: $env:COMPUTERNAME\"\nWrite-Output \"OS: $($os.Caption) $($os.Version)\"\nWrite-Output \"CPU: $($cpu.Name)\"\nWrite-Output \"RAM: $($ram)GB\"\nWrite-Output \"Uptime: $(( (Get-Date) - $os.ConvertToDateTime($os.LastBootUpTime) ).Days) days\"" },
  { name: "Network Diagnostics", description: "Tests network connectivity and DNS resolution", script_type: "powershell", category: "remediation", os_target: "windows",
    content: "Write-Output \"=== Network Diagnostics ===\"\nWrite-Output \"`nIP Configuration:\"\nGet-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike \"*Loopback*\" } | Select-Object InterfaceAlias, IPAddress\nWrite-Output \"`nDNS Resolution:\"\n@(\"google.com\",\"microsoft.com\",\"8.8.8.8\") | ForEach-Object {\n    $r = Test-Connection -ComputerName $_ -Count 1 -Quiet\n    Write-Output \"  $_: $(if($r){'OK'}else{'FAIL'})\"\n}" },
  { name: "Security Audit", description: "Checks antivirus, firewall, and local admin accounts", script_type: "powershell", category: "security", os_target: "windows",
    content: "Write-Output \"=== Security Audit ===\"\n# Firewall\nGet-NetFirewallProfile | Select-Object Name, Enabled | Format-Table\n# Antivirus\nGet-MpComputerStatus | Select-Object AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated\n# Local Admins\nWrite-Output \"`nLocal Administrators:\"\nGet-LocalGroupMember -Group \"Administrators\" | Select-Object Name, ObjectClass" },
  { name: "Linux System Health", description: "Checks CPU, memory, disk and uptime on Linux", script_type: "bash", category: "monitoring", os_target: "linux",
    content: "#!/bin/bash\necho \"=== System Health ===\"\necho \"Hostname: $(hostname)\"\necho \"Uptime: $(uptime -p)\"\necho \"CPU Load: $(cat /proc/loadavg | awk '{print $1, $2, $3}')\"\necho \"Memory:\"\nfree -h | grep -E \"Mem|Swap\"\necho \"Disk Usage:\"\ndf -h | grep -E \"^/dev\"" },
];

export default function ScriptingPage() {
  const { token } = useAuth();
  const [scripts, setScripts] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [devices, setDevices] = useState([]);
  const [scheduledTasks, setScheduledTasks] = useState([]);
  const [patchStats, setPatchStats] = useState(null);
  const [patches, setPatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("scripts");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRunDialogOpen, setIsRunDialogOpen] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [selectedScript, setSelectedScript] = useState(null);
  const [selectedDevices, setSelectedDevices] = useState([]);
  const [scheduleForm, setScheduleForm] = useState({
    name: "", script_id: "", schedule_type: "daily", schedule_time: "09:00",
    schedule_days: [], target_ids: [], enabled: true
  });
  const [formData, setFormData] = useState({
    name: "", description: "", script_type: "powershell", content: "",
    category: "general", os_target: "windows", run_as_admin: true, timeout_seconds: 300
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [scriptsRes, executionsRes, devicesRes, tasksRes, patchRes] = await Promise.all([
        axios.get(`${API}/scripts`, { headers }),
        axios.get(`${API}/script-executions?limit=50`, { headers }),
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/scheduled-tasks`, { headers }),
        axios.get(`${API}/patches/dashboard`, { headers }).catch(() => ({ data: null })),
      ]);
      setScripts(scriptsRes.data);
      setExecutions(executionsRes.data);
      setDevices(devicesRes.data);
      setScheduledTasks(tasksRes.data);
      if (patchRes.data) setPatchStats(patchRes.data);
    } catch { toast.error("Failed to fetch data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (selectedScript) {
        await axios.put(`${API}/scripts/${selectedScript.id}`, formData, { headers });
        toast.success("Script updated");
      } else {
        await axios.post(`${API}/scripts`, formData, { headers });
        toast.success("Script created");
      }
      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch { toast.error("Failed to save script"); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this script?")) return;
    try {
      await axios.delete(`${API}/scripts/${id}`, { headers });
      toast.success("Script deleted");
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Failed to delete script"); }
  };

  const handleRunScript = async () => {
    if (!selectedScript || selectedDevices.length === 0) { toast.error("Select at least one device"); return; }
    try {
      await axios.post(`${API}/scripts/${selectedScript.id}/execute`, selectedDevices, { headers });
      toast.success(`Script queued for ${selectedDevices.length} devices`);
      setIsRunDialogOpen(false);
      setSelectedDevices([]);
      fetchData();
    } catch { toast.error("Failed to run script"); }
  };

  const handleCreateSchedule = async () => {
    if (!scheduleForm.name || !scheduleForm.script_id) { toast.error("Name and script required"); return; }
    try {
      await axios.post(`${API}/scheduled-tasks`, scheduleForm, { headers });
      toast.success("Scheduled task created");
      setIsScheduleDialogOpen(false);
      setScheduleForm({ name: "", script_id: "", schedule_type: "daily", schedule_time: "09:00", schedule_days: [], target_ids: [], enabled: true });
      fetchData();
    } catch { toast.error("Failed to create schedule"); }
  };

  const handleDeleteSchedule = async (id) => {
    try {
      await axios.delete(`${API}/scheduled-tasks/${id}`, { headers });
      toast.success("Schedule deleted");
      fetchData();
    } catch { toast.error("Failed to delete"); }
  };

  const handleToggleSchedule = async (id, enabled) => {
    try {
      await axios.put(`${API}/scheduled-tasks/${id}`, { enabled }, { headers });
      fetchData();
    } catch { toast.error("Failed to update"); }
  };

  const importFromLibrary = (template) => {
    setFormData({ ...template, run_as_admin: true, timeout_seconds: 300 });
    setSelectedScript(null);
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({ name: "", description: "", script_type: "powershell", content: "", category: "general", os_target: "windows", run_as_admin: true, timeout_seconds: 300 });
    setSelectedScript(null);
  };

  const openEditDialog = (script) => {
    setSelectedScript(script);
    setFormData({ name: script.name, description: script.description || "", script_type: script.script_type, content: script.content, category: script.category, os_target: script.os_target, run_as_admin: script.run_as_admin, timeout_seconds: script.timeout_seconds });
    setIsDialogOpen(true);
  };

  const openRunDialog = (script) => { setSelectedScript(script); setSelectedDevices([]); setIsRunDialogOpen(true); };

  const filteredScripts = scripts.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.description?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6" data-testid="scripting-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scripting & Automation</h1>
          <p className="text-muted-foreground">Script library, execution, scheduling & patch management</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild><Button data-testid="create-script-btn"><Plus className="w-4 h-4 mr-2" />New Script</Button></DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{selectedScript ? "Edit Script" : "Create Script"}</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Name *</Label><Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Clear Temp Files" required /></div>
                  <div className="space-y-2"><Label>Category</Label>
                    <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(categories).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2"><Label>Description</Label><Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Clears temporary files to free up disk space" /></div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2"><Label>Script Type</Label>
                    <Select value={formData.script_type} onValueChange={(v) => setFormData({ ...formData, script_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(scriptTypes).map(([k, v]) => (<SelectItem key={k} value={k}>{v.label}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Target OS</Label>
                    <Select value={formData.os_target} onValueChange={(v) => setFormData({ ...formData, os_target: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="windows">Windows</SelectItem><SelectItem value="macos">macOS</SelectItem>
                        <SelectItem value="linux">Linux</SelectItem><SelectItem value="cross_platform">Cross Platform</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Timeout (seconds)</Label><Input type="number" value={formData.timeout_seconds} onChange={(e) => setFormData({ ...formData, timeout_seconds: parseInt(e.target.value) })} /></div>
                </div>
                <div className="space-y-2"><Label>Script Content *</Label>
                  <Textarea value={formData.content} onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    placeholder={formData.script_type === 'powershell' ? '# PowerShell script\nGet-Process | Where-Object { $_.CPU -gt 100 }' : '#!/bin/bash\necho "Hello World"'}
                    className="font-mono text-sm min-h-[200px]" required />
                </div>
                <DialogFooter><Button type="submit">{selectedScript ? "Update" : "Create Script"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><Code className="w-5 h-5 text-primary" /></div><div><p className="text-2xl font-bold">{scripts.length}</p><p className="text-xs text-muted-foreground">Total Scripts</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-green-500" /></div><div><p className="text-2xl font-bold">{executions.filter(e => e.status === 'completed').length}</p><p className="text-xs text-muted-foreground">Successful Runs</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center"><XCircle className="w-5 h-5 text-red-500" /></div><div><p className="text-2xl font-bold">{executions.filter(e => e.status === 'failed').length}</p><p className="text-xs text-muted-foreground">Failed Runs</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center"><Clock className="w-5 h-5 text-yellow-500" /></div><div><p className="text-2xl font-bold">{scheduledTasks.filter(t => t.enabled).length}</p><p className="text-xs text-muted-foreground">Active Schedules</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center"><Shield className="w-5 h-5 text-orange-500" /></div><div><p className="text-2xl font-bold">{patchStats?.pending_critical || 0}</p><p className="text-xs text-muted-foreground">Critical Patches</p></div></CardContent></Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="scripts" className="gap-2"><Code className="w-4 h-4" />Scripts</TabsTrigger>
          <TabsTrigger value="library" className="gap-2"><BookOpen className="w-4 h-4" />Library</TabsTrigger>
          <TabsTrigger value="history" className="gap-2"><Clock className="w-4 h-4" />History</TabsTrigger>
          <TabsTrigger value="scheduling" className="gap-2"><Calendar className="w-4 h-4" />Scheduling</TabsTrigger>
          <TabsTrigger value="patches" className="gap-2"><Shield className="w-4 h-4" />Patches</TabsTrigger>
        </TabsList>

        {/* Scripts Tab */}
        <TabsContent value="scripts" className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search scripts..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : filteredScripts.length > 0 ? (
            <div className="space-y-4">
              {filteredScripts.map(script => (
                <Card key={script.id} className="hover:border-primary/30 transition-all" data-testid={`script-card-${script.id}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${scriptTypes[script.script_type]?.color || "bg-muted"}/10`}><Terminal className="w-5 h-5 text-muted-foreground" /></div>
                        <div>
                          <h3 className="font-semibold">{script.name}</h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className="text-[10px]">{scriptTypes[script.script_type]?.label}</Badge>
                            <Badge variant="outline" className="text-[10px]">{script.os_target}</Badge>
                            <span className="text-[10px] text-muted-foreground">{categories[script.category]}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" onClick={() => openRunDialog(script)} data-testid={`run-script-${script.id}`}><Play className="w-3 h-3 mr-1" />Run</Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(script)}>Edit</DropdownMenuItem>
                            {!script.is_built_in && (<DropdownMenuItem className="text-destructive" onClick={() => handleDelete(script.id)}><Trash2 className="w-4 h-4 mr-2" />Delete</DropdownMenuItem>)}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    {script.description && <p className="text-sm text-muted-foreground mb-3">{script.description}</p>}
                    <CodeBlock content={script.content} language={script.script_type} />
                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-3">
                      <span>Runs: {script.run_count || 0}</span>
                      {script.last_run && <span>Last: {formatDistanceToNow(new Date(script.last_run), { addSuffix: true })}</span>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64">
              <Terminal className="w-12 h-12 text-muted-foreground opacity-50 mb-4" /><p className="text-muted-foreground">No scripts found</p>
              <p className="text-sm text-muted-foreground">Create your first automation script or import from the Library</p>
            </div>
          )}
        </TabsContent>

        {/* Library Tab */}
        <TabsContent value="library" className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Script Library</h2>
            <Badge variant="secondary">{scriptLibrary.length} templates</Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-4">Ready-to-use scripts for common MSP tasks. Click "Import" to add to your scripts.</p>
          <div className="space-y-4">
            {scriptLibrary.map((template, i) => (
              <Card key={i} className="hover:border-primary/30 transition-all" data-testid={`library-template-${i}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><Zap className="w-5 h-5 text-primary" /></div>
                      <div>
                        <h3 className="font-semibold">{template.name}</h3>
                        <p className="text-xs text-muted-foreground">{template.description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px]">{scriptTypes[template.script_type]?.label}</Badge>
                          <Badge variant="outline" className="text-[10px]">{template.os_target}</Badge>
                          <Badge variant="outline" className="text-[10px]">{categories[template.category]}</Badge>
                        </div>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => importFromLibrary(template)} data-testid={`import-template-${i}`}><Download className="w-4 h-4 mr-1" />Import</Button>
                  </div>
                  <CodeBlock content={template.content} language={template.script_type} />
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <Card>
            <CardContent className="p-0">
              {executions.length > 0 ? (
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader><TableRow><TableHead>Script</TableHead><TableHead>Device</TableHead><TableHead>Status</TableHead><TableHead>Duration</TableHead><TableHead>Run By</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {executions.map(exec => (
                        <TableRow key={exec.id}>
                          <TableCell className="font-medium">{exec.script_name}</TableCell>
                          <TableCell>{exec.device_name}</TableCell>
                          <TableCell><Badge variant={exec.status === 'completed' ? 'default' : exec.status === 'failed' ? 'destructive' : 'secondary'}>{exec.status}</Badge></TableCell>
                          <TableCell>{exec.duration_seconds ? `${exec.duration_seconds}s` : '-'}</TableCell>
                          <TableCell>{exec.user_name}</TableCell>
                          <TableCell className="text-muted-foreground">{formatDistanceToNow(new Date(exec.created_at), { addSuffix: true })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                <div className="flex flex-col items-center justify-center h-64"><Clock className="w-12 h-12 text-muted-foreground opacity-50 mb-4" /><p className="text-muted-foreground">No execution history</p></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scheduling Tab */}
        <TabsContent value="scheduling" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" /><h2 className="text-lg font-semibold">Scheduled Tasks</h2></div>
            <Button size="sm" onClick={() => setIsScheduleDialogOpen(true)} data-testid="create-schedule-btn"><Plus className="w-4 h-4 mr-2" />New Schedule</Button>
          </div>
          {scheduledTasks.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {scheduledTasks.map(task => (
                <Card key={task.id} className={`${!task.enabled ? 'opacity-60' : ''}`} data-testid={`schedule-${task.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm">{task.name}</h3>
                        <Badge variant={task.enabled ? "default" : "secondary"}>{task.enabled ? "Active" : "Paused"}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={task.enabled} onCheckedChange={(v) => handleToggleSchedule(task.id, v)} />
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteSchedule(task.id)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Script: {task.script_name}</p>
                    <p className="text-xs text-muted-foreground">Schedule: {task.schedule_type} at {task.schedule_time}</p>
                    {task.last_run && <p className="text-xs text-muted-foreground">Last run: {formatDistanceToNow(new Date(task.last_run), { addSuffix: true })}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <Calendar className="w-10 h-10 opacity-50 mb-3" /><p>No scheduled tasks</p>
              <p className="text-sm">Create a schedule to automate script execution</p>
            </div>
          )}
        </TabsContent>

        {/* Patches Tab */}
        <TabsContent value="patches" className="space-y-4">
          <div className="flex items-center gap-2 mb-2"><Shield className="w-5 h-5 text-primary" /><h2 className="text-lg font-semibold">Patch Management</h2></div>
          {patchStats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{patchStats.total}</p><p className="text-xs text-muted-foreground">Total Patches</p></CardContent></Card>
              <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-500">{patchStats.installed}</p><p className="text-xs text-muted-foreground">Installed</p></CardContent></Card>
              <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-yellow-500">{patchStats.available}</p><p className="text-xs text-muted-foreground">Available</p></CardContent></Card>
              <Card className="border-red-500/20"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-red-500">{patchStats.pending_critical}</p><p className="text-xs text-muted-foreground">Critical Pending</p></CardContent></Card>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <Shield className="w-10 h-10 opacity-50 mb-3" /><p>No patch data available</p>
              <p className="text-sm">Patches will appear when devices report their update status</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Run Script Dialog */}
      <Dialog open={isRunDialogOpen} onOpenChange={setIsRunDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Run Script: {selectedScript?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Select Devices</Label>
              <ScrollArea className="h-[200px] border rounded-lg p-2">
                {devices.filter(d => d.status === 'online').map(device => (
                  <div key={device.id} className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded">
                    <input type="checkbox" id={device.id} checked={selectedDevices.includes(device.id)}
                      onChange={(e) => { if (e.target.checked) setSelectedDevices([...selectedDevices, device.id]); else setSelectedDevices(selectedDevices.filter(id => id !== device.id)); }} className="rounded" />
                    <label htmlFor={device.id} className="flex-1 cursor-pointer">
                      <span className="font-medium">{device.name}</span><span className="text-sm text-muted-foreground ml-2">{device.client_name}</span>
                    </label>
                  </div>
                ))}
                {devices.filter(d => d.status === 'online').length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No online devices</p>}
              </ScrollArea>
              <p className="text-xs text-muted-foreground">{selectedDevices.length} devices selected (showing online only)</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRunDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleRunScript} disabled={selectedDevices.length === 0}><Play className="w-4 h-4 mr-2" />Run on {selectedDevices.length} Device{selectedDevices.length !== 1 ? 's' : ''}</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule Dialog */}
      <Dialog open={isScheduleDialogOpen} onOpenChange={setIsScheduleDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Scheduled Task</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Task Name *</Label><Input value={scheduleForm.name} onChange={e => setScheduleForm({ ...scheduleForm, name: e.target.value })} placeholder="Daily disk cleanup" data-testid="schedule-name-input" /></div>
            <div className="space-y-2"><Label>Script *</Label>
              <Select value={scheduleForm.script_id} onValueChange={v => setScheduleForm({ ...scheduleForm, script_id: v })}>
                <SelectTrigger data-testid="schedule-script-select"><SelectValue placeholder="Select a script" /></SelectTrigger>
                <SelectContent>{scripts.map(s => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Frequency</Label>
                <Select value={scheduleForm.schedule_type} onValueChange={v => setScheduleForm({ ...scheduleForm, schedule_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">Once</SelectItem><SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Time</Label><Input type="time" value={scheduleForm.schedule_time} onChange={e => setScheduleForm({ ...scheduleForm, schedule_time: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsScheduleDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateSchedule} disabled={!scheduleForm.name || !scheduleForm.script_id} data-testid="submit-schedule-btn">Create Schedule</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
