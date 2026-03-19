import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle, AlertTriangle, XCircle, Clock, Ticket, Calendar,
  FileText, Loader2, Shield, Activity, DollarSign
} from "lucide-react";

const STATUS_CONFIG = {
  operational: { label: "All Systems Operational", icon: CheckCircle, class: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", pulse: false },
  degraded: { label: "Degraded Performance", icon: AlertTriangle, class: "text-amber-400 bg-amber-500/10 border-amber-500/30", pulse: true },
  major_outage: { label: "Major Outage", icon: XCircle, class: "text-red-400 bg-red-500/10 border-red-500/30", pulse: true },
};

const TICKET_STATUS = {
  open: "bg-red-500/20 text-red-400", in_progress: "bg-blue-500/20 text-blue-400",
  waiting_on_client: "bg-amber-500/20 text-amber-400", resolved: "bg-emerald-500/20 text-emerald-400",
  closed: "bg-zinc-500/20 text-zinc-400",
};

export default function StatusBoardPage() {
  const { clientId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await axios.get(`${API}/status-board/${clientId}`);
        setData(res.data);
      } catch { setData({ found: false }); }
      finally { setLoading(false); }
    };
    fetch();
    const interval = setInterval(fetch, 30000); // Auto-refresh every 30s
    return () => clearInterval(interval);
  }, [clientId]);

  if (loading) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  if (!data?.found) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <Card className="w-96"><CardContent className="pt-6 text-center">
        <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <p className="text-lg font-bold">Client Not Found</p>
        <p className="text-sm text-muted-foreground mt-1">This status board link is invalid.</p>
      </CardContent></Card>
    </div>
  );

  const overall = STATUS_CONFIG[data.overall_status] || STATUS_CONFIG.operational;
  const OverallIcon = overall.icon;

  const handleApprove = async (estId) => {
    try {
      await axios.post(`${API}/status-board/${clientId}/approve-estimate/${estId}`);
      const res = await axios.get(`${API}/status-board/${clientId}`);
      setData(res.data);
    } catch { alert("Failed to approve estimate"); }
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-6 max-w-5xl mx-auto" data-testid="status-board">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-1">{data.client_name}</h1>
        <p className="text-sm text-muted-foreground">Service Status Board</p>
        <div className={`inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full border ${overall.class} ${overall.pulse ? "animate-pulse" : ""}`}>
          <OverallIcon className="w-5 h-5" />
          <span className="font-bold">{overall.label}</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Last updated: {new Date(data.last_updated).toLocaleString()}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <Card><CardContent className="pt-4 text-center"><Ticket className="w-5 h-5 mx-auto text-blue-400 mb-1" /><p className="text-2xl font-black">{data.stats?.open_count || 0}</p><p className="text-[11px] text-muted-foreground">Open Tickets</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><AlertTriangle className="w-5 h-5 mx-auto text-red-400 mb-1" /><p className="text-2xl font-black text-red-400">{data.stats?.incident_count || 0}</p><p className="text-[11px] text-muted-foreground">Active Incidents</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><CheckCircle className="w-5 h-5 mx-auto text-emerald-400 mb-1" /><p className="text-2xl font-black text-emerald-400">{data.stats?.resolved_count || 0}</p><p className="text-[11px] text-muted-foreground">Recently Resolved</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><Calendar className="w-5 h-5 mx-auto text-purple-400 mb-1" /><p className="text-2xl font-black">{data.stats?.upcoming_count || 0}</p><p className="text-[11px] text-muted-foreground">Upcoming Work</p></CardContent></Card>
      </div>

      {/* Active Incidents */}
      {(data.active_incidents || []).length > 0 && (
        <Card className="border-red-500/30 mb-6">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Active Incidents</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.active_incidents.map(t => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <div>
                  <p className="font-medium text-sm">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.ticket_number} &middot; Assigned to {t.assigned_to_name || "Team"}</p>
                </div>
                <Badge className="bg-red-500/20 text-red-400">{t.priority}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Open Tickets */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Ticket className="w-4 h-4 text-blue-400" />Open Tickets ({(data.open_tickets || []).length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(data.open_tickets || []).length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No open tickets</p> :
              data.open_tickets.map(t => (
                <div key={t.id} className="flex items-center justify-between p-2 rounded bg-muted/20 border border-border/30">
                  <div>
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-[10px] text-muted-foreground">{t.ticket_number} &middot; {t.created_at?.slice(0, 10)}</p>
                  </div>
                  <Badge className={`${TICKET_STATUS[t.status] || ""} text-[10px]`}>{(t.status || "").replace(/_/g, " ")}</Badge>
                </div>
              ))
            }
          </CardContent>
        </Card>

        {/* Recently Resolved */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-400" />Recently Resolved</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(data.recently_resolved || []).length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No recent resolutions</p> :
              data.recently_resolved.map(t => (
                <div key={t.id} className="flex items-center justify-between p-2 rounded bg-muted/20 border border-border/30">
                  <div>
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-[10px] text-muted-foreground">{t.ticket_number}</p>
                  </div>
                  <Badge className="bg-emerald-500/20 text-emerald-400 text-[10px]">Resolved</Badge>
                </div>
              ))
            }
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Work */}
      {(data.upcoming_work || []).length > 0 && (
        <Card className="mt-4">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="w-4 h-4 text-purple-400" />Upcoming Scheduled Work</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.upcoming_work.map(j => (
              <div key={j.id} className="flex items-center justify-between p-2 rounded bg-muted/20 border border-border/30">
                <div>
                  <p className="text-sm font-medium">{j.description || j.job_number}</p>
                  <p className="text-[10px] text-muted-foreground">{j.scheduled_date} {j.scheduled_time} &middot; {j.assigned_to_name}</p>
                </div>
                <Badge variant="outline" className="text-[10px]">{j.field_status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pending Estimates */}
      {(data.pending_estimates || []).length > 0 && (
        <Card className="mt-4 border-blue-500/20">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4 text-blue-400" />Estimates Awaiting Approval</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.pending_estimates.map(e => (
              <div key={e.id} className="flex items-center justify-between p-3 rounded bg-blue-500/5 border border-blue-500/20">
                <div>
                  <p className="font-medium text-sm">{e.title}</p>
                  <p className="text-xs text-muted-foreground">{e.estimate_number} &middot; ${parseFloat(e.total || 0).toFixed(2)}</p>
                </div>
                <Button size="sm" onClick={() => handleApprove(e.id)} className="bg-emerald-600 hover:bg-emerald-700" data-testid={`approve-est-${e.id}`}>
                  <CheckCircle className="w-3 h-3 mr-1" />Approve
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="text-center mt-8 text-xs text-muted-foreground/50">
        Powered by NexusOps &middot; Auto-refreshes every 30 seconds
      </div>
    </div>
  );
}
