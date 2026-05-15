import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Award, Crown, Gem, Sparkles, Pencil } from "lucide-react";
import { toast } from "sonner";

const ICON_MAP = { shield: Shield, award: Award, crown: Crown, gem: Gem, sparkles: Sparkles };

/**
 * Client-level service-tier chip with inline reassignment (admin only).
 * Renders as a compact pill in the client header.
 */
export default function ClientServiceTierChip({ client, isAdmin = false, onUpdated }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tier, setTier] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [t1, t2] = await Promise.all([
        axios.get(`${API}/clients/${client.id}/service-tier`, { headers }),
        axios.get(`${API}/service-tiers`, { headers }),
      ]);
      setTier(t1.data?.tier);
      setTiers((t2.data || []).filter(t => t.is_active));
    } catch {
      setTier(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (client?.id) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, client?.service_tier_id]);

  const assignTier = async (tierId) => {
    try {
      await axios.patch(`${API}/clients/${client.id}/service-tier`, { service_tier_id: tierId === "__clear__" ? null : tierId }, { headers });
      toast.success("Service tier updated");
      setEditing(false);
      await fetchAll();
      onUpdated?.({ service_tier_id: tierId === "__clear__" ? null : tierId });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    }
  };

  if (loading) return null;

  if (!tier && !isAdmin) return null;

  if (!tier) {
    return (
      <Select onValueChange={assignTier}>
        <SelectTrigger className="h-7 text-[11px] w-[170px]" data-testid="client-tier-assign">
          <SelectValue placeholder="Assign tier…" />
        </SelectTrigger>
        <SelectContent>{tiers.map(t => <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>)}</SelectContent>
      </Select>
    );
  }

  const Icon = ICON_MAP[tier.icon] || Shield;

  if (editing && isAdmin) {
    return (
      <Select value={tier.id} onValueChange={assignTier}>
        <SelectTrigger className="h-7 text-[11px] w-[180px]" data-testid="client-tier-change">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__clear__" className="text-xs text-rose-400">— Clear tier —</SelectItem>
          {tiers.map(t => <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Badge
      variant="outline"
      className="gap-1.5 text-[10.5px] font-semibold border-current cursor-pointer hover:brightness-125"
      style={{ color: tier.color, borderColor: `${tier.color}66`, backgroundColor: `${tier.color}10` }}
      data-testid="client-tier-chip"
      title={`${tier.name} · response ${tier.response_sla_minutes < 60 ? tier.response_sla_minutes + "m" : Math.round(tier.response_sla_minutes / 60) + "h"} / resolution ${Math.round(tier.resolution_sla_minutes / 60)}h${isAdmin ? " · click to change" : ""}`}
      onClick={() => isAdmin && setEditing(true)}
    >
      <Icon className="w-3 h-3" />
      {tier.name}
      {isAdmin && <Pencil className="w-2.5 h-2.5 opacity-50" />}
    </Badge>
  );
}
