import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import SavedCardChargeDialog from "@/components/billing/SavedCardChargeDialog";
import { toast } from "sonner";
import {
  AlertCircle, CreditCard, Loader2, Lock, Plus, RefreshCw, Star, Trash2, Wallet,
} from "lucide-react";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  cardBrandLabel as brandLabel,
  cardExpiryLabel as expiryLabel,
  chargeableInvoices,
  defaultPaymentMethod,
} from "@/lib/savedCardPayment";

/**
 * Saved customer cards for one client.
 *
 * Nexus never renders or accepts a card number: capture happens on a
 * Stripe-hosted session, and this panel only shows the masked reference the
 * API returns. Charging settles nothing by itself — the signed provider
 * webhook credits the invoice — so the copy here reports a request, not a
 * payment.
 */
export default function ClientPaymentMethodsPanel({ clientId, token, invoices = [] }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [methods, setMethods] = useState([]);
  const [stripeConfigured, setStripeConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [chargeOpen, setChargeOpen] = useState(false);

  const base = `${API}/clients/${encodeURIComponent(clientId)}/payment-methods`;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await axios.get(base, { headers });
      setMethods(response.data?.methods || []);
      setStripeConfigured(response.data?.stripe_configured !== false);
    } catch (error) {
      if (error?.response?.status === 403) {
        setMethods([]);
        setStripeConfigured(false);
        setLoadError("Your role cannot view saved cards for this client. Ask an administrator for the billing payment-method permission.");
      } else {
        setLoadError(apiErrorMessage(error, "Saved cards could not be loaded. Nothing has been changed."));
      }
    } finally {
      setLoading(false);
    }
  }, [base, headers]);

  useEffect(() => { load(); }, [load]);

  const clearSetupParams = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("pm_setup");
      next.delete("session_id");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Stripe redirects the technician back here after capture. The browser only
  // returns a session id; the API re-reads the session from Stripe and proves
  // it belongs to this client before anything is stored.
  useEffect(() => {
    const outcome = searchParams.get("pm_setup");
    const sessionId = searchParams.get("session_id") || "";
    if (!outcome) return;
    if (outcome === "cancelled") {
      clearSetupParams();
      toast.info("Card capture cancelled — no card was saved.");
      return;
    }
    if (outcome !== "complete" || !sessionId) return;
    let active = true;
    setAdding(true);
    axios.post(`${base}/complete`, { session_id: sessionId }, { headers })
      .then((response) => {
        if (!active) return;
        const method = response.data?.method;
        toast.success(method ? `${brandLabel(method.brand)} •••• ${method.last4} saved for this client` : "Card saved for this client");
        setMethods(response.data?.methods || []);
      })
      .catch((error) => {
        if (active) toast.error(apiErrorMessage(error, "The card could not be saved. Nothing has been changed."));
      })
      .finally(() => {
        if (!active) return;
        setAdding(false);
        clearSetupParams();
        load();
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const startCapture = async () => {
    setAdding(true);
    try {
      const response = await axios.post(`${base}/setup`, {}, { headers });
      if (!response.data?.url) throw new Error("no url");
      window.location.assign(response.data.url);
    } catch (error) {
      setAdding(false);
      toast.error(apiErrorMessage(error, "Stripe could not start the secure card capture."));
    }
  };

  const makeDefault = async (method) => {
    setBusyId(method.id);
    try {
      const response = await axios.post(`${base}/${encodeURIComponent(method.id)}/default`, {}, { headers });
      setMethods(response.data?.methods || []);
      toast.success(`${brandLabel(method.brand)} •••• ${method.last4} is now the default card`);
    } catch (error) {
      toast.error(apiErrorMessage(error, "The default card could not be changed."));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!confirmRemove) return;
    setBusyId(confirmRemove.id);
    try {
      const response = await axios.delete(`${base}/${encodeURIComponent(confirmRemove.id)}`, { headers });
      setMethods(response.data?.methods || []);
      toast.success("Card removed from this client");
      setConfirmRemove(null);
    } catch (error) {
      toast.error(apiErrorMessage(error, "The card could not be removed."));
    } finally {
      setBusyId(null);
    }
  };

  const chargeable = useMemo(() => chargeableInvoices(invoices), [invoices]);
  const defaultMethod = useMemo(() => defaultPaymentMethod(methods), [methods]);

  return (
    <article className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm" data-testid="client-payment-methods">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-violet-400/20 bg-violet-400/[0.06] p-2 text-violet-200"><Wallet className="h-4 w-4" /></span>
          <div>
            <p className="text-sm font-semibold">Saved cards</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Charge a customer card against their invoices without re-keying it.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading} data-testid="payment-methods-refresh">
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button size="sm" onClick={startCapture} disabled={adding || loading || !stripeConfigured} data-testid="payment-method-add">
            {adding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}Add card
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-xl border border-border/60 bg-muted/[0.1] px-3 py-2 text-[11px] leading-5 text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
        <span>Card details are captured on a Stripe-hosted page and never reach Nexus. Nexus stores only the brand, last four digits and expiry.</span>
      </div>

      {!stripeConfigured && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5 text-xs leading-5 text-amber-100" data-testid="payment-methods-not-configured">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Stripe is not configured, so cards cannot be saved yet. Add the Stripe secret key in Settings, then reload this panel.</span>
        </div>
      )}

      {loadError && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[0.04] px-3 py-2.5 text-xs leading-5 text-rose-100" data-testid="payment-methods-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <div className="mt-4 flex items-center justify-center rounded-xl border border-border/60 py-8 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />Reading saved cards…
        </div>
      ) : methods.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border/70 p-6 text-center" data-testid="payment-methods-empty">
          <CreditCard className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 font-medium">No card is saved for this client.</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
            Save a card once and staff can collect against invoices without asking the customer to pay a link every time.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {methods.map((method) => (
            <div key={method.id} className="rounded-xl border border-border/65 bg-muted/[0.1] p-3" data-testid={`payment-method-${method.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <CreditCard className="h-4 w-4 shrink-0 text-violet-200" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{brandLabel(method.brand)} •••• {method.last4}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{expiryLabel(method)}{method.wallet ? ` · ${method.wallet}` : ""}</p>
                  </div>
                </div>
                {method.is_default && <Badge variant="outline" className="border-emerald-400/25 text-emerald-200"><Star className="mr-1 h-3 w-3" />Default</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {!method.is_default && (
                  <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => makeDefault(method)} disabled={busyId === method.id} data-testid={`payment-method-default-${method.id}`}>
                    {busyId === method.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Star className="mr-1.5 h-3.5 w-3.5" />}Make default
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs text-rose-300 hover:bg-rose-500/10 hover:text-rose-200" onClick={() => setConfirmRemove(method)} disabled={busyId === method.id} data-testid={`payment-method-remove-${method.id}`}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <div className="text-xs text-muted-foreground">
          {defaultMethod
            ? <>Charges use <span className="font-medium text-foreground">{brandLabel(defaultMethod.brand)} •••• {defaultMethod.last4}</span> unless another card is set as default.</>
            : "Save a card to collect payments against invoices."}
        </div>
        <Button size="sm" variant="outline" onClick={() => setChargeOpen(true)} disabled={!defaultMethod || chargeable.length === 0} data-testid="payment-method-charge-open">
          <CreditCard className="mr-1.5 h-3.5 w-3.5" />Collect a payment
        </Button>
      </div>
      {defaultMethod && chargeable.length === 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">There is no outstanding invoice balance to collect right now.</p>
      )}

      <Dialog open={Boolean(confirmRemove)} onOpenChange={(open) => { if (!open) setConfirmRemove(null); }}>
        <NexusWorkflowDialog
          eyebrow="Customer payment method"
          title="Remove this saved card?"
          description="The card is detached at Stripe and can no longer be charged from Nexus. Records of payments already taken are not affected."
          icon={Trash2}
          tone="rose"
          className="max-w-md"
          data-testid="payment-method-remove-dialog"
          footer={<><Button variant="outline" onClick={() => setConfirmRemove(null)} disabled={busyId === confirmRemove?.id}>Cancel</Button><Button variant="destructive" onClick={remove} disabled={busyId === confirmRemove?.id} data-testid="payment-method-remove-confirm">{busyId === confirmRemove?.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}Remove card</Button></>}
        >
          <p className="text-sm text-muted-foreground">
            {confirmRemove ? `${brandLabel(confirmRemove.brand)} •••• ${confirmRemove.last4} will be removed from this client.` : ""}
          </p>
        </NexusWorkflowDialog>
      </Dialog>

      <SavedCardChargeDialog
        open={chargeOpen}
        onOpenChange={setChargeOpen}
        base={base}
        headers={headers}
        invoices={invoices}
        methods={methods}
        onAddCard={startCapture}
        onCharged={load}
      />
    </article>
  );
}
