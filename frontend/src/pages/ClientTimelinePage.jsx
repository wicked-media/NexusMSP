import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ticket, Receipt, Monitor, Users, Activity } from "lucide-react";
import HeroTile from "@/components/HeroTile";
import ClientActivityFeed from "@/components/clients/ClientActivityFeed";

export default function ClientTimelinePage({ embedded = false }) {
  const { token } = useAuth();
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios.get(`${API}/clients`, { headers: { Authorization: `Bearer ${token}` } }).then(r => setClients(r.data)).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!selectedClient) return;
    setLoading(true);
    axios.get(`${API}/clients/${selectedClient}/timeline?limit=300`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setTimeline(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedClient, token]);

  return (
    <div className="space-y-6" data-testid="client-timeline-page">
      <div className={`flex items-center ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded && <div>
          <h1 className="text-2xl font-bold tracking-tight">Client Communication Timeline</h1>
          <p className="text-muted-foreground text-sm mt-1">Single pane of glass for all client interactions</p>
        </div>}
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
            <HeroTile label="Service Events" value={timeline.events.filter(e => e.category === "service").length} icon={Ticket} glow="cyan" testId="timeline-tickets" />
            <HeroTile label="Financial Events" value={timeline.events.filter(e => e.category === "finance").length} icon={Receipt} glow="emerald" testId="timeline-invoices" />
            <HeroTile label="Asset Events" value={timeline.events.filter(e => e.category === "asset").length} icon={Monitor} glow="amber" testId="timeline-devices" />
          </div>
          <ClientActivityFeed activity={timeline.events} title={`${timeline.client?.name || "Client"} · Nexus Timeline`} />
        </>
      )}
    </div>
  );
}
