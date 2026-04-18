# Lens 090 — Support Handoff (Self-Serve to Human)

**Distinct value:** Audits the complete support escalation path: does a founder who is stuck, confused, or experiencing an error have a way to get help? Evaluates self-serve documentation, help pages, contact mechanisms, error message quality, and the bridge from autonomous AI operation to human intervention.

**Tenancy-critical:** No. Support is per-founder, not per-product.

## Executive Summary

Foundry has **no support infrastructure**. There is no help page, no documentation site, no FAQ, no contact form, no support email address in the UI, no Intercom widget (despite an Intercom integration module existing), no knowledge base, and no way for a stuck founder to reach a human. The sole support surface is the error message "contact support" that appears in one place (`src/routes/dashboard/agents.ts:129`) with no link or email. The Intercom integration exists in code (`src/services/integration/intercom.ts`) but is for tracking the founder's customer support metrics, not for Foundry's own support. The product operates on the assumption that the AI layer handles everything, but when the AI fails (parsing errors, API timeouts, incorrect recommendations), the founder has nowhere to go.

## Findings

### SUP-01 No Help or Support Page Exists
- **Severity:** P0
- **Description:** There is no `/help`, `/support`, `/docs`, `/faq`, or `/contact` route. The public routes consist of landing, pricing, and case studies. The dashboard routes consist of 59 authenticated pages. None of them is a help or support page. A founder who encounters a problem has no in-product mechanism to get help.
- **Evidence:** `src/routes/public/` — only `landing.ts`, `pricing.ts`, `case-studies.ts`. `src/routes/dashboard/` — 59 files, none named help, support, faq, or docs. Grep for "help", "support", "contact", "faq" across route files returns only metric field names (`support_volume_7d`) and integration descriptions.
- **Remediation:** Create a `/support` page accessible from the dashboard sidebar. Include: (1) searchable FAQ, (2) email contact (e.g., `support@foundry.app`), (3) system status indicator, (4) links to documentation for common tasks (connecting GitHub, understanding audit scores, managing agents).

### SUP-02 Error Messages Do Not Include Support Path
- **Severity:** P1
- **Description:** When the SCP provisioning fails, the dashboard shows: "Provisioning failed. Please try again or contact support." with no link, no email, and no ticket system. This is the only place in the entire codebase that mentions "contact support." All other errors either show generic messages ("Something went wrong") or technical errors (raw error messages). The agent error states show "experienced a temporary error during analysis" with no guidance on what to do.
- **Evidence:** `src/routes/dashboard/agents.ts:129` — "contact support" with no link. Agent error handling in `src/services/scp/agents/base.ts:142-168` — session marked as failed, generic error in briefing contribution, no user-facing guidance.
- **Remediation:** Every error message visible to the founder should include a specific action: retry, wait, or contact support (with a real link). Create an error page component that includes the error context, a retry button, and a support email link pre-populated with the error details.

### SUP-03 Intercom Integration Is For Customer's Customers, Not Foundry Support
- **Severity:** P3 (clarification, not a bug)
- **Description:** The Intercom integration (`src/services/integration/intercom.ts`) exists and is listed on the integrations page. However, it is designed to connect a founder's Intercom instance to track their customers' support volume and sentiment. It is not a Foundry support channel. A founder might reasonably expect clicking "Intercom" in settings would open a support chat with Foundry.
- **Evidence:** `src/routes/dashboard/integrations.ts:50` — Intercom listed as an available integration with description "Track support volume, NPS from CSAT, and auto-detect support spikes as stressors." This is about the founder's product, not about getting help with Foundry.
- **Remediation:** If Foundry will use Intercom for its own support, add a separate Intercom widget on the dashboard (loaded via their JS snippet) that connects to Foundry's Intercom workspace. This is distinct from the integration that connects to the founder's Intercom.

### SUP-04 No Status Page or System Health Indicator
- **Severity:** P2
- **Description:** When agents fail, when the Anthropic API is down, when Turso has latency, or when cron jobs stop running, the founder has no visibility into whether the problem is on Foundry's side or theirs. There is no status page, no health endpoint exposed to users, and no "System status: operational" indicator in the UI. The internal ecosystem health endpoint (`src/routes/internal/ecosystem.ts`) exists but is protected by the `ECOSYSTEM_SERVICE_KEY` and is not user-facing.
- **Evidence:** `src/routes/internal/ecosystem.ts` — internal health endpoint, not accessible to founders. No public `/status` route.
- **Remediation:** Add a simple `/status` page that shows: (1) API status (can we reach Anthropic?), (2) last successful agent run time, (3) last successful briefing generation time, (4) any active incidents. This can be a simple server-rendered page using cached health check data.

### SUP-05 No Guided Recovery From Common Failure States
- **Severity:** P2
- **Description:** When specific failures occur, the product provides no guided recovery:
  - GitHub OAuth token expires: No notification, no "reconnect" prompt. GitHub analysis silently fails.
  - SCP provisioning fails: "Try again or contact support" — but what if the underlying issue persists?
  - Agent enters 'error' state: The agent's `status` is set to 'error' in the DB, but there is no UI to view error details or manually retry.
  - Stripe checkout fails: The founder is redirected to the cancel URL with no explanation of what went wrong.
- **Evidence:** `src/services/scp/agents/base.ts:148-149` — agent status set to 'error' with `error_message` in the session but no UI route to view it. `src/services/billing/stripe.ts:39-48` — `createCheckoutSession` only sets success/cancel URLs, no failure messaging.
- **Remediation:** For each common failure: (1) show the specific error, (2) provide a self-serve fix action (reconnect, retry, contact), (3) if the self-serve fix does not work, escalate to human support with pre-populated context.

### SUP-06 The AI "COO" Chat Could Be a Support Channel But Is Not
- **Severity:** P3 (opportunity)
- **Description:** The COO chat service (`src/services/chat/coo.ts`) provides a conversational AI interface for founders. This could serve as a first-line support channel — the founder asks "Why did my audit score drop?" or "How do I connect GitHub?" and the COO answers from product context. However, the COO is currently focused on proactive business insights, not product support.
- **Evidence:** `src/services/chat/coo.ts` — COO chat with product context. No support-specific knowledge or documentation context.
- **Remediation:** Extend the COO's system prompt to include Foundry product documentation and common support scenarios. Add a "Help" intent detection that routes support questions to product documentation rather than business analysis. This provides 24/7 self-serve support via the existing AI infrastructure.

## Support Surface Inventory

| Surface | Exists? | Quality |
|---|---|---|
| Help page / FAQ | No | N/A |
| Contact form | No | N/A |
| Support email | No (mentioned once with no link) | N/A |
| Status page | No | N/A |
| In-app chat (Foundry support) | No | N/A |
| Documentation site | No | N/A |
| Error recovery guidance | Minimal | "Try again" only |
| Onboarding help | Partial | Chat is good, but no help if chat fails |
| Billing support | No | No self-serve billing portal link |
