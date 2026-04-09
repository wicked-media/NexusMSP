import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Wrench, Search, RefreshCw, Loader2, Clock, AlertTriangle, Plus,
  User, GripVertical, Monitor, Package, CheckCircle, Timer
} from "lucide-react";

const BENCH_COLUMNS = [
  { id: "intake", title: "Intake", color: "border-t-blue-500", dot: "bg-blue-400", desc: "Received, awaiting diagnosis" },
  { id: "diagnosing", title: "Diagnosing", color: "border-t-amber-500", dot: "bg-amber-400", desc: "Under investigation" },
  { id: "parts_ordered", title: "Parts Ordered", color: "border-t-purple-500", dot: "bg-purple-400", desc: "Waiting on parts" },
  { id: "repairing", title: "Repairing", color: "border-t-cyan-500", dot: "bg-cyan-400", desc: "Active repair work" },
  { id: "testing", title: "Testing / QA", color: "border-t-emerald-500", dot: "bg-emerald-400", desc: "Verifying fix" },
  { id: "ready", title: "Ready for Pickup", color: "border-t-green-500", dot: "bg-green-400", desc: "Complete, awaiting client" },
];

function BenchCard({ job, onDragStart }) {
  const daysIn = job.created_at ? Math.floor((Date.now() - new Date(job.created_at)) / 86400000) : 0;
  return (
    <div draggable onDragStart={e => onDragStart(e, job)}
      className="p-3 rounded-lg border bg-card hover:shadow-md transition-all cursor-grab active:cursor-grabbing active:shadow-lg group"
      data-testid={`bench-card-${job.id}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <GripVertical className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="text-[10px] font-mono text-muted-foreground">{job.job_number || "WS-?"}</span>
        {daysIn >= 3 && <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px] px-1 py-0"><Timer className="w-2.5 h-2.5 mr-0.5" />{daysIn}d</Badge>}
      </div>
      <p className="text-xs font-medium line-clamp-2 mb-1.5">{job.title || job.description}</p>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground truncate max-w-[55%]">{job.client_name}</span>
        {job.assigned_to_name && (
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center"><span className="text-[8px] font-medium text-primary">{job.assigned_to_name.charAt(0)}</span></div>
            <span className="text-primary">{job.assigned_to_name.split(" ")[0]}</span>
          </div>
        )}
      </div>
      {job.device_name && <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground"><Monitor className="w-2.5 h-2.5" />{job.device_name}</div>}
    </div>
  );
}

function BenchColumn({ col, jobs, onDrop, onDragStart, dragOver, setDragOver }) {
  return (
    <div className={`rounded-lg border border-t-4 ${col.color} bg-muted/10 flex flex-col min-h-[55vh] transition-all ${dragOver === col.id ? "ring-2 ring-primary/30 bg-primary/5" : ""}`}
      onDragOver={e => { e.preventDefault(); setDragOver(col.id); }} onDragLeave={() => setDragOver(null)}
      onDrop={e => { e.preventDefault(); setDragOver(null); onDrop(col.id); }}
      data-testid={`bench-col-${col.id}`}>
      <div className="p-2.5 border-b flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${col.dot}`} /><h3 className="font-semibold text-xs">{col.title}</h3></div>
        <Badge variant="outline" className="text-[10px]">{jobs.length}</Badge>
      </div>
      <p className="text-[9px] text-muted-foreground/60 px-2.5 pt-1">{col.desc}</p>
      <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[55vh]">
        {jobs.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-[10px] text-muted-foreground/40 border border-dashed rounded-lg">Drop here</div>
        ) : jobs.map(j => <BenchCard key={j.id} job={j} onDragStart={onDragStart} />)}
      </div>
    </div>
  );
}

