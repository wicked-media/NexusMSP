import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Shield, ShieldCheck, ShieldX, CheckCircle, XCircle, AlertTriangle,
  Loader2, Lock, FileText, Users, BarChart3, Eye, RefreshCw, Download
} from "lucide-react";

const FW_COLORS = { "NIST 800-171": "from-blue-500 to-indigo-600", "CIS Controls v8": "from-emerald-500 to-teal-600", "SOC 2 Type II": "from-purple-500 to-violet-600", "HIPAA": "from-rose-500 to-pink-600" };
const FW_ICONS = { "NIST 800-171": Lock, "CIS Controls v8": Shield, "SOC 2 Type II": FileText, "HIPAA": Users };

export default function ComplianceCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("frameworks");
  const [fwData, setFwData] = useState(null);
  const [expandedFw, setExpandedFw] = useState(null);
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [framework, setFramework] = useState("cis");
  const [frameworks, setFrameworks] = useState([]);
  const [scanReports, setScanReports] = useState([]);
  const [currentScan, setCurrentScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [genFrameworks, setGenFrameworks] = useState([]);
  const [genReports, setGenReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [fw, cl, frs, rp, gf, gr] = await Promise.allSettled([
        axios.get(`${API}/compliance-frameworks/overview`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/compliance/frameworks`, { headers }),
        axios.get(`${API}/compliance/reports`, { headers }),
        axios.get(`${API}/compliance-generator/frameworks`, { headers }),
        axios.get(`${API}/compliance-generator/reports`, { headers }),
      ]);
      if (fw.status === "fulfilled") setFwData(fw.value.data);
      if (cl.status === "fulfilled") setClients(cl.value.data);
      if (frs.status === "fulfilled") setFrameworks(frs.value.data);
      if (rp.status === "fulfilled") setScanReports(rp.value.data);
      if (gf.status === "fulfilled") setGenFrameworks(gf.value.data);
      if (gr.status === "fulfilled") setGenReports(gr.value.data);
    } catch { toast.error("Failed to load compliance data"); }
    finally { setLoading(false); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  const runScan = async () => {
    if (!selectedClient) { toast.error("Select a client first"); return; }
    setScanning(true);
    try {
      const { data } = await axios.get(`${API}/compliance/scan/${selectedClient}?framework=${framework}`, { headers });
      setCurrentScan(data);
      setScanReports(prev => [data, ...prev]);
      toast.success(`Compliance scan complete: ${data.score}%`);
    } catch { toast.error("Scan failed"); }
    setScanning(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const fs = fwData?.summary || {};
  const scoreColor = (s) => s >= 85 ? "text-emerald-500" : s >= 70 ? "text-amber-500" : "text-red-500";

  return (
    <div className="space-y-5" data-testid="compliance-center-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-purple-500 to-violet-700 flex items-center justify-center"><Shield className="w-5 h-5 text-white" /></div>
            Compliance Center
          </h1>
          <p className="text-muted-foreground mt-1">Framework tracking, automated scanning, and report generation</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="frameworks" data-testid="tab-frameworks">Frameworks</TabsTrigger>
          <TabsTrigger value="scanner" data-testid="tab-scanner">Scanner</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-reports">Reports</TabsTrigger>
        </TabsList>

        {/* FRAMEWORKS */}
        <TabsContent value="frameworks" className="mt-4 space-y-4">
          {!fwData ? <p className="text-muted-foreground text-center py-12">No framework data</p> : <>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Frameworks", value: fs.total_frameworks || 0, icon: Shield, color: "text-blue-400" },
                { label: "Total Controls", value: fs.total_controls || 0, icon: CheckCircle, color: "text-emerald-400" },
                { label: "Controls Met", value: fs.controls_met || 0, icon: ShieldCheck, color: "text-green-400" },
                { label: "Gap Controls", value: (fs.total_controls || 0) - (fs.controls_met || 0), icon: AlertTriangle, color: "text-red-400" },
              ].map(st => (
                <Card key={st.label}><CardContent className="pt-4 pb-3"><div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div><p className={`text-2xl font-bold ${st.color}`}>{st.value}</p></CardContent></Card>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {(fwData.frameworks || []).map(fw => {
                const FwIcon = FW_ICONS[fw.name] || Shield;
                const gradient = FW_COLORS[fw.name] || "from-gray-500 to-gray-700";
                return (
                  <Card key={fw.name} className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onClick={() => setExpandedFw(expandedFw === fw.name ? null : fw.name)}>
                    <div className={`h-2 bg-gradient-to-r ${gradient}`} />
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-3 mb-3"><FwIcon className="w-6 h-6 text-muted-foreground" /><div className="flex-1"><p className="font-semibold">{fw.name}</p><p className="text-xs text-muted-foreground">{fw.met}/{fw.total} controls met</p></div><span className={`text-2xl font-black ${fw.compliance_pct >= 80 ? "text-emerald-400" : fw.compliance_pct >= 60 ? "text-amber-400" : "text-red-400"}`}>{fw.compliance_pct}%</span></div>
                      <Progress value={fw.compliance_pct} className="h-2" />
                      {expandedFw === fw.name && fw.categories && (
                        <div className="mt-4 space-y-2 border-t pt-3">
                          {fw.categories.map((cat, i) => (
                            <div key={`k-${i}`} className="flex items-center justify-between p-2 rounded bg-muted/20">
                              <div className="flex items-center gap-2"><Checkbox checked={cat.met === cat.total} /><span className="text-sm">{cat.name}</span></div>
                              <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{cat.met}/{cat.total}</span><Progress value={(cat.met / cat.total) * 100} className="w-16 h-1.5" /></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>}
        </TabsContent>

        {/* SCANNER */}
        <TabsContent value="scanner" className="mt-4 space-y-4">
          <Card><CardContent className="pt-4">
            <div className="flex gap-3 items-center">
              <Select value={selectedClient} onValueChange={setSelectedClient}><SelectTrigger className="w-[220px]"><SelectValue placeholder="Select client..." /></SelectTrigger><SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
              <Select value={framework} onValueChange={setFramework}><SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger><SelectContent>{frameworks.map(f => <SelectItem key={f.id} value={f.id}>{f.name} ({f.controls} controls)</SelectItem>)}</SelectContent></Select>
              <Button onClick={runScan} disabled={scanning}><RefreshCw className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`} />{scanning ? "Scanning..." : "Run Scan"}</Button>
            </div>
          </CardContent></Card>

          {currentScan && (
            <Card className="border-2" style={{ borderColor: currentScan.score >= 80 ? "#22c55e" : currentScan.score >= 50 ? "#f59e0b" : "#ef4444" }}>
              <CardHeader><div className="flex items-center justify-between"><CardTitle className="text-base flex items-center gap-2">{currentScan.score >= 80 ? <ShieldCheck className="w-5 h-5 text-green-500" /> : <ShieldX className="w-5 h-5 text-red-500" />}{currentScan.framework_name} - {currentScan.client_name}</CardTitle><Badge variant={currentScan.score >= 80 ? "default" : "destructive"}>{currentScan.score}%</Badge></div></CardHeader>
              <CardContent className="space-y-4">
                <Progress value={currentScan.score} className="h-3" />
                <p className="text-sm text-muted-foreground">{currentScan.passed}/{currentScan.total} controls passed</p>
                <Table><TableHeader><TableRow><TableHead>Control ID</TableHead><TableHead>Control</TableHead><TableHead>Description</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>{(currentScan.controls || []).map((ctrl, i) => (
                    <TableRow key={`k-${i}`}><TableCell className="font-mono text-xs">{ctrl.id}</TableCell><TableCell className="font-medium text-sm">{ctrl.name}</TableCell><TableCell className="text-xs text-muted-foreground">{ctrl.description}</TableCell><TableCell><Badge variant={ctrl.status === "pass" ? "default" : "destructive"} className="text-xs">{ctrl.status === "pass" ? "PASS" : "FAIL"}</Badge></TableCell></TableRow>
                  ))}</TableBody></Table>
              </CardContent>
            </Card>
          )}

          {scanReports.length > 0 && (
            <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" />Previous Scans</CardTitle></CardHeader>
              <CardContent><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Framework</TableHead><TableHead>Score</TableHead><TableHead>Passed</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                <TableBody>{scanReports.map(r => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setCurrentScan(r)}><TableCell className="font-medium">{r.client_name}</TableCell><TableCell><Badge variant="outline">{r.framework_name}</Badge></TableCell><TableCell><span className={`font-bold ${r.score >= 80 ? "text-green-500" : r.score >= 50 ? "text-amber-500" : "text-red-500"}`}>{r.score}%</span></TableCell><TableCell>{r.passed}/{r.total}</TableCell><TableCell className="text-xs">{new Date(r.scanned_at).toLocaleString()}</TableCell></TableRow>
                ))}</TableBody></Table></CardContent></Card>
          )}
        </TabsContent>

        {/* REPORTS */}
        <TabsContent value="reports" className="mt-4 space-y-4">
          {genFrameworks.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {genFrameworks.map(f => (
                <Card key={f.id} className="hover:border-primary/50 transition-colors cursor-pointer"><CardContent className="pt-5 text-center"><Shield className="w-8 h-8 text-primary mx-auto" /><h3 className="font-bold mt-2">{f.name}</h3><p className="text-xs text-muted-foreground mt-1">{f.controls} controls</p></CardContent></Card>
              ))}
            </div>
          )}

          <Card><CardHeader><CardTitle className="text-lg">Generated Reports</CardTitle></CardHeader>
            <CardContent><div className="space-y-3">{genReports.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No compliance reports generated yet</p>
            ) : genReports.map(r => (
              <div key={r.id} className="flex items-center justify-between p-4 rounded-lg border">
                <div className="flex items-center gap-4">
                  <div className="text-center"><p className={`text-2xl font-bold ${scoreColor(r.score)}`}>{r.score}</p><p className="text-[10px] text-muted-foreground">Score</p></div>
                  <div><p className="font-medium">{r.client_name}</p><p className="text-xs text-muted-foreground">{r.framework} | {r.controls_passed}/{r.controls_total} controls</p><p className="text-xs text-muted-foreground">{new Date(r.generated_at).toLocaleDateString()} by {r.generated_by}</p></div>
                </div>
                <div className="flex items-center gap-2"><Progress value={r.score} className="w-24" /><Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge></div>
              </div>
            ))}</div></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
