import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import TicketBlueprintPanel from "@/components/tickets/TicketBlueprintPanel";
import QuoteNudgeBanner from "@/components/tickets/QuoteNudgeBanner";
import KitPickerDialog from "@/components/tickets/KitPickerDialog";
import TicketLinkedDevices from "@/components/tickets/TicketLinkedDevices";
import TicketEnrichmentRail from "@/components/tickets/TicketEnrichmentRail";
import TicketConversationTab from "@/components/tickets/TicketConversationTab";
import {
  TicketWorksheetTab, TicketAttachmentsTab, TicketItemsTab,
  TicketChildrenTab, TicketTimeTab, TicketAuditTab,
} from "@/components/tickets/TicketSecondaryTabs";
import TicketBurndownBar from "@/components/tickets/TicketBurndownBar";
import TicketWorkflowPanel from "@/components/tickets/TicketWorkflowPanel";
import TicketConnectivityVerification from "@/components/tickets/TicketConnectivityVerification";
import TicketJumpAccessRequest from "@/components/tickets/TicketJumpAccessRequest";
import TicketServiceTierWidget from "@/components/tickets/TicketServiceTierWidget";
import { TicketModuleHeader, TicketToolAction, TicketToolsCenter, TicketWorkspaceTabs } from "@/components/tickets/TicketWorkspaceShell";
import {
  TicketRow, TicketGroupSection, useDensityMode, DensityToggle,
  GroupBySelector, useGroupedTickets,
} from "@/components/tickets/TicketRow";
import AICopilotStrip from "@/components/tickets/AICopilotStrip";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import SavedViewsBar from "@/components/SavedViewsBar";
import HeroTile from "@/components/HeroTile";
import {
  EmailDialog,
  ChildTicketDialog,
  MergeDialog,
  LogTimeDialog,
  NotifyClientDialog,
  AddItemsDialog,
  PushInvoiceDialog,
} from "@/components/tickets/TicketDialogs";
import {
  CreateTicketDialog,
  CreateWorkshopJobDialog,
  CreateFieldJobDialog,
} from "@/components/tickets/CreateDialogs";
import { TicketTimelineTab } from "@/components/ai/TicketTimelineTab";
import { WhisperRail } from "@/components/ai/WhisperRail";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { PageShell } from "@/components/design-system";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import {
  Plus, Search, Clock, AlertCircle, CheckCircle, Circle, Loader2, RefreshCw,
  Ticket, MessageSquare, Mail, Send, User, ArrowLeft, Tag,
  Timer, GitBranch, Merge, Eye, History, X, Play,
  BookOpen, Sparkles, ThumbsUp, MonitorCheck, Wifi,
  Terminal, Zap, Brain, ExternalLink, Shield, Cpu, Users,
  Download, Trash2, ShoppingCart, Receipt,
  Wrench, MapPin, Radio, Pause, DollarSign, Package,
  Camera, QrCode, ClipboardList, Bell, Image as ImageIcon, ListChecks,
  Settings2, AlertTriangle, Pencil
} from "lucide-react";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";
import { priorityConfig, statusConfig, WS_STATUSES as WS_STATUSES_CONFIG } from "@/config/ticketConfig";
import TicketConsoleHeader from "@/components/tickets/TicketConsoleHeader";
import TicketHeaderAction from "@/components/tickets/TicketHeaderAction";
import { collectionFromResponse, matchTicketByReference, ticketToolAvailability } from "@/lib/ticketWorkspaceHelpers";
import "@/styles/dashboard-ticker.css";
import {
  LOCAL_PREVIEW_CLIENTS, LOCAL_PREVIEW_DEVICES, LOCAL_PREVIEW_NOTE_COUNTS,
  LOCAL_PREVIEW_PRODUCTS, LOCAL_PREVIEW_SCRIPTS, LOCAL_PREVIEW_SERVICES,
  LOCAL_PREVIEW_TICKETS, LOCAL_PREVIEW_USERS, localPreviewCollection,
  localPreviewRecord, localPreviewTicketDetail,
} from "@/lib/ticketPreviewData";

