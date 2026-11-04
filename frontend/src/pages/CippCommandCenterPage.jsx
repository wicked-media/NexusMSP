import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  CheckCircle2, Cloud, KeyRound, RefreshCw, Loader2, ExternalLink,
  UserPlus, Lock, Unlock, UserX, Link as LinkIcon, Search, Shield, Workflow,
  Send, TrendingUp, AlertTriangle, History,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";

export default function CippCommandCenterPage({ embedded = false }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

  const [summary, setSummary] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [assurance, setAssurance] = useState(null);
  const [standards, setStandards] = useState(null);
  const [billingAssurance, setBillingAssurance] = useState(null);
  const [lifecycleReadiness, setLifecycleReadiness] = useState(null);
  const [accessGovernance, setAccessGovernance] = useState(null);
  const [changeIntelligence, setChangeIntelligence] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [sourceErrors, setSourceErrors] = useState([]);
  const [loadingBillingAssurance, setLoadingBillingAssurance] = useState(false);
  const [loadingLifecycleReadiness, setLoadingLifecycleReadiness] = useState(false);
  const [loadingAccessGovernance, setLoadingAccessGovernance] = useState(false);
  const [loadingChangeIntelligence, setLoadingChangeIntelligence] = useState(false);
  const [activeTab, setActiveTab] = useState("tenants");

  const [tenants, setTenants] = useState([]);
  const [linkedClients, setLinkedClients] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [users, setUsers] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [createDialog, setCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({ displayName: "", userPrincipalName: "", password: "", firstName: "", lastName: "", usageLocation: "AU", licenses: [], mustChangePassword: true });
  const [busy, setBusy] = useState(false);

  const [licenseDialog, setLicenseDialog] = useState(null);
  const [licAdd, setLicAdd] = useState([]);
  const [licRemove, setLicRemove] = useState([]);

  const [offboardDialog, setOffboardDialog] = useState(null);
  const [offboardOpts, setOffboardOpts] = useState({ convertToShared: true, removeLicenses: true, resetPassword: true, revokeSessions: true, disableUser: true, removeGroups: true, hideFromGAL: true, outOfOffice: "", forwardTo: "" });
  const [verifyActionDialog, setVerifyActionDialog] = useState(null);
  const [verifySigninDialog, setVerifySigninDialog] = useState(null);
  const [verificationRequestId, setVerificationRequestId] = useState("");
  const [verifiedPassword, setVerifiedPassword] = useState("");

  const [linkDialog, setLinkDialog] = useState(null);
  const [linkClientId, setLinkClientId] = useState("");
  const [linkReason, setLinkReason] = useState("");
  const [allClients, setAllClients] = useState([]);
  const [billingMapDialog, setBillingMapDialog] = useState(null);
  const [billingInclusions, setBillingInclusions] = useState([]);
  const [billingMapLineId, setBillingMapLineId] = useState("");

  // Load summary
  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const readSource = async (source, request, fallback) => {
        try {
          const response = await request;
          return { source, data: response.data, error: null };
        } catch {
          return { source, data: fallback, error: `${source} could not be loaded` };
        }
      };
      const [sumRes, onboardingRes, linkedRes, clientsRes, assuranceRes, standardsRes] = await Promise.all([
        readSource("Microsoft operations provider", axios.get(`${API}/cipp/summary`, { headers }), null),
        readSource("Nexus tenant registry", axios.get(`${API}/m365/onboarding`, { headers }), null),
        readSource("Linked client evidence", axios.get(`${API}/cipp/linked-clients`, { headers }), []),
        readSource("Nexus client directory", axios.get(`${API}/clients`, { headers }), []),
        readSource("Assurance evidence", axios.get(`${API}/cipp/assurance`, { headers }), null),
        readSource("Standards evidence", axios.get(`${API}/cipp/standards`, { headers }), null),
      ]);
      setSummary(sumRes.data);
      setOnboarding(onboardingRes.data);
      setLinkedClients(linkedRes.data || []);
      setAllClients(onboardingRes.data?.clients || clientsRes.data || []);
      setAssurance(assuranceRes.data);
      setStandards(standardsRes.data);
      setSourceErrors([sumRes, onboardingRes, linkedRes, clientsRes, assuranceRes, standardsRes]
        .filter((result) => result.error)
        .map((result) => result.source));

      const registryByTenant = new Map(
        (onboardingRes.data?.tenants || []).map((tenant) => [String(tenant.tenant_id), tenant]),
      );
      const merged = new Map();
      for (const tenant of (sumRes.data?.tenants || [])) {
        const registry = registryByTenant.get(String(tenant.customerId)) || {};
        merged.set(String(tenant.customerId), {
          ...tenant,
          connectionId: registry.id,
          source: registry.source || "operational_provider",
          clientId: registry.client_id,
          clientName: registry.client_name,
          mapped: Boolean(registry.mapped || registry.client_id),
          accessStatus: "connected",
          graphVerified: true,
          providerOperational: true,
        });
      }
      for (const tenant of (onboardingRes.data?.tenants || [])) {
        const key = String(tenant.tenant_id);
        if (merged.has(key)) continue;
        merged.set(key, {
          customerId: tenant.tenant_id,
          displayName: tenant.tenant_name || tenant.tenant_id,
          defaultDomainName: tenant.default_domain || "",
          connectionId: tenant.id,
          source: tenant.source,
          clientId: tenant.client_id,
          clientName: tenant.client_name,
          mapped: Boolean(tenant.mapped),
          accessStatus: tenant.access_status,
          graphVerified: Boolean(tenant.graph_verified),
          providerOperational: false,
        });
      }
      setTenants(Array.from(merged.values()).sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || ""))));
    } finally { setLoadingSummary(false); }
  }, [token]); // eslint-disable-line

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const loadBillingAssurance = useCallback(async () => {
    setLoadingBillingAssurance(true);
    try {
      const response = await axios.get(`${API}/cipp/billing-assurance`, { headers });
      setBillingAssurance(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load Microsoft 365 billing assurance");
    } finally {
      setLoadingBillingAssurance(false);
    }
  }, [token]); // eslint-disable-line

  const loadLifecycleReadiness = useCallback(async () => {
    setLoadingLifecycleReadiness(true);
    try {
      const response = await axios.get(`${API}/m365/lifecycle/readiness`, { headers });
      setLifecycleReadiness(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load employee lifecycle readiness");
    } finally {
      setLoadingLifecycleReadiness(false);
    }
  }, [token]); // eslint-disable-line

  const loadAccessGovernance = useCallback(async () => {
    setLoadingAccessGovernance(true);
    try {
      const response = await axios.get(`${API}/m365/access-governance/readiness`, { headers });
      setAccessGovernance(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load Microsoft access-governance evidence");
    } finally {
      setLoadingAccessGovernance(false);
    }
  }, [token]); // eslint-disable-line

  const loadChangeIntelligence = useCallback(async () => {
    setLoadingChangeIntelligence(true);
    try {
      const response = await axios.get(`${API}/m365/change-intelligence/readiness`, { headers });
      setChangeIntelligence(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load Microsoft change evidence");
    } finally {
      setLoadingChangeIntelligence(false);
    }
  }, [token]); // eslint-disable-line

  useEffect(() => {
    if (activeTab === "billing" && !billingAssurance && !loadingBillingAssurance) loadBillingAssurance();
  }, [activeTab, billingAssurance, loadBillingAssurance, loadingBillingAssurance]);

  useEffect(() => {
    if (activeTab === "lifecycle" && !lifecycleReadiness && !loadingLifecycleReadiness) loadLifecycleReadiness();
  }, [activeTab, lifecycleReadiness, loadLifecycleReadiness, loadingLifecycleReadiness]);

  useEffect(() => {
    if (activeTab === "access" && !accessGovernance && !loadingAccessGovernance) loadAccessGovernance();
  }, [accessGovernance, activeTab, loadAccessGovernance, loadingAccessGovernance]);

  useEffect(() => {
    if (activeTab === "changes" && !changeIntelligence && !loadingChangeIntelligence) loadChangeIntelligence();
  }, [activeTab, changeIntelligence, loadChangeIntelligence, loadingChangeIntelligence]);

  // Load tenant users + licenses when selected
  useEffect(() => {
    if (!selectedTenant || !selectedTenant.providerOperational || !selectedTenant.mapped) { setUsers([]); setLicenses([]); return; }
    (async () => {
      setLoadingUsers(true);
      try {
        const [u, l] = await Promise.all([
          axios.get(`${API}/cipp/tenants/${selectedTenant.customerId}/users`, { headers }).catch(() => ({ data: [] })),
          axios.get(`${API}/cipp/tenants/${selectedTenant.customerId}/licenses`, { headers }).catch(() => ({ data: [] })),
        ]);
        setUsers(u.data || []);
        setLicenses(l.data || []);
      } finally { setLoadingUsers(false); }
    })();
  }, [selectedTenant, token]); // eslint-disable-line

  const filteredTenants = tenants.filter(t => !query || `${t.displayName} ${t.defaultDomainName}`.toLowerCase().includes(query.toLowerCase()));

  const nexusVerifyUrl = (action, user) => {
    const params = new URLSearchParams({
      client: selectedTenant?.clientId || "",
      action,
      subject_name: user?.displayName || "",
      subject_email: user?.userPrincipalName || "",
      entra_tenant_id: selectedTenant?.customerId || "",
      provider_user_id: user?.id || "",
      user_principal_name: user?.userPrincipalName || "",
    });
    return `/nexus-verify?${params.toString()}`;
  };

  const handleCreateUser = async () => {
    if (!selectedTenant) return;
    if (!createForm.displayName || !createForm.userPrincipalName || !createForm.password) {
      toast.error("Display name, UPN, and password are required"); return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${selectedTenant.customerId}/users`, createForm, { headers });
      toast.success(`User ${createForm.userPrincipalName} created`);
      setCreateDialog(false);
      setCreateForm({ displayName: "", userPrincipalName: "", password: "", firstName: "", lastName: "", usageLocation: "AU", licenses: [], mustChangePassword: true });
      // Reload users
      const u = await axios.get(`${API}/cipp/tenants/${selectedTenant.customerId}/users`, { headers });
      setUsers(u.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Create failed"); }
    finally { setBusy(false); }
  };

  const handleAssignLicense = async () => {
    if (!selectedTenant || !licenseDialog) return;
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${selectedTenant.customerId}/users/${licenseDialog.id}/assign-license`,
        { addLicenses: licAdd, removeLicenses: licRemove }, { headers });
      toast.success("License changes applied");
      setLicenseDialog(null); setLicAdd([]); setLicRemove([]);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const openVerifiedReset = (user) => {
    setVerificationRequestId("");
    setVerifiedPassword("");
    setVerifyActionDialog(user);
  };

  const handleVerifiedReset = async () => {
    if (!selectedTenant || !verifyActionDialog || !verificationRequestId.trim()) return;
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${selectedTenant.customerId}/users/${verifyActionDialog.id}/reset-password`,
        { password: verifiedPassword, mustChange: true, verification_request_id: verificationRequestId.trim() }, { headers });
      toast.success(`Password reset for ${verifyActionDialog.userPrincipalName}`);
      setVerifyActionDialog(null);
    } catch (e) { toast.error(e.response?.data?.detail || "Reset failed"); }
    finally { setBusy(false); }
  };

  const openVerifiedSignin = (user) => {
    setVerificationRequestId("");
    setVerifySigninDialog(user);
  };

  const handleVerifiedSignin = async () => {
    if (!selectedTenant || !verifySigninDialog || !verificationRequestId.trim()) return;
    const user = verifySigninDialog;
    const action = user.accountEnabled ? "block" : "unblock";
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${selectedTenant.customerId}/users/${user.id}/block-signin`,
        { enable: !user.accountEnabled, verification_request_id: verificationRequestId.trim() }, { headers });
      toast.success(`Sign-in ${action === "block" ? "blocked" : "unblocked"}`);
      setVerifySigninDialog(null);
      const u = await axios.get(`${API}/cipp/tenants/${selectedTenant.customerId}/users`, { headers });
      setUsers(u.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const handleOffboard = async () => {
    if (!selectedTenant || !offboardDialog) return;
    if (!verificationRequestId.trim()) { toast.error("A ready Nexus Verify request is required before offboarding"); return; }
    if (!window.confirm(`Offboard ${offboardDialog.userPrincipalName}? This disables sign-in, removes licenses, and converts mailbox to shared.`)) return;
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${selectedTenant.customerId}/users/${offboardDialog.id}/offboard`,
        { ...offboardOpts, verification_request_id: verificationRequestId.trim() }, { headers });
      toast.success(`Offboarded ${offboardDialog.userPrincipalName}`);
      setOffboardDialog(null);
      const u = await axios.get(`${API}/cipp/tenants/${selectedTenant.customerId}/users`, { headers });
      setUsers(u.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Offboard failed"); }
    finally { setBusy(false); }
  };

  const handleLinkToClient = async () => {
    if (!linkDialog || !linkClientId || !linkReason.trim()) return;
    if (!linkDialog.connectionId) {
      toast.error("Register this tenant in Microsoft tenant setup before mapping it to a client.");
      return;
    }
    setBusy(true);
    try {
      await axios.put(
        `${API}/m365/onboarding/tenants/${linkDialog.connectionId}/mapping`,
        { client_id: linkClientId, reason: linkReason.trim() },
        { headers },
      );
      toast.success("Tenant linked to client");
      setLinkDialog(null);
      setLinkClientId("");
      setLinkReason("");
      const linkedClient = allClients.find((client) => client.id === linkClientId);
      setSelectedTenant((current) => current ? { ...current, clientId: linkClientId, clientName: linkedClient?.name, mapped: true } : current);
      await loadSummary();
    } catch (e) { toast.error(e.response?.data?.detail || "Link failed"); }
    finally { setBusy(false); }
  };

  const openBillingMapping = async (tenant, comparison) => {
    setBillingMapDialog({ tenant, comparison });
    setBillingMapLineId("");
    setBillingInclusions([]);
    try {
      const response = await axios.get(`${API}/line-items?client_id=${encodeURIComponent(tenant.client_id)}`, { headers });
      setBillingInclusions((response.data || []).filter((item) => item.asset_status !== "returned" && item.asset_status !== "replaced"));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load contract billing inclusions");
    }
  };

  const saveBillingMapping = async () => {
    if (!billingMapDialog || !billingMapLineId) return;
    setBusy(true);
    try {
      const { comparison } = billingMapDialog;
      const response = await axios.put(`${API}/line-items/${billingMapLineId}/m365-sku-mapping`, {
        m365_sku_id: comparison.sku_id,
        m365_sku_part_number: comparison.sku_part_number,
      }, { headers });
      toast.success(response.data?.requires_recurring_sync ? "SKU mapping saved. Sync the contract recurring invoice next." : "Microsoft SKU mapping saved");
      setBillingMapDialog(null);
      setBillingAssurance(null);
      await loadBillingAssurance();
      await loadSummary();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to save the Microsoft SKU mapping");
    } finally {
      setBusy(false);
    }
  };

  const providerOperational = Boolean(summary?.configured);
  const partnerConnected = onboarding?.connection?.last_test_status === "success";
  const s = summary?.stats || {};
  const tenantCount = Math.max(Number(s.tenants || 0), Number(onboarding?.summary?.discovered || 0));
  const linkedCount = Math.max(Number(s.linked_clients || 0), Number(onboarding?.summary?.mapped || 0));
  const coveragePct = tenantCount ? Math.round((linkedCount / tenantCount) * 100) : 0;

  return (
    <div className={embedded ? "space-y-5" : "p-6 space-y-5"} data-testid="cipp-command-center">
      {!embedded && <OperationalPageHeader
        eyebrow="Nexus 365 · tenant operations"
        title="Nexus Tenant Operations"
        description="One governed workspace for partner tenants, identity lifecycle work, licensing, posture and client context. Provider adapters stay behind the scenes; technicians work in Nexus."
        icon={Cloud}
        tone="cyan"
        actions={<>
          <Badge variant="outline" className={providerOperational ? "border-emerald-500/30 text-emerald-300" : partnerConnected ? "border-cyan-500/30 text-cyan-200" : "border-amber-500/30 text-amber-300"}>
            {providerOperational ? "Live operations" : partnerConnected ? "Discovery connected" : "Connection required"}
          </Badge>
          <Button variant="outline" size="sm" asChild data-testid="cipp-configure-btn">
            <Link to="/control-plane?module=microsoft365&view=connections"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Connections</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={loadSummary} disabled={loadingSummary} data-testid="cipp-refresh-btn">
            {loadingSummary ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Refresh
          </Button>
        </>}
      />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroTile label="Tenants" value={loadingSummary ? "—" : tenantCount} icon={Cloud} glow="cyan" subtitle="Discovered and operational" testId="cipp-metric-tenants" />
        <HeroTile label="Linked clients" value={loadingSummary ? "—" : linkedCount} icon={LinkIcon} glow="emerald" subtitle="Mapped to Nexus clients" testId="cipp-metric-linked" />
        <HeroTile label="Coverage" value={loadingSummary ? "—" : coveragePct} suffix="%" icon={Shield} glow="sky" subtitle="Tenants linked to clients" testId="cipp-metric-coverage" />
        <HeroTile label="Audited actions" value={loadingSummary ? "—" : summary?.recent_actions?.length ?? 0} icon={RefreshCw} glow="violet" subtitle="Last 30 days" testId="cipp-metric-actions" />
      </div>

      {sourceErrors.length > 0 && <Card className="border-amber-500/25 bg-amber-500/[0.045]" data-testid="m365-provider-source-errors"><CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"><div className="flex min-w-0 gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /><div><p className="text-sm font-semibold">Some Microsoft evidence is unavailable</p><p className="mt-1 text-xs leading-5 text-muted-foreground">This view does not treat a failed source as an empty tenant list. Retry before using incomplete evidence for an operational decision.</p><div className="mt-2 flex flex-wrap gap-1.5">{sourceErrors.map((source) => <Badge key={source} variant="outline" className="border-amber-500/25 text-amber-100">{source}</Badge>)}</div></div></div><Button variant="outline" size="sm" onClick={loadSummary} disabled={loadingSummary}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loadingSummary ? "animate-spin" : ""}`} />Retry sources</Button></CardContent></Card>}

      <div className="space-y-4">
        <Card className={providerOperational ? "border-emerald-500/25 bg-emerald-500/[0.04]" : partnerConnected ? "border-cyan-500/25 bg-cyan-500/[0.04]" : "border-amber-500/25 bg-amber-500/[0.04]"}>
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${providerOperational ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : partnerConnected ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-200" : "border-amber-500/25 bg-amber-500/10 text-amber-200"}`}>
              {providerOperational ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {providerOperational ? "Nexus 365 operations are ready" : partnerConnected ? "Tenant discovery is ready — operational access pending" : "Connect Microsoft tenant discovery"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {providerOperational
                  ? "Nexus can read tenant users and licences through the connected provider. High-impact actions remain permission-, client-scope- and approval-governed."
                  : partnerConnected
                    ? "Partner Center can discover customers, but users, licences and write actions stay disabled until the tenant has verified GDAP or customer-admin Graph access."
                    : "Configure the MSP partner tenant once, discover customers, then map and verify each tenant before technicians carry out identity work."}
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/control-plane?module=microsoft365&view=connections"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Manage connections</Link>
            </Button>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-auto w-full flex-wrap justify-start md:w-auto" data-testid="cipp-tabs">
            <TabsTrigger value="tenants" data-testid="cipp-tab-tenants"><Cloud className="w-3 h-3 mr-1" />Tenants</TabsTrigger>
            <TabsTrigger value="assurance" data-testid="cipp-tab-assurance"><CheckCircle2 className="w-3 h-3 mr-1" />Assurance</TabsTrigger>
            <TabsTrigger value="billing" data-testid="cipp-tab-billing"><TrendingUp className="w-3 h-3 mr-1" />Billing assurance</TabsTrigger>
            <TabsTrigger value="lifecycle" data-testid="cipp-tab-lifecycle"><Workflow className="w-3 h-3 mr-1" />Employee lifecycle</TabsTrigger>
            <TabsTrigger value="access" data-testid="cipp-tab-access"><KeyRound className="w-3 h-3 mr-1" />Access governance</TabsTrigger>
            <TabsTrigger value="changes" data-testid="cipp-tab-changes"><History className="w-3 h-3 mr-1" />Change intelligence</TabsTrigger>
            <TabsTrigger value="standards" data-testid="cipp-tab-standards"><Shield className="w-3 h-3 mr-1" />Standards</TabsTrigger>
            <TabsTrigger value="hygiene" data-testid="cipp-tab-hygiene"><Shield className="w-3 h-3 mr-1" />Security posture</TabsTrigger>
            <TabsTrigger value="linked" data-testid="cipp-tab-linked"><LinkIcon className="w-3 h-3 mr-1" />Linked clients</TabsTrigger>
            <TabsTrigger value="audit" data-testid="cipp-tab-audit"><RefreshCw className="w-3 h-3 mr-1" />Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="tenants" className="space-y-4">
            <Card>
              <CardContent className="p-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input className="pl-8 h-9" placeholder="Search a tenant, primary domain or ID…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="cipp-tenant-search" />
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
              {/* Tenant list */}
              <Card>
                <CardContent className="p-0">
                  {loadingSummary ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />Loading tenant estate…
                    </div>
                  ) : filteredTenants.length === 0 ? (
                    <div className="space-y-3 px-5 py-12 text-center">
                      <Cloud className="mx-auto h-8 w-8 text-muted-foreground/60" />
                      <p className="text-sm font-medium">{query ? "No tenants match this search" : "No Microsoft tenants are in scope yet"}</p>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {query ? "Try a tenant name, primary domain or tenant ID." : "Connect Partner Center to discover CSP customers in bulk, or add an individual tenant."}
                      </p>
                      {!query && <Button variant="outline" size="sm" asChild><Link to="/control-plane?module=microsoft365&view=connections">Open tenant onboarding</Link></Button>}
                    </div>
                  ) : (
                    <div className="divide-y divide-border max-h-[calc(100vh-280px)] overflow-y-auto">
                      {filteredTenants.map((t) => (
                        <button
                          key={t.customerId}
                          onClick={() => setSelectedTenant(t)}
                          className={`w-full text-left p-3 hover:bg-muted/30 ${selectedTenant?.customerId === t.customerId ? "bg-muted/40 border-l-2 border-l-orange-500" : ""}`}
                          data-testid={`cipp-tenant-${t.customerId}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{t.displayName}</div>
                              <div className="truncate font-mono text-[11px] text-muted-foreground">{t.defaultDomainName || t.customerId}</div>
                            </div>
                            <TenantAccessBadge status={t.accessStatus} compact />
                          </div>
                          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span className={`h-1.5 w-1.5 rounded-full ${t.mapped ? "bg-emerald-400" : "bg-amber-400"}`} />
                            {t.clientName || (t.mapped ? "Client mapped" : "Needs client mapping")}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Tenant detail */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  {!selectedTenant ? (
                    <div className="text-center py-12 text-xs text-muted-foreground">Select a tenant to open its identity, licence and client context.</div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="text-lg font-semibold">{selectedTenant.displayName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{selectedTenant.defaultDomainName}</div>
                          <div className="text-[10px] text-muted-foreground font-mono mt-1">tenant: {selectedTenant.customerId}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <TenantAccessBadge status={selectedTenant.accessStatus} />
                            <Badge variant="outline" className={selectedTenant.mapped ? "border-emerald-500/25 text-emerald-200" : "border-amber-500/25 text-amber-200"}>
                              {selectedTenant.clientName || (selectedTenant.mapped ? "Client mapped" : "Client mapping required")}
                            </Badge>
                            <Badge variant="outline" className="capitalize text-muted-foreground">{String(selectedTenant.source || "unknown").replaceAll("_", " ")}</Badge>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => {
                            if (!selectedTenant.connectionId) {
                              toast.info("Register this tenant in Microsoft tenant setup before mapping it to a client.");
                              return;
                            }
                            setLinkClientId(selectedTenant.clientId || "");
                            setLinkReason("");
                            setLinkDialog(selectedTenant);
                          }} data-testid="cipp-link-client-btn">
                            <LinkIcon className="w-3 h-3 mr-1" />{selectedTenant.mapped ? "Change mapping" : "Map client"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                            onClick={() => setCreateDialog(true)}
                            disabled={!selectedTenant.providerOperational || !selectedTenant.mapped}
                            title={!selectedTenant.providerOperational ? "Verify operational Microsoft access first" : !selectedTenant.mapped ? "Map this tenant to a Nexus client first" : undefined}
                            data-testid="cipp-create-user-btn"
                          >
                            <UserPlus className="w-3 h-3 mr-1" />Create user
                          </Button>
                        </div>
                      </div>

                      {!selectedTenant.providerOperational ? (
                        <TenantReadinessPanel tenant={selectedTenant} />
                      ) : <>
                      <div className="grid grid-cols-3 gap-2 pt-2">
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Users</div>
                          <div className="text-lg font-semibold">{users.length}</div>
                        </div>
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Licensed</div>
                          <div className="text-lg font-semibold">{users.filter(u => u.licenses_count > 0).length}</div>
                        </div>
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Blocked</div>
                          <div className="text-lg font-semibold">{users.filter(u => !u.accountEnabled).length}</div>
                        </div>
                      </div>

                      {/* Licenses */}
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">SKUs available</div>
                        <div className="flex flex-wrap gap-1">
                          {licenses.length === 0 ? (
                            <span className="text-xs text-muted-foreground">No licenses returned.</span>
                          ) : licenses.map(l => (
                            <Badge key={l.skuId} variant="outline" className="text-[10px] font-mono" title={l.skuId}>
                              {l.skuPartNumber || l.skuId} · {l.consumedUnits}/{(l.consumedUnits + (l.available ?? 0))}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* Users table */}
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Users</div>
                        {loadingUsers ? (
                          <div className="flex items-center justify-center py-8 text-muted-foreground">
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading users…
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-[10px] uppercase">Name</TableHead>
                                <TableHead className="text-[10px] uppercase">UPN</TableHead>
                                <TableHead className="text-[10px] uppercase">Status</TableHead>
                                <TableHead className="text-[10px] uppercase">Licenses</TableHead>
                                <TableHead className="text-right text-[10px] uppercase">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {users.map((u) => (
                                <TableRow key={u.id} data-testid={`cipp-user-${u.id}`}>
                                  <TableCell className="font-medium text-sm">{u.displayName || "—"}</TableCell>
                                  <TableCell className="text-xs font-mono">{u.userPrincipalName}</TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className={u.accountEnabled ? "text-emerald-400 border-emerald-500/30" : "text-rose-400 border-rose-500/30"}>
                                      {u.accountEnabled ? "Enabled" : "Blocked"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">{u.licenses_count}</TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex gap-1 justify-end flex-wrap">
                                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => { setLicenseDialog(u); setLicAdd([]); setLicRemove([]); }} data-testid={`cipp-user-license-${u.id}`}>
                                        <KeyRound className="w-3 h-3 mr-1" />Licenses
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => openVerifiedReset(u)} disabled={busy} data-testid={`cipp-user-reset-${u.id}`}>
                                        <RefreshCw className="w-3 h-3 mr-1" />Reset pw
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => openVerifiedSignin(u)} disabled={busy} data-testid={`cipp-user-block-${u.id}`}>
                                        {u.accountEnabled ? <><Lock className="w-3 h-3 mr-1" />Block</> : <><Unlock className="w-3 h-3 mr-1" />Unblock</>}
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 text-[10px] text-rose-400" onClick={() => { setVerificationRequestId(""); setOffboardDialog(u); }} data-testid={`cipp-user-offboard-${u.id}`}>
                                        <UserX className="w-3 h-3 mr-1" />Offboard
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                      </>}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="assurance" className="space-y-4" data-testid="cipp-assurance-panel">
            <Card className="border-cyan-500/20 bg-cyan-500/[0.025]">
              <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Nexus 365 Assurance</p>
                  <p className="mt-2 text-sm text-muted-foreground">A truthful control-evidence view. Nexus marks unknown coverage as an evidence gap rather than a passing control.</p>
                </div>
                <div className="grid grid-cols-3 divide-x divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-background/40 text-center text-xs">
                  <div className="px-4 py-3"><p className="text-lg font-semibold text-emerald-200">{assurance?.summary?.verified_controls ?? "—"}</p><p className="mt-1 text-muted-foreground">Verified</p></div>
                  <div className="px-4 py-3"><p className="text-lg font-semibold text-amber-200">{assurance?.summary?.needs_attention ?? "—"}</p><p className="mt-1 text-muted-foreground">Attention</p></div>
                  <div className="px-4 py-3"><p className="text-lg font-semibold text-slate-200">{assurance?.summary?.evidence_gaps ?? "—"}</p><p className="mt-1 text-muted-foreground">Evidence gaps</p></div>
                </div>
              </CardContent>
            </Card>

            {!assurance?.tenants?.length ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Map Microsoft tenants to Nexus clients to begin assurance. Unmapped or unavailable evidence is never treated as compliant.</CardContent></Card> : assurance.tenants.map((tenant) => (
              <Card key={tenant.client_id} className="overflow-hidden border-border/70" data-testid={`cipp-assurance-${tenant.client_id}`}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div><p className="font-semibold">{tenant.client_name}</p><p className="mt-1 text-xs font-mono text-muted-foreground">{tenant.tenant_display} {tenant.tenant_domain ? `· ${tenant.tenant_domain}` : ""}</p></div>
                    <div className="flex flex-wrap gap-2"><Badge variant="outline" className={tenant.summary.state === "assured" ? "border-emerald-500/30 text-emerald-200" : tenant.summary.state === "attention_required" ? "border-amber-500/30 text-amber-200" : "border-slate-500/30 text-slate-200"}>{tenant.summary.state.replaceAll("_", " ")}</Badge><Button size="sm" variant="outline" asChild><Link to={`/clients?client=${encodeURIComponent(tenant.client_id)}`}>Open client<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{tenant.checks.map((check) => <div key={check.key} className="rounded-xl border border-border/60 bg-muted/15 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{check.label}</p><Badge variant="outline" className={check.state === "verified" ? "border-emerald-500/30 text-emerald-200" : check.state === "needs_attention" ? "border-amber-500/30 text-amber-200" : "border-slate-500/30 text-slate-200"}>{check.state.replaceAll("_", " ")}</Badge></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{check.detail}</p>{check.source && <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">Source · {check.source}</p>}</div>)}</div>
                  {tenant.findings.length > 0 && <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">Priority review</p><div className="mt-3 space-y-2">{tenant.findings.slice(0, 3).map((finding) => <div key={finding.key} className="flex items-start justify-between gap-3 text-sm"><div><p className="font-medium">{finding.title}</p><p className="mt-1 text-xs text-muted-foreground">{finding.detail}</p></div>{finding.action === "review_hygiene" && <Button size="sm" variant="ghost" onClick={() => setActiveTab("hygiene")}>Review posture</Button>}</div>)}</div></div>}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="billing" className="space-y-4" data-testid="cipp-billing-assurance-panel">
            <Card className="border-emerald-500/20 bg-emerald-500/[0.025]">
              <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">Nexus 365 Billing Assurance</p>
                  <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{billingAssurance?.boundary || "Compare live Microsoft SKU evidence with explicit Nexus contract inclusions. Nexus never fuzzy-matches product names or alters billing automatically."}</p>
                </div>
                <div className="grid grid-cols-3 divide-x divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-background/40 text-center text-xs">
                  <div className="px-4 py-3"><p className="text-lg font-semibold text-cyan-200">{billingAssurance?.summary?.provider_skus ?? "—"}</p><p className="mt-1 text-muted-foreground">Provider SKUs</p></div>
                  <div className="px-4 py-3"><p className="text-lg font-semibold text-emerald-200">{billingAssurance?.summary?.reconciled_skus ?? "—"}</p><p className="mt-1 text-muted-foreground">Reconciled</p></div>
                  <div className="px-4 py-3"><p className="text-lg font-semibold text-amber-200">{billingAssurance?.summary?.needs_attention ?? "—"}</p><p className="mt-1 text-muted-foreground">Review</p></div>
                </div>
              </CardContent>
            </Card>

            {loadingBillingAssurance && !billingAssurance ? <Card><CardContent className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Collecting current commercial evidence…</CardContent></Card> : !billingAssurance?.tenants?.length ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Map Microsoft tenants to Nexus clients, then add explicit SKU mappings to active contract billing inclusions.</CardContent></Card> : billingAssurance.tenants.map((tenant) => (
              <Card key={tenant.client_id} className="overflow-hidden border-border/70" data-testid={`cipp-billing-assurance-${tenant.client_id}`}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div><p className="font-semibold">{tenant.client_name}</p><p className="mt-1 text-xs font-mono text-muted-foreground">{tenant.tenant_id || "Tenant mapping required"}</p></div>
                    <div className="flex flex-wrap gap-2"><Badge variant="outline" className={tenant.summary.state === "assured" ? "border-emerald-500/30 text-emerald-200" : tenant.summary.state === "needs_attention" ? "border-amber-500/30 text-amber-200" : "border-slate-500/30 text-slate-200"}>{tenant.summary.state.replaceAll("_", " ")}</Badge><Button size="sm" variant="outline" asChild><Link to={`/services-subscriptions?client=${encodeURIComponent(tenant.client_id)}&view=attention`}>Services & subscriptions<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">{tenant.checks.map((check) => <div key={check.key} className="rounded-xl border border-border/60 bg-muted/15 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{check.label}</p><Badge variant="outline" className={check.state === "verified" ? "border-emerald-500/30 text-emerald-200" : check.state === "needs_attention" ? "border-amber-500/30 text-amber-200" : "border-slate-500/30 text-slate-200"}>{check.state.replaceAll("_", " ")}</Badge></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{check.detail}</p><p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">Source · {check.source}</p></div>)}</div>
                  {tenant.comparisons?.length > 0 && <div className="overflow-hidden rounded-xl border border-border/60"><Table><TableHeader><TableRow><TableHead className="text-[10px] uppercase">Provider SKU</TableHead><TableHead className="text-[10px] uppercase text-right">Purchased</TableHead><TableHead className="text-[10px] uppercase text-right">Consumed</TableHead><TableHead className="text-[10px] uppercase text-right">Billed</TableHead><TableHead className="text-[10px] uppercase">Evidence</TableHead><TableHead /></TableRow></TableHeader><TableBody>{tenant.comparisons.map((comparison) => <TableRow key={comparison.sku_id}><TableCell><p className="text-xs font-medium">{comparison.sku_part_number}</p><p className="mt-0.5 max-w-[210px] truncate font-mono text-[10px] text-muted-foreground">{comparison.sku_id}</p></TableCell><TableCell className="text-right font-mono text-xs">{comparison.purchased}</TableCell><TableCell className="text-right font-mono text-xs">{comparison.consumed}</TableCell><TableCell className="text-right font-mono text-xs">{comparison.billed ?? "—"}</TableCell><TableCell><Badge variant="outline" className={comparison.mapping_state === "reconciled" ? "border-emerald-500/30 text-emerald-200" : comparison.mapping_state === "quantity_mismatch" ? "border-rose-500/30 text-rose-200" : "border-amber-500/30 text-amber-200"}>{comparison.mapping_state.replaceAll("_", " ")}</Badge></TableCell><TableCell className="text-right">{comparison.mapping_state === "unmapped" && <Button size="sm" variant="outline" onClick={() => openBillingMapping(tenant, comparison)} data-testid={`cipp-map-sku-${comparison.sku_id}`}>Map inclusion</Button>}</TableCell></TableRow>)}</TableBody></Table></div>}
                  {tenant.findings?.length > 0 && <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">Review queue</p><div className="mt-3 space-y-3">{tenant.findings.slice(0, 5).map((finding) => { const comparison = tenant.comparisons?.find((row) => row.sku_id === finding.sku_id); return <div key={finding.key} className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/20 p-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium">{finding.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{finding.detail}</p></div><div className="flex shrink-0 gap-2">{finding.action === "map_billing_inclusion" && comparison && <Button size="sm" variant="outline" onClick={() => openBillingMapping(tenant, comparison)}>Map inclusion</Button>}{finding.route && finding.action !== "map_billing_inclusion" && <Button size="sm" variant="ghost" asChild><Link to={finding.route}>Open<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>}</div></div>; })}</div></div>}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="lifecycle" className="space-y-4" data-testid="cipp-lifecycle-panel">
            <LifecycleReadinessPanel
              readiness={lifecycleReadiness}
              loading={loadingLifecycleReadiness}
              onRefresh={loadLifecycleReadiness}
            />
          </TabsContent>

          <TabsContent value="access" className="space-y-4" data-testid="cipp-access-governance-panel">
            <AccessGovernancePanel
              readiness={accessGovernance}
              loading={loadingAccessGovernance}
              onRefresh={loadAccessGovernance}
            />
          </TabsContent>

          <TabsContent value="changes" className="space-y-4" data-testid="cipp-change-intelligence-panel">
            <ChangeIntelligencePanel
              readiness={changeIntelligence}
              loading={loadingChangeIntelligence}
              onRefresh={loadChangeIntelligence}
            />
          </TabsContent>

          <TabsContent value="standards" className="space-y-4" data-testid="cipp-standards-panel">
            <Card className="border-violet-500/20 bg-violet-500/[0.025]">
              <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-200">{standards?.profile?.name || "Nexus Microsoft 365 Core"}</p><p className="mt-2 text-sm text-muted-foreground">{standards?.boundary || "Compare declared operational thresholds with current provider evidence. Drift opens review work; it never triggers an automatic change."}</p></div>
                <div className="grid grid-cols-3 divide-x divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-background/40 text-center text-xs"><div className="px-4 py-3"><p className="text-lg font-semibold text-emerald-200">{standards?.summary?.conforming ?? "—"}</p><p className="mt-1 text-muted-foreground">Conforming</p></div><div className="px-4 py-3"><p className="text-lg font-semibold text-amber-200">{standards?.summary?.drift ?? "—"}</p><p className="mt-1 text-muted-foreground">Drift</p></div><div className="px-4 py-3"><p className="text-lg font-semibold text-slate-200">{standards?.summary?.evidence_gaps ?? "—"}</p><p className="mt-1 text-muted-foreground">Unknown</p></div></div>
              </CardContent>
            </Card>
            {!standards?.tenants?.length ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Map a Microsoft tenant to a Nexus client, then refresh evidence to evaluate the core standard.</CardContent></Card> : standards.tenants.map((tenant) => <Card key={tenant.client_id} className="overflow-hidden border-border/70" data-testid={`cipp-standards-${tenant.client_id}`}><CardContent className="space-y-4 p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><p className="font-semibold">{tenant.client_name}</p><p className="mt-1 text-xs font-mono text-muted-foreground">{tenant.tenant_display}</p></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className={tenant.summary.state === "conforming" ? "border-emerald-500/30 text-emerald-200" : tenant.summary.state === "drift_detected" ? "border-amber-500/30 text-amber-200" : "border-slate-500/30 text-slate-200"}>{tenant.summary.state.replaceAll("_", " ")}</Badge><Button size="sm" variant="outline" onClick={() => setActiveTab("hygiene")}>Review evidence</Button></div></div><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{tenant.controls.map((control) => <div key={control.key} className="rounded-xl border border-border/60 bg-muted/15 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{control.label}</p><Badge variant="outline" className={control.status === "conforming" ? "border-emerald-500/30 text-emerald-200" : control.status === "drift" ? "border-amber-500/30 text-amber-200" : "border-slate-500/30 text-slate-200"}>{control.status.replaceAll("_", " ")}</Badge></div><p className="mt-2 text-xs leading-5 text-muted-foreground">Expected · {control.expected}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Observed · {control.observed}</p><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{control.detail}</p></div>)}</div></CardContent></Card>)}
          </TabsContent>

          <TabsContent value="hygiene" className="space-y-4">
            <CippHygienePanel />
          </TabsContent>

          <TabsContent value="linked">
            <Card>
              <CardContent className="p-0">
                {linkedClients.length === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">No clients are linked to a Microsoft tenant yet.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] uppercase">Client</TableHead>
                        <TableHead className="text-[10px] uppercase">Tenant</TableHead>
                        <TableHead className="text-[10px] uppercase">Domain</TableHead>
                        <TableHead className="text-[10px] uppercase">Linked</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linkedClients.map((c) => (
                        <TableRow key={c.id} data-testid={`cipp-linked-${c.id}`}>
                          <TableCell className="font-medium text-sm">{c.name}</TableCell>
                          <TableCell className="text-xs">{c.cipp_tenant_display || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{c.cipp_tenant_domain || "—"}</TableCell>
                          <TableCell className="text-[10px] font-mono text-muted-foreground">{c.cipp_linked_at ? new Date(c.cipp_linked_at).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" asChild><Link to={`/clients`}>Open<ExternalLink className="w-3 h-3 ml-1" /></Link></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit">
            <Card>
              <CardContent className="p-0">
                {(summary?.recent_actions || []).length === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">No tenant operations have been recorded yet.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] uppercase">When</TableHead>
                        <TableHead className="text-[10px] uppercase">Action</TableHead>
                        <TableHead className="text-[10px] uppercase">Tenant</TableHead>
                        <TableHead className="text-[10px] uppercase">User</TableHead>
                        <TableHead className="text-[10px] uppercase">By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(summary?.recent_actions || []).map((a, i) => (
                        <TableRow key={i} data-testid={`cipp-audit-${i}`}>
                          <TableCell className="text-[10px] font-mono">{new Date(a.timestamp).toLocaleString()}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className="text-[10px]">{a.action}</Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono truncate max-w-[120px]">{a.tenant_id}</TableCell>
                          <TableCell className="text-xs font-mono truncate max-w-[180px]">{a.user_id || a.upn || "—"}</TableCell>
                          <TableCell className="text-xs">{a.by || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create User Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="flex h-[min(760px,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl" data-testid="cipp-create-user-dialog">
          <DialogHeader className="shrink-0 border-b border-border/80 bg-gradient-to-r from-sky-400/15 via-sky-400/[0.04] to-transparent px-5 py-5 pr-12">
            <DialogTitle>Create M365 user</DialogTitle>
            <DialogDescription>Tenant: {selectedTenant?.displayName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First name</Label><Input value={createForm.firstName} onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })} data-testid="cipp-user-firstname" /></div>
              <div><Label>Last name</Label><Input value={createForm.lastName} onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })} data-testid="cipp-user-lastname" /></div>
            </div>
            <div><Label>Display name *</Label><Input value={createForm.displayName} onChange={e => setCreateForm({ ...createForm, displayName: e.target.value })} data-testid="cipp-user-displayname" /></div>
            <div><Label>User Principal Name (email) *</Label><Input value={createForm.userPrincipalName} onChange={e => setCreateForm({ ...createForm, userPrincipalName: e.target.value })} placeholder={`user@${selectedTenant?.defaultDomainName || "domain.com"}`} data-testid="cipp-user-upn" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Password *</Label><Input type="password" value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })} data-testid="cipp-user-password" /></div>
              <div><Label>Usage location</Label><Input value={createForm.usageLocation} onChange={e => setCreateForm({ ...createForm, usageLocation: e.target.value.toUpperCase() })} maxLength={2} data-testid="cipp-user-location" /></div>
            </div>
            {licenses.length > 0 && (
              <div>
                <Label>Assign licenses</Label>
                <div className="border border-border rounded p-2 space-y-1 max-h-32 overflow-y-auto">
                  {licenses.map(l => (
                    <label key={l.skuId} className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={createForm.licenses.includes(l.skuId)}
                        onCheckedChange={(checked) => {
                          setCreateForm(f => ({
                            ...f,
                            licenses: checked ? [...f.licenses, l.skuId] : f.licenses.filter(x => x !== l.skuId),
                          }));
                        }}
                      />
                      <span className="font-mono">{l.skuPartNumber || l.skuId}</span>
                      <span className="text-muted-foreground">({l.consumedUnits}/{l.consumedUnits + (l.available ?? 0)})</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={createForm.mustChangePassword} onCheckedChange={(c) => setCreateForm({ ...createForm, mustChangePassword: c })} />
              Force password change at next sign-in
            </label>
          </div>
          <DialogFooter className="shrink-0 border-t border-border/80 bg-muted/[0.12] px-5 py-4">
            <Button variant="ghost" onClick={() => setCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateUser} disabled={busy} data-testid="cipp-submit-create-user">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* License management Dialog */}
      <Dialog open={!!licenseDialog} onOpenChange={() => setLicenseDialog(null)}>
        <DialogContent className="flex h-[min(760px,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl" data-testid="cipp-license-dialog">
          <DialogHeader className="shrink-0 border-b border-border/80 bg-gradient-to-r from-violet-400/15 via-violet-400/[0.04] to-transparent px-5 py-5 pr-12">
            <DialogTitle>Manage licenses · {licenseDialog?.userPrincipalName}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5">
            <div>
              <Label className="text-xs">Assign (add)</Label>
              <div className="border border-border rounded p-2 space-y-1 max-h-40 overflow-y-auto">
                {licenses.map(l => (
                  <label key={`add-${l.skuId}`} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={licAdd.includes(l.skuId)}
                      onCheckedChange={(c) => setLicAdd(a => c ? [...a, l.skuId] : a.filter(x => x !== l.skuId))}
                    />
                    <span className="font-mono">{l.skuPartNumber || l.skuId}</span>
                    <span className="text-muted-foreground ml-auto">available: {l.available ?? 0}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Remove</Label>
              <div className="border border-border rounded p-2 space-y-1 max-h-40 overflow-y-auto">
                {licenses.map(l => (
                  <label key={`rm-${l.skuId}`} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={licRemove.includes(l.skuId)}
                      onCheckedChange={(c) => setLicRemove(a => c ? [...a, l.skuId] : a.filter(x => x !== l.skuId))}
                    />
                    <span className="font-mono">{l.skuPartNumber || l.skuId}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t border-border/80 bg-muted/[0.12] px-5 py-4">
            <Button variant="ghost" onClick={() => setLicenseDialog(null)}>Cancel</Button>
            <Button onClick={handleAssignLicense} disabled={busy || (licAdd.length === 0 && licRemove.length === 0)} data-testid="cipp-submit-license">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1" />}Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!verifyActionDialog} onOpenChange={(open) => !open && setVerifyActionDialog(null)}>
        <NexusWorkflowDialog
          eyebrow="Protected Microsoft action"
          title="Verified password reset"
          description={`${verifyActionDialog?.userPrincipalName || "Selected user"} · the provider action stays blocked until Nexus has current connector-verified proof.`}
          icon={Shield}
          tone="cyan"
          className="max-w-xl"
          data-testid="cipp-verified-reset-dialog"
          footer={<><Button variant="outline" onClick={() => setVerifyActionDialog(null)} disabled={busy}>Cancel</Button><Button onClick={handleVerifiedReset} disabled={busy || !verificationRequestId.trim()} data-testid="cipp-submit-verified-reset">{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1.5 h-4 w-4" />}Reset with verified proof</Button></>}
        >
          <div className="space-y-5">
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-xs leading-5 text-muted-foreground">Open a <span className="font-medium text-foreground">Password reset</span> request in Nexus Verify. Operator-attested evidence can be reviewed and handed off, but this Microsoft action needs a current <span className="font-medium text-foreground">connector-verified</span> request owned by this customer.</div>
            <div className="space-y-2"><Label htmlFor="cipp-reset-verify-id">Connector-verified Nexus Verify request ID *</Label><Input id="cipp-reset-verify-id" value={verificationRequestId} onChange={(event) => setVerificationRequestId(event.target.value)} placeholder="Verification request ID" data-testid="cipp-reset-verify-id" /></div>
            <div className="space-y-2"><Label htmlFor="cipp-reset-password">New password (optional)</Label><Input id="cipp-reset-password" type="password" value={verifiedPassword} onChange={(event) => setVerifiedPassword(event.target.value)} placeholder="Leave blank for provider-generated password" /></div>
            <Button variant="outline" size="sm" className="w-fit" asChild><Link to={nexusVerifyUrl("password_reset", verifyActionDialog)}>Open Nexus Verify<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={!!verifySigninDialog} onOpenChange={(open) => !open && setVerifySigninDialog(null)}>
        <NexusWorkflowDialog
          eyebrow="Protected Microsoft action"
          title={`${verifySigninDialog?.accountEnabled ? "Block" : "Restore"} sign-in with verified proof`}
          description={`${verifySigninDialog?.userPrincipalName || "Selected user"} · Nexus needs current connector-verified proof and the required approval before this identity action can reach the provider.`}
          icon={verifySigninDialog?.accountEnabled ? Lock : Unlock}
          tone="amber"
          className="max-w-xl"
          data-testid="cipp-verified-signin-dialog"
          footer={<><Button variant="outline" onClick={() => setVerifySigninDialog(null)} disabled={busy}>Cancel</Button><Button variant={verifySigninDialog?.accountEnabled ? "destructive" : "default"} onClick={handleVerifiedSignin} disabled={busy || !verificationRequestId.trim()} data-testid="cipp-submit-verified-signin">{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : verifySigninDialog?.accountEnabled ? <Lock className="mr-1.5 h-4 w-4" /> : <Unlock className="mr-1.5 h-4 w-4" />}{verifySigninDialog?.accountEnabled ? "Block sign-in" : "Restore sign-in"}</Button></>}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-xs leading-5 text-muted-foreground">Identity status changes are never approved by a browser confirmation alone. Use a current connector-verified Nexus Verify request for this customer, then return here to execute the audited action.</div>
            <div className="space-y-2"><Label htmlFor="cipp-signin-verify-id">Connector-verified Nexus Verify request ID *</Label><Input id="cipp-signin-verify-id" value={verificationRequestId} onChange={(event) => setVerificationRequestId(event.target.value)} placeholder="Verification request ID" data-testid="cipp-signin-verify-id" /></div>
            <Button variant="outline" size="sm" className="w-fit" asChild><Link to={nexusVerifyUrl("offboarding", verifySigninDialog)}>Open Nexus Verify<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      {/* Offboard Dialog */}
      <Dialog open={!!offboardDialog} onOpenChange={() => setOffboardDialog(null)}>
        <NexusWorkflowDialog
          eyebrow="Protected Microsoft action"
          title={`Offboard ${offboardDialog?.userPrincipalName || "user"}`}
          description="Choose the Microsoft identity and mailbox actions to run through the configured tenant provider. Nexus keeps the approval, execution and resulting audit evidence together."
          icon={UserX}
          tone="amber"
          className="max-w-2xl"
          data-testid="cipp-offboard-dialog"
          footer={<><Button variant="outline" onClick={() => setOffboardDialog(null)} disabled={busy}>Cancel</Button><Button variant="destructive" onClick={handleOffboard} disabled={busy || !verificationRequestId.trim()} data-testid="cipp-submit-offboard">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserX className="w-4 h-4 mr-1" />}Offboard</Button></>}
        >
          <div className="space-y-5 text-xs">
            <div className="space-y-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4"><Label htmlFor="cipp-offboard-verify-id">Connector-verified Nexus Verify request ID *</Label><Input id="cipp-offboard-verify-id" value={verificationRequestId} onChange={(event) => setVerificationRequestId(event.target.value)} placeholder="Verification request ID" data-testid="cipp-offboard-verify-id" /><div className="flex flex-wrap items-center justify-between gap-2"><p className="max-w-lg leading-5 text-muted-foreground">Offboarding needs current trusted proof, independent approval and a connector-verified Nexus Verify request for this customer.</p><Button variant="outline" size="sm" className="h-8" asChild><Link to={nexusVerifyUrl("offboarding", offboardDialog)}>Open Nexus Verify</Link></Button></div></div>
            {[
              ["disableUser", "Disable sign-in"],
              ["removeLicenses", "Remove all licenses"],
              ["convertToShared", "Convert mailbox to shared"],
              ["resetPassword", "Reset password"],
              ["revokeSessions", "Revoke all sessions"],
              ["removeGroups", "Remove from all groups"],
              ["hideFromGAL", "Hide from Global Address List"],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/[0.08] px-3 py-2">
                <Checkbox checked={offboardOpts[k]} onCheckedChange={(c) => setOffboardOpts(o => ({ ...o, [k]: c }))} />
                {label}
              </label>
            ))}
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label className="text-xs">Out-of-office message (optional)</Label><Input value={offboardOpts.outOfOffice} onChange={e => setOffboardOpts({ ...offboardOpts, outOfOffice: e.target.value })} /></div><div className="space-y-2"><Label className="text-xs">Forward email to (optional UPN)</Label><Input value={offboardOpts.forwardTo} onChange={e => setOffboardOpts({ ...offboardOpts, forwardTo: e.target.value })} placeholder="manager@company.com" /></div></div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={!!billingMapDialog} onOpenChange={(open) => !open && setBillingMapDialog(null)}>
        <DialogContent className="flex h-[min(680px,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl" data-testid="cipp-billing-map-dialog">
          <DialogHeader className="shrink-0 border-b border-emerald-500/20 bg-gradient-to-r from-emerald-400/10 via-background to-background px-5 py-5 pr-12">
            <DialogTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-300" />Map Microsoft SKU to billing inclusion</DialogTitle>
            <DialogDescription>{billingMapDialog?.tenant?.client_name} · save a stable provider SKU reference against one Nexus contract line.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Provider evidence</p><p className="mt-2 text-sm font-medium">{billingMapDialog?.comparison?.sku_part_number}</p><p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{billingMapDialog?.comparison?.sku_id}</p><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div className="rounded-lg bg-background/50 p-2"><p className="text-muted-foreground">Purchased</p><p className="mt-1 font-mono font-semibold">{billingMapDialog?.comparison?.purchased ?? "—"}</p></div><div className="rounded-lg bg-background/50 p-2"><p className="text-muted-foreground">Consumed</p><p className="mt-1 font-mono font-semibold">{billingMapDialog?.comparison?.consumed ?? "—"}</p></div><div className="rounded-lg bg-background/50 p-2"><p className="text-muted-foreground">Available</p><p className="mt-1 font-mono font-semibold">{billingMapDialog?.comparison?.available ?? "—"}</p></div></div></div>
            <div className="space-y-2"><Label htmlFor="cipp-billing-inclusion">Nexus contract billing inclusion *</Label><Select value={billingMapLineId} onValueChange={setBillingMapLineId}><SelectTrigger id="cipp-billing-inclusion" data-testid="cipp-billing-inclusion-select"><SelectValue placeholder="Choose the customer service line" /></SelectTrigger><SelectContent>{billingInclusions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.quantity} × {item.billing_frequency || "monthly"}</SelectItem>)}</SelectContent></Select>{billingInclusions.length === 0 && <p className="text-xs leading-5 text-amber-200">No active contract billing inclusions are available for this client. Create one in Contracts first.</p>}</div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs leading-5 text-muted-foreground">This saves an explicit Microsoft SKU ID on the selected contract line and records an audit event. It does not purchase licences, change the quantity, modify a customer invoice, or silently synchronise recurring billing. If the contract already has a recurring invoice, sync it as a separate reviewed step.</div>
          </div>
          <DialogFooter className="shrink-0 border-t border-border/80 bg-muted/[0.12] px-5 py-4"><Button variant="ghost" onClick={() => setBillingMapDialog(null)} disabled={busy}>Cancel</Button><Button onClick={saveBillingMapping} disabled={busy || !billingMapLineId} data-testid="cipp-save-billing-mapping">{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Save explicit mapping</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link tenant → client Dialog */}
      <Dialog open={!!linkDialog} onOpenChange={() => setLinkDialog(null)}>
        <DialogContent data-testid="cipp-link-dialog">
          <DialogHeader>
            <DialogTitle>Link tenant to NexusMSP client</DialogTitle>
            <DialogDescription>{linkDialog?.displayName} ({linkDialog?.defaultDomainName})</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-3 text-xs leading-5 text-muted-foreground">This updates the canonical Nexus client relationship used for technician scope, service context and Microsoft evidence. It does not grant Microsoft permissions.</div>
            <div className="space-y-2">
            <Label>Select client</Label>
            <Select value={linkClientId} onValueChange={setLinkClientId}>
              <SelectTrigger data-testid="cipp-link-client-select"><SelectValue placeholder="Pick a client" /></SelectTrigger>
              <SelectContent>
                {allClients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            </div>
            <div className="space-y-2"><Label htmlFor="cipp-link-reason">Why is this the correct client? <span className="text-rose-300">*</span></Label><Textarea id="cipp-link-reason" rows={3} value={linkReason} onChange={(event) => setLinkReason(event.target.value)} placeholder="Example: The primary domain and signed agreement match the Nexus client record." data-testid="cipp-link-reason" /><p className="text-[11px] text-muted-foreground">Nexus retains this decision in the Microsoft onboarding audit trail.</p></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDialog(null)}>Cancel</Button>
            <Button onClick={handleLinkToClient} disabled={busy || !linkClientId || !linkReason.trim()} data-testid="cipp-submit-link"><LinkIcon className="w-4 h-4 mr-1" />Confirm mapping</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LifecycleReadinessPanel({ readiness, loading, onRefresh }) {
  const summary = readiness?.summary || {};
  const clients = readiness?.clients || [];
  const mappedClients = clients.filter((client) => client.tenant?.state === "mapped");
  const unmappedClients = clients.filter((client) => client.tenant?.state !== "mapped");
  const stateClasses = {
    ready_for_planning: "border-emerald-500/30 text-emerald-200",
    attention_required: "border-amber-500/30 text-amber-200",
    evidence_incomplete: "border-slate-500/30 text-slate-200",
  };
  const findingRoute = {
    map_tenant: "/control-plane?module=microsoft365&view=connections",
    review_license_evidence: "/control-plane?module=microsoft365&view=security",
  };
  const routeWithClient = (route, clientId) => {
    if (!route) return "/control-plane?module=microsoft365&view=connections";
    const separator = route.includes("?") ? "&" : "?";
    return `${route}${separator}client=${encodeURIComponent(clientId || "")}`;
  };
  const label = (value) => String(value || "not_observed").replaceAll("_", " ");

  return (
    <>
      <Card className="border-cyan-500/20 bg-cyan-500/[0.025]">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Nexus 365 Employee Lifecycle</p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {readiness?.boundary || "Read provider evidence first, then open the governed joiner or leaver workflow. Nexus never treats missing evidence as a completed lifecycle outcome."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} data-testid="cipp-lifecycle-refresh">
              {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Refresh evidence
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroTile label="Clients" value={readiness ? summary.clients ?? 0 : "—"} icon={Cloud} glow="cyan" subtitle="Within your client scope" />
        <HeroTile label="Ready to plan" value={readiness ? summary.ready_for_planning ?? 0 : "—"} icon={CheckCircle2} glow="emerald" subtitle="Evidence complete enough to review" />
        <HeroTile label="Needs review" value={readiness ? summary.attention_required ?? 0 : "—"} icon={AlertTriangle} glow="amber" subtitle="Lifecycle exception found" />
        <HeroTile label="Active users" value={readiness ? summary.active_users ?? 0 : "—"} icon={UserPlus} glow="violet" subtitle="Provider-recorded identities" />
      </div>

      {loading && !readiness ? (
        <Card><CardContent className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Collecting scoped lifecycle evidence…</CardContent></Card>
      ) : clients.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <Workflow className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">No permitted client lifecycle records yet</p>
            <p className="mx-auto max-w-xl text-xs leading-5 text-muted-foreground">Connect Microsoft tenant discovery, map the tenant to a Nexus client, and collect verified provider evidence. The lifecycle workspace will then show only the clients you are allowed to operate.</p>
            <Button variant="outline" size="sm" asChild><Link to="/control-plane?module=microsoft365&view=connections">Open Microsoft connections<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>
          </CardContent>
        </Card>
      ) : mappedClients.length === 0 ? (
        <Card className="border-amber-500/25 bg-amber-500/[0.035]">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10"><Workflow className="h-5 w-5 text-amber-200" /></div>
            <div>
              <p className="text-sm font-semibold">Map the first Microsoft tenant before opening lifecycle work</p>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{unmappedClients.length} permitted client{unmappedClients.length === 1 ? " is" : "s are"} visible, but none has a stable Microsoft tenant relationship. Nexus has intentionally withheld joiner, leaver and licence conclusions until that ownership boundary is proven.</p>
            </div>
            <Button variant="outline" size="sm" asChild><Link to="/control-plane?module=microsoft365&view=connections">Map Microsoft tenants<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>
          </CardContent>
        </Card>
      ) : <>
        {unmappedClients.length > 0 && <Card className="border-amber-500/20 bg-amber-500/[0.025]"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{unmappedClients.length} client{unmappedClients.length === 1 ? " is" : "s are"} awaiting a Microsoft tenant mapping</p><p className="mt-1 text-xs text-muted-foreground">They are excluded from lifecycle conclusions until a stable client-to-tenant relationship is recorded.</p></div><Button size="sm" variant="outline" asChild><Link to="/control-plane?module=microsoft365&view=connections">Review mappings<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></CardContent></Card>}
        {mappedClients.map((client) => {
        const evidence = client.evidence || {};
        const counts = client.lifecycle_counts || {};
        const findings = client.findings || [];
        const gaps = client.evidence_gaps || [];
        return (
          <Card key={client.client_id} className="overflow-hidden border-border/70" data-testid={`cipp-lifecycle-${client.client_id}`}>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-semibold">{client.client_name}</p>
                  <p className="mt-1 text-xs font-mono text-muted-foreground">{client.tenant?.tenant_id || "Microsoft tenant mapping required"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={stateClasses[client.state] || stateClasses.evidence_incomplete}>{label(client.state)}</Badge>
                  <Button size="sm" variant="outline" asChild><Link to={`/clients?client=${encodeURIComponent(client.client_id)}`}>Open client<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <LifecycleMetric label="Tenant" value={label(client.tenant?.state)} tone={client.tenant?.state === "mapped" ? "emerald" : "amber"} />
                <LifecycleMetric label="Active identities" value={counts.active_users ?? 0} tone="cyan" />
                <LifecycleMetric label="Unlicensed active" value={counts.unlicensed_active_users ?? 0} tone={counts.unlicensed_active_users ? "amber" : "slate"} />
                <LifecycleMetric label="Disabled + licensed" value={counts.disabled_licensed_users ?? 0} tone={counts.disabled_licensed_users ? "amber" : "slate"} />
                <LifecycleMetric label="Low stock SKUs" value={counts.low_stock_skus ?? 0} tone={counts.low_stock_skus ? "amber" : "slate"} />
              </div>

              <div className="grid gap-2 lg:grid-cols-3">
                <LifecycleEvidence label="Tenant connection" item={evidence.tenant_connection} />
                <LifecycleEvidence label="Provider snapshot" item={evidence.provider_snapshot} />
                <LifecycleEvidence label="Action audit" item={evidence.provider_action_audit} />
              </div>

              {(findings.length > 0 || gaps.length > 0) && (
                <div className={`rounded-xl border p-4 ${findings.length ? "border-amber-500/20 bg-amber-500/[0.035]" : "border-slate-500/20 bg-muted/15"}`}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`h-4 w-4 ${findings.length ? "text-amber-200" : "text-slate-300"}`} />
                    <p className="text-xs font-semibold uppercase tracking-[0.16em]">{findings.length ? "Lifecycle review queue" : "Evidence gaps"}</p>
                  </div>
                  <div className="mt-3 space-y-2">
                    {[...findings, ...gaps].slice(0, 5).map((item) => {
                      const route = findingRoute[item.handoff];
                      return <div key={item.key} className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/20 p-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p></div>{route && <Button size="sm" variant="ghost" asChild><Link to={routeWithClient(route, client.client_id)}>Review<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>}</div>;
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
                {(client.safe_handoffs || []).map((handoff) => (
                  <Button key={handoff.key} size="sm" variant={handoff.kind === "governed_preview" ? "outline" : "ghost"} asChild>
                    <Link to={routeWithClient(handoff.route, client.client_id)} title={handoff.detail}>{handoff.label}<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link>
                  </Button>
                ))}
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">Every hand-off opens an existing governed workspace. This screen itself is evidence-only and has not changed Microsoft, CIPP, tickets, subscriptions, invoices, or approvals.</p>
            </CardContent>
          </Card>
        );
        })}
      </>}
    </>
  );
}

function LifecycleMetric({ label, value, tone = "slate" }) {
  const tones = {
    amber: "text-amber-200",
    cyan: "text-cyan-200",
    emerald: "text-emerald-200",
    violet: "text-violet-200",
    slate: "text-foreground",
  };
  return <div className="rounded-xl border border-border/60 bg-muted/15 p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 truncate text-sm font-semibold ${tones[tone] || tones.slate}`}>{value}</p></div>;
}

function LifecycleEvidence({ label, item = {} }) {
  const state = String(item?.state || "not_observed");
  const style = state === "verified" || state === "available" || state === "observed"
    ? "border-emerald-500/25 text-emerald-200"
    : "border-slate-500/25 text-slate-200";
  const detail = item?.latest_observed_at || item?.observed_at || item?.detail || "No current evidence timestamp";
  return <div className="rounded-xl border border-border/60 bg-muted/15 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">{label}</p><Badge variant="outline" className={`shrink-0 text-[10px] ${style}`}>{state.replaceAll("_", " ")}</Badge></div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{detail}</p></div>;
}

function AccessGovernancePanel({ readiness, loading, onRefresh }) {
  const summary = readiness?.summary || {};
  const clients = readiness?.clients || [];
  const mappedClients = clients.filter((client) => client.tenant?.state === "mapped");
  const unmappedClients = clients.filter((client) => client.tenant?.state !== "mapped");
  const stateClasses = {
    ready_for_review: "border-emerald-500/30 text-emerald-200",
    attention_required: "border-amber-500/30 text-amber-200",
    evidence_incomplete: "border-slate-500/30 text-slate-200",
  };
  const checkClasses = {
    verified: "border-emerald-500/30 text-emerald-200",
    needs_attention: "border-amber-500/30 text-amber-200",
    not_assessed: "border-slate-500/30 text-slate-200",
  };
  const routeWithClient = (route, clientId) => {
    const separator = route?.includes("?") ? "&" : "?";
    return `${route || "/control-plane?module=microsoft365&view=connections"}${separator}client=${encodeURIComponent(clientId || "")}`;
  };
  const label = (value) => String(value || "not_assessed").replaceAll("_", " ");

  return <>
    <Card className="border-violet-500/20 bg-violet-500/[0.025]">
      <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-200">Nexus 365 Access Governance</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{readiness?.boundary || "Review provider evidence, name the access owner, then open the existing approval-governed group or privileged-role plan. Nexus never treats inventory as authority to change access."}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} data-testid="cipp-access-governance-refresh">
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Refresh evidence
        </Button>
      </CardContent>
    </Card>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <HeroTile label="Clients" value={readiness ? summary.clients ?? 0 : "—"} icon={Cloud} glow="violet" subtitle="Within your client scope" />
      <HeroTile label="Privileged identities" value={readiness ? summary.privileged_identities ?? 0 : "—"} icon={KeyRound} glow="cyan" subtitle="Provider-recorded evidence" />
      <HeroTile label="Needs review" value={readiness ? summary.attention_required ?? 0 : "—"} icon={AlertTriangle} glow="amber" subtitle="No automated remediation" />
      <HeroTile label="GDAP expiring" value={readiness ? summary.gdap_expiring_30d ?? 0 : "—"} icon={Shield} glow={(summary.gdap_expiring_30d || 0) ? "rose" : "emerald"} subtitle="Within 30 days" />
    </div>

    {loading && !readiness ? <Card><CardContent className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Collecting scoped access evidence…</CardContent></Card>
      : clients.length === 0 ? <Card><CardContent className="space-y-3 py-12 text-center"><KeyRound className="mx-auto h-8 w-8 text-muted-foreground/60" /><p className="text-sm font-medium">No permitted client access records yet</p><p className="mx-auto max-w-xl text-xs leading-5 text-muted-foreground">Connect tenant discovery, map the Microsoft tenant to a Nexus client, then collect verified Microsoft evidence. Nexus will show only clients you are allowed to review.</p><Button variant="outline" size="sm" asChild><Link to="/control-plane?module=microsoft365&view=connections">Open Microsoft connections<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></CardContent></Card>
      : mappedClients.length === 0 ? <Card className="border-amber-500/25 bg-amber-500/[0.035]"><CardContent className="flex flex-col items-center gap-3 p-8 text-center"><div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10"><KeyRound className="h-5 w-5 text-amber-200" /></div><div><p className="text-sm font-semibold">Map a Microsoft tenant before reviewing access</p><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{unmappedClients.length} permitted client{unmappedClients.length === 1 ? " is" : "s are"} visible, but none has a stable Microsoft tenant relationship. Nexus has intentionally withheld privileged-access conclusions until that ownership boundary is proven.</p></div><Button variant="outline" size="sm" asChild><Link to="/control-plane?module=microsoft365&view=connections">Map Microsoft tenants<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></CardContent></Card>
      : <>
        {unmappedClients.length > 0 && <Card className="border-amber-500/20 bg-amber-500/[0.025]"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{unmappedClients.length} client{unmappedClients.length === 1 ? " is" : "s are"} awaiting a Microsoft tenant mapping</p><p className="mt-1 text-xs text-muted-foreground">They are excluded from access-governance conclusions until a stable client-to-tenant relationship is recorded.</p></div><Button size="sm" variant="outline" asChild><Link to="/control-plane?module=microsoft365&view=connections">Review mappings<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></CardContent></Card>}
        {mappedClients.map((client) => {
          const counts = client.access_counts || {};
          const checks = client.checks || [];
          const findings = client.findings || [];
          const gaps = client.evidence_gaps || [];
          const handoffs = Object.fromEntries((client.safe_handoffs || []).map((handoff) => [handoff.key, handoff]));
          return <Card key={client.client_id} className="overflow-hidden border-border/70" data-testid={`cipp-access-governance-${client.client_id}`}><CardContent className="space-y-4 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><p className="font-semibold">{client.client_name}</p><p className="mt-1 text-xs font-mono text-muted-foreground">{client.tenant?.tenant_id || "Microsoft tenant mapping required"}</p></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className={stateClasses[client.state] || stateClasses.evidence_incomplete}>{label(client.state)}</Badge><Button size="sm" variant="outline" asChild><Link to={`/clients?client=${encodeURIComponent(client.client_id)}`}>Open client<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></div></div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><LifecycleMetric label="Privileged identities" value={counts.privileged_identities ?? 0} tone={counts.privileged_identities ? "cyan" : "slate"} /><LifecycleMetric label="Disabled privileged" value={counts.disabled_privileged_identities ?? 0} tone={counts.disabled_privileged_identities ? "amber" : "slate"} /><LifecycleMetric label="Groups" value={counts.groups ?? 0} tone="violet" /><LifecycleMetric label="Guest identities" value={counts.guest_identities ?? 0} tone={counts.stale_guest_identities ? "amber" : "slate"} /><LifecycleMetric label="Role-assignable groups" value={counts.role_assignable_groups ?? 0} tone={counts.role_assignable_groups ? "amber" : "slate"} /></div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{checks.map((check) => <div key={check.key} className="rounded-xl border border-border/60 bg-muted/15 p-3"><div className="flex items-start justify-between gap-2"><p className="text-xs font-medium">{check.label}</p><Badge variant="outline" className={`shrink-0 text-[10px] ${checkClasses[check.state] || checkClasses.not_assessed}`}>{label(check.state)}</Badge></div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{check.detail}</p><p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">Source · {check.source}</p></div>)}</div>

            {(client.role_breakdown || []).length > 0 && <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.025] p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Observed privileged roles</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Role labels are provider evidence only. Nexus does not expose user identities or infer that an assignment is appropriate.</p></div><Badge variant="outline" className="w-fit border-cyan-500/25 text-cyan-100">Read-only evidence</Badge></div><div className="mt-3 flex flex-wrap gap-2">{client.role_breakdown.map((role) => <Badge key={role.role} variant="outline" className="border-cyan-500/20 bg-background/20 text-xs">{role.role} · {role.assignments}</Badge>)}</div></div>}

            {(findings.length > 0 || gaps.length > 0) && <div className={`rounded-xl border p-4 ${findings.length ? "border-amber-500/20 bg-amber-500/[0.035]" : "border-slate-500/20 bg-muted/15"}`}><div className="flex items-center gap-2"><AlertTriangle className={`h-4 w-4 ${findings.length ? "text-amber-200" : "text-slate-300"}`} /><p className="text-xs font-semibold uppercase tracking-[0.16em]">{findings.length ? "Access review queue" : "Evidence gaps"}</p></div><div className="mt-3 space-y-2">{[...findings, ...gaps].slice(0, 5).map((item) => { const handoff = handoffs[item.handoff]; return <div key={item.key} className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/20 p-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p></div>{handoff && <Button size="sm" variant="ghost" asChild><Link to={routeWithClient(handoff.route, client.client_id)} title={handoff.detail}>Review<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>}</div>; })}</div></div>}

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">{(client.safe_handoffs || []).map((handoff) => <Button key={handoff.key} size="sm" variant={handoff.kind === "governed_preview" ? "outline" : "ghost"} asChild><Link to={routeWithClient(handoff.route, client.client_id)} title={handoff.detail}>{handoff.label}<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>)}</div>
            <p className="text-[11px] leading-5 text-muted-foreground">Every hand-off opens an existing governed workspace. This screen itself has not changed Microsoft, CIPP, tickets, subscriptions, invoices or approvals.</p>
          </CardContent></Card>;
        })}
      </>}
  </>;
}

function ChangeIntelligencePanel({ readiness, loading, onRefresh }) {
  const summary = readiness?.summary || {};
  const clients = readiness?.clients || [];
  const mappedClients = clients.filter((client) => client.tenant?.state === "mapped");
  const unmappedClients = clients.filter((client) => client.tenant?.state !== "mapped");
  const stateClasses = {
    ready_for_review: "border-emerald-500/30 text-emerald-200",
    attention_required: "border-amber-500/30 text-amber-200",
    evidence_incomplete: "border-slate-500/30 text-slate-200",
  };
  const observationClasses = {
    available: "border-emerald-500/25 text-emerald-200",
    not_observed: "border-slate-500/25 text-slate-200",
  };
  const label = (value) => String(value || "not_observed").replaceAll("_", " ");
  const routeWithClient = (route, clientId) => {
    const separator = route?.includes("?") ? "&" : "?";
    return `${route || "/control-plane?module=microsoft365&view=connections"}${separator}client=${encodeURIComponent(clientId || "")}`;
  };
  const formatDate = (value) => {
    if (!value) return "Not retained";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not retained" : date.toLocaleString();
  };

  return <>
    <Card className="border-blue-500/20 bg-blue-500/[0.025]">
      <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Nexus 365 Change Intelligence</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{readiness?.boundary || "Show recorded Nexus actions and the freshness of verified Microsoft evidence. Nexus never presents a current snapshot as proof of an historical change."}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} data-testid="cipp-change-intelligence-refresh">
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Refresh evidence
        </Button>
      </CardContent>
    </Card>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <HeroTile label="Clients" value={readiness ? summary.clients ?? 0 : "—"} icon={Cloud} glow="blue" subtitle="Within your client scope" />
      <HeroTile label="Recorded actions" value={readiness ? summary.recorded_actions ?? 0 : "—"} icon={History} glow="cyan" subtitle="Client-bound audit evidence" />
      <HeroTile label="Evidence ready" value={readiness ? summary.ready_for_review ?? 0 : "—"} icon={CheckCircle2} glow="emerald" subtitle="Fresh evidence available" />
      <HeroTile label="Needs attention" value={readiness ? summary.attention_required ?? 0 : "—"} icon={AlertTriangle} glow="amber" subtitle="Mapping or connection review" />
    </div>

    {loading && !readiness ? <Card><CardContent className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Collecting client-scoped change evidence…</CardContent></Card>
      : clients.length === 0 ? <Card><CardContent className="space-y-3 py-12 text-center"><History className="mx-auto h-8 w-8 text-muted-foreground/60" /><p className="text-sm font-medium">No permitted Microsoft client records yet</p><p className="mx-auto max-w-xl text-xs leading-5 text-muted-foreground">Map Microsoft tenants to Nexus clients and collect verified provider evidence. The ledger will only show the clients you are authorised to review.</p><Button variant="outline" size="sm" asChild><Link to="/control-plane?module=microsoft365&view=connections">Open Microsoft connections<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></CardContent></Card>
      : <>
        {unmappedClients.length > 0 && <Card className="border-amber-500/20 bg-amber-500/[0.025]" data-testid="cipp-change-intelligence-mapping-queue"><CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-semibold">{unmappedClients.length} client{unmappedClients.length === 1 ? " is" : "s are"} waiting for a Microsoft tenant mapping</p><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Nexus intentionally keeps these clients out of the detailed Change Intelligence ledger. A client name or domain is never enough to attribute provider history safely.</p><div className="mt-3 flex flex-wrap gap-2">{unmappedClients.slice(0, 8).map((client) => <Badge key={client.client_id} variant="outline" className="border-amber-500/20 text-amber-100">{client.client_name}</Badge>)}{unmappedClients.length > 8 && <Badge variant="outline" className="border-amber-500/20 text-amber-100">+{unmappedClients.length - 8} more</Badge>}</div></div><Button size="sm" variant="outline" asChild><Link to="/control-plane?module=microsoft365&view=connections">Map Microsoft tenants<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></CardContent></Card>}
        {mappedClients.length === 0 ? <Card className="border-slate-500/20 bg-muted/15"><CardContent className="flex flex-col items-center gap-3 p-10 text-center"><div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-500/25 bg-muted/40"><History className="h-5 w-5 text-slate-300" /></div><div><p className="text-sm font-semibold">Map the first Microsoft tenant to start a trustworthy ledger</p><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Once a stable client-to-tenant relationship and verified Microsoft connection exist, Nexus can present retained action evidence alongside the freshness of the provider inventory.</p></div><Button size="sm" variant="outline" asChild><Link to="/control-plane?module=microsoft365&view=connections">Open Microsoft connections<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></CardContent></Card> : mappedClients.map((client) => {
        const events = client.events || [];
        const observations = client.observation_freshness || [];
        const gaps = client.evidence_gaps || [];
        return <Card key={client.client_id} className="overflow-hidden border-border/70" data-testid={`cipp-change-intelligence-${client.client_id}`}><CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><p className="font-semibold">{client.client_name}</p><p className="mt-1 text-xs font-mono text-muted-foreground">{client.tenant?.tenant_id || "Microsoft tenant mapping required"}</p></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className={stateClasses[client.state] || stateClasses.evidence_incomplete}>{label(client.state)}</Badge><Button size="sm" variant="outline" asChild><Link to={`/clients?client=${encodeURIComponent(client.client_id)}`}>Open client<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></div></div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><LifecycleMetric label="Tenant connection" value={label(client.connection?.state)} tone={client.connection?.state === "verified" ? "emerald" : "amber"} /><LifecycleMetric label="Recorded actions" value={client.change_evidence?.recorded_actions ?? 0} tone={(client.change_evidence?.recorded_actions || 0) ? "cyan" : "slate"} /><LifecycleMetric label="Fresh categories" value={observations.filter((item) => item.state === "available").length} tone={observations.some((item) => item.state === "available") ? "emerald" : "slate"} /><LifecycleMetric label="Last action" value={client.change_evidence?.latest_recorded_at ? formatDate(client.change_evidence.latest_recorded_at) : "Not retained"} tone="violet" /></div>

          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{observations.map((observation) => <div key={observation.key} className="rounded-xl border border-border/60 bg-muted/15 p-3"><div className="flex items-start justify-between gap-2"><p className="text-xs font-medium">{observation.label}</p><Badge variant="outline" className={`shrink-0 text-[10px] ${observationClasses[observation.state] || observationClasses.not_observed}`}>{label(observation.state)}</Badge></div><p className="mt-2 text-xs font-semibold">{observation.records} retained</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{observation.latest_observed_at ? `Last observed · ${formatDate(observation.latest_observed_at)}` : "No dated provider observation retained"}</p></div>)}</div>

          <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.025] p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Recorded change ledger</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Only client-bound Nexus audit entries appear here. A provider refresh confirms freshness, not an unrecorded historical change.</p></div><Badge variant="outline" className="w-fit border-cyan-500/25 text-cyan-100">{client.change_evidence?.state === "available" ? "Recorded evidence" : "No retained actions"}</Badge></div>{events.length === 0 ? <p className="mt-3 rounded-lg border border-border/50 bg-background/20 p-3 text-xs leading-5 text-muted-foreground">No client-bound Microsoft action has been retained for this current mapping. That is not proof that no external change occurred.</p> : <div className="mt-3 space-y-2">{events.map((event) => <div key={event.event_id} className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/20 p-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium">{event.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{event.detail}</p></div><div className="flex shrink-0 flex-wrap items-center gap-2"><Badge variant="outline" className="text-[10px]">{formatDate(event.occurred_at)}</Badge>{event.actor_recorded && <Badge variant="outline" className="text-[10px] text-slate-200">Actor audited</Badge>}{event.correlation_recorded && <Badge variant="outline" className="text-[10px] text-slate-200">Correlated</Badge>}</div></div>)}</div>}</div>

          {gaps.length > 0 && <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.035] p-4"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-200" /><p className="text-xs font-semibold uppercase tracking-[0.16em]">Evidence limits</p></div><div className="mt-3 space-y-2">{gaps.map((gap) => <div key={gap.key} className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/20 p-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium">{gap.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{gap.detail}</p></div><Button size="sm" variant="ghost" asChild><Link to={routeWithClient((client.safe_handoffs || []).find((handoff) => handoff.key === gap.handoff)?.route, client.client_id)}>Review<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button></div>)}</div></div>}

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">{(client.safe_handoffs || []).map((handoff) => <Button key={handoff.key} size="sm" variant={handoff.kind === "configuration_review" ? "outline" : "ghost"} asChild><Link to={routeWithClient(handoff.route, client.client_id)} title={handoff.detail}>{handoff.label}<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>)}</div>
          <p className="text-[11px] leading-5 text-muted-foreground">This ledger has not changed Microsoft, CIPP, tickets, approvals, subscriptions, invoices or policy state.</p>
        </CardContent></Card>;
        })}
      </>}
  </>;
}

function TenantAccessBadge({ status, compact = false }) {
  const size = compact ? "px-1.5 py-0 text-[9px]" : "text-[10px]";
  if (status === "connected") {
    return <Badge variant="outline" className={`shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-200 ${size}`}>Ready</Badge>;
  }
  if (status === "consent_required") {
    return <Badge variant="outline" className={`shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-200 ${size}`}>Consent</Badge>;
  }
  if (status === "gdap_required") {
    return <Badge variant="outline" className={`shrink-0 border-cyan-500/30 bg-cyan-500/10 text-cyan-200 ${size}`}>GDAP</Badge>;
  }
  return <Badge variant="outline" className={`shrink-0 border-zinc-700 text-muted-foreground ${size}`}>Pending</Badge>;
}

function TenantReadinessPanel({ tenant }) {
  const checks = [
    {
      label: "Tenant discovered",
      complete: true,
      detail: `Source: ${String(tenant.source || "manual").replaceAll("_", " ")}`,
    },
    {
      label: "Nexus client mapped",
      complete: Boolean(tenant.mapped),
      detail: tenant.clientName || (tenant.mapped ? "Client mapping retained" : "Choose Map client above"),
    },
    {
      label: "Microsoft access verified",
      complete: tenant.accessStatus === "connected",
      detail: tenant.accessStatus === "consent_required"
        ? "Customer administrator consent is still required"
        : tenant.accessStatus === "gdap_required"
          ? "A least-privilege GDAP relationship is still required"
          : "Waiting for verified Microsoft Graph evidence",
    },
    {
      label: "Operational provider ready",
      complete: Boolean(tenant.providerOperational),
      detail: "Required before Nexus reads users, licences or submits tenant changes",
    },
  ];
  const next = checks.find((item) => !item.complete);

  return (
    <div className="space-y-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.035] p-4" data-testid="tenant-readiness-panel">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-200" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Tenant operations are safely locked</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Nexus has retained the tenant record, but it will not show fabricated users or enable identity changes until client ownership and Microsoft access are verified.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/control-plane?module=microsoft365&view=connections">Resolve access</Link>
        </Button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {checks.map((item) => (
          <div key={item.label} className="flex gap-2 rounded-lg border border-border/70 bg-black/10 p-3">
            {item.complete
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}
            <div>
              <p className="text-xs font-medium">{item.label}</p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
      {next && <p className="text-xs text-amber-100"><span className="font-semibold">Next action:</span> {next.detail}.</p>}
    </div>
  );
}

function CippHygienePanel() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const [d, h] = await Promise.all([
        axios.get(`${API}/cipp/hygiene-digest`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/cipp/digests`, { headers }).catch(() => ({ data: [] })),
      ]);
      setDigest(d.data);
      setHistory(h.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const sendDigest = async () => {
    setSending(true);
    try {
      const res = await axios.post(`${API}/cipp/hygiene-digest/send`, {}, { headers });
      if (res.data?.sent) toast.success(`Digest sent via ${res.data.sent_via}`);
      else toast.warning(res.data?.reason || res.data?.error || "Digest saved but not emailed (Microsoft 365 is not connected)");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setSending(false); }
  };

  if (loading) return <Card><CardContent className="p-8 text-center text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin inline" />Computing hygiene digest…</CardContent></Card>;
  if (!digest?.configured) {
    return (
      <Card className="border-amber-500/25 bg-amber-500/[0.04]">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10">
            <Shield className="h-4 w-4 text-amber-200" />
          </div>
          <div>
            <p className="text-sm font-semibold">Security posture is waiting for verified Microsoft evidence</p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Connect tenant discovery, map the customer, and verify GDAP or customer-admin access. Nexus will not estimate posture or invent a hygiene score.</p>
          </div>
          <Button variant="outline" size="sm" asChild><Link to="/control-plane?module=microsoft365&view=connections">Review Microsoft connections</Link></Button>
        </CardContent>
      </Card>
    );
  }

  const rows = digest.clients || [];
  const scored = rows.filter(r => typeof r.score === "number");

  return (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-muted-foreground">
          Generated {new Date(digest.generated_at).toLocaleString()} · {digest.total_tenants} tenants analysed · avg {digest.avg_score}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} data-testid="cipp-digest-refresh"><RefreshCw className="w-3 h-3 mr-1" />Recompute</Button>
          <Button size="sm" variant="outline" className="text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10" onClick={sendDigest} disabled={sending} data-testid="cipp-digest-send">
            {sending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}Send digest
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Verified avg</div><div className="text-2xl font-semibold" data-testid="cipp-digest-avg">{digest.avg_score ?? "—"}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Tenants</div><div className="text-2xl font-semibold">{digest.total_tenants}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground text-rose-400">Critical (&lt;50)</div><div className="text-2xl font-semibold text-rose-400">{digest.critical_count}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground text-amber-400">Upsell candidates</div><div className="text-2xl font-semibold text-amber-400">{digest.upsell_candidates?.length || 0}</div></CardContent></Card>
      </div>

      {digest.upsell_candidates?.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-amber-400" />
              <span className="font-medium text-sm">Upsell opportunities</span>
              <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">{digest.upsell_candidates.length}</Badge>
            </div>
            <div className="text-[11px] text-muted-foreground mb-3">Clients with license waste, unlicensed users, or weak MFA posture — ideal targets for a Security Posture bundle.</div>
            <div className="space-y-2">
              {digest.upsell_candidates.map((c) => (
                <div key={c.client_id} className="flex items-start gap-3 p-2 rounded border border-amber-500/20 bg-amber-500/5" data-testid={`cipp-upsell-${c.client_id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{c.client_name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{c.tenant_display || c.tenant_domain}</div>
                    <ul className="text-[11px] text-amber-300 mt-1 space-y-0.5">
                      {(c.top_risks || []).map((r, i) => <li key={i}>• {r}</li>)}
                    </ul>
                  </div>
                  <Badge variant="outline" className="text-amber-400 border-amber-500/30">Score {c.score}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-2 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">All tenants ({scored.length})</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase">Client</TableHead>
                <TableHead className="text-[10px] uppercase">Verified score</TableHead>
                <TableHead className="text-[10px] uppercase">Grade</TableHead>
                <TableHead className="text-[10px] uppercase">Active users</TableHead>
                <TableHead className="text-[10px] uppercase">MFA</TableHead>
                <TableHead className="text-[10px] uppercase">Top risks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.client_id} data-testid={`cipp-digest-row-${r.client_id}`}>
                  <TableCell>
                    <div className="text-sm font-medium">{r.client_name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{r.tenant_display}</div>
                  </TableCell>
                  <TableCell>
                    {r.score == null ? <span className="text-xs text-amber-300">{r.evidence_coverage_pct ? `partial (${r.evidence_coverage_pct}% evidence)` : "unassessed"}</span> : (
                      <Badge variant="outline" className={r.score >= 75 ? "text-emerald-400 border-emerald-500/30" : r.score >= 50 ? "text-amber-400 border-amber-500/30" : "text-rose-400 border-rose-500/30"}>
                        {r.score}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{r.grade || "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{r.counts?.enabled_users ?? "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{r.counts?.mfa_coverage_pct != null ? `${r.counts.mfa_coverage_pct}%` : "—"}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground max-w-md">
                    {(r.top_risks || []).slice(0, 2).map((x, i) => <div key={i}>• {x}</div>)}
                    {!r.top_risks?.length && <span className="text-emerald-400">healthy</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-2 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Digest history</div>
            <Table>
              <TableHeader><TableRow><TableHead className="text-[10px] uppercase">When</TableHead><TableHead className="text-[10px] uppercase">Avg</TableHead><TableHead className="text-[10px] uppercase">Critical</TableHead><TableHead className="text-[10px] uppercase">Sent to</TableHead><TableHead className="text-[10px] uppercase">Via</TableHead></TableRow></TableHeader>
              <TableBody>
                {history.map((h, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-[10px] font-mono">{new Date(h.generated_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs font-mono">{h.avg_score}</TableCell>
                    <TableCell className="text-xs font-mono">{h.critical_count}</TableCell>
                    <TableCell className="text-xs font-mono">{(h.to || []).join(", ") || "—"}</TableCell>
                    <TableCell className="text-xs">{h.sent_via || <span className="text-amber-400">not sent</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
