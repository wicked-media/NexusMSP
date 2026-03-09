import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, PhoneIncoming, PhoneOutgoing,
  Settings, Wifi, WifiOff, Clock, Users, Activity, ArrowUpRight, ArrowDownLeft,
  ArrowLeftRight, Loader2, CheckCircle, XCircle, Circle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const statusColors = {
  available: "bg-green-500",
  on_call: "bg-blue-500",
  away: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-gray-500",
};

const statusLabels = {
  available: "Available",
  on_call: "On Call",
  away: "Away",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

function formatDuration(seconds) {
  if (!seconds) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function YeastarPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const [extensions, setExtensions] = useState([]);
  const [activeCalls, setActiveCalls] = useState([]);
  const [callLogs, setCallLogs] = useState([]);
  const [systemInfo, setSystemInfo] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({ pbx_url: "", client_id: "", client_secret: "" });
  const [configured, setConfigured] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [dashRes, extRes, callRes, logRes, sysRes, statusRes] = await Promise.all([
        axios.get(`${API}/yeastar/dashboard`, { headers }),
        axios.get(`${API}/yeastar/extensions`, { headers }),
        axios.get(`${API}/yeastar/active-calls`, { headers }),
        axios.get(`${API}/yeastar/call-logs`, { headers }),
        axios.get(`${API}/yeastar/system-info`, { headers }),
        axios.get(`${API}/yeastar/status`, { headers }),
      ]);
      setDashboard(dashRes.data);
      setExtensions(extRes.data);
      setActiveCalls(callRes.data);
      setCallLogs(logRes.data.data || []);
      setSystemInfo(sysRes.data);
      setConfigured(statusRes.data.configured);
    } catch (error) {
      toast.error("Failed to fetch Yeastar data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSaveSettings = async () => {
    try {
      await axios.post(`${API}/yeastar/settings`, settings, { headers });
      toast.success("Yeastar settings saved");
      setIsSettingsOpen(false);
      fetchData();
    } catch (error) {
      toast.error("Failed to save settings");
    }
  };

  const handleTestConnection = async () => {
    try {
      const res = await axios.get(`${API}/yeastar/test-connection`, { headers });
      if (res.data.success) toast.success(res.data.message);
      else toast.error(res.data.message);
    } catch (error) {
      toast.error("Connection test failed");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="yeastar-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Yeastar PBX</h1>
          <p className="text-muted-foreground">Phone system management and call monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={configured ? "default" : "secondary"} className={configured ? "bg-green-600" : ""}>
            {configured ? "Connected" : "Not Configured"}
          </Badge>
          <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm"><Settings className="w-4 h-4 mr-2" />Settings</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Yeastar PBX Settings</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>PBX URL</Label>
                  <Input value={settings.pbx_url} onChange={(e) => setSettings({...settings, pbx_url: e.target.value})} placeholder="https://your-pbx.example.com" />
                </div>
                <div className="space-y-2">
                  <Label>Client ID</Label>
                  <Input value={settings.client_id} onChange={(e) => setSettings({...settings, client_id: e.target.value})} placeholder="API Client ID" />
                </div>
                <div className="space-y-2">
                  <Label>Client Secret</Label>
                  <Input type="password" value={settings.client_secret} onChange={(e) => setSettings({...settings, client_secret: e.target.value})} placeholder="API Client Secret" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Find these in your Yeastar PBX under Integrations &gt; API settings.
                  Requires firmware 84.7.0.17 or later.
                </p>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={handleTestConnection}>Test Connection</Button>
                  <Button onClick={handleSaveSettings}>Save Settings</Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Dashboard Stats */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Extensions Online</p>
                  <p className="text-2xl font-bold">{dashboard.online_extensions}/{dashboard.total_extensions}</p>
                </div>
                <Users className="w-8 h-8 text-emerald-500 opacity-70" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Calls</p>
                  <p className="text-2xl font-bold">{dashboard.active_calls}</p>
                </div>
                <PhoneCall className="w-8 h-8 text-blue-500 opacity-70" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Calls Today</p>
                  <p className="text-2xl font-bold">{dashboard.calls_today}</p>
                </div>
                <Phone className="w-8 h-8 text-indigo-500 opacity-70" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Missed Today</p>
                  <p className="text-2xl font-bold">{dashboard.missed_calls_today}</p>
                </div>
                <PhoneMissed className="w-8 h-8 text-red-500 opacity-70" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="extensions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="extensions">Extensions</TabsTrigger>
          <TabsTrigger value="active-calls">Active Calls</TabsTrigger>
          <TabsTrigger value="call-logs">Call Logs</TabsTrigger>
          <TabsTrigger value="system">System Info</TabsTrigger>
        </TabsList>

        {/* Extensions Tab */}
        <TabsContent value="extensions">
          <Card>
            <CardHeader><CardTitle>Extensions</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Extension</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Registered</TableHead>
                    <TableHead>IP Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {extensions.map((ext) => (
                    <TableRow key={ext.id} data-testid={`ext-row-${ext.number}`}>
                      <TableCell className="font-mono font-medium">{ext.number}</TableCell>
                      <TableCell>{ext.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${statusColors[ext.status] || "bg-gray-500"}`} />
                          <span className="text-sm">{statusLabels[ext.status] || ext.status}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{ext.device}</TableCell>
                      <TableCell>
                        {ext.registered ? (
                          <Wifi className="w-4 h-4 text-green-500" />
                        ) : (
                          <WifiOff className="w-4 h-4 text-red-500" />
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono">{ext.ip || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Active Calls Tab */}
        <TabsContent value="active-calls">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Active Calls</CardTitle>
                <Button variant="outline" size="sm" onClick={fetchData}><Activity className="w-4 h-4 mr-2" />Refresh</Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {activeCalls.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Direction</TableHead>
                      <TableHead>Caller</TableHead>
                      <TableHead>Callee</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Started</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeCalls.map((call) => (
                      <TableRow key={call.call_id} data-testid={`call-row-${call.call_id}`}>
                        <TableCell>
                          {call.direction === "inbound" && <ArrowDownLeft className="w-4 h-4 text-green-500" />}
                          {call.direction === "outbound" && <ArrowUpRight className="w-4 h-4 text-blue-500" />}
                          {call.direction === "internal" && <ArrowLeftRight className="w-4 h-4 text-indigo-500" />}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{call.caller_name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{call.caller}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{call.callee_name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{call.callee}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={call.status === "answered" ? "text-green-500 border-green-500/30" : "text-yellow-500 border-yellow-500/30"}>
                            {call.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{formatDuration(call.duration)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(call.started_at), { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center justify-center h-40">
                  <PhoneOff className="w-10 h-10 text-muted-foreground opacity-50 mb-3" />
                  <p className="text-muted-foreground">No active calls</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Call Logs Tab */}
        <TabsContent value="call-logs">
          <Card>
            <CardHeader><CardTitle>Call History</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Direction</TableHead>
                    <TableHead>Caller</TableHead>
                    <TableHead>Callee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Talk Time</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {callLogs.map((log) => (
                    <TableRow key={log.id} data-testid={`log-row-${log.id}`}>
                      <TableCell>
                        {log.direction === "inbound" && <PhoneIncoming className="w-4 h-4 text-green-500" />}
                        {log.direction === "outbound" && <PhoneOutgoing className="w-4 h-4 text-blue-500" />}
                        {log.direction === "internal" && <ArrowLeftRight className="w-4 h-4 text-indigo-500" />}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{log.caller_name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{log.caller}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{log.callee_name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{log.callee}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={log.status === "answered" ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}>
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{formatDuration(log.duration)}</TableCell>
                      <TableCell className="font-mono text-sm">{formatDuration(log.talking_time)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Info Tab */}
        <TabsContent value="system">
          {systemInfo && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-lg">PBX Information</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Hostname</span><span className="font-mono">{systemInfo.hostname}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Firmware</span><span className="font-mono">{systemInfo.firmware_version}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Uptime</span><span>{systemInfo.uptime}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Max Concurrent Calls</span><span>{systemInfo.max_concurrent_calls}</span></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-lg">Capacity</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Extensions</span><span className="font-bold">{systemInfo.total_extensions}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Trunks</span><span className="font-bold">{systemInfo.total_trunks}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Active Calls</span><span className="font-bold text-blue-500">{systemInfo.active_calls}</span></div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {!configured && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Settings className="w-5 h-5 text-yellow-500 mt-0.5" />
              <div>
                <p className="font-medium">Yeastar PBX Not Configured</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Data shown is demo data. Configure your Yeastar P-Series PBX credentials in Settings to connect to your real phone system.
                  You'll need your PBX URL, Client ID, and Client Secret from Integrations &gt; API in your PBX admin panel.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