function uniqueByIdentity(items = []) {
  const seen = new Set();
  return items.filter((item, index) => {
    const identity = String(item?.id || item?.email || item?.name || index).trim().toLowerCase();
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function resolutionMinutes(ticket) {
  const explicit = Number(ticket?.resolution_time_minutes);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const completedAt = ticket?.closed_at || ticket?.resolved_at || ticket?.updated_at;
  if (!ticket?.created_at || !completedAt) return null;
  const elapsed = Math.round((new Date(completedAt).getTime() - new Date(ticket.created_at).getTime()) / 60_000);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

function formatDuration(minutes) {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${(minutes / 1440).toFixed(minutes < 14_400 ? 1 : 0)}d`;
}

export default function TicketsPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [attentionFilter, setAttentionFilter] = useState("all");
  const [density, setDensity] = useDensityMode();
  const [groupBy, setGroupBy] = useState(() => {
    try { return localStorage.getItem("nexus.tickets.groupBy") || "age"; } catch { return "age"; }
  });
  useEffect(() => { try { localStorage.setItem("nexus.tickets.groupBy", groupBy); } catch {} }, [groupBy]);
  const [activeViewId, setActiveViewId] = useState(null);

  const applyView = (v) => {
    if (!v) { setActiveViewId(null); setAttentionFilter("all"); return; }
    setActiveViewId(v.id);
    const f = v.filters || {};
    if (f.status != null) setStatusFilter(f.status);
    if (f.priority != null) setPriorityFilter(f.priority);
    if (f.attention != null) setAttentionFilter(f.attention);
    if (f.search != null) setSearchQuery(f.search);
    if (v.group_by) setGroupBy(v.group_by);
    if (v.density) setDensity(v.density);
  };
  const currentSnapshot = {
    filters: { status: statusFilter, priority: priorityFilter, search: searchQuery, attention: attentionFilter },
    group_by: groupBy, density, sort: "created_desc",
  };

  // Pickup a view passed from another page (e.g. Workspace)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("nexus.tickets.applyView");
      if (raw) {
        const v = JSON.parse(raw);
        applyView(v);
        localStorage.removeItem("nexus.tickets.applyView");
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticket details use a stable layout. Core information and tools cannot be hidden by a saved preference.
  const panelVisible = {
    serviceTier: true, aiAnalysis: true, related: true,
    enrichment: true, copilot: true, burndown: true, workflow: true,
    cockpit: true, runScripts: true, quickActions: false, devicePanel: true,
  };
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // Detail view state
  const [viewingTicket, setViewingTicket] = useState(null);
  const [runbookCreating, setRunbookCreating] = useState(false);
  const [ticketRunbook, setTicketRunbook] = useState(null);
  const [runbookSuggestions, setRunbookSuggestions] = useState([]);
  const [selectedRunbookSuggestion, setSelectedRunbookSuggestion] = useState(null);
  const [detailTab, setDetailTab] = useState("conversation");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [ticketNotes, setTicketNotes] = useState([]);
  const [ticketEmails, setTicketEmails] = useState([]);
  const [childTickets, setChildTickets] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [cannedResponses, setCannedResponses] = useState([]);
  const [suggestions, setSuggestions] = useState(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  // AI enhanced features
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [proofreadResult, setProofreadResult] = useState(null);
  const [proofreadLoading, setProofreadLoading] = useState(false);
  const [scripts, setScripts] = useState([]);
  const [deviceStatus, setDeviceStatus] = useState(null);
  const [newNote, setNewNote] = useState("");
  const [conversationType, setConversationType] = useState("public");
  const [isEmailOpen, setIsEmailOpen] = useState(false);
  const [emailSignature, setEmailSignature] = useState("");
  const [emailForm, setEmailForm] = useState({ to: "", cc: "", bcc: "", subject: "", body: "" });
  const [isClientNotifyOpen, setIsClientNotifyOpen] = useState(false);
  const [notifyForm, setNotifyForm] = useState({ email: "", subject: "", message: "" });
  const [ticketAttachments, setTicketAttachments] = useState([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [ticketProducts, setTicketProducts] = useState([]);
  const [ticketPurchaseOrders, setTicketPurchaseOrders] = useState([]);
  // SMS thread state
  const [ticketSms, setTicketSms] = useState([]);
  const [smsForm, setSmsForm] = useState({ to: "", message: "", template_key: "" });
  const [smsTemplates, setSmsTemplates] = useState([]);
  const [smsSending, setSmsSending] = useState(false);
  const [smsConfig, setSmsConfig] = useState({ signature: "", append_signature: true });
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [isKitPickerOpen, setIsKitPickerOpen] = useState(false);
  const [addItemProduct, setAddItemProduct] = useState("");
  const [addItemQty, setAddItemQty] = useState(1);
  const [allProducts, setAllProducts] = useState([]);
  const [isPushInvoiceOpen, setIsPushInvoiceOpen] = useState(false);
  const [invoicesList, setInvoicesList] = useState([]);
  const [pushToExisting, setPushToExisting] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  // Bulk action state
  const [selectedTickets, setSelectedTickets] = useState(new Set());
  const [bulkAction, setBulkAction] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [workshopJobs, setWorkshopJobs] = useState([]);
  const [fieldJobs, setFieldJobs] = useState([]);
  const [wsDialog, setWsDialog] = useState(false);
  const [wsForm, setWsForm] = useState({ client_id: "", customer_name: "", customer_phone: "", customer_email: "", device_type: "", device_brand: "", device_model: "", serial_number: "", fault_description: "", priority: "normal", assigned_to: "", assigned_to_name: "" });
  const [fjDialog, setFjDialog] = useState(false);
  const [fjForm, setFjForm] = useState({ client_id: "", customer_name: "", customer_phone: "", customer_email: "", service_address: "", zone: "", description: "", job_category: "installation", priority: "normal", assigned_to: "", assigned_to_name: "", scheduled_date: "", scheduled_time: "" });
  const [viewWsJob, setViewWsJob] = useState(null);
  const [viewFjJob, setViewFjJob] = useState(null);
  const [wsPartDialog, setWsPartDialog] = useState(false);
  const [wsPartProduct, setWsPartProduct] = useState("");
  const [wsPartQty, setWsPartQty] = useState(1);
  const [isChildOpen, setIsChildOpen] = useState(false);
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [isTimeOpen, setIsTimeOpen] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [tagInput, setTagInput] = useState("");
  const [formData, setFormData] = useState({
    title: "", description: "", client_id: "", priority: "medium", category: "support",
    assigned_to: "", parent_id: "", tags: [], ticket_type: "incident", impact: "medium",
    source: "internal", due_date: "", estimated_hours: "", contact_id: "", asset_id: "",
    device_id: "",
    cc: [], watchers: []
  });
  const [childForm, setChildForm] = useState({ title: "", description: "", priority: "medium" });
  const [mergeIds, setMergeIds] = useState([]);
  const [timeForm, setTimeForm] = useState({ minutes: 15, description: "", billable: true });
  const [noteCounts, setNoteCounts] = useState({});
  const [ticketViewers, setTicketViewers] = useState({}); // kept for internal tracking only
  const [worksheetItems, setWorksheetItems] = useState([]);
  const [newWorksheetItem, setNewWorksheetItem] = useState("");
  // Workshop enrichment state
  const [wsNotes, setWsNotes] = useState([]);
  const [wsNewNote, setWsNewNote] = useState("");
  const [wsConversationType, setWsConversationType] = useState("public");
  const [wsConversation, setWsConversation] = useState({ notes: [], emails: [], sms: [] });
  const [wsConversationNote, setWsConversationNote] = useState("");
  const [wsEmailForm, setWsEmailForm] = useState({ to: "", cc: "", bcc: "", subject: "", body: "" });
  const [wsSmsForm, setWsSmsForm] = useState({ to: "", message: "", template_key: "" });
  const [wsPhotos, setWsPhotos] = useState([]);
  const [wsPhotoUploading, setWsPhotoUploading] = useState(false);
  const [wsChecklist, setWsChecklist] = useState([]);
  const [wsNewCheckItem, setWsNewCheckItem] = useState("");
  const [wsAuditLog, setWsAuditLog] = useState([]);
  const [wsQuote, setWsQuote] = useState(null);
  const [wsQuoteDialog, setWsQuoteDialog] = useState(false);
  const [wsQuoteItems, setWsQuoteItems] = useState([{ description: "", qty: 1, price: 0 }]);
  const [wsQuoteNotes, setWsQuoteNotes] = useState("");
  const [wsRepairHistory, setWsRepairHistory] = useState([]);
  const [wsNotifyDialog, setWsNotifyDialog] = useState(false);
  const [wsNotifyForm, setWsNotifyForm] = useState({ email: "", subject: "", message: "" });
  const [wsInvoiceDialog, setWsInvoiceDialog] = useState(false);
  const [wsInvoiceList, setWsInvoiceList] = useState([]);
  const [wsIntakeDialog, setWsIntakeDialog] = useState(false);
  const [wsIntakeForm, setWsIntakeForm] = useState({ customer_name: "", customer_phone: "", customer_email: "", device_type: "", device_brand: "", device_model: "", serial_number: "", fault_description: "", condition_on_arrival: "", accessories_received: [], customer_password: "", warranty_status: "unknown", warranty_expiry: "" });
  const [wsHeaderEdit, setWsHeaderEdit] = useState(false);
  const [wsHeaderDraft, setWsHeaderDraft] = useState("");
  const [wsTemplateDialog, setWsTemplateDialog] = useState(false);
  const [wsTemplates, setWsTemplates] = useState({});
  // Field job enrichment state
  const [fjNotes, setFjNotes] = useState([]);
  const [fjNewNote, setFjNewNote] = useState("");
  const [fjConversationType, setFjConversationType] = useState("public");
  const [fjConversation, setFjConversation] = useState({ notes: [], emails: [], sms: [] });
  const [fjConversationNote, setFjConversationNote] = useState("");
  const [fjEmailForm, setFjEmailForm] = useState({ to: "", cc: "", bcc: "", subject: "", body: "" });
  const [fjSmsForm, setFjSmsForm] = useState({ to: "", message: "", template_key: "" });
  const [fjPhotos, setFjPhotos] = useState([]);
  const [fjPhotoUploading, setFjPhotoUploading] = useState(false);
  const [fjChecklist, setFjChecklist] = useState([]);
  const [fjNewCheckItem, setFjNewCheckItem] = useState("");
  const [fjAuditLog, setFjAuditLog] = useState([]);
  const [fjQuote, setFjQuote] = useState(null);
  const [fjQuoteDialog, setFjQuoteDialog] = useState(false);
  const [fjQuoteItems, setFjQuoteItems] = useState([{ description: "", qty: 1, price: 0 }]);
  const [fjQuoteNotes, setFjQuoteNotes] = useState("");
  const [fjEquipment, setFjEquipment] = useState([]);
  const [fjEquipDialog, setFjEquipDialog] = useState(false);
  const [fjEquipForm, setFjEquipForm] = useState({ equipment_type: "", brand: "", model: "", serial_number: "", mac_address: "", ip_address: "", config_notes: "", action: "installed" });
  const [fjMaterials, setFjMaterials] = useState([]);
  const [fjMatDialog, setFjMatDialog] = useState(false);
  const [fjMatForm, setFjMatForm] = useState({ material: "", quantity: 1, unit: "meters", unit_cost: 0 });
  const [fjSiteInfo, setFjSiteInfo] = useState({});
  const [fjSiteDialog, setFjSiteDialog] = useState(false);
  const [fjHeaderEdit, setFjHeaderEdit] = useState(false);
  const [fjHeaderDraft, setFjHeaderDraft] = useState("");
  const [fjJobHistory, setFjJobHistory] = useState([]);
  const [fjNotifyDialog, setFjNotifyDialog] = useState(false);
  const [fjNotifyForm, setFjNotifyForm] = useState({ email: "", subject: "", message: "" });
  const [fjInvoiceDialog, setFjInvoiceDialog] = useState(false);
  const [fjInvoiceList, setFjInvoiceList] = useState([]);
  const [fjTemplateDialog, setFjTemplateDialog] = useState(false);
  const [fjTemplates, setFjTemplates] = useState({});
  const [triageResult, setTriageResult] = useState(null);
  const [triaging, setTriaging] = useState(false);
  const [enrichment, setEnrichment] = useState(null);
  const [clientContacts, setClientContacts] = useState([]);
  const [createClientContacts, setCreateClientContacts] = useState([]);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    if (!isCreateOpen || !formData.client_id) {
      setCreateClientContacts([]);
      return;
    }
    let cancelled = false;
    axios.get(`${API}/clients/${formData.client_id}/contacts`, { headers })
      .then(response => {
        if (!cancelled) setCreateClientContacts(collectionFromResponse(response.data, ["contacts"]));
      })
      .catch(() => {
        if (!cancelled) setCreateClientContacts([]);
      });
    return () => { cancelled = true; };
  }, [formData.client_id, headers, isCreateOpen]);


  const createRunbookFromTicket = async () => {
    if (!viewingTicket) return;
    setRunbookCreating(true);
    try {
      const response = await axios.post(
        `${API}/runbooks/from-ticket/${viewingTicket.id}`,
        { publish: true },
        { headers },
      );
      setTicketRunbook(response.data);
      toast.success(response.data?.already_exists ? "This ticket already has a reusable runbook" : `Reusable runbook published: ${response.data?.title || "Untitled runbook"}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not create a runbook. Add resolution notes and try again.");
    } finally {
      setRunbookCreating(false);
    }
  };

  const addRunbookToInternalNote = () => {
    if (!selectedRunbookSuggestion) return;
    const steps = (selectedRunbookSuggestion.steps || []).map((step, index) => (
      `${index + 1}. ${step.step || "Step"}${step.detail ? ` — ${step.detail}` : ""}`
    ));
    const runbookNote = [
      `Runbook used: ${selectedRunbookSuggestion.title}`,
      selectedRunbookSuggestion.summary || "",
      "",
      ...steps,
    ].filter(Boolean).join("\n");
    setConversationType("note");
    setNewNote((current) => current ? `${current}\n\n${runbookNote}` : runbookNote);
    setDetailTab("conversation");
    axios.post(`${API}/knowledge-runbooks/${selectedRunbookSuggestion.id}/used`, {}, { headers }).catch(() => {});
    setSelectedRunbookSuggestion(null);
    toast.success("Runbook steps added to the internal note");
  };

  useEffect(() => {
    if (!viewingTicket?.id) {
      setTicketRunbook(null);
      setRunbookSuggestions([]);
      return undefined;
    }
    let active = true;
    Promise.all([
      axios.get(`${API}/ticket-runbooks/${viewingTicket.id}`, { headers }),
      axios.get(`${API}/tickets/${viewingTicket.id}/runbook-suggestions`, { headers }),
    ])
      .then(([runbookResponse, suggestionsResponse]) => {
        if (!active) return;
        setTicketRunbook(runbookResponse.data || null);
        setRunbookSuggestions(Array.isArray(suggestionsResponse.data) ? suggestionsResponse.data : []);
      })
      .catch(() => {
        if (!active) return;
        setTicketRunbook(null);
        setRunbookSuggestions([]);
      });
    return () => { active = false; };
  }, [viewingTicket?.id, headers]);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, cRes, uRes, crRes, ncRes, dRes, pRes, wsRes, fjRes, svcRes] = await Promise.all([
        axios.get(`${API}/tickets`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/users`, { headers }),
        axios.get(`${API}/canned-responses`, { headers }),
        axios.get(`${API}/tickets/note-counts`, { headers }),
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/products`, { headers }),
        axios.get(`${API}/workshop/jobs`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/pro-pack/service-catalog`, { headers }).catch(() => ({ data: [] })),
      ]);
      setTickets(localPreviewCollection(collectionFromResponse(tRes.data, ["tickets"]), LOCAL_PREVIEW_TICKETS));
      setClients(localPreviewCollection(collectionFromResponse(cRes.data, ["clients"]), LOCAL_PREVIEW_CLIENTS));
      setUsers(uniqueByIdentity(localPreviewCollection(collectionFromResponse(uRes.data, ["users"]), LOCAL_PREVIEW_USERS)));
      setCannedResponses(collectionFromResponse(crRes.data, ["responses", "canned_responses"]));
      setNoteCounts(localPreviewRecord(ncRes.data, LOCAL_PREVIEW_NOTE_COUNTS));
      setDevices(localPreviewCollection(collectionFromResponse(dRes.data, ["devices"]), LOCAL_PREVIEW_DEVICES));
      setAllProducts(localPreviewCollection(collectionFromResponse(pRes.data, ["products"]), LOCAL_PREVIEW_PRODUCTS));
      setWorkshopJobs(collectionFromResponse(wsRes.data, ["jobs"]));
      setFieldJobs(collectionFromResponse(fjRes.data, ["jobs", "field_jobs"]));
      setServices(localPreviewCollection(collectionFromResponse(svcRes.data, ["services"]), LOCAL_PREVIEW_SERVICES));
      // Fetch active viewers for tickets
      try {
        const vRes = await axios.get(`${API}/tickets/active-viewers`, { headers });
        setTicketViewers(vRes.data);
      } catch { setTicketViewers({}); }
    } catch { toast.error("Failed to fetch tickets"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // Keep the attention ticker current without reloading the supporting form data
  // or interrupting a technician while they work in the queue.
  useEffect(() => {
    const refreshAttentionFeed = async () => {
      try {
        const response = await axios.get(`${API}/tickets`, { headers });
        setTickets(localPreviewCollection(collectionFromResponse(response.data, ["tickets"]), LOCAL_PREVIEW_TICKETS));
      } catch {
        // The queue remains usable with the last successful ticket snapshot.
      }
    };
    const interval = window.setInterval(refreshAttentionFeed, 60_000);
    return () => window.clearInterval(interval);
  }, [headers]);

  // Deep-link: ?ticket=INC-1234 auto-opens that ticket once tickets are loaded
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const ref = searchParams.get("ticket");
    if (!ref || tickets.length === 0) return;
    const wanted = decodeURIComponent(ref).replace(/^#/, "").toUpperCase();
    const match = matchTicketByReference(tickets, wanted);
    if (match) {
      // A technician may already have another ticket open in this mounted
      // workspace. A new deep link must still replace it with the requested
      // record rather than silently leaving the previous ticket on screen.
      if (viewingTicket?.id !== match.id) fetchTicketDetail(match);
      // Clear the param so back-navigation doesn't trap us
      const np = new URLSearchParams(searchParams);
      np.delete("ticket");
      setSearchParams(np, { replace: true });
    } else {
      toast.error(`Ticket ${wanted} not found`);
      const np = new URLSearchParams(searchParams);
      np.delete("ticket");
      setSearchParams(np, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, searchParams]);

  // Queue deep-links from Nexus Daily, Notifications and dashboard command tiles.
  useEffect(() => {
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const attention = searchParams.get("attention");
    setStatusFilter(status && ["open", "pending", "in_progress", "on_hold", "resolved", "closed", "completed"].includes(status) ? status : "all");
    setPriorityFilter(priority && ["critical", "high", "medium", "low"].includes(priority) ? priority : "all");
    setAttentionFilter(["no_response", "sla_breach", "unassigned", "critical_high"].includes(attention) ? attention : "all");
  }, [searchParams]);

  // Device detail deep-link: prefill a new ticket with the selected endpoint and
  // its client, then open the normal ticket creation workflow.
  useEffect(() => {
    const linkedDeviceId = searchParams.get("device_id");
    if (!linkedDeviceId || devices.length === 0) return;
    const linkedDevice = devices.find(device => device.id === linkedDeviceId);
    if (!linkedDevice) {
      toast.error("Linked device not found");
    } else {
      setFormData(prev => ({
        ...prev,
        device_id: linkedDevice.id,
        client_id: linkedDevice.client_id || prev.client_id,
        title: prev.title || `Support request - ${linkedDevice.name || linkedDevice.hostname || "device"}`,
        description: prev.description || `Created from Managed Assets for ${linkedDevice.name || linkedDevice.hostname || "this device"}.`,
      }));
      setIsCreateOpen(true);
    }
    const np = new URLSearchParams(searchParams);
    np.delete("device_id");
    setSearchParams(np, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, searchParams]);

  // Timer effect
  useEffect(() => {
    let interval;
    if (isTimerRunning && timerStart) {
      interval = setInterval(() => setTimerElapsed(Math.floor((Date.now() - timerStart) / 1000)), 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerStart]);

  const fetchTicketDetail = async (ticket) => {
    setViewingTicket(ticket);
    setDetailTab("conversation");
    setToolsOpen(false);
    setSuggestions(null);
    setAiAnalysis(null);
    setDeviceStatus(null);
    setEnrichment(null);
    setClientContacts([]);
    // Mark viewing
    axios.post(`${API}/tickets/${ticket.id}/viewing`, {}, { headers }).catch(() => {});
    try {
      const [nRes, eRes, cRes, tRes, aRes, sRes, attRes, prodRes, poRes, enrichRes, smsRes, smsTmplRes, smsCfgRes] = await Promise.all([
        axios.get(`${API}/tickets/${ticket.id}/comments`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/emails`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/children`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/time-entries`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/audit-log`, { headers }),
        axios.get(`${API}/scripts`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/tickets/${ticket.id}/attachments`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/tickets/${ticket.id}/products`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/purchase-orders/by-ticket/${ticket.id}`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/ticket-enrichment/${ticket.id}`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/tickets/${ticket.id}/sms`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/sms/templates?category=ticket`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/settings/sms`, { headers }).catch(() => ({ data: null })),
      ]);
      const previewDetail = localPreviewTicketDetail(ticket.id);
      setTicketNotes(localPreviewCollection(collectionFromResponse(nRes.data, ["comments", "notes"]), previewDetail.comments));
      setTicketEmails(localPreviewCollection(collectionFromResponse(eRes.data, ["emails"]), previewDetail.emails));
      setChildTickets(localPreviewCollection(collectionFromResponse(cRes.data, ["tickets", "children"]), previewDetail.children));
      setTimeEntries(localPreviewCollection(collectionFromResponse(tRes.data, ["time_entries"]), previewDetail.time_entries));
      setAuditLog(localPreviewCollection(collectionFromResponse(aRes.data, ["audit_log", "events"]), previewDetail.audit_log));
      setScripts(localPreviewCollection(collectionFromResponse(sRes.data, ["scripts"]), LOCAL_PREVIEW_SCRIPTS));
      setTicketAttachments(localPreviewCollection(collectionFromResponse(attRes.data, ["attachments"]), previewDetail.attachments));
      setTicketProducts(localPreviewCollection(collectionFromResponse(prodRes.data, ["products", "items"]), previewDetail.products));
      setTicketPurchaseOrders(collectionFromResponse(poRes.data, ["purchase_orders", "items"]));
      setEnrichment(Array.isArray(enrichRes.data) ? null : enrichRes.data);
      setTicketSms(localPreviewCollection(collectionFromResponse(smsRes.data, ["messages", "sms"]), previewDetail.sms));
      setSmsTemplates(collectionFromResponse(smsTmplRes.data, ["templates"]));
      if (smsCfgRes.data) setSmsConfig({
        signature: smsCfgRes.data.signature || "",
        append_signature: smsCfgRes.data.append_signature !== false,
      });
      // Fetch client contacts for email auto-populate
      if (ticket.client_id) {
        axios.get(`${API}/clients/${ticket.client_id}/contacts`, { headers }).then(r => {
          const contacts = collectionFromResponse(r.data, ["contacts"]);
          setClientContacts(contacts);
          const selectedContact = contacts.find(contact =>
            String(contact.id || contact.name || "") === String(ticket.contact_id || ticket.contact_name || "")
          );
          const preferredEmail = ticket.contact_email || selectedContact?.email || contacts.find(contact => contact.email)?.email || "";
          if (preferredEmail) setEmailForm(previous => ({ ...previous, to: previous.to || preferredEmail }));
        }).catch(() => {});
      }
      // Fetch worksheets
      try {
        const wsRes2 = await axios.get(`${API}/tickets/${ticket.id}/worksheet`, { headers });
        setWorksheetItems(localPreviewCollection(collectionFromResponse(wsRes2.data, ["worksheet", "items"]), previewDetail.worksheet));
      } catch { setWorksheetItems([]); }
      const sig = user?.email_signature || "";
      setEmailSignature(sig);
      const clientRec = clients.find(c => c.id === ticket.client_id);
      const embeddedContact = (clientRec?.contacts || []).find(contact =>
        String(contact.id || contact.name || "") === String(ticket.contact_id || ticket.contact_name || "")
      );
      setEmailForm({
        to: ticket.contact_email || embeddedContact?.email || clientRec?.email || clientRec?.contact_email || "",
        cc: "",
        bcc: "",
        subject: `Re: ${ticket.ticket_number} - ${ticket.title}`,
        body: "",
      });
      // Auto-populate SMS recipient from the client's mobile/phone
      const clientPhone = clientRec?.mobile || clientRec?.phone || "";
      setSmsForm({ to: clientPhone, message: "", template_key: "" });
      // Fetch device status if device linked
      if (ticket.device_id) {
        try {
          const dRes = await axios.get(`${API}/devices/${ticket.device_id}`, { headers });
          const device = dRes.data;
          setDeviceStatus(device && !Array.isArray(device) && device.id && device.status ? device : null);
        } catch { setDeviceStatus(null); }
      }
      // Fetch AI suggestions
      setSuggestionsLoading(true);
      try {
        const sugRes = await axios.get(`${API}/tickets/${ticket.id}/suggestions`, { headers });
        setSuggestions(sugRes.data);
      } catch { setSuggestions({ similar_tickets: [], kb_articles: [], keywords: [] }); }
      finally { setSuggestionsLoading(false); }
    } catch { toast.error("Failed to load ticket details"); }
  };

  const handleCreateTicket = async () => {
    if (!formData.title || !formData.client_id) { toast.error("Title and client are required"); return; }
    const selectedClient = clients.find(c => c.id === formData.client_id);
    const selectedContact = [
      ...createClientContacts,
      ...(selectedClient?.contacts || []),
    ].find(ct => ct.id === formData.contact_id || ct.name === formData.contact_id);
    const payload = {
      ...formData,
      client_name: selectedClient?.name || "",
      contact_name: selectedContact?.name || "",
      contact_email: selectedContact?.email || "",
      estimated_hours: formData.estimated_hours ? parseFloat(formData.estimated_hours) : null,
      due_date: formData.due_date || null,
    };
    try {
      const created = (await axios.post(`${API}/tickets`, payload, { headers })).data;
      toast.success(`Ticket ${created.ticket_number || ""} created`.trim());
      setIsCreateOpen(false);
      setFormData({
        title: "", description: "", client_id: "", priority: "medium", category: "support",
        assigned_to: "", parent_id: "", tags: [], ticket_type: "incident", impact: "medium",
        source: "internal", due_date: "", estimated_hours: "", contact_id: "", asset_id: "",
        device_id: "",
        cc: [], watchers: []
      });
      await fetchTickets();
      if (created?.id) await fetchTicketDetail(created);
    } catch { toast.error("Failed to create ticket"); }
  };

  const handleAiTriage = async () => {
    if (!formData.title && !formData.description) { toast.error("Enter a title or description first"); return; }
    setTriaging(true);
    try {
      const clientName = clients.find(c => c.id === formData.client_id)?.name || "";
      const res = await axios.post(`${API}/ticket-triage/analyze`, { title: formData.title, description: formData.description, client_name: clientName }, { headers });
      const t = res.data.triage;
      setTriageResult(res.data);
      toast.success(`AI Triage: ${t.priority} priority → ${t.category} → ${t.recommended_assignee?.tech_name || "Unassigned"}`);
    } catch { toast.error("AI Triage failed"); }
    finally { setTriaging(false); }
  };

  const applyTriage = () => {
    if (!triageResult?.triage) return;
    const t = triageResult.triage;
    setFormData(prev => ({
      ...prev,
      priority: t.priority || prev.priority,
      category: t.category || prev.category,
      assigned_to: t.recommended_assignee?.tech_id || prev.assigned_to,
      tags: [...new Set([...(prev.tags || []), ...(t.tags || [])])],
    }));
    toast.success("Triage suggestions applied");
  };


  const handleUpdateTicket = async (field, value) => {
    try {
      const response = await axios.put(`${API}/tickets/${viewingTicket.id}`, { [field]: value }, { headers });
      const resolvedToClosed = field === "status" && value === "resolved";
      setViewingTicket(prev => ({ ...prev, [field]: resolvedToClosed ? "closed" : value, ...(response.data?.ticket || {}) }));
      await fetchTickets();
      if (resolvedToClosed) toast.success("Ticket resolved, closed and retained in client history");
    } catch { toast.error("Failed to update ticket"); }
  };

  const handleQueueQuickAction = async (ticket, action) => {
    if (!ticket?.id) return;
    if (action === "remote") {
      const deviceId = ticket.device_id || ticket.asset_id || ticket.device_ids?.[0];
      if (!deviceId) { toast.error("Link a managed asset before starting a remote session"); return; }
      navigate(`/remote-access?device=${encodeURIComponent(deviceId)}&ticket=${encodeURIComponent(ticket.id)}`);
      return;
    }
    const patches = {
      claim: { assigned_to: user?.id },
      start: { status: "in_progress" },
      resolve: { status: "resolved" },
    };
    const patch = patches[action];
    if (!patch || (action === "claim" && !user?.id)) return;
    try {
      await axios.put(`${API}/tickets/${ticket.id}`, patch, { headers });
      await fetchTickets();
      const label = action === "claim" ? "Ticket claimed" : action === "start" ? "Work started" : "Ticket resolved, closed and retained in client history";
      toast.success(label);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not update ticket");
    }
  };

  const handleAddNote = async (options = {}) => {
    if (!newNote.trim()) return;
    const visibility = options.visibility || (conversationType === "public" ? "public" : "internal");
    try {
      const response = await axios.post(`${API}/tickets/${viewingTicket.id}/comments`, {
        content: newNote,
        visibility,
        is_internal: visibility === "internal",
        notify_client: Boolean(options.notify_client),
        to_addresses: options.to_addresses || [],
        subject_label: options.subject_label || "Update",
        status_after: options.status_after || "",
      }, { headers });
      setNewNote("");
      const res = await axios.get(`${API}/tickets/${viewingTicket.id}/comments`, { headers });
      setTicketNotes(collectionFromResponse(res.data, ["comments", "notes"]));
      if (response.data?.status_after) {
        setViewingTicket(previous => ({ ...previous, status: response.data.status_after }));
        await fetchTickets();
      }
      toast.success(
        visibility === "public"
          ? options.notify_client ? "Public update published and email delivery recorded" : "Public update published to the client portal"
          : "Private technician note added"
      );
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to publish update");
    }
  };

  const handleSendEmail = async () => {
    // Server-side auto-injects rich signature from /email-signatures default,
    // so we don't append client-side. Send body as-is.
    if (!emailForm.to?.split(",").some((address) => address.trim())) {
      toast.error("Add at least one recipient before sending");
      return;
    }
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/emails`, {
        ticket_id: viewingTicket.id,
        to_addresses: emailForm.to.split(",").map(e => e.trim()).filter(Boolean),
        cc_addresses: emailForm.cc ? emailForm.cc.split(",").map(e => e.trim()).filter(Boolean) : [],
        bcc_addresses: emailForm.bcc ? emailForm.bcc.split(",").map(e => e.trim()).filter(Boolean) : [],
        subject: emailForm.subject,
        body: emailForm.body,
        body_type: emailForm.body?.includes("<") ? "html" : "text",
      }, { headers });
      setIsEmailOpen(false);
      setConversationType("public");
      const [nRes, eRes] = await Promise.all([
        axios.get(`${API}/tickets/${viewingTicket.id}/comments`, { headers }),
        axios.get(`${API}/tickets/${viewingTicket.id}/emails`, { headers }),
      ]);
      setTicketNotes(collectionFromResponse(nRes.data, ["comments", "notes"]));
      setTicketEmails(collectionFromResponse(eRes.data, ["emails"]));
      toast.success("Email sent");
    } catch { toast.error("Failed to send email"); }
  };

  const handleSendSms = async () => {
    const trimmedMsg = (smsForm.message || "").trim();
    const trimmedTo = (smsForm.to || "").trim();
    if (!trimmedTo) { toast.error("Phone number is required"); return; }
    if (!trimmedMsg && !smsForm.template_key) { toast.error("Enter a message or pick a template"); return; }
    setSmsSending(true);
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/send-sms`, {
        to: trimmedTo,
        message: trimmedMsg,
        template_key: smsForm.template_key || null,
      }, { headers });
      toast.success("SMS sent");
      setSmsForm(prev => ({ ...prev, message: "", template_key: "" }));
      const [smsRes, aRes] = await Promise.all([
        axios.get(`${API}/tickets/${viewingTicket.id}/sms`, { headers }),
        axios.get(`${API}/tickets/${viewingTicket.id}/audit-log`, { headers }).catch(() => ({ data: auditLog })),
      ]);
      setTicketSms(collectionFromResponse(smsRes.data, ["messages", "sms"]));
      setAuditLog(collectionFromResponse(aRes.data, ["audit_log", "events"]));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  };

  const applySmsTemplate = (key) => {
    const tmpl = smsTemplates.find(t => t.key === key);
    if (!tmpl) return;
    const ctx = {
      client_name: viewingTicket?.client_name || "",
      ticket_number: viewingTicket?.ticket_number || (viewingTicket?.id || "").slice(-6),
      ticket_title: viewingTicket?.title || "",
      comment_preview: "",
      portal_link: "",
      company_phone: "",
      company_name: "NexusOps",
      technician_name: user?.name || "",
      eta: "shortly",
    };
    const body = (tmpl.body || "").replace(/\{(\w+)\}/g, (_, k) => (ctx[k] ?? `{${k}}`));
    setSmsForm(prev => ({ ...prev, message: body, template_key: key }));
  };

  const handleNotifyClient = async () => {
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/notify-client`, notifyForm, { headers });
      setIsClientNotifyOpen(false);
      setNotifyForm({ email: "", subject: "", message: "" });
      toast.success("Client notification sent with PDF attachment");
    } catch { toast.error("Failed to send notification"); }
  };

  const handleAddItemToTicket = async () => {
    if (!addItemProduct || !viewingTicket) return;
    try {
      const res = await axios.post(`${API}/tickets/${viewingTicket.id}/products`, {
        product_id: addItemProduct, quantity: addItemQty
      }, { headers });
      setTicketProducts(prev => [...prev, res.data]);
      setAddItemProduct("");
      setAddItemQty(1);
      toast.success("Item added to ticket");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to add item"); }
  };

  const handleRemoveItemFromTicket = async (itemId) => {
    if (!viewingTicket) return;
    try {
      await axios.delete(`${API}/tickets/${viewingTicket.id}/products/${itemId}`, { headers });
      setTicketProducts(prev => prev.filter(p => p.id !== itemId));
      toast.success("Item removed");
    } catch { toast.error("Failed to remove item"); }
  };

  const handlePushToInvoice = async (invoiceId) => {
    if (!viewingTicket) return;
    try {
      const res = await axios.post(`${API}/tickets/${viewingTicket.id}/products-to-invoice`, {
        invoice_id: invoiceId || null
      }, { headers });
      toast.success(res.data.message);
      setTicketProducts(prev => prev.map(item => item.invoice_id ? item : ({
        ...item,
        invoice_id: res.data.invoice_id,
        invoice_number: res.data.invoice_number,
        invoiced_at: new Date().toISOString(),
      })));
      setIsPushInvoiceOpen(false);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to push to invoice"); }
  };

  const handleDownloadPdf = async () => {
    try {
      const res = await axios.get(`${API}/tickets/${viewingTicket.id}/download-pdf`, {
        headers, responseType: "blob"
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `ticket_${viewingTicket.ticket_number}_conversation.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch { toast.error("Failed to download PDF"); }
  };

  const handleAttachmentUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachmentUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/attachments`, formData, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
      toast.success("Attachment uploaded");
      const res = await axios.get(`${API}/tickets/${viewingTicket.id}/attachments`, { headers });
      setTicketAttachments(collectionFromResponse(res.data, ["attachments"]));
    } catch { toast.error("Upload failed"); }
    finally { setAttachmentUploading(false); e.target.value = ""; }
  };

  const handleDeleteAttachment = async (attId) => {
    try {
      await axios.delete(`${API}/tickets/${viewingTicket.id}/attachments/${attId}`, { headers });
      setTicketAttachments(prev => prev.filter(a => a.id !== attId));
      toast.success("Attachment deleted");
    } catch { toast.error("Failed to delete"); }
  };

  const handleCreateChild = async () => {
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/children`, childForm, { headers });
      setIsChildOpen(false);
      setChildForm({ title: "", description: "", priority: "medium" });
      const res = await axios.get(`${API}/tickets/${viewingTicket.id}/children`, { headers });
      setChildTickets(collectionFromResponse(res.data, ["tickets", "children"]));
      fetchTickets();
      toast.success("Child ticket created");
    } catch { toast.error("Failed to create child ticket"); }
  };

  const handleMerge = async () => {
    if (!mergeIds.length) return;
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/merge`, { merge_ids: mergeIds }, { headers });
      setIsMergeOpen(false);
      setMergeIds([]);
      fetchTickets();
      toast.success("Tickets merged");
    } catch { toast.error("Failed to merge"); }
  };

  const handleAddTime = async () => {
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/time-entries`, timeForm, { headers });
      setIsTimeOpen(false);
      setTimeForm({ minutes: 15, description: "", billable: true });
      const res = await axios.get(`${API}/tickets/${viewingTicket.id}/time-entries`, { headers });
      setTimeEntries(collectionFromResponse(res.data, ["time_entries"]));
      toast.success("Time logged");
    } catch { toast.error("Failed to log time"); }
  };

  const toggleTimer = () => {
    if (isTimerRunning) {
      const mins = Math.max(1, Math.round(timerElapsed / 60));
      setTimeForm({ minutes: mins, description: "Timer entry", billable: true });
      setIsTimeOpen(true);
      setIsTimerRunning(false);
      setTimerStart(null);
      setTimerElapsed(0);
    } else {
      setIsTimerRunning(true);
      setTimerStart(Date.now());
    }
  };

  const handleAddTag = () => {
    if (tagInput.trim() && viewingTicket) {
      const newTags = [...(viewingTicket.tags || []), tagInput.trim()];
      handleUpdateTicket("tags", newTags);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag) => {
    if (viewingTicket) {
      handleUpdateTicket("tags", (viewingTicket.tags || []).filter(t => t !== tag));
    }
  };

  // Workshop + Field data is now loaded in fetchTickets

  // ============ BULK ACTIONS ============
  const toggleTicketSelect = (ticketId) => {
    setSelectedTickets(prev => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedTickets.size === filteredTickets.length) {
      setSelectedTickets(new Set());
    } else {
      setSelectedTickets(new Set(filteredTickets.map(t => t.id)));
    }
  };

  const handleBulkAction = async () => {
    if (selectedTickets.size === 0 || !bulkAction) return;
    setBulkProcessing(true);
    try {
      const res = await axios.post(`${API}/tickets/bulk-action`, {
        ticket_ids: Array.from(selectedTickets),
        action: bulkAction,
        value: bulkValue,
      }, { headers });
      toast.success(res.data.message);
      setSelectedTickets(new Set());
      setBulkAction("");
      setBulkValue("");
      fetchTickets();
    } catch (e) { toast.error(e.response?.data?.detail || "Bulk action failed"); }
    finally { setBulkProcessing(false); }
  };

  const handleCreateWsJob = async () => {
    try {
      const res = await axios.post(`${API}/workshop/jobs`, wsForm, { headers });
      toast.success(`Workshop job ${res.data.job_number} created`);
      setWsDialog(false); setWsForm({ client_id: "", customer_name: "", customer_phone: "", customer_email: "", device_type: "", device_brand: "", device_model: "", serial_number: "", fault_description: "", priority: "normal", assigned_to: "", assigned_to_name: "" });
      await fetchTickets();
      if (res.data?.id) await fetchWsJobDetail(res.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleWsStatus = async (jobId, status) => {
    try {
      const response = await axios.put(`${API}/workshop/jobs/${jobId}/status`, { status }, { headers });
      toast.success(status === "collected" ? "Workshop job collected and completion recorded" : `Status: ${status.replaceAll("_", " ")}`);
      await fetchTickets();
      if (viewWsJob?.id === jobId) setViewWsJob(response.data?.job || viewWsJob);
    } catch { toast.error("Failed"); }
  };

  const openTicketInvoiceWorkflow = () => {
    if (!viewingTicket) return;
    setPushToExisting("");
    setInvoicesList([]);
    axios.get(`${API}/invoices`, { headers })
      .then(r => setInvoicesList(collectionFromResponse(r.data, ["invoices", "items"])))
      .catch(() => toast.error("Could not load existing invoices. You can still create a new draft."));
    setIsPushInvoiceOpen(true);
  };

  const handleWsTimer = async (jobId, action) => {
    try { const r = await axios.put(`${API}/workshop/jobs/${jobId}/timer`, { action }, { headers }); toast.success(r.data.message); if (viewWsJob?.id === jobId) { const r2 = await axios.get(`${API}/workshop/jobs/${jobId}`, { headers }); setViewWsJob(r2.data); } } catch { toast.error("Timer failed"); }
  };

  const handleAddWsPart = async () => {
    if (!viewWsJob || !wsPartProduct) return;
    const prod = allProducts.find(p => p.id === wsPartProduct);
    try {
      await axios.post(`${API}/workshop/jobs/${viewWsJob.id}/add-part`, { product_id: wsPartProduct, product_name: prod?.name || "", quantity: wsPartQty, unit_price: prod?.retail_price || 0 }, { headers });
      toast.success("Part added & stock deducted");
      const r = await axios.get(`${API}/workshop/jobs/${viewWsJob.id}`, { headers });
      setViewWsJob(r.data); setWsPartDialog(false); setWsPartProduct(""); setWsPartQty(1);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleCreateFjJob = async () => {
    try {
      const res = await axios.post(`${API}/field-jobs`, fjForm, { headers });
      toast.success(`Field job ${res.data.job_number} created`);
      setFjDialog(false); setFjForm({ client_id: "", customer_name: "", customer_phone: "", customer_email: "", service_address: "", zone: "", description: "", job_category: "installation", priority: "normal", assigned_to: "", assigned_to_name: "", scheduled_date: "", scheduled_time: "" });
      await fetchTickets();
      if (res.data?.id) await fetchFjJobDetail(res.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleFjStatus = async (jobId, status) => {
    try {
      const response = await axios.put(`${API}/field-jobs/${jobId}/status`, { status }, { headers });
      toast.success(status === "completed" ? "Field job completed and completion recorded" : `Status: ${status.replaceAll("_", " ")}`);
      await fetchTickets();
      if (viewFjJob?.id === jobId) setViewFjJob(response.data?.job || viewFjJob);
    } catch { toast.error("Failed"); }
  };

  const refreshJobConversation = async (kind, jobId) => {
    const res = await axios.get(`${API}/${kind}-jobs/${jobId}/conversation`, { headers });
    const conversation = {
      notes: collectionFromResponse(res.data, ["notes"]),
      emails: collectionFromResponse(res.data, ["emails"]),
      sms: collectionFromResponse(res.data, ["sms", "messages"]),
    };
    if (kind === "workshop") setWsConversation(conversation);
    else setFjConversation(conversation);
  };

  const handleJobConversationNote = async (kind, job, content, setContent, options = {}) => {
    if (!content.trim()) return;
    const visibility = options.visibility || "internal";
    try {
      await axios.post(`${API}/${kind}-jobs/${job.id}/conversation/note`, {
        content,
        visibility,
        is_internal: visibility === "internal",
        notify_client: Boolean(options.notify_client),
        to_addresses: options.to_addresses || [],
        subject_label: options.subject_label || "Update",
      }, { headers });
      setContent("");
      await refreshJobConversation(kind, job.id);
      toast.success(
        visibility === "public"
          ? options.notify_client ? "Public update published and emailed" : "Public update published"
          : "Private technician note added"
      );
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to publish update"); }
  };

  const handleJobConversationEmail = async (kind, job, form, setForm) => {
    if (!form.to?.trim()) { toast.error("Add at least one recipient before sending"); return; }
    try {
      await axios.post(`${API}/${kind}-jobs/${job.id}/conversation/email`, {
        to_addresses: form.to.split(",").map(address => address.trim()).filter(Boolean),
        cc: form.cc ? form.cc.split(",").map(address => address.trim()).filter(Boolean) : [],
        bcc: form.bcc ? form.bcc.split(",").map(address => address.trim()).filter(Boolean) : [],
        subject: form.subject,
        body: form.body,
        body_type: form.body?.includes("<") ? "html" : "text",
      }, { headers });
      setForm(previous => ({ ...previous, body: "" }));
      await refreshJobConversation(kind, job.id);
      toast.success("Email sent and recorded");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to send email"); }
  };

  const handleJobConversationSms = async (kind, job, form, setForm) => {
    if (!form.to?.trim() || !form.message?.trim()) { toast.error("Phone number and message are required"); return; }
    setSmsSending(true);
    try {
      await axios.post(`${API}/${kind}-jobs/${job.id}/conversation/sms`, { to: form.to, message: form.message }, { headers });
      setForm(previous => ({ ...previous, message: "", template_key: "" }));
      await refreshJobConversation(kind, job.id);
      toast.success("SMS sent and recorded");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to send SMS"); }
    finally { setSmsSending(false); }
  };

  const applyJobSmsTemplate = (key, setForm) => {
    const template = smsTemplates.find(item => item.key === key);
    if (!template) return;
    setForm(previous => ({ ...previous, template_key: key, message: template.body || previous.message }));
  };

  // ============ WORKSHOP ENRICHMENT HANDLERS ============

  const fetchWsJobDetail = async (job) => {
    setViewWsJob(job);
    setWsConversationType("public");
    setWsConversation({ notes: [], emails: [], sms: [] });
    setWsConversationNote("");
    setWsEmailForm({ to: job.customer_email || "", cc: "", bcc: "", subject: `Update: ${job.job_number || "Workshop job"}`, body: "" });
    setWsSmsForm({ to: job.customer_phone || "", message: "", template_key: "" });
    setWsNotes([]); setWsPhotos([]); setWsChecklist([]); setWsAuditLog([]); setWsQuote(null); setWsRepairHistory([]);
    try {
      const linkedClient = clients.find(client => client.id === job.client_id || client.name === job.customer_name || client.company_name === job.customer_name);
      const [notesRes, photosRes, clRes, auditRes, quoteRes, histRes, conversationRes, contactsRes, smsTemplatesRes, smsConfigRes] = await Promise.all([
        axios.get(`${API}/workshop/jobs/${job.id}/notes`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workshop/jobs/${job.id}/photos`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workshop/jobs/${job.id}/checklist`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workshop/jobs/${job.id}/audit-log`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workshop/jobs/${job.id}/quote`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/workshop/jobs/${job.id}/repair-history`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workshop-jobs/${job.id}/conversation`, { headers }).catch(() => ({ data: { notes: [], emails: [], sms: [] } })),
        linkedClient ? axios.get(`${API}/clients/${linkedClient.id}/contacts`, { headers }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
        axios.get(`${API}/sms/templates?category=ticket`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/settings/sms`, { headers }).catch(() => ({ data: null })),
      ]);
      setWsNotes(notesRes.data || []);
      setWsPhotos(photosRes.data || []);
      setWsChecklist(clRes.data || []);
      setWsAuditLog(auditRes.data || []);
      setWsQuote(quoteRes.data);
      setWsRepairHistory(histRes.data || []);
      setWsConversation({ notes: conversationRes.data?.notes || [], emails: conversationRes.data?.emails || [], sms: conversationRes.data?.sms || [] });
      setClientContacts(collectionFromResponse(contactsRes.data, ["contacts"]));
      setSmsTemplates(collectionFromResponse(smsTemplatesRes.data, ["templates"]));
      if (smsConfigRes.data) setSmsConfig({ signature: smsConfigRes.data.signature || "", append_signature: smsConfigRes.data.append_signature !== false });
      setWsIntakeForm({
        customer_name: job.customer_name || "",
        customer_phone: job.customer_phone || "",
        customer_email: job.customer_email || "",
        device_type: job.device_type || "",
        device_brand: job.device_brand || "",
        device_model: job.device_model || "",
        serial_number: job.serial_number || "",
        fault_description: job.fault_description || "",
        condition_on_arrival: job.condition_on_arrival || "",
        accessories_received: job.accessories_received || [],
        customer_password: job.customer_password || "",
        warranty_status: job.warranty_status || "unknown",
        warranty_expiry: job.warranty_expiry || "",
      });
    } catch { /* silent */ }
  };

  const handleAddWsNote = async () => {
    if (!wsNewNote.trim() || !viewWsJob) return;
    try {
      await axios.post(`${API}/workshop/jobs/${viewWsJob.id}/notes`, { content: wsNewNote, note_type: "repair" }, { headers });
      setWsNewNote("");
      const r = await axios.get(`${API}/workshop/jobs/${viewWsJob.id}/notes`, { headers });
      setWsNotes(r.data || []);
      toast.success("Note added");
    } catch { toast.error("Failed to add note"); }
  };

  const handleWsPhotoUpload = async (e, photoType = "general") => {
    const file = e.target.files?.[0];
    if (!file || !viewWsJob) return;
    setWsPhotoUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      await axios.post(`${API}/workshop/jobs/${viewWsJob.id}/photos?photo_type=${photoType}`, fd, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
      const r = await axios.get(`${API}/workshop/jobs/${viewWsJob.id}/photos`, { headers });
      setWsPhotos(r.data || []);
      toast.success("Photo uploaded");
    } catch { toast.error("Upload failed"); }
    finally { setWsPhotoUploading(false); e.target.value = ""; }
  };

  const handleDeleteWsPhoto = async (photoId) => {
    if (!viewWsJob) return;
    try {
      await axios.delete(`${API}/workshop/jobs/${viewWsJob.id}/photos/${photoId}`, { headers });
      setWsPhotos(prev => prev.filter(p => p.id !== photoId));
      toast.success("Photo deleted");
    } catch { toast.error("Failed"); }
  };

  const handleLoadWsTemplate = async (template) => {
    if (!viewWsJob) return;
    try {
      await axios.post(`${API}/workshop/jobs/${viewWsJob.id}/checklist`, { template }, { headers });
      const clRes = await axios.get(`${API}/workshop/jobs/${viewWsJob.id}/checklist`, { headers });
      setWsChecklist(clRes.data || []);
      setWsTemplateDialog(false);
      toast.success(`${template} checklist loaded`);
    } catch { toast.error("Failed"); }
  };

  const handleToggleWsCheckItem = async (itemId, checked) => {
    if (!viewWsJob) return;
    try {
      await axios.put(`${API}/workshop/jobs/${viewWsJob.id}/checklist/${itemId}`, { checked: !checked }, { headers });
      const r = await axios.get(`${API}/workshop/jobs/${viewWsJob.id}/checklist`, { headers });
      setWsChecklist(r.data || []);
    } catch { toast.error("Failed"); }
  };

  const handleAddWsCheckItem = async () => {
    if (!wsNewCheckItem.trim() || !viewWsJob) return;
    try {
      await axios.post(`${API}/workshop/jobs/${viewWsJob.id}/checklist/add-item`, { item: wsNewCheckItem.trim() }, { headers });
      setWsNewCheckItem("");
      const r = await axios.get(`${API}/workshop/jobs/${viewWsJob.id}/checklist`, { headers });
      setWsChecklist(r.data || []);
    } catch { toast.error("Failed"); }
  };

  const handleSaveWsQuote = async () => {
    if (!viewWsJob) return;
    const lineItems = wsQuoteItems.filter(i => i.description).map(i => ({
      description: i.description, quantity: Number(i.qty) || 1, unit_price: Number(i.price) || 0, total: (Number(i.qty) || 1) * (Number(i.price) || 0),
    }));
    try {
      const r = await axios.post(`${API}/workshop/jobs/${viewWsJob.id}/quote`, { line_items: lineItems, notes: wsQuoteNotes }, { headers });
      setWsQuote(r.data);
      setWsQuoteDialog(false);
      toast.success("Quote saved");
    } catch { toast.error("Failed to save quote"); }
  };

  const handleSendWsQuote = async () => {
    if (!viewWsJob) return;
    try {
      await axios.post(`${API}/workshop/jobs/${viewWsJob.id}/quote/send`, { email: viewWsJob.customer_email || wsIntakeForm.customer_email }, { headers });
      const r = await axios.get(`${API}/workshop/jobs/${viewWsJob.id}/quote`, { headers });
      setWsQuote(r.data);
      toast.success("Quote sent to customer");
    } catch { toast.error("Failed to send quote"); }
  };

  const handleApproveWsQuote = async () => {
    if (!viewWsJob) return;
    try {
      await axios.post(`${API}/workshop/jobs/${viewWsJob.id}/quote/approve`, {}, { headers });
      const r = await axios.get(`${API}/workshop/jobs/${viewWsJob.id}/quote`, { headers });
      setWsQuote(r.data);
      toast.success("Quote approved");
    } catch { toast.error("Failed"); }
  };

  const handleWsNotifyCustomer = async () => {
    if (!viewWsJob) return;
    try {
      await axios.post(`${API}/workshop/jobs/${viewWsJob.id}/notify-customer`, wsNotifyForm, { headers });
      setWsNotifyDialog(false);
      setWsNotifyForm({ email: "", subject: "", message: "" });
      toast.success("Customer notified");
    } catch { toast.error("Failed to notify"); }
  };

  const handleWsPushToInvoice = async (invoiceId) => {
    if (!viewWsJob) return;
    try {
      const r = await axios.post(`${API}/workshop/jobs/${viewWsJob.id}/to-invoice`, { invoice_id: invoiceId || null }, { headers });
      toast.success(r.data.message);
      setWsInvoiceDialog(false);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleSaveWsIntake = async () => {
    if (!viewWsJob) return;
    try {
      await axios.put(`${API}/workshop/jobs/${viewWsJob.id}`, wsIntakeForm, { headers });
      await axios.put(`${API}/workshop/jobs/${viewWsJob.id}/intake`, wsIntakeForm, { headers });
      setViewWsJob(prev => ({ ...prev, ...wsIntakeForm }));
      setWsIntakeDialog(false);
      toast.success("Service record updated");
    } catch { toast.error("Failed to save"); }
  };

  const handleSaveWsHeader = async () => {
    const fault_description = wsHeaderDraft.trim();
    if (!viewWsJob || !fault_description || fault_description === viewWsJob.fault_description) { setWsHeaderEdit(false); return; }
    try {
      await axios.put(`${API}/workshop/jobs/${viewWsJob.id}`, { fault_description }, { headers });
      setViewWsJob(prev => ({ ...prev, fault_description }));
      setWsIntakeForm(prev => ({ ...prev, fault_description }));
      toast.success("Workshop title updated");
    } catch { toast.error("Failed to update workshop title"); }
    finally { setWsHeaderEdit(false); }
  };

  const handleSaveFjHeader = async () => {
    const description = fjHeaderDraft.trim();
    if (!viewFjJob || !description || description === viewFjJob.description) { setFjHeaderEdit(false); return; }
    try {
      await axios.put(`${API}/field-jobs/${viewFjJob.id}`, { description }, { headers });
      setViewFjJob(prev => ({ ...prev, description }));
      toast.success("Field job title updated");
    } catch { toast.error("Failed to update field job title"); }
    finally { setFjHeaderEdit(false); }
  };

  const handleDownloadWsPdf = async () => {
    if (!viewWsJob) return;
    try {
      const res = await axios.get(`${API}/workshop/jobs/${viewWsJob.id}/pdf`, { headers, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = `JobCard_${viewWsJob.job_number}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch { toast.error("Failed to download PDF"); }
  };

  const handleDownloadWsQr = async () => {
    if (!viewWsJob) return;
    try {
      const res = await axios.get(`${API}/workshop/jobs/${viewWsJob.id}/qr-code`, { headers, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = `QR_${viewWsJob.job_number}.png`; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("QR code downloaded");
    } catch { toast.error("Failed"); }
  };

  const WS_STATUSES = WS_STATUSES_CONFIG;

  // ============ FIELD JOB ENRICHMENT HANDLERS ============

  const fetchFjJobDetail = async (job) => {
    setViewFjJob(job);
    setFjConversationType("public");
    setFjConversation({ notes: [], emails: [], sms: [] });
    setFjConversationNote("");
    setFjEmailForm({ to: job.customer_email || "", cc: "", bcc: "", subject: `Update: ${job.job_number || "Field job"}`, body: "" });
    setFjSmsForm({ to: job.customer_phone || "", message: "", template_key: "" });
    setFjNotes([]); setFjPhotos([]); setFjChecklist([]); setFjAuditLog([]); setFjQuote(null); setFjEquipment([]); setFjMaterials([]); setFjSiteInfo({}); setFjJobHistory([]);
    try {
      const linkedClient = clients.find(client => client.id === job.client_id || client.name === job.customer_name || client.company_name === job.customer_name);
      const [notesRes, photosRes, clRes, auditRes, quoteRes, equipRes, matRes, siteRes, histRes, conversationRes, contactsRes, smsTemplatesRes, smsConfigRes] = await Promise.all([
        axios.get(`${API}/field-jobs/${job.id}/notes`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/photos`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/enhanced-checklist`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/audit-log`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/quote`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/field-jobs/${job.id}/equipment`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/materials`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/site-info`, { headers }).catch(() => ({ data: {} })),
        axios.get(`${API}/field-jobs/${job.id}/job-history`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/conversation`, { headers }).catch(() => ({ data: { notes: [], emails: [], sms: [] } })),
        linkedClient ? axios.get(`${API}/clients/${linkedClient.id}/contacts`, { headers }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
        axios.get(`${API}/sms/templates?category=ticket`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/settings/sms`, { headers }).catch(() => ({ data: null })),
      ]);
      setFjNotes(notesRes.data || []);
      setFjPhotos(photosRes.data || []);
      setFjChecklist(clRes.data || []);
      setFjAuditLog(auditRes.data || []);
      setFjQuote(quoteRes.data);
      setFjEquipment(equipRes.data || []);
      setFjMaterials(matRes.data || []);
      setFjSiteInfo(siteRes.data || {});
      setFjJobHistory(histRes.data || []);
      setFjConversation({ notes: conversationRes.data?.notes || [], emails: conversationRes.data?.emails || [], sms: conversationRes.data?.sms || [] });
      setClientContacts(collectionFromResponse(contactsRes.data, ["contacts"]));
      setSmsTemplates(collectionFromResponse(smsTemplatesRes.data, ["templates"]));
      if (smsConfigRes.data) setSmsConfig({ signature: smsConfigRes.data.signature || "", append_signature: smsConfigRes.data.append_signature !== false });
    } catch { /* silent */ }
  };

  const handleAddFjNote = async () => {
    if (!fjNewNote.trim() || !viewFjJob) return;
    try {
      await axios.post(`${API}/field-jobs/${viewFjJob.id}/notes`, { content: fjNewNote, note_type: "field" }, { headers });
      setFjNewNote("");
      const r = await axios.get(`${API}/field-jobs/${viewFjJob.id}/notes`, { headers });
      setFjNotes(r.data || []);
      toast.success("Note added");
    } catch { toast.error("Failed to add note"); }
  };

  const handleFjPhotoUpload = async (e, photoType = "general") => {
    const file = e.target.files?.[0];
    if (!file || !viewFjJob) return;
    setFjPhotoUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      await axios.post(`${API}/field-jobs/${viewFjJob.id}/photos?photo_type=${photoType}`, fd, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
      const r = await axios.get(`${API}/field-jobs/${viewFjJob.id}/photos`, { headers });
      setFjPhotos(r.data || []);
      toast.success("Photo uploaded");
    } catch { toast.error("Upload failed"); }
    finally { setFjPhotoUploading(false); e.target.value = ""; }
  };

  const handleDeleteFjPhoto = async (photoId) => {
    if (!viewFjJob) return;
    try {
      await axios.delete(`${API}/field-jobs/${viewFjJob.id}/photos/${photoId}`, { headers });
      setFjPhotos(prev => prev.filter(p => p.id !== photoId));
      toast.success("Photo deleted");
    } catch { toast.error("Failed"); }
  };

  const handleLoadFjTemplate = async (template) => {
    if (!viewFjJob) return;
    try {
      await axios.post(`${API}/field-jobs/${viewFjJob.id}/enhanced-checklist`, { template }, { headers });
      const r = await axios.get(`${API}/field-jobs/${viewFjJob.id}/enhanced-checklist`, { headers });
      setFjChecklist(r.data || []);
      setFjTemplateDialog(false);
      toast.success(`${template} checklist loaded`);
    } catch { toast.error("Failed"); }
  };

  const handleToggleFjCheckItem = async (itemId, checked) => {
    if (!viewFjJob) return;
    try {
      await axios.put(`${API}/field-jobs/${viewFjJob.id}/enhanced-checklist/${itemId}`, { checked: !checked }, { headers });
      const r = await axios.get(`${API}/field-jobs/${viewFjJob.id}/enhanced-checklist`, { headers });
      setFjChecklist(r.data || []);
    } catch { toast.error("Failed"); }
  };

  const handleAddFjCheckItem = async () => {
    if (!fjNewCheckItem.trim() || !viewFjJob) return;
    try {
      await axios.post(`${API}/field-jobs/${viewFjJob.id}/enhanced-checklist/add-item`, { item: fjNewCheckItem.trim() }, { headers });
      setFjNewCheckItem("");
      const r = await axios.get(`${API}/field-jobs/${viewFjJob.id}/enhanced-checklist`, { headers });
      setFjChecklist(r.data || []);
    } catch { toast.error("Failed"); }
  };

  const handleSaveFjQuote = async () => {
    if (!viewFjJob) return;
    const lineItems = fjQuoteItems.filter(i => i.description).map(i => ({
      description: i.description, quantity: Number(i.qty) || 1, unit_price: Number(i.price) || 0, total: (Number(i.qty) || 1) * (Number(i.price) || 0),
    }));
    try {
      const r = await axios.post(`${API}/field-jobs/${viewFjJob.id}/quote`, { line_items: lineItems, notes: fjQuoteNotes }, { headers });
      setFjQuote(r.data);
      setFjQuoteDialog(false);
      toast.success("Quote saved");
    } catch { toast.error("Failed"); }
  };

  const handleSendFjQuote = async () => {
    if (!viewFjJob) return;
    try {
      await axios.post(`${API}/field-jobs/${viewFjJob.id}/quote/send`, { email: viewFjJob.customer_email || fjSiteInfo.customer_email }, { headers });
      const r = await axios.get(`${API}/field-jobs/${viewFjJob.id}/quote`, { headers });
      setFjQuote(r.data);
      toast.success("Quote sent");
    } catch { toast.error("Failed"); }
  };

  const handleApproveFjQuote = async () => {
    if (!viewFjJob) return;
    try {
      await axios.post(`${API}/field-jobs/${viewFjJob.id}/quote/approve`, {}, { headers });
      const r = await axios.get(`${API}/field-jobs/${viewFjJob.id}/quote`, { headers });
      setFjQuote(r.data);
      toast.success("Quote approved");
    } catch { toast.error("Failed"); }
  };

  const handleAddFjEquipment = async () => {
    if (!viewFjJob || !fjEquipForm.equipment_type) return;
    try {
      const r = await axios.post(`${API}/field-jobs/${viewFjJob.id}/equipment`, fjEquipForm, { headers });
      setFjEquipment(prev => [...prev, r.data]);
      setFjEquipDialog(false);
      setFjEquipForm({ equipment_type: "", brand: "", model: "", serial_number: "", mac_address: "", ip_address: "", config_notes: "", action: "installed" });
      toast.success("Equipment added");
    } catch { toast.error("Failed"); }
  };

  const handleDeleteFjEquipment = async (equipId) => {
    if (!viewFjJob) return;
    try {
      await axios.delete(`${API}/field-jobs/${viewFjJob.id}/equipment/${equipId}`, { headers });
      setFjEquipment(prev => prev.filter(e => e.id !== equipId));
      toast.success("Removed");
    } catch { toast.error("Failed"); }
  };

  const handleAddFjMaterial = async () => {
    if (!viewFjJob || !fjMatForm.material) return;
    try {
      const r = await axios.post(`${API}/field-jobs/${viewFjJob.id}/materials`, fjMatForm, { headers });
      setFjMaterials(prev => [...prev, r.data]);
      setFjMatDialog(false);
      setFjMatForm({ material: "", quantity: 1, unit: "meters", unit_cost: 0 });
      toast.success("Material added");
    } catch { toast.error("Failed"); }
  };

  const handleDeleteFjMaterial = async (matId) => {
    if (!viewFjJob) return;
    try {
      await axios.delete(`${API}/field-jobs/${viewFjJob.id}/materials/${matId}`, { headers });
      setFjMaterials(prev => prev.filter(m => m.id !== matId));
      toast.success("Removed");
    } catch { toast.error("Failed"); }
  };

  const handleSaveFjSiteInfo = async () => {
    if (!viewFjJob) return;
    try {
      await axios.put(`${API}/field-jobs/${viewFjJob.id}/site-info`, fjSiteInfo, { headers });
      setFjSiteDialog(false);
      toast.success("Site info saved");
    } catch { toast.error("Failed"); }
  };

  const handleFjNotifyCustomer = async () => {
    if (!viewFjJob) return;
    try {
      await axios.post(`${API}/field-jobs/${viewFjJob.id}/notify-customer`, fjNotifyForm, { headers });
      setFjNotifyDialog(false);
      setFjNotifyForm({ email: "", subject: "", message: "" });
      toast.success("Customer notified");
    } catch { toast.error("Failed"); }
  };

  const handleFjPushToInvoice = async (invoiceId) => {
    if (!viewFjJob) return;
    try {
      const r = await axios.post(`${API}/field-jobs/${viewFjJob.id}/to-invoice`, { invoice_id: invoiceId || null }, { headers });
      toast.success(r.data.message);
      setFjInvoiceDialog(false);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleDownloadFjPdf = async () => {
    if (!viewFjJob) return;
    try {
      const res = await axios.get(`${API}/field-jobs/${viewFjJob.id}/pdf`, { headers, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = `FieldJob_${viewFjJob.job_number}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch { toast.error("Failed"); }
  };

  const handleDownloadFjQr = async () => {
    if (!viewFjJob) return;
    try {
      const res = await axios.get(`${API}/field-jobs/${viewFjJob.id}/qr-code`, { headers, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = `QR_${viewFjJob.job_number}.png`; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("QR code downloaded");
    } catch { toast.error("Failed"); }
  };

  const FJ_STATUSES = {
    scheduled: { label: "Scheduled", class: "bg-blue-500/20 text-blue-400" },
    en_route: { label: "En Route", class: "bg-cyan-500/20 text-cyan-400" },
    on_site: { label: "On Site", class: "bg-amber-500/20 text-amber-400" },
    completed: { label: "Completed", class: "bg-green-500/20 text-green-400" },
    cancelled: { label: "Cancelled", class: "bg-red-500/20 text-red-400" },
  };

  const filteredTickets = tickets.filter(t => {
    if (statusFilter === "completed" && !["resolved", "closed"].includes(t.status)) return false;
    if (statusFilter !== "all" && statusFilter !== "completed" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (attentionFilter === "no_response" && (t.last_response_at || Date.now() - new Date(t.created_at).getTime() <= 4 * 60 * 60 * 1000 || ["closed", "resolved"].includes(t.status))) return false;
    if (attentionFilter === "sla_breach") {
      const dueAt = t.sla_due || t.sla_due_at;
      if (!dueAt || new Date(dueAt) >= new Date() || ["closed", "resolved"].includes(t.status)) return false;
    }
    if (attentionFilter === "unassigned" && t.assigned_to) return false;
    if (attentionFilter === "critical_high" && !["critical", "high"].includes(t.priority)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (t.title?.toLowerCase().includes(q) || t.ticket_number?.toLowerCase().includes(q) || t.client_name?.toLowerCase().includes(q));
    }
    return true;
  });

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredWorkshopJobs = workshopJobs.filter(job => {
    if (!normalizedSearch) return true;
    return [
      job.job_number, job.customer_name, job.fault_description, job.device_type,
      job.device_brand, job.device_model, job.serial_number, job.assigned_to_name,
    ].some(value => String(value || "").toLowerCase().includes(normalizedSearch));
  });
  const filteredFieldJobs = fieldJobs.filter(job => {
    if (!normalizedSearch) return true;
    return [
      job.job_number, job.customer_name, job.description, job.service_address,
      job.zone, job.job_category, job.assigned_to_name,
    ].some(value => String(value || "").toLowerCase().includes(normalizedSearch));
  });
  const supportFiltersClear = statusFilter === "all" && priorityFilter === "all" && attentionFilter === "all";

  const groupedTickets = useGroupedTickets(filteredTickets, groupBy, statusConfig, priorityConfig);

  const attentionLabel = {
    no_response: "No response",
    sla_breach: "SLA breached",
    unassigned: "Unassigned",
    critical_high: "Critical & high",
  }[attentionFilter];

  const applyQueueFilter = ({ status = "all", priority = "all", attention = "all" }) => {
    setStatusFilter(status);
    setPriorityFilter(priority);
    setAttentionFilter(attention);
    setActiveViewId(null);
    const next = new URLSearchParams(searchParams);
    if (status === "all") next.delete("status"); else next.set("status", status);
    if (priority === "all") next.delete("priority"); else next.set("priority", priority);
    if (attention === "all") next.delete("attention"); else next.set("attention", attention);
    setSearchParams(next, { replace: true });
  };


  // AI Analysis
  const handleAiAnalysis = async () => {
    if (!viewingTicket) return;
    setAiAnalyzing(true);
    try {
      const res = await axios.post(`${API}/ai/analyze-device`, {
        device_id: viewingTicket.device_id || "",
        ticket_title: viewingTicket.title,
        ticket_description: viewingTicket.description,
      }, { headers });
      setAiAnalysis(res.data);
    } catch { toast.error("AI analysis failed"); }
    finally { setAiAnalyzing(false); }
  };

  // Proofread text
  const handleProofread = async (text, target) => {
    if (!text || text.length < 3) return;
    setProofreadLoading(true);
    try {
      const res = await axios.post(`${API}/ai/proofread`, { text }, { headers });
      setProofreadResult({ ...res.data, target });
    } catch { toast.error("Proofread failed"); }
    finally { setProofreadLoading(false); }
  };

  // Run script on device
  const handleRunScript = async (scriptId) => {
    const linkedDeviceId = viewingTicket?.device_id || viewingTicket?.device_ids?.[0];
    if (!linkedDeviceId) { toast.error("No device linked to this ticket"); return; }
    try {
      await axios.post(`${API}/scripts/${scriptId}/execute`, [linkedDeviceId], { headers });
      toast.success("Script queued for execution");
    } catch { toast.error("Failed to run script"); }
  };

  // Client profiles and activity feeds can open a specific service job directly.
  // Keep the detail workflow inside Tickets so technicians retain the unified queue.
  useEffect(() => {
    const jobId = searchParams.get("service_job");
    const jobType = searchParams.get("service_type");
    if (!jobId || !jobType || loading || viewWsJob || viewFjJob) return;
    const source = jobType === "workshop" ? workshopJobs : jobType === "field" ? fieldJobs : [];
    const job = source.find(item => item.id === jobId);
    if (!job) return;
    setTypeFilter(jobType === "workshop" ? "workshop" : "cabling_wisp");
    if (jobType === "workshop") fetchWsJobDetail(job);
    else fetchFjJobDetail(job);
    const next = new URLSearchParams(searchParams);
    next.delete("service_job");
    next.delete("service_type");
    setSearchParams(next, { replace: true });
    // fetchWsJobDetail/fetchFjJobDetail intentionally run only when a requested job is present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldJobs, loading, searchParams, viewFjJob, viewWsJob, workshopJobs]);

  if (loading) return <PageShell><div className="flex items-center justify-center h-64 text-zinc-500"><Loader2 className="w-8 h-8 animate-spin" /></div></PageShell>;

  // ============ DETAIL VIEW ============
  if (viewingTicket) {
    const ticketCompleted = ["resolved", "closed"].includes(String(viewingTicket.status || "").toLowerCase());
    const ticketStage = (() => {
      const status = String(viewingTicket.status || "").toLowerCase();
      if (status === "closed") return 6;
      if (status === "resolved") return 5;
      if (status === "in_progress" || status === "on_hold") return 2;
      return 1;
    })();
    const slaHours = viewingTicket.sla_due && !ticketCompleted ? differenceInHours(new Date(viewingTicket.sla_due), new Date()) : null;
    const toolAvailability = ticketToolAvailability(viewingTicket, scripts);
    const linkedDeviceId = viewingTicket.device_id || viewingTicket.device_ids?.[0];
    const unbilledTicketItems = ticketProducts.filter(item => !item.invoice_id);
    const unbilledTicketTotal = unbilledTicketItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
    return (
      <PageShell>
        <div className="p-6 space-y-4 ticket-glass" data-testid="ticket-detail-view">
        {/* 🆕 Clean Console Header — primary surface */}
        <TicketConsoleHeader
          ticket={viewingTicket}
          clients={clients}
          onBack={() => {
            if (viewingTicket) axios.post(`${API}/tickets/${viewingTicket.id}/stop-viewing`, {}, { headers }).catch(() => {});
            setViewingTicket(null);
          }}
          onReply={() => {
            setDetailTab("conversation");
            setConversationType("email");
            window.scrollTo({ top: 800, behavior: "smooth" });
          }}
          onResolve={() => handleUpdateTicket("status", "resolved")}
          onStatusChange={(s) => handleUpdateTicket("status", s)}
          onOpenTools={() => setToolsOpen(true)}
          onInvoice={openTicketInvoiceWorkflow}
          onChangeCustomer={(updated) => updated && setViewingTicket(updated)}
          onTitleSave={(t) => { if (t && t !== viewingTicket.title) handleUpdateTicket("title", t); }}
          onDescriptionSave={(d) => { if (d !== (viewingTicket.description || "")) handleUpdateTicket("description", d); }}
          onMutate={async () => {
            try {
              const r = await axios.get(`${API}/tickets/${viewingTicket.id}`, { headers });
              setViewingTicket(r.data);
              fetchTickets();
            } catch {}
          }}
          onMoreAction={(k) => {
            if (k === "transfer") {
              try { document.querySelector('[data-testid="ticket-assignee-select"]')?.click(); } catch {}
              window.scrollTo({ top: 600, behavior: "smooth" });
            }
          }}
          isTimerRunning={isTimerRunning}
          timerElapsed={timerElapsed}
          onToggleTimer={toggleTimer}
          onStartWork={() => navigate(`/work-session?ticket=${encodeURIComponent(viewingTicket.id)}`)}
          onPinObject={() => {
            window.dispatchEvent(new CustomEvent("nexus:pin-object", { detail: {
              id: viewingTicket.id,
              type: "ticket",
              label: viewingTicket.ticket_number || viewingTicket.title || "Ticket",
              detail: viewingTicket.client_name || "Service record",
              path: `/tickets?ticket=${encodeURIComponent(viewingTicket.id)}`,
            }}));
            toast.success("Ticket pinned to your Object Dock");
          }}
        />

        <NexusVerifiedSequence complete={ticketStage} label="Nexus service record" className="shadow-sm" />

        {runbookSuggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2.5" data-testid="ticket-runbook-suggestions">
            <div className="flex items-center gap-2 mr-1 text-xs text-sky-100">
              <BookOpen className="h-3.5 w-3.5 text-sky-400" />
              <span className="font-medium">Proven fixes available</span>
            </div>
            {runbookSuggestions.map((runbook) => (
              <Button
                key={runbook.id}
                variant="ghost"
                size="sm"
                className="h-7 max-w-[260px] justify-start px-2 text-xs text-sky-200 hover:bg-sky-500/10 hover:text-sky-100"
                title={runbook.summary || runbook.title}
                onClick={() => setSelectedRunbookSuggestion(runbook)}
              >
                <BookOpen className="mr-1.5 h-3 w-3 flex-none" />
                <span className="truncate">{runbook.title}</span>
              </Button>
            ))}
          </div>
        )}

        <Dialog open={!!selectedRunbookSuggestion} onOpenChange={(open) => !open && setSelectedRunbookSuggestion(null)}>
          <DialogContent className="max-w-xl" data-testid="ticket-runbook-preview">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-sky-400" />
                {selectedRunbookSuggestion?.title || "Runbook"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {selectedRunbookSuggestion?.summary && <p className="text-sm text-muted-foreground">{selectedRunbookSuggestion.summary}</p>}
              <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                {(selectedRunbookSuggestion?.steps || []).length > 0 ? selectedRunbookSuggestion.steps.map((step, index) => (
                  <div key={`${selectedRunbookSuggestion.id}-${index}`} className="flex gap-3 text-sm">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-[10px] font-semibold text-sky-300">{index + 1}</span>
                    <div><p className="font-medium">{step.step || "Step"}</p>{step.detail && <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>}</div>
                  </div>
                )) : <p className="text-sm text-muted-foreground">This runbook does not yet contain detailed steps.</p>}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedRunbookSuggestion(null)}>Close</Button>
              <Button onClick={addRunbookToInternalNote} disabled={(selectedRunbookSuggestion?.steps || []).length === 0}>
                <ClipboardList className="mr-2 h-4 w-4" />Add steps to internal note
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {["resolved", "closed"].includes(String(viewingTicket.status || "").toLowerCase()) && (
          <div className="flex justify-end -mt-1">
            {ticketRunbook ? (
              <Button
                variant="outline"
                size="sm"
                className="border-emerald-500/30 bg-emerald-500/5 text-emerald-200 hover:bg-emerald-500/15 hover:text-emerald-100"
                onClick={() => { window.location.assign("/runbooks?tab=knowledge"); }}
                data-testid="view-ticket-runbook"
              >
                <BookOpen className="mr-2 h-3.5 w-3.5" />
                View reusable runbook
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-violet-500/30 bg-violet-500/5 text-violet-200 hover:bg-violet-500/15 hover:text-violet-100"
                onClick={createRunbookFromTicket}
                disabled={runbookCreating}
                data-testid="create-runbook-from-ticket"
              >
                {runbookCreating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <BookOpen className="mr-2 h-3.5 w-3.5" />}
                Create reusable runbook
              </Button>
            )}
          </div>
        )}

        <TicketToolsCenter
          open={toolsOpen}
          onOpenChange={setToolsOpen}
          ticket={viewingTicket}
          sections={[
            {
              id: "ai",
              title: "AI assistance",
              description: "One focused diagnostic action. Ticket summaries remain in the main ticket header.",
              icon: Sparkles,
              content: <>
                <TicketToolAction icon={Brain} title="AI diagnosis" description="Analyse likely cause, severity, and recommended next steps." busy={aiAnalyzing} onClick={handleAiAnalysis} testId="tools-ai-diagnose" />
              </>,
            },
            {
              id: "work",
              title: "Ticket actions",
              description: "Communicate, record effort, or restructure the request.",
              icon: MessageSquare,
              content: <>
                <TicketToolAction icon={Mail} title="Email client" description="Compose a tracked reply using the ticket context." state="connected" onClick={() => setIsEmailOpen(true)} />
                <TicketToolAction icon={Timer} title="Log time" description="Capture billable or non-billable technician effort." onClick={() => setIsTimeOpen(true)} />
                <TicketToolAction icon={Bell} title="Notify contacts" description="Send a service update to the ticket contacts." state="connected" onClick={() => setIsClientNotifyOpen(true)} />
                <TicketToolAction icon={GitBranch} title="Create child ticket" description="Split an independent workstream while preserving context." onClick={() => setIsChildOpen(true)} />
                <TicketToolAction icon={Merge} title="Merge tickets" description="Consolidate duplicate requests and their history." state="attention" onClick={() => setIsMergeOpen(true)} />
              </>,
            },
            {
              id: "device",
              title: "Device & automation",
              description: viewingTicket.device_id ? "Remote support, health checks, and approved scripts for the linked device." : "Link a device in ticket properties to enable remote and automation tools.",
              icon: MonitorCheck,
              content: <>
                <TicketToolAction icon={ExternalLink} title="Remote access" description={toolAvailability.remote ? `Open a support session to ${linkedDeviceId}.` : "Link a device to enable remote support."} state="connected" stateLabel="Linked" disabled={!toolAvailability.remote} onClick={() => window.open(`/remote-access?device=${linkedDeviceId}&ticket=${viewingTicket?.id || ""}`, "_blank")} />
                <TicketToolAction icon={MonitorCheck} title="Run health checks" description={toolAvailability.remote ? "Collect current endpoint health and service status." : "Link a device to run endpoint checks."} disabled={!toolAvailability.remote} onClick={() => axios.post(`${API}/tickets/${viewingTicket.id}/device/run-checks`, {}, { headers }).then(() => toast.success("Checks running")).catch(e => toast.error(e.response?.data?.detail || "Failed"))} />
                {scripts.slice(0, 6).map(script => <TicketToolAction key={script.id} icon={Terminal} title={script.name} description={script.description || "Run this approved automation against the linked device."} state="connected" stateLabel="Script" disabled={!toolAvailability.scripts} onClick={() => handleRunScript(script.id)} />)}
              </>,
            },
            {
              id: "workflow",
              title: "Workflow & lifecycle",
              description: "Manage dependencies, planned work, change control, and closure follow-up.",
              icon: GitBranch,
              content: <TicketWorkflowPanel embedded ticket={viewingTicket} allTickets={tickets} headers={headers} refresh={() => fetchTicketDetail(viewingTicket)} />,
            },
            {
              id: "billing",
              title: "Billing & output",
              description: "Add products, apply kits, invoice completed work, or export the ticket.",
              icon: Receipt,
              content: <>
                <TicketToolAction icon={ShoppingCart} title="Add product" description="Record hardware, licences, or labour used on this ticket." onClick={() => setIsAddItemOpen(true)} />
                <TicketToolAction icon={Package} title="Apply service kit" description="Add a reusable bundle of products and tasks." onClick={() => setIsKitPickerOpen(true)} />
                <TicketToolAction icon={Receipt} title="Create or update invoice" description="Review unbilled work and send it to a new or existing draft." state="attention" onClick={openTicketInvoiceWorkflow} />
                <TicketToolAction icon={Download} title="Download PDF" description="Export the ticket conversation and work summary." onClick={handleDownloadPdf} />
              </>,
            },
          ]}
        />

        {/* AI Co-Pilot Strip — heuristic next-best-action + optional AI summary */}
        {panelVisible.copilot && (
          <AICopilotStrip
            ticket={viewingTicket}
            deviceStatus={deviceStatus}
            headers={headers}
            onActionClick={(target) => {
              if (target === "csat") { axios.post(`${API}/tickets/${viewingTicket.id}/send-csat`, {}, { headers }).then(() => toast.success("CSAT sent")).catch(e => toast.error(e.response?.data?.detail || "Failed")); }
              else if (target === "assign") { try { document.querySelector('[data-testid="ticket-assignee-select"]')?.click(); } catch { /* noop */ } }
              else if (target === "wol") axios.post(`${API}/tickets/${viewingTicket.id}/device/wol`, {}, { headers }).then(r => toast(r.data?.message || "Logged")).catch(() => {});
              else if (target === "patches") axios.post(`${API}/tickets/${viewingTicket.id}/device/install-patches`, {}, { headers }).then(() => toast.success("Patch install started")).catch(e => toast.error(e.response?.data?.detail || "Failed"));
              else if (target === "checks") axios.post(`${API}/tickets/${viewingTicket.id}/device/run-checks`, {}, { headers }).then(() => toast.success("Checks running")).catch(e => toast.error(e.response?.data?.detail || "Failed"));
            }}
          />
        )}

        {/* Finance Intel: Quote Nudge banner */}
        <QuoteNudgeBanner ticketId={viewingTicket.id} token={token} />

        <TicketConnectivityVerification ticket={viewingTicket} headers={headers} />

        <TicketJumpAccessRequest ticket={viewingTicket} headers={headers} />

        {/* Title + Compact Progress side-by-side (saves vertical space) */}
        <div className="grid grid-cols-1 gap-4">
          {/* LEFT — request summary (title and customer live in the console header) */}
          <Card className="overflow-hidden border border-cyan-500/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.11),transparent_32%),radial-gradient(circle_at_top_left,rgba(16,185,129,0.06),transparent_25%),linear-gradient(135deg,rgba(17,19,24,0.98),rgba(10,12,17,0.98))] shadow-[0_12px_36px_rgba(0,0,0,0.14)]">
            <CardHeader className="border-b border-white/[0.06] pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" />Case brief</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="max-w-5xl text-sm leading-6 text-zinc-300 whitespace-pre-wrap">{viewingTicket.description || "No request details have been recorded yet."}</p>
              {/* Tags */}
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <Tag className="w-4 h-4 text-muted-foreground" />
                {(viewingTicket.tags || []).map(tag => (
                  <Badge key={tag} variant="secondary" className="gap-1 cursor-pointer" onClick={() => handleRemoveTag(tag)}>
                    {tag}<X className="w-3 h-3" />
                  </Badge>
                ))}
                <Input className="w-24 h-6 text-xs" placeholder="Add tag" value={tagInput} onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddTag()} data-testid="tag-input" />
              </div>
              {/* SLA indicator */}
              {ticketCompleted ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-2 text-sm text-emerald-300">
                  <CheckCircle className="h-4 w-4" />
                  <span>Service record completed · SLA timing retained in the audit trail</span>
                </div>
              ) : slaHours !== null && (
                <div className={`mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${slaHours < 2 ? 'border-red-500/25 bg-red-500/[0.08] text-red-300' : slaHours < 8 ? 'border-yellow-500/25 bg-yellow-500/[0.08] text-yellow-300' : 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300'}`}>
                  <Clock className="w-4 h-4" />
                  <span>SLA: {slaHours > 0 ? `${slaHours}h remaining` : `Overdue by ${Math.abs(slaHours)}h`}</span>
                  <div className={`h-2 rounded-full flex-1 max-w-[240px] ${slaHours < 2 ? 'bg-red-500/20' : slaHours < 8 ? 'bg-yellow-500/20' : 'bg-green-500/20'}`}>
                    <div className={`h-2 rounded-full transition-all ${slaHours < 2 ? 'bg-red-500' : slaHours < 8 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.max(5, Math.min(100, (1 - slaHours / 24) * 100))}%` }} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* RIGHT — Compact progress + related-tickets quick chips */}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-4">
            {/* AI ANALYSIS PANEL */}
            {panelVisible.aiAnalysis && aiAnalysis && (
              <Card className="border-purple-500/20 bg-purple-500/[0.02]" data-testid="ai-analysis-panel">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Brain className="w-5 h-5 text-purple-400" />
                      <CardTitle className="text-base text-purple-400">AI Diagnosis</CardTitle>
                      <Badge className={`text-[10px] ${aiAnalysis.severity === "critical" ? "bg-red-500/20 text-red-400" : aiAnalysis.severity === "high" ? "bg-orange-500/20 text-orange-400" : aiAnalysis.severity === "medium" ? "bg-yellow-500/20 text-yellow-400" : "bg-green-500/20 text-green-400"}`}>
                        {aiAnalysis.severity} severity
                      </Badge>
                      {aiAnalysis.estimated_time_minutes > 0 && (
                        <Badge variant="outline" className="text-[10px]"><Clock className="w-2.5 h-2.5 mr-0.5" />Est. {aiAnalysis.estimated_time_minutes}m</Badge>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setAiAnalysis(null)}><X className="w-3 h-3" /></Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm">{aiAnalysis.diagnosis}</p>
                  </div>
                  {aiAnalysis.potential_causes?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Potential Causes</p>
                      <div className="flex flex-wrap gap-1.5">
                        {aiAnalysis.potential_causes.map((cause, i) => (
                          <Badge key={`k-${i}`} variant="outline" className="text-[10px] bg-orange-500/5 border-orange-500/20">{cause}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {aiAnalysis.steps?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Recommended Fix Steps</p>
                      <div className="space-y-1.5">
                        {aiAnalysis.steps.map((step, i) => (
                          <div key={`k-${i}`} className="flex items-start gap-2 py-1 px-2 rounded bg-muted/30">
                            <span className="text-xs font-bold text-purple-400 mt-0.5">{i + 1}.</span>
                            <span className="text-xs">{step}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {aiAnalysis.recommended_scripts?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Scripts / Commands</p>
                      {aiAnalysis.recommended_scripts.map((script, i) => (
                        <code key={`k-${i}`} className="block text-[11px] bg-muted/50 px-2 py-1 rounded font-mono mb-1">{script}</code>
                      ))}
                    </div>
                  )}
                  {aiAnalysis.kb_references?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Related KB Articles</p>
                      <div className="flex flex-wrap gap-1.5">
                        {aiAnalysis.kb_references.map((ref, i) => (
                          <Badge key={`k-${i}`} variant="outline" className="text-[10px] text-blue-400 border-blue-500/20"><BookOpen className="w-2.5 h-2.5 mr-0.5" />{ref}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Related Tickets — promoted from sidebar to give better visibility */}
            {panelVisible.related && enrichment?.merge_candidates?.length > 0 && (
              <Card data-testid="related-tickets-banner" className="border-violet-500/20 bg-violet-500/[0.02]">
                <CardContent className="pt-3 pb-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Related Tickets</span>
                    <span className="text-[10px] text-muted-foreground">({enrichment.merge_candidates.length} potential duplicates / related issues)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {enrichment.merge_candidates.map(mc => (
                      <button
                        key={mc.id}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-violet-500/30 hover:bg-violet-500/10 transition-colors text-[11px]"
                        onClick={() => fetchTicketDetail(mc)}
                        data-testid={`related-ticket-chip-${mc.id}`}
                      >
                        <span className="font-mono text-violet-400">{mc.ticket_number}</span>
                        <span className="truncate max-w-[200px]">{mc.title}</span>
                        <span className={`px-1 py-0.5 rounded text-[9px] ${
                          mc.priority === "critical" ? "bg-red-500/15 text-red-400" :
                          mc.priority === "high" ? "bg-orange-500/15 text-orange-400" :
                          "bg-muted text-muted-foreground"
                        }`}>{mc.priority}</span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Tabs value={detailTab} onValueChange={setDetailTab}>
              <TicketWorkspaceTabs
                activeTab={detailTab}
                onTabChange={setDetailTab}
                counts={{
                  conversation: ticketNotes.length + ticketEmails.length + ticketSms.length,
                  tasks: worksheetItems.length,
                  files: ticketAttachments.length,
                  time: timeEntries.length,
                  items: ticketProducts.length,
                  procurement: ticketPurchaseOrders.length,
                  children: childTickets.length,
                }}
              />

              {/* BLUEPRINT / WORKSHEET TAB */}
              <TabsContent value="blueprint" className="space-y-4">
                <TicketBlueprintPanel
                  ticket={viewingTicket}
                  onTicketUpdated={(updated) => setViewingTicket(updated)}
                />
              </TabsContent>

              {/* AI SUGGESTIONS TAB */}
              <TabsContent value="suggestions" className="space-y-4">
                {suggestionsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
                    <span className="text-sm text-muted-foreground">Analyzing ticket and finding solutions...</span>
                  </div>
                ) : suggestions ? (
                  <div className="space-y-4">
                    {/* Keywords */}
                    {suggestions.keywords?.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">Matched keywords:</span>
                        {suggestions.keywords.map(kw => (
                          <Badge key={kw} variant="outline" className="text-[10px] bg-primary/5 border-primary/20">{kw}</Badge>
                        ))}
                      </div>
                    )}

                    {/* Similar Resolved Tickets */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        <h4 className="text-sm font-semibold">Similar Resolved Tickets ({suggestions.similar_tickets?.length || 0})</h4>
                      </div>
                      {suggestions.similar_tickets?.length > 0 ? (
                        <ScrollArea className="h-[220px]">
                          <div className="space-y-2">
                            {suggestions.similar_tickets.map(st => (
                              <Card key={st.ticket_id} className="border-amber-500/10 hover:border-amber-500/30 transition-colors cursor-pointer"
                                onClick={() => { const t = tickets.find(x => x.id === st.ticket_id); if (t) fetchTicketDetail(t); }}
                                data-testid={`suggestion-ticket-${st.ticket_id}`}>
                                <CardContent className="py-2.5 px-3">
                                  <div className="flex items-start justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs text-muted-foreground">{st.ticket_number}</span>
                                      <Badge variant="outline" className="text-[9px] capitalize">{st.category}</Badge>
                                      <Badge className={`text-[9px] ${priorityConfig[st.priority]?.class || ""}`}>{st.priority}</Badge>
                                    </div>
                                    <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/30">
                                      {st.relevance_score} match{st.relevance_score !== 1 ? "es" : ""}
                                    </Badge>
                                  </div>
                                  <p className="text-sm font-medium mb-1">{st.title}</p>
                                  {st.resolution_notes && (
                                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded p-2 mt-1">
                                      <p className="text-xs text-emerald-400 font-medium mb-0.5">Resolution:</p>
                                      <p className="text-xs text-muted-foreground">{st.resolution_notes.substring(0, 300)}</p>
                                    </div>
                                  )}
                                  {st.resolution_comments?.length > 0 && !st.resolution_notes && (
                                    <div className="bg-blue-500/5 border border-blue-500/10 rounded p-2 mt-1">
                                      <p className="text-xs text-blue-400 font-medium mb-0.5">Last Note by {st.resolution_comments[0].user_name}:</p>
                                      <p className="text-xs text-muted-foreground">{st.resolution_comments[0].content.substring(0, 300)}</p>
                                    </div>
                                  )}
                                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                                    {st.assigned_name && <span>Resolved by: {st.assigned_name}</span>}
                                    {st.time_spent > 0 && <span>Time: {st.time_spent}m</span>}
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </ScrollArea>
                      ) : (
                        <div className="py-6 text-center border rounded-lg border-dashed">
                          <p className="text-sm text-muted-foreground">No similar resolved tickets found</p>
                          <p className="text-xs text-muted-foreground/60">Suggestions improve as more tickets are resolved</p>
                        </div>
                      )}
                    </div>

                    {/* KB Articles */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <BookOpen className="w-4 h-4 text-blue-400" />
                        <h4 className="text-sm font-semibold">Knowledge Base Articles ({suggestions.kb_articles?.length || 0})</h4>
                      </div>
                      {suggestions.kb_articles?.length > 0 ? (
                        <ScrollArea className="h-[180px]">
                          <div className="space-y-2">
                            {suggestions.kb_articles.map(article => (
                              <div key={article.article_id} className="flex items-start gap-3 py-2.5 px-3 rounded-lg bg-blue-500/5 border border-blue-500/10 hover:border-blue-500/30 transition-colors"
                                data-testid={`suggestion-article-${article.article_id}`}>
                                <BookOpen className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <p className="text-sm font-medium truncate">{article.title}</p>
                                    <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-500/30 flex-shrink-0">
                                      {article.relevance_score} match{article.relevance_score !== 1 ? "es" : ""}
                                    </Badge>
                                  </div>
                                  <p className="text-xs text-muted-foreground line-clamp-2">{article.content_preview}</p>
                                  <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                                    <span className="capitalize">{article.category}</span>
                                    {article.helpful_count > 0 && <span className="flex items-center gap-0.5"><ThumbsUp className="w-2.5 h-2.5" />{article.helpful_count}</span>}
                                    {article.views > 0 && <span className="flex items-center gap-0.5"><Eye className="w-2.5 h-2.5" />{article.views}</span>}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      ) : (
                        <div className="py-6 text-center border rounded-lg border-dashed">
                          <p className="text-sm text-muted-foreground">No matching KB articles found</p>
                          <p className="text-xs text-muted-foreground/60">Add guides to your Knowledge Base for better suggestions</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </TabsContent>

              {/* WORKSHEETS TAB */}
              <TabsContent value="worksheets" className="space-y-4">
                <TicketWorksheetTab
                  viewingTicket={viewingTicket} headers={headers}
                  newWorksheetItem={newWorksheetItem} setNewWorksheetItem={setNewWorksheetItem}
                  worksheetItems={worksheetItems} setWorksheetItems={setWorksheetItems}
                />
              </TabsContent>


              {/* UNIFIED CONVERSATION TAB */}
              <TabsContent value="conversation" className="space-y-3">
                <TicketConversationTab
                  conversationType={conversationType} setConversationType={setConversationType}
                  newNote={newNote} setNewNote={setNewNote} handleAddNote={handleAddNote} cannedResponses={cannedResponses}
                  emailForm={emailForm} setEmailForm={setEmailForm} handleSendEmail={handleSendEmail}
                  emailSignature={emailSignature} clientContacts={clientContacts}
                  smsForm={smsForm} setSmsForm={setSmsForm} handleSendSms={handleSendSms}
                  applySmsTemplate={applySmsTemplate} smsTemplates={smsTemplates}
                  smsConfig={smsConfig} smsSending={smsSending}
                  ticketNotes={ticketNotes} ticketEmails={ticketEmails} ticketSms={ticketSms}
                />
              </TabsContent>

              {/* ATTACHMENTS TAB */}
              <TabsContent value="attachments" className="space-y-3">
                <TicketAttachmentsTab
                  ticketAttachments={ticketAttachments}
                  attachmentUploading={attachmentUploading}
                  handleAttachmentUpload={handleAttachmentUpload}
                  handleDeleteAttachment={handleDeleteAttachment}
                />
              </TabsContent>


              {/* ITEMS TAB */}
              <TabsContent value="items" className="space-y-3">
                <TicketItemsTab
                  ticketProducts={ticketProducts}
                  setIsKitPickerOpen={setIsKitPickerOpen}
                  setIsAddItemOpen={setIsAddItemOpen}
                  handleRemoveItemFromTicket={handleRemoveItemFromTicket}
                  headers={headers}
                  setInvoicesList={setInvoicesList}
                  setIsPushInvoiceOpen={setIsPushInvoiceOpen}
                />
              </TabsContent>

              <TabsContent value="procurement" className="space-y-3">
                {(() => {
                  const committed = ticketPurchaseOrders.filter(po => ["submitted", "partial", "received"].includes(po.status));
                  const supplierCost = committed.reduce((sum, po) => sum + Number(po.vendor_invoice_match?.supplier_total ?? po.total ?? 0), 0);
                  const openVariances = ticketPurchaseOrders.filter(po => po.vendor_invoice_match?.status === "variance" && po.vendor_invoice_match?.review?.status !== "accepted");
                  return <Card className="border-amber-500/20">
                    <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-amber-400" />Procurement linked to this ticket</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-3 gap-3 text-sm"><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Purchase orders</p><p className="mt-1 font-mono text-lg font-semibold">{ticketPurchaseOrders.length}</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Committed supplier cost</p><p className="mt-1 font-mono text-lg font-semibold text-amber-400">${supplierCost.toFixed(2)}</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Active variances</p><p className={`mt-1 font-mono text-lg font-semibold ${openVariances.length ? "text-amber-400" : "text-emerald-400"}`}>{openVariances.length}</p></div></div>
                      {ticketPurchaseOrders.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No purchase orders are linked to this ticket yet.</p> : <Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Vendor</TableHead><TableHead>Status</TableHead><TableHead>Invoice</TableHead><TableHead className="text-right">Supplier cost</TableHead></TableRow></TableHeader><TableBody>{ticketPurchaseOrders.map(po => { const match = po.vendor_invoice_match; const cost = Number(match?.supplier_total ?? po.total ?? 0); return <TableRow key={po.id}><TableCell><a className="font-mono text-primary hover:underline" href={`/purchase-orders?po=${encodeURIComponent(po.id)}`}>{po.po_number}</a></TableCell><TableCell>{po.vendor || "—"}</TableCell><TableCell><Badge variant="outline" className="capitalize text-xs">{String(po.status || "draft").replace(/_/g, " ")}</Badge></TableCell><TableCell>{match ? <Badge className={match.status === "matched" || match.review?.status === "accepted" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs" : "bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs"}>{match.status === "matched" ? "Matched" : match.review?.status === "accepted" ? "Accepted" : "Variance"}</Badge> : <span className="text-xs text-muted-foreground">Pending</span>}</TableCell><TableCell className="text-right font-mono">${cost.toFixed(2)}</TableCell></TableRow>; })}</TableBody></Table>}
                    </CardContent>
                  </Card>;
                })()}
              </TabsContent>

              {/* CHILDREN TAB */}
              <TabsContent value="children">
                <TicketChildrenTab
                  childTickets={childTickets}
                  fetchTicketDetail={fetchTicketDetail}
                  statusConfig={statusConfig}
                  priorityConfig={priorityConfig}
                />
              </TabsContent>

              {/* TIME TAB */}
              <TabsContent value="time">
                <TicketTimeTab timeEntries={timeEntries} />
              </TabsContent>

              {/* AUDIT TAB */}
              <TabsContent value="audit">
                <TicketAuditTab auditLog={auditLog} />
              </TabsContent>

              <TabsContent value="timeline">
                <TicketTimelineTab ticketId={viewingTicket.id} />
              </TabsContent>
            </Tabs>
          </div>

          {/* Right sidebar — stable ticket properties, never hidden by saved layout state */}
          <aside className="space-y-3 self-start lg:sticky lg:top-5" data-testid="ticket-properties-rail">
            {(viewingTicket.requester_email || viewingTicket.contact_email) && (
              <div key="requester-context" className="min-w-0">
                <WhisperRail email={viewingTicket.requester_email || viewingTicket.contact_email} />
              </div>
            )}
            {panelVisible.serviceTier && (
              <div key="serviceTier" className="min-w-0">
                <TicketServiceTierWidget
                  ticketId={viewingTicket.id}
                  clientId={viewingTicket.client_id}
                  token={token}
                  isAdmin={false}
                />
              </div>
            )}
            <div key="statusCard" className="min-w-0">
              <Card className="overflow-hidden rounded-2xl border border-cyan-500/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.13),transparent_40%),radial-gradient(circle_at_top_left,rgba(16,185,129,0.07),transparent_28%),linear-gradient(145deg,rgba(17,19,24,0.92),rgba(10,12,17,0.92))] shadow-[0_16px_42px_rgba(0,0,0,0.2)]">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] pb-3">
                  <div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-cyan-300">Ticket controls</p><p className="mt-1 text-xs text-zinc-500">Ownership, urgency and service routing</p></div>
                  <div className={`mt-0.5 h-2 w-2 rounded-full ${viewingTicket.priority === "critical" ? "bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.9)]" : viewingTicket.priority === "high" ? "bg-amber-400" : "bg-cyan-400"}`} />
                </div>
                <div className="grid grid-cols-1 gap-3">
                <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Priority</Label>
                  <Select value={viewingTicket.priority} onValueChange={v => handleUpdateTicket("priority", v)}>
                    <SelectTrigger data-testid="priority-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Assigned to</Label>
                  <Select value={viewingTicket.assigned_to || ""} onValueChange={v => handleUpdateTicket("assigned_to", v)}>
                    <SelectTrigger data-testid="ticket-assignee-select"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Category</Label>
                  <Select value={viewingTicket.category || "support"} onValueChange={v => handleUpdateTicket("category", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="support">Support</SelectItem><SelectItem value="incident">Incident</SelectItem>
                      <SelectItem value="request">Request</SelectItem><SelectItem value="problem">Problem</SelectItem>
                      <SelectItem value="change">Change</SelectItem><SelectItem value="project">Project</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-2">
                  {viewingTicket.client_id ? (
                    <a href={`/clients?client=${encodeURIComponent(viewingTicket.client_id)}`} className="rounded-lg border border-white/[0.06] bg-black/10 p-2.5 transition-colors hover:border-cyan-400/25 hover:bg-cyan-500/[0.06]" data-testid="ticket-open-client-profile" title="Open the client 360° profile">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600">Client</p>
                      <p className="mt-1 truncate text-xs font-medium text-cyan-100 hover:underline">{viewingTicket.client_name || "Open client profile"}</p>
                    </a>
                  ) : <div className="rounded-lg border border-white/[0.06] bg-black/10 p-2.5"><p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600">Client</p><p className="mt-1 truncate text-xs font-medium text-zinc-200">Unassigned</p></div>}
                  <div className="rounded-lg border border-white/[0.06] bg-black/10 p-2.5"><p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600">Created</p><p className="mt-1 text-xs font-medium text-zinc-200">{viewingTicket.created_at && format(new Date(viewingTicket.created_at), "MMM d, HH:mm")}</p></div>
                  <div className="rounded-lg border border-white/[0.06] bg-black/10 p-2.5"><p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600">Tracked time</p><p className="mt-1 font-mono text-xs font-medium text-zinc-200">{viewingTicket.total_time_minutes || 0}m</p></div>
                  {viewingTicket.watchers?.length > 0 && (
                    <div className="rounded-lg border border-white/[0.06] bg-black/10 p-2.5"><p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600">Watchers</p><p className="mt-1 text-xs font-medium text-zinc-200">{viewingTicket.watchers.length}</p></div>
                  )}
                </div>
                <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/[0.045] p-3" data-testid="ticket-commercial-context">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">Commercial context</p><p className="mt-1 text-[11px] text-zinc-500">Tracked effort and ticket items remain linked to the billing audit.</p></div>
                    <Receipt className="h-4 w-4 text-emerald-300" />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setDetailTab("time")} className="rounded-lg border border-white/[0.06] bg-black/10 p-2 text-left transition-colors hover:border-emerald-400/20 hover:bg-emerald-500/[0.05]">
                      <span className="block text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600">Tracked time</span>
                      <span className="mt-1 block font-mono text-xs font-medium text-zinc-100">{viewingTicket.total_time_minutes || 0}m</span>
                    </button>
                    <button type="button" onClick={() => setDetailTab("items")} className="rounded-lg border border-white/[0.06] bg-black/10 p-2 text-left transition-colors hover:border-emerald-400/20 hover:bg-emerald-500/[0.05]">
                      <span className="block text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600">Unbilled items</span>
                      <span className="mt-1 block font-mono text-xs font-medium text-emerald-200">{unbilledTicketItems.length} · ${unbilledTicketTotal.toFixed(2)}</span>
                    </button>
                  </div>
                  <Button type="button" variant="success" size="sm" className="mt-3 h-8 w-full text-xs" onClick={openTicketInvoiceWorkflow} data-testid="ticket-commercial-invoice">
                    <Receipt className="mr-1.5 h-3.5 w-3.5" />Review invoice workflow
                  </Button>
                </div>
                <Separator />
                <TicketLinkedDevices
                  ticket={viewingTicket}
                  devices={devices}
                  token={token}
                  onChange={(updated) => {
                    setViewingTicket(prev => prev ? { ...prev, ...updated } : prev);
                  }}
                />
                <div className="hidden">{/* legacy device select hidden, use chip-list above */}
                  <Select value={viewingTicket.device_id || "none"} onValueChange={v => handleUpdateTicket("device_id", v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- No device --</SelectItem>
                      {devices.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {/* Device info panel (primary device) */}
                {panelVisible.devicePanel && deviceStatus && (
                  <div className="mt-2 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3 space-y-2" data-testid="device-info-panel">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <MonitorCheck className="w-3.5 h-3.5 text-cyan-300" />
                        <span className="text-xs font-medium">{deviceStatus.name}</span>
                      </div>
                      <div className={`flex items-center gap-1 text-[10px] ${deviceStatus.status === "online" ? "text-emerald-400" : "text-red-400"}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${deviceStatus.status === "online" ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                        {deviceStatus.status}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 text-[10px] text-muted-foreground">
                      <span>OS: {deviceStatus.os_name || "N/A"}</span>
                      <span>IP: {deviceStatus.ip_address || "N/A"}</span>
                      <span>Type: {deviceStatus.device_type || "N/A"}</span>
                      {deviceStatus.last_seen && <span>Seen: {formatDistanceToNow(new Date(deviceStatus.last_seen), { addSuffix: true })}</span>}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            </div>

            {/* SLA Burn-down */}
            {panelVisible.burndown && (
              <div key="burndown" className="min-w-0">
                <TicketBurndownBar ticketId={viewingTicket.id} headers={headers} />
              </div>
            )}

            {/* Live Device Cockpit — per-device row with 3-dot CRAIG-style action menu */}

            {/* ── AI Enrichment: TTR + Blast Radius + Client Health (extracted) ── */}
            {panelVisible.enrichment && (
              <div key="enrichment" className="min-w-0">
                <TicketEnrichmentRail enrichment={enrichment} />
              </div>
            )}
          </aside>
        </div>

        <EmailDialog
          open={isEmailOpen} onOpenChange={setIsEmailOpen}
          emailForm={emailForm} setEmailForm={setEmailForm}
          emailSignature={emailSignature} handleSendEmail={handleSendEmail}
          clientContacts={clientContacts}
          handleProofread={handleProofread} proofreadResult={proofreadResult}
          setProofreadResult={setProofreadResult} proofreadLoading={proofreadLoading}
        />

        <ChildTicketDialog
          open={isChildOpen} onOpenChange={setIsChildOpen}
          childForm={childForm} setChildForm={setChildForm}
          handleCreateChild={handleCreateChild}
        />

        <MergeDialog
          open={isMergeOpen} onOpenChange={setIsMergeOpen}
          viewingTicket={viewingTicket} tickets={tickets}
          mergeIds={mergeIds} setMergeIds={setMergeIds} handleMerge={handleMerge}
        />

        <LogTimeDialog
          open={isTimeOpen} onOpenChange={setIsTimeOpen}
          timeForm={timeForm} setTimeForm={setTimeForm} handleAddTime={handleAddTime}
        />

        <NotifyClientDialog
          open={isClientNotifyOpen} onOpenChange={setIsClientNotifyOpen}
          notifyForm={notifyForm} setNotifyForm={setNotifyForm}
          handleNotifyClient={handleNotifyClient}
        />

        <AddItemsDialog
          open={isAddItemOpen} onOpenChange={setIsAddItemOpen}
          allProducts={allProducts} addItemProduct={addItemProduct} setAddItemProduct={setAddItemProduct}
          addItemQty={addItemQty} setAddItemQty={setAddItemQty}
          handleAddItemToTicket={handleAddItemToTicket}
          ticketProducts={ticketProducts} handleRemoveItemFromTicket={handleRemoveItemFromTicket}
        />

        {/* KIT PICKER DIALOG */}
        <KitPickerDialog
          open={isKitPickerOpen}
          onClose={() => setIsKitPickerOpen(false)}
          ticketId={viewingTicket?.id}
          token={token}
          onApplied={(res, kit) => {
            toast.success(`Applied kit "${kit.name}" — ${res.attached_count} items added`);
            // Reload ticket products
            axios.get(`${API}/tickets/${viewingTicket.id}/products`, { headers }).then(r => setTicketProducts(collectionFromResponse(r.data, ["products", "items"]))).catch(() => {});
          }}
        />

        <PushInvoiceDialog
          open={isPushInvoiceOpen} onOpenChange={setIsPushInvoiceOpen}
          ticketProducts={ticketProducts} invoicesList={invoicesList}
          pushToExisting={pushToExisting} setPushToExisting={setPushToExisting}
          handlePushToInvoice={handlePushToInvoice} ticket={viewingTicket}
        />

        {/* VIP Whisper Rail — shows rich context on the requester */}
        </div>
      </PageShell>
    );
  }

  // ============ WORKSHOP DETAIL VIEW ============
  if (viewWsJob) {
    const wsStages = [
      { key: "checked_in", label: "Checked In", color: "from-blue-500 to-blue-600", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
      { key: "diagnosing", label: "Diagnosing", color: "from-purple-500 to-purple-600", bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30" },
      { key: "parts_ordered", label: "Parts Ordered", color: "from-cyan-500 to-cyan-600", bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30" },
      { key: "repairing", label: "Repairing", color: "from-amber-500 to-amber-600", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
      { key: "ready_for_pickup", label: "Ready", color: "from-green-500 to-green-600", bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30" },
      { key: "collected", label: "Collected", color: "from-slate-500 to-slate-600", bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/30" },
    ];
    const wsIdx = wsStages.findIndex(s => s.key === viewWsJob.repair_status);
    const wsActiveIdx = wsIdx >= 0 ? wsIdx : 0;
    const wsProgress = Math.round((wsActiveIdx / (wsStages.length - 1)) * 100);
    const wsCheckDone = wsChecklist.filter(c => c.checked).length;

    return (
      <div className="space-y-4" data-testid="ws-job-detail">
        {/* Workshop job header */}
        <div className="sticky top-0 z-30 overflow-hidden rounded-2xl border border-white/[0.09] bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_30%),linear-gradient(135deg,rgba(17,19,24,0.98),rgba(10,12,17,0.98))] shadow-[0_22px_65px_rgba(0,0,0,0.34)] backdrop-blur-xl" data-testid="ws-job-header">
          <div className="flex items-center gap-2.5 p-4 flex-wrap">
            <Button variant="ghost" size="sm" className="h-9 w-9 rounded-lg p-0 text-zinc-400 hover:bg-white/[0.06] hover:text-white" onClick={() => setViewWsJob(null)} data-testid="ws-back" aria-label="Back to ticket queue" title="Back to ticket queue"><ArrowLeft className="w-4 h-4" /></Button>
            <div className="hidden w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center shadow-sm"><Wrench className="w-5 h-5 text-cyan-200" /></div>
            <div className="order-last basis-full min-w-0 pt-1 lg:order-none lg:basis-auto lg:flex-1 lg:mx-2">
              <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-cyan-300/85"><span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>Live workshop record</div>
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="font-mono text-xs font-semibold tracking-wider text-cyan-300">{viewWsJob.job_number}</span>
                <Badge className={WS_STATUSES[viewWsJob.repair_status]?.class}>{WS_STATUSES[viewWsJob.repair_status]?.label}</Badge>
                <Badge variant="outline" className="text-[10px] capitalize">{viewWsJob.priority} priority</Badge>
                {viewWsJob.warranty_status === "in_warranty" && <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><Shield className="w-3 h-3 mr-1" />Under Warranty</Badge>}
              </div>
              {wsHeaderEdit ? <Input value={wsHeaderDraft} onChange={e => setWsHeaderDraft(e.target.value)} onBlur={handleSaveWsHeader} onKeyDown={e => { if (e.key === "Enter") handleSaveWsHeader(); if (e.key === "Escape") setWsHeaderEdit(false); }} className="h-9 max-w-3xl border-cyan-500/30 bg-black/20 text-xl font-semibold" autoFocus data-testid="ws-header-title-input" /> : <button type="button" className="block max-w-full truncate text-left text-xl font-semibold tracking-tight transition-colors hover:text-cyan-100" onClick={() => { setWsHeaderDraft(viewWsJob.fault_description || ""); setWsHeaderEdit(true); }} title="Click to edit workshop title" data-testid="ws-header-title">{viewWsJob.fault_description || "Workshop repair"}</button>}
              <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/75">{viewWsJob.customer_name || "Customer pending"}</span>
                <span className="text-muted-foreground/30">•</span>
                <span>{[viewWsJob.device_brand, viewWsJob.device_model].filter(Boolean).join(" ") || viewWsJob.device_type || "Device details pending"}</span>
                {viewWsJob.serial_number && <><span className="text-muted-foreground/30">•</span><span className="font-mono">S/N {viewWsJob.serial_number}</span></>}
              </div>
            </div>
            <div className="contents">
            <TicketHeaderAction icon={Bell} tone="accent" onClick={() => { setWsNotifyForm({ email: viewWsJob.customer_email || wsIntakeForm.customer_email || "", subject: `Update: ${viewWsJob.job_number}`, message: "" }); setWsNotifyDialog(true); }} data-testid="ws-notify-btn">Notify</TicketHeaderAction>
            <TicketHeaderAction icon={ClipboardList} onClick={() => setWsIntakeDialog(true)} data-testid="ws-intake-btn">Intake</TicketHeaderAction>
            <TicketHeaderAction icon={DollarSign} onClick={() => { setWsQuoteItems(wsQuote?.line_items?.map(li => ({ description: li.description, qty: li.quantity, price: li.unit_price })) || [{ description: "", qty: 1, price: 0 }]); setWsQuoteNotes(wsQuote?.notes || ""); setWsQuoteDialog(true); }} data-testid="ws-quote-btn">Quote</TicketHeaderAction>
            <TicketHeaderAction icon={Receipt} tone="success" onClick={() => { setWsInvoiceList([]); axios.get(`${API}/invoices`, { headers }).then(r => setWsInvoiceList(r.data)).catch(() => {}); setWsInvoiceDialog(true); }} data-testid="ws-invoice-btn">Invoice</TicketHeaderAction>
            <TicketHeaderAction icon={Download} onClick={handleDownloadWsPdf} data-testid="ws-pdf-btn">PDF</TicketHeaderAction>
            <TicketHeaderAction icon={QrCode} onClick={handleDownloadWsQr} data-testid="ws-qr-btn">QR</TicketHeaderAction>
            </div>
          </div>
        </div>

        {/* Progress Tracker */}
        <Card className="overflow-hidden border-cyan-500/20 bg-[linear-gradient(135deg,rgba(8,20,28,0.72),rgba(13,16,22,0.92))]" data-testid="ws-progress-bar">
          <CardContent className="py-4 px-5">
            <div className="flex items-center justify-between mb-3">
              <div><span className="text-[10px] font-semibold text-cyan-200 uppercase tracking-[0.16em]">Service workflow</span><p className="mt-0.5 text-sm font-semibold">Repair progress</p></div>
              <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-xs font-mono text-cyan-100">{wsProgress}% complete</span>
            </div>
            <div className="h-2 rounded-full bg-muted/50 mb-4 overflow-hidden">
              <div className={`h-full rounded-full bg-gradient-to-r ${wsStages[wsActiveIdx].color} transition-all duration-700`} style={{ width: `${Math.max(5, wsProgress)}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {wsStages.map((stage, i) => {
                const isActive = i === wsActiveIdx;
                const isPast = i < wsActiveIdx;
                return (
                  <button key={stage.key} onClick={() => handleWsStatus(viewWsJob.id, stage.key)}
                    className={`rounded-lg p-2 text-center transition-all border ${isActive ? `${stage.bg} ${stage.border} ring-1 ring-offset-1 ring-offset-background ${stage.border} shadow-lg` : isPast ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/20 border-border/50 hover:bg-muted/40"}`}
                    data-testid={`ws-progress-${stage.key}`}>
                    <div className={`w-5 h-5 rounded-full mx-auto mb-1 flex items-center justify-center text-[9px] font-bold ${isActive ? `bg-gradient-to-br ${stage.color} text-white shadow-md` : isPast ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
                      {isPast ? <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg> : i + 1}
                    </div>
                    <span className={`text-[9px] font-semibold block ${isActive ? stage.text : isPast ? "text-emerald-400" : "text-muted-foreground/60"}`}>{stage.label}</span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main content — left 2/3 */}
          <div className="lg:col-span-2 space-y-4">
            {/* Job Details Card */}
            <Card className="overflow-hidden border-cyan-500/20">
              <CardHeader className="border-b border-cyan-500/15 bg-cyan-500/[0.045] pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-sm flex items-center gap-2"><Wrench className="w-4 h-4 text-cyan-300" />Service record</CardTitle><p className="mt-1 text-[11px] font-normal text-muted-foreground">Customer, asset and intake evidence retained with the repair.</p></div><Button type="button" variant="outline" size="sm" className="h-8 shrink-0 border-cyan-500/25 bg-cyan-500/[0.04] text-cyan-100 hover:bg-cyan-500/10" onClick={() => setWsIntakeDialog(true)} data-testid="ws-edit-service-record"><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit record</Button></div></CardHeader>
              <CardContent className="space-y-2 pt-4 text-sm">
                <div className="grid grid-cols-3 gap-3">
                  <div><span className="text-muted-foreground block text-xs">Customer</span><span className="font-medium">{viewWsJob.customer_name}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Phone</span><span className="font-medium">{viewWsJob.customer_phone || "-"}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Email</span><span className="font-medium">{viewWsJob.customer_email || wsIntakeForm.customer_email || "-"}</span></div>
                </div>
                <Separator />
                <div className="grid grid-cols-3 gap-3">
                  <div><span className="text-muted-foreground block text-xs">Device</span><span className="font-medium">{[viewWsJob.device_brand, viewWsJob.device_model].filter(Boolean).join(" ") || viewWsJob.device_type || "-"}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Serial</span><span className="font-mono text-xs">{viewWsJob.serial_number || "-"}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Warranty</span>
                    <Badge variant="outline" className={`text-[10px] ${viewWsJob.warranty_status === "in_warranty" ? "text-green-400 border-green-500/30" : viewWsJob.warranty_status === "expired" ? "text-red-400 border-red-500/30" : "text-muted-foreground"}`}>
                      {(viewWsJob.warranty_status || "unknown").replace("_", " ")}
                    </Badge>
                  </div>
                </div>
                {(viewWsJob.condition_on_arrival || viewWsJob.accessories_received?.length > 0) && <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-3">
                    {viewWsJob.condition_on_arrival && <div><span className="text-muted-foreground block text-xs">Condition on Arrival</span><span className="text-xs">{viewWsJob.condition_on_arrival}</span></div>}
                    {viewWsJob.accessories_received?.length > 0 && <div><span className="text-muted-foreground block text-xs">Accessories</span><div className="flex flex-wrap gap-1">{viewWsJob.accessories_received.map((a, i) => <Badge key={`k-${i}`} variant="secondary" className="text-[9px]">{a}</Badge>)}</div></div>}
                  </div>
                </>}
                <Separator />
                <div><span className="text-muted-foreground block text-xs">Fault Description</span><p className="text-sm">{viewWsJob.fault_description || "-"}</p></div>
              </CardContent>
            </Card>

            {/* Tabs */}
            <Tabs defaultValue="conversation" className="overflow-hidden rounded-xl border border-cyan-500/20 bg-card">
              <div className="border-b border-cyan-500/15 bg-cyan-500/[0.035] px-4 pt-3">
                <div className="mb-2 flex items-center justify-between gap-3"><div><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Live service workspace</span><p className="mt-0.5 text-sm font-semibold">Repair evidence and commercial record</p></div><span className="hidden text-[11px] text-muted-foreground md:block">Notes, checks, parts and audit trail</span></div>
                <TabsList className="w-full h-auto justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
                  <TabsTrigger value="conversation" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-100" data-testid="ws-conversation-tab"><MessageSquare className="w-3 h-3 mr-1.5" />Conversation <span className="ml-1 text-[10px] opacity-70">{wsConversation.notes.length + wsConversation.emails.length + wsConversation.sms.length}</span></TabsTrigger>
                  <TabsTrigger value="notes" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-100" data-testid="ws-notes-tab"><MessageSquare className="w-3 h-3 mr-1.5" />Notes <span className="ml-1 text-[10px] opacity-70">{wsNotes.length}</span></TabsTrigger>
                  <TabsTrigger value="checklist" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-100" data-testid="ws-checklist-tab"><ListChecks className="w-3 h-3 mr-1.5" />Checklist <span className="ml-1 text-[10px] opacity-70">{wsCheckDone}/{wsChecklist.length}</span></TabsTrigger>
                  <TabsTrigger value="photos" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-100" data-testid="ws-photos-tab"><Camera className="w-3 h-3 mr-1.5" />Photos <span className="ml-1 text-[10px] opacity-70">{wsPhotos.length}</span></TabsTrigger>
                  <TabsTrigger value="parts" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-100" data-testid="ws-parts-tab"><Package className="w-3 h-3 mr-1.5" />Parts <span className="ml-1 text-[10px] opacity-70">{viewWsJob.parts_used?.length || 0}</span></TabsTrigger>
                  <TabsTrigger value="quote" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-100" data-testid="ws-quote-tab"><DollarSign className="w-3 h-3 mr-1.5" />Quote</TabsTrigger>
                  <TabsTrigger value="history" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-100" data-testid="ws-history-tab"><History className="w-3 h-3 mr-1.5" />History <span className="ml-1 text-[10px] opacity-70">{wsRepairHistory.length}</span></TabsTrigger>
                  <TabsTrigger value="audit" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-100" data-testid="ws-audit-tab"><Eye className="w-3 h-3 mr-1.5" />Audit</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="conversation" className="space-y-3 p-3" data-testid="ws-conversation-panel">
                <TicketConversationTab
                  conversationType={wsConversationType} setConversationType={setWsConversationType}
                  newNote={wsConversationNote} setNewNote={setWsConversationNote}
                  handleAddNote={(options) => handleJobConversationNote("workshop", viewWsJob, wsConversationNote, setWsConversationNote, options)} cannedResponses={cannedResponses}
                  emailForm={wsEmailForm} setEmailForm={setWsEmailForm} handleSendEmail={() => handleJobConversationEmail("workshop", viewWsJob, wsEmailForm, setWsEmailForm)} emailSignature={emailSignature} clientContacts={clientContacts}
                  smsForm={wsSmsForm} setSmsForm={setWsSmsForm} handleSendSms={() => handleJobConversationSms("workshop", viewWsJob, wsSmsForm, setWsSmsForm)} applySmsTemplate={(key) => applyJobSmsTemplate(key, setWsSmsForm)} smsTemplates={smsTemplates} smsConfig={smsConfig} smsSending={smsSending}
                  ticketNotes={wsConversation.notes} ticketEmails={wsConversation.emails} ticketSms={wsConversation.sms}
                  recordLabel="workshop job"
                  allowStatusChange={false}
                />
              </TabsContent>

              {/* NOTES TAB */}
              <TabsContent value="notes" className="space-y-3">
                <div className="space-y-2">
                  <Textarea placeholder="Add a repair note..." value={wsNewNote} onChange={e => setWsNewNote(e.target.value)} rows={3} data-testid="ws-note-input" />
                  <Button size="sm" onClick={handleAddWsNote} disabled={!wsNewNote.trim()} data-testid="ws-add-note-btn"><Send className="w-3 h-3 mr-1" />Add Note</Button>
                </div>
                <ScrollArea className="h-[350px]">
                  {wsNotes.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground"><MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No repair notes yet</p></div>
                  ) : (
                    <div className="space-y-2">
                      {wsNotes.map(n => (
                        <div key={n.id} className="p-3 rounded-lg border bg-muted/10" data-testid={`ws-note-${n.id}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <Avatar className="h-6 w-6 shrink-0 border border-purple-400/30 bg-purple-500/15 text-purple-200"><AvatarImage src={n.avatar_url} alt={n.user_name || "Technician"} className="object-cover" /><AvatarFallback className="bg-transparent text-[10px] font-bold">{(n.user_name || "?")[0]}</AvatarFallback></Avatar>
                            <span className="text-xs font-semibold">{n.user_name}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">{n.created_at?.slice(0, 16).replace("T", " ")}</span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap pl-8">{n.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* DIAGNOSTIC CHECKLIST TAB */}
              <TabsContent value="checklist" className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input placeholder="Add checklist item..." value={wsNewCheckItem} onChange={e => setWsNewCheckItem(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleAddWsCheckItem()} data-testid="ws-check-input" />
                  <Button size="sm" onClick={handleAddWsCheckItem} disabled={!wsNewCheckItem.trim()}><Plus className="w-3 h-3 mr-1" />Add</Button>
                  <Button size="sm" variant="outline" onClick={async () => { try { const r = await axios.get(`${API}/workshop/diagnostic-templates`, { headers }); setWsTemplates(r.data || {}); setWsTemplateDialog(true); } catch {} }} data-testid="ws-load-template-btn"><ClipboardList className="w-3 h-3 mr-1" />Templates</Button>
                </div>
                {wsChecklist.length > 0 && <div className="text-xs text-muted-foreground">{wsCheckDone} / {wsChecklist.length} completed</div>}
                <ScrollArea className="h-[320px]">
                  {wsChecklist.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground"><ListChecks className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No checklist items. Load a template or add items manually.</p></div>
                  ) : (
                    <div className="space-y-1.5">
                      {wsChecklist.map(item => (
                        <div key={item.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${item.checked ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/10 border-border/50 hover:bg-muted/20"}`}
                          onClick={() => handleToggleWsCheckItem(item.id, item.checked)} data-testid={`ws-check-${item.id}`}>
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${item.checked ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/40"}`}>
                            {item.checked && <CheckCircle className="w-3 h-3 text-white" />}
                          </div>
                          <span className={`text-sm flex-1 ${item.checked ? "line-through text-muted-foreground" : ""}`}>{item.item}</span>
                          {item.checked_by_name && <span className="text-[10px] text-muted-foreground">{item.checked_by_name}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* PHOTOS TAB */}
              <TabsContent value="photos" className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-2">
                    <label className="cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={e => handleWsPhotoUpload(e, "before")} />
                      <Button variant="outline" size="sm" asChild><span><Camera className="w-3 h-3 mr-1" />Before Photo</span></Button>
                    </label>
                    <label className="cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={e => handleWsPhotoUpload(e, "during")} />
                      <Button variant="outline" size="sm" asChild><span><Camera className="w-3 h-3 mr-1" />During Repair</span></Button>
                    </label>
                    <label className="cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={e => handleWsPhotoUpload(e, "after")} />
                      <Button variant="outline" size="sm" asChild><span><Camera className="w-3 h-3 mr-1" />After Photo</span></Button>
                    </label>
                  </div>
                  {wsPhotoUploading && <Loader2 className="w-4 h-4 animate-spin" />}
                </div>
                {wsPhotos.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground"><ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No photos yet. Upload before/during/after photos.</p></div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {wsPhotos.map(p => (
                      <div key={p.id} className="relative group rounded-lg border overflow-hidden" data-testid={`ws-photo-${p.id}`}>
                        <img src={`${API}/uploads/workshop_photos/${p.filename}`} alt={p.original_name} className="w-full h-40 object-cover" />
                        <div className="absolute top-1 left-1"><Badge className="text-[9px] bg-black/60 text-white">{p.photo_type}</Badge></div>
                        <Button variant="destructive" size="sm" className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDeleteWsPhoto(p.id)}><X className="w-3 h-3" /></Button>
                        <div className="p-1.5 text-[10px] text-muted-foreground truncate">{p.uploaded_by_name} - {p.created_at?.slice(0, 10)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* PARTS TAB */}
              <TabsContent value="parts" className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{viewWsJob.parts_used?.length || 0} parts used</p>
                  <Button size="sm" variant="outline" onClick={() => setWsPartDialog(true)} data-testid="add-ws-part"><Plus className="w-3 h-3 mr-1" />Add Part</Button>
                </div>
                {(viewWsJob.parts_used || []).length > 0 ? (
                  <Table><TableHeader><TableRow><TableHead>Part</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                    <TableBody>{(viewWsJob.parts_used || []).map(p => (
                      <TableRow key={p.id}><TableCell className="font-medium">{p.product_name}</TableCell><TableCell className="text-right font-mono">{p.quantity}</TableCell><TableCell className="text-right font-mono">${(p.unit_price || 0).toFixed(2)}</TableCell><TableCell className="text-right font-mono font-bold">${(p.total || 0).toFixed(2)}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                ) : <div className="text-center py-8 text-muted-foreground text-sm">No parts added yet</div>}
              </TabsContent>

              {/* QUOTE TAB */}
              <TabsContent value="quote" className="space-y-3">
                {wsQuote ? (
                  <Card className="border-amber-500/20">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-amber-400" />Repair Quote</CardTitle>
                        <Badge className={`text-[10px] ${wsQuote.status === "approved" ? "bg-green-500/20 text-green-400" : wsQuote.status === "sent" ? "bg-blue-500/20 text-blue-400" : wsQuote.status === "declined" ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400"}`}>{wsQuote.status}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {wsQuote.line_items?.map((li, i) => (
                        <div key={`k-${i}`} className="flex items-center justify-between text-sm">
                          <span>{li.description}</span>
                          <span className="font-mono">{li.quantity} x ${li.unit_price?.toFixed(2)} = ${li.total?.toFixed(2)}</span>
                        </div>
                      ))}
                      <Separator />
                      <div className="flex justify-between font-bold"><span>Total</span><span className="text-green-400 font-mono">${wsQuote.total?.toFixed(2)}</span></div>
                      {wsQuote.notes && <p className="text-xs text-muted-foreground">{wsQuote.notes}</p>}
                      <div className="flex gap-2 pt-2">
                        {wsQuote.status === "draft" && <Button size="sm" onClick={handleSendWsQuote} data-testid="ws-send-quote"><Send className="w-3 h-3 mr-1" />Send to Customer</Button>}
                        {wsQuote.status === "sent" && <Button variant="success" size="sm" onClick={handleApproveWsQuote} data-testid="ws-approve-quote"><CheckCircle className="w-3 h-3 mr-1" />Mark Approved</Button>}
                        <Button size="sm" variant="outline" onClick={() => { setWsQuoteItems(wsQuote.line_items?.map(li => ({ description: li.description, qty: li.quantity, price: li.unit_price })) || [{ description: "", qty: 1, price: 0 }]); setWsQuoteNotes(wsQuote.notes || ""); setWsQuoteDialog(true); }}>Edit Quote</Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    <p>No quote created yet</p>
                    <Button size="sm" className="mt-3" onClick={() => { setWsQuoteItems([{ description: "", qty: 1, price: 0 }]); setWsQuoteNotes(""); setWsQuoteDialog(true); }} data-testid="ws-create-quote-btn"><Plus className="w-3 h-3 mr-1" />Create Quote</Button>
                  </div>
                )}
              </TabsContent>

              {/* REPAIR HISTORY TAB */}
              <TabsContent value="history" className="space-y-3">
                {wsRepairHistory.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground"><History className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No previous repair history found for this device/customer</p></div>
                ) : (
                  <ScrollArea className="h-[350px]">
                    <div className="space-y-2">
                      {wsRepairHistory.map(h => (
                        <Card key={h.id} className="border-purple-500/10 hover:border-purple-500/30 cursor-pointer transition-colors" onClick={() => fetchWsJobDetail(h)} data-testid={`ws-history-${h.id}`}>
                          <CardContent className="py-2.5 px-3">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground">{h.job_number}</span>
                                <Badge className={WS_STATUSES[h.repair_status]?.class + " text-[9px]"}>{WS_STATUSES[h.repair_status]?.label}</Badge>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{h.created_at?.slice(0, 10)}</span>
                            </div>
                            <p className="text-sm">{h.fault_description || "Workshop Job"}</p>
                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1">
                              <span>{h.device_brand} {h.device_model}</span>
                              {h.serial_number && <span className="font-mono">S/N: {h.serial_number}</span>}
                              <span className="text-green-400 font-mono">${(h.total_cost || 0).toFixed(2)}</span>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </TabsContent>

              {/* AUDIT LOG TAB */}
              <TabsContent value="audit" className="space-y-3">
                <ScrollArea className="h-[350px]">
                  {wsAuditLog.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground"><Eye className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No audit entries yet</p></div>
                  ) : (
                    <div className="space-y-1.5">
                      {wsAuditLog.map(entry => (
                        <div key={entry.id} className="flex items-start gap-3 p-2 rounded-lg bg-muted/10 text-sm" data-testid={`ws-audit-${entry.id}`}>
                          <div className="w-2 h-2 rounded-full bg-purple-400 mt-1.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-xs">{entry.user_name}</span>
                              <Badge variant="outline" className="text-[9px]">{entry.action?.replace(/_/g, " ")}</Badge>
                              <span className="text-[10px] text-muted-foreground ml-auto">{entry.created_at?.slice(0, 16).replace("T", " ")}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{entry.details}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar — right 1/3 */}
          <div className="space-y-4">
            {/* Billing Card */}
            <Card className="overflow-hidden border-emerald-500/20">
              <CardHeader className="pb-3 bg-emerald-500/[0.045] border-b border-emerald-500/15"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-emerald-400" />Commercial summary</CardTitle></CardHeader>
              <CardContent className="pt-4 space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Parts</span><span className="font-mono font-medium">${(viewWsJob.total_parts_cost || 0).toFixed(2)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Labour <span className="text-[10px]">({viewWsJob.labour_minutes || 0}m @ ${viewWsJob.labour_rate}/hr)</span></span><span className="font-mono font-medium">${(viewWsJob.total_labour_cost || 0).toFixed(2)}</span></div>
                <Separator />
                <div className="flex justify-between items-end text-base font-bold"><span>Total value</span><span className="text-emerald-400 font-mono text-lg">${(viewWsJob.total_cost || 0).toFixed(2)}</span></div>
                {viewWsJob.estimated_cost > 0 && <div className="flex justify-between text-xs text-muted-foreground"><span>Estimated</span><span className="font-mono">${viewWsJob.estimated_cost.toFixed(2)}</span></div>}
              </CardContent>
            </Card>

            {/* Labour Timer */}
            <Card className={viewWsJob.timer_running ? "border-amber-500/35 bg-amber-500/[0.045]" : "border-border/70"}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Labour timer</p><p className="font-mono text-2xl font-semibold mt-1">{viewWsJob.labour_minutes || 0}<span className="text-sm text-muted-foreground ml-1">min</span></p></div>{viewWsJob.timer_running && <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/25 animate-pulse">Live</Badge>}</div>
                <div className="flex items-center gap-2">
                  <Button variant={viewWsJob.timer_running ? "destructive" : "success"} className="flex-1" onClick={() => handleWsTimer(viewWsJob.id, viewWsJob.timer_running ? "stop" : "start")} data-testid="ws-timer-btn">
                    {viewWsJob.timer_running ? <><Pause className="w-4 h-4 mr-1" />Stop timer</> : <><Play className="w-4 h-4 mr-1" />Start timer</>}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Update Status */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Update Status</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {Object.entries(WS_STATUSES).filter(([k]) => k !== viewWsJob.repair_status).map(([k, v]) => (
                  <Button key={k} variant="outline" className={`w-full text-xs justify-start ${v.class}`} size="sm" onClick={() => handleWsStatus(viewWsJob.id, k)} data-testid={`ws-status-${k}`}>{v.label}</Button>
                ))}
              </CardContent>
            </Card>

            {/* Assigned Tech */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-purple-300" />Ownership</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2.5 rounded-lg bg-muted/[0.35] p-2.5"><span className="w-7 h-7 rounded-full bg-purple-500/15 text-purple-300 flex items-center justify-center text-xs font-semibold">{(viewWsJob.assigned_to_name || "?").slice(0, 1)}</span><div className="min-w-0"><span className="text-muted-foreground block text-[10px] uppercase tracking-wide">Bench technician</span><span className="font-medium text-xs">{viewWsJob.assigned_to_name || "Unassigned — workshop queue"}</span></div></div>
                <div className="grid grid-cols-2 gap-3 text-xs"><div><span className="text-muted-foreground block text-[10px] uppercase tracking-wide">Created by</span><span className="font-medium">{viewWsJob.created_by_name || "System"}</span></div><div><span className="text-muted-foreground block text-[10px] uppercase tracking-wide">Checked in</span><span>{viewWsJob.created_at?.slice(0, 10) || "—"}</span></div></div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ============ DIALOGS ============ */}

        {/* Add Part Dialog */}
        <Dialog open={wsPartDialog} onOpenChange={setWsPartDialog}>
          <NexusWorkflowDialog eyebrow="Workshop service" title="Add workshop part" description="Record the stock item used and keep inventory accurate." icon={ShoppingCart} tone="amber" footer={<><Button variant="outline" onClick={() => setWsPartDialog(false)}>Cancel</Button><Button onClick={handleAddWsPart} disabled={!wsPartProduct} data-testid="confirm-ws-part"><Plus className="w-4 h-4 mr-1" />Add Part</Button></>}>
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">Stock will be deducted automatically.</p>
              <Select value={wsPartProduct || "__none"} onValueChange={v => setWsPartProduct(v === "__none" ? "" : v)}>
                <SelectTrigger data-testid="ws-part-select"><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent><SelectItem value="__none">Choose...</SelectItem>{allProducts.filter(p => p.is_active !== false).map(p => <SelectItem key={p.id} value={p.id}>{p.name} - ${p.retail_price?.toFixed(2)} ({p.quantity_in_stock} in stock)</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" min="1" value={wsPartQty} onChange={e => setWsPartQty(parseInt(e.target.value) || 1)} className="w-24" placeholder="Qty" />
            </div>
          </NexusWorkflowDialog>
        </Dialog>

        {/* Quote Builder Dialog */}
        <Dialog open={wsQuoteDialog} onOpenChange={setWsQuoteDialog}>
          <NexusWorkflowDialog eyebrow="Workshop service" title="Repair quote builder" description="Build an approval-ready repair estimate with a clear cost breakdown." icon={DollarSign} tone="amber" footer={<><Button variant="outline" onClick={() => setWsQuoteDialog(false)}>Cancel</Button><Button onClick={handleSaveWsQuote} data-testid="ws-save-quote"><DollarSign className="w-4 h-4 mr-1" />Save Quote</Button></>}>
            <div className="space-y-4">
              {wsQuoteItems.map((item, i) => (
                <div key={`k-${i}`} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-6"><Label className="text-xs">Description</Label><Input value={item.description} onChange={e => { const n = [...wsQuoteItems]; n[i].description = e.target.value; setWsQuoteItems(n); }} placeholder="Labour / Part / Service" /></div>
                  <div className="col-span-2"><Label className="text-xs">Qty</Label><Input type="number" min="1" value={item.qty} onChange={e => { const n = [...wsQuoteItems]; n[i].qty = parseInt(e.target.value) || 1; setWsQuoteItems(n); }} /></div>
                  <div className="col-span-3"><Label className="text-xs">Price</Label><Input type="number" step="0.01" value={item.price} onChange={e => { const n = [...wsQuoteItems]; n[i].price = parseFloat(e.target.value) || 0; setWsQuoteItems(n); }} /></div>
                  <div className="col-span-1"><Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => setWsQuoteItems(prev => prev.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button></div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setWsQuoteItems(prev => [...prev, { description: "", qty: 1, price: 0 }])}><Plus className="w-3 h-3 mr-1" />Add Line</Button>
              <div className="flex justify-between font-bold text-lg border-t pt-3">
                <span>Total</span>
                <span className="text-green-400">${wsQuoteItems.reduce((s, i) => s + (Number(i.qty) || 1) * (Number(i.price) || 0), 0).toFixed(2)}</span>
              </div>
              <div><Label className="text-xs">Notes</Label><Textarea value={wsQuoteNotes} onChange={e => setWsQuoteNotes(e.target.value)} rows={2} placeholder="Additional notes for the customer..." /></div>
            </div>
          </NexusWorkflowDialog>
        </Dialog>

        {/* Customer Notification Dialog */}
        <Dialog open={wsNotifyDialog} onOpenChange={setWsNotifyDialog}>
          <NexusWorkflowDialog eyebrow="Workshop communication" title="Send customer update" description="Use a prepared update or write a clear status message for the customer." icon={Send} tone="cyan" footer={<><Button variant="outline" onClick={() => setWsNotifyDialog(false)}>Cancel</Button><Button onClick={handleWsNotifyCustomer} data-testid="ws-send-notify"><Send className="w-4 h-4 mr-1" />Send Notification</Button></>}>
            <div className="space-y-4">
              <div><Label>Email</Label><Input value={wsNotifyForm.email} onChange={e => setWsNotifyForm({ ...wsNotifyForm, email: e.target.value })} placeholder="customer@example.com" data-testid="ws-notify-email" /></div>
              <div><Label>Subject</Label><Input value={wsNotifyForm.subject} onChange={e => setWsNotifyForm({ ...wsNotifyForm, subject: e.target.value })} /></div>
              <div><Label>Message</Label><Textarea value={wsNotifyForm.message} onChange={e => setWsNotifyForm({ ...wsNotifyForm, message: e.target.value })} rows={4} placeholder="Your device is ready for pickup..." data-testid="ws-notify-message" /></div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => setWsNotifyForm(prev => ({ ...prev, message: `Hi ${viewWsJob.customer_name},\n\nYour device (${viewWsJob.device_brand || ""} ${viewWsJob.device_model || ""}) has been checked in for repair.\n\nJob Number: ${viewWsJob.job_number}\nFault: ${viewWsJob.fault_description}\n\nWe will keep you updated on progress.\n\nRegards,\nThe Workshop Team`, subject: `Device Checked In - ${viewWsJob.job_number}` }))}>Checked In</Button>
                <Button variant="outline" size="sm" onClick={() => setWsNotifyForm(prev => ({ ...prev, message: `Hi ${viewWsJob.customer_name},\n\nWe have completed the diagnosis on your ${viewWsJob.device_brand || ""} ${viewWsJob.device_model || ""}.\n\nPlease review the repair quote we have prepared. We will proceed once you approve.\n\nJob Number: ${viewWsJob.job_number}\n\nRegards,\nThe Workshop Team`, subject: `Quote Ready - ${viewWsJob.job_number}` }))}>Quote Ready</Button>
                <Button variant="outline" size="sm" onClick={() => setWsNotifyForm(prev => ({ ...prev, message: `Hi ${viewWsJob.customer_name},\n\nGreat news! Your ${viewWsJob.device_brand || ""} ${viewWsJob.device_model || ""} is ready for collection.\n\nJob Number: ${viewWsJob.job_number}\nTotal: $${(viewWsJob.total_cost || 0).toFixed(2)}\n\nPlease collect at your earliest convenience.\n\nRegards,\nThe Workshop Team`, subject: `Ready for Pickup - ${viewWsJob.job_number}` }))}>Ready for Pickup</Button>
              </div>
            </div>
          </NexusWorkflowDialog>
        </Dialog>

        {/* Push to Invoice Dialog */}
        <Dialog open={wsInvoiceDialog} onOpenChange={setWsInvoiceDialog}>
          <NexusWorkflowDialog eyebrow="Workshop billing" title="Send workshop job to billing" description="Create a new invoice or add the recorded work to an existing customer invoice." icon={Receipt} tone="emerald">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Parts (${(viewWsJob.total_parts_cost || 0).toFixed(2)}) + Labour (${(viewWsJob.total_labour_cost || 0).toFixed(2)}) = <strong className="text-green-400">${(viewWsJob.total_cost || 0).toFixed(2)}</strong></p>
              <Button className="w-full" onClick={() => handleWsPushToInvoice(null)} data-testid="ws-new-invoice"><Plus className="w-4 h-4 mr-1" />Create New Invoice</Button>
              {wsInvoiceList.length > 0 && <>
                <Separator />
                <p className="text-xs text-muted-foreground">Or add to existing invoice:</p>
                <ScrollArea className="h-[200px]">
                  {wsInvoiceList.slice(0, 20).map(inv => (
                    <Button key={inv.id} variant="outline" className="w-full justify-start mb-1 text-xs" size="sm" onClick={() => handleWsPushToInvoice(inv.id)}>
                      {inv.invoice_number} - {inv.client_name} (${inv.total?.toFixed(2)})
                    </Button>
                  ))}
                </ScrollArea>
              </>}
            </div>
          </NexusWorkflowDialog>
        </Dialog>

        {/* Device Intake Dialog */}
        <Dialog open={wsIntakeDialog} onOpenChange={setWsIntakeDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden p-0 gap-0">
            <DialogHeader className="px-6 pt-6 pb-5 border-b border-cyan-500/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_35%),linear-gradient(135deg,rgba(8,20,28,0.98),rgba(12,14,20,0.98))]">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center"><ClipboardList className="w-5 h-5 text-cyan-200" /></div>
                <div><DialogTitle>Edit workshop service record</DialogTitle><p className="mt-1 text-sm text-muted-foreground">Correct the customer, asset and intake details while preserving the audit trail.</p></div>
              </div>
            </DialogHeader>
            <div className="space-y-4 px-6 py-5 overflow-y-auto max-h-[63vh]">
              <section className="space-y-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4">
                <div className="flex items-center gap-2"><Wrench className="h-4 w-4 text-cyan-300" /><h3 className="text-sm font-semibold">Customer & repair brief</h3></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><Label>Customer name</Label><Input value={wsIntakeForm.customer_name} onChange={e => setWsIntakeForm({ ...wsIntakeForm, customer_name: e.target.value })} placeholder="Customer or organisation" /></div><div><Label>Phone</Label><Input value={wsIntakeForm.customer_phone} onChange={e => setWsIntakeForm({ ...wsIntakeForm, customer_phone: e.target.value })} placeholder="Contact number" /></div></div>
                <div><Label>Fault description</Label><Textarea value={wsIntakeForm.fault_description} onChange={e => setWsIntakeForm({ ...wsIntakeForm, fault_description: e.target.value })} rows={3} placeholder="Fault reported, symptoms and requested outcome" /></div>
              </section>
              <section className="space-y-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.025] p-4">
                <div className="flex items-center gap-2"><Cpu className="h-4 w-4 text-cyan-300" /><h3 className="text-sm font-semibold">Asset identification</h3></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div><Label>Device type</Label><Input value={wsIntakeForm.device_type} onChange={e => setWsIntakeForm({ ...wsIntakeForm, device_type: e.target.value })} placeholder="Laptop" /></div><div><Label>Brand</Label><Input value={wsIntakeForm.device_brand} onChange={e => setWsIntakeForm({ ...wsIntakeForm, device_brand: e.target.value })} placeholder="Lenovo" /></div><div><Label>Model</Label><Input value={wsIntakeForm.device_model} onChange={e => setWsIntakeForm({ ...wsIntakeForm, device_model: e.target.value })} placeholder="ThinkPad T14" /></div></div>
                <div><Label>Serial number</Label><Input className="font-mono" value={wsIntakeForm.serial_number} onChange={e => setWsIntakeForm({ ...wsIntakeForm, serial_number: e.target.value })} placeholder="Manufacturer serial number" /></div>
              </section>
              <section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4 space-y-3">
                <div className="flex items-center gap-2"><User className="w-4 h-4 text-cyan-300" /><h3 className="text-sm font-semibold">Customer & access</h3></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label>Customer email</Label><Input value={wsIntakeForm.customer_email} onChange={e => setWsIntakeForm({ ...wsIntakeForm, customer_email: e.target.value })} placeholder="customer@example.com" data-testid="ws-intake-email" /></div>
                  <div><Label>Login password or PIN <span className="text-muted-foreground font-normal">(optional)</span></Label><Input value={wsIntakeForm.customer_password} onChange={e => setWsIntakeForm({ ...wsIntakeForm, customer_password: e.target.value })} placeholder="Only if required to test" type="password" data-testid="ws-intake-password" /></div>
                </div>
                <p className="text-[11px] text-muted-foreground">Only record access details required for diagnosis. Never add recovery codes or MFA secrets.</p>
              </section>
              <section className="rounded-xl border border-amber-500/20 bg-amber-500/[0.035] p-4 space-y-3">
                <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" /><h3 className="text-sm font-semibold">Arrival condition & contents</h3></div>
                <div><Label>Physical condition on arrival</Label>
                <Select value={wsIntakeForm.condition_on_arrival || "not_assessed"} onValueChange={v => setWsIntakeForm({ ...wsIntakeForm, condition_on_arrival: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_assessed">Not Assessed</SelectItem>
                    <SelectItem value="excellent">Excellent - No visible damage</SelectItem>
                    <SelectItem value="good">Good - Minor wear</SelectItem>
                    <SelectItem value="fair">Fair - Some scratches/dents</SelectItem>
                    <SelectItem value="poor">Poor - Significant damage</SelectItem>
                    <SelectItem value="broken">Broken - Major physical damage</SelectItem>
                  </SelectContent>
                </Select>
                </div>
                <div><Label>Accessories received</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  {["Charger", "Power Cable", "Bag/Case", "Mouse", "Keyboard", "USB Drive", "Manual", "Box"].map(acc => (
                    <label key={acc} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs cursor-pointer transition-colors ${wsIntakeForm.accessories_received.includes(acc) ? "border-purple-500/35 bg-purple-500/10 text-purple-100" : "border-border/60 hover:bg-muted/30"}`}>
                      <Checkbox checked={wsIntakeForm.accessories_received.includes(acc)} onCheckedChange={c => {
                        setWsIntakeForm(prev => ({ ...prev, accessories_received: c ? [...prev.accessories_received, acc] : prev.accessories_received.filter(a => a !== acc) }));
                      }} />{acc}
                    </label>
                  ))}
                  </div>
                </div>
              </section>
              <section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4 space-y-3">
                <div className="flex items-center gap-2"><Shield className="w-4 h-4 text-emerald-300" /><h3 className="text-sm font-semibold">Warranty</h3></div>
                <div className="grid grid-cols-2 gap-3">
                <div><Label>Warranty Status</Label>
                  <Select value={wsIntakeForm.warranty_status} onValueChange={v => setWsIntakeForm({ ...wsIntakeForm, warranty_status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Unknown</SelectItem>
                      <SelectItem value="in_warranty">In Warranty</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                      <SelectItem value="void">Voided</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Warranty Expiry</Label><Input type="date" value={wsIntakeForm.warranty_expiry} onChange={e => setWsIntakeForm({ ...wsIntakeForm, warranty_expiry: e.target.value })} /></div>
                </div>
              </section>
              <p className="text-xs text-muted-foreground px-1">Tip: take a before photo from the Photos tab for any existing damage, then save this intake record.</p>
            </div>
            <DialogFooter className="px-6 py-4 border-t bg-muted/[0.12]">
              <Button variant="outline" onClick={() => setWsIntakeDialog(false)}>Cancel</Button><Button onClick={handleSaveWsIntake} data-testid="ws-save-intake"><CheckCircle className="w-4 h-4 mr-1" />Save service record</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Diagnostic Template Picker Dialog */}
        <Dialog open={wsTemplateDialog} onOpenChange={setWsTemplateDialog}>
          <NexusWorkflowDialog eyebrow="Workshop diagnostics" title="Load diagnostic checklist" description="Start from a tested device checklist to keep diagnosis consistent." icon={ClipboardList} tone="violet">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Select a device-type template to load pre-built diagnostic checklist items.</p>
              {Object.entries(wsTemplates).map(([key, items]) => (
                <Button key={key} variant="outline" className="w-full justify-between" onClick={() => handleLoadWsTemplate(key)} data-testid={`ws-template-${key}`}>
                  <span className="capitalize font-medium">{key}</span>
                  <Badge variant="secondary" className="text-[10px]">{items.length} items</Badge>
                </Button>
              ))}
            </div>
          </NexusWorkflowDialog>
        </Dialog>
      </div>
    );
  }

  // ============ FIELD JOB DETAIL VIEW ============
  if (viewFjJob) {
    const fjStages = [
      { key: "scheduled", label: "Scheduled", color: "from-blue-500 to-blue-600", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
      { key: "en_route", label: "En Route", color: "from-cyan-500 to-cyan-600", bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30" },
      { key: "on_site", label: "On Site", color: "from-purple-500 to-purple-600", bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30" },
      { key: "in_progress", label: "In Progress", color: "from-amber-500 to-amber-600", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
      { key: "completed", label: "Completed", color: "from-green-500 to-green-600", bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30" },
    ];
    const fjIdx = fjStages.findIndex(s => s.key === viewFjJob.field_status);
    const fjActiveIdx = fjIdx >= 0 ? fjIdx : 0;
    const fjProgress = Math.round((fjActiveIdx / (fjStages.length - 1)) * 100);
    const fjCheckDone = fjChecklist.filter(c => c.checked).length;
    const fjMatTotal = fjMaterials.reduce((s, m) => s + (m.total || 0), 0);

    return (
      <div className="space-y-4" data-testid="fj-detail">
        {/* Field job header */}
        <div className="sticky top-0 z-30 overflow-hidden rounded-2xl border border-white/[0.09] bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_30%),linear-gradient(135deg,rgba(17,19,24,0.98),rgba(10,12,17,0.98))] shadow-[0_22px_65px_rgba(0,0,0,0.34)] backdrop-blur-xl" data-testid="fj-job-header">
          <div className="flex items-center gap-2.5 p-4 flex-wrap">
            <Button variant="ghost" size="sm" className="h-9 w-9 rounded-lg p-0 text-zinc-400 hover:bg-white/[0.06] hover:text-white" onClick={() => setViewFjJob(null)} data-testid="fj-back" aria-label="Back to ticket queue" title="Back to ticket queue"><ArrowLeft className="w-4 h-4" /></Button>
            <div className="hidden w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center shadow-sm"><Radio className="w-5 h-5 text-cyan-300" /></div>
            <div className="order-last basis-full min-w-0 pt-1 lg:order-none lg:basis-auto lg:flex-1 lg:mx-2">
              <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-cyan-300/85"><span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>Live field service record</div>
              <div className="flex items-center gap-2 flex-wrap mb-1.5"><span className="font-mono text-xs font-semibold tracking-wider text-cyan-300">{viewFjJob.job_number}</span><Badge className={FJ_STATUSES[viewFjJob.field_status]?.class}>{FJ_STATUSES[viewFjJob.field_status]?.label}</Badge><Badge variant="outline" className="text-[10px] capitalize">{viewFjJob.job_category}</Badge><Badge variant="outline" className="text-[10px] capitalize">{viewFjJob.priority} priority</Badge></div>
              {fjHeaderEdit ? <Input value={fjHeaderDraft} onChange={e => setFjHeaderDraft(e.target.value)} onBlur={handleSaveFjHeader} onKeyDown={e => { if (e.key === "Enter") handleSaveFjHeader(); if (e.key === "Escape") setFjHeaderEdit(false); }} className="h-9 max-w-3xl border-cyan-500/30 bg-black/20 text-xl font-semibold" autoFocus data-testid="fj-header-title-input" /> : <button type="button" className="block max-w-full truncate text-left text-xl font-semibold tracking-tight transition-colors hover:text-cyan-100" onClick={() => { setFjHeaderDraft(viewFjJob.description || ""); setFjHeaderEdit(true); }} title="Click to edit field job title" data-testid="fj-header-title">{viewFjJob.description || "Field service job"}</button>}
              <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5 text-xs text-muted-foreground"><span className="font-medium text-foreground/75">{viewFjJob.customer_name || "Customer pending"}</span><span className="text-muted-foreground/30">•</span><span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-cyan-300" />{viewFjJob.service_address || "Site address pending"}</span>{viewFjJob.scheduled_date && <><span className="text-muted-foreground/30">•</span><span>{viewFjJob.scheduled_date} {viewFjJob.scheduled_time || ""}</span></>}</div>
            </div>
            <div className="contents">
            <TicketHeaderAction icon={Bell} tone="accent" onClick={() => { setFjNotifyForm({ email: viewFjJob.customer_email || "", subject: `Update: ${viewFjJob.job_number}`, message: "" }); setFjNotifyDialog(true); }} data-testid="fj-notify-btn">Notify</TicketHeaderAction>
            <TicketHeaderAction icon={MapPin} onClick={() => setFjSiteDialog(true)} data-testid="fj-site-btn">Site info</TicketHeaderAction>
            <TicketHeaderAction icon={DollarSign} onClick={() => { setFjQuoteItems(fjQuote?.line_items?.map(li => ({ description: li.description, qty: li.quantity, price: li.unit_price })) || [{ description: "", qty: 1, price: 0 }]); setFjQuoteNotes(fjQuote?.notes || ""); setFjQuoteDialog(true); }} data-testid="fj-quote-btn">Quote</TicketHeaderAction>
            <TicketHeaderAction icon={Receipt} tone="success" onClick={() => { setFjInvoiceList([]); axios.get(`${API}/invoices`, { headers }).then(r => setFjInvoiceList(r.data)).catch(() => {}); setFjInvoiceDialog(true); }} data-testid="fj-invoice-btn">Invoice</TicketHeaderAction>
            <TicketHeaderAction icon={Download} onClick={handleDownloadFjPdf} data-testid="fj-pdf-btn">PDF</TicketHeaderAction>
            <TicketHeaderAction icon={QrCode} onClick={handleDownloadFjQr} data-testid="fj-qr-btn">QR</TicketHeaderAction>
            </div>
          </div>
        </div>

        {/* Progress Tracker */}
        <Card className="overflow-hidden border-cyan-500/20 bg-[linear-gradient(135deg,rgba(8,20,28,0.72),rgba(13,16,22,0.92))]" data-testid="fj-progress-bar">
          <CardContent className="py-4 px-5">
            <div className="flex items-center justify-between mb-3">
              <div><span className="text-[10px] font-semibold text-cyan-200 uppercase tracking-[0.16em]">Service workflow</span><p className="mt-0.5 text-sm font-semibold">Field job progress</p></div>
              <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-xs font-mono text-cyan-100">{fjProgress}% complete</span>
            </div>
            <div className="h-2 rounded-full bg-muted/50 mb-4 overflow-hidden">
              <div className={`h-full rounded-full bg-gradient-to-r ${fjStages[fjActiveIdx].color} transition-all duration-700`} style={{ width: `${Math.max(5, fjProgress)}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              {fjStages.map((stage, i) => {
                const isActive = i === fjActiveIdx;
                const isPast = i < fjActiveIdx;
                return (
                  <button key={stage.key} onClick={() => handleFjStatus(viewFjJob.id, stage.key)}
                    className={`rounded-lg p-2 text-center transition-all border ${isActive ? `${stage.bg} ${stage.border} ring-1 ring-offset-1 ring-offset-background ${stage.border} shadow-lg` : isPast ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/20 border-border/50 hover:bg-muted/40"}`}
                    data-testid={`fj-progress-${stage.key}`}>
                    <div className={`w-5 h-5 rounded-full mx-auto mb-1 flex items-center justify-center text-[9px] font-bold ${isActive ? `bg-gradient-to-br ${stage.color} text-white shadow-md` : isPast ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
                      {isPast ? <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg> : i + 1}
                    </div>
                    <span className={`text-[9px] font-semibold block ${isActive ? stage.text : isPast ? "text-emerald-400" : "text-muted-foreground/60"}`}>{stage.label}</span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-4">
            {/* Job Details */}
            <Card className="overflow-hidden border-cyan-500/20">
              <CardHeader className="border-b border-cyan-500/15 bg-cyan-500/[0.045] pb-3"><CardTitle className="text-sm flex items-center gap-2"><Wifi className="w-4 h-4 text-cyan-300" />Service record</CardTitle><p className="text-[11px] font-normal text-muted-foreground">Client, site and dispatch information retained with the job.</p></CardHeader>
              <CardContent className="space-y-2 pt-4 text-sm">
                <div className="grid grid-cols-3 gap-3">
                  <div><span className="text-muted-foreground block text-xs">Customer</span><span className="font-medium">{viewFjJob.customer_name}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Phone</span><span className="font-medium">{viewFjJob.customer_phone || "-"}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Zone</span><Badge variant="outline">{viewFjJob.zone || "Unassigned"}</Badge></div>
                </div>
                <Separator />
                <div><span className="text-muted-foreground block text-xs">Service Address</span><span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-cyan-400" />{viewFjJob.service_address || "-"}</span></div>
                <div><span className="text-muted-foreground block text-xs">Description</span><p className="text-sm">{viewFjJob.description || "-"}</p></div>
                <Separator />
                <div className="grid grid-cols-3 gap-3">
                  <div><span className="text-muted-foreground block text-xs">Scheduled</span><span className="font-medium">{viewFjJob.scheduled_date} {viewFjJob.scheduled_time}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Est. Duration</span><span>{viewFjJob.estimated_duration || 60} min</span></div>
                  <div><span className="text-muted-foreground block text-xs">Category</span><Badge variant="outline" className="capitalize">{viewFjJob.job_category}</Badge></div>
                </div>
              </CardContent>
            </Card>

            {/* Tabs */}
            <Tabs defaultValue="conversation" className="overflow-hidden rounded-xl border border-cyan-500/20 bg-card">
              <div className="border-b border-cyan-500/15 bg-cyan-500/[0.035] px-4 pt-3">
                <div className="mb-2 flex items-center justify-between gap-3"><div><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Live service workspace</span><p className="mt-0.5 text-sm font-semibold">Field evidence and completion record</p></div><span className="hidden text-[11px] text-muted-foreground md:block">Notes, checks, materials and audit trail</span></div>
                <TabsList className="w-full h-auto justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
                  <TabsTrigger value="conversation" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-200" data-testid="fj-conversation-tab"><MessageSquare className="w-3 h-3 mr-1.5" />Conversation <span className="ml-1 text-[10px] opacity-70">{fjConversation.notes.length + fjConversation.emails.length + fjConversation.sms.length}</span></TabsTrigger>
                  <TabsTrigger value="notes" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-200" data-testid="fj-notes-tab"><MessageSquare className="w-3 h-3 mr-1.5" />Notes <span className="ml-1 text-[10px] opacity-70">{fjNotes.length}</span></TabsTrigger>
                  <TabsTrigger value="checklist" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-200" data-testid="fj-checklist-tab"><ListChecks className="w-3 h-3 mr-1.5" />Checklist <span className="ml-1 text-[10px] opacity-70">{fjCheckDone}/{fjChecklist.length}</span></TabsTrigger>
                  <TabsTrigger value="photos" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-200" data-testid="fj-photos-tab"><Camera className="w-3 h-3 mr-1.5" />Photos <span className="ml-1 text-[10px] opacity-70">{fjPhotos.length}</span></TabsTrigger>
                  <TabsTrigger value="equipment" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-200" data-testid="fj-equip-tab"><Cpu className="w-3 h-3 mr-1.5" />Equipment <span className="ml-1 text-[10px] opacity-70">{fjEquipment.length}</span></TabsTrigger>
                  <TabsTrigger value="materials" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-200" data-testid="fj-mat-tab"><Package className="w-3 h-3 mr-1.5" />Materials <span className="ml-1 text-[10px] opacity-70">{fjMaterials.length}</span></TabsTrigger>
                  <TabsTrigger value="quote" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-200" data-testid="fj-quote-tab"><DollarSign className="w-3 h-3 mr-1.5" />Quote</TabsTrigger>
                  <TabsTrigger value="history" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-200" data-testid="fj-history-tab"><History className="w-3 h-3 mr-1.5" />History <span className="ml-1 text-[10px] opacity-70">{fjJobHistory.length}</span></TabsTrigger>
                  <TabsTrigger value="audit" className="flex-none rounded-b-none border-b-2 border-transparent px-3 py-2.5 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:text-cyan-200" data-testid="fj-audit-tab"><Eye className="w-3 h-3 mr-1.5" />Audit</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="conversation" className="space-y-3 p-3" data-testid="fj-conversation-panel">
                <TicketConversationTab
                  conversationType={fjConversationType} setConversationType={setFjConversationType}
                  newNote={fjConversationNote} setNewNote={setFjConversationNote}
                  handleAddNote={(options) => handleJobConversationNote("field", viewFjJob, fjConversationNote, setFjConversationNote, options)} cannedResponses={cannedResponses}
                  emailForm={fjEmailForm} setEmailForm={setFjEmailForm} handleSendEmail={() => handleJobConversationEmail("field", viewFjJob, fjEmailForm, setFjEmailForm)} emailSignature={emailSignature} clientContacts={clientContacts}
                  smsForm={fjSmsForm} setSmsForm={setFjSmsForm} handleSendSms={() => handleJobConversationSms("field", viewFjJob, fjSmsForm, setFjSmsForm)} applySmsTemplate={(key) => applyJobSmsTemplate(key, setFjSmsForm)} smsTemplates={smsTemplates} smsConfig={smsConfig} smsSending={smsSending}
                  ticketNotes={fjConversation.notes} ticketEmails={fjConversation.emails} ticketSms={fjConversation.sms}
                  recordLabel="field job"
                  allowStatusChange={false}
                />
              </TabsContent>

              {/* NOTES */}
              <TabsContent value="notes" className="space-y-3">
                <div className="space-y-2">
                  <Textarea placeholder="Add a field note..." value={fjNewNote} onChange={e => setFjNewNote(e.target.value)} rows={3} data-testid="fj-note-input" />
                  <Button size="sm" onClick={handleAddFjNote} disabled={!fjNewNote.trim()} data-testid="fj-add-note-btn"><Send className="w-3 h-3 mr-1" />Add Note</Button>
                </div>
                <ScrollArea className="h-[350px]">
                  {fjNotes.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground"><MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No field notes yet</p></div>
                  ) : (
                    <div className="space-y-2">
                      {fjNotes.map(n => (
                        <div key={n.id} className="p-3 rounded-lg border bg-muted/10">
                          <div className="flex items-center gap-2 mb-1">
                            <Avatar className="h-6 w-6 shrink-0 border border-cyan-400/30 bg-cyan-500/15 text-cyan-100"><AvatarImage src={n.avatar_url} alt={n.user_name || "Technician"} className="object-cover" /><AvatarFallback className="bg-transparent text-[10px] font-bold">{(n.user_name || "?")[0]}</AvatarFallback></Avatar>
                            <span className="text-xs font-semibold">{n.user_name}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">{n.created_at?.slice(0, 16).replace("T", " ")}</span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap pl-8">{n.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* CHECKLIST */}
              <TabsContent value="checklist" className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input placeholder="Add checklist item..." value={fjNewCheckItem} onChange={e => setFjNewCheckItem(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleAddFjCheckItem()} data-testid="fj-check-input" />
                  <Button size="sm" onClick={handleAddFjCheckItem} disabled={!fjNewCheckItem.trim()}><Plus className="w-3 h-3 mr-1" />Add</Button>
                  <Button size="sm" variant="outline" onClick={async () => { try { const r = await axios.get(`${API}/field-jobs/enhanced-templates`, { headers }); setFjTemplates(r.data || {}); setFjTemplateDialog(true); } catch {} }} data-testid="fj-load-template-btn"><ClipboardList className="w-3 h-3 mr-1" />Templates</Button>
                </div>
                {fjChecklist.length > 0 && <div className="text-xs text-muted-foreground">{fjCheckDone} / {fjChecklist.length} completed</div>}
                <ScrollArea className="h-[320px]">
                  {fjChecklist.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground"><ListChecks className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No checklist items. Load a template or add manually.</p></div>
                  ) : (
                    <div className="space-y-1.5">
                      {fjChecklist.map(item => (
                        <div key={item.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${item.checked ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/10 border-border/50 hover:bg-muted/20"}`}
                          onClick={() => handleToggleFjCheckItem(item.id, item.checked)} data-testid={`fj-check-${item.id}`}>
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${item.checked ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/40"}`}>
                            {item.checked && <CheckCircle className="w-3 h-3 text-white" />}
                          </div>
                          <span className={`text-sm flex-1 ${item.checked ? "line-through text-muted-foreground" : ""}`}>{item.item}</span>
                          {item.checked_by_name && <span className="text-[10px] text-muted-foreground">{item.checked_by_name}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* PHOTOS */}
              <TabsContent value="photos" className="space-y-3">
                <div className="flex items-center gap-2">
                  {["site_survey", "before", "during", "after", "completion"].map(type => (
                    <label key={type} className="cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={e => handleFjPhotoUpload(e, type)} />
                      <Button variant="outline" size="sm" asChild><span><Camera className="w-3 h-3 mr-1" />{type.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}</span></Button>
                    </label>
                  ))}
                  {fjPhotoUploading && <Loader2 className="w-4 h-4 animate-spin" />}
                </div>
                {fjPhotos.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground"><ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No photos yet. Upload site survey, installation, or completion photos.</p></div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {fjPhotos.map(p => (
                      <div key={p.id} className="relative group rounded-lg border overflow-hidden">
                        <img src={`${API}/uploads/field_photos/${p.filename}`} alt={p.original_name} className="w-full h-40 object-cover" />
                        <div className="absolute top-1 left-1"><Badge className="text-[9px] bg-black/60 text-white">{p.photo_type.replace("_", " ")}</Badge></div>
                        <Button variant="destructive" size="sm" className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDeleteFjPhoto(p.id)}><X className="w-3 h-3" /></Button>
                        <div className="p-1.5 text-[10px] text-muted-foreground truncate">{p.uploaded_by_name} - {p.created_at?.slice(0, 10)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* EQUIPMENT */}
              <TabsContent value="equipment" className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{fjEquipment.length} equipment items tracked</p>
                  <Button size="sm" onClick={() => setFjEquipDialog(true)} data-testid="fj-add-equip"><Plus className="w-3 h-3 mr-1" />Add Equipment</Button>
                </div>
                {fjEquipment.length > 0 ? (
                  <Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Brand/Model</TableHead><TableHead>Serial</TableHead><TableHead>MAC</TableHead><TableHead>IP</TableHead><TableHead>Action</TableHead><TableHead></TableHead></TableRow></TableHeader>
                    <TableBody>{fjEquipment.map(eq => (
                      <TableRow key={eq.id}>
                        <TableCell className="font-medium text-xs">{eq.equipment_type}</TableCell>
                        <TableCell className="text-xs">{eq.brand} {eq.model}</TableCell>
                        <TableCell className="font-mono text-[10px]">{eq.serial_number || "-"}</TableCell>
                        <TableCell className="font-mono text-[10px]">{eq.mac_address || "-"}</TableCell>
                        <TableCell className="font-mono text-[10px]">{eq.ip_address || "-"}</TableCell>
                        <TableCell><Badge variant="outline" className={`text-[9px] ${eq.action === "installed" ? "text-green-400 border-green-500/30" : "text-red-400 border-red-500/30"}`}>{eq.action}</Badge></TableCell>
                        <TableCell><Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleDeleteFjEquipment(eq.id)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                ) : <div className="text-center py-8 text-muted-foreground text-sm"><Cpu className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No equipment tracked yet</p></div>}
              </TabsContent>

              {/* MATERIALS */}
              <TabsContent value="materials" className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{fjMaterials.length} materials used — Total: <span className="text-green-400 font-mono">${fjMatTotal.toFixed(2)}</span></p>
                  <Button size="sm" onClick={() => setFjMatDialog(true)} data-testid="fj-add-mat"><Plus className="w-3 h-3 mr-1" />Add Material</Button>
                </div>
                {fjMaterials.length > 0 ? (
                  <Table><TableHeader><TableRow><TableHead>Material</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
                    <TableBody>{fjMaterials.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.material}</TableCell>
                        <TableCell className="text-right font-mono">{m.quantity}</TableCell>
                        <TableCell className="text-xs">{m.unit}</TableCell>
                        <TableCell className="text-right font-mono">${(m.unit_cost || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono font-bold">${(m.total || 0).toFixed(2)}</TableCell>
                        <TableCell><Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleDeleteFjMaterial(m.id)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                ) : <div className="text-center py-8 text-muted-foreground text-sm"><Package className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No materials logged yet</p></div>}
              </TabsContent>

              {/* QUOTE */}
              <TabsContent value="quote" className="space-y-3">
                {fjQuote ? (
                  <Card className="border-amber-500/20">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-amber-400" />Service Quote</CardTitle>
                        <Badge className={`text-[10px] ${fjQuote.status === "approved" ? "bg-green-500/20 text-green-400" : fjQuote.status === "sent" ? "bg-blue-500/20 text-blue-400" : fjQuote.status === "declined" ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400"}`}>{fjQuote.status}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {fjQuote.line_items?.map((li, i) => (
                        <div key={`k-${i}`} className="flex items-center justify-between text-sm">
                          <span>{li.description}</span>
                          <span className="font-mono">{li.quantity} x ${li.unit_price?.toFixed(2)} = ${li.total?.toFixed(2)}</span>
                        </div>
                      ))}
                      <Separator />
                      <div className="flex justify-between font-bold"><span>Total</span><span className="text-green-400 font-mono">${fjQuote.total?.toFixed(2)}</span></div>
                      {fjQuote.notes && <p className="text-xs text-muted-foreground">{fjQuote.notes}</p>}
                      <div className="flex gap-2 pt-2">
                        {fjQuote.status === "draft" && <Button size="sm" onClick={handleSendFjQuote}><Send className="w-3 h-3 mr-1" />Send to Customer</Button>}
                        {fjQuote.status === "sent" && <Button variant="success" size="sm" onClick={handleApproveFjQuote}><CheckCircle className="w-3 h-3 mr-1" />Mark Approved</Button>}
                        <Button size="sm" variant="outline" onClick={() => { setFjQuoteItems(fjQuote.line_items?.map(li => ({ description: li.description, qty: li.quantity, price: li.unit_price })) || [{ description: "", qty: 1, price: 0 }]); setFjQuoteNotes(fjQuote.notes || ""); setFjQuoteDialog(true); }}>Edit Quote</Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No quote created yet</p>
                    <Button size="sm" className="mt-3" onClick={() => { setFjQuoteItems([{ description: "", qty: 1, price: 0 }]); setFjQuoteNotes(""); setFjQuoteDialog(true); }} data-testid="fj-create-quote-btn"><Plus className="w-3 h-3 mr-1" />Create Quote</Button>
                  </div>
                )}
              </TabsContent>

              {/* HISTORY */}
              <TabsContent value="history" className="space-y-3">
                {fjJobHistory.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground"><History className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No previous jobs found at this address / for this customer</p></div>
                ) : (
                  <ScrollArea className="h-[350px]">
                    <div className="space-y-2">
                      {fjJobHistory.map(h => (
                        <Card key={h.id} className="border-cyan-500/10 hover:border-cyan-500/30 cursor-pointer transition-colors" onClick={() => fetchFjJobDetail(h)}>
                          <CardContent className="py-2.5 px-3">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground">{h.job_number}</span>
                                <Badge className={FJ_STATUSES[h.field_status]?.class + " text-[9px]"}>{FJ_STATUSES[h.field_status]?.label}</Badge>
                                <Badge variant="outline" className="text-[9px] capitalize">{h.job_category}</Badge>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{h.scheduled_date}</span>
                            </div>
                            <p className="text-sm">{h.description || "Field Job"}</p>
                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1">
                              <span><MapPin className="w-2.5 h-2.5 inline mr-0.5" />{h.service_address}</span>
                              <span>{h.zone}</span>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </TabsContent>

              {/* AUDIT LOG */}
              <TabsContent value="audit" className="space-y-3">
                <ScrollArea className="h-[350px]">
                  {fjAuditLog.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground"><Eye className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No audit entries yet</p></div>
                  ) : (
                    <div className="space-y-1.5">
                      {fjAuditLog.map(entry => (
                        <div key={entry.id} className="flex items-start gap-3 p-2 rounded-lg bg-muted/10 text-sm">
                          <div className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-xs">{entry.user_name}</span>
                              <Badge variant="outline" className="text-[9px]">{entry.action?.replace(/_/g, " ")}</Badge>
                              <span className="text-[10px] text-muted-foreground ml-auto">{entry.created_at?.slice(0, 16).replace("T", " ")}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{entry.details}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Signal & Speed Test */}
            <Card className="overflow-hidden border-cyan-500/20">
              <CardHeader className="pb-3 bg-cyan-500/[0.045] border-b border-cyan-500/15"><CardTitle className="text-sm flex items-center gap-2"><Radio className="w-4 h-4 text-cyan-300" />Site verification</CardTitle></CardHeader>
              <CardContent className="space-y-3 pt-4">
                <p className="text-[11px] text-muted-foreground">Record live readings at site. They save automatically as you enter them.</p>
                <div><Label className="text-xs">Signal <span className="text-muted-foreground">(dBm)</span></Label><Input type="number" value={viewFjJob.signal_strength || ""} onChange={e => { const v = e.target.value; setViewFjJob({ ...viewFjJob, signal_strength: v }); axios.put(`${API}/field-jobs/${viewFjJob.id}`, { signal_strength: v }, { headers }); }} placeholder="-65" className="font-mono" data-testid="fj-signal" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Down (Mbps)</Label><Input type="number" value={viewFjJob.speed_test_down || ""} onChange={e => { const v = e.target.value; setViewFjJob({ ...viewFjJob, speed_test_down: v }); axios.put(`${API}/field-jobs/${viewFjJob.id}`, { speed_test_down: v }, { headers }); }} placeholder="100" className="font-mono" data-testid="fj-speed-down" /></div>
                  <div><Label className="text-xs">Up (Mbps)</Label><Input type="number" value={viewFjJob.speed_test_up || ""} onChange={e => { const v = e.target.value; setViewFjJob({ ...viewFjJob, speed_test_up: v }); axios.put(`${API}/field-jobs/${viewFjJob.id}`, { speed_test_up: v }, { headers }); }} placeholder="50" className="font-mono" data-testid="fj-speed-up" /></div>
                </div>
              </CardContent>
            </Card>

            {/* Cost Summary */}
            <Card className="overflow-hidden border-emerald-500/20">
              <CardHeader className="pb-3 bg-emerald-500/[0.045] border-b border-emerald-500/15"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-emerald-400" />Materials & equipment</CardTitle></CardHeader>
              <CardContent className="pt-4 space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Materials</span><span className="font-mono font-medium">${fjMatTotal.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Equipment</span><span className="font-mono">{fjEquipment.length} items</span></div>
                <Separator />
                <div className="flex justify-between items-end font-bold"><span>Materials total</span><span className="text-emerald-400 font-mono text-lg">${fjMatTotal.toFixed(2)}</span></div>
              </CardContent>
            </Card>

            {/* Update Status */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Update Status</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {Object.entries(FJ_STATUSES).filter(([k]) => k !== viewFjJob.field_status).map(([k, v]) => (
                  <Button key={k} variant="outline" className={`w-full text-xs justify-start ${v.class}`} size="sm" onClick={() => handleFjStatus(viewFjJob.id, k)} data-testid={`fj-status-${k}`}>{v.label}</Button>
                ))}
              </CardContent>
            </Card>

            {/* Assignment */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-cyan-300" />Dispatch ownership</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2.5 rounded-lg bg-muted/[0.35] p-2.5"><span className="w-7 h-7 rounded-full bg-cyan-500/15 text-cyan-300 flex items-center justify-center text-xs font-semibold">{(viewFjJob.assigned_to_name || "?").slice(0, 1)}</span><div className="min-w-0"><span className="text-muted-foreground block text-[10px] uppercase tracking-wide">Field technician</span><span className="font-medium text-xs">{viewFjJob.assigned_to_name || "Unassigned — dispatch queue"}</span></div></div>
                <div className="grid grid-cols-2 gap-3 text-xs"><div><span className="text-muted-foreground block text-[10px] uppercase tracking-wide">Created by</span><span className="font-medium">{viewFjJob.created_by_name || "System"}</span></div><div><span className="text-muted-foreground block text-[10px] uppercase tracking-wide">Created</span><span>{viewFjJob.created_at?.slice(0, 10) || "—"}</span></div></div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ============ DIALOGS ============ */}

        {/* Quote Builder */}
        <Dialog open={fjQuoteDialog} onOpenChange={setFjQuoteDialog}>
          <NexusWorkflowDialog eyebrow="Field service" title="Service quote builder" description="Create a clear field-service estimate before work is approved." icon={DollarSign} tone="cyan" footer={<><Button variant="outline" onClick={() => setFjQuoteDialog(false)}>Cancel</Button><Button onClick={handleSaveFjQuote} data-testid="fj-save-quote"><DollarSign className="w-4 h-4 mr-1" />Save Quote</Button></>}>
            <div className="space-y-4">
              {fjQuoteItems.map((item, i) => (
                <div key={`k-${i}`} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-6"><Label className="text-xs">Description</Label><Input value={item.description} onChange={e => { const n = [...fjQuoteItems]; n[i].description = e.target.value; setFjQuoteItems(n); }} placeholder="Installation / Cable / Labour" /></div>
                  <div className="col-span-2"><Label className="text-xs">Qty</Label><Input type="number" min="1" value={item.qty} onChange={e => { const n = [...fjQuoteItems]; n[i].qty = parseInt(e.target.value) || 1; setFjQuoteItems(n); }} /></div>
                  <div className="col-span-3"><Label className="text-xs">Price</Label><Input type="number" step="0.01" value={item.price} onChange={e => { const n = [...fjQuoteItems]; n[i].price = parseFloat(e.target.value) || 0; setFjQuoteItems(n); }} /></div>
                  <div className="col-span-1"><Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => setFjQuoteItems(prev => prev.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button></div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setFjQuoteItems(prev => [...prev, { description: "", qty: 1, price: 0 }])}><Plus className="w-3 h-3 mr-1" />Add Line</Button>
              <div className="flex justify-between font-bold text-lg border-t pt-3">
                <span>Total</span>
                <span className="text-green-400">${fjQuoteItems.reduce((s, i) => s + (Number(i.qty) || 1) * (Number(i.price) || 0), 0).toFixed(2)}</span>
              </div>
              <div><Label className="text-xs">Notes</Label><Textarea value={fjQuoteNotes} onChange={e => setFjQuoteNotes(e.target.value)} rows={2} placeholder="Additional notes..." /></div>
            </div>
          </NexusWorkflowDialog>
        </Dialog>

        {/* Add Equipment */}
        <Dialog open={fjEquipDialog} onOpenChange={setFjEquipDialog}>
          <NexusWorkflowDialog eyebrow="Field service" title="Add site equipment" description="Capture installed, replaced or inspected equipment against this field job." icon={Radio} tone="cyan" footer={<><Button variant="outline" onClick={() => setFjEquipDialog(false)}>Cancel</Button><Button onClick={handleAddFjEquipment} disabled={!fjEquipForm.equipment_type} data-testid="fj-save-equip"><Plus className="w-4 h-4 mr-1" />Add Equipment</Button></>}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Type</Label>
                  <Select value={fjEquipForm.equipment_type || "cpe"} onValueChange={v => setFjEquipForm({ ...fjEquipForm, equipment_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cpe">CPE / Radio</SelectItem>
                      <SelectItem value="router">Router</SelectItem>
                      <SelectItem value="switch">Switch</SelectItem>
                      <SelectItem value="antenna">Antenna / Dish</SelectItem>
                      <SelectItem value="ups">UPS / Power</SelectItem>
                      <SelectItem value="cable_box">Cable Box / Enclosure</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Action</Label>
                  <Select value={fjEquipForm.action} onValueChange={v => setFjEquipForm({ ...fjEquipForm, action: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="installed">Installed</SelectItem>
                      <SelectItem value="replaced">Replaced</SelectItem>
                      <SelectItem value="removed">Removed</SelectItem>
                      <SelectItem value="inspected">Inspected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Brand</Label><Input value={fjEquipForm.brand} onChange={e => setFjEquipForm({ ...fjEquipForm, brand: e.target.value })} placeholder="Ubiquiti, Mikrotik..." /></div>
                <div><Label>Model</Label><Input value={fjEquipForm.model} onChange={e => setFjEquipForm({ ...fjEquipForm, model: e.target.value })} placeholder="LiteBeam 5AC..." /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Serial #</Label><Input value={fjEquipForm.serial_number} onChange={e => setFjEquipForm({ ...fjEquipForm, serial_number: e.target.value })} className="font-mono text-xs" /></div>
                <div><Label>MAC Address</Label><Input value={fjEquipForm.mac_address} onChange={e => setFjEquipForm({ ...fjEquipForm, mac_address: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" className="font-mono text-xs" /></div>
                <div><Label>IP Address</Label><Input value={fjEquipForm.ip_address} onChange={e => setFjEquipForm({ ...fjEquipForm, ip_address: e.target.value })} placeholder="192.168.1.1" className="font-mono text-xs" /></div>
              </div>
              <div><Label>Config Notes</Label><Textarea value={fjEquipForm.config_notes} onChange={e => setFjEquipForm({ ...fjEquipForm, config_notes: e.target.value })} rows={2} placeholder="SSID, channel, frequency, etc." /></div>
            </div>
          </NexusWorkflowDialog>
        </Dialog>

        {/* Add Material */}
        <Dialog open={fjMatDialog} onOpenChange={setFjMatDialog}>
          <NexusWorkflowDialog eyebrow="Field service" title="Record material used" description="Keep cabling and consumable costs connected to the completed site work." icon={Package} tone="amber" footer={<><Button variant="outline" onClick={() => setFjMatDialog(false)}>Cancel</Button><Button onClick={handleAddFjMaterial} disabled={!fjMatForm.material} data-testid="fj-save-mat"><Plus className="w-4 h-4 mr-1" />Add Material</Button></>}>
            <div className="space-y-3">
              <div><Label>Material</Label><Input value={fjMatForm.material} onChange={e => setFjMatForm({ ...fjMatForm, material: e.target.value })} placeholder="Cat6 cable, RJ45 connectors, Cable ties..." data-testid="fj-mat-name" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Quantity</Label><Input type="number" min="1" value={fjMatForm.quantity} onChange={e => setFjMatForm({ ...fjMatForm, quantity: parseInt(e.target.value) || 1 })} /></div>
                <div><Label>Unit</Label>
                  <Select value={fjMatForm.unit} onValueChange={v => setFjMatForm({ ...fjMatForm, unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="meters">Meters</SelectItem>
                      <SelectItem value="feet">Feet</SelectItem>
                      <SelectItem value="each">Each</SelectItem>
                      <SelectItem value="box">Box</SelectItem>
                      <SelectItem value="roll">Roll</SelectItem>
                      <SelectItem value="pack">Pack</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Unit Cost ($)</Label><Input type="number" step="0.01" value={fjMatForm.unit_cost} onChange={e => setFjMatForm({ ...fjMatForm, unit_cost: parseFloat(e.target.value) || 0 })} /></div>
              </div>
              <div className="text-right font-bold text-green-400">Total: ${((fjMatForm.quantity || 1) * (fjMatForm.unit_cost || 0)).toFixed(2)}</div>
            </div>
          </NexusWorkflowDialog>
        </Dialog>

        {/* Site Info Dialog */}
        <Dialog open={fjSiteDialog} onOpenChange={setFjSiteDialog}>
          <NexusWorkflowDialog eyebrow="Field service" title="Site survey & access" description="Document access, installation conditions and safety details before site work begins." icon={MapPin} tone="cyan" footer={<><Button variant="outline" onClick={() => setFjSiteDialog(false)}>Cancel</Button><Button onClick={handleSaveFjSiteInfo} data-testid="fj-save-site"><CheckCircle className="w-4 h-4 mr-1" />Save Site Info</Button></>}>
            <div className="space-y-3">
              <div><Label>Customer Email</Label><Input value={fjSiteInfo.customer_email || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, customer_email: e.target.value })} placeholder="customer@example.com" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>GPS Latitude</Label><Input value={fjSiteInfo.gps_lat || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, gps_lat: e.target.value })} placeholder="-36.8485" className="font-mono text-xs" /></div>
                <div><Label>GPS Longitude</Label><Input value={fjSiteInfo.gps_lng || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, gps_lng: e.target.value })} placeholder="174.7633" className="font-mono text-xs" /></div>
                <div><Label>Elevation</Label><Input value={fjSiteInfo.elevation || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, elevation: e.target.value })} placeholder="12m" /></div>
              </div>
              <div><Label>Access Notes</Label><Textarea value={fjSiteInfo.access_notes || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, access_notes: e.target.value })} rows={2} placeholder="Gate code, parking instructions, roof access..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Mounting Type</Label>
                  <Select value={fjSiteInfo.mounting_type || "wall"} onValueChange={v => setFjSiteInfo({ ...fjSiteInfo, mounting_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wall">Wall Mount</SelectItem>
                      <SelectItem value="roof">Roof Mount</SelectItem>
                      <SelectItem value="pole">Pole Mount</SelectItem>
                      <SelectItem value="tower">Tower</SelectItem>
                      <SelectItem value="indoor">Indoor</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Cable Entry Point</Label><Input value={fjSiteInfo.cable_entry_point || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, cable_entry_point: e.target.value })} placeholder="Through wall, conduit, etc." /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Power Source</Label><Input value={fjSiteInfo.power_source || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, power_source: e.target.value })} placeholder="Mains, PoE, Solar..." /></div>
                <div><Label>Weather Conditions</Label>
                  <Select value={fjSiteInfo.weather_conditions || "clear"} onValueChange={v => setFjSiteInfo({ ...fjSiteInfo, weather_conditions: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clear">Clear</SelectItem>
                      <SelectItem value="cloudy">Cloudy</SelectItem>
                      <SelectItem value="rain">Rain</SelectItem>
                      <SelectItem value="wind">Windy</SelectItem>
                      <SelectItem value="storm">Storm</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Safety Hazards</Label><Textarea value={fjSiteInfo.safety_hazards || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, safety_hazards: e.target.value })} rows={2} placeholder="Working at heights, power lines nearby, aggressive dog..." /></div>
              <div><Label>Existing Infrastructure</Label><Textarea value={fjSiteInfo.existing_infrastructure || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, existing_infrastructure: e.target.value })} rows={2} placeholder="Existing cabling, conduits, junction boxes..." /></div>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={fjSiteInfo.ladder_required || false} onCheckedChange={c => setFjSiteInfo({ ...fjSiteInfo, ladder_required: c })} />Ladder Required</label>
                <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={fjSiteInfo.roof_access || false} onCheckedChange={c => setFjSiteInfo({ ...fjSiteInfo, roof_access: c })} />Roof Access</label>
              </div>
            </div>
          </NexusWorkflowDialog>
        </Dialog>

        {/* Customer Notification */}
        <Dialog open={fjNotifyDialog} onOpenChange={setFjNotifyDialog}>
          <NexusWorkflowDialog eyebrow="Field communication" title="Send customer update" description="Keep the customer informed from travel through completion." icon={Send} tone="cyan" footer={<><Button variant="outline" onClick={() => setFjNotifyDialog(false)}>Cancel</Button><Button onClick={handleFjNotifyCustomer} data-testid="fj-send-notify"><Send className="w-4 h-4 mr-1" />Send Notification</Button></>}>
            <div className="space-y-4">
              <div><Label>Email</Label><Input value={fjNotifyForm.email} onChange={e => setFjNotifyForm({ ...fjNotifyForm, email: e.target.value })} placeholder="customer@example.com" data-testid="fj-notify-email" /></div>
              <div><Label>Subject</Label><Input value={fjNotifyForm.subject} onChange={e => setFjNotifyForm({ ...fjNotifyForm, subject: e.target.value })} /></div>
              <div><Label>Message</Label><Textarea value={fjNotifyForm.message} onChange={e => setFjNotifyForm({ ...fjNotifyForm, message: e.target.value })} rows={4} placeholder="Your installation is scheduled..." data-testid="fj-notify-message" /></div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => setFjNotifyForm(prev => ({ ...prev, message: `Hi ${viewFjJob.customer_name},\n\nOur technician is on the way to your location at ${viewFjJob.service_address}.\n\nJob: ${viewFjJob.job_number}\nETA: Approximately 30 minutes\n\nRegards,\nNexusOps Field Services`, subject: `Technician En Route - ${viewFjJob.job_number}` }))}>En Route</Button>
                <Button variant="outline" size="sm" onClick={() => setFjNotifyForm(prev => ({ ...prev, message: `Hi ${viewFjJob.customer_name},\n\nOur technician has arrived at ${viewFjJob.service_address} and is beginning work.\n\nJob: ${viewFjJob.job_number}\n\nRegards,\nNexusOps Field Services`, subject: `Technician On Site - ${viewFjJob.job_number}` }))}>On Site</Button>
                <Button variant="outline" size="sm" onClick={() => setFjNotifyForm(prev => ({ ...prev, message: `Hi ${viewFjJob.customer_name},\n\nGreat news! Your ${viewFjJob.job_category} job has been completed at ${viewFjJob.service_address}.\n\nJob: ${viewFjJob.job_number}\nSignal: ${viewFjJob.signal_strength || "N/A"} dBm\nSpeed: ${viewFjJob.speed_test_down || "N/A"} / ${viewFjJob.speed_test_up || "N/A"} Mbps\n\nPlease don't hesitate to contact us if you have any issues.\n\nRegards,\nNexusOps Field Services`, subject: `Job Completed - ${viewFjJob.job_number}` }))}>Completed</Button>
              </div>
            </div>
          </NexusWorkflowDialog>
        </Dialog>

        {/* Push to Invoice */}
        <Dialog open={fjInvoiceDialog} onOpenChange={setFjInvoiceDialog}>
          <NexusWorkflowDialog eyebrow="Field billing" title="Send field job to billing" description="Create a new invoice or add the site work to an existing customer invoice." icon={Receipt} tone="emerald">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Materials (${fjMatTotal.toFixed(2)}) + Labour will be added to the invoice.</p>
              <Button className="w-full" onClick={() => handleFjPushToInvoice(null)} data-testid="fj-new-invoice"><Plus className="w-4 h-4 mr-1" />Create New Invoice</Button>
              {fjInvoiceList.length > 0 && <>
                <Separator />
                <p className="text-xs text-muted-foreground">Or add to existing:</p>
                <ScrollArea className="h-[200px]">
                  {fjInvoiceList.slice(0, 20).map(inv => (
                    <Button key={inv.id} variant="outline" className="w-full justify-start mb-1 text-xs" size="sm" onClick={() => handleFjPushToInvoice(inv.id)}>
                      {inv.invoice_number} - {inv.client_name} (${inv.total?.toFixed(2)})
                    </Button>
                  ))}
                </ScrollArea>
              </>}
            </div>
          </NexusWorkflowDialog>
        </Dialog>

        {/* Checklist Template Picker */}
        <Dialog open={fjTemplateDialog} onOpenChange={setFjTemplateDialog}>
          <NexusWorkflowDialog eyebrow="Field service" title="Load field checklist" description="Apply a proven job checklist for consistent site delivery." icon={ClipboardList} tone="violet">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Select a job category template to load pre-built checklist items.</p>
              {Object.entries(fjTemplates).map(([key, items]) => (
                <Button key={key} variant="outline" className="w-full justify-between" onClick={() => handleLoadFjTemplate(key)} data-testid={`fj-template-${key}`}>
                  <span className="capitalize font-medium">{key.replace("_", " ")}</span>
                  <Badge variant="secondary" className="text-[10px]">{items.length} items</Badge>
                </Button>
              ))}
            </div>
          </NexusWorkflowDialog>
        </Dialog>
      </div>
    );
  }


  // ============ LIST VIEW ============
  const openCount = tickets.filter(t => t.status === "open").length;
  const inProgressCount = tickets.filter(t => t.status === "in_progress").length;
  const completedTickets = tickets.filter(t => ["resolved", "closed"].includes(t.status));
  const completedCount = completedTickets.length;
  const criticalCount = tickets.filter(t => t.priority === "critical" && t.status !== "closed" && t.status !== "resolved").length;
  const unassignedCount = tickets.filter(t => !t.assigned_to && !["closed", "resolved"].includes(t.status)).length;
  const staleCount = tickets.filter(t => !t.last_response_at && Date.now() - new Date(t.created_at).getTime() > 4 * 60 * 60 * 1000 && !["closed", "resolved"].includes(t.status)).length;
  const breachedCount = tickets.filter(t => (t.sla_due || t.sla_due_at) && new Date(t.sla_due || t.sla_due_at) < new Date() && !["closed", "resolved"].includes(t.status)).length;
  const completedDurations = completedTickets.map(resolutionMinutes).filter(value => value != null);
  const avgResTime = completedDurations.length
    ? Math.round(completedDurations.reduce((total, value) => total + value, 0) / completedDurations.length)
    : null;
  const queueCountLabel = typeFilter === "workshop"
    ? `${filteredWorkshopJobs.length} of ${workshopJobs.length} workshop jobs`
    : typeFilter === "cabling_wisp"
      ? `${filteredFieldJobs.length} of ${fieldJobs.length} field jobs`
      : typeFilter === "all" && supportFiltersClear
        ? `${filteredTickets.length} support · ${filteredWorkshopJobs.length} workshop · ${filteredFieldJobs.length} field`
        : `${filteredTickets.length} of ${tickets.length} support tickets`;

  return (
    <PageShell className="min-w-0 max-w-full overflow-x-hidden" data-testid="tickets-page">
      <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-5">

      <TicketModuleHeader
        title="Ticket queue"
        subtitle={`${tickets.length} support · ${workshopJobs.length} workshop · ${fieldJobs.length} field jobs · saved views and live service signals`}
        actions={<>
          <Button size="sm" className="h-8 text-xs" onClick={() => setIsCreateOpen(true)} data-testid="create-ticket-btn">
            <Plus className="w-3 h-3 mr-1" />New ticket
          </Button>
          <Button variant="info" size="sm" className="h-8 text-xs" onClick={() => setWsDialog(true)} data-testid="create-ws-btn">
            <Wrench className="w-3 h-3 mr-1" />Workshop
          </Button>
          <Button variant="info" size="sm" className="h-8 text-xs" onClick={() => setFjDialog(true)} data-testid="create-fj-btn">
            <Radio className="w-3 h-3 mr-1" />Cabling
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={fetchTickets} data-testid="refresh-tickets-btn">
            <RefreshCw className="w-3 h-3 mr-1" />Refresh
          </Button>
        </>}
      />

      <div className="space-y-3" data-testid="ticket-queue-controls">

      {/* HeroTile metric strip */}
      <div key="hero-tiles" className="min-w-0">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 h-full">
          <HeroTile label="Open" value={openCount} icon={Circle} glow="cyan" onClick={() => applyQueueFilter({ status: "open" })} active={statusFilter === "open" && attentionFilter === "all"} testId="stat-open" />
          <HeroTile label="In Progress" value={inProgressCount} icon={Clock} glow="amber" onClick={() => applyQueueFilter({ status: "in_progress" })} active={statusFilter === "in_progress" && attentionFilter === "all"} testId="stat-progress" />
          <HeroTile label="Completed" value={completedCount} icon={CheckCircle} glow="emerald" onClick={() => applyQueueFilter({ status: "completed" })} active={statusFilter === "completed" && attentionFilter === "all"} testId="stat-resolved" />
          <HeroTile label="Critical" value={criticalCount} icon={AlertCircle} glow={criticalCount > 0 ? "rose" : "emerald"} onClick={() => applyQueueFilter({ priority: "critical" })} active={priorityFilter === "critical" && attentionFilter === "all"} testId="stat-critical" />
          <HeroTile label="Awaiting Reply" value={staleCount} icon={MessageSquare} glow={staleCount > 0 ? "amber" : "emerald"} onClick={() => applyQueueFilter({ attention: "no_response" })} active={attentionFilter === "no_response"} testId="stat-no-notes" />
          <HeroTile label="Avg Resolve" value={formatDuration(avgResTime)} icon={Timer} glow="violet" animated={false} onClick={() => applyQueueFilter({ status: "completed" })} active={statusFilter === "completed" && priorityFilter === "all" && attentionFilter === "all"} testId="stat-avg-time" />
        </div>
      </div>

      {/* Live ticket attention ticker */}
      <div key="smart-inbox" className="w-full max-w-full min-w-0 overflow-hidden">
        {(() => {
          const breached = tickets.filter(t => t.sla_due_at && new Date(t.sla_due_at) < new Date() && !["closed", "resolved"].includes(t.status));
          const critical = tickets.filter(t => (t.priority === "critical" || t.priority === "urgent" || t.priority === "p1") && !["closed", "resolved"].includes(t.status));
          const stale = tickets.filter(t => !t.last_response_at && (Date.now() - new Date(t.created_at).getTime() > 4 * 60 * 60 * 1000) && !["closed", "resolved"].includes(t.status));
          const items = [
            ...breached.map(t => ({ ...t, _kind: "breached", _label: "SLA breached", _tone: "critical" })),
            ...critical.map(t => ({ ...t, _kind: "critical", _label: t.priority?.toUpperCase() || "CRITICAL", _tone: "critical" })),
            ...stale.map(t => ({ ...t, _kind: "stale", _label: "No response 4h+", _tone: "warning" })),
          ].reduce((unique, item) => {
            if (!unique.some(existing => existing.id === item.id)) unique.push(item);
            return unique;
          }, []).slice(0, 12);
          if (items.length === 0) return (
            <div className="nx-live-ticker" data-testid="tickets-smart-inbox-empty">
              <div className="nx-live-ticker__label"><CheckCircle className="w-3.5 h-3.5" /><span>Attention feed</span><span className="nx-live-ticker__pulse" /></div>
              <div className="min-w-0 flex-1 text-sm text-emerald-300">All clear - no tickets need attention right now.</div>
              <span className="nx-live-ticker__refresh">Refreshes every minute</span>
            </div>
          );
          const repeatedItems = [...items, ...items];
          return (
            <div className="nx-live-ticker" data-testid="tickets-smart-inbox">
              <div className="nx-live-ticker__label">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-300" />
                <span>Needs attention</span>
                <span className="nx-live-ticker__pulse" />
                <Badge variant="outline" className="border-rose-500/25 bg-rose-500/[0.08] text-[9px] text-rose-200">{items.length}</Badge>
              </div>
              <div className="nx-live-ticker__viewport">
                <div className="nx-live-ticker__track">
                  {repeatedItems.map((t, index) => (
                    <button
                      key={`${t.id}-${t._kind}-${index}`}
                      onClick={() => { setViewingTicket(t); fetchTicketDetail(t); }}
                      className={`nx-live-ticker__item nx-live-ticker__item--${t._tone}`}
                      data-testid={index < items.length ? `tickets-inbox-${t.id}-${t._kind}` : undefined}
                      title={`Open ${t.ticket_number || "ticket"}`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span className="font-medium">{t._label}</span>
                      <span className="nx-live-ticker__detail">{t.ticket_number ? `#${t.ticket_number}` : "Ticket"} | {t.title}{t.client_name ? ` | ${t.client_name}` : ""}</span>
                    </button>
                  ))}
                </div>
              </div>
              <span className="nx-live-ticker__refresh">{breached.length} breached | {critical.length} critical | {stale.length} stale</span>
            </div>
          );
        })()}
       </div>

       <Card className="overflow-hidden border-cyan-500/15 bg-gradient-to-r from-cyan-500/[0.055] via-card to-violet-500/[0.035]" data-testid="ticket-queue-cockpit">
         <CardContent className="flex flex-col gap-3 p-3.5 lg:flex-row lg:items-center lg:justify-between">
           <div className="min-w-0">
             <div className="flex flex-wrap items-center gap-2">
               <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">Queue cockpit</span>
               <Badge variant="outline" className="border-white/10 bg-background/40 text-[9px] text-muted-foreground">Live triage</Badge>
             </div>
             <p className="mt-1 text-sm font-medium text-foreground">Focus the queue, then act without leaving it.</p>
             <p className="mt-0.5 text-xs text-muted-foreground">Hover a ticket to claim it, start work, resolve it, or open a linked device in Nexus Remote.</p>
           </div>
           <div className="flex flex-wrap gap-2">
             <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={() => applyQueueFilter({ attention: "sla_breach" })}>
               <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />{breachedCount} breached
             </Button>
             <Button size="sm" variant="warning" className="h-8 text-xs" onClick={() => applyQueueFilter({ attention: "unassigned" })}>
               <User className="mr-1.5 h-3.5 w-3.5" />{unassignedCount} unassigned
             </Button>
             <Button size="sm" variant="info" className="h-8 text-xs" onClick={() => applyQueueFilter({ priority: "critical" })}>
               <Shield className="mr-1.5 h-3.5 w-3.5" />{criticalCount} critical
             </Button>
           </div>
         </CardContent>
       </Card>

       {/* Type Filter Tabs */}
      <div key="type-tabs" className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap rounded-xl border border-white/[0.08] bg-black/[0.14] p-1.5 h-full">
          {[
            { val: "all", label: "All", icon: Ticket, count: tickets.length + workshopJobs.length + fieldJobs.length },
            { val: "sla", label: "SLA", icon: Shield, count: tickets.length, color: "text-blue-400" },
            { val: "workshop", label: "Workshop", icon: Wrench, count: workshopJobs.length, color: "text-purple-400" },
            { val: "cabling_wisp", label: "Cabling / WISP", icon: Wifi, count: fieldJobs.length, color: "text-cyan-400" },
          ].map(t => (
            <Button key={t.val} variant="outline" size="sm"
              onClick={() => setTypeFilter(t.val)}
              className={`gap-1.5 ${typeFilter === t.val
                ? "text-violet-100 border-violet-500/25 bg-violet-500/[0.15]"
                : "text-zinc-500 border-transparent hover:bg-white/[0.05] hover:text-zinc-200"}`}
              data-testid={`type-filter-${t.val}`}>
              <t.icon className={`w-3.5 h-3.5 ${typeFilter === t.val ? t.color || "" : "opacity-60"}`} />
              {t.label} <span className="text-xs opacity-70">({t.count})</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div key="filters" className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap rounded-xl border border-white/[0.08] bg-black/[0.12] px-3 py-2.5 h-full">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="h-9 border-white/[0.08] bg-white/[0.03] pl-9" placeholder="Search tickets, clients, numbers..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} data-testid="search-input" />
          </div>
          {(typeFilter === "all" || typeFilter === "sla") && <Select value={statusFilter} onValueChange={v => applyQueueFilter({ status: v, priority: priorityFilter, attention: "all" })}>
            <SelectTrigger className="h-9 w-[150px] border-white/[0.08] bg-white/[0.03]" data-testid="status-filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="completed">Completed</SelectItem>{Object.entries(statusConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
          </Select>}
          {(typeFilter === "all" || typeFilter === "sla") && <Select value={priorityFilter} onValueChange={v => applyQueueFilter({ status: statusFilter, priority: v, attention: "all" })}>
            <SelectTrigger className="h-9 w-[140px] border-white/[0.08] bg-white/[0.03]" data-testid="priority-filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Priority</SelectItem>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
          </Select>}
          {(typeFilter === "all" || typeFilter === "sla") && (statusFilter !== "all" || priorityFilter !== "all" || attentionFilter !== "all") && (
            <Button variant="ghost" size="sm" onClick={() => applyQueueFilter({})} className="text-xs text-muted-foreground"><X className="w-3 h-3 mr-1" />Clear Filters</Button>
          )}
          <p className="ml-auto rounded-lg bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-500">{attentionLabel && (typeFilter === "all" || typeFilter === "sla") ? `${attentionLabel} queue: ` : ""}{queueCountLabel}</p>
        </div>
      </div>

      {/* Saved Views · Density · Group By toolbar */}
      <div key="toolbar" className="min-w-0">
        {(typeFilter === "all" || typeFilter === "sla") ? (
          <>
            <SavedViewsBar
              scope="tickets" headers={headers}
              currentSnapshot={currentSnapshot}
              activeViewId={activeViewId}
              onApply={applyView}
              onClearActive={() => applyView(null)}
            />
            <div className="flex items-center gap-1 px-1 -mb-1 mt-1">
              <DensityToggle density={density} setDensity={setDensity} />
              <span className="text-zinc-700">·</span>
              <GroupBySelector groupBy={groupBy} setGroupBy={setGroupBy} />
            </div>
          </>
        ) : (
          <div className="text-[11px] text-zinc-500 flex items-center gap-2 h-full">
            <Settings2 className="w-3 h-3" />Saved Views & grouping available on SLA / All tab
          </div>
        )}
      </div>

      </div>

      {/* Bulk Actions Bar */}
      {(typeFilter === "all" || typeFilter === "sla") && (
        <div className="flex items-center gap-2 px-1">
          <Checkbox
            checked={selectedTickets.size > 0 && selectedTickets.size === filteredTickets.length}
            onCheckedChange={toggleSelectAll}
            data-testid="select-all-checkbox"
          />
          <span className="text-xs text-muted-foreground mr-2">
            {selectedTickets.size > 0 ? `${selectedTickets.size} selected` : "Select all"}
          </span>
          {selectedTickets.size > 0 && (
            <>
              <Separator orientation="vertical" className="h-5" />
              <Select value={bulkAction} onValueChange={v => { setBulkAction(v); setBulkValue(""); }}>
                <SelectTrigger className="w-[150px] h-8 text-xs" data-testid="bulk-action-select"><SelectValue placeholder="Bulk action..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="close">Close All</SelectItem>
                  <SelectItem value="assign">Assign To...</SelectItem>
                  <SelectItem value="priority">Change Priority</SelectItem>
                  <SelectItem value="status">Change Status</SelectItem>
                  <SelectItem value="tag">Add Tag</SelectItem>
                </SelectContent>
              </Select>
              {bulkAction === "assign" && (
                <Select value={bulkValue} onValueChange={setBulkValue}>
                  <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Select user..." /></SelectTrigger>
                  <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {bulkAction === "priority" && (
                <Select value={bulkValue} onValueChange={setBulkValue}>
                  <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Priority..." /></SelectTrigger>
                  <SelectContent>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {bulkAction === "status" && (
                <Select value={bulkValue} onValueChange={setBulkValue}>
                  <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Status..." /></SelectTrigger>
                  <SelectContent>{Object.entries(statusConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {bulkAction === "tag" && (
                <Input className="w-[130px] h-8 text-xs" placeholder="Tag name..." value={bulkValue} onChange={e => setBulkValue(e.target.value)} />
              )}
              <Button size="sm" className="h-8 text-xs" onClick={handleBulkAction} disabled={bulkProcessing || !bulkAction || (bulkAction !== "close" && !bulkValue)} data-testid="apply-bulk-btn">
                {bulkProcessing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                Apply ({selectedTickets.size})
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setSelectedTickets(new Set()); setBulkAction(""); setBulkValue(""); }}>
                <X className="w-3 h-3 mr-1" />Clear
              </Button>
            </>
          )}
        </div>
      )}

      {/* Dense ticket list (Linear/Plain.com inspired) */}
      {(typeFilter === "all" || typeFilter === "sla") && <div className="rounded-xl border border-white/[0.04] bg-[#0a0a0a]/40 overflow-hidden" data-testid="ticket-list">
        {/* Column header (visible on >=md screens) */}
        {(typeFilter === "all" || typeFilter === "sla") && filteredTickets.length > 0 && (
          <div className={`hidden md:flex items-center gap-3 px-3.5 py-1.5 border-b border-white/[0.06] bg-white/[0.015] text-[9px] font-mono uppercase tracking-[0.18em] text-zinc-600`}>
            <span className="w-3.5 shrink-0" />
            <span className="w-[78px] shrink-0">ID</span>
            <span className="w-4 shrink-0" />
            <span className="flex-1">Title</span>
            <span className="hidden md:inline-block w-[160px] shrink-0">Client</span>
            <span className="hidden lg:inline-block w-[44px] shrink-0">Activity</span>
            <span className="w-[20px] shrink-0" />
            <span className="w-[68px] shrink-0">Status</span>
            <span className="hidden xl:inline-block w-[104px] shrink-0">Quick actions</span>
            <span className="w-6 shrink-0">Owner</span>
            <span className="hidden sm:inline-block w-[60px] shrink-0 text-right">SLA / Age</span>
            <span className="w-6 shrink-0" />
          </div>
        )}

        {/* Grouped rows */}
        {(typeFilter === "all" || typeFilter === "sla") && groupedTickets.map(group => (
          group.title ? (
            <TicketGroupSection
              key={group.key} title={group.title} count={group.items.length}
              tone={group.tone} defaultOpen={group.defaultOpen !== false}
              testId={`group-${group.key}`}
            >
              {group.items.map(t => (
                <TicketRow
                  key={t.id} ticket={t} density={density}
                  isSelected={selectedTickets.has(t.id)}
                  onToggleSelect={toggleTicketSelect}
                  onOpen={fetchTicketDetail}
                  onQuickAction={handleQueueQuickAction}
                  viewers={ticketViewers[t.id] || []}
                  noteCount={noteCounts[t.id]}
                  attachmentCount={t.attachment_count}
                  statusConfig={statusConfig}
                  priorityConfig={priorityConfig}
                />
              ))}
            </TicketGroupSection>
          ) : (
            group.items.map(t => (
              <TicketRow
                key={t.id} ticket={t} density={density}
                isSelected={selectedTickets.has(t.id)}
                onToggleSelect={toggleTicketSelect}
                onOpen={fetchTicketDetail}
                onQuickAction={handleQueueQuickAction}
                viewers={ticketViewers[t.id] || []}
                noteCount={noteCounts[t.id]}
                attachmentCount={t.attachment_count}
                statusConfig={statusConfig}
                priorityConfig={priorityConfig}
              />
            ))
          )
        ))}

        {(typeFilter === "all" || typeFilter === "sla") && filteredTickets.length === 0 && (
          <div className="py-16 text-center" data-testid="ticket-list-empty">
            <Ticket className="w-10 h-10 mx-auto text-zinc-700 mb-3" />
            <p className="text-sm text-zinc-500 mb-3">No tickets match your filters</p>
            <Button variant="outline" size="sm" onClick={() => { applyQueueFilter({}); setSearchQuery(""); }}>Clear filters</Button>
          </div>
        )}
      </div>}
      <div className="space-y-2">
        {/* Workshop / Field jobs continue rendering below */}

        {/* Workshop Job Cards (inline in unified list) */}
        {((typeFilter === "all" && supportFiltersClear) || typeFilter === "workshop") && filteredWorkshopJobs.map(j => {
          const wsStatus = WS_STATUSES[j.repair_status] || WS_STATUSES.checked_in;
          return (
            <Card key={`ws-${j.id}`} className="group cursor-pointer overflow-hidden border border-cyan-500/15 bg-gradient-to-r from-cyan-500/[0.05] via-background to-background hover:border-cyan-500/35 hover:shadow-md hover:shadow-cyan-950/15 transition-all"
              onClick={() => fetchWsJobDetail(j)} data-testid={`ws-job-${j.id}`}>
              <CardContent className="py-0 px-0">
                <div className="flex items-stretch">
                  <div className="w-1 shrink-0 bg-gradient-to-b from-cyan-300 via-cyan-500 to-emerald-600" />
                  <div className="flex flex-1 items-center gap-4 p-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-cyan-500/10 border border-cyan-500/25 shadow-sm">
                    <Wrench className="w-4 h-4 text-cyan-300" />
                  </div>
                  <div className="relative flex flex-col items-center gap-1 w-24 flex-shrink-0">
                    <span className="text-[9px] uppercase tracking-[0.14em] font-semibold text-cyan-300/70">Workshop</span>
                    <div className="relative w-full rounded-lg py-1.5 px-1 text-center font-mono text-xs font-bold tracking-wider bg-cyan-500/10 border border-cyan-500/25 text-cyan-100">{j.job_number}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-sm truncate group-hover:text-cyan-100 transition-colors">{j.fault_description || "Workshop repair"}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/75">{j.customer_name}</span>
                      <span className="text-muted-foreground/30">•</span>
                      <span>{[j.device_brand, j.device_model].filter(Boolean).join(" ") || j.device_type || "Device details pending"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0 pl-3 border-l border-border/50">
                    <Badge className={wsStatus.class + " text-[10px]"}>{wsStatus.label}</Badge>
                    <div className="text-right w-24">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Bench tech</p>
                      <p className="text-xs font-medium truncate">{j.assigned_to_name || <span className="text-amber-400">Unassigned</span>}</p>
                    </div>
                  </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Cabling/WISP Job Cards (inline in unified list) */}
        {((typeFilter === "all" && supportFiltersClear) || typeFilter === "cabling_wisp") && filteredFieldJobs.map(j => {
          const fjStatus = FJ_STATUSES[j.field_status] || FJ_STATUSES.scheduled;
          return (
            <Card key={`fj-${j.id}`} className="cursor-pointer hover:bg-muted/30 transition-all border-l-4 border-l-cyan-500"
              onClick={() => fetchFjJobDetail(j)} data-testid={`fj-job-${j.id}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-cyan-500/10">
                    <Wifi className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="relative flex flex-col items-center gap-1 w-20 flex-shrink-0">
                    <div className="relative w-full rounded-lg py-1.5 px-1 text-center font-mono text-xs font-bold tracking-wider bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">{j.job_number}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-medium text-sm truncate">{j.description || "Cabling / WISP Job"}</p>
                      <Badge className="bg-cyan-500/10 text-cyan-400 text-[9px] border-cyan-500/30">CABLING / WISP</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{j.customer_name}</span>
                      {j.zone && <><span className="text-muted-foreground/30">|</span><span>{j.zone}</span></>}
                      {j.service_address && <><span className="text-muted-foreground/30">|</span><span className="truncate max-w-[180px]">{j.service_address}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <Badge className={fjStatus.class + " text-[10px]"}>{fjStatus.label}</Badge>
                    <div className="text-right w-20">
                      <p className="text-xs text-muted-foreground">{j.assigned_to_name || <span className="text-red-400">Unassigned</span>}</p>
                      <p className="text-xs text-muted-foreground/60">{j.scheduled_date || ""}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Empty state */}
        {((typeFilter === "workshop" && filteredWorkshopJobs.length === 0) || (typeFilter === "cabling_wisp" && filteredFieldJobs.length === 0)) && (
          <Card className="border-dashed"><CardContent className="py-12 text-center">
            <Ticket className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
            <p className="text-muted-foreground mb-3">No items match your filters</p>
          </CardContent></Card>
        )}
      </div>

      <CreateTicketDialog
        open={isCreateOpen} onOpenChange={setIsCreateOpen}
        formData={formData} setFormData={setFormData}
        clients={clients} clientContacts={createClientContacts} devices={devices} users={users} tickets={tickets}
        services={services}
        handleAiTriage={handleAiTriage} triaging={triaging}
        triageResult={triageResult} applyTriage={applyTriage}
        handleCreateTicket={handleCreateTicket}
      />

      <CreateWorkshopJobDialog
        open={wsDialog} onOpenChange={setWsDialog}
        wsForm={wsForm} setWsForm={setWsForm} users={users} clients={clients}
        handleCreateWsJob={handleCreateWsJob}
      />

      <CreateFieldJobDialog
        open={fjDialog} onOpenChange={setFjDialog}
        fjForm={fjForm} setFjForm={setFjForm} users={users} clients={clients}
        handleCreateFjJob={handleCreateFjJob}
      />

      </div>
    </PageShell>
  );
}
