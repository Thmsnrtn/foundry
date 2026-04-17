# Lens 30 — Analytics Reviewer Audit

**Auditor perspective:** Analytics reviewer
**Scope:** Internal analytics Foundry collects about its own usage, event tracking, funnel analysis, feature adoption metrics
**Date:** 2026-04-16

---

## Executive Summary

Foundry collects **zero analytics about its own usage**. There is no page-view tracking, no event instrumentation, no funnel analysis, and no feature adoption metrics for Foundry itself. The only behavioral signals are implicit: `last_seen_at` (updated on each authenticated request), tour completion state, and behavioral trigger audit log entries. The PostHog integration exists but monitors the **founder's product**, not Foundry. The audit_log table records autonomous agent actions, not user interactions. The platform is flying blind on its own product metrics.

**P0 findings:** 1
**P1 findings:** 3
**P2 findings:** 2

---

## Finding 01 — No product analytics instrumentation

**Severity: P0**
**Files:** `src/views/layout.ts`, `src/index.ts`

The HTML layout template includes no analytics scripts. There is no PostHog, Plausible, Mixpanel, Amplitude, Segment, or Google Analytics integration for Foundry's own pages. The only external scripts are HTMX and the service worker.

This means there is no data on:
- Page views per route (which dashboard pages are visited)
- Session duration (how long founders spend in the product)
- Click tracking (which buttons and links are used)
- Scroll depth (how much of each page is consumed)
- Error rates in the browser (JavaScript errors, failed HTMX requests)

For a server-rendered HTMX application, server-side analytics (request logs) could partially substitute, but there is no structured request logging either (see Lens 06 on observability). The 422 `console.log` calls produce unstructured text, not queryable analytics.

**Impact:** Cannot answer basic product questions: "How many founders use the Decision Chamber weekly?" "What is the most visited page after the dashboard?" "How long does the average session last?"

**Remediation:**
1. Add PostHog (already a known integration) or Plausible to the layout template for Foundry's own pages.
2. Instrument key events: `page_view`, `decision_resolved`, `query_asked`, `tour_step_completed`, `dna_section_saved`, `audit_triggered`, `milestone_celebrated`.
3. Create a Foundry internal analytics dashboard (separate from founder-facing features).

---

## Finding 02 — No funnel tracking for critical user journeys

**Severity: P1**
**Files:** `src/routes/dashboard/onboarding.ts`, `src/routes/auth/clerk.ts`

The critical funnels that should be tracked:

**Acquisition funnel:**
- Landing page visit -> Signup click -> Clerk signup complete -> Dashboard redirect
- No data on any of these steps.

**Activation funnel:**
- Dashboard first visit -> GitHub connect -> Repo selection -> Competitor identification -> First audit -> Tour start -> Tour complete
- The only tracked step is tour completion (`onboarding_tour` table). No timestamps for intermediate steps. The behavioral triggers detect stalls at GitHub and repo steps, but only as rescue mechanisms, not as funnel metrics.

**Retention funnel:**
- Weekly: Digest sent -> Digest opened -> Dashboard visit -> Action taken
- Digest sent is logged (audit_log). Digest opened is not tracked (no email open tracking). Dashboard visit is partially tracked (last_seen_at). Action taken is tracked per-decision but not aggregated as a retention metric.

**Expansion funnel:**
- Settings visit -> Checkout click -> Stripe checkout -> Subscription created
- No data on settings visit frequency or checkout intent. Subscription creation is tracked via Stripe webhook.

**Impact:** Cannot optimize any user journey. Product development priorities are based on intuition, not data.

**Remediation:**
1. Define 4-5 critical funnels with named stages.
2. Record funnel step completions in a `funnel_events` table (founder_id, funnel_name, step_name, timestamp).
3. Build aggregate funnel views in Founder Ops.

---

## Finding 03 — last_seen_at is the only engagement metric, and it is too coarse

**Severity: P1**
**Files:** `src/middleware/auth.ts` (line 128)

The auth middleware updates `last_seen_at` on every authenticated request:

```typescript
query('UPDATE founders SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [founder.id]).catch(() => {});
```

This provides a single "last active" timestamp but no:
- Session count (how many distinct sessions per week)
- Active days (how many unique days active in the last 30 days)
- Feature breadth (how many distinct features used)
- Depth of engagement (viewed dashboard only vs. resolved decisions, completed DNA, reviewed briefings)

