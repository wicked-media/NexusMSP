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

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Clients",  value: data.stats.total_clients,                tone: "violet",  icon: Users },
          { label: "Critical Risk",  value: data.stats.critical,                     tone: "rose" },
          { label: "High Risk",      value: data.stats.high,                         tone: "orange" },
          { label: "Medium Risk",    value: data.stats.medium,                       tone: "amber" },
          { label: "Low Risk",       value: data.stats.low,                          tone: "emerald" },
          { label: "At-Risk MRR",    value: `$${data.stats.total_at_risk_mrr.toLocaleString()}`, tone: "rose", icon: DollarSign },
        ].map((m, i) => {
          const tones = {
            violet:  "from-violet-500/20 to-fuchsia-600/10 border-violet-500/30 text-violet-300 shadow-violet-500/20",
            rose:    "from-rose-500/20 to-red-600/10 border-rose-500/30 text-rose-300 shadow-rose-500/20",
            orange:  "from-orange-500/20 to-red-600/10 border-orange-500/30 text-orange-300 shadow-orange-500/20",
            amber:   "from-amber-500/20 to-orange-600/10 border-amber-500/30 text-amber-300 shadow-amber-500/20",
            emerald: "from-emerald-500/20 to-green-600/10 border-emerald-500/30 text-emerald-300 shadow-emerald-500/20",
          }[m.tone];
          const Ic = m.icon;
          return (
            <div key={`k-${i}`} className={`relative overflow-hidden rounded-lg border bg-gradient-to-br ${tones} shadow-lg p-4`}>
              <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-current opacity-10 blur-2xl" />
              <div className="relative">
                <div className="text-[10px] uppercase tracking-widest opacity-80 flex items-center gap-1">{Ic && <Ic className="w-3 h-3" />}{m.label}</div>
                <div className="text-3xl font-bold font-mono tracking-tighter mt-1">{m.value}</div>
              </div>
            </div>
          );
        })}
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
