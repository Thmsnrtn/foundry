# Lens 091 — Analytics Event Taxonomy

**Distinct value:** Maps every analytics event tracked (or not tracked) across the product, evaluates naming consistency, identifies measurement gaps at critical conversion points, and assesses whether the current instrumentation supports the business questions Foundry needs to answer.

**Tenancy-critical:** Yes. Analytics events from the founder's product (via PostHog integration) flow into agent prompts. If event names from one product leak into another product's context, it is a cross-tenant data exposure.

## Executive Summary

Foundry has **no first-party analytics instrumentation**. There are zero client-side analytics events, zero server-side event tracking for founder behavior, and no event taxonomy document. The PostHog integration exists but is for ingesting the founder's product analytics, not for tracking Foundry's own usage. The only behavioral data captured is implicit: database records of agent sessions, decisions made, briefings viewed, and onboarding chat messages. These are structured records, not analytics events — they lack session context, timing, funnel position, and user segmentation. Foundry cannot currently answer basic product questions: What percentage of founders complete onboarding? Where do they drop off in the tour? Which dashboard pages are most visited? What is the time between signup and first decision approval?

## Findings

### AET-01 Zero Client-Side Analytics Events
- **Severity:** P0 (for product intelligence)
- **Description:** The server-rendered HTML pages contain no analytics instrumentation. There is no PostHog, Amplitude, Mixpanel, or Google Analytics snippet. There are no `track()` calls, no page view events, no click tracking. The HTMX interactions (which are the primary UI interaction model) generate no analytics events. Without client-side analytics, Foundry has zero visibility into: page views, session duration, feature adoption, navigation patterns, error encounters, or conversion funnel performance.
- **Evidence:** `src/views/layout.ts` — no analytics script in the layout. Grep for "posthog.capture", "analytics.track", "gtag", "mixpanel" across all route and view files returns zero results. The PostHog integration (`src/services/integration/posthog.ts`) is for the founder's PostHog instance, not Foundry's.
- **Remediation:** Add PostHog (or equivalent) to the dashboard layout. Instrument critical events: `signup_completed`, `onboarding_started`, `onboarding_message_sent`, `onboarding_completed`, `onboarding_skipped`, `first_briefing_viewed`, `decision_approved`, `decision_denied`, `github_connected`, `tour_step_completed`, `tour_skipped`, `page_viewed` (with page name). Start with 15-20 high-signal events, not comprehensive tracking.

### AET-02 No Conversion Funnel Measurement
- **Severity:** P0
- **Description:** The critical conversion funnel (signup -> onboarding complete -> first briefing -> first decision -> retained at day 7/30) cannot be measured. The database records allow partial reconstruction (onboarding_sessions has status and timestamps, briefings have dates, decisions have timestamps) but there is no unified funnel view, no cohort-based funnel analysis, and no automated funnel reporting. The founders table has `onboarding_completed_at` and `created_at` but no `first_decision_at`, `first_briefing_viewed_at`, or `github_connected_at`.
- **Evidence:** `src/db/schema.sql:1-20` — founders table lacks behavioral milestone timestamps. No funnel query exists in any service or route file.
- **Remediation:** Add milestone timestamps to the founders table: `first_briefing_viewed_at`, `first_decision_at`, `github_connected_at`, `first_pr_generated_at`. Update them at the point of occurrence. Build a funnel query that calculates conversion rates between steps by cohort (signup week).

### AET-03 Database Records Are Implicit Analytics, Not Explicit Events
- **Severity:** P2
- **Description:** Foundry stores rich operational data: `agent_sessions` (every agent run), `agent_audit_log` (every significant action), `outbound_actions` (every proposed action), `decisions` (every decision with status), `onboarding_sessions` (chat history). These records could be used for analytics but they lack: (1) session/request context (which browser, which device, what was the founder doing before this), (2) timing metadata (how long did the founder look at the briefing before approving a decision?), (3) explicit event names (the records describe what happened, not why or in what context).
- **Evidence:** `src/db/migrations/025_audit_log.sql` — `agent_audit_log` has `actor_type`, `event_type`, `metadata_json` which is close to an analytics event but is not queryable as a behavioral funnel. No session ID linking multiple events to a single user interaction.
- **Remediation:** The audit log is a good foundation. Extend it with a `session_id` field (from a session cookie) and a `page_context` field. Use the existing `logAudit()` function to track founder-initiated events. This turns the audit log into a behavioral analytics layer without adding a third-party dependency.

