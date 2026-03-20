import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Shield, CheckCircle, Download } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

export default function ComplianceReportGenPage() {
  const { token } = useAuth();
  const [frameworks, setFrameworks] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [fRes, rRes] = await Promise.all([
          axios.get(`${API}/compliance-generator/frameworks`, { headers }),
          axios.get(`${API}/compliance-generator/reports`, { headers }),
        ]);
        setFrameworks(fRes.data);
        setReports(rRes.data);
      } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const scoreColor = (s) => s >= 85 ? "text-emerald-500" : s >= 70 ? "text-amber-500" : "text-red-500";

  return (
    <div className="space-y-6" data-testid="compliance-report-gen-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Compliance Report Generator</h1><p className="text-muted-foreground text-sm mt-1">HIPAA, SOC 2, CIS, Essential Eight, NIST compliance reports</p></div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {frameworks.map(f => (
          <Card key={f.id} className="hover:border-primary/50 transition-colors cursor-pointer" data-testid={`framework-${f.id}`}>
            <CardContent className="pt-5 text-center"><Shield className="w-8 h-8 text-primary mx-auto" /><h3 className="font-bold mt-2">{f.name}</h3><p className="text-xs text-muted-foreground mt-1">{f.controls} controls</p></CardContent>
          </Card>
        ))}
      </div>

      <Card><CardHeader><CardTitle className="text-lg">Generated Reports</CardTitle></CardHeader>
        <CardContent><div className="space-y-3">{reports.map(r => (
          <div key={r.id} className="flex items-center justify-between p-4 rounded-lg border" data-testid={`report-${r.id}`}>
            <div className="flex items-center gap-4">
              <div className="text-center"><p className={`text-2xl font-bold ${scoreColor(r.score)}`}>{r.score}</p><p className="text-[10px] text-muted-foreground">Score</p></div>
              <div><p className="font-medium">{r.client_name}</p><p className="text-xs text-muted-foreground">{r.framework} | {r.controls_passed}/{r.controls_total} controls passed</p><p className="text-xs text-muted-foreground">{new Date(r.generated_at).toLocaleDateString()} by {r.generated_by}</p></div>
            </div>
            <div className="flex items-center gap-2"><Progress value={r.score} className="w-24" /><Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge></div>
          </div>
        ))}</div></CardContent>
      </Card>
    </div>
  );
}
