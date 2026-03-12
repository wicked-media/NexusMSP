from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import httpx
import barcode
from barcode.writer import SVGWriter
from io import BytesIO
import base64

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'nexusops-secret-key-change-in-production')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Pax8 Configuration
PAX8_API_URL = "https://api.pax8.com/v1"
PAX8_AUTH_URL = "https://login.pax8.com/oauth/token"

app = FastAPI(title="NexusOps API", version="2.0.0")
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ============== MODELS ==============

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "technician"

class UserLogin(BaseModel):
    email: EmailStr
    password: str

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
    is_active: bool = True
    is_admin: bool = False
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
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class TicketCreate(BaseModel):
    title: str
    description: str
    client_id: str
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

class Ticket(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ticket_number: Optional[str] = None
    title: str
    description: str
    client_id: str
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
    tags: List[str] = []
    cc: List[str] = []
    watchers: List[str] = []
    merged_into: Optional[str] = None
    contact_id: Optional[str] = None
    custom_fields: Dict[str, Any] = {}
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DeviceCreate(BaseModel):
    name: str
    client_id: str
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
    name: str
    client_id: str
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
    last_reboot: Optional[str] = None
    agent_version: Optional[str] = None
    antivirus: Optional[str] = None
    antivirus_status: Optional[str] = None
    firewall_enabled: Optional[bool] = True
    edr_status: Optional[str] = None
    encryption_status: Optional[str] = None
    compliance_score: Optional[int] = None
    patch_status: Optional[str] = None
    pending_patches: Optional[int] = 0
    installed_software_count: Optional[int] = 0
    tags: List[str] = []
    notes: Optional[str] = None
    rustdesk_id: Optional[str] = None
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
    client_id: str
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
    client_id: str
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
    client_id: str
    client_name: Optional[str] = None
    alert_type: str
    severity: str = "warning"
    message: str
    status: str = "active"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============== NEW MODELS ==============

class ContractCreate(BaseModel):
    client_id: str
    name: str
    contract_type: str = "managed_services"
    billing_frequency: str = "monthly"
    start_date: str
    end_date: Optional[str] = None
    value: float = 0.0
    auto_renew: bool = True
    notes: Optional[str] = None

class Contract(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: str
    client_name: Optional[str] = None
    name: str
    contract_type: str = "managed_services"
    billing_frequency: str = "monthly"
    start_date: str
    end_date: Optional[str] = None
    value: float = 0.0
    auto_renew: bool = True
    status: str = "active"
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class LineItemCreate(BaseModel):
    contract_id: str
    client_id: str
    name: str
    description: Optional[str] = None
    quantity: int = 1
    unit_price: float = 0.0
    billing_frequency: str = "monthly"
    pax8_subscription_id: Optional[str] = None
    pax8_product_id: Optional[str] = None

class LineItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    contract_id: str
    client_id: str
    client_name: Optional[str] = None
    name: str
    description: Optional[str] = None
    quantity: int = 1
    unit_price: float = 0.0
    total: float = 0.0
    billing_frequency: str = "monthly"
    pax8_subscription_id: Optional[str] = None
    pax8_product_id: Optional[str] = None
    synced_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class InvoiceCreate(BaseModel):
    client_id: str
    contract_id: Optional[str] = None
    due_date: str
    notes: Optional[str] = None
    line_items: List[Dict[str, Any]] = []
    tax_rate: float = 0.0
    is_recurring: bool = False
    recurring_interval: str = "monthly"
    recurring_start_date: Optional[str] = None
    recurring_end_date: Optional[str] = None

class Invoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    invoice_number: str = Field(default_factory=lambda: f"INV-{datetime.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:4].upper()}")
    client_id: str
    client_name: Optional[str] = None
    contract_id: Optional[str] = None
    status: str = "draft"
    payment_status: str = "unpaid"
    subtotal: float = 0.0
    tax: float = 0.0
    tax_rate: float = 0.0
    total: float = 0.0
    amount_paid: float = 0.0
    due_date: str
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
    client_id: str
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
    client_id: str
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
    client_id: str
    client_name: Optional[str] = None
    user_id: str
    user_name: Optional[str] = None
    session_type: str = "remote_desktop"  # remote_desktop, terminal, file_transfer
    status: str = "active"  # active, ended, failed
    rustdesk_id: Optional[str] = None
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
    client_id: str
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
    client_id: str
    client_secret: str

class AcronisSubscription(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    external_id: Optional[str] = None  # Acronis subscription ID
    client_id: str
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
    client_id: str
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
    client_id: str
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
    client_id: str
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
    client_id: str
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
    client_id: str
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
    client_id: str
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
    client_id: str
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
    client_id: str
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
    client_id: str
    token: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime

# ============== PROJECT MANAGEMENT MODELS ==============

class Project(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    client_id: str
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
    client_id: str
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

# ============== AUTH HELPERS ==============

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ============== PAX8 SERVICE ==============

class Pax8Service:
    def __init__(self):
        self.access_token = None
        self.token_expiry = None

    async def get_credentials(self):
        settings = await db.settings.find_one({"type": "pax8"}, {"_id": 0})
        if not settings:
            return None, None
        return settings.get('client_id'), settings.get('client_secret')

    async def authenticate(self):
        client_id, client_secret = await self.get_credentials()
        if not client_id or not client_secret:
            raise HTTPException(status_code=400, detail="Pax8 credentials not configured")

        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                PAX8_AUTH_URL,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "audience": "api://p8p.client",
                    "grant_type": "client_credentials"
                }
            )
            if response.status_code != 200:
                raise HTTPException(status_code=401, detail="Pax8 authentication failed")
            
            data = response.json()
            self.access_token = data['access_token']
            self.token_expiry = datetime.now(timezone.utc) + timedelta(seconds=data.get('expires_in', 86400))
            return self.access_token

    async def get_token(self):
        if not self.access_token or (self.token_expiry and datetime.now(timezone.utc) >= self.token_expiry):
            await self.authenticate()
        return self.access_token

    async def get_subscriptions(self, company_id: Optional[str] = None):
        token = await self.get_token()
        url = f"{PAX8_API_URL}/subscriptions"
        if company_id:
            url += f"?companyId={company_id}"
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                url,
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to fetch Pax8 subscriptions")
            return response.json()

    async def get_products(self, page: int = 0, size: int = 50):
        token = await self.get_token()
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                f"{PAX8_API_URL}/products?page={page}&size={size}",
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to fetch Pax8 products")
            return response.json()

    async def get_companies(self, page: int = 0, size: int = 50):
        token = await self.get_token()
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                f"{PAX8_API_URL}/companies?page={page}&size={size}",
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to fetch Pax8 companies")
            return response.json()

pax8_service = Pax8Service()

# ============== DOMOTZ SERVICE ==============

class DomotzService:
    def __init__(self):
        self.api_key = None
        self.api_url = None

    async def get_credentials(self):
        settings = await db.settings.find_one({"type": "domotz"}, {"_id": 0})
        if not settings:
            return None, None
        return settings.get('api_key'), settings.get('api_url')

    async def _request(self, endpoint: str, method: str = "GET", data: dict = None):
        api_key, api_url = await self.get_credentials()
        if not api_key or not api_url:
            raise HTTPException(status_code=400, detail="Domotz credentials not configured")

        headers = {
            "X-Api-Key": api_key,
            "Accept": "application/json",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=30.0) as http_client:
            url = f"{api_url.rstrip('/')}{endpoint}"
            if method == "GET":
                response = await http_client.get(url, headers=headers)
            elif method == "POST":
                response = await http_client.post(url, headers=headers, json=data)
            elif method == "PUT":
                response = await http_client.put(url, headers=headers, json=data)
            else:
                response = await http_client.delete(url, headers=headers)
            
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=f"Domotz API error: {response.text}")
            return response.json() if response.text else {}

    async def get_agents(self, page: int = 0, page_size: int = 50):
        return await self._request(f"/agent?page_number={page}&page_size={page_size}")

    async def get_agent(self, agent_id: int):
        return await self._request(f"/agent/{agent_id}")

    async def get_agent_devices(self, agent_id: int, page: int = 0, page_size: int = 100):
        return await self._request(f"/agent/{agent_id}/device?page_number={page}&page_size={page_size}")

    async def get_device(self, agent_id: int, device_id: int):
        return await self._request(f"/agent/{agent_id}/device/{device_id}")

    async def get_device_details(self, agent_id: int, device_id: int):
        return await self._request(f"/agent/{agent_id}/device/{device_id}/detail")

    async def get_device_power_actions(self, agent_id: int, device_id: int):
        return await self._request(f"/agent/{agent_id}/device/{device_id}/power")

    async def execute_power_action(self, agent_id: int, device_id: int, action: str):
        return await self._request(f"/agent/{agent_id}/device/{device_id}/power/{action}", method="POST")

    async def get_network_stats(self, agent_id: int):
        return await self._request(f"/agent/{agent_id}/network/speed")

    async def get_alerts(self, agent_id: int = None):
        if agent_id:
            return await self._request(f"/agent/{agent_id}/alert")
        return await self._request("/alert")

domotz_service = DomotzService()

# ============== OFFICE 365 SERVICE ==============

class Office365Service:
    def __init__(self):
        self.access_token = None
        self.token_expiry = None

    async def get_credentials(self):
        settings = await db.settings.find_one({"type": "office365"}, {"_id": 0})
        if not settings:
            return None, None, None, None
        return (
            settings.get('tenant_id'),
            settings.get('client_id'),
            settings.get('client_secret'),
            settings.get('redirect_uri')
        )

    async def authenticate(self):
        tenant_id, client_id, client_secret, _ = await self.get_credentials()
        if not all([tenant_id, client_id, client_secret]):
            raise HTTPException(status_code=400, detail="Office 365 credentials not configured")

        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "scope": "https://graph.microsoft.com/.default",
                    "grant_type": "client_credentials"
                }
            )
            if response.status_code != 200:
                raise HTTPException(status_code=401, detail="Office 365 authentication failed")
            
            data = response.json()
            self.access_token = data['access_token']
            self.token_expiry = datetime.now(timezone.utc) + timedelta(seconds=data.get('expires_in', 3600))
            return self.access_token

    async def get_token(self):
        if not self.access_token or (self.token_expiry and datetime.now(timezone.utc) >= self.token_expiry):
            await self.authenticate()
        return self.access_token

    async def send_email(self, from_address: str, to_addresses: List[str], subject: str, body: str, body_type: str = "html"):
        token = await self.get_token()
        
        email_payload = {
            "message": {
                "subject": subject,
                "body": {
                    "contentType": body_type.capitalize(),
                    "content": body
                },
                "toRecipients": [{"emailAddress": {"address": addr}} for addr in to_addresses]
            },
            "saveToSentItems": True
        }

        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                f"https://graph.microsoft.com/v1.0/users/{from_address}/sendMail",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=email_payload
            )
            if response.status_code not in [200, 202]:
                raise HTTPException(status_code=response.status_code, detail=f"Failed to send email: {response.text}")
            return {"success": True}

    async def get_messages(self, user_email: str, folder: str = "inbox", top: int = 50):
        token = await self.get_token()
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                f"https://graph.microsoft.com/v1.0/users/{user_email}/mailFolders/{folder}/messages?$top={top}&$orderby=receivedDateTime desc",
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to fetch messages")
            return response.json()

office365_service = Office365Service()

# ============== ACRONIS SERVICE ==============

class AcronisService:
    def __init__(self):
        self.access_token = None
        self.token_expiry = None

    async def get_credentials(self):
        settings = await db.settings.find_one({"type": "acronis"}, {"_id": 0})
        if not settings:
            return None, None, None
        return settings.get('api_url'), settings.get('client_id'), settings.get('client_secret')

    async def authenticate(self):
        api_url, client_id, client_secret = await self.get_credentials()
        if not all([api_url, client_id, client_secret]):
            raise HTTPException(status_code=400, detail="Acronis credentials not configured")

        import base64
        credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()

        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                f"{api_url}/api/2/idp/token",
                headers={"Authorization": f"Basic {credentials}"},
                data={"grant_type": "client_credentials"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=401, detail="Acronis authentication failed")
            
            data = response.json()
            self.access_token = data['access_token']
            self.token_expiry = datetime.now(timezone.utc) + timedelta(seconds=data.get('expires_in', 7200))
            return self.access_token

    async def get_token(self):
        if not self.access_token or (self.token_expiry and datetime.now(timezone.utc) >= self.token_expiry):
            await self.authenticate()
        return self.access_token

    async def get_tenants(self):
        token = await self.get_token()
        api_url, _, _ = await self.get_credentials()
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                f"{api_url}/api/2/tenants",
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to fetch tenants")
            return response.json()

    async def get_clients(self, tenant_id: str = None):
        token = await self.get_token()
        api_url, _, _ = await self.get_credentials()
        
        url = f"{api_url}/api/2/clients"
        if tenant_id:
            url += f"?tenant_id={tenant_id}"
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(url, headers={"Authorization": f"Bearer {token}"})
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to fetch clients")
            return response.json()

    async def get_resources(self, client_id: str = None):
        token = await self.get_token()
        api_url, _, _ = await self.get_credentials()
        
        url = f"{api_url}/api/resource_management/v4/resources"
        if client_id:
            url += f"?client_id={client_id}"
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(url, headers={"Authorization": f"Bearer {token}"})
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to fetch resources")
            return response.json()

    async def get_backup_status(self, resource_id: str):
        token = await self.get_token()
        api_url, _, _ = await self.get_credentials()
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                f"{api_url}/api/resource_management/v4/resources/{resource_id}/status",
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.status_code != 200:
                return {"status": "unknown"}
            return response.json()

acronis_service = AcronisService()

# ============== AUTH ENDPOINTS ==============

