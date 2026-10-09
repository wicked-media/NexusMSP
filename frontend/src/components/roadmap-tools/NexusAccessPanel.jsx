import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

/**
 * Nexus Access — credential-rotation boundaries merged into the Nexus Elevate
 * workspace (roadmap #488). Records schedule and evidence only: credential
 * material is refused server-side and never requested here.
 */
export default function NexusAccessPanel() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [overview, setOverview] = useState(null);
  const [boundaries, setBoundaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState("");
  const [intervalDays, setIntervalDays] = useState("90");
  const [owner, setOwner] = useState("");
  const [saving, setSaving] = useState(false);
  const [evidenceFor, setEvidenceFor] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewResponse, boundariesResponse] = await Promise.all([
        axios.get(`${API}/nexus-access/overview`, { headers }),
        axios.get(`${API}/nexus-access/rotation-boundaries`, { headers }),
      ]);
      setOverview(overviewResponse.data);
      setBoundaries(boundariesResponse.data?.boundaries || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Access could not load");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const createBoundary = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/nexus-access/rotation-boundaries`, {
        label, provider, interval_days: Number(intervalDays), owner,
      }, { headers });
      toast.success("Rotation boundary registered — schedule and evidence only, never credential material.");
      setLabel(""); setProvider(""); setOwner("");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Rotation boundary could not be registered");
    } finally {
      setSaving(false);
    }
  };

  const recordRotation = async (boundaryId) => {
    if (!evidenceNote.trim()) return;
    setSaving(true);
    try {
      await axios.post(`${API}/nexus-access/rotation-boundaries/${boundaryId}/record-rotation`, {
        evidence_note: evidenceNote.trim(),
      }, { headers });
      toast.success("Rotation recorded and the schedule advanced.");
      setEvidenceFor(""); setEvidenceNote("");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Rotation could not be recorded");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-emerald-400/20 bg-emerald-400/[0.03]" data-testid="nexus-access-panel">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200">Nexus Access · credential rotation</p>
            <p className="mt-1 text-sm font-semibold">Just-in-time access is brokered above; rotation boundaries live here.</p>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Nexus records when each managed credential rotates and who evidenced it. Credential material is never accepted, stored or displayed.</p>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>
        </div>

        {overview && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{overview.boundaries_total} boundaries</Badge>
            <Badge variant="outline" className={overview.rotations_due ? "border-amber-400/30 text-amber-200" : ""}>{overview.rotations_due} due</Badge>
            <Badge variant="outline" className={overview.rotations_overdue ? "border-rose-400/30 text-rose-200" : ""}>{overview.rotations_overdue} overdue</Badge>
            <Badge variant="outline">{overview.active_access_requests} access requests in review</Badge>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-5">
          <Input placeholder="Credential label" value={label} onChange={(event) => setLabel(event.target.value)} data-testid="nexus-access-label" />
          <Input placeholder="Provider (e.g. windows-laps)" value={provider} onChange={(event) => setProvider(event.target.value)} data-testid="nexus-access-provider" />
          <Input type="number" min={1} max={365} value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} aria-label="Rotation interval in days" data-testid="nexus-access-interval" />
          <Input placeholder="Owner" value={owner} onChange={(event) => setOwner(event.target.value)} data-testid="nexus-access-owner" />
          <Button onClick={createBoundary} disabled={saving || label.trim().length < 3 || !provider.trim() || !Number(intervalDays)} data-testid="nexus-access-create">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Register boundary"}</Button>
        </div>

        <div className="space-y-2">
          {loading ? <p className="text-xs text-muted-foreground">Loading rotation register…</p> : boundaries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No rotation boundaries yet. Register one above to start governing rotation schedules.</p>
          ) : boundaries.map((boundary) => (
            <div key={boundary.id} className="rounded-xl border border-border/60 p-3" data-testid={`nexus-access-boundary-${boundary.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{boundary.label}</p>
                  <p className="text-[11px] text-muted-foreground">{boundary.provider} · every {boundary.interval_days} days · {boundary.owner || "no owner recorded"} · {boundary.rotation_count} rotation(s)</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={boundary.overdue ? "border-rose-400/30 text-rose-200" : boundary.due ? "border-amber-400/30 text-amber-200" : "border-emerald-400/30 text-emerald-200"}>
                    {boundary.overdue ? "Overdue" : boundary.due ? "Rotation due" : `Due in ${boundary.days_remaining}d`}
                  </Badge>
                  {evidenceFor === boundary.id ? (
                    <div className="flex gap-1.5">
                      <Input className="h-8 w-56 text-xs" placeholder="Rotation evidence note" value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} data-testid="nexus-access-evidence" />
                      <Button size="sm" className="h-8" onClick={() => recordRotation(boundary.id)} disabled={saving || !evidenceNote.trim()}>Record</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => { setEvidenceFor(boundary.id); setEvidenceNote(""); }}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Record rotation</Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
