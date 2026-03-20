from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random, uuid

router = APIRouter()

# ─── Custom Dashboard Builder ───

@router.get("/dashboard-builder/layouts")
async def list_layouts(current_user: dict = Depends(get_current_user)):
    layouts = await db.dashboard_layouts.find({}, {"_id": 0}).to_list(20)
    if not layouts:
        layouts = await _seed_layouts()
    return {"layouts": layouts, "available_widgets": _get_widget_catalog()}


@router.get("/dashboard-builder/layout/{layout_id}")
async def get_layout(layout_id: str, current_user: dict = Depends(get_current_user)):
    layout = await db.dashboard_layouts.find_one({"layout_id": layout_id}, {"_id": 0})
    if not layout:
        layouts = await _seed_layouts()
        layout = layouts[0] if layouts else {}
    return layout


@router.post("/dashboard-builder/layout")
async def save_layout(body: dict, current_user: dict = Depends(get_current_user)):
    layout_id = body.get("layout_id", str(uuid.uuid4())[:8])
    layout = {
        "layout_id": layout_id,
        "name": body.get("name", "Custom Dashboard"),
        "widgets": body.get("widgets", []),
        "columns": body.get("columns", 3),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("email", "admin"),
    }
    await db.dashboard_layouts.update_one(
        {"layout_id": layout_id}, {"$set": layout}, upsert=True
    )
    return {"status": "saved", "layout_id": layout_id}


@router.delete("/dashboard-builder/layout/{layout_id}")
async def delete_layout(layout_id: str, current_user: dict = Depends(get_current_user)):
    await db.dashboard_layouts.delete_one({"layout_id": layout_id})
    return {"status": "deleted"}


def _get_widget_catalog():
    return [
        {"type": "stat_card", "label": "Stat Card", "description": "Single KPI metric", "default_size": "1x1", "category": "metrics"},
        {"type": "line_chart", "label": "Line Chart", "description": "Trend over time", "default_size": "2x1", "category": "charts"},
        {"type": "bar_chart", "label": "Bar Chart", "description": "Comparison bars", "default_size": "2x1", "category": "charts"},
        {"type": "pie_chart", "label": "Pie Chart", "description": "Distribution ring", "default_size": "1x1", "category": "charts"},
        {"type": "ticket_feed", "label": "Ticket Feed", "description": "Live ticket stream", "default_size": "2x2", "category": "feeds"},
        {"type": "alert_feed", "label": "Alert Feed", "description": "Live alert stream", "default_size": "2x1", "category": "feeds"},
        {"type": "device_map", "label": "Device Map", "description": "Geo device view", "default_size": "2x2", "category": "maps"},
        {"type": "sla_gauge", "label": "SLA Gauge", "description": "SLA compliance gauge", "default_size": "1x1", "category": "metrics"},
        {"type": "client_table", "label": "Client Table", "description": "Client summary grid", "default_size": "3x1", "category": "tables"},
        {"type": "tech_status", "label": "Tech Status", "description": "Technician availability", "default_size": "1x1", "category": "teams"},
        {"type": "revenue_trend", "label": "Revenue Trend", "description": "MRR over time", "default_size": "2x1", "category": "finance"},
        {"type": "patch_status", "label": "Patch Status", "description": "Patch compliance ring", "default_size": "1x1", "category": "security"},
    ]


