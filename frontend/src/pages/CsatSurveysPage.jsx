import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Star, Users, MessageSquare, Loader2, RefreshCw } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";

export default function CsatSurveysPage() {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [dRes, sRes] = await Promise.all([
        axios.get(`${API}/csat/dashboard`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/csat/surveys`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setDashboard(dRes.data);
      setSurveys(sRes.data);
    } catch { toast.error("Failed to load CSAT data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!dashboard || dashboard.total_responses === 0) return (
    <div className="space-y-5" data-testid="csat-page">
      <OperationalPageHeader eyebrow="Customer feedback" title="Customer satisfaction" description="Customer-submitted feedback tied to resolved tickets. NexusMSP never populates CSAT dashboards with generated responses." icon={Star} tone="amber" actions={<Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="mr-1 h-4 w-4" />Refresh</Button>} />
      <Card className="border-dashed border-amber-500/30 bg-amber-500/5"><CardContent className="py-20 text-center text-muted-foreground"><Star className="w-12 h-12 mx-auto mb-3 text-amber-300 opacity-40" /><p className="font-medium text-foreground">No customer responses yet</p><p className="mx-auto mt-2 max-w-md text-sm">Send a CSAT survey from a resolved ticket. Responses are then attributed to the ticket, client, and technician for audit and reporting.</p></CardContent></Card>
    </div>
  );

  const { avg_score, total_responses, by_tech, by_client, distribution } = dashboard;
  const scoreColor = (s) => s >= 4 ? "text-emerald-400" : s >= 3 ? "text-amber-400" : "text-red-400";

  return (
    <div className="space-y-5" data-testid="csat-page">
      <OperationalPageHeader eyebrow="Customer feedback" title="Customer satisfaction" description="CSAT scores and comments captured from real ticket follow-up surveys." icon={Star} tone="amber" actions={<Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="mr-1 h-4 w-4" />Refresh</Button>} />

      {/* Score Hero */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="col-span-1">
          <CardContent className="p-6 flex flex-col items-center justify-center">
            <p className={`text-5xl font-black ${scoreColor(avg_score)}`}>{avg_score}</p>
            <div className="flex gap-0.5 mt-2">{[1,2,3,4,5].map(s => <Star key={s} className={`w-4 h-4 ${s <= Math.round(avg_score) ? "text-amber-400 fill-amber-400" : "text-zinc-700"}`} />)}</div>
            <p className="text-xs text-muted-foreground mt-2">Average from {total_responses} responses</p>
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Score Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[5,4,3,2,1].map(s => {
                const count = distribution?.[s] || 0;
                const pct = total_responses > 0 ? Math.round(count / total_responses * 100) : 0;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <div className="flex gap-0.5 w-20">{[1,2,3,4,5].map(i => <Star key={i} className={`w-3 h-3 ${i <= s ? "text-amber-400 fill-amber-400" : "text-zinc-800"}`} />)}</div>
                    <Progress value={pct} className="flex-1 h-3" />
                    <span className="text-xs font-mono w-16 text-right">{count} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* By Technician */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" />By Technician</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table><TableHeader><TableRow><TableHead>Technician</TableHead><TableHead>Avg Score</TableHead><TableHead>Responses</TableHead></TableRow></TableHeader>
              <TableBody>
                {by_tech.map((t, i) => (
                  <TableRow key={`t-${i}`}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell><span className={`font-bold ${scoreColor(t.avg)}`}>{t.avg}</span> <span className="text-muted-foreground">/5</span></TableCell>
                    <TableCell>{t.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* By Client */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" />By Client</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Avg Score</TableHead><TableHead>Responses</TableHead></TableRow></TableHeader>
              <TableBody>
                {by_client.map((c, i) => (
                  <TableRow key={`c-${i}`} className={c.avg < 3 ? "bg-red-500/5" : ""}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell><span className={`font-bold ${scoreColor(c.avg)}`}>{c.avg}</span> <span className="text-muted-foreground">/5</span></TableCell>
                    <TableCell>{c.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Recent Responses */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="w-4 h-4" />Recent Responses</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {surveys.slice(0, 15).map((s, i) => (
              <div key={`sr-${i}`} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/10 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex gap-0.5">{[1,2,3,4,5].map(n => <Star key={n} className={`w-3 h-3 ${n <= s.score ? "text-amber-400 fill-amber-400" : "text-zinc-800"}`} />)}</div>
                  <span className="text-sm font-medium">{s.client_name}</span>
                  {s.comment && <span className="text-xs text-muted-foreground italic">"{s.comment}"</span>}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Tech: {s.tech_name}</span>
                  <span>{s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : ""}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
