from fastapi import HTTPException
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import httpx
from app.database import db, PAX8_API_URL, PAX8_AUTH_URL

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
        # First check env vars, then DB settings
        import os
        api_url = os.environ.get("ACRONIS_API_URL", "")
        client_id = os.environ.get("ACRONIS_CLIENT_ID", "")
        client_secret = os.environ.get("ACRONIS_CLIENT_SECRET", "")
        if api_url and client_id and client_secret:
            return api_url.rstrip("/"), client_id, client_secret
        settings = await db.settings.find_one({"type": "acronis"}, {"_id": 0})
        if not settings:
            settings = await db.settings.find_one({"key": "acronis_config"}, {"_id": 0})
            if settings:
                settings = settings.get("value", settings)
        if not settings:
            return None, None, None
        return (settings.get('api_url', '').rstrip("/"), settings.get('client_id', ''),
                settings.get('client_secret', ''))

    async def authenticate(self):
        api_url, client_id, client_secret = await self.get_credentials()
        if not all([api_url, client_id, client_secret]):
            raise HTTPException(status_code=400, detail="Acronis credentials not configured")

        import base64
        credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            response = await http_client.post(
                f"{api_url}/api/2/idp/token",
                headers={"Authorization": f"Basic {credentials}", "Content-Type": "application/x-www-form-urlencoded"},
                data={"grant_type": "client_credentials"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=401, detail=f"Acronis authentication failed: {response.status_code}")

            data = response.json()
            self.access_token = data['access_token']
            self.token_expiry = datetime.now(timezone.utc) + timedelta(seconds=data.get('expires_in', 7200))
            return self.access_token

    async def get_token(self):
        if not self.access_token or (self.token_expiry and datetime.now(timezone.utc) >= self.token_expiry):
            await self.authenticate()
        return self.access_token

    async def _get(self, path):
        """Helper for authenticated GET requests."""
        token = await self.get_token()
        api_url, _, _ = await self.get_credentials()
        async with httpx.AsyncClient(timeout=20.0) as http_client:
            resp = await http_client.get(f"{api_url}{path}", headers={"Authorization": f"Bearer {token}"})
            if resp.status_code == 401:
                # Token expired, re-auth
                self.access_token = None
                token = await self.get_token()
                resp = await http_client.get(f"{api_url}{path}", headers={"Authorization": f"Bearer {token}"})
            return resp

    async def get_tenants(self):
        # First get root tenant from JWT scope
        token = await self.get_token()
        import base64, json as jn
        parts = token.split('.')
        padding = '=' * (4 - len(parts[1]) % 4)
        payload = jn.loads(base64.urlsafe_b64decode(parts[1] + padding))
        scopes = payload.get("scope", [])
        root_tid = ""
        for s in scopes:
            if isinstance(s, dict) and s.get("tid"):
                root_tid = s["tid"]
                break

        if not root_tid:
            return {"items": []}

        # Get children of root tenant (these are the customer tenants)
        api_url, _, _ = await self.get_credentials()
        async with httpx.AsyncClient(timeout=20.0) as http_client:
            resp = await http_client.get(
                f"{api_url}/api/2/tenants?parent_id={root_tid}",
                headers={"Authorization": f"Bearer {token}"}
            )
            if resp.status_code != 200:
                return {"items": []}
            data = resp.json()
            # Also store root tenant ID for later use
            data["root_tenant_id"] = root_tid
            return data

    async def get_tenant_children(self, tenant_id):
        resp = await self._get(f"/api/2/tenants/{tenant_id}/children")
        if resp.status_code != 200:
            return {"items": []}
        return resp.json()

    async def get_clients(self, tenant_id: str = None):
        token = await self.get_token()
        api_url, _, _ = await self.get_credentials()

        url = f"{api_url}/api/2/clients"
        if tenant_id:
            url += f"?tenant_id={tenant_id}"

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            response = await http_client.get(url, headers={"Authorization": f"Bearer {token}"})
            if response.status_code != 200:
                return {"items": []}
            return response.json()

    async def get_resources(self, tenant_id: str = None):
        """Get protected resources/agents for a tenant."""
        path = "/api/resource_management/v4/resources?limit=500"
        if tenant_id:
            path += f"&context_tenant_id={tenant_id}"
        resp = await self._get(path)
        if resp.status_code != 200:
            return {"items": []}
        return resp.json()

    async def get_resource_statuses(self, tenant_id: str = None):
        """Get backup/protection statuses for resources."""
        path = "/api/resource_management/v4/resource_statuses?limit=500"
        if tenant_id:
            path += f"&context_tenant_id={tenant_id}"
        resp = await self._get(path)
        if resp.status_code != 200:
            return {"items": []}
        return resp.json()

    async def get_alerts(self, tenant_id: str = None):
        """Get active alerts."""
        path = "/api/alert_manager/v1/alerts?limit=200"
        if tenant_id:
            path += f"&tenant_id={tenant_id}"
        resp = await self._get(path)
        if resp.status_code != 200:
            return {"items": []}
        return resp.json()

    async def get_tenant_usage(self, tenant_id: str):
        """Get usage/quota for a tenant."""
        resp = await self._get(f"/api/2/tenants/{tenant_id}/usages")
        if resp.status_code != 200:
            return {"items": []}
        return resp.json()

    async def get_backup_status(self, resource_id: str):
        token = await self.get_token()
        api_url, _, _ = await self.get_credentials()

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            response = await http_client.get(
                f"{api_url}/api/resource_management/v4/resources/{resource_id}/status",
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.status_code != 200:
                return {"status": "unknown"}
            return response.json()

acronis_service = AcronisService()