async def _seed_layouts():
    layouts = [
        {
            "layout_id": "default-ops",
            "name": "Operations Overview",
            "columns": 3,
            "widgets": [
                {"id": "w1", "type": "stat_card", "title": "Open Tickets", "position": {"x": 0, "y": 0, "w": 1, "h": 1}, "config": {"metric": "open_tickets", "value": 47, "change": -3, "color": "#3b82f6"}},
                {"id": "w2", "type": "stat_card", "title": "Devices Online", "position": {"x": 1, "y": 0, "w": 1, "h": 1}, "config": {"metric": "devices_online", "value": 124, "change": 2, "color": "#10b981"}},
                {"id": "w3", "type": "stat_card", "title": "SLA Compliance", "position": {"x": 2, "y": 0, "w": 1, "h": 1}, "config": {"metric": "sla_compliance", "value": 97.2, "change": 0.5, "color": "#8b5cf6", "suffix": "%"}},
                {"id": "w4", "type": "line_chart", "title": "Ticket Volume (7d)", "position": {"x": 0, "y": 1, "w": 2, "h": 1}, "config": {"data": [{"day": f"Day {i+1}", "tickets": random.randint(8, 25)} for i in range(7)]}},
                {"id": "w5", "type": "pie_chart", "title": "Ticket Priority", "position": {"x": 2, "y": 1, "w": 1, "h": 1}, "config": {"data": [{"name": "Critical", "value": 5, "color": "#ef4444"}, {"name": "High", "value": 12, "color": "#f97316"}, {"name": "Medium", "value": 18, "color": "#eab308"}, {"name": "Low", "value": 12, "color": "#22c55e"}]}},
                {"id": "w6", "type": "ticket_feed", "title": "Recent Tickets", "position": {"x": 0, "y": 2, "w": 2, "h": 2}, "config": {"limit": 8}},
                {"id": "w7", "type": "sla_gauge", "title": "Response SLA", "position": {"x": 2, "y": 2, "w": 1, "h": 1}, "config": {"value": 97.2, "target": 95, "color": "#10b981"}},
            ],
            "created_by": "admin",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        {
            "layout_id": "security-ops",
            "name": "Security Dashboard",
            "columns": 3,
            "widgets": [
                {"id": "s1", "type": "stat_card", "title": "Active Threats", "position": {"x": 0, "y": 0, "w": 1, "h": 1}, "config": {"metric": "threats", "value": 3, "change": -1, "color": "#ef4444"}},
                {"id": "s2", "type": "stat_card", "title": "Endpoints Protected", "position": {"x": 1, "y": 0, "w": 1, "h": 1}, "config": {"metric": "endpoints", "value": 131, "change": 0, "color": "#10b981"}},
                {"id": "s3", "type": "patch_status", "title": "Patch Compliance", "position": {"x": 2, "y": 0, "w": 1, "h": 1}, "config": {"value": 67.9, "color": "#f97316"}},
                {"id": "s4", "type": "alert_feed", "title": "Security Alerts", "position": {"x": 0, "y": 1, "w": 2, "h": 1}, "config": {"limit": 5}},
            ],
            "created_by": "admin",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        {
            "layout_id": "finance-view",
            "name": "Financial Overview",
            "columns": 3,
            "widgets": [
                {"id": "f1", "type": "stat_card", "title": "MRR", "position": {"x": 0, "y": 0, "w": 1, "h": 1}, "config": {"metric": "mrr", "value": 87500, "change": 2300, "color": "#10b981", "prefix": "$"}},
                {"id": "f2", "type": "stat_card", "title": "ARR", "position": {"x": 1, "y": 0, "w": 1, "h": 1}, "config": {"metric": "arr", "value": 1050000, "change": 27600, "color": "#3b82f6", "prefix": "$"}},
                {"id": "f3", "type": "stat_card", "title": "Avg Margin", "position": {"x": 2, "y": 0, "w": 1, "h": 1}, "config": {"metric": "margin", "value": 42.5, "change": 1.2, "color": "#8b5cf6", "suffix": "%"}},
                {"id": "f4", "type": "revenue_trend", "title": "Revenue Trend", "position": {"x": 0, "y": 1, "w": 2, "h": 1}, "config": {"data": [{"month": m, "mrr": random.randint(80000, 95000)} for m in ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb"]]}},
                {"id": "f5", "type": "client_table", "title": "Top Clients by MRR", "position": {"x": 0, "y": 2, "w": 3, "h": 1}, "config": {"limit": 5}},
            ],
            "created_by": "admin",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    ]
    await db.dashboard_layouts.insert_many(layouts)
    for l in layouts:
        l.pop("_id", None)
    return layouts
