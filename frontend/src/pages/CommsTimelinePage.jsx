import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Mail, Phone, Ticket, Calendar, ArrowRight, ArrowLeft, Search,
  MessageSquare, Clock, Users, TrendingUp, Filter, Loader2,
  Activity, BarChart3, Send, ChevronRight
} from "lucide-react";

const ICON_MAP = { email: Mail, ticket: Ticket, call: Phone, meeting: Calendar };
const TYPE_COLORS = { email: "text-blue-400 bg-blue-500/10", ticket: "text-amber-400 bg-amber-500/10", call: "text-emerald-400 bg-emerald-500/10", meeting: "text-purple-400 bg-purple-500/10" };

export default function CommsTimelinePage() {
  const { token } = useAuth();
  const [overview, setOverview] = useState([]);
  const [selected, setSelected] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/comms-timeline/overview`, { headers });
      setOverview(res.data);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const loadClient = async (name) => {
    setSelected(name);
    try {
      const res = await axios.get(`${API}/comms-timeline/client/${encodeURIComponent(name)}`, { headers });
      setTimeline(res.data);
    } catch { toast.error("Failed to load timeline"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const totalInteractions = overview.reduce((s, c) => s + (c.total_interactions || 0), 0);
  const filteredEvents = (timeline?.events || []).filter(e => {
    if (typeFilter !== "all" && e.type !== typeFilter) return false;
    if (search && !e.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-5" data-testid="comms-timeline-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center"><MessageSquare className="w-5 h-5 text-white" /></div>
            Client Communication Hub
          </h1>
          <p className="text-muted-foreground mt-1">Unified inbox — emails, tickets, calls, meetings in one timeline</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total Clients", value: overview.length, icon: Users, color: "text-foreground" },
          { label: "Total Interactions", value: totalInteractions, icon: MessageSquare, color: "text-blue-400" },
          { label: "Emails", value: overview.reduce((s, c) => s + ((c.recent || []).filter(r => r.type === "email").length), 0), icon: Mail, color: "text-cyan-400" },
          { label: "Calls", value: overview.reduce((s, c) => s + ((c.recent || []).filter(r => r.type === "call").length), 0), icon: Phone, color: "text-emerald-400" },
          { label: "Meetings", value: overview.reduce((s, c) => s + ((c.recent || []).filter(r => r.type === "meeting").length), 0), icon: Calendar, color: "text-purple-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-5">
        {/* Client List */}
        <Card className="border-border/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Clients</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 max-h-[600px] overflow-auto">
            {overview.map(c => {
              const isActive = selected === c.client_name;
              const daysSince = c.last_contact ? Math.floor((Date.now() - new Date(c.last_contact).getTime()) / 86400000) : null;
              return (
                <div key={c.client_name} className={`p-3 rounded-lg border cursor-pointer transition-all ${isActive ? "border-primary bg-primary/5" : "border-border/30 hover:border-border/60 hover:bg-muted/30"}`} onClick={() => loadClient(c.client_name)} data-testid={`client-${c.client_name}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{c.client_name}</span>
                    <Badge variant="outline" className="text-[10px]">{c.total_interactions}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {daysSince !== null && (
                      <span className={`text-[10px] ${daysSince > 14 ? "text-red-400" : daysSince > 7 ? "text-amber-400" : "text-emerald-400"}`}>
                        {daysSince === 0 ? "Today" : `${daysSince}d ago`}
                      </span>
                    )}
                    <div className="flex gap-1 ml-auto">
                      {(c.recent || []).slice(0, 3).map((r, i) => {
                        const Icon = ICON_MAP[r.type] || Mail;
                        return <Icon key={`k-${i}`} className={`w-3 h-3 ${TYPE_COLORS[r.type]?.split(" ")[0] || "text-muted-foreground"}`} />;
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{selected ? `Timeline: ${selected}` : "Select a client"}</CardTitle>
              {timeline && (
                <div className="flex gap-1">
                  {Object.entries(timeline.summary || {}).filter(([k]) => k !== "total").map(([type, count]) => {
                    const Icon = ICON_MAP[type] || Mail;
                    return <Badge key={type} variant="outline" className="text-[10px] gap-1"><Icon className="w-3 h-3" />{count}</Badge>;
                  })}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!timeline ? (
              <div className="py-16 text-center">
                <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" />
                <p className="text-muted-foreground">Click a client to view their communication timeline</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Filters */}
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
                  </div>
                  <div className="flex gap-1">
                    {["all", "email", "ticket", "call", "meeting"].map(t => (
                      <Button key={t} size="sm" variant={typeFilter === t ? "default" : "ghost"} onClick={() => setTypeFilter(t)} className="h-8 text-xs capitalize">{t}</Button>
                    ))}
                  </div>
                </div>

                {/* Events */}
                <div className="space-y-1 max-h-[500px] overflow-auto">
                  {filteredEvents.map(e => {
                    const Icon = ICON_MAP[e.type] || Mail;
                    const colorClass = TYPE_COLORS[e.type] || "text-muted-foreground bg-muted";
                    return (
                      <div key={e.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-all border border-transparent hover:border-border/30">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass.split(" ")[1]}`}>
                          <Icon className={`w-4 h-4 ${colorClass.split(" ")[0]}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {e.direction === "inbound" ? <ArrowLeft className="w-3 h-3 text-blue-400" /> : <ArrowRight className="w-3 h-3 text-emerald-400" />}
                            <span className="text-sm font-medium">{e.description}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-muted-foreground">{e.author}</span>
                            <span className="text-[10px] text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</span>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] capitalize flex-shrink-0">{e.type}</Badge>
                      </div>
                    );
                  })}
                  {filteredEvents.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No matching events</p>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
