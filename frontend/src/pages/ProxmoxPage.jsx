import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  Server, Plus, RefreshCw, Loader2, CheckCircle, XCircle, Play, Square,
  HardDrive, Cpu, Database, Globe, Lock, ShieldCheck, AlertTriangle, Clock
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function ProxmoxPage() {
  const { token } = useAuth();
  const [servers, setServers] = useState([]);
  const [vms, setVms] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "", host: "", port: 8006, username: "", token_name: "", token_value: "", client_id: "", node_name: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [serversRes, vmsRes, dashboardRes, clientsRes] = await Promise.all([
        axios.get(`${API}/proxmox/servers`, { headers }),
        axios.get(`${API}/proxmox/vms`, { headers }),
        axios.get(`${API}/proxmox/dashboard`, { headers }),
        axios.get(`${API}/clients`, { headers })
      ]);
      setServers(serversRes.data);
      setVms(vmsRes.data);
      setDashboard(dashboardRes.data);
      setClients(clientsRes.data);
    } catch (error) {
      toast.error("Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/proxmox/servers`, formData, { headers });
      toast.success("Proxmox server added");
      setIsDialogOpen(false);
      setFormData({ name: "", host: "", port: 8006, username: "", token_name: "", token_value: "", client_id: "", node_name: "" });
      fetchData();
    } catch (error) {
      toast.error("Failed to add server");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this server?")) return;
    try {
      await axios.delete(`${API}/proxmox/servers/${id}`, { headers });
      toast.success("Server deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete server");
    }
  };

  return (
    <div className="space-y-6" data-testid="proxmox-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Proxmox VE</h1>
          <p className="text-muted-foreground">Virtual machine & container management</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Add Server</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Proxmox Server</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="Main PVE Cluster" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Client</Label>
                    <Select value={formData.client_id} onValueChange={(v) => setFormData({...formData, client_id: v})}>
                      <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                      <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 space-y-2">
                    <Label>Host *</Label>
                    <Input value={formData.host} onChange={(e) => setFormData({...formData, host: e.target.value})} placeholder="192.168.1.100" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input type="number" value={formData.port} onChange={(e) => setFormData({...formData, port: parseInt(e.target.value)})} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Username</Label>
                    <Input value={formData.username} onChange={(e) => setFormData({...formData, username: e.target.value})} placeholder="root@pam" />
                  </div>
                  <div className="space-y-2">
                    <Label>Node Name</Label>
                    <Input value={formData.node_name} onChange={(e) => setFormData({...formData, node_name: e.target.value})} placeholder="pve" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>API Token Name</Label>
                    <Input value={formData.token_name} onChange={(e) => setFormData({...formData, token_name: e.target.value})} placeholder="monitor" />
                  </div>
                  <div className="space-y-2">
                    <Label>API Token Value</Label>
                    <Input type="password" value={formData.token_value} onChange={(e) => setFormData({...formData, token_value: e.target.value})} placeholder="xxxxxxxx-xxxx-xxxx-xxxx" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Create API token in Proxmox: Datacenter → Permissions → API Tokens</p>
                <DialogFooter><Button type="submit">Add Server</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Dashboard Stats */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><Server className="w-5 h-5 text-primary" /></div>
            <div><p className="text-2xl font-bold">{dashboard.servers.total}</p><p className="text-xs text-muted-foreground">PVE Servers</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-green-500" /></div>
            <div><p className="text-2xl font-bold">{dashboard.servers.online}</p><p className="text-xs text-muted-foreground">Online</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Play className="w-5 h-5 text-blue-500" /></div>
            <div><p className="text-2xl font-bold">{dashboard.vms.running}</p><p className="text-xs text-muted-foreground">Running VMs</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-500/10 flex items-center justify-center"><Square className="w-5 h-5 text-gray-500" /></div>
            <div><p className="text-2xl font-bold">{dashboard.vms.stopped}</p><p className="text-xs text-muted-foreground">Stopped VMs</p></div>
          </CardContent></Card>
        </div>
      )}

      {/* Servers List */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Proxmox Servers</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin" /></div>
          ) : servers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Server</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Check</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map(server => (
                  <TableRow key={server.id}>
                    <TableCell className="font-medium">{server.name}</TableCell>
                    <TableCell className="font-mono text-sm">{server.host}:{server.port}</TableCell>
                    <TableCell>{server.client_name || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={server.status === 'online' ? 'default' : 'secondary'}>
                        {server.status === 'online' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                        {server.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {server.last_check ? formatDistanceToNow(new Date(server.last_check), { addSuffix: true }) : 'Never'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(server.id)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center h-48">
              <Server className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
              <p className="text-muted-foreground">No Proxmox servers configured</p>
              <p className="text-sm text-muted-foreground">Add a server to start monitoring VMs</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* VMs List */}
      {vms.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Virtual Machines</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>VM Name</TableHead>
                    <TableHead>VMID</TableHead>
                    <TableHead>Node</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>CPU</TableHead>
                    <TableHead>Memory</TableHead>
                    <TableHead>Uptime</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vms.map(vm => (
                    <TableRow key={vm.id}>
                      <TableCell className="font-medium">{vm.name}</TableCell>
                      <TableCell>{vm.vmid}</TableCell>
                      <TableCell>{vm.node}</TableCell>
                      <TableCell>
                        <Badge variant={vm.status === 'running' ? 'default' : 'secondary'}>
                          {vm.status === 'running' ? <Play className="w-3 h-3 mr-1" /> : <Square className="w-3 h-3 mr-1" />}
                          {vm.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{vm.cpu_usage?.toFixed(1)}%</TableCell>
                      <TableCell>{vm.memory_usage?.toFixed(1)}%</TableCell>
                      <TableCell>{vm.uptime ? `${Math.floor(vm.uptime / 3600)}h` : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
