import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import DOMPurify from "dompurify";
import CoPilotPanel from "@/components/CoPilotPanel";
import TicketBlueprintPanel from "@/components/tickets/TicketBlueprintPanel";
import { WhyOnFireButton } from "@/components/ai/WhyOnFireButton";
import { SentimentBadge } from "@/components/ai/SentimentBadge";
import { TicketAIBundle } from "@/components/ai/TicketAIBundle";
import QuoteNudgeBanner from "@/components/tickets/QuoteNudgeBanner";
import KitPickerDialog from "@/components/tickets/KitPickerDialog";
import TicketProgressTracker from "@/components/tickets/TicketProgressTracker";
import TicketLinkedDevices from "@/components/tickets/TicketLinkedDevices";
import { TicketDetailHeader } from "@/components/tickets/TicketDetailHeader";
import TicketEnrichmentRail from "@/components/tickets/TicketEnrichmentRail";
import TicketConversationTab from "@/components/tickets/TicketConversationTab";
import {
  TicketWorksheetTab, TicketAttachmentsTab, TicketItemsTab,
  TicketChildrenTab, TicketTimeTab, TicketAuditTab,
} from "@/components/tickets/TicketSecondaryTabs";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { RichTextEditor } from "@/components/RichTextEditor";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";
import { TicketCopilotButton, ExplainErrorButton } from "@/components/ai/CopilotWidgets";
import { VoiceJournalButton } from "@/components/ai/VoiceJournalButton";
import { HuduSuggestionsPanel } from "@/components/ai/HuduSuggestionsPanel";
import {
  Plus, Search, Clock, AlertCircle, CheckCircle, Circle, Loader2, RefreshCw,
  Ticket, MessageSquare, Mail, Send, User, ArrowLeft, Tag, Link2,
  Timer, GitBranch, Merge, FileText, Eye, History, X, Play, Square,
  Lightbulb, BookOpen, Sparkles, ThumbsUp, MonitorCheck, Wifi, WifiOff,
  Terminal, Zap, SpellCheck, Brain, ExternalLink, Shield, Cpu, Users,
  Download, BellRing, ChevronDown, Paperclip, Trash2, ShoppingCart, Receipt,
  Wrench, MapPin, Radio, Pause, PhoneCall, DollarSign, Package, Calendar, Mic,
  Camera, QrCode, ClipboardList, Bell, Truck, Image as ImageIcon, ListChecks, Boxes
} from "lucide-react";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";
import { priorityConfig, statusConfig, WS_STATUSES as WS_STATUSES_CONFIG, FIELD_STATUSES as FIELD_STATUSES_CONFIG, wsStages, fieldStages } from "@/config/ticketConfig";


