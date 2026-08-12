import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BarChart3, Bell, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight,
  CircleDollarSign, Copy, CreditCard, Download, FileCheck2, FileText,
  Gauge, HardDrive, Headphones, HeartPulse, History, Home, Layers3,
  LifeBuoy, Loader2, LockKeyhole, LogOut, Menu, MessageSquareText, Monitor, Network, PackageCheck, Plus, Power,
  ReceiptText, RefreshCw, Search, Send, Settings2, ShieldCheck,
  Sparkles, Ticket, UserRound, Wifi, WifiOff, X, XCircle,
} from "lucide-react";

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "requests", label: "Requests", icon: Ticket },
  { id: "assets", label: "Managed assets", icon: Monitor },
  { id: "services", label: "Services", icon: Layers3 },
  { id: "billing", label: "Billing", icon: ReceiptText },
  { id: "protection", label: "Protection", icon: ShieldCheck },
  { id: "knowledge", label: "Knowledge", icon: BookOpen },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "account", label: "Account", icon: UserRound },
];

const STATUS_STYLES = {
  open: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  in_progress: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  on_hold: "border-orange-400/25 bg-orange-400/10 text-orange-300",
  resolved: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  closed: "border-slate-400/25 bg-slate-400/10 text-slate-300",
  online: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  offline: "border-rose-400/25 bg-rose-400/10 text-rose-300",
  success: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  failed: "border-rose-400/25 bg-rose-400/10 text-rose-300",
  active: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  paid: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  overdue: "border-rose-400/25 bg-rose-400/10 text-rose-300",
};

const requestDefaults = {
  title: "",
  description: "",
  request_type: "incident",
  impact: "single_user",
  urgency: "medium",
  priority: "medium",
  category: "support",
  preferred_contact: "portal",
  affected_device_id: "",
  affected_device_name: "",
};

const cx = (...classes) => classes.filter(Boolean).join(" ");
const titleCase = (value = "") => String(value).replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
const money = (value, currency = "AUD") =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: String(currency || "AUD").toUpperCase() }).format(Number(value || 0));
const dateLabel = (value, includeTime = false) => {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-AU", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
};
const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "CP";
const statusStyle = (status) => STATUS_STYLES[String(status || "").toLowerCase()] || "border-white/10 bg-white/[0.04] text-slate-300";

function PortalBadge({ value, children, className = "" }) {
  return (
    <Badge variant="outline" className={cx("h-6 rounded-full border px-2.5 text-[10px] font-semibold tracking-wide", statusStyle(value), className)}>
      {children || titleCase(value || "Unknown")}
    </Badge>
  );
}

function MetricTile({ icon: Icon, label, value, detail, tone = "emerald", onClick }) {
  const tones = {
    emerald: "from-emerald-400/16 to-emerald-400/[0.02] text-emerald-300 ring-emerald-400/20",
    sky: "from-sky-400/16 to-sky-400/[0.02] text-sky-300 ring-sky-400/20",
    amber: "from-amber-400/16 to-amber-400/[0.02] text-amber-300 ring-amber-400/20",
    violet: "from-violet-400/16 to-violet-400/[0.02] text-violet-300 ring-violet-400/20",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="group min-h-[142px] rounded-2xl border border-white/[0.08] bg-[#111923]/90 p-4 text-left shadow-[0_18px_45px_-28px_rgba(0,0,0,0.9)] transition hover:-translate-y-0.5 hover:border-emerald-400/25 hover:bg-[#14202a]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cx("flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ring-1", tones[tone])}>
          <Icon className="h-5 w-5" />
        </div>
        <ArrowRight className="h-4 w-4 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-emerald-300" />
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-xs font-semibold text-slate-300">{label}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{detail}</p>
    </button>
  );
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300">{eyebrow}</p>}
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ icon: Icon = Sparkles, title, description, action }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function LoadingPortal() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070b10]">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-300" />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-300">Preparing your workspace</p>
        <p className="mt-1 text-xs text-slate-600">Loading your secure service data</p>
      </div>
    </div>
  );
}

