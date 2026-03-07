import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { 
  Shield,
  Plus,
  Search,
  Settings,
  RefreshCw,
  Check,
  X,
  Loader2,
  HardDrive,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Cloud
} from "lucide-react";

const backupStatusConfig = {
  success: { label: "Success", icon: CheckCircle, color: "text-green-500", bg: "bg-green-500/10" },
  warning: { label: "Warning", icon: AlertTriangle, color: "text-yellow-500", bg: "bg-yellow-500/10" },
  failed: { label: "Failed", icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
  unknown: { label: "Unknown", icon: Cloud, color: "text-gray-500", bg: "bg-gray-500/10" }
};

export default function AcronisPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState({ configured: false });
  const [subscriptions, setSubscriptions] = useState([]);
  const [clients, setClients] = useState([]);
  const [devices, setDevices] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [credentials, setCredentials] = useState({ api_url: "https://cloud.acronis.com", client_id: "", client_secret: "" });
  const [formData, setFormData] = useState({
    client_id: "",
    device_id: "",
    product_name: "Acronis Cyber Protect",
    edition: "Standard",
    status: "active",
    license_type: "per_device",
    quantity: 1,
    storage_quota_gb: 100,
    expiry_date: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statusRes, subsRes, clientsRes, devicesRes, dashboardRes] = await Promise.all([
        axios.get(`${API}/acronis/status`, { headers }),
        axios.get(`${API}/acronis/subscriptions`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/acronis/dashboard`, { headers })
      ]);
      setStatus(statusRes.data);
      setSubscriptions(subsRes.data);
      setClients(clientsRes.data);
      setDevices(devicesRes.data);
      setDashboardStats(dashboardRes.data);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const saveCredentials = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/acronis/settings`, credentials, { headers });
      toast.success("Acronis credentials saved");
      setIsSettingsOpen(false);
      
      const testRes = await axios.get(`${API}/acronis/test-connection`, { headers });
      if (testRes.data.success) {
        toast.success(testRes.data.message);
        fetchData();
      } else {
        toast.error(testRes.data.message || "Connection test failed");
      }
    } catch (error) {
      toast.error("Failed to save credentials");
    }
  };

  const handleAddSubscription = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/acronis/subscriptions`, formData, { headers });
      toast.success("Subscription added");
      setIsAddOpen(false);
      setFormData({
        client_id: "",
        device_id: "",
        product_name: "Acronis Cyber Protect",
        edition: "Standard",
        status: "active",
        license_type: "per_device",
        quantity: 1,
        storage_quota_gb: 100,
        expiry_date: ""
      });
      fetchData();
    } catch (error) {
      toast.error("Failed to add subscription");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this subscription?")) return;
    try {
      await axios.delete(`${API}/acronis/subscriptions/${id}`, { headers });
      toast.success("Subscription deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete subscription");
    }
  };

  return (
    <div className="space-y-6" data-testid="acronis-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Acronis Cyber Protect</h1>
          <p className="text-muted-foreground">Backup & cybersecurity management</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant={status.configured ? "outline" : "default"}>
                <Settings className="w-4 h-4 mr-2" />
                {status.configured ? "Update Credentials" : "Connect Acronis"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Acronis API Credentials</DialogTitle>
              </DialogHeader>
              <form onSubmit={saveCredentials} className="space-y-4">
                <div className="space-y-2">
                  <Label>API URL</Label>
                  <Select
                    value={credentials.api_url}
                    onValueChange={(v) => setCredentials({ ...credentials, api_url: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="https://cloud.acronis.com">US (cloud.acronis.com)</SelectItem>
                      <SelectItem value="https://eu-cloud.acronis.com">EU (eu-cloud.acronis.com)</SelectItem>
                      <SelectItem value="https://au-cloud.acronis.com">AU (au-cloud.acronis.com)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Client ID</Label>
                  <Input
                    value={credentials.client_id}
                    onChange={(e) => setCredentials({ ...credentials, client_id: e.target.value })}
                    placeholder="Your Acronis Client ID"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Client Secret</Label>
                  <Input
                    type="password"
                    value={credentials.client_secret}
                    onChange={(e) => setCredentials({ ...credentials, client_secret: e.target.value })}
                    placeholder="Your Acronis Client Secret"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Create API credentials in Acronis Management Portal: Settings → API clients
                </p>
                <DialogFooter>
                  <Button type="submit">Save & Connect</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Subscription
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Acronis Subscription</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddSubscription} className="space-y-4">
                <div className="space-y-2">
                  <Label>Client</Label>
                  <Select value={formData.client_id} onValueChange={(v) => setFormData({ ...formData, client_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>
                      {clients.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Device (Optional)</Label>
                  <Select value={formData.device_id} onValueChange={(v) => setFormData({ ...formData, device_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select device" /></SelectTrigger>
                    <SelectContent>
                      {devices.filter(d => !formData.client_id || d.client_id === formData.client_id).map(d => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Product</Label>
                    <Select value={formData.product_name} onValueChange={(v) => setFormData({ ...formData, product_name: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Acronis Cyber Protect">Cyber Protect</SelectItem>
                        <SelectItem value="Acronis Cyber Backup">Cyber Backup</SelectItem>
                        <SelectItem value="Acronis Cyber Protect Cloud">CP Cloud</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Edition</Label>
                    <Select value={formData.edition} onValueChange={(v) => setFormData({ ...formData, edition: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Essentials">Essentials</SelectItem>
                        <SelectItem value="Standard">Standard</SelectItem>
                        <SelectItem value="Advanced">Advanced</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Storage Quota (GB)</Label>
                    <Input
                      type="number"
                      value={formData.storage_quota_gb}
                      onChange={(e) => setFormData({ ...formData, storage_quota_gb: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Expiry Date</Label>
                    <Input
                      type="date"
                      value={formData.expiry_date}
                      onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit">Add Subscription</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Status Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                status.configured ? 'bg-green-500/10' : 'bg-yellow-500/10'
              }`}>
                <Shield className={`w-6 h-6 ${status.configured ? 'text-green-500' : 'text-yellow-500'}`} />
              </div>
              <div>
                <h3 className="font-semibold">Connection Status</h3>
                <p className="text-sm text-muted-foreground">
                  {status.configured ? 'Connected to Acronis' : 'Not configured - add subscriptions manually'}
                </p>
              </div>
            </div>
            <Badge variant={status.configured ? "default" : "secondary"}>
              {status.configured ? <><Check className="w-3 h-3 mr-1" /> Connected</> : <><X className="w-3 h-3 mr-1" /> Manual Mode</>}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {dashboardStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dashboardStats.total_subscriptions}</p>
                <p className="text-xs text-muted-foreground">Total Subscriptions</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dashboardStats.backup_status.success}</p>
                <p className="text-xs text-muted-foreground">Backups OK</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dashboardStats.backup_status.warning}</p>
                <p className="text-xs text-muted-foreground">Warnings</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <XCircle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dashboardStats.backup_status.failed}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Subscriptions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Acronis Subscriptions</CardTitle>
          <CardDescription>View and manage client backup subscriptions</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : subscriptions.length > 0 ? (
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client / Device</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Storage</TableHead>
                    <TableHead>Backup Status</TableHead>
                    <TableHead>Subscription</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map(sub => {
                    const backupConfig = backupStatusConfig[sub.backup_status] || backupStatusConfig.unknown;
                    const BackupIcon = backupConfig.icon;
                    const storagePercent = sub.storage_quota_gb ? (sub.storage_used_gb || 0) / sub.storage_quota_gb * 100 : 0;
                    
                    return (
                      <TableRow key={sub.id} className="table-row-hover">
                        <TableCell>
                          <div>
                            <p className="font-medium">{sub.client_name}</p>
                            {sub.device_name && (
                              <p className="text-xs text-muted-foreground">{sub.device_name}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm">{sub.product_name}</p>
                            <p className="text-xs text-muted-foreground">{sub.edition}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="w-32">
                            <div className="flex justify-between text-xs mb-1">
                              <span>{sub.storage_used_gb || 0} GB</span>
                              <span>{sub.storage_quota_gb || 0} GB</span>
                            </div>
                            <Progress value={storagePercent} className="h-1.5" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`${backupConfig.color} ${backupConfig.bg}`}>
                            <BackupIcon className="w-3 h-3 mr-1" />
                            {backupConfig.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={sub.status === 'active' ? 'default' : 'secondary'}>
                            {sub.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(sub.id)}>
                            <X className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <div className="flex flex-col items-center justify-center h-64">
              <Shield className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
              <p className="text-muted-foreground">No subscriptions found</p>
              <p className="text-sm text-muted-foreground">Add subscriptions to track Acronis licenses</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
