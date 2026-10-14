import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, CreditCard, Loader2, Lock, Plus, Star } from "lucide-react";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  cardBrandLabel,
  cardExpiryLabel,
  chargeableInvoices,
  defaultPaymentMethod,
  formatMoney,
  invoiceBalance,
  suggestedChargeAmount,
} from "@/lib/savedCardPayment";

/**
 * Charge a saved customer card against an invoice.
 *
 * One implementation for both places a technician collects money: the client's
 * Billing tab, where they choose which of that client's invoices to settle, and
 * the invoice workspace, where the invoice is already decided. Callers either
 * pass the invoices to choose from or lock a single invoice with `invoice`.
 *
 * Nexus never holds, renders or accepts card data — the card is chosen from the
 * masked references the API returns. A charge is a *request*: the invoice is
 * credited only by the signature-verified provider webhook, so a successful API
 * response reports "processing", and a bank that demands authentication is
 * reported honestly instead of being shown as paid.
 */
export default function SavedCardChargeDialog({
  open,
  onOpenChange,
  base,
  headers,
  clientName = "",
  invoice = null,
  invoices = [],
  methods: providedMethods = null,
  onAddCard,
  onCharged,
}) {
  const [cards, setCards] = useState(providedMethods || []);
  const [stripeConfigured, setStripeConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState(null);

  // A card charge can only be requested against an invoice the UI has already
  // proven chargeable, using the same rule the API enforces.
  const candidates = useMemo(
    () => (invoice ? [invoice] : chargeableInvoices(invoices)),
    [invoice, invoices],
  );

  const loadCards = useCallback(async () => {
    if (providedMethods) {
      setCards(providedMethods);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const response = await axios.get(base, { headers });
      setCards(response.data?.methods || []);
      setStripeConfigured(response.data?.stripe_configured !== false);
    } catch (error) {
      if (error?.response?.status === 403) {
        setCards([]);
        setStripeConfigured(false);
        setLoadError("Your role cannot view saved cards for this client. Ask an administrator for the billing payment-method permission.");
      } else {
        setLoadError(apiErrorMessage(error, "Saved cards could not be loaded. Nothing has been changed."));
      }
    } finally {
      setLoading(false);
    }
  }, [base, headers, providedMethods]);

  // Reset only when the dialog opens. Refreshing the client's invoice list while
  // it is open must not overwrite an amount the technician has typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const preset = invoice || candidates[0] || null;
      setOutcome(null);
      setInvoiceId(preset?.id || "");
      setAmount(preset ? suggestedChargeAmount(preset) : "");
      loadCards();
    }
    wasOpen.current = open;
  }, [open, invoice, candidates, loadCards]);

  useEffect(() => {
    if (!open) return;
    setSelectedId((current) => (
      cards.some((card) => card.id === current) ? current : (defaultPaymentMethod(cards)?.id || "")
    ));
  }, [open, cards]);

  const selectedInvoice = useMemo(
    () => candidates.find((item) => item.id === invoiceId) || null,
    [candidates, invoiceId],
  );
  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedId) || defaultPaymentMethod(cards),
    [cards, selectedId],
  );

  const submit = async () => {
    if (!selectedCard) {
      toast.error("Save a card before collecting a payment.");
      return;
    }
    if (!invoiceId) {
      toast.error("Choose the invoice this card payment is for.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await axios.post(
        `${base}/${encodeURIComponent(selectedCard.id)}/charge`,
        { invoice_id: invoiceId, amount: amount ? Number(amount) : undefined },
        { headers },
      );
      setOutcome(response.data || {});
      toast.success(response.data?.message || "Card charge submitted");
      onCharged?.(response.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, "The saved card could not be charged. No payment was recorded."));
    } finally {
      setSubmitting(false);
    }
  };

  const requiresAuthentication = String(outcome?.status || "") === "requires_action";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange?.(next); }}>
      <NexusWorkflowDialog
        eyebrow="Customer payment"
        title="Charge the saved card"
        description="Nexus requests the charge now. The invoice is credited only once the provider's signed confirmation matches this charge."
        icon={CreditCard}
        tone="violet"
        className="max-w-xl"
        data-testid="saved-card-charge-dialog"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange?.(false)} disabled={submitting}>
              {outcome ? "Close" : "Cancel"}
            </Button>
            {!outcome && (
              <Button onClick={submit} disabled={submitting || loading || !selectedCard || !invoiceId} data-testid="saved-card-charge-submit">
                {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1.5 h-4 w-4" />}
                Charge card
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center rounded-xl border border-border/60 py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />Reading saved cards…
            </div>
          ) : loadError ? (
            <div className="flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[0.04] px-3 py-2.5 text-xs leading-5 text-rose-100" data-testid="saved-card-charge-error">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{loadError}</span>
            </div>
          ) : cards.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 p-5 text-center" data-testid="saved-card-charge-empty">
              <CreditCard className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-3 font-medium">No card is saved for {clientName || "this client"}.</p>
              <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                Save a card once and staff can collect against invoices without asking the customer to pay a fresh link every time.
              </p>
              {onAddCard && (
                <Button size="sm" variant="outline" className="mt-3" onClick={onAddCard} data-testid="saved-card-charge-add">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />Save a card
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <Label>Charge which card?</Label>
              <div className="grid gap-2" role="radiogroup" aria-label="Saved card">
                {cards.map((card) => {
                  const active = selectedCard?.id === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSelectedId(card.id)}
                      disabled={submitting || Boolean(outcome)}
                      data-testid={`saved-card-charge-card-${card.id}`}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? "border-violet-400/50 bg-violet-500/[0.10]" : "border-border/65 bg-muted/[0.1] hover:border-border"}`}
                    >
                      <CreditCard className={`h-4 w-4 shrink-0 ${active ? "text-violet-200" : "text-muted-foreground"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{cardBrandLabel(card.brand)} •••• {card.last4}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{cardExpiryLabel(card)}</span>
                      </span>
                      {card.is_default && <Badge variant="outline" className="border-emerald-400/25 text-emerald-200"><Star className="mr-1 h-3 w-3" />Default</Badge>}
                    </button>
                  );
                })}
              </div>
              {!stripeConfigured && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-xs leading-5 text-amber-100">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Stripe is not configured, so a charge cannot be sent yet. Add the Stripe secret key in Settings.</span>
                </p>
              )}
            </div>
          )}

          {/* Close the loop on which invoice is being settled. When the invoice
              workspace opened this dialog the invoice is already decided, and
              showing a one-option picker would imply a choice that is not there. */}
          {invoice ? (
            <div className="rounded-xl border border-border/65 bg-muted/[0.1] px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Invoice</p>
              <p className="mt-1 font-mono text-sm font-semibold">{invoice.invoice_number || invoice.id}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Outstanding balance {formatMoney(invoiceBalance(invoice), invoice.currency)}
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="saved-card-invoice">Invoice</Label>
              <Select
                value={invoiceId}
                onValueChange={(value) => {
                  setInvoiceId(value);
                  const next = candidates.find((item) => item.id === value);
                  setAmount(next ? suggestedChargeAmount(next) : "");
                }}
              >
                <SelectTrigger id="saved-card-invoice" data-testid="saved-card-charge-invoice"><SelectValue placeholder="Choose an outstanding invoice" /></SelectTrigger>
                <SelectContent>
                  {candidates.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.invoice_number || item.id} · {formatMoney(invoiceBalance(item), item.currency)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="saved-card-amount">Amount</Label>
            <Input
              id="saved-card-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={submitting || Boolean(outcome)}
              data-testid="saved-card-charge-amount"
            />
            <p className="text-[11px] text-muted-foreground">
              {selectedInvoice
                ? `Outstanding balance ${formatMoney(invoiceBalance(selectedInvoice), selectedInvoice.currency)}. Nexus rejects an amount above the balance.`
                : "Choose an invoice to see its outstanding balance."}
            </p>
          </div>

          {outcome && (
            <div
              className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-5 ${requiresAuthentication ? "border-amber-400/25 bg-amber-400/[0.06] text-amber-100" : "border-emerald-400/25 bg-emerald-400/[0.05] text-emerald-100"}`}
              data-testid="saved-card-charge-outcome"
            >
              {requiresAuthentication ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>
                {requiresAuthentication
                  ? "The customer's bank requires authentication, so the card was not charged. Send a payment link so they can approve it — nothing has been credited to this invoice."
                  : "The charge was sent. This invoice is credited only when the provider confirms the payment, so it still shows its outstanding balance until then."}
              </span>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/[0.1] px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
            <span>Card details are captured on a provider-hosted page and never reach Nexus. Nexus stores only the brand, last four digits and expiry.</span>
          </div>
        </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}
