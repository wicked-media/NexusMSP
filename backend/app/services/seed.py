from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import hash_password
from app.models import *
import random; random = random.SystemRandom()

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


async def seed_data():
    existing_clients = await db.clients.count_documents({})
    if existing_clients == 0:
        await _seed_core_data()
    
    # Always run Phase 11 enhancements
    await _seed_phase11_data()
    
    return {"message": "Demo data seeded successfully"}


async def _seed_core_data():
    
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
        {"id": "client-001", "name": "Acme Corporation", "email": "it@acme.com", "industry": "Manufacturing", "mrr": 2500, "device_count": 45, "ticket_count": 12, "address": "14 Industrial Ave, Auckland 1010"},
        {"id": "client-002", "name": "TechStart Inc", "email": "support@techstart.io", "industry": "Technology", "mrr": 1800, "device_count": 28, "ticket_count": 8, "address": "7 Queen St, Level 4, Auckland CBD 1010"},
        {"id": "client-003", "name": "Global Finance Ltd", "email": "helpdesk@globalfin.com", "industry": "Finance", "mrr": 4200, "device_count": 120, "ticket_count": 25, "address": "200 George St, Sydney NSW 2000"},
        {"id": "client-004", "name": "HealthCare Plus", "email": "it@hcplus.org", "industry": "Healthcare", "mrr": 3100, "device_count": 67, "ticket_count": 15, "address": "55 Grafton Rd, Grafton, Auckland 1023"},
        {"id": "client-005", "name": "RetailMax", "email": "tech@retailmax.com", "industry": "Retail", "mrr": 1500, "device_count": 34, "ticket_count": 6, "address": "12 Sylvia Park Rd, Mt Wellington, Auckland 1060"},
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


