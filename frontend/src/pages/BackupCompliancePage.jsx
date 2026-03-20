import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle, XCircle, AlertTriangle, HardDrive } from "lucide-react";

const complianceColors = { compliant: "default", non_compliant: "destructive", no_backup: "outline" };

export default function BackupCompliancePage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/backup-compliance/dashboard`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6" data-testid="backup-compliance-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Backup Compliance Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Track backup status and RPO/RTO compliance</p></div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><HardDrive className="w-4 h-4 mx-auto mb-1" /><p className="text-xl font-bold">{data.stats.total_devices}</p><p className="text-xs text-muted-foreground">Total Devices</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><CheckCircle className="w-4 h-4 mx-auto mb-1 text-green-500" /><p className="text-xl font-bold text-green-500">{data.stats.compliant}</p><p className="text-xs text-muted-foreground">Compliant</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><XCircle className="w-4 h-4 mx-auto mb-1 text-red-500" /><p className="text-xl font-bold text-red-500">{data.stats.non_compliant}</p><p className="text-xs text-muted-foreground">Non-Compliant</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><AlertTriangle className="w-4 h-4 mx-auto mb-1 text-amber-500" /><p className="text-xl font-bold text-amber-500">{data.stats.no_backup}</p><p className="text-xs text-muted-foreground">No Backup</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><Shield className="w-4 h-4 mx-auto mb-1 text-primary" /><p className="text-xl font-bold">{data.stats.compliance_pct}%</p><p className="text-xs text-muted-foreground">Compliance Rate</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Device Backup Status</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>Type</TableHead><TableHead>Last Backup</TableHead><TableHead>RPO</TableHead><TableHead>RTO</TableHead><TableHead>Size</TableHead><TableHead>Compliance</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.devices.map(d => (
                <TableRow key={d.device_id} data-testid={`backup-row-${d.device_id}`}>
                  <TableCell className="font-medium">{d.device_name}</TableCell>
                  <TableCell className="text-sm">{d.client_name}</TableCell>
                  <TableCell className="capitalize text-xs">{d.device_type}</TableCell>
                  <TableCell className="text-xs">{d.last_backup ? new Date(d.last_backup).toLocaleString() : "Never"}</TableCell>
                  <TableCell>{d.rpo_hours ? `${d.rpo_hours}h` : "-"}</TableCell>
                  <TableCell>{d.rto_hours ? `${d.rto_hours}h` : "-"}</TableCell>
                  <TableCell>{d.size_gb ? `${d.size_gb}GB` : "-"}</TableCell>
                  <TableCell><Badge variant={complianceColors[d.compliance]} className="capitalize text-xs">{d.compliance?.replace("_", " ")}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
