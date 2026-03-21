import { useState, useEffect } from "react";
import { useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Shield, ShieldAlert, FileWarning, FolderOpen, AlertTriangle, CheckCircle, Clock, RefreshCw, HardDrive, Zap } from "lucide-react";

const CANARY_FILES = [
  { path: "C:\\Users\\Shared\\Documents\\canary_doc.xlsx", host: "WS-ACME-101", status: "healthy", last_checked: "2 min ago" },
  { path: "C:\\Users\\Public\\canary_report.pdf", host: "SRV-TECH-201", status: "healthy", last_checked: "5 min ago" },
  { path: "/home/shared/canary_data.csv", host: "SRV-CLOUD-301", status: "healthy", last_checked: "1 min ago" },
  { path: "C:\\Temp\\canary_image.jpg", host: "PC-SUMMIT-401", status: "healthy", last_checked: "8 min ago" },
  { path: "D:\\Backups\\canary_backup.zip", host: "DC-LEGAL-501", status: "triggered", last_checked: "15 sec ago" },
  { path: "C:\\Users\\Admin\\Desktop\\canary_notes.txt", host: "LT-APEX-601", status: "healthy", last_checked: "3 min ago" },
];

export default function RansomwareCanaryPage() {
  const { token } = useAuth();
  const [canaries, setCanaries] = useState(CANARY_FILES);
  const triggered = canaries.filter(c => c.status === "triggered").length;
  const healthy = canaries.filter(c => c.status === "healthy").length;

  return (
    <div className="space-y-6" data-testid="ransomware-canary">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Ransomware Canary</h1><p className="text-muted-foreground">{canaries.length} canary files deployed across endpoints</p></div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-amber-400 border-amber-500/30">Demo Data</Badge>
          <Button variant="outline" onClick={() => toast.success("Canary check complete")}><RefreshCw className="w-4 h-4 mr-1" />Check Now</Button>
        </div>
      </div>

      {triggered > 0 && (
        <Card className="border-red-500/30 bg-red-500/5 animate-pulse" data-testid="canary-alert">
          <CardContent className="py-4 px-5 flex items-center gap-4">
            <ShieldAlert className="w-10 h-10 text-red-400" />
            <div>
              <p className="text-lg font-bold text-red-400">RANSOMWARE ACTIVITY DETECTED</p>
              <p className="text-sm text-muted-foreground">{triggered} canary file(s) modified - potential encryption in progress</p>
            </div>
            <Button className="ml-auto bg-red-600 hover:bg-red-700" data-testid="emergency-isolate">
              <Zap className="w-4 h-4 mr-1" />Emergency Isolate All
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Total Canaries</p><p className="text-2xl font-bold">{canaries.length}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Healthy</p><p className="text-2xl font-bold text-green-400">{healthy}</p></CardContent></Card>
        <Card className={triggered > 0 ? "border-red-500/30" : ""}><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Triggered</p><p className={`text-2xl font-bold ${triggered > 0 ? "text-red-400 animate-pulse" : "text-green-400"}`}>{triggered}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Endpoints</p><p className="text-2xl font-bold">{new Set(canaries.map(c => c.host)).size}</p></CardContent></Card>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Canary File</TableHead><TableHead>Host</TableHead><TableHead>Status</TableHead><TableHead>Last Checked</TableHead></TableRow></TableHeader>
          <TableBody>
            {canaries.map((c, i) => (
              <TableRow key={i} className={c.status === "triggered" ? "bg-red-500/5" : ""} data-testid={`canary-${i}`}>
                <TableCell className="font-mono text-xs">{c.path}</TableCell>
                <TableCell className="text-sm font-mono">{c.host}</TableCell>
                <TableCell>
                  {c.status === "healthy" ? (
                    <Badge className="bg-green-500/20 text-green-400 text-[10px]"><CheckCircle className="w-3 h-3 mr-1" />Healthy</Badge>
                  ) : (
                    <Badge className="bg-red-500/20 text-red-400 text-[10px] animate-pulse"><AlertTriangle className="w-3 h-3 mr-1" />TRIGGERED</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.last_checked}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" />How Canary Files Work</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Canary files are strategically placed decoy files across your network. If ransomware begins encrypting files, it will modify these canaries first, triggering an immediate alert.</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>Files are placed in common directories targeted by ransomware</li>
            <li>Any modification triggers an instant alert and optional auto-isolation</li>
            <li>Zero performance impact - files are tiny and monitored via filesystem events</li>
            <li>Covers common file types: .xlsx, .pdf, .csv, .jpg, .zip, .txt</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
