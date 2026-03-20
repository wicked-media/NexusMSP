import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, TrendingUp, Shield, Plus } from "lucide-react";

export default function QBRGeneratorPage() {
  const { token } = useAuth();
  const [qbrs, setQbrs] = useState([]);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/qbr-generator/list`, { headers }).then(r => setQbrs(r.data)); }, []);

  return (
    <div className="space-y-6" data-testid="qbr-generator-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">AI QBR Generator</h1><p className="text-muted-foreground text-sm">Auto-generate Quarterly Business Reviews with AI-powered insights</p></div>
        <Button><Plus className="w-4 h-4 mr-1" />Generate QBR</Button>
      </div>
      {qbrs.map(q => (
        <Card key={q.id}><CardContent className="pt-4">
          <div className="flex items-center gap-4 mb-3">
            <FileText className="w-8 h-8 text-blue-500" />
            <div className="flex-1"><h3 className="font-semibold">{q.client_name}</h3><div className="text-sm text-muted-foreground">{q.quarter} | Generated: {new Date(q.generated_at).toLocaleDateString()}</div></div>
            <Badge variant={q.status === "completed" ? "default" : "secondary"}>{q.status}</Badge>
          </div>
          {q.sections && (
            <div className="space-y-3">
              <p className="text-sm italic text-muted-foreground">{q.sections.executive_summary}</p>
              <div className="grid grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-muted/50 text-center"><div className="text-lg font-bold">{q.sections.security_posture.score}/100</div><div className="text-xs text-muted-foreground">Security</div><div className="text-xs text-green-500">{q.sections.security_posture.change}</div></div>
                <div className="p-3 rounded-lg bg-muted/50 text-center"><div className="text-lg font-bold">{q.sections.uptime.pct}%</div><div className="text-xs text-muted-foreground">Uptime</div></div>
                <div className="p-3 rounded-lg bg-muted/50 text-center"><div className="text-lg font-bold">{q.sections.tickets.resolved}</div><div className="text-xs text-muted-foreground">Resolved</div><div className="text-xs text-muted-foreground">{q.sections.tickets.avg_resolution_hours}h avg</div></div>
                <div className="p-3 rounded-lg bg-muted/50 text-center"><div className="text-lg font-bold">{q.sections.tickets.sla_met_pct}%</div><div className="text-xs text-muted-foreground">SLA Met</div></div>
              </div>
              <div><h4 className="text-sm font-medium mb-1">Recommendations:</h4><ul className="text-sm text-muted-foreground space-y-1">{q.sections.recommendations.map((r, i) => <li key={i} className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />{r}</li>)}</ul></div>
            </div>
          )}
        </CardContent></Card>
      ))}
    </div>
  );
}
