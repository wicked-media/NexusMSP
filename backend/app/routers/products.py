from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Body
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *
import barcode
from barcode.writer import SVGWriter
from io import BytesIO
import base64

router = APIRouter()

# ============== PRODUCTS ENDPOINTS ==============

@router.get("/products/categories")
async def get_product_categories(current_user: dict = Depends(get_current_user)):
    products = await db.products.find({}, {"_id": 0, "category": 1}).to_list(10000)
    cats = list(set(p.get("category", "General") for p in products))
    return sorted(cats) if cats else ["Hardware", "Software", "Licensing", "Services", "Accessories"]

@router.get("/products")
async def get_products(category: Optional[str] = None, search: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if category:
        query["category"] = category
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"sku": {"$regex": search, "$options": "i"}},
            {"vendor": {"$regex": search, "$options": "i"}},
        ]
    products = await db.products.find(query, {"_id": 0}).to_list(5000)
    return products

@router.post("/products")
async def create_product(data: dict, current_user: dict = Depends(get_current_user)):
    barcode_value = data.get("barcode", data.get("sku", ""))
    barcode_type = data.get("barcode_type", "code128")
    barcode_image = ""
    if barcode_value:
        barcode_image = generate_barcode_svg_data(barcode_value, barcode_type)
    product = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "sku": data.get("sku", ""),
        "description": data.get("description", ""),
        "category": data.get("category", "General"),
        "vendor": data.get("vendor", ""),
        "cost_price": float(data.get("cost_price", 0)),
        "retail_price": float(data.get("retail_price", 0)),
        "tax_rate": float(data.get("tax_rate", 0)),
        "quantity_in_stock": int(data.get("quantity_in_stock", 0)),
        "reorder_level": int(data.get("reorder_level", 5)),
        "unit": data.get("unit", "each"),
        "is_active": data.get("is_active", True),
        "is_taxable": data.get("is_taxable", True),
        "is_recurring": data.get("is_recurring", False),
        "billing_cycle": data.get("billing_cycle", "monthly"),
        "barcode": barcode_value,
        "barcode_type": barcode_type,
        "barcode_image": barcode_image,
        "bundle_items": data.get("bundle_items", []),
        "is_bundle": data.get("is_bundle", False),
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.products.insert_one(product)
    product.pop("_id", None)
    return product

