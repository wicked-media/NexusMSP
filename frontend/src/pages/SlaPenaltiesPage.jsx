import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, AlertTriangle, CheckCircle, Calculator } from "lucide-react";
import { toast } from "sonner";

export default function SlaPenaltiesPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [contracts, setContracts] = useState([]);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = () => {
    Promise.all([
      axios.get(`${API}/sla-penalties/dashboard`, { headers }),
      axios.get(`${API}/contracts`, { headers }),
    ]).then(([d, c]) => {
      setData(d.data);
      setContracts(c.data.filter(ct => ct.status === "active"));
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const calculatePenalty = async (contractId) => {
    try {
      const { data: result } = await axios.post(`${API}/sla-penalties/calculate/${contractId}`, {}, { headers });
      toast.success(`Penalty calculated: $${result.amount}`);
      fetchData();
    } catch { toast.error("Calculation failed"); }
  };

  const issueCredit = async (penaltyId) => {
    await axios.post(`${API}/sla-penalties/${penaltyId}/issue-credit`, {}, { headers });
    toast.success("Credit note issued");
    fetchData();
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6" data-testid="sla-penalties-page">
      <div><h1 className="text-2xl font-bold tracking-tight">SLA Penalty Calculator</h1>
        <p className="text-muted-foreground text-sm mt-1">Auto-calculate penalties when SLAs are breached</p></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold">{data.stats.total_breaches}</p>
          <p className="text-xs text-muted-foreground">Total Breaches</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold text-red-500">${data.stats.total_penalties.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Total Penalties</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold text-amber-500">${data.stats.pending_credits.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Pending Credits</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold text-green-500">${data.stats.issued_credits.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Issued Credits</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4" />Calculate Penalties</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Contract</TableHead><TableHead>Client</TableHead><TableHead>Value</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {contracts.map(c => (
                <TableRow key={c.id} data-testid={`contract-calc-${c.id}`}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.client_name}</TableCell>
                  <TableCell className="font-mono">${c.value?.toLocaleString()}/mo</TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => calculatePenalty(c.id)} data-testid={`calc-btn-${c.id}`}><Calculator className="w-3 h-3 mr-1" />Calculate</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.penalties.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Penalty History</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Contract</TableHead><TableHead>Client</TableHead><TableHead>Breaches</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.penalties.map(p => (
                  <TableRow key={p.id} data-testid={`penalty-${p.id}`}>
                    <TableCell>{p.contract_name}</TableCell>
                    <TableCell>{p.client_name}</TableCell>
                    <TableCell>{p.breaches}</TableCell>
                    <TableCell className="font-mono text-red-500">${p.amount.toLocaleString()}</TableCell>
                    <TableCell><Badge variant={p.status === "issued" ? "default" : "secondary"} className="capitalize">{p.status}</Badge></TableCell>
                    <TableCell>{p.status === "pending" && <Button size="sm" onClick={() => issueCredit(p.id)}>Issue Credit</Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