export default function WorkshopBenchPage() {
  const { token } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ title: "", description: "", client_name: "", device_name: "", assigned_to_name: "" });
  const [creating, setCreating] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/workshop/bench`, { headers });
      setJobs(res.data);
    } catch { toast.error("Failed to load workshop jobs"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleDragStart = (e, job) => { setDragging(job); e.dataTransfer.effectAllowed = "move"; };

  const handleDrop = async (newStage) => {
    if (!dragging || dragging.bench_stage === newStage) { setDragging(null); return; }
    const oldStage = dragging.bench_stage;
    setJobs(prev => prev.map(j => j.id === dragging.id ? { ...j, bench_stage: newStage } : j));
    try {
      await axios.put(`${API}/workshop/bench/move`, { job_id: dragging.id, stage: newStage }, { headers });
      toast.success(`Moved to ${newStage.replace("_", " ")}`);
    } catch { toast.error("Move failed"); fetchJobs(); }
    setDragging(null);
  };

  const createJob = async () => {
    if (!newForm.title) { toast.error("Title is required"); return; }
    setCreating(true);
    try {
      await axios.post(`${API}/workshop/bench`, newForm, { headers });
      toast.success("Workshop job created");
      setShowNew(false); setNewForm({ title: "", description: "", client_name: "", device_name: "", assigned_to_name: "" });
      fetchJobs();
    } catch { toast.error("Failed to create"); }
    finally { setCreating(false); }
  };

  const byStage = {};
  BENCH_COLUMNS.forEach(c => { byStage[c.id] = []; });
  jobs.filter(j => !search || j.title?.toLowerCase().includes(search.toLowerCase()) || j.client_name?.toLowerCase().includes(search.toLowerCase())).forEach(j => {
    const stage = j.bench_stage || "intake";
    if (byStage[stage]) byStage[stage].push(j); else byStage.intake.push(j);
  });

  const totalActive = jobs.filter(j => j.bench_stage !== "ready").length;
  const avgDays = jobs.length ? Math.round(jobs.reduce((s, j) => s + (j.created_at ? (Date.now() - new Date(j.created_at)) / 86400000 : 0), 0) / jobs.length) : 0;

  return (
    <div className="space-y-4" data-testid="workshop-bench-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Wrench className="w-6 h-6 text-primary" />Workshop Bench</h1>
          <p className="text-muted-foreground text-sm">{jobs.length} jobs &middot; {totalActive} active &middot; {avgDays}d avg turnaround</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchJobs} disabled={loading}><RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
          <Button size="sm" onClick={() => setShowNew(true)} data-testid="new-bench-job"><Plus className="w-4 h-4 mr-1" />New Job</Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" /><Input placeholder="Search jobs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" data-testid="bench-search" /></div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {BENCH_COLUMNS.map(col => (
            <BenchColumn key={col.id} col={col} jobs={byStage[col.id]} onDrop={handleDrop} onDragStart={handleDragStart} dragOver={dragOver} setDragOver={setDragOver} />
          ))}
        </div>
      )}

      {/* New Job Dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent aria-describedby="new-bench-job-desc">
          <DialogHeader><DialogTitle>New Workshop Job</DialogTitle><DialogDescription id="new-bench-job-desc">Create a workshop repair/service job</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label>Job Title *</Label><Input value={newForm.title} onChange={e => setNewForm({ ...newForm, title: e.target.value })} placeholder="e.g. Replace laptop screen" data-testid="bench-title" /></div>
            <div><Label>Description</Label><Textarea value={newForm.description} onChange={e => setNewForm({ ...newForm, description: e.target.value })} rows={2} placeholder="Details of the repair" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Client</Label><Input value={newForm.client_name} onChange={e => setNewForm({ ...newForm, client_name: e.target.value })} placeholder="Client name" /></div>
              <div><Label>Device</Label><Input value={newForm.device_name} onChange={e => setNewForm({ ...newForm, device_name: e.target.value })} placeholder="Device name/model" /></div>
            </div>
            <div><Label>Assign To</Label><Input value={newForm.assigned_to_name} onChange={e => setNewForm({ ...newForm, assigned_to_name: e.target.value })} placeholder="Technician name" /></div>
          </div>
          <DialogFooter><Button onClick={createJob} disabled={creating} data-testid="create-bench-btn">{creating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}Create Job</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
