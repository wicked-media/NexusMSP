import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Bot, CheckCircle, Clock, XCircle, Zap, ThumbsUp, ThumbsDown } from "lucide-react";

export default function AIResolutionPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/ai-resolution/suggestions`, { headers }).then(r => setData(r.data)); }, []);

  const handleAction = async (id, action) => {
    await axios.post(`${API}/ai-resolution/${id}/${action}`, {}, { headers });
    const res = await axios.get(`${API}/ai-resolution/suggestions`, { headers });
    setData(res.data);
  };

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="ai-resolution-page">
      <div><h1 className="text-2xl font-bold">AI Auto-Resolution</h1><p className="text-muted-foreground text-sm">Autonomous issue detection, matching, and resolution</p></div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Auto-Resolved</span><CheckCircle className="w-5 h-5 text-green-500" /></div><div className="text-3xl font-bold mt-1">{s.auto_resolved}</div><div className="text-xs text-muted-foreground">{s.resolution_rate_pct}% resolution rate</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Pending Approval</span><Clock className="w-5 h-5 text-yellow-500" /></div><div className="text-3xl font-bold mt-1">{s.pending_approval}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Manual Required</span><XCircle className="w-5 h-5 text-red-500" /></div><div className="text-3xl font-bold mt-1">{s.manual_required}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Time Saved</span><Zap className="w-5 h-5 text-blue-500" /></div><div className="text-3xl font-bold mt-1">{s.time_saved_hours}h</div></CardContent></Card>
      </div>
      <div className="space-y-3">
        {data.issues.map(issue => (
          <Card key={issue.id} className={issue.status === "auto_resolved" ? "border-green-500/30" : issue.status === "pending_approval" ? "border-yellow-500/30" : "border-red-500/30"}>
            <CardContent className="pt-4">
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${issue.status === "auto_resolved" ? "bg-green-500/20" : issue.status === "pending_approval" ? "bg-yellow-500/20" : "bg-red-500/20"}`}>
                  <Bot className={`w-5 h-5 ${issue.status === "auto_resolved" ? "text-green-500" : issue.status === "pending_approval" ? "text-yellow-500" : "text-red-500"}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2"><span className="font-medium">{issue.issue}</span><Badge variant="outline" className="text-xs">{issue.category}</Badge></div>
                  <div className="text-sm text-muted-foreground">{issue.device} - {issue.client}</div>
                  <div className="mt-2 p-2 rounded bg-muted/50 text-sm"><span className="text-muted-foreground">Runbook:</span> {issue.runbook} <br /><span className="text-muted-foreground">Action:</span> {issue.action}</div>
                  <div className="flex items-center gap-2 mt-2"><span className="text-xs text-muted-foreground">Confidence: {issue.confidence}%</span><Progress value={issue.confidence} className="w-20 h-1.5" /></div>
                </div>
                <div className="flex flex-col gap-2">
                  <Badge variant={issue.status === "auto_resolved" ? "default" : issue.status === "pending_approval" ? "secondary" : "destructive"}>{issue.status.replace("_", " ")}</Badge>
                  {issue.status === "pending_approval" && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="text-green-500" onClick={() => handleAction(issue.id, "approve")}><ThumbsUp className="w-3 h-3" /></Button>
                      <Button size="sm" variant="outline" className="text-red-500" onClick={() => handleAction(issue.id, "reject")}><ThumbsDown className="w-3 h-3" /></Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
