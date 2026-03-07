import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  Download,
  Monitor,
  Apple,
  Settings,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  Play,
  Clock,
  User,
  Laptop
} from "lucide-react";

const platformIcons = {
  windows: Monitor,
  macos: Apple,
  linux: Laptop
};

export default function RemoteAccessPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState({ configured: false });
  const [settings, setSettings] = useState({});
  const [agents, setAgents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [credentials, setCredentials] = useState({ server_url: "", api_key: "", relay_server: "" });
  const [copiedId, setCopiedId] = useState(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statusRes, agentsRes, sessionsRes, settingsRes] = await Promise.all([
        axios.get(`${API}/remote/status`, { headers }),
        axios.get(`${API}/remote/agents`, { headers }),
        axios.get(`${API}/remote/sessions`, { headers }),
        axios.get(`${API}/remote/settings`, { headers }).catch(() => ({ data: { configured: false } }))
      ]);
      setStatus(statusRes.data);
      setAgents(agentsRes.data);
      setSessions(sessionsRes.data);
      setSettings(settingsRes.data);
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
      await axios.post(`${API}/remote/settings`, credentials, { headers });
      toast.success("RustDesk settings saved");
      setIsSettingsOpen(false);
      fetchData();
    } catch (error) {
      toast.error("Failed to save settings");
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Copied to clipboard");
  };

  const groupedAgents = {
    windows: agents.filter(a => a.platform === 'windows'),
    macos: agents.filter(a => a.platform === 'macos'),
    linux: agents.filter(a => a.platform === 'linux')
  };

  return (
    <div className="space-y-6" data-testid="remote-access-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Remote Access</h1>
          <p className="text-muted-foreground">Download agents and manage remote sessions</p>
        </div>
        <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <Settings className="w-4 h-4 mr-2" />
              Server Settings
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>RustDesk Server Configuration</DialogTitle>
            </DialogHeader>
            <form onSubmit={saveCredentials} className="space-y-4">
              <div className="space-y-2">
                <Label>ID/Rendezvous Server URL</Label>
                <Input
                  value={credentials.server_url}
                  onChange={(e) => setCredentials({ ...credentials, server_url: e.target.value })}
                  placeholder="rustdesk.yourcompany.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Relay Server (Optional)</Label>
                <Input
                  value={credentials.relay_server}
                  onChange={(e) => setCredentials({ ...credentials, relay_server: e.target.value })}
                  placeholder="relay.yourcompany.com"
                />
              </div>
              <div className="space-y-2">
                <Label>API Key (Optional)</Label>
                <Input
                  type="password"
                  value={credentials.api_key}
                  onChange={(e) => setCredentials({ ...credentials, api_key: e.target.value })}
                  placeholder="For RustDesk Pro"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Configure your self-hosted RustDesk server. Leave blank to use public servers.
              </p>
              <DialogFooter>
                <Button type="submit">Save Configuration</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Server Info */}
      {settings.configured && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Check className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="font-medium">Self-Hosted Server Configured</p>
                  <p className="text-sm text-muted-foreground">{settings.server_url}</p>
                </div>
              </div>
              <Badge variant="default">Connected</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent Downloads */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Download className="w-5 h-5" />
            Download Remote Agent
          </CardTitle>
          <CardDescription>
            Install the NexusOps remote agent on client devices to enable remote access
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="windows">
            <TabsList className="mb-4">
              <TabsTrigger value="windows" className="gap-2">
                <Monitor className="w-4 h-4" />
                Windows
              </TabsTrigger>
              <TabsTrigger value="macos" className="gap-2">
                <Apple className="w-4 h-4" />
                macOS
              </TabsTrigger>
              <TabsTrigger value="linux" className="gap-2">
                <Laptop className="w-4 h-4" />
                Linux
              </TabsTrigger>
            </TabsList>

            {Object.entries(groupedAgents).map(([platform, platformAgents]) => (
              <TabsContent key={platform} value={platform}>
                <div className="grid gap-4">
                  {platformAgents.map(agent => (
                    <div key={agent.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                          {platform === 'windows' && <Monitor className="w-6 h-6 text-primary" />}
                          {platform === 'macos' && <Apple className="w-6 h-6 text-primary" />}
                          {platform === 'linux' && <Laptop className="w-6 h-6 text-primary" />}
                        </div>
                        <div>
                          <p className="font-medium">{agent.name}</p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>v{agent.version}</span>
                            <span>•</span>
                            <span>{agent.arch}</span>
                            <span>•</span>
                            <span>{agent.size}</span>
                          </div>
                        </div>
                      </div>
                      <Button asChild>
                        <a href={agent.download_url} target="_blank" rel="noopener noreferrer">
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>

                {platformAgents.length > 0 && (
                  <div className="mt-6 p-4 bg-muted/50 rounded-lg">
                    <h4 className="font-medium mb-2">Installation Instructions</h4>
                    <pre className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {platformAgents[0].instructions}
                    </pre>
                    {settings.server_url && (
                      <div className="mt-4 p-3 bg-background rounded border">
                        <p className="text-sm font-medium mb-2">Your Server Configuration:</p>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded flex-1">{settings.server_url}</code>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyToClipboard(settings.server_url, 'server')}
                          >
                            {copiedId === 'server' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Recent Sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Recent Remote Sessions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : sessions.length > 0 ? (
            <ScrollArea className="h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map(session => (
                    <TableRow key={session.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{session.device_name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{session.rustdesk_id || 'N/A'}</p>
                        </div>
                      </TableCell>
                      <TableCell>{session.user_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{session.session_type.replace('_', ' ')}</Badge>
                      </TableCell>
                      <TableCell>{session.duration_minutes || 0} min</TableCell>
                      <TableCell>
                        <Badge variant={session.status === 'active' ? 'default' : 'secondary'}>
                          {session.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Monitor className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No remote sessions yet</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Start Guide */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Start Guide</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-primary">1</span>
              </div>
              <div>
                <p className="font-medium">Download Agent</p>
                <p className="text-sm text-muted-foreground">Download and install the agent on the client device</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-primary">2</span>
              </div>
              <div>
                <p className="font-medium">Note the ID</p>
                <p className="text-sm text-muted-foreground">Record the RustDesk ID shown in the agent</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-primary">3</span>
              </div>
              <div>
                <p className="font-medium">Connect</p>
                <p className="text-sm text-muted-foreground">Use the ID to connect from your RustDesk client</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
