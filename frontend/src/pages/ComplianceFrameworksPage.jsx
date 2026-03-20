import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, CheckCircle, XCircle } from "lucide-react";

export default function ComplianceFrameworksPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/compliance-frameworks/overview`, { headers }).then(r => setData(r.data)); }, []);

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="compliance-frameworks-page">
      <div><h1 className="text-2xl font-bold">Compliance Frameworks</h1><p className="text-muted-foreground text-sm">HIPAA, SOC 2, NIST, CIS benchmark tracking with gap analysis</p></div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Frameworks Tracked</div><div className="text-3xl font-bold mt-1">{s.total_frameworks}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Avg Compliance</div><div className="text-3xl font-bold mt-1">{s.avg_compliance_pct}%</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Total Controls</div><div className="text-3xl font-bold mt-1">{s.total_controls}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Controls Met</div><div className="text-3xl font-bold text-green-500 mt-1">{s.controls_met}</div></CardContent></Card>
      </div>
      {data.frameworks.map(fw => (
        <Card key={fw.id}><CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Shield className="w-5 h-5" />{fw.name}</CardTitle>
            <div className="flex items-center gap-2"><Badge variant={fw.compliance_pct >= 80 ? "default" : fw.compliance_pct >= 60 ? "secondary" : "destructive"}>{fw.compliance_pct}% Compliant</Badge><span className="text-xs text-muted-foreground">{fw.controls_met}/{fw.total_controls} controls</span></div>
          </div>
        </CardHeader>
          <CardContent>
            <Progress value={fw.compliance_pct} className="h-2 mb-4" />
            <div className="grid grid-cols-2 gap-2">
              {fw.categories.map(c => (
                <div key={c.category} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50">
                  {c.pct >= 80 ? <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                  <div className="flex-1 text-sm">{c.category}</div>
                  <div className="text-sm font-medium">{c.met}/{c.total}</div>
                  <div className="w-16 text-right text-xs text-muted-foreground">{c.pct}%</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
