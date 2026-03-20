import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Workflow, Play, CheckCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function RemediationPlaybooksPage() {
  const { token } = useAuth();
  const [playbooks, setPlaybooks] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [pRes, eRes] = await Promise.all([
          axios.get(`${API}/remediation-playbooks/list`, { headers }),
          axios.get(`${API}/remediation-playbooks/executions`, { headers }),
        ]);
        setPlaybooks(pRes.data);
        setExecutions(eRes.data);
      } catch (e) { toast.error("Failed to load"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const severityColor = { critical: "destructive", high: "warning", medium: "secondary" };

  return (
    <div className="space-y-6" data-testid="remediation-playbooks-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Automated Remediation Playbooks</h1><p className="text-muted-foreground text-sm mt-1">Threat detected → auto-respond → auto-document</p></div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><Workflow className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{playbooks.length}</p><p className="text-xs text-muted-foreground">Playbooks</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Play className="w-6 h-6 text-blue-500" /><div><p className="text-2xl font-bold">{playbooks.reduce((a, p) => a + (p.executions || 0), 0)}</p><p className="text-xs text-muted-foreground">Total Executions</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><CheckCircle className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{playbooks.filter(p => p.enabled).length}</p><p className="text-xs text-muted-foreground">Active</p></div></CardContent></Card>
      </div>

      {playbooks.map(pb => (
        <Card key={pb.id} data-testid={`playbook-${pb.id}`}>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2"><h3 className="font-semibold">{pb.name}</h3><Badge variant={severityColor[pb.severity]}>{pb.severity}</Badge><Badge variant={pb.enabled ? "default" : "secondary"}>{pb.enabled ? "Active" : "Disabled"}</Badge></div>
                <p className="text-sm text-muted-foreground mt-1">{pb.description}</p>
                <p className="text-xs text-muted-foreground mt-1">Trigger: <code className="bg-muted px-1 rounded">{pb.trigger}</code> | Executed: {pb.executions}x</p>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              {(pb.steps || []).map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-sm"><span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">{step.order}</span><span>{step.description}</span></div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
