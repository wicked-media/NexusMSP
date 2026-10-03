import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BellRing,
  Calculator,
  CheckCircle2,
  CreditCard,
  FileText,
  Layers3,
  MoreHorizontal,
  Receipt,
  Repeat2,
  Settings2,
  ShoppingCart,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PRIMARY = [
  { path: "/billing-dashboard", label: "Overview", icon: BarChart3 },
  { path: "/invoices", label: "Invoices", icon: Receipt },
  { path: "/recurring-invoices", label: "Recurring", icon: Repeat2 },
  { path: "/services-subscriptions", label: "Services", icon: Layers3 },
  { path: "/billing-recon", label: "Reconcile", icon: CheckCircle2 },
];

const TOOL_GROUPS = [
  {
    label: "Revenue workflow",
    items: [
      { path: "/proposals", label: "Proposals & quotes", icon: FileText },
      { path: "/quote-to-cash", label: "Quote to cash", icon: ArrowUpRight },
      { path: "/usage-billing", label: "Usage billing", icon: Activity },
      { path: "/invoice-reminders", label: "Invoice reminders", icon: BellRing },
      { path: "/late-payment", label: "Late-payment follow-up", icon: AlertTriangle },
      { path: "/billing-portal", label: "Payment portal", icon: CreditCard },
    ],
  },
  {
    label: "Configuration & insights",
    items: [
      { path: "/billing-settings", label: "Billing settings", icon: Settings2 },
      { path: "/invoice-templates", label: "Document templates", icon: Receipt },
      { path: "/pricing-calc", label: "Pricing calculator", icon: Calculator },
      { path: "/finance-intel", label: "Finance intelligence", icon: BarChart3 },
      { path: "/purchase-orders", label: "Purchase orders", icon: ShoppingCart },
      { path: "/xero", label: "Xero synchronisation", icon: ArrowUpRight },
    ],
  },
];

export default function BillingWorkspaceNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTool = TOOL_GROUPS.flatMap((group) => group.items).find((item) => item.path === location.pathname);

  return (
    <nav className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/[0.55] p-1.5 shadow-sm" aria-label="Billing workspace" data-testid="billing-workspace-nav">
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center gap-1">
          {PRIMARY.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => `inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${isActive ? "bg-primary/[0.12] text-primary shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
              data-testid={`billing-nav-${label.toLowerCase()}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </NavLink>
          ))}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={activeTool ? "info" : "outline"} size="sm" className="h-8 shrink-0 px-2.5" data-testid="billing-tools-menu">
            <MoreHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">{activeTool?.label || "Tools"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={7} className="w-64 rounded-xl p-1.5">
          {TOOL_GROUPS.map((group, index) => (
            <div key={group.label}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{group.label}</DropdownMenuLabel>
              {group.items.map(({ path, label, icon: Icon }) => (
                <DropdownMenuItem key={path} onSelect={() => navigate(path)} className="rounded-lg px-2.5 py-2" data-testid={`billing-tool-${path.slice(1)}`}>
                  <Icon className="text-muted-foreground" />
                  {label}
                  {location.pathname === path && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-label="Current workspace" />}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
