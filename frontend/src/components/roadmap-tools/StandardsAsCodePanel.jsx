import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Scale, FileCheck2 } from "lucide-react";
import { toast } from "sonner";

function parseControls(text) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [ref, ...rest] = line.split("|");
    return { ref: (ref || "").trim().slice(0, 60), requirement: rest.join("|").trim().slice(0, 500) };
  }).filter((control) => control.ref && control.requirement);
}

/**
 * Standards as code — versioned customer standards merged into the Expected
 * State workspace (roadmap #501). Every change is an immutable numbered
 * revision, impact is calculated before adoption, and remediation is always
 * staged behind an approval.
 */
export default function StandardsAsCodePanel() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [standards, setStandards] = useState([]);
  const [policy, setPolicy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [controlsText, setControlsText] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [impactFor, setImpactFor] = useState(null);
  const [impact, setImpact] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/expected-state/standards`, { headers });
      setStandards(response.data?.standards || []);
      setPolicy(response.data?.policy || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Standards could not be loaded");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const controls = parseControls(controlsText);
    if (!controls.length) {
      toast.error("Enter at least one control as REF|requirement per line.");
      return;
    }
    setSaving(true);
    try {
      if (impactFor) {
        await axios.post(`${API}/expected-state/standards`, {
          standard_id: impactFor.id, controls, change_note: changeNote.trim() || "Revision",
        }, { headers });
        toast.success(`Revision recorded for ${impactFor.name} — the previous revision is retained.`);
      } else {
        await axios.post(`${API}/expected-state/standards`, {
          name: name.trim(), controls, change_note: changeNote.trim() || "Initial revision",
        }, { headers });
        toast.success("Standard created with its first revision.");
      }
      setName(""); setControlsText(""); setChangeNote(""); setImpactFor(null); setImpact(null);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Standard could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const previewImpact = async (standard) => {
    const controls = parseControls(controlsText);
    if (!controls.length) {
      toast.error("Enter the proposed controls first (REF|requirement per line).");
      return;
    }
    try {
      const response = await axios.post(`${API}/expected-state/standards/${standard.id}/impact`, { controls }, { headers });
      setImpactFor(standard);
      setImpact(response.data?.impact);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Impact could not be calculated");
    }
  };

  const stageRemediation = async (standard) => {
    const title = window.prompt("Staged remediation title?");
    const plan = window.prompt("Remediation plan (executed only after approval in the owning workspace)?");
    if (!title?.trim() || !plan?.trim()) return;
    try {
      await axios.post(`${API}/expected-state/standards/${standard.id}/staged-remediations`, { title: title.trim(), plan: plan.trim(), target: "all_clients" }, { headers });
      toast.success("Remediation staged behind approval.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Remediation could not be staged");
    }
  };

  return (
    <Card className="border-cyan-400/20 bg-cyan-400/[0.03]" data-testid="standards-as-code-panel">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">Standards as code</p>
            <p className="mt-1 text-sm font-semibold">Customer standards versioned as reviewable, immutable revisions.</p>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{policy[0]} {policy[1]} {policy[2]}</p>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>
        </div>

        <div className="space-y-2">
          <Input placeholder={impactFor ? `New revision for ${impactFor.name}` : "Standard name (new standard)"} value={impactFor ? impactFor.name : name} onChange={(event) => setName(event.target.value)} disabled={Boolean(impactFor)} data-testid="standards-name" />
          <textarea
            className="min-h-20 w-full rounded-md border border-border bg-background/60 px-3 py-2 text-xs"
            placeholder={"One control per line as REF|requirement — e.g. AU-1|MFA on all admins"}
            value={controlsText}
            onChange={(event) => setControlsText(event.target.value)}
            data-testid="standards-controls"
          />
          <div className="flex flex-wrap gap-2">
            <Input className="flex-1" placeholder="Change note" value={changeNote} onChange={(event) => setChangeNote(event.target.value)} data-testid="standards-change-note" />
            <Button variant="outline" onClick={() => previewImpact({ id: impactFor?.id || standards[0]?.id, name: impactFor?.name || standards[0]?.name })} disabled={!standards.length && !impactFor}><Scale className="mr-1.5 h-3.5 w-3.5" />Preview impact</Button>
            <Button onClick={save} disabled={saving || (!impactFor && name.trim().length < 3)} data-testid="standards-save">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><FileCheck2 className="mr-1.5 h-3.5 w-3.5" />{impactFor ? "Record revision" : "Create standard"}</>}
            </Button>
            {impactFor && <Button variant="ghost" onClick={() => { setImpactFor(null); setImpact(null); }}>Cancel revision</Button>}
          </div>
          {impact && (
            <div className="rounded-lg border border-cyan-400/25 bg-cyan-400/[0.05] p-3 text-xs" data-testid="standards-impact">
              <p className="font-semibold text-cyan-100">Impact preview · {impact.impacted_controls.length} control(s) affected</p>
              <p className="mt-1 text-muted-foreground">Added: {impact.added.join(", ") || "none"} · Removed: {impact.removed.join(", ") || "none"} · Changed: {impact.changed.join(", ") || "none"} · Unchanged: {impact.unchanged}</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {loading ? <p className="text-xs text-muted-foreground">Loading standards…</p> : standards.length === 0 ? (
            <p className="text-xs text-muted-foreground">No standards yet. Create one above — every future change is retained as a numbered revision.</p>
          ) : standards.map((standard) => (
            <div key={standard.id} className="rounded-xl border border-border/60 p-3" data-testid={`standard-${standard.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{standard.name}</p>
                  <p className="text-[11px] text-muted-foreground">Revision {standard.current_revision} · {standard.revision_count} retained revision(s) · {standard.controls.length} control(s)</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-8" onClick={() => { setImpactFor(standard); setImpact(null); setControlsText(standard.controls.map((control) => `${control.ref}|${control.requirement}`).join("\n")); }}>New revision</Button>
                  <Button size="sm" variant="outline" className="h-8" onClick={() => stageRemediation(standard)}>Stage remediation</Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {standard.controls.slice(0, 8).map((control) => <Badge key={control.ref} variant="outline" className="text-[9px]" title={control.requirement}>{control.ref}</Badge>)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
