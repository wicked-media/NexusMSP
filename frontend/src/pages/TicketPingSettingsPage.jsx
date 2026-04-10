import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Loader2, Save, Bell, Clock, AlertTriangle, Users, Plus, X, Shield,
  Zap, ArrowUp, Volume2, RefreshCw
} from "lucide-react";

const CATEGORIES = ["support", "network", "hardware", "software", "security", "backup", "email", "workshop", "retail", "onboarding", "project", "other"];
const PRIORITIES = [
  { key: "critical", label: "Critical", color: "text-red-400" },
  { key: "high", label: "High", color: "text-orange-400" },
  { key: "medium", label: "Medium", color: "text-yellow-400" },
  { key: "low", label: "Low", color: "text-green-400" },
];

export default function TicketPingSettingsPage() {
  const { token } = useAuth();
  const [settings, setSettings] = useState(null);
  const [mappings, setMappings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sRes, mRes] = await Promise.all([
        axios.get(`${API}/settings/ticket-ping`, { headers }),
        axios.get(`${API}/settings/ticket-ping/team-mappings`, { headers }),
      ]);
      setSettings(sRes.data);
      setMappings(mRes.data);
    } catch { toast.error("Failed to fetch settings"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/settings/ticket-ping`, settings, { headers });
      toast.success("Ping settings saved");
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  };

  const handleSaveMappings = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/settings/ticket-ping/team-mappings`, {
        category_teams: mappings.category_teams,
        sla_teams: mappings.sla_teams,
        escalation_contacts: mappings.escalation_contacts,
      }, { headers });
      toast.success("Team mappings saved");
    } catch { toast.error("Failed to save mappings"); }
    finally { setSaving(false); }
  };

  const handleRunCheck = async () => {
    try {
      const res = await axios.post(`${API}/tickets/check-escalations`, {}, { headers });
      setCheckResult(res.data);
      toast.success(`Checked: ${res.data.checked} tickets, ${res.data.pinged} pinged, ${res.data.escalated} escalated`);
    } catch { toast.error("Failed to run check"); }
  };

  const toggleUserInCategory = (category, userId) => {
    const current = mappings.category_teams[category] || [];
    const updated = current.includes(userId)
      ? current.filter(id => id !== userId)
      : [...current, userId];
    setMappings({
      ...mappings,
      category_teams: { ...mappings.category_teams, [category]: updated },
    });
  };

  const toggleUserInSla = (priority, userId) => {
    const current = mappings.sla_teams[priority] || [];
    const updated = current.includes(userId)
      ? current.filter(id => id !== userId)
      : [...current, userId];
    setMappings({
      ...mappings,
      sla_teams: { ...mappings.sla_teams, [priority]: updated },
    });
  };

  const toggleEscalationContact = (userId) => {
    const current = mappings.escalation_contacts || [];
    const updated = current.includes(userId)
      ? current.filter(id => id !== userId)
      : [...current, userId];
    setMappings({ ...mappings, escalation_contacts: updated });
  };

  if (loading || !settings || !mappings) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const users = mappings.available_users || [];

  return (
    <div className="space-y-6" data-testid="ticket-ping-settings-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ticket Ping & Escalation</h1>
          <p className="text-muted-foreground">Auto-notify teams when tickets are created and escalate unassigned tickets</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRunCheck} data-testid="run-check-btn">
            <RefreshCw className="w-4 h-4 mr-2" />Run Escalation Check
          </Button>
          <Button onClick={() => { handleSaveSettings(); handleSaveMappings(); }} disabled={saving} data-testid="save-ping-settings-btn">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save All
          </Button>
        </div>
      </div>

      {checkResult && (
        <Card className="border-blue-500/30">
          <CardContent className="py-3">
            <div className="flex items-center gap-4 text-sm">
              <Badge className="bg-blue-500/20 text-blue-400">Last Check</Badge>
              <span>{checkResult.checked} unassigned tickets checked</span>
              <span className="text-amber-400">{checkResult.pinged} pinged</span>
              <span className="text-red-400">{checkResult.escalated} escalated</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* General Settings */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Bell className="w-5 h-5 text-purple-400" />General Ping Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable Auto-Ping</p>
                  <p className="text-xs text-muted-foreground">Automatically notify team members when tickets are created</p>
                </div>
                <Switch checked={settings.enabled} onCheckedChange={v => setSettings({ ...settings, enabled: v })} data-testid="ping-enabled-toggle" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Ping on Ticket Create</p>
                  <p className="text-xs text-muted-foreground">Send immediate ping when a new ticket is created</p>
                </div>
                <Switch checked={settings.ping_on_create} onCheckedChange={v => setSettings({ ...settings, ping_on_create: v })} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Ping Until Picked Up</p>
                  <p className="text-xs text-muted-foreground">Keep sending reminders until a tech picks up the ticket</p>
                </div>
                <Switch checked={settings.ping_until_picked_up} onCheckedChange={v => setSettings({ ...settings, ping_until_picked_up: v })} />
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><Clock className="w-4 h-4" />Ping Interval (minutes)</Label>
                <Select value={String(settings.ping_interval_minutes)} onValueChange={v => setSettings({ ...settings, ping_interval_minutes: parseInt(v) })}>
                  <SelectTrigger data-testid="ping-interval"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">Every 15 minutes</SelectItem>
                    <SelectItem value="30">Every 30 minutes</SelectItem>
                    <SelectItem value="60">Every 1 hour</SelectItem>
                    <SelectItem value="120">Every 2 hours</SelectItem>
                    <SelectItem value="240">Every 4 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><ArrowUp className="w-4 h-4" />Escalation Timeout (hours)</Label>
                <Select value={String(settings.escalation_timeout_hours)} onValueChange={v => setSettings({ ...settings, escalation_timeout_hours: parseInt(v) })}>
                  <SelectTrigger data-testid="escalation-timeout"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">4 hours</SelectItem>
                    <SelectItem value="8">8 hours</SelectItem>
                    <SelectItem value="12">12 hours</SelectItem>
                    <SelectItem value="24">24 hours</SelectItem>
                    <SelectItem value="48">48 hours</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">After this time, unassigned tickets escalate to senior staff</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Category → Team Mapping */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-5 h-5 text-blue-400" />Category Team Mapping</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">Map ticket categories to team members. When a ticket is created with a specific category, these team members get pinged.</p>
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {CATEGORIES.map(cat => (
                <div key={cat} className="p-3 rounded-lg border border-border/50">
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline" className="capitalize">{cat}</Badge>
                    <span className="text-[10px] text-muted-foreground">{(mappings.category_teams[cat] || []).length} members</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {users.map(u => {
                      const isSelected = (mappings.category_teams[cat] || []).includes(u.id);
                      return (
                        <button key={u.id} onClick={() => toggleUserInCategory(cat, u.id)}
                          className={`px-2 py-1 rounded text-[10px] font-medium transition-all border ${isSelected ? "bg-blue-500/20 border-blue-500/40 text-blue-400" : "border-border/50 text-muted-foreground hover:bg-muted/40"}`}
                          data-testid={`cat-${cat}-user-${u.id}`}>
                          {u.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* SLA/Priority → Team Mapping */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="w-5 h-5 text-amber-400" />SLA / Priority Team Mapping</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">Map ticket priorities to team members. Critical SLA tickets can ping a dedicated response team.</p>
          <div className="space-y-3">
            {PRIORITIES.map(p => (
              <div key={p.key} className="p-3 rounded-lg border border-border/50">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline" className={`${p.color} capitalize`}>{p.label}</Badge>
                  <span className="text-[10px] text-muted-foreground">{(mappings.sla_teams[p.key] || []).length} members</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {users.map(u => {
                    const isSelected = (mappings.sla_teams[p.key] || []).includes(u.id);
                    return (
                      <button key={u.id} onClick={() => toggleUserInSla(p.key, u.id)}
                        className={`px-2 py-1 rounded text-[10px] font-medium transition-all border ${isSelected ? "bg-amber-500/20 border-amber-500/40 text-amber-400" : "border-border/50 text-muted-foreground hover:bg-muted/40"}`}
                        data-testid={`sla-${p.key}-user-${u.id}`}>
                        {u.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Escalation Contacts */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-400" />Escalation Contacts</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">Senior staff who receive escalated tickets when no one picks up within the timeout period. If no contacts are set, all admins are notified.</p>
          <div className="flex flex-wrap gap-2">
            {users.map(u => {
              const isSelected = (mappings.escalation_contacts || []).includes(u.id);
              return (
                <button key={u.id} onClick={() => toggleEscalationContact(u.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${isSelected ? "bg-red-500/20 border-red-500/40 text-red-400" : "border-border/50 text-muted-foreground hover:bg-muted/40"}`}
                  data-testid={`escalation-user-${u.id}`}>
                  {u.name} {u.is_admin && <span className="text-[8px] opacity-60">(Admin)</span>}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
