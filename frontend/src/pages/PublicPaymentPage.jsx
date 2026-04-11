import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  CreditCard, Building2, ArrowRightLeft, Loader2, CheckCircle, XCircle,
  Clock, Shield, FileText, ChevronDown, ChevronUp, AlertTriangle, Lock
} from "lucide-react";

const API = import.meta.env?.VITE_API_URL || process.env.REACT_APP_BACKEND_URL || "";

export default function PublicPaymentPage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [method, setMethod] = useState("card");
  const [amount, setAmount] = useState("");
  const [processing, setProcessing] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [bankForm, setBankForm] = useState({ payer_name: "", reference: "", bank_name: "" });
  const [confirming, setConfirming] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/api/pay/${token}`);
      setData(res.data);
      setAmount(String(res.data.balance));
    } catch (e) {
      setError(e.response?.data?.detail || "Payment link not found or expired");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Handle return from Stripe checkout
  useEffect(() => {
    const status = searchParams.get("payment_status");
    const sessionId = searchParams.get("session_id");
    if (status === "success" && sessionId && !confirming) {
      setConfirming(true);
      axios.get(`${API}/api/pay/${token}/confirm?session_id=${sessionId}`)
        .then(res => {
          if (res.data.status === "paid") {
            setPaymentSuccess(true);
            toast.success(`Payment of $${res.data.amount?.toFixed(2)} confirmed!`);
            fetchData();
          }
        })
        .catch(() => toast.error("Could not confirm payment"))
        .finally(() => setConfirming(false));
    }
    if (status === "cancelled") {
      toast.error("Payment was cancelled");
    }
  }, [searchParams, token, confirming, fetchData]);

  const payWithCard = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    setProcessing(true);
    try {
      const res = await axios.post(`${API}/api/pay/${token}/card`, {
        amount: amt,
        origin_url: window.location.origin,
        currency: "aud",
      });
      if (res.data.url) {
        window.location.href = res.data.url;
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to initiate payment");
      setProcessing(false);
    }
  };

  const payWithBecs = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    setProcessing(true);
    try {
      await axios.post(`${API}/api/pay/${token}/becs`, { amount: amt });
      toast.success("BECS Direct Debit initiated. Processing takes 3-5 business days.");
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to initiate BECS payment");
    } finally {
      setProcessing(false);
    }
  };

  const recordBankTransfer = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!bankForm.reference) { toast.error("Transfer reference is required"); return; }
    setProcessing(true);
    try {
      await axios.post(`${API}/api/pay/${token}/bank-transfer`, {
        amount: amt,
        ...bankForm,
      });
      toast.success("Bank transfer recorded! We'll confirm once it's received.");
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to record transfer");
    } finally {
      setProcessing(false);
    }
  };

  const handlePay = () => {
    if (method === "card") payWithCard();
    else if (method === "becs") payWithBecs();
    else if (method === "bank_transfer") recordBankTransfer();
  };

  const remaining = data ? Math.max(0, data.balance - (parseFloat(amount) || 0)) : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-red-500/30 bg-zinc-900">
          <CardContent className="pt-8 pb-8 text-center">
            <XCircle className="w-16 h-16 mx-auto mb-4 text-red-400" />
            <h2 className="text-xl font-bold text-white mb-2">Payment Unavailable</h2>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (paymentSuccess || data?.balance <= 0) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-emerald-500/30 bg-zinc-900">
          <CardContent className="pt-8 pb-8 text-center">
            <CheckCircle className="w-16 h-16 mx-auto mb-4 text-emerald-400" />
            <h2 className="text-xl font-bold text-white mb-2">Payment Complete</h2>
            <p className="text-muted-foreground mb-4">Invoice {data?.invoice_number} has been paid in full.</p>
            <p className="text-2xl font-bold text-emerald-400">${data?.total?.toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const methods = data?.allowed_methods || [];

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-4">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Lock className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-emerald-400 font-medium tracking-wider uppercase">Secure Payment</span>
          </div>
          {data?.company_name && <p className="text-sm text-muted-foreground">{data.company_name}</p>}
        </div>

        {/* Invoice Summary */}
        <Card className="border-border/40 bg-zinc-900" data-testid="payment-invoice-summary">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-400" />
                Invoice {data?.invoice_number}
              </CardTitle>
              <Badge variant="outline" className="text-xs">{data?.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Client</span>
              <span className="font-medium text-white">{data?.client_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Due Date</span>
              <span className="text-white">{data?.due_date}</span>
            </div>
            <Separator className="opacity-30" />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Invoice Total</span>
              <span className="font-mono text-white">${data?.total?.toFixed(2)}</span>
            </div>
            {data?.amount_paid > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Already Paid</span>
                <span className="font-mono text-emerald-400">-${data?.amount_paid?.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold pt-1 border-t border-border/30">
              <span>Balance Due</span>
              <span className="text-amber-400 font-mono">${data?.balance?.toFixed(2)}</span>
            </div>

            {/* Expandable line items */}
            {data?.line_items?.length > 0 && (
              <div>
                <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground h-7" onClick={() => setShowItems(!showItems)} data-testid="toggle-line-items">
                  {showItems ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
                  {showItems ? "Hide" : "View"} Line Items ({data.line_items.length})
                </Button>
                {showItems && (
                  <div className="mt-2 space-y-1.5">
                    {data.line_items.map((li, i) => (
                      <div key={i} className="flex justify-between text-xs py-1 px-2 rounded bg-zinc-800/50">
                        <span className="text-muted-foreground truncate mr-2">{li.name || li.description || "Item"}</span>
                        <span className="font-mono whitespace-nowrap">{li.quantity || 1} x ${(li.unit_price || 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Previous payments on this link */}
            {data?.payments?.length > 0 && (
              <div className="pt-2 border-t border-border/30">
                <p className="text-xs text-muted-foreground mb-1.5 font-medium">Payment History</p>
                {data.payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={p.status === "paid" ? "default" : p.status === "awaiting_confirmation" ? "outline" : "secondary"} className="text-[9px] capitalize">{p.status.replace("_", " ")}</Badge>
                      <span className="text-muted-foreground capitalize">{p.method?.replace("_", " ")}</span>
                    </div>
                    <span className="font-mono">${p.amount?.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Section */}
        <Card className="border-border/40 bg-zinc-900" data-testid="payment-methods-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Choose Payment Method</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Amount Input */}
            <div className="space-y-2">
              <Label className="text-xs">Payment Amount (AUD)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={data?.balance}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="pl-7 font-mono text-lg h-12"
                  data-testid="payment-amount-input"
                />
              </div>
              {remaining > 0.01 && parseFloat(amount) < data?.balance && (
                <div className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Remaining after this payment: <span className="font-mono font-bold">${remaining.toFixed(2)}</span> — pay the rest with another method</span>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setAmount(String(data?.balance))} data-testid="pay-full-btn">Pay Full Balance</Button>
                {data?.balance > 100 && <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setAmount(String(Math.round(data.balance / 2 * 100) / 100))}>Pay Half</Button>}
              </div>
            </div>

            <Separator className="opacity-30" />

            {/* Method Selection */}
            <div className="grid grid-cols-1 gap-2">
              {methods.includes("card") && (
                <button
                  onClick={() => setMethod("card")}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${method === "card" ? "border-blue-500 bg-blue-500/10" : "border-border/40 hover:border-border"}`}
                  data-testid="method-card"
                >
                  <CreditCard className={`w-5 h-5 ${method === "card" ? "text-blue-400" : "text-muted-foreground"}`} />
                  <div>
                    <p className={`text-sm font-medium ${method === "card" ? "text-blue-400" : "text-white"}`}>Credit / Debit Card</p>
                    <p className="text-[10px] text-muted-foreground">Visa, Mastercard, AMEX, Google Pay, Apple Pay</p>
                  </div>
                </button>
              )}
              {methods.includes("becs") && (
                <button
                  onClick={() => setMethod("becs")}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${method === "becs" ? "border-purple-500 bg-purple-500/10" : "border-border/40 hover:border-border"}`}
                  data-testid="method-becs"
                >
                  <ArrowRightLeft className={`w-5 h-5 ${method === "becs" ? "text-purple-400" : "text-muted-foreground"}`} />
                  <div>
                    <p className={`text-sm font-medium ${method === "becs" ? "text-purple-400" : "text-white"}`}>Direct Debit (BECS)</p>
                    <p className="text-[10px] text-muted-foreground">NAB, CBA, Westpac, ANZ — Australian bank accounts</p>
                  </div>
                </button>
              )}
              {methods.includes("bank_transfer") && (
                <button
                  onClick={() => setMethod("bank_transfer")}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${method === "bank_transfer" ? "border-emerald-500 bg-emerald-500/10" : "border-border/40 hover:border-border"}`}
                  data-testid="method-bank-transfer"
                >
                  <Building2 className={`w-5 h-5 ${method === "bank_transfer" ? "text-emerald-400" : "text-muted-foreground"}`} />
                  <div>
                    <p className={`text-sm font-medium ${method === "bank_transfer" ? "text-emerald-400" : "text-white"}`}>Manual Bank Transfer</p>
                    <p className="text-[10px] text-muted-foreground">Transfer via your bank and enter the reference</p>
                  </div>
                </button>
              )}
            </div>

            {/* Bank Transfer Details */}
            {method === "bank_transfer" && (
              <div className="space-y-3 pt-2">
                {data?.bank_details && (
                  <div className="p-3 rounded-lg bg-zinc-800/70 border border-border/30">
                    <p className="text-xs font-medium text-emerald-400 mb-1.5">Bank Account Details</p>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">{data.bank_details}</pre>
                  </div>
                )}
                {data?.payment_instructions && (
                  <p className="text-xs text-muted-foreground">{data.payment_instructions}</p>
                )}
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Your Name</Label>
                    <Input value={bankForm.payer_name} onChange={e => setBankForm(p => ({ ...p, payer_name: e.target.value }))} placeholder="John Smith" data-testid="bank-payer-name" />
                  </div>
                  <div>
                    <Label className="text-xs">Transfer Reference *</Label>
                    <Input value={bankForm.reference} onChange={e => setBankForm(p => ({ ...p, reference: e.target.value }))} placeholder={`e.g., ${data?.invoice_number}`} data-testid="bank-reference" />
                  </div>
                  <div>
                    <Label className="text-xs">Bank Name</Label>
                    <Input value={bankForm.bank_name} onChange={e => setBankForm(p => ({ ...p, bank_name: e.target.value }))} placeholder="e.g., NAB, Commonwealth, Westpac" data-testid="bank-name" />
                  </div>
                </div>
              </div>
            )}

            {/* BECS info */}
            {method === "becs" && (
              <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/20 text-xs text-muted-foreground">
                <p className="font-medium text-purple-400 mb-1">BECS Direct Debit</p>
                <p>Funds will be debited from your Australian bank account. Processing takes 3-5 business days. By proceeding you agree to the <a href="https://stripe.com/au-becs-dd-service-agreement/legal" target="_blank" rel="noopener" className="text-purple-400 underline">BECS Direct Debit Service Agreement</a>.</p>
              </div>
            )}

            {/* Pay Button */}
            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={handlePay}
              disabled={processing || !amount || parseFloat(amount) <= 0}
              data-testid="pay-now-btn"
            >
              {processing ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : method === "card" ? (
                <CreditCard className="w-5 h-5 mr-2" />
              ) : method === "becs" ? (
                <ArrowRightLeft className="w-5 h-5 mr-2" />
              ) : (
                <Building2 className="w-5 h-5 mr-2" />
              )}
              {processing ? "Processing..." : `Pay $${(parseFloat(amount) || 0).toFixed(2)} AUD`}
            </Button>

            <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
              <Shield className="w-3 h-3" />
              <span>Secured by Stripe. Your payment details are encrypted end-to-end.</span>
            </div>
          </CardContent>
        </Card>

        {/* Expiry Notice */}
        <div className="text-center text-[10px] text-muted-foreground">
          <Clock className="w-3 h-3 inline mr-1" />
          This link expires {data?.expires_at ? new Date(data.expires_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : "soon"}
        </div>
      </div>
    </div>
  );
}
