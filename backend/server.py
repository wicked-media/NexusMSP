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
