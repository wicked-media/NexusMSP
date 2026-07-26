import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, ArrowUpRight, Building2, Check, CheckCircle2, Clock3,
  Copy, ExternalLink, Eye, FileText, Globe, KeyRound, Link2, Loader2,
  LockKeyhole, LogIn, LogOut, Mail, Monitor, Palette, Plus, RefreshCw,
  RotateCw, Save, Search, Settings2, ShieldAlert, ShieldCheck, Ticket, Trash2,
  UserCheck, UserPlus, Users, XCircle,
} from "lucide-react";

const FEATURE_OPTIONS = [
  { key: "can_create_tickets", label: "Create support requests", desc: "Submit and follow support tickets", icon: Ticket },
  { key: "can_view_devices", label: "Managed assets", desc: "See assigned devices and service health", icon: Monitor },
  { key: "can_view_invoices", label: "Invoices & payments", desc: "Review invoices and download documents", icon: FileText },
  { key: "can_view_contracts", label: "Contracts & services", desc: "Review active agreements and inclusions", icon: ShieldCheck },
  { key: "can_view_kb", label: "Knowledge centre", desc: "Use client-facing help and self-service guides", icon: Globe },
];

const USER_PERMISSIONS = [
  { key: "can_view_all_tickets", label: "View all tickets", desc: "See every support request for the client" },
  { key: "can_create_tickets", label: "Create tickets", desc: "Submit new support requests" },
  { key: "can_view_assets", label: "View managed assets", desc: "See device status and health" },
  { key: "can_view_invoices", label: "View invoices", desc: "Access billing and payment information" },
  { key: "can_remote_devices", label: "Remote to devices", desc: "Launch an authorised remote session" },
];

const EMPTY_USER = {
  name: "",
  email: "",
  role: "user",
  password: "",
  can_view_all_tickets: true,
  can_create_tickets: true,
  can_view_assets: true,
  can_view_invoices: false,
  can_remote_devices: false,
  send_welcome_email: true,
};

