import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Mail, Settings, CheckCircle, XCircle, RefreshCw, Loader2, Shield,
  Globe, Key, Link, Unlink, TestTube, ArrowRight, UserPlus, Zap
} from "lucide-react";

export default function O365SetupPage() {
  const { token } = useAuth();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [form, setForm] = useState({
    tenant_id: "", client_id: "", client_secret: "",
    redirect_uri: "", mailbox_email: "",
    email_to_lead_enabled: true, email_to_ticket_enabled: false,
    auto_reply_enabled: false,
    auto_reply_message: "Thank you for contacting us. We have received your inquiry and will respond shortly.",
  });
  const [emailLeads, setEmailLeads] = useState([]);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const [sRes, lRes] = await Promise.all([
        axios.get(`${API}/settings/o365-mailbox`, { headers }),
        axios.get(`${API}/o365/email-leads`, { headers }),
      ]);
      setSettings(sRes.data);
      setEmailLeads(lRes.data);
      if (sRes.data.tenant_id) {
        setForm({
          tenant_id: sRes.data.tenant_id || "",
          client_id: sRes.data.client_id || "",
          client_secret: sRes.data.client_secret ? "********" : "",
          redirect_uri: sRes.data.redirect_uri || "",
          mailbox_email: sRes.data.mailbox_email || "",
          email_to_lead_enabled: sRes.data.email_to_lead_enabled !== false,
          email_to_ticket_enabled: sRes.data.email_to_ticket_enabled || false,
          auto_reply_enabled: sRes.data.auto_reply_enabled || false,
          auto_reply_message: sRes.data.auto_reply_message || "",
        });
      }
    } catch { toast.error("Failed to fetch settings"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchSettings(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = async () => {
    if (!form.tenant_id || !form.client_id || !form.client_secret || !form.mailbox_email) {
      toast.error("All Azure AD credentials and mailbox email are required");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/o365/connect`, form, { headers });
      toast.success("Office 365 mailbox connected!");
      setIsSetupOpen(false);
      fetchSettings();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to connect"); }
    finally { setSaving(false); }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Office 365 mailbox?")) return;
    try {
      await axios.post(`${API}/o365/disconnect`, {}, { headers });
      toast.success("Disconnected");
      fetchSettings();
    } catch { toast.error("Failed to disconnect"); }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await axios.post(`${API}/o365/test-connection`, {}, { headers });
      if (res.data.success) toast.success("Connection test passed!");
      else toast.error(res.data.message);
    } catch { toast.error("Test failed"); }
    finally { setTesting(false); }
  };

  const handleUpdateSettings = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/settings/o365-mailbox`, {
        email_to_lead_enabled: form.email_to_lead_enabled,
        email_to_ticket_enabled: form.email_to_ticket_enabled,
        auto_reply_enabled: form.auto_reply_enabled,
        auto_reply_message: form.auto_reply_message,
      }, { headers });
      toast.success("Settings saved");
      fetchSettings();
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  };

  const handleSync = async () => {
    try {
      const res = await axios.post(`${API}/o365/sync-emails`, {}, { headers });
      toast.success(res.data.message);
      fetchSettings();
    } catch { toast.error("Sync failed"); }
  };

  const handleTestIncomingEmail = async () => {
    try {
      await axios.post(`${API}/o365/webhook/incoming-email`, {
        from_address: "demo@testclient.com",
        from_name: "Demo User",
        subject: "Interested in your IT services",
        body: "Hi, we are looking for a managed service provider for our office of 25 people. Can you send us a proposal?",
      }, { headers });
      toast.success("Test email processed - check Leads page");
      fetchSettings();
    } catch { toast.error("Failed to process test email"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const isConnected = settings?.connected;

  return (
    <div className="space-y-6" data-testid="o365-setup-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Office 365 Mailbox</h1>
          <p className="text-muted-foreground">One-click email integration for ticket comments and lead generation</p>
        </div>
        <div className="flex gap-2">
          {isConnected && (
            <>
              <Button variant="outline" size="sm" onClick={handleSync}><RefreshCw className="w-4 h-4 mr-2" />Sync Now</Button>
              <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TestTube className="w-4 h-4 mr-2" />}Test Connection
              </Button>
            </>
          )}
          {!isConnected && <Button onClick={() => setIsSetupOpen(true)} data-testid="connect-o365-btn"><Zap className="w-4 h-4 mr-2" />One-Click Setup</Button>}
        </div>
      </div>

      {/* Connection Status Card */}
      <Card className={isConnected ? "border-emerald-500/30" : "border-amber-500/30"}>
        <CardContent className="py-5">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${isConnected ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
              <Mail className={`w-7 h-7 ${isConnected ? "text-emerald-400" : "text-amber-400"}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg">Office 365 Integration</h3>
                {isConnected ? (
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"><CheckCircle className="w-3 h-3 mr-1" />Connected</Badge>
                ) : (
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30"><XCircle className="w-3 h-3 mr-1" />Not Connected</Badge>
                )}
              </div>
              {isConnected ? (
                <p className="text-sm text-muted-foreground">Connected to <span className="font-mono text-foreground">{settings?.mailbox_email}</span> &middot; Last sync: {settings?.last_sync ? new Date(settings.last_sync).toLocaleString() : "Never"}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Connect your Office 365 mailbox to send ticket comments via email and auto-generate leads from incoming emails.</p>
              )}
            </div>
            {isConnected && (
              <Button variant="destructive" size="sm" onClick={handleDisconnect} data-testid="disconnect-o365-btn">
                <Unlink className="w-4 h-4 mr-1" />Disconnect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isConnected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Email-to-Lead Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><UserPlus className="w-5 h-5 text-cyan-400" />Email-to-Lead Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-create leads from emails</p>
                  <p className="text-xs text-muted-foreground">New emails from unknown senders create a lead automatically</p>
                </div>
                <Switch checked={form.email_to_lead_enabled} onCheckedChange={v => setForm({ ...form, email_to_lead_enabled: v })} data-testid="email-to-lead-toggle" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-create tickets from emails</p>
                  <p className="text-xs text-muted-foreground">Emails from known clients create a ticket</p>
                </div>
                <Switch checked={form.email_to_ticket_enabled} onCheckedChange={v => setForm({ ...form, email_to_ticket_enabled: v })} data-testid="email-to-ticket-toggle" />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-reply to incoming emails</p>
                  <p className="text-xs text-muted-foreground">Send an acknowledgement reply</p>
                </div>
                <Switch checked={form.auto_reply_enabled} onCheckedChange={v => setForm({ ...form, auto_reply_enabled: v })} />
              </div>
              {form.auto_reply_enabled && (
                <div className="space-y-2">
                  <Label>Auto-reply message</Label>
                  <Textarea value={form.auto_reply_message} onChange={e => setForm({ ...form, auto_reply_message: e.target.value })} rows={3} />
                </div>
              )}
              <Button size="sm" onClick={handleUpdateSettings} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Save Settings</Button>
            </CardContent>
          </Card>

          {/* Test & Recent Leads */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><Mail className="w-5 h-5 text-blue-400" />Email-Generated Leads</CardTitle>
                <Button variant="outline" size="sm" onClick={handleTestIncomingEmail} data-testid="test-email-btn">
                  <TestTube className="w-4 h-4 mr-1" />Send Test Email
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {emailLeads.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {emailLeads.slice(0, 10).map(lead => (
                    <div key={lead.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border/50">
                      <div>
                        <p className="text-sm font-medium">{lead.company_name}</p>
                        <p className="text-xs text-muted-foreground">{lead.email} &middot; {lead.contact_name}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{lead.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Mail className="w-10 h-10 mx-auto opacity-30 mb-2" />
                  <p className="text-sm">No email-generated leads yet</p>
                  <p className="text-xs">Click "Send Test Email" to try it out</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* How it works */}
      {!isConnected && (
        <Card>
          <CardHeader><CardTitle className="text-base">How It Works</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto"><Key className="w-6 h-6 text-blue-400" /></div>
                <h4 className="font-semibold text-sm">1. Enter Azure AD Credentials</h4>
                <p className="text-xs text-muted-foreground">Provide your Tenant ID, Client ID, Client Secret from your Azure AD app registration.</p>
              </div>
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto"><Link className="w-6 h-6 text-emerald-400" /></div>
                <h4 className="font-semibold text-sm">2. Connect Mailbox</h4>
                <p className="text-xs text-muted-foreground">NexusOps connects to your O365 mailbox via Microsoft Graph API.</p>
              </div>
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mx-auto"><Zap className="w-6 h-6 text-purple-400" /></div>
                <h4 className="font-semibold text-sm">3. Auto-Generate Leads</h4>
                <p className="text-xs text-muted-foreground">Incoming emails automatically create leads in your CRM pipeline.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Setup Dialog */}
      <Dialog open={isSetupOpen} onOpenChange={setIsSetupOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Connect Office 365 Mailbox</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-muted-foreground">
              <p className="font-medium text-blue-400 mb-1">Azure AD App Registration Required</p>
              <p>Go to <span className="font-mono">portal.azure.com</span> &gt; Azure Active Directory &gt; App registrations &gt; New registration. Grant <span className="font-mono">Mail.Read, Mail.Send, Mail.ReadWrite</span> permissions.</p>
            </div>
            <div className="space-y-2">
              <Label>Tenant ID *</Label>
              <Input value={form.tenant_id} onChange={e => setForm({ ...form, tenant_id: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" data-testid="o365-tenant-id" />
            </div>
            <div className="space-y-2">
              <Label>Client ID (Application ID) *</Label>
              <Input value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" data-testid="o365-client-id" />
            </div>
            <div className="space-y-2">
              <Label>Client Secret *</Label>
              <Input type="password" value={form.client_secret} onChange={e => setForm({ ...form, client_secret: e.target.value })} placeholder="Enter client secret" data-testid="o365-client-secret" />
            </div>
            <div className="space-y-2">
              <Label>Mailbox Email *</Label>
              <Input type="email" value={form.mailbox_email} onChange={e => setForm({ ...form, mailbox_email: e.target.value })} placeholder="support@yourdomain.com" data-testid="o365-mailbox-email" />
            </div>
            <div className="space-y-2">
              <Label>Redirect URI (optional)</Label>
              <Input value={form.redirect_uri} onChange={e => setForm({ ...form, redirect_uri: e.target.value })} placeholder="https://yourdomain.com/auth/callback" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSetupOpen(false)}>Cancel</Button>
            <Button onClick={handleConnect} disabled={saving} data-testid="connect-o365-submit">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}Connect Mailbox
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
