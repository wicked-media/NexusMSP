import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Hash, Landmark, Loader2, Lock, Save, ShieldCheck, Sparkles,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import BillingWorkspaceNav from "@/components/billing/BillingWorkspaceNav";

const NUMBERING_VARS = ["{YYYY}", "{YY}", "{MM}", "{FY}", "{CLIENT}", "{SEQ}"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const APPROVER_ROLES = [
  { value: "admin", label: "Administrator" },
  { value: "manager", label: "Manager" },
  { value: "technician", label: "Technician" },
];

export default function BillingSettingsPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [tab, setTab] = useState("numbering");
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [numbering, setNumbering] = useState(null);
  const [approval, setApproval] = useState(null);
  const [tax, setTax] = useState(null);
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      axios.get(`${API}/billing-pro/numbering`, { headers }),
      axios.get(`${API}/billing-pro/settings/approval`, { headers }),
      axios.get(`${API}/billing-pro/settings/tax-compliance`, { headers }),
    ]).then(([numRes, appRes, taxRes]) => {
      if (cancelled) return;
      setNumbering(numRes.data);
      setApproval(appRes.data);
      setTax(taxRes.data);
    }).catch((error) => {
      if (cancelled) return;
      if (error.response?.status === 403) setDenied(true);
      else toast.error("Could not load billing settings");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [headers]);

  // Live sample render for the numbering format (debounced).
  useEffect(() => {
    if (!numbering) return undefined;
    const handle = setTimeout(async () => {
      try {
        const body = {
          ...numbering,
          fy_start_month: Number(numbering.fy_start_month) || 7,
          next_seq: Number(numbering.next_seq) || 1,
          sample_client: "ACME",
        };
        const { data } = await axios.post(`${API}/billing-pro/numbering/preview`, body, { headers });
        setPreview(data.sample);
        setPreviewError("");
      } catch (error) {
        setPreview("");
        setPreviewError(error.response?.data?.detail || "Preview unavailable for this format");
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [numbering, headers]);

  const save = async (key, url, body, successMessage) => {
    setSaving(key);
    try {
      await axios.put(url, body, { headers });
      toast.success(successMessage);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Save failed");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" data-testid="billing-settings-loading" /></div>;
  }

  if (denied) {
    return (
      <div className="space-y-5" data-testid="billing-settings-denied">
        <OperationalPageHeader eyebrow="Billing configuration · organisation-wide" title="Billing settings" description="Invoice numbering, approval policy and tax compliance for every document Nexus issues." icon={Hash} tone="emerald" signal="attention" />
        <Card className="border-amber-400/25 bg-[linear-gradient(145deg,rgba(245,158,11,0.08),transparent_70%)]">
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Lock className="h-7 w-7 text-amber-300" />
            <p className="font-semibold">Administrator access required</p>
            <p className="text-sm text-muted-foreground">Billing settings are organisation-wide. Ask a Nexus administrator to review them.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="billing-settings-page">
      <OperationalPageHeader
        eyebrow="Billing configuration · organisation-wide"
        title="Billing settings"
        description="Invoice numbering, approval policy and AU/NZ tax compliance — the details printed on every document Nexus issues."
        icon={Hash}
        tone="emerald"
        signal="ready"
      />

      <BillingWorkspaceNav />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="numbering"><Hash className="mr-1 h-3 w-3" />Invoice numbering</TabsTrigger>
          <TabsTrigger value="approvals"><ShieldCheck className="mr-1 h-3 w-3" />Approvals</TabsTrigger>
          <TabsTrigger value="tax"><Landmark className="mr-1 h-3 w-3" />Tax &amp; compliance</TabsTrigger>
        </TabsList>

        {/* ============ Invoice numbering ============ */}
        <TabsContent value="numbering" className="space-y-4">
          <Card className="overflow-hidden rounded-2xl border border-emerald-400/20 bg-[linear-gradient(145deg,rgba(16,185,129,0.10),transparent_70%)]">
            <CardContent className="space-y-4 p-5">
              <div>
                <p className="text-sm font-semibold">Smart invoice numbering</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">The format applies to the next invoice created. Existing invoice numbers never change.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="numbering-format">Number format</Label>
                <Input
                  id="numbering-format"
                  data-testid="numbering-format"
                  value={numbering?.format || ""}
                  onChange={(e) => setNumbering({ ...numbering, format: e.target.value })}
                  className="font-mono"
                  placeholder="INV-{YYYY}-{SEQ:05d}"
                />
                <div className="flex flex-wrap gap-1.5">
                  {NUMBERING_VARS.map((variable) => (
                    <Badge
                      key={variable}
                      variant="secondary"
                      className="cursor-pointer font-mono text-[10px] hover:bg-emerald-400/15"
                      onClick={() => setNumbering({ ...numbering, format: `${numbering?.format || ""}${variable}` })}
                      data-testid={`numbering-var-${variable.replace(/[{}]/g, "")}`}
                    >
                      {variable}
                    </Badge>
                  ))}
                </div>
                <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/5 px-3 py-2.5" data-testid="numbering-preview">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-300/80">Next number will look like</p>
                  {previewError ? (
                    <p className="mt-1 text-sm text-amber-300" data-testid="numbering-preview-error">{previewError}</p>
                  ) : (
                    <p className="mt-1 font-mono text-lg font-semibold text-emerald-200" data-testid="numbering-preview-sample">{preview || "…"}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fy-start">Financial year starts</Label>
                  <Select
                    value={String(numbering?.fy_start_month ?? 7)}
                    onValueChange={(value) => setNumbering({ ...numbering, fy_start_month: Number(value) })}
                  >
                    <SelectTrigger id="fy-start" data-testid="numbering-fy-start"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((month, index) => (
                        <SelectItem key={month} value={String(index + 1)}>{month}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">Used for <span className="font-mono">{"{FY}"}</span> in the format.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="next-seq">Next sequence number</Label>
                  <Input
                    id="next-seq"
                    data-testid="numbering-next-seq"
                    type="number"
                    min="1"
                    value={numbering?.next_seq ?? 1}
                    onChange={(e) => setNumbering({ ...numbering, next_seq: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">Increments automatically with each invoice.</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Switch
                    checked={!!numbering?.client_prefix}
                    onCheckedChange={(checked) => setNumbering({ ...numbering, client_prefix: checked })}
                    data-testid="numbering-client-prefix"
                  />
                  <span className="text-sm">Include client code <span className="font-mono">{"{CLIENT}"}</span></span>
                </label>
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Switch
                    checked={!!numbering?.fy_reset}
                    onCheckedChange={(checked) => setNumbering({ ...numbering, fy_reset: checked })}
                    data-testid="numbering-fy-reset"
                  />
                  <span className="text-sm">Reset sequence each financial year</span>
                </label>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => save("numbering", `${API}/billing-pro/numbering`, {
                    ...numbering,
                    fy_start_month: Number(numbering?.fy_start_month) || 7,
                    next_seq: Number(numbering?.next_seq) || 1,
                  }, "Numbering format saved")}
                  disabled={saving === "numbering" || !!previewError}
                  data-testid="save-numbering-btn"
                >
                  {saving === "numbering" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                  Save numbering
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ Approvals ============ */}
        <TabsContent value="approvals" className="space-y-4">
          <Card className="overflow-hidden rounded-2xl border border-amber-400/20 bg-[linear-gradient(145deg,rgba(245,158,11,0.09),transparent_70%)]">
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Invoice approval policy</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Route larger invoices for a second pair of eyes before they are sent. Approval requests and decisions are written to the audit log.</p>
                </div>
                <Badge variant={approval?.enabled ? "default" : "secondary"} className="text-[10px]">
                  {approval?.enabled ? "Enforced" : "Off"}
                </Badge>
              </div>

              <div className="flex items-center gap-2.5">
                <Switch
                  checked={!!approval?.enabled}
                  onCheckedChange={(checked) => setApproval({ ...approval, enabled: checked })}
                  data-testid="approval-enabled"
                />
                <span className="text-sm">Require approval for high-value invoices</span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="approval-threshold">Approval threshold</Label>
                  <Input
                    id="approval-threshold"
                    data-testid="approval-threshold"
                    type="number"
                    min="0"
                    value={approval?.threshold ?? 5000}
                    onChange={(e) => setApproval({ ...approval, threshold: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">Invoices at or above this amount should be approved before sending.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="approver-role">Approver role</Label>
                  <Select
                    value={approval?.approver_role || "admin"}
                    onValueChange={(value) => setApproval({ ...approval, approver_role: value })}
                  >
                    <SelectTrigger id="approver-role" data-testid="approval-role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {APPROVER_ROLES.map((role) => (
                        <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">Who can approve or reject a pending invoice.</p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => save("approval", `${API}/billing-pro/settings/approval`, {
                    ...approval,
                    threshold: Number(approval?.threshold) || 0,
                  }, "Approval policy saved")}
                  disabled={saving === "approval"}
                  data-testid="save-approval-btn"
                >
                  {saving === "approval" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                  Save approval policy
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ Tax & compliance ============ */}
        <TabsContent value="tax" className="space-y-4">
          <Card className="overflow-hidden rounded-2xl border border-sky-400/20 bg-[linear-gradient(145deg,rgba(14,165,233,0.09),transparent_70%)]">
            <CardContent className="space-y-5 p-5">
              <div>
                <p className="text-sm font-semibold">Tax invoice &amp; remittance details</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">These details are printed on invoices to meet AU/NZ tax invoice requirements and on remittance advice. Nexus never exposes bank details outside billing documents.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Country</Label>
                  <Select
                    value={tax?.country || "AU"}
                    onValueChange={(value) => setTax({ ...tax, country: value })}
                  >
                    <SelectTrigger data-testid="tax-country"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AU">Australia</SelectItem>
                      <SelectItem value="NZ">New Zealand</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tax-abn">{tax?.country === "NZ" ? "NZBN / IRD number" : "ABN"}</Label>
                  <Input
                    id="tax-abn"
                    data-testid="tax-abn"
                    value={tax?.abn || ""}
                    onChange={(e) => setTax({ ...tax, abn: e.target.value })}
                    placeholder={tax?.country === "NZ" ? "12-345-678-901" : "12 345 678 901"}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gst-pct">GST rate (%)</Label>
                  <Input
                    id="gst-pct"
                    data-testid="tax-gst-pct"
                    type="number"
                    min="0"
                    max="100"
                    value={tax?.gst_pct ?? 10}
                    onChange={(e) => setTax({ ...tax, gst_pct: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Switch
                    checked={!!tax?.gst_registered}
                    onCheckedChange={(checked) => setTax({ ...tax, gst_registered: checked })}
                    data-testid="tax-gst-registered"
                  />
                  <span className="text-sm">Registered for GST</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Switch
                    checked={!!tax?.show_tax_invoice_label}
                    onCheckedChange={(checked) => setTax({ ...tax, show_tax_invoice_label: checked })}
                    data-testid="tax-invoice-label"
                  />
                  <span className="text-sm">Show &ldquo;Tax invoice&rdquo; label on documents</span>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company-name">Company name</Label>
                  <Input id="company-name" data-testid="tax-company-name" value={tax?.company_name || ""} onChange={(e) => setTax({ ...tax, company_name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-phone">Phone</Label>
                  <Input id="company-phone" data-testid="tax-company-phone" value={tax?.company_phone || ""} onChange={(e) => setTax({ ...tax, company_phone: e.target.value })} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="company-address">Business address</Label>
                  <Input id="company-address" data-testid="tax-company-address" value={tax?.company_address || ""} onChange={(e) => setTax({ ...tax, company_address: e.target.value })} />
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-muted/20 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Landmark className="h-3.5 w-3.5" /> Remittance bank details
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="bank-name">Bank</Label>
                    <Input id="bank-name" data-testid="tax-bank-name" value={tax?.bank_name || ""} onChange={(e) => setTax({ ...tax, bank_name: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bank-bsb">BSB</Label>
                    <Input id="bank-bsb" data-testid="tax-bank-bsb" value={tax?.bsb || ""} onChange={(e) => setTax({ ...tax, bsb: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bank-account-number">Account number</Label>
                    <Input id="bank-account-number" data-testid="tax-bank-account" value={tax?.account_number || ""} onChange={(e) => setTax({ ...tax, account_number: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bank-account-name">Account name</Label>
                    <Input id="bank-account-name" data-testid="tax-bank-account-name" value={tax?.account_name || ""} onChange={(e) => setTax({ ...tax, account_name: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-sky-300" />
                  Saved details apply to newly generated and re-rendered documents.
                </p>
                <Button
                  onClick={() => save("tax", `${API}/billing-pro/settings/tax-compliance`, {
                    ...tax,
                    gst_pct: Number(tax?.gst_pct) || 0,
                  }, "Tax compliance settings saved")}
                  disabled={saving === "tax"}
                  data-testid="save-tax-btn"
                >
                  {saving === "tax" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                  Save tax settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
