import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { 
  Plus, 
  Search, 
  Monitor, 
  Server, 
  Laptop,
  Wifi,
  WifiOff,
  AlertTriangle,
  Cpu,
  HardDrive,
  MemoryStick,
  MoreVertical,
  RefreshCw,
  Loader2,
  MessageSquare,
  ExternalLink,
  Activity
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";

const deviceIcons = {
  server: Server,
  workstation: Monitor,
  laptop: Laptop
};

const statusConfig = {
  online: { label: "Online", class: "status-online", icon: Wifi, color: "text-green-500" },
  offline: { label: "Offline", class: "status-offline", icon: WifiOff, color: "text-red-500" },
  warning: { label: "Warning", class: "status-warning", icon: AlertTriangle, color: "text-yellow-500" }
};

const DeviceCard = ({ device, onEdit, onDelete, onChat, onRemote }) => {
  const Icon = deviceIcons[device.device_type] || Monitor;
  const StatusIcon = statusConfig[device.status].icon;

  return (
    <Card className="card-hover">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              device.status === 'online' ? 'bg-green-500/10' : 
              device.status === 'warning' ? 'bg-yellow-500/10' : 'bg-red-500/10'
            }`}>
              <Icon className={`w-5 h-5 ${statusConfig[device.status].color}`} />
            </div>
            <div>
              <h3 className="font-semibold">{device.name}</h3>
              <p className="text-xs text-muted-foreground">{device.client_name}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onChat(device.id)}>
                <MessageSquare className="w-4 h-4 mr-2" />
                Device Chat
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRemote(device)}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Remote Connect
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(device)}>Edit</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => onDelete(device.id)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Status</span>
            <Badge variant="outline" className={statusConfig[device.status].class}>
              <StatusIcon className="w-3 h-3 mr-1" />
              {statusConfig[device.status].label}
            </Badge>
          </div>
          
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">OS</span>
            <span className="font-mono text-xs">{device.os}</span>
          </div>
          
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">IP Address</span>
            <span className="font-mono text-xs">{device.ip_address || "N/A"}</span>
          </div>

          <div className="pt-2 space-y-2">
            <div className="flex items-center gap-2">
              <Cpu className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground w-10">CPU</span>
              <Progress value={device.cpu_usage} className="flex-1 h-1.5" />
              <span className="text-xs font-mono w-10 text-right">{device.cpu_usage}%</span>
            </div>
            <div className="flex items-center gap-2">
              <MemoryStick className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground w-10">RAM</span>
              <Progress value={device.memory_usage} className="flex-1 h-1.5" />
              <span className="text-xs font-mono w-10 text-right">{device.memory_usage}%</span>
            </div>
            <div className="flex items-center gap-2">
              <HardDrive className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground w-10">Disk</span>
              <Progress value={device.disk_usage} className="flex-1 h-1.5" />
              <span className="text-xs font-mono w-10 text-right">{device.disk_usage}%</span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="pt-3 border-t border-border flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1 text-xs"
              onClick={() => onChat(device.id)}
              data-testid={`device-chat-btn-${device.id}`}
            >
              <MessageSquare className="w-3 h-3 mr-1" />
              Chat
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1 text-xs"
              onClick={() => onRemote(device)}
              data-testid={`device-remote-btn-${device.id}`}
            >
              <ExternalLink className="w-3 h-3 mr-1" />
              Remote
            </Button>
          </div>

          <div className="pt-2">
            <p className="text-xs text-muted-foreground">
              Last seen: {device.last_seen ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true }) : "Never"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default function DevicesPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [devices, setDevices] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    client_id: "",
    device_type: "workstation",
    os: "Windows 11",
    ip_address: "",
    serial_number: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [devicesRes, clientsRes] = await Promise.all([
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/clients`, { headers })
      ]);
      setDevices(devicesRes.data);
      setClients(clientsRes.data);
    } catch (error) {
      toast.error("Failed to fetch devices");
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
      if (selectedDevice) {
        await axios.put(`${API}/devices/${selectedDevice.id}`, formData, { headers });
        toast.success("Device updated");
      } else {
        await axios.post(`${API}/devices`, formData, { headers });
        toast.success("Device added");
      }
      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      toast.error("Failed to save device");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this device?")) return;
    try {
      await axios.delete(`${API}/devices/${id}`, { headers });
      toast.success("Device deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete device");
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      client_id: "",
      device_type: "workstation",
      os: "Windows 11",
      ip_address: "",
      serial_number: ""
    });
    setSelectedDevice(null);
  };

  const openEditDialog = (device) => {
    setSelectedDevice(device);
    setFormData({
      name: device.name,
      client_id: device.client_id,
      device_type: device.device_type,
      os: device.os,
      ip_address: device.ip_address || "",
      serial_number: device.serial_number || ""
    });
    setIsDialogOpen(true);
  };

  const handleOpenChat = (deviceId) => {
    navigate(`/devices/${deviceId}/chat`);
  };

  const handleRemoteConnect = (device) => {
    // If device has a RustDesk ID, open the remote access page with context
    // Otherwise, navigate to remote access page
    if (device.rustdesk_id) {
      toast.info(`Connect to ${device.name} using RustDesk ID: ${device.rustdesk_id}`);
    }
    navigate('/remote-access');
  };

  const filteredDevices = devices.filter(device => {
    const matchesSearch = device.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          device.client_name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || device.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: devices.length,
    online: devices.filter(d => d.status === "online").length,
    offline: devices.filter(d => d.status === "offline").length,
    warning: devices.filter(d => d.status === "warning").length
  };

  return (
    <div className="space-y-6" data-testid="devices-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Devices</h1>
          <p className="text-muted-foreground">Monitor and manage all endpoints</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="add-device-button">
                <Plus className="w-4 h-4 mr-2" />
                Add Device
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{selectedDevice ? "Edit Device" : "Add New Device"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Device Name</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., ACME-WS-001"
                    required
                    data-testid="device-name-input"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Client</Label>
                    <Select
                      value={formData.client_id}
                      onValueChange={(value) => setFormData({ ...formData, client_id: value })}
                      required
                    >
                      <SelectTrigger data-testid="device-client-select">
                        <SelectValue placeholder="Select client" />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map(client => (
                          <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select
                      value={formData.device_type}
                      onValueChange={(value) => setFormData({ ...formData, device_type: value })}
                    >
                      <SelectTrigger data-testid="device-type-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="server">Server</SelectItem>
                        <SelectItem value="workstation">Workstation</SelectItem>
                        <SelectItem value="laptop">Laptop</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Operating System</Label>
                    <Select
                      value={formData.os}
                      onValueChange={(value) => setFormData({ ...formData, os: value })}
                    >
                      <SelectTrigger data-testid="device-os-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Windows 11">Windows 11</SelectItem>
                        <SelectItem value="Windows 10">Windows 10</SelectItem>
                        <SelectItem value="Windows Server 2022">Windows Server 2022</SelectItem>
                        <SelectItem value="Windows Server 2019">Windows Server 2019</SelectItem>
                        <SelectItem value="Ubuntu 22.04">Ubuntu 22.04</SelectItem>
                        <SelectItem value="macOS Sonoma">macOS Sonoma</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>IP Address</Label>
                    <Input
                      value={formData.ip_address}
                      onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                      placeholder="192.168.1.100"
                      data-testid="device-ip-input"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Serial Number</Label>
                  <Input
                    value={formData.serial_number}
                    onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                    placeholder="Optional"
                    data-testid="device-serial-input"
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" data-testid="device-submit-button">
                    {selectedDevice ? "Update" : "Add Device"}
                  </Button>
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
              <Monitor className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Devices</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Wifi className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.online}</p>
              <p className="text-xs text-muted-foreground">Online</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.warning}</p>
              <p className="text-xs text-muted-foreground">Warning</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <WifiOff className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.offline}</p>
              <p className="text-xs text-muted-foreground">Offline</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search devices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="devices-search-input"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]" data-testid="devices-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Device Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredDevices.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDevices.map(device => (
            <DeviceCard
              key={device.id}
              device={device}
              onEdit={openEditDialog}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64">
            <Monitor className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
            <p className="text-muted-foreground">No devices found</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
