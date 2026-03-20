import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { BellOff, Plus, Clock, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function AlertSuppressionPage() {
  const { token } = useAuth();
  const [rules, setRules] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [rRes, sRes] = await Promise.all([
        axios.get(`${API}/alert-suppression/rules`, { headers }),
        axios.get(`${API}/alert-suppression/stats`, { headers }),
      ]);
      setRules(rRes.data);
      setStats(sRes.data);
    } catch (e) { toast.error("Failed to load rules"); }
    setLoading(false);
  };

  const toggleRule = async (ruleId, enabled) => {
    try {
      await axios.put(`${API}/alert-suppression/rules/${ruleId}`, { enabled }, { headers });
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r));
      toast.success(enabled ? "Rule enabled" : "Rule disabled");
    } catch (e) { toast.error("Failed to update"); }
  };

  const deleteRule = async (ruleId) => {
    try {
      await axios.delete(`${API}/alert-suppression/rules/${ruleId}`, { headers });
      setRules(prev => prev.filter(r => r.id !== ruleId));
      toast.success("Rule deleted");
    } catch (e) { toast.error("Failed to delete"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="alert-suppression-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Alert Suppression</h1><p className="text-muted-foreground text-sm mt-1">Reduce noise with intelligent alert suppression rules</p></div>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-5 flex items-center gap-3"><BellOff className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{stats.total_rules}</p><p className="text-xs text-muted-foreground">Total Rules</p></div></CardContent></Card>
          <Card><CardContent className="pt-5 flex items-center gap-3"><Shield className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{stats.active_rules}</p><p className="text-xs text-muted-foreground">Active Rules</p></div></CardContent></Card>
          <Card><CardContent className="pt-5 flex items-center gap-3"><BellOff className="w-6 h-6 text-amber-500" /><div><p className="text-2xl font-bold">{stats.total_suppressed.toLocaleString()}</p><p className="text-xs text-muted-foreground">Alerts Suppressed</p></div></CardContent></Card>
          <Card><CardContent className="pt-5 flex items-center gap-3"><Clock className="w-6 h-6 text-blue-500" /><div><p className="text-2xl font-bold">{stats.estimated_time_saved_hours}h</p><p className="text-xs text-muted-foreground">Time Saved (est.)</p></div></CardContent></Card>
        </div>
      )}

      <Card><CardHeader><CardTitle className="text-lg">Suppression Rules</CardTitle></CardHeader>
        <CardContent><div className="space-y-3">
          {rules.map(r => (
            <div key={r.id} className="p-4 rounded-lg border bg-muted/30" data-testid={`rule-${r.id}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm">{r.name}</h3>
                    <Badge variant={r.enabled ? "default" : "secondary"}>{r.enabled ? "Active" : "Disabled"}</Badge>
                    <Badge variant="outline" className="text-[10px]">{r.match_type}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>Match: <code className="bg-muted px-1 rounded">{r.match_value}</code></span>
                    <span>Scope: {r.scope}</span>
                    <span>Suppressed: <strong className="text-foreground">{r.suppressed_count?.toLocaleString()}</strong></span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={r.enabled} onCheckedChange={(v) => toggleRule(r.id, v)} />
                  <Button variant="ghost" size="icon" onClick={() => deleteRule(r.id)} className="text-red-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div></CardContent>
      </Card>
    </div>
  );
}
