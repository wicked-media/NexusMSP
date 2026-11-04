import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

// Billing Pro was consolidated into the relevant workspaces: invoice
// numbering, approval policy and tax compliance live under Billing settings,
// purchase orders on Purchase orders, and product bulk import on Products.
// The parked panel code that used to live here was unreachable behind this
// redirect and has been removed; it remains available in git history.
export default function BillingProPage() {
  const navigate = useNavigate();
  useEffect(() => {
    toast.info("Billing Pro has been consolidated into the relevant workspaces.");
    navigate("/billing-dashboard", { replace: true });
  }, [navigate]);
  return null;
}
