from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid, os, base64
from cryptography.fernet import Fernet
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# Encryption key - in production this should be in env vars
VAULT_KEY = os.environ.get("VAULT_ENCRYPTION_KEY", Fernet.generate_key().decode())
cipher = Fernet(VAULT_KEY.encode() if isinstance(VAULT_KEY, str) else VAULT_KEY)


def encrypt_value(plaintext: str) -> str:
    return cipher.encrypt(plaintext.encode()).decode()

def decrypt_value(ciphertext: str) -> str:
    try:
        return cipher.decrypt(ciphertext.encode()).decode()
    except Exception:
        return "*** decryption failed ***"


@router.get("/vault/entries")
async def get_vault_entries(current_user: dict = Depends(get_current_user)):
    """Get all vault entries (passwords masked)."""
    entries = await db.vault.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    for e in entries:
        e["password"] = "********"
        e.pop("encrypted_password", None)
    return entries


@router.get("/vault/entries/{entry_id}")
async def get_vault_entry(entry_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single vault entry with decrypted password."""
    entry = await db.vault.find_one({"id": entry_id}, {"_id": 0})
    if not entry:
        return {"error": "Entry not found"}

    entry["password"] = decrypt_value(entry.get("encrypted_password", ""))
    entry.pop("encrypted_password", None)

    # Log access
    await db.vault_access_log.insert_one({
        "entry_id": entry_id, "entry_name": entry.get("name", ""),
        "accessed_by": current_user.get("name", ""),
        "accessed_at": datetime.now(timezone.utc).isoformat(),
        "action": "view",
    })

    return entry


@router.post("/vault/entries")
async def create_vault_entry(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a new vault entry."""
    entry_id = str(uuid.uuid4())[:8]
    doc = {
        "id": entry_id,
        "name": data.get("name", ""),
        "username": data.get("username", ""),
        "encrypted_password": encrypt_value(data.get("password", "")),
        "url": data.get("url", ""),
        "notes": data.get("notes", ""),
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "device_id": data.get("device_id", ""),
        "category": data.get("category", "general"),
        "tags": data.get("tags", []),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.vault.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("encrypted_password", None)
    doc["password"] = "********"
    return doc


@router.put("/vault/entries/{entry_id}")
async def update_vault_entry(entry_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update a vault entry."""
    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for key in ["name", "username", "url", "notes", "client_id", "client_name", "device_id", "category", "tags"]:
        if key in data:
            updates[key] = data[key]
    if "password" in data and data["password"] != "********":
        updates["encrypted_password"] = encrypt_value(data["password"])

    await db.vault.update_one({"id": entry_id}, {"$set": updates})

    await db.vault_access_log.insert_one({
        "entry_id": entry_id, "accessed_by": current_user.get("name", ""),
        "accessed_at": datetime.now(timezone.utc).isoformat(), "action": "update",
    })

    return {"message": "Updated"}


@router.delete("/vault/entries/{entry_id}")
async def delete_vault_entry(entry_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a vault entry."""
    await db.vault.delete_one({"id": entry_id})
    return {"message": "Deleted"}


@router.get("/vault/audit-log")
async def get_vault_audit_log(current_user: dict = Depends(get_current_user)):
    """Get vault access audit log."""
    logs = await db.vault_access_log.find({}, {"_id": 0}).sort("accessed_at", -1).to_list(200)
    return logs


@router.get("/vault/by-client/{client_id}")
async def get_vault_by_client(client_id: str, current_user: dict = Depends(get_current_user)):
    """Get vault entries for a specific client."""
    entries = await db.vault.find({"client_id": client_id}, {"_id": 0}).to_list(100)
    for e in entries:
        e["password"] = "********"
        e.pop("encrypted_password", None)
    return entries
