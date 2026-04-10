import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Shield, RefreshCw, Link2, Database, DollarSign, Users, CheckCircle } from "lucide-react";

export default function AcronisPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [customers, setCustomers] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, sRes, sumRes, clRes] = await Promise.all([
        axios.get(`${API}/acronis/customers`, { headers }),
        axios.get(`${API}/acronis/subscriptions`, { headers }),
        axios.get(`${API}/acronis/usage-summary`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setCustomers(cRes.data); setSubscriptions(sRes.data); setSummary(sumRes.data); setClients(clRes.data);
    } catch { toast.error("Failed to load Acronis data"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const handleLink = async (custId, clientId) => {
    try { await axios.post(`${API}/acronis/customers/${custId}/link`, { client_id: clientId }, { headers }); toast.success("Customer linked"); fetchData(); } catch { toast.error("Failed to link"); }
  };

  const handleSync = async () => {
    try { await axios.post(`${API}/acronis/sync`, {}, { headers }); toast.success("Synced"); fetchData(); } catch { toast.error("Sync failed"); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Acronis</h1><p className="text-muted-foreground">Cyber Protect Cloud management</p></div>
        <Button variant="outline" onClick={handleSync} data-testid="sync-acronis-btn"><RefreshCw className="w-4 h-4 mr-1" />Sync</Button>
      </div>

      {summary && <div className="grid grid-cols-4 gap-4">
        {[{ label: "Customers", value: summary.total_customers, icon: Users, color: "text-blue-500" }, { label: "Protected", value: `${summary.protected_devices}/${summary.total_devices}`, icon: Shield, color: "text-emerald-500" }, { label: "Storage", value: `${summary.total_storage_used_gb} GB`, icon: Database, color: "text-violet-500" }, { label: "MRR", value: `$${summary.total_monthly_revenue?.toLocaleString()}`, icon: DollarSign, color: "text-amber-500" }].map((s, i) => (
          <Card key={`k-${i}`}><CardContent className="pt-4"><div className="flex items-center gap-3"><s.icon className={`w-8 h-8 ${s.color}`} /><div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-xl font-bold">{s.value}</p></div></div></CardContent></Card>
        ))}
      </div>}

      <Tabs defaultValue="customers">
        <TabsList><TabsTrigger value="customers">Customers ({customers.length})</TabsTrigger><TabsTrigger value="subscriptions">Subscriptions ({subscriptions.length})</TabsTrigger></TabsList>
        <TabsContent value="customers">
          <Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Edition</TableHead><TableHead>Devices</TableHead><TableHead>Storage</TableHead><TableHead>Linked Client</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>{customers.map(c => (
              <TableRow key={c.id} data-testid={`acronis-customer-${c.id}`}>
                <TableCell><div><p className="font-medium">{c.name}</p><p className="text-[10px] text-muted-foreground font-mono">{c.acronis_tenant_id}</p></div></TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{c.edition}</Badge></TableCell>
                <TableCell>{c.protected_devices}/{c.total_devices}</TableCell>
                <TableCell>{c.storage_used_gb}/{c.storage_quota_gb} GB</TableCell>
                <TableCell>{c.linked_client_name ? <div className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-emerald-500" /><span className="text-sm">{c.linked_client_name}</span></div> : <Select onValueChange={v => handleLink(c.id, v)}><SelectTrigger className="h-7 text-xs w-40" data-testid={`link-client-${c.id}`}><SelectValue placeholder="Link..." /></SelectTrigger><SelectContent>{clients.map(cl => <SelectItem key={cl.id} value={cl.id}>{cl.name}</SelectItem>)}</SelectContent></Select>}</TableCell>
                <TableCell><Button variant="ghost" size="sm" className="h-7"><Link2 className="w-3 h-3" /></Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="subscriptions">
          <Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Service</TableHead><TableHead>Qty</TableHead><TableHead>Unit</TableHead><TableHead>$/Unit</TableHead><TableHead>Monthly</TableHead><TableHead>Usage</TableHead></TableRow></TableHeader>
            <TableBody>{subscriptions.map((s, i) => (
              <TableRow key={`k-${i}`}><TableCell className="text-sm">{s.customer_name}</TableCell><TableCell className="font-medium text-sm">{s.service_name}</TableCell><TableCell>{s.quantity}</TableCell><TableCell className="text-xs">{s.unit}</TableCell><TableCell>${s.price_per_unit}</TableCell><TableCell className="font-medium">${s.monthly_cost}</TableCell><TableCell><Badge className={s.usage_percent > 90 ? "bg-red-500/10 text-red-500" : s.usage_percent > 70 ? "bg-yellow-500/10 text-yellow-500" : "bg-emerald-500/10 text-emerald-500"}>{s.usage_percent}%</Badge></TableCell></TableRow>
            ))}</TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}
