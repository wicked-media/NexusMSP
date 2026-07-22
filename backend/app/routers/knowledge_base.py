from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid, os, json
from app.database import db
from app.auth import get_current_user

router = APIRouter()


# A safe, useful baseline for a newly provisioned MSP.  Each entry is deliberately
# generic: technicians should tailor the runbook to the client's documented setup.
TECHNICIAN_LIBRARY = [
    ("Reset a local Windows password", "windows", "password,windows,local-account", "Reset a local account securely and confirm the user can sign in."),
    ("Troubleshoot Microsoft 365 sign-in", "email", "microsoft-365,entra-id,authentication", "Diagnose common Microsoft 365 and Entra ID sign-in failures."),
    ("Outlook desktop not syncing mail", "email", "outlook,microsoft-365,sync", "Restore Outlook connectivity without losing the user's local data."),
    ("Create a new Outlook profile", "email", "outlook,profile,mail", "Create and validate a replacement Outlook profile."),
    ("Microsoft Teams audio and camera checks", "software", "teams,audio,video", "Check device permissions, drivers, and Teams settings for calls."),
    ("OneDrive sync reset", "software", "onedrive,microsoft-365,sync", "Resolve OneDrive sync errors and verify files are protected."),
    ("SharePoint access request workflow", "email", "sharepoint,permissions,microsoft-365", "Grant least-privilege SharePoint access and record approval."),
    ("VPN connection troubleshooting", "network", "vpn,network,remote-access", "Identify authentication, client, DNS, and connectivity faults."),
    ("Wi-Fi connection troubleshooting", "network", "wifi,wireless,network", "Restore a workstation's Wi-Fi connection methodically."),
    ("DNS troubleshooting from a workstation", "network", "dns,network,connectivity", "Confirm DNS resolution and isolate local versus upstream faults."),
    ("Map a network drive", "network", "network-drive,smb,windows", "Map a documented file share and validate access permissions."),
    ("Printer offline troubleshooting", "hardware", "printer,print,windows", "Bring an offline printer back online and test printing."),
    ("Add a network printer", "hardware", "printer,network,windows", "Install a network printer using the approved driver and address."),
    ("BitLocker recovery key process", "security", "bitlocker,encryption,recovery", "Recover an encrypted endpoint through the approved identity workflow."),
    ("Microsoft Defender health review", "security", "defender,endpoint-security,antivirus", "Review Defender state, signatures, exclusions, and remediation status."),
    ("Respond to suspected phishing", "security", "phishing,email,incident", "Contain a suspected phishing event and preserve evidence."),
    ("MFA reset and re-registration", "security", "mfa,entra-id,authentication", "Reset multi-factor authentication while validating the requester."),
    ("New starter onboarding checklist", "onboarding", "onboarding,user,microsoft-365", "Provision a new user, devices, access, and a documented handover."),
    ("Offboard a departing employee", "onboarding", "offboarding,microsoft-365,security", "Securely remove access, preserve data, and document approvals."),
    ("Prepare a Windows device for a new user", "windows", "windows,device,onboarding", "Prepare, update, encrypt, and validate a replacement workstation."),
    ("Windows Update remediation", "windows", "windows-update,patching", "Troubleshoot failed Windows updates before escalating."),
    ("Winget application update workflow", "software", "winget,patching,software", "Safely update supported applications through Winget."),
    ("Remove unwanted software", "software", "software,uninstall,security", "Remove software with approval and validate application dependencies."),
    ("Browser cache and profile reset", "software", "browser,chrome,edge,troubleshooting", "Repair browser issues while preserving bookmarks where appropriate."),
    ("Remote access session checklist", "procedures", "remote-access,rustdesk,support", "Start, document, and close a remote support session safely."),
    ("Endpoint not checking in", "hardware", "rmm,agent,device", "Restore an agent check-in and capture the reason for the outage."),
    ("Disk space remediation", "windows", "disk-space,windows,performance", "Free disk space without deleting customer data unnecessarily."),
    ("Windows performance triage", "windows", "performance,windows,hardware", "Collect evidence for high CPU, memory, disk, and startup issues."),
    ("Blue screen incident triage", "windows", "bsod,windows,hardware", "Capture stop-code evidence and perform safe first-line diagnostics."),
    ("Laptop battery health assessment", "hardware", "laptop,battery,hardware", "Assess battery condition and provide a replacement recommendation."),
    ("Hardware warranty lookup", "hardware", "warranty,asset,hardware", "Record warranty status against the correct asset serial number."),
    ("Network switch port troubleshooting", "network", "switch,network,ethernet", "Verify link, VLAN, power, and endpoint behaviour for a switch port."),
    ("Internet outage triage", "network", "internet,isp,network", "Differentiate ISP, firewall, DNS, and LAN outages with clear evidence."),
    ("Firewall change request", "network", "firewall,change-management,security", "Safely assess, approve, implement, test, and roll back a firewall change."),
    ("Backup failure first response", "security", "backup,disaster-recovery,monitoring", "Assess backup failure urgency, protect recoverability, and escalate correctly."),
    ("Test a backup restore", "security", "backup,restore,disaster-recovery", "Perform and document a non-production recovery test."),
    ("Create an incident ticket from an alert", "procedures", "ticket,alert,incident", "Turn an alert into an actionable, audited technician ticket."),
    ("Ticket resolution quality checklist", "procedures", "ticket,documentation,quality", "Close tickets with customer-ready notes, time, assets, and follow-up actions."),
    ("Escalation handover checklist", "procedures", "escalation,ticket,service-desk", "Hand over unresolved work with enough context for the next technician."),
    ("Client critical alert acknowledgement", "procedures", "client-alert,acknowledgement,compliance", "Acknowledge client-specific critical notes and record technician awareness."),
    ("Password manager access request", "security", "passwords,access,security", "Request and grant privileged credentials with auditable approval."),
    ("Conditional Access troubleshooting", "security", "conditional-access,entra-id,microsoft-365", "Identify the policy and signal causing a Conditional Access block."),
    ("Email quarantine release process", "email", "email,quarantine,microsoft-defender", "Review and release quarantined messages without bypassing security controls."),
    ("Configure email signature", "email", "email,signature,outlook", "Apply the technician's approved rich signature to outgoing correspondence."),
    ("Mobile device email setup", "email", "mobile,microsoft-365,outlook", "Set up managed mobile email while meeting the customer's security policy."),
    ("Document a client network", "network", "documentation,network,client", "Capture a supportable network record including diagrams, IP ranges, and credentials references."),
    ("Monthly patch compliance review", "procedures", "patching,compliance,reporting", "Review patch status, exceptions, and remediation work before client reporting."),
    ("Security incident initial response", "security", "incident-response,security,containment", "Contain, preserve, communicate, and escalate a suspected security incident."),
    ("New client onboarding discovery", "onboarding", "client,onboarding,discovery", "Collect the assets, contacts, access, risks, and service commitments needed to support a new client."),
    ("Configure a Microsoft 365 shared mailbox", "email", "shared-mailbox,microsoft-365,outlook", "Assign approved access, add the mailbox, and validate send-as behaviour."),
]


