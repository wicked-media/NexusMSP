import { useMemo, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  LockKeyhole,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const destinationTypes = [
  ["nexus_backup_vault", "Nexus Backup Vault"],
  ["s3_compatible", "S3-compatible immutable store"],
  ["managed_repository", "Managed backup repository"],
];

const workloadTypes = [
  ["endpoint_files", "Endpoint files"],
  ["system_image", "System image"],
  ["server_application", "Server application"],
];

const sourceProfiles = [
  ["user_data", "User data"],
  ["business_data", "Business data"],
  ["full_device", "Full device"],
  ["application_aware", "Application-aware"],
];

function clientLabel(client) {
  return client?.company_name || client?.name || client?.id || "Client";
}

function StateBadge({ state }) {
  const styles = {
    blocked: "border-amber-400/25 bg-amber-400/[0.08] text-amber-100",
    draft: "border-sky-400/25 bg-sky-400/[0.08] text-sky-100",
    attested: "border-violet-400/25 bg-violet-400/[0.08] text-violet-100",
    not_configured: "border-muted-foreground/25 bg-muted/30 text-muted-foreground",
  };
  return <Badge variant="outline" className={`text-[10px] ${styles[state] || styles.not_configured}`}>{String(state || "not assessed").replaceAll("_", " ")}</Badge>;
}

function Metric({ icon: Icon, label, value, detail }) {
  return <div className="rounded-xl border border-border/70 bg-background/[0.38] p-3.5">
    <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</span><Icon className="h-3.5 w-3.5 text-cyan-300" /></div>
    <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail}</p>
  </div>;
}

