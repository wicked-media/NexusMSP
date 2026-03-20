import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Circle, ClipboardList } from "lucide-react";

export default function OnboardingWorkflowsPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/onboarding-workflows/list`, { headers }).then(r => setData(r.data)); }, []);

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="onboarding-workflows-page">
      <div><h1 className="text-2xl font-bold">Onboarding Workflows</h1><p className="text-muted-foreground text-sm">New client onboarding checklists with tracked progress</p></div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Total Workflows</div><div className="text-3xl font-bold mt-1">{s.total}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">In Progress</div><div className="text-3xl font-bold text-yellow-500 mt-1">{s.in_progress}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Completed</div><div className="text-3xl font-bold text-green-500 mt-1">{s.completed}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Avg Days</div><div className="text-3xl font-bold mt-1">{s.avg_completion_days}</div></CardContent></Card>
      </div>
      {data.workflows.map(w => (
        <Card key={w.id}><CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><ClipboardList className="w-5 h-5" />{w.client_name}</CardTitle>
            <div className="flex items-center gap-2"><Badge variant={w.status === "completed" ? "default" : "secondary"}>{w.status.replace("_", " ")}</Badge><span className="text-sm font-medium">{w.completion_pct}%</span></div>
          </div>
        </CardHeader>
          <CardContent>
            <Progress value={w.completion_pct} className="h-2 mb-4" />
            <div className="grid grid-cols-2 gap-2">
              {w.steps.map(step => (
                <div key={step.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50">
                  {step.status === "completed" ? <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" /> : <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                  <span className={`text-sm ${step.status === "completed" ? "" : "text-muted-foreground"}`}>{step.name}</span>
                  <Badge variant="outline" className="text-xs ml-auto">{step.category}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
