import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Play, AlertTriangle } from "lucide-react";

export default function RansomwareTabletopPage() {
  const { token } = useAuth();
  const [scenarios, setScenarios] = useState([]);
  const [activeDrill, setActiveDrill] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/ransomware-tabletop/scenarios`, { headers }).then(r => setScenarios(r.data)); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrill = async (id) => {
    const res = await axios.post(`${API}/ransomware-tabletop/start/${id}`, {}, { headers });
    setActiveDrill(res.data);
  };

  return (
    <div className="space-y-6" data-testid="ransomware-tabletop-page">
      <div><h1 className="text-2xl font-bold">Ransomware Tabletop</h1><p className="text-muted-foreground text-sm">Run simulated ransomware scenarios to test your incident response</p></div>
      {activeDrill ? (
        <Card className="border-red-500/30"><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-4"><AlertTriangle className="w-5 h-5 text-red-500" /><h2 className="text-lg font-bold">DRILL IN PROGRESS: {activeDrill.scenario_name}</h2><Badge variant="destructive">Phase {activeDrill.current_phase}</Badge></div>
          {activeDrill.phases?.map((phase, i) => (
            <div key={`k-${i}`} className={`p-4 rounded-lg border mb-3 ${i + 1 === activeDrill.current_phase ? "border-red-500/50 bg-red-500/5" : ""}`}>
              <h3 className="font-semibold">Phase {phase.phase}: {phase.title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{phase.description}</p>
              {i + 1 === activeDrill.current_phase && (
                <div className="mt-3 space-y-2">{phase.decisions.map((d, j) => <Button key={`k-${j}`} variant="outline" className="mr-2 text-sm">{d}</Button>)}</div>
              )}
            </div>
          ))}
          <Button variant="outline" onClick={() => setActiveDrill(null)}>End Drill</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {scenarios.map(s => (
            <Card key={s.id}><CardContent className="pt-4">
              <div className="flex items-center gap-4">
                <Shield className="w-10 h-10 text-red-500" />
                <div className="flex-1">
                  <div className="flex items-center gap-2"><span className="font-semibold">{s.name}</span><Badge variant={s.difficulty === "hard" ? "destructive" : "secondary"}>{s.difficulty}</Badge></div>
                  <p className="text-sm text-muted-foreground">{s.description}</p>
                  <div className="text-xs text-muted-foreground mt-1">{s.phases.length} phases | ~{s.est_duration_min}min | Run {s.times_run}x {s.avg_score_pct ? `| Avg Score: ${s.avg_score_pct}%` : ""}</div>
                </div>
                <Button onClick={() => startDrill(s.id)}><Play className="w-4 h-4 mr-1" />Start Drill</Button>
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}
