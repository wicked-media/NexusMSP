import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Mail, Users, Target, AlertTriangle, CheckCircle, Clock, BarChart3, Eye, MousePointer, Flag, RefreshCw } from "lucide-react";

export default function PhishingSimPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await axios.get(`${API}/soc/phishing`, { headers }); setData(res.data); }
    catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="phishing-sim">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Phishing Simulation</h1><p className="text-muted-foreground">Security awareness training campaigns</p></div>
        <div className="flex gap-2">
          {data.mock_data && <Badge variant="outline" className="text-amber-400 border-amber-500/30">Demo Data</Badge>}
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="border-red-500/20"><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-2"><MousePointer className="w-5 h-5 text-red-400" /><span className="text-xs text-muted-foreground">Overall Click Rate</span></div>
          <p className="text-3xl font-bold text-red-400">{data.overall_click_rate}%</p>
          <p className="text-xs text-muted-foreground mt-1">{data.overall_click_rate < 5 ? "Excellent - Below industry average" : data.overall_click_rate < 15 ? "Good - Near industry average" : "Needs improvement"}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-2"><Mail className="w-5 h-5 text-blue-400" /><span className="text-xs text-muted-foreground">Total Campaigns</span></div>
          <p className="text-3xl font-bold">{(data.campaigns || []).length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-2"><Flag className="w-5 h-5 text-green-400" /><span className="text-xs text-muted-foreground">Active Campaigns</span></div>
          <p className="text-3xl font-bold text-green-400">{(data.campaigns || []).filter(c => c.status === "active").length}</p>
        </CardContent></Card>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Template</TableHead><TableHead>Org</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Sent</TableHead><TableHead className="text-right">Opened</TableHead><TableHead className="text-right">Clicked</TableHead><TableHead className="text-right">Reported</TableHead><TableHead>Click Rate</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data.campaigns || []).map(c => (
              <TableRow key={c.id} data-testid={`phish-${c.id}`}>
                <TableCell className="font-medium text-sm">{c.name}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{c.template}</Badge></TableCell>
                <TableCell className="text-xs">{c.organization}</TableCell>
                <TableCell><Badge className={`text-[10px] ${c.status === "active" ? "bg-green-500/20 text-green-400" : c.status === "completed" ? "bg-blue-500/20 text-blue-400" : "bg-gray-500/20 text-gray-400"}`}>{c.status}</Badge></TableCell>
                <TableCell className="text-right font-mono">{c.sent}</TableCell>
                <TableCell className="text-right font-mono text-amber-400">{c.opened}</TableCell>
                <TableCell className="text-right font-mono text-red-400">{c.clicked}</TableCell>
                <TableCell className="text-right font-mono text-green-400">{c.reported}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={c.click_rate} className="h-1.5 w-16" />
                    <span className={`text-xs font-mono ${c.click_rate > 15 ? "text-red-400" : c.click_rate > 5 ? "text-amber-400" : "text-green-400"}`}>{c.click_rate}%</span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
