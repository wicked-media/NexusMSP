import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Shield, CheckCircle, XCircle, AlertTriangle, Loader2, Lock, FileText, Users, BarChart3, Eye } from "lucide-react";

const FW_COLORS = { "NIST 800-171": "bg-blue-500", "CIS Controls v8": "bg-emerald-500", "SOC 2 Type II": "bg-purple-500", "HIPAA": "bg-rose-500" };
const FW_ICONS = { "NIST 800-171": Lock, "CIS Controls v8": Shield, "SOC 2 Type II": FileText, "HIPAA": Users };

export default function ComplianceFrameworksPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedFw, setExpandedFw] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/compliance-frameworks/overview`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to load compliance data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const s = data.summary;
  const gapControls = s.total_controls - s.controls_met;

  return (
    <div className="space-y-5" data-testid="compliance-frameworks-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-indigo-500 flex items-center justify-center"><Shield className="w-5 h-5 text-white" /></div>
          Compliance Evidence & Framework Tracker
        </h1>
        <p className="text-muted-foreground mt-1">HIPAA, SOC 2, NIST, CIS — benchmark tracking with gap analysis and evidence collection</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Frameworks", value: s.total_frameworks, icon: Shield, color: "text-foreground" },
          { label: "Avg Compliance", value: `${s.avg_compliance_pct}%`, icon: BarChart3, color: s.avg_compliance_pct >= 80 ? "text-emerald-400" : "text-amber-400" },
          { label: "Total Controls", value: s.total_controls, icon: FileText, color: "text-blue-400" },
          { label: "Controls Met", value: s.controls_met, icon: CheckCircle, color: "text-emerald-400" },
          { label: "Gap Items", value: gapControls, icon: AlertTriangle, color: gapControls > 0 ? "text-red-400" : "text-emerald-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Overall Compliance Gauge */}
      <Card className="border-border/40">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Overall Compliance Posture</span>
            <span className={`text-sm font-bold ${s.avg_compliance_pct >= 80 ? "text-emerald-400" : "text-amber-400"}`}>{s.avg_compliance_pct}%</span>
          </div>
          <Progress value={s.avg_compliance_pct} className={`h-3 ${s.avg_compliance_pct < 80 ? "[&>div]:bg-amber-500" : ""}`} />
          <div className="grid grid-cols-4 gap-3 mt-3">
            {data.frameworks.map(fw => {
              const color = FW_COLORS[fw.name] || "bg-slate-500";
              const Icon = FW_ICONS[fw.name] || Shield;
              return (
                <div key={fw.id} className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded ${color} flex items-center justify-center`}><Icon className="w-3 h-3 text-white" /></div>
                  <div>
                    <p className="text-xs font-semibold">{fw.name}</p>
                    <p className={`text-[10px] font-bold ${fw.compliance_pct >= 80 ? "text-emerald-400" : "text-amber-400"}`}>{fw.compliance_pct}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Framework Cards */}
      <div className="space-y-4">
        {data.frameworks.map(fw => {
          const isExpanded = expandedFw === fw.id;
          const color = FW_COLORS[fw.name] || "bg-slate-500";
          const Icon = FW_ICONS[fw.name] || Shield;
          const gapCategories = fw.categories.filter(c => c.pct < 100);
          return (
            <Card key={fw.id} className="border-border/40">
              <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpandedFw(isExpanded ? null : fw.id)}>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center`}><Icon className="w-4 h-4 text-white" /></div>
                    {fw.name}
                  </CardTitle>
                  <div className="flex items-center gap-3">
                    <Badge className={fw.compliance_pct >= 80 ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}>{fw.compliance_pct}% Compliant</Badge>
                    <span className="text-xs text-muted-foreground">{fw.controls_met}/{fw.total_controls} controls</span>
                    {fw.clients_applicable && <Badge variant="outline" className="text-[10px]"><Users className="w-3 h-3 mr-1" />{fw.clients_applicable} clients</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Progress value={fw.compliance_pct} className={`h-2 mb-3 ${fw.compliance_pct < 80 ? "[&>div]:bg-amber-500" : ""}`} />
                <div className="grid grid-cols-2 gap-2">
                  {(isExpanded ? fw.categories : fw.categories.slice(0, 6)).map(c => (
                    <div key={c.category} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all ${c.pct >= 100 ? "border-emerald-500/20 bg-emerald-500/5" : c.pct >= 80 ? "border-border/30" : "border-red-500/20 bg-red-500/5"}`}>
                      {c.pct >= 100 ? <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : c.pct >= 80 ? <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.category}</p>
                        <div className="flex items-center gap-2 mt-0.5"><Progress value={c.pct} className="h-1 flex-1" /><span className="text-[10px] font-bold">{c.pct}%</span></div>
                      </div>
                      <span className="text-xs text-muted-foreground">{c.met}/{c.total}</span>
                    </div>
                  ))}
                </div>
                {!isExpanded && fw.categories.length > 6 && <p className="text-xs text-primary mt-2 cursor-pointer hover:underline" onClick={() => setExpandedFw(fw.id)}>Show all {fw.categories.length} categories...</p>}
                {isExpanded && (
                  <>
                    <Separator className="my-3" />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Last assessed: {fw.last_assessed ? new Date(fw.last_assessed).toLocaleDateString() : "N/A"}</span>
                      <span>Next assessment: {fw.next_assessment ? new Date(fw.next_assessment).toLocaleDateString() : "N/A"}</span>
                    </div>
                    {gapCategories.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-red-400 mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Gap Analysis: {gapCategories.length} categories need attention</p>
                        {gapCategories.map(c => (
                          <div key={c.category} className="flex items-center gap-2 text-xs p-1.5 rounded bg-red-500/5 border border-red-500/10 mb-1">
                            <XCircle className="w-3 h-3 text-red-400" />
                            <span>{c.category}: {c.total - c.met} controls unmet</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
