from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone
import uuid, io, base64
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/qr-assets/generate/{asset_type}/{asset_id}")
async def generate_qr_code(asset_type: str, asset_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a QR code for a device or asset."""
    import qrcode

    # Build the URL the QR code points to
    base_url = "/devices" if asset_type == "device" else "/assets"
    qr_data = f"{base_url}/{asset_id}"

    # Get asset info
    if asset_type == "device":
        item = await db.devices.find_one({"id": asset_id}, {"_id": 0, "hostname": 1, "device_type": 1, "client_name": 1})
        label = (item or {}).get("hostname", asset_id)
    else:
        item = await db.assets.find_one({"id": asset_id}, {"_id": 0, "name": 1, "asset_tag": 1})
        label = (item or {}).get("name", asset_id)

    qr = qrcode.QRCode(version=1, box_size=10, border=4)
    qr.add_data(qr_data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    img_base64 = base64.b64encode(buf.getvalue()).decode()

    return {"qr_image": f"data:image/png;base64,{img_base64}", "label": label, "url": qr_data}


@router.get("/qr-assets/generate-batch")
async def generate_batch_qr(current_user: dict = Depends(get_current_user)):
    """Generate QR codes for all devices."""
    import qrcode

    devices = await db.devices.find({}, {"_id": 0, "id": 1, "hostname": 1, "device_type": 1, "client_name": 1}).to_list(200)
    results = []
    for d in devices[:50]:
        qr_data = f"/devices/{d['id']}"
        qr = qrcode.QRCode(version=1, box_size=6, border=2)
        qr.add_data(qr_data)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        img_base64 = base64.b64encode(buf.getvalue()).decode()
        results.append({
            "id": d["id"], "hostname": d.get("hostname", ""),
            "type": d.get("device_type", ""), "client": d.get("client_name", ""),
            "qr_image": f"data:image/png;base64,{img_base64}",
        })
    return results


@router.get("/qr-assets/print-sheet")
async def generate_print_sheet(current_user: dict = Depends(get_current_user)):
    """Generate a printable sheet of QR code labels."""
    import qrcode

    devices = await db.devices.find({}, {"_id": 0, "id": 1, "hostname": 1, "device_type": 1, "client_name": 1}).to_list(100)
    labels = []
    for d in devices[:30]:
        qr_data = f"/devices/{d['id']}"
        qr = qrcode.QRCode(version=1, box_size=4, border=2)
        qr.add_data(qr_data)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        img_base64 = base64.b64encode(buf.getvalue()).decode()
        labels.append({
            "id": d["id"], "hostname": d.get("hostname", "Unknown"),
            "type": d.get("device_type", ""), "client": d.get("client_name", ""),
            "qr": f"data:image/png;base64,{img_base64}",
        })
    return labels
