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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import {
  Terminal, Plus, Search, Play, Clock, RefreshCw, Loader2, Code, Cpu,
  CheckCircle, XCircle, MoreVertical, Copy, Trash2, BookOpen, Calendar,
  Shield, Download, Zap, Settings, AlertTriangle, Server, Check, Clipboard
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";
import HeroTile from "@/components/HeroTile";

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

function ScriptAutocomplete({ scripts, selectedScript, onSelect, onImport }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const savedNames = new Set(scripts.map(script => script.name.toLowerCase()));
  const choices = [
    ...scripts.map(script => ({ ...script, source: "saved" })),
    ...scriptLibrary.filter(script => !savedNames.has(script.name.toLowerCase())).map(script => ({ ...script, source: "library" })),
  ];
  const matches = choices.filter(script => {
    const haystack = `${script.name} ${script.description || ""} ${script.category || ""} ${script.os_target || ""}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }).slice(0, 20);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start gap-2 text-left font-normal" data-testid="live-script-search-picker">
          <Code className="h-4 w-4 shrink-0 text-violet-400" />
          <span className="truncate">{selectedScript?.name || "Search and select a script…"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(420px,calc(100vw-2rem))] p-2">
        <div className="relative mb-2"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={query} onChange={e => setQuery(e.target.value)} className="h-9 pl-8 text-sm" placeholder="Search scripts, category, or operating system…" /></div>
        <ScrollArea className="max-h-64">
          <div className="space-y-1 pr-1">
            {matches.map((script, index) => (
              <button key={script.id || `library-${script.name}`} type="button" onClick={() => { if (script.source === "library") onImport(script); else onSelect(script); setQuery(""); setOpen(false); }} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted ${selectedScript?.id === script.id ? "bg-violet-500/10" : ""}`} data-testid={`live-script-result-${script.id || index}`}>
                <Code className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{script.name}</span><span className="block truncate text-[10px] text-muted-foreground">{script.description || categories[script.category] || "Script"}</span></span>
                <span className="flex shrink-0 flex-col items-end gap-1"><Badge variant="outline" className="text-[9px]">{script.os_target || "any"}</Badge>{script.source === "library" && <span className="text-[9px] text-violet-300">Install & select</span>}</span>
              </button>
            ))}
            {!matches.length && <p className="py-6 text-center text-xs text-muted-foreground">No scripts match that search.</p>}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

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
  { name: "Flush DNS Cache", description: "Clears Windows DNS resolver cache and shows current DNS servers", script_type: "powershell", category: "remediation", os_target: "windows",
    content: "Write-Output \"=== DNS Cache Refresh ===\"\nClear-DnsClientCache\nWrite-Output \"DNS cache cleared. Active DNS servers:\"\nGet-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses } | Select-Object InterfaceAlias, ServerAddresses | Format-Table -AutoSize" },
  { name: "Restart Print Spooler", description: "Safely restarts the Windows print spooler and clears stalled jobs", script_type: "powershell", category: "remediation", os_target: "windows",
    content: "Write-Output \"=== Print Spooler Recovery ===\"\nStop-Service Spooler -Force\nRemove-Item \"$env:WINDIR\\System32\\spool\\PRINTERS\\*\" -Force -ErrorAction SilentlyContinue\nStart-Service Spooler\nGet-Service Spooler | Select-Object Status, Name, DisplayName\nWrite-Output \"Print spooler restarted and queued jobs cleared.\"" },
  { name: "Microsoft Defender Quick Scan", description: "Starts a Defender quick scan and returns current protection status", script_type: "powershell", category: "security", os_target: "windows",
    content: "Write-Output \"=== Microsoft Defender Quick Scan ===\"\n$status = Get-MpComputerStatus\n$status | Select-Object AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated\nStart-MpScan -ScanType QuickScan\nWrite-Output \"Quick scan started. Review Defender history for final findings.\"" },
  { name: "BitLocker Status", description: "Reports encryption and protection state for all fixed disks", script_type: "powershell", category: "security", os_target: "windows",
    content: "Write-Output \"=== BitLocker Status ===\"\nGet-BitLockerVolume | Select-Object MountPoint, VolumeStatus, ProtectionStatus, EncryptionPercentage, EncryptionMethod | Format-Table -AutoSize" },
  { name: "Pending Reboot Check", description: "Checks common Windows signals that indicate a restart is pending", script_type: "powershell", category: "monitoring", os_target: "windows",
    content: "Write-Output \"=== Pending Restart Check ===\"\n$checks = @(\n  @{ Name = 'Component Based Servicing'; Path = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending' },\n  @{ Name = 'Windows Update'; Path = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired' }\n)\n$pending = $false\nforeach ($check in $checks) {\n  $exists = Test-Path $check.Path\n  Write-Output \"$($check.Name): $(if ($exists) { 'Pending' } else { 'Clear' })\"\n  if ($exists) { $pending = $true }\n}\nWrite-Output \"Restart required: $pending\"" },
  { name: "Critical Event Log Summary", description: "Collects recent critical and error events from System and Application logs", script_type: "powershell", category: "monitoring", os_target: "windows",
    content: "Write-Output \"=== Recent Critical and Error Events (7 days) ===\"\n$since = (Get-Date).AddDays(-7)\nGet-WinEvent -FilterHashtable @{ LogName = @('System','Application'); Level = @(1,2); StartTime = $since } -ErrorAction SilentlyContinue |\n  Select-Object -First 50 TimeCreated, LogName, ProviderName, Id, LevelDisplayName, Message |\n  Format-List" },
  { name: "Network Adapter Inventory", description: "Reports connected adapters, IP addresses, gateways and Wi-Fi details", script_type: "powershell", category: "monitoring", os_target: "windows",
    content: "Write-Output \"=== Network Adapter Inventory ===\"\nGet-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' } | ForEach-Object {\n  [PSCustomObject]@{ Adapter = $_.InterfaceAlias; IPv4 = $_.IPv4Address.IPAddress; Gateway = $_.IPv4DefaultGateway.NextHop; DNS = ($_.DNSServer.ServerAddresses -join ', ') }\n} | Format-Table -AutoSize" },
  { name: "Local Administrators Report", description: "Exports the local Administrators group membership for review", script_type: "powershell", category: "security", os_target: "windows",
    content: "Write-Output \"=== Local Administrators ===\"\nGet-LocalGroupMember -Group 'Administrators' | Select-Object Name, ObjectClass, PrincipalSource | Format-Table -AutoSize" },
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

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!scheduleForm.name || !scheduleForm.script_id || scheduleForm.target_ids.length === 0) { toast.error("Name, script, and at least one target device are required"); return; }
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

  const installTechnicianPack = async () => {
    const existing = new Set(scripts.map(script => script.name.toLowerCase()));
    const missing = scriptLibrary.filter(template => !existing.has(template.name.toLowerCase()));
    if (!missing.length) { toast.info("The full technician pack is already installed"); return; }
    try {
      await Promise.all(missing.map(template => axios.post(`${API}/scripts`, { ...template, run_as_admin: true, timeout_seconds: 300 }, { headers })));
      toast.success(`${missing.length} technician scripts installed`);
      await fetchData();
      setActiveTab("scripts");
    } catch {
      toast.error("Some technician scripts could not be installed");
      fetchData();
    }
  };

  const installLibraryScriptForTerminal = async (template) => {
    const existing = scripts.find(script => script.name.toLowerCase() === template.name.toLowerCase());
    if (existing) { setLiveScript(existing); return; }
    try {
      const response = await axios.post(`${API}/scripts`, { ...template, run_as_admin: true, timeout_seconds: 300 }, { headers });
      setLiveScript(response.data);
      toast.success(`${template.name} installed and selected`);
      fetchData();
    } catch {
      toast.error("Could not install the selected library script");
    }
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

  // Live Terminal state
  const [liveScript, setLiveScript] = useState(null);
  const [liveDevice, setLiveDevice] = useState("");
  const [liveOutput, setLiveOutput] = useState([]);
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveHistory, setLiveHistory] = useState([]);

  const handleLiveRun = async () => {
    if (!liveScript) { toast.error("Select a script"); return; }
    setLiveRunning(true);
    setLiveOutput([{ time: new Date().toISOString(), type: "info", text: "Initializing execution..." }]);
    try {
      const res = await axios.post(`${API}/scripts/${liveScript.id}/live-run`, { device_id: liveDevice, target: liveDevice || "localhost" }, { headers });
      const outputLines = res.data.output || [];
      // Animate the output lines one by one
      for (let i = 0; i < outputLines.length; i++) {
        await new Promise(r => setTimeout(r, 120 + Math.random() * 200));
        setLiveOutput(prev => [...prev.slice(0, i === 0 ? 0 : prev.length), outputLines[i]]);
      }
      setLiveHistory(prev => [{ id: res.data.id, script_name: res.data.script_name, device_name: res.data.device_name, status: res.data.status, duration_ms: res.data.duration_ms, created_at: res.data.created_at, output: outputLines }, ...prev.slice(0, 9)]);
      toast.success(`Script ${res.data.status}`);
    } catch { toast.error("Execution failed"); setLiveOutput(prev => [...prev, { time: new Date().toISOString(), type: "error", text: "Execution failed - check connection and try again" }]); }
    finally { setLiveRunning(false); }
  };

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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <HeroTile label="Total scripts" value={scripts.length} icon={Code} glow="violet" animated={false} onClick={() => setActiveTab("scripts")} testId="scripts-metric-total" />
        <HeroTile label="Successful runs" value={executions.filter(e => e.status === "completed").length} icon={CheckCircle} glow="emerald" animated={false} onClick={() => setActiveTab("history")} testId="scripts-metric-success" />
        <HeroTile label="Failed runs" value={executions.filter(e => e.status === "failed").length} icon={XCircle} glow="rose" animated={false} onClick={() => setActiveTab("history")} testId="scripts-metric-failed" />
        <HeroTile label="Active schedules" value={scheduledTasks.filter(t => t.enabled).length} icon={Clock} glow="amber" animated={false} onClick={() => setActiveTab("scheduling")} testId="scripts-metric-schedules" />
        <HeroTile label="Critical patches" value={patchStats?.pending_critical || 0} icon={Shield} glow="amber" animated={false} onClick={() => setActiveTab("patches")} testId="scripts-metric-patches" />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="scripts" className="gap-2"><Code className="w-4 h-4" />Scripts</TabsTrigger>
          <TabsTrigger value="terminal" className="gap-2" data-testid="tab-terminal"><Terminal className="w-4 h-4" />Live Terminal</TabsTrigger>
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

        {/* Live Terminal Tab */}
        <TabsContent value="terminal" className="space-y-4" data-testid="live-terminal-tab">
          <div className="rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-500/[0.07] via-transparent to-cyan-500/[0.05] p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-violet-200">Live execution console</span><span className="text-muted-foreground">Select a saved script, choose an online endpoint, then review its output in real time.</span>
              {liveScript && <Badge variant="outline" className="ml-auto border-violet-500/30 text-[10px] text-violet-200">{liveScript.os_target || "cross-platform"} · {categories[liveScript.category] || "General"}</Badge>}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:h-[550px]">
            {/* Left: Script Selector + Code Preview */}
            <div className="space-y-3 flex flex-col">
              <div className="flex flex-col gap-2 sm:flex-row">
                <ScriptAutocomplete scripts={scripts} selectedScript={liveScript} onSelect={setLiveScript} onImport={installLibraryScriptForTerminal} />
                <Select value={liveDevice} onValueChange={setLiveDevice}>
                  <SelectTrigger className="sm:w-[220px]" data-testid="live-device-select"><SelectValue placeholder="Target device..." /></SelectTrigger>
                  <SelectContent><SelectItem value="localhost">localhost</SelectItem>{devices.filter(d => d.status === "online").slice(0, 30).map(d => <SelectItem key={d.id} value={d.id}>{d.name || d.hostname}</SelectItem>)}</SelectContent>
                </Select>
                <Button onClick={handleLiveRun} disabled={liveRunning || !liveScript} className="flex-shrink-0" data-testid="live-run-btn">
                  {liveRunning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                  {liveRunning ? "Running..." : "Execute"}
                </Button>
              </div>
              {liveScript ? (
                <div className="flex-1 overflow-hidden">
                  <CodeBlock content={liveScript.content} language={liveScript.script_type} />
                </div>
              ) : (
                <div className="flex min-h-[260px] flex-1 items-center justify-center rounded-lg border border-dashed border-violet-500/20 bg-violet-500/[0.03]">
                  <div className="text-center"><Search className="mx-auto mb-2 h-10 w-10 text-violet-400/50" /><p className="text-sm font-medium text-violet-100">Find a script to begin</p><p className="mt-1 text-xs text-muted-foreground">Search by name, category, or operating system.</p></div>
                </div>
              )}
              {/* Recent Runs */}
              {liveHistory.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Recent Runs</p>
                  {liveHistory.slice(0, 3).map(h => (
                    <div key={h.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-muted/10 cursor-pointer hover:bg-muted/20" onClick={() => setLiveOutput(h.output)}>
                      <span className="font-mono">{h.script_name}</span>
                      <span className="text-muted-foreground">{h.device_name}</span>
                      <Badge className={`text-[9px] ${h.status === "completed" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>{h.status}</Badge>
                      <span className="font-mono text-muted-foreground">{h.duration_ms}ms</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Live Output Console */}
            <div className="flex flex-col rounded-lg overflow-hidden border border-[#2f3348] bg-[#0d1117]">
              <div className="flex items-center justify-between px-3 py-2 bg-[#161b22] border-b border-[#2f3348]">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500/70" />
                    <div className="w-3 h-3 rounded-full bg-amber-500/70" />
                    <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
                  </div>
                  <span className="text-[11px] font-mono text-[#8b949e]">Terminal Output</span>
                  {liveRunning && <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /><span className="text-[10px] text-emerald-400">Running</span></div>}
                </div>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-[#8b949e] hover:text-white" onClick={() => setLiveOutput([])}><Trash2 className="w-3 h-3 mr-1" />Clear</Button>
              </div>
              <ScrollArea className="flex-1 p-3" data-testid="terminal-output">
                <div className="font-mono text-xs space-y-0.5">
                  {liveOutput.length === 0 && (
                    <div className="flex items-center justify-center h-full py-20">
                      <div className="text-center"><Terminal className="w-8 h-8 text-[#30363d] mx-auto mb-2" /><p className="text-[#484f58]">Select a script and click Execute to see live output</p></div>
                    </div>
                  )}
                  {liveOutput.map((line, i) => {
                    const colors = { info: "text-[#58a6ff]", success: "text-[#3fb950]", error: "text-[#f85149]", warning: "text-[#d29922]", command: "text-[#c9d1d9]", output: "text-[#8b949e]", comment: "text-[#484f58]" };
                    const prefixes = { info: "i", success: "+", error: "!", warning: "~", command: "$", output: " ", comment: "#" };
                    const lineColor = colors[line.type] || colors.output;
                    const prefix = prefixes[line.type] || " ";
                    return (
                      <div key={`term-${i}`} className={`flex items-start gap-2 ${lineColor} ${line.type === "command" && line.text === "---" ? "border-t border-[#21262d] mt-1 pt-1" : ""}`}>
                        {line.text !== "---" && (
                          <>
                            <span className="text-[#484f58] flex-shrink-0 w-14">{new Date(line.time).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                            <span className="flex-shrink-0 w-3 text-center">{prefix}</span>
                            <span className={`${line.type === "command" ? "font-semibold" : ""}`}>{line.text}</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {liveRunning && <div className="flex items-center gap-1 mt-1"><span className="text-[#3fb950] animate-pulse">_</span></div>}
                </div>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>

        {/* Library Tab */}
        <TabsContent value="library" className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Script Library</h2>
            <Badge variant="secondary">{scriptLibrary.length} templates</Badge>
            <Button size="sm" variant="outline" className="ml-auto" onClick={installTechnicianPack} data-testid="install-technician-pack"><Download className="mr-1.5 h-3.5 w-3.5" />Install technician pack</Button>
          </div>
          <p className="text-sm text-muted-foreground mb-4">Ready-to-use scripts for common MSP tasks. Install the full pack for direct terminal use, or import individual scripts to review and customise them first.</p>
          <div className="space-y-4">
            {scriptLibrary.map((template, i) => (
              <Card key={`k-${i}`} className="hover:border-primary/30 transition-all" data-testid={`library-template-${i}`}>
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
                    <p className={`text-xs mt-1 ${task.target_ids?.length ? "text-muted-foreground" : "text-amber-400"}`}>{task.target_ids?.length ? `${task.target_ids.length} target device${task.target_ids.length === 1 ? "" : "s"}` : "No target devices configured"}</p>
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
            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>Target Devices *</Label><div className="flex gap-1"><Button type="button" variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setScheduleForm(f => ({ ...f, target_ids: devices.filter(d => d.status === "online").map(d => d.id) }))}>All online</Button><Button type="button" variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setScheduleForm(f => ({ ...f, target_ids: [] }))}>Clear</Button></div></div>
              <ScrollArea className="h-[150px] rounded-lg border p-2">
                {devices.filter(d => d.status === "online").map(device => (
                  <label key={device.id} className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-muted/50">
                    <input type="checkbox" checked={scheduleForm.target_ids.includes(device.id)} onChange={(e) => setScheduleForm(f => ({ ...f, target_ids: e.target.checked ? [...f.target_ids, device.id] : f.target_ids.filter(id => id !== device.id) }))} className="rounded" />
                    <span className="flex-1 text-sm">{device.name || device.hostname}</span><span className="text-xs text-muted-foreground">{device.client_name}</span>
                  </label>
                ))}
                {devices.filter(d => d.status === "online").length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No online devices are available</p>}
              </ScrollArea>
              <p className="text-xs text-muted-foreground">{scheduleForm.target_ids.length} online device{scheduleForm.target_ids.length === 1 ? "" : "s"} selected</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsScheduleDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateSchedule} disabled={!scheduleForm.name || !scheduleForm.script_id || scheduleForm.target_ids.length === 0} data-testid="submit-schedule-btn">Create Schedule</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
