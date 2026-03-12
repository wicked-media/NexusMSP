from datetime import datetime, timezone
import uuid
from app.database import db

ACHIEVEMENT_DEFINITIONS = [
    {"id": "first_ticket", "name": "First Resolve", "description": "Closed your first ticket", "icon": "trophy", "category": "tickets", "threshold": 1, "color": "#22c55e"},
    {"id": "ticket_10", "name": "Problem Solver", "description": "Closed 10 tickets", "icon": "target", "category": "tickets", "threshold": 10, "color": "#3b82f6"},
    {"id": "ticket_50", "name": "Resolution Machine", "description": "Closed 50 tickets", "icon": "zap", "category": "tickets", "threshold": 50, "color": "#8b5cf6"},
    {"id": "ticket_100", "name": "Century Club", "description": "Closed 100 tickets", "icon": "award", "category": "tickets", "threshold": 100, "color": "#f59e0b"},
    {"id": "ticket_500", "name": "Legend", "description": "Closed 500 tickets", "icon": "crown", "category": "tickets", "threshold": 500, "color": "#ef4444"},
    {"id": "ticket_1000", "name": "Ticket Titan", "description": "Closed 1,000 tickets", "icon": "gem", "category": "tickets", "threshold": 1000, "color": "#ec4899"},
    {"id": "first_invoice", "name": "Revenue Starter", "description": "Created your first invoice", "icon": "dollar-sign", "category": "invoices", "threshold": 1, "color": "#22c55e"},
    {"id": "invoice_25", "name": "Billing Pro", "description": "Created 25 invoices", "icon": "credit-card", "category": "invoices", "threshold": 25, "color": "#3b82f6"},
    {"id": "invoice_100", "name": "Finance Wizard", "description": "Created 100 invoices", "icon": "banknote", "category": "invoices", "threshold": 100, "color": "#f59e0b"},
    {"id": "remote_10", "name": "Remote Rookie", "description": "Completed 10 remote sessions", "icon": "monitor", "category": "remote", "threshold": 10, "color": "#06b6d4"},
    {"id": "remote_100", "name": "Remote Hero", "description": "Completed 100 remote sessions", "icon": "wifi", "category": "remote", "threshold": 100, "color": "#8b5cf6"},
    {"id": "tenure_1yr", "name": "Year One", "description": "1 year with the company", "icon": "calendar", "category": "tenure", "threshold": 365, "color": "#22c55e"},
    {"id": "tenure_3yr", "name": "Veteran", "description": "3 years with the company", "icon": "shield", "category": "tenure", "threshold": 1095, "color": "#3b82f6"},
    {"id": "tenure_5yr", "name": "Half Decade", "description": "5 years with the company", "icon": "star", "category": "tenure", "threshold": 1825, "color": "#f59e0b"},
    {"id": "tenure_10yr", "name": "Decade Hero", "description": "10 years with the company", "icon": "crown", "category": "tenure", "threshold": 3650, "color": "#ef4444"},
    {"id": "birthday", "name": "Birthday Star", "description": "It's your birthday!", "icon": "cake", "category": "celebration", "threshold": 0, "color": "#ec4899"},
    {"id": "speed_demon", "name": "Speed Demon", "description": "Average ticket resolution under 2 hours", "icon": "rocket", "category": "special", "threshold": 0, "color": "#f97316"},
    {"id": "multitasker", "name": "Multitasker", "description": "Worked on 5+ tickets in a single day", "icon": "layers", "category": "special", "threshold": 5, "color": "#14b8a6"},
]


async def log_activity(user: dict, action: str, entity_type: str, entity_id: str, entity_name: str = "", details: str = "", changes: dict = None, metadata: dict = None):
    """Log activity for cross-entity audit trail. Admin-visible only."""
    entry = {
        "id": str(uuid.uuid4()),
        "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "details": details,
        "changes": changes or {},
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.activity_logs.insert_one(entry)


async def ticket_audit(ticket_id: str, user: dict, action: str, details: str = ""):
    entry = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": user.get("id", ""),
        "user_name": user.get("name", ""),
        "action": action,
        "details": details,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.ticket_audit_log.insert_one(entry)
