import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Webhook, Plus, Play, Pause } from "lucide-react";

export default function WebhookBuilderPage() {
  const { token } = useAuth();
  const [hooks, setHooks] = useState([]);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/webhook-builder/list`, { headers }).then(r => setHooks(r.data)); }, []);

  return (
    <div className="space-y-6" data-testid="webhook-builder-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Webhook Builder</h1><p className="text-muted-foreground text-sm">Create custom webhook integrations without code</p></div>
        <Button><Plus className="w-4 h-4 mr-1" />New Webhook</Button>
      </div>
      {hooks.map(h => (
        <Card key={h.id}><CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <Webhook className="w-8 h-8 text-blue-500" />
            <div className="flex-1">
              <div className="flex items-center gap-2"><span className="font-semibold">{h.name}</span>{h.status === "active" ? <Badge className="text-xs">Active</Badge> : <Badge variant="secondary" className="text-xs">Paused</Badge>}</div>
              <code className="text-xs text-muted-foreground block mt-1">Trigger: {h.trigger}</code>
              <div className="text-xs text-muted-foreground mt-1">{h.method} {h.url.substring(0, 50)}...</div>
            </div>
            <div className="text-right"><div className="text-lg font-bold">{h.trigger_count}</div><div className="text-xs text-muted-foreground">triggers</div></div>
          </div>
          <div className="mt-2 p-2 rounded bg-muted/50"><code className="text-xs break-all">{h.payload_template}</code></div>
        </CardContent></Card>
      ))}
    </div>
  );
}