function dateLabel(value) {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Never";
  return parsed.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function dateTimeLabel(value) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return parsed.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function eventPresentation(event) {
  const action = event.action || "portal_activity";
  if (action.includes("login") && event.outcome === "success") return { icon: LogIn, tone: "emerald", label: "Sign-in succeeded" };
  if (action.includes("logout")) return { icon: LogOut, tone: "zinc", label: "Signed out" };
  if (action.includes("mfa")) return { icon: ShieldCheck, tone: event.outcome === "success" ? "cyan" : "rose", label: action.replaceAll("_", " ") };
  if (action.includes("secure_link")) return { icon: Link2, tone: event.outcome === "success" ? "violet" : "amber", label: action.replaceAll("_", " ") };
  if (event.outcome === "failed" || event.outcome === "blocked") return { icon: ShieldAlert, tone: "rose", label: action.replaceAll("_", " ") };
  if (action.includes("user")) return { icon: UserCheck, tone: "cyan", label: action.replaceAll("_", " ") };
  return { icon: Activity, tone: "emerald", label: action.replaceAll("_", " ") };
}

function initials(value = "") {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "CL";
}

function WorkflowDialogHeader({ icon: Icon, eyebrow, title, description }) {
  return (
    <div className="border-b border-white/10 bg-gradient-to-r from-emerald-500/10 via-cyan-500/5 to-transparent px-6 py-5">
      <DialogHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">{eyebrow}</p>
            <DialogTitle className="mt-1 text-xl">{title}</DialogTitle>
            <DialogDescription className="mt-1 max-w-2xl">{description}</DialogDescription>
          </div>
        </div>
      </DialogHeader>
    </div>
  );
}

export default function ClientPortalPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [clients, setClients] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [config, setConfig] = useState(null);
  const [portalUsers, setPortalUsers] = useState([]);
  const [accessLogs, setAccessLogs] = useState([]);
  const [activityFilter, setActivityFilter] = useState("all");
  const [clientSearch, setClientSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [workspaceTab, setWorkspaceTab] = useState("experience");
  const [showGenToken, setShowGenToken] = useState(false);
  const [tokenForm, setTokenForm] = useState({ contact_name: "", contact_email: "", expiry_days: 90 });
  const [newTokenUrl, setNewTokenUrl] = useState(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [userForm, setUserForm] = useState(EMPTY_USER);
  const [addingUser, setAddingUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(null);
  const [editUserForm, setEditUserForm] = useState({});
  const [showTempPassword, setShowTempPassword] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const selectClient = useCallback(async (clientId, options = {}) => {
    setSelectedClient(clientId);
    setConfig(null);
    if (!options.keepTab) setWorkspaceTab("experience");
    try {
      const [configRes, usersRes, logsRes] = await Promise.all([
        axios.get(`${API}/client-portal/config/${clientId}`, { headers }),
        axios.get(`${API}/client-portal/users/${clientId}`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/client-portal/access-logs`, {
          headers,
          params: { client_id: clientId, days: 365, limit: 500 },
        }).catch(() => ({ data: [] })),
      ]);
      setConfig(configRes.data);
      setPortalUsers(usersRes.data || []);
      setAccessLogs(logsRes.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Portal configuration could not be loaded");
    }
  }, [headers]);

  const loadWorkspace = useCallback(async ({ quiet = false } = {}) => {
    quiet ? setRefreshing(true) : setLoading(true);
    try {
      const [clientsRes, configsRes] = await Promise.all([
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/client-portal/all`, { headers }),
      ]);
      const nextClients = clientsRes.data || [];
      setClients(nextClients);
      setConfigs(configsRes.data || []);
      if (!selectedClient && nextClients[0]?.id) {
        await selectClient(nextClients[0].id, { keepTab: true });
      } else if (selectedClient) {
        await selectClient(selectedClient, { keepTab: true });
      }
      if (quiet) toast.success("Portal workspace refreshed");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Portal workspace could not be loaded");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers, selectClient, selectedClient]);

  useEffect(() => {
    loadWorkspace();
    // The initial load deliberately owns client auto-selection. Subsequent
    // refreshes use the explicit Refresh control so a selected record is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const requestedView = new URLSearchParams(location.search).get("view");
    if (requestedView === "access") setWorkspaceTab("users");
    if (requestedView === "links") setWorkspaceTab("links");
    if (requestedView === "activity") setWorkspaceTab("activity");
  }, [location.search]);

  const selectedClientRecord = useMemo(
    () => clients.find((client) => client.id === selectedClient) || null,
    [clients, selectedClient],
  );

  const configByClient = useMemo(
    () => new Map(configs.map((item) => [item.client_id, item])),
    [configs],
  );

  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    return clients.filter((client) => {
      const portalConfig = configByClient.get(client.id);
      if (clientFilter === "active" && !portalConfig?.enabled) return false;
      if (clientFilter === "setup" && portalConfig?.enabled) return false;
      if (!query) return true;
      return `${client.name || ""} ${client.email || ""}`.toLowerCase().includes(query);
    });
  }, [clientFilter, clientSearch, clients, configByClient]);

  const activePortals = configs.filter((item) => item.enabled).length;
  const secureLinks = configs.reduce((total, item) => total + (item.access_tokens?.length || 0), 0);
  const coverage = clients.length ? Math.round((activePortals / clients.length) * 100) : 0;
  const enabledFeatures = FEATURE_OPTIONS.filter((item) => config?.features?.[item.key]).length;
  const activeUsers = portalUsers.filter((user) => user.is_active !== false).length;
  const failedAccess = accessLogs.filter((event) => event.outcome === "failed" || event.outcome === "blocked").length;
  const filteredAccessLogs = accessLogs.filter((event) => {
    if (activityFilter === "failures") return event.outcome === "failed" || event.outcome === "blocked";
    if (activityFilter === "security") return /login|logout|mfa|secure_link|password/.test(event.action || "");
    if (activityFilter === "administration") return /configuration|invited|updated|removed|generated|revoked|reset/.test(event.action || "");
    return true;
  });

  const updateConfig = (path, value) => {
    if (path === "enabled") {
      setConfig((current) => ({ ...current, enabled: value }));
      return;
    }
    const [group, key] = path.split(".");
    setConfig((current) => ({ ...current, [group]: { ...(current?.[group] || {}), [key]: value } }));
  };

  const saveConfig = async () => {
    if (!selectedClient || !config) return;
    setSaving(true);
    try {
      await axios.put(`${API}/client-portal/config/${selectedClient}`, config, { headers });
      setConfigs((current) => {
        const next = current.filter((item) => item.client_id !== selectedClient);
        return [...next, { ...config, client_id: selectedClient }];
      });
      toast.success("Client portal experience saved");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Portal configuration could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async (value, message) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error("Clipboard access is unavailable");
    }
  };

  const openPortalPreview = () => {
    const firstToken = config?.access_tokens?.[0]?.token;
    if (!firstToken) {
      setWorkspaceTab("links");
      toast.info("Generate a secure preview link for this client first");
      return;
    }
    window.open(`/portal/${firstToken}`, "_blank", "noopener,noreferrer");
  };

  const generateToken = async () => {
    if (!selectedClient) return;
    try {
      const response = await axios.post(`${API}/client-portal/generate-token/${selectedClient}`, tokenForm, { headers });
      setNewTokenUrl(response.data.portal_url);
      setShowGenToken(false);
      await selectClient(selectedClient, { keepTab: true });
      setConfigs((current) => {
        const found = current.find((item) => item.client_id === selectedClient);
        if (!found) return [...current, { client_id: selectedClient, enabled: true, access_tokens: [response.data.entry] }];
        return current.map((item) => item.client_id === selectedClient
          ? { ...item, enabled: true, access_tokens: [...(item.access_tokens || []), response.data.entry] }
          : item);
      });
      toast.success("Secure client portal link generated");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Secure link could not be generated");
    }
  };

  const revokeToken = async (tokenId) => {
    try {
      await axios.delete(`${API}/client-portal/tokens/${selectedClient}/${tokenId}`, { headers });
      await selectClient(selectedClient, { keepTab: true });
      setConfirmAction(null);
      toast.success("Secure portal link revoked");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Secure link could not be revoked");
    }
  };

  const addPortalUser = async () => {
    if (!userForm.email.trim()) {
      toast.error("Email is required");
      return;
    }
    setAddingUser(true);
    try {
      const response = await axios.post(
        `${API}/client-portal/users/${selectedClient}`,
        { ...userForm, portal_url: `${window.location.origin}/portal-login` },
        { headers },
      );
      const emailStatus = response.data.email_status;
      toast.success(emailStatus === "sent"
        ? `Invitation sent to ${response.data.email}`
        : `Portal user created for ${response.data.email}`);
      setShowTempPassword({ email: response.data.email, password: response.data.temp_password });
      setShowAddUser(false);
      setUserForm(EMPTY_USER);
      await selectClient(selectedClient, { keepTab: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Portal user could not be created");
    } finally {
      setAddingUser(false);
    }
  };

  const updatePortalUser = async () => {
    if (!showEditUser) return;
    try {
      await axios.put(`${API}/client-portal/users/${selectedClient}/${showEditUser.id}`, editUserForm, { headers });
      setShowEditUser(null);
      await selectClient(selectedClient, { keepTab: true });
      toast.success("Portal access updated");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Portal user could not be updated");
    }
  };

  const deletePortalUser = async (userId) => {
    try {
      await axios.delete(`${API}/client-portal/users/${selectedClient}/${userId}`, { headers });
      setPortalUsers((current) => current.filter((user) => user.id !== userId));
      setConfirmAction(null);
      toast.success("Portal user removed");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Portal user could not be removed");
    }
  };

  const resetPassword = async (userId) => {
    try {
      const response = await axios.post(
        `${API}/client-portal/users/${selectedClient}/${userId}/reset-password`,
        { portal_url: `${window.location.origin}/portal-login` },
        { headers },
      );
      setShowTempPassword({ email: response.data.email, password: response.data.temp_password });
      toast.success(response.data.email_status === "sent" ? "Password reset email sent" : "Temporary password generated");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Password could not be reset");
    }
  };

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
        Loading client portal operations…
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-zinc-950 text-zinc-100" data-testid="client-portal-page">
      <div className="space-y-5 px-6 py-6">
        <OperationalPageHeader
          eyebrow="Client experience"
          title="Client Portal"
          description="Control each client’s branded workspace, access permissions, invitations and secure preview links from one auditable console."
          icon={Globe}
          tone="emerald"
          actions={(
            <>
              <Button variant="outline" size="sm" onClick={() => navigate("/clients")} data-testid="back-to-clients-btn">
                <Building2 className="mr-1.5 h-4 w-4" />Clients
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.open("/portal-login", "_blank", "noopener,noreferrer")} data-testid="open-portal-login-btn">
                <ExternalLink className="mr-1.5 h-4 w-4" />Customer sign-in
              </Button>
              <Button variant="outline" size="sm" onClick={() => loadWorkspace({ quiet: true })} disabled={refreshing} data-testid="refresh-portal-btn">
                <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh
              </Button>
            </>
          )}
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroTile label="Client Accounts" value={clients.length} icon={Building2} glow="cyan" subtitle="available for portal access" />
          <HeroTile label="Active Portals" value={activePortals} icon={CheckCircle2} glow="emerald" subtitle="enabled client experiences" />
          <HeroTile label="Secure Links" value={secureLinks} icon={Link2} glow="violet" subtitle="issued access links" />
          <HeroTile label="Coverage" value={coverage} suffix="%" icon={ShieldCheck} glow={coverage >= 80 ? "emerald" : "amber"} subtitle="clients with a live portal" />
        </div>

        <div className="grid min-h-[620px] gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80 shadow-xl">
            <div className="border-b border-white/10 bg-gradient-to-br from-emerald-500/10 via-zinc-950 to-zinc-950 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Client directory</p>
                  <h2 className="mt-1 text-base font-semibold">Choose an account</h2>
                </div>
                <Badge variant="outline" className="border-white/10 bg-black/20 text-zinc-300">{filteredClients.length}</Badge>
              </div>
              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <Input
                  value={clientSearch}
                  onChange={(event) => setClientSearch(event.target.value)}
                  placeholder="Search clients…"
                  className="border-white/10 bg-black/30 pl-9"
                  data-testid="portal-client-search"
                />
              </div>
              <div className="mt-3 grid grid-cols-3 rounded-lg border border-white/10 bg-black/20 p-1">
                {[
                  { key: "all", label: "All" },
                  { key: "active", label: "Live" },
                  { key: "setup", label: "Setup" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setClientFilter(item.key)}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${clientFilter === item.key ? "bg-emerald-400/15 text-emerald-300" : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[645px] space-y-1 overflow-y-auto p-2 [scrollbar-color:#3f3f46_transparent]">
              {filteredClients.map((client) => {
                const portalConfig = configByClient.get(client.id);
                const selected = selectedClient === client.id;
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => selectClient(client.id)}
                    className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                      selected
                        ? "border-emerald-400/30 bg-emerald-400/10 shadow-[0_0_28px_rgba(16,185,129,0.08)]"
                        : "border-transparent hover:border-white/10 hover:bg-white/[0.035]"
                    }`}
                    data-testid={`portal-client-${client.id}`}
                  >
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-bold ${
                      selected ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/5 text-zinc-400"
                    }`}>
                      {initials(client.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-200">{client.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">{client.email || "No primary contact email"}</p>
                    </div>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${portalConfig?.enabled ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.75)]" : "bg-zinc-700"}`} />
                  </button>
                );
              })}
              {!filteredClients.length && (
                <div className="px-4 py-12 text-center">
                  <Search className="mx-auto h-8 w-8 text-zinc-700" />
                  <p className="mt-3 text-sm text-zinc-400">No clients match this view</p>
                  <button type="button" onClick={() => { setClientSearch(""); setClientFilter("all"); }} className="mt-2 text-xs text-emerald-300 hover:text-emerald-200">
                    Clear filters
                  </button>
                </div>
              )}
            </div>
          </aside>

          <main className="min-w-0">
            {config && selectedClientRecord ? (
              <div className="space-y-4">
                <section className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80 shadow-xl">
                  <div className="relative border-b border-white/10 bg-gradient-to-r from-emerald-500/10 via-cyan-500/[0.06] to-transparent px-5 py-5">
                    <div className="absolute right-6 top-3 h-24 w-24 rounded-full bg-emerald-400/10 blur-3xl" />
                    <div className="relative flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-lg font-bold text-emerald-200">
                          {initials(config.client_name || selectedClientRecord.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="truncate text-xl font-semibold">{config.client_name || selectedClientRecord.name}</h2>
                            <Badge className={config.enabled ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border border-amber-400/25 bg-amber-400/10 text-amber-300"}>
                              {config.enabled ? "Portal live" : "Setup required"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-zinc-400">
                            {activeUsers} active user{activeUsers === 1 ? "" : "s"} · {config.access_tokens?.length || 0} secure link{(config.access_tokens?.length || 0) === 1 ? "" : "s"} · {enabledFeatures}/{FEATURE_OPTIONS.length} services enabled
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="mr-1 flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                          <Label htmlFor="portal-live-toggle" className="text-xs text-zinc-300">Portal live</Label>
                          <Switch id="portal-live-toggle" checked={!!config.enabled} onCheckedChange={(value) => updateConfig("enabled", value)} data-testid="portal-enabled-toggle" />
                        </div>
                        <Button variant="outline" size="sm" onClick={openPortalPreview} data-testid="preview-client-portal-btn">
                          <Eye className="mr-1.5 h-4 w-4" />Preview
                        </Button>
                        <Button size="sm" onClick={saveConfig} disabled={saving} className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400" data-testid="save-portal-config-btn">
                          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                          Save changes
                        </Button>
                      </div>
                    </div>
                  </div>

                  <Tabs value={workspaceTab} onValueChange={setWorkspaceTab}>
                    <div className="border-b border-white/10 px-4 pt-3">
                      <TabsList className="grid h-auto w-full grid-cols-4 gap-1 bg-transparent p-0">
                        <TabsTrigger value="experience" className="min-w-0 justify-center rounded-b-none border-b-2 border-transparent px-2 py-3 text-xs data-[state=active]:border-emerald-400 data-[state=active]:bg-emerald-400/[0.06] data-[state=active]:text-emerald-300">
                          <Palette className="mr-1.5 h-4 w-4 shrink-0" />Experience
                        </TabsTrigger>
                        <TabsTrigger value="users" className="min-w-0 justify-center rounded-b-none border-b-2 border-transparent px-2 py-3 text-xs data-[state=active]:border-emerald-400 data-[state=active]:bg-emerald-400/[0.06] data-[state=active]:text-emerald-300">
                          <Users className="mr-1.5 h-4 w-4 shrink-0" />Users <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{portalUsers.length}</Badge>
                        </TabsTrigger>
                        <TabsTrigger value="links" className="min-w-0 justify-center rounded-b-none border-b-2 border-transparent px-2 py-3 text-xs data-[state=active]:border-emerald-400 data-[state=active]:bg-emerald-400/[0.06] data-[state=active]:text-emerald-300">
                          <Link2 className="mr-1.5 h-4 w-4 shrink-0" />Links <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{config.access_tokens?.length || 0}</Badge>
                        </TabsTrigger>
                        <TabsTrigger value="activity" className="min-w-0 justify-center rounded-b-none border-b-2 border-transparent px-2 py-3 text-xs data-[state=active]:border-emerald-400 data-[state=active]:bg-emerald-400/[0.06] data-[state=active]:text-emerald-300">
                          <Activity className="mr-1.5 h-4 w-4 shrink-0" />Activity <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{accessLogs.length}</Badge>
                        </TabsTrigger>
                      </TabsList>
                    </div>

                    <TabsContent value="experience" className="m-0 p-5">
                      <div className="grid gap-5 2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                        <Card className="border-white/10 bg-black/20">
                          <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base"><Palette className="h-4 w-4 text-cyan-300" />Client-facing identity</CardTitle>
                            <p className="text-xs text-zinc-500">The portal inherits Nexus styling while retaining the client’s account identity.</p>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="portal-company-name">Portal display name</Label>
                              <Input
                                id="portal-company-name"
                                value={config.branding?.company_name || ""}
                                onChange={(event) => updateConfig("branding.company_name", event.target.value)}
                                placeholder={selectedClientRecord.name}
                                className="border-white/10 bg-zinc-950/60"
                              />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-[1fr_88px]">
                              <div className="space-y-1.5">
                                <Label htmlFor="portal-logo-url">Logo URL</Label>
                                <Input
                                  id="portal-logo-url"
                                  value={config.branding?.logo_url || ""}
                                  onChange={(event) => updateConfig("branding.logo_url", event.target.value)}
                                  placeholder="Use client account logo"
                                  className="border-white/10 bg-zinc-950/60"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="portal-primary-colour">Accent</Label>
                                <Input
                                  id="portal-primary-colour"
                                  type="color"
                                  value={config.branding?.primary_color || "#10b981"}
                                  onChange={(event) => updateConfig("branding.primary_color", event.target.value)}
                                  className="h-10 cursor-pointer border-white/10 bg-zinc-950/60 p-1"
                                />
                              </div>
                            </div>
                            <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.05] p-3">
                              <div className="flex gap-2">
                                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                                <p className="text-xs leading-5 text-zinc-400">MSP branding, document templates and service contact details continue to come from Settings. This layer controls only the selected client’s portal identity.</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        <Card className="border-white/10 bg-black/20">
                          <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4 text-emerald-300" />Portal capabilities</CardTitle>
                            <p className="text-xs text-zinc-500">Choose what authorised client users can see and do.</p>
                          </CardHeader>
                          <CardContent>
                            <div className="grid gap-2 md:grid-cols-2">
                              {FEATURE_OPTIONS.map((feature) => (
                                <div key={feature.key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-zinc-950/50 p-3" data-testid={`feature-${feature.key}`}>
                                  <div className="flex min-w-0 items-center gap-3">
                                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.features?.[feature.key] ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-zinc-600"}`}>
                                      <feature.icon className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-zinc-200">{feature.label}</p>
                                      <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{feature.desc}</p>
                                    </div>
                                  </div>
                                  <Switch checked={!!config.features?.[feature.key]} onCheckedChange={(value) => updateConfig(`features.${feature.key}`, value)} />
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </TabsContent>

                    <TabsContent value="users" className="m-0 p-5">
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="flex items-center gap-2 text-base font-semibold"><Users className="h-4 w-4 text-emerald-300" />Portal access directory</h3>
                          <p className="mt-1 text-xs text-zinc-500">Invite client contacts, assign least-privilege access and retain a clear login record.</p>
                        </div>
                        <Button size="sm" onClick={() => setShowAddUser(true)} className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400" data-testid="add-portal-user-btn">
                          <UserPlus className="mr-1.5 h-4 w-4" />Invite user
                        </Button>
                      </div>

                      {showTempPassword && (
                        <div className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4" data-testid="temp-password-box">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-medium text-amber-200">Temporary sign-in for {showTempPassword.email}</p>
                              <p className="mt-1 text-xs text-zinc-500">Copy it securely. The client should change it after signing in.</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <code className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-amber-100">{showTempPassword.password}</code>
                              <Button variant="outline" size="icon" onClick={() => copyToClipboard(showTempPassword.password, "Temporary password copied")}><Copy className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => setShowTempPassword(null)}><XCircle className="h-4 w-4" /></Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {portalUsers.length ? (
                        <div className="overflow-hidden rounded-xl border border-white/10">
                          <Table>
                            <TableHeader className="bg-white/[0.025]">
                              <TableRow className="border-white/10 hover:bg-transparent">
                                <TableHead>User</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Access</TableHead>
                                <TableHead>Last sign-in</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Controls</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {portalUsers.map((user) => (
                                <TableRow key={user.id} className="border-white/10" data-testid={`portal-user-${user.id}`}>
                                  <TableCell>
                                    <div className="flex items-center gap-3">
                                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[11px] font-bold text-zinc-300">{initials(user.name || user.email)}</div>
                                      <div>
                                        <p className="text-sm font-medium text-zinc-200">{user.name || "Client user"}</p>
                                        <p className="text-xs text-zinc-500">{user.email}</p>
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex flex-col items-start gap-1">
                                      <Badge variant="outline" className="capitalize">{user.role || "user"}</Badge>
                                      <span className={`text-[9px] font-medium uppercase tracking-wide ${user.totp_enabled ? "text-emerald-300" : "text-amber-300"}`}>
                                        {user.totp_enabled ? "MFA protected" : "MFA not enabled"}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex max-w-[250px] flex-wrap gap-1">
                                      {user.can_create_tickets && <Badge variant="secondary" className="text-[9px]">Tickets</Badge>}
                                      {user.can_view_assets && <Badge variant="secondary" className="text-[9px]">Assets</Badge>}
                                      {user.can_view_invoices && <Badge variant="secondary" className="text-[9px]">Billing</Badge>}
                                      {user.can_remote_devices && <Badge className="border border-cyan-400/20 bg-cyan-400/10 text-[9px] text-cyan-300">Remote</Badge>}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-xs text-zinc-500">{dateLabel(user.last_login)}</TableCell>
                                  <TableCell>
                                    <Badge className={user.is_active !== false ? "border border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border border-rose-400/20 bg-rose-400/10 text-rose-300"}>
                                      {user.is_active !== false ? "Active" : "Disabled"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        title="Edit access"
                                        onClick={() => {
                                          setShowEditUser(user);
                                          setEditUserForm({
                                            name: user.name,
                                            role: user.role,
                                            can_view_all_tickets: user.can_view_all_tickets,
                                            can_create_tickets: user.can_create_tickets,
                                            can_view_assets: user.can_view_assets,
                                            can_view_invoices: user.can_view_invoices,
                                            can_remote_devices: user.can_remote_devices,
                                            is_active: user.is_active !== false,
                                          });
                                        }}
                                      >
                                        <Settings2 className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-300" title="Reset password" onClick={() => resetPassword(user.id)}>
                                        <RotateCw className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-rose-300 hover:text-rose-200"
                                        title="Remove user"
                                        onClick={() => setConfirmAction({ type: "user", id: user.id, label: user.name || user.email })}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-5 py-14 text-center">
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300"><Users className="h-5 w-5" /></div>
                          <h4 className="mt-4 text-sm font-semibold">No client users yet</h4>
                          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-zinc-500">Invite the client’s authorised contacts and grant only the services they need.</p>
                          <Button size="sm" className="mt-4 bg-emerald-500 text-zinc-950 hover:bg-emerald-400" onClick={() => setShowAddUser(true)}>
                            <UserPlus className="mr-1.5 h-4 w-4" />Invite first user
                          </Button>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="links" className="m-0 p-5">
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="flex items-center gap-2 text-base font-semibold"><LockKeyhole className="h-4 w-4 text-violet-300" />Secure preview & contact links</h3>
                          <p className="mt-1 text-xs text-zinc-500">Use expiring links for preview, onboarding or contacts who do not need a permanent login.</p>
                        </div>
                        <Button size="sm" onClick={() => { setTokenForm({ contact_name: "", contact_email: "", expiry_days: 90 }); setShowGenToken(true); }} className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400" data-testid="generate-token-btn">
                          <Plus className="mr-1.5 h-4 w-4" />Generate secure link
                        </Button>
                      </div>

                      {newTokenUrl && (
                        <div className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4" data-testid="new-portal-url">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <p className="flex items-center gap-2 text-sm font-medium text-emerald-200"><Check className="h-4 w-4" />New secure link is ready</p>
                              <p className="mt-1 max-w-2xl truncate text-xs text-zinc-500">{window.location.origin}{newTokenUrl}</p>
                            </div>
                            <div className="flex gap-2">
                              <Button variant="outline" size="sm" onClick={() => copyToClipboard(`${window.location.origin}${newTokenUrl}`, "Secure portal link copied")}><Copy className="mr-1.5 h-4 w-4" />Copy</Button>
                              <Button variant="outline" size="sm" onClick={() => window.open(newTokenUrl, "_blank", "noopener,noreferrer")}><ArrowUpRight className="mr-1.5 h-4 w-4" />Preview</Button>
                              <Button variant="ghost" size="sm" onClick={() => setNewTokenUrl(null)}>Dismiss</Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {(config.access_tokens || []).length ? (
                        <div className="grid gap-3 lg:grid-cols-2">
                          {config.access_tokens.map((accessToken) => (
                            <div key={accessToken.id} className="rounded-xl border border-white/10 bg-black/20 p-4" data-testid={`token-${accessToken.id}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 items-start gap-3">
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-400/10 text-violet-300"><KeyRound className="h-4 w-4" /></div>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-zinc-200">{accessToken.contact_name || "Portal preview"}</p>
                                    <p className="truncate text-xs text-zinc-500">{accessToken.contact_email || "No email assigned"}</p>
                                  </div>
                                </div>
                                <Badge className="border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">Active</Badge>
                              </div>
                              <div className="mt-4 grid grid-cols-3 gap-2 text-[10px]">
                                <div><p className="uppercase tracking-wide text-zinc-600">Created</p><p className="mt-1 text-zinc-400">{dateLabel(accessToken.created_at)}</p></div>
                                <div><p className="uppercase tracking-wide text-zinc-600">Expires</p><p className="mt-1 text-zinc-400">{dateLabel(accessToken.expires_at)}</p></div>
                                <div><p className="uppercase tracking-wide text-zinc-600">Last used</p><p className="mt-1 text-zinc-400">{dateLabel(accessToken.last_used)}</p></div>
                              </div>
                              <div className="mt-4 flex gap-2 border-t border-white/10 pt-3">
                                <Button variant="outline" size="sm" className="flex-1" onClick={() => window.open(`/portal/${accessToken.token}`, "_blank", "noopener,noreferrer")}><Eye className="mr-1.5 h-4 w-4" />Open</Button>
                                <Button variant="outline" size="sm" className="flex-1" onClick={() => copyToClipboard(`${window.location.origin}/portal/${accessToken.token}`, "Secure link copied")}><Copy className="mr-1.5 h-4 w-4" />Copy</Button>
                                <Button variant="ghost" size="icon" className="text-rose-300" onClick={() => setConfirmAction({ type: "token", id: accessToken.id, label: accessToken.contact_name || "this secure link" })}><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-5 py-14 text-center">
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-400/10 text-violet-300"><Link2 className="h-5 w-5" /></div>
                          <h4 className="mt-4 text-sm font-semibold">No secure links issued</h4>
                          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-zinc-500">Create an expiring link to preview this client’s portal or provide limited contact access.</p>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="activity" className="m-0 p-5">
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                          <div>
                            <h3 className="flex items-center gap-2 text-base font-semibold"><Activity className="h-4 w-4 text-emerald-300" />Portal security timeline</h3>
                            <p className="mt-1 text-xs text-zinc-500">Persisted authentication, link, MFA and technician administration evidence for this client.</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate(`/audit-trail?search=${encodeURIComponent(selectedClientRecord.name)}`)}
                          >
                            <ExternalLink className="mr-1.5 h-4 w-4" />Full audit trail
                          </Button>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Recorded events</p>
                            <div className="mt-2 flex items-end justify-between">
                              <p className="text-2xl font-semibold text-zinc-100">{accessLogs.length}</p>
                              <Activity className="h-4 w-4 text-cyan-300" />
                            </div>
                          </div>
                          <div className={`rounded-xl border p-4 ${failedAccess ? "border-rose-400/20 bg-rose-400/[0.05]" : "border-emerald-400/20 bg-emerald-400/[0.05]"}`}>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Denied / failed</p>
                            <div className="mt-2 flex items-end justify-between">
                              <p className={`text-2xl font-semibold ${failedAccess ? "text-rose-300" : "text-emerald-300"}`}>{failedAccess}</p>
                              {failedAccess ? <AlertTriangle className="h-4 w-4 text-rose-300" /> : <ShieldCheck className="h-4 w-4 text-emerald-300" />}
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Last activity</p>
                            <p className="mt-2 truncate text-sm font-medium text-zinc-200">{dateTimeLabel(accessLogs[0]?.timestamp)}</p>
                            <p className="mt-1 text-[10px] text-zinc-600">Retained in Nexus audit evidence</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
                          {[
                            { id: "all", label: "All events" },
                            { id: "failures", label: "Denied & failed" },
                            { id: "security", label: "Authentication" },
                            { id: "administration", label: "Administration" },
                          ].map((filter) => (
                            <button
                              key={filter.id}
                              type="button"
                              onClick={() => setActivityFilter(filter.id)}
                              className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                                activityFilter === filter.id
                                  ? "bg-emerald-400/12 text-emerald-300"
                                  : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                              }`}
                            >
                              {filter.label}
                            </button>
                          ))}
                        </div>

                        {filteredAccessLogs.length ? (
                          <div className="overflow-hidden rounded-xl border border-white/10">
                            {filteredAccessLogs.map((event, index) => {
                              const presentation = eventPresentation(event);
                              const EventIcon = presentation.icon;
                              const tones = {
                                emerald: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
                                cyan: "border-cyan-400/20 bg-cyan-400/10 text-cyan-300",
                                violet: "border-violet-400/20 bg-violet-400/10 text-violet-300",
                                amber: "border-amber-400/20 bg-amber-400/10 text-amber-300",
                                rose: "border-rose-400/20 bg-rose-400/10 text-rose-300",
                                zinc: "border-white/10 bg-white/5 text-zinc-400",
                              };
                              return (
                                <div
                                  key={event.id || `${event.action}-${index}`}
                                  className="grid gap-3 border-b border-white/10 p-4 last:border-b-0 lg:grid-cols-[auto_minmax(0,1fr)_auto]"
                                  data-testid={`portal-activity-${event.id || index}`}
                                >
                                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${tones[presentation.tone] || tones.zinc}`}>
                                    <EventIcon className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-sm font-medium capitalize text-zinc-200">{presentation.label}</p>
                                      <Badge className={event.outcome === "success"
                                        ? "border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                                        : event.outcome === "warning"
                                          ? "border border-amber-400/20 bg-amber-400/10 text-amber-300"
                                          : "border border-rose-400/20 bg-rose-400/10 text-rose-300"}>
                                        {event.outcome || "recorded"}
                                      </Badge>
                                    </div>
                                    <p className="mt-1 text-xs leading-5 text-zinc-400">{event.details || "Portal activity recorded"}</p>
                                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-600">
                                      <span>Actor: {event.actor_name || event.user_name || "System"}</span>
                                      {event.user_email && <span>User: {event.user_email}</span>}
                                      {event.ip_address && <span>IP: {event.ip_address}</span>}
                                    </div>
                                  </div>
                                  <div className="text-left lg:text-right">
                                    <p className="text-xs text-zinc-400">{dateTimeLabel(event.timestamp)}</p>
                                    <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-600">{event.actor_type?.replaceAll("_", " ") || "system"}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-5 py-14 text-center">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300"><Clock3 className="h-5 w-5" /></div>
                            <h4 className="mt-4 text-sm font-semibold">{accessLogs.length ? "No events match this filter" : "No portal activity recorded yet"}</h4>
                            <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-zinc-500">
                              {accessLogs.length
                                ? "Choose another activity filter to review the retained evidence."
                                : "New sign-ins, failed attempts, secure-link use, MFA changes and technician access updates will appear here automatically."}
                            </p>
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </section>
              </div>
            ) : (
              <div className="flex min-h-[620px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/10 p-8 text-center">
                <div>
                  <Globe className="mx-auto h-12 w-12 text-zinc-700" />
                  <h2 className="mt-4 text-lg font-semibold">Choose a client account</h2>
                  <p className="mt-2 max-w-md text-sm text-zinc-500">Select a client from the directory to configure their portal experience and authorised users.</p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      <Dialog open={showGenToken} onOpenChange={setShowGenToken}>
        <DialogContent className="max-w-2xl overflow-hidden border-white/10 bg-zinc-950 p-0 shadow-2xl" aria-describedby="gen-token-desc">
          <WorkflowDialogHeader
            icon={Link2}
            eyebrow="Secure portal access"
            title="Generate client link"
            description="Create an expiring, auditable access link for a named contact or a controlled portal preview."
          />
          <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="token-contact-name">Contact name</Label>
              <Input id="token-contact-name" value={tokenForm.contact_name} onChange={(event) => setTokenForm({ ...tokenForm, contact_name: event.target.value })} placeholder="e.g. Jordan Smith" className="border-white/10 bg-black/20" data-testid="token-contact-name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token-contact-email">Contact email</Label>
              <Input id="token-contact-email" type="email" value={tokenForm.contact_email} onChange={(event) => setTokenForm({ ...tokenForm, contact_email: event.target.value })} placeholder="jordan@client.com" className="border-white/10 bg-black/20" data-testid="token-contact-email" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Link expiry</Label>
              <Select value={String(tokenForm.expiry_days)} onValueChange={(value) => setTokenForm({ ...tokenForm, expiry_days: Number(value) })}>
                <SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days — short review</SelectItem>
                  <SelectItem value="30">30 days — onboarding</SelectItem>
                  <SelectItem value="90">90 days — standard</SelectItem>
                  <SelectItem value="180">180 days — extended</SelectItem>
                  <SelectItem value="365">1 year — long-term</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 rounded-xl border border-violet-400/15 bg-violet-400/[0.05] p-3 text-xs leading-5 text-zinc-400">
              This link grants access only to the selected client’s portal and can be revoked at any time from its audit card.
            </div>
          </div>
          <DialogFooter className="border-t border-white/10 bg-black/20 px-6 py-4">
            <Button variant="ghost" onClick={() => setShowGenToken(false)}>Cancel</Button>
            <Button onClick={generateToken} className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400" data-testid="confirm-generate-token"><Link2 className="mr-1.5 h-4 w-4" />Generate secure link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent className="max-w-3xl overflow-hidden border-white/10 bg-zinc-950 p-0 shadow-2xl" aria-describedby="add-user-desc">
          <WorkflowDialogHeader
            icon={UserPlus}
            eyebrow="Client access workflow"
            title="Invite portal user"
            description="Create a named client account, apply least-privilege permissions and optionally deliver a branded welcome email."
          />
          <div className="space-y-5 px-6 py-5">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-user-name">Full name</Label>
                <Input id="new-user-name" value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} placeholder="Jordan Smith" className="border-white/10 bg-black/20" data-testid="new-user-name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-user-email">Email address</Label>
                <Input id="new-user-email" type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} placeholder="jordan@client.com" className="border-white/10 bg-black/20" data-testid="new-user-email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-user-password">Temporary password</Label>
                <Input id="new-user-password" type="text" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} placeholder="Automatically generated" className="border-white/10 bg-black/20" data-testid="new-user-password" />
              </div>
              <div className="space-y-1.5">
                <Label>Access role</Label>
                <Select value={userForm.role} onValueChange={(value) => setUserForm({ ...userForm, role: value })}>
                  <SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Client admin — full account access</SelectItem>
                    <SelectItem value="user">Client user — assigned access</SelectItem>
                    <SelectItem value="viewer">Viewer — read only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Separator className="bg-white/10" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Permission profile</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {USER_PERMISSIONS.map((permission) => (
                  <div key={permission.key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-200">{permission.label}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">{permission.desc}</p>
                    </div>
                    <Switch checked={!!userForm[permission.key]} onCheckedChange={(value) => setUserForm({ ...userForm, [permission.key]: value })} />
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-emerald-300" />
                    <div>
                      <p className="text-sm font-medium text-zinc-200">Send welcome email</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">Deliver the portal URL and temporary sign-in details</p>
                    </div>
                  </div>
                  <Switch checked={userForm.send_welcome_email} onCheckedChange={(value) => setUserForm({ ...userForm, send_welcome_email: value })} data-testid="send-welcome-email-toggle" />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="border-t border-white/10 bg-black/20 px-6 py-4">
            <Button variant="ghost" onClick={() => setShowAddUser(false)}>Cancel</Button>
            <Button onClick={addPortalUser} disabled={addingUser} className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400" data-testid="confirm-add-user">
              {addingUser ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mail className="mr-1.5 h-4 w-4" />}
              Create & invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showEditUser} onOpenChange={(open) => !open && setShowEditUser(null)}>
        <DialogContent className="max-w-3xl overflow-hidden border-white/10 bg-zinc-950 p-0 shadow-2xl" aria-describedby="edit-user-desc">
          <WorkflowDialogHeader
            icon={Settings2}
            eyebrow="Access governance"
            title={`Edit ${showEditUser?.name || showEditUser?.email || "portal user"}`}
            description="Review the account role, access state and individual permissions. Changes are applied to future portal sessions."
          />
          <div className="space-y-5 px-6 py-5">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-user-name">Full name</Label>
                <Input id="edit-user-name" value={editUserForm.name || ""} onChange={(event) => setEditUserForm({ ...editUserForm, name: event.target.value })} className="border-white/10 bg-black/20" />
              </div>
              <div className="space-y-1.5">
                <Label>Access role</Label>
                <Select value={editUserForm.role || "user"} onValueChange={(value) => setEditUserForm({ ...editUserForm, role: value })}>
                  <SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Client admin</SelectItem>
                    <SelectItem value="user">Client user</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-user-password">New temporary password</Label>
                <Input id="edit-user-password" type="text" value={editUserForm.password || ""} onChange={(event) => setEditUserForm({ ...editUserForm, password: event.target.value })} placeholder="Leave blank to keep current password" className="border-white/10 bg-black/20" />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Account active</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">Disable access without deleting history</p>
                </div>
                <Switch checked={editUserForm.is_active !== false} onCheckedChange={(value) => setEditUserForm({ ...editUserForm, is_active: value })} />
              </div>
            </div>
            <Separator className="bg-white/10" />
            <div className="grid gap-2 md:grid-cols-2">
              {USER_PERMISSIONS.map((permission) => (
                <div key={permission.key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{permission.label}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">{permission.desc}</p>
                  </div>
                  <Switch checked={!!editUserForm[permission.key]} onCheckedChange={(value) => setEditUserForm({ ...editUserForm, [permission.key]: value })} />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="border-t border-white/10 bg-black/20 px-6 py-4">
            <Button variant="ghost" onClick={() => setShowEditUser(null)}>Cancel</Button>
            <Button onClick={updatePortalUser} className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400" data-testid="confirm-edit-user"><CheckCircle2 className="mr-1.5 h-4 w-4" />Save access</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent className="max-w-md border-white/10 bg-zinc-950">
          <DialogHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300"><Trash2 className="h-5 w-5" /></div>
            <DialogTitle>{confirmAction?.type === "user" ? "Remove portal user?" : "Revoke secure link?"}</DialogTitle>
            <DialogDescription>
              {confirmAction?.type === "user"
                ? `${confirmAction?.label} will no longer be able to sign in. Historical activity remains available for audit.`
                : `${confirmAction?.label} will stop working immediately. This action does not affect permanent portal users.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmAction?.type === "user" ? deletePortalUser(confirmAction.id) : revokeToken(confirmAction.id)}>
              <Trash2 className="mr-1.5 h-4 w-4" />{confirmAction?.type === "user" ? "Remove user" : "Revoke link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
