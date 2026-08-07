import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Loader2, Upload, Image, Palette, FileText, Receipt, Shield, Save, Eye
} from "lucide-react";

const LogoUploader = ({ label, logoUrl, logoType, apiBase, headers, onUpload }) => {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await axios.post(`${apiBase}?logo_type=${logoType}`, formData, {
        headers: { ...headers, "Content-Type": "multipart/form-data" },
      });
      toast.success(`${label} uploaded`);
      onUpload(res.data.url);
    } catch { toast.error(`Failed to upload ${label}`); }
    finally { setUploading(false); }
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm">{label}</Label>
      <div className="flex items-center gap-3">
        <div className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center bg-muted/30 overflow-hidden cursor-pointer"
          onClick={() => inputRef.current?.click()}>
          {logoUrl ? (
            <img src={logoUrl.startsWith("http") ? logoUrl : logoUrl.startsWith("/api/") ? logoUrl : `${API}${logoUrl}`} alt={label} className="w-full h-full object-contain" />
          ) : (
            <Image className="w-8 h-8 text-muted-foreground/30" />
          )}
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
            Upload
          </Button>
          <p className="text-[10px] text-muted-foreground mt-1">PNG, JPG, SVG. Max 5MB</p>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
    </div>
  );
};

export default function WhiteLabelPage() {
  const { token } = useAuth();
  const [branding, setBranding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchBranding = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/settings/branding`, { headers });
      setBranding(res.data);
    } catch { toast.error("Failed to fetch branding"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchBranding(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/settings/branding`, branding, { headers });
      toast.success("Branding settings saved");
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  };

  if (loading || !branding) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="whitelabel-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">White Label & Branding</h1>
          <p className="text-muted-foreground">Customize your brand across invoices, contracts, and letterheads</p>
        </div>
        <Button onClick={handleSave} disabled={saving} data-testid="save-branding-btn">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save All Settings
        </Button>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="grid grid-cols-4 w-full max-w-xl">
          <TabsTrigger value="general"><Palette className="w-3 h-3 mr-1" />General</TabsTrigger>
          <TabsTrigger value="invoices"><Receipt className="w-3 h-3 mr-1" />Invoices</TabsTrigger>
          <TabsTrigger value="contracts"><FileText className="w-3 h-3 mr-1" />Contracts</TabsTrigger>
          <TabsTrigger value="letterhead"><Shield className="w-3 h-3 mr-1" />Letterhead</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Company Identity</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Company Name</Label>
                  <Input value={branding.company_name} onChange={e => setBranding({ ...branding, company_name: e.target.value })} data-testid="branding-company-name" />
                </div>
                <LogoUploader label="Company Logo" logoUrl={branding.company_logo_url} logoType="company"
                  apiBase={`${API}/settings/branding/upload-logo`} headers={headers}
                  onUpload={url => setBranding({ ...branding, company_logo_url: url })} />
                <LogoUploader label="Company Icon (Square)" logoUrl={branding.company_icon_url} logoType="icon"
                  apiBase={`${API}/settings/branding/upload-logo`} headers={headers}
                  onUpload={url => setBranding({ ...branding, company_icon_url: url })} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Brand Colors</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Primary</Label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={branding.primary_color} onChange={e => setBranding({ ...branding, primary_color: e.target.value })} className="w-10 h-10 rounded cursor-pointer border-0" />
                      <Input value={branding.primary_color} onChange={e => setBranding({ ...branding, primary_color: e.target.value })} className="font-mono text-xs" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Secondary</Label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={branding.secondary_color} onChange={e => setBranding({ ...branding, secondary_color: e.target.value })} className="w-10 h-10 rounded cursor-pointer border-0" />
                      <Input value={branding.secondary_color} onChange={e => setBranding({ ...branding, secondary_color: e.target.value })} className="font-mono text-xs" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Accent</Label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={branding.accent_color} onChange={e => setBranding({ ...branding, accent_color: e.target.value })} className="w-10 h-10 rounded cursor-pointer border-0" />
                      <Input value={branding.accent_color} onChange={e => setBranding({ ...branding, accent_color: e.target.value })} className="font-mono text-xs" />
                    </div>
                  </div>
                </div>
                {/* Preview */}
                <Separator />
                <div className="p-4 rounded-lg border" style={{ borderColor: branding.primary_color + "40" }}>
                  <div className="flex items-center gap-3 mb-3">
                    {branding.company_logo_url && <img src={`${API}${branding.company_logo_url}`} alt="logo" className="h-8 object-contain" />}
                    <span className="font-bold" style={{ color: branding.primary_color }}>{branding.company_name}</span>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-8 px-4 rounded flex items-center text-white text-sm font-medium" style={{ background: branding.primary_color }}>Primary</div>
                    <div className="h-8 px-4 rounded flex items-center text-white text-sm font-medium" style={{ background: branding.secondary_color }}>Secondary</div>
                    <div className="h-8 px-4 rounded flex items-center text-white text-sm font-medium" style={{ background: branding.accent_color }}>Accent</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="invoices" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Invoice Branding</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <LogoUploader label="Invoice Logo" logoUrl={branding.invoice_logo_url} logoType="invoice"
                apiBase={`${API}/settings/branding/upload-logo`} headers={headers}
                onUpload={url => setBranding({ ...branding, invoice_logo_url: url })} />
              <div className="space-y-2">
                <Label>Invoice Header Text</Label>
                <Textarea value={branding.invoice_header_text} onChange={e => setBranding({ ...branding, invoice_header_text: e.target.value })} placeholder="Company address, tax info, etc." rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Invoice Footer Text</Label>
                <Textarea value={branding.invoice_footer_text} onChange={e => setBranding({ ...branding, invoice_footer_text: e.target.value })} placeholder="Payment terms, bank details, etc." rows={2} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Show Customer Logo on Invoices</p>
                  <p className="text-xs text-muted-foreground">Display the client's logo alongside yours</p>
                </div>
                <Switch checked={branding.show_customer_logo_on_invoices} onCheckedChange={v => setBranding({ ...branding, show_customer_logo_on_invoices: v })} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contracts" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Contract Branding</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <LogoUploader label="Contract Logo" logoUrl={branding.contract_logo_url} logoType="contract"
                apiBase={`${API}/settings/branding/upload-logo`} headers={headers}
                onUpload={url => setBranding({ ...branding, contract_logo_url: url })} />
              <div className="space-y-2">
                <Label>Contract Header Text</Label>
                <Textarea value={branding.contract_header_text} onChange={e => setBranding({ ...branding, contract_header_text: e.target.value })} placeholder="Legal company name, registration number, etc." rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Contract Footer Text</Label>
                <Textarea value={branding.contract_footer_text} onChange={e => setBranding({ ...branding, contract_footer_text: e.target.value })} placeholder="Terms, signatures section, etc." rows={2} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Show Customer Logo on Contracts</p>
                  <p className="text-xs text-muted-foreground">Print both company logos on contract documents</p>
                </div>
                <Switch checked={branding.show_customer_logo_on_contracts} onCheckedChange={v => setBranding({ ...branding, show_customer_logo_on_contracts: v })} />
              </div>
              {/* Preview */}
              <Separator />
              <div className="p-6 rounded-lg border bg-white/5">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    {branding.contract_logo_url ? <img src={`${API}${branding.contract_logo_url}`} alt="Contract Logo" className="h-10 object-contain" /> : <div className="w-10 h-10 rounded bg-muted flex items-center justify-center"><FileText className="w-5 h-5 text-muted-foreground" /></div>}
                    <div>
                      <p className="font-bold text-sm">{branding.company_name}</p>
                      <p className="text-[10px] text-muted-foreground">{branding.contract_header_text || "Your company details"}</p>
                    </div>
                  </div>
                  {branding.show_customer_logo_on_contracts && (
                    <div className="text-right">
                      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center ml-auto"><Eye className="w-5 h-5 text-muted-foreground" /></div>
                      <p className="text-[10px] text-muted-foreground mt-1">Client Logo</p>
                    </div>
                  )}
                </div>
                <div className="border-t pt-3 text-[10px] text-muted-foreground text-center">
                  {branding.contract_footer_text || "Contract footer will appear here"}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="letterhead" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Letterhead Template</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <LogoUploader label="Letterhead Logo" logoUrl={branding.letterhead_logo_url} logoType="letterhead"
                apiBase={`${API}/settings/branding/upload-logo`} headers={headers}
                onUpload={url => setBranding({ ...branding, letterhead_logo_url: url })} />
              <div className="space-y-2">
                <Label>Header Content</Label>
                <Textarea value={branding.letterhead_header} onChange={e => setBranding({ ...branding, letterhead_header: e.target.value })} placeholder="Company name, address, phone, website" rows={3} />
              </div>
              <div className="space-y-2">
                <Label>Footer Content</Label>
                <Textarea value={branding.letterhead_footer} onChange={e => setBranding({ ...branding, letterhead_footer: e.target.value })} placeholder="Registration details, legal notices" rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Email Signature HTML</Label>
                <Textarea value={branding.email_signature_html} onChange={e => setBranding({ ...branding, email_signature_html: e.target.value })} placeholder="<p>Your Name</p><p>Company</p>" rows={3} className="font-mono text-xs" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
