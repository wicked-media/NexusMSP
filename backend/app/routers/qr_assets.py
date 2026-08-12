from fastapi import APIRouter, Depends, HTTPException
import io
import base64
from app.database import db
from app.auth import get_current_user
from app.services.scope_permissions import assert_record_scope, scoped_query

router = APIRouter()


def _make_qr_data_url(value: str, *, box_size: int, border: int) -> str:
    """Return a PNG data URL for a QR label without storing transient files."""
    import qrcode

    qr = qrcode.QRCode(version=1, box_size=box_size, border=border)
    qr.add_data(value)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode()}"


def _asset_label(asset: dict, qr_image: str, *, print_format: bool = False) -> dict:
    """Keep batch and print-sheet labels tied to the inventory record contract."""
    label = {
        "id": asset["id"],
        "name": asset.get("name") or "Unnamed asset",
        "asset_tag": asset.get("asset_tag") or f"AST-{asset['id'][:6].upper()}",
        "asset_type": asset.get("asset_type") or "other",
        "client_name": asset.get("client_name") or "Unassigned client",
    }
    label["qr" if print_format else "qr_image"] = qr_image
    return label


@router.get("/qr-assets/generate/{asset_type}/{asset_id}")
async def generate_qr_code(asset_type: str, asset_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a QR code for a managed device or a canonical inventory asset."""
    if asset_type == "device":
        item = await assert_record_scope(current_user, db.devices, asset_id, operation="asset.qr.generate", resource_name="Managed asset")
        qr_data = f"/devices/{asset_id}"
        label = item.get("hostname") or asset_id
    elif asset_type == "asset":
        item = await assert_record_scope(current_user, db.assets, asset_id, operation="asset.qr.generate", resource_name="Inventory asset")
        qr_data = f"/assets/{asset_id}"
        label = item.get("asset_tag") or item.get("name") or asset_id
    else:
        raise HTTPException(status_code=400, detail="asset_type must be 'asset' or 'device'")

    return {"qr_image": _make_qr_data_url(qr_data, box_size=10, border=4), "label": label, "url": qr_data}


@router.get("/qr-assets/generate-batch")
async def generate_batch_qr(current_user: dict = Depends(get_current_user)):
    """Generate QR label previews for inventory assets, not the RMM device list."""
    assets = await db.assets.find(scoped_query(current_user), {"_id": 0, "id": 1, "name": 1, "asset_tag": 1, "asset_type": 1, "client_name": 1}).sort("name", 1).to_list(200)
    results = []
    for asset in assets[:50]:
        results.append(_asset_label(asset, _make_qr_data_url(f"/assets/{asset['id']}", box_size=6, border=2)))
    return results


@router.get("/qr-assets/print-sheet")
async def generate_print_sheet(current_user: dict = Depends(get_current_user)):
    """Generate a printable sheet of canonical inventory asset QR labels."""
    assets = await db.assets.find(scoped_query(current_user), {"_id": 0, "id": 1, "name": 1, "asset_tag": 1, "asset_type": 1, "client_name": 1}).sort("name", 1).to_list(100)
    labels = []
    for asset in assets[:30]:
        labels.append(_asset_label(asset, _make_qr_data_url(f"/assets/{asset['id']}", box_size=4, border=2), print_format=True))
    return labels
