import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Plus } from "lucide-react";

export default function ExecutiveReportsPage() {
  const { token } = useAuth();
  const [reports, setReports] = useState([]);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/executive-reports/list`, { headers }).then(r => setReports(r.data)); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6" data-testid="executive-reports-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Executive Reports</h1><p className="text-muted-foreground text-sm">Automated monthly client reports with security, uptime, and SLA metrics</p></div>
        <Button><Plus className="w-4 h-4 mr-1" />Generate Report</Button>
      </div>
      <div className="space-y-3">
        {reports.map(r => (
          <Card key={r.id}><CardContent className="pt-4">
            <div className="flex items-center gap-4">
              <FileText className="w-8 h-8 text-blue-500" />
              <div className="flex-1">
                <div className="flex items-center gap-2"><span className="font-semibold">{r.client_name}</span><Badge>{r.period}</Badge><Badge variant="outline">{r.report_type}</Badge></div>
                {r.sections && (
                  <div className="grid grid-cols-4 gap-4 mt-2 text-sm">
                    <div><span className="text-muted-foreground">Security:</span> {r.sections.security_score}/100</div>
                    <div><span className="text-muted-foreground">Uptime:</span> {r.sections.uptime_pct}%</div>
                    <div><span className="text-muted-foreground">Tickets:</span> {r.sections.tickets_resolved} resolved</div>
                    <div><span className="text-muted-foreground">SLA:</span> {r.sections.sla_compliance_pct}%</div>
                  </div>
                )}
              </div>
              <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
              <Button variant="outline" size="sm"><Download className="w-3 h-3 mr-1" />PDF</Button>
            </div>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