export default function CustomerPortalWorkspace() {
  const navigate = useNavigate();
  const portalToken = sessionStorage.getItem("portal_token");
  const headers = useMemo(() => ({ Authorization: `Bearer ${portalToken}` }), [portalToken]);
  const [view, setView] = useState("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(null);
  const [dashboard, setDashboard] = useState({ stats: {}, service_health: {}, recent_activity: [] });
  const [tickets, setTickets] = useState([]);
  const [devices, setDevices] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [services, setServices] = useState({ contracts: [], subscriptions: [], summary: {} });
  const [backups, setBackups] = useState({ jobs: [], summary: {} });
  const [compliance, setCompliance] = useState({ frameworks: [], has_assessment: false });
  const [qbrs, setQbrs] = useState([]);
  const [kbArticles, setKbArticles] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [remoteSessions, setRemoteSessions] = useState([]);
  const [query, setQuery] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [requestStatus, setRequestStatus] = useState("all");
  const [kbSearch, setKbSearch] = useState("");
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [requestForm, setRequestForm] = useState(requestDefaults);
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [payingInvoice, setPayingInvoice] = useState(false);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  const [consentDevice, setConsentDevice] = useState(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [connectingDeviceId, setConnectingDeviceId] = useState(null);
  const [activeRemoteSession, setActiveRemoteSession] = useState(null);
  const [endSessionNotes, setEndSessionNotes] = useState("");
  const [endingSession, setEndingSession] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: "", phone: "" });
  const [savingAccount, setSavingAccount] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [securitySecret, setSecuritySecret] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const [securityLoading, setSecurityLoading] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const searchInputRef = useRef(null);

  const permissions = profile?.user || {};
  const features = profile?.features || {};
  const canRemote = permissions.can_remote_devices === true;
  const canCreateTickets = permissions.can_create_tickets !== false;
  const canViewInvoices = permissions.can_view_invoices === true;
  const companyName = profile?.client?.name || "Your organisation";
  const userName = profile?.user?.name || "Client";
  const mspName = profile?.msp_branding?.company_name || profile?.branding?.company_name || "NexusMSP";
  const mspLogo = profile?.msp_branding?.company_logo_url || profile?.branding?.logo_url;
  const primaryColor = profile?.msp_branding?.primary_color || profile?.branding?.primary_color || "#34d399";

  const logout = useCallback(async (recordAudit = true) => {
    if (recordAudit && portalToken) {
      await axios.post(`${API}/portal/v2/logout`, {}, { headers }).catch(() => null);
    }
    sessionStorage.removeItem("portal_token");
    sessionStorage.removeItem("portal_user");
    navigate("/portal-login", { replace: true });
  }, [headers, navigate, portalToken]);

  const fetchPortal = useCallback(async (quiet = false) => {
    if (!portalToken) {
      navigate("/portal-login", { replace: true });
      return;
    }
    if (quiet) setRefreshing(true);
    try {
      const safe = (path, fallback) => axios.get(`${API}/portal/v2/${path}`, { headers }).catch((error) => {
        if (error?.response?.status === 401) throw error;
        return { data: fallback };
      });
      const [me, dash, ticketData, deviceData, invoiceData, serviceData, backupData, complianceData, qbrData, kbData, documentData, sessionData] = await Promise.all([
        safe("me", null),
        safe("dashboard", { stats: {}, service_health: {}, recent_activity: [] }),
        safe("tickets", []),
        safe("devices", []),
        safe("invoices", []),
        safe("services", { contracts: [], subscriptions: [], summary: {} }),
        safe("backups", { jobs: [], summary: {} }),
        safe("compliance", { frameworks: [], has_assessment: false }),
        safe("qbr", []),
        safe("kb", []),
        safe("documents", []),
        safe("remote-sessions", []),
      ]);
      setProfile(me.data);
      setDashboard(dash.data || {});
      setTickets(ticketData.data || []);
      setDevices(deviceData.data || []);
      setInvoices(invoiceData.data || []);
      setServices(serviceData.data || { contracts: [], subscriptions: [], summary: {} });
      setBackups(backupData.data || { jobs: [], summary: {} });
      setCompliance(complianceData.data || { frameworks: [], has_assessment: false });
      setQbrs(qbrData.data || []);
      setKbArticles(kbData.data || []);
      setDocuments(documentData.data || []);
      setRemoteSessions(sessionData.data || []);
      setAccountForm({
        name: me.data?.user?.name || "",
        phone: me.data?.user?.phone || "",
      });
    } catch (error) {
      if (error?.response?.status === 401) logout(false);
      else toast.error("We could not refresh your portal data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers, logout, navigate, portalToken]);

  useEffect(() => {
    fetchPortal();
  }, [fetchPortal]);

  useEffect(() => {
    const focusSearch = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const selectView = (id) => {
    setView(id);
    setMobileNav(false);
    setQuery("");
    if (id !== "requests") {
      setSelectedTicket(null);
      setTicketMessages([]);
    }
    if (id !== "billing") setSelectedInvoice(null);
  };

  const globalResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 2) return [];
    const result = [];
    tickets.forEach((item) => {
      if (`${item.ticket_number || item.id} ${item.title} ${item.status}`.toLowerCase().includes(term)) {
        result.push({ type: "Request", label: item.title, detail: item.ticket_number || item.id, target: "requests", item });
      }
    });
    devices.forEach((item) => {
      if (`${item.name} ${item.hostname} ${item.os}`.toLowerCase().includes(term)) {
        result.push({ type: "Asset", label: item.name || item.hostname, detail: item.os || item.device_type, target: "assets", item });
      }
    });
    kbArticles.forEach((item) => {
      if (`${item.title} ${item.category} ${(item.tags || []).join(" ")}`.toLowerCase().includes(term)) {
        result.push({ type: "Guide", label: item.title, detail: item.category, target: "knowledge", item });
      }
    });
    [...(services.contracts || []), ...(services.subscriptions || [])].forEach((item) => {
      if (`${item.name} ${item.product_name} ${item.type} ${item.vendor}`.toLowerCase().includes(term)) {
        result.push({ type: "Service", label: item.product_name || item.name, detail: item.vendor || item.type, target: "services", item });
      }
    });
    invoices.forEach((item) => {
      if (`${item.invoice_number} ${item.invoice_name} ${item.status} ${item.payment_status}`.toLowerCase().includes(term)) {
        result.push({ type: "Invoice", label: item.invoice_name || item.invoice_number || "Invoice", detail: item.invoice_number || titleCase(item.status), target: "billing", item });
      }
    });
    documents.forEach((item) => {
      if (`${item.title} ${item.category} ${item.kind} ${(item.tags || []).join(" ")}`.toLowerCase().includes(term)) {
        result.push({ type: "Document", label: item.title, detail: item.category || item.kind || "Shared document", target: "documents", item });
      }
    });
    return result.slice(0, 8);
  }, [devices, documents, invoices, kbArticles, query, services, tickets]);

  const chooseGlobalResult = (result) => {
    selectView(result.target);
    if (result.target === "requests") openTicket(result.item);
    if (result.target === "knowledge") setSelectedArticle(result.item);
    if (result.target === "billing") openInvoice(result.item);
  };

  const openTicket = async (ticket) => {
    setSelectedTicket(ticket);
    setView("requests");
    try {
      const { data } = await axios.get(`${API}/portal/v2/tickets/${ticket.id}`, { headers });
      setSelectedTicket(data.ticket || ticket);
      setTicketMessages(data.messages || []);
    } catch {
      setTicketMessages([]);
      toast.error("This request could not be opened");
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedTicket) return;
    setSendingMessage(true);
    try {
      const { data } = await axios.post(
        `${API}/portal/v2/tickets/${selectedTicket.id}/messages`,
        { content: newMessage.trim() },
        { headers },
      );
      setTicketMessages((current) => [...current, data]);
      setNewMessage("");
      toast.success("Reply added to the service record");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Reply could not be sent");
    } finally {
      setSendingMessage(false);
    }
  };

  const createRequest = async () => {
    if (!requestForm.title.trim() || !requestForm.description.trim()) {
      toast.error("Add a subject and a clear description");
      return;
    }
    setCreatingRequest(true);
    try {
      const device = devices.find((item) => item.id === requestForm.affected_device_id);
      const payload = {
        ...requestForm,
        affected_device_name: device?.name || device?.hostname || "",
        priority: requestForm.urgency,
      };
      const { data } = await axios.post(`${API}/portal/v2/tickets`, payload, { headers });
      setTickets((current) => [data, ...current]);
      setRequestForm(requestDefaults);
      setShowRequest(false);
      toast.success(`Request ${data.ticket_number || data.id} submitted`, {
        description: "It is now part of the shared, auditable service record.",
      });
      await openTicket(data);
      fetchPortal(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Request could not be submitted");
    } finally {
      setCreatingRequest(false);
    }
  };

  const openInvoice = async (invoice) => {
    setView("billing");
    try {
      const { data } = await axios.get(`${API}/portal/v2/invoices/${invoice.id}`, { headers });
      setSelectedInvoice(data);
    } catch {
      setSelectedInvoice(invoice);
    }
  };

  const payInvoice = async () => {
    if (!selectedInvoice) return;
    setPayingInvoice(true);
    try {
      const { data } = await axios.post(
        `${API}/portal/v2/invoices/${selectedInvoice.id}/pay`,
        { origin_url: window.location.origin, currency: selectedInvoice.currency || "aud" },
        { headers },
      );
      if (data.status === "checkout" && data.url) window.location.href = data.url;
      else toast.success(data.message || "Payment initiated");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Payment could not be initiated");
    } finally {
      setPayingInvoice(false);
    }
  };

  const downloadInvoice = async () => {
    if (!selectedInvoice) return;
    setDownloadingInvoice(true);
    try {
      const response = await axios.get(`${API}/portal/v2/invoices/${selectedInvoice.id}/pdf`, {
        headers,
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${selectedInvoice.invoice_number || "invoice"}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Invoice PDF downloaded");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Invoice PDF could not be downloaded");
    } finally {
      setDownloadingInvoice(false);
    }
  };

  const connectDevice = async () => {
    if (!consentDevice || !consentChecked) return;
    setConnectingDeviceId(consentDevice.id);
    try {
      const { data } = await axios.post(
        `${API}/portal/v2/devices/${consentDevice.id}/remote-connect`,
        { consent_acknowledged: true, user_agent: navigator.userAgent },
        { headers },
      );
      setActiveRemoteSession({
        session_id: data.session_id,
        device_name: consentDevice.name || consentDevice.hostname,
        started_at: Date.now(),
      });
      setConsentDevice(null);
      setConsentChecked(false);
      if (data.connection_url) {
        const anchor = document.createElement("a");
        anchor.href = data.connection_url;
        anchor.rel = "noopener noreferrer";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
      toast.success("Secure remote session started");
      fetchPortal(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Remote session could not start");
    } finally {
      setConnectingDeviceId(null);
    }
  };

  const endRemoteSession = async () => {
    if (!activeRemoteSession) return;
    setEndingSession(true);
    try {
      await axios.post(
        `${API}/portal/v2/remote-sessions/${activeRemoteSession.session_id}/end`,
        { notes: endSessionNotes },
        { headers },
      );
      setActiveRemoteSession(null);
      setEndSessionNotes("");
      toast.success("Remote session closed and added to the audit history");
      fetchPortal(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Session could not be closed");
    } finally {
      setEndingSession(false);
    }
  };

  const downloadSessionPdf = async (sessionId) => {
    try {
      const response = await axios.get(`${API}/portal/v2/remote-sessions/${sessionId}/pdf`, {
        headers,
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `remote-session-${sessionId.slice(0, 8)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Audit PDF could not be downloaded");
    }
  };

  const saveAccount = async () => {
    if (!accountForm.name.trim()) {
      toast.error("Your name cannot be blank");
      return;
    }
    setSavingAccount(true);
    try {
      await axios.put(`${API}/portal/v2/me`, accountForm, { headers });
      toast.success("Profile updated");
      fetchPortal(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Profile could not be updated");
    } finally {
      setSavingAccount(false);
    }
  };

  const openSecurity = async () => {
    setSecurityCode("");
    setSecurityLoading(true);
    try {
      if (!profile?.totp_enabled) {
        const { data } = await axios.get(`${API}/portal/v2/setup-2fa`, { headers });
        setSecuritySecret(data.secret || "");
      }
      setShowSecurity(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Security settings could not be opened");
    } finally {
      setSecurityLoading(false);
    }
  };

  const updateTwoFactor = async () => {
    if (securityCode.length !== 6) {
      toast.error("Enter the current six-digit authenticator code");
      return;
    }
    setSecurityLoading(true);
    try {
      const enabled = profile?.totp_enabled === true;
      await axios.post(
        `${API}/portal/v2/${enabled ? "disable-2fa" : "enable-2fa"}`,
        { code: securityCode },
        { headers },
      );
      setProfile((current) => ({ ...current, totp_enabled: !enabled }));
      setSecurityCode("");
      setSecuritySecret("");
      setShowSecurity(false);
      toast.success(`Multi-factor authentication ${enabled ? "disabled" : "enabled"}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Security settings could not be updated");
    } finally {
      setSecurityLoading(false);
    }
  };

  const filteredTickets = useMemo(() => {
    const term = requestSearch.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const matchesText = !term || `${ticket.ticket_number || ticket.id} ${ticket.title} ${ticket.description}`.toLowerCase().includes(term);
      const matchesStatus = requestStatus === "all" || ticket.status === requestStatus;
      return matchesText && matchesStatus;
    });
  }, [requestSearch, requestStatus, tickets]);

  const filteredKb = useMemo(() => {
    const term = kbSearch.trim().toLowerCase();
    return kbArticles.filter((article) =>
      !term || `${article.title} ${article.category} ${(article.tags || []).join(" ")} ${article.content}`.toLowerCase().includes(term),
    );
  }, [kbArticles, kbSearch]);

  if (loading) return <LoadingPortal />;

  const stats = dashboard.stats || {};
  const serviceHealth = dashboard.service_health || {};
  const openRequests = tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status));
  const outstanding = invoices.reduce((total, invoice) =>
    total + Math.max(Number(invoice.total || 0) - Number(invoice.amount_paid || 0), 0), 0);
  const attentionItems = [
    ...openRequests
      .filter((ticket) => ["high", "critical"].includes(String(ticket.priority || "").toLowerCase()))
      .map((ticket) => ({
        id: `ticket-${ticket.id}`,
        kind: "ticket",
        icon: Ticket,
        tone: ticket.priority === "critical" ? "rose" : "amber",
        title: ticket.title || "Priority service request",
        detail: `${ticket.ticket_number || ticket.id} · ${titleCase(ticket.priority)} priority`,
        timestamp: ticket.updated_at || ticket.created_at,
        source: ticket,
      })),
    ...(backups.jobs || [])
      .filter((job) => ["failed", "error"].includes(String(job.status || job.last_status || "").toLowerCase()))
      .map((job) => ({
        id: `backup-${job.id || job.job_id || job.name}`,
        kind: "protection",
        icon: ShieldCheck,
        tone: "rose",
        title: job.name || job.job_name || "Backup requires attention",
        detail: job.error || job.last_error || "The latest protection job did not complete successfully.",
        timestamp: job.last_run || job.updated_at,
      })),
    ...invoices
      .filter((invoice) => ["overdue", "past_due"].includes(String(invoice.payment_status || invoice.status || "").toLowerCase()))
      .map((invoice) => ({
        id: `invoice-${invoice.id}`,
        kind: "invoice",
        icon: ReceiptText,
        tone: "amber",
        title: invoice.invoice_name || invoice.invoice_number || "Invoice overdue",
        detail: `${invoice.invoice_number || "Invoice"} · ${money(Math.max(Number(invoice.total || 0) - Number(invoice.amount_paid || 0), 0), invoice.currency)}`,
        timestamp: invoice.due_date || invoice.updated_at,
        source: invoice,
      })),
  ].sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0));
  const recentPortalActivity = (dashboard.recent_activity || []).slice(0, 8);

  const openAttentionItem = (item) => {
    setShowNotifications(false);
    if (item.kind === "ticket" && item.source) openTicket(item.source);
    else if (item.kind === "invoice" && item.source) openInvoice(item.source);
    else if (item.kind === "protection") selectView("protection");
  };

  const renderOverview = () => (
    <div className="space-y-6" data-testid="portal-overview">
      <section className="overflow-hidden rounded-3xl border border-emerald-400/15 bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.16),transparent_36%),linear-gradient(135deg,#111b24,#0c131b)] shadow-[0_30px_80px_-45px_rgba(16,185,129,0.45)]">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.35fr_0.65fr] lg:p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
              </span>
              Live service workspace
            </div>
            <h1 className="mt-5 max-w-2xl text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
              Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {userName.split(" ")[0]}.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
              Everything your organisation needs from {mspName}: support, managed assets, billing, protection, documents, and service history in one secure workspace.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {canCreateTickets && (
                <Button variant="success" onClick={() => setShowRequest(true)} className="h-10 rounded-xl px-4 font-semibold">
                  <Plus className="mr-2 h-4 w-4" />New request
                </Button>
              )}
              <Button variant="outline" onClick={() => selectView("knowledge")} className="h-10 rounded-xl border-white/10 bg-white/[0.035] text-slate-200 hover:bg-white/[0.07]">
                <Search className="mr-2 h-4 w-4" />Find an answer
              </Button>
            </div>
          </div>
          <div className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-black/15 p-5 backdrop-blur-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Service health</p>
                <p className="mt-2 text-lg font-semibold text-white">{serviceHealth.label || "Services operational"}</p>
              </div>
              <div className={cx("flex h-11 w-11 items-center justify-center rounded-2xl ring-1",
                serviceHealth.status === "attention"
                  ? "bg-amber-400/10 text-amber-300 ring-amber-400/20"
                  : "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20")}>
                {serviceHealth.status === "attention" ? <AlertTriangle className="h-5 w-5" /> : <HeartPulse className="h-5 w-5" />}
              </div>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-400">{serviceHealth.summary || "Your managed services are reporting normally."}</p>
            <div className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4 text-[11px] text-slate-500">
              <span>Last checked {dateLabel(serviceHealth.last_checked, true)}</span>
              <Button variant="ghost" size="sm" onClick={() => fetchPortal(true)} disabled={refreshing} className="h-7 px-2 text-emerald-300 hover:bg-emerald-400/10 hover:text-emerald-200">
                <RefreshCw className={cx("h-3.5 w-3.5", refreshing && "animate-spin")} />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile icon={Ticket} label="Open requests" value={stats.open_tickets || 0} detail={`${stats.urgent_tickets || 0} marked high priority`} tone="sky" onClick={() => selectView("requests")} />
        <MetricTile icon={Monitor} label="Managed assets" value={`${stats.online_devices || 0}/${stats.total_devices || 0}`} detail="Currently online and reporting" tone="emerald" onClick={() => selectView("assets")} />
        <MetricTile icon={Layers3} label="Active services" value={stats.active_services || services.summary?.active_contracts || 0} detail={`${services.summary?.licensed_seats || 0} provisioned seats`} tone="violet" onClick={() => selectView("services")} />
        <MetricTile icon={CircleDollarSign} label="Outstanding" value={money(stats.outstanding_invoices || outstanding)} detail={canViewInvoices ? "Across issued invoices" : "Billing access is restricted"} tone="amber" onClick={() => selectView("billing")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="overflow-hidden rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-white">Active requests</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Your live support and service work</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => selectView("requests")} className="h-8 text-xs text-emerald-300 hover:bg-emerald-400/10 hover:text-emerald-200">
                View all <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </div>
            {openRequests.length ? openRequests.slice(0, 5).map((ticket) => (
              <button key={ticket.id} type="button" onClick={() => openTicket(ticket)} className="group flex w-full items-center gap-3 border-b border-white/[0.05] px-5 py-3.5 text-left transition last:border-0 hover:bg-white/[0.025]">
                <div className={cx("h-2.5 w-2.5 rounded-full", ticket.priority === "critical" ? "bg-rose-400" : ticket.priority === "high" ? "bg-amber-400" : "bg-sky-400")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-200 group-hover:text-white">{ticket.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{ticket.ticket_number || ticket.id} · Updated {dateLabel(ticket.updated_at || ticket.created_at)}</p>
                </div>
                <PortalBadge value={ticket.status} />
                <ChevronRight className="h-4 w-4 text-slate-700 transition group-hover:translate-x-0.5 group-hover:text-emerald-300" />
              </button>
            )) : (
              <div className="px-5 py-10 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
                <p className="mt-3 text-sm font-medium text-white">No open requests</p>
                <p className="mt-1 text-xs text-slate-500">Everything is currently resolved.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
          <CardContent className="p-5">
            <p className="text-sm font-semibold text-white">Quick actions</p>
            <p className="mt-1 text-[11px] text-slate-500">Common tasks, one click away</p>
            <div className="mt-4 grid gap-2">
              {[
                { label: "Report an issue", detail: "Start a tracked support request", icon: LifeBuoy, action: () => setShowRequest(true), show: canCreateTickets },
                { label: "Review assets", detail: "Check device status and support", icon: Monitor, action: () => selectView("assets"), show: true },
                { label: "View invoices", detail: "Statements, balances and payments", icon: CreditCard, action: () => selectView("billing"), show: canViewInvoices },
                { label: "Service documents", detail: "Access approved shared records", icon: FileCheck2, action: () => selectView("documents"), show: true },
              ].filter((item) => item.show).map(({ label, detail, icon: Icon, action }) => (
                <button key={label} type="button" onClick={action} className="group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-left transition hover:border-emerald-400/20 hover:bg-emerald-400/[0.04]">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] text-slate-400 group-hover:bg-emerald-400/10 group-hover:text-emerald-300">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-200">{label}</p>
                    <p className="mt-0.5 truncate text-[10px] text-slate-600">{detail}</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-700 group-hover:text-emerald-300" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Recent service activity</p>
              <p className="mt-0.5 text-[11px] text-slate-500">A unified view of support, billing, and protection events</p>
            </div>
            <Activity className="h-4 w-4 text-emerald-300" />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {(dashboard.recent_activity || []).slice(0, 6).map((item) => {
              const Icon = item.type === "invoice" ? ReceiptText : item.type === "backup" ? HardDrive : Ticket;
              return (
                <button key={item.id} type="button" onClick={() => item.type === "ticket" ? openTicket(tickets.find((ticket) => ticket.id === item.target_id) || { id: item.target_id, title: item.title }) : selectView(item.type === "invoice" ? "billing" : "protection")} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:bg-white/[0.04]">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] text-slate-400"><Icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-200">{item.title}</p>
                    <p className="mt-0.5 truncate text-[10px] text-slate-500">{item.detail}</p>
                  </div>
                  <p className="text-[10px] text-slate-600">{dateLabel(item.timestamp)}</p>
                </button>
              );
            })}
            {!(dashboard.recent_activity || []).length && <p className="text-sm text-slate-500">Activity will appear here as your services are used.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderRequests = () => (
    <div className="space-y-6" data-testid="portal-requests">
      {selectedTicket ? (
        <>
          <Button variant="ghost" onClick={() => { setSelectedTicket(null); setTicketMessages([]); }} className="-ml-2 h-8 text-slate-400 hover:bg-white/[0.04] hover:text-white">
            <ArrowLeft className="mr-2 h-4 w-4" />Back to requests
          </Button>
          <div className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[#101820]">
            <div className="border-b border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_38%)] p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <PortalBadge value={selectedTicket.status} />
                    <Badge variant="outline" className="h-6 rounded-full border-white/10 bg-white/[0.03] px-2.5 text-[10px] text-slate-400">{titleCase(selectedTicket.priority)} priority</Badge>
                    <Badge variant="outline" className="h-6 rounded-full border-white/10 bg-white/[0.03] px-2.5 text-[10px] text-slate-400">{titleCase(selectedTicket.request_type || "support")}</Badge>
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">{selectedTicket.title}</h2>
                  <p className="mt-2 text-xs text-slate-500">{selectedTicket.ticket_number || selectedTicket.id} · Created {dateLabel(selectedTicket.created_at, true)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    ["Assigned", selectedTicket.assigned_name || "Service desk"],
                    ["Contact", selectedTicket.preferred_contact ? titleCase(selectedTicket.preferred_contact) : "Portal"],
                    ["Last update", dateLabel(selectedTicket.updated_at || selectedTicket.created_at)],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-[120px] rounded-xl border border-white/[0.07] bg-black/10 px-3 py-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600">{label}</p>
                      <p className="mt-1 truncate text-xs font-medium text-slate-300">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid lg:grid-cols-[0.7fr_1.3fr]">
              <aside className="border-b border-white/[0.07] p-5 lg:border-b-0 lg:border-r">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Request brief</p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{selectedTicket.description || "No description supplied."}</p>
                <div className="mt-5 space-y-3 border-t border-white/[0.07] pt-5">
                  {selectedTicket.affected_device_name && (
                    <div className="flex items-center gap-3">
                      <Monitor className="h-4 w-4 text-slate-500" />
                      <div><p className="text-[10px] text-slate-600">Affected asset</p><p className="text-xs text-slate-300">{selectedTicket.affected_device_name}</p></div>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <Gauge className="h-4 w-4 text-slate-500" />
                    <div><p className="text-[10px] text-slate-600">Impact</p><p className="text-xs text-slate-300">{titleCase(selectedTicket.impact || "single_user")}</p></div>
                  </div>
                  <div className="flex items-center gap-3">
                    <History className="h-4 w-4 text-slate-500" />
                    <div><p className="text-[10px] text-slate-600">Audit status</p><p className="text-xs text-emerald-300">Full shared history retained</p></div>
                  </div>
                </div>
              </aside>
              <section className="flex min-h-[520px] flex-col p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Conversation</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">Public replies shared with the service desk</p>
                  </div>
                  <MessageSquareText className="h-4 w-4 text-emerald-300" />
                </div>
                <div className="mt-5 flex-1 space-y-3 overflow-y-auto pr-1">
                  {ticketMessages.map((message) => {
                    const clientMessage = message.sender_type === "client";
                    return (
                      <div key={message.id} className={cx("flex", clientMessage ? "justify-end" : "justify-start")}>
                        <div className={cx("max-w-[88%] rounded-2xl border px-4 py-3 sm:max-w-[76%]",
                          clientMessage
                            ? "rounded-br-md border-emerald-400/20 bg-emerald-400/[0.08]"
                            : "rounded-bl-md border-white/[0.08] bg-white/[0.03]")}>
                          <div className="flex items-center gap-2">
                            <span className={cx("flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold",
                              clientMessage ? "bg-emerald-400/20 text-emerald-200" : "bg-sky-400/15 text-sky-300")}>
                              {initials(message.sender_name || (clientMessage ? userName : mspName))}
                            </span>
                            <p className="text-[10px] font-semibold text-slate-400">{message.sender_name || (clientMessage ? userName : mspName)}</p>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{message.content}</p>
                          <p className="mt-2 text-[9px] text-slate-600">{dateLabel(message.created_at, true)}</p>
                        </div>
                      </div>
                    );
                  })}
                  {!ticketMessages.length && <p className="py-12 text-center text-sm text-slate-600">No public conversation yet.</p>}
                </div>
                <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/15 p-3">
                  <Textarea
                    value={newMessage}
                    onChange={(event) => setNewMessage(event.target.value)}
                    placeholder="Add a public reply for the service desk…"
                    rows={3}
                    className="resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
                    data-testid="portal-ticket-reply"
                  />
                  <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-3">
                    <p className="text-[10px] text-slate-600">Visible to your organisation and authorised technicians</p>
                    <Button variant="success" onClick={sendMessage} disabled={sendingMessage || !newMessage.trim()} className="h-8 rounded-lg px-3 text-xs font-semibold">
                      {sendingMessage ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}Send reply
                    </Button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </>
      ) : (
        <>
          <SectionHeader
            eyebrow="Service desk"
            title="Requests"
            description="Create, track, and continue every service conversation without losing the audit trail."
            action={canCreateTickets ? (
              <Button variant="success" onClick={() => setShowRequest(true)} className="h-10 rounded-xl font-semibold">
                <Plus className="mr-2 h-4 w-4" />New request
              </Button>
            ) : null}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricTile icon={Ticket} label="Open" value={openRequests.length} detail="In the active service queue" tone="sky" onClick={() => setRequestStatus("open")} />
            <MetricTile icon={AlertTriangle} label="High priority" value={openRequests.filter((ticket) => ["high", "critical"].includes(ticket.priority)).length} detail="Requiring close attention" tone="amber" onClick={() => setRequestStatus("all")} />
            <MetricTile icon={CheckCircle2} label="Resolved" value={tickets.filter((ticket) => ["resolved", "closed"].includes(ticket.status)).length} detail="Retained for history and audit" tone="emerald" onClick={() => setRequestStatus("resolved")} />
          </div>
          <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
            <CardContent className="p-0">
              <div className="flex flex-col gap-3 border-b border-white/[0.07] p-4 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                  <Input value={requestSearch} onChange={(event) => setRequestSearch(event.target.value)} placeholder="Search request number, subject, or detail…" className="h-10 rounded-xl border-white/[0.08] bg-black/15 pl-10" />
                </div>
                <Select value={requestStatus} onValueChange={setRequestStatus}>
                  <SelectTrigger className="h-10 w-full rounded-xl border-white/[0.08] bg-black/15 sm:w-[170px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="on_hold">On hold</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {filteredTickets.length ? filteredTickets.map((ticket) => (
                <button key={ticket.id} type="button" onClick={() => openTicket(ticket)} className="group grid w-full gap-3 border-b border-white/[0.05] p-4 text-left transition last:border-0 hover:bg-white/[0.025] sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className={cx("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      ticket.priority === "critical" ? "bg-rose-400/10 text-rose-300" : ticket.priority === "high" ? "bg-amber-400/10 text-amber-300" : "bg-sky-400/10 text-sky-300")}>
                      <Ticket className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-200 group-hover:text-white">{ticket.title}</p>
                        <PortalBadge value={ticket.status} />
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-500">{ticket.description || "No description supplied"}</p>
                      <p className="mt-1.5 text-[10px] text-slate-600">{ticket.ticket_number || ticket.id} · {titleCase(ticket.priority)} priority · {dateLabel(ticket.created_at)}</p>
                    </div>
                  </div>
                  <ChevronRight className="hidden h-4 w-4 text-slate-700 transition group-hover:translate-x-0.5 group-hover:text-emerald-300 sm:block" />
                </button>
              )) : (
                <EmptyState icon={Search} title="No matching requests" description="Try changing the search or status filter." />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );

  const renderAssets = () => (
    <div className="space-y-6" data-testid="portal-assets">
      <SectionHeader
        eyebrow="Managed environment"
        title="Managed assets"
        description="Live visibility of the computers and devices covered by your service."
        action={<Button variant="outline" onClick={() => fetchPortal(true)} className="h-10 rounded-xl border-white/10 bg-white/[0.03]"><RefreshCw className={cx("mr-2 h-4 w-4", refreshing && "animate-spin")} />Refresh status</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile icon={Wifi} label="Online" value={devices.filter((device) => device.status === "online").length} detail="Reporting to the management platform" tone="emerald" />
        <MetricTile icon={WifiOff} label="Offline" value={devices.filter((device) => device.status !== "online").length} detail="May be powered down or disconnected" tone="amber" />
        <MetricTile icon={ShieldCheck} label="Remote-ready" value={devices.filter((device) => device.remote_ready ?? device.rustdesk_available).length} detail={canRemote ? "Online, enrolled, and available for secure access" : "Access requires portal permission"} tone="sky" />
      </div>
      {devices.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((device) => (
            <Card key={device.id} className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none transition hover:border-emerald-400/18">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1",
                    device.status === "online" ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20" : "bg-rose-400/10 text-rose-300 ring-rose-400/20")}>
                    <Monitor className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{device.name || device.hostname}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{device.os || device.device_type || "Managed device"}</p>
                      </div>
                      <PortalBadge value={device.status} />
                    </div>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {[
                    ["CPU", device.cpu_usage],
                    ["Memory", device.memory_usage],
                    ["Disk", device.disk_usage],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-2.5 text-center">
                      <p className="text-sm font-semibold text-slate-200">{value == null ? "—" : `${value}%`}</p>
                      <p className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-600">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-white/[0.07] pt-4">
                  <div>
                    <p className="text-[10px] text-slate-600">Last check-in</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{dateLabel(device.last_check_in || device.last_heartbeat || device.last_seen, true)}</p>
                    <p className={cx(
                      "mt-1 flex items-center gap-1.5 text-[9px]",
                      (device.remote_ready ?? device.rustdesk_available) ? "text-emerald-300" : "text-slate-600",
                    )}>
                      <span className={cx(
                        "h-1.5 w-1.5 rounded-full",
                        (device.remote_ready ?? device.rustdesk_available) ? "bg-emerald-300" : "bg-slate-700",
                      )} />
                      {device.remote_access_reason || ((device.remote_ready ?? device.rustdesk_available) ? "Remote ready" : "Remote unavailable")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => {
                      setRequestForm((current) => ({ ...current, affected_device_id: device.id, affected_device_name: device.name || device.hostname }));
                      setShowRequest(true);
                    }} className="h-8 rounded-lg border-white/10 bg-white/[0.03] px-2.5 text-[11px]">
                      <LifeBuoy className="mr-1.5 h-3.5 w-3.5" />Support
                    </Button>
                    {canRemote && (
                      <Button
                        size="sm"
                        disabled={!(device.remote_ready ?? device.rustdesk_available) || connectingDeviceId === device.id}
                        onClick={() => { setConsentDevice(device); setConsentChecked(false); }}
                        title={device.remote_access_reason || "Authorise a secure remote session"}
                        className="h-8 rounded-lg bg-emerald-400 px-2.5 text-[11px] font-semibold text-emerald-950 hover:bg-emerald-300"
                        data-testid={`portal-remote-${device.id}`}
                      >
                        <Power className="mr-1.5 h-3.5 w-3.5" />Connect
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : <EmptyState icon={Monitor} title="No managed assets are linked" description="Once your MSP links managed devices to this account, their health and support actions will appear here." />}

      {canRemote && (
        <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-white/[0.07] p-5">
              <div><p className="text-sm font-semibold text-white">Remote access history</p><p className="mt-0.5 text-[11px] text-slate-500">Consent, timing, and outcome retained for every session</p></div>
              <LockKeyhole className="h-4 w-4 text-emerald-300" />
            </div>
            {remoteSessions.length ? remoteSessions.slice(0, 8).map((session) => (
              <div key={session.id} className="grid gap-3 border-b border-white/[0.05] p-4 last:border-0 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] text-slate-400"><Network className="h-4 w-4" /></div>
                  <div><p className="text-xs font-semibold text-slate-200">{session.device_name || "Managed device"}</p><p className="mt-0.5 text-[10px] text-slate-600">{dateLabel(session.started_at, true)} · {titleCase(session.status)}</p></div>
                </div>
                <Button variant="outline" size="sm" onClick={() => downloadSessionPdf(session.id)} className="h-8 rounded-lg border-white/10 bg-white/[0.03] text-[11px]"><Download className="mr-1.5 h-3.5 w-3.5" />Audit PDF</Button>
              </div>
            )) : <div className="p-8 text-center text-sm text-slate-600">No client-initiated remote sessions yet.</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );

  const renderServices = () => (
    <div className="space-y-6" data-testid="portal-services">
      <SectionHeader eyebrow="Commercial clarity" title="Managed services" description="Your active agreements and synced subscription quantities, presented in one clear service register." />
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile icon={FileCheck2} label="Active agreements" value={services.summary?.active_contracts || 0} detail="Contracts currently delivering service" tone="emerald" />
        <MetricTile icon={PackageCheck} label="Active subscriptions" value={services.summary?.active_subscriptions || 0} detail="Products and cloud services in scope" tone="sky" />
        <MetricTile icon={UserRound} label="Provisioned seats" value={services.summary?.licensed_seats || 0} detail="Current subscription quantity" tone="violet" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
          <CardContent className="p-0">
            <div className="border-b border-white/[0.07] p-5"><p className="text-sm font-semibold text-white">Service agreements</p><p className="mt-0.5 text-[11px] text-slate-500">Coverage, tier, and renewal visibility</p></div>
            {(services.contracts || []).length ? services.contracts.map((contract) => (
              <div key={contract.id} className="border-b border-white/[0.05] p-4 last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-sm font-semibold text-slate-200">{contract.name || titleCase(contract.type)}</p><p className="mt-1 text-[11px] text-slate-500">{contract.sla_tier || "Managed service"} · {titleCase(contract.billing_frequency || "recurring")}</p></div>
                  <PortalBadge value={contract.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-slate-600">
                  <span>Started {dateLabel(contract.start_date)}</span>
                  <span>Renews {dateLabel(contract.renewal_date || contract.end_date)}</span>
                  {contract.auto_renew && <span className="text-emerald-300">Auto-renew enabled</span>}
                </div>
              </div>
            )) : <div className="p-8 text-center text-sm text-slate-600">No client-visible service agreements are linked.</div>}
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
          <CardContent className="p-0">
            <div className="border-b border-white/[0.07] p-5"><p className="text-sm font-semibold text-white">Subscriptions</p><p className="mt-0.5 text-[11px] text-slate-500">Live quantities used for service and billing reconciliation</p></div>
            {(services.subscriptions || []).length ? services.subscriptions.map((subscription) => (
              <div key={subscription.id} className="grid gap-3 border-b border-white/[0.05] p-4 last:border-0 sm:grid-cols-[1fr_auto] sm:items-center">
                <div><p className="text-sm font-semibold text-slate-200">{subscription.product_name || subscription.name || "Subscription"}</p><p className="mt-1 text-[11px] text-slate-500">{subscription.vendor || subscription.provider || titleCase(subscription.source || "managed")} · {titleCase(subscription.billing_cycle || "monthly")}</p></div>
                <div className="flex items-center gap-3">
                  <div className="text-right"><p className="text-sm font-semibold text-white">{subscription.quantity ?? subscription.used ?? 0}</p><p className="text-[9px] uppercase tracking-wide text-slate-600">Quantity</p></div>
                  <PortalBadge value={subscription.status || "active"} />
                </div>
              </div>
            )) : <div className="p-8 text-center text-sm text-slate-600">No client-visible subscriptions are linked.</div>}
          </CardContent>
        </Card>
      </div>
      {qbrs.length > 0 && (
        <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-white">Service reviews</p><p className="mt-0.5 text-[11px] text-slate-500">Your latest strategy and performance reviews</p></div><BarChart3 className="h-4 w-4 text-violet-300" /></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {qbrs.map((qbr) => (
                <div key={qbr.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <p className="text-xs font-semibold text-slate-200">{qbr.title || qbr.report_name || "Quarterly service review"}</p>
                  <p className="mt-1 text-[10px] text-slate-600">{dateLabel(qbr.generated_at || qbr.created_at)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  const renderBilling = () => (
    <div className="space-y-6" data-testid="portal-billing">
      {selectedInvoice ? (
        <>
          <Button variant="ghost" onClick={() => setSelectedInvoice(null)} className="-ml-2 h-8 text-slate-400 hover:bg-white/[0.04] hover:text-white"><ArrowLeft className="mr-2 h-4 w-4" />Back to billing</Button>
          <div className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[#101820]">
            <div className="border-b border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.12),transparent_36%)] p-6 sm:p-8">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">Tax invoice</p>
                  <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">{selectedInvoice.invoice_number || "Invoice"}</h2>
                  <p className="mt-2 text-sm text-slate-400">{companyName} · Issued {dateLabel(selectedInvoice.issued_date || selectedInvoice.created_at)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={downloadInvoice} disabled={downloadingInvoice} className="h-10 rounded-xl border-white/10 bg-white/[0.03]"><Download className="mr-2 h-4 w-4" />PDF</Button>
                  {Math.max(Number(selectedInvoice.total || 0) - Number(selectedInvoice.amount_paid || 0), 0) > 0.01 && (
                    <Button variant="success" onClick={payInvoice} disabled={payingInvoice} className="h-10 rounded-xl font-semibold"><CreditCard className="mr-2 h-4 w-4" />Pay securely</Button>
                  )}
                </div>
              </div>
              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                {[
                  ["Status", titleCase(selectedInvoice.payment_status || selectedInvoice.status)],
                  ["Due date", dateLabel(selectedInvoice.due_date)],
                  ["Balance", money(Math.max(Number(selectedInvoice.total || 0) - Number(selectedInvoice.amount_paid || 0), 0), selectedInvoice.currency)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-white/[0.07] bg-black/10 p-4"><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-600">{label}</p><p className="mt-2 text-base font-semibold text-slate-200">{value}</p></div>
                ))}
              </div>
            </div>
            <div className="p-5 sm:p-8">
              <div className="overflow-hidden rounded-2xl border border-white/[0.07]">
                <div className="hidden grid-cols-[1fr_80px_120px_120px] gap-3 border-b border-white/[0.07] bg-white/[0.025] px-4 py-3 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600 sm:grid">
                  <span>Description</span><span className="text-center">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
                </div>
                {(selectedInvoice.line_items || []).map((item, index) => (
                  <div key={`${item.id || item.name}-${index}`} className="grid gap-2 border-b border-white/[0.05] px-4 py-4 last:border-0 sm:grid-cols-[1fr_80px_120px_120px] sm:gap-3">
                    <div><p className="text-sm font-medium text-slate-200">{item.product_name || item.name || item.description}</p>{item.description && item.description !== item.name && <p className="mt-1 text-[11px] text-slate-500">{item.description}</p>}</div>
                    <p className="text-sm text-slate-400 sm:text-center">{item.quantity || 1}</p>
                    <p className="text-sm text-slate-400 sm:text-right">{money(item.unit_price || item.rate, selectedInvoice.currency)}</p>
                    <p className="text-sm font-semibold text-slate-200 sm:text-right">{money((item.quantity || 1) * (item.unit_price || item.rate || 0), selectedInvoice.currency)}</p>
                  </div>
                ))}
                {!(selectedInvoice.line_items || []).length && <div className="p-6 text-center text-sm text-slate-600">No line-item detail is available.</div>}
              </div>
              <div className="ml-auto mt-6 max-w-sm space-y-2">
                <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>{money(selectedInvoice.subtotal || selectedInvoice.total, selectedInvoice.currency)}</span></div>
                <div className="flex justify-between text-sm text-slate-500"><span>Tax</span><span>{money(selectedInvoice.tax || selectedInvoice.tax_amount, selectedInvoice.currency)}</span></div>
                <Separator className="my-3 bg-white/[0.07]" />
                <div className="flex justify-between text-lg font-semibold text-white"><span>Total</span><span>{money(selectedInvoice.total, selectedInvoice.currency)}</span></div>
                {Number(selectedInvoice.amount_paid || 0) > 0 && <div className="flex justify-between text-sm text-emerald-300"><span>Paid</span><span>-{money(selectedInvoice.amount_paid, selectedInvoice.currency)}</span></div>}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <SectionHeader eyebrow="Billing centre" title="Invoices and payments" description="Review professional invoice detail, download branded records, and pay securely where enabled." />
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricTile icon={CircleDollarSign} label="Outstanding balance" value={money(outstanding)} detail={`${invoices.filter((invoice) => Math.max(Number(invoice.total || 0) - Number(invoice.amount_paid || 0), 0) > 0.01).length} invoice(s) with a balance`} tone="amber" />
            <MetricTile icon={CheckCircle2} label="Paid invoices" value={invoices.filter((invoice) => (invoice.payment_status || invoice.status) === "paid").length} detail="Retained in your billing history" tone="emerald" />
            <MetricTile icon={ReceiptText} label="Invoice records" value={invoices.length} detail="Available to this portal account" tone="sky" />
          </div>
          {!canViewInvoices ? (
            <EmptyState icon={LockKeyhole} title="Billing access is restricted" description="Your portal administrator can grant invoice permissions to authorised contacts." />
          ) : invoices.length ? (
            <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
              <CardContent className="p-0">
                {invoices.map((invoice) => {
                  const balance = Math.max(Number(invoice.total || 0) - Number(invoice.amount_paid || 0), 0);
                  return (
                    <button key={invoice.id} type="button" onClick={() => openInvoice(invoice)} className="group grid w-full gap-3 border-b border-white/[0.05] p-4 text-left transition last:border-0 hover:bg-white/[0.025] sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/[0.08] text-emerald-300"><ReceiptText className="h-4 w-4" /></div>
                        <div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-200">{invoice.invoice_number || "Invoice"}</p><PortalBadge value={invoice.payment_status || invoice.status} /></div><p className="mt-1 text-[11px] text-slate-500">Issued {dateLabel(invoice.issued_date || invoice.created_at)} · Due {dateLabel(invoice.due_date)}</p></div>
                      </div>
                      <div className="flex items-center justify-between gap-4 sm:justify-end">
                        <div className="text-right"><p className="text-sm font-semibold text-white">{money(invoice.total, invoice.currency)}</p><p className={cx("mt-0.5 text-[10px]", balance > 0 ? "text-amber-300" : "text-emerald-300")}>{balance > 0 ? `${money(balance, invoice.currency)} due` : "Paid in full"}</p></div>
                        <ChevronRight className="h-4 w-4 text-slate-700 group-hover:text-emerald-300" />
                      </div>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          ) : <EmptyState icon={ReceiptText} title="No invoices to show" description="Invoice records shared with your portal will appear here." />}
        </>
      )}
    </div>
  );

  const renderProtection = () => (
    <div className="space-y-6" data-testid="portal-protection">
      <SectionHeader eyebrow="Operational assurance" title="Protection and compliance" description="See backup outcomes and client-specific compliance evidence without exposing unrelated tenant data." />
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile icon={HardDrive} label="Protected workloads" value={backups.summary?.total || 0} detail="Backup jobs linked to your organisation" tone="sky" />
        <MetricTile icon={CheckCircle2} label="Backup success" value={`${backups.summary?.success_rate || 0}%`} detail={`${backups.summary?.successful || 0} successful verification(s)`} tone="emerald" />
        <MetricTile icon={AlertTriangle} label="Needs attention" value={backups.summary?.failed || 0} detail="Failed or unhealthy backup outcomes" tone="amber" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
          <CardContent className="p-0">
            <div className="border-b border-white/[0.07] p-5"><p className="text-sm font-semibold text-white">Backup verification</p><p className="mt-0.5 text-[11px] text-slate-500">Latest client-scoped workload results</p></div>
            {(backups.jobs || []).length ? backups.jobs.slice(0, 10).map((job) => (
              <div key={job.id} className="grid gap-3 border-b border-white/[0.05] p-4 last:border-0 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="flex items-center gap-3"><div className={cx("flex h-9 w-9 items-center justify-center rounded-xl", job.status === "success" ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300")}><HardDrive className="h-4 w-4" /></div><div><p className="text-xs font-semibold text-slate-200">{job.job_name || job.device_name || "Protected workload"}</p><p className="mt-0.5 text-[10px] text-slate-600">Last run {dateLabel(job.last_run, true)}</p></div></div>
                <PortalBadge value={job.status} />
              </div>
            )) : <div className="p-8 text-center text-sm text-slate-600">No backup jobs are linked to this client portal.</div>}
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-white">Compliance evidence</p><p className="mt-0.5 text-[11px] text-slate-500">Latest assessments for {companyName}</p></div><ShieldCheck className="h-4 w-4 text-emerald-300" /></div>
            {(compliance.frameworks || []).length ? (
              <div className="mt-5 space-y-3">
                {compliance.frameworks.map((framework) => (
                  <div key={framework.id || framework.framework} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-200">{framework.name}</p><p className="text-sm font-semibold text-white">{framework.compliance_pct || 0}%</p></div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300" style={{ width: `${Math.min(Number(framework.compliance_pct || 0), 100)}%` }} /></div>
                    <p className="mt-2 text-[10px] text-slate-600">{framework.controls_met || 0} of {framework.controls_total || 0} controls met · Assessed {dateLabel(framework.scanned_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-dashed border-white/10 p-6 text-center"><ShieldCheck className="mx-auto h-7 w-7 text-slate-700" /><p className="mt-3 text-xs font-semibold text-slate-300">No assessment published</p><p className="mt-1 text-[10px] leading-5 text-slate-600">Client-specific compliance results will appear after an assessment is completed and shared.</p></div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderKnowledge = () => (
    <div className="space-y-6" data-testid="portal-knowledge">
      <SectionHeader eyebrow="Self-service knowledge" title="Knowledge centre" description="Search clear, technician-curated guidance before you need to raise a request." />
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-600" />
        <Input value={kbSearch} onChange={(event) => { setKbSearch(event.target.value); setSelectedArticle(null); }} placeholder="Search guides, topics, and answers…" className="h-14 rounded-2xl border-white/[0.08] bg-[#101820] pl-12 text-base shadow-none" />
      </div>
      {selectedArticle ? (
        <article className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[#101820]">
          <div className="border-b border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.12),transparent_36%)] p-6 sm:p-8">
            <Button variant="ghost" onClick={() => setSelectedArticle(null)} className="-ml-2 h-8 text-slate-400 hover:bg-white/[0.04] hover:text-white"><ArrowLeft className="mr-2 h-4 w-4" />All guides</Button>
            <div className="mt-5 flex items-center gap-2"><Badge variant="outline" className="rounded-full border-emerald-400/20 bg-emerald-400/[0.07] text-[10px] text-emerald-300">{selectedArticle.category || "Guide"}</Badge>{(selectedArticle.tags || []).slice(0, 2).map((tag) => <Badge key={tag} variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-[10px] text-slate-500">{tag}</Badge>)}</div>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-white">{selectedArticle.title}</h2>
          </div>
          <div className="mx-auto max-w-3xl p-6 sm:p-8">
            <div className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{selectedArticle.content || selectedArticle.body}</div>
            <div className="mt-8 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-5">
              <p className="text-sm font-semibold text-white">Still need a hand?</p>
              <p className="mt-1 text-xs text-slate-500">Start a request and this guide can remain part of the troubleshooting context.</p>
              {canCreateTickets && <Button variant="success" onClick={() => { setRequestForm((current) => ({ ...current, title: `Help with: ${selectedArticle.title}`, description: `I followed the guide “${selectedArticle.title}” and still need assistance.\n\nWhat happened:\n` })); setShowRequest(true); }} className="mt-4 h-9 rounded-xl text-xs font-semibold"><LifeBuoy className="mr-2 h-4 w-4" />Get support</Button>}
            </div>
          </div>
        </article>
      ) : filteredKb.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredKb.map((article) => (
            <button key={article.id} type="button" onClick={() => setSelectedArticle(article)} className="group flex min-h-[190px] flex-col rounded-2xl border border-white/[0.08] bg-[#101820] p-5 text-left transition hover:-translate-y-0.5 hover:border-emerald-400/20 hover:bg-[#13202a]">
              <div className="flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/[0.08] text-emerald-300"><BookOpen className="h-4 w-4" /></div><ArrowRight className="h-4 w-4 text-slate-700 group-hover:text-emerald-300" /></div>
              <p className="mt-5 line-clamp-2 text-sm font-semibold leading-5 text-slate-200 group-hover:text-white">{article.title}</p>
              <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-500">{article.content || article.body}</p>
              <p className="mt-auto pt-4 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-300">{article.category || "Guide"}</p>
            </button>
          ))}
        </div>
      ) : <EmptyState icon={Search} title="No matching guides" description="Try a broader search, or raise a request so the service desk can help." />}
    </div>
  );

  const renderDocuments = () => (
    <div className="space-y-6" data-testid="portal-documents">
      <SectionHeader eyebrow="Shared records" title="Documents" description="A secure library of the files and runbooks your MSP has explicitly approved for portal access." />
      {documents.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {documents.map((document) => (
            <Card key={document.id} className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-400/[0.08] text-sky-300"><FileText className="h-4 w-4" /></div>
                  <Badge variant="outline" className="rounded-full border-white/10 bg-white/[0.03] text-[9px] uppercase text-slate-500">{document.extension || document.kind || "document"}</Badge>
                </div>
                <p className="mt-5 line-clamp-2 text-sm font-semibold text-white">{document.title}</p>
                <p className="mt-2 text-[11px] text-slate-500">{document.category || "General"} · Updated {dateLabel(document.updated_at || document.created_at)}</p>
                {document.url ? (
                  <Button variant="outline" onClick={() => window.open(document.url, "_blank", "noopener,noreferrer")} className="mt-5 h-9 w-full rounded-xl border-white/10 bg-white/[0.03] text-xs"><Download className="mr-2 h-4 w-4" />Open document</Button>
                ) : (
                  <Button variant="outline" disabled className="mt-5 h-9 w-full rounded-xl border-white/10 bg-white/[0.03] text-xs">Runbook available in portal</Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : <EmptyState icon={FileCheck2} title="No documents have been shared" description="Documents remain private by default. Files explicitly approved for your portal will appear here." />}
    </div>
  );

  const renderAccount = () => (
    <div className="space-y-6" data-testid="portal-account">
      <SectionHeader eyebrow="Identity and access" title="Your account" description="Manage your contact details, sign-in security, and portal permissions." />
      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
          <CardContent className="p-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/25 to-sky-400/10 text-xl font-bold text-emerald-200 ring-1 ring-emerald-400/20">{initials(userName)}</div>
            <h3 className="mt-5 text-xl font-semibold text-white">{userName}</h3>
            <p className="mt-1 text-sm text-slate-500">{profile?.user?.email}</p>
            <div className="mt-5 space-y-3 border-t border-white/[0.07] pt-5">
              <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Organisation</span><span className="text-xs font-medium text-slate-300">{companyName}</span></div>
              <div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Multi-factor authentication</span><PortalBadge value={profile?.totp_enabled ? "active" : "offline"}>{profile?.totp_enabled ? "Enabled" : "Not enabled"}</PortalBadge></div>
              <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Remote access</span><span className="text-xs font-medium text-slate-300">{canRemote ? "Permitted" : "Restricted"}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Billing access</span><span className="text-xs font-medium text-slate-300">{canViewInvoices ? "Permitted" : "Restricted"}</span></div>
            </div>
            <Button variant="outline" onClick={openSecurity} disabled={securityLoading} className="mt-5 h-10 w-full rounded-xl border-white/10 bg-white/[0.03] text-xs">
              {securityLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              {profile?.totp_enabled ? "Manage sign-in security" : "Protect account with MFA"}
            </Button>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-white/[0.08] bg-[#101820] shadow-none">
          <CardContent className="p-6">
            <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-white">Contact details</p><p className="mt-0.5 text-[11px] text-slate-500">Used by the service desk when a request needs a response</p></div><Settings2 className="h-4 w-4 text-emerald-300" /></div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label className="text-xs text-slate-400">Full name</Label><Input value={accountForm.name} onChange={(event) => setAccountForm((current) => ({ ...current, name: event.target.value }))} className="h-11 rounded-xl border-white/[0.08] bg-black/15" /></div>
              <div className="space-y-2"><Label className="text-xs text-slate-400">Phone</Label><Input value={accountForm.phone} onChange={(event) => setAccountForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+61…" className="h-11 rounded-xl border-white/[0.08] bg-black/15" /></div>
              <div className="space-y-2 sm:col-span-2"><Label className="text-xs text-slate-400">Email</Label><Input value={profile?.user?.email || ""} disabled className="h-11 rounded-xl border-white/[0.08] bg-white/[0.02] text-slate-500" /><p className="text-[10px] text-slate-600">Email changes require identity verification by your portal administrator.</p></div>
            </div>
            <div className="mt-6 flex justify-end"><Button variant="success" onClick={saveAccount} disabled={savingAccount} className="h-10 rounded-xl font-semibold">{savingAccount ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Save changes</Button></div>
          </CardContent>
        </Card>
      </div>
      <Card className="rounded-2xl border-emerald-400/12 bg-emerald-400/[0.035] shadow-none">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300"><LockKeyhole className="h-4 w-4" /></div><div><p className="text-sm font-semibold text-white">Secure client workspace</p><p className="mt-1 text-xs leading-5 text-slate-500">Your access is scoped to {companyName}. Sensitive technician-only notes and documents are never exposed here.</p></div></div>
          <Button variant="outline" onClick={logout} className="h-10 shrink-0 rounded-xl border-white/10 bg-white/[0.03]"><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
        </CardContent>
      </Card>
    </div>
  );

  const viewContent = {
    overview: renderOverview,
    requests: renderRequests,
    assets: renderAssets,
    services: renderServices,
    billing: renderBilling,
    protection: renderProtection,
    knowledge: renderKnowledge,
    documents: renderDocuments,
    account: renderAccount,
  };

  return (
    <div className="min-h-screen bg-[#080d12] text-slate-100" data-testid="portal-dashboard" style={{ "--portal-primary": primaryColor }}>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_72%_-12%,rgba(52,211,153,0.08),transparent_32%)]" />
      <aside className={cx("fixed inset-y-0 left-0 z-50 w-[270px] border-r border-white/[0.07] bg-[#0a1016]/95 p-4 backdrop-blur-xl transition-transform lg:translate-x-0", mobileNav ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-2 py-2">
            <button type="button" onClick={() => selectView("overview")} className="flex min-w-0 items-center gap-3 text-left">
              {mspLogo && !logoFailed ? <img src={mspLogo} alt={mspName} onError={() => setLogoFailed(true)} className="h-9 w-9 rounded-xl object-contain" /> : <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400 text-sm font-black text-emerald-950">{initials(mspName)}</div>}
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{mspName}</p><p className="truncate text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-300">Client workspace</p></div>
            </button>
            <Button variant="ghost" size="icon" onClick={() => setMobileNav(false)} className="h-8 w-8 text-slate-500 lg:hidden"><X className="h-4 w-4" /></Button>
          </div>
          <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400/20 to-sky-400/10 text-[11px] font-bold text-emerald-200 ring-1 ring-emerald-400/15">{initials(companyName)}</div>
              <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-200">{companyName}</p><p className="mt-0.5 truncate text-[10px] text-slate-600">Signed in as {userName}</p></div>
            </div>
          </div>
          <nav className="mt-5 space-y-1">
            {NAV_ITEMS.filter((item) => {
              if (item.id === "billing") return canViewInvoices && features.can_view_invoices !== false;
              if (item.id === "assets") return permissions.can_view_assets !== false && features.can_view_devices !== false;
              if (item.id === "services") return features.can_view_contracts !== false;
              if (item.id === "knowledge") return features.can_view_kb !== false;
              return true;
            }).map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => selectView(id)} className={cx("group flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-xs font-medium transition",
                view === id ? "bg-emerald-400/10 text-emerald-200 ring-1 ring-emerald-400/15" : "text-slate-500 hover:bg-white/[0.035] hover:text-slate-200")}>
                <Icon className={cx("h-4 w-4", view === id ? "text-emerald-300" : "text-slate-600 group-hover:text-slate-400")} />
                <span className="flex-1">{label}</span>
                {id === "requests" && openRequests.length > 0 && <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[9px] font-bold text-sky-300">{openRequests.length}</span>}
                {id === "protection" && (backups.summary?.failed || 0) > 0 && <span className="h-2 w-2 rounded-full bg-amber-300" />}
              </button>
            ))}
          </nav>
          <div className="mt-auto">
            <div className="rounded-2xl border border-emerald-400/12 bg-emerald-400/[0.035] p-4">
              <div className="flex items-center gap-2 text-emerald-300"><Headphones className="h-4 w-4" /><p className="text-xs font-semibold">Need support?</p></div>
              <p className="mt-2 text-[10px] leading-5 text-slate-600">Create a tracked request and keep every update in one place.</p>
              {canCreateTickets && <Button variant="success" onClick={() => setShowRequest(true)} className="mt-3 h-8 w-full rounded-lg text-[11px] font-semibold"><Plus className="mr-1.5 h-3.5 w-3.5" />New request</Button>}
            </div>
            <button type="button" onClick={logout} className="mt-3 flex h-9 w-full items-center gap-3 rounded-xl px-3 text-xs text-slate-600 transition hover:bg-rose-400/[0.05] hover:text-rose-300"><LogOut className="h-4 w-4" />Sign out</button>
          </div>
        </div>
      </aside>

      {mobileNav && <button type="button" aria-label="Close navigation" onClick={() => setMobileNav(false)} className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" />}

      <div className="relative lg:pl-[270px]">
        <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#080d12]/88 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex max-w-[1500px] items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setMobileNav(true)} className="h-9 w-9 shrink-0 text-slate-400 lg:hidden"><Menu className="h-5 w-5" /></Button>
            <div className="relative max-w-2xl flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
              <Input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requests, assets, services, invoices, documents, and guides…" className="h-10 rounded-xl border-white/[0.07] bg-white/[0.025] pl-10 pr-14 text-sm shadow-none" data-testid="portal-global-search" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-slate-600">Ctrl K</span>
              {query.trim().length >= 2 && (
                <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-2xl border border-white/10 bg-[#101820] shadow-2xl shadow-black/60">
                  {globalResults.length ? globalResults.map((result, index) => (
                    <button key={`${result.type}-${result.detail}-${index}`} type="button" onClick={() => chooseGlobalResult(result)} className="flex w-full items-center gap-3 border-b border-white/[0.05] p-3 text-left last:border-0 hover:bg-white/[0.04]">
                      <Badge variant="outline" className="w-[62px] justify-center rounded-full border-white/10 bg-white/[0.03] text-[9px] text-slate-500">{result.type}</Badge>
                      <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-200">{result.label}</p><p className="mt-0.5 truncate text-[10px] text-slate-600">{result.detail}</p></div>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-700" />
                    </button>
                  )) : <p className="p-5 text-center text-xs text-slate-600">No portal records match “{query}”.</p>}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowNotifications(true)}
              className="relative h-9 w-9 shrink-0 rounded-xl text-slate-500 hover:bg-white/[0.04] hover:text-white"
              aria-label={`Notifications${attentionItems.length ? `, ${attentionItems.length} requiring attention` : ""}`}
              data-testid="portal-notifications-button"
            >
              <Bell className="h-4 w-4" />
              {attentionItems.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[#080d12] bg-amber-300 px-1 text-[8px] font-bold text-amber-950">
                  {attentionItems.length > 9 ? "9+" : attentionItems.length}
                </span>
              )}
            </Button>
            <button type="button" onClick={() => selectView("account")} className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-2.5 text-left transition hover:bg-white/[0.04]">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-400/10 text-[9px] font-bold text-emerald-200">{initials(userName)}</span>
              <span className="hidden max-w-[120px] truncate text-xs font-medium text-slate-300 sm:block">{userName}</span>
              <ChevronDown className="hidden h-3.5 w-3.5 text-slate-700 sm:block" />
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] p-4 pb-12 sm:p-6 lg:p-8">
          {viewContent[view]?.()}
        </main>
      </div>

      <Dialog open={showRequest} onOpenChange={setShowRequest}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-white/10 bg-[#101820] p-0 [scrollbar-color:rgba(255,255,255,0.14)_transparent] [scrollbar-width:thin] sm:max-w-[780px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5" aria-describedby="portal-request-description">
          <DialogHeader className="border-b border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.12),transparent_38%)] p-6 text-left">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20"><LifeBuoy className="h-5 w-5" /></div>
            <DialogTitle className="pt-3 text-2xl font-semibold tracking-tight text-white">Create a service request</DialogTitle>
            <DialogDescription id="portal-request-description" className="max-w-xl text-sm leading-6 text-slate-400">Give the service desk enough context to route and resolve your request quickly. Every update becomes part of the shared audit trail.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 p-6">
            <section>
              <div className="flex items-center gap-3"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-400/10 text-[10px] font-bold text-emerald-300">1</span><div><p className="text-sm font-semibold text-white">What do you need?</p><p className="text-[10px] text-slate-600">Choose the request type and summarise the outcome you need.</p></div></div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label className="text-xs text-slate-400">Request type</Label><Select value={requestForm.request_type} onValueChange={(value) => setRequestForm((current) => ({ ...current, request_type: value }))}><SelectTrigger className="h-11 rounded-xl border-white/[0.08] bg-black/15"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="incident">Something is broken</SelectItem><SelectItem value="service_request">Request a service</SelectItem><SelectItem value="access">Access or permissions</SelectItem><SelectItem value="change">Request a change</SelectItem><SelectItem value="security">Security concern</SelectItem><SelectItem value="billing">Billing question</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label className="text-xs text-slate-400">Category</Label><Select value={requestForm.category} onValueChange={(value) => setRequestForm((current) => ({ ...current, category: value }))}><SelectTrigger className="h-11 rounded-xl border-white/[0.08] bg-black/15"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="support">General support</SelectItem><SelectItem value="hardware">Hardware</SelectItem><SelectItem value="software">Software</SelectItem><SelectItem value="network">Network</SelectItem><SelectItem value="security">Security</SelectItem><SelectItem value="billing">Billing</SelectItem></SelectContent></Select></div>
                <div className="space-y-2 sm:col-span-2"><Label className="text-xs text-slate-400">Subject</Label><Input value={requestForm.title} onChange={(event) => setRequestForm((current) => ({ ...current, title: event.target.value }))} placeholder="A short, specific summary" className="h-11 rounded-xl border-white/[0.08] bg-black/15" data-testid="portal-ticket-title" /></div>
                <div className="space-y-2 sm:col-span-2"><Label className="text-xs text-slate-400">Description</Label><Textarea value={requestForm.description} onChange={(event) => setRequestForm((current) => ({ ...current, description: event.target.value }))} placeholder="What happened? What were you trying to do? Include any error message and when it started." rows={6} className="resize-none rounded-xl border-white/[0.08] bg-black/15" data-testid="portal-ticket-description" /></div>
              </div>
            </section>
            <Separator className="bg-white/[0.07]" />
            <section>
              <div className="flex items-center gap-3"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-400/10 text-[10px] font-bold text-sky-300">2</span><div><p className="text-sm font-semibold text-white">Impact and context</p><p className="text-[10px] text-slate-600">This helps NexusMSP prioritise and assign the right technician.</p></div></div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label className="text-xs text-slate-400">Business impact</Label><Select value={requestForm.impact} onValueChange={(value) => setRequestForm((current) => ({ ...current, impact: value }))}><SelectTrigger className="h-11 rounded-xl border-white/[0.08] bg-black/15"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single_user">One person</SelectItem><SelectItem value="multiple_users">Several people</SelectItem><SelectItem value="department">A department</SelectItem><SelectItem value="organisation">The whole organisation</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label className="text-xs text-slate-400">Urgency</Label><Select value={requestForm.urgency} onValueChange={(value) => setRequestForm((current) => ({ ...current, urgency: value, priority: value }))}><SelectTrigger className="h-11 rounded-xl border-white/[0.08] bg-black/15"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low · can be scheduled</SelectItem><SelectItem value="medium">Normal · affecting work</SelectItem><SelectItem value="high">High · significant disruption</SelectItem><SelectItem value="critical">Critical · operations stopped</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label className="text-xs text-slate-400">Affected asset</Label><Select value={requestForm.affected_device_id || "none"} onValueChange={(value) => setRequestForm((current) => ({ ...current, affected_device_id: value === "none" ? "" : value }))}><SelectTrigger className="h-11 rounded-xl border-white/[0.08] bg-black/15"><SelectValue placeholder="Choose a device" /></SelectTrigger><SelectContent><SelectItem value="none">No specific device</SelectItem>{devices.map((device) => <SelectItem key={device.id} value={device.id}>{device.name || device.hostname} · {titleCase(device.status)}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label className="text-xs text-slate-400">Preferred response</Label><Select value={requestForm.preferred_contact} onValueChange={(value) => setRequestForm((current) => ({ ...current, preferred_contact: value }))}><SelectTrigger className="h-11 rounded-xl border-white/[0.08] bg-black/15"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="portal">Portal conversation</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="phone">Phone call</SelectItem></SelectContent></Select></div>
              </div>
            </section>
            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.035] p-4">
              <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><div><p className="text-xs font-semibold text-slate-200">Shared service record</p><p className="mt-1 text-[10px] leading-5 text-slate-500">Your description and all public replies are retained with timestamps for service history and audit. Technician-only internal notes remain private.</p></div></div>
            </div>
          </div>
          <DialogFooter className="border-t border-white/[0.07] bg-black/10 p-4 sm:px-6">
            <Button variant="ghost" onClick={() => setShowRequest(false)} className="rounded-xl">Cancel</Button>
            <Button variant="success" onClick={createRequest} disabled={creatingRequest} className="rounded-xl font-semibold" data-testid="portal-ticket-submit">{creatingRequest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Submit request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNotifications} onOpenChange={setShowNotifications}>
        <DialogContent
          className="max-h-[88vh] overflow-hidden border-white/10 bg-[#101820] p-0 sm:max-w-[640px]"
          aria-describedby="portal-notifications-description"
          data-testid="portal-notifications-dialog"
        >
          <DialogHeader className="border-b border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_42%)] p-6 text-left">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/20">
                  <Bell className="h-5 w-5" />
                </div>
                <DialogTitle className="pt-3 text-2xl font-semibold tracking-tight text-white">Attention centre</DialogTitle>
                <DialogDescription id="portal-notifications-description" className="mt-1 max-w-lg text-sm leading-6 text-slate-400">
                  Priority service, protection, and billing updates for {companyName}, followed by the latest shared activity.
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fetchPortal(true)}
                disabled={refreshing}
                className="mt-1 shrink-0 rounded-xl border-white/10 bg-white/[0.03] text-slate-300"
              >
                <RefreshCw className={cx("mr-1.5 h-3.5 w-3.5", refreshing && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </DialogHeader>

          <div className="max-h-[calc(88vh-180px)] space-y-6 overflow-y-auto p-6 [scrollbar-color:rgba(255,255,255,0.14)_transparent] [scrollbar-width:thin]">
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Requires attention</p>
                  <p className="mt-0.5 text-[10px] text-slate-600">Open an item to continue in the relevant portal workspace.</p>
                </div>
                <Badge variant="outline" className={cx(
                  "rounded-full px-2.5 text-[10px]",
                  attentionItems.length
                    ? "border-amber-400/20 bg-amber-400/10 text-amber-300"
                    : "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
                )}>
                  {attentionItems.length || "Clear"}
                </Badge>
              </div>

              {attentionItems.length ? (
                <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black/10">
                  {attentionItems.slice(0, 10).map((item) => {
                    const ItemIcon = item.icon;
                    const tone = {
                      rose: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
                      amber: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
                      sky: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
                    }[item.tone] || "bg-slate-400/10 text-slate-300 ring-white/10";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openAttentionItem(item)}
                        className="group flex w-full items-center gap-3 border-b border-white/[0.06] p-3.5 text-left transition last:border-0 hover:bg-white/[0.035]"
                        data-testid={`portal-attention-${item.id}`}
                      >
                        <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1", tone)}>
                          <ItemIcon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-slate-200">{item.title}</span>
                          <span className="mt-1 block truncate text-[10px] text-slate-500">{item.detail}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[9px] text-slate-600">{dateLabel(item.timestamp)}</span>
                          <ChevronRight className="ml-auto mt-1 h-3.5 w-3.5 text-slate-700 transition group-hover:translate-x-0.5 group-hover:text-emerald-300" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-400/12 bg-emerald-400/[0.035] p-4">
                  <div className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                    <div>
                      <p className="text-xs font-semibold text-slate-200">Nothing requires immediate attention</p>
                      <p className="mt-1 text-[10px] leading-5 text-slate-500">Priority requests, failed protection jobs, and overdue invoices will appear here automatically.</p>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section>
              <div className="mb-3">
                <p className="text-sm font-semibold text-white">Recent shared activity</p>
                <p className="mt-0.5 text-[10px] text-slate-600">Customer-visible changes retained in your service history.</p>
              </div>
              {recentPortalActivity.length ? (
                <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black/10">
                  {recentPortalActivity.map((event, index) => (
                    <div key={event.id || `${event.type || event.action}-${index}`} className="flex gap-3 border-b border-white/[0.06] p-3.5 last:border-0">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-400/[0.07] text-emerald-300 ring-1 ring-emerald-400/15">
                        <Activity className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-300">
                          {event.title || event.summary || event.action || event.type || "Service activity"}
                        </p>
                        {(event.description || event.detail || event.message) && (
                          <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-600">{event.description || event.detail || event.message}</p>
                        )}
                      </div>
                      <p className="shrink-0 text-[9px] text-slate-600">{dateLabel(event.timestamp || event.created_at)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-8 text-center">
                  <History className="mx-auto h-5 w-5 text-slate-700" />
                  <p className="mt-2 text-xs font-medium text-slate-400">No recent shared activity</p>
                  <p className="mt-1 text-[10px] text-slate-600">New customer-visible service changes will be listed here.</p>
                </div>
              )}
            </section>

            <div className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <p className="text-[10px] leading-5 text-slate-600">Only records shared with this portal identity are displayed. Technician-only notes, internal alerts, and restricted documents remain private.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSecurity} onOpenChange={setShowSecurity}>
        <DialogContent className="border-white/10 bg-[#101820] p-0 sm:max-w-[590px]" aria-describedby="portal-security-description">
          <DialogHeader className="border-b border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.12),transparent_40%)] p-6 text-left">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20"><ShieldCheck className="h-5 w-5" /></div>
            <DialogTitle className="pt-3 text-2xl font-semibold tracking-tight text-white">
              {profile?.totp_enabled ? "Manage sign-in security" : "Protect your account"}
            </DialogTitle>
            <DialogDescription id="portal-security-description" className="text-sm leading-6 text-slate-400">
              {profile?.totp_enabled
                ? "Multi-factor authentication is active. Enter a current code only if you need to disable it."
                : "Add this account to Microsoft Authenticator, Google Authenticator, Keeper, or another TOTP-compatible app."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 p-6">
            {!profile?.totp_enabled && (
              <div className="rounded-2xl border border-white/[0.08] bg-black/15 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">Authenticator setup key</p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-xs tracking-[0.12em] text-emerald-200">{securitySecret}</code>
                  <Button type="button" variant="outline" size="icon" onClick={() => { navigator.clipboard?.writeText(securitySecret); toast.success("Setup key copied"); }} className="h-10 w-10 shrink-0 rounded-xl border-white/10 bg-white/[0.03]" aria-label="Copy setup key"><Copy className="h-4 w-4" /></Button>
                </div>
                <p className="mt-3 text-[10px] leading-5 text-slate-600">Keep this key private. NexusMSP will never ask you to send it to a technician.</p>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-xs text-slate-400">Six-digit authenticator code</Label>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={securityCode}
                onChange={(event) => setSecurityCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="h-14 rounded-xl border-white/[0.08] bg-black/15 text-center text-2xl tracking-[0.35em]"
                data-testid="portal-security-code"
              />
            </div>
            <div className="flex gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.035] p-4">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              <p className="text-[11px] leading-5 text-slate-500">Security changes are applied only to your portal identity and are retained in the client access record.</p>
            </div>
          </div>
          <DialogFooter className="border-t border-white/[0.07] bg-black/10 p-4 sm:px-6">
            <Button variant="ghost" onClick={() => setShowSecurity(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={updateTwoFactor} disabled={securityLoading || securityCode.length !== 6} className={cx("rounded-xl font-semibold", profile?.totp_enabled ? "bg-rose-500 text-white hover:bg-rose-400" : "bg-emerald-400 text-emerald-950 hover:bg-emerald-300")}>
              {securityLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              {profile?.totp_enabled ? "Disable MFA" : "Enable MFA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!consentDevice} onOpenChange={(open) => !open && setConsentDevice(null)}>
        <DialogContent className="border-white/10 bg-[#101820] sm:max-w-[560px]" aria-describedby="remote-consent-description">
          <DialogHeader>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20"><LockKeyhole className="h-5 w-5" /></div>
            <DialogTitle className="pt-3 text-xl text-white">Authorise secure remote access</DialogTitle>
            <DialogDescription id="remote-consent-description" className="text-slate-400">You are connecting to {consentDevice?.name || consentDevice?.hostname}. This action is recorded for security and audit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/[0.08] bg-black/15 p-4 text-xs leading-6 text-slate-400">
              <ul className="list-disc space-y-1 pl-4"><li>The session is initiated by you from the secure portal.</li><li>Timing, device, consent, and outcome are logged.</li><li>An authorised technician may observe or assist.</li><li>A downloadable audit PDF remains available.</li></ul>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.08] p-4 transition hover:bg-white/[0.025]">
              <input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} className="mt-0.5" />
              <span className="text-xs leading-5 text-slate-300"><strong>I authorise this session</strong> and understand that the remote-access event will be retained for audit and service-quality purposes.</span>
            </label>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setConsentDevice(null)}>Cancel</Button><Button variant="success" onClick={connectDevice} disabled={!consentChecked || connectingDeviceId === consentDevice?.id} className="font-semibold">{connectingDeviceId === consentDevice?.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}Authorise and connect</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!activeRemoteSession} onOpenChange={() => {}}>
        <DialogContent className="border-white/10 bg-[#101820] sm:max-w-[520px]" aria-describedby="active-session-description">
          <DialogHeader><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20"><Activity className="h-5 w-5 animate-pulse" /></div><DialogTitle className="pt-3 text-xl text-white">Remote session in progress</DialogTitle><DialogDescription id="active-session-description" className="text-slate-400">Connected to {activeRemoteSession?.device_name}. End the session here when complete so the audit record is finalised.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label className="text-xs text-slate-400">Completion notes</Label><Textarea value={endSessionNotes} onChange={(event) => setEndSessionNotes(event.target.value)} placeholder="Optional summary of work completed" rows={4} className="resize-none rounded-xl border-white/[0.08] bg-black/15" /></div>
          <DialogFooter><Button variant="destructive" onClick={endRemoteSession} disabled={endingSession} className="rounded-xl">{endingSession ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}End and log session</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
