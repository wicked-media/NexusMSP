import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import DOMPurify from "dompurify";
import CoPilotPanel from "@/components/CoPilotPanel";
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
import {
  Plus, Search, Clock, AlertCircle, CheckCircle, Circle, Loader2,
  Ticket, MessageSquare, Mail, Send, User, ArrowLeft, Tag, Link2,
  Timer, GitBranch, Merge, FileText, Eye, History, X, Play, Square,
  Lightbulb, BookOpen, Sparkles, ThumbsUp, MonitorCheck, Wifi, WifiOff,
  Terminal, Zap, SpellCheck, Brain, ExternalLink, Shield, Cpu, Users,
  Download, BellRing, ChevronDown, Paperclip, Trash2, ShoppingCart, Receipt,
  Wrench, MapPin, Radio, Pause, PhoneCall, DollarSign, Package, Calendar, Mic,
  Camera, QrCode, ClipboardList, Bell, Truck, Image as ImageIcon, ListChecks
} from "lucide-react";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";
import { priorityConfig, statusConfig, WS_STATUSES as WS_STATUSES_CONFIG, FIELD_STATUSES as FIELD_STATUSES_CONFIG, wsStages, fieldStages } from "@/config/ticketConfig";


export default function TicketsPage() {
  const { token, user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [clients, setClients] = useState([]);
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
      const [tRes, cRes, uRes, crRes, ncRes, dRes, pRes, wsRes, wsSRes, fjRes, fjSRes] = await Promise.all([
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
      // Fetch active viewers for tickets
      try {
        const vRes = await axios.get(`${API}/tickets/active-viewers`, { headers });
        setTicketViewers(vRes.data);
      } catch { setTicketViewers({}); }
    } catch { toast.error("Failed to fetch tickets"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

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

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ============ DETAIL VIEW ============
  if (viewingTicket) {
    const parent = viewingTicket.parent_id ? tickets.find(t => t.id === viewingTicket.parent_id) : null;
    const slaHours = viewingTicket.sla_due ? differenceInHours(new Date(viewingTicket.sla_due), new Date()) : null;
    return (
      <div className="space-y-4" data-testid="ticket-detail-view">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { if (viewingTicket) axios.post(`${API}/tickets/${viewingTicket.id}/stop-viewing`, {}, { headers }).catch(() => {}); setViewingTicket(null); }} data-testid="back-to-list"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <Badge className={priorityConfig[viewingTicket.priority]?.class}>{priorityConfig[viewingTicket.priority]?.label}</Badge>
          <span className="text-sm text-muted-foreground font-mono">{viewingTicket.ticket_number}</span>
          {viewingTicket.merged_into && <Badge variant="outline" className="text-red-400">Merged</Badge>}
          {parent && <Badge variant="outline" className="text-indigo-400"><GitBranch className="w-3 h-3 mr-1" />Child of {parent.ticket_number}</Badge>}
          <div className="ml-auto flex items-center gap-2">
            {/* Device status */}
            {viewingTicket.device_id && deviceStatus && (
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${
                deviceStatus.status === "online" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                "bg-red-500/10 text-red-400 border-red-500/30"
              }`} data-testid="device-status-indicator">
                {deviceStatus.status === "online" ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                {deviceStatus.name} - {deviceStatus.status === "online" ? "Online" : "Offline"}
              </div>
            )}
            {/* Remote Connect */}
            {viewingTicket.device_id && (
              <Button variant="outline" size="sm" className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10" 
                onClick={() => window.open(`/remote-access?device=${viewingTicket.device_id}`, '_blank')} 
                data-testid="remote-connect-btn">
                <ExternalLink className="w-3 h-3 mr-1" />Remote
              </Button>
            )}
            {/* AI Analysis */}
            <Button variant="outline" size="sm" className="text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
              onClick={handleAiAnalysis} disabled={aiAnalyzing} data-testid="ai-analysis-btn">
              {aiAnalyzing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Brain className="w-3 h-3 mr-1" />}
              AI Diagnose
            </Button>
            {/* Timer */}
            <Button variant={isTimerRunning ? "destructive" : "outline"} size="sm" onClick={toggleTimer} data-testid="timer-btn">
              {isTimerRunning ? <><Square className="w-3 h-3 mr-1" />{fmtTime(timerElapsed)}</> : <><Play className="w-3 h-3 mr-1" />Timer</>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsTimeOpen(true)} data-testid="log-time-btn"><Timer className="w-4 h-4 mr-1" />Log Time</Button>
            <Button variant="outline" size="sm" onClick={() => setIsEmailOpen(true)} data-testid="send-email-btn"><Mail className="w-4 h-4 mr-1" />Email</Button>
            <Button variant="outline" size="sm" className="text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10" onClick={() => setIsAddItemOpen(true)} data-testid="add-items-btn"><ShoppingCart className="w-4 h-4 mr-1" />Add Items</Button>
            {ticketProducts.length > 0 && <Button variant="outline" size="sm" className="text-green-400 border-green-500/30 hover:bg-green-500/10" onClick={() => { setInvoicesList([]); axios.get(`${API}/invoices`, { headers }).then(r => setInvoicesList(r.data)).catch(() => {}); setIsPushInvoiceOpen(true); }} data-testid="push-to-invoice-btn"><Receipt className="w-4 h-4 mr-1" />To Invoice ({ticketProducts.length})</Button>}
            <Button variant="outline" size="sm" onClick={handleDownloadPdf} data-testid="download-pdf-btn"><Download className="w-4 h-4 mr-1" />PDF</Button>
            <Button variant="outline" size="sm" onClick={() => setIsChildOpen(true)} data-testid="add-child-btn"><GitBranch className="w-4 h-4 mr-1" />Child</Button>
            <Button variant="outline" size="sm" onClick={() => setIsMergeOpen(true)} data-testid="merge-btn"><Merge className="w-4 h-4 mr-1" />Merge</Button>
          </div>
        </div>

        {/* Progress Tracker - Card Style */}
        {(() => {
          const stages = [
            { key: "open", label: "Open", color: "from-blue-500 to-blue-600", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30", icon: "1" },
            { key: "in_progress", label: "In Progress", color: "from-yellow-500 to-amber-500", bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/30", icon: "2" },
            { key: "on_hold", label: "On Hold", color: "from-orange-500 to-orange-600", bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30", icon: "3" },
            { key: "resolved", label: "Resolved", color: "from-emerald-500 to-green-600", bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30", icon: "4" },
            { key: "closed", label: "Closed", color: "from-slate-500 to-slate-600", bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/30", icon: "5" },
          ];
          const currentStatus = viewingTicket.status;
          const currentIdx = stages.findIndex(s => s.key === currentStatus);
          const activeIdx = currentIdx >= 0 ? currentIdx : 0;
          const progressPercent = Math.round((activeIdx / (stages.length - 1)) * 100);
          return (
            <Card className="overflow-hidden" data-testid="ticket-progress-bar">
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ticket Progress</span>
                  <span className="text-xs font-mono text-muted-foreground">{progressPercent}% complete</span>
                </div>
                {/* Progress bar */}
                <div className="h-2 rounded-full bg-muted/50 mb-4 overflow-hidden">
                  <div className={`h-full rounded-full bg-gradient-to-r ${stages[activeIdx].color} transition-all duration-700 ease-out`} style={{ width: `${Math.max(5, progressPercent)}%` }} />
                </div>
                {/* Stage cards */}
                <div className="grid grid-cols-5 gap-2">
                  {stages.map((stage, i) => {
                    const isActive = i === activeIdx;
                    const isPast = i < activeIdx;
                    return (
                      <button
                        key={stage.key}
                        onClick={() => handleUpdateTicket("status", stage.key)}
                        className={`relative rounded-lg p-2.5 text-center transition-all duration-300 border ${
                          isActive
                            ? `${stage.bg} ${stage.border} ring-1 ring-offset-1 ring-offset-background ${stage.border} shadow-lg`
                            : isPast
                            ? "bg-emerald-500/5 border-emerald-500/20"
                            : "bg-muted/20 border-border/50 hover:bg-muted/40"
                        }`}
                        data-testid={`progress-stage-${stage.key}`}
                      >
                        <div className={`w-6 h-6 rounded-full mx-auto mb-1.5 flex items-center justify-center text-[10px] font-bold ${
                          isActive ? `bg-gradient-to-br ${stage.color} text-white shadow-md` : isPast ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                        }`}>
                          {isPast ? <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg> : stage.icon}
                        </div>
                        <span className={`text-[10px] font-semibold block ${isActive ? stage.text : isPast ? "text-emerald-400" : "text-muted-foreground/60"}`}>{stage.label}</span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-4">
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
                {/* Company + Reporter */}
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

            {/* Tabs: Conversation first, then Suggestions, etc */}
            <Tabs defaultValue="conversation">
              <TabsList className="w-full grid grid-cols-8">
                <TabsTrigger value="conversation" data-testid="conversation-tab"><MessageSquare className="w-3 h-3 mr-1" />Conversation ({ticketNotes.length + ticketEmails.length + ticketSms.length})</TabsTrigger>
                <TabsTrigger value="suggestions"><Lightbulb className="w-3 h-3 mr-1" />Suggestions</TabsTrigger>
                <TabsTrigger value="worksheets" data-testid="worksheets-tab"><CheckCircle className="w-3 h-3 mr-1" />Worksheets ({worksheetItems.length})</TabsTrigger>
                <TabsTrigger value="attachments" data-testid="attachments-tab"><Paperclip className="w-3 h-3 mr-1" />Files ({ticketAttachments.length})</TabsTrigger>
                <TabsTrigger value="items" data-testid="items-tab"><ShoppingCart className="w-3 h-3 mr-1" />Items ({ticketProducts.length})</TabsTrigger>
                <TabsTrigger value="children"><GitBranch className="w-3 h-3 mr-1" />Children ({childTickets.length})</TabsTrigger>
                <TabsTrigger value="time"><Timer className="w-3 h-3 mr-1" />Time ({timeEntries.length})</TabsTrigger>
                <TabsTrigger value="audit"><History className="w-3 h-3 mr-1" />Audit</TabsTrigger>
              </TabsList>

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
                <div className="flex items-center gap-2">
                  <Input placeholder="Add a checklist item..." value={newWorksheetItem} onChange={e => setNewWorksheetItem(e.target.value)}
                    onKeyDown={async e => {
                      if (e.key === "Enter" && newWorksheetItem.trim()) {
                        try {
                          await axios.post(`${API}/tickets/${viewingTicket.id}/worksheet`, { item: newWorksheetItem.trim() }, { headers });
                          setNewWorksheetItem("");
                          const r = await axios.get(`${API}/tickets/${viewingTicket.id}/worksheet`, { headers });
                          setWorksheetItems(r.data || []);
                          toast.success("Worksheet item added");
                        } catch { toast.error("Failed to add item"); }
                      }
                    }} data-testid="worksheet-input" />
                  <Button size="sm" onClick={async () => {
                    if (!newWorksheetItem.trim()) return;
                    try {
                      await axios.post(`${API}/tickets/${viewingTicket.id}/worksheet`, { item: newWorksheetItem.trim() }, { headers });
                      setNewWorksheetItem("");
                      const r = await axios.get(`${API}/tickets/${viewingTicket.id}/worksheet`, { headers });
                      setWorksheetItems(r.data || []);
                      toast.success("Worksheet item added");
                    } catch { toast.error("Failed"); }
                  }} data-testid="add-worksheet-btn"><Plus className="w-3 h-3 mr-1" />Add</Button>
                </div>
                {worksheetItems.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    <p>No worksheet items yet. Add checklist items to track work.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {worksheetItems.map(wi => (
                      <div key={wi.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${wi.checked ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/20 border-border/50 hover:bg-muted/30"}`}
                        onClick={async () => {
                          try {
                            await axios.post(`${API}/tickets/${viewingTicket.id}/worksheet/check`, { item_id: wi.id, checked: !wi.checked }, { headers });
                            const r = await axios.get(`${API}/tickets/${viewingTicket.id}/worksheet`, { headers });
                            setWorksheetItems(r.data || []);
                          } catch { toast.error("Failed"); }
                        }} data-testid={`worksheet-item-${wi.id}`}>
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${wi.checked ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/40"}`}>
                          {wi.checked && <CheckCircle className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex-1">
                          <span className={`text-sm ${wi.checked ? "line-through text-muted-foreground" : ""}`}>{wi.item}</span>
                          {wi.checked_by_name && <span className="text-[10px] text-muted-foreground ml-2">by {wi.checked_by_name} {wi.checked_at?.slice(0, 16)}</span>}
                        </div>
                      </div>
                    ))}
                    <div className="text-xs text-muted-foreground pt-2">{worksheetItems.filter(w => w.checked).length} / {worksheetItems.length} completed</div>
                  </div>
                )}
              </TabsContent>


              {/* UNIFIED CONVERSATION TAB */}
              <TabsContent value="conversation" className="space-y-3">
                {/* Message Type Selector */}
                <div className="flex items-center gap-3 pb-2 border-b border-border/50">
                  <Select value={conversationType} onValueChange={setConversationType}>
                    <SelectTrigger className="w-[200px]" data-testid="conversation-type-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="note"><div className="flex items-center gap-2"><MessageSquare className="w-3 h-3" />Internal Note</div></SelectItem>
                      <SelectItem value="email"><div className="flex items-center gap-2"><Mail className="w-3 h-3" />Public Email</div></SelectItem>
                      <SelectItem value="sms"><div className="flex items-center gap-2"><PhoneCall className="w-3 h-3" />SMS</div></SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    {conversationType === "note" ? "Internal notes are only visible to your team" : conversationType === "email" ? "Emails will be sent to the client" : "SMS will be sent via MobileMessage to the client's mobile"}
                  </span>
                </div>

                {/* Internal Note Form */}
                {conversationType === "note" && (
                  <div className="space-y-2">
                    <RichTextEditor content={newNote} onChange={setNewNote} placeholder="Add an internal note..." minHeight="80px" />
                    <div className="flex items-center gap-3 flex-wrap">
                      <Button size="sm" onClick={handleAddNote} data-testid="add-note-btn"><Send className="w-3 h-3 mr-1" />Add Note</Button>
                      {/* Quick Template Picker */}
                      {cannedResponses.length > 0 && (
                        <Select value="" onValueChange={v => { const tmpl = cannedResponses.find(c => c.id === v); if (tmpl) setNewNote(prev => prev ? `${prev}\n${tmpl.content}` : tmpl.content); }}>
                          <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="quick-template-picker"><SelectValue placeholder="Insert template..." /></SelectTrigger>
                          <SelectContent>
                            {cannedResponses.map(cr => (
                              <SelectItem key={cr.id} value={cr.id}>
                                <div className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-amber-400" /><span>{cr.title}</span></div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                )}

                {/* Inline Email Form */}
                {conversationType === "email" && (
                  <div className="space-y-3 p-3 rounded-lg border bg-blue-500/[0.02] border-blue-500/20">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-xs">To</Label>
                        <div className="relative">
                          <Input value={emailForm.to} onChange={e => setEmailForm({ ...emailForm, to: e.target.value })} placeholder="recipient@email.com" data-testid="inline-email-to" list="contact-emails" />
                          <datalist id="contact-emails">
                            {clientContacts.map(c => c.email && <option key={c.id} value={c.email}>{c.name} ({c.email})</option>)}
                          </datalist>
                        </div>
                      </div>
                      <div><Label className="text-xs">CC</Label><Input value={emailForm.cc} onChange={e => setEmailForm({ ...emailForm, cc: e.target.value })} placeholder="cc@email.com" /></div>
                      <div><Label className="text-xs">BCC</Label><Input value={emailForm.bcc} onChange={e => setEmailForm({ ...emailForm, bcc: e.target.value })} placeholder="bcc@email.com" /></div>
                    </div>
                    <div><Label className="text-xs">Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} data-testid="inline-email-subject" /></div>
                    <div>
                      <Label className="text-xs">Body</Label>
                      <RichTextEditor content={emailForm.body} onChange={body => setEmailForm({ ...emailForm, body })} placeholder="Write your email..." minHeight="320px" />
                    </div>
                    {emailSignature && <div className="border rounded p-2 bg-muted/30"><p className="text-xs text-muted-foreground mb-1">Signature:</p><div className="text-sm" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailSignature) }} /></div>}
                    <div className="flex justify-end">
                      <Button size="sm" onClick={handleSendEmail} data-testid="send-inline-email-btn"><Send className="w-3 h-3 mr-1" />Send Email</Button>
                    </div>
                  </div>
                )}

                {/* Inline SMS Form */}
                {conversationType === "sms" && (
                  <div className="space-y-3 p-3 rounded-lg border bg-emerald-500/[0.03] border-emerald-500/20" data-testid="sms-form">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Mobile Number</Label>
                        <Input
                          value={smsForm.to}
                          onChange={e => setSmsForm({ ...smsForm, to: e.target.value })}
                          placeholder="04xx xxx xxx or +614xx..."
                          data-testid="sms-to-input"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Template (optional)</Label>
                        <Select value={smsForm.template_key || ""} onValueChange={applySmsTemplate}>
                          <SelectTrigger data-testid="sms-template-picker">
                            <SelectValue placeholder="Pick template..." />
                          </SelectTrigger>
                          <SelectContent>
                            {smsTemplates.map(t => (
                              <SelectItem key={t.id || t.key} value={t.key}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs flex items-center justify-between">
                        <span>Message</span>
                        {(() => {
                          const sig = (smsConfig.append_signature && smsConfig.signature) ? smsConfig.signature : "";
                          const effLen = smsForm.message.length + (sig && !smsForm.message.toLowerCase().includes(sig.toLowerCase()) ? sig.length + 2 : 0);
                          return (
                            <span className={`text-[10px] ${effLen > 160 ? "text-amber-400" : "text-muted-foreground"}`}>
                              {effLen} chars · {Math.max(1, Math.ceil(effLen / 160))} segment{effLen > 160 ? "s" : ""}
                            </span>
                          );
                        })()}
                      </Label>
                      <Textarea
                        value={smsForm.message}
                        onChange={e => setSmsForm({ ...smsForm, message: e.target.value })}
                        placeholder="Hi, update on your ticket..."
                        rows={4}
                        maxLength={1600}
                        data-testid="sms-message-input"
                      />
                      {smsConfig.append_signature && smsConfig.signature && !smsForm.message.toLowerCase().includes(smsConfig.signature.toLowerCase()) && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Signature auto-appended: <span className="font-mono text-emerald-400">"{smsConfig.signature}"</span>
                        </p>
                      )}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-muted-foreground">Replies from this number will appear inline in this conversation.</span>
                      <Button size="sm" onClick={handleSendSms} disabled={smsSending} data-testid="send-sms-btn">
                        {smsSending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
                        Send SMS
                      </Button>
                    </div>
                  </div>
                )}

                {/* Unified Conversation Timeline */}
                <div className="border rounded-lg overflow-hidden" style={{ resize: "vertical", overflow: "auto", height: "500px", minHeight: "200px" }}>
                  {(() => {
                    const allItems = [
                      ...ticketNotes.map(n => ({ ...n, _type: "note", _sort: n.created_at })),
                      ...ticketEmails.map(e => ({ ...e, _type: "email", _sort: e.created_at })),
                      ...ticketSms.map(s => ({ ...s, _type: "sms", _sort: s.sent_at || s.received_at })),
                    ].sort((a, b) => (b._sort || "").localeCompare(a._sort || ""));

                    if (allItems.length === 0) return <p className="text-center py-8 text-muted-foreground">No conversation items yet</p>;

                    return allItems.map(item => {
                      if (item._type === "note") {
                        const isInternal = item.is_internal;
                        return (
                          <div key={`note-${item.id}`} className={`p-3 rounded-lg mb-2 ${isInternal ? 'bg-amber-400/10 border-l-4 border-l-amber-400/60 border border-amber-400/20 shadow-sm' : 'bg-muted/30 border border-border rounded-lg'}`} data-testid={`note-${item.id}`}>
                            <div className="flex justify-between items-start mb-1">
                              <div className="flex items-center gap-2">
                                {isInternal ? (
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500/80 bg-amber-400/15 px-1.5 py-0.5 rounded">Internal Note</span>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] h-4">Note</Badge>
                                )}
                                <User className="w-3 h-3" /><span className="text-sm font-medium">{item.user_name}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">{item.created_at && formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
                            </div>
                            {item.content && /<[a-z][\s\S]*>/i.test(item.content) ? (
                              <div className="text-sm prose prose-sm prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.content) }} />
                            ) : (
                              <p className="text-sm whitespace-pre-wrap">{item.content}</p>
                            )}
                          </div>
                        );
                      } else if (item._type === "email") {
                        return (
                          <div key={`email-${item.id}`} className="p-3 rounded-lg mb-2 border bg-blue-500/[0.03] border-blue-500/20" data-testid={`email-${item.id}`}>
                            <div className="flex justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <Mail className="w-3 h-3 text-blue-400" />
                                <span className="text-sm font-medium">{item.subject}</span>
                                <Badge variant="outline" className="text-blue-400 text-[10px] h-4">Email</Badge>
                              </div>
                              <span className="text-xs text-muted-foreground">{item.created_at && formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">To: {item.to_addresses?.join(", ")}</p>
                            {item.body && /<[a-z][\s\S]*>/i.test(item.body) ? (
                              <div className="text-sm prose prose-sm prose-invert max-w-none mt-1" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.body) }} />
                            ) : (
                              <p className="text-sm mt-1 whitespace-pre-wrap">{item.body?.substring(0, 200)}</p>
                            )}
                          </div>
                        );
                      } else {
                        // SMS item — inbound or outbound
                        const inbound = item.direction === "inbound";
                        const ts = item.sent_at || item.received_at;
                        const statusColor = item.status === "delivered" ? "text-emerald-400" : item.status === "failed" ? "text-red-400" : "text-muted-foreground";
                        return (
                          <div key={`sms-${item.id}`} className={`p-3 rounded-lg mb-2 border ${inbound ? "bg-emerald-500/[0.06] border-emerald-500/30 border-l-4 border-l-emerald-500/70" : "bg-emerald-500/[0.02] border-emerald-500/20"}`} data-testid={`sms-${item.id}`}>
                            <div className="flex justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <PhoneCall className={`w-3 h-3 ${inbound ? "text-emerald-400" : "text-emerald-500/80"}`} />
                                <Badge variant="outline" className="text-emerald-400 text-[10px] h-4">
                                  {inbound ? "SMS Reply" : "SMS"}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {inbound ? `from ${item.sender || item.from}` : `to ${item.to}`}
                                </span>
                                {!inbound && item.user_name && <span className="text-[10px] text-muted-foreground">by {item.user_name}</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                {!inbound && <span className={`text-[10px] uppercase ${statusColor}`}>{item.status || "sent"}</span>}
                                <span className="text-xs text-muted-foreground">{ts && formatDistanceToNow(new Date(ts), { addSuffix: true })}</span>
                              </div>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{item.message}</p>
                            {item.failed_reason && (
                              <p className="text-[11px] text-red-400 mt-1">Failed: {item.failed_reason}</p>
                            )}
                          </div>
                        );
                      }
                    });
                  })()}
                </div>
              </TabsContent>

              {/* ATTACHMENTS TAB */}
              <TabsContent value="attachments" className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{ticketAttachments.length} file{ticketAttachments.length !== 1 ? "s" : ""} attached</span>
                  <div className="relative">
                    <input type="file" id="attachment-upload" className="hidden" onChange={handleAttachmentUpload} />
                    <Button size="sm" onClick={() => document.getElementById("attachment-upload").click()} disabled={attachmentUploading} data-testid="upload-attachment-btn">
                      {attachmentUploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Paperclip className="w-3 h-3 mr-1" />}Upload File
                    </Button>
                  </div>
                </div>
                <ScrollArea className="h-[300px]">
                  {ticketAttachments.length > 0 ? ticketAttachments.map(att => (
                    <div key={att.id} className="flex items-center justify-between p-3 rounded-lg border mb-2 hover:bg-muted/50 transition-colors" data-testid={`attachment-${att.id}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center"><FileText className="w-4 h-4 text-blue-500" /></div>
                        <div>
                          <p className="text-sm font-medium">{att.filename}</p>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span>{(att.size / 1024).toFixed(1)} KB</span>
                            <span>by {att.uploaded_by_name}</span>
                            <span>{att.created_at?.substring(0, 16).replace("T", " ")}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => window.open(`${API}${att.url}`, "_blank")}><Download className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteAttachment(att.id)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  )) : (
                    <div className="text-center py-8">
                      <Paperclip className="w-8 h-8 mx-auto text-muted-foreground opacity-30 mb-2" />
                      <p className="text-sm text-muted-foreground">No attachments yet</p>
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>


              {/* ITEMS TAB */}
              <TabsContent value="items" className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Billable products & items used on this ticket</p>
                  <Button size="sm" onClick={() => setIsAddItemOpen(true)} data-testid="tab-add-item-btn"><Plus className="w-3 h-3 mr-1" />Add Item</Button>
                </div>
                {ticketProducts.length > 0 ? (
                  <Card>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit Price</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
                        <TableBody>
                          {ticketProducts.map(p => (
                            <TableRow key={p.id} data-testid={`ticket-item-${p.id}`}>
                              <TableCell className="font-medium">{p.product_name}</TableCell>
                              <TableCell className="text-right font-mono">{p.quantity}</TableCell>
                              <TableCell className="text-right font-mono">${(p.unit_price || 0).toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono font-bold">${(p.total || 0).toFixed(2)}</TableCell>
                              <TableCell><Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => handleRemoveItemFromTicket(p.id)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={3} className="text-right font-semibold">Total</TableCell>
                            <TableCell className="text-right font-mono font-bold text-green-400">${ticketProducts.reduce((s, p) => s + (p.total || 0), 0).toFixed(2)}</TableCell>
                            <TableCell></TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="border-dashed"><CardContent className="py-8 text-center">
                    <ShoppingCart className="w-8 h-8 mx-auto text-muted-foreground mb-2 opacity-30" />
                    <p className="text-muted-foreground text-sm">No items added yet</p>
                  </CardContent></Card>
                )}
                {ticketProducts.length > 0 && (
                  <Button variant="outline" className="text-green-400 border-green-500/30 hover:bg-green-500/10" onClick={() => { axios.get(`${API}/invoices`, { headers }).then(r => setInvoicesList(r.data)).catch(() => {}); setIsPushInvoiceOpen(true); }} data-testid="items-to-invoice-btn">
                    <Receipt className="w-4 h-4 mr-1" />Push All Items to Invoice
                  </Button>
                )}
              </TabsContent>

              {/* CHILDREN TAB */}
              <TabsContent value="children">
                {childTickets.length > 0 ? (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Number</TableHead><TableHead>Title</TableHead><TableHead>Status</TableHead><TableHead>Priority</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {childTickets.map(child => (
                        <TableRow key={child.id} className="cursor-pointer hover:bg-muted/50" onClick={() => fetchTicketDetail(child)}>
                          <TableCell className="font-mono text-sm">{child.ticket_number}</TableCell>
                          <TableCell>{child.title}</TableCell>
                          <TableCell><Badge variant="outline" className={statusConfig[child.status]?.class}>{statusConfig[child.status]?.label}</Badge></TableCell>
                          <TableCell><Badge className={priorityConfig[child.priority]?.class + " text-xs"}>{priorityConfig[child.priority]?.label}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <p className="text-center py-8 text-muted-foreground">No child tickets</p>}
              </TabsContent>

              {/* TIME TAB */}
              <TabsContent value="time">
                {timeEntries.length > 0 ? (
                  <Table>
                    <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Minutes</TableHead><TableHead>Description</TableHead><TableHead>Billable</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {timeEntries.map(te => (
                        <TableRow key={te.id}>
                          <TableCell>{te.user_name}</TableCell>
                          <TableCell className="font-mono">{te.minutes}m</TableCell>
                          <TableCell>{te.description}</TableCell>
                          <TableCell>{te.billable ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Circle className="w-4 h-4 text-gray-500" />}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{te.created_at && formatDistanceToNow(new Date(te.created_at), { addSuffix: true })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <p className="text-center py-8 text-muted-foreground">No time entries</p>}
              </TabsContent>

              {/* AUDIT TAB */}
              <TabsContent value="audit">
                <ScrollArea className="h-[350px]">
                  {auditLog.map(entry => (
                    <div key={entry.id} className="flex items-start gap-3 p-2 border-b border-border/50" data-testid={`audit-${entry.id}`}>
                      <History className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm"><span className="font-medium">{entry.user_name}</span> <span className="text-muted-foreground">{entry.action}</span></p>
                        <p className="text-xs text-muted-foreground">{entry.details}</p>
                        <p className="text-[11px] text-muted-foreground/60">{entry.created_at && formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</p>
                      </div>
                    </div>
                  ))}
                  {!auditLog.length && <p className="text-center py-8 text-muted-foreground">No audit entries</p>}
                </ScrollArea>
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
                <div><Label className="text-xs text-muted-foreground">Linked Device</Label>
                  <Select value={viewingTicket.device_id || "none"} onValueChange={v => handleUpdateTicket("device_id", v === "none" ? "" : v)}>
                    <SelectTrigger data-testid="device-select"><SelectValue placeholder="No device linked" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- No device --</SelectItem>
                      {devices.filter(d => !viewingTicket.client_id || d.client_id === viewingTicket.client_id).map(d => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {viewingTicket.device_id && viewingTicket.device_name && (
                    <Button variant="link" size="sm" className="px-0 h-6 text-xs" onClick={() => window.location.href = `/devices/${viewingTicket.device_id}`} data-testid="view-device-link">
                      View {viewingTicket.device_name} details
                    </Button>
                  )}
                  {/* Device info panel */}
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
                </div>
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

            {/* ── Enrichment: Sentiment + TTR Prediction ── */}
            {enrichment && !enrichment.error && (
              <>
                <Card data-testid="sentiment-card" className="overflow-hidden">
                  <CardContent className="pt-4 pb-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Client Sentiment</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        enrichment.sentiment?.label === "frustrated" ? "bg-red-500/15 text-red-400 pulse-critical" :
                        enrichment.sentiment?.label === "positive" ? "bg-emerald-500/15 text-emerald-400" :
                        "bg-blue-500/15 text-blue-400"
                      }`} data-testid="sentiment-badge">
                        {enrichment.sentiment?.label === "frustrated" ? "Frustrated" : enrichment.sentiment?.label === "positive" ? "Happy" : "Neutral"}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${
                        enrichment.sentiment?.label === "frustrated" ? "bg-red-500" :
                        enrichment.sentiment?.label === "positive" ? "bg-emerald-500" : "bg-blue-500"
                      }`} style={{ width: `${enrichment.sentiment?.score || 50}%` }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">{enrichment.sentiment?.reason}</p>
                  </CardContent>
                </Card>

                <Card data-testid="ttr-card">
                  <CardContent className="pt-4 pb-3">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2">Resolution Prediction</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-primary">
                        {enrichment.ttr_prediction?.predicted_minutes >= 60
                          ? `${Math.round(enrichment.ttr_prediction.predicted_minutes / 60)}h ${enrichment.ttr_prediction.predicted_minutes % 60}m`
                          : `${enrichment.ttr_prediction?.predicted_minutes}m`}
                      </span>
                      <span className="text-[10px] text-muted-foreground">estimated</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="h-1 flex-1 rounded-full bg-muted/50 overflow-hidden">
                        <div className="h-full rounded-full bg-primary/60" style={{ width: `${(enrichment.ttr_prediction?.confidence || 0) * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{Math.round((enrichment.ttr_prediction?.confidence || 0) * 100)}% conf.</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">{enrichment.ttr_prediction?.based_on}</p>
                  </CardContent>
                </Card>

                {/* Blast Radius */}
                {enrichment.blast_radius?.affected_users > 0 && (
                  <Card data-testid="blast-radius-card" className={enrichment.blast_radius.affected_users > 10 ? "pulse-warning" : ""}>
                    <CardContent className="pt-4 pb-3">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2">Impact Blast Radius</span>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center">
                          <span className="text-sm font-bold text-orange-400">{enrichment.blast_radius.affected_users}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium">Users Affected</p>
                          {enrichment.blast_radius.device_name && (
                            <p className="text-[10px] text-muted-foreground">{enrichment.blast_radius.device_name} ({enrichment.blast_radius.device_type})</p>
                          )}
                        </div>
                      </div>
                      {enrichment.blast_radius.affected_services?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {enrichment.blast_radius.affected_services.map((s, i) => (
                            <span key={`k-${i}`} className="px-1.5 py-0.5 rounded text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/20">{s}</span>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Client Context */}
                <Card data-testid="client-context-card">
                  <CardContent className="pt-4 pb-3 space-y-2.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Client Health</span>
                    <div className="flex items-center gap-3">
                      <div className="relative w-11 h-11">
                        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="hsl(var(--muted))" strokeWidth="2.5" opacity="0.3" />
                          <circle cx="18" cy="18" r="15.9" fill="none"
                            stroke={enrichment.client_context?.health_score >= 80 ? "#10b981" : enrichment.client_context?.health_score >= 60 ? "#f97316" : "#ef4444"}
                            strokeWidth="2.5" strokeDasharray={`${enrichment.client_context?.health_score} ${100 - (enrichment.client_context?.health_score || 0)}`} strokeLinecap="round" />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{enrichment.client_context?.health_score}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{enrichment.client_context?.name}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{enrichment.client_context?.contract_status} &middot; ${enrichment.client_context?.contract_value?.toLocaleString()}/mo</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                      <div className="flex justify-between"><span className="text-muted-foreground">Open Tickets</span><span className="font-medium">{enrichment.client_context?.open_tickets}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Lifetime</span><span className="font-medium">{enrichment.client_context?.total_tickets_lifetime}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Devices</span><span className="font-medium">{enrichment.client_context?.total_devices}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Offline</span><span className="font-medium text-red-400">{enrichment.client_context?.offline_devices}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">NPS</span><span className="font-medium">{enrichment.client_context?.nps_score}/10</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">CSAT</span><span className="font-medium">{enrichment.client_context?.avg_satisfaction}/5</span></div>
                    </div>
                  </CardContent>
                </Card>

                {/* Smart Merge Suggestions */}
                {enrichment.merge_candidates?.length > 0 && (
                  <Card data-testid="smart-merge-card">
                    <CardContent className="pt-4 pb-3 space-y-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Related Tickets</span>
                      <p className="text-[10px] text-muted-foreground">Potential duplicates or related issues from this client</p>
                      {enrichment.merge_candidates.map(mc => (
                        <div key={mc.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => fetchTicketDetail(mc)}>
                          <span className="font-mono text-[10px] text-primary">{mc.ticket_number}</span>
                          <span className="text-[11px] truncate flex-1">{mc.title}</span>
                          <span className={`px-1 py-0.5 rounded text-[9px] ${
                            mc.priority === "critical" ? "bg-red-500/15 text-red-400" :
                            mc.priority === "high" ? "bg-orange-500/15 text-orange-400" :
                            "bg-muted text-muted-foreground"
                          }`}>{mc.priority}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>

        {/* EMAIL DIALOG */}
        <Dialog open={isEmailOpen} onOpenChange={setIsEmailOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Send Email from Ticket</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div><Label>To</Label><Input value={emailForm.to} onChange={e => setEmailForm({ ...emailForm, to: e.target.value })} placeholder="recipient@email.com" data-testid="email-to" /></div>
                <div><Label>CC</Label><Input value={emailForm.cc} onChange={e => setEmailForm({ ...emailForm, cc: e.target.value })} placeholder="cc@email.com" data-testid="email-cc" /></div>
                <div><Label>BCC</Label><Input value={emailForm.bcc} onChange={e => setEmailForm({ ...emailForm, bcc: e.target.value })} placeholder="bcc@email.com" data-testid="email-bcc" /></div>
              </div>
              <div><Label>Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} data-testid="email-subject" /></div>
              <div><Label>Body</Label><Textarea value={emailForm.body} onChange={e => setEmailForm({ ...emailForm, body: e.target.value })} rows={6} data-testid="email-body" />
                <div className="flex items-center gap-2 mt-1">
                  <Button variant="outline" size="sm" className="h-7 text-[11px] text-cyan-400 border-cyan-500/30"
                    onClick={() => handleProofread(emailForm.body, "email")} disabled={proofreadLoading || !emailForm.body} data-testid="proofread-email-btn">
                    <SpellCheck className="w-3 h-3 mr-1" />Proofread Email
                  </Button>
                  {proofreadResult && proofreadResult.target === "email" && (
                    <Button variant="outline" size="sm" className="h-7 text-[11px] text-green-400" 
                      onClick={() => { setEmailForm({...emailForm, body: proofreadResult.corrected}); setProofreadResult(null); }}>
                      Apply Corrections
                    </Button>
                  )}
                </div>
              </div>
              {emailSignature && <div className="border rounded p-2 bg-muted/30"><p className="text-xs text-muted-foreground mb-1">Signature:</p><div className="text-sm" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailSignature) }} /></div>}
            </div>
            <DialogFooter><Button onClick={handleSendEmail} data-testid="send-email-submit"><Send className="w-4 h-4 mr-1" />Send</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CHILD TICKET DIALOG */}
        <Dialog open={isChildOpen} onOpenChange={setIsChildOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Child Ticket</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Title</Label><Input value={childForm.title} onChange={e => setChildForm({ ...childForm, title: e.target.value })} data-testid="child-title" /></div>
              <div><Label>Description</Label><Textarea value={childForm.description} onChange={e => setChildForm({ ...childForm, description: e.target.value })} data-testid="child-desc" /></div>
              <div><Label>Priority</Label>
                <Select value={childForm.priority} onValueChange={v => setChildForm({ ...childForm, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button onClick={handleCreateChild} data-testid="create-child-submit"><GitBranch className="w-4 h-4 mr-1" />Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MERGE DIALOG */}
        <Dialog open={isMergeOpen} onOpenChange={setIsMergeOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Merge Tickets Into This One</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Select tickets to merge into {viewingTicket.ticket_number}. Their notes and emails will be combined.</p>
            <ScrollArea className="h-[250px]">
              {tickets.filter(t => t.id !== viewingTicket.id && t.status !== "closed").map(t => (
                <div key={t.id} className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded">
                  <Checkbox checked={mergeIds.includes(t.id)} onCheckedChange={c => setMergeIds(c ? [...mergeIds, t.id] : mergeIds.filter(x => x !== t.id))} />
                  <span className="font-mono text-sm">{t.ticket_number}</span>
                  <span className="text-sm truncate">{t.title}</span>
                </div>
              ))}
            </ScrollArea>
            <DialogFooter><Button onClick={handleMerge} disabled={!mergeIds.length} data-testid="merge-submit"><Merge className="w-4 h-4 mr-1" />Merge {mergeIds.length} tickets</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* LOG TIME DIALOG */}
        <Dialog open={isTimeOpen} onOpenChange={setIsTimeOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Log Time</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Minutes</Label><Input type="number" value={timeForm.minutes} onChange={e => setTimeForm({ ...timeForm, minutes: parseInt(e.target.value) || 0 })} data-testid="time-minutes" /></div>
              <div><Label>Description</Label><Input value={timeForm.description} onChange={e => setTimeForm({ ...timeForm, description: e.target.value })} data-testid="time-desc" /></div>
              <div className="flex items-center gap-2"><Checkbox checked={timeForm.billable} onCheckedChange={v => setTimeForm({ ...timeForm, billable: v })} id="billable" /><Label htmlFor="billable">Billable</Label></div>
            </div>
            <DialogFooter><Button onClick={handleAddTime} data-testid="log-time-submit"><Timer className="w-4 h-4 mr-1" />Log Time</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* NOTIFY CLIENT DIALOG */}
        <Dialog open={isClientNotifyOpen} onOpenChange={setIsClientNotifyOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Notify Client with PDF</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Send an email notification to the client with a branded PDF of the conversation history attached.</p>
            <div className="space-y-3">
              <div><Label>Client Email</Label><Input value={notifyForm.email} onChange={e => setNotifyForm({ ...notifyForm, email: e.target.value })} placeholder="client@email.com" data-testid="notify-email" /></div>
              <div><Label>Subject</Label><Input value={notifyForm.subject} onChange={e => setNotifyForm({ ...notifyForm, subject: e.target.value })} data-testid="notify-subject" /></div>
              <div><Label>Message</Label><Textarea value={notifyForm.message} onChange={e => setNotifyForm({ ...notifyForm, message: e.target.value })} rows={3} data-testid="notify-message" /></div>
            </div>
            <DialogFooter><Button onClick={handleNotifyClient} data-testid="send-notify-btn"><BellRing className="w-4 h-4 mr-1" />Send Notification</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CANNED RESPONSE DIALOG - REMOVED, moved to Settings */}

        {/* ADD ITEMS TO TICKET DIALOG */}
        <Dialog open={isAddItemOpen} onOpenChange={setIsAddItemOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-cyan-400" />Add Billable Items</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">Add products/items used on this ticket. Stock will be deducted automatically.</p>
              <div className="flex items-center gap-2">
                <Select value={addItemProduct || "__none"} onValueChange={v => setAddItemProduct(v === "__none" ? "" : v)}>
                  <SelectTrigger className="flex-1" data-testid="add-item-product-select"><SelectValue placeholder="Select product..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Choose product...</SelectItem>
                    {allProducts.filter(p => p.is_active !== false).map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} - ${p.retail_price?.toFixed(2)} ({p.quantity_in_stock} in stock)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" min="1" className="w-20" value={addItemQty} onChange={e => setAddItemQty(parseInt(e.target.value) || 1)} />
                <Button onClick={handleAddItemToTicket} disabled={!addItemProduct} data-testid="confirm-add-item"><Plus className="w-4 h-4 mr-1" />Add</Button>
              </div>
              {ticketProducts.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {ticketProducts.map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium text-sm">{p.product_name}</TableCell>
                          <TableCell className="text-right font-mono">{p.quantity}</TableCell>
                          <TableCell className="text-right font-mono">${(p.unit_price || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono font-bold">${(p.total || 0).toFixed(2)}</TableCell>
                          <TableCell><Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => handleRemoveItemFromTicket(p.id)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell colSpan={3} className="text-right font-semibold">Total</TableCell>
                        <TableCell className="text-right font-mono font-bold text-green-400">${ticketProducts.reduce((s, p) => s + (p.total || 0), 0).toFixed(2)}</TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddItemOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* PUSH TO INVOICE DIALOG */}
        <Dialog open={isPushInvoiceOpen} onOpenChange={setIsPushInvoiceOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Receipt className="w-5 h-5 text-green-400" />Push Items to Invoice</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Push {ticketProducts.length} item(s) totalling <span className="font-bold text-green-400">${ticketProducts.reduce((s, p) => s + (p.total || 0), 0).toFixed(2)}</span> to an invoice.
              </p>
              <div className="space-y-3">
                <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => handlePushToInvoice(null)} data-testid="create-new-invoice-btn">
                  <Plus className="w-4 h-4 mr-1" />Create New Invoice
                </Button>
                {invoicesList.length > 0 && (
                  <>
                    <Separator />
                    <Label>Or add to existing invoice:</Label>
                    <Select value={pushToExisting || "__none"} onValueChange={v => setPushToExisting(v === "__none" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Select invoice..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Choose...</SelectItem>
                        {invoicesList.filter(inv => inv.status !== "paid" && inv.status !== "cancelled").map(inv => (
                          <SelectItem key={inv.id} value={inv.id}>{inv.invoice_number} - {inv.client_name || "No client"} (${inv.total?.toFixed(2)})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {pushToExisting && <Button className="w-full" onClick={() => handlePushToInvoice(pushToExisting)} data-testid="push-to-existing-btn">Add to {invoicesList.find(i => i.id === pushToExisting)?.invoice_number}</Button>}
                  </>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Technician Co-Pilot */}
        <CoPilotPanel ticket={viewingTicket} device={deviceStatus} />
      </div>
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
    <div className="space-y-5" data-testid="tickets-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tickets & Jobs</h1>
          <p className="text-muted-foreground">{tickets.length} SLA, {workshopJobs.length} workshop, {fieldJobs.length} cabling/WISP</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchTickets}><Search className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={() => setIsCreateOpen(true)} data-testid="create-ticket-btn"><Plus className="w-4 h-4 mr-1" />New SLA Job</Button>
          <Button onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
            className={isRecording ? "bg-red-600 hover:bg-red-700 animate-pulse" : "bg-amber-600 hover:bg-amber-700"}
            data-testid="voice-ticket-btn">
            <Mic className="w-4 h-4 mr-1" />{isRecording ? "Stop Recording" : "Voice Ticket"}
          </Button>
          <Button onClick={() => setWsDialog(true)} data-testid="create-ws-btn" className="bg-purple-600 hover:bg-purple-700"><Wrench className="w-4 h-4 mr-1" />Workshop</Button>
          <Button onClick={() => setFjDialog(true)} data-testid="create-fj-btn" className="bg-cyan-600 hover:bg-cyan-700"><Radio className="w-4 h-4 mr-1" />Cabling / WISP</Button>
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
          <Button key={t.val} variant={typeFilter === t.val ? "default" : "outline"} size="sm"
            onClick={() => setTypeFilter(t.val)}
            className={`gap-1.5 ${typeFilter === t.val ? "" : "text-muted-foreground"}`}
            data-testid={`type-filter-${t.val}`}>
            <t.icon className={`w-3.5 h-3.5 ${typeFilter === t.val ? "" : t.color || ""}`} />
            {t.label} <span className="text-xs opacity-70">({t.count})</span>
          </Button>
        ))}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-6 gap-3">
        <Card className="cursor-pointer hover:border-blue-500/40 transition-colors" onClick={() => setStatusFilter("open")} data-testid="stat-open">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black text-blue-400">{openCount}</p><p className="text-[11px] text-muted-foreground">Open</p></div><div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><Circle className="w-5 h-5 text-blue-400" /></div></div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-yellow-500/40 transition-colors" onClick={() => setStatusFilter("in_progress")} data-testid="stat-progress">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black text-yellow-400">{inProgressCount}</p><p className="text-[11px] text-muted-foreground">In Progress</p></div><div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center"><Clock className="w-5 h-5 text-yellow-400" /></div></div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-green-500/40 transition-colors" onClick={() => setStatusFilter("resolved")} data-testid="stat-resolved">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black text-green-400">{resolvedCount}</p><p className="text-[11px] text-muted-foreground">Resolved</p></div><div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-green-400" /></div></div></CardContent>
        </Card>
        <Card className={`${criticalCount > 0 ? "border-red-500/40" : ""}`} data-testid="stat-critical">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className={`text-2xl font-black ${criticalCount > 0 ? "text-red-400" : "text-muted-foreground"}`}>{criticalCount}</p><p className="text-[11px] text-muted-foreground">Critical</p></div><div className={`w-10 h-10 rounded-xl ${criticalCount > 0 ? "bg-red-500/10" : "bg-muted/30"} flex items-center justify-center`}><AlertCircle className={`w-5 h-5 ${criticalCount > 0 ? "text-red-400" : "text-muted-foreground"}`} /></div></div></CardContent>
        </Card>
        <Card className={`${noNotesCount > 0 ? "border-amber-500/40" : ""}`} data-testid="stat-no-notes">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className={`text-2xl font-black ${noNotesCount > 0 ? "text-amber-400" : "text-muted-foreground"}`}>{noNotesCount}</p><p className="text-[11px] text-muted-foreground">No Response</p></div><div className={`w-10 h-10 rounded-xl ${noNotesCount > 0 ? "bg-amber-500/10" : "bg-muted/30"} flex items-center justify-center`}><MessageSquare className={`w-5 h-5 ${noNotesCount > 0 ? "text-amber-400" : "text-muted-foreground"}`} /></div></div></CardContent>
        </Card>
        <Card data-testid="stat-avg-time">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black">{avgResTime}m</p><p className="text-[11px] text-muted-foreground">Avg Time</p></div><div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center"><Timer className="w-5 h-5 text-cyan-400" /></div></div></CardContent>
        </Card>
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

      {/* CREATE TICKET DIALOG - Syncro/SuperOps Style */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader><DialogTitle>Create New Ticket</DialogTitle></DialogHeader>
          <div className="space-y-4 overflow-y-auto max-h-[70vh] pr-1">
            {/* Core Info */}
            <div><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="Brief description of the issue" data-testid="create-title" /></div>
            <div><Label>Description</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={3} placeholder="Detailed description, steps to reproduce, etc." data-testid="create-desc" /></div>

            {/* AI Triage */}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleAiTriage} disabled={triaging} className="text-cyan-400 border-cyan-500/30" data-testid="ai-triage-btn">
                {triaging ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Brain className="w-3 h-3 mr-1" />}
                AI Triage
              </Button>
              {triageResult?.triage && (
                <>
                  <Badge className="bg-cyan-500/20 text-cyan-400">{triageResult.triage.category_confidence}% match</Badge>
                  <Badge className={triageResult.triage.priority === "critical" ? "bg-red-500/20 text-red-400" : triageResult.triage.priority === "high" ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}>{triageResult.triage.priority}</Badge>
                  <Badge variant="outline">{triageResult.triage.category}</Badge>
                  {triageResult.triage.recommended_assignee && <Badge variant="outline">{triageResult.triage.recommended_assignee.tech_name}</Badge>}
                  {triageResult.triage.tags?.length > 0 && triageResult.triage.tags.map(t => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                  <Button type="button" size="sm" onClick={applyTriage} className="bg-cyan-600 hover:bg-cyan-700 text-xs h-7" data-testid="apply-triage-btn">Apply</Button>
                </>
              )}
            </div>
            {triageResult?.triage?.priority_reason && (
              <div className="p-2 rounded-lg bg-cyan-500/5 border border-cyan-500/20 text-xs">
                <span className="font-bold text-cyan-400">AI Analysis: </span>
                <span className="text-muted-foreground">{triageResult.triage.priority_reason}</span>
                {triageResult.analysis?.infrastructure_impact && <Badge className="ml-2 bg-orange-500/20 text-orange-400 text-[9px]">Infrastructure Impact</Badge>}
              </div>
            )}

            {/* Row 1: Client, Contact, Device */}
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Client *</Label>
                <Select value={formData.client_id} onValueChange={v => setFormData({ ...formData, client_id: v, contact_id: "", device_id: "" })}>
                  <SelectTrigger data-testid="create-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Contact</Label>
                <Select value={formData.contact_id || "none"} onValueChange={v => setFormData({ ...formData, contact_id: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="create-contact"><SelectValue placeholder="Select contact" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- No specific contact --</SelectItem>
                    {formData.client_id && (clients.find(c => c.id === formData.client_id)?.contacts || []).map((ct, i) => (
                      <SelectItem key={ct.id || i} value={ct.id || ct.name}>{ct.name} - {ct.email || ct.role || "General"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Linked Device</Label>
                <Select value={formData.device_id || "none"} onValueChange={v => setFormData({ ...formData, device_id: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="create-device"><SelectValue placeholder="Select device" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- No device --</SelectItem>
                    {devices.filter(d => !formData.client_id || d.client_id === formData.client_id).map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.name} ({d.os} - {d.ip_address || "No IP"})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Row 2: Type, Category, Source */}
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Ticket Type</Label>
                <Select value={formData.ticket_type} onValueChange={v => setFormData({ ...formData, ticket_type: v })}>
                  <SelectTrigger data-testid="create-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="incident">Incident</SelectItem>
                    <SelectItem value="service_request">Service Request</SelectItem>
                    <SelectItem value="problem">Problem</SelectItem>
                    <SelectItem value="change_request">Change Request</SelectItem>
                    <SelectItem value="alert">Alert / Monitoring</SelectItem>
                    <SelectItem value="task">Task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Category</Label>
                <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="support">General Support</SelectItem>
                    <SelectItem value="hardware">Hardware</SelectItem>
                    <SelectItem value="software">Software</SelectItem>
                    <SelectItem value="network">Network</SelectItem>
                    <SelectItem value="security">Security</SelectItem>
                    <SelectItem value="email">Email / O365</SelectItem>
                    <SelectItem value="backup">Backup / DR</SelectItem>
                    <SelectItem value="onboarding">Onboarding / Offboarding</SelectItem>
                    <SelectItem value="project">Project Work</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Source</Label>
                <Select value={formData.source} onValueChange={v => setFormData({ ...formData, source: v })}>
                  <SelectTrigger data-testid="create-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portal">Client Portal</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone">Phone Call</SelectItem>
                    <SelectItem value="chat">Live Chat</SelectItem>
                    <SelectItem value="monitoring">Monitoring Alert</SelectItem>
                    <SelectItem value="walk_in">Walk-in</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 3: Priority, Impact, Assigned To */}
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Priority</Label>
                <Select value={formData.priority} onValueChange={v => setFormData({ ...formData, priority: v })}>
                  <SelectTrigger data-testid="create-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Impact</Label>
                <Select value={formData.impact} onValueChange={v => setFormData({ ...formData, impact: v })}>
                  <SelectTrigger data-testid="create-impact"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low - Single user</SelectItem>
                    <SelectItem value="medium">Medium - Department</SelectItem>
                    <SelectItem value="high">High - Organization-wide</SelectItem>
                    <SelectItem value="critical">Critical - Business down</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Assign To</Label>
                <Select value={formData.assigned_to || "none"} onValueChange={v => setFormData({ ...formData, assigned_to: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="create-assigned"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- Unassigned --</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 4: Due Date, Estimated Hours */}
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Due Date</Label>
                <Input type="date" value={formData.due_date || ""} onChange={e => setFormData({ ...formData, due_date: e.target.value })} data-testid="create-due-date" />
              </div>
              <div><Label>Estimated Hours</Label>
                <Input type="number" step="0.5" value={formData.estimated_hours || ""} onChange={e => setFormData({ ...formData, estimated_hours: e.target.value })} placeholder="e.g. 2.5" data-testid="create-est-hours" />
              </div>
              <div><Label>Parent Ticket</Label>
                <Select value={formData.parent_id || "none"} onValueChange={v => setFormData({ ...formData, parent_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="None (standalone)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (standalone ticket)</SelectItem>
                    {tickets.filter(t => !t.parent_id).slice(0, 30).map(t => <SelectItem key={t.id} value={t.id}>{t.ticket_number} - {t.title?.slice(0, 30)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Tags */}
            <div><Label>Tags</Label>
              <div className="flex gap-2 flex-wrap mb-2">{(formData.tags || []).map(t => (
                <Badge key={t} variant="secondary" className="gap-1">{t}
                  <button className="ml-1 text-xs hover:text-destructive" onClick={() => setFormData({ ...formData, tags: formData.tags.filter(tag => tag !== t) })}>x</button>
                </Badge>
              ))}</div>
              <Input placeholder="Type a tag and press Enter" data-testid="create-tags"
                onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) { e.preventDefault(); setFormData({ ...formData, tags: [...(formData.tags || []), e.target.value.trim()] }); e.target.value = ""; } }} />
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreateTicket} data-testid="create-ticket-submit"><Plus className="w-4 h-4 mr-1" />Create Ticket</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CREATE WORKSHOP JOB DIALOG */}
      <Dialog open={wsDialog} onOpenChange={setWsDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Wrench className="w-5 h-5 text-purple-400" />New Workshop Job</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Customer Name</Label><Input value={wsForm.customer_name} onChange={e => setWsForm({ ...wsForm, customer_name: e.target.value })} data-testid="ws-customer" /></div>
              <div><Label>Phone</Label><Input value={wsForm.customer_phone} onChange={e => setWsForm({ ...wsForm, customer_phone: e.target.value })} /></div>
            </div>
            <div><Label>Customer Email</Label><Input value={wsForm.customer_email} onChange={e => setWsForm({ ...wsForm, customer_email: e.target.value })} placeholder="customer@example.com" type="email" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Device Type</Label>
                <Select value={wsForm.device_type || "laptop"} onValueChange={v => setWsForm({ ...wsForm, device_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="laptop">Laptop</SelectItem><SelectItem value="desktop">Desktop</SelectItem><SelectItem value="phone">Phone</SelectItem><SelectItem value="tablet">Tablet</SelectItem><SelectItem value="printer">Printer</SelectItem><SelectItem value="network">Network Device</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Brand</Label><Input value={wsForm.device_brand} onChange={e => setWsForm({ ...wsForm, device_brand: e.target.value })} placeholder="Dell, HP..." /></div>
              <div><Label>Model</Label><Input value={wsForm.device_model} onChange={e => setWsForm({ ...wsForm, device_model: e.target.value })} /></div>
            </div>
            <div><Label>Serial Number</Label><Input value={wsForm.serial_number} onChange={e => setWsForm({ ...wsForm, serial_number: e.target.value })} className="font-mono" /></div>
            <div><Label>Fault Description</Label><Textarea value={wsForm.fault_description} onChange={e => setWsForm({ ...wsForm, fault_description: e.target.value })} rows={3} data-testid="ws-fault" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Priority</Label>
                <Select value={wsForm.priority} onValueChange={v => setWsForm({ ...wsForm, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Assign Tech</Label>
                <Select value={wsForm.assigned_to || "none"} onValueChange={v => { const u = users.find(x => x.id === v); setWsForm({ ...wsForm, assigned_to: v === "none" ? "" : v, assigned_to_name: u?.name || "" }); }}>
                  <SelectTrigger><SelectValue placeholder="Assign" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Unassigned</SelectItem>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreateWsJob} data-testid="create-ws-submit"><Wrench className="w-4 h-4 mr-1" />Create Job</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CREATE FIELD JOB DIALOG */}
      <Dialog open={fjDialog} onOpenChange={setFjDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Radio className="w-5 h-5 text-cyan-400" />New Cabling / WISP Job</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Customer Name</Label><Input value={fjForm.customer_name} onChange={e => setFjForm({ ...fjForm, customer_name: e.target.value })} data-testid="fj-customer" /></div>
              <div><Label>Phone</Label><Input value={fjForm.customer_phone} onChange={e => setFjForm({ ...fjForm, customer_phone: e.target.value })} /></div>
            </div>
            <div><Label>Service Address</Label><Input value={fjForm.service_address} onChange={e => setFjForm({ ...fjForm, service_address: e.target.value })} data-testid="fj-address" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Zone / Area</Label><Input value={fjForm.zone} onChange={e => setFjForm({ ...fjForm, zone: e.target.value })} placeholder="e.g. North, CBD, Rural" /></div>
              <div><Label>Job Category</Label>
                <Select value={fjForm.job_category} onValueChange={v => setFjForm({ ...fjForm, job_category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="installation">Installation</SelectItem><SelectItem value="maintenance">Maintenance</SelectItem><SelectItem value="troubleshooting">Troubleshooting</SelectItem><SelectItem value="decommission">Decommission</SelectItem><SelectItem value="survey">Site Survey</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Description</Label><Textarea value={fjForm.description} onChange={e => setFjForm({ ...fjForm, description: e.target.value })} rows={2} data-testid="fj-description" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Date</Label><Input type="date" value={fjForm.scheduled_date} onChange={e => setFjForm({ ...fjForm, scheduled_date: e.target.value })} /></div>
              <div><Label>Time</Label><Input type="time" value={fjForm.scheduled_time} onChange={e => setFjForm({ ...fjForm, scheduled_time: e.target.value })} /></div>
              <div><Label>Duration (min)</Label><Input type="number" value={fjForm.estimated_duration || 60} onChange={e => setFjForm({ ...fjForm, estimated_duration: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Priority</Label>
                <Select value={fjForm.priority} onValueChange={v => setFjForm({ ...fjForm, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Assign Tech</Label>
                <Select value={fjForm.assigned_to || "none"} onValueChange={v => { const u = users.find(x => x.id === v); setFjForm({ ...fjForm, assigned_to: v === "none" ? "" : v, assigned_to_name: u?.name || "" }); }}>
                  <SelectTrigger><SelectValue placeholder="Assign" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Unassigned</SelectItem>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreateFjJob} data-testid="create-fj-submit"><Radio className="w-4 h-4 mr-1" />Create Cabling / WISP Job</Button></DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
