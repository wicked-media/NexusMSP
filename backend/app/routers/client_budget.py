"""Client-linked IT budget records with auditable, explicit financial inputs."""

from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity


router = APIRouter()
def _amount(value, field: str, *, minimum: float = 0) -> float:
    try:
        amount = round(float(value or 0), 2)
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=400, detail=f"{field} must be a number") from error
    if amount < minimum:
        raise HTTPException(status_code=400, detail=f"{field} cannot be less than {minimum}")
    return amount


def _categories(value) -> list[dict]:
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail="categories must be a list")
    categories = []
    for item in value:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Each category must be an object")
        name = str(item.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Each category needs a name")
        categories.append({"name": name, "budget": _amount(item.get("budget"), f"{name} budget"), "spent": _amount(item.get("spent"), f"{name} spend")})
    return categories


def _presentation(record: dict) -> dict:
    item = {key: value for key, value in record.items() if key != "_id"}
    now = datetime.now(timezone.utc)
    elapsed_months = max(now.month, 1)
    annual_budget = _amount(item.get("annual_budget"), "annual budget")
    ytd_spent = _amount(item.get("ytd_spent"), "YTD spend")
    monthly_budget = round(annual_budget / 12, 2)
    monthly_spent = round(ytd_spent / elapsed_months, 2)
    forecast_eoy = round(monthly_spent * 12, 2)
    pace_target = annual_budget * (elapsed_months / 12)
    item.update({
        "annual_budget": annual_budget,
        "ytd_spent": ytd_spent,
        "monthly_budget": monthly_budget,
        "monthly_spent": monthly_spent,
        "forecast_eoy": forecast_eoy,
        "status": "over_budget" if forecast_eoy > annual_budget * 1.05 else "over_pace" if ytd_spent > pace_target * 1.05 else "on_track",
        "categories": _categories(item.get("categories", [])),
    })
    return item


async def _client(client_id: str) -> dict:
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.get("/client-budget/overview")
async def budget_overview(current_user: dict = Depends(get_current_user)):
    """Return only intentionally configured client budgets; never seed estimates."""
    records = await db.client_budgets.find({}, {"_id": 0}).sort("client_name", 1).to_list(1000)
    budgets = [_presentation(record) for record in records]
    total_budget = round(sum(record["annual_budget"] for record in budgets), 2)
    total_spent = round(sum(record["ytd_spent"] for record in budgets), 2)
    return {
        "budgets": budgets,
        "summary": {
            "total_annual_budget": total_budget,
            "total_ytd_spent": total_spent,
            "avg_utilization_pct": round((total_spent / total_budget) * 100, 1) if total_budget else 0,
            "clients_over_budget": sum(record["status"] == "over_budget" for record in budgets),
            "configured_clients": len(budgets),
        },
    }


@router.post("/client-budget")
async def create_budget(data: dict, current_user: dict = Depends(get_current_user)):
    client_id = str(data.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="Client is required")
    client = await _client(client_id)
    if await db.client_budgets.find_one({"client_id": client_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail="This client already has an IT budget. Edit the existing record instead.")

    now = datetime.now(timezone.utc).isoformat()
    record = {
        "id": str(uuid.uuid4()), "client_id": client_id, "client_name": client.get("name") or "",
        "annual_budget": _amount(data.get("annual_budget"), "Annual budget", minimum=0.01),
        "ytd_spent": _amount(data.get("ytd_spent"), "YTD spend"),
        "categories": _categories(data.get("categories", [])),
        "notes": str(data.get("notes") or "").strip(),
        "created_at": now, "updated_at": now,
    }
    await db.client_budgets.insert_one(record)
    await log_activity(current_user, "created", "client_budget", record["id"], record["client_name"], "Created client IT budget", metadata={"client_id": client_id, "annual_budget": record["annual_budget"]})
    return _presentation(record)


@router.put("/client-budget/{budget_id}")
async def update_budget(budget_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    existing = await db.client_budgets.find_one({"id": budget_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Client budget not found")
    update = {}
    if "annual_budget" in data:
        update["annual_budget"] = _amount(data["annual_budget"], "Annual budget", minimum=0.01)
    if "ytd_spent" in data:
        update["ytd_spent"] = _amount(data["ytd_spent"], "YTD spend")
    if "categories" in data:
        update["categories"] = _categories(data["categories"])
    if "notes" in data:
        update["notes"] = str(data["notes"] or "").strip()
    if "client_id" in data and data["client_id"] != existing.get("client_id"):
        client = await _client(str(data["client_id"] or ""))
        update.update({"client_id": client["id"], "client_name": client.get("name") or ""})
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.client_budgets.update_one({"id": budget_id}, {"$set": update})
    await log_activity(current_user, "updated", "client_budget", budget_id, update.get("client_name", existing.get("client_name", "")), "Updated client IT budget", changes=update)
    updated = {**existing, **update}
    return _presentation(updated)


@router.delete("/client-budget/{budget_id}")
async def delete_budget(budget_id: str, current_user: dict = Depends(get_current_user)):
    existing = await db.client_budgets.find_one({"id": budget_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Client budget not found")
    await db.client_budgets.delete_one({"id": budget_id})
    await log_activity(current_user, "deleted", "client_budget", budget_id, existing.get("client_name", ""), "Deleted client IT budget", metadata={"client_id": existing.get("client_id")})
    return {"message": "Client budget deleted"}
