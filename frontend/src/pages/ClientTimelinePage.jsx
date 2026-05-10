import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Ticket, Receipt, FileText, Monitor, Heart, CheckCircle, Clock, Users, Activity } from "lucide-react";
import HeroTile from "@/components/HeroTile";

const iconMap = { ticket: Ticket, check: CheckCircle, receipt: Receipt, file: FileText, filetext: FileText, monitor: Monitor, heart: Heart };
const colorMap = { blue: "bg-blue-500", green: "bg-green-500", amber: "bg-amber-500", violet: "bg-violet-500", emerald: "bg-emerald-500", cyan: "bg-cyan-500", pink: "bg-pink-500" };

export default function ClientTimelinePage() {
  const { token } = useAuth();
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/clients`, { headers }).then(r => setClients(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClient) return;
    setLoading(true);
    axios.get(`${API}/client-timeline/${selectedClient}`, { headers })
      .then(r => setTimeline(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedClient]);

  return (
    <div className="space-y-6" data-testid="client-timeline-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Client Communication Timeline</h1>
          <p className="text-muted-foreground text-sm mt-1">Single pane of glass for all client interactions</p>
        </div>
        <Select value={selectedClient} onValueChange={setSelectedClient}>
          <SelectTrigger className="w-[280px]" data-testid="client-timeline-select">
            <SelectValue placeholder="Select a client..." />
          </SelectTrigger>
          <SelectContent>
            {clients.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedClient && (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>Select a client to view their complete timeline</p>
        </CardContent></Card>
      )}

      {loading && <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}

      {timeline && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <HeroTile label="Total Events" value={timeline.total_events} icon={Activity} glow="violet" testId="timeline-total-events" />
            <HeroTile label="Tickets" value={timeline.events.filter(e => e.type === "ticket_created").length} icon={Ticket} glow="cyan" testId="timeline-tickets" />
            <HeroTile label="Invoices" value={timeline.events.filter(e => e.type === "invoice").length} icon={Receipt} glow="emerald" testId="timeline-invoices" />
            <HeroTile label="Devices" value={timeline.events.filter(e => e.type === "device_added").length} icon={Monitor} glow="amber" testId="timeline-devices" />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px]">
                <div className="relative pl-8 space-y-1">
                  <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
                  {timeline.events.map((event, i) => {
                    const Icon = iconMap[event.icon] || Clock;
                    return (
                      <div key={`k-${i}`} className="relative flex items-start gap-4 py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors" data-testid={`timeline-event-${i}`}>
                        <div className={`absolute -left-5 w-6 h-6 rounded-full ${colorMap[event.color] || "bg-slate-500"} flex items-center justify-center ring-4 ring-background`}>
                          <Icon className="w-3 h-3 text-white" />
                        </div>
                        <div className="flex-1 min-w-0 ml-4">
                          <p className="text-sm font-medium">{event.title}</p>
                          <p className="text-xs text-muted-foreground">{event.subtitle}</p>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {event.timestamp ? new Date(event.timestamp).toLocaleDateString() : ""}
                        </span>
                      </div>
                    );
                  })}
                  {timeline.events.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No events found for this client</p>}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