export default function NexusBackupTab({ data, loading, error, clients = [], api, headers, onChanged }) {
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [destination, setDestination] = useState({ client_id: "", destination_type: "nexus_backup_vault", destination_name: "", encryption_attested: false, immutable_storage_attested: false, restore_verification_attested: false });
  const [profile, setProfile] = useState({ client_id: "", name: "", workload_type: "endpoint_files", source_profile: "business_data", schedule: "daily", retention_days: "30", rpo_hours: "24" });
  const [assignment, setAssignment] = useState({ profile_id: "", device_id: "", destination_id: "" });
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [vault, setVault] = useState({ endpoint_url: "", bucket: "", region: "us-east-1", access_key_id: "", secret_access_key: "", session_token: "" });

  const profiles = useMemo(() => data?.profiles || [], [data]);
  const devices = useMemo(() => data?.available_devices || [], [data]);
  const intents = useMemo(() => data?.workload_intents || [], [data]);
  const selectedProfile = profiles.find((item) => item.id === assignment.profile_id);
  const assignableDestinations = useMemo(
    () => (data?.destinations || []).filter((item) => !selectedProfile || item.client_id === selectedProfile.client_id),
    [data?.destinations, selectedProfile],
  );
  const assignableDevices = useMemo(
    () => devices.filter((item) => !selectedProfile || item.client_id === selectedProfile.client_id),
    [devices, selectedProfile],
  );

  const run = async (request, success) => {
    setSaving(true);
    try {
      await request();
      toast.success(success);
      await onChanged?.();
      return true;
    } catch (requestError) {
      toast.error(requestError.response?.data?.detail || requestError.message || "Nexus Backup could not save that change");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveDestination = async () => {
    if (!destination.client_id || !destination.destination_name.trim()) {
      toast.error("Choose a client and name the destination.");
      return;
    }
    if (!destination.encryption_attested || !destination.immutable_storage_attested || !destination.restore_verification_attested) {
      toast.error("Confirm encryption, immutable retention, and restore verification planning before saving.");
      return;
    }
    if (await run(() => axios.post(`${api}/nexus-backup/destinations`, destination, { headers }), "Destination attestation saved. Storage verification is still required.")) {
      setDestinationOpen(false);
      setDestination({ client_id: "", destination_type: "nexus_backup_vault", destination_name: "", encryption_attested: false, immutable_storage_attested: false, restore_verification_attested: false });
    }
  };

  const saveProfile = async () => {
    if (!profile.client_id || !profile.name.trim()) {
      toast.error("Choose a client and name the policy.");
      return;
    }
    const payload = { ...profile, retention_days: Number(profile.retention_days), rpo_hours: Number(profile.rpo_hours) };
    if (await run(() => axios.post(`${api}/nexus-backup/profiles`, payload, { headers }), "Native Backup policy draft created.")) {
      setProfileOpen(false);
      setProfile({ client_id: "", name: "", workload_type: "endpoint_files", source_profile: "business_data", schedule: "daily", retention_days: "30", rpo_hours: "24" });
    }
  };

  const saveAssignment = async () => {
    if (!assignment.profile_id || !assignment.device_id || !assignment.destination_id) {
      toast.error("Choose a policy, endpoint, and destination.");
      return;
    }
    if (await run(() => axios.post(`${api}/nexus-backup/profiles/${assignment.profile_id}/assignments`, { device_id: assignment.device_id, destination_id: assignment.destination_id }, { headers }), "Protected-workload intent recorded. No capture was started.")) {
      setAssignmentOpen(false);
      setAssignment({ profile_id: "", device_id: "", destination_id: "" });
    }
  };

  const preflight = async (intent) => {
    await run(
      () => axios.post(`${api}/nexus-backup/jobs/${intent.id}/preflight`, { expected_version: intent.version }, { headers }),
      "Preflight recorded. No snapshot, file access, transfer, or restore occurred.",
    );
  };

  const planRestoreDrill = async (intent) => {
    await run(
      () => axios.post(`${api}/nexus-backup/jobs/${intent.id}/restore-drills`, { drill_type: "metadata_review" }, { headers }),
      "Restore drill planned. Nexus has not run or proven a restore.",
    );
  };

  const openVault = (item) => {
    setSelectedDestination(item);
    setVault({ endpoint_url: "", bucket: "", region: "us-east-1", access_key_id: "", secret_access_key: "", session_token: "" });
    setVaultOpen(true);
  };

  const saveVault = async () => {
    if (!selectedDestination || !vault.endpoint_url || !vault.bucket || !vault.access_key_id || !vault.secret_access_key) {
      toast.error("Enter the server-side S3 endpoint, bucket, access key, and secret key.");
      return;
    }
    if (await run(() => axios.put(`${api}/nexus-backup/destinations/${selectedDestination.id}/connection`, { ...vault, expected_version: selectedDestination.version }, { headers }), "Server-side vault connection saved. Verify it before relying on it.")) {
      setVaultOpen(false);
    }
  };

  const verifyVault = async (item) => {
    await run(
      () => axios.post(`${api}/nexus-backup/destinations/${item.id}/verify`, { expected_version: item.version }, { headers }),
      "Vault verification completed. Nexus will only mark immutable storage verified when Object Lock and default encryption pass.",
    );
  };

  if (loading) return <Card><CardContent className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />Loading Nexus Backup control plane…</CardContent></Card>;
  if (error) return <Card className="border-amber-400/25 bg-amber-500/[0.045]"><CardContent className="flex items-start gap-3 p-5"><AlertTriangle className="mt-0.5 h-5 w-5 text-amber-200" /><div><p className="font-semibold text-amber-100">Nexus Backup control plane is unavailable</p><p className="mt-1 text-sm text-muted-foreground">{error}</p></div></CardContent></Card>;

  const summary = data?.summary || {};
  return <div className="space-y-4" data-testid="nexus-backup-tab">
    <Card className="overflow-hidden border-cyan-400/20 bg-[linear-gradient(135deg,rgba(6,182,212,0.10),rgba(124,58,237,0.055)_48%,rgba(15,23,42,0.54))]">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3.5"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/[0.10]"><HardDrive className="h-5 w-5 text-cyan-100" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Nexus Backup</p><h2 className="mt-1 text-lg font-semibold tracking-tight">Native control plane is ready. Data capture is not enabled.</h2><p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">Nexus can now own backup policy, endpoint intent, destination attestation, and audit evidence. It will not claim an endpoint is protected until its native snapshot, encrypted transfer, immutable storage, and restore verification are all proven.</p></div></div>
          <StateBadge state="draft" />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Database} label="Destinations" value={summary.destinations || 0} detail="Attestation only; no secret stored." />
          <Metric icon={ShieldCheck} label="Policies" value={summary.profiles || 0} detail="Retention and workload intent." />
          <Metric icon={Server} label="Workload intents" value={summary.protected_workload_intents || 0} detail="No endpoint data has been read." />
          <Metric icon={CheckCircle2} label="Recovery drills" value={summary.restore_drills || 0} detail="Planning is not restore proof." />
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.08] pt-4">
          <Button size="sm" onClick={() => setDestinationOpen(true)}><LockKeyhole className="mr-1.5 h-3.5 w-3.5" />Attest destination</Button>
          <Button size="sm" variant="outline" onClick={() => setProfileOpen(true)}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Create policy</Button>
          <Button size="sm" variant="outline" onClick={() => setAssignmentOpen(true)} disabled={!profiles.length || !devices.length}><Server className="mr-1.5 h-3.5 w-3.5" />Assign endpoint</Button>
          <Button size="sm" variant="ghost" onClick={onChanged}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh evidence</Button>
        </div>
      </CardContent>
    </Card>

    <div className="grid gap-4 xl:grid-cols-2">
      <Card><CardHeader className="pb-3"><CardTitle className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-violet-300" />Destination readiness</span><span className="text-xs font-normal text-muted-foreground">No credentials shown</span></CardTitle></CardHeader><CardContent className="space-y-2.5">
        {(data?.destinations || []).length ? data.destinations.map((item) => <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-border/65 bg-muted/[0.13] p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.destination_name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{String(item.destination_type || "").replaceAll("_", " ")} · connector {String(item.verification_state || "not verified").replaceAll("_", " ")}</p></div><StateBadge state={item.status} /></div>{["nexus_backup_vault", "s3_compatible"].includes(item.destination_type) && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openVault(item)} disabled={saving}>Connect vault</Button><Button size="sm" variant="ghost" onClick={() => verifyVault(item)} disabled={saving || item.connection_state !== "configured_not_verified"}>Verify immutable storage</Button></div>}</div>) : <p className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">No native destination attestation yet. Configure storage outside the browser, then record only the non-secret readiness proof here.</p>}
      </CardContent></Card>
      <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-cyan-300" />Policy catalogue</CardTitle></CardHeader><CardContent className="space-y-2.5">
        {profiles.length ? profiles.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/65 bg-muted/[0.13] p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{String(item.workload_type).replaceAll("_", " ")} · {item.schedule} · {item.retention_days}d retention · {item.rpo_hours}h RPO</p></div><StateBadge state={item.state} /></div>) : <p className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">Create a policy before assigning an endpoint. A policy is intent only; it cannot select files or start a job.</p>}
      </CardContent></Card>
    </div>

    <Card><CardHeader className="pb-3"><CardTitle className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2"><Server className="h-4 w-4 text-amber-200" />Protected-workload intent</span><span className="text-xs font-normal text-muted-foreground">Execution remains fail-closed</span></CardTitle></CardHeader><CardContent className="space-y-2.5">
      {intents.length ? intents.map((item) => <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-border/65 bg-muted/[0.13] p-3.5 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{item.device_name || "Endpoint not currently visible"}</p><StateBadge state={item.state} /></div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{item.profile_name || "Policy unavailable"} · {item.destination_name || "No destination"}</p><p className="mt-1 text-[11px] text-amber-100/80">{item.state === "preflight_queued" || item.state === "preflight_leased" ? "Awaiting a safe capability response from the Nexus Agent. No endpoint data will be accessed." : item.preflight?.status === "inventory_only" ? item.capture_release?.blockers?.[0] || "Capability preflight completed. Capture remains blocked until the reviewed data plane is released." : item.readiness?.summary || "Nexus has not evaluated endpoint execution readiness."}</p>{item.preflight?.status === "inventory_only" && <p className="mt-1 text-[11px] text-muted-foreground">Windows posture: {item.preflight?.vss_state || "unknown"} VSS · {item.preflight?.volume_capacity_state || "unknown"} fixed-volume capacity.</p>}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" className="w-fit" onClick={() => preflight(item)} disabled={saving || item.state === "preflight_queued" || item.state === "preflight_leased"}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />{item.state === "preflight_queued" || item.state === "preflight_leased" ? "Preflight queued" : "Run safe preflight"}</Button><Button size="sm" variant="ghost" className="w-fit" onClick={() => planRestoreDrill(item)} disabled={saving}>Plan restore drill</Button></div></div>) : <p className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">No endpoints have been assigned. Assignment will record a safe intent and a capability preflight—not a capture job.</p>}
    </CardContent></Card>

    <Dialog open={destinationOpen} onOpenChange={setDestinationOpen}><DialogContent><DialogHeader><DialogTitle>Attest a native Backup destination</DialogTitle><DialogDescription>Save non-secret readiness metadata only. Nexus will still mark the connector unverified until a real immutable-storage check is implemented.</DialogDescription></DialogHeader><div className="space-y-3 py-2"><label className="text-xs font-medium">Client<Select value={destination.client_id} onValueChange={(client_id) => setDestination((current) => ({ ...current, client_id }))}><SelectTrigger className="mt-1.5"><SelectValue placeholder="Choose client" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{clientLabel(client)}</SelectItem>)}</SelectContent></Select></label><label className="text-xs font-medium">Destination type<Select value={destination.destination_type} onValueChange={(destination_type) => setDestination((current) => ({ ...current, destination_type }))}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent>{destinationTypes.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label><label className="text-xs font-medium">Destination label<Input className="mt-1.5" value={destination.destination_name} onChange={(event) => setDestination((current) => ({ ...current, destination_name: event.target.value }))} placeholder="e.g. Melbourne immutable vault" /></label><div className="space-y-2 rounded-xl border border-border/70 bg-muted/[0.18] p-3 text-xs">{[["encryption_attested", "Encryption is configured and keys are held outside Nexus."], ["immutable_storage_attested", "Immutable retention has been configured for this client."], ["restore_verification_attested", "A restore-verification plan is approved for this client."]].map(([field, label]) => <label key={field} className="flex cursor-pointer items-start gap-2"><input type="checkbox" checked={destination[field]} onChange={(event) => setDestination((current) => ({ ...current, [field]: event.target.checked }))} className="mt-0.5 h-3.5 w-3.5" />{label}</label>)}</div></div><DialogFooter><Button variant="outline" onClick={() => setDestinationOpen(false)}>Cancel</Button><Button onClick={saveDestination} disabled={saving}>{saving ? "Saving…" : "Save attestation"}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent><DialogHeader><DialogTitle>Create native Backup policy</DialogTitle><DialogDescription>Policies define retention intent only. They do not accept file paths or start a backup.</DialogDescription></DialogHeader><div className="grid gap-3 py-2 sm:grid-cols-2"><label className="text-xs font-medium sm:col-span-2">Client<Select value={profile.client_id} onValueChange={(client_id) => setProfile((current) => ({ ...current, client_id }))}><SelectTrigger className="mt-1.5"><SelectValue placeholder="Choose client" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{clientLabel(client)}</SelectItem>)}</SelectContent></Select></label><label className="text-xs font-medium sm:col-span-2">Policy name<Input className="mt-1.5" value={profile.name} onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Managed workstation baseline" /></label><label className="text-xs font-medium">Workload<Select value={profile.workload_type} onValueChange={(workload_type) => setProfile((current) => ({ ...current, workload_type }))}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent>{workloadTypes.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label><label className="text-xs font-medium">Source posture<Select value={profile.source_profile} onValueChange={(source_profile) => setProfile((current) => ({ ...current, source_profile }))}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent>{sourceProfiles.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label><label className="text-xs font-medium">Schedule<Select value={profile.schedule} onValueChange={(schedule) => setProfile((current) => ({ ...current, schedule }))}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent></Select></label><label className="text-xs font-medium">Retention days<Input className="mt-1.5" type="number" min="7" max="3650" value={profile.retention_days} onChange={(event) => setProfile((current) => ({ ...current, retention_days: event.target.value }))} /></label><label className="text-xs font-medium sm:col-span-2">RPO hours<Input className="mt-1.5" type="number" min="1" max="720" value={profile.rpo_hours} onChange={(event) => setProfile((current) => ({ ...current, rpo_hours: event.target.value }))} /></label></div><DialogFooter><Button variant="outline" onClick={() => setProfileOpen(false)}>Cancel</Button><Button onClick={saveProfile} disabled={saving}>{saving ? "Saving…" : "Create policy"}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={vaultOpen} onOpenChange={setVaultOpen}><DialogContent><DialogHeader><DialogTitle>Connect an immutable S3 vault</DialogTitle><DialogDescription>Connection material is encrypted server-side and never shown again. Nexus verifies only bucket access, Object Lock, and default encryption; it does not upload backup data from this dialog.</DialogDescription></DialogHeader><div className="grid gap-3 py-2 sm:grid-cols-2"><label className="text-xs font-medium sm:col-span-2">S3 endpoint<Input className="mt-1.5" type="url" value={vault.endpoint_url} onChange={(event) => setVault((current) => ({ ...current, endpoint_url: event.target.value }))} placeholder="https://s3.example.com" /></label><label className="text-xs font-medium">Bucket<Input className="mt-1.5" value={vault.bucket} onChange={(event) => setVault((current) => ({ ...current, bucket: event.target.value }))} /></label><label className="text-xs font-medium">Region<Input className="mt-1.5" value={vault.region} onChange={(event) => setVault((current) => ({ ...current, region: event.target.value }))} /></label><label className="text-xs font-medium">Access key<Input className="mt-1.5" autoComplete="off" value={vault.access_key_id} onChange={(event) => setVault((current) => ({ ...current, access_key_id: event.target.value }))} /></label><label className="text-xs font-medium">Secret key<Input className="mt-1.5" type="password" autoComplete="new-password" value={vault.secret_access_key} onChange={(event) => setVault((current) => ({ ...current, secret_access_key: event.target.value }))} /></label><label className="text-xs font-medium sm:col-span-2">Session token <span className="font-normal text-muted-foreground">optional</span><Input className="mt-1.5" type="password" autoComplete="new-password" value={vault.session_token} onChange={(event) => setVault((current) => ({ ...current, session_token: event.target.value }))} /></label></div><DialogFooter><Button variant="outline" onClick={() => setVaultOpen(false)}>Cancel</Button><Button onClick={saveVault} disabled={saving}>{saving ? "Saving…" : "Save server-side connection"}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={assignmentOpen} onOpenChange={setAssignmentOpen}><DialogContent><DialogHeader><DialogTitle>Assign a protected-workload intent</DialogTitle><DialogDescription>This assignment runs no backup. It binds stable Nexus endpoint and destination IDs, then records what still blocks native execution.</DialogDescription></DialogHeader><div className="space-y-3 py-2"><label className="text-xs font-medium">Policy<Select value={assignment.profile_id} onValueChange={(profile_id) => setAssignment({ profile_id, device_id: "", destination_id: "" })}><SelectTrigger className="mt-1.5"><SelectValue placeholder="Choose policy" /></SelectTrigger><SelectContent>{profiles.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label><label className="text-xs font-medium">Endpoint<Select value={assignment.device_id} onValueChange={(device_id) => setAssignment((current) => ({ ...current, device_id }))} disabled={!selectedProfile}><SelectTrigger className="mt-1.5"><SelectValue placeholder={selectedProfile ? "Choose endpoint" : "Choose policy first"} /></SelectTrigger><SelectContent>{assignableDevices.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label><label className="text-xs font-medium">Destination<Select value={assignment.destination_id} onValueChange={(destination_id) => setAssignment((current) => ({ ...current, destination_id }))} disabled={!selectedProfile}><SelectTrigger className="mt-1.5"><SelectValue placeholder={selectedProfile ? "Choose destination" : "Choose policy first"} /></SelectTrigger><SelectContent>{assignableDestinations.map((item) => <SelectItem key={item.id} value={item.id}>{item.destination_name}</SelectItem>)}</SelectContent></Select></label></div><DialogFooter><Button variant="outline" onClick={() => setAssignmentOpen(false)}>Cancel</Button><Button onClick={saveAssignment} disabled={saving}>{saving ? "Saving…" : "Record intent"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
