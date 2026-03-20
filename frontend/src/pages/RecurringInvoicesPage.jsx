import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Receipt, DollarSign, Calendar, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function RecurringInvoicesPage() {
  const { token } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/recurring-invoices/list`, { headers }); setInvoices(res.data); } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const totalMRR = invoices.filter(i => i.frequency === "monthly").reduce((a, i) => a + (i.amount || 0), 0);

  return (
    <div className="space-y-6" data-testid="recurring-invoices-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Recurring Invoices</h1><p className="text-muted-foreground text-sm mt-1">Automated invoice generation from contracts</p></div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><Receipt className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{invoices.length}</p><p className="text-xs text-muted-foreground">Recurring Templates</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><DollarSign className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">${totalMRR.toLocaleString()}</p><p className="text-xs text-muted-foreground">Monthly MRR</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><RefreshCw className="w-6 h-6 text-blue-500" /><div><p className="text-2xl font-bold">{invoices.reduce((a, i) => a + (i.invoices_generated || 0), 0)}</p><p className="text-xs text-muted-foreground">Invoices Generated</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Calendar className="w-6 h-6 text-amber-500" /><div><p className="text-2xl font-bold">{invoices.filter(i => { const d = new Date(i.next_generation); return d <= new Date(Date.now() + 7*86400000); }).length}</p><p className="text-xs text-muted-foreground">Due This Week</p></div></CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="text-lg">All Recurring Invoices</CardTitle></CardHeader>
        <CardContent><div className="space-y-3">{invoices.map(i => (
          <div key={i.id} className="p-4 rounded-lg border" data-testid={`rinv-${i.id}`}>
            <div className="flex items-center justify-between">
              <div><h3 className="font-semibold text-sm">{i.client_name}</h3><p className="text-xs text-muted-foreground">{i.description}</p></div>
              <div className="text-right"><p className="text-lg font-bold">${i.amount?.toLocaleString()}</p><Badge variant="outline">{i.frequency}</Badge></div>
            </div>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
              <span>Next: {i.next_generation}</span><span>Generated: {i.invoices_generated}x</span><Badge variant={i.status === "active" ? "default" : "secondary"}>{i.status}</Badge>
            </div>
          </div>
        ))}</div></CardContent>
      </Card>
    </div>
  );
}
