import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  MapPin, User, Zap, AlertTriangle, CheckCircle, Clock, RefreshCw,
  Loader2, Navigation, ArrowRight, Truck, Calendar, Phone, Building
} from "lucide-react";

const priorityColors = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  low: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

const statusStyles = {
  available: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  active: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  busy: "bg-red-500/20 text-red-400 border-red-500/30",
};

// Simulated city locations for visual map positioning
function coordsForIndex(i) {
  const positions = [
    { top: "15%", left: "25%" }, { top: "30%", left: "60%" }, { top: "55%", left: "35%" },
    { top: "20%", left: "75%" }, { top: "65%", left: "55%" }, { top: "40%", left: "20%" },
    { top: "75%", left: "70%" }, { top: "10%", left: "45%" }, { top: "50%", left: "80%" },
    { top: "85%", left: "30%" }, { top: "35%", left: "50%" }, { top: "60%", left: "15%" },
  ];
  return positions[i % positions.length];
}

function MapView({ board, onAssign }) {
  if (!board) return null;
  const jobs = board.jobs.filter(j => !j.assigned_to);
  const techs = board.technicians;

  return (
    <div className="relative w-full h-[500px] rounded-xl border bg-[#0c1021] overflow-hidden" data-testid="dispatch-map">
      {/* Grid lines */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: "linear-gradient(rgba(100,200,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(100,200,255,.15) 1px, transparent 1px)",
        backgroundSize: "60px 60px"
      }} />
      {/* Title */}
      <div className="absolute top-3 left-3 z-10">
        <Badge className="bg-zinc-900/80 text-zinc-300 border-zinc-700"><MapPin className="w-3 h-3 mr-1" />Service Area Map</Badge>
      </div>

      {/* Technician markers */}
      {techs.map((t, i) => {
        const pos = coordsForIndex(i);
        return (
          <div key={t.id} className="absolute z-20 group" style={{ top: pos.top, left: pos.left, transform: "translate(-50%, -50%)" }}>
            <div className={`relative w-10 h-10 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all hover:scale-125 ${t.status === "available" ? "border-emerald-400 bg-emerald-500/20" : t.status === "active" ? "border-blue-400 bg-blue-500/20" : "border-red-400 bg-red-500/20"}`}>
              <span className="text-xs font-bold text-white">{t.name?.charAt(0)}</span>
              <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-[#0c1021] ${t.status === "available" ? "bg-emerald-400" : t.status === "active" ? "bg-blue-400" : "bg-red-400"}`} />
            </div>
            <div className="absolute top-12 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900 border border-zinc-700 rounded-lg p-2 min-w-[140px] z-30 shadow-xl">
              <p className="text-xs font-semibold text-white">{t.name}</p>
              <p className="text-[10px] text-muted-foreground">{t.active_jobs} active &middot; {t.capacity} capacity</p>
              <Badge className={`${statusStyles[t.status]} text-[9px] mt-1`}>{t.status}</Badge>
            </div>
          </div>
        );
      })}

      {/* Unassigned job markers */}
      {jobs.map((j, i) => {
        const pos = coordsForIndex(i + techs.length);
        return (
          <div key={j.id} className="absolute z-10 group" style={{ top: pos.top, left: pos.left, transform: "translate(-50%, -50%)" }}>
            <div className="relative">
              <div className="w-7 h-7 rounded-lg bg-amber-500/30 border border-amber-500/50 flex items-center justify-center animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              </div>
            </div>
            <div className="absolute top-9 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900 border border-zinc-700 rounded-lg p-2 min-w-[160px] z-30 shadow-xl">
              <p className="text-xs font-semibold text-white line-clamp-1">{j.title}</p>
              <p className="text-[10px] text-muted-foreground">{j.client_name}</p>
              <Badge className={`${priorityColors[j.priority] || priorityColors.medium} text-[9px] mt-1`}>{j.priority}</Badge>
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="absolute bottom-3 right-3 bg-zinc-900/80 border border-zinc-700 rounded-lg p-2 text-[10px] space-y-1">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-400" /><span className="text-zinc-400">Available Tech</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-blue-400" /><span className="text-zinc-400">Active Tech</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-amber-400" /><span className="text-zinc-400">Unassigned Job</span></div>
      </div>
    </div>
  );
}

export default function DispatchBoardPage() {
  const { token } = useAuth();
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("map");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/dispatch/board`, { headers });
      setBoard(res.data);
    } catch {}
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  const assignJob = async (ticketId, techId) => {
    try {
      await axios.post(`${API}/dispatch/assign`, { ticket_id: ticketId, tech_id: techId }, { headers });
      toast.success("Job assigned");
      fetchBoard();
    } catch { toast.error("Assignment failed"); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!board) return null;

  const { jobs, technicians, suggestions, stats } = board;

  return (
    <div className="space-y-4" data-testid="dispatch-board-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Navigation className="w-6 h-6 text-primary" />Dispatch Board</h1>
          <p className="text-muted-foreground text-sm">{stats.total_jobs} jobs &middot; {stats.unassigned} unassigned &middot; {stats.available_techs} techs available</p>
        </div>
        <div className="flex gap-2">
          <Tabs value={view} onValueChange={setView}>
            <TabsList className="h-8">
              <TabsTrigger value="map" className="text-xs h-7"><MapPin className="w-3 h-3 mr-1" />Map</TabsTrigger>
              <TabsTrigger value="table" className="text-xs h-7">Table</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={fetchBoard} data-testid="refresh-dispatch"><RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Open Jobs", value: stats.total_jobs, icon: Truck, color: "text-blue-400" },
          { label: "Unassigned", value: stats.unassigned, icon: AlertTriangle, color: "text-amber-400" },
          { label: "Available Techs", value: stats.available_techs, icon: User, color: "text-emerald-400" },
          { label: "Suggestions", value: suggestions.length, icon: Zap, color: "text-purple-400" },
        ].map(s => (
          <Card key={s.label} className="border-border/40">
            <CardContent className="pt-3 pb-2">
              <div className="flex items-center justify-between mb-1"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p><s.icon className={`w-4 h-4 ${s.color}`} /></div>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Map View */}
      {view === "map" && <MapView board={board} onAssign={assignJob} />}

      {/* AI Suggestions */}
      {suggestions.length > 0 && (
        <Card className="border-purple-500/20">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-purple-400" />Smart Assignment Suggestions</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Suggested Tech</TableHead><TableHead>Reason</TableHead><TableHead className="w-[100px]">Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {suggestions.map(s => (
                  <TableRow key={s.job_id}>
                    <TableCell className="text-sm font-medium">{s.job_title}</TableCell>
                    <TableCell><Badge variant="outline">{s.suggested_tech_name}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.reason}</TableCell>
                    <TableCell>{s.suggested_tech_id && <Button size="sm" variant="outline" onClick={() => assignJob(s.job_id, s.suggested_tech_id)} data-testid={`assign-${s.job_id}`}><ArrowRight className="w-3 h-3 mr-1" />Assign</Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Table View - All Jobs */}
      {view === "table" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Client</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Assigned</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {jobs.map(j => (
                  <TableRow key={j.id}>
                    <TableCell className="text-sm font-medium max-w-[200px] truncate">{j.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{j.client_name}</TableCell>
                    <TableCell><Badge className={`${priorityColors[j.priority] || priorityColors.medium} text-[10px]`}>{j.priority}</Badge></TableCell>
                    <TableCell className="text-xs capitalize">{j.status}</TableCell>
                    <TableCell className="text-sm">{j.assigned_to_name || <span className="text-amber-400 text-xs">Unassigned</span>}</TableCell>
                    <TableCell>
                      {!j.assigned_to && (
                        <Select onValueChange={v => assignJob(j.id, v)}>
                          <SelectTrigger className="w-[130px] h-7 text-xs"><SelectValue placeholder="Assign..." /></SelectTrigger>
                          <SelectContent>{technicians.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({t.capacity})</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Technician Grid */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Technician Status</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {technicians.map(t => (
              <div key={t.id} className="p-3 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${t.status === "available" ? "border-emerald-400 bg-emerald-500/20" : t.status === "active" ? "border-blue-400 bg-blue-500/20" : "border-red-400 bg-red-500/20"}`}>
                    <span className="text-xs font-bold">{t.name?.charAt(0)}</span>
                  </div>
                  <div><p className="text-xs font-medium">{t.name}</p><Badge className={`${statusStyles[t.status]} text-[9px]`}>{t.status}</Badge></div>
                </div>
                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  <p>{t.active_jobs} active &middot; {t.total_open} total</p>
                  <p>{t.capacity} capacity remaining</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
