# Lens 146 — Incident Communication Readiness

**Distinct value:** Evaluates the complete incident communication pipeline: Can Foundry notify founders of an outage? Is there a status page? Is there an incident template? Does the team have a process for communicating during and after incidents? This is not about detection or recovery (covered in lenses 142-143) but specifically about communication with affected parties.

**Tenancy-critical:** Yes. Founders are running businesses that depend on Foundry's intelligence layer. A silent outage erodes trust far more than a communicated one. Incident communication must reach all affected tenants without leaking information about other tenants' status.

## Executive Summary

Foundry has no incident communication infrastructure. There is no status page, no incident template, no founder notification mechanism for outages, no escalation protocol, and no defined communication channel for real-time updates during incidents. The system can send emails via Resend (digests, behavioral triggers), but there is no "broadcast to all founders" capability connected to incident management. A founder experiencing an outage has no way to know whether Foundry is aware of the issue, whether it affects only them, or when resolution is expected.

## Assessment Areas

### 1. Status Page — Does Not Exist

**Evidence:** There is no `/status` route in `src/routes/`. There is no integration with any external status page provider (Instatus, Statuspage.io, Cachet, etc.). The terms of service at `src/routes/public/landing.ts:353` mention "Scheduled maintenance will be announced in advance" but do not say where. The health check at `/internal/health` is behind the internal auth middleware and is not public-facing.

**Impact:** When Foundry is down, founders have no way to:
- Confirm the service is down (vs. their own network issue)
- See which components are affected (AI, database, billing)
- Get an estimated time to resolution
- Subscribe to update notifications

### 2. Founder Notification During Outage — No Mechanism

**What exists:** Foundry can send emails via Resend (`src/services/integration/resend.ts` and `src/services/digest/delivery.ts`). There is a `notifyAllFounders` broadcast function in `src/services/notifications/push.ts:109` for push notifications to iOS devices. There is an in-app notification system (`src/services/ux/notifications.ts`).

**What is missing:**
- No "incident notification" email template or function
- No way to trigger a broadcast email to all founders from the CLI or an admin panel
- The push notification broadcast exists but requires the founder to have the iOS app installed and push notifications enabled
- In-app notifications require the founder to be logged in and viewing the dashboard, which they cannot do during an outage
- Email delivery depends on Resend being operational, which may not be the case during an incident

**Circular dependency:** During a database outage, Foundry cannot query the `founders` table to get email addresses for notification. During a Resend outage, Foundry cannot send emails. The notification mechanism depends on the very services that may be down.

### 3. Incident Template — Does Not Exist

There is no incident template document anywhere in the repository. No `/docs/incidents/`, no `INCIDENT_TEMPLATE.md`, no structured format for documenting what happened, who was affected, what was the timeline, and what was the root cause.

A good incident template includes:
- **Status:** Investigating / Identified / Monitoring / Resolved
- **Impact:** Which features are affected, which tiers, estimated scope
- **Timeline:** When detected, when acknowledged, key milestones
- **Root cause:** Technical description
- **Remediation:** What was done to resolve
- **Action items:** What will prevent recurrence

None of this exists.

### 4. Escalation Protocol — Does Not Exist

The runbook mentions no escalation path. There is no:
- On-call rotation or schedule
- Primary/secondary responder assignment
- Severity classification (P0/P1/P2 definitions for incidents vs. bugs)
- Escalation timeline (if P0 not acknowledged in 15 minutes, escalate to...)
- Communication channel (Slack, PagerDuty, phone tree)

For a single-founder company (Thomas Norton), this may be implicitly "Thomas handles everything." But this does not scale to even 2 engineers, and it means the system has zero incident response capability when Thomas is unavailable.

### 5. Scheduled Maintenance Communication — Promised But Not Implemented

The terms of service state: "Scheduled maintenance will be announced in advance." There is no mechanism to announce maintenance:
- No maintenance mode endpoint that returns a custom page
- No scheduled maintenance email template
- No way to set a maintenance window in the system

If a deploy requires database migration downtime, founders see a 500 error with no explanation.

### 6. In-App Degraded Mode Banner — Does Not Exist

When the health check returns `degraded` (e.g., Anthropic key missing), the dashboard renders normally with no visual indication. There is no:
- Banner component for system-wide alerts
- Degraded mode detection in the layout template
- Per-component health indicators (e.g., "AI features temporarily unavailable")

The `getLayoutContext` helper in `src/routes/dashboard/_shared.ts` does not check system health. The dashboard layout in `src/views/layout.ts` does not render any health status.

## Communication Gap Matrix

| Scenario | Email | Push | In-App | Status Page | Overall |
|----------|-------|------|--------|-------------|---------|
| Full outage (DB down) | Cannot query emails | Cannot send | Cannot render | Does not exist | **Zero communication** |
| Partial outage (AI down) | Possible | Possible | Possible but no banner | Does not exist | **No proactive notification** |
| Scheduled maintenance | No template | No template | No banner | Does not exist | **No pre-notification** |
| Billing issue | Possible | Possible | Possible | Does not exist | **Manual only** |
| Security incident | No template | No template | No notification type | Does not exist | **No process** |
| Post-resolution | No template | No template | No notification type | Does not exist | **No follow-up** |

## Findings Summary

| # | Finding | Severity | Description |
|---|---------|----------|-------------|
| 1 | No status page | P1 | Founders have no way to check service status during outages |
| 2 | No incident notification mechanism | P1 | No way to proactively notify founders of outages |
| 3 | No incident template | P1 | No structured format for incident documentation |
| 4 | No escalation protocol | P1 | No on-call, no severity classification, no escalation timeline |
| 5 | No maintenance mode | P2 | Scheduled maintenance shows as unexpected errors |
| 6 | No degraded-mode banner | P2 | Dashboard shows no indication when AI or other services are degraded |
| 7 | Circular dependency in notification | P2 | Cannot notify during DB outage because email list is in DB |
| 8 | No security incident communication process | P1 | Key leak or data breach has no notification procedure |

## Priority Remediation

1. **P1:** Set up an external status page (Instatus, Statuspage.io, or even a static page on a separate domain) that is independent of Foundry's infrastructure
2. **P1:** Create an incident template and store it in `docs/operations/incident-template.md`
3. **P1:** Build a founder email broadcast function that can be triggered from CLI, with a pre-cached email list (not dependent on DB availability during outage)
4. **P1:** Define escalation protocol with severity levels, response times, and communication cadence
5. **P2:** Add a system health banner to the dashboard layout that shows when components are degraded
6. **P2:** Add a maintenance mode that returns a friendly page instead of 500 errors during deploys
7. **P2:** Maintain an external copy of founder email addresses (e.g., in Resend contacts or a separate store) to enable notification during database outages
