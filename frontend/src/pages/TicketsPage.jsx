import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
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
  Wrench, MapPin, Radio, Pause, PhoneCall, DollarSign, Package, Calendar, Mic
} from "lucide-react";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";

const priorityConfig = {
  critical: { label: "Critical", class: "bg-red-500 text-white" },
  high: { label: "High", class: "bg-orange-500 text-white" },
  medium: { label: "Medium", class: "bg-yellow-500 text-white" },
  low: { label: "Low", class: "bg-green-600 text-white" }
};
const statusConfig = {
  open: { label: "Open", class: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  in_progress: { label: "In Progress", class: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
  resolved: { label: "Resolved", class: "bg-green-500/10 text-green-500 border-green-500/20" },
  closed: { label: "Closed", class: "bg-gray-500/10 text-gray-500 border-gray-500/20" }
};

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
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [addItemProduct, setAddItemProduct] = useState("");
  const [addItemQty, setAddItemQty] = useState(1);
  const [allProducts, setAllProducts] = useState([]);
  const [isPushInvoiceOpen, setIsPushInvoiceOpen] = useState(false);
  const [invoicesList, setInvoicesList] = useState([]);
  const [pushToExisting, setPushToExisting] = useState("");
  const [topTab, setTopTab] = useState("tickets");
  const [typeFilter, setTypeFilter] = useState("all");
  const [workshopJobs, setWorkshopJobs] = useState([]);
  const [workshopStats, setWorkshopStats] = useState({});
  const [fieldJobs, setFieldJobs] = useState([]);
  const [fieldStats, setFieldStats] = useState({});
  const [wsDialog, setWsDialog] = useState(false);
  const [wsForm, setWsForm] = useState({ customer_name: "", customer_phone: "", device_type: "", device_brand: "", device_model: "", serial_number: "", fault_description: "", priority: "normal", assigned_to: "", assigned_to_name: "" });
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
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [triageResult, setTriageResult] = useState(null);
  const [triaging, setTriaging] = useState(false);
  const [enrichment, setEnrichment] = useState(null);

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
    // Mark viewing
    axios.post(`${API}/tickets/${ticket.id}/viewing`, {}, { headers }).catch(() => {});
    try {
      const [nRes, eRes, cRes, tRes, aRes, sRes, attRes, prodRes, enrichRes] = await Promise.all([
        axios.get(`${API}/tickets/${ticket.id}/comments`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/emails`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/children`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/time-entries`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/audit-log`, { headers }),
        axios.get(`${API}/scripts`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/tickets/${ticket.id}/attachments`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/tickets/${ticket.id}/products`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/ticket-enrichment/${ticket.id}`, { headers }).catch(() => ({ data: null })),
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
      // Fetch worksheets
      try {
        const wsRes2 = await axios.get(`${API}/tickets/${ticket.id}/worksheet`, { headers });
        setWorksheetItems(wsRes2.data || []);
      } catch { setWorksheetItems([]); }
      const sig = user?.email_signature || "";
      setEmailSignature(sig);
      setEmailForm({ to: "", cc: "", bcc: "", subject: `Re: ${ticket.ticket_number} - ${ticket.title}`, body: "" });
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
    const payload = {
      ...formData,
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
      const res = await axios.post(`${API}/ai/triage`, { title: formData.title, description: formData.description, client_name: clientName }, { headers });
      setTriageResult(res.data);
      toast.success(`AI Triage: ${res.data.suggested_priority} priority, ${Math.round((res.data.confidence || 0) * 100)}% confidence`);
    } catch { toast.error("AI Triage failed"); }
    finally { setTriaging(false); }
  };

  const applyTriage = () => {
    if (!triageResult) return;
    setFormData(prev => ({
      ...prev,
      priority: triageResult.suggested_priority || prev.priority,
      category: triageResult.suggested_category || prev.category,
      assigned_to: triageResult.suggested_technician_id || prev.assigned_to,
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

  const handleCreateWsJob = async () => {
    try {
      const res = await axios.post(`${API}/workshop/jobs`, wsForm, { headers });
      toast.success(`Workshop job ${res.data.job_number} created`);
      setWsDialog(false); setWsForm({ customer_name: "", customer_phone: "", device_type: "", device_brand: "", device_model: "", serial_number: "", fault_description: "", priority: "normal", assigned_to: "", assigned_to_name: "" });
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

  const WS_STATUSES = {
    checked_in: { label: "Checked In", class: "bg-blue-500/20 text-blue-400", icon: "inbox" },
    diagnosing: { label: "Diagnosing", class: "bg-purple-500/20 text-purple-400", icon: "search" },
    parts_ordered: { label: "Parts Ordered", class: "bg-cyan-500/20 text-cyan-400", icon: "truck" },
    repairing: { label: "Repairing", class: "bg-amber-500/20 text-amber-400", icon: "wrench" },
    ready_for_pickup: { label: "Ready for Pickup", class: "bg-green-500/20 text-green-400", icon: "check" },
    collected: { label: "Collected", class: "bg-gray-500/20 text-gray-400", icon: "package" },
    cancelled: { label: "Cancelled", class: "bg-red-500/20 text-red-400", icon: "x" },
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
              <CardHeader className="pb-2"><CardTitle className="text-xl">{viewingTicket.title}</CardTitle></CardHeader>
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
                          <Badge key={i} variant="outline" className="text-[10px] bg-orange-500/5 border-orange-500/20">{cause}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {aiAnalysis.steps?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Recommended Fix Steps</p>
                      <div className="space-y-1.5">
                        {aiAnalysis.steps.map((step, i) => (
                          <div key={i} className="flex items-start gap-2 py-1 px-2 rounded bg-muted/30">
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
                        <code key={i} className="block text-[11px] bg-muted/50 px-2 py-1 rounded font-mono mb-1">{script}</code>
                      ))}
                    </div>
                  )}
                  {aiAnalysis.kb_references?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Related KB Articles</p>
                      <div className="flex flex-wrap gap-1.5">
                        {aiAnalysis.kb_references.map((ref, i) => (
                          <Badge key={i} variant="outline" className="text-[10px] text-blue-400 border-blue-500/20"><BookOpen className="w-2.5 h-2.5 mr-0.5" />{ref}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Tabs: Notes, Emails, Children, Time, Audit */}
            <Tabs defaultValue="suggestions">
              <TabsList className="w-full grid grid-cols-8">
                <TabsTrigger value="suggestions"><Lightbulb className="w-3 h-3 mr-1" />Suggestions</TabsTrigger>
                <TabsTrigger value="conversation" data-testid="conversation-tab"><MessageSquare className="w-3 h-3 mr-1" />Conversation ({ticketNotes.length + ticketEmails.length})</TabsTrigger>
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
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    {conversationType === "note" ? "Internal notes are only visible to your team" : "Emails will be sent to the client"}
                  </span>
                </div>

                {/* Internal Note Form */}
                {conversationType === "note" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Textarea className="flex-1" placeholder="Add an internal note..." value={newNote} onChange={e => setNewNote(e.target.value)} rows={2} data-testid="note-input" />
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Button variant="outline" size="sm" className="h-8 text-cyan-400 border-cyan-500/30"
                        onClick={() => handleProofread(newNote, "note")} disabled={proofreadLoading || !newNote}
                        data-testid="proofread-note-btn">
                        {proofreadLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <SpellCheck className="w-3 h-3 mr-1" />}
                        Proofread
                      </Button>
                      <Button size="sm" onClick={handleAddNote} data-testid="add-note-btn"><Send className="w-3 h-3 mr-1" />Add Note</Button>
                    </div>
                    {proofreadResult && proofreadResult.target === "note" && (
                      <div className="p-2.5 rounded-lg bg-cyan-500/5 border border-cyan-500/20" data-testid="proofread-result">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-cyan-400">Proofread Suggestion</span>
                          <div className="flex gap-1">
                            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => { setNewNote(proofreadResult.corrected); setProofreadResult(null); }}>Apply</Button>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setProofreadResult(null)}><X className="w-3 h-3" /></Button>
                          </div>
                        </div>
                        <p className="text-sm mb-1">{proofreadResult.corrected}</p>
                        {proofreadResult.changes?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {proofreadResult.changes.map((c, i) => <Badge key={i} variant="outline" className="text-[9px] bg-cyan-500/5">{c}</Badge>)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Inline Email Form */}
                {conversationType === "email" && (
                  <div className="space-y-3 p-3 rounded-lg border bg-blue-500/[0.02] border-blue-500/20">
                    <div className="grid grid-cols-3 gap-2">
                      <div><Label className="text-xs">To</Label><Input value={emailForm.to} onChange={e => setEmailForm({ ...emailForm, to: e.target.value })} placeholder="recipient@email.com" data-testid="inline-email-to" /></div>
                      <div><Label className="text-xs">CC</Label><Input value={emailForm.cc} onChange={e => setEmailForm({ ...emailForm, cc: e.target.value })} placeholder="cc@email.com" /></div>
                      <div><Label className="text-xs">BCC</Label><Input value={emailForm.bcc} onChange={e => setEmailForm({ ...emailForm, bcc: e.target.value })} placeholder="bcc@email.com" /></div>
                    </div>
                    <div><Label className="text-xs">Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} data-testid="inline-email-subject" /></div>
                    <div><Label className="text-xs">Body</Label><Textarea value={emailForm.body} onChange={e => setEmailForm({ ...emailForm, body: e.target.value })} rows={4} data-testid="inline-email-body" />
                      <div className="flex items-center gap-2 mt-1">
                        <Button variant="outline" size="sm" className="h-7 text-[11px] text-cyan-400 border-cyan-500/30"
                          onClick={() => handleProofread(emailForm.body, "email")} disabled={proofreadLoading || !emailForm.body} data-testid="proofread-email-btn">
                          <SpellCheck className="w-3 h-3 mr-1" />Proofread
                        </Button>
                        {proofreadResult && proofreadResult.target === "email" && (
                          <Button variant="outline" size="sm" className="h-7 text-[11px] text-green-400"
                            onClick={() => { setEmailForm({...emailForm, body: proofreadResult.corrected}); setProofreadResult(null); }}>
                            Apply Corrections
                          </Button>
                        )}
                      </div>
                    </div>
                    {emailSignature && <div className="border rounded p-2 bg-muted/30"><p className="text-xs text-muted-foreground mb-1">Signature:</p><div className="text-sm" dangerouslySetInnerHTML={{ __html: emailSignature }} /></div>}
                    <div className="flex justify-end">
                      <Button size="sm" onClick={handleSendEmail} data-testid="send-inline-email-btn"><Send className="w-3 h-3 mr-1" />Send Email</Button>
                    </div>
                  </div>
                )}

                {/* Unified Conversation Timeline */}
                <ScrollArea className="h-[300px]">
                  {(() => {
                    const allItems = [
                      ...ticketNotes.map(n => ({ ...n, _type: "note", _sort: n.created_at })),
                      ...ticketEmails.map(e => ({ ...e, _type: "email", _sort: e.created_at })),
                    ].sort((a, b) => (b._sort || "").localeCompare(a._sort || ""));

                    if (allItems.length === 0) return <p className="text-center py-8 text-muted-foreground">No conversation items yet</p>;

                    return allItems.map(item => {
                      if (item._type === "note") {
                        return (
                          <div key={`note-${item.id}`} className={`p-3 rounded-lg mb-2 border ${item.is_internal ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-muted/30 border-border'}`} data-testid={`note-${item.id}`}>
                            <div className="flex justify-between items-start mb-1">
                              <div className="flex items-center gap-2">
                                <MessageSquare className="w-3 h-3 text-blue-400" />
                                <User className="w-3 h-3" /><span className="text-sm font-medium">{item.user_name}</span>
                                {item.is_internal && <Badge variant="outline" className="text-yellow-500 text-[10px] h-4">Internal</Badge>}
                                <Badge variant="outline" className="text-[10px] h-4">Note</Badge>
                              </div>
                              <span className="text-xs text-muted-foreground">{item.created_at && formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{item.content}</p>
                          </div>
                        );
                      } else {
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
                            <p className="text-sm mt-1 whitespace-pre-wrap">{item.body?.substring(0, 200)}</p>
                          </div>
                        );
                      }
                    });
                  })()}
                </ScrollArea>
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
                            <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/20">{s}</span>
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
              {emailSignature && <div className="border rounded p-2 bg-muted/30"><p className="text-xs text-muted-foreground mb-1">Signature:</p><div className="text-sm" dangerouslySetInnerHTML={{ __html: emailSignature }} /></div>}
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
    return (
      <div className="space-y-4" data-testid="ws-job-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setViewWsJob(null)} data-testid="ws-back"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center"><Wrench className="w-4 h-4 text-purple-400" /></div>
          <span className="font-mono font-semibold">{viewWsJob.job_number}</span>
          <Badge className={WS_STATUSES[viewWsJob.repair_status]?.class}>{WS_STATUSES[viewWsJob.repair_status]?.label}</Badge>
        </div>
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-8 space-y-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Job Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-3 gap-3">
                  <div><span className="text-muted-foreground block">Customer</span><span className="font-medium">{viewWsJob.customer_name}</span></div>
                  <div><span className="text-muted-foreground block">Phone</span><span className="font-medium">{viewWsJob.customer_phone || "-"}</span></div>
                  <div><span className="text-muted-foreground block">Device</span><span className="font-medium">{[viewWsJob.device_brand, viewWsJob.device_model].filter(Boolean).join(" ") || viewWsJob.device_type || "-"}</span></div>
                </div>
                <Separator />
                <div><span className="text-muted-foreground block">Serial</span><span className="font-mono">{viewWsJob.serial_number || "-"}</span></div>
                <div><span className="text-muted-foreground block">Fault</span><span>{viewWsJob.fault_description || "-"}</span></div>
              </CardContent>
            </Card>
            <Card><CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm">Parts Used ({viewWsJob.parts_used?.length || 0})</CardTitle><Button size="sm" variant="outline" onClick={() => setWsPartDialog(true)} data-testid="add-ws-part"><Plus className="w-3 h-3 mr-1" />Add Part</Button></div></CardHeader>
              <CardContent className="p-0">
                {(viewWsJob.parts_used || []).length > 0 ? (
                  <Table><TableHeader><TableRow><TableHead>Part</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                    <TableBody>{(viewWsJob.parts_used || []).map(p => (
                      <TableRow key={p.id}><TableCell className="font-medium">{p.product_name}</TableCell><TableCell className="text-right font-mono">{p.quantity}</TableCell><TableCell className="text-right font-mono">${(p.unit_price || 0).toFixed(2)}</TableCell><TableCell className="text-right font-mono font-bold">${(p.total || 0).toFixed(2)}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                ) : <div className="text-center py-6 text-muted-foreground text-sm">No parts added yet</div>}
              </CardContent>
            </Card>
          </div>
          <div className="col-span-4 space-y-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Billing</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Parts</span><span className="font-mono">${(viewWsJob.total_parts_cost || 0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Labour ({viewWsJob.labour_minutes || 0} min @ ${viewWsJob.labour_rate}/hr)</span><span className="font-mono">${(viewWsJob.total_labour_cost || 0).toFixed(2)}</span></div>
                <Separator />
                <div className="flex justify-between text-base font-bold"><span>Total</span><span className="text-green-400">${(viewWsJob.total_cost || 0).toFixed(2)}</span></div>
              </CardContent>
            </Card>
            <Card className="border-amber-500/20"><CardContent className="py-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Labour Timer</p>
              <div className="flex items-center gap-2">
                <Button className={viewWsJob.timer_running ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"} onClick={() => handleWsTimer(viewWsJob.id, viewWsJob.timer_running ? "stop" : "start")} data-testid="ws-timer-btn">
                  {viewWsJob.timer_running ? <><Pause className="w-4 h-4 mr-1" />Stop</> : <><Play className="w-4 h-4 mr-1" />Start</>}
                </Button>
                <span className="font-mono text-lg">{viewWsJob.labour_minutes || 0} min</span>
                {viewWsJob.timer_running && <Badge className="bg-green-500/20 text-green-400 animate-pulse">Running</Badge>}
              </div>
            </CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Update Status</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(WS_STATUSES).filter(([k]) => k !== viewWsJob.repair_status).map(([k, v]) => (
                  <Button key={k} variant="outline" className={`w-full text-xs justify-start ${v.class}`} size="sm" onClick={() => handleWsStatus(viewWsJob.id, k)}>{v.label}</Button>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
        {/* Workshop Add Part Dialog */}
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
      </div>
    );
  }

  // ============ FIELD JOB DETAIL VIEW ============
  if (viewFjJob) {
    return (
      <div className="space-y-4" data-testid="fj-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setViewFjJob(null)} data-testid="fj-back"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center"><Wifi className="w-4 h-4 text-cyan-400" /></div>
          <span className="font-mono font-semibold">{viewFjJob.job_number}</span>
          <Badge className={FJ_STATUSES[viewFjJob.field_status]?.class}>{FJ_STATUSES[viewFjJob.field_status]?.label}</Badge>
          <Badge variant="outline" className="text-xs capitalize">{viewFjJob.job_category}</Badge>
        </div>
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-8 space-y-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Job Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-3 gap-3">
                  <div><span className="text-muted-foreground block">Customer</span><span className="font-medium">{viewFjJob.customer_name}</span></div>
                  <div><span className="text-muted-foreground block">Phone</span><span className="font-medium">{viewFjJob.customer_phone || "-"}</span></div>
                  <div><span className="text-muted-foreground block">Zone</span><Badge variant="outline">{viewFjJob.zone || "Unassigned"}</Badge></div>
                </div>
                <Separator />
                <div><span className="text-muted-foreground block">Address</span><span>{viewFjJob.service_address || "-"}</span></div>
                <div><span className="text-muted-foreground block">Description</span><span>{viewFjJob.description || "-"}</span></div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div><span className="text-muted-foreground block">Scheduled</span><span className="font-medium">{viewFjJob.scheduled_date} {viewFjJob.scheduled_time}</span></div>
                  <div><span className="text-muted-foreground block">Est. Duration</span><span>{viewFjJob.estimated_duration} min</span></div>
                </div>
              </CardContent>
            </Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Installation Checklist</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(viewFjJob.checklist || []).map((c, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 hover:bg-muted/30 cursor-pointer" onClick={() => {
                    const newCl = [...viewFjJob.checklist]; newCl[i] = { ...c, checked: !c.checked };
                    setViewFjJob({ ...viewFjJob, checklist: newCl }); handleFjChecklist(viewFjJob.id, newCl);
                  }} data-testid={`checklist-${i}`}>
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${c.checked ? "bg-green-500 border-green-500" : "border-muted-foreground"}`}>
                      {c.checked && <CheckCircle className="w-3 h-3 text-white" />}
                    </div>
                    <span className={`text-sm ${c.checked ? "line-through text-muted-foreground" : ""}`}>{c.item}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="border-cyan-500/20"><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Radio className="w-4 h-4 text-cyan-400" />Signal & Speed Test</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label className="text-xs">Signal (dBm)</Label><Input type="number" value={viewFjJob.signal_strength || ""} onChange={e => { const v = e.target.value; setViewFjJob({ ...viewFjJob, signal_strength: v }); axios.put(`${API}/field-jobs/${viewFjJob.id}`, { signal_strength: v }, { headers }); }} placeholder="-65" className="font-mono" data-testid="fj-signal" /></div>
                  <div><Label className="text-xs">Download (Mbps)</Label><Input type="number" value={viewFjJob.speed_test_down || ""} onChange={e => { const v = e.target.value; setViewFjJob({ ...viewFjJob, speed_test_down: v }); axios.put(`${API}/field-jobs/${viewFjJob.id}`, { speed_test_down: v }, { headers }); }} placeholder="100" className="font-mono" data-testid="fj-speed-down" /></div>
                  <div><Label className="text-xs">Upload (Mbps)</Label><Input type="number" value={viewFjJob.speed_test_up || ""} onChange={e => { const v = e.target.value; setViewFjJob({ ...viewFjJob, speed_test_up: v }); axios.put(`${API}/field-jobs/${viewFjJob.id}`, { speed_test_up: v }, { headers }); }} placeholder="50" className="font-mono" data-testid="fj-speed-up" /></div>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="col-span-4 space-y-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Update Status</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(FJ_STATUSES).filter(([k]) => k !== viewFjJob.field_status).map(([k, v]) => (
                  <Button key={k} variant="outline" className={`w-full text-xs justify-start ${v.class}`} size="sm" onClick={() => handleFjStatus(viewFjJob.id, k)}>{v.label}</Button>
                ))}
              </CardContent>
            </Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Info</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground block">Assigned</span><span className="font-medium">{viewFjJob.assigned_to_name || "Unassigned"}</span></div>
                <div><span className="text-muted-foreground block">Category</span><Badge variant="outline" className="capitalize">{viewFjJob.job_category}</Badge></div>
                <div><span className="text-muted-foreground block">Created</span><span>{viewFjJob.created_at?.slice(0, 10)}</span></div>
              </CardContent>
            </Card>
          </div>
        </div>
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

          return (
            <Card
              key={ticket.id}
              className={`cursor-pointer hover:bg-muted/30 transition-all border-l-4 ${priorityBorder} ${hasNoNotes ? "bg-red-500/3" : ""} ${isOverdue ? "ring-1 ring-red-500/30" : ""} ${isClosed ? "opacity-60" : ""}`}
              onClick={() => fetchTicketDetail(ticket)}
              data-testid={`ticket-row-${ticket.id}`}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  {/* Type Icon */}
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-500/10">
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
                  <div className="flex-1 min-w-0">
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
                      {ticket.device_name && <><span className="text-muted-foreground/30">|</span><span className="font-mono">{ticket.device_name}</span></>}
                      {ticket.category && <><span className="text-muted-foreground/30">|</span><span className="capitalize">{ticket.category}</span></>}
                      {(ticket.tags || []).length > 0 && <><span className="text-muted-foreground/30">|</span>{ticket.tags.slice(0, 2).map(t => <Badge key={t} variant="outline" className="text-[9px] h-4 px-1">{t}</Badge>)}</>}
                    </div>
                  </div>

                  {/* Right Side Info */}
                  <div className="flex items-center gap-3 flex-shrink-0">
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
              onClick={() => setViewWsJob(j)} data-testid={`ws-job-${j.id}`}>
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
              onClick={() => setViewFjJob(j)} data-testid={`fj-job-${j.id}`}>
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
              {triageResult && (
                <>
                  <Badge className="bg-cyan-500/20 text-cyan-400">{Math.round((triageResult.confidence || 0) * 100)}% confidence</Badge>
                  <Badge className={triageResult.suggested_priority === "critical" ? "bg-red-500/20 text-red-400" : triageResult.suggested_priority === "high" ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}>{triageResult.suggested_priority}</Badge>
                  <Badge variant="outline">{triageResult.suggested_category}</Badge>
                  {triageResult.suggested_technician_name && <Badge variant="outline">{triageResult.suggested_technician_name}</Badge>}
                  <Button type="button" size="sm" onClick={applyTriage} className="bg-cyan-600 hover:bg-cyan-700 text-xs h-7" data-testid="apply-triage-btn">Apply</Button>
                </>
              )}
            </div>
            {triageResult?.resolution_plan && (
              <div className="p-2 rounded-lg bg-cyan-500/5 border border-cyan-500/20 text-xs">
                <span className="font-bold text-cyan-400">AI Resolution Plan: </span>
                {triageResult.resolution_plan.map((s, i) => <span key={i} className="text-muted-foreground">{i + 1}. {s} </span>)}
                <span className="text-muted-foreground ml-2">(~{triageResult.estimated_time_minutes} min est.)</span>
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
                    {formData.client_id && clients.find(c => c.id === formData.client_id)?.contacts?.map((ct, i) => (
                      <SelectItem key={i} value={ct.name}>{ct.name} ({ct.role || "General"})</SelectItem>
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
