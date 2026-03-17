# NexusOps - RMM/PSA Platform PRD

## Original Problem Statement
Build a "rich and elegant RMM/PSA like Syncro and Super Ops" named "NexusOps". The application should be "fully feature-rich" and "better than the competition," incorporating a mix of the best features from other platforms while also introducing unique capabilities.

## Core Architecture
- **Backend**: FastAPI + MongoDB
- **Frontend**: React + Shadcn/UI + TailwindCSS
- **Auth**: JWT-based

## What's Been Implemented (Complete)

### Core Modules
- Dashboard with KPI cards
- Ticketing system with SLA, child tickets, merging, progress tracker, ticket number badges, viewer tracking
- Client Management with health scores, activity timeline, achievements, readiness scores
- Device Management with bulk actions
- Asset Management + Asset Lifecycle (procurement → disposal)
- Contract Management with SLA tiers + SLA shield badges
- Invoice Management
- Time Tracking
- Knowledge Base with Hudu sync
- Scripting with code blocks and copy functionality
- CRM/Leads with pipeline management, convert-to-client-and-create-ticket flow
- Remote Access
- Reporting (Recharts)
- IT Documentation
- Email Management + Office 365 one-click setup
- Scheduling
- Technician Management with profiles & achievements
- Vendor Management
- Rental Management
- Project Management with milestones
- Admin Settings
- Notification System (bell + unread count)
- Purchase Orders, Products, Networking (UniFi), Infrastructure monitoring
- **White Label & Branding** - Logo uploads for invoices, contracts, letterheads, color customization
- **Client Loyalty & Renewals Dashboard** - Loyalty tiers, points, smart auto-renewal proposals with upsell
- **Client Tenure Achievements** - 1yr/3yr/5yr/10yr/15yr/20yr badges
- **SLA Shield Achievements** - Gold/Silver/Bronze/Platinum/Standard shields
- **Client Portal Readiness Score** - Gamified readiness checklist
- **Predictive Maintenance AI** - Hardware failure risk prediction
- **Client Health & Opportunity Radar** - At-risk identification + upsell opportunities
- **Real-Time Event Bus** - SSE events + ticket viewer tracking

### Integrations
- **Active**: Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend, Multi-LLM (Emergent LLM Key)
- **Planned**: Office 365 (architecture ready, needs Azure AD credentials)
- **Mocked**: Xero, Pax8, Domotz, Acronis, Proxmox

### Session 2 Changes (March 17, 2026)
**Batch 1:**
1. Fix Leads module "Create Client & Create Ticket" bug
2. Office 365 one-click mailbox setup
3. Email-to-Lead webhook
4. Asset Lifecycle Management
5. Predictive Maintenance AI
6. Real-Time Event Bus with ticket viewer tracking
7. Client Health & Opportunity Radar
8. Ticket number badges + viewer color-flashing
9. Enhanced card-style progress bar

**Batch 2:**
1. Button color swap - Create Ticket (green), Convert to Client & Create Ticket (purple)
2. White Label & Branding (logo uploads for invoices/contracts/letterheads, colors)
3. SLA Shield symbols on contracts (Gold/Silver/Bronze/Platinum)
4. Client Tenure Achievements (1yr-20yr milestones)
5. Client Loyalty Rewards Dashboard with tier rankings
6. Smart Contract Auto-Renewal Proposals with upsell recommendations
7. Gamified Client Portal Readiness Score

## Credentials
- Admin: admin@nexusops.io / admin123

## Backlog

### P1 - Next Up
- Full UniFi Integration Phase 2 (active device management)
- Full Xero Integration (real invoice syncing)

### P2 - Future
- Full backend for mocked integrations (Pax8, Domotz, Acronis, Proxmox)
- Real Office 365 Azure AD OAuth flow
- Client portal for end-user self-service
- Database seeding mechanism
- Fix recharts console warnings

## Testing
- iteration_30.json - 100% pass (21 backend, all frontend) - Batch 1
- iteration_31.json - 100% pass (10 backend, all frontend) - Batch 2
