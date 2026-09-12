import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BellOff,
  Calculator,
  CheckCircle,
  CreditCard,
  FileText,
  Globe,
  Layers3,
  Scale,
  Snowflake,
  Target,
  Receipt,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";

// Secondary workspace destinations belong here rather than being recreated in
// every page header. This keeps the header grammar predictable: one primary
// action and one clearly named More menu for related work.
export const workspaceTools = Object.freeze({
  changeManagement: [
    { path: "/change-freezes", label: "Change freeze calendar", icon: Snowflake, tone: "sky" },
    { path: "/alert-rules", label: "Alert rules engine", icon: BellOff, tone: "amber" },
  ],
  billing: [
    { path: "/recurring-invoices", label: "Recurring billing", icon: Receipt, tone: "emerald" },
    { path: "/purchase-orders", label: "Purchase orders", icon: ShoppingCart, tone: "violet" },
    { path: "/estimates", label: "Estimates", icon: FileText, tone: "sky" },
    { path: "/quote-to-cash", label: "Quote to cash", icon: Target, tone: "violet" },
    { path: "/billing-recon", label: "Reconciliation", icon: CheckCircle, tone: "emerald" },
    { path: "/services-subscriptions", label: "Services & subscriptions", icon: Layers3, tone: "cyan" },
    { path: "/usage-billing", label: "Usage billing", icon: Activity, tone: "cyan" },
    { path: "/billing-portal", label: "Payment portal", icon: CreditCard, tone: "amber" },
    { path: "/proposals", label: "Proposals & quotes", icon: FileText, tone: "indigo" },
    { path: "/invoice-templates", label: "Document templates", icon: Receipt, tone: "rose" },
    { path: "/finance-intel", label: "Finance intelligence", icon: BarChart3, tone: "violet" },
    { path: "/late-payment", label: "Late-payment assistant", icon: AlertTriangle, tone: "rose" },
    { path: "/pricing-calc", label: "Pricing calculator", icon: Calculator, tone: "emerald" },
    { path: "/xero", label: "Xero synchronisation", icon: ArrowUpRight, tone: "sky" },
  ],
  clients: [
    { path: "/client-insights", label: "Client insights", icon: BarChart3, tone: "violet" },
    { path: "/nexus-assurance", label: "Assurance evidence", icon: ShieldCheck, tone: "emerald" },
    { path: "/client-compare", label: "Compare clients", icon: Scale, tone: "sky" },
    { path: "/client-portal", label: "Client portal", icon: Globe, tone: "cyan" },
  ],
});

export function getWorkspaceTools(workspace) {
  return workspaceTools[workspace] || [];
}
