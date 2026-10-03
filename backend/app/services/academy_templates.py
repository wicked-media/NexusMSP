"""Rich, customisable Academy course templates modelled on MSP training programs.

The structure and topic coverage follow how leading MSP training programs are
organised: story-driven security-awareness episodes with knowledge checks
(Huntress Managed SAT style) and role-based capability tracks (ConnectWise
Certify style: client onboarding, service desk ticketing, patch management,
endpoint management, billing reconciliation).

Templates are authoring starting points. Instantiating one creates a normal
draft course that admins can rewrite, extend, re-assess and publish through
the Course Studio, so every template is fully customisable.
"""

from __future__ import annotations

from typing import Any

TRACK_SECURITY = "Security awareness"
TRACK_CAPABILITY = "MSP capability"

COURSE_TEMPLATES: tuple[dict[str, Any], ...] = (
    {
        "id": "sat-phishing-essentials",
        "name": "Phishing & Social Engineering Essentials",
        "track": TRACK_SECURITY,
        "category": "security_awareness",
        "tagline": "Recognise, verify and report the human-layer attacks your service desk sees every week.",
        "difficulty": "Foundation",
        "roles": ["All staff", "Service desk", "Field engineers"],
        "estimated_minutes": 25,
        "required": True,
        "passing_score": 80,
        "inspired_by": "Story-driven SAT episodes (Huntress Managed SAT style)",
        "modules": [
            {
                "title": "Why the human layer is targeted",
                "body": (
                    "Attackers rarely break in — they log in. A convincing email, a familiar login page "
                    "or a polite phone call can move a password, an approval or a payment faster than any "
                    "exploit. In managed services the stakes are multiplied: one reused technician "
                    "credential can open many customer environments. This module uses short, realistic "
                    "stories to show how phishing, smishing, vishing and pretexting arrive in a normal "
                    "working day, and why a 30-second verification habit beats any single tool."
                ),
            },
            {
                "title": "Reading the message: the six red flags",
                "body": (
                    "1. Unexpected urgency or consequences. 2. Requests to bypass a process (gift cards, "
                    "wire changes, quiet approvals). 3. Mismatched or look-alike domains. 4. Attachments "
                    "or links you did not ask for. 5. Sender display name that does not match the reply-to. "
                    "6. Requests for credentials, MFA codes or remote access. Practise spotting all six in "
                    "sample messages. When two or more appear, stop and verify through a known channel — "
                    "never the contact details in the suspicious message."
                ),
            },
            {
                "title": "Verification habits that actually work",
                "body": (
                    "Verify out-of-band: call the person on a number from the directory or the client "
                    "record, not the email. For customer requests, confirm inside the ticket or portal "
                    "rather than a fresh email thread. For payment or detail changes, require dual "
                    "control — a second person confirms before anything moves. Never share MFA codes; "
                    "no legitimate provider, including your own service desk, will ever ask for them. "
                    "If a message pretends to be an executive after hours, that is exactly when you slow "
                    "down and verify."
                ),
            },
            {
                "title": "Reporting fast without blame",
                "body": (
                    "A reported phish in the first five minutes is a contained incident; a clicked link "
                    "hidden out of embarrassment is a breach. Report through the agreed channel "
                    "immediately — include the message, what you clicked (if anything) and when. Nobody "
                    "is punished for reporting. The service desk logs the indicator, checks for other "
                    "recipients and escalates per the incident process. Reporting is the metric that "
                    "matters, not click rate."
                ),
            },
        ],
        "assessment": [
            {
                "id": "sat-phish-q1",
                "prompt": "An email from the 'CEO' asks you to buy gift cards quietly within the hour. What is the correct first action?",
                "options": [
                    "Buy the cards and claim them later",
                    "Reply to the email to confirm it is really the CEO",
                    "Verify the request out-of-band through a known number, then report the message",
                    "Forward the email to a colleague for a second opinion",
                ],
                "correct_option": 2,
            },
            {
                "id": "sat-phish-q2",
                "prompt": "Which combination is the strongest signal that a login page is fake?",
                "options": [
                    "The page loads slowly",
                    "The domain is a look-alike and the message created urgency to sign in now",
                    "The page has a company logo",
                    "The email arrived during business hours",
                ],
                "correct_option": 1,
            },
            {
                "id": "sat-phish-q3",
                "prompt": "A caller says they are from your bank and asks for an SMS code to 'stop fraud'. What do you do?",
                "options": [
                    "Provide the code only if they know your name",
                    "Refuse, hang up, and call the bank on the number on your card",
                    "Provide the code and monitor the account",
                    "Transfer the call to a colleague",
                ],
                "correct_option": 1,
            },
            {
                "id": "sat-phish-q4",
                "prompt": "You clicked a suspicious link an hour ago and nothing happened. What is the right move?",
                "options": [
                    "Wait to see if anything suspicious occurs",
                    "Report it immediately with what you clicked and when",
                    "Delete the email and move on",
                    "Run a personal antivirus scan and say nothing",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "sat-ransomware-defence",
        "name": "Ransomware Defence Habits",
        "track": TRACK_SECURITY,
        "category": "security_awareness",
        "tagline": "The everyday habits that stop ransomware from becoming an outage.",
        "difficulty": "Foundation",
        "roles": ["All staff", "Service desk", "Field engineers"],
        "estimated_minutes": 20,
        "required": True,
        "passing_score": 80,
        "inspired_by": "Managed SAT topic set: ransomware, safe browsing, physical security",
        "modules": [
            {
                "title": "How ransomware actually arrives",
                "body": (
                    "Almost every ransomware case starts with ordinary access: a phished credential, a "
                    "malvertising download, an unpatched edge device or a remote-access tool left exposed. "
                    "The encryption stage is last. Understanding the chain — initial access, credential "
                    "theft, lateral movement, then encryption — shows why blocking the first step and "
                    "slowing the second protects both our customers and us."
                ),
            },
            {
                "title": "Everyday controls that break the chain",
                "body": (
                    "Keep MFA on every remote-access path. Never disable endpoint protection 'just for "
                    "a minute'. Install updates through managed tooling only. Do not run unknown installers "
                    "on managed endpoints — open a ticket instead. Keep customer data in approved systems, "
                    "not local drives or personal cloud storage. And treat backups as the last line: verify "
                    "them, do not map them to daily workstations."
                ),
            },
            {
                "title": "When you suspect ransomware: the first ten minutes",
                "body": (
                    "Stop using the machine but do not power it off — memory and logs are evidence. "
                    "Disconnect it from the network if you can do so safely. Report immediately to the "
                    "on-call path with device, time and what you observed. Do not reconnect, do not pay, "
                    "do not negotiate, and do not communicate with the attacker. Early containment is "
                    "worth more than any post-incident tool."
                ),
            },
        ],
        "assessment": [
            {
                "id": "sat-ransom-q1",
                "prompt": "A workstation shows a ransom note. What is the correct first action?",
                "options": [
                    "Power the machine off to stop the damage",
                    "Disconnect it from the network if safe, leave it on, and report immediately",
                    "Try restoring files from the mapped backup drive",
                    "Reply to the note to negotiate",
                ],
                "correct_option": 1,
            },
            {
                "id": "sat-ransom-q2",
                "prompt": "Which everyday habit most directly breaks the ransomware chain?",
                "options": [
                    "Keeping endpoint protection disabled during large file transfers",
                    "MFA on every remote-access path and updates through managed tooling",
                    "Storing customer exports on a personal USB drive",
                    "Reusing one strong password across admin portals",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "sat-password-mfa",
        "name": "Password & MFA Hygiene for Technicians",
        "track": TRACK_SECURITY,
        "category": "security_awareness",
        "tagline": "Credential discipline for people who hold keys to many customer environments.",
        "difficulty": "Foundation",
        "roles": ["All staff", "Service desk", "Field engineers", "Account managers"],
        "estimated_minutes": 15,
        "required": True,
        "passing_score": 80,
        "inspired_by": "Managed SAT topic set: password security, social engineering",
        "modules": [
            {
                "title": "One credential, many doors",
                "body": (
                    "Technician credentials are high-value because they unlock many customers at once. "
                    "That is why unique passwords per system, a managed password vault and phishing-"
                    "resistant MFA are not optional hygiene — they are the difference between one "
                    "incident and a portfolio-wide incident. Never store credentials in tickets, chats, "
                    "scripts or spreadsheets; the vault exists for exactly this."
                ),
            },
            {
                "title": "MFA done properly",
                "body": (
                    "Prefer authenticator push-with-number or hardware keys over SMS. Never approve an "
                    "MFA prompt you did not trigger — deny it and report it; that prompt is an attack in "
                    "progress. Never share codes, even with 'support'. For admin and customer tenants, "
                    "use the assigned admin account with its own MFA, not a shared mailbox trick."
                ),
            },
            {
                "title": "Access that matches the job",
                "body": (
                    "Request the access you need for the task at hand and nothing more, use it inside "
                    "the approved session, and let elevation expire naturally. Customer trust is built "
                    "on knowing exactly who touched what and why — the audit trail is only as good as "
                    "your credential discipline."
                ),
            },
        ],
        "assessment": [
            {
                "id": "sat-pw-q1",
                "prompt": "An MFA push arrives that you did not trigger. What do you do?",
                "options": [
                    "Approve it so the alert goes away",
                    "Deny it and report it — it likely means your password is compromised",
                    "Ignore it and it will time out",
                    "Forward it to a colleague to check",
                ],
                "correct_option": 1,
            },
            {
                "id": "sat-pw-q2",
                "prompt": "Where must customer and admin credentials live?",
                "options": [
                    "In the ticket for easy access",
                    "In the managed password vault only",
                    "In a private spreadsheet with a strong file password",
                    "In a chat message to yourself",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "sat-incident-reporting",
        "name": "Incident Reporting & Escalation Drills",
        "track": TRACK_SECURITY,
        "category": "security_awareness",
        "tagline": "Turn 'I think something is wrong' into a fast, auditable first response.",
        "difficulty": "Intermediate",
        "roles": ["Service desk", "Field engineers", "NOC / SOC", "Team leads"],
        "estimated_minutes": 20,
        "required": False,
        "passing_score": 80,
        "inspired_by": "Managed SAT phishing-simulation reporting programs",
        "modules": [
            {
                "title": "What to report, and how fast",
                "body": (
                    "Report immediately: successful phishing clicks, unexpected MFA prompts, unknown "
                    "software, ransom notes, unusual outbound traffic, lost devices and any request to "
                    "bypass security process. Speed beats certainty — you are not required to diagnose "
                    "before reporting. Include who, what, when, which device or tenant, and anything you "
                    "already clicked or changed."
                ),
            },
            {
                "title": "The escalation ladder",
                "body": (
                    "Each incident class has a named owner and a clock. Security suspicions go to the "
                    "on-call security path; customer-impacting outages follow the normal incident "
                    "process; suspected insider issues go directly to leadership. If you are unsure "
                    "which ladder applies, escalate to the highest one — a quiet downgrade is the only "
                    "wrong answer."
                ),
            },
            {
                "title": "Evidence discipline",
                "body": (
                    "Preserve before you clean: keep the machine on, capture times and messages, and "
                    "record actions in the ticket as you take them. Do not delete suspicious mail from "
                    "shared mailboxes before it is captured, and never 'fix' a compromised account by "
                    "simply resetting the password without reporting it."
                ),
            },
        ],
        "assessment": [
            {
                "id": "sat-incident-q1",
                "prompt": "You clicked a phishing link but nothing seems wrong yet. When should you report?",
                "options": [
                    "After you confirm something bad happened",
                    "Immediately — speed beats certainty",
                    "At the end of the shift",
                    "Only if credentials were definitely entered",
                ],
                "correct_option": 1,
            },
            {
                "id": "sat-incident-q2",
                "prompt": "What is the correct evidence habit during a suspected compromise?",
                "options": [
                    "Clean the machine first, then report",
                    "Preserve state, capture times and actions, then report through the escalation ladder",
                    "Delete the suspicious messages to protect the mailbox",
                    "Reset the password and close the alert",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "cap-client-onboarding",
        "name": "Client Onboarding Foundations",
        "track": TRACK_CAPABILITY,
        "category": "academy",
        "tagline": "A repeatable onboarding standard: discovery, documentation, baselines and handover.",
        "difficulty": "Foundation",
        "roles": ["Service desk", "Account managers", "Onboarding engineers"],
        "estimated_minutes": 30,
        "required": False,
        "passing_score": 70,
        "inspired_by": "ConnectWise Certify capability tracks (Client Onboarding)",
        "modules": [
            {
                "title": "Discovery before tooling",
                "body": (
                    "Good onboarding starts with evidence, not agents. Capture the estate: users and "
                    "roles, devices and servers, network and cloud services, line-of-business "
                    "applications, backup posture and existing vendor agreements. Record who owns what "
                    "decision. Anything not discovered becomes an incident later, so treat the discovery "
                    "checklist as the contract for the first 30 days."
                ),
            },
            {
                "title": "Baselines and standards",
                "body": (
                    "Apply the agreed baselines: naming conventions, MFA, endpoint protection, patching "
                    "policy, backup jobs and monitoring thresholds. Every deviation from standard must "
                    "be recorded with a reason — 'legacy app requires local admin' is a valid record; a "
                    "silent deviation is not. Baselines are what make the 50th customer as safe as the "
                    "first."
                ),
            },
            {
                "title": "Documentation and handover",
                "body": (
                    "Before handover, the customer record must hold: contacts and escalation paths, "
                    "network diagram, admin credentials in the vault, licence and warranty records, and "
                    "the runbook for their critical application. Handover includes a service review "
                    "meeting where the service desk introduces the ticket process and the customer "
                    "confirms the escalation path."
                ),
            },
            {
                "title": "The first 90 days",
                "body": (
                    "Schedule the follow-ups now: a 2-week health check, a 30-day service review and a "
                    "90-day optimisation review. Watch early signals — ticket volume by category, backup "
                    "failures and patch compliance — and raise trends to the account manager before the "
                    "customer raises them for you."
                ),
            },
        ],
        "assessment": [
            {
                "id": "cap-onboard-q1",
                "prompt": "A customer's legacy application requires local admin rights. What is the correct handling?",
                "options": [
                    "Silently grant local admin to keep things moving",
                    "Record the deviation with a reason and an agreed review date",
                    "Refuse to onboard the application",
                    "Remove the application during onboarding",
                ],
                "correct_option": 1,
            },
            {
                "id": "cap-onboard-q2",
                "prompt": "Which item must exist before onboarding handover is complete?",
                "options": [
                    "A signed marketing case study",
                    "Admin credentials stored in the vault and the critical-app runbook",
                    "A completed hardware order",
                    "An invoice for the onboarding project",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "cap-service-desk-triage",
        "name": "Service Desk Ticketing & Triage",
        "track": TRACK_CAPABILITY,
        "category": "academy",
        "tagline": "Triage, prioritise, communicate and close — the rhythm of a reliable service desk.",
        "difficulty": "Foundation",
        "roles": ["Service desk", "NOC / SOC", "Field engineers"],
        "estimated_minutes": 30,
        "required": True,
        "passing_score": 70,
        "inspired_by": "ConnectWise Certify capability tracks (Service Desk Ticketing, Ticket Triage)",
        "modules": [
            {
                "title": "Triage in five minutes",
                "body": (
                    "Every ticket answers four questions on arrival: who is impacted and how many, what "
                    "changed, what is the business effect, and is there a workaround. Classify category "
                    "and impact honestly — inflating priority to 'get attention' destroys the queue for "
                    "everyone. If impact is unclear, make one clarifying contact before escalating."
                ),
            },
            {
                "title": "Priority that means something",
                "body": (
                    "Priority combines impact (how many users / how critical) and urgency (is work "
                    "stopped). A single user down is normal; a whole site or a line-of-business server "
                    "down is major. Document the reasoning in the ticket — the next technician and the "
                    "SLA report both depend on it."
                ),
            },
            {
                "title": "Communication that prevents callbacks",
                "body": (
                    "First response acknowledges, sets expectation and states the next step with a time. "
                    "Update at the promised time even when the update is 'still working'. Write in plain "
                    "language, avoid unexplained jargon, and always say what the customer should do (or "
                    "not do) next. Most 'angry customer' tickets are communication gaps, not technical "
                    "failures."
                ),
            },
            {
                "title": "Closing with evidence",
                "body": (
                    "A close note records cause, fix and verification — for the next technician and for "
                    "the customer's records. Link related tickets instead of duplicating work. If the "
                    "fix created a new risk (a temporary exclusion, a borrowed licence), raise that as "
                    "follow-up work before closing, not after."
                ),
            },
        ],
        "assessment": [
            {
                "id": "cap-triage-q1",
                "prompt": "A ticket arrives with no impact description. What is the best first move?",
                "options": [
                    "Assume high priority to be safe",
                    "Make one clarifying contact to establish impact and urgency before escalating",
                    "Close the ticket and ask the user to resubmit",
                    "Assign it to the newest technician",
                ],
                "correct_option": 1,
            },
            {
                "id": "cap-triage-q2",
                "prompt": "What must a good close note contain?",
                "options": [
                    "Only the resolution code",
                    "Cause, fix and verification, plus any follow-up risks raised",
                    "The full remote-session log",
                    "The customer's satisfaction score",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "cap-patch-management",
        "name": "Patch Management Discipline",
        "track": TRACK_CAPABILITY,
        "category": "academy",
        "tagline": "Rings, maintenance windows, exceptions and proof — patching as a managed service.",
        "difficulty": "Intermediate",
        "roles": ["NOC / SOC", "Service desk", "Onboarding engineers"],
        "estimated_minutes": 25,
        "required": False,
        "passing_score": 70,
        "inspired_by": "ConnectWise Certify capability tracks (Patch Management, Endpoint Management)",
        "modules": [
            {
                "title": "Rings and maintenance windows",
                "body": (
                    "Patch in rings: pilot first, then broad, then the stragglers with fragile line-of-"
                    "business apps. Agree maintenance windows per customer and record them; an unexpected "
                    "reboot at 2pm is how patching loses its social licence. Critical out-of-band "
                    "patches follow the emergency change path with the same evidence discipline."
                ),
            },
            {
                "title": "Exceptions with a name and a date",
                "body": (
                    "Every deferral is a risk entry: what was deferred, why, who approved it and the "
                    "review date. 'Deferred until the app vendor confirms' is acceptable indefinitely "
                    "only if the compensating control (network isolation, application control) is in "
                    "place and verified."
                ),
            },
            {
                "title": "Proving compliance",
                "body": (
                    "Compliance is measured per ring and per customer, not by 'the tool said it pushed'. "
                    "Reboot-pending and failed-install states are the real story. Review the exception "
                    "report monthly with the account manager so patch posture is visible before an "
                    "audit or an incident makes it visible for you."
                ),
            },
        ],
        "assessment": [
            {
                "id": "cap-patch-q1",
                "prompt": "A line-of-business app cannot take the June updates yet. What is required?",
                "options": [
                    "Nothing — just skip them quietly",
                    "A risk entry with approver, reason, review date and a compensating control",
                    "A note in the team chat",
                    "Removal of the machine from monitoring",
                ],
                "correct_option": 1,
            },
            {
                "id": "cap-patch-q2",
                "prompt": "What is the correct measure of patch compliance?",
                "options": [
                    "The management tool reports the patches were pushed",
                    "Per-ring install and reboot state, with failed and pending machines visible",
                    "The number of maintenance windows scheduled",
                    "The age of the newest patch",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "cap-billing-reconciliation",
        "name": "Billing Reconciliation Basics",
        "track": TRACK_CAPABILITY,
        "category": "academy",
        "tagline": "Accurate invoices, clean reconciliations and auditable payment follow-up.",
        "difficulty": "Intermediate",
        "roles": ["Account managers", "Service desk", "Finance admin"],
        "estimated_minutes": 25,
        "required": False,
        "passing_score": 70,
        "inspired_by": "ConnectWise Certify capability tracks (Billing Reconciliation)",
        "modules": [
            {
                "title": "Where billing data comes from",
                "body": (
                    "Invoices assemble from agreements, recurring services, approved time and product "
                    "sales. Every figure on an invoice must trace back to one of those sources — if a "
                    "line cannot be explained to the customer in one sentence, it should not be billed. "
                    "Changes to billing-relevant records (contracts, rates, licences) happen before the "
                    "billing run, never silently inside it."
                ),
            },
            {
                "title": "The reconciliation loop",
                "body": (
                    "Daily: record payments against invoices with a real reference (terminal receipt, "
                    "bank reference, Xero match). Weekly: clear the exception queue — unallocated "
                    "payments, disputed lines, missing purchase orders. Monthly: settle the batches and "
                    "confirm the ledger matches the bank feed before the reporting pack goes out."
                ),
            },
            {
                "title": "Following up on late payment",
                "body": (
                    "Follow-up is automated and graduated: courteous reminders before the due date, "
                    "firm follow-up after, and account action only by agreement with the account "
                    "manager. Record every contact and promise-to-pay in the system — disputes are won "
                    "with records, not memory."
                ),
            },
        ],
        "assessment": [
            {
                "id": "cap-billing-q1",
                "prompt": "A customer disputes a line item that nobody on the team can explain. What should have happened?",
                "options": [
                    "The line should not have been billed — every line must trace to an approved source",
                    "The line should have been larger so it was noticed sooner",
                    "The dispute should have been refused",
                    "The invoice should have been paid first and discussed later",
                ],
                "correct_option": 0,
            },
            {
                "id": "cap-billing-q2",
                "prompt": "What makes a recorded payment auditable?",
                "options": [
                    "The amount alone",
                    "The amount plus a real reference (receipt, bank reference or Xero match)",
                    "The customer's verbal confirmation",
                    "A note in the team chat",
                ],
                "correct_option": 1,
            },
        ],
    },
)


def template_catalogue() -> list[dict[str, Any]]:
    """Public view of the template library (no course content)."""
    return [
        {
            "id": template["id"],
            "name": template["name"],
            "track": template["track"],
            "category": template["category"],
            "tagline": template["tagline"],
            "difficulty": template["difficulty"],
            "roles": template["roles"],
            "estimated_minutes": template["estimated_minutes"],
            "required": template["required"],
            "passing_score": template["passing_score"],
            "inspired_by": template["inspired_by"],
            "module_count": len(template["modules"]),
            "assessment_count": len(template["assessment"]),
        }
        for template in COURSE_TEMPLATES
    ]


def get_template(template_id: str) -> dict[str, Any] | None:
    for template in COURSE_TEMPLATES:
        if template["id"] == template_id:
            return template
    return None


def template_preview(template_id: str) -> dict[str, Any] | None:
    """Full template detail for the preview dialog, including module outlines."""
    template = get_template(template_id)
    if not template:
        return None
    return {
        **{key: value for key, value in template.items() if key not in {"modules", "assessment"}},
        "modules": [{"title": module["title"], "body": module["body"]} for module in template["modules"]],
        "assessment_prompts": [question["prompt"] for question in template["assessment"]],
    }


def template_as_course(template_id: str, overrides: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Build CourseInput-shaped data from a template with optional overrides."""
    template = get_template(template_id)
    if not template:
        return None
    overrides = overrides or {}
    return {
        "title": str(overrides.get("title") or template["name"]).strip()[:180],
        "description": str(overrides.get("description") or template["tagline"])[:3000],
        "category": template["category"],
        "content": "\n\n".join(f"{module['title']}\n{module['body']}" for module in template["modules"]),
        "estimated_minutes": int(overrides.get("estimated_minutes") or template["estimated_minutes"]),
        "required": bool(overrides.get("required", template["required"])),
        "published": False,
        "archived": False,
        "assessment": template["assessment"],
        "passing_score": int(overrides.get("passing_score") or template["passing_score"]),
    }
