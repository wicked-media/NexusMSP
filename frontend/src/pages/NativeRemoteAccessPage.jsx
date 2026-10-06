import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity, ArrowLeft, CheckCircle2, Clock3, Command, Copy, ExternalLink, FileDown, FileUp,
  FolderOpen, History, Laptop, Loader2, Maximize2, Minimize2, Monitor, MonitorUp,
  Network, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Users,
  ZoomIn, ZoomOut, XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { MetricStrip, MetricTile } from "@/components/design-system";
import NexusRemoteRiskBadge from "@/components/remote/NexusRemoteRiskBadge";
import NexusRemoteCommandPalette from "@/components/remote/NexusRemoteCommandPalette";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_PREFERENCES, STUDIO_PRESETS, TOOL_LABELS, applyPreset, deriveSessionChapters,
  maturityLabel, normalisePreferences, orderQuickActions, suggestSessionLabour,
} from "@/lib/remoteSessionStudio";

const BUILD_STAGES = [
  { name: "Trust & grants", detail: "Per-tenant signed attended-session leases, device binding, revocation and durable replay protection.", state: "ready", icon: ShieldCheck },
  { name: "Remote Companion", detail: "Signed user-session companion for attended consent, local stop and policy-verified capture in view-only or control modes.", state: "ready", icon: Laptop },
  { name: "Nexus Relay", detail: "Authenticated, tenant-scoped frame relay with bounded uploads, freshness expiry and transport evidence.", state: "ready", icon: Network },
  { name: "Technician Viewer", detail: "Live desktop canvas with freshness state, session evidence, interactive control under fresh endpoint approval, and an emergency end control.", state: "ready", icon: MonitorUp },
];

const CAPABILITY_TARGETS = [
  "Attended and policy-controlled unattended access", "Multi-monitor canvas", "Reboot and reconnect",
  "Multi-technician collaboration", "Secure clipboard and file exchange", "Session recording and playback",
  "Background diagnostics", "Credential-safe elevation", "In-session chat", "Ticket, time and billing evidence",
];

const REMOTE_KEY_NAMES = {
  " ": "SPACE", Escape: "ESC", Control: "CTRL", AltGraph: "ALT",
  ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT",
};
const REMOTE_ALLOWED_KEYS = new Set([
  "ENTER", "ESC", "TAB", "BACKSPACE", "DELETE", "SPACE", "UP", "DOWN", "LEFT", "RIGHT",
  "HOME", "END", "PAGEUP", "PAGEDOWN", "SHIFT", "CTRL", "ALT",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
]);

function normaliseViewerKey(value) {
  const key = REMOTE_KEY_NAMES[value] || String(value || "").trim().toUpperCase();
  return (/^[A-Z0-9]$/.test(key) || REMOTE_ALLOWED_KEYS.has(key)) ? key : "";
}

function messageFor(error, fallback) {
  const detail = error?.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}

function lifecycleEvidence(session) {
  const labels = [session?.transport_state, session?.launch_status]
    .filter(Boolean)
    .map(value => String(value).replaceAll("_", " "));
  if (session?.transport_detail) labels.push(String(session.transport_detail));
  return [...new Set(labels)].join(" · ");
}

function displayEvidenceTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Recorded";
}

