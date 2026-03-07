import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { toast } from "sonner";
import { 
  Terminal,
  Plus,
  Search,
  Play,
  Clock,
  RefreshCw,
  Loader2,
  Code,
  Cpu,
  CheckCircle,
  XCircle,
  MoreVertical,
  Copy,
  Trash2
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";

const scriptTypes = {
  powershell: { label: "PowerShell", color: "bg-blue-500" },
  bash: { label: "Bash", color: "bg-green-500" },
  python: { label: "Python", color: "bg-yellow-500" },
  batch: { label: "Batch", color: "bg-gray-500" }
};

const categories = {
  general: "General",
  maintenance: "Maintenance",
  security: "Security",
  monitoring: "Monitoring",
  remediation: "Remediation"
};

export default function ScriptingPage() {
  const { token } = useAuth();
  const [scripts, setScripts] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("scripts");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRunDialogOpen, setIsRunDialogOpen] = useState(false);
  const [selectedScript, setSelectedScript] = useState(null);
  const [selectedDevices, setSelectedDevices] = useState([]);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    script_type: "powershell",
    content: "",
    category: "general",
    os_target: "windows",
    run_as_admin: true,
    timeout_seconds: 300
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [scriptsRes, executionsRes, devicesRes] = await Promise.all([
        axios.get(`${API}/scripts`, { headers }),
        axios.get(`${API}/script-executions?limit=50`, { headers }),
        axios.get(`${API}/devices`, { headers })
      ]);
      setScripts(scriptsRes.data);
      setExecutions(executionsRes.data);
      setDevices(devicesRes.data);
    } catch (error) {
      toast.error("Failed to fetch data");
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
    } catch (error) {
      toast.error("Failed to save script");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this script?")) return;
    try {
      await axios.delete(`${API}/scripts/${id}`, { headers });
      toast.success("Script deleted");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to delete script");
    }
  };

  const handleRunScript = async () => {
    if (!selectedScript || selectedDevices.length === 0) {
      toast.error("Select at least one device");
      return;
    }
    try {
      await axios.post(`${API}/scripts/${selectedScript.id}/execute`, selectedDevices, { headers });
      toast.success(`Script queued for ${selectedDevices.length} devices`);
      setIsRunDialogOpen(false);
      setSelectedDevices([]);
      fetchData();
    } catch (error) {
      toast.error("Failed to run script");
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      script_type: "powershell",
      content: "",
      category: "general",
      os_target: "windows",
      run_as_admin: true,
      timeout_seconds: 300
    });
    setSelectedScript(null);
  };

  const openEditDialog = (script) => {
    setSelectedScript(script);
    setFormData({
      name: script.name,
      description: script.description || "",
      script_type: script.script_type,
      content: script.content,
      category: script.category,
      os_target: script.os_target,
      run_as_admin: script.run_as_admin,
      timeout_seconds: script.timeout_seconds
    });
    setIsDialogOpen(true);
  };

  const openRunDialog = (script) => {
    setSelectedScript(script);
    setSelectedDevices([]);
    setIsRunDialogOpen(true);
  };

  const filteredScripts = scripts.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6" data-testid="scripting-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scripting & Automation</h1>
          <p className="text-muted-foreground">Run scripts on managed devices</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="create-script-btn">
                <Plus className="w-4 h-4 mr-2" />
                New Script
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{selectedScript ? "Edit Script" : "Create Script"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Clear Temp Files"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(categories).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Clears temporary files to free up disk space"
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Script Type</Label>
                    <Select value={formData.script_type} onValueChange={(v) => setFormData({ ...formData, script_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(scriptTypes).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Target OS</Label>
                    <Select value={formData.os_target} onValueChange={(v) => setFormData({ ...formData, os_target: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="windows">Windows</SelectItem>
                        <SelectItem value="macos">macOS</SelectItem>
                        <SelectItem value="linux">Linux</SelectItem>
                        <SelectItem value="cross_platform">Cross Platform</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Timeout (seconds)</Label>
                    <Input
                      type="number"
                      value={formData.timeout_seconds}
                      onChange={(e) => setFormData({ ...formData, timeout_seconds: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Script Content *</Label>
                  <Textarea
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    placeholder={formData.script_type === 'powershell' 
                      ? '# PowerShell script\nGet-Process | Where-Object { $_.CPU -gt 100 }' 
                      : '#!/bin/bash\necho "Hello World"'}
                    className="font-mono text-sm min-h-[200px]"
                    required
                  />
                </div>
                <DialogFooter>
                  <Button type="submit">{selectedScript ? "Update" : "Create Script"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Code className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{scripts.length}</p>
              <p className="text-xs text-muted-foreground">Total Scripts</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{executions.filter(e => e.status === 'completed').length}</p>
              <p className="text-xs text-muted-foreground">Successful Runs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{executions.filter(e => e.status === 'failed').length}</p>
              <p className="text-xs text-muted-foreground">Failed Runs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{executions.filter(e => e.status === 'pending' || e.status === 'running').length}</p>
              <p className="text-xs text-muted-foreground">In Progress</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="scripts" className="gap-2">
            <Code className="w-4 h-4" />
            Scripts
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <Clock className="w-4 h-4" />
            Execution History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scripts" className="space-y-4">
          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search scripts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Scripts Grid */}
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredScripts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredScripts.map(script => (
                <Card key={script.id} className="card-hover">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${scriptTypes[script.script_type]?.color}/10`}>
                          <Terminal className={`w-5 h-5 ${scriptTypes[script.script_type]?.color?.replace('bg-', 'text-')}`} />
                        </div>
                        <div>
                          <h3 className="font-semibold">{script.name}</h3>
                          <p className="text-xs text-muted-foreground">{categories[script.category]}</p>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openRunDialog(script)}>
                            <Play className="w-4 h-4 mr-2" />
                            Run Script
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditDialog(script)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigator.clipboard.writeText(script.content)}>
                            <Copy className="w-4 h-4 mr-2" />
                            Copy Code
                          </DropdownMenuItem>
                          {!script.is_built_in && (
                            <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(script.id)}>
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {script.description && (
                      <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{script.description}</p>
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="outline">{scriptTypes[script.script_type]?.label}</Badge>
                      <Badge variant="outline">{script.os_target}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Runs: {script.run_count || 0}</span>
                      {script.last_run && (
                        <span>Last: {formatDistanceToNow(new Date(script.last_run), { addSuffix: true })}</span>
                      )}
                    </div>
                    <Button className="w-full mt-4" size="sm" onClick={() => openRunDialog(script)}>
                      <Play className="w-4 h-4 mr-2" />
                      Run Script
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64">
              <Terminal className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
              <p className="text-muted-foreground">No scripts found</p>
              <p className="text-sm text-muted-foreground">Create your first automation script</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="p-0">
              {executions.length > 0 ? (
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Script</TableHead>
                        <TableHead>Device</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Run By</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {executions.map(exec => (
                        <TableRow key={exec.id}>
                          <TableCell className="font-medium">{exec.script_name}</TableCell>
                          <TableCell>{exec.device_name}</TableCell>
                          <TableCell>
                            <Badge variant={exec.status === 'completed' ? 'default' : exec.status === 'failed' ? 'destructive' : 'secondary'}>
                              {exec.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{exec.duration_seconds ? `${exec.duration_seconds}s` : '-'}</TableCell>
                          <TableCell>{exec.user_name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDistanceToNow(new Date(exec.created_at), { addSuffix: true })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                <div className="flex flex-col items-center justify-center h-64">
                  <Clock className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
                  <p className="text-muted-foreground">No execution history</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Run Script Dialog */}
      <Dialog open={isRunDialogOpen} onOpenChange={setIsRunDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run Script: {selectedScript?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select Devices</Label>
              <ScrollArea className="h-[200px] border rounded-lg p-2">
                {devices.filter(d => d.status === 'online').map(device => (
                  <div key={device.id} className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded">
                    <input
                      type="checkbox"
                      id={device.id}
                      checked={selectedDevices.includes(device.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedDevices([...selectedDevices, device.id]);
                        } else {
                          setSelectedDevices(selectedDevices.filter(id => id !== device.id));
                        }
                      }}
                      className="rounded"
                    />
                    <label htmlFor={device.id} className="flex-1 cursor-pointer">
                      <span className="font-medium">{device.name}</span>
                      <span className="text-sm text-muted-foreground ml-2">{device.client_name}</span>
                    </label>
                  </div>
                ))}
              </ScrollArea>
              <p className="text-xs text-muted-foreground">{selectedDevices.length} devices selected (showing online only)</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRunDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleRunScript} disabled={selectedDevices.length === 0}>
                <Play className="w-4 h-4 mr-2" />
                Run on {selectedDevices.length} Device{selectedDevices.length !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
