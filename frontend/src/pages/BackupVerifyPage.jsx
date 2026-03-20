import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HardDrive, CheckCircle, XCircle, Clock, Play } from "lucide-react";

export default function BackupVerifyPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/backup-verify/overview`, { headers }).then(r => setData(r.data)); }, []);

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="backup-verify-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Backup Verification</h1><p className="text-muted-foreground text-sm">Automated restore testing - prove your backups actually work</p></div>
        <Button><Play className="w-4 h-4 mr-1" />Run Test</Button>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Total Tests</div><div className="text-3xl font-bold mt-1">{s.total_tests}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Pass Rate</div><div className="text-3xl font-bold text-green-500 mt-1">{s.pass_rate_pct}%</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Failed</div><div className="text-3xl font-bold text-red-500 mt-1">{s.failed}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Avg Restore Time</div><div className="text-3xl font-bold mt-1">{s.avg_restore_time_min}m</div></CardContent></Card>
      </div>
      <div className="space-y-2">
        {data.tests.map(t => (
          <Card key={t.id}><CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-4">
              {t.result === "pass" ? <CheckCircle className="w-5 h-5 text-green-500" /> : <XCircle className="w-5 h-5 text-red-500" />}
              <div className="flex-1">
                <div className="flex items-center gap-2"><span className="font-medium text-sm">{t.client_name}</span><Badge variant="outline" className="text-xs">{t.backup_type}</Badge><Badge variant="secondary" className="text-xs">{t.backup_solution}</Badge></div>
                <div className="text-xs text-muted-foreground">Restore: {t.restore_time_minutes}min | Integrity: {t.data_integrity_check} {t.notes && `| ${t.notes}`}</div>
              </div>
              <Badge variant={t.result === "pass" ? "default" : "destructive"}>{t.result}</Badge>
              <span className="text-xs text-muted-foreground">{new Date(t.tested_at).toLocaleDateString()}</span>
            </div>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
