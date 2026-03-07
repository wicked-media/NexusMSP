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
    avatar: Optional[str] = None
    hourly_rate: float = 75.0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ClientCreate(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    industry: Optional[str] = None
    contract_type: str = "monthly"
    mrr: float = 0.0

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
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class TicketCreate(BaseModel):
    title: str
    description: str
    client_id: str
    priority: str = "medium"
    category: str = "support"
    assigned_to: Optional[str] = None

class Ticket(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str
    client_id: str
    client_name: Optional[str] = None
    priority: str = "medium"
    status: str = "open"
    category: str = "support"
    assigned_to: Optional[str] = None
    assigned_name: Optional[str] = None
    sla_due: Optional[datetime] = None
    total_time_minutes: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DeviceCreate(BaseModel):
    name: str
    client_id: str
    device_type: str = "workstation"
    os: str = "Windows 11"
    ip_address: Optional[str] = None
    serial_number: Optional[str] = None

class Device(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    client_id: str
    client_name: Optional[str] = None
    device_type: str = "workstation"
    os: str = "Windows 11"
    ip_address: Optional[str] = None
    serial_number: Optional[str] = None
    status: str = "online"
    last_seen: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    cpu_usage: float = 0.0
    memory_usage: float = 0.0
    disk_usage: float = 0.0
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

class Invoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    invoice_number: str = Field(default_factory=lambda: f"INV-{datetime.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:4].upper()}")
    client_id: str
    client_name: Optional[str] = None
    contract_id: Optional[str] = None
    status: str = "draft"
    subtotal: float = 0.0
    tax: float = 0.0
    total: float = 0.0
    due_date: str
    paid_date: Optional[str] = None
    notes: Optional[str] = None
    line_items: List[Dict[str, Any]] = []
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
    user_id: str
    user_name: Optional[str] = None
    session_type: str = "remote_desktop"  # remote_desktop, terminal, file_transfer
    status: str = "active"  # active, ended, failed
    rustdesk_id: Optional[str] = None
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

# ============== TICKET EMAIL MODELS ==============

class TicketEmailCreate(BaseModel):
    ticket_id: str
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
    
    ticket = Ticket(
        **ticket_data.model_dump(),
        client_name=client_name,
        assigned_name=assigned_name,
        sla_due=sla_due
    )
    doc = ticket.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    doc['sla_due'] = doc['sla_due'].isoformat() if doc['sla_due'] else None
    await db.tickets.insert_one(doc)
    await db.clients.update_one({"id": ticket_data.client_id}, {"$inc": {"ticket_count": 1}})
    return ticket

@api_router.put("/tickets/{ticket_id}")
async def update_ticket(ticket_id: str, ticket_data: dict, current_user: dict = Depends(get_current_user)):
    ticket_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    result = await db.tickets.update_one({"id": ticket_id}, {"$set": ticket_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {"message": "Ticket updated"}

@api_router.delete("/tickets/{ticket_id}")
async def delete_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if ticket:
        await db.clients.update_one({"id": ticket['client_id']}, {"$inc": {"ticket_count": -1}})
    result = await db.tickets.delete_one({"id": ticket_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {"message": "Ticket deleted"}

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
    return device

@api_router.put("/devices/{device_id}")
async def update_device(device_id: str, device_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.devices.update_one({"id": device_id}, {"$set": device_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device updated"}

@api_router.delete("/devices/{device_id}")
async def delete_device(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if device:
        await db.clients.update_one({"id": device['client_id']}, {"$inc": {"device_count": -1}})
    result = await db.devices.delete_one({"id": device_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device deleted"}

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

@api_router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice

@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(invoice_data: InvoiceCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": invoice_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    subtotal = sum(item.get('total', item.get('quantity', 1) * item.get('unit_price', 0)) for item in invoice_data.line_items)
    tax = subtotal * 0.0  # Configure tax rate as needed
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
        total=total
    )
    doc = invoice.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.invoices.insert_one(doc)
    return invoice

@api_router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, invoice_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.invoices.update_one({"id": invoice_id}, {"$set": invoice_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"message": "Invoice updated"}

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.invoices.delete_one({"id": invoice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
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

@api_router.get("/users", response_model=List[User])
async def get_users(current_user: dict = Depends(get_current_user)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    return users

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
    
    session = RemoteSession(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        user_id=current_user['id'],
        user_name=current_user['name'],
        session_type=session_type,
        rustdesk_id=device.get('rustdesk_id')
    )
    doc = session.model_dump()
    doc['started_at'] = doc['started_at'].isoformat()
    await db.remote_sessions.insert_one(doc)
    
    return session

@api_router.get("/remote/sessions")
async def get_remote_sessions(
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if device_id:
        query["device_id"] = device_id
    if status:
        query["status"] = status
    
    sessions = await db.remote_sessions.find(query, {"_id": 0}).sort("started_at", -1).to_list(100)
    return sessions

@api_router.put("/remote/sessions/{session_id}/end")
async def end_remote_session(session_id: str, notes: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    session = await db.remote_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    started_at = datetime.fromisoformat(session['started_at']) if isinstance(session['started_at'], str) else session['started_at']
    duration = int((datetime.now(timezone.utc) - started_at).total_seconds() / 60)
    
    await db.remote_sessions.update_one(
        {"id": session_id},
        {"$set": {
            "status": "ended",
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "duration_minutes": duration,
            "notes": notes
        }}
    )
    return {"message": "Session ended", "duration_minutes": duration}

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
        hourly_rate=125.0
    )
    demo_doc = demo_user.model_dump()
    demo_doc['password_hash'] = hash_password("admin123")
    demo_doc['created_at'] = demo_doc['created_at'].isoformat()
    await db.users.insert_one(demo_doc)
    
    users_data = [
        {"id": "user-002", "email": "sarah@nexusops.io", "name": "Sarah Chen", "role": "technician", "hourly_rate": 85.0},
        {"id": "user-003", "email": "mike@nexusops.io", "name": "Mike Rodriguez", "role": "technician", "hourly_rate": 75.0},
    ]
    for u in users_data:
        user = User(**u, avatar=f"https://api.dicebear.com/7.x/initials/svg?seed={u['name']}")
        doc = user.model_dump()
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
        {"id": "dev-001", "name": "ACME-DC-01", "client_id": "client-001", "client_name": "Acme Corporation", "device_type": "server", "os": "Windows Server 2022", "ip_address": "192.168.1.10", "status": "online", "cpu_usage": 45, "memory_usage": 62, "disk_usage": 78},
        {"id": "dev-002", "name": "ACME-WS-001", "client_id": "client-001", "client_name": "Acme Corporation", "device_type": "workstation", "os": "Windows 11", "ip_address": "192.168.1.101", "status": "online", "cpu_usage": 23, "memory_usage": 41, "disk_usage": 55},
        {"id": "dev-003", "name": "TECH-SRV-01", "client_id": "client-002", "client_name": "TechStart Inc", "device_type": "server", "os": "Ubuntu 22.04", "ip_address": "10.0.0.5", "status": "warning", "cpu_usage": 89, "memory_usage": 78, "disk_usage": 45},
        {"id": "dev-004", "name": "GF-DC-MAIN", "client_id": "client-003", "client_name": "Global Finance Ltd", "device_type": "server", "os": "Windows Server 2022", "ip_address": "172.16.0.10", "status": "online", "cpu_usage": 34, "memory_usage": 56, "disk_usage": 67},
        {"id": "dev-005", "name": "HC-WS-REC01", "client_id": "client-004", "client_name": "HealthCare Plus", "device_type": "workstation", "os": "Windows 10", "ip_address": "192.168.5.20", "status": "offline", "cpu_usage": 0, "memory_usage": 0, "disk_usage": 82},
        {"id": "dev-006", "name": "RETAIL-POS-01", "client_id": "client-005", "client_name": "RetailMax", "device_type": "workstation", "os": "Windows 11", "ip_address": "192.168.10.50", "status": "online", "cpu_usage": 15, "memory_usage": 28, "disk_usage": 34},
    ]
    for d in devices_data:
        device = Device(**d)
        doc = device.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        doc['last_seen'] = doc['last_seen'].isoformat()
        await db.devices.insert_one(doc)
    
    tickets_data = [
        {"id": "TKT-001", "title": "Server unresponsive", "description": "Main DC server not responding to ping", "client_id": "client-001", "client_name": "Acme Corporation", "priority": "critical", "status": "open", "category": "infrastructure", "assigned_to": "user-002", "assigned_name": "Sarah Chen"},
        {"id": "TKT-002", "title": "Email sync issues", "description": "Outlook not syncing emails for multiple users", "client_id": "client-002", "client_name": "TechStart Inc", "priority": "high", "status": "in_progress", "category": "support", "assigned_to": "user-003", "assigned_name": "Mike Rodriguez"},
        {"id": "TKT-003", "title": "New user setup", "description": "Setup workstation and accounts for new employee", "client_id": "client-003", "client_name": "Global Finance Ltd", "priority": "medium", "status": "open", "category": "onboarding", "assigned_to": "user-002", "assigned_name": "Sarah Chen"},
        {"id": "TKT-004", "title": "Printer not working", "description": "Network printer in reception area offline", "client_id": "client-004", "client_name": "HealthCare Plus", "priority": "low", "status": "resolved", "category": "hardware"},
        {"id": "TKT-005", "title": "VPN connection drops", "description": "Remote workers experiencing VPN disconnections", "client_id": "client-001", "client_name": "Acme Corporation", "priority": "high", "status": "in_progress", "category": "network", "assigned_to": "user-001", "assigned_name": "Alex Thompson"},
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
    
    return {"message": "Demo data seeded successfully"}

@api_router.get("/")
async def root():
    return {"message": "NexusOps API v2.0.0", "status": "operational"}

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
