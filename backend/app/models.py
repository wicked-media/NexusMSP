from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone

# ============== MODELS ==============

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str
    two_factor_code: Optional[str] = None

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    name: str
    role: str = "technician"
    job_title: str = ""
    avatar: Optional[str] = None
    hourly_rate: float = 75.0
    email_signature: Optional[str] = None
    email_signature_html: Optional[str] = None
    phone: Optional[str] = None
    specialties: List[str] = []
    categories: List[str] = []
    is_active: bool = True
    is_admin: bool = False
    archived: bool = False
    archived_at: Optional[str] = None
    about_me: Optional[str] = None
    hire_date: Optional[str] = None
    birthday: Optional[str] = None
    permissions: dict = Field(default_factory=lambda: {
        "tickets": {"view": True, "create": True, "edit": True, "delete": False},
        "clients": {"view": True, "create": False, "edit": False, "delete": False},
        "invoices": {"view": False, "create": False, "edit": False, "delete": False},
        "products": {"view": True, "create": False, "edit": False, "delete": False},
        "devices": {"view": True, "create": True, "edit": True, "delete": False},
        "networking": {"view": True, "create": False, "edit": False, "delete": False},
        "assets": {"view": True, "create": True, "edit": True, "delete": False},
        "reports": {"view": False, "create": False, "edit": False, "delete": False},
        "knowledge_base": {"view": True, "create": True, "edit": True, "delete": False},
        "it_docs": {"view": False, "create": False, "edit": False, "delete": False},
        "contracts": {"view": False, "create": False, "edit": False, "delete": False},
        "projects": {"view": True, "create": True, "edit": True, "delete": False},
        "time_tracking": {"view": True, "create": True, "edit": True, "delete": False},
        "purchase_orders": {"view": False, "create": False, "edit": False, "delete": False},
        "scheduling": {"view": True, "create": False, "edit": False, "delete": False},
        "settings": {"view": False, "create": False, "edit": False, "delete": False},
        "agent_commands": {"view": False, "execute": False},
    })
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ClientCreate(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    industry: Optional[str] = None
    contract_type: str = "monthly"
    mrr: float = 0.0
    contacts: List[Dict[str, Any]] = []
    tier: Optional[str] = "standard"
    lifecycle: Optional[str] = "active"

class Client(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    industry: Optional[str] = None
    contract_type: str = "monthly"
    mrr: float = 0.0
    device_count: int = 0
    ticket_count: int = 0
    pax8_company_id: Optional[str] = None
    contacts: List[Dict[str, Any]] = []
    tier: Optional[str] = "standard"
    lifecycle: Optional[str] = "active"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class TicketCreate(BaseModel):
    title: str
    description: str
    client_id: Optional[str] = None
    priority: str = "medium"
    category: str = "support"
    assigned_to: Optional[str] = None
    parent_id: Optional[str] = None
    tags: List[str] = []
    cc: List[str] = []
    watchers: List[str] = []
    contact_id: Optional[str] = None
    due_date: Optional[str] = None
    estimated_hours: Optional[float] = None
    ticket_type: str = "incident"
    impact: str = "medium"
    source: str = "portal"
    asset_id: Optional[str] = None
    device_id: Optional[str] = None
    device_ids: List[str] = []  # Multi-device linking (Syncro-style); device_id kept for backward compat as primary
    service_code: Optional[str] = None  # Service Catalog SKU — auto-attaches SLA, priority, billing

class Ticket(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ticket_number: Optional[str] = None
    title: str = ""
    subject: Optional[str] = None
    description: str = ""
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    priority: str = "medium"
    status: str = "open"
    category: str = "support"
    ticket_type: str = "incident"
    impact: str = "medium"
    source: str = "portal"
    assigned_to: Optional[str] = None
    assigned_name: Optional[str] = None
    sla_due: Optional[datetime] = None
    due_date: Optional[str] = None
    estimated_hours: Optional[float] = None
    total_time_minutes: int = 0
    parent_id: Optional[str] = None
    asset_id: Optional[str] = None
    device_id: Optional[str] = None
    device_name: Optional[str] = None
    device_ids: List[str] = []  # Multi-device linking; device_id remains as primary for compat
    device_names: List[str] = []  # parallel array, populated for UI convenience
    tags: List[str] = []
    cc: List[str] = []
    watchers: List[str] = []
    merged_into: Optional[str] = None
    contact_id: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    custom_fields: Dict[str, Any] = {}
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DeviceCreate(BaseModel):
    name: str
    client_id: Optional[str] = None
    device_type: str = "workstation"
    os: str = "Windows 11"
    ip_address: Optional[str] = None
    serial_number: Optional[str] = None
    mac_address: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    processor: Optional[str] = None
    ram_gb: Optional[float] = None
    storage_total_gb: Optional[float] = None
    domain: Optional[str] = None
    location: Optional[str] = None
    assigned_user: Optional[str] = None
    tags: List[str] = []
    notes: Optional[str] = None

class Device(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    hostname: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    device_type: str = "workstation"
    os: str = "Windows 11"
    os_version: Optional[str] = None
    os_build: Optional[str] = None
    ip_address: Optional[str] = None
    public_ip: Optional[str] = None
    mac_address: Optional[str] = None
    serial_number: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    processor: Optional[str] = None
    processor_cores: Optional[int] = None
    ram_gb: Optional[float] = None
    storage_total_gb: Optional[float] = None
    storage_used_gb: Optional[float] = None
    gpu: Optional[str] = None
    domain: Optional[str] = None
    location: Optional[str] = None
    assigned_user: Optional[str] = None
    last_logged_in_user: Optional[str] = None
    uptime_hours: Optional[float] = None
    uptime_display: Optional[str] = None
    last_reboot: Optional[str] = None
    last_heartbeat: Optional[str] = None
    agent_version: Optional[str] = None
    antivirus: Optional[str] = None
    antivirus_status: Optional[str] = None
    firewall_enabled: Optional[bool] = True
    bitlocker_enabled: Optional[bool] = None
    edr_status: Optional[str] = None
    encryption_status: Optional[str] = None
    compliance_score: Optional[int] = None
    patch_status: Optional[str] = None
    pending_patches: Optional[int] = 0
    last_patch_date: Optional[str] = None
    installed_software_count: Optional[int] = 0
    tags: List[str] = []
    notes: Optional[str] = None
    rustdesk_id: Optional[str] = None
    bios_version: Optional[str] = None
    architecture: Optional[str] = None
    cpu_temp: Optional[float] = None
    status: str = "online"
    last_seen: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    cpu_usage: float = 0.0
    memory_usage: float = 0.0
    disk_usage: float = 0.0
    network_in_mbps: Optional[float] = 0.0
    network_out_mbps: Optional[float] = 0.0
    alerts_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AssetCreate(BaseModel):
    name: str
    client_id: Optional[str] = None
    device_id: Optional[str] = None
    asset_type: str = "hardware"
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    purchase_date: Optional[str] = None
    warranty_expiry: Optional[str] = None
    cost: float = 0.0
    location: Optional[str] = None
    assigned_to: Optional[str] = None
    depreciation_rate: float = 0.0
    notes: Optional[str] = None

class Asset(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    device_id: Optional[str] = None
    asset_type: str = "hardware"
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    purchase_date: Optional[str] = None
    warranty_expiry: Optional[str] = None
    cost: float = 0.0
    status: str = "active"
    location: Optional[str] = None
    assigned_to: Optional[str] = None
    depreciation_rate: float = 0.0
    current_value: float = 0.0
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Alert(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    device_name: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    alert_type: str
    severity: str = "warning"
    message: str
    status: str = "active"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== NEW MODELS ==============

class ContractCreate(BaseModel):
    client_id: Optional[str] = None
    name: str
    contract_type: str = "managed_services"
    billing_frequency: str = "monthly"
    start_date: str
    end_date: Optional[str] = None
    value: float = 0.0
    auto_renew: bool = True
    sla_tier: str = "standard"  # platinum/gold/silver/standard
    notes: Optional[str] = None

class Contract(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    name: str
    contract_type: str = "managed_services"
    billing_frequency: str = "monthly"
    start_date: str
    end_date: Optional[str] = None
    value: float = 0.0
    auto_renew: bool = True
    sla_tier: str = "standard"  # platinum/gold/silver/standard
    status: str = "active"
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class LineItemCreate(BaseModel):
    contract_id: str
    client_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    quantity: float = 1
    unit_price: float = 0.0
    billing_frequency: str = "monthly"
    pax8_subscription_id: Optional[str] = None
    pax8_product_id: Optional[str] = None

class LineItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    contract_id: str
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    name: str
    description: Optional[str] = None
    quantity: float = 1
    unit_price: float = 0.0
    total: float = 0.0
    billing_frequency: str = "monthly"
    pax8_subscription_id: Optional[str] = None
    pax8_product_id: Optional[str] = None
    synced_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class InvoiceCreate(BaseModel):
    client_id: Optional[str] = None
    contract_id: Optional[str] = None
    due_date: Optional[str] = None
    notes: Optional[str] = None
    line_items: List[Dict[str, Any]] = []
    tax_rate: float = 0.0
    discount_pct: float = 0.0
    discount_amount: float = 0.0
    is_recurring: bool = False
    recurring_interval: str = "monthly"
    recurring_start_date: Optional[str] = None
    recurring_end_date: Optional[str] = None

class Invoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    invoice_number: str = Field(default_factory=lambda: f"INV-{datetime.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:4].upper()}")
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    contract_id: Optional[str] = None
    status: str = "draft"
    payment_status: str = "unpaid"
    subtotal: float = 0.0
    tax: float = 0.0
    tax_rate: float = 0.0
    total: float = 0.0
    amount_paid: float = 0.0
    due_date: Optional[str] = None
    paid_date: Optional[str] = None
    notes: Optional[str] = None
    line_items: List[Dict[str, Any]] = []
    payments: List[Dict[str, Any]] = []
    stripe_session_id: Optional[str] = None
    xero_invoice_id: Optional[str] = None
    is_recurring: bool = False
    recurring_interval: str = "monthly"
    recurring_start_date: Optional[str] = None
    recurring_end_date: Optional[str] = None
    recurring_next_date: Optional[str] = None
    recurring_parent_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class TimeEntryCreate(BaseModel):
    ticket_id: str
    user_id: str
    description: str
    minutes: int
    billable: bool = True
    date: Optional[str] = None

class TimeEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ticket_id: str
    ticket_title: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    user_id: str
    user_name: Optional[str] = None
    description: str
    minutes: int
    hourly_rate: float = 75.0
    total_amount: float = 0.0
    billable: bool = True
    invoiced: bool = False
    date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime('%Y-%m-%d'))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class KBArticleCreate(BaseModel):
    title: str
    content: str
    category: str = "general"
    tags: List[str] = []
    is_public: bool = False

class KBArticle(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    content: str
    category: str = "general"
    tags: List[str] = []
    is_public: bool = False
    views: int = 0
    helpful_count: int = 0
    author_id: Optional[str] = None
    author_name: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Pax8Settings(BaseModel):
    client_id: Optional[str] = None
    client_secret: str

# ============== DOMOTZ & REMOTE ACCESS MODELS ==============

class DomotzSettings(BaseModel):
    api_key: str
    api_url: str

class RustDeskSettings(BaseModel):
    server_url: str
    api_key: Optional[str] = None
    relay_server: Optional[str] = None

class RemoteAgent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    platform: str  # windows, macos, linux
    version: str = "1.0.0"
    download_url: str
    checksum: Optional[str] = None
    instructions: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DeviceChatMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    device_name: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    user_id: str
    user_name: Optional[str] = None
    message: str
    message_type: str = "text"  # text, command, file, system
    direction: str = "outbound"  # outbound (tech to device), inbound (device to tech)
    status: str = "sent"  # sent, delivered, read, failed
    metadata: Dict[str, Any] = {}
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DeviceChatMessageCreate(BaseModel):
    device_id: str
    message: str
    message_type: str = "text"

class RemoteSession(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    device_name: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    user_id: str
    user_name: Optional[str] = None
    session_type: str = "remote_desktop"  # remote_desktop, terminal, file_transfer
    status: str = "active"  # active, ended, failed
    rustdesk_id: Optional[str] = None
    provider: str = "rustdesk"  # rustdesk, splashtop, screenconnect, etc.
    provider_device_id: Optional[str] = None
    ticket_id: Optional[str] = None
    consent_required: bool = False
    consent_confirmed: bool = False
    consent_confirmed_at: Optional[datetime] = None
    launch_status: str = "requested"  # requested, launched, handoff_required, failed
    device_type: Optional[str] = None  # desktop, server, laptop, workstation
    was_locked_before_disconnect: Optional[bool] = None
    lock_action_on_disconnect: Optional[str] = None  # locked, unlocked, no_change
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ended_at: Optional[datetime] = None
    duration_minutes: int = 0
    notes: Optional[str] = None

# ============== OFFICE 365 / EMAIL MODELS ==============

class Office365Settings(BaseModel):
    tenant_id: str
    client_id: Optional[str] = None
    client_secret: str
    redirect_uri: Optional[str] = None

class EmailMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    external_id: Optional[str] = None  # Microsoft Graph message ID
    subject: str
    body: str
    body_type: str = "html"  # html, text
    from_address: str
    from_name: Optional[str] = None
    to_addresses: List[str] = []
    cc_addresses: List[str] = []
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    ticket_id: Optional[str] = None
    direction: str = "outbound"  # inbound, outbound
    status: str = "draft"  # draft, sent, failed, received
    read: bool = False
    has_attachments: bool = False
    attachments: List[Dict[str, Any]] = []
    sent_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class EmailMessageCreate(BaseModel):
    subject: str
    body: str
    body_type: str = "html"
    to_addresses: List[str]
    cc_addresses: List[str] = []
    client_id: Optional[str] = None
    ticket_id: Optional[str] = None

# ============== ACRONIS MODELS ==============

class AcronisSettings(BaseModel):
    api_url: str
    client_id: Optional[str] = None
    client_secret: str

class AcronisSubscription(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    external_id: Optional[str] = None  # Acronis subscription ID
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    device_id: Optional[str] = None
    device_name: Optional[str] = None
    product_name: str
    edition: str = "Standard"  # Standard, Advanced, etc.
    status: str = "active"  # active, expired, suspended
    license_type: str = "per_device"  # per_device, per_gb, per_user
    quantity: int = 1
    storage_quota_gb: Optional[float] = None
    storage_used_gb: Optional[float] = None
    expiry_date: Optional[str] = None
    last_backup: Optional[datetime] = None
    backup_status: str = "unknown"  # success, warning, failed, unknown
    synced_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== LEADS / CRM MODELS ==============

class LeadCreate(BaseModel):
    company_name: str
    contact_name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    source: str = "website"  # website, referral, cold_call, marketing, other
    industry: Optional[str] = None
    employee_count: Optional[str] = None
    estimated_value: float = 0.0
    notes: Optional[str] = None
    assigned_to: Optional[str] = None

class Lead(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_name: str
    contact_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    source: str = "website"
    industry: Optional[str] = None
    employee_count: Optional[str] = None
    estimated_value: float = 0.0
    status: str = "new"  # new, contacted, qualified, proposal, negotiation, won, lost
    pipeline_stage: int = 1  # 1-6 corresponding to status
    notes: Optional[str] = None
    assigned_to: Optional[str] = None
    assigned_name: Optional[str] = None
    converted_to_client: Optional[str] = None  # client_id if converted
    last_contact: Optional[datetime] = None
    next_follow_up: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class LeadActivity(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    lead_id: str
    lead_name: Optional[str] = None
    user_id: str
    user_name: Optional[str] = None
    activity_type: str = "note"  # note, call, email, meeting, task
    subject: str
    description: Optional[str] = None
    outcome: Optional[str] = None  # positive, negative, neutral, pending
    scheduled_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Proposal(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    proposal_number: str = Field(default_factory=lambda: f"PROP-{datetime.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:4].upper()}")
    lead_id: Optional[str] = None
    lead_name: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    status: str = "draft"  # draft, sent, viewed, accepted, rejected, expired
    valid_until: Optional[str] = None
    line_items: List[Dict[str, Any]] = []
    subtotal: float = 0.0
    discount_percent: float = 0.0
    discount_amount: float = 0.0
    tax_percent: float = 0.0
    tax_amount: float = 0.0
    total: float = 0.0
    terms_and_conditions: Optional[str] = None
    created_by: Optional[str] = None
    sent_at: Optional[datetime] = None
    viewed_at: Optional[datetime] = None
    responded_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== PROXMOX INTEGRATION MODELS ==============

class ProxmoxServer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    host: str
    port: int = 8006
    username: str
    token_name: Optional[str] = None
    token_value: Optional[str] = None  # API token
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    node_name: Optional[str] = None
    status: str = "unknown"  # online, offline, unknown
    last_check: Optional[datetime] = None
    ssl_verify: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ProxmoxVM(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    server_id: str
    server_name: Optional[str] = None
    vmid: int
    name: str
    vm_type: str = "qemu"  # qemu, lxc
    status: str = "unknown"  # running, stopped, paused, unknown
    node: str
    cpu_usage: float = 0.0
    memory_usage: float = 0.0
    memory_total: int = 0
    disk_usage: float = 0.0
    uptime: int = 0
    ip_address: Optional[str] = None
    os_type: Optional[str] = None
    last_backup: Optional[datetime] = None
    backup_status: str = "unknown"
    client_id: Optional[str] = None
    last_sync: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== WARRANTY & LICENSE TRACKING ==============

class WarrantyEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    device_id: Optional[str] = None
    device_name: Optional[str] = None
    asset_id: Optional[str] = None
    asset_name: Optional[str] = None
    vendor: str
    product_name: str
    serial_number: Optional[str] = None
    purchase_date: Optional[str] = None
    warranty_start: str
    warranty_end: str
    warranty_type: str = "standard"  # standard, extended, premium
    coverage_details: Optional[str] = None
    support_phone: Optional[str] = None
    support_url: Optional[str] = None
    status: str = "active"  # active, expiring_soon, expired
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SoftwareLicense(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    software_name: str
    vendor: str
    license_key: Optional[str] = None
    license_type: str = "perpetual"  # perpetual, subscription, volume, oem
    seats: int = 1
    seats_used: int = 0
    purchase_date: Optional[str] = None
    expiry_date: Optional[str] = None
    renewal_cost: float = 0.0
    assigned_devices: List[str] = []
    assigned_users: List[str] = []
    status: str = "active"  # active, expiring_soon, expired
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== DOMAIN & SSL MONITORING ==============

class DomainEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    domain_name: str
    registrar: Optional[str] = None
    registration_date: Optional[str] = None
    expiry_date: str
    auto_renew: bool = True
    dns_provider: Optional[str] = None
    nameservers: List[str] = []
    status: str = "active"  # active, expiring_soon, expired
    notes: Optional[str] = None
    last_check: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SSLCertificate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    domain: str
    issuer: Optional[str] = None
    issued_date: Optional[str] = None
    expiry_date: str
    certificate_type: str = "DV"  # DV, OV, EV, Wildcard
    auto_renew: bool = False
    provider: Optional[str] = None
    status: str = "valid"  # valid, expiring_soon, expired, invalid
    last_check: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== VENDOR MANAGEMENT ==============

class Vendor(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    category: str = "general"  # hardware, software, cloud, telecom, security, other
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    account_number: Optional[str] = None
    account_manager: Optional[str] = None
    support_phone: Optional[str] = None
    support_email: Optional[str] = None
    support_portal: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== NETWORK MONITORING ==============

class NetworkScan(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    site_id: Optional[str] = None
    site_name: Optional[str] = None
    subnet: str
    scan_type: str = "ping"  # ping, port, full
    discovered_hosts: int = 0
    new_devices: int = 0
    status: str = "completed"  # pending, running, completed, failed
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    results: List[Dict[str, Any]] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== YEASTAR PBX MODELS ==============

class YeastarServer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    host: str
    port: int = 443
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    model: Optional[str] = None  # P550, P560, P570, S20, S50, S100, etc.
    firmware_version: Optional[str] = None
    status: str = "unknown"  # online, offline, unknown
    last_check: Optional[datetime] = None
    extensions_count: int = 0
    trunks_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class YeastarExtension(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    server_id: str
    server_name: Optional[str] = None
    extension_number: str
    name: str
    email: Optional[str] = None
    status: str = "unknown"  # registered, unregistered, ringing, in_call, dnd
    device_type: Optional[str] = None  # IP Phone, Softphone, WebRTC
    ip_address: Optional[str] = None
    last_call: Optional[datetime] = None
    call_duration_today: int = 0  # seconds
    client_id: Optional[str] = None
    last_sync: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class YeastarCallLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    server_id: str
    call_id: Optional[str] = None
    caller: str
    caller_name: Optional[str] = None
    callee: str
    callee_name: Optional[str] = None
    direction: str = "inbound"  # inbound, outbound, internal
    status: str = "answered"  # answered, missed, voicemail, busy, failed
    start_time: datetime
    answer_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    duration: int = 0  # seconds
    recording_url: Optional[str] = None
    trunk_name: Optional[str] = None
    client_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== TICKET EMAIL MODELS ==============

class TicketEmailCreate(BaseModel):
    to_addresses: List[str]
    cc_addresses: List[str] = []
    subject: Optional[str] = None  # If None, uses ticket title
    body: str
    body_type: str = "html"

class TicketEmail(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ticket_id: str
    ticket_title: Optional[str] = None
    message_id: Optional[str] = None  # External email message ID
    conversation_id: Optional[str] = None  # For email threading
    direction: str = "outbound"  # inbound, outbound
    from_address: str
    from_name: Optional[str] = None
    to_addresses: List[str] = []
    cc_addresses: List[str] = []
    subject: str
    body: str
    body_type: str = "html"
    status: str = "sent"  # draft, sent, failed, received
    client_id: Optional[str] = None
    user_id: Optional[str] = None  # Technician who sent
    user_name: Optional[str] = None
    sent_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== SCRIPTING / AUTOMATION MODELS ==============

class ScriptCreate(BaseModel):
    name: str
    description: Optional[str] = None
    script_type: str = "powershell"  # powershell, bash, python, batch
    content: str
    category: str = "general"  # general, maintenance, security, monitoring, remediation
    os_target: str = "windows"  # windows, macos, linux, cross_platform
    run_as_admin: bool = True
    timeout_seconds: int = 300
    parameters: List[Dict[str, Any]] = []  # Script parameters

class Script(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    script_type: str = "powershell"
    content: str
    category: str = "general"
    os_target: str = "windows"
    run_as_admin: bool = True
    timeout_seconds: int = 300
    parameters: List[Dict[str, Any]] = []
    is_built_in: bool = False
    # Curated library provenance makes pack installation reversible without
    # touching scripts authored or customised by a technician.
    library_pack_ids: List[str] = []
    library_template_name: Optional[str] = None
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    run_count: int = 0
    last_run: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ScriptExecution(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    script_id: str
    script_name: Optional[str] = None
    device_id: str
    device_name: Optional[str] = None
    client_id: Optional[str] = None
    user_id: str
    user_name: Optional[str] = None
    status: str = "pending"  # pending, running, completed, failed, timeout
    exit_code: Optional[int] = None
    output: Optional[str] = None
    error_output: Optional[str] = None
    parameters_used: Dict[str, Any] = {}
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ScheduledTask(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    script_id: str
    script_name: Optional[str] = None
    target_type: str = "device"  # device, device_group, policy, all
    target_ids: List[str] = []
    schedule_type: str = "once"  # once, daily, weekly, monthly
    schedule_time: str = "09:00"
    schedule_days: List[int] = []  # For weekly: 0-6 (Mon-Sun), for monthly: 1-31
    timezone: str = "UTC"
    enabled: bool = True
    next_run: Optional[datetime] = None
    last_run: Optional[datetime] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== PATCH MANAGEMENT MODELS ==============

class PatchPolicy(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    auto_approve: bool = False
    approval_delay_days: int = 7
    include_categories: List[str] = ["Security", "Critical"]  # Security, Critical, Definition, Feature, Service
    exclude_kbs: List[str] = []
    maintenance_window_start: str = "02:00"
    maintenance_window_end: str = "06:00"
    reboot_behavior: str = "schedule"  # immediate, schedule, user_choice, suppress
    schedule_reboot_time: str = "03:00"
    enabled: bool = True
    target_device_groups: List[str] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DevicePatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    device_name: Optional[str] = None
    client_id: Optional[str] = None
    kb_number: str
    title: str
    description: Optional[str] = None
    category: str = "Security"
    severity: str = "Important"  # Critical, Important, Moderate, Low
    size_mb: Optional[float] = None
    status: str = "available"  # available, approved, downloading, installing, installed, failed, hidden
    release_date: Optional[str] = None
    installed_date: Optional[datetime] = None
    error_message: Optional[str] = None
    reboot_required: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== POLICY MANAGEMENT MODELS ==============

class DeviceGroup(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    client_id: Optional[str] = None  # None = global group
    client_name: Optional[str] = None
    auto_assign_rules: List[Dict[str, Any]] = []  # e.g., {"field": "os", "operator": "contains", "value": "Windows"}
    device_count: int = 0
    policies_applied: List[str] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Policy(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    policy_type: str = "monitoring"  # monitoring, security, maintenance, backup, custom
    enabled: bool = True
    priority: int = 100  # Lower = higher priority
    settings: Dict[str, Any] = {}  # Policy-specific settings
    scripts_to_run: List[str] = []  # Script IDs to execute
    alert_thresholds: Dict[str, Any] = {}  # e.g., {"cpu_percent": 90, "disk_percent": 85}
    target_groups: List[str] = []  # DeviceGroup IDs
    target_os: List[str] = ["windows", "macos", "linux"]
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== IT DOCUMENTATION MODELS ==============

class PasswordEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    name: str
    category: str = "general"  # general, server, network, cloud, application, other
    username: Optional[str] = None
    password: str  # Should be encrypted in production
    url: Optional[str] = None
    notes: Optional[str] = None
    otp_secret: Optional[str] = None  # For TOTP
    tags: List[str] = []
    last_accessed: Optional[datetime] = None
    access_count: int = 0
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DocumentationPage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: Optional[str] = None  # None = global documentation
    client_name: Optional[str] = None
    title: str
    content: str  # Markdown content
    category: str = "general"  # general, network, procedures, contacts, licenses, other
    parent_id: Optional[str] = None  # For hierarchical docs
    is_template: bool = False
    tags: List[str] = []
    last_edited_by: Optional[str] = None
    last_edited_by_name: Optional[str] = None
    view_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class NetworkDiagram(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    name: str
    description: Optional[str] = None
    diagram_type: str = "network"  # network, rack, floor_plan, topology
    diagram_data: Dict[str, Any] = {}  # JSON data for rendering
    thumbnail_url: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== RUNBOOK / WORKFLOW MODELS ==============

class Runbook(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    category: str = "remediation"  # remediation, maintenance, onboarding, offboarding, security
    trigger_type: str = "manual"  # manual, alert, schedule, webhook
    trigger_conditions: Dict[str, Any] = {}  # Conditions for auto-trigger
    steps: List[Dict[str, Any]] = []  # Ordered steps with actions
    enabled: bool = True
    created_by: Optional[str] = None
    run_count: int = 0
    last_run: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class RunbookExecution(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    runbook_id: str
    runbook_name: Optional[str] = None
    triggered_by: str = "manual"  # manual, alert, schedule
    trigger_context: Dict[str, Any] = {}  # e.g., alert details
    device_id: Optional[str] = None
    client_id: Optional[str] = None
    user_id: Optional[str] = None
    status: str = "running"  # running, completed, failed, cancelled
    current_step: int = 0
    step_results: List[Dict[str, Any]] = []
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None

# ============== CUSTOMER PORTAL MODELS ==============

class PortalUser(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    email: str
    password_hash: str
    name: str
    phone: Optional[str] = None
    role: str = "user"  # user, admin (client admin)
    is_primary_contact: bool = False
    can_view_all_tickets: bool = False
    can_create_tickets: bool = True
    can_view_assets: bool = True
    can_view_invoices: bool = False
    last_login: Optional[datetime] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PortalSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    portal_user_id: str
    client_id: Optional[str] = None
    token: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime

# ============== PROJECT MANAGEMENT MODELS ==============

class Project(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    status: str = "planning"  # planning, in_progress, on_hold, completed, cancelled
    priority: str = "medium"
    start_date: Optional[str] = None
    target_end_date: Optional[str] = None
    actual_end_date: Optional[str] = None
    budget_hours: Optional[float] = None
    spent_hours: float = 0.0
    project_manager: Optional[str] = None
    project_manager_name: Optional[str] = None
    team_members: List[str] = []
    tags: List[str] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ProjectTask(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    project_id: str
    project_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    status: str = "todo"  # todo, in_progress, review, completed
    priority: str = "medium"
    assigned_to: Optional[str] = None
    assigned_name: Optional[str] = None
    estimated_hours: Optional[float] = None
    actual_hours: float = 0.0
    due_date: Optional[str] = None
    completed_at: Optional[datetime] = None
    dependencies: List[str] = []  # Task IDs this depends on
    order: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== AUDIT LOG MODEL ==============

class AuditLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    action: str  # create, update, delete, login, logout, view, export, etc.
    entity_type: str  # ticket, device, client, user, etc.
    entity_id: Optional[str] = None
    entity_name: Optional[str] = None
    changes: Dict[str, Any] = {}  # {"field": {"old": x, "new": y}}
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== TECHNICIAN SCHEDULING MODELS ==============

class TechnicianSchedule(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    user_name: Optional[str] = None
    date: str  # YYYY-MM-DD
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    event_type: str = "available"  # available, appointment, pto, on_call, blocked
    title: Optional[str] = None
    description: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    ticket_id: Optional[str] = None
    location: Optional[str] = None
    is_recurring: bool = False
    recurrence_rule: Optional[str] = None  # RRULE format
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class OnCallRotation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    rotation_type: str = "weekly"  # daily, weekly, custom
    team_members: List[str] = []  # User IDs in rotation order
    current_index: int = 0
    rotation_start_day: int = 0  # 0 = Monday
    rotation_start_time: str = "08:00"
    escalation_timeout_minutes: int = 30
    enabled: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== CUSTOM FIELDS MODEL ==============

class CustomFieldDefinition(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    entity_type: str  # ticket, device, client, asset, etc.
    field_name: str
    field_label: str
    field_type: str = "text"  # text, number, date, dropdown, checkbox, url, email
    dropdown_options: List[str] = []
    is_required: bool = False
    is_visible_portal: bool = False
    default_value: Optional[str] = None
    order: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== WEBHOOK MODEL ==============

class Webhook(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    url: str
    secret: Optional[str] = None  # For signature verification
    events: List[str] = []  # ticket.created, device.alert, etc.
    is_active: bool = True
    headers: Dict[str, str] = {}
    last_triggered: Optional[datetime] = None
    last_status: Optional[int] = None
    failure_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== SITE / LOCATION MODEL ==============

class Site(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: str = "USA"
    phone: Optional[str] = None
    is_primary: bool = False
    timezone: str = "America/New_York"
    notes: Optional[str] = None
    device_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ============== VENDOR MODELS ==============

class VendorCreate(BaseModel):
    name: str
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = "Australia"
    postal_code: Optional[str] = None
    abn: Optional[str] = None
    tax_id: Optional[str] = None
    payment_terms: str = "Net 30"
    website: Optional[str] = None
    notes: Optional[str] = None
    category: str = "general"  # general, hardware, software, telecom, networking

class Vendor(VendorCreate):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    is_active: bool = True
    total_orders: int = 0
    total_spent: float = 0.0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== RENTAL MODELS ==============

YEALINK_MODELS = [
    "Yealink T31G", "Yealink T33G", "Yealink T43U", "Yealink T46U", "Yealink T48U",
    "Yealink T53W", "Yealink T54W", "Yealink T57W", "Yealink T58W",
    "Yealink CP920", "Yealink CP960", "Yealink CP965",
    "Yealink W73H", "Yealink W76H", "Yealink W70B", "Yealink W80B",
    "Yealink MP50", "Yealink MP54", "Yealink MP56", "Yealink MP58",
    "Yealink VP59", "Yealink SIP-T19P E2", "Other"
]

class RentalDeviceCreate(BaseModel):
    model_name: str  # Yealink model
    serial_number: str
    mac_address: Optional[str] = None
    imei: Optional[str] = None
    firmware_version: Optional[str] = None
    condition: str = "new"  # new, excellent, good, fair, damaged
    notes: Optional[str] = None

class RentalDevice(RentalDeviceCreate):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: str = "available"  # available, rented, sold, returned, decommissioned
    current_rental_id: Optional[str] = None
    current_client_id: Optional[str] = None
    current_client_name: Optional[str] = None
    purchase_price: float = 0.0
    purchase_date: Optional[str] = None
    vendor_id: Optional[str] = None
    vendor_name: Optional[str] = None
    warranty_expiry: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class RentalAgreementCreate(BaseModel):
    client_id: Optional[str] = None
    device_id: str
    agreement_type: str = "rental"  # rental, buy_outright, lease_to_own
    start_date: str
    end_date: Optional[str] = None
    # Pricing
    device_cost: float = 0.0
    deposit_amount: float = 0.0
    monthly_amount: float = 0.0
    total_payments: int = 0  # Number of monthly payments (0 for buy outright)
    # SLA
    sla_contract_id: Optional[str] = None
    notes: Optional[str] = None

class RentalAgreement(RentalAgreementCreate):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: Optional[str] = None
    device_model: Optional[str] = None
    device_serial: Optional[str] = None
    device_mac: Optional[str] = None
    status: str = "active"  # active, completed, overdue, cancelled, returned
    payments_made: int = 0
    amount_paid: float = 0.0
    deposit_paid: bool = False
    next_payment_date: Optional[str] = None
    payment_history: list = Field(default_factory=list)
    return_condition: Optional[str] = None
    return_date: Optional[str] = None
    return_notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== TICKET CATEGORY MODELS ==============

class TicketCategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = "#3b82f6"
    sort_order: int = 0

class TicketCategory(TicketCategoryCreate):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    is_active: bool = True
    issue_types: list = Field(default_factory=list)  # [{id, name, description, priority}]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
