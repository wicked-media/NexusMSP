import ipaddress
import os
import re
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from urllib.parse import urlsplit, urlunsplit
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.scope_permissions import (
    assert_client_scope,
    assert_global_scope,
    assert_record_scope,
    scoped_query,
)
from app.services.secret_store import decrypt_secret, encrypt_secret
from app.services.module_permissions import require_module_permission
from app.services.runtime_config import is_production
from app.models import *

import httpx

router = APIRouter()

NETWORK_SECRET_FIELDS = {
    "username",
    "password",
    "api_key",
    "username_encrypted",
    "password_encrypted",
    "api_key_encrypted",
}
_AMBIGUOUS_NUMERIC_HOST_RE = re.compile(
    r"^(?:0[xX][0-9A-Fa-f]+|[0-9]+)(?:\.(?:0[xX][0-9A-Fa-f]+|[0-9]+)){0,3}$"
)
_UNIFI_SITE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _public_controller_url(value: object) -> str:
    """Avoid reflecting credentials or opaque query data from legacy URLs."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return ""
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return ""
    return raw


def _public_site(site: dict) -> dict:
    """Return a site record without controller credentials or tokens."""
    public = dict(site)
    public.pop("_id", None)
    for field in NETWORK_SECRET_FIELDS:
        public.pop(field, None)
    public["controller_url"] = _public_controller_url(public.get("controller_url"))
    return public


def _public_wlan(wlan: dict) -> dict:
    """Return a WLAN record without its pre-shared key material."""
    public = dict(wlan)
    public.pop("_id", None)
    public.pop("password", None)
    public.pop("password_encrypted", None)
    return public


def _normalise_unifi_controller_url(value: object) -> str:
    """Validate the controller origin before Nexus makes an outbound request.

    Private RFC1918 controller addresses are a normal managed-site deployment
    model, but production requires an explicit ``NEXUS_UNIFI_ALLOWED_HOSTS``
    entry for them (and for hostname targets). The resolver rejects loopback,
    link-local, multicast, unspecified and parser-ambiguous targets. Private
    controller reachability should ultimately be brokered by Nexus Edge rather
    than exposed directly to the public Nexus API.
    """
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) > 512 or any(character.isspace() for character in raw):
        raise HTTPException(status_code=422, detail="UniFi controller URL must be a single HTTP or HTTPS origin")

    candidate = raw if "://" in raw else f"https://{raw}"
    parsed = urlsplit(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=422, detail="UniFi controller URL must use HTTP or HTTPS and include a host")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise HTTPException(
            status_code=422,
            detail="UniFi controller URL must be an origin without credentials, path, query, or fragment",
        )
    try:
        port = parsed.port
        hostname = parsed.hostname.encode("idna").decode("ascii").lower().rstrip(".")
    except (UnicodeError, ValueError):
        raise HTTPException(status_code=422, detail="UniFi controller URL has an invalid host or port") from None
    if not hostname:
        raise HTTPException(status_code=422, detail="UniFi controller URL has an invalid host")
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".localhost"):
        raise HTTPException(status_code=422, detail="UniFi controller URL cannot target a loopback host")

    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        if _AMBIGUOUS_NUMERIC_HOST_RE.fullmatch(hostname):
            raise HTTPException(status_code=422, detail="UniFi controller URL cannot use an ambiguous numeric address") from None
        address = None
    policy_address = address
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        policy_address = address.ipv4_mapped
    if policy_address and (
        policy_address.is_loopback
        or policy_address.is_unspecified
        or policy_address.is_link_local
        or policy_address.is_multicast
    ):
        raise HTTPException(
            status_code=422,
            detail="UniFi controller URL cannot target a loopback, link-local, multicast, or unspecified address",
        )

    allowed_hosts = {
        item.strip().lower().strip("[]")
        for item in os.environ.get("NEXUS_UNIFI_ALLOWED_HOSTS", "").split(",")
        if item.strip()
    }
    # ``is_private`` excludes CGNAT (100.64.0.0/10) and other non-global
    # ranges.  Any non-global address can be an internal egress target, so it
    # requires the same production allowlist as RFC1918 space.
    requires_production_allowlist = address is None or bool(policy_address and not policy_address.is_global)
    if is_production() and requires_production_allowlist and not allowed_hosts:
        raise HTTPException(
            status_code=422,
            detail="NEXUS_UNIFI_ALLOWED_HOSTS is required for hostname or private-IP UniFi controllers in production",
        )
    if allowed_hosts and hostname not in allowed_hosts:
        raise HTTPException(status_code=422, detail="UniFi controller host is not in the configured provider allowlist")

    host = f"[{hostname}]" if ":" in hostname else hostname
    netloc = f"{host}:{port}" if port else host
    return urlunsplit((parsed.scheme, netloc, "", "", ""))


def _normalise_unifi_site_id(value: object) -> str:
    site_id = str(value or "default").strip() or "default"
    if not _UNIFI_SITE_ID_RE.fullmatch(site_id):
        raise HTTPException(status_code=422, detail="UniFi site ID contains unsupported characters")
    return site_id


def _encrypted_network_secrets(data: dict) -> dict:
    """Build encrypted replacement fields for supplied, non-empty credentials."""
    update: dict = {}
    for field in ("username", "password", "api_key"):
        if field not in data:
            continue
        value = str(data.get(field) or "").strip()
        if value:
            update[f"{field}_encrypted"] = encrypt_secret(value)
    return update


def _legacy_network_secret_unset(data: dict) -> dict:
    """Remove plaintext siblings only after a non-empty encrypted replacement exists."""
    return {
        field: ""
        for field in ("username", "password", "api_key")
        if str(data.get(field) or "").strip()
    }


async def _migrate_legacy_network_site_secrets(site: dict) -> None:
    """Lazily migrate a scoped legacy controller record off plaintext fields."""
    update: dict = {}
    unset: dict = {}
    for field in ("username", "password", "api_key"):
        encrypted_field = f"{field}_encrypted"
        legacy = str(site.get(field) or "").strip()
        if legacy and not site.get(encrypted_field):
            update[encrypted_field] = encrypt_secret(legacy)
            unset[field] = ""
            site[encrypted_field] = update[encrypted_field]
            site.pop(field, None)
    if update:
        await db.network_sites.update_one(
            {"id": site["id"]},
            {"$set": update, "$unset": unset},
        )


async def _read_network_site_secret(site: dict, field: str) -> str:
    await _migrate_legacy_network_site_secrets(site)
    return decrypt_secret(site.get(f"{field}_encrypted"))


async def _migrate_legacy_unifi_settings(settings_doc: dict) -> None:
    """Apply the same lazy at-rest encryption migration to global UniFi settings."""
    update: dict = {}
    unset: dict = {}
    for field in ("username", "password", "api_key"):
        encrypted_field = f"{field}_encrypted"
        legacy = str(settings_doc.get(field) or "").strip()
        if legacy and not settings_doc.get(encrypted_field):
            update[encrypted_field] = encrypt_secret(legacy)
            unset[field] = ""
            settings_doc[encrypted_field] = update[encrypted_field]
            settings_doc.pop(field, None)
    if update:
        await db.settings.update_one(
            {"type": "unifi"},
            {"$set": update, "$unset": unset},
        )


async def _scoped_network_site(site_id: str, current_user: dict, *, operation: str) -> dict:
    """Load a network-site record using its Nexus ID, not UniFi's site alias."""
    site = await assert_record_scope(
        current_user,
        db.network_sites,
        site_id,
        site_field="id",
        operation=operation,
        resource_name="Network site",
    )
    await _migrate_legacy_network_site_secrets(site)
    return site


