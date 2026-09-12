import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { toast } from "sonner";
import {
  Wrench, Search, RefreshCw, Loader2, Clock, AlertTriangle, GripVertical, Monitor, Timer, Ticket, ArrowRight
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
      className="p-3 rounded-xl border border-border/70 bg-card hover:border-primary/35 hover:shadow-lg hover:shadow-primary/5 transition-all cursor-grab active:cursor-grabbing active:shadow-lg group"
      data-testid={`bench-card-${job.id}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <GripVertical className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="text-[10px] font-mono font-semibold text-primary/80">{job.job_number || "WS-?"}</span>
        <span className="ml-auto text-[9px] text-muted-foreground">{daysIn === 0 ? "Today" : `${daysIn}d in bench`}</span>
      </div>
      <p className="text-xs font-semibold leading-snug line-clamp-2 mb-2">{job.title || job.description || "Workshop repair"}</p>
      <div className="flex items-center justify-between text-[10px] border-t border-border/45 pt-2">
        <span className="text-muted-foreground truncate max-w-[55%]">{job.client_name || "Walk-in customer"}</span>
        {job.assigned_to_name && (
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center"><span className="text-[8px] font-medium text-primary">{job.assigned_to_name.charAt(0)}</span></div>
            <span className="text-primary">{job.assigned_to_name.split(" ")[0]}</span>
          </div>
        )}
      </div>
      {job.device_name && <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground"><Monitor className="w-3 h-3 text-primary/70" />{job.device_name}</div>}
      {daysIn >= 3 && <div className="flex items-center gap-1 mt-2 text-[9px] text-red-300"><Timer className="w-3 h-3" />Attention: {daysIn} days in workshop</div>}
    </div>
  );
}

function BenchColumn({ col, jobs, onDrop, onDragStart, dragOver, setDragOver }) {
  return (
    <div className={`rounded-xl border border-t-4 ${col.color} bg-muted/[0.12] flex flex-col min-h-[55vh] transition-all ${dragOver === col.id ? "ring-2 ring-primary/30 bg-primary/5 scale-[1.01]" : ""}`}
      onDragOver={e => { e.preventDefault(); setDragOver(col.id); }} onDragLeave={() => setDragOver(null)}
      onDrop={e => { e.preventDefault(); setDragOver(null); onDrop(col.id); }}
      data-testid={`bench-col-${col.id}`}>
      <div className="p-3 border-b flex items-center justify-between flex-shrink-0 bg-background/40">
        <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${col.dot} shadow-[0_0_8px_currentColor]`} /><h3 className="font-semibold text-xs">{col.title}</h3></div>
        <Badge variant="outline" className="text-[10px] font-mono rounded-md">{jobs.length}</Badge>
      </div>
      <p className="text-[9px] text-muted-foreground/65 px-3 pt-2 leading-snug">{col.desc}</p>
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
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState(null);
  const [dragging, setDragging] = useState(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/workshop/bench`, { headers });
      setJobs(res.data);
    } catch { toast.error("Failed to load workshop jobs"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleDragStart = (e, job) => { setDragging(job); e.dataTransfer.effectAllowed = "move"; };

  const handleDrop = async (newStage) => {
    if (!dragging || dragging.bench_stage === newStage) { setDragging(null); return; }
    setJobs(prev => prev.map(j => j.id === dragging.id ? { ...j, bench_stage: newStage } : j));
    try {
      await axios.put(`${API}/workshop/bench/move`, { job_id: dragging.id, stage: newStage }, { headers });
      toast.success(`Moved to ${newStage.replace("_", " ")}`);
    } catch { toast.error("Move failed"); fetchJobs(); }
    setDragging(null);
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
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/[0.12] via-primary/[0.035] to-transparent px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center"><Wrench className="w-5 h-5 text-primary" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold tracking-tight">Workshop Bench</h1><Badge variant="outline" className="border-amber-400/25 bg-amber-400/[0.08] text-[10px] text-amber-100">Legacy records</Badge></div>
            <p className="text-muted-foreground text-xs mt-0.5">Track retained bench work here. New workshop requests start in Service Desk with a Workshop Repair Kit.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchJobs} disabled={loading}><RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
          <Button size="sm" onClick={() => navigate("/tickets?new=workshop_repair")} data-testid="create-workshop-service-kit"><Ticket className="w-4 h-4 mr-1" />Create through Service Desk<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-cyan-400/18 bg-cyan-400/[0.035] px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="workshop-bench-service-desk-note">
        <div className="flex min-w-0 items-start gap-3"><div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/[0.08]"><Ticket className="h-4 w-4 text-cyan-100" /></div><div><p className="text-sm font-medium text-cyan-50">Service Desk owns the customer request</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">The Workshop Repair Kit creates structured repair evidence beneath its parent ticket. This board keeps pre-existing standalone records available without splitting new work into a second queue.</p></div></div>
        <Button variant="outline" size="sm" className="shrink-0 border-cyan-300/25 bg-cyan-400/[0.04] text-cyan-100 hover:bg-cyan-400/[0.12]" onClick={() => navigate("/tickets?new=workshop_repair")}>New kit</Button>
      </div>

      <MetricStrip columns={4}>
        <MetricTile label="Legacy bench" value={jobs.length} accent="violet" icon={<Wrench className="w-2.5 h-2.5 text-violet-400" />} testid="bench-metric-total" />
        <MetricTile label="In progress" value={totalActive} accent="sky" icon={<Timer className="w-2.5 h-2.5 text-sky-400" />} testid="bench-metric-active" />
        <MetricTile label="Avg turnaround" value={`${avgDays}d`} accent="emerald" icon={<Clock className="w-2.5 h-2.5 text-emerald-400" />} testid="bench-metric-turnaround" />
        <MetricTile label="Needs attention" value={jobs.filter(j => j.created_at && (Date.now() - new Date(j.created_at)) >= 3 * 86400000).length} accent="rose" icon={<AlertTriangle className="w-2.5 h-2.5 text-rose-400" />} testid="bench-metric-attention" />
      </MetricStrip>

      <div className="flex items-center gap-3 rounded-xl border bg-card/60 p-3">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" /><Input placeholder="Search retained job, customer or device..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" data-testid="bench-search" /></div>
        <span className="text-xs text-muted-foreground hidden sm:block">{search ? "Filtered legacy board" : "Legacy repair board"}</span>
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
    </div>
  );
}
