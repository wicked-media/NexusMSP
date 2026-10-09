import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  ArchiveRestore,
  ArrowRight,
  BadgeCheck,
  CircleDot,
  DatabaseBackup,
  FileCheck2,
  FileKey2,
  FileUp,
  HardDriveDownload,
  History,
  KeyRound,
  LaptopMinimalCheck,
  Loader2,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
  UploadCloud,
  XCircle,
} from "lucide-react";

import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";
const EMPTY_PROFILE = {
  enabled: false, destination_type: "", destination_name: "", cadence: "daily", rpo_hours: 24, retention_days: 30,
  immutable_storage_attested: false, encryption_attested: false, include_uploads: true, include_agent_installers: true, owner: "", notes: "", version: 1,
};
const EMPTY_EVIDENCE = {
  storage_reference: "", package_checksum: "", package_bytes: "", file_count: "", captured_at: new Date().toISOString(), release_reference: "", collection_counts: {}, include_uploads: true, include_agent_installers: true, note: "",
};

function formatDate(value, fallback = "Not yet recorded") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

function statusMeta(status) {
  const value = String(status || "not_configured").toLowerCase();
  if (["verified", "passed", "captured_unverified"].includes(value)) return { label: value.replaceAll("_", " "), className: "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200", icon: BadgeCheck };
  if (["failed", "capture_failed"].includes(value)) return { label: value.replaceAll("_", " "), className: "border-rose-400/30 bg-rose-400/[0.08] text-rose-200", icon: XCircle };
  if (["capture_required", "restore_verification_required", "awaiting_host_capture"].includes(value)) return { label: value.replaceAll("_", " "), className: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200", icon: TriangleAlert };
  return { label: value.replaceAll("_", " "), className: "border-sky-400/30 bg-sky-400/[0.08] text-sky-200", icon: CircleDot };
}

function Metric({ label, value, detail, tone = "zinc" }) {
  const tones = {
    cyan: "border-cyan-400/25 bg-cyan-400/[0.045] text-cyan-100",
    emerald: "border-emerald-400/25 bg-emerald-400/[0.045] text-emerald-100",
    amber: "border-amber-400/25 bg-amber-400/[0.045] text-amber-100",
    zinc: "border-border/70 bg-card/90 text-foreground",
  };
  return <Card className={`${SURFACE} h-full ${tones[tone] || tones.zinc}`}><CardContent className="p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></CardContent></Card>;
}

function Detail({ label, children }) {
  return <div className="rounded-xl border border-border/70 bg-muted/[0.10] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p><div className="mt-1.5 text-sm">{children}</div></div>;
}

function ProfileDialog({ open, profile, destinations, saving, onOpenChange, onSave }) {
  const [form, setForm] = useState(EMPTY_PROFILE);
  useEffect(() => { if (open) setForm({ ...EMPTY_PROFILE, ...(profile || {}) }); }, [open, profile]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Dialog open={open} onOpenChange={onOpenChange}><NexusWorkflowDialog eyebrow="Nexus Platform Continuity" title="Configure recovery policy" description="Define the non-secret evidence policy for a host-run backup. Nexus does not accept storage credentials, encryption keys or a database connection from this form." icon={DatabaseBackup} tone="emerald" className="max-w-4xl" footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={() => onSave(form)} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Save recovery policy</Button></>}>
    <div className="grid gap-5 md:grid-cols-2">
      <div className="space-y-2 md:col-span-2"><div className="flex items-start justify-between gap-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4"><div><Label htmlFor="continuity-enabled" className="text-sm">Enable recovery policy</Label><p className="mt-1 text-xs leading-5 text-muted-foreground">Enable only after an encrypted, off-host and immutable destination is ready. This is a policy control—not proof that a capture has succeeded.</p></div><Switch id="continuity-enabled" checked={Boolean(form.enabled)} onCheckedChange={(value) => set("enabled", value)} /></div></div>
      <div className="space-y-2"><Label>Approved destination</Label><Select value={form.destination_type || undefined} onValueChange={(value) => set("destination_type", value)}><SelectTrigger><SelectValue placeholder="Choose a recovery destination" /></SelectTrigger><SelectContent>{destinations.map((destination) => <SelectItem key={destination.id} value={destination.id}>{destination.label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="continuity-destination-name">Destination reference</Label><Input id="continuity-destination-name" value={form.destination_name} onChange={(event) => set("destination_name", event.target.value)} placeholder="e.g. AU immutable recovery vault" /></div>
      <div className="space-y-2"><Label>Capture cadence</Label><Select value={form.cadence} onValueChange={(value) => set("cadence", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent></Select></div>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="continuity-rpo">RPO hours</Label><Input id="continuity-rpo" type="number" min="1" max="720" value={form.rpo_hours} onChange={(event) => set("rpo_hours", Number(event.target.value))} /></div><div className="space-y-2"><Label htmlFor="continuity-retention">Retention days</Label><Input id="continuity-retention" type="number" min="7" max="3650" value={form.retention_days} onChange={(event) => set("retention_days", Number(event.target.value))} /></div></div>
      <div className="space-y-2"><Label htmlFor="continuity-owner">Recovery owner</Label><Input id="continuity-owner" value={form.owner} onChange={(event) => set("owner", event.target.value)} placeholder="Named accountable owner" /></div>
      <div className="space-y-3 rounded-xl border border-border/70 bg-muted/[0.10] p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Included persistent data</p><label className="flex items-center gap-3 text-sm"><Checkbox checked={Boolean(form.include_uploads)} onCheckedChange={(value) => set("include_uploads", Boolean(value))} />Private uploads and generated artefacts</label><label className="flex items-center gap-3 text-sm"><Checkbox checked={Boolean(form.include_agent_installers)} onCheckedChange={(value) => set("include_agent_installers", Boolean(value))} />Nexus Agent installer artefacts</label></div>
      <div className="space-y-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4 md:col-span-2"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Required attestations</p><label className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={Boolean(form.encryption_attested)} onCheckedChange={(value) => set("encryption_attested", Boolean(value))} />The destination encrypts this recovery package and required secrets remain exclusively in the approved secret manager.</label><label className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={Boolean(form.immutable_storage_attested)} onCheckedChange={(value) => set("immutable_storage_attested", Boolean(value))} />The off-host destination has reviewed immutability/retention controls and cannot be silently altered by the source host.</label></div>
      <div className="space-y-2 md:col-span-2"><Label htmlFor="continuity-notes">Operational notes</Label><Textarea id="continuity-notes" rows={3} value={form.notes} onChange={(event) => set("notes", event.target.value)} placeholder="Retention ownership, change policy or destination-control reference" /></div>
    </div>
  </NexusWorkflowDialog></Dialog>;
}

function RestorePointDialog({ open, saving, onOpenChange, onSave }) {
  const [form, setForm] = useState({ kind: "manual", reason: "" });
  useEffect(() => { if (open) setForm({ kind: "manual", reason: "" }); }, [open]);
  return <Dialog open={open} onOpenChange={onOpenChange}><NexusWorkflowDialog eyebrow="Nexus Platform Continuity" title="Request a restore point" description="Nexus creates an accountable host-capture request with a pre-capture inventory. The host runner produces a validated package for the attested encrypted destination; no data is copied by this dialog." icon={ArchiveRestore} tone="emerald" className="max-w-2xl" footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={() => onSave(form)} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <HardDriveDownload className="mr-2 h-4 w-4" />}Request host capture</Button></>}>
    <div className="space-y-5"><div className="grid gap-2 sm:grid-cols-3">{[["manual", "Manual"], ["pre_change", "Pre-change"], ["scheduled", "Scheduled"]].map(([value, label]) => <button key={value} type="button" onClick={() => setForm((current) => ({ ...current, kind: value }))} className={`rounded-xl border px-3 py-3 text-left text-sm transition ${form.kind === value ? "border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-100" : "border-border bg-muted/[0.08] text-muted-foreground hover:border-border"}`}>{label}</button>)}</div><div className="space-y-2"><Label htmlFor="restore-point-reason">Why is this restore point required?</Label><Textarea id="restore-point-reason" rows={4} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="e.g. Before production update CHG-2041" /></div><section className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4 text-xs leading-5 text-muted-foreground">The requested record gives the host runner a non-secret checklist: MongoDB, uploads, installer artefacts, release metadata, checksums and required secret identifiers. It does not back up environment files, private keys or secrets.</section></div>
  </NexusWorkflowDialog></Dialog>;
}

function CaptureEvidenceDialog({ open, point, saving, onOpenChange, onSave }) {
  const [form, setForm] = useState(EMPTY_EVIDENCE);
  useEffect(() => { if (open) setForm({ ...EMPTY_EVIDENCE, include_uploads: point?.evidence?.include_uploads ?? true, include_agent_installers: point?.evidence?.include_agent_installers ?? true }); }, [open, point]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Dialog open={open} onOpenChange={onOpenChange}><NexusWorkflowDialog eyebrow="Nexus Platform Continuity" title="Record host capture evidence" description="Copy the non-secret manifest fields emitted by the host recovery runner. The archive and keys remain outside Nexus." icon={FileUp} tone="emerald" className="max-w-4xl" footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={() => onSave(form)} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}Retain manifest evidence</Button></>}>
    <div className="grid gap-5 md:grid-cols-2"><div className="space-y-2 md:col-span-2"><Label htmlFor="evidence-ref">Off-host storage reference</Label><Input id="evidence-ref" value={form.storage_reference} onChange={(event) => set("storage_reference", event.target.value)} placeholder="Immutable object/version or approved vault reference — never a password or URL containing credentials" /></div><div className="space-y-2"><Label htmlFor="evidence-checksum">Archive SHA-256</Label><Input id="evidence-checksum" value={form.package_checksum} onChange={(event) => set("package_checksum", event.target.value)} placeholder="64-character SHA-256" /></div><div className="space-y-2"><Label htmlFor="evidence-release">Release reference</Label><Input id="evidence-release" value={form.release_reference} onChange={(event) => set("release_reference", event.target.value)} placeholder="Nexus image tag or approved release reference" /></div><div className="space-y-2"><Label htmlFor="evidence-bytes">Archive bytes</Label><Input id="evidence-bytes" type="number" min="1" value={form.package_bytes} onChange={(event) => set("package_bytes", event.target.value)} /></div><div className="space-y-2"><Label htmlFor="evidence-files">Files in archive</Label><Input id="evidence-files" type="number" min="1" value={form.file_count} onChange={(event) => set("file_count", event.target.value)} /></div><div className="space-y-2 md:col-span-2"><Label htmlFor="evidence-time">Host capture time</Label><Input id="evidence-time" value={form.captured_at} onChange={(event) => set("captured_at", event.target.value)} /></div><div className="flex flex-wrap gap-4 rounded-xl border border-border/70 bg-muted/[0.10] p-4 text-sm md:col-span-2"><label className="flex items-center gap-2"><Checkbox checked={Boolean(form.include_uploads)} onCheckedChange={(value) => set("include_uploads", Boolean(value))} />Uploads included</label><label className="flex items-center gap-2"><Checkbox checked={Boolean(form.include_agent_installers)} onCheckedChange={(value) => set("include_agent_installers", Boolean(value))} />Installer artefacts included</label></div><div className="space-y-2 md:col-span-2"><Label htmlFor="evidence-note">Operator note</Label><Textarea id="evidence-note" rows={3} value={form.note} onChange={(event) => set("note", event.target.value)} placeholder="Capture run, storage-policy reference or item needing follow-up" /></div></div>
  </NexusWorkflowDialog></Dialog>;
}

function VerificationDialog({ open, point, saving, onOpenChange, onSave }) {
  const [targetLabel, setTargetLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [checks, setChecks] = useState({ isolated_target_attested: false, database_count_match: false, artifact_inventory_match: false, application_health_verified: false, scope_validation_verified: false, agent_heartbeat_verified: false, secret_identifiers_confirmed: false });
  useEffect(() => { if (open) { setTargetLabel(""); setNotes(""); setChecks({ isolated_target_attested: false, database_count_match: false, artifact_inventory_match: false, application_health_verified: false, scope_validation_verified: false, agent_heartbeat_verified: false, secret_identifiers_confirmed: false }); } }, [open, point]);
  const rows = [["isolated_target_attested", "Recovery target is isolated from the live platform"], ["database_count_match", "Mongo collection counts match the backup manifest"], ["artifact_inventory_match", "Uploads and installer inventory match the manifest"], ["application_health_verified", "API, UI and authenticated health checks pass"], ["scope_validation_verified", "A client/site scope boundary check passes"], ["agent_heartbeat_verified", "A controlled agent heartbeat is observed"], ["secret_identifiers_confirmed", "Required secret identifiers were sourced securely (no values entered here)"]];
  return <Dialog open={open} onOpenChange={onOpenChange}><NexusWorkflowDialog eyebrow="Nexus Platform Continuity" title="Record isolated restore verification" description="A backup is not recovery evidence until it restores in isolation. This record does not cut over traffic or overwrite the live Nexus Core." icon={LaptopMinimalCheck} tone="amber" className="max-w-3xl" footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={() => onSave({ restore_point_id: point?.id, target_label: targetLabel, notes, ...checks })} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}Record verification</Button></>}>
    <div className="space-y-5"><div className="space-y-2"><Label htmlFor="verification-target">Isolated target label</Label><Input id="verification-target" value={targetLabel} onChange={(event) => setTargetLabel(event.target.value)} placeholder="e.g. recovery-lab-au-01" /></div><div className="space-y-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4">{rows.map(([id, label]) => <label key={id} className="flex cursor-pointer items-start gap-3 text-sm leading-6"><Checkbox checked={checks[id]} onCheckedChange={(value) => setChecks((current) => ({ ...current, [id]: Boolean(value) }))} />{label}</label>)}</div><div className="space-y-2"><Label htmlFor="verification-note">Verification note</Label><Textarea id="verification-note" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Evidence references, faults found or remediation follow-up" /></div></div>
  </NexusWorkflowDialog></Dialog>;
}

function CutoverDialog({ open, point, saving, onOpenChange, onSave }) {
  const [form, setForm] = useState({ target_label: "", change_reference: "", planned_window: "", owner: "" });
  useEffect(() => { if (open) setForm({ target_label: "", change_reference: "", planned_window: "", owner: "" }); }, [open, point]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Dialog open={open} onOpenChange={onOpenChange}><NexusWorkflowDialog eyebrow="Nexus Platform Continuity" title="Prepare fresh-host cutover" description="This creates a change-ready runbook from a verified isolated restore point. It does not move traffic, stop services or overwrite live data." icon={ServerCog} tone="amber" className="max-w-3xl" footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={() => onSave({ restore_point_id: point?.id, ...form })} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}Create cutover plan</Button></>}>
    <div className="grid gap-5 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="cutover-target">Fresh host</Label><Input id="cutover-target" value={form.target_label} onChange={(event) => set("target_label", event.target.value)} placeholder="Nexus Core target name" /></div><div className="space-y-2"><Label htmlFor="cutover-owner">Change owner</Label><Input id="cutover-owner" value={form.owner} onChange={(event) => set("owner", event.target.value)} placeholder="Accountable operator" /></div><div className="space-y-2"><Label htmlFor="cutover-change">Approved change reference</Label><Input id="cutover-change" value={form.change_reference} onChange={(event) => set("change_reference", event.target.value)} placeholder="e.g. CHG-2041" /></div><div className="space-y-2"><Label htmlFor="cutover-window">Planned maintenance window</Label><Input id="cutover-window" value={form.planned_window} onChange={(event) => set("planned_window", event.target.value)} placeholder="Date, time and timezone" /></div><section className="rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-4 text-sm leading-6 text-muted-foreground md:col-span-2">Nexus deliberately does not offer an in-place “undo all changes” button. A cutover protects the source host, creates a final pre-change restore point and keeps the original host available for the documented rollback window.</section></div>
  </NexusWorkflowDialog></Dialog>;
}

export default function NexusContinuityPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [restorePointOpen, setRestorePointOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [cutoverOpen, setCutoverOpen] = useState(false);
  const [selectedPointId, setSelectedPointId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async ({ background = false } = {}) => {
    if (!token) return;
    if (background) setRefreshing(true); else setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(`${API}/nexus-continuity/overview`, { headers });
      setData(response.data || {});
      const points = Array.isArray(response.data?.restore_points) ? response.data.restore_points : [];
      setSelectedPointId((current) => current && points.some((item) => item.id === current) ? current : (points[0]?.id || ""));
    } catch (error) {
      setLoadError(error?.response?.data?.detail || error?.message || "Nexus could not retrieve platform recovery evidence. No backup or restore action was started.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers, token]);
  useEffect(() => { load(); }, [load]);

  const profile = data?.profile || EMPTY_PROFILE;
  const points = useMemo(() => Array.isArray(data?.restore_points) ? data.restore_points : [], [data]);
  const runs = useMemo(() => Array.isArray(data?.restore_runs) ? data.restore_runs : [], [data]);
  const cutovers = useMemo(() => Array.isArray(data?.cutover_plans) ? data.cutover_plans : [], [data]);
  const selectedPoint = useMemo(() => points.find((point) => point.id === selectedPointId) || points[0] || null, [points, selectedPointId]);
  const recovery = data?.summary || { status: "not_configured", detail: "Configure a recovery policy before relying on platform backup." };
  const status = statusMeta(recovery.status);
  const StatusIcon = status.icon;
  const flowComplete = recovery.status === "verified" ? 4 : recovery.status === "restore_verification_required" ? 3 : recovery.status === "capture_required" ? 2 : 1;

  const saveProfile = async (form) => {
    setSaving(true);
    try {
      await axios.put(`${API}/nexus-continuity/profile`, { ...form, expected_version: profile.version }, { headers });
      setProfileOpen(false); await load({ background: true }); toast.success("Platform recovery policy retained. No backup package was created yet.");
    } catch (error) { toast.error(error?.response?.data?.detail || "Nexus could not save the recovery policy."); } finally { setSaving(false); }
  };
  const requestPoint = async (form) => {
    if (!form.reason.trim()) { toast.error("Record why this restore point is needed."); return; }
    setSaving(true);
    try { await axios.post(`${API}/nexus-continuity/restore-points`, form, { headers }); setRestorePointOpen(false); await load({ background: true }); toast.success("Host capture requested. Run the approved recovery script and record its manifest evidence."); } catch (error) { toast.error(error?.response?.data?.detail || "Nexus could not request a restore point."); } finally { setSaving(false); }
  };
  const recordEvidence = async (form) => {
    if (!selectedPoint?.id) return;
    setSaving(true);
    try { await axios.post(`${API}/nexus-continuity/restore-points/${selectedPoint.id}/evidence`, { ...form, package_bytes: Number(form.package_bytes), file_count: Number(form.file_count) }, { headers }); setEvidenceOpen(false); await load({ background: true }); toast.success("Backup manifest evidence retained. Schedule the isolated restore verification next."); } catch (error) { toast.error(error?.response?.data?.detail || "Nexus could not retain the capture evidence."); } finally { setSaving(false); }
  };
  const recordVerification = async (form) => {
    if (!form.target_label.trim()) { toast.error("Name the isolated recovery target."); return; }
    setSaving(true);
    try { const response = await axios.post(`${API}/nexus-continuity/restore-verifications`, form, { headers }); setVerificationOpen(false); await load({ background: true }); toast[response.data?.restore_run?.status === "passed" ? "success" : "error"](response.data?.restore_run?.status === "passed" ? "Isolated recovery verification passed and was retained." : "Recovery verification was retained as incomplete or failed."); } catch (error) { toast.error(error?.response?.data?.detail || "Nexus could not retain the recovery verification."); } finally { setSaving(false); }
  };
  const createCutover = async (form) => {
    if (!form.target_label.trim() || !form.change_reference.trim() || !form.planned_window.trim() || !form.owner.trim()) { toast.error("Complete the fresh host, owner, change reference and planned window."); return; }
    setSaving(true);
    try { await axios.post(`${API}/nexus-continuity/cutover-plans`, form, { headers }); setCutoverOpen(false); await load({ background: true }); toast.success("Fresh-host cutover plan retained. No live service was changed."); } catch (error) { toast.error(error?.response?.data?.detail || "Nexus could not create the cutover plan."); } finally { setSaving(false); }
  };

  if (loading && !data) return <WorkspaceLoadingState className="mt-4" label="Assembling Nexus platform continuity evidence…" />;
  if (!loading && loadError && !data) return <WorkspaceErrorState className="mt-4" title="Nexus Platform Recovery is unavailable" description={loadError} onRetry={load} retryLabel="Retry recovery" onSecondaryAction={() => navigate("/deployment-hub")} secondaryLabel="Open Deployment Hub" />;

  return <div className="space-y-5 pb-10" data-testid="nexus-continuity-page">
    <OperationalPageHeader eyebrow="Nexus Platform Continuity · recovery evidence and fresh-host moves" title="Nexus Platform Recovery" description="Keep Nexus Core recoverable with deliberate restore points, isolated recovery verification and a guarded fresh-host cutover plan." icon={DatabaseBackup} tone="emerald" signal={recovery.status === "verified" ? "healthy" : "attention"} actions={<><Button variant="outline" size="sm" className="rounded-xl" onClick={() => setProfileOpen(true)}><ServerCog className="mr-1.5 h-3.5 w-3.5" />Configure policy</Button><Button size="sm" className="rounded-xl" onClick={() => load({ background: true })} disabled={refreshing}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh evidence</Button></>} />

    <Card className={`${SURFACE} border-emerald-400/20 bg-emerald-400/[0.035]`} data-testid="nexus-continuity-boundary"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Recovery boundary</p><p className="mt-1 text-sm font-semibold">A platform restore is a controlled fresh-host recovery—not a live database rewind.</p><p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">{data?.boundary || "Nexus retains policy and evidence only. Host-run recovery tooling creates and validates packages for the attested encrypted destination; secrets remain in the approved secret manager and live data is never overwritten from this page."}</p></div><Badge variant="outline" className={status.className}><StatusIcon className="mr-1.5 h-3.5 w-3.5" />{status.label}</Badge></CardContent></Card>

    {loadError && <Card className={`${SURFACE} border-amber-400/25 bg-amber-400/[0.04]`}><CardContent className="flex items-center justify-between gap-4 p-4"><div><p className="text-sm font-medium">The latest recovery evidence refresh did not complete</p><p className="mt-1 text-xs text-muted-foreground">{loadError} Nexus did not start a capture or restore because the view failed to refresh.</p></div><Button size="sm" variant="outline" onClick={() => load({ background: true })}>Retry</Button></CardContent></Card>}

    <NexusVerifiedSequence stages={["Policy", "Capture", "Manifest", "Isolated restore", "Cutover"]} complete={flowComplete} label="Nexus Platform Recovery" />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Recovery posture" value={status.label} detail={recovery.detail || "Review policy and restore evidence."} tone={recovery.status === "verified" ? "emerald" : "amber"} /><Metric label="Restore points" value={points.length} detail="Accountable host-capture requests and evidence" tone="cyan" /><Metric label="Isolated tests" value={runs.filter((run) => run.status === "passed").length} detail={`${runs.length} retained verification run${runs.length === 1 ? "" : "s"}`} tone="emerald" /><Metric label="Cutover plans" value={cutovers.length} detail="Fresh-host plans; no live cutover is automated" tone="zinc" /></div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]"><Card className={SURFACE}><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Recovery policy</p><h2 className="mt-1 text-base font-semibold">What Nexus will expect from a real platform backup</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Policy tells operators where recovery evidence belongs. The host runner—not the browser—creates a validated package for the attested encrypted destination.</p></div><Button size="sm" variant="outline" className="w-fit" onClick={() => setProfileOpen(true)}>Edit policy</Button></div><div className="grid gap-3 p-4 sm:grid-cols-2"><Detail label="Destination">{profile.destination_name || "Not configured"}<p className="mt-1 text-xs text-muted-foreground">{profile.destination_type ? profile.destination_type.replaceAll("_", " ") : "Choose an approved off-host destination"}</p></Detail><Detail label="RPO and retention">Every {profile.rpo_hours || 24}h · {profile.retention_days || 30} days<p className="mt-1 text-xs text-muted-foreground">{profile.cadence || "daily"} capture policy</p></Detail><Detail label="Protection">{profile.encryption_attested && profile.immutable_storage_attested ? "Encrypted + immutable attested" : "Attestations missing"}<p className="mt-1 text-xs text-muted-foreground">No credentials or secret values are stored in Nexus policy.</p></Detail><Detail label="Owner">{profile.owner || "Name an accountable recovery owner"}<p className="mt-1 text-xs text-muted-foreground">Uploads: {profile.include_uploads ? "included" : "excluded"} · Installers: {profile.include_agent_installers ? "included" : "excluded"}</p></Detail></div></CardContent></Card>
      <Card className={`${SURFACE} border-cyan-400/20 bg-cyan-400/[0.025]`}><CardHeader className="border-b border-border/70 pb-3"><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-cyan-300" />Secret boundary</CardTitle><p className="text-xs leading-5 text-muted-foreground">A backup archive must never become a credential store. Confirm identifiers during recovery and retrieve values only through the approved secret manager.</p></CardHeader><CardContent className="space-y-3 p-4">{(data?.required_secret_identifiers || []).map((item) => <div key={item.id} className="rounded-xl border border-border/70 bg-muted/[0.10] p-3"><p className="text-sm font-medium">{item.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p></div>)}<Button asChild variant="ghost" size="sm" className="w-full justify-between"><Link to="/settings?tab=integrations">Review integrations and secret owners<ArrowRight className="h-3.5 w-3.5" /></Link></Button></CardContent></Card></div>

    <Card className={SURFACE} data-testid="nexus-continuity-restore-points"><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Platform restore points</p><h2 className="mt-1 text-base font-semibold">Capture, retain the manifest, then prove recovery</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">A capture request becomes a recovery point only after the host runner reports its non-secret manifest. A recorded package still needs an isolated restore test.</p></div><Button size="sm" className="w-fit rounded-xl" onClick={() => setRestorePointOpen(true)} disabled={!profile.configured}><ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />Request restore point</Button></div><div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(350px,0.9fr)]"><div className="space-y-2">{points.length ? points.map((point) => { const meta = statusMeta(point.status); const PointIcon = meta.icon; const selected = point.id === selectedPoint?.id; return <button type="button" key={point.id} onClick={() => setSelectedPointId(point.id)} className={`w-full rounded-xl border p-4 text-left transition ${selected ? "border-emerald-400/40 bg-emerald-400/[0.06]" : "border-border/70 bg-muted/[0.07] hover:border-emerald-400/25"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">{point.kind === "pre_change" ? "Pre-change restore point" : point.kind === "scheduled" ? "Scheduled restore point" : "Manual restore point"}</p><p className="mt-1 text-xs text-muted-foreground">{point.reason}</p></div><Badge variant="outline" className={meta.className}><PointIcon className="mr-1 h-3 w-3" />{meta.label}</Badge></div><p className="mt-3 text-[11px] text-muted-foreground">Requested {formatDate(point.requested_at)} · {point.requested_by || "Nexus administrator"}</p></button>; }) : <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-6 text-center"><ArchiveRestore className="h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No platform restore point has been requested</p><p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">Configure the off-host recovery policy, then request a restore point before a release, import, server move or major change.</p></div>}</div><div className="rounded-2xl border border-border/70 bg-muted/[0.08] p-4">{selectedPoint ? <><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Selected restore point</p><p className="mt-1 text-sm font-semibold">{selectedPoint.reason}</p></div><Badge variant="outline" className={statusMeta(selectedPoint.status).className}>{statusMeta(selectedPoint.status).label}</Badge></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><Detail label="Capture evidence">{selectedPoint.evidence ? "Manifest retained" : "Awaiting host runner"}</Detail><Detail label="Requested">{formatDate(selectedPoint.requested_at)}</Detail></div><div className="mt-4 flex flex-wrap gap-2">{selectedPoint.status === "awaiting_host_capture" && <Button size="sm" onClick={() => setEvidenceOpen(true)}><UploadCloud className="mr-1.5 h-3.5 w-3.5" />Record capture evidence</Button>}{selectedPoint.status === "captured_unverified" && <Button size="sm" onClick={() => setVerificationOpen(true)}><LaptopMinimalCheck className="mr-1.5 h-3.5 w-3.5" />Verify in isolation</Button>}{selectedPoint.status === "verified" && <Button size="sm" onClick={() => setCutoverOpen(true)}><ServerCog className="mr-1.5 h-3.5 w-3.5" />Plan fresh-host recovery</Button>}<Button size="sm" variant="outline" asChild><a href="#recovery-runbook"><FileKey2 className="mr-1.5 h-3.5 w-3.5" />Host runbook</a></Button></div></> : <p className="text-sm text-muted-foreground">Select a restore point to continue its accountable recovery workflow.</p>}</div></div></CardContent></Card>

    <div className="grid gap-5 xl:grid-cols-2"><Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-amber-300" />Isolated recovery verification</CardTitle><p className="text-xs leading-5 text-muted-foreground">Each run confirms recovery in a non-production target. A pass never rewinds the current platform.</p></CardHeader><CardContent className="divide-y divide-border/60 p-0">{runs.length ? runs.slice(0, 8).map((run) => <div key={run.id} className="flex items-start justify-between gap-4 px-4 py-3"><div><p className="text-sm font-medium">{run.target_label}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(run.created_at)} · restore point {String(run.restore_point_id || "").slice(0, 8)}</p></div><Badge variant="outline" className={statusMeta(run.status).className}>{statusMeta(run.status).label}</Badge></div>) : <div className="px-6 py-12 text-center text-sm text-muted-foreground">No isolated restore verification is retained yet.</div>}</CardContent></Card><Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><CardTitle className="flex items-center gap-2 text-base"><ServerCog className="h-4 w-4 text-violet-300" />Fresh-host cutover plans</CardTitle><p className="text-xs leading-5 text-muted-foreground">A plan is a protected change record, not an automatic failover. It preserves the source host and requires a verified restore point.</p></CardHeader><CardContent className="divide-y divide-border/60 p-0">{cutovers.length ? cutovers.slice(0, 8).map((plan) => <div key={plan.id} className="px-4 py-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{plan.target_label}</p><p className="mt-1 text-xs text-muted-foreground">{plan.change_reference} · {plan.planned_window}</p></div><Badge variant="outline" className="border-violet-400/25 bg-violet-400/[0.06] text-violet-200">planned</Badge></div></div>) : <div className="px-6 py-12 text-center text-sm text-muted-foreground">No fresh-host cutover plan is retained yet.</div>}</CardContent></Card></div>

    <Card id="recovery-runbook" className={`${SURFACE} border-cyan-400/20 bg-cyan-400/[0.025]`}><CardContent className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto]"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Host runner required</p><h2 className="mt-1 text-lg font-semibold">Use the recovery scripts from a privileged, controlled host</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">The API is intentionally not a database-administration tool. The exported host scripts package MongoDB, durable file artefacts, manifest and checksums; the importer validates first and refuses to overwrite a non-empty target by default.</p><div className="mt-4 grid gap-3 sm:grid-cols-3">{(data?.restore_sequence || []).slice(0, 3).map((step, index) => <div key={step} className="rounded-xl border border-border/70 bg-muted/[0.10] p-3 text-xs leading-5"><span className="font-semibold text-cyan-200">{index + 1}. </span>{step}</div>)}</div></div><div className="flex flex-col gap-2"><Button variant="outline" asChild><Link to="/deployment-hub">Open Deployment Hub<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button variant="outline" asChild><Link to="/production-readiness">Open readiness gates<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></div></CardContent></Card>

    <ProfileDialog open={profileOpen} profile={profile} destinations={data?.destinations || []} saving={saving} onOpenChange={setProfileOpen} onSave={saveProfile} />
    <RestorePointDialog open={restorePointOpen} saving={saving} onOpenChange={setRestorePointOpen} onSave={requestPoint} />
    <CaptureEvidenceDialog open={evidenceOpen} point={selectedPoint} saving={saving} onOpenChange={setEvidenceOpen} onSave={recordEvidence} />
    <VerificationDialog open={verificationOpen} point={selectedPoint} saving={saving} onOpenChange={setVerificationOpen} onSave={recordVerification} />
    <CutoverDialog open={cutoverOpen} point={selectedPoint} saving={saving} onOpenChange={setCutoverOpen} onSave={createCutover} />
  </div>;
}
