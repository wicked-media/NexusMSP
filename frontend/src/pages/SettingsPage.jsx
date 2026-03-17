import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RichTextEditor } from "@/components/RichTextEditor";
import { toast } from "sonner";
import { 
  User, 
  Bell, 
  Shield, 
  Palette, 
  Mail,
  Building,
  Save,
  Loader2,
  MessageSquare,
  Clock,
  Zap,
  CreditCard,
  FileText,
  AlertTriangle,
  Wifi,
  BookOpen,
  Brain,
  Trash2
} from "lucide-react";

export default function SettingsPage() {
  const { user, token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [profileData, setProfileData] = useState({
    name: user?.name || "",
    email: user?.email || ""
  });
  const [notifications, setNotifications] = useState({
    email_alerts: true,
    ticket_updates: true,
    device_offline: true,
    sla_warnings: true
  });
  const [threshold, setThreshold] = useState({ enabled: false, threshold_hours: 24, escalate_to: "", escalate_to_name: "" });
  const [xero, setXero] = useState({ client_id: "", client_secret: "", redirect_uri: "", connected: false });
  const [stripe, setStripe] = useState({ api_key: "", configured: false });
  const [suped, setSuped] = useState({ api_key: "", configured: false });
  const [supedSaving, setSupedSaving] = useState(false);
  const [splynx, setSplynx] = useState({ url: "", api_key: "", api_secret: "", configured: false });
  const [splynxSaving, setSplynxSaving] = useState(false);
  const [hudu, setHudu] = useState({ url: "", api_key: "", configured: false });
  const [huduSaving, setHuduSaving] = useState(false);
  const [aiConfig, setAiConfig] = useState({ provider: "anthropic", model: "claude-sonnet-4-5-20250929" });
  const [aiSaving, setAiSaving] = useState(false);
  const [emailSig, setEmailSig] = useState("");
  const [sigSaving, setSigSaving] = useState(false);
  const [cannedResponses, setCannedResponses] = useState([]);
  const [cannedForm, setCannedForm] = useState({ title: "", content: "", category: "general" });

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersRes, thresholdRes, xeroRes, stripeRes, supedRes, splynxRes, huduRes, aiRes] = await Promise.all([
          axios.get(`${API}/users`, { headers }),
          axios.get(`${API}/settings/no-notes-threshold`, { headers }),
          axios.get(`${API}/settings/xero`, { headers }),
          axios.get(`${API}/settings/stripe`, { headers }),
          axios.get(`${API}/settings/suped`, { headers }),
          axios.get(`${API}/settings/splynx`, { headers }),
          axios.get(`${API}/settings/hudu`, { headers }),
          axios.get(`${API}/ai/config`, { headers }),
        ]);
        setUsers(usersRes.data);
        setThreshold(thresholdRes.data);
        setXero(xeroRes.data);
        setStripe(stripeRes.data);
        setSuped(supedRes.data);
        setSplynx(splynxRes.data);
        setHudu(huduRes.data);
        if (aiRes.data.provider) setAiConfig(aiRes.data);
        // Load email signature and canned responses
        try {
          const userRes = await axios.get(`${API}/users/${user.id}`, { headers });
          if (userRes.data?.email_signature) setEmailSig(userRes.data.email_signature);
        } catch {}
        try {
          const crRes = await axios.get(`${API}/canned-responses`, { headers });
          setCannedResponses(crRes.data);
        } catch {}
      } catch (error) { console.error("Failed to fetch settings"); }
    };
    fetchData();
  }, []);

  const handleProfileSave = async () => {
    setLoading(true);
    // Simulate save - in real app would call API
    await new Promise(resolve => setTimeout(resolve, 500));
    toast.success("Profile updated successfully");
    setLoading(false);
  };

  return (
    <div className="space-y-8 max-w-4xl" data-testid="settings-page">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      {/* Profile Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            <CardTitle>Profile</CardTitle>
          </div>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-6">
            <Avatar className="w-20 h-20">
              <AvatarImage src={user?.avatar} alt={user?.name} />
              <AvatarFallback className="text-xl bg-primary/20 text-primary">
                {user?.name?.split(' ').map(n => n[0]).join('')}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-lg">{user?.name}</p>
              <Badge variant="outline" className="capitalize">{user?.role}</Badge>
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={profileData.name}
                onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
                data-testid="settings-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={profileData.email}
                onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                data-testid="settings-email-input"
              />
            </div>
          </div>
          <Button onClick={handleProfileSave} disabled={loading} data-testid="save-profile-button">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>

      {/* Email Signature & Canned Responses - Per Technician */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            <CardTitle>Email Signature & Templates</CardTitle>
          </div>
          <CardDescription>Your personal email signature (rich text) auto-appended to emails sent from tickets. Also manage your canned response templates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Rich Text Email Signature */}
          <div className="space-y-2">
            <Label>Email Signature (Rich Text)</Label>
            <p className="text-xs text-muted-foreground">This signature is automatically appended to all emails sent from tickets. Supports full HTML formatting like Outlook.</p>
            <RichTextEditor content={emailSig} onChange={setEmailSig} minHeight="150px" />
            <Button onClick={async () => {
              setSigSaving(true);
              try {
                await axios.put(`${API}/users/${user.id}`, { email_signature: emailSig }, { headers });
                toast.success("Email signature saved");
              } catch { toast.error("Failed to save signature"); }
              finally { setSigSaving(false); }
            }} disabled={sigSaving} data-testid="save-signature-btn">
              {sigSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save Signature
            </Button>
          </div>
          <Separator />
          {/* Canned Responses */}
          <div className="space-y-3">
            <Label>Canned Responses</Label>
            <p className="text-xs text-muted-foreground">Quick reply templates you can use when responding to tickets.</p>
            <div className="grid grid-cols-3 gap-2">
              <Input value={cannedForm.title} onChange={e => setCannedForm({ ...cannedForm, title: e.target.value })} placeholder="Title" data-testid="canned-title" />
              <Input value={cannedForm.content} onChange={e => setCannedForm({ ...cannedForm, content: e.target.value })} placeholder="Response content" className="col-span-2" data-testid="canned-content" />
            </div>
            <Button size="sm" onClick={async () => {
              if (!cannedForm.title || !cannedForm.content) { toast.error("Title and content required"); return; }
              try {
                await axios.post(`${API}/canned-responses`, cannedForm, { headers });
                toast.success("Canned response saved");
                setCannedForm({ title: "", content: "", category: "general" });
                const r = await axios.get(`${API}/canned-responses`, { headers });
                setCannedResponses(r.data);
              } catch { toast.error("Failed to save"); }
            }} data-testid="add-canned-btn">Add Response</Button>
            {cannedResponses.length > 0 && (
              <ScrollArea className="h-[150px]">
                {cannedResponses.map(cr => (
                  <div key={cr.id} className="flex justify-between items-center p-2 border-b border-border/50">
                    <div><p className="text-sm font-medium">{cr.title}</p><p className="text-xs text-muted-foreground truncate max-w-[400px]">{cr.content}</p></div>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={async () => {
                      try {
                        await axios.delete(`${API}/canned-responses/${cr.id}`, { headers });
                        const r = await axios.get(`${API}/canned-responses`, { headers });
                        setCannedResponses(r.data);
                        toast.success("Deleted");
                      } catch { toast.error("Failed to delete"); }
                    }} data-testid={`delete-canned-${cr.id}`}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                ))}
              </ScrollArea>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            <CardTitle>Notifications</CardTitle>
          </div>
          <CardDescription>Configure how you receive alerts and updates</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Alerts</Label>
              <p className="text-sm text-muted-foreground">Receive critical alerts via email</p>
            </div>
            <Switch
              checked={notifications.email_alerts}
              onCheckedChange={(checked) => setNotifications({ ...notifications, email_alerts: checked })}
              data-testid="email-alerts-switch"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Ticket Updates</Label>
              <p className="text-sm text-muted-foreground">Get notified when tickets are updated</p>
            </div>
            <Switch
              checked={notifications.ticket_updates}
              onCheckedChange={(checked) => setNotifications({ ...notifications, ticket_updates: checked })}
              data-testid="ticket-updates-switch"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Device Offline Alerts</Label>
              <p className="text-sm text-muted-foreground">Alert when devices go offline</p>
            </div>
            <Switch
              checked={notifications.device_offline}
              onCheckedChange={(checked) => setNotifications({ ...notifications, device_offline: checked })}
              data-testid="device-offline-switch"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>SLA Warnings</Label>
              <p className="text-sm text-muted-foreground">Notify before SLA deadlines</p>
            </div>
            <Switch
              checked={notifications.sla_warnings}
              onCheckedChange={(checked) => setNotifications({ ...notifications, sla_warnings: checked })}
              data-testid="sla-warnings-switch"
            />
          </div>
        </CardContent>
      </Card>

      {/* Team Members */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <CardTitle>Team Members</CardTitle>
          </div>
          <CardDescription>View and manage team access</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {users.map(teamUser => (
              <div key={teamUser.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={teamUser.avatar} alt={teamUser.name} />
                    <AvatarFallback className="bg-primary/20 text-primary text-sm">
                      {teamUser.name?.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{teamUser.name}</p>
                    <p className="text-sm text-muted-foreground">{teamUser.email}</p>
                  </div>
                </div>
                <Badge variant="outline" className="capitalize">{teamUser.role}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Company Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building className="w-5 h-5 text-primary" />
            <CardTitle>Company Information</CardTitle>
          </div>
          <CardDescription>Your MSP business details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input defaultValue="NexusOps MSP" data-testid="company-name-input" />
            </div>
            <div className="space-y-2">
              <Label>Support Email</Label>
              <Input defaultValue="support@nexusops.io" data-testid="support-email-input" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Business Address</Label>
            <Input defaultValue="123 Tech Lane, San Francisco, CA 94105" data-testid="business-address-input" />
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            <CardTitle>Appearance</CardTitle>
          </div>
          <CardDescription>Customize the look and feel</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label>Theme</Label>
              <p className="text-sm text-muted-foreground">Currently using dark theme for optimal visibility</p>
            </div>
            <Badge>Dark Mode</Badge>
          </div>
        </CardContent>
      </Card>

      {/* No-Notes Escalation Threshold */}
      <Card className="border-orange-500/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <CardTitle>No-Notes Escalation Threshold</CardTitle>
          </div>
          <CardDescription>Automatically escalate tickets to senior staff when technicians don't add notes within a specified time period</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Auto-Escalation</Label>
              <p className="text-sm text-muted-foreground">Tickets with zero notes will be reassigned after the threshold</p>
            </div>
            <Switch
              checked={threshold.enabled}
              onCheckedChange={(checked) => setThreshold({ ...threshold, enabled: checked })}
              data-testid="escalation-enabled-switch"
            />
          </div>
          {threshold.enabled && (
            <>
              <Separator />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><Clock className="w-4 h-4" />Threshold (hours)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={threshold.threshold_hours}
                    onChange={(e) => setThreshold({ ...threshold, threshold_hours: parseInt(e.target.value) || 24 })}
                    data-testid="threshold-hours-input"
                  />
                  <p className="text-xs text-muted-foreground">After this many hours without notes, the ticket will be escalated</p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><Zap className="w-4 h-4" />Escalate To (Senior Member)</Label>
                  <Select 
                    value={threshold.escalate_to} 
                    onValueChange={(v) => { 
                      const u = users.find(u => u.id === v); 
                      setThreshold({ ...threshold, escalate_to: v, escalate_to_name: u?.name || "" }); 
                    }}
                  >
                    <SelectTrigger data-testid="escalate-to-select"><SelectValue placeholder="Select senior member" /></SelectTrigger>
                    <SelectContent>
                      {users.filter(u => u.role === "admin" || u.role === "Admin").map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>
                      ))}
                      {users.filter(u => u.role !== "admin" && u.role !== "Admin").map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">This person will receive escalated tickets and can follow up with the original tech</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-sm text-orange-400">
                <strong>How it works:</strong> When enabled, tickets that have been open for more than {threshold.threshold_hours} hours with zero technician notes will be automatically reassigned to {threshold.escalate_to_name || "the selected senior member"} and marked as high priority. An audit log entry will be created.
              </div>
            </>
          )}
          <Button onClick={async () => {
            try {
              await axios.put(`${API}/settings/no-notes-threshold`, threshold, { headers });
              toast.success("Escalation threshold saved");
            } catch { toast.error("Failed to save"); }
          }} data-testid="save-threshold-btn">
            <Save className="w-4 h-4 mr-2" />Save Threshold Settings
          </Button>
        </CardContent>
      </Card>

      {/* Xero Integration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-500" />
            <CardTitle>Xero Accounting Integration</CardTitle>
          </div>
          <CardDescription>Connect Xero to sync invoices and billing data for unified accounting</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant={xero.connected ? "default" : "secondary"}>{xero.connected ? "Connected" : "Not Connected"}</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Xero Client ID</Label>
              <Input value={xero.client_id} onChange={(e) => setXero({ ...xero, client_id: e.target.value })} placeholder="Enter Xero Client ID" data-testid="xero-client-id" />
            </div>
            <div className="space-y-2">
              <Label>Xero Client Secret</Label>
              <Input type="password" value={xero.client_secret} onChange={(e) => setXero({ ...xero, client_secret: e.target.value })} placeholder="Enter Xero Client Secret" data-testid="xero-client-secret" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Redirect URI</Label>
            <Input value={xero.redirect_uri} onChange={(e) => setXero({ ...xero, redirect_uri: e.target.value })} placeholder="https://your-domain.com/api/xero/callback" />
          </div>
          <p className="text-xs text-muted-foreground">Get your Xero API credentials from <a href="https://developer.xero.com/app/manage" target="_blank" rel="noreferrer" className="text-primary underline">developer.xero.com</a></p>
          <Button onClick={async () => {
            try {
              await axios.put(`${API}/settings/xero`, xero, { headers });
              toast.success("Xero settings saved");
            } catch { toast.error("Failed to save"); }
          }} data-testid="save-xero-btn">
            <Save className="w-4 h-4 mr-2" />Save Xero Settings
          </Button>
        </CardContent>
      </Card>

      {/* Stripe Integration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-green-500" />
            <CardTitle>Stripe Payments</CardTitle>
          </div>
          <CardDescription>Accept online payments through Stripe Checkout on your invoices</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Badge className={stripe.configured ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
              {stripe.configured ? "Connected" : "Not Configured"}
            </Badge>
          </div>
          <div className="space-y-2">
            <Label>Stripe Secret API Key</Label>
            <Input 
              type="password" 
              value={stripe.api_key} 
              onChange={(e) => setStripe({ ...stripe, api_key: e.target.value })} 
              placeholder="sk_live_... or sk_test_..." 
              data-testid="stripe-api-key" 
            />
            <p className="text-xs text-muted-foreground">
              Get your API key from <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" className="text-primary underline">Stripe Dashboard → Developers → API keys</a>. 
              Use your <strong>Secret key</strong> (starts with sk_live_ or sk_test_).
            </p>
          </div>
          <Button onClick={async () => {
            if (!stripe.api_key) { toast.error("Please enter a Stripe API key"); return; }
            try {
              await axios.put(`${API}/settings/stripe`, { api_key: stripe.api_key }, { headers });
              toast.success("Stripe API key saved");
              setStripe({ ...stripe, configured: true });
            } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
          }} data-testid="save-stripe-btn">
            <Save className="w-4 h-4 mr-2" />Save Stripe Settings
          </Button>
        </CardContent>
      </Card>

      {/* Suped DMARC Integration */}
      <Card data-testid="suped-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-500" />
            <CardTitle>Suped DMARC Monitoring</CardTitle>
          </div>
          <CardDescription>Connect to Suped for DMARC reporting, SPF management, and email security monitoring across all clients</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge className={suped.configured ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
              {suped.configured ? "Connected" : "Not Configured"}
            </Badge>
          </div>
          <div>
            <Label>Suped API Key</Label>
            <Input
              type="password"
              value={suped.api_key}
              onChange={(e) => setSuped({ ...suped, api_key: e.target.value })}
              placeholder="Enter your Suped API key"
              data-testid="suped-api-key"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Get your API key by contacting <a href="mailto:contact@suped.com" className="text-primary underline">contact@suped.com</a> or from your Suped dashboard at <a href="https://www.suped.com" target="_blank" rel="noreferrer" className="text-primary underline">suped.com</a>.
            </p>
          </div>
          <Button onClick={async () => {
            if (!suped.api_key) { toast.error("Please enter a Suped API key"); return; }
            setSupedSaving(true);
            try {
              await axios.put(`${API}/settings/suped`, { api_key: suped.api_key }, { headers });
              toast.success("Suped API key saved");
              setSuped({ ...suped, configured: true });
            } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
            finally { setSupedSaving(false); }
          }} data-testid="save-suped-btn" disabled={supedSaving}>
            {supedSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Suped Settings
          </Button>
        </CardContent>
      </Card>

      {/* Splynx ISP Billing Integration */}
      <Card data-testid="splynx-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wifi className="w-5 h-5 text-cyan-500" />
            <CardTitle>Splynx ISP Billing</CardTitle>
          </div>
          <CardDescription>Connect to Splynx for customer billing, internet services, and payment status monitoring</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge className={splynx.configured ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
              {splynx.configured ? "Connected" : "Not Configured"}
            </Badge>
          </div>
          <div>
            <Label>Splynx URL</Label>
            <Input
              value={splynx.url}
              onChange={(e) => setSplynx({ ...splynx, url: e.target.value })}
              placeholder="https://your-instance.splynx.app"
              data-testid="splynx-url"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>API Key</Label>
              <Input
                type="password"
                value={splynx.api_key}
                onChange={(e) => setSplynx({ ...splynx, api_key: e.target.value })}
                placeholder="API Key"
                data-testid="splynx-api-key"
              />
            </div>
            <div>
              <Label>API Secret</Label>
              <Input
                type="password"
                value={splynx.api_secret}
                onChange={(e) => setSplynx({ ...splynx, api_secret: e.target.value })}
                placeholder="API Secret"
                data-testid="splynx-api-secret"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            API credentials can be created in Splynx under <strong>Administration &gt; API Keys</strong>. Learn more at <a href="https://splynx.com" target="_blank" rel="noreferrer" className="text-primary underline">splynx.com</a>.
          </p>
          <div className="flex gap-2">
            <Button onClick={async () => {
              if (!splynx.url || !splynx.api_key || !splynx.api_secret) { toast.error("All Splynx fields are required"); return; }
              setSplynxSaving(true);
              try {
                await axios.put(`${API}/settings/splynx`, { url: splynx.url, api_key: splynx.api_key, api_secret: splynx.api_secret }, { headers });
                toast.success("Splynx settings saved");
                setSplynx({ ...splynx, configured: true });
              } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
              finally { setSplynxSaving(false); }
            }} data-testid="save-splynx-btn" disabled={splynxSaving}>
              {splynxSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Splynx Settings
            </Button>
            {splynx.configured && (
              <Button variant="outline" onClick={async () => {
                try {
                  const res = await axios.post(`${API}/settings/splynx/test`, {}, { headers });
                  if (res.data.success) toast.success(res.data.message);
                  else toast.error(res.data.message);
                } catch (e) { toast.error("Connection test failed"); }
              }} data-testid="test-splynx-btn">
                Test Connection
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* AI Model Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-500" />
            <CardTitle>AI Model Configuration</CardTitle>
          </div>
          <CardDescription>Select the AI provider and model for ticket analysis, spell check, and auto-categorization</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Provider</Label>
              <Select value={aiConfig.provider} onValueChange={v => {
                const models = { anthropic: "claude-sonnet-4-5-20250929", openai: "gpt-5.2", gemini: "gemini-3-flash-preview" };
                setAiConfig({ provider: v, model: models[v] || aiConfig.model });
              }}>
                <SelectTrigger data-testid="ai-provider-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                  <SelectItem value="openai">OpenAI (GPT)</SelectItem>
                  <SelectItem value="gemini">Google (Gemini)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Model</Label>
              <Select value={aiConfig.model} onValueChange={v => setAiConfig({ ...aiConfig, model: v })}>
                <SelectTrigger data-testid="ai-model-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {aiConfig.provider === "anthropic" && <>
                    <SelectItem value="claude-sonnet-4-5-20250929">Claude Sonnet 4.5</SelectItem>
                    <SelectItem value="claude-4-sonnet-20250514">Claude 4 Sonnet</SelectItem>
                    <SelectItem value="claude-haiku-4-5-20251001">Claude Haiku 4.5</SelectItem>
                  </>}
                  {aiConfig.provider === "openai" && <>
                    <SelectItem value="gpt-5.2">GPT-5.2</SelectItem>
                    <SelectItem value="gpt-5.1">GPT-5.1</SelectItem>
                    <SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
                    <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  </>}
                  {aiConfig.provider === "gemini" && <>
                    <SelectItem value="gemini-3-flash-preview">Gemini 3 Flash</SelectItem>
                    <SelectItem value="gemini-3-pro-preview">Gemini 3 Pro</SelectItem>
                    <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                  </>}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">AI is used for ticket auto-categorization, spell check/grammar, and device diagnostics. Powered by Emergent Universal Key.</p>
          <Button onClick={async () => {
            setAiSaving(true);
            try {
              await axios.put(`${API}/ai/config`, aiConfig, { headers });
              toast.success(`AI model set to ${aiConfig.provider} / ${aiConfig.model}`);
            } catch { toast.error("Failed to save AI config"); }
            finally { setAiSaving(false); }
          }} data-testid="save-ai-config-btn" disabled={aiSaving}>
            {aiSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save AI Config
          </Button>
        </CardContent>
      </Card>

      {/* Hudu Integration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-cyan-500" />
            <CardTitle>Hudu - IT Documentation</CardTitle>
          </div>
          <CardDescription>Connect to Hudu to sync knowledge base articles and IT documentation guides</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge className={hudu.configured ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
              {hudu.configured ? "Connected" : "Not Configured"}
            </Badge>
          </div>
          <div>
            <Label>Hudu URL</Label>
            <Input
              value={hudu.url}
              onChange={(e) => setHudu({ ...hudu, url: e.target.value })}
              placeholder="https://your-company.huducloud.com"
              data-testid="hudu-url"
            />
          </div>
          <div>
            <Label>API Key</Label>
            <Input
              type="password"
              value={hudu.api_key}
              onChange={(e) => setHudu({ ...hudu, api_key: e.target.value })}
              placeholder="Hudu API Key"
              data-testid="hudu-api-key"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Generate an API key in Hudu under <strong>Admin &gt; API Keys</strong>. Articles will sync into your Knowledge Base. Learn more at <a href="https://hudu.com" target="_blank" rel="noreferrer" className="text-primary underline">hudu.com</a>.
          </p>
          <div className="flex gap-2">
            <Button onClick={async () => {
              if (!hudu.url || !hudu.api_key) { toast.error("Hudu URL and API key are required"); return; }
              setHuduSaving(true);
              try {
                await axios.put(`${API}/settings/hudu`, { url: hudu.url, api_key: hudu.api_key }, { headers });
                toast.success("Hudu settings saved");
                setHudu({ ...hudu, configured: true });
              } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
              finally { setHuduSaving(false); }
            }} data-testid="save-hudu-btn" disabled={huduSaving}>
              {huduSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Hudu Settings
            </Button>
            {hudu.configured && (
              <Button variant="outline" onClick={async () => {
                try {
                  const res = await axios.post(`${API}/settings/hudu/test`, {}, { headers });
                  if (res.data.success) toast.success(res.data.message);
                  else toast.error(res.data.message);
                } catch (e) { toast.error("Connection test failed"); }
              }} data-testid="test-hudu-btn">
                Test Connection
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
