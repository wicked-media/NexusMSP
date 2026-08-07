import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Users, Loader2, MessageSquare, RefreshCw, ThumbsUp, ThumbsDown, Minus } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";

export default function NPSTrackerPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData((await axios.get(`${API}/nps-tracker/overview`, { headers: { Authorization: `Bearer ${token}` } })).data); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  const s = data.summary || {};
  const evidenceAvailable = data.evidence_state === "evidence_available";
  const scoreColour = s.nps_score >= 50 ? "text-emerald-400" : s.nps_score >= 0 ? "text-amber-400" : "text-red-400";

  return (
    <div className="space-y-5" data-testid="nps-tracker-page">
      <OperationalPageHeader eyebrow="Customer feedback" title="NPS tracker" description="Net Promoter Score is calculated only from recorded NPS responses. No response rate or trend is inferred when your collection workflow has not run." icon={MessageSquare} tone="sky" actions={<Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1 h-4 w-4" />Refresh</Button>} />

      {!evidenceAvailable ? <Card className="border-dashed border-sky-500/30 bg-sky-500/5"><CardContent className="py-20 text-center"><MessageSquare className="mx-auto mb-3 h-12 w-12 text-sky-300 opacity-40" /><p className="font-semibold">No NPS responses have been recorded</p><p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">Connect a verified NPS collection workflow before using NPS in client health or QBR reporting. NexusMSP will show evidence gaps instead of estimated satisfaction.</p></CardContent></Card> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="NPS score" value={s.nps_score} colour={scoreColour} />
          <Metric label="Average rating" value={s.avg_score} />
          <Metric label="Promoters (9–10)" value={s.promoters} colour="text-emerald-400" icon={ThumbsUp} />
          <Metric label="Passives (7–8)" value={s.passives} colour="text-amber-400" icon={Minus} />
          <Metric label="Detractors (0–6)" value={s.detractors} colour="text-red-400" icon={ThumbsDown} />
        </div>
        {data.trend?.length > 0 && <Card><CardHeader className="pb-2"><CardTitle className="text-base">Recorded NPS trend</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={250}><LineChart data={data.trend}><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--card-foreground))" }} /><Line type="monotone" connectNulls={false} dataKey="nps" stroke="#38bdf8" strokeWidth={2} dot={{ fill: "#38bdf8" }} name="NPS score" /></LineChart></ResponsiveContainer></CardContent></Card>}
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Recent responses</CardTitle></CardHeader><CardContent><div className="space-y-2">{data.surveys.slice(0, 15).map(survey => <div key={survey.id} className="flex items-center gap-4 rounded-lg p-2 hover:bg-muted/50"><div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${survey.score >= 9 ? "bg-emerald-500/20 text-emerald-400" : survey.score >= 7 ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>{survey.score}</div><div className="flex-1"><div className="text-sm font-medium">{survey.respondent || "Respondent"}</div><div className="text-xs text-muted-foreground">{survey.client_name || "Unassigned client"}</div></div><div className="max-w-md truncate text-sm text-muted-foreground">{survey.feedback || "No feedback"}</div><span className="text-xs text-muted-foreground">{survey.submitted_at ? new Date(survey.submitted_at).toLocaleDateString() : ""}</span></div>)}</div></CardContent></Card>
      </>}
    </div>
  );
}

function Metric({ label, value, colour = "text-foreground", icon: Icon = Users }) {
  return <Card><CardContent className="pt-4 text-center"><Icon className={`mx-auto mb-2 h-4 w-4 ${colour}`} /><div className={`text-3xl font-bold ${colour}`}>{value ?? "—"}</div><div className="mt-1 text-xs text-muted-foreground">{label}</div></CardContent></Card>;
}
