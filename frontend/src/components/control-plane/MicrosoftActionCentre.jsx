import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  ExternalLink,
  FileCheck2,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  UserRoundCog,
  XCircle,
} from "lucide-react";

import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const ACTION_ICONS = {
  "reset-password": KeyRound,
  "reset-mfa": ShieldCheck,
  "block-sign-in": ShieldAlert,
  "change-licences": UserRoundCog,
  "manage-group-access": UserRoundCog,
  "manage-privileged-role": ShieldAlert,
  "manage-mailbox-access": Mail,
  "retire-managed-device": ShieldAlert,
  "manage-conditional-access": ShieldCheck,
  "create-user": UserPlus,
  "offboard-user": LockKeyhole,
};

const IMPACT_STYLES = {
  low: "border-sky-500/25 bg-sky-500/10 text-sky-200",
  medium: "border-cyan-500/25 bg-cyan-500/10 text-cyan-200",
  high: "border-amber-500/25 bg-amber-500/10 text-amber-200",
  critical: "border-rose-500/25 bg-rose-500/10 text-rose-200",
};

const ACTION_CATEGORIES = {
  "reset-password": "Identity",
  "reset-mfa": "Identity",
  "block-sign-in": "Identity",
  "change-licences": "Commercial",
  "create-user": "Identity",
  "offboard-user": "Identity",
  "manage-group-access": "Access",
  "manage-privileged-role": "Access",
  "manage-mailbox-access": "Collaboration",
  "retire-managed-device": "Endpoints",
  "manage-conditional-access": "Security",
};

const EMPTY_FORM = {
  tenant_id: "",
  target_id: "",
  reason: "",
  ticket_id: "",
  change_reference: "",
  options: {},
};

