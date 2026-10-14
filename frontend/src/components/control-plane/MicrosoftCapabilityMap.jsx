import { Link } from "react-router-dom";
import {
  Activity, ArrowRight, BadgeCheck, Building2, CheckCircle2, Cloud, FileCheck2,
  KeyRound, Mail, MonitorSmartphone, Network, ShieldCheck, Users, Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CAPABILITIES = [
  {
    title: "Tenant & delegation",
    description: "Partner Center discovery, tenant-to-client ownership, GDAP visibility and access readiness.",
    icon: Building2,
    route: "/control-plane?module=microsoft365&view=connections",
    action: "Open tenant setup",
    microsoftBound: true,
    capabilityKind: "discovery",
    tools: ["Partner tenant discovery", "Client relationship mapping", "GDAP readiness", "Audited tenant context"],
  },
  {
    title: "Identity lifecycle",
    description: "Provision, credential recovery, containment, offboarding and licence reconciliation with approval gates.",
    icon: Users,
    route: "/control-plane?module=microsoft365&view=actions",
    action: "Open action centre",
    microsoftBound: true,
    capabilityKind: "execution",
    tools: ["Create user", "Reset password / MFA", "Group access plans", "Block sign-in", "Offboarding plans", "Licence changes"],
  },
  {
    title: "Exchange & mail hygiene",
    description: "Mailbox, forwarding, transport, domain and mail-flow operations should share incident and customer evidence.",
    icon: Mail,
    route: "/mail-shield",
    action: "Open Mail Shield",
    microsoftBound: true,
    capabilityKind: "evidence",
    tools: ["Mailbox posture", "Shared mailbox access plans", "Forwarding-rule review", "Mail-flow evidence", "Domain protection", "Incident routing"],
  },
  {
    title: "Intune & endpoints",
    description: "Managed device inventory, compliance, applications, configuration and endpoint remediation in client context.",
    icon: MonitorSmartphone,
    route: "/devices",
    action: "Open endpoints",
    microsoftBound: true,
    capabilityKind: "evidence",
    tools: ["Intune inventory", "Compliance posture", "App and policy deployment", "Remote remediation", "Device timeline"],
  },
  {
    title: "Security operations",
    description: "Secure Score, risky identity signals, Conditional Access evidence and response workflow without false health claims.",
    icon: ShieldCheck,
    route: "/control-plane?module=microsoft365&view=security",
    action: "Open security",
    microsoftBound: true,
    capabilityKind: "evidence",
    tools: ["Guardrail library", "Secure Score evidence", "Risk detections", "GDAP oversight", "Change-ready plans"],
  },
  {
    title: "Collaboration & data",
    description: "Teams, SharePoint and OneDrive governance is planned as a tenant-scoped, evidence-led capability—not an isolated admin portal.",
    icon: Cloud,
    route: "/control-plane?module=microsoft365&view=connections",
    action: "Review connection",
    microsoftBound: true,
    capabilityKind: "evidence",
    tools: ["Teams governance", "SharePoint access review", "OneDrive lifecycle", "External sharing review", "Retention evidence"],
  },
  {
    title: "Network & cloud",
    description: "Azure, domains, DNS and certificates are connected to the same client, service and change record.",
    icon: Network,
    route: "/networking",
    action: "Open network",
    microsoftBound: false,
    tools: ["Domain posture", "DNS evidence", "Certificate tracking", "Azure connection readiness", "Change history"],
  },
  {
    title: "Automation & assurance",
    description: "Build previewable, approval-aware workflows and turn Microsoft evidence into service, billing and audit outcomes.",
    icon: Workflow,
    route: "/automation-hub",
    action: "Open automation",
    microsoftBound: false,
    tools: ["Simulation mode", "Approvals and rollback", "Ticket linkage", "Audit ledger", "Service reconciliation"],
  },
];

const STATE = {
  workflow: {
    label: "Nexus workflow available",
    className: "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-200",
    icon: CheckCircle2,
  },
  connection_required: {
    label: "Microsoft setup required",
    className: "border-amber-500/25 bg-amber-500/[0.07] text-amber-700 dark:text-amber-200",
    icon: KeyRound,
  },
  discovery_ready: {
    label: "Ready to discover",
    className: "border-cyan-500/25 bg-cyan-500/[0.07] text-cyan-700 dark:text-cyan-200",
    icon: Activity,
  },
  discovery_complete: {
    label: "Tenants discovered",
    className: "border-violet-500/25 bg-violet-500/[0.07] text-violet-700 dark:text-violet-200",
    icon: Cloud,
  },
  adapter_available: {
    label: "Adapter available",
    className: "border-amber-500/25 bg-amber-500/[0.07] text-amber-700 dark:text-amber-200",
    icon: Workflow,
  },
  evidence_required: {
    label: "Collector required",
    className: "border-violet-500/25 bg-violet-500/[0.07] text-violet-700 dark:text-violet-200",
    icon: Activity,
  },
  evidence_active: {
    label: "Evidence active",
    className: "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-200",
    icon: CheckCircle2,
  },
  native_execution_planned: {
    label: "Native action planned",
    className: "border-cyan-500/25 bg-cyan-500/[0.07] text-cyan-700 dark:text-cyan-200",
    icon: FileCheck2,
  },
};

export default function MicrosoftCapabilityMap({
  partnerCenterConfigured = false,
  cippAdapterConfigured = false,
  tenantCount = 0,
  evidenceTenantCount = 0,
}) {
  const stateFor = (capability) => {
    if (!capability.microsoftBound) return "workflow";
    if (capability.capabilityKind === "discovery") {
      if (!partnerCenterConfigured && !cippAdapterConfigured) return "connection_required";
      return tenantCount > 0 ? "discovery_complete" : "discovery_ready";
    }
    if (capability.capabilityKind === "execution") {
      if (cippAdapterConfigured && tenantCount > 0) return "adapter_available";
      if (partnerCenterConfigured && tenantCount > 0) return "native_execution_planned";
      return "connection_required";
    }
    if (evidenceTenantCount > 0) return "evidence_active";
    if (cippAdapterConfigured && tenantCount > 0) return "adapter_available";
    if (partnerCenterConfigured) return "evidence_required";
    return "connection_required";
  };
  const connectionLabel = partnerCenterConfigured
    ? "Partner Center configured"
    : cippAdapterConfigured
      ? "Compatibility adapter only"
      : "Connection-gated";
  const connectionClass = partnerCenterConfigured
    ? "border-emerald-500/25 text-emerald-700 dark:text-emerald-200"
    : cippAdapterConfigured
      ? "border-amber-500/25 text-amber-700 dark:text-amber-200"
      : "border-amber-500/25 text-amber-700 dark:text-amber-200";
  return (
    <div className="space-y-4" data-testid="nexus-365-capability-map">
      <Card className="overflow-hidden border-cyan-500/20 bg-[linear-gradient(135deg,rgba(6,182,212,0.08),rgba(16,185,129,0.035))]">
        <CardContent className="grid gap-4 p-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/[0.08] text-cyan-700 dark:text-cyan-100"><BadgeCheck className="mr-1.5 h-3.5 w-3.5" />Nexus 365 capability map</Badge><Badge variant="outline" className={connectionClass}>{connectionLabel}</Badge></div>
            <h3 className="mt-3 text-lg font-semibold">One Microsoft workspace—with the current capability boundary visible</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Nexus keeps the technician workflow, client context, approvals, billing impact and audit history in one place. Partner Center discovers CSP customers; GDAP and Graph evidence remain per-tenant gates; an existing CIPP deployment is shown only as an optional temporary adapter.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Capability domains" value={CAPABILITIES.length} />
            <Metric label="Tenants in scope" value={tenantCount} />
            <Metric label="Evidence tenants" value={evidenceTenantCount} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {CAPABILITIES.map((capability) => {
          const Icon = capability.icon;
          const state = STATE[stateFor(capability)];
          const StateIcon = state.icon;
          return <Card key={capability.title} className="group flex min-h-[280px] flex-col overflow-hidden border-border/70 bg-card/80 transition hover:border-cyan-500/25 hover:bg-cyan-500/[0.02]">
            <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-500/20 bg-cyan-500/[0.07]"><Icon className="h-4 w-4 text-cyan-700 dark:text-cyan-200" /></span><Badge variant="outline" className={`max-w-[165px] text-right text-[10px] ${state.className}`}><StateIcon className="mr-1 h-3 w-3 shrink-0" />{state.label}</Badge></div><CardTitle className="mt-3 text-base">{capability.title}</CardTitle><CardDescription className="mt-1 min-h-14 text-xs leading-5">{capability.description}</CardDescription></CardHeader>
            <CardContent className="mt-auto space-y-4"><div className="flex flex-wrap gap-1.5">{capability.tools.map((tool) => <span key={tool} className="rounded-md border border-border/70 bg-muted/25 px-2 py-1 text-[10px] text-muted-foreground">{tool}</span>)}</div><Button variant="outline" size="sm" className="w-full justify-between" asChild><Link to={capability.route}>{capability.action}<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></Link></Button></CardContent>
          </Card>;
        })}
      </div>

      <Card className="border-violet-500/20 bg-violet-500/[0.035]"><CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"><div className="flex gap-3"><Activity className="mt-0.5 h-5 w-5 shrink-0 text-violet-700 dark:text-violet-200" /><div><p className="text-sm font-semibold">Why Nexus is the technician workspace</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Every tenant action can be connected to the affected client, device, ticket, contract, billable service, approval and audit record. Provider capabilities remain explicitly gated until their evidence and execution paths are verified.</p></div></div><Button size="sm" variant="outline" asChild><Link to="/control-plane?module=microsoft365&view=actions"><FileCheck2 className="mr-1.5 h-3.5 w-3.5" />Review governed actions</Link></Button></CardContent></Card>
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="rounded-xl border border-cyan-500/15 bg-background/55 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold text-cyan-700 dark:text-cyan-100">{value}</p></div>;
}
