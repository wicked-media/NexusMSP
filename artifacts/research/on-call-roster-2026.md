# NexusMSP on-call roster research

Research date: 2026-09-12

Product scope: MSP on-call scheduling, escalation and coverage operations

Audience: service desk managers, incident leads and on-call technicians

Forum posts are user-generated and were treated as untrusted qualitative input. Product and safety decisions below were corroborated against vendor documentation and the existing NexusMSP architecture.

## What mature on-call products establish

- A schedule answers who is responsible at a point in time; an escalation policy answers who is paged next and after what timeout. PagerDuty documents separate primary and secondary schedules, ordered escalation rules, timeouts, schedule layers, overrides, gaps, calendar sync and schedule history.
- Useful shift creation needs named tiers/rotations, active dates and times, handoff boundaries, assignment type, overrides and visible future changes.
- Coverage gaps must be explicit. PagerDuty surfaces `No One On Call`; incident.io can detect missing coverage caused by unassigned rotations or deactivated users.
- Responders need a personal, low-friction way to see shifts and arrange cover. incident.io supports partial cover requests and turns an accepted request into an override.
- Readiness and operational review matter beyond the calendar: configured contact methods, interruption load, escalation counts and shift handoffs are first-class evidence.

Primary references:

- https://support.pagerduty.com/main/docs/escalation-policies-and-schedules
- https://support.pagerduty.com/main/docs/shift-based-schedules
- https://support.pagerduty.com/main/docs/escalation-policies
- https://support.pagerduty.com/main/docs/my-on-call-shifts
- https://support.pagerduty.com/main/docs/on-call-readiness-reports
- https://support.pagerduty.com/main/docs/analytics-dashboard
- https://support.pagerduty.com/main/docs/operational-reviews
- https://support.pagerduty.com/main/docs/use-mobile-schedules
- https://support.pagerduty.com/main/docs/schedules-in-apps
- https://docs.incident.io/on-call/overrides
- https://docs.incident.io/on-call/getting-started
- https://incident.io/changelog/24-7-schedule-coverage-policy
- https://incident.io/blog/on-call-load-balancing-escalation
- https://docs.datadoghq.com/incident_response/on-call/schedules/

## Recurring MSP pain from public forums

The clearest repeated needs were:

1. Reduce manual roster administration. Managers described spending hours balancing a 15–20 person schedule around leave, weekends and holidays.
2. Make fairness inspectable. People explicitly suggested weighted assignment models and complained about invisible imbalance in weekends, overnight work and holiday cover.
3. Publish coverage early and make overrides easy. Quarterly or six-to-ten-week visibility, approval-aware swaps and automatic reassignment were common requests.
4. Separate urgent after-hours work from normal support. MSP staff described routine requests leaking into on-call hours, alert overload and repeated overnight pages as direct burnout drivers.
5. Use a primary plus backup chain with escalation to a lead or manager. Several MSPs described exactly this operating model.
6. Stop handing around a physical phone. Responders prefer normal phone/SMS/push/Teams/Slack paths selected by schedule and tier.
7. Connect paging to the operational intake path. RMM events, emergency phone queues and ticket routing were repeatedly mentioned.
8. Keep compensation and recovery time visible as policy. Stipends, overtime, flex time and post-call recovery differ by MSP and jurisdiction, so the product should expose load without inventing payroll rules.

Public forum references:

- https://www.reddit.com/r/msp/comments/1rtid6w/how_do_you_handle_after_hours_service_rotations/
- https://www.reddit.com/r/msp/comments/1gwjwqo
- https://www.reddit.com/r/msp/comments/nferct
- https://www.reddit.com/r/msp/comments/1p8gbxi/on_call_the_struggle_is_real/
- https://www.reddit.com/r/msp/comments/132tfw1
- https://www.reddit.com/r/msp/comments/1kd1836
- https://www.reddit.com/r/msp/comments/oanidu
- https://www.reddit.com/r/msp/comments/ea1s88

## Product decisions for this increment

- Define three operational tiers: T1 Primary pages immediately and targets acknowledgement within five minutes; T2 Backup escalates after ten minutes; T3 Incident Lead escalates after twenty minutes and owns coordination.
- Keep responder identity/default pool in `tech_roster`; make `on_call_roster` the only authority for time-bound current coverage.
- Show current coverage, gaps, overlaps, next handoff, upcoming shifts, categories, audited overrides/cancellations, paging-path readiness and weighted eight-week rotation load in Team Hub.
- Preserve history when cancelling. Reassignment notifies both responders and records the actor.
- Treat workload points as a planning signal only. Holiday weighting, compensation, after-hours entitlement and recovery-time policy remain explicit future configuration decisions.

## High-value follow-on work

- Personal `My shifts` view with cover requests and acceptance workflow instead of manager-only reassignment.
- Repeating rotations, schedule layers, time-zone-aware follow-the-sun handoffs and holiday calendars.
- Configurable escalation policies and acknowledgement timeouts per service/category.
- Voice/SMS/push delivery receipts, acknowledgement state and automatic escalation execution.
- Calendar subscriptions and chat-based overrides.
- After-hours intake policy, alert deduplication, interruption analytics and recovery/fatigue guardrails.
