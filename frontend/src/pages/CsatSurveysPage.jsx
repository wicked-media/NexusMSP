import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Star, Users, UserCog, MessageSquare, Sparkles } from "lucide-react";
import { toast } from "sonner";

const scoreColors = { 5: "text-green-500", 4: "text-green-400", 3: "text-amber-500", 2: "text-orange-500", 1: "text-red-500" };

export default function CsatSurveysPage() {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = () => {
    Promise.all([
      axios.get(`${API}/csat/dashboard`, { headers }),
      axios.get(`${API}/csat/surveys`, { headers }),
    ]).then(([d, s]) => {
      setDashboard(d.data);
      setSurveys(s.data);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const seedDemo = async () => {
    try {
      await axios.post(`${API}/csat/seed-demo`, {}, { headers });
      toast.success("Demo data seeded");
      fetchData();
    } catch { toast.error("Seed failed"); }
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const d = dashboard || { avg_score: 0, total_responses: 0, by_tech: [], by_client: [], distribution: {} };

  return (
    <div className="space-y-6" data-testid="csat-surveys-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Client Satisfaction (CSAT)</h1>
          <p className="text-muted-foreground text-sm mt-1">Pulse surveys and satisfaction tracking</p>
        </div>
        {d.total_responses === 0 && (
          <Button variant="outline" onClick={seedDemo} data-testid="seed-csat-data">
            <Sparkles className="w-4 h-4 mr-2" />Seed Demo Data
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Star className="w-5 h-5 mx-auto mb-1 text-amber-500" />
          <p className="text-2xl font-bold">{d.avg_score}/5</p>
          <p className="text-xs text-muted-foreground">Average Score</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <MessageSquare className="w-5 h-5 mx-auto mb-1 text-blue-500" />
          <p className="text-2xl font-bold">{d.total_responses}</p>
          <p className="text-xs text-muted-foreground">Total Responses</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-2xl font-bold text-green-500">{d.distribution[5] || 0}</p>
          <p className="text-xs text-muted-foreground">5-Star Reviews</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-2xl font-bold text-red-500">{(d.distribution[1] || 0) + (d.distribution[2] || 0)}</p>
          <p className="text-xs text-muted-foreground">Low Scores (1-2)</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="by_tech">By Technician</TabsTrigger>
              <TabsTrigger value="by_client">By Client</TabsTrigger>
              <TabsTrigger value="responses">All Responses</TabsTrigger>
            </TabsList>

            <TabsContent value="dashboard">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Score Distribution</h3>
                <div className="space-y-2">
                  {[5,4,3,2,1].map(score => {
                    const count = d.distribution[score] || 0;
                    const pct = d.total_responses > 0 ? Math.round((count / d.total_responses) * 100) : 0;
                    return (
                      <div key={score} className="flex items-center gap-3">
                        <span className="text-sm font-medium w-4">{score}</span>
                        <Star className="w-4 h-4 text-amber-500" />
                        <Progress value={pct} className="h-3 flex-1" />
                        <span className="text-xs text-muted-foreground w-16 text-right">{count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="by_tech">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Technician</TableHead><TableHead className="text-right">Avg Score</TableHead><TableHead className="text-right">Responses</TableHead><TableHead>Rating</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {d.by_tech.map(t => (
                    <TableRow key={t.name} data-testid={`csat-tech-${t.name}`}>
                      <TableCell className="font-medium flex items-center gap-2"><UserCog className="w-4 h-4 text-muted-foreground" />{t.name}</TableCell>
                      <TableCell className="text-right font-bold">{t.avg}/5</TableCell>
                      <TableCell className="text-right">{t.count}</TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">{Array.from({ length: 5 }, (_, i) => (
                          <Star key={i} className={`w-3 h-3 ${i < Math.round(t.avg) ? "text-amber-500 fill-amber-500" : "text-slate-600"}`} />
                        ))}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="by_client">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Client</TableHead><TableHead className="text-right">Avg Score</TableHead><TableHead className="text-right">Responses</TableHead><TableHead>Rating</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {d.by_client.map(c => (
                    <TableRow key={c.name} data-testid={`csat-client-${c.name}`}>
                      <TableCell className="font-medium flex items-center gap-2"><Users className="w-4 h-4 text-muted-foreground" />{c.name}</TableCell>
                      <TableCell className={`text-right font-bold ${c.avg >= 4 ? "text-green-500" : c.avg >= 3 ? "text-amber-500" : "text-red-500"}`}>{c.avg}/5</TableCell>
                      <TableCell className="text-right">{c.count}</TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">{Array.from({ length: 5 }, (_, i) => (
                          <Star key={i} className={`w-3 h-3 ${i < Math.round(c.avg) ? "text-amber-500 fill-amber-500" : "text-slate-600"}`} />
                        ))}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="responses">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Client</TableHead><TableHead>Technician</TableHead><TableHead>Score</TableHead><TableHead>Comment</TableHead><TableHead>Date</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {surveys.map(s => (
                    <TableRow key={s.id} data-testid={`survey-${s.id}`}>
                      <TableCell className="text-sm">{s.client_name}</TableCell>
                      <TableCell className="text-sm">{s.tech_name}</TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">{Array.from({ length: 5 }, (_, i) => (
                          <Star key={i} className={`w-3 h-3 ${i < s.score ? "text-amber-500 fill-amber-500" : "text-slate-600"}`} />
                        ))}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{s.comment || "-"}</TableCell>
                      <TableCell className="text-xs">{new Date(s.submitted_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {surveys.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No survey responses yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
