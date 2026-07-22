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
import ContractTypesSettings from "@/components/settings/ContractTypesSettings";
import WeatherClockSettingsCard from "@/components/settings/WeatherClockSettingsCard";
import SetupGuideCallout from "@/components/SetupGuideCallout";
import O365SetupPage from "./O365SetupPage";
import { toast } from "sonner";
import { 
  User, Bell, Shield, Palette, Mail, Building, Save, Loader2, MessageSquare,
  Clock, CalendarDays, Zap, CreditCard, FileText, AlertTriangle, Wifi, BookOpen, Brain,
  Trash2, Tag, Wrench, Link2, Unlink, TestTube, RefreshCw, UserPlus,
  CheckCircle, XCircle, KeyRound, Settings2, Plug, Upload, Image, Globe, Eye, EyeOff, Search,
  Smartphone, Copy, Cloud, Server, Activity, ChevronRight, ClipboardCheck, ShieldCheck, CloudSun, Phone
} from "lucide-react";

const TABS = [
  { id: "branding", label: "Platform Branding", description: "Identity, logo, document styling, and portal appearance.", icon: Palette, group: "organisation", tone: "violet" },
  { id: "tiers", label: "Service Tiers", description: "Service levels, pricing, and response commitments.", icon: Shield, group: "organisation", tone: "emerald" },
  { id: "contract-types", label: "Contract Types", description: "Agreement defaults, billing cadence, and SLA rules.", icon: FileText, group: "organisation", tone: "amber" },
  { id: "white-label", label: "White Label", description: "Client-facing naming, domains, and presentation.", icon: Image, group: "organisation", tone: "cyan" },
  { id: "channel", label: "Channel / MSP Mode", description: "MSP tenancy and partner operating model.", icon: Building, group: "organisation", tone: "violet" },
  { id: "tickets", label: "Ticket Defaults", description: "Numbering, workflows, templates, SLA, and routing.", icon: FileText, group: "operations", tone: "amber" },
  { id: "ping", label: "Ping & Escalation", description: "Attention rules, sounds, and escalation signals.", icon: Activity, group: "operations", tone: "rose" },
  { id: "calendar", label: "Dispatch Calendar", description: "Microsoft 365 calendar sync, scheduling guardrails, and booking visibility.", icon: CalendarDays, group: "operations", tone: "emerald" },
  { id: "weather", label: "Weather & Local Clock", description: "Dashboard forecast, temperature units, and the office timezone.", icon: CloudSun, group: "operations", tone: "cyan" },
  { id: "mailbox", label: "Mailbox & Email", description: "Microsoft 365 inboxes, sending, intake, and delivery.", icon: Mail, group: "operations", tone: "cyan" },
  { id: "notifications", label: "Notifications", description: "Organisation-wide notification policies and alerts.", icon: Bell, group: "operations", tone: "violet" },
  { id: "auth", label: "Authentication", description: "Microsoft sign-in and user provisioning controls.", icon: KeyRound, group: "security", tone: "violet" },
  { id: "twofa", label: "2FA & Security", description: "Multi-factor authentication and protection policy.", icon: Shield, group: "security", tone: "emerald" },
  { id: "tokens", label: "API Tokens", description: "Secure API access and integration credentials.", icon: Server, group: "security", tone: "cyan" },
  { id: "audit", label: "Audit Trail", description: "Review recorded platform activity and accountability.", icon: ClipboardCheck, group: "security", tone: "amber", route: "/audit-trail" },
  { id: "integrations", label: "Integrations", description: "Connected platforms, vendors, and credentials.", icon: Plug, group: "platform", tone: "cyan" },
  { id: "ai", label: "AI & Automation", description: "AI provider, model, and automation controls.", icon: Brain, group: "platform", tone: "violet" },
  { id: "comms", label: "Notify Channels", description: "Slack, Teams, and external notification channels.", icon: MessageSquare, group: "platform", tone: "emerald" },
  { id: "my-settings", label: "My Workspace", description: "Your profile, signature, schedule, and preferences.", icon: Settings2, group: "workspace", tone: "rose" },
];