def _starter_article(index: int, title: str, category: str, tags: str, summary: str):
    return {
        "id": f"starter-kb-{index:02d}", "title": title, "category": category,
        "tags": [tag.strip() for tag in tags.split(",")], "is_public": False, "is_pinned": index <= 5,
        "summary": summary, "content_format": "html", "source": "nexus_starter_library",
        "content": f"<h2>Purpose</h2><p>{summary}</p><h2>Before you begin</h2><ul><li>Confirm the requester and client.</li><li>Review the relevant ticket, device, and client notes.</li><li>Record approval before making a material change.</li></ul><h2>Procedure</h2><ol><li>Capture the reported symptoms and current state.</li><li>Apply the approved troubleshooting or change process.</li><li>Test the outcome with the user or monitoring data.</li></ol><h2>Validation &amp; ticket notes</h2><p>Record actions taken, result, affected asset, and any follow-up work. Escalate when the documented scope or risk is exceeded.</p>",
        "images": [], "related_links": [], "views": 0, "helpful_count": 0, "usefulness_score": 0,
        "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/kb/articles")
async def get_articles(current_user: dict = Depends(get_current_user)):
    articles = await db.kb_articles.find({}, {"_id": 0}).sort("usefulness_score", -1).to_list(200)
    return articles


@router.get("/kb/search")
async def search_kb(q: str = "", current_user: dict = Depends(get_current_user)):
    if not q:
        return []
    words = q.lower().split()
    articles = await db.kb_articles.find({}, {"_id": 0}).to_list(500)
    scored = []
    for a in articles:
        text = f"{a.get('title','')} {a.get('content','')} {' '.join(a.get('tags',[]))}".lower()
        score = sum(1 for w in words if w in text)
        if score > 0:
            scored.append({**a, "relevance_score": score})
    scored.sort(key=lambda x: x["relevance_score"], reverse=True)
    return scored[:10]


@router.get("/kb/articles/{article_id}")
async def get_article(article_id: str, current_user: dict = Depends(get_current_user)):
    article = await db.kb_articles.find_one({"id": article_id}, {"_id": 0})
    if not article:
        return {"error": "Article not found"}
    await db.kb_articles.update_one({"id": article_id}, {"$inc": {"views": 1}})
    return article


