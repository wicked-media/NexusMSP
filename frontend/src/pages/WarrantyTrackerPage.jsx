import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, AlertTriangle, Clock, CheckCircle, HelpCircle } from "lucide-react";

const statusColors = { active: "default", expiring_soon: "secondary", expired: "destructive", unknown: "outline" };

export default function WarrantyTrackerPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("expiring_soon");
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/warranty/overview`, { headers })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  const { stats } = data;
  const tabData = { expiring_soon: data.expiring_soon, expired: data.expired, active: data.active, unknown: data.unknown };

  return (
    <div className="space-y-6" data-testid="warranty-tracker-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Warranty Tracker</h1>
        <p className="text-muted-foreground text-sm mt-1">Track warranty status across all devices</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold">{stats.total}</p>
          <p className="text-xs text-muted-foreground">Total Devices</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <CheckCircle className="w-4 h-4 mx-auto mb-1 text-green-500" />
          <p className="text-xl font-bold text-green-500">{stats.active}</p>
          <p className="text-xs text-muted-foreground">Active Warranty</p>
        </CardContent></Card>
        <Card className="border-amber-500/30"><CardContent className="pt-4 pb-3 text-center">
          <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-amber-500" />
          <p className="text-xl font-bold text-amber-500">{stats.expiring_soon}</p>
          <p className="text-xs text-muted-foreground">Expiring Soon (&lt;90d)</p>
        </CardContent></Card>
        <Card className="border-red-500/30"><CardContent className="pt-4 pb-3 text-center">
          <Shield className="w-4 h-4 mx-auto mb-1 text-red-500" />
          <p className="text-xl font-bold text-red-500">{stats.expired}</p>
          <p className="text-xs text-muted-foreground">Expired</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <HelpCircle className="w-4 h-4 mx-auto mb-1 text-slate-400" />
          <p className="text-xl font-bold text-slate-400">{stats.unknown}</p>
          <p className="text-xs text-muted-foreground">Unknown</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="expiring_soon">Expiring Soon ({stats.expiring_soon})</TabsTrigger>
              <TabsTrigger value="expired">Expired ({stats.expired})</TabsTrigger>
              <TabsTrigger value="active">Active ({stats.active})</TabsTrigger>
              <TabsTrigger value="unknown">Unknown ({stats.unknown})</TabsTrigger>
            </TabsList>
            {["expiring_soon", "expired", "active", "unknown"].map(t => (
              <TabsContent key={t} value={t}>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Hostname</TableHead><TableHead>Type</TableHead><TableHead>Manufacturer</TableHead>
                    <TableHead>Model</TableHead><TableHead>Client</TableHead><TableHead>Warranty</TableHead><TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(tabData[t] || []).map(d => (
                      <TableRow key={d.id} data-testid={`warranty-row-${d.id}`}>
                        <TableCell className="font-medium">{d.hostname}</TableCell>
                        <TableCell className="capitalize text-sm">{d.device_type}</TableCell>
                        <TableCell className="text-sm">{d.manufacturer}</TableCell>
                        <TableCell className="text-sm">{d.model}</TableCell>
                        <TableCell className="text-sm">{d.client_name}</TableCell>
                        <TableCell>
                          {d.warranty_expiry ? new Date(d.warranty_expiry).toLocaleDateString() : "N/A"}
                          {d.days_left !== undefined && <span className="text-xs text-muted-foreground ml-1">({d.days_left}d left)</span>}
                          {d.days_expired !== undefined && <span className="text-xs text-red-400 ml-1">({d.days_expired}d ago)</span>}
                        </TableCell>
                        <TableCell><Badge variant={statusColors[d.warranty_status]} className="text-xs capitalize">{d.warranty_status?.replace("_"," ")}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {(tabData[t] || []).length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No devices in this category</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
