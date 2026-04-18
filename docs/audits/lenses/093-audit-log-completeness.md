# Lens 093 — Audit Log Completeness

**Distinct value:** Evaluates whether every important action in the system is recorded in the audit log, whether the log schema captures sufficient context for forensic analysis, and whether there are gaps where actions happen silently. Distinct from the observability lens (011) which focuses on runtime logging; this lens focuses on the persistent, queryable, compliance-grade event record.

**Tenancy-critical:** Yes. The audit log is scoped by `product_id`, but some actions span multiple products (portfolio operations, founder-level tier changes, cross-product pattern generation). These cross-product events may not be correctly attributed.

## Executive Summary

Foundry has two audit log systems that overlap confusingly: (1) the original `audit_log` table (migration 001, 16-column schema focused on AI decisions with `gate`, `trigger`, `reasoning`, `confidence_score`) and (2) the `agent_audit_log` table (migration 025, 10-column schema focused on all system events with `actor_type`, `event_type`, `metadata_json`). The `logAudit()` service function writes to `agent_audit_log`, but many code paths write directly to `audit_log` using raw SQL. **Neither log is called from the vast majority of action-taking code paths.** The `logAudit()` function is never imported by any file — zero call sites. Direct writes to `audit_log` exist in 7 places (jobs, behavioral triggers, audit engine, evolution). This means the following actions are completely unlogged: founder login/logout, tier changes, product creation/deletion, agent pause/resume, integration connect/disconnect, GitHub OAuth, decision creation/approval/denial via the UI, settings changes, and data exports.

## Findings

### ALC-01 logAudit() Has Zero Call Sites
- **Severity:** P0
- **Description:** The `logAudit()` function in `src/services/audit/log.ts` is the intended API for writing audit events to `agent_audit_log`. It accepts a well-typed `AuditEvent` with `product_id`, `actor_type`, `actor_id`, `action`, `resource_type`, `resource_id`, `details`, and `ip_address`. This is the correct API. However, no file in the codebase imports it. Zero route handlers, zero services, and zero middleware call `logAudit()`. The function exists but is never used.
- **Evidence:** Grep for `import.*logAudit` and `from.*audit/log` across `src/` returns zero results. The only file that defines `logAudit` is `src/services/audit/log.ts`. The `agent_audit_log` table is only written to by the privacy consent service (`src/services/privacy/consent.ts:290`) which does a direct SQL INSERT, not via `logAudit()`.
- **Remediation:** This is a P0 because the entire audit trail system is dead code. Integrate `logAudit()` into: (1) auth middleware (login events), (2) decision approval/denial routes, (3) agent pause/resume handlers, (4) integration connect/disconnect, (5) settings changes, (6) data export, (7) billing events. Instrument the 15-20 most critical actions first.

### ALC-02 Two Overlapping Audit Tables With Different Schemas
- **Severity:** P1
- **Description:** The `audit_log` table (16 columns: `action_type`, `gate`, `trigger`, `reasoning`, `input_context`, `output`, `outcome`, `confidence_score`, `risk_state_at_action`) and `agent_audit_log` table (10 columns: `event_type`, `actor_type`, `actor_id`, `target_type`, `target_id`, `description`, `metadata_json`, `ip_address`) serve overlapping purposes. Code writes to both tables inconsistently. The `insertAuditLog()` function in `src/db/client.ts:295` writes to `audit_log`. The `logAudit()` function in `src/services/audit/log.ts` writes to `agent_audit_log`. The dashboard audit log view (`src/routes/dashboard/audit-log.ts`) reads from `agent_audit_log`. This means entries written to `audit_log` are invisible in the UI.
- **Evidence:** `src/db/client.ts:295` — writes to `audit_log`. `src/services/audit/log.ts:27` — writes to `agent_audit_log`. `src/routes/dashboard/audit-log.ts:61` — reads from `agent_audit_log`. The jobs file (`src/jobs/index.ts`) writes to `audit_log` directly (lines 387, 447, 465, 530).
- **Remediation:** Consolidate on `agent_audit_log` as the single audit table. Migrate the `insertAuditLog()` calls in `db/client.ts` and `jobs/index.ts` to use `logAudit()`. Remove or deprecate the `audit_log` table. All audit events should go through one path to one table.

### ALC-03 No Founder Authentication Events Logged
- **Severity:** P1
- **Description:** There is no audit record of when a founder logs in, from what IP, what browser, or how often. The auth middleware (`src/middleware/auth.ts`) validates the JWT and resolves the founder but does not log the access. The Clerk webhook logs the `user.created` event but not subsequent logins. For SOC2 compliance, all authentication events must be logged with timestamps and source IPs.
- **Evidence:** `src/middleware/auth.ts` — no audit logging call. `src/routes/auth/clerk.ts` — no login event logging. No `user.login` or `user.session_created` handling.
- **Remediation:** Add a lightweight audit log call in the auth middleware for each authenticated request (or at least for session-start events). Log: founder_id, IP address, user agent, and timestamp. Rate-limit the logging to avoid excessive writes (e.g., one log entry per founder per hour).

