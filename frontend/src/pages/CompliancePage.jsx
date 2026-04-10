import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, ShieldCheck, ShieldX, AlertTriangle, FileText, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function CompliancePage() {
  const { token } = useAuth();
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [framework, setFramework] = useState("cis");
  const [frameworks, setFrameworks] = useState([]);
  const [reports, setReports] = useState([]);
  const [currentScan, setCurrentScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/clients`, { headers }),
      axios.get(`${API}/compliance/frameworks`, { headers }),
      axios.get(`${API}/compliance/reports`, { headers }),
    ]).then(([c, f, r]) => {
      setClients(c.data);
      setFrameworks(f.data);
      setReports(r.data);
    }).catch(() => {});
  }, []);

  const runScan = async () => {
    if (!selectedClient) { toast.error("Select a client first"); return; }
    setScanning(true);
    try {
      const { data } = await axios.get(`${API}/compliance/scan/${selectedClient}?framework=${framework}`, { headers });
      setCurrentScan(data);
      setReports(prev => [data, ...prev]);
      toast.success(`Compliance scan complete: ${data.score}%`);
    } catch { toast.error("Scan failed"); }
    setScanning(false);
  };

  return (
    <div className="space-y-6" data-testid="compliance-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Compliance Reporting</h1>
          <p className="text-muted-foreground text-sm mt-1">Automated SOC2, HIPAA & CIS compliance scanning</p>
        </div>
        <div className="flex gap-3 items-center">
          <Select value={selectedClient} onValueChange={setSelectedClient}>
            <SelectTrigger className="w-[220px]" data-testid="compliance-client-select">
              <SelectValue placeholder="Select client..." />
            </SelectTrigger>
            <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={framework} onValueChange={setFramework}>
            <SelectTrigger className="w-[180px]" data-testid="compliance-framework-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{frameworks.map(f => <SelectItem key={f.id} value={f.id}>{f.name} ({f.controls} controls)</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={runScan} disabled={scanning} data-testid="run-compliance-scan">
            <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scanning..." : "Run Scan"}
          </Button>
        </div>
      </div>

      {currentScan && (
        <Card className="border-2" style={{ borderColor: currentScan.score >= 80 ? "#22c55e" : currentScan.score >= 50 ? "#f59e0b" : "#ef4444" }}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {currentScan.score >= 80 ? <ShieldCheck className="w-5 h-5 text-green-500" /> : <ShieldX className="w-5 h-5 text-red-500" />}
                {currentScan.framework_name} - {currentScan.client_name}
              </CardTitle>
              <Badge variant={currentScan.score >= 80 ? "default" : "destructive"} data-testid="compliance-score">{currentScan.score}%</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={currentScan.score} className="h-3" />
            <p className="text-sm text-muted-foreground">{currentScan.passed}/{currentScan.total} controls passed</p>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Control ID</TableHead><TableHead>Control</TableHead><TableHead>Description</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {currentScan.controls.map((ctrl, i) => (
                  <TableRow key={`k-${i}`} data-testid={`compliance-control-${ctrl.id}`}>
                    <TableCell className="font-mono text-xs">{ctrl.id}</TableCell>
                    <TableCell className="font-medium text-sm">{ctrl.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{ctrl.description}</TableCell>
                    <TableCell>
                      <Badge variant={ctrl.status === "pass" ? "default" : "destructive"} className="text-xs">
                        {ctrl.status === "pass" ? "PASS" : "FAIL"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" />Previous Reports</CardTitle></CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No compliance reports yet. Run a scan to get started.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Client</TableHead><TableHead>Framework</TableHead><TableHead>Score</TableHead><TableHead>Passed</TableHead><TableHead>Date</TableHead><TableHead>Scanned By</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {reports.map(r => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setCurrentScan(r)} data-testid={`report-${r.id}`}>
                    <TableCell className="font-medium">{r.client_name}</TableCell>
                    <TableCell><Badge variant="outline">{r.framework_name}</Badge></TableCell>
                    <TableCell>
                      <span className={`font-bold ${r.score >= 80 ? "text-green-500" : r.score >= 50 ? "text-amber-500" : "text-red-500"}`}>{r.score}%</span>
                    </TableCell>
                    <TableCell>{r.passed}/{r.total}</TableCell>
                    <TableCell className="text-xs">{new Date(r.scanned_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{r.scanned_by}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
