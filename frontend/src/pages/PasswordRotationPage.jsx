import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

export default function PasswordRotationPage() {
  const { token } = useAuth();
  const [policies, setPolicies] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [pRes, hRes] = await Promise.all([
          axios.get(`${API}/password-rotation/policies`, { headers }),
          axios.get(`${API}/password-rotation/history`, { headers }),
        ]);
        setPolicies(pRes.data);
        setHistory(hRes.data);
      } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="password-rotation-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Password Rotation Policies</h1><p className="text-muted-foreground text-sm mt-1">Auto-rotate vault passwords on schedule with audit trail</p></div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><Lock className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{policies.length}</p><p className="text-xs text-muted-foreground">Active Policies</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><RefreshCw className="w-6 h-6 text-blue-500" /><div><p className="text-2xl font-bold">{policies.reduce((a, p) => a + (p.rotations_completed || 0), 0)}</p><p className="text-xs text-muted-foreground">Rotations Completed</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><XCircle className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{history.filter(h => h.status === "failed").length}</p><p className="text-xs text-muted-foreground">Failed Rotations</p></div></CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="text-lg">Rotation Policies</CardTitle></CardHeader>
        <CardContent><div className="space-y-3">{policies.map(p => (
          <div key={p.id} className="p-4 rounded-lg border" data-testid={`policy-${p.id}`}>
            <div className="flex items-center justify-between">
              <div><h3 className="font-semibold text-sm">{p.name}</h3><p className="text-xs text-muted-foreground">{p.description}</p></div>
              <Badge variant={p.enabled ? "default" : "secondary"}>{p.enabled ? "Active" : "Disabled"}</Badge>
            </div>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
              <span>Every {p.rotation_days} days</span><span>Length: {p.password_length} chars</span><span>Rotations: {p.rotations_completed}</span><span>Next: {p.next_rotation}</span>
            </div>
          </div>
        ))}</div></CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="text-lg">Rotation History</CardTitle></CardHeader>
        <CardContent><div className="space-y-2">{history.map(h => (
          <div key={h.id} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`rotation-${h.id}`}>
            <div className="flex items-center gap-3">
              {h.status === "success" ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
              <div><p className="text-sm font-medium">{h.credential_name}</p><p className="text-xs text-muted-foreground">{h.client_name} | {h.rotated_by}</p></div>
            </div>
            <div className="text-right"><Badge variant={h.status === "success" ? "default" : "destructive"}>{h.status}</Badge>{h.error && <p className="text-xs text-red-400 mt-1">{h.error}</p>}<p className="text-xs text-muted-foreground mt-1">{new Date(h.rotated_at).toLocaleString()}</p></div>
          </div>
        ))}</div></CardContent>
      </Card>
    </div>
  );
}