async def _scoped_network_child(collection, record_id: str, current_user: dict, *, operation: str, resource_name: str) -> dict:
    record = await collection.find_one({"id": str(record_id)}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail=f"{resource_name} not found")
    await _scoped_network_site(str(record.get("site_id") or ""), current_user, operation=operation)
    return record


async def _network_sites_in_scope(current_user: dict) -> list[dict]:
    return await db.network_sites.find(
        scoped_query(current_user, field="client_id", site_field="id"),
        {"_id": 0},
    ).to_list(1000)


# ============== NETWORKING / UNIFI ENDPOINTS ==============

# -------- UNIFI LIVE SYNC --------

async def _unifi_login(site):
    """Attempt to login to a real UniFi controller and return session"""
    url = _normalise_unifi_controller_url(site.get("controller_url"))
    username = await _read_network_site_secret(site, "username")
    password = await _read_network_site_secret(site, "password")
    if not url or not username or not password:
        return None, None
    try:
        client = httpx.AsyncClient(
            verify=site.get("verify_ssl", True),
            timeout=15,
            follow_redirects=False,
        )
        resp = await client.post(f"{url}/api/login", json={"username": username, "password": password})
        if resp.status_code == 200:
            return client, url
        await client.aclose()
    except Exception:
        pass
    return None, None

async def _unifi_api(client, base_url, path, site_name="default"):
    """Make a request to the UniFi controller API"""
    try:
        resp = await client.get(f"{base_url}/api/s/{site_name}/{path}")
        if resp.status_code == 200:
            data = resp.json()
            return data.get("data", data)
    except Exception:
        pass
    return None

