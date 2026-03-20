import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, Phone, Ticket, Calendar, ArrowRight, ArrowLeft } from "lucide-react";

export default function CommsTimelinePage() {
  const { token } = useAuth();
  const [overview, setOverview] = useState([]);
  const [selected, setSelected] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/comms-timeline/overview`, { headers }).then(r => setOverview(r.data)); }, []);

  const loadClient = async (name) => {
    setSelected(name);
    const res = await axios.get(`${API}/comms-timeline/client/${encodeURIComponent(name)}`, { headers });
    setTimeline(res.data);
  };

  const iconMap = { email: Mail, ticket: Ticket, call: Phone, meeting: Calendar };
  return (
    <div className="space-y-6" data-testid="comms-timeline-page">
      <div><h1 className="text-2xl font-bold">Communication Timeline</h1><p className="text-muted-foreground text-sm">Unified view of all client interactions — emails, tickets, calls, meetings</p></div>
      <div className="grid grid-cols-2 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Clients</CardTitle></CardHeader>
          <CardContent><div className="space-y-2">
            {overview.map(c => (
              <div key={c.client_name} className="p-3 rounded-lg border hover:bg-muted/50 cursor-pointer" onClick={() => loadClient(c.client_name)}>
                <div className="flex items-center justify-between"><span className="font-medium">{c.client_name}</span><Badge variant="outline">{c.total_interactions} interactions</Badge></div>
                <div className="text-xs text-muted-foreground mt-1">Last: {c.last_contact ? new Date(c.last_contact).toLocaleDateString() : "N/A"}</div>
              </div>
            ))}
          </div></CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">{selected ? `Timeline: ${selected}` : "Select a client"}</CardTitle></CardHeader>
          <CardContent>
            {timeline ? (
              <div className="space-y-1">
                <div className="flex gap-3 mb-3 text-xs">
                  <Badge>Emails: {timeline.summary.emails}</Badge><Badge variant="secondary">Tickets: {timeline.summary.tickets}</Badge>
                  <Badge variant="outline">Calls: {timeline.summary.calls}</Badge><Badge variant="outline">Meetings: {timeline.summary.meetings}</Badge>
                </div>
                {timeline.events.map(e => {
                  const Icon = iconMap[e.type] || Mail;
                  return (
                    <div key={e.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      {e.direction === "inbound" ? <ArrowLeft className="w-3 h-3 text-blue-500" /> : <ArrowRight className="w-3 h-3 text-green-500" />}
                      <div className="flex-1 text-sm">{e.description}<div className="text-xs text-muted-foreground">{e.author} - {new Date(e.timestamp).toLocaleDateString()}</div></div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-muted-foreground text-sm py-8 text-center">Click a client to view their communication timeline</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