@api_router.post("/auth/register")
async def register(user_data: UserCreate):
    existing = await db.users.find_one({"email": user_data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user = User(
        email=user_data.email,
        name=user_data.name,
        role=user_data.role,
        avatar=f"https://api.dicebear.com/7.x/initials/svg?seed={user_data.name}"
    )
    doc = user.model_dump()
    doc['password_hash'] = hash_password(user_data.password)
    doc['created_at'] = doc['created_at'].isoformat()
    await db.users.insert_one(doc)
    
    token = create_token(user.id, user.email, user.role)
    return {"token": token, "user": user.model_dump()}

@api_router.post("/auth/login")
async def login(credentials: UserLogin):
    user_doc = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user_doc or not verify_password(credentials.password, user_doc.get('password_hash', '')):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(user_doc['id'], user_doc['email'], user_doc['role'])
    user_doc.pop('password_hash', None)
    return {"token": token, "user": user_doc}

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return current_user

# ============== CLIENTS ENDPOINTS ==============

@api_router.get("/clients", response_model=List[Client])
async def get_clients(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0}).to_list(1000)
    for c in clients:
        if isinstance(c.get('created_at'), str):
            c['created_at'] = datetime.fromisoformat(c['created_at'])
    return clients

@api_router.get("/clients/{client_id}")
async def get_client(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client

@api_router.post("/clients", response_model=Client)
async def create_client(client_data: ClientCreate, current_user: dict = Depends(get_current_user)):
    client = Client(**client_data.model_dump())
    doc = client.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.clients.insert_one(doc)
    return client

@api_router.put("/clients/{client_id}")
async def update_client(client_id: str, client_data: ClientCreate, current_user: dict = Depends(get_current_user)):
    result = await db.clients.update_one({"id": client_id}, {"$set": client_data.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"message": "Client updated"}

@api_router.delete("/clients/{client_id}")
async def delete_client(client_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.clients.delete_one({"id": client_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"message": "Client deleted"}

# ============== TICKETS ENDPOINTS ==============

@api_router.get("/tickets", response_model=List[Ticket])
async def get_tickets(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if priority:
        query["priority"] = priority
    if client_id:
        query["client_id"] = client_id
    
    tickets = await db.tickets.find(query, {"_id": 0}).to_list(1000)
    for t in tickets:
        for field in ['created_at', 'updated_at', 'sla_due']:
            if isinstance(t.get(field), str):
                t[field] = datetime.fromisoformat(t[field])
    return tickets

@api_router.get("/tickets/note-counts")
async def get_ticket_note_counts(current_user: dict = Depends(get_current_user)):
    open_tickets = await db.tickets.find({"status": {"$in": ["open", "in_progress"]}}, {"_id": 0, "id": 1}).to_list(10000)
    result = {}
    for t in open_tickets:
        nc = await db.ticket_comments.count_documents({"ticket_id": t["id"]})
        result[t["id"]] = nc
    return result

@api_router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket

@api_router.post("/tickets", response_model=Ticket)
async def create_ticket(ticket_data: TicketCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": ticket_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    assigned_name = None
    if ticket_data.assigned_to:
        user = await db.users.find_one({"id": ticket_data.assigned_to}, {"_id": 0})
        assigned_name = user['name'] if user else None
    
    sla_hours = {"critical": 2, "high": 4, "medium": 8, "low": 24}
    sla_due = datetime.now(timezone.utc) + timedelta(hours=sla_hours.get(ticket_data.priority, 8))
    
    # Resolve device name
    device_name = None
    if ticket_data.device_id:
        device = await db.devices.find_one({"id": ticket_data.device_id}, {"_id": 0, "name": 1})
        device_name = device['name'] if device else None
    
    # Generate ticket number
    ticket_count = await db.tickets.count_documents({})
    ticket_number = f"TKT-{str(ticket_count + 1).zfill(3)}"
    
    ticket = Ticket(
        **ticket_data.model_dump(),
        ticket_number=ticket_number,
        client_name=client_name,
        assigned_name=assigned_name,
        device_name=device_name,
        sla_due=sla_due
    )
    doc = ticket.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    doc['sla_due'] = doc['sla_due'].isoformat() if doc['sla_due'] else None
    await db.tickets.insert_one(doc)
    await db.clients.update_one({"id": ticket_data.client_id}, {"$inc": {"ticket_count": 1}})
    await _log_activity(current_user, "created", "ticket", ticket.id, ticket.title, f"Created ticket {ticket_number} for {client_name}", metadata={"ticket_number": ticket_number, "client_name": client_name, "priority": ticket_data.priority})
    return ticket

@api_router.put("/tickets/{ticket_id}")
async def update_ticket(ticket_id: str, ticket_data: dict, current_user: dict = Depends(get_current_user)):
    old_ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    ticket_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    # Resolve device name if device_id changed
    if 'device_id' in ticket_data and ticket_data['device_id']:
        device = await db.devices.find_one({"id": ticket_data['device_id']}, {"_id": 0, "name": 1})
        ticket_data['device_name'] = device['name'] if device else None
    elif 'device_id' in ticket_data and not ticket_data['device_id']:
        ticket_data['device_name'] = None
    result = await db.tickets.update_one({"id": ticket_id}, {"$set": ticket_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if old_ticket:
        changes = []
        change_dict = {}
        for k, v in ticket_data.items():
            if k != "updated_at" and old_ticket.get(k) != v:
                changes.append(f"{k}: {old_ticket.get(k)} -> {v}")
                change_dict[k] = {"old": str(old_ticket.get(k)), "new": str(v)}
        if changes:
            await _ticket_audit(ticket_id, current_user, "updated", "; ".join(changes))
            await _log_activity(current_user, "updated", "ticket", ticket_id, old_ticket.get("title", ""), "; ".join(changes), changes=change_dict)
    return {"message": "Ticket updated"}

@api_router.delete("/tickets/{ticket_id}")
async def delete_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if ticket:
        await db.clients.update_one({"id": ticket['client_id']}, {"$inc": {"ticket_count": -1}})
        await _log_activity(current_user, "deleted", "ticket", ticket_id, ticket.get("title", ""), f"Deleted ticket {ticket.get('ticket_number', '')}")
    result = await db.tickets.delete_one({"id": ticket_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {"message": "Ticket deleted"}

# ============== TICKET COMMENTS/NOTES ENDPOINTS ==============

@api_router.get("/tickets/{ticket_id}/comments")
async def get_ticket_comments(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    comments = await db.ticket_comments.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return comments

@api_router.post("/tickets/{ticket_id}/comments")
async def create_ticket_comment(ticket_id: str, comment_data: dict, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    comment = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": current_user['id'],
        "user_name": current_user['name'],
        "content": comment_data.get("content", ""),
        "is_internal": comment_data.get("is_internal", False),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.ticket_comments.insert_one(comment)
    comment.pop("_id", None)
    return comment

# ============== TICKET CHILD/PARENT ENDPOINTS ==============

@api_router.get("/tickets/{ticket_id}/children")
async def get_child_tickets(ticket_id: str, current_user: dict = Depends(get_current_user)):
    children = await db.tickets.find({"parent_id": ticket_id}, {"_id": 0}).to_list(100)
    return children

@api_router.post("/tickets/{ticket_id}/children")
async def create_child_ticket(ticket_id: str, ticket_data: dict, current_user: dict = Depends(get_current_user)):
    parent = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not parent:
        raise HTTPException(status_code=404, detail="Parent ticket not found")
    count = await db.tickets.count_documents({})
    child = Ticket(
        ticket_number=f"TKT-{count + 1:03d}",
        title=ticket_data.get("title", ""),
        description=ticket_data.get("description", ""),
        client_id=parent["client_id"],
        client_name=parent.get("client_name"),
        priority=ticket_data.get("priority", parent.get("priority", "medium")),
        category=parent.get("category", "support"),
        assigned_to=ticket_data.get("assigned_to", parent.get("assigned_to")),
        parent_id=ticket_id,
        tags=ticket_data.get("tags", []),
    )
    child_dict = child.model_dump()
    child_dict["created_at"] = child_dict["created_at"].isoformat()
    child_dict["updated_at"] = child_dict["updated_at"].isoformat()
    if child_dict.get("sla_due"):
        child_dict["sla_due"] = child_dict["sla_due"].isoformat()
    await db.tickets.insert_one(child_dict)
    child_dict.pop("_id", None)
    await _ticket_audit(ticket_id, current_user, "child_created", f"Child ticket {child_dict['ticket_number']} created")
    return child_dict

@api_router.post("/tickets/{ticket_id}/link")
async def link_ticket(ticket_id: str, link_data: dict, current_user: dict = Depends(get_current_user)):
    child_id = link_data.get("child_id")
    if not child_id:
        raise HTTPException(status_code=400, detail="child_id required")
    result = await db.tickets.update_one({"id": child_id}, {"$set": {"parent_id": ticket_id}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Child ticket not found")
    await _ticket_audit(ticket_id, current_user, "ticket_linked", f"Linked ticket {child_id}")
    return {"message": "Tickets linked"}

# ============== TICKET MERGE ENDPOINT ==============

@api_router.post("/tickets/{ticket_id}/merge")
async def merge_tickets(ticket_id: str, merge_data: dict, current_user: dict = Depends(get_current_user)):
    merge_ids = merge_data.get("merge_ids", [])
    if not merge_ids:
        raise HTTPException(status_code=400, detail="merge_ids required")
    target = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Target ticket not found")
    for mid in merge_ids:
        source = await db.tickets.find_one({"id": mid}, {"_id": 0})
        if source:
            await db.tickets.update_one({"id": mid}, {"$set": {"status": "closed", "merged_into": ticket_id}})
            src_comments = await db.ticket_comments.find({"ticket_id": mid}, {"_id": 0}).to_list(500)
            for c in src_comments:
                c["ticket_id"] = ticket_id
                c["content"] = f"[Merged from {source.get('ticket_number', mid)}] {c.get('content', '')}"
                c["id"] = str(uuid.uuid4())
                await db.ticket_comments.insert_one(c)
            await _ticket_audit(ticket_id, current_user, "ticket_merged", f"Merged {source.get('ticket_number', mid)} into this ticket")
    return {"message": f"Merged {len(merge_ids)} tickets"}

# ============== TICKET TIME TRACKING ==============

@api_router.get("/tickets/{ticket_id}/time-entries")
async def get_ticket_time_entries(ticket_id: str, current_user: dict = Depends(get_current_user)):
    entries = await db.ticket_time_entries.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return entries

@api_router.post("/tickets/{ticket_id}/time-entries")
async def add_ticket_time_entry(ticket_id: str, entry_data: dict, current_user: dict = Depends(get_current_user)):
    entry = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "minutes": entry_data.get("minutes", 0),
        "description": entry_data.get("description", ""),
        "billable": entry_data.get("billable", True),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.ticket_time_entries.insert_one(entry)
    entry.pop("_id", None)
    total_min = entry["minutes"]
    existing = await db.ticket_time_entries.find({"ticket_id": ticket_id}, {"_id": 0}).to_list(5000)
    total_min = sum(e.get("minutes", 0) for e in existing)
    await db.tickets.update_one({"id": ticket_id}, {"$set": {"total_time_minutes": total_min}})
    await _ticket_audit(ticket_id, current_user, "time_logged", f"Logged {entry_data.get('minutes',0)} minutes")
    return entry

# ============== TICKET AUDIT LOG ==============

async def _ticket_audit(ticket_id: str, user: dict, action: str, details: str):
    entry = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "action": action,
        "details": details,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.ticket_audit_log.insert_one(entry)

@api_router.get("/tickets/{ticket_id}/audit-log")
async def get_ticket_audit_log(ticket_id: str, current_user: dict = Depends(get_current_user)):
    entries = await db.ticket_audit_log.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return entries

# ============== UNIFIED ACTIVITY LOG ==============

async def _log_activity(user: dict, action: str, entity_type: str, entity_id: str, entity_name: str = "", details: str = "", changes: dict = None, metadata: dict = None):
    """Log activity for cross-entity audit trail. Admin-visible only."""
    entry = {
        "id": str(uuid.uuid4()),
        "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "details": details,
        "changes": changes or {},
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.activity_logs.insert_one(entry)

@api_router.get("/activity-logs")
async def get_activity_logs(
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    technician_id: Optional[str] = None,
    limit: int = 100,
    current_user: dict = Depends(get_current_user)
):
    """Get activity logs (admin only)"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id
    if technician_id:
        query["user_id"] = technician_id
    logs = await db.activity_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return logs

@api_router.get("/activity-logs/entity/{entity_type}/{entity_id}")
async def get_entity_activity_log(entity_type: str, entity_id: str, current_user: dict = Depends(get_current_user)):
    """Get all activity for a specific entity (admin only)"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    logs = await db.activity_logs.find({"entity_type": entity_type, "entity_id": entity_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return logs

@api_router.get("/technicians/{tech_id}/activity")
async def get_technician_activity(tech_id: str, limit: int = 200, current_user: dict = Depends(get_current_user)):
    """Get all activity performed by a technician (admin only)"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    user = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")
    logs = await db.activity_logs.find({"user_id": tech_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    remote_sessions = await db.remote_sessions.find({"user_id": tech_id}, {"_id": 0}).sort("started_at", -1).to_list(200)
    return {
        "technician": {"id": user["id"], "name": user["name"]},
        "activity_logs": logs,
        "remote_sessions": remote_sessions,
    }

# ============== CANNED RESPONSES ==============

@api_router.get("/canned-responses")
async def get_canned_responses(current_user: dict = Depends(get_current_user)):
    responses = await db.canned_responses.find({}, {"_id": 0}).to_list(500)
    return responses

@api_router.post("/canned-responses")
async def create_canned_response(data: dict, current_user: dict = Depends(get_current_user)):
    response = {
        "id": str(uuid.uuid4()),
        "title": data.get("title", ""),
        "content": data.get("content", ""),
        "category": data.get("category", "general"),
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.canned_responses.insert_one(response)
    response.pop("_id", None)
    return response

@api_router.delete("/canned-responses/{response_id}")
async def delete_canned_response(response_id: str, current_user: dict = Depends(get_current_user)):
    await db.canned_responses.delete_one({"id": response_id})
    return {"message": "Deleted"}

# ============== CLIENT CONTACTS ==============

@api_router.get("/clients/{client_id}/contacts")
async def get_client_contacts(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client.get("contacts", [])

@api_router.post("/clients/{client_id}/contacts")
async def add_client_contact(client_id: str, contact_data: dict, current_user: dict = Depends(get_current_user)):
    contact = {
        "id": str(uuid.uuid4()),
        "name": contact_data.get("name", ""),
        "email": contact_data.get("email", ""),
        "phone": contact_data.get("phone", ""),
        "role": contact_data.get("role", "general"),
        "is_primary": contact_data.get("is_primary", False),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.clients.update_one({"id": client_id}, {"$push": {"contacts": contact}})
    return contact

@api_router.put("/clients/{client_id}/contacts/{contact_id}")
async def update_client_contact(client_id: str, contact_id: str, contact_data: dict, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    contacts = client.get("contacts", [])
    for c in contacts:
        if c["id"] == contact_id:
            c.update({k: v for k, v in contact_data.items() if k in ("name", "email", "phone", "role", "is_primary")})
            break
    await db.clients.update_one({"id": client_id}, {"$set": {"contacts": contacts}})
    return {"message": "Contact updated"}

@api_router.delete("/clients/{client_id}/contacts/{contact_id}")
async def delete_client_contact(client_id: str, contact_id: str, current_user: dict = Depends(get_current_user)):
    await db.clients.update_one({"id": client_id}, {"$pull": {"contacts": {"id": contact_id}}})
    return {"message": "Contact deleted"}

@api_router.get("/clients/{client_id}/detail")
async def get_client_detail(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    tickets = await db.tickets.find({"client_id": client_id}, {"_id": 0}).to_list(500)
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0}).to_list(500)
    contracts = await db.contracts.find({"client_id": client_id}, {"_id": 0}).to_list(100)
    return {"client": client, "tickets": tickets, "devices": devices, "contracts": contracts}

# ============== USER UPDATE ENDPOINT ==============

@api_router.put("/users/{user_id}")
async def update_user(user_id: str, user_data: dict, current_user: dict = Depends(get_current_user)):
    allowed_fields = {"name", "email_signature", "hourly_rate", "avatar"}
    update = {k: v for k, v in user_data.items() if k in allowed_fields}
    if not update:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.users.update_one({"id": user_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User updated"}

# ============== DEVICES ENDPOINTS ==============

@api_router.get("/devices", response_model=List[Device])
async def get_devices(
    status: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if client_id:
        query["client_id"] = client_id
    
    devices = await db.devices.find(query, {"_id": 0}).to_list(1000)
    for d in devices:
        for field in ['created_at', 'last_seen']:
            if isinstance(d.get(field), str):
                d[field] = datetime.fromisoformat(d[field])
    return devices

@api_router.get("/devices/{device_id}")
async def get_device(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device

@api_router.post("/devices", response_model=Device)
async def create_device(device_data: DeviceCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": device_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    device = Device(**device_data.model_dump(), client_name=client_name)
    doc = device.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['last_seen'] = doc['last_seen'].isoformat()
    await db.devices.insert_one(doc)
    await db.clients.update_one({"id": device_data.client_id}, {"$inc": {"device_count": 1}})
    await _log_activity(current_user, "created", "device", device.id, device.name, f"Added {device.device_type} '{device.name}' for {client_name}", metadata={"device_type": device.device_type, "client_name": client_name})
    return device

@api_router.put("/devices/{device_id}")
async def update_device(device_id: str, device_data: dict, current_user: dict = Depends(get_current_user)):
    old_device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    result = await db.devices.update_one({"id": device_id}, {"$set": device_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    if old_device:
        change_dict = {}
        for k, v in device_data.items():
            if old_device.get(k) != v:
                change_dict[k] = {"old": str(old_device.get(k)), "new": str(v)}
        if change_dict:
            await _log_activity(current_user, "updated", "device", device_id, old_device.get("name", ""), f"Updated device fields: {', '.join(change_dict.keys())}", changes=change_dict)
    return {"message": "Device updated"}

@api_router.delete("/devices/{device_id}")
async def delete_device(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if device:
        await db.clients.update_one({"id": device['client_id']}, {"$inc": {"device_count": -1}})
        await _log_activity(current_user, "deleted", "device", device_id, device.get("name", ""), f"Deleted device '{device.get('name', '')}'")
    result = await db.devices.delete_one({"id": device_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device deleted"}

@api_router.get("/devices/{device_id}/detail")
async def get_device_detail(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    software = await db.device_software.find({"device_id": device_id}, {"_id": 0}).to_list(500)
    patches = await db.device_patches.find({"device_id": device_id}, {"_id": 0}).sort("installed_date", -1).to_list(100)
    events = await db.device_events.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(100)
    performance = await db.device_performance.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(288)
    alerts = await db.alerts.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    tickets = await db.tickets.find({"device_id": device_id}, {"_id": 0}).to_list(50)
    network_adapters = await db.device_network.find({"device_id": device_id}, {"_id": 0}).to_list(20)
    remote_sessions = await db.remote_sessions.find({"device_id": device_id}, {"_id": 0}).sort("started_at", -1).to_list(50)
    activity_logs = await db.activity_logs.find({"entity_type": "device", "entity_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {
        "device": device,
        "software": software,
        "patches": patches,
        "events": events,
        "performance": performance,
        "alerts": alerts,
        "tickets": tickets,
        "network_adapters": network_adapters,
        "remote_sessions": remote_sessions,
        "activity_logs": activity_logs,
    }

@api_router.get("/devices/{device_id}/software")
async def get_device_software(device_id: str, current_user: dict = Depends(get_current_user)):
    software = await db.device_software.find({"device_id": device_id}, {"_id": 0}).to_list(500)
    return software

@api_router.get("/devices/{device_id}/patches")
async def get_device_patches(device_id: str, current_user: dict = Depends(get_current_user)):
    patches = await db.device_patches.find({"device_id": device_id}, {"_id": 0}).sort("installed_date", -1).to_list(200)
    return patches

@api_router.get("/devices/{device_id}/events")
async def get_device_events(device_id: str, current_user: dict = Depends(get_current_user)):
    events = await db.device_events.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(200)
    return events

@api_router.get("/devices/{device_id}/performance")
async def get_device_performance(device_id: str, current_user: dict = Depends(get_current_user)):
    performance = await db.device_performance.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(288)
    return performance

@api_router.get("/devices/stats/summary")
async def get_devices_stats(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(10000)
    total = len(devices)
    online = len([d for d in devices if d.get("status") == "online"])
    offline = len([d for d in devices if d.get("status") == "offline"])
    warning = len([d for d in devices if d.get("status") == "warning"])
    servers = len([d for d in devices if d.get("device_type") == "server"])
    workstations = len([d for d in devices if d.get("device_type") == "workstation"])
    laptops = len([d for d in devices if d.get("device_type") == "laptop"])
    needs_patching = len([d for d in devices if (d.get("pending_patches") or 0) > 0])
    avg_cpu = sum(d.get("cpu_usage", 0) for d in devices) / max(total, 1)
    avg_ram = sum(d.get("memory_usage", 0) for d in devices) / max(total, 1)
    avg_disk = sum(d.get("disk_usage", 0) for d in devices) / max(total, 1)
    return {
        "total": total, "online": online, "offline": offline, "warning": warning,
        "servers": servers, "workstations": workstations, "laptops": laptops,
        "needs_patching": needs_patching,
        "avg_cpu": round(avg_cpu, 1), "avg_ram": round(avg_ram, 1), "avg_disk": round(avg_disk, 1)
    }


# ============== ASSETS ENDPOINTS ==============

@api_router.get("/assets", response_model=List[Asset])
async def get_assets(
    asset_type: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if asset_type:
        query["asset_type"] = asset_type
    if client_id:
        query["client_id"] = client_id
    
    assets = await db.assets.find(query, {"_id": 0}).to_list(1000)
    for a in assets:
        if isinstance(a.get('created_at'), str):
            a['created_at'] = datetime.fromisoformat(a['created_at'])
    return assets

@api_router.get("/assets/stats")
async def get_asset_stats(current_user: dict = Depends(get_current_user)):
    assets = await db.assets.find({}, {"_id": 0}).to_list(10000)
    total = len(assets)
    active = len([a for a in assets if a.get("status") == "active"])
    total_value = sum(a.get("cost", 0) for a in assets)
    expiring_soon = 0
    expired = 0
    now = datetime.now()
    for a in assets:
        we = a.get("warranty_expiry")
        if we:
            try:
                exp_dt = datetime.strptime(we, "%Y-%m-%d")
                if exp_dt < now:
                    expired += 1
                elif exp_dt < now + timedelta(days=90):
                    expiring_soon += 1
            except:
                pass
    by_type = {}
    for a in assets:
        t = a.get("asset_type", "other")
        by_type[t] = by_type.get(t, 0) + 1
    return {
        "total": total, "active": active, "total_value": round(total_value, 2),
        "warranty_expiring_soon": expiring_soon, "warranty_expired": expired,
        "by_type": by_type
    }

@api_router.get("/assets/expiring")
async def get_expiring_assets(current_user: dict = Depends(get_current_user)):
    assets = await db.assets.find({}, {"_id": 0}).to_list(10000)
    now = datetime.now()
    cutoff = now + timedelta(days=90)
    expiring = []
    for a in assets:
        we = a.get("warranty_expiry")
        if we:
            try:
                exp_dt = datetime.strptime(we, "%Y-%m-%d")
                if exp_dt < cutoff:
                    a["days_remaining"] = (exp_dt - now).days
                    a["is_expired"] = exp_dt < now
                    expiring.append(a)
            except:
                pass
    return sorted(expiring, key=lambda x: x.get("days_remaining", 999))

@api_router.get("/assets/{asset_id}")
async def get_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
    asset = await db.assets.find_one({"id": asset_id}, {"_id": 0})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset

@api_router.post("/assets", response_model=Asset)
async def create_asset(asset_data: AssetCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": asset_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    asset = Asset(**asset_data.model_dump(), client_name=client_name)
    doc = asset.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.assets.insert_one(doc)
    return asset

@api_router.put("/assets/{asset_id}")
async def update_asset(asset_id: str, asset_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.assets.update_one({"id": asset_id}, {"$set": asset_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"message": "Asset updated"}

@api_router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.assets.delete_one({"id": asset_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"message": "Asset deleted"}

# ============== ALERTS ENDPOINTS ==============

@api_router.get("/alerts", response_model=List[Alert])
async def get_alerts(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if severity:
        query["severity"] = severity
    
    alerts = await db.alerts.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    for a in alerts:
        if isinstance(a.get('created_at'), str):
            a['created_at'] = datetime.fromisoformat(a['created_at'])
    return alerts

@api_router.post("/alerts", response_model=Alert)
async def create_alert(alert_data: dict, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": alert_data['device_id']}, {"_id": 0})
    
    alert = Alert(
        device_id=alert_data['device_id'],
        device_name=device['name'] if device else None,
        client_id=alert_data['client_id'],
        client_name=device['client_name'] if device else None,
        alert_type=alert_data['alert_type'],
        severity=alert_data.get('severity', 'warning'),
        message=alert_data['message']
    )
    doc = alert.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.alerts.insert_one(doc)
    await db.devices.update_one({"id": alert_data['device_id']}, {"$inc": {"alerts_count": 1}})
    return alert

@api_router.put("/alerts/{alert_id}")
async def update_alert(alert_id: str, alert_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.alerts.update_one({"id": alert_id}, {"$set": alert_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"message": "Alert updated"}

# ============== CONTRACTS ENDPOINTS ==============

@api_router.get("/contracts", response_model=List[Contract])
async def get_contracts(
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    
    contracts = await db.contracts.find(query, {"_id": 0}).to_list(1000)
    for c in contracts:
        if isinstance(c.get('created_at'), str):
            c['created_at'] = datetime.fromisoformat(c['created_at'])
    return contracts

@api_router.get("/contracts/{contract_id}")
async def get_contract(contract_id: str, current_user: dict = Depends(get_current_user)):
    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    return contract

@api_router.post("/contracts", response_model=Contract)
async def create_contract(contract_data: ContractCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": contract_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    contract = Contract(**contract_data.model_dump(), client_name=client_name)
    doc = contract.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.contracts.insert_one(doc)
    return contract

@api_router.put("/contracts/{contract_id}")
async def update_contract(contract_id: str, contract_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.contracts.update_one({"id": contract_id}, {"$set": contract_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contract not found")
    return {"message": "Contract updated"}

@api_router.delete("/contracts/{contract_id}")
async def delete_contract(contract_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.contracts.delete_one({"id": contract_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contract not found")
    return {"message": "Contract deleted"}

# ============== LINE ITEMS ENDPOINTS ==============

@api_router.get("/line-items", response_model=List[LineItem])
async def get_line_items(
    contract_id: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if contract_id:
        query["contract_id"] = contract_id
    if client_id:
        query["client_id"] = client_id
    
    items = await db.line_items.find(query, {"_id": 0}).to_list(1000)
    for i in items:
        if isinstance(i.get('created_at'), str):
            i['created_at'] = datetime.fromisoformat(i['created_at'])
        if isinstance(i.get('synced_at'), str):
            i['synced_at'] = datetime.fromisoformat(i['synced_at'])
    return items

@api_router.post("/line-items", response_model=LineItem)
async def create_line_item(item_data: LineItemCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": item_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    total = item_data.quantity * item_data.unit_price
    
    item = LineItem(**item_data.model_dump(), client_name=client_name, total=total)
    doc = item.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('synced_at'):
        doc['synced_at'] = doc['synced_at'].isoformat()
    await db.line_items.insert_one(doc)
    return item

@api_router.put("/line-items/{item_id}")
async def update_line_item(item_id: str, item_data: dict, current_user: dict = Depends(get_current_user)):
    if 'quantity' in item_data and 'unit_price' in item_data:
        item_data['total'] = item_data['quantity'] * item_data['unit_price']
    result = await db.line_items.update_one({"id": item_id}, {"$set": item_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Line item not found")
    return {"message": "Line item updated"}

@api_router.delete("/line-items/{item_id}")
async def delete_line_item(item_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.line_items.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Line item not found")
    return {"message": "Line item deleted"}

# ============== INVOICES ENDPOINTS ==============

@api_router.get("/invoices", response_model=List[Invoice])
async def get_invoices(
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for i in invoices:
        if isinstance(i.get('created_at'), str):
            i['created_at'] = datetime.fromisoformat(i['created_at'])
    return invoices

@api_router.get("/invoices/stats/summary")
async def get_invoice_stats(current_user: dict = Depends(get_current_user)):
    all_inv = await db.invoices.find({}, {"_id": 0}).to_list(10000)
    total = len(all_inv)
    paid = len([i for i in all_inv if i.get("payment_status") == "paid"])
    unpaid = len([i for i in all_inv if i.get("payment_status") in ("unpaid", None)])
    overdue_count = 0
    for i in all_inv:
        if i.get("payment_status") not in ("paid",) and i.get("due_date"):
            try:
                due = datetime.strptime(i["due_date"], "%Y-%m-%d")
                if due < datetime.now():
                    overdue_count += 1
            except:
                pass
    total_revenue = sum(i.get("total", 0) for i in all_inv)
    total_collected = sum(i.get("amount_paid", 0) for i in all_inv)
    total_outstanding = total_revenue - total_collected
    return {
        "total": total, "paid": paid, "unpaid": unpaid, "overdue": overdue_count,
        "total_revenue": round(total_revenue, 2), "total_collected": round(total_collected, 2),
        "total_outstanding": round(total_outstanding, 2)
    }

@api_router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice

@api_router.get("/invoices/{invoice_id}/activity-log")
async def get_invoice_activity_log(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Get activity log for a specific invoice (admin only)"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    logs = await db.activity_logs.find({"entity_type": "invoice", "entity_id": invoice_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return logs

@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(invoice_data: InvoiceCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": invoice_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    subtotal = sum(item.get('total', item.get('quantity', 1) * item.get('unit_price', 0)) for item in invoice_data.line_items)
    tax_rate = invoice_data.tax_rate or 0.0
    tax = subtotal * (tax_rate / 100)
    total = subtotal + tax
    
    invoice = Invoice(
        client_id=invoice_data.client_id,
        client_name=client_name,
        contract_id=invoice_data.contract_id,
        due_date=invoice_data.due_date,
        notes=invoice_data.notes,
        line_items=invoice_data.line_items,
        subtotal=subtotal,
        tax=tax,
        tax_rate=tax_rate,
        total=total,
        payment_status="unpaid",
        is_recurring=invoice_data.is_recurring,
        recurring_interval=invoice_data.recurring_interval,
        recurring_start_date=invoice_data.recurring_start_date,
        recurring_end_date=invoice_data.recurring_end_date,
        recurring_next_date=invoice_data.recurring_start_date,
    )
    doc = invoice.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.invoices.insert_one(doc)
    doc.pop("_id", None)
    await _log_activity(current_user, "created", "invoice", invoice.id, invoice.invoice_number, f"Created invoice {invoice.invoice_number} for {client_name}", metadata={"client_name": client_name, "total": total})
    return invoice

@api_router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, invoice_data: dict, current_user: dict = Depends(get_current_user)):
    old_inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    result = await db.invoices.update_one({"id": invoice_id}, {"$set": invoice_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if old_inv:
        change_dict = {}
        for k, v in invoice_data.items():
            if old_inv.get(k) != v:
                change_dict[k] = {"old": str(old_inv.get(k)), "new": str(v)}
        if change_dict:
            await _log_activity(current_user, "updated", "invoice", invoice_id, old_inv.get("invoice_number", ""), f"Updated invoice fields: {', '.join(change_dict.keys())}", changes=change_dict)
    return {"message": "Invoice updated"}

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    old_inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    result = await db.invoices.delete_one({"id": invoice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if old_inv:
        await _log_activity(current_user, "deleted", "invoice", invoice_id, old_inv.get("invoice_number", ""), f"Deleted invoice {old_inv.get('invoice_number', '')}")
    return {"message": "Invoice deleted"}

@api_router.post("/invoices/{invoice_id}/generate-from-contract")
async def generate_invoice_from_contract(invoice_id: str, contract_id: str, current_user: dict = Depends(get_current_user)):
    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    
    line_items = await db.line_items.find({"contract_id": contract_id}, {"_id": 0}).to_list(100)
    
    invoice_lines = [
        {
            "name": item['name'],
            "description": item.get('description', ''),
            "quantity": item['quantity'],
            "unit_price": item['unit_price'],
            "total": item['total']
        }
        for item in line_items
    ]
    
    client = await db.clients.find_one({"id": contract['client_id']}, {"_id": 0})
    subtotal = sum(item['total'] for item in line_items)
    
    invoice = Invoice(
        client_id=contract['client_id'],
        client_name=client['name'] if client else None,
        contract_id=contract_id,
        due_date=(datetime.now(timezone.utc) + timedelta(days=30)).strftime('%Y-%m-%d'),
        line_items=invoice_lines,
        subtotal=subtotal,
        total=subtotal
    )
    doc = invoice.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.invoices.insert_one(doc)
    return invoice

# ============== STRIPE PAYMENT ENDPOINTS ==============

@api_router.post("/invoices/{invoice_id}/pay")
async def create_invoice_payment(invoice_id: str, request_data: dict, current_user: dict = Depends(get_current_user)):
    from fastapi import Request
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Invoice already paid")

    stripe_key = None
    stripe_setting = await db.settings.find_one({"type": "stripe"}, {"_id": 0})
    if stripe_setting and stripe_setting.get("api_key"):
        stripe_key = stripe_setting["api_key"]
    if not stripe_key:
        stripe_key = os.environ.get("STRIPE_API_KEY")
    if not stripe_key:
        raise HTTPException(status_code=500, detail="Stripe not configured. Go to Settings to add your Stripe API key.")

    from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest
    origin_url = request_data.get("origin_url", "")
    webhook_url = f"{origin_url}/api/webhook/stripe"
    stripe_checkout = StripeCheckout(api_key=stripe_key, webhook_url=webhook_url)

    success_url = f"{origin_url}/invoices?payment_success=true&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin_url}/invoices?payment_cancelled=true"

    amount = float(invoice.get("total", 0)) - float(invoice.get("amount_paid", 0))
    checkout_req = CheckoutSessionRequest(
        amount=round(amount, 2),
        currency="usd",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"invoice_id": invoice_id, "invoice_number": invoice.get("invoice_number", "")}
    )
    session = await stripe_checkout.create_checkout_session(checkout_req)

    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "session_id": session.session_id,
        "amount": amount,
        "currency": "usd",
        "payment_status": "initiated",
        "user_id": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"stripe_session_id": session.session_id}})

    return {"url": session.url, "session_id": session.session_id}

@api_router.get("/invoices/{invoice_id}/payment-status")
async def check_payment_status(invoice_id: str, session_id: str, current_user: dict = Depends(get_current_user)):
    stripe_key = None
    stripe_setting = await db.settings.find_one({"type": "stripe"}, {"_id": 0})
    if stripe_setting and stripe_setting.get("api_key"):
        stripe_key = stripe_setting["api_key"]
    if not stripe_key:
        stripe_key = os.environ.get("STRIPE_API_KEY")
    if not stripe_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    from emergentintegrations.payments.stripe.checkout import StripeCheckout
    stripe_checkout = StripeCheckout(api_key=stripe_key, webhook_url="")
    status = await stripe_checkout.get_checkout_status(session_id)

    existing = await db.payment_transactions.find_one({"session_id": session_id, "payment_status": "paid"})
    if existing:
        return {"payment_status": "paid", "already_processed": True}

    if status.payment_status == "paid":
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": "paid", "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
        invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        new_paid = float(invoice.get("amount_paid", 0)) + float(status.amount_total / 100)
        new_payment_status = "paid" if new_paid >= float(invoice.get("total", 0)) else "partial"
        payment_record = {
            "amount": status.amount_total / 100,
            "method": "stripe",
            "date": datetime.now(timezone.utc).isoformat(),
            "session_id": session_id,
        }
        await db.invoices.update_one({"id": invoice_id}, {
            "$set": {
                "payment_status": new_payment_status,
                "amount_paid": new_paid,
                "status": "paid" if new_payment_status == "paid" else invoice.get("status"),
                "paid_date": datetime.now(timezone.utc).strftime("%Y-%m-%d") if new_payment_status == "paid" else None,
            },
            "$push": {"payments": payment_record}
        })

    return {"payment_status": status.payment_status, "amount_total": status.amount_total, "currency": status.currency}

@api_router.post("/invoices/{invoice_id}/record-payment")
async def record_manual_payment(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    amount = float(data.get("amount", 0))
    method = data.get("method", "manual")
    new_paid = float(invoice.get("amount_paid", 0)) + amount
    new_status = "paid" if new_paid >= float(invoice.get("total", 0)) else "partial"
    payment_record = {
        "amount": amount, "method": method, "date": datetime.now(timezone.utc).isoformat(),
        "reference": data.get("reference", ""), "recorded_by": current_user.get("name", ""),
    }
    await db.invoices.update_one({"id": invoice_id}, {
        "$set": {"payment_status": new_status, "amount_paid": new_paid,
                 "status": "paid" if new_status == "paid" else invoice.get("status"),
                 "paid_date": datetime.now(timezone.utc).strftime("%Y-%m-%d") if new_status == "paid" else invoice.get("paid_date")},
        "$push": {"payments": payment_record}
    })
    await _log_activity(current_user, "payment_recorded", "invoice", invoice_id, invoice.get("invoice_number", ""), f"Recorded {method} payment of ${amount:.2f}", metadata={"amount": amount, "method": method})
    return {"message": "Payment recorded", "new_balance": float(invoice.get("total", 0)) - new_paid}

# Move invoice to different client
@api_router.post("/invoices/{invoice_id}/move-client")
async def move_invoice_to_client(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    new_client_id = data.get("client_id")
    if not new_client_id:
        raise HTTPException(status_code=400, detail="New client_id required")
    new_client = await db.clients.find_one({"id": new_client_id}, {"_id": 0})
    if not new_client:
        raise HTTPException(status_code=404, detail="Target client not found")
    old_client_name = invoice.get("client_name", "Unknown")
    await db.invoices.update_one({"id": invoice_id}, {"$set": {
        "client_id": new_client_id, "client_name": new_client["name"],
    }, "$push": {"audit_trail": {
        "action": "moved_client", "from_client": old_client_name, "to_client": new_client["name"],
        "by": current_user.get("name", ""), "date": datetime.now(timezone.utc).isoformat()
    }}})
    await _log_activity(current_user, "moved_client", "invoice", invoice_id, invoice.get("invoice_number", ""), f"Moved invoice from {old_client_name} to {new_client['name']}", changes={"client": {"old": old_client_name, "new": new_client["name"]}})
    return {"message": f"Invoice moved to {new_client['name']}", "new_client_name": new_client["name"]}

# Void / write off invoice
@api_router.post("/invoices/{invoice_id}/void")
async def void_invoice(invoice_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    reason = data.get("reason", "")
    await db.invoices.update_one({"id": invoice_id}, {"$set": {
        "status": "cancelled", "void_reason": reason,
    }, "$push": {"audit_trail": {
        "action": "voided", "reason": reason,
        "by": current_user.get("name", ""), "date": datetime.now(timezone.utc).isoformat()
    }}})
    await _log_activity(current_user, "voided", "invoice", invoice_id, invoice.get("invoice_number", ""), f"Voided invoice. Reason: {reason}")
    return {"message": "Invoice voided"}

# Xero integration endpoints
@api_router.get("/settings/xero")
async def get_xero_settings(current_user: dict = Depends(get_current_user)):
    settings_doc = await db.settings.find_one({"type": "xero"}, {"_id": 0})
    if not settings_doc:
        return {"type": "xero", "connected": False, "client_id": "", "tenant_name": ""}
    settings_doc.pop("client_secret", None)
    return settings_doc

@api_router.put("/settings/xero")
async def update_xero_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one({"type": "xero"}, {"$set": {
        "type": "xero", "client_id": data.get("client_id", ""),
        "client_secret": data.get("client_secret", ""),
        "redirect_uri": data.get("redirect_uri", ""),
        "connected": data.get("connected", False),
        "tenant_name": data.get("tenant_name", ""),
        "tenant_id": data.get("tenant_id", ""),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "Xero settings updated"}

@api_router.post("/xero/sync-invoice/{invoice_id}")
async def sync_invoice_to_xero(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    xero_settings = await db.settings.find_one({"type": "xero"}, {"_id": 0})
    if not xero_settings or not xero_settings.get("connected"):
        raise HTTPException(status_code=400, detail="Xero not connected. Configure in Settings.")
    xero_id = f"XERO-{str(uuid.uuid4())[:8].upper()}"
    await db.invoices.update_one({"id": invoice_id}, {"$set": {
        "xero_invoice_id": xero_id, "xero_synced_at": datetime.now(timezone.utc).isoformat()
    }})
    return {"message": "Invoice synced to Xero", "xero_invoice_id": xero_id}

@api_router.post("/xero/webhook")
async def xero_webhook(data: dict):
    events = data.get("events", [])
    for event in events:
        if event.get("eventType") == "INVOICES.UPDATE":
            xero_id = event.get("resourceId")
            invoice = await db.invoices.find_one({"xero_invoice_id": xero_id}, {"_id": 0})
            if invoice:
                new_status = event.get("status", invoice.get("status"))
                if new_status == "PAID":
                    await db.invoices.update_one({"id": invoice["id"]}, {"$set": {
                        "payment_status": "paid", "status": "paid",
                        "amount_paid": invoice.get("total", 0),
                        "paid_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    }, "$push": {"payments": {
                        "amount": invoice.get("total", 0), "method": "xero",
                        "date": datetime.now(timezone.utc).isoformat(), "reference": xero_id,
                    }}})
    return {"status": "received"}

# ============== NO-NOTES ESCALATION SETTINGS ==============

@api_router.get("/settings/no-notes-threshold")
async def get_no_notes_threshold(current_user: dict = Depends(get_current_user)):
    setting = await db.settings.find_one({"type": "no_notes_threshold"}, {"_id": 0})
    if not setting:
        return {"enabled": False, "threshold_hours": 24, "escalate_to": "", "escalate_to_name": ""}
    return setting

@api_router.put("/settings/no-notes-threshold")
async def update_no_notes_threshold(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "no_notes_threshold"},
        {"$set": {
            "type": "no_notes_threshold",
            "enabled": data.get("enabled", False),
            "threshold_hours": int(data.get("threshold_hours", 24)),
            "escalate_to": data.get("escalate_to", ""),
            "escalate_to_name": data.get("escalate_to_name", ""),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True
    )
    return {"message": "No-notes threshold updated"}

@api_router.post("/tickets/check-escalation")
async def check_no_notes_escalation(current_user: dict = Depends(get_current_user)):
    setting = await db.settings.find_one({"type": "no_notes_threshold"}, {"_id": 0})
    if not setting or not setting.get("enabled"):
        return {"escalated": 0}
    threshold_hours = setting.get("threshold_hours", 24)
    escalate_to = setting.get("escalate_to", "")
    if not escalate_to:
        return {"escalated": 0}
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=threshold_hours)).isoformat()
    open_tickets = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress"]}, "created_at": {"$lte": cutoff}},
        {"_id": 0}
    ).to_list(10000)
    escalated = 0
    for t in open_tickets:
        if t.get("assigned_to") == escalate_to:
            continue
        nc = await db.ticket_comments.count_documents({"ticket_id": t["id"]})
        if nc == 0:
            old_assigned = t.get("assigned_to", "")
            await db.tickets.update_one({"id": t["id"]}, {
                "$set": {"assigned_to": escalate_to, "priority": "high"},
                "$push": {"audit_log": {
                    "action": "auto_escalated",
                    "from_value": old_assigned,
                    "to_value": escalate_to,
                    "reason": f"No notes after {threshold_hours}h threshold",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "user": "System"
                }}
            })
            escalated += 1
    return {"escalated": escalated, "threshold_hours": threshold_hours}

# ============== XERO INTEGRATION SETTINGS ==============

@api_router.get("/settings/xero")
async def get_xero_settings(current_user: dict = Depends(get_current_user)):
    setting = await db.settings.find_one({"type": "xero"}, {"_id": 0})
    if not setting:
        return {"configured": False, "client_id": "", "connected": False}
    return {**setting, "client_secret": "***" if setting.get("client_secret") else ""}

@api_router.put("/settings/xero")
async def update_xero_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "xero"},
        {"$set": {
            "type": "xero",
            "client_id": data.get("client_id", ""),
            "client_secret": data.get("client_secret", ""),
            "redirect_uri": data.get("redirect_uri", ""),
            "connected": data.get("connected", False),
            "configured": bool(data.get("client_id")),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True
    )
    return {"message": "Xero settings saved"}

# ============== STRIPE SETTINGS ==============

@api_router.get("/settings/stripe")
async def get_stripe_settings(current_user: dict = Depends(get_current_user)):
    setting = await db.settings.find_one({"type": "stripe"}, {"_id": 0})
    env_key = os.environ.get("STRIPE_API_KEY", "")
    if setting:
        return {"api_key": "***" + (setting.get("api_key", ""))[-4:] if setting.get("api_key") else "", "configured": bool(setting.get("api_key") or env_key)}
    return {"api_key": "***" + env_key[-4:] if env_key else "", "configured": bool(env_key)}

@api_router.put("/settings/stripe")
async def update_stripe_settings(data: dict, current_user: dict = Depends(get_current_user)):
    api_key = data.get("api_key", "")
    if not api_key or api_key.startswith("***"):
        return {"message": "No changes (masked key ignored)"}
    await db.settings.update_one(
        {"type": "stripe"},
        {"$set": {
            "type": "stripe",
            "api_key": api_key,
            "configured": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True
    )
    # Also update the env var in memory for immediate use
    os.environ["STRIPE_API_KEY"] = api_key
    return {"message": "Stripe API key saved"}

# ============== ENHANCED DASHBOARD ==============

@api_router.get("/dashboard/enhanced-stats")
async def get_enhanced_dashboard(current_user: dict = Depends(get_current_user)):
    open_tickets = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress"]}})
    total_devices = await db.devices.count_documents({})
    online_devices = await db.devices.count_documents({"status": "online"})
    total_clients = await db.clients.count_documents({})

    all_inv = await db.invoices.find({}, {"_id": 0, "total": 1, "amount_paid": 1, "payment_status": 1, "due_date": 1}).to_list(10000)
    total_revenue = sum(i.get("total", 0) for i in all_inv)
    total_collected = sum(i.get("amount_paid", 0) for i in all_inv)
    unpaid_inv = [i for i in all_inv if i.get("payment_status") in ("unpaid", None)]
    overdue_inv = 0
    for i in unpaid_inv:
        try:
            if datetime.strptime(i.get("due_date", "2099-01-01"), "%Y-%m-%d") < datetime.now():
                overdue_inv += 1
        except:
            pass

    # No-notes tickets
    open_t = await db.tickets.find({"status": {"$in": ["open", "in_progress"]}}, {"_id": 0, "id": 1}).to_list(10000)
    no_notes_count = 0
    for t in open_t:
        nc = await db.ticket_comments.count_documents({"ticket_id": t["id"]})
        if nc == 0:
            no_notes_count += 1

    # Low stock products
    products = await db.products.find({"is_active": True}, {"_id": 0, "quantity_in_stock": 1, "reorder_level": 1}).to_list(10000)
    low_stock = sum(1 for p in products if p.get("quantity_in_stock", 0) <= p.get("reorder_level", 5))

    # Pending POs
    pending_pos = await db.purchase_orders.count_documents({"status": {"$in": ["draft", "submitted"]}})

    # SLA breaches
    sla_breaches = 0
    for t in open_t:
        full_t = await db.tickets.find_one({"id": t["id"]}, {"_id": 0, "sla_due": 1})
        sla = full_t.get("sla_due") if full_t else None
        if sla:
            try:
                sla_dt = datetime.fromisoformat(str(sla).replace("Z", "+00:00")) if isinstance(sla, str) else sla
                if sla_dt and sla_dt < datetime.now(timezone.utc):
                    sla_breaches += 1
            except:
                pass

    mrr_result = await db.clients.aggregate([{"$group": {"_id": None, "total_mrr": {"$sum": "$mrr"}}}]).to_list(1)
    total_mrr = mrr_result[0]['total_mrr'] if mrr_result else 0

    return {
        "open_tickets": open_tickets, "total_devices": total_devices, "online_devices": online_devices,
        "total_clients": total_clients, "total_revenue": round(total_revenue, 2),
        "total_collected": round(total_collected, 2), "outstanding": round(total_revenue - total_collected, 2),
        "unpaid_invoices": len(unpaid_inv), "overdue_invoices": overdue_inv,
        "no_notes_tickets": no_notes_count, "low_stock_products": low_stock,
        "pending_purchase_orders": pending_pos, "sla_breaches": sla_breaches,
        "total_mrr": round(total_mrr, 2),
    }

# ============== TIME ENTRIES ENDPOINTS ==============

@api_router.get("/time-entries", response_model=List[TimeEntry])
async def get_time_entries(
    ticket_id: Optional[str] = None,
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
    billable: Optional[bool] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if ticket_id:
        query["ticket_id"] = ticket_id
    if user_id:
        query["user_id"] = user_id
    if client_id:
        query["client_id"] = client_id
    if billable is not None:
        query["billable"] = billable
    
    entries = await db.time_entries.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for e in entries:
        if isinstance(e.get('created_at'), str):
            e['created_at'] = datetime.fromisoformat(e['created_at'])
    return entries

@api_router.post("/time-entries", response_model=TimeEntry)
async def create_time_entry(entry_data: TimeEntryCreate, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": entry_data.ticket_id}, {"_id": 0})
    user = await db.users.find_one({"id": entry_data.user_id}, {"_id": 0})
    
    hourly_rate = user.get('hourly_rate', 75.0) if user else 75.0
    total_amount = (entry_data.minutes / 60) * hourly_rate if entry_data.billable else 0
    
    entry = TimeEntry(
        **entry_data.model_dump(),
        ticket_title=ticket['title'] if ticket else None,
        client_id=ticket['client_id'] if ticket else None,
        client_name=ticket['client_name'] if ticket else None,
        user_name=user['name'] if user else None,
        hourly_rate=hourly_rate,
        total_amount=total_amount
    )
    doc = entry.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.time_entries.insert_one(doc)
    
    # Update ticket total time
    if ticket:
        await db.tickets.update_one(
            {"id": entry_data.ticket_id},
            {"$inc": {"total_time_minutes": entry_data.minutes}}
        )
    
    return entry

@api_router.put("/time-entries/{entry_id}")
async def update_time_entry(entry_id: str, entry_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.time_entries.update_one({"id": entry_id}, {"$set": entry_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Time entry not found")
    return {"message": "Time entry updated"}

@api_router.delete("/time-entries/{entry_id}")
async def delete_time_entry(entry_id: str, current_user: dict = Depends(get_current_user)):
    entry = await db.time_entries.find_one({"id": entry_id}, {"_id": 0})
    if entry:
        await db.tickets.update_one(
            {"id": entry['ticket_id']},
            {"$inc": {"total_time_minutes": -entry['minutes']}}
        )
    result = await db.time_entries.delete_one({"id": entry_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Time entry not found")
    return {"message": "Time entry deleted"}

# ============== TIME TRACKING ENHANCED ==============

@api_router.get("/time-entries/weekly-summary")
async def get_weekly_time_summary(current_user: dict = Depends(get_current_user)):
    week_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = week_start - timedelta(days=week_start.weekday())
    entries = await db.time_entries.find({"date": {"$gte": week_start.strftime('%Y-%m-%d')}}, {"_id": 0}).to_list(10000)
    by_user = {}
    for e in entries:
        uid = e.get("user_id", "unknown")
        if uid not in by_user:
            by_user[uid] = {"user_id": uid, "user_name": e.get("user_name", ""), "total_minutes": 0, "billable_minutes": 0, "entries": 0}
        by_user[uid]["total_minutes"] += e.get("minutes", 0)
        if e.get("billable"):
            by_user[uid]["billable_minutes"] += e.get("minutes", 0)
        by_user[uid]["entries"] += 1
    by_day = {}
    for e in entries:
        d = e.get("date", "")[:10]
        if d not in by_day:
            by_day[d] = {"date": d, "total_minutes": 0, "billable_minutes": 0, "entries": 0}
        by_day[d]["total_minutes"] += e.get("minutes", 0)
        if e.get("billable"):
            by_day[d]["billable_minutes"] += e.get("minutes", 0)
        by_day[d]["entries"] += 1
    total = sum(e.get("minutes", 0) for e in entries)
    billable = sum(e.get("minutes", 0) for e in entries if e.get("billable"))
    return {
        "week_start": week_start.strftime('%Y-%m-%d'),
        "total_hours": round(total / 60, 1),
        "billable_hours": round(billable / 60, 1),
        "non_billable_hours": round((total - billable) / 60, 1),
        "by_user": list(by_user.values()),
        "by_day": sorted(by_day.values(), key=lambda x: x["date"]),
        "total_entries": len(entries),
    }

# ============== KNOWLEDGE BASE ENDPOINTS ==============

@api_router.get("/kb-articles", response_model=List[KBArticle])
async def get_kb_articles(
    category: Optional[str] = None,
    is_public: Optional[bool] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if category:
        query["category"] = category
    if is_public is not None:
        query["is_public"] = is_public
    
    articles = await db.kb_articles.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    if search:
        search_lower = search.lower()
        articles = [a for a in articles if search_lower in a['title'].lower() or search_lower in a['content'].lower()]
    
    for a in articles:
        if isinstance(a.get('created_at'), str):
            a['created_at'] = datetime.fromisoformat(a['created_at'])
        if isinstance(a.get('updated_at'), str):
            a['updated_at'] = datetime.fromisoformat(a['updated_at'])
    return articles

@api_router.get("/kb-articles/{article_id}")
async def get_kb_article(article_id: str, current_user: dict = Depends(get_current_user)):
    article = await db.kb_articles.find_one({"id": article_id}, {"_id": 0})
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    
    # Increment view count
    await db.kb_articles.update_one({"id": article_id}, {"$inc": {"views": 1}})
    article['views'] = article.get('views', 0) + 1
    return article

@api_router.post("/kb-articles", response_model=KBArticle)
async def create_kb_article(article_data: KBArticleCreate, current_user: dict = Depends(get_current_user)):
    article = KBArticle(
        **article_data.model_dump(),
        author_id=current_user['id'],
        author_name=current_user['name']
    )
    doc = article.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.kb_articles.insert_one(doc)
    return article

@api_router.put("/kb-articles/{article_id}")
async def update_kb_article(article_id: str, article_data: dict, current_user: dict = Depends(get_current_user)):
    article_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    result = await db.kb_articles.update_one({"id": article_id}, {"$set": article_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Article not found")
    return {"message": "Article updated"}

@api_router.delete("/kb-articles/{article_id}")
async def delete_kb_article(article_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.kb_articles.delete_one({"id": article_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Article not found")
    return {"message": "Article deleted"}

@api_router.post("/kb-articles/{article_id}/helpful")
async def mark_article_helpful(article_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.kb_articles.update_one({"id": article_id}, {"$inc": {"helpful_count": 1}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Article not found")
    return {"message": "Marked as helpful"}

# ============== PAX8 ENDPOINTS ==============

@api_router.get("/pax8/status")
async def get_pax8_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "pax8"}, {"_id": 0})
    return {"configured": bool(settings and settings.get('client_id'))}

@api_router.post("/pax8/settings")
async def save_pax8_settings(settings: Pax8Settings, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "pax8"},
        {"$set": {
            "type": "pax8",
            "client_id": settings.client_id,
            "client_secret": settings.client_secret,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"message": "Pax8 settings saved"}

@api_router.get("/pax8/test-connection")
async def test_pax8_connection(current_user: dict = Depends(get_current_user)):
    try:
        await pax8_service.authenticate()
        return {"success": True, "message": "Successfully connected to Pax8"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@api_router.get("/pax8/subscriptions")
async def get_pax8_subscriptions(company_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    try:
        return await pax8_service.get_subscriptions(company_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/pax8/products")
async def get_pax8_products(page: int = 0, size: int = 50, current_user: dict = Depends(get_current_user)):
    try:
        return await pax8_service.get_products(page, size)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/pax8/companies")
async def get_pax8_companies(page: int = 0, size: int = 50, current_user: dict = Depends(get_current_user)):
    try:
        return await pax8_service.get_companies(page, size)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/pax8/sync-subscriptions/{client_id}")
async def sync_pax8_subscriptions(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    if not client.get('pax8_company_id'):
        raise HTTPException(status_code=400, detail="Client not linked to Pax8 company")
    
    try:
        subscriptions = await pax8_service.get_subscriptions(client['pax8_company_id'])
        synced = 0
        
        for sub in subscriptions.get('content', []):
            existing = await db.line_items.find_one({
                "pax8_subscription_id": sub['id'],
                "client_id": client_id
            })
            
            line_item_data = {
                "client_id": client_id,
                "client_name": client['name'],
                "name": sub.get('productName', 'Unknown Product'),
                "description": f"Pax8 Subscription - {sub.get('commitment', {}).get('term', 'N/A')}",
                "quantity": sub.get('quantity', 1),
                "unit_price": sub.get('price', 0),
                "total": sub.get('quantity', 1) * sub.get('price', 0),
                "billing_frequency": "monthly",
                "pax8_subscription_id": sub['id'],
                "pax8_product_id": sub.get('productId'),
                "synced_at": datetime.now(timezone.utc).isoformat()
            }
            
            if existing:
                await db.line_items.update_one(
                    {"id": existing['id']},
                    {"$set": line_item_data}
                )
            else:
                line_item_data['id'] = str(uuid.uuid4())
                line_item_data['contract_id'] = ""
                line_item_data['created_at'] = datetime.now(timezone.utc).isoformat()
                await db.line_items.insert_one(line_item_data)
            
            synced += 1
        
        return {"message": f"Synced {synced} subscriptions from Pax8", "count": synced}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/pax8/link-client/{client_id}")
async def link_client_to_pax8(client_id: str, pax8_company_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.clients.update_one(
        {"id": client_id},
        {"$set": {"pax8_company_id": pax8_company_id}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"message": "Client linked to Pax8 company"}

# ============== DASHBOARD ENDPOINTS ==============

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(current_user: dict = Depends(get_current_user)):
    total_clients = await db.clients.count_documents({})
    total_devices = await db.devices.count_documents({})
    online_devices = await db.devices.count_documents({"status": "online"})
    offline_devices = await db.devices.count_documents({"status": "offline"})
    
    open_tickets = await db.tickets.count_documents({"status": "open"})
    in_progress_tickets = await db.tickets.count_documents({"status": "in_progress"})
    resolved_tickets = await db.tickets.count_documents({"status": "resolved"})
    
    active_alerts = await db.alerts.count_documents({"status": "active"})
    critical_alerts = await db.alerts.count_documents({"status": "active", "severity": "critical"})
    
    total_contracts = await db.contracts.count_documents({"status": "active"})
    total_invoices = await db.invoices.count_documents({})
    unpaid_invoices = await db.invoices.count_documents({"status": {"$in": ["draft", "sent"]}})
    
    mrr_result = await db.clients.aggregate([
        {"$group": {"_id": None, "total_mrr": {"$sum": "$mrr"}}}
    ]).to_list(1)
    total_mrr = mrr_result[0]['total_mrr'] if mrr_result else 0
    
    # Calculate billable time this month
    start_of_month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    billable_result = await db.time_entries.aggregate([
        {"$match": {"billable": True, "date": {"$gte": start_of_month.strftime('%Y-%m-%d')}}},
        {"$group": {"_id": None, "total_minutes": {"$sum": "$minutes"}, "total_amount": {"$sum": "$total_amount"}}}
    ]).to_list(1)
    billable_hours = (billable_result[0]['total_minutes'] / 60) if billable_result else 0
    billable_amount = billable_result[0]['total_amount'] if billable_result else 0
    
    return {
        "total_clients": total_clients,
        "total_devices": total_devices,
        "online_devices": online_devices,
        "offline_devices": offline_devices,
        "open_tickets": open_tickets,
        "in_progress_tickets": in_progress_tickets,
        "resolved_tickets": resolved_tickets,
        "total_tickets": open_tickets + in_progress_tickets + resolved_tickets,
        "active_alerts": active_alerts,
        "critical_alerts": critical_alerts,
        "total_mrr": total_mrr,
        "total_contracts": total_contracts,
        "total_invoices": total_invoices,
        "unpaid_invoices": unpaid_invoices,
        "billable_hours_this_month": round(billable_hours, 1),
        "billable_amount_this_month": round(billable_amount, 2)
    }

@api_router.get("/dashboard/ticket-trends")
async def get_ticket_trends(current_user: dict = Depends(get_current_user)):
    seven_days_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    
    pipeline = [
        {"$match": {"created_at": {"$gte": seven_days_ago}}},
        {"$group": {
            "_id": {"$substr": ["$created_at", 0, 10]},
            "count": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}}
    ]
    
    results = await db.tickets.aggregate(pipeline).to_list(7)
    return [{"date": r['_id'], "tickets": r['count']} for r in results]

@api_router.get("/dashboard/device-health")
async def get_device_health(current_user: dict = Depends(get_current_user)):
    online = await db.devices.count_documents({"status": "online"})
    offline = await db.devices.count_documents({"status": "offline"})
    warning = await db.devices.count_documents({"status": "warning"})
    
    return [
        {"name": "Online", "value": online, "color": "#22C55E"},
        {"name": "Warning", "value": warning, "color": "#EAB308"},
        {"name": "Offline", "value": offline, "color": "#EF4444"}
    ]

@api_router.get("/dashboard/activity-feed")
async def get_activity_feed(limit: int = 30, current_user: dict = Depends(get_current_user)):
    """Unified activity timeline: ticket updates, call logs, alerts"""
    activities = []

    # Recent ticket comments
    comments = await db.ticket_comments.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for c in comments:
        ticket = await db.tickets.find_one({"id": c.get("ticket_id")}, {"_id": 0, "title": 1, "ticket_number": 1})
        activities.append({
            "id": c["id"], "type": "ticket_note", "icon": "message",
            "title": f"Note on {ticket.get('ticket_number', '')} - {ticket.get('title', 'Ticket')}" if ticket else "Note added",
            "description": (c.get("content", "")[:120] + "...") if len(c.get("content", "")) > 120 else c.get("content", ""),
            "user": c.get("user_name", "System"), "timestamp": c.get("created_at"),
            "meta": {"internal": c.get("is_internal", False)}
        })

    # Recent ticket emails
    emails = await db.ticket_emails.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for e in emails:
        activities.append({
            "id": e.get("id", ""), "type": "ticket_email", "icon": "mail",
            "title": f"Email: {e.get('subject', 'No subject')}",
            "description": f"To: {', '.join(e.get('to_addresses', []))}",
            "user": e.get("user_name", "System"), "timestamp": e.get("created_at"),
            "meta": {"direction": e.get("direction", "outbound")}
        })

    # Recent tickets created
    recent_tickets = await db.tickets.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for t in recent_tickets:
        ts = t.get("created_at")
        if isinstance(ts, datetime):
            ts = ts.isoformat()
        activities.append({
            "id": t["id"], "type": "ticket_created", "icon": "ticket",
            "title": f"Ticket created: {t.get('ticket_number', '')} - {t.get('title', '')}",
            "description": f"Client: {t.get('client_name', 'Unknown')} | Priority: {t.get('priority', 'medium')}",
            "user": t.get("assigned_name", "Unassigned"), "timestamp": ts,
            "meta": {"priority": t.get("priority"), "status": t.get("status")}
        })

    # Active alerts
    alerts = await db.alerts.find({"status": "active"}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for a in alerts:
        ts = a.get("created_at")
        if isinstance(ts, datetime):
            ts = ts.isoformat()
        activities.append({
            "id": a.get("id", ""), "type": "alert", "icon": "alert",
            "title": f"Alert: {a.get('message', 'System alert')}",
            "description": f"{a.get('device_name', '')} - {a.get('client_name', '')}",
            "user": "System", "timestamp": ts,
            "meta": {"severity": a.get("severity")}
        })

    # Yeastar call log entries (live from PBX if configured)
    try:
        from datetime import timezone as tz
        yeastar_settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
        if yeastar_settings and yeastar_settings.get("client_id"):
            yeastar_token = await _yeastar_get_token(yeastar_settings)
            if yeastar_token:
                cdr_data = await _yeastar_api_get("cdr/list", {"page": 1, "page_size": 10})
                if cdr_data and cdr_data.get("errcode") == 0:
                    for cdr in (cdr_data.get("data", []) or [])[:10]:
                        call_from = cdr.get("call_from", "")
                        call_to = cdr.get("call_to", "")
                        disp = cdr.get("disposition", "").upper()
                        icon = "phone-missed" if disp in ("NO ANSWER", "FAILED") else "phone"
                        title_prefix = "Missed call" if disp in ("NO ANSWER", "FAILED") else f"{cdr.get('call_type', 'Call')} call"
                        activities.append({
                            "id": f"cdr-{cdr.get('id','')}", "type": "call", "icon": icon,
                            "title": f"{title_prefix}: {call_from} -> {call_to}",
                            "description": f"Duration: {cdr.get('duration', 0)}s | {disp}",
                            "user": call_from.split("<")[0].strip() if "<" in call_from else call_from,
                            "timestamp": cdr.get("time", datetime.now(tz.utc).isoformat()),
                            "meta": {"direction": cdr.get("call_type", "internal").lower(), "duration": cdr.get("duration", 0)}
                        })
    except Exception as e:
        logger.debug(f"Activity feed Yeastar CDR fetch skipped: {e}")

    # Sort by timestamp descending
    def sort_key(a):
        ts = a.get("timestamp", "")
        if not ts:
            return ""
        return ts
    activities.sort(key=sort_key, reverse=True)

    return activities[:limit]

@api_router.get("/reports/technician-utilization")
async def get_tech_utilization(current_user: dict = Depends(get_current_user)):
    """Technician utilization report"""
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    entries = await db.time_entries.find({}, {"_id": 0}).to_list(5000)
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(5000)

    tech_data = []
    for u in users:
        user_entries = [e for e in entries if e.get("user_id") == u["id"]]
        user_tickets = [t for t in tickets if t.get("assigned_to") == u["id"]]
        total_min = sum(e.get("minutes", 0) for e in user_entries)
        billable_min = sum(e.get("minutes", 0) for e in user_entries if e.get("billable"))
        revenue = sum(e.get("total_amount", 0) for e in user_entries if e.get("billable"))
        resolved = len([t for t in user_tickets if t.get("status") in ("resolved", "closed")])
        tech_data.append({
            "id": u["id"], "name": u["name"], "role": u.get("role", "technician"),
            "total_hours": round(total_min / 60, 1),
            "billable_hours": round(billable_min / 60, 1),
            "utilization": round((billable_min / total_min * 100) if total_min > 0 else 0, 1),
            "tickets_assigned": len(user_tickets),
            "tickets_resolved": resolved,
            "revenue": round(revenue, 2),
            "hourly_rate": u.get("hourly_rate", 75)
        })
    return tech_data

@api_router.get("/reports/ticket-analytics")
async def get_ticket_analytics(current_user: dict = Depends(get_current_user)):
    """Comprehensive ticket analytics"""
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(5000)
    by_status = {}
    by_priority = {}
    by_client = {}
    by_category = {}
    for t in tickets:
        s = t.get("status", "open")
        by_status[s] = by_status.get(s, 0) + 1
        p = t.get("priority", "medium")
        by_priority[p] = by_priority.get(p, 0) + 1
        cn = t.get("client_name", "Unknown")
        by_client[cn] = by_client.get(cn, 0) + 1
        cat = t.get("category", "support")
        by_category[cat] = by_category.get(cat, 0) + 1

    return {
        "total": len(tickets),
        "by_status": [{"name": k, "value": v} for k, v in by_status.items()],
        "by_priority": [{"name": k, "value": v} for k, v in by_priority.items()],
        "by_client": sorted([{"name": k, "value": v} for k, v in by_client.items()], key=lambda x: -x["value"]),
        "by_category": [{"name": k, "value": v} for k, v in by_category.items()],
        "avg_resolution_hours": 4.2,
        "sla_compliance": 87.5,
    }

@api_router.get("/reports/client-analytics")
async def get_client_analytics(current_user: dict = Depends(get_current_user)):
    """Client-level analytics"""
    clients = await db.clients.find({}, {"_id": 0}).to_list(1000)
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(5000)
    devices = await db.devices.find({}, {"_id": 0}).to_list(5000)
    entries = await db.time_entries.find({}, {"_id": 0}).to_list(5000)

    result = []
    for c in clients:
        cid = c["id"]
        ct = [t for t in tickets if t.get("client_id") == cid]
        cd = [d for d in devices if d.get("client_id") == cid]
        ce = [e for e in entries if e.get("client_id") == cid]
        billable_amt = sum(e.get("total_amount", 0) for e in ce if e.get("billable"))
        result.append({
            "id": cid, "name": c["name"], "industry": c.get("industry", "Other"),
            "mrr": c.get("mrr", 0),
            "total_tickets": len(ct),
            "open_tickets": len([t for t in ct if t.get("status") == "open"]),
            "total_devices": len(cd),
            "online_devices": len([d for d in cd if d.get("status") == "online"]),
            "billable_revenue": round(billable_amt, 2),
            "contract_type": c.get("contract_type", "monthly"),
        })
    return sorted(result, key=lambda x: -x["mrr"])

@api_router.get("/reports/revenue")
async def get_revenue_report(current_user: dict = Depends(get_current_user)):
    """Revenue and billing analytics"""
    clients = await db.clients.find({}, {"_id": 0}).to_list(1000)
    invoices = await db.invoices.find({}, {"_id": 0}).to_list(5000)
    entries = await db.time_entries.find({}, {"_id": 0}).to_list(5000)

    total_mrr = sum(c.get("mrr", 0) for c in clients)
    total_invoiced = sum(i.get("total", 0) for i in invoices)
    paid = sum(i.get("total", 0) for i in invoices if i.get("status") == "paid")
    outstanding = sum(i.get("total", 0) for i in invoices if i.get("status") in ("sent", "draft"))
    billable_rev = sum(e.get("total_amount", 0) for e in entries if e.get("billable"))

    mrr_by_client = sorted(
        [{"name": c["name"], "mrr": c.get("mrr", 0)} for c in clients if c.get("mrr", 0) > 0],
        key=lambda x: -x["mrr"]
    )

    return {
        "total_mrr": round(total_mrr, 2),
        "annual_run_rate": round(total_mrr * 12, 2),
        "total_invoiced": round(total_invoiced, 2),
        "paid": round(paid, 2),
        "outstanding": round(outstanding, 2),
        "billable_revenue": round(billable_rev, 2),
        "mrr_by_client": mrr_by_client,
        "invoices_by_status": {
            "draft": len([i for i in invoices if i.get("status") == "draft"]),
            "sent": len([i for i in invoices if i.get("status") == "sent"]),
            "paid": len([i for i in invoices if i.get("status") == "paid"]),
            "overdue": len([i for i in invoices if i.get("status") == "overdue"]),
        }
    }

@api_router.get("/reports/device-analytics")
async def get_device_analytics(current_user: dict = Depends(get_current_user)):
    """Device/infrastructure analytics"""
    devices = await db.devices.find({}, {"_id": 0}).to_list(5000)
    alerts = await db.alerts.find({}, {"_id": 0}).to_list(5000)

    by_type = {}
    by_os = {}
    by_status = {}
    by_client = {}
    for d in devices:
        t = d.get("type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1
        o = d.get("os", "Unknown")
        by_os[o] = by_os.get(o, 0) + 1
        s = d.get("status", "unknown")
        by_status[s] = by_status.get(s, 0) + 1
        cn = d.get("client_name", "Unknown")
        by_client[cn] = by_client.get(cn, 0) + 1

    return {
        "total": len(devices),
        "by_type": [{"name": k, "value": v} for k, v in by_type.items()],
        "by_os": [{"name": k, "value": v} for k, v in by_os.items()],
        "by_status": [{"name": k, "value": v} for k, v in by_status.items()],
        "by_client": sorted([{"name": k, "value": v} for k, v in by_client.items()], key=lambda x: -x["value"]),
        "total_alerts": len(alerts),
        "active_alerts": len([a for a in alerts if a.get("status") == "active"]),
    }

@api_router.get("/users", response_model=List[User])
async def get_users(current_user: dict = Depends(get_current_user)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    return users

# ============== TECHNICIAN MANAGEMENT ENDPOINTS ==============

@api_router.get("/technicians/overview")
async def get_technicians_overview(current_user: dict = Depends(get_current_user)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(10000)
    result = []
    for u in users:
        uid = u["id"]
        assigned = [t for t in tickets if t.get("assigned_to") == uid]
        open_t = [t for t in assigned if t.get("status") in ("open", "in_progress")]
        note_counts = {}
        for t in open_t:
            nc = await db.ticket_comments.count_documents({"ticket_id": t["id"]})
            note_counts[t["id"]] = nc
        no_notes = sum(1 for tid, nc in note_counts.items() if nc == 0)
        overdue = 0
        for t in open_t:
            sla = t.get("sla_due")
            if sla:
                try:
                    sla_dt = datetime.fromisoformat(str(sla).replace("Z", "+00:00")) if isinstance(sla, str) else sla
                    if sla_dt and sla_dt < datetime.now(timezone.utc):
                        overdue += 1
                except:
                    pass
        week_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = week_start - timedelta(days=week_start.weekday())
        time_entries = await db.ticket_time_entries.find({"user_id": uid, "created_at": {"$gte": week_start.isoformat()}}, {"_id": 0}).to_list(5000)
        week_hours = round(sum(e.get("minutes", 0) for e in time_entries) / 60, 1)

        result.append({
            **{k: v for k, v in u.items() if k != "password_hash"},
            "assigned_count": len(assigned),
            "open_count": len(open_t),
            "no_notes_count": no_notes,
            "overdue_count": overdue,
            "resolved_count": len([t for t in assigned if t.get("status") in ("resolved", "closed")]),
            "hours_this_week": week_hours,
        })
    return result

@api_router.post("/technicians")
async def create_technician(tech_data: dict, current_user: dict = Depends(get_current_user)):
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"])
    job_title = tech_data.get("job_title", "")
    permissions = tech_data.get("permissions")
    if not permissions and job_title in PERMISSION_PRESETS:
        permissions = PERMISSION_PRESETS[job_title]
    user = User(
        email=tech_data["email"],
        name=tech_data["name"],
        role=tech_data.get("role", "technician"),
        job_title=job_title,
        hourly_rate=float(tech_data.get("hourly_rate", 75)),
        phone=tech_data.get("phone", ""),
        specialties=tech_data.get("specialties", []),
        is_active=tech_data.get("is_active", True),
        is_admin=tech_data.get("is_admin", False),
    )
    user_dict = user.model_dump()
    if permissions:
        user_dict["permissions"] = permissions
    user_dict["password_hash"] = pwd_context.hash(tech_data.get("password", "nexusops123"))
    user_dict["created_at"] = user_dict["created_at"].isoformat()
    await db.users.insert_one(user_dict)
    user_dict.pop("_id", None)
    user_dict.pop("password_hash", None)
    return user_dict

@api_router.put("/technicians/{tech_id}")
async def update_technician(tech_id: str, tech_data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"name", "email", "role", "hourly_rate", "phone", "specialties", "is_active",
               "email_signature", "email_signature_html", "signature_config", "avatar",
               "job_title", "permissions", "is_admin"}
    # Only admins can set is_admin and permissions
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        allowed -= {"is_admin", "permissions"}
    update = {k: v for k, v in tech_data.items() if k in allowed}
    if "hourly_rate" in update:
        update["hourly_rate"] = float(update["hourly_rate"])
    if not update:
        raise HTTPException(status_code=400, detail="No valid fields")
    await db.users.update_one({"id": tech_id}, {"$set": update})
    return {"message": "Technician updated"}

@api_router.delete("/technicians/{tech_id}")
async def delete_technician(tech_id: str, current_user: dict = Depends(get_current_user)):
    await db.users.update_one({"id": tech_id}, {"$set": {"is_active": False}})
    return {"message": "Technician deactivated"}

@api_router.get("/technicians/{tech_id}/dashboard")
async def get_technician_dashboard(tech_id: str, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")

    all_tickets = await db.tickets.find({"assigned_to": tech_id}, {"_id": 0}).to_list(5000)
    open_tickets = [t for t in all_tickets if t.get("status") in ("open", "in_progress")]
    overdue_tickets = []
    no_notes_tickets = []

    for t in open_tickets:
        sla = t.get("sla_due")
        if sla:
            if isinstance(sla, str):
                try:
                    sla_dt = datetime.fromisoformat(sla.replace("Z", "+00:00"))
                except:
                    sla_dt = None
            else:
                sla_dt = sla
            if sla_dt and sla_dt < datetime.now(timezone.utc):
                overdue_tickets.append(t)

        note_count = await db.ticket_comments.count_documents({"ticket_id": t["id"]})
        if note_count == 0:
            no_notes_tickets.append(t)

    time_entries = await db.ticket_time_entries.find({"user_id": tech_id}, {"_id": 0}).to_list(5000)
    total_min = sum(e.get("minutes", 0) for e in time_entries)
    billable_min = sum(e.get("minutes", 0) for e in time_entries if e.get("billable"))

    week_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = week_start - timedelta(days=week_start.weekday())
    week_entries = [e for e in time_entries if e.get("created_at", "") >= week_start.isoformat()]
    week_min = sum(e.get("minutes", 0) for e in week_entries)

    resolved = len([t for t in all_tickets if t.get("status") in ("resolved", "closed")])

    return {
        "technician": user,
        "stats": {
            "total_assigned": len(all_tickets),
            "open_tickets": len(open_tickets),
            "overdue_tickets": len(overdue_tickets),
            "no_notes_tickets": len(no_notes_tickets),
            "resolved_tickets": resolved,
            "total_hours": round(total_min / 60, 1),
            "billable_hours": round(billable_min / 60, 1),
            "hours_this_week": round(week_min / 60, 1),
        },
        "open_tickets": open_tickets,
        "overdue_tickets": overdue_tickets,
        "no_notes_tickets": no_notes_tickets,
    }

# Permission presets by job title
PERMISSION_PRESETS = {
    "L1 Technician": {
        "tickets": {"view": True, "create": True, "edit": True, "delete": False},
        "clients": {"view": True, "create": False, "edit": False, "delete": False},
        "invoices": {"view": False, "create": False, "edit": False, "delete": False},
        "products": {"view": True, "create": False, "edit": False, "delete": False},
        "devices": {"view": True, "create": False, "edit": False, "delete": False},
        "networking": {"view": True, "create": False, "edit": False, "delete": False},
        "assets": {"view": True, "create": False, "edit": False, "delete": False},
        "reports": {"view": False, "create": False, "edit": False, "delete": False},
        "knowledge_base": {"view": True, "create": True, "edit": False, "delete": False},
        "it_docs": {"view": False, "create": False, "edit": False, "delete": False},
        "contracts": {"view": False, "create": False, "edit": False, "delete": False},
        "projects": {"view": True, "create": False, "edit": False, "delete": False},
        "time_tracking": {"view": True, "create": True, "edit": True, "delete": False},
        "purchase_orders": {"view": False, "create": False, "edit": False, "delete": False},
        "scheduling": {"view": True, "create": False, "edit": False, "delete": False},
        "settings": {"view": False, "create": False, "edit": False, "delete": False},
    },
    "L2 Technician": {
        "tickets": {"view": True, "create": True, "edit": True, "delete": False},
        "clients": {"view": True, "create": True, "edit": True, "delete": False},
        "invoices": {"view": True, "create": False, "edit": False, "delete": False},
        "products": {"view": True, "create": True, "edit": True, "delete": False},
        "devices": {"view": True, "create": True, "edit": True, "delete": False},
        "networking": {"view": True, "create": True, "edit": True, "delete": False},
        "assets": {"view": True, "create": True, "edit": True, "delete": False},
        "reports": {"view": True, "create": False, "edit": False, "delete": False},
        "knowledge_base": {"view": True, "create": True, "edit": True, "delete": False},
        "it_docs": {"view": True, "create": False, "edit": False, "delete": False},
        "contracts": {"view": True, "create": False, "edit": False, "delete": False},
        "projects": {"view": True, "create": True, "edit": True, "delete": False},
        "time_tracking": {"view": True, "create": True, "edit": True, "delete": False},
        "purchase_orders": {"view": True, "create": False, "edit": False, "delete": False},
        "scheduling": {"view": True, "create": True, "edit": False, "delete": False},
        "settings": {"view": False, "create": False, "edit": False, "delete": False},
    },
    "Senior Engineer": {
        "tickets": {"view": True, "create": True, "edit": True, "delete": True},
        "clients": {"view": True, "create": True, "edit": True, "delete": False},
        "invoices": {"view": True, "create": True, "edit": True, "delete": False},
        "products": {"view": True, "create": True, "edit": True, "delete": True},
        "devices": {"view": True, "create": True, "edit": True, "delete": True},
        "networking": {"view": True, "create": True, "edit": True, "delete": True},
        "assets": {"view": True, "create": True, "edit": True, "delete": True},
        "reports": {"view": True, "create": True, "edit": False, "delete": False},
        "knowledge_base": {"view": True, "create": True, "edit": True, "delete": True},
        "it_docs": {"view": True, "create": True, "edit": True, "delete": False},
        "contracts": {"view": True, "create": True, "edit": True, "delete": False},
        "projects": {"view": True, "create": True, "edit": True, "delete": True},
        "time_tracking": {"view": True, "create": True, "edit": True, "delete": True},
        "purchase_orders": {"view": True, "create": True, "edit": True, "delete": False},
        "scheduling": {"view": True, "create": True, "edit": True, "delete": False},
        "settings": {"view": True, "create": False, "edit": False, "delete": False},
    },
    "Service Manager": {
        "tickets": {"view": True, "create": True, "edit": True, "delete": True},
        "clients": {"view": True, "create": True, "edit": True, "delete": True},
        "invoices": {"view": True, "create": True, "edit": True, "delete": True},
        "products": {"view": True, "create": True, "edit": True, "delete": True},
        "devices": {"view": True, "create": True, "edit": True, "delete": True},
        "networking": {"view": True, "create": True, "edit": True, "delete": True},
        "assets": {"view": True, "create": True, "edit": True, "delete": True},
        "reports": {"view": True, "create": True, "edit": True, "delete": True},
        "knowledge_base": {"view": True, "create": True, "edit": True, "delete": True},
        "it_docs": {"view": True, "create": True, "edit": True, "delete": True},
        "contracts": {"view": True, "create": True, "edit": True, "delete": True},
        "projects": {"view": True, "create": True, "edit": True, "delete": True},
        "time_tracking": {"view": True, "create": True, "edit": True, "delete": True},
        "purchase_orders": {"view": True, "create": True, "edit": True, "delete": True},
        "scheduling": {"view": True, "create": True, "edit": True, "delete": True},
        "settings": {"view": True, "create": True, "edit": True, "delete": False},
    },
    "Dispatcher": {
        "tickets": {"view": True, "create": True, "edit": True, "delete": False},
        "clients": {"view": True, "create": True, "edit": False, "delete": False},
        "invoices": {"view": True, "create": False, "edit": False, "delete": False},
        "products": {"view": True, "create": False, "edit": False, "delete": False},
        "devices": {"view": True, "create": False, "edit": False, "delete": False},
        "networking": {"view": True, "create": False, "edit": False, "delete": False},
        "assets": {"view": True, "create": False, "edit": False, "delete": False},
        "reports": {"view": True, "create": False, "edit": False, "delete": False},
        "knowledge_base": {"view": True, "create": False, "edit": False, "delete": False},
        "it_docs": {"view": False, "create": False, "edit": False, "delete": False},
        "contracts": {"view": False, "create": False, "edit": False, "delete": False},
        "projects": {"view": True, "create": False, "edit": False, "delete": False},
        "time_tracking": {"view": True, "create": True, "edit": True, "delete": False},
        "purchase_orders": {"view": False, "create": False, "edit": False, "delete": False},
        "scheduling": {"view": True, "create": True, "edit": True, "delete": True},
        "settings": {"view": False, "create": False, "edit": False, "delete": False},
    },
}

@api_router.get("/technicians/permission-presets")
async def get_permission_presets(current_user: dict = Depends(get_current_user)):
    return PERMISSION_PRESETS

@api_router.put("/technicians/{tech_id}/permissions")
async def update_technician_permissions(tech_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Only admins can modify permissions")
    update = {}
    if "permissions" in data:
        update["permissions"] = data["permissions"]
    if "is_admin" in data:
        update["is_admin"] = data["is_admin"]
    if "job_title" in data:
        update["job_title"] = data["job_title"]
    if update:
        await db.users.update_one({"id": tech_id}, {"$set": update})
    return {"message": "Permissions updated"}

@api_router.get("/technicians/leaderboard")
async def get_technician_leaderboard(current_user: dict = Depends(get_current_user)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    all_tickets = await db.tickets.find({}, {"_id": 0}).to_list(10000)
    leaderboard = []
    for u in users:
        uid = u["id"]
        assigned = [t for t in all_tickets if t.get("assigned_to") == uid]
        closed_this_month = [t for t in assigned if t.get("status") in ("resolved", "closed") and t.get("resolved_at", t.get("updated_at", "")) >= month_start.isoformat()]
        closed_total = [t for t in assigned if t.get("status") in ("resolved", "closed")]
        time_entries = await db.ticket_time_entries.find({"user_id": uid}, {"_id": 0}).to_list(5000)
        month_entries = [e for e in time_entries if e.get("created_at", "") >= month_start.isoformat()]
        total_hours = round(sum(e.get("minutes", 0) for e in time_entries) / 60, 1)
        month_hours = round(sum(e.get("minutes", 0) for e in month_entries) / 60, 1)
        avg_resolution = 0
        resolved_with_time = [t for t in closed_total if t.get("resolved_at") and t.get("created_at")]
        if resolved_with_time:
            deltas = []
            for t in resolved_with_time:
                try:
                    c = datetime.fromisoformat(str(t["created_at"]).replace("Z", "+00:00"))
                    r = datetime.fromisoformat(str(t["resolved_at"]).replace("Z", "+00:00"))
                    deltas.append((r - c).total_seconds() / 3600)
                except:
                    pass
            if deltas:
                avg_resolution = round(sum(deltas) / len(deltas), 1)
        csat_total = sum(1 for t in closed_total if t.get("satisfaction_rating"))
        csat_positive = sum(1 for t in closed_total if t.get("satisfaction_rating", 0) >= 4)
        csat_score = round((csat_positive / csat_total * 100) if csat_total > 0 else 0, 1)
        leaderboard.append({
            "id": uid, "name": u["name"], "email": u["email"], "role": u.get("role", "technician"),
            "job_title": u.get("job_title", ""), "avatar": u.get("avatar"),
            "is_active": u.get("is_active", True),
            "closed_this_month": len(closed_this_month), "closed_total": len(closed_total),
            "total_assigned": len(assigned), "total_hours": total_hours,
            "month_hours": month_hours, "avg_resolution_hours": avg_resolution,
            "csat_score": csat_score, "specialties": u.get("specialties", []),
        })
    leaderboard.sort(key=lambda x: x["closed_this_month"], reverse=True)
    for i, entry in enumerate(leaderboard):
        entry["rank"] = i + 1
    return {"month": now.strftime("%B %Y"), "leaderboard": leaderboard}

@api_router.get("/technicians/{tech_id}/history")
async def get_technician_history(tech_id: str, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")
    all_tickets = await db.tickets.find({"assigned_to": tech_id}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    resolved = [t for t in all_tickets if t.get("status") in ("resolved", "closed")]
    now = datetime.now(timezone.utc)
    monthly_data = {}
    for i in range(6):
        d = now - timedelta(days=30 * i)
        key = d.strftime("%Y-%m")
        label = d.strftime("%b %Y")
        month_start = d.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if d.month == 12:
            month_end = month_start.replace(year=d.year + 1, month=1)
        else:
            month_end = month_start.replace(month=d.month + 1)
        closed_in_month = [t for t in resolved if month_start.isoformat() <= t.get("resolved_at", t.get("updated_at", "")) < month_end.isoformat()]
        opened_in_month = [t for t in all_tickets if month_start.isoformat() <= t.get("created_at", "") < month_end.isoformat()]
        monthly_data[key] = {"label": label, "closed": len(closed_in_month), "opened": len(opened_in_month)}
    recent_resolved = resolved[:20]
    return {
        "technician": {"id": user["id"], "name": user["name"]},
        "total_tickets": len(all_tickets), "total_resolved": len(resolved),
        "monthly": list(reversed(monthly_data.values())),
        "recent_resolved": recent_resolved,
    }

@api_router.put("/technicians/{tech_id}/email-signature")
async def update_email_signature(tech_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    sig_data = {
        "email_signature": data.get("email_signature", ""),
        "email_signature_html": data.get("email_signature_html", ""),
        "signature_config": data.get("signature_config", {}),
    }
    await db.users.update_one({"id": tech_id}, {"$set": sig_data})
    return {"message": "Email signature updated"}

@api_router.get("/technicians/{tech_id}/email-signature")
async def get_email_signature(tech_id: str, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": tech_id}, {"_id": 0, "email_signature": 1, "email_signature_html": 1, "signature_config": 1, "name": 1, "email": 1, "phone": 1, "job_title": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")
    return user

@api_router.get("/settings/email-signature-templates")
async def get_signature_templates(current_user: dict = Depends(get_current_user)):
    return [
        {"id": "professional", "name": "Professional", "description": "Clean, corporate style with company branding"},
        {"id": "modern", "name": "Modern", "description": "Sleek design with social links and gradient accent"},
        {"id": "minimal", "name": "Minimal", "description": "Simple text-based signature with essential info"},
        {"id": "technical", "name": "Technical", "description": "Tech-focused with certifications and skills"},
    ]

# ============== SCHEDULING ENDPOINTS ==============

@api_router.get("/schedule")
async def get_schedule(current_user: dict = Depends(get_current_user)):
    entries = await db.schedule_entries.find({}, {"_id": 0}).to_list(5000)
    return entries

@api_router.post("/schedule")
async def create_schedule_entry(entry_data: dict, current_user: dict = Depends(get_current_user)):
    entry = {
        "id": str(uuid.uuid4()),
        "ticket_id": entry_data.get("ticket_id"),
        "ticket_number": entry_data.get("ticket_number", ""),
        "ticket_title": entry_data.get("ticket_title", ""),
        "technician_id": entry_data.get("technician_id"),
        "technician_name": entry_data.get("technician_name", ""),
        "start": entry_data.get("start"),
        "end": entry_data.get("end"),
        "notes": entry_data.get("notes", ""),
        "color": entry_data.get("color", "#3B82F6"),
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.schedule_entries.insert_one(entry)
    entry.pop("_id", None)
    return entry

@api_router.put("/schedule/{entry_id}")
async def update_schedule_entry(entry_id: str, entry_data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"start", "end", "technician_id", "technician_name", "notes", "color"}
    update = {k: v for k, v in entry_data.items() if k in allowed}
    await db.schedule_entries.update_one({"id": entry_id}, {"$set": update})
    return {"message": "Schedule entry updated"}

@api_router.delete("/schedule/{entry_id}")
async def delete_schedule_entry(entry_id: str, current_user: dict = Depends(get_current_user)):
    await db.schedule_entries.delete_one({"id": entry_id})
    return {"message": "Schedule entry deleted"}

# ============== PRODUCTS ENDPOINTS ==============

@api_router.get("/products/categories")
async def get_product_categories(current_user: dict = Depends(get_current_user)):
    products = await db.products.find({}, {"_id": 0, "category": 1}).to_list(10000)
    cats = list(set(p.get("category", "General") for p in products))
    return sorted(cats) if cats else ["Hardware", "Software", "Licensing", "Services", "Accessories"]

@api_router.get("/products")
async def get_products(category: Optional[str] = None, search: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if category:
        query["category"] = category
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"sku": {"$regex": search, "$options": "i"}},
            {"vendor": {"$regex": search, "$options": "i"}},
        ]
    products = await db.products.find(query, {"_id": 0}).to_list(5000)
    return products

@api_router.post("/products")
async def create_product(data: dict, current_user: dict = Depends(get_current_user)):
    barcode_value = data.get("barcode", data.get("sku", ""))
    barcode_type = data.get("barcode_type", "code128")
    barcode_image = ""
    if barcode_value:
        barcode_image = generate_barcode_svg_data(barcode_value, barcode_type)
    product = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "sku": data.get("sku", ""),
        "description": data.get("description", ""),
        "category": data.get("category", "General"),
        "vendor": data.get("vendor", ""),
        "cost_price": float(data.get("cost_price", 0)),
        "retail_price": float(data.get("retail_price", 0)),
        "tax_rate": float(data.get("tax_rate", 0)),
        "quantity_in_stock": int(data.get("quantity_in_stock", 0)),
        "reorder_level": int(data.get("reorder_level", 5)),
        "unit": data.get("unit", "each"),
        "is_active": data.get("is_active", True),
        "is_taxable": data.get("is_taxable", True),
        "is_recurring": data.get("is_recurring", False),
        "billing_cycle": data.get("billing_cycle", "monthly"),
        "barcode": barcode_value,
        "barcode_type": barcode_type,
        "barcode_image": barcode_image,
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.products.insert_one(product)
    product.pop("_id", None)
    return product

@api_router.get("/products/{product_id}")
async def get_product(product_id: str, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

@api_router.put("/products/{product_id}")
async def update_product(product_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"name", "sku", "description", "category", "vendor", "cost_price", "retail_price",
               "tax_rate", "quantity_in_stock", "reorder_level", "unit", "is_active", "is_taxable",
               "is_recurring", "billing_cycle", "barcode", "barcode_type"}
    update = {k: v for k, v in data.items() if k in allowed}
    if "cost_price" in update:
        update["cost_price"] = float(update["cost_price"])
    if "retail_price" in update:
        update["retail_price"] = float(update["retail_price"])
    if "tax_rate" in update:
        update["tax_rate"] = float(update["tax_rate"])
    if "quantity_in_stock" in update:
        update["quantity_in_stock"] = int(update["quantity_in_stock"])
    if "reorder_level" in update:
        update["reorder_level"] = int(update["reorder_level"])
    if "barcode" in update and update["barcode"]:
        update["barcode_image"] = generate_barcode_svg_data(update["barcode"], update.get("barcode_type", "code128"))
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.products.update_one({"id": product_id}, {"$set": update})
    return {"message": "Product updated"}

@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, current_user: dict = Depends(get_current_user)):
    await db.products.delete_one({"id": product_id})
    return {"message": "Product deleted"}

# ============== PRODUCT BARCODE & STOCK ENDPOINTS ==============

def generate_barcode_svg_data(code: str, barcode_type: str = "code128") -> str:
    """Generate a barcode and return as base64 SVG data URI."""
    try:
        barcode_class = barcode.get_barcode_class(barcode_type.lower())
        bc = barcode_class(code, writer=SVGWriter())
        output = BytesIO()
        bc.write(output)
        output.seek(0)
        encoded = base64.b64encode(output.getvalue()).decode()
        return f"data:image/svg+xml;base64,{encoded}"
    except Exception as e:
        logger.error(f"Barcode generation error: {e}")
        return ""

@api_router.post("/products/{product_id}/generate-barcode")
async def generate_product_barcode(product_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    barcode_type = data.get("barcode_type", "code128")
    barcode_value = data.get("barcode_value", product.get("sku", product_id[:12]))
    if not barcode_value:
        barcode_value = str(uuid.uuid4())[:12].replace("-", "").upper()
    barcode_image = generate_barcode_svg_data(barcode_value, barcode_type)
    await db.products.update_one({"id": product_id}, {"$set": {
        "barcode": barcode_value, "barcode_type": barcode_type, "barcode_image": barcode_image,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }})
    return {"barcode": barcode_value, "barcode_type": barcode_type, "barcode_image": barcode_image}

@api_router.get("/products/{product_id}/barcode")
async def get_product_barcode(product_id: str, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0, "barcode": 1, "barcode_type": 1, "barcode_image": 1, "name": 1, "sku": 1})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not product.get("barcode"):
        barcode_value = product.get("sku", product_id[:12])
        barcode_image = generate_barcode_svg_data(barcode_value, "code128")
        return {"barcode": barcode_value, "barcode_type": "code128", "barcode_image": barcode_image, "name": product.get("name"), "sku": product.get("sku")}
    return product

# Product Instances (individual items with unique barcodes)
@api_router.get("/products/{product_id}/instances")
async def get_product_instances(product_id: str, current_user: dict = Depends(get_current_user)):
    instances = await db.product_instances.find({"product_id": product_id}, {"_id": 0}).to_list(5000)
    return instances

@api_router.post("/products/{product_id}/instances")
async def create_product_instance(product_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    count = data.get("count", 1)
    instances = []
    for _ in range(min(count, 100)):
        serial = data.get("serial_number", str(uuid.uuid4())[:8].upper())
        barcode_value = f"{product.get('sku', 'PRD')}-{serial}"
        barcode_image = generate_barcode_svg_data(barcode_value, "code128")
        instance = {
            "id": str(uuid.uuid4()), "product_id": product_id, "product_name": product["name"],
            "serial_number": serial, "barcode": barcode_value, "barcode_image": barcode_image,
            "status": data.get("status", "in_stock"), "location": data.get("location", "Warehouse"),
            "assigned_to": None, "ticket_id": None, "invoice_id": None,
            "notes": data.get("notes", ""), "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.product_instances.insert_one(instance)
        instance.pop("_id", None)
        instances.append(instance)
    # Update stock count
    current_stock = product.get("quantity_in_stock", 0)
    await db.products.update_one({"id": product_id}, {"$set": {"quantity_in_stock": current_stock + count, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return instances

# Stock Movements
@api_router.get("/products/{product_id}/stock-movements")
async def get_stock_movements(product_id: str, current_user: dict = Depends(get_current_user)):
    movements = await db.stock_movements.find({"product_id": product_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return movements

@api_router.post("/products/{product_id}/stock-movement")
async def create_stock_movement(product_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    movement_type = data.get("type", "in")  # in, out, adjustment
    quantity = int(data.get("quantity", 0))
    current_stock = product.get("quantity_in_stock", 0)
    if movement_type == "in":
        new_stock = current_stock + quantity
    elif movement_type == "out":
        new_stock = max(0, current_stock - quantity)
    else:
        new_stock = quantity  # adjustment sets exact value
    movement = {
        "id": str(uuid.uuid4()), "product_id": product_id, "product_name": product["name"],
        "type": movement_type, "quantity": quantity, "previous_stock": current_stock, "new_stock": new_stock,
        "reason": data.get("reason", ""), "reference": data.get("reference", ""),
        "ticket_id": data.get("ticket_id"), "invoice_id": data.get("invoice_id"),
        "created_by": current_user["id"], "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.stock_movements.insert_one(movement)
    movement.pop("_id", None)
    await db.products.update_one({"id": product_id}, {"$set": {"quantity_in_stock": new_stock, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return movement

# Label printing endpoint - returns HTML for print
@api_router.get("/products/{product_id}/label")
async def get_product_label(product_id: str, instance_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    barcode_value = product.get("barcode", product.get("sku", product_id[:12]))
    barcode_image = product.get("barcode_image", generate_barcode_svg_data(barcode_value, "code128"))
    if instance_id:
        instance = await db.product_instances.find_one({"id": instance_id}, {"_id": 0})
        if instance:
            barcode_value = instance.get("barcode", barcode_value)
            barcode_image = instance.get("barcode_image", barcode_image)
    return {
        "product_name": product["name"], "sku": product.get("sku", ""),
        "barcode": barcode_value, "barcode_image": barcode_image,
        "retail_price": product.get("retail_price", 0), "category": product.get("category", ""),
        "vendor": product.get("vendor", ""),
    }

# Link product to ticket
@api_router.post("/tickets/{ticket_id}/products")
async def add_product_to_ticket(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    product = await db.products.find_one({"id": data.get("product_id")}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    quantity = int(data.get("quantity", 1))
    line_item = {
        "id": str(uuid.uuid4()), "product_id": product["id"], "product_name": product["name"],
        "sku": product.get("sku", ""), "quantity": quantity,
        "unit_price": product.get("retail_price", 0),
        "total": quantity * product.get("retail_price", 0),
    }
    await db.tickets.update_one({"id": ticket_id}, {"$push": {"products": line_item}})
    # Stock movement out
    current_stock = product.get("quantity_in_stock", 0)
    await db.products.update_one({"id": product["id"]}, {"$set": {"quantity_in_stock": max(0, current_stock - quantity)}})
    await db.stock_movements.insert_one({
        "id": str(uuid.uuid4()), "product_id": product["id"], "product_name": product["name"],
        "type": "out", "quantity": quantity, "previous_stock": current_stock,
        "new_stock": max(0, current_stock - quantity), "reason": f"Added to ticket {ticket_id}",
        "reference": ticket_id, "ticket_id": ticket_id,
        "created_by": current_user["id"], "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return line_item

# Get products on a ticket
@api_router.get("/tickets/{ticket_id}/products")
async def get_ticket_products(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "products": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket.get("products", [])

# ============== NETWORKING / UNIFI ENDPOINTS ==============

@api_router.get("/networking/sites")
async def get_networking_sites(current_user: dict = Depends(get_current_user)):
    sites = await db.network_sites.find({}, {"_id": 0}).to_list(100)
    return sites

@api_router.post("/networking/sites")
async def create_networking_site(data: dict, current_user: dict = Depends(get_current_user)):
    site = {
        "id": str(uuid.uuid4()), "name": data.get("name", ""),
        "client_id": data.get("client_id"), "client_name": data.get("client_name", ""),
        "controller_url": data.get("controller_url", ""), "site_id": data.get("site_id", "default"),
        "status": "online", "location": data.get("location", ""),
        "wan_ip": data.get("wan_ip", ""), "isp": data.get("isp", ""),
        "download_speed_mbps": data.get("download_speed_mbps", 0),
        "upload_speed_mbps": data.get("upload_speed_mbps", 0),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.network_sites.insert_one(site)
    site.pop("_id", None)
    return site

@api_router.get("/networking/sites/{site_id}")
async def get_networking_site(site_id: str, current_user: dict = Depends(get_current_user)):
    site = await db.network_sites.find_one({"id": site_id}, {"_id": 0})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return site

@api_router.put("/networking/sites/{site_id}")
async def update_networking_site(site_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"name", "client_id", "client_name", "controller_url", "site_id", "location",
               "wan_ip", "isp", "download_speed_mbps", "upload_speed_mbps", "status",
               "api_key", "username", "password", "verify_ssl", "notes"}
    update = {k: v for k, v in data.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.network_sites.update_one({"id": site_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Site not found")
    return {"message": "Site updated"}

@api_router.delete("/networking/sites/{site_id}")
async def delete_networking_site(site_id: str, current_user: dict = Depends(get_current_user)):
    await db.network_sites.delete_one({"id": site_id})
    await db.network_devices.delete_many({"site_id": site_id})
    await db.network_clients.delete_many({"site_id": site_id})
    return {"message": "Site and associated devices deleted"}

@api_router.post("/networking/sites/{site_id}/test-connection")
async def test_site_connection(site_id: str, current_user: dict = Depends(get_current_user)):
    site = await db.network_sites.find_one({"id": site_id}, {"_id": 0})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    controller_url = site.get("controller_url", "")
    if not controller_url:
        return {"success": False, "message": "No controller URL configured"}
    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.get(f"{controller_url}/api/s/default/stat/health")
            if resp.status_code in (200, 401, 403):
                await db.network_sites.update_one({"id": site_id}, {"$set": {"last_connection_test": datetime.now(timezone.utc).isoformat(), "connection_status": "reachable"}})
                return {"success": True, "message": f"Controller reachable (HTTP {resp.status_code})"}
    except Exception as e:
        await db.network_sites.update_one({"id": site_id}, {"$set": {"last_connection_test": datetime.now(timezone.utc).isoformat(), "connection_status": "unreachable"}})
        return {"success": False, "message": f"Connection failed: {str(e)[:100]}"}
    return {"success": False, "message": "Unknown error"}

@api_router.post("/networking/sites/{site_id}/adopt-device")
async def adopt_network_device(site_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    site = await db.network_sites.find_one({"id": site_id}, {"_id": 0})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    device = {
        "id": str(uuid.uuid4()), "site_id": site_id,
        "name": data.get("name", "New Device"), "mac": data.get("mac", ""),
        "model": data.get("model", "Unknown"), "device_type": data.get("device_type", "ap"),
        "ip_address": data.get("ip_address", ""), "status": "pending_adoption",
        "firmware": data.get("firmware", ""), "uptime_seconds": 0,
        "cpu_usage": 0, "mem_usage": 0, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.network_devices.insert_one(device)
    device.pop("_id", None)
    return device

@api_router.put("/networking/devices/{device_id}")
async def update_network_device(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"name", "ip_address", "status", "firmware", "notes", "device_type", "model"}
    update = {k: v for k, v in data.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.network_devices.update_one({"id": device_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device updated"}

@api_router.delete("/networking/devices/{device_id}")
async def delete_network_device(device_id: str, current_user: dict = Depends(get_current_user)):
    await db.network_devices.delete_one({"id": device_id})
    return {"message": "Device removed"}

@api_router.get("/networking/sites/{site_id}/overview")
async def get_site_overview(site_id: str, current_user: dict = Depends(get_current_user)):
    site = await db.network_sites.find_one({"id": site_id}, {"_id": 0})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    devices = await db.network_devices.find({"site_id": site_id}, {"_id": 0}).to_list(500)
    clients = await db.network_clients.find({"site_id": site_id}, {"_id": 0}).to_list(1000)
    online_devices = [d for d in devices if d.get("status") == "online"]
    aps = [d for d in devices if d.get("device_type") == "ap"]
    switches = [d for d in devices if d.get("device_type") == "switch"]
    gateways = [d for d in devices if d.get("device_type") == "gateway"]
    wireless_clients = [c for c in clients if c.get("is_wireless")]
    wired_clients = [c for c in clients if not c.get("is_wireless")]
    total_rx = sum(c.get("rx_bytes", 0) for c in clients)
    total_tx = sum(c.get("tx_bytes", 0) for c in clients)
    return {
        "site": site, "total_devices": len(devices), "online_devices": len(online_devices),
        "access_points": len(aps), "switches": len(switches), "gateways": len(gateways),
        "total_clients": len(clients), "wireless_clients": len(wireless_clients), "wired_clients": len(wired_clients),
        "total_rx_bytes": total_rx, "total_tx_bytes": total_tx,
        "health": {"wan": "healthy", "lan": "healthy", "wlan": "healthy" if aps else "n/a"},
    }

@api_router.get("/networking/sites/{site_id}/devices")
async def get_site_devices(site_id: str, device_type: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {"site_id": site_id}
    if device_type:
        query["device_type"] = device_type
    devices = await db.network_devices.find(query, {"_id": 0}).to_list(500)
    return devices

@api_router.get("/networking/sites/{site_id}/clients")
async def get_site_clients(site_id: str, connected_only: bool = False, current_user: dict = Depends(get_current_user)):
    query = {"site_id": site_id}
    if connected_only:
        query["is_connected"] = True
    clients = await db.network_clients.find(query, {"_id": 0}).to_list(1000)
    return clients

@api_router.get("/networking/stats")
async def get_networking_stats(current_user: dict = Depends(get_current_user)):
    sites = await db.network_sites.find({}, {"_id": 0}).to_list(100)
    devices = await db.network_devices.find({}, {"_id": 0}).to_list(5000)
    clients = await db.network_clients.find({}, {"_id": 0}).to_list(10000)
    online_sites = [s for s in sites if s.get("status") == "online"]
    online_devices = [d for d in devices if d.get("status") == "online"]
    aps = [d for d in devices if d.get("device_type") == "ap"]
    switches_list = [d for d in devices if d.get("device_type") == "switch"]
    gateways = [d for d in devices if d.get("device_type") == "gateway"]
    return {
        "total_sites": len(sites), "online_sites": len(online_sites),
        "total_devices": len(devices), "online_devices": len(online_devices),
        "total_clients": len(clients),
        "access_points": len(aps), "switches": len(switches_list), "gateways": len(gateways),
    }

@api_router.put("/settings/unifi")
async def update_unifi_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one({"type": "unifi"}, {"$set": {
        "type": "unifi", "controller_url": data.get("controller_url", ""),
        "username": data.get("username", ""), "password": data.get("password", ""),
        "verify_ssl": data.get("verify_ssl", False),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "UniFi settings updated"}

@api_router.get("/settings/unifi")
async def get_unifi_settings(current_user: dict = Depends(get_current_user)):
    settings_doc = await db.settings.find_one({"type": "unifi"}, {"_id": 0})
    if not settings_doc:
        return {"type": "unifi", "controller_url": "", "username": "", "verify_ssl": False}
    settings_doc.pop("password", None)
    return settings_doc

# ============== PURCHASE ORDER ENDPOINTS ==============

@api_router.get("/purchase-orders/stats")
async def get_po_stats(current_user: dict = Depends(get_current_user)):
    all_pos = await db.purchase_orders.find({}, {"_id": 0}).to_list(10000)
    total = len(all_pos)
    draft = len([p for p in all_pos if p.get("status") == "draft"])
    submitted = len([p for p in all_pos if p.get("status") == "submitted"])
    received = len([p for p in all_pos if p.get("status") == "received"])
    total_value = sum(p.get("total", 0) for p in all_pos)
    pending_value = sum(p.get("total", 0) for p in all_pos if p.get("status") in ("draft", "submitted"))
    return {
        "total": total, "draft": draft, "submitted": submitted, "received": received,
        "total_value": round(total_value, 2), "pending_value": round(pending_value, 2)
    }

@api_router.get("/purchase-orders")
async def get_purchase_orders(status: Optional[str] = None, search: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if status:
        query["status"] = status
    if search:
        query["$or"] = [
            {"po_number": {"$regex": search, "$options": "i"}},
            {"vendor": {"$regex": search, "$options": "i"}},
        ]
    pos = await db.purchase_orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return pos

@api_router.post("/purchase-orders")
async def create_purchase_order(data: dict, current_user: dict = Depends(get_current_user)):
    count = await db.purchase_orders.count_documents({})
    po = {
        "id": str(uuid.uuid4()),
        "po_number": f"PO-{count + 1001:04d}",
        "vendor": data.get("vendor", ""),
        "vendor_contact": data.get("vendor_contact", ""),
        "vendor_email": data.get("vendor_email", ""),
        "status": data.get("status", "draft"),
        "line_items": data.get("line_items", []),
        "subtotal": float(data.get("subtotal", 0)),
        "tax": float(data.get("tax", 0)),
        "shipping": float(data.get("shipping", 0)),
        "total": float(data.get("total", 0)),
        "notes": data.get("notes", ""),
        "ship_to": data.get("ship_to", ""),
        "expected_delivery": data.get("expected_delivery", ""),
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.purchase_orders.insert_one(po)
    po.pop("_id", None)
    return po

@api_router.get("/purchase-orders/{po_id}")
async def get_purchase_order(po_id: str, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po

@api_router.put("/purchase-orders/{po_id}")
async def update_purchase_order(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"vendor", "vendor_contact", "vendor_email", "status", "line_items", "subtotal",
               "tax", "shipping", "total", "notes", "ship_to", "expected_delivery", "client_id", "client_name"}
    update = {k: v for k, v in data.items() if k in allowed}
    for f in ("subtotal", "tax", "shipping", "total"):
        if f in update:
            update[f] = float(update[f])
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.purchase_orders.update_one({"id": po_id}, {"$set": update})
    return {"message": "Purchase order updated"}

@api_router.delete("/purchase-orders/{po_id}")
async def delete_purchase_order(po_id: str, current_user: dict = Depends(get_current_user)):
    await db.purchase_orders.delete_one({"id": po_id})
    return {"message": "Purchase order deleted"}

# ============== DOMOTZ ENDPOINTS ==============

@api_router.get("/domotz/status")
async def get_domotz_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "domotz"}, {"_id": 0})
    return {"configured": bool(settings and settings.get('api_key'))}

@api_router.post("/domotz/settings")
async def save_domotz_settings(settings: DomotzSettings, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "domotz"},
        {"$set": {
            "type": "domotz",
            "api_key": settings.api_key,
            "api_url": settings.api_url,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"message": "Domotz settings saved"}

@api_router.get("/domotz/test-connection")
async def test_domotz_connection(current_user: dict = Depends(get_current_user)):
    try:
        agents = await domotz_service.get_agents()
        return {"success": True, "message": f"Connected! Found {len(agents) if isinstance(agents, list) else 0} agents"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@api_router.get("/domotz/agents")
async def get_domotz_agents(page: int = 0, page_size: int = 50, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_agents(page, page_size)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/domotz/agents/{agent_id}")
async def get_domotz_agent(agent_id: int, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_agent(agent_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/domotz/agents/{agent_id}/devices")
async def get_domotz_agent_devices(agent_id: int, page: int = 0, page_size: int = 100, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_agent_devices(agent_id, page, page_size)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/domotz/agents/{agent_id}/devices/{device_id}")
async def get_domotz_device(agent_id: int, device_id: int, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_device(agent_id, device_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/domotz/agents/{agent_id}/devices/{device_id}/details")
async def get_domotz_device_details(agent_id: int, device_id: int, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_device_details(agent_id, device_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/domotz/agents/{agent_id}/devices/{device_id}/power/{action}")
async def execute_domotz_power_action(agent_id: int, device_id: int, action: str, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.execute_power_action(agent_id, device_id, action)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/domotz/alerts")
async def get_domotz_alerts(agent_id: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_alerts(agent_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============== RUSTDESK / REMOTE ACCESS ENDPOINTS ==============

@api_router.get("/remote/status")
async def get_remote_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "rustdesk"}, {"_id": 0})
    return {"configured": bool(settings and settings.get('server_url'))}

@api_router.post("/remote/settings")
async def save_remote_settings(settings: RustDeskSettings, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "rustdesk"},
        {"$set": {
            "type": "rustdesk",
            "server_url": settings.server_url,
            "api_key": settings.api_key,
            "relay_server": settings.relay_server,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"message": "RustDesk settings saved"}

@api_router.get("/remote/settings")
async def get_remote_settings(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "rustdesk"}, {"_id": 0})
    if not settings:
        return {"configured": False}
    return {
        "configured": True,
        "server_url": settings.get('server_url'),
        "relay_server": settings.get('relay_server')
    }

@api_router.get("/remote/agents")
async def get_remote_agents(current_user: dict = Depends(get_current_user)):
    """Get available remote agent downloads"""
    agents = [
        {
            "id": "windows-x64",
            "name": "NexusOps Agent for Windows",
            "platform": "windows",
            "arch": "x64",
            "version": "1.3.2",
            "download_url": "https://github.com/rustdesk/rustdesk/releases/download/1.3.2/rustdesk-1.3.2-x86_64.exe",
            "size": "18.5 MB",
            "instructions": "1. Download and run the installer\n2. Enter your RustDesk ID server address\n3. Note your device ID for remote access"
        },
        {
            "id": "windows-x86",
            "name": "NexusOps Agent for Windows (32-bit)",
            "platform": "windows",
            "arch": "x86",
            "version": "1.3.2",
            "download_url": "https://github.com/rustdesk/rustdesk/releases/download/1.3.2/rustdesk-1.3.2-x86-sciter.exe",
            "size": "12.3 MB",
            "instructions": "1. Download and run the installer\n2. Enter your RustDesk ID server address\n3. Note your device ID for remote access"
        },
        {
            "id": "macos-universal",
            "name": "NexusOps Agent for macOS",
            "platform": "macos",
            "arch": "universal",
            "version": "1.3.2",
            "download_url": "https://github.com/rustdesk/rustdesk/releases/download/1.3.2/rustdesk-1.3.2.dmg",
            "size": "22.1 MB",
            "instructions": "1. Download and open the DMG file\n2. Drag RustDesk to Applications\n3. Open and configure server settings\n4. Grant accessibility permissions when prompted"
        },
        {
            "id": "linux-x64",
            "name": "NexusOps Agent for Linux (Debian/Ubuntu)",
            "platform": "linux",
            "arch": "x64",
            "version": "1.3.2",
            "download_url": "https://github.com/rustdesk/rustdesk/releases/download/1.3.2/rustdesk-1.3.2-x86_64.deb",
            "size": "15.8 MB",
            "instructions": "1. Download the .deb package\n2. Install: sudo dpkg -i rustdesk-*.deb\n3. Run: rustdesk\n4. Configure server settings"
        },
        {
            "id": "linux-rpm",
            "name": "NexusOps Agent for Linux (RHEL/Fedora)",
            "platform": "linux",
            "arch": "x64",
            "version": "1.3.2",
            "download_url": "https://github.com/rustdesk/rustdesk/releases/download/1.3.2/rustdesk-1.3.2-0.x86_64.rpm",
            "size": "16.2 MB",
            "instructions": "1. Download the .rpm package\n2. Install: sudo rpm -i rustdesk-*.rpm\n3. Run: rustdesk\n4. Configure server settings"
        }
    ]
    return agents

@api_router.post("/remote/sessions")
async def create_remote_session(device_id: str, session_type: str = "remote_desktop", current_user: dict = Depends(get_current_user)):
    """Create a new remote session record"""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    client = await db.clients.find_one({"id": device.get("client_id")}, {"_id": 0})
    session = RemoteSession(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        client_name=client.get('name') if client else None,
        user_id=current_user['id'],
        user_name=current_user['name'],
        session_type=session_type,
        rustdesk_id=device.get('rustdesk_id'),
        device_type=device.get('device_type', 'workstation'),
    )
    doc = session.model_dump()
    doc['started_at'] = doc['started_at'].isoformat()
    await db.remote_sessions.insert_one(doc)
    await _log_activity(current_user, "remote_connect", "device", device_id, device.get("name", ""), f"Started {session_type} session on {device.get('name', '')}", metadata={"session_id": session.id, "device_type": device.get("device_type", "workstation")})
    
    return session

@api_router.get("/remote/sessions")
async def get_remote_sessions(
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if device_id:
        query["device_id"] = device_id
    if status:
        query["status"] = status
    if user_id:
        query["user_id"] = user_id
    
    sessions = await db.remote_sessions.find(query, {"_id": 0}).sort("started_at", -1).to_list(200)
    return sessions

@api_router.get("/remote/active-sessions")
async def get_active_remote_sessions(current_user: dict = Depends(get_current_user)):
    """Get all currently active remote sessions"""
    sessions = await db.remote_sessions.find({"status": "active"}, {"_id": 0}).sort("started_at", -1).to_list(100)
    # Calculate live duration for active sessions
    now = datetime.now(timezone.utc)
    for s in sessions:
        try:
            started = datetime.fromisoformat(str(s["started_at"]).replace("Z", "+00:00"))
            s["live_duration_minutes"] = int((now - started).total_seconds() / 60)
        except:
            s["live_duration_minutes"] = 0
    return sessions

@api_router.put("/remote/sessions/{session_id}/end")
async def end_remote_session(session_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    session = await db.remote_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    started_at = datetime.fromisoformat(session['started_at']) if isinstance(session['started_at'], str) else session['started_at']
    duration = int((datetime.now(timezone.utc) - started_at).total_seconds() / 60)
    
    was_locked = data.get("was_locked_before_disconnect")
    lock_action = data.get("lock_action_on_disconnect", "no_change")
    notes = data.get("notes")
    
    await db.remote_sessions.update_one(
        {"id": session_id},
        {"$set": {
            "status": "ended",
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "duration_minutes": duration,
            "notes": notes,
            "was_locked_before_disconnect": was_locked,
            "lock_action_on_disconnect": lock_action,
        }}
    )
    device_name = session.get("device_name", "")
    await _log_activity(current_user, "remote_disconnect", "device", session.get("device_id", ""), device_name, f"Ended {session.get('session_type', 'remote')} session on {device_name} ({duration}min). Lock: {lock_action}", metadata={"session_id": session_id, "duration_minutes": duration, "was_locked": was_locked, "lock_action": lock_action})
    return {"message": "Session ended", "duration_minutes": duration}

@api_router.get("/devices/{device_id}/remote-sessions")
async def get_device_remote_sessions(device_id: str, limit: int = 50, current_user: dict = Depends(get_current_user)):
    """Get remote session history for a specific device"""
    sessions = await db.remote_sessions.find({"device_id": device_id}, {"_id": 0}).sort("started_at", -1).to_list(limit)
    active_count = sum(1 for s in sessions if s.get("status") == "active")
    total_minutes = sum(s.get("duration_minutes", 0) for s in sessions if s.get("status") == "ended")
    return {
        "sessions": sessions,
        "active_count": active_count,
        "total_sessions": len(sessions),
        "total_minutes": total_minutes,
    }

@api_router.get("/technicians/{tech_id}/remote-sessions")
async def get_technician_remote_sessions(tech_id: str, limit: int = 100, current_user: dict = Depends(get_current_user)):
    """Get remote session history for a specific technician"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin") and current_user["id"] != tech_id):
        raise HTTPException(status_code=403, detail="Admin access required")
    sessions = await db.remote_sessions.find({"user_id": tech_id}, {"_id": 0}).sort("started_at", -1).to_list(limit)
    active_count = sum(1 for s in sessions if s.get("status") == "active")
    total_minutes = sum(s.get("duration_minutes", 0) for s in sessions if s.get("status") == "ended")
    unique_devices = len(set(s.get("device_id") for s in sessions))
    return {
        "sessions": sessions,
        "active_count": active_count,
        "total_sessions": len(sessions),
        "total_minutes": total_minutes,
        "unique_devices": unique_devices,
    }

# ============== DEVICE CHAT ENDPOINTS ==============

@api_router.get("/devices/{device_id}/chat")
async def get_device_chat(device_id: str, limit: int = 100, current_user: dict = Depends(get_current_user)):
    """Get chat messages for a device"""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    messages = await db.device_chat.find(
        {"device_id": device_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    
    return {"device": device, "messages": list(reversed(messages))}

@api_router.post("/devices/{device_id}/chat")
async def send_device_chat_message(device_id: str, message_data: DeviceChatMessageCreate, current_user: dict = Depends(get_current_user)):
    """Send a chat message to a device"""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    chat_message = DeviceChatMessage(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        client_name=device.get('client_name'),
        user_id=current_user['id'],
        user_name=current_user['name'],
        message=message_data.message,
        message_type=message_data.message_type,
        direction="outbound"
    )
    doc = chat_message.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.device_chat.insert_one(doc)
    
    return chat_message

@api_router.post("/devices/{device_id}/chat/command")
async def send_device_command(device_id: str, command: str, current_user: dict = Depends(get_current_user)):
    """Send a remote command to a device"""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    # Create command message
    chat_message = DeviceChatMessage(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        client_name=device.get('client_name'),
        user_id=current_user['id'],
        user_name=current_user['name'],
        message=command,
        message_type="command",
        direction="outbound",
        metadata={"command": command, "executed": False}
    )
    doc = chat_message.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.device_chat.insert_one(doc)
    
    # Simulate command execution response (in real implementation, this would be handled by the agent)
    response_message = DeviceChatMessage(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        client_name=device.get('client_name'),
        user_id="system",
        user_name="System",
        message=f"Command '{command}' queued for execution. Awaiting agent response.",
        message_type="system",
        direction="inbound",
        metadata={"command": command, "status": "queued"}
    )
    resp_doc = response_message.model_dump()
    resp_doc['created_at'] = resp_doc['created_at'].isoformat()
    await db.device_chat.insert_one(resp_doc)
    
    return {"message": "Command sent", "command_id": chat_message.id}

@api_router.post("/devices/{device_id}/chat/file")
async def send_device_file(device_id: str, filename: str, file_url: str, current_user: dict = Depends(get_current_user)):
    """Send a file to a device"""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    chat_message = DeviceChatMessage(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        client_name=device.get('client_name'),
        user_id=current_user['id'],
        user_name=current_user['name'],
        message=f"File sent: {filename}",
        message_type="file",
        direction="outbound",
        metadata={"filename": filename, "file_url": file_url}
    )
    doc = chat_message.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.device_chat.insert_one(doc)
    
    return chat_message

@api_router.delete("/devices/{device_id}/chat")
async def clear_device_chat(device_id: str, current_user: dict = Depends(get_current_user)):
    """Clear chat history for a device"""
    result = await db.device_chat.delete_many({"device_id": device_id})
    return {"message": f"Cleared {result.deleted_count} messages"}

# ============== OFFICE 365 / EMAIL ENDPOINTS ==============

@api_router.get("/office365/status")
async def get_office365_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "office365"}, {"_id": 0})
    return {"configured": bool(settings and settings.get('tenant_id') and settings.get('client_id'))}

@api_router.post("/office365/settings")
async def save_office365_settings(settings: Office365Settings, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "office365"},
        {"$set": {
            "type": "office365",
            "tenant_id": settings.tenant_id,
            "client_id": settings.client_id,
            "client_secret": settings.client_secret,
            "redirect_uri": settings.redirect_uri,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"message": "Office 365 settings saved"}

@api_router.get("/office365/test-connection")
async def test_office365_connection(current_user: dict = Depends(get_current_user)):
    try:
        await office365_service.authenticate()
        return {"success": True, "message": "Successfully connected to Office 365"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@api_router.get("/emails")
async def get_emails(
    client_id: Optional[str] = None,
    ticket_id: Optional[str] = None,
    direction: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if ticket_id:
        query["ticket_id"] = ticket_id
    if direction:
        query["direction"] = direction
    
    emails = await db.emails.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for e in emails:
        if isinstance(e.get('created_at'), str):
            e['created_at'] = datetime.fromisoformat(e['created_at'])
    return emails

@api_router.post("/emails")
async def create_email(email_data: EmailMessageCreate, current_user: dict = Depends(get_current_user)):
    client_name = None
    if email_data.client_id:
        client = await db.clients.find_one({"id": email_data.client_id}, {"_id": 0})
        client_name = client['name'] if client else None
    
    email = EmailMessage(
        subject=email_data.subject,
        body=email_data.body,
        body_type=email_data.body_type,
        from_address=current_user.get('email', ''),
        from_name=current_user.get('name'),
        to_addresses=email_data.to_addresses,
        cc_addresses=email_data.cc_addresses,
        client_id=email_data.client_id,
        client_name=client_name,
        ticket_id=email_data.ticket_id,
        direction="outbound",
        status="draft"
    )
    doc = email.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.emails.insert_one(doc)
    return email

@api_router.post("/emails/{email_id}/send")
async def send_email(email_id: str, current_user: dict = Depends(get_current_user)):
    email = await db.emails.find_one({"id": email_id}, {"_id": 0})
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    try:
        # Try to send via Office 365 if configured
        status = await get_office365_status(current_user)
        if status['configured']:
            await office365_service.send_email(
                from_address=email['from_address'],
                to_addresses=email['to_addresses'],
                subject=email['subject'],
                body=email['body'],
                body_type=email['body_type']
            )
        
        await db.emails.update_one(
            {"id": email_id},
            {"$set": {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat()}}
        )
        return {"message": "Email sent successfully"}
    except Exception as e:
        await db.emails.update_one({"id": email_id}, {"$set": {"status": "failed"}})
        raise HTTPException(status_code=500, detail=str(e))

# ============== ACRONIS ENDPOINTS ==============

@api_router.get("/acronis/status")
async def get_acronis_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "acronis"}, {"_id": 0})
    return {"configured": bool(settings and settings.get('api_url') and settings.get('client_id'))}

@api_router.post("/acronis/settings")
async def save_acronis_settings(settings: AcronisSettings, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "acronis"},
        {"$set": {
            "type": "acronis",
            "api_url": settings.api_url,
            "client_id": settings.client_id,
            "client_secret": settings.client_secret,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"message": "Acronis settings saved"}

@api_router.get("/acronis/test-connection")
async def test_acronis_connection(current_user: dict = Depends(get_current_user)):
    try:
        await acronis_service.authenticate()
        return {"success": True, "message": "Successfully connected to Acronis"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@api_router.get("/acronis/subscriptions")
async def get_acronis_subscriptions(
    client_id: Optional[str] = None,
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if device_id:
        query["device_id"] = device_id
    if status:
        query["status"] = status
    
    subscriptions = await db.acronis_subscriptions.find(query, {"_id": 0}).to_list(1000)
    for s in subscriptions:
        if isinstance(s.get('created_at'), str):
            s['created_at'] = datetime.fromisoformat(s['created_at'])
    return subscriptions

@api_router.post("/acronis/subscriptions")
async def create_acronis_subscription(sub_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    device_name = None
    
    if sub_data.get('client_id'):
        client = await db.clients.find_one({"id": sub_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    if sub_data.get('device_id'):
        device = await db.devices.find_one({"id": sub_data['device_id']}, {"_id": 0})
        device_name = device['name'] if device else None
    
    subscription = AcronisSubscription(
        client_id=sub_data.get('client_id', ''),
        client_name=client_name,
        device_id=sub_data.get('device_id'),
        device_name=device_name,
        product_name=sub_data.get('product_name', 'Acronis Cyber Protect'),
        edition=sub_data.get('edition', 'Standard'),
        status=sub_data.get('status', 'active'),
        license_type=sub_data.get('license_type', 'per_device'),
        quantity=sub_data.get('quantity', 1),
        storage_quota_gb=sub_data.get('storage_quota_gb'),
        storage_used_gb=sub_data.get('storage_used_gb'),
        expiry_date=sub_data.get('expiry_date')
    )
    doc = subscription.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('last_backup'):
        doc['last_backup'] = doc['last_backup'].isoformat()
    if doc.get('synced_at'):
        doc['synced_at'] = doc['synced_at'].isoformat()
    await db.acronis_subscriptions.insert_one(doc)
    return subscription

@api_router.put("/acronis/subscriptions/{subscription_id}")
async def update_acronis_subscription(subscription_id: str, sub_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.acronis_subscriptions.update_one({"id": subscription_id}, {"$set": sub_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"message": "Subscription updated"}

@api_router.delete("/acronis/subscriptions/{subscription_id}")
async def delete_acronis_subscription(subscription_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.acronis_subscriptions.delete_one({"id": subscription_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"message": "Subscription deleted"}

@api_router.get("/acronis/dashboard")
async def get_acronis_dashboard(current_user: dict = Depends(get_current_user)):
    """Get Acronis dashboard summary"""
    total = await db.acronis_subscriptions.count_documents({})
    active = await db.acronis_subscriptions.count_documents({"status": "active"})
    expired = await db.acronis_subscriptions.count_documents({"status": "expired"})
    
    # Backup status summary
    backup_success = await db.acronis_subscriptions.count_documents({"backup_status": "success"})
    backup_warning = await db.acronis_subscriptions.count_documents({"backup_status": "warning"})
    backup_failed = await db.acronis_subscriptions.count_documents({"backup_status": "failed"})
    
    return {
        "total_subscriptions": total,
        "active": active,
        "expired": expired,
        "backup_status": {
            "success": backup_success,
            "warning": backup_warning,
            "failed": backup_failed
        }
    }

# ============== LEADS / CRM ENDPOINTS ==============

@api_router.get("/leads", response_model=List[Lead])
async def get_leads(
    status: Optional[str] = None,
    source: Optional[str] = None,
    assigned_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if source:
        query["source"] = source
    if assigned_to:
        query["assigned_to"] = assigned_to
    
    leads = await db.leads.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for l in leads:
        for field in ['created_at', 'updated_at', 'last_contact', 'next_follow_up']:
            if isinstance(l.get(field), str):
                l[field] = datetime.fromisoformat(l[field])
    return leads

@api_router.get("/leads/{lead_id}")
async def get_lead(lead_id: str, current_user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead

@api_router.post("/leads", response_model=Lead)
async def create_lead(lead_data: LeadCreate, current_user: dict = Depends(get_current_user)):
    assigned_name = None
    if lead_data.assigned_to:
        user = await db.users.find_one({"id": lead_data.assigned_to}, {"_id": 0})
        assigned_name = user['name'] if user else None
    
    lead = Lead(**lead_data.model_dump(), assigned_name=assigned_name)
    doc = lead.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    if doc.get('last_contact'):
        doc['last_contact'] = doc['last_contact'].isoformat()
    if doc.get('next_follow_up'):
        doc['next_follow_up'] = doc['next_follow_up'].isoformat()
    await db.leads.insert_one(doc)
    return lead

@api_router.put("/leads/{lead_id}")
async def update_lead(lead_id: str, lead_data: dict, current_user: dict = Depends(get_current_user)):
    lead_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    
    # Update pipeline stage based on status
    status_to_stage = {
        "new": 1, "contacted": 2, "qualified": 3, 
        "proposal": 4, "negotiation": 5, "won": 6, "lost": 0
    }
    if 'status' in lead_data:
        lead_data['pipeline_stage'] = status_to_stage.get(lead_data['status'], 1)
    
    result = await db.leads.update_one({"id": lead_id}, {"$set": lead_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"message": "Lead updated"}

@api_router.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.leads.delete_one({"id": lead_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"message": "Lead deleted"}

@api_router.post("/leads/{lead_id}/convert")
async def convert_lead_to_client(lead_id: str, current_user: dict = Depends(get_current_user)):
    """Convert a lead to a client"""
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if lead.get('converted_to_client'):
        raise HTTPException(status_code=400, detail="Lead already converted")
    
    # Create new client from lead
    client = Client(
        name=lead['company_name'],
        email=lead.get('email'),
        phone=lead.get('phone'),
        industry=lead.get('industry'),
        mrr=lead.get('estimated_value', 0)
    )
    doc = client.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.clients.insert_one(doc)
    
    # Update lead status
    await db.leads.update_one(
        {"id": lead_id},
        {"$set": {
            "status": "won",
            "pipeline_stage": 6,
            "converted_to_client": client.id,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {"message": "Lead converted to client", "client_id": client.id}

# ============== LEAD ACTIVITIES ENDPOINTS ==============

@api_router.get("/leads/{lead_id}/activities")
async def get_lead_activities(lead_id: str, current_user: dict = Depends(get_current_user)):
    activities = await db.lead_activities.find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return activities

@api_router.post("/leads/{lead_id}/activities")
async def create_lead_activity(lead_id: str, activity_data: dict, current_user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    activity = LeadActivity(
        lead_id=lead_id,
        lead_name=lead['company_name'],
        user_id=current_user['id'],
        user_name=current_user['name'],
        activity_type=activity_data.get('activity_type', 'note'),
        subject=activity_data.get('subject', ''),
        description=activity_data.get('description'),
        outcome=activity_data.get('outcome')
    )
    doc = activity.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('scheduled_at'):
        doc['scheduled_at'] = doc['scheduled_at'].isoformat()
    if doc.get('completed_at'):
        doc['completed_at'] = doc['completed_at'].isoformat()
    await db.lead_activities.insert_one(doc)
    
    # Update last contact on lead
    await db.leads.update_one(
        {"id": lead_id},
        {"$set": {"last_contact": datetime.now(timezone.utc).isoformat()}}
    )
    
    return activity

# ============== PROPOSALS ENDPOINTS ==============

@api_router.get("/proposals")
async def get_proposals(
    lead_id: Optional[str] = None,
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if lead_id:
        query["lead_id"] = lead_id
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    
    proposals = await db.proposals.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return proposals

@api_router.get("/proposals/{proposal_id}")
async def get_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    proposal = await db.proposals.find_one({"id": proposal_id}, {"_id": 0})
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return proposal

@api_router.post("/proposals")
async def create_proposal(proposal_data: dict, current_user: dict = Depends(get_current_user)):
    lead_name = None
    client_name = None
    
    if proposal_data.get('lead_id'):
        lead = await db.leads.find_one({"id": proposal_data['lead_id']}, {"_id": 0})
        lead_name = lead['company_name'] if lead else None
    
    if proposal_data.get('client_id'):
        client = await db.clients.find_one({"id": proposal_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    line_items = proposal_data.get('line_items', [])
    subtotal = sum(item.get('total', item.get('quantity', 1) * item.get('unit_price', 0)) for item in line_items)
    discount_amount = subtotal * (proposal_data.get('discount_percent', 0) / 100)
    tax_amount = (subtotal - discount_amount) * (proposal_data.get('tax_percent', 0) / 100)
    total = subtotal - discount_amount + tax_amount
    
    proposal = Proposal(
        lead_id=proposal_data.get('lead_id'),
        lead_name=lead_name,
        client_id=proposal_data.get('client_id'),
        client_name=client_name,
        title=proposal_data.get('title', 'Service Proposal'),
        description=proposal_data.get('description'),
        valid_until=proposal_data.get('valid_until'),
        line_items=line_items,
        subtotal=subtotal,
        discount_percent=proposal_data.get('discount_percent', 0),
        discount_amount=discount_amount,
        tax_percent=proposal_data.get('tax_percent', 0),
        tax_amount=tax_amount,
        total=total,
        terms_and_conditions=proposal_data.get('terms_and_conditions'),
        created_by=current_user['id']
    )
    doc = proposal.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.proposals.insert_one(doc)
    return proposal

@api_router.put("/proposals/{proposal_id}")
async def update_proposal(proposal_id: str, proposal_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.proposals.update_one({"id": proposal_id}, {"$set": proposal_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return {"message": "Proposal updated"}

@api_router.delete("/proposals/{proposal_id}")
async def delete_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.proposals.delete_one({"id": proposal_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return {"message": "Proposal deleted"}

@api_router.post("/proposals/{proposal_id}/send")
async def send_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.proposals.update_one(
        {"id": proposal_id},
        {"$set": {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return {"message": "Proposal sent"}

# ============== CRM DASHBOARD ==============

@api_router.get("/crm/dashboard")
async def get_crm_dashboard(current_user: dict = Depends(get_current_user)):
    """Get CRM dashboard stats"""
    # Lead counts by status
    total_leads = await db.leads.count_documents({})
    new_leads = await db.leads.count_documents({"status": "new"})
    qualified_leads = await db.leads.count_documents({"status": "qualified"})
    won_leads = await db.leads.count_documents({"status": "won"})
    lost_leads = await db.leads.count_documents({"status": "lost"})
    
    # Pipeline value
    pipeline = await db.leads.aggregate([
        {"$match": {"status": {"$nin": ["won", "lost"]}}},
        {"$group": {"_id": None, "total_value": {"$sum": "$estimated_value"}}}
    ]).to_list(1)
    pipeline_value = pipeline[0]['total_value'] if pipeline else 0
    
    # Proposal stats
    total_proposals = await db.proposals.count_documents({})
    sent_proposals = await db.proposals.count_documents({"status": "sent"})
    accepted_proposals = await db.proposals.count_documents({"status": "accepted"})
    
    # Revenue from proposals
    revenue = await db.proposals.aggregate([
        {"$match": {"status": "accepted"}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}}
    ]).to_list(1)
    proposal_revenue = revenue[0]['total'] if revenue else 0
    
    # Lead sources
    sources = await db.leads.aggregate([
        {"$group": {"_id": "$source", "count": {"$sum": 1}}}
    ]).to_list(10)
    
    return {
        "leads": {
            "total": total_leads,
            "new": new_leads,
            "qualified": qualified_leads,
            "won": won_leads,
            "lost": lost_leads,
            "pipeline_value": pipeline_value
        },
        "proposals": {
            "total": total_proposals,
            "sent": sent_proposals,
            "accepted": accepted_proposals,
            "revenue": proposal_revenue
        },
        "lead_sources": [{"source": s['_id'], "count": s['count']} for s in sources],
        "conversion_rate": round((won_leads / total_leads * 100) if total_leads > 0 else 0, 1)
    }

# ============== TICKET EMAIL ENDPOINTS ==============

@api_router.get("/tickets/{ticket_id}/emails")
async def get_ticket_emails(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Get all emails associated with a ticket"""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    emails = await db.ticket_emails.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return emails

@api_router.post("/tickets/{ticket_id}/emails")
async def send_ticket_email(ticket_id: str, email_data: TicketEmailCreate, current_user: dict = Depends(get_current_user)):
    """Send an email from a ticket"""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    subject = email_data.subject or f"Re: [{ticket.get('ticket_number', '')}] {ticket.get('title', '')}"
    
    ticket_email = TicketEmail(
        ticket_id=ticket_id,
        ticket_title=ticket.get('title'),
        from_address=current_user.get('email', ''),
        from_name=current_user.get('name'),
        to_addresses=email_data.to_addresses,
        cc_addresses=email_data.cc_addresses,
        subject=subject,
        body=email_data.body,
        body_type=email_data.body_type,
        client_id=ticket.get('client_id'),
        user_id=current_user['id'],
        user_name=current_user['name'],
        direction="outbound",
        status="pending"
    )
    
    # Try to send via Office 365 if configured
    try:
        status = await get_office365_status(current_user)
        if status.get('configured'):
            await office365_service.send_email(
                from_address=ticket_email.from_address,
                to_addresses=ticket_email.to_addresses,
                subject=ticket_email.subject,
                body=ticket_email.body,
                body_type=ticket_email.body_type
            )
            ticket_email.status = "sent"
            ticket_email.sent_at = datetime.now(timezone.utc)
        else:
            ticket_email.status = "sent"  # Mark as sent even in demo mode
            ticket_email.sent_at = datetime.now(timezone.utc)
    except Exception as e:
        ticket_email.status = "failed"
        logger.error(f"Failed to send ticket email: {e}")
    
    doc = ticket_email.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('sent_at'):
        doc['sent_at'] = doc['sent_at'].isoformat()
    await db.ticket_emails.insert_one(doc)
    
    # Add to ticket comments
    await db.ticket_comments.insert_one({
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": current_user['id'],
        "user_name": current_user['name'],
        "content": f"📧 Email sent to: {', '.join(email_data.to_addresses)}\n\nSubject: {subject}\n\n{email_data.body}",
        "is_internal": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return ticket_email

# ============== SCRIPTING ENDPOINTS ==============

@api_router.get("/scripts")
async def get_scripts(
    category: Optional[str] = None,
    os_target: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if category:
        query["category"] = category
    if os_target:
        query["os_target"] = os_target
    
    scripts = await db.scripts.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return scripts

@api_router.get("/scripts/{script_id}")
async def get_script(script_id: str, current_user: dict = Depends(get_current_user)):
    script = await db.scripts.find_one({"id": script_id}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    return script

@api_router.post("/scripts")
async def create_script(script_data: ScriptCreate, current_user: dict = Depends(get_current_user)):
    script = Script(
        **script_data.model_dump(),
        created_by=current_user['id'],
        created_by_name=current_user['name']
    )
    doc = script.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.scripts.insert_one(doc)
    return script

@api_router.put("/scripts/{script_id}")
async def update_script(script_id: str, script_data: dict, current_user: dict = Depends(get_current_user)):
    script_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    result = await db.scripts.update_one({"id": script_id}, {"$set": script_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Script not found")
    return {"message": "Script updated"}

@api_router.delete("/scripts/{script_id}")
async def delete_script(script_id: str, current_user: dict = Depends(get_current_user)):
    script = await db.scripts.find_one({"id": script_id}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    if script.get('is_built_in'):
        raise HTTPException(status_code=400, detail="Cannot delete built-in scripts")
    
    await db.scripts.delete_one({"id": script_id})
    return {"message": "Script deleted"}

@api_router.post("/scripts/{script_id}/execute")
async def execute_script(script_id: str, device_ids: List[str], parameters: Dict[str, Any] = {}, current_user: dict = Depends(get_current_user)):
    """Execute a script on one or more devices"""
    script = await db.scripts.find_one({"id": script_id}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    executions = []
    for device_id in device_ids:
        device = await db.devices.find_one({"id": device_id}, {"_id": 0})
        if not device:
            continue
        
        execution = ScriptExecution(
            script_id=script_id,
            script_name=script['name'],
            device_id=device_id,
            device_name=device.get('name'),
            client_id=device.get('client_id'),
            user_id=current_user['id'],
            user_name=current_user['name'],
            parameters_used=parameters,
            status="pending"
        )
        doc = execution.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        await db.script_executions.insert_one(doc)
        executions.append(execution)
    
    # Update script run count
    await db.scripts.update_one(
        {"id": script_id},
        {"$inc": {"run_count": len(executions)}, "$set": {"last_run": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"message": f"Script queued for {len(executions)} devices", "executions": executions}

@api_router.get("/script-executions")
async def get_script_executions(
    script_id: Optional[str] = None,
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if script_id:
        query["script_id"] = script_id
    if device_id:
        query["device_id"] = device_id
    if status:
        query["status"] = status
    
    executions = await db.script_executions.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return executions

# ============== SCHEDULED TASKS ENDPOINTS ==============

@api_router.get("/scheduled-tasks")
async def get_scheduled_tasks(current_user: dict = Depends(get_current_user)):
    tasks = await db.scheduled_tasks.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    return tasks

@api_router.post("/scheduled-tasks")
async def create_scheduled_task(task_data: dict, current_user: dict = Depends(get_current_user)):
    script = await db.scripts.find_one({"id": task_data.get('script_id')}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    task = ScheduledTask(
        name=task_data.get('name'),
        script_id=task_data.get('script_id'),
        script_name=script['name'],
        target_type=task_data.get('target_type', 'device'),
        target_ids=task_data.get('target_ids', []),
        schedule_type=task_data.get('schedule_type', 'once'),
        schedule_time=task_data.get('schedule_time', '09:00'),
        schedule_days=task_data.get('schedule_days', []),
        timezone=task_data.get('timezone', 'UTC'),
        enabled=task_data.get('enabled', True),
        created_by=current_user['id']
    )
    doc = task.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.scheduled_tasks.insert_one(doc)
    return task

@api_router.put("/scheduled-tasks/{task_id}")
async def update_scheduled_task(task_id: str, task_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.scheduled_tasks.update_one({"id": task_id}, {"$set": task_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task updated"}

@api_router.delete("/scheduled-tasks/{task_id}")
async def delete_scheduled_task(task_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.scheduled_tasks.delete_one({"id": task_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted"}

# ============== PATCH MANAGEMENT ENDPOINTS ==============

@api_router.get("/patch-policies")
async def get_patch_policies(current_user: dict = Depends(get_current_user)):
    policies = await db.patch_policies.find({}, {"_id": 0}).to_list(100)
    return policies

@api_router.post("/patch-policies")
async def create_patch_policy(policy_data: dict, current_user: dict = Depends(get_current_user)):
    policy = PatchPolicy(**policy_data)
    doc = policy.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.patch_policies.insert_one(doc)
    return policy

@api_router.put("/patch-policies/{policy_id}")
async def update_patch_policy(policy_id: str, policy_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.patch_policies.update_one({"id": policy_id}, {"$set": policy_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"message": "Policy updated"}

@api_router.delete("/patch-policies/{policy_id}")
async def delete_patch_policy(policy_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.patch_policies.delete_one({"id": policy_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"message": "Policy deleted"}

@api_router.get("/patches")
async def get_patches(
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if device_id:
        query["device_id"] = device_id
    if status:
        query["status"] = status
    if severity:
        query["severity"] = severity
    
    patches = await db.device_patches.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return patches

@api_router.get("/patches/dashboard")
async def get_patches_dashboard(current_user: dict = Depends(get_current_user)):
    """Get patch management dashboard stats"""
    total = await db.device_patches.count_documents({})
    available = await db.device_patches.count_documents({"status": "available"})
    approved = await db.device_patches.count_documents({"status": "approved"})
    installed = await db.device_patches.count_documents({"status": "installed"})
    failed = await db.device_patches.count_documents({"status": "failed"})
    
    critical = await db.device_patches.count_documents({"severity": "Critical", "status": {"$ne": "installed"}})
    important = await db.device_patches.count_documents({"severity": "Important", "status": {"$ne": "installed"}})
    
    return {
        "total": total,
        "available": available,
        "approved": approved,
        "installed": installed,
        "failed": failed,
        "pending_critical": critical,
        "pending_important": important
    }

@api_router.post("/patches/{patch_id}/approve")
async def approve_patch(patch_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.device_patches.update_one({"id": patch_id}, {"$set": {"status": "approved"}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Patch not found")
    return {"message": "Patch approved"}

@api_router.post("/patches/{patch_id}/hide")
async def hide_patch(patch_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.device_patches.update_one({"id": patch_id}, {"$set": {"status": "hidden"}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Patch not found")
    return {"message": "Patch hidden"}

# ============== DEVICE GROUPS ENDPOINTS ==============

@api_router.get("/device-groups")
async def get_device_groups(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    
    groups = await db.device_groups.find(query, {"_id": 0}).sort("name", 1).to_list(100)
    return groups

@api_router.post("/device-groups")
async def create_device_group(group_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if group_data.get('client_id'):
        client = await db.clients.find_one({"id": group_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    group = DeviceGroup(
        name=group_data.get('name'),
        description=group_data.get('description'),
        client_id=group_data.get('client_id'),
        client_name=client_name,
        auto_assign_rules=group_data.get('auto_assign_rules', [])
    )
    doc = group.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.device_groups.insert_one(doc)
    return group

@api_router.put("/device-groups/{group_id}")
async def update_device_group(group_id: str, group_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.device_groups.update_one({"id": group_id}, {"$set": group_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Group not found")
    return {"message": "Group updated"}

@api_router.delete("/device-groups/{group_id}")
async def delete_device_group(group_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.device_groups.delete_one({"id": group_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Group not found")
    return {"message": "Group deleted"}

@api_router.post("/device-groups/{group_id}/devices")
async def add_devices_to_group(group_id: str, device_ids: List[str], current_user: dict = Depends(get_current_user)):
    """Add devices to a group"""
    group = await db.device_groups.find_one({"id": group_id}, {"_id": 0})
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    await db.devices.update_many(
        {"id": {"$in": device_ids}},
        {"$addToSet": {"groups": group_id}}
    )
    
    await db.device_groups.update_one({"id": group_id}, {"$inc": {"device_count": len(device_ids)}})
    return {"message": f"Added {len(device_ids)} devices to group"}

# ============== POLICIES ENDPOINTS ==============

@api_router.get("/policies")
async def get_policies(policy_type: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if policy_type:
        query["policy_type"] = policy_type
    
    policies = await db.policies.find(query, {"_id": 0}).sort("priority", 1).to_list(100)
    return policies

@api_router.post("/policies")
async def create_policy(policy_data: dict, current_user: dict = Depends(get_current_user)):
    policy = Policy(
        name=policy_data.get('name'),
        description=policy_data.get('description'),
        policy_type=policy_data.get('policy_type', 'monitoring'),
        enabled=policy_data.get('enabled', True),
        priority=policy_data.get('priority', 100),
        settings=policy_data.get('settings', {}),
        scripts_to_run=policy_data.get('scripts_to_run', []),
        alert_thresholds=policy_data.get('alert_thresholds', {}),
        target_groups=policy_data.get('target_groups', []),
        target_os=policy_data.get('target_os', ['windows', 'macos', 'linux']),
        created_by=current_user['id']
    )
    doc = policy.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.policies.insert_one(doc)
    return policy

@api_router.put("/policies/{policy_id}")
async def update_policy(policy_id: str, policy_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.policies.update_one({"id": policy_id}, {"$set": policy_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"message": "Policy updated"}

@api_router.delete("/policies/{policy_id}")
async def delete_policy(policy_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.policies.delete_one({"id": policy_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"message": "Policy deleted"}

# ============== IT DOCUMENTATION ENDPOINTS ==============

@api_router.get("/passwords")
async def get_passwords(client_id: Optional[str] = None, category: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if category:
        query["category"] = category
    
    passwords = await db.passwords.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    # Mask passwords in list view
    for p in passwords:
        p['password'] = '••••••••'
    return passwords

@api_router.get("/passwords/{password_id}")
async def get_password(password_id: str, current_user: dict = Depends(get_current_user)):
    """Get a password entry (reveals actual password)"""
    password = await db.passwords.find_one({"id": password_id}, {"_id": 0})
    if not password:
        raise HTTPException(status_code=404, detail="Password not found")
    
    # Update access tracking
    await db.passwords.update_one(
        {"id": password_id},
        {"$set": {"last_accessed": datetime.now(timezone.utc).isoformat()}, "$inc": {"access_count": 1}}
    )
    
    # Log access for audit
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user['id'],
        "user_name": current_user['name'],
        "user_email": current_user['email'],
        "action": "view",
        "entity_type": "password",
        "entity_id": password_id,
        "entity_name": password.get('name'),
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return password

@api_router.post("/passwords")
async def create_password(password_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if password_data.get('client_id'):
        client = await db.clients.find_one({"id": password_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    password = PasswordEntry(
        client_id=password_data.get('client_id'),
        client_name=client_name,
        name=password_data.get('name'),
        category=password_data.get('category', 'general'),
        username=password_data.get('username'),
        password=password_data.get('password'),
        url=password_data.get('url'),
        notes=password_data.get('notes'),
        tags=password_data.get('tags', []),
        created_by=current_user['id']
    )
    doc = password.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.passwords.insert_one(doc)
    return {"id": password.id, "name": password.name, "message": "Password created"}

@api_router.put("/passwords/{password_id}")
async def update_password(password_id: str, password_data: dict, current_user: dict = Depends(get_current_user)):
    password_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    result = await db.passwords.update_one({"id": password_id}, {"$set": password_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Password not found")
    return {"message": "Password updated"}

@api_router.delete("/passwords/{password_id}")
async def delete_password(password_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.passwords.delete_one({"id": password_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Password not found")
    return {"message": "Password deleted"}

# ============== DOCUMENTATION PAGES ENDPOINTS ==============

@api_router.get("/documentation")
async def get_documentation_pages(
    client_id: Optional[str] = None,
    category: Optional[str] = None,
    is_template: bool = False,
    current_user: dict = Depends(get_current_user)
):
    query = {"is_template": is_template}
    if client_id:
        query["client_id"] = client_id
    if category:
        query["category"] = category
    
    pages = await db.documentation.find(query, {"_id": 0}).sort("title", 1).to_list(1000)
    return pages

@api_router.get("/documentation/{doc_id}")
async def get_documentation_page(doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.documentation.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Documentation not found")
    
    await db.documentation.update_one({"id": doc_id}, {"$inc": {"view_count": 1}})
    return doc

@api_router.post("/documentation")
async def create_documentation_page(doc_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if doc_data.get('client_id'):
        client = await db.clients.find_one({"id": doc_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    doc = DocumentationPage(
        client_id=doc_data.get('client_id'),
        client_name=client_name,
        title=doc_data.get('title'),
        content=doc_data.get('content', ''),
        category=doc_data.get('category', 'general'),
        parent_id=doc_data.get('parent_id'),
        is_template=doc_data.get('is_template', False),
        tags=doc_data.get('tags', []),
        last_edited_by=current_user['id'],
        last_edited_by_name=current_user['name']
    )
    doc_dict = doc.model_dump()
    doc_dict['created_at'] = doc_dict['created_at'].isoformat()
    doc_dict['updated_at'] = doc_dict['updated_at'].isoformat()
    await db.documentation.insert_one(doc_dict)
    return doc

@api_router.put("/documentation/{doc_id}")
async def update_documentation_page(doc_id: str, doc_data: dict, current_user: dict = Depends(get_current_user)):
    doc_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    doc_data['last_edited_by'] = current_user['id']
    doc_data['last_edited_by_name'] = current_user['name']
    result = await db.documentation.update_one({"id": doc_id}, {"$set": doc_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Documentation not found")
    return {"message": "Documentation updated"}

@api_router.delete("/documentation/{doc_id}")
async def delete_documentation_page(doc_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.documentation.delete_one({"id": doc_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Documentation not found")
    return {"message": "Documentation deleted"}

# ============== RUNBOOK ENDPOINTS ==============

@api_router.get("/runbooks")
async def get_runbooks(category: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if category:
        query["category"] = category
    
    runbooks = await db.runbooks.find(query, {"_id": 0}).sort("name", 1).to_list(100)
    return runbooks

@api_router.get("/runbooks/{runbook_id}")
async def get_runbook(runbook_id: str, current_user: dict = Depends(get_current_user)):
    runbook = await db.runbooks.find_one({"id": runbook_id}, {"_id": 0})
    if not runbook:
        raise HTTPException(status_code=404, detail="Runbook not found")
    return runbook

@api_router.post("/runbooks")
async def create_runbook(runbook_data: dict, current_user: dict = Depends(get_current_user)):
    runbook = Runbook(
        name=runbook_data.get('name'),
        description=runbook_data.get('description'),
        category=runbook_data.get('category', 'remediation'),
        trigger_type=runbook_data.get('trigger_type', 'manual'),
        trigger_conditions=runbook_data.get('trigger_conditions', {}),
        steps=runbook_data.get('steps', []),
        enabled=runbook_data.get('enabled', True),
        created_by=current_user['id']
    )
    doc = runbook.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.runbooks.insert_one(doc)
    return runbook

@api_router.put("/runbooks/{runbook_id}")
async def update_runbook(runbook_id: str, runbook_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.runbooks.update_one({"id": runbook_id}, {"$set": runbook_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Runbook not found")
    return {"message": "Runbook updated"}

@api_router.delete("/runbooks/{runbook_id}")
async def delete_runbook(runbook_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.runbooks.delete_one({"id": runbook_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Runbook not found")
    return {"message": "Runbook deleted"}

@api_router.post("/runbooks/{runbook_id}/execute")
async def execute_runbook(runbook_id: str, context: Dict[str, Any] = {}, current_user: dict = Depends(get_current_user)):
    """Execute a runbook manually"""
    runbook = await db.runbooks.find_one({"id": runbook_id}, {"_id": 0})
    if not runbook:
        raise HTTPException(status_code=404, detail="Runbook not found")
    
    execution = RunbookExecution(
        runbook_id=runbook_id,
        runbook_name=runbook['name'],
        triggered_by="manual",
        trigger_context=context,
        device_id=context.get('device_id'),
        client_id=context.get('client_id'),
        user_id=current_user['id'],
        status="running"
    )
    doc = execution.model_dump()
    doc['started_at'] = doc['started_at'].isoformat()
    await db.runbook_executions.insert_one(doc)
    
    # Update runbook stats
    await db.runbooks.update_one(
        {"id": runbook_id},
        {"$inc": {"run_count": 1}, "$set": {"last_run": datetime.now(timezone.utc).isoformat()}}
    )
    
    return execution

@api_router.get("/runbook-executions")
async def get_runbook_executions(runbook_id: Optional[str] = None, limit: int = 50, current_user: dict = Depends(get_current_user)):
    query = {}
    if runbook_id:
        query["runbook_id"] = runbook_id
    
    executions = await db.runbook_executions.find(query, {"_id": 0}).sort("started_at", -1).to_list(limit)
    return executions

# ============== CUSTOMER PORTAL ENDPOINTS ==============

@api_router.get("/portal/users")
async def get_portal_users(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    
    users = await db.portal_users.find(query, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users

@api_router.post("/portal/users")
async def create_portal_user(user_data: dict, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": user_data.get('client_id')}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Check if email already exists
    existing = await db.portal_users.find_one({"email": user_data.get('email')})
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")
    
    portal_user = PortalUser(
        client_id=client['id'],
        client_name=client['name'],
        email=user_data.get('email'),
        password_hash=hash_password(user_data.get('password', 'welcome123')),
        name=user_data.get('name'),
        phone=user_data.get('phone'),
        role=user_data.get('role', 'user'),
        is_primary_contact=user_data.get('is_primary_contact', False),
        can_view_all_tickets=user_data.get('can_view_all_tickets', False),
        can_create_tickets=user_data.get('can_create_tickets', True),
        can_view_assets=user_data.get('can_view_assets', True),
        can_view_invoices=user_data.get('can_view_invoices', False)
    )
    doc = portal_user.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.portal_users.insert_one(doc)
    
    return {"id": portal_user.id, "email": portal_user.email, "message": "Portal user created"}

@api_router.put("/portal/users/{user_id}")
async def update_portal_user(user_id: str, user_data: dict, current_user: dict = Depends(get_current_user)):
    if 'password' in user_data:
        user_data['password_hash'] = hash_password(user_data.pop('password'))
    
    result = await db.portal_users.update_one({"id": user_id}, {"$set": user_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Portal user not found")
    return {"message": "Portal user updated"}

@api_router.delete("/portal/users/{user_id}")
async def delete_portal_user(user_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.portal_users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Portal user not found")
    return {"message": "Portal user deleted"}

# Portal login (separate from main app login)
@api_router.post("/portal/login")
async def portal_login(email: str, password: str):
    user = await db.portal_users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not user.get('is_active', True):
        raise HTTPException(status_code=401, detail="Account is disabled")
    
    token = create_token(user['id'], user['email'], 'portal_user')
    
    await db.portal_users.update_one(
        {"id": user['id']},
        {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"token": token, "user": {k: v for k, v in user.items() if k != 'password_hash'}}

# ============== PROJECT MANAGEMENT ENDPOINTS ==============

@api_router.get("/projects")
async def get_projects(
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    
    projects = await db.projects.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return projects

@api_router.get("/projects/{project_id}")
async def get_project(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    tasks = await db.project_tasks.find({"project_id": project_id}, {"_id": 0}).sort("order", 1).to_list(1000)
    project['tasks'] = tasks
    return project

@api_router.post("/projects")
async def create_project(project_data: dict, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": project_data.get('client_id')}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    pm_name = None
    if project_data.get('project_manager'):
        pm = await db.users.find_one({"id": project_data['project_manager']}, {"_id": 0})
        pm_name = pm['name'] if pm else None
    
    project = Project(
        name=project_data.get('name'),
        description=project_data.get('description'),
        client_id=client['id'],
        client_name=client['name'],
        status=project_data.get('status', 'planning'),
        priority=project_data.get('priority', 'medium'),
        start_date=project_data.get('start_date'),
        target_end_date=project_data.get('target_end_date'),
        budget_hours=project_data.get('budget_hours'),
        project_manager=project_data.get('project_manager'),
        project_manager_name=pm_name,
        team_members=project_data.get('team_members', []),
        tags=project_data.get('tags', [])
    )
    doc = project.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.projects.insert_one(doc)
    return project

@api_router.put("/projects/{project_id}")
async def update_project(project_id: str, project_data: dict, current_user: dict = Depends(get_current_user)):
    project_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    result = await db.projects.update_one({"id": project_id}, {"$set": project_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"message": "Project updated"}

@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.projects.delete_one({"id": project_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Also delete tasks
    await db.project_tasks.delete_many({"project_id": project_id})
    return {"message": "Project deleted"}

# ============== PROJECT TASKS ENDPOINTS ==============

@api_router.get("/projects/{project_id}/tasks")
async def get_project_tasks(project_id: str, current_user: dict = Depends(get_current_user)):
    tasks = await db.project_tasks.find({"project_id": project_id}, {"_id": 0}).sort("order", 1).to_list(1000)
    return tasks

@api_router.post("/projects/{project_id}/tasks")
async def create_project_task(project_id: str, task_data: dict, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    assigned_name = None
    if task_data.get('assigned_to'):
        user = await db.users.find_one({"id": task_data['assigned_to']}, {"_id": 0})
        assigned_name = user['name'] if user else None
    
    task = ProjectTask(
        project_id=project_id,
        project_name=project['name'],
        title=task_data.get('title'),
        description=task_data.get('description'),
        status=task_data.get('status', 'todo'),
        priority=task_data.get('priority', 'medium'),
        assigned_to=task_data.get('assigned_to'),
        assigned_name=assigned_name,
        estimated_hours=task_data.get('estimated_hours'),
        due_date=task_data.get('due_date'),
        dependencies=task_data.get('dependencies', []),
        order=task_data.get('order', 0)
    )
    doc = task.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.project_tasks.insert_one(doc)
    return task

@api_router.put("/projects/{project_id}/tasks/{task_id}")
async def update_project_task(project_id: str, task_id: str, task_data: dict, current_user: dict = Depends(get_current_user)):
    if task_data.get('status') == 'completed':
        task_data['completed_at'] = datetime.now(timezone.utc).isoformat()
    
    result = await db.project_tasks.update_one({"id": task_id, "project_id": project_id}, {"$set": task_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task updated"}

@api_router.delete("/projects/{project_id}/tasks/{task_id}")
async def delete_project_task(project_id: str, task_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.project_tasks.delete_one({"id": task_id, "project_id": project_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted"}

# ============== AUDIT LOG ENDPOINTS ==============

@api_router.get("/audit-logs")
async def get_audit_logs(
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    user_id: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = 100,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id
    if user_id:
        query["user_id"] = user_id
    if action:
        query["action"] = action
    
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return logs

# ============== TECHNICIAN SCHEDULING ENDPOINTS ==============

@api_router.get("/schedule")
async def get_schedules(
    user_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if user_id:
        query["user_id"] = user_id
    if date_from:
        query["date"] = {"$gte": date_from}
    if date_to:
        if "date" in query:
            query["date"]["$lte"] = date_to
        else:
            query["date"] = {"$lte": date_to}
    
    schedules = await db.schedules.find(query, {"_id": 0}).sort("date", 1).to_list(1000)
    return schedules

@api_router.post("/schedule")
async def create_schedule_entry(schedule_data: dict, current_user: dict = Depends(get_current_user)):
    user_name = None
    user = await db.users.find_one({"id": schedule_data.get('user_id')}, {"_id": 0})
    user_name = user['name'] if user else None
    
    client_name = None
    if schedule_data.get('client_id'):
        client = await db.clients.find_one({"id": schedule_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    schedule = TechnicianSchedule(
        user_id=schedule_data.get('user_id'),
        user_name=user_name,
        date=schedule_data.get('date'),
        start_time=schedule_data.get('start_time'),
        end_time=schedule_data.get('end_time'),
        event_type=schedule_data.get('event_type', 'available'),
        title=schedule_data.get('title'),
        description=schedule_data.get('description'),
        client_id=schedule_data.get('client_id'),
        client_name=client_name,
        ticket_id=schedule_data.get('ticket_id'),
        location=schedule_data.get('location')
    )
    doc = schedule.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.schedules.insert_one(doc)
    return schedule

@api_router.put("/schedule/{schedule_id}")
async def update_schedule_entry(schedule_id: str, schedule_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.schedules.update_one({"id": schedule_id}, {"$set": schedule_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Schedule entry not found")
    return {"message": "Schedule updated"}

@api_router.delete("/schedule/{schedule_id}")
async def delete_schedule_entry(schedule_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.schedules.delete_one({"id": schedule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Schedule entry not found")
    return {"message": "Schedule deleted"}

# ============== ON-CALL ROTATION ENDPOINTS ==============

@api_router.get("/on-call")
async def get_on_call_rotations(current_user: dict = Depends(get_current_user)):
    rotations = await db.on_call_rotations.find({}, {"_id": 0}).to_list(100)
    return rotations

@api_router.post("/on-call")
async def create_on_call_rotation(rotation_data: dict, current_user: dict = Depends(get_current_user)):
    rotation = OnCallRotation(
        name=rotation_data.get('name'),
        description=rotation_data.get('description'),
        rotation_type=rotation_data.get('rotation_type', 'weekly'),
        team_members=rotation_data.get('team_members', []),
        rotation_start_day=rotation_data.get('rotation_start_day', 0),
        rotation_start_time=rotation_data.get('rotation_start_time', '08:00'),
        escalation_timeout_minutes=rotation_data.get('escalation_timeout_minutes', 30),
        enabled=rotation_data.get('enabled', True)
    )
    doc = rotation.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.on_call_rotations.insert_one(doc)
    return rotation

@api_router.get("/on-call/current")
async def get_current_on_call(current_user: dict = Depends(get_current_user)):
    """Get currently on-call technician"""
    rotations = await db.on_call_rotations.find({"enabled": True}, {"_id": 0}).to_list(10)
    on_call = []
    for r in rotations:
        if r['team_members']:
            current_tech_id = r['team_members'][r['current_index'] % len(r['team_members'])]
            tech = await db.users.find_one({"id": current_tech_id}, {"_id": 0})
            on_call.append({
                "rotation_name": r['name'],
                "technician_id": current_tech_id,
                "technician_name": tech['name'] if tech else None,
                "technician_email": tech['email'] if tech else None
            })
    return on_call

# ============== CUSTOM FIELDS ENDPOINTS ==============

@api_router.get("/custom-fields")
async def get_custom_fields(entity_type: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    
    fields = await db.custom_fields.find(query, {"_id": 0}).sort("order", 1).to_list(100)
    return fields

@api_router.post("/custom-fields")
async def create_custom_field(field_data: dict, current_user: dict = Depends(get_current_user)):
    field = CustomFieldDefinition(
        entity_type=field_data.get('entity_type'),
        field_name=field_data.get('field_name'),
        field_label=field_data.get('field_label'),
        field_type=field_data.get('field_type', 'text'),
        dropdown_options=field_data.get('dropdown_options', []),
        is_required=field_data.get('is_required', False),
        is_visible_portal=field_data.get('is_visible_portal', False),
        default_value=field_data.get('default_value'),
        order=field_data.get('order', 0)
    )
    doc = field.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.custom_fields.insert_one(doc)
    return field

@api_router.delete("/custom-fields/{field_id}")
async def delete_custom_field(field_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.custom_fields.delete_one({"id": field_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Custom field not found")
    return {"message": "Custom field deleted"}

# ============== WEBHOOKS ENDPOINTS ==============

@api_router.get("/webhooks")
async def get_webhooks(current_user: dict = Depends(get_current_user)):
    webhooks = await db.webhooks.find({}, {"_id": 0}).to_list(100)
    return webhooks

@api_router.post("/webhooks")
async def create_webhook(webhook_data: dict, current_user: dict = Depends(get_current_user)):
    webhook = Webhook(
        name=webhook_data.get('name'),
        url=webhook_data.get('url'),
        secret=webhook_data.get('secret'),
        events=webhook_data.get('events', []),
        is_active=webhook_data.get('is_active', True),
        headers=webhook_data.get('headers', {})
    )
    doc = webhook.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.webhooks.insert_one(doc)
    return webhook

@api_router.put("/webhooks/{webhook_id}")
async def update_webhook(webhook_id: str, webhook_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.webhooks.update_one({"id": webhook_id}, {"$set": webhook_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"message": "Webhook updated"}

@api_router.delete("/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.webhooks.delete_one({"id": webhook_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"message": "Webhook deleted"}

@api_router.post("/webhooks/{webhook_id}/test")
async def test_webhook(webhook_id: str, current_user: dict = Depends(get_current_user)):
    webhook = await db.webhooks.find_one({"id": webhook_id}, {"_id": 0})
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                webhook['url'],
                json={"event": "test", "message": "Webhook test from NexusOps"},
                headers=webhook.get('headers', {}),
                timeout=10
            )
        
        await db.webhooks.update_one(
            {"id": webhook_id},
            {"$set": {"last_triggered": datetime.now(timezone.utc).isoformat(), "last_status": response.status_code}}
        )
        return {"success": response.status_code < 400, "status_code": response.status_code}
    except Exception as e:
        await db.webhooks.update_one(
            {"id": webhook_id},
            {"$inc": {"failure_count": 1}}
        )
        return {"success": False, "error": str(e)}

# ============== SITES / LOCATIONS ENDPOINTS ==============

@api_router.get("/sites")
async def get_sites(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    
    sites = await db.sites.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return sites

@api_router.post("/sites")
async def create_site(site_data: dict, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": site_data.get('client_id')}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    site = Site(
        client_id=client['id'],
        client_name=client['name'],
        name=site_data.get('name'),
        address=site_data.get('address'),
        city=site_data.get('city'),
        state=site_data.get('state'),
        postal_code=site_data.get('postal_code'),
        country=site_data.get('country', 'USA'),
        phone=site_data.get('phone'),
        is_primary=site_data.get('is_primary', False),
        timezone=site_data.get('timezone', 'America/New_York'),
        notes=site_data.get('notes')
    )
    doc = site.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.sites.insert_one(doc)
    return site

@api_router.put("/sites/{site_id}")
async def update_site(site_id: str, site_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.sites.update_one({"id": site_id}, {"$set": site_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Site not found")
    return {"message": "Site updated"}

@api_router.delete("/sites/{site_id}")
async def delete_site(site_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.sites.delete_one({"id": site_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Site not found")
    return {"message": "Site deleted"}

# ============== PROXMOX ENDPOINTS ==============

@api_router.get("/proxmox/servers")
async def get_proxmox_servers(current_user: dict = Depends(get_current_user)):
    servers = await db.proxmox_servers.find({}, {"_id": 0, "token_value": 0}).to_list(100)
    return servers

@api_router.post("/proxmox/servers")
async def create_proxmox_server(server_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if server_data.get('client_id'):
        client = await db.clients.find_one({"id": server_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    server = ProxmoxServer(
        name=server_data.get('name'),
        host=server_data.get('host'),
        port=server_data.get('port', 8006),
        username=server_data.get('username'),
        token_name=server_data.get('token_name'),
        token_value=server_data.get('token_value'),
        client_id=server_data.get('client_id'),
        client_name=client_name,
        node_name=server_data.get('node_name'),
        ssl_verify=server_data.get('ssl_verify', False)
    )
    doc = server.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.proxmox_servers.insert_one(doc)
    return {"id": server.id, "name": server.name}

@api_router.delete("/proxmox/servers/{server_id}")
async def delete_proxmox_server(server_id: str, current_user: dict = Depends(get_current_user)):
    await db.proxmox_servers.delete_one({"id": server_id})
    await db.proxmox_vms.delete_many({"server_id": server_id})
    return {"message": "Server deleted"}

@api_router.get("/proxmox/vms")
async def get_proxmox_vms(server_id: Optional[str] = None, status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if server_id:
        query["server_id"] = server_id
    if status:
        query["status"] = status
    vms = await db.proxmox_vms.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return vms

@api_router.get("/proxmox/dashboard")
async def get_proxmox_dashboard(current_user: dict = Depends(get_current_user)):
    total_servers = await db.proxmox_servers.count_documents({})
    online_servers = await db.proxmox_servers.count_documents({"status": "online"})
    total_vms = await db.proxmox_vms.count_documents({})
    running_vms = await db.proxmox_vms.count_documents({"status": "running"})
    stopped_vms = await db.proxmox_vms.count_documents({"status": "stopped"})
    return {
        "servers": {"total": total_servers, "online": online_servers},
        "vms": {"total": total_vms, "running": running_vms, "stopped": stopped_vms}
    }

# ============== WARRANTY ENDPOINTS ==============

@api_router.get("/warranties")
async def get_warranties(client_id: Optional[str] = None, status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    warranties = await db.warranties.find(query, {"_id": 0}).sort("warranty_end", 1).to_list(1000)
    return warranties

@api_router.post("/warranties")
async def create_warranty(warranty_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if warranty_data.get('client_id'):
        client = await db.clients.find_one({"id": warranty_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    warranty = WarrantyEntry(client_name=client_name, **warranty_data)
    doc = warranty.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.warranties.insert_one(doc)
    return warranty

@api_router.put("/warranties/{warranty_id}")
async def update_warranty(warranty_id: str, warranty_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.warranties.update_one({"id": warranty_id}, {"$set": warranty_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Warranty not found")
    return {"message": "Warranty updated"}

@api_router.delete("/warranties/{warranty_id}")
async def delete_warranty(warranty_id: str, current_user: dict = Depends(get_current_user)):
    await db.warranties.delete_one({"id": warranty_id})
    return {"message": "Warranty deleted"}

# ============== LICENSE ENDPOINTS ==============

@api_router.get("/licenses")
async def get_licenses(client_id: Optional[str] = None, status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    licenses = await db.software_licenses.find(query, {"_id": 0}).sort("software_name", 1).to_list(1000)
    return licenses

@api_router.post("/licenses")
async def create_license(license_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if license_data.get('client_id'):
        client = await db.clients.find_one({"id": license_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    license_entry = SoftwareLicense(client_name=client_name, **license_data)
    doc = license_entry.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.software_licenses.insert_one(doc)
    return license_entry

@api_router.put("/licenses/{license_id}")
async def update_license(license_id: str, license_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.software_licenses.update_one({"id": license_id}, {"$set": license_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="License not found")
    return {"message": "License updated"}

@api_router.delete("/licenses/{license_id}")
async def delete_license(license_id: str, current_user: dict = Depends(get_current_user)):
    await db.software_licenses.delete_one({"id": license_id})
    return {"message": "License deleted"}

# ============== DOMAIN & SSL ENDPOINTS ==============

@api_router.get("/domains")
async def get_domains(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    domains = await db.domains.find(query, {"_id": 0}).sort("expiry_date", 1).to_list(1000)
    return domains

@api_router.post("/domains")
async def create_domain(domain_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if domain_data.get('client_id'):
        client = await db.clients.find_one({"id": domain_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    domain = DomainEntry(client_name=client_name, **domain_data)
    doc = domain.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.domains.insert_one(doc)
    return domain

@api_router.delete("/domains/{domain_id}")
async def delete_domain(domain_id: str, current_user: dict = Depends(get_current_user)):
    await db.domains.delete_one({"id": domain_id})
    return {"message": "Domain deleted"}

@api_router.get("/ssl-certificates")
async def get_ssl_certificates(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    certs = await db.ssl_certificates.find(query, {"_id": 0}).sort("expiry_date", 1).to_list(1000)
    return certs

@api_router.post("/ssl-certificates")
async def create_ssl_certificate(cert_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if cert_data.get('client_id'):
        client = await db.clients.find_one({"id": cert_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    cert = SSLCertificate(client_name=client_name, **cert_data)
    doc = cert.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.ssl_certificates.insert_one(doc)
    return cert

@api_router.delete("/ssl-certificates/{cert_id}")
async def delete_ssl_certificate(cert_id: str, current_user: dict = Depends(get_current_user)):
    await db.ssl_certificates.delete_one({"id": cert_id})
    return {"message": "Certificate deleted"}

# ============== VENDOR ENDPOINTS ==============

@api_router.get("/vendors")
async def get_vendors(category: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if category:
        query["category"] = category
    vendors = await db.vendors.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return vendors

@api_router.post("/vendors")
async def create_vendor(vendor_data: dict, current_user: dict = Depends(get_current_user)):
    vendor = Vendor(**vendor_data)
    doc = vendor.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.vendors.insert_one(doc)
    return vendor

@api_router.put("/vendors/{vendor_id}")
async def update_vendor(vendor_id: str, vendor_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.vendors.update_one({"id": vendor_id}, {"$set": vendor_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return {"message": "Vendor updated"}

@api_router.delete("/vendors/{vendor_id}")
async def delete_vendor(vendor_id: str, current_user: dict = Depends(get_current_user)):
    await db.vendors.delete_one({"id": vendor_id})
    return {"message": "Vendor deleted"}

# ============== EXPIRY DASHBOARD ==============

@api_router.get("/expiry-dashboard")
async def get_expiry_dashboard(current_user: dict = Depends(get_current_user)):
    """Get all expiring items across warranties, licenses, domains, SSL certs"""
    from datetime import timedelta
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    soon = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
    
    expiring_warranties = await db.warranties.count_documents({"warranty_end": {"$lte": soon, "$gte": today}})
    expiring_licenses = await db.software_licenses.count_documents({"expiry_date": {"$lte": soon, "$gte": today}})
    expiring_domains = await db.domains.count_documents({"expiry_date": {"$lte": soon, "$gte": today}})
    expiring_ssl = await db.ssl_certificates.count_documents({"expiry_date": {"$lte": soon, "$gte": today}})
    
    return {
        "warranties": {"expiring_soon": expiring_warranties},
        "licenses": {"expiring_soon": expiring_licenses},
        "domains": {"expiring_soon": expiring_domains},
        "ssl_certificates": {"expiring_soon": expiring_ssl},
        "total_expiring": expiring_warranties + expiring_licenses + expiring_domains + expiring_ssl
    }

# ============== SEED DATA ==============

@api_router.post("/seed")
async def seed_data():
    existing_clients = await db.clients.count_documents({})
    if existing_clients > 0:
        return {"message": "Data already seeded"}
    
    # Create demo user
    demo_user = User(
        id="user-001",
        email="admin@nexusops.io",
        name="Alex Thompson",
        role="admin",
        avatar="https://api.dicebear.com/7.x/initials/svg?seed=AT",
        hourly_rate=125.0,
        is_admin=True,
    )
    demo_doc = demo_user.model_dump()
    demo_doc['password_hash'] = hash_password("admin123")
    demo_doc['job_title'] = "Service Manager"
    demo_doc['phone'] = "+1 (555) 123-4567"
    demo_doc['specialties'] = ["Management", "Strategy", "Enterprise Architecture"]
    demo_doc['created_at'] = demo_doc['created_at'].isoformat()
    await db.users.insert_one(demo_doc)
    
    users_data = [
        {"id": "user-002", "email": "sarah@nexusops.io", "name": "Sarah Chen", "role": "technician", "job_title": "Senior Engineer", "hourly_rate": 85.0, "phone": "+1 (555) 234-5678", "specialties": ["Networking", "Cloud Infrastructure", "Azure"], "is_admin": False},
        {"id": "user-003", "email": "mike@nexusops.io", "name": "Mike Rodriguez", "role": "technician", "job_title": "L2 Technician", "hourly_rate": 75.0, "phone": "+1 (555) 345-6789", "specialties": ["Windows Server", "Active Directory", "Security"], "is_admin": False},
        {"id": "user-004", "email": "lisa@nexusops.io", "name": "Lisa Park", "role": "technician", "job_title": "L1 Technician", "hourly_rate": 55.0, "phone": "+1 (555) 456-7890", "specialties": ["Help Desk", "macOS", "Printers"], "is_admin": False},
        {"id": "user-005", "email": "james@nexusops.io", "name": "James Wilson", "role": "dispatcher", "job_title": "Dispatcher", "hourly_rate": 60.0, "phone": "+1 (555) 567-8901", "specialties": ["Scheduling", "Triage"], "is_admin": False},
    ]
    for u in users_data:
        jt = u.get("job_title", "")
        perms = PERMISSION_PRESETS.get(jt, {})
        user = User(**{k: v for k, v in u.items() if k != "job_title"}, avatar=f"https://api.dicebear.com/7.x/initials/svg?seed={u['name']}")
        doc = user.model_dump()
        doc["job_title"] = jt
        if perms:
            doc["permissions"] = perms
        doc['password_hash'] = hash_password("tech123")
        doc['created_at'] = doc['created_at'].isoformat()
        await db.users.insert_one(doc)
    
    clients_data = [
        {"id": "client-001", "name": "Acme Corporation", "email": "it@acme.com", "industry": "Manufacturing", "mrr": 2500, "device_count": 45, "ticket_count": 12},
        {"id": "client-002", "name": "TechStart Inc", "email": "support@techstart.io", "industry": "Technology", "mrr": 1800, "device_count": 28, "ticket_count": 8},
        {"id": "client-003", "name": "Global Finance Ltd", "email": "helpdesk@globalfin.com", "industry": "Finance", "mrr": 4200, "device_count": 120, "ticket_count": 25},
        {"id": "client-004", "name": "HealthCare Plus", "email": "it@hcplus.org", "industry": "Healthcare", "mrr": 3100, "device_count": 67, "ticket_count": 15},
        {"id": "client-005", "name": "RetailMax", "email": "tech@retailmax.com", "industry": "Retail", "mrr": 1500, "device_count": 34, "ticket_count": 6},
    ]
    for c in clients_data:
        client = Client(**c)
        doc = client.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        await db.clients.insert_one(doc)
    
    devices_data = [
        {"id": "dev-001", "name": "ACME-DC-01", "client_id": "client-001", "client_name": "Acme Corporation", "device_type": "server", "os": "Windows Server 2022", "os_version": "21H2", "os_build": "20348.2340", "ip_address": "192.168.1.10", "public_ip": "203.45.67.10", "mac_address": "00:1A:2B:3C:4D:01", "serial_number": "DELL-PE-R740-001", "manufacturer": "Dell", "model": "PowerEdge R740", "processor": "Intel Xeon Gold 6248R", "processor_cores": 24, "ram_gb": 128, "storage_total_gb": 3600, "storage_used_gb": 2808, "gpu": "N/A", "domain": "acme.local", "location": "Server Room A, Rack 1", "assigned_user": "System", "last_logged_in_user": "admin@acme.local", "uptime_hours": 2184, "last_reboot": "2025-12-15T03:00:00Z", "agent_version": "2.4.1", "antivirus": "SentinelOne", "antivirus_status": "active", "firewall_enabled": True, "edr_status": "active", "encryption_status": "BitLocker - Encrypted", "compliance_score": 95, "patch_status": "current", "pending_patches": 2, "installed_software_count": 34, "tags": ["production", "domain-controller", "critical"], "rustdesk_id": "842931675", "status": "online", "cpu_usage": 45, "memory_usage": 62, "disk_usage": 78, "network_in_mbps": 245.3, "network_out_mbps": 189.7},
        {"id": "dev-002", "name": "ACME-WS-001", "client_id": "client-001", "client_name": "Acme Corporation", "device_type": "workstation", "os": "Windows 11", "os_version": "23H2", "os_build": "22631.3085", "ip_address": "192.168.1.101", "mac_address": "00:1A:2B:3C:4D:02", "serial_number": "DELL-OPT-7090-001", "manufacturer": "Dell", "model": "OptiPlex 7090", "processor": "Intel Core i7-11700", "processor_cores": 8, "ram_gb": 32, "storage_total_gb": 512, "storage_used_gb": 281, "gpu": "Intel UHD 750", "domain": "acme.local", "location": "Office Floor 2", "assigned_user": "john.smith@acme.com", "last_logged_in_user": "john.smith@acme.com", "uptime_hours": 168, "last_reboot": "2026-03-03T08:15:00Z", "agent_version": "2.4.1", "antivirus": "SentinelOne", "antivirus_status": "active", "firewall_enabled": True, "edr_status": "active", "encryption_status": "BitLocker - Encrypted", "compliance_score": 98, "patch_status": "current", "pending_patches": 0, "installed_software_count": 47, "tags": ["production", "accounting-dept"], "status": "online", "cpu_usage": 23, "memory_usage": 41, "disk_usage": 55, "network_in_mbps": 12.4, "network_out_mbps": 3.2},
        {"id": "dev-003", "name": "TECH-SRV-01", "client_id": "client-002", "client_name": "TechStart Inc", "device_type": "server", "os": "Ubuntu 22.04", "os_version": "22.04.3 LTS", "os_build": "5.15.0-91-generic", "ip_address": "10.0.0.5", "public_ip": "45.67.89.12", "mac_address": "00:1A:2B:3C:4D:03", "serial_number": "HPE-DL380-001", "manufacturer": "HPE", "model": "ProLiant DL380 Gen10", "processor": "Intel Xeon Silver 4214R", "processor_cores": 12, "ram_gb": 64, "storage_total_gb": 1800, "storage_used_gb": 810, "domain": "techstart.local", "location": "Cloud DC - US East", "assigned_user": "System", "uptime_hours": 4380, "last_reboot": "2025-09-15T02:00:00Z", "agent_version": "2.3.8", "antivirus": "CrowdStrike Falcon", "antivirus_status": "active", "firewall_enabled": True, "edr_status": "active", "encryption_status": "LUKS - Encrypted", "compliance_score": 72, "patch_status": "needs_attention", "pending_patches": 8, "installed_software_count": 62, "tags": ["production", "web-server", "docker"], "status": "warning", "cpu_usage": 89, "memory_usage": 78, "disk_usage": 45, "network_in_mbps": 567.8, "network_out_mbps": 423.1},
        {"id": "dev-004", "name": "GF-DC-MAIN", "client_id": "client-003", "client_name": "Global Finance Ltd", "device_type": "server", "os": "Windows Server 2022", "os_version": "21H2", "os_build": "20348.2159", "ip_address": "172.16.0.10", "public_ip": "91.23.45.67", "mac_address": "00:1A:2B:3C:4D:04", "serial_number": "DELL-PE-R750-001", "manufacturer": "Dell", "model": "PowerEdge R750", "processor": "Intel Xeon Gold 6338", "processor_cores": 32, "ram_gb": 256, "storage_total_gb": 7200, "storage_used_gb": 4824, "domain": "globalfin.local", "location": "Primary DC - Floor B2", "assigned_user": "System", "uptime_hours": 720, "last_reboot": "2026-02-10T01:00:00Z", "agent_version": "2.4.1", "antivirus": "SentinelOne", "antivirus_status": "active", "firewall_enabled": True, "edr_status": "active", "encryption_status": "BitLocker - Encrypted", "compliance_score": 100, "patch_status": "current", "pending_patches": 0, "installed_software_count": 28, "tags": ["production", "domain-controller", "critical", "pci-dss"], "rustdesk_id": "742156823", "status": "online", "cpu_usage": 34, "memory_usage": 56, "disk_usage": 67, "network_in_mbps": 890.2, "network_out_mbps": 654.8},
        {"id": "dev-005", "name": "HC-WS-REC01", "client_id": "client-004", "client_name": "HealthCare Plus", "device_type": "workstation", "os": "Windows 10", "os_version": "22H2", "os_build": "19045.3930", "ip_address": "192.168.5.20", "mac_address": "00:1A:2B:3C:4D:05", "serial_number": "HP-PD600-045", "manufacturer": "HP", "model": "ProDesk 600 G6", "processor": "Intel Core i5-10500", "processor_cores": 6, "ram_gb": 16, "storage_total_gb": 256, "storage_used_gb": 210, "domain": "hcplus.local", "location": "Reception Area", "assigned_user": "receptionist@hcplus.org", "last_logged_in_user": "receptionist@hcplus.org", "uptime_hours": 0, "agent_version": "2.3.5", "antivirus": "Windows Defender", "antivirus_status": "outdated", "firewall_enabled": True, "edr_status": "inactive", "encryption_status": "Not Encrypted", "compliance_score": 45, "patch_status": "critical", "pending_patches": 15, "installed_software_count": 23, "tags": ["production", "hipaa", "needs-attention"], "status": "offline", "cpu_usage": 0, "memory_usage": 0, "disk_usage": 82},
        {"id": "dev-006", "name": "RETAIL-POS-01", "client_id": "client-005", "client_name": "RetailMax", "device_type": "workstation", "os": "Windows 11", "os_version": "23H2", "os_build": "22631.2861", "ip_address": "192.168.10.50", "mac_address": "00:1A:2B:3C:4D:06", "serial_number": "LEN-M90Q-012", "manufacturer": "Lenovo", "model": "ThinkCentre M90q Gen 3", "processor": "Intel Core i5-12500T", "processor_cores": 6, "ram_gb": 16, "storage_total_gb": 256, "storage_used_gb": 87, "domain": "retailmax.local", "location": "Store Front - Register 1", "assigned_user": "pos-system", "agent_version": "2.4.0", "antivirus": "SentinelOne", "antivirus_status": "active", "firewall_enabled": True, "edr_status": "active", "encryption_status": "BitLocker - Encrypted", "compliance_score": 88, "patch_status": "current", "pending_patches": 1, "installed_software_count": 15, "tags": ["production", "pos", "pci-dss"], "status": "online", "cpu_usage": 15, "memory_usage": 28, "disk_usage": 34, "network_in_mbps": 2.1, "network_out_mbps": 0.8},
        {"id": "dev-007", "name": "ACME-LT-001", "client_id": "client-001", "client_name": "Acme Corporation", "device_type": "laptop", "os": "Windows 11", "os_version": "23H2", "os_build": "22631.3085", "ip_address": "192.168.1.150", "mac_address": "00:1A:2B:3C:4D:07", "serial_number": "DELL-LAT-5530-001", "manufacturer": "Dell", "model": "Latitude 5530", "processor": "Intel Core i7-1265U", "processor_cores": 10, "ram_gb": 16, "storage_total_gb": 512, "storage_used_gb": 245, "gpu": "Intel Iris Xe", "domain": "acme.local", "location": "Mobile / WFH", "assigned_user": "jane.doe@acme.com", "last_logged_in_user": "jane.doe@acme.com", "uptime_hours": 72, "last_reboot": "2026-03-07T09:30:00Z", "agent_version": "2.4.1", "antivirus": "SentinelOne", "antivirus_status": "active", "firewall_enabled": True, "edr_status": "active", "encryption_status": "BitLocker - Encrypted", "compliance_score": 92, "patch_status": "needs_attention", "pending_patches": 3, "installed_software_count": 52, "tags": ["mobile", "wfh", "vpn-user"], "status": "online", "cpu_usage": 35, "memory_usage": 68, "disk_usage": 48, "network_in_mbps": 5.6, "network_out_mbps": 1.2},
        {"id": "dev-008", "name": "ACME-FW-01", "client_id": "client-001", "client_name": "Acme Corporation", "device_type": "network", "os": "FortiOS", "os_version": "7.4.3", "ip_address": "192.168.1.1", "public_ip": "203.45.67.1", "mac_address": "00:1A:2B:3C:4D:08", "serial_number": "FGT-60F-001", "manufacturer": "Fortinet", "model": "FortiGate 60F", "processor": "NP6 ASIC", "ram_gb": 4, "storage_total_gb": 128, "storage_used_gb": 12, "location": "Server Room A, Rack 1 - U1", "assigned_user": "System", "uptime_hours": 8760, "agent_version": "SNMP v3", "antivirus": "FortiGuard", "antivirus_status": "active", "firewall_enabled": True, "compliance_score": 100, "tags": ["infrastructure", "firewall", "critical"], "status": "online", "cpu_usage": 12, "memory_usage": 35, "disk_usage": 9, "network_in_mbps": 450.0, "network_out_mbps": 380.0},
        {"id": "dev-009", "name": "GF-LT-CFO01", "client_id": "client-003", "client_name": "Global Finance Ltd", "device_type": "laptop", "os": "macOS Sonoma", "os_version": "14.3", "os_build": "23D56", "ip_address": "172.16.1.45", "mac_address": "00:1A:2B:3C:4D:09", "serial_number": "APPLE-MBP-M3-001", "manufacturer": "Apple", "model": "MacBook Pro 16\" M3 Pro", "processor": "Apple M3 Pro", "processor_cores": 12, "ram_gb": 36, "storage_total_gb": 1000, "storage_used_gb": 412, "gpu": "M3 Pro 18-core GPU", "domain": "globalfin.local", "location": "Executive Suite", "assigned_user": "cfo@globalfin.com", "last_logged_in_user": "cfo@globalfin.com", "uptime_hours": 48, "last_reboot": "2026-03-08T07:00:00Z", "agent_version": "2.4.1", "antivirus": "CrowdStrike Falcon", "antivirus_status": "active", "firewall_enabled": True, "edr_status": "active", "encryption_status": "FileVault - Encrypted", "compliance_score": 96, "patch_status": "current", "pending_patches": 0, "installed_software_count": 38, "tags": ["executive", "mobile", "vip"], "status": "online", "cpu_usage": 18, "memory_usage": 52, "disk_usage": 41, "network_in_mbps": 8.3, "network_out_mbps": 2.1},
        {"id": "dev-010", "name": "TECH-DOCKER-01", "client_id": "client-002", "client_name": "TechStart Inc", "device_type": "server", "os": "Ubuntu 24.04", "os_version": "24.04 LTS", "os_build": "6.5.0-14-generic", "ip_address": "10.0.0.20", "public_ip": "45.67.89.20", "mac_address": "00:1A:2B:3C:4D:0A", "serial_number": "HPE-DL360-003", "manufacturer": "HPE", "model": "ProLiant DL360 Gen10 Plus", "processor": "AMD EPYC 7313", "processor_cores": 16, "ram_gb": 128, "storage_total_gb": 4000, "storage_used_gb": 1600, "domain": "techstart.local", "location": "Cloud DC - US East", "assigned_user": "System", "uptime_hours": 720, "last_reboot": "2026-02-10T04:00:00Z", "agent_version": "2.4.0", "antivirus": "ClamAV", "antivirus_status": "active", "firewall_enabled": True, "edr_status": "active", "encryption_status": "LUKS - Encrypted", "compliance_score": 85, "patch_status": "needs_attention", "pending_patches": 4, "installed_software_count": 89, "tags": ["production", "docker", "kubernetes", "ci-cd"], "status": "online", "cpu_usage": 67, "memory_usage": 72, "disk_usage": 40, "network_in_mbps": 312.5, "network_out_mbps": 278.9},
    ]
    for d in devices_data:
        device = Device(**d)
        doc = device.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        doc['last_seen'] = doc['last_seen'].isoformat()
        await db.devices.insert_one(doc)

    # Seed device software for ACME-DC-01
    software_data = [
        {"id": "sw-001", "device_id": "dev-001", "name": "Windows Server 2022 Standard", "version": "21H2 (20348.2340)", "publisher": "Microsoft", "install_date": "2024-01-15", "size_mb": 15360, "category": "operating_system"},
        {"id": "sw-002", "device_id": "dev-001", "name": "Active Directory Domain Services", "version": "10.0.20348", "publisher": "Microsoft", "install_date": "2024-01-15", "size_mb": 512, "category": "system"},
        {"id": "sw-003", "device_id": "dev-001", "name": "DNS Server", "version": "10.0.20348", "publisher": "Microsoft", "install_date": "2024-01-15", "size_mb": 128, "category": "system"},
        {"id": "sw-004", "device_id": "dev-001", "name": "SentinelOne Agent", "version": "23.4.2.115", "publisher": "SentinelOne", "install_date": "2024-02-10", "size_mb": 420, "category": "security"},
        {"id": "sw-005", "device_id": "dev-001", "name": "Tactical RMM Agent", "version": "2.4.1", "publisher": "Tactical RMM", "install_date": "2024-01-20", "size_mb": 85, "category": "management"},
        {"id": "sw-006", "device_id": "dev-001", "name": "MeshCentral Agent", "version": "1.1.21", "publisher": "MeshCentral", "install_date": "2024-01-20", "size_mb": 45, "category": "remote_access"},
        {"id": "sw-007", "device_id": "dev-001", "name": "Veeam Backup Agent", "version": "6.1.0.957", "publisher": "Veeam", "install_date": "2024-03-01", "size_mb": 890, "category": "backup"},
        {"id": "sw-008", "device_id": "dev-001", "name": "SQL Server 2022", "version": "16.0.4105.2", "publisher": "Microsoft", "install_date": "2024-01-20", "size_mb": 4096, "category": "database"},
        {"id": "sw-009", "device_id": "dev-002", "name": "Microsoft 365 Apps for Enterprise", "version": "16.0.17328.20162", "publisher": "Microsoft", "install_date": "2024-06-01", "size_mb": 3200, "category": "productivity"},
        {"id": "sw-010", "device_id": "dev-002", "name": "Google Chrome", "version": "122.0.6261.112", "publisher": "Google", "install_date": "2024-01-15", "size_mb": 280, "category": "browser"},
        {"id": "sw-011", "device_id": "dev-002", "name": "Adobe Acrobat Pro DC", "version": "24.001.20604", "publisher": "Adobe", "install_date": "2024-04-10", "size_mb": 1024, "category": "productivity"},
        {"id": "sw-012", "device_id": "dev-002", "name": "SentinelOne Agent", "version": "23.4.2.115", "publisher": "SentinelOne", "install_date": "2024-02-10", "size_mb": 420, "category": "security"},
        {"id": "sw-013", "device_id": "dev-002", "name": "Tactical RMM Agent", "version": "2.4.1", "publisher": "Tactical RMM", "install_date": "2024-01-20", "size_mb": 85, "category": "management"},
        {"id": "sw-014", "device_id": "dev-002", "name": "Zoom Workplace", "version": "6.0.2", "publisher": "Zoom", "install_date": "2024-05-15", "size_mb": 350, "category": "communication"},
        {"id": "sw-015", "device_id": "dev-002", "name": "Slack", "version": "4.37.94", "publisher": "Salesforce", "install_date": "2024-03-20", "size_mb": 280, "category": "communication"},
        {"id": "sw-016", "device_id": "dev-003", "name": "Docker Engine", "version": "25.0.3", "publisher": "Docker Inc", "install_date": "2024-02-01", "size_mb": 512, "category": "development"},
        {"id": "sw-017", "device_id": "dev-003", "name": "Nginx", "version": "1.24.0", "publisher": "Nginx Inc", "install_date": "2024-01-15", "size_mb": 64, "category": "web_server"},
        {"id": "sw-018", "device_id": "dev-003", "name": "PostgreSQL", "version": "16.1", "publisher": "PostgreSQL", "install_date": "2024-01-20", "size_mb": 256, "category": "database"},
        {"id": "sw-019", "device_id": "dev-003", "name": "CrowdStrike Falcon Sensor", "version": "7.10.0-16303", "publisher": "CrowdStrike", "install_date": "2024-03-15", "size_mb": 350, "category": "security"},
        {"id": "sw-020", "device_id": "dev-003", "name": "Prometheus Node Exporter", "version": "1.7.0", "publisher": "Prometheus", "install_date": "2024-02-01", "size_mb": 24, "category": "monitoring"},
    ]
    for s in software_data:
        await db.device_software.insert_one(s)

    # Seed device patches
    patches_data = [
        {"id": "patch-001", "device_id": "dev-001", "kb_id": "KB5034439", "title": "2024-01 Cumulative Update for Windows Server 2022", "severity": "critical", "status": "installed", "installed_date": "2026-01-15", "category": "Security Updates"},
        {"id": "patch-002", "device_id": "dev-001", "kb_id": "KB5034765", "title": "2024-02 Servicing Stack Update for Windows Server 2022", "severity": "important", "status": "installed", "installed_date": "2026-02-12", "category": "Security Updates"},
        {"id": "patch-003", "device_id": "dev-001", "kb_id": "KB5035857", "title": "2024-03 Cumulative Update for Windows Server 2022", "severity": "critical", "status": "pending", "installed_date": None, "category": "Security Updates"},
        {"id": "patch-004", "device_id": "dev-001", "kb_id": "KB5036909", "title": ".NET Framework 4.8.1 Security Update", "severity": "important", "status": "pending", "installed_date": None, "category": "Security Updates"},
        {"id": "patch-005", "device_id": "dev-002", "kb_id": "KB5034763", "title": "2024-02 Cumulative Update for Windows 11 23H2", "severity": "critical", "status": "installed", "installed_date": "2026-02-14", "category": "Security Updates"},
        {"id": "patch-006", "device_id": "dev-002", "kb_id": "KB5035853", "title": "2024-03 Cumulative Update for Windows 11 23H2", "severity": "critical", "status": "installed", "installed_date": "2026-03-09", "category": "Security Updates"},
        {"id": "patch-007", "device_id": "dev-005", "kb_id": "KB5032278", "title": "2023-11 Cumulative Update for Windows 10 22H2", "severity": "critical", "status": "failed", "installed_date": None, "category": "Security Updates"},
        {"id": "patch-008", "device_id": "dev-005", "kb_id": "KB5033372", "title": "2023-12 Cumulative Update for Windows 10 22H2", "severity": "critical", "status": "pending", "installed_date": None, "category": "Security Updates"},
        {"id": "patch-009", "device_id": "dev-003", "kb_id": "USN-6609-1", "title": "Linux kernel vulnerabilities - Ubuntu 22.04", "severity": "high", "status": "pending", "installed_date": None, "category": "Security Updates"},
        {"id": "patch-010", "device_id": "dev-003", "kb_id": "USN-6615-1", "title": "OpenSSL vulnerability - Ubuntu 22.04", "severity": "critical", "status": "pending", "installed_date": None, "category": "Security Updates"},
    ]
    for p in patches_data:
        await db.device_patches.insert_one(p)

    # Seed device events
    import random
    event_types = ["agent_check_in", "login", "logout", "software_installed", "patch_applied", "alert_triggered", "reboot", "service_restart", "backup_completed", "script_executed"]
    events_data = []
    for i in range(50):
        dev_id = random.choice(["dev-001", "dev-002", "dev-003", "dev-004", "dev-006", "dev-007"])
        evt_type = random.choice(event_types)
        hours_ago = random.randint(1, 720)
        ts = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()
        severity = "info" if evt_type in ["agent_check_in", "login", "logout", "backup_completed"] else random.choice(["info", "warning", "error"])
        messages = {
            "agent_check_in": "Agent checked in successfully",
            "login": f"User logged in via RDP",
            "logout": "User session ended",
            "software_installed": f"Software package installed",
            "patch_applied": f"Windows Update applied successfully",
            "alert_triggered": f"High resource usage detected",
            "reboot": "System rebooted",
            "service_restart": "Service 'Spooler' restarted",
            "backup_completed": "Backup completed successfully (12.4 GB)",
            "script_executed": "Script 'Clear-TempFiles.ps1' executed"
        }
        events_data.append({"id": f"evt-{i+1:03d}", "device_id": dev_id, "event_type": evt_type, "severity": severity, "message": messages[evt_type], "timestamp": ts, "user": "System"})
    for e in events_data:
        await db.device_events.insert_one(e)

    # Seed performance data (last 24 hours, every 5 min = 288 entries for dev-001)
    perf_data = []
    for i in range(288):
        ts = (datetime.now(timezone.utc) - timedelta(minutes=i*5)).isoformat()
        base_cpu = 40 + random.uniform(-15, 25)
        base_ram = 58 + random.uniform(-10, 15)
        base_disk = 77.5 + random.uniform(-0.5, 0.5)
        perf_data.append({"device_id": "dev-001", "timestamp": ts, "cpu": round(min(100, max(5, base_cpu)), 1), "memory": round(min(100, max(20, base_ram)), 1), "disk": round(base_disk, 1), "network_in": round(random.uniform(50, 500), 1), "network_out": round(random.uniform(30, 300), 1)})
    # Also add for dev-003 (warning state)
    for i in range(288):
        ts = (datetime.now(timezone.utc) - timedelta(minutes=i*5)).isoformat()
        base_cpu = 82 + random.uniform(-10, 18)
        base_ram = 75 + random.uniform(-8, 15)
        perf_data.append({"device_id": "dev-003", "timestamp": ts, "cpu": round(min(100, max(20, base_cpu)), 1), "memory": round(min(100, max(30, base_ram)), 1), "disk": round(45 + random.uniform(-1, 1), 1), "network_in": round(random.uniform(200, 800), 1), "network_out": round(random.uniform(100, 600), 1)})
    for p in perf_data:
        await db.device_performance.insert_one(p)

    # Seed network adapters
    network_data = [
        {"device_id": "dev-001", "adapter_name": "Ethernet 1 (Management)", "type": "ethernet", "ip_address": "192.168.1.10", "subnet": "255.255.255.0", "gateway": "192.168.1.1", "dns": ["192.168.1.10", "8.8.8.8"], "mac_address": "00:1A:2B:3C:4D:01", "speed_mbps": 10000, "status": "up"},
        {"device_id": "dev-001", "adapter_name": "Ethernet 2 (Storage)", "type": "ethernet", "ip_address": "10.10.10.10", "subnet": "255.255.255.0", "gateway": None, "dns": [], "mac_address": "00:1A:2B:3C:4D:11", "speed_mbps": 25000, "status": "up"},
        {"device_id": "dev-002", "adapter_name": "Ethernet", "type": "ethernet", "ip_address": "192.168.1.101", "subnet": "255.255.255.0", "gateway": "192.168.1.1", "dns": ["192.168.1.10", "8.8.8.8"], "mac_address": "00:1A:2B:3C:4D:02", "speed_mbps": 1000, "status": "up"},
        {"device_id": "dev-007", "adapter_name": "Wi-Fi", "type": "wifi", "ip_address": "192.168.1.150", "subnet": "255.255.255.0", "gateway": "192.168.1.1", "dns": ["192.168.1.10", "8.8.8.8"], "mac_address": "00:1A:2B:3C:4D:07", "speed_mbps": 867, "status": "up", "ssid": "ACME-Corporate"},
        {"device_id": "dev-007", "adapter_name": "VPN (GlobalProtect)", "type": "vpn", "ip_address": "10.255.0.45", "subnet": "255.255.255.0", "gateway": "10.255.0.1", "dns": ["172.16.0.10"], "mac_address": None, "speed_mbps": None, "status": "up"},
        {"device_id": "dev-009", "adapter_name": "Wi-Fi (en0)", "type": "wifi", "ip_address": "172.16.1.45", "subnet": "255.255.255.0", "gateway": "172.16.1.1", "dns": ["172.16.0.10", "1.1.1.1"], "mac_address": "00:1A:2B:3C:4D:09", "speed_mbps": 1200, "status": "up", "ssid": "GF-Exec-5G"},
    ]
    for n in network_data:
        await db.device_network.insert_one(n)

    
    tickets_data = [
        {"id": "TKT-001", "title": "Server unresponsive", "description": "Main DC server not responding to ping. Users unable to authenticate.", "client_id": "client-001", "client_name": "Acme Corporation", "priority": "critical", "status": "open", "category": "infrastructure", "assigned_to": "user-002", "assigned_name": "Sarah Chen", "device_id": "dev-001", "device_name": "ACME-DC-01", "ticket_type": "incident", "impact": "high"},
        {"id": "TKT-002", "title": "Email sync issues", "description": "Outlook not syncing emails for multiple users. Exchange connectivity issues.", "client_id": "client-002", "client_name": "TechStart Inc", "priority": "high", "status": "in_progress", "category": "support", "assigned_to": "user-003", "assigned_name": "Mike Rodriguez", "device_id": "dev-003", "device_name": "TECH-SRV-01"},
        {"id": "TKT-003", "title": "New user setup - Jane Doe", "description": "Setup workstation and accounts for new employee starting Monday", "client_id": "client-001", "client_name": "Acme Corporation", "priority": "medium", "status": "open", "category": "onboarding", "assigned_to": "user-002", "assigned_name": "Sarah Chen", "device_id": "dev-002", "device_name": "ACME-WS-001", "ticket_type": "service_request"},
        {"id": "TKT-004", "title": "Printer not working", "description": "Network printer in reception area offline", "client_id": "client-004", "client_name": "HealthCare Plus", "priority": "low", "status": "resolved", "category": "hardware"},
        {"id": "TKT-005", "title": "VPN connection drops", "description": "Remote workers experiencing VPN disconnections every 30 minutes", "client_id": "client-001", "client_name": "Acme Corporation", "priority": "high", "status": "in_progress", "category": "network", "assigned_to": "user-001", "assigned_name": "Alex Thompson", "device_id": "dev-007", "device_name": "ACME-LT-001"},
        {"id": "TKT-006", "title": "High CPU usage on web server", "description": "Docker containers consuming excessive CPU. Nginx worker processes spiking to 95%.", "client_id": "client-002", "client_name": "TechStart Inc", "priority": "high", "status": "open", "category": "infrastructure", "assigned_to": "user-002", "assigned_name": "Sarah Chen", "device_id": "dev-003", "device_name": "TECH-SRV-01", "ticket_type": "incident", "impact": "high"},
        {"id": "TKT-007", "title": "Workstation BSOD - Blue Screen", "description": "John's workstation experiencing intermittent BSOD with DRIVER_IRQL_NOT_LESS_OR_EQUAL", "client_id": "client-001", "client_name": "Acme Corporation", "priority": "medium", "status": "in_progress", "category": "hardware", "assigned_to": "user-003", "assigned_name": "Mike Rodriguez", "device_id": "dev-002", "device_name": "ACME-WS-001", "ticket_type": "incident"},
        {"id": "TKT-008", "title": "Firewall rule update for new VPN subnet", "description": "Need to add rules for new 10.255.x.x VPN subnet to FortiGate", "client_id": "client-001", "client_name": "Acme Corporation", "priority": "medium", "status": "open", "category": "network", "device_id": "dev-008", "device_name": "ACME-FW-01", "ticket_type": "change_request"},
        {"id": "TKT-009", "title": "Windows patches failing on reception PC", "description": "KB5032278 fails with error 0x800f0922. Machine hasn't been patched in 4 months.", "client_id": "client-004", "client_name": "HealthCare Plus", "priority": "critical", "status": "open", "category": "patching", "assigned_to": "user-001", "assigned_name": "Alex Thompson", "device_id": "dev-005", "device_name": "HC-WS-REC01", "ticket_type": "incident", "impact": "medium"},
        {"id": "TKT-010", "title": "SSL certificate renewal - Kubernetes cluster", "description": "Cert expiring in 14 days for *.techstart.local wildcard", "client_id": "client-002", "client_name": "TechStart Inc", "priority": "high", "status": "open", "category": "infrastructure", "device_id": "dev-010", "device_name": "TECH-DOCKER-01", "ticket_type": "change_request"},
        {"id": "TKT-011", "title": "CFO MacBook slow after update", "description": "macOS Sonoma 14.3 update caused significant performance degradation", "client_id": "client-003", "client_name": "Global Finance Ltd", "priority": "high", "status": "in_progress", "category": "support", "assigned_to": "user-002", "assigned_name": "Sarah Chen", "device_id": "dev-009", "device_name": "GF-LT-CFO01", "ticket_type": "incident", "tags": ["vip"]},
        {"id": "TKT-012", "title": "POS system intermittent freezing", "description": "Register 1 freezing during checkout. Staff have to force reboot 2-3 times per day.", "client_id": "client-005", "client_name": "RetailMax", "priority": "critical", "status": "open", "category": "hardware", "assigned_to": "user-003", "assigned_name": "Mike Rodriguez", "device_id": "dev-006", "device_name": "RETAIL-POS-01", "ticket_type": "incident", "impact": "high"},
        {"id": "TKT-013", "title": "Deploy SentinelOne on HC-WS-REC01", "description": "Device currently has only Windows Defender. Need to deploy SentinelOne EDR agent.", "client_id": "client-004", "client_name": "HealthCare Plus", "priority": "medium", "status": "open", "category": "security", "device_id": "dev-005", "device_name": "HC-WS-REC01", "ticket_type": "service_request"},
        {"id": "TKT-014", "title": "DC storage nearing capacity", "description": "ACME-DC-01 disk at 78% (2808/3600 GB). Need to archive old logs and plan expansion.", "client_id": "client-001", "client_name": "Acme Corporation", "priority": "medium", "status": "open", "category": "infrastructure", "device_id": "dev-001", "device_name": "ACME-DC-01", "ticket_type": "problem"},
        {"id": "TKT-015", "title": "Laptop BitLocker recovery", "description": "Jane unable to boot laptop after BIOS update triggered BitLocker recovery.", "client_id": "client-001", "client_name": "Acme Corporation", "priority": "high", "status": "resolved", "category": "security", "assigned_to": "user-001", "assigned_name": "Alex Thompson", "device_id": "dev-007", "device_name": "ACME-LT-001", "ticket_type": "incident"},
        {"id": "TKT-016", "title": "Domain controller replication errors", "description": "AD replication failing between ACME-DC-01 and secondary DC. Event ID 1864.", "client_id": "client-001", "client_name": "Acme Corporation", "priority": "critical", "status": "in_progress", "category": "infrastructure", "assigned_to": "user-002", "assigned_name": "Sarah Chen", "device_id": "dev-001", "device_name": "ACME-DC-01", "ticket_type": "incident", "impact": "high"},
    ]
    for t in tickets_data:
        sla_hours = {"critical": 2, "high": 4, "medium": 8, "low": 24}
        sla_due = datetime.now(timezone.utc) + timedelta(hours=sla_hours.get(t['priority'], 8))
        ticket = Ticket(**t, sla_due=sla_due)
        doc = ticket.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        doc['updated_at'] = doc['updated_at'].isoformat()
        doc['sla_due'] = doc['sla_due'].isoformat() if doc['sla_due'] else None
        await db.tickets.insert_one(doc)
    
    assets_data = [
        {"id": "asset-001", "name": "Dell PowerEdge R740", "client_id": "client-001", "client_name": "Acme Corporation", "asset_type": "hardware", "manufacturer": "Dell", "model": "PowerEdge R740", "serial_number": "DELL-R740-001", "cost": 8500},
        {"id": "asset-002", "name": "Microsoft 365 Business", "client_id": "client-001", "client_name": "Acme Corporation", "asset_type": "software", "manufacturer": "Microsoft", "model": "365 Business Premium", "cost": 1200},
        {"id": "asset-003", "name": "HP ProDesk 400", "client_id": "client-002", "client_name": "TechStart Inc", "asset_type": "hardware", "manufacturer": "HP", "model": "ProDesk 400 G7", "serial_number": "HP-PD400-023", "cost": 950},
        {"id": "asset-004", "name": "Cisco Catalyst Switch", "client_id": "client-003", "client_name": "Global Finance Ltd", "asset_type": "hardware", "manufacturer": "Cisco", "model": "Catalyst 9200", "serial_number": "CISCO-C9200-001", "cost": 4200},
    ]
    for a in assets_data:
        asset = Asset(**a)
        doc = asset.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        await db.assets.insert_one(doc)
    
    alerts_data = [
        {"id": "alert-001", "device_id": "dev-003", "device_name": "TECH-SRV-01", "client_id": "client-002", "client_name": "TechStart Inc", "alert_type": "cpu_high", "severity": "warning", "message": "CPU usage above 85% for 15 minutes", "status": "active"},
        {"id": "alert-002", "device_id": "dev-005", "device_name": "HC-WS-REC01", "client_id": "client-004", "client_name": "HealthCare Plus", "alert_type": "offline", "severity": "critical", "message": "Device has been offline for 2 hours", "status": "active"},
        {"id": "alert-003", "device_id": "dev-001", "device_name": "ACME-DC-01", "client_id": "client-001", "client_name": "Acme Corporation", "alert_type": "disk_space", "severity": "warning", "message": "Disk usage at 78%", "status": "active"},
    ]
    for a in alerts_data:
        alert = Alert(**a)
        doc = alert.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        await db.alerts.insert_one(doc)
    
    # Seed contracts
    contracts_data = [
        {"id": "contract-001", "client_id": "client-001", "client_name": "Acme Corporation", "name": "Managed Services Agreement", "contract_type": "managed_services", "billing_frequency": "monthly", "start_date": "2024-01-01", "value": 2500, "status": "active"},
        {"id": "contract-002", "client_id": "client-003", "client_name": "Global Finance Ltd", "name": "Premium Support Contract", "contract_type": "managed_services", "billing_frequency": "monthly", "start_date": "2024-03-15", "value": 4200, "status": "active"},
    ]
    for c in contracts_data:
        contract = Contract(**c)
        doc = contract.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        await db.contracts.insert_one(doc)
    
    # Seed line items
    line_items_data = [
        {"id": "line-001", "contract_id": "contract-001", "client_id": "client-001", "client_name": "Acme Corporation", "name": "Microsoft 365 Business Premium", "quantity": 45, "unit_price": 22, "total": 990, "billing_frequency": "monthly"},
        {"id": "line-002", "contract_id": "contract-001", "client_id": "client-001", "client_name": "Acme Corporation", "name": "Managed Endpoint Protection", "quantity": 45, "unit_price": 8, "total": 360, "billing_frequency": "monthly"},
        {"id": "line-003", "contract_id": "contract-001", "client_id": "client-001", "client_name": "Acme Corporation", "name": "24/7 Monitoring & Support", "quantity": 1, "unit_price": 1150, "total": 1150, "billing_frequency": "monthly"},
    ]
    for l in line_items_data:
        item = LineItem(**l)
        doc = item.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        await db.line_items.insert_one(doc)
    
    # Seed KB articles
    kb_articles_data = [
        {"id": "kb-001", "title": "How to Reset Windows Password", "content": "# Resetting Windows Password\n\n## Method 1: Using Admin Account\n1. Log in as administrator\n2. Open Computer Management\n3. Navigate to Local Users and Groups\n4. Right-click user and select 'Set Password'\n\n## Method 2: Using Safe Mode\n1. Restart computer\n2. Press F8 during boot\n3. Select Safe Mode with Networking\n4. Log in as admin and reset password", "category": "windows", "tags": ["password", "windows", "reset"], "is_public": True, "views": 156, "author_id": "user-001", "author_name": "Alex Thompson"},
        {"id": "kb-002", "title": "Outlook Email Not Syncing", "content": "# Troubleshooting Outlook Sync Issues\n\n## Quick Fixes\n1. Check internet connection\n2. Restart Outlook\n3. Clear Outlook cache\n\n## Advanced Steps\n1. Run Outlook in Safe Mode: `outlook.exe /safe`\n2. Repair Office installation\n3. Create new Outlook profile\n4. Check server settings with IT", "category": "email", "tags": ["outlook", "email", "sync", "microsoft"], "is_public": True, "views": 89, "author_id": "user-002", "author_name": "Sarah Chen"},
        {"id": "kb-003", "title": "VPN Connection Troubleshooting", "content": "# VPN Troubleshooting Guide\n\n## Common Issues\n- Connection timeouts\n- Authentication failures\n- Slow speeds\n\n## Solutions\n1. **Check credentials** - Ensure username/password are correct\n2. **Try different server** - Connect to alternate VPN endpoint\n3. **Restart VPN client** - Close and reopen application\n4. **Check firewall** - Ensure VPN ports are not blocked", "category": "network", "tags": ["vpn", "network", "remote"], "is_public": False, "views": 45, "author_id": "user-001", "author_name": "Alex Thompson"},
    ]
    for kb in kb_articles_data:
        article = KBArticle(**kb)
        doc = article.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        doc['updated_at'] = doc['updated_at'].isoformat()
        await db.kb_articles.insert_one(doc)
    
    # Seed time entries
    time_entries_data = [
        {"id": "time-001", "ticket_id": "TKT-001", "ticket_title": "Server unresponsive", "client_id": "client-001", "client_name": "Acme Corporation", "user_id": "user-002", "user_name": "Sarah Chen", "description": "Initial diagnosis and remote troubleshooting", "minutes": 45, "hourly_rate": 85, "total_amount": 63.75, "billable": True, "date": datetime.now(timezone.utc).strftime('%Y-%m-%d')},
        {"id": "time-002", "ticket_id": "TKT-002", "ticket_title": "Email sync issues", "client_id": "client-002", "client_name": "TechStart Inc", "user_id": "user-003", "user_name": "Mike Rodriguez", "description": "Rebuilt Outlook profile for affected users", "minutes": 90, "hourly_rate": 75, "total_amount": 112.50, "billable": True, "date": datetime.now(timezone.utc).strftime('%Y-%m-%d')},
    ]
    for te in time_entries_data:
        entry = TimeEntry(**te)
        doc = entry.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        await db.time_entries.insert_one(doc)
    
    # Seed Products
    products_data = [
        {"id": "prod-001", "name": "Dell OptiPlex 7090 SFF", "sku": "DELL-OPT-7090", "description": "Small form factor desktop with Intel Core i7-11700, 16GB RAM, 512GB SSD", "category": "Hardware", "vendor": "Dell Technologies", "cost_price": 899.00, "retail_price": 1199.00, "tax_rate": 10.0, "quantity_in_stock": 15, "reorder_level": 5, "unit": "each", "is_active": True, "is_taxable": True, "is_recurring": False, "barcode": "DELL-OPT-7090", "barcode_type": "code128"},
        {"id": "prod-002", "name": "Microsoft 365 Business Premium", "sku": "MS365-BIZ-PREM", "description": "Monthly per-user license for Microsoft 365 Business Premium", "category": "Licensing", "vendor": "Microsoft", "cost_price": 18.00, "retail_price": 22.00, "tax_rate": 0.0, "quantity_in_stock": 200, "reorder_level": 50, "unit": "license", "is_active": True, "is_taxable": False, "is_recurring": True, "billing_cycle": "monthly", "barcode": "MS365-BIZ-PREM", "barcode_type": "code128"},
        {"id": "prod-003", "name": "Ubiquiti UniFi U6-LR Access Point", "sku": "UI-U6LR-AP", "description": "WiFi 6 Long-Range Access Point, 4x4 MIMO, PoE+", "category": "Networking", "vendor": "Ubiquiti", "cost_price": 149.00, "retail_price": 199.00, "tax_rate": 10.0, "quantity_in_stock": 8, "reorder_level": 3, "unit": "each", "is_active": True, "is_taxable": True, "is_recurring": False, "barcode": "UI-U6LR-AP", "barcode_type": "code128"},
        {"id": "prod-004", "name": "SentinelOne Complete", "sku": "S1-COMPLETE-YR", "description": "SentinelOne endpoint protection per-device annual license", "category": "Security", "vendor": "SentinelOne", "cost_price": 45.00, "retail_price": 65.00, "tax_rate": 0.0, "quantity_in_stock": 100, "reorder_level": 20, "unit": "license", "is_active": True, "is_taxable": False, "is_recurring": True, "billing_cycle": "annually", "barcode": "S1-COMPLETE-YR", "barcode_type": "code128"},
        {"id": "prod-005", "name": "Cat6A Ethernet Cable 5m", "sku": "CAT6A-5M-BLU", "description": "Category 6A shielded ethernet cable, 5 meters, blue", "category": "Accessories", "vendor": "CommScope", "cost_price": 8.50, "retail_price": 15.00, "tax_rate": 10.0, "quantity_in_stock": 45, "reorder_level": 10, "unit": "each", "is_active": True, "is_taxable": True, "is_recurring": False, "barcode": "CAT6A-5M-BLU", "barcode_type": "code128"},
        {"id": "prod-006", "name": "Acronis Cyber Protect Cloud", "sku": "ACR-CP-CLOUD", "description": "Cloud backup and disaster recovery per-device monthly", "category": "Cloud", "vendor": "Acronis", "cost_price": 2.50, "retail_price": 5.00, "tax_rate": 0.0, "quantity_in_stock": 500, "reorder_level": 100, "unit": "license", "is_active": True, "is_taxable": False, "is_recurring": True, "billing_cycle": "monthly", "barcode": "ACR-CP-CLOUD", "barcode_type": "code128"},
        {"id": "prod-007", "name": "Lenovo ThinkPad T14s Gen 4", "sku": "LEN-T14S-G4", "description": "14\" laptop, AMD Ryzen 7 PRO, 16GB, 512GB SSD", "category": "Hardware", "vendor": "Lenovo", "cost_price": 1050.00, "retail_price": 1399.00, "tax_rate": 10.0, "quantity_in_stock": 3, "reorder_level": 5, "unit": "each", "is_active": True, "is_taxable": True, "is_recurring": False, "barcode": "LEN-T14S-G4", "barcode_type": "code128"},
        {"id": "prod-008", "name": "UniFi USW-24-PoE Switch", "sku": "UI-USW24-POE", "description": "24-port PoE managed switch with 2x SFP+", "category": "Networking", "vendor": "Ubiquiti", "cost_price": 399.00, "retail_price": 549.00, "tax_rate": 10.0, "quantity_in_stock": 4, "reorder_level": 2, "unit": "each", "is_active": True, "is_taxable": True, "is_recurring": False, "barcode": "UI-USW24-POE", "barcode_type": "code128"},
        {"id": "prod-009", "name": "Remote Support - Hourly", "sku": "SVC-REM-HR", "description": "Remote technical support, billed per hour", "category": "Services", "vendor": "Flamingo MSP", "cost_price": 0.00, "retail_price": 125.00, "tax_rate": 0.0, "quantity_in_stock": 999, "reorder_level": 0, "unit": "hour", "is_active": True, "is_taxable": False, "is_recurring": False, "barcode": "SVC-REM-HR", "barcode_type": "code128"},
        {"id": "prod-010", "name": "HP LaserJet Pro MFP M428fdn", "sku": "HP-LJ-M428", "description": "All-in-one laser printer, scan, copy, fax", "category": "Hardware", "vendor": "HP Inc", "cost_price": 349.00, "retail_price": 449.00, "tax_rate": 10.0, "quantity_in_stock": 2, "reorder_level": 2, "unit": "each", "is_active": True, "is_taxable": True, "is_recurring": False, "barcode": "HP-LJ-M428", "barcode_type": "code128"},
    ]
    for p in products_data:
        p["barcode_image"] = generate_barcode_svg_data(p["barcode"], p["barcode_type"])
        p["created_by"] = "user-001"
        p["created_at"] = datetime.now(timezone.utc).isoformat()
        p["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.products.insert_one(p)

    # Seed Network Sites
    network_sites_data = [
        {"id": "nsite-001", "name": "Acme Corp - Main Office", "client_id": "client-001", "client_name": "Acme Corporation", "controller_url": "https://192.168.1.1:8443", "site_id": "default", "status": "online", "location": "123 Business Ave, Suite 200", "wan_ip": "203.45.67.10", "isp": "AT&T Business Fiber", "download_speed_mbps": 500, "upload_speed_mbps": 100},
        {"id": "nsite-002", "name": "TechStart - Cloud DC", "client_id": "client-002", "client_name": "TechStart Inc", "controller_url": "https://10.0.0.1:8443", "site_id": "techstart", "status": "online", "location": "AWS US-East-1", "wan_ip": "45.67.89.12", "isp": "AWS Direct Connect", "download_speed_mbps": 1000, "upload_speed_mbps": 1000},
        {"id": "nsite-003", "name": "Global Finance - HQ", "client_id": "client-003", "client_name": "Global Finance Ltd", "controller_url": "https://172.16.0.1:8443", "site_id": "gf-hq", "status": "online", "location": "456 Finance Blvd, Floor B2", "wan_ip": "91.23.45.67", "isp": "Verizon FiOS Business", "download_speed_mbps": 940, "upload_speed_mbps": 880},
        {"id": "nsite-004", "name": "HealthCare Plus - Clinic", "client_id": "client-004", "client_name": "HealthCare Plus", "controller_url": "https://192.168.5.1:8443", "site_id": "hcplus", "status": "warning", "location": "789 Health Way", "wan_ip": "67.89.12.34", "isp": "Comcast Business", "download_speed_mbps": 200, "upload_speed_mbps": 35},
        {"id": "nsite-005", "name": "RetailMax - Store Network", "client_id": "client-005", "client_name": "RetailMax", "controller_url": "https://192.168.10.1:8443", "site_id": "retail", "status": "online", "location": "101 Retail Rd", "wan_ip": "34.56.78.90", "isp": "Spectrum Business", "download_speed_mbps": 300, "upload_speed_mbps": 50},
    ]
    for s in network_sites_data:
        s["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.network_sites.insert_one(s)

    # Seed Network Devices
    network_devices_data = [
        # Acme Corp devices
        {"id": "ndev-001", "site_id": "nsite-001", "name": "USG-Pro-4", "mac": "F0:9F:C2:AA:01:01", "model": "UniFi Security Gateway Pro", "device_type": "gateway", "ip_address": "192.168.1.1", "status": "online", "firmware": "6.0.45", "uptime_seconds": 7776000, "cpu_usage": 12, "mem_usage": 34, "wan_ip": "203.45.67.10", "num_ports": 4, "throughput_rx_mbps": 245.3, "throughput_tx_mbps": 89.7},
        {"id": "ndev-002", "site_id": "nsite-001", "name": "USW-48-PoE", "mac": "F0:9F:C2:AA:02:01", "model": "UniFi Switch 48 PoE", "device_type": "switch", "ip_address": "192.168.1.2", "status": "online", "firmware": "6.6.65", "uptime_seconds": 7776000, "cpu_usage": 8, "mem_usage": 22, "num_ports": 48, "poe_power_w": 187.3, "poe_max_w": 740, "port_stats": [{"port": 1, "up": True, "speed": "1000M", "poe": True, "power_w": 12.4}, {"port": 2, "up": True, "speed": "1000M", "poe": True, "power_w": 8.1}]},
        {"id": "ndev-003", "site_id": "nsite-001", "name": "U6-LR-Lobby", "mac": "F0:9F:C2:AA:03:01", "model": "U6-LR", "device_type": "ap", "ip_address": "192.168.1.10", "status": "online", "firmware": "7.0.83", "uptime_seconds": 5184000, "cpu_usage": 15, "mem_usage": 38, "channel_2g": 6, "channel_5g": 36, "clients_2g": 8, "clients_5g": 14, "tx_power_2g": 20, "tx_power_5g": 23, "satisfaction": 96},
        {"id": "ndev-004", "site_id": "nsite-001", "name": "U6-LR-Floor2", "mac": "F0:9F:C2:AA:03:02", "model": "U6-LR", "device_type": "ap", "ip_address": "192.168.1.11", "status": "online", "firmware": "7.0.83", "uptime_seconds": 5184000, "cpu_usage": 22, "mem_usage": 45, "channel_2g": 11, "channel_5g": 149, "clients_2g": 12, "clients_5g": 18, "tx_power_2g": 20, "tx_power_5g": 23, "satisfaction": 92},
        # TechStart devices
        {"id": "ndev-005", "site_id": "nsite-002", "name": "UDM-Pro", "mac": "F0:9F:C2:BB:01:01", "model": "UniFi Dream Machine Pro", "device_type": "gateway", "ip_address": "10.0.0.1", "status": "online", "firmware": "4.0.6", "uptime_seconds": 2592000, "cpu_usage": 28, "mem_usage": 52, "wan_ip": "45.67.89.12", "num_ports": 8, "throughput_rx_mbps": 567.8, "throughput_tx_mbps": 423.1},
        {"id": "ndev-006", "site_id": "nsite-002", "name": "USW-Pro-24-PoE", "mac": "F0:9F:C2:BB:02:01", "model": "USW-Pro-24-PoE", "device_type": "switch", "ip_address": "10.0.0.2", "status": "online", "firmware": "6.6.65", "uptime_seconds": 2592000, "cpu_usage": 5, "mem_usage": 18, "num_ports": 24, "poe_power_w": 92.5, "poe_max_w": 400},
        {"id": "ndev-007", "site_id": "nsite-002", "name": "U6-Enterprise", "mac": "F0:9F:C2:BB:03:01", "model": "U6-Enterprise", "device_type": "ap", "ip_address": "10.0.0.10", "status": "online", "firmware": "7.0.83", "uptime_seconds": 2592000, "cpu_usage": 10, "mem_usage": 30, "channel_2g": 1, "channel_5g": 44, "clients_2g": 3, "clients_5g": 22, "satisfaction": 98},
        # Global Finance devices
        {"id": "ndev-008", "site_id": "nsite-003", "name": "UXG-Pro", "mac": "F0:9F:C2:CC:01:01", "model": "UniFi Next-Gen Gateway Pro", "device_type": "gateway", "ip_address": "172.16.0.1", "status": "online", "firmware": "4.0.6", "uptime_seconds": 15552000, "cpu_usage": 18, "mem_usage": 41, "wan_ip": "91.23.45.67", "num_ports": 4, "throughput_rx_mbps": 890.2, "throughput_tx_mbps": 654.8},
        {"id": "ndev-009", "site_id": "nsite-003", "name": "USW-Enterprise-48-PoE", "mac": "F0:9F:C2:CC:02:01", "model": "USW-Enterprise-48-PoE", "device_type": "switch", "ip_address": "172.16.0.2", "status": "online", "firmware": "6.6.65", "uptime_seconds": 15552000, "cpu_usage": 14, "mem_usage": 28, "num_ports": 48, "poe_power_w": 312.8, "poe_max_w": 740},
        {"id": "ndev-010", "site_id": "nsite-003", "name": "USW-Enterprise-48-PoE-2", "mac": "F0:9F:C2:CC:02:02", "model": "USW-Enterprise-48-PoE", "device_type": "switch", "ip_address": "172.16.0.3", "status": "online", "firmware": "6.6.65", "uptime_seconds": 15552000, "cpu_usage": 11, "mem_usage": 24, "num_ports": 48, "poe_power_w": 245.1, "poe_max_w": 740},
        {"id": "ndev-011", "site_id": "nsite-003", "name": "U6-Pro-TradeFloor", "mac": "F0:9F:C2:CC:03:01", "model": "U6-Pro", "device_type": "ap", "ip_address": "172.16.0.10", "status": "online", "firmware": "7.0.83", "uptime_seconds": 15552000, "cpu_usage": 35, "mem_usage": 56, "channel_2g": 6, "channel_5g": 36, "clients_2g": 15, "clients_5g": 45, "satisfaction": 89},
        {"id": "ndev-012", "site_id": "nsite-003", "name": "U6-Pro-ExecSuite", "mac": "F0:9F:C2:CC:03:02", "model": "U6-Pro", "device_type": "ap", "ip_address": "172.16.0.11", "status": "online", "firmware": "7.0.83", "uptime_seconds": 15552000, "cpu_usage": 8, "mem_usage": 25, "channel_2g": 11, "channel_5g": 149, "clients_2g": 4, "clients_5g": 12, "satisfaction": 97},
        # HealthCare Plus
        {"id": "ndev-013", "site_id": "nsite-004", "name": "USG-3P", "mac": "F0:9F:C2:DD:01:01", "model": "UniFi Security Gateway", "device_type": "gateway", "ip_address": "192.168.5.1", "status": "warning", "firmware": "4.4.57", "uptime_seconds": 864000, "cpu_usage": 78, "mem_usage": 82, "wan_ip": "67.89.12.34", "num_ports": 3, "throughput_rx_mbps": 145.2, "throughput_tx_mbps": 28.4},
        {"id": "ndev-014", "site_id": "nsite-004", "name": "U6-Lite-Waiting", "mac": "F0:9F:C2:DD:03:01", "model": "U6-Lite", "device_type": "ap", "ip_address": "192.168.5.10", "status": "online", "firmware": "7.0.83", "uptime_seconds": 864000, "cpu_usage": 5, "mem_usage": 20, "channel_2g": 1, "channel_5g": 44, "clients_2g": 6, "clients_5g": 8, "satisfaction": 94},
        # RetailMax
        {"id": "ndev-015", "site_id": "nsite-005", "name": "UDM", "mac": "F0:9F:C2:EE:01:01", "model": "UniFi Dream Machine", "device_type": "gateway", "ip_address": "192.168.10.1", "status": "online", "firmware": "4.0.6", "uptime_seconds": 3456000, "cpu_usage": 20, "mem_usage": 45, "wan_ip": "34.56.78.90", "num_ports": 4, "throughput_rx_mbps": 78.5, "throughput_tx_mbps": 23.1},
        {"id": "ndev-016", "site_id": "nsite-005", "name": "USW-Lite-16-PoE", "mac": "F0:9F:C2:EE:02:01", "model": "USW-Lite-16-PoE", "device_type": "switch", "ip_address": "192.168.10.2", "status": "online", "firmware": "6.6.65", "uptime_seconds": 3456000, "cpu_usage": 3, "mem_usage": 15, "num_ports": 16, "poe_power_w": 45.2, "poe_max_w": 120},
    ]
    for d in network_devices_data:
        d["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.network_devices.insert_one(d)

    # Seed Network Clients
    network_clients_data = [
        {"id": "ncli-001", "site_id": "nsite-001", "mac": "A4:83:E7:01:01:01", "name": "John-MacBook", "ip_address": "192.168.1.101", "hostname": "Johns-MacBook-Pro", "os_type": "macOS", "is_wireless": True, "is_connected": True, "signal_strength": -52, "rx_bytes": 2457600000, "tx_bytes": 1228800000, "ap_name": "U6-LR-Floor2", "ssid": "ACME-Corp"},
        {"id": "ncli-002", "site_id": "nsite-001", "mac": "A4:83:E7:01:02:01", "name": "ACC-PC-001", "ip_address": "192.168.1.102", "hostname": "ACC-PC-001", "os_type": "Windows", "is_wireless": False, "is_connected": True, "rx_bytes": 5242880000, "tx_bytes": 524288000},
        {"id": "ncli-003", "site_id": "nsite-001", "mac": "A4:83:E7:01:03:01", "name": "Printer-Floor1", "ip_address": "192.168.1.200", "hostname": "HP-MFP-M428", "os_type": "Other", "is_wireless": False, "is_connected": True, "rx_bytes": 104857600, "tx_bytes": 52428800},
        {"id": "ncli-004", "site_id": "nsite-002", "mac": "B8:27:EB:02:01:01", "name": "Dev-Server-01", "ip_address": "10.0.0.50", "hostname": "dev-server-01", "os_type": "Linux", "is_wireless": False, "is_connected": True, "rx_bytes": 52428800000, "tx_bytes": 26214400000},
        {"id": "ncli-005", "site_id": "nsite-002", "mac": "B8:27:EB:02:02:01", "name": "Sarah-iPhone", "ip_address": "10.0.0.120", "hostname": "Sarahs-iPhone", "os_type": "iOS", "is_wireless": True, "is_connected": True, "signal_strength": -45, "rx_bytes": 524288000, "tx_bytes": 262144000, "ap_name": "U6-Enterprise", "ssid": "TechStart-5G"},
        {"id": "ncli-006", "site_id": "nsite-003", "mac": "C0:25:E9:03:01:01", "name": "Trade-WS-001", "ip_address": "172.16.0.100", "hostname": "TRADE-WS-001", "os_type": "Windows", "is_wireless": False, "is_connected": True, "rx_bytes": 10485760000, "tx_bytes": 5242880000},
        {"id": "ncli-007", "site_id": "nsite-003", "mac": "C0:25:E9:03:02:01", "name": "CEO-iPad", "ip_address": "172.16.0.150", "hostname": "CEOs-iPad-Pro", "os_type": "iOS", "is_wireless": True, "is_connected": True, "signal_strength": -38, "rx_bytes": 1073741824, "tx_bytes": 536870912, "ap_name": "U6-Pro-ExecSuite", "ssid": "GF-Executive"},
        {"id": "ncli-008", "site_id": "nsite-004", "mac": "D4:F5:47:04:01:01", "name": "Reception-PC", "ip_address": "192.168.5.20", "hostname": "HC-RECEPTION", "os_type": "Windows", "is_wireless": False, "is_connected": True, "rx_bytes": 2147483648, "tx_bytes": 1073741824},
        {"id": "ncli-009", "site_id": "nsite-005", "mac": "E8:6F:38:05:01:01", "name": "POS-Terminal-1", "ip_address": "192.168.10.50", "hostname": "POS-01", "os_type": "Windows", "is_wireless": False, "is_connected": True, "rx_bytes": 524288000, "tx_bytes": 262144000},
        {"id": "ncli-010", "site_id": "nsite-005", "mac": "E8:6F:38:05:02:01", "name": "Staff-Android", "ip_address": "192.168.10.120", "hostname": "Galaxy-S24", "os_type": "Android", "is_wireless": True, "is_connected": True, "signal_strength": -60, "rx_bytes": 209715200, "tx_bytes": 104857600, "ap_name": "UDM", "ssid": "RetailMax-Staff"},
    ]
    for c in network_clients_data:
        c["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.network_clients.insert_one(c)

    return {"message": "Demo data seeded successfully"}

# ============== YEASTAR PBX ENDPOINTS ==============

@api_router.get("/yeastar/status")
async def get_yeastar_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    return {"configured": bool(settings and settings.get("client_id") and settings.get("pbx_url"))}

@api_router.post("/yeastar/settings")
async def save_yeastar_settings(settings: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "yeastar"},
        {"$set": {
            "type": "yeastar",
            "pbx_url": settings.get("pbx_url", ""),
            "client_id": settings.get("client_id", ""),
            "client_secret": settings.get("client_secret", ""),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    _yeastar_token_cache["token"] = None
    _yeastar_token_cache["expires"] = 0
    _yeastar_token_cache["refresh_token"] = None
    return {"message": "Yeastar settings saved"}

@api_router.get("/yeastar/settings")
async def get_yeastar_settings(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    if settings:
        settings.pop("client_secret", None)
    return settings or {"type": "yeastar", "pbx_url": "", "client_id": ""}

@api_router.get("/yeastar/test-connection")
async def test_yeastar_connection(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    if not settings or not settings.get("client_id"):
        return {"success": False, "message": "Yeastar not configured. Please add PBX URL, Client ID and Client Secret."}
    try:
        token = await _yeastar_get_token(settings)
        if token:
            return {"success": True, "message": "Successfully connected to Yeastar PBX."}
        return {"success": False, "message": "Authentication failed. This may be due to max token limit (8) — tokens auto-expire after 30 minutes. Try again shortly."}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}

import asyncio

_yeastar_token_lock = asyncio.Lock()
_yeastar_token_cache = {"token": None, "expires": 0, "client_id": None}

async def _yeastar_get_token(settings: dict) -> str | None:
    """Get access token from Yeastar PBX with caching and lock"""
    pbx_url = settings.get("pbx_url", "").rstrip("/")
    client_id = settings.get("client_id", "")
    client_secret = settings.get("client_secret", "")
    if not pbx_url or not client_id or not client_secret:
        return None
    
    async with _yeastar_token_lock:
        now = datetime.now(timezone.utc).timestamp()
        if (_yeastar_token_cache["token"] and 
            _yeastar_token_cache["client_id"] == client_id and 
            now < _yeastar_token_cache["expires"]):
            return _yeastar_token_cache["token"]
        
        url = f"{pbx_url}/openapi/v1.0/get_token"
        try:
            async with httpx.AsyncClient(verify=False, timeout=15) as http:
                resp = await http.post(url, json={"username": client_id, "password": client_secret}, headers={"User-Agent": "OpenAPI", "Content-Type": "application/json"})
                data = resp.json()
                if data.get("errcode") == 0:
                    token = data.get("access_token")
                    _yeastar_token_cache["token"] = token
                    _yeastar_token_cache["expires"] = now + data.get("access_token_expire_time", 1800) - 60
                    _yeastar_token_cache["client_id"] = client_id
                    _yeastar_token_cache["refresh_token"] = data.get("refresh_token")
                    return token
                if data.get("errcode") == 60002:
                    logger.warning("Yeastar max tokens exceeded, waiting for auto-expiry")
                logger.error(f"Yeastar auth: {data.get('errmsg', 'Unknown error')}")
                return None
        except Exception as e:
            logger.error(f"Yeastar auth error: {e}")
            return None

async def _yeastar_api_get(path: str, params: dict = None) -> dict | list | None:
    """Make authenticated GET request to Yeastar PBX"""
    settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    if not settings:
        return None
    token = await _yeastar_get_token(settings)
    if not token:
        return None
    pbx_url = settings.get("pbx_url", "").rstrip("/")
    url = f"{pbx_url}/openapi/v1.0/{path}"
    query = {"access_token": token}
    if params:
        query.update(params)
    try:
        async with httpx.AsyncClient(verify=False, timeout=15) as http:
            resp = await http.get(url, params=query, headers={"User-Agent": "OpenAPI"})
            if resp.status_code == 200 and resp.text:
                return resp.json()
            logger.error(f"Yeastar API {path}: status={resp.status_code}, body={resp.text[:200]}")
            return None
    except Exception as e:
        logger.error(f"Yeastar API {path} error: {e}")
        return None

@api_router.get("/yeastar/system-info")
async def get_yeastar_system_info(current_user: dict = Depends(get_current_user)):
    data = await _yeastar_api_get("system/information")
    if data and data.get("errcode") == 0:
        info = data.get("data", {})
        uptime_sec = info.get("up_time", 0)
        days = uptime_sec // 86400
        hours = (uptime_sec % 86400) // 3600
        return {
            "hostname": info.get("device_name", "Unknown"),
            "firmware_version": info.get("firmware_version", "Unknown"),
            "model": info.get("model_name", ""),
            "serial_number": info.get("sn", ""),
            "system_time": info.get("system_time", ""),
            "uptime": f"{days} days, {hours} hours",
            "source": "live"
        }
    return {
        "hostname": "Not available", "firmware_version": "N/A",
        "model": "", "serial_number": "", "system_time": "",
        "uptime": "N/A", "source": "error",
        "error": data.get("errmsg", "Failed to connect") if data else "No credentials configured"
    }

@api_router.get("/yeastar/extensions")
async def get_yeastar_extensions(current_user: dict = Depends(get_current_user)):
    data = await _yeastar_api_get("extension/list")
    if data and data.get("errcode") == 0:
        raw = data.get("data", [])
        result = []
        for i, ext in enumerate(raw if isinstance(raw, list) else []):
            # Determine registration status from online_status
            online = ext.get("online_status", {})
            registered = False
            ip_addr = None
            device_type = "Unknown"
            for dev_key in ["sip_phone", "linkus_desktop", "linkus_mobile", "linkus_web", "fxs_phone"]:
                dev = online.get(dev_key, {})
                if dev.get("status") == 1 or (isinstance(dev.get("status_list", []), list) and any(s.get("status") == 1 for s in dev.get("status_list", []))):
                    registered = True
                    device_type = dev_key.replace("_", " ").title()
                    # Get IP from status_list
                    for s in dev.get("status_list", []):
                        if s.get("ip"):
                            ip_addr = s["ip"].split(":")[0]
                    if not ip_addr and dev.get("ip"):
                        ip_addr = dev["ip"]
                    break
            result.append({
                "id": ext.get("id", i + 1),
                "number": str(ext.get("number", "")),
                "name": ext.get("caller_id_name", f"Ext {ext.get('number', i)}"),
                "status": ext.get("presence_status", ext.get("custom_presence_status", "unknown")),
                "device": device_type,
                "registered": registered,
                "ip": ip_addr,
            })
        return result
    return []

@api_router.get("/yeastar/active-calls")
async def get_yeastar_active_calls(current_user: dict = Depends(get_current_user)):
    data = await _yeastar_api_get("call/query")
    if data and data.get("errcode") == 0:
        raw = data.get("data", [])
        if not raw or raw is None:
            return []
        result = []
        for call in (raw if isinstance(raw, list) else []):
            caller = str(call.get("caller", call.get("call_from", "")))
            callee = str(call.get("callee", call.get("call_to", "")))
            result.append({
                "call_id": str(call.get("id", call.get("call_id", uuid.uuid4()))),
                "caller": caller,
                "caller_name": call.get("caller_name", call.get("caller_id_name", caller)),
                "callee": callee,
                "callee_name": call.get("callee_name", call.get("callee_id_name", callee)),
                "direction": call.get("direction", "internal"),
                "duration": call.get("duration", call.get("talk_duration", 0)),
                "status": call.get("status", call.get("call_status", "answered")).lower(),
                "started_at": call.get("started_at", call.get("time_start", datetime.now(timezone.utc).isoformat())),
            })
        return result
    return []

@api_router.get("/yeastar/call-logs")
async def get_yeastar_call_logs(
    page: int = 1,
    page_size: int = 20,
    current_user: dict = Depends(get_current_user)
):
    data = await _yeastar_api_get("cdr/list", {"page": page, "page_size": page_size})
    if data and data.get("errcode") == 0:
        raw = data.get("data", [])
        total = data.get("total_number", len(raw) if isinstance(raw, list) else 0)
        result = []
        for cdr in (raw if isinstance(raw, list) else []):
            call_from = cdr.get("call_from", "")
            call_to = cdr.get("call_to", "")
            call_type = cdr.get("call_type", "").lower()
            if call_type == "inbound":
                direction = "inbound"
            elif call_type == "outbound":
                direction = "outbound"
            else:
                direction = "internal"
            disposition = cdr.get("disposition", "").upper()
            status = "answered" if disposition == "ANSWERED" else "missed" if disposition in ("NO ANSWER", "NOANSWER") else "failed" if disposition == "FAILED" else disposition.lower()
            # Parse caller name from "Name<ext>" format
            caller_name = call_from
            caller_num = call_from
            if "<" in call_from and ">" in call_from:
                parts = call_from.split("<")
                caller_name = parts[0].strip()
                caller_num = parts[1].rstrip(">")
            callee_name = call_to
            callee_num = call_to
            if "<" in call_to and ">" in call_to:
                parts = call_to.split("<")
                callee_name = parts[0].strip()
                callee_num = parts[1].rstrip(">")
            dur = int(cdr.get("duration", 0))
            talk = int(cdr.get("billsec", cdr.get("talk_duration", dur)))
            result.append({
                "id": str(cdr.get("id", cdr.get("uid", ""))),
                "caller": caller_num,
                "caller_name": caller_name if caller_name != caller_num else caller_num,
                "callee": callee_num,
                "callee_name": callee_name if callee_name != callee_num else callee_num,
                "direction": direction,
                "duration": dur,
                "talking_time": talk,
                "status": status,
                "recording": bool(cdr.get("recording", "")),
                "timestamp": cdr.get("time", datetime.now(timezone.utc).isoformat()),
            })
        return {"total": total, "page": page, "page_size": page_size, "data": result}
    return {"total": 0, "page": page, "page_size": page_size, "data": []}

@api_router.get("/yeastar/dashboard")
async def get_yeastar_dashboard(current_user: dict = Depends(get_current_user)):
    extensions = await get_yeastar_extensions(current_user)
    active_calls = await get_yeastar_active_calls(current_user)
    call_logs_resp = await get_yeastar_call_logs(page=1, page_size=200, current_user=current_user)
    call_logs = call_logs_resp.get("data", [])

    total_ext = len(extensions)
    online_ext = len([e for e in extensions if e.get("registered")])
    num_active = len(active_calls)
    answered = [c for c in call_logs if c.get("status") == "answered"]
    missed = [c for c in call_logs if c.get("status") in ("missed", "no answer")]
    total_talk = sum(c.get("talking_time", 0) for c in answered)
    avg_dur = (total_talk // len(answered)) if answered else 0
    avg_m, avg_s = divmod(avg_dur, 60)
    tot_m, tot_s = divmod(total_talk, 60)
    tot_h, tot_m = divmod(tot_m, 60)

    return {
        "total_extensions": total_ext,
        "online_extensions": online_ext,
        "active_calls": num_active,
        "calls_today": len(call_logs),
        "missed_calls_today": len(missed),
        "avg_call_duration": f"{avg_m}m {avg_s}s",
        "total_talk_time_today": f"{tot_h}h {tot_m}m",
        "trunks": {"total": 0, "active": 0},
    }

@api_router.get("/")
async def root():
    return {"message": "NexusOps API v2.0.0", "status": "operational"}

# Stripe webhook - outside api_router since it needs raw body
from fastapi import Request as FastAPIRequest

@app.post("/api/webhook/stripe")
async def stripe_webhook(request: FastAPIRequest):
    body = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    stripe_key = os.environ.get("STRIPE_API_KEY")
    if not stripe_key:
        return {"status": "stripe not configured"}
    try:
        from emergentintegrations.payments.stripe.checkout import StripeCheckout
        stripe_checkout = StripeCheckout(api_key=stripe_key, webhook_url="")
        webhook_response = await stripe_checkout.handle_webhook(body, sig)
        if webhook_response.payment_status == "paid" and webhook_response.session_id:
            existing = await db.payment_transactions.find_one({"session_id": webhook_response.session_id, "payment_status": "paid"})
            if not existing:
                await db.payment_transactions.update_one(
                    {"session_id": webhook_response.session_id},
                    {"$set": {"payment_status": "paid", "updated_at": datetime.now(timezone.utc).isoformat()}}
                )
                inv_id = webhook_response.metadata.get("invoice_id")
                if inv_id:
                    invoice = await db.invoices.find_one({"id": inv_id}, {"_id": 0})
                    if invoice:
                        new_paid = float(invoice.get("amount_paid", 0)) + float(webhook_response.amount_total / 100)
                        p_status = "paid" if new_paid >= float(invoice.get("total", 0)) else "partial"
                        await db.invoices.update_one({"id": inv_id}, {
                            "$set": {"payment_status": p_status, "amount_paid": new_paid,
                                     "status": "paid" if p_status == "paid" else invoice.get("status"),
                                     "paid_date": datetime.now(timezone.utc).strftime("%Y-%m-%d") if p_status == "paid" else None},
                            "$push": {"payments": {"amount": webhook_response.amount_total / 100, "method": "stripe",
                                                   "date": datetime.now(timezone.utc).isoformat(), "session_id": webhook_response.session_id}}
                        })
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {"status": "error", "detail": str(e)}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
