"""
Ticket Categorisation — sets category / issue_type / urgency / impact on a
ticket, then ITIL-style auto-computes priority from Urgency × Impact.

Priority Matrix (5-tier urgency × 5-tier impact):
            Impact:  1=Low  2=Minor  3=Moderate  4=Major  5=Crit
Urgency 1 (Low):       4       4         3          3       2
Urgency 2 (Minor):     4       3         3          2       2
Urgency 3 (Moderate):  3       3         2          2       1
Urgency 4 (High):      3       2         2          1       1
Urgency 5 (Critical):  2       2         1          1       1

Priority codes: 1=critical, 2=high, 3=medium, 4=low
"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# Levels 1-5 (1 = lowest, 5 = highest)
URGENCY_LABELS = {1: "low", 2: "minor", 3: "moderate", 4: "high", 5: "critical"}
IMPACT_LABELS = {1: "low", 2: "minor", 3: "moderate", 4: "major", 5: "critical"}
PRIORITY_LABELS = {1: "critical", 2: "high", 3: "medium", 4: "low"}

# ITIL-style 5x5 matrix → priority code (1=critical .. 4=low)
PRIORITY_MATRIX = {
    (1, 1): 4, (1, 2): 4, (1, 3): 3, (1, 4): 3, (1, 5): 2,
    (2, 1): 4, (2, 2): 3, (2, 3): 3, (2, 4): 2, (2, 5): 2,
    (3, 1): 3, (3, 2): 3, (3, 3): 2, (3, 4): 2, (3, 5): 1,
    (4, 1): 3, (4, 2): 2, (4, 3): 2, (4, 4): 1, (4, 5): 1,
    (5, 1): 2, (5, 2): 2, (5, 3): 1, (5, 4): 1, (5, 5): 1,
}


def compute_priority(urgency: int, impact: int) -> str:
    """Map an urgency × impact pair to a priority label."""
    u = max(1, min(5, int(urgency)))
    i = max(1, min(5, int(impact)))
    code = PRIORITY_MATRIX[(u, i)]
    return PRIORITY_LABELS[code]


@router.get("/ticket-priority-matrix")
async def get_priority_matrix(current_user: dict = Depends(get_current_user)):
    """Return the matrix + labels so the frontend can render a heat-map picker."""
    matrix = []
    for u in range(1, 6):
        row = []
        for i in range(1, 6):
            code = PRIORITY_MATRIX[(u, i)]
            row.append({"urgency": u, "impact": i, "priority": PRIORITY_LABELS[code]})
        matrix.append(row)
    return {
        "matrix": matrix,
        "urgency_labels": URGENCY_LABELS,
        "impact_labels": IMPACT_LABELS,
        "priority_labels": PRIORITY_LABELS,
    }


@router.patch("/tickets/{ticket_id}/categorisation")
async def update_ticket_categorisation(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update category/issue_type/urgency/impact on a ticket and auto-recompute priority."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    patch = {"updated_at": datetime.now(timezone.utc).isoformat()}
    allowed_fields = {"category_id", "category_name", "issue_type_id", "issue_type_name", "itil_urgency", "itil_impact"}
    # Back-compat: accept old keys
    if "urgency" in data:
        patch["itil_urgency"] = int(data["urgency"])
    if "impact" in data:
        patch["itil_impact"] = int(data["impact"])
    for key in allowed_fields:
        if key in data:
            patch[key] = data[key]

    # Pull urgency/impact (use submitted values OR fallback to existing)
    urgency = patch.get("itil_urgency", ticket.get("itil_urgency"))
    impact = patch.get("itil_impact", ticket.get("itil_impact"))
    auto_set_priority = data.get("auto_priority", True)
    if auto_set_priority and urgency is not None and impact is not None:
        try:
            patch["priority"] = compute_priority(urgency, impact)
            patch["priority_auto_computed"] = True
        except Exception:
            pass

    await db.tickets.update_one({"id": ticket_id}, {"$set": patch})

    # Audit log
    audit = {
        "ticket_id": ticket_id,
        "action": "categorisation_updated",
        "actor": current_user.get("id"),
        "actor_name": current_user.get("name"),
        "changes": {k: v for k, v in patch.items() if k != "updated_at"},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.ticket_audit.insert_one({**audit})
    except Exception:
        pass

    return await db.tickets.find_one({"id": ticket_id}, {"_id": 0})


@router.get("/tickets/{ticket_id}/categorisation")
async def get_ticket_categorisation(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one(
        {"id": ticket_id},
        {"_id": 0, "category_id": 1, "category_name": 1, "issue_type_id": 1,
         "issue_type_name": 1, "itil_urgency": 1, "itil_impact": 1, "priority": 1, "priority_auto_computed": 1},
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket
