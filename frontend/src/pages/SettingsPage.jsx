import { useState, useEffect, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
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
import UnifiControllersManager from "@/components/unifi/UnifiControllersManager";
import ServiceTiersSettings from "@/components/settings/ServiceTiersSettings";
import { toast } from "sonner";
import { 
  User, Bell, Shield, Palette, Mail, Building, Save, Loader2, MessageSquare,
  Clock, Zap, CreditCard, FileText, AlertTriangle, Wifi, BookOpen, Brain,
  Trash2, Tag, Wrench, Link2, Unlink, TestTube, RefreshCw, UserPlus,
  CheckCircle, XCircle, KeyRound, Settings2, Plug, Upload, Image, Globe, Eye, EyeOff, Search,
  Smartphone, Copy, Cloud, Server, Activity
} from "lucide-react";

const TABS = [
  { id: "branding", label: "Platform Branding", icon: Palette },
  { id: "general", label: "General", icon: User },
  { id: "tiers", label: "Service Tiers", icon: Shield },
  { id: "auth", label: "Authentication", icon: KeyRound },
  { id: "mailbox", label: "Mailbox & Email", icon: Mail },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "ai", label: "AI & Automation", icon: Brain },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "tickets", label: "Ticket Defaults", icon: FileText },
  { id: "ping", label: "Ping & Escalation", icon: Activity },
  { id: "white-label", label: "White Label", icon: Image },
  { id: "channel", label: "Channel / MSP Mode", icon: Building },
  { id: "tokens", label: "API Tokens", icon: Server },
  { id: "twofa", label: "2FA / Security", icon: Shield },
  { id: "comms", label: "Notify Channels", icon: MessageSquare },
  { id: "my-settings", label: "My Workspace", icon: Settings2 },
];

// Settings tabs that are powered by separate page components, lazy-loaded inline
const LazyTicketSettings = lazy(() => import("./TicketSettingsPage"));
const LazyTicketPingSettings = lazy(() => import("./TicketPingSettingsPage"));
const LazyWhiteLabel = lazy(() => import("./WhiteLabelPage"));
const LazyChannelMode = lazy(() => import("./ChannelModePage"));
const LazyApiTokens = lazy(() => import("./ApiTokensPage"));
const LazySecurity2FA = lazy(() => import("./Security2FAPage"));
const LazyNotifyChannels = lazy(() => import("./NotifyChannelsPage"));
const LazyTechSettings = lazy(() => import("./TechSettingsPage"));

// Search index: maps keywords → (tab, card anchor, human label)
const SETTINGS_INDEX = [
  // Branding
  { tab: "branding", anchor: "branding-section", label: "Platform Branding", keywords: "branding logo company name colors favicon login tagline" },
  { tab: "branding", anchor: "branding-section", label: "Company Logo", keywords: "logo image upload" },
  { tab: "branding", anchor: "branding-section", label: "Favicon / Icon", keywords: "favicon icon browser tab" },
  { tab: "branding", anchor: "branding-section", label: "Primary / Accent Colors", keywords: "color theme primary accent secondary brand" },
  { tab: "branding", anchor: "branding-section", label: "Invoice Header / Footer", keywords: "invoice pdf branding header footer" },
  // General
  { tab: "general", anchor: "general-profile-card", label: "My Profile", keywords: "profile name email avatar user" },
  { tab: "general", anchor: "general-jobnumber-card", label: "Job Numbering Prefixes", keywords: "job number sla prefix workshop cabling ticket numbering" },
  { tab: "general", anchor: "general-threshold-card", label: "No-Notes Escalation Threshold", keywords: "sla no notes threshold escalation" },
  { tab: "general", anchor: "general-users-card", label: "Team / Users", keywords: "users team technicians accounts invite" },
  { tab: "general", anchor: "general-canned-card", label: "Canned Responses", keywords: "canned ticket response template reply" },
  // Service Tiers
  { tab: "tiers", anchor: "service-tiers-card", label: "Service Tiers", keywords: "service tier bronze silver gold platinum diamond sla msp plan level price" },
  // Auth
  { tab: "auth", anchor: "auth-sso-card", label: "Microsoft SSO", keywords: "sso microsoft azure ad entra single sign on oauth" },
  // Mailbox
  { tab: "mailbox", anchor: "mailbox-o365-card", label: "Microsoft 365 Inbox", keywords: "mailbox o365 office365 inbox ticket email to ticket" },
  { tab: "mailbox", anchor: "mailbox-signature-card", label: "Email Signature", keywords: "email signature reply template" },
  // Integrations
  { tab: "integrations", anchor: "xero-settings-card", label: "Xero Accounting", keywords: "xero accounting integration invoice sync" },
  { tab: "integrations", anchor: "stripe-api-key", label: "Stripe Payments", keywords: "stripe payment checkout card api key invoice" },
  { tab: "integrations", anchor: "resend-settings-card", label: "Resend Email Delivery", keywords: "resend email smtp api key transactional onboarding welcome email notifications" },
  { tab: "integrations", anchor: "sms-settings-card", label: "SMS Messaging (MobileMessage)", keywords: "sms text message mobilemessage mobile message webhook inbound phone send receive balance credits" },
  { tab: "integrations", anchor: "acronis-settings-card", label: "Acronis Cyber Cloud", keywords: "acronis backup cyber cloud protect tenant" },
  { tab: "integrations", anchor: "pax8-settings-card", label: "Pax8 (Microsoft / CSP)", keywords: "pax8 microsoft csp m365 defender azure licenses subscriptions billing" },
  { tab: "integrations", anchor: "huntress-settings-card", label: "Huntress (Security)", keywords: "huntress security soc edr mdr managed detection incidents agents signals endpoint" },
  { tab: "integrations", anchor: "suped-settings-card", label: "SupED", keywords: "suped" },
  { tab: "integrations", anchor: "cipp-settings-card", label: "CIPP (M365 management)", keywords: "cipp cyberdrain m365 microsoft 365 tenant management users licenses offboarding" },
  { tab: "integrations", anchor: "unifi-settings-card", label: "UniFi", keywords: "unifi ubiquiti network sites devices clients access points switches" },
  { tab: "integrations", anchor: "nexus-agent-settings-card", label: "NexusOps Agent", keywords: "nexus agent rmm in-house windows agent patches scripts splashtop" },
  { tab: "integrations", anchor: "splynx-settings-card", label: "Splynx ISP billing", keywords: "splynx isp billing telco" },
  { tab: "integrations", anchor: "hudu-settings-card", label: "Hudu documentation", keywords: "hudu documentation passwords knowledge base" },
  { tab: "integrations", anchor: "syncro-settings-card", label: "Syncro PSA", keywords: "syncro psa migration import" },
  // AI
  { tab: "ai", anchor: "ai-config-card", label: "AI Provider & Model", keywords: "ai openai anthropic gemini claude gpt model provider emergent llm key" },
  // Notifications
  { tab: "notifications", anchor: "notifications-prefs-card", label: "Email Alerts & Preferences", keywords: "notification email alerts preferences sla warnings device offline" },
];

