import { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API, useAuth } from "@/App";
import DOMPurify from "dompurify";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  Mail,
  Send,
  Inbox,
  Settings,
  Plus,
  Search,
  RefreshCw,
  Check,
  X,
  Loader2,
  Paperclip,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  MoreHorizontal,
  ChevronDown
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const statusConfig = {
  draft: { label: "Draft", color: "bg-gray-500" },
  sent: { label: "Sent", color: "bg-green-500" },
  failed: { label: "Failed", color: "bg-red-500" },
  received: { label: "Received", color: "bg-blue-500" }
};

export default function EmailPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedClientId = searchParams.get("client");
  const shouldComposeForClient = searchParams.get("compose") === "1";
  const [status, setStatus] = useState({ configured: false });
  const [emails, setEmails] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [credentials, setCredentials] = useState({ tenant_id: "", client_id: "", client_secret: "" });
  const [composeData, setComposeData] = useState({
    to_addresses: "",
    cc_addresses: "",
    subject: "",
    body: "",
    client_id: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statusRes, emailsRes, clientsRes] = await Promise.all([
        axios.get(`${API}/office365/status`, { headers }),
        axios.get(`${API}/emails`, { headers }),
        axios.get(`${API}/clients`, { headers })
      ]);
      setStatus(statusRes.data);
      setEmails(emailsRes.data);
      setClients(clientsRes.data);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!shouldComposeForClient || !requestedClientId || clients.length === 0) return;
    const client = clients.find(item => item.id === requestedClientId);
    if (!client) return;
    setComposeData(current => ({
      ...current,
      client_id: client.id,
      to_addresses: current.to_addresses || client.email || "",
    }));
    setIsComposeOpen(true);
    setSearchParams({}, { replace: true });
  }, [clients, requestedClientId, setSearchParams, shouldComposeForClient]);

  const saveCredentials = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/office365/settings`, credentials, { headers });
      toast.success("Office 365 credentials saved");
      setIsSettingsOpen(false);
      
      const testRes = await axios.get(`${API}/office365/test-connection`, { headers });
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

  const handleCompose = async (e) => {
    e.preventDefault();
    try {
      const toList = composeData.to_addresses.split(',').map(e => e.trim()).filter(Boolean);
      const ccList = composeData.cc_addresses.split(',').map(e => e.trim()).filter(Boolean);
      
      const emailRes = await axios.post(`${API}/emails`, {
        to_addresses: toList,
        cc_addresses: ccList,
        subject: composeData.subject,
        body: composeData.body,
        body_type: "html",
        client_id: composeData.client_id || null
      }, { headers });
      
      toast.success("Email draft created");
      setIsComposeOpen(false);
      setComposeData({ to_addresses: "", cc_addresses: "", subject: "", body: "", client_id: "" });
      fetchData();
    } catch (error) {
      toast.error("Failed to create email");
    }
  };

  const handleSend = async (emailId) => {
    try {
      await axios.post(`${API}/emails/${emailId}/send`, {}, { headers });
      toast.success("Email sent successfully");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to send email");
    }
  };

  const filteredEmails = emails.filter(email => {
    if (activeTab === "all") return true;
    if (activeTab === "inbox") return email.direction === "inbound";
    if (activeTab === "sent") return email.direction === "outbound" && email.status === "sent";
    if (activeTab === "drafts") return email.status === "draft";
    return true;
  });

  return (
    <div className="space-y-6" data-testid="email-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center"><Mail className="w-4 h-4 text-sky-300" /></span>
          <div><h1 className="text-2xl font-bold tracking-tight">Email</h1><p className="text-sm text-muted-foreground">Technician mail, client communication, and delivery tracking.</p></div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => { window.location.href = "/settings?tab=mailbox"; }} data-testid="email-intake-link"><Inbox className="w-4 h-4 mr-2" />Email Intake</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="communications-workspace-tools">
                <MoreHorizontal className="w-3.5 h-3.5" />
                Workspace
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => navigate("/notify-channels")}><Send className="mr-2 h-4 w-4" />Slack & Teams webhooks</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/csat-surveys")}><Check className="mr-2 h-4 w-4" />CSAT surveys</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/nps-tracker")}><ArrowUpRight className="mr-2 h-4 w-4" />NPS tracker</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant={status.configured ? "outline" : "default"}>
                <Settings className="w-4 h-4 mr-2" />
                {status.configured ? "Update Settings" : "Connect Office 365"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Office 365 Configuration</DialogTitle>
              </DialogHeader>
              <form onSubmit={saveCredentials} className="space-y-4">
                <div className="space-y-2">
                  <Label>Tenant ID</Label>
                  <Input
                    value={credentials.tenant_id}
                    onChange={(e) => setCredentials({ ...credentials, tenant_id: e.target.value })}
                    placeholder="Your Azure AD Tenant ID"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Client ID (Application ID)</Label>
                  <Input
                    value={credentials.client_id}
                    onChange={(e) => setCredentials({ ...credentials, client_id: e.target.value })}
                    placeholder="Azure App Registration Client ID"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Client Secret</Label>
                  <Input
                    type="password"
                    value={credentials.client_secret}
                    onChange={(e) => setCredentials({ ...credentials, client_secret: e.target.value })}
                    placeholder="Azure App Registration Secret"
                    required
                  />
                </div>
                <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                  <p className="font-medium mb-1">Setup Instructions:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Go to Azure Portal → Azure Active Directory</li>
                    <li>Create new App Registration</li>
                    <li>Add API permissions: Mail.Send, Mail.Read</li>
                    <li>Create a client secret</li>
                    <li>Copy the values above</li>
                  </ol>
                </div>
                <DialogFooter>
                  <Button type="submit">Save & Connect</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={isComposeOpen} onOpenChange={setIsComposeOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Compose
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Compose Email</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCompose} className="space-y-4">
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input
                    value={composeData.to_addresses}
                    onChange={(e) => setComposeData({ ...composeData, to_addresses: e.target.value })}
                    placeholder="email@example.com (comma separated)"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>CC</Label>
                  <Input
                    value={composeData.cc_addresses}
                    onChange={(e) => setComposeData({ ...composeData, cc_addresses: e.target.value })}
                    placeholder="cc@example.com (optional)"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Link to Client (Optional)</Label>
                  <Select value={composeData.client_id} onValueChange={(v) => setComposeData({ ...composeData, client_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>
                      {clients.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Input
                    value={composeData.subject}
                    onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })}
                    placeholder="Email subject"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Body</Label>
                  <Textarea
                    value={composeData.body}
                    onChange={(e) => setComposeData({ ...composeData, body: e.target.value })}
                    placeholder="Type your message..."
                    rows={8}
                    required
                  />
                </div>
                <DialogFooter>
                  <Button type="submit">Save Draft</Button>
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
                <Mail className={`w-6 h-6 ${status.configured ? 'text-green-500' : 'text-yellow-500'}`} />
              </div>
              <div>
                <h3 className="font-semibold">Office 365 Status</h3>
                <p className="text-sm text-muted-foreground">
                  {status.configured ? 'Connected to Microsoft Graph API' : 'Not configured - emails saved locally'}
                </p>
              </div>
            </div>
            <Badge variant={status.configured ? "default" : "secondary"}>
              {status.configured ? <><Check className="w-3 h-3 mr-1" /> Connected</> : <><X className="w-3 h-3 mr-1" /> Local Mode</>}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Email List */}
      <Card>
        <CardHeader className="pb-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="all" className="gap-2">
                <Mail className="w-4 h-4" />
                All
              </TabsTrigger>
              <TabsTrigger value="inbox" className="gap-2">
                <ArrowDownLeft className="w-4 h-4" />
                Inbox
              </TabsTrigger>
              <TabsTrigger value="sent" className="gap-2">
                <ArrowUpRight className="w-4 h-4" />
                Sent
              </TabsTrigger>
              <TabsTrigger value="drafts" className="gap-2">
                <Clock className="w-4 h-4" />
                Drafts
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-0 pt-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredEmails.length > 0 ? (
            <ScrollArea className="h-[500px]">
              <div className="divide-y">
                {filteredEmails.map(email => (
                  <div
                    key={email.id}
                    className="flex items-start gap-4 p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedEmail(email)}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      email.direction === 'inbound' ? 'bg-blue-500/10' : 'bg-primary/10'
                    }`}>
                      {email.direction === 'inbound' ? (
                        <ArrowDownLeft className="w-5 h-5 text-blue-500" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium truncate">{email.subject || '(No subject)'}</p>
                        <Badge className={`${statusConfig[email.status]?.color} text-white text-xs`}>
                          {statusConfig[email.status]?.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {email.direction === 'inbound' ? `From: ${email.from_address}` : `To: ${email.to_addresses?.join(', ')}`}
                      </p>
                      {email.client_name && (
                        <p className="text-xs text-muted-foreground mt-1">Client: {email.client_name}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(email.created_at), { addSuffix: true })}
                      </p>
                      {email.status === 'draft' && (
                        <Button size="sm" onClick={(e) => { e.stopPropagation(); handleSend(email.id); }}>
                          <Send className="w-3 h-3 mr-1" />
                          Send
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex flex-col items-center justify-center h-64">
              <Inbox className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
              <p className="text-muted-foreground">No emails found</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email Detail Dialog */}
      <Dialog open={!!selectedEmail} onOpenChange={() => setSelectedEmail(null)}>
        <DialogContent className="max-w-2xl">
          {selectedEmail && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedEmail.subject || '(No subject)'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <p><strong>From:</strong> {selectedEmail.from_name || selectedEmail.from_address}</p>
                    <p><strong>To:</strong> {selectedEmail.to_addresses?.join(', ')}</p>
                    {selectedEmail.cc_addresses?.length > 0 && (
                      <p><strong>CC:</strong> {selectedEmail.cc_addresses.join(', ')}</p>
                    )}
                  </div>
                  <Badge className={`${statusConfig[selectedEmail.status]?.color} text-white`}>
                    {statusConfig[selectedEmail.status]?.label}
                  </Badge>
                </div>
                <div className="border rounded-lg p-4 bg-muted/30 min-h-[200px]">
                  <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedEmail.body) }} />
                </div>
                {selectedEmail.status === 'draft' && (
                  <DialogFooter>
                    <Button onClick={() => { handleSend(selectedEmail.id); setSelectedEmail(null); }}>
                      <Send className="w-4 h-4 mr-2" />
                      Send Email
                    </Button>
                  </DialogFooter>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
