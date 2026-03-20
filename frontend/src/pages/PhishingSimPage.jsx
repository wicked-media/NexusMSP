import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Mail, MousePointer, Flag, Send } from "lucide-react";

export default function PhishingSimPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/phishing-sim/campaigns`, { headers }).then(r => setData(r.data)); }, []);

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="phishing-sim-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Phishing Simulation</h1><p className="text-muted-foreground text-sm">Test employee security awareness with simulated phishing campaigns</p></div>
        <Button><Send className="w-4 h-4 mr-1" />New Campaign</Button>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Campaigns</div><div className="text-3xl font-bold mt-1">{s.total_campaigns}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Emails Sent</div><div className="text-3xl font-bold mt-1">{s.total_emails_sent}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Avg Click Rate</div><div className="text-3xl font-bold text-red-500 mt-1">{s.avg_click_rate}%</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Avg Report Rate</div><div className="text-3xl font-bold text-green-500 mt-1">{s.avg_report_rate}%</div></CardContent></Card>
      </div>
      <div className="space-y-3">
        {data.campaigns.map(c => (
          <Card key={c.id}><CardContent className="pt-4">
            <div className="flex items-center gap-4">
              <Mail className="w-8 h-8 text-muted-foreground" />
              <div className="flex-1">
                <div className="flex items-center gap-2"><span className="font-semibold">{c.name}</span><Badge variant="outline" className="text-xs">{c.template_type.replace("_", " ")}</Badge><Badge>{c.status}</Badge></div>
                <div className="text-sm text-muted-foreground">{c.client_name} | {c.emails_sent} emails | Sent: {new Date(c.sent_at).toLocaleDateString()}</div>
                <div className="grid grid-cols-4 gap-4 mt-2 text-sm">
                  <div><span className="text-muted-foreground">Opened:</span> <span className="font-medium">{c.opened_pct}%</span></div>
                  <div><span className="text-muted-foreground">Clicked:</span> <span className="font-medium text-red-500">{c.click_rate_pct}%</span></div>
                  <div><span className="text-muted-foreground">Credentials:</span> <span className="font-medium text-red-500">{c.submitted_credentials_pct}%</span></div>
                  <div><span className="text-muted-foreground">Reported:</span> <span className="font-medium text-green-500">{c.report_rate_pct}%</span></div>
                </div>
              </div>
            </div>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
