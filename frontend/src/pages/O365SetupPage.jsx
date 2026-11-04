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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import SetupGuideCallout from "@/components/SetupGuideCallout";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import WorkspaceActionMenu, { WorkspaceActionMenuItem } from "@/components/WorkspaceActionMenu";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import { toast } from "sonner";
import {
  Mail, Settings, CheckCircle, XCircle, RefreshCw, Loader2, Shield, Key, Link, Unlink, TestTube, UserPlus, Zap, Plus, Pencil, Send
} from "lucide-react";

const OUTBOUND_ROLES = [
  { id: "ticket_comments", label: "Ticket comments" },
  { id: "ticket_replies", label: "Ticket replies" },
  { id: "service_job_comments", label: "Workshop & cabling comments" },
  { id: "service_job_replies", label: "Workshop & cabling replies" },
  { id: "billing", label: "Billing & invoices" },
  { id: "lead_responses", label: "Lead responses" },
  { id: "notifications", label: "Platform notices" },
];

export default function O365SetupPage() {
  const { token, user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [outboundTesting, setOutboundTesting] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [outboundTestRole, setOutboundTestRole] = useState("notifications");
  const [outboundRouting, setOutboundRouting] = useState({});
  const [deliveries, setDeliveries] = useState([]);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [editingMailbox, setEditingMailbox] = useState(null);
  const [removingMailbox, setRemovingMailbox] = useState(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [removingMailboxBusy, setRemovingMailboxBusy] = useState(false);
  const [msConnection, setMsConnection] = useState(null);
  const [msConnectBusy, setMsConnectBusy] = useState(false);
  const [msDisconnectBusy, setMsDisconnectBusy] = useState(false);
  const [form, setForm] = useState({
    tenant_id: "", client_id: "", client_secret: "",
    redirect_uri: "", mailbox_email: "",
    email_to_lead_enabled: true, email_to_ticket_enabled: false,
    mail_sync_enabled: true, mail_sync_interval_minutes: 5,
    auto_reply_enabled: false,
    auto_reply_message: "Thank you for contacting us. We have received your inquiry and will respond shortly.",
  });
  const [emailLeads, setEmailLeads] = useState([]);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchSettings = async ({ quiet = false } = {}) => {
    setLoadError(null);
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [sRes, lRes, auditRes, msRes] = await Promise.all([
        axios.get(`${API}/settings/o365-mailbox`, { headers }),
        axios.get(`${API}/o365/email-leads`, { headers }),
        axios.get(`${API}/settings/email-delivery/audit?limit=12`, { headers }).catch(() => ({ data: { deliveries: [] } })),
        axios.get(`${API}/settings/microsoft-connect/connection`, { headers }).catch(() => ({ data: null })),
      ]);
      setSettings(sRes.data);
      setEmailLeads(lRes.data);
      setDeliveries(auditRes.data?.deliveries || []);
      setMsConnection(msRes.data);
      const savedRouting = sRes.data.outbound_routing || {};
      const fallbackSender = sRes.data.outbound_mailbox_email || sRes.data.mailbox_email || "";
      setOutboundRouting(Object.fromEntries(OUTBOUND_ROLES.map(role => [role.id, savedRouting[role.id] || fallbackSender])));
      if (sRes.data.tenant_id) {
        setForm({
          tenant_id: sRes.data.tenant_id || "",
          client_id: sRes.data.client_id || "",
          client_secret: sRes.data.client_secret_set ? "********" : "",
          redirect_uri: sRes.data.redirect_uri || "",
          mailbox_email: sRes.data.mailbox_email || "",
          email_to_lead_enabled: sRes.data.email_to_lead_enabled !== false,
          email_to_ticket_enabled: sRes.data.email_to_ticket_enabled || false,
          mail_sync_enabled: sRes.data.mail_sync_enabled !== false,
          mail_sync_interval_minutes: sRes.data.mail_sync_interval_minutes || 5,
          auto_reply_enabled: sRes.data.auto_reply_enabled || false,
          auto_reply_message: sRes.data.auto_reply_message || "",
        });
      }
    } catch {
      if (quiet) toast.error("Mailbox status could not refresh. Your current configuration view has been kept.");
      else setLoadError("Nexus could not retrieve Microsoft 365 mailbox status. No mail routing has been changed.");
    } finally {
      if (quiet) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => { fetchSettings(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("microsoft_connected") === "1") toast.success("Microsoft 365 connected — ticket replies, lead emails and inbox intake now use this sign-in.");
    if (params.get("microsoft_connect_error")) toast.error(`Microsoft 365 sign-in failed: ${params.get("microsoft_connect_error")}`);
  }, []);

  const startMicrosoftConnect = async () => {
    setMsConnectBusy(true);
    try {
      const response = await axios.get(`${API}/settings/microsoft-connect/start`, { headers });
      const authorizationUrl = response.data?.authorization_url;
      if (!authorizationUrl) throw new Error("Microsoft did not return an authorization URL");
      window.location.assign(authorizationUrl);
    } catch (error) {
      toast.error(error?.response?.data?.detail || error.message || "Could not start Microsoft sign-in");
      setMsConnectBusy(false);
    }
  };

  const disconnectMicrosoftConnection = async () => {
    setMsDisconnectBusy(true);
    try {
      await axios.delete(`${API}/settings/microsoft-connect/connection`, { headers });
      toast.success("Microsoft 365 sign-in disconnected");
      fetchSettings({ quiet: true });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not disconnect Microsoft 365");
    } finally {
      setMsDisconnectBusy(false);
    }
  };

  const handleConnect = async () => {
    if (!form.tenant_id || !form.client_id || !form.client_secret || !form.mailbox_email) {
      toast.error("All Azure AD credentials and mailbox email are required");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/o365/connect`, form, { headers });
      toast.success("Mailbox configuration saved. Grant Microsoft Graph application permissions, then run the connection and delivery tests.");
      setIsSetupOpen(false);
      fetchSettings({ quiet: true });
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to connect"); }
    finally { setSaving(false); }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await axios.post(`${API}/o365/disconnect`, {}, { headers });
      toast.success("Microsoft 365 mailbox disconnected");
      setDisconnectOpen(false);
      fetchSettings({ quiet: true });
    } catch { toast.error("Failed to disconnect mailbox"); }
    finally { setDisconnecting(false); }
  };

  const handleRemoveMailbox = async () => {
    if (!removingMailbox?.id) return;
    setRemovingMailboxBusy(true);
    try {
      const response = await axios.delete(`${API}/o365/mailboxes/${removingMailbox.id}`, { headers });
      toast.success(response.data?.remaining ? "Mailbox removed and delivery routing updated" : "Mailbox removed and Microsoft 365 delivery disconnected");
      setRemovingMailbox(null);
      fetchSettings({ quiet: true });
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to remove mailbox"); }
    finally { setRemovingMailboxBusy(false); }
  };

  const handleUpdateMailbox = async () => {
    if (!editingMailbox) return;
    setSaving(true);
    try {
      await axios.patch(`${API}/o365/mailboxes/${editingMailbox.id}`, {
        email_to_lead_enabled: editingMailbox.email_to_lead_enabled,
        email_to_ticket_enabled: editingMailbox.email_to_ticket_enabled,
      }, { headers });
      toast.success("Inbox routing updated");
      setEditingMailbox(null);
      fetchSettings({ quiet: true });
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to update inbox"); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await axios.post(`${API}/o365/test-connection`, {}, { headers });
      if (res.data.success) toast.info(res.data.message);
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
        mail_sync_enabled: form.mail_sync_enabled,
        mail_sync_interval_minutes: Number(form.mail_sync_interval_minutes) || 5,
        auto_reply_enabled: form.auto_reply_enabled,
        auto_reply_message: form.auto_reply_message,
      }, { headers });
      toast.success("Settings saved");
      fetchSettings({ quiet: true });
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  };

  const handleOutboundTest = async () => {
    const recipient = (testRecipient || user?.email || "").trim();
    if (!recipient) { toast.error("Enter an email address for the delivery test"); return; }
    setOutboundTesting(true);
    try {
      const result = await axios.post(`${API}/settings/email-delivery/test`, { to_email: recipient, category: outboundTestRole }, { headers });
      const sender = result.data.sender ? ` from ${result.data.sender}` : "";
      if (result.data.status === "sent") toast.success(`Test email sent to ${recipient}${sender}`);
      else toast.warning(result.data.message || "The delivery test was not sent");
      fetchSettings({ quiet: true });
    } catch (e) { toast.error(e.response?.data?.detail || "Outbound delivery test failed"); }
    finally { setOutboundTesting(false); }
  };

  const handleSetOutboundMailbox = async (mailboxEmail) => {
    setSaving(true);
    try {
      await axios.put(`${API}/settings/o365-mailbox`, { outbound_mailbox_email: mailboxEmail }, { headers });
      toast.success("Shared outbound mailbox updated");
      fetchSettings({ quiet: true });
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to update outbound mailbox"); }
    finally { setSaving(false); }
  };

  const handleSaveOutboundRouting = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/settings/o365-mailbox`, { outbound_routing: outboundRouting }, { headers });
      toast.success("Outbound mailbox routing saved");
      fetchSettings({ quiet: true });
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save outbound routing"); }
    finally { setSaving(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await axios.post(`${API}/o365/sync-emails`, {}, { headers });
      const summary = res.data;
      toast.success(`${summary.emails_fetched || 0} checked · ${summary.leads_created || 0} leads · ${summary.tickets_created || 0} tickets`);
      fetchSettings({ quiet: true });
    } catch (e) { toast.error(e.response?.data?.detail || "Sync failed"); }
    finally { setSyncing(false); }
  };

  const handleTestIncomingEmail = async () => {
    try {
      await axios.post(`${API}/o365/webhook/incoming-email`, {
        from_address: `demo.lead.${Date.now()}@testclient.com`,
        from_name: "Demo User",
        subject: "Interested in your IT services",
        body: "Hi, we are looking for a managed service provider for our office of 25 people. Can you send us a proposal?",
        message_id: `nexus-demo-${Date.now()}`,
        to_address: (settings?.mailboxes || [])[0]?.mailbox_email || settings?.mailbox_email || "",
      }, { headers });
      toast.success("Demo email processed — check Lead Studio");
      fetchSettings({ quiet: true });
    } catch { toast.error("Failed to process test email"); }
  };

  if (loading) return <WorkspaceLoadingState label="Loading Microsoft 365 mailboxes" />;
  if (loadError) return <WorkspaceErrorState title="Mailbox & Email is unavailable" description={loadError} onRetry={fetchSettings} retryLabel="Retry mailbox load" />;

  const isConnected = settings?.connected;
  const isGraphLive = settings?.live_sync_enabled === true;
  const msConnected = Boolean(msConnection?.connected);
  const mailboxes = settings?.mailboxes || [];
  const outboundMailbox = settings?.outbound_mailbox_email || settings?.mailbox_email || "";
  const routedRoleCount = OUTBOUND_ROLES.filter(role => outboundRouting[role.id] && mailboxes.some(mailbox => mailbox.mailbox_email === outboundRouting[role.id])).length;
  const readiness = [
    { label: "Mailbox connected", ready: Boolean(isConnected), detail: isConnected ? "Configuration saved" : "Connect a Microsoft 365 mailbox" },
    { label: "Microsoft Graph verified", ready: Boolean(isGraphLive), detail: isGraphLive ? "Mailbox read test passed" : "Run Test Connection after granting permissions" },
    { label: "Outbound sender selected", ready: Boolean(outboundMailbox), detail: outboundMailbox || "Choose the shared sender mailbox" },
    { label: "Email roles routed", ready: routedRoleCount === OUTBOUND_ROLES.length, detail: `${routedRoleCount}/${OUTBOUND_ROLES.length} roles assigned` },
    { label: "Delivery test passed", ready: settings?.last_outbound_test_status === "sent", detail: settings?.last_outbound_test_status === "sent" ? "Latest test accepted by Microsoft 365" : "Send a test email" },
  ];

  return (
    <div id="mailbox-o365-card" data-testid="mailbox-o365-card">
      <div className="space-y-6" data-testid="mailbox-email-workspace">
      <OperationalPageHeader
        eyebrow="Mailbox and email"
        title="Microsoft 365 Mailboxes"
        description="Microsoft Graph email intake, outbound routing, delivery audit, and automatic sync."
        icon={Mail}
        tone="sky"
        signal={isGraphLive ? "healthy" : isConnected ? "attention" : "recommendation"}
        actions={<>
          {isConnected && (
            <>
              <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} data-testid="o365-sync-now">{syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Sync now</Button>
              <WorkspaceActionMenu testId="o365-more-actions">
                <WorkspaceActionMenuItem icon={testing ? Loader2 : TestTube} onSelect={handleTest} disabled={testing}>Test connection</WorkspaceActionMenuItem>
                <WorkspaceActionMenuItem icon={RefreshCw} onSelect={() => fetchSettings({ quiet: true })} disabled={refreshing} testId="refresh-o365-workspace">Refresh workspace</WorkspaceActionMenuItem>
              </WorkspaceActionMenu>
              <Button size="sm" onClick={() => setIsSetupOpen(true)} data-testid="add-o365-mailbox"><Plus className="w-4 h-4 mr-2" />Add inbox</Button>
            </>
          )}
          {!isConnected && <><Button variant="outline" size="sm" onClick={() => fetchSettings({ quiet: true })} disabled={refreshing} data-testid="refresh-o365-workspace">{refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh</Button><Button variant="outline" onClick={() => setIsSetupOpen(true)} data-testid="connect-o365-btn"><Key className="w-4 h-4 mr-2" />Manual Azure setup</Button></>}
        </>}
      />

      {/* One-click Microsoft sign-in */}
      <Card className={msConnected ? "border-emerald-500/40 bg-emerald-500/[0.04]" : "border-sky-500/30 bg-sky-500/[0.03]"}>
        <CardContent className="py-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${msConnected ? "bg-emerald-500/10" : "bg-sky-500/10"}`}>
              <Zap className={`w-7 h-7 ${msConnected ? "text-emerald-400" : "text-sky-400"}`} />
            </div>
            <div className="flex-1 min-w-[260px]">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg">One-click Microsoft 365 sign-in</h3>
                {msConnected ? (
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"><CheckCircle className="w-3 h-3 mr-1" />Connected</Badge>
                ) : msConnection?.status === "reauth_required" ? (
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30"><RefreshCw className="w-3 h-3 mr-1" />Reconnect needed</Badge>
                ) : (
                  <Badge className="bg-sky-500/20 text-sky-400 border-sky-500/30"><Shield className="w-3 h-3 mr-1" />Not signed in</Badge>
                )}
              </div>
              {msConnected ? (
                <p className="text-sm text-muted-foreground">
                  Signed in as <span className="font-mono text-foreground">{msConnection?.connected_account}</span>
                  {msConnection?.tenant_id ? <> &middot; tenant <span className="font-mono text-foreground">{msConnection.tenant_id}</span></> : null}
                  {" "}&mdash; ticket replies, lead emails and inbox intake use this grant. Tokens stay encrypted and refresh automatically.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Sign in with Microsoft once and approve the request &mdash; that single admin consent covers sending ticket and lead email (<span className="font-mono">Mail.Send</span>) and reading the inbox that generates leads and tickets (<span className="font-mono">Mail.Read</span>). No Azure application registration or client secret needed.</p>
              )}
              {!msConnected && msConnection?.app_configured === false && (
                <p className="mt-2 text-xs text-amber-400">This Nexus server has no Microsoft sign-in application yet. Set the deployment&apos;s multi-tenant Entra application (MICROSOFT_OAUTH_CLIENT_ID) once, or save an application under Settings &gt; Sign-in &amp; Access.</p>
              )}
              {msConnected && (msConnection?.scopes || []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msConnection.scopes.filter(scope => ["Mail.Send", "Mail.Read", "User.Read", "offline_access"].includes(scope)).map(scope => (
                    <Badge key={scope} variant="outline" className="text-[10px] text-muted-foreground">{scope}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {msConnected ? (<>
                <Button variant="outline" size="sm" onClick={startMicrosoftConnect} disabled={msConnectBusy} data-testid="microsoft-connect-reconnect">
                  {msConnectBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Reconnect
                </Button>
                <Button variant="destructive" size="sm" onClick={disconnectMicrosoftConnection} disabled={msDisconnectBusy} data-testid="microsoft-connect-disconnect">
                  {msDisconnectBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Unlink className="w-4 h-4 mr-2" />}Disconnect
                </Button>
              </>) : (
                <Button onClick={startMicrosoftConnect} disabled={msConnectBusy || msConnection?.app_configured === false} data-testid="microsoft-connect-btn">
                  {msConnectBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}Sign in with Microsoft
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connection Status Card */}
      <Card className={isConnected ? "border-emerald-500/30" : "border-amber-500/30"}>
        <CardContent className="py-5">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${isConnected ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
              <Mail className={`w-7 h-7 ${isConnected ? "text-emerald-400" : "text-amber-400"}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg">Manual Azure application (optional)</h3>
                {isConnected ? (
                  <Badge className={isGraphLive ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"}><CheckCircle className="w-3 h-3 mr-1" />{isGraphLive ? "Graph Connected" : "Setup Saved"}</Badge>
                ) : (
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30"><XCircle className="w-3 h-3 mr-1" />Not Connected</Badge>
                )}
              </div>
              {isConnected ? (
                <p className="text-sm text-muted-foreground">{isGraphLive ? "Connected to" : "Configuration saved for"} <span className="font-mono text-foreground">{settings?.mailbox_email}</span> &middot; {isGraphLive ? `Last sync: ${settings?.last_sync ? new Date(settings.last_sync).toLocaleString() : "Never"}` : "Grant Graph application permissions and use Test Connection plus Send test email to verify delivery."}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Connect a Microsoft 365 mailbox to send invoices, ticket mail, reminders, and invitations, and to generate leads from incoming emails.</p>
              )}
            </div>
            {isConnected && (
              <Button variant="destructive" size="sm" onClick={() => setDisconnectOpen(true)} data-testid="disconnect-o365-btn">
                <Unlink className="w-4 h-4 mr-1" />Disconnect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-sky-500/20 bg-sky-500/[0.025]">
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Shield className="w-5 h-5 text-sky-400" />Email readiness</CardTitle><p className="text-xs text-muted-foreground">Complete these checks before relying on Microsoft 365 for live lead, ticket, billing, and notification mail.</p></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {readiness.map(item => <div key={item.label} className={`rounded-lg border p-3 ${item.ready ? "border-emerald-500/25 bg-emerald-500/[0.04]" : "border-amber-500/25 bg-amber-500/[0.035]"}`}><div className="mb-1 flex items-center gap-1.5 text-sm font-medium">{item.ready ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-amber-400" />}{item.label}</div><p className="text-xs text-muted-foreground">{item.detail}</p></div>)}
        </CardContent>
      </Card>

      {mailboxes.length > 0 && (
        <Card id="microsoft365-email-control-plane" data-testid="microsoft365-email-control-plane" className="border-blue-500/25 bg-blue-500/[0.03]">
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Mail className="w-5 h-5 text-blue-400" />Microsoft 365 email control plane</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><p className="text-sm text-muted-foreground">Used to send invoices, payment reminders, ticket mail, invitations, and platform notifications through Microsoft Graph.</p><p className="mt-1 text-xs text-muted-foreground">Delivery is organisation-controlled: compose authors do not change the sender. Use the workflow routes below to choose the approved mailbox for each class of mail.</p>{settings?.last_outbound_test_status && <p className={`mt-1 text-xs ${settings.last_outbound_test_status === "sent" ? "text-emerald-400" : settings.last_outbound_test_status === "failed" ? "text-rose-400" : "text-amber-400"}`}>Last delivery test: {settings.last_outbound_test_status}{settings.last_outbound_test_role ? ` · ${settings.last_outbound_test_role.replace(/_/g, " ")}` : ""}{settings.last_outbound_test_sender ? ` from ${settings.last_outbound_test_sender}` : ""}{settings.last_outbound_test_to ? ` to ${settings.last_outbound_test_to}` : ""}{settings.last_outbound_test_at ? ` · ${new Date(settings.last_outbound_test_at).toLocaleString()}` : ""}</p>}</div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={outboundMailbox} onValueChange={handleSetOutboundMailbox} disabled={saving}>
                <SelectTrigger className="w-[280px]" data-testid="outbound-mailbox-select"><SelectValue placeholder="Choose sender mailbox" /></SelectTrigger>
                <SelectContent>{mailboxes.map(mailbox => <SelectItem key={mailbox.id} value={mailbox.mailbox_email}>{mailbox.mailbox_email}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={outboundTestRole} onValueChange={setOutboundTestRole} disabled={outboundTesting}>
                <SelectTrigger className="w-[220px]" data-testid="o365-outbound-test-role"><SelectValue placeholder="Choose delivery role" /></SelectTrigger>
                <SelectContent>{OUTBOUND_ROLES.map(role => <SelectItem key={role.id} value={role.id}>{role.label}</SelectItem>)}</SelectContent>
              </Select>
              <Input value={testRecipient} onChange={event => setTestRecipient(event.target.value)} placeholder={user?.email || "test@example.com"} className="w-[250px]" data-testid="o365-outbound-test-recipient" />
              <Button variant="outline" onClick={handleOutboundTest} disabled={outboundTesting} data-testid="o365-outbound-test-send">{outboundTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send test email</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-zinc-800">
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Mail className="w-5 h-5 text-cyan-400" />Outbound delivery audit</CardTitle><p className="text-xs text-muted-foreground">Recent Microsoft 365 delivery attempts across tickets, billing, leads, and notifications.</p></CardHeader>
        <CardContent>
          {deliveries.length === 0 ? <p className="text-sm text-muted-foreground">No outbound email activity yet.</p> : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/40"><tr><th className="px-3 py-2 text-left font-medium">When</th><th className="px-3 py-2 text-left font-medium">Workflow</th><th className="px-3 py-2 text-left font-medium">Subject</th><th className="px-3 py-2 text-left font-medium">Recipients</th><th className="px-3 py-2 text-left font-medium">Mailbox</th><th className="px-3 py-2 text-left font-medium">Status</th></tr></thead>
                <tbody>{deliveries.map((delivery, index) => <tr key={`${delivery.created_at}-${index}`} className="border-t"><td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{delivery.created_at ? new Date(delivery.created_at).toLocaleString() : "—"}</td><td className="px-3 py-2"><Badge variant="outline" className="capitalize text-xs">{(delivery.category || "notifications").replace(/_/g, " ")}</Badge></td><td className="max-w-[280px] truncate px-3 py-2" title={delivery.subject}>{delivery.subject || "—"}</td><td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground" title={(delivery.recipients || []).join(", ")}>{(delivery.recipients || []).join(", ") || "—"}</td><td className="px-3 py-2 text-xs text-muted-foreground">{delivery.sender_mailbox || "—"}</td><td className="px-3 py-2"><Badge variant="outline" title={delivery.message || ""} className={delivery.status === "sent" ? "border-emerald-500/40 text-emerald-400" : delivery.status === "failed" ? "border-rose-500/40 text-rose-400" : "border-amber-500/40 text-amber-400"}>{delivery.status || "unknown"}</Badge></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {mailboxes.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Mail className="w-5 h-5 text-sky-400" />Connected Inboxes <Badge variant="outline">{mailboxes.length}</Badge></CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {mailboxes.map(mailbox => <div key={mailbox.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div><p className="text-sm font-medium">{mailbox.mailbox_email}</p><p className="text-xs text-muted-foreground">{mailbox.email_to_lead_enabled !== false ? "Email-to-lead enabled" : "Email-to-lead paused"} · Last sync: {mailbox.last_sync ? new Date(mailbox.last_sync).toLocaleString() : "Never"}</p></div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditingMailbox({ ...mailbox })} data-testid={`edit-o365-mailbox-${mailbox.id}`}><Pencil className="w-4 h-4 mr-1" />Routing</Button>
                <Button variant="ghost" size="sm" className="text-red-400" onClick={() => setRemovingMailbox(mailbox)} data-testid={`remove-o365-mailbox-${mailbox.id}`}><Unlink className="w-4 h-4 mr-1" />Remove</Button>
              </div>
            </div>)}
          </CardContent>
        </Card>
      )}

      {mailboxes.length > 0 && (
        <Card id="microsoft365-outbound-role-routing" data-testid="microsoft365-outbound-role-routing" className="border-violet-500/25">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Settings className="w-5 h-5 text-violet-400" />Outbound email roles</CardTitle><p className="text-xs text-muted-foreground">Tick one mailbox per role. This determines which address customers see for that class of outgoing email.</p></CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/40"><tr><th className="px-3 py-2 text-left font-medium">Mailbox</th>{OUTBOUND_ROLES.map(role => <th key={role.id} className="px-3 py-2 text-center text-xs font-medium">{role.label}</th>)}</tr></thead>
                <tbody>{mailboxes.map(mailbox => <tr key={`role-${mailbox.id}`} className="border-t"><td className="px-3 py-3 font-medium">{mailbox.mailbox_email}</td>{OUTBOUND_ROLES.map(role => <td key={role.id} className="px-3 py-3 text-center"><Checkbox checked={outboundRouting[role.id] === mailbox.mailbox_email} onCheckedChange={checked => { if (checked) setOutboundRouting(current => ({ ...current, [role.id]: mailbox.mailbox_email })); }} aria-label={`${role.label}: ${mailbox.mailbox_email}`} /></td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className="flex justify-end"><Button onClick={handleSaveOutboundRouting} disabled={saving} data-testid="save-outbound-routing">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Settings className="mr-2 h-4 w-4" />}Save email roles</Button></div>
          </CardContent>
        </Card>
      )}

      {isConnected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Email-to-Lead Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><UserPlus className="w-5 h-5 text-cyan-400" />Fallback Routing Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-create leads from emails</p>
                  <p className="text-xs text-muted-foreground">Used only when an inbound email does not identify a connected inbox</p>
                </div>
                <Switch checked={form.email_to_lead_enabled} onCheckedChange={v => setForm({ ...form, email_to_lead_enabled: v })} data-testid="email-to-lead-toggle" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-create tickets from emails</p>
                  <p className="text-xs text-muted-foreground">Used only for unaddressed webhook fallback; inbox routing is set when adding an inbox</p>
                </div>
                <Switch checked={form.email_to_ticket_enabled} onCheckedChange={v => setForm({ ...form, email_to_ticket_enabled: v })} data-testid="email-to-ticket-toggle" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Automatic inbox sync</p>
                  <p className="text-xs text-muted-foreground">Poll verified Microsoft 365 inboxes every {form.mail_sync_interval_minutes || 5} minutes. Manual sync remains available.</p>
                </div>
                <Switch checked={form.mail_sync_enabled} onCheckedChange={v => setForm({ ...form, mail_sync_enabled: v })} data-testid="automatic-mail-sync-toggle" />
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="mail-sync-interval" className="text-sm font-medium">Sync interval</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">Choose how frequently Nexus checks connected inboxes while automatic sync is enabled.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      id="mail-sync-interval"
                      type="number"
                      min="1"
                      max="30"
                      value={form.mail_sync_interval_minutes}
                      onChange={event => setForm({ ...form, mail_sync_interval_minutes: event.target.value })}
                      disabled={!form.mail_sync_enabled}
                      className="w-20 text-right"
                      data-testid="mail-sync-interval-input"
                    />
                    <span className="text-sm text-muted-foreground">minutes</span>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">Allowed range: 1–30 minutes. Shorter intervals increase Microsoft Graph activity.</p>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-reply to incoming emails</p>
                  <p className="text-xs text-muted-foreground">Send an acknowledgement through the Platform notices mailbox; automatic senders are skipped.</p>
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

      {!isConnected && (
        <Card className="border-sky-500/20 bg-sky-500/[0.03]">
          <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
            <div><p className="text-sm font-medium">Try email-to-lead with demo data</p><p className="text-xs text-muted-foreground">Creates a clearly test-sourced inquiry in Lead Studio without connecting a mailbox.</p></div>
            <Button variant="outline" onClick={handleTestIncomingEmail} data-testid="create-demo-email-lead"><TestTube className="w-4 h-4 mr-1" />Create Demo Email Lead</Button>
          </CardContent>
        </Card>
      )}

      {/* How it works */}
      {!isConnected && (
        <Card>
          <CardHeader><CardTitle className="text-base">How It Works</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto"><Key className="w-6 h-6 text-blue-400" /></div>
                <h4 className="font-semibold text-sm">1. Add Azure App Details</h4>
                <p className="text-xs text-muted-foreground">Enter your Tenant ID, Client ID, Client Secret, and mailbox. Grant Microsoft Graph application permissions for Mail.Send and Mail.Read, then approve admin consent.</p>
              </div>
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto"><Link className="w-6 h-6 text-emerald-400" /></div>
                <h4 className="font-semibold text-sm">2. Connect Mailbox</h4>
                <p className="text-xs text-muted-foreground">NexusMSP uses the same Microsoft Graph mailbox for incoming lead routing and outbound business mail.</p>
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

      <Dialog open={Boolean(editingMailbox)} onOpenChange={(open) => !open && setEditingMailbox(null)}>
        <DialogContent className="max-w-md" data-testid="mailbox-routing-dialog">
          <DialogHeader><DialogTitle>Inbox routing</DialogTitle></DialogHeader>
          {editingMailbox && <div className="space-y-4">
            <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm font-medium">{editingMailbox.mailbox_email}</div>
            <div className="flex items-center justify-between gap-4">
              <div><p className="text-sm font-medium">Create leads</p><p className="text-xs text-muted-foreground">New enquiries become CRM leads.</p></div>
              <Switch checked={editingMailbox.email_to_lead_enabled !== false} onCheckedChange={(value) => setEditingMailbox({ ...editingMailbox, email_to_lead_enabled: value })} data-testid="mailbox-route-leads" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div><p className="text-sm font-medium">Create tickets for known clients</p><p className="text-xs text-muted-foreground">Known contacts bypass lead capture.</p></div>
              <Switch checked={Boolean(editingMailbox.email_to_ticket_enabled)} onCheckedChange={(value) => setEditingMailbox({ ...editingMailbox, email_to_ticket_enabled: value })} data-testid="mailbox-route-tickets" />
            </div>
          </div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMailbox(null)}>Cancel</Button>
            <Button onClick={handleUpdateMailbox} disabled={saving} data-testid="save-mailbox-routing">{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save routing</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(removingMailbox)} onOpenChange={(open) => !open && !removingMailboxBusy && setRemovingMailbox(null)}>
        <NexusWorkflowDialog
          eyebrow="Mailbox routing"
          title={`Remove ${removingMailbox?.mailbox_email || "this mailbox"}?`}
          description="Stop intake and outgoing delivery through this mailbox. Nexus will move any affected sender roles to a remaining mailbox; if this is the last mailbox, shared Microsoft 365 delivery is disconnected."
          icon={Unlink}
          tone="rose"
          className="max-w-lg"
          data-testid="remove-o365-mailbox-workflow"
          footer={<>
            <Button variant="outline" onClick={() => setRemovingMailbox(null)} disabled={removingMailboxBusy}>Keep mailbox</Button>
            <Button variant="destructive" onClick={handleRemoveMailbox} disabled={removingMailboxBusy} data-testid="confirm-remove-o365-mailbox">
              {removingMailboxBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlink className="mr-2 h-4 w-4" />}Remove mailbox
            </Button>
          </>}
        >
          <p className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3 text-sm text-muted-foreground">Existing tickets, leads, and delivery audit evidence remain in Nexus. Confirm the revised sender routing after removal.</p>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <NexusWorkflowDialog
          eyebrow="Mailbox connection"
          title="Disconnect Microsoft 365 mailbox?"
          description="Stop inbox sync, email intake, and outbound delivery from this Microsoft 365 connection. Existing tickets, leads, and delivery evidence stay in Nexus."
          icon={Unlink}
          tone="amber"
          className="max-w-lg"
          data-testid="disconnect-o365-workflow"
          footer={<>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)} disabled={disconnecting}>Keep connected</Button>
            <Button variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlink className="mr-2 h-4 w-4" />}Disconnect mailbox
            </Button>
          </>}
        >
          <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm text-muted-foreground">Reconnect only after confirming the sender mailbox, Microsoft Graph permissions, and routing policy.</p>
        </NexusWorkflowDialog>
      </Dialog>

      {/* Setup Dialog */}
      <Dialog open={isSetupOpen} onOpenChange={setIsSetupOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{isConnected ? "Add Microsoft 365 Mailbox" : "Connect Microsoft 365 Mailbox"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <SetupGuideCallout title="Azure app registration required" source="In Microsoft Entra admin centre, create an App registration, record its Directory (tenant) ID and Application (client) ID, create a Client Secret, then grant the required Microsoft Graph application permissions and administrator consent." steps={["Create the app registration in Microsoft Entra ID.", "Grant Mail.Read and Mail.Send application permissions; include Mail.ReadWrite only when the intended workflow requires it.", "Record the Client Secret in Keeper, then grant tenant-wide administrator consent and use Test Connection after saving."]} securityNote="The Client Secret is a password for the Azure app. Keep its source record in Keeper, enter it directly into this integration setting only when required, and replace it before it expires." helpSlug="email-intake-and-leads" />
            {isConnected && <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm text-muted-foreground" data-testid="same-tenant-mailbox-guidance">
              <p className="font-medium text-foreground">Use the existing Microsoft Graph connection</p>
              <p className="mt-1">Additional inboxes must belong to the same Microsoft 365 tenant and use the same approved Entra application as the shared delivery connection. This screen does not manage separate tenant connections.</p>
            </div>}
            <div className="space-y-2">
              <Label>{isConnected ? "Tenant ID (must match the existing connection) *" : "Tenant ID *"}</Label>
              <Input value={form.tenant_id} onChange={e => setForm({ ...form, tenant_id: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" readOnly={isConnected} data-testid="o365-tenant-id" />
            </div>
            <div className="space-y-2">
              <Label>{isConnected ? "Client ID (must match the existing connection) *" : "Client ID (Application ID) *"}</Label>
              <Input value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" readOnly={isConnected} data-testid="o365-client-id" />
            </div>
            <div className="space-y-2">
              <Label>{isConnected ? "Client Secret (existing app secret) *" : "Client Secret *"}</Label>
              <Input type="password" value={form.client_secret} onChange={e => setForm({ ...form, client_secret: e.target.value })} placeholder="Enter client secret" readOnly={isConnected} data-testid="o365-client-secret" />
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
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}{isConnected ? "Add inbox" : "Connect mailbox"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
