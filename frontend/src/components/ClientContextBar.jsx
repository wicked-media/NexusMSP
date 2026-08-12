import { Building2, ShieldCheck, X } from "lucide-react";

import { useClientContext } from "@/contexts/ClientContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ClientContextBar() {
  const context = useClientContext();
  if (!context) return null;
  const { activeClient, activeClientId, clients, loading, setActiveClient } = context;

  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 shadow-sm backdrop-blur ${
      activeClient ? "border-cyan-500/25 bg-cyan-500/[0.055]" : "border-border/70 bg-card/65"
    }`} data-testid="client-context-bar">
      <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${activeClient ? "bg-cyan-500/15 text-cyan-300" : "bg-muted text-muted-foreground"}`}>
        <Building2 className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Client context</p>
        <p className="max-w-[230px] truncate text-xs font-semibold">{activeClient?.name || "All permitted clients"}</p>
      </div>
      <Select value={activeClientId || "all"} onValueChange={(value) => setActiveClient(value === "all" ? "" : value)}>
        <SelectTrigger className="ml-auto h-8 w-[205px] bg-background/70 text-xs" aria-label="Set active client context">
          <SelectValue placeholder={loading ? "Loading clients…" : "Choose a client"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All permitted clients</SelectItem>
          {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name || client.id}</SelectItem>)}
        </SelectContent>
      </Select>
      {activeClient && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setActiveClient("")} aria-label="Clear active client context"><X className="h-3.5 w-3.5" /></Button>}
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><ShieldCheck className="h-3 w-3 text-emerald-400" /> Scope remains enforced</span>
    </div>
  );
}
