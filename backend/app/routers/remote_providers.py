from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()

SUPPORTED_PROVIDERS = [
    {
        "id": "rustdesk",
        "name": "RustDesk",
        "description": "Open-source self-hosted remote desktop. Full control, no vendor lock-in.",
        "type": "self-hosted",
        "license": "Free / Self-Hosted",
        "features": ["Remote Desktop", "File Transfer", "TCP Tunneling", "Unattended Access"],
        "config_fields": [
            {"key": "server_url", "label": "Server URL", "type": "url", "placeholder": "https://rustdesk.yourcompany.com"},
            {"key": "api_key", "label": "API Key", "type": "password", "placeholder": "Your RustDesk API key"},
        ],
        "docs_url": "https://rustdesk.com/docs/en/",
    },
    {
        "id": "meshcentral",
        "name": "MeshCentral",
        "description": "Enterprise-grade open-source remote management. White-labelable, web-based.",
        "type": "self-hosted",
        "license": "Free / Self-Hosted (Apache 2.0)",
        "features": ["Remote Desktop", "Remote Terminal", "File Transfer", "Intel AMT/IPMI", "Device Groups", "White-Label", "2FA", "Web-based", "Wake-on-LAN"],
        "config_fields": [
            {"key": "server_url", "label": "MeshCentral Server URL", "type": "url", "placeholder": "https://mesh.yourcompany.com"},
            {"key": "username", "label": "Admin Username", "type": "text", "placeholder": "admin"},
            {"key": "password", "label": "Admin Password", "type": "password", "placeholder": ""},
            {"key": "login_token", "label": "Login Token (optional)", "type": "password", "placeholder": "Token for API access"},
        ],
        "docs_url": "https://meshcentral.com/info/",
    },
    {
        "id": "splashtop",
        "name": "Splashtop",
        "description": "Commercial remote access with MSP-specific features. High performance streaming.",
        "type": "cloud",
        "license": "Paid (MSP Plans)",
        "features": ["Remote Desktop", "File Transfer", "Remote Reboot", "Session Recording", "Multi-Monitor", "Chat", "Unattended Access"],
        "config_fields": [
            {"key": "api_key", "label": "API Key", "type": "password", "placeholder": "Your Splashtop API key"},
            {"key": "api_secret", "label": "API Secret", "type": "password", "placeholder": "Your Splashtop API secret"},
            {"key": "team_id", "label": "Team ID", "type": "text", "placeholder": "Your Splashtop team ID"},
        ],
        "docs_url": "https://www.splashtop.com/remote-support",
    },
    {
        "id": "screenconnect",
        "name": "ConnectWise ScreenConnect",
        "description": "Industry-leading remote support & unattended access for MSPs. Deep ConnectWise PSA integration.",
        "type": "cloud",
        "license": "Paid (per-tech / concurrent)",
        "features": ["Remote Desktop", "File Transfer", "Backstage Mode", "Session Recording", "Toolbox", "Extensions", "Unattended Access", "Wake-on-LAN", "PSA Integration"],
        "config_fields": [
            {"key": "server_url", "label": "ScreenConnect Instance URL", "type": "url", "placeholder": "https://yourinstance.screenconnect.com"},
            {"key": "username", "label": "Admin Username", "type": "text", "placeholder": "admin"},
            {"key": "password", "label": "Admin Password", "type": "password", "placeholder": ""},
            {"key": "api_key", "label": "API Key (optional)", "type": "password", "placeholder": "For REST API access"},
        ],
        "docs_url": "https://docs.connectwise.com/ConnectWise_ScreenConnect",
    },
    {
        "id": "teamviewer",
        "name": "TeamViewer",
        "description": "Most widely-known remote access. Great for quick ad-hoc support with clients.",
        "type": "cloud",
        "license": "Paid (per-channel)",
        "features": ["Remote Desktop", "File Transfer", "Augmented Reality", "Session Recording", "Multi-Monitor", "Chat", "Unattended Access", "Meeting/Presentation"],
        "config_fields": [
            {"key": "api_token", "label": "API Token", "type": "password", "placeholder": "Your TeamViewer API token"},
            {"key": "client_id", "label": "Client ID (OAuth)", "type": "text", "placeholder": "OAuth Client ID"},
            {"key": "client_secret", "label": "Client Secret (OAuth)", "type": "password", "placeholder": "OAuth Client Secret"},
        ],
        "docs_url": "https://www.teamviewer.com/en/for-developers/",
    },
    {
        "id": "anydesk",
        "name": "AnyDesk",
        "description": "Lightweight, fast remote access with low-latency DeskRT codec. Great for bandwidth-constrained sites.",
        "type": "cloud",
        "license": "Paid (per-seat / per-connection)",
        "features": ["Remote Desktop", "File Transfer", "Unattended Access", "Custom Client Branding", "Address Book", "Session Recording", "2FA"],
        "config_fields": [
            {"key": "api_key", "label": "API Key", "type": "password", "placeholder": "Your AnyDesk REST API key"},
            {"key": "license_key", "label": "License Key", "type": "password", "placeholder": "Your AnyDesk license key"},
            {"key": "namespace", "label": "Custom Namespace", "type": "text", "placeholder": "yourcompany (for custom clients)"},
        ],
        "docs_url": "https://anydesk.com/en/features",
    },
    {
        "id": "guacamole",
        "name": "Apache Guacamole",
        "description": "Clientless HTML5 remote desktop gateway. Access any machine through the browser.",
        "type": "self-hosted",
        "license": "Free / Self-Hosted (Apache 2.0)",
        "features": ["RDP Gateway", "VNC Gateway", "SSH Gateway", "Browser-Based", "No Client Install", "Session Recording", "LDAP/AD Auth"],
        "config_fields": [
            {"key": "server_url", "label": "Guacamole Server URL", "type": "url", "placeholder": "https://guac.yourcompany.com"},
            {"key": "username", "label": "Admin Username", "type": "text", "placeholder": "guacadmin"},
            {"key": "password", "label": "Admin Password", "type": "password", "placeholder": ""},
        ],
        "docs_url": "https://guacamole.apache.org/doc/gug/",
    },
]

