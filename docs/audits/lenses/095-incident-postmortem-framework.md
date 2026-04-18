# Lens 095 — Incident Postmortem Framework

**Distinct value:** Evaluates whether Foundry has a process for detecting, responding to, communicating about, and learning from incidents. Assesses runbook quality, escalation paths, communication templates, and the feedback loop from incident to prevention.

**Tenancy-critical:** Yes. An incident affecting one founder's SCP instance (e.g., runaway agent cost, incorrect AI recommendation acted on) may or may not affect other founders. The incident response must include blast radius assessment across the fleet.

## Executive Summary

Foundry has **no incident response infrastructure**. There is no incident response plan, no runbook for any failure mode, no escalation path, no on-call configuration, no status page, no customer communication template, and no postmortem process. The system does have some implicit resilience features: agent errors are caught and do not cascade (one agent failing does not stop others), the daily cost ceiling prevents unbounded AI spend per product, and the risk state machine provides a framework for business-level incident classification. However, these are operational features, not incident management. When something goes wrong in production — a database migration fails mid-flight, the Anthropic API has an outage, a bad prompt evolution causes an agent to produce harmful output, or a security breach occurs — there is no documented path from detection to resolution to prevention.

## Findings

### IPF-01 No Incident Response Plan
- **Severity:** P0
- **Description:** There is no document, no wiki page, no README section, and no code comment that describes what to do when an incident occurs. The questions that any incident response plan must answer are all unanswered: Who is on call? How do we determine severity? Who communicates to customers? What is the escalation chain? What tools do we use to investigate? How do we declare an incident resolved? Who writes the postmortem?
- **Evidence:** Grep for "incident", "runbook", "postmortem", "escalation", "on-call", "pagerduty", "opsgenie" across the entire codebase returns zero results for incident management processes. The only "escalation" reference is customer lifecycle escalation messages (internal to the product, not about Foundry operations).
- **Remediation:** Write an incident response plan covering: (1) severity levels (P0-P3 with SLA targets), (2) detection mechanisms, (3) escalation path, (4) communication templates, (5) resolution workflow, (6) postmortem template and timeline. Store it in `/docs/operations/incident-response.md` and link from the README.

### IPF-02 No Runbooks For Known Failure Modes
- **Severity:** P0
- **Description:** The codebase reveals at least 10 failure modes that will eventually occur in production. None has a documented runbook:
  1. **Anthropic API outage:** All 12 agents fail simultaneously for all products. No cached results, no degraded mode.
  2. **Turso database unreachable:** Every request fails. No connection pooling, no fallback.
  3. **Stripe webhook processing failure:** Billing state diverges from Stripe state. No reconciliation tool.
  4. **Runaway agent cost:** Despite the daily ceiling ($25/product), a fleet of 100 products could generate $2,500/day in AI costs during an incident.
  5. **Bad prompt evolution:** An agent's evolved prompt produces harmful or incorrect advice that the founder acts on.
  6. **Migration failure on deploy:** Orientation doc notes "Migration failures don't stop server."
  7. **GitHub token expiry:** All repository analyses silently fail. No notification.
  8. **Clerk outage:** No user can authenticate.
  9. **Resend outage:** All email delivery fails silently.
  10. **Memory leak in rate limiter:** In-memory Map grows unboundedly if cleanup timer fails.
- **Evidence:** Each failure mode is inferable from the code. `src/services/ai/client.ts:48` — 2-minute timeout on AI calls but no degraded mode. `src/middleware/rate-limit.ts:17-21` — in-memory Map with setInterval cleanup. `src/db/migrate.ts` — migration runner. None has a corresponding runbook.
- **Remediation:** Write a runbook for each known failure mode. Each runbook should include: (1) how to detect it, (2) immediate mitigation steps, (3) root cause investigation steps, (4) resolution procedure, (5) how to verify resolution, (6) prevention measures.

