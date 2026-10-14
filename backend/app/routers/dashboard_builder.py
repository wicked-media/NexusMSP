"""Saved legacy dashboard layouts with tenant and technician ownership."""
from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import tenant_scoped_query

router = APIRouter()


def _actor_id(current_user: dict) -> str:
    """Return the stable technician identifier used to own personal layouts."""
    return str(current_user.get("id") or current_user.get("user_id") or "")


def _owned_layout_query(
    current_user: dict, layout_id: str | None = None
) -> dict:
    """Limit a personal layout to its platform tenant and owning technician."""
    actor_id = _actor_id(current_user)
    if not actor_id:
        raise HTTPException(
            status_code=403, detail="A technician identity is required"
        )
    query = {"user_id": actor_id}
    if layout_id:
        query["layout_id"] = layout_id
    return tenant_scoped_query(current_user, query)


def _layout_columns(value: object) -> int:
    """Constrain the presentation-only grid without malformed input."""
    try:
        return max(1, min(int(value or 3), 6))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=422, detail="Columns must be a number from 1 to 6"
        )


@router.get("/dashboard-builder/layouts")
async def list_layouts(current_user: dict = Depends(get_current_user)):
    """List the current technician's saved layouts without sample data."""
    layouts = await db.dashboard_layouts.find(
        _owned_layout_query(current_user), {"_id": 0}
    ).to_list(20)
    return {
        "layouts": layouts,
        "available_widgets": _get_widget_catalog(),
        "meta": {
            "data_status": "current" if layouts else "empty",
            "source": "dashboard_layouts",
            "creates_sample_data": False,
        },
    }


@router.get("/dashboard-builder/layout/{layout_id}")
async def get_layout(
    layout_id: str, current_user: dict = Depends(get_current_user)
):
    """Load one personal layout only when it belongs to the caller."""
    layout = await db.dashboard_layouts.find_one(
        _owned_layout_query(current_user, layout_id), {"_id": 0}
    )
    if not layout:
        raise HTTPException(
            status_code=404, detail="Dashboard layout not found"
        )
    return layout


@router.post("/dashboard-builder/layout")
async def save_layout(
    body: dict, current_user: dict = Depends(get_current_user)
):
    """Save a personal layout without another technician's identity."""
    actor_id = _actor_id(current_user)
    requested_layout_id = str(body.get("layout_id") or "")
    existing = (
        await db.dashboard_layouts.find_one(
            _owned_layout_query(current_user, requested_layout_id),
            {"_id": 0, "layout_id": 1, "created_at": 1},
        )
        if requested_layout_id
        else None
    )
    # New IDs are server-generated. A caller cannot probe or collide with a
    # layout owned by another technician by supplying its identifier.
    layout_id = (existing or {}).get("layout_id") or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    layout = {
        "layout_id": layout_id,
        "tenant_id": current_user.get("tenant_id") or "nexus-local",
        "user_id": actor_id,
        "name": str(body.get("name") or "Custom Dashboard")[:120],
        "widgets": (
            body.get("widgets")
            if isinstance(body.get("widgets"), list)
            else []
        ),
        "columns": _layout_columns(body.get("columns")),
        "updated_at": now,
        "created_at": (existing or {}).get("created_at") or now,
    }
    await db.dashboard_layouts.update_one(
        _owned_layout_query(current_user, layout_id),
        {"$set": layout},
        upsert=True,
    )
    return {"status": "saved", "layout_id": layout_id}


@router.delete("/dashboard-builder/layout/{layout_id}")
async def delete_layout(
    layout_id: str, current_user: dict = Depends(get_current_user)
):
    """Delete only a layout owned by the signed-in technician."""
    result = await db.dashboard_layouts.delete_one(
        _owned_layout_query(current_user, layout_id)
    )
    if not result.deleted_count:
        raise HTTPException(
            status_code=404, detail="Dashboard layout not found"
        )
    return {"status": "deleted"}


def _get_widget_catalog():
    """Describe layout options without asserting a live provider connection."""
    return [
        {
            "type": "stat_card", "label": "Stat Card",
            "description": "Single KPI metric", "default_size": "1x1",
            "category": "metrics",
        },
        {
            "type": "line_chart", "label": "Line Chart",
            "description": "Trend from a configured data source",
            "default_size": "2x1", "category": "charts",
        },
        {
            "type": "bar_chart", "label": "Bar Chart",
            "description": "Comparison from a configured data source",
            "default_size": "2x1", "category": "charts",
        },
        {
            "type": "pie_chart", "label": "Pie Chart",
            "description": "Distribution from a configured data source",
            "default_size": "1x1", "category": "charts",
        },
        {
            "type": "ticket_feed", "label": "Ticket Feed",
            "description": (
                "Ticket feed when an authorised source is configured"
            ),
            "default_size": "2x2", "category": "feeds",
        },
        {
            "type": "alert_feed", "label": "Alert Feed",
            "description": (
                "Alert feed when an authorised source is configured"
            ),
            "default_size": "2x1", "category": "feeds",
        },
        {
            "type": "device_map", "label": "Device Map",
            "description": "Device geography when location evidence exists",
            "default_size": "2x2", "category": "maps",
        },
        {
            "type": "sla_gauge", "label": "SLA Gauge",
            "description": "SLA compliance from an authorised source",
            "default_size": "1x1", "category": "metrics",
        },
        {
            "type": "client_table", "label": "Client Table",
            "description": "Client summary from an authorised source",
            "default_size": "3x1", "category": "tables",
        },
        {
            "type": "tech_status", "label": "Tech Status",
            "description": "Technician availability from presence evidence",
            "default_size": "1x1", "category": "teams",
        },
        {
            "type": "revenue_trend", "label": "Revenue Trend",
            "description": "Revenue trend from authorised finance records",
            "default_size": "2x1", "category": "finance",
        },
        {
            "type": "patch_status", "label": "Patch Status",
            "description": "Patch compliance from endpoint evidence",
            "default_size": "1x1", "category": "security",
        },
    ]
