import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ThumbsUp, ThumbsDown, Minus } from "lucide-react";

export default function NPSTrackerPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/nps-tracker/overview`, { headers }).then(r => setData(r.data)); }, []);

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="nps-tracker-page">
      <div><h1 className="text-2xl font-bold">NPS Tracker</h1><p className="text-muted-foreground text-sm">Net Promoter Score tracking and client satisfaction over time</p></div>
      <div className="grid grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 text-center"><div className={`text-4xl font-bold ${s.nps_score >= 50 ? 'text-green-500' : s.nps_score >= 0 ? 'text-yellow-500' : 'text-red-500'}`}>{s.nps_score}</div><div className="text-xs text-muted-foreground mt-1">NPS Score</div></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><div className="text-2xl font-bold">{s.avg_score}</div><div className="text-xs text-muted-foreground mt-1">Avg Rating</div></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><div className="text-2xl font-bold text-green-500">{s.promoters}</div><div className="text-xs text-muted-foreground mt-1">Promoters (9-10)</div></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><div className="text-2xl font-bold text-yellow-500">{s.passives}</div><div className="text-xs text-muted-foreground mt-1">Passives (7-8)</div></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><div className="text-2xl font-bold text-red-500">{s.detractors}</div><div className="text-xs text-muted-foreground mt-1">Detractors (0-6)</div></CardContent></Card>
      </div>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">NPS Trend (6 Months)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data.trend}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--card-foreground))' }} />
              <Line type="monotone" dataKey="nps" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} name="NPS Score" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Recent Responses</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.surveys.slice(0, 15).map(sv => (
              <div key={sv.id} className="flex items-center gap-4 p-2 rounded hover:bg-muted/50">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${sv.score >= 9 ? 'bg-green-500/20 text-green-500' : sv.score >= 7 ? 'bg-yellow-500/20 text-yellow-500' : 'bg-red-500/20 text-red-500'}`}>{sv.score}</div>
                <div className="flex-1"><div className="text-sm font-medium">{sv.respondent}</div><div className="text-xs text-muted-foreground">{sv.client_name}</div></div>
                <div className="text-sm text-muted-foreground max-w-md truncate">{sv.feedback || "No feedback"}</div>
                <span className="text-xs text-muted-foreground">{new Date(sv.submitted_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
