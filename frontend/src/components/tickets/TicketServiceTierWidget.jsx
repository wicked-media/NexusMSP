import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Award, Crown, Gem, CheckCircle2, Clock, Sparkles, Pencil } from "lucide-react";
import { toast } from "sonner";

const ICON_MAP = { shield: Shield, award: Award, crown: Crown, gem: Gem, sparkles: Sparkles };

function formatSla(minutes) {
  if (!minutes && minutes !== 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.round(minutes / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * Sidebar widget showing the client's service tier with SLA targets + features.
 * Admin can edit the assigned tier inline via a dropdown.
 */
export default function TicketServiceTierWidget({ ticketId, clientId, token, isAdmin = false }) {
  const [data, setData] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    try {
      const res = await axios.get(`${API}/tickets/${ticketId}/service-tier`, { headers });
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchTiers = async () => {
    try {
      const res = await axios.get(`${API}/service-tiers`, { headers });
      setTiers(res.data.filter(t => t.is_active));
    } catch { /* */ }
  };

  useEffect(() => {
    if (ticketId) { fetchData(); fetchTiers(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const handleAssign = async (tierId) => {
    if (!clientId) return;
    setSaving(true);
    try {
      await axios.patch(`${API}/clients/${clientId}/service-tier`, { service_tier_id: tierId }, { headers });
      toast.success("Service tier updated");
      await fetchData();
      setEditing(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update tier");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Card><CardContent className="py-3 text-[11px] text-zinc-500">Loading tier…</CardContent></Card>;
  }

  const tier = data?.tier;

  if (!tier) {
    return (
      <Card data-testid="service-tier-widget-empty" className="border-dashed border-zinc-700/40">
        <CardContent className="py-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Shield className="w-3.5 h-3.5" />No service tier assigned
          </div>
          {isAdmin && tiers.length > 0 && (
            <Select onValueChange={handleAssign} disabled={saving}>
              <SelectTrigger className="h-7 text-[11px]" data-testid="service-tier-assign-select">
                <SelectValue placeholder="Assign tier…" />
              </SelectTrigger>
              <SelectContent>
                {tiers.map(t => (
                  <SelectItem key={t.id} value={t.id} className="text-xs" data-testid={`tier-opt-${t.slug}`}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>
    );
  }

  const Icon = ICON_MAP[tier.icon] || Shield;
  return (
    <Card
      data-testid="service-tier-widget"
      className="overflow-hidden border-0"
      style={{
        background: `linear-gradient(135deg, ${tier.color}18, transparent 60%), hsl(var(--card))`,
        boxShadow: `inset 0 0 0 1px ${tier.color}40`,
      }}
    >
      <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${tier.color}, transparent)` }} />
      <CardHeader className="pb-1.5 flex flex-row items-center justify-between">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Icon className="w-4 h-4" style={{ color: tier.color }} />
          <span style={{ color: tier.color }}>{tier.name}</span>
        </CardTitle>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-widest border-current" style={{ color: tier.color }}>
            {tier.slug}
          </Badge>
          {isAdmin && (
            <Button
              variant="ghost" size="sm" className="h-6 w-6 p-0"
              onClick={() => setEditing(e => !e)}
              data-testid="service-tier-edit-btn"
              title="Change tier"
            >
              <Pencil className="w-3 h-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2.5">
        {editing && isAdmin && (
          <Select value={tier.id} onValueChange={handleAssign} disabled={saving}>
            <SelectTrigger className="h-7 text-[11px]" data-testid="service-tier-change-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__clear__" className="text-xs text-rose-400" onPointerDown={(e) => { e.preventDefault(); handleAssign(null); }}>
                — Clear tier —
              </SelectItem>
              {tiers.map(t => (
                <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {tier.description && (
          <p className="text-[10.5px] text-zinc-400 leading-snug">{tier.description}</p>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-1.5">
            <div className="text-[9px] uppercase tracking-widest font-mono text-zinc-500 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />Response
            </div>
            <div className="text-sm font-bold mt-0.5" style={{ color: tier.color }}>
              {formatSla(tier.response_sla_minutes)}
            </div>
          </div>
          <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-1.5">
            <div className="text-[9px] uppercase tracking-widest font-mono text-zinc-500 flex items-center gap-1">
              <CheckCircle2 className="w-2.5 h-2.5" />Resolution
            </div>
            <div className="text-sm font-bold mt-0.5" style={{ color: tier.color }}>
              {formatSla(tier.resolution_sla_minutes)}
            </div>
          </div>
        </div>

        {(tier.features || []).length > 0 && (
          <div className="space-y-0.5">
            <div className="text-[9px] uppercase tracking-widest font-mono text-zinc-500">Included</div>
            <ul className="space-y-0.5">
              {tier.features.slice(0, 4).map((f, i) => (
                <li key={`tf-${i}`} className="text-[10.5px] text-zinc-300 flex items-start gap-1.5">
                  <CheckCircle2 className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" style={{ color: tier.color }} />
                  <span>{f}</span>
                </li>
              ))}
              {tier.features.length > 4 && (
                <li className="text-[9px] text-zinc-500 pl-3.5">+{tier.features.length - 4} more</li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Compact inline chip — shows tier next to client name in header. */
export function ServiceTierChip({ ticketId, token }) {
  const [tier, setTier] = useState(null);
  useEffect(() => {
    if (!ticketId) return;
    axios
      .get(`${API}/tickets/${ticketId}/service-tier`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setTier(r.data?.tier))
      .catch(() => setTier(null));
  }, [ticketId, token]);

  if (!tier) return null;
  const Icon = ICON_MAP[tier.icon] || Shield;
  return (
    <Badge
      variant="outline"
      className="gap-1 text-[10px] font-semibold border-current"
      style={{ color: tier.color, borderColor: `${tier.color}66`, backgroundColor: `${tier.color}10` }}
      data-testid="service-tier-chip"
      title={`Service tier: ${tier.name}`}
    >
      <Icon className="w-3 h-3" />
      {tier.name}
    </Badge>
  );
}