### ALC-04 Billing Tier Changes Not Logged
- **Severity:** P1
- **Description:** When a subscription is created, updated, or deleted, the Stripe webhook handler updates `founders.tier` but does not log this change. Tier changes are significant security events — they affect what features a founder can access and what data they can see. A malicious Stripe webhook replay could silently upgrade a founder's tier.
- **Evidence:** `src/services/billing/stripe.ts:73-99` — tier update and nullification with no audit log call.
- **Remediation:** After every tier change, call `logAudit()` with action `billing.tier_changed`, the old tier, new tier, and Stripe event ID. This creates a tamper-evident record of all billing state changes.

### ALC-05 Decision Approval/Denial Not Logged in Audit Trail
- **Severity:** P1
- **Description:** The `approveDecision()` and `denyDecision()` methods on `SCPInstance` (`src/services/scp/instance.ts:195-252`) update the decision's JSON in the session record and increment the agent's `total_decisions_approved` counter. Neither action is logged to the audit trail. Decision approvals are the highest-stakes founder actions in the product — they authorize the AI to act on behalf of the business. These must be audit-logged.
- **Evidence:** `src/services/scp/instance.ts:195-252` — no `logAudit()` or `insertAuditLog()` call in approve or deny methods.
- **Remediation:** Log every decision approval and denial with: decision_id, agent_name, action_type, founder_id, IP address, and the decision context. This is both a compliance requirement and a debugging necessity.

### ALC-06 Agent Session Outcomes Not Written to Audit Log
- **Severity:** P2
- **Description:** Agent sessions are recorded in `agent_sessions` table with status, observations, actions taken, tokens used, and cost. This is detailed operational data. However, the audit-grade `agent_audit_log` has no record of agent sessions completing. The `base.ts` agent runner does not call `logAudit()` at any point. If you query `agent_audit_log` for all actions taken by the Atlas agent, you get zero results.
- **Evidence:** `src/services/scp/agents/base.ts` — no import of `logAudit`. The entire 757-line file has no audit trail integration.
- **Remediation:** Add a `logAudit()` call at the end of each successful agent session with action `agent.session_completed` and key outcomes. Add another for failed sessions with action `agent.session_failed`. This links the operational data in `agent_sessions` to the compliance trail in `agent_audit_log`.

### ALC-07 Data Export and Deletion Not Fully Logged
- **Severity:** P2
- **Description:** Data export (`exportProductData`) has no audit log entry. Data deletion scheduling (`scheduleDataDeletion`) does write to `agent_audit_log` directly (the one place that does). But the actual data deletion (when the cron job runs) is not logged because the cron job does not exist yet — `scheduleDataDeletion` records the intent but no job executes it.
- **Evidence:** `src/services/privacy/consent.ts:232-277` — export function, no audit log. `src/services/privacy/consent.ts:285-303` — deletion scheduling writes to audit log. No corresponding deletion execution job exists.
- **Remediation:** Log every data export with `logAudit()`. Implement the deletion cron job and log every deletion execution. Both are required for GDPR compliance.

## Coverage Matrix

| Action Category | Logged? | Where? |
|---|---|---|
| Founder signup | Partial | Clerk webhook creates DB record, no audit log |
| Founder login | No | N/A |
| Founder tier change | No | N/A |
| Product creation | No | N/A |
| Product deletion | No | N/A |
| Agent session complete | No (operational data in agent_sessions, not in audit log) | N/A |
| Agent session failed | No | N/A |
| Decision approved | No | N/A |
| Decision denied | No | N/A |
| Integration connected | No | N/A |
| Integration disconnected | No | N/A |
| GitHub OAuth | No | N/A |
| Settings changed | No | N/A |
| Data export | No | N/A |
| Data deletion scheduled | Yes | Direct SQL to agent_audit_log |
| Risk state transition | Yes | Direct SQL to audit_log (wrong table) |
| Behavioral trigger fired | Yes | Direct SQL to audit_log (wrong table) |
| Remediation classified | Yes | Direct SQL to audit_log (wrong table) |
| DNA nudge sent | Yes | Direct SQL to audit_log (wrong table) |
| Consent change | Yes | Direct SQL to agent_audit_log |

**Logged actions:** 5 of 20 (25%). **Using the correct table:** 2 of 5 (10%).