function formatWhen(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

function defaultOptions(action) {
  return (action?.fields || []).reduce((result, field) => {
    result[field.key] = field.default || "";
    return result;
  }, {});
}

function sourceLabel(value) {
  return {
    partner_center: "Partner Center",
    manual: "Individual tenant",
    m365_graph: "Microsoft Graph",
    m365_partner_center: "Partner telemetry",
    existing_client_link: "Existing client link",
    verified_provider: "Verified provider",
    cipp: "Tenant adapter",
  }[value] || "Microsoft tenant";
}

export default function MicrosoftActionCentre() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [params, setParams] = useSearchParams();
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tenantUsers, setTenantUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [tenantGroups, setTenantGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [actionCategory, setActionCategory] = useState("All");
  const [planDetail, setPlanDetail] = useState(null);
  const handledAction = useRef("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await axios.get(`${API}/control-plane/microsoft/readiness`, { headers });
      setReadiness(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Microsoft action readiness could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [headers, token]);

  useEffect(() => {
    load();
  }, [load]);

  const openAction = useCallback((action) => {
    handledAction.current = action.id;
    setSelected(action);
    setForm((current) => ({
      ...EMPTY_FORM,
      tenant_id: current.tenant_id || readiness?.tenants?.find((tenant) => tenant.action_ready)?.id || readiness?.tenants?.[0]?.id || "",
      options: defaultOptions(action),
    }));
    setPreview(null);
    const updated = new URLSearchParams(params);
    updated.set("module", "microsoft365");
    updated.set("view", "actions");
    updated.set("action", action.id);
    setParams(updated, { replace: true });
  }, [params, readiness?.tenants, setParams]);

  useEffect(() => {
    const requestedAction = params.get("action");
    if (!requestedAction) {
      handledAction.current = "";
      return;
    }
    if (!readiness?.actions?.length || selected || handledAction.current === requestedAction) return;
    const action = readiness.actions.find((item) => item.id === requestedAction);
    if (action) openAction(action);
  }, [openAction, params, readiness?.actions, selected]);

  const closeAction = () => {
    setSelected(null);
    setPreview(null);
    const updated = new URLSearchParams(params);
    updated.delete("action");
    setParams(updated, { replace: true });
  };

  const updateOption = (key, value) => {
    setForm((current) => ({
      ...current,
      options: { ...current.options, [key]: value },
    }));
    setPreview(null);
  };

  const buildPreview = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await axios.post(
        `${API}/control-plane/microsoft/actions/preview`,
        { action_id: selected.id, ...form },
        { headers },
      );
      setPreview(response.data);
      if (response.data.blocks?.length) {
        toast.warning("Preview created with readiness gates to resolve");
      } else {
        toast.success("Safe preview created — no Microsoft change has been run");
      }
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "The action preview could not be created");
    } finally {
      setBusy(false);
    }
  };

  const submitPlan = async () => {
    if (!preview?.id) return;
    setBusy(true);
    try {
      const response = await axios.post(
        `${API}/control-plane/microsoft/actions/${preview.id}/submit`,
        {},
        { headers },
      );
      toast.success(response.data.message);
      closeAction();
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "The action plan could not be submitted");
    } finally {
      setBusy(false);
    }
  };

  const provider = readiness?.provider || {};
  const summary = readiness?.summary || {};
  const selectedTenant = (readiness?.tenants || []).find((tenant) => tenant.id === form.tenant_id);
  const filteredTenantUsers = useMemo(() => {
    const query = form.target_id.trim().toLowerCase();
    if (!query) return tenantUsers.slice(0, 8);
    return tenantUsers.filter((user) => (
      String(user.displayName || "").toLowerCase().includes(query)
      || String(user.userPrincipalName || "").toLowerCase().includes(query)
    )).slice(0, 8);
  }, [form.target_id, tenantUsers]);
  const filteredTenantGroups = useMemo(() => {
    const query = String(form.options?.group_identifier || "").trim().toLowerCase();
    if (!query) return tenantGroups.slice(0, 8);
    return tenantGroups.filter((group) => (
      String(group.display_name || group.displayName || "").toLowerCase().includes(query)
      || String(group.mail || "").toLowerCase().includes(query)
      || String(group.id || "").toLowerCase().includes(query)
    )).slice(0, 8);
  }, [form.options?.group_identifier, tenantGroups]);
  const visibleActions = useMemo(() => (readiness?.actions || []).filter((action) => (
    actionCategory === "All" || (ACTION_CATEGORIES[action.id] || "Other") === actionCategory
  )), [actionCategory, readiness?.actions]);
  const actionCategories = useMemo(() => ["All", ...Array.from(new Set((readiness?.actions || []).map((action) => ACTION_CATEGORIES[action.id] || "Other")))], [readiness?.actions]);

  useEffect(() => {
    if (!selected || selected.target !== "user" || !selectedTenant?.action_ready || provider.execution_provider !== "cipp") {
      setTenantUsers([]);
      return;
    }
    let cancelled = false;
    setUsersLoading(true);
    axios.get(`${API}/cipp/tenants/${selectedTenant.id}/users`, { headers })
      .then((response) => {
        if (!cancelled) setTenantUsers(response.data || []);
      })
      .catch(() => {
        if (!cancelled) setTenantUsers([]);
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => { cancelled = true; };
  }, [headers, provider.execution_provider, selected, selectedTenant?.action_ready, selectedTenant?.id]);

  useEffect(() => {
    if (!selected || selected.id !== "manage-group-access" || !selectedTenant?.action_ready) {
      setTenantGroups([]);
      return;
    }
    let cancelled = false;
    setGroupsLoading(true);
    axios.get(`${API}/m365/groups`, { headers, params: { tenant_id: selectedTenant.id } })
      .then((response) => {
        if (!cancelled) setTenantGroups(response.data || []);
      })
      .catch(() => {
        if (!cancelled) setTenantGroups([]);
      })
      .finally(() => {
        if (!cancelled) setGroupsLoading(false);
      });
    return () => { cancelled = true; };
  }, [headers, selected, selectedTenant?.action_ready, selectedTenant?.id]);

  if (loading && !readiness) {
    return (
      <Card>
        <CardContent className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-cyan-300" />
          Inspecting Microsoft action readiness…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="microsoft-action-centre">
      <Card className="overflow-hidden border-cyan-500/20 bg-gradient-to-r from-cyan-500/[0.07] via-card to-emerald-500/[0.04]">
        <CardContent className="grid gap-4 p-5 xl:grid-cols-[1.15fr_0.85fr] xl:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-100">
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                Governed operations
              </Badge>
              <Badge variant="outline" className={provider.configured ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}>
                {provider.configured ? "Provider configured" : "Setup required"}
              </Badge>
            </div>
            <h3 className="mt-3 text-lg font-semibold">Microsoft Action Centre</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Preview identity and licence changes, verify client scope, attach service evidence, and route protected work for approval before anything reaches Microsoft.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
            <ReadinessStat label="Tenants" value={summary.tenants ?? 0} />
            <ReadinessStat label="Client-linked" value={summary.linked_clients ?? 0} />
            <ReadinessStat label="Action-ready" value={summary.execution_ready_tenants ?? 0} />
            <ReadinessStat label="Awaiting approval" value={summary.pending_approvals ?? 0} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-muted/[0.12]" data-testid="microsoft-action-workflow">
        <CardContent className="grid gap-3 p-4 md:grid-cols-3">
          <ActionWorkflowStep
            number="01"
            icon={FileCheck2}
            title="Prepare a safe preview"
            description="Choose the verified tenant, target and business reason. Nexus checks role, client ownership, provider access and required evidence."
          />
          <ActionWorkflowStep
            number="02"
            icon={ClipboardCheck}
            title="Review the change plan"
            description="See the intended outcome, readiness gates and rollback notes before a request is retained or routed for approval."
          />
          <ActionWorkflowStep
            number="03"
            icon={ShieldCheck}
            title="Execute with an audit trail"
            description="Only a connected, authorised provider can perform approved work. The plan stays linked to its tenant, client and service evidence."
          />
        </CardContent>
      </Card>

      {(!provider.configured || !provider.execution_provider) && (
        <Card className="border-amber-500/25 bg-amber-500/[0.045]">
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-200" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {provider.configured ? "Tenant discovery is connected; action access is still gated" : "Connect Microsoft before running tenant work"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {provider.configured
                  ? "Partner Center can discover customer tenants, but it does not grant customer-tenant write access. Verify GDAP or customer consent and connect a supported action adapter before submission."
                  : "Actions remain available for review, but Nexus will block submission until a provider is configured, verified, and linked to the owning client."}
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/control-plane?module=microsoft365&view=connections">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Resolve Microsoft access
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/70 bg-muted/[0.12]">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold">Choose a governed workflow</p><p className="mt-0.5 text-xs text-muted-foreground">Every workflow starts with a non-mutating preview and shows its impact before it can be submitted.</p></div>
          <div className="flex flex-wrap gap-1.5" data-testid="microsoft-action-categories">
            {actionCategories.map((category) => <Button key={category} type="button" size="sm" variant={actionCategory === category ? "default" : "outline"} className="h-8" onClick={() => setActionCategory(category)}>{category}</Button>)}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleActions.map((action) => {
          const Icon = ACTION_ICONS[action.id] || Cloud;
          return (
            <Card key={action.id} className="group overflow-hidden border-border/70 bg-card/80 transition hover:border-cyan-500/30 hover:bg-cyan-500/[0.025]">
              <CardContent className="flex h-full flex-col p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/[0.07]">
                    <Icon className="h-4 w-4 text-cyan-200" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{action.label}</p>
                      <Badge variant="outline" className={IMPACT_STYLES[action.impact] || IMPACT_STYLES.medium}>
                        {action.impact}
                      </Badge>
                      <Badge variant="outline" className="border-border/70 text-[9px] text-muted-foreground">
                        {ACTION_CATEGORIES[action.id] || "Other"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.description}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant="outline" className={action.allowed ? "border-emerald-500/25 text-emerald-200" : "border-rose-500/25 text-rose-200"}>
                    {action.allowed ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
                    {action.allowed ? "Permitted" : "Role restricted"}
                  </Badge>
                  {action.approval_required && (
                    <Badge variant="outline" className="border-amber-500/25 text-amber-200">
                      <ClipboardCheck className="mr-1 h-3 w-3" />
                      Approval
                    </Badge>
                  )}
                </div>
                <div className="mt-auto pt-4">
                  <Button className="w-full justify-between" variant="outline" onClick={() => openAction(action)} disabled={!action.allowed} data-testid={`microsoft-action-${action.id}`}>
                    {action.allowed ? "Preview workflow" : "Permission required"}
                    <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Recent Microsoft plans</CardTitle>
            <CardDescription>Previews, approval requests, and execution-ready plans retained for audit.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {(readiness?.recent_plans || []).map((plan) => (
            <button key={plan.id} type="button" onClick={() => setPlanDetail(plan)} className="flex w-full flex-col gap-3 rounded-xl border border-border/70 bg-muted/15 p-3 text-left transition hover:border-cyan-500/30 hover:bg-cyan-500/[0.035] md:flex-row md:items-center">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06]">
                <FileCheck2 className="h-4 w-4 text-cyan-200" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{plan.action_label}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {plan.client_name || plan.tenant_id} · {plan.target_id || "Tenant scoped"} · {plan.created_by_name}
                </p>
              </div>
              <div className="text-left md:text-right">
                <Badge variant="outline" className={plan.status === "blocked" ? "border-rose-500/25 text-rose-200" : plan.status === "pending_approval" ? "border-amber-500/25 text-amber-200" : "border-emerald-500/25 text-emerald-200"}>
                  {(plan.status || "previewed").replaceAll("_", " ")}
                </Badge>
                <p className="mt-1 text-[11px] text-muted-foreground">{formatWhen(plan.created_at)}</p>
              </div>
            </button>
          ))}
          {!readiness?.recent_plans?.length && (
            <div className="py-10 text-center">
              <FileCheck2 className="mx-auto h-7 w-7 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No Microsoft action plans yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Start with a safe preview; Nexus will not run a change from this step.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!planDetail} onOpenChange={(open) => !open && setPlanDetail(null)}>
        <DialogContent className="max-h-[86vh] max-w-2xl overflow-y-auto" data-testid="microsoft-action-plan-detail">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={IMPACT_STYLES[planDetail?.impact] || IMPACT_STYLES.medium}>{planDetail?.impact || "planned"} impact</Badge><Badge variant="outline" className={planDetail?.status === "blocked" ? "border-rose-500/25 text-rose-200" : planDetail?.status === "pending_approval" ? "border-amber-500/25 text-amber-200" : "border-emerald-500/25 text-emerald-200"}>{String(planDetail?.status || "previewed").replaceAll("_", " ")}</Badge></div>
            <DialogTitle className="mt-3">{planDetail?.action_label || "Microsoft action plan"}</DialogTitle>
            <DialogDescription>Retained Nexus action evidence. Viewing this record does not run or approve a Microsoft change.</DialogDescription>
          </DialogHeader>
          {planDetail && <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2"><AuditField label="Tenant" value={planDetail.tenant_name || planDetail.tenant_id} /><AuditField label="Client" value={planDetail.client_name || "No client recorded"} /><AuditField label="Target" value={planDetail.target_id || "Tenant scoped"} /><AuditField label="Requested by" value={planDetail.created_by_name || "Not recorded"} /><AuditField label="Service ticket" value={planDetail.ticket_id || "Not linked"} /><AuditField label="Change reference" value={planDetail.change_reference || "Not linked"} /></div>
            <div className="rounded-xl border border-border/70 bg-muted/15 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Technician reason</p><p className="mt-1.5 text-xs leading-5">{planDetail.reason || "No reason was retained."}</p></div>
            {!!planDetail.option_summary?.length && <div className="rounded-xl border border-border/70 bg-muted/15 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Reviewed options</p><div className="mt-2 space-y-1.5">{planDetail.option_summary.map((option) => <div key={option.key} className="flex gap-3 text-xs"><span className="min-w-36 text-muted-foreground">{option.label}</span><span className="font-medium">{option.display_value || option.value}</span></div>)}</div></div>}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-200">Rollback boundary</p><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{planDetail.rollback_plan || "No rollback guidance retained."}</p></div>
            <p className="text-[11px] text-muted-foreground">Created {formatWhen(planDetail.created_at)}{planDetail.preview_expires_at ? ` · Preview expiry ${formatWhen(planDetail.preview_expires_at)}` : ""}</p>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setPlanDetail(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selected} onOpenChange={(open) => !open && closeAction()}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto border-cyan-500/20 p-0" data-testid="microsoft-action-dialog">
          <DialogHeader className="border-b border-border/70 bg-gradient-to-r from-cyan-500/[0.08] via-card to-emerald-500/[0.04] px-6 py-5 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={IMPACT_STYLES[selected?.impact] || IMPACT_STYLES.medium}>{selected?.impact} impact</Badge>
              {selected?.approval_required && <Badge variant="outline" className="border-amber-500/25 text-amber-200">Approval required</Badge>}
              <Badge variant="outline" className="border-cyan-500/25 text-cyan-100">Simulation first</Badge>
            </div>
            <DialogTitle className="mt-3 text-xl">{selected?.label}</DialogTitle>
            <DialogDescription className="max-w-2xl leading-6">{selected?.description}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 px-6 py-5 xl:grid-cols-[1fr_0.9fr]">
            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-muted/15 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Target and evidence</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <Label>Microsoft tenant *</Label>
                    <Select value={form.tenant_id} onValueChange={(value) => { setForm({ ...form, tenant_id: value, target_id: "" }); setPreview(null); setUserMenuOpen(false); }}>
                      <SelectTrigger className="mt-1.5" data-testid="microsoft-action-tenant">
                        <SelectValue placeholder="Select a linked tenant" />
                      </SelectTrigger>
                      <SelectContent>
                        {(readiness?.tenants || []).map((tenant) => (
                          <SelectItem key={tenant.id} value={tenant.id}>
                            {tenant.name}{tenant.client_name ? ` · ${tenant.client_name}` : ""}{tenant.action_ready ? " · Ready" : " · Setup required"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!readiness?.tenants?.length && <p className="mt-1.5 text-xs text-amber-300">No client-linked Microsoft tenants are available yet.</p>}
                    {selectedTenant && (
                      <div className="mt-2 rounded-lg border border-border/70 bg-black/10 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={selectedTenant.mapped ? "border-emerald-500/25 text-emerald-200" : "border-amber-500/25 text-amber-200"}>
                            {selectedTenant.mapped ? "Client mapped" : "Mapping required"}
                          </Badge>
                          <Badge variant="outline" className={selectedTenant.provider_reachable ? "border-emerald-500/25 text-emerald-200" : "border-amber-500/25 text-amber-200"}>
                            {selectedTenant.provider_reachable ? "Tenant access verified" : (selectedTenant.access_status || "Access required").replaceAll("_", " ")}
                          </Badge>
                          <Badge variant="outline" className="border-cyan-500/25 text-cyan-100">{sourceLabel(selectedTenant.source)}</Badge>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          {selectedTenant.action_ready
                            ? `${selectedTenant.client_name} is ready for governed Microsoft action planning.`
                            : selectedTenant.readiness_reasons?.join(" · ") || "Complete tenant onboarding before submitting a plan."}
                        </p>
                        {!selectedTenant.action_ready && (
                          <Button variant="link" size="sm" className="mt-1 h-auto px-0 text-cyan-200" asChild>
                            <Link to="/control-plane?module=microsoft365&view=tenant-operations">Resolve tenant readiness <ArrowRight className="ml-1 h-3 w-3" /></Link>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {(selected?.target === "user" || selected?.target === "device") && (
                    <div className="relative">
                      <Label>{selected?.target === "device" ? "Intune managed-device ID, serial or provider ID *" : "User principal name or provider user ID *"}</Label>
                      <Input
                        className="mt-1.5"
                        value={form.target_id}
                        onChange={(event) => { setForm({ ...form, target_id: event.target.value }); setPreview(null); if (selected?.target === "user") setUserMenuOpen(true); }}
                        onFocus={() => selected?.target === "user" && setUserMenuOpen(true)}
                        onBlur={() => selected?.target === "user" && window.setTimeout(() => setUserMenuOpen(false), 120)}
                        placeholder={selected?.target === "device" ? "Enter the exact verified Intune device ID or serial" : usersLoading ? "Loading tenant users…" : "Search name, UPN, or enter provider user ID"}
                        data-testid="microsoft-action-target"
                      />
                      {selected?.target === "user" && userMenuOpen && !!filteredTenantUsers.length && (
                        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-2xl">
                          {filteredTenantUsers.map((user) => (
                            <button
                              key={user.id || user.userPrincipalName}
                              type="button"
                              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-cyan-500/10"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setForm({ ...form, target_id: user.id || user.userPrincipalName });
                                setPreview(null);
                                setUserMenuOpen(false);
                              }}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">{user.displayName || user.userPrincipalName}</span>
                                <span className="block truncate text-xs text-muted-foreground">{user.userPrincipalName}</span>
                              </span>
                              <Badge variant="outline" className={user.accountEnabled === false ? "border-rose-500/25 text-rose-200" : "border-emerald-500/25 text-emerald-200"}>
                                {user.accountEnabled === false ? "Blocked" : "Active"}
                              </Badge>
                            </button>
                          ))}
                        </div>
                      )}
                      {selected?.target === "user" && !usersLoading && selectedTenant?.action_ready && !tenantUsers.length && (
                        <p className="mt-1.5 text-xs text-muted-foreground">No provider-backed users were returned. A verified provider ID can still be entered manually.</p>
                      )}
                      {selected?.target === "device" && <p className="mt-1.5 text-xs text-muted-foreground">Use the exact provider-recorded Intune device identifier. Nexus will re-check provider evidence immediately before execution.</p>}
                    </div>
                  )}

                  {!!selected?.fields?.length && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selected.fields.map((field) => (
                        <div key={field.key} className={field.key === "display_name" || field.key === "user_principal_name" || field.key === "group_identifier" ? "sm:col-span-2" : ""}>
                          <Label>{field.label}{field.required ? " *" : ""}</Label>
                          {field.key === "group_identifier" ? (
                            <div className="relative">
                              <Input
                                className="mt-1.5"
                                value={form.options?.group_identifier || ""}
                                onChange={(event) => { updateOption("group_identifier", event.target.value); setGroupMenuOpen(true); }}
                                onFocus={() => setGroupMenuOpen(true)}
                                onBlur={() => window.setTimeout(() => setGroupMenuOpen(false), 120)}
                                placeholder={groupsLoading ? "Loading verified Microsoft groups…" : field.placeholder}
                                data-testid="microsoft-action-option-group_identifier"
                              />
                              {groupMenuOpen && !!filteredTenantGroups.length && (
                                <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-2xl">
                                  {filteredTenantGroups.map((group) => (
                                    <button key={group.id} type="button" className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-cyan-500/10" onMouseDown={(event) => event.preventDefault()} onClick={() => { updateOption("group_identifier", group.id); setGroupMenuOpen(false); }}>
                                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{group.display_name || group.displayName || group.id}</span><span className="block truncate text-xs text-muted-foreground">{group.mail || group.id}</span></span>
                                      <Badge variant="outline" className="border-cyan-500/25 text-cyan-100">Verified</Badge>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {!groupsLoading && selectedTenant?.action_ready && !tenantGroups.length && <p className="mt-1.5 text-xs text-muted-foreground">No provider-recorded groups are available yet. Enter an existing group ID only after verifying it in Microsoft.</p>}
                            </div>
                          ) : field.type === "select" ? (
                            <Select value={form.options?.[field.key] || field.default || ""} onValueChange={(value) => updateOption(field.key, value)}>
                              <SelectTrigger className="mt-1.5" data-testid={`microsoft-action-option-${field.key}`}>
                                <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                              </SelectTrigger>
                              <SelectContent>
                                {(field.options || []).map((option) => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              className="mt-1.5"
                              type={field.type || "text"}
                              value={form.options?.[field.key] || ""}
                              onChange={(event) => updateOption(field.key, event.target.value)}
                              placeholder={field.placeholder}
                              data-testid={`microsoft-action-option-${field.key}`}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <Label>Technician reason *</Label>
                    <Textarea className="mt-1.5 min-h-24" value={form.reason} onChange={(event) => { setForm({ ...form, reason: event.target.value }); setPreview(null); }} placeholder="Why is this action required, and what outcome is expected?" data-testid="microsoft-action-reason" />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Related ticket</Label>
                      <Input className="mt-1.5" value={form.ticket_id} onChange={(event) => { setForm({ ...form, ticket_id: event.target.value }); setPreview(null); }} placeholder="Ticket ID or number" />
                    </div>
                    <div>
                      <Label>Change reference</Label>
                      <Input className="mt-1.5" value={form.change_reference} onChange={(event) => { setForm({ ...form, change_reference: event.target.value }); setPreview(null); }} placeholder="Change or CAB reference" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-muted/15 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Planned workflow</p>
                <div className="mt-4 space-y-3">
                  {(selected?.steps || []).map((step, index) => (
                    <div key={step} className="flex gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 text-[11px] font-semibold text-cyan-100">{index + 1}</div>
                      <p className="pt-0.5 text-xs leading-5 text-muted-foreground">{step}</p>
                    </div>
                  ))}
                </div>
              </div>

              {preview && (
                <div className={`rounded-xl border p-4 ${preview.blocks?.length ? "border-amber-500/25 bg-amber-500/[0.045]" : "border-emerald-500/25 bg-emerald-500/[0.045]"}`}>
                  <div className="flex items-center gap-2">
                    {preview.blocks?.length ? <AlertTriangle className="h-4 w-4 text-amber-200" /> : <CheckCircle2 className="h-4 w-4 text-emerald-200" />}
                    <p className="text-sm font-semibold">{preview.blocks?.length ? "Readiness gates found" : preview.approval_required ? "Ready for approval" : "Ready to retain"}</p>
                  </div>
                  {preview.blocks?.length ? (
                    <div className="mt-3 space-y-2">
                      {preview.blocks.map((block) => (
                        <div key={block.id} className="rounded-lg border border-amber-500/20 bg-black/10 p-2.5">
                          <p className="text-xs font-medium text-amber-100">{block.label}</p>
                          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{block.detail}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        Preview {preview.id} passed the current permission, provider, client-link, tenant-access, and service-evidence gates. No Microsoft change has been run.
                      </p>
                      {!!preview.option_summary?.length && (
                        <div className="mt-3 space-y-1.5 rounded-lg border border-emerald-500/15 bg-black/10 p-3">
                          {preview.option_summary.map((item) => (
                            <div key={item.key} className="flex items-start justify-between gap-4 text-xs">
                              <span className="text-muted-foreground">{item.label}</span>
                              <span className="text-right font-medium">{item.display_value || "Not set"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <div className="mt-3 border-t border-border/60 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Rollback plan</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{preview.rollback_plan}</p>
                    <p className="mt-2 text-[11px] text-muted-foreground">Preview expires {formatWhen(preview.preview_expires_at)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 bg-muted/10 px-6 py-4 sm:justify-between">
            <p className="max-w-md text-left text-xs leading-5 text-muted-foreground">
              Previewing is non-mutating. Submitting either requests approval or saves an execution-ready plan; it does not silently change Microsoft.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={closeAction}>Cancel</Button>
              {!preview ? (
                <Button onClick={buildPreview} disabled={busy || !selectedTenant} data-testid="microsoft-action-preview">
                  {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-1.5 h-4 w-4" />}
                  Preview safely
                </Button>
              ) : (
                <Button onClick={submitPlan} disabled={busy || !!preview.blocks?.length || !selectedTenant?.action_ready} data-testid="microsoft-action-submit">
                  {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-1.5 h-4 w-4" />}
                  {preview.approval_required ? "Request approval" : "Save execution plan"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditField({ label, value }) {
  return <div className="rounded-lg border border-border/70 bg-background/40 p-2.5"><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-1 truncate text-xs font-medium">{value}</p></div>;
}

function ActionWorkflowStep({ number, icon: Icon, title, description }) {
  return (
    <div className="flex gap-3 rounded-xl border border-border/70 bg-background/40 p-3">
      <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/[0.07] text-cyan-200">
        <Icon className="h-3.5 w-3.5" />
        <span className="mt-0.5 text-[8px] font-bold tracking-wider">{number}</span>
      </div>
      <div className="min-w-0"><p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p></div>
    </div>
  );
}

function ReadinessStat({ label, value }) {
  return (
    <div className="rounded-xl border border-border/70 bg-black/10 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        <Building2 className="h-3 w-3 text-cyan-300" />
        {label}
      </div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
