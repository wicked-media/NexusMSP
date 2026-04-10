import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ShieldAlert, AlertTriangle, Users, DollarSign } from "lucide-react";

const riskColors = { critical: "destructive", high: "destructive", medium: "secondary", low: "outline" };

export default function ClientRiskPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/client-risk/dashboard`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6" data-testid="client-risk-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Client Risk Scoring</h1>
        <p className="text-muted-foreground text-sm mt-1">Predict clients likely to churn based on multiple signals</p></div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><Users className="w-4 h-4 mx-auto mb-1" /><p className="text-xl font-bold">{data.stats.total_clients}</p><p className="text-xs text-muted-foreground">Total Clients</p></CardContent></Card>
        <Card className="border-red-500/30"><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold text-red-500">{data.stats.critical}</p><p className="text-xs text-muted-foreground">Critical Risk</p></CardContent></Card>
        <Card className="border-orange-500/30"><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold text-orange-500">{data.stats.high}</p><p className="text-xs text-muted-foreground">High Risk</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold text-amber-500">{data.stats.medium}</p><p className="text-xs text-muted-foreground">Medium Risk</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold text-green-500">{data.stats.low}</p><p className="text-xs text-muted-foreground">Low Risk</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><DollarSign className="w-4 h-4 mx-auto mb-1 text-red-500" /><p className="text-xl font-bold text-red-500">${data.stats.total_at_risk_mrr.toLocaleString()}</p><p className="text-xs text-muted-foreground">At-Risk MRR</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="w-4 h-4" />Client Risk Matrix</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Industry</TableHead><TableHead>MRR</TableHead><TableHead>Risk Score</TableHead><TableHead>Risk Level</TableHead><TableHead>Factors</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.clients.map(c => (
                <TableRow key={c.client_id} data-testid={`risk-row-${c.client_id}`}>
                  <TableCell className="font-medium">{c.client_name}</TableCell>
                  <TableCell className="text-xs">{c.industry}</TableCell>
                  <TableCell className="font-mono">${c.mrr.toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2"><Progress value={c.risk_score} className="h-2 w-16" /><span className="text-xs font-bold">{c.risk_score}</span></div>
                  </TableCell>
                  <TableCell><Badge variant={riskColors[c.risk_level]} className="capitalize text-xs">{c.risk_level}</Badge></TableCell>
                  <TableCell><div className="space-y-0.5">{c.risk_factors.map((f, i) => <p key={`k-${i}`} className="text-[10px] text-muted-foreground">{f}</p>)}</div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
