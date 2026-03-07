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
import { toast } from "sonner";
import { 
  Link,
  Unlink,
  RefreshCw,
  Check,
  X,
  Loader2,
  Cloud,
  Building2
} from "lucide-react";

export default function Pax8Page() {
  const { token } = useAuth();
  const [status, setStatus] = useState({ configured: false });
  const [clients, setClients] = useState([]);
  const [pax8Companies, setPax8Companies] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [credentials, setCredentials] = useState({ client_id: "", client_secret: "" });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statusRes, clientsRes] = await Promise.all([
        axios.get(`${API}/pax8/status`, { headers }),
        axios.get(`${API}/clients`, { headers })
      ]);
      setStatus(statusRes.data);
      setClients(clientsRes.data);

      if (statusRes.data.configured) {
        try {
          const companiesRes = await axios.get(`${API}/pax8/companies`, { headers });
          setPax8Companies(companiesRes.data.content || []);
        } catch (e) {
          console.log("Could not fetch Pax8 companies");
        }
      }
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
      await axios.post(`${API}/pax8/settings`, credentials, { headers });
      toast.success("Pax8 credentials saved");
      setIsSettingsOpen(false);
      
      // Test connection
      const testRes = await axios.get(`${API}/pax8/test-connection`, { headers });
      if (testRes.data.success) {
        toast.success("Successfully connected to Pax8!");
        fetchData();
      } else {
        toast.error(testRes.data.message || "Connection test failed");
      }
    } catch (error) {
      toast.error("Failed to save credentials");
    }
  };

  const linkClient = async (clientId, pax8CompanyId) => {
    try {
      await axios.post(`${API}/pax8/link-client/${clientId}?pax8_company_id=${pax8CompanyId}`, {}, { headers });
      toast.success("Client linked to Pax8");
      setIsLinkDialogOpen(false);
      fetchData();
    } catch (error) {
      toast.error("Failed to link client");
    }
  };

  const syncSubscriptions = async (clientId) => {
    setSyncing(true);
    try {
      const res = await axios.post(`${API}/pax8/sync-subscriptions/${clientId}`, {}, { headers });
      toast.success(res.data.message);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to sync subscriptions");
    } finally {
      setSyncing(false);
    }
  };

  const linkedClients = clients.filter(c => c.pax8_company_id);
  const unlinkedClients = clients.filter(c => !c.pax8_company_id);

  return (
    <div className="space-y-6" data-testid="pax8-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pax8 Integration</h1>
          <p className="text-muted-foreground">Sync subscriptions and manage cloud billing</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant={status.configured ? "outline" : "default"}>
                <Cloud className="w-4 h-4 mr-2" />
                {status.configured ? "Update Credentials" : "Connect Pax8"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Pax8 API Credentials</DialogTitle>
              </DialogHeader>
              <form onSubmit={saveCredentials} className="space-y-4">
                <div className="space-y-2">
                  <Label>Client ID</Label>
                  <Input
                    value={credentials.client_id}
                    onChange={(e) => setCredentials({ ...credentials, client_id: e.target.value })}
                    placeholder="Your Pax8 Client ID"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Client Secret</Label>
                  <Input
                    type="password"
                    value={credentials.client_secret}
                    onChange={(e) => setCredentials({ ...credentials, client_secret: e.target.value })}
                    placeholder="Your Pax8 Client Secret"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Get your API credentials from Pax8: Settings → Integrations → API Keys
                </p>
                <DialogFooter>
                  <Button type="submit">Save & Connect</Button>
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
                <Cloud className={`w-6 h-6 ${status.configured ? 'text-green-500' : 'text-yellow-500'}`} />
              </div>
              <div>
                <h3 className="font-semibold">Connection Status</h3>
                <p className="text-sm text-muted-foreground">
                  {status.configured ? 'Connected to Pax8 API' : 'Not configured - Add your credentials to get started'}
                </p>
              </div>
            </div>
            <Badge variant={status.configured ? "default" : "secondary"}>
              {status.configured ? (
                <><Check className="w-3 h-3 mr-1" /> Connected</>
              ) : (
                <><X className="w-3 h-3 mr-1" /> Not Connected</>
              )}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {!status.configured ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64">
            <Cloud className="w-16 h-16 text-muted-foreground opacity-50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Connect to Pax8</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Connect your Pax8 account to sync subscriptions, view products, and automate billing for your clients.
            </p>
            <Button onClick={() => setIsSettingsOpen(true)}>
              <Cloud className="w-4 h-4 mr-2" />
              Add Pax8 Credentials
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Link className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{linkedClients.length}</p>
                  <p className="text-xs text-muted-foreground">Linked Clients</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                  <Unlink className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{unlinkedClients.length}</p>
                  <p className="text-xs text-muted-foreground">Unlinked Clients</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{pax8Companies.length}</p>
                  <p className="text-xs text-muted-foreground">Pax8 Companies</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Link Dialog */}
          <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Link Client to Pax8 Company</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Select a Pax8 company to link with <strong>{selectedClient?.name}</strong>
                </p>
                <Select onValueChange={(value) => linkClient(selectedClient?.id, value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Pax8 Company" />
                  </SelectTrigger>
                  <SelectContent>
                    {pax8Companies.map(company => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </DialogContent>
          </Dialog>

          {/* Clients Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Client Mappings</CardTitle>
              <CardDescription>Link your clients to Pax8 companies to sync subscriptions</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Client</TableHead>
                        <TableHead>Pax8 Company</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clients.map(client => (
                        <TableRow key={client.id} className="table-row-hover">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Building2 className="w-4 h-4 text-primary" />
                              </div>
                              <div>
                                <p className="font-medium">{client.name}</p>
                                <p className="text-xs text-muted-foreground">{client.email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {client.pax8_company_id ? (
                              <span className="font-mono text-xs">{client.pax8_company_id.substring(0, 12)}...</span>
                            ) : (
                              <span className="text-muted-foreground">Not linked</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={client.pax8_company_id ? "default" : "secondary"}>
                              {client.pax8_company_id ? "Linked" : "Unlinked"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {client.pax8_company_id ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => syncSubscriptions(client.id)}
                                  disabled={syncing}
                                >
                                  {syncing ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <><RefreshCw className="w-4 h-4 mr-1" /> Sync</>
                                  )}
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setSelectedClient(client);
                                    setIsLinkDialogOpen(true);
                                  }}
                                >
                                  <Link className="w-4 h-4 mr-1" /> Link
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
