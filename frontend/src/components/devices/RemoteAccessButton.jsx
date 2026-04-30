import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Play, RefreshCw, ChevronDown, Server, Monitor, Settings, ExternalLink,
  XCircle, MonitorSmartphone,
} from "lucide-react";
import { API, useAuth } from "@/App";

const PROVIDER_LABEL = {
  trmm: "Tactical RMM (MeshCentral)",
  rustdesk: "RustDesk",
  meshcentral: "MeshCentral",
  splashtop: "Splashtop",
  screenconnect: "ScreenConnect",
  teamviewer: "TeamViewer",
  anydesk: "AnyDesk",
  guacamole: "Apache Guacamole",
};

const PROVIDER_ICON = {
  trmm: Server,
  rustdesk: MonitorSmartphone,
  meshcentral: Monitor,
};

/**
 * Unified Remote Access button.
 *
 * Picks a primary action based on what's configured and what's available on
 * this device. When multiple providers are available, opens a dropdown so the
 * tech can choose. Falls back to a "Configure" CTA when nothing is set up.
 */
export default function RemoteAccessButton({ device, status, onLaunchRustDesk, onLaunchTrmm, busy = false, testid = "remote-access-btn" }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API}/remote-providers/active`, { headers });
        if (!cancelled) setProviders(res.data || []);
      } catch {
        if (!cancelled) setProviders([]);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [headers]);

  const isOffline = status === "offline";

  // Determine which providers actually apply to THIS device right now.
  const trmmCfg = providers.find(p => p.id === "trmm");
  const rdCfg = providers.find(p => p.id === "rustdesk");
  const otherCfg = providers.filter(p => !["trmm", "rustdesk"].includes(p.id));

  const trmmReady = !!trmmCfg && !!device?.trmm_agent_id;
  const trmmLinkable = !!trmmCfg && !device?.trmm_agent_id;
  const rdReady = !!rdCfg && !!device?.rustdesk_id;

  // Pick a primary path
  let primary = null;
  if (trmmReady) primary = { id: "trmm", label: "Remote (TRMM)", action: onLaunchTrmm };
  else if (rdReady) primary = { id: "rustdesk", label: "Remote (RustDesk)", action: onLaunchRustDesk };
  else if (trmmLinkable) primary = { id: "trmm-link", label: "Link TRMM agent", action: onLaunchTrmm };
  else if (otherCfg.length === 1) primary = { id: otherCfg[0].id, label: `Remote (${otherCfg[0].name})`, action: () => toast.info(`${otherCfg[0].name} provider — open from Settings → Remote Providers`) };

  // Loading state
  if (loading) {
    return (
      <Button size="sm" variant="outline" disabled data-testid={`${testid}-loading`}>
        <RefreshCw className="w-4 h-4 mr-1 animate-spin" />Remote
      </Button>
    );
  }

  // Nothing configured at all → CTA
  if (!primary && providers.length === 0) {
    return (
      <Button size="sm" variant="outline" asChild data-testid={`${testid}-configure`}>
        <Link to="/settings?tab=integrations">
          <Settings className="w-4 h-4 mr-1" /> Configure Remote
        </Link>
      </Button>
    );
  }

  // Offline indicator (still allow dropdown for queued actions / TRMM scheduling)
  if (isOffline && primary?.id !== "trmm-link") {
    return (
      <Button size="sm" variant="outline" disabled data-testid={`${testid}-offline`}>
        <XCircle className="w-4 h-4 mr-1" /> Offline
      </Button>
    );
  }

  // Render: primary button + dropdown if multiple options or fallback choices exist
  const hasAlternatives = (
    (trmmReady && rdReady) ||
    (trmmReady && otherCfg.length > 0) ||
    (rdReady && (otherCfg.length > 0 || trmmCfg)) ||
    otherCfg.length > 0 ||
    trmmLinkable
  );

  const PrimaryIcon = PROVIDER_ICON[primary?.id] || Play;

  return (
    <div className="flex items-stretch">
      <Button
        size="sm"
        variant="outline"
        className={`text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 ${hasAlternatives ? "rounded-r-none border-r-0" : ""}`}
        onClick={primary?.action}
        disabled={busy || !primary?.action}
        data-testid={testid}
      >
        {busy ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <PrimaryIcon className="w-4 h-4 mr-1" />}
        {primary?.label || "Remote Access"}
      </Button>
      {hasAlternatives && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 rounded-l-none px-2"
              data-testid={`${testid}-menu-trigger`}
            >
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">Remote providers</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {trmmCfg && (
              <DropdownMenuItem
                onClick={onLaunchTrmm}
                disabled={busy}
                data-testid={`${testid}-opt-trmm`}
              >
                <Server className="w-4 h-4 mr-2 text-emerald-500" />
                <div className="flex-1">
                  <div className="text-sm">Tactical RMM</div>
                  <div className="text-[10px] text-muted-foreground">{device?.trmm_agent_id ? "Linked agent · MeshCentral" : "Link an agent first"}</div>
                </div>
              </DropdownMenuItem>
            )}
            {rdCfg && (
              <DropdownMenuItem
                onClick={onLaunchRustDesk}
                disabled={busy}
                data-testid={`${testid}-opt-rustdesk`}
              >
                <MonitorSmartphone className="w-4 h-4 mr-2 text-cyan-500" />
                <div className="flex-1">
                  <div className="text-sm">RustDesk</div>
                  <div className="text-[10px] text-muted-foreground">{device?.rustdesk_id ? `ID ${device.rustdesk_id}` : "No RustDesk ID assigned"}</div>
                </div>
              </DropdownMenuItem>
            )}
            {otherCfg.map(p => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => toast.info(`${p.name} launches from Settings → Remote Providers (per-device handoff coming soon)`)}
                data-testid={`${testid}-opt-${p.id}`}
              >
                <Monitor className="w-4 h-4 mr-2 text-violet-500" />
                <div className="flex-1">
                  <div className="text-sm">{PROVIDER_LABEL[p.id] || p.name}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">{p.type}</div>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild data-testid={`${testid}-opt-configure`}>
              <Link to="/settings?tab=integrations">
                <Settings className="w-4 h-4 mr-2" />
                <span className="text-sm">Configure providers…</span>
                <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
