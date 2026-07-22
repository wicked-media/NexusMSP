import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Heart, AlertTriangle, TrendingUp, TrendingDown, Users, RefreshCw,
  Loader2, ArrowLeft, Zap, Shield, SmilePlus, Frown, Meh, ThumbsUp,
  BarChart3, Eye, ChevronRight
} from "lucide-react";

const STATUS_CONFIG = {
  thriving: { color: "bg-emerald-500/20 text-emerald-400", icon: SmilePlus, label: "Thriving" },
  healthy: { color: "bg-blue-500/20 text-blue-400", icon: ThumbsUp, label: "Healthy" },
  neutral: { color: "bg-zinc-500/20 text-zinc-400", icon: Meh, label: "Neutral" },
  at_risk: { color: "bg-amber-500/20 text-amber-400", icon: AlertTriangle, label: "At Risk" },
  critical: { color: "bg-red-500/20 text-red-400", icon: Frown, label: "Critical" },
};

function SentimentGauge({ score, size = "lg" }) {
  const color = score >= 70 ? "text-emerald-400" : score >= 50 ? "text-blue-400" : score >= 30 ? "text-amber-400" : "text-red-400";
  const dim = size === "lg" ? "w-28 h-28" : "w-16 h-16";
  const textSize = size === "lg" ? "text-3xl" : "text-lg";
  return (
    <div className="text-center">
      <div className={`relative ${dim} mx-auto`}>
        <svg className={`${dim} -rotate-90`} viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="7" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" className={color} strokeWidth="7"
            strokeDasharray={`${score * 2.64} ${264 - score * 2.64}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`${textSize} font-black ${color}`}>{score}</span>
        </div>
      </div>
    </div>
  );
}

function FactorBar({ label, value }) {
  const color = value >= 70 ? "bg-emerald-500" : value >= 50 ? "bg-blue-500" : value >= 30 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-bold">{value}</span>
      </div>
      <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export default function SentimentDashboardPage({ embedded = false }) {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [clients, setClients] = useState([]);
  const [atRisk, setAtRisk] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientDetail, setClientDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, cRes, rRes] = await Promise.all([
        axios.get(`${API}/sentiment/dashboard`, { headers }),
        axios.get(`${API}/sentiment/clients`, { headers }),
        axios.get(`${API}/sentiment/at-risk`, { headers }),
      ]);
      setDashboard(dRes.data);
      setClients(cRes.data);
      setAtRisk(rRes.data);
    } catch { toast.error("Failed to fetch sentiment data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const analyzeClient = async (clientId) => {
    try {
      const res = await axios.post(`${API}/sentiment/analyze/${clientId}`, {}, { headers });
      toast.success(`Sentiment: ${res.data.score}/100 (${res.data.status})`);
      fetchAll();
      return res.data;
    } catch { toast.error("Analysis failed"); }
  };

  const analyzeAll = async () => {
    setAnalyzing(true);
    try {
      const res = await axios.post(`${API}/sentiment/analyze-all`, {}, { headers });
      toast.success(`Analyzed ${res.data.analyzed} clients`);
      fetchAll();
    } catch { toast.error("Batch analysis failed"); }
    finally { setAnalyzing(false); }
  };

  const viewClient = async (clientId) => {
    try {
      const res = await axios.get(`${API}/sentiment/clients/${clientId}`, { headers });
      setClientDetail(res.data);
      setSelectedClient(clientId);
    } catch { toast.error("Failed to load client detail"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // CLIENT DETAIL VIEW
  if (selectedClient && clientDetail) {
    const c = clientDetail.current || {};
    const factors = c.factors || {};
    const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.neutral;
    const StatusIcon = cfg.icon;
    return (
      <div className="space-y-5" data-testid="sentiment-client-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedClient(null); setClientDetail(null); }} data-testid="sentiment-back">
            <ArrowLeft className="w-4 h-4 mr-1" />Back
          </Button>
          <Heart className="w-5 h-5 text-pink-400" />
          <div>
            <h2 className="text-xl font-bold">{c.client_name || "Client"}</h2>
            <p className="text-sm text-muted-foreground">Last analyzed: {c.analyzed_at?.slice(0, 10) || "Never"}</p>
          </div>
          <Badge className={`ml-auto ${cfg.color}`}><StatusIcon className="w-3 h-3 mr-1" />{cfg.label}</Badge>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <Card className="col-span-1">
            <CardContent className="pt-6">
              <SentimentGauge score={c.score || 0} />
              <p className="text-center text-xs text-muted-foreground mt-2">Overall Sentiment</p>
              <div className="text-center mt-3">
                <Badge className={c.risk_level === "low" ? "bg-emerald-500/20 text-emerald-400" : c.risk_level === "medium" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}>
                  Churn Risk: {Math.round((c.churn_probability || 0) * 100)}%
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-400" />Sentiment Factors</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FactorBar label="Response Satisfaction" value={factors.response_satisfaction || 0} />
              <FactorBar label="Resolution Speed" value={factors.resolution_speed || 0} />
              <FactorBar label="Communication Tone" value={factors.communication_tone || 0} />
              <FactorBar label="Recurring Issues" value={factors.recurring_issues || 0} />
              <FactorBar label="Overall Experience" value={factors.overall_experience || 0} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" />Insights</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(c.insights || []).map((ins, i) => (
                  <div key={`k-${i}`} className="text-xs p-2 rounded bg-muted/20 border border-border/30">{ins}</div>
                ))}
              </div>
              <Separator className="my-3" />
              <p className="text-xs font-semibold mb-2">Recommendations</p>
              <div className="space-y-2">
                {(c.recommendations || []).map((rec, i) => (
                  <div key={`k-${i}`} className="text-xs p-2 rounded bg-primary/5 border border-primary/20 flex items-start gap-2">
                    <ChevronRight className="w-3 h-3 mt-0.5 text-primary flex-shrink-0" />{rec}
                  </div>
                ))}
              </div>
              <Button size="sm" className="w-full mt-3" onClick={() => analyzeClient(selectedClient)} data-testid="re-analyze-btn">
                <RefreshCw className="w-3 h-3 mr-1" />Re-Analyze
              </Button>
            </CardContent>
          </Card>
        </div>

        {(clientDetail.history || []).length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Score History</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-end gap-1 h-20">
                {clientDetail.history.slice(0, 30).reverse().map((h, i) => {
                  const color = h.score >= 70 ? "bg-emerald-500" : h.score >= 50 ? "bg-blue-500" : h.score >= 30 ? "bg-amber-500" : "bg-red-500";
                  return (
                    <div key={`k-${i}`} className={`flex-1 ${color} rounded-t opacity-70 hover:opacity-100 transition-opacity`}
                      style={{ height: `${h.score}%` }} title={`${h.analyzed_at?.slice(0, 10)}: ${h.score}`} />
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // DASHBOARD VIEW
  const d = dashboard || {};
  return (
    <div className="space-y-5" data-testid="sentiment-dashboard">
      <div className={`flex items-center ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded && <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Heart className="w-8 h-8 text-pink-400" />Client Sentiment</h1>
          <p className="text-muted-foreground">{d.total_clients || 0} clients scored &middot; Avg: {d.avg_score || 0}/100</p>
        </div>}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchAll}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={analyzeAll} disabled={analyzing} data-testid="analyze-all-sentiment-btn">
            {analyzing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}
            Analyze All Clients
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { key: "thriving", icon: SmilePlus, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { key: "healthy", icon: ThumbsUp, color: "text-blue-400", bg: "bg-blue-500/10" },
          { key: "neutral", icon: Meh, color: "text-zinc-400", bg: "bg-zinc-500/10" },
          { key: "at_risk", icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10" },
          { key: "critical", icon: Frown, color: "text-red-400", bg: "bg-red-500/10" },
        ].map(s => {
          const Icon = s.icon;
          const count = d[s.key] || d.distribution?.[s.key] || 0;
          return (
            <Card key={s.key}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${s.color}`} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground capitalize">{s.key.replace("_", " ")}</p>
                    <p className={`text-xl font-bold ${s.color}`}>{count}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* At-Risk Clients */}
      {atRisk.length > 0 && (
        <Card className="border-amber-500/20">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />At-Risk Clients ({atRisk.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {atRisk.map(c => {
              const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.neutral;
              return (
                <div key={c.client_id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30 cursor-pointer hover:bg-muted/30 transition-all"
                  onClick={() => viewClient(c.client_id)} data-testid={`at-risk-${c.client_id}`}>
                  <div className="flex items-center gap-3">
                    <SentimentGauge score={c.score || 0} size="sm" />
                    <div>
                      <p className="font-medium text-sm">{c.client_name}</p>
                      <p className="text-xs text-muted-foreground">Risk: {c.risk_level} &middot; Churn: {Math.round((c.churn_probability || 0) * 100)}%</p>
                    </div>
                  </div>
                  <Badge className={cfg.color}>{cfg.label}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* All Clients Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-blue-400" />All Client Sentiments</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Client</TableHead><TableHead>Score</TableHead><TableHead>Status</TableHead><TableHead>Risk</TableHead><TableHead>Churn %</TableHead><TableHead>Last Analyzed</TableHead><TableHead></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {clients.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12">
                  <Heart className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" />
                  <p className="text-muted-foreground">No sentiment data yet. Click "Analyze All Clients" to start.</p>
                </TableCell></TableRow>
              ) : clients.map(c => {
                const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.neutral;
                const StatusIcon = cfg.icon;
                return (
                  <TableRow key={c.client_id} className="cursor-pointer hover:bg-muted/30" onClick={() => viewClient(c.client_id)}>
                    <TableCell className="font-medium">{c.client_name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black ${c.score >= 70 ? "bg-emerald-500/20 text-emerald-400" : c.score >= 50 ? "bg-blue-500/20 text-blue-400" : c.score >= 30 ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
                          {c.score}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Badge className={`${cfg.color} text-[10px]`}><StatusIcon className="w-3 h-3 mr-1" />{cfg.label}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{c.risk_level}</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{Math.round((c.churn_probability || 0) * 100)}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.analyzed_at?.slice(0, 10) || "-"}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); analyzeClient(c.client_id); }}>Re-analyze</Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
