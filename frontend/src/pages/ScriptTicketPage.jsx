import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Terminal, Play, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";

export default function ScriptTicketPage() {
  const { token } = useAuth();
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/script-ticket/scripts`, { headers: { Authorization: `Bearer ${token}` } }); setScripts(res.data); } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, [token]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="script-ticket-page">
      <OperationalPageHeader eyebrow="Automation controls" title="Script-to-Ticket Integration" description="Create, update, and resolve tickets from managed scripts with a clear execution record." icon={Terminal} tone="violet" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <HeroTile label="Script integrations" value={scripts.length} icon={Terminal} glow="violet" subtitle="Ticket-aware automations" testId="script-ticket-integrations" />
        <HeroTile label="Total executions" value={scripts.reduce((a, s) => a + (s.executions || 0), 0)} icon={Play} glow="sky" subtitle="Recorded script runs" testId="script-ticket-executions" />
        <HeroTile label="Active" value={scripts.filter(s => s.enabled).length} icon={CheckCircle} glow="emerald" subtitle="Enabled integrations" testId="script-ticket-active" />
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
