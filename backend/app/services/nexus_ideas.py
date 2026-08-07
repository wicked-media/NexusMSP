"""Durable product-idea registry for Nexus Foundation.

Ideas are deliberately separate from the committed product roadmap. Capturing
an idea does not claim it is approved, scheduled, funded, or released.
"""

from __future__ import annotations

import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from app.database import db


IDEA_STATUSES = ("captured", "reviewing", "validated", "promoted", "parked", "rejected")
VALUE_AXES = ("saves_time", "reduces_stress", "increases_confidence", "creates_opportunity")

_IDEAS = (
    (326, "Digital Air Traffic Control", "operations", "Balance technician work using ticket load, expertise, location, and collision evidence.", (1, 1, 1, 0)),
    (327, "Living Customer", "experience", "Express customer health through calm, accessible motion and colour backed by health evidence.", (1, 1, 1, 0)),
    (328, "AI Whisper", "experience", "Offer quiet contextual guidance without interrupting the technician workflow.", (1, 1, 1, 0)),
    (329, "Universal Command History", "foundation", "Retain and replay technician, API, ticket, remote, and automation actions through one audit contract.", (1, 1, 1, 0)),
    (330, "Environment Ecosystem", "relationships", "Visualise how infrastructure, protection, services, and users depend on each other.", (1, 1, 1, 0)),
    (331, "Living API Explorer", "developer-experience", "Make connector requests, responses, latency, and failures observable in real time.", (1, 0, 1, 0)),
    (332, "AI Memory Threads", "intelligence", "Assemble every source-backed object related to a technician question into one explainable thread.", (1, 1, 1, 0)),
    (333, "Zero Waiting", "performance", "Predictively prefetch safe client context so primary workspaces feel immediate.", (1, 1, 0, 0)),
    (334, "Infinite Undo", "foundation", "Model changes with before/after state, reversible checkpoints, retention, and governed rollback.", (1, 1, 1, 0)),
    (335, "Live MSP Pulse", "experience", "Show platform freshness and degraded-heartbeat evidence without dashboard noise.", (1, 1, 1, 0)),
    (336, "AI Confidence Rings", "trust", "Display provenance and confidence for documentation, security, backups, billing, and automation.", (0, 1, 1, 0)),
    (337, "Reality Mode", "onsite", "Overlay verified asset and cabling context for onsite technicians using a device camera.", (1, 1, 1, 0)),
    (338, "AI Learns Your Style", "automation", "Suggest repeatable workflow improvements from a technician's approved action patterns.", (1, 1, 1, 0)),
    (339, "Living Network", "network", "Represent live topology, traffic, and failure propagation from observed telemetry.", (1, 1, 1, 0)),
    (340, "Customer Time Capsule", "history", "Compare a client's verified operational state at two retained points in time.", (1, 1, 1, 1)),
    (341, "AI Never Again", "automation", "Detect recurring issues and propose permanent remediation, policy, training, or replacement options.", (1, 1, 1, 1)),
    (342, "Digital Project Manager", "projects", "Make project risk, budget, progress, dependencies, and next actions understandable at a glance.", (1, 1, 1, 1)),
    (343, "Knowledge Constellations", "knowledge", "Reveal documentation relationships based on verified shared use and object links.", (1, 1, 1, 0)),
    (344, "AI Escalation Predictor", "service-desk", "Forecast SLA and customer escalation risk from explainable operational evidence.", (1, 1, 1, 1)),
    (345, "Human Memory Replacement", "knowledge", "Preserve decisions, workarounds, scripts, outcomes, and context as institutional memory.", (1, 1, 1, 1)),
    (346, "Why Is This Slow?", "endpoint", "Run a governed multi-signal endpoint investigation and return an evidence-backed explanation.", (1, 1, 1, 0)),
    (347, "Living Rack", "onsite", "Combine rack layout with observed temperature, power, health, and port state.", (1, 1, 1, 0)),
    (348, "AI Company Coach", "business", "Relate delivery, automation, staffing, and financial signals into explainable business guidance.", (1, 1, 1, 1)),
    (349, "Invisible Documentation", "knowledge", "Surface the right approved documentation inside the workflow that needs it.", (1, 1, 1, 0)),
    (350, "Calm Mission Brief", "experience", "Replace homepage overload with a concise evidence-backed overnight and today briefing.", (1, 1, 1, 1)),
    (351, "NexusOS Platform Mission", "strategy", "Evolve Nexus as a coherent MSP operating system with one identity, context model, permission vocabulary, billing engine, AI boundary, and audit contract.", (1, 1, 1, 1)),
    (352, "Living Knowledge", "knowledge", "Replace static documentation with source-backed knowledge that updates, scores confidence, and appears in context.", (1, 1, 1, 1)),
    (353, "Network Digital Twin", "network", "Represent verified ports, VLANs, cables, devices, sites, and dependencies as one time-aware operational model.", (1, 1, 1, 1)),
    (354, "Configuration Intelligence", "infrastructure", "Version, compare, explain, and govern configuration state across supported providers and managed assets.", (1, 1, 1, 1)),
    (355, "Nexus Exchange", "marketplace", "Share governed automation, policies, reports, documentation, templates, integrations, and industry packs.", (1, 1, 1, 1)),
    (356, "Nexus University", "training", "Provide role-aware technician labs, learning paths, certifications, and evidence-based skill development.", (1, 1, 1, 1)),
    (357, "Nexus Benchmark", "business", "Offer opt-in anonymised operational and financial comparisons with privacy and cohort safeguards.", (1, 0, 1, 1)),
    (358, "Nexus Autonomous MSP", "strategy", "Safely progress from recommendations to approved bounded autonomy while humans retain architecture, relationships, and high-impact decisions.", (1, 1, 1, 1)),
    (359, "Nexus Box", "hardware", "Explore a securely managed network appliance for routing, firewall, DNS, VPN, monitoring, backup gateway, and remote relay workloads.", (1, 1, 1, 1)),
    (360, "Nexus Sensor", "hardware", "Explore a small trusted discovery and telemetry appliance for client networks where the endpoint agent cannot provide coverage.", (1, 1, 1, 1)),
    (361, "Nexus Context Fabric", "foundation", "Preserve why records and controls exist, who requested and approved them, the business process involved, and the evidence supporting each relationship.", (1, 1, 1, 1)),
    (362, "Nexus Intelligence Layer", "intelligence", "Give every module one governed intelligence contract for explaining events, detecting patterns, recommending work, and proposing automation.", (1, 1, 1, 1), 351),
    (363, "Universal Object Model", "foundation", "Give every operational record the same identity, relationship, history, approval, attachment, task, and automation capabilities.", (1, 1, 1, 1), 352),
    (364, "Every Object Has a Timeline", "foundation", "Let every canonical object tell its own source-backed operational story without implying causation from event proximity.", (1, 1, 1, 0), 353),
    (365, "Universal Comments", "collaboration", "Write a comment once and attach it to multiple canonical objects without duplicating the underlying note.", (1, 1, 1, 0), 354),
    (366, "AI Memory Cards", "intelligence", "Provide a concise, provenance-aware object summary containing current state, risk, recent change, open work, and suggested next action.", (1, 1, 1, 0), 355),
    (367, "Health Everywhere", "trust", "Expose domain-appropriate health for every canonical object, including operational and commercial records.", (1, 1, 1, 1), 356),
    (368, "Confidence Everywhere", "trust", "Show how trustworthy an object's state is using freshness, provenance, verification, and evidence coverage.", (0, 1, 1, 0), 357),
    (369, "Business Impact Everywhere", "experience", "Require alerts and degraded states to explain affected people, services, business processes, and recorded financial exposure.", (1, 1, 1, 1), 358),
    (370, "One Relationship Engine", "relationships", "Use one evidence-backed relationship graph for operational, commercial, knowledge, identity, and infrastructure objects.", (1, 1, 1, 1), 359),
    (371, "AI Context Engine", "intelligence", "Assemble the relevant records, prior fixes, assets, risks, documentation, preferences, and current work for the task in view.", (1, 1, 1, 0), 360),
    (372, "Contextual Screen Assistant", "intelligence", "Use one governed assistant that adopts the permissions, vocabulary, and verified context of the active workspace.", (1, 1, 1, 1), 361),
    (373, "Universal Simulation", "governance", "Preview material actions, affected objects, policy checks, approvals, rollback limits, and likely outcomes before execution.", (1, 1, 1, 0), 362),
    (374, "AI Standardiser", "operations", "Compare client state with an approved standard and explain every material deviation before proposing remediation.", (1, 1, 1, 1), 363),
    (375, "Operations Calendar", "operations", "Unify maintenance, renewals, projects, arrivals, warranties, certificates, licences, and staff availability on one governed calendar.", (1, 1, 1, 0), 364),
    (376, "AI Design Review", "automation", "Review draft automations for loops, duplicated work, security boundaries, performance risk, and existing equivalent workflows.", (1, 1, 1, 0), 365),
    (377, "Universal Versioning", "foundation", "Apply version history, comparison, approval, retention, and governed rollback to supported Nexus objects.", (1, 1, 1, 0), 366),
    (378, "MSP Digital Twin", "business", "Model the MSP's own verified staffing, workload, revenue, growth, delivery risk, and capacity relationships.", (1, 1, 1, 1), 367),
    (379, "AI Operational Debt", "operations", "Identify stale, duplicated, unused, or unsupported automations, documents, scripts, monitors, and policies with evidence.", (1, 1, 1, 0), 368),
    (380, "Trust Graph", "trust", "Score trust from authorship, verification, freshness, usage, provenance, and contradiction evidence rather than permissions alone.", (1, 1, 1, 0), 369),
    (381, "Nexus Knowledge Network", "strategy", "Explore explicitly opted-in, privacy-preserving learning about which changes, hardware, automations, and operating patterns improve MSP outcomes.", (1, 1, 1, 1), 370),
    (382, "The Nexus Button", "experience", "Provide one context-aware entry point that explains the active workspace and suggests the safest useful next actions.", (1, 1, 1, 0), 371),
    (383, "Living Workspace", "experience", "Adapt workspace emphasis to verified time, workload, deadlines, and technician responsibilities without hiding core navigation.", (1, 1, 0, 0), 372),
    (384, "AI Detects Confusion", "intelligence", "Detect repeated navigation and search loops locally, then offer a concise explanation without monitoring unrelated user behaviour.", (1, 1, 1, 0), 373),
    (385, "Smart Hover Actions", "experience", "Reveal safe, relevant quick actions after clear pointer intent while retaining accessible keyboard and touch alternatives.", (1, 1, 0, 0), 374),
    (386, "Every Metric Explains Itself", "experience", "Make meaningful charts, counts, icons, and status signals open their source records, definitions, or filtered evidence.", (1, 1, 1, 0), 375),
    (387, "Living Sidebar", "experience", "Prioritise contextual navigation while preserving predictable information architecture and user control.", (1, 1, 0, 0), 376),
    (388, "Predictive Prefetch", "performance", "Prefetch only safe, likely next read models from local workflow context so navigation feels immediate without taking action.", (1, 1, 0, 0), 377),
    (389, "Universal Inspector", "foundation", "Open properties, health, confidence, history, relationships, notes, and source evidence in one reusable side inspector.", (1, 1, 1, 0), 378),
    (390, "Journey Breadcrumbs", "experience", "Preserve the technician's navigational journey and object context so they can safely return to earlier decision points.", (1, 1, 1, 0), 379),
    (391, "Universal Floating Search", "experience", "Keep fast cross-object search available without forcing the technician into a modal or new workspace.", (1, 1, 0, 0), 380),
    (392, "AI Cursor", "intelligence", "Explore opt-in pointer-adjacent explanations and suggestions with strict motion, accessibility, and interruption controls.", (1, 1, 1, 0), 381),
    (393, "Living Tooltips", "experience", "Turn tooltips into small accessible evidence previews for complex status and metrics rather than hiding critical controls in hover-only UI.", (1, 1, 1, 0), 382),
    (394, "Operational Theme Signals", "experience", "Use restrained, accessible workspace accents to reflect verified normal, degraded, or critical operational state.", (0, 1, 1, 0), 383),
    (395, "Focus Bubble", "experience", "Reduce surrounding visual noise while a technician performs high-attention ticket or change work, with an explicit exit.", (1, 1, 0, 0), 384),
    (396, "Workflow Heat Trails", "analytics", "Use privacy-aware aggregate workflow telemetry to identify repeated navigation sequences worth simplifying or automating.", (1, 1, 1, 1), 385),
    (397, "Universal Timeline Slider", "history", "Explore time-aware object state using retained snapshots and clear gaps where historical state is unavailable.", (1, 1, 1, 0), 386),
    (398, "Relationship Inspector", "relationships", "Preview verified object relationships and their evidence with accessible motion and a static fallback.", (1, 1, 1, 0), 387),
    (399, "Technician AI Workspace", "experience", "Assemble a role-aware homepage from verified responsibilities, priorities, and preferences while keeping manual controls.", (1, 1, 1, 0), 388),
    (400, "Evidence-Built Dashboards", "analytics", "Propose temporary dashboards from current operational questions with visible metric definitions and sources.", (1, 1, 1, 0), 389),
    (401, "One Canvas", "experience", "Explore an infinite operational canvas for relationship-heavy investigations without replacing efficient list and form workflows.", (1, 1, 1, 0), 390),
    (402, "Living Reports", "reporting", "Publish governed report views that can refresh from current authorised data while preserving immutable generated snapshots for audit.", (1, 1, 1, 1), 391),
    (403, "Universal Diff", "foundation", "Compare supported objects, versions, policies, documents, commercial records, and snapshots through one evidence-aware diff contract.", (1, 1, 1, 0), 392),
    (404, "Smart Empty States", "experience", "Explain what an empty state means and suggest safe proactive work without manufacturing urgency.", (1, 1, 1, 0), 393),
    (405, "Contextual Micro-Learning", "training", "Offer optional, role-aware lessons at the point of work without obstructing experienced technicians.", (0, 1, 1, 1), 394),
    (406, "Daily Improvement Prompt", "training", "Suggest one small evidence-backed improvement such as documenting, standardising, or automating recurring work.", (1, 1, 1, 0), 395),
    (407, "AI Sketch", "knowledge", "Convert a technician sketch into a draft network model that requires verification before becoming documentation.", (1, 1, 1, 0), 396),
    (408, "Universal Preview", "experience", "Preview authorised object context and recent evidence without losing the current workflow.", (1, 1, 1, 0), 397),
    (409, "Live MSP Heartbeat", "business", "Summarise the MSP's current operational state in one explainable pulse backed by drill-down evidence.", (1, 1, 1, 1), 398),
    (410, "Zero Dashboard", "experience", "Allow the absence of actionable work to be the primary dashboard outcome instead of filling space with vanity widgets.", (1, 1, 1, 0), 399),
    (411, "Nexus Memory Engine", "intelligence", "Turn attributable actions, environments, outcomes, time, feedback, and documentation changes into privacy-governed operational memory.", (1, 1, 1, 1), 400),
    (412, "Liquid Glass UI", "experience", "Explore restrained translucent depth and pointer-aware highlights without reducing contrast or content legibility.", (0, 1, 0, 1), 401),
    (413, "Magnetic Buttons", "experience", "Explore subtle pointer-proximity feedback for primary actions with static, keyboard, touch, and reduced-motion equivalents.", (1, 1, 0, 0), 402),
    (414, "Purposeful Particle Field", "experience", "Use a sparse optional particle field to communicate active AI processing rather than as permanent decoration.", (0, 1, 1, 0), 403),
    (415, "Responsive Click Ripples", "experience", "Provide brief pointer-origin feedback so actions feel acknowledged while preserving immediate response and accessibility.", (0, 1, 1, 0), 404),
    (416, "Bubble Notifications", "experience", "Explore calm, stackable notifications with predictable focus, dismissal, persistence, and audit behaviour.", (1, 1, 1, 0), 405),
    (417, "Milestone Shooting Star", "experience", "Reserve one brief celebratory motion for verified major milestones rather than routine work.", (0, 1, 0, 1), 406),
    (418, "Stateful Animated Gradients", "experience", "Let restrained gradients communicate verified state improvement or degradation without relying on colour alone.", (0, 1, 1, 0), 407),
    (419, "Live Service Globe", "visualisation", "Explore a navigable client and service-location globe where geography materially aids outage and delivery decisions.", (1, 1, 1, 1), 408),
    (420, "Automation Flow Lines", "automation", "Animate governed workflow progress so technicians can distinguish queued, running, blocked, failed, and completed steps.", (1, 1, 1, 0), 409),
    (421, "Relationship Data Pulses", "relationships", "Use optional pulses on verified connections to communicate observed activity without implying unmeasured traffic.", (0, 1, 1, 0), 410),
    (422, "Operational Heat Maps", "visualisation", "Map CPU, memory, network, workload, and risk intensity using accessible scales and exact drill-down evidence.", (1, 1, 1, 0), 411),
    (423, "Outage Atmosphere", "experience", "Use a restrained degraded-state atmosphere during verified major incidents without compromising focus or accessibility.", (0, 1, 1, 0), 412),
    (424, "AI Aurora", "experience", "Use a slow optional aurora to distinguish active AI work from idle or recommendation-ready states.", (0, 1, 1, 0), 413),
    (425, "Health DNA", "visualisation", "Explore a distinctive health visual only where it communicates multiple verified contributing signals more clearly than a chart.", (0, 1, 1, 1), 414),
    (426, "Crystal Cards", "experience", "Use restrained depth and light response for premium surfaces while maintaining consistent semantic hierarchy.", (0, 1, 0, 1), 415),
    (427, "Fast Context Transition", "performance", "Use a short transition to preserve spatial context while switching clients, never masking actual loading time.", (1, 1, 1, 0), 416),
    (428, "Floating Widgets", "experience", "Explore extremely subtle ambient depth for passive widgets with no motion in minimal or reduced-motion modes.", (0, 1, 0, 0), 417),
    (429, "Critical Incident Energy", "experience", "Communicate verified critical escalation and resolution through restrained intensity changes rather than continuous alarming motion.", (1, 1, 1, 0), 418),
    (430, "Time-Aware Dark Mode", "experience", "Explore opt-in time-aware dark tones without changing semantic colours or overriding technician preferences.", (0, 1, 0, 0), 419),
    (431, "First-Customer Celebration", "experience", "Celebrate the first completed onboarding once, accessibly, and never during repeat operational work.", (0, 1, 0, 1), 420),
    (432, "Ocean Mission Control", "experience", "Explore a calm optional ambient background for passive monitoring screens with motion controls.", (0, 1, 0, 0), 421),
    (433, "Context Compass", "navigation", "Show the technician's current object and relationship direction when it reduces disorientation in deep investigations.", (1, 1, 1, 0), 422),
    (434, "Discovery Radar", "visualisation", "Visualise active authorised discovery progress, results, failures, and coverage gaps without inventing devices.", (1, 1, 1, 0), 423),
    (435, "Galaxy Search", "visualisation", "Explore relationship-distance search visualisation alongside an efficient accessible result list.", (1, 1, 1, 0), 424),
    (436, "Morphing Cards", "experience", "Preserve spatial continuity when a card expands into detail, with static and reduced-motion alternatives.", (1, 1, 0, 0), 425),
    (437, "Client Portal Transition", "experience", "Explore a brief client-context transition that never delays navigation or disguises tenant switching.", (0, 1, 1, 0), 426),
    (438, "Mirror Highlights", "experience", "Use restrained pointer-aware reflection for premium surfaces without obscuring content.", (0, 1, 0, 0), 427),
    (439, "Knowledge Growth Motion", "knowledge", "Communicate verified documentation coverage growth with accessible progress motion and exact evidence.", (0, 1, 1, 0), 428),
    (440, "Thermal Warning Motion", "endpoint", "Use a small semantic thermal indicator only when measured temperature crosses an approved threshold.", (1, 1, 1, 0), 429),
    (441, "Healthy Cooling Effect", "experience", "Use a calm blue breathing state for verified stable systems with motion disabled in minimal modes.", (0, 1, 1, 0), 430),
    (442, "Client Solar System", "relationships", "Explore an orbital relationship view while retaining a precise accessible graph and list alternative.", (1, 1, 1, 1), 431),
    (443, "Ink Search Transition", "experience", "Use a brief fluid expansion for search only when it improves spatial continuity and responsiveness.", (1, 1, 0, 0), 432),
    (444, "Knowledge Constellation Motion", "knowledge", "Animate verified knowledge links gently while preserving evidence, labels, and a static alternative.", (1, 1, 1, 0), 433),
    (445, "Nebula Background", "experience", "Offer a faint optional dark-mode texture that never competes with operational content.", (0, 1, 0, 0), 434),
    (446, "Optional Interface Sound", "accessibility", "Explore opt-in, independently controlled action, success, and notification sounds with no audio by default.", (0, 1, 1, 0), 435),
    (447, "Weighted Drag Physics", "experience", "Use restrained drag response to clarify placement and collision while keeping keyboard reordering available.", (1, 1, 0, 0), 436),
    (448, "Animated Numbers", "experience", "Interpolate changed counts briefly while preserving the exact final value and reduced-motion behaviour.", (0, 1, 1, 0), 437),
    (449, "Revenue Recovery Moment", "billing", "Acknowledge verified recovered revenue briefly without gamifying routine financial work.", (0, 1, 1, 1), 438),
    (450, "Dynamic Depth", "experience", "Explore subtle contextual shadows while keeping depth stable enough for predictable hierarchy.", (0, 1, 0, 0), 439),
    (451, "Accessible Hover Lift", "experience", "Use a small lift to identify interactive cards with equivalent focus-visible feedback.", (1, 1, 0, 0), 440),
    (452, "Cinematic Loading", "experience", "Replace generic spinners with honest staged progress only when the system can report real loading phases.", (0, 1, 1, 0), 441),
    (453, "Morphing Status Icons", "experience", "Animate verified state transitions between warning, repair, and healthy without hiding labels or history.", (1, 1, 1, 0), 442),
    (454, "Live Data Rivers", "integrations", "Visualise attributable data movement between providers, Nexus, billing, and documents with latency and failure evidence.", (1, 1, 1, 1), 443),
    (455, "Semantic Colour Contract", "foundation", "Standardise blue for work, green for healthy, amber for attention, red for immediate action, and violet for AI with non-colour cues.", (1, 1, 1, 0), 444),
    (456, "Ambient Intelligence", "foundation", "Let surfaces quietly communicate recommendations, revenue gaps, active sessions, progress, and resolved state without noisy notifications.", (1, 1, 1, 1), 445),
    (457, "Water Physics", "experience", "Explore weighted drag interactions only where spatial movement improves understanding, with keyboard reordering and reduced-motion alternatives.", (1, 1, 0, 0), 401),
    (458, "Adaptive Lighting", "experience", "Use restrained pointer-aware illumination to clarify interactive depth without darkening essential information.", (0, 1, 0, 0), 402),
    (459, "Parallax Depth", "experience", "Explore minimal optional depth response for premium surfaces while preserving stability, performance, and accessibility.", (0, 1, 0, 0), 403),
    (460, "Air Resistance", "experience", "Use consistent deceleration for draggable surfaces so movement communicates weight without slowing task completion.", (1, 1, 0, 0), 404),
    (461, "Living Icons", "experience", "Animate small icon details only when they communicate measured activity or state, never as permanent decoration.", (0, 1, 1, 0), 405),
    (462, "Energy Trails", "experience", "Explore brief trails for meaningful movement or data transfer with strict motion and performance controls.", (0, 1, 0, 0), 406),
    (463, "Premium Glass", "experience", "Create consistent high-contrast premium surfaces with restrained edge light and depth.", (0, 1, 0, 1), 407),
    (464, "Temperature Colours", "endpoint", "Map measured thermal state through a continuous accessible scale with exact temperatures and threshold evidence.", (1, 1, 1, 0), 408),
    (465, "Magnetic Layouts", "experience", "Provide predictable snapping, collision handling, keyboard placement, and saved layout state for configurable workspaces.", (1, 1, 0, 0), 409),
    (466, "Liquid Progress", "experience", "Explore distinctive progress motion only when backed by real measured completion and a numeric accessible equivalent.", (0, 1, 1, 0), 410),
    (467, "AI Thinking Graph", "intelligence", "Show actual retrieval, tool, validation, and response stages rather than fake neural activity or typing.", (0, 1, 1, 0), 411),
    (468, "Live Earth", "visualisation", "Combine client geography, provider paths, weather, and outages when those verified relationships improve operational decisions.", (1, 1, 1, 1), 412),
    (469, "Vortex Search", "experience", "Explore a short search transition while preserving instant keyboard focus, result order, and reduced-motion behaviour.", (1, 1, 0, 0), 413),
    (470, "Sunrise Dashboard", "experience", "Offer opt-in time-aware ambience without changing semantic state colours or reducing contrast.", (0, 1, 0, 0), 414),
    (471, "Workspace Sleep Mode", "experience", "Calm optional ambient motion after inactivity while keeping live status, alerts, and accessibility unchanged.", (0, 1, 0, 0), 415),
    (472, "Continuous Morphing", "experience", "Preserve spatial continuity between supported cards, dialogs, and detail views without delaying navigation.", (1, 1, 0, 0), 416),
    (473, "Ocean Navigation", "experience", "Explore optional depth transitions for passive navigation with minimal and static equivalents.", (0, 1, 0, 0), 417),
    (474, "Camera Motion", "experience", "Use a consistent zoom, pan, and focus language only when it explains navigational origin and destination.", (1, 1, 1, 0), 418),
    (475, "Living Borders", "foundation", "Use restrained semantic edge light to communicate verified health, attention, critical, work, and AI states.", (0, 1, 1, 0), 419),
    (476, "Success Energy", "automation", "Animate verified workflow completion across attributable steps so technicians can see the completed path.", (1, 1, 1, 0), 420),
    (477, "Live Rack LEDs", "infrastructure", "Reflect measured rack power and link states through small accessible indicators with timestamps and source evidence.", (1, 1, 1, 0), 421),
    (478, "AI Reasoning Stages", "intelligence", "Visualise attributable AI retrieval, tool calls, policy checks, and validation stages without exposing private chain-of-thought.", (1, 1, 1, 0), 422),
    (479, "Infinite Operational Space", "visualisation", "Explore zoomable customer-to-event relationships alongside efficient lists, search, forms, and accessibility alternatives.", (1, 1, 1, 1), 423),
    (480, "Knowledge Tree", "knowledge", "Represent verified documentation maturity and coverage through a tree metaphor with exact underlying measures.", (0, 1, 1, 1), 424),
    (481, "Bubble Menus", "experience", "Explore radial context actions only where discoverability, touch, and keyboard access remain equal or better.", (1, 1, 0, 0), 425),
    (482, "Motion Rhythm", "foundation", "Standardise durations, easing, distance, interruption, and reduced-motion behaviour across Nexus interactions.", (1, 1, 1, 0), 426),
    (483, "Living Background", "experience", "Offer barely perceptible optional ambient movement for passive workspaces with no effect on content or state.", (0, 1, 0, 0), 427),
    (484, "Remote Signal Waves", "remote", "Visualise measured remote-session latency and connection quality through labelled waves and exact telemetry.", (1, 1, 1, 0), 428),
    (485, "AI Aura", "intelligence", "Use the shared violet ambient signal when a source-backed AI recommendation is available.", (1, 1, 1, 0), 429),
    (486, "Client Colour Memory", "navigation", "Assign stable accessible client accents as a secondary navigation cue without replacing names, logos, or tenant boundaries.", (1, 1, 1, 0), 430),
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _seed_document(number: int, title: str, category: str, summary: str, axes: tuple[int, int, int, int], source_number: int | None = None) -> dict[str, Any]:
    source = (
        "interaction-delight-brief-401-430" if number >= 457
        else "purposeful-motion-brief-401-445" if source_number and source_number >= 401
        else "experience-design-brief-371-400" if source_number and source_number >= 371
        else "self-improving-platform-brief-351-370" if source_number
        else "product-architect-brief-326-350"
    )
    return {
        "id": f"idea-{number}",
        "number": number,
        "title": title,
        "category": category,
        "summary": summary,
        "status": "captured",
        "horizon": "explore",
        "source": source,
        "source_number": source_number or number,
        "value_axes": dict(zip(VALUE_AXES, (bool(value) for value in axes))),
        "evidence": [],
        "dependencies": ["core-platform"],
        "decision_note": None,
        "created_at": _now(),
        "updated_at": _now(),
    }


async def ensure_idea_catalog() -> None:
    for idea in (_seed_document(*row) for row in _IDEAS):
        await db.nexus_ideas.update_one({"id": idea["id"]}, {"$setOnInsert": idea}, upsert=True)
    await db.nexus_ideas.create_index("id", unique=True)
    await db.nexus_ideas.create_index([("status", 1), ("number", 1)])


async def ideas_snapshot() -> dict[str, Any]:
    await ensure_idea_catalog()
    ideas = await db.nexus_ideas.find({}, {"_id": 0}).sort([("number", 1), ("created_at", 1)]).to_list(1000)
    status_counts = Counter(str(item.get("status") or "captured") for item in ideas)
    axis_counts = {
        axis: sum(1 for item in ideas if (item.get("value_axes") or {}).get(axis))
        for axis in VALUE_AXES
    }
    return {
        "name": "Nexus Ideas",
        "items": ideas,
        "statuses": list(IDEA_STATUSES),
        "value_axes": list(VALUE_AXES),
        "summary": {"total": len(ideas), "status_counts": dict(status_counts), "axis_counts": axis_counts},
        "policy": [
            "Captured is not approved, scheduled, or released.",
            "Every idea must save time, reduce stress, increase confidence, or create opportunity.",
            "Promotion to the roadmap requires dependencies, evidence, an owner, and a release gate.",
            "Rejected and parked ideas remain retained so product decisions are not forgotten.",
        ],
    }


async def create_idea(payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    axes = {axis: bool((payload.get("value_axes") or {}).get(axis)) for axis in VALUE_AXES}
    if not any(axes.values()):
        raise ValueError("Select at least one Nexus value principle")
    now = _now()
    idea = {
        "id": f"idea-{uuid.uuid4()}",
        "number": None,
        "title": str(payload.get("title") or "").strip(),
        "category": str(payload.get("category") or "general").strip().lower(),
        "summary": str(payload.get("summary") or "").strip(),
        "status": "captured",
        "horizon": str(payload.get("horizon") or "explore").strip().lower(),
        "source": "nexus-foundation",
        "value_axes": axes,
        "evidence": [],
        "dependencies": payload.get("dependencies") or ["core-platform"],
        "decision_note": None,
        "created_by": actor.get("id"),
        "created_by_name": actor.get("name") or actor.get("email"),
        "created_at": now,
        "updated_at": now,
    }
    await db.nexus_ideas.insert_one(dict(idea))
    return idea


async def update_idea(idea_id: str, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {"status", "horizon", "decision_note", "category", "summary", "dependencies", "value_axes"}
    update = {key: value for key, value in payload.items() if key in allowed and value is not None}
    if "status" in update and update["status"] not in IDEA_STATUSES:
        raise ValueError("Unsupported idea status")
    if "value_axes" in update:
        update["value_axes"] = {axis: bool(update["value_axes"].get(axis)) for axis in VALUE_AXES}
        if not any(update["value_axes"].values()):
            raise ValueError("Select at least one Nexus value principle")
    update.update({"updated_at": _now(), "updated_by": actor.get("id"), "updated_by_name": actor.get("name") or actor.get("email")})
    result = await db.nexus_ideas.update_one({"id": idea_id}, {"$set": update})
    if not result.matched_count:
        return None
    return await db.nexus_ideas.find_one({"id": idea_id}, {"_id": 0})
