import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, User, Zap, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { toast } from "sonner";

const priorityColors = { critical: "destructive", high: "destructive", medium: "secondary", low: "outline" };

export default function DispatchBoardPage() {
  const { token } = useAuth();
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchBoard = () => {
    axios.get(`${API}/dispatch/board`, { headers })
      .then(r => setBoard(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchBoard(); }, []);

  const assignJob = async (ticketId, techId) => {
    try {
      await axios.post(`${API}/dispatch/assign`, { ticket_id: ticketId, tech_id: techId }, { headers });
      toast.success("Job assigned");
      fetchBoard();
    } catch { toast.error("Assignment failed"); }
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!board) return null;

  return (
    <div className="space-y-6" data-testid="dispatch-board-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intelligent Dispatch Board</h1>
          <p className="text-muted-foreground text-sm mt-1">Smart job assignment with skill matching</p>
        </div>
        <Button variant="outline" onClick={fetchBoard} data-testid="refresh-dispatch"><Clock className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-2xl font-bold">{board.stats.total_jobs}</p>
          <p className="text-xs text-muted-foreground">Total Jobs</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-2xl font-bold text-red-500">{board.stats.unassigned}</p>
          <p className="text-xs text-muted-foreground">Unassigned</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-2xl font-bold text-green-500">{board.stats.available_techs}</p>
          <p className="text-xs text-muted-foreground">Available Techs</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-2xl font-bold">{board.technicians.length}</p>
          <p className="text-xs text-muted-foreground">Total Techs</p>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><MapPin className="w-4 h-4" />Open Jobs</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Job</TableHead><TableHead>Client</TableHead><TableHead>Priority</TableHead><TableHead>Assigned</TableHead><TableHead>Action</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {board.jobs.map(job => (
                    <TableRow key={job.id} data-testid={`dispatch-job-${job.id}`}>
                      <TableCell className="font-medium text-sm max-w-[200px] truncate">{job.title}</TableCell>
                      <TableCell className="text-sm">{job.client_name}</TableCell>
                      <TableCell><Badge variant={priorityColors[job.priority] || "outline"} className="capitalize text-xs">{job.priority}</Badge></TableCell>
                      <TableCell className="text-sm">{job.assigned_to_name || <span className="text-red-400 text-xs">Unassigned</span>}</TableCell>
                      <TableCell>
                        {!job.assigned_to && (
                          <Select onValueChange={(v) => assignJob(job.id, v)}>
                            <SelectTrigger className="h-7 w-[140px] text-xs" data-testid={`assign-select-${job.id}`}>
                              <SelectValue placeholder="Assign to..." />
                            </SelectTrigger>
                            <SelectContent>
                              {board.technicians.filter(t => t.status !== "busy").map(t => (
                                <SelectItem key={t.id} value={t.id}>{t.name} ({t.capacity} cap)</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {board.jobs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No open jobs</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {board.suggestions.length > 0 && (
            <Card className="border-amber-500/30">
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4 text-amber-500" />AI Suggestions</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {board.suggestions.map(s => (
                  <div key={s.job_id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg" data-testid={`suggestion-${s.job_id}`}>
                    <div>
                      <p className="text-sm font-medium">{s.job_title}</p>
                      <p className="text-xs text-muted-foreground">{s.reason}</p>
                    </div>
                    {s.suggested_tech_id && (
                      <Button size="sm" onClick={() => assignJob(s.job_id, s.suggested_tech_id)} data-testid={`accept-suggestion-${s.job_id}`}>
                        Assign {s.suggested_tech_name}
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4" />Technicians</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {board.technicians.map(t => (
              <div key={t.id} className="p-3 rounded-lg border" data-testid={`tech-card-${t.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{t.name}</span>
                  <Badge variant={t.status === "available" ? "default" : t.status === "active" ? "secondary" : "destructive"} className="text-xs capitalize">{t.status}</Badge>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Active: {t.active_jobs}</span>
                  <span>Open: {t.total_open}</span>
                  <span>Capacity: {t.capacity}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
