from fastapi import APIRouter, Depends, UploadFile, File
from datetime import datetime, timezone
import uuid, os, json, base64
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.post("/doc-scanner/scan")
async def scan_document(data: dict, current_user: dict = Depends(get_current_user)):
    """AI OCR scan - extract device/asset info from image data."""
    image_data = data.get("image", "")
    scan_type = data.get("type", "general")  # general, warranty, serial, label

    if not image_data:
        return {"error": "No image data provided"}

    # Use AI to analyze the image description / extracted text
    system = """You are an AI document scanner for an MSP IT management system.
Extract structured information from the provided text/description and return ONLY valid JSON:
{
  "device_type": "server|workstation|laptop|router|switch|printer|other",
  "hostname": "extracted hostname if found",
  "serial_number": "extracted serial number",
  "model": "device model",
  "manufacturer": "brand/manufacturer",
  "warranty_expiry": "YYYY-MM-DD if found",
  "asset_tag": "asset tag if found",
  "ip_address": "IP if found",
  "mac_address": "MAC if found",
  "notes": "any other relevant info",
  "confidence": 0.0-1.0
}
Fill null for fields not found."""

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            return {"error": "AI key not configured"}
        chat = LlmChat(api_key=api_key, session_id=f"scan-{uuid.uuid4().hex[:8]}", system_message=system)
        chat.with_model("anthropic", "claude-sonnet-4-5-20250929")

        prompt = f"Scan type: {scan_type}\nDocument/label content:\n{image_data[:2000]}"
        resp = await chat.send_message(UserMessage(text=prompt))
        text = resp.strip() if isinstance(resp, str) else str(resp)
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)

        # Store scan
        scan_id = str(uuid.uuid4())[:8]
        scan_doc = {
            "id": scan_id, "result": result, "scan_type": scan_type,
            "scanned_at": datetime.now(timezone.utc).isoformat(),
            "scanned_by": current_user.get("name", ""),
        }
        await db.doc_scans.insert_one(scan_doc)

        return {"id": scan_id, "result": result}
    except json.JSONDecodeError:
        return {"id": None, "result": {"notes": "Could not parse AI response", "confidence": 0.1}}
    except Exception as e:
        return {"error": str(e)[:200]}


@router.post("/doc-scanner/create-device")
async def create_device_from_scan(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a device from scan results."""
    scan_data = data.get("scan_result", {})
    client_id = data.get("client_id", "")

    device_id = str(uuid.uuid4())[:8]
    device = {
        "id": device_id,
        "hostname": scan_data.get("hostname", f"device-{device_id}"),
        "device_type": scan_data.get("device_type", "workstation"),
        "serial_number": scan_data.get("serial_number", ""),
        "model": scan_data.get("model", ""),
        "manufacturer": scan_data.get("manufacturer", ""),
        "warranty_expiry": scan_data.get("warranty_expiry"),
        "asset_tag": scan_data.get("asset_tag", ""),
        "ip_address": scan_data.get("ip_address", ""),
        "mac_address": scan_data.get("mac_address", ""),
        "client_id": client_id,
        "status": "online",
        "notes": scan_data.get("notes", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
        "created_via": "document_scanner",
    }
    await db.devices.insert_one(device)
    device.pop("_id", None)
    return device


@router.get("/doc-scanner/history")
async def scan_history(current_user: dict = Depends(get_current_user)):
    """Get scan history."""
    scans = await db.doc_scans.find({}, {"_id": 0}).sort("scanned_at", -1).to_list(50)
    return scans