### IPF-03 No Alerting on Critical System Events
- **Severity:** P1
- **Description:** Critical events that should trigger alerts go unnoticed: (1) agent session failure rate exceeding threshold (e.g., >50% of agent sessions failing in an hour), (2) AI cost ceiling reached for any product (means the product's agents are silently stopped), (3) Stripe webhook handler throwing errors, (4) migration failure, (5) cron job not completing within expected time. The `logger` utility is used across the codebase, but logs go to stdout with no aggregation, alerting, or monitoring service.
- **Evidence:** `src/services/logger.ts` — structured logging to stdout. No evidence of log aggregation (Datadog, CloudWatch, Logtail, etc.). No alert rules. The `healthCheck` endpoint at `/internal/health` exists but is not monitored by any external service.
- **Remediation:** Implement alerting for the top 5 critical events. At minimum: (1) set up Fly.io log draining to a log aggregation service, (2) create alert rules for error rate spikes, (3) add uptime monitoring on the health endpoint, (4) alert on the AI cost ceiling being reached.

### IPF-04 No Customer Communication Path During Incidents
- **Severity:** P1
- **Description:** When Foundry has an outage or degraded performance, there is no mechanism to communicate with affected founders. There is no status page (`/status`), no banner system in the dashboard, no emergency email template, and no in-app notification system for system-level events. The notification system (`src/services/ux/notifications.ts`) is for product-level notifications (stressor alerts, decision approvals), not system-level incident communications.
- **Evidence:** No `/status` route. No system-level notification type. `src/services/ux/notifications.ts` — product-scoped notifications only.
- **Remediation:** Implement: (1) a `/status` page showing system health (can be static HTML updated by a deployment script or a simple health check), (2) a system-wide banner mechanism in the dashboard layout that can show "We are experiencing issues with AI analysis. Your data is safe." messages, (3) email templates for incident notifications.

### IPF-05 No Postmortem Process or Template
- **Severity:** P2
- **Description:** There is no postmortem template, no blameless postmortem culture documentation, no action item tracking system for postmortem outcomes, and no historical postmortem archive. When an incident occurs and is resolved, there is no mechanism to ensure the root cause is addressed and the failure mode is prevented from recurring.
- **Evidence:** No postmortem template in docs. No incident history record.
- **Remediation:** Create a postmortem template with: (1) incident timeline, (2) impact assessment (users affected, duration, data impact), (3) root cause analysis (5 Whys), (4) contributing factors, (5) action items with owners and deadlines, (6) detection improvement (how would we catch this sooner?). Store completed postmortems in `/docs/operations/postmortems/`.

### IPF-06 Implicit Resilience Features Are Undocumented
- **Severity:** P3
- **Description:** Foundry has several implicit resilience features that would aid incident response, but they are not documented as such:
  - **Agent isolation:** One agent failing does not stop others (`src/services/scp/instance.ts:155-160` — try/catch per agent).
  - **Daily cost ceiling:** Per-product AI spend cap prevents runaway costs (`src/services/ai/client.ts:19-45`).
  - **Risk state machine:** Automatic escalation to Gate 2 in Red state reduces autonomous action during crises.
  - **SCP pause capability:** `pauseAgent()` and `deprovisionSCP()` exist to stop agent execution.
  - **Webhook signature verification:** Clerk and Stripe webhooks are verified, preventing replay attacks.
  - **Rate limiting:** IP-based and per-founder rate limits exist.
- **Evidence:** Features exist in code but are not referenced in any operational documentation.
- **Remediation:** Document these features as part of the incident response toolkit. For example: "To stop all AI operations for a product, call `deprovisionSCP(productId)`. To stop all AI operations globally, set `ANTHROPIC_API_KEY` to empty and restart."

## Incident Severity Classification (Proposed)

| Severity | Definition | SLA | Example |
|---|---|---|---|
| P0 | Data loss, security breach, billing corruption | Respond in 15min, resolve in 4hr | Database corruption, credential leak |
| P1 | Service outage for all founders | Respond in 30min, resolve in 8hr | Anthropic API key revoked, Turso outage |
| P2 | Degraded service for some founders | Respond in 2hr, resolve in 24hr | One agent type failing, email delivery failure |
| P3 | Minor issue, workaround exists | Respond in 8hr, resolve in 72hr | UI rendering bug, stale cache |

## Blast Radius Assessment Model

For any incident, assess:
1. **Scope:** Single product, single founder, all founders, or infrastructure?
2. **Data impact:** Is data lost, corrupted, or exposed?
3. **Financial impact:** Are AI costs running? Is billing state incorrect?
4. **AI impact:** Are agents producing incorrect outputs that could be acted on?
5. **Recovery:** Can the system self-heal, or does it require manual intervention?