@router.post("/kb/articles")
async def create_article(data: dict, current_user: dict = Depends(get_current_user)):
    article_id = str(uuid.uuid4())[:8]
    doc = {
        "id": article_id, "title": data.get("title", ""), "content": data.get("content", ""),
        "category": data.get("category", "general"), "tags": data.get("tags", []),
        "summary": data.get("summary", ""), "content_format": data.get("content_format", "html"),
        "images": data.get("images", []), "related_links": data.get("related_links", []),
        "is_public": data.get("is_public", False), "is_pinned": data.get("is_pinned", False),
        "source": "manual", "source_ticket_id": data.get("ticket_id"),
        "views": 0, "usefulness_score": 0, "helpful_votes": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
    }
    await db.kb_articles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/kb/articles/{article_id}")
async def update_article(article_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"title", "content", "category", "tags", "summary", "content_format", "images", "related_links", "is_public", "is_pinned"}
    changes = {key: value for key, value in data.items() if key in allowed}
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.kb_articles.update_one({"id": article_id}, {"$set": changes})
    if not result.matched_count:
        return {"error": "Article not found"}
    return await db.kb_articles.find_one({"id": article_id}, {"_id": 0})


@router.post("/kb/articles/install-technician-library")
async def install_technician_library(current_user: dict = Depends(get_current_user)):
    installed = 0
    for index, entry in enumerate(TECHNICIAN_LIBRARY, start=1):
        article = _starter_article(index, *entry)
        result = await db.kb_articles.update_one({"id": article["id"]}, {"$setOnInsert": article}, upsert=True)
        installed += int(result.upserted_id is not None)
    return {"message": f"Technician starter library ready ({installed} articles added)", "installed": installed, "total": len(TECHNICIAN_LIBRARY)}


@router.post("/kb/generate-from-ticket/{ticket_id}")
async def generate_from_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        return {"error": "Ticket not found"}
    notes = ticket.get("notes", [])
    notes_text = "\n".join([f"- {n.get('text', '')}" for n in notes]) if notes else "No notes"
    system = """You are an IT knowledge base writer. Given a resolved support ticket, create a concise KB article.
Return ONLY valid JSON: {"title": "clear title", "content": "## Problem\\n...\\n## Solution\\n...\\n## Prevention\\n...", "category": "hardware|software|network|security|cloud|other", "tags": ["tag1","tag2"]}"""
    try:
        from app.services.ai_provider import LlmChat, UserMessage
        api_key = os.environ.get("OPENAI_API_KEY")
        chat = LlmChat(api_key=api_key, session_id=f"kb-{uuid.uuid4().hex[:6]}", system_message=system)
        chat.with_model("openai", "gpt-5.6-terra")
        prompt = f"Ticket: {ticket.get('title','')}\nPriority: {ticket.get('priority','')}\nCategory: {ticket.get('category','')}\nDescription: {ticket.get('description','')}\nNotes:\n{notes_text}"
        resp = await chat.send_message(UserMessage(text=prompt))
        text = resp.strip() if isinstance(resp, str) else str(resp)
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
    except Exception:
        result = {"title": f"Solution: {ticket.get('title','')}", "content": f"## Problem\n{ticket.get('description','')}\n\n## Solution\nRefer to ticket notes.", "category": ticket.get("category","general"), "tags": []}
    article_id = str(uuid.uuid4())[:8]
    doc = {"id": article_id, **result, "source": "ai_generated", "source_ticket_id": ticket_id,
           "source_ticket_title": ticket.get("title",""), "views": 0, "usefulness_score": 0, "helpful_votes": 0,
           "created_at": datetime.now(timezone.utc).isoformat(), "created_by": current_user.get("name","")}
    await db.kb_articles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/kb/articles/{article_id}/vote")
async def vote_article(article_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    helpful = data.get("helpful", True)
    await db.kb_articles.update_one({"id": article_id}, {"$inc": {"helpful_votes": 1, "usefulness_score": 1 if helpful else -1}})
    return {"message": "Vote recorded"}


@router.post("/kb/articles/{article_id}/helpful")
async def mark_article_helpful(article_id: str, current_user: dict = Depends(get_current_user)):
    await db.kb_articles.update_one({"id": article_id}, {"$inc": {"helpful_count": 1, "helpful_votes": 1, "usefulness_score": 1}})
    return {"message": "Helpful vote recorded"}


@router.delete("/kb/articles/{article_id}")
async def delete_article(article_id: str, current_user: dict = Depends(get_current_user)):
    await db.kb_articles.delete_one({"id": article_id})
    return {"message": "Deleted"}
