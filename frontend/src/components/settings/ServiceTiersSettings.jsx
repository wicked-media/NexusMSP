import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Shield, Award, Crown, Gem, Sparkles, Plus, Save, X, Trash2, Loader2,
  Clock, CheckCircle2, GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { getServiceTierVisual } from "@/lib/serviceTierVisuals";

const ICONS = { shield: Shield, award: Award, crown: Crown, gem: Gem, sparkles: Sparkles };
const ICON_OPTIONS = [
  { v: "shield", label: "Shield" },
  { v: "award", label: "Award" },
  { v: "crown", label: "Crown" },
  { v: "gem", label: "Gem" },
  { v: "sparkles", label: "Sparkles" },
];

function fmtSla(minutes) {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.round(minutes / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const EMPTY_TIER = {
  name: "",
  slug: "",
  color: "#a78bfa",
  icon: "shield",
  sort_order: 99,
  response_sla_minutes: 60 * 8,
  resolution_sla_minutes: 60 * 24 * 3,
  monthly_price: 0,
  features: [],
  description: "",
  is_active: true,
};

export default function ServiceTiersSettings() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [featureInput, setFeatureInput] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTiers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/service-tiers`, { headers: { Authorization: `Bearer ${token}` } });
      setTiers(res.data || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load tiers");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchTiers(); }, [fetchTiers]);

  const openCreate = () => {
    setEditing({ ...EMPTY_TIER, sort_order: tiers.length + 1 });
    setFeatureInput("");
    setEditorOpen(true);
  };
  const openEdit = (tier) => {
    setEditing({ ...tier });
    setFeatureInput("");
    setEditorOpen(true);
  };

  const save = async () => {
    if (!editing.name?.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (editing.id) {
        await axios.patch(`${API}/service-tiers/${editing.id}`, editing, { headers });
        toast.success("Tier updated");
      } else {
        await axios.post(`${API}/service-tiers`, editing, { headers });
        toast.success("Tier created");
      }
      setEditorOpen(false);
      setEditing(null);
      await fetchTiers();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (tier) => {
    const msg = tier.is_default
      ? `"${tier.name}" is a default tier. Deleting will deactivate it (you can re-enable later).`
      : `Permanently delete "${tier.name}"? Any clients on this tier will be unassigned.`;
    if (!window.confirm(msg)) return;
    try {
      await axios.delete(`${API}/service-tiers/${tier.id}`, { headers });
      toast.success(tier.is_default ? "Tier deactivated" : "Tier deleted");
      await fetchTiers();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
  };

  const toggleActive = async (tier) => {
    try {
      await axios.patch(`${API}/service-tiers/${tier.id}`, { is_active: !tier.is_active }, { headers });
      await fetchTiers();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Toggle failed");
    }
  };

  const addFeature = () => {
    const v = featureInput.trim();
    if (!v) return;
    setEditing(e => ({ ...e, features: [...(e.features || []), v] }));
    setFeatureInput("");
  };
  const removeFeature = (idx) => {
    setEditing(e => ({ ...e, features: e.features.filter((_, i) => i !== idx) }));
  };

  return (
    <Card data-testid="service-tiers-settings" id="service-tiers-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><Shield className="w-4 h-4 text-violet-400" />Service Tiers</CardTitle>
          <CardDescription className="text-xs mt-1">
            Define the tiered service plans clients can be assigned (e.g. Bronze → Diamond). Tiers drive SLA targets and feature entitlements.
          </CardDescription>
        </div>
        <Button onClick={openCreate} data-testid="tier-create-btn" size="sm">
          <Plus className="w-3 h-3 mr-1" />New Tier
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-10"><Loader2 className="w-5 h-5 mx-auto animate-spin text-zinc-500" /></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {tiers.map(tier => {
              const Icon = ICONS[tier.icon] || Shield;
              const visual = getServiceTierVisual(tier);
              return (
                <Card
                  key={tier.id}
                  data-testid={`tier-card-${tier.slug}`}
                  className={`overflow-hidden border-0 transition ${!tier.is_active ? "opacity-50" : ""}`}
                  style={{
                    background: `linear-gradient(135deg, ${visual.color}16, transparent 60%), hsl(var(--card))`,
                    boxShadow: `inset 0 0 0 1px ${visual.color}40`,
                  }}
                >
                  <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${visual.color}, transparent)` }} />
                  <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-black/10" style={{ color: visual.color, borderColor: `${visual.color}55` }}><Icon className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <CardTitle className="text-sm flex items-center gap-1.5" style={{ color: visual.color }}>
                          {visual.label}
                          {tier.is_default && <Badge variant="outline" className="text-[8px] uppercase tracking-widest">default</Badge>}
                        </CardTitle>
                        {tier.description && <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">{tier.description}</p>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Switch
                        checked={tier.is_active !== false}
                        onCheckedChange={() => toggleActive(tier)}
                        className="scale-75"
                        data-testid={`tier-toggle-${tier.slug}`}
                      />
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(tier)} data-testid={`tier-edit-${tier.slug}`}>
                        <Save className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400 hover:text-rose-300" onClick={() => remove(tier)} data-testid={`tier-delete-${tier.slug}`}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-1.5">
                        <div className="text-[9px] uppercase tracking-widest font-mono text-zinc-500 flex items-center gap-1"><Clock className="w-2.5 h-2.5" />Response</div>
                        <div className="text-sm font-bold mt-0.5" style={{ color: visual.color }}>{fmtSla(tier.response_sla_minutes)}</div>
                      </div>
                      <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-1.5">
                        <div className="text-[9px] uppercase tracking-widest font-mono text-zinc-500 flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" />Resolution</div>
                        <div className="text-sm font-bold mt-0.5" style={{ color: visual.color }}>{fmtSla(tier.resolution_sla_minutes)}</div>
                      </div>
                    </div>
                    {(tier.features || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {tier.features.slice(0, 4).map((f, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-zinc-300">{f}</span>
                        ))}
                        {tier.features.length > 4 && <span className="text-[10px] text-zinc-500">+{tier.features.length - 4} more</span>}
                      </div>
                    )}
                    <div className="text-[10px] text-zinc-500 font-mono flex items-center gap-2 pt-1">
                      <GripVertical className="w-2.5 h-2.5" />sort #{tier.sort_order} · slug <span className="text-zinc-400">{tier.slug}</span>
                      {tier.monthly_price ? <span className="ml-auto text-emerald-400">${tier.monthly_price}/mo</span> : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {tiers.length === 0 && (
              <Card className="col-span-2"><CardContent className="py-10 text-center text-zinc-500">
                <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No service tiers yet. Click <strong>New Tier</strong> above to create one.</p>
              </CardContent></Card>
            )}
          </div>
        )}
      </CardContent>

      {/* Editor */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="tier-editor-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editing?.id ? <Save className="w-4 h-4 text-violet-400" /> : <Plus className="w-4 h-4 text-emerald-400" />}
              {editing?.id ? "Edit Service Tier" : "Create Service Tier"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Name *</Label>
                  <Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. SMB Gold" data-testid="tier-name-input" />
                </div>
                <div>
                  <Label className="text-xs">Slug</Label>
                  <Input value={editing.slug} onChange={e => setEditing({ ...editing, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-") })} placeholder="gold" data-testid="tier-slug-input" />
                </div>
              </div>

              <div>
                <Label className="text-xs">Description</Label>
                <Textarea
                  rows={2}
                  value={editing.description}
                  onChange={e => setEditing({ ...editing, description: e.target.value })}
                  placeholder="One-line elevator pitch for what this tier offers"
                  data-testid="tier-desc-input"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Color</Label>
                  <div className="flex items-center gap-1">
                    <Input type="color" value={editing.color} onChange={e => setEditing({ ...editing, color: e.target.value })} className="w-12 h-8 p-1 cursor-pointer" data-testid="tier-color-input" />
                    <Input value={editing.color} onChange={e => setEditing({ ...editing, color: e.target.value })} className="flex-1 font-mono text-xs" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Icon</Label>
                  <Select value={editing.icon} onValueChange={(v) => setEditing({ ...editing, icon: v })}>
                    <SelectTrigger data-testid="tier-icon-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ICON_OPTIONS.map(o => <SelectItem key={o.v} value={o.v}><span className="flex items-center gap-1.5">{(() => { const I = ICONS[o.v]; return <I className="w-3 h-3" />; })()} {o.label}</span></SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Sort order</Label>
                  <Input type="number" value={editing.sort_order} onChange={e => setEditing({ ...editing, sort_order: parseInt(e.target.value, 10) || 99 })} data-testid="tier-sort-input" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Response SLA (minutes)</Label>
                  <Input type="number" value={editing.response_sla_minutes} onChange={e => setEditing({ ...editing, response_sla_minutes: parseInt(e.target.value, 10) || 0 })} data-testid="tier-response-input" />
                  <p className="text-[10px] text-zinc-500 mt-0.5">≈ {fmtSla(editing.response_sla_minutes)}</p>
                </div>
                <div>
                  <Label className="text-xs">Resolution SLA (minutes)</Label>
                  <Input type="number" value={editing.resolution_sla_minutes} onChange={e => setEditing({ ...editing, resolution_sla_minutes: parseInt(e.target.value, 10) || 0 })} data-testid="tier-resolution-input" />
                  <p className="text-[10px] text-zinc-500 mt-0.5">≈ {fmtSla(editing.resolution_sla_minutes)}</p>
                </div>
              </div>

              <div>
                <Label className="text-xs">Monthly price (informational)</Label>
                <Input type="number" value={editing.monthly_price} onChange={e => setEditing({ ...editing, monthly_price: parseFloat(e.target.value) || 0 })} placeholder="0" data-testid="tier-price-input" />
              </div>

              <div>
                <Label className="text-xs">Features included</Label>
                <div className="flex gap-1 mb-1.5">
                  <Input
                    value={featureInput}
                    onChange={e => setFeatureInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addFeature(); } }}
                    placeholder="e.g. 24×7 monitoring"
                    data-testid="tier-feature-input"
                  />
                  <Button onClick={addFeature} size="sm" variant="outline" data-testid="tier-feature-add"><Plus className="w-3 h-3" /></Button>
                </div>
                <div className="space-y-1">
                  {(editing.features || []).map((f, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1 rounded border border-white/5 bg-white/[0.02] text-xs">
                      <CheckCircle2 className="w-3 h-3" style={{ color: editing.color }} />
                      <span className="flex-1">{f}</span>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-rose-400" onClick={() => removeFeature(i)} data-testid={`tier-feature-remove-${i}`}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  {(editing.features || []).length === 0 && <p className="text-[10px] text-zinc-500">No features added yet.</p>}
                </div>
              </div>

              <div className="flex items-center justify-between p-2 rounded border border-white/5 bg-white/[0.02]">
                <Label className="text-xs">Active</Label>
                <Switch checked={editing.is_active !== false} onCheckedChange={(c) => setEditing({ ...editing, is_active: c })} data-testid="tier-active-switch" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} data-testid="tier-cancel-btn">
              <X className="w-3 h-3 mr-1" />Cancel
            </Button>
            <Button onClick={save} disabled={saving} data-testid="tier-save-btn">
              {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
              {editing?.id ? "Save Changes" : "Create Tier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
