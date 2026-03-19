from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/vendor-scorecard/overview")
async def vendor_scorecard(current_user: dict = Depends(get_current_user)):
    """Vendor performance scorecard and spend analytics."""
    vendors = await db.vendors.find({}, {"_id": 0}).to_list(100)
    results = []

    for v in vendors:
        vid = v.get("id", "")
        # PO data
        total_pos = await db.purchase_orders.count_documents({"vendor_id": vid})
        delivered_pos = await db.purchase_orders.count_documents({"vendor_id": vid, "status": "received"})
        pos = await db.purchase_orders.find({"vendor_id": vid}, {"_id": 0, "total": 1, "created_at": 1, "received_at": 1}).to_list(200)

        total_spend = sum(p.get("total", 0) for p in pos)

        # Average delivery time
        delivery_times = []
        for p in pos:
            if p.get("created_at") and p.get("received_at"):
                try:
                    ct = datetime.fromisoformat(p["created_at"].replace("Z", "+00:00"))
                    rt = datetime.fromisoformat(p["received_at"].replace("Z", "+00:00"))
                    delivery_times.append((rt - ct).days)
                except Exception:
                    pass

        avg_delivery = round(sum(delivery_times) / len(delivery_times), 1) if delivery_times else 0
        fulfillment_rate = round((delivered_pos / max(total_pos, 1)) * 100, 1)

        # Score (0-100)
        delivery_score = max(0, 100 - avg_delivery * 5) if avg_delivery > 0 else 70
        score = round(fulfillment_rate * 0.5 + delivery_score * 0.3 + min(100, total_pos * 10) * 0.2)

        results.append({
            "vendor_id": vid, "vendor_name": v.get("name", ""),
            "contact": v.get("email", ""), "category": v.get("category", "general"),
            "total_pos": total_pos, "fulfilled": delivered_pos,
            "total_spend": round(total_spend, 2),
            "avg_delivery_days": avg_delivery,
            "fulfillment_rate": fulfillment_rate,
            "score": min(100, score),
            "rating": "excellent" if score >= 80 else "good" if score >= 60 else "average" if score >= 40 else "poor",
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    total_spend = sum(r["total_spend"] for r in results)

    return {
        "vendors": results,
        "summary": {
            "total_vendors": len(results),
            "total_spend": round(total_spend, 2),
            "avg_score": round(sum(r["score"] for r in results) / max(len(results), 1), 1),
            "top_vendor": results[0]["vendor_name"] if results else "N/A",
        },
    }