async def _seed_phase11_data():
    # Seed additional clients (10 more for 15 total)
    extra_clients = [
        {"id": "client-006", "name": "Summit Legal Group", "email": "it@summitlegal.com", "industry": "Legal", "mrr": 2800, "device_count": 35, "ticket_count": 9, "address": "88 Shortland St, Auckland CBD 1010"},
        {"id": "client-007", "name": "Pacific Schools District", "email": "tech@pacificschools.edu", "industry": "Education", "mrr": 3500, "device_count": 85, "ticket_count": 18, "address": "350 Great South Rd, Otahuhu, Auckland 1062"},
        {"id": "client-008", "name": "Metro Real Estate", "email": "support@metrore.com", "industry": "Real Estate", "mrr": 1200, "device_count": 18, "ticket_count": 4, "address": "22 Parnell Rd, Parnell, Auckland 1052"},
        {"id": "client-009", "name": "Cascade Manufacturing", "email": "helpdesk@cascade.com", "industry": "Manufacturing", "mrr": 3800, "device_count": 92, "ticket_count": 22, "address": "45 Neilson St, Onehunga, Auckland 1061"},
        {"id": "client-010", "name": "Bright Dental Partners", "email": "it@brightdental.com", "industry": "Healthcare", "mrr": 1600, "device_count": 24, "ticket_count": 7, "address": "5 Remuera Rd, Remuera, Auckland 1050"},
        {"id": "client-011", "name": "CloudNine SaaS", "email": "ops@cloudnine.io", "industry": "Technology", "mrr": 2200, "device_count": 32, "ticket_count": 11, "address": "Level 2, 15 Sale St, Auckland 1010"},
        {"id": "client-012", "name": "Harbor Logistics", "email": "it@harborlog.com", "industry": "Logistics", "mrr": 2900, "device_count": 55, "ticket_count": 14, "address": "Port of Auckland, Quay St, Auckland 1010"},
        {"id": "client-013", "name": "Pinnacle Accounting", "email": "support@pinnacle-acc.com", "industry": "Finance", "mrr": 1900, "device_count": 22, "ticket_count": 5, "address": "Level 8, 34 Customs St East, Auckland 1010"},
        {"id": "client-014", "name": "GreenVolt Energy", "email": "it@greenvolt.com", "industry": "Energy", "mrr": 4500, "device_count": 110, "ticket_count": 20, "address": "120 Beaumont St, Westhaven, Auckland 1010"},
        {"id": "client-015", "name": "Apex Hospitality", "email": "tech@apexhosp.com", "industry": "Hospitality", "mrr": 1400, "device_count": 28, "ticket_count": 8, "address": "8 Federal St, Auckland CBD 1010"},
    ]
    for c in extra_clients:
        existing = await db.clients.find_one({"id": c["id"]})
        if not existing:
            client = Client(**c)
            doc = client.model_dump()
            doc['created_at'] = doc['created_at'].isoformat()
            await db.clients.insert_one(doc)

    # Add warranty & purchase data to existing devices
    warranty_updates = {
        "dev-001": {"warranty_expiry": "2027-01-15", "purchase_date": "2024-01-15", "purchase_price": 8500},
        "dev-002": {"warranty_expiry": "2026-06-01", "purchase_date": "2023-06-01", "purchase_price": 1200},
        "dev-003": {"warranty_expiry": "2025-09-15", "purchase_date": "2022-09-15", "purchase_price": 12000},
        "dev-004": {"warranty_expiry": "2028-02-10", "purchase_date": "2025-02-10", "purchase_price": 15000},
        "dev-005": {"warranty_expiry": "2025-03-01", "purchase_date": "2022-03-01", "purchase_price": 850},
        "dev-006": {"warranty_expiry": "2027-08-20", "purchase_date": "2024-08-20", "purchase_price": 950},
        "dev-007": {"warranty_expiry": "2026-11-10", "purchase_date": "2023-11-10", "purchase_price": 1600},
        "dev-008": {"warranty_expiry": "2029-05-01", "purchase_date": "2024-05-01", "purchase_price": 2200},
        "dev-009": {"warranty_expiry": "2027-07-01", "purchase_date": "2024-07-01", "purchase_price": 3800},
        "dev-010": {"warranty_expiry": "2026-02-10", "purchase_date": "2024-02-10", "purchase_price": 9500},
    }
    for dev_id, updates in warranty_updates.items():
        await db.devices.update_one({"id": dev_id}, {"$set": updates})

    # Add 5 more devices for extra clients
    extra_devices = [
        {"id": "dev-011", "name": "SUMMIT-DC-01", "client_id": "client-006", "client_name": "Summit Legal Group", "device_type": "server", "os": "Windows Server 2022", "os_version": "21H2", "ip_address": "192.168.20.10", "mac_address": "00:1A:2B:3C:5D:01", "serial_number": "DELL-PE-R650-001", "manufacturer": "Dell", "model": "PowerEdge R650", "processor": "Intel Xeon Silver 4314", "processor_cores": 16, "ram_gb": 64, "storage_total_gb": 1800, "storage_used_gb": 720, "domain": "summitlegal.local", "location": "Server Closet", "antivirus": "SentinelOne", "antivirus_status": "active", "firewall_enabled": True, "edr_status": "active", "encryption_status": "BitLocker - Encrypted", "compliance_score": 90, "patch_status": "current", "status": "online", "cpu_usage": 38, "memory_usage": 55, "disk_usage": 40, "warranty_expiry": "2027-03-15", "purchase_date": "2024-03-15", "purchase_price": 9800, "tags": ["production", "domain-controller"]},
        {"id": "dev-012", "name": "PACIFIC-SRV-01", "client_id": "client-007", "client_name": "Pacific Schools District", "device_type": "server", "os": "Ubuntu 22.04", "os_version": "22.04 LTS", "ip_address": "10.10.0.5", "mac_address": "00:1A:2B:3C:5D:02", "serial_number": "HPE-DL380-005", "manufacturer": "HPE", "model": "ProLiant DL380 Gen10", "processor": "Intel Xeon Gold 5218R", "processor_cores": 20, "ram_gb": 128, "storage_total_gb": 4000, "storage_used_gb": 2400, "domain": "pacificschools.local", "location": "Data Center - Building A", "antivirus": "CrowdStrike Falcon", "antivirus_status": "active", "firewall_enabled": True, "compliance_score": 78, "patch_status": "needs_attention", "pending_patches": 6, "status": "warning", "cpu_usage": 72, "memory_usage": 81, "disk_usage": 60, "warranty_expiry": "2025-06-01", "purchase_date": "2022-06-01", "purchase_price": 14500, "tags": ["production", "student-data", "critical"]},
        {"id": "dev-013", "name": "CASCADE-WS-01", "client_id": "client-009", "client_name": "Cascade Manufacturing", "device_type": "workstation", "os": "Windows 11", "os_version": "23H2", "ip_address": "192.168.30.101", "mac_address": "00:1A:2B:3C:5D:03", "serial_number": "DELL-OPT-5090-001", "manufacturer": "Dell", "model": "OptiPlex 5090", "processor": "Intel Core i5-11500", "processor_cores": 6, "ram_gb": 16, "storage_total_gb": 256, "storage_used_gb": 180, "domain": "cascade.local", "location": "Factory Floor Office", "antivirus": "SentinelOne", "antivirus_status": "active", "firewall_enabled": True, "compliance_score": 85, "status": "online", "cpu_usage": 25, "memory_usage": 48, "disk_usage": 70, "warranty_expiry": "2024-12-01", "purchase_date": "2021-12-01", "purchase_price": 1100, "tags": ["production", "manufacturing"]},
        {"id": "dev-014", "name": "GREENVOLT-FW-01", "client_id": "client-014", "client_name": "GreenVolt Energy", "device_type": "network", "os": "FortiOS", "os_version": "7.4.1", "ip_address": "10.50.0.1", "mac_address": "00:1A:2B:3C:5D:04", "serial_number": "FGT-100F-001", "manufacturer": "Fortinet", "model": "FortiGate 100F", "processor": "NP6 ASIC", "ram_gb": 8, "storage_total_gb": 256, "storage_used_gb": 28, "location": "HQ Network Rack", "firewall_enabled": True, "compliance_score": 100, "status": "online", "cpu_usage": 18, "memory_usage": 42, "disk_usage": 11, "warranty_expiry": "2028-01-01", "purchase_date": "2025-01-01", "purchase_price": 3800, "tags": ["infrastructure", "firewall", "critical"]},
        {"id": "dev-015", "name": "APEX-LT-001", "client_id": "client-015", "client_name": "Apex Hospitality", "device_type": "laptop", "os": "Windows 11", "os_version": "23H2", "ip_address": "192.168.40.51", "mac_address": "00:1A:2B:3C:5D:05", "serial_number": "LEN-X1C-G11-001", "manufacturer": "Lenovo", "model": "ThinkPad X1 Carbon Gen 11", "processor": "Intel Core i7-1365U", "processor_cores": 10, "ram_gb": 32, "storage_total_gb": 1000, "storage_used_gb": 350, "domain": "apexhosp.local", "location": "Front Desk", "assigned_user": "manager@apexhosp.com", "antivirus": "SentinelOne", "antivirus_status": "active", "firewall_enabled": True, "edr_status": "active", "encryption_status": "BitLocker - Encrypted", "compliance_score": 94, "status": "online", "cpu_usage": 20, "memory_usage": 55, "disk_usage": 35, "warranty_expiry": "2026-09-01", "purchase_date": "2023-09-01", "purchase_price": 2100, "tags": ["mobile", "management"]},
    ]
    for d in extra_devices:
        existing = await db.devices.find_one({"id": d["id"]})
        if not existing:
            device = Device(**d)
            doc = device.model_dump()
            doc['created_at'] = doc['created_at'].isoformat()
            doc['last_seen'] = doc['last_seen'].isoformat()
            if 'warranty_expiry' in d:
                doc['warranty_expiry'] = d['warranty_expiry']
            if 'purchase_date' in d:
                doc['purchase_date'] = d['purchase_date']
            if 'purchase_price' in d:
                doc['purchase_price'] = d['purchase_price']
            await db.devices.insert_one(doc)

    # Seed extra contracts for additional clients
    extra_contracts = [
        {"id": "contract-003", "client_id": "client-002", "client_name": "TechStart Inc", "name": "Cloud Managed Services", "contract_type": "managed_services", "billing_frequency": "monthly", "start_date": "2024-06-01", "value": 1800, "status": "active"},
        {"id": "contract-004", "client_id": "client-004", "client_name": "HealthCare Plus", "name": "HIPAA Compliance Package", "contract_type": "managed_services", "billing_frequency": "monthly", "start_date": "2024-02-01", "value": 3100, "status": "active"},
        {"id": "contract-005", "client_id": "client-005", "client_name": "RetailMax", "name": "POS Support Agreement", "contract_type": "managed_services", "billing_frequency": "monthly", "start_date": "2024-04-15", "value": 1500, "status": "active"},
        {"id": "contract-006", "client_id": "client-006", "client_name": "Summit Legal Group", "name": "Legal IT Services", "contract_type": "managed_services", "billing_frequency": "monthly", "start_date": "2024-05-01", "value": 2800, "status": "active"},
        {"id": "contract-007", "client_id": "client-007", "client_name": "Pacific Schools District", "name": "Education IT Package", "contract_type": "managed_services", "billing_frequency": "monthly", "start_date": "2024-01-15", "value": 3500, "status": "active"},
        {"id": "contract-008", "client_id": "client-009", "client_name": "Cascade Manufacturing", "name": "Industrial IT Support", "contract_type": "managed_services", "billing_frequency": "monthly", "start_date": "2024-03-01", "value": 3800, "status": "active"},
        {"id": "contract-009", "client_id": "client-014", "client_name": "GreenVolt Energy", "name": "Enterprise Managed Services", "contract_type": "managed_services", "billing_frequency": "monthly", "start_date": "2024-01-01", "value": 4500, "status": "active"},
    ]
    for c in extra_contracts:
        existing = await db.contracts.find_one({"id": c["id"]})
        if not existing:
            contract = Contract(**c)
            doc = contract.model_dump()
            doc['created_at'] = doc['created_at'].isoformat()
            await db.contracts.insert_one(doc)

    # Seed Phase 11 data: Skills Matrix
    skills_data = [
        {"user_id": "user-001", "name": "Alex Thompson", "skills": {"networking": 4, "server": 4, "cloud": 3, "security": 4, "email": 3, "hardware": 2, "software": 3, "voip": 2}, "certifications": ["CCNA", "Azure Solutions Architect", "ITIL v4"], "total_resolved": 142},
        {"user_id": "user-002", "name": "Sarah Chen", "skills": {"networking": 4, "server": 3, "cloud": 4, "security": 3, "email": 2, "hardware": 2, "software": 3, "voip": 1}, "certifications": ["AWS Solutions Architect", "Azure Administrator", "CCNP"], "total_resolved": 198},
        {"user_id": "user-003", "name": "Mike Rodriguez", "skills": {"networking": 2, "server": 4, "cloud": 2, "security": 4, "email": 3, "hardware": 3, "software": 4, "voip": 2}, "certifications": ["CompTIA Security+", "MCSE", "CySA+"], "total_resolved": 176},
        {"user_id": "user-004", "name": "Lisa Park", "skills": {"networking": 1, "server": 1, "cloud": 1, "security": 1, "email": 3, "hardware": 3, "software": 2, "voip": 1}, "certifications": ["CompTIA A+", "Apple ACMT"], "total_resolved": 89},
    ]
    for s in skills_data:
        existing = await db.skills.find_one({"user_id": s["user_id"]})
        if not existing:
            s["id"] = f"skill-{s['user_id']}"
            s["created_at"] = datetime.now(timezone.utc).isoformat()
            await db.skills.insert_one(s)

    # Seed Phase 11 data: Approval Requests (collection: approvals)
    approval_data = [
        {"id": "appr-001", "type": "purchase", "title": "New Dell servers for Cascade Manufacturing", "description": "3x PowerEdge R750 servers for factory floor upgrade", "amount": 45000, "requested_by": "Sarah Chen", "requested_by_id": "user-002", "status": "pending", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "appr-002", "type": "discount", "title": "15% discount for GreenVolt annual renewal", "description": "Client threatening to leave. Offering retention discount.", "amount": 8100, "requested_by": "Alex Thompson", "requested_by_id": "user-001", "status": "pending", "created_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()},
        {"id": "appr-003", "type": "device_change", "title": "Replace HealthCare Plus reception PC", "description": "HC-WS-REC01 failing patches, recommend replacement with new Dell OptiPlex", "amount": 1200, "requested_by": "Mike Rodriguez", "requested_by_id": "user-003", "status": "approved", "decided_by": "Alex Thompson", "decided_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), "created_at": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()},
        {"id": "appr-004", "type": "contract_change", "title": "Upgrade RetailMax to Premium tier", "description": "Adding 24/7 monitoring and security stack to RetailMax contract", "amount": 800, "requested_by": "James Wilson", "requested_by_id": "user-005", "status": "rejected", "decided_by": "Alex Thompson", "rejection_reason": "Budget not approved for Q1", "decided_at": (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat(), "created_at": (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()},
    ]
    for a in approval_data:
        existing = await db.approvals.find_one({"id": a["id"]})
        if not existing:
            await db.approvals.insert_one(a)

    # Seed Phase 11 data: IT Roadmap items (collection: it_roadmap)
    roadmap_data = [
        {"id": "road-001", "client_id": "client-001", "title": "Migrate to Azure AD", "description": "Move from on-prem Active Directory to Azure AD with hybrid join", "category": "migration", "priority": "high", "status": "in_progress", "target_date": "2026-06-30", "quarter": "Q2 2026", "estimated_cost": 15000, "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "road-002", "client_id": "client-001", "title": "Replace FortiGate 60F with 200F", "description": "Current firewall at capacity. Upgrade to FortiGate 200F for SDWAN", "category": "upgrade", "priority": "medium", "status": "planned", "target_date": "2026-09-01", "quarter": "Q3 2026", "estimated_cost": 8500, "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "road-003", "client_id": "client-003", "title": "Zero Trust Network Implementation", "description": "Implement zero trust architecture with microsegmentation for PCI compliance", "category": "security", "priority": "high", "status": "planned", "target_date": "2026-12-31", "quarter": "Q4 2026", "estimated_cost": 45000, "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "road-004", "client_id": "client-004", "title": "HIPAA Compliance Remediation", "description": "Address gaps identified in latest HIPAA audit: encryption, access controls, logging", "category": "security", "priority": "high", "status": "in_progress", "target_date": "2026-04-30", "quarter": "Q2 2026", "estimated_cost": 22000, "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "road-005", "client_id": "client-007", "title": "1:1 Chromebook Deployment", "description": "Deploy 500 Chromebooks to students with MDM and content filtering", "category": "new_service", "priority": "high", "status": "planned", "target_date": "2026-08-01", "quarter": "Q3 2026", "estimated_cost": 175000, "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "road-006", "client_id": "client-009", "title": "OT Network Segmentation", "description": "Separate factory floor OT network from corporate IT network", "category": "infrastructure", "priority": "high", "status": "planned", "target_date": "2026-07-15", "quarter": "Q3 2026", "estimated_cost": 35000, "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    for r in roadmap_data:
        existing = await db.it_roadmap.find_one({"id": r["id"]})
        if not existing:
            await db.it_roadmap.insert_one(r)

    # Seed Phase 11 data: CSAT Surveys (collection: csat_surveys)
    csat_data = []
    now = datetime.now(timezone.utc)
    tech_names = [("user-001", "Alex Thompson"), ("user-002", "Sarah Chen"), ("user-003", "Mike Rodriguez"), ("user-004", "Lisa Park")]
    client_names = [("client-001", "Acme Corporation"), ("client-002", "TechStart Inc"), ("client-003", "Global Finance Ltd"), ("client-004", "HealthCare Plus"), ("client-005", "RetailMax")]
    comments_good = ["Excellent service!", "Very quick response", "Resolved immediately", "Professional and thorough", "Great communication throughout"]
    comments_ok = ["Got the job done", "Took a while but resolved", "Had to follow up once"]
    comments_bad = ["Took too long", "Had to call multiple times", "Issue not fully resolved"]
    for i in range(30):
        score = random.choices([5, 4, 3, 2, 1], weights=[35, 30, 20, 10, 5])[0]
        tech = random.choice(tech_names)
        client = random.choice(client_names)
        comment = random.choice(comments_good) if score >= 4 else (random.choice(comments_ok) if score == 3 else random.choice(comments_bad))
        csat_data.append({
            "id": f"csat-{i+1:03d}",
            "client_id": client[0], "client_name": client[1],
            "tech_id": tech[0], "tech_name": tech[1],
            "ticket_id": f"TKT-{random.randint(1,16):03d}",
            "score": score, "comment": comment,
            "submitted_at": (now - timedelta(days=random.randint(0, 90))).isoformat(),
        })
    existing_csat = await db.csat_surveys.count_documents({})
    if existing_csat == 0:
        for c in csat_data:
            await db.csat_surveys.insert_one(c)

    # Seed Phase 11 data: Vendor Scores
    vendor_data = [
        {"id": "vendor-001", "vendor_name": "Dell Technologies", "category": "hardware", "total_pos": 24, "total_spend": 185000, "fulfilled": 23, "fulfillment_rate": 96, "avg_delivery_days": 5, "score": 92, "rating": "excellent", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "vendor-002", "vendor_name": "HPE", "category": "hardware", "total_pos": 12, "total_spend": 142000, "fulfilled": 11, "fulfillment_rate": 92, "avg_delivery_days": 8, "score": 78, "rating": "good", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "vendor-003", "vendor_name": "Ubiquiti", "category": "networking", "total_pos": 18, "total_spend": 28500, "fulfilled": 18, "fulfillment_rate": 100, "avg_delivery_days": 3, "score": 95, "rating": "excellent", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "vendor-004", "vendor_name": "SentinelOne", "category": "security", "total_pos": 8, "total_spend": 45000, "fulfilled": 8, "fulfillment_rate": 100, "avg_delivery_days": 1, "score": 98, "rating": "excellent", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "vendor-005", "vendor_name": "Lenovo", "category": "hardware", "total_pos": 15, "total_spend": 67000, "fulfilled": 13, "fulfillment_rate": 87, "avg_delivery_days": 12, "score": 65, "rating": "average", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "vendor-006", "vendor_name": "Fortinet", "category": "networking", "total_pos": 6, "total_spend": 52000, "fulfilled": 6, "fulfillment_rate": 100, "avg_delivery_days": 7, "score": 85, "rating": "good", "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    existing_vendors = await db.vendor_scores.count_documents({})
    if existing_vendors == 0:
        for v in vendor_data:
            await db.vendor_scores.insert_one(v)

    # Seed Phase 11 data: Compliance Reports (2 sample scans)
    compliance_data = [
        {"id": "comp-001", "client_id": "client-003", "client_name": "Global Finance Ltd", "framework": "cis", "framework_name": "CIS Controls v8", "score": 85, "passed": 15, "total": 18, "scanned_at": (datetime.now(timezone.utc) - timedelta(days=14)).isoformat(), "scanned_by": "Alex Thompson",
         "controls": [
             {"id": "CIS-1.1", "name": "Enterprise Asset Inventory", "description": "Establish an enterprise asset inventory", "status": "pass"},
             {"id": "CIS-2.1", "name": "Software Inventory", "description": "Establish a software inventory", "status": "pass"},
             {"id": "CIS-3.1", "name": "Data Protection", "description": "Establish data management process", "status": "fail"},
             {"id": "CIS-4.1", "name": "Secure Configuration", "description": "Establish secure configuration standards", "status": "pass"},
         ]},
        {"id": "comp-002", "client_id": "client-004", "client_name": "HealthCare Plus", "framework": "hipaa", "framework_name": "HIPAA Security Rule", "score": 62, "passed": 8, "total": 13, "scanned_at": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat(), "scanned_by": "Alex Thompson",
         "controls": [
             {"id": "HIPAA-164.312a", "name": "Access Control", "description": "Implement technical access controls", "status": "pass"},
             {"id": "HIPAA-164.312b", "name": "Audit Controls", "description": "Implement audit logging mechanisms", "status": "fail"},
             {"id": "HIPAA-164.312c", "name": "Integrity Controls", "description": "Protect ePHI from improper alteration", "status": "pass"},
             {"id": "HIPAA-164.312d", "name": "Transmission Security", "description": "Guard against unauthorized access during transmission", "status": "fail"},
             {"id": "HIPAA-164.312e", "name": "Person Authentication", "description": "Verify identity of persons accessing ePHI", "status": "pass"},
         ]},
    ]
    existing_comp = await db.compliance_reports.count_documents({})
    if existing_comp == 0:
        for c in compliance_data:
            await db.compliance_reports.insert_one(c)

    # Seed Postmortem for resolved ticket TKT-004
    pm_data = {
        "id": "pm-001",
        "ticket_id": "TKT-004",
        "title": "Network Printer Outage - HealthCare Plus Reception",
        "client_name": "HealthCare Plus",
        "severity": "low",
        "summary": "The reception area network printer went offline due to a DHCP lease expiration combined with a static IP conflict on the network.",
        "root_cause": "The printer's DHCP reservation expired when the DHCP server was rebooted. Another device had been manually assigned the same IP address, causing a conflict.",
        "impact": "Reception staff unable to print patient forms for approximately 3 hours. Staff used a backup printer on the second floor as a workaround.",
        "resolution": "Assigned a permanent static IP outside the DHCP range. Updated DHCP exclusion list. Documented the IP allocation in the network inventory.",
        "timeline": ["10:15 AM - Printer reported offline by reception staff", "10:30 AM - Ticket created and assigned", "11:00 AM - Remote diagnosis identified IP conflict", "11:30 AM - Static IP configured and printer back online", "1:15 PM - DHCP server configuration updated"],
        "prevention": ["Implement IP address management (IPAM) system", "Add monitoring alerts for printer offline status", "Document all static IP assignments in NexusOps"],
        "duration_estimate": "3 hours",
        "generated_by": "Alex Thompson",
        "generated_at": (datetime.now(timezone.utc) - timedelta(days=5)).isoformat(),
    }
    existing_pm = await db.postmortems.find_one({"id": "pm-001"})
    if not existing_pm:
        await db.postmortems.insert_one(pm_data)