const SETTINGS_GROUPS = [
  { id: "organisation", label: "Organisation", eyebrow: "Brand, services & agreements", description: "How NexusMSP looks, sells, and delivers service." },
  { id: "operations", label: "Service operations", eyebrow: "Tickets, email & escalation", description: "The rules that shape technician and customer workflows." },
  { id: "security", label: "Identity & security", eyebrow: "Access, credentials & audit", description: "Access, authentication, credentials, and accountability." },
  { id: "platform", label: "Platform connections", eyebrow: "Vendors, intelligence & automation", description: "External systems and intelligence that extend NexusMSP." },
  { id: "workspace", label: "Personal workspace", eyebrow: "Profile, schedule & preferences", description: "Settings that belong to you, not the entire organisation." },
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

// Search index: maps keywords -> (tab, card anchor, human label)
const SETTINGS_INDEX = [
  // Branding
  { tab: "branding", anchor: "branding-section", label: "Platform Branding", keywords: "branding logo company name colors favicon login tagline" },
  { tab: "branding", anchor: "branding-section", label: "Company Logo", keywords: "logo image upload" },
  { tab: "branding", anchor: "branding-section", label: "Favicon / Icon", keywords: "favicon icon browser tab" },
  { tab: "branding", anchor: "branding-section", label: "Primary / Accent Colors", keywords: "color theme primary accent secondary brand" },
  { tab: "branding", anchor: "branding-section", label: "Invoice Header / Footer", keywords: "invoice pdf branding header footer" },
  // Service Tiers
  { tab: "tiers", anchor: "service-tiers-card", label: "Service Tiers", keywords: "service tier bronze silver gold platinum diamond sla msp plan level price" },
  // Auth
  { tab: "auth", anchor: "auth-sso-card", label: "Microsoft SSO", keywords: "sso microsoft azure ad entra single sign on oauth" },
  // Mailbox
  { tab: "mailbox", anchor: "mailbox-o365-card", label: "Microsoft 365 Inbox", keywords: "mailbox o365 office365 inbox ticket email to ticket" },
  { tab: "mailbox", anchor: "mailbox-signature-card", label: "Email Signature", keywords: "email signature reply template" },
  { tab: "calendar", anchor: "dispatch-calendar-settings", label: "Dispatch Calendar", keywords: "calendar booking dispatch schedule microsoft 365 availability appointment conflict technician" },
  { tab: "weather", anchor: "weather-clock-settings-card", label: "Weather & Local Clock", keywords: "weather forecast temperature local time clock office location timezone celsius fahrenheit" },
  // Integrations
  { tab: "integrations", anchor: "xero-settings-card", label: "Xero Accounting", keywords: "xero accounting integration invoice sync" },
  { tab: "integrations", anchor: "stripe-api-key", label: "Stripe Payments", keywords: "stripe payment checkout card api key invoice" },
  { tab: "integrations", anchor: "microsoft365-delivery-card", label: "Microsoft 365 Email Delivery", keywords: "microsoft 365 office 365 graph email mailbox transactional onboarding welcome email notifications" },
  { tab: "integrations", anchor: "voice-services-settings-card", label: "Voice Services & YCM", keywords: "voice yeastar ycm central management pbx phone system cloud url extensions billing synchronisation sync client id secret" },
  { tab: "integrations", anchor: "sms-settings-card", label: "SMS Messaging (MobileMessage)", keywords: "sms text message mobilemessage mobile message webhook inbound phone send receive balance credits" },
  { tab: "integrations", anchor: "acronis-settings-card", label: "Acronis Cyber Cloud", keywords: "acronis backup cyber cloud protect tenant" },
  { tab: "integrations", anchor: "pax8-settings-card", label: "Pax8 (Microsoft / CSP)", keywords: "pax8 microsoft csp m365 defender azure licenses subscriptions billing" },
  { tab: "integrations", anchor: "huntress-settings-card", label: "Huntress (Security)", keywords: "huntress security soc edr mdr managed detection incidents agents signals endpoint" },
  { tab: "integrations", anchor: "suped-settings-card", label: "SupED", keywords: "suped" },
  { tab: "integrations", anchor: "cipp-settings-card", label: "CIPP (M365 management)", keywords: "cipp cyberdrain m365 microsoft 365 tenant management users licenses offboarding" },
  { tab: "integrations", anchor: "unifi-settings-card", label: "UniFi", keywords: "unifi ubiquiti network sites devices clients access points switches" },
  { tab: "integrations", anchor: "nexus-agent-settings-card", label: "NexusOps Agent", keywords: "nexus agent rmm in-house windows agent patches scripts splashtop" },
  { tab: "integrations", anchor: "nexus-elevate-settings-card", label: "Nexus Elevate", keywords: "privilege elevation admin request approval uac keeper epm endpoint privilege manager" },
  { tab: "integrations", anchor: "splynx-settings-card", label: "Splynx ISP billing", keywords: "splynx isp billing telco" },
  { tab: "integrations", anchor: "hudu-settings-card", label: "Hudu documentation", keywords: "hudu documentation passwords knowledge base" },
  { tab: "integrations", anchor: "syncro-settings-card", label: "Syncro PSA", keywords: "syncro psa migration import" },
  // AI
  { tab: "ai", anchor: "ai-config-card", label: "AI Provider & Model", keywords: "ai openai gpt model provider api key" },
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
  const [sms, setSms] = useState({ username: "", password: "", default_sender: "", signature: "Kind Regards, NexusMSP", append_signature: true, password_set: false, enabled: false, status_webhook_url: "", inbound_webhook_url: "", last_balance: null, last_balance_at: null, last_test_result: null, last_test_at: null, last_test_message: "", updated_at: null, updated_by: null });
  const [smsSenders, setSmsSenders] = useState([]);
  const [smsTestTo, setSmsTestTo] = useState("");
  const [smsTestMessage, setSmsTestMessage] = useState("NexusOps SMS test - integration working correctly.");
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
  const [trmm] = useState({ configured: false }); // legacy - TRMM removed, kept for backwards-compat with old loadAll
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
  const [aiConfig, setAiConfig] = useState({ provider: "openai", model: "gpt-5.6-terra", reasoning_effort: "medium", connection: { configured: false, method: "environment" } });
  const [aiSaving, setAiSaving] = useState(false);
  const [jobNumbering, setJobNumbering] = useState({ sla_prefix: "SLA-", workshop_prefix: "WS-", cabling_prefix: "CW-" });
  const [jnSaving, setJnSaving] = useState(false);
  const [emailSig, setEmailSig] = useState("");
  const [sigSaving, setSigSaving] = useState(false);
  const [cannedResponses, setCannedResponses] = useState([]);
  const [cannedForm, setCannedForm] = useState({ title: "", content: "", category: "general" });
  const [msSSO, setMsSSO] = useState({ enabled: false, tenant_id: "", client_id: "", client_secret: "", client_secret_set: false, redirect_uri: "", calendar_redirect_uri: "", auto_create_users: true, default_role: "tech" });
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
  const [calendarConnection, setCalendarConnection] = useState({ provider: "microsoft365", connected: false, calendar_name: "NexusMSP Dispatch", sync_direction: "two_way" });
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [nexusElevate, setNexusElevate] = useState({ native_enabled: true, max_duration_minutes: 15, require_justification: true, keeper_bridge_enabled: false, keeper_connector_reference: "", keeper_sync_interval_minutes: 15 });
  const [nexusElevateSaving, setNexusElevateSaving] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
      const [usersRes, thresholdRes, xeroRes, stripeRes, supedRes, splynxRes, huduRes, aiRes, syncroRes, jnRes, ssoRes, mbxRes, leadsRes, brandingRes, acronisRes, smsRes, pax8Res, huntressRes, cippRes, unifiRes, trmmRes, trmmNotifRes, calendarRes, nexusElevateRes] = await Promise.all([
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
          axios.get(`${API}/settings/sms`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/settings/pax8`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/huntress/status`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/cipp/status`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/unifi/status`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/trmm/status`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/trmm/notifications/settings`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/scheduling/calendar-connection`, { headers }).catch(() => ({ data: null })),
          axios.get(`${API}/nexus-elevate/settings`, { headers }).catch(() => ({ data: null })),
        ]);
        setUsers(usersRes.data);
        setThreshold(thresholdRes.data);
        setXero(xeroRes.data);
        setStripe(stripeRes.data);
        if (acronisRes.data) setAcronis(prev => ({ ...prev, api_url: acronisRes.data.api_url || "", client_id: acronisRes.data.client_id || "", connected: acronisRes.data.connected || false }));
        if (smsRes?.data) setSms(prev => ({ ...prev, ...smsRes.data, password: "" }));
        if (pax8Res?.data) setPax8(prev => ({ ...prev, ...pax8Res.data, client_secret: "" }));
        if (huntressRes?.data) setHuntress(prev => ({ ...prev, ...huntressRes.data, api_key: "", secret_key: "" }));
        if (cippRes?.data) setCipp(prev => ({ ...prev, ...cippRes.data, api_key: "" }));
        if (unifiRes?.data) setUnifi(prev => ({ ...prev, ...unifiRes.data, api_key: "" }));
        if (trmmRes?.data) setTrmm(prev => ({ ...prev, ...trmmRes.data, api_key: "" }));
        if (trmmNotifRes?.data) setTrmmNotif(prev => ({ ...prev, ...trmmNotifRes.data }));
        if (calendarRes?.data) setCalendarConnection(prev => ({ ...prev, ...calendarRes.data }));
        if (nexusElevateRes?.data) setNexusElevate(prev => ({ ...prev, ...nexusElevateRes.data }));
        setSuped(supedRes.data);
        setSplynx(splynxRes.data);
        setHudu(huduRes.data);
        if (aiRes.data.provider) setAiConfig(aiRes.data);
        setSyncro(syncroRes.data);
        if (jnRes.data) setJobNumbering(jnRes.data);
        if (ssoRes.data && ssoRes.data.type) setMsSSO(prev => ({ ...prev, ...ssoRes.data, client_secret: "" }));
        if (brandingRes.data && brandingRes.data.company_name) setBranding(prev => ({ ...prev, ...brandingRes.data }));
        if (mbxRes.data) {
          setMailbox(mbxRes.data);
          if (mbxRes.data.tenant_id) {
            setMailboxForm(f => ({
              ...f, tenant_id: mbxRes.data.tenant_id || "", client_id: mbxRes.data.client_id || "",
              client_secret: mbxRes.data.client_secret_set ? "********" : "",
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

  const saveCalendarConnection = async (connected = calendarConnection.connected) => {
    setCalendarSaving(true);
    try {
      const response = await axios.put(`${API}/scheduling/calendar-connection`, { ...calendarConnection, connected }, { headers });
      setCalendarConnection(response.data);
      toast.success(connected ? "Dispatch calendar connected" : "Dispatch calendar disconnected");
    } catch (error) { toast.error(error?.response?.data?.detail || "Could not update dispatch calendar"); }
    finally { setCalendarSaving(false); }
  };

  const connectMicrosoftCalendar = async () => {
    setCalendarSaving(true);
    try {
      const response = await axios.get(`${API}/scheduling/microsoft365/connect`, { headers });
      const authorizationUrl = response.data?.authorization_url;
      if (!authorizationUrl) throw new Error("Microsoft did not return an authorization URL");
      window.location.assign(authorizationUrl);
    } catch (error) {
      toast.error(error?.response?.data?.detail || error.message || "Could not start Microsoft calendar sign-in");
      setCalendarSaving(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("calendar_connected") === "1") toast.success("Microsoft 365 calendar connected");
    if (params.get("calendar_error")) toast.error(`Microsoft calendar connection failed: ${params.get("calendar_error")}`);
  }, []);

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
    <div className="max-w-6xl space-y-5" data-testid="settings-page">
      {/* Header */}
      <div className="rounded-2xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.09] via-background to-background p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-500/10"><Settings2 className="h-5 w-5 text-violet-300" /></span><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">NexusOps administration</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Settings</h1><p className="mt-1 text-sm text-muted-foreground">Configure your workspace, integrations, security, and service standards.</p></div></div>
          <Badge variant="outline" className="w-fit border-emerald-500/25 bg-emerald-500/10 text-emerald-300">Changes save per section</Badge>
        </div>
        {/* Quick search */}
        <div className="relative mt-5 w-full md:max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={settingSearch}
            onChange={e => setSettingSearch(e.target.value)}
              placeholder="Search settings... (e.g. 'mailbox', 'Xero', 'logo')"
            className="h-11 border-violet-500/15 bg-background/70 pl-9 shadow-sm"
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

      {/* Settings directory */}
      <div className="space-y-5" data-testid="settings-tabs">
        {SETTINGS_GROUPS.map(group => {
          const groupTabs = TABS.filter(tab => tab.group === group.id);
          return (
            <section key={group.id} className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5" data-testid={`settings-group-${group.id}`}>
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-300">{group.eyebrow}</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight">{group.label}</h2>
                </div>
                <p className="max-w-md text-sm text-muted-foreground">{group.description}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {groupTabs.map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  const toneClass = {
                    violet: "border-violet-500/25 bg-violet-500/10 text-violet-300",
                    emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
                    amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
                    cyan: "border-cyan-500/25 bg-cyan-500/10 text-cyan-300",
                    rose: "border-rose-500/25 bg-rose-500/10 text-rose-300",
                  }[tab.tone] || "border-violet-500/25 bg-violet-500/10 text-violet-300";
                  return (
                    <button key={tab.id} onClick={() => tab.route ? navigate(tab.route) : setActiveTab(tab.id)}
                      className={`group relative flex min-h-32 items-start gap-3 overflow-hidden rounded-xl border p-4 text-left transition-all ${isActive ? "border-violet-500/35 bg-violet-500/[0.09] shadow-[0_8px_24px_-16px_rgba(139,92,246,0.75)]" : "border-border/70 bg-background/35 hover:-translate-y-0.5 hover:border-violet-500/30 hover:bg-muted/40"}`}
                      data-testid={`settings-tab-${tab.id}`}>
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${toneClass}`}><Icon className="h-4.5 w-4.5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2"><span className="font-semibold text-foreground">{tab.label}</span>{isActive ? <Badge className="border-0 bg-violet-500/15 px-1.5 py-0 text-[10px] font-medium text-violet-200">Open</Badge> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-violet-300" />}</span>
                        <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">{tab.description}</span>
                        {tab.route && <span className="mt-2 block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Open audit log</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* Other settings hub - quick-access cards to dedicated settings sub-pages */}
      {false && <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="settings-hub-row">
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
      </div>}

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

        <Card data-testid="document-template-settings">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />Document Branding & Templates</CardTitle>
            <CardDescription>One client-facing document system for reports, invoices, recurring billing, purchase orders, quotes, and contracts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div><Label>Document presentation</Label><Select value={branding.document_theme || "executive"} onValueChange={value => setBranding(p => ({ ...p, document_theme: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="executive">Executive</SelectItem><SelectItem value="classic">Classic</SelectItem></SelectContent></Select><p className="mt-1 text-[10px] text-muted-foreground">Controls the shared visual hierarchy used by generated PDFs.</p></div>
              <div className="md:col-span-2"><Label>Report header statement</Label><Input value={branding.report_header_text || ""} onChange={e => setBranding(p => ({ ...p, report_header_text: e.target.value }))} placeholder="Managed service evidence and operational assurance" /><p className="mt-1 text-[10px] text-muted-foreground">Shown below the title on generated reports.</p></div>
            </div>
            <div><Label>Report footer statement</Label><Input value={branding.report_footer_text || ""} onChange={e => setBranding(p => ({ ...p, report_footer_text: e.target.value }))} placeholder="Confidential - prepared for the intended recipient." /></div>
            <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-muted/25 p-4 sm:flex-row sm:items-center"><div><p className="text-sm font-medium">Invoice layout studio</p><p className="mt-1 text-xs text-muted-foreground">Create, duplicate, preview, and set the default invoice or recurring-billing template. Brand colours, logos, and footer details above are shared.</p></div><Button variant="outline" onClick={() => navigate("/invoice-templates")}>Manage templates</Button></div>
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

      {/* Legacy general content retained temporarily for data compatibility; no longer exposed in Settings navigation. */}
      {false && activeTab === "general" && (<>
      <Card className="border-sky-500/20 bg-sky-500/[0.025]" data-testid="operational-defaults-overview">
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-sky-300" />Operational defaults</CardTitle><CardDescription>Shared operational standards belong here. Personal preferences and team administration now live in their dedicated workspaces.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <button type="button" onClick={() => navigate("/my-settings")} className="rounded-xl border border-border/60 bg-background/50 p-3 text-left transition-colors hover:border-violet-500/30 hover:bg-violet-500/[0.04]"><p className="text-sm font-medium">My Workspace</p><p className="mt-1 text-xs text-muted-foreground">Profile, signature, notifications, schedule, and appearance.</p></button>
          <button type="button" onClick={() => navigate("/team-hub?tab=command&view=directory")} className="rounded-xl border border-border/60 bg-background/50 p-3 text-left transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/[0.04]"><p className="text-sm font-medium">Team & access</p><p className="mt-1 text-xs text-muted-foreground">Technicians, invitations, roles, permissions, and capacity.</p></button>
          <button type="button" onClick={() => setActiveTab("branding")} className="rounded-xl border border-border/60 bg-background/50 p-3 text-left transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/[0.04]"><p className="text-sm font-medium">Organisation identity</p><p className="mt-1 text-xs text-muted-foreground">Company details, branding, client-facing documents, and white label.</p></button>
          <button type="button" onClick={() => navigate("/tickets/settings")} className="rounded-xl border border-border/60 bg-background/50 p-3 text-left transition-colors hover:border-amber-500/30 hover:bg-amber-500/[0.04]"><p className="text-sm font-medium">Ticket configuration</p><p className="mt-1 text-xs text-muted-foreground">Workflows, SLA policies, templates, and ticket-specific controls.</p></button>
        </CardContent>
      </Card>
      <Card data-testid="general-jobnumber-card">
        <CardHeader><div className="flex items-center gap-2"><Tag className="w-5 h-5 text-primary" /><CardTitle>Job numbering</CardTitle></div><CardDescription>Configure prefixes used across SLA, workshop, and cabling work.</CardDescription></CardHeader>
        <CardContent className="space-y-4"><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><div className="space-y-2"><Label>SLA prefix</Label><Input value={jobNumbering.sla_prefix} onChange={e => setJobNumbering(j => ({ ...j, sla_prefix: e.target.value }))} placeholder="SLA-" data-testid="jn-sla" /><p className="text-xs text-muted-foreground">Example: {jobNumbering.sla_prefix || "SLA-"}00001</p></div><div className="space-y-2"><Label>Workshop prefix</Label><Input value={jobNumbering.workshop_prefix} onChange={e => setJobNumbering(j => ({ ...j, workshop_prefix: e.target.value }))} placeholder="WS-" data-testid="jn-workshop" /><p className="text-xs text-muted-foreground">Example: {jobNumbering.workshop_prefix || "WS-"}00001</p></div><div className="space-y-2"><Label>Cabling / WISP prefix</Label><Input value={jobNumbering.cabling_prefix} onChange={e => setJobNumbering(j => ({ ...j, cabling_prefix: e.target.value }))} placeholder="CW-" data-testid="jn-cabling" /><p className="text-xs text-muted-foreground">Example: {jobNumbering.cabling_prefix || "CW-"}00001</p></div></div><Button onClick={handleSaveJobNumbering} disabled={jnSaving} data-testid="save-jn-btn">{jnSaving ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Saving...</> : "Save prefixes"}</Button></CardContent>
      </Card>
      </>)}

      {false && activeTab === "general" && (<>

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
            <p className="text-xs text-muted-foreground">This signature is automatically appended to all emails sent from tickets. Supports full HTML formatting, tables, and inline images. <strong>Pro tip:</strong> click the <span className="font-mono bg-muted px-1 rounded">HTML</span> toggle in the editor to paste a full raw HTML signature (e.g. exported from Outlook -> File -> Save As -> Web Page). Outlook <code>cid:</code> inline images won't render - host images on a public URL or paste them as base64 data URIs.</p>
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
          <SetupGuideCallout title="Configure Microsoft SSO safely" source="Create a dedicated App registration in Microsoft Entra ID, then add the NexusMSP sign-in and calendar-consent callback URLs as Web redirect URIs." steps={["Use your organisation tenant ID rather than common for production technician access.", "Grant only the delegated permissions required for sign-in and calendar consent, then approve consent.", "Set the default SSO role to Technician or Viewer unless an administrator explicitly requires more access."]} securityNote="Do not enable automatic user creation with an Admin default role. Treat the Client Secret as an Entra application credential and rotate it before expiry." />
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
      {activeTab === "contract-types" && (
        <ContractTypesSettings />
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
              <Input type="password" value={msSSO.client_secret || ""} onChange={e => setMsSSO({ ...msSSO, client_secret: e.target.value })} placeholder={msSSO.client_secret_set ? "Saved securely - enter only to replace" : "Azure App Client Secret"} data-testid="sso-client-secret" />
              {msSSO.client_secret_set && <p className="text-xs text-muted-foreground">Secret stored securely. Leave this blank to keep the existing value.</p>}
            </div>
            <div className="space-y-2">
              <Label>Redirect URI (auto-detected if blank)</Label>
              <Input value={msSSO.redirect_uri} onChange={e => setMsSSO({ ...msSSO, redirect_uri: e.target.value })} placeholder="https://your-domain/api/auth/microsoft/callback" data-testid="sso-redirect-uri" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Calendar consent redirect URI (auto-detected if blank)</Label>
              <Input value={msSSO.calendar_redirect_uri || ""} onChange={e => setMsSSO({ ...msSSO, calendar_redirect_uri: e.target.value })} placeholder="https://your-domain/api/scheduling/microsoft365/callback" data-testid="calendar-consent-redirect-uri" />
              <p className="text-xs text-muted-foreground">Add this callback to the Microsoft Entra app's Web redirect URIs. It is used only for delegated calendar consent.</p>
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
            <strong>Setup instructions:</strong> Register an app in <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps" target="_blank" rel="noreferrer" className="underline">Azure Portal -&gt; App registrations</a>. Add the sign-in and calendar consent callbacks as Web redirect URIs. Grant <code>User.Read</code>, <code>email</code>, <code>profile</code>, <code>openid</code>, and <code>Calendars.ReadWrite</code> delegated permissions.
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
      {activeTab === "mailbox" && <O365SetupPage />}

      {false && activeTab === "mailbox" && (<>

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
                <div><p className="text-sm font-medium">Auto-reply to incoming emails</p><p className="text-xs text-muted-foreground">Send acknowledgement through the Platform notices mailbox; automatic senders are skipped.</p></div>
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

      {/* ==================== DISPATCH CALENDAR TAB ==================== */}
      {activeTab === "calendar" && (<>
        <Card className="overflow-hidden border-emerald-500/25" data-testid="dispatch-calendar-settings">
          <CardHeader className="border-b border-emerald-500/15 bg-emerald-500/[0.045]"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-emerald-300" />Dispatch calendar</CardTitle><CardDescription className="mt-1">Keep Microsoft 365 commitments and NexusMSP bookings visible before work is assigned.</CardDescription></div><Badge variant="outline" className={calendarConnection.connected ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}>{calendarConnection.connected ? "Connected" : "Not connected"}</Badge></div></CardHeader>
          <CardContent className="space-y-5 pt-5"><div className="rounded-xl border border-border/70 bg-muted/[0.18] p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="font-medium">Microsoft 365 shared calendar</p><p className="mt-1 text-xs text-muted-foreground">Connect with the Microsoft account that owns the dispatch calendar. NexusMSP asks only for profile and calendar access, then keeps appointment decisions linked to tickets and the audit trail.</p></div><Button onClick={() => calendarConnection.connected ? saveCalendarConnection(false) : connectMicrosoftCalendar()} disabled={calendarSaving} data-testid="connect-dispatch-calendar">{calendarSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarDays className="mr-2 h-4 w-4" />}{calendarConnection.connected ? "Disconnect calendar" : "Sign in with Microsoft"}</Button></div></div>
            <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label>Calendar name</Label><Input value={calendarConnection.calendar_name || ""} onChange={(event) => setCalendarConnection(current => ({ ...current, calendar_name: event.target.value }))} placeholder="NexusMSP Dispatch" /></div><div className="space-y-2"><Label>Sync direction</Label><Select value={calendarConnection.sync_direction || "two_way"} onValueChange={(sync_direction) => setCalendarConnection(current => ({ ...current, sync_direction }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="two_way">Two-way (recommended)</SelectItem><SelectItem value="one_way">NexusMSP to calendar</SelectItem></SelectContent></Select></div></div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.035] p-4"><div><p className="text-sm font-medium">Booking guardrail</p><p className="mt-1 text-xs text-muted-foreground">Overlapping technician appointments and same-location jobs are flagged. A coordinator must record an approval reason before an exception is booked; NexusMSP writes that decision to the linked ticket and audit trail.</p></div><Button variant="outline" onClick={() => navigate("/dispatch-board?tab=calendar")}><CalendarDays className="mr-2 h-4 w-4" />Open dispatch calendar</Button></div>
            <div className="flex justify-end"><Button variant="outline" onClick={() => saveCalendarConnection(calendarConnection.connected)} disabled={calendarSaving}><Save className="mr-2 h-4 w-4" />Save calendar settings</Button></div>
          </CardContent>
        </Card>
      </>)}

      {activeTab === "weather" && <WeatherClockSettingsCard />}

      {/* ==================== INTEGRATIONS TAB ==================== */}
      {activeTab === "integrations" && (<>

      <SetupGuideCallout title="Connect integrations safely" source="Every provider has its own credential source and permission model. Use the setup guidance shown in each connection dialog, save only the required credentials, then run its connection test before enabling sync or billing automation." steps={["Create a dedicated service account or API key where the provider supports it.", "Use the minimum permissions needed for the NexusMSP workflow.", "Record the owner and renewal/expiry date in your credential process, then test the connection."]} securityNote="Never paste production secrets into tickets, chat, contracts, or client notes. Replace or revoke a credential immediately if it is exposed." />

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
          <SetupGuideCallout title="Connect Xero with a dedicated app" source="Create or open your NexusMSP app in the Xero Developer Portal, then copy its Client ID and Client Secret and register the exact redirect URI shown below." steps={["Use the production callback URL exactly as shown.", "Save the app credentials, then complete the Xero authorisation flow from NexusMSP.", "Confirm the correct Xero organisation before enabling invoice sync."]} securityNote="Use a dedicated Xero app owned by the MSP, not a personal technician application. Keep the Client Secret in NexusMSP only." />
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
          <SetupGuideCallout title="Use a restricted Stripe key" source="Create a restricted API key in Stripe Dashboard → Developers → API keys for the NexusMSP billing workflow." steps={["Use test credentials first if you are validating a new workflow.", "Grant only the payment and customer permissions required by the integration.", "Confirm the connected account before sending a customer payment link."]} securityNote="Never use a publishable key here. Store only a restricted Secret key and rotate it if it is exposed." />
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
              Get your API key from <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" className="text-primary underline">Stripe Dashboard -> Developers -> API keys</a>.
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


      <Card data-testid="microsoft365-delivery-card">
        <CardHeader>
          <div className="flex items-center gap-2"><Mail className="w-5 h-5 text-blue-500" /><CardTitle>Microsoft 365 Email Delivery</CardTitle></div>
          <CardDescription>The shared Microsoft 365 mailbox is used for leads, tickets, invoices, reminders, and platform notifications.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Connection, sender roles, delivery tests, and audit history are managed together in Mailbox &amp; Email.</p>
          <Button onClick={() => { setActiveTab("mailbox"); window.scrollTo({ top: 0, behavior: "smooth" }); }} data-testid="open-o365-delivery-settings"><Mail className="mr-2 h-4 w-4" />Open Mailbox &amp; Email</Button>
        </CardContent>
      </Card>

      <Card id="voice-services-settings-card" data-testid="voice-services-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-cyan-400" />
            <CardTitle>Voice Services &amp; Yeastar YCM</CardTitle>
          </div>
          <CardDescription>
            Keep the provider entry point in Settings while managing every client PBX, extension, and billing rule from the Voice workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm text-muted-foreground">YCM is the provider control-plane; it should not collapse customer separation. NexusMSP keeps every PBX URL, P-Series API credential, extension count, product mapping, and billing approval attached to the right client record.</p>
          <Button onClick={() => navigate("/voice?tab=pbxs")} data-testid="open-voice-services-settings"><Phone className="mr-2 h-4 w-4" />Open Voice &amp; PBXs</Button>
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
                placeholder={sms.password_set ? "(saved - leave blank to keep)" : "Paste your API password"}
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
                <code className="text-[11px] flex-1 truncate" data-testid="sms-status-webhook">{sms.status_webhook_url || "-"}</code>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { navigator.clipboard.writeText(sms.status_webhook_url); toast.success("Copied"); }} data-testid="copy-status-webhook"><Copy className="w-3 h-3" /></Button>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] shrink-0">Inbound Replies</Badge>
                <code className="text-[11px] flex-1 truncate" data-testid="sms-inbound-webhook">{sms.inbound_webhook_url || "-"}</code>
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
            <p className="text-[11px] text-muted-foreground">Last saved: {new Date(sms.updated_at).toLocaleString()} by {sms.updated_by || "-"}</p>
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
          <SetupGuideCallout title="Create a dedicated Acronis API client" source="In Acronis Management Console, open Settings → API Clients and create a named API client for NexusMSP in the correct data centre." steps={["Use the Acronis data-centre URL that matches the partner tenant.", "Create a dedicated API client rather than using an individual technician account.", "Record the secret in Keeper, then run Test Connection before using backup posture or billing data."]} securityNote="The API client secret grants tenant access. Keep its source record in Keeper, enter it directly into this integration setting only when needed, and rotate it when staff or supplier access changes." />
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
          <SetupGuideCallout title="Prepare Pax8 partner API credentials" source="In Pax8 Partner Portal, open Integrations → API Credentials and create the Client ID and Client Secret for NexusMSP." steps={["Use credentials owned by the MSP partner tenant.", "Save and run Test Connection before Sync Now.", "Review customer matching before enabling usage on recurring invoices."]} securityNote="A Pax8 credential can expose subscription and billing data for many customers. Use a dedicated service credential and rotate it if it is exposed." />
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
                Last sync: {new Date(pax8.last_sync_at).toLocaleString()} - {pax8.last_sync_stats?.companies || 0} companies / {pax8.last_sync_stats?.subscriptions || 0} subs
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
                placeholder={pax8.client_secret_set ? "********  (enter new value to replace)" : "Enter client secret"}
                data-testid="pax8-client-secret"
              />
              {pax8.client_secret_set && <p className="text-[10px] text-muted-foreground mt-1">Secret is stored - leave blank to keep existing.</p>}
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
            Get your client ID + secret from the Pax8 Partner Portal -> Integrations -> API Credentials. Uses OAuth2 client_credentials against <code>https://api.pax8.com/v1/token</code>.
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
          <SetupGuideCallout title="Create Huntress API credentials" source="In the Huntress dashboard, open Account Settings → API Credentials and create credentials for the NexusMSP read-only integration." steps={["Copy both the API Key and Secret Key from the same Huntress account.", "Save the credentials, then use Test Connection to validate agent and incident access.", "Confirm the expected organisations appear before using security posture data operationally."]} securityNote="Huntress keys can reveal security incidents and endpoint data. Keep both values in NexusMSP only and rotate them together if exposed." />
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
                placeholder={huntress.configured ? "****** (enter to replace)" : "Enter API key"}
                data-testid="huntress-api-key"
              />
            </div>
            <div>
              <Label>Secret Key</Label>
              <Input
                type="password"
                value={huntress.secret_key}
                onChange={(e) => setHuntress({ ...huntress, secret_key: e.target.value })}
                placeholder={huntress.configured ? "****** (enter to replace)" : "Enter secret key"}
                data-testid="huntress-secret-key"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Generate keys from the Huntress dashboard -> Account Settings -> API Credentials
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
              {huntressBusy ? "Saving..." : "Save credentials"}
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
          <SetupGuideCallout title="Connect Suped with a service API key" source="Create or retrieve the API key from the Suped dashboard, then use it only for the MSP tenant that owns the monitored domains." steps={["Confirm the correct Suped organisation before copying the key.", "Save the key and verify data is available for the expected client domains.", "Review alert routing before relying on DMARC findings operationally."]} securityNote="Suped data can expose email-domain posture. Keep the API key in NexusMSP and rotate it after any suspected exposure." />
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
          <SetupGuideCallout title="Create a UniFi Site Manager API key" source="In UniFi Site Manager, open Settings → API Keys and create a dedicated key for NexusMSP." steps={["Use the stable api.ui.com/v1 endpoint unless Early Access is required.", "Create a dedicated key with the least site access needed.", "Test the connection and confirm the expected consoles appear before using alerts."]} securityNote="This key can reveal network topology and client details. Keep it in NexusMSP only and revoke it when no longer required." />
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
                placeholder={cipp.configured ? "****** (enter to replace)" : "Enter CIPP function key"}
                data-testid="cipp-api-key"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                In CIPP Azure Functions -> App Keys -> copy the <code>default</code> host key.
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
              {cippBusy ? "Saving..." : "Save credentials"}
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
          <SetupGuideCallout title="Connect the correct CIPP instance" source="Use the Azure Function base URL for your hosted CIPP deployment and the function host key from Azure Functions → App Keys." steps={["Confirm the URL ends in /api.", "Use a dedicated host key for NexusMSP when possible.", "Run the connection test and validate the tenant list before enabling technician workflows."]} securityNote="The function key can perform high-impact Microsoft 365 actions. Treat it as an admin credential and rotate it after any suspected exposure." />
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
                placeholder={unifi.configured ? "****** (enter to replace)" : "Enter UniFi Site Manager API key"}
                data-testid="unifi-api-key"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Create at <a href="https://unifi.ui.com" target="_blank" rel="noreferrer" className="text-primary underline">unifi.ui.com</a> -> Settings -> API Keys.
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
              {unifiBusy ? "Saving..." : "Save credentials"}
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

      {/* Nexus Elevate - universal, agent-backed elevation approvals */}
      <Card id="nexus-elevate-settings-card" data-testid="nexus-elevate-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <CardTitle>Nexus Elevate</CardTitle>
          </div>
          <CardDescription>
            Controlled, time-bound administrator approvals for every customer using the NexusOps Agent. The native workflow is independent of Keeper; Keeper EPM is an optional provider bridge only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SetupGuideCallout title="Set up native service-launch approvals" source="Install the current NexusOps Agent on the customer Windows endpoint, then open Nexus Elevate to review hash-pinned, unattended executable requests." steps={["Keep Native approvals enabled so every enrolled Windows agent can submit a request.", "Choose the shortest practical approval duration and require a requester justification.", "Use Nexus Elevate Policies in monitor mode to test an exact path-and-hash rule before enforcing it.", "Technicians review the executable path, publisher, SHA-256 fingerprint, arguments, customer and ticket before approving."]} securityNote="The current native workflow launches only the exact approved .exe through the Nexus Agent service and verifies its SHA-256 again immediately before execution. It is not interactive UAC elevation and does not grant permanent local administrator access. Do not approve unknown publishers, paths, hashes, or vague requests." helpSlug="nexus-elevate-setup" />
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={nexusElevate.native_enabled ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-rose-500/20 text-rose-300 border-rose-500/30"}>{nexusElevate.native_enabled ? "Native approvals enabled" : "Native approvals paused"}</Badge>
            <Badge variant="outline" className="text-[10px]">Works with all enrolled Nexus Agents</Badge>
            {nexusElevate.keeper_bridge_enabled && <Badge variant="outline" className="border-amber-500/30 text-amber-200 text-[10px]">Keeper bridge configured</Badge>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl border border-border/80 bg-muted/15 p-4">
            <div className="flex items-center justify-between gap-4"><div><Label htmlFor="nexus-elevate-native">Enable native service-launch approvals</Label><p className="text-[11px] text-muted-foreground mt-1">Available to every enrolled Windows agent client, not just Keeper customers. It does not provide interactive UAC elevation.</p></div><Switch id="nexus-elevate-native" checked={nexusElevate.native_enabled} onCheckedChange={(checked) => setNexusElevate({ ...nexusElevate, native_enabled: checked })} /></div>
            <div className="flex items-center justify-between gap-4"><div><Label htmlFor="nexus-elevate-justification">Require request justification</Label><p className="text-[11px] text-muted-foreground mt-1">Captures why elevation is needed before an approver sees it.</p></div><Switch id="nexus-elevate-justification" checked={nexusElevate.require_justification} onCheckedChange={(checked) => setNexusElevate({ ...nexusElevate, require_justification: checked })} /></div>
            <div><Label htmlFor="nexus-elevate-duration">Maximum approval duration (minutes)</Label><Input id="nexus-elevate-duration" className="mt-1" type="number" min="5" max="60" value={nexusElevate.max_duration_minutes} onChange={(event) => setNexusElevate({ ...nexusElevate, max_duration_minutes: event.target.value })} /></div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2 text-xs text-muted-foreground"><span className="font-semibold text-emerald-200">Built-in safety:</span> a native request is bound to its endpoint, absolute executable path, argv, expiry and SHA-256. It cannot self-approve or open a command shell.</div>
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.035] p-4 md:flex-row md:items-center md:justify-between"><div><p className="text-sm font-semibold text-emerald-100">Policy controls are managed in Nexus Elevate</p><p className="mt-1 text-[11px] text-muted-foreground">Create customer or endpoint-scoped rules, simulate their result, then enforce only exact executable and SHA-256 decisions. Local-admin removal remains deliberately unavailable until endpoint recovery safeguards are ready.</p></div><Button variant="outline" className="shrink-0" onClick={() => navigate("/nexus-elevate")}><ShieldCheck className="mr-2 h-4 w-4" />Manage policies</Button></div>
          <div className="rounded-xl border border-border/80 p-4 space-y-3">
            <div className="flex items-center justify-between gap-4"><div><Label htmlFor="nexus-elevate-keeper">Optional Keeper EPM bridge</Label><p className="text-[11px] text-muted-foreground mt-1">Use only if the organisation also wants to reconcile Keeper EPM approval events.</p></div><Switch id="nexus-elevate-keeper" checked={nexusElevate.keeper_bridge_enabled} onCheckedChange={(checked) => setNexusElevate({ ...nexusElevate, keeper_bridge_enabled: checked })} /></div>
            {nexusElevate.keeper_bridge_enabled && <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><div><Label>Keeper connector secret reference</Label><Input className="mt-1" value={nexusElevate.keeper_connector_reference || ""} onChange={(event) => setNexusElevate({ ...nexusElevate, keeper_connector_reference: event.target.value })} placeholder="e.g. keeper://nexus/elevate-bridge" /><p className="text-[11px] text-muted-foreground mt-1">Reference a deployment secret or Keeper service integration. Do not paste Keeper credentials into NexusMSP.</p></div><div><Label>Sync interval (minutes)</Label><Input className="mt-1" type="number" min="5" max="120" value={nexusElevate.keeper_sync_interval_minutes} onChange={(event) => setNexusElevate({ ...nexusElevate, keeper_sync_interval_minutes: event.target.value })} /></div></div>}
          </div>
          <div className="flex gap-2 justify-end flex-wrap">
            <Button variant="outline" onClick={() => navigate("/help/nexus-elevate-setup")}><BookOpen className="mr-2 h-4 w-4" />Technician guide</Button>
            <Button variant="outline" onClick={() => navigate("/nexus-elevate")}><ShieldCheck className="mr-2 h-4 w-4" />Open approval queue</Button>
            <Button onClick={async () => { setNexusElevateSaving(true); try { const response = await axios.put(`${API}/nexus-elevate/settings`, { ...nexusElevate, max_duration_minutes: Number(nexusElevate.max_duration_minutes), keeper_sync_interval_minutes: Number(nexusElevate.keeper_sync_interval_minutes) }, { headers }); setNexusElevate(prev => ({ ...prev, ...response.data })); toast.success("Nexus Elevate settings saved"); } catch (error) { toast.error(error.response?.data?.detail || "Could not save Nexus Elevate settings"); } finally { setNexusElevateSaving(false); } }} disabled={nexusElevateSaving} data-testid="save-nexus-elevate-settings-btn">{nexusElevateSaving ? "Saving..." : "Save elevation policy"}</Button>
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
            the Agent Command Center - each ZIP bakes in a unique enrollment token and registers itself as the
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
          <SetupGuideCallout title="Create Splynx API credentials" source="In Splynx, open Administration → API Keys and create an API key and secret for NexusMSP." steps={["Enter the base Splynx URL without an API path.", "Use a dedicated API account or key with the minimum billing/customer scope required.", "Run Test Connection before exposing billing data to technicians."]} securityNote="Splynx credentials can access customer and payment information. Store them only in NexusMSP and rotate both values together." />
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
          <CardDescription>Set the single OpenAI model and reasoning level used by NexusMSP AI features.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={`rounded-xl border p-3 ${aiConfig.connection?.configured ? "border-emerald-500/25 bg-emerald-500/[0.06]" : "border-amber-500/25 bg-amber-500/[0.06]"}`} data-testid="openai-connection-status">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm font-semibold">OpenAI API connection</p><p className="mt-1 text-xs text-muted-foreground">{aiConfig.connection?.configured ? "A server-side OpenAI API key is available to NexusMSP." : "No server-side API key is available yet. ChatGPT sign-in cannot be used as an API credential."}</p></div>
              <Button asChild size="sm" variant="outline"><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">{aiConfig.connection?.configured ? "Manage API project" : "Create API key"}<Globe className="ml-1.5 h-3.5 w-3.5" /></a></Button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>AI provider</Label>
              <div className="flex h-10 items-center rounded-md border border-border bg-muted/30 px-3 text-sm font-medium">OpenAI API</div>
            </div>
            <div>
              <Label>Model</Label>
              <Select value={aiConfig.model} onValueChange={v => setAiConfig({ ...aiConfig, model: v })}>
                <SelectTrigger data-testid="ai-model-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-5.6-luna">GPT-5.6 Luna</SelectItem>
                  <SelectItem value="gpt-5.6-terra">GPT-5.6 Terra</SelectItem>
                  <SelectItem value="gpt-5.6">GPT-5.6 Sol</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reasoning effort</Label>
              <Select value={aiConfig.reasoning_effort || "medium"} onValueChange={v => setAiConfig({ ...aiConfig, reasoning_effort: v })}>
                <SelectTrigger data-testid="ai-reasoning-select"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">None - fastest</SelectItem><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium - recommended</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="xhigh">Extra high</SelectItem><SelectItem value="max">Maximum</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">For your setup choose <strong>GPT-5.6 Terra</strong> with <strong>Medium</strong> reasoning. Reasoning is sent with Responses API calls for GPT-5 models; the key stays server-side in <code>OPENAI_API_KEY</code>.</p>
          <Button onClick={async () => {
            setAiSaving(true);
            try {
              await axios.put(`${API}/ai/config`, aiConfig, { headers });
              toast.success(`Global OpenAI model saved: ${aiConfig.model}`);
            } catch { toast.error("Failed to save AI config"); }
            finally { setAiSaving(false); }
          }} data-testid="save-ai-config-btn" disabled={aiSaving}>
            {aiSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save global AI settings
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
          <SetupGuideCallout title="Create a dedicated Hudu API key" source="In Hudu, go to Admin → API Keys and generate an API key for the NexusMSP integration." steps={["Enter the Hudu base URL without a trailing API path.", "Use a dedicated integration key with only the documentation access required.", "Test the connection before importing or synchronising articles."]} securityNote="Documentation can contain credentials and client infrastructure detail. Revoke the Hudu key immediately if it is exposed." />
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
          <SetupGuideCallout title="Prepare a Syncro import key" source="In Syncro, create an API token under Admin → API Tokens and enter only the account subdomain, not the full Syncro URL." steps={["Use a dedicated read-focused import token where the source permissions allow it.", "Validate the subdomain before saving.", "Test before importing, then review client matches to avoid duplicates."]} securityNote="Do not use a technician’s personal token for recurring imports. Revoke the token in Syncro when the integration is retired." />
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
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading ticket defaults...</div>}>
          <LazyTicketSettings />
        </Suspense>
      )}
      {activeTab === "ping" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading ping & escalation...</div>}>
          <LazyTicketPingSettings />
        </Suspense>
      )}
      {activeTab === "white-label" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading white label...</div>}>
          <LazyWhiteLabel />
        </Suspense>
      )}
      {activeTab === "channel" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading channel mode...</div>}>
          <LazyChannelMode />
        </Suspense>
      )}
      {activeTab === "tokens" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading API tokens...</div>}>
          <LazyApiTokens />
        </Suspense>
      )}
      {activeTab === "twofa" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading 2FA settings...</div>}>
          <LazySecurity2FA />
        </Suspense>
      )}
      {activeTab === "comms" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading notify channels...</div>}>
          <LazyNotifyChannels />
        </Suspense>
      )}
      {activeTab === "my-settings" && (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading my workspace...</div>}>
          <LazyTechSettings />
        </Suspense>
      )}

      </div>
    </div>
  );
}