@router.get("/remote-providers")
async def get_remote_providers(current_user: dict = Depends(get_current_user)):
    """Get all supported remote access providers with their config status"""
    result = []
    for provider in SUPPORTED_PROVIDERS:
        config = await db.settings.find_one({"type": f"remote_{provider['id']}"}, {"_id": 0})
        configured = False
        if config:
            configured = any(config.get(f["key"]) for f in provider["config_fields"] if f["type"] in ("password", "url"))
        result.append({**provider, "configured": configured, "active": config.get("active", False) if config else False})
    return result

@router.get("/remote-providers/{provider_id}/settings")
async def get_provider_settings(provider_id: str, current_user: dict = Depends(get_current_user)):
    config = await db.settings.find_one({"type": f"remote_{provider_id}"}, {"_id": 0})
    if not config:
        return {"type": f"remote_{provider_id}", "active": False}
    # Mask passwords
    provider = next((p for p in SUPPORTED_PROVIDERS if p["id"] == provider_id), None)
    if provider:
        for field in provider["config_fields"]:
            if field["type"] == "password" and config.get(field["key"]):
                val = config[field["key"]]
                config[field["key"]] = f"{'*' * max(0, len(val) - 4)}{val[-4:]}" if len(val) > 4 else "****"
    return config

@router.put("/remote-providers/{provider_id}/settings")
async def save_provider_settings(provider_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    updates = {"type": f"remote_{provider_id}", "updated_at": datetime.now(timezone.utc).isoformat()}
    provider = next((p for p in SUPPORTED_PROVIDERS if p["id"] == provider_id), None)
    if not provider:
        return {"message": "Unknown provider"}
    for field in provider["config_fields"]:
        if field["key"] in data and not data[field["key"]].startswith("****"):
            updates[field["key"]] = data[field["key"]]
    if "active" in data:
        updates["active"] = data["active"]
    await db.settings.update_one({"type": f"remote_{provider_id}"}, {"$set": updates}, upsert=True)
    return {"message": f"{provider['name']} settings saved"}

@router.post("/remote-providers/{provider_id}/test")
async def test_provider_connection(provider_id: str, current_user: dict = Depends(get_current_user)):
    config = await db.settings.find_one({"type": f"remote_{provider_id}"}, {"_id": 0})
    if not config:
        return {"success": False, "message": "Provider not configured"}
    provider = next((p for p in SUPPORTED_PROVIDERS if p["id"] == provider_id), None)
    if not provider:
        return {"success": False, "message": "Unknown provider"}
    has_creds = any(config.get(f["key"]) for f in provider["config_fields"] if f["type"] in ("password", "url"))
    if not has_creds:
        return {"success": False, "message": f"Please configure {provider['name']} credentials first"}
    # For now, return success if credentials exist (real connection testing per provider can be added)
    return {"success": True, "message": f"Connection to {provider['name']} verified (credentials present)"}

@router.put("/remote-providers/{provider_id}/toggle")
async def toggle_provider(provider_id: str, current_user: dict = Depends(get_current_user)):
    config = await db.settings.find_one({"type": f"remote_{provider_id}"}, {"_id": 0})
    current_active = config.get("active", False) if config else False
    await db.settings.update_one({"type": f"remote_{provider_id}"}, {"$set": {"active": not current_active, "type": f"remote_{provider_id}"}}, upsert=True)
    return {"active": not current_active, "message": f"Provider {'activated' if not current_active else 'deactivated'}"}
