import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ExternalLink,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";

import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import { NEXUS_PRODUCTS, NEXUS_PRODUCT_CATEGORIES, NEXUS_STORE_COLLECTIONS } from "@/config/nexusProducts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TONES = {
  cyan: "border-cyan-500/25 bg-cyan-500/[0.045] text-cyan-200",
  sky: "border-sky-500/25 bg-sky-500/[0.045] text-sky-200",
  emerald: "border-emerald-500/25 bg-emerald-500/[0.045] text-emerald-200",
  amber: "border-amber-500/25 bg-amber-500/[0.045] text-amber-200",
  violet: "border-violet-500/25 bg-violet-500/[0.045] text-violet-200",
};

function deliveryBadge(product) {
  return product.delivery === "provider"
    ? { label: "Provider-backed", className: "border-amber-500/30 bg-amber-500/10 text-amber-100" }
    : { label: "Nexus native", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" };
}

function ProductCard({ product, evidence, loading }) {
  const Icon = product.icon;
  const badge = deliveryBadge(product);
  const tone = TONES[product.tone] || TONES.cyan;
  return (
    <Card className="group flex h-full flex-col overflow-hidden border-border/80 bg-card/75 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-500/30 hover:shadow-[0_18px_55px_-32px_rgba(34,211,238,0.65)]" data-testid={`suite-product-${product.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${tone}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{product.name}</CardTitle>
              <Badge variant="outline" className={`text-[9px] uppercase tracking-[0.12em] ${badge.className}`}>{badge.label}</Badge>
            </div>
            <CardDescription className="mt-1 text-xs">{product.strapline}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="text-xs leading-5 text-muted-foreground">{product.description}</p>
        <div className="flex flex-wrap gap-1.5">
          {product.capabilities.map((capability) => (
            <span key={capability} className="rounded-full border border-border/80 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">{capability}</span>
          ))}
        </div>
        {product.boundary && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.045] px-3 py-2 text-[10px] leading-4 text-amber-100/80">
            <ShieldCheck className="mr-1.5 inline h-3 w-3" />{product.boundary}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/70 pt-3">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {evidence?.label || (loading ? "Loading evidence" : "Evidence status")}
            </p>
            <p className="truncate text-xs text-foreground">
              {evidence?.value ?? (loading ? "Checking…" : "Not verified")}
            </p>
          </div>
          <Button size="sm" variant="outline" asChild className="shrink-0">
            <Link to={product.route} aria-label={`Open ${product.name}`}>Open <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StoreCollectionCard({ collection }) {
  const Icon = collection.icon;
  return (
    <Card className="border-border/80 bg-card/70 transition hover:border-cyan-500/30" data-testid={`store-collection-${collection.id}`}>
      <CardHeader>
        <div className={`mb-2 flex h-10 w-10 items-center justify-center rounded-xl border ${TONES[collection.tone] || TONES.cyan}`}>
          <Icon className="h-4 w-4" />
        </div>
        <CardTitle className="text-base">{collection.title}</CardTitle>
        <CardDescription className="text-xs leading-5">{collection.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" asChild className="w-full justify-between">
          <Link to={collection.route} aria-label={`Browse ${collection.title}`}>Browse collection <ExternalLink className="h-3.5 w-3.5" /></Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function NexusSuitePage() {
  const { token } = useAuth();
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState("All products");
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState({});
  const [evidenceError, setEvidenceError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const view = params.get("view") === "store" ? "store" : "products";

  const loadEvidence = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/suite/overview`, { headers: { Authorization: `Bearer ${token}` } });
      setEvidence(response.data?.evidence || {});
      setEvidenceError("");
      setLastUpdatedAt(new Date());
    } catch {
      // Keep the last verified snapshot visible, but never present an unknown
      // value as live evidence while the API is unavailable.
      setEvidenceError("Live product evidence is temporarily unavailable. Workspace links remain available, but the figures below may be stale.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadEvidence(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return NEXUS_PRODUCTS.filter((product) => {
      const categoryMatch = category === "All products" || product.category === category;
      const searchText = [product.name, product.strapline, product.description, product.category, ...product.capabilities].join(" ").toLowerCase();
      return categoryMatch && (!term || searchText.includes(term));
    });
  }, [category, query]);

  const nativeCount = NEXUS_PRODUCTS.filter((product) => product.delivery === "native").length;
  const providerCount = NEXUS_PRODUCTS.filter((product) => product.delivery === "provider").length;
  const categories = new Set(NEXUS_PRODUCTS.map((product) => product.category)).size;

  return (
    <div className="space-y-5 p-6" data-testid="nexus-suite-page">
      <OperationalPageHeader
        eyebrow="One identity · specialised products"
        title="Nexus Suite"
        description="Every Nexus product can stand on its own, while shared client context, audit history, automation and design make the complete suite far more powerful together."
        icon={Boxes}
        tone="sky"
        actions={<>
          <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/[0.08] text-cyan-100"><Sparkles className="mr-1.5 h-3.5 w-3.5" />Unified operations fabric</Badge>
          <Button variant="outline" size="sm" asChild><Link to="/help/nexus-suite-product-map">Product guide</Link></Button>
          <Button variant="outline" size="sm" onClick={loadEvidence} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </>}
      />

      {evidenceError && (
        <Card className="border-amber-500/25 bg-amber-500/[0.045]" role="status" data-testid="suite-evidence-warning">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div>
                <p className="text-xs font-semibold text-amber-100">Evidence refresh needs attention</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{evidenceError}</p>
                {lastUpdatedAt && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Last verified {lastUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={loadEvidence} disabled={loading} className="shrink-0">
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Try again
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroTile label="Nexus products" value={NEXUS_PRODUCTS.length} icon={Boxes} glow="cyan" subtitle="One coherent suite" />
        <HeroTile label="Nexus native" value={nativeCount} icon={CheckCircle2} glow="emerald" subtitle="Built into the platform" />
        <HeroTile label="Provider-backed" value={providerCount} icon={ShieldCheck} glow="amber" subtitle="Keeper, Hudu & Microsoft" />
        <HeroTile label="Product families" value={categories} icon={Network} glow="violet" subtitle="Clear operational ownership" />
      </div>

      <Tabs value={view} onValueChange={(next) => setParams(next === "store" ? { view: "store" } : {}, { replace: true })} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/40 p-1">
          <TabsTrigger value="products"><Boxes className="mr-1.5 h-3.5 w-3.5" />Product map</TabsTrigger>
          <TabsTrigger value="store"><Store className="mr-1.5 h-3.5 w-3.5" />Nexus Store</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-4">
          <Card className="border-cyan-500/20 bg-gradient-to-r from-cyan-500/[0.055] via-card to-violet-500/[0.04]">
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a Nexus product or capability"
                  className="h-10 border-cyan-500/20 bg-black/15 pl-9"
                  data-testid="suite-search-input"
                />
              </div>
              <div className="flex max-w-full flex-wrap gap-1.5">
                {NEXUS_PRODUCT_CATEGORIES.map((item) => (
                  <Button
                    key={item}
                    size="sm"
                    variant={category === item ? "default" : "outline"}
                    onClick={() => setCategory(item)}
                    aria-pressed={category === item}
                    className="whitespace-nowrap text-xs"
                  >
                    {item}
                  </Button>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-border/60 pt-3 text-[10px] text-muted-foreground">
                <span>Showing {filtered.length} of {NEXUS_PRODUCTS.length} products</span>
                {(query || category !== "All products") && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => {
                      setQuery("");
                      setCategory("All products");
                    }}
                  >
                    Reset filters
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((product) => <ProductCard key={product.id} product={product} evidence={evidence[product.id]} loading={loading} />)}
          </div>

          {!filtered.length && (
            <Card><CardContent className="py-14 text-center"><Search className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No matching Nexus products</p><p className="mt-1 text-xs text-muted-foreground">Try another capability or product family.</p></CardContent></Card>
          )}

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="border-cyan-500/20 bg-cyan-500/[0.03]">
              <CardHeader><CardTitle className="text-sm">Shared client graph</CardTitle><CardDescription className="text-xs leading-5">Clients, users, devices, services, tickets, contracts and evidence keep the same identity across every product.</CardDescription></CardHeader>
            </Card>
            <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
              <CardHeader><CardTitle className="text-sm">One accountable timeline</CardTitle><CardDescription className="text-xs leading-5">Actions, approvals, provider results and changes remain attributable and auditable instead of being scattered between portals.</CardDescription></CardHeader>
            </Card>
            <Card className="border-violet-500/20 bg-violet-500/[0.03]">
              <CardHeader><CardTitle className="text-sm">Open by design</CardTitle><CardDescription className="text-xs leading-5">Versioned connectors and compatibility routes let products evolve without breaking established technician workflows.</CardDescription></CardHeader>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="store" className="space-y-4">
          <Card className="overflow-hidden border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] via-card to-cyan-500/[0.04]">
            <CardContent className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Governed capability catalogue</p>
                <h2 className="mt-1 text-xl font-semibold">Extend NexusMSP without fragmenting it</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Nexus Store brings connectors, automation packs, script libraries and commercial products into one discoverable surface. Installation never implies a provider is configured or healthy; each connection must still be validated.</p>
              </div>
              <Button asChild><Link to="/integrations"><Store className="mr-1.5 h-4 w-4" />Review connections</Link></Button>
            </CardContent>
          </Card>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {NEXUS_STORE_COLLECTIONS.map((collection) => <StoreCollectionCard key={collection.id} collection={collection} />)}
          </div>
          <Card className="border-amber-500/20 bg-amber-500/[0.035]">
            <CardContent className="flex gap-3 p-4 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <span><strong className="text-foreground">Trust rule:</strong> store entries declare permissions, data boundaries, approvals and rollback behaviour before installation. Secrets remain in approved provider systems and are never exposed in catalogue metadata.</span>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