### AET-04 PostHog Integration Lacks Event Taxonomy Validation
- **Severity:** P2
- **Description:** The PostHog integration ingests events from the founder's PostHog instance and normalizes them into `integration_events`. However, there is no validation of event names or properties. The `syncPostHogEvents()` function pulls `$pageview` and `$identify` events generically and stores raw trend data. It does not enforce an event taxonomy for the products it monitors. Two founders could use different event names for the same concept (e.g., "signup" vs "user_created" vs "$identify") and the agents would treat them as different signals.
- **Evidence:** `src/services/integration/posthog.ts:38-103` — `syncPostHogEvents()` hardcodes `$pageview` and `$identify` as the events to pull. No configurable event mapping. `fetchTopEvents()` returns whatever PostHog reports as top events with no normalization.
- **Remediation:** Allow founders to configure event name mappings during integration setup: "Which event represents a signup? A purchase? A key feature use?" Store these mappings in the integration config. Agents should reference the mapped canonical names, not raw PostHog event names.

### AET-05 No A/B Test or Experiment Tracking Infrastructure
- **Severity:** P3
- **Description:** Foundry has an experiments engine (`src/services/experiments/engine.ts`) for the founder's product experiments, but no mechanism for Foundry to run its own experiments. There is no feature flag system, no A/B test assignment, and no way to test variations of the onboarding flow, pricing page, or agent behavior. This limits Foundry's ability to optimize its own conversion funnel.
- **Evidence:** `src/services/experiments/` — experiments engine is for the founder's products. No Foundry-specific experimentation infrastructure.
- **Remediation:** Low priority. Start with basic feature flags (env var-based or DB-based) for testing variations. Use PostHog feature flags once client-side analytics is in place.

## Event Taxonomy Proposal

Below is a starter taxonomy for the 20 most critical events Foundry should track:

| Event Name | Trigger | Properties |
|---|---|---|
| `founder.signup_completed` | Clerk webhook or auto-provision | method (email/oauth), source |
| `founder.onboarding_started` | First onboarding session created | product_id |
| `founder.onboarding_message_sent` | Each chat message | message_count, questions_answered |
| `founder.onboarding_completed` | Briefing generated from chat | duration_seconds, questions_answered |
| `founder.onboarding_skipped` | Skip button clicked | messages_sent |
| `founder.first_briefing_viewed` | First GET to briefing page | time_since_signup_hours |
| `founder.github_connected` | OAuth callback success | repo_count |
| `founder.first_audit_completed` | First audit score recorded | composite_score |
| `founder.decision_approved` | Decision approve action | agent_name, decision_type |
| `founder.decision_denied` | Decision deny action | agent_name, deny_reason_length |
| `founder.tour_step_completed` | Tour advance | step_number |
| `founder.tour_skipped` | Tour skip action | steps_completed |
| `founder.subscription_started` | Stripe checkout success | tier, price_cents |
| `founder.page_viewed` | Every dashboard page load | page_name, product_id |
| `founder.coo_chat_sent` | COO conversation message | topic_intent |
| `agent.session_completed` | Agent run finishes | agent_name, duration_ms, cost_usd |
| `agent.session_failed` | Agent run errors | agent_name, error_type |
| `system.briefing_generated` | Daily briefing created | product_id, health_score |
| `system.scp_provisioned` | SCP provisioning complete | product_id, agents_created |
| `system.email_sent` | Any email delivered | email_type, to_domain |