**Impact:** Cannot distinguish between a founder who logs in daily and resolves decisions (high engagement) and one who visits the dashboard once a week for 30 seconds (low engagement). Both show the same `last_seen_at` pattern.

**Remediation:**
1. Log distinct sessions (new session if last_seen_at is >30 minutes ago).
2. Track unique active days per rolling 30-day window.
3. Track feature flags per session (which route groups were visited).

---

## Finding 04 — Audit log tracks agent actions, not founder interactions

**Severity: P1**
**Files:** `src/db/schema.sql` (audit_log table)

The `audit_log` table records:
- Agent-initiated actions (gate 0/1 autonomous decisions)
- Behavioral trigger firings
- System events (risk state transitions, digest sends)

It does not record founder-initiated interactions:
- Pages visited
- Decisions viewed (not just resolved)
- Briefings read
- DNA sections edited
- Settings changed
- Queries asked in the "Ask Foundry" bar

The audit log is designed as an accountability record for the SCP agents, not as a product analytics system. This is appropriate for its purpose but means there is no separate founder interaction log.

**Impact:** Cannot reconstruct founder behavior for debugging, support, or product analysis.

**Remediation:**
1. Create a separate `founder_activity` table (or use the analytics tool from Finding 01) that logs significant founder interactions.
2. Ensure this is separate from the agent audit_log to maintain the purity of the accountability record.

---

## Finding 05 — No feature adoption metrics

**Severity: P2**
**Files:** Entire codebase (absence)

Foundry has many features: Decision Chamber, Product DNA, competitive intelligence, scenario planner, agent debate, agent accuracy tracking, network intelligence, standing orders, ambient layer, ROI dashboard, benchmarks, and more. There is no measurement of which features founders actually use.

The sidebar navigation has tier-gated features (locked with a lock icon), but there is no tracking of:
- Which locked features founders attempt to access (upgrade intent signals)
- Which unlocked features are never visited (candidates for removal or redesign)
- Feature discovery rate (time from signup to first use of each feature)
- Feature stickiness (how many founders use a feature more than once)

**Impact:** Cannot prioritize feature investment. May be building features nobody uses while neglecting high-demand capabilities.

**Remediation:**
1. Track first-use timestamps per feature per founder.
2. Build a feature adoption matrix (founders x features, color-coded by usage frequency).
3. Track attempted access to locked features as upgrade intent signals.

---

## Finding 06 — No error tracking in the browser

**Severity: P2**
**Files:** `src/views/layout.ts`

The layout includes no browser error tracking. For a server-rendered HTMX application, JavaScript errors are less common than in SPAs, but they still occur:
- HTMX request failures (network errors, 500 responses)
- Service worker registration failures
- Command palette JavaScript errors
- Clerk authentication failures

The `initClerk().catch()` handler in auth pages shows an error message to the user, which is good, but does not report the error to any monitoring service.

**Impact:** Browser-side errors go undetected. If HTMX fails silently, founders see broken interactions with no server-side trace.

**Remediation:**
1. Add a global `window.onerror` handler that sends errors to the server (or to an error tracking service like Sentry).
2. Add HTMX error event listeners (`htmx:responseError`, `htmx:sendError`) to track failed dynamic interactions.

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 01 | No product analytics instrumentation | P0 | `views/layout.ts` |
| 02 | No funnel tracking for critical user journeys | P1 | `routes/dashboard/onboarding.ts` |
| 03 | last_seen_at is the only engagement metric | P1 | `middleware/auth.ts` |
| 04 | Audit log tracks agents, not founder interactions | P1 | `db/schema.sql` |
| 05 | No feature adoption metrics | P2 | Entire codebase |
| 06 | No browser error tracking | P2 | `views/layout.ts` |

---

## Cross-References

- **Lens 22 (UX researcher):** Finding 01 here is the same gap as Lens 22 Finding 01 -- viewed from analytics perspective rather than research perspective.
- **Lens 29 (Customer success):** Health scoring (Lens 29 Finding 01) depends on engagement data that this audit shows is missing.
- **Lens 27 (Growth strategist):** Funnel optimization (Lens 27) requires the funnel tracking identified here.
