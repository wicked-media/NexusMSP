import { useState, useEffect, useCallback, useMemo } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SetupGuideCallout from "@/components/SetupGuideCallout";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import { toast } from "sonner";
import { 
  Network,
  Server,
  Monitor,
  Wifi,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Settings,
  Activity,
  Router
} from "lucide-react";

const statusColors = {
  ONLINE: "text-green-500",
  OFFLINE: "text-red-500",
  UNKNOWN: "text-yellow-500"
};

export default function DomotzPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [status, setStatus] = useState({ configured: false });
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentDevices, setAgentDevices] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [credentials, setCredentials] = useState({ api_key: "", api_url: "https://api-us-east-1-cell-1.domotz.com/public-api/v1" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const statusRes = await axios.get(`${API}/domotz/status`, { headers });
      setStatus(statusRes.data);

      if (statusRes.data.configured) {
        try {
          const [agentsRes, alertsRes] = await Promise.all([
            axios.get(`${API}/domotz/agents`, { headers }),
            axios.get(`${API}/domotz/alerts`, { headers })
          ]);
          setAgents(Array.isArray(agentsRes.data) ? agentsRes.data : []);
          setAlerts(Array.isArray(alertsRes.data) ? alertsRes.data : []);
        } catch (e) {
          toast.error("Domotz is connected, but monitoring data could not be retrieved");
        }
      }
    } catch (error) {
      setLoadError(true);
      toast.error("Unable to load Domotz connection status");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  const fetchAgentDevices = useCallback(async (agentId) => {
    setLoadingDevices(true);
    try {
      const response = await axios.get(`${API}/domotz/agents/${agentId}/devices`, { headers });
      setAgentDevices(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      toast.error("Failed to fetch devices");
    } finally {
      setLoadingDevices(false);
    }
  }, [headers]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (selectedAgent) {
      fetchAgentDevices(selectedAgent.id);
    }
  }, [selectedAgent, fetchAgentDevices]);

  const saveCredentials = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/domotz/settings`, credentials, { headers });
      toast.success("Domotz credentials saved");
      setIsSettingsOpen(false);
      
      const testRes = await axios.get(`${API}/domotz/test-connection`, { headers });
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

  return (
    <div className="p-6 space-y-5" data-testid="domotz-page">
      <OperationalPageHeader
        eyebrow="Network monitoring"
        title="Domotz"
        description="Monitor external network agents, discovered devices, and provider alerts across managed customer sites."
        icon={Network}
        tone="sky"
        actions={<>
          <Badge variant="outline" className={status.configured ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}>{status.configured ? "Connected" : "Configuration required"}</Badge>
          <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="domotz-connection-btn"><Settings className="mr-1.5 h-3.5 w-3.5" />Connection</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Domotz API Credentials</DialogTitle>
              </DialogHeader>
              <form onSubmit={saveCredentials} className="space-y-4">
                <SetupGuideCallout title="Get a Domotz API key" source="Sign in to the Domotz Portal, open Settings → API Keys, and create a dedicated NexusMSP key in the correct regional tenant." steps={["Select the Domotz API region that hosts the customer sites.", "Create a dedicated API key rather than reusing a personal technician key.", "Save the key in Keeper, then confirm the connection before relying on monitoring data."]} securityNote="Treat the Domotz API key as a credential. Keep the source record in Keeper, enter it directly into this integration setting only when required, and revoke it in Domotz if access is no longer required." />
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    value={credentials.api_key}
                    onChange={(e) => setCredentials({ ...credentials, api_key: e.target.value })}
                    placeholder="Your Domotz API Key"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>API URL</Label>
                  <Select
                    value={credentials.api_url}
                    onValueChange={(value) => setCredentials({ ...credentials, api_url: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="https://api-us-east-1-cell-1.domotz.com/public-api/v1">US East 1</SelectItem>
                      <SelectItem value="https://api-eu-west-1-cell-1.domotz.com/public-api/v1">EU West 1</SelectItem>
                      <SelectItem value="https://api-ap-southeast-2-cell-1.domotz.com/public-api/v1">AP Southeast 2</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Get your API key from Domotz Portal: Settings → API Keys
                </p>
                <DialogFooter>
                  <Button type="submit">Save & Connect</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} data-testid="domotz-refresh-btn"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroTile label="Agents" value={loading ? "—" : agents.length} icon={Router} glow="cyan" subtitle="Connected monitoring agents" testId="domotz-metric-agents" />
        <HeroTile label="Online" value={loading ? "—" : agents.filter(agent => agent.status?.value === "ONLINE").length} icon={Wifi} glow="emerald" subtitle="Agents reporting online" testId="domotz-metric-online" />
        <HeroTile label="Selected devices" value={loading ? "—" : agentDevices.length} icon={Monitor} glow="sky" subtitle={selectedAgent ? (selectedAgent.display_name || selectedAgent.name) : "Choose an agent to inspect"} testId="domotz-metric-devices" />
        <HeroTile label="Alerts" value={loading ? "—" : alerts.length} icon={AlertTriangle} glow={alerts.length > 0 ? "amber" : "violet"} subtitle={alerts.length > 0 ? "Require review" : "No active provider alerts"} testId="domotz-metric-alerts" />
      </div>

      {loadError && <Card className="border-amber-500/30 bg-amber-500/5"><CardContent className="flex items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium text-amber-100">Domotz status is unavailable</p><p className="mt-1 text-xs text-muted-foreground">Check the connection or retry the request.</p></div><Button variant="outline" size="sm" onClick={fetchData}>Try again</Button></CardContent></Card>}

      {!status.configured ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64">
            <Network className="w-16 h-16 text-muted-foreground opacity-50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Connect to Domotz</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Connect your Domotz account to view network monitoring data, device status, and alerts directly in NexusMSP.
            </p>
            <Button onClick={() => setIsSettingsOpen(true)}>
              <Network className="w-4 h-4 mr-2" />
              Add Domotz Credentials
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Agents List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Network Agents</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[400px]">
                  {loading ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : agents.length > 0 ? (
                    <div className="space-y-1 p-4">
                      {agents.map(agent => (
                        <div
                          key={agent.id}
                          onClick={() => setSelectedAgent(agent)}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                            selectedAgent?.id === agent.id ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted/50'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full ${
                            agent.status?.value === 'ONLINE' ? 'bg-green-500' : 'bg-red-500'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{agent.display_name || agent.name}</p>
                            <p className="text-xs text-muted-foreground">{agent.access_right?.api_enabled ? 'API Enabled' : ''}</p>
                          </div>
                          <Badge variant="outline" className={statusColors[agent.status?.value] || ''}>
                            {agent.status?.value || 'Unknown'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Router className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>No agents found</p>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Devices List */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">
                  {selectedAgent ? `Devices - ${selectedAgent.display_name || selectedAgent.name}` : 'Select an Agent'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[400px]">
                  {loadingDevices ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : selectedAgent && agentDevices.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Device</TableHead>
                          <TableHead>IP Address</TableHead>
                          <TableHead>MAC</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agentDevices.map(device => (
                          <TableRow key={device.id} className="table-row-hover">
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Monitor className="w-4 h-4 text-muted-foreground" />
                                <div>
                                  <p className="font-medium">{device.display_name || device.hw_address}</p>
                                  <p className="text-xs text-muted-foreground">{device.vendor || 'Unknown vendor'}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-sm">{device.ip_addresses?.[0] || 'N/A'}</TableCell>
                            <TableCell className="font-mono text-xs">{device.hw_address || 'N/A'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={device.status === 'ONLINE' ? 'text-green-500' : 'text-red-500'}>
                                {device.status || 'Unknown'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Monitor className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>{selectedAgent ? 'No devices found' : 'Select an agent to view devices'}</p>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Alerts */}
          {alerts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-500" />
                  Active Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {alerts.slice(0, 5).map((alert, idx) => (
                    <div key={`k-${idx}`} className="flex items-center gap-3 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                      <AlertTriangle className="w-4 h-4 text-yellow-500" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{alert.message || alert.name}</p>
                        <p className="text-xs text-muted-foreground">{alert.device_name || 'System alert'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
