import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Users, Edit, Target, Award, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const skillColors = { 0: "text-slate-400", 1: "text-blue-400", 2: "text-blue-500", 3: "text-green-500", 4: "text-amber-500" };

export default function SkillsMatrixPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editSkills, setEditSkills] = useState({});
  const [editCerts, setEditCerts] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = () => {
    axios.get(`${API}/skills-matrix`, { headers })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (tech) => {
    setEditing(tech);
    setEditSkills({ ...tech.skills });
    setEditCerts((tech.certifications || []).join(", "));
  };

  const saveSkills = async () => {
    try {
      await axios.put(`${API}/skills-matrix/${editing.user_id}`, {
        skills: editSkills,
        certifications: editCerts.split(",").map(c => c.trim()).filter(Boolean),
      }, { headers });
      toast.success("Skills updated");
      setEditing(null);
      fetchData();
    } catch { toast.error("Update failed"); }
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;
  const technicians = data.technicians || [];
  const allSkills = data.all_skills || [];
  const assessedSkills = technicians.reduce((total, technician) => total + allSkills.filter(skill => (technician.skills?.[skill] || 0) > 0).length, 0);
  const possibleSkills = technicians.length * allSkills.length;
  const coverage = possibleSkills ? Math.round((assessedSkills / possibleSkills) * 100) : 0;
  const expertCapabilities = technicians.reduce((total, technician) => total + allSkills.filter(skill => (technician.skills?.[skill] || 0) === 4).length, 0);

  return (
    <div className="space-y-6" data-testid="skills-matrix-page">
      <section className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_86%_0%,hsl(var(--primary)/0.2),transparent_38%),linear-gradient(120deg,hsl(var(--card)),hsl(var(--background)))] p-5 shadow-[0_16px_42px_-30px_hsl(var(--primary)/0.7)] lg:flex-row lg:items-center lg:justify-between">
        <div><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><Target className="h-5 w-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Team capability</p><h1 className="text-2xl font-bold tracking-tight">Skills coverage matrix</h1></div></div><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Nexus uses these declared capabilities to provide better technician matching, escalation context, and coverage visibility.</p></div>
        <div className="grid grid-cols-3 gap-2"><div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-center"><p className="text-lg font-bold text-primary">{technicians.length}</p><p className="text-[10px] text-muted-foreground">technicians</p></div><div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-center"><p className="text-lg font-bold">{coverage}%</p><p className="text-[10px] text-muted-foreground">coverage</p></div><div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-center"><p className="text-lg font-bold text-amber-500">{expertCapabilities}</p><p className="text-[10px] text-muted-foreground">expert skills</p></div></div>
      </section>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />Skills Matrix</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card z-10">Technician</TableHead>
                  {allSkills.map(s => <TableHead key={s} className="text-center capitalize text-xs">{s}</TableHead>)}
                  <TableHead>Certs</TableHead>
                  <TableHead className="text-right">Resolved</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {technicians.map(tech => (
                  <TableRow key={tech.user_id} data-testid={`skills-row-${tech.user_id}`}>
                    <TableCell className="font-medium sticky left-0 bg-card">{tech.name}</TableCell>
                    {allSkills.map(s => {
                      const level = tech.skills[s] || 0;
                      return (
                        <TableCell key={s} className="text-center">
                          <span className={`inline-flex min-w-8 items-center justify-center rounded-md border border-current/20 px-1.5 py-1 text-[10px] font-bold ${skillColors[level]}`}>{level > 0 ? `${level}/4` : "—"}</span>
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      {(tech.certifications || []).map((c, i) => (
                        <Badge key={`k-${i}`} variant="outline" className="text-[10px] mr-1">{c}</Badge>
                      ))}
                    </TableCell>
                    <TableCell className="text-right font-mono">{tech.total_resolved}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(tech)} data-testid={`edit-skills-${tech.user_id}`}>
                        <Edit className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="flex items-center gap-2 text-xs"><span className="text-slate-400">-</span> None</div>
        <div className="flex items-center gap-2 text-xs"><span className="text-blue-400">*</span> Basic</div>
        <div className="flex items-center gap-2 text-xs"><span className="text-blue-500">**</span> Intermediate</div>
        <div className="flex items-center gap-2 text-xs"><span className="text-green-500">***</span> Advanced</div>
        <div className="flex items-center gap-2 text-xs"><span className="text-amber-500">4/4</span> Expert</div>
      </div>

      {editing && (
        <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
          <NexusWorkflowDialog eyebrow="Team capability" title={`Edit skills: ${editing.name}`} description="Keep proficiency current so Nexus can make reliable assignment and escalation suggestions." icon={Award} tone="violet" className="max-w-2xl" contentClassName="space-y-3" footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveSkills} data-testid="save-skills"><ShieldCheck className="mr-1.5 h-4 w-4" />Save capabilities</Button></>}>
              <div className="rounded-xl border border-primary/15 bg-primary/[0.035] p-3 text-xs text-muted-foreground">Rate demonstrated delivery capability, not intended learning goals. Level 4 represents a trusted escalation resource for that discipline.</div>
              {allSkills.map(s => (
                <div key={s} className="flex items-center justify-between">
                  <span className="capitalize text-sm">{s}</span>
                  <div className="flex gap-1">
                    {[0,1,2,3,4].map(l => (
                      <Button key={l} variant={editSkills[s] === l ? "default" : "outline"} size="sm" className="h-7 w-7 text-xs p-0"
                        onClick={() => setEditSkills(p => ({ ...p, [s]: l }))} data-testid={`skill-${s}-level-${l}`}>
                        {l}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
              <div>
                <label className="text-sm font-medium">Certifications (comma-separated)</label>
                <Input value={editCerts} onChange={e => setEditCerts(e.target.value)} placeholder="CCNA, Azure, CompTIA..." data-testid="certs-input" />
              </div>
          </NexusWorkflowDialog>
        </Dialog>
      )}
    </div>
  );
}
