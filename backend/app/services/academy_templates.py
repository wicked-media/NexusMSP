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
TRACK_OPERATIONS = "Operations & safety"
TRACK_CUSTOMER = "Customer & communication"

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
    {
        "id": "ops-backup-dr",
        "name": "Backup & Disaster Recovery Fundamentals",
        "track": TRACK_OPERATIONS,
        "category": "academy",
        "tagline": "Backups are a promise. Recovery is the proof. Learn to plan, verify and evidence real recoveries.",
        "difficulty": "Foundation",
        "roles": ["Service desk", "Field engineers", "System administrators"],
        "estimated_minutes": 30,
        "required": True,
        "passing_score": 80,
        "inspired_by": "MSP backup & DR certification tracks",
        "modules": [
            {
                "title": "RPO, RTO and why the business cares",
                "body": (
                    "Recovery Point Objective (RPO) is how much data you can afford to lose, measured in time: a 4-hour RPO "
                    "means the business accepts losing up to four hours of work. Recovery Time Objective (RTO) is how quickly "
                    "a service must be back. Never guess these — confirm them with the client and record them, because they drive "
                    "the entire backup design and the cost of the solution."
                ),
            },
            {
                "title": "The 3-2-1 rule and restore verification",
                "body": (
                    "Keep three copies of data, on two media types, with one offsite or immutable. But a backup you have never "
                    "restored is a hypothesis, not a backup. Schedule restore tests, capture the evidence (what was restored, how "
                    "long it took, what was verified), and treat an unverified restore exactly as Nexus does: unverified, never 'protected'."
                ),
            },
            {
                "title": "Running a recovery calmly",
                "body": (
                    "During a real recovery: confirm the scope and the recovery point first, communicate an honest ETA early, restore "
                    "in a planned order (identity and core services before peripherals), verify the application actually works, and only "
                    "then close. Preserve evidence throughout — insurers and customers will ask what happened and what you did."
                ),
            },
        ],
        "assessment": [
            {
                "id": "ops-backup-q1",
                "prompt": "A client says they can lose at most 1 hour of work in a failure. What is that describing?",
                "options": ["Recovery Time Objective", "Recovery Point Objective", "The backup window", "The retention period"],
                "correct_option": 1,
            },
            {
                "id": "ops-backup-q2",
                "prompt": "A nightly backup job reports success but nobody has restored it in a year. What is the honest status?",
                "options": [
                    "Protected — the job succeeded",
                    "Unverified — a restore has not been proven",
                    "Failed — the data is gone",
                    "Compliant — it meets policy",
                ],
                "correct_option": 1,
            },
            {
                "id": "ops-backup-q3",
                "prompt": "In a recovery, what should happen before you tell the customer a firm ETA?",
                "options": [
                    "Promise the fastest possible time to reassure them",
                    "Confirm the recovery point and scope so the ETA is honest",
                    "Wait until everything is finished",
                    "Escalate immediately to a manager",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "ops-documentation",
        "name": "Documentation & Living Runbooks",
        "track": TRACK_OPERATIONS,
        "category": "academy",
        "tagline": "Documentation that is never tested is a liability. Write records the next technician can trust.",
        "difficulty": "Foundation",
        "roles": ["All staff", "Service desk", "System administrators"],
        "estimated_minutes": 20,
        "required": False,
        "passing_score": 75,
        "inspired_by": "IT documentation platforms & runbook practice",
        "modules": [
            {
                "title": "Write for the next technician",
                "body": (
                    "Good documentation assumes the reader is competent, in a hurry, and has no context. Record the why, not just the "
                    "clicks: what the system does, why it is configured this way, what depends on it, and what breaks if it changes. "
                    "Prefer stable identifiers (device, client, service IDs) over names that can be renamed."
                ),
            },
            {
                "title": "Provenance and freshness",
                "body": (
                    "Every fact has a source and an age. A serial number read from live BIOS is high-confidence and recent; a rack "
                    "location typed three years ago decays. Note when something was last verified and where the truth came from, so "
                    "Nexus and your colleagues can weigh it honestly instead of treating stale notes as fact."
                ),
            },
            {
                "title": "Test the runbook, not the prose",
                "body": (
                    "A runbook is only real if it still works. Periodically re-run what is safe to re-run: does the service it restarts "
                    "still exist? Is the URL still valid? Does the escalation contact still work? A runbook that references retired systems "
                    "is worse than none, because it creates false confidence."
                ),
            },
        ],
        "assessment": [
            {
                "id": "ops-doc-q1",
                "prompt": "What is the most useful thing to record about a configuration choice?",
                "options": [
                    "Only the setting value",
                    "The value, the reason it was chosen, and what depends on it",
                    "The name of whoever set it",
                    "Nothing — the system shows the current value",
                ],
                "correct_option": 1,
            },
            {
                "id": "ops-doc-q2",
                "prompt": "A documented firewall rule was last verified two years ago. How should it be treated?",
                "options": [
                    "As accurate until proven otherwise",
                    "As decayed knowledge to re-verify before relying on it",
                    "As deleted",
                    "As a compliance failure",
                ],
                "correct_option": 1,
            },
            {
                "id": "ops-doc-q3",
                "prompt": "A runbook tells you to restart Service X, which no longer exists. What does this indicate?",
                "options": [
                    "The runbook is stale and must be corrected",
                    "The service will come back later",
                    "You should restart a different service instead",
                    "Nothing — documentation is advisory",
                ],
                "correct_option": 0,
            },
        ],
    },
    {
        "id": "ops-change-management",
        "name": "Change Management Without Fear",
        "track": TRACK_OPERATIONS,
        "category": "academy",
        "tagline": "Changes are where outages come from. Make them boring, reversible and evidenced.",
        "difficulty": "Intermediate",
        "roles": ["Field engineers", "System administrators", "Project engineers"],
        "estimated_minutes": 25,
        "required": False,
        "passing_score": 80,
        "inspired_by": "ITIL change practice, simplified for MSPs",
        "modules": [
            {
                "title": "Classify the change honestly",
                "body": (
                    "Standard changes are low-risk and pre-approved (adding a user). Normal changes need review (upgrading a firewall). "
                    "Emergency changes skip review but demand immediate after-the-fact evidence. Misclassifying a risky change as standard "
                    "is how outages happen — when unsure, raise the category."
                ),
            },
            {
                "title": "Plan the rollback first",
                "body": (
                    "Before you change anything, decide how you will undo it and what 'success' looks like. A change without a tested rollback "
                    "is a one-way door. Capture the current state first, define the verification check, and pick a maintenance window where "
                    "the blast radius is smallest."
                ),
            },
            {
                "title": "Evidence and communicate",
                "body": (
                    "Record what changed, when, by whom, why, and the verification result. Tell affected people before and after in plain "
                    "language. If a change fails, roll back first and diagnose second — restoring service beats finding root cause in the moment."
                ),
            },
        ],
        "assessment": [
            {
                "id": "ops-change-q1",
                "prompt": "You are upgrading a client's core switch during business hours. What change type is this?",
                "options": ["Standard", "Normal", "Emergency", "No change needed"],
                "correct_option": 1,
            },
            {
                "id": "ops-change-q2",
                "prompt": "A change causes an outage. What is the correct first action?",
                "options": [
                    "Find the root cause immediately",
                    "Roll back to restore service, then diagnose",
                    "Document what happened",
                    "Wait to see if it self-corrects",
                ],
                "correct_option": 1,
            },
            {
                "id": "ops-change-q3",
                "prompt": "What must exist before a risky change proceeds?",
                "options": [
                    "A rollback plan and a defined verification check",
                    "A customer email",
                    "A manager's verbal approval only",
                    "A completed ticket",
                ],
                "correct_option": 0,
            },
        ],
    },
    {
        "id": "cust-remote-support",
        "name": "Remote Support Etiquette & Safety",
        "track": TRACK_CUSTOMER,
        "category": "academy",
        "tagline": "You are a guest on someone's screen. Earn the trust, protect the data, leave no trace.",
        "difficulty": "Foundation",
        "roles": ["Service desk", "Field engineers"],
        "estimated_minutes": 20,
        "required": True,
        "passing_score": 80,
        "inspired_by": "Managed service remote-support standards",
        "modules": [
            {
                "title": "Consent and presence",
                "body": (
                    "Always confirm the person expects and consents to a remote session before connecting. Introduce yourself, state what you "
                    "will do, and ask before opening personal files or closing their applications. If the user steps away, pause rather than "
                    "operating unseen on their desktop."
                ),
            },
            {
                "title": "Session hygiene",
                "body": (
                    "Use named, audited accounts — never shared credentials. Do not copy customer data to your own machine or leave tools, "
                    "scripts or downloaded files behind. End the session cleanly and confirm the user can work again. Every session should be "
                    "traceable to who did what and when."
                ),
            },
            {
                "title": "Communicate while you work",
                "body": (
                    "Narrate in plain language: what you are checking, what you found, what you are changing. Avoid jargon and avoid blaming the "
                    "user. If something will take time or disrupt them, say so before it happens. People forgive slow fixes; they do not forgive surprises."
                ),
            },
        ],
        "assessment": [
            {
                "id": "cust-remote-q1",
                "prompt": "Before starting a remote session, what is essential?",
                "options": [
                    "Connecting quickly to save time",
                    "Confirming the user expects and consents to the session",
                    "Asking for their password",
                    "Disabling their antivirus",
                ],
                "correct_option": 1,
            },
            {
                "id": "cust-remote-q2",
                "prompt": "Which is acceptable during a remote session?",
                "options": [
                    "Copying a customer file to your laptop for later",
                    "Leaving a diagnostic tool installed for next time",
                    "Using your named, audited account and leaving no trace",
                    "Browsing their personal documents",
                ],
                "correct_option": 2,
            },
            {
                "id": "cust-remote-q3",
                "prompt": "A fix will briefly interrupt the user's work. When should you tell them?",
                "options": [
                    "After it is done",
                    "Before it happens",
                    "Only if they ask",
                    "Never — it worries them",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "cust-communication",
        "name": "Customer Communication & Trust",
        "track": TRACK_CUSTOMER,
        "category": "academy",
        "tagline": "Technical skill gets the fix done. Communication keeps the client.",
        "difficulty": "Foundation",
        "roles": ["All staff", "Service desk", "Account managers"],
        "estimated_minutes": 22,
        "required": False,
        "passing_score": 75,
        "inspired_by": "MSP customer-experience practice",
        "modules": [
            {
                "title": "Set and re-set expectations",
                "body": (
                    "Give an honest ETA early, and update it before it lapses — even when the update is 'still working on it'. Silence makes people "
                    "assume the worst. Under-promise and over-deliver, and never promise a fix time you cannot control."
                ),
            },
            {
                "title": "Translate, do not lecture",
                "body": (
                    "Explain the impact in the customer's terms (\"your team can't email\") before the cause in yours (\"the mail relay queue is stuck\"). "
                    "Match their level of technical comfort. The goal is a confident, informed customer, not an impressed one."
                ),
            },
            {
                "title": "Saying no and saying sorry",
                "body": (
                    "When a request is out of scope or unsafe, explain the boundary and the reason, then offer what you can do. When something genuinely "
                    "went wrong, apologise plainly without excuses, state the fix and the lesson. Trust is built more by how you handle the bad days than the good."
                ),
            },
        ],
        "assessment": [
            {
                "id": "cust-comm-q1",
                "prompt": "A fix is taking longer than your original ETA. What should you do?",
                "options": [
                    "Wait until you have a final answer",
                    "Send a holding update before the ETA lapses",
                    "Say nothing to avoid worrying them",
                    "Blame a colleague",
                ],
                "correct_option": 1,
            },
            {
                "id": "cust-comm-q2",
                "prompt": "What should come first when explaining an incident to a non-technical customer?",
                "options": [
                    "The technical root cause",
                    "The impact on their work",
                    "The full log output",
                    "The vendor's name",
                ],
                "correct_option": 1,
            },
            {
                "id": "cust-comm-q3",
                "prompt": "A customer asks for something out of scope and unsafe. The best response is to…",
                "options": [
                    "Just do it to keep them happy",
                    "Explain the boundary and reason, then offer a safe alternative",
                    "Refuse with no explanation",
                    "Ignore the request",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "cap-networking-foundations",
        "name": "Networking Foundations for MSP Technicians",
        "track": TRACK_CAPABILITY,
        "category": "academy",
        "tagline": "DNS, DHCP, VLANs, subnets and VPNs — the layer where most 'it's broken' tickets really live.",
        "difficulty": "Intermediate",
        "roles": ["Field engineers", "System administrators", "Service desk"],
        "estimated_minutes": 35,
        "required": False,
        "passing_score": 80,
        "inspired_by": "Network+ / vendor networking fundamentals",
        "modules": [
            {
                "title": "Name resolution is usually the culprit",
                "body": (
                    "When something 'can't connect', check DNS first: can the name resolve, to the right address, from the right resolver? Wrong DNS "
                    "servers, stale records and split-horizon mistakes cause a huge share of connectivity tickets. Verify with a lookup before touching firewalls."
                ),
            },
            {
                "title": "Addressing, DHCP and VLANs",
                "body": (
                    "Know the subnet (what range, how big), the gateway, and which VLAN a device is on. A device on the wrong VLAN or with a stale DHCP lease "
                    "behaves exactly like a broken one. Exhausted DHCP scopes, duplicate IPs and rogue DHCP servers are common, detectable and fixable."
                ),
            },
            {
                "title": "Tracing a path",
                "body": (
                    "To find where traffic breaks, follow it: endpoint → VLAN → switch port → router → firewall → destination. Test each hop rather than guessing. "
                    "Asymmetric routing, missing routes and overlapping subnets are the usual suspects when a single site or service is unreachable."
                ),
            },
        ],
        "assessment": [
            {
                "id": "cap-net-q1",
                "prompt": "A user says a website won't load but the IP works. What is the most likely cause?",
                "options": ["Firewall outage", "DNS resolution problem", "Failed switch", "Dead hard disk"],
                "correct_option": 1,
            },
            {
                "id": "cap-net-q2",
                "prompt": "Two devices have the same IP. What is this called and what is the likely effect?",
                "options": [
                    "A rogue DHCP server; intermittent connectivity for both",
                    "A duplicate IP; both devices drop on and off the network",
                    "A VLAN mismatch; no effect",
                    "A routing loop; slow internet",
                ],
                "correct_option": 1,
            },
            {
                "id": "cap-net-q3",
                "prompt": "What is the disciplined way to find where a connection breaks?",
                "options": [
                    "Restart the user's computer",
                    "Follow the path hop by hop and test each stage",
                    "Replace the firewall",
                    "Wait for it to resolve itself",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "sat-identity-access",
        "name": "Identity & Access Management Basics",
        "track": TRACK_SECURITY,
        "category": "security_awareness",
        "tagline": "Most breaches are a login, not an exploit. Get identity right and you stop most attacks.",
        "difficulty": "Foundation",
        "roles": ["All staff", "Service desk", "System administrators"],
        "estimated_minutes": 25,
        "required": True,
        "passing_score": 85,
        "inspired_by": "Managed security-awareness programs",
        "modules": [
            {
                "title": "Least privilege, by default",
                "body": (
                    "Give people the access they need for their role and nothing more, and review it when they change roles. Standing admin rights are a "
                    "liability — use just-in-time elevation instead. Access that is never granted never has to be revoked in a crisis."
                ),
            },
            {
                "title": "MFA and the recovery gap",
                "body": (
                    "Multi-factor authentication blocks the vast majority of account takeovers, but the recovery path is often the weak link: if an attacker "
                    "can trigger 'reset my MFA', they bypass the protection. Treat account recovery with the same rigour as the login itself."
                ),
            },
            {
                "title": "Leavers are an urgent security task",
                "body": (
                    "When someone leaves, disable sign-in and revoke sessions immediately, then remove licences, group membership and forwarding rules. "
                    "Orphaned accounts and lingering mailbox delegates are a quiet, common source of compromise."
                ),
            },
        ],
        "assessment": [
            {
                "id": "sat-iam-q1",
                "prompt": "What does 'least privilege' mean?",
                "options": [
                    "Everyone gets admin rights for convenience",
                    "People get only the access their role needs",
                    "Only managers get accounts",
                    "Access is never reviewed",
                ],
                "correct_option": 1,
            },
            {
                "id": "sat-iam-q2",
                "prompt": "Why can the account recovery path undermine MFA?",
                "options": [
                    "MFA does not actually work",
                    "An attacker who can reset MFA bypasses the second factor",
                    "Recovery turns MFA off permanently",
                    "It does not — recovery is unrelated",
                ],
                "correct_option": 1,
            },
            {
                "id": "sat-iam-q3",
                "prompt": "A colleague leaves the company. What is the most time-critical action?",
                "options": [
                    "Reclaim their hardware",
                    "Disable sign-in and revoke active sessions immediately",
                    "Archive their email",
                    "Update the org chart",
                ],
                "correct_option": 1,
            },
        ],
    },
    {
        "id": "sat-incident-first-hour",
        "name": "Incident Response: The First Hour",
        "track": TRACK_SECURITY,
        "category": "security_awareness",
        "tagline": "The first hour shapes the whole incident. Contain, preserve evidence, communicate — in that order.",
        "difficulty": "Intermediate",
        "roles": ["Service desk", "Field engineers", "System administrators"],
        "estimated_minutes": 28,
        "required": False,
        "passing_score": 85,
        "inspired_by": "Incident-response retainer playbooks",
        "modules": [
            {
                "title": "Spot and report fast",
                "body": (
                    "You do not need to be certain to raise the alarm. If something feels off — unexpected encryption, a strange login, sudden slowness across "
                    "many devices — report it immediately and stop touching the affected system. Early reporting gives responders options; guessing wastes them."
                ),
            },
            {
                "title": "Contain without destroying evidence",
                "body": (
                    "Isolate the affected system from the network (pull the cable, disable the account) rather than wiping or rebuilding it first. Preserve logs, "
                    "memory and disk as they are — rebuilding loses the evidence needed to understand scope and prove what happened to insurers and customers."
                ),
            },
            {
                "title": "Communicate under pressure",
                "body": (
                    "Escalate through the defined path, keep a factual timeline of what you observed and did, and avoid speculation in writing. Notify the customer "
                    "with facts and next steps, not guesses. Calm, honest, timely communication is itself a control."
                ),
            },
        ],
        "assessment": [
            {
                "id": "sat-ir-q1",
                "prompt": "You suspect a device is compromised but you are not sure. What should you do?",
                "options": [
                    "Investigate quietly before bothering anyone",
                    "Report it immediately and stop touching the system",
                    "Wipe and rebuild the device",
                    "Wait for more evidence",
                ],
                "correct_option": 1,
            },
            {
                "id": "sat-ir-q2",
                "prompt": "Why isolate rather than rebuild during an incident?",
                "options": [
                    "Rebuilding is too slow",
                    "Rebuilding destroys evidence needed to understand scope and prove what happened",
                    "Isolation is cheaper",
                    "Rebuilding never works",
                ],
                "correct_option": 1,
            },
            {
                "id": "sat-ir-q3",
                "prompt": "What belongs in the incident timeline?",
                "options": [
                    "Your guesses about the attacker",
                    "Factual observations and actions with times",
                    "Opinions about who is at fault",
                    "Nothing until the report is final",
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
