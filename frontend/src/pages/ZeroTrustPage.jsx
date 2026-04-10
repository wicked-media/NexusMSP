import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Lock, Unlock, Eye } from "lucide-react";

export default function ZeroTrustPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/zero-trust/overview`, { headers }).then(r => setData(r.data)); }, [token]);

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="zero-trust-page">
      <div><h1 className="text-2xl font-bold">Zero Trust Policy Manager</h1><p className="text-muted-foreground text-sm">Define and enforce conditional access policies per client</p></div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Active Policies</div><div className="text-3xl font-bold mt-1">{s.active}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Blocked Today</div><div className="text-3xl font-bold text-red-500 mt-1">{s.blocked_today}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Allowed Today</div><div className="text-3xl font-bold text-green-500 mt-1">{s.allowed_today}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Trust Score</div><div className="text-3xl font-bold mt-1">{s.trust_score}</div></CardContent></Card>
      </div>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Policies</CardTitle></CardHeader>
        <CardContent><div className="space-y-3">
          {data.policies.map(p => (
            <div key={p.id} className="p-3 rounded-lg border">
              <div className="flex items-center justify-between"><span className="font-medium">{p.name}</span><div className="flex gap-2"><Badge variant="outline" className="text-xs">{p.type}</Badge><Badge variant={p.action === "block" ? "destructive" : "secondary"} className="text-xs">{p.action}</Badge>{p.enabled ? <Badge className="text-xs">Active</Badge> : <Badge variant="outline" className="text-xs">Disabled</Badge>}</div></div>
              <code className="text-xs text-muted-foreground block mt-1">{p.condition}</code>
              <div className="text-xs text-muted-foreground mt-1">{p.triggers_count} triggers</div>
            </div>
          ))}
        </div></CardContent>
      </Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Recent Events</CardTitle></CardHeader>
        <CardContent><div className="space-y-1">
          {data.events.map(e => (
            <div key={e.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 text-sm">
              {e.action === "blocked" ? <Lock className="w-4 h-4 text-red-500" /> : e.action === "allowed" ? <Unlock className="w-4 h-4 text-green-500" /> : <Eye className="w-4 h-4 text-yellow-500" />}
              <span className="flex-1">{e.user}</span><span className="text-muted-foreground">{e.device}</span><Badge variant={e.action === "blocked" ? "destructive" : "default"} className="text-xs">{e.action}</Badge>
              <span className="text-xs text-muted-foreground w-16">{e.policy_name}</span>
            </div>
          ))}
        </div></CardContent>
      </Card>
    </div>
  );
}