@router.post("/networking/sites/{site_id}/sync")
async def sync_site_from_controller(site_id: str, current_user: dict = Depends(get_current_user)):
    """Sync devices and clients from a real UniFi controller"""
    await require_module_permission(current_user, "networking", "edit")
    site = await _scoped_network_site(site_id, current_user, operation="network.site.sync")
    
    client, base_url = await _unifi_login(site)
    if not client:
        await db.network_sites.update_one({"id": site_id}, {"$set": {
            "status": "sync_failed",
            "last_sync_attempt": datetime.now(timezone.utc).isoformat(),
        }})
        return {"success": False, "message": "Cannot connect to controller. Check credentials.", "synced_devices": 0, "synced_clients": 0}
    
    site_name = _normalise_unifi_site_id(site.get("site_id"))
    synced_devices = 0
    synced_clients = 0
    
    try:
        # Sync devices
        devices_data = await _unifi_api(client, base_url, "stat/device", site_name)
        if devices_data:
            for dev in devices_data:
                mac = dev.get("mac", "")
                existing = await db.network_devices.find_one({"site_id": site_id, "mac": mac})
                device_doc = {
                    "site_id": site_id,
                    "client_id": site.get("client_id"),
                    "name": dev.get("name", dev.get("hostname", mac)),
                    "mac": mac,
                    "model": dev.get("model", ""),
                    "model_name": dev.get("model_in_lts", dev.get("model", "")),
                    "device_type": dev.get("type", "ap"),
                    "ip_address": dev.get("ip", ""),
                    "status": "online" if dev.get("state", 0) == 1 else "offline",
                    "firmware": dev.get("version", ""),
                    "uptime_seconds": dev.get("uptime", 0),
                    "cpu_usage": dev.get("system-stats", {}).get("cpu", 0) if isinstance(dev.get("system-stats"), dict) else 0,
                    "mem_usage": dev.get("system-stats", {}).get("mem", 0) if isinstance(dev.get("system-stats"), dict) else 0,
                    "satisfaction": dev.get("satisfaction", 0),
                    "num_sta": dev.get("num_sta", 0),
                    "tx_bytes": dev.get("tx_bytes", 0),
                    "rx_bytes": dev.get("rx_bytes", 0),
                    "port_table": dev.get("port_table", []),
                    "radio_table": dev.get("radio_table", []),
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                if existing:
                    await db.network_devices.update_one({"_id": existing["_id"]}, {"$set": device_doc})
                else:
                    device_doc["id"] = str(uuid.uuid4())
                    device_doc["created_at"] = datetime.now(timezone.utc).isoformat()
                    await db.network_devices.insert_one(device_doc)
                synced_devices += 1
        
        # Sync clients
        clients_data = await _unifi_api(client, base_url, "stat/sta", site_name)
        if clients_data:
            for cli in clients_data:
                mac = cli.get("mac", "")
                existing = await db.network_clients.find_one({"site_id": site_id, "mac": mac})
                client_doc = {
                    "site_id": site_id,
                    "client_id": site.get("client_id"),
                    "mac": mac,
                    "name": cli.get("name", cli.get("hostname", mac)),
                    "hostname": cli.get("hostname", cli.get("name", mac)),
                    "ip": cli.get("ip", ""),
                    "ip_address": cli.get("ip", ""),
                    "is_wireless": cli.get("is_wired", False) == False,
                    "is_connected": True,
                    "network": cli.get("essid", cli.get("network", "")),
                    "signal": cli.get("signal", 0),
                    "signal_strength": cli.get("signal", 0),
                    "rssi": cli.get("rssi", 0),
                    "tx_bytes": cli.get("tx_bytes", 0),
                    "rx_bytes": cli.get("rx_bytes", 0),
                    "tx_rate": cli.get("tx_rate", 0),
                    "rx_rate": cli.get("rx_rate", 0),
                    "uptime": cli.get("uptime", 0),
                    "channel": cli.get("channel", 0),
                    "radio": cli.get("radio", ""),
                    "satisfaction": cli.get("satisfaction", 0),
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                if existing:
                    await db.network_clients.update_one({"_id": existing["_id"]}, {"$set": client_doc})
                else:
                    client_doc["id"] = str(uuid.uuid4())
                    client_doc["created_at"] = datetime.now(timezone.utc).isoformat()
                    await db.network_clients.insert_one(client_doc)
                synced_clients += 1
        
        # Update site health with the controller's factual status when returned.
        health = None
        health_data = await _unifi_api(client, base_url, "stat/health", site_name)
        if health_data:
            health = {}
            for h in health_data:
                subsystem = h.get("subsystem", "")
                health[subsystem] = h.get("status", "unknown")
        site_update = {
            "status": "online",
            "last_sync": datetime.now(timezone.utc).isoformat(),
            "last_sync_attempt": datetime.now(timezone.utc).isoformat(),
        }
        if health is not None:
            site_update["health"] = health
        await db.network_sites.update_one({"id": site_id}, {"$set": site_update})
        
        await client.aclose()
        return {"success": True, "message": f"Synced {synced_devices} devices, {synced_clients} clients", "synced_devices": synced_devices, "synced_clients": synced_clients}
    except Exception as e:
        try: await client.aclose()
        except: pass
        await db.network_sites.update_one({"id": site_id}, {"$set": {
            "status": "sync_failed",
            "last_sync_attempt": datetime.now(timezone.utc).isoformat(),
            "last_sync_error": str(e)[:500],
        }})
        return {"success": False, "message": str(e)[:200], "synced_devices": synced_devices, "synced_clients": synced_clients}

# -------- WLAN MANAGEMENT --------

@router.get("/networking/sites/{site_id}/wlans")
async def get_site_wlans(site_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    await _scoped_network_site(site_id, current_user, operation="network.wlan.read")
    wlans = await db.network_wlans.find({"site_id": site_id}, {"_id": 0}).to_list(50)
    return [_public_wlan(wlan) for wlan in wlans]

@router.post("/networking/sites/{site_id}/wlans")
async def create_wlan(site_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "create")
    site = await _scoped_network_site(site_id, current_user, operation="network.wlan.create")
    wlan = {
        "id": str(uuid.uuid4()), "site_id": site_id,
        "client_id": site.get("client_id"),
        "name": data.get("name", ""), "ssid": data.get("ssid", data.get("name", "")),
        "enabled": data.get("enabled", True), "security": data.get("security", "WPA2-PSK"),
        "vlan_id": data.get("vlan_id", 0), "band": data.get("band", "Both"),
        "client_count": 0, "guest": data.get("guest", False),
        "password_encrypted": encrypt_secret(str(data.get("password") or "").strip()),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.network_wlans.insert_one(wlan)
    return _public_wlan(wlan)

@router.put("/networking/wlans/{wlan_id}")
async def update_wlan(wlan_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "edit")
    await _scoped_network_child(
        db.network_wlans,
        wlan_id,
        current_user,
        operation="network.wlan.update",
        resource_name="WLAN",
    )
    allowed = {"name", "ssid", "enabled", "security", "vlan_id", "band", "guest", "password"}
    update = {k: v for k, v in data.items() if k in allowed}
    password = str(update.pop("password", "") or "").strip()
    if password:
        update["password_encrypted"] = encrypt_secret(password)
    await db.network_wlans.update_one({"id": wlan_id}, {"$set": update})
    return {"message": "WLAN updated"}

@router.delete("/networking/wlans/{wlan_id}")
async def delete_wlan(wlan_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "delete")
    await _scoped_network_child(
        db.network_wlans,
        wlan_id,
        current_user,
        operation="network.wlan.delete",
        resource_name="WLAN",
    )
    await db.network_wlans.delete_one({"id": wlan_id})
    return {"message": "WLAN deleted"}

# -------- PORT PROFILES --------

@router.get("/networking/sites/{site_id}/port-profiles")
async def get_port_profiles(site_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    await _scoped_network_site(site_id, current_user, operation="network.port_profile.read")
    profiles = await db.network_port_profiles.find({"site_id": site_id}, {"_id": 0}).to_list(50)
    for p in profiles:
        p.pop("_id", None)
    return profiles

# -------- DPI / TRAFFIC ANALYTICS --------

@router.get("/networking/sites/{site_id}/dpi")
async def get_site_dpi(site_id: str, current_user: dict = Depends(get_current_user)):
    """Deep packet inspection / traffic analytics"""
    await require_module_permission(current_user, "networking", "view")
    await _scoped_network_site(site_id, current_user, operation="network.dpi.read")
    dpi = await db.network_dpi.find_one({"site_id": site_id}, {"_id": 0})
    if not dpi:
        return {
            "site_id": site_id,
            "categories": [],
            "top_clients": [],
            "source": "not_available",
            "updated_at": None,
        }
    return dpi

# -------- SEED UNIFI DEMO DATA --------

@router.post("/networking/seed-demo")
async def seed_unifi_demo(current_user: dict = Depends(get_current_user)):
    """Seed comprehensive demo data for UniFi networking"""
    raise HTTPException(status_code=410, detail="Demo network data is retired. Connect a controller or add an audited manual record instead.")
    existing_sites = await db.network_sites.count_documents({})
    if existing_sites > 0:
        return {"message": f"Demo data already exists ({existing_sites} sites)"}
    
    clients_list = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10)
    
    sites_data = [
        {"name": "Main Office", "location": "Level 3, 100 Collins St", "wan_ip": "203.45.67.89", "isp": "Telstra Business", "download": 500, "upload": 100},
        {"name": "Warehouse", "location": "12 Industrial Rd", "wan_ip": "203.45.67.90", "isp": "ABB", "download": 100, "upload": 40},
        {"name": "Branch Office - Sydney", "location": "55 Pitt St", "wan_ip": "110.23.45.67", "isp": "Optus Business", "download": 250, "upload": 50},
    ]
    
    device_templates = {
        "gateway": [
            {"name": "USG-Pro-4", "model": "UGW4", "firmware": "6.0.41", "cpu": 12, "mem": 45},
            {"name": "UDM-Pro", "model": "UDMPRO", "firmware": "3.2.7", "cpu": 8, "mem": 52},
            {"name": "USG-3P", "model": "UGW3", "firmware": "4.4.56", "cpu": 22, "mem": 61},
        ],
        "switch": [
            {"name": "USW-Pro-48-PoE", "model": "USPPOE48", "firmware": "6.6.65", "ports": 48, "poe_power": 600},
            {"name": "USW-Pro-24-PoE", "model": "USPPOE24", "firmware": "6.6.65", "ports": 24, "poe_power": 400},
            {"name": "USW-Lite-16-PoE", "model": "USLPOE16", "firmware": "6.6.65", "ports": 16, "poe_power": 45},
        ],
        "ap": [
            {"name": "U6-Pro", "model": "U6PRO", "firmware": "6.6.77", "band": "WiFi 6", "clients_max": 300},
            {"name": "U6-Enterprise", "model": "U6ENT", "firmware": "6.6.77", "band": "WiFi 6E", "clients_max": 500},
            {"name": "U6-Lite", "model": "U6LITE", "firmware": "6.6.77", "band": "WiFi 6", "clients_max": 200},
            {"name": "U6-LR", "model": "U6LR", "firmware": "6.6.77", "band": "WiFi 6", "clients_max": 350},
        ],
    }
    
    import random
    all_site_ids = []
    for idx, sd in enumerate(sites_data):
        site_id = str(uuid.uuid4())
        all_site_ids.append(site_id)
        client = clients_list[idx] if idx < len(clients_list) else {"id": "", "name": ""}
        site = {
            "id": site_id, "name": sd["name"], "client_id": client["id"], "client_name": client["name"],
            "controller_url": "", "site_id": "default", "status": "online",
            "location": sd["location"], "wan_ip": sd["wan_ip"], "isp": sd["isp"],
            "download_speed_mbps": sd["download"], "upload_speed_mbps": sd["upload"],
            "health": {"wan": "ok", "lan": "ok", "wlan": "ok"},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.network_sites.insert_one(site)
        
        # Add devices
        gw = device_templates["gateway"][idx]
        sw_templates = device_templates["switch"]
        ap_templates = device_templates["ap"]
        
        # Gateway
        await db.network_devices.insert_one({
            "id": str(uuid.uuid4()), "site_id": site_id,
            "name": gw["name"], "mac": f"f0:9f:c2:{random.randint(10,99):02x}:{random.randint(10,99):02x}:{random.randint(10,99):02x}",
            "model": gw["model"], "device_type": "gateway", "ip_address": "192.168.1.1",
            "status": "online", "firmware": gw["firmware"],
            "uptime_seconds": random.randint(100000, 5000000),
            "cpu_usage": gw["cpu"], "mem_usage": gw["mem"],
            "satisfaction": random.randint(85, 100), "num_sta": 0,
            "tx_bytes": random.randint(50_000_000_000, 500_000_000_000),
            "rx_bytes": random.randint(200_000_000_000, 2_000_000_000_000),
            "last_seen": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        
        # Switches
        num_switches = 2 if idx == 0 else 1
        for si in range(num_switches):
            sw = sw_templates[si % len(sw_templates)]
            await db.network_devices.insert_one({
                "id": str(uuid.uuid4()), "site_id": site_id,
                "name": f"{sw['name']}-{si+1}" if num_switches > 1 else sw["name"],
                "mac": f"f0:9f:c2:{random.randint(10,99):02x}:{random.randint(10,99):02x}:{random.randint(10,99):02x}",
                "model": sw["model"], "device_type": "switch", "ip_address": f"192.168.1.{10+si}",
                "status": "online", "firmware": sw["firmware"],
                "uptime_seconds": random.randint(100000, 5000000),
                "cpu_usage": random.randint(3, 20), "mem_usage": random.randint(20, 50),
                "satisfaction": random.randint(90, 100), "num_sta": 0,
                "ports": sw.get("ports", 24), "poe_power": sw.get("poe_power", 0),
                "last_seen": datetime.now(timezone.utc).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        
        # APs
        num_aps = 4 if idx == 0 else (2 if idx == 2 else 1)
        for ai in range(num_aps):
            ap = ap_templates[ai % len(ap_templates)]
            is_online = random.random() > 0.1
            await db.network_devices.insert_one({
                "id": str(uuid.uuid4()), "site_id": site_id,
                "name": f"{ap['name']}-{chr(65+ai)}", 
                "mac": f"f0:9f:c2:{random.randint(10,99):02x}:{random.randint(10,99):02x}:{random.randint(10,99):02x}",
                "model": ap["model"], "device_type": "ap", "ip_address": f"192.168.1.{20+ai}",
                "status": "online" if is_online else "offline", "firmware": ap["firmware"],
                "uptime_seconds": random.randint(10000, 5000000) if is_online else 0,
                "cpu_usage": random.randint(5, 30) if is_online else 0,
                "mem_usage": random.randint(20, 60) if is_online else 0,
                "satisfaction": random.randint(70, 100) if is_online else 0,
                "num_sta": random.randint(5, 35) if is_online else 0,
                "tx_bytes": random.randint(1_000_000_000, 50_000_000_000),
                "rx_bytes": random.randint(5_000_000_000, 100_000_000_000),
                "channel_2g": random.choice([1, 6, 11]),
                "channel_5g": random.choice([36, 40, 44, 48, 149, 153, 157]),
                "last_seen": datetime.now(timezone.utc).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        
        # Clients
        client_names = ["MacBook-Pro", "iPhone-14", "Surface-Laptop", "iPad-Air", "Dell-XPS", "Galaxy-S23", "Cisco-Phone", "Printer-HP", "IoT-Sensor", "Camera-Lobby", "ThinkPad-T14", "iMac-Reception"]
        num_clients = 12 if idx == 0 else (8 if idx == 2 else 5)
        for ci in range(num_clients):
            is_wireless = random.random() > 0.3
            await db.network_clients.insert_one({
                "id": str(uuid.uuid4()), "site_id": site_id,
                "mac": f"a0:b1:c2:{random.randint(10,99):02x}:{random.randint(10,99):02x}:{random.randint(10,99):02x}",
                "hostname": f"{client_names[ci % len(client_names)]}-{idx+1}",
                "ip": f"192.168.{10+idx}.{100+ci}",
                "is_wireless": is_wireless, "is_connected": random.random() > 0.15,
                "network": random.choice(["Corporate-5G", "Guest-WiFi", "IoT-Network"]) if is_wireless else "LAN",
                "signal": random.randint(-75, -30) if is_wireless else 0,
                "rssi": random.randint(-75, -30) if is_wireless else 0,
                "tx_bytes": random.randint(100_000_000, 10_000_000_000),
                "rx_bytes": random.randint(500_000_000, 50_000_000_000),
                "tx_rate": random.choice([72, 144, 300, 600, 867, 1200]) if is_wireless else 1000,
                "rx_rate": random.choice([72, 144, 300, 600, 867, 1200]) if is_wireless else 1000,
                "uptime": random.randint(1000, 500000),
                "channel": random.choice([1, 6, 11, 36, 149]) if is_wireless else 0,
                "radio": random.choice(["ng", "na", "ax"]) if is_wireless else "",
                "satisfaction": random.randint(60, 100),
                "last_seen": datetime.now(timezone.utc).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    
    return {"message": f"Seeded {len(sites_data)} sites with devices and clients", "sites": len(sites_data)}

@router.get("/networking/sites")
async def get_networking_sites(current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    sites = await db.network_sites.find(
        scoped_query(current_user, field="client_id", site_field="id"),
        {"_id": 0},
    ).to_list(100)
    return [_public_site(site) for site in sites]

@router.post("/networking/sites")
async def create_networking_site(data: dict, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "create")
    client_id = str(data.get("client_id") or "").strip()
    if client_id:
        client = await db.clients.find_one({"id": client_id}, {"_id": 0})
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        await assert_client_scope(
            current_user,
            client_id,
            operation="network.site.create",
            mask_not_found=True,
        )
        client_name = client.get("name", "")
    else:
        # An unlinked network record has no client boundary to prove.  Retain
        # the valid MSP-wide workflow, but only for explicitly global users.
        await assert_global_scope(current_user, operation="network.site.create_unlinked")
        client_id = None
        client_name = ""

    controller_url = _normalise_unifi_controller_url(data.get("controller_url"))
    site = {
        "id": str(uuid.uuid4()), "name": data.get("name", ""),
        "client_id": client_id, "client_name": client_name,
        "controller_url": controller_url, "site_id": _normalise_unifi_site_id(data.get("site_id")),
        "status": "pending_configuration" if not controller_url else "pending_sync", "location": data.get("location", ""),
        "wan_ip": data.get("wan_ip", ""), "isp": data.get("isp", ""),
        "download_speed_mbps": data.get("download_speed_mbps", 0),
        "upload_speed_mbps": data.get("upload_speed_mbps", 0),
        "verify_ssl": data.get("verify_ssl", True),
        "notes": data.get("notes", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    site.update(_encrypted_network_secrets(data))
    await db.network_sites.insert_one(site)
    return _public_site(site)

@router.get("/networking/sites/{site_id}")
async def get_networking_site(site_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    site = await _scoped_network_site(site_id, current_user, operation="network.site.read")
    return _public_site(site)

@router.put("/networking/sites/{site_id}")
async def update_networking_site(site_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "edit")
    await _scoped_network_site(site_id, current_user, operation="network.site.update")
    if "client_id" in data or "client_name" in data:
        raise HTTPException(
            status_code=422,
            detail="Network site client ownership can only change through an explicit transfer workflow",
        )
    allowed = {"name", "controller_url", "site_id", "location",
               "wan_ip", "isp", "download_speed_mbps", "upload_speed_mbps", "status",
               "api_key", "username", "password", "verify_ssl", "notes"}
    update = {k: v for k, v in data.items() if k in allowed}
    if "controller_url" in update:
        update["controller_url"] = _normalise_unifi_controller_url(update["controller_url"])
    if "site_id" in update:
        update["site_id"] = _normalise_unifi_site_id(update["site_id"])
    update.pop("username", None)
    update.pop("password", None)
    update.pop("api_key", None)
    update.update(_encrypted_network_secrets(data))
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    mutation = {"$set": update}
    legacy_unset = _legacy_network_secret_unset(data)
    if legacy_unset:
        mutation["$unset"] = legacy_unset
    result = await db.network_sites.update_one({"id": site_id}, mutation)
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Site not found")
    return {"message": "Site updated"}

@router.delete("/networking/sites/{site_id}")
async def delete_networking_site(site_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "delete")
    await _scoped_network_site(site_id, current_user, operation="network.site.delete")
    await db.network_sites.delete_one({"id": site_id})
    await db.network_devices.delete_many({"site_id": site_id})
    await db.network_clients.delete_many({"site_id": site_id})
    await db.network_wlans.delete_many({"site_id": site_id})
    await db.network_port_profiles.delete_many({"site_id": site_id})
    await db.network_dpi.delete_many({"site_id": site_id})
    await db.bandwidth_data.delete_many({"site_id": site_id})
    await db.bandwidth_alerts.delete_many({"site_id": site_id})
    return {"message": "Site and associated devices deleted"}

@router.post("/networking/sites/{site_id}/test-connection")
async def test_site_connection(site_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "edit")
    site = await _scoped_network_site(site_id, current_user, operation="network.site.test_connection")
    controller_url = _normalise_unifi_controller_url(site.get("controller_url"))
    if not controller_url:
        return {"success": False, "message": "No controller URL configured"}
    controller_site_id = _normalise_unifi_site_id(site.get("site_id"))
    try:
        async with httpx.AsyncClient(
            verify=site.get("verify_ssl", True),
            timeout=10,
            follow_redirects=False,
        ) as client:
            resp = await client.get(f"{controller_url}/api/s/{controller_site_id}/stat/health")
            if resp.status_code in (200, 401, 403):
                await db.network_sites.update_one({"id": site_id}, {"$set": {"last_connection_test": datetime.now(timezone.utc).isoformat(), "connection_status": "reachable"}})
                return {"success": True, "message": f"Controller reachable (HTTP {resp.status_code})"}
    except Exception as e:
        await db.network_sites.update_one({"id": site_id}, {"$set": {"last_connection_test": datetime.now(timezone.utc).isoformat(), "connection_status": "unreachable"}})
        return {"success": False, "message": f"Connection failed: {str(e)[:100]}"}
    return {"success": False, "message": "Unknown error"}

@router.post("/networking/sites/{site_id}/adopt-device")
async def adopt_network_device(site_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "create")
    site = await _scoped_network_site(site_id, current_user, operation="network.device.adopt")
    device = {
        "id": str(uuid.uuid4()), "site_id": site_id,
        "client_id": site.get("client_id"),
        "name": data.get("name", "New Device"), "mac": data.get("mac", ""),
        "model": data.get("model", "Unknown"), "device_type": data.get("device_type", "ap"),
        "ip_address": data.get("ip_address", ""), "status": "recorded", "source": "manual",
        "firmware": data.get("firmware", ""), "uptime_seconds": 0,
        "cpu_usage": 0, "mem_usage": 0, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.network_devices.insert_one(device)
    device.pop("_id", None)
    return device

@router.put("/networking/devices/{device_id}")
async def update_network_device(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "edit")
    await _scoped_network_child(
        db.network_devices,
        device_id,
        current_user,
        operation="network.device.update",
        resource_name="Network device",
    )
    allowed = {"name", "ip_address", "status", "firmware", "notes", "device_type", "model"}
    update = {k: v for k, v in data.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.network_devices.update_one({"id": device_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device updated"}

@router.delete("/networking/devices/{device_id}")
async def delete_network_device(device_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "delete")
    await _scoped_network_child(
        db.network_devices,
        device_id,
        current_user,
        operation="network.device.delete",
        resource_name="Network device",
    )
    await db.network_devices.delete_one({"id": device_id})
    return {"message": "Device removed"}

@router.get("/networking/sites/{site_id}/overview")
async def get_site_overview(site_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    site = await _scoped_network_site(site_id, current_user, operation="network.site.overview")
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
    health = site.get("health") or {
        "wan": "reachable" if site.get("connection_status") == "reachable" else "unknown",
        "lan": "healthy" if online_devices else "unknown",
        "wlan": "healthy" if any(device.get("device_type") == "ap" and device.get("status") == "online" for device in devices) else "unknown",
    }
    return {
        "site": _public_site(site), "total_devices": len(devices), "online_devices": len(online_devices),
        "access_points": len(aps), "switches": len(switches), "gateways": len(gateways),
        "total_clients": len(clients), "wireless_clients": len(wireless_clients), "wired_clients": len(wired_clients),
        "total_rx_bytes": total_rx, "total_tx_bytes": total_tx,
        "health": health,
    }

@router.get("/networking/sites/{site_id}/devices")
async def get_site_devices(site_id: str, device_type: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    await _scoped_network_site(site_id, current_user, operation="network.device.read")
    query = {"site_id": site_id}
    if device_type:
        query["device_type"] = device_type
    devices = await db.network_devices.find(query, {"_id": 0}).to_list(500)
    return devices

@router.get("/networking/sites/{site_id}/clients")
async def get_site_clients(site_id: str, connected_only: bool = False, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    await _scoped_network_site(site_id, current_user, operation="network.client.read")
    query = {"site_id": site_id}
    if connected_only:
        query["is_connected"] = True
    clients = await db.network_clients.find(query, {"_id": 0}).to_list(1000)
    return clients

@router.get("/networking/stats")
async def get_networking_stats(current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    sites = await _network_sites_in_scope(current_user)
    site_ids = [site["id"] for site in sites]
    devices = await db.network_devices.find({"site_id": {"$in": site_ids}}, {"_id": 0}).to_list(5000)
    clients = await db.network_clients.find({"site_id": {"$in": site_ids}}, {"_id": 0}).to_list(10000)
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

@router.put("/settings/unifi")
async def update_unifi_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "edit")
    await assert_global_scope(current_user, operation="network.unifi_settings.update")
    update = {
        "type": "unifi",
        "controller_url": _normalise_unifi_controller_url(data.get("controller_url")),
        "verify_ssl": data.get("verify_ssl", False),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    update.update(_encrypted_network_secrets(data))
    mutation = {"$set": update}
    legacy_unset = _legacy_network_secret_unset(data)
    if legacy_unset:
        mutation["$unset"] = legacy_unset
    await db.settings.update_one({"type": "unifi"}, mutation, upsert=True)
    return {"message": "UniFi settings updated"}

@router.get("/settings/unifi")
async def get_unifi_settings(current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    await assert_global_scope(current_user, operation="network.unifi_settings.read")
    settings_doc = await db.settings.find_one({"type": "unifi"}, {"_id": 0})
    if not settings_doc:
        return {"type": "unifi", "controller_url": "", "username": "", "verify_ssl": False}
    await _migrate_legacy_unifi_settings(settings_doc)
    for secret in NETWORK_SECRET_FIELDS:
        settings_doc.pop(secret, None)
    return settings_doc


@router.get("/networking/dashboard")
async def get_networking_dashboard(current_user: dict = Depends(get_current_user)):
    """Comprehensive networking dashboard with health, alerts, bandwidth"""
    await require_module_permission(current_user, "networking", "view")
    sites = await _network_sites_in_scope(current_user)
    site_ids = [site["id"] for site in sites]
    all_devices = await db.network_devices.find({"site_id": {"$in": site_ids}}, {"_id": 0}).to_list(5000)
    all_clients = await db.network_clients.find({"site_id": {"$in": site_ids}}, {"_id": 0}).to_list(10000)
    
    online_sites = [s for s in sites if s.get("status") == "online"]
    offline_sites = [s for s in sites if s.get("status") != "online"]
    
    # Device breakdown
    device_types = {}
    firmware_versions = {}
    offline_devices = []
    for d in all_devices:
        dt = d.get("device_type", "unknown")
        device_types[dt] = device_types.get(dt, 0) + 1
        fw = d.get("firmware") or d.get("firmware_version") or "unknown"
        firmware_versions[fw] = firmware_versions.get(fw, 0) + 1
        if d.get("status") != "online":
            offline_devices.append({"name": d.get("name"), "site_id": d.get("site_id"), "type": dt, "status": d.get("status"), "last_seen": d.get("last_seen")})
    
    # Bandwidth aggregation
    total_rx = sum(c.get("rx_bytes", 0) for c in all_clients)
    total_tx = sum(c.get("tx_bytes", 0) for c in all_clients)
    
    # Site bandwidth breakdown
    site_bandwidth = []
    for site in sites:
        site_clients = [c for c in all_clients if c.get("site_id") == site["id"]]
        site_devices = [d for d in all_devices if d.get("site_id") == site["id"]]
        rx = sum(c.get("rx_bytes", 0) for c in site_clients)
        tx = sum(c.get("tx_bytes", 0) for c in site_clients)
        site_bandwidth.append({
            "site_id": site["id"], "name": site.get("name"), "client_name": site.get("client_name"),
            "status": site.get("status"), "device_count": len(site_devices),
            "client_count": len(site_clients), "rx_bytes": rx, "tx_bytes": tx,
            "wan_ip": site.get("wan_ip"), "isp": site.get("isp"),
            "download_mbps": site.get("download_speed_mbps", 0), "upload_mbps": site.get("upload_speed_mbps", 0),
        })
    
    # Generate alerts
    alerts = []
    for d in offline_devices:
        alerts.append({"type": "device_offline", "severity": "warning", "message": f"{d['name']} is offline", "device_type": d['type']})
    for s in offline_sites:
        alerts.append({"type": "site_offline", "severity": "critical", "message": f"Site '{s.get('name')}' is offline"})
    
    return {
        "summary": {
            "total_sites": len(sites), "online_sites": len(online_sites), "offline_sites": len(offline_sites),
            "total_devices": len(all_devices), "online_devices": len([d for d in all_devices if d.get("status") == "online"]),
            "total_clients": len(all_clients),
            "total_rx_gb": round(total_rx / (1024**3), 2), "total_tx_gb": round(total_tx / (1024**3), 2),
        },
        "device_types": device_types,
        "firmware_versions": firmware_versions,
        "offline_devices": offline_devices,
        "site_bandwidth": site_bandwidth,
        "alerts": alerts,
    }

