import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Star, Users, MessageSquare, Loader2, RefreshCw, Search, AlertTriangle, Ticket } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { MetricStrip, MetricTile } from "@/components/design-system";

export default function CsatSurveysPage() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dashboard, setDashboard] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(() => searchParams.get("q") || "");
  const requestedSurveyId = searchParams.get("survey") || "";

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

  const clearSelectedSurvey = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("survey");
    setSearchParams(next, { replace: true });
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSurveys = useMemo(() => surveys.filter((survey) => {
    if (!normalizedQuery) return true;
    return [
      survey.ticket_number,
      survey.ticket_id,
      survey.client_name,
      survey.tech_name,
      survey.comment,
      survey.feedback,
      survey.status,
    ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
  }), [normalizedQuery, surveys]);
  const orderedSurveys = useMemo(() => [...visibleSurveys].sort((a, b) => {
    const aSelected = String(a.id) === requestedSurveyId;
    const bSelected = String(b.id) === requestedSurveyId;
    return Number(bSelected) - Number(aSelected);
  }), [requestedSurveyId, visibleSurveys]);
  const selectedSurvey = surveys.find((survey) => String(survey.id) === requestedSurveyId);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!dashboard || dashboard.total_responses === 0) return (
    <div className="space-y-5" data-testid="csat-page">
      <OperationalPageHeader eyebrow="Customer feedback" title="Customer satisfaction" description="Customer-submitted feedback tied to resolved tickets. NexusMSP never populates CSAT dashboards with generated responses." icon={Star} tone="amber" actions={<Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="mr-1 h-4 w-4" />Refresh</Button>} />
      <Card className="border-dashed border-amber-500/30 bg-amber-500/5"><CardContent className="py-20 text-center text-muted-foreground"><Star className="w-12 h-12 mx-auto mb-3 text-amber-300 opacity-40" /><p className="font-medium text-foreground">No customer responses yet</p><p className="mx-auto mt-2 max-w-md text-sm">Send a CSAT survey from a resolved ticket. Responses are then attributed to the ticket, client, and technician for audit and reporting.</p></CardContent></Card>
    </div>
  );

  const { avg_score, total_responses, by_tech, by_client, distribution } = dashboard;
  const scoreColor = (s) => s >= 4 ? "text-emerald-400" : s >= 3 ? "text-amber-400" : "text-red-400";
  const lowScoreCount = surveys.filter((survey) => Number(survey.score) <= 2).length;
  const fiveStarShare = total_responses ? Math.round(((distribution?.[5] || 0) / total_responses) * 100) : 0;

  return (
    <div className="space-y-5" data-testid="csat-page">
      <OperationalPageHeader
        eyebrow="Customer feedback"
        title="Customer satisfaction"
        description="CSAT scores and comments captured from real ticket follow-up surveys. Use low feedback as a prompt to review the linked work, not a conclusion by itself."
        icon={Star}
        tone="amber"
        actions={<div className="flex items-center gap-2">{requestedSurveyId && <Button variant="ghost" size="sm" onClick={clearSelectedSurvey}>Clear focus</Button>}<Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="mr-1 h-4 w-4" />Refresh</Button></div>}
      />

      <MetricStrip columns={4}>
        <MetricTile label="Average score" value={`${avg_score}/5`} icon={Star} accent={avg_score >= 4 ? "emerald" : avg_score >= 3 ? "amber" : "rose"} />
        <MetricTile label="Responses" value={total_responses} icon={MessageSquare} accent="sky" />
        <MetricTile label="Needs follow-up" value={lowScoreCount} icon={AlertTriangle} accent={lowScoreCount ? "amber" : "emerald"} />
        <MetricTile label="Five-star share" value={`${fiveStarShare}%`} icon={Star} accent="violet" />
      </MetricStrip>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Score distribution</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[5,4,3,2,1].map(s => {
              const count = distribution?.[s] || 0;
              const pct = total_responses > 0 ? Math.round(count / total_responses * 100) : 0;
              return (
                <div key={s} className="flex items-center gap-3">
                  <div className="flex w-20 gap-0.5">{[1,2,3,4,5].map(i => <Star key={i} className={`h-3 w-3 ${i <= s ? "fill-amber-400 text-amber-400" : "text-zinc-800"}`} />)}</div>
                  <Progress value={pct} className="h-3 flex-1" />
                  <span className="w-16 text-right font-mono text-xs">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
        <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2 text-sm"><MessageSquare className="h-4 w-4" />Feedback responses</CardTitle><p className="mt-1 text-xs text-muted-foreground">Search by ticket, customer, technician, score context or feedback wording.</p></div><div className="relative w-full sm:w-80"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search feedback…" data-testid="csat-search" /></div></CardHeader>
        <CardContent>
          {selectedSurvey && <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-100"><Ticket className="h-3.5 w-3.5" />Opened from Nexus search: {selectedSurvey.ticket_number || selectedSurvey.ticket_id || "ticket-linked feedback"}</div>}
          <div className="space-y-2">
            {orderedSurveys.slice(0, 30).map((s) => (
              <div key={s.id} className={`flex flex-col gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/10 lg:flex-row lg:items-center lg:justify-between ${String(s.id) === requestedSurveyId ? "border-amber-400/45 bg-amber-500/[0.07]" : "border-border/70"}`} data-testid={`csat-response-${s.id}`}>
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 flex shrink-0 gap-0.5">{[1,2,3,4,5].map(n => <Star key={n} className={`h-3 w-3 ${n <= s.score ? "fill-amber-400 text-amber-400" : "text-zinc-800"}`} />)}</div>
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-sm font-medium">{s.client_name || "Customer"}</span>{(s.ticket_number || s.ticket_id) && <span className="font-mono text-[10px] text-cyan-300">{s.ticket_number || s.ticket_id}</span>}</div>{(s.comment || s.feedback) && <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">“{s.comment || s.feedback}”</p>}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground"><span>Tech: {s.tech_name || "Not recorded"}</span><span>{s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : ""}</span></div>
              </div>
            ))}
            {!orderedSurveys.length && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No feedback responses match this search.</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
