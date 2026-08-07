import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Edit } from "lucide-react";
import { toast } from "sonner";

const skillLevels = { 0: "None", 1: "Basic", 2: "Intermediate", 3: "Advanced", 4: "Expert" };
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

  return (
    <div className="space-y-6" data-testid="skills-matrix-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Technician Skills Matrix</h1>
        <p className="text-muted-foreground text-sm mt-1">Skills inventory with auto-matching for ticket assignment</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />Skills Matrix</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card z-10">Technician</TableHead>
                  {data.all_skills.map(s => <TableHead key={s} className="text-center capitalize text-xs">{s}</TableHead>)}
                  <TableHead>Certs</TableHead>
                  <TableHead className="text-right">Resolved</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.technicians.map(tech => (
                  <TableRow key={tech.user_id} data-testid={`skills-row-${tech.user_id}`}>
                    <TableCell className="font-medium sticky left-0 bg-card">{tech.name}</TableCell>
                    {data.all_skills.map(s => {
                      const level = tech.skills[s] || 0;
                      return (
                        <TableCell key={s} className="text-center">
                          <span className={`text-xs font-medium ${skillColors[level]}`}>
                            {level > 0 ? `${"*".repeat(level)}` : "-"}
                          </span>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="flex items-center gap-2 text-xs"><span className="text-slate-400">-</span> None</div>
        <div className="flex items-center gap-2 text-xs"><span className="text-blue-400">*</span> Basic</div>
        <div className="flex items-center gap-2 text-xs"><span className="text-blue-500">**</span> Intermediate</div>
        <div className="flex items-center gap-2 text-xs"><span className="text-green-500">***</span> Advanced</div>
      </div>

      {editing && (
        <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Skills: {editing.name}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {data.all_skills.map(s => (
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
              <Button onClick={saveSkills} className="w-full" data-testid="save-skills">Save Skills</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