@router.get("/products/{product_id}")
async def get_product(product_id: str, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

@router.put("/products/{product_id}")
async def update_product(product_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"name", "sku", "description", "category", "vendor", "cost_price", "retail_price",
               "tax_rate", "quantity_in_stock", "reorder_level", "unit", "is_active", "is_taxable",
               "is_recurring", "billing_cycle", "barcode", "barcode_type", "bundle_items", "is_bundle"}
    update = {k: v for k, v in data.items() if k in allowed}
    if "cost_price" in update:
        update["cost_price"] = float(update["cost_price"])
    if "retail_price" in update:
        update["retail_price"] = float(update["retail_price"])
    if "tax_rate" in update:
        update["tax_rate"] = float(update["tax_rate"])
    if "quantity_in_stock" in update:
        update["quantity_in_stock"] = int(update["quantity_in_stock"])
    if "reorder_level" in update:
        update["reorder_level"] = int(update["reorder_level"])
    if "barcode" in update and update["barcode"]:
        update["barcode_image"] = generate_barcode_svg_data(update["barcode"], update.get("barcode_type", "code128"))
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.products.update_one({"id": product_id}, {"$set": update})
    return {"message": "Product updated"}

@router.delete("/products/{product_id}")
async def delete_product(product_id: str, current_user: dict = Depends(get_current_user)):
    await db.products.delete_one({"id": product_id})
    return {"message": "Product deleted"}

# ============== PRODUCT BARCODE & STOCK ENDPOINTS ==============

def generate_barcode_svg_data(code: str, barcode_type: str = "code128") -> str:
    """Generate a barcode and return as base64 SVG data URI."""
    try:
        barcode_class = barcode.get_barcode_class(barcode_type.lower())
        bc = barcode_class(code, writer=SVGWriter())
        output = BytesIO()
        bc.write(output)
        output.seek(0)
        encoded = base64.b64encode(output.getvalue()).decode()
        return f"data:image/svg+xml;base64,{encoded}"
    except Exception as e:
        logger.error(f"Barcode generation error: {e}")
        return ""

@router.post("/products/{product_id}/generate-barcode")
async def generate_product_barcode(product_id: str, data: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    barcode_type = data.get("barcode_type", "code128")
    barcode_value = data.get("barcode_value", product.get("sku", product_id[:12]))
    if not barcode_value:
        barcode_value = str(uuid.uuid4())[:12].replace("-", "").upper()
    barcode_image = generate_barcode_svg_data(barcode_value, barcode_type)
    await db.products.update_one({"id": product_id}, {"$set": {
        "barcode": barcode_value, "barcode_type": barcode_type, "barcode_image": barcode_image,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }})
    return {"barcode": barcode_value, "barcode_type": barcode_type, "barcode_image": barcode_image}

@router.get("/products/{product_id}/barcode")
async def get_product_barcode(product_id: str, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0, "barcode": 1, "barcode_type": 1, "barcode_image": 1, "name": 1, "sku": 1})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not product.get("barcode"):
        barcode_value = product.get("sku", product_id[:12])
        barcode_image = generate_barcode_svg_data(barcode_value, "code128")
        return {"barcode": barcode_value, "barcode_type": "code128", "barcode_image": barcode_image, "name": product.get("name"), "sku": product.get("sku")}
    return product

# Product Instances (individual items with unique barcodes)
@router.get("/products/{product_id}/instances")
async def get_product_instances(product_id: str, current_user: dict = Depends(get_current_user)):
    instances = await db.product_instances.find({"product_id": product_id}, {"_id": 0}).to_list(5000)
    return instances

@router.post("/products/{product_id}/instances")
async def create_product_instance(product_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    count = data.get("count", 1)
    instances = []
    for _ in range(min(count, 100)):
        serial = data.get("serial_number", str(uuid.uuid4())[:8].upper())
        barcode_value = f"{product.get('sku', 'PRD')}-{serial}"
        barcode_image = generate_barcode_svg_data(barcode_value, "code128")
        instance = {
            "id": str(uuid.uuid4()), "product_id": product_id, "product_name": product["name"],
            "serial_number": serial, "barcode": barcode_value, "barcode_image": barcode_image,
            "status": data.get("status", "in_stock"), "location": data.get("location", "Warehouse"),
            "assigned_to": None, "ticket_id": None, "invoice_id": None,
            "notes": data.get("notes", ""), "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.product_instances.insert_one(instance)
        instance.pop("_id", None)
        instances.append(instance)
    # Update stock count
    current_stock = product.get("quantity_in_stock", 0)
    await db.products.update_one({"id": product_id}, {"$set": {"quantity_in_stock": current_stock + count, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return instances

# Stock Movements
@router.get("/products/{product_id}/stock-movements")
async def get_stock_movements(product_id: str, current_user: dict = Depends(get_current_user)):
    movements = await db.stock_movements.find({"product_id": product_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return movements

@router.post("/products/{product_id}/stock-movement")
async def create_stock_movement(product_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    movement_type = data.get("type", "in")  # in, out, adjustment
    quantity = int(data.get("quantity", 0))
    current_stock = product.get("quantity_in_stock", 0)
    if movement_type == "in":
        new_stock = current_stock + quantity
    elif movement_type == "out":
        new_stock = max(0, current_stock - quantity)
    else:
        new_stock = quantity  # adjustment sets exact value
    movement = {
        "id": str(uuid.uuid4()), "product_id": product_id, "product_name": product["name"],
        "type": movement_type, "quantity": quantity, "previous_stock": current_stock, "new_stock": new_stock,
        "reason": data.get("reason", ""), "reference": data.get("reference", ""),
        "ticket_id": data.get("ticket_id"), "invoice_id": data.get("invoice_id"),
        "created_by": current_user["id"], "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.stock_movements.insert_one(movement)
    movement.pop("_id", None)
    await db.products.update_one({"id": product_id}, {"$set": {"quantity_in_stock": new_stock, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return movement

# Label printing endpoint - returns HTML for print
@router.get("/products/{product_id}/label")
async def get_product_label(product_id: str, instance_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    barcode_value = product.get("barcode", product.get("sku", product_id[:12]))
    barcode_image = product.get("barcode_image", generate_barcode_svg_data(barcode_value, "code128"))
    if instance_id:
        instance = await db.product_instances.find_one({"id": instance_id}, {"_id": 0})
        if instance:
            barcode_value = instance.get("barcode", barcode_value)
            barcode_image = instance.get("barcode_image", barcode_image)
    return {
        "product_name": product["name"], "sku": product.get("sku", ""),
        "barcode": barcode_value, "barcode_image": barcode_image,
        "retail_price": product.get("retail_price", 0), "category": product.get("category", ""),
        "vendor": product.get("vendor", ""),
    }

# Link product to ticket
@router.post("/tickets/{ticket_id}/products")
async def add_product_to_ticket(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    product = await db.products.find_one({"id": data.get("product_id")}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    quantity = int(data.get("quantity", 1))
    line_item = {
        "id": str(uuid.uuid4()), "product_id": product["id"], "product_name": product["name"],
        "sku": product.get("sku", ""), "quantity": quantity,
        "unit_price": product.get("retail_price", 0),
        "total": quantity * product.get("retail_price", 0),
    }
    await db.tickets.update_one({"id": ticket_id}, {"$push": {"products": line_item}})
    # Stock movement out
    current_stock = product.get("quantity_in_stock", 0)
    await db.products.update_one({"id": product["id"]}, {"$set": {"quantity_in_stock": max(0, current_stock - quantity)}})
    await db.stock_movements.insert_one({
        "id": str(uuid.uuid4()), "product_id": product["id"], "product_name": product["name"],
        "type": "out", "quantity": quantity, "previous_stock": current_stock,
        "new_stock": max(0, current_stock - quantity), "reason": f"Added to ticket {ticket_id}",
        "reference": ticket_id, "ticket_id": ticket_id,
        "created_by": current_user["id"], "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return line_item

# Get products on a ticket
@router.get("/tickets/{ticket_id}/products")
async def get_ticket_products(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "products": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket.get("products", [])



# ============== PRODUCT BUNDLING ==============

@router.get("/products/{product_id}/bundle")
async def get_product_bundle(product_id: str, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    bundle_items = product.get("bundle_items", [])
    enriched = []
    for bi in bundle_items:
        linked = await db.products.find_one({"id": bi.get("product_id")}, {"_id": 0})
        if linked:
            enriched.append({
                "product_id": linked["id"], "name": linked["name"], "sku": linked.get("sku", ""),
                "category": linked.get("category", ""), "quantity": bi.get("quantity", 1),
                "cost_price": linked.get("cost_price", 0), "retail_price": linked.get("retail_price", 0),
                "quantity_in_stock": linked.get("quantity_in_stock", 0),
            })
    return {"product_id": product_id, "is_bundle": product.get("is_bundle", False), "bundle_items": enriched}

@router.put("/products/{product_id}/bundle")
async def update_product_bundle(product_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    bundle_items = data.get("bundle_items", [])
    clean_items = []
    for bi in bundle_items:
        if bi.get("product_id") and bi["product_id"] != product_id:
            clean_items.append({"product_id": bi["product_id"], "quantity": int(bi.get("quantity", 1))})
    await db.products.update_one({"id": product_id}, {"$set": {
        "bundle_items": clean_items, "is_bundle": len(clean_items) > 0,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    return {"message": "Bundle updated", "bundle_items": clean_items}

# ============== ON-ORDER / STOCK STATUS ==============

@router.get("/products/{product_id}/on-order")
async def get_product_on_order(product_id: str, current_user: dict = Depends(get_current_user)):
    open_pos = await db.purchase_orders.find(
        {"status": {"$in": ["submitted", "partial"]}, "line_items.product_id": product_id}, {"_id": 0}
    ).to_list(500)
    on_order_qty = 0
    po_refs = []
    for po in open_pos:
        for li in po.get("line_items", []):
            if li.get("product_id") == product_id:
                remaining = li.get("quantity", 0) - li.get("received_qty", 0)
                if remaining > 0:
                    on_order_qty += remaining
                    po_refs.append({"po_id": po["id"], "po_number": po["po_number"], "vendor": po.get("vendor", ""), "quantity": remaining, "expected_delivery": po.get("expected_delivery", "")})
    return {"product_id": product_id, "on_order_qty": on_order_qty, "purchase_orders": po_refs}

@router.get("/products/inventory/on-order-summary")
async def get_on_order_summary(current_user: dict = Depends(get_current_user)):
    open_pos = await db.purchase_orders.find({"status": {"$in": ["submitted", "partial"]}}, {"_id": 0}).to_list(5000)
    product_orders = {}
    for po in open_pos:
        for li in po.get("line_items", []):
            pid = li.get("product_id")
            if pid:
                remaining = li.get("quantity", 0) - li.get("received_qty", 0)
                if remaining > 0:
                    if pid not in product_orders:
                        product_orders[pid] = {"product_id": pid, "product_name": li.get("product_name", ""), "on_order_qty": 0, "pos": []}
                    product_orders[pid]["on_order_qty"] += remaining
                    product_orders[pid]["pos"].append({"po_number": po["po_number"], "vendor": po.get("vendor", ""), "qty": remaining})
    return list(product_orders.values())

# ============== TICKET ITEMS TO INVOICE ==============

@router.post("/tickets/{ticket_id}/products-to-invoice")
async def push_ticket_products_to_invoice(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    products_on_ticket = ticket.get("products", [])
    if not products_on_ticket:
        raise HTTPException(status_code=400, detail="No products on this ticket")
    invoice_id = data.get("invoice_id")
    if invoice_id:
        invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        existing_items = invoice.get("line_items", [])
        for p in products_on_ticket:
            existing_items.append({
                "description": p.get("product_name", "Product"),
                "quantity": p.get("quantity", 1),
                "unit_price": p.get("unit_price", 0),
                "amount": p.get("total", 0),
                "product_id": p.get("product_id", ""),
                "from_ticket": ticket_id,
            })
        new_subtotal = sum(li.get("amount", 0) for li in existing_items)
        tax_rate = float(invoice.get("tax_rate", 0))
        new_tax = new_subtotal * tax_rate / 100
        new_total = new_subtotal + new_tax
        await db.invoices.update_one({"id": invoice_id}, {"$set": {
            "line_items": existing_items, "subtotal": round(new_subtotal, 2),
            "tax_amount": round(new_tax, 2), "total": round(new_total, 2),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }})
        return {"message": f"Added {len(products_on_ticket)} items to invoice", "invoice_id": invoice_id}
    else:
        inv_count = await db.invoices.count_documents({})
        new_line_items = []
        for p in products_on_ticket:
            new_line_items.append({
                "description": p.get("product_name", "Product"),
                "quantity": p.get("quantity", 1),
                "unit_price": p.get("unit_price", 0),
                "amount": p.get("total", 0),
                "product_id": p.get("product_id", ""),
                "from_ticket": ticket_id,
            })
        subtotal = sum(li["amount"] for li in new_line_items)
        invoice = {
            "id": str(uuid.uuid4()),
            "invoice_number": f"INV-{inv_count + 1001:04d}",
            "client_id": ticket.get("client_id", ""),
            "status": "draft", "payment_status": "unpaid",
            "line_items": new_line_items,
            "subtotal": round(subtotal, 2), "tax_rate": 0, "tax_amount": 0,
            "total": round(subtotal, 2), "amount_paid": 0,
            "due_date": "", "notes": f"Generated from ticket {ticket.get('ticket_number', ticket_id)}",
            "from_ticket": ticket_id,
            "created_by": current_user["id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.invoices.insert_one(invoice)
        invoice.pop("_id", None)
        return {"message": "New invoice created from ticket items", "invoice_id": invoice["id"], "invoice_number": invoice["invoice_number"]}

@router.delete("/tickets/{ticket_id}/products/{item_id}")
async def remove_product_from_ticket(ticket_id: str, item_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    products = ticket.get("products", [])
    item = next((p for p in products if p.get("id") == item_id), None)
    if item:
        product = await db.products.find_one({"id": item.get("product_id")}, {"_id": 0})
        if product:
            await db.products.update_one({"id": item["product_id"]}, {"$inc": {"quantity_in_stock": item.get("quantity", 1)}})
    await db.tickets.update_one({"id": ticket_id}, {"$pull": {"products": {"id": item_id}}})
    return {"message": "Product removed from ticket"}
