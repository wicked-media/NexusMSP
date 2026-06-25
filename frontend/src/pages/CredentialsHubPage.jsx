import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";

const TABS = [
  { id: "vault", label: "Password Vault", icon: KeyRound, page: () => import("./VaultPage") },
  { id: "password-rotation", label: "Rotation", icon: RefreshCw, page: () => import("./PasswordRotationPage") },
  { id: "mfa-management", label: "MFA Management", icon: ShieldCheck, page: () => import("./MfaManagementPage") },
];

const lazyMap = Object.fromEntries(TABS.map(t => [t.id, lazy(t.page)]));

export default function CredentialsHubPage() {
  const [activeTab, setActiveTab] = useState("vault");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t && TABS.some(x => x.id === t)) setActiveTab(t);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", activeTab);
    window.history.replaceState({}, "", url);
  }, [activeTab]);

  const Active = lazyMap[activeTab];

  return (
    <div className="min-h-screen">
      <div className="border-b border-border bg-card/50">
        <div className="px-6 pt-5">
          <h1 className="text-2xl font-semibold tracking-tight">Credentials Hub</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Vault, rotation cadence and MFA enrolment — managed in one place.</p>
        </div>
        <div className="px-4 mt-4 flex items-center gap-1 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                data-testid={`credentials-tab-${t.id}`}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
                  active ? "bg-muted text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Icon className="w-4 h-4" />{t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <Suspense fallback={<div className="p-12 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}>
          <Active />
        </Suspense>
      </div>
    </div>
  );
}