export default function SettingsPage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("branding");
  const [settingSearch, setSettingSearch] = useState("");
  const [highlightAnchor, setHighlightAnchor] = useState("");
  const [loading, setLoading] = useState(false);

  // Honour deep-links: /settings?tab=integrations&anchor=huntress-settings-card
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const anchor = params.get("anchor");
    if (tab) setActiveTab(tab);
    if (anchor) {
      setHighlightAnchor(anchor);
      setTimeout(() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 400);
    }
  }, []);
  const [users, setUsers] = useState([]);
  const [branding, setBranding] = useState({
    company_name: "NexusOps", company_logo_url: "", company_icon_url: "",
    primary_color: "#10b981", secondary_color: "#8b5cf6", accent_color: "#06b6d4",
    login_tagline: "", login_features: ["RMM", "Ticketing", "Invoicing", "Networking", "Assets", "Reporting"],
    powered_by_visible: true, sidebar_style: "default",
    invoice_logo_url: "", invoice_header_text: "", invoice_footer_text: "",
    email_sender_name: "", email_footer_text: "", favicon_url: "",
  });
  const [brandingSaving, setBrandingSaving] = useState(false);
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
  const [resend, setResend] = useState({ api_key: "", sender_email: "", reply_to: "", api_key_set: false, configured_from: "none", last_test_result: null, last_test_at: null, updated_at: null, updated_by: null });
  const [resendSaving, setResendSaving] = useState(false);
  const [resendTesting, setResendTesting] = useState(false);
  const [resendTestEmail, setResendTestEmail] = useState("");
  const [sms, setSms] = useState({ username: "", password: "", default_sender: "", signature: "Kind Regards, NexusMSP", append_signature: true, password_set: false, enabled: false, status_webhook_url: "", inbound_webhook_url: "", last_balance: null, last_balance_at: null, last_test_result: null, last_test_at: null, last_test_message: "", updated_at: null, updated_by: null });
  const [smsSenders, setSmsSenders] = useState([]);
  const [smsTestTo, setSmsTestTo] = useState("");
  const [smsTestMessage, setSmsTestMessage] = useState("NexusOps SMS test — integration working correctly.");
  const [smsSaving, setSmsSaving] = useState(false);
  const [smsTesting, setSmsTesting] = useState(false);
  const [acronis, setAcronis] = useState({ api_url: "", client_id: "", client_secret: "", connected: false, testing: false });
  const [pax8, setPax8] = useState({ client_id: "", client_secret: "", client_secret_set: false, enabled: false, last_test_result: null, last_test_at: null, last_test_message: "", last_sync_at: null, last_sync_stats: null });
  const [pax8Busy, setPax8Busy] = useState(false);
  const [huntress, setHuntress] = useState({ api_key: "", secret_key: "", configured: false, api_key_preview: null, last_test_status: null, last_tested_at: null, last_synced_at: null });
  const [huntressBusy, setHuntressBusy] = useState(false);
  const [suped, setSuped] = useState({ api_key: "", configured: false });
  const [supedSaving, setSupedSaving] = useState(false);
  const [cipp, setCipp] = useState({ base_url: "", api_key: "", configured: false, api_key_preview: null, last_test_status: null, last_tested_at: null, last_synced_at: null });
  const [cippBusy, setCippBusy] = useState(false);
  const [unifi, setUnifi] = useState({ base_url: "", api_key: "", configured: false, api_key_preview: null, last_test_status: null, last_tested_at: null, last_synced_at: null });
  const [unifiBusy, setUnifiBusy] = useState(false);
  const [trmm] = useState({ configured: false }); // legacy — TRMM removed, kept for backwards-compat with old loadAll
  const trmmBusy = false;
  const setTrmmBusy = () => {};
  const trmmNotif = { configured: false, slack_webhook_url: "", teams_webhook_url: "", notify_on: "all" };
  const trmmNotifBusy = false;
  const setTrmm = () => {};
  const setTrmmNotif = () => {};
  const setTrmmNotifBusy = () => {};
  const [splynx, setSplynx] = useState({ url: "", api_key: "", api_secret: "", configured: false });
  const [splynxSaving, setSplynxSaving] = useState(false);
  const [hudu, setHudu] = useState({ url: "", api_key: "", configured: false });
  const [huduSaving, setHuduSaving] = useState(false);
  const [syncro, setSyncro] = useState({ subdomain: "", api_key: "", enabled: false });
  const [syncroSaving, setSyncroSaving] = useState(false);
  const [aiConfig, setAiConfig] = useState({ provider: "anthropic", model: "claude-sonnet-4-5-20250929" });
  const [aiSaving, setAiSaving] = useState(false);
  const [jobNumbering, setJobNumbering] = useState({ sla_prefix: "SLA-", workshop_prefix: "WS-", cabling_prefix: "CW-" });
  const [jnSaving, setJnSaving] = useState(false);
  const [emailSig, setEmailSig] = useState("");
  const [sigSaving, setSigSaving] = useState(false);
  const [cannedResponses, setCannedResponses] = useState([]);
  const [cannedForm, setCannedForm] = useState({ title: "", content: "", category: "general" });
  const [msSSO, setMsSSO] = useState({ enabled: false, tenant_id: "", client_id: "", client_secret: "", redirect_uri: "", auto_create_users: true, default_role: "tech" });
  const [msSSOSaving, setMsSSOSaving] = useState(false);
  // Mailbox state
  const [mailbox, setMailbox] = useState(null);
  const [mailboxForm, setMailboxForm] = useState({
    tenant_id: "", client_id: "", client_secret: "", redirect_uri: "", mailbox_email: "",
    email_to_lead_enabled: true, email_to_ticket_enabled: false,
    auto_reply_enabled: false, auto_reply_message: "Thank you for contacting us. We have received your inquiry and will respond shortly.",
  });
  const [mailboxSaving, setMailboxSaving] = useState(false);
  const [mailboxTesting, setMailboxTesting] = useState(false);
  const [emailLeads, setEmailLeads] = useState([]);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersRes, thresholdRes, xeroRes, stripeRes, supedRes, splynxRes, huduRes, aiRes, syncroRes, jnRes, ssoRes, mbxRes, leadsRes, brandingRes, acronisRes, resendRes, smsRes, pax8Res, huntressRes, cippRes, unifiRes, trmmRes, trmmNotifRes] = await Promise.all([
          axios.get(`${API}/users`, { headers }),
          axios.get(`${API}/settings/no-notes-threshold`, { headers }),
          axios.get(`${API}/settings/xero`, { headers }),
          axios.get(`${API}/settings/stripe`, { headers }),
          axios.get(`${API}/settings/suped`, { headers }),
          axios.get(`${API}/settings/splynx`, { headers }),
          axios.get(`${API}/settings/hudu`, { headers }),
          axios.get(`${API}/ai/config`, { headers }),
          axios.get(`${API}/syncro/settings`, { headers }).catch(() => ({ data: { subdomain: "", api_key: "", enabled: false } })),
          axios.get(`${API}/settings/job-numbering`, { headers }).catch(() => ({ data: { sla_prefix: "SLA-", workshop_prefix: "WS-", cabling_prefix: "CW-" } })),
          axios.get(`${API}/settings/microsoft-sso`, { headers }).catch(() => ({ data: {} })),
          axios.get(`${API}/settings/o365-mailbox`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/o365/email-leads`, { headers }).catch(() => ({ data: [] })),
          axios.get(`${API}/settings/branding`, { headers }).catch(() => ({ data: {} })),
          axios.get(`${API}/acronis/config`, { headers }).catch(() => ({ data: {} })),
          axios.get(`${API}/settings/resend`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/settings/sms`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/settings/pax8`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/huntress/status`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/cipp/status`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/unifi/status`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/trmm/status`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/trmm/notifications/settings`, { headers }).catch(() => ({ data: null })),
        ]);
        setUsers(usersRes.data);
        setThreshold(thresholdRes.data);
        setXero(xeroRes.data);
        setStripe(stripeRes.data);
        if (acronisRes.data) setAcronis(prev => ({ ...prev, api_url: acronisRes.data.api_url || "", client_id: acronisRes.data.client_id || "", connected: acronisRes.data.connected || false }));
        if (resendRes?.data) setResend(prev => ({ ...prev, ...resendRes.data, api_key: "" }));
        if (smsRes?.data) setSms(prev => ({ ...prev, ...smsRes.data, password: "" }));
        if (pax8Res?.data) setPax8(prev => ({ ...prev, ...pax8Res.data, client_secret: "" }));
        if (huntressRes?.data) setHuntress(prev => ({ ...prev, ...huntressRes.data, api_key: "", secret_key: "" }));
        if (cippRes?.data) setCipp(prev => ({ ...prev, ...cippRes.data, api_key: "" }));
        if (unifiRes?.data) setUnifi(prev => ({ ...prev, ...unifiRes.data, api_key: "" }));
        if (trmmRes?.data) setTrmm(prev => ({ ...prev, ...trmmRes.data, api_key: "" }));
        if (trmmNotifRes?.data) setTrmmNotif(prev => ({ ...prev, ...trmmNotifRes.data }));
        setSuped(supedRes.data);
        setSplynx(splynxRes.data);
        setHudu(huduRes.data);
        if (aiRes.data.provider) setAiConfig(aiRes.data);
        setSyncro(syncroRes.data);
        if (jnRes.data) setJobNumbering(jnRes.data);
        if (ssoRes.data && ssoRes.data.type) setMsSSO(prev => ({ ...prev, ...ssoRes.data }));
        if (brandingRes.data && brandingRes.data.company_name) setBranding(prev => ({ ...prev, ...brandingRes.data }));
        if (mbxRes.data) {
          setMailbox(mbxRes.data);
          if (mbxRes.data.tenant_id) {
            setMailboxForm(f => ({
              ...f, tenant_id: mbxRes.data.tenant_id || "", client_id: mbxRes.data.client_id || "",
              client_secret: mbxRes.data.client_secret ? "********" : "",
              redirect_uri: mbxRes.data.redirect_uri || "", mailbox_email: mbxRes.data.mailbox_email || "",
              email_to_lead_enabled: mbxRes.data.email_to_lead_enabled !== false,
              email_to_ticket_enabled: mbxRes.data.email_to_ticket_enabled || false,
              auto_reply_enabled: mbxRes.data.auto_reply_enabled || false,
              auto_reply_message: mbxRes.data.auto_reply_message || f.auto_reply_message,
            }));
          }
        }
        setEmailLeads(leadsRes.data || []);
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

  const handleSaveJobNumbering = async () => {
    setJnSaving(true);
    try {
      await axios.put(`${API}/settings/job-numbering`, jobNumbering, { headers });
      toast.success("Job numbering settings saved");
    } catch { toast.error("Failed to save job numbering"); }
    finally { setJnSaving(false); }
  };

  // Mailbox handlers
  const handleMailboxConnect = async () => {
    if (!mailboxForm.tenant_id || !mailboxForm.client_id || !mailboxForm.client_secret || !mailboxForm.mailbox_email) {
      toast.error("All Azure AD credentials and mailbox email are required"); return;
    }
    setMailboxSaving(true);
    try {
      await axios.post(`${API}/o365/connect`, mailboxForm, { headers });
      toast.success("Office 365 mailbox connected!");
      const [mbxRes, leadsRes] = await Promise.all([
        axios.get(`${API}/settings/o365-mailbox`, { headers }),
        axios.get(`${API}/o365/email-leads`, { headers }).catch(() => ({ data: [] })),
      ]);
      setMailbox(mbxRes.data); setEmailLeads(leadsRes.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to connect"); }
    finally { setMailboxSaving(false); }
  };

  const handleMailboxDisconnect = async () => {
    if (!confirm("Disconnect Office 365 mailbox?")) return;
    try {
      await axios.post(`${API}/o365/disconnect`, {}, { headers });
      toast.success("Disconnected"); setMailbox(prev => ({ ...prev, connected: false }));
    } catch { toast.error("Failed to disconnect"); }
  };

  const handleMailboxTest = async () => {
    setMailboxTesting(true);
    try {
      const res = await axios.post(`${API}/o365/test-connection`, {}, { headers });
      if (res.data.success) toast.success("Connection test passed!"); else toast.error(res.data.message);
    } catch { toast.error("Test failed"); }
    finally { setMailboxTesting(false); }
  };

  const handleMailboxSettingsSave = async () => {
    setMailboxSaving(true);
    try {
      await axios.put(`${API}/settings/o365-mailbox`, {
        email_to_lead_enabled: mailboxForm.email_to_lead_enabled,
        email_to_ticket_enabled: mailboxForm.email_to_ticket_enabled,
        auto_reply_enabled: mailboxForm.auto_reply_enabled,
        auto_reply_message: mailboxForm.auto_reply_message,
      }, { headers });
      toast.success("Mailbox settings saved");
    } catch { toast.error("Failed to save"); }
    finally { setMailboxSaving(false); }
  };

  const handleTestIncomingEmail = async () => {
    try {
      await axios.post(`${API}/o365/webhook/incoming-email`, {
        from_address: "demo@testclient.com", from_name: "Demo User",
        subject: "Interested in your IT services",
        body: "Hi, we are looking for a managed service provider for our office of 25 people. Can you send us a proposal?",
      }, { headers });
      toast.success("Test email processed - check Leads page");
      const leadsRes = await axios.get(`${API}/o365/email-leads`, { headers }).catch(() => ({ data: [] }));
      setEmailLeads(leadsRes.data || []);
    } catch { toast.error("Failed to process test email"); }
  };

  const mailboxConnected = mailbox?.connected;

  const filteredResults = settingSearch.trim().length >= 2
    ? SETTINGS_INDEX.filter(item =>
        item.label.toLowerCase().includes(settingSearch.toLowerCase()) ||
        item.keywords.toLowerCase().includes(settingSearch.toLowerCase())
      ).slice(0, 8)
    : [];

  // Apply/remove highlight CSS class to the targeted card
  useEffect(() => {
    if (!highlightAnchor) return;
    const el = document.querySelector(`[data-testid="${highlightAnchor}"]`);
    if (!el) return;
    el.setAttribute("data-settings-highlight", "true");
    const t = setTimeout(() => el.removeAttribute("data-settings-highlight"), 2200);
    return () => { clearTimeout(t); el.removeAttribute("data-settings-highlight"); };
  }, [highlightAnchor, activeTab]);

  const jumpToSetting = (item) => {
    setActiveTab(item.tab);
    setSettingSearch("");
    setHighlightAnchor(item.anchor);
    // Wait for the target tab's DOM to mount, then scroll
    setTimeout(() => {
      const el = document.querySelector(`[data-testid="${item.anchor}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setTimeout(() => setHighlightAnchor(""), 2500);
    }, 150);
  };

  return (
    <div className="max-w-5xl" data-testid="settings-page">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Platform configuration, integrations, and preferences</p>
        </div>
        {/* Quick search */}
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={settingSearch}
            onChange={e => setSettingSearch(e.target.value)}
            placeholder="Search settings… (e.g. 'resend', 'stripe', 'logo')"
            className="pl-9 h-10"
            data-testid="settings-search-input"
          />
          {filteredResults.length > 0 && (
            <div className="absolute z-20 mt-1 w-full border bg-background shadow-xl rounded-md overflow-hidden" data-testid="settings-search-results">
              {filteredResults.map((item, idx) => {
                const tabMeta = TABS.find(t => t.id === item.tab);
                const TabIcon = tabMeta?.icon || Settings2;
                return (
                  <button
                    key={idx}
                    onClick={() => jumpToSetting(item)}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-muted text-sm border-b last:border-b-0"
                    data-testid={`settings-search-result-${idx}`}
                  >
                    <TabIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <Badge variant="outline" className="text-[9px]">{tabMeta?.label || item.tab}</Badge>
                  </button>
                );
              })}
            </div>
          )}
          {settingSearch.trim().length >= 2 && filteredResults.length === 0 && (
            <div className="absolute z-20 mt-1 w-full border bg-background shadow-xl rounded-md p-3 text-xs text-muted-foreground" data-testid="settings-search-empty">
              No matches for "<span className="font-mono">{settingSearch}</span>"
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-3 border-b border-border/50 pb-px overflow-x-auto" data-testid="settings-tabs">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${activeTab === tab.id ? "bg-muted text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
              data-testid={`settings-tab-${tab.id}`}>
              <Icon className="w-4 h-4" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* Other settings hub — quick-access cards to dedicated settings sub-pages */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6" data-testid="settings-hub-row">
        <button onClick={() => navigate("/tickets/settings")} className="text-left rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-500/40 p-3 transition-all" data-testid="hub-ticket-settings">
          <div className="text-[10px] uppercase tracking-[0.2em] text-violet-300/80 font-mono mb-1">Ticket Settings</div>
          <div className="text-sm font-medium">SLA · Workflows · Templates</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Configure ticket numbering, SLA tiers, workflows</div>
        </button>
        <button onClick={() => navigate("/ticket-ping/settings")} className="text-left rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-cyan-500/40 p-3 transition-all" data-testid="hub-ticket-ping">
          <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300/80 font-mono mb-1">Ticket Ping</div>
          <div className="text-sm font-medium">Live alerts · Sound</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Notification rules &amp; sounds</div>
        </button>
        <button onClick={() => navigate("/tech/settings")} className="text-left rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-amber-500/40 p-3 transition-all" data-testid="hub-tech-settings">
          <div className="text-[10px] uppercase tracking-[0.2em] text-amber-300/80 font-mono mb-1">Tech Settings</div>
          <div className="text-sm font-medium">Per-user prefs</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Density · views · personal toggles</div>
        </button>
        <button onClick={() => navigate("/profile")} className="text-left rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-emerald-500/40 p-3 transition-all" data-testid="hub-tech-profile">
          <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/80 font-mono mb-1">My Profile</div>
          <div className="text-sm font-medium">Bio · Skills · CSAT · Achievements</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Public tech profile &amp; gamification</div>
        </button>
      </div>

      <style>{`
        [data-settings-highlight="true"] {
          box-shadow: 0 0 0 2px hsl(var(--primary));
          transition: box-shadow 0.3s ease;
        }
      `}</style>

      <div className="space-y-6">

      {/* ==================== PLATFORM BRANDING TAB ==================== */}
      {activeTab === "branding" && (<>
        <Card data-testid="branding-section">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Palette className="w-5 h-5" />Company Identity</CardTitle>
            <CardDescription>Set your company name, logo, and colors. These appear across the entire platform.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Company / Platform Name</Label><Input value={branding.company_name || ""} onChange={e => setBranding(p => ({ ...p, company_name: e.target.value }))} placeholder="Your Company Name" data-testid="branding-company-name" /><p className="text-[10px] text-muted-foreground mt-1">Replaces "NexusOps" in sidebar, login page, and browser tab</p></div>
              <div><Label>Email Sender Name</Label><Input value={branding.email_sender_name || ""} onChange={e => setBranding(p => ({ ...p, email_sender_name: e.target.value }))} placeholder="Your Company IT Support" /><p className="text-[10px] text-muted-foreground mt-1">Used as the "From" name in outgoing emails</p></div>
            </div>

            <Separator />
            <Label className="text-sm font-semibold">Logo & Icon</Label>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Company Logo (sidebar)</Label>
                <div className="border-2 border-dashed rounded-lg p-4 text-center hover:border-primary/50 transition-colors">
                  {branding.company_logo_url ? <img src={branding.company_logo_url} alt="Logo" className="h-10 mx-auto mb-2 object-contain" onError={e => { e.target.style.display = 'none'; }} /> : <Building className="w-8 h-8 mx-auto text-muted-foreground mb-2" />}
                  <input type="file" accept="image/*" className="hidden" id="logo-upload" onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    const formData = new FormData(); formData.append("file", file);
                    try { const res = await axios.post(`${API}/settings/branding/upload-logo?logo_type=company`, formData, { headers: { ...headers, "Content-Type": "multipart/form-data" } }); setBranding(p => ({ ...p, company_logo_url: res.data.url })); toast.success("Logo uploaded"); } catch { toast.error("Upload failed"); }
                  }} />
                  <Button size="sm" variant="outline" onClick={() => document.getElementById("logo-upload").click()} data-testid="upload-logo-btn"><Upload className="w-3 h-3 mr-1" />Upload Logo</Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Sidebar Icon (small)</Label>
                <div className="border-2 border-dashed rounded-lg p-4 text-center hover:border-primary/50 transition-colors">
                  {branding.company_icon_url ? <img src={branding.company_icon_url} alt="Icon" className="h-10 w-10 mx-auto mb-2 object-contain" onError={e => { e.target.style.display = 'none'; }} /> : <Image className="w-8 h-8 mx-auto text-muted-foreground mb-2" />}
                  <input type="file" accept="image/*" className="hidden" id="icon-upload" onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    const formData = new FormData(); formData.append("file", file);
                    try { const res = await axios.post(`${API}/settings/branding/upload-logo?logo_type=icon`, formData, { headers: { ...headers, "Content-Type": "multipart/form-data" } }); setBranding(p => ({ ...p, company_icon_url: res.data.url })); toast.success("Icon uploaded"); } catch { toast.error("Upload failed"); }
                  }} />
                  <Button size="sm" variant="outline" onClick={() => document.getElementById("icon-upload").click()}><Upload className="w-3 h-3 mr-1" />Upload Icon</Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Invoice / PDF Logo</Label>
                <div className="border-2 border-dashed rounded-lg p-4 text-center hover:border-primary/50 transition-colors">
                  {branding.invoice_logo_url ? <img src={branding.invoice_logo_url} alt="Invoice Logo" className="h-10 mx-auto mb-2 object-contain" onError={e => { e.target.style.display = 'none'; }} /> : <FileText className="w-8 h-8 mx-auto text-muted-foreground mb-2" />}
                  <input type="file" accept="image/*" className="hidden" id="invoice-logo-upload" onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    const formData = new FormData(); formData.append("file", file);
                    try { const res = await axios.post(`${API}/settings/branding/upload-logo?logo_type=invoice`, formData, { headers: { ...headers, "Content-Type": "multipart/form-data" } }); setBranding(p => ({ ...p, invoice_logo_url: res.data.url })); toast.success("Invoice logo uploaded"); } catch { toast.error("Upload failed"); }
                  }} />
                  <Button size="sm" variant="outline" onClick={() => document.getElementById("invoice-logo-upload").click()}><Upload className="w-3 h-3 mr-1" />Upload</Button>
                </div>
              </div>
            </div>

            <Separator />
            <Label className="text-sm font-semibold">Brand Colors</Label>
            <div className="grid grid-cols-3 gap-4">
              <div><Label className="text-xs">Primary Color</Label><div className="flex gap-2 items-center"><input type="color" value={branding.primary_color || "#10b981"} onChange={e => setBranding(p => ({ ...p, primary_color: e.target.value }))} className="w-10 h-10 rounded cursor-pointer border-0" /><Input value={branding.primary_color || ""} onChange={e => setBranding(p => ({ ...p, primary_color: e.target.value }))} className="font-mono text-xs" /></div></div>
              <div><Label className="text-xs">Secondary Color</Label><div className="flex gap-2 items-center"><input type="color" value={branding.secondary_color || "#8b5cf6"} onChange={e => setBranding(p => ({ ...p, secondary_color: e.target.value }))} className="w-10 h-10 rounded cursor-pointer border-0" /><Input value={branding.secondary_color || ""} onChange={e => setBranding(p => ({ ...p, secondary_color: e.target.value }))} className="font-mono text-xs" /></div></div>
              <div><Label className="text-xs">Accent Color</Label><div className="flex gap-2 items-center"><input type="color" value={branding.accent_color || "#06b6d4"} onChange={e => setBranding(p => ({ ...p, accent_color: e.target.value }))} className="w-10 h-10 rounded cursor-pointer border-0" /><Input value={branding.accent_color || ""} onChange={e => setBranding(p => ({ ...p, accent_color: e.target.value }))} className="font-mono text-xs" /></div></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />Login Page Customization</CardTitle>
            <CardDescription>Customize the text and features shown on the login page</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div><Label>Login Tagline</Label><Input value={branding.login_tagline || ""} onChange={e => setBranding(p => ({ ...p, login_tagline: e.target.value }))} placeholder="Unified RMM & PSA platform for modern managed service providers" /><p className="text-[10px] text-muted-foreground mt-1">Shown below the main heading on the login page</p></div>
            <div><Label>Feature Pills (comma-separated)</Label><Input value={(branding.login_features || []).join(", ")} onChange={e => setBranding(p => ({ ...p, login_features: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))} placeholder="RMM, Ticketing, Invoicing, Networking, Assets, Reporting" /><p className="text-[10px] text-muted-foreground mt-1">Tags shown at the bottom of the login hero section</p></div>
            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <Switch checked={branding.powered_by_visible !== false} onCheckedChange={v => setBranding(p => ({ ...p, powered_by_visible: v }))} data-testid="powered-by-toggle" />
              <div><p className="text-sm font-medium">Show "Made with Emergent" badge</p><p className="text-[10px] text-muted-foreground">Toggle the powered-by badge visibility</p></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />Invoice & Email Branding</CardTitle>
            <CardDescription>Customize text that appears on invoices and outgoing emails</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Invoice Header Text</Label><Input value={branding.invoice_header_text || ""} onChange={e => setBranding(p => ({ ...p, invoice_header_text: e.target.value }))} placeholder="Your Company Pty Ltd | ABN 12 345 678 901" /></div>
              <div><Label>Invoice Footer Text</Label><Input value={branding.invoice_footer_text || ""} onChange={e => setBranding(p => ({ ...p, invoice_footer_text: e.target.value }))} placeholder="Payment terms: Net 30 | BSB: 123-456 | Acc: 12345678" /></div>
            </div>
            <div><Label>Email Footer Text</Label><Input value={branding.email_footer_text || ""} onChange={e => setBranding(p => ({ ...p, email_footer_text: e.target.value }))} placeholder="Your Company | 123 Main St | support@company.com" /></div>
          </CardContent>
        </Card>

        <Button onClick={async () => {
          setBrandingSaving(true);
          try {
            await axios.put(`${API}/settings/branding`, branding, { headers });
            toast.success("Branding settings saved! Refresh to see changes across the platform.");
          } catch { toast.error("Failed to save branding"); }
          finally { setBrandingSaving(false); }
        }} disabled={brandingSaving} className="w-full" data-testid="save-branding-btn">
          {brandingSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          Save Branding Settings
        </Button>
      </>)}

      {/* ==================== GENERAL TAB ==================== */}
      {activeTab === "general" && (<>

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
      <Card data-testid="mailbox-signature-card">
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
            <p className="text-xs text-muted-foreground">This signature is automatically appended to all emails sent from tickets. Supports full HTML formatting, tables, and inline images. <strong>Pro tip:</strong> click the <span className="font-mono bg-muted px-1 rounded">HTML</span> toggle in the editor to paste a full raw HTML signature (e.g. exported from Outlook → File → Save As → Web Page). Outlook <code>cid:</code> inline images won't render — host images on a public URL or paste them as base64 data URIs.</p>
            <RichTextEditor content={emailSig} onChange={setEmailSig} minHeight="300px" />
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
      <Card data-testid="notifications-prefs-card">
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

      {/* Job Numbering - in General tab */}
      <Card data-testid="general-jobnumber-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" />
            <CardTitle>Job Numbering</CardTitle>
          </div>
          <CardDescription>Configure the prefix for ticket numbers across different job types</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Shield className="w-4 h-4 text-blue-400" />SLA Prefix</Label>
              <Input value={jobNumbering.sla_prefix} onChange={e => setJobNumbering(j => ({ ...j, sla_prefix: e.target.value }))} placeholder="SLA-" data-testid="jn-sla" />
              <p className="text-xs text-muted-foreground">e.g. {jobNumbering.sla_prefix || "SLA-"}00001</p>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Wrench className="w-4 h-4 text-purple-400" />Workshop Prefix</Label>
              <Input value={jobNumbering.workshop_prefix} onChange={e => setJobNumbering(j => ({ ...j, workshop_prefix: e.target.value }))} placeholder="WS-" data-testid="jn-workshop" />
              <p className="text-xs text-muted-foreground">e.g. {jobNumbering.workshop_prefix || "WS-"}00001</p>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Wifi className="w-4 h-4 text-cyan-400" />Cabling / WISP Prefix</Label>
              <Input value={jobNumbering.cabling_prefix} onChange={e => setJobNumbering(j => ({ ...j, cabling_prefix: e.target.value }))} placeholder="CW-" data-testid="jn-cabling" />
              <p className="text-xs text-muted-foreground">e.g. {jobNumbering.cabling_prefix || "CW-"}00001</p>
            </div>
          </div>
          <Button onClick={handleSaveJobNumbering} disabled={jnSaving} data-testid="save-jn-btn">
            {jnSaving ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Saving...</> : "Save Prefixes"}
          </Button>
        </CardContent>
      </Card>
      </>)}

      {/* ==================== AUTH TAB ==================== */}
      {activeTab === "tiers" && (
        <ServiceTiersSettings />
      )}

      {activeTab === "auth" && (<>

      {/* Microsoft SSO */}
      <Card className="border-blue-500/20" data-testid="auth-sso-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-500" />
            <CardTitle>Microsoft SSO (Single Sign-On)</CardTitle>
          </div>
          <CardDescription>Allow technicians to sign in with their Microsoft / Azure AD account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Microsoft SSO</Label>
              <p className="text-sm text-muted-foreground">Show "Sign in with Microsoft" button on login page</p>
            </div>
            <Switch checked={msSSO.enabled} onCheckedChange={(v) => setMsSSO({ ...msSSO, enabled: v })} data-testid="sso-enabled-switch" />
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Azure AD Tenant ID</Label>
              <Input value={msSSO.tenant_id} onChange={e => setMsSSO({ ...msSSO, tenant_id: e.target.value })} placeholder="e.g. common or your-tenant-guid" data-testid="sso-tenant-id" />
            </div>
            <div className="space-y-2">
              <Label>Application (Client) ID</Label>
              <Input value={msSSO.client_id} onChange={e => setMsSSO({ ...msSSO, client_id: e.target.value })} placeholder="Azure App Client ID" data-testid="sso-client-id" />
            </div>
            <div className="space-y-2">
              <Label>Client Secret (optional for public apps)</Label>
              <Input type="password" value={msSSO.client_secret} onChange={e => setMsSSO({ ...msSSO, client_secret: e.target.value })} placeholder="Azure App Client Secret" data-testid="sso-client-secret" />
            </div>
            <div className="space-y-2">
              <Label>Redirect URI (auto-detected if blank)</Label>
              <Input value={msSSO.redirect_uri} onChange={e => setMsSSO({ ...msSSO, redirect_uri: e.target.value })} placeholder="https://your-domain/api/auth/microsoft/callback" data-testid="sso-redirect-uri" />
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-Create Users</Label>
              <p className="text-sm text-muted-foreground">Automatically create a NexusOps account when a new Microsoft user signs in</p>
            </div>
            <Switch checked={msSSO.auto_create_users} onCheckedChange={(v) => setMsSSO({ ...msSSO, auto_create_users: v })} data-testid="sso-auto-create-switch" />
          </div>
          <div className="space-y-2">
            <Label>Default Role for SSO Users</Label>
            <Select value={msSSO.default_role} onValueChange={v => setMsSSO({ ...msSSO, default_role: v })}>
              <SelectTrigger data-testid="sso-default-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="tech">Technician</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-400">
            <strong>Setup instructions:</strong> Register an app in <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps" target="_blank" rel="noreferrer" className="underline">Azure Portal → App registrations</a>. Add a Web redirect URI pointing to your NexusOps callback URL. Grant <code>User.Read</code>, <code>email</code>, <code>profile</code>, <code>openid</code> delegated permissions.
          </div>
          <Button onClick={async () => {
            setMsSSOSaving(true);
            try {
              await axios.put(`${API}/settings/microsoft-sso`, msSSO, { headers });
              toast.success("Microsoft SSO settings saved");
            } catch { toast.error("Failed to save SSO settings"); }
            finally { setMsSSOSaving(false); }
          }} disabled={msSSOSaving} data-testid="save-sso-btn">
            {msSSOSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save SSO Settings
          </Button>
        </CardContent>
      </Card>
      </>)}

      {/* ==================== MAILBOX TAB ==================== */}
      {activeTab === "mailbox" && (<>

      {/* Mailbox Connection Status */}
      <Card className={mailboxConnected ? "border-emerald-500/30" : "border-amber-500/30"}>
        <CardContent className="py-5">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${mailboxConnected ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
              <Mail className={`w-7 h-7 ${mailboxConnected ? "text-emerald-400" : "text-amber-400"}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg">Office 365 Mailbox</h3>
                {mailboxConnected ? (
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"><CheckCircle className="w-3 h-3 mr-1" />Connected</Badge>
                ) : (
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30"><XCircle className="w-3 h-3 mr-1" />Not Connected</Badge>
                )}
              </div>
              {mailboxConnected ? (
                <p className="text-sm text-muted-foreground">Connected to <span className="font-mono text-foreground">{mailbox?.mailbox_email}</span> &middot; Last sync: {mailbox?.last_sync ? new Date(mailbox.last_sync).toLocaleString() : "Never"}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Connect your O365 mailbox to auto-generate leads and tickets from incoming emails.</p>
              )}
            </div>
            <div className="flex gap-2">
              {mailboxConnected && (
                <>
                  <Button variant="outline" size="sm" onClick={async () => {
                    try { const r = await axios.post(`${API}/o365/sync-emails`, {}, { headers }); toast.success(r.data.message); } catch { toast.error("Sync failed"); }
                  }}><RefreshCw className="w-4 h-4 mr-1" />Sync</Button>
                  <Button variant="outline" size="sm" onClick={handleMailboxTest} disabled={mailboxTesting}>
                    {mailboxTesting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <TestTube className="w-4 h-4 mr-1" />}Test
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleMailboxDisconnect} data-testid="disconnect-mailbox-btn"><Unlink className="w-4 h-4 mr-1" />Disconnect</Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {!mailboxConnected && (
        <Card>
          <CardHeader><CardTitle className="text-base">Connect Office 365 Mailbox</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-muted-foreground">
              <p className="font-medium text-blue-400 mb-1">Azure AD App Registration Required</p>
              <p>Go to <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps" target="_blank" rel="noreferrer" className="underline text-blue-400">portal.azure.com</a> &gt; App registrations &gt; New registration. Grant <span className="font-mono">Mail.Read, Mail.Send, Mail.ReadWrite</span> permissions.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tenant ID *</Label>
                <Input value={mailboxForm.tenant_id} onChange={e => setMailboxForm({ ...mailboxForm, tenant_id: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" data-testid="mbx-tenant-id" />
              </div>
              <div className="space-y-2">
                <Label>Client ID (Application ID) *</Label>
                <Input value={mailboxForm.client_id} onChange={e => setMailboxForm({ ...mailboxForm, client_id: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" data-testid="mbx-client-id" />
              </div>
              <div className="space-y-2">
                <Label>Client Secret *</Label>
                <Input type="password" value={mailboxForm.client_secret} onChange={e => setMailboxForm({ ...mailboxForm, client_secret: e.target.value })} placeholder="Enter client secret" data-testid="mbx-client-secret" />
              </div>
              <div className="space-y-2">
                <Label>Mailbox Email *</Label>
                <Input type="email" value={mailboxForm.mailbox_email} onChange={e => setMailboxForm({ ...mailboxForm, mailbox_email: e.target.value })} placeholder="support@yourdomain.com" data-testid="mbx-email" />
              </div>
            </div>
            <Button onClick={handleMailboxConnect} disabled={mailboxSaving} data-testid="connect-mailbox-btn">
              {mailboxSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}Connect Mailbox
            </Button>
          </CardContent>
        </Card>
      )}

      {mailboxConnected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><UserPlus className="w-5 h-5 text-cyan-400" />Email Routing Rules</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-medium">Auto-create leads from emails</p><p className="text-xs text-muted-foreground">New emails from unknown senders create a lead</p></div>
                <Switch checked={mailboxForm.email_to_lead_enabled} onCheckedChange={v => setMailboxForm({ ...mailboxForm, email_to_lead_enabled: v })} data-testid="email-to-lead-toggle" />
              </div>
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-medium">Auto-create tickets from emails</p><p className="text-xs text-muted-foreground">Emails from known clients create a support ticket</p></div>
                <Switch checked={mailboxForm.email_to_ticket_enabled} onCheckedChange={v => setMailboxForm({ ...mailboxForm, email_to_ticket_enabled: v })} data-testid="email-to-ticket-toggle" />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-medium">Auto-reply to incoming emails</p><p className="text-xs text-muted-foreground">Send acknowledgement reply</p></div>
                <Switch checked={mailboxForm.auto_reply_enabled} onCheckedChange={v => setMailboxForm({ ...mailboxForm, auto_reply_enabled: v })} />
              </div>
              {mailboxForm.auto_reply_enabled && (
                <div className="space-y-2">
                  <Label>Auto-reply message</Label>
                  <Textarea value={mailboxForm.auto_reply_message} onChange={e => setMailboxForm({ ...mailboxForm, auto_reply_message: e.target.value })} rows={3} />
                </div>
              )}
              <Button size="sm" onClick={handleMailboxSettingsSave} disabled={mailboxSaving} data-testid="save-mailbox-settings-btn">
                {mailboxSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Save Settings
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><Mail className="w-5 h-5 text-blue-400" />Email-Generated Leads</CardTitle>
                <Button variant="outline" size="sm" onClick={handleTestIncomingEmail} data-testid="test-email-btn"><TestTube className="w-4 h-4 mr-1" />Send Test Email</Button>
              </div>
            </CardHeader>
            <CardContent>
              {emailLeads.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {emailLeads.slice(0, 10).map(lead => (
                    <div key={lead.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border/50">
                      <div><p className="text-sm font-medium">{lead.company_name}</p><p className="text-xs text-muted-foreground">{lead.email} &middot; {lead.contact_name}</p></div>
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
      </>)}

      {/* ==================== NOTIFICATIONS TAB ==================== */}
      {activeTab === "notifications" && (<>

      {/* No-Notes Escalation Threshold */}
      <Card className="border-orange-500/20" data-testid="general-threshold-card">
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
      </>)}

      {/* ==================== INTEGRATIONS TAB ==================== */}
      {activeTab === "integrations" && (<>

      {/* Xero Integration */}
      <Card data-testid="xero-settings-card">
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


      {/* Resend Email Integration */}
      <Card data-testid="resend-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-emerald-500" />
            <CardTitle>Resend Email Delivery</CardTitle>
          </div>
          <CardDescription>
            Transactional email provider used for welcome emails, invoices, late-payment reminders, portal notifications and remote-session audit records.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={resend.api_key_set ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"} data-testid="resend-status-badge">
              {resend.api_key_set ? "Configured" : "Not Configured"}
            </Badge>
            {resend.configured_from && (
              <Badge variant="outline" className="text-[10px] capitalize">Source: {resend.configured_from === "db" ? "Database (custom)" : resend.configured_from === "env" ? "Environment (.env)" : "None"}</Badge>
            )}
            {resend.last_test_result && (
              <Badge variant="outline" className={`text-[10px] ${resend.last_test_result === "sent" ? "text-emerald-400 border-emerald-500/30" : resend.last_test_result === "failed" ? "text-red-400 border-red-500/30" : "text-amber-400 border-amber-500/30"}`}>
                Last test: {resend.last_test_result} {resend.last_test_at ? `(${new Date(resend.last_test_at).toLocaleString()})` : ""}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Resend API Key</Label>
              <Input
                type="password"
                value={resend.api_key}
                onChange={e => setResend({ ...resend, api_key: e.target.value })}
                placeholder={resend.api_key_set ? `Current: ${resend.api_key || "re_..."}` : "re_xxxxxxxxxxxxx"}
                data-testid="resend-api-key-input"
              />
              <p className="text-[11px] text-muted-foreground">
                Get your key at <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" className="text-primary underline">resend.com/api-keys</a>. Leave blank to keep current; type <span className="font-mono">clear</span> to remove the custom key (falls back to env).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Sender Email (From)</Label>
              <Input
                type="email"
                value={resend.sender_email}
                onChange={e => setResend({ ...resend, sender_email: e.target.value })}
                placeholder="notifications@yourdomain.com"
                data-testid="resend-sender-email"
              />
              <p className="text-[11px] text-muted-foreground">Must be a domain verified on your Resend account. Default: <span className="font-mono">onboarding@resend.dev</span> (Resend's sandbox).</p>
            </div>
            <div className="space-y-1.5">
              <Label>Reply-To Address (optional)</Label>
              <Input
                type="email"
                value={resend.reply_to}
                onChange={e => setResend({ ...resend, reply_to: e.target.value })}
                placeholder="support@yourdomain.com"
                data-testid="resend-reply-to"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Test Email Recipient</Label>
              <Input
                type="email"
                value={resendTestEmail}
                onChange={e => setResendTestEmail(e.target.value)}
                placeholder={user?.email || "you@example.com"}
                data-testid="resend-test-email-input"
              />
              <p className="text-[11px] text-muted-foreground">Sends a branded test email so you can confirm delivery.</p>
            </div>
          </div>

          {resend.updated_at && (
            <p className="text-[11px] text-muted-foreground">Last saved: {new Date(resend.updated_at).toLocaleString()} by {resend.updated_by || "—"}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                setResendSaving(true);
                try {
                  await axios.put(`${API}/settings/resend`, {
                    api_key: resend.api_key,
                    sender_email: resend.sender_email,
                    reply_to: resend.reply_to,
                  }, { headers });
                  toast.success("Resend settings saved");
                  const fresh = await axios.get(`${API}/settings/resend`, { headers });
                  setResend({ ...fresh.data, api_key: "" });
                } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
                finally { setResendSaving(false); }
              }}
              disabled={resendSaving}
              data-testid="save-resend-btn"
            >
              {resendSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save Resend Settings
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                setResendTesting(true);
                try {
                  const res = await axios.post(`${API}/settings/resend/test`, { to_email: resendTestEmail || user?.email }, { headers });
                  if (res.data.status === "sent") toast.success(`Test email sent to ${resendTestEmail || user?.email}`);
                  else if (res.data.status === "mocked") toast.warning("Resend not configured — email was logged only");
                  else toast.error(`Test failed: ${res.data.message}`);
                  const fresh = await axios.get(`${API}/settings/resend`, { headers });
                  setResend({ ...fresh.data, api_key: "" });
                } catch (e) { toast.error(e.response?.data?.detail || "Test failed"); }
                finally { setResendTesting(false); }
              }}
              disabled={resendTesting || !resend.api_key_set}
              data-testid="test-resend-btn"
            >
              {resendTesting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TestTube className="w-4 h-4 mr-2" />}
              Send Test Email
            </Button>
          </div>
        </CardContent>
      </Card>


      {/* SMS - MobileMessage Integration */}
      <Card data-testid="sms-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-blue-500" />
            <CardTitle>SMS Messaging (MobileMessage.com.au)</CardTitle>
          </div>
          <CardDescription>
            Send SMS to clients, receive replies via webhook, and use email-to-SMS. Balance checked live against the provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={sms.enabled && sms.password_set ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"} data-testid="sms-status-badge">
              {sms.enabled && sms.password_set ? "Configured" : "Not Configured"}
            </Badge>
            {sms.last_balance != null && (
              <Badge variant="outline" className="text-[10px]">Balance: {sms.last_balance} credits{sms.last_balance_at ? ` (${new Date(sms.last_balance_at).toLocaleString()})` : ""}</Badge>
            )}
            {sms.last_test_result && (
              <Badge variant="outline" className={`text-[10px] ${sms.last_test_result === "sent" ? "text-emerald-400 border-emerald-500/30" : "text-red-400 border-red-500/30"}`}>
                Last test: {sms.last_test_result}{sms.last_test_at ? ` (${new Date(sms.last_test_at).toLocaleString()})` : ""}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>API Username</Label>
              <Input
                value={sms.username}
                onChange={e => setSms({ ...sms, username: e.target.value })}
                placeholder="e.g. 5WCN7n"
                data-testid="sms-username"
              />
            </div>
            <div className="space-y-1.5">
              <Label>API Password</Label>
              <Input
                type="password"
                value={sms.password}
                onChange={e => setSms({ ...sms, password: e.target.value })}
                placeholder={sms.password_set ? "(saved — leave blank to keep)" : "Paste your API password"}
                data-testid="sms-password"
              />
              <p className="text-[11px] text-muted-foreground">Type <span className="font-mono">clear</span> to remove the saved password.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Default Sender</Label>
              <div className="flex gap-2">
                <Input
                  value={sms.default_sender}
                  onChange={e => setSms({ ...sms, default_sender: e.target.value })}
                  placeholder="e.g. 61485900170 (shared number) or brand name"
                  data-testid="sms-default-sender"
                />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={async () => {
                    try {
                      const r = await axios.get(`${API}/sms/senders`, { headers });
                      setSmsSenders(r.data || []);
                      if (r.data?.length) toast.success(`Found ${r.data.length} approved sender(s)`);
                      else toast.info("No approved senders found");
                    } catch (e) { toast.error(e.response?.data?.detail || "Failed to fetch senders"); }
                  }}
                  data-testid="sms-load-senders"
                >Load Senders</Button>
              </div>
              {smsSenders.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {smsSenders.map((s, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className={`cursor-pointer text-[10px] ${sms.default_sender === s.sender ? "bg-primary/10 border-primary" : ""}`}
                      onClick={() => setSms({ ...sms, default_sender: s.sender })}
                    >
                      {s.sender} · {s.label}{s.is_default ? " (default)" : ""}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Must be approved in your MobileMessage portal. Shared number or verified brand name.</p>
            </div>
            <div className="space-y-1.5 flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={sms.enabled}
                    onChange={e => setSms({ ...sms, enabled: e.target.checked })}
                    data-testid="sms-enabled-toggle"
                    className="rounded"
                  />
                  Enable SMS sending
                </Label>
                <p className="text-[11px] text-muted-foreground">When off, outbound SMS calls will return 400.</p>
              </div>
            </div>
          </div>

          {/* SMS Signature */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-md border bg-emerald-500/5 border-emerald-500/10" data-testid="sms-signature-card">
            <div className="md:col-span-2 space-y-1.5">
              <Label>SMS Signature</Label>
              <Input
                value={sms.signature || ""}
                onChange={e => setSms({ ...sms, signature: e.target.value })}
                placeholder="Kind Regards, NexusMSP"
                maxLength={100}
                data-testid="sms-signature-input"
              />
              <p className="text-[11px] text-muted-foreground">
                Auto-appended to outbound SMS when toggle is on. Skipped if the message already contains this text. Counts toward the 160-char segment total.
              </p>
            </div>
            <div className="space-y-1.5 flex items-end">
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!sms.append_signature}
                  onChange={e => setSms({ ...sms, append_signature: e.target.checked })}
                  data-testid="sms-append-signature-toggle"
                  className="rounded"
                />
                Auto-append signature
              </Label>
            </div>
          </div>

          {/* Webhook URLs */}
          <div className="border rounded-md p-3 bg-muted/30 space-y-2" data-testid="sms-webhook-urls">
            <p className="text-xs font-semibold flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5" />Webhook URLs
              <span className="text-muted-foreground font-normal text-[11px]">Paste these into your MobileMessage portal</span>
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] shrink-0">Delivery Status</Badge>
                <code className="text-[11px] flex-1 truncate" data-testid="sms-status-webhook">{sms.status_webhook_url || "—"}</code>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { navigator.clipboard.writeText(sms.status_webhook_url); toast.success("Copied"); }} data-testid="copy-status-webhook"><Copy className="w-3 h-3" /></Button>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] shrink-0">Inbound Replies</Badge>
                <code className="text-[11px] flex-1 truncate" data-testid="sms-inbound-webhook">{sms.inbound_webhook_url || "—"}</code>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { navigator.clipboard.writeText(sms.inbound_webhook_url); toast.success("Copied"); }} data-testid="copy-inbound-webhook"><Copy className="w-3 h-3" /></Button>
              </div>
            </div>
          </div>

          {/* Test Block */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-md border bg-blue-500/5 border-blue-500/10">
            <div className="space-y-1.5">
              <Label>Test Recipient</Label>
              <Input
                value={smsTestTo}
                onChange={e => setSmsTestTo(e.target.value)}
                placeholder="0493892119"
                data-testid="sms-test-to"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Test Message</Label>
              <Input
                value={smsTestMessage}
                onChange={e => setSmsTestMessage(e.target.value)}
                maxLength={160}
                data-testid="sms-test-message"
              />
              <p className="text-[10px] text-muted-foreground">{smsTestMessage.length}/160 chars</p>
            </div>
          </div>

          {sms.updated_at && (
            <p className="text-[11px] text-muted-foreground">Last saved: {new Date(sms.updated_at).toLocaleString()} by {sms.updated_by || "—"}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                setSmsSaving(true);
                try {
                  await axios.put(`${API}/settings/sms`, {
                    username: sms.username,
                    password: sms.password,
                    default_sender: sms.default_sender,
                    signature: sms.signature,
                    append_signature: sms.append_signature,
                    enabled: sms.enabled,
                  }, { headers });
                  toast.success("SMS settings saved");
                  const fresh = await axios.get(`${API}/settings/sms`, { headers });
                  setSms({ ...fresh.data, password: "" });
                } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
                finally { setSmsSaving(false); }
              }}
              disabled={smsSaving}
              data-testid="save-sms-btn"
            >
              {smsSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save SMS Settings
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!smsTestTo) { toast.error("Enter a test recipient number"); return; }
                setSmsTesting(true);
                try {
                  const res = await axios.post(`${API}/sms/test`, { to: smsTestTo, message: smsTestMessage }, { headers });
                  if (res.data.status === "sent") toast.success(res.data.detail);
                  else toast.error(res.data.detail);
                  const fresh = await axios.get(`${API}/settings/sms`, { headers });
                  setSms({ ...fresh.data, password: "" });
                } catch (e) { toast.error(e.response?.data?.detail || "Test failed"); }
                finally { setSmsTesting(false); }
              }}
              disabled={smsTesting || !sms.password_set}
              data-testid="test-sms-btn"
            >
              {smsTesting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Smartphone className="w-4 h-4 mr-2" />}
              Send Test SMS
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const r = await axios.get(`${API}/sms/balance`, { headers });
                  toast.success(`Balance: ${r.data.balance} credits`);
                  const fresh = await axios.get(`${API}/settings/sms`, { headers });
                  setSms({ ...fresh.data, password: "" });
                } catch (e) { toast.error(e.response?.data?.detail || "Balance check failed"); }
              }}
              disabled={!sms.password_set}
              data-testid="check-sms-balance-btn"
            >
              <RefreshCw className="w-4 h-4 mr-2" />Refresh Balance
            </Button>
          </div>
        </CardContent>
      </Card>


      {/* Acronis Cyber Cloud Integration */}
      <Card data-testid="acronis-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyan-500" />
            <CardTitle>Acronis Cyber Cloud</CardTitle>
          </div>
          <CardDescription>Connect to Acronis for backup monitoring, protection plans, and cyber security across all tenants</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge className={acronis.connected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
              {acronis.connected ? "Connected" : "Not Configured"}
            </Badge>
          </div>
          <div className="space-y-3">
            <div><Label className="text-xs">Data Centre URL</Label><Input value={acronis.api_url} onChange={e => setAcronis({ ...acronis, api_url: e.target.value })} placeholder="https://au1-cloud.acronis.com" data-testid="acronis-api-url" /></div>
            <div><Label className="text-xs">API Client ID</Label><Input value={acronis.client_id} onChange={e => setAcronis({ ...acronis, client_id: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" data-testid="acronis-client-id" /></div>
            <div><Label className="text-xs">API Client Secret</Label><Input type="password" value={acronis.client_secret} onChange={e => setAcronis({ ...acronis, client_secret: e.target.value })} placeholder="Enter client secret" data-testid="acronis-client-secret" /></div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={async () => {
              setAcronis(prev => ({ ...prev, testing: true }));
              try {
                const r = await axios.get(`${API}/acronis/test-connection`, { headers });
                if (r.data.status === "connected") { toast.success("Acronis connected successfully!"); setAcronis(prev => ({ ...prev, connected: true })); }
                else toast.error(r.data.message || "Connection failed");
              } catch { toast.error("Connection failed"); }
              finally { setAcronis(prev => ({ ...prev, testing: false })); }
            }} disabled={acronis.testing} data-testid="test-acronis-btn">
              {acronis.testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}Test Connection
            </Button>
            <Button onClick={async () => {
              try {
                await axios.post(`${API}/acronis/config`, { api_url: acronis.api_url, client_id: acronis.client_id, client_secret: acronis.client_secret }, { headers });
                toast.success("Acronis settings saved");
              } catch { toast.error("Failed to save"); }
            }} data-testid="save-acronis-btn"><Save className="w-4 h-4 mr-2" />Save Acronis Settings</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Generate API credentials from Acronis Management Console: Settings &gt; API Clients &gt; Create API Client</p>
        </CardContent>
      </Card>

      {/* Pax8 Integration */}
      <Card data-testid="pax8-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-indigo-400" />
            <CardTitle>Pax8 (Microsoft / CSP Billing)</CardTitle>
          </div>
          <CardDescription>Sync Microsoft 365, Defender, Azure, and other CSP subscriptions from your Pax8 partner account. Auto-attach per-seat usage to recurring invoices every month.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge className={pax8.enabled ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
              {pax8.enabled ? "Connected" : "Not Configured"}
            </Badge>
            {pax8.last_test_result && (
              <Badge variant="outline" className="text-[10px]">
                Last test: {pax8.last_test_result}
              </Badge>
            )}
            {pax8.last_sync_at && (
              <span className="text-[11px] text-muted-foreground">
                Last sync: {new Date(pax8.last_sync_at).toLocaleString()} — {pax8.last_sync_stats?.companies || 0} companies / {pax8.last_sync_stats?.subscriptions || 0} subs
              </span>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Client ID</Label>
              <Input value={pax8.client_id || ""} onChange={e => setPax8({ ...pax8, client_id: e.target.value })} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxx" data-testid="pax8-client-id" />
            </div>
            <div>
              <Label className="text-xs">Client Secret</Label>
              <Input
                type="password"
                value={pax8.client_secret || ""}
                onChange={e => setPax8({ ...pax8, client_secret: e.target.value })}
                placeholder={pax8.client_secret_set ? "••••••••  (enter new value to replace)" : "Enter client secret"}
                data-testid="pax8-client-secret"
              />
              {pax8.client_secret_set && <p className="text-[10px] text-muted-foreground mt-1">Secret is stored — leave blank to keep existing.</p>}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!pax8.enabled}
                onChange={e => setPax8({ ...pax8, enabled: e.target.checked })}
                data-testid="pax8-enabled-toggle"
              />
              <Label className="text-xs">Enable Pax8 sync</Label>
            </div>
            {pax8.last_test_message && (
              <p className={`text-[11px] ${pax8.last_test_result === "success" ? "text-emerald-400" : "text-red-400"}`}>{pax8.last_test_message}</p>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={async () => {
              setPax8Busy(true);
              try {
                const r = await axios.post(`${API}/pax8/test`, {}, { headers });
                if (r.data.status === "success") toast.success(r.data.detail);
                else toast.error(r.data.detail);
                const fresh = await axios.get(`${API}/settings/pax8`, { headers });
                setPax8({ ...fresh.data, client_secret: "" });
              } catch (e) { toast.error(e.response?.data?.detail || "Test failed"); }
              finally { setPax8Busy(false); }
            }} disabled={pax8Busy} data-testid="test-pax8-btn">
              {pax8Busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}Test Connection
            </Button>
            <Button variant="outline" onClick={async () => {
              setPax8Busy(true);
              try {
                const r = await axios.post(`${API}/pax8/sync`, {}, { headers, timeout: 180000 });
                toast.success(`Synced ${r.data.companies} companies · ${r.data.subscriptions} subs`);
                const fresh = await axios.get(`${API}/settings/pax8`, { headers });
                setPax8({ ...fresh.data, client_secret: "" });
              } catch (e) { toast.error(e.response?.data?.detail || "Sync failed"); }
              finally { setPax8Busy(false); }
            }} disabled={pax8Busy} data-testid="sync-pax8-btn">
              <RefreshCw className="w-4 h-4 mr-2" />Sync Now
            </Button>
            <Button onClick={async () => {
              try {
                const body = {
                  client_id: pax8.client_id,
                  enabled: !!pax8.enabled,
                };
                if (pax8.client_secret && !pax8.client_secret.includes("...")) {
                  body.client_secret = pax8.client_secret;
                }
                await axios.put(`${API}/settings/pax8`, body, { headers });
                toast.success("Pax8 settings saved");
                const fresh = await axios.get(`${API}/settings/pax8`, { headers });
                setPax8({ ...fresh.data, client_secret: "" });
              } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
            }} data-testid="save-pax8-btn"><Save className="w-4 h-4 mr-2" />Save Pax8 Settings</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Get your client ID + secret from the Pax8 Partner Portal → Integrations → API Credentials. Uses OAuth2 client_credentials against <code>https://api.pax8.com/v1/token</code>.
          </p>
        </CardContent>
      </Card>

      {/* Huntress (Security) Integration */}
      <Card id="huntress-settings-card" data-testid="huntress-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-orange-500" />
            <CardTitle>Huntress (Security / MDR)</CardTitle>
          </div>
          <CardDescription>
            Pull live agent, incident, and signal data from Huntress into the Security module. Read-only integration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={huntress.configured ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"} data-testid="huntress-status-badge">
              {huntress.configured ? "Configured" : "Not Configured"}
            </Badge>
            {huntress.api_key_preview && (
              <Badge variant="outline" className="font-mono text-[10px]">Key: {huntress.api_key_preview}</Badge>
            )}
            {huntress.last_test_status && (
              <Badge variant="outline" className="text-[10px]">Last test: {huntress.last_test_status}</Badge>
            )}
            {huntress.last_synced_at && (
              <Badge variant="outline" className="text-[10px]">Synced: {new Date(huntress.last_synced_at).toLocaleString()}</Badge>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>API Key</Label>
              <Input
                value={huntress.api_key}
                onChange={(e) => setHuntress({ ...huntress, api_key: e.target.value })}
                placeholder={huntress.configured ? "•••••• (enter to replace)" : "Enter API key"}
                data-testid="huntress-api-key"
              />
            </div>
            <div>
              <Label>Secret Key</Label>
              <Input
                type="password"
                value={huntress.secret_key}
                onChange={(e) => setHuntress({ ...huntress, secret_key: e.target.value })}
                placeholder={huntress.configured ? "•••••• (enter to replace)" : "Enter secret key"}
                data-testid="huntress-secret-key"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Generate keys from the Huntress dashboard → Account Settings → API Credentials
            (<a href="https://support.huntress.io/hc/en-us/articles/4416826761235" target="_blank" rel="noreferrer" className="text-primary underline">docs</a>).
            Uses HTTP Basic auth against <code>https://api.huntress.io</code>.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={async () => {
                if (!huntress.api_key || !huntress.secret_key) {
                  if (!huntress.configured) { toast.error("Enter both API key and secret key"); return; }
                  toast.error("Enter new key & secret to update");
                  return;
                }
                setHuntressBusy(true);
                try {
                  await axios.post(`${API}/huntress/settings`, { api_key: huntress.api_key, secret_key: huntress.secret_key }, { headers });
                  toast.success("Huntress credentials saved");
                  const st = await axios.get(`${API}/huntress/status`, { headers });
                  setHuntress(prev => ({ ...prev, ...st.data, api_key: "", secret_key: "" }));
                } catch (e) { toast.error(e.response?.data?.detail || e.message); }
                finally { setHuntressBusy(false); }
              }}
              disabled={huntressBusy}
              data-testid="huntress-save-btn"
            >
              {huntressBusy ? "Saving…" : "Save credentials"}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                setHuntressBusy(true);
                try {
                  const res = await axios.get(`${API}/huntress/test-connection`, { headers });
                  if (res.data.success) toast.success(res.data.message);
                  else toast.error(res.data.message || "Connection failed");
                  const st = await axios.get(`${API}/huntress/status`, { headers });
                  setHuntress(prev => ({ ...prev, ...st.data, api_key: "", secret_key: "" }));
                } catch (e) { toast.error(e.response?.data?.detail || e.message); }
                finally { setHuntressBusy(false); }
              }}
              disabled={huntressBusy || !huntress.configured}
              data-testid="huntress-test-btn"
            >
              Test connection
            </Button>
            {huntress.configured && (
              <Button
                variant="ghost" className="text-red-400 hover:bg-red-500/10"
                onClick={async () => {
                  if (!window.confirm("Remove Huntress credentials? Security module panels will stop pulling data.")) return;
                  setHuntressBusy(true);
                  try {
                    await axios.delete(`${API}/huntress/settings`, { headers });
                    setHuntress({ api_key: "", secret_key: "", configured: false, api_key_preview: null, last_test_status: null, last_tested_at: null, last_synced_at: null });
                    toast.success("Huntress credentials removed");
                  } catch (e) { toast.error(e.response?.data?.detail || e.message); }
                  finally { setHuntressBusy(false); }
                }}
                data-testid="huntress-clear-btn"
              >
                Remove
              </Button>
            )}
          </div>
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

      {/* CIPP M365 Tenant Management */}
      <Card id="cipp-settings-card" data-testid="cipp-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-orange-500" />
            <CardTitle>CIPP · M365 Tenant Management</CardTitle>
          </div>
          <CardDescription>
            Connect your hosted CIPP (CyberDrain Improved Partner Portal) Azure function URL to manage
            Microsoft 365 tenants, users, licenses, and offboarding directly from NexusOps.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={cipp.configured ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"} data-testid="cipp-status-badge">
              {cipp.configured ? "Configured" : "Not Configured"}
            </Badge>
            {cipp.api_key_preview && (
              <Badge variant="outline" className="font-mono text-[10px]">Key: {cipp.api_key_preview}</Badge>
            )}
            {cipp.last_test_status && (
              <Badge variant="outline" className="text-[10px]">Last test: {cipp.last_test_status}</Badge>
            )}
            {cipp.last_synced_at && (
              <Badge variant="outline" className="text-[10px]">Synced: {new Date(cipp.last_synced_at).toLocaleString()}</Badge>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>CIPP Base URL</Label>
              <Input
                value={cipp.base_url}
                onChange={(e) => setCipp({ ...cipp, base_url: e.target.value })}
                placeholder="https://your-cipp.azurewebsites.net/api"
                data-testid="cipp-base-url"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                The Azure Function URL for your CIPP instance. Usually ends in <code>/api</code>.
              </p>
            </div>
            <div>
              <Label>API Key (x-functions-key)</Label>
              <Input
                type="password"
                value={cipp.api_key}
                onChange={(e) => setCipp({ ...cipp, api_key: e.target.value })}
                placeholder={cipp.configured ? "•••••• (enter to replace)" : "Enter CIPP function key"}
                data-testid="cipp-api-key"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                In CIPP Azure Functions → App Keys → copy the <code>default</code> host key.
              </p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Docs: <a href="https://docs.cipp.app/" target="_blank" rel="noreferrer" className="text-primary underline">docs.cipp.app</a>.
            NexusOps calls <code>ListTenants</code>, <code>ListUsers</code>, <code>ListLicenses</code>,
            <code>AddUser</code>, <code>ExecBulkUserLicense</code>, <code>ExecResetPass</code>,
            <code>ExecDisableUser</code>, and <code>ExecOffboardUser</code>.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={async () => {
                if (!cipp.base_url || !cipp.api_key) {
                  if (!cipp.configured) { toast.error("Enter base URL and API key"); return; }
                  toast.error("Enter new URL & API key to update");
                  return;
                }
                setCippBusy(true);
                try {
                  await axios.post(`${API}/cipp/settings`, { base_url: cipp.base_url, api_key: cipp.api_key }, { headers });
                  toast.success("CIPP credentials saved");
                  const st = await axios.get(`${API}/cipp/status`, { headers });
                  setCipp(prev => ({ ...prev, ...st.data, api_key: "" }));
                } catch (e) { toast.error(e.response?.data?.detail || e.message); }
                finally { setCippBusy(false); }
              }}
              disabled={cippBusy}
              data-testid="cipp-save-btn"
            >
              {cippBusy ? "Saving…" : "Save credentials"}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                setCippBusy(true);
                try {
                  const res = await axios.get(`${API}/cipp/test`, { headers });
                  if (res.data.success) toast.success(res.data.message);
                  else toast.error(res.data.message || "Connection failed");
                  const st = await axios.get(`${API}/cipp/status`, { headers });
                  setCipp(prev => ({ ...prev, ...st.data, api_key: "" }));
                } catch (e) { toast.error(e.response?.data?.detail || e.message); }
                finally { setCippBusy(false); }
              }}
              disabled={cippBusy || !cipp.configured}
              data-testid="cipp-test-btn"
            >
              Test connection
            </Button>
            {cipp.configured && (
              <Button
                variant="ghost" className="text-red-400 hover:bg-red-500/10"
                onClick={async () => {
                  if (!window.confirm("Remove CIPP credentials? Tenant management features will stop working.")) return;
                  setCippBusy(true);
                  try {
                    await axios.delete(`${API}/cipp/settings`, { headers });
                    setCipp({ base_url: "", api_key: "", configured: false, api_key_preview: null, last_test_status: null, last_tested_at: null, last_synced_at: null });
                    toast.success("CIPP credentials removed");
                  } catch (e) { toast.error(e.response?.data?.detail || e.message); }
                  finally { setCippBusy(false); }
                }}
                data-testid="cipp-clear-btn"
              >
                Remove
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* UniFi Site Manager */}
      <Card id="unifi-settings-card" data-testid="unifi-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wifi className="w-5 h-5 text-sky-500" />
            <CardTitle>UniFi · Site Manager</CardTitle>
          </div>
          <CardDescription>
            Connect to Ubiquiti's hosted UniFi Site Manager (api.ui.com) to pull sites, devices,
            clients, networks, and alerts across every console you manage.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={unifi.configured ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"} data-testid="unifi-status-badge">
              {unifi.configured ? "Configured" : "Not Configured"}
            </Badge>
            {unifi.api_key_preview && (
              <Badge variant="outline" className="font-mono text-[10px]">Key: {unifi.api_key_preview}</Badge>
            )}
            {unifi.last_test_status && (
              <Badge variant="outline" className="text-[10px]">Last test: {unifi.last_test_status}</Badge>
            )}
            {unifi.last_synced_at && (
              <Badge variant="outline" className="text-[10px]">Synced: {new Date(unifi.last_synced_at).toLocaleString()}</Badge>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>API Base URL</Label>
              <Input
                value={unifi.base_url || ""}
                onChange={(e) => setUnifi({ ...unifi, base_url: e.target.value })}
                placeholder="https://api.ui.com/v1"
                data-testid="unifi-base-url"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Default <code>https://api.ui.com/v1</code> (stable, 10k req/min).
                Use <code>/ea</code> only for Early Access features (100 req/min limit).
              </p>
            </div>
            <div>
              <Label>API Key (X-API-KEY)</Label>
              <Input
                type="password"
                value={unifi.api_key}
                onChange={(e) => setUnifi({ ...unifi, api_key: e.target.value })}
                placeholder={unifi.configured ? "•••••• (enter to replace)" : "Enter UniFi Site Manager API key"}
                data-testid="unifi-api-key"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Create at <a href="https://unifi.ui.com" target="_blank" rel="noreferrer" className="text-primary underline">unifi.ui.com</a> → Settings → API Keys.
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={async () => {
                if (!unifi.api_key) {
                  if (!unifi.configured) { toast.error("Enter an API key"); return; }
                  toast.error("Enter a new API key to update");
                  return;
                }
                setUnifiBusy(true);
                try {
                  await axios.post(`${API}/unifi/settings`, { base_url: unifi.base_url || undefined, api_key: unifi.api_key }, { headers });
                  toast.success("UniFi credentials saved");
                  const st = await axios.get(`${API}/unifi/status`, { headers });
                  setUnifi(prev => ({ ...prev, ...st.data, api_key: "" }));
                } catch (e) { toast.error(e.response?.data?.detail || e.message); }
                finally { setUnifiBusy(false); }
              }}
              disabled={unifiBusy}
              data-testid="unifi-save-btn"
            >
              {unifiBusy ? "Saving…" : "Save credentials"}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                setUnifiBusy(true);
                try {
                  const res = await axios.get(`${API}/unifi/test`, { headers });
                  if (res.data.success) toast.success(res.data.message);
                  else toast.error(res.data.message || "Connection failed");
                  const st = await axios.get(`${API}/unifi/status`, { headers });
                  setUnifi(prev => ({ ...prev, ...st.data, api_key: "" }));
                } catch (e) { toast.error(e.response?.data?.detail || e.message); }
                finally { setUnifiBusy(false); }
              }}
              disabled={unifiBusy || !unifi.configured}
              data-testid="unifi-test-btn"
            >
              Test connection
            </Button>
            {unifi.configured && (
              <Button
                variant="ghost" className="text-red-400 hover:bg-red-500/10"
                onClick={async () => {
                  if (!window.confirm("Remove UniFi credentials?")) return;
                  setUnifiBusy(true);
                  try {
                    await axios.delete(`${API}/unifi/settings`, { headers });
                    setUnifi({ base_url: "", api_key: "", configured: false, api_key_preview: null, last_test_status: null, last_tested_at: null, last_synced_at: null });
                    toast.success("UniFi credentials removed");
                  } catch (e) { toast.error(e.response?.data?.detail || e.message); }
                  finally { setUnifiBusy(false); }
                }}
                data-testid="unifi-clear-btn"
              >
                Remove
              </Button>
            )}
          </div>

          <div className="border-t border-border pt-4 mt-2">
            <UnifiControllersManager />
          </div>
        </CardContent>
      </Card>


      {/* NexusOps Agent (in-house RMM) */}
      <Card id="nexus-agent-settings-card" data-testid="nexus-agent-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-500" />
            <CardTitle>NexusOps Agent · In-House RMM</CardTitle>
          </div>
          <CardDescription>
            Our own cross-platform agent (Windows-first) replaces Tactical RMM. Per-client installers ship from
            the Agent Command Center — each ZIP bakes in a unique enrollment token and registers itself as the
            <code> NexusOpsAgent </code> Windows service. Splashtop bundling lands in Phase 4.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => window.open("/nexus-agent", "_self")} data-testid="open-agent-cc-btn">
              <Activity className="w-4 h-4 mr-1" /> Open Agent Command Center
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Configure heartbeat / poll intervals and the public server URL on the Agent Command Center.
          </p>
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
      </>)}

      {/* ==================== AI TAB ==================== */}
      {activeTab === "ai" && (<>

      {/* AI Model Configuration */}
      <Card data-testid="ai-config-card">
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
      </>)}

      {/* ==================== INTEGRATIONS TAB (continued - Hudu, Syncro) ==================== */}
      {activeTab === "integrations" && (<>

      {/* Hudu Integration */}
      <Card data-testid="hudu-settings-card">
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

      {/* Syncro RMM Integration */}
      <Card data-testid="syncro-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-orange-500" />
            <CardTitle>Syncro RMM - Client Import</CardTitle>
          </div>
          <CardDescription>Connect to Syncro to import clients, contacts, and devices</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge className={syncro.enabled ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
              {syncro.enabled ? "Connected" : "Not Configured"}
            </Badge>
          </div>
          <div>
            <Label>Syncro Subdomain</Label>
            <Input
              value={syncro.subdomain}
              onChange={(e) => setSyncro({ ...syncro, subdomain: e.target.value })}
              placeholder="your-company"
              data-testid="syncro-subdomain"
            />
            <p className="text-xs text-muted-foreground mt-1">Your Syncro subdomain (e.g., if your URL is https://your-company.syncromsp.com, enter "your-company")</p>
          </div>
          <div>
            <Label>API Key</Label>
            <Input
              type="password"
              value={syncro.api_key}
              onChange={(e) => setSyncro({ ...syncro, api_key: e.target.value })}
              placeholder="Syncro API Key"
              data-testid="syncro-api-key"
            />
            <p className="text-xs text-muted-foreground mt-1">Generate an API key in Syncro under <strong>Admin &gt; API Tokens</strong>.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={async () => {
              if (!syncro.subdomain || !syncro.api_key) { toast.error("Subdomain and API key required"); return; }
              setSyncroSaving(true);
              try {
                await axios.put(`${API}/syncro/settings`, { subdomain: syncro.subdomain, api_key: syncro.api_key, enabled: true }, { headers });
                toast.success("Syncro settings saved");
                setSyncro({ ...syncro, enabled: true });
              } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
              finally { setSyncroSaving(false); }
            }} data-testid="save-syncro-btn" disabled={syncroSaving}>
              {syncroSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Syncro Settings
            </Button>
            {syncro.enabled && (
              <>
                <Button variant="outline" onClick={async () => {
                  try {
                    const res = await axios.post(`${API}/syncro/test-connection`, {}, { headers });
                    if (res.data.status === "connected") toast.success(res.data.message);
                    else toast.error(res.data.message);
                  } catch (e) { toast.error("Connection test failed"); }
                }} data-testid="test-syncro-btn">
                  Test Connection
                </Button>
                <Button variant="default" onClick={async () => {
                  if (!confirm("Import all clients from Syncro? This may take a moment.")) return;
                  try {
                    toast.info("Importing clients from Syncro...");
                    const res = await axios.post(`${API}/syncro/import-clients`, {}, { headers });
                    toast.success(res.data.message);
                  } catch (e) { toast.error(e.response?.data?.detail || "Import failed"); }
                }} data-testid="import-syncro-btn">
                  Import Clients
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      </>)}

      {/* === Merged sub-pages (lazy) === */}
      {activeTab === "tickets" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading ticket defaults…</div>}>
          <LazyTicketSettings />
        </Suspense>
      )}
      {activeTab === "ping" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading ping & escalation…</div>}>
          <LazyTicketPingSettings />
        </Suspense>
      )}
      {activeTab === "white-label" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading white label…</div>}>
          <LazyWhiteLabel />
        </Suspense>
      )}
      {activeTab === "channel" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading channel mode…</div>}>
          <LazyChannelMode />
        </Suspense>
      )}
      {activeTab === "tokens" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading API tokens…</div>}>
          <LazyApiTokens />
        </Suspense>
      )}
      {activeTab === "twofa" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading 2FA settings…</div>}>
          <LazySecurity2FA />
        </Suspense>
      )}
      {activeTab === "comms" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading notify channels…</div>}>
          <LazyNotifyChannels />
        </Suspense>
      )}
      {activeTab === "my-settings" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading my workspace…</div>}>
          <LazyTechSettings />
        </Suspense>
      )}

      </div>
    </div>
  );
}