function formatOffset(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  const stamp = `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return hours ? `${hours}:${stamp}` : stamp;
}

function formatSessionDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s` : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export default function NativeRemoteAccessPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [devices, setDevices] = useState([]);
  const [agents, setAgents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [mode, setMode] = useState("view");
  const [purpose, setPurpose] = useState("");
  const [consent, setConsent] = useState(false);
  const [viewerSession, setViewerSession] = useState(null);
  const [viewerFrame, setViewerFrame] = useState("");
  const [viewerFrameCapturedAt, setViewerFrameCapturedAt] = useState("");
  const [viewerState, setViewerState] = useState("waiting");
  const [viewerClock, setViewerClock] = useState(() => Date.now());
  const [endingSessionId, setEndingSessionId] = useState("");
  const [viewerZoom, setViewerZoom] = useState(1);
  const [viewerFit, setViewerFit] = useState(true);
  const [viewerFocus, setViewerFocus] = useState(false);
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const [viewerDisplays, setViewerDisplays] = useState([]);
  const [viewerDisplayIndex, setViewerDisplayIndex] = useState("all");
  const [viewerFrameSize, setViewerFrameSize] = useState({ w: 0, h: 0 });
  const [remotePath, setRemotePath] = useState("C:\\");
  const [retrievalPath, setRetrievalPath] = useState("");
  const [sendDestination, setSendDestination] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const [studioPrefs, setStudioPrefs] = useState(DEFAULT_PREFERENCES);
  const [studioInsights, setStudioInsights] = useState(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioSaving, setStudioSaving] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const sendFileRef = useRef(null);
  const viewerInputSequence = useRef(0);
  const lastPointerMoveAt = useRef(0);
  const pendingPointerMove = useRef(null);
  const pointerMoveTimer = useRef(null);
  const lastViewerInputErrorAt = useRef(0);
  const viewerSessionId = viewerSession?.id || "";
  const viewerActiveDisplay = viewerDisplayIndex === "all"
    ? null
    : viewerDisplays.find((display) => display.index === viewerDisplayIndex) || null;
  // Per-display views crop one monitor rectangle out of the virtual-desktop
  // frame. Pointer coordinates keep working because they are read from the
  // image's own rectangle, which always maps 1:1 onto the full frame.
  const cropGeometry = viewerActiveDisplay && viewerFrameSize.w > 0 && viewerFrameSize.h > 0
    ? {
        box: { aspectRatio: `${viewerActiveDisplay.width} / ${viewerActiveDisplay.height}`, height: "100%", maxWidth: "100%" },
        image: {
          position: "absolute",
          width: `${(viewerFrameSize.w / viewerActiveDisplay.width) * 100}%`,
          height: `${(viewerFrameSize.h / viewerActiveDisplay.height) * 100}%`,
          left: `${(-viewerActiveDisplay.x / viewerActiveDisplay.width) * 100}%`,
          top: `${(-viewerActiveDisplay.y / viewerActiveDisplay.height) * 100}%`,
          maxWidth: "none",
        },
      }
    : null;

  const studioUsage = studioInsights?.usage_counts || {};
  const studioMaturity = studioInsights?.maturity || maturityLabel(studioInsights?.event_total || 0);
  const studioSuggestions = studioInsights?.suggestions || [];
  const studioDensity = studioPrefs.density === "compact" ? "p-3" : "p-4";

  const loadStudio = useCallback(async () => {
    try {
      const [prefsResponse, insightsResponse] = await Promise.all([
        axios.get(`${API}/remote/studio/preferences`, { headers }),
        axios.get(`${API}/remote/studio/insights`, { headers }),
      ]);
      setStudioPrefs(normalisePreferences(prefsResponse.data));
      setStudioInsights(insightsResponse.data);
    } catch {
      // The studio degrades to catalogue defaults; viewing never depends on it.
    }
  }, [headers]);

  useEffect(() => { loadStudio(); }, [loadStudio]);

  const saveStudioPrefs = useCallback(async (next) => {
    const normalised = normalisePreferences(next);
    setStudioPrefs(normalised);
    setStudioSaving(true);
    try {
      await axios.put(`${API}/remote/studio/preferences`, normalised, { headers });
      const insightsResponse = await axios.get(`${API}/remote/studio/insights`, { headers });
      setStudioInsights(insightsResponse.data);
      toast.success("Session Studio saved — it keeps adapting as you work.");
    } catch (error) {
      toast.error(messageFor(error, "Studio preferences could not be saved"));
    } finally {
      setStudioSaving(false);
    }
  }, [headers]);

  const recordStudioUsage = useCallback((tool, extra = {}) => {
    axios.post(`${API}/remote/studio/usage`, { tool, session_id: viewerSessionId, ...extra }, { headers }).catch(() => {});
  }, [headers, viewerSessionId]);

  const viewerUrl = useCallback((sessionId) => {
    const params = new URLSearchParams();
    params.set("viewer", sessionId);
    return `/nexus-remote?${params.toString()}`;
  }, []);

  const closeViewer = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    setPaletteOpen(false);
    setViewerSession(null);
    const next = new URLSearchParams(searchParams);
    next.delete("viewer");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const resetViewerCanvas = useCallback(() => {
    setViewerZoom(1);
    setViewerFit(true);
  }, []);

  const updateViewerZoom = useCallback((next) => {
    setViewerFit(false);
    setViewerZoom(current => Math.max(0.5, Math.min(3, typeof next === "function" ? next(current) : next)));
  }, []);

  const toggleFullscreen = useCallback(async () => {
    recordStudioUsage("full_screen");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast.error("Fullscreen is unavailable in this browser window");
    }
  }, [recordStudioUsage]);

  const openViewer = useCallback((session, { popOut = false } = {}) => {
    if (!session?.id) return;
    const url = viewerUrl(session.id);
    if (popOut) {
      window.open(url, "nexus-remote-viewer", "popup=yes,width=1500,height=950,resizable=yes,scrollbars=no");
      return;
    }
    setViewerSession(session);
    navigate(url);
  }, [navigate, viewerUrl]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [deviceResponse, agentResponse, sessionResponse] = await Promise.all([
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/nexus-agent/agents`, { headers }),
        axios.get(`${API}/remote/sessions`, { headers }),
      ]);
      setDevices((deviceResponse.data || []).filter(device => !device.archived));
      setAgents(agentResponse.data || []);
      setSessions((sessionResponse.data || []).filter(session => session.provider === "nexus"));
    } catch (error) {
      toast.error(messageFor(error, "Nexus Native Remote could not load"));
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const agentById = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents]);
  const enrolled = devices.filter(device => device.nexus_agent_id && agentById.has(device.nexus_agent_id));
  const online = enrolled.filter(device => agentById.get(device.nexus_agent_id)?.online);
  const capable = online.filter(device => {
    const agent = agentById.get(device.nexus_agent_id) || {};
    return [...(agent.agent_runtime_capabilities || []), ...(agent.nexus_shield_capabilities || [])].includes("native_remote_v1");
  });
  const activeSessions = sessions.filter(session => ["authorised", "active", "ending"].includes(session.status));
  const activeSessionDeviceIds = useMemo(() => new Set(activeSessions.map(session => session.device_id)), [activeSessions]);
  const viewerSessionRecord = useMemo(
    () => viewerSession ? sessions.find(session => session.id === viewerSession.id) : null,
    [sessions, viewerSession],
  );
  const viewerCaptureState = !viewerSessionRecord
    ? "unknown"
    : viewerSessionRecord.status === "ended"
      ? "ended"
      : viewerSessionRecord.status !== "active"
        ? "awaiting_consent"
      : viewerSessionRecord.capture_freshness || "unknown";
  const viewerSessionStartedAt = Date.parse(viewerSessionRecord?.companion_acknowledged_at || viewerSessionRecord?.started_at || "");
  const viewerSessionEndedAt = Date.parse(viewerSessionRecord?.ended_at || "");
  const viewerDurationLabel = Number.isFinite(viewerSessionStartedAt)
    ? ` · duration ${formatSessionDuration((Number.isFinite(viewerSessionEndedAt) ? viewerSessionEndedAt : viewerClock) - viewerSessionStartedAt)}`
    : "";
  const viewerCanControl = viewerSession?.access_mode === "control"
    && viewerState === "live"
    && viewerCaptureState === "fresh";
  const viewerStatusLabel = viewerCaptureState === "ended"
    ? "Session no longer active"
    : viewerCaptureState === "awaiting_consent"
      ? "Waiting for endpoint consent"
    : viewerState === "disconnected"
      ? "Endpoint companion disconnected · awaiting reconnect"
    : viewerState === "stale"
      ? "Frame stale · awaiting a newer server capture"
      : viewerCaptureState === "stale"
        ? `Capture stale${Number.isFinite(viewerSessionRecord?.capture_age_seconds) ? ` · last verified ${viewerSessionRecord.capture_age_seconds}s ago` : ""}`
      : viewerState === "live"
        ? `Live ${viewerSession?.access_mode === "control" ? "interactive control" : "view-only"}${viewerFrameCapturedAt ? ` · server capture ${new Date(viewerFrameCapturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}${viewerDurationLabel}`
        : viewerState === "reconnecting"
          ? "Reconnecting"
          : "Waiting for endpoint capture";
  const visibleDevices = devices.filter(device => {
    const value = query.trim().toLowerCase();
    if (!value) return true;
    return [device.name, device.hostname, device.client_name, device.os].some(field => String(field || "").toLowerCase().includes(value));
  });
  const companionStateLabel = evidence => {
    const state = String(evidence?.status || "readiness_unreported");
    if (state === "ready") return "Companion ready";
    if (state === "waiting_for_user_session") return "Awaiting user session";
    if (state === "waiting_for_policy") return "Applying remote policy";
    if (state === "integrity_unverified") return "Companion integrity check needed";
    if (state === "unsupported_platform") return "Windows companion required";
    return "Companion state unavailable";
  };

  useEffect(() => {
    if (!activeSessions.length) return undefined;
    let cancelled = false;
    const refreshSessionState = async () => {
      try {
        const response = await axios.get(`${API}/remote/sessions`, { headers });
        if (!cancelled) setSessions((response.data || []).filter(session => session.provider === "nexus"));
      } catch {
        // A transient refresh failure must not hide the existing audited state.
      }
    };
    const interval = window.setInterval(refreshSessionState, 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [activeSessions.length, headers]);

  const inspectDevice = useCallback(async device => {
    setSelected(device);
    setReadiness(null);
    setConsent(false);
    setPurpose("");
    setMode(studioPrefs.default_mode);
    setChecking(true);
    try {
      const response = await axios.get(`${API}/devices/${device.id}/native-remote/readiness`, { headers });
      setReadiness(response.data);
    } catch (error) {
      setReadiness({ ready: false, state: "unavailable", detail: messageFor(error, "Readiness could not be confirmed") });
    } finally {
      setChecking(false);
    }
  }, [headers, studioPrefs.default_mode]);

  useEffect(() => {
    const requested = searchParams.get("device");
    if (!requested || loading || !devices.length) return;
    const device = devices.find(item => item.id === requested);
    if (device) inspectDevice(device);
    const next = new URLSearchParams(searchParams);
    next.delete("device");
    setSearchParams(next, { replace: true });
  }, [devices, inspectDevice, loading, searchParams, setSearchParams]);

  useEffect(() => {
    const requestedViewer = searchParams.get("viewer");
    if (!requestedViewer || loading) return;
    const session = sessions.find(item => item.id === requestedViewer && item.provider === "nexus");
    if (session) setViewerSession(session);
  }, [loading, searchParams, sessions]);

  useEffect(() => {
    if (!viewerSession) return undefined;
    if (viewerCaptureState === "stale" || viewerCaptureState === "ended" || viewerCaptureState === "awaiting_consent") {
      setViewerState(viewerCaptureState === "awaiting_consent" ? "waiting" : viewerCaptureState);
      setViewerFrame(previous => {
        if (previous) URL.revokeObjectURL(previous);
        return "";
      });
      setViewerFrameCapturedAt("");
      return undefined;
    }
    let currentUrl = "";
    let cancelled = false;
    const loadFrame = async () => {
      try {
        const response = await axios.get(`${API}/remote/sessions/${viewerSession.id}/native-frame`, { headers, responseType: "blob" });
        if (cancelled) return;
        const nextUrl = URL.createObjectURL(response.data);
        setViewerFrame(previous => { if (previous) URL.revokeObjectURL(previous); return nextUrl; });
        currentUrl = nextUrl;
        setViewerFrameCapturedAt(response.headers["x-nexus-remote-captured-at"] || "");
        const displaysHeader = response.headers["x-nexus-remote-displays"];
        if (displaysHeader) {
          try {
            const parsed = JSON.parse(displaysHeader);
            setViewerDisplays((previous) => (JSON.stringify(previous) === JSON.stringify(parsed) ? previous : parsed));
          } catch { setViewerDisplays([]); }
        } else {
          setViewerDisplays([]);
        }
        setViewerState("live");
      } catch (error) {
        if (!cancelled) {
          const detail = String(error?.response?.data?.detail || "").toLowerCase();
          if (error?.response?.status === 409 && detail.includes("capture is stale")) {
            setViewerState("stale");
            setViewerFrame(previous => { if (previous) URL.revokeObjectURL(previous); return ""; });
            setViewerFrameCapturedAt("");
          } else if (error?.response?.status === 409 && detail.includes("transport is disconnected")) {
            setViewerState("disconnected");
            setViewerFrame(previous => { if (previous) URL.revokeObjectURL(previous); return ""; });
            setViewerFrameCapturedAt("");
          } else {
            if (error?.response?.status === 404) {
              setViewerFrame(previous => { if (previous) URL.revokeObjectURL(previous); return ""; });
              setViewerFrameCapturedAt("");
            }
            setViewerState(error?.response?.status === 404 ? "waiting" : "reconnecting");
          }
        }
      }
    };
    loadFrame();
    const interval = window.setInterval(loadFrame, 900);
    return () => { cancelled = true; window.clearInterval(interval); if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [headers, viewerCaptureState, viewerSession]);

  useEffect(() => {
    if (!viewerSession) return undefined;
    setViewerClock(Date.now());
    const interval = window.setInterval(() => setViewerClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [viewerSession]);

  useEffect(() => {
    // Smart default: technicians who habitually focus one display start there.
    if (studioPrefs.default_display === "primary" && viewerDisplayIndex === "all" && viewerDisplays.length > 1) {
      const primary = viewerDisplays.find((display) => display.primary);
      if (primary) setViewerDisplayIndex(primary.index);
    }
  }, [studioPrefs.default_display, viewerDisplayIndex, viewerDisplays]);

  useEffect(() => {
    const updateFullscreen = () => setViewerFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => {
    if (viewerSessionId) {
      resetViewerCanvas();
      setViewerFocus(false);
      viewerInputSequence.current = 0;
      lastPointerMoveAt.current = 0;
    }
    return () => {
      if (pointerMoveTimer.current !== null) window.clearTimeout(pointerMoveTimer.current);
      pointerMoveTimer.current = null;
      pendingPointerMove.current = null;
    };
  }, [viewerSessionId, resetViewerCanvas]);

  const normalisedPointer = useCallback((event) => {
    const image = event.currentTarget;
    const bounds = image.getBoundingClientRect();
    const naturalWidth = image.naturalWidth || bounds.width;
    const naturalHeight = image.naturalHeight || bounds.height;
    const scale = Math.min(bounds.width / naturalWidth, bounds.height / naturalHeight);
    const renderedWidth = naturalWidth * scale;
    const renderedHeight = naturalHeight * scale;
    const left = bounds.left + (bounds.width - renderedWidth) / 2;
    const top = bounds.top + (bounds.height - renderedHeight) / 2;
    const x = (event.clientX - left) / renderedWidth;
    const y = (event.clientY - top) / renderedHeight;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }, []);

  const sendViewerInput = useCallback(async (payload) => {
    if (!viewerCanControl || !viewerSession?.id) return;
    const sequence = ++viewerInputSequence.current;
    try {
      await axios.post(`${API}/remote/sessions/${encodeURIComponent(viewerSession.id)}/native-input`, {
        sequence,
        ...payload,
      }, { headers });
    } catch (error) {
      // Pointer movement can generate a short burst of requests. Surface a
      // delivery problem without turning that burst into a toast storm.
      if (Date.now() - lastViewerInputErrorAt.current > 2500) {
        lastViewerInputErrorAt.current = Date.now();
        toast.error(messageFor(error, "Interactive control could not be delivered"));
      }
    }
  }, [headers, viewerCanControl, viewerSession?.id]);

  const flushPointerMove = useCallback(() => {
    pointerMoveTimer.current = null;
    const point = pendingPointerMove.current;
    pendingPointerMove.current = null;
    if (!point) return;
    lastPointerMoveAt.current = Date.now();
    void sendViewerInput({ kind: "pointer_move", ...point });
  }, [sendViewerInput]);

  const handleViewerPointerMove = useCallback((event) => {
    if (!viewerCanControl) return;
    const point = normalisedPointer(event);
    if (!point) return;
    pendingPointerMove.current = point;
    if (pointerMoveTimer.current !== null) return;
    // The Agent polls signed control envelopes independently of frame relay.
    // Coalesce noisy browser mousemove events to the newest position so remote
    // control stays responsive without growing an obsolete input backlog.
    const delay = Math.max(0, 125 - (Date.now() - lastPointerMoveAt.current));
    pointerMoveTimer.current = window.setTimeout(flushPointerMove, delay);
  }, [flushPointerMove, normalisedPointer, viewerCanControl]);

  const handleViewerPointerButton = useCallback((event, pressed) => {
    if (!viewerCanControl) return;
    const point = normalisedPointer(event);
    const button = ["left", "middle", "right"][event.button];
    if (!point || !button) return;
    void sendViewerInput({ kind: "pointer_button", ...point, button, pressed });
  }, [normalisedPointer, sendViewerInput, viewerCanControl]);

  const handleViewerKey = useCallback((event, pressed) => {
    if (!viewerCanControl || event.repeat) return;
    const key = normaliseViewerKey(event.key);
    if (!key) return;
    event.preventDefault();
    void sendViewerInput({ kind: "key", key, pressed });
  }, [sendViewerInput, viewerCanControl]);

  const loadTransfers = useCallback(async () => {
    if (!viewerSession?.device_id) return;
    try {
      const response = await axios.get(`${API}/devices/${viewerSession.device_id}/file-transfers`, { headers });
      setTransfers(Array.isArray(response.data) ? response.data : []);
    } catch { setTransfers([]); }
  }, [viewerSession, headers]);

  useEffect(() => { loadTransfers(); }, [loadTransfers]);

  const browseRemoteDirectory = async () => {
    if (!viewerSession?.device_id || !remotePath.trim()) return;
    setTransferBusy(true);
    try {
      await axios.post(`${API}/devices/${viewerSession.device_id}/file-browser/list`, { directory: remotePath.trim() }, { headers });
      toast.success("Directory listing requested — the endpoint reports it back into this session.");
      recordStudioUsage("file_browse");
    } catch (error) { toast.error(messageFor(error, "Directory listing could not be requested")); }
    finally { setTransferBusy(false); }
  };

  const requestRemoteFile = async () => {
    if (!viewerSession?.device_id || !retrievalPath.trim()) return;
    setTransferBusy(true);
    try {
      const form = new FormData();
      form.append("source_path", retrievalPath.trim());
      const response = await axios.post(`${API}/devices/${viewerSession.device_id}/file-retrievals`, form, { headers });
      toast.success(`Retrieval queued for ${response.data?.filename || "the requested file"}.`);
      recordStudioUsage("file_retrieve");
      setRetrievalPath("");
      loadTransfers();
    } catch (error) { toast.error(messageFor(error, "File retrieval could not be queued")); }
    finally { setTransferBusy(false); }
  };

  const sendRemoteFile = async () => {
    const file = sendFileRef.current?.files?.[0];
    if (!viewerSession?.device_id || !file || !sendDestination.trim()) {
      toast.error("Choose a file and an explicit endpoint destination first.");
      return;
    }
    setTransferBusy(true);
    try {
      const form = new FormData();
      form.append("destination", sendDestination.trim());
      form.append("file", file);
      await axios.post(`${API}/devices/${viewerSession.device_id}/file-transfers`, form, { headers });
      toast.success("File staged — the agent scans and pulls it to the endpoint.");
      recordStudioUsage("file_send");
      if (sendFileRef.current) sendFileRef.current.value = "";
      setSendDestination("");
      loadTransfers();
    } catch (error) { toast.error(messageFor(error, "File could not be staged for the endpoint")); }
    finally { setTransferBusy(false); }
  };

  const startSession = async () => {
    if (!selected || !readiness?.ready || !consent) return;
    setStarting(true);
    try {
      const response = await axios.post(`${API}/devices/${selected.id}/remote-sessions/start`, {
        provider: "nexus",
        mode,
        session_type: "remote_desktop",
        purpose: purpose.trim() || "Technician support session",
        consent_confirmed: true,
        control_consent_confirmed: mode === "control",
        consent_method: "attended_prompt",
        ticket_id: searchParams.get("ticket"),
        work_session_id: searchParams.get("workSession"),
        idempotency_key: window.crypto?.randomUUID?.() || `${selected.id}-${Date.now()}`,
      }, { headers });
      toast.success(response.data?.message || "Native session grant issued");
      recordStudioUsage(mode === "control" ? "start_control" : "start_view");
      setSelected(null);
      await fetchData();
      if (response.data?.session?.id) openViewer(response.data.session);
    } catch (error) {
      toast.error(messageFor(error, "Native session could not be started"));
    } finally {
      setStarting(false);
    }
  };

  const endSession = async (session) => {
    if (!session?.id || endingSessionId) return;
    setEndingSessionId(session.id);
    try {
      await axios.put(`${API}/remote/sessions/${encodeURIComponent(session.id)}/end`, {
        notes: "Technician ended Nexus Remote session from the native viewer",
      }, { headers });
      toast.success("Nexus Remote session ended and its grant was revoked");
      recordStudioUsage("end_session");
      if (viewerSession?.id === session.id) closeViewer();
      await fetchData();
    } catch (error) {
      toast.error(messageFor(error, "Nexus Remote session could not be ended"));
    } finally {
      setEndingSessionId("");
    }
  };

  // Adaptive viewer toolbar: the studio reorders these by recorded usage so
  // the tools a technician actually reaches for come first.
  const viewerToolSpecs = {
    zoom_out: { icon: ZoomOut, title: "Zoom out", disabled: viewerFit || viewerZoom <= 0.5, onClick: () => { updateViewerZoom(zoom => zoom - 0.25); recordStudioUsage("zoom_out"); } },
    zoom_in: { icon: ZoomIn, title: "Zoom in", disabled: !viewerFit && viewerZoom >= 3, onClick: () => { updateViewerZoom(zoom => zoom + 0.25); recordStudioUsage("zoom_in"); } },
    fit: { icon: RefreshCw, wide: true, title: "Fit desktop to available space", content: viewerFit ? "Fit" : `${Math.round(viewerZoom * 100)}%`, onClick: () => { resetViewerCanvas(); recordStudioUsage("fit"); } },
    focus_desktop: { icon: Maximize2, wide: true, title: "Hide or show session evidence", content: viewerFocus ? "Show evidence" : "Focus desktop", onClick: () => { setViewerFocus(value => !value); recordStudioUsage(viewerFocus ? "show_evidence" : "focus_desktop"); } },
  };
  const orderedViewerTools = orderQuickActions(["zoom_out", "fit", "zoom_in", "focus_desktop"], studioUsage);

  // Session journal and labour are derived from the governed session record, so
  // they update on the same clock as the on-screen duration.
  const sessionChapters = deriveSessionChapters(viewerSessionRecord);
  const sessionLabour = viewerSessionRecord ? suggestSessionLabour(viewerSessionRecord, viewerClock) : null;

  // Ctrl/Cmd+K inside the viewer. The capture-phase listener claims the event
  // first so the global command palette cannot open behind a fullscreen session.
  useEffect(() => {
    if (!viewerSession) return undefined;
    const handlePaletteShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === "k") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handlePaletteShortcut, true);
    return () => window.removeEventListener("keydown", handlePaletteShortcut, true);
  }, [viewerSession]);

  const copySessionId = () => {
    const value = viewerSession?.id || "";
    if (!value || !navigator.clipboard?.writeText) { toast.error("Clipboard is unavailable in this browser"); return; }
    navigator.clipboard.writeText(value).then(() => toast.success("Session id copied")).catch(() => toast.error("Clipboard is unavailable in this browser"));
  };

  // Only commands this session already authorises. Nothing here escalates access.
  const viewerCommands = viewerSession ? [
    { id: "fit", group: "Viewer", label: "Fit desktop to the window", icon: RefreshCw, keywords: ["reset"], run: () => { resetViewerCanvas(); recordStudioUsage("fit"); } },
    { id: "zoom_in", group: "Viewer", label: "Zoom in", hint: "+25%", icon: ZoomIn, disabled: !viewerFit && viewerZoom >= 3, run: () => { updateViewerZoom(zoom => zoom + 0.25); recordStudioUsage("zoom_in"); } },
    { id: "zoom_out", group: "Viewer", label: "Zoom out", hint: "-25%", icon: ZoomOut, disabled: viewerFit || viewerZoom <= 0.5, run: () => { updateViewerZoom(zoom => zoom - 0.25); recordStudioUsage("zoom_out"); } },
    { id: "focus_desktop", group: "Viewer", label: viewerFocus ? "Show session evidence" : "Focus the desktop", icon: Maximize2, keywords: ["hide", "sidebar"], run: () => { setViewerFocus(value => !value); recordStudioUsage(viewerFocus ? "show_evidence" : "focus_desktop"); } },
    { id: "full_screen", group: "Viewer", label: viewerFullscreen ? "Exit full screen" : "Full screen", icon: Minimize2, keywords: ["immersive"], run: toggleFullscreen },
    { id: "pop_out", group: "Viewer", label: "Pop out into a separate window", icon: ExternalLink, run: () => { openViewer(viewerSession, { popOut: true }); recordStudioUsage("pop_out"); } },
    { id: "studio", group: "Viewer", label: "Customise the session studio", icon: SlidersHorizontal, keywords: ["preset", "panels", "toolbar", "density"], run: () => setStudioOpen(true) },
    { id: "display_all", group: "Displays", label: "Show all displays", icon: Monitor, disabled: viewerDisplays.length === 0, run: () => { setViewerDisplayIndex("all"); recordStudioUsage("display_all"); } },
    ...viewerDisplays.map(display => ({
      id: `display_${display.index}`,
      group: "Displays",
      label: `Focus ${display.name || `display ${display.index + 1}`}`,
      hint: display.primary ? "primary" : "",
      icon: Monitor,
      run: () => { setViewerDisplayIndex(display.index); recordStudioUsage("display_focus"); },
    })),
    { id: "files", group: "Files", label: "Show files in this session", icon: FolderOpen, disabled: !viewerSession?.device_id, keywords: ["transfer", "retrieve", "send", "download"], run: () => { setViewerFocus(false); saveStudioPrefs({ ...studioPrefs, panels: { ...studioPrefs.panels, files: true } }); recordStudioUsage("file_browse"); } },
    { id: "copy_session", group: "Session", label: "Copy the session id", icon: Copy, run: copySessionId },
    { id: "return", group: "Session", label: "Return to the remote workspace", icon: ArrowLeft, run: closeViewer },
    { id: "end_session", group: "Session", label: "End this session", icon: XCircle, keywords: ["stop", "revoke", "close"], run: () => endSession(viewerSession) },
  ] : [];

  if (loading) return <div className="flex h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-cyan-300" /></div>;

  return (
    <div className="space-y-5" data-testid="native-remote-access-page">
      <OperationalPageHeader
        eyebrow="Managed access"
        title="Nexus Remote"
        description="Nexus-owned remote support through the enrolled agent, with consent, scope, revocation and service evidence built in."
        icon={Laptop}
        tone="sky"
        signal={capable.length ? "healthy" : "working"}
        signalLabel={capable.length ? `${capable.length} native-ready endpoints` : "Remote Companion build required"}
        signalDescription={capable.length ? "The native grant path is available on enrolled endpoints." : "Trust and grant infrastructure is ready; no endpoint advertises the capture companion yet."}
        actions={<><Button variant="outline" size="sm" onClick={() => navigate("/nexus-agent")}><ShieldCheck className="mr-2 h-4 w-4" />Nexus Agent</Button><Button variant="outline" size="sm" onClick={() => setStudioOpen(true)} data-testid="session-studio-launch"><SlidersHorizontal className="mr-2 h-4 w-4" />Session Studio</Button><Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></>}
      />

      <MetricStrip columns={4}>
        <MetricTile label="Enrolled endpoints" value={enrolled.length} icon={ShieldCheck} accent="cyan" />
        <MetricTile label="Agents online" value={online.length} icon={Activity} accent="emerald" />
        <MetricTile label="Native capable" value={capable.length} icon={MonitorUp} accent="violet" />
        <MetricTile label="Active sessions" value={activeSessions.length} icon={Users} accent="amber" />
      </MetricStrip>

      <Card className="overflow-hidden border-cyan-400/20 bg-[linear-gradient(112deg,rgba(8,145,178,0.10),rgba(15,23,42,0.82)_52%,rgba(30,64,175,0.08))]" data-testid="nexus-native-build-status">
        <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 text-cyan-100">NEXUS NATIVE</Badge><CardTitle className="mt-2 text-lg">Remote assurance</CardTitle><p className="mt-1 text-xs leading-5 text-muted-foreground">Every attended session is bound to the endpoint, technician and tenant, then retained with consent and transport evidence.</p></div><Badge variant="outline" className={capable.length ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 text-amber-300"}>{capable.length ? "Service ready" : "Endpoint setup needed"}</Badge></div></CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {BUILD_STAGES.map((stage, index) => { const Icon = stage.icon; return <div key={stage.name} className={`rounded-xl border p-3 ${stage.state === "ready" ? "border-emerald-400/25 bg-emerald-400/[0.05]" : stage.state === "building" ? "border-cyan-400/25 bg-cyan-400/[0.05]" : "border-border/60 bg-black/10"}`}><div className="flex items-center justify-between gap-2"><Icon className={`h-4 w-4 ${stage.state === "ready" ? "text-emerald-300" : "text-cyan-300"}`} /><Badge variant="outline" className="text-[9px] uppercase">{stage.state}</Badge></div><p className="mt-3 text-sm font-semibold">{index + 1}. {stage.name}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{stage.detail}</p></div>; })}
        </CardContent>
      </Card>

      <Tabs defaultValue="fleet">
        <TabsList><TabsTrigger value="fleet"><Monitor className="mr-1.5 h-3.5 w-3.5" />Fleet</TabsTrigger><TabsTrigger value="sessions"><History className="mr-1.5 h-3.5 w-3.5" />Session ledger</TabsTrigger><TabsTrigger value="capabilities"><Clock3 className="mr-1.5 h-3.5 w-3.5" />Roadmap</TabsTrigger></TabsList>
        <TabsContent value="fleet" className="mt-4 space-y-3">
          <div className="relative max-w-xl"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search endpoint, client or operating system" className="pl-9" /></div>
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleDevices.map(device => { const agent = agentById.get(device.nexus_agent_id); const companionEvidence = agent?.native_remote_evidence || {}; const nativeReady = Boolean(agent?.online && [...(agent.agent_runtime_capabilities || []), ...(agent.nexus_shield_capabilities || [])].includes("native_remote_v1") && companionEvidence.status === "ready"); const sessionActive = activeSessionDeviceIds.has(device.id); return <Card key={device.id} className="border-border/60"><CardContent className="flex items-center gap-3 p-4"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${nativeReady ? "bg-emerald-500/10 text-emerald-300" : "bg-muted text-muted-foreground"}`}><Monitor className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{device.name || device.hostname}</p><p className="truncate text-xs text-muted-foreground">{device.client_name || "Managed client"} · {agent?.online ? "Agent online" : agent ? "Agent offline" : "Agent not linked"}</p><p className="truncate text-[11px] text-muted-foreground" title={companionEvidence.detail || companionStateLabel(companionEvidence)}>{agent ? companionStateLabel(companionEvidence) : "Companion needed"}</p></div><Badge variant="outline" className={sessionActive ? "border-amber-400/25 text-amber-300" : nativeReady ? "border-emerald-400/25 text-emerald-300" : "text-muted-foreground"}>{sessionActive ? "Session active" : nativeReady ? "Ready" : companionStateLabel(companionEvidence)}</Badge><Button size="sm" onClick={() => inspectDevice(device)} disabled={!nativeReady || sessionActive}>{sessionActive ? "In session" : "Connect"}</Button></CardContent></Card>; })}
          </div>
        </TabsContent>
        <TabsContent value="sessions" className="mt-4"><Card><CardHeader className="pb-3"><CardTitle className="text-sm">Audited session ledger</CardTitle><p className="text-xs text-muted-foreground">Consent, relay state and endpoint evidence remain linked to every session.</p></CardHeader><CardContent className="space-y-2">{sessions.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No Nexus Native sessions recorded yet.</p> : sessions.map(session => <div key={session.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 p-3"><Clock3 className="h-4 w-4 text-cyan-300" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{session.device_name || session.device_id}</p><p className="text-xs text-muted-foreground">{session.user_name} · {session.client_name || session.client_id} · {displayEvidenceTime(session.started_at)}</p>{lifecycleEvidence(session) && <p className="mt-0.5 truncate text-[11px] capitalize text-muted-foreground">{lifecycleEvidence(session)}</p>}</div><Badge variant="outline" className="capitalize">{session.access_mode || "view"}</Badge>{session.status === "active" && session.transport_state === "connected" && <Button size="sm" variant="outline" onClick={() => openViewer(session)}><MonitorUp className="mr-1.5 h-3.5 w-3.5" />Open viewer</Button>}{["authorised", "active", "ending"].includes(session.status) && <Button size="sm" variant="outline" className="border-rose-500/30 text-rose-200 hover:bg-rose-500/10" onClick={() => endSession(session)} disabled={Boolean(endingSessionId)}>{endingSessionId === session.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "End"}</Button>}{session.status === "active" && <Badge variant="outline" className={session.capture_freshness === "fresh" ? "border-emerald-400/30 text-emerald-300" : session.capture_freshness === "stale" ? "border-amber-400/30 text-amber-200" : "text-muted-foreground"}>{session.capture_freshness === "fresh" ? "Live capture" : session.capture_freshness === "stale" ? "Capture stale" : "Capture unknown"}</Badge>}<Badge variant="outline" className="capitalize">{session.status}</Badge><NexusRemoteRiskBadge risk={session.native_risk} testid={`ledger-session-risk-${session.id}`} /></div>)}</CardContent></Card></TabsContent>
        <TabsContent value="capabilities" className="mt-4"><Card><CardHeader><CardTitle className="text-sm">Roadmap, not availability</CardTitle><p className="text-xs text-muted-foreground">These are intentionally labelled as planned capabilities; only controls represented elsewhere in Nexus are offered to technicians.</p></CardHeader><CardContent className="grid gap-2 md:grid-cols-2">{CAPABILITY_TARGETS.map(item => <div key={item} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4 text-cyan-300" />{item}<Badge variant="outline" className="ml-auto text-[9px] uppercase">Planned</Badge></div>)}</CardContent></Card></TabsContent>
      </Tabs>

      <Dialog open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}>
        <NexusWorkflowDialog eyebrow="Nexus Native" title="Authorise remote support" description="The grant is short-lived, single-session and bound to this technician, tenant and endpoint." icon={MonitorUp} tone="cyan" className="max-w-xl" footer={<><Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button onClick={startSession} disabled={!readiness?.ready || !consent || starting}>{starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MonitorUp className="mr-2 h-4 w-4" />}Issue native grant</Button></>}>
          <div className="rounded-xl border border-border/60 p-3"><p className="text-sm font-semibold">{selected?.name || selected?.hostname}</p><p className="mt-1 text-xs text-muted-foreground">{selected?.client_name || "Managed client"}</p></div>
          <div className={`rounded-xl border p-3 ${readiness?.ready ? "border-emerald-400/25 bg-emerald-400/[0.05]" : "border-amber-400/25 bg-amber-400/[0.05]"}`}><div className="flex items-center gap-2">{checking ? <Loader2 className="h-4 w-4 animate-spin" /> : readiness?.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-amber-300" />}<p className="text-sm font-semibold">{checking ? "Checking agent readiness" : readiness?.ready ? "Native companion ready" : "Native companion unavailable"}</p></div>{readiness?.detail && <p className="mt-1 text-xs text-muted-foreground">{readiness.detail}</p>}{readiness?.ready && <p className="mt-2 text-[11px] text-muted-foreground">Protected companion capability confirmed · agent heartbeat {displayEvidenceTime(readiness.agent_last_seen)}</p>}</div>
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3"><p className="text-sm font-medium">{mode === "control" ? "Interactive control request" : "View-only access"}</p><p className="mt-1 text-xs text-muted-foreground">{mode === "control" ? "The endpoint user will see a distinct, attended control-consent prompt. Clipboard and file transfer remain disabled." : "Mouse, keyboard, clipboard and file transfer remain disabled for this session."}</p></div>
          <div className="space-y-2"><Label>Purpose</Label><Textarea value={purpose} onChange={event => setPurpose(event.target.value)} placeholder="What will this session be used to diagnose or repair?" maxLength={500} /></div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 p-3"><Checkbox checked={consent} onCheckedChange={value => setConsent(Boolean(value))} /><span className="text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Customer consent is confirmed.</strong> The endpoint companion will still show the local attended prompt and can reject or revoke this session.</span></label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-3"><Checkbox checked={mode === "control"} onCheckedChange={value => setMode(value ? "control" : "view")} /><span className="text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Request interactive control.</strong> This starts a fresh, attended session. The endpoint user must explicitly approve mouse and keyboard control and can stop it locally at any time.</span></label>
        </NexusWorkflowDialog>
      </Dialog>
      <Dialog open={studioOpen} onOpenChange={open => setStudioOpen(Boolean(open))}>
        <NexusWorkflowDialog eyebrow="Nexus Remote" title="Session Studio" description="Shape the session window around how you work — the studio reorders its tools around your recorded habits." icon={SlidersHorizontal} tone="cyan" className="max-w-2xl" footer={<Button variant="outline" onClick={() => setStudioOpen(false)} disabled={studioSaving}>Done</Button>}>
          <div className="space-y-2"><p className="text-sm font-semibold">Layout preset</p><div className="grid gap-2 sm:grid-cols-2">{Object.entries(STUDIO_PRESETS).map(([key, preset]) => <button key={key} type="button" onClick={() => saveStudioPrefs(applyPreset(studioPrefs, key))} className={`rounded-xl border p-3 text-left transition-colors ${studioPrefs.preset === key ? "border-cyan-400/40 bg-cyan-400/10" : "border-border/60 hover:border-cyan-400/25"}`} data-testid={`studio-preset-${key}`}><p className="text-sm font-semibold">{preset.label}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{preset.detail}</p></button>)}</div></div>
          <div className="space-y-2"><p className="text-sm font-semibold">Sidebar panels</p><div className="grid gap-2 sm:grid-cols-3">{[["evidence", "Session evidence"], ["timeline", "Session timeline"], ["files", "Files panel"]].map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-2 rounded-xl border border-border/60 p-3"><Checkbox checked={studioPrefs.panels[key]} onCheckedChange={value => saveStudioPrefs({ ...studioPrefs, panels: { ...studioPrefs.panels, [key]: Boolean(value) } })} data-testid={`studio-panel-${key}`} /><span className="text-xs">{label}</span></label>)}</div></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2"><p className="text-sm font-semibold">Default session mode</p><div className="flex gap-2"><Button variant={studioPrefs.default_mode === "view" ? "secondary" : "outline"} size="sm" onClick={() => saveStudioPrefs({ ...studioPrefs, default_mode: "view" })}>View only</Button><Button variant={studioPrefs.default_mode === "control" ? "secondary" : "outline"} size="sm" onClick={() => saveStudioPrefs({ ...studioPrefs, default_mode: "control" })}>Control</Button></div></div>
            <div className="space-y-2"><p className="text-sm font-semibold">Default display view</p><div className="flex gap-2"><Button variant={studioPrefs.default_display === "all" ? "secondary" : "outline"} size="sm" onClick={() => saveStudioPrefs({ ...studioPrefs, default_display: "all" })}>All displays</Button><Button variant={studioPrefs.default_display === "primary" ? "secondary" : "outline"} size="sm" onClick={() => saveStudioPrefs({ ...studioPrefs, default_display: "primary" })}>Primary display</Button></div></div>
          </div>
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4" data-testid="studio-insights"><div className="flex items-center gap-2"><Badge variant="outline" className="border-cyan-400/25 text-cyan-100"><Sparkles className="mr-1 h-3 w-3" />{studioMaturity.label}</Badge><span className="text-[11px] text-muted-foreground">{studioInsights ? `${studioInsights.event_total} recorded session actions` : "Adaptation starts once you work a session"}</span></div><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{studioMaturity.detail}</p>{studioSuggestions.length > 0 && <ul className="mt-2 space-y-1">{studioSuggestions.map((item) => <li key={item.id} className="rounded-lg border border-border/50 px-2 py-1 text-[11px] text-muted-foreground">{item.text}</li>)}</ul>}{studioInsights && <div className="mt-2 flex flex-wrap gap-1">{orderQuickActions(studioInsights.quick_action_order || [], studioInsights.usage_counts || {}).slice(0, 5).map(tool => <Badge key={tool} variant="outline" className="text-[9px] uppercase">{TOOL_LABELS[tool] || tool} · {studioInsights.usage_counts?.[tool] || 0}</Badge>)}</div>}</div>
          <p className="text-[11px] leading-4 text-muted-foreground">Adaptation is derived only from recorded studio-tool counters. No desktop content, credentials or endpoint paths are ever collected.</p>
        </NexusWorkflowDialog>
      </Dialog>
      {viewerSession && <section className="fixed inset-0 z-[100] flex min-h-screen flex-col bg-[radial-gradient(circle_at_top_right,rgba(8,145,178,0.16),transparent_32%),linear-gradient(135deg,#07121c,#020617_62%,#07131f)] text-foreground" data-testid="nexus-remote-viewer">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-cyan-400/15 bg-black/20 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10"><MonitorUp className="h-4 w-4 text-cyan-200" /></span><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Nexus Remote · attended {viewerSession?.access_mode === "control" ? "control" : "view"}</p><h2 className="truncate text-base font-semibold">{viewerSession?.device_name || viewerSession?.device_id || "Remote desktop"}</h2></div></div>
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-cyan-400/25 bg-cyan-400/5 text-cyan-100">{viewerSession?.access_mode === "control" ? "Control consented" : "View-only"}</Badge><NexusRemoteRiskBadge risk={viewerSessionRecord?.native_risk || viewerSession?.native_risk} testid="viewer-session-risk" /><Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)} title="Session commands (Ctrl K)" data-testid="viewer-command-palette-open"><Command className="mr-1.5 h-3.5 w-3.5" />Commands<kbd className="ml-1.5 rounded border border-white/10 bg-black/30 px-1 font-mono text-[9px]">K</kbd></Button><Button variant="outline" size="sm" onClick={toggleFullscreen} title="Use the entire display for the remote canvas">{viewerFullscreen ? <Minimize2 className="mr-1.5 h-3.5 w-3.5" /> : <Maximize2 className="mr-1.5 h-3.5 w-3.5" />}{viewerFullscreen ? "Exit full screen" : "Full screen"}</Button><Button variant="outline" size="sm" onClick={() => { openViewer(viewerSession, { popOut: true }); recordStudioUsage("pop_out"); }}><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Pop out</Button><Button variant="outline" size="sm" onClick={() => setStudioOpen(true)} data-testid="viewer-studio-open"><SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />Customise</Button><Button variant="outline" size="sm" onClick={closeViewer} disabled={Boolean(endingSessionId)}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Return</Button><Button variant="destructive" size="sm" onClick={() => endSession(viewerSession)} disabled={Boolean(endingSessionId)}>{endingSessionId === viewerSession?.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}End session</Button></div>
        </header>
        <main className={`grid min-h-0 flex-1 gap-3 p-3 ${viewerFocus ? "grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_20rem]"} lg:p-5`}>
          <div className="flex min-h-[50vh] flex-col overflow-hidden rounded-2xl border border-cyan-400/20 bg-black shadow-2xl shadow-cyan-950/30"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-3 py-2 text-[11px] text-muted-foreground"><span role="status" aria-live="polite" className={`font-medium uppercase tracking-[0.14em] ${viewerCaptureState === "stale" || viewerState === "stale" ? "text-amber-200" : viewerCaptureState === "ended" || viewerState === "disconnected" ? "text-rose-200" : "text-emerald-200"}`}>{viewerStatusLabel}</span>{viewerDisplays.length > 0 && <div className="flex items-center gap-1" data-testid="viewer-display-switcher"><Button variant={viewerDisplayIndex === "all" ? "secondary" : "ghost"} size="sm" className="h-7 px-2 text-[11px]" onClick={() => { setViewerDisplayIndex("all"); recordStudioUsage("display_all"); }} data-testid="viewer-display-all">All displays</Button>{viewerDisplays.map((display) => <Button key={display.index} variant={viewerDisplayIndex === display.index ? "secondary" : "ghost"} size="sm" className="h-7 px-2 text-[11px]" onClick={() => { setViewerDisplayIndex(display.index); recordStudioUsage("display_focus"); }} data-testid={`viewer-display-${display.index}`}>{display.name || `Display ${display.index + 1}`}{display.primary ? " · Primary" : ""}</Button>)}</div>}<div className="flex items-center gap-1" data-testid="viewer-adaptive-tools">{orderedViewerTools.map((key) => { const spec = viewerToolSpecs[key]; const Icon = spec.icon; return <Button key={key} variant="ghost" size="sm" className={`h-7 px-2 ${spec.wide ? "text-[11px]" : ""}`} onClick={spec.onClick} disabled={spec.disabled} title={spec.title} data-testid={`viewer-tool-${key}`}>{spec.content || <Icon className="h-3.5 w-3.5" />}</Button>; })}</div><span className="hidden font-mono text-[10px] sm:inline">{viewerSession?.id}</span></div>{viewerFrame && viewerCaptureState !== "stale" && viewerCaptureState !== "ended" && viewerState !== "stale" && viewerState !== "disconnected" ? <div className={`relative flex min-h-0 flex-1 items-center justify-center ${viewerFit || viewerActiveDisplay ? "overflow-hidden" : "overflow-auto p-6"}`} style={cropGeometry ? cropGeometry.box : undefined} data-testid="viewer-frame-area"><img src={viewerFrame} alt="Live endpoint desktop" aria-label={viewerCanControl ? "Live endpoint desktop. Click to send attended control input." : undefined} draggable={false} onLoad={(event) => setViewerFrameSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })} tabIndex={viewerCanControl ? 0 : -1} onMouseMove={handleViewerPointerMove} onClick={event => { event.currentTarget.focus(); handleViewerPointerButton(event, true); handleViewerPointerButton(event, false); }} onContextMenu={event => { if (viewerCanControl) event.preventDefault(); }} onKeyDown={event => handleViewerKey(event, true)} onKeyUp={event => handleViewerKey(event, false)} className={`${viewerActiveDisplay ? "block" : viewerFit ? "block max-h-full max-w-full object-contain" : "block h-auto max-w-none shadow-2xl"} ${viewerCanControl ? "cursor-crosshair outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" : ""}`} style={cropGeometry ? cropGeometry.image : viewerFit ? undefined : { width: `${Math.round(viewerZoom * 100)}%` }} /></div> : <div role="status" aria-live="polite" className="flex min-h-80 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">{viewerCaptureState === "stale" || viewerState === "stale" ? "The last desktop capture is no longer current, so it has been removed from view. Check the endpoint connection or end the session." : viewerCaptureState === "ended" ? "This session is no longer active. Start a new attended session when the endpoint user is ready." : viewerState === "disconnected" ? "The endpoint companion disconnected, so its desktop image has been removed. Waiting for a new protected connection." : <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{viewerCaptureState === "awaiting_consent" ? "Waiting for the endpoint user to accept…" : viewerState === "reconnecting" ? "Checking the secure relay…" : "Waiting for the attended companion to send its first frame…"}</>}</div>}</div>
          {!viewerFocus && <aside className="space-y-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4" data-testid="session-studio-card"><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Session Studio</p><Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setStudioOpen(true)} data-testid="session-studio-open"><SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />Customise</Button></div><div className="mt-2 flex items-center gap-2"><Badge variant="outline" className="border-cyan-400/25 text-cyan-100"><Sparkles className="mr-1 h-3 w-3" />{studioMaturity.label}</Badge><span className="text-[11px] text-muted-foreground">{studioPrefs.preset} preset</span></div><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{studioMaturity.detail}</p>{studioSuggestions.length > 0 && <ul className="mt-2 space-y-1">{studioSuggestions.slice(0, 2).map((item) => <li key={item.id} className="rounded-lg border border-border/50 px-2 py-1 text-[11px] text-muted-foreground">{item.text}</li>)}</ul>}</div>{studioPrefs.panels.evidence && <div className={`rounded-2xl border border-border/60 bg-background/65 ${studioDensity}`}><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Session journal</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">Chapters are derived only from recorded consent, transport and capture evidence.</p><div className="mt-3 space-y-2" data-testid="session-journal">{!studioPrefs.panels.timeline ? null : sessionChapters.length ? sessionChapters.map((chapter) => <div key={`${chapter.key}-${chapter.at}`} className="rounded-lg border border-border/50 px-3 py-2" data-testid={`session-chapter-${chapter.key}`}><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-cyan-200">{chapter.offset_seconds == null ? "--:--" : formatOffset(chapter.offset_seconds)}</span><p className="text-xs font-medium">{chapter.title}</p></div><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{chapter.detail}</p><p className="mt-0.5 text-[10px] text-muted-foreground/80">{displayEvidenceTime(chapter.at)}</p></div>) : <p className="text-xs text-muted-foreground">Waiting for protected endpoint evidence.</p>}</div>{sessionLabour && <div className="mt-3 rounded-lg border border-cyan-400/25 bg-cyan-400/[0.06] px-3 py-2" data-testid="session-suggested-labour"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">Suggested ticket labour</p><p className="mt-1 text-lg font-semibold text-foreground">{sessionLabour.minutes} min</p><p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{sessionLabour.rationale} Confirm it on the ticket before it is billed.</p></div>}</div>}<div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4 text-xs leading-5 text-muted-foreground"><p className="font-semibold text-foreground">Control boundary</p><p className="mt-1">{viewerSession?.access_mode === "control" ? "Endpoint control is locally consented. Select the desktop to send bounded mouse and keyboard input, and use the Files panel for scanned, audited transfers; clipboard stays disabled and every event is relayed through the agent for audit." : "This session is view-only. Mouse, keyboard and clipboard stay locked until the endpoint presents a separate control-consent prompt; file transfer still runs through the audited Nexus Agent channel, and every action is auditable."}</p></div>{studioPrefs.panels.files && <div className={`rounded-2xl border border-border/60 bg-background/65 ${studioDensity}`} data-testid="session-file-panel"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Files in this session</p><p className="mt-1 text-[11px] text-muted-foreground">Move files over the Nexus Agent's audited channel without leaving the session window.</p><div className="mt-3 space-y-2"><div className="flex gap-1.5"><Input value={remotePath} onChange={(event) => setRemotePath(event.target.value)} placeholder="C:\Users\Public" className="h-8 text-xs" aria-label="Endpoint directory" data-testid="session-file-path" /><Button variant="outline" size="sm" className="h-8" onClick={browseRemoteDirectory} disabled={transferBusy} data-testid="session-file-browse"><FolderOpen className="h-3.5 w-3.5" /></Button></div><div className="flex gap-1.5"><Input value={retrievalPath} onChange={(event) => setRetrievalPath(event.target.value)} placeholder="Endpoint file to retrieve" className="h-8 text-xs" aria-label="Endpoint file to retrieve" data-testid="session-file-retrieve-path" /><Button variant="outline" size="sm" className="h-8" onClick={requestRemoteFile} disabled={transferBusy} data-testid="session-file-retrieve"><FileDown className="h-3.5 w-3.5" /></Button></div><div className="flex gap-1.5"><input ref={sendFileRef} type="file" className="min-w-0 flex-1 text-[11px] text-muted-foreground file:mr-2 file:h-7 file:rounded-md file:border file:border-border file:bg-muted/40 file:px-2 file:text-[11px]" aria-label="File to send to the endpoint" data-testid="session-file-send-input" /><Input value={sendDestination} onChange={(event) => setSendDestination(event.target.value)} placeholder="Destination path" className="h-8 w-32 text-xs" aria-label="Endpoint destination path" data-testid="session-file-destination" /><Button variant="outline" size="sm" className="h-8" onClick={sendRemoteFile} disabled={transferBusy} data-testid="session-file-send"><FileUp className="h-3.5 w-3.5" /></Button></div><div className="max-h-40 space-y-1 overflow-y-auto" data-testid="session-file-transfers">{transfers.length === 0 ? <p className="text-[11px] text-muted-foreground">No file transfers yet in this session.</p> : transfers.map((transfer) => <div key={transfer.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-2 py-1 text-[11px]"><span className="truncate" title={transfer.source_path || transfer.filename}>{transfer.filename || transfer.id}</span><Badge variant="outline" className="shrink-0 text-[9px] uppercase">{transfer.direction === "endpoint_to_technician" ? "Inbound" : "Outbound"} · {transfer.status}</Badge></div>)}</div></div></div>}</aside>}
        </main>
        <NexusRemoteCommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          commands={viewerCommands}
          sessionLabel={`${viewerSession?.device_name || viewerSession?.device_id || "session"} · ${viewerSession?.access_mode === "control" ? "control" : "view-only"} · ${viewerSession?.id || ""}`}
        />
      </section>}
    </div>
  );
}
