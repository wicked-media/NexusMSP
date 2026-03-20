import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Terminal, Zap, Play, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function ScriptTicketPage() {
  const { token } = useAuth();
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/script-ticket/scripts`, { headers }); setScripts(res.data); } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="script-ticket-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Script-to-Ticket Integration</h1><p className="text-muted-foreground text-sm mt-1">Auto-create, close, and update tickets from scripts</p></div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><Terminal className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{scripts.length}</p><p className="text-xs text-muted-foreground">Script Integrations</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Play className="w-6 h-6 text-blue-500" /><div><p className="text-2xl font-bold">{scripts.reduce((a, s) => a + (s.executions || 0), 0)}</p><p className="text-xs text-muted-foreground">Total Executions</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><CheckCircle className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{scripts.filter(s => s.enabled).length}</p><p className="text-xs text-muted-foreground">Active</p></div></CardContent></Card>
      </div>

      {scripts.map(s => (
        <Card key={s.id} data-testid={`script-${s.id}`}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2"><h3 className="font-semibold">{s.name}</h3><Badge variant={s.enabled ? "default" : "secondary"}>{s.enabled ? "Active" : "Disabled"}</Badge>{s.ticket_priority && <Badge variant="outline">{s.ticket_priority}</Badge>}</div>
            <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground"><span>Trigger: <code className="bg-muted px-1 rounded">{s.trigger}</code></span><span>Action: {s.action}</span><span>Executions: {s.executions}</span></div>
            {s.script_content && <pre className="mt-3 p-3 bg-muted rounded-lg text-xs overflow-x-auto font-mono">{s.script_content}</pre>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
