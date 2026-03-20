import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Lock, ShieldCheck, AlertTriangle, Users } from "lucide-react";
import { toast } from "sonner";

export default function MfaManagementPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [byClient, setByClient] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [oRes, cRes] = await Promise.all([
          axios.get(`${API}/mfa-management/overview`, { headers }),
          axios.get(`${API}/mfa-management/by-client`, { headers }),
        ]);
        setData(oRes.data);
        setByClient(cRes.data);
      } catch (e) { toast.error("Failed to load MFA data"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  const handleEnforce = async (clientId) => {
    try {
      await axios.post(`${API}/mfa-management/enforce/${clientId}`, {}, { headers });
      toast.success("MFA enforcement policy set (14 day deadline)");
    } catch (e) { toast.error("Failed to set enforcement"); }
  };

  if (loading || !data) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const { summary, users } = data;

  return (
    <div className="space-y-6" data-testid="mfa-management-page">
      <div><h1 className="text-2xl font-bold tracking-tight">MFA Management</h1><p className="text-muted-foreground text-sm mt-1">Track and enforce MFA across all client tenants</p></div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5"><p className="text-3xl font-bold">{summary.enrollment_pct}%</p><p className="text-xs text-muted-foreground">Overall Enrollment</p><Progress value={summary.enrollment_pct} className="mt-2" /></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Users className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{summary.total_users}</p><p className="text-xs text-muted-foreground">Total Users</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><ShieldCheck className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{summary.mfa_enrolled}</p><p className="text-xs text-muted-foreground">MFA Enrolled</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><AlertTriangle className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{summary.not_enrolled}</p><p className="text-xs text-muted-foreground">Not Enrolled</p></div></CardContent></Card>
      </div>

      {/* By Client */}
      <Card><CardHeader><CardTitle className="text-lg">MFA by Client</CardTitle></CardHeader>
        <CardContent><div className="space-y-3">
          {byClient.map(c => (
            <div key={c.client_id} className="flex items-center gap-4 p-3 rounded-lg border" data-testid={`mfa-client-${c.client_id}`}>
              <div className="flex-1"><p className="font-medium text-sm">{c.client_name}</p><p className="text-xs text-muted-foreground">{c.total_users} users</p></div>
              <div className="flex items-center gap-3 text-sm"><span className="text-emerald-500">{c.enrolled} enrolled</span><span className="text-red-500">{c.not_enrolled} missing</span></div>
              <div className="w-28"><Progress value={c.enrollment_pct} className={c.enrollment_pct < 70 ? "[&>div]:bg-red-500" : c.enrollment_pct < 90 ? "[&>div]:bg-amber-500" : ""} /><p className="text-[10px] text-right text-muted-foreground">{c.enrollment_pct}%</p></div>
              {c.enrollment_pct < 100 && <Button variant="outline" size="sm" onClick={() => handleEnforce(c.client_id)} data-testid={`enforce-mfa-${c.client_id}`}><Lock className="w-3 h-3 mr-1" />Enforce</Button>}
            </div>
          ))}
        </div></CardContent>
      </Card>

      {/* Users without MFA */}
      <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" />Users Without MFA</CardTitle></CardHeader>
        <CardContent><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-3 font-medium">Email</th><th className="pb-3 font-medium">Client</th><th className="pb-3 font-medium">Provider</th><th className="pb-3 font-medium">Last Login</th></tr></thead>
          <tbody>{users.filter(u => !u.mfa_enabled).slice(0, 20).map(u => (
            <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-2">{u.email}</td>
              <td className="py-2 text-muted-foreground">{u.client_name}</td>
              <td className="py-2"><Badge variant="outline">{u.provider}</Badge></td>
              <td className="py-2 text-xs text-muted-foreground">{new Date(u.last_login).toLocaleDateString()}</td>
            </tr>
          ))}</tbody>
        </table></div></CardContent>
      </Card>
    </div>
  );
}