export default function TicketsPage() {
  const { token, user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // Detail view state
  const [viewingTicket, setViewingTicket] = useState(null);
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
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [conversationType, setConversationType] = useState("note"); // "note" or "email"
  const [isEmailOpen, setIsEmailOpen] = useState(false);
  const [emailSignature, setEmailSignature] = useState("");
  const [emailForm, setEmailForm] = useState({ to: "", cc: "", bcc: "", subject: "", body: "" });
  const [isClientNotifyOpen, setIsClientNotifyOpen] = useState(false);
  const [notifyForm, setNotifyForm] = useState({ email: "", subject: "", message: "" });
  const [ticketAttachments, setTicketAttachments] = useState([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [ticketProducts, setTicketProducts] = useState([]);
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
  const [topTab, setTopTab] = useState("tickets");
  const [typeFilter, setTypeFilter] = useState("all");
  // Bulk action state
  const [selectedTickets, setSelectedTickets] = useState(new Set());
  const [bulkAction, setBulkAction] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [workshopJobs, setWorkshopJobs] = useState([]);
  const [workshopStats, setWorkshopStats] = useState({});
  const [fieldJobs, setFieldJobs] = useState([]);
  const [fieldStats, setFieldStats] = useState({});
  const [wsDialog, setWsDialog] = useState(false);
  const [wsForm, setWsForm] = useState({ customer_name: "", customer_phone: "", customer_email: "", device_type: "", device_brand: "", device_model: "", serial_number: "", fault_description: "", priority: "normal", assigned_to: "", assigned_to_name: "" });
  const [fjDialog, setFjDialog] = useState(false);
  const [fjForm, setFjForm] = useState({ customer_name: "", customer_phone: "", service_address: "", zone: "", description: "", job_category: "installation", priority: "normal", assigned_to: "", assigned_to_name: "", scheduled_date: "", scheduled_time: "" });
  const [viewWsJob, setViewWsJob] = useState(null);
  const [viewFjJob, setViewFjJob] = useState(null);
  const [wsPartDialog, setWsPartDialog] = useState(false);
  const [wsPartProduct, setWsPartProduct] = useState("");
  const [wsPartQty, setWsPartQty] = useState(1);
  const [isChildOpen, setIsChildOpen] = useState(false);
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [isTimeOpen, setIsTimeOpen] = useState(false);
  const [isCannedOpen, setIsCannedOpen] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [tagInput, setTagInput] = useState("");
  const [formData, setFormData] = useState({
    title: "", description: "", client_id: "", priority: "medium", category: "support",
    assigned_to: "", parent_id: "", tags: [], ticket_type: "incident", impact: "medium",
    source: "portal", due_date: "", estimated_hours: "", contact_id: "", asset_id: "",
    device_id: "",
    cc: [], watchers: []
  });
  const [childForm, setChildForm] = useState({ title: "", description: "", priority: "medium" });
  const [mergeIds, setMergeIds] = useState([]);
  const [timeForm, setTimeForm] = useState({ minutes: 15, description: "", billable: true });
  const [cannedForm, setCannedForm] = useState({ title: "", content: "", category: "general" });
  const [noteCounts, setNoteCounts] = useState({});
  const [ticketViewers, setTicketViewers] = useState({}); // kept for internal tracking only
  const [worksheetItems, setWorksheetItems] = useState([]);
  const [newWorksheetItem, setNewWorksheetItem] = useState("");
  // Workshop enrichment state
  const [wsNotes, setWsNotes] = useState([]);
  const [wsNewNote, setWsNewNote] = useState("");
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
  const [wsIntakeForm, setWsIntakeForm] = useState({ condition_on_arrival: "", accessories_received: [], customer_password: "", warranty_status: "unknown", warranty_expiry: "", customer_email: "" });
  const [wsTemplateDialog, setWsTemplateDialog] = useState(false);
  const [wsTemplates, setWsTemplates] = useState({});
  // Field job enrichment state
  const [fjNotes, setFjNotes] = useState([]);
  const [fjNewNote, setFjNewNote] = useState("");
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
  const [fjJobHistory, setFjJobHistory] = useState([]);
  const [fjNotifyDialog, setFjNotifyDialog] = useState(false);
  const [fjNotifyForm, setFjNotifyForm] = useState({ email: "", subject: "", message: "" });
  const [fjInvoiceDialog, setFjInvoiceDialog] = useState(false);
  const [fjInvoiceList, setFjInvoiceList] = useState([]);
  const [fjTemplateDialog, setFjTemplateDialog] = useState(false);
  const [fjTemplates, setFjTemplates] = useState({});
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [triageResult, setTriageResult] = useState(null);
  const [triaging, setTriaging] = useState(false);
  const [enrichment, setEnrichment] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [clientContacts, setClientContacts] = useState([]);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, cRes, uRes, crRes, ncRes, dRes, pRes, wsRes, wsSRes, fjRes, fjSRes, svcRes] = await Promise.all([
        axios.get(`${API}/tickets`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/users`, { headers }),
        axios.get(`${API}/canned-responses`, { headers }),
        axios.get(`${API}/tickets/note-counts`, { headers }),
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/products`, { headers }),
        axios.get(`${API}/workshop/jobs`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workshop/stats`, { headers }).catch(() => ({ data: {} })),
        axios.get(`${API}/field-jobs`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/stats/summary`, { headers }).catch(() => ({ data: {} })),
        axios.get(`${API}/pro-pack/service-catalog`, { headers }).catch(() => ({ data: [] })),
      ]);
      setTickets(tRes.data);
      setClients(cRes.data);
      setUsers(uRes.data);
      setCannedResponses(crRes.data);
      setNoteCounts(ncRes.data);
      setDevices(dRes.data);
      setAllProducts(pRes.data);
      setWorkshopJobs(wsRes.data || []);
      setWorkshopStats(wsSRes.data || {});
      setFieldJobs(fjRes.data || []);
      setFieldStats(fjSRes.data || {});
      setServices(svcRes.data || []);
      // Fetch active viewers for tickets
      try {
        const vRes = await axios.get(`${API}/tickets/active-viewers`, { headers });
        setTicketViewers(vRes.data);
      } catch { setTicketViewers({}); }
    } catch { toast.error("Failed to fetch tickets"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // Deep-link: ?ticket=INC-1234 auto-opens that ticket once tickets are loaded
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const ref = searchParams.get("ticket");
    if (!ref || tickets.length === 0 || viewingTicket) return;
    const wanted = decodeURIComponent(ref).replace(/^#/, "").toUpperCase();
    const match = tickets.find(t => (t.ticket_number || "").toUpperCase() === wanted);
    if (match) {
      fetchTicketDetail(match);
      // Clear the param so back-navigation doesn't trap us
      const np = new URLSearchParams(searchParams);
      np.delete("ticket");
      setSearchParams(np, { replace: true });
    } else {
      toast.error(`Ticket #${wanted} not found`);
      const np = new URLSearchParams(searchParams);
      np.delete("ticket");
      setSearchParams(np, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, searchParams]);

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
    setSuggestions(null);
    setAiAnalysis(null);
    setDeviceStatus(null);
    setEnrichment(null);
    setEditingTitle(false);
    setClientContacts([]);
    // Mark viewing
    axios.post(`${API}/tickets/${ticket.id}/viewing`, {}, { headers }).catch(() => {});
    try {
      const [nRes, eRes, cRes, tRes, aRes, sRes, attRes, prodRes, enrichRes, smsRes, smsTmplRes, smsCfgRes] = await Promise.all([
        axios.get(`${API}/tickets/${ticket.id}/comments`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/emails`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/children`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/time-entries`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/audit-log`, { headers }),
        axios.get(`${API}/scripts`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/tickets/${ticket.id}/attachments`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/tickets/${ticket.id}/products`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/ticket-enrichment/${ticket.id}`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/tickets/${ticket.id}/sms`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/sms/templates?category=ticket`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/settings/sms`, { headers }).catch(() => ({ data: null })),
      ]);
      setTicketNotes(nRes.data);
      setTicketEmails(eRes.data);
      setChildTickets(cRes.data);
      setTimeEntries(tRes.data);
      setAuditLog(aRes.data);
      setScripts(sRes.data);
      setTicketAttachments(attRes.data || []);
      setTicketProducts(prodRes.data || []);
      setEnrichment(enrichRes.data);
      setTicketSms(smsRes.data || []);
      setSmsTemplates(smsTmplRes.data || []);
      if (smsCfgRes.data) setSmsConfig({
        signature: smsCfgRes.data.signature || "",
        append_signature: smsCfgRes.data.append_signature !== false,
      });
      // Fetch client contacts for email auto-populate
      if (ticket.client_id) {
        axios.get(`${API}/clients/${ticket.client_id}/contacts`, { headers }).then(r => setClientContacts(r.data || [])).catch(() => {});
      }
      // Fetch worksheets
      try {
        const wsRes2 = await axios.get(`${API}/tickets/${ticket.id}/worksheet`, { headers });
        setWorksheetItems(wsRes2.data || []);
      } catch { setWorksheetItems([]); }
      const sig = user?.email_signature || "";
      setEmailSignature(sig);
      setEmailForm({ to: "", cc: "", bcc: "", subject: `Re: ${ticket.ticket_number} - ${ticket.title}`, body: "" });
      // Auto-populate SMS recipient from the client's mobile/phone
      const clientRec = clients.find(c => c.id === ticket.client_id);
      const clientPhone = clientRec?.mobile || clientRec?.phone || "";
      setSmsForm({ to: clientPhone, message: "", template_key: "" });
      // Fetch device status if device linked
      if (ticket.device_id) {
        try {
          const dRes = await axios.get(`${API}/devices/${ticket.device_id}`, { headers });
          setDeviceStatus(dRes.data);
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
    const selectedContact = selectedClient?.contacts?.find(ct => ct.id === formData.contact_id || ct.name === formData.contact_id);
    const payload = {
      ...formData,
      client_name: selectedClient?.name || "",
      contact_name: selectedContact?.name || "",
      contact_email: selectedContact?.email || "",
      estimated_hours: formData.estimated_hours ? parseFloat(formData.estimated_hours) : null,
      due_date: formData.due_date || null,
    };
    try {
      await axios.post(`${API}/tickets`, payload, { headers });
      toast.success("Ticket created");
      setIsCreateOpen(false);
      setFormData({
        title: "", description: "", client_id: "", priority: "medium", category: "support",
        assigned_to: "", parent_id: "", tags: [], ticket_type: "incident", impact: "medium",
        source: "portal", due_date: "", estimated_hours: "", contact_id: "", asset_id: "",
        device_id: "",
        cc: [], watchers: []
      });
      fetchTickets();
    } catch { toast.error("Failed to create ticket"); }
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "voice_ticket.webm");
        try {
          toast.info("Transcribing audio...");
          const res = await axios.post(`${API}/voice-ticket/transcribe`, fd, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
          const s = res.data.structured || {};
          setFormData(prev => ({ ...prev, title: s.title || prev.title, description: s.description || prev.description, priority: s.priority || prev.priority, category: s.category || prev.category, source: "voice" }));
          toast.success("Voice transcribed! Review and submit.");
          setIsCreateOpen(true);
        } catch { toast.error("Transcription failed"); }
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      toast.info("Recording... Click stop when done.");
    } catch { toast.error("Microphone access denied"); }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorder) { mediaRecorder.stop(); setMediaRecorder(null); }
    setIsRecording(false);
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
      await axios.put(`${API}/tickets/${viewingTicket.id}`, { [field]: value }, { headers });
      setViewingTicket(prev => ({ ...prev, [field]: value }));
      fetchTickets();
    } catch { toast.error("Failed to update ticket"); }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/comments`, { content: newNote, is_internal: conversationType === "note" }, { headers });
      setNewNote("");
      const res = await axios.get(`${API}/tickets/${viewingTicket.id}/comments`, { headers });
      setTicketNotes(res.data);
      toast.success("Note added");
    } catch { toast.error("Failed to add note"); }
  };

  const handleSendEmail = async () => {
    // Auto-fetch and append the user's rich text signature from settings
    let sig = emailSignature || "";
    if (!sig) {
      try {
        const sigRes = await axios.get(`${API}/users/${user.id}`, { headers });
        sig = sigRes.data?.email_signature || "";
      } catch {}
    }
    const bodyWithSig = emailForm.body + (sig ? `\n\n${sig}` : "");
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/emails`, {
        ticket_id: viewingTicket.id,
        to_addresses: emailForm.to.split(",").map(e => e.trim()).filter(Boolean),
        cc: emailForm.cc ? emailForm.cc.split(",").map(e => e.trim()).filter(Boolean) : [],
        bcc: emailForm.bcc ? emailForm.bcc.split(",").map(e => e.trim()).filter(Boolean) : [],
        subject: emailForm.subject,
        body: bodyWithSig
      }, { headers });
      setIsEmailOpen(false);
      setConversationType("note");
      const [nRes, eRes] = await Promise.all([
        axios.get(`${API}/tickets/${viewingTicket.id}/comments`, { headers }),
        axios.get(`${API}/tickets/${viewingTicket.id}/emails`, { headers }),
      ]);
      setTicketNotes(nRes.data);
      setTicketEmails(eRes.data);
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
      setTicketSms(smsRes.data || []);
      setAuditLog(aRes.data);
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
      setTicketAttachments(res.data || []);
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
      setChildTickets(res.data);
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
      setTimeEntries(res.data);
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

  const handleSaveCanned = async () => {
    try {
      await axios.post(`${API}/canned-responses`, cannedForm, { headers });
      setCannedForm({ title: "", content: "", category: "general" });
      const res = await axios.get(`${API}/canned-responses`, { headers });
      setCannedResponses(res.data);
      toast.success("Canned response saved");
    } catch { toast.error("Failed to save"); }
  };

  const handleSaveSignature = async () => {
    try {
      await axios.put(`${API}/users/${user.id}`, { email_signature: emailSignature }, { headers });
      toast.success("Signature saved");
    } catch { toast.error("Failed to save signature"); }
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
      setWsDialog(false); setWsForm({ customer_name: "", customer_phone: "", customer_email: "", device_type: "", device_brand: "", device_model: "", serial_number: "", fault_description: "", priority: "normal", assigned_to: "", assigned_to_name: "" });
      fetchTickets();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleWsStatus = async (jobId, status) => {
    try { await axios.put(`${API}/workshop/jobs/${jobId}/status`, { status }, { headers }); toast.success(`Status: ${status}`); fetchTickets(); if (viewWsJob?.id === jobId) { const r = await axios.get(`${API}/workshop/jobs/${jobId}`, { headers }); setViewWsJob(r.data); } } catch { toast.error("Failed"); }
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
      setFjDialog(false); setFjForm({ customer_name: "", customer_phone: "", service_address: "", zone: "", description: "", job_category: "installation", priority: "normal", assigned_to: "", assigned_to_name: "", scheduled_date: "", scheduled_time: "" });
      fetchTickets();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleFjStatus = async (jobId, status) => {
    try { await axios.put(`${API}/field-jobs/${jobId}/status`, { status }, { headers }); toast.success(`Status: ${status}`); fetchTickets(); if (viewFjJob?.id === jobId) { const r = await axios.get(`${API}/field-jobs/${jobId}`, { headers }); setViewFjJob(r.data); } } catch { toast.error("Failed"); }
  };

  const handleFjChecklist = async (jobId, checklist) => {
    try { await axios.put(`${API}/field-jobs/${jobId}`, { checklist }, { headers }); } catch {}
  };

  // ============ WORKSHOP ENRICHMENT HANDLERS ============

  const fetchWsJobDetail = async (job) => {
    setViewWsJob(job);
    setWsNotes([]); setWsPhotos([]); setWsChecklist([]); setWsAuditLog([]); setWsQuote(null); setWsRepairHistory([]);
    try {
      const [notesRes, photosRes, clRes, auditRes, quoteRes, histRes] = await Promise.all([
        axios.get(`${API}/workshop/jobs/${job.id}/notes`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workshop/jobs/${job.id}/photos`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workshop/jobs/${job.id}/checklist`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workshop/jobs/${job.id}/audit-log`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workshop/jobs/${job.id}/quote`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/workshop/jobs/${job.id}/repair-history`, { headers }).catch(() => ({ data: [] })),
      ]);
      setWsNotes(notesRes.data || []);
      setWsPhotos(photosRes.data || []);
      setWsChecklist(clRes.data || []);
      setWsAuditLog(auditRes.data || []);
      setWsQuote(quoteRes.data);
      setWsRepairHistory(histRes.data || []);
      setWsIntakeForm({
        condition_on_arrival: job.condition_on_arrival || "",
        accessories_received: job.accessories_received || [],
        customer_password: job.customer_password || "",
        warranty_status: job.warranty_status || "unknown",
        warranty_expiry: job.warranty_expiry || "",
        customer_email: job.customer_email || "",
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
      const r = await axios.post(`${API}/workshop/jobs/${viewWsJob.id}/checklist`, { template }, { headers });
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
      await axios.put(`${API}/workshop/jobs/${viewWsJob.id}/intake`, wsIntakeForm, { headers });
      setViewWsJob(prev => ({ ...prev, ...wsIntakeForm }));
      setWsIntakeDialog(false);
      toast.success("Intake info saved");
    } catch { toast.error("Failed to save"); }
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
    setFjNotes([]); setFjPhotos([]); setFjChecklist([]); setFjAuditLog([]); setFjQuote(null); setFjEquipment([]); setFjMaterials([]); setFjSiteInfo({}); setFjJobHistory([]);
    try {
      const [notesRes, photosRes, clRes, auditRes, quoteRes, equipRes, matRes, siteRes, histRes] = await Promise.all([
        axios.get(`${API}/field-jobs/${job.id}/notes`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/photos`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/enhanced-checklist`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/audit-log`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/quote`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/field-jobs/${job.id}/equipment`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/materials`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/field-jobs/${job.id}/site-info`, { headers }).catch(() => ({ data: {} })),
        axios.get(`${API}/field-jobs/${job.id}/job-history`, { headers }).catch(() => ({ data: [] })),
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

  const fmtTime = (s) => { const m = Math.floor(s / 60); const sec = s % 60; return `${m}:${sec.toString().padStart(2, '0')}`; };

  const filteredTickets = tickets.filter(t => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (t.title?.toLowerCase().includes(q) || t.ticket_number?.toLowerCase().includes(q) || t.client_name?.toLowerCase().includes(q));
    }
    return true;
  });

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
    if (!viewingTicket?.device_id) { toast.error("No device linked to this ticket"); return; }
    try {
      await axios.post(`${API}/scripts/${scriptId}/execute`, [viewingTicket.device_id], { headers });
      toast.success("Script queued for execution");
    } catch { toast.error("Failed to run script"); }
  };

  if (loading) return <PageShell><div className="flex items-center justify-center h-64 text-zinc-500"><Loader2 className="w-8 h-8 animate-spin" /></div></PageShell>;

  // ============ DETAIL VIEW ============
  if (viewingTicket) {
    const parent = viewingTicket.parent_id ? tickets.find(t => t.id === viewingTicket.parent_id) : null;
    const slaHours = viewingTicket.sla_due ? differenceInHours(new Date(viewingTicket.sla_due), new Date()) : null;
    return (
      <PageShell>
        <div className="p-6 space-y-4" data-testid="ticket-detail-view">
        {/* Header with grouped menus */}
        <TicketDetailHeader
          viewingTicket={viewingTicket}
          parent={parent}
          deviceStatus={deviceStatus}
          token={token}
          handleAiAnalysis={handleAiAnalysis}
          aiAnalyzing={aiAnalyzing}
          isTimerRunning={isTimerRunning}
          timerElapsed={timerElapsed}
          toggleTimer={toggleTimer}
          fmtTime={fmtTime}
          setIsTimeOpen={setIsTimeOpen}
          setIsEmailOpen={setIsEmailOpen}
          setIsAddItemOpen={setIsAddItemOpen}
          setIsKitPickerOpen={setIsKitPickerOpen}
          setIsPushInvoiceOpen={setIsPushInvoiceOpen}
          setIsChildOpen={setIsChildOpen}
          setIsMergeOpen={setIsMergeOpen}
          setInvoicesList={setInvoicesList}
          ticketProducts={ticketProducts}
          handleDownloadPdf={handleDownloadPdf}
          onBack={() => {
            if (viewingTicket) axios.post(`${API}/tickets/${viewingTicket.id}/stop-viewing`, {}, { headers }).catch(() => {});
            setViewingTicket(null);
          }}
        />

        {/* Finance Intel: Quote Nudge banner */}
        <QuoteNudgeBanner ticketId={viewingTicket.id} token={token} />

        {/* Title + Compact Progress side-by-side (saves vertical space) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT — Title card */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                {editingTitle ? (
                  <Input
                    value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") { handleUpdateTicket("title", titleDraft); setEditingTitle(false); }
                      if (e.key === "Escape") setEditingTitle(false);
                    }}
                    onBlur={() => { if (titleDraft !== viewingTicket.title) handleUpdateTicket("title", titleDraft); setEditingTitle(false); }}
                    className="text-xl font-bold"
                    autoFocus
                    data-testid="edit-title-input"
                  />
                ) : (
                  <CardTitle
                    className="text-xl cursor-pointer hover:text-primary transition-colors"
                    onClick={() => { setTitleDraft(viewingTicket.title); setEditingTitle(true); }}
                    data-testid="ticket-title-editable"
                    title="Click to edit"
                  >
                    {viewingTicket.title}
                  </CardTitle>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                {viewingTicket.client_name && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">{viewingTicket.client_name.charAt(0)}</span>
                    {viewingTicket.client_name}
                  </span>
                )}
                {viewingTicket.contact_name && (
                  <>
                    <span className="text-border">|</span>
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{viewingTicket.contact_name}</span>
                  </>
                )}
                {viewingTicket.contact_email && (
                  <span className="text-xs text-muted-foreground/60">{viewingTicket.contact_email}</span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{viewingTicket.description}</p>
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
              {slaHours !== null && (
                <div className={`mt-3 flex items-center gap-2 text-sm ${slaHours < 2 ? 'text-red-500' : slaHours < 8 ? 'text-yellow-500' : 'text-green-500'}`}>
                  <Clock className="w-4 h-4" />
                  <span>SLA: {slaHours > 0 ? `${slaHours}h remaining` : `Overdue by ${Math.abs(slaHours)}h`}</span>
                  <div className={`h-2 rounded-full flex-1 max-w-[200px] ${slaHours < 2 ? 'bg-red-500/20' : slaHours < 8 ? 'bg-yellow-500/20' : 'bg-green-500/20'}`}>
                    <div className={`h-2 rounded-full transition-all ${slaHours < 2 ? 'bg-red-500' : slaHours < 8 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.max(5, Math.min(100, (1 - slaHours / 24) * 100))}%` }} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* RIGHT — Compact progress + related-tickets quick chips */}
          <div className="flex flex-col gap-3">
            <TicketProgressTracker
              status={viewingTicket.status}
              onChange={(s) => handleUpdateTicket("status", s)}
              compact
            />
            {/* Hudu KB Suggestions — moved here to fill space, collapsible */}
            <details className="group">
              <summary className="cursor-pointer list-none">
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors text-xs">
                  <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-semibold text-emerald-400">Hudu KB Suggestions</span>
                  <ChevronDown className="w-3 h-3 ml-auto text-muted-foreground group-open:rotate-180 transition-transform" />
                </div>
              </summary>
              <div className="mt-2">
                <HuduSuggestionsPanel ticket={viewingTicket} />
              </div>
            </details>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-4">
            {/* AI ANALYSIS PANEL */}
            {aiAnalysis && (
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
            {enrichment?.merge_candidates?.length > 0 && (
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

            {/* Tabs: Conversation first, then Suggestions, etc */}
            <Tabs defaultValue="conversation">
              <TabsList className="w-full grid grid-cols-10">
                <TabsTrigger value="conversation" data-testid="conversation-tab"><MessageSquare className="w-3 h-3 mr-1" />Conversation ({ticketNotes.length + ticketEmails.length + ticketSms.length})</TabsTrigger>
                <TabsTrigger value="blueprint" data-testid="blueprint-tab"><Lightbulb className="w-3 h-3 mr-1" />{viewingTicket.blueprint_id ? "Worksheet" : "Blueprint"}</TabsTrigger>
                <TabsTrigger value="suggestions"><Lightbulb className="w-3 h-3 mr-1" />Suggestions</TabsTrigger>
                <TabsTrigger value="worksheets" data-testid="worksheets-tab"><CheckCircle className="w-3 h-3 mr-1" />Worksheets ({worksheetItems.length})</TabsTrigger>
                <TabsTrigger value="attachments" data-testid="attachments-tab"><Paperclip className="w-3 h-3 mr-1" />Files ({ticketAttachments.length})</TabsTrigger>
                <TabsTrigger value="items" data-testid="items-tab"><ShoppingCart className="w-3 h-3 mr-1" />Items ({ticketProducts.length})</TabsTrigger>
                <TabsTrigger value="children"><GitBranch className="w-3 h-3 mr-1" />Children ({childTickets.length})</TabsTrigger>
                <TabsTrigger value="time"><Timer className="w-3 h-3 mr-1" />Time ({timeEntries.length})</TabsTrigger>
                <TabsTrigger value="audit"><History className="w-3 h-3 mr-1" />Audit</TabsTrigger>
                <TabsTrigger value="timeline" data-testid="timeline-tab"><History className="w-3 h-3 mr-1" />Time Machine</TabsTrigger>
              </TabsList>

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

          {/* Right sidebar */}
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-4 space-y-4">
                <div><Label className="text-xs text-muted-foreground">Status</Label>
                  <Select value={viewingTicket.status} onValueChange={v => handleUpdateTicket("status", v)}>
                    <SelectTrigger data-testid="status-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(statusConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs text-muted-foreground">Priority</Label>
                  <Select value={viewingTicket.priority} onValueChange={v => handleUpdateTicket("priority", v)}>
                    <SelectTrigger data-testid="priority-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs text-muted-foreground">Assigned To</Label>
                  <Select value={viewingTicket.assigned_to || ""} onValueChange={v => handleUpdateTicket("assigned_to", v)}>
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs text-muted-foreground">Category</Label>
                  <Select value={viewingTicket.category || "support"} onValueChange={v => handleUpdateTicket("category", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="support">Support</SelectItem><SelectItem value="incident">Incident</SelectItem>
                      <SelectItem value="request">Request</SelectItem><SelectItem value="problem">Problem</SelectItem>
                      <SelectItem value="change">Change</SelectItem><SelectItem value="project">Project</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="space-y-1">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Client</span><span>{viewingTicket.client_name}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Created</span><span>{viewingTicket.created_at && format(new Date(viewingTicket.created_at), "MMM d, HH:mm")}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Time</span><span className="font-mono">{viewingTicket.total_time_minutes || 0}m</span></div>
                  {viewingTicket.watchers?.length > 0 && (
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Watchers</span><span>{viewingTicket.watchers.length}</span></div>
                  )}
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
                {deviceStatus && (
                  <div className="mt-2 p-2 rounded-lg bg-muted/30 border border-border/50 space-y-1" data-testid="device-info-panel">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <MonitorCheck className="w-3.5 h-3.5 text-muted-foreground" />
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
                {/* Quick Actions */}
                <Separator />
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Quick Actions</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button variant="outline" size="sm" className="h-8 text-[11px] justify-start" onClick={handleAiAnalysis} disabled={aiAnalyzing} data-testid="quick-ai-btn">
                      <Brain className="w-3 h-3 mr-1 text-purple-400" />{aiAnalyzing ? "Analyzing..." : "AI Diagnose"}
                    </Button>
                    {viewingTicket.device_id && (
                      <Button variant="outline" size="sm" className="h-8 text-[11px] justify-start"
                        onClick={() => window.open(`/remote-access?device=${viewingTicket.device_id}`, '_blank')} data-testid="quick-remote-btn">
                        <ExternalLink className="w-3 h-3 mr-1 text-blue-400" />Remote
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Run Scripts */}
            {viewingTicket.device_id && scripts.length > 0 && (
              <Card data-testid="run-scripts-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5"><Terminal className="w-4 h-4 text-green-400" />Run Script on Device</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[120px]">
                    {scripts.slice(0, 10).map(script => (
                      <div key={script.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 transition-colors" data-testid={`script-${script.id}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <Zap className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                          <span className="text-xs truncate">{script.name}</span>
                        </div>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] text-green-400 flex-shrink-0"
                          onClick={() => handleRunScript(script.id)}>Run</Button>
                      </div>
                    ))}
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* ── AI Enrichment: TTR + Blast Radius + Client Health (extracted) ── */}
            <TicketEnrichmentRail enrichment={enrichment} />
          </div>
        </div>

        <EmailDialog
          open={isEmailOpen} onOpenChange={setIsEmailOpen}
          emailForm={emailForm} setEmailForm={setEmailForm}
          emailSignature={emailSignature} handleSendEmail={handleSendEmail}
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
            axios.get(`${API}/tickets/${viewingTicket.id}/products`, { headers }).then(r => setTicketProducts(r.data)).catch(() => {});
          }}
        />

        <PushInvoiceDialog
          open={isPushInvoiceOpen} onOpenChange={setIsPushInvoiceOpen}
          ticketProducts={ticketProducts} invoicesList={invoicesList}
          pushToExisting={pushToExisting} setPushToExisting={setPushToExisting}
          handlePushToInvoice={handlePushToInvoice}
        />

        {/* VIP Whisper Rail — shows rich context on the requester */}
        {(viewingTicket.requester_email || viewingTicket.contact_email) && (
          <WhisperRail email={viewingTicket.requester_email || viewingTicket.contact_email} />
        )}

        {/* Technician Co-Pilot */}
        <CoPilotPanel ticket={viewingTicket} device={deviceStatus} />
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
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setViewWsJob(null)} data-testid="ws-back"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center"><Wrench className="w-4 h-4 text-purple-400" /></div>
          <span className="font-mono font-semibold">{viewWsJob.job_number}</span>
          <Badge className={WS_STATUSES[viewWsJob.repair_status]?.class}>{WS_STATUSES[viewWsJob.repair_status]?.label}</Badge>
          <Badge variant="outline" className="text-xs capitalize">{viewWsJob.priority}</Badge>
          {viewWsJob.warranty_status === "in_warranty" && <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><Shield className="w-3 h-3 mr-1" />Under Warranty</Badge>}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => { setWsNotifyForm({ email: viewWsJob.customer_email || wsIntakeForm.customer_email || "", subject: `Update: ${viewWsJob.job_number}`, message: "" }); setWsNotifyDialog(true); }} data-testid="ws-notify-btn"><Bell className="w-3 h-3 mr-1" />Notify</Button>
            <Button variant="outline" size="sm" onClick={() => setWsIntakeDialog(true)} data-testid="ws-intake-btn"><ClipboardList className="w-3 h-3 mr-1" />Intake</Button>
            <Button variant="outline" size="sm" onClick={() => { setWsQuoteItems(wsQuote?.line_items?.map(li => ({ description: li.description, qty: li.quantity, price: li.unit_price })) || [{ description: "", qty: 1, price: 0 }]); setWsQuoteNotes(wsQuote?.notes || ""); setWsQuoteDialog(true); }} data-testid="ws-quote-btn"><DollarSign className="w-3 h-3 mr-1" />Quote</Button>
            <Button variant="outline" size="sm" className="text-green-400 border-green-500/30 hover:bg-green-500/10" onClick={() => { setWsInvoiceList([]); axios.get(`${API}/invoices`, { headers }).then(r => setWsInvoiceList(r.data)).catch(() => {}); setWsInvoiceDialog(true); }} data-testid="ws-invoice-btn"><Receipt className="w-3 h-3 mr-1" />Invoice</Button>
            <Button variant="outline" size="sm" onClick={handleDownloadWsPdf} data-testid="ws-pdf-btn"><Download className="w-3 h-3 mr-1" />PDF</Button>
            <Button variant="outline" size="sm" onClick={handleDownloadWsQr} data-testid="ws-qr-btn"><QrCode className="w-3 h-3 mr-1" />QR</Button>
          </div>
        </div>

        {/* Progress Tracker */}
        <Card className="overflow-hidden" data-testid="ws-progress-bar">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Repair Progress</span>
              <span className="text-xs font-mono text-muted-foreground">{wsProgress}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted/50 mb-4 overflow-hidden">
              <div className={`h-full rounded-full bg-gradient-to-r ${wsStages[wsActiveIdx].color} transition-all duration-700`} style={{ width: `${Math.max(5, wsProgress)}%` }} />
            </div>
            <div className="grid grid-cols-6 gap-1.5">
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
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wrench className="w-4 h-4 text-purple-400" />Job Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
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
            <Tabs defaultValue="notes">
              <TabsList className="w-full grid grid-cols-7">
                <TabsTrigger value="notes" data-testid="ws-notes-tab"><MessageSquare className="w-3 h-3 mr-1" />Notes ({wsNotes.length})</TabsTrigger>
                <TabsTrigger value="checklist" data-testid="ws-checklist-tab"><ListChecks className="w-3 h-3 mr-1" />Checklist ({wsCheckDone}/{wsChecklist.length})</TabsTrigger>
                <TabsTrigger value="photos" data-testid="ws-photos-tab"><Camera className="w-3 h-3 mr-1" />Photos ({wsPhotos.length})</TabsTrigger>
                <TabsTrigger value="parts" data-testid="ws-parts-tab"><Package className="w-3 h-3 mr-1" />Parts ({viewWsJob.parts_used?.length || 0})</TabsTrigger>
                <TabsTrigger value="quote" data-testid="ws-quote-tab"><DollarSign className="w-3 h-3 mr-1" />Quote</TabsTrigger>
                <TabsTrigger value="history" data-testid="ws-history-tab"><History className="w-3 h-3 mr-1" />History ({wsRepairHistory.length})</TabsTrigger>
                <TabsTrigger value="audit" data-testid="ws-audit-tab"><Eye className="w-3 h-3 mr-1" />Audit</TabsTrigger>
              </TabsList>

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
                            <span className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400">{(n.user_name || "?")[0]}</span>
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
                        {wsQuote.status === "sent" && <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={handleApproveWsQuote} data-testid="ws-approve-quote"><CheckCircle className="w-3 h-3 mr-1" />Mark Approved</Button>}
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
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Billing Summary</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Parts</span><span className="font-mono">${(viewWsJob.total_parts_cost || 0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Labour ({viewWsJob.labour_minutes || 0}m @ ${viewWsJob.labour_rate}/hr)</span><span className="font-mono">${(viewWsJob.total_labour_cost || 0).toFixed(2)}</span></div>
                <Separator />
                <div className="flex justify-between text-base font-bold"><span>Total</span><span className="text-green-400">${(viewWsJob.total_cost || 0).toFixed(2)}</span></div>
                {viewWsJob.estimated_cost > 0 && <div className="flex justify-between text-xs text-muted-foreground"><span>Estimated</span><span className="font-mono">${viewWsJob.estimated_cost.toFixed(2)}</span></div>}
              </CardContent>
            </Card>

            {/* Labour Timer */}
            <Card className="border-amber-500/20">
              <CardContent className="py-3">
                <p className="text-xs font-semibold text-muted-foreground mb-2">Labour Timer</p>
                <div className="flex items-center gap-2">
                  <Button className={viewWsJob.timer_running ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"} onClick={() => handleWsTimer(viewWsJob.id, viewWsJob.timer_running ? "stop" : "start")} data-testid="ws-timer-btn">
                    {viewWsJob.timer_running ? <><Pause className="w-4 h-4 mr-1" />Stop</> : <><Play className="w-4 h-4 mr-1" />Start</>}
                  </Button>
                  <span className="font-mono text-lg">{viewWsJob.labour_minutes || 0} min</span>
                  {viewWsJob.timer_running && <Badge className="bg-green-500/20 text-green-400 animate-pulse">Running</Badge>}
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
              <CardHeader className="pb-2"><CardTitle className="text-sm">Assignment</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground block text-xs">Technician</span><span className="font-medium">{viewWsJob.assigned_to_name || "Unassigned"}</span></div>
                <div><span className="text-muted-foreground block text-xs">Created by</span><span>{viewWsJob.created_by_name}</span></div>
                <div><span className="text-muted-foreground block text-xs">Created</span><span>{viewWsJob.created_at?.slice(0, 10)}</span></div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ============ DIALOGS ============ */}

        {/* Add Part Dialog */}
        <Dialog open={wsPartDialog} onOpenChange={setWsPartDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Part to Workshop Job</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">Stock will be deducted automatically.</p>
              <Select value={wsPartProduct || "__none"} onValueChange={v => setWsPartProduct(v === "__none" ? "" : v)}>
                <SelectTrigger data-testid="ws-part-select"><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent><SelectItem value="__none">Choose...</SelectItem>{allProducts.filter(p => p.is_active !== false).map(p => <SelectItem key={p.id} value={p.id}>{p.name} - ${p.retail_price?.toFixed(2)} ({p.quantity_in_stock} in stock)</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" min="1" value={wsPartQty} onChange={e => setWsPartQty(parseInt(e.target.value) || 1)} className="w-24" placeholder="Qty" />
            </div>
            <DialogFooter><Button onClick={handleAddWsPart} disabled={!wsPartProduct} data-testid="confirm-ws-part"><Plus className="w-4 h-4 mr-1" />Add Part</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Quote Builder Dialog */}
        <Dialog open={wsQuoteDialog} onOpenChange={setWsQuoteDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Repair Quote Builder</DialogTitle></DialogHeader>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
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
            <DialogFooter><Button onClick={handleSaveWsQuote} data-testid="ws-save-quote"><DollarSign className="w-4 h-4 mr-1" />Save Quote</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Customer Notification Dialog */}
        <Dialog open={wsNotifyDialog} onOpenChange={setWsNotifyDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Notify Customer</DialogTitle></DialogHeader>
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
            <DialogFooter><Button onClick={handleWsNotifyCustomer} data-testid="ws-send-notify"><Send className="w-4 h-4 mr-1" />Send Notification</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Push to Invoice Dialog */}
        <Dialog open={wsInvoiceDialog} onOpenChange={setWsInvoiceDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Push Workshop Job to Invoice</DialogTitle></DialogHeader>
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
          </DialogContent>
        </Dialog>

        {/* Device Intake Dialog */}
        <Dialog open={wsIntakeDialog} onOpenChange={setWsIntakeDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Device Intake Details</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Customer Email</Label><Input value={wsIntakeForm.customer_email} onChange={e => setWsIntakeForm({ ...wsIntakeForm, customer_email: e.target.value })} placeholder="customer@example.com" data-testid="ws-intake-email" /></div>
              <div><Label>Condition on Arrival</Label>
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
              <div><Label>Accessories Received</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {["Charger", "Power Cable", "Bag/Case", "Mouse", "Keyboard", "USB Drive", "Manual", "Box"].map(acc => (
                    <label key={acc} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox checked={wsIntakeForm.accessories_received.includes(acc)} onCheckedChange={c => {
                        setWsIntakeForm(prev => ({ ...prev, accessories_received: c ? [...prev.accessories_received, acc] : prev.accessories_received.filter(a => a !== acc) }));
                      }} />{acc}
                    </label>
                  ))}
                </div>
              </div>
              <div><Label>Customer Password/PIN (for login)</Label><Input value={wsIntakeForm.customer_password} onChange={e => setWsIntakeForm({ ...wsIntakeForm, customer_password: e.target.value })} placeholder="Optional - stored securely" type="password" data-testid="ws-intake-password" /></div>
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
            </div>
            <DialogFooter><Button onClick={handleSaveWsIntake} data-testid="ws-save-intake"><CheckCircle className="w-4 h-4 mr-1" />Save Intake</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Diagnostic Template Picker Dialog */}
        <Dialog open={wsTemplateDialog} onOpenChange={setWsTemplateDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Load Diagnostic Template</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Select a device-type template to load pre-built diagnostic checklist items.</p>
              {Object.entries(wsTemplates).map(([key, items]) => (
                <Button key={key} variant="outline" className="w-full justify-between" onClick={() => handleLoadWsTemplate(key)} data-testid={`ws-template-${key}`}>
                  <span className="capitalize font-medium">{key}</span>
                  <Badge variant="secondary" className="text-[10px]">{items.length} items</Badge>
                </Button>
              ))}
            </div>
          </DialogContent>
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
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setViewFjJob(null)} data-testid="fj-back"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center"><Wifi className="w-4 h-4 text-cyan-400" /></div>
          <span className="font-mono font-semibold">{viewFjJob.job_number}</span>
          <Badge className={FJ_STATUSES[viewFjJob.field_status]?.class}>{FJ_STATUSES[viewFjJob.field_status]?.label}</Badge>
          <Badge variant="outline" className="text-xs capitalize">{viewFjJob.job_category}</Badge>
          <Badge variant="outline" className="text-xs capitalize">{viewFjJob.priority}</Badge>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => { setFjNotifyForm({ email: viewFjJob.customer_email || "", subject: `Update: ${viewFjJob.job_number}`, message: "" }); setFjNotifyDialog(true); }} data-testid="fj-notify-btn"><Bell className="w-3 h-3 mr-1" />Notify</Button>
            <Button variant="outline" size="sm" onClick={() => setFjSiteDialog(true)} data-testid="fj-site-btn"><MapPin className="w-3 h-3 mr-1" />Site Info</Button>
            <Button variant="outline" size="sm" onClick={() => { setFjQuoteItems(fjQuote?.line_items?.map(li => ({ description: li.description, qty: li.quantity, price: li.unit_price })) || [{ description: "", qty: 1, price: 0 }]); setFjQuoteNotes(fjQuote?.notes || ""); setFjQuoteDialog(true); }} data-testid="fj-quote-btn"><DollarSign className="w-3 h-3 mr-1" />Quote</Button>
            <Button variant="outline" size="sm" className="text-green-400 border-green-500/30 hover:bg-green-500/10" onClick={() => { setFjInvoiceList([]); axios.get(`${API}/invoices`, { headers }).then(r => setFjInvoiceList(r.data)).catch(() => {}); setFjInvoiceDialog(true); }} data-testid="fj-invoice-btn"><Receipt className="w-3 h-3 mr-1" />Invoice</Button>
            <Button variant="outline" size="sm" onClick={handleDownloadFjPdf} data-testid="fj-pdf-btn"><Download className="w-3 h-3 mr-1" />PDF</Button>
            <Button variant="outline" size="sm" onClick={handleDownloadFjQr} data-testid="fj-qr-btn"><QrCode className="w-3 h-3 mr-1" />QR</Button>
          </div>
        </div>

        {/* Progress Tracker */}
        <Card className="overflow-hidden" data-testid="fj-progress-bar">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Progress</span>
              <span className="text-xs font-mono text-muted-foreground">{fjProgress}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted/50 mb-4 overflow-hidden">
              <div className={`h-full rounded-full bg-gradient-to-r ${fjStages[fjActiveIdx].color} transition-all duration-700`} style={{ width: `${Math.max(5, fjProgress)}%` }} />
            </div>
            <div className="grid grid-cols-5 gap-1.5">
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
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wifi className="w-4 h-4 text-cyan-400" />Job Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
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
            <Tabs defaultValue="notes">
              <TabsList className="w-full grid grid-cols-8">
                <TabsTrigger value="notes" data-testid="fj-notes-tab"><MessageSquare className="w-3 h-3 mr-1" />Notes ({fjNotes.length})</TabsTrigger>
                <TabsTrigger value="checklist" data-testid="fj-checklist-tab"><ListChecks className="w-3 h-3 mr-1" />Checklist ({fjCheckDone}/{fjChecklist.length})</TabsTrigger>
                <TabsTrigger value="photos" data-testid="fj-photos-tab"><Camera className="w-3 h-3 mr-1" />Photos ({fjPhotos.length})</TabsTrigger>
                <TabsTrigger value="equipment" data-testid="fj-equip-tab"><Cpu className="w-3 h-3 mr-1" />Equipment ({fjEquipment.length})</TabsTrigger>
                <TabsTrigger value="materials" data-testid="fj-mat-tab"><Package className="w-3 h-3 mr-1" />Materials ({fjMaterials.length})</TabsTrigger>
                <TabsTrigger value="quote" data-testid="fj-quote-tab"><DollarSign className="w-3 h-3 mr-1" />Quote</TabsTrigger>
                <TabsTrigger value="history" data-testid="fj-history-tab"><History className="w-3 h-3 mr-1" />History ({fjJobHistory.length})</TabsTrigger>
                <TabsTrigger value="audit" data-testid="fj-audit-tab"><Eye className="w-3 h-3 mr-1" />Audit</TabsTrigger>
              </TabsList>

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
                            <span className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-[10px] font-bold text-cyan-400">{(n.user_name || "?")[0]}</span>
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
                        {fjQuote.status === "sent" && <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={handleApproveFjQuote}><CheckCircle className="w-3 h-3 mr-1" />Mark Approved</Button>}
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
            <Card className="border-cyan-500/20">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Radio className="w-4 h-4 text-cyan-400" />Signal & Speed</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div><Label className="text-xs">Signal (dBm)</Label><Input type="number" value={viewFjJob.signal_strength || ""} onChange={e => { const v = e.target.value; setViewFjJob({ ...viewFjJob, signal_strength: v }); axios.put(`${API}/field-jobs/${viewFjJob.id}`, { signal_strength: v }, { headers }); }} placeholder="-65" className="font-mono" data-testid="fj-signal" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Down (Mbps)</Label><Input type="number" value={viewFjJob.speed_test_down || ""} onChange={e => { const v = e.target.value; setViewFjJob({ ...viewFjJob, speed_test_down: v }); axios.put(`${API}/field-jobs/${viewFjJob.id}`, { speed_test_down: v }, { headers }); }} placeholder="100" className="font-mono" data-testid="fj-speed-down" /></div>
                  <div><Label className="text-xs">Up (Mbps)</Label><Input type="number" value={viewFjJob.speed_test_up || ""} onChange={e => { const v = e.target.value; setViewFjJob({ ...viewFjJob, speed_test_up: v }); axios.put(`${API}/field-jobs/${viewFjJob.id}`, { speed_test_up: v }, { headers }); }} placeholder="50" className="font-mono" data-testid="fj-speed-up" /></div>
                </div>
              </CardContent>
            </Card>

            {/* Cost Summary */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Cost Summary</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Materials</span><span className="font-mono">${fjMatTotal.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Equipment</span><span className="font-mono">{fjEquipment.length} items</span></div>
                <Separator />
                <div className="flex justify-between font-bold"><span>Materials Total</span><span className="text-green-400">${fjMatTotal.toFixed(2)}</span></div>
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
              <CardHeader className="pb-2"><CardTitle className="text-sm">Assignment</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground block text-xs">Technician</span><span className="font-medium">{viewFjJob.assigned_to_name || "Unassigned"}</span></div>
                <div><span className="text-muted-foreground block text-xs">Created by</span><span>{viewFjJob.created_by_name}</span></div>
                <div><span className="text-muted-foreground block text-xs">Created</span><span>{viewFjJob.created_at?.slice(0, 10)}</span></div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ============ DIALOGS ============ */}

        {/* Quote Builder */}
        <Dialog open={fjQuoteDialog} onOpenChange={setFjQuoteDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Service Quote Builder</DialogTitle></DialogHeader>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
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
            <DialogFooter><Button onClick={handleSaveFjQuote} data-testid="fj-save-quote"><DollarSign className="w-4 h-4 mr-1" />Save Quote</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Equipment */}
        <Dialog open={fjEquipDialog} onOpenChange={setFjEquipDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Equipment</DialogTitle></DialogHeader>
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
            <DialogFooter><Button onClick={handleAddFjEquipment} disabled={!fjEquipForm.equipment_type} data-testid="fj-save-equip"><Plus className="w-4 h-4 mr-1" />Add Equipment</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Material */}
        <Dialog open={fjMatDialog} onOpenChange={setFjMatDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Material Used</DialogTitle></DialogHeader>
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
            <DialogFooter><Button onClick={handleAddFjMaterial} disabled={!fjMatForm.material} data-testid="fj-save-mat"><Plus className="w-4 h-4 mr-1" />Add Material</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Site Info Dialog */}
        <Dialog open={fjSiteDialog} onOpenChange={setFjSiteDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Site Survey & Access Info</DialogTitle></DialogHeader>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
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
            <DialogFooter><Button onClick={handleSaveFjSiteInfo} data-testid="fj-save-site"><CheckCircle className="w-4 h-4 mr-1" />Save Site Info</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Customer Notification */}
        <Dialog open={fjNotifyDialog} onOpenChange={setFjNotifyDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Notify Customer</DialogTitle></DialogHeader>
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
            <DialogFooter><Button onClick={handleFjNotifyCustomer} data-testid="fj-send-notify"><Send className="w-4 h-4 mr-1" />Send Notification</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Push to Invoice */}
        <Dialog open={fjInvoiceDialog} onOpenChange={setFjInvoiceDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Push Field Job to Invoice</DialogTitle></DialogHeader>
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
          </DialogContent>
        </Dialog>

        {/* Checklist Template Picker */}
        <Dialog open={fjTemplateDialog} onOpenChange={setFjTemplateDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Load Field Checklist Template</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Select a job category template to load pre-built checklist items.</p>
              {Object.entries(fjTemplates).map(([key, items]) => (
                <Button key={key} variant="outline" className="w-full justify-between" onClick={() => handleLoadFjTemplate(key)} data-testid={`fj-template-${key}`}>
                  <span className="capitalize font-medium">{key.replace("_", " ")}</span>
                  <Badge variant="secondary" className="text-[10px]">{items.length} items</Badge>
                </Button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }


  // ============ LIST VIEW ============
  const openCount = tickets.filter(t => t.status === "open").length;
  const inProgressCount = tickets.filter(t => t.status === "in_progress").length;
  const resolvedCount = tickets.filter(t => t.status === "resolved").length;
  const criticalCount = tickets.filter(t => t.priority === "critical" && t.status !== "closed" && t.status !== "resolved").length;
  const noNotesCount = tickets.filter(t => noteCounts[t.id] === 0 && t.status !== "closed" && t.status !== "resolved").length;
  const avgResTime = tickets.length > 0 ? Math.round(tickets.reduce((a, t) => a + (t.total_time_minutes || 0), 0) / Math.max(1, tickets.filter(t => t.total_time_minutes > 0).length)) : 0;

  return (
    <PageShell data-testid="tickets-page">
      {/* Portfolio metric strip */}
      <MetricStrip columns={6}>
        <MetricTile
          label="Open"
          value={openCount}
          trend={openCount > 0 ? "click to filter" : null}
          trendColor="text-zinc-500"
          accent="sky"
          icon={<Circle className="w-2.5 h-2.5 text-sky-400" />}
          testid="stat-open"
        />
        <MetricTile
          label="In Progress"
          value={inProgressCount}
          accent="amber"
          icon={<Clock className="w-2.5 h-2.5 text-amber-400" />}
          testid="stat-progress"
        />
        <MetricTile
          label="Resolved"
          value={resolvedCount}
          accent="emerald"
          icon={<CheckCircle className="w-2.5 h-2.5 text-emerald-400" />}
          testid="stat-resolved"
        />
        <MetricTile
          label="Critical"
          value={criticalCount}
          trend={criticalCount > 0 ? "needs attention" : "none"}
          accent={criticalCount > 0 ? "rose" : "emerald"}
          icon={<AlertCircle className={`w-2.5 h-2.5 ${criticalCount > 0 ? "text-rose-400" : "text-zinc-600"}`} />}
          testid="stat-critical"
        />
        <MetricTile
          label="No Response"
          value={noNotesCount}
          accent={noNotesCount > 0 ? "amber" : "emerald"}
          icon={<MessageSquare className="w-2.5 h-2.5 text-amber-400" />}
          testid="stat-no-notes"
        />
        <MetricTile
          label="Avg Resolve"
          value={`${avgResTime}m`}
          accent="cyan"
          icon={<Timer className="w-2.5 h-2.5 text-cyan-400" />}
          testid="stat-avg-time"
        />
      </MetricStrip>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tickets & Jobs</h1>
          <p className="text-[11px] text-zinc-500 font-mono uppercase tracking-wider">{tickets.length} SLA · {workshopJobs.length} workshop · {fieldJobs.length} cabling/WISP</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="text-zinc-300 border-zinc-700 hover:bg-zinc-800" onClick={fetchTickets} data-testid="refresh-tickets-btn">
            <RefreshCw className="w-3 h-3 mr-1.5" />Refresh
          </Button>
          <Button variant="outline" size="sm" className="text-blue-300 border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10" onClick={() => setIsCreateOpen(true)} data-testid="create-ticket-btn">
            <Plus className="w-3 h-3 mr-1.5" />New SLA Job
          </Button>
          <Button variant="outline" size="sm"
            className={isRecording
              ? "text-rose-300 border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 animate-pulse"
              : "text-amber-300 border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"}
            onClick={isRecording ? stopVoiceRecording : startVoiceRecording} data-testid="voice-ticket-btn">
            <Mic className="w-3 h-3 mr-1.5" />{isRecording ? "Stop Recording" : "Voice Ticket"}
          </Button>
          <Button variant="outline" size="sm" className="text-purple-300 border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10" onClick={() => setWsDialog(true)} data-testid="create-ws-btn">
            <Wrench className="w-3 h-3 mr-1.5" />Workshop
          </Button>
          <Button variant="outline" size="sm" className="text-cyan-300 border-cyan-500/40 bg-cyan-500/5 hover:bg-cyan-500/10" onClick={() => setFjDialog(true)} data-testid="create-fj-btn">
            <Radio className="w-3 h-3 mr-1.5" />Cabling / WISP
          </Button>
        </div>
      </div>

      {/* Type Filter Tabs */}
      <div className="flex items-center gap-2">
        {[
          { val: "all", label: "All", icon: Ticket, count: tickets.length + workshopJobs.length + fieldJobs.length },
          { val: "sla", label: "SLA", icon: Shield, count: tickets.length, color: "text-blue-400" },
          { val: "workshop", label: "Workshop", icon: Wrench, count: workshopJobs.length, color: "text-purple-400" },
          { val: "cabling_wisp", label: "Cabling / WISP", icon: Wifi, count: fieldJobs.length, color: "text-cyan-400" },
        ].map(t => (
          <Button key={t.val} variant="outline" size="sm"
            onClick={() => setTypeFilter(t.val)}
            className={`gap-1.5 ${typeFilter === t.val
              ? "text-zinc-100 border-zinc-600 bg-zinc-800"
              : "text-zinc-400 border-zinc-800 hover:bg-zinc-900 hover:text-zinc-300"}`}
            data-testid={`type-filter-${t.val}`}>
            <t.icon className={`w-3.5 h-3.5 ${typeFilter === t.val ? t.color || "" : "opacity-60"}`} />
            {t.label} <span className="text-xs opacity-70">({t.count})</span>
          </Button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search tickets, clients, numbers..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} data-testid="search-input" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" data-testid="status-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Status</SelectItem>{Object.entries(statusConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[140px]" data-testid="priority-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Priority</SelectItem>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
        {(statusFilter !== "all" || priorityFilter !== "all") && (
          <Button variant="ghost" size="sm" onClick={() => { setStatusFilter("all"); setPriorityFilter("all"); }} className="text-xs text-muted-foreground"><X className="w-3 h-3 mr-1" />Clear Filters</Button>
        )}
        <p className="text-sm text-muted-foreground ml-auto">{filteredTickets.length} of {tickets.length} tickets</p>
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

      {/* Ticket Cards */}
      <div className="space-y-2">
        {/* SLA Tickets */}
        {(typeFilter === "all" || typeFilter === "sla") && filteredTickets.map(ticket => {
          const pc = priorityConfig[ticket.priority] || priorityConfig.medium;
          const sc = statusConfig[ticket.status] || statusConfig.open;
          const hasNoNotes = noteCounts[ticket.id] === 0 && ticket.status !== "closed" && ticket.status !== "resolved";
          const isOverdue = ticket.sla_due && new Date(ticket.sla_due) < new Date() && ticket.status !== "closed" && ticket.status !== "resolved";
          const priorityBorder = ticket.priority === "critical" ? "border-l-red-500" : ticket.priority === "high" ? "border-l-orange-500" : ticket.priority === "medium" ? "border-l-yellow-500" : "border-l-green-500";
          const isClosed = ticket.status === "closed" || ticket.status === "resolved";
          const viewers = ticketViewers[ticket.id] || [];
          const isBeingViewed = viewers.length > 0;
          const ticketClient = clients.find(c => c.id === ticket.client_id);
          const ticketContact = ticket.contact_id ? ticketClient?.contacts?.find(ct => ct.id === ticket.contact_id || ct.name === ticket.contact_id) : null;
          const contactName = ticket.contact_name || ticketContact?.name || "";
          const clientAddress = ticketClient?.address || "";
          const slaHrs = ticket.sla_due ? differenceInHours(new Date(ticket.sla_due), new Date()) : null;
          const isSelected = selectedTickets.has(ticket.id);

          return (
            <Card
              key={ticket.id}
              className={`cursor-pointer hover:bg-muted/30 transition-all border-l-4 ${priorityBorder} ${hasNoNotes ? "bg-red-500/3" : ""} ${isOverdue ? "ring-1 ring-red-500/30" : ""} ${isClosed ? "opacity-60" : ""} ${isSelected ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}
              data-testid={`ticket-row-${ticket.id}`}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  {/* Checkbox */}
                  <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleTicketSelect(ticket.id)}
                      data-testid={`ticket-checkbox-${ticket.id}`}
                    />
                  </div>
                  {/* Type Icon */}
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-500/10" onClick={() => fetchTicketDetail(ticket)}>
                    <Shield className="w-4 h-4 text-blue-400" />
                  </div>
                  {/* Ticket Number Badge */}
                  <div className="relative flex flex-col items-center gap-1 w-20 flex-shrink-0" data-testid={`ticket-badge-${ticket.id}`}>
                    <div className={`relative w-full rounded-lg py-1.5 px-1 text-center font-mono text-xs font-bold tracking-wider transition-all
                      ${isBeingViewed
                        ? "border border-cyan-400/60 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.35),inset_0_0_15px_rgba(34,211,238,0.08)]"
                        : isClosed
                        ? "bg-muted/20 border border-border/30 text-muted-foreground/50"
                        : ticket.escalated
                        ? "bg-red-500/10 border border-red-500/30 text-red-400 animate-pulse"
                        : "bg-muted/40 border border-border/50 text-muted-foreground"
                      }`}
                      style={isBeingViewed ? {
                        background: "linear-gradient(135deg, rgba(34,211,238,0.12), rgba(139,92,246,0.12), rgba(59,130,246,0.12))",
                        backgroundSize: "200% 200%",
                        animation: "viewerShimmer 2s ease-in-out infinite, pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
                      } : undefined}
                      title={isBeingViewed ? `Viewed by: ${viewers.map(v => v.user_name).join(", ")}` : ""}
                    >
                      {ticket.ticket_number}
                      {isBeingViewed && (
                        <div className="absolute -top-2 -right-2 flex items-center" title={`${viewers.length} tech${viewers.length > 1 ? "s" : ""} viewing: ${viewers.map(v => v.user_name).join(", ")}`}>
                          <div className="relative">
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/50 ring-2 ring-background">
                              {viewers.length > 1 ? (
                                <span className="text-[8px] font-black text-white">{viewers.length}</span>
                              ) : (
                                <Eye className="w-2.5 h-2.5 text-white" />
                              )}
                            </div>
                            <div className="absolute inset-0 rounded-full bg-cyan-400/40 animate-ping" />
                          </div>
                        </div>
                      )}
                      {!isBeingViewed && ticket.escalated && (
                        <div className="absolute -top-1.5 -right-1.5">
                          <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/50">
                            <AlertCircle className="w-2.5 h-2.5 text-white" />
                          </div>
                        </div>
                      )}
                    </div>
                    {ticket.parent_id && <GitBranch className="w-3 h-3 text-indigo-400" />}
                    {ticket.merged_into && <Merge className="w-3 h-3 text-red-400" />}
                  </div>

                  {/* Main Content */}
                  <div className="flex-1 min-w-0" onClick={() => fetchTicketDetail(ticket)}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-medium text-sm truncate">{ticket.title}</p>
                      {isOverdue && <Badge className="bg-red-500/20 text-red-400 text-[9px] border-red-500/30">SLA BREACH</Badge>}
                      {hasNoNotes && <Badge className="bg-amber-500/20 text-amber-400 text-[9px] border-amber-500/30">AWAITING RESPONSE</Badge>}
                      {isBeingViewed && (
                        <Badge className="bg-gradient-to-r from-cyan-500/15 to-blue-500/15 text-cyan-400 text-[9px] border-cyan-500/30 gap-1 shadow-[0_0_8px_rgba(34,211,238,0.2)]">
                          <Eye className="w-2.5 h-2.5" />
                          <Users className="w-2.5 h-2.5" />
                          {viewers.length} {viewers.length === 1 ? "viewer" : "viewers"}: {viewers.map(v => v.user_name).join(", ")}
                        </Badge>
                      )}
                      {ticket.escalated && !isBeingViewed && <Badge className="bg-red-500/10 text-red-400 text-[9px] border-red-500/30">ESCALATED</Badge>}
                      {!ticket.assigned_to && !isClosed && !isBeingViewed && <Badge className="bg-purple-500/10 text-purple-400 text-[9px] border-purple-500/30">UNASSIGNED</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{ticket.client_name}</span>
                      {contactName && <><span className="text-muted-foreground/30">|</span><span>{contactName}</span></>}
                      {clientAddress && <><span className="text-muted-foreground/30">|</span><span className="truncate max-w-[180px]">{clientAddress}</span></>}
                      {ticket.device_name && <><span className="text-muted-foreground/30">|</span><span className="font-mono">{ticket.device_name}</span></>}
                      {ticket.category && <><span className="text-muted-foreground/30">|</span><span className="capitalize">{ticket.category}</span></>}
                      {(ticket.tags || []).length > 0 && <><span className="text-muted-foreground/30">|</span>{ticket.tags.slice(0, 2).map(t => <Badge key={t} variant="outline" className="text-[9px] h-4 px-1">{t}</Badge>)}</>}
                    </div>
                  </div>

                  {/* Right Side Info */}
                  <div className="flex items-center gap-3 flex-shrink-0" onClick={() => fetchTicketDetail(ticket)}>
                    {/* SLA Countdown */}
                    {slaHrs !== null && !isClosed && (
                      <div className={`text-center px-2 py-1 rounded-lg border ${slaHrs < 0 ? "bg-red-500/10 border-red-500/30" : slaHrs < 4 ? "bg-amber-500/10 border-amber-500/30" : "bg-emerald-500/10 border-emerald-500/30"}`} data-testid={`sla-countdown-${ticket.id}`}>
                        <p className={`text-xs font-mono font-bold ${slaHrs < 0 ? "text-red-400" : slaHrs < 4 ? "text-amber-400" : "text-emerald-400"}`}>
                          {slaHrs < 0 ? `-${Math.abs(slaHrs)}h` : `${slaHrs}h`}
                        </p>
                        <p className="text-[8px] text-muted-foreground">SLA</p>
                      </div>
                    )}
                    <div className="text-right">
                      <Badge className={pc.class + " text-[10px] mb-0.5"}>{pc.label}</Badge>
                      <div><Badge variant="outline" className={sc.class + " text-[10px]"}>{sc.label}</Badge></div>
                    </div>
                    <div className="text-right w-20">
                      <p className="text-xs text-muted-foreground">{ticket.assigned_name || <span className="text-red-400">Unassigned</span>}</p>
                      <p className="text-[10px] text-muted-foreground/60">{ticket.created_at && formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}</p>
                    </div>
                    {ticket.total_time_minutes > 0 && (
                      <div className="text-right w-12"><p className="font-mono text-xs">{ticket.total_time_minutes}m</p><p className="text-[9px] text-muted-foreground">time</p></div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filteredTickets.length === 0 && (
          <Card className="border-dashed"><CardContent className="py-12 text-center">
            <Ticket className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
            <p className="text-muted-foreground mb-3">No tickets match your filters</p>
            <Button onClick={() => { setStatusFilter("all"); setPriorityFilter("all"); setSearchQuery(""); }}>Clear Filters</Button>
          </CardContent></Card>
        )}

        {/* Workshop Job Cards (inline in unified list) */}
        {(typeFilter === "all" || typeFilter === "workshop") && workshopJobs.map(j => {
          const wsStatus = WS_STATUSES[j.repair_status] || WS_STATUSES.checked_in;
          return (
            <Card key={`ws-${j.id}`} className="cursor-pointer hover:bg-muted/30 transition-all border-l-4 border-l-purple-500"
              onClick={() => fetchWsJobDetail(j)} data-testid={`ws-job-${j.id}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-purple-500/10">
                    <Wrench className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="relative flex flex-col items-center gap-1 w-20 flex-shrink-0">
                    <div className="relative w-full rounded-lg py-1.5 px-1 text-center font-mono text-xs font-bold tracking-wider bg-purple-500/10 border border-purple-500/30 text-purple-300">{j.job_number}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-medium text-sm truncate">{j.fault_description || "Workshop Job"}</p>
                      <Badge className="bg-purple-500/10 text-purple-400 text-[9px] border-purple-500/30">WORKSHOP</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{j.customer_name}</span>
                      {j.device_brand && <><span className="text-muted-foreground/30">|</span><span>{j.device_brand} {j.device_model}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <Badge className={wsStatus.class + " text-[10px]"}>{wsStatus.label}</Badge>
                    <div className="text-right w-20">
                      <p className="text-xs text-muted-foreground">{j.assigned_to_name || <span className="text-red-400">Unassigned</span>}</p>
                      <p className="font-mono text-xs text-green-400">${(j.total_cost || 0).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Cabling/WISP Job Cards (inline in unified list) */}
        {(typeFilter === "all" || typeFilter === "cabling_wisp") && fieldJobs.map(j => {
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
        {typeFilter !== "all" && filteredTickets.length === 0 && workshopJobs.length === 0 && fieldJobs.length === 0 && (
          <Card className="border-dashed"><CardContent className="py-12 text-center">
            <Ticket className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
            <p className="text-muted-foreground mb-3">No items match your filters</p>
          </CardContent></Card>
        )}
      </div>

      <CreateTicketDialog
        open={isCreateOpen} onOpenChange={setIsCreateOpen}
        formData={formData} setFormData={setFormData}
        clients={clients} devices={devices} users={users} tickets={tickets}
        services={services}
        handleAiTriage={handleAiTriage} triaging={triaging}
        triageResult={triageResult} applyTriage={applyTriage}
        handleCreateTicket={handleCreateTicket}
      />

      <CreateWorkshopJobDialog
        open={wsDialog} onOpenChange={setWsDialog}
        wsForm={wsForm} setWsForm={setWsForm} users={users}
        handleCreateWsJob={handleCreateWsJob}
      />

      <CreateFieldJobDialog
        open={fjDialog} onOpenChange={setFjDialog}
        fjForm={fjForm} setFjForm={setFjForm} users={users}
        handleCreateFjJob={handleCreateFjJob}
      />

      </div>
    </PageShell>
  );
}
