import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  FileText, TrendingUp, Shield, Plus, BarChart3, Clock, CheckCircle,
  Download, Eye, ChevronDown, ChevronUp, Star, AlertTriangle,
  Target, Cpu, HardDrive, Users, Loader2, RefreshCw, Zap
} from "lucide-react";

export default function QBRGeneratorPage() {
  const { token } = useAuth();
  const [qbrs, setQbrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [genClient, setGenClient] = useState("");
  const [genQuarter, setGenQuarter] = useState("Q1 2026");
  const [clients, setClients] = useState([]);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, cRes] = await Promise.all([
        axios.get(`${API}/qbr-generator/list`, { headers }),
        axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
      ]);
      setQbrs(Array.isArray(qRes.data) ? qRes.data : []);
      setClients(Array.isArray(cRes.data) ? cRes.data : []);
    } catch { toast.error("Failed to load QBR data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const generateQBR = async () => {
    if (!genClient) { toast.error("Select a client"); return; }
    try {
      await axios.post(`${API}/qbr-generator/generate`, { client_name: genClient, quarter: genQuarter }, { headers });
      toast.success("QBR generation started");
      setShowGenerate(false);
      fetchData();
    } catch { toast.error("Failed to generate QBR"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const completed = qbrs.filter(q => q.status === "completed");
  const avgSecurity = completed.length ? Math.round(completed.reduce((s, q) => s + (q.sections?.security_posture?.score || 0), 0) / completed.length) : 0;
  const avgUptime = completed.length ? (completed.reduce((s, q) => s + (q.sections?.uptime?.pct || 0), 0) / completed.length).toFixed(2) : 0;
  const avgSLA = completed.length ? (completed.reduce((s, q) => s + (q.sections?.tickets?.sla_met_pct || 0), 0) / completed.length).toFixed(1) : 0;

  return (
    <div className="space-y-5" data-testid="qbr-generator-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center"><FileText className="w-5 h-5 text-white" /></div>
            QBR Report Generator
          </h1>
          <p className="text-muted-foreground mt-1">Auto-generate Quarterly Business Reviews with AI-powered insights & upsell recommendations</p>
        </div>
        <Button onClick={() => setShowGenerate(true)} data-testid="generate-qbr-btn" className="bg-gradient-to-r from-blue-600 to-indigo-600"><Plus className="w-4 h-4 mr-2" />Generate QBR</Button>
      </div>

      {/* Aggregate Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total QBRs", value: qbrs.length, icon: FileText, color: "text-foreground" },
          { label: "Avg Security Score", value: `${avgSecurity}/100`, icon: Shield, color: "text-emerald-400" },
          { label: "Avg Uptime", value: `${avgUptime}%`, icon: TrendingUp, color: "text-cyan-400" },
          { label: "Avg SLA Met", value: `${avgSLA}%`, icon: Target, color: "text-amber-400" },
          { label: "Clients Covered", value: new Set(qbrs.map(q => q.client_name)).size, icon: Users, color: "text-purple-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* QBR Cards */}
      {qbrs.length === 0 ? (
        <Card className="border-dashed border-border/40"><CardContent className="py-16 text-center">
          <FileText className="w-14 h-14 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-lg font-semibold mb-1">No QBR Reports Yet</p>
          <p className="text-sm text-muted-foreground mb-5">Generate your first Quarterly Business Review</p>
          <Button onClick={() => setShowGenerate(true)}><Plus className="w-4 h-4 mr-2" />Generate QBR</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {qbrs.map(q => {
            const isExpanded = expandedId === q.id;
            const sec = q.sections;
            return (
              <Card key={q.id} className="border-border/40 transition-all">
                <CardContent className="pt-4">
                  {/* Header */}
                  <div className="flex items-center gap-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : q.id)} data-testid={`qbr-card-${q.id}`}>
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center border border-blue-500/20">
                      <FileText className="w-5 h-5 text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold">{q.client_name}</h3>
                      <p className="text-xs text-muted-foreground">{q.quarter} | Generated {new Date(q.generated_at).toLocaleDateString()} by {q.generated_by}</p>
                    </div>
                    <Badge className={q.status === "completed" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}>{q.status}</Badge>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>

                  {/* Quick Metrics Row (always visible) */}
                  {sec && (
                    <div className="grid grid-cols-4 gap-3 mt-3">
                      <div className="p-2.5 rounded-lg bg-muted/30 text-center border border-border/20">
                        <Shield className="w-4 h-4 mx-auto mb-1 text-emerald-400" />
                        <p className="text-lg font-bold">{sec.security_posture?.score}/100</p>
                        <p className="text-[10px] text-muted-foreground">Security</p>
                        <Badge className="text-[9px] bg-emerald-500/20 text-emerald-400 mt-1">{sec.security_posture?.change}</Badge>
                      </div>
                      <div className="p-2.5 rounded-lg bg-muted/30 text-center border border-border/20">
                        <TrendingUp className="w-4 h-4 mx-auto mb-1 text-cyan-400" />
                        <p className="text-lg font-bold">{sec.uptime?.pct}%</p>
                        <p className="text-[10px] text-muted-foreground">Uptime</p>
                        <p className="text-[9px] text-muted-foreground mt-1">{sec.uptime?.downtime_minutes}m down</p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-muted/30 text-center border border-border/20">
                        <CheckCircle className="w-4 h-4 mx-auto mb-1 text-amber-400" />
                        <p className="text-lg font-bold">{sec.tickets?.resolved}</p>
                        <p className="text-[10px] text-muted-foreground">Tickets Resolved</p>
                        <p className="text-[9px] text-muted-foreground mt-1">{sec.tickets?.avg_resolution_hours}h avg</p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-muted/30 text-center border border-border/20">
                        <Target className="w-4 h-4 mx-auto mb-1 text-purple-400" />
                        <p className="text-lg font-bold">{sec.tickets?.sla_met_pct}%</p>
                        <p className="text-[10px] text-muted-foreground">SLA Met</p>
                        <p className="text-[9px] text-muted-foreground mt-1">{sec.tickets?.opened} opened</p>
                      </div>
                    </div>
                  )}

                  {/* Expanded Detail */}
                  {isExpanded && sec && (
                    <div className="mt-4 space-y-4">
                      <Separator />
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Executive Summary</h4>
                        <p className="text-sm leading-relaxed bg-muted/20 p-3 rounded-lg border border-border/20 italic">{sec.executive_summary}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Security Details</h4>
                        <div className="grid grid-cols-3 gap-3 text-sm">
                          <div className="p-2 rounded bg-muted/20"><span className="text-muted-foreground text-xs">Incidents</span><p className="font-bold">{sec.security_posture?.incidents}</p></div>
                          <div className="p-2 rounded bg-muted/20"><span className="text-muted-foreground text-xs">Patches Applied</span><p className="font-bold">{sec.security_posture?.patches_applied}</p></div>
                          <div className="p-2 rounded bg-muted/20"><span className="text-muted-foreground text-xs">Score Trend</span><p className="font-bold text-emerald-400">{sec.security_posture?.change}</p></div>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2"><Zap className="w-3 h-3 text-amber-400" />AI Recommendations & Upsell Opportunities</h4>
                        <div className="space-y-1.5">
                          {(sec.recommendations || []).map((r, i) => (
                            <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg border border-border/20 bg-amber-500/5">
                              <Star className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                              <p className="text-sm">{r}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled><Download className="w-3 h-3 mr-1" />Export PDF</Button>
                        <Button variant="outline" size="sm" disabled><Users className="w-3 h-3 mr-1" />Send to Client</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Generate Dialog */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent aria-describedby="gen-qbr-desc">
          <DialogHeader>
            <DialogTitle>Generate New QBR</DialogTitle>
            <DialogDescription id="gen-qbr-desc">Select a client and quarter to generate an AI-powered QBR</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Client</label>
              <Select value={genClient} onValueChange={setGenClient}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select client..." /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id || c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Quarter</label>
              <Select value={genQuarter} onValueChange={setGenQuarter}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Q1 2026", "Q4 2025", "Q3 2025", "Q2 2025"].map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerate(false)}>Cancel</Button>
            <Button onClick={generateQBR} data-testid="confirm-generate-btn"><Zap className="w-4 h-4 mr-2" />Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
