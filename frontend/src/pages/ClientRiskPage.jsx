import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ShieldAlert, AlertTriangle, Users, DollarSign, RefreshCw } from "lucide-react";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";

const riskColors = { critical: "destructive", high: "destructive", medium: "secondary", low: "outline", unassessed: "outline" };

export default function ClientRiskPage({ embedded = false }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const load = () => {
    setLoading(true);
    axios.get(`${API}/client-risk/dashboard`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6" data-testid="client-risk-page">
      {!embedded && <OperationalPageHeader eyebrow="Client intelligence" title="Client risk signals" description="Shows attributable operational, financial, sentiment, and CSAT signals. Customers without feedback evidence are marked unassessed rather than low-risk." icon={ShieldAlert} tone="amber" actions={<Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1 h-4 w-4" />Refresh</Button>} />}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <HeroTile label="Total Clients" value={data.stats.total_clients} icon={Users} glow="violet" testId="risk-total-clients" />
        <HeroTile label="Critical Risk" value={data.stats.critical} icon={AlertTriangle} glow="rose" testId="risk-critical" />
        <HeroTile label="High Risk" value={data.stats.high} icon={AlertTriangle} glow="amber" testId="risk-high" />
        <HeroTile label="Medium Risk" value={data.stats.medium} icon={ShieldAlert} glow="amber" testId="risk-medium" />
        <HeroTile label="Evidence gaps" value={data.stats.unassessed} icon={ShieldAlert} glow="amber" testId="risk-unassessed" />
        <HeroTile label="At-Risk MRR" value={`$${data.stats.total_at_risk_mrr.toLocaleString()}`} icon={DollarSign} glow="rose" animated={false} testId="risk-mrr" />
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
                  <TableCell><div className="space-y-0.5">{c.risk_factors.map((f, i) => <p key={`k-${i}`} className="text-[10px] text-muted-foreground">{f}</p>)}{c.evidence_gaps?.slice(0, 2).map((gap, i) => <p key={`g-${i}`} className="text-[10px] text-amber-400">{gap}</p>)}</div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